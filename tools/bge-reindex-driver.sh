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
# ════════════════════════════════════════════════════════════════════════
set -u
ROOT=/home/michal/Tepna
STATE="$ROOT/.git/tepna-mutation"
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
out=$(timeout 900 node tools/doc-search.mjs "index freshness tick" 2>&1 | grep -iE "embed|chunk" | head -2)
echo "$(date -Is) ${out:-'(no embed line — check doc-search output)'}" >>"$LOG"
