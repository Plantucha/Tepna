#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * ppg-bridge-hrv-validate.mjs — does O2RING-PPG-GAP §4 move finger HRV toward or away from chest ECG?
 * ------------------------------------------------------------------------------------------------
 * §4 excludes intervals that BRIDGE a beat §3 removed, instead of letting `correctRR` median-fill them.
 * That touches HRV, and this brief's standard for an HRV-moving change (§5) is **per-epoch RMSSD/SDNN
 * agreement against paired chest ECG** — not cross-modality beat matching, which fails by construction
 * (the finger pulse arrives ~250 ms after the R-peak and that transit lag varies beat-to-beat, so a
 * fixed tolerance scores ~0.5 sensitivity — the wall the original WIP author hit). Comparing HRV
 * METRICS per epoch lets the lag cancel in the differences.
 *
 * WHAT IT DOES. For each finger capture: runs the SHIPPED `parsePPG` + `analyze` under BOTH code
 * versions in two co-loaded realms (OLD = a checkout of ppgdex-dsp.js without §4, NEW = the working
 * tree), finds the best-overlapping H10 ECG, and compares the node's OWN per-epoch HRV (`res.epochs`)
 * against ECG R-R binned onto the same ABSOLUTE clock.
 *
 * READ `res.epochs`, NOT `res.nn`. The first version of this tool compared `nn`/`tt` and reported all
 * 18 firing files IDENTICAL to 2 dp — a result that looked like a clean "unmoved" verdict and was
 * actually the tool measuring a series §4 cannot touch. §4 acts through `cleanMask`, which gates which
 * intervals reach the HRV metrics; `nn` is the corrected series and is byte-identical either way. A
 * whole-field diff (OLD vs NEW, every key) settled it: on a 25-drop file the ONLY field that moves is
 * `nGapSpanIntervals` — but across the corpus `sdnn`, `meanRR`, `pnn50` and `ellArea` move on 10 of 18
 * files. An "everything identical" result from a differential tool is a red flag about the tool, not a
 * finding about the code.
 *
 * THE VERDICT IT SUPPORTS is "unmoved-or-improved": §4 removes fabricated intervals, so it must not
 * make agreement worse. An epoch where §4 changes nothing is the expected majority case — §4 only acts
 * where `gapBeats` dropped a beat, which is rare per-epoch even on files where it fires. Epochs with no
 * §4 activity are reported as `=` and are evidence of a bounded blast radius, not of nothing happening.
 *
 * WHY A COMMITTED TOOL. The §3 validation that settled this same question was run from an uncommitted
 * scratchpad (`finger-hrv-vs-ecg.mjs`) which no longer exists, so its numbers cannot be re-derived —
 * and two sibling O2Ring tools shipped with a dead absolute path baked in and were unrunnable for
 * months while briefs cited them as evidence. A validation nobody can re-run is a claim, not a
 * measurement. ROOT is derived from this file's location; `--selftest` needs no corpus.
 *
 * USAGE
 *   node tools/ppg-bridge-hrv-validate.mjs --dir <captures> [--old <ref>] [--top N]
 *   node tools/ppg-bridge-hrv-validate.mjs --selftest
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const SELFTEST = has('--selftest');
const DIR = opt('--dir', null);
const OLD_REF = opt('--old', 'origin/main');
const TOP = +opt('--top', 20);
const EPOCH_SEC = 300;

const B = await import(join(ROOT, 'tools/build-core.js'));
const classicify = B.classicify || B.default?.classicify;

/* A realm per code version. `srcOverride` swaps ONE file's text (ppgdex-dsp.js) so OLD and NEW differ
   by exactly the change under test and nothing else — same clock, same registry, same morphology. */
