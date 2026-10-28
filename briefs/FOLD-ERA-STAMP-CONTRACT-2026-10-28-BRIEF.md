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
exports name no folding code. The nights carrying all three trio exports and the stamped nights have
an empty symmetric difference, so a three-leg reader cannot reach an era-less export. The seven
partial-leg readers can.

`#4057` delivered the reader half under §∅. Each of the seven now names the era of the nights it read,
and names every night that carries none. The number stands; the line states what is unrecorded.

## The question for the owner

A stamp records the code that folded a night. Nobody folded 57 of these nights under the stamp
contract, so no stamp exists to read. Three answers are open.

1. **Leave them era-less.** The readers annotate. Nothing re-folds. This is today's state.
2. **Re-fold the 57 nights.** `trio-batch.mjs` writes a stamp per night, so a re-fold grants every
   night an era. This rewrites 80 tracked exports. §∅ holds that captured bytes are immutable, and
   a fold derives an export rather than capturing it, so the rule does not bind. The diff is large.
3. **Back-stamp from git.** The commit that added each export names a code state. A stamp written
   from that commit asserts an era nobody measured, which §🧾 reads as `UNKNOWN`.

## Acceptance

- [ ] The owner picks 1, 2 or 3, and the ruling lands in this brief.
- [ ] Option 2 or 3 names the tool that writes the stamps and the gate that proves the era.
- [ ] A later reader of this brief can tell a measured era from an asserted one.

## Why this is not a tool fix

The era of a night is a fact about a past run. No tool can recover a fact the run never wrote. So
the choice is between an honest absence, a re-run that creates the fact, and an assertion that
borrows it from git. Only the owner ranks those three.
