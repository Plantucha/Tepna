// hrvdex-globals.d.ts — Tepna
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// NODE-LOCAL ambient declarations for the hrvdex realm — DELIBERATELY SEPARATE from dex-globals.d.ts.
//
// hrvdex-dsp.js is a monolith-derived file: `commitRows`/`computeDerived`/`ingestGangliorJSON` call
// functions that live in its co-loaded realm SIBLINGS (hrvdex-app.js · hrvdex-render.js ·
// hrvdex-profile.js — load order dsp → render → profile → app, one shared page scope). Those names
// are NOT shared spine (unlike DexClock/DexKernel/DexUnits, which every realm co-loads) — they exist
// ONLY on an hrvdex page. Per tsconfig.json `//d2`, dex-globals.d.ts must stay shared-spine-only, so
// these per-node UI-sibling names are declared HERE instead, where they read as exactly what they are:
// a documented DSP→UI coupling specific to hrvdex, typed `any` until those UI files themselves join
// the checkJs gate (at which point the real definitions take over and this file is DELETED).
//
// This keeps the gate honest at the file level (dex-globals.d.ts is a clean roster of genuine shared
// modules) while still letting hrvdex-dsp.js enter the gate. NO runtime, NO emit, NO shipped artifact.
//
// ⚠️ Do NOT add SHARED-spine names here (they go in dex-globals.d.ts), and do NOT add another node's
// sibling names here — give each node that needs it its own <node>-globals.d.ts, so a stray cross-node
// reach stays visible in review rather than being silently absorbed into one grab-bag.

// The DSP→UI reach-ins (setStatus/setProgress/rerender/inferFromData/getProfile/calcVo2Cat) were
// INVERTED to dependency injection (ESM-MIGRATION-FOLLOWUPS-II item 3): hrvdex-dsp.js now calls its
// injected `_ui.*` hooks and no longer references any UI sibling as a bare global, so those ambient
// declarations are gone. Only the node's own permanent namespace attach remains.
declare var HRVDex: any; // hrvdex-dsp.js — the node's OWN namespace attach (`root.HRVDex`); lets the dual-mode module tail (`export const HRVDex = window.HRVDex`, ESM-MIGRATION deep-3) type-check
