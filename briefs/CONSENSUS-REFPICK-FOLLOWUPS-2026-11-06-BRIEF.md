<!-- SPDX-License-Identifier: Apache-2.0 · Copyright 2026 Michal Planicka -->
**Status:** IN-PROGRESS — 2026-11-22 · **Created:** 2026-11-06 · **Interlocks:** `PPGDEX-ALGORITHM-DEEP-DIVE.md` §6.3 (the shipped consensus) · `PARTIAL-ADOPTION-DETECTION-2026-09-20-BRIEF.md` (count a freeze, never assume it)

# CONSENSUS-REFPICK-FOLLOWUPS — the reference pick is named everywhere; it is still not the same rule

## 0 · What this brief is for

Row `2026-11-03-three-pick-rules-disagree-on-the-consensus-reference-on-thirty-seven-nights` found
three live rules choosing the channel every consensus foot rests on. The row named two
remedy shapes. One of them is now built, so this brief carries only the other.

That row's source cell names its origin pull request, so the Status line above claims no
`**Residue:**` field — the gate reads that field as "this brief is the row's source". A separate
ledger-only pull request closes the row to this brief.

**Built, and enforced.** `tools/consensus-refpick-dissent.mjs` holds a declared rule per call site and
reds an undeclared site, a changed rule and a stale entry. `tools/selftest-all.mjs` sweeps every
`tools/*.mjs` selftest under the `npm run check` step `test:tools`, and that selftest holds the live
tree to the table. Eight legs that each carried a private copy of one argmax loop now call
`consensus-dissent-core.mjs#refpickOf(per, 'peak-argmax')`, so the census reads a declaration instead
of inferring a rule from a comparison. Measured on this branch: 13 call sites, **8 named · 5
inferred**, 0 undeclared, 0 diverged.

Five sites keep the inferred read for a reason, and the reason is not neglect:

| site | why it cannot name its rule |
|---|---|
| `ppgdex-dsp.js` | inlined into bundles, so it imports no module from `tools/` |
| `pat-feasibility-worker.js` · `sensor-trio-worker.js` | workers loaded by `importScripts`, same bar |
| `tools/ppg-foot-consensus-e1.mjs` · `tools/ppg-fusion-e3.mjs` | they call the shipped `pickChannel`, so the scan reads their rule off the callee — stronger evidence than a loop shape |

## 1 · The defect that remains

Nine of the thirteen sites pick the channel with the most detected peaks. The shipped node picks on
pulse-band SNR and then moves that pick with `harmonicOutlierRefIdx`. The two rules name a different
reference channel on **37 of 54 Verity nights**.

Those nine sites are the ported PAT legs. Their whole purpose is to characterise the shipped path, so
a leg deriving its feet on another channel than the node does is not measuring the node. A reader
comparing two published tables cannot see the difference, because neither table states its rule.

## 2 · Three options, and the one this brief recommends

**A · Converge every leg onto the shipped rule.** Every published PAT figure is then re-cut. The
numbers move by an unmeasured amount, and some sit in reader-facing docs.

**B · Keep each rule and stamp it on the figure.** Cheap and honest. It repairs no comparison: it only
stops a reader assuming one.

**C · Converge the legs a doc holds against the shipped path, and leave the rest declared.**

**Recommended: C, carrying B's stamp, one leg per PR.** The PAT legs exist to characterise the shipped
path, so for them the shipped rule is the only rule that answers the question they ask. A leg whose
figures nobody holds against the node keeps its rule and its declaration. Each PR re-runs its own leg
and names every number that moved. The stamp travels first, so a reader of an older table can still
tell which rule produced it.

Osprey decided this under CLAUDE.md §7 and the owner may overrule it.

## 3 · Acceptance

