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
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
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
/* `--new <ref>`: the NEW realm from a git ref instead of the working tree, so OLD/NEW can bracket ONE
   commit (`--old X~1 --new X`) and the delta is that commit's alone. Default: the tree, as before. */
const NEW_REF = opt('--new', null);
const TOP = +opt('--top', 20);
/* `--device o2ring|verity`: WHICH optical arm. This tool was written for the O2Ring finger PPG (§4) and
   its file filter said so; pointed at a Verity corpus it scored nothing and said nothing (2026-09-22:
   13 min pinned at an 8 GB cap, 0 rows). Default stays o2ring — byte-identical behaviour. */
const DEVICE = opt('--device', 'o2ring');
/* `--fires gap|any`: which files are validation cases. `gap` (default, §4's rule) scores only files
   where §4's gap-bridging fired; `any` scores every file whose epoch HRV differs between OLD and NEW —
   the right predicate for a change that acts elsewhere (the correctRR fill removal, #2333). */
const FIRES = opt('--fires', 'gap');
export const PPG_PATTERN = { o2ring: /O2Ring.*_PPG\.txt$/i, verity: /(VeritySense|Polar_Sense).*_PPG\.txt$/i };
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
/* First/last wall-clock stamp of a capture file from an 8 KB read at each end — never a parse.
   The ECG for a PPG file is chosen by SPAN OVERLAP from this index, and only the winner is parsed
   (once — memoised by path), which is what keeps a 30-night tree under the 8 GB rule. */
export function fileSpan(p) {
  const sz = statSync(p).size;
  if (!sz) return null;
  const fd = openSync(p, 'r');
  const CH = 8192;
  const head = Buffer.alloc(Math.min(CH, sz));
  readSync(fd, head, 0, head.length, 0);
  const tail = Buffer.alloc(Math.min(CH, sz));
  readSync(fd, tail, 0, tail.length, Math.max(0, sz - tail.length));
  closeSync(fd);
  const stamp = (l) => {
    const m = l.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
  };
  const first = head
    .toString('latin1')
    .split('\n')
    .map(stamp)
    .find((t) => t != null);
  const last = tail
    .toString('latin1')
    .split('\n')
    .map(stamp)
    .filter((t) => t != null)
    .pop();
  return first != null && last != null ? [first, last] : null;
}
/* Pure: the index entry whose span overlaps [lo, hi] the most, or null when none overlaps by more than
   `minSec`. Spans are [firstMs, lastMs]; a file with no readable stamps is skipped, not treated as 0. */
export function bestBySpan(index, lo, hi, minSec) {
  let best = null;
  for (const e of index) {
    if (!e.span) continue;
    const a = Math.max(lo, e.span[0]);
    const b = Math.min(hi, e.span[1]);
    const ov = b > a ? (b - a) / 1000 : 0;
    if (ov > minSec && (!best || ov > best.ov)) best = { ov, e };
  }
  return best;
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
  ok(
    'device filter: a Verity file matches under verity and NOT under o2ring',
    PPG_PATTERN.verity.test('/x/Polar_VeritySense_0C301E3F_20260726_010000_PPG.txt') && !PPG_PATTERN.o2ring.test('/x/Polar_VeritySense_0C301E3F_20260726_010000_PPG.txt')
  );
  ok("device filter: the paper's Polar_Sense_* naming is Verity too", PPG_PATTERN.verity.test('Polar_Sense_0C301E3F_20260616_221114_PPG.txt'));
  const idx = [
    { p: 'a', span: [O, O + 3_600_000] },
    { p: 'b', span: [O + 1_800_000, O + 9_000_000] },
    { p: 'c', span: null }
  ];
  ok('bestBySpan picks the LARGEST overlap, not the first', bestBySpan(idx, O + 1_500_000, O + 7_200_000, 300).e.p === 'b');
  ok('bestBySpan returns null when nothing overlaps by more than minSec', bestBySpan(idx, O + 20_000_000, O + 21_000_000, 300) === null);
  ok('a file with no readable span is skipped, never scored as 0 overlap', bestBySpan([{ p: 'c', span: null }], O, O + 1000, 0) === null);
  console.log(fail ? '\nselftest: ' + fail + ' FAILED' : '\nselftest: all green');
  return fail;
}
if (SELFTEST) process.exit(selftest());

