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
run_gate "shellcheck" shellcheck --severity=style "${sh_files[@]}"
run_gate "pytest"     "$PY" -m pytest -q --cov --cov-branch --cov-fail-under=100
# Machinery that exists, is tested, and is connected to NOTHING — the sibling of "a check that reports
# success about something it never examined". No other gate can see it: every instance HAS passing
# tests, and the tests call the function directly, which is exactly the wiring production lacks. Seconds,
# no network. The floor is 0 and the allowlist is the escape hatch, with a reason required per entry.
run_gate "unwired"    "$PY" tools/find_unwired.py --check

# ── ADVISORY GATES (PYTHON-TYPES-AND-FORMAT-2026-08-27) ─────────────────────────────────────────
# These RUN and REPORT but cannot fail the run yet. Advisory here is not the ignorable kind: the
# counts print in the summary, and the flip conditions are pre-stated in the brief, not per-PR —
# mypy flips BLOCKING at 0 errors (baseline 134, 2026-08-29; the number may only go DOWN); the
# changed-files format check flips after one fleet-notice cycle. A big-bang reformat is FORBIDDEN
# by the brief: mutation canaries/journals/equivalence are keyed on line text+numbers, and a
# 263-file wave orphans that known-answer record at once — format lands file-by-file as files
# change anyway.
adv_names=(); adv_codes=(); adv_notes=()
run_advisory() {                    # run_advisory <label> <note-on-fail> <cmd...>
  local label="$1"; local note="$2"; shift 2
  printf '
[1m▸ %s (advisory)[0m
' "$label"
  "$@"
  local rc=$?
  adv_names+=("$label"); adv_codes+=("$rc"); adv_notes+=("$note")
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
mypy_advisory() {
  "$PY" -m mypy --ignore-missing-imports --explicit-package-bases . > "$MYPY_OUT" 2>&1
  local rc=$?
  cat "$MYPY_OUT"
  return "$rc"
}
if "$PY" -c 'import mypy' 2>/dev/null; then
  run_advisory "mypy" "baseline 134 (2026-08-29) — count may only go DOWN; flips blocking at 0"     mypy_advisory
else
  # No mypy ⇒ REMOVE the feed rather than leave yesterday's. A stale queue is worse than an absent
  # one: the lane would propose fixes for errors that may already be gone, and its acceptance rate —
  # the metric that decides whether the lane survives — would be measured against a dead list.
  rm -f "$MYPY_OUT"
  printf '
[1m▸ mypy (advisory)[0m
  mypy not installed (pip install -r requirements-dev.txt) — ADVISORY GATE DID NOT RUN
'
  adv_names+=("mypy"); adv_codes+=(127); adv_notes+=("not installed — nothing was examined")
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
  adv_names+=("format"); adv_codes+=(0); adv_notes+=("empty scope")
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
