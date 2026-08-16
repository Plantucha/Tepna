---
bump: patch
type: changed
brief: BRIEF-COLLISION-RESIDUAL-GAP-2026-08-09-BRIEF.md
---

`stale-file` is now a required status check on ruleset `protect-main` (8th context, owner-directed).
The check has existed since #1086 but was advisory, and auto-merge is used on essentially every PR
here — so a PR editing a brief that had already moved on `main` went red and merged anyway. It now
blocks.

Preconditions verified before requiring it, because a required context that never *reports* blocks
every PR forever rather than the intended one: the workflow has no `paths:` filter, no matrix and no
job-level `if:`; its reported context is the literal `stale-file` (observed passing on 5 of 5 recent
PRs); and a PR touching no guarded file exits 0 rather than skipping. The applied ruleset diff was
confirmed to touch `required_status_checks` and nothing else.

Also corrects two stale claims: `CLAUDE.md` §👥.5 said 7 required checks, and the brief listed
`strict_required_status_checks_policy = true` as an available option when it had already been true
since the day the line was written.
