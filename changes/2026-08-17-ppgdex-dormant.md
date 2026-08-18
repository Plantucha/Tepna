<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [PpgDex]
brief: none
---

`dormant: true` on the 21 pre-declared per-site morphology entries in `ppgdex-registry.js`, plus a gate
that asserts the flag means what it says in BOTH directions.

THE MEASUREMENT THAT PROMPTED IT (a fleet metric-surfacing audit, 2026-08-17): 466 registry metrics
across 9 nodes were checked id-, label- and alias-aware against every render/app/src/guide surface. 24
are genuinely unsurfaced, and 21 of those are one block — the `dicrotic/ai/reflectionIdx/sdppgBA/
agingIdx/notchTime/pulseWidth x Finger/Ankle/Assumed` grid. That is 32 % of this node's registry, fully
graded and cited, computed by nothing and carded nowhere.

They are DORMANT BY DESIGN, not dead: the registry pre-declares them so the per-site split inherits a
reviewed tier instead of inventing one at the point of use, and the block carries a rationale (the ring
AC-couples and gain-normalises on-device, so shape metrics sit below the wrist grade until the
tri-device corpus validates them). The defect was that NOTHING MACHINE-READABLE SAID SO. A dormant grade
can drift — a fleet tier sweep, a copy-paste from a live sibling — and no gate could see it, because
there is no card for the grade to disagree with. Today's fleet badge work hit the same shape from the
other end: unregistered labels fell through to a fabricated `experimental` default, right for the wrong
reason.

DORMANT IS NOT A TIER. Every flagged entry keeps its real `evidence` and its citation, so promotion is
REMOVING the flag when the metric ships, never re-grading it — the failure being that a parked metric
quietly becomes `heuristic` and then ships at that grade.

Gated by `ppgdex · dormant-registry` (7 assertions, both lanes). The population is asserted BY VALUE
(exactly 21) so a refactor that dropped the block cannot leave the group passing vacuously over an empty
set. Both directions are pinned: a dormant metric has no guide card, AND nothing carded is parked as
dormant — without that mirror, `dormant` could be sprayed onto anything to silence the check. Verified
RED by value under two mutants: un-flagging one entry reds the count (20 != 21), and flagging a LIVE
carded metric (`dicrotic`) reds THREE assertions including the load-bearing no-card one.

PROVENANCE CHAIN, per §🔏 — the registry is inside PpgDex's compute closure, so this is not inert:
`build:check` flagged the drift, `build.mjs --app PpgDex` moved manifestHash f30858ea2b61 ->
3fe3920ed62c, `computeHash` moved bf9e1d1f8bd8 -> 30037af74bb4, and `verify-fixtures --check` named the
debt by fixture. Discharged rather than asserted: `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs`
re-ran the app against the real corpus, the suite came back green, and
`PpgDex_2026-06-27_equiv.node-export.json` was re-stamped to 30037af74bb4 by the only tool allowed to
write `verifiedUnder`. `OverDex.html` did not move — the registry is not inlined there — so no
orchestrator serialisation.

Coordinated: Brief runner holds the PpgDex lane and explicitly ceded `ppgdex-registry.js`, then cleared
`tests/dex-tests.js` after I flagged that the gate line had nowhere else to live.
