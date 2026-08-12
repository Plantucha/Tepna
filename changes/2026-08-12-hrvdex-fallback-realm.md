<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
8 more hrvdex `computeDerived` survivors killed by testing what happens when `quantity.js` is ABSENT —
and a runner capability that makes that possible at all.

After the guard battery, 106 survivors remained. Reading the list showed they were not a harder
version of the same problem: they cluster on `typeof DexUnits !== 'undefined' && DexUnits && ...` and
on the `else` arms those guards protect. `quantity.js` is always loaded, so those conditions are
permanently true, the fallback arms are DEAD CODE under test, and no input to `computeDerived` can
reach them. A mutant in unreachable code cannot be killed by a better fixture — only by changing what
is loaded.

`env.withGlobalRemoved(name, fn)` is added to BOTH runners (`tests/run-tests.mjs` operating on the vm
context, `Dex-Test-Suite.html` on `window`), because the DSPs run in a realm the assertions cannot
reach and the toggle has to be handed in. Restoration is in a `finally` and the group asserts it
afterwards — a global left mutated by one group fails in an unrelated one.

WHAT THE FALLBACK ARM ACTUALLY DOES, now pinned: `d_si` reads 50.986842 guarded and 0.000051
unguarded — a factor of 999742. That is the "silently mis-scaled d_si by up to 10⁶×" the L563 comment
records, standing still in a test instead of in a shipped export. `d_si_ms` reports true guarded and
false unguarded: the fallback is not merely wrong, it is wrong WITHOUT FLAGGING, because it has
nothing to detect the scale with.

A SECOND fallback I expected to be a no-op is not: `d_mxdmn_meanrr` is 0.330579 via
`DexUnits.asSecondsRR` and 330.578512 via the hard `/1000`. I assumed they would agree, since the
hard divide looks like what asSecondsRR does. They differ by 1000× — asSecondsRR reads the value's
UNIT rather than assuming ms. Pinned as measured, not as assumed.

The group opens with a discrimination check — removing DexUnits must CHANGE the answer — because a
version that pinned one arm twice would pass while comparing nothing.

computeDerived: 149 → 98 surviving, 51 killed (34%), from 43.
