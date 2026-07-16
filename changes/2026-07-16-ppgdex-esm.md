<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [PpgDex, suite]
brief: ESM-MIGRATION-FOLLOWUPS-2026-07-16-BRIEF.md
---
PpgDex → ES modules (fan-out node 4/7) — the hardest worker surface. `ppgdex-app.js` `import`s `{ PPGDSP }` from the DSP and `{ PPGUI }` from render (repointing the clean `const DSP = window.PPGDSP, UI = window.PPGUI` capture); `ppgdex-render.js` publishes `window.evBadge = evBadge` before scoping it into the module (app + classic profile bare-call it). `ppgdex-dsp.js` + `-render.js` are DUAL-MODE; `ppgdex-morph`/`-profile`/`-cross`/`-registry` stay classic.

**The worker constraint (why this node was scheduled last).** `ppgdex-dsp.js` mints its per-channel detection pool worker at runtime from the live `Function.toString()` of a hand-maintained `deps` array + a `REFR_CADENCE_FRAC` const (`_buildWorkerURL`). Only the two module-scope `export const PPGDSP/PpgDex` were added at the very bottom — every `deps` function and the const stay classic declarations INSIDE the `(function(global){…})(window)` IIFE, so `esmTransformBody` (which only rewrites top-level import/export lines) never touches a serialized body. The two gates that pin this held green: **"PpgDex worker blob EXECUTES ≡ serial"** (evals the rebuilt blob in an empty realm, asserts worker peaks/feet/sign ≡ the serial `detectChannel`) and **"PpgDex worker source is CLOSED"** (its `^ {0,3}function` / `^ {0,3}const` extraction regexes don't match the `export const` lines at col 0). The browser-only **"PpgDex REAL Worker pool — spawns, does not throw, ≡ serial"** render-coverage gate also passed.

Marked `ppgdex-dsp.js` `type=module` in both orchestrators + re-bundled them + PpgDex. The five analysis-page workers that `importScripts` `ppgdex-dsp.js` (pat-feasibility, sensor-trio, qrs-equiv, qrs-yield, cohort) already carry the `loadScript` classicify bridge from the cohort/ecgdex steps — no new worker edits. `tools/trio-batch.mjs` + `tch-reference-validation.mjs` + `Dex-Test-Suite.html` classicify it. PpgDex keeps its deliberate node-local clock parser (no `clock.js` dep).

`computeHash` moved (`0c821837f29d → fc97929d4da9`, `manifestHash → 9c6e0297529e`) but is EXPORT-INERT BY VERIFICATION — the equiv leg reproduces byte-identical and `verify-fixtures.mjs` re-stamped the corpus-backed PpgDex fixture. `ppgdex-globals.d.ts` stays until the classic co-load path retires (Phase 4). Full local gate sequence green incl. browser lane (all-green 2594 passed, `bootSkips:[]`; GATE A/B; no-network), biome + tsc clean; smoke: PpgDex.html boots + worker-builder present, 0 page errors.
