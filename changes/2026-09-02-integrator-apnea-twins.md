<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
brief: DEEP-AUDIT-VI-FOLLOWUPS-2026-09-02-BRIEF.md
---
Four committed synthetic twins for the Integrator's apnea chance-null, closing §4.3 — the Integrator's
code-gated real-data surface was a single TCH consensus fixture carrying no `apneaNullModel`.

§4.2b proved the cost rather than argued it: a real behavioural change to the reportability gate landed
and `regen-integrator-goldens` reported **0 fixtures moved**, because nothing committed could express
it. Silence by construction.

Inputs are rebuilt in-code by `tests/apnea-null-twins.js` (seeded, no clock read, `inputHashes:{}`) —
the `tch-golden-inputs.js` pattern, one builder shared by the regen tool and the equivalence gate.
Minted via `newRecord`, code-gated in `provenance/Integrator.json` (`outputHash c72e924109399ee0`), with
8 assertions in both lanes. Historical snapshots untouched.

FOUR twins because the bar was that a mutant must move these bytes. `coupled`/`uncoupled` give the
gate's two directions; `gapped` (a declared 100-min coverage hole) is the ONLY twin that can see the
covered-time shift, since on a single-segment night it is byte-identical to a wall-clock wrap; and
`contended` (desats 12 s apart competing for one surge) is the ONLY twin that can see the null scoring
the published exclusive matching. With two twins those last two mutants were invisible.

MINOR: an additive committed fixture plus its `.gitignore` negation and equiv wiring in both runners.
