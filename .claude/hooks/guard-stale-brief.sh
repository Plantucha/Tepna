#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-stale-brief.sh — PreToolUse(Edit|Write|Bash) guard against SILENTLY OVERWRITING
# a brief that someone else already answered.
#
# THE FAILURE, twice on one file in one day (2026-08-08, GENERATOR-FOLLOWUPS-III):
#
#   #1016 created the brief with §1/§2 as open questions.
#   #1034 answered §2 — MotionDex accidental, proven by EXECUTION (31,200 parsed rows).
#   #1050 answered §1 — swept 6 park claims, found 2 stale.
#   #1055 answered §1 and §2 again, from a branch based BEFORE #1034 — and the squash
#         took it, dropping #1034's answer entirely.
#
# Nothing conflicted. Git had no overlapping hunk to complain about, so no rebase was
# triggered and no CI check could see it: the brief simply lost a better-evidenced
# answer and sat for two commits CONTRADICTING ITS OWN §4. Then it happened AGAIN —
# two sessions independently wrote the same reconciliation (#1059, #1061), because
# neither could see the other coming either.
#
# THE CHECK. Not "did you remember to look" — that is unenforceable. Instead: is your
# base actually stale FOR THIS FILE?
#
#     git log <merge-base HEAD origin/main>..origin/main -- <the brief>
#
# Non-empty ⇒ commits touching this exact brief exist on origin/main that your branch
# does not contain ⇒ editing it now can silently drop them. That is precisely the
# condition that bit #1055, and it is cheap to evaluate.
#
# ⚠ FRESHNESS. This reads the LOCAL `origin/main` ref; it never fetches (a PreToolUse
# hook must not block on the network). So it is only as current as your last fetch —
# it can under-report, never over-report. `CLAUDE.md` §📌 therefore says fetch first.
#
# ⚠ FAILS OPEN, deliberately, and this is the one place that choice is right. If git
# is unavailable, `origin/main` is missing, or HEAD is unborn, the guard cannot know —
# and blocking every documentation edit on a git hiccup would cost far more than the
# bug it prevents. It guards a WRITE-OVER, not a correctness invariant; the CLAUDE.md
# rule is the backstop. (Contrast `tools/rebase-safe.mjs`, which fails CLOSED because
# there a wrong guess reverts source.)
#
# ⚠ SCOPE. This covers the SEQUENTIAL collision — the other work has merged and you have
# fetched. It structurally CANNOT cover the CONCURRENT one (two PRs open at once, neither
# merged), because the information does not exist on any ref for it to read. That half is
# `.github/workflows/stale-file.yml`, which reads the real ref on the PR. Do not describe
# this hook as covering the concurrent case — BRIEF-COLLISION-RESIDUAL-GAP §5.
#
# Escape hatch: CLAUDE_ALLOW_STALE_BRIEF=1 — set it when you have READ the commits it
# names and are deliberately writing over them. TWO forms, because a hook cannot see the
# environment of the command it is gating:
#   * EXPORTED in the environment Claude Code runs in — the only form that reaches the
#     Edit/Write path, where there is no command text to carry a prefix.
#   * a COMMAND-POSITION prefix inside a Bash command (`… && CLAUDE_ALLOW_STALE_BRIEF=1 git
#     rebase …`). Measured 2026-09-02: this hook runs as a separate process BEFORE the command
#     it gates, so an inline prefix never reaches the check at line ~54 — while both this
#     hook's own denial text and CLAUDE.md §📌 presented it as if it did. A session that had
#     read the upstream commits and reached for the documented hatch was denied anyway, twice,
#     with no way to tell the hatch from a broken guard. Honouring it here makes the
#     documentation true rather than making the guard weaker: the prefix is self-declared
#     exactly like the exported form, and the operator typing it is making the same claim.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

[ "${CLAUDE_ALLOW_STALE_BRIEF:-}" = "1" ] && exit 0

# stdin is readable ONCE, and this hook now asks it two questions (Edit/Write carry a
# `file_path`; Bash carries a `command`), so the payload is buffered rather than piped twice.
payload="$(cat 2>/dev/null)" || exit 0
f="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -z "$f" ] && [ -z "$cmd" ] && exit 0

# The inline half of the hatch (see the header). COMMAND POSITION only — start of the command,
# or straight after a `;`/`&&`/`||`/`|`/newline — so the assignment has to be one the shell would
# actually apply. A bare occurrence anywhere in the text (an echo, a grep pattern, a here-doc
# line) must NOT release the guard, or quoting the variable's name in prose would disable it.
# One line and guarded: a bare `exit 0` on its own line is the dead-code shape this hook's own
# self-test refuses, because one of those short-circuits the guard into a no-op while every
# behavioural leg still reads green.
printf '%s' "${cmd:-}" | grep -qE '(^|[;&|])[[:space:]]*CLAUDE_ALLOW_STALE_BRIEF=1[[:space:]]' && exit 0

