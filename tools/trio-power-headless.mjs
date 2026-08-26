#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * trio-power-headless.mjs — run the sensor-trio power sweep headlessly, ON THE GPU.
 *
 * WHY. `papers/sensor-trio-nights.html` Table 1 is computed by
 * `sensor-trio-power-analysis.html`, and its ±0.15 column needs ≈20,000 trials/cell to
 * converge against 720 published (#1092). On the CPU worker pool that is **33m46s**.
 * On the WebGPU lane it is **2.4s** — ~840× — which is the difference between "the
 * re-fit is an afternoon" and "the re-fit happens".
 *
 * The GPU lane already worked; reaching it headlessly needed three things, none obvious,
 * and each silently degrades rather than failing:
 *
 *   1. USE THE BUTTON, NOT `__trioRunSync`. `run()` is the only path that calls
 *      `TrioGPU.init()` — `GPU_OK` is a const local to it, and the GPU cell-runner lives
 *      inside it. `window.__trioRunSync` is the *serial* fallback (its own docstring says
 *      so) and is CPU-only BY DESIGN: it exists for hidden-iframe figure generation where
 *      timers are paused. Driving it and reading `__trioLane()` reports `cpu-pool`
 *      forever, which is exactly how a 33-minute run gets mistaken for the fast path.
 *   2. CHROME FLAGS. Without them `requestAdapter()` returns null (no adapter at all).
 *      With only `--enable-unsafe-webgpu` you get an adapter — **google/swiftshader**, a
 *      SOFTWARE rasteriser that reports `lane: webgpu` while being no faster than the CPU
 *      pool. Measured on this box: bare → no adapter · `--enable-unsafe-webgpu` →
 *      swiftshader · `+ --enable-features=Vulkan --use-angle=vulkan --ignore-gpu-blocklist`
 *      → **amd/rdna-3**, the real device. So this tool ASSERTS the adapter is not
 *      swiftshader unless `--allow-software`; a silent software fallback is the failure
 *      mode most likely to waste an hour.
 *   3. POLL WITH `evaluate`, NOT `waitForFunction`. The page ships a CSP without
 *      `'unsafe-eval'` (deliberately — it is the no-network invariant, browser-enforced).
 *      Playwright's `waitForFunction` polling evaluates a STRING and is refused outright.
 *
 * PARITY. GPU and CPU are independent RNG streams, so they do NOT agree trial-for-trial —
 * at 2,000 they differ by up to 6.5%. At 20,000 they agree to ≤1.5% on every cell and
 * return identical minN (3/5/3), i.e. they converge to the same answer. `--cpu` forces the
 * worker-pool lane so that comparison stays runnable; there is no numerical CPU↔GPU gate
 * in the suite, and this flag is how you check by hand.
 *
 * USAGE
 *   node tools/trio-power-headless.mjs                      # 20000 trials, GPU
 *   node tools/trio-power-headless.mjs --trials 50000
 *   node tools/trio-power-headless.mjs --cpu --trials 2000  # worker-pool lane
 *   node tools/trio-power-headless.mjs --json               # machine-readable
 * ════════════════════════════════════════════════════════════════════════ */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'sensor-trio-power-analysis.html');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const TRIALS = Number(opt('--trials', '20000'));
const WANT_CPU = flag('--cpu');
const ALLOW_SW = flag('--allow-software');
const AS_JSON = flag('--json');

/* The flag set that reaches the DISCRETE adapter. Dropping any of the last three drops
   you to swiftshader, which still reports lane:webgpu — see §2 above. */
const GPU_ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--ignore-gpu-blocklist'];

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright is not installed — `npm i -D playwright` (this tool is dev-only, never bundled).');
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
  args: ['--allow-file-access-from-files', ...(WANT_CPU ? [] : GPU_ARGS)]
});
const page = await browser.newPage();
await page.goto('file://' + PAGE, { waitUntil: 'load', timeout: 120000 });

// CSP-safe readiness poll (§3) — evaluate(), never waitForFunction().
const until = async (fn, tries, ms) => {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate(fn)) return true;
    await new Promise((r) => setTimeout(r, ms));
  }
  return false;
};
if (!(await until(() => typeof window.__trioResult === 'function', 60, 500))) {
  console.error('page never exposed __trioResult — did the bundle load?');
  process.exit(1);
}

const lane = await page.evaluate(async (wantCpu) => {
  if (wantCpu) return { lane: 'cpu-pool', why: 'forced by --cpu', adapter: null };
  const ok = await window.TrioGPU.init();
  let adapter = null;
  try {
    const a = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    adapter = a && a.info ? `${a.info.vendor}/${a.info.architecture || a.info.device || '?'}` : a ? 'granted' : null;
  } catch (e) {
    adapter = 'threw: ' + e.message;
  }
  return { lane: ok ? 'webgpu' : 'cpu-pool', why: window.TrioGPU.why, adapter };
}, WANT_CPU);

/* A software adapter is the failure this tool exists to make loud: it satisfies every
   "is the GPU on?" check and buys nothing. Refuse unless asked. */
