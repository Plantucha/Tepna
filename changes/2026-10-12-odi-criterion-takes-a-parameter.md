---
bump: patch
type: fixed
brief: none
---

**A caller can now name the shipped ODI criterion, and the kernel constant stays frozen**.

`processNight(rows, fname, params)` takes an optional **last** argument, `{ dropPct }`. An absent `params`, a null `dropPct`, or the kernel value itself resolves to `DexKernel.K.ODI_DROP`. That constant stays **frozen**: the override is an argument, not a thaw. Residue `2026-09-13-odi-threshold-has-no-injection-point`.

**What the tree lacked**. `tools/nsrr-criterion-sweep.mjs` could sweep only the raw detector, and the detector is not the shipped index. Over the same 99 SHHS1 records the detector's median reads **9.12 events/h** against the **2.70** that `processNight` publishes. Gating, artifact handling and the pipeline's own denominator account for that **3.38x** gap. So no tool could measure the index OxyDex publishes under any criterion but 4 %.

**One override, one coherent night**. The criterion reaches every ODI-family helper that `processNight` calls — desaturation profile, SpO₂-advanced, SBII, severity, slopes, rolling metrics, breathing irregularity — not just the headline count. An ODI computed at 3 % beside a severity family still at 4 % describes a night no reader can interpret. A test that checked only `odi4` would still pass it. Each helper takes the criterion as its own new **last optional** argument. So a direct call written before this PR computes exactly what it computed before.

**It refuses in both directions**, because a criterion that silently falls back is worse than none. A present-but-invalid `dropPct` (0, negative, a string, `NaN`, `Infinity`) **refuses**. An unknown key **refuses** too: a sweep passing `minSec` would otherwise read as honoured while the detector ignored it.

**`odiCriterion` rides the night object only under an override** (`{ dropPct, kernelDefault }`). The export serializes the night object wholesale, so an always-present field would move every night's bytes, the committed fixtures among them. `sensorWarmupTrimmed` is conditional for the same reason.

⚠️ **The sweep tool's own pin was a lie waiting to happen**. It asserted *"processNight exists but takes no threshold override"*, and its body read `typeof processNight === 'function'`. Adding the override would **not** have reddened it: the label would simply have turned false while the test stayed green. A pin on a negative has to exercise the negative. Nine assertions now exercise the positive end to end on the real module. The file's two prose blocks claiming the shipped path *cannot* be swept now read correctly.

**OxyDex `manifestHash` f380e5ba255b → 54cbcf574fe2 and `computeHash` ec8658467309 → 9244f3ea92a8**, so this PR owed re-verification and ran it. `tools/regen-oxydex-goldens.mjs` re-ran the app on its committed inputs and regenerated all five OxyDex fixtures: `OxyDex_2026-06-13_1056_summary.json`, `OxyDex_2026-06-25_0439_summary.json`, `OxyDex_2026-09-19_2245_stored_summary.json`, `synthetic_oxydex_golden.node-export.json`, `synthetic_oxydex_gap_golden.node-export.json`. Every moved line in all five carries a `code.manifestHash` or `code.computeHash` stamp, and **not one measured value changed**. That measures the default path's byte-identity rather than asserting it.

**The treatment-response yield pin keys on the detector digest, so the re-cut is a real run**. `node tools/analysis-rerun.mjs --only treatment-response-analysis.html --paper-scale` over 1800 synthetic patients returns **233 tx / 239 flat**, the pinned pair unchanged. Three fields move in `analysis/treatment-response-yield-pin.json`: the detector digest, `measuredAt` and the producing commit.
