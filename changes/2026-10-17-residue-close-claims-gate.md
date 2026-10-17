---
bump: patch
type: added
brief: none
---

A new full-tree mode in the residue id tool reads every merged commit for a close claim. It compares each claim with that row's state cell. A claim over a row that still reads OPEN, or over no row, fails the gate. The mode runs as a step in the full check and in CI.
