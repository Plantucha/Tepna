<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: CONNECT-LOCK-DUTY-CYCLE-2026-08-09-BRIEF.md
---
Record the acceptance measurement the brief was holding open: 59% -> 9%.

Docs only. The brief shipped saying the measurement was owed and that a green suite is not a substitute
for it. It has now been taken, under the same conditions as the baseline — absent H10, nothing worn, all
four fixes deployed and the daemon restarted onto them:

    baseline (pre-fix)     59.1 min  51 ops  mean 41.1 s   59 %
    after #1062 + #1081     8.1 min   6 ops  mean 43.0 s   53 %
    after #1091            17.5 min   2 ops  mean 45.5 s    9 %

The mechanism is visible in the counts rather than inferred: over 18 minutes the box logged 10 deferrals
against only 3 lock acquisitions, so seven absences cost a scan and never took `_CONNECT_LOCK`.

The mean hold did NOT move (41 -> 45 s), and it should not have — the fix does not make a doomed connect
faster, it stops one being started. A fix that had moved the mean instead of the count would have been
solving a different problem, so that non-movement is a check on the explanation rather than a loose end.

The residual 9% is the handful of attempts that still reach a connect, where #1062 keeps them at one
attempt rather than twelve. Fixes 3, 4 and 5 compose; none alone gets here.
