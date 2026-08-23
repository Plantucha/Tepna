---
bump: patch
type: fixed
brief: FINISHED-WORK-IMPROVEMENTS-2026-08-20-BRIEF.md
---

`queue-doctor`'s serialisation gate was a livelock: it waited whenever ANY PR had required checks in
flight, and in a queue several sessions push to there is always one — a fresh push IS mid-CI. Its own
journal shows it detecting green-and-stuck PRs every ten minutes for hours and acting on none, while
the day's queue was hand-drained.

`STARVED_MIN = 30` (two full CI cycles) lets a starved PR outrank the wait. Pre-stated from the cycle
time, not tuned to the outcome. The narrower fix — only serialise behind a PR that is not itself
BEHIND — was tried first and does not work: a mid-CI PR was just pushed, so it is usually current.

Also splits two states out of `running` that CANNOT MERGE, so cannot re-BEHIND anyone and must not
serialise: an UNARMED PR mid-CI (`running-unarmed`) and an ABSENT required check (`awaiting`). They needed opposite responses
— a pending check resolves, an absent one may never report — and collapsing them meant an unreported
context BLOCKED the queue while being excluded from the candidates that could fix it. Measured from
the timer's journal over six hours: 22 blocked runs were genuinely pending, 10 were `awaiting: test`.
An awaiting PR that is BEHIND and armed is now updatable, because pushing a new head is what makes an
unreported context report. Condition gap observed by the acquisition-hardening lead session.

Also corrects an existing assertion whose fixture (idle 40) sat above both thresholds, so it had
begun asserting the escape's absence rather than serialisation.
