// oxydex-globals.d.ts — Tepna
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// NODE-LOCAL ambient declarations for the oxydex realm — SEPARATE from dex-globals.d.ts (which is
// SHARED-spine-only, per tsconfig.json `//d2`). All oxydex-only, all typed `any`.
//
// Two groups:
//  1. Co-loaded realm SIBLINGS that oxydex-dsp.js reaches by bare name — each defined in another
//     oxydex file, not shared spine:
//       UP · renderAll            → oxydex-render.js
//       showError                 → oxydex-app.js
//       upVO2category             → oxydex-profile.js
//       safeStyle · safeSet · safeEl · escHTML · computeCeilingBaselineArr → oxydex-util.js
//     (oxydex's own public object is attached via `root.OxyDex = OxyDex` and does NOT error — `root`
//      is not Window-typed at that site — so no OxyDex/OXYDSP declaration is needed here.)
//  2. Window-scoped app/review STATE globals oxydex-dsp.js reads and writes (`window._csvParseErrors`,
//     `window._oxyReview`). Declared so `window.<name>` resolves; the read/write sites stay byte-stable.
//
// NO runtime, NO emit, NO shipped artifact — a dev-time type artifact only.

declare var UP: any; // oxydex-render.js — render state/namespace
declare var renderAll: any; // oxydex-render.js — full re-render
declare var showError: any; // oxydex-app.js — error surface
declare var upVO2category: any; // oxydex-profile.js — VO₂max fitness-category classifier
declare var safeStyle: any; // oxydex-util.js — DOM style-safety helper
declare var safeSet: any; // oxydex-util.js — DOM text/attr-safety helper
declare var safeEl: any; // oxydex-util.js — element lookup helper
declare var escHTML: any; // oxydex-util.js — HTML escape
declare var computeCeilingBaselineArr: any; // oxydex-util.js — ceiling-baseline series helper

declare var _csvParseErrors: any; // window state — accumulated CSV parse diagnostics
declare var _oxyReview: any; // window state — self-ingest review-mode payload
