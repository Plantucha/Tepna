<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [HRVDex]
brief: none
---
Guard d_pns_eff (PNS Efficiency) and d_ari (rolling Recovery Index) on the row's OWN rMSSD so a night with no rMSSD reading no longer coerces `null / positive === 0` — killing a fabricated green "PNS Efficiency 0.00" and a false d_ari<0.85 "recovery collapse" red alert on absent data (mirrors the d_otr / d_sdnn_z presence-gate discipline).
