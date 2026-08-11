<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [OxyDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Test oxydex parseJSONL — the fleet's third-largest survivor cluster, and it had no test at all.

144 unclassified survivors in 227 lines. 80 now die: 144 -> 64.

parseJSONL rebuilds a night from the JSONL/_summary.json export field by field, in two deliberately
different shapes:

  meanSpo2:  s.meanSpo2 || 0                      absent OR zero -> 0
  meanPi:    s.meanPi != null ? s.meanPi : null   absent -> null, zero -> 0

The second exists so a faulted sensor does not read as a confident zero. The test pins both, plus the
t0Ms fallback chain, the rejects (no date, no stats, malformed, blank), and the top-level-array form.

THE VALUES MUST BE DISTINCT AND NON-ZERO. `s.x || 0` mutated to `s.x && 0` yields 0, which is
indistinguishable from the default whenever the fixture's field is 0 or missing — so a realistic
record of mostly zeros asserts nothing.

THREE MEASUREMENTS, because the obvious improvement made it WORSE:

  stats-only fixture             61/144
  every nested block populated   46/144   <- MORE data, FEWER kills
  BOTH arms                      80/144

Each analysis block is `obj.X ? {…} : null`, so present and absent are different code paths and a
fixture is only ever on one. Populating the blocks stopped exercising the null arm the first fixture
had been covering by accident. Neither shape dominates; the test now carries both.

Two defects found in my own test while measuring, both of the kind this suite exists to catch:
- an assertion written `x ? 'present' : 'present'`, which passes for every possible input;
- three assertions guarded by `if (n.spikes && n.spikes.length)`, so a mutant that EMPTIED the list
  made them not run rather than fail. Never guard an assertion on the thing it is asserting.

Also corrected two contract errors caught by a red baseline: the export key is spo2Ceiling (spo2Ceil
is the night-side name), and osc defaults to a zero-shaped object rather than null like hrv.
