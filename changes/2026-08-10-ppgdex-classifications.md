<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [PpgDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Re-sweep ppgdex-dsp.js and probe it with the expanded battery: 58 new classifications, 39.0 % -> 42.6 %.

Fresh sweep: 1204 tested, 464 killed, 15 invalid, 725 survivors, canary PASSED. 39.0 % on
distinguishable mutants, confirming the earlier 38.9 % against unchanged code — the two agree, which
is what a re-measurement is for.

The battery expanded in #1139 (3 families -> 35) claims 445 of those 725 survivors. 13 families
classified cleanly and emitted 58 entries; ppgdex ledger 41 -> 99, fleet 271 -> 329. With those
recorded the distinguishable rate is 464/1090 = 42.6 %. All 99 entries are current survivors: no
refutations, no orphans.

22 families are VOID, and the pattern in them is the finding: routing a leaf function's probe through
analyze() DILUTES it. beatRegularity reads 0 of 6 controls separated despite being reached — its
result is aggregated and rounded into the export before the fingerprint sees it. beatRegularity,
timeDomain, sampEn, poincare, validatePPI and correctRR are all EXPORTED, so direct families with
tailored inputs will discriminate where the pipeline cannot. That is the next work-unit, and
probe-reach's "reached but output-independent" caveat is exactly this case measured.
