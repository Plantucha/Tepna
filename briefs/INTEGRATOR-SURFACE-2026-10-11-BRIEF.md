<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-10-11 (the contract is declared for every key the fusion emits and gate-backed;
⚠️ §4 states what the gate CANNOT see, because the seed was derived) · **Created:** 2026-10-11 ·
**Closes:** residue `2026-09-29-integrator-cvhr-corroboration-is-export-only-and-unrendered`

# Every Integrator key declares its surface

## 1 · The defect this closes

`cvhrCorroboration` was computed, attached to the node-export, asserted by the suite — and rendered by
nothing. That is not necessarily wrong; what was wrong is that **nobody had said so**, so an
unrendered key and a forgotten key looked identical.

## 2 · The contract

Every key the Integrator's fusion emits declares one of exactly two surfaces in
`tools/integrator-surface.json`:

| surface | meaning | gate |
|---|---|---|
| `card` | rendered for a reader | `integrator-render.js` **must** mention it |
| `export-only` | carried on the node-export, deliberately not rendered | never red — a stated choice |

Measured 2026-10-11: **25 keys — 14 `card`, 11 `export-only`, 0 undeclared.** The eleven
`export-only` keys are `apneaTyping`, `clockSkew`, `cvhrCorroboration`, `generated`, `hrSource`,
`hrvMotionGate`, `hrvResource`, `kernelAudit`, `kind`, `pulseCrossCheck`, `respiration`.

`tools/integrator-surface-gate.mjs` reds on exactly three conditions: a key with no declaration, a
`card` key that `integrator-render.js` does not READ, and an `export-only` key that it does read. It
emits one `tepna.verdict/1`, gate `integrator-surface`.

⚠️ **The 2026-10-11 counts above are superseded by §6.** Two of the fourteen `card` keys were seeded
on prose, so the standing counts are **12 `card` · 13 `export-only`**.

## 3 · The population, and why it is 25 and not 108

The unit was briefed as 108 keys with 55 unrendered. That count is reproducible — **110 keys, 49
unrendered** — from the keys at depth ≤ 2 of the fusion object, unioned over
`uploads/integrator_fusion_*.json`. It is not usable as a gate:

- **`uploads/` is absent in a worktree and in CI.** Run there, the same scan finds **one** fixture and
  reports a clean pass over 30 keys — success about something never examined.
- Depth ≤ 2 mixes surfaces with fields. `alpha`, `AB`, `agreed` are *fields of* a block; the thing a
  card shows or an export carries is the block.

So the gate enumerates from **source** — the fusion return object's own properties plus every
`_exp.<key>` assignment — which is available everywhere and is what the code *can* emit rather than
what one night happened to produce. The enumerator **refuses** if the fusion's shape moves rather than
returning a short list; that refusal is planted in the selftest.

## 4 · ⚠️ What this gate cannot see, stated

**The declarations were seeded by scanning render for each key on 2026-10-11, so today's PASS is true
by construction.** It is the shape residue
`2026-09-28-generator-compared-to-itself-examines-no-artifact` names: a generator compared against
itself establishes only that it is a function.

What the gate *can* see is **drift from that seed**, and that is what it is for:

1. a new fusion key nobody declared;
2. a `card` key whose render READ is deleted;
3. an `export-only` key that render starts to read (added 2026-11-11 — §6).

All three are planted in `--selftest` and asserted red. None is a claim about today.

## 5 · Done-when

- [x] Every key the fusion emits carries a surface; 0 undeclared.
- [x] A gate reds an undeclared key and a `card` key with no render mention.
- [x] The two drift states are planted, not assumed.
- [x] §4 states the seed's circularity rather than leaving the first PASS to be read as evidence.
- [x] The CVHR residue row closes on declaration (`export-only`).
- [x] 2026-11-12: the gate enumerates both export routes, so the slim-export literal's keys declare
      a surface too (§7).
- [x] A control plants the old enumerator's blindness, and §7 does not assert it.
- [x] 2026-11-12: the first nested subtree (`fusion.apnea`) declares a surface per key, through an
      ANCHORED read, and the verdict names the subtrees it judged at depth 2 (§8).

