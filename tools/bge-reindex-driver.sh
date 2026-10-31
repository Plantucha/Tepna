#!/bin/sh
# ════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
# ────────────────────────────────────────────────────────────────────────
# bge-reindex-driver.sh — keep the doc-search bge index fresh, unattended.
#
# ⚠️ PRIMARY DEV MACHINE ONLY — same scope as tools/doc-search.mjs itself.
# Other GitHub users, fresh clones, and CI do not have the local inference
# server and must not be pointed at this. Nothing may gate on its output.
#
# WHY A TIMER AND NOT A COMMIT HOOK. doc-search indexes INCREMENTALLY on
# every query (it embeds only new/changed chunks), so freshness is just
# "run one query on a synced checkout, periodically". A post-commit hook
# would fire only for THIS checkout's commits — it misses every other
# session's worktree commits and every remote merge the sync timer pulls
# in. An hourly timer on the root checkout (which the main-sync timer
# fast-forwards) sees all of them, and costs ~nothing when nothing changed
# ("0 newly embedded").
#
# Installed as systemd user units bge-reindex.{service,timer} (hourly,
# randomized 5 min). This script is safe to run by hand at any time.
#
# EXTERNAL ROOTS ride the same tick (owner 2026-09-06: "reindex on a
# regular basis like tepna is"). doc-search reads the per-machine
# `$STATE/doc-search-external.json` on every query, so the external reference
# trees are re-hashed hourly for free; `--pull-ext` also
# fast-forwards the roots that opted in with `"pull": true` (shallow clones
# nobody works in — never a peer's working tree, never a non-git tree).
# ════════════════════════════════════════════════════════════════════════
set -u
# THE BOARD LANE (owner 2026-10-31: "board search lag"). `--board` is the 5-min tick
# (tepna-board-search.timer): the board export, an embed of what changed, then an upsert of
# the changed board files into the generation that serves search now. It skips the external pull,
# and it never builds a generation — the hourly :20 reload still does that, and resets what this lane
# wrote. It takes the same lock, so it never runs beside the hourly tick.
MODE=full
[ "${1:-}" = "--board" ] && MODE=board
# THE CHECKOUT THAT GETS INDEXED IS A DEDICATED, ALWAYS-CURRENT ONE — not the shared root.
# Measured 2026-09-24: the shared root sat on a feature branch 170 commits behind origin/main, so
# this timer re-embedded stale briefs and tools every hour, and because the cache is keyed by
# relative path and shared by every worktree, its stale chunks OVERWROTE the current ones a
# session's own query had just embedded. `~/wt-bge-index` is a linked worktree of the primary
# (`git worktree add --detach origin/main`) that nobody edits; it is fast-forwarded here before
# every tick. Absent (a fresh machine), the primary is indexed as before, and the log says so.
PRIMARY="$HOME/Tepna"
INDEX_ROOT="$HOME/wt-bge-index"
if [ -d "$INDEX_ROOT/.git" ] || [ -f "$INDEX_ROOT/.git" ]; then
  git -C "$INDEX_ROOT" fetch -q origin main 2>/dev/null && git -C "$INDEX_ROOT" checkout -q --detach origin/main 2>/dev/null
  ROOT="$INDEX_ROOT"
else
  ROOT="$PRIMARY"
fi
# The state dir is the PRIMARY's, whichever checkout is indexed: one cache, one external config,
# shared with every worktree's own doc-search (resolveStatePath reads the git common dir).
STATE="$PRIMARY/.git/tepna-mutation"
LOG="$STATE/bge-reindex.log"
mkdir -p "$STATE" 2>/dev/null

exec 9>"$STATE/bge-reindex.lock" || exit 0
flock -n 9 || exit 0

# Yield to the mutation pipeline: qwen3-coder holds ~18 GB of a 20 GB card,
# and loading bge-m3 beside it risks evicting the model mid-sweep. The
# index catches up on the next tick — staleness is cheap, eviction is not.
# Bracketed patterns so this script's own cmdline never self-matches (§4).
if pgrep -f "[m]utate\.mjs|[m]utation-crawl|[m]utation-suite" >/dev/null 2>&1; then
  echo "$(date -Is) busy — pipeline running, skipped" >>"$LOG"
  exit 0
fi

curl -sf --max-time 5 http://127.0.0.1:11434/api/tags >/dev/null 2>&1 || {
  echo "$(date -Is) ollama down — skipped" >>"$LOG"
  exit 0
}

cd "$ROOT" || exit 0
# THE AGENT BOARD JOINS THE SAME TICK (owner 2026-10-17: "wire agent board to rule 0"). Rulings and
# handoffs now arrive on the board, a SQLite file doc-search cannot read. board-corpus.mjs writes one
# Markdown file per entry into the folder the `agent-board` external root names. Best-effort: a board
# failure is logged and the index tick still runs.
board=$(timeout 120 node tools/board-corpus.mjs 2>&1 | tail -1)
[ "$MODE" = full ] && echo "$(date -Is) ${board:-board-corpus: no output}" >>"$LOG"
# THE EMBED LINE IS THE STATS LINE AND THE CACHE WARNINGS, NOTHING ELSE. This grep read
# `embed|chunk|ext:` until 2026-10-31, and every search hit carries `ext:` and the word "chunk", so
# the log recorded the query's top hits and never the count of newly embedded chunks.
pull=--pull-ext
[ "$MODE" = board ] && pull=
# 🔴 `--semantic` IS THE WHOLE POINT OF THE TICK. Since #3414 (2026-10-11) doc-search answers from
# the hybrid lane by default and exits BEFORE it builds the semantic index, so this tick embedded
# nothing for three weeks: the cache moved only when some session's query fell back to the semantic
# lane, and the hourly reload re-loaded a stale cache. Measured 2026-10-31: the first `--semantic` tick
# embedded 29,062 of 72,318 chunks (9 min 23 s). Only the semantic lane embeds.
# shellcheck disable=SC2086 # $pull is one flag or empty, never a word list
out=$(timeout 900 node tools/doc-search.mjs --semantic $pull "index freshness tick" 2>&1 | grep -E ' newly embedded|^  ⚠ (index cache|external root)' | head -4 | tr '\n' ' ')
if [ "$MODE" = full ]; then
  echo "$(date -Is) [$ROOT @ $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null)] ${out:-'(no embed line — check doc-search output)'}" >>"$LOG"
  exit 0
fi
# The board lane logs only when it moved something: 288 quiet ticks a day would bury the hourly lines.
# The loader runs from the PRIMARY, which holds the cache the embed just wrote.
load=$(timeout 120 node "$PRIMARY/tools/xerj-load.mjs" --only ext:agent-board/ --newer-than 10 2>&1)
rc=$?
case "$load" in
*"fast lane: 0 doc"* | *"changed in the last"*) [ "$rc" = 0 ] && exit 0 ;;
esac
echo "$(date -Is) board lane rc=$rc ${board:-} | ${out:-} | $(printf '%s' "$load" | grep -E 'fast lane|REFUSING|✕' | head -2 | tr '\n' ' ')" >>"$LOG"
