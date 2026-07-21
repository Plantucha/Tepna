<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: VIGIL-AUDIT-FIXES-2026-07-21-BRIEF.md
---
Anchor the night boundary on file activity so a capture crossing midnight is never truncated, flag under-rate streams as degraded, and run one supervised runner per BLE link.
