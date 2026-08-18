---
bump: patch
type: added
brief: PAT-RELATIVE-REFRAME-2026-08-17-BRIEF.md
---

**`oxyBuildNightElement` — the single source of the per-night export shape — was entirely unasserted.**

14 killable mutants of 14 survivors, the fleet's best conversion rate on the mutation board. Handed
over by the mutation lane, which deliberately left it because OxyDex is this lane's.

16 assertions in a new `oxydex · export-shape` group, test-only — **no source change, so no re-bundle
and no fixture movement.** The builder is ~90 lines of field projection, so pinning all of it would be
a change-detector that fails on honest refactors and catches nothing. What is pinned is the four things
a projection can get wrong:

1. **Absence is declared, not fabricated** — `t0Ms`/`contentId` export explicit `null`, and are keys
   rather than `undefined` (an undefined key is dropped by `JSON.stringify` and vanishes silently).
2. **A measured zero is kept as zero** — `hr_spikes.count: 0` with `events: []`. Pinned beside (1)
   deliberately: a sweep that turned every `0` into `null` would be the mirror-image error.
3. **`columnStuck` exists only on a faulted night** — a *key-presence* assertion in both directions.
   That distinction is what lets a consumer tell "no motion column" from "column stuck", which a null
   `motionPct` cannot. A value check reads `undefined` either way and would miss it.
4. **Projection, not pass-through** — `odi4`, `sleepStability` and `flags` copy named members, so an
   upstream field cannot leak into the export. Only an assertion that an EXTRA field is *absent* sees
   the mutant.
5. **`opts` distinguishes `undefined` from falsy** — an explicit `false` survives; an absent key becomes
   `null`. The `||` mutant collapses both.

**Mutation-verified, and one mutant did the real work.** Unconditional-`columnStuck`, `odi4`
pass-through, and `opts ||` each fail their assertion. The fourth — `t0Ms` guard → `isFinite(...)` —
**SURVIVED the first version**, because the test used a night where `t0Ms` was *absent* and
`isFinite(undefined)` is `false`. The fabrication needs an **explicit null**: `isFinite(null)` is
`true` and `Number(null)` is `0`, so a clockless night would export `t0Ms: 0` — the epoch, as a real
instant. An explicit-null case was added and now kills it (`got 0 · want null`).

That distinction — an absent field and an explicitly-null one are different inputs, and only the second
reaches the fabrication — is the same shape as the `classifyRecording` `hour: 0` case found in the
mutation lane the same day, and PpgDex's `cvhrIndex: 0`. Clock Contract §2.6 says a parser that fails
to find a clock emits an explicit null, so it is the realistic input, not the exotic one.

typecheck 0 · lint 0 · shard-union sound · group 16/16.
