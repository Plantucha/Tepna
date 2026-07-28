<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [ECGDex]
---
`ECGDex`'s node-export `timeseries.epochs[]` now carries **`motionIndex`** — the per-5-min-epoch chest-ACC activity index, night-normalised (median→0, p95→100).

**The defect it closes.** The index was already being computed, for the ACC-vs-HRV staging vote, and never left that block. So ECGDex published no `motionIndex` at all while PpgDex and OxyDex both do, and the correlated three-cornered-hat's motion-ρ leg ran on **two** corners instead of three. Measured over the 2026-07-16…26 capture corpus, all **11 of 11** nights folded reporting `ECGDex … 0 motion` — with the H10 chest ACC sitting in `rec.deviceACC` the whole time.

**Built at function scope, not inside the vote loop.** That loop `continue`s whenever the HRV stage for an epoch is missing, so an epoch the accelerometer genuinely observed was dropped because the *stager* had no opinion about it. A motion observation does not depend on the stager; gating the two together is what made an available measurement look absent.

**`null`, never `0`, where no accelerometer covered the epoch.** "Nothing observed" is not "the body was still" — a `0` would be a fabricated stillness that a correlation would happily consume, which is the same honesty rule Clock Contract §2.6 applies to time. Scale is the night's own median→p95, matching what the vote reads; ρ is a correlation, so a per-node scale is what the other two corners use too.

**Additive.** A new key on an existing epoch object; no signature or return-shape change, and a consumer that does not read it behaves exactly as today.

Gated by the new `ecgdex-dsp` group **ECGDex motion index — per-epoch chest-ACC activity reaches the bus** (6/6): every ACC-observed epoch carries the field, values are numbers in `[0,100]`, the series **varies** (a constant column would give ρ no signal — silently useless rather than visibly absent), and an ACC-stripped recording yields `motionIndex === null` on every epoch rather than `0`. The group exists because this rides the **rich** export (`opts.rich`), which **no committed fixture exercises** — both ECGDex goldens are light, so the equiv/GATE-C legs cannot see this field at all; without its own group it would ship ungated.

ECGDex re-bundled (`manifestHash 642fd596ad48 → 1322ef185d5e`), plus the two orchestrators inlining `ecgdex-dsp.js` (Data Unifier, OverDex) and the analysis/docs mirrors. **Not export-inert** — `computeHash` moved `c4c313cd1fc7 → dafe4002278a`, so `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs` re-ran the app and re-stamped `ECGDex_2026-06-27_equiv` → `verifiedUnder: dafe4002278a`. No golden output moved (both ECGDex fixtures are light exports), so no fixture was regenerated.
