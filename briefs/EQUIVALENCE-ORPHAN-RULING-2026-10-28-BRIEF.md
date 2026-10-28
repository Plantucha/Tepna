<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-10-28 · **Created:** 2026-10-28 · **Residue:** 2026-10-28-two-equivalence-excuses-sit-over-six-sites-one-of-which-the-suite-kills

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

## What the owner ruled, and what landed (2026-10-28, PR #4039)

Kestrel ruled on all three groups, and then widened ask 1 when the measurement showed the principle
reached further than the census row did.

> (1) DELETE the 26 entries whose mutation the generator no longer produces; an entry that matches
> nothing excuses nothing. (2) PROBE the 7 partial placers and re-address or delete each by the probe
> result. (3) For the 12 repeats in one function, measure whether each copy is a distinct site;
> propose per entry, and keep any that names a real distinct site. Escalate to me only what the data
> cannot decide.

> yes, 29. The principle covers all of them; delete every entry that produces no candidate under the
> loose key and whose before-text is absent from its file, and list all 29 with both proofs in the PR
> body.

### Ask 1 · the 29 deleted, on two proofs each

The census named 26 because it counted the qualifier's `gone` bucket, which excludes the three
`clock.js` entries that carry no `after` at all. The ruling names the principle rather than the
bucket, so the population is 29. `--prune` deletes an entry only when BOTH proofs hold, and the
two ask different questions. The loose key asks what the GENERATOR emits at that `(op, before)`; the
text asks what the FILE still holds. All 29 read 0 candidates and absent text, measured three ways —
whitespace-collapsed whole-line, whitespace-collapsed substring, and raw bytes.

An entry with no candidate whose text IS still present is the middle class, and the rule KEEPS it:
the operator stopped firing there while the code it judged did not move, so the mutation may return
while the excuse would already be gone. The run found 0 of those, which is why this ruling cost
nothing in judgement.

### Asks 2 and 3 · the 19 settled against a probe of every site

Neither group is readable from the entry. All 19 carry no `fn`, and the prose that looks like one
misnames the function on 10 of the 313 entries where a machine-read copy exists to check it. What
breaks the tie is the probe: it plants every candidate site and runs the covering suite, so each
site returns `survived` or `killed`. The entries of one cohort are identical in `(op, before, after)`
and differ only in a `line` already known to be wrong, so a decision is about the cohort and the
SITES, never about which entry object is which.

Five rules over `n` entries, `S` surviving sites and `K` killed sites. They are a policy, written
after the probe and open to the owner's overrule; the measurement under them is not.

| rule | shape | action |
|---|---|---|
| 0 | any site without a verdict | ESCALATE — an absence is not a survival (§∅) |
| 1 | `\|S\| = 0` | DELETE all `n`. The probe planted each mutant and the suite killed every one |
| 2 | `\|S\| = n` | ADDRESS each entry to one survivor in line order. A bijection |
| 3 | `\|S\| < n` | ADDRESS `\|S\|`, DELETE the surplus as refuted |
| 4 | `\|S\| > n`, `K` empty | ADDRESS the first `n` survivors. The choice is consequence-free |
| 5 | `\|S\| > n`, `K` non-empty | ESCALATE. A killed site makes the address matter |

Rule 1 is the one deletion this unit makes on a REFUTED verdict, and the fleet rule of 2026-10-05
governs it: never weaken an equivalence entry on a refutation without planting the mutant and
watching the covering suite fail. The probe IS that control. No write ever moves an address onto a
site this run did not watch survive, and one leg asserts that over all six rules at once rather than
per rule.

