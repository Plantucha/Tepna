/*
 * pulsedex-globals.d.ts — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * PulseDex node-scoped ambient globals for the checkJs gate (tsconfig.json). Same node-local
 * pattern as ppgdex-globals.d.ts — NOT dex-globals.d.ts, which stays SHARED-spine-only.
 * DELETE this file when the pulsedex classic co-load path is retired (ESM-MIGRATION Phase 4).
 */

//  • PulseDex — the node's OWN namespace attach (`root.PulseDex = PulseDex`). Declared (not
//    inline-cast) so the attach line stays byte-identical, and so the dual-mode module tail
//    (`export const PulseDex = window.PulseDex`) type-checks ("Property 'PulseDex' does not
//    exist on Window").
declare var PulseDex: any; // pulsedex-dsp.js — the node's public compute surface (compute, buildNodeExport, …)
