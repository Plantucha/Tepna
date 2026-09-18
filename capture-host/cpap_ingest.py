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


def classify_frame(msg, expected_stream_id) -> FrameKind:
    """Classify one decoded notification against the live stream. PURE.

    OK only when it is a StreamData, for our streamId, carrying a non-empty `data` list. A frame for a
    DIFFERENT streamId is FOREIGN (the case `as11_pull.stream` currently drops silently — now countable).
    Anything else (a HeartBeat, a StreamData with no data, a non-dict) is MALFORMED. `msg` is the decoded
    JSON dict; a non-dict or a missing method is MALFORMED, never an exception."""
    if not isinstance(msg, dict):
        return FrameKind.MALFORMED
    if msg.get("method") != "StreamData":
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
    overflow: int = 0           # frames dropped because the bounded queue was full (G5)
    # ⚠️ None, NOT 0 — these two have NO DETECTOR, and `0` is a measurement they have not made (§∅).
    # Measured 2026-09-18: nothing anywhere increments either one. A reader of `0` concludes no stall and
    # no post-drop tail occurred; the truth is that neither is looked for. A missing field is visible and
    # a zero is not, which is why the fields stay and the VALUE carries the absence.
    stalls: "int | None" = None            # no-frame-for-timeout stalls (spec §30 STREAM_STALL) — UNMEASURED
    post_drop_tail: "int | None" = None    # frames after a logical link drop (audit §7.3, the ~230 ms tail) — UNMEASURED
    sink_errors: int = 0        # durable-record write failures (INV9): the batch reached the bus but a
    #                             sink write raised. A DISTINCT class — its consumer is restart
    #                             reconciliation, not stream-loss accounting — so it is NOT in total_lost.

    def note_frame(self, kind: FrameKind, n_samples: int = 0) -> None:
        """Fold one classified frame into the counters. `n_samples` counts only for an OK frame."""
        if kind is FrameKind.OK:
            self.frames_ok += 1
            self.samples_ok += n_samples
        elif kind is FrameKind.FOREIGN:
            self.foreign_stream += 1
        else:
            self.malformed += 1

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
            "overflow": self.overflow,
            "stalls": self.stalls,
            "post_drop_tail": self.post_drop_tail,
            "sink_errors": self.sink_errors,
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
