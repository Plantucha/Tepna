<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: CPAP-AUTOHARVEST-FOLLOWUPS-2026-07-28-BRIEF.md
---
Alert when the CPAP harvest cannot read the card — `barren` was the only exit that notified, and an absent card never reaches it.

`patch`, capture-host only (no Dex bundle, no fixture). Found by deliberate fault injection against the
running box: an unreachable card raises before the walk completes, so the poller took the `except` exit,
published state=error and said nothing to the operator. Mutation-verified, with a control asserting a
healthy run still never alerts.
