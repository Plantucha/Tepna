<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-10-28

# 38 equivalence entries excuse a mutant at an address nothing can reach

Residue row `2026-10-27-thirty-eight-drifted-entries-have-no-address-a-mechanism-can-reach` points
here. `tools/mutate-equivalence.json` excuses a mutant by `(line, op, before, after)`. Code moves, so
an entry drifts off its line. `tools/reanchor-equivalence.mjs` re-anchors the unambiguous ones and
leaves the rest orphaned, which is the right refusal. This brief asks what to do with the orphans
that no further mechanism can place.

## The census (one `--qualify` run at `3791af39a`, 2026-10-28)

| population | entries |
|---|---|
| ledger entries over 11 files | 434 |
| already carrying a function qualifier | 320 |
| drifted off their line | 104 |
| drifted, placeable whichever function the entry recorded | 59 |
| drifted, placeable for some of the names it could have carried | 7 |
| **drifted, placeable never — one mutation repeated inside one function** | **12** |
| **drifted, no candidate mutant at all — the generator dropped the mutation** | **26** |

The last two rows are the 38. The gate now reports them: `drifted_entries_with_no_reachable_address`
is the pre-stated criterion, the status reads SHORTFALL, and each entry prints with its group and
with what it stopped excusing.

## The control that closes the obvious rescue

421 of the 434 entries open their `why` with `In <function>.`, so the recorded function looks
readable from the prose. 313 entries carry both that prose and a machine-read `fn`, which makes them
a control. The prose disagrees with the qualifier on 10 of those 313. It names `dfaAlpha1` for
`dfaAlpha1Segmented`, `countPairs` for `countPairsIn`, and `markO2Sentinels` for
`markO2BeatMarkers`. So the prose names an outer, neighbouring or since-renamed function, and
placing an entry by it would mis-anchor about one entry in 32. This tool holds that a wrong
re-anchor costs more than a lost entry, so it reports the rate and consumes nothing.

## What an orphan still costs

An orphan excuses nothing, because `tools/mutate.mjs` matches an excuse by line. It still records a
judgement: a probe ran, a human read the output, and the pair agreed on every input. Deleting the
entry drops that record. Keeping it leaves a reader to believe the ledger covers a mutant it cannot
reach. Both cost something, which is why the choice needs the owner's word rather than a tool's
default.

## The decision this brief asks for

1. **Delete the 26 `gone` entries.** Their mutation no longer exists, so no sweep can meet them
   again. A deletion drops a judgement about code that may return under the same shape.
2. **Decide the 12 `never` entries.** Each repeats one mutation inside one function, so no qualifier
   separates the pair. Re-probing both mutants under one entry would cover them, and that needs a key
   this ledger does not have.
   The Python lane met the same wall and wrote it down: `briefs/MUTATION-SURVIVOR-LEDGER-2026-09-28-BRIEF.md`
   § 2a-bis holds that a key needs content **and** position, because two survivors in one function with
   identical mutation text share every content field. So a fix here is a key change, not a qualifier.
3. **Rule on the 7 conditional entries.** A probe at each candidate address would place them, at the
   cost of one `--only` run per entry.

## The 38, named

