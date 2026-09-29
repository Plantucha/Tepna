---
bump: patch
type: fixed
brief: none
---

PpgDex's mid-file clock-resync detector tested only FORWARD device-counter steps, so the 2026-09-28
ring night — the ring reconnected into the same `_PPG.txt` with its counter reset from 24 449 332 942 372
to 0 — recorded no seam, dropped no anchors, and measured a host axis across two oscillator states
(ok:true, 6040 anchors, maxStepMs 24 398 420). A backward step beyond the bound is now a seam at both
parser sites, recorded with its sign, and a post-seam segment carrying fewer than three anchors refuses
the axis with a named reason instead of being merged with the night it cannot speak for. Detection only;
which segment a night should anchor on is not decided here.
