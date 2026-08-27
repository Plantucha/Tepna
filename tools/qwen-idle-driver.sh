#!/bin/bash
# qwen-idle-driver.sh — Tepna
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# SESSION-INDEPENDENT qwen work driver (owner-directed 2026-08-27): keeps the local model
# producing triage material even when no Claude session is alive (token quota exhausted,
# machine untouched). Run by the systemd user timer `qwen-idle.timer` every 30 min.
#
# Priority order, mirroring the session-side rules:
#   0. If any mutation sweep/crawl/probe/draft is running → exit 0 (pipeline owns the box).
#   1. Draft stage for any crawl-complete file (resumable; journaled; skips answered work).
#   2. DSP review fleet (dsp-review-qwen.mjs, review mode — resumable by function hash).
#   3. DSP adversary audit fleet (--mode adversary — same tool, attack persona).
# Every lane is journaled + resumable, so a run interrupted anywhere loses nothing.
# Output for triage: .git/tepna-mutation/{*.drafts.js, dsp-review/REVIEW-REPORT.md}
set -u
WT=/home/michal/wt-resweep            # the checkout holding the live crawl state + synced tools
LOG=/home/michal/Tepna/.git/tepna-mutation/qwen-idle-driver.log
exec 9>/tmp/qwen-idle-driver.lock
flock -n 9 || exit 0                  # a previous run is still going — correct, not an error
echo "── $(date '+%F %T') driver start" >> "$LOG"
# 0 · pipeline check (bracketed patterns — §4 self-match rule)
if ps ax -o args | grep -qE "[m]utate\.mjs --file|[m]utation-crawl\.mjs|[m]utation-ai-probe\.mjs|[m]utation-suite\.mjs --draft"; then
  echo "   pipeline busy — yielding" >> "$LOG"; exit 0
fi
# ollama up?
curl -sf --max-time 5 http://127.0.0.1:11434/api/version >/dev/null || { echo "   ollama down — skip" >> "$LOG"; exit 0; }
cd "$WT" || exit 1
# 1 · drafts for crawl-complete files (cheap when nothing new — journal skips answered mutants)
for c in .mutation-crawl/*.crawl.json; do
  [ -e "$c" ] || break
  f=$(basename "$c" .crawl.json)
  timeout 3600 node tools/mutation-suite.mjs --draft "$f" >> "$LOG" 2>&1
done
# 2 · review fleet (resumable; internal pipeline-yield keeps it polite mid-file)
timeout 7200 node tools/dsp-review-qwen.mjs >> "$LOG" 2>&1
# 3 · adversary fleet
timeout 7200 node tools/dsp-review-qwen.mjs --mode adversary >> "$LOG" 2>&1
echo "── $(date '+%F %T') driver end" >> "$LOG"
