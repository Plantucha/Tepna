#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# auto-rescue.sh — periodically snapshot a checkout's UNCOMMITTED work to a rescue ref, so no
# session's work is ever the only copy. Touches nothing: not the tree, not the index, not any branch.
#
# WHY. On 2026-08-16 a `land-pr` fix existed ONLY as an uncommitted modification in the shared
# checkout — never committed, on no branch, in no worktree. It surfaced by accident: its verdict
# string appeared in a log with no matching source anywhere in git. A peer session preserved it by
# hand. Had nobody looked, it would have been lost to the next `checkout`/`stash`/`clean`.
#
# That checkout routinely holds 100+ uncommitted paths across several concurrent sessions, and
# CLAUDE.md §👥.2 already says: found finished, uncommitted work that isn't yours? Snapshot it, don't
# step on it. This is that rule, on a timer, so it does not depend on somebody noticing.
#
# IT IS NOT A SYNC AND CANNOT BECOME ONE. A checkout with live uncommitted work must not be
# fast-forwarded — `sync-main.sh` correctly SKIPS while the tree is dirty, and this tool is the
# answer to what to do in the meantime. Snapshot, then let the humans/sessions land their own work.
#
# WHAT IT WRITES. `refs/rescue/<YYYY-MM-DDTHH-MM>` — a commit whose tree is the working tree as it
# stood, parented on the current HEAD. Refs under `refs/rescue/` are NOT branches: they never appear
# in `git branch`, are not pushed, and cannot be checked out by accident. Recover with:
#     git log --oneline refs/rescue/                     # what was captured, when
#     git show <ref>:path/to/file                        # read one file
#     git diff HEAD <ref>                                # everything that was uncommitted
#
#   tools/auto-rescue.sh [<checkout>] [--keep N] [--dry-run]
#
# Exit: 0 snapshotted or nothing to do · 2 not a usable checkout.

set -uo pipefail

KEEP=48          # ~2 days at 1/hour. Snapshots are tree-shared; the marginal cost is a commit object.
DRY=0
DIR=""
for a in "$@"; do
  case "$a" in
    --dry-run|-n) DRY=1 ;;
    --keep) KEEP=next ;;
    --keep=*) KEEP="${a#--keep=}" ;;
    -h|--help) sed -n '3,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) if [ "$KEEP" = next ]; then KEEP="$a"; else DIR="$a"; fi ;;
  esac
done

[ -n "$DIR" ] || DIR="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "auto-rescue: not a git repo and no checkout given"; exit 2; }
g() { git -C "$DIR" "$@"; }
g rev-parse --git-dir >/dev/null 2>&1 || { echo "auto-rescue: not a git repository: $DIR"; exit 2; }

GITDIR="$(g rev-parse --absolute-git-dir)"
# Mid-operation trees are transient by nature and their index is in an odd state; skip rather than
# capture something misleading.
for f in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD; do
  [ -e "$GITDIR/$f" ] && { echo "auto-rescue: SKIP — operation in progress ($f)"; exit 0; }
done

DIRT="$(g status --porcelain | wc -l | tr -d ' ')"
if [ "$DIRT" = "0" ]; then
  [ "$DRY" = 1 ] && echo "auto-rescue: tree clean — nothing to snapshot"
  exit 0
fi

HEAD_SHA="$(g rev-parse HEAD 2>/dev/null)" || { echo "auto-rescue: no HEAD"; exit 2; }
STAMP="$(date +%Y-%m-%dT%H-%M)"
REF="refs/rescue/$STAMP"

if [ "$DRY" = 1 ]; then
  echo "auto-rescue: WOULD snapshot $DIRT path(s) from $DIR to $REF (parent ${HEAD_SHA:0:9})"
  exit 0
fi

# A SEPARATE INDEX. Copying the real index preserves what is already staged; staging into the copy
# leaves the repo's own index and the working tree untouched. This is CLAUDE.md §👥.2's recipe.
IDX="$(mktemp -t auto-rescue-idx.XXXXXX)"
trap 'rm -f "$IDX"' EXIT
cp "$GITDIR/index" "$IDX" 2>/dev/null || : # a missing index is fine; add -A rebuilds what it needs

if ! GIT_INDEX_FILE="$IDX" git -C "$DIR" add -A 2>/dev/null; then
  echo "auto-rescue: could not stage into the temp index — nothing written"
  exit 0
fi
TREE="$(GIT_INDEX_FILE="$IDX" git -C "$DIR" write-tree 2>/dev/null)" || { echo "auto-rescue: write-tree failed"; exit 0; }

# Identical tree to the previous snapshot ⇒ nothing changed; do not mint a ref per hour forever.
PREV="$(g for-each-ref --sort=-refname --format='%(objectname)' --count=1 'refs/rescue/*' 2>/dev/null)"
if [ -n "$PREV" ] && [ "$(g rev-parse "$PREV^{tree}" 2>/dev/null)" = "$TREE" ]; then
  exit 0
fi

C="$(g commit-tree "$TREE" -p "$HEAD_SHA" -m "auto-rescue: $DIRT uncommitted path(s) in $DIR at $STAMP" 2>/dev/null)" \
  || { echo "auto-rescue: commit-tree failed"; exit 0; }
g update-ref "$REF" "$C"
echo "auto-rescue: snapshotted $DIRT path(s) -> $REF (${C:0:9})"

# Prune oldest beyond KEEP. Refs only — the objects stay until gc, and gc will not drop anything a
# surviving ref reaches.
n="$(g for-each-ref --format='%(refname)' 'refs/rescue/*' | wc -l | tr -d ' ')"
if [ "$n" -gt "$KEEP" ]; then
  g for-each-ref --sort=refname --format='%(refname)' 'refs/rescue/*' | head -n "$((n - KEEP))" \
    | while read -r old; do g update-ref -d "$old"; done
fi
