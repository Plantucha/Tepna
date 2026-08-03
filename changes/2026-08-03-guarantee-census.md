<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite]
brief: CPAP-AUTOHARVEST-FOLLOWUPS-II-2026-08-03-BRIEF.md
---
tools/guarantees.mjs enumerates the promises the comments make (560 across the JS spine) and cross-references them against surviving mutants, so an untested line we told the reader was guaranteed is separable from an untested line.
