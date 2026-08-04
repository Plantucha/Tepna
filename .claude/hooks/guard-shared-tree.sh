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

cmdn="${cmd//\\$'\n'/ }"; cmdn="${cmdn//$'\n'/ }"      # fold continuations + newlines
cmd_noquotes="$(sed "s/'[^']*'/''/g; s/\"[^\"]*\"/\"\"/g" <<<"$cmdn")"
GITX='(^|[^[:alnum:]_-])([^[:space:];&|]*/)?git([[:space:]]+(-[cC][[:space:]]*[^[:space:]]+|--git-dir=[^[:space:]]+|--work-tree=[^[:space:]]+|--exec-path=[^[:space:]]*|--no-pager))*[[:space:]]+'
QT='["'"'"']?'

# HOW A RULE IS MATCHED — read this before adding one.
#
# Rules match $cmdn: the RAW command with line-continuations and newlines folded to spaces. RAW,
# because a quote-stripped match cannot see `bash -c "git add -A"`. FOLDED, because grep is
# line-oriented, so `git add \<newline> -A` otherwise splits across two lines and matches nothing —
# that one defeats every rule in this file at once.
#
# The single exception is the `commit` rule, which matches $cmd_noquotes: a commit MESSAGE legitimately
# contains these strings ("fix -a flag parsing"), and there is no non-Bash path to a commit message,
# so a raw match there blocks documenting the very rules in this file. Stripping quotes for that ONE
# rule does not reopen `bash -c "..."`, because the add/reset/clean rules still match it raw.
#
# Every rule composes $GITX rather than spelling its own anchor. $GITX absorbs a path prefix
# (/usr/bin/git) and git's global options (-C <p>, -c k=v, --git-dir=). Those defeated six of the
# seven rules when each rule hand-rolled its anchor and only update-ref handled -C.
#
# KNOWN GAPS — this guard stops the accidental form, not a determined one. It cannot see through
# shell evaluation: `G=git; $G add -A`, `$(echo git) add -A`, `echo -A | xargs git add`, or a
# `-c alias.z=...` indirection. Do not describe it as complete.


