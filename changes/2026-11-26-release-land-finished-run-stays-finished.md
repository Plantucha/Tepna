<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: CONTROLLED-RELEASES-2026-07-05-BRIEF.md
---
A release run that recorded its last step stays finished when a new step joins the chain. Before this fix, the finished v2.37.0 run read as unfinished after `timings` joined, and the release timer held the next release.