function realm(files, srcOverride) {
  const sb = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  sb.window = sb;
  sb.globalThis = sb;
  sb.self = sb;
  sb.document = { getElementById: () => null, querySelector: () => null, createElement: () => ({ style: {}, appendChild() {} }), head: { appendChild() {} }, addEventListener() {} };
  sb.navigator = { userAgent: 'v' };
  sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const ctx = vm.createContext(sb);
  for (const f of files) {
    const text = srcOverride && srcOverride.file === f ? srcOverride.text : readFileSync(join(ROOT, f), 'utf8');
    vm.runInContext(classicify(text), ctx, { filename: f });
  }
  return sb;
}
const PPG_FILES = ['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ppgdex-registry.js', 'ppgdex-morph.js', 'ppgdex-dsp.js'];
const ECG_FILES = ['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ecgdex-registry.js', 'ecgdex-morph.js', 'ecgdex-dsp.js'];

/* ── HRV over a set of intervals, in ms. Sample SD (÷ n−1), matching the node's own convention. ── */
function rmssd(ivMs) {
  if (ivMs.length < 2) return null;
  let s = 0;
  for (let i = 1; i < ivMs.length; i++) {
    const d = ivMs[i] - ivMs[i - 1];
    s += d * d;
  }
  return Math.sqrt(s / (ivMs.length - 1));
}
function sdnn(ivMs) {
  const n = ivMs.length;
  if (n < 2) return null;
  const m = ivMs.reduce((a, b) => a + b, 0) / n;
  let s = 0;
  for (const v of ivMs) s += (v - m) * (v - m);
  return Math.sqrt(s / (n - 1));
}
const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

/* Bin (absoluteMs, intervalMs) pairs into fixed epochs keyed by epoch index off a shared origin. */
function epochsOf(pairs, originMs) {
  const by = new Map();
  for (const [tMs, iv] of pairs) {
    const e = Math.floor((tMs - originMs) / 1000 / EPOCH_SEC);
    if (!by.has(e)) by.set(e, []);
    by.get(e).push(iv);
  }
  return by;
}

/* The node's OWN per-epoch HRV — `res.epochs[]` carries {tMin, rmssd, sdnn, meanRR, pnn50, …}
   computed downstream of `cleanMask`, which is the gate §4 actually moves. Returns each epoch keyed by
   its ABSOLUTE start so it can be matched to ECG without either series' t0 leaking in. */
function fingerEpochs(PD, text) {
  const rec = PD.parsePPG(text);
  const res = PD.analyze(rec);
  const eps = res.epochs || [];
  const lenMin = eps.length > 1 ? eps[1].tMin - eps[0].tMin : 5;
  const out = new Map();
  for (const e of eps) {
    if (e == null || e.rmssd == null || e.sdnn == null) continue; // withheld epoch — never a fabricated 0
    out.set(rec.t0Ms + e.tMin * 60000, { rmssd: e.rmssd, sdnn: e.sdnn });
  }
  return { epochs: out, lenMs: lenMin * 60000, t0Ms: rec.t0Ms, durSec: rec.durSec, nGapBeats: res.nGapBeats, nGapSpanIntervals: res.nGapSpanIntervals };
}
function ecgPairs(ED, text) {
  const rec = ED.parseECG(text);
  const res = ED.analyze(rec);
  const pk = res.peaks || [];
  const out = [];
  for (let k = 1; k < pk.length; k++) {
    const dtMs = ((pk[k] - pk[k - 1]) / rec.fs) * 1000;
    if (dtMs > 300 && dtMs < 2000) out.push([rec.t0Ms + (pk[k] / rec.fs) * 1000, dtMs]);
  }
  return { pairs: out, t0Ms: rec.t0Ms, durSec: rec.durSec };
}

/* ════════════════════════════════════ SELFTEST ════════════════════════════════════
   No corpus, no realms: pins the arithmetic and — the load-bearing part — that the
   epoch binner keys off an ABSOLUTE origin, so two series recorded at different device
   t0 land in the SAME epoch when they cover the same wall-clock minutes. Getting that
   wrong is how a comparison silently compares different times and reports a difference
   that is really an offset. */
