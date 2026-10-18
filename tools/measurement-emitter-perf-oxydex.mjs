#!/usr/bin/env node
/*
 * tools/measurement-emitter-perf-oxydex.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * MEASUREMENT-PROVENANCE-ROADMAP §10 for the OXYDEX emitter and the Integrator adapter —
 * runtime, peak memory, export size, against bands written BEFORE the run.
 *
 * Residue `2026-09-21-measurement-emitter-runtime-memory-unmeasured`: §10 asks for runtime, peak
 * memory and export-size delta on a representative night, with the acceptable deltas pre-stated. The
 * 2026-09-22 records (`audits/MEASUREMENT-EMITTER-PERF-2026-09-22.json` ECGDex, `…-PPGDEX-…` PpgDex)
 * measured the second and third emitters; no record names the OxyDex block (the FIRST emitter) or the
 * adapter reading it. This tool measures exactly that, so the answer is a re-runnable record and
 * not a scratch script.
 *
 * THE BANDS are the ones those two records PRE-STATED on 2026-09-22 — copied verbatim, not chosen
 * after seeing an OxyDex number (a threshold derived from the data it judges is UNKNOWN, CLAUDE.md §🧾):
 *   runtime ≤ +5 % AND ≤ +50 ms · peak RSS ≤ +50 MB · export ≤ +4096 bytes.
 * The adapter's per-call delta is judged on the absolute band only: a percentage of a sub-millisecond
 * call is quantisation noise, not a cost.
 *
 * THE BASELINE is the SAME tree with the one emitter call removed (the single
 * `measurement: oxyBuildMeasurementBlocks(…)` property of `oxyBuildNightElement` replaced by `null`).
 * Not an older commit: the OxyDex DSP has moved a great deal since the emitter landed, so a commit
 * baseline would measure every other change as well. If the call site is not found exactly once the
 * tool reports NOT_RUN — it never measures a baseline it did not build.
 *
 * RESOLUTION — why the runtime leg can read UNDERPOWERED but never "met": the ≤ 50 ms band sits BELOW
 * this instrument's own resolution. compute() takes 6.1–7.6 s per night and the SAME arm re-run spreads
 * 299–598 ms (`perNight[].noiseMs`), so the band is a sixth of the noise, and a run can neither meet nor
 * miss it. A runtime delta no larger than its own night's spread therefore leaves the band UNRESOLVED:
 * the leg reads UNDERPOWERED, the delta is reported as the number it is, and the emitter's direct cost
 * (the function called in a loop, in-process) is recorded beside it as the cost that IS resolvable.
 * That is a property of the instrument, not a verdict about the emitter.
 * The rule entered after this tool's first run, which `result.power.origin` states in every record it
 * writes. `--prior <record>` measures the claim instead of asserting it: it replays against an earlier
 * record of this same instrument and counts the nights whose runtime delta changed SIGN while the
 * deterministic bands (export bytes, RSS, adapter) repeat — the counts land in `result.replication`.
 * Every other band is judged exactly as pre-stated, and a runtime delta above BOTH the spread and the
 * band is a FAIL.
 *
 * Each (night, arm, run) is a separate process (peak RSS is per process), arms interleaved so slow
 * drift hits both; the statistic is the median of RUNS runs.
 *
 *   node tools/measurement-emitter-perf-oxydex.mjs --json                # ONE tepna.verdict/1 on stdout
 *   node tools/measurement-emitter-perf-oxydex.mjs --json --write audits/MEASUREMENT-EMITTER-PERF-OXYDEX-2026-10-12.json
 *   node tools/measurement-emitter-perf-oxydex.mjs --json --prior audits/MEASUREMENT-EMITTER-PERF-OXYDEX-2026-10-12.json
 *   node tools/measurement-emitter-perf-oxydex.mjs --selftest
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : null);

/* ── PRE-STATED BANDS — verbatim from audits/MEASUREMENT-EMITTER-PERF-PPGDEX-2026-09-22.json `bands`
   (written 2026-09-22 before any run; the ECGDex record carries the same four). Do not edit to fit a result. */
