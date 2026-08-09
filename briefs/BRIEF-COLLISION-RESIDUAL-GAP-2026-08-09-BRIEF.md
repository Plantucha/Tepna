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

## 4 · What would actually close §2

In order of leverage, and the first one probably makes the others unnecessary:

1. **Branch protection: "Require branches to be up to date before merging."** A one-setting change on
   the repo. It forces the stale branch to rebase onto current `main` before the merge button works, so
   the second PR either conflicts (visible) or re-applies onto the text the first one landed. It is the
   only mechanism here that sees both PRs, because it runs at the moment both exist. Given #1066 was
   opened *"per owner request, after it happened twice in one day"*, this is the setting to reach for.
   **This is an owner action — it is not in the repo.**
2. **A PR-level CI check** — fail when a file the PR touches has changed on `main` since the PR's
   merge-base. Same query as the hook, run where the hook cannot stand. Redundant if (1) is enabled;
   worth it only if (1) is undesirable for other reasons.
3. **Widen the matcher to `Bash`** for the guarded paths. Cheap, closes §3, and does nothing for §2 —
   and parsing shell for file writes is the losing game `guard-shared-tree.sh` documents as its own
   known gap. Do it for §3's sake, not as a fix for §2.

## 5 · What must NOT be done

**Do not describe the hook as covering the PR-merge collision.** It covers the sequential half. Saying
otherwise is the same class of defect this repo keeps finding — a limitation asserted away in prose —
and it is worse here than elsewhere, because the belief that a guard covers you is exactly what stops
the next person looking. Several of my own PR bodies this session said *"the collision
`guard-stale-brief.sh` now denies"*; that phrasing is wrong for §2's case and right for §1's.

## Done when

- [ ] §2 addressed by branch protection **(owner)**, or a conscious decision recorded here that
      concurrent brief edits are tolerable and the reconciliation cost is accepted.
- [ ] §3 closed by widening the matcher, **or** recorded as accepted with the reason.
- [ ] Any prose claiming the hook covers the concurrent case corrected — `CLAUDE.md` §📌's own wording
      is accurate today (it describes the local query and the fetch-first rule) and needs no change;
      this is about future descriptions.

## Cross-references

- `.claude/hooks/guard-stale-brief.sh` — the guard, its header timeline, and its honest caveats.
- `CLAUDE.md` §📌 — the fetch-first rule the hook's freshness depends on.
- `GENERATOR-FOLLOWUPS-III-2026-08-08-BRIEF.md` — the file both collisions happened on.
