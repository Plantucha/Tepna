---
bump: minor
type: added
brief: SOLID-NIGHT-2026-09-23-BRIEF.md
---

SOLID-NIGHT §A5's unrecorded-shift tripwire is built, and with it the timebase band can PASS. Until now
it read UNKNOWN by construction on every night — "the A5 step tripwire has not run" — so no night could
be solid and the owner's 14-night run could never start.

The tripwire fires UNKNOWN `unrecorded-shift-candidate`, never a FAIL: over n = 36 clean nights the
corpus holds zero true unrecorded steps, so the detector has never been validated against the thing it
would convict. Persistence is the level 60–120 s after an instant minus 30–90 s before it, measured on a
grid rather than at peaks — 1 237 of 1 756 corpus events above 1 s were delivery-latency transients that
return. Every number is pre-stated in the brief and none is derived from a night being judged: the 1 s
bound sits ~12× above the quiet windowed-shift p99.9 of 81 ms.

Both guards must pass before it may fire, and a guard that cannot be applied stops it. Guard 1 refuses a
candidate whose delivery rate departs from the seam sidecar's negotiated rate by more than 10 % — a clock
step holds the nominal rate while the level moves, a backlog collapses it. Guard 2 refuses one whose
after-window contains, or ends within 10 s of, a gap or the end of the stream.

The no-record check reads all three sources the brief names. The journal's clock-event lines reach it
through `LOSS-AUDIT.json`'s `clock_events`, written by its own unit (#3247) because the verdict side has
no journal of its own and journald rotates; `CLOCKSYNC.csv` is read from the next date's folder
as well, since a row is keyed by the event's own wall date. A record set that cannot be read stops the
tripwire rather than shrinking — matching `off host` alone is how the first cut flagged a night the
daemon had logged.

**The drain found a defect in this PR's own call chain.** `timebase` passed the stream file's basename
where `clock_records` expects the DEVICE NAME, so the `CLOCKSYNC.csv` half of §A5's record set matched
nothing at all and every journal line that names its devices went with it — leaving the tripwire free to
convict a step the daemon had written down, which is the 2026-08-18 mistake §A5 exists to prevent. The
mutation gate is what surfaced it: replacing that argument with `None` changed no answer, because neither
value ever matched. `timebase` now takes the device name and forwards it.
