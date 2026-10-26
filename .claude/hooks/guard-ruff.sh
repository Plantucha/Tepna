#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-ruff.sh — PreToolUse(Bash) guard: a `git commit` whose STAGED capture-host
# *.py are not ruff-clean is denied, with the one-line fix.
#
# THE PYTHON HALF OF `guard-format.sh`. That guard covers *.js/*.mjs via Biome and
# settled the mechanism question — CAPTURE-HOST-SUBPROCESS-SURFACE-FOLLOWUPS §5
# proposed a git pre-commit hook, it was DECLINED (a git hook must be installed,
# `core.hooksPath` is unset here, several sessions share the tree, so the common
# state is a hook that exists in-repo and runs for nobody), and a PreToolUse guard
# was built instead. But it was built for JS only, while §5's actual defect is in
# Python:
#
#   "`pytest --cov` printing 100 % and `ruff` failing on the next line happened in
#    #852 and again in #880, same defect (an unused import), same position. The
#    brief already said to read both. A note is weaker than a check."
#
# So the mechanism was right and the coverage was half. This is the other half.
#
# WHY IT IS WORTH A GUARD given `ruff` is already a CI job: same latency argument
# `guard-format.sh` makes. The fix costs one `--fix` invocation; without a
# commit-time check you learn about it from a ~9-minute `pytest --cov` locally or a
# CI round-trip, and §5 records it happening TWICE at the same position — after the
# coverage run had already printed a reassuring 100 %.
#
# ⚠ STAGED PATHS ONLY, AND ONLY UNDER capture-host/. A guard that lints the whole
# tree on every commit blocks a docs-only or JS-only change for a Python file the
# committer never touched — the "would have blocked every release" failure §5
# itself warns about, and the reason that section says to test a hook against a
# real workflow before proposing it. Measured before writing this: `ruff check .`
# over capture-host's 43 files exits 0 in **9 ms**, so on a clean tree this costs
# nothing and blocks nothing.
#
# ⚠ FAILS OPEN when ruff cannot run, exactly as the Biome guard does and for the
# same reason: ruff lives in `capture-host/.venv`, which is gitignored, so a fresh
# `git worktree` — the checkout CLAUDE.md §👥.1 tells every session to make — has
# no venv at all. A guard that blocked every commit there would be switched off
# within a day. CI is the backstop; this is a latency saver, not the invariant.
# (`check.sh` also treats a missing tool as a MISSING TOOL rather than a failing
# gate — shellcheck absent exits 127 and is reported as such.)
#
# ⚠ BUT "CANNOT RUN" IS NOW THREE CANDIDATES DEEP, AND IT ANNOUNCES ITSELF. This
# guard shipped resolving ruff at `$root/capture-host/.venv/bin/ruff` and then PATH,
# and nothing else. Measured 2026-10-26 on this rig: 28 working trees, ONE holding a
# reachable ruff, and that one the primary checkout — so the guard allowed a
# ruff-dirty staged file at exit 0 in 27 of 28, silently. The sibling got the same
# fix on 2026-09-22 and this file did not (#2883 the three-candidate search, #2896
# the tree). The search now reads this checkout's venv, `$DEX_RUFF`, the PRIMARY
# checkout's venv (derived from `--git-common-dir`), then PATH, and an absent ruff
# prints WHERE it looked once per session. Absent and clean must not look identical.
#
# Overrides: DEX_RUFF=/path/to/ruff pins the binary, the way DEX_BIOME does.
#
# Escape hatch: CLAUDE_ALLOW_UNFORMATTED_RUFF=1 — for a deliberate WIP commit.
# (Split from the shared CLAUDE_ALLOW_UNFORMATTED per residue 2026-09-22-a-hatch-that-leaves-no-trace:
#  one variable per guard. The old shared name no longer works here.)
# purpose. One WIP-commit escape hatch is one thing to remember; two would mean
# discovering the second only after the first failed to work.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