function selftest() {
  let fail = 0;
  const ok = (n, c, d) => {
    console.log((c ? '  ok   ' : '  FAIL ') + n + (d != null && !c ? '  — ' + d : ''));
    if (!c) fail++;
  };
  ok('rmssd of a constant series is 0', rmssd([800, 800, 800, 800]) === 0);
  // successive differences [100,-100,100] ⇒ sqrt((10000*3)/3) = 100
  ok('rmssd is the RMS of SUCCESSIVE differences (÷ n−1)', Math.abs(rmssd([800, 900, 800, 900]) - 100) < 1e-9, String(rmssd([800, 900, 800, 900])));
  ok('sdnn is the sample SD (÷ n−1), not the population SD', Math.abs(sdnn([800, 900]) - Math.sqrt(5000)) < 1e-9, String(sdnn([800, 900])));
  ok('both are null below 2 intervals — never a fabricated 0', rmssd([800]) === null && sdnn([800]) === null);
  ok('median of an even-length set averages the middle pair', median([1, 2, 3, 4]) === 2.5);
  ok('median of an empty set is null, not NaN', median([]) === null);
  /* THE INVARIANT: absolute-clock binning. Two devices whose t0 differ by 100 s, both covering the
     same wall-clock window, must land in the same epoch — the offset must NOT shift the bins. */
  const O = Date.UTC(2026, 0, 1, 0, 0, 0);
  const a = epochsOf(
    [
      [O + 10_000, 800],
      [O + 310_000, 800]
    ],
    O
  );
  const b = epochsOf(
    [
      [O + 10_000, 810],
      [O + 310_000, 810]
    ],
    O
  );
  ok('two series on the same absolute clock share epoch keys', [...a.keys()].join(',') === [...b.keys()].join(','), [...a.keys()] + ' vs ' + [...b.keys()]);
  ok('…and a sample 300 s later is in the NEXT epoch, not the same one', a.has(0) && a.has(1), [...a.keys()].join(','));
  /* …and the binner must key off the SHARED origin, not each series' own first sample: keying off
     self would put both series' first sample in epoch 0 and hide a real time offset. */
  const late = epochsOf([[O + 310_000, 800]], O);
  ok('a series that starts late does NOT get re-based to epoch 0', !late.has(0) && late.has(1), [...late.keys()].join(','));
  console.log(fail ? '\nselftest: ' + fail + ' FAILED' : '\nselftest: all green');
  return fail;
}
if (SELFTEST) process.exit(selftest());

