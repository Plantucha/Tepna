<!--
  REGISTRY-INVERSION-2026-07-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->

**Status:** PROPOSED · **Created:** 2026-07-03

# Registry inversion — manifests become the SOLE source; registries become build artifacts

> **What this is.** An implementation brief for an AI coder. **One thesis:** metric METADATA
> (label · unit · goodDirection · depth · evidence · cite · aliases) should be *generated, never
> hand-written* — the codegen path already proves this for EEGDex
> (`codegen/dex-registry-gen.js` → `codegen/generated/eegdex-registry.js`, born gate-compliant).
> The 7 shipped nodes still carry **hand-written registries with manifests sitting alongside** —
> a drift pair per node — and each registry is additionally hand-mirrored against its envelope
> `*_DEFS` (the `oxydex-registry.js` head literally says *"keep label/unit/goodDirection identical
> to oxydex-cross.js OXY_DEFS"*). Invert it: enrich each manifest until it holds ALL the registry's
> knowledge, flip generation on, and add a `--check` drift guard so a hand-edited registry can
> never ship again. This retires most of what `cohesion-badges` reconciles, the same way
> `OWN-THE-BUILD` retires the ledger toil — construction-enforcement over drift-suppression.
>
> **What this is NOT:** no DSP is generated, ever (`ARCHITECTURE-PRINCIPLES` §1 — signal math is
> hand-written domain knowledge; see the "generate what is data, hand-write what is knowledge"
> line). No metric is added, removed, re-graded, or re-labeled by this pass. **Zero semantic
> change** is the acceptance bar.

---

## 0. Ground truth — read before writing a line

- **`codegen/dex-registry-gen.js`** — the generator. Already validates evidence against the
  5-level ladder, rejects `RETIRED_EVIDENCE`, throws on missing/duplicate ids, and emits the live
  registry contract (`<NODE>_REGISTRY` map + `<Node>Registry` resolver + alias map), byte-faithful
  to `ecgdex-registry.js`'s shape. **Extend it; do not fork it.**
- **`codegen/manifests/*.manifest.json`** — 7 manifests exist (oxydex, pulsedex, hrvdex, ecgdex,
  ppgdex, glucodex, eegdex; cpapdex has manifest + docs-draft). They are RICH on formulas/ranges/
  compute specs but **behind** the hand registries on the fields that matter here.
- **One hand registry vs its manifest** — e.g. `oxydex-registry.js` `odi4.cite` carries the
  post-v22.36 under-count caveat; `codegen/manifests/oxydex.manifest.json` `odi4` does not.
  **The hand registry is the CURRENT test-backed truth source** (`CLAUDE.md` §🎫: doc conforms to
  registry). Inversion therefore runs registry → manifest FIRST, generation second.
- **`<node>-cross.js` `*_DEFS`** — the envelope's self-describing defs, hand-kept identical to the
  registry (the second mirror). In scope as Phase 4 (optional), out of scope before that.
- **`tests/dex-tests.js`** — the resolver signatures (`idForLabel` / `badgeForLabel` /
  `depthForLabel`) and the `cohesion-badges` group are the contract the generated output must
  satisfy unchanged.
- **`briefs/OWN-THE-BUILD-2026-06-30-BRIEF.md`** — the sequencing dependency (see §3 and Risks).

## 1. Why (accuracy · maintenance · data fidelity)

- **Accuracy:** one fact, one place. Today a grade or unit lives in up to FOUR places (registry,
  manifest, `*_DEFS`, reference guide); `cohesion-badges` catches registry↔guide↔css drift but
  nothing gates registry↔manifest or registry↔DEFS. After inversion there is nothing left to
  reconcile — the projection cannot disagree with its source.
- **Maintenance:** editing a metric becomes a one-file JSON edit + regenerate; the generator's
  validation (ladder, retired vocabulary, duplicate ids) runs on every edit instead of only at
  new-node scaffold time.
- **Data fidelity:** the migration itself is the hazard (see Risks) — the hand registries have
  accreted caveats and citation nuance the manifests lack. Phase 1 exists to move that knowledge
  INTO the manifests **losslessly**, with a field-by-field parity gate proving nothing fell out.

## 2. Design

1. **Manifest is the single source** for every field the registry projects: per metric
   `{ id, abbr/name/fullName, tier, unit, goodDirection, evidence, cite, aliases }` +
   section-level `metaDeny`. The generator's existing schema — no new dialect.
2. **Generated `<node>-registry.js` is a committed build artifact** (same model as bundles under
   `OWN-THE-BUILD`): committed for the 100%-local runtime, but never hand-edited. Header comment
   states `GENERATED from codegen/manifests/<node>.manifest.json — do not edit; edit the manifest
   and regenerate`. SPDX header preserved by the generator.
3. **Drift guard** — `node codegen/check-registries.mjs`: for every node with `generated: true`
   in a small `codegen/GENERATED-REGISTRIES.json` set, regenerate in memory and diff against the
   committed file; non-zero exit on drift. Wire into `tests.yml` CI and as a `tests/dex-tests.js`
   group (env-fed, both runners — house pattern). A hand edit to a generated registry now turns
   the suite red.
4. **Nodes join the set one at a time** (opportunistic-migration rule, `ARCHITECTURE-PRINCIPLES`
   §7). Unmigrated nodes stay covered by `cohesion-badges` exactly as today.

## 3. Phases — registry→manifest first, flip second, one node per pass

- **Phase 0 — parity audit (½ day, no commits).** For each node: run `generateRegistry(manifest)`
  in memory, parse both it and the hand registry, and diff **semantically** (field-by-field per
  metric id — not bytes). Output one delta table per node: metrics missing from the manifest,
  fields where the registry is richer (expect `cite`), fields where the manifest is richer or
  *disagrees* (each disagreement is a finding — resolve deliberately, registry wins unless a human
  says otherwise). This table is the whole risk register for the pass.
- **Phase 1 — enrich the manifest (per node, ~½ day each).** Port every registry fact into the
  manifest until the semantic diff is EMPTY. Adds `evidence`/`goodDirection`/`cite`/`aliases`
  where missing. Nothing else in the manifest (formulas, ranges, compute) is touched.
- **Phase 2 — flip the source (per node).** Commit the generated registry over the hand one
  (git preserves the old bytes; no `.bak` files), add the node to `GENERATED-REGISTRIES.json`,
  drift guard green. The resolver contract and `cohesion-badges` must pass UNCHANGED — if an
  assertion needs editing, the flip changed semantics: stop and fix the manifest, never the test.
- **Phase 3 — re-bundle + ledgers (per node).** The registry ships inside the bundle, and the
  generated file will differ in bytes (formatting) even at semantic parity → `manifestHash`
  moves → GATE-A entry update + fixture handling per the `CLAUDE.md` re-bundle checklist. The
  equiv legs (`env.equiv.*`) gate that no EXPORT content moved — at true semantic parity they stay
  green and fixtures need no regeneration unless exports embed registry text (check OxyDex first).
  **Strongly prefer sequencing after `OWN-THE-BUILD` Part A lands** — then this whole phase is
  `node tools/build.mjs --all` instead of hand-ledger work × 7. If Part A is not landed, migrate
  ONE node (OxyDex) end-to-end to price the manual cost before deciding to continue or wait.
- **Phase 4 (OPTIONAL, own gated pass) — generate `*_DEFS` too.** The envelope defs share
  label/unit/goodDirection with the registry; emit them from the same manifest
  (`generateDefs(manifest)`) and delete the second hand mirror. Touches `*-cross.js` → full
  behavior gate + re-bundle. Do not fold into Phases 0–3.

**Total (Phases 0–3, all 7 nodes): ~4–6 focused days after OWN-THE-BUILD; +~2 days of ledger toil
without it.**

## Honesty / risks

- **Cite-richness loss is the one real data-fidelity hazard.** The hand registries carry evolved
  clinical caveats (the ODI-4 note is load-bearing user-facing honesty). Phase 0's semantic diff +
  Phase 1's empty-diff bar exist precisely so no caveat is silently flattened to a generator
  default. Never let `cite` fall back to `fullName` for a metric whose hand registry had more.
- **Byte churn without semantic change.** Phase 3 moves every migrated bundle's `manifestHash` for
  a formatting-level change. That is honest (code identity did change) but pure toil under the
  hand-ledger regime — the reason for the OWN-THE-BUILD sequencing preference.
- **The manifest becomes a contract → guard it.** The generator already throws on breaches; keep
  it that way, and add any new field validation there (one validator), not in consumers.
- **Registry-only scope.** If Phase 0 reveals a render file reading something from the registry
  the manifest can't express, STOP on that node and record it — do not grow the manifest schema
  ad hoc mid-pass.

## Done when

- ☐ Phase 0 delta tables committed (in this brief's follow-up or as `codegen/PARITY-AUDIT.md`).
- ☐ Per migrated node: manifest semantically ⊇ old hand registry (empty diff), generated registry
  committed, node in `GENERATED-REGISTRIES.json`, drift guard + `cohesion-badges` +
  `Dex-Test-Suite.html?full` green, GATE A/B green after re-bundle.
- ☐ `check-registries.mjs` in CI; a hand edit to any generated registry reds the suite (prove once
  with a temp edit).
- ☐ All 7 nodes migrated — or a documented stop-point naming which nodes remain and why.
- ☐ `DOCS-INDEX.md` row added; `CLAUDE.md` §🎫 updated ("grade source of truth" → the manifest,
  projected into the registry); follow-up brief spawned per the house pattern, or the header says
  nothing surfaced.

## Expected follow-up

Phase 0 will surface genuine disagreements between manifests and registries (both were hand-fed);
each resolution is a small finding worth recording. Phase 4 (`*_DEFS` generation) and reference-
guide regeneration for the old nodes (`dex-gen.js` on the enriched manifests, replacing the
hand-maintained guides) are natural successors once the manifests are trustworthy.

---

## Cross-references
- `codegen/dex-registry-gen.js` · `codegen/manifests/*.json` · `codegen/generated/eegdex-registry.js`
  — the existing forward-first machinery this brief turns backward onto the fleet.
- `briefs/OWN-THE-BUILD-2026-06-30-BRIEF.md` — sequencing dependency (Phase 3) + shared philosophy.
- `briefs/SYSTEM-COHESION-BRIEF.md` · `CLAUDE.md` §🎫 — the metric contract + `cohesion-badges`
  gate this pass partially retires.
- `ARCHITECTURE-PRINCIPLES.md` §1/§3/§7 — layer rules, contracts, opportunistic migration.
- `briefs/DOCS-LEDGER-GATE-2026-07-03-BRIEF.md` — sibling "convention → gate" pass for docs.
