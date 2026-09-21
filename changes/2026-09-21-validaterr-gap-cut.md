---
bump: patch
type: fixed
brief: MEASUREMENT-PROVENANCE-ROADMAP-2026-08-26-BRIEF.md
---

ECGDex's firmware cross-check (validateRR / alignFirmwareRR and the export's validation block) is computed on the gap-cut NN train, not the raw one: an interval that straddles a dropout is a non-measurement and is excluded exactly as the headline rMSSD/SDNN already exclude it; nnSpansGap is published on the analyze result and validation.gapCutBeats says how many were cut. A 20-minute dropout counted as one interval had put validation.dRMSSDPct at 65 797.8 on a real night (7.1 % gap-cut). Planted gate; ECGDex re-bundled, the corpus-backed fixture re-verified.
