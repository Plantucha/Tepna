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
 *   2b. ⚠️ AND `navigator.gpu` NEEDS A SECURE CONTEXT — the flags are not the whole story, and this
 *      cost a residue row (`2026-09-13-webgpu-absent-on-rig`, withdrawn 2026-09-27). `about:blank` is
 *      NOT a trustworthy origin, so `!!navigator.gpu` is FALSE there on any box, with any driver, with
 *      every flag above set. Measured 2026-09-27 on this box, same launch, two contexts:
 *      `about:blank` → `isSecureContext:false, gpu:false`; `file:///…/OxyDex.html` →
 *      `isSecureContext:true, gpu:true`. That row probed a blank page in three configurations, read the
 *      three agreeing `false`s as corroboration of a dead driver, and concluded the GPU lane was gone
 *      and a shipped 5 M-trial result was unreproducible. It reproduces in 2 s.
 *      **Probe the page the consumer loads, never a blank one**, and give a capability probe a positive
 *      control in that same context — a context-gated API reads absent for a reason that has nothing to
 *      do with the capability. This tool navigates to `file://` + PAGE below, which is why it sees the
 *      real adapter.
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
import { launch } from './pw-launch.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'sensor-trio-power-analysis.html');
import { makeVerdict } from './verdict-emit.mjs';

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
const VERDICT_SAMPLE = flag('--verdict-sample');

/* ── §🧾 THE VERDICT, PURE, SO THE SAMPLE AND THE REAL RUN CANNOT DIVERGE ─────────────────────────
   What this tool decides is whether the power table reached its PRE-STATED precision target, and on
   WHICH BASIS. The basis is the point: `requestAdapter()` returning nothing leaves `lane: 'cpu-pool'`,
   and a CPU table printed under a GPU-comparison tool is a result about a different machine than the
   one the reader thinks they are looking at. So `result.basis` is always named, never implied.
   Criterion is the paper's ±0.15 CI half-width (#1092), pre-stated and independent of this run.
   Status map, fixed here rather than at the call site:
     NOT_RUN   the GPU was intended and no adapter was granted — nothing was measured on the intended
               backend, and the tool refuses rather than quietly substituting the CPU pool
     FAIL      a SOFTWARE rasteriser was granted without --allow-software (the existing refusal)
     SHORTFALL the table ran but some device never reaches ±0.15 inside the N grid
     PASS      every device reaches the target, with the basis named
   `--cpu` is NOT a shortfall: the caller asked for the worker pool, so the criterion still applies and
   the basis says `cpu-pool`. A software adapter accepted via --allow-software rides as PASS/SHORTFALL
   with `basis: 'webgpu-software:<adapter>'`, because the number is real and the machine is named. */
export function gateVerdict(f) {
  const basis = f.lane === 'webgpu' ? 'webgpu:' + (f.adapter || 'granted') : f.lane === 'cpu-pool' ? (f.wantCpu ? 'cpu-pool (forced by --cpu)' : 'cpu-pool') : String(f.lane);
  const devices = f.minN ? Object.keys(f.minN) : [];
  const unmet = devices.filter((d) => !Number.isFinite(f.minN[d]));
  let status, reason, result;
  if (f.absentBackend) {
    status = 'NOT_RUN';
    result = null;
    reason =
      'no WebGPU adapter was granted, so nothing was measured on the intended backend — requestAdapter() returned ' +
      JSON.stringify(f.adapter) +
      (f.why ? ' (' + f.why + ')' : '') +
      ". Re-run with --cpu to measure the worker-pool lane deliberately; a CPU table is not this tool's GPU answer. NOTE: navigator.gpu is exposed only in a SECURE CONTEXT, so a probe on about:blank sees it absent on any box (see §2).";
  } else if (f.softwareRefused) {
    status = 'FAIL';
    result = { basis: basis, adapter: f.adapter || null };
    reason = 'WebGPU resolved to the SOFTWARE rasteriser ' + JSON.stringify(f.adapter) + ', which reports lane:webgpu and is no faster than the CPU pool — refused without --allow-software';
  } else if (unmet.length) {
    status = 'SHORTFALL';
    result = { basis: basis, minN: f.minN, trials: f.trials, wallSec: f.wallSec };
    reason = unmet.join(', ') + ' never reach a ±' + f.target + ' half-width inside the N grid (max N=' + f.maxN + ')';
  } else {
    status = 'PASS';
    result = { basis: basis, minN: f.minN, trials: f.trials, wallSec: f.wallSec };
    reason = null;
  }
  return makeVerdict({
    gate: 'trio-power-headless',
    status: status,
    population: f.absentBackend ? { checked: 0, eligible: devices.length || 3, excluded: devices.length || 3 } : { checked: devices.length, eligible: devices.length, excluded: 0 },
    criterion: { name: 'ci_half_width', threshold: f.target, unit: 'sigma', direction: 'lte' },
    result: result,
    evidence: ['tools/trio-power-headless.mjs'],
    reason: reason,
    tool: 'tools/trio-power-headless.mjs',
    commit: f.commit,
    at: f.at
  });
}

