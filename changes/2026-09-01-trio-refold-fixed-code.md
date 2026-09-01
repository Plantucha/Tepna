<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: changed
nodes: [trio-corpus]
brief: none
---
Full-corpus trio refold under the fixed code generation (owner-ordered 2026-09-01): 193 exports
re-folded with changed substance, 130 new files across 60 new-or-extended nights (committed corpus
grows to 115 night dirs), 3 stale artifacts removed that current code refuses to produce.

**Why the corpus moved (the point of the refold):** the committed generation predated a run of
behavioral fixes — the periodicity-measuring OxyDex PB detector (#1395: pseudo-episodes → 0, and
`divergePct` follows it arithmetically), FFT "no cycle" honesty (#1383), the CVHR resample-grid
bound (#1800) and its `cardiorespCoupling` sibling (#2030), and the host-axis timing work — so
79 % of comparable exports changed substance, versus 112-of-113 byte-identical at the previous
refold (#1309). The direction is fewer fabricated findings, verified per-mover, not assumed.

**Distribution under the new generation** (tch-multinight, 115 nights, 55 with a σ solution —
was 45): median σ classic ECGDex **0.42** · PpgDex **0.44** · OxyDex **1.02** bpm (the 2026-08-04
fold read 0.56 / 2.71 / 1.11 — the PpgDex leg's collapse is the host-axis + beat-quality work
landing; composition differs, so this is a cohort comparison, not a paired one). All 55 solutions
are post-host-axis — one producing-code generation; the report's "MIXED" banner counts 46 early
no-wearable nights that produce no solution and cannot enter the estimate. 7 nights are excluded
on the correlated fit's non-negativity boundary (σ≈0 by construction, not measurement).

**Removals** (the #1309 "stale artifacts fall out" pattern): `2026-06-19/ECGDex` (merges sessions
whose measured fs disagree — current code refuses the merge), `2026-08-04/ECGDex` (refused under
current code), `2026-07-01/agreement` (the night no longer yields an adjudicable pair). A removal
is the honest state — current code cannot reproduce those bytes.

The three 2026-08-23/26/27 nights fold for the first time ever — they carry the H10 2019-origin
mid-file clock rebase and OOM-killed every previous fold attempt until #2030's span guard.
