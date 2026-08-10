<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [GlucoDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
A glucodex battery — 23 classifications, and a function with 90 survivors and ZERO kills that no probe can ever classify.

Sixth file in `tools/mutate-equivalence.json`. Full sweep: 836 tested, 280 killed, 5 invalid,
551 survivors → 33.7 % (canary NONE).

⚠️ THE FLEET MAP'S ROW FOR GLUCODEX IS WRONG — it reported 55 % from a 60-mutant sample against a
33.7 % population, 3.5 SE away, which is not sampling noise. Three earlier files had confirmed the
method; this is the first refutation, and the map's unswept rows should be read as estimates.

Sound families:

  detectClampSaturation  12/12 controls  35 survivors → 12 distinguishable, 23 recorded
  coreMetrics            10/10 controls  12 survivors → 12 distinguishable,  0 recorded

`coreMetrics` returning TWELVE distinguishable and zero equivalents is worth noting on its own: every
survivor there is killable, so that function is pure test debt rather than unobservable code.

⚠️ `genSynthetic` — 90 SURVIVORS AND NOT ONE KILL, WHICH MAKES IT UNCLASSIFIABLE BY CONSTRUCTION.
The engine needs a positive control from the same function: a mutant the suite KILLED, replayed to
prove the battery reaches the code. `genSynthetic` has none — the suite kills nothing in it — so the
run reports NO CONTROLS and withholds every verdict, even though the battery plainly reaches it
(52 distinct answers over 53 inputs).

That is a bootstrap requirement the programme had not articulated: A FUNCTION WITH ZERO KILLS CANNOT
BE CLASSIFIED AT ALL. Someone must first write one test that kills one mutant; only then can the
other 89 be probed. It is the correct behaviour — an unreached mutant is indistinguishable from an
unkillable one — but it means "0 % killed" and "100 % equivalent" are indistinguishable to the tool,
and the only exit is a test.

Still blind, diagnosed:
  parseCSV        1/5 controls — the CGM row format is wrong; locateColumns is not matching my header.
  parseNutrition 11/12 — L1730's `c[ci.date]` row-skip guard is unexercised by any current case.

Every contract in this battery was READ from the source before writing — genSynthetic's three real
options (days/profile/cadence), parseNutrition's substring header matching, detectClampSaturation's
n<20 guard and its pile-up-vs-thinning-tail test. The cpapdex battery cost two rounds by guessing.

Ledger: clock 3 · ppgdex 41 · hrvdex 69 · motiondex 42 · cpapdex 8 · glucodex 23 = 186 on this branch
(cpapdex's other 18 are in #1123).
