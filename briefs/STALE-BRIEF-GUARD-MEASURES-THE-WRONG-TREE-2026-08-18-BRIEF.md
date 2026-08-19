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

**FALSE NEGATIVE — INFERRED FROM THE SAME LINE, NOT DEMONSTRATED.** If the root is current and your
worktree is old, `merge-base(root HEAD, origin/main)` is `origin/main`, the query returns nothing, and
the hook **passes** — while your worktree genuinely predates the brief's latest edit. That is exactly
the overwrite the guard was built to stop, and it would be silent, because §📌 already records that this
failure produces **no merge conflict**.

⚠️ **This direction is reasoned from the source, not observed.** An attempt to demonstrate it with a
`--detach HEAD~60` worktree was abandoned when the checkout exceeded the command timeout on this
volume. **Do not cite it as measured until someone runs it.** Stating it as proven would be the same
defect this repo keeps paying for — and the asymmetry is the reason it still belongs in this brief: the
false positive announces itself, the false negative cannot.

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
- [ ] §3's false negative is measured and this brief updated to say so — or refuted and struck.

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