## 6 · 2026-11-11 — the seed counted prose, and two declarations were wrong

🔴 **A MENTION IS NOT A READ.** The 2026-10-11 seed scan, and the gate's own `mentions()`, tested a
word boundary over the whole of `integrator-render.js`. That test cannot tell a property access from
a tooltip, so two keys declared `card` — "rendered for a reader" — satisfied the gate on English:

| key | its only appearance in `integrator-render.js` | reads `fusion.<key>` |
|---|---|---|
| `bus` | one sentence inside the device-AHI card: "the strongest single apnea truth on the bus" | nowhere |
| `staging` | a block comment about `staging_disagreement`, and a `cite:` string | nowhere |

Measured 2026-11-11 over all 25 keys, against `b9d2f40b0`: 14 declared `card`, **2 of them read by
nothing**, 0 of the 11 `export-only` keys read at all. `grep` over `integrator-dsp.js`,
`integrator-render.js`, `integrator-longitudinal.js` and `Integrator.src.html` finds no `.bus`,
`['bus']`, `.staging` or `['staging']` on any Integrator surface. `staging` reaches a reader only
through the `staging_disagreement` finding type, which arrives on the `findings` key, and `findings`
declares `card` on a read of its own.

**The repair, in three parts.**

1. `reads()` asks the question on code with comments, strings, templates and regex literals
   **blanked** — `find-unwired-js.mjs prepare`, which parses with acorn where one resolves and falls
   back to its hand tokenizer where none does. The run records which route it took
   (`result.blankedBy`). A bracket access quotes its own key, so the gate asks the raw text for that one route.
2. `bus` and `staging` now declare `export-only`, which is what they are. The alternative — render
   them — is a question about what a reader should see, so it is the owner's and not a session's.
3. The reverse direction is now red as well: an `export-only` key that render reads is a declaration
   that states the opposite of the code. 0 of 13 today, and planted in `--selftest`.

**What this still cannot see.** The read test proves a key appears in code, never that it
reaches a surface a reader opens. A `card` key read into a variable that nothing draws
passes. That is a narrower blindness than prose, and it is the next one.

## 7 · 2026-11-12 — the gate reported PASS over 26 of its 36 keys

🔴 **AN ENUMERATOR READ ONE OF THE TWO EXPORT ROUTES.** `fusionKeys()` took the fusion return
object, and every `_exp.<key>` assignment. The Integrator builds most of its slim export as one
object literal (`var _exp = {` in `integrator-dsp.js`). A key inside that literal is never written
as an assignment. Ten keys therefore reached the node-export with no declaration, and the gate
printed a green line over 26 keys, where its contract names 36. The green line did not name its
population, and that omission hid the gap for a month.

| key | the fusion-side name it forwards | does a reader meet the value |
|---|---|---|
| `confirmedApneaIndex` | `fusion.apnea.confirmedAHI` | yes — `a.confirmedAHI`, three sites |
| `confirmedApneaIndexReportable` | `fusion.apnea.confirmedAHIReportable` | yes — it gates the index |
| `confirmedApneaIndexContributions` | `fusion.apnea.contributions` | no |
| `apneaNullModel` | `fusion.apnea.nullModel` | yes — the below-chance subtitle |
| `apneaCoupling` | `fusion.apnea.coupling` | no |
| `hrvConsensus` | `fusion.hrv` | yes — under the `hrv` key, which declares `card` |
| `deviceScoredAHI` | `fusion.apnea.apneaAuthority` | yes — four sites |
| `kernel` | the kernel version and hash | no — render reads `r.kernelHash` per node |
| `schema` | the method-description block | no |
| `handshakes` | the reserved-handshake block | no |

Each of the ten declares `export-only`, because the gate's own `reads()` finds none of them in
blanked code. Seven of the ten forward a value the reader does meet under its fusion-side name, so
`tools/integrator-surface.json` carries a `notes` field that records where. The notes are a
hand-check, and no gate judges them.

