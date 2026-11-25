#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * cohort-runner-headless.mjs — drive `cohort-runner.html` headlessly and capture its
 * aggregate, so the robustness benchmark re-runs without a person at a browser.
 *
 * Rule 0: `node tools/doc-search.mjs --read "robustness benchmark cohort generator 2.0
 * rerun frozen seeds"` → `papers/robustness-benchmark.html:110-118`,
 * `briefs/COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md:11-33`,
 * `briefs/RERUN-OXYFIX-PILOTS-BRIEF.md:70-86`. No driver covered this page:
 * `tools/analysis-rerun.mjs` carries the SIX cohort-gen-pinned analysis tools, and
 * `cohort-runner.html` is not one of them.
 *
 * ── WHY A SEPARATE DRIVER, AND NOT AN `analysis-rerun.mjs` ROW ───────────────────────
 * `analysis-rerun.mjs` reads ONE result global per page. This page publishes none: its
 * aggregate lives in the page function `aggregate()`, which the download buttons call.
 * The page's script is CLASSIC, so `aggregate()` is reachable from `page.evaluate()` and
 * NO source change is owed. The run is also long (tens of minutes at the published N)
 * and holds its own 20k-record IndexedDB store, which the inventory's per-tool timeout
 * and checkpoint shape do not fit.
 *
 * ── THE GENERATOR SWAP NEEDS NO REBUILD HERE ────────────────────────────────────────
 * The 2.0 rerun brief's §⛔ A/B says the swap is "on-disk plus a rebuild", because the
 * six analysis tools INLINE the generator into their blob workers. This page does not:
 * `cohort-runner.html` loads `cohort-gen.js` with a plain `<script src>`, and
 * `cohort-worker.js` reaches it through `importScripts` from disk. So on this lane the
 * A/B is a file swap alone, and the arm's own pin is read back out of the page.
 *
 * ── CSP, INHERITED FROM `trio-power-headless.mjs` AND NOT REDERIVED ─────────────────
 *   1. Drive the RUN BUTTON. The page has no sync entry point at all.
 *   2. Poll with `page.evaluate()`, NEVER `waitForFunction` — the CSP refuses its
 *      string evaluation.
 *   `file://` works and needs `--allow-file-access-from-files`.
 *
 * ── THE POOL IS CAPPED THROUGH `navigator.hardwareConcurrency` ──────────────────────
 * `CORES` is a top-level `const` in the page, so it cannot be reassigned. An init
 * script seals `navigator.hardwareConcurrency` BEFORE the page's scripts run, which is
 * the only lever that does not edit the page. Patients are frozen contiguous seeds, so
 * the pool size changes the wall time and not one number (`docs/COHORT-VALIDATION-
 * README.md`: the pool and single-thread engines are bit-identical). The captured
 * manifest records `threads` and `cores`, so the arm stays honestly labelled.
 *
 * ── IndexedDB CARRIES BETWEEN ARMS, AND MUST BE CLEARED ─────────────────────────────
 * The page RESUMES from its IndexedDB store, so arm B would otherwise re-read arm A's
 * patients and report the first generator's numbers under the second generator's pin.
 * `--clear-db` calls the page's own `dbClear()` before the run. It is the DEFAULT, and
 * `--resume` is the opt-out.
 *
 * ── ABSENCE IS NULL ─────────────────────────────────────────────────────────────────
 * A run that does not reach `N` scored patients writes no aggregate: the tool exits 1
 * and says what it reached. A partial cohort is a different population, never a
 * smaller one of the same.
 *
 * Usage:
 *   node tools/cohort-runner-headless.mjs --out <file.json> [--n 20000] [--lane fast]
 *        [--engine workers] [--jobs 8] [--deadline-min 180] [--resume] [--label TEXT]
 * ════════════════════════════════════════════════════════════════════════ */

import { writeFileSync } from 'node:fs';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = pathResolve(HERE, '..');
const PAGE = pathResolve(ROOT, 'cohort-runner.html');

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(name);
  return i === -1 ? dflt : argv[i + 1];
};
const has = (name) => argv.includes(name);

const OUT = flag('--out', null);
const N = Number(flag('--n', 20000));
const LANE = String(flag('--lane', 'fast'));
const ENGINE = String(flag('--engine', 'workers'));
const JOBS = Number(flag('--jobs', 8));
const DEADLINE_MIN = Number(flag('--deadline-min', 180));
const LABEL = flag('--label', null);
const CLEAR_DB = !has('--resume');

