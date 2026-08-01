<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [Integrator]
brief: OXYDEX-PB-OVERCALL-2026-07-31-BRIEF.md
---
§4 item 4 asked whether OxyDex's always-on `periodic_breathing` channel inflates an Integrator corroboration count, and allowed "shown inert" as an answer. **It is not inert.**

`tools/pb-fusion-blast.mjs` drives the SHIPPED `adaptEnvelopeNode` + `fusePeriodicBreathing` in a co-loaded realm over the 24 nights where a trio OxyDex export pairs with a CPAPDex one:

| | |
|---|---|
| OxyDex emits `periodic_breathing` | **23 / 24 (96 %)** |
| `fusePeriodicBreathing` corroborates | 3 / 24 |
| …still corroborates with the **OxyDex leg removed** | **0 / 24** |
| block `conf` on those nights | 0.86 · 0.86 · 0.858 |

**The measurement had to be a counterfactual.** "Corroborated on 3 of 24 nights" reads *conservative* and answers nothing; the informative quantity is how many survive removing the always-on observer and changing nothing else. None do. `corroborated` is `nObservers >= 2`, so with one leg on 96 % of nights it is arithmetically a one-observer rule wearing a two-observer label — and the other observer here is the CPAP's own PB scoring, the rater the parent brief measured κ = −0.039 against. The KPI publishes `nObservers` as its headline with *"signals corroborate"* underneath; the leg also joins the noisy-OR at 0.5 × 0.6 = 0.30, lifting a device-only 0.80 to 0.86 on every block it touches.

**Bounded, and one leg was NOT measured.** `fuseApneaEvents` pools by impulse over `desat_event`/`spo2_desaturation` only, so `periodic_breathing` reaches neither the confirmed-apnea rule nor `confirmedAHI` — §3.4's analogy to the double-counted apnea index does not extend. The ECGDex cardiac-CVHR leg is **unexercised, not inert**: it reads `apnea.cvhrIndex` and 0 of 24 committed trio ECGDex exports carry an `apnea` block, but that block landed 2026-07-23 (`11091ef`) *after* the corpus was generated (2026-07-12). Corpus staleness, and reported as such.

**No behaviour changed.** Every remedy (withdraw the leg · stop calling it corroboration · redesign the detector) is the same user-facing surface decision the brief's §5.4 already routes to the owner, and withdrawing the leg silences the fused finding entirely on this corpus with no measured compensating gain. So this lands the measurement plus a **characterization** gate — a metamorphic pair holding the OxyDex leg identical and firing while toggling only CPAPDex, plus the 0.80 → 0.86 uplift as a number — labelled as characterization in source so nobody reads it as an endorsement.

Mutation-verified both directions: dropping `'OxyDex'` from `_pbObserver`'s node test reds the corroboration assert; `PB_TIER_WEIGHT.experimental` 0.6 → 0.3 reds the uplift assert (0.86 → 0.83) and the tool's own `--selftest`. Tests + tools only — no bundled source touched, so no `manifestHash` moves and no fixture is re-recorded.
