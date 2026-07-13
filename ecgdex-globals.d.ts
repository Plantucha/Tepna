// ecgdex-globals.d.ts — Tepna
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// NODE-LOCAL ambient declarations for the ecgdex realm — SEPARATE from dex-globals.d.ts (which is
// SHARED-spine-only, per tsconfig.json `//d2`).
//
// Two kinds of ecgdex-local global, both typed `any`:
//  • ECGDSP / ECGDex — the node's OWN namespace attaches (`global.ECGDSP = {…}`,
//    `global.ECGDex = global.ECGDex || {…}`). Declared (not inline-cast) ON PURPOSE: the source-text
//    safety gates in tests/dex-tests.js slice `ecgLoadOwnExport`'s body on the VERBATIM attach marker
//    (`esrc.indexOf('global.ECGDex = global.ECGDex')` @ dex-tests.js:8581), so an inline cast that
//    rewrites the attach line collapses the gate. Declaring keeps the attach byte-identical. (Same rule
//    as glucodex-globals.d.ts — see tsconfig `//d2`.)
//  • ECGMorph — a CONSUMED co-loaded sibling (ecgdex-morph.js), reached through a guarded
//    `if (global.ECGMorph)` optional-load check. Not shared spine (ecgdex-only), so it lives here.
//
// The checkJs gate's value is each module's OWN logic, not re-typing these node surfaces. NO runtime,
// NO emit, NO shipped artifact — a dev-time type artifact only.

declare var ECGDSP: any; // ecgdex-dsp.js — the DSP toolkit namespace (analyze, bandpass, detectPeaks, …)
declare var ECGDex: any; // ecgdex-dsp.js — the node's public compute surface (compute, buildNodeExport, …)
declare var ECGMorph: any; // ecgdex-morph.js — optional co-loaded morphology analyzer (guarded reach)
