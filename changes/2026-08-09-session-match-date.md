---
bump: patch
type: fixed
brief: none — found while triaging an unrelated CI red on PR #1044
---

`probe_verity_survey._session_matches` decided whether a pulled Verity session directory was "the one
this run just created" by reading only the trailing `HHMMSS` off the name and pasting the RUN'S date
onto it. That compares time-of-day, so a session recorded on any previous day at the same clock-minute
was judged ours — measured at 39 days old and still matching — and its stamps were then compared
against this run's host clock, fabricating the timebase verdict the neighbouring test exists to
prevent. The `mtime < 1 h` guard does not cover it: a freshly *pulled* old session has a fresh mtime,
because mtime records when we wrote the file, not when the device recorded it.

The directory's own `YYYYMMDD` is now part of the comparison. This also fixes the mirror-image bug at
midnight: a device saying 23:59:50 for a run the host started at 00:00:05 the next day is 15 s apart
and ours, where pasting the run's date made it read as ~86390 s and rejected it.

The test that caught this placed the unrelated session at a fixed 03:00:00, so it only collided for
about six minutes a day; it now sits at this run's own time-of-day on an earlier date, so the
adversarial case is exercised every run rather than by luck of the clock.
