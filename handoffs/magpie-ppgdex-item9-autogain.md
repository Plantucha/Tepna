<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — PpgDex punch-list item 9, the autogain step repair (Magpie)

**Unit:** `briefs/PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md` §6 item 9, measured as experiment E-2.
**Doc-search query that found the prior work:** `autogain level step repair before filtering ringing
rmssd` → the brief's own #9 row at `:296-300` · `briefs/O2RING-FINGER-HRV-VALIDATION-2026-07-21-BRIEF.md:32-47`
· `briefs/PAPERS-AND-FIXES-BRIEF.md:55-72`.

## Where this stopped (2026-10-19 23:40Z)

**DRAFT #3708** — `claude/agstep-mg` @ `88f43a902`, worktree `~/wt-agstep-mg`, rebased onto
`bb885ad5f`. `npm run check` EXIT=0, all 39 steps, with `DEX_UPLOADS=~/Tepna/uploads`.

The answer is no. Over the 37 wrist recordings a stated size rule finds, a level-step window costs a
median 0.459 ms of rMSSD; counting only the steps that leave the pulse AC alone, which is all autogain
can explain, the median falls to 0.147 ms, under the 0.35 ms bar the brief's own bias figure sets. Four
in five of the steps a detector finds are motion-shaped. The item reads ✗ in the landing order and no
runtime code moves.

## Carry these forward

**Point `DEX_UPLOADS` at the primary checkout's `uploads/`, not at `/srv/data/tepna-corpus/uploads`.**
The CPAPDex measured-window group reads a COMMITTED input, `uploads/cpapdex_maskoff_twin_{BRP,PLD}.edf`,
and `tests/run-tests.mjs:77` resolves every input under `$DEX_UPLOADS` once it is set, where no committed
repo file lives. It reds on `origin/main` too, so it is nobody's diff. It owes a residue row and a
one-rail fallback.

**A brief Status stamp may carry no bare count.** `verify:brief-header-claims` reds any
`<number> <word>` the header asserts and nothing re-reads. The counts belong in the section the stamp
points at; the stamp names the section.

**The residue row this measurement leaves is a MASK question, not an autogain one.** Those windows mark
a median 1.34 % of kept intervals whose beat-to-beat variability sits at 7–31× a matched random null,
and the shipped clean mask keeps about 94 % of them. It waits for a free ledger slot.

## Next step

The landing order has only E-4 open in §6 and item 5 is the ACC item in another lane, so this brief's
executable remainder is done. Take the `DEX_UPLOADS` committed-input fallback next: it is a one-rail
change in `tests/run-tests.mjs` plus the residue row, and it unreds every bird's corpus-backed gate run.
