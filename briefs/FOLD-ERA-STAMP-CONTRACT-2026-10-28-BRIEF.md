<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS · **Created:** 2026-10-28

# Which code era should a night carry when the fold never stamped it?

`#4015` measured the exposure. `#4015` gated the three-leg case. This brief holds the half that
needs the owner's ruling, because it changes a contract rather than a tool.

## What the corpus holds

90 of 147 tracked trio nights carry a `.trio-stamp`. The other 57 carry none, so 80 of 415 tracked
exports name no folding code.

Two reader triples exist, and the census measures both. Exactly the 90 stamped nights hold the fold's
triple (ECGDex · OxyDex · PpgDex). 65 nights hold a beat triple (ECGDex · PpgDex · PpgDexFinger), and
every one of them carries a stamp. So no three-leg reader reaches an era-less export today. The seven
partial-leg readers do.

## Nine nights sit one export short of the beat triple

The era census now names every reader triple with its own test, and reports each night that holds all
but one node. Nine unstamped nights hold two of the beat triple's three nodes, and seven of them need
only an ECGDex export. A re-fold that writes that one export and no stamp hands a three-leg reader an
era-less night. The census fails on such a night now, rather than passing because the fold's own
triple stayed intact. The nine nights are a tripwire, not a defect: the third export is absent, so
they hold no reader's triple today.

`#4057` delivered the reader half under §∅. Each of the seven now names the era of the nights it read,
and names every night that carries none. The number stands; the line states what is unrecorded.

## The question for the owner

A stamp records the code that folded a night. Nobody folded 57 of these nights under the stamp
contract, so no stamp exists to read. Four answers are open.

1. **Leave them era-less.** The readers annotate. Nothing re-folds. This is today's state.
2. **Re-fold the 57 nights.** `trio-batch.mjs` writes a stamp per night, so a re-fold grants every
   night an era. This rewrites 80 tracked exports. §∅ holds that captured bytes are immutable, and
   a fold derives an export rather than capturing it, so the rule does not bind. The diff is large.
3. **Back-stamp from git.** The commit that added each export names a code state. A stamp written
   from that commit asserts an era nobody measured, which §🧾 reads as `UNKNOWN`.
4. **Delete the era-less exports.** The residue row that opened this question listed deletion as a
   third remedy. A deleted export asserts no era and needs no stamp. It also destroys a derived
   result that option 2 would instead place, so it ranks last unless the node itself retired.

## The owner's ruling, 2026-11-01

The owner picked **option 2**: re-fold the unstamped nights, so the fold writes each era instead of
asserting one. `tools/trio-batch.mjs` is the only writer of a `.trio-stamp`, and
`tools/fold-generation.mjs --era` reads the tracked tree afterwards and names every night that
carries none.

### The mechanism reaches none of the 57 — measured 2026-11-01

A fold stamps a night it PLANS, and a night the fold refuses never reaches a stamp. So the 57 are
unstamped for the same reason a re-fold cannot cure them.

| population | nights | what a re-fold does |
|---|---|---|
| never planned by any recorded fold | 54 | the fold refuses the night, so no stamp follows |
| planned, two of the three legs landed | 3 | the tool's own census already reads `exports-missing` |

The tracked fold ledger `provenance/trio-fold.json` records 89 nights, and none of the 57 sits among
them. The rig's own nightly ledger records 122 nights over 19 folds, and 3 of the 57 sit among those
— 2026-08-04, 2026-08-29 and 2026-09-11. That run's verdict already states the outcome:

```
unstamped     : 3 exports-missing  (input-absent cannot be cured by re-folding)
```


A forced single-night probe says the same thing in the tool's own words. Night 2026-09-18 holds four
exports and raw input under the fold's source root, and a `--force --dry-run` over it reads
`⊘ 2026-09-18 — not a concurrent trio night (have: PPG+SpO2)`, then `trio nights: 0`. The ECG leg
never recorded, so no re-fold plans the night.

