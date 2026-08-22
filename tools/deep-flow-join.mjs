#!/usr/bin/env node
/*
 * tools/deep-flow-join.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * DEEP-epoch × flow-event join, with a PER-COHORT clock offset instead of one global shift.
 *
 * DEEP-STAGE-DESAT-CONFOUND §9.6 asks what share of Deep epochs could carry unscored apnea.
 * §11a answered it by sweeping ONE global shift over all nights and reading the maximum as a
 * bound. §11b showed that family cannot contain the truth: the ResMed offset is BIMODAL across
 * this corpus (~ -39.5 min before ~2026-07-30, ~ +21.2 min after — a one-hour step), so no single
 * shift aligns both cohorts and aligning either throws the other outside the swept range.
 *
 * ⚠️ SIGN CONVENTION IS NOT ASSUMED. Applying an offset with the wrong sign is the easiest way to
 * produce a confident wrong number here, so the tool runs BOTH directions and reports both. The
 * correct direction is the one under which the two cohorts CONVERGE — a misapplied sign doubles
 * the residual misalignment on one cohort and leaves the other worse, so the cohorts diverge.
 * That is a measured discriminator, not a convention read off a comment.
 *
 * ⚠ THIS IS NOW THE REPO'S SECOND CLOCK-OFFSET MODEL, AND IT IS THE AD-HOC ONE.
 * `integrator-dsp.js:4834 fitClockOffsetSegments` (#1621, exported + gated) fits the drift WITHIN
 * step-bounded segments and returns per-night `source: measured | interpolated | refused`, refusing
 * across a step instead of smearing one number over the corpus. This tool's two hardcoded cohort
 * constants cannot express drift inside a cohort and cannot refuse. Wiring this to consume it is the
 * owed next step (brief §11d); until then prefer its answer over these defaults where they disagree.
 *
 * The defaults are not invented, though: post ≈ +21.2 min is #1581's ACC↔BRP cross-correlation, which
 * agrees with #1621's independently-measured −21.9 ± 0.6 min (opposite sign convention) to 0.7 min.
 *
 * Inputs (nothing is committed — both are gitignored corpora):
 *   --trio <dir>   uploads/trio-shaped: <night>/ECGDex_<night>.node-export.json  (5-min sleepStages)
 *   --eve  <dir>   flat directory of ResMed *_EVE.edf
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/* Realm builder lifted verbatim from tools/cpap-corpus.mjs — imported there it would run that
   file's CLI main, so it is duplicated rather than imported. Keep the two in step. */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DexBuild = createRequire(import.meta.url)('./build-core.js');
function cpapRealm() {
  const noop = () => {};
  const el = () => ({
    style: {},
    dataset: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop,
    getAttribute: () => null,
    appendChild: noop,
    append: noop,
    removeChild: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop
  });
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    crypto: globalThis.crypto,
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
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop, clear: noop }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  // NOTE: cpapdex-cross.js MUST be co-loaded — buildLongitudinal() reaches CPAPCross
  // through the browser global only (cpapdex-dsp.js:227), so a plain require() realm
  // gets crossNight:null SILENTLY. See the brief's §F5.
  const CO_LOAD = [
    'kernel-constants.js',
    'ganglior-provenance.js',
    'signal-frame.js',
    'metric-registry.js',
    'clock.js',
    'crossnight-envelope.js',
    'cpapdex-registry.js',
    'cpapdex-edf.js',
    'cpapdex-dsp.js',
    'cpapdex-cross.js',
    'cpapdex-fusion.js'
  ];
  for (const f of CO_LOAD) vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const TRIO = arg('--trio', 'uploads/trio');
const EVE = arg('--eve', null);
const STEP = arg('--step', '2026-07-30'); // cohort boundary
const PRE = Number(arg('--pre-min', -39.5)); // integrator-dsp.js:3743
const POST = Number(arg('--post-min', 21.2)); // measured, PR #1581
if (!EVE) {
  console.error('usage: node tools/deep-flow-join.mjs --eve <dir> [--trio uploads/trio]');
  process.exit(2);
}

const ctx = cpapRealm();
const EPOCH_MIN = 5;

function eveFor(night) {
  // night = YYYY-MM-DD
  const key = night.replace(/-/g, '');
  return fs
    .readdirSync(EVE)
    .filter((f) => f.startsWith(key) && /_EVE\.edf$/.test(f))
    .map((f) => path.join(EVE, f));
}

