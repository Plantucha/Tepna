---
bump: patch
type: fixed
brief: NIGHT-0928-ERRORS-2026-09-29-BRIEF.md
---

The 14-night run stopped discarding PASS nights over a file written next to them. `solid_night.history`
read `diskguard.active_nights` — ANY file younger than the settle window — ahead of the verdict already
written beside the night, and §3.1 resets the run on a non-latest `not settled` night. The daemon
appends the live-vitals `OXYLIFE.csv` into the session's start-date folder for as long as a run lasts,
so on vigil 2026-09-29 `2026-09-28` read "not settled" 11 h after its last device sample with its own
FAIL verdict sitting beside it. The written verdict now wins; `active` only chooses the reason for a
night that has none, so `not settled` and "settled and never assessed" stay distinguishable.

`active_nights` is unchanged and correct: its consumers are protect-lists for destructive work, where
any activity is the conservative test. The second question — has this night's DEVICE data gone quiet —
gets its own named predicate, `nightqc.data_quiet_s`, a duration and `None` for a folder holding no
capture file.

And the night still being captured is now published instead of leaving the previous night's verdict
standing under the previous night's date, which is what an operator met every morning between doff and
the audit. It is the composer's own `UNKNOWN` `not settled`, held in memory and never written beside the
night, with no band evaluated — scoring an in-flight night would measure completeness against an
interval that has not finished arriving. The card says how long the data has been quiet and how much of
the settle window is left.
