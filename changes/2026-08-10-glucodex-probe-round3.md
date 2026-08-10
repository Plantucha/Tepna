<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [GlucoDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Re-sweep glucodex-dsp.js after the genSynthetic + locateColumns bootstraps, and fix a probe battery
that had never executed the function it was aimed at.

Re-sweep: 835 tested, 314 killed, 5 invalid, 516 survivors, canary PASSED. With 48 recorded
equivalents that is 314/782 = 40.2 % of DISTINGUISHABLE mutants killed, up from 34.7 %.

The battery's parseCSV family stamped its rows `M-D-YYYY HH:MM` — dash-separated, which is neither
ISO nor one of the Clock Contract §2.4 vendor formats. Every row failed to parse, every CSV threw the
same "Parsed only 0 valid readings", and 14 inputs collapsed to 4 distinct answers. Since parseCSV
throws unless ten rows parse, every mutant beyond that floor was unreachable at once.

parseNutrition was blind for the same reason in a different disguise: every case was dated ISO
`2026-07-01`, so nothing reached the file-level DMY/MDY resolution at all.

Both fixed, plus a DMY-lock case that needed a second attempt — a file starting on the 13th makes
every row self-unambiguous, so the lock never becomes load-bearing. Proven against the real mutant:
ambiguous days plus one proving row give 2026-07-05 where the mutant gives 2026-05-07.

All five families now separate every control (12/12 · 12/12 · 12/12 · 10/10 · 8/8); 25 new
classifications, glucodex ledger 23 -> 48.
