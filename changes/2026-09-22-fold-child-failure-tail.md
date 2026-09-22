---
bump: patch
type: fixed
brief: none
---

A `trio-batch` fold child that fails now always reports its own error text: the failure tail was printed only when the child had produced NO result lines, so a child that died *after* computing its whole night had its abort message discarded — the one case where it was the only evidence. Measured 2026-09-22 on a full-corpus refold: 34 of 140 children exited on a signal having printed every `✓` line, and the log could not say why; with the fix the very next run named `FATAL ERROR: Ineffective mark-compacts near heap limit` on sight. The decision is now the pure `childReport(code, body, out)` so `--selftest` pins it: a failed child that also printed results still shows its tail, the tail is marked `!` so it cannot be read as a result line, and a successful child shows no tail.
