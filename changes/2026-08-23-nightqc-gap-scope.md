---
bump: patch
type: fixed
brief: FINISHED-WORK-IMPROVEMENTS-2026-08-20-BRIEF.md
---

`nightqc`'s `ok` was false on 20 of the last 20 nights — its own comment calls that "an alarm that is
always on carries no information". The session-judging half was fixed earlier; this closes the other
half, per FINISHED-WORK group D.

Excluded sessions are now classified by placement against the judged night's band. An excluded
session overlapping the band is a hole in this night and still reds `ok`; one lying wholly outside it
is labelled `[outside-band]` and reported in `gaps` exactly as before, but no longer reds a night it
does not bear on. `ok` reads the new `gaps_in_night` subset; `gaps` stays complete so nothing is
hidden.

Fails closed: a session straddling the band edge counts as in-night, and a band that cannot be
computed keeps every gap. Both cases §D names are planted as tests — the benign daytime sitting is
green and labelled, the 2026-07-24 box-wide outage still reds — plus a direct unit test covering
every branch of the classifier, including the degenerate-band case that `summarize` cannot reach.
