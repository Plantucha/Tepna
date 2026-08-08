---
bump: minor
type: added
brief: TRIO-ARTIFACT-GATE-AND-N15-POWER-2026-07-12-BRIEF.md
---

**The `ms;hr;c` export contract — the per-second three-cornered hat becomes reproducible from a
committed artifact.**

`analysis-stats.js tchSigmasFused` (the fused-weight artifact-robust hat behind the σ both σ-papers
publish) needs three aligned per-second HR series plus per-corner confidence. Measured on the
committed trio corpus: **0 of 40 OxyDex exports carried any HR timeseries** (5-min epoch medians +
1 Hz SpO₂ only) and neither beat series carried `c` (only a 0/1 Malik `corrected` flag) — so the
O2Ring corner was not in the file and the hat was un-runnable on committed data at **any N**, not
merely imprecise. It stayed invisible because `tools/tch-multinight.mjs` runs happily on the same
exports at 5-min resolution and produces plausible numbers.

Additive, back-compatible:
- `OxyDex timeseries.hr` — 1 Hz pulse on the same uniform grid as `spo2`, holes explicit (never 0,
  never carried forward), index-aligned with `spo2.values` by construction.
- `ECGDex timeseries.rr.conf` / `PpgDex timeseries.ppi.conf` — the per-beat fused-hat weight, which
  both nodes already computed (`beatConfidence`) and then discarded.

New `tools/tch-fused-corpus.mjs` consumes it and solves every night twice (fused vs unweighted).
