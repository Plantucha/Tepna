<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite, docs]
brief: MUTATION-SUITE-FOLLOWUPS-2026-08-17-BRIEF.md
---
Emit one journal START record per mutant instead of two on the serial fallback path, which had doubled the in-flight count a degraded run reports; and close §7.2 with the probe that settled it — the guard mutants were never the expensive thing.
