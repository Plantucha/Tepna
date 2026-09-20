# tepna-capture — cpap_ingest.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# CPAP INGEST — the bounded queue and gap-accounting counters between the AS11 transport callback and
# the raw sink. Executes P3 of CPAP-ACQUISITION-HARDENING-AUDIT-2026-08-23-BRIEF, under the
# acquisition-hardening lead (session codename Mutator, 2026-08-23).
#
# WHY A STANDALONE MODULE. Audit gaps G4 (no gap accounting) and G5 (no bounded queue / backpressure).
# Today `stream_to_bus` awaits the sink inline in the read loop, a foreign-streamId frame is silently
# `continue`d, and nothing counts dropped/stalled frames or bounds RAM. This is pure logic — a bounded
# structure + named counters + a frame classifier — with NO transport, NO async, NO BUS, NO physiology.
# It touches neither cpap_stream's ingestion function nor capture.py; the async producer/consumer that
# USES it is a later, announced wiring step (bundled with P1 per the lead's §5a).
#
# THE INVARIANT IT ENFORCES (spec §16, §17): a gap must never disappear silently. Every frame is
# classified, every drop is counted, and the queue is bounded so overnight RAM cannot grow without
# bound — and if a sample is lost to overflow, the loss is RECORDED, never continued past as though the
# stream were complete.
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from enum import Enum


class FrameKind(Enum):
    """How a decoded StreamData frame classifies against the expected stream (spec §16, DATA_PRESENT vs
    DATA_INVALID). The audit's G4: today a foreign-streamId frame is silently `continue`d — here it is
    counted so a stream carrying another stream's data is VISIBLE, not swallowed."""

    OK = "ok"                # a StreamData for our streamId with usable channels
    FOREIGN = "foreign"      # a StreamData whose streamId is not ours (defensive; counted, not silent)
    MALFORMED = "malformed"  # not a StreamData, or missing the fields a batch needs
    EVENT = "event"          # an EventNotification (SubscribeEvent push) — routed to the recorder, counted here
    NOTIFICATION = "notification"  # any OTHER JSON-RPC notification (the device's periodic HeartBeat) — not a loss


def classify_frame(msg, expected_stream_id) -> FrameKind:
    """Classify one decoded notification against the live stream. PURE.

    OK only when it is a StreamData, for our streamId, carrying a non-empty `data` list. A frame for a
    DIFFERENT streamId is FOREIGN (the case `as11_pull.stream` currently drops silently — now countable).
    Anything else (a HeartBeat, a StreamData with no data, a non-dict) is MALFORMED. `msg` is the decoded
    JSON dict; a non-dict or a missing method is MALFORMED, never an exception."""
    if not isinstance(msg, dict):
        return FrameKind.MALFORMED
    if msg.get("method") == "EventNotification":
        # A device PUSH the box asked for (cpap_events). It is neither a batch nor a defect; it is
        # counted as its own kind so an event-heavy night is visible in the gap line and never
        # mistaken for a malformed stream. Its params are validated by the recorder, not here.
        return FrameKind.EVENT
    if msg.get("method") != "StreamData":
        # A JSON-RPC NOTIFICATION that is not ours to decode — the device's HeartBeat, or a method this
        # loop has never met. Counted as its own kind and NOT as a loss: measured 2026-09-19 over the 15
        # live sessions on the box, `malformed` was frames_ok/150.0 on EVERY one (5 frames/s × 30 s —
        # one HeartBeat every 30 s), and every one of those went into `total_lost`, so the log claimed
        # 689–1023 "lost" frames per night on a link that had lost none. A frame with no method at all
        # (a response echo, a bare dict) stays MALFORMED — that IS something this loop cannot account for.
        if isinstance(msg.get("method"), str):
            return FrameKind.NOTIFICATION
        return FrameKind.MALFORMED
    params = msg.get("params")
    if not isinstance(params, dict):
        return FrameKind.MALFORMED
    if params.get("streamId") != expected_stream_id:
        return FrameKind.FOREIGN
    data = params.get("data")
    if not isinstance(data, list) or not data:
        return FrameKind.MALFORMED
    return FrameKind.OK


# A sink write at or over this many ms is counted as slow. Anchored to `capture.py`'s
# `_LOOP_LAG_WARN_MS`, NOT picked: that is the size at which a held loop is logged as a stall, so a
# sink write crossing it is one that could have produced one of the 151 stalls measured on 2026-09-18.
# A different number here would measure a different question than the one the gate asks.
SINK_SLOW_MS = 1000.0