| file | entry `line` | op | sites probed — `fn:line` ✓ survived / ✗ killed | rule | decision |
|---|---|---|---|---|---|
| `ppgdex-dsp.js` | 449 | `cmp > → >=` | `parsePPG:1182` ✗ · `parsePPG:1274` ✓ | 3 | **re-addressed** → `parsePPG:1274` |
| `ppgdex-dsp.js` | 484 | `cmp > → >=` | `parsePPG:1182` ✗ · `parsePPG:1274` ✓ | 3 | **deleted** |
| `ppgdex-dsp.js` | 485 | `cmp < → <=` | `pinnedSpans:568` ✓ · `parsePPG:1275` ✓ · `parsePPG:1412` ✓ · `cadenceSamples:2199` ✓ · `pearson:2711` ✗ · `movementOnsets:3787` ✓ | 5 | **escalated** |
| `ppgdex-dsp.js` | 577 | `cmp < → <=` | `pinnedSpans:568` ✓ · `parsePPG:1275` ✓ · `parsePPG:1412` ✓ · `cadenceSamples:2199` ✓ · `pearson:2711` ✗ · `movementOnsets:3787` ✓ | 5 | **escalated** |
| `ppgdex-dsp.js` | 1578 | `cmp < → <=` | `beatSQI:2461` ✓ · `beatSQI:2495` ✗ · `beatRegularity:2540` ✗ · `beatConfidence:2753` ✗ | 2 | **re-addressed** → `beatSQI:2461` |
| `ppgdex-dsp.js` | 1592 | `cmp < → <=` | `beatConfidence:2767` ✗ · `beatConfidence:2803` ✗ | 1 | **deleted** |
| `ppgdex-dsp.js` | 1628 | `cmp < → <=` | `beatConfidence:2767` ✗ · `beatConfidence:2803` ✗ | 1 | **deleted** |
| `ppgdex-dsp.js` | 1851 | `cmp < → <=` | `timeDomain:3197` ✗ · `timeDomain:3206` ✗ · `poincare:3233` ✗ | 1 | **deleted** |
| `ppgdex-dsp.js` | 1829 | `cmp > → >=` | `timeDomain:3203` ✗ · `timeDomain:3210` ✓ | 2 | **re-addressed** → `timeDomain:3210` |
| `hrvdex-dsp.js` | 1157 | `bool && → \|\|` | `hrvBuildNodeExport:1258` ✓ · `hrvBuildNodeExport:1269` ✓ | 2 | **re-addressed** → `hrvBuildNodeExport:1258` |
| `hrvdex-dsp.js` | 1168 | `bool && → \|\|` | `hrvBuildNodeExport:1258` ✓ · `hrvBuildNodeExport:1269` ✓ | 2 | **re-addressed** → `hrvBuildNodeExport:1269` |
| `motiondex-dsp.js` | 792 | `cmp > → >=` | `respWindowSpectrum:992` ✓ · `respWindowSpectrum:1017` ✓ | 2 | **re-addressed** → `respWindowSpectrum:992` |
| `motiondex-dsp.js` | 817 | `cmp > → >=` | `respWindowSpectrum:992` ✓ · `respWindowSpectrum:1017` ✓ | 2 | **re-addressed** → `respWindowSpectrum:1017` |
| `motiondex-dsp.js` | 792 | `cmp < → <=` | `respWindowSpectrum:992` ✓ · `respWindowSpectrum:1017` ✓ | 2 | **re-addressed** → `respWindowSpectrum:992` |
| `motiondex-dsp.js` | 817 | `cmp < → <=` | `respWindowSpectrum:992` ✓ · `respWindowSpectrum:1017` ✓ | 2 | **re-addressed** → `respWindowSpectrum:1017` |
| `motiondex-dsp.js` | 813 | `cmp < → <=` | `respWindowSpectrum:972` ✗ · `respWindowSpectrum:988` ✗ · `respWindowSpectrum:1006` ✗ · `respWindowSpectrum:1013` ✓ | 2 | **re-addressed** → `respWindowSpectrum:1013` |
| `pulsedex-dsp.js` | 1100 | `cmp < → <=` | `parseRRInput:829` ✓ · `parseRRInput:853` ✓ · `compareIntervalSeries:1112` ✓ | 4 | **re-addressed** → `parseRRInput:829` |
| `glucodex-dsp.js` | 1343 | `cmp < → <=` | `detectClampSaturation:1415` ✓ · `spikeAt:1461` ✓ · `pearson:1723` ✗ · `pearson:1732` ✗ | 2 | **re-addressed** → `detectClampSaturation:1415` |
| `glucodex-dsp.js` | 1389 | `cmp < → <=` | `detectClampSaturation:1415` ✓ · `spikeAt:1461` ✓ · `pearson:1723` ✗ · `pearson:1732` ✗ | 2 | **re-addressed** → `spikeAt:1461` |

## The buckets reconcile exactly

One `--qualify` run before and one after, with no bucket left over.

| qualifier bucket | before (434) | after (401) | what moved it |
|---|---|---|---|
| `alreadyQualified` | 320 | 322 | +2, the only re-addresses whose identity names one mutant |
| `identityCollides` | 4 | 15 | +11, the re-addresses that stay line-keyed (next section) |
| `drifted` | 104 | 61 | −43 = 26 `gone` deleted + 4 refuted + 13 re-addressed |
| ↳ `driftMutationGone` | 26 | 0 | all deleted |
| ↳ `driftNeverPlaceable` | 12 | 0 | 9 re-addressed, 3 deleted |
| ↳ `driftPlacedOnlyForSomeFn` | 7 | 2 | 4 re-addressed, 1 deleted, 2 escalated |
| ↳ `driftPlacedForAnyFn` | 59 | 59 | untouched; the qualifier already places these |
| `noAfterRecorded` | 6 | 3 | −3, the `clock.js` entries |

