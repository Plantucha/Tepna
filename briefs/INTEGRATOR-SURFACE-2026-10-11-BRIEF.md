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
