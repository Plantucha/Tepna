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
# THE FAST LANE (owner 2026-10-31: "board search lag"; widened 2026-11-05: "Take it"). `--board` is the
# 15-min tick (tepna-board-search.timer): the board export, an embed of what changed, then an upsert of
# EVERY changed file, repo and external, into the generation that serves search now. It skips the
# external pull. The hourly tick runs the same upsert after its pull. Neither builds a generation: the
# nightly reload (03:20) does that, and resets the graph growth that overwrites cause (xerj-org/xerj#2796).
# Until 2026-11-05 the reload ran hourly and stalled searches for minutes each hour; the residue row is
# `2026-11-03-hybrid-searches-stall-during-the-hourly-generation-load`. Both ticks take one lock.
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

# Yield the CARD to the mutation pipeline, not the tick: qwen3-coder holds ~18 GB of a 20 GB card,
# and loading bge-m3 beside it risks evicting the model mid-sweep. Until 2026-11-03 this branch
# skipped the tick on the belief that "the index catches up on the next tick", but a crawl holds the
# card for hours: seven ticks skipped from 11:00 to 17:00 that day, and the first session query after
# them embedded 4,986 chunks inline and ran past its two-minute tool limit. Now the tick embeds on the
# CPU (`DEX_EMBED_CPU=1` → `num_gpu: 0`) at the lowest priority. Measured: 32 chunks in 7 s with no
# VRAM touched, so a typical hour of ~2,500 chunks takes ~9 min. Any OTHER tenant of the card (a
# U-Net, owner 2026-11-03) is caught by doc-search itself, which reads the card's free VRAM and goes to
# the CPU below `DEX_EMBED_MIN_FREE_MB`; the pipeline check stays because qwen3-coder can sit unloaded
# between sweeps, so a free card at this instant says nothing about the next minute. The tick always
# runs at the lowest priority under a timeout wide enough for a CPU hour.
# Bracketed patterns so this script's own cmdline never self-matches (§4).
NICE="nice -n 19"
EMBED_TIMEOUT=2700
# A `--selftest` of those tools is a gate step, not a sweep: it never loads qwen3-coder. Measured
# 2026-11-04 14:27: one bird's `npm run check` ran `mutate.mjs --selftest` and `mutation-crawl.mjs
# --selftest`, this branch forced the CPU, and Ollama kept that CPU runner for every later caller too.
# A single-text embed then took 60 s against 3.8 s on the card, and each 5-minute board tick ran 5.5 min.
if pgrep -af "[m]utate\.mjs|[m]utation-crawl|[m]utation-suite" 2>/dev/null | grep -qv -- '--selftest'; then
  [ "$MODE" = full ] && echo "$(date -Is) busy — pipeline holds the card, embedding on the CPU" >>"$LOG"
  export DEX_EMBED_CPU=1
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
# shellcheck disable=SC2086 # $pull is one flag or empty, $NICE one command prefix or empty
out=$(timeout "$EMBED_TIMEOUT" $NICE node tools/doc-search.mjs --semantic $pull "index freshness tick" 2>&1 | grep -E ' newly embedded|^  ⚠ (index cache|external root)' | head -4 | tr '\n' ' ')
[ "$MODE" = full ] && echo "$(date -Is) [$ROOT @ $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null)] ${out:-'(no embed line — check doc-search output)'}" >>"$LOG"
# THE WINDOW REACHES BACK TO THE LAST GOOD UPSERT, plus 2 min of margin. A tick that skipped on the lock
# or failed leaves the stamp where it was, so the next tick covers its span. No stamp (a fresh machine)
# reads 90 min. The cap is one day, because the nightly reload carries anything older.
STAMP="$STATE/fast-lane.stamp"
WIN=90
if [ -f "$STAMP" ]; then
  WIN=$((($(date +%s) - $(stat -c %Y "$STAMP")) / 60 + 2))
  [ "$WIN" -gt 1440 ] && WIN=1440
fi
# The loader runs from the indexed checkout, so a file's mtime and its presence are the current
# main's. Its symbol parser needs `node_modules`, which a linked worktree does not share.
[ -e "$ROOT/node_modules" ] || ln -s "$PRIMARY/node_modules" "$ROOT/node_modules" 2>/dev/null
started=$(date +%s)
# shellcheck disable=SC2086 # $NICE is one command prefix
load=$(timeout 600 $NICE node "$ROOT/tools/xerj-load.mjs" --only '*' --newer-than "$WIN" 2>&1)
rc=$?
# A stale-hash skip means the embed did not reach a changed file: keep the stamp, so the next tick
# offers that file again.
if [ "$rc" = 0 ] && ! printf '%s' "$load" | grep -q 'stale-hash'; then
  touch -d "@$started" "$STAMP"
fi
# The fast lane logs only when it moved something: 96 quiet ticks a day would bury the hourly lines.
case "$load" in
*"fast lane: 0 doc"* | *"changed in the last"*) [ "$rc" = 0 ] && exit 0 ;;
esac
echo "$(date -Is) $MODE fast lane rc=$rc win=${WIN}m ${board:-} | ${out:-} | $(printf '%s' "$load" | grep -E 'fast lane|REFUSING|✕' | head -3 | tr '\n' ' ')" >>"$LOG"
