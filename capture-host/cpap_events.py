# tepna-capture — cpap_events.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""AS11 EventNotification — the device's own session-boundary WITNESSES, recorded beside the stream.

WHY THIS EXISTS (owner: "implement it all, just better", 2026-09-19). T1 that day established that the
box had ONE witness for "therapy started", not two: `auto_start` fires on the shadow detector's own
`Therapy` sighting, so the detector and the trigger cannot disagree. A witness that can disagree is
the thing we did not have. The AS11 can push one: `SubscribeEvent` (JSON-RPC over the encrypted
channel) makes the device send `EventNotification`s for selected data ids. Two are subscribed here,
each for a stated consumer:

    UsageEvents-TherapyStatusEvents   TherapyStart / TherapyStop / MaskOn / MaskOff — the device's own
                                      account of the boundary the detector infers from `FGState`.
    _ZLE                              Zero Leak Estimate, a boolean the device flips when it starts and
                                      stops accepting valid flow — the quantity that gates its OWN
                                      waveform recording. A different subsystem from the therapy state,
                                      so genuinely independent of the trigger. Its rising edge is a
                                      tighter "data begins here" than MaskOn; its falling edge the end.

Credit: the selectors and the boundary semantics are as SomnoTrace (Ilya Kruchinin, Apache-2.0)
documents them from its own AS11 work; the parsing here is Tepna's, from the wire shape observed.

CONTRACT
- READ-ONLY on the device: SubscribeEvent asks for notifications; nothing is set. The subscription is
  requested BEFORE StartStream so no waveform batch is consumed while awaiting its ack, and its
  failure is non-fatal — the stream must not lose a night because an optional witness declined.
- SHIPS COLD. `cpap.ble_stream.events.enabled` defaults to false; enabling it is a live BLE change on
  the box and therefore the owner's (the `scan_coexistence_verified` shape).
- EVERY notification is recorded VERBATIM to a per-session JSONL sidecar with the host arrival stamp
  beside the device's own `reportTime` (Clock Contract: the device stamp is kept as sent; the host
  stamp is the join key). Nothing is interpreted before it is written.
- The `_ZLE` edges and the existing trigger's start/stop are BOTH recorded, and the delta between them
  is reported — `None` when either side is absent, never 0. Disagreement is the product, not a defect.
- This module DOES NOT replace `auto_start` / `auto_stop`. It adds the second witness. Acting on it is
  a later, separate decision.