# ⚠ STDIN IS DRAINED FIRST, BEFORE ANY EXIT. The harness writes the tool-call JSON into this
# hook's stdin, so a hatch that exits before reading it leaves the writer on a closed pipe and
# the writer takes SIGPIPE (141 under `pipefail`). Same contract and same fix as trim-output.sh
# (#3493). The test reads the WRITER's fate, because a verdict of "not 2" cannot see it.
payload="$(cat 2>/dev/null)" || exit 0

[ "${CLAUDE_ALLOW_UNFORMATTED_RUFF:-}" = "1" ] && exit 0
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -z "$cmd" ] && exit 0

# `git commit` only — same matcher as guard-format.sh, deliberately identical so the
# two guards cannot disagree about what counts as a commit.
printf '%s' "$cmd" | grep -qE '(^|[;&|]|\s)git\s+(-[^ ]+\s+|-C\s+\S+\s+)*commit(\s|$)' || exit 0
printf '%s' "$cmd" | grep -qE '\-\-help|\-h\b' && exit 0

# ── WHICH TREE? THE COMMAND'S, NOT THE HOOK'S. ──────────────────────────────────
# The hook runs with the SESSION's cwd — the shared root, for nearly every session —
# while the commit runs wherever the command sends it: CLAUDE.md §👥.1 mandates a
# worktree, so the fleet's normal form is `cd <worktree> && git commit` or
# `git -C <worktree> commit`. Resolving the repo from the hook's own cwd therefore
# examined the ROOT's index for a commit happening in a worktree, found nothing
# staged there, and ALLOWED. Measured 2026-09-22 with an unformatted staged plant:
# run with its cwd inside the worktree this guard denies (exit 2); the live
# `cd <wt> && git commit` from the root went straight through. The guard had been
# inert for every worktree commit since it was written, and read as compliance.
# Same defect and same fix as guard-stale-brief.sh
# (STALE-BRIEF-GUARD-MEASURES-THE-WRONG-TREE-2026-08-18-BRIEF §4), one guard over.
#   1. `git -C <dir> … commit` names the tree exactly — take it.
#   2. else the FIRST `cd <dir>` in the command — later ones are subdirectory hops,
#      and the toplevel resolves the same from either.
#   3. else the hook's cwd — the pre-fix behaviour, now the fallback, not the rule.
# A dir that does not exist yet (`git worktree add X && cd X && git commit`) keeps
# the fallback: at PreToolUse time there is no tree to ask. That residual is the
# same one the stale-brief guard documents, and it is narrow — a commit in the
# same command that creates the tree.
tree="$(printf '%s' "$cmd" \
  | grep -oE '(^|[;&|]|\s)git\s+(-[^ ]+\s+)*-C\s+\S+\s+(-[^ ]+\s+)*commit(\s|$)' \
  | head -1 | sed -E 's/^.*-C[[:space:]]+([^[:space:]]+).*$/\1/' | tr -d '\042\047')"
[ -z "$tree" ] && tree="$(printf '%s' "$cmd" \
  | grep -oE '(^|[;&|][[:space:]]*)cd[[:space:]]+([^[:space:];&|]+)' \
  | head -1 | sed -E 's/^.*cd[[:space:]]+//' | tr -d '\042\047')"
tree="${tree/#\~/$HOME}"
{ [ -n "$tree" ] && [ -d "$tree" ]; } || tree="."
root="$(git -C "$tree" rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -z "$root" ] && exit 0

# Only capture-host Python that is actually going into this commit.
staged="$(git -C "$root" diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep -E '^capture-host/.*\.py$' || true)"
[ -z "$staged" ] && exit 0

