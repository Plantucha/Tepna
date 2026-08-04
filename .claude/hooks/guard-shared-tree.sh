#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-shared-tree.sh — PreToolUse(Bash) guard for a repo worked by SEVERAL agent
# sessions at once.
#
# This checkout is routinely shared. Files you did not create are routinely in the
# tree. Two classes of git command are therefore unsafe here, and both have already
# caused real damage:
#
#   BLANKET STAGING  git add -A / git add . / git commit -a
#     Sweeps whatever a concurrent session has in flight into YOUR commit, published
#     under YOUR message. Happened: commit cabd7f7 ("fix(ppgdex): …") also carries an
#     unrelated CPAP brief, its DOCS-INDEX row, and a ledger regen.
#
#   TREE DESTRUCTION  git reset --hard / git checkout . / git restore . /
#                     git stash / git clean -f
#     Discards uncommitted work that may be another session's ONLY copy. Nearly
#     happened: a session tried to reset this tree while another's unbacked-up clock
#     fix was sitting in it.
#
# Denies with an explanation so the agent adjusts rather than retries.
# Read-only forms (git stash list/show) are allowed.
#
# Escape hatch: CLAUDE_ALLOW_BLANKET_GIT=1 (set it deliberately, when you know the
# tree is yours alone).
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

[ "${CLAUDE_ALLOW_BLANKET_GIT:-}" = "1" ] && exit 0

cmd="$(jq -r '.tool_input.command // empty' 2>/dev/null)" || exit 0
[ -z "$cmd" ] && exit 0

deny() {
  jq -nc --arg r "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

# `git add -A` / `--all` / `.` / `:/`  — blanket staging
if grep -qE '(^|[;&|(]|&&|\|\|)[[:space:]]*git[[:space:]]+add[[:space:]]+([^;&|]*[[:space:]])?(-A\b|--all\b|\.([[:space:]]|$)|:/)' <<<"$cmd"; then
  deny "BLOCKED: blanket staging in a SHARED checkout (CONTRIBUTING §6).

Several agent sessions work this repo at once, so the working tree is not yours alone — a blanket add sweeps their in-flight files into your commit, under your message. That is exactly how cabd7f7 ended up carrying an unrelated brief.

Instead: stage by EXPLICIT PATH —
    git add path/to/file-you-actually-changed.js ...
Run 'git status' first; if files you don't recognize are there, LEAVE them.

Better still: work in your own worktree, where this cannot arise —
    git worktree add ../wt-<task> -b claude/<task> origin/main"
fi

# `git commit -a` / `-am` / `--all`  — blanket staging via commit.
# Test against a QUOTE-STRIPPED copy: a commit MESSAGE may legitimately contain "-a"
# (e.g. git commit -m 'fix -a flag parsing') and must not be mistaken for the flag.
# Only this rule strips quotes — `git add "."` must still be caught by the rule above.
cmd_noquotes="$(sed "s/'[^']*'/''/g; s/\"[^\"]*\"/\"\"/g" <<<"$cmd")"
if grep -qE '(^|[;&|(]|&&|\|\|)[[:space:]]*git[[:space:]]+commit\b[^;&|]*([[:space:]]-[a-zA-Z]*a[a-zA-Z]*\b|[[:space:]]--all\b)' <<<"$cmd_noquotes"; then
  deny "BLOCKED: 'git commit -a' stages every tracked modification in a SHARED checkout (CONTRIBUTING §6) — including other sessions' in-flight edits.

Instead: 'git add <explicit paths>' then a bare 'git commit'."
fi

# `git reset --hard` — destroys uncommitted work
if grep -qE '(^|[;&|(]|&&|\|\|)[[:space:]]*git[[:space:]]+reset\b[^;&|]*--hard' <<<"$cmd"; then
  deny "BLOCKED: 'git reset --hard' discards uncommitted work in a SHARED checkout — which may be another session's ONLY copy.

If you must reset, FIRST preserve what is there (this does not touch the tree):
    TREE=\$(GIT_INDEX_FILE=/tmp/rescue.idx sh -c 'cp .git/index /tmp/rescue.idx; git add -A; git write-tree')
    git branch rescue/\$(date +%F)-wip \$(git commit-tree \$TREE -p HEAD -m 'rescue: WIP snapshot')
