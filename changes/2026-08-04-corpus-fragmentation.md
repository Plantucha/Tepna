<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [PpgDex, docs]
brief: PPGDEX-JITTER-AND-REFERENCE-FOLLOWUPS-2026-08-03-BRIEF.md
---
Record why the jitter corpus looked half its size — 1632 finger files span only 18 nights and the apparatus assumes one file is one night, so nights that exist only as fragments never scored; trio-batch already merges sessions and the jitter tool never did.
