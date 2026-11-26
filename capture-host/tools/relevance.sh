#!/usr/bin/env bash
# tepna-capture — tools/relevance.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# DOES THIS CHANGE RUN THE CAPTURE-HOST PYTHON SUITE? Reads changed repo-relative paths on stdin, one
# per line, and prints `true` or `false`.
#
# ONE IMPLEMENTATION, TWO CALLERS. `.github/workflows/capture-host-ci.yml` pipes the PR's diff in, and
# `tests/test_relevance_filter.py` runs this same script. The house rule in tests/test_check_script.py
# says why: a test that re-writes the extraction it is checking agrees with itself, never with the job.
#
# WHY A MEASURED SET AND NOT A PREFIX. The filter was `capture-host/*` plus this workflow, defended by
# the claim that tests/conftest.py puts only capture-host/ on sys.path so nothing outside can change
# what the suite executes. That is true of what the suite IMPORTS and false of what it READS: the
# suite opens repo-root files as DATA through a `ROOT` anchor — the bundled app sources, clock.js,
# verdict.js, tests/dex-tests.js, tools/mutate.mjs, two briefs, eleven committed upload fixtures.
# Traced 2026-10-21 over a green run (`tools/root_reads.py`): 45 tracked root paths. A change to any of
# them reded this suite with the suite skipped, which is the examined-nothing shape CLAUDE.md §4b names.
#
# The set is EXACT paths, not patterns, because `tools/root_reads.py` plus
# `tests/test_relevance_filter.py` re-measure it: a new root read reds the suite that reads it rather
# than widening a pattern nobody checked. Exactness is affordable only because the tripwire exists.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="${ROOT_READS_MANIFEST:-$HERE/root-reads.json}"

# The manifest's `paths` entries are the only ones keyed `path`; an excluded observation is keyed
# `token`, so this line-oriented read cannot mistake an argv token for a file the suite reads.
# tests/test_relevance_filter.py compares this extraction against json.load() of the same file, so a
# format change reds rather than silently shortening the set.
manifest_paths() {
  sed -n 's/^[[:space:]]*"path"[[:space:]]*:[[:space:]]*"\(.*\)",*$/\1/p' "$MANIFEST"
}

# ── ONE MEASURED PATH IS CONDITIONAL: THE RESIDUE LEDGER ───────────────────────────────────────────
#
# `briefs/RESIDUE.md` is a real root read and it stays in the manifest. `_residue_open()` in
# tests/test_check_script.py opens the ledger to date a `not-required` declaration — a workflow job
# this repo may leave un-required while a logged row stays OPEN. The declaration itself lives in that
# same file's `JOB_PROTECTION` table, and the table holds none today. A ledger-only diff therefore
# moved no result here, and it still ran the whole Python matrix. So the filter asks the table first.
#
# Reading the LEDGER cannot answer the question: the ledger always holds OPEN rows, and only a live
# declaration makes one of them load-bearing. The next advisory job turns this trigger back on by
# writing its declaration, with no edit here.
#
# A table this script cannot read counts the ledger. That is the same fail-toward-RUN the empty-diff
# arm takes, and tests/test_relevance_filter.py pins both answers plus that fallback.
LEDGER="briefs/RESIDUE.md"
DECLARATIONS="${JOB_PROTECTION_SOURCE:-$HERE/../tests/test_check_script.py}"

declaration_is_live() {
  local block
  [ -r "$DECLARATIONS" ] || return 0
  # The module-level table ALONE. tests/test_check_script.py plants a `not-required` entry inside a
  # test to exercise its own reader, and that plant is not a declaration.
  block="$(sed -n '/^JOB_PROTECTION = {/,/^}/p' "$DECLARATIONS")"
  [ -n "$block" ] || return 0
  printf '%s\n' "$block" | grep -q '"not-required"'
}

if [ "${1:-}" = "--list" ]; then
  manifest_paths
  exit 0
fi
if [ "${1:-}" = "--list-conditional" ]; then
  echo "$LEDGER"
  exit 0
fi
if [ "$#" -gt 0 ]; then
  echo "usage: relevance.sh [--list|--list-conditional] < changed-paths" >&2
  exit 2
fi

changed="$(cat)"
if [ -z "$changed" ]; then
  echo true                       # no diff to judge ⇒ run, never silently skip
  exit 0
fi

roots="$(manifest_paths)"
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    # Everything in this directory, which carries the suite, this script and the manifest.
    capture-host/*) echo true; exit 0 ;;
    # Kept explicit rather than left to the manifest: the workflow owns the matrix, the dependency
    # pins and the coverage floor, and it must run the suite even on the day the trace stops reading it.
    .github/workflows/capture-host-ci.yml) echo true; exit 0 ;;
  esac
  # The ledger counts only while a declaration reads it. Every other measured path is unconditional.
  if [ "$f" = "$LEDGER" ] && ! declaration_is_live; then
    continue
  fi
  while IFS= read -r r; do
    [ "$f" = "$r" ] && { echo true; exit 0; }
  done <<< "$roots"
done <<< "$changed"
echo false