@dataclass
class GapCounters:
    """The gap-accounting record (spec §16). Every counter is a category of thing that can go wrong
    between the transport and the sink; a non-zero value is recorded evidence, never a silent loss. This
    is TELEMETRY — it must never enter a ganglior.node-export as a metric or carry an evidence badge as a
    health measurement (the writers.LinkLogWriter discipline)."""

    frames_ok: int = 0          # OK StreamData frames accepted
    samples_ok: int = 0         # total samples pushed from OK frames
    foreign_stream: int = 0     # frames for another streamId (G4 — was silently dropped)
    malformed: int = 0          # non-StreamData / empty / non-dict frames past the read loop
    events: int = 0             # EventNotification frames (SubscribeEvent pushes) — routed, not lost
    notifications: int = 0      # other JSON-RPC notifications (HeartBeat) — expected ~frames_ok/150, not lost
    # THE COST AXIS (WU4/Unit 2, 2026-09-19). What the link carried, so that adding a dataId is a measured
    # marginal — `bytes_json / frames_ok` before vs after — and never a preference. `bytes_wire` is the
    # FIG payload as received (the AES-CBC body: IV + padded ciphertext), `bytes_json` the decrypted
    # JSON text. Both over EVERY frame this loop read, whatever its kind. Radio overhead (FIG header,
    # ATT/L2CAP/LL, the MTU split) is a function of these plus the negotiated MTU, which the connect
    # logs — it is not counted here because this layer cannot see it.
    bytes_wire: int = 0
    bytes_json: int = 0
    overflow: int = 0           # frames dropped because the bounded queue was full (G5)
    # ⚠️ None, NOT 0 — these two have NO DETECTOR, and `0` is a measurement they have not made (§∅).
    # Measured 2026-09-18: nothing anywhere increments either one. A reader of `0` concludes no stall and
    # no post-drop tail occurred; the truth is that neither is looked for. A missing field is visible and
    # a zero is not, which is why the fields stay and the VALUE carries the absence.
    stalls: "int | None" = None            # no-frame-for-timeout stalls (spec §30 STREAM_STALL) — UNMEASURED
    post_drop_tail: "int | None" = None    # frames after a logical link drop (audit §7.3, the ~230 ms tail) — UNMEASURED
    # HOW LONG A SINK WRITE HELD THE LOOP. `stream_to_bus` is a single sequential `async for` — producer
    # and consumer are the same coroutine — so a slow sink stops the loop pulling frames. Measured
    # 2026-09-18: the loop stalls 10-35x/day, median 1502 ms, and 121 of 151 logged stalls fall inside a
    # CPAP stream (1.35/h against 0.14/h outside). That says the streaming path is involved; it does NOT
    # say a sink is the holder, because the loop-lag detector measures the SHARED event loop and cannot
    # name what held it. These two fields are what makes that attributable.
    #
    # ⚠️ None, NOT 0 — an unwired timer must not report a measured zero. A `sink_max_ms` of 0.0 means
    # "timed, and it was fast"; None means no sink write was timed at all (no `extra_sinks` on this
    # stream). That distinction is the `int(summary.get(k) or 0)` defect this module already carries a
    # fix for, and it would be trivially reintroduced by defaulting these to 0.
    sink_max_ms: "float | None" = None    # slowest single sink write, ms — None until one is timed
    sink_slow: "int | None" = None        # sink writes at or over SINK_SLOW_MS — None until one is timed
    sink_errors: int = 0        # durable-record write failures (INV9): the batch reached the bus but a
    #                             sink write raised. A DISTINCT class — its consumer is restart
    #                             reconciliation, not stream-loss accounting — so it is NOT in total_lost.

    def note_frame(self, kind: FrameKind, n_samples: int = 0, *, wire_bytes: int = 0, json_bytes: int = 0) -> None:
        """Fold one classified frame into the counters. `n_samples` counts only for an OK frame; the byte
        sizes count for every kind (a HeartBeat costs airtime too)."""
        self.bytes_wire += wire_bytes
        self.bytes_json += json_bytes
        if kind is FrameKind.OK:
            self.frames_ok += 1
            self.samples_ok += n_samples
        elif kind is FrameKind.FOREIGN:
            self.foreign_stream += 1
        elif kind is FrameKind.EVENT:
            self.events += 1
        elif kind is FrameKind.NOTIFICATION:
            self.notifications += 1
        else:
            self.malformed += 1

    def note_sink_write(self, ms: float) -> None:
        """Fold one sink write's duration in. Call it for EVERY write, not only slow ones — a maximum
        over an unknown denominator cannot be read.

        `sink_slow` counts writes at or over `SINK_SLOW_MS`, because the maximum alone answers the
        wrong question. The gate asks whether a sink ever holds the loop for ~1.5 s, which is the
        measured stall median; a max tells you the worst write on the worst night, while a max plus a
        count tells you whether it is a mechanism or an outlier."""
        if self.sink_max_ms is None or ms > self.sink_max_ms:
            self.sink_max_ms = ms
        self.sink_slow = (self.sink_slow or 0) + (1 if ms >= SINK_SLOW_MS else 0)

    @property
    def total_lost(self) -> int:
        """Frames that did not become samples for a reason worth surfacing. Foreign frames are NOT loss
        (they were never ours).

        ⚠️ SUMS ONLY TERMS THAT CAN MOVE, and `lost_coverage` says which. This read
        `overflow + malformed + post_drop_tail` while two of the three had no writer, so it was
        identically `malformed` — a decode-loss number documented as "the honest 'how much did we miss'
        number" and therefore read as covering transport loss too. Summing an unmeasured term does not
        make the total more complete; it makes the total a lie with more addends.
        """
        return self.overflow + self.malformed

    @property
    def lost_coverage(self) -> "list[str]":
        """The loss categories `total_lost` does NOT cover, because nothing measures them yet.

        Published beside the total so a reader can tell an honest partial from a complete one. Empty
        means the total is complete — which is the state this field exists to let us reach, and to make
        the reaching of it visible."""
        return [n for n in ("stalls", "post_drop_tail") if getattr(self, n) is None]

    def summary(self) -> dict:
        """A flat dict for a sidecar row / status line. Stable key order so a reader diffs two nights."""
        return {
            "frames_ok": self.frames_ok,
            "samples_ok": self.samples_ok,
            "foreign_stream": self.foreign_stream,
            "malformed": self.malformed,
            "events": self.events,
            "notifications": self.notifications,
            "bytes_wire": self.bytes_wire,
            "bytes_json": self.bytes_json,
            "overflow": self.overflow,
            "stalls": self.stalls,
            "post_drop_tail": self.post_drop_tail,
            "sink_errors": self.sink_errors,
            "sink_max_ms": self.sink_max_ms,
            "sink_slow": self.sink_slow,
            "total_lost": self.total_lost,
            # What the total does NOT cover. A consumer that ignores this reads a partial as complete.
            "lost_coverage_missing": self.lost_coverage,
        }