Both columns add to their own total: 320 + 4 + 104 + 6 = 434, and 322 + 15 + 61 + 3 = 401. The 11 that
move into `identityCollides` are the tool's OWN verdict on them, under the same condition
`qualifyPlan` has always applied, so the two passes agree rather than needing a special case.

## A re-address and a qualifier are two decisions, and only 2 of 13 earned the second

The first push of this work wrote `fn` on all 13 re-addressed entries, and capture-host's
`tests/test_equivalence_ledger.py::test_a_FUNCTION_QUALIFIER_is_unique_within_its_module` redded on
CI with *a function qualifier that excuses more than one mutant*. The red is right, and the defect is
mine.

**The two decisions differ in what the probe can support.** Moving `line` rests on a measurement:
the probe watched that exact site survive. Writing `fn` REPLACES the line in the entry's identity, so the match
becomes the line-free `(fn, op, before, after)` — and that is safe only under the condition
`qualifyPlan` has always applied, that exactly ONE generated mutant carries the identity. A cohort of
two surviving sites inside one function fails it by construction, which is precisely the shape the
settle pass re-addresses.

**The gate saw 6 of the 11, and the tool's own condition sees all 11.** The python invariant compares
ledger entries to each other, so it fires only on a PAIR of qualified entries sharing an identity —
3 pairs here. It cannot see a lone qualified entry whose identity names two generated mutants, which
is the other 5 (`ppgdex-dsp.js` L1274, L2461, L3210 · `motiondex-dsp.js` L1013 · `pulsedex-dsp.js`
L829). Entry-to-entry comparison is the weaker instrument; entry-to-generator is the question that
decides the matter. Logged as residue against the test, not against this ledger.

| re-address | identity | qualifier |
|---|---|---|
| `glucodex-dsp.js` L1415 `detectClampSaturation` | 1 generated mutant | **written** |
| `glucodex-dsp.js` L1461 `spikeAt` | 1 generated mutant | **written** |
| `ppgdex-dsp.js` L1274 · L2461 · L3210 | 2 each | line-keyed |
| `hrvdex-dsp.js` L1258 · L1269 | 2 each (one identity, two entries) | line-keyed |
| `motiondex-dsp.js` L992 ×2 · L1017 ×2 | 2 each (two identities, two entries each) | line-keyed |
| `motiondex-dsp.js` L1013 | 4 | line-keyed |
| `pulsedex-dsp.js` L829 | 2 | line-keyed |

A line-keyed re-address keeps everything the probe measured and loses only the drift resistance a
qualifier would have added. `settleQualifier()` now makes the call, five selftests pin it, and each
refused entry records its own reason in `reanchored.rule`.

The `clock.js` three are why the census said 26 and the ruling says 29.
`tools/reanchor-equivalence.mjs:168` bins an entry with no `after` as `legacy` and `continue`s, so a
no-after entry never reaches a drift bucket and `gone` could not have counted them.

A dry `--prune` over the rebased ledger reads `orphansFound: 0` of 401, which is the post-state
control: nothing prunable is left.

### How each acceptance item was met, including where the item's own premise was wrong

Item 2 asked that the gate's SHORTFALL count move by exactly the number deleted. Two things in that
sentence did not hold. The qualifier gate reads PASS in both states, because its criterion counts
drift with no reachable address and that was already 0. And the count moved by 43 rather than 33,
because the probe re-addressed 13 entries instead of deleting them. The table above reconciles every
bucket to the entries that moved it, with nothing left over, which is the stronger form of what the
item wanted.

Item 3 asked that a re-probe land under `--probe` and never under a bare `--write`. It landed under
`--settle`, a new pass that probes every candidate site first and writes only what the probe
settled. No bare `--write` touched these entries, and `--prune` and `--settle` both refuse to run
beside `--probe` or `--qualify`.

## Acceptance

- [x] The owner rules on each of the three groups above.
- [x] A deletion lands with the ruling quoted in the PR body, and every qualifier bucket reconciles
      to the entries that moved it — see the note above on what the item assumed.
- [x] A re-probe lands under `--settle`, which probes first; never under a bare `--write`.
- [x] The residue row closes against this brief, and a new row carries the two escalated entries.
