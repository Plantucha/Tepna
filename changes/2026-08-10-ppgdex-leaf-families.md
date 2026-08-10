<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [PpgDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Give seven exported leaf functions their own direct families, because routing them through analyze()
diluted them into uselessness.

#1147 measured the cost of the pipeline probe: 22 families VOID, with beatRegularity separating 0 of 6
controls despite being called on every one of the 25 inputs. A leaf's result is aggregated and rounded
into the export long before the fingerprint sees it.

Seven direct families, each with inputs chosen for its own branches. Six went straight from VOID to
classifying; the seventh needed one more shape:

  beatRegularity            6/6 controls    4 surv ->  3 gaps,  1 equivalent
  timeDomain                8/8            10     ->  7,        3
  sampEn                    9/9            14     ->  8,        6
  markO2Sentinels           5/5             7     ->  4,        3
  harmonicOutlierRefIdx    12/12           13     ->  2,       11
  intervalsSpanningTimeGap  6/6            10     ->  3,        7
  validatePPI               2/2            12     -> 11,        1

30 new classifications; ppgdex ledger 99 -> 129, fleet 329 -> 359. Rate 42.6 % -> 43.8 %. No
refutations; all 129 entries are current survivors.

beatRegularity took two attempts for a reason worth recording: each beat scores the MINIMUM of its two
adjacent deviations, so a single odd interval always has a regular neighbour and still scores 1.0. The
`* 0.4 -> * 0` mutant flattens every score to 1.0 and was therefore invisible to a battery whose
inputs never produced a score below 1.0. Two CONSECUTIVE irregular intervals are the only shape in
which the scaling factor is observable.

The seven are removed from PPG_PIPELINE_FNS: one fn, one family. Registering both would give a mutant
two verdicts from probes of very different power.
