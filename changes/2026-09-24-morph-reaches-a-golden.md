---
bump: minor
type: added
brief: none
---
ECGDex's ectopy figures now reach a golden, so a regression in them can redden CI.

They were computed, rendered, and selected into **nothing**. `morph` rides through the reshape and stopped at the export boundary, so `pvcBurden`/`ectopyBurden` appeared in no fixture and no regeneration of them could ever move.

That is not a cosmetic gap. The artifact-gate defect fixed in #3002 made the owner's own 2026-09-22 night report **2,767 PVCs and 42 ventricular runs from a strap lying off the body** — and because the burdens reached no golden, **nothing in CI could have reddened, before the defect or after the fix**. Closes the remedy named in residue row `2026-09-24-the-corpus-cannot-falsify-a-refusal-fix`.

**The metricIds are the registry's, not invented.** `ectopy` is its burden metric (label "Ectopy", `measured` tier, and its alias table already resolves *"pvc burden"* → `ectopy`); `pvc` is the count in beats. A `pvcBurden` metricId would have been a fabricated metric identity, which §🎫 forbids and which this node has paid for before. The resolver leg is what proves it rather than my say-so: it reports **5/0**, so all five blocks resolve against the registry — an invented id would have surfaced as *unresolved*.

⚠️ **A burden's denominator is not the HRV one.** `quality.n` on the HRV blocks is `nBeats`, the beats that survived confidence-dropping for HRV; a burden is rated over `beatsAssessed`, the beats the **classifier** could judge. Publishing the HRV count beside a burden would misstate its basis — the exact error #3002 exists to end — so the ectopy blocks carry their own `quality`, including `unassessedBeats` and `artifactMaskedBeats`.

⚠️ **The count 3 was the invariant in six places**, and each was reconciled deliberately rather than by editing one constant: the ids array, the light-export check, the resolver totals (twice), a fusion node card, and a plant assertion phrased in prose as *"the other two resolved"*. That is `gates-that-assert-a-plural` in the flesh — a gate that pins a count has encoded today's shape as the contract.

Additive: existing blocks and values are untouched, and `mk()` already drops a non-numeric value, so a night whose burden is null simply carries no block — "unmeasured ⇒ no block", which is the function's own rule.
