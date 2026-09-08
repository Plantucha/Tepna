<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: VIGIL-AUTO-UPDATE-FOLLOWUPS-2026-08-14-BRIEF.md
---
**The box spends most of its life running code that is on disk but not loaded, and now it can stop.**
`--force-restart` covered the impatient operator; nothing covered the box that merged at 23:50 and then
waited **up to an hour** to re-ask a question whose answer changed the moment the last device stopped.
Measured over a 13-day window: 17 deferral streaks, median **8.27 h**, max 70.09 h, **68.6 %** of the
window, and **16 of 17** over four hours.

`tepna-update.sh --pending-only` runs the **same step 5** — same interlock, same content gate, same
fail-safes — and skips only the fetch and the merge, so there is no second copy of the restart decision
to drift out of sync with the first. That is what makes it safe on a two-minute timer: **no fetch, no
merge, no network.** With nothing owed it does **nothing, silently**, which is a healthy box's state
almost all of the time — through step 5's existing `restart_owed=0` branch, not through a short-circuit
of its own. (The first version had one. It was redundant, and therefore unkillable: mutating its
condition to `false` left every test green. Deleted rather than excused.)

⚠️ **It is an ACCELERATOR, not an authority.** Nothing is fetched, so an absent marker means it has
nothing to act on and it does nothing — it only ever closes a debt the ordinary tick already recorded.
The hourly run is still the backstop and still writes the marker on every restart and every deferral.

🔴 **One run at a time, and the lock is taken BEFORE the marker is read.** Two runs can now overlap for
the first time, and the restart decision is read-then-act: without a lock both read the old marker, both
conclude a restart is owed, and the daemon's BLE links drop **twice** for one debt. Degrades open — a
box that cannot lock must still finish a deploy.

**The deferral streak is now visible.** `deferred` stays INFO-level prose, because deferring is the
script working; what it could not say is *"…and it has been saying this since Tuesday"*. A debt older
than **24 h** escalates to WARN with the span and the first-deferred stamp. That bar is deliberately NOT
a percentile of the measured distribution: at 4 h it would fire on 16 of 17 real streaks, and the median
is 8.27 h, so any bar near the middle measures "a night happened". Deferring across one night is the
interlock working; a debt that outlives a **day** means an idle window was available and not taken.

**Installed, NOT enabled.** `tepna-update-pending.service` + `.timer` ship off; enabling them changes
when a recording box is restarted, which is an owner decision.
