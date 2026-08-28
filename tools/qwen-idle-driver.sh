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
# STATE PINS TO ROOT; CODE COMES FROM $WT. `cd "$WT"` below makes every RELATIVE path in this script
# resolve inside the rotating worktree — right for the code and the crawl state that live there, WRONG
# for anything produced elsewhere. `capture-host/check.sh` runs in whatever checkout the operator used
# (normally root), so the mypy feed must be read ABSOLUTELY or the lane watches a path that will never
# exist. `LOG` above already follows this convention; stage 5 did not.
# Measured 2026-08-28: the feed existed in root at 00:55 (31884 bytes) and the 01:04 cycle still logged
# "no capture-host/.mypy-latest.txt" — the THIRD broken link in one chain (no producer → producer
# writing where the consumer does not look → consumer reading the wrong tree).
MYPY_FEED="${TEPNA_MYPY_FEED:-/home/michal/Tepna/capture-host/.mypy-latest.txt}"
exec 9>/tmp/qwen-idle-driver.lock
flock -n 9 || exit 0                  # a previous run is still going — correct, not an error
echo "── $(date '+%F %T') driver start" >> "$LOG"
# 0 · pipeline check (bracketed patterns — §4 self-match rule).
# REFINED 2026-08-27: yield only when the pipeline is actually USING the model. The crawl's
# sweep phase is CPU-bound and runs for hours with the GPU empty — the old process-level check
# left qwen idle that whole time. Discriminator: `ollama ps` lists a loaded model only when
# something recently inferred (keep-alive window). If the pipeline runs but the GPU is empty,
# proceed — ollama's request queue serializes any overlap, so the worst case is shared latency,
# never corruption. (Owner directive: maximize qwen.)
if ps ax -o args | grep -qE "[m]utate\.mjs --file|[m]utation-crawl\.mjs|[m]utation-ai-probe\.mjs|[m]utation-suite\.mjs --draft"; then
  if curl -sf --max-time 5 http://127.0.0.1:11434/api/ps 2>/dev/null | grep -q '"model"'; then
    echo "   pipeline busy AND model loaded — yielding" >> "$LOG"; exit 0
  fi
  echo "   pipeline running but GPU empty (CPU phase) — proceeding" >> "$LOG"
fi
# ollama up?
curl -sf --max-time 5 http://127.0.0.1:11434/api/version >/dev/null || { echo "   ollama down — skip" >> "$LOG"; exit 0; }
cd "$WT" || exit 1
# 1 · drafts for crawl-complete files (cheap when nothing new — journal skips answered mutants)
for c in .mutation-crawl/*.crawl.json; do
  [ -e "$c" ] || break
  f=$(basename "$c" .crawl.json)
  # --model qwen3.8:27b: owner-directed A/B 2026-08-27 (n=41 paired, temp 0, identical prompts):
  # 3.8 kept 17 vs coder:30b 9, discordant pairs 8-0 in 3.8's favour (McNemar p=0.008), and 3.8
  # REFUSES honestly (5) where coder emits wrong projections. Bench: tools/model-bench.mjs.
  timeout 3600 node tools/mutation-suite.mjs --draft "$f" --model qwen3.8:27b >> "$LOG" 2>&1
done
# 2 · review fleet — RETIRED 2026-08-27 at 0/30 measured precision (QWEN-ENGINEERING-PROGRAM
# §2.5 band applied; 30-sample across 3 files: 8 guard-blind, 3 mis-located, 3 house-rule
# INVERSIONS — the last class actively harmful). A successor needs structural fixes (adjacent
# context window + rule-citation resolution), not tuning. Adversary mode below stays, pending
# its own 30-sample — its concrete-attack bar is a different instrument.
# timeout 7200 node tools/dsp-review-qwen.mjs >> "$LOG" 2>&1
# 3 · adversary fleet — RETIRED 2026-08-27, same band, stronger method: 0/30 with 8 verdicts
# settled by EXECUTING qwen's claimed inputs (every executable claim failed; one finding demanded
# a fix the accused line already implements). 0/60 across both broad lenses is not a tuning
# problem. The six NARROW lenses in stage 4 remain live pending their own 30-sample — they ask
# traced-path questions, a different instrument class.
# timeout 7200 node tools/dsp-review-qwen.mjs --mode adversary >> "$LOG" 2>&1
# 5 · mypy FIX lane (PYTHON-TYPES-AND-FORMAT §P2). The draft pool runs dry — measured 2026-08-27
# 22:51 — and this refills those cycles with work that has a mechanical verifier rather than a
# human one: mypy's own error list is the queue, and the delta plus capture-host/check.sh is the
# judge. The model NEVER verifies its own output.
#
# The rails are in tools/qwen-mypy-fix.mjs as a rejecting predicate, not in the prompt: this lane's
# metric is an error count going DOWN, and `x: Any` / a bare `# type: ignore` drive that count to
# zero while adding nothing. A prompt can only discourage that path; the predicate makes it
# unreachable. Proposals land NOWHERE automatically — the queue is triage material, per §0 of the
# qwen program.
if [ -f "$MYPY_FEED" ]; then
  # ⚠️ ABSOLUTE, like the feed and the LOG. `cd "$WT"` above resolves every relative path inside the
  # rotating worktree, and the TOOL lives in root: measured 2026-08-28, wt-resweep carried no
  # qwen-mypy-fix.mjs at all, so a relative invocation dies on "Cannot find module" rather than
  # running. Same state/code split as the feed — I pinned the INPUT to root last cycle and left the
  # EXECUTABLE resolving in the worktree, which is the identical defect one file over.
  # --limit 6 per cycle: the band needs 30 DISTINCT errors, and the journal skips answered ones, so
  # the queue drains over several cycles instead of spending one long run on a model that may be wrong.
  timeout 1800 node /home/michal/Tepna/tools/qwen-mypy-fix.mjs --mypy-log "$MYPY_FEED" --generate --limit 6 >> "$LOG" 2>&1
else
  # Name the ABSOLUTE path that was missing. "no capture-host/.mypy-latest.txt" was true and useless:
  # it does not say WHICH tree was searched, so a feed sitting in root reads as an absent feed.
  echo "   mypy lane: no $MYPY_FEED — capture-host/check.sh has not run in that checkout; skipping (absent is not clean)" >> "$LOG"
fi
echo "── $(date '+%F %T') driver end" >> "$LOG"
