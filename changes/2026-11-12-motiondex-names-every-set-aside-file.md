---
bump: patch
type: fixed
brief: none
---

Name every dropped file MotionDex sets aside, with its own reason.

The drop lane left an unplaceable file out of the status line with no word. A vigil audit of
night 2026-11-04 handed the node 4 files and read `3 file(s)`. The O2Ring `_ACCRAW` is the
measured case, and no node reads that stream yet. Each set-aside file now carries its own
reason. An unreadable file reads apart from an empty one. Two files for one slot place in drop
order, and the status line names the loser.
