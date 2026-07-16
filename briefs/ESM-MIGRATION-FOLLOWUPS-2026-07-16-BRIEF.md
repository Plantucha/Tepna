<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED (parked 2026-07-16 — the fleet fan-out is bespoke per-node work; its payoff needs completion) · **Created:** 2026-07-16

# ESM migration — follow-ups: the fleet fan-out is parked (why, and the path to finish it)

Spawned from `ESM-MIGRATION-2026-07-15-BRIEF.md` after **Phases 0–2 landed** (GlucoDex fully migrated to
ES modules — UI + DSP — plus the reusable co-load bridge). Phase 0's spike cleared the inliner wall;
Phase 1 converted GlucoDex's UI modules; Phase 2 converted its DSP to dual-mode ESM and built the generic
bridge. **Phase 3 (fan out the remaining 6 nodes) is PARKED** — on inspection it is *not* the "mechanical"
sweep the parent brief anticipated, and its debt-reduction payoff cannot land until it is **complete**.

## What is DONE and reusable (the reference implementation)

- **GlucoDex** is the fully-migrated reference: `glucodex-{render,app,profile}` are ES modules, `glucodex-dsp`
  is dual-mode ESM (exports for the bundle's app + `window` attaches for classic consumers), all gated.
- **The bridge is generic and fleet-ready** — `DexBuild.esmBundle` (import-graph → per-file classic blocks
  via a shared module registry, names preserved so `computeHash`'s denylist stays precise) and
  `DexBuild.classicify` (sheds top-level `import`/`export` for the raw classic loaders: the vm test realm in
  `tests/run-tests.mjs` `loadInto`, `tools/regen-*`, and `Dex-Test-Suite.html`'s harness; no-op on classic
  files). The orchestrators consume a converted DSP via `type=module`.

## Why the fan-out is bespoke, not batchable (per-node blockers, mapped 2026-07-15/16)

| Node | Blocker |
| --- | --- |
| oxydex · hrvdex · pulsedex | DSP consumption is **indirect/sparse** — no clean `const DSP = window.<NS>` capture (unlike GlucoDex/ECGDex); the namespace surfaces only at defensive augmentation sites (`reviewView`/`scrubExport`). No load-bearing import edge without a deeper refactor. |
| pulsedex (also) | `pulsedex-render` / `pulsedex-overview` have **no IIFE** — bare top-level global functions; converting them to modules scopes those functions away, breaking bare-global callers (needs per-function `window`-publishing). |
| ecgdex · ppgdex | Both build a **Web Worker from an inlined blob** (parent brief flagged ppgdex; ecgdex has one too) — converting the DSP risks the worker source; the worker realm is the hardest ESM surface. |
| cpapdex | `edf` / `fusion` / `cross` modules; **not orchestrator-co-loaded** — a different co-load surface. |
| all | **Load-order hazard:** converting *only* a DSP defers it to its importer's trigger, but the classic `render` loaded between the DSP and app may read `window.<NS>` at load. GlucoDex only dodged this because its *entire* UI converted together. |

**Corollary — a DSP-only conversion is negative-value:** it adds a **dead `export`** (nobody imports it, so
the bridge just strips it back for every consumer) while moving `computeHash` → a needless corpus re-verify.
The only safe conversion is the **full GlucoDex treatment (UI + DSP together) per node**.

## Why partial completion unlocks nothing

The P5 debt-reduction — delete each `<node>-globals.d.ts`, retire the P4-hardened **source-mirror gates** —
only lands once a DSP's *classic consumers are gone*. But the orchestrators + **both test runners load every
DSP**, and a DSP keeps its `window` attaches (hence its ambient `.d.ts`) until those classic loaders no longer
need it. So no `-globals.d.ts` can be deleted until the fan-out is **complete AND the classic co-load path is
retired**. A half-migrated fleet is pure cost (churn + a mixed model) with zero debt paid down.

## Path to finish (when it's worth the investment)

Do it as **dedicated per-node work, one node fully at a time** (NOT a batch), each mirroring GlucoDex:
1. Convert the node's UI (`render`/`app`/`profile`/…) **and** DSP together (whole-UI conversion avoids the
   load-order hazard); for no-IIFE files (`pulsedex-render`/`-overview`), publish each consumed function to
   `window` before scoping it into a module.
2. `type=module` the node's modules in its `.src.html`; `type=module` its DSP in the orchestrators;
   extend `Dex-Test-Suite.html`'s classicify list + any `tools/regen-<node>-goldens.mjs`.
3. Re-bundle the node + both orchestrators; re-verify fixtures on the corpus (present locally for every node).
4. Changeset per node. **ppgdex LAST** (worker realm), **ecgdex** carefully (worker).
5. **Only after ALL nodes convert AND the classic co-load path is retired:** delete the `-globals.d.ts`
   files, retire the now-redundant source-mirror gates, flip the parent brief's P5 to DONE (Phase 4).

**Recommendation:** leave parked until the full fleet migration is a funded work-item — the reference +
bridge make it low-*risk* but it is not low-*effort*, and nothing is unlocked before it completes.