if (!WANT_CPU && !ALLOW_SW && /swiftshader|lavapipe|llvmpipe/i.test(String(lane.adapter))) {
  console.error(`REFUSING: WebGPU resolved to a SOFTWARE adapter (${lane.adapter}).`);
  console.error('It reports lane:webgpu and is no faster than the CPU pool. Fix the driver/flags,');
  console.error('or pass --allow-software if you genuinely want it.');
  await browser.close();
  process.exit(1);
}

await page.evaluate((t) => {
  const el = document.getElementById('trials');
  if (el) {
    el.value = String(t);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}, TRIALS);

const t0 = Date.now();
await page.click('#runBtn');
if (
  !(await until(
    () => {
      const r = window.__trioResult();
      return !!(r && r.dynamic && r.minN);
    },
    3600,
    2000
  ))
) {
  console.error('sweep did not finish within 2 h');
  process.exit(1);
}
const wall = (Date.now() - t0) / 1000;

const out = await page.evaluate(() => {
  const R = window.__trioResult();
  const DK = ['o2', 'h10', 'verity'];
  const half = {};
  for (const k of DK) {
    half[k] = {};
    for (const N of R.nGrid) {
      const r = R.dynamic.dev[k][N];
      half[k][N] = r && r.half != null ? +r.half.toFixed(4) : null;
    }
  }
  // The paper publishes four simulation tables and this harness surfaced ONE — the +/-0.15
  // column, a threshold crossing on a coarse grid and so the least reproducible of the four.
  // `bias` and the rho negative-variance grid are continuous, are already computed by the
  // page, and were simply being dropped here. They are what a reproduction can actually be
  // checked against (TRIO-POWER-N15-FINDINGS box 189).
  const biasAt = (regime, N) => {
    const o = {};
    for (const k of DK) {
      const r = R[regime] && R[regime].dev[k][N];
      o[k] = r && r.bias != null ? +r.bias.toFixed(3) : null;
    }
    return o;
  };
  const biasN = R.nGrid[R.nGrid.length - 1]; // bias is flat in N; quote the deepest cell
  const negRate = {};
  for (const g of R.rhoGrid) {
    negRate[g] = {};
    for (const N of R.nGrid) {
      // sweepRho returns the grid ITSELF, not a {grid} wrapper — read both shapes rather
      // than silently yielding an all-null table, which prints as a well-formed row of dashes.
      const RS = R.rhoSweep && R.rhoSweep.grid ? R.rhoSweep.grid : R.rhoSweep;
      const v = RS && RS[g] ? RS[g][N] : null;
      negRate[g][N] = v == null ? null : +v.toFixed(2);
    }
  }
  return {
    lane: window.__trioLane(),
    trials: R.cfg.trials,
    nGrid: R.nGrid,
    rhoGrid: R.rhoGrid,
    targets: R.targets,
    planted: R.planted,
    minN: R.minN,
    half,
    biasN,
    bias: { dynamic: biasAt('dynamic', biasN), resting: biasAt('resting', biasN) },
    negRate
  };
});
await browser.close();

const res = { ...out, adapter: lane.adapter, why: lane.why, wallSec: +wall.toFixed(1) };

// An all-null negRate table is indistinguishable from a genuine all-zero one once printed,
// so refuse rather than report a table this harness never actually read.
if (!Object.values(res.negRate).some((row) => Object.values(row).some((v) => v != null))) {
  console.error('negative-variance grid came back empty — rhoSweep shape changed; refusing to report it');
  process.exit(2);
}
if (AS_JSON) {
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}

console.log(`\n  lane ${res.lane}${res.adapter ? ` (${res.adapter})` : ''} · ${res.trials.toLocaleString()} trials/cell · ${res.wallSec}s\n`);
console.log('  DYNAMIC CI half-width vs N   (minN = first N with half ≤ target)');
console.log('  dev     ' + res.nGrid.map((n) => ('N=' + n).padStart(8)).join('') + '   minN(±0.15)');
for (const k of ['o2', 'h10', 'verity']) {
  console.log('  ' + k.padEnd(8) + res.nGrid.map((n) => String(res.half[k][n]).padStart(8)).join('') + String(res.minN.dynamic[k]['0.15']).padStart(11));
}
console.log('\n  ⚠ minN is a threshold crossing on a COARSE grid and the curve is nearly flat where it\n' + '    crosses ±0.15 — read the half-widths, not just minN (#1092).\n');

console.log(`  sigma-hat BIAS vs planted, at N=${res.biasN} (flat in N - a regime bias, not a precision effect)`);
console.log('  dev         dynamic   resting');
for (const k of ['o2', 'h10', 'verity']) {
  const f = (x) => (x == null ? '-' : (x >= 0 ? '+' : '') + x.toFixed(3));
  console.log('  ' + k.padEnd(10) + f(res.bias.dynamic[k]).padStart(8) + f(res.bias.resting[k]).padStart(10));
}

console.log('\n  NEGATIVE-VARIANCE RATE vs injected rho (resting)');
console.log('  rho     ' + res.nGrid.map((n) => ('N=' + n).padStart(7)).join(''));
for (const g of res.rhoGrid) {
  console.log('  ' + String(g).padEnd(8) + res.nGrid.map((n) => (res.negRate[g][n] == null ? '-' : res.negRate[g][n].toFixed(2)).padStart(7)).join(''));
}
console.log('');
