<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [CPAPDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Give cpapdex-dsp.js's selfTest a negative control, and pin its assertion count.

122 of this file's 488 mutation survivors — the largest cluster, a quarter of the population — sit
inside selfTest itself. They are mutants of the checking apparatus, not of the code it checks, and
they survived because the gated suite asserted only `fail === 0`.

Two gaps, and the measurement distinguishes them:

1. DELETION. Comment out one `ok(...)` inside selfTest and `fail` stays 0 while `pass` silently drops.
   Demonstrated: the suite read green at 75 passed where it had been 76. The count is now pinned, so
   a self-test that stops checking something reds. Adding or removing an assertion means updating the
   number in the same commit — that edit is the point.

2. WEAKENING. `near(a, b, tol)` is the comparator all 76 other assertions run through, and mutating
   `a != null && isFinite(a) && ...` to `||` — which makes it true for null and NaN — SURVIVED,
   because every value it is asked about is comfortably inside tolerance. A comparator is only caught
   being too permissive by asking it something it must REFUSE. Six negative controls added; all three
   near() mutants now die.

Measured honestly: the pass-count pin alone killed 0 of the 73 still-anchored selfTest survivors, and
that was checked by re-applying each one rather than assumed. The negative controls kill 3. The
remaining 70 mutate individual expected values and tolerances, and each needs its own control.

⚠ One control needed a second attempt for a reason worth recording: `near(10, 10.2, 0.2)` does not sit
ON the tolerance — 10.2 − 10 is 0.19999999999999929, strictly less than 0.2 — so `<=` mutated to `<`
survived a test written to catch it. Halves are exact; the boundary case now uses 10.5 ± 0.5.

Re-bundled CPAPDex plus both orchestrators (they inline cpapdex-dsp.js). computeHash moved
005d90fb40d3 -> 82c9dff9ac8a, so re-verification was owed and was RUN, not asserted:
DEX_UPLOADS=... verify-fixtures re-ran the real 2026-06-12 and 2026-06-16 EDF nights green and
re-stamped verifiedUnder. The outputs did not move.
