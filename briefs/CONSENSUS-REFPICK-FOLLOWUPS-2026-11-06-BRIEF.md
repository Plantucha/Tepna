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

## 5 · One defect found on the way, and not fixed here

`tools/ppg-foot-consensus-e1.mjs` and `tools/ppg-fusion-e3.mjs` both write
`const refIdx = Math.max(0, keepIdx.indexOf(sel.idx));`. The shipped pick runs over every channel
while `keepIdx` holds only the distinct ones, so a pick that was de-duplicated away reads `-1` and
the clamp lands on **channel 0**. That is absence read as an index (§∅), and it needs a reachability
measurement over the corpus before anyone changes it. It rides its own residue row in the next
ledger PR.
