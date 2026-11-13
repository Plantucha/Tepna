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
- [x] 2026-11-13: an object literal one level inside a declared subtree declares a surface per key,
      and a `card` label there reds, because the gate credits no reader at that depth (§17).
- [x] 2026-11-13: a subtree may declare a LIST of export routes, each naming one source form, so a
      subtree whose two routes differ in form declares a surface per key over their union (§18).
- [x] 2026-11-13: a subtree whose own keys are ARRAYS declares an element shape per pool, read off
      the export literal by name, and the two pools never share one union (§19).
- [x] 2026-11-13: a one-line object literal declares a surface per key, so the gate judges a subtree
      of such literals at both layers (§20).

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

## 9 · 2026-11-12 — the second subtree is inline, read from the app, and bound behind a guard

`fusion.clockSkew` is the second nested subtree this gate judges. It needed three mechanisms the
first subtree did not, and it found one defect inside the first subtree's own reader.

| population | before | after |
|---|---|---|
| top-level keys judged | 36 | 36 |
| nested subtrees judged | 1 (`fusion.apnea`) | 2 (`fusion.apnea`, `fusion.clockSkew`) |
| nested keys judged | 14 | 21 |
| nested `card` keys | 10 | 14 |
| `population.checked` in the verdict | 50 | 57 |
| `--selftest` legs | 51 | 74 |

The seven keys are `findings`, `applied`, `pairs`, `fits`, `beatCheck`, `seamCensus` and `vetoes`.
Four of them are `card` and three are `export-only`. I hand-checked each one against
`integrator-app.js` and `integrator-render.js` on 2026-11-12.

🔴 **A SUBTREE NEED NOT HAVE A BUILDER.** `fuseApneaEvents` returns the first subtree, so
`nestedShapes` could read its return shapes. `clockSkew` is an inline object literal AT the fusion
publish site, so there is no function to read. `inlineShape` reads the literal itself, in blanked
code, and refuses on three states instead of guessing: no anchor line, more than one anchor, or a
literal that does not close. Each refusal is a selftest leg.

🔴 **A KEY WHOSE VALUE CAN BE `undefined` IS CONDITIONAL TOO.** One literal carries one key list, so
the first subtree's test — a key missing from some return shape — can never fire here. The same
defect wears different clothes: `vetoes: skew.vetoes && skew.vetoes.length ? skew.vetoes :
undefined` leaves the export entirely when the pass refused nothing, while `seamCensus:
skew.seamCensus || []` ships even empty. So `partial` means "can evaluate to `undefined`" for an
inline subtree, `partialKind` names which mechanism produced it, and the refusal quotes the right
one. A `|| null` key is NOT in that set, because a null is a value a consumer reads (§∅).

🔴 **THIS SUBTREE'S READER SURFACE IS NOT IN THE RENDER FILE.** `integrator-render.js` mentions
`clockSkew` zero times over the whole file. `integrator-app.js` draws four of its keys into the
permanent skew banner and the D17 silence lines. So a nested declaration names its own
`readerFile`, and a subtree whose every key is `export-only` no longer owes a binding at all —
demanding one there would red correct code for carrying no reader surface. Control: swapping
`readerFile` back to `integrator-render.js` reds on all four `card` keys.

🔴 **A SUBTREE HANDED TO A HELPER IS STILL A READ OF IT.** The app binds `var cs = FUSION &&
FUSION.clockSkew` and calls `skewSilenceLines(cs)`, which reads `vetoes` and `seamCensus` one scope
away. Without that hop those two keys read as unrendered and the gate would convict correct code.
The gate follows ONE hop and refuses the rest: a helper name that resolves to no declaration or to
more than one, a parameter list that is not exactly one plain identifier, and a hop out of a hop.
An unbounded credit is no credit. Three planted refusals cover those states.

🔴 **THE NEAREST FUNCTION HEADER IS NOT THE ENCLOSING ONE, AND THE FIRST SUBTREE HID IT.** The
binding at `integrator-app.js:88` sits nine lines under a `forEach(function (m) {` callback that
closed at `:82`. `enclosingFn` stopped at that first header above, found it did not contain the
line, and reported the site UNSCOPED — so the gate credited nothing and reded all four `card` keys
with a reason about a shadowed binding. `fusion.apnea` never exposed it, because both of its
bindings sit directly inside their own function. The scan now walks every header upward and takes
the first whose brace span contains the line, which is the tightest real scope. A selftest leg
plants the callback.

**What this still cannot see.** Twelve other subtrees carry nested paths and no declaration covers
one of them, so depth 2 now reaches two subtrees out of fourteen. The depth-1 declaration for
`clockSkew` reads `export-only`, which is true of `integrator-render.js` and false of
`integrator-app.js`: depth 1 judges ONE realm, and widening it re-judges all 36 top-level keys
against a second file, which is its own unit and not this one. The anchored test also credits a
read into a variable that nothing draws, which is §6's standing blindness one level down.

## 10 · 2026-11-12 — depth 1 judged ONE realm, and two cells were wrong about rendering

§9 left the question this section answers. The depth-1 contract read `export-only` as "carried on
the node-export and deliberately not rendered", and the gate asked that question of
`integrator-render.js` alone. The Integrator has a second reader file, so the claim was never
tested where it fails.

| population | before | after |
|---|---|---|
| top-level keys judged | 36 | 36 |
| declared reader realms | 1 | **2** |
| `card` | 12 | **14** |
| `export-only` | 24 | **22** |
| selftest legs | 74 | **97** |

🔴 **TWO OF THE 36 CELLS SAID "DELIBERATELY NOT RENDERED" ABOUT A VISIBLE BANNER.**
`integrator-render.js` names `clockSkew` and `kernelAudit` zero times. `integrator-app.js` binds
both — `var ka = FUSION && FUSION.kernelAudit` at :77 and `var cs = FUSION && FUSION.clockSkew` at
:88 — and pushes a reader-facing line from each into `warnAll`. A reader meets both on every
fusion. Both cells now read `card` against the app realm. The gate reported the pair before the
repair: `2 key(s) declare 'export-only' and a SECOND declared realm reads them through its holder:
clockSkew, kernelAudit`.

🔴 **A BARE TOKEN IS EVIDENCE ONLY INSIDE THE FILE WHOSE JOB IS THE FUSION.** §8 found this one
level down, where the namespace collides with itself. It holds one level UP as well, across files.
Measured over all 36 keys in `integrator-app.js`: five match a bare token, and only two of the five
read the fusion. `generated` and `schema` belong to a synthetic crossnight envelope the app BUILDS
(`:592`), and `kind` names a file type and a download (`:177`, `:367`). So a non-default realm
declares the HOLDER its reads must anchor on, and the three false convictions never happen.

🔴 **MENTIONED-BUT-NOT-ANCHORED IS A THIRD STATE, AND CALLING IT PROSE MISDIRECTS THE REPAIR.** In
the render realm an unread mention is a comment or a string, and `cardProseOnly` says so. In a
second realm the same mention can be live code reading a different object, which is what
`generated` and `schema` are. The gate reports `cardUnanchored` there and names the holder as the
repair.

🔴 **A REALM IS DECLARED, NEVER DISCOVERED.** `readerRealms` lists the files and each non-default
holder, `readerFiles` names each card key's own realm, and the verdict prints `readerRealms` and
`cardByRealm` so a run states the realms it judged. A realm set that drops the render file refuses
rather than reds, which is the same fail-closed rule the slim-export literal and the nested shapes
already carry. A key naming a file outside the set is a reported finding, because the gate can say
exactly what is wrong.