deny() {
  jq -nc --arg r "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

# `git update-ref refs/heads/X` — moving a ref that may be CHECKED OUT
#
# THE REF IS NOT THE TREE. `update-ref` is PLUMBING: it moves the ref and touches neither the
# working tree nor the index, and unlike every porcelain equivalent it performs NO worktree check.
# Compare, on a checked-out `main`:
#     git fetch origin main:main      -> "refusing to fetch into branch ... checked out at ..."
#     git branch -f main origin/main  -> "cannot force update the branch 'main' used by worktree ..."
#     git push . origin/main:main     -> refused
#     git update-ref refs/heads/main  -> SILENTLY SUCCEEDS
#
# 2026-08-03: a session ran it every iteration to "sync local main". Sound while main was not
# checked out; it later was, and nobody re-checked. HEAD then advanced while the tree stayed frozen,
# so every file a merged PR ADDED read as deleted. A subsequent `git add -A` staged 214 entries
# including 47 live-file deletions — 25 of them changesets, which would have silently dropped ~20
# parallel work-units from the next changelog. The count GREW with every merge instead of converging.
#
# The check that hid it: `git rev-list --count HEAD..origin/main` returned 0. The ref WAS synced.
_RE2="$GITX"'(update-ref([[:space:]]+--stdin|[[:space:]]+(-d[[:space:]]+|--no-deref[[:space:]]+)*'"$QT"'refs/heads/)|branch[[:space:]]+([^;&|]*[[:space:]])?(-f|--force)|push[[:space:]]+\.([[:space:]]|$)|symbolic-ref[[:space:]]+HEAD)'
if grep -qE "$_RE2" <<<"$cmdn"; then
  deny "BLOCKED: 'git update-ref refs/heads/...' in a shared checkout.

THE REF IS NOT THE TREE. update-ref is plumbing — it moves the ref and touches neither the working tree nor the index, and it is the ONLY form that skips git's checked-out-branch check. Every porcelain equivalent already refuses by name:

    git fetch origin main:main      refusing to fetch into branch ... checked out at ...
    git branch -f main origin/main  cannot force update the branch 'main' used by worktree ...

If the branch is checked out anywhere, moving its ref silently desynchronises that tree: files a merged PR ADDED then read as DELETED, and the next blanket add stages them for removal. That happened on 2026-08-03 — 47 live files, 25 of them changesets.

Instead, use the porcelain and let it refuse:
    git fetch origin main:main          # fails loudly if main is checked out
    # or work in your own worktree off origin/main and never touch local main at all

And to CHECK a tree is in sync, use 'git status --porcelain' (the tree), not 'git rev-list --count HEAD..origin/main' (the ref). The ref comparison returned 0 the whole time."
fi

# `git add -A` / `--all` / `.` / `:/`  — blanket staging
_RE="$GITX"'add[[:space:]]+([^;&|]*[[:space:]])?(-A\b|--all\b|-u\b|--update\b|\.([[:space:]]|$)|:/)'
if grep -qE "$_RE" <<<"$cmdn"; then
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
# Only this rule strips quotes (see the header block) — `git add "."` must still be caught by the rule above.
if grep -qE "$GITX"'commit\b[^;&|]*([[:space:]]-[a-zA-Z]*a[a-zA-Z]*\b|[[:space:]]--all\b)' <<<"$cmd_noquotes"; then
  deny "BLOCKED: 'git commit -a' stages every tracked modification in a SHARED checkout (CONTRIBUTING §6) — including other sessions' in-flight edits.

Instead: 'git add <explicit paths>' then a bare 'git commit'."
fi

# `git reset --hard` — destroys uncommitted work
if grep -qE "$GITX"'reset\b[^;&|]*(--hard|--keep)\b' <<<"$cmdn"; then
  deny "BLOCKED: 'git reset --hard' discards uncommitted work in a SHARED checkout — which may be another session's ONLY copy.

If you must reset, FIRST preserve what is there (this does not touch the tree):
    TREE=\$(GIT_INDEX_FILE=/tmp/rescue.idx sh -c 'cp .git/index /tmp/rescue.idx; git add -A; git write-tree')
    git branch rescue/\$(date +%F)-wip \$(git commit-tree \$TREE -p HEAD -m 'rescue: WIP snapshot')
…then ask the user before discarding anything you did not write."
fi

# `git checkout .` / `git checkout -- .` / `git restore .` — discards working-tree changes
if grep -qE "$GITX"'(checkout[[:space:]]+([^;&|]*[[:space:]])?(-f\b|--force\b)|(checkout|restore)[[:space:]]+([^;&|]*[[:space:]])?(--[[:space:]]+)?(\.([[:space:]]|$)|:/))' <<<"$cmdn"; then
  deny "BLOCKED: discarding ALL working-tree changes in a SHARED checkout — they may be another session's only copy.

Restore only the paths you own:
    git checkout -- path/you/changed.js"
fi

# `git stash` (mutating forms) — hides another session's work out from under it
if grep -qE "$GITX"'stash([[:space:]]|$)' <<<"$cmdn" \
   && grep -oE "$GITX"'stash([[:space:]]+[^[:space:];&|]+)?' <<<"$cmdn" \
      | grep -qvE 'stash[[:space:]]+(list|show)$'; then
  deny "BLOCKED: 'git stash' in a SHARED checkout would sweep another session's uncommitted work into your stash — invisible to them, and easy to lose.

If you need a clean tree, use your OWN worktree instead:
    git worktree add ../wt-<task> -b claude/<task> origin/main
('git stash list' / 'git stash show' are allowed.)"
fi

# `git clean -f` — deletes untracked files (another session's new files)
if grep -qE "$GITX"'clean\b[^;&|]*-[a-zA-Z]*f' <<<"$cmdn"; then
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
