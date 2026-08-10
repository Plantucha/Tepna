<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [GlucoDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Reach glucodex's whole analysis pipeline with the equivalence prober, and bootstrap the last cheap
zero-kill function.

Of 516 survivors the five existing families claimed ~190. The rest sit in functions the module does
not export — clean, detectSessions, dawnPhenomenon, nocturnalHypo, excursions, postprandial, agp,
perDay, tierOf, correlateNutrition — and every one is called by analyze(), which IS exported, with
genSynthetic supplying the input.

A family's `fn` names the function whose LINE RANGE decides which survivors it claims and which kills
serve as controls, not the function the probe calls. So one 50-input pipeline probe is registered once
per pipeline function. Registered as a single `analyze` family it would have classified 13 survivors
and left ~165 untouched while reporting a clean run.

Result: every control separated (12/12, 9/9, 6/6, 5/5, 11/11 …) and ZERO of the 166 pipeline
survivors are equivalent. The classification lever is exhausted for this file; the remaining debt is
real gaps and only tests move it. Two further zero-kill functions surfaced (correlateNutrition 3,
perDay 1).

applySessionCorrections — the last cheap zero-kill function — converts at 7 of 8, the best in the
programme, verified by re-applying each of its eight surviving mutants. It took three passes, each
blocked by an assertion coarser than the mutant: sessions at 90/110/130 instead of genSynthetic's
near-identical levels (offsets [+20,0,-20] rather than [1,0,-1]); levelling ON with de-drift OFF over
a ramp, the only shape that reaches the `deDrift && driftPerDay != null` branch; and the record
minimum rather than a daily median for the Math.max(20, v) floor.
