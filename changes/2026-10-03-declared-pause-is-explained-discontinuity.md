---
bump: patch
type: fixed
brief: SOLID-NIGHT-2026-09-23-BRIEF.md
---

Owner ruling 2026-10-03, "No, if declared": a pause the daemon itself declares, with its reason, inside
the worn interval is EXPLAINED discontinuity and does not fail the continuity band. `daemon:pull paused
live` leaves `DAEMON_REGRESSION` and the band PASSES with the pause named in its reason.

The pull-pause CHURN was the defect #2982/#2983 fixed, and that is why a recurrence read as a regression.
The pause itself is the H10/Verity offline-recording op doing what it does, and the journal names it
(`Polar <addr>: offline-recording op — live capture paused`). §∅ puts annotation, not refusal, on the
reduced-coverage side of the line, so the band says what happened rather than passing silently — a band
that passes silently over a known discontinuity makes a healthy night unauditable later. It still counts
toward the LOSS bar, which is `by_cause` in minutes where the band's reason is in seconds.

The annotation sits AT THE PASS, and that placement is the safety argument: every rule above still
decides first, so a declared pause can only ever turn a bare pass into a reasoned one and never soften a
FAIL or an UNKNOWN another rule reached. A night carrying both a declared pause and a `daemon:restart`
still fails on the restart.

⚠️ The control this unit was first specified with does not bind, measured on `origin/main`: the same gap
"with no recorded cause" already PASSED before the change, because an uncaused 11 s gap goes down the
UNATTRIBUTED path, which judges totals (60 s) and counts (5) rather than one gap. The binding controls
are `daemon:restart` still failing, a declared pause beside a real regression still failing, and
`unattributed (no journal)` still UNKNOWN — the genuine undeclared case, since a cause label exists only
because the journal declared it.