# ── WHERE IS RUFF? THREE CANDIDATES, AND SAY WHICH WERE TRIED. ──────────────────
# The PRIMARY checkout is DERIVED from git, never hardcoded: a worktree's
# `--git-common-dir` points into the primary's `.git`, so its parent is that checkout.
# Deliberately the same shape as guard-format.sh:134-152 — two guards that resolve
# their tool differently disagree about what "absent" means, and this one held half
# the fix its sibling got on 2026-09-22 (#2883 the three-candidate search, #2896 the
# tree). Residue 2026-09-22-fresh-worktree-silences-both-format-checks named BOTH.
_common="$(cd "$root" && git rev-parse --git-common-dir 2>/dev/null)"
case "${_common:-}" in
  '') _primary='' ;;
  /*) _primary="$(dirname "$_common")" ;;
  *)  _primary="$(cd "$root" && cd "$(dirname "$_common")" 2>/dev/null && pwd)" ;;
esac

# Order: this checkout's venv first (definitionally the right version for this tree),
# then an explicit override, then the PRIMARY's venv, then PATH. The venv copy is the
# pinned one, so PATH goes last — it used to be second, and it is the only reason a
# worktree ever found a ruff at all.
ruff=''
_searched=''
for _cand in "$root/capture-host/.venv/bin/ruff" "${DEX_RUFF:-}" \
             "${_primary:+$_primary/capture-host/.venv/bin/ruff}" \
             "$(command -v ruff 2>/dev/null || true)"; do
  [ -n "$_cand" ] || continue
  _searched="$_searched    $_cand
"
  if [ -x "$_cand" ]; then ruff="$_cand"; break; fi
done

_announce_absent() {
  # jq is known good by now: a payload it could not parse returned at the `cmd` check.
  _sid="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)"
  case "${_sid:-}" in '' | *[!A-Za-z0-9._-]*) _sid=nosession ;; esac
  _marker="${TMPDIR:-/tmp}/tepna-ruff-guard-absent.$_sid"
  [ -f "$_marker" ] && return 0
  : > "$_marker" 2>/dev/null
  cat >&2 <<EOF1
NOTE: this commit was NOT ruff-checked — ruff was not found in this checkout.
This is not a pass. Absent and clean are different states, and here they look identical.

Looked for it at:
$_searched
Either of these fixes it for the rest of this worktree's life:

    ln -s "${_primary:-<no primary>}/capture-host/.venv" "$root/capture-host/.venv"
    export DEX_RUFF=/path/to/a/pinned/ruff

'ruff' is a REQUIRED check, so an unclean file still reds CI — later, and after a
coverage run has already printed a reassuring 100 % (residue
2026-10-21-guard-ruff-selftest-certifies-nothing-without-ruff).

(Said ONCE per session. This guard denies nothing when ruff is absent.)
EOF1
}

# FAIL OPEN when ruff is absent — but audibly, and never as a denial (see the header).
[ -n "$ruff" ] || { _announce_absent; exit 0; }

# ruff's own pyproject config owns the rule selection and exclusions, so paths are
# passed through rather than re-filtered here — a second copy of that list is a
# second thing to drift.
out="$(cd "$root" && printf '%s\n' "$staged" | xargs -r "$ruff" check 2>&1)" && exit 0

bad="$(printf '%s' "$out" | grep -oE '^capture-host/[^ :]+\.py' | sort -u | tr '\n' ' ')"
cat >&2 <<EOF
BLOCKED: staged capture-host file(s) are not ruff-clean, and \`ruff\` is a REQUIRED check — this
commit would red CI on lint.

  ${bad:-$(printf '%s' "$staged" | tr '\n' ' ')}

Fix (most of these are auto-fixable):

    capture-host/.venv/bin/ruff check --fix ${bad:-<the files above>}
    capture-host/.venv/bin/ruff check ${bad:-<the files above>}

Then re-stage and commit.

⚠ A GREEN pytest DOES NOT COVER THIS. \`pytest --cov\` printing 100 % and \`ruff\` failing on the
  very next line is the exact pair that shipped twice (#852, #880, same unused-import defect).
  \`capture-host/check.sh\` runs ruff · shellcheck · pytest together and is the one local
  invocation that answers for all three.

Deliberate WIP commit? CLAUDE_ALLOW_UNFORMATTED_RUFF=1

$(printf '%s' "$out" | head -40)
EOF
exit 2
