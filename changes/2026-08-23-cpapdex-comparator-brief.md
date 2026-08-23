<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [docs]
brief: CPAPDEX-LIVE-SD-COMPARATOR-2026-08-23-BRIEF.md
---
Design brief (PROPOSED) for a permanent CPAPDex live-vs-SD agreement surface — BLE-live-captured EDF vs device SD-card EDF, the house comparator pattern (OxyDex pleth-vs-.dat, ECGDex PanTompkins-vs-firmware) applied to CPAP. An alignment+diff surface over the vendor BRP.edf both sides already share: device-clock alignment, scale/offset regression + Bland–Altman (never Pearson r), explicit streamed-vs-logged divergence, refusal-first. Implementation sequenced after the CPAP P1/P3 ingestion wiring.
