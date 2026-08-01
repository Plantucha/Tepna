#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * oxydex-export-staleness.mjs — re-run OxyDex on each export's OWN named source
 * file and report which exports no longer reproduce.
 * ----------------------------------------------------------------------------
 * WHY THIS EXISTS. INTEGRATOR-OXYDEX-ADAPTER-GAP-FOLLOWUPS §2 asked why
 * `hrv.rmssd` is null on 2 of 7 corpus nights, and offered two hypotheses: a
 * legitimate quality gate in oxydex-dsp, or a silent computation failure. It is
 * NEITHER. `OxyDex_2026-07-02_2205_summary.json` carries `hrv: null` and
 * `artifact.hrSamplesCleaned: 22083` — essentially every HR sample flagged — but
 * re-running today's code on the very file that export NAMES
 * (`O2Ring S 2100_20260702220521.csv`) yields `hrv.rmssd 0.5` over 22,013 clean
 * samples. The export is simply STALE: generated 2026-07-03, never regenerated
 * after the code that produced it changed.
 *
 * That is a whole failure class, not one file. GATE B content-addresses the
 * COMMITTED fixtures, so those cannot rot unseen. These exports are gitignored
 * working artifacts that corpus analyses and the Integrator consume directly —
 * outside every gate. An analysis that reads them inherits whatever the code did
 * on the day they were written, with nothing to say so.
 *
 * Each export records the input it came from (`nights[i].file`), which is what
 * makes the check possible at all: the tool never guesses a pairing.
 *
 * USAGE
 *   node tools/oxydex-export-staleness.mjs <export-dir> [--raw <dir>]
 *   node tools/oxydex-export-staleness.mjs --selftest
 *
 * Exit 1 if any export fails to reproduce, so this can gate a corpus run.
 * ════════════════════════════════════════════════════════════════════════════ */
import vm from 'node:vm';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/* Fields worth comparing: each is read by a downstream consumer, and each is a
   plausible-looking value when wrong (null, or a number in range), which is why
   drift in them goes unnoticed. `hrv` leads because it is the field §2 asked about. */
const FIELDS = [
  ['hrv.rmssd', (n) => (n.hrv ? n.hrv.rmssd : null)],
  ['hrv.n', (n) => (n.hrv ? n.hrv.n : null)],
  ['odi4.rate', (n) => (n.odi4 ? n.odi4.rate : null)],
  ['stats.durationMin', (n) => (n.stats ? n.stats.durationMin : null)],
  ['stats.minSpo2', (n) => (n.stats ? n.stats.minSpo2 : null)],
  ['hypoxicBurden', (n) => (n.hypoxicBurden == null ? null : typeof n.hypoxicBurden === 'object' ? n.hypoxicBurden.index : n.hypoxicBurden)]
];

