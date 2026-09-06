#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# sync-main.test.sh — self-test for sync-main.sh.
#
# Builds a THROWAWAY bare origin plus a clone and drives the script against real
# trees. Every SKIP is paired with a SYNC differing in ONE property, so a rule that
# refuses everything (the 2026-09-05 state: every run skipped on stray untracked
# files, timer green) scores as loudly as one that refuses nothing. Exit codes are
# the contract: 0 synced/current · 2 skipped · 3 refused.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
S="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sync-main.sh"
fail=0

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

ORIGIN="$TMP/origin.git"
git init -q --bare -b main "$ORIGIN"
SEED="$TMP/seed"
git clone -q "$ORIGIN" "$SEED" 2>/dev/null
git -C "$SEED" checkout -q -b main
printf 'one\n' > "$SEED/a.txt"
git -C "$SEED" add a.txt && git -C "$SEED" commit -qm base && git -C "$SEED" push -q origin main

# advance origin: one commit that ADDS `deploy/new.sh` and MODIFIES a.txt
advance() {
  printf 'two\n' >> "$SEED/a.txt"
  mkdir -p "$SEED/deploy" && printf 'x\n' > "$SEED/deploy/new.sh"
  git -C "$SEED" add a.txt deploy/new.sh && git -C "$SEED" commit -qm advance && git -C "$SEED" push -q origin main
}

fresh() { # fresh <name> → a clone at the base commit, on main
  rm -rf "${TMP:?}/$1"; git clone -q "$ORIGIN" "$TMP/$1" 2>/dev/null
  git -C "$TMP/$1" reset -q --hard "$(git -C "$SEED" rev-list --max-parents=0 HEAD)"
}

expect() { # expect <exit> <label> <dir>
  local want="$1" label="$2" dir="$3" out rc
  out="$(bash "$S" "$dir" 2>&1)"; rc=$?
  if [ "$rc" = "$want" ]; then printf '  ok    exit %s  %s\n' "$rc" "$label"
  else printf '  FAIL  exit %s (want %s)  %s\n        %s\n' "$rc" "$want" "$label" "$out"; fail=1; fi
}

advance

fresh clean
expect 0 "clean tree behind origin → SYNCED" "$TMP/clean"
[ "$(git -C "$TMP/clean" rev-parse HEAD)" = "$(git -C "$SEED" rev-parse HEAD)" ] || { echo "  FAIL  clean: HEAD did not move"; fail=1; }

fresh stray
printf 'probe\n' > "$TMP/stray/probe_x.py"                 # untracked, nobody upstream names it
expect 0 "untracked path no incoming commit names → SYNCED (the 2026-09-05 false skip)" "$TMP/stray"
[ -f "$TMP/stray/probe_x.py" ] && [ -f "$TMP/stray/deploy/new.sh" ] || { echo "  FAIL  stray: tree wrong after sync"; fail=1; }

fresh straydir
mkdir -p "$TMP/straydir/tools_local" && printf 'y\n' > "$TMP/straydir/tools_local/z.sh"   # untracked DIRECTORY
expect 0 "untracked directory no incoming commit names → SYNCED" "$TMP/straydir"

fresh collide
mkdir -p "$TMP/collide/deploy" && printf 'mine\n' > "$TMP/collide/deploy/new.sh"   # same path origin ADDS
expect 2 "untracked path an incoming commit also names → SKIP, by name" "$TMP/collide"
[ "$(cat "$TMP/collide/deploy/new.sh")" = "mine" ] || { echo "  FAIL  collide: untracked file was overwritten"; fail=1; }
out="$(bash "$S" "$TMP/collide" 2>&1)"; case "$out" in *deploy/new.sh*) ;; *) echo "  FAIL  collide: skip did not name the path: $out"; fail=1;; esac

fresh modified
printf 'edit\n' >> "$TMP/modified/a.txt"                    # tracked modification
expect 2 "tracked modification → SKIP (unchanged rule)" "$TMP/modified"
[ "$(git -C "$TMP/modified" rev-parse HEAD)" = "$(git -C "$SEED" rev-list --max-parents=0 HEAD)" ] || { echo "  FAIL  modified: HEAD moved"; fail=1; }

fresh ahead
printf 'local\n' > "$TMP/ahead/b.txt" && git -C "$TMP/ahead" add b.txt && git -C "$TMP/ahead" commit -qm local
expect 3 "local commit not on origin → REFUSED" "$TMP/ahead"

fresh current
bash "$S" "$TMP/current" >/dev/null 2>&1
expect 0 "already current → 0, no-op" "$TMP/current"

if [ "$fail" = 0 ]; then echo "sync-main.test: all passed"; else echo "sync-main.test: FAILED"; exit 1; fi