43 of the 57 hold a single OxyDex export over an O2Ring pair. `trio-batch.mjs` plans a night from
three concurrent sensors, so a single-node night was never a candidate.

Measured by `node tools/fold-generation.mjs --era --json` at `94350f05`, by both fold ledgers, and by
a forced dry run at `4338e00cb`.

### So the ruling needs the owner once more

Option 2 names the one tool that writes a stamp, and that tool cannot plan these nights. The ruling
therefore stands unexecuted, and options 1, 3 and 4 still hold the 57 between them. This brief keeps
the question open for that ranking.

### A measured era and an asserted era read differently

A stamp a fold writes names the code that folded the night, because that code just ran. Option 3
would instead name the commit that added the export, which nobody folded under. So a later reader
tells the two apart by the ledger: `provenance/trio-fold.json` records the fold that wrote each
stamp, and a back-stamp leaves no fold record at all.

### Why the nightly timer leaves the 57 alone

`tepna-trio-fold.timer` folds this rig's box nights with `--skip-existing`, so it passes over every
night that already holds exports. A re-fold of them needs `--force`, and the probe above shows what
`--force` buys.
### The census now names a reason, which is the half a tool CAN do

The count stood for three weeks with no per-night reason, and the reason is what ranks the four
options. `eraCensus` now reads the fold run ledger and gives every unstamped night one of two
reasons:

| reason | what a re-fold does | tracked count, 2026-11-01 |
|---|---|---|
| `folded-not-stamped` | a recorded fold planned the night, so a re-fold stamps it | 0 |
| `no-fold-record` | no recorded fold planned the night, so a re-fold has no night to plan | 57 |

∅ An absent or unreadable ledger gives every night `null` plus one named `foldLedger.reason`. "The
ledger does not say" and "the fold never planned it" are different facts, so the census never spells
the first as the second. The rig's own unpushed ledger names 3 of the 57, and the fold's census
already calls those three incurable, so the tracked split under-reports the curable column by at
most what a relay has yet to land.

This recovers no era. It names the nights whose era a later fold could still record, which the
ranking below needs.

### The consumer half of the stamp landed 2026-11-01

A published table now records which fold produced the nights it read. `tools/fold-generation.mjs`
exports `stampFields`, and `tools/tch-pooled-hat.mjs` prints the TABLE-PROVENANCE attributes for a
table cut from its own run. Over the 90-night corpus the printer reads
`foldGeneration=825bf5d03ceb`, because every night it read carries a fold stamp under one code
digest. A population without one gets the other attributes plus a counted reason, never the word
null in a stamp.

Two residue rows close here on a measurement, not on a fix. The census counts `PpgDexFinger` as a
node, so the nine three-node nights hold two trio exports beside the finger export.
`trio-batch.mjs` writes `.trio-stamp` only when a night carries three trio nodes, by design. So the
remedy those two rows name cannot fire on the nine.

## Acceptance

- [x] The owner picks 1, 2, 3 or 4, and the ruling lands in this brief. **Option 2, 2026-11-01.**
- [x] Option 2 or 3 names the stamp writer and the era gate. **`trio-batch.mjs` writes; `fold-generation.mjs --era` proves.**
- [x] A reader tells a measured era from an asserted one. **The fold ledger holds the difference.**
- [x] The census names a reason per unstamped night. **`eraCensus.unstampedByReason`, 2026-11-01.**
- [x] A measurement holds the nine unstamped trio-shaped nights against the stamp writer's own condition. **2026-11-01.**
- [ ] The owner ranks 1, 3 and 4 over the 57, now that option 2 reaches none of them.

## Why this is not a tool fix

The era of a night is a fact about a past run. No tool can recover a fact the run never wrote. So
the choice is between an honest absence, a re-run that creates the fact, an assertion that borrows it
from git, and a deletion. Only the owner ranks those four.
