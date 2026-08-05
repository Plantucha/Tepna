<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [Integrator]
brief: MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md
---
Four `clock.js` survivors previously reported as having **no distinguishing input** in fact had one. The batteries were the problem, in two specific ways, and both were about the *probe* rather than the code.

**The geometry could not separate anything.** Waves 1–7 probed `hostAxis` at n = 2/3/4/11/41 anchors. The running median is `CK_AXIS_WIN = 21` wide, so below n = 23 **every** window clamps to the whole series and `sm[k]` is identical for every k. A battery that cannot make two smoothed points differ cannot detect a mutant that returns the wrong one — three of those five geometries were incapable of a verdict, and reported "equivalent" anyway.

**Duplicate anchor `devMs` was never tried.** `pts` is sorted but never deduped, so two anchors in the same millisecond — a stuck device clock, or two sync events inside one tick — are a legitimate input, and they are the *only* way an endpoint guard's fall-through can land somewhere the guard itself would not.

Killed: `L386` (`x <= pts[0].d`), `L387` (`x >= pts[n-1].d`), `L392` (the binary-search comparison), `L138` (the `dateAnchorMs` validity conjunction). Assertions are written as the contract the code already claims — *"linear between anchors; FLAT outside them"*, and a monotone drift yields a monotone correction — not as the shape of a mutant.

**`L387`'s test passed under its own mutant on the first attempt.** Duplicating index 40 onto index 39's `devMs` makes `39*60000` the last anchor, so querying `40*60000` lands in the flat region where the guard and its mutant already agree. It was green, it looked right, and it caught nothing; only re-applying the mutant exposed it. Recorded in the test.

Also found and pinned as behaviour, not asserted as intent: **a `Date` object `dateAnchorMs` is accepted**, because `isFinite(new Date(0))` coerces to `0`. The value it coerces to is the documented unit, so this is leniency rather than a fabricated instant — but nothing had pinned it either way.

`clock.js` is now **103 real kills / 122 valid mutants = 84.4 %**, with the remaining 19 survivors each carrying a recorded reason. Tests only — no shipped source, no `manifestHash` movement, no fixture re-recorded.