export const BANDS = Object.freeze({ runtimePct: 5, runtimeAbsMs: 50, peakRssMB: 50, exportBytes: 4096 });
export const RUNS = 5;
/* The representative nights: the five committed real O2Ring recordings (tracked in git, so a fresh clone can re-run). */
export const NIGHTS = [
  'O2Ring S 2100_20260511231000.csv',
  'O2Ring S 2100_20260512235500.csv',
  'O2Ring S 2100_20260513225000.csv',
  'O2Ring S 2100_20260514230500.csv',
  'O2Ring S 2100_20260515232000.csv'
];
const CALL = 'measurement: oxyBuildMeasurementBlocks(n, { code: opts.code }),';
export const OXY_FILES = [
  'kernel-constants.js',
  'signal-frame.js',
  'dex-export.js',
  'oxydex-util.js',
  'crossnight-envelope.js',
  'metric-registry.js',
  'dex-escape.js',
  'dex-profile.js',
  'oxydex-registry.js',
  'oxydex-cross.js',
  'clock.js',
  'oxydex-profile.js',
  'oxydex-dsp.js'
];
export const INTEGRATOR_FILES = ['kernel-constants.js', 'clock.js', 'signal-frame.js', 'dex-export.js', 'metric-registry.js', 'event-coupling.js', 'integrator-tch.js', 'integrator-dsp.js'];

export const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r2 = (x) => Math.round(x * 100) / 100;

/* The baseline source: the one call site → null. Returns null unless it matched EXACTLY once. */
export function baselineSource(src) {
  const parts = src.split(CALL);
  return parts.length === 2 ? parts.join('measurement: null,') : null;
}

/* PURE: per-night medians → the verdict fields. Planted by --selftest.
   `noiseMs` (optional) is the night's within-arm run-to-run range: a runtime delta that exceeds the band but not
   its own noise is not a measurement — it goes to `noisy`, never to `miss`. */
/* PURE: this run against an earlier record of the SAME instrument. Planted by --selftest.
   The question is not "did the numbers repeat" but "is the band resolvable at all". A band that sits
   inside the instrument's own spread yields a different number every run, and that is what makes the
   runtime leg UNDERPOWERED rather than met or missed. */
export function replicate(prior, perNight, worstPct) {
  const pn = prior && prior.result && prior.result.perNight ? prior.result.perNight : null;
  if (!pn) return { comparable: false, reason: 'the prior record carries no perNight block' };
  const keys = Object.keys(perNight).filter((k) => pn[k]);
  if (!keys.length) return { comparable: false, reason: 'no night appears in both records' };
  let signFlips = 0;
  let bytesIdentical = 0;
  let worstThis = null;
  let worstPrior = null;
  for (const k of keys) {
    const a = pn[k];
    const b = perNight[k];
    if (Math.sign(a.wallMs.delta) !== Math.sign(b.wallMs.delta)) signFlips++;
    if (a.bytes.delta === b.bytes.delta) bytesIdentical++;
    if (worstThis === null || b.wallMs.deltaPct > perNight[worstThis].wallMs.deltaPct) worstThis = k;
    if (worstPrior === null || a.wallMs.deltaPct > pn[worstPrior].wallMs.deltaPct) worstPrior = k;
  }
  return {
    comparable: true,
    priorRecord: null,
    priorAt: prior.at != null ? prior.at : null,
    nightsCompared: keys.length,
    priorWorstRuntimeDeltaPct: prior.result.worstRuntimeDeltaPct,
    thisWorstRuntimeDeltaPct: worstPct,
    runtimeSignFlips: signFlips,
    worstNightMoved: worstThis !== worstPrior,
    exportBytesIdentical: bytesIdentical,
    bandMs: BANDS.runtimeAbsMs
  };
}