"""

from __future__ import annotations

import json
import os
import time

__all__ = ["EVENT_DATA_IDS_DEFAULT", "parse_event_notification", "EventRecorder"]

# The subscribed set. Each id is here because a consumer is named above; add one only with its consumer.
EVENT_DATA_IDS_DEFAULT = ("UsageEvents-TherapyStatusEvents", "_ZLE")
ZLE = "_ZLE"


def parse_event_notification(params, host_epoch: float) -> list[dict]:
    """One `EventNotification.params` -> a flat list of event rows. PURE, never raises.

    Wire shape (as observed): `{"dataId": <id>, "events": [{"event": <name>, "reportTime": <iso>} …]}`
    for named events, and `{"dataId": "_ZLE", "events": [{"value": 0|1, "reportTime": <iso>} …]}` for
    value changes. A row carries BOTH `event` and `value` slots (either may be None), the device's
    `reportTime` verbatim, and the host epoch the notification ARRIVED — the join key to every other
    record on the box. Anything not of that shape yields no rows: a malformed notification is counted
    by the caller as a frame kind, never turned into a fabricated event."""
    if not isinstance(params, dict):
        return []
    data_id = params.get("dataId")
    events = params.get("events")
    if not isinstance(data_id, str) or not isinstance(events, list):
        return []
    rows = []
    for ev in events:
        if not isinstance(ev, dict):
            continue
        name = ev.get("event")
        value = ev.get("value")
        rt = ev.get("reportTime")
        rows.append(
            {
                "host_epoch": host_epoch,
                "data_id": data_id,
                "event": name if isinstance(name, str) else None,
                "value": value if isinstance(value, (int, float)) and not isinstance(value, bool) else None,
                "report_time": rt if isinstance(rt, str) else None,
            }
        )
    return rows


class EventRecorder:
    """Per-session recorder: the JSONL sidecar of every notification, the `_ZLE` witness, and the
    trigger marks the controller supplies — so one object can say whether the two witnesses agreed.

    `path` may be None (record in memory only; the tests and a bus-only pump). Writes are append-only
    and each line is one notification's rows, so a partial night is a prefix, never a corrupt file."""

    def __init__(self, path: str | None = None, data_ids=EVENT_DATA_IDS_DEFAULT):
        self.path = path
        self.data_ids = tuple(data_ids)
        self.rows: list[dict] = []
        self.notifications = 0
        self.subscribe_status: str = "not-requested"  # set by the pump: ok / failed:<why> / off
        self.zle_value: int | None = None  # last _ZLE value seen; None until one arrives
        self.zle_rising_host: float | None = None  # FIRST rising edge (data begins)
        self.zle_falling_host: float | None = None  # LAST falling edge (data ends)
        self.zle_rising_report: str | None = None
        self.zle_falling_report: str | None = None
        self.zle_edges = 0
        self.trigger_start_host: float | None = None
        self.trigger_stop_host: float | None = None
        self._fh = None
        if path:
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            self._fh = open(path, "a", encoding="utf-8")

    # ── the pump calls these ────────────────────────────────────────────────────────────────────
    def note(self, params, host_epoch: float | None = None) -> list[dict]:
        """Record one notification. Returns its rows (for the caller's own use). Never raises into the
        pump: a recorder failure is counted in `subscribe_status`, not propagated."""
        now = time.time() if host_epoch is None else host_epoch
        rows = parse_event_notification(params, now)
        self.notifications += 1
        self.rows.extend(rows)
        for r in rows:
            if r["data_id"] == ZLE and r["value"] is not None:
                self._note_zle(int(r["value"]), now, r["report_time"])
        if self._fh is not None:
            try:
                self._fh.write(json.dumps({"host_epoch": now, "params": params}, separators=(",", ":")) + "\n")
                self._fh.flush()
            except Exception as exc:  # noqa: BLE001 — a note about the night must not end the night
                self.subscribe_status = f"record-error:{type(exc).__name__}"
        return rows

    def note_subscribed(self, status: str) -> None:
        """The pump's report of the SubscribeEvent round: `ok`, or `failed:<ExceptionName>`. Recorded, not
        acted on — a declined subscription leaves the stream running and this field says why there
        are no events, so an empty JSONL is never mistaken for a quiet night."""
        self.subscribe_status = str(status)

    def _note_zle(self, value: int, host_epoch: float, report_time) -> None:
        prev = self.zle_value
        self.zle_value = value
        if prev is None or prev == value:
            # The first value is a LEVEL, not an edge: a session that starts with _ZLE already 1 has no
            # rising edge to report, and fabricating one at subscribe time would be a stamp nobody took.
            return
        self.zle_edges += 1
        if value == 1 and self.zle_rising_host is None:
            self.zle_rising_host, self.zle_rising_report = host_epoch, report_time
        elif value == 0:
            self.zle_falling_host, self.zle_falling_report = host_epoch, report_time

    def mark_trigger(self, which: str, host_epoch: float | None = None) -> None:
        """The EXISTING trigger's own boundary — `start` when the pump began (auto_start's sighting or a
        button), `stop` when it ended. Recorded so the two witnesses can be compared on one clock."""
        now = time.time() if host_epoch is None else host_epoch
        if which == "start":
            self.trigger_start_host = now
        elif which == "stop":
            self.trigger_stop_host = now
        else:
            raise ValueError(f"unknown trigger mark: {which!r}")

    # ── the report ───────────────────────────────────────────────────────────────────────────────
    @staticmethod
    def _delta(a, b):
        return None if a is None or b is None else round(b - a, 3)

    def snapshot(self) -> dict:
        """The witness record that rides the gap-accounting line and the acquisition envelope. Every
        absent measurement is None — a delta over a missing edge is not 0 seconds of disagreement."""
        return {
            "events_subscribe": self.subscribe_status,
            "events_notifications": self.notifications,
            "events_rows": len(self.rows),
            "zle_edges": self.zle_edges,
            "zle_rising_host": self.zle_rising_host,
            "zle_falling_host": self.zle_falling_host,
            "zle_rising_report": self.zle_rising_report,
            "zle_falling_report": self.zle_falling_report,
            "trigger_start_host": self.trigger_start_host,
            "trigger_stop_host": self.trigger_stop_host,
            # zle − trigger: positive when the device's edge came AFTER the trigger
            "witness_start_delta_s": self._delta(self.trigger_start_host, self.zle_rising_host),
            "witness_stop_delta_s": self._delta(self.trigger_stop_host, self.zle_falling_host),
        }

    def close(self) -> None:
        if self._fh is not None:
            try:
                self._fh.close()
            finally:
                self._fh = None