# ── RESOLVE THE REPOSITORY FROM THE EDITED FILE, NOT FROM THE HOOK'S CWD ───────
#    A PreToolUse hook runs with cwd = $CLAUDE_PROJECT_DIR (the shared root). CLAUDE.md §👥.1
#    MANDATES working in a private worktree, so in the real deployment the tree being EDITED is
#    almost never the tree this process is standing in — and every `git` below silently answered
#    about the wrong one. Two independent defects, both fixed by `-C`:
#      · `--show-toplevel` returned the ROOT, so `rel="${f#"$root"/}"` failed to strip a path from
#        another worktree, `cands` came out empty, and the hook ALLOWED.
#      · `merge-base HEAD origin/main` read the ROOT's HEAD, so staleness was asked of a tree the
#        author was not editing.
#    Measured 2026-08-18: with the root at origin/main (which `tepna-sync-main.timer` now keeps it
#    at, every 15 min) `base` IS `origin/main`, so `base..origin/main` is empty BY CONSTRUCTION and
#    the guard allowed EVERY edit, repo-wide. It could only ever block while the root was stale —
#    i.e. it worked only while the root was broken, and fixing the root silently switched it off.
#    See briefs/STALE-BRIEF-GUARD-MEASURES-THE-WRONG-TREE-2026-08-18-BRIEF.md.
#
#    ⚠ The Bash path has no file argument, so it still falls back to the hook's cwd. That residual
#      gap is documented rather than hidden: a computed edit from a worktree is measured against the
#      root until the payload carries a cwd we can trust.
edit_dir="."
[ -n "$f" ] && edit_dir="$(dirname "$f")"

# ── THE BASH ROUTE'S TREE, from a leading `cd` ────────────────────────────────
#    The gap the block above documents: a computed edit carries no file_path, so `edit_dir`
#    stayed "." — the hook's cwd, i.e. the shared root — and staleness was asked of a tree the
#    author was not editing. Measured 2026-08-20: three consecutive FALSE DENIALS in one session,
#    each naming a commit the editing worktree already contained, because the root had drifted a
#    few commits behind while the worktree was current.
#
#    A computed edit in this repo almost always announces its tree, because CLAUDE.md §👥.1
#    mandates a worktree and the hook's own cwd is the root: the command opens `cd <worktree> &&`.
#    Take the FIRST such `cd` — later ones in a compound command are subdirectory hops, and the
#    repo toplevel resolves the same from either. Anything unparseable leaves `edit_dir` alone, so
#    this can only ever move the query CLOSER to the edited tree, never further.
if [ -z "$f" ] && [ -n "$cmd" ]; then
  cd_dir="$(printf '%s' "$cmd" \
    | grep -oE '(^|[;&|][[:space:]]*)cd[[:space:]]+([^[:space:];&|]+)' \
    | head -1 | sed -E 's/^.*cd[[:space:]]+//' | tr -d '\042\047')"
  [ -n "$cd_dir" ] && [ -d "$cd_dir" ] && edit_dir="$cd_dir"
fi

[ -d "$edit_dir" ] || edit_dir="."

# Repo-relative, so an absolute path from the tool matches the same rule as a relative one.
root="$(git -C "$edit_dir" rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -z "$root" ] && exit 0

# ⚠ ANCHOR EVERY LATER QUERY AT `$root`, NOT AT `$edit_dir`. `git -C <dir>` also makes PATHSPECS
#   relative to <dir>, so `-- briefs/X.md` from inside `briefs/` looks for `briefs/briefs/X.md` and
#   matches nothing — which reads as "did not move upstream" and ALLOWS. The first draft of this fix
#   did exactly that and turned three DENY cases into ALLOWs; the self-test's anti-vacuity legs are
#   what caught it. `$root` is the edited file's own worktree toplevel, so pathspecs resolve as the
#   guarded-set rule already assumes.
G() { git -C "$root" "$@"; }

# GUARDED SET — the hot shared docs. `briefs/*.md` is where the collision happened;
# DOCS-INDEX.md is the dashboard every brief change touches, so it collides for the
# same reason and by the same mechanism.
GUARDED_RE='(briefs/[A-Za-z0-9._@+-]+\.md|DOCS-INDEX\.md)'

