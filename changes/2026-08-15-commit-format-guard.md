---
bump: minor
type: added
brief: CAPTURE-HOST-SUBPROCESS-SURFACE-FOLLOWUPS-2026-08-04-BRIEF.md
---

A `git commit` whose staged `*.js`/`*.mjs` are not Biome-clean is now denied, with the one-line fix.

**This is not a correctness gap.** `biome` is one of seven REQUIRED status checks: the PR job runs
`biome ci --changed --since=origin/main`, the push job runs the whole tree, so nothing unformatted
reaches `main`. It is a **latency** gap. The fix costs ~250 ms of `biome format --write`, and without a
commit-time check you learn about it from a 10-minute local gate or a CI round-trip. Measured twice on
2026-08-15 — once *after* a full re-bundle + golden regeneration + `verify-fixtures` chain had already
run, which then had to run again because formatting an inlined file moves the bundle.

**Why not a git pre-commit hook.** That was proposed and declined, with a reason worth keeping
(`CAPTURE-HOST-SUBPROCESS-SURFACE-FOLLOWUPS` §5): a git hook must be *installed*, `core.hooksPath` is
unset here, and several agent sessions share the tree — so the common state is *"a hook that exists
in-repo and runs for nobody"*, which is a gate that does not gate. Verified still true: no
`core.hooksPath`, no `.git/hooks/pre-commit`.

`.claude/settings.json` does not have that problem. It is checked in and every session loads it
automatically — exactly how `guard-shared-tree.sh` and `guard-stale-brief.sh` already work. So this is
the declined hook's idea, installed by a mechanism that reaches the sessions that actually commit here.

⚠️ **It checks the staged paths EXPLICITLY, not `--changed`.** Measured 2026-08-15:
`biome ci --changed --since=origin/main` exited **0** on a format-only violation that was both untracked
and staged, while naming the path caught it. `--changed` is right for the PR job — it must not demand a
legacy file be reformatted because a sibling PR touched it — and wrong for a guard that knows exactly
what you are about to commit.

⚠️ **It FAILS OPEN when Biome cannot run, and that case decides whether the guard is usable.** A fresh
`git worktree` has no `node_modules` — it is gitignored — and that is the checkout `CLAUDE.md` §👥.1
tells every session to make. A guard that blocked every commit there would be switched off within a day.
It guards formatting, not an invariant; CI is the backstop. The self-test asserts the fail-open **and**
that the DENY returns the moment Biome is back, because a fail-open nobody re-tests is just an off
switch.

**Scope kept narrow so it cannot cry wolf:** only staged files (`--diff-filter=ACM`), only `.js`/`.mjs`,
and Biome's own config owns the exclusions rather than a second copy of that list. `git commit-tree`,
`git commit --help` and non-commit commands pass through. Escape hatch `CLAUDE_ALLOW_UNFORMATTED=1` for
a deliberate WIP commit.

The refusal names the offending files, the exact `format --write` command, and — because this bit me —
that a formatted file which is *inlined into a bundle* must be re-bundled **after** formatting, not
before.

18 self-test cases, every DENY paired with an ALLOW differing in one property (staged vs unstaged is the
sharpest: same file, same content, same repo). Wired into `npm run test:hooks`, and the test asserts the
**wiring** as well as the behaviour — a hook that is not in `settings.json` is inert however green its
cases read.
