<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [suite]
brief: CONTROLLED-RELEASES-FOLLOWUPS-2026-07-05-BRIEF.md
---
Flip release-ledger check-7 to a HARD gate (F8, `HARD7=true`) — un-recorded code movement now BLOCKS instead of shipping informational. Adoption is real: the 1.0.0 snapshot was reconfirmed consistent against BUILD-MANIFEST (5 unmoved bundles byte-match; the 3 moved — OxyDex/HRVDex/Integrator — are exactly the changeset-covered set), so the gate is green with zero false positives.
