<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: security
nodes: [suite]
brief: SECURITY-REMEDIATION-FOLLOWUPS-2026-07-11-BRIEF.md
---
Extend the erase-all control (dex-forget.js): also wipe the standalone analysis pages' checkpoint keys + IndexedDB (§2), and mount the control in CPAPDex + the Integrator, which own longitudinal data but don't render the shared profile panel (§3). Strict nonce/hash script-src (§1) assessed and deferred — infeasible without a fleet-wide inline-event-handler refactor.
