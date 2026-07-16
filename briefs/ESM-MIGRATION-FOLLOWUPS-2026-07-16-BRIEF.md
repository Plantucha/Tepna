<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-07-16 (**fan-out COMPLETE — all 7 nodes ESM**: GlucoDex from Phases 0–2 + CPAPDex · ECGDex · PpgDex · PulseDex · HRVDex · OxyDex; ONLY Phase 4 — retire the classic co-load path, delete the `-globals.d.ts`, retire the source-mirror gates — remains) · **Created:** 2026-07-16

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

## Execution progress — 2026-07-16 (nodes 2–4 landed + fleet infrastructure)

Taken up as funded work. **Three nodes converted, one node per commit, each fully gated** (biome · tsc ·
`build --check` ×10 · node suite 2540 · GATE A/B · `verify-fixtures` on the real corpus · the browser
lane `Dex-Test-Suite?full` all-green + `verify-provenance` + `no-network` · a direct bundle smoke):

- **CPAPDex** (node 2) — the only node with a CJS `--selftest`/`module.exports` path; dropped it (a
  top-level `export` makes the file an ES module Node's CJS loader can't parse — `selfTest()` still runs
  in the gated suite). dsp+render+app converted; 3 vm tools + 2 `cpapdex-edf-*.html` self-test pages +
  the Dex-Test-Suite harness taught to `classicify`.
- **ECGDex** (node 3) — clean capture repoint; render publishes `window.evBadge`; the inlined
  `WORKER_SRC` template is hermetic (worker realm untouched).
- **PpgDex** (node 4) — the hard worker: the pool worker is minted from live `Function.toString()` of a
  `deps` array. Only the two module-scope `export const` were added; every `deps` fn + `REFR_CADENCE_FRAC`
  stay classic inside the IIFE, so the "worker blob EXECUTES ≡ serial" + "worker source is CLOSED" gates +
  the browser REAL-Worker gate all held.

**Reusable fleet infrastructure built (repairs a latent regression + a broken gate):**
- **Worker co-load bridge** — a classic Worker's `importScripts` SyntaxErrors on a dual-mode DSP's
  top-level `export`. The **GlucoDex (Phase 2) merge silently broke `cohort-worker.js`** (its gluco/cpap
  KINDs — ungated analysis-page worker); repaired + verified in a real Worker, and the same inline
  `loadScript` fallback (importScripts → `DexBuild.classicify` + eval; `build-core.js` is worker-safe) is
  now in all five workers (cohort · pat-feasibility · sensor-trio · qrs-equiv · qrs-yield). `tools/trio-batch.mjs`
  + `tch-reference-validation.mjs` + `cpap-corpus.mjs` + `regen-cpap-goldens.mjs` classicify their vm loads.
- **`tests/browser-gates.mjs`** — its `waitForFunction` calls passed the options object in the wrong arg
  slot, so Playwright silently used a 30 s default timeout; render-coverage (~26–30 s) raced it and the
  local browser lane was effectively unusable. Fixed → all three gates green.

**What remains (the deep 3 + Phase 4).** pulsedex/hrvdex/oxydex have **no clean DSP capture** (~70 bare
sprayed-global call sites) and **no-IIFE UI files with shared top-level mutable state** (`let welltoryData`
…) read cross-file — so their conversion means promoting mutable state to `window` + republishing ~15
functions per node (bespoke, higher-churn). Per §"Why partial completion unlocks nothing", deleting the
`-globals.d.ts` + retiring the source-mirror gates still waits on ALL nodes converting AND the classic
co-load path (orchestrators, both test runners, the five workers) being retired — which itself requires the
~70-site spray-removal. So the deep 3 are the natural next funded unit; the reference now spans a DSP with a
CJS path (CPAPDex), a hermetic-blob worker (ECGDex), and a toString-serialized worker (PpgDex).

## Execution progress II — 2026-07-16 (nodes 5–7: the deep 3 — FAN-OUT COMPLETE)

All three landed same-day, one fully-gated commit each, same gate ledger as nodes 2–4 (biome · tsc ·
`build --check` ×10 · Node suite 2512 · GATE A/B · `verify-fixtures` on the real corpus · browser lane
all-green + no-network · a `file://` bundle smoke driving synthetic → compute → painted UI):

- **PulseDex** (node 5) — set the deep-3 template: each no-IIFE UI file PUBLISHES its cross-file
  surface via `Object.assign(window, {…})` at file end (bare cross-file reads resolve through window
  at call time); shared MUTABLE state gets a `defineProperty(window, …)` get/set proxy in the
  declaring module (`welltoryData` — the brief's own example); the app's side-effect `import`s make
  the former tag-order convention a real dependency edge (killing the §load-order hazard). The
  dreaded "~70-site spray-removal" was NOT needed: the DSPs' existing `__DEX_NAMESPACED__`-guarded
  bare-spray blocks keep serving classic-style reads — sites get removed at Phase 4, not before.
- **HRVDex** (node 6) — template applied in a fraction of the time; render/profile/app publish
  12+6+8 symbols (incl. the DSP's documented `setStatus`/`rerender` UI reach-ins); chart/chartbadges
  verified self-contained and stay classic.
- **OxyDex** (node 7) — the predicted "hardest node" was template-shaped: its 6 k-line DSP was
  IIFE-wrapped all along (~45 lines of header comments hid it from the original survey). Five UI
  modules publish 7+7+5+10 symbols + a `UP` window proxy; **`oxydex-util.js` deliberately stays
  classic** (orchestrator-co-loaded before the DSP; classic globals stay visible to modules). Two
  real bugs caught by the gates: `var UP` → non-configurable window property in classic realms
  (proxy threw in the suite's worker rig; now `let`), and `tests/oxy-hang.worker.js` — a SIXTH
  worker the bridge sweep missed — importScripts'ing the dsp raw (now carries the loadScript bridge).

Every node's conversion was **export-inert BY VERIFICATION** (per-node corpus re-stamp, outputs
byte-identical). The stale-derived-artifact lesson from the nodes-2–4 PR was applied preemptively:
the 5 affected analysis tools + 3 docs deploy copies regenerated in the same unit.

**ONLY Phase 4 remains:** retire the classic co-load path (orchestrators, both test runners, the six
bridged workers), remove the DSP spray blocks (the ~70 sites), delete the seven `<node>-globals.d.ts`,
retire the source-mirror gates, flip the parent brief's P5 → DONE — then this brief goes DONE.