| file | line | op | tag | function the prose names | class |
|---|---|---|---|---|---|
| `ppgdex-dsp.js` | 353 | `bool || → &&` | gone | `parsePPG` | no-distinguishing-input |
| `ppgdex-dsp.js` | 449 | `cmp > → >=` | never | `parsePPG` | no-distinguishing-input |
| `ppgdex-dsp.js` | 477 | `cmp >= → >` | gone | `parsePPG` | no-distinguishing-input |
| `ppgdex-dsp.js` | 484 | `cmp > → >=` | never | `parsePPG` | no-distinguishing-input |
| `ppgdex-dsp.js` | 1592 | `cmp < → <=` | never | `beatConfidence` | no-distinguishing-input |
| `ppgdex-dsp.js` | 1628 | `cmp < → <=` | never | `beatConfidence` | no-distinguishing-input |
| `ppgdex-dsp.js` | 732 | `num → 0` | gone | `channelSNR` | no-distinguishing-input |
| `ppgdex-dsp.js` | 734 | `cmp < → <=` | gone | `channelSNR` | no-distinguishing-input |
| `ppgdex-dsp.js` | 735 | `eq === → !==` | gone | `channelSNR` | no-distinguishing-input |
| `ppgdex-dsp.js` | 735 | `eq === → !==` | gone | `channelSNR` | no-distinguishing-input |
| `ppgdex-dsp.js` | 735 | `bool && → ||` | gone | `channelSNR` | no-distinguishing-input |
| `ppgdex-dsp.js` | 2102 | `cmp > → >=` | gone | `countPairs` | no-distinguishing-input |
| `ppgdex-dsp.js` | 2105 | `cmp > → >=` | gone | `countPairs` | no-distinguishing-input |
| `ppgdex-dsp.js` | 2112 | `cmp <= → <` | gone | `countPairs` | no-distinguishing-input |
| `ppgdex-dsp.js` | 2120 | `cmp > → >=` | gone | `countPairs` | no-distinguishing-input |
| `ppgdex-dsp.js` | 778 | `cmp > → >=` | gone | `pickChannel` | no-distinguishing-input |
| `ppgdex-dsp.js` | 1829 | `cmp > → >=` | never | `timeDomain` | no-distinguishing-input |
| `ppgdex-dsp.js` | 2132 | `bool || → &&` | gone | `sampEn` | no-distinguishing-input |
| `ppgdex-dsp.js` | 262 | `cmp > → >=` | gone | `markO2Sentinels` | no-distinguishing-input |
| `ppgdex-dsp.js` | 2691 | `cmp < → <=` | gone | `validatePPI` | no-distinguishing-input |
| `hrvdex-dsp.js` | 640 | `bool && → ||` | gone | `computeDerived` | no-distinguishing-input |
| `hrvdex-dsp.js` | 640 | `bool && → ||` | gone | `computeDerived` | no-distinguishing-input |
| `hrvdex-dsp.js` | 640 | `num → 0` | gone | `computeDerived` | no-distinguishing-input |
| `hrvdex-dsp.js` | 650 | `bool && → ||` | gone | `computeDerived` | no-distinguishing-input |
| `hrvdex-dsp.js` | 650 | `bool && → ||` | gone | `computeDerived` | no-distinguishing-input |
| `hrvdex-dsp.js` | 650 | `num → 0` | gone | `computeDerived` | no-distinguishing-input |
| `hrvdex-dsp.js` | 755 | `cmp <= → <` | gone | `computeDerived` | equivalent |
| `hrvdex-dsp.js` | 736 | `num → 0` | gone | `computeDerived` | no-distinguishing-input |
| `hrvdex-dsp.js` | 855 | `bool && → ||` | gone | `computeDerived` | no-distinguishing-input |
| `hrvdex-dsp.js` | 1157 | `bool && → ||` | never | `hrvBuildNodeExport` | no-distinguishing-input |
| `hrvdex-dsp.js` | 1168 | `bool && → ||` | never | `hrvBuildNodeExport` | no-distinguishing-input |
| `motiondex-dsp.js` | 792 | `cmp > → >=` | never | `respWindowSpectrum` | no-distinguishing-input |
| `motiondex-dsp.js` | 792 | `cmp < → <=` | never | `respWindowSpectrum` | no-distinguishing-input |
| `motiondex-dsp.js` | 813 | `cmp < → <=` | never | `respWindowSpectrum` | no-distinguishing-input |
| `motiondex-dsp.js` | 817 | `cmp > → >=` | never | `respWindowSpectrum` | no-distinguishing-input |
| `motiondex-dsp.js` | 817 | `cmp < → <=` | never | `respWindowSpectrum` | no-distinguishing-input |
| `cpapdex-dsp.js` | 722 | `cmp < → <=` | gone | `oximetryLane` | no-distinguishing-input |
| `glucodex-dsp.js` | 1792 | `cmp > → >=` | gone | `parseNutrition` | no-distinguishing-input |

The `tag` column reads `gone` where no candidate mutant exists and `never` where one mutation repeats
inside one function. The prose column is evidence about the entry, not an address — see the control
above.

## Acceptance

- [ ] The owner rules on each of the three groups above.
- [ ] A deletion lands with the ruling quoted in the PR body, and the gate's SHORTFALL count moves by
      exactly the number deleted.
- [ ] A re-probe lands under `--probe`, never under a bare `--write`.
- [ ] The residue row closes against this brief or against the PR that discharges it.
