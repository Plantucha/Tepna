<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [OxyDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
First exhaustive mutation sweep of oxydex-dsp.js — the largest file in the fleet, and the prediction
the brief made about the unswept rows.

2680 tested, 899 killed, 18 invalid, 1763 survivors, 88 min wall. Rate on distinguishable mutants:
899/2662 = 33.8 %.

The fleet map sampled oxydex at 58 %. The error is +24.2 points, the largest recorded, and it is in
the same direction as every other large sampling error (pulsedex +16.5, glucodex +21.3): the sample
flatters the file.

That was predicted. The brief argued the three unswept rows sat at the TOP of the table, which is
exactly where an optimistic bias would put a file nobody can afford to check. oxydex was the first of
the three to be measured, and it moved from the highest checkable row to near the bottom.

The two remaining estimates — ecgdex 62 %, integrator 68 % — should not be quoted. They are the same
kind of number 58 % turned out to be.

canary: NONE because this was the file's first sweep; the run learned one (L72, eq === -> !==), now
recorded, so the next oxydex sweep is canary-guarded. The harness demonstrably worked: it killed 899.

No oxydex battery exists, so all 1763 survivors are currently invisible to the equivalence prober
(tools/probe-coverage.mjs).
