---
bump: patch
type: fixed
brief: none
---

The O2Ring dumps its buffer on reconnect, so the offset (`hostElapsed − devElapsed`) STEPS — three
times on 2026-09-28 — and a single host axis across those steps read them as −3575 ppm of drift that
never happened. PpgDex now splits the anchor series where the offset steps beyond a bound pre-stated
from four independent 2026-09-19 nights, and runs one host axis PER SEGMENT: within a segment the
correction is byte-identical to today, and no axis spans a step. Per-segment ppm is a diagnostic
published only where the segment can carry one; a segment too short, too sparse, or holding a
sub-bound replay reports `rate: 'unknown'` with the numbers that refused it.