**Live controls, run against the real declaration, each restored afterwards.**

| mutation | result |
|---|---|
| `clockSkew`'s card realm swapped back to render | `✗ 1 key(s) declare 'card' and their own declared reader does not read them: integrator-render.js → clockSkew` |
| the realms removed and both cells back to `export-only` | **PASS** — the old blindness, reproduced |
| the app realm's holder renamed | `✗ 2 key(s) …: integrator-app.js → clockSkew, kernelAudit` + both reported unanchored |
| `kernelAudit` names an undeclared realm | `✗ 1 key(s) name a reader file that is not a declared realm: kernelAudit` |
| the render realm dropped from the set | refuses: `readerRealms omits integrator-render.js` |

**What this still cannot see.** The realm set is two files, and a third reader would need a row of
its own. The anchored test credits a read into a variable that nothing draws, which is §6's
standing blindness in both realms now. Twelve nested subtrees still carry no declaration, so depth
2 reaches two of fourteen. A key read in BOTH realms declares one of them, and the gate does not
ask whether the other one should also draw it.

## 11 · 2026-11-12 — the third realm was real, and the enumerator could not see a one-line return

The depth-1 unit named a third reader realm as unexamined. The third nested subtree found it, live,
with a reader-facing banner on it.

| population | before | after |
|---|---|---|
| declared reader realms | 2 | 3 |
| nested subtrees judged | 2 | 3 |
| nested keys judged | 21 | 26 |
| nested card keys | 14 | 17 |
| nested keys on some shapes only | 2 | 2 |
| gate selftests | 97 | 119 |

🔴 **OVERDEX IS A READER REALM, AND ONE KEY IS CREDITED THERE AND NOWHERE ELSE.**
`overdex-app.js:862` reads `fusion.kernelAudit.ok` and draws a "Kernel drift" warn box from it;
`:866` maps `.mismatches` into the same box. The Integrator app reads `ka.mismatches` at `:78` and
`:79` and `ka.expected` at `:80`, and it branches on `ka.mismatches.length` rather than on `ok`. So a
two-realm declaration would have called `ok` export-only, and `ok` gates a banner.
`result.nestedCardByReader` now reads `{ integrator-render.js: 10, integrator-app.js: 6,
overdex-app.js: 1 }`, and that lone 1 is this key.

🔴 **DECLARING THE THIRD REALM AT DEPTH 1 MOVES NOTHING, AND THAT IS A MEASUREMENT, NOT AN
ASSUMPTION.** `overdex-app.js` reads 6 of the 36 top-level keys anchored on `fusion` — apnea,
findings, hrv, kernelAudit, nodes, window — and every one of them is already declared `card`. So
`exportOnlyReadElsewhere` stays 0 and no depth-1 cell moves. The holder differs from the app's:
OverDex receives the fusion as a parameter, so its holder is lower-case `fusion`.

🔴 **A READER NEED NOT BIND AN ALIAS.** OverDex reads through the whole path, so `aliasSites` finds
nothing to credit and an alias-only test calls that key unread. `readsDirectPath` credits
`<path>.<key>` and the bracket form, and `noAlias` no longer reds a realm whose reads all go through
the path.

🔴 **THE ENUMERATOR SKIPPED EVERY ONE-LINE RETURN, SILENTLY.** `nestedShapes` anchored `return {` to
the END of a line, and `auditNodeKernels` returns all five of its keys on one line. The subtree's
source sat there to read and the gate refused it with "its shape changed". A one-line literal now
reads when its braces balance on that line and it carries no quote; a quote, a spread or an
unbalanced line still refuses.

🔴 **AND READING THEM EXPOSED A LATENT MISS: A NESTED CALLBACK'S RETURN IS NOT THE BUILDER'S
SHAPE.** With one-line returns read, `fuseApneaEvents:2268` —
`.map(function (k) { return { node: k, surges: hrByNode[k] }; })` — entered the `apnea` union: two
keys no fusion carries, and 15 real keys reading as conditional. The return must now sit in the
builder's own scope, and the text in front of a return skips a wholly-inline callback.
This was latent on main, not live: the end-of-line anchor had hidden the same callback.

### The five live controls

Each edits the real declaration, runs the gate, and restores the file. Every restore is
byte-identical.

| control | edit | the gate says |
|---|---|---|
| F | drop `overdex-app.js` from the subtree | `✗ 1 nested key(s) declare 'card' and no anchored read reaches them in integrator-app.js: ok` |
| G | `ok` declared `export-only` | `✗ 1 nested key(s) declare 'export-only' and an anchored read reaches them: ok` |
| H | a reader entry with no `file` | throws `nested subtree `kernelAudit` declares a reader with no file` |
| I | `nodes` declared `card` | `✗ … no anchored read reaches them in integrator-app.js + overdex-app.js: nodes` |
| J | drop `integrator-app.js`, keep OverDex | `✗ … no anchored read reaches them in overdex-app.js: expected` |

### What this still cannot see

Depth 3. `mismatches[]` and `nodes[]` entries carry `{ node, hash, version, status }`, and
`integrator-app.js:80` reads `m.node` and `m.hash` while `overdex-app.js:865` reads `m.status`. Those
three keys are read by a reader and no cell declares them. Eleven nested subtrees still carry no
declaration, so depth 2 reaches three of fourteen. A fourth realm may exist: this unit asked only
the files that name `kernelAudit`, which are the two above plus `integrator-dsp.js` itself.

## 12 · 2026-11-12 — depth 3 judges what a reader takes out of an array element

Depth 2 declared `kernelAudit.nodes` and `kernelAudit.mismatches` as `card`. Neither cell said
anything about the objects INSIDE those arrays. Three element keys reached a reader and no cell
declared them. This unit adds depth 3. The gate declares the element literal, judges each of its
keys against the real reads, and counts every element read it cannot judge.

| population | before | after |
|---|---|---|
| subtrees judged at depth 3 | 0 | 1 |
| element keys judged | 0 | 4 |
| element keys declared `card` | 0 | 3 |
| element read sites judged | 0 | 2 |
| element read sites counted and left unjudged | — | 1 |
| selftest legs | 119 | 164 |

The live gate PASSes at `checked: 62` with `reason: null`. The verdict carries the new population:
`elementShapes: 1`, `elementKeys: 4`, `elementCard: 3`, `elementSites: 2`, `elementCardUnread: 0`,
`elementExportOnlyRead: 0` and `elementReadsUnjudged: 1`.

🔴 **AN ELEMENT SHAPE BELONGS TO THE BUILDER'S LITERAL, NOT TO THE ARRAY KEY.** `auditNodeKernels`
builds one `entry` object at `integrator-dsp.js:7479`. It pushes that object into `nodes`, and it
pushes the same object into `mismatches` behind a guard. One literal serves two array keys. So the
declaration names a `servesKeys` list, and the gate reads the shape from the builder.

🔴 **A MEMBER CHAIN SPLITS ACROSS LINES AND DEFEATS A PER-LINE REGEX.** My first census found two
of the three sites. OverDex breaks `fusion.kernelAudit.mismatches` from its `.map(` at
`overdex-app.js:865`. The site finder now runs one regex over the whole blanked text, where `\s`
spans a newline. `EOVER` holds that split chain as a selftest fixture.

