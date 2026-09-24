---
bump: patch
type: fixed
brief: none
---
**A strap on a table reported 42 ventricular runs.** On the owner's 2026-09-22 night, 2,766 of 2,767 PVCs sat in the window where the H10 was off the body — 7.93 % PVC burden, 330 couplets, bigeminy 396, from an empty strap. (Found and measured by Wren, capture-host lane.)

The gate for exactly this case already existed and had no consumer. `ecgdex-dsp.js:2791` computes `beatConfidence`, whose own comment says why: *"a burst of spurious detections passes SQI≥0.30 individually yet is collectively nonsense … c<0.5 = confirmed artifact ⇒ drop, so it no longer inflates RMSSD/SDNN/epochs."* The HRV path consults it. The morphology call at `:3081` passed raw `sqi` and never did, so an empty strap was classified beat by beat. Its `artifactSec` of 6148 s = 102.5 min matches an independently measured off-body window of 102.2 min — the right seconds were already identified.

**Two halves, and both are required.** This PR carries them together because measurement showed that shipping either alone is wrong:

| | nPVC | burden |
|---|---|---|
| before | 2767 | 7.93 % |
| `'U'` typing alone | 2767 | **11.69 %** |
| + confidence mask | **1** | **0.01 %** |

The `'U'` typing correctly stops an unclassifiable beat being counted as normal and removes it from the burden denominator — but alone it *shrinks the denominator while the artifact numerator stands*, making the owner's visible number worse. That is why this began as two PRs and ships as one.

Masking by `_conf` reproduces Wren's doff-cut exactly on all six morphology figures; the two runs differ only in how the off-body window is excluded (timestamp cut before parse vs confidence mask after), so this validates **the mask, not the classifier** — it is not evidence that the surviving 1 PVC is real.

**Also fixed, the original survey row:** a beat too noisy to classify was typed `'N'` and counted as one. Declining to call ectopy on a dirty beat is correct and kept; asserting normality it had just declined to establish is not. Unclassifiable beats now take `'U'`, burdens rate over `beatsAssessed`, and `beatsAssessed`/`beatsUnassessed` publish the basis. `bigemCycles` no longer lets an unassessed beat complete a pattern it was never shown to be part of.

⚠️ **The twin took three attempts, and the first two would have shipped green either way.** They reproduced the false PVCs (42, then 23) with `beatsArtifactMasked: 0` — the gate never fired. `beatConfidence` is a robust z-score against the record's *own* median and MAD, and needs **both** an upper-outlier density and depressed SQI (`min(sD, sQ)`, which is what makes it AF-safe). The committed plant is therefore sized from the real file's proportions — a minority tail at ~4 detections/s against the worn 1/s — and leads with an anti-vacuity assertion (`beatsArtifactMasked > 500`), because without it a future change that simply stopped *detecting* the tail would also pass: no beats, no ectopy, green for the wrong reason.

Measured on that plant: mask bypassed → 45 PVCs at 6.16 % burden; mask applied → 0.

⚠️ No golden can move on any of this: ECGDex's morph burdens are carried through the reshape but never selected into the node-export, which is why a burden regression on the owner's own night was invisible to CI. Logged separately as `2026-09-24-the-corpus-cannot-falsify-a-refusal-fix`.
