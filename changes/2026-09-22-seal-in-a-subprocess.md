---
bump: patch
type: fixed
brief: CAPTURE-NIGHT-SEAL-2026-09-21-BRIEF.md
---

The night seal runs in a child process: a 916 MB night measured +1971 MB peak RSS in the sealer (2.15×), now in a child that exits — the daemon parent stays at +0. A child that dies, times out or prints a non-verdict is UNKNOWN by name.
