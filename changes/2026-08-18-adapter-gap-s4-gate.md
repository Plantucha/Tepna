<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [Integrator]
brief: INTEGRATOR-OXYDEX-ADAPTER-GAP-FOLLOWUPS-2026-07-22-BRIEF.md
---
§4 closed by option (a): the unreachable-by-construction OxyDex fallback in `adaptEnvelopeNode`
stays, and is now GATED against the live `adaptOxyDex` path — 8 assertions driving both routes
through the public `normalizeFile` with identical values, pinning `pulseHr1Hz`/`rmssd1Hz`/
`hrVarSd1Hz` equal and null-on-absent (§2.6) on both.

**The route-proof rides the one measured divergence.** adaptOxyDex `isFinite`-guards `stats.meanHr`;
the fallback `_dig`s it raw. A `meanHr: Infinity` payload surfaces Infinity only through the
fallback, so that assertion proves the bare payload actually took the fallback route — without it,
a future widening of the intercept predicate would silently turn the reconcile into
adaptOxyDex-vs-itself and it would pass vacuously. If the predicate moves, the gate reds and §4's
decision gets re-made deliberately.

The divergence itself is deliberately NOT fixed: that edit lives in `integrator-dsp.js`, which moves
5 manifestHashes + `computeHash` + a corpus re-verification — not a price a dead branch's cosmetics
justifies. The gate makes the asymmetry visible instead of latent.

Mutation-verified: fallback reading `hrv.sdnn` for rmssd → 7 assertions red; fabricating `|| 0` on
absent stats → 3 red. No production code changed.
