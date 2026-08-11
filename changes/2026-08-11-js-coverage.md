<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Add c8 coverage to the JS suite — the number it never had — and record the hypothesis it refuted.

THE MEASUREMENT WAS SILENTLY EMPTY AT FIRST, which is the part worth keeping. run-tests.mjs loads
every DSP through `vm.runInContext(code, ctx, { filename: file })` with a RELATIVE path, and c8 keeps
only files resolving under the project root. So the first run reported 499 statements — the harness —
and omitted every DSP it had just exercised, while looking like a working coverage report. With an
absolute filename it measures 56 800. A 114x difference between a report that looks fine and one that
is real. classicify() replaces line contents in place, so line numbers still match the file on disk.

BASELINE, full suite (6515 assertions, 434 groups):
  Statements 86.94%   Branches 77.33%   Functions 79.24%

THE HYPOTHESIS THIS WAS ADDED TO TEST IS REFUTED. The argument was: capture-host enforces
--cov-fail-under=100 and mutation-kills 74.6%; the JS fleet has no coverage tooling and kills 38.5%;
therefore JS is under-COVERED. It is not. At 77.3% branch coverage a 23-point coverage gap cannot
explain a 36-point kill gap.

The JS suite EXECUTES the code and does not ASSERT on it. That matches every finding in this brief:
applySessionCorrections offsets of [1,0,-1] too small to separate an operand swap, beatRegularity
never scoring below 1.0, cpapdex selfTest checking fail===0 while its own assertion count dropped.
Unasserted, not unexecuted. A coverage FLOOR would therefore not have moved the kill rate much, which
is worth knowing before one is imposed.

Two files are genuinely under-executed and are the exception:
  hrvdex-dsp.js    74.2% stmts, 40.0% functions
  pulsedex-dsp.js  82.8% stmts, 59.7% functions  (and the fleet's lowest kill rate, 31.9%)

NO THRESHOLD. A floor has to be set from a measured baseline; guessed, it lands red on day one and
gets disabled. Weekly workflow + on-demand, not per-PR: the coverage run IS the full suite (~8 min),
and per-PR it would double the merge critical path to report a number that does not move commit to
commit. `all: true` so a file with zero executed lines still appears rather than being omitted.
