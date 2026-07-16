<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [HRVDex, suite]
brief: ESM-MIGRATION-FOLLOWUPS-2026-07-16-BRIEF.md
---
HRVDex → ES modules (fan-out node 6/7, second of the deep 3) — the pulsedex template applied. `hrvdex-dsp.js` is DUAL-MODE (IIFE + `__DEX_NAMESPACED__`-guarded spray untouched; trailing `export const HRVDex = window.HRVDex` + the `/** @type {any} */` IIFE-arg cast for module top-level `this`); `hrvdex-render.js` / `-profile.js` / `-app.js` are ES modules; `-registry.js` / `-chart.js` / `-chartbadges.js` stay classic (chart/chartbadges are self-contained IIFEs — verified no load-time reach-ins; the chart file's 9 "rgba" hits are CSS string literals, not calls).

**Published surfaces** (bare cross-file reads resolve through window at call time): render → 12 symbols (`evBadge · setStatus · setWindow · switchTab · setMode · hrvNavTo · rerender · rgba · renderHistogram · renderScatterExplorer · renderWeekday · TABLE_COLS`) — note `setStatus`/`rerender` are the DSP's documented UI reach-ins (hrvdex-globals.d.ts), so the CLASSIC-loaded dsp in the orchestrators/test runners also resolves them; profile → 6 (`inferFromData · loadProfile · getProfile · updateProfile · calcVo2Cat · toggleProfilePanel`); app → 8 (`loadFile · loadPasted · exportCSV · exportJSONL · exportGanglior · clearAll · setProgress · uploadZone`). No shared MUTABLE state case (unlike pulsedex's `welltoryData`) — the two cross-file STATE consts are published by value. `hrvdex-app.js` side-effect-imports dsp → render → profile, making the shell's former tag-order convention a real dependency edge.

Marked `hrvdex-dsp.js` `type=module` in both orchestrators; `Dex-Test-Suite.html` classic-loads it in `main()` (tag → comment). `hrvdex-globals.d.ts` gains `declare var HRVDex` (the namespace attach, for the dual-mode tail) — file still slated for deletion at Phase 4. No hrvdex regen tool exists (verify-fixtures covers its corpus fixtures).

`computeHash` moved (`manifestHash 0a3ce72e6498 → 897077e78f10`) but is EXPORT-INERT BY VERIFICATION — `verify-fixtures.mjs` re-ran the suite on the real corpus and re-stamped both corpus-backed HRVDex fixtures (`verifiedUnder → 4164a7eed9dc`) with byte-identical outputs. Full local gate sequence green: biome + tsc clean · `build --check` ×10 · Node suite 2512 · GATE A 8/8 + GATE B · browser lane all-green (2564, render-coverage boots the ESM bundle) · no-network four-lens green · file:// smoke (0 page errors; namespace + all 26 published symbols present; synthetic → compute → 32 table rows painted).
