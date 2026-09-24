---
bump: patch
type: fixed
brief: none
---
GVP is a **path length**, so an unguarded step drew a straight line through hours the sensor never saw and counted it as travelled.

`gvp` checked `_ana(c, i)` but differenced against `c.gV[i - 1]`, which could be `WARMUP`, `COMPRESSION` or `GAP_LONG`. Its three siblings that difference against an earlier cell — `conga`, `modd`, `magRate` — all guard **both** endpoints. `gvp` was the only one of four that did not, and nothing in the suite noticed.

**The magnitude depends on what the gap hides, and the first version of this note overstated it.** Probed on a 2-hour hole with no level change across it, the metric moves `10.3 → 10.4` — essentially nothing, because the gap is interpolated and the straddling step contributes about `dtMin` either way. Probed with a **150 mg/dL shift hidden inside the same hole**, the old code reported **1.0** where the honest value is **0.7** — a 43 % overstatement. The twin asserts the invariant that follows: the two real segments carry the same waveform, so *a level change the sensor never saw cannot change the variability of the data it did see*.

**The basis is now published and wired, not computed and dropped.** `gvpPairs`/`gvpComparable` reach the node-export beside `gvp`, and the KPI tile the survey row actually complained about now reads `path-length var · 190/215 steps`. The first version of this fix computed the counts and stopped there — the regen reported `0 fixtures moved`, which was not a clean pass but evidence the numbers reached nothing. Both consumers are gate-asserted so the wiring cannot rot back into decoration.

The committed fixtures corroborate it independently: the real corpus night sits at 8094/8166 (99.1 %), and `synthetic_glucodex_gap_golden` — the fixture built to contain a gap — is the one that drops to 695/863 (**80.5 %**).

⚠️ **`glucodex-app.js` had the same shape one layer up, and worse than the survey filed it.** `r.mage || 50` fed an **uncomputed** MAGE into the glycemic-variability score as a mid-range 50 — but `mage()` returns `round(sd, 0)` when no excursion exceeds 1 SD, so a **real MAGE of 0**, the flattest trace possible, also became 50, inverting the metric it stood in for. That score reaches the export as `glycemicVariabilityScore`, the IR risk band, and a ganglior event's confidence. An absent term is now dropped and the weights renormalise over 0.65 — the shape `autoRisk` above already used. When MAGE is present the arithmetic is byte-identical, which is why no fixture's `gvp` or score moved.

The gate scans the **shape**, not the line: every loop differencing against an earlier cell must guard both endpoints, and it names the offender's line number. It reads a comment-stripped copy of the source — the first draft failed against its own fix, because the `§∅` comment explaining the defect quotes `r.mage || 50` verbatim.

Additive only: all four goldens moved by exactly the two new keys; no `gvp` value and no other field changed. Reverting both files reds 9 of the 11 original assertions, with the shape gate naming line 920.