- [x] Each PAT leg's output carries the rule behind its feet, beside the polarity stamp it already carries.
- [ ] Each cited leg reads the shipped rule, one leg per PR. Every PR body names the numbers that moved.
  - `tools/beat-correspondence.mjs` reads the shipped rule since PR 5474. The reference moved on
    both nights the paper cites: channel 0 to channel 2 on 2026-07-04, and channel 2 to channel 0
    on 2026-07-11. Both nights still refuse every plane, so the cited chance control holds.
  - `tools/pat-host-offset.mjs` reads the shipped rule since 2026-11-23. Over six archive nights the
    pick moved on 4 of 5 scored streams. Nine of twelve shared windows moved a number. One window
    crossed the chance line. `2026-10-04 win 0` moved `strictP` from 0.0392 to 0.0588, so the
    significant strict windows fell from 6 to 5.
  - `pat-feasibility-worker.js` keeps `peak-argmax`, and the paper now states that rule beside the
    figures this leg produced. The worker runs only in a browser over dropped capture folders, and
    no node harness executes its analyse path. So no PR can name the numbers that moved. A
    conversion first owes a browser re-run of Table 1, which also puts capture filenames on screen.
    Heron decided this under CLAUDE.md §7 on 2026-11-23, board entry #7993.

  - `tools/pat-matchrate-strict.mjs` reads the shipped rule since 2026-11-23. This rig holds raw
    capture for 2 of the 6 nights the §3a table pins. On 2026-07-26 ten numbers moved and no
    verdict moved. On 2026-07-28 every number held, so both rules name one channel there. The
    2026-07-25 night refuses alignment under both rules, at 0 anchors.

    Every doc-cited leg now reads the shipped rule, except the browser worker. Decision #7993
    holds that leg open, so this box stays open.
- [x] `refpickOf` grows a second rule only with a parity leg against the code it replaces. `snr-pick-guarded` delegates to the shipped pick, and 17 parity assertions hold it against `analyze`.
- [ ] A doc that cites a PAT figure states the pick rule behind it. Count the FIGURES, not the surfaces.
  - Population: every reader-facing surface under `papers/` and `docs/papers/`, plus every brief
    that pins a figure a PAT leg produced. The app bundles name a PAT tool as a code reference,
    never a figure. So the box does not bind there. Thirty further briefs name a PAT leg and pin
    none of its figures.
  - Three surfaces now name their rule: `papers/wearable-clock-drift.html` §3.6, the 52-night
    entry in `papers/RERUN-RESULTS.md`, and the §3a sweep table in
    `PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md`.
  - Both briefs now name their rule. `RADIO-DELAY-FLOOR-2026-11-03-BRIEF.md` states the peak-count
    argmax beside its per-night beat offsets. `PAT-FORENSICS-WINDOW-REGIMES-2026-08-28-BRIEF.md`
    states the same rule in §8.1 for every §8 number. The rig corpus copy holds none of the three
    RADIO-DELAY-FLOOR nights. So that brief keeps a rule line and no re-run.
  - Corrected 2026-11-23: the tick above counted each surface once, so it missed a second leg inside
    one surface. `papers/wearable-clock-drift.html` pinned Table 1 and the 11 of 21 pass rate from
    `pat-feasibility-worker.js` with no rule beside either. This PR states the rule in the Table 1
    caption and in the §5 determinism bullet.

    The paper also pins 54-pairing figures and box-capture sigma figures, and this unit did not
    identify the leg that produced them. So the box counts figures from here, and it stays open on
    those two groups.

    Resolved 2026-11-23: both groups trace to `pat-feasibility-worker.js`, which picks the
    reference channel by a peak-count argmax. The paper withdraws the 54-pairing figures, and it
    keeps them only as the claim it corrects. So the box does not bind to that group. This PR
    states the rule beside the live box-capture sigma figures in the paper. The same statement
    goes under the six-night table in `PAT-COMPENDIUM-2026-08-10-BRIEF.md`.

    The box stays OPEN on one column. `PAT-COMPENDIUM-2026-08-10-BRIEF.md` pins a Rayleigh R per
    night, and no artifact in the tree declares that column. `tools/circular-stats.mjs` has one
    consumer, the Integrator block-precision tool, which measures a different quantity. The box
    closes when a bird names the producer, or when the brief withdraws the column.

    I searched the tree on 2026-11-23, and the column has no producing artifact. I read every tracked
    `*.js`, `*.mjs` and `*.py` outside `node_modules` for `rayleigh`, and again for `resultant`,
    `concentration`, `lag phase` and `phase lock`. Three artifacts compute a mean resultant length for
    a different quantity, and `pat-feasibility-worker.js` carries no circular math.
    `PAT-COMPENDIUM-2026-08-10-BRIEF.md` now states that beside the six-night table.

    DECISION (§7, Heron, 2026-11-23): the brief KEEPS the Rayleigh column and labels it. No
    reader-facing surface cites it, and a delete would destroy a one-session measurement, so I
    rejected the delete. The box still owes a figure census over the docs, so it stays unticked.
