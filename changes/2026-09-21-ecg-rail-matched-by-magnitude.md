---
bump: patch
type: fixed
brief: PINNED-SPAN-POPULATIONS-2026-09-18-BRIEF.md
---

ECGDex's saturation rail is matched by MAGNITUDE (owner ruling D9.3): each qualified rail is mirrored — the histogram spike within the scan's own adjacency width of its negated value, under the same spike qualification — and the SQI rail leg keys on that set. The H10 saturates positive 2–3 µV under |railLo| on 5 of 5 measured files, and on three of them a few stray opening samples masked the real positive pin from the edge search entirely, so 1381/1968/703-sample saturations were neither caught nor counted. quality.ecgRail now publishes the file's rails and the whole-record sample count at them (null when no rail qualified, never 0). The interval-level exclusion of a saturated stretch still waits on the run-length threshold PINNED-SPAN §7 leaves unchosen.