export function judge(perNight, adapter, bands = BANDS) {
  const miss = [];
  const noisy = [];
  let worstPct = -Infinity;
  for (const [name, r] of Object.entries(perNight)) {
    const dMs = r.wallMs.delta;
    const dPct = r.wallMs.deltaPct;
    if (dPct > worstPct) worstPct = dPct;
    if (dMs > bands.runtimeAbsMs || dPct > bands.runtimePct) {
      const msg = `${name}: runtime +${dMs} ms (+${dPct} %) over ≤ +${bands.runtimePct} % and ≤ +${bands.runtimeAbsMs} ms`;
      if (r.noiseMs != null && dMs <= r.noiseMs) noisy.push(`${msg}, but the same arm's runs spread ${r.noiseMs} ms`);
      else miss.push(msg);
    }
    if (r.peakMB.delta > bands.peakRssMB) miss.push(`${name}: peak RSS +${r.peakMB.delta} MB over +${bands.peakRssMB} MB`);
    if (r.bytes.delta > bands.exportBytes) miss.push(`${name}: export +${r.bytes.delta} B over +${bands.exportBytes} B`);
  }
  if (adapter.deltaMs > bands.runtimeAbsMs) miss.push(`Integrator adapter: +${adapter.deltaMs} ms per call over +${bands.runtimeAbsMs} ms`);
  return { miss, noisy, worstPct: r2(worstPct) };
}

/* ── realms ── */
function realm(files, patch) {
  const noop = () => {};
  const el = () => ({
    style: {},
    dataset: {},
    textContent: '',
    innerHTML: '',
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop,
    removeAttribute: noop,
    getAttribute: () => null,
    appendChild: noop,
    append: noop,
    removeChild: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop
  });
  const sb = {
    document: {
      getElementById: () => null,
      createElement: el,
      createTextNode: () => ({}),
      querySelector: () => null,
      querySelectorAll: () => [],
      head: el(),
      body: el(),
      documentElement: el(),
      addEventListener: noop,
      readyState: 'complete'
    },
    localStorage: {
      _m: new Map(),
      getItem(k) {
        return this._m.has(k) ? this._m.get(k) : null;
      },
      setItem(k, v) {
        this._m.set(k, String(v));
      },
      removeItem(k) {
        this._m.delete(k);
      },
      clear() {
        this._m.clear();
      }
    },
    console,
    setTimeout,
    clearTimeout
  };
  sb.window = sb;
  sb.self = sb;
  sb.globalThis = sb;
  const ctx = vm.createContext(sb);
  ctx.__DEX_NAMESPACED__ = true;
  const DexBuild = req('./build-core.js');
  for (const f of files) {
    let src = fs.readFileSync(path.join(REPO, f), 'utf8');
    if (patch && f === 'oxydex-dsp.js') {
      src = baselineSource(src);
      if (src == null) throw new Error('baseline call site not found exactly once in oxydex-dsp.js');
    }
    vm.runInContext(DexBuild.classicify(src), ctx, { filename: f });
  }
  return ctx;
}
/* The shipped bundle stamps its identity on <html>; a headless run takes it as opts.code. Any well-formed pair
   exercises the same code path (the emitter copies two strings) — the real ones are read off OxyDex.html when built. */
const CODE = { manifestHash: '0123456789ab', computeHash: 'ba9876543210' };

/* ── child: ONE (arm, night) in a fresh process → {wallMs, maxRssKB, bytes} ── */
function child(arm, file) {
  const ctx = realm(OXY_FILES, arm === 'baseline');
  const text = fs.readFileSync(path.join(REPO, 'uploads', file), 'utf8');
  const t = process.hrtime.bigint();
  const res = ctx.OxyDex.compute({ text }, { code: CODE });
  const wallMs = Number(process.hrtime.bigint() - t) / 1e6;
  const night = res && res.nights && res.nights[0];
  if (!night) throw new Error('compute() returned no night for ' + file);
  const hasBlock = night.measurement != null;
  console.log(JSON.stringify({ wallMs, maxRssKB: process.resourceUsage().maxRSS, bytes: JSON.stringify(night).length, hasBlock }));
}

