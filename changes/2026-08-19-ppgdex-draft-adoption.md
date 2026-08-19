<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [PpgDex]
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
The fifth bank file: 19 of 22 ppgdex drafts adopted (beat-detection guards, the small stats,
correctRR's Malik clamp, pickChannel), plus two sharpenings the first kill-verify demanded — the
Clock-Contract §2.5 pin on the node-local parseTimestamp (time-only with no opts at all is null,
never a throw, never today) and a jittered-trend Poincaré series whose full ellipse (both axes and
the ratio nonzero) is the only input class that can see the sd1/sd2 denominator's `|| 1` fallback.

The three discards tell the right story: one pin had gone stale because the CODE got more honest
(the drafted `poincare(0).sd1sd2 === 0` predates #1504's null fix — adopting it would have locked
the retired wart back in), one was a vacuous undefined comparison, one a drifted quantile record.

Kill tally: 12 first-pass + 1 line-drift-resolved + 1 sharpened denominator = 14 red. One mutant
PROVEN equivalent and ledgered (`opts = opts || {}` in the parseTimestamp subset — the function
reads no opts field, so the value is never consumed; the entry reds as REFUTED if the subset ever
grows one). The residue is text-degenerate loop headers shared by 2–3 functions each — sweep
backlog, named, not claimed.
