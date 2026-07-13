// integrator-globals.d.ts — Tepna
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// NODE-LOCAL ambient declarations for the Integrator (Ganglior fusion layer) realm — SEPARATE from
// dex-globals.d.ts (which is SHARED-spine-only, per tsconfig.json `//d2`).
//
//  • IntegratorDSP — the fusion layer's OWN namespace attach (`window.IntegratorDSP = {…}`). Declared
//    (not inline-cast) to keep the attach line byte-stable for any source-text gate — same rule as the
//    other DSPs (see tsconfig `//d2`).
//  • IntegratorTCH — the optional temporal-consensus engine (a co-loaded sibling), reached through a
//    guarded `typeof IntegratorTCH!=='undefined' || window.IntegratorTCH` optional-load check.
//  • GangliorProvenance — the optional provenance-stamp sibling (ganglior-provenance.js), reached via a
//    guarded `window.GangliorProvenance ? GangliorProvenance.stamp() : null`.
//
// All three are Integrator-realm-only (not shared spine), so they live here. Typed `any` — the gate's
// value is the module's own fusion logic. NO runtime, NO emit, NO shipped artifact.

declare var IntegratorDSP: any; // integrator-dsp.js — the fusion layer's public surface
declare var IntegratorTCH: any; // optional temporal-consensus engine (guarded co-load)
declare var GangliorProvenance: any; // ganglior-provenance.js — optional provenance stamp (guarded co-load)