function eventsFor(night) {
  const out = [];
  for (const f of eveFor(night)) {
    const b = fs.readFileSync(f);
    let edf;
    try {
      edf = ctx.CpapEdf.readEDF(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    } catch {
      continue;
    }
    for (const e of ctx.CpapDsp.eveEvents(edf.annotations, 0)) {
      if (e.tMs != null && isFinite(e.tMs)) out.push({ tMs: e.tMs, durSec: e.durSec || 0, type: e.type });
    }
  }
  return out;
}

/* One night, one applied offset → which 5-min epochs contain >=1 flow event, split Deep vs not. */
function joinNight(night, shiftMin) {
  const p = path.join(TRIO, night, `ECGDex_${night}.node-export.json`);
  if (!fs.existsSync(p)) return null;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const stages = (j.timeseries && j.timeseries.sleepStages) || j.sleepStages;
  const t0 = j.recording && j.recording.startEpochMs;
  if (!Array.isArray(stages) || !stages.length || !isFinite(t0)) return null;
  const ev = eventsFor(night);
  if (!ev.length) return null;
  const hit = new Set();
  for (const e of ev) {
    const rel = (e.tMs + shiftMin * 60000 - t0) / 60000; // minutes into the ECG record
    const a = Math.floor(rel / EPOCH_MIN) * EPOCH_MIN;
    const b = Math.floor((rel + (e.durSec || 0) / 60) / EPOCH_MIN) * EPOCH_MIN;
    for (let m = a; m <= b; m += EPOCH_MIN) hit.add(m);
  }
  let deep = 0,
    deepHit = 0,
    other = 0,
    otherHit = 0;
  for (const s of stages) {
    const isDeep = /deep|n3/i.test(s.stage || '');
    const h = hit.has(s.tMin);
    if (isDeep) {
      deep++;
      if (h) deepHit++;
    } else {
      other++;
      if (h) otherHit++;
    }
  }
  return { deep, deepHit, other, otherHit, nEv: ev.length };
}

const nights = fs
  .readdirSync(TRIO)
  .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  .sort();
const cohortOf = (n) => (n < STEP ? 'pre' : 'post');

function runAll(sign) {
  const agg = { pre: { deep: 0, deepHit: 0, other: 0, otherHit: 0, n: 0 }, post: { deep: 0, deepHit: 0, other: 0, otherHit: 0, n: 0 } };
  for (const n of nights) {
    const c = cohortOf(n);
    const r = joinNight(n, sign * (c === 'pre' ? PRE : POST));
    if (!r) continue;
    const a = agg[c];
    a.deep += r.deep;
    a.deepHit += r.deepHit;
    a.other += r.other;
    a.otherHit += r.otherHit;
    a.n++;
  }
  return agg;
}
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : '—');

console.log(`▸ deep-flow join · cohort boundary ${STEP} · pre ${PRE} min · post ${POST} min`);
console.log(`  trio=${TRIO}  eve=${EVE}  nights=${nights.length}\n`);
for (const sign of [+1, -1]) {
  const a = runAll(sign);
  console.log(`  offset sign ${sign > 0 ? '+' : '−'} (pre ${sign * PRE} min, post ${sign * POST} min)`);
  for (const c of ['pre', 'post']) {
    const g = a[c];
    console.log(
      `    ${c.padEnd(4)} n=${String(g.n).padStart(2)}  Deep ${String(g.deepHit).padStart(4)}/${String(g.deep).padStart(4)} = ${pct(g.deepHit, g.deep).padStart(5)} %   non-Deep ${pct(g.otherHit, g.other).padStart(5)} %`
    );
  }
  const d = Math.abs(Number(pct(a.pre.deepHit, a.pre.deep)) - Number(pct(a.post.deepHit, a.post.deep)));
  console.log(`    → cohort Deep%% gap = ${isFinite(d) ? d.toFixed(1) : '—'} pp\n`);
}
console.log('  The correct sign is the one with the SMALLER cohort gap: a misapplied sign adds');
console.log('  ~2x the offset to one cohort, so the two populations separate rather than converge.');

/* ── --sweep: the point estimate is not the claim; the BOUND over plausible offsets is ──────────
   Both cohort offsets are estimates (-39.5 from integrator-dsp.js, +21.2 measured over 23 nights),
   so a single pair of numbers yields a single Deep% that reads more precise than it is. Sweeping
   the plausible range is what separates a robust conclusion from one that happens to hold at the
   centre — measured here: the Deep BOUND holds everywhere, while "Deep sits below non-Deep" does
   NOT, flipping at both edges. Publish the bound; do not publish the ordering. */
if (process.argv.includes('--sweep')) {
  const PRES = [-45, -42, -39.5, -37, -34];
  const POSTS = [16, 21.2, 26];
  let dMin = Infinity,
    dMax = -Infinity,
    flips = 0,
    cells = 0;
  console.log('\n▸ SENSITIVITY — Deep %% over the plausible offset space (correct sign only)\n');
  console.log('    pre     post    preDeep/nonDeep     postDeep/nonDeep');
  for (const pre of PRES) {
    for (const post of POSTS) {
      const agg = { pre: { deep: 0, deepHit: 0, other: 0, otherHit: 0 }, post: { deep: 0, deepHit: 0, other: 0, otherHit: 0 } };
      for (const n of nights) {
        const c = cohortOf(n);
        const r = joinNight(n, c === 'pre' ? pre : post);
        if (!r) continue;
        const a = agg[c];
        a.deep += r.deep;
        a.deepHit += r.deepHit;
        a.other += r.other;
        a.otherHit += r.otherHit;
      }
      const dp = (100 * agg.pre.deepHit) / agg.pre.deep,
        np = (100 * agg.pre.otherHit) / agg.pre.other;
      const dq = (100 * agg.post.deepHit) / agg.post.deep,
        nq = (100 * agg.post.otherHit) / agg.post.other;
      for (const [d, nd] of [
        [dp, np],
        [dq, nq]
      ]) {
        dMin = Math.min(dMin, d);
        dMax = Math.max(dMax, d);
        cells++;
        if (d > nd) flips++;
      }
      console.log(
        `    ${String(pre).padStart(6)}  ${String(post).padStart(5)}    ${dp.toFixed(1).padStart(5)} / ${np.toFixed(1).padStart(5)}       ${dq.toFixed(1).padStart(5)} / ${nq.toFixed(1).padStart(5)}`
      );
    }
  }
  console.log(`\n    Deep %% BOUND across the whole space: ${dMin.toFixed(1)} – ${dMax.toFixed(1)} %%`);
  console.log(`    cells where Deep EXCEEDS non-Deep: ${flips} of ${cells}`);
  console.log('    ⇒ the bound is robust; the Deep-vs-non-Deep ORDERING is not. Quote the bound only.');
}