function realm() {
  const DexBuild = require(join(ROOT, 'tools/build-core.js'));
  const el = () => ({
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {},
    addEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    insertAdjacentHTML() {},
    get textContent() {
      return '';
    },
    set textContent(v) {},
    get innerHTML() {
      return '';
    },
    set innerHTML(v) {},
    getContext: () => null
  });
  const ctx = {
    console,
    Date,
    Math,
    JSON,
    isFinite,
    isNaN,
    parseFloat,
    parseInt,
    Object,
    Array,
    String,
    Number,
    Error,
    Float32Array,
    Float64Array,
    Int16Array,
    Int32Array,
    Uint8Array,
    ArrayBuffer,
    DataView,
    TextDecoder,
    TextEncoder,
    setTimeout,
    clearTimeout,
    performance,
    URL,
    crypto,
    RegExp,
    Map,
    Set,
    Symbol,
    Promise
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  ctx.document = { createElement: el, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, head: el(), body: el(), documentElement: el() };
  ctx.navigator = { userAgent: 'node' };
  vm.createContext(ctx);
  for (const f of ['kernel-constants.js', 'clock.js', 'oxydex-util.js', 'oxydex-profile.js', 'oxydex-dsp.js']) {
    vm.runInContext(DexBuild.classicify(readFileSync(join(ROOT, f), 'utf8'), f), ctx, { filename: f });
  }
  return ctx;
}

function recompute(ctx, csvPath, name) {
  ctx.__csv = readFileSync(csvPath, 'utf8');
  ctx.__name = name;
  return JSON.parse(
    vm.runInContext(
      `(function(){ const B=window.OxyDex._bare;
         const nt=B.processNight(B.parseCSV(__csv,{name:__name}), __name);
         return JSON.stringify({hrv:nt.hrv||null, odi4:nt.odi4||null, stats:nt.stats||null, hypoxicBurden:nt.hb==null?null:nt.hb});
       })()`,
      ctx
    )
  );
}

function nightsOf(json) {
  return Array.isArray(json) ? json : Array.isArray(json.nights) ? json.nights : [json];
}

function selftest() {
  let fail = 0;
  const ok = (n, c) => {
    if (!c) fail++;
    console.log(`  ${c ? '✓' : '✕'} ${n}`);
  };
  ok('nightsOf unwraps a bare array export', nightsOf([{ a: 1 }]).length === 1);
  ok('nightsOf unwraps a node-export .nights', nightsOf({ nights: [{ a: 1 }, { a: 2 }] }).length === 2);
  ok('nightsOf falls back to the object itself', nightsOf({ a: 1 })[0].a === 1);
  // A null hrv and a present hrv must not compare equal — the exact case §2 turned on.
  const g = FIELDS[0][1];
  ok('hrv.rmssd reads null when hrv is null', g({ hrv: null }) === null);
  ok('…and the value when it is present', g({ hrv: { rmssd: 0.5 } }) === 0.5);
  // The realm must actually boot, or every verdict below would be a vacuous "no exports checked".
  let booted = false;
  try {
    booted = typeof realm().window.OxyDex._bare.processNight === 'function';
  } catch (e) {
    booted = false;
  }
  ok('the OxyDex realm boots and exposes processNight (non-vacuity)', booted);
  console.log(fail ? `\n✕ selftest: ${fail} failing` : '\n✓ selftest: all passing');
  process.exit(fail ? 1 : 0);
}

const argv = process.argv.slice(2);
if (argv.includes('--selftest')) selftest();
const dir = argv.find((a) => !a.startsWith('--'));
if (!dir) {
  console.error('usage: node tools/oxydex-export-staleness.mjs <export-dir> [--raw <dir>]');
  process.exit(2);
}
const rawDir = argv.includes('--raw') ? argv[argv.indexOf('--raw') + 1] : dir;

const exports_ = readdirSync(dir).filter((f) => /oxydex.*\.json$/i.test(f));
const ctx = realm();
let stale = 0,
  checked = 0,
  noSource = 0;

console.log(`OxyDex export staleness — re-running each export against the input it names\n`);
for (const f of exports_.sort()) {
  let json;
  try {
    json = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  } catch {
    continue;
  }
  for (const n of nightsOf(json)) {
    if (!n || !n.file) {
      noSource++;
      continue;
    }
    const csv = join(rawDir, n.file);
    if (!existsSync(csv)) {
      noSource++;
      continue;
    }
    checked++;
    const now = recompute(ctx, csv, n.file);
    const diffs = [];
    for (const [label, get] of FIELDS) {
      const was = get(n),
        is = get(now);
      const same = was === is || (was != null && is != null && Math.abs(was - is) < 1e-9);
      if (!same) diffs.push(`${label}: ${JSON.stringify(was)} → ${JSON.stringify(is)}`);
    }
    if (diffs.length) {
      stale++;
      console.log(`✕ ${f}  [${n.date || '?'}]  ← ${n.file}`);
      for (const d of diffs) console.log(`    ${d}`);
    } else {
      console.log(`✓ ${f}  [${n.date || '?'}]`);
    }
  }
}
console.log(`\n${checked} night(s) checked · ${stale} no longer reproduce · ${noSource} skipped (no named source on disk)`);
if (stale) {
  console.log(
    `\n✕ A stale export is not a quality gate and not a missing value — it is what the code USED to do.\n` +
      `  Regenerate it, or stop reading it: a consumer cannot tell a stale null from a gated one.`
  );
  process.exit(1);
}
