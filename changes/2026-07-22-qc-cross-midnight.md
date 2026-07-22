<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: VIGIL-AUDIT-FIXES-2026-07-21-BRIEF.md
---
nightqc coverage now unifies a cross-midnight overnight across its two date folders and merges active intervals, so a device that streamed cleanly across midnight on a long connection no longer reads as badly degraded.