🔴 **THE BRACKET FORM MUST BE READ ON RAW TEXT.** `prepare()` blanks every string literal, so
`m['status']` loses its key name in blanked code. Six of 156 selftests failed on that one root. The
dot form now reads the blanked slice and the bracket form reads the raw slice. Blanking preserves
length, so one offset pair indexes both texts. Depth 1 and depth 2 already split the two forms, and
depth 3 owed the same split.

🔴 **A CAUSE MUST NAME ITSELF.** Control Q points a `servesKeys` entry at an array the subtree does
not carry. The first version dropped that entry in silence. It then blamed four element keys for
going unread, and it never named the stale array. `elemServesUnknown` now reports the stale name
itself.

🔴 **A SKIP WITH A STATED REASON IS NOT A BLINDNESS, AND THIS ONE IS COUNTED.**
`clockSkew.findings` carries no element declaration, and `integrator-app.js:90` reads four keys out
of it. The verdict reports `elementReadsUnjudged: 1` and names the site. Nobody hand-read that
literal yet. Seeding a declaration from the gate's own reading would repeat §6's defect.

🔴 **THE TWO BLANKING ROUTES ARE NOT INTERCHANGEABLE, AND CI ONLY EVER TAKES THE SECOND.**
`prepare()` blanks in place with acorn, and the comment above it promises that every offset and
line stays where the raw file put it. The tokenizer fallback DELETES comment lines:
`integrator-dsp.js` reads 8290 lines raw, 8290 blanked under acorn, and **6403** under the
tokenizer. `tests.yml` installs no node_modules, so CI always takes the fallback.

My first version indexed the raw text by a blanked line number. That read a different line on the
runner, and it threw the named element-literal error. The gate was green on this machine and red in
CI.

The repair keeps each read inside one text. The keys now come off the BLANKED line, where
identifiers survive, and `at` comes from a unique match in the raw text. A read site pairs the two
texts by ORDER, and `elemRawUnpaired` reds the site when the counts disagree. Eight selftest legs
force the tokenizer route, because the acorn route hides the whole defect.

🔴 **A REFUSAL IS LOUDER THAN A SHORT KEY LIST.** The shape reader requires exactly one matching
literal inside the builder, and it requires a close on one line. A moved, duplicated or multi-line
literal throws a named error. The gate does not guess a shape.

### The seven live controls

Each control edits the real declaration, runs the gate, and restores the file. Every restore is
byte-identical.

| control | edit | the gate says |
|---|---|---|
| K | `version` declared `card` | `✗ 1 element key(s) declare 'card' and no anchored element read reaches them in integrator-app.js + overdex-app.js: entry.version` |
| L | `status` declared `export-only` | `✗ 1 element key(s) declare 'export-only' and an anchored element read reaches them: entry.status` |
| M | drop the `overdex-app.js` realm | `✗ … entry.status` plus the depth-2 red on `ok` |
| N | rename the shape's variable | throws the named element-literal error |
| O | remove the `elements` block | PASS with `2 element read(s) UNJUDGED` |
| P | declare a key the literal omits | `✗ 1 element key(s) declare no surface: entry.kind (declared, absent from the literal)` |
| Q | point `servesKeys` at `widgets` | `✗ 1 element shape(s) serve an array key this subtree does not carry: entry serves widgets` |
| R | run with no `node_modules` | PASS under the tokenizer route, with the same four keys and the same raw line 90 |

### What this still cannot see

Depth 4, and the element literal of `clockSkew.findings`. That literal is the one unjudged element
read site the verdict names. A multi-line element literal refuses, and no declaration needs one
today. Eleven nested subtrees still carry no declaration, so depth 2 reaches three of fourteen.
Depth 3 reaches one of three declared subtrees. The realm list still comes from the files that name
`kernelAudit`, so a fourth realm would stay invisible.

One route-dependent report survives, and it is cosmetic. The depth-2 alias site prints a BLANKED
line number, so `ka@77` on this machine prints `ka@57` on a runner. The element layer pairs its
sites and prints the raw line. The alias layer does not pair, and nothing decides on that number.

**Repaired 2026-11-13.** `codeOnly` in `tools/find-unwired-js.mjs` now blanks every span it consumes,
as `codeOnlyParsed` always did. So a runner prints `ka@77` as well (row
2026-11-13-an-alias-line-printed-for-a-human-is-a-blanked-line).

## 13 · 2026-11-13 — an element literal can sit at the push site, and the read census saw callbacks only

| measurement | before | after |
|---|---|---|
| element shapes judged | 1 | **2** |
| element keys judged | 4 | **12** |
| element keys credited `card` | 3 | **7** |
| element keys conditional over push sites | — | **2** |
| element read sites judged | 2 | **3** |
| element reads COUNTED as unjudged | 1 | **2** |
| selftest legs | 164 | **188** |

🔴 **AN ELEMENT LITERAL CAN SIT AT THE PUSH SITE, AND TWO PUSH SITES CAN DISAGREE.**
`auditNodeKernels` builds one `var entry = {` that `elementShape` reads on one line.
`detectClockSkew` does neither thing. It pushes an object literal straight into `findings[]` at
`integrator-dsp.js:7313` and `:7342`, each literal spans lines, and the two key lists differ. The
pairwise estimator writes six keys. The RTC-readback pass writes those six plus `source` and
`rtcVerifiedAtMs`.

So `pushShapes` reads a UNION over sites, and a key that some site omits is PARTIAL. The word keeps
the meaning depth 2 gives it: a reader can hold an element without that key. `source` is the clearer
case, because the pairwise literal states its provenance in `method` instead. A reader that tested
`source` for absence would read a pairwise finding as malformed.

🔴 **A PUSH IS SCOPED BY ITS ARRAY, AND NOT BY ITS FUNCTION.** This is the opposite of the rule
`nestedShapes` needs one layer up. Both pushes sit inside `.forEach` callbacks within
`detectClockSkew`, so reading a push the way a return is read found NO shape at all here, and
`enclosingFn` named the callback every time. The array variable is what ties the literal to the
builder: `detectClockSkew` declares `var findings = []` and returns it. So the guard moved to the
array NAME, and a second declaration of it inside the builder refuses rather than mixing two arrays.

🔴 **THE READ CENSUS SAW ITERATOR CALLBACKS ONLY, SO IT UNDER-REPORTED ITS OWN HOLE.**
`callbackSites` matches eight iterator names. An element read through an INDEXED FOR LOOP is
invisible to it. `skewSilenceLines` binds `vetoes = cs.vetoes || []` and `census = cs.seamCensus ||
[]`, then reads `v = vetoes[i] || {}` and `e = census[c] || {}`, and it takes six keys off those two
elements. The gate said ONE unjudged element read where THREE array keys are read element-wise.

A stated hole that under-counts is worse than a stated hole, because the number invites belief.
`indexedSites` now finds the form, so the census counts it. The gate does not JUDGE it: binding keys
through an index needs a declaration that somebody hand-read, and section 4 names seeding one as the
defect. Discovery runs on BLANKED text, so a commented-out index read credits nothing, and the line
a reader sees comes from the RAW text paired by order. That is board 6051 applied to the new form.

### The seven live controls

Each control edits the real declaration, runs the gate, and restores the file. Every restore is
byte-identical.

