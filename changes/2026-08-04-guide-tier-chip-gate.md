---
bump: patch
type: fixed
nodes: []
brief: REFERENCE-GUIDE-AUDIT-BRIEF.md
---

Gates the reference guides' tier chip against their `data-tier` attribute, the one part of the audit's
badge item that was covered nowhere: the attribute occurred 336 times across the guides and zero times in
the test suite, while cohesion-badges covers only the evidence grade, the disc CSS and the retired
vocabulary.

Across the seven authored guides the mapping was already perfect, 397 of 397, so for them this is a
ratchet rather than a fix. The generated EEGDex guide was not, and an ad-hoc sweep could not have seen
it: it lives under codegen/generated/, so a glob of `*Reference.html` at the repo root misses it.
`codegen/dex-gen.js` emitted the card div with no `data-tier` at all while rendering the chip from the
same tier value it declined to project, so every generated card read as Core to anything consuming the
attribute while displaying Advanced or Research. Fixed at the generator, mirroring the authored
convention of emitting for secondary and research and omitting for core, and regenerated.

Note that `data-tier` is inert: no JS reads it and no CSS selects on it in any guide, and the guides are
self-contained. It is metadata rather than behaviour, which is precisely why a drift would go unnoticed.
If the two ever disagree, trust the chip, since that is what the reader sees.

Six assertions in both lanes over 407 cards in 8 guides, anti-vacuity first. Two mutants confirm failure
by value, and the gate's RED was demonstrated on the real generated-guide defect before the fix rather
than only on a planted one.
