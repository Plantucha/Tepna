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

echo
echo "──────── capture-host gates ────────"
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
