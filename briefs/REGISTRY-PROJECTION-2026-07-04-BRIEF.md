<!--
  REGISTRY-PROJECTION-2026-07-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->

**Status:** DONE — 2026-07-05 (Phase 1 gate + Phase 2 DEFS-fix / re-bundle / golden-regen executed; every REGISTRY-PROJECTION gate green — registry-defs-parity 78·0·2 · GATE A 3/3 · GATE B 13/13 · equiv 0/0 · release-ledger. The suite's only reds are the PARALLEL-CODER CONTROLLED-RELEASES docs-ledger dead-links — orthogonal to this brief, not introduced here.) · **Supersedes:** REGISTRY-INVERSION-2026-07-03-BRIEF.md · **Created:** 2026-07-04 · **Spawned-by:** `REGISTRY-INVERSION-2026-07-03-BRIEF.md` Phase-0 decision gate (owner chose direction (A), 2026-07-04)

# Registry projection — the registry stays the grade truth; every other copy becomes a gated projection of it

> **What this is.** The owner-selected alternative to `REGISTRY-INVERSION` (direction **A**, "invert the
> inversion"). That brief's Phase-0 audit (`codegen/PARITY-AUDIT.md`) proved the manifests are NOT latent
> single sources — they carry **0%** of the grade layer, diverge in ids/membership, and one node has no
> manifest at all. So instead of promoting an impoverished copy to master, we **keep each hand-written,
> test-backed `<node>-registry.js` as THE source** of every metric's display+grade metadata
> (`label · unit · goodDirection · depth · evidence · cite`) and make **every other place that restates
> those fields a projection or a gated mirror of it** — never a second source. Same §1 win as the parent
> ("the projection cannot disagree with its source"), in the safe direction: **no grade is ever invented,
> nothing flows INTO the registry, and the high-value fix ships with NO re-bundle.**
>
> **What this is NOT.** No grade/label/unit is added, removed, or changed (zero-semantic-change bar,
> inherited). No DSP is generated (`ARCHITECTURE-PRINCIPLES §1`). The registry is never demoted to a
> generated artifact. Evidence tiers + citations stay hand-written domain knowledge, living in the registry.

---

## 0. Ground truth — the two ungated drift pairs (from REGISTRY-INVERSION §1)

`cohesion-badges` already gates registry ↔ reference-guide ↔ badge-CSS. What is still **ungated** and can
silently drift is:

- **A. registry ↔ `<node>-cross.js` `*_DEFS` / `METRICS[]`** — the crossnight envelope's self-describing
  defs. This is a **live, in-bundle, hand-kept mirror**: `oxydex-registry.js`'s head literally says *"keep
  label/unit/goodDirection identical to oxydex-cross.js OXY_DEFS,"* and `ecgdex-registry.js` says the same
  of its `METRICS[]`. Shape varies per node — an **object** `OXY_DEFS`/`PPG_DEFS`/`CPAP_DEFS`
  (`{ id:{ good, label, unit, evidence, cite?, get } }`) or an **array** `METRICS[]` (ECGDex/PulseDex). Each
  is a **curated subset** of the registry (only the crossnight-relevant metrics) and carries a node-local
  `get:` accessor the registry has no equivalent for. **Field-name gotcha:** DEFS uses `good`, the registry
  uses `goodDirection` (the envelope maps `goodDirection:d.good`).
- **B. registry ↔ `codegen/manifests/<node>.manifest.json`** — Phase 0 showed these are "reference examples
  of the schema" (`codegen/README.md`), largely disjoint and un-graded — **NOT a live shipping drift pair**,
  except **CPAPDex**, whose manifest is the canonical codegen source.

Known live divergence this would have caught: PpgDex's `crossNightBlock` maps `Object.keys(PPG_DEFS)` and
**drops `evidence`+`cite`** (recorded in `docs/EVENT-LEXICON.md`; the OxyDex/CPAPDex mapping keeps them).

## 1. Design — projection, not promotion

1. **The registry is the sole source** of `{ label, unit, goodDirection, depth, evidence, cite }` per metric.
2. **`*_DEFS`/`METRICS[]` become a gated mirror, then (optionally) a projection.** Their shared fields
   (`label`/`unit`/`good`, and `evidence`/`cite` where present) must EQUAL the registry entry of the same id;
   the node-local `get:` accessor stays hand-written (it is data-access knowledge, not metadata).
3. **The manifest becomes a checked consumer** (intersection-only): where a manifest id also exists in the
   registry, its unit / label-abbr / goodDirection must not CONTRADICT the registry. Membership divergence is
   allowed — each artifact keeps its own set (no forced reconciliation, no grade invention).
4. **Nothing flows into the registry. Ever.** If a DEFS/manifest field disagrees, the registry wins and the
   OTHER file is fixed (or the manifest is left a reported backlog item) — never the reverse.

## 2. Phases

- **Phase 1 — the `registry ↔ _DEFS` parity GATE (the win; test-layer only, NO re-bundle).**
  Add a `registry-defs-parity` group to `tests/dex-tests.js` (both runners, env-fed — the house pattern):
  for each node with a `*-cross.js`, read its `*_DEFS`/`METRICS[]`, and for **every id present in both** it
  and the registry, assert `norm(label)`, `unit`, and `good`↔`goodDirection` are equal; where the def carries
  `evidence`/`cite`, assert those too (this reds the PpgDex lossy-map class of bug). Feed the def objects +
  registries through `env` in BOTH runners (`run-tests.mjs` + `Dex-Test-Suite.html`). Start by **reporting**
  the current mismatch set; fix each by editing the DEFS (registry wins) until green, then flip the group to
  hard-fail. Pure static/runtime data check — no bundle, no provenance churn.
  **✅ EXECUTED 2026-07-04:** group `registry-defs-parity` added to `tests/dex-tests.js` (runs in BOTH runners;
  no env wiring needed — `env.OXYCross/PPGCross/CPAPCross` + the `*Registry` resolvers are already fed to both).
  Live result: **78 parity assertions pass, 0 fail, 10 ◘ skips.** Introspection surfaced **8 pre-existing stale
  DEFS** — OxyDex `meanSpo2`/`meanHr` (DEFS `validated` vs registry `measured`); CPAPDex `residualAHI`/`centralIndex`/
  `usageHours` (same) + `usageHours` label "Therapy Hours"↔"Usage Hours"; PpgDex `pi`/`motion` label drift — each
  listed in a `KNOWN_DRIFT` baseline (◘, keeps the suite GREEN) with the exact fix, while any NEW/unlisted drift
  HARD-FAILS now. `KNOWN_DRIFT` is self-checked for staleness (a fixed entry reds until pruned). Object-DEFS nodes
  only; ECGDex/PulseDex `METRICS[]` are un-exported → deferred (◘). Clearing the 8 = the Phase-2 pass below.
- **Phase 2 — generate `*_DEFS` from the registry (OPTIONAL, per node, gated + re-bundle).**
  `generateDefs(registry, node)` emits the DEFS/METRICS shared fields from the registry; splice in the
  node-local `get:` accessors (kept hand-written) and delete the hand-mirror. Touches `<node>-cross.js` →
  full behavior gate (`Dex-Test-Suite.html?full`) + re-bundle via `node tools/build.mjs --app <Node>`
  (OWN-THE-BUILD Part A landed) + GATE A/B. One node per pass; ECGDex/PulseDex `METRICS[]` differ in shape
  from the object DEFS — handle both, or ship the object-DEFS nodes first and record the array nodes deferred.
- **Phase 3 — registry→manifest metadata projection (OPTIONAL, convenience for codegen).**
  Emit `codegen/generated/<node>.registry-meta.json` (`{id:{label,unit,goodDirection,depth,evidence,cite}}`)
  from the registry, so a future generated node — or a CPAPDex regen — inherits the registry's truth instead
  of re-authoring it. Gate the manifest↔registry **intersection**: strict for CPAPDex (real codegen source),
  report-only for the reference-example manifests. Never author grades into a manifest by hand.

## Risks / honesty

- **`*_DEFS` is a subset by design** — the gate must key on the **intersection** of ids, never require the
  DEFS to hold every registry metric (it holds only the crossnight-relevant ones). Requiring superset = false red.
- **Shape variance (object DEFS vs `METRICS[]` array).** Phase 1's reader must handle both; Phase 2's
  generator likewise, or explicitly scope to the object-DEFS nodes first and record the array nodes deferred.
- **The `get:` accessor is not metadata** — never generate or gate it; it is per-node data-access knowledge.
- **Do not "fix" a disagreement by editing the registry to match a DEFS/manifest** unless a human rules the
  registry was wrong — the registry is the test-backed truth (`CLAUDE.md §🎫`). Registry wins by default.

## Done when

- ☑ `registry-defs-parity` group **live in BOTH runners** — green, hard-fails on NEW drift. **Phase 2 EXECUTED
  2026-07-05:** all 8 pre-existing stale DEFS fixed registry-wins in `oxydex/ppgdex/cpapdex-cross.js` (OxyDex
  mean-SpO₂/mean-HR + CPAPDex residual-AHI/central-index/usage-hours evidence → `measured`; CPAPDex usage-hours
  label → "Usage Hours"; PpgDex → "Perfusion Idx"/"Motion-rejected"). The 3 owned bundles re-bundled via the owned
  core (manifestHash OxyDex `4d3b2194d942`→`69a51c03e025`, PpgDex `cb870ea34770`→`908befaae958`, CPAPDex
  `5a9046a1d859`→`911ce633d101`; `BUILD-MANIFEST.json` + `FIXTURE-PROVENANCE.json` re-stamped). Only the CPAPDex
  multi-night golden moved output (regenerated; outputHash `51943b9a67b2af2a`→`985c6b8334eb0370`, exactly the 4
  evidence/label lines — dry-run-proven); OxyDex/PpgDex carry no committed crossnight fixture (manifestHash-only).
  `KNOWN_DRIFT` pruned to `{}` → every shared-id field HARD-GATED. Verified green: registry-defs-parity (78·0·2),
  GATE A (3/3), GATE B (13/13), equiv single+multinight (0 diff). Release changeset dropped
  (`changes/2026-07-05-registry-projection-defs-parity.md`, `changes-list.json` regenerated) → release-ledger green.
- ☑ `CLAUDE.md §🎫` states the registry is THE metadata source; the crossnight `*_DEFS` is a gated **projection**
  (the `registry-defs-parity` line is present).
- ☑ Gate-only end state **ADOPTED** (documented decision): the OPTIONAL generate-`*_DEFS`-from-registry (Phase 2)
  + registry→manifest meta (Phase 3) are **deferred** — the parity GATE already guarantees no drift, so generation
  is convenience, not required. ECGDex/PulseDex `METRICS[]` remain un-exported → covered only when a future pass
  exports them (recorded ⊘ in the gate).
- ☑ Parent `REGISTRY-INVERSION-2026-07-03-BRIEF.md` closed with reciprocal supersede cross-links + `DOCS-INDEX` synced.

> **Note on the suite's 2 remaining reds (NOT this brief).** `docs-ledger` check4a/check4b flag dead DOCS-INDEX
> links to `CONTROLLED-RELEASES-FOLLOWUPS-2026-07-05-BRIEF.md` + six `docs/COMPLIANCE/*.md` — forward-references a
> PARALLEL CODER added for the in-flight CONTROLLED-RELEASES work. They pre-date and are orthogonal to Phase 2;
> left untouched (that coder owns them). Every gate this brief touches is green.

## Expected follow-up

Phase 1's report step will list every current `*_DEFS`↔registry mismatch (starting with the known PpgDex
`evidence`/`cite` drop) — each fix is a small recorded finding. If Phase 2 is taken, the array-shaped nodes
(ECGDex/PulseDex `METRICS[]`) are the natural second wave after the object-DEFS nodes.

## Cross-references
- `codegen/PARITY-AUDIT.md` — the Phase-0 evidence base that selected this direction.
- `REGISTRY-INVERSION-2026-07-03-BRIEF.md` — the superseded (flip) mechanism; its Phase 0 stands as the audit.
- `oxydex-cross.js` `OXY_DEFS` · `ppgdex-cross.js` `PPG_DEFS` · `ecgdex-cross.js` `METRICS[]` · `cpapdex-cross.js` `CPAP_DEFS` · the `*-registry.js` set.
- `CLAUDE.md §🎫` · `docs/EVENT-LEXICON.md` (PpgDex lossy-map note) · `ARCHITECTURE-PRINCIPLES §1` ("generate what is data, hand-write what is knowledge").
- `codegen/dex-registry-gen.js` — the existing forward generator; `generateDefs` is its registry→defs sibling.
