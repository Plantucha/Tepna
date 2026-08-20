<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [HRVDex, PulseDex, CPAPDex, PpgDex, Integrator]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Clock Contract §5 is now asserted: five nodes' display formatters are pinned viewer-timezone-independent.

`fmtClock`/`fmtDate`/`fmtDateTime` exist in five nodes and NOTHING checked what any of them returned.
Found by extreme mutation (`tools/extreme-mutate.mjs`): replacing a whole body with `return ''` left
the suite green, and a mutant that survives `return ''` proves there is no assertion on the output at
all — not merely a weak one.

The group forces `TZ=Asia/Kolkata` rather than trusting the ambient zone, reusing the pattern the §2.1
group established: on a UTC machine `getHours()` and `getUTCHours()` agree, so a test written on a UTC
CI box passes against a broken formatter. +05:30 is non-zero AND not a whole hour, so it also catches
an implementation that rounds to hours. The instant (22:30:15Z = 04:00:15 next day in Kolkata) moves
BOTH the hour and the date, so a date-only formatter is covered too.

Two ANTI-VACUITY assertions run first and prove the zone actually took effect, because a group that
passes on a runtime where the flip silently did nothing is the failure mode this repo keeps hitting —
a check that reports success about something it never examined.

Verified by applying four mutants and confirming each reds: the two extreme ones (`fmtClock` and
`fmtDate` bodies to `return ''`) and the two that break the actual invariant (`getUTCHours` ->
`getHours`, `getUTCDate` -> `getDate`). ⚠️ The first attempt at the extreme mutant did not apply — the
substitution silently failed to match and the suite's pass was vacuous. Grepping the mutated file
before trusting the run is what caught it.
