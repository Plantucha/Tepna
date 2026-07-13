// cpapdex-globals.d.ts — Tepna
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// NODE-LOCAL ambient declarations for the cpapdex realm — SEPARATE from dex-globals.d.ts (which is
// SHARED-spine-only, per tsconfig.json `//d2`).
//
// Two kinds of declaration, both typed `any`:
//
//  1. cpapdex realm globals (attached to / read off the co-loaded `root`):
//     • CpapDsp / CPAPDex — the node's OWN namespace attaches (`root.CpapDsp = api`,
//       `root.CPAPDex = root.CPAPDex || {…}`). Declared (not inline-cast) so the attach lines stay
//       byte-identical for the source-text safety gates in tests/dex-tests.js — same rule as
//       glucodex-/ecgdex-globals.d.ts (see tsconfig `//d2`).
//     • CpapEdf / CPAPCross / CpapFusion — CONSUMED co-loaded siblings (cpapdex-edf.js /
//       cpapdex-cross.js / cpapdex-fusion.js), each reached through a guarded `root && root.X`
//       optional-load check. Not shared spine (cpapdex-only), so they live here.
//
//  2. Node CLI/require builtins — `require` and `process`. NOT cpapdex-specific: they are genuinely
//     global Node runtime builtins, used ONLY inside defensive `typeof require/process !== 'undefined'`
//     guards (the CommonJS dual-load of cpapdex-edf/-cross, and the `--selftest` CLI block). checkJs
//     ships no @types/node by design (this gate is browser-first), so tsc can't see them. A single
//     ambient `any` here is cleaner + safer than casting each of the ~7 guarded sites (which would mean
//     nested `/** @type {any} */(globalThis).require` casts inside every `typeof` check). NOTE: for a
//     ONE-OFF Node-builtin reference the house idiom is still the localized cast
//     (`/** @type {any} */(globalThis).process`, as event-coupling.js does); declare here only because
//     cpapdex has many at module scope. PROMOTE these two to a shared node-builtins.d.ts the moment a
//     SECOND gated module needs them, and drop them from this cpapdex-scoped file.
//
// NO runtime, NO emit, NO shipped artifact — a dev-time type artifact only.

declare var CpapDsp: any; // cpapdex-dsp.js — the DSP api namespace (compute, buildSession, …)
declare var CPAPDex: any; // cpapdex-dsp.js — the node's public compute surface (compute, buildNightFromSets, …)
declare var CpapEdf: any; // cpapdex-edf.js — optional co-loaded EDF reader (guarded reach)
declare var CPAPCross: any; // cpapdex-cross.js — optional co-loaded longitudinal cross-night block (guarded reach)
declare var CpapFusion: any; // cpapdex-fusion.js — the shared node-export builder (cpapBuildExport)

// Node CommonJS require — declared so `typeof require` type-checks (no @types/node in this gate). The
// two require CALL sites are ADDITIONALLY cast `(/** @type {any} */(require))('./x')` in source: a bare
// `require('./cpapdex-cross.js')` makes tsc resolve + check that sibling as a module, which cascades
// TS2306 through the untyped IIFE globals it loads. The cast breaks tsc's require-call recognition
// while leaving the bare `require` intact at runtime (Node needs the module-local binding).
declare var require: any;
declare var process: any; // Node process — guarded (`typeof process !== 'undefined'`), CLI --selftest block only
