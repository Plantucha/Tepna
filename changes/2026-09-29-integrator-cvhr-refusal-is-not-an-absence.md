---
bump: patch
type: fixed
brief: none
---

A refused finger-PPI CVHR leg now leaves the Integrator's bus **as a refusal, with its reason**, where
it used to leave exactly as an absent node.

`fuseCvhrCorroboration` returned bare `null` for two different situations — "no finger PpgDex this
night" and "a finger PpgDex that was present and could not compute an index" — and the export attaches
the block only when non-null. So a refusal vanished from the export exactly as an absence does, and no
consumer could tell them apart. §∅ one layer above #3220: the absence was already right, the **named
reason** was missing.

**Only the second case gains a shape.** The refusal carries `cvhrIndex: null` with PpgDex's own reason
(`beats 42 < 60`, `clock-seam`, `span 99 s < 120 s`, …), and it requires a reason to *be* one: a null
index with nothing beside it is indistinguishable from absence and is still treated as absence, so an
export predating #3220 does not become a refusal with an empty explanation. A night with **no** PpgDex
leg still returns null and still omits the key.

That keeps every fixture without a finger leg byte-identical, and the measurement says so:
`regen-integrator-goldens` reports **0 fixtures moved, content unchanged** on all three. The only
Integrator artifacts that move are the embedded code hashes.

**The suite's single pin becomes two properties**, because they are different claims: an absent node
still omits the key (unchanged), and a present refused one carries a null index with the reason (new).
Corroborators survive a refused reference **without a gap** — a gap computed against a missing reference
would be the fabrication the block exists to avoid — and `agree: null` says *not assessed* where `false`
would say *disagrees*.

The normalizer gains the second `_dig`: `summary.cvhrWaveReason` from `apnea.cvhrReason`, which PpgDex
has published since #3220. Without it the fusion cannot read what the node now says.

`manifestHash` `633847816985` → `2b106b29625a`; `computeHash` `48755214b98d` → `13087e639e72`. A DSP
change, so both move and re-verification is owed. `OverDex.html` and `resp-acc-analysis.html` also carry
`integrator-dsp.js` and were rebuilt with it.

**What is NOT fixed, and is recorded rather than implied:** the block is still rendered by nothing.
`grep -rn cvhrCorroboration` returns `integrator-dsp.js` and `tests/dex-tests.js` only. Building a
surface is a design decision — which card, where, what it says with no corroborator — and belongs to the
owner. Residue `2026-09-29-integrator-cvhr-corroboration-is-export-only-and-unrendered` carries both
halves and stays OPEN for that reason.