# ── §3 of BRIEF-COLLISION-RESIDUAL-GAP: the matcher was `Edit|Write`, which is a TOOL
#    name and not a file write. Every computed edit — `python3 - <<'PY'`, `cat > f`,
#    `sed -i` — arrives through `Bash` and bypassed this guard completely. That is not a
#    hypothetical: the session that WROTE that brief made four such edits to DOCS-INDEX.md
#    and a brief, all unguarded, because placing a table row is easier to compute than to
#    hand-write. The sibling `guard-shared-tree.sh` matches `Bash` for exactly this reason.
#
#    A command is only inspected when it is WRITE-SHAPED. Naming a brief is not enough —
#    this hook's own remedy tells you to run `git log -p … -- <brief>`, and a guard that
#    denied its own advice would be worse than the gap. So: a redirect/tee/cp/mv aimed at a
#    guarded path, an in-place sed, or an interpreter opening a file for writing.
#
#    ⚠ It is a HEURISTIC over shell text, and it is tuned to over- rather than under-fire:
#    a read piped into a file (`grep x briefs/A.md > /tmp/o`) is write-shaped by this rule.
#    That costs a denial only when the brief ACTUALLY moved upstream — the staleness query
#    still gates every path — and the message names the commits and the escape hatch.
looks_like_write() {
  # A RUN OF ≥3 '>' IS A CONFLICT MARKER, NOT A REDIRECT — strip those runs before the redirect
  # test. Measured 2026-09-02: `grep -n "<<<<<<<\|=======\|>>>>>>>" briefs/X.md`, i.e. the standard
  # way to find conflict hunks after a rebase, matched `>` followed by a guarded path and was denied
  # as a write. That is a READ, and it is the read a session performs while doing the very thing this
  # guard asks for (rebase onto the upstream edits). No shell redirect uses three '>' — `>` and `>>`
  # are the whole vocabulary — so removing longer runs cannot hide a real write.
  local probe
  probe="$(printf '%s' "$1" | sed 's/>\{3,\}//g')"
  printf '%s' "$probe" | grep -qE "(>>?|\btee\b|\bcp\b|\bmv\b|\btruncate\b)[^|;&]*${GUARDED_RE}" && return 0
  printf '%s' "$1" | grep -qE '\bsed\b[^|;&]*(-[A-Za-z]*i\b|--in-place)' && return 0
  if printf '%s' "$1" | grep -qE '\b(python3?|node|perl|ruby|php)\b'; then
    # The path is usually behind a variable here, so no adjacency test can see it — the
    # write VERB is the only available signal.
    printf '%s' "$1" | grep -qE "(open\([^)]*['\"]w|\.write\(|writeFileSync|writeFile\(|>>?[[:space:]]*['\"]?briefs/)" && return 0
  fi
  return 1
}

cands=""
if [ -n "$f" ]; then
  rel="${f#"$root"/}"
  case "$rel" in
    briefs/*.md | DOCS-INDEX.md) cands="$rel" ;;
    *) : ;;
  esac
elif looks_like_write "$cmd"; then
  cands="$(printf '%s' "$cmd" | grep -oE "$GUARDED_RE" | sort -u)"
fi
[ -z "$cands" ] && exit 0

G rev-parse --verify -q HEAD >/dev/null 2>&1 || exit 0
G rev-parse --verify -q origin/main >/dev/null 2>&1 || exit 0
base="$(G merge-base HEAD origin/main 2>/dev/null)" || exit 0
[ -z "$base" ] && exit 0

# Commits on origin/main touching EACH candidate that your branch does not have.
report=""; first=""; n=0
while IFS= read -r rel; do
  [ -z "$rel" ] && continue
  missed="$(G log --oneline --no-decorate "$base"..origin/main -- "$rel" 2>/dev/null)" || continue
  [ -z "$missed" ] && continue
  [ -z "$first" ] && first="$rel"
  n=$((n + $(printf '%s\n' "$missed" | grep -c .)))
  report="$report
  $rel
$(printf '%s\n' "$missed" | sed 's/^/    /')"
done <<EOF
$cands
EOF
[ -z "$first" ] && exit 0

cat >&2 <<EOF
BLOCKED: a guarded doc has moved on origin/main since your branch's base — $n commit(s) you do not have.
$report

Editing it now is how a written answer disappears. On 2026-08-08 exactly this dropped a
concurrent session's §2 from GENERATOR-FOLLOWUPS-III: no hunks overlapped, so git raised
no conflict, the squash took the newer text, and the brief was left contradicting its own
§4 for two commits. Nothing in CI could have caught it.

READ those commits first — they may already answer what you are about to write:

    git log -p $base..origin/main -- '$first'

Then rebase so your edit lands ON TOP of them rather than instead of them:

    node tools/rebase-safe.mjs

If you have read them and are deliberately writing over them, say so:

    CLAUDE_ALLOW_STALE_BRIEF=1 <your bash command>      (command position — the prefix is read
                                                         from the command text)
    export CLAUDE_ALLOW_STALE_BRIEF=1                   (REQUIRED for an Edit/Write: that path
                                                         carries no command text, so the variable
                                                         must already be in this hook's own
                                                         environment. An inline prefix cannot
                                                         reach it.)

(This reads your LOCAL origin/main and never fetches, so it can only UNDER-report.
 \`git fetch origin main\` first if it matters.)
EOF
exit 2