| control | edit | the gate says |
|---|---|---|
| S | `source` declared `card` | `✗ 1 element key(s) declare 'card' and no anchored element read reaches them in integrator-app.js: finding.source` |
| T | `offsetSec` declared `export-only` | `✗ 1 element key(s) declare 'export-only' and an anchored element read reaches them: finding.offsetSec` |
| U | remove the `elements` block | PASS with `3 element read(s) UNJUDGED (findings@90, seamCensus@48, vetoes@38)` |
| V | point `pushInto` at `pairs` | `✗ 13 element key(s) declare no surface` — the shape of another array is not this element |
| W | point `builtBy` at a function that does not exist | throws: the subtree is an inline literal and the element shape has no builder to read it from |
| X | declare a key the union omits | `✗ 1 element key(s) declare no surface: finding.kind (declared, absent from the literal)` |
| Y | run with no `node_modules` | PASS under the tokenizer route, with the same 12 element keys and the same raw lines 38 and 48 |

Control O from section 12 was re-run today, and it still reads `2 element read(s) UNJUDGED`. The
gate now NAMES them, and the two names are `mismatches@integrator-app.js:79` and
`mismatches@overdex-app.js:867`. So that row's number covered the `kernelAudit` census alone, and it
never covered the clockSkew reads this section adds.

### What this still cannot see

Depth 4, and the element shapes of `vetoes[]` and `seamCensus[]`. Those two are the counted
unjudged reads, and a later unit declares them. Judging them needs the index form to bind an element
variable, which this unit deliberately left unbuilt. Eleven nested subtrees still carry no
declaration, so depth 2 reaches three of fourteen. Depth 3 now reaches two of three declared
subtrees.

`pushShapes` reads RAW source, like `nestedShapes` beside it. A commented-out push literal inside
the builder would read as a shape. No such comment exists in `detectClockSkew` today, and the
refusal on a second declaration of the array name is the only guard. The cosmetic route-dependent
alias line from section 12 survives unchanged, and a later unit repaired it on 2026-11-13.

## 14 · 2026-11-13 — one element over two build routes, and a read the census counted but did not judge

| measurement | before | after |
|---|---|---|
| element shapes judged | 2 | **4** |
| element keys judged | 12 | **22** |
| element keys credited `card` | 7 | **13** |
| element keys partial over build routes | 2 | **5** |
| element read sites judged | 3 | **5** |
| element reads COUNTED as unjudged | 2 | **0** |
| selftest legs | 188 | **220** |

🔴 **A `.map` RETURN LITERAL IS AN ELEMENT SHAPE, AND NO READER COULD SEE IT.** `seamCensus` is
built by one `.map(` on its own declaration statement at `integrator-dsp.js:7231`, and the element
literal is the `return {` inside that callback. `elementShape` wants a one-line `var name = {`.
`pushShapes` wants a `<array>.push({`. Neither form appears here, so the array stood undeclared at
depth 3 while its reader took four keys out of each element.

The new `mapShapes` reader scopes the search to the DECLARATION STATEMENT of the array, and not to
the builder function, because `detectClockSkew` calls `.map` eleven times. It refuses when the
statement holds no map call, and it refuses when the statement holds two.

🔴 **ONE ELEMENT CAN HAVE SEVERAL BUILD ROUTES, AND `partial` THEN MEANS ROUTE.** `vetoes` is built
twice. A map literal at `:7192` writes four keys. A push literal at `:7212` writes five. The union
holds six, and three of them are partial: `rtcVerifiedAtMs` arrives on the map route alone, and
`seams` with `seamsReason` arrive on the push route alone. So the declaration names BOTH routes
(`mappedFrom` and `pushInto`), `mergeShapes` unions what each route writes, and the report says `from
2 build site(s)`.

A declaration that names a route the gate cannot read now throws, and it names the route in the
message. That refusal is what stops a dropped route from silently shrinking the judged set.

🔴 **COUNTING A READ IS NOT JUDGING IT, AND THE DIFFERENCE IS THE BOUND ELEMENT.** Section 13 left
two reads counted and unjudged. Both are index loops: `integrator-app.js:48` binds `var e =
census[c] || {}` and `:38` binds its element in a callback. The array-level `indexedSites` scan
finds the site and reads no keys, because it has no element variable to anchor a key read to. The new
`indexedElements` reader returns the local binding as the callback `param`, with the LOOP BODY as its
span, so the one `readsElementKey` judge serves the callback form and the index form alike. One
consequence needed a fix: the same read then counted twice, once bound and once at array level. A
`bound` set now holds every array an element site already covers, and the census skips it.

### Controls

Each control edits the real declaration, runs the gate, and restores the file. Every restore is
byte-identical to sha256 `1fbeb3251ec1`.

| control | edit | the gate says |
|---|---|---|
| Z1 | `veto.source` declared `export-only` | `✗ 1 element key(s) declare 'export-only' and an anchored element read reaches them: veto.source` |
| Z2 | `veto.seams` declared `card` | `✗ 1 element key(s) declare 'card' and no anchored element read reaches them in integrator-app.js: veto.seams` |
| Z3 | remove `censusEntry` | PASS, and the census names the read again: `cs.seamCensus at integrator-app.js:48` |
| Z4 | remove both new elements | PASS at the section 13 numbers: 12 keys, 2 partial, 2 unjudged reads |
| Z5 | point `censusEntry.mappedFrom` at `vetoes` | `✗ 6 element key(s) declare no surface` — the shape of another array is not this element |
| Z6 | drop `mappedFrom` from `veto` | `✗ 1 element key(s) declare no surface: veto.rtcVerifiedAtMs (declared, absent from the literal)`, and the partial set falls from 5 to 2 |
| Z7 | point `veto.mappedFrom` at `pairs` | throws: `the element shape 'veto' declares a map build route inside detectClockSkew() that this gate cannot read` |
| Z8 | run with no `node_modules` | PASS under the tokenizer route, with the same four shapes, the same 22 keys, and the same raw line 48 under the Z3 state |

Z8 matters because `.github/workflows/tests.yml` installs nothing, so CI always takes the tokenizer
route. The tokenizer route DELETES comment lines, and a blanked line index is never a raw line index
there. The run above is the evidence that the raw pairing holds on both routes.

### What this still cannot see

Depth 4. The gate judges a `clockSkew` element key that itself holds an object as ONE key, and a 0
in `elementReadsUnjudged` does not say that no such key exists.

A build route the declaration does not name. The refusal fires on a route the declaration names and
the gate cannot read, and it cannot fire on a third route nobody declared. `detectClockSkew` writes `vetoes` on
exactly two routes today, and `mergeShapes` would silently under-report a third.

`mapShapes` reads RAW source, like `pushShapes` and `nestedShapes` beside it. A commented-out map
return inside the declaration statement would read as a shape. No such comment exists today.

`indexedSites` resolves one array-alias hop. A read that passes the array through two locals before
the index still escapes the census, and a 0 there is a tripwire result, not a proof.

The field that held one push offset is now `siteAt`, and it holds one offset per build route. The
name `pushAt` could not describe a map route.

---

## 15 · 2026-11-13 — the fourth subtree is an ARRAY, and the reader that judged it found a false credit

Unit `nest4` declares `findings`, the fourth nested subtree. Magpie confirmed the deciding count
independently at board #6080, from the export literal and not from this table.

### What moved

| measure | before | after |
|---|---|---|
| nested subtrees | 3 | 4 |
| nested depth-2 keys | 26 | 27 |
| element shapes | 4 | 5 |
| element keys judged | 22 | 33 |
| element `card` keys | 13 | 21 |
| element read sites | 5 | 12 |
| anchored alias sites | 4 | 4 |
| selftest legs | 220 | 247 |