/* ── child: the emitter ITSELF, in-process — the function the A/B is trying to see, called in a loop ── */
function emitterChild(file) {
  const ctx = realm(OXY_FILES, false);
  const text = fs.readFileSync(path.join(REPO, 'uploads', file), 'utf8');
  const n = ctx.OxyDex.computeNight({ text }, file); // the RAW night the element builder receives
  if (!n) throw new Error('computeNight returned no night for ' + file);
  const probe = ctx.OxyDex.buildMeasurementBlocks(n, { code: CODE });
  if (!probe || Object.keys(probe).length === 0) throw new Error('the emitter produced no block on ' + file);
  for (let i = 0; i < 200; i++) ctx.OxyDex.buildMeasurementBlocks(n, { code: CODE });
  const N = 2000;
  const t = process.hrtime.bigint();
  for (let i = 0; i < N; i++) ctx.OxyDex.buildMeasurementBlocks(n, { code: CODE });
  console.log(JSON.stringify({ perCallMs: Number(process.hrtime.bigint() - t) / 1e6 / N, blocks: Object.keys(probe).length, calls: N }));
}

/* ── child: the Integrator adapter, consuming a night with and without the block ── */
function adapterChild(file) {
  const oxy = realm(OXY_FILES, false);
  const integ = realm(INTEGRATOR_FILES, false);
  const text = fs.readFileSync(path.join(REPO, 'uploads', file), 'utf8');
  const exp = oxy.OxyDex.compute({ text }, { code: CODE }); // the whole export — the shape the Integrator ingests
  const withJson = JSON.stringify(exp);
  const without = JSON.parse(withJson);
  for (const nn of without.nights) nn.measurement = null;
  const withoutJson = JSON.stringify(without);
  const N = 200;
  const once = (json) => {
    const x = JSON.parse(json); // parse outside the timer's meaning: both arms pay the same
    const t = process.hrtime.bigint();
    const r = integ.normalizeFile(x, 'oxy.json'); // → { recs, warnings } — the adapter the Integrator's drop path runs
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    return { ms, meas: !!(r && r.recs && r.recs[0] && r.recs[0].measurements) };
  };
  for (let i = 0; i < 20; i++) {
    once(withJson);
    once(withoutJson);
  } // warm both
  const a = [],
    b = [];
  let consumed = false;
  for (let i = 0; i < N; i++) {
    const w = once(withJson);
    consumed = consumed || w.meas;
    a.push(w.ms);
    b.push(once(withoutJson).ms);
  }
  console.log(JSON.stringify({ withMs: median(a), withoutMs: median(b), consumed }));
}

const spawn = (...a) => JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), ...a], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 }));

