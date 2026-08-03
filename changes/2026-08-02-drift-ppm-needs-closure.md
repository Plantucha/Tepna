<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite, docs]
brief: WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02-BRIEF.md
---
Stop trio-batch quoting a drift ppm that has not closed — the seconds-per-night claim is now gated on the closure verdict, which is computed before the line rather than twenty lines after it.
