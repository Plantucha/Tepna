<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Census the zero-kill functions across every swept file — the class is ~320 survivors, about 20 % of everything the fleet has mapped.

The three zero-kill functions found so far were found BY ACCIDENT, one at a time, while probing.
Scanning every swept file for any function holding ≥8 survivors and zero kills finds six more:

  glucodex  genSynthetic            90   bootstrapped
  ppgdex    cvhrFromNN              57   OPEN
  pulsedex  compareIntervalSeries   54   bootstrapped
  motiondex inferAccUnit            31   OPEN
  glucodex  locateColumns           30   OPEN
  cpapdex   _nightFromInput         20   OPEN
  pulsedex  fragmentation           19   bootstrapped
  hrvdex    getFilteredRows         11   NOT PROBEABLE — reads `document`
  glucodex  applySessionCorrections  8   OPEN
                                   ---
                                   ~320 survivors, ≈20 % of the mapped fleet

Each open one needs exactly ONE test before any of its survivors can be classified — the prober needs
a positive control from the same function and there is nothing to replay.

`cvhrFromNN` is the notable entry: 57 survivors, zero kills, and it is the apnea-band detector.
`PPGDEX-TESTABLE-SURFACE` §4 named it the highest-value export candidate before withdrawing that plan
on cost grounds (a re-bundle plus owed fixture re-verification). It does not need an export — it is
reachable through `compute()` today. It needs a test.

`getFilteredRows` is the one this method cannot fix: it throws `document is not defined` in any
headless realm, so its behaviour is a function of the DOM rather than of its argument. Its 11
survivors stay unclassified unless the function is refactored, and recording that is more honest than
implying a battery could reach them.

The value of the census is that it converts "write more batteries" into a named, ordered queue —
and it says which item is not a battery problem at all.
