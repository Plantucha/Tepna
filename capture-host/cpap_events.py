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

Credit: the selectors and the boundary semantics are as an independent Apache-2.0 reference
implementation documents them from its own AS11 work; the parsing here is Tepna's, from the wire
shape observed. No code was taken, so no licence attribution is owed (THIRD-PARTY.md carries no
entry); the debt is for published documentation and is stated here rather than credited by name.

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
- A DEVICE THAT NEVER FLIPS `_ZLE` STILL HAS A WITNESS. Measured 2026-10-19 on one AS11 night: the
  device sent exactly one `_ZLE` report over 6 h 18 m, so `_note_zle` saw a level and no edge, and both
  deltas read `None` while a TherapyStop row and a MaskOff row sat in the sidecar. So each boundary
  falls back to the therapy-status rows PER EDGE (`WITNESS_*_FALLBACK`), and `witness_*_source` names
  which witness the delta used. The fallback is not gated on `zle_edges`: a night with one rising edge
  and no falling edge leaves the stop boundary just as uncomputed as a night with no edge at all.
- This module DOES NOT replace `auto_start` / `auto_stop`. It adds the second witness. Acting on it is
  a later, separate decision.
"""

from __future__ import annotations

import json
import os
import time

__all__ = [
    "EVENT_DATA_IDS_DEFAULT",
    "WITNESS_START_FALLBACK",
    "WITNESS_STOP_FALLBACK",
    "parse_event_notification",
    "EventRecorder",
]

# The subscribed set. Each id is here because a consumer is named above; add one only with its consumer.
EVENT_DATA_IDS_DEFAULT = ("UsageEvents-TherapyStatusEvents", "_ZLE")
ZLE = "_ZLE"
THERAPY_STATUS = "UsageEvents-TherapyStatusEvents"

# The witness fallback, in preference order, consumed by `EventRecorder.snapshot`. `_ZLE` is the
# first choice at both boundaries because it is a different subsystem from the therapy state and
# therefore independent of the trigger. When its edge is absent the therapy-status rows answer the
# same question less tightly, so they are second — and the snapshot NAMES which one it used, so a
# reader never has to guess which quantity a delta measured. `Therapy*` before `Mask*`: the therapy
# boundary is what this data id exists to report, and the mask seal is a different quantity that
# merely brackets it.
WITNESS_START_FALLBACK = ("TherapyStart", "MaskOn")
WITNESS_STOP_FALLBACK = ("TherapyStop", "MaskOff")


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
        # First and last host stamp per named therapy-status event — the SECOND witness, read only
        # when the `_ZLE` edge for that boundary never arrived. First for a start, last for a stop.
        self.status_first: dict[str, float] = {}
        self.status_last: dict[str, float] = {}
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
            elif r["data_id"] == THERAPY_STATUS and r["event"] is not None:
                self._note_status(r["event"], now)
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

    def _note_status(self, event: str, host_epoch: float) -> None:
        """One named therapy-status event's host stamp. Every name is kept, not just the four the
        fallback reads, because the device may report names we have not seen and dropping them here
        would make a later unit re-read the sidecar to learn they existed."""
        self.status_first.setdefault(event, host_epoch)
        self.status_last[event] = host_epoch

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

    def _witness(self, zle_host: float | None, names, stamps: dict) -> tuple[float | None, str | None]:
        """The witness for ONE boundary and the name of where it came from: the `_ZLE` edge when the
        device sent one, else the first therapy-status name in `names` that it did report. Returns
        `(None, None)` when neither arrived — an absent witness is null with no borrowed source."""
        if zle_host is not None:
            return zle_host, ZLE
        for name in names:
            host = stamps.get(name)
            if host is not None:
                return host, f"{THERAPY_STATUS}:{name}"
        return None, None

    def snapshot(self) -> dict:
        """The witness record that rides the gap-accounting line and the acquisition envelope. Every
        absent measurement is None — a delta over a missing edge is not 0 seconds of disagreement."""
        start_host, start_source = self._witness(self.zle_rising_host, WITNESS_START_FALLBACK, self.status_first)
        stop_host, stop_source = self._witness(self.zle_falling_host, WITNESS_STOP_FALLBACK, self.status_last)
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
            # The witness each delta was built from, and the name of where it came from — `_ZLE` when
            # the device sent that edge, a therapy-status row when it did not. A delta is NEVER
            # source-ambiguous: read the source beside it before comparing two nights.
            "witness_start_host": start_host,
            "witness_start_source": start_source,
            "witness_stop_host": stop_host,
            "witness_stop_source": stop_source,
            # witness − trigger: positive when the device's witness came AFTER the trigger
            "witness_start_delta_s": self._delta(self.trigger_start_host, start_host),
            "witness_stop_delta_s": self._delta(self.trigger_stop_host, stop_host),
        }

    def close(self) -> None:
        if self._fh is not None:
            try:
                self._fh.close()
            finally:
                self._fh = None
