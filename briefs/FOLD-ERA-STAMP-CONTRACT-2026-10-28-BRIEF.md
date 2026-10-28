<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-10-28

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

## Acceptance

- [ ] The owner picks 1, 2, 3 or 4, and the ruling lands in this brief.
- [ ] Option 2 or 3 names the tool that writes the stamps and the gate that proves the era.
- [ ] A later reader of this brief can tell a measured era from an asserted one.

## Why this is not a tool fix

The era of a night is a fact about a past run. No tool can recover a fact the run never wrote. So
the choice is between an honest absence, a re-run that creates the fact, an assertion that borrows it
from git, and a deletion. Only the owner ranks those four.
