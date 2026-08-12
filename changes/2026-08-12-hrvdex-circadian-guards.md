<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
5 more hrvdex `computeDerived` survivors killed (51 → 56 of 149), and a REALM bug in the test harness
that was silently disabling a branch.

The remaining survivors cluster on branches a uniform fixture cannot select: the circadian arm
(`mHour < 10 ? 1.08 : mHour > 16 ? 0.95 : 1.0`), multi-operand spectral guards
(`_hf > 0 && _lf > 0 && _vlf > 0`), an ORDERING operand (`_totalPow > r._vlf`) and a `!= null` operand
that no zero can move.

⚠️ `instanceof` IS REALM-SCOPED, and that silently cost the whole circadian third. L718 reads
`r._date instanceof Date ? r._date.getUTCHours() : 8`. The DSPs run in a vm context built from a bare
`{}`, so it has its OWN intrinsics — a host-constructed `new Date(ms)` fails that check and the code
takes the `: 8` default. Three fixtures stamped 08:00, 12:00 and 18:00 all took the MORNING arm and
produced identical numbers. Nothing errored. `env.realmDate(ms)` is added to both runners; in Node it
must be evaluated INSIDE the context (`vm.runInContext('(ms) => new Date(ms)')`) because `ctx.Date` is
not reachable as an own property of a contextified sandbox.

The discrimination check is what caught it — twice. First it showed the three hours were identical
(`d_vo2_base` unaffected: circAdj feeds `d_rmssd_circ`, not VO2). Then, with the right column, it
showed them still identical, which is what exposed the realm issue. Without that assertion this group
would have pinned one arm three times and reported branch coverage.

`circAdj` DIVIDES: `_rmssd / circAdj`, so the 1.08 morning factor makes the output SMALLER. The first
version of those two assertions asserted 1.08 and 0.95 directly and failed at 1.052632. They now state
the reciprocal they actually are.

Also pinned: `_vlf` EXCEEDING and EQUALLING `_totalPow` (the ordering operand, unreachable by
zeroing), and `_vlf`/`_totalPow` as `null` rather than 0 — 0 is not null, so no earlier fixture could
move that operand.
