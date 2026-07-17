<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex]
brief: none
---
Sleep Stability Score no longer fabricates a neutral 50 for the HR-floor subscore when HR is unmeasurable — it drops the subscore, renormalizes the remaining component weights, and surfaces hrFloor=null so the absence is visible instead of contributing phantom points.
