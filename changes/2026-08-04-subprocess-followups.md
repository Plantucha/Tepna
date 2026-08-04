<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host, docs]
brief: CAPTURE-HOST-SUBPROCESS-SURFACE-FOLLOWUPS-2026-08-04-BRIEF.md
---

docs: close the subprocess-surface brief (all four steps DONE — 204 mutants across 8 PRs, zero
regressions) and spawn its follow-up. Nothing found a bug in capture-host; every serious problem was
in the measuring instrument, and each produced a confident wrong answer. Records a seventh runbook
failure mode (a non-unique mutation anchor), that a slow test spends other mutants' timeout budget,
and widens the in-flight rule to cover any reader/writer overlap.
