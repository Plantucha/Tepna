<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite]
brief: none
---

`tools/queue-doctor.mjs` names and drains **green-and-stuck** — a PR state that no GitHub view
reports and that this repo can reach permanently.

**THE FAILURE.** `protect-main` sets `strict_required_status_checks_policy: true`, so a branch must be
up to date at merge. **GitHub's auto-merge does not update a branch** — it waits for the merge to
become possible, and with `strict: true` a BEHIND branch never becomes possible on its own. So the
policy four sessions independently converged on — arm `--auto`, stop chasing BEHIND — is a **deadlock**.

Measured 2026-08-16: **14 PRs sat all day.** Every one OPEN, 0 pending, 0 blocking failures, auto-merge
armed, nothing failing, nothing conflicting. The only symptom was that nothing moved — and *"nothing
moved" is not a state any dashboard reports*, which is why it survived a full day of four sessions
looking directly at it.

The same shape appeared again an hour later, one layer up: clearing `strict` did **not** make the
queue drain either, because auto-merge does not re-evaluate on a ruleset change; it waits for an event
on the PR. Twelve PRs then merged in 60 seconds once something actively merged them.

```
armed     ≠ landing   — something must UPDATE the branch
unblocked ≠ landing   — something must TRIGGER re-evaluation
```

Both are a passive mechanism waiting on an event that never arrives, presenting as a healthy queue.

**WHAT IT DOES.** Every 10 minutes (systemd user timer), it classifies every open PR and updates **at
most one**. Design constraints, each paid for by a measured failure:

| decision | why |
|---|---|
| **never merges** — only `gh pr update-branch` | the new head runs CI, the checks report, and *that* is the event armed auto-merge waits for. A drainer that cannot merge cannot merge the wrong thing. |
| **exactly one PR per run** | under `strict: true` any merge re-BEHINDs every other PR, so updating two at once guarantees one wasted CI run. Serialisation is the only non-wasteful order — what a merge queue would do, which this repo cannot have (merge queue is an **organisation**-repository feature; Tepna is user-owned, verified 2026-08-16). |
| **a timer, not a command** | the failure happens exactly when nobody is running anything. `land-pr` is per-PR and dies with its process — three of four runs exited silently on a merge refusal, leaving PRs unattended. |
| **advisory ≠ required, both directions** | `land-pr` got this wrong twice in one day: it waited 90 min on an advisory pending, then merged past four *unreported required* contexts. Both directions are gate-pinned here. |
| **an absent required context is awaited, not counted as passing** | absent reads identically to satisfied if you only count buckets. |
| **fails closed and says so** | an unreadable ruleset or PR list exits 2 with a refusal, never "0 stuck" about state it never examined. |
| **20-minute idle window** | not noise tolerance — the window in which the PR's owner might be mid-rebase. Acting sooner races a human. |
| **reports `stuck-unarmed` instead of acting** | a green PR without auto-merge armed cannot be landed by updating; that needs a human. |

**VERIFIED.** 16 assertions in the `tools · queue-doctor` group drive the pure core with no `gh`, no
network and no clock. Run live against the real queue before shipping: it found **3 PRs already
deadlocking again** within two hours of the queue being cleared by hand, correctly picked the oldest,
correctly left a 15-minute-old one for its owner, and unstuck it. The recurrence is the argument for
the timer.
