<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [PpgDex]
brief: ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF.md
---
PpgDex now reports a respiration rate — `lombScargle` accumulated the HF band power and threw the peak frequency away.

`minor`: the export gains `hrv.frequency.respRate` + `respRateMethod` and per-epoch `respRate`. No existing
field changes shape. The Integrator's `summary.respRateBrpm` branch already read this key and had nothing
to read, so PpgDex joins the respiration fusion with no consumer change.
