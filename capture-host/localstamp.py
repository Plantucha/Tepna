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
"""

from __future__ import annotations

from datetime import datetime


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
        self.ambiguous = 0             # stamps that had two candidate instants
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
