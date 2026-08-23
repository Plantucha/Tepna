#!/usr/bin/env bash
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# ai-probe-overnight.sh — run the AI input probe to CONVERGENCE, then draft assertions for
# everything it found. Designed to be left running overnight, unattended.
#
#   tools/ai-probe-overnight.sh                    # all files with a journal, until converged
#   AI_PROBE_LIMIT=20 tools/ai-probe-overnight.sh  # smoke mode: cap mutants per file per pass
#
# WHAT "RESOLVED" MEANS HERE, precisely — because "run until it resolves all kills" has a false
# reading. The terminal state is NOT "every mutant killed". It is: every survivor either
#   (a) has a PROVEN distinguishing input recorded (KILL — a drafted assertion follows), or
#   (b) has exhausted the 5-tier sampling ladder without one (NONE, tier 5/5), or
#   (c) is structurally unreachable (no call handle / mutant will not load / source moved past
#       the ±40-line window / took the process down).
# (b) and (c) are honest residue, not failure: a probe cannot promise every mutant is killable —
# some genuinely are equivalent. What it promises is that nothing REACHABLE is left untried.
#
# CONVERGENCE, not a fixed pass count: a pass that adds 0 kills AND runs 0 inputs across every
# file means the retry filter found nothing left with ladder room — nothing a further pass could
# do differently. Stop there. MAX_PASSES is a backstop against a driver bug, not the mechanism.
#
# Every per-mutant verdict is journalled as it happens (kill the driver at ANY time; re-running
# resumes), each file is pid-locked against concurrent probes, and a hang-mutant is bounded by the
# vm timeout — the three failures that were each hit once before this script existed.
set -u
W="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
C="${AI_PROBE_CRAWL:-/run/media/michal/647A504F7A50205A/crawl-results-2026-08-18}"
LIMIT="${AI_PROBE_LIMIT:-0}"
MAX_PASSES="${AI_PROBE_MAX_PASSES:-8}"
LOG_FILTER='tier [0-9] tried'   # per-input noise; the journal keeps everything

cd "$W" || exit 1
FILES=()
for j in .mutate-journal/*.jsonl; do
  [ -e "$j" ] || continue
  f="$(basename "$j" .jsonl)"
  [ -f "$f" ] && FILES+=("$f")
done
if [ "${#FILES[@]}" -eq 0 ]; then
  echo "no journals in $W/.mutate-journal — nothing to probe" >&2
  exit 2
fi
echo "OVERNIGHT AI PROBE — ${#FILES[@]} file(s): ${FILES[*]}"
echo "  crawl dir $C · per-file limit ${LIMIT:-none} · max passes $MAX_PASSES"

pass=0
prev_jlines=-1
while [ "$pass" -lt "$MAX_PASSES" ]; do
  pass=$((pass + 1))
  # Convergence is measured on the JOURNAL, not the pass tally. The per-file "N newly KILLABLE"
  # counts seed-pool re-hits every pass (deterministic seeds re-fire), so pass_kills can never
  # reach 0 on a file with any seed-killable key — measured 2026-08-23: passes 4-8 identical at
  # 53 "new" kills, and the CONVERGED line below never printed; the driver always ran to
  # MAX_PASSES. A pass that appended nothing to any journal learned nothing, whatever it counted.
  jlines=$(cat "$C"/*.ai-probe.jsonl 2>/dev/null | wc -l)
  if [ "$jlines" -eq "$prev_jlines" ]; then
    echo "CONVERGED after $((pass - 1)) pass(es) — journals unchanged across a full pass (fixed point)."
    break
  fi
  prev_jlines=$jlines
  echo "########## PASS $pass  $(date '+%F %T') ##########"
  pass_kills=0
  pass_inputs=0
  for f in "${FILES[@]}"; do
    echo "═══ $f (pass $pass) ═══"
    LIM=()
    [ "$LIMIT" != "0" ] && LIM=(--limit "$LIMIT")
    out="$(timeout 5400 node tools/mutation-ai-probe.mjs --file "$f" --retry-none "${LIM[@]}" --crawl-dir "$C" 2>&1)"
    rc=$?
    printf '%s\n' "$out" | grep -vE "$LOG_FILTER"
    # A canary refusal (exit 2) or lock refusal (exit 3) is a per-file verdict, not a driver error.
    [ "$rc" -ne 0 ] && [ "$rc" -ne 2 ] && [ "$rc" -ne 3 ] && echo "!! $f exited $rc — journal retains everything answered so far"
    # Progress accounting from the summary line the tool always prints:
    #   "N newly KILLABLE of M (K already answered, T inputs run, ...)"
    line="$(printf '%s\n' "$out" | grep -oE '[0-9]+ newly KILLABLE of [0-9]+ \([0-9]+ already answered, [0-9]+ inputs run' | tail -1)"
    if [ -n "$line" ]; then
      k="$(printf '%s' "$line" | grep -oE '^[0-9]+')"
      t="$(printf '%s' "$line" | grep -oE '[0-9]+ inputs run' | grep -oE '[0-9]+')"
      pass_kills=$((pass_kills + k))
      pass_inputs=$((pass_inputs + t))
    fi
  done
  echo "── pass $pass: $pass_kills new kill(s), $pass_inputs input(s) run ──"
  node tools/mutation-ai-probe.mjs --status 2>&1
  if [ "$pass_kills" -eq 0 ] && [ "$pass_inputs" -eq 0 ]; then
    echo "CONVERGED after $pass pass(es) — nothing reachable has ladder room left."
    break
  fi
done

echo "########## DRAFTING  $(date '+%F %T') ##########"
# Every killable — crawl-found and probe-found — becomes a proposed assertion in a review file.
# Drafts are PROPOSALS: a projection can discriminate and still pin the wrong behaviour, so nothing
# here lands in tests/dex-tests.js without a human read.
draft_fail=0
for f in "${FILES[@]}"; do
  echo "═══ draft $f ═══"
  # NOT `... | tail -4`. A pipeline reports TAIL's status, so this step could fail completely and
  # still exit 0 — measured 2026-08-23: mutation-suite refused all 8 files (--crawl-dir was missing
  # from its CLI_FLAGS) and the calling triage script logged "probe converged" and reported green
  # for three consecutive runs. Capture the command's OWN code first, truncate for reading after.
  out="$(timeout 3600 node tools/mutation-suite.mjs --draft "$f" --crawl-dir "$C" 2>&1)"; rc=$?
  printf '%s\n' "$out" | tail -4
  if [ "$rc" -ne 0 ]; then
    echo "!! draft FAILED for $f (exit $rc)"
    draft_fail=$((draft_fail + 1))
  fi
done
echo "########## DONE  $(date '+%F %T') ##########"
node tools/mutation-ai-probe.mjs --status 2>&1
echo "drafts: $(ls "$W"/.git/tepna-mutation/*.drafts.js 2>/dev/null | wc -l) file(s) in .git/tepna-mutation/ — each needs a human read before adoption"

# A step that refused every file must not exit 0. This is the only thing standing between a broken
# drafting phase and a caller that reports the whole night green.
if [ "$draft_fail" -gt 0 ]; then
  echo "!! DRAFTING FAILED for $draft_fail of ${#FILES[@]} file(s) — this run is RED"
  exit 1
fi
