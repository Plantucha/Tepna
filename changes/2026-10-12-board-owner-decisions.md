---
bump: patch
type: fixed
brief: none
---

tools/board.mjs — the Open owner decisions panel read every table row containing the word "open" from OWNER-DECISION-QUEUE, so an answered PPGDEX row, a defect row and a table header rendered as open decisions. It now reads the last OWNER DECISIONS OPEN block of the board's evaluation.md (the coordinator's written list), names its source on the panel, and falls back to the brief's D<n> headings that lack RULED/ANSWERED only when the block is absent. Three planted selftest cases cover block, fallback and absence.
