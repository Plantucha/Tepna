// glucodex-globals.d.ts — Tepna
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// NODE-LOCAL ambient declarations for the glucodex realm — SEPARATE from dex-globals.d.ts (which is
// SHARED-spine-only, per tsconfig.json `//d2`).
//
// glucodex-dsp.js attaches its two public namespaces to the co-loaded root: `global.GLUDSP = {…}`
// (the DSP toolkit) and `global.GlucoDex = {…}` (the node's public compute surface). Under checkJs the
// IIFE root `global` is typed `Window & typeof globalThis`, so those attaches read as TS2339
// ("Property 'GlucoDex' does not exist on Window").
//
// These names are declared here rather than inline-cast (`/** @type {any} */(global).GlucoDex = …`) ON
// PURPOSE: a family of source-text SAFETY gates in tests/dex-tests.js slices each node's
// `<node>LoadOwnExport` body on the VERBATIM attach marker (e.g. `gsrc.indexOf('global.GlucoDex =
// global.GlucoDex')` at dex-tests.js:8464). An inline cast rewrites that line and the marker vanishes,
// collapsing the gate. Declaring the name keeps the attach byte-identical, so the safety gate still
// finds its boundary. (This is the general rule for every DSP's own `global.<Node> = global.<Node>`
// namespace attach — cpapdex/ecgdex/ppgdex carry the same marker-based gates.)
//
// Typed `any`: the checkJs gate's value is each module's OWN logic, not re-typing the node's public
// namespace surface. NO runtime, NO emit, NO shipped artifact — a dev-time type artifact only.

declare var GLUDSP: any; // glucodex-dsp.js — the DSP toolkit namespace (parseCSV, analyze, genSynthetic, …)
declare var GlucoDex: any; // glucodex-dsp.js — the node's public compute surface (compute, buildNodeExport, …)
