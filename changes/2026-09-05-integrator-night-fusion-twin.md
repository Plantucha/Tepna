<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [Integrator]
brief: none
---
Nothing re-ran the Integrator's night-level fusion against committed bytes.

Every code-gated Integrator fixture pinned a SUB-fuser (TCH, apnea-null, respiration). The only
night-level fusions in the ledger are `historical: true` — byte-pinned snapshots of code that has
since evolved, which GATE B pins and `verify-fixtures` skips. So a change moving
`runFusion` → `buildFusionExport` reddened nothing, anywhere.

`tests/fusion-night-twins.js` adds three committed synthetic multi-node nights, minted through the
real modules by `tools/regen-integrator-goldens.mjs` (extended to a fourth fixture, not a fourth
tool), with an equivalence leg that rebuilds them in-lane and diffs against the committed export.
`inputHashes` is `{}`, so CI reproduces them with no corpus.

**Expressivity was measured before the fixture was committed, not assumed.** Planting
`runFusion`'s 120 s tolerance at 110 s reds the leg with
`nights.apneaNight.matchWindow.unionPrefilterSec: 110 != 120`. The first attempt at that measurement
was WRONG and worth recording: the export carries `generated` at TWO paths — top level and nested
under `schema` — so hashing without stripping both made every run differ, and "the plant moved the
bytes" was confounded by a timestamp. Both are stripped recursively by key name, and the byte LENGTHS
are identical across the plant, so a length check could not have caught it either.

**What these twins do NOT express, measured rather than claimed.** Of the export's 24 top-level keys,
19 are populated by the apnea nights and `hrvConsensus` by the HRV night; four —
`apneaTyping`, `hrvMotionGate`, `periodicBreathing`, `deviceScoredAHI` — remain empty in all three, so
a change confined to those still reds nothing. That bound is in the twin file's header rather than
left for a reader to discover.

`hrvNight` is deliberately the TCH inputs UNMERGED: composing them into the apnea night suppresses
`hrvConsensus` entirely (the two families anchor epochs differently), so merging would have silently
lost the surface. A gate leg pins that it stays populated.

Test and fixture only — no bundle rebuild; the new ledger record carries the existing
`manifestHash 153a0f018913` and `build:check` / `verify:manifest` are clean.
