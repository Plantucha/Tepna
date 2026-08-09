#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-stale-brief.sh — PreToolUse(Edit|Write) guard against SILENTLY OVERWRITING
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
# Escape hatch: CLAUDE_ALLOW_STALE_BRIEF=1 — set it when you have READ the commits it
# names and are deliberately writing over them.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

[ "${CLAUDE_ALLOW_STALE_BRIEF:-}" = "1" ] && exit 0

f="$(jq -r '.tool_input.file_path // empty' 2>/dev/null)" || exit 0
[ -z "$f" ] && exit 0

# Repo-relative, so an absolute path from the tool matches the same rule as a relative one.
root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -z "$root" ] && exit 0
rel="${f#"$root"/}"

# GUARDED SET — the hot shared docs. `briefs/*.md` is where the collision happened;
# DOCS-INDEX.md is the dashboard every brief change touches, so it collides for the
# same reason and by the same mechanism.
case "$rel" in
  briefs/*.md | DOCS-INDEX.md) ;;
  *) exit 0 ;;
esac

git rev-parse --verify -q HEAD >/dev/null 2>&1 || exit 0
git rev-parse --verify -q origin/main >/dev/null 2>&1 || exit 0
base="$(git merge-base HEAD origin/main 2>/dev/null)" || exit 0
[ -z "$base" ] && exit 0

# Commits on origin/main touching THIS file that your branch does not have.
missed="$(git log --oneline --no-decorate "$base"..origin/main -- "$rel" 2>/dev/null)" || exit 0
[ -z "$missed" ] && exit 0

n="$(printf '%s\n' "$missed" | grep -c .)"

cat >&2 <<EOF
BLOCKED: '$rel' has moved on origin/main since your branch's base — $n commit(s) you do not have.

$(printf '%s\n' "$missed" | sed 's/^/    /')

Editing it now is how a written answer disappears. On 2026-08-08 exactly this dropped a
concurrent session's §2 from GENERATOR-FOLLOWUPS-III: no hunks overlapped, so git raised
no conflict, the squash took the newer text, and the brief was left contradicting its own
§4 for two commits. Nothing in CI could have caught it.

READ those commits first — they may already answer what you are about to write:

    git log -p $base..origin/main -- '$rel'

Then rebase so your edit lands ON TOP of them rather than instead of them:

    node tools/rebase-safe.mjs

If you have read them and are deliberately writing over them, say so:

    CLAUDE_ALLOW_STALE_BRIEF=1

(This reads your LOCAL origin/main and never fetches, so it can only UNDER-report.
 \`git fetch origin main\` first if it matters.)
EOF
exit 2
