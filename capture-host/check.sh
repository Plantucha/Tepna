#!/usr/bin/env bash
# tepna-capture — check.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE ONE COMMAND THAT CANNOT SILENTLY OMIT A GATE (CAPTURE-HOST-SUBPROCESS-SURFACE-FOLLOWUPS §5).
#
# CI runs ruff, shellcheck and pytest as three separate steps; locally there was no single invocation
# that ran all three, so "read BOTH gates" was a note rather than a check — and it failed twice the same
# way: `pytest --cov` printed 100 % and `ruff` failed on the very next line, same defect (an unused
# import), same position, in #852 and again in #880. A note is weaker than a check.
#
# WHY THIS AND NOT THE PRE-COMMIT HOOK §5 PROPOSED:
#   * A hook must be INSTALLED. `core.hooksPath` is not set in this repo and several agent sessions work
#     the tree at once, so the common state is a hook that exists in-repo and runs for nobody — a gate
#     that does not gate, which is this suite's worst failure class, not a mitigation of it.
#   * A hook fires on every commit, including deliberate WIP. §5's own warning applies: the last hook
#     proposed in that brief (CLAUDE.md §2b's outcome guard) would have blocked every release, and that
#     was discovered only by testing it against `tools/release.mjs`.
#   * The JS side already solved this exact problem with an aggregate (`npm run check`), described there
#     as "the only invocation that cannot silently omit a builder". This is that, for capture-host.
#
# ⚠️ EVERY GATE RUNS EVEN AFTER ONE FAILS, and the verdict is computed from the collected exit codes —
# never read off the tail of the output (CLAUDE.md §4b). Stopping at the first failure is how you fix
# ruff, re-run, and only then discover the suite was red too.
set -uo pipefail                    # NOT -e: a failing gate must not abort the run
cd "$(dirname "$0")" || exit 2

PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  if [ -x .venv/bin/python ]; then PY=.venv/bin/python; else PY=python3; fi
fi

names=(); codes=()
run_gate() {                        # run_gate <label> <cmd...>
  local label="$1"; shift
  printf '\n\033[1m▸ %s\033[0m\n' "$label"
  "$@"
  local rc=$?
  names+=("$label"); codes+=("$rc")
  return 0
}

run_gate "ruff"       "$PY" -m ruff check .
# Collected into an ARRAY, not a glob and not word-splitting inside `bash -c`: the repo has .sh files
# in subdirectories (deploy/, systemd/), so a bare *.sh would check only this directory while reporting
# success for the whole surface — the same shape as every other "gate that examined less than it said".
mapfile -t sh_files < <(find . -name '*.sh' -not -path './.venv*' | sort)
# Resolve shellcheck BESIDE THE INTERPRETER first — the same rule tests/test_shell_surface.py uses —
# so the pinned `shellcheck-py` wheel in .venv wins over whatever PATH holds, and a contributor who
# installed requirements-dev.txt without activating the venv is not handed exit 127 for a tool that
# is installed. Measured 2026-09-06: a bare `shellcheck` here exited 127 on a box whose only gap
# was the (then undeclared) wheel, and the 127 read as "the tool is absent on this box" four times.
# When neither location has it the bare name still fails with 127 — a missing tool stays visible.
SC="$(dirname "$PY")/shellcheck"; [ -x "$SC" ] || SC=shellcheck
run_gate "shellcheck" "$SC" --severity=style "${sh_files[@]}"
# pytest-xdist WHEN PRESENT (requirements-dev.txt declares it; CI runs `-n 4`). Measured on the rig
# 2026-09-09: serial 15m52s, `-n 4` 8m37s, same 6833 tests and the same coverage table — pytest-cov
# combines the workers' data itself. A venv without the plugin still runs the identical gate serially
# rather than failing on an unknown flag: absence of a speed-up is not absence of a gate.
XDIST=(); "$PY" -c 'import xdist' 2>/dev/null && XDIST=(-n auto)
run_gate "pytest"     "$PY" -m pytest -q --cov --cov-branch --cov-fail-under=100 "${XDIST[@]}"
# Machinery that exists, is tested, and is connected to NOTHING — the sibling of "a check that reports
# success about something it never examined". No other gate can see it: every instance HAS passing
# tests, and the tests call the function directly, which is exactly the wiring production lacks. Seconds,
# no network. The floor is 0 and the allowlist is the escape hatch, with a reason required per entry.
run_gate "unwired"    "$PY" tools/find_unwired.py --check