The 11 new keys are 8 `card` and 3 `export-only`. The gate credits each `card` key from a read it
names, and it credits no `export-only` key from any realm.

### Three findings, and two of them are defects this unit repaired

**A TOP-LEVEL EXPORT ARRAY HAD NO SHAPE SOURCE AT ALL.** `inlineShape` wants a `<key>: {` object
literal. `nestedShapes` wants a builder function. The export writes
`findings: fusion.findings.map(function (f) { return { … } })`, which is neither of those. So the 11
keys that every consumer of the export receives had no shape this gate could read.

`exportMapShape` reads one entry of the export literal. It then takes the return shape of the single
`.map` inside that entry. It refuses on six states, and each refusal is a selftest leg.

**THE ELEMENT ANCHOR REQUIRED ADJACENCY, AND IT SAW ONE SITE IN FIVE.** A subtree's array is read as
`fusion.kernelAudit.mismatches.map(`, with the iterator next to the member. A top-level key is read
defensively instead. Three of the five hand-checked sites wrap the member as `(fusion.findings || [])`
and one chains `.slice(0, 12)` before `.forEach`. The adjacent anchor credited 2 of the 11 keys, and
6 `card` keys had no reader.

The anchor is now a walk. It crosses a `|| []` or `?? []` default guard, then any number of
element-preserving calls, and it stops at the first thing it does not recognise. `filter`, `sort`,
`slice` and `reverse` hand on the same elements, so the walk crosses them. `map`, `flatMap` and
`reduce` change what the next callback receives, so the walk stops there. An iterator can also be a
link, so `findings.filter(…).forEach(…)` holds two sites and not one.

Measured against all seven already-declared element arrays: the walk finds exactly the sites the
anchor found. So the generalisation adds sites and removes none.

**AND THE ALIAS DETECTOR CREDITED A CHILD AS ITS PARENT.** This is the defect worth reading twice.
`integrator-app.js` binds `var cs = FUSION && FUSION.clockSkew`. The bind regex barred an identifier
character after the path and allowed a `.`, so with the path `FUSION` that line registered `cs` as an
alias of `FUSION` itself.

The gate then read `cs.findings` — the clockSkew subtree's own findings array, whose element carries 8
different keys. It credited that read against the TOP-LEVEL `findings` array. One of this
declaration's 8 element read sites was that false credit.

Barring the `.` does not fix it, and that is the instructive part. The guard group is OPTIONAL, so
with zero guards the path matches the GUARD's own occurrence of `FUSION`. The next character is then a
space, and no lookahead of that kind can refuse it.

So the match must now END at the path. After the path the line may carry a `||` fallback, and then it
must close. A ternary or a further member access does not bind that path, and the gate declines to
read one rather than crediting the wrong object. Alias sites fell from 16 to 4, and the 4 that remain
are the three real ones plus the forwarded hop.

### Two cells that a reader should not misread

`time` is COMPUTED in the projection, as `fmtDateTime(f.tMs)`. It has no counterpart on the internal
finding object, so no realm read can ever credit it. A rule that demanded a reader for `time` would be
unsatisfiable. It is `export-only` by construction, and not by the absence of a read.

`belowChance` and `pSpurious` ship a ternary onto `undefined` rather than onto `null`. A reader
therefore holds an element that may lack either key. That is NOT what `partial` means here. `partial`
names a key that some BUILD ROUTE omits, and this literal has exactly one route. A reader that tests
either key for absence is reading a legal element.

### The controls

Each control edited the real declaration, ran the gate, and restored the file. Every restore matched
the starting sha256.

| control | the planted state | result |
|---|---|---|
| N0 | the real declaration | exit 0 |
| N1 | a `card` element key no realm reads | exit 1 |
| N2 | an `export-only` element key a realm does read | exit 1 |
| N3 | the element block removed | exit 1, named |
| N4 | `exportMapped` pointed at a key with no `.map` | exit 1, named |
| N5 | `arrayOf` and `inline` both declared | exit 1, named |
| N6 | a key declared that the literal does not carry | exit 1 |
| N7 | a key of the literal left undeclared | exit 1 |
| N8 | the subtree key declared `export-only` | exit 1 |

The parse-route control ran the whole gate twice, once with `node_modules` present and once with it
absent. Every field of the verdict agreed, apart from `blankedBy` itself.

### What this still cannot see

**The printed alias LINE NUMBERS were route-dependent, and a later unit REPAIRED that on 2026-11-13.**
The route control measured it here: `a@474` under acorn read `a@302` under the tokenizer. The
tokenizer route DELETED each span it consumed, and `aliasSites` takes its line from the blanked text
without pairing it back to raw. Every judged number stayed route-independent, so no verdict ever
moved. A session that followed a printed alias line in CI went to the wrong line.

This unit measured that defect and did not repair it. The repair took its own unit with its own
controls, as this paragraph asked: `codeOnly` in `tools/find-unwired-js.mjs` now blanks every span,
so both routes print the raw file's own line. Eight printed numbers moved on this gate and no field
of its verdict did (row 2026-11-13-an-alias-line-printed-for-a-human-is-a-blanked-line).

**An element read through a LITERAL index, with no bound local, is invisible to all three readers.**
`integrator-render.js:486` reads `a.findings[0].pSpurious`. `indexedSites` needs a binding statement,
so it does not see this form, and the census neither credits it nor counts it. No cell rests on it:
`pSpurious` is `card` and a reader credits it at `integrator-app.js:399`.

**The ranking rule that chose this subtree counts two different things.** Magpie named the asymmetry
at board #6080. For an array subtree the depth-2 key count is the ELEMENT's key count. For an
object-of-arrays such as `unmatched` it is the object's own key count, which is 2, while the element
literals one level further down hold 4 and 3 keys. The pick does not change, because `findings` wins
under either reading. A later unit that ranks the remainder owes the sharper metric.

**Five export subtrees remain undeclared**, with their key counts read from source: `window` 12,
`schema` 13, `apneaTyping` 11, `unmatched` 2 over 7 element keys, and `handshakes` 2. `kernel` and its
2 keys are absent from that scan, because the probe that enumerated them misses a one-line object
literal. The pass-through subtrees of the form `fusion.X || null` still need the resolver that board
#5905 parks.

## 16 · 2026-11-13 — the fifth subtree has TWO export routes, and two computed facts printed nowhere

Unit `window` declares `fusion.window`, the fifth nested subtree. Magpie read the same literal
independently at board #6095 and corrected its own count at #6097.

### What moved

| measure | before | after |
|---|---|---|
| nested subtrees | 4 | 5 |
| nested depth-2 keys | 27 | 39 |
| depth-2 `card` keys | 18 | 25 |
| depth-2 `export-only` keys | 9 | 14 |
| declared `partialShape` reasons | 2 | 4 |
| anchored alias sites | 4 | 6 |
| subtrees read from a literal | 1 | 2 |
| keys the verdict judges | 63 | 75 |
| selftest legs | 247 | 261 |

The 12 new keys are 7 `card` and 5 `export-only`. The gate credits each `card` key from a read it
names, over three realms: `integrator-render.js` 4, `integrator-app.js` 2 and `overdex-app.js` 1.

### Three findings

