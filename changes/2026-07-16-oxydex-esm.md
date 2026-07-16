<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [OxyDex, suite]
brief: ESM-MIGRATION-FOLLOWUPS-2026-07-16-BRIEF.md
---
OxyDex → ES modules (fan-out node 7/7 — the LAST node; every Dex is now ESM). The follow-ups brief's "hardest node" turned out template-shaped: `oxydex-dsp.js` was already IIFE-wrapped (the namespaced build — its 6 k lines hide the IIFE behind ~45 header-comment lines, which is what mis-read as "bare top-level"), so it takes the standard DUAL-MODE treatment (trailing `export const OxyDex = window.OxyDex` + the IIFE-arg cast; its `allNights` mutable proxy already existed). `oxydex-profile.js` / `-dsp.js` / `-render.js` / `-fusion.js` / `-app.js` are ES modules (shell order preserved: profile → dsp → render → fusion → app, made a real edge by app's four side-effect imports). **`oxydex-util.js` deliberately stays CLASSIC** — it is co-loaded raw by the orchestrators/test runners BEFORE the DSP, and a classic file's globals stay visible to modules, so it needs no publish block and no orchestrator churn; `-registry.js` / `-cross.js` classic too.

**Published surfaces:** render → 7 (`renderAll · evBadge · setGCWindow · setGCSmooth · toggleDetail · jumpToNight · metric`); fusion → 7 (`_oxyEcgDate · oxyEcgForNight · oxyHeroBenchCard · oxyComputeFusion · oxyEcgFusionSection · buildFullMetricsTable · oxyFrontFullTable`); profile → 5 + the **`UP` window proxy**; app → 10 (`setProgress · setStatus · showError · reset · addMoreFiles · clearAll · oxySetScrub · exportJSON · exportCSV · downloadParser` — incl. the DSP's documented reach-ins).

**Two real bugs found by the gates (the reason the gates exist):** (1) `UP` was `var` — in the CLASSIC co-load realms a top-level `var` creates a NON-configurable window property, so the module-side `defineProperty(window,'UP')` proxy threw "Cannot redefine property: UP" in the suite's real-stack worker rig; changed to `let` (lexical binding — classic readers still resolve it, the proxy cleanly owns the window property). (2) `tests/oxy-hang.worker.js` — a SIXTH worker the cohort-bridge sweep missed — `importScripts`'d the dsp raw and SyntaxError'd on `export`; it now carries the same marker-wrapped `loadScript` classicify bridge as the five analysis workers.

Marked `oxydex-dsp.js` `type=module` in both orchestrators; `Dex-Test-Suite.html` classic-loads it in `main()`; `oxydex-globals.d.ts` gains `declare var OxyDex` (delete at Phase 4). `computeHash` moved but is EXPORT-INERT BY VERIFICATION — both corpus-backed OxyDex summaries re-stamped (`verifiedUnder → cb321fa2d398`) byte-identically. Full gate sequence green: biome + tsc · `build --check` ×10 · Node suite 2512 · GATE A 8/8 + GATE B · browser lane all-green 2564 (incl. the previously-red worker rig) · no-network · file:// smoke (0 errors; UP proxy live; synthetic → 3 nights processed → hero painted).

**Fan-out COMPLETE (7/7).** What remains is Phase 4 only: retire the classic co-load path (orchestrators, both test runners, the six bridged workers), delete the seven `<node>-globals.d.ts`, retire the source-mirror gates, flip the parent brief's P5 → DONE.
