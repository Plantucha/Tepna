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
alias line from section 12 survives unchanged.

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
