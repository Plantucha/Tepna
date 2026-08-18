<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [suite]
brief: CAPTURE-HOST-SUBPROCESS-SURFACE-FOLLOWUPS-2026-08-04-BRIEF.md
---
Pays the one outstanding runbook debt from that brief's §6. The runbook said **"Diff the survivor
sets, not the counts"** — right for regressions, wrong for the rate, and the difference is not
cosmetic.

A set diff **structurally cannot see a timeout resolving to killed**, because a timeout was never in
the survivor set to begin with. Every mutant rescued by making a slow test fast is invisible to it.
Measured 2026-08-04: `cpap_harvest` had **5** such the moment a real-wall-clock test was given a
synthetic clock, and the source brief's own draft reported the campaign as **204** kills before the
arithmetic was corrected to **209** — a brief written by someone following this runbook got its
headline number wrong by using the diff for both questions.

The runbook now states both, as different questions with different arithmetic: `comm` over the
survivor sets for *did anything break*, and `total − survived − timeout` from mutmut's `*.stats.json`
for *how many did I kill*.

⚠️ **Two of that brief's three runbook debts were already paid** — the non-unique-anchor assertion and
the "nothing that READS may overlap anything that WRITES" rule are both in §1. I initially reported
all three as unpaid, from a `grep -E` whose patterns used BRE alternation (`\|`), so they were matched
as literal strings and found nothing. A query that examined nothing and reported cleanly, run while
auditing a runbook about exactly that. Only the third debt was real.

Docs only; `last-verified` restamped.
