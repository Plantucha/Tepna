<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [ECGDex]
brief: DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS-2026-07-18-BRIEF.md
---
Add an optional `genSynthetic({respHz})` carrier so a slow-breathing ECG can be generated, and gate the EDR respiration autocorrelation window that had no test.

`minor`: `genSynthetic` gains an optional parameter; the default is unchanged, so every existing caller
and every golden is byte-identical (asserted by a leg, not claimed). No export field changes shape.
The sweep the new fixture made possible found that `crc.respFromEDR` period-doubles at 24 breaths/min —
routed to ECGDEX-EDR-RESP-ACCURACY-2026-07-31-BRIEF.md and pinned as an explicit characterization.