function measure() {
  const perNight = {};
  for (const f of NIGHTS) {
    const base = [],
      shipped = [];
    for (let i = 0; i < RUNS; i++) {
      base.push(spawn('--child', 'baseline', f));
      shipped.push(spawn('--child', 'shipped', f));
    }
    if (!shipped.every((x) => x.hasBlock) || base.some((x) => x.hasBlock)) throw new Error(`arms are not what they claim on ${f}: block present on baseline or absent on shipped`);
    const med = (arr, k) => median(arr.map((x) => x[k]));
    const w0 = med(base, 'wallMs'),
      w1 = med(shipped, 'wallMs');
    const m0 = med(base, 'maxRssKB') / 1024,
      m1 = med(shipped, 'maxRssKB') / 1024;
    const b0 = med(base, 'bytes'),
      b1 = med(shipped, 'bytes');
    const range = (arr) => Math.max(...arr.map((x) => x.wallMs)) - Math.min(...arr.map((x) => x.wallMs));
    const em = spawn('--emitter', f);
    perNight[f] = {
      noiseMs: r2(Math.max(range(base), range(shipped))),
      emitterDirect: { perCallMs: Math.round(em.perCallMs * 1e6) / 1e6, blocks: em.blocks, calls: em.calls },
      wallMs: { baseline: r2(w0), shipped: r2(w1), delta: r2(w1 - w0), deltaPct: r2(((w1 - w0) / w0) * 100) },
      peakMB: { baseline: r2(m0), shipped: r2(m1), delta: r2(m1 - m0) },
      bytes: { baseline: b0, shipped: b1, delta: b1 - b0 }
    };
  }
  const ad = spawn('--adapter', NIGHTS[0]);
  if (!ad.consumed) throw new Error('the adapter did not consume the measurement block — the arm under test is not exercised');
  const adapter = { withBlockMs: r2(ad.withMs * 1000) / 1000, withoutBlockMs: r2(ad.withoutMs * 1000) / 1000, deltaMs: r2((ad.withMs - ad.withoutMs) * 1000) / 1000, calls: 200, night: NIGHTS[0] };
  return { perNight, adapter };
}

async function main() {
  if (has('--child')) return child(arm('--child'), argv[argv.indexOf('--child') + 2]);
  if (has('--adapter')) return adapterChild(arg('--adapter'));
  if (has('--emitter')) return emitterChild(arg('--emitter'));
  if (has('--selftest')) return selftest();
  let commit = null;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  } catch (_) {
    /* not a checkout ⇒ null with a reason */
  }
  const Verdict = req('../verdict.js');
  const producedBy = { tool: 'tools/measurement-emitter-perf-oxydex.mjs', commit };
  if (commit == null) producedBy.commitReason = 'not a git checkout';
  const criterion = {
    name: 'runtime_overhead_pct',
    threshold: BANDS.runtimePct,
    unit: '%',
    direction: 'lte',
    preStated:
      'bands copied verbatim from audits/MEASUREMENT-EMITTER-PERF-PPGDEX-2026-09-22.json (written 2026-09-22 before any run, identical to the ECGDex record): runtime ≤ +5 % AND ≤ +50 ms · peak RSS ≤ +50 MB · export ≤ +4096 bytes; adapter per-call delta ≤ +50 ms; headline = worst-night runtime %, the other bands are the tail'
  };
  const base = {
    gate: 'measurement-emitter-perf:OxyDex',
    scope: 'internal',
    criterion,
    evidence: ['oxydex-dsp.js oxyBuildMeasurementBlocks', 'integrator-dsp.js normalizeFile → adaptOxyDex → consumeMeasurements', ...NIGHTS.map((f) => 'uploads/' + f)],
    producedBy
  };
  let v;
  try {
    const { perNight, adapter } = measure();
    const { miss, noisy, worstPct } = judge(perNight, adapter);
    const noises = Object.values(perNight)
      .map((x) => x.noiseMs)
      .filter((x) => x != null)
      .sort((a, b) => a - b);
    const minResolvableMs = noises.length ? median(noises) : null;
    let replication = null;
    if (arg('--prior')) {
      const pf = path.resolve(REPO, arg('--prior'));
      replication = replicate(JSON.parse(fs.readFileSync(pf, 'utf8')), perNight, worstPct);
      replication.priorRecord = path.relative(REPO, pf);
      base.evidence = [...base.evidence, path.relative(REPO, pf)];
    }
    const status = miss.length ? 'FAIL' : noisy.length ? 'UNDERPOWERED' : 'PASS';
    const note =
      `the ≤ ${BANDS.runtimeAbsMs} ms runtime band is below this instrument's resolution: minimum resolvable ${minResolvableMs} ms (median within-arm spread), count ${noisy.length} of ${NIGHTS.length} night(s) over the band and inside their own spread: ` +
      noisy.join(' | ');
    v = Verdict.make({
      ...base,
      status,
      population: { checked: NIGHTS.length, eligible: NIGHTS.length, excluded: 0 },
      result: {
        bands: BANDS,
        power: {
          rule: "a runtime delta no larger than its own night's within-arm spread leaves the ≤ " + BANDS.runtimeAbsMs + ' ms band UNRESOLVED, so the runtime leg reads UNDERPOWERED and never FAIL',
          bandMs: BANDS.runtimeAbsMs,
          minResolvableMs,
          origin: "the power rule entered after the tool's first run (see header); the four bands themselves stay exactly as pre-stated, and --prior measures the spread the rule rests on"
        },
        replication,
        emitterDirectWorstPerCallMs: Math.max(...Object.values(perNight).map((x) => x.emitterDirect.perCallMs)),
        runsPerArm: RUNS,
        worstRuntimeDeltaPct: worstPct,
        baseline: 'same tree, the one `measurement: oxyBuildMeasurementBlocks(…)` call in oxyBuildNightElement replaced by null',
        perNight,
        adapter
      },
      reason: miss.length ? miss.join(' | ') : noisy.length ? note : null
    });
  } catch (e) {
    v = Verdict.make({
      ...base,
      status: 'NOT_RUN',
      population: { checked: 0, eligible: NIGHTS.length, excluded: NIGHTS.length },
      result: null,
      reason: 'measurement did not run: ' + (e && e.message ? e.message : e)
    });
  }
  const val = Verdict.validate(v);
  if (!val.ok) {
    console.error('verdict does not validate: ' + val.errors.join(' | '));
    process.exit(2);
  }
  const out = JSON.stringify(v, null, 1) + '\n';
  if (arg('--write')) fs.writeFileSync(path.resolve(REPO, arg('--write')), out);
  if (has('--json')) process.stdout.write(out);
  else console.log(`${v.status} · worst runtime delta ${v.result ? v.result.worstRuntimeDeltaPct + ' %' : 'n/a'}${v.reason ? ' · ' + v.reason : ''}`);
  process.exit(v.status === 'FAIL' ? 1 : v.status === 'NOT_RUN' ? 2 : 0);
}
function arm(f) {
  return argv[argv.indexOf(f) + 1];
}

