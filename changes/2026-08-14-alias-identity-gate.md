---
bump: patch
type: added
brief: CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14-BRIEF.md
---

An `alias identity` group: a retired or duplicated NAME must resolve to the SAME function.

A back-compat alias has one job — keep an old caller working — and nothing checked that MotionDex's
still pointed anywhere. That is not hypothetical for this node: `MOTIONDSP` published the generator
only as `genSyntheticACC` while `window.MotionDex` published it as `genSynthetic`, and
`motiondex-app.js`'s `runDemo()` calls `MOTIONDSP.genSynthetic` — so the ▶ Demo button threw
"MOTIONDSP.genSynthetic is not a function" SINCE BIRTH (EXPORT-PATH-UNREACHABLE §8). The fix aliased
both spellings, and nothing pinned them, so the identical drift could recur silently.

⚠️ THE ONLY THING THAT CAUGHT IT LAST TIME WAS THE BROWSER LANE — the render-coverage export-bar leg,
which SKIPs headless. These are four cheap Node-lane assertions over the same invariant, so CI reds on
a dropped alias instead of a human noticing a dead button.

Pinned: `MOTIONDSP.genSynthetic ≡ genSyntheticACC` · `MotionDex.genSynthetic ≡ MOTIONDSP.genSyntheticACC`
(the cross-namespace pair that actually broke) · `MotionDex._build ≡ buildNodeExport` · and that the two
namespaces publish ONE `buildNodeExport`, not two.

VERIFIED BY APPLYING THE REGRESSION, not by watching it pass. Removing `genSynthetic: genSyntheticACC`
from the `MOTIONDSP` export reds the group with `got "@undef" · want "@fn#1"`; restoring it returns
5/5. A gate nobody has seen fail is not evidence.

⚠️ `T.eq` IS ONLY THE RIGHT COMPARATOR HERE SINCE #1234. Before it, functions serialised to `undefined`
and `T.eq(fnA, fnB)` passed for ANY two functions, including a lookalike wrapper. `dexSerializeForEq`
now tags each function with a WeakMap identity, which is also why the failure above is legible rather
than "got undefined · want undefined". If that regresses, this group goes hollow silently — the group
therefore opens by asserting that two DIFFERENT functions compare unequal, so a blind comparator reds
here first.

Found by sweeping the fleet for back-compat aliases after a parallel session flagged that
`markO2Sentinels`'s guard could not tell an intact alias from a deleted one. PpgDex's is already
asserted; MotionDex's four were not.

Tests only — no runtime code, no bundle moves, no fixture affected.