if (flag('--selftest')) {
  /* The STATUS MAP, over synthetic result sets — no browser, no GPU. Each leg is a state this tool can
     actually reach, and the two that matter most are the ones that used to be silent: an absent backend
     (which continued onto the CPU pool) and a cpu-pool run (which printed under a GPU tool's name). */
  const fails = [];
  const ok = (c, m) => {
    if (!c) fails.push(m);
  };
  const base = { minN: { o2: 3, h10: 5, verity: 2 }, trials: 200, wallSec: 2, target: 0.15, maxN: 20, commit: 'deadbeef', at: '2026-09-27T00:00:00Z' };

  const gpu = gateVerdict({ ...base, lane: 'webgpu', adapter: 'amd/rdna-3' });
  ok(gpu.status === 'PASS', `a real adapter meeting the target is PASS, got ${gpu.status}`);
  ok(gpu.result.basis === 'webgpu:amd/rdna-3', `the basis names the adapter, got ${gpu.result.basis}`);
  ok(gpu.reason === null, 'a PASS carries no reason');

  /* ABSENT BACKEND — nothing was measured on the intended backend. */
  const none = gateVerdict({ ...base, absentBackend: true, lane: 'cpu-pool', adapter: null, why: 'no adapter' });
  ok(none.status === 'NOT_RUN', `an absent backend is NOT_RUN, got ${none.status}`);
  ok(none.result === null, 'NOT_RUN reports no result — it measured nothing');
  ok(none.population.checked === 0 && none.population.excluded === none.population.eligible, JSON.stringify(none.population));
  ok(/adapter/i.test(none.reason) && /secure context/i.test(none.reason), `the reason names what it tried and the secure-context gate, got ${none.reason}`);

  /* A CPU RUN IS NAMED AS THE BASIS, never as the GPU lane — and it is not a shortfall. */
  const cpu = gateVerdict({ ...base, lane: 'cpu-pool', adapter: null, wantCpu: true });
  ok(cpu.status === 'PASS', `--cpu meeting the target is PASS, got ${cpu.status}`);
  ok(/cpu-pool/.test(cpu.result.basis) && !/webgpu/.test(cpu.result.basis), `the basis says cpu-pool and never webgpu, got ${cpu.result.basis}`);

  /* A SOFTWARE rasteriser refused. */
  const sw = gateVerdict({ ...base, softwareRefused: true, lane: 'webgpu', adapter: 'google/swiftshader' });
  ok(sw.status === 'FAIL', `a refused software adapter is FAIL, got ${sw.status}`);
  ok(/swiftshader/.test(sw.reason), 'the FAIL reason names the adapter');

  /* A device that never reaches the target inside the grid. */
  const short = gateVerdict({ ...base, lane: 'webgpu', adapter: 'amd/rdna-3', minN: { o2: 3, h10: null, verity: 2 } });
  ok(short.status === 'SHORTFALL', `an unmet device is SHORTFALL, got ${short.status}`);
  ok(/h10/.test(short.reason) && /0.15/.test(short.reason), `the reason names the device and the target, got ${short.reason}`);
  ok(short.population.checked === 3, 'a shortfall still examined every device');

  /* The criterion is PRE-STATED — the same for every leg, never taken from the numbers it judges. */
  ok(
    [gpu, none, cpu, sw, short].every((v) => v.criterion.threshold === 0.15 && v.criterion.direction === 'lte'),
    'the criterion is identical across every status'
  );

  console.log(fails.length ? `SELFTEST FAIL (${fails.length})\n  ${fails.join('\n  ')}` : 'all 15 selftests passed');
  process.exit(fails.length ? 1 : 0);
}

if (VERDICT_SAMPLE) {
  /* A synthetic result set, so the census can RUN this without a GPU or a browser. */
  console.log(JSON.stringify(gateVerdict({ lane: 'webgpu', adapter: 'amd/rdna-3', minN: { o2: 3, h10: 5, verity: 2 }, trials: 200, wallSec: 2, target: 0.15, maxN: 20 }), null, 2));
  process.exit(0);
}

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