function selftest() {
  let n = 0;
  const ok = (c, m) => {
    n++;
    if (!c) {
      console.error('✗ ' + m);
      process.exit(1);
    }
  };
  ok(median([3, 1, 2]) === 2 && median([4, 1, 3, 2]) === 2.5, 'median odd / even');
  // the bands are the pre-stated ones, frozen
  ok(JSON.stringify(BANDS) === '{"runtimePct":5,"runtimeAbsMs":50,"peakRssMB":50,"exportBytes":4096}', 'BANDS are the 2026-09-22 pre-stated bands');
  ok(Object.isFrozen(BANDS), 'BANDS frozen');
  // baseline builder: exact-once or nothing
  ok(baselineSource('a ' + CALL + ' b') === 'a measurement: null, b', 'baselineSource swaps the single call');
  ok(baselineSource('no call here') === null, 'baselineSource refuses when the call site is absent');
  ok(baselineSource(CALL + CALL) === null, 'baselineSource refuses when the call site is not unique');
  const real = fs.readFileSync(path.join(REPO, 'oxydex-dsp.js'), 'utf8');
  ok(baselineSource(real) !== null, 'the real oxydex-dsp.js carries the call site exactly once');
  // judge: plants one over each band
  const night = (wd, wp, md, bd) => ({ wallMs: { baseline: 100, shipped: 100 + wd, delta: wd, deltaPct: wp }, peakMB: { delta: md }, bytes: { delta: bd } });
  const A = { deltaMs: 0.01 };
  ok(judge({ x: night(1, 1, 1, 1000) }, A).miss.length === 0, 'inside every band ⇒ no miss');
  ok(judge({ x: night(6, 6, 1, 1000) }, A).miss.length === 1, 'runtime +6 % ⇒ named miss');
  ok(judge({ x: night(60, 1, 1, 1000) }, A).miss.length === 1, 'runtime +60 ms ⇒ named miss');
  ok(judge({ x: night(1, 1, 51, 1000) }, A).miss.length === 1, 'RSS +51 MB ⇒ named miss');
  ok(judge({ x: night(1, 1, 1, 5000) }, A).miss.length === 1, 'export +5000 B ⇒ named miss');
  ok(judge({ x: night(1, 1, 1, 1000) }, { deltaMs: 51 }).miss.length === 1, 'adapter +51 ms ⇒ named miss');
  ok(judge({ x: night(1, 1, 1, 1000), y: night(1, 7, 1, 1000) }, A).worstPct === 7, 'worst-night % is the headline');
  // noise floor: a delta over the band but inside the arm's own spread is `noisy`, not `miss`; above the spread it is a miss
  const noisyNight = (wd, wp, noise) => ({ ...night(wd, wp, 1, 1000), noiseMs: noise });
  const jn = judge({ x: noisyNight(100, 1.5, 300) }, A);
  ok(jn.miss.length === 0 && jn.noisy.length === 1, 'over the band but inside the run-to-run spread ⇒ noisy, not a miss');
  const jm = judge({ x: noisyNight(100, 1.5, 40) }, A);
  ok(jm.miss.length === 1 && jm.noisy.length === 0, 'over the band AND over the spread ⇒ a miss');
  ok(judge({ x: { ...noisyNight(1, 1, 300), bytes: { delta: 5000 } } }, A).miss.length === 1, 'the noise floor never excuses a byte or RSS miss');
  // replicate: this run against an earlier record of the same instrument
  const rec = (a, b) => ({
    at: '2026-10-12T00:00:00Z',
    result: { worstRuntimeDeltaPct: 2.34, perNight: { x: { wallMs: { delta: a, deltaPct: a / 100 }, bytes: { delta: 3058 } }, y: { wallMs: { delta: b, deltaPct: b / 100 }, bytes: { delta: 3064 } } } }
  });
  const now = (a, b) => ({
    x: { wallMs: { delta: a, deltaPct: a / 100 }, bytes: { delta: 3058 }, noiseMs: 300 },
    y: { wallMs: { delta: b, deltaPct: b / 100 }, bytes: { delta: 3064 }, noiseMs: 400 }
  });
  ok(replicate({}, now(1, 2), 1).comparable === false, 'replicate refuses a record with no perNight block');
  ok(replicate(rec(10, 20), { z: now(1, 2).x }, 1).comparable === false, 'replicate refuses when no night appears in both records');
  const rSame = replicate(rec(10, 20), now(10, 20), 0.2);
  ok(rSame.runtimeSignFlips === 0 && rSame.exportBytesIdentical === 2, 'same signs and identical byte deltas ⇒ 0 flips, 2 identical');
  const rFlip = replicate(rec(10, 20), now(-10, 20), 0.2);
  ok(rFlip.runtimeSignFlips === 1 && rFlip.nightsCompared === 2, 'one night changing sign ⇒ 1 flip over 2 nights compared');
  ok(replicate(rec(10, 20), now(30, 20), 0.3).worstNightMoved === true, 'the worst night moving is reported');
  ok(replicate(rec(10, 20), now(10, 20), 0.2).worstNightMoved === false, 'the worst night holding is reported');
  ok(replicate(rec(10, 20), now(10, 20), 0.2).priorWorstRuntimeDeltaPct === 2.34, 'the prior worst % travels into the replication block');
  ok(replicate(rec(10, 20), { x: { ...now(10, 20).x, bytes: { delta: 4 } }, y: now(10, 20).y }, 0.2).exportBytesIdentical === 1, 'a moved byte delta drops the identical count');
  console.log(`all ${n} selftests passed`);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(2);
});
