#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-format.sh — PreToolUse(Bash) guard: a `git commit` whose STAGED *.js/*.mjs
# are not Biome-clean is denied, with the one-line fix.
#
# WHY THIS EXISTS, given `biome` is already a REQUIRED status check. It is not a
# correctness gap — nothing unformatted reaches `main`, because the PR job runs
# `biome ci --changed` and the push job runs the whole tree. It is a LATENCY gap:
# the fix costs ~250 ms of `biome format --write`, and without a commit-time check
# you learn about it from a 10-minute local gate or a CI round-trip. Measured twice
# on 2026-08-15 — once after a full re-bundle + golden regen + `verify-fixtures`
# chain had already run, which then had to run again.
#
# WHY NOT A GIT PRE-COMMIT HOOK. That was proposed and DECLINED with a reason worth
# keeping (CAPTURE-HOST-SUBPROCESS-SURFACE-FOLLOWUPS §5): a git hook must be
# INSTALLED, `core.hooksPath` is unset in this repo, and several agent sessions
# share the tree — so the common state is a hook that exists in-repo and runs for
# nobody. Verified still true here: no `core.hooksPath`, no `.git/hooks/pre-commit`.
#
# `.claude/settings.json` does not have that problem. It is checked in, and every
# session loads it automatically — which is exactly how `guard-shared-tree.sh` and
# `guard-stale-brief.sh` already work. So this is the same idea as the declined git
# hook, installed by a mechanism that actually reaches the sessions that commit.
#
# ⚠ IT CHECKS THE STAGED PATHS EXPLICITLY, NOT `--changed`. Measured 2026-08-15:
# `biome ci --changed --since=origin/main` exited 0 on a format-only violation that
# was both untracked AND staged, while naming the path caught it. `--changed` is
# right for the PR job (it must not demand a legacy file be reformatted because a
# sibling PR touched it) and wrong for this one, which knows exactly what you are
# about to commit.
#
# ⚠ FAILS OPEN when Biome cannot run — deliberately, and this is the case that
# decides whether the guard is usable. A fresh `git worktree` has no `node_modules`
# (it is gitignored), which is the checkout CLAUDE.md §👥.1 tells every session to
# make. A guard that blocked every commit there would be switched off within a day,
# and it guards a FORMATTING nit, not an invariant — CI is the backstop.
#
# Escape hatch: CLAUDE_ALLOW_UNFORMATTED=1 — for a deliberate WIP commit.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

[ "${CLAUDE_ALLOW_UNFORMATTED:-}" = "1" ] && exit 0

payload="$(cat 2>/dev/null)" || exit 0
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -z "$cmd" ] && exit 0

# `git commit` only. `git commit --help`, `git commit-tree` and a commit inside a
# rescue snapshot are not it; the word boundary and the -h guard keep those out.
printf '%s' "$cmd" | grep -qE '(^|[;&|]|\s)git\s+(-[^ ]+\s+|-C\s+\S+\s+)*commit(\s|$)' || exit 0
printf '%s' "$cmd" | grep -qE '\-\-help|\-h\b' && exit 0

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -z "$root" ] && exit 0

# Only what is actually going into the commit. A file edited but not staged is not
# this commit's problem, and saying so is what keeps the guard from crying wolf.
staged="$(git -C "$root" diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep -E '\.(js|mjs)$' || true)"
[ -z "$staged" ] && exit 0

# Biome's own config owns the exclusions (node_modules, uploads/, docs/, *fixture*,
# …), so paths are passed through rather than re-filtered here — a second copy of
# that list is a second thing to drift.
biome="$root/node_modules/.bin/biome"
[ -x "$biome" ] || exit 0                 # no Biome ⇒ FAIL OPEN (see the header)

out="$(cd "$root" && printf '%s\n' "$staged" | xargs -r "$biome" ci --no-errors-on-unmatched 2>&1)" && exit 0

# Non-zero ⇒ something is wrong with what is being committed. Name the files and the
# fix; a refusal that makes you go and find the command is a wall, not a signal.
bad="$(printf '%s' "$out" | grep -oE '^[^ ]+\.(js|mjs)' | sort -u | tr '\n' ' ')"
cat >&2 <<EOF
BLOCKED: staged file(s) are not Biome-clean, and \`biome\` is a REQUIRED check — this commit
would red CI on formatting.

  ${bad:-$(printf '%s' "$staged" | tr '\n' ' ')}

Fix (fast — it is a formatter, not a review):

    npx --no-install biome format --write ${bad:-<the files above>}
    npx --no-install biome ci --no-errors-on-unmatched ${bad:-<the files above>}

Then re-stage and commit. If the failure is a LINT error rather than formatting, the output
below says which rule.

⚠ If these files are inlined into a bundle, formatting changes the inlined text — so re-run
  \`node tools/build.mjs --app <App>\` AFTER formatting, not before, or the bundle drifts.

Deliberate WIP commit? CLAUDE_ALLOW_UNFORMATTED=1

$(printf '%s' "$out" | head -40)
EOF
exit 2
