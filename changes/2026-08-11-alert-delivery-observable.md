<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: POLAR-ONBOARD-BACKUP-FOLLOWUPS-2026-08-11-BRIEF.md
---
The alert transport now records and publishes whether alerts are actually DELIVERED — 32 fired in 24 h
with exactly one delivery outcome on record, so a dead webhook was indistinguishable from a quiet one.
