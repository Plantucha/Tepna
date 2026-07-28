<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: QC-SCOPE-RESOLUTION-2026-07-28-BRIEF.md
---
Resolve the capture night by where the data is, not by folder name — QC judged the empty post-midnight folder on every cross-midnight session and reported healthy recordings as nine missing streams.