if (!OUT) {
  console.error('--out <file.json> is required');
  process.exit(2);
}
if (!Number.isInteger(N) || N < 1) {
  console.error(`--n must be a positive integer, got ${flag('--n', '')}`);
  process.exit(2);
}
if (!Number.isInteger(JOBS) || JOBS < 2) {
  console.error('--jobs must be an integer of 2 or more (the page floors its pool at 2)');
  process.exit(2);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright is not installed — `npm i -D playwright` (dev-only, never bundled).');
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
  args: ['--allow-file-access-from-files']
});
const page = await browser.newPage();

// Seal the pool size BEFORE any page script reads it (`CORES` is a const).
await page.addInitScript(`Object.defineProperty(navigator, 'hardwareConcurrency', {
  get: () => ${JOBS}, configurable: false });`);

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

await page.goto(`file://${PAGE}`, { waitUntil: 'load', timeout: 120000 });

const until = async (expr, tries, ms) => {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate(expr)) return true;
    await new Promise((r) => setTimeout(r, ms));
  }
  return false;
};

if (!(await until("typeof aggregate === 'function' && typeof startRun === 'function'", 60, 500))) {
  console.error('the page never exposed aggregate()/startRun() — did its scripts load?');
  await browser.close();
  process.exit(1);
}

const pins = await page.evaluate(`({
  cohortGen: typeof CohortGen === 'object' && CohortGen ? CohortGen.VERSION || null : null,
  dex: typeof DexKernel === 'object' && DexKernel ? DexKernel.VERSION || null : null,
  hardwareConcurrency: navigator.hardwareConcurrency
})`);
console.log(`page loaded · cohortGen ${pins.cohortGen} · dex ${pins.dex} · pool lever ${pins.hardwareConcurrency}`);

if (CLEAR_DB) {
  /* The count BEFORE the clear is the honest half: it says what the launch INHERITED.
     Playwright gives each launch a fresh temporary profile, so the figure is normally 0
     and the clear is belt and braces. A non-zero figure means a persistent profile, and
     then the clear is the only thing standing between arm A and arm B. */
  const inherited = await page.evaluate('dbCount()');
  const cleared = await page.evaluate('(async () => { await dbClear(); return await dbCount(); })()');
  console.log(`IndexedDB inherited ${inherited} record(s) · cleared · ${cleared} record(s) remain`);
  if (cleared !== 0) {
    console.error(`dbClear() left ${cleared} record(s) — the arms would mix; refusing.`);
    await browser.close();
    process.exit(1);
  }
}

await page.evaluate(`(() => {
  document.getElementById('nIn').value = ${JSON.stringify(String(N))};
  document.getElementById('modeIn').value = ${JSON.stringify(LANE)};
  document.getElementById('engineIn').value = ${JSON.stringify(ENGINE)};
})()`);

const startedAt = Date.now();
await page.click('#startBtn');
console.log(`started · N=${N} · lane ${LANE} · engine ${ENGINE} · deadline ${DEADLINE_MIN} min`);

const deadlineMs = startedAt + DEADLINE_MIN * 60000;
let state = null;
for (;;) {
  await new Promise((r) => setTimeout(r, 15000));
  state = await page.evaluate(`({
    running: typeof running === 'boolean' ? running : null,
    scored: typeof RESULTS !== 'undefined' && RESULTS ? RESULTS.length : null,
    pill: (document.getElementById('statusPill') || {}).textContent || null
  })`);
  const mins = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(`  ${mins} min · scored ${state.scored} / ${N} · running ${state.running} · ${state.pill}`);
  if (state.running === false) break;
  if (Date.now() > deadlineMs) {
    console.error(`deadline of ${DEADLINE_MIN} min passed at ${state.scored} / ${N} scored — no aggregate written.`);
    await browser.close();
    process.exit(1);
  }
}

if (state.scored !== N) {
  console.error(`the run stopped at ${state.scored} / ${N} scored patients — a partial cohort is a different population, so no aggregate is written.`);
  if (consoleErrors.length) console.error(`page errors: ${consoleErrors.slice(0, 5).join(' | ')}`);
  await browser.close();
  process.exit(1);
}

const agg = await page.evaluate('aggregate()');
await browser.close();

const record = {
  schema: { name: 'tepna.cohort-robustness-arm', version: '1.0' },
  label: LABEL,
  capturedAt: new Date().toISOString(),
  lane: { n: N, mode: LANE, engine: ENGINE, poolLever: JOBS },
  pins,
  wallMs: Date.now() - startedAt,
  pageErrors: consoleErrors,
  aggregate: agg
};
writeFileSync(OUT, `${JSON.stringify(record, null, 2)}\n`);
console.log(`wrote ${OUT} · ${state.scored} patients · ${(record.wallMs / 60000).toFixed(1)} min · ${consoleErrors.length} page error(s)`);