**THE EXPORT WRITES THIS SUBTREE TWICE, AND THE TWO ROUTES CARRY DIFFERENT KEYS.**
`grep -nE '^\s*window:\s*\{\s*$' integrator-dsp.js` returns 7943 and 8039. Line 7943 is the full
`runFusion` export and carries 10 keys. Line 8039 is the slim `var _exp = {` projection and carries
12, because it adds `start` and `end`. `fmtDateTime` computes both from `startMs` and `endMs`.

`inlineShape` refused on a second anchor until this unit. That refusal read two routes as ambiguity,
so the subtree had no shape source and no session could declare it. The reader now judges the UNION
over every anchor. It names each key that one route omits, under a new `partialKind` of
`export-route`.

Two mechanisms cannot wear one `partialKind`. A key that one route omits and a key whose value can
evaluate to `undefined` state different facts about the export. So `inlineShape` throws a named
error when it finds both at once, rather than pick one kind. A selftest leg holds that refusal.

**THE VERDICT REPORTED THE FIRST REALM'S ALIAS SITES ONLY.** `evaluateNested` walks every declared
reader for the credit. Three of its fields read `readers[0]` alone: `aliasSites`, `forwarded` and
`aliasUnresolved`. `fusion.window` binds `w` at `integrator-render.js:415` and again at
`overdex-app.js:717`. The evidence line named one of the two sites.

No judgement reads those three fields, so nothing reded. The gate held every key right and the
number a reader checks read wrong. Each site now carries its own file. The label names the realm
only when two realms bind, so a one-realm subtree keeps the exact line it printed before.

The four earlier subtrees never showed this. Their second realm reads the whole path and binds no
alias, which is the `K2` selftest case. `window` is the first subtree whose second realm binds one.
So the count moved for `window` alone: 4 sites before, 6 after.

**A NESTED DECLARATION FOR A DROPPED KEY PRINTED NOTHING.** Depth 1 reports that state as
`staleDeclarations` and deliberately stays green, because the author owns the removal.
`evaluateNested` computed the same list, and no metric and no reason ever read it. Control W2 below
measured it as GREEN, with no line about it anywhere. `nestedStaleDeclarations` and
`nestedStaleWhere` now state it, and the subtree's evidence line names each key.

### Controls

Each control edits the declaration, runs the gate, restores the file and checks the SHA. The baseline
PASSES at 75 keys, and the restore matched the original SHA after every control.

| control | the state it declares | what the gate said |
|---|---|---|
| W1 | a key of the literal left undeclared | RED · `1 nested key(s) of fusion.window declare no surface: spanMin` |
| W2 | a declared key the literal no longer carries | GREEN · `1 declared key(s) the literal no longer carries (bogusKey)` |
| W3 | a read key declared `export-only` | RED · `declare 'export-only' and an anchored read reaches them: startMs` |
| W4 | a `card` key no realm reads | RED · `declare 'card' and no anchored read reaches them … spanMin` |
| W5 | a partial key with no `partialShape` reason | RED · `exist on one export route only, with no partialShape reason declared: start` |
| W6 | a `partialShape` reason for a key every route carries | RED · `name a key whose presence is no longer conditional: spanMin` |
| W7 | `inline: true` beside `builtBy` | REFUSES · `must declare exactly one of builtBy, inline:true or arrayOf:true` |
| W8 | the realm that reads four `card` keys dropped | RED · `3 nested key(s) declare 'card' and no anchored read reaches them` |

W2 is the control that found the third finding. It reported nothing at all before this unit, and the
table above records what it prints now.

The parse-route control hides `node_modules`, so the blanking route falls back from `acorn` to the
tokenizer. Both routes PASS at 75 keys, 39 nested keys, 25 `card`, 6 alias sites and 2 literal
subtrees. Every judged number holds across the two routes.

### What this still cannot see

The reader credits `w.startMs` at `integrator-render.js:669` and `:765` against a NODE's own window,
not against this subtree, because the scope rule keeps the two apart. The declaration records that.
`overdex-app.js:774` reads `overlapUnionMin`, and that read is the only credit for the key, so
dropping the realm reds three keys at once.

Five of the twelve keys match no read anywhere: `spanMin`, `pairwiseSumMin`, `samePairsExcluded`,
`start` and `end`. All five declare `export-only`, and the gate holds them to that.

Four export subtrees remain undeclared: `schema` 13 keys at line 8014, `apneaTyping` 11, `unmatched`
2 over 7 element keys, and `handshakes` 2. `kernel` and its 2 keys need a reader for a one-line
object literal. The pass-through subtrees of the form `fusion.X || null` still need the resolver that
board #5905 parks.

## 17 · 2026-11-13 — the sixth subtree holds an OBJECT one level deeper, and the ladder reached arrays only

Unit `schema` declares `fusion.schema`, the sixth nested subtree. Magpie read the same literal at
board #6110 and counted the same six keys, with the same seven keys inside `method`.

### What moved

| measure | before | after |
|---|---|---|
| nested subtrees | 5 | 6 |
| nested depth-2 keys | 39 | 45 |
| depth-2 `card` keys | 25 | 25 |
| depth-2 `export-only` keys | 14 | 20 |
| inner object literals | 0 | 1 |
| inner keys judged | 0 | 7 |
| keys judged | 75 | 88 |
| selftests | 261 | 296 |

### Three findings

**1 · The 13 keys this brief recorded union two depths.** The literal at line 8014 holds SIX keys:
`name`, `version`, `generated`, `provenance`, `doc` and `method`. `method` is an object literal and
it holds seven more. Six plus seven is 13, and a top-key read returns 6. Magpie and I measured the
anchors first this time, so neither of us built against the wrong count.

**2 · A `card` label cannot stay honest one level inside a subtree.** The read machinery credits a
key one hop below an alias, and nothing in it addresses `holder.schema.method.window`. So an inner
key declares `export-only`, and a `card` there reds with that reason. A label the gate cannot
compute is the shape of defect section 16 names: the gate is right and the declaration claims a
credit nobody measured.

**3 · A parent route that carries no inner literal makes EVERY inner key conditional.** The first
draft compared the key lists of the inner literals it found. A parent on two export routes can
carry the object on one route alone, and a consumer reading the other route then gets no object at
all. So the reader holds the count of inner literals against the count of parent literals.

### The controls

| # | the mutation | what the gate did |
|---|---|---|
| S0 | drop the `doc` surface at depth 2 | FAIL — `1 nested key(s) of \`fusion.schema\` declare no surface: doc` |
| S1 | drop the `apneaCoupling` surface inside `method` | FAIL — `1 inner key(s) declare no surface: method.apneaCoupling` |
| S2 | declare an inner key the literal dropped | PASS, and it prints `1 declared inner key(s) the literal no longer carries (method.retired)` with `innerStaleDeclarations: 1` |
| S3 | label an inner key `card` | FAIL — the reason names the credit nobody computed |
| S4 | label an inner key `rendered` | FAIL — `1 inner key(s) declare something other than 'export-only'` |
| S5 | declare an inner literal on `name`, a string | REFUSES, exit 1, and names `schema.name` and where it looked |
| S6 | declare an inner literal the subtree lacks | REFUSES, exit 1, and names `schema.nope` |

The route control: the inner reader works in PREPARED lines and never slices raw text, so both
parse routes return one key list and one line number. I measured that on both comment forms on
2026-11-13. The 261 earlier selftests pass unchanged after the refactor, which is what holds
`inlineShape` to its old behaviour.

### What this still cannot see