**The control, measured 2026-11-12.** A planted key sits inside the literal, in an otherwise
unchanged `integrator-dsp.js`. The widened gate exits 1 and names `plantedDriftKey`. The same source,
read by the same gate with its five literal-reader lines removed, exits 0 and reports `PASS` over
`population.checked: 26`. One source, two enumerators, opposite verdicts: the blindness is a
measurement here and not a claim.

`--selftest` grew from 23 legs to 29. The six new legs plant the literal route, the depth boundary,
an undeclared literal key, and two shapes that fail closed.

**What this still cannot see: depth.** This brief counts 108 keys at depth ≤ 2. The gate judges 36 at
depth 1. A nested property declares no surface, and `result.depth` now prints the number so the
verdict states its own scope.

Two enumerations disagree about the rest, and they miss opposite things. A fixture-derived walk
misses code the fixtures predate. A source-derived walk misses an object a second function builds. A
declaration per nested path also needs an anchor per path, because a key such as `fusion.apnea`
carries no literal at the fusion site at all. That is the next one, and it is a unit of its own.

## 8 · 2026-11-12 — depth 2 arrives one subtree at a time, and a nested read needs an anchor

🔴 **THE FIRST NESTED SUBTREE IS `fusion.apnea`, AND THE GATE NAMES THE SET IT JUDGED.** §7 left the
nested half as a unit of its own, with a reason: a scratch resolver reached 183 paths and left 16
unresolved, and each path then needs a hand-checked surface. Board 5905 holds that reason. So the
nested half lands per subtree, and `result.nestedSubtrees` lists the subtrees judged one level
deeper. A subtree absent from that list is not examined, which the verdict now states instead of
implying.

**The population.** `fuseApneaEvents()` returns from two places. The no-overlap guard carries 13
keys and the fused path 14, so the union is **14 keys — 10 `card` · 4 `export-only`**. The gate's
`population.checked` moves from 36 to 50.

🔴 **A BARE TOKEN IS NOT A NESTED READ.** At depth 1 a bare token in blanked code is good evidence,
because the token IS the fusion's own property name. At depth 2 it is not. `findings`, `matched`,
`total` and `unmatched` are also top-level fusion keys, so a bare token cannot tell `fusion.findings`
from `a.findings`. The nested test resolves the alias, scopes the search to the enclosing function,
and asks for `<alias>.<key>` or `<alias>['<key>']` in that scope.

**Measured 2026-11-12 over this subtree: the anchored test and the bare one AGREE on all 14 keys.**
So the anchoring repairs no live miss here. It is a tightening against the next edit, and §6's
`bus`/`staging` finding is what says that distinction is worth paying for. A planted control carries
the difference instead: a key that appears as a bare token, and that no anchored read reaches, reds.

🔴 **PRESENCE IS PART OF THE SURFACE.** `consequence` exists on the fused return shape alone. The
guard's own comment states that a reader never branches on a key's presence, which holds for
`contributions` and `overlapCoverage` and fails for this one. Nothing reads `consequence`, so the
branch is latent. A key that only some return shapes carry must now declare that in `partialShape`,
or the gate reds; a `partialShape` entry for a key every shape carries is stale, and reds too.
`fusion.apnea` is itself `null` when no overlap exists, and `nullWhen` records that the whole subtree
is conditional.

🔴 **A SHADOWED ALIAS CREDITS THE WRONG OBJECT, SO A REBOUND SCOPE CREDITS NOTHING.** `a` is a common
identifier in a render file: a comparator parameter would make `a.total` a read of something else.
The gate refuses a scope that rebinds its alias, rather than read it, so it fails closed. The first
form of that test could not tell `if (a) {` from a parameter list, so it reported both real alias
sites shadowed and credited nothing — the gate reded on 10 keys it should pass. A selftest leg plants
each of those two states.

`--selftest` grew from 29 legs to 51.

**What this still cannot see.** Thirteen other subtrees carry nested paths, and no declaration
covers one of them, so depth 2 reaches one subtree. The anchored test also credits a read into a variable that
nothing draws, which is §6's standing blindness one level down.
