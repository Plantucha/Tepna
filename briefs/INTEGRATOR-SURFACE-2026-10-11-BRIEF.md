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

`tools/integrator-surface-gate.mjs` reds on exactly two conditions: a key with no declaration, and a
`card` key with no render mention. It emits one `tepna.verdict/1`, gate `integrator-surface`.

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
2. a `card` key whose render mention is deleted.

Both are planted in `--selftest` and asserted red. Neither is a claim about today.

## 5 · Done-when

- [x] Every key the fusion emits carries a surface; 0 undeclared.
- [x] A gate reds an undeclared key and a `card` key with no render mention.
- [x] The two drift states are planted, not assumed.
- [x] §4 states the seed's circularity rather than leaving the first PASS to be read as evidence.
- [x] The CVHR residue row closes on declaration (`export-only`).
