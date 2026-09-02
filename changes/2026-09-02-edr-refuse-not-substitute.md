<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ecgdex]
brief: DEEP-AUDIT-VI-FOLLOWUPS-2026-09-02-BRIEF.md
---
FOLLOWUPS §1.10 — `respFromEDR` stacked TWO unmarked substitutions behind a surfaced number: no
dominant EDR period ⇒ echo the Lomb `respHint`; hint out of range ⇒ the constant **15**. The first is
self-contradictory (the method's own comment says the rate is measured *"not echoed from the Lomb
hint"*), and the second is the constant §1.5 measured as OUTSCORING the estimator it stands in for.
Neither was marked, so a reader could not tell a measured 15.0 from the substituted one.

- **Refuses now**: `respFromEDR = null` + `respFromEDRReason`, carried into the export; both app
  surfaces render "no estimate" (the pill previously printed `null br/min`).
- **`f0` deliberately unchanged** (0.25 Hz analysis centre) so `crcPLV`/`couplingStrength` do not
  move inside a unit about the breath rate. Whether a PLV at an assumed centre is quotable is filed
  as §1.11, not answered here.
- **Committed adversarial twin** `synthetic_ecgdex_flat_edr.txt` (§2.1: no committed input took the
  branch, so "no fixture moved" would be silence). Clean-twin morphology, periodic drivers removed,
  beats quantised to exact sample boundaries. Pre-fix returns 11.1 on it; current returns null.
  Two failed constructions recorded in the group so nobody retries them (broadband noise → 19.9;
  noiseless un-quantised → 7.4). Input-only twin: the assertion is an invariant, not a byte pin.

🔴 **Corrects §1.5's published figures.** §1.5 excluded both exactly-15.0 nights as fallbacks using
`=== 15.0` — the very test it flagged as unable to separate them. Against the fixed code only
**2026-07-02** refuses; **2026-07-06 measures** 15.0. n 22 → **23**, MAE 1.90 → **1.82**, LoA width
9.58 → **9.41**, constant-15 control 0.80 → **0.77**. Both bands still fail, the constant still beats
the estimator, the `experimental` re-tier stands — the registry stamp is corrected here.