/* ════════════════════════════════════ CORPUS RUN ════════════════════════════════════ */
if (!DIR) {
  console.error('usage: node tools/ppg-bridge-hrv-validate.mjs --dir <captures> [--old <ref>] [--new <ref>] [--device o2ring|verity] [--fires gap|any] [--top N]  |  --selftest');
  process.exit(2);
}
const oldSrc = execFileSync('git', ['-C', ROOT, 'show', OLD_REF + ':ppgdex-dsp.js'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const newSrc = NEW_REF ? execFileSync('git', ['-C', ROOT, 'show', NEW_REF + ':ppgdex-dsp.js'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) : readFileSync(join(ROOT, 'ppgdex-dsp.js'), 'utf8');
if (oldSrc === newSrc) {
  console.error('OLD (' + OLD_REF + ') and NEW ppgdex-dsp.js are identical — nothing to compare.');
  process.exit(2);
}
const OLD = realm(PPG_FILES, { file: 'ppgdex-dsp.js', text: oldSrc }).PPGDSP;
const NEW = realm(PPG_FILES, NEW_REF ? { file: 'ppgdex-dsp.js', text: newSrc } : undefined).PPGDSP;
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
if (!PPG_PATTERN[DEVICE] || !['gap', 'any'].includes(FIRES)) {
  console.error('--device must be o2ring|verity and --fires gap|any');
  process.exit(2);
}
const ppgFiles = all
  .filter((f) => PPG_PATTERN[DEVICE].test(f.p))
  .sort((a, b) => b.size - a.size)
  .slice(0, TOP);
const ecgFiles = all.filter((f) => /H10.*_ECG\.txt$/i.test(f.p));
const ecgIndex = ecgFiles.map((f) => ({ p: f.p, span: fileSpan(f.p) }));
const ecgCache = new Map(); // path → parsed pairs, parsed ONCE
const ecgParsed = (p) => {
  if (!ecgCache.has(p)) ecgCache.set(p, ecgPairs(ECG, readFileSync(p, 'utf8')));
  return ecgCache.get(p);
};
const skipped = { 'parse-error': 0, 'not-a-validation-case (no gap beats)': 0, 'no-ecg-overlap': 0, 'ecg-parse-error': 0 };

console.log('per-epoch ' + DEVICE + ' PPG HRV vs chest ECG, OLD (' + OLD_REF + ') vs NEW (' + (NEW_REF || 'working tree') + ') · fires=' + FIRES + ' · top ' + TOP + '\n');
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
    skipped['parse-error']++;
    continue;
  }
  if (FIRES === 'gap' && !fn.nGapBeats) {
    skipped['not-a-validation-case (no gap beats)']++; // §4 cannot act here
    continue;
  }
  // best-overlapping ECG by absolute time — chosen from the SPAN INDEX, parsed only if it wins
  const fw = [fn.t0Ms, fn.t0Ms + (fn.durSec || 0) * 1000];
  const pick = bestBySpan(ecgIndex, fw[0], fw[1], EPOCH_SEC);
  if (!pick) {
    noEcg++;
    skipped['no-ecg-overlap']++;
    continue;
  }
  let best;
  try {
    best = { ov: pick.ov, er: ecgParsed(pick.e.p) };
  } catch (_e) {
    skipped['ecg-parse-error']++;
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
console.log('SKIPPED (named): ' + JSON.stringify(skipped) + ` · candidates ${ppgFiles.length} · ecg files indexed ${ecgIndex.length}, parsed ${ecgCache.size}`);
if (inert) console.log(`${inert} firing file(s) where §4 moved NO epoch HRV — accounting only (nGapSpanIntervals), nothing to score.`);
if (noEcg) console.log(`${noEcg} firing file(s) had no overlapping ECG epoch — not counted either way.`);
console.log(
  '\nΔ is |finger − ECG| per 5-min epoch, median over epochs; lower is closer to the chest reference.\n' +
    'Only epochs where §4 CHANGED the finger HRV are scored; epochs it left alone would contribute an\n' +
    'identical term to both sides and dilute the comparison toward "no difference". The claim this run\n' +
    'can support is unmoved-or-improved — a WORSE row is a blocker, because §4 removes intervals it\n' +
    'argues are fabricated, so it must not move the record away from the chest reference.'
);
