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
# `.claude/settings.json` is a better mechanism: it is checked in, so it installs by
# being merged rather than by anyone running a command — which is exactly how
# `guard-shared-tree.sh` and `guard-stale-brief.sh` already work.
#
# ⚠ BUT IT IS NOT AUTOMATIC, AND THE FIRST DRAFT OF THIS HEADER OVERSTATED IT. A
# session reads `.claude/settings.json` from ITS OWN project checkout, so a hook
# takes effect only once that checkout has pulled. Measured immediately after this
# landed: the shared root was 92 commits behind, with neither the wiring nor this
# script — so for a window after merge, this guard was in-repo and running for
# NOBODY, which is the exact property the git hook was declined for. The difference
# is real but narrower than "automatic": a git hook needs `core.hooksPath` set and
# stays off forever; this needs a `git pull` and then stays on.
#
# It degrades safely, verified rather than assumed: a checkout with the wiring but
# not the script runs `bash <missing>` -> exit **127**, and the harness denies only
# on 2. So a half-synced checkout ALLOWS. Both halves fail open, in the same
# direction as the no-Biome case below.
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
# ⚠ BUT FAILING OPEN SILENTLY WAS THE WHOLE DEFECT, AND IT IS NOW TWO FIXES, NOT ONE
# (residue 2026-09-22-fresh-worktree-silences-both-format-checks, Heron). In a fresh
# worktree this guard was silent AND the local `./node_modules/.bin/biome` exits 127,
# which under the usual `> /dev/null 2>&1` reads as no output and a recorded exit —
# i.e. CLEAN. Two mechanisms sharing one blind spot, in the environment §👥.1
# MANDATES. Measured cost on #2882: the file reached CI unformatted, CI's Biome
# reflowed an array across 14 lines, a source-scanning gate anchored on the
# single-line literal then matched nothing, and it surfaced as SIX broken features
# that were one blind gate. So: (1) look harder for Biome before giving up, and
# (2) if it is still absent, SAY SO — absent and clean are different states.
#
# ⚠ THE BINARY IS RELOCATABLE; THE CWD IS NOT. Biome discovers `biome.json` by
# walking up from the CWD, never from the path it is handed. Measured 2026-09-22 on
# one file with one binary: `tools/rebase-safe.mjs` is CLEAN checked from inside its
# worktree, and raises `lint/style/useTemplate` checked by ABSOLUTE PATH from a
# directory outside the project — because out there Biome falls back to DEFAULT
# rules. Borrowing another checkout's binary is safe; borrowing it without the `cd`
# invents violations in clean files, which is strictly worse than the silence being
# closed here. The `cd "$root"` on the run line is load-bearing, not tidiness.
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
# The PRIMARY checkout is DERIVED from git, never hardcoded: a worktree's
# `--git-common-dir` points into the primary's `.git`, so its parent is that checkout.
_common="$(cd "$root" && git rev-parse --git-common-dir 2>/dev/null)"
case "${_common:-}" in
  '') _primary='' ;;
  /*) _primary="$(dirname "$_common")" ;;
  *)  _primary="$(cd "$root" && cd "$(dirname "$_common")" 2>/dev/null && pwd)" ;;
esac

# Order: this checkout first (definitionally the right version for this tree), then an
# explicit override, then the primary's. Same search-and-print-what-you-looked-at shape
# as tools/verify-fixtures.mjs, so "absent" is a conclusion someone can check.
biome=''
_searched=''
for _cand in "$root/node_modules/.bin/biome" "${DEX_BIOME:-}" "${_primary:+$_primary/node_modules/.bin/biome}"; do
  [ -n "$_cand" ] || continue
  _searched="$_searched    $_cand
"
  if [ -x "$_cand" ]; then biome="$_cand"; break; fi
done

_announce_absent() {
  # jq is known good by now: a payload it could not parse returned at the `cmd` check.
  _sid="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)"
  case "${_sid:-}" in '' | *[!A-Za-z0-9._-]*) _sid=nosession ;; esac
  _marker="${TMPDIR:-/tmp}/tepna-format-guard-absent.$_sid"
  [ -f "$_marker" ] && return 0
  : > "$_marker" 2>/dev/null
  cat >&2 <<EOF1
NOTE: this commit was NOT format-checked — Biome was not found in this checkout.
This is not a pass. Absent and clean are different states, and here they look identical.

Looked for it at:
$_searched
Either of these fixes it for the rest of this worktree's life:

    ln -s "$_primary/node_modules" "$root/node_modules"
    export DEX_BIOME=/path/to/a/pinned/biome

'biome' is a REQUIRED check, so an unformatted file still reds CI — later, and with
output that does not name formatting anywhere (residue
2026-09-22-fresh-worktree-silences-both-format-checks).

(Said ONCE per session. This guard denies nothing when Biome is absent.)
EOF1
}

# FAIL OPEN when Biome is absent — but audibly, and never as a denial (see the header).
[ -n "$biome" ] || { _announce_absent; exit 0; }

# ⚠ The `cd "$root"` is load-bearing — see "THE BINARY IS RELOCATABLE" in the header.
# Biome reads biome.json by walking up from the CWD, so a borrowed binary run from
# anywhere else silently applies DEFAULT rules and reports violations that are not real.
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
