<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [OxyDex, Integrator]
brief: TOOL-INVOCABILITY-SWEEP-2026-08-02-BRIEF.md
---
Two gate holes found by `tools/mutate.mjs` on its first real sweep, now closed — and one triaged as not actionable.

**`oxydex-dsp.js:624` — the physiological sanity filter was untested.**
```js
if (spo2 < 50 || spo2 > 100 || hr < 20 || hr > 250) continue;   // sanity check
```
The first `||` could be rewritten to `&&` with the whole suite green. That line stands between a garbage CSV row and every downstream statistic, and it is exactly the kind that looks self-evidently correct and is therefore never asserted. Gated with one out-of-range row per axis — each tripping exactly one disjunct, which is what kills the `&&` mutant — plus the four **boundary** values (50 / 100 / 20 / 250) which must be KEPT, killing the `<`→`<=` mutants, plus an in-range control so a green result cannot mean "the parser returned nothing".

**`integrator-tch.js` — the `need three series` guards** in `threeCorneredHat` and `allanTriplet`. Every existing test passed all three corners, so the precondition was only ever exercised in its satisfied state; nothing had ever called it with exactly **one** corner missing — the case that actually occurs when a device does not record. Now gated with each corner omitted in turn. The mutant's failure mode is the useful part: without the guard the code **throws** in `pairDiffVar`, so it prevents a crash rather than tidying a return value.

Both verified by re-applying the exact reported mutants and watching the new tests red: the harness found the hole, the test closes it, the harness confirms the close.

**Triaged as NOT actionable, recorded so it is not re-derived:** `integrator-tch.js:279`'s `sol.c >= -1e-6` → `>` survivor. Killing it needs a solution landing exactly on `-1e-6`, which is not constructible from a `Vab/Vac/Vbc` triple — the "legitimately untestable float boundary" the tool's header warns about. Tempting because that same boundary decides the degenerate-night verdict for 8 of 39 corpus nights, but the untested case cannot occur.

**Not triaged, and said so:** loop-bound survivors (`i < N` → `i <= N`) dominate the remainder and have not been examined; and some survivors mean *no test reaches this function at all* rather than *the assertion is weak* — `pulsedex-dsp.js:208`'s `acc / 1000` → `acc / 0` survives, making timestamps `Infinity`. The tool cannot distinguish those two.

Tests + brief only — no shipped source, no `manifestHash` movement, no fixture re-recorded.