const browser = await launch(chromium, {
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

/* ── NO BACKEND, NO GPU ANSWER (§🧾 + §∅) ─────────────────────────────────────────────────────────
   `requestAdapter()` returning nothing leaves `lane: 'cpu-pool'`, and the run used to CONTINUE — printing
   a worker-pool table under a tool whose entire purpose is the GPU comparison, with the substitution
   visible only to a reader who noticed the lane line. That is an output about a different machine than
   the one the reader thinks they are looking at, so it refuses and says what it tried.
   ⚠️ Measured 2026-09-27 (residue `2026-09-13-webgpu-absent-on-rig`, withdrawn): `navigator.gpu` is
   exposed ONLY IN A SECURE CONTEXT. `about:blank` is not one, so a bare probe reports it absent on any
   box with any driver — which is why three "independent" configurations agreed. This tool navigates to a
   `file://` page (a trustworthy origin), which is why it sees the real adapter where that probe could
   not: `isSecureContext` false/true is the whole difference. Probe a real page, never a blank one. */
if (!WANT_CPU && lane.lane !== 'webgpu') {
  console.log(JSON.stringify(gateVerdict({ absentBackend: true, lane: lane.lane, adapter: lane.adapter, why: lane.why, target: 0.15, maxN: 20 })));
  console.error(`NOT_RUN: no WebGPU adapter was granted (requestAdapter -> ${JSON.stringify(lane.adapter)}${lane.why ? ', ' + lane.why : ''}).`);
  console.error('Nothing was measured on the intended backend. Pass --cpu to measure the worker-pool lane');
  console.error('deliberately; navigator.gpu needs a SECURE CONTEXT, so a blank-page probe never sees it.');
  await browser.close();
  process.exit(1);
}

/* A software adapter is the failure this tool exists to make loud: it satisfies every
   "is the GPU on?" check and buys nothing. Refuse unless asked. */
if (!WANT_CPU && !ALLOW_SW && /swiftshader|lavapipe|llvmpipe/i.test(String(lane.adapter))) {
  console.log(JSON.stringify(gateVerdict({ softwareRefused: true, lane: lane.lane, adapter: lane.adapter, why: lane.why, target: 0.15, maxN: 20 })));
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
  // The paper's Table 2 quotes bias at N=8, so quote the same cell rather than the deepest one —
  // a table regenerated at a different N is not a regeneration of that table. The full curve is
  // exported alongside it so "flat in N" is a checkable claim instead of an asserted one.
  const biasN = R.nGrid.includes(8) ? 8 : R.nGrid[R.nGrid.length - 1];
  const biasByN = { dynamic: {}, resting: {} };
  for (const regime of ['dynamic', 'resting']) {
    for (const N of R.nGrid) biasByN[regime][N] = biasAt(regime, N);
  }
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
    biasByN,
    negRate,
    // Fourth published table: minutes of window needed to reach each precision target at N=1.
    // The paper prints the DYNAMIC regime; resting is carried too so one run covers both.
    durGridSec: R.duration ? R.duration.gridSec : null,
    minMinutes: R.minMinutes || null
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
/* §🧾 ONE object beside the prose. `minN` is read at the PRE-STATED target rather than at whatever the
   grid happened to resolve — a threshold taken from the data it judges would be UNKNOWN, not a PASS. */
const TARGET = 0.15;
const minNAt = Object.fromEntries(
  Object.keys(res.minN && res.minN.dynamic ? res.minN.dynamic : {}).map((k) => {
    const v = res.minN.dynamic[k][String(TARGET)];
    return [k, typeof v === 'number' && Number.isFinite(v) ? v : null];
  })
);
const verdict = gateVerdict({
  lane: res.lane,
  adapter: res.adapter,
  why: res.why,
  wantCpu: WANT_CPU,
  minN: minNAt,
  trials: res.trials,
  wallSec: res.wallSec,
  target: TARGET,
  maxN: Math.max(...(res.nGrid || [20]))
});

if (AS_JSON) {
  console.log(JSON.stringify({ ...res, verdict }, null, 2));
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

console.log('  WINDOW MINUTES needed at N=1 (dynamic regime - the table the paper prints)');
console.log('  dev         ' + res.targets.map((t) => ('+/-' + t).padStart(10)).join(''));
for (const k of ['o2', 'h10', 'verity']) {
  const row = (res.minMinutes && res.minMinutes.dynamic && res.minMinutes.dynamic[k]) || {};
  console.log(
    '  ' +
      k.padEnd(10) +
      res.targets.map((t) => (row[t] == null ? '>' + Math.round((res.durGridSec ? res.durGridSec[res.durGridSec.length - 1] : 3600) / 60) + ' min' : row[t] + ' min').padStart(10)).join('')
  );
}
console.log('');

/* The object LAST, after the tables it summarises — prose explains, the object is the API. */
console.log('\n' + JSON.stringify(verdict));
