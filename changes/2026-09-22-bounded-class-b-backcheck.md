---
bump: patch
type: changed
brief: CAPTURE-HOST-RESOURCE-ORCHESTRATION-AUDIT-2026-09-05-BRIEF.md
---

The end-of-night class-B back-check reads a night's waveforms into per-channel arrays instead of one Python tuple per row, and the clip rule stops copying the annotation-filtered column: measured on a real night the back-check peaks at 245 MB instead of 1116 MB and produces byte-identical blocks.
