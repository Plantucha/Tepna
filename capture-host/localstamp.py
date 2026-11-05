# tepna-capture — localstamp.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""A NAIVE LOCAL civil stamp → epoch ms, with the DST fall-back hour resolved by CONTINUITY.

`Phone timestamp` is written as naive local civil time (`writers._phone_ts` — "Do not pass a UTC
instant"; the write site passes `_now()`), while the device columns count nanoseconds from
2000-01-01 UTC. Converting local → epoch is therefore correct and required. What was unguarded
(residue 2026-09-13-dst-fallback-splits-the-host-axis): for exactly one hour a year the conversion is
AMBIGUOUS — on the fall-back night the wall clock passes 01:00–02:00 twice — and Python resolves a naive
stamp with `fold=0`, so the second pass reads as the first and the host axis steps BACKWARDS by an hour
INSIDE the series while the device counter marches on. "Only deltas are consumed downstream" is true
for a constant offset and false at the seam, because the seam is not an offset, it is a step.

The box runs `America/New_York`; the next fall-back is 2026-11-01, and this code has never been
through one. Owner ruling 2026-09-21 (relayed): remedy (a) — resolve the ambiguous hour locally, in
the readers, by picking the fold that keeps the series continuous. No format change.

THREE RULES, in order of authority, each used only when the one above cannot decide:
  1. host − device continuity — when the row carries a UTC-anchored device stamp and a previous
     row established the offset, the fold whose `host − device` stays nearest the previous offset
     wins. The device counter does not know about DST, so it is the tiebreaker.
  2. host monotonicity — with no device stamp, the fold that does not step BACKWARDS from the
     previous host stamp. A series continuous through the seam has exactly one such fold.
  3. `fold=0` — a file whose FIRST row is inside the repeated hour, with nothing to compare against.
     That is the same answer as before this module existed, and `ambiguous_unresolved` counts it so a
     night that started in the seam is visible rather than silently guessed at.

Outside the repeated hour both folds give the same instant and every rule is a no-op — measured by
the tests on a non-DST zone, where the resolver must be exactly `datetime.timestamp()`.

THE WRITER DIRECTION — `CivilFrame`, residue 2026-11-04-one-sessions-sidecar-and-sample-stream-end-an-hour-apart.
Resolving the fold gives a reader the right INSTANT, and that is not enough when a session's two files
label the same instant differently. `capture._now()` ABSORBS a DST relabel to protect an open
recording, so sample stamps keep counting in the session's ORIGINAL offset (`capture.py` §A1 rule 1).
A writer that renders each row with `datetime.fromtimestamp` instead FOLLOWS the zone, so its file
rewinds 3600 s mid-night and its post-seam tail sits an hour away from the sample stream it belongs
to. Measured over one archived session: the two files end at 06:44 and 05:44, and 62684 of 105694
sidecar rows carry a moved skew. `CivilFrame` gives such a writer the same discipline without a
format change or a cross-process read: ONE offset, anchored at the run's first row, for every row the
run writes.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone


def fold_candidates_ms(dt: datetime) -> tuple[float, float]:
    """`(fold=0, fold=1)` epoch milliseconds for a naive local `dt`. Equal except inside a repeated
    hour, where they differ by exactly the offset change (3 600 000 ms for a one-hour fall-back)."""
    return (dt.replace(fold=0).timestamp() * 1000.0, dt.replace(fold=1).timestamp() * 1000.0)


class LocalStampResolver:
    """Per-series state: the previous host stamp and, when a device stamp rides along, the previous
    `host − device` offset. Keep ONE per stream — mixing streams would let one stream's offset decide
    another's fold."""

    __slots__ = ("prev_host_ms", "prev_offset_ms", "ambiguous", "ambiguous_unresolved")

    def __init__(self) -> None:
        self.prev_host_ms: float | None = None
        self.prev_offset_ms: float | None = None
        self.ambiguous = 0  # stamps that had two candidate instants
        self.ambiguous_unresolved = 0  # ...of which nothing could decide, so fold=0 was taken

    def resolve_ms(self, dt: datetime, dev_ms: float | None = None) -> float:
        a, b = fold_candidates_ms(dt)
        if a == b:
            host = a
        else:
            self.ambiguous += 1
            prev_offset = self.prev_offset_ms
            if dev_ms is not None and prev_offset is not None:
                host = min((a, b), key=lambda h: abs((h - dev_ms) - prev_offset))
            elif self.prev_host_ms is not None:
                host = a if a >= self.prev_host_ms else b
            else:
                self.ambiguous_unresolved += 1
                host = a
        self.prev_host_ms = host
        if dev_ms is not None:
            self.prev_offset_ms = host - dev_ms
        return host


def _utcoffset_at(epoch_s: float) -> timedelta:
    """The local zone's UTC offset at an instant, as local civil MINUS UTC civil.

    Read from the instant, never from `now()`: a run that starts before a transition and a row that
    arrives after it must get DIFFERENT answers, which is the comparison `CivilFrame` turns on. The
    subtraction avoids `utcoffset()`, whose `None` return is unreachable on an aware value and would
    leave a branch no test can take under a 100 % floor. An INSTANT is never ambiguous — the repeated
    hour is a property of the civil label, so `fromtimestamp` resolves the second pass to the second
    offset by construction."""
    return datetime.fromtimestamp(epoch_s) - datetime.fromtimestamp(epoch_s, tz=timezone.utc).replace(tzinfo=None)


class CivilFrame:
    """Epoch seconds → NAIVE LOCAL civil time in ONE anchored UTC offset.

    The inverse of `LocalStampResolver`, and the reason both live here: one module owns the DST
    discipline in both directions. Anchor the frame on the first row of a run and render every later
    row through it. Inside the frame a fall-back night is CONTINUOUS — the stamps run on past
    `02:00:00` in the pre-seam offset rather than repeating `01:00:00` — which is the same thing
    `capture._now()` does for the sample streams, so the two files stay joinable by civil stamp.

    🔴 NOT A CLAMP, AND NOT A CORRECTION OF THE ARCHIVE. A file already written is immutable; this
    changes what the NEXT run writes. `shifted_rows` counts the rows rendered while the live zone
    disagreed with the frame, so a night that went through a transition says so in the telemetry
    instead of being silently reframed."""

    __slots__ = ("anchor_epoch_s", "offset", "shifted_rows")

    def __init__(self, anchor_epoch_s: float) -> None:
        self.anchor_epoch_s = anchor_epoch_s
        self.offset = _utcoffset_at(anchor_epoch_s)
        self.shifted_rows = 0

    def civil(self, epoch_s: float) -> datetime:
        """The naive civil stamp for `epoch_s` in the anchored offset."""
        if _utcoffset_at(epoch_s) != self.offset:
            self.shifted_rows += 1
        return (datetime.fromtimestamp(epoch_s, tz=timezone.utc) + self.offset).replace(tzinfo=None)

    def telemetry(self) -> dict[str, float]:
        """What the run reports about its own frame. `offset_s` names the frame the file is IN, which
        a reader of the telemetry needs in order to convert the stamps back to instants.

        `anchor_epoch_s` rides along because the offset alone does not say WHICH instant chose it. A
        reader comparing two runs of one night needs the anchor to tell a frame set before the seam
        from one set after it. It also keeps the attribute OBSERVABLE: an attribute nothing reads is
        dead weight, and the diff-scoped mutation gate reports it as a survivor rather than guessing."""
        return {
            "anchor_epoch_s": self.anchor_epoch_s,
            "offset_s": self.offset.total_seconds(),
            "shifted_rows": float(self.shifted_rows),
        }
