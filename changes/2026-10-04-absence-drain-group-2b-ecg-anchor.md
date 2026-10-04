---
bump: patch
type: fixed
brief: ABSENCE-SURVEY-2026-09-22-BRIEF.md
---

A resumed ECG recording whose original time anchor cannot be read back now leaves its relative-time column empty for the rest of the file instead of restarting it at 0.0 mid-file; the device-clock column still carries every sample time. Open ABSENCE-SURVEY findings: 282 of 290.