# ── ADVISORY GATES (PYTHON-TYPES-AND-FORMAT-2026-08-27) ─────────────────────────────────────────
# These RUN and REPORT but cannot fail the run yet. Advisory here is not the ignorable kind: the
# counts print in the summary, and the flip conditions are pre-stated in the brief, not per-PR —
# mypy flips BLOCKING at 0 errors (see MYPY_BASELINE below for the live figure and its date; the
# number may only go DOWN). ⚠️ THIS LINE USED TO CARRY THE NUMBER ITSELF and drifted the moment
# the ratchet was banked: it still read "baseline 99, 2026-09-13" after MYPY_BASELINE moved to
# 68, and that stale prose was handed between sessions as if it were a reading. A number written
# twice has one copy that nobody updates; the constant is the only place it may live. The
# changed-files format check flips after one fleet-notice cycle. A big-bang reformat is FORBIDDEN
# by the brief: mutation canaries/journals/equivalence are keyed on line text+numbers, and a
# 263-file wave orphans that known-answer record at once — format lands file-by-file as files
# change anyway.
adv_names=(); adv_codes=(); adv_notes=(); adv_states=()
run_advisory() {                    # run_advisory <label> <note-on-fail> <cmd...>
  local label="$1"; local note="$2"; shift 2
  # A command may set ADVISORY_NOTE to replace the static note with what it MEASURED. Every other row
  # in the summary block is a live verdict (`✓ ruff ok`, `✗ pytest FAILED`), so a row that is constant
  # text formatted identically to those reads as a status while naming only a configured value — which
  # is how a mypy count of 104 was reported as "baseline 103" and believed. Cleared before each run so
  # a stale note cannot survive into the next advisory.
  ADVISORY_NOTE=""
  # A MACHINE-READABLE VERDICT BESIDE THE PROSE ONE. The note above is an English sentence, and
  # for an advisory that reports a DIRECTION that was the only place the direction existed:
  # `RISEN` and `at baseline` differ by a word and by nothing a script can key on. NOT by the exit
  # code either — measured 2026-09-19 across two real runs, the mypy leg exits **1 in both
  # states**, because mypy exits non-zero whenever any error exists and there are 41. So an
  # aggregate keyed on exit status sees the two cases as identical, which is how a RISEN count
  # reached `main` and then surfaced on a later branch as that author's fault.
  #
  # The default derives from `rc` so every leg gets a state without knowing about this seam; a
  # command that knows its own direction overrides it, exactly as `ADVISORY_NOTE` already works.
  ADVISORY_STATE=""
  printf '
[1m▸ %s (advisory)[0m
' "$label"
  "$@"
  local rc=$?
  adv_names+=("$label"); adv_codes+=("$rc"); adv_notes+=("${ADVISORY_NOTE:-$note}")
  if [ -n "$ADVISORY_STATE" ]; then adv_states+=("$ADVISORY_STATE")
  elif [ "$rc" -eq 0 ]; then adv_states+=("OK")
  else adv_states+=("ISSUES"); fi
  return 0
}
# PERSIST MYPY'S OUTPUT — the §P2 fix lane's work queue. `qwen-idle-driver.sh` stage 5 reads
# `.mypy-latest.txt` and, until this, NOTHING wrote it: the consumer shipped before the producer, so
# the lane skipped on every cycle. The skip was LOUD, which is why it surfaced in one tick instead of
# reading as clean — but a loud skip forever is still a lane that never runs.
#
# ⚠️ WRITTEN BY REDIRECT AND THEN ECHOED, NEVER `| tee`. A pipe would hand `run_advisory` tee's exit
# status instead of mypy's, and mypy's is the number the advisory reports (CLAUDE.md §4b — the check
# that ran and reported about something it never examined).
MYPY_OUT=".mypy-latest.txt"
# THE BASELINE IS COMPARED, NOT NARRATED. It used to live only inside the advisory's note string —
# "count may only go DOWN" — where nothing read it, so the count was free to rise and nobody would
# know. It did: the brief recorded 102 on 2026-09-03 and the tree measured 103 three days later,
# with every gate green throughout. An invariant stated in a label is not an invariant.
#
# Still ADVISORY: this reports the direction, it does not fail the run. §P3 is what flips mypy
# blocking, and it flips at 0 — moving that decision here would pre-empt it.
MYPY_BASELINE=39
MYPY_BASELINE_DATE="2026-09-20"
mypy_advisory() {
  "$PY" -m mypy --ignore-missing-imports --explicit-package-bases . > "$MYPY_OUT" 2>&1
  local rc=$?
  cat "$MYPY_OUT"
  # The count comes from mypy's own summary line, never from counting lines of output: the output
  # carries `note:` lines too, and a line count would drift from the number the baseline describes.
  local n
  n=$(sed -n 's/^Found \([0-9]\+\) error.*/\1/p' "$MYPY_OUT" | tail -1)
  if [ -z "$n" ]; then
    # No summary line means mypy did not complete a run — an ABORT, not a clean tree. Reporting
    # "0 errors" here would be the loudest possible lie, so say what actually happened.
    printf '  mypy: NO COUNT — mypy did not report a summary line (it aborted, not passed)\n'
    ADVISORY_NOTE="NO COUNT — mypy aborted; nothing was examined"
    ADVISORY_STATE="NO_COUNT"
  elif [ "$n" -gt "$MYPY_BASELINE" ]; then
    printf '  mypy: %s errors — RISEN from the %s baseline (%s). The count may only go DOWN.\n' \
           "$n" "$MYPY_BASELINE" "$MYPY_BASELINE_DATE"
    ADVISORY_NOTE="$n (baseline $MYPY_BASELINE, RISEN) — the count may only go DOWN"
    ADVISORY_STATE="RISEN"
  elif [ "$n" -lt "$MYPY_BASELINE" ]; then
    printf '  mypy: %s errors — BELOW the %s baseline (%s). Lower MYPY_BASELINE to bank it, or the\n' \
           "$n" "$MYPY_BASELINE" "$MYPY_BASELINE_DATE"
    printf '        improvement can be spent again without anything noticing.\n'
    ADVISORY_NOTE="$n (baseline $MYPY_BASELINE, BELOW) — lower MYPY_BASELINE to bank it"
    ADVISORY_STATE="BELOW"
  else
    printf '  mypy: %s errors — at the %s baseline (%s).\n' "$n" "$MYPY_BASELINE" "$MYPY_BASELINE_DATE"
    # ⚠️ `AT_BASELINE`, never `NOT_RISEN`: `test_A_COUNT_AT_THE_BASELINE_SAYS_SO_WITHOUT_ALARM`
    # asserts the string "RISEN" is ABSENT from the whole run, and it greps stdout+stderr of the
    # entire script — so a token merely CONTAINING the word would red it. The negative assertion is
    # the valuable half of that test and the token must not collide with it.
    ADVISORY_NOTE="$n (baseline $MYPY_BASELINE, at baseline)"
    ADVISORY_STATE="AT_BASELINE"
  fi
  return "$rc"
}
if "$PY" -c 'import mypy' 2>/dev/null; then
  run_advisory "mypy" "baseline $MYPY_BASELINE ($MYPY_BASELINE_DATE) — count may only go DOWN; flips blocking at 0"     mypy_advisory
else
  # No mypy ⇒ REMOVE the feed rather than leave yesterday's. A stale queue is worse than an absent
  # one: the lane would propose fixes for errors that may already be gone, and its acceptance rate —
  # the metric that decides whether the lane survives — would be measured against a dead list.
  rm -f "$MYPY_OUT"
  printf '
[1m▸ mypy (advisory)[0m
  mypy not installed (pip install -r requirements-dev.txt) — ADVISORY GATE DID NOT RUN
'
  adv_names+=("mypy"); adv_codes+=(127); adv_notes+=("not installed — nothing was examined"); adv_states+=("NOT_INSTALLED")
fi
# Changed .py files vs origin/main — honest empty-scope line when none (a formatter that checked
# nothing must say so, never read as clean).
mapfile -t changed_py < <(git diff --name-only origin/main...HEAD -- '*.py' 2>/dev/null | while read -r f; do [ -f "../$f" ] && echo "../$f"; done)
if [ "${#changed_py[@]}" -gt 0 ]; then
  run_advisory "format" "ruff format --check on ${#changed_py[@]} changed file(s); flips blocking after fleet notice"     "$PY" -m ruff format --check "${changed_py[@]}"
else
  printf '
[1m▸ format (advisory)[0m
  0 changed .py files vs origin/main — nothing in scope (not a pass, an empty scope)
'
  adv_names+=("format"); adv_codes+=(0); adv_notes+=("empty scope"); adv_states+=("EMPTY_SCOPE")
fi

echo
echo "──────── capture-host gates ────────"
for i in "${!adv_names[@]}"; do
  if [ "${adv_codes[$i]}" -eq 0 ]; then
    printf '  \033[36m◦\033[0m %-11s advisory ok\n' "${adv_names[$i]}"
  else
    printf '  \033[33m◦\033[0m %-11s ADVISORY exit %s — %s\n' "${adv_names[$i]}" "${adv_codes[$i]}" "${adv_notes[$i]}"
  fi
done
# THE MACHINE-READABLE VERDICT LINE. One line, fixed prefix, `key=value` per advisory leg — the
# thing a downstream reader keys on instead of parsing an English sentence.
#
# WHY `key=value` AND NOT A BARE WORD, measured 2026-09-19: a reader grepping the bare adjective has
# no correct option. Anchored to the sentence (`^\s*mypy: .*RISEN`) it breaks on any reflow that
# keeps the word but moves it — a FALSE GREEN. Loosened to `grep -c RISEN` it matches
# `test_A_RISEN_COUNT_IS_NAMED_AS_RISEN`, which pytest prints in its short summary whenever that
# test FAILS — so the test ABOUT the token, failing, reports as the condition the token names. A
# FALSE ALARM, self-referentially. Both failure modes are properties of the prose, not of the
# reader: the test guarantees the word appears SOMEWHERE, a reader needs it as the mypy VERDICT.
#
# `=` is what closes it, and the reason is structural rather than stylistic: `=` cannot occur in a
# Python identifier, so `mypy=RISEN` is UNFORGEABLE by a test name however that test is worded.
# The collision above cannot recur for this token.
#
# ADDITIVE ON PURPOSE. Every `  mypy: …` line above is byte-unchanged: `test_check_script.py`
# asserts the word in both directions, and a peer's handoff predicate is anchored to that exact
# prefix. Restructuring the sentence to carry a status would have passed the test and silently
# returned 0 for that reader — the same anchored-pattern failure, introduced by its own fix.
adv_state_line=""
for i in "${!adv_names[@]}"; do
  adv_state_line+="${adv_names[$i]}=${adv_states[$i]:-UNSPECIFIED} "
done
printf '  advisory-state: %s\n' "${adv_state_line% }"
failed=0
for i in "${!names[@]}"; do
  if [ "${codes[$i]}" -eq 0 ]; then
    printf '  \033[32m✓\033[0m %-11s ok\n' "${names[$i]}"
  else
    printf '  \033[31m✗\033[0m %-11s FAILED (exit %s)\n' "${names[$i]}" "${codes[$i]}"
    failed=$((failed + 1))
  fi
done

if [ "$failed" -ne 0 ]; then
  echo
  echo "  $failed gate(s) failed — the run above contains all of them, not just the first."
  exit 1
fi
echo "  all gates green"
