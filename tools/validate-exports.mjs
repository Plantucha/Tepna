#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * validate-exports.mjs — run the SHIPPED `validateNodeExport()` over every committed node export.
 * ----------------------------------------------------------------------------
 * `EXPORT-HARDENING-FOLLOWUP` §4 says the validator exists but "the other nodes still do not validate
 * on export", and asks for a decision: leave it, or re-bundle so source == bundles.
 *
 * Before costing either, one question decides the priority: **would export-time validation actually
 * catch anything?** Nobody had asked. This runs the real validator — loaded from
 * `crossnight-envelope.js`, not reimplemented — over every `ganglior.node-export` in `uploads/`,
 * including the trio corpus.
 *
 * ── WHAT THE SWEEP FOUND (2026-08-03) ───────────────────────────────────────────────────────────
 *
 * 98 exports scanned · **0 failing** · 2 with warnings. So wiring per-node export-time validation
 * would have caught nothing on the committed corpus — it is belt-and-braces, not a live defect, and
 * §4 should be prioritised accordingly. The Integrator already validates every node export on INGEST
 * (`integrator-app.js:123`), which is the boundary fusion actually depends on.
 *
 * The two warnings are worth more than the clean bill, because BOTH are defects in the VALIDATOR
 * rather than in the exports it flagged:
 *
 *   1. MotionDex emits `schema.version: 1` — a NUMBER — where every other node emits `"2.0"`. The
 *      message fired is "schema.version missing", which is wrong: the field is present, just not a
 *      string. Worse, the very next check (unknown-major) is guarded by
 *      `typeof s.version !== 'string' || …`, so the numeric form SHORT-CIRCUITS PAST the warning that
 *      exists to catch an unrecognised major version. A node could ship `version: 9` and be waved
 *      through. (MotionDex being on v1 at all is a separate, real contract gap.)
 *
 *   2. `cpapdex_synthetic_multinight_golden` is warned for having no `recording.startEpochMs` and no
 *      `ganglior_events[]` — but it declares `schema.multiNight: true` and carries `nights[]` (3
 *      entries) with `recording: null` by design. The validator has no notion of the multi-night
 *      shape, so it complains about an export that is correctly formed.
 *
 * So across 98 exports the validator's only two complaints are about itself — which sharpens §4's
 * answer: wiring export-time validation TODAY would emit two spurious warnings and zero true ones.
 *
 * ── WHY THIS REPORTS RATHER THAN GATES ──────────────────────────────────────────────────────────
 *
 * Both fixes above touch modules that are inlined into several bundles, so they serialize against
 * in-flight bundle work (`CLAUDE.md` §👥.3). The sweep itself touches nothing and can run any time.
 *
 * USAGE  node tools/validate-exports.mjs [--dir uploads] [--strict]
 *        --strict → exit 1 if any export FAILS (warnings never fail)
 * ════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = new URL('..', import.meta.url).pathname;
const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const DIR = path.resolve(ROOT, opt('--dir', 'uploads'));
const STRICT = argv.includes('--strict');

if (!fs.existsSync(DIR)) {
  console.log(`no such directory: ${DIR}  (uploads/ is gitignored — pass --dir)`);
  process.exit(0);
}

/* The REAL validator, loaded from the shipped module. Reimplementing it here would test this file
   against itself, which is how a checker comes to agree with a bug. */
const ctx = { console, Math, Date, JSON, isFinite, isNaN, parseFloat, parseInt, Number, String, Array, Object, RegExp, Error, Map, Set, Symbol };
ctx.globalThis = ctx;
ctx.window = ctx;
ctx.self = ctx;
vm.createContext(ctx);
const DexBuild = require(ROOT + 'tools/build-core.js');
for (const f of ['kernel-constants.js', 'clock.js', 'crossnight-envelope.js']) vm.runInContext(DexBuild.classicify(fs.readFileSync(ROOT + f, 'utf8'), f), ctx, { filename: f });
const validate = ctx.CrossNightEnvelope && ctx.CrossNightEnvelope.validateNodeExport;
if (typeof validate !== 'function') {
  console.log('crossnight-envelope.js did not expose validateNodeExport — nothing to run');
  process.exit(1);
}

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.json')) files.push(p);
  }
})(DIR);

let scanned = 0,
  failing = 0,
  warned = 0;
const rows = [];
const byNode = new Map();
for (const f of files.sort()) {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    continue; // not JSON we own; the ledger fragments and manifests live here too
  }
  if (!(j && j.schema && j.schema.name === 'ganglior.node-export')) continue;
  scanned++;
  const node = (j.schema && j.schema.node) || j.node || '(unknown)';
  byNode.set(node, (byNode.get(node) || 0) + 1);
  const r = validate(j);
  if (!r.ok) failing++;
  if ((r.warnings || []).length) warned++;
  if (!r.ok || (r.warnings || []).length) rows.push({ f: path.relative(ROOT, f), node, ok: r.ok, e: r.errors || [], w: r.warnings || [] });
}

console.log(`validateNodeExport over ${path.relative(ROOT, DIR) || DIR}\n`);
console.log(`  ganglior.node-export files : ${scanned}`);
console.log(`  FAILING                    : ${failing}`);
console.log(`  with warnings              : ${warned}`);
console.log(
  `  by node                    : ${[...byNode.entries()]
    .sort()
    .map(([k, v]) => `${k}×${v}`)
    .join(' · ')}\n`
);

for (const r of rows) {
  console.log(`  ${r.ok ? 'warn' : 'FAIL'}  ${r.f}   [${r.node}]`);
  for (const e of r.e) console.log(`        error:   ${e}`);
  for (const w of r.w) console.log(`        warning: ${w}`);
}
if (!rows.length) console.log('  every export validates clean, warnings included.');

if (STRICT && failing) process.exitCode = 1;
