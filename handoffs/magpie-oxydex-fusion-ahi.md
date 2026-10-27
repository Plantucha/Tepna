<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — the OxyDex fusion block's retired AHI field (Magpie)

**Unit:** residue row `2026-10-18-oxydex-fusion-rebuilds-a-retired-ahi-field`, claimed on board #351.
**Doc-search query that found the prior work:**
`oxydex fusion block reads ECGDex retired estimatedAHI riskCategory resurrection` →
`briefs/RESIDUE.md:674-675` · `briefs/ECGDEX-CARDIOPULMONARY-COUPLING-FOLLOWUPS-2026-07-31-BRIEF.md:17-36` ·
`briefs/OXYDEX-PB-OVERCALL-2026-07-31-BRIEF.md:6-25`.

## Where this stopped (2026-10-20 03:15Z)

Shipped as **DRAFT #3727** — `claude/ahiresur-mg` at `1869d6cb9`, worktree `~/wt-ahiresur-mg`,
rebased onto `75578ffae`, board entry #359. The row closes inside the PR as `fixed #3727`, so no other
PR waits behind `briefs/RESIDUE.md`.

- `npm run check` → EXIT=0 over all 39 steps, on the pre-rebase head and again on the final head.
- Corpus lap → three corpus-backed fixtures re-stamped to `verifiedUnder 394a51594a7e`, 16 already current.
- `manifestHash` `24c1e8190160` → `97aef176fcdc`; `computeHash` `820231be1566` → `394a51594a7e`.

## What changed

`_ecgApneaScreen` in `oxydex-fusion.js` replaces an inline object literal. It drops `estimatedAHI` and
`riskCategory`, and it attaches `cvhrHours` beside `cvhrIndex` only where ECGDex attached it. Four
assertions in the OxyDex × ECG committed-pair group pin the two absences, the hours, and the
resurrection leg.

## Carry these forward

🔴 **An absence held by somebody else's code is not a guarantee.** ECGDex REMOVES the retired keys
rather than nulling them, so a current export carries neither, both reads returned `undefined`, and
`JSON.stringify` dropped them. The shipped bytes were right; the code was wrong. A reader comparing the
export against the source would have found nothing, because the two agreed.

🔴 **No current export can reach the resurrection path, so the test leg has to be hand-built.** The
test builds the legacy block itself rather than reading one from a fixture. A fixture-only pin would
have been green against a code path that still existed.

🔴 **An index published without its denominator is a defect even when the number is right.** `cvhrIndex`
counts events per hour of OBSERVED recording, and the paired export carries `cvhrHours` right beside it
upstream. A reader who sees "N /h" could not see which hours.

⚠️ `tools/verify-fixtures.mjs` takes `--check --json --selftest` and nothing else — `--app OxyDex` is
not a flag, and the tool laps the whole fixture set.

## Next step

Nothing in this unit. The next unit is the next OPEN row in `briefs/RESIDUE.md`, lane first; the unit-1
follow-on is §5 of `briefs/CVHR-HOLE-EDGE-EXCLUSION-2026-10-19-BRIEF.md`, which moves both nodes and all
six PpgDex fixtures and wants its own worktree.
