#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# sync-main.sh — advance a checkout's local `main` to `origin/main`, but ONLY when
# that is provably safe. Idempotent, quiet on the common path, safe to run on a timer.
#
# WHY THIS EXISTS. Nothing in this repo fetches on its own: no cron, no timer, no hook.
# Local `main` in the shared root was measured 47 commits behind with a clean tree, and
# the vigil box drifts the same way (its `HEAD..origin/main` count reads 0 because
# nothing there ever fetches — a ref comparison cannot see staleness it never downloaded).
#
# WHY NOT `git update-ref` / `git branch -f`. CLAUDE.md §👥.2b: those move the REF and
# touch neither tree nor index, and `update-ref` is the one form that skips git's
# checked-out-branch check entirely. If the branch is checked out the tree then freezes
# while HEAD advances, so every file a later merge ADDS reads as `deleted` — 47 live
# files, growing with every merge. `merge --ff-only` in the checkout that HOLDS the
# branch moves all three together, and refuses outright if history diverged.
#
# THIS SCRIPT NEVER: resets, checks out, stashes, cleans, force-moves a ref, or touches
# a dirty tree. Every failure path leaves the checkout exactly as it was found.
#
# Bash, not Node, on purpose: the vigil box has no node and needs this most.
#
#   tools/sync-main.sh                 # sync the checkout you are standing in
#   tools/sync-main.sh /srv/data/Tepna # sync a named checkout
#   tools/sync-main.sh --dry-run       # decide and report, change nothing
#
# Exit: 0 synced or already current · 2 skipped (unsafe, not an error) · 3 REFUSED
# (diverged — a human must look) · 4 usage/environment error.

set -uo pipefail

BRANCH="${SYNC_MAIN_BRANCH:-main}"
DRY=0
DIR=""

for a in "$@"; do
  case "$a" in
    --dry-run|-n) DRY=1 ;;
    -h|--help) sed -n '3,28p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) printf 'sync-main: unknown flag %s\n' "$a" >&2; exit 4 ;;
    *) DIR="$a" ;;
  esac
done

say()  { printf 'sync-main: %s\n' "$1"; }
skip() { printf 'sync-main: SKIP — %s\n' "$1"; exit 2; }

[ -n "$DIR" ] || DIR="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  say "not inside a git repository, and no checkout given"; exit 4; }
[ -d "$DIR" ] || { say "no such directory: $DIR"; exit 4; }

g() { git -C "$DIR" "$@"; }

g rev-parse --git-dir >/dev/null 2>&1 || { say "not a git repository: $DIR"; exit 4; }

# A worktree's real git dir; `.git` may be a file pointing elsewhere.
GITDIR="$(g rev-parse --absolute-git-dir)"

# 1 · Never touch a checkout mid-operation. Its "clean tree" would be a lie and an
#     ff-merge would land on top of a half-finished rebase.
for f in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG; do
  [ -e "$GITDIR/$f" ] && skip "an operation is in progress ($f) — leaving it alone"
done

# 2 · Only sync when `$BRANCH` is the branch actually checked out here. If it is not,
#     the safe move is to do nothing: advancing a ref that some OTHER worktree has out
#     is precisely the §2b failure.
CUR="$(g rev-parse --abbrev-ref HEAD 2>/dev/null)" || { say "cannot read HEAD"; exit 4; }
[ "$CUR" = "$BRANCH" ] || skip "checkout is on '$CUR', not '$BRANCH'"

# 3 · MEASURE THE TREE, NOT THE REF (§👥.2b). `rev-list --count` returned 0 while the
#     tree was 214 files stale; it answers a different question. A TRACKED modification
#     is someone's in-flight work: never fast-forward underneath it.
#
#     UNTRACKED paths are different, and this line used to count them the same way. It
#     read as the safe choice and was the opposite: the shared root ALWAYS carries a few
#     stray untracked files (a probe script, a `deploy/` folder, a corpus night), so the
#     timer skipped every run — `SKIP — 7 uncommitted/untracked path(s)` at 02:15 and
#     `SKIP — 370` on the corpus clone, `Result=success` on both — and the root sat 42–103
#     commits behind while the stale-brief hook measured against its frozen HEAD
#     (RESIDUE `2026-09-05-sync-main-skips-while-root-dirty`). A fast-forward cannot touch
#     an untracked path that no incoming commit names, and git refuses one that would
#     overwrite an untracked file; step 4b makes that collision explicit and skips on it.
MOD="$(g status --porcelain --untracked-files=no | wc -l | tr -d ' ')"
[ "$MOD" = "0" ] || skip "$MOD uncommitted tracked path(s) — never sync over someone's work"
# `--untracked-files=all` lists every file under an untracked directory (`?? deploy/`
# alone would hide `deploy/x.sh` from the collision check below).
UNTRACKED="$(g status --porcelain --untracked-files=all | sed -n 's/^?? //p')"

# 4 · Fetch. This writes only remote-tracking refs; it cannot alter the tree.
if ! g fetch --quiet origin "$BRANCH" 2>/dev/null; then
  skip "fetch failed (offline, or no 'origin') — nothing changed"
fi

LOCAL="$(g rev-parse "$BRANCH")"
REMOTE="$(g rev-parse "origin/$BRANCH")"
[ "$LOCAL" = "$REMOTE" ] && { [ "$DRY" = 1 ] && say "already current at ${LOCAL:0:8}"; exit 0; }

# 5 · Fast-forwardable only. If local carries commits origin does not, this is a real
#     divergence: someone committed to `main` directly. Refuse and say so — the whole
#     point is that this script never decides what to do with unpushed work.
# 4b · An untracked path that an incoming commit ALSO names is a real collision: git's
#      ff-merge would refuse it ("untracked working tree files would be overwritten"), but
#      say so here, by name, instead of letting the merge's error be the report.
if [ -n "$UNTRACKED" ]; then
  COLLIDE="$(g diff --name-only "$BRANCH" "origin/$BRANCH" | grep -Fxf <(printf '%s\n' "$UNTRACKED") || true)"
  [ -z "$COLLIDE" ] || skip "untracked path(s) also changed on origin/$BRANCH — never sync over someone's work: $(printf '%s' "$COLLIDE" | tr '\n' ' ')"
fi

AHEAD="$(g rev-list --count "origin/$BRANCH..$BRANCH")"
BEHIND="$(g rev-list --count "$BRANCH..origin/$BRANCH")"
if [ "$AHEAD" != "0" ]; then
  printf 'sync-main: REFUSED — %s has %s commit(s) NOT on origin/%s.\n' "$BRANCH" "$AHEAD" "$BRANCH"
  printf '           This is unpushed work, not staleness. Look before touching it:\n'
  printf '             git -C %s log --oneline origin/%s..%s\n' "$DIR" "$BRANCH" "$BRANCH"
  exit 3
fi

if [ "$DRY" = 1 ]; then
  say "WOULD fast-forward $BRANCH by $BEHIND commit(s): ${LOCAL:0:8} -> ${REMOTE:0:8}"
  exit 0
fi

if g merge --ff-only --quiet "origin/$BRANCH"; then
  say "$BRANCH fast-forwarded $BEHIND commit(s): ${LOCAL:0:8} -> ${REMOTE:0:8}  [$DIR]"
  exit 0
fi

# --ff-only refusing after the ahead-check means the state moved under us (a concurrent
# session). Report honestly rather than reaching for a stronger command.
say "merge --ff-only refused unexpectedly — state changed mid-run; checkout untouched"
exit 3
