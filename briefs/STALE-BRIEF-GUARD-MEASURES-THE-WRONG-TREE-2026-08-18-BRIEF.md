<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED · **Created:** 2026-08-18 · **Affects:** `.claude/hooks/guard-stale-brief.sh`

# The stale-brief guard measures the SHARED ROOT, not the worktree you are editing in

## 1 · The defect, in one line

`.claude/hooks/guard-stale-brief.sh:113` is

```sh
base="$(git merge-base HEAD origin/main 2>/dev/null)" || exit 0
```

— **no `-C`, no `cd`.** A `PreToolUse` hook runs with its cwd set to `$CLAUDE_PROJECT_DIR`, so `HEAD`
resolves in the **shared root checkout**, never in the worktree where the edit is actually happening.

The guard therefore answers a question nobody asked: *"has this brief moved since the ROOT checkout's
HEAD?"* — while the thing it exists to protect is *"has it moved since MY branch's base?"*

## 2 · Why this matters more than a normal hook bug

`CLAUDE.md` §👥.1 **mandates** working in a private worktree (*"Always worktree when you will touch a
bundle, a ledger, or a DSP"*), and §👥.2b-bis records that the shared root is the checkout most likely
to be stale — measured at 92, then 248, then 255 commits behind. So the guard reads its answer from
**precisely the tree the rest of `CLAUDE.md` tells you not to trust**, for **precisely the sessions it
is meant to cover**.

## 3 · Two failure directions — one measured, one inferred, and they are NOT symmetric

**FALSE POSITIVE — measured 2026-08-18.** Editing `DOCS-INDEX.md` from a worktree created off current
`origin/main`, the hook blocked with *"1 commit(s) you do not have — `084db04e` (#1504)"*. That commit
**was my own HEAD**:

```
git merge-base --is-ancestor 084db04e HEAD   → true
git rev-list --count HEAD..origin/main       → 0
```

The merge-base the hook printed (`82f80c5b…`) belongs to the root checkout, which was 1 behind. Cost:
one confused rebase (`rebase-safe` correctly reported *"already up to date — nothing to rebase"*, which
is the tell), then the escape hatch used on a branch that needed no hatch. Annoying, visible, survivable.

**FALSE NEGATIVE — NOW MEASURED, AND IT IS TOTAL RATHER THAN OCCASIONAL.** An earlier draft of this
brief called this direction *inferred, not demonstrated*, and declined to claim it. It is now
demonstrated, without needing the stale worktree the first attempt timed out on — because the whole
decision path is four lines and the last one is unconditional:

```sh
base="$(git merge-base HEAD origin/main)"          # resolved in the ROOT
missed="$(git log "$base"..origin/main -- "$rel")" # per guarded path
[ -z "$first" ] && exit 0                          # nothing missed → ALLOW
```

There is no other check; the full function was read end to end. So **if the root sits at `origin/main`,
`base` IS `origin/main`, and `base..origin/main` is empty BY CONSTRUCTION for every path** — the guard
allows every edit, from every worktree, however stale.

Measured 2026-08-18, in the shared root:

```
root HEAD    6857a286
origin/main  6857a286        rev-list --count HEAD..origin/main = 0
merge-base HEAD origin/main == origin/main   → YES

hook query for DOCS-INDEX.md                                → ''   (empty)
hook query for briefs/FABRICATED-DEFAULTS-FLEET-…-BRIEF.md  → ''   (empty)
```

Both files **moved on `origin/main` within the last 20 commits**. The guard would have allowed an edit
to either from a worktree of any age. **It is a no-op right now, for everyone.**

## 3b · The part that makes this urgent: TWO CORRECT FIXES COMBINED INTO A SILENT HOLE

The guard's answer depends on the root being STALE. It can only ever block when
`merge-base(root HEAD, origin/main) ≠ origin/main`.

`tepna-sync-main.timer` fast-forwards the root every **15 minutes**, and the 2026-08-18 root drain
removed the permanent-skip condition that had been defeating it. Both were correct and both were wanted.
Their combined effect is that the root now tracks `origin/main` continuously — **so the stale-brief
guard is disabled continuously.**

Inverted, and this is the sentence to remember: **the guard only worked while the root was broken.**
Every hour spent fixing root staleness was an hour spent silently switching this off, and nothing
reported it, because a guard that allows everything is indistinguishable from a guard with nothing to
block. `npm run test:hooks` cannot see it either — its self-test exercises the hook's own logic, not the
tree the logic reads.

⚠️ This also retires the reassurance in §👥.2b-bis. *"Hook-enforced means Claude Code, in a checkout that
pulled it"* implies a pulled checkout is the SAFE state. For this guard it is the DISABLED state.

## 4 · Fix

Resolve the repository from the **edited file's** path, not the hook's cwd:

```sh
target_dir="$(dirname "$file")"
base="$(git -C "$target_dir" merge-base HEAD origin/main 2>/dev/null)" || exit 0
```

`git -C <path>` inside a worktree resolves that worktree's `HEAD`, and inside the root resolves the
root's — so the one-checkout case is unchanged and the worktree case starts being answered correctly.

**Done when**

- [ ] The hook resolves `HEAD` from the edited file's directory.
- [ ] `npm run test:hooks` covers **both** directions with a control that must fire: a stale worktree
      whose brief moved must be **DENIED**, and a current worktree whose root lags must be **ALLOWED**.
      A one-directional test would pass today.
- [x] **DONE 2026-08-18 — §3's false negative is MEASURED** (root at `origin/main`; the hook's own
      query returns empty for two briefs that moved within 20 commits). It is not occasional: the guard
      is a no-op whenever the root is current, which the 15-minute sync timer now guarantees.
- [ ] A test that would have caught THIS: assert the guard blocks when the EDITING tree is stale while
      the root is current. Today every hook test runs in one checkout, where the two are the same tree,
      so no existing test can distinguish them.

## 5 · A second, smaller finding

The hook matches on the **command string**, so a Bash call that merely *mentions* a guarded path is
blocked even when it only reads it (`grep -n … DOCS-INDEX.md` was denied). That is defensible for a
`PreToolUse` guard that cannot parse intent, and it is worth knowing before assuming a block means your
edit was the problem — the same command with the mention removed ran fine.

## 6 · Related

- `CLAUDE.md` §📌 — the rule this guard enforces, and the 2026-08-08 incident that motivated it.
- `CLAUDE.md` §👥.2b-bis — *"HOOK-ENFORCED means Claude Code, in a checkout that pulled it"*. This is a
  third narrowing: **and measured against that checkout's HEAD, not yours.**
- `briefs/AGENT-NEUTRAL-GUARDS-2026-08-15-BRIEF.md` — why detection is agent-neutral and prevention is
  not; the CI-side `stale-file` workflow is unaffected, since it measures the PR's own merge-base.
