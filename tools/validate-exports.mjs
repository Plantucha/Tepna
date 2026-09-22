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
 * USAGE  node tools/validate-exports.mjs [--dir uploads] [--strict] [--json]
 *        --strict → exit 1 if any export FAILS (warnings never fail)
 *        --json   → the tepna.verdict/1 object on stdout (report → stderr)
 *        --verdict-sample | --selftest
 *
 * VERDICT (tepna.verdict/1, wave 2 group C — read before flipping, the rule is exact): FAIL iff any
 * `ganglior.node-export` fails `validateNodeExport` — the same `failing` count `--strict` keys its exit
 * code on; warnings are reported in the result and never fail, exactly as before. Population = the
 * node-export files scanned (other JSON in the tree is not eligible). NOT_RUN when the directory is
 * absent or holds no node export — a sweep over nothing is not a clean bill.
 * ════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import vm from 'node:vm';
import { makeVerdict } from './verdict-emit.mjs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = new URL('..', import.meta.url).pathname;
const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

/* ── the verdict object — pure over the counts, so the selftest can drive it ─────────────────────── */
export function verdictObject(c, { dir = 'uploads', failingRows = [], commit, commitReason, at } = {}) {
  const criterion = { name: 'node_export_validation_failures (validateNodeExport ok on every ganglior.node-export; warnings never fail)', threshold: 0, unit: 'failing exports', direction: 'eq' };
  const base = { gate: 'validate-exports', criterion, tool: 'tools/validate-exports.mjs', commit, commitReason, at };
  if (!(c.scanned > 0)) {
    return makeVerdict({
      ...base,
      status: 'NOT_RUN',
      population: { checked: 0, eligible: 0, excluded: 0 },
      result: null,
      evidence: [`${dir}/**/*.json`],
      reason: c.dirMissing ? `no such directory: ${dir} (uploads/ is gitignored — pass --dir)` : `${dir} holds no ganglior.node-export — a sweep over 0 exports is not a clean bill`
    });
  }
  const named = failingRows.slice(0, 5).map((r) => `${r.f} [${r.node}]: ${(r.e && r.e[0]) || 'invalid'}`);
  return makeVerdict({
    ...base,
    status: c.failing > 0 ? 'FAIL' : 'PASS',
    population: { checked: c.scanned, eligible: c.scanned, excluded: 0 },
    result: { scanned: c.scanned, failing: c.failing, warned: c.warned, byNode: c.byNode || {} },
    evidence: [`${dir}/**/*.json`, ...failingRows.map((r) => r.f)],
    reason: c.failing > 0 ? `${c.failing} of ${c.scanned} exports fail validateNodeExport: ${named.join('; ')}${failingRows.length > 5 ? '; …' : ''}` : null
  });
}

/* The documented sweep (header, 2026-08-03): 98 exports · 0 failing · 2 warnings. No code identity claimed. */
export function verdictSample() {
  return verdictObject(
    { scanned: 98, failing: 0, warned: 2, byNode: { CPAPDex: 9, ECGDex: 12, GlucoDex: 6, HRVDex: 8, Integrator: 3, MotionDex: 4, OxyDex: 27, PpgDex: 29 } },
    { commit: null, commitReason: '--verdict-sample: the 2026-08-03 sweep counts from the header, no code identity claimed', at: '2026-09-22T00:00:00Z' }
  );
}

function selftest() {
  let n = 0;
  const eq = (a, b, msg) => {
    n++;
    if (a !== b) {
      console.log(`✗ ${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
      process.exit(1);
    }
    console.log(`✓ ${msg}`);
  };
  const o = { commit: null, commitReason: 'selftest', at: '2026-09-22T00:00:00Z' };
  const clean = verdictObject({ scanned: 98, failing: 0, warned: 2 }, o);
  eq(clean.status, 'PASS', 'PASS: 0 failing over 98 scanned (warnings never fail)');
  eq(clean.population.checked, 98, 'population = the node exports scanned');
  eq(clean.result.warned, 2, 'PASS carries the warning count in the result');
  const bad = verdictObject(
    { scanned: 98, failing: 2, warned: 2 },
    {
      ...o,
      failingRows: [
        { f: 'uploads/a.json', node: 'OxyDex', e: ['schema.name missing'] },
        { f: 'uploads/b.json', node: 'PpgDex', e: [] }
      ]
    }
  );
  eq(bad.status, 'FAIL', 'FAIL: 2 failing exports');
  eq(/uploads\/a\.json \[OxyDex\]: schema\.name missing/.test(bad.reason), true, 'FAIL reason names the file, node and first error');
  eq(bad.evidence.includes('uploads/b.json'), true, 'FAIL evidence lists the failing files');
  eq(verdictObject({ scanned: 0, failing: 0, warned: 0 }, o).status, 'NOT_RUN', 'NOT_RUN: no node export in the tree');
  eq(verdictObject({ scanned: 0, dirMissing: true }, { ...o, dir: 'nope' }).status, 'NOT_RUN', 'NOT_RUN: directory absent');
  eq(/no such directory: nope/.test(verdictObject({ scanned: 0, dirMissing: true }, { ...o, dir: 'nope' }).reason), true, 'NOT_RUN reason names the missing directory');
  eq(verdictSample().status, 'PASS', 'the documented 2026-08-03 sweep is a PASS');
  eq(verdictSample().producedBy.commit, null, 'the sample claims no code identity');
  console.log(`all ${n} selftests passed`);
}

if (argv.includes('--selftest')) {
  selftest();
  process.exit(0);
}
if (argv.includes('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample()));
  process.exit(0);
}
const JSON_OUT = argv.includes('--json');
const out = JSON_OUT ? (...a) => console.error(...a) : (...a) => console.log(...a);
const DIR = path.resolve(ROOT, opt('--dir', 'uploads'));
const DIR_REL = path.relative(ROOT, DIR) || DIR;
const STRICT = argv.includes('--strict');

if (!fs.existsSync(DIR)) {
  out(`no such directory: ${DIR}  (uploads/ is gitignored — pass --dir)`);
  if (JSON_OUT) console.log(JSON.stringify(verdictObject({ scanned: 0, dirMissing: true }, { dir: DIR_REL })));
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

out(`validateNodeExport over ${path.relative(ROOT, DIR) || DIR}\n`);
out(`  ganglior.node-export files : ${scanned}`);
out(`  FAILING                    : ${failing}`);
out(`  with warnings              : ${warned}`);
out(
  `  by node                    : ${[...byNode.entries()]
    .sort()
    .map(([k, v]) => `${k}×${v}`)
    .join(' · ')}\n`
);

for (const r of rows) {
  out(`  ${r.ok ? 'warn' : 'FAIL'}  ${r.f}   [${r.node}]`);
  for (const e of r.e) out(`        error:   ${e}`);
  for (const w of r.w) out(`        warning: ${w}`);
}
if (!rows.length) out('  every export validates clean, warnings included.');

const verdict = verdictObject({ scanned, failing, warned, byNode: Object.fromEntries([...byNode.entries()].sort()) }, { dir: DIR_REL, failingRows: rows.filter((r) => !r.ok) });
if (JSON_OUT) console.log(JSON.stringify(verdict));
if (STRICT && failing) process.exitCode = 1;