`integrator-app.js:177` reads `json.schema.name` to RECOGNISE a dropped fusion export by its
`.fusion-export` suffix. The holder there is an untyped `json` on the re-ingest path, and that read
renders nothing. The two-label vocabulary states "a reader renders it" or "no reader reads it", and
it cannot state "a reader tests it and draws nothing". A third label is a later unit.

The seven `method` values are prose strings, and the inner layer judges the key set alone. A string
that still describes a key the fusion dropped reds nothing here. Section 16 of this brief lists
seven `window` key names inside one of those strings, so that rot has a real surface.

`innerShapeMissing` fires through a direct call alone, because the loader refuses first. The
element layer carries `elemShapeMissing` on the same terms, and this field mirrors it.

Three export subtrees remain undeclared: `apneaTyping` 11 keys, `unmatched` 2 over 7 element keys,
and `handshakes` 2. `kernel` and its 2 keys need a reader for a one-line object literal. The
pass-through subtrees of the form `fusion.X || null` still need the resolver that board #5905 parks.

## 18 · 2026-11-13 — the seventh subtree sits on TWO export routes of DIFFERENT FORMS

`apneaTyping` had no shape at all. `inlineShape`, `nestedShapes` and `exportMapShape` each returned
`null` for it on 2026-11-13, so the subtree reached none of the three readers that existed. The
brief recorded 11 keys for it, and that figure reads one route of the two.

### What moved

| measure | before | after |
|---|---|---|
| declared nested subtrees | 6 | **7** |
| depth-2 keys judged | 45 | **57** |
| depth-2 `card` | 25 | 25 |
| depth-2 `export-only` | 20 | **32** |
| subtrees read over several routes | 0 | **1** |
| declared partial keys | 4 | **5** |
| keys judged, `population.checked` | 88 | **100** |
| selftests | 296 | **344** |

### Three findings

**One subtree, two routes, two source FORMS.** Route one is `var out = {` inside
`typeApneaByEffort` at line 1858. The function returns that variable, and the fusion object carries
it verbatim through `apneaTyping: apneaTyping` at line 7983, which is twelve keys. Route two is the
slim `var _exp = {` projection at line 8074, which enumerates eleven of them behind the guard
`fusion.apneaTyping ? {`. `window` taught this gate that two anchors of ONE form are two export
routes. This subtree is the next state, where the two routes differ in form, so a subtree may now
declare a LIST of routes and the union is the surface.

**The slim export drops `events`, and the drop is right.** The producer keeps `events: []` with a
comment that no typed impulse reaches the bus any more. A node-export consumer therefore reads
eleven keys, and an in-process reader of the fusion object reads twelve. `events` declares
`partialShape` and the gate holds the difference as a fact about the export, not as a defect.

**A guarded literal is one line below where the reader looked.** `inlineShape` anchors on
`key: {`, so the guard `apneaTyping: fusion.apneaTyping` with its `? {` on the next line matched
nothing. The reader reported "no anchor", which reads as "the shape moved" and was wrong — the
shape sat one line further down. The guard's ALTERNATIVE is a refusal and never a second shape: a
`: { … }` would put two key lists behind one key, so that state refuses.

### The controls

Each row names what the gate did when I broke the declaration, and the message it printed.

| control | the gate |
|---|---|
| A0 — as declared | `PASS`, `checked: 100` |
| A1 — drop the `events` surface | FAIL · `1 nested key(s) of `fusion.apneaTyping` declare no surface: events` |
| A2 — label `events` card | FAIL · no realm reads it, and the reason names the key |
| A3 — drop the `partialShape` entry | FAIL · `1 nested key(s) exist on one export route only, with no partialShape reason declared` |
| A4 — point route one at a function that moved | REFUSES · names `returnVar `typeApneaByEffortGone.out`` |
| A5 — point route two at a key that moved | REFUSES · names `guarded `apneaTypingGone`` |
| A6 — declare `routes` and `inline:true` | REFUSES · `must declare exactly one of builtBy, inline:true, arrayOf:true or routes` |
| A7 — declare a key the export dropped | `PASS` with `nestedStaleDeclarations: 1` at `apneaTyping.retiredKey` |
| A8 — point route one at the wrong variable | REFUSES · names `returnVar `typeApneaByEffort.notOut`` |

A refusal names the ROUTE and not the subtree alone, because `routes` holds several sources and the
author would otherwise read all of them.

### What this still cannot see

A producer's literal is the whole shape only while nothing adds a key to it afterwards. A later
`out.<newKey> = …` throws instead, because a short key list is the one answer a shape reader must
never give. A `++` on a key the literal carries stays arithmetic.

A one-line guarded literal has no reader. No subtree writes that form today, and the gate refuses
rather than reads it.

Two of the twelve keys carry an absence by ruling: `obstructive` and `central` are permanently null
under INTEGRATOR-APNEA-TYPING-REVIEW-2026-07-22, and `typingWithdrawn` states that with a
machine-readable `withdrawnReason`. This gate judges the SURFACE of each key and never its value,
so a withdrawal that stops writing a key would read here as a stale declaration.

Two export subtrees remain undeclared: `unmatched` 2 keys over 7 element keys, and `handshakes` 2.
`kernel` and its 2 keys need a reader for a one-line object literal. The pass-through subtrees of
the form `fusion.X || null` still need the resolver that board #5905 parks.

## 19 · 2026-11-13 — the eighth subtree is an OBJECT OF ARRAYS, and no new reader was owed

`fusion.unmatched` is the first declared subtree whose own keys are arrays, each with its own element
shape. The measurement that sized it ran all four readers against the real source first, because the
`apneaTyping` unit found three readers returning `null` where the brief implied one would answer.
Here the opposite held: every mechanism the gate already carries was enough, so this unit changes
`tools/integrator-surface-gate.mjs` not at all.

| | before | after |
|---|---|---|
| nested subtrees judged | 7 | **8** |
| depth-2 keys | 57 | **59** |
| element shapes | 5 | **7** |
| element keys | 33 | **40** |
| `population.checked` | 100 | **102** |
| card at depth 2 | 25 | 25 |
| export-only at depth 2 | 32 | **34** |
| selftests | 344 | 344 |

`inlineShape` reads the `unmatched: {` literal of the slim `var _exp = {` export at
`integrator-dsp.js:8116` and returns `desat` and `surge`. Each pool then declares an element shape
through `exportMapped`, which `exportMapShape` reads off the same export literal: four keys at
`:8118` for the desat pool, and three at `:8121` for the surge pool. `meta` rides the desat element
alone, so the two pools get two element shapes and never one union.

### The rendered pool is the APNEA copy, and depth 1 cannot tell

**No realm binds an alias to `fusion.unmatched`.** `integrator-render.js` reads
`a.unmatched.desat.length` at `:1004` and `a.unmatched.surge.length` at `:1006`, where `a =
fusion.apnea` at `:982`. The `apnea` subtree already declares its own `unmatched` key as `card` and
its note names both lines, so the rendered count is accounted for one subtree away. Both keys of
this subtree are therefore `export-only` on this holder, and the anchored depth-2 walk finds no
alias site at all.

The top-level `unmatched` key has carried a depth-1 `card` label since the widening, and that credit
rests on the same apnea-anchored text. A control proved it: flipping `surfaces.unmatched` to
`export-only` reds with

```
✗ 1 key(s) declare 'export-only' and integrator-render.js reads them: unmatched
```