- [x] The census still reads every converted site as `named`, and `byRead` still answers for every examined site.
  - I measured the live tree on 2026-11-23 at `6e76825c7`. The census reads 13 call sites, 8 named and
    5 inferred, with 0 undeclared and 0 diverged. The two read counts sum to the examined population.
    `tools/selftest-all.mjs` runs that leg under the `npm run check` step `test:tools`.
  - ⚠️ **A total cannot hold a set.** I reverted `tools/pat-finger-coupler.mjs` to its old argmax loop
    and re-ran the selftest. All three totals stayed green at 7 named and 6 inferred of 13. No leg went
    red, so the gate could not see a conversion reverting.
  - `INFERRED_SITES` now names the five sites that cannot delegate, each with its reason. Three new
    selftest legs hold the complement of `DECLARED_PICKS` to the live tree. The excuses must name
    declared sites. The source must call `refpickOf` at exactly the eight unexcused sites. The scan
    must read `named` at the same eight.
  - Each leg carries its own mutant. The planted revert reds two legs. Dropping one excuse reds two
    legs. An excuse for a file the table does not declare reds the first leg. The clean tree passes all
    92 assertions.
  - The population boundary stays worth stating. `SCAN` reads root `*.js` plus `tools/*.{mjs,js}`, and
    it never recurses. `tests/dex-tests.js` holds four `consensusBeats` calls outside it, and each one
    passes a literal `0` reference. `ppgdex-dsp.js:2998` is the declaration, which the scan skips under
    its own assertion.

## 4 · What must not be done

- **Never re-stamp a figure instead of re-running the leg.** A moved pick is a moved measurement.
- **Never widen `REFPICK_RULES` without a parity leg.** The helper refuses a rule it does not implement, and that refusal is the guard.
- **Never read a `byRule` count as agreement.** It counts sites, not nights, and the nights are where the rules part.

## 5 · One hazard found on the way, measured, and not a defect

`tools/ppg-foot-consensus-e1.mjs:559` and `tools/ppg-fusion-e3.mjs:505` both write
`const refIdx = Math.max(0, keepIdx.indexOf(sel.idx));`. An earlier draft of this section called that
a live §∅ defect, on the reasoning that the pick runs over every channel while `keepIdx` holds only
the distinct ones, so a de-duplicated pick reads `-1` and the clamp lands on channel 0. **That read
was wrong, and the clamp cannot fire.** Osprey withdrew the finding on 2026-11-06.

`sameChannel` (`ppgdex-dsp.js:2391`) compares sample by sample, so a dropped duplicate is byte
identical to the channel `distinctChannelIdx` kept. `channelSNR` is pure in the samples and `rec.fs`,
so both copies score the same number. `pickChannel` scans ascending and advances only on a strict
`s.snr > bestScore`, so the first member of an equality class always wins — and that first member is
the kept one.

Three further paths close as well. When no channel scores finite, `best` keeps its initial 0, and
index 0 is always kept. `detectChannel` is pure, since `bandpass` allocates, so nothing mutates
`rec0.ch` between the de-dup at e1:545 and the pick at e1:558. And two arrays holding `NaN` at one
position never compare same, so a duplicate carrying `NaN` is kept rather than dropped.

A probe over the real module ran seven constructed records: the duplicate as the best channel, the
duplicate pair leading, the best duplicated at the end, a duplicate straddling a distinct channel, all
three identical, every channel flat, and a distinct control. The clamp fired in **0 of 7**, and
`indexOf` returned the pick's own position every time.

**What remains is conditional, and it is why this section stays.** The clamp becomes reachable the day
`pickChannel` relaxes its comparison, or `sameChannel` grows a tolerance so that a near-duplicate gets
dropped. Nothing downstream separates a real position 0 from a repaired `-1`, so the failure would be
silent. A reader who changes either function owes this line a second look.