…then ask the user before discarding anything you did not write."
fi

# `git checkout .` / `git checkout -- .` / `git restore .` — discards working-tree changes
if grep -qE '(^|[;&|(]|&&|\|\|)[[:space:]]*git[[:space:]]+(checkout|restore)[[:space:]]+([^;&|]*[[:space:]])?(--[[:space:]]+)?\.([[:space:]]|$)' <<<"$cmd"; then
  deny "BLOCKED: discarding ALL working-tree changes in a SHARED checkout — they may be another session's only copy.

Restore only the paths you own:
    git checkout -- path/you/changed.js"
fi

# `git stash` (mutating forms) — hides another session's work out from under it
if grep -qE '(^|[;&|(]|&&|\|\|)[[:space:]]*git[[:space:]]+stash([[:space:]]+(push|save|-[a-zA-Z]|--))?([[:space:]]|$)' <<<"$cmd" \
   && ! grep -qE 'git[[:space:]]+stash[[:space:]]+(list|show)\b' <<<"$cmd"; then
  deny "BLOCKED: 'git stash' in a SHARED checkout would sweep another session's uncommitted work into your stash — invisible to them, and easy to lose.

If you need a clean tree, use your OWN worktree instead:
    git worktree add ../wt-<task> -b claude/<task> origin/main
('git stash list' / 'git stash show' are allowed.)"
fi

# `git clean -f` — deletes untracked files (another session's new files)
if grep -qE '(^|[;&|(]|&&|\|\|)[[:space:]]*git[[:space:]]+clean\b[^;&|]*-[a-zA-Z]*f' <<<"$cmd"; then
  deny "BLOCKED: 'git clean -f' DELETES untracked files — which in a shared checkout includes new files another session has not committed yet (briefs, changesets, fixtures).

Delete only what you created, by name."
fi

# `git update-ref refs/heads/<b>` / `git branch -f <b>` / `git push . <src>:<b>` — moving a ref that
# is CHECKED OUT desyncs that checkout silently. Real incident, 2026-08-03: a session advanced
# `refs/heads/main` to `origin/main` each iteration to "sync local main", choosing a bare ref move
# precisely BECAUSE it touches no files. That is safe only while the branch is checked out NOWHERE.
# `main` was checked out in the shared root. HEAD moved, the tree did not, and every file a merged PR
# ADDED began reading as `deleted` while every file it CHANGED read as reverted — 47 D + 167 M, growing
# with each merge. A later blanket `git add -A` staged all 214; committing it would have removed ~25
# pending changesets, live briefs and 6 tools from main, and tripped release-ledger check 7.
# The tell it hides: `git rev-list --count main..origin/main` reads 0 — the REF is synced, the checkout
# is not. Verifying the ref and reporting it as the checkout is how this ran unnoticed for 5 iterations.
if grep -qE '(^|[;&|(]|&&|\|\|)[[:space:]]*git[[:space:]]+(update-ref[[:space:]]+refs/heads/|branch[[:space:]]+(-f|--force)[[:space:]])' <<<"$cmd" \
   || grep -qE '(^|[;&|(]|&&|\|\|)[[:space:]]*git[[:space:]]+push[[:space:]]+\.[[:space:]]' <<<"$cmd"; then
  deny "BLOCKED: moving a branch ref by hand desyncs any checkout that HAS that branch out — the ref
advances, the working tree does not, and every newly-merged file then reads as DELETED. That is what
produced 47 phantom deletions of live files on 2026-08-03.

You almost certainly do not need a local branch ref at all — a worktree can branch straight off the
remote-tracking ref:
    git worktree add ../wt-<task> -b claude/<task> origin/main

If a local branch really must advance, do it IN the checkout that holds it, so tree + index + ref move
together — and confirm first that it is checked out nowhere else:
    git worktree list | grep '\[<branch>\]'
    git -C <that-checkout> merge --ff-only origin/<branch>

Note: 'git rev-list --count <branch>..origin/<branch>' returning 0 does NOT mean the checkout is in
sync — only that the ref is. Check 'git -C <checkout> status --short' too."
fi

exit 0
