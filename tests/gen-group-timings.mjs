#!/usr/bin/env node
/*
 * gen-group-timings.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 */
/* ════════════════════════════════════════════════════════════════════════
   tests/gen-group-timings.mjs — refresh tests/group-timings.json
   ────────────────────────────────────────────────────────────────────────
       node tests/run-tests.mjs --json | node tests/gen-group-timings.mjs

   Feeds the CI shard planner (tests/shard-plan.mjs) measured per-group wall
   times so it can balance the shards. This file is a HINT, not a contract:

     · a group missing from it still runs (median weight, still exactly one shard);
     · a stale time makes CI slower, never wrong.

   So it is NOT gate-backed and NOT required to be current — refresh it when the
   shard balance visibly skews (run-tests --timings shows you the truth), not on
   every commit. Absolute ms are machine-specific; only their RATIO matters to the
   planner, so a table recorded on any one machine balances fine on the runner.
   ════════════════════════════════════════════════════════════════════════ */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'group-timings.json');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let j;
  try {
    j = JSON.parse(raw);
  } catch (e) {
    console.error('✗ stdin is not the JSON from `run-tests.mjs --json`: ' + e.message);
    process.exit(2);
  }
  if (!j || !Array.isArray(j.groups) || !j.groups.length) {
    console.error('✗ no groups in input — pipe a FULL run: node tests/run-tests.mjs --json | node tests/gen-group-timings.mjs');
    process.exit(2);
  }
  if (j.shard || j.groupFilter) {
    console.error('✗ refusing to record a PARTIAL run (shard/filter set) — the planner needs every group. Run unfiltered.');
    process.exit(2);
  }
  const groups = {};
  for (const g of j.groups.sort((a, b) => a.index - b.index)) {
    if (typeof g.ms === 'number' && isFinite(g.ms)) groups[g.title] = g.ms;
  }
  const totalMs = Object.values(groups).reduce((a, b) => a + b, 0);
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        _comment:
          'Per-group wall times (ms) — a HINT for the CI shard planner (tests/shard-plan.mjs). Stale/missing entries degrade shard BALANCE only, never coverage. Regenerate: node tests/run-tests.mjs --json | node tests/gen-group-timings.mjs',
        totalMs,
        groupCount: Object.keys(groups).length,
        groups
      },
      null,
      2
    ) + '\n'
  );
  console.log(`✓ ${OUT} — ${Object.keys(groups).length} groups · ${(totalMs / 1000).toFixed(1)} s total`);
});
