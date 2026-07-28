<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: CPAP-AUTOHARVEST-2026-07-26-BRIEF.md
---
A harvest that found nothing now reports `barren` and alerts, instead of publishing `ok` and painting a green "✓ 0 files".
