---
bump: patch
type: fixed
brief: ABSENCE-SURVEY-2026-09-22-BRIEF.md
---

Five absences in the capture daemon stop reading as observations: a failed presence scan no longer ages a present ring to absent, Heart Rate samples no longer carry a fabricated device clock, an unread rate menu no longer erases the one the web page had seen, an unreadable auto-start record no longer re-arms an auto-start the operator stopped, and a failed MTU acquire is logged as an unknown MTU. Open ABSENCE-SURVEY findings: 276 of 290.
