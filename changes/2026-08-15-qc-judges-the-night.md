---
bump: patch
type: fixed
---

**Nightly QC was judging the wrong session — and on 2026-08-15 it judged a charger.**

`summarize` picked `max(sessions, key=lambda s: s[1])`, the session reaching the latest write, on the
reasoning that QC runs in the morning so the newest session *is* the night. That held while the box
recorded only at night. It stopped holding when the box began recording continuously, and it failed
silently: any later **daytime** session becomes "current", and the whole night is reported as an excluded
gap.

Measured on the day a Verity sat streaming noise in its charger all morning:

    02:42 -> 06:03   2 977 473 rows   <- the night
    10:01 -> 12:12   1 716 348 rows   <- JUDGED, and it was the charger

H10 and O2Ring were absent from the morning session, so QC reported them **`missing`** and returned
`ok=false`. It judged the garbage and called the night a hole.

**That is why `ok` was false on 20 of the last 20 nights** — every day with any daytime capture produces a
spurious gap plus a spurious `missing`. An alarm that is always on carries no information: it could not
have told anyone about the charger, because it says the same thing every other night.

Now judged by **rows**, not end-time — duration is inflated by a session idling across a doffing gap,
while rows count what was actually captured. Ties break toward the later session, preserving the old
behaviour on the single-session days the rule was written for. The choice is published as
`judged_session`, on this file's own principle that *a verdict that cannot be audited against the ground
it was computed from is a claim, not a measurement*.

**Verified against the real corpus, not only fixtures.** On 2026-08-15 the judged session becomes the
night, `gaps` goes 1 → 0, and `missing` changes from a false *"H10 and O2Ring"* to a true *"Verity"* — the
Verity genuinely was not in that night's session. `ok` is still false, and that is the point: **the fix
makes the alarm truthful rather than quiet.**

⚠️ **The remaining structural cause is the night boundary, and it is NOT fixed here.** One night spans two
date folders — the H10's 2026-08-14 night runs 22:30 → 02:42 in one folder and 02:43 → 06:03 in the next —
so a per-folder verdict always judges a partial night. Making QC night-scoped rather than folder-scoped is
a design change, deliberately not made unilaterally.

⚠️ A prior-session gap is reported but still vetoes `ok`. Measured across 18 nights, **every** such gap is
≥ 88 min (88, 91, 121, 142, 149, 149, 238, 350, 350, 417, 656, 888, 891, 902, 938, 956, 968, 972) — i.e.
all are separate daytime episodes rather than a night split by a dropout, of which there are zero
observed. Whether an episode boundary should falsify a claim about a different session is the same
report-versus-judge question as `system_files`, and it is left open rather than answered by a threshold
fitted to eighteen points.
