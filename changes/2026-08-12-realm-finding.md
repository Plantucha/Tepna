<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
Record §9 of the follow-up brief: what executing §5 on hrvdex `computeDerived` actually found.

149 → 93 surviving, 56 killed (38%) across three PRs. The survivors fell into three shapes, each
needing a DIFFERENT kind of input rather than more of the same — single-operand guards (zero each
seed in turn), dead fallback arms (`env.withGlobalRemoved`), and branches selected by state the
fixture held constant (hour, all-night span, `null` vs `0`, pairs, an ordering operand).

⚠️ `instanceof` IS REALM-SCOPED, and it is a fleet-wide harness trap rather than an hrvdex detail. The
DSPs run in a vm context with its own intrinsics, so a host-constructed `new Date(ms)` fails
`x instanceof Date` there and the guarded code takes its else-branch silently. Five sites, all hrvdex
`_date`; one is fixed and four are named.

§9.2 records a gap that is NOT the realm bug: no test anywhere sets `_date`, so `exportCSV`'s Date
column and `exportJSONL`'s `date` field have only ever been produced on the else-branch — `''` and
`null`. A user-visible export field with zero coverage. Not attempted here because both exporters take
no arguments and drive a download from module state.

§9.4 flags the blocker on the remaining 93: they are profile-gated, which needs `setHooks`, and
`setHooks` has no getter — there is no way to restore the previous hook, and no test in the repo uses
it today. Worth deciding deliberately rather than discovering halfway through.
