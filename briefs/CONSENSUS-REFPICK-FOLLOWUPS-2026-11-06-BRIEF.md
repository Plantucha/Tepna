<!-- SPDX-License-Identifier: Apache-2.0 · Copyright 2026 Michal Planicka -->
**Status:** PROPOSED — 2026-11-06 · **Created:** 2026-11-06 · **Interlocks:** `PPGDEX-ALGORITHM-DEEP-DIVE.md` §6.3 (the shipped consensus) · `PARTIAL-ADOPTION-DETECTION-2026-09-20-BRIEF.md` (count a freeze, never assume it)

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

- [ ] Each PAT leg's output carries the rule behind its feet, beside the polarity stamp it already carries.
- [ ] Each cited leg reads the shipped rule, one leg per PR. Every PR body names the numbers that moved.
- [ ] `refpickOf` grows a second rule only with a parity leg against the code it replaces.
- [ ] A doc that cites a PAT figure states the pick rule behind it.
- [ ] The census still reads every converted site as `named`, and `byRead` still answers for every examined site.

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
