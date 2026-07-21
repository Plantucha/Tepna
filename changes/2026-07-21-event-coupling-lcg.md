<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
Complete the §9.5 bootstrap-LCG fix — the last locus (DEEP-AUDIT-II #38). PR #319 replaced the overflowing `seed * 1103515245` (reached ~2.3e18 ≫ 2^53, rounding away the low bits `& 0x7fffffff` keeps) with `Math.imul` in all five `*-cross.js` `bootstrapDeltaCI` clones, but `event-coupling.js:447` was DEFERRED: its co-loaded `selfTest` builds demo streams FROM that LCG, so correcting the sequence tripped the brittle `excluded === 0` coverage assertion (an independent A-event now lands in the final 10 s window, whose [0,10 s] span overruns the recording end → one legitimate exclusion). Fixed the LCG (`Math.imul`) and HARDENED the assertion to be sequence-agnostic: `Aall` now draws within `[0, SPAN − window]` so every event's window fits in-span and the ONLY exclusion mechanism under test is coverage — `excluded === 0` holds by construction for any deterministic sequence (selfTest 35/0). The LCG lives entirely inside `selfTest`, so the production `coupling()` primitive is byte-identical — no export moved; only Integrator/OverDex (which inline event-coupling.js) re-bundled, the Integrator code-gated fixture `manifestHash` re-stamped + `verifiedUnder` re-verified against the corpus. §9.5's source-scan gate now PINS `event-coupling.js` too (added to `env.sources`; 13/13), so a future copy can't reintroduce the bare multiply.
