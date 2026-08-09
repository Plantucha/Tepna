<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED · **Created:** 2026-08-09 · **Follows:** `.claude/hooks/guard-stale-brief.sh` (#1066, merged 2026-08-09) · **Affects:** `.claude/settings.json`, repo branch protection

# The stale-brief hook closes the sequential collision. The concurrent one is still open, and it is the one that happened twice.

`guard-stale-brief.sh` is a good guard and this brief does not argue otherwise. It runs the right
query — *is my base stale **for this file**?* — and it denies with the commit list rather than asking
anyone to remember. What follows is the part it structurally cannot reach, plus one wiring hole.

## 1 · What it catches, stated precisely

`git log $(merge-base HEAD origin/main)..origin/main -- <brief>` is non-empty ⇒ deny. That fires when
**the other PR has already merged and you have fetched since**. On 2026-08-08 that describes #1055:
#1034 merged at `02:13:59Z`, #1055 was created at `03:35:06Z` — eighty minutes later — so had its
author fetched before editing, the hook would have denied and named #1034.

> **A correction to how this has been described, including by me.** I claimed in review that the hook
> "could not have prevented #1055". That is wrong: a branch *based* before #1034 is not the same as an
> *edit made* before #1034 merged, and #1055's edits fall after. The hook covers that case. What it
> cannot cover is below.

## 2 · The residual gap — two PRs open at once, neither merged

The check needs the other work to **exist on `origin/main`**. When two sessions are editing the same
brief concurrently and neither has merged, there is nothing on the ref to detect. No fetch helps; the
information does not exist yet anywhere the hook can look.

That is not the corner case — **it is the second occurrence, hours later**, and the hook's own header
records it:

| PR | created | merged |
|---|---|---|
| #1059 (reconciliation) | `03:57:04Z` | `04:25:24Z` |
| #1061 (restore + rebuttal) | `04:00:16Z` | `04:10:45Z` |

Three minutes apart, both open, both editing the same twenty lines. Neither could see the other, and
the hook could not either — *"because neither could see the other coming either."* #1061 landed first,
#1059 landed fifteen minutes later on a base that predated it, and `main` briefly asserted both *"the
table is right, and this note retracts the other"* and *"that does not overturn 'accidental'"*.

**So: sequential collision — covered. Concurrent collision — not, and cannot be, locally.**

## 3 · The wiring hole — the matcher is `Edit|Write`, which is a TOOL name, not a file write

```json
{ "matcher": "Edit|Write", "hooks": [ … guard-stale-brief.sh … ] }
```

Any write that arrives through `Bash` bypasses it completely:

```sh
python3 - <<'PY' … PY        # ← used four times in one session on DOCS-INDEX.md and a brief
cat > briefs/X.md
sed -i …
```

This is not hypothetical: **every computed edit I made to `DOCS-INDEX.md` and to
`GENERATOR-FOLLOWUPS-III` this session took that route**, because inserting a table row in the right
place is easier to compute than to hand-write. All of them were unguarded. The sibling
`guard-shared-tree.sh` matches `Bash` precisely because that is where the damage arrives.

## 4 · What would actually close §2 — RESOLVED 2026-08-09

> ### ⚠️ CORRECTED — merge queue was chosen, and it is NOT AVAILABLE on this repo
>
> The original §4 listed branch protection first and merge queue was recommended in review as the
> better fit, on the reasoning that it gives the same guarantee without the rebase tax a repo merging
> ~15 PRs an hour would otherwise pay. **The reasoning was right and the availability was never
> checked.** GitHub merge queue is an **organization-repository** feature; `Tepna` is user-owned
> (`owner.type: User`), so the API refuses the rule at schema level — the same error with *no
> parameters at all*:
>
> ```
> {"message":"Validation Failed","errors":["Invalid rule 'merge_queue': "],"status":"422"}
> ```
>
> Two attempts, both atomic; ruleset `protect-main` (#18794443) verified unchanged after each. This
> is the brief's own §5 failure committed inside the brief that defines it: a capability asserted
> without verification. `.github/workflows/*.yml` carry `merge_group:` triggers from #1083 — harmless,
> correct, and dormant unless the repo is ever transferred to an organization.

**What was implemented instead — a PR-level stale-file check (#1086).** It asks whether this PR edits
a guarded doc that already moved on the base branch since the branch point. That case produces **no git
conflict** — the constructed scenario auto-merges cleanly — which is why nothing else sees it.

It beats the local hook on both of §1/§3's holes: it reads the **real ref** rather than your last fetch,
and it does not care whether the bytes arrived via `Edit`, `Write`, or a `Bash` heredoc. Scope is the
same guarded set (`briefs/*.md` + `DOCS-INDEX.md`) — gating source would be red on nearly every PR at
this merge rate, and source is the case git already handles by conflicting. Verified on three
constructed cases before being trusted (fires on the collision, quiet on source churn, quiet once
rebased), shipped with `stale-file.test.sh`.

**Remaining options, re-ranked against what is actually possible here:**

1. **Make the stale-file check REQUIRED.** It is advisory today: it goes red on the PR but does not
   block, and auto-merge is used on essentially every PR here — so as it stands it informs rather than
   prevents. Adding `stale-file` to `protect-main`'s required-status-checks list is a one-line ruleset
   change and is what converts it from a signal into a gate. **Owner decision.**
2. **`strict_required_status_checks_policy = true`** — still available, still the most complete
   in-repo option, still carrying the rebase-churn cost that made merge queue attractive. `npm run
   rebase` reduces that to one command, which is the honest counter-argument to the cost objection.
3. **Widen the hook's matcher to `Bash`** — closes §3, does nothing for §2. Worth doing on its own
   merits, not as a fix for the concurrent case.
4. **Transfer the repo to an organization** — unlocks merge queue properly. Far beyond a settings
   change, and listed only so the option is not re-discovered as if it were new.

## 5 · What must NOT be done

**Do not describe the hook as covering the PR-merge collision.** It covers the sequential half. Saying
otherwise is the same class of defect this repo keeps finding — a limitation asserted away in prose —
and it is worse here than elsewhere, because the belief that a guard covers you is exactly what stops
the next person looking. Several of my own PR bodies this session said *"the collision
`guard-stale-brief.sh` now denies"*; that phrasing is wrong for §2's case and right for §1's.

## Done when

- [x] **§2 detected 2026-08-09** by the stale-file PR check (#1086), after merge queue was chosen and
      found unavailable on a user-owned repo (§4). Detection is not prevention — see the next box.
- [ ] **§2 PREVENTED** — the check is advisory: it reds the PR but does not block, and auto-merge is
      used on essentially every PR here, so today it informs rather than stops. Add `stale-file` to
      `protect-main`'s required-status-checks list **(owner)**, or record that advisory is enough and
      why.
- [ ] §3 closed by widening the matcher, **or** recorded as accepted with the reason.
- [ ] Any prose claiming the hook covers the concurrent case corrected — `CLAUDE.md` §📌's own wording
      is accurate today (it describes the local query and the fetch-first rule) and needs no change;
      this is about future descriptions.

## Cross-references

- `.claude/hooks/guard-stale-brief.sh` — the guard, its header timeline, and its honest caveats.
- `.github/workflows/stale-file.yml` + `stale-file.test.sh` — the CI half, and the three constructed
  cases it was verified against before being trusted.
- `CLAUDE.md` §📌 — the fetch-first rule the hook's freshness depends on.
- `GENERATOR-FOLLOWUPS-III-2026-08-08-BRIEF.md` — the file both collisions happened on.
- Ruleset `protect-main` (#18794443) — where `strict_required_status_checks_policy` and the
  required-check list live; both remaining owner levers are there.