/* ════════════════════════════════════ CORPUS RUN ════════════════════════════════════ */
if (!DIR) {
  console.error('usage: node tools/ppg-bridge-hrv-validate.mjs --dir <captures> [--old <ref>] [--top N]  |  --selftest');
  process.exit(2);
}
const oldSrc = execFileSync('git', ['-C', ROOT, 'show', OLD_REF + ':ppgdex-dsp.js'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const newSrc = readFileSync(join(ROOT, 'ppgdex-dsp.js'), 'utf8');
if (oldSrc === newSrc) {
  console.error('OLD (' + OLD_REF + ') and NEW ppgdex-dsp.js are identical — nothing to compare.');
  process.exit(2);
}
const OLD = realm(PPG_FILES, { file: 'ppgdex-dsp.js', text: oldSrc }).PPGDSP;
const NEW = realm(PPG_FILES).PPGDSP;
const ECG = realm(ECG_FILES).ECGDSP;

const walk = (d, out = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push({ p, size: st.size });
  }
  return out;
};
const all = walk(DIR);
const ppgFiles = all
  .filter((f) => /O2Ring.*_PPG\.txt$/i.test(f.p))
  .sort((a, b) => b.size - a.size)
  .slice(0, TOP);
const ecgFiles = all.filter((f) => /H10.*_ECG\.txt$/i.test(f.p));

console.log('O2RING-PPG-GAP §4 — per-epoch finger HRV vs chest ECG, OLD (' + OLD_REF + ') vs NEW\n');
console.log('file                                              eps  ΔRMSSD_old ΔRMSSD_new    ΔSDNN_old  ΔSDNN_new  verdict');

let better = 0,
  worse = 0,
  same = 0,
  mixed = 0,
  inert = 0,
  noEcg = 0,
  rows = 0;
for (const f of ppgFiles) {
  let fo, fn;
  try {
    const text = readFileSync(f.p, 'utf8');
    fo = fingerEpochs(OLD, text);
    fn = fingerEpochs(NEW, text);
  } catch (_e) {
    continue;
  }
  if (!fn.nGapBeats) continue; // §4 cannot act here — not a validation case
  // best-overlapping ECG by absolute time
  const fw = [fn.t0Ms, fn.t0Ms + (fn.durSec || 0) * 1000];
  let best = null;
  for (const e of ecgFiles) {
    let er;
    try {
      er = ecgPairs(ECG, readFileSync(e.p, 'utf8'));
    } catch (_e) {
      continue;
    }
    const ew = [er.t0Ms, er.t0Ms + (er.durSec || 0) * 1000];
    const lo = Math.max(fw[0], ew[0]),
      hi = Math.min(fw[1], ew[1]);
    const ov = hi > lo ? (hi - lo) / 1000 : 0;
    if (ov > EPOCH_SEC && (!best || ov > best.ov)) best = { ov, er };
  }
  if (!best) {
    noEcg++;
    continue;
  }
  /* Match each finger epoch to the ECG R-R falling in the SAME absolute window. Only epochs where §4
     actually changed the finger HRV are scored — an epoch it did not touch contributes an identical
     term to both sides and would only dilute the comparison toward "no difference". */
  const dRo = [],
    dRn = [],
    dSo = [],
    dSn = [];
  let touched = 0;
  for (const [absStart, oldE] of fo.epochs) {
    const newE = fn.epochs.get(absStart);
    if (!newE) continue;
    if (oldE.rmssd === newE.rmssd && oldE.sdnn === newE.sdnn) continue; // §4 inert in this epoch
    touched++;
    const iv = [];
    for (const [tMs, v] of best.er.pairs) if (tMs >= absStart && tMs < absStart + fn.lenMs) iv.push(v);
    if (iv.length < 30) continue;
    const er = rmssd(iv),
      es = sdnn(iv);
    if (er == null || es == null) continue;
    dRo.push(Math.abs(oldE.rmssd - er));
    dRn.push(Math.abs(newE.rmssd - er));
    dSo.push(Math.abs(oldE.sdnn - es));
    dSn.push(Math.abs(newE.sdnn - es));
  }
  if (!touched) {
    inert++;
    continue;
  }
  if (!dRo.length) {
    noEcg++;
    continue;
  }
  const mRo = median(dRo),
    mRn = median(dRn),
    mSo = median(dSo),
    mSn = median(dSn);
  const eps = 1e-9;
  const rBetter = mRn < mRo - eps,
    rWorse = mRn > mRo + eps,
    sBetter = mSn < mSo - eps,
    sWorse = mSn > mSo + eps;
  const verdict = rWorse || sWorse ? (rBetter || sBetter ? 'mixed' : 'WORSE') : rBetter || sBetter ? 'BETTER' : '=';
  if (verdict === 'BETTER') better++;
  else if (verdict === 'WORSE') worse++;
  else if (verdict === 'mixed') mixed++;
  else same++;
  rows++;
  console.log(
    `${f.p.split('/').pop().slice(0, 46).padEnd(46)} ${String(dRo.length).padStart(4)} ${mRo.toFixed(2).padStart(11)} ${mRn.toFixed(2).padStart(10)} ${mSo.toFixed(2).padStart(12)} ${mSn.toFixed(2).padStart(10)}  ${verdict}`
  );
}
console.log(`\n${rows} scored file(s)  ·  BETTER ${better} · unchanged ${same} · mixed ${mixed} · WORSE ${worse}`);
if (inert) console.log(`${inert} firing file(s) where §4 moved NO epoch HRV — accounting only (nGapSpanIntervals), nothing to score.`);
if (noEcg) console.log(`${noEcg} firing file(s) had no overlapping ECG epoch — not counted either way.`);
console.log(
  '\nΔ is |finger − ECG| per 5-min epoch, median over epochs; lower is closer to the chest reference.\n' +
    'Only epochs where §4 CHANGED the finger HRV are scored; epochs it left alone would contribute an\n' +
    'identical term to both sides and dilute the comparison toward "no difference". The claim this run\n' +
    'can support is unmoved-or-improved — a WORSE row is a blocker, because §4 removes intervals it\n' +
    'argues are fabricated, so it must not move the record away from the chest reference.'
);
