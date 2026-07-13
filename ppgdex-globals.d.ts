// ppgdex-globals.d.ts — Tepna
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// NODE-LOCAL ambient declarations for the ppgdex realm — SEPARATE from dex-globals.d.ts (which is
// SHARED-spine-only, per tsconfig.json `//d2`).
//
//  • PPGDSP / PpgDex — the node's OWN namespace attaches (`global.PPGDSP = {…}`,
//    `global.PpgDex = global.PpgDex || {…}`). Declared (not inline-cast) so the attach lines stay
//    byte-identical for the ppgLoadOwnExport source-text safety gate (dex-tests.js:8877) — same rule
//    as glucodex/ecgdex/cpapdex (see tsconfig `//d2`).
//  • PPGMorph — a CONSUMED co-loaded sibling (ppgdex-morph.js), reached through a guarded
//    `if (global.PPGMorph)` optional-load check. ppgdex-only, so it lives here.
//  • BigInt — the ES2020 global (used to parse Polar sensor nanosecond stamps that exceed Number's
//    safe range). This gate's `lib` is ES2017 (browser-first, minimal), so tsc can't see BigInt.
//    Declared `any` here rather than bumping the fleet-wide `lib` to ES2020 — a localized, additive
//    fix consistent with the node-builtin handling in cpapdex-globals.d.ts. PROMOTE to a shared
//    runtime-builtins.d.ts if a second gated module needs BigInt.
//
// NO runtime, NO emit, NO shipped artifact — a dev-time type artifact only.

declare var PPGDSP: any; // ppgdex-dsp.js — the DSP toolkit namespace (parsePPG, analyze, validatePPI, …)
declare var PpgDex: any; // ppgdex-dsp.js — the node's public compute surface (compute, buildNodeExport, …)
declare var PPGMorph: any; // ppgdex-morph.js — optional co-loaded morphology analyzer (guarded reach)
declare var BigInt: any; // ES2020 global — Polar ns-stamp parsing; ES2017 lib in this gate omits it