so the depth-1 layer credits a read of `fusion.apnea.unmatched` to the top-level key. That is the
hole `readsAnchored` states about depth 1 in its own words, one level up from where it was fixed.
This unit does NOT move the depth-1 label, because anchoring depth 1 touches all 36 keys and owes
its own controls. The declaration records where the real read lives instead.

### Two more findings the measurement produced

**`population.checked` counts three layers of four.** The arithmetic is exact: 36 depth-1 keys plus
59 depth-2 keys plus 7 inner keys is 102, and the 40 element keys are judged and never counted. The
element layer reds `elemCardUnread`, `elemExportOnlyRead`, `elemUndeclared` and `elemBadValue`, so
its keys are examined against the same criterion the population claims to size. Under the verdict
contract the population must state what the gate examined, so this understates it by 40.

**An inline subtree's array key may carry no element shape, and nothing says so.** The gate reds a
`servesKeys` entry the subtree does not carry, at `elemServesUnknown`. It never asks the reverse. A
control set both element shapes to `servesKeys: ['desat']`, which leaves `surge` served by no shape,
and the gate still passed with `elementShapes: 7` and no report. An `arrayOf` subtree cannot reach
that state, because a missing element block refuses at load. The repair is cheap and the evidence is
already in hand: an `exportMapShape` hit on a key name proves that key is a mapped array, so the
gate can red an unserved array key without a new reader.

### The control battery, run live against the real declaration

| | planted state | result |
|---|---|---|
| U1 | the desat element's export route renamed | exit 1 · ``the element shape `desatEntry` declares the export-map build route this gate cannot read in the `desatGone:` entry of the export literal`` |
| U2 | a depth-2 surface the literal does not carry | exit 0 · PASS, reported as `nestedStaleWhere: ["unmatched.pools"]` |
| U3 | a key of the literal left undeclared | exit 1 · ``1 nested key(s) of `fusion.unmatched` declare no surface: surge`` |
| U4 | `desat` declared `card` | exit 1 · ``no usable binding of `fusion.unmatched` survives in integrator-render.js`` |
| U5 | an element key declared `card` | exit 1 · `1 element key(s) declare 'card' and no anchored element read reaches them in integrator-render.js: desatEntry.conf` |
| U6 | an element surface the literal does not carry | exit 1 · `1 element key(s) declare no surface: surgeEntry.retiredKey (declared, absent from the literal)` |
| U7 | the subtree declared `arrayOf:true` | exit 1 · ``the export entry `unmatched:` with a single .map return literal was not found`` |
| U8 | both element shapes serve `desat` | exit 0 · PASS with no report — the hole named above |
| U9 | `inline:true` and `arrayOf:true` together | exit 1 · ``must declare exactly one of builtBy, inline:true, arrayOf:true or routes`` |

U2 and U6 answer the same planted mistake at two depths and disagree: a stale depth-2 surface is
reported and a stale element surface reds. The depth-2 behaviour is the deliberate policy, because
an author owns a removal. The element layer never adopted it, and this brief records the asymmetry
rather than silently picking a side.

### What this still cannot see

**The element layer judges the slim route only.** The fusion route at `:7996` hands on the apnea
builder's own desat and surge objects, which carry more keys than a consumer ever sees. `exportMapped`
names the slim entry by key, so the declaration states which route it describes and makes no claim
about the in-process object. A reader that walks the fusion in memory sees a wider shape, and no
declaration here covers it.

**Arrayness is a human fact in an inline subtree.** The declaration asserts that `desat` and `surge`
are arrays, and the gate takes that on trust until the repair above lands.

One export subtree remains undeclared: `handshakes`, 2 keys at line 8125. `kernel` and its 2 keys
need a reader for a one-line object literal. The pass-through subtrees of the form `fusion.X || null`
still need the resolver that board #5905 parks.

## 20 · 2026-11-13 — a one-line literal is still a literal, and the ninth subtree needed that one change

`integrator-dsp.js:8124` writes the ninth subtree. It carries two keys, and each one holds an object
literal that opens and closes on its own single line:

```js
// §6 closed handshakes written back so nodes can ingest
handshakes: {
  glucodex_ready: { glucose_autonomic_correlation: fusion.autoGly ? … : null },
  ecgdex_ready: { glucoseCorrelation: fusion.autoGly ? … : null }
}
```

`uploads/integrator_fusion_night_twins.node-export.json:1662` carries both keys, and both values read
`null` there. One value reaches two consumers under two node-specific names.

### The probe came before the reader

I ran every existing shape reader against the real source first. `innerShape` returned `null` for both
inner objects. `literalRanges` wanted an anchor line of the form `key: {` and a later closing line, so a
literal that closed on its own line matched nothing.

Three edits followed. `literalRanges` now accepts a one-line form, `oneLineKeys` splits that line on
its depth-zero commas, and `literalKeys` routes a single-line range to it. The one-line branch is
narrow on purpose: a body carrying a second literal keeps the old refusal.

### The reader alone moved no number

I measured the reader before I wrote the declaration. The gate read `checked: 102`, `innerLiterals: 1`
and `innerKeys: 7` — the same three numbers main reports. The selftests went from 344 to 354.

| number | before | after the declaration |
|---|---|---|
| `checked` | 102 | 106 |
| subtrees | 8 | 9 |
| `nestedKeys` | 59 | 61 |
| `nestedExportOnly` | 34 | 36 |
| `innerLiterals` | 1 | 3 |
| `innerKeys` | 7 | 9 |

### Nine controls against the live declaration

| control | exit | what the gate said |
|---|---|---|
| a stale depth-2 surface | 0 | `1 declared key(s) the literal no longer carries (retiredKey)` |
| a depth-2 key left undeclared | 1 | `1 nested key(s) of \`fusion.handshakes\` declare no surface: ecgdex_ready` |
| a depth-2 key labelled `card` | 1 | `no usable binding of \`fusion.handshakes\` survives in integrator-render.js` |
| a stale inner surface | 0 | `1 declared inner key(s) the literal no longer carries (ecgdex_ready.gone)` |
| an inner key left undeclared | 1 | `1 inner key(s) declare no surface: ecgdex_ready.glucoseCorrelation` |
| an inner key labelled `card` | 1 | `this gate credits no reader one level inside a subtree` |
| an inner block the parent lacks | 1 | `the inner literal \`handshakes.absentKey\` was not found … this gate must not guess` |
| the whole `inner` block dropped | 0 | nothing — `PASS` at `checked: 104` |
| the one-line branch reverted | 1 | `the inner literal \`handshakes.glucodex_ready\` was not found … this gate must not guess` |

The last row is the control that sizes the unit. Revert the one-line branch and the live declaration
throws, so the reader carries the subtree and no earlier reader could.

### The opt-in hole, for the third time

Row eight is the hole. Drop the `inner` block and the gate passes at `checked: 104`, and it names the
absent layer nowhere. The inner layer stays opt-in by design (`tools/integrator-surface-gate.mjs:779`),
so no count names a one-line inner literal that nobody declares.

This is the third instance of one class. Board #6135 named the other two: the population omits the 40
judged element keys, and an array key that no element shape serves passes in silence. Each one needs a
declared-set census, and each one is its own unit. I did not widen this unit to repair them.

### What remains

`kernel` and its 2 keys stay undeclared, and the one-line reader above covers their form. The
pass-through subtrees of the form `fusion.X || null` still need the resolver that board #5905 parks.
