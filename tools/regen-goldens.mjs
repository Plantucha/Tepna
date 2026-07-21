#!/usr/bin/env node
/*
 * tools/regen-goldens.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * Unified entry for the per-node golden regenerators (CPAP-REAL-CORPUS-FOLLOWUPS-III §3). Dispatches
 * to the node's recipe (regen-<node>-goldens.mjs), which shares all scaffolding via regen-goldens-core.mjs.
 * The per-node names remain valid entry points (referenced by CLAUDE.md / docs); this is the one-command
 * front door that replaces "remember which node's tool is called what".
 *
 *   node tools/regen-goldens.mjs --node CPAPDex            # regenerate + re-record + report what moved
 *   node tools/regen-goldens.mjs --node GlucoDex --check   # report only, write nothing (CI-safe)
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
const NODES = {
  CPAPDex: './regen-cpap-goldens.mjs',
  GlucoDex: './regen-glucodex-goldens.mjs',
  PulseDex: './regen-pulsedex-goldens.mjs',
  MotionDex: './regen-motiondex-goldens.mjs',
  OxyDex: './regen-oxydex-goldens.mjs',
  PpgDex: './regen-ppgdex-goldens.mjs'
};

const i = process.argv.indexOf('--node');
const name = i !== -1 ? process.argv[i + 1] : null;
if (!name || !NODES[name]) {
  console.error(`usage: node tools/regen-goldens.mjs --node <${Object.keys(NODES).join('|')}> [--check]`);
  process.exit(2);
}
// The recipe reads process.argv for --check itself; importing it runs the regeneration.
await import(NODES[name]);
