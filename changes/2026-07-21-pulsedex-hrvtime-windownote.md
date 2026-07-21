<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [PulseDex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
Disclose the analysis-scale mix in the PulseDex `hrv.time` export: `rmssd/sdnn/pnn50/hr/meanRR` are whole-record while `lnRMSSD` is the representative 5-min epoch median on overnight recordings — now carried in a `windowNote` (+ `units`), mirroring the ECGDex precedent, so a consumer never silently compares the two across scales (DEEP-AUDIT-II §3.5).
