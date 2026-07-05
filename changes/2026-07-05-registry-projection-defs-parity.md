<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex, PpgDex, CPAPDex]
brief: REGISTRY-PROJECTION-2026-07-04-BRIEF.md
---
Correct stale crossnight `*_DEFS` metadata to the registry truth — OxyDex mean-SpO₂/mean-HR and CPAPDex residual-AHI/central-index/usage-hours graded `measured` (not `validated`), CPAPDex usage-hours label "Usage Hours" and PpgDex Perfusion-Idx/Motion-rejected labels — regenerating the CPAPDex multi-night golden; every shared-id field is now hard-gated by the registry↔_DEFS parity check (REGISTRY-PROJECTION Phase 2).
