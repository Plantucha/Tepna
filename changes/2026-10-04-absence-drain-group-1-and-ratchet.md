---
bump: patch
type: fixed
brief: ABSENCE-SURVEY-2026-09-22-BRIEF.md
---

Night QC no longer reports an unreadable capture file as zero rows delivered: the row count is null, the stream is listed under `unreadable` (the file under `unreadable_files`), no row sum includes it, and the verdict reads UNKNOWN naming it — before, the stream landed in `missing` and the device was failed for sending nothing. The ABSENCE-SURVEY drain also gets its ratchet: `npm run verify:absence` holds the open-finding count equal to a committed ceiling (285 of 290 after this change) and emits one `tepna.verdict/1`.