@dataclass
class BoundedIngestQueue:
    """A bounded FIFO between the transport callback and the raw sink (spec §17). When full, `offer`
    DROPS the incoming item and counts the overflow (spec: 'if data is lost because of queue overflow,
    record the loss explicitly — do not silently continue as though the stream were complete'). RAM is
    bounded by `capacity`, so an overnight run cannot grow without bound.

    PURE + synchronous by design: the async producer/consumer that wraps it (wiring step) drives
    `offer`/`drain`; keeping the structure sync makes the backpressure logic 100%-branch-testable with no
    async test machinery. `counters` is shared with the ingest so overflow lands in the same record as
    the frame classification."""

    capacity: int
    counters: GapCounters = field(default_factory=GapCounters)
    _q: deque = field(default_factory=deque)
    max_depth: int = 0

    def __post_init__(self):
        if self.capacity < 1:
            raise ValueError(f"BoundedIngestQueue capacity must be >= 1, got {self.capacity}")

    @property
    def depth(self) -> int:
        return len(self._q)

    def offer(self, item) -> bool:
        """Enqueue `item`. Returns True if accepted, False if DROPPED because the queue was full — and a
        drop increments `counters.overflow` so the loss is recorded, never silent. Tracks max_depth for
        the health surface (spec §29)."""
        if len(self._q) >= self.capacity:
            self.counters.overflow += 1
            return False
        self._q.append(item)
        if len(self._q) > self.max_depth:
            self.max_depth = len(self._q)
        return True

    def drain(self) -> list:
        """Remove and return every queued item in FIFO order (the consumer's batch). Leaves the queue
        empty; max_depth is retained as a high-water record."""
        out = list(self._q)
        self._q.clear()
        return out
