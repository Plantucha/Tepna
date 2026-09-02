<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [pat-tools]
brief: ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF.md
---
`pat-feasibility-worker.js` evaluates the promotion gate a second time on ACC-corrected drift and
publishes `vdCorr` — and **no consumer ever read it**. `pat-feasibility.js` composed its verdict cell
from `m.vd` alone, so the corrected verdict was computed, carried across the worker boundary, and
dropped at the last step. Computed, carried, never consumed.

🔴 **This corrects a CHANGELOG claim that the fix already shipped.** The v-history entry
*"Single-source the PAT promotion gate into `pat-gate.js` and stop discarding the ACC-corrected
verdict"* was true of the worker and false of the surface. That line is the most damaging of the
three artefacts asserting this, because it does not merely mislead — it **forecloses**: a reader who
greps it stops looking, which is how the gap survived with three artefacts describing it. The
CHANGELOG itself is tool-owned (`tools/release.mjs` folds changesets into it), so the correction is
recorded here rather than by hand-editing shipped history.

Ranked by damage, the three artefacts were: **the CHANGELOG line (claims done)** > `pat-gate.js`'s
*"Nothing is silently discarded"* (claims an invariant that was false from the day it was written) >
`ENGINE-VERIFICATION-FINDINGS` Phase 3 (**true but incomplete** — "publishes `vdCorr`" was accurate;
nothing said whether anything read it, so that one is amended rather than corrected).

⚠️ **The raw primary verdict is NOT the defect and is unchanged.** Both `pat-gate.js` and the worker
state in as many words that leaving the tier on raw drift is deliberate and that promoting on
corrected drift is *"a scientific call for the owner, not a refactor"*. So a night whose corrected
drift clears 60 ms still reports its raw tier — intended. What was broken is the promised SECOND
report never reaching a surface, which is exactly what made "nothing is silently discarded" false.
This surfaces it and decides nothing.

`PATGate.verdictCell(m)` now composes the cell — pure, beside the gate, and reachable. It had lived
inline in `pat-feasibility.js`, an anonymous IIFE with **no export surface**, so no test could touch
it: `dex-tests.js` referenced the worker 5 times and the renderer **0**. That asymmetry is the
mechanism, not a coincidence — a layer nothing reads is a layer nothing checks — so the renderer is
now wired into `env.sources` in **both** runners.

Plant: the behavioural assertions on `verdictCell` (disagreement flagged, agreement stated, absent ACC
sync said plainly, tier untouched) **cannot** fail against unfixed code, because that code has no such
function — the defect was an absent CALL, not a wrong function. So the load-bearing check is a source
scan of the renderer, verified to fail on `origin/main`: it consumes no `verdictCell` (false) and
still composes inline (true), both inverted here.
