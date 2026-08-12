<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
Make mutation sweeps resumable, stream a line per mutant, and beat once a minute.

At the 99% target a full fleet re-sweep is ~24 h of machine time and runs ~15 times. Until now a
sweep held every verdict in memory and wrote them only at the end, so an interrupt at hour 13 of the
13.8 h integrator sweep lost all thirteen. Crash-SAFETY existed (signals restore the mutated source);
resumability did not.

--resume replays a journal of per-mutant records. Verified: an interrupted sweep resumed to
tested 60 / killed 23 / survivors 37 with a survivor set IDENTICAL to an uninterrupted run of the
same 60. That equivalence is the point — a resume that produces a different answer is worse than none.

JAMMED MUTANTS. Two records are written per mutant, a start before and a verdict after, so a start
with no verdict is a mutant that was in flight when the process died. But ONE unfinished start is NOT
a jam: with 16 workers, any interrupt leaves ~16 in flight, and quarantining those discards good
mutants and teaches the tool to skip code it never tested — measured, 13 innocent ones on the first
attempt. A real jam JAMS AGAIN, so a mutant is retried once and quarantined only on a SECOND
unfinished start.

Correctness fix found by testing: the first resume reported `tested 12` for a 60-mutant sweep. Prior
verdicts are now folded into the counters and the survivor list is reconstructed by matching journal
keys back onto freshly generated mutants, so a resumed run reports the whole sweep rather than its own
slice. A partial denominator is not a partial result, it is a wrong rate.

Also: one line per mutant (verdict, line, operator, source, ETA, and the killing group), and a
60-second heartbeat driven by a TIMER rather than by completions — if the mutants have stopped, the
heartbeat is what keeps saying so. --quiet-stream and --no-journal opt out.

A journal write failure now reports ONCE and disables the journal loudly. The first version swallowed
it into a bare catch and recorded nothing for a whole run because appendFileSync was not imported — a
resumability feature that silently records nothing is worse than none, since you discover it when you
try to resume.

Job count is unchanged: defaultJobs(24) = 16, which is what every sweep this session has run at.
