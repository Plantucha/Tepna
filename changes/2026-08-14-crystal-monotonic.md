---
bump: patch
type: fixed
brief: PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md
---

The O2Ring device-crystal axis ran BACKWARD — 1548 times on one 5.9 h night, worst -336.62 ms, -20.4 s
of backward time in total — on the DEFAULT path for every O2Ring finger recording. Worse, the same
mechanism was SUPPRESSING REAL DROPOUT DETECTION.

MECHANISM, measured rather than inferred. The crystal path rebuilds `relSec` by counting real ADC
samples at 125.000 Hz and re-anchoring to the host at each genuine loss. The re-anchor snapped to the
host's ABSOLUTE value, which assumes the host is ahead. It is not: this file's ns column is DRAWN at
~127.51 rows/s while the true row rate is 125.000 + HR/60 ~ 125.9, so host time under-counts by ~1.3 %
and the crystal gains ~64 ms per 5 s segment. Every re-anchor then dragged the axis back by whatever it
had gained. The host-disciplined path shows zero backward steps; only the crystal path is affected.

INVISIBLE TO EVERY GATE. `intervalsSpanningTimeGap` tests `relSec[i] - relSec[i-1] > maxStep` — strictly
greater — so a NEGATIVE difference is never counted at any magnitude, and the fast path
`if (run === 0) return out;` then returns all-false through the branch documented as the clean case.

THE SECOND HALF IS WORSE THAN THE FIRST, and it is why this is a correctness fix rather than tidiness.
Because the crystal ran ahead, the shortfall was being subtracted from genuine losses. On 2026-07-27 the
host observed 8 dropouts and the crystal reported 3 — with one 353 ms dropout appearing as time running
BACKWARD by 47 ms. Post-fix the crystal recovers all five and matches the host to the millisecond
(322/322, 329/329, 353/353, 351/351, 375/375).

A FIRST FIX MADE IT WORSE AND IS RECORDED SO IT IS NOT RETRIED. Guarding with
`max(relSec[i], rc[i-1] + 1/fs)` removes the backward time and satisfies monotonicity — while shrinking
every genuine gap by whatever the crystal had gained. Measured: two real losses fell 455 -> 281 ms and
337 -> 233 ms, i.e. below the 314 ms detector and out of the gap count entirely. Trading fabricated
backward time for undetected dropouts is not a fix, and monotonicity alone cannot tell the difference.

THE FIX advances by the host's OBSERVED gap from the crystal's own position —
`segAnchorSec = rc[i-1] + (relSec[i] - relSec[i-1])`. Monotone by construction (the difference exceeds
`maxStep`), and it reproduces the loss duration exactly instead of discarding the crystal's accumulated
time. Verified over five nights: 0 gaps lost, 0 fabricated, 5 real dropouts recovered on the one night
that had been hiding them.

The night's span moves 5.874 -> 5.950 h, which is the correct consequence: ~20.4 s of backward time is
no longer cancelling the crystal's accumulation, and the axis now counts real ADC samples rather than
riding a drawn column whose assumed rate is 1.3 % too high.

Export-inert on the committed set — 195/195 equivalence assertions against the real corpus, and no
PpgDex golden moves — because no committed fixture reproduces the geometry. That is exactly the gap the
new gate closes: it took THREE fixture attempts to make both assertions bite, because host-only jitter
is absorbed by the running-median correction (which is what the median is for), so the step has to sit
in the DEVICE column to reach `relSec` at all. Against main the group fails 3 of 5; against the rejected
snap-fix it fails on the gap assertions alone, so the test separates the two wrong answers rather than
merely rejecting the original.

ROOT CAUSE IS UPSTREAM AND NOT FIXED HERE: the drawn ns axis assumes ~127.51 rows/s where the documented
true rate is ~125.9. This change makes the node robust to that; it does not correct the capture-side
rate assumption.
