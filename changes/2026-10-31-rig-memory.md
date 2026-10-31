---
bump: patch
type: fixed
brief: none
---

Two rig tools stop filling the rig's memory. `tools/hook-contract.mjs` removes its scratch directories in `/tmp` when it exits. Before this fix, 3107 of them held 11 GB of the tmpfs. `tools/board.mjs` gives ccusage a slim copy of the session logs. The board child then holds 0.49 GB, against 4.7 to 6.0 GB before, and the copy gives the same block costs.
