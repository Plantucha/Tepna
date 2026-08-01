<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: CPAP-AUTOHARVEST-FOLLOWUPS-2026-07-28-BRIEF.md
---
Route §2.1 to its own brief after verifying the premise — the CPAP's SA2.edf carries 1 Hz SpO2 on 194 nights at a median 6.85 h.

`patch`, docs-only: no runtime code touched. The measurement corrected two things that would have skewed
the routing — a night can be several sessions, and a first file-count was inflated 4x by copies across
capture trees.
