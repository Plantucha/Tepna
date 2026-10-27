#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * ppg-fusion-e3.mjs — PPGDEX-ALGORITHM-DEEP-DIVE §6 experiment E-3
 * ------------------------------------------------------------------------------------------------
 * §3.1 REFUTED waveform-level fusion of the three optical channels: out-of-sample it scored 0.95x
 * (mean-of-3), 0.95x (PCA-1) and 0.97x (GEV beamformer) against simply selecting the best single
 * channel, and on foot-to-foot PPI sd it lost outright. One residual kept it open:
 *
 *     "One dossier measurement scoring *timing* on a much weaker detector favoured fusion; it may only
 *      show that fusion rescues a weak detector. If ever revisited, score on PPI jitter with the
 *      SHIPPED detector, nothing else."
 *
 * That is this tool, and the wording is a constraint rather than a preference: fusion "winning" on a
 * weak detector is not evidence about the pipeline that ships. So every variant here is detected with
 * the shipped `detectBeats`, and scored against paired H10 chest ECG on the endpoint the suite
 * actually cares about — PPI-jitter sd — with PPV and recall beside it so a variant cannot buy jitter
 * by dropping the beats it finds hard.
 *
 * VARIANTS
 *   consensus   the shipped 3-LED vote (`consensusBeats`) — what actually ships, the real baseline
 *   single      the best single channel alone (`pickChannel`'s reference) — §3.1's comparator
 *   mean3       per-channel z-normalised mean of the three band-passed waveforms
 *   pca1        first principal component across the three channels (power iteration on the 3x3
 *               covariance), which is §3.1's PCA-1
 *
 * POLARITY IS A PREREQUISITE, NOT A DETAIL. Averaging or projecting channels that disagree in sign
 * CANCELS the pulse — on the three real nights where one LED's polarity was inferred opposite (E-5),
 * a naive mean-of-3 destroys the very signal it is meant to strengthen. The shipped
 * `applyConsensusPolarity` pass is therefore applied before any fusion, so this measures fusion rather
 * than measuring the polarity bug. Nights are flagged where it acted.
 *
 * WHY √3 WAS NEVER AVAILABLE (§3.1): the noise-band inter-channel correlation is rho = 0.942-0.987, so
 * the coherent-averaging gain is 10*log10(3/(1+2*rho)) = 0.16 dB, not 4.77 dB. Three co-located
 * photodiodes see the same noise.
 *
 * MEASURED 2026-08-04 — §3.1's refutation STANDS, and one of its expectations does not. On SLEEP
 * nights (the regime the promotion bar is about) fusion is a wash: mean-of-3 +0.03 ms and PCA-1
 * +0.02 ms against the shipped consensus, i.e. 1.003x. Across ALL nights fusion appears to win by
 * 0.94 ms (0.956x) — but that gain lives entirely in daytime/motion segments where PPV is 60-90 % and
 * nothing could promote anyway. That is the same shape as §3.2's ambient result, whose apparent gains
 * also came only from daytime files, and it is precisely the "fusion rescues a weak signal" artifact
 * the residual warned about. The residual is CLOSED.
 *
 * The expectation that does NOT hold: §3.1 found the GEV beamformer collapsing to
 * [0.0006, 0.0397, -0.9992] — "it rediscovers channel selection". PCA-1 does not do that here. Its
 * weights are [0.577, 0.577, 0.577] = 1/sqrt(3) on EVERY night, so PCA-1 rediscovers the equal-weight
 * MEAN, and mean-of-3 and PCA-1 produce identical beat trains. That is itself a confirmation of the
 * rho = 0.94-0.99 figure: when channels are near-collinear the leading eigenvector is their average.
 * GEVD collapsing onto one channel is a property of that estimator, not of the geometry.
 *
 * SHIPPED CODE ONLY for parsing, detection, feet and the reference; the ONLY new code is the fusion
 * itself, exercised corpus-free by `--selftest`.
 *
 * USAGE
 *   node tools/ppg-fusion-e3.mjs --dir <captures> [--device verity] [--max-nights 20]
 *   node tools/ppg-fusion-e3.mjs --selftest
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { EPOCH_MS, MAX_LAG_MS, median, quantile, hrEnvelope, envelopeLagMs, refineLagByMatch, matchBeats, refinePeaks, ppiJitterMs } from './ppi-match.mjs';
import { gitCommitOf, notCovered, populationVerdict, ruleLine, snapshotEntries } from './corpus-scope-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
const SELFTEST = has('--selftest');
const DIR = opt('--dir', null);
const DEVICE = String(opt('--device', 'verity')).toLowerCase();
const MAX_NIGHTS = +opt('--max-nights', 20);
/* Sleep filter, same crude rule as the sibling tools: starts 20:00-04:00 and runs >=4 h, from the
   filename stamp and duration — not a stage call. It matters here because the promotion bar (§3) and
   the deep-dive's own figures are about SLEEP; an all-nights median is dominated by daytime segments
   whose jitter is 30-40 ms and which no metric could promote on anyway. */
const SLEEP_ONLY = has('--sleep-only');
const isSleepNight = (name, durSec) => {
  const m = /_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/.exec(name) || /(\d{8})(\d{2})(\d{2})(\d{2})_PPG/.exec(name);
  const hh = m ? +(m.length > 6 ? m[4] : m[2]) : null;
  if (hh == null || !(durSec >= 4 * 3600)) return false;
  return hh >= 20 || hh < 4;
};

/* ════════════════════════════════════════ THE FUSIONS ══════════════════════════════════════════ */

/* z-normalise in place-safe fashion: fusion must not be dominated by whichever channel happens to
   carry the largest counts. Returns a plain Float32Array. */
export function znorm(x) {
  const n = x.length;
  let s = 0;
  for (let i = 0; i < n; i++) s += x[i];
  const m = s / n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (x[i] - m) * (x[i] - m);
  const sd = Math.sqrt(v / Math.max(1, n - 1)) || 1e-9;
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = (x[i] - m) / sd;
  return y;
}

export function meanFuse(chans) {
  const z = chans.map(znorm);
  const n = z[0].length;
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < z.length; c++) s += z[c][i];
    y[i] = s / z.length;
  }
  return y;
}

/* PCA-1 by power iteration on the k x k covariance of the z-normalised channels. k is 2 or 3, so the
   covariance is tiny and 64 iterations is far past convergence; no linear-algebra dependency is worth
   pulling in for a 3x3. Returns { fused, weights } — the weights are reported because §3.1's finding
   was that the beamformer "rediscovers channel selection", and a weight vector that collapses onto one
   channel says the same thing about PCA-1. */
export function pca1Fuse(chans) {
  const z = chans.map(znorm);
  const k = z.length,
    n = z[0].length;
  const cov = [];
  for (let a = 0; a < k; a++) {
    cov.push(new Float64Array(k));
    for (let b = 0; b < k; b++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += z[a][i] * z[b][i];
      cov[a][b] = s / Math.max(1, n - 1);
    }
  }
  let w = new Float64Array(k).fill(1 / Math.sqrt(k));
  for (let it = 0; it < 64; it++) {
    const nw = new Float64Array(k);
    for (let a = 0; a < k; a++) {
      let s = 0;
      for (let b = 0; b < k; b++) s += cov[a][b] * w[b];
      nw[a] = s;
    }
    let nrm = 0;
    for (let a = 0; a < k; a++) nrm += nw[a] * nw[a];
    nrm = Math.sqrt(nrm) || 1e-12;
    for (let a = 0; a < k; a++) nw[a] = nw[a] / nrm;
    w = nw;
  }
  // sign convention: make the dominant weight positive so the fused pulse keeps the channels' polarity
  let dom = 0;
  for (let a = 1; a < k; a++) if (Math.abs(w[a]) > Math.abs(w[dom])) dom = a;
  if (w[dom] < 0) for (let a = 0; a < k; a++) w[a] = -w[a];
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let a = 0; a < k; a++) s += w[a] * z[a][i];
    y[i] = s;
  }
  return { fused: y, weights: Array.from(w) };
}

/* The filename pre-filter's bound, hoisted above the selftest so a leg can read it. The block
   beside `plausiblyOverlaps` carries the derivation. */
const OVERLAP_MAX_GAP_MS = 24 * 3600 * 1000;

/* ════════════════════════════════════════════ SELFTEST ═════════════════════════════════════════ */
function selftest() {
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? '  ok   ' : '  FAIL ') + m);
    if (!c) fail++;
  };
  const n = 4096;
  const sig = new Float32Array(n),
    noise = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    sig[i] = Math.sin((2 * Math.PI * i) / 55);
    noise[i] = ((i * 2654435761) % 1000) / 500 - 1; // deterministic pseudo-noise, no Math.random
  }
  const scaled = new Float32Array(n);
  for (let i = 0; i < n; i++) scaled[i] = sig[i] * 1000; // a channel with far larger counts

  const zm = znorm(scaled);
  let mx = 0;
  for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(zm[i]));
  ok(mx < 3, 'z-normalisation removes scale, so a large-count channel cannot dominate a fusion');

  const m3 = meanFuse([sig, scaled, sig]);
  let corr = 0,
    a2 = 0,
    b2 = 0;
  for (let i = 0; i < n; i++) {
    corr += m3[i] * sig[i];
    a2 += m3[i] * m3[i];
    b2 += sig[i] * sig[i];
  }
  ok(corr / Math.sqrt(a2 * b2) > 0.99, 'mean-of-3 over the same pulse reproduces it');

  /* THE POLARITY PREREQUISITE — the reason the shipped pass runs before any fusion here. */
  const inv = new Float32Array(n);
  for (let i = 0; i < n; i++) inv[i] = -sig[i];
  const cancelled = meanFuse([sig, sig, inv]);
  let amp = 0,
    ref = 0;
  for (let i = 0; i < n; i++) {
    amp = Math.max(amp, Math.abs(cancelled[i]));
    ref = Math.max(ref, Math.abs(m3[i]));
  }
  ok(amp < ref * 0.5, `an opposite-polarity channel CANCELS the fused pulse (${amp.toFixed(2)} vs ${ref.toFixed(2)}) — polarity must be settled first`);

  const p = pca1Fuse([sig, sig, noise]);
  ok(Math.abs(p.weights[2]) < Math.abs(p.weights[0]), 'PCA-1 down-weights the noise-only channel');
  let wn = 0;
  for (const w of p.weights) wn += w * w;
  ok(Math.abs(wn - 1) < 1e-6, 'the PCA-1 weight vector is unit-norm');

  /* §3.1's actual finding: on correlated channels the projection collapses onto essentially one
     direction — "it rediscovers channel selection". Pinned so the corpus result is interpretable. */
  const nearDup = new Float32Array(n);
  for (let i = 0; i < n; i++) nearDup[i] = sig[i] + 0.01 * noise[i];
  const q = pca1Fuse([sig, nearDup, noise]);
  ok(Math.abs(q.weights[2]) < 0.2, `with two correlated channels + one noisy, PCA-1 puts ${Math.abs(q.weights[2]).toFixed(3)} on the noisy one`);

  ok(pca1Fuse([sig, sig]).weights.length === 2, 'PCA-1 works for 2 channels as well as 3');

  /* The pre-filter rejects an ECG whose NAME stamp sits past this bound from the PPG start, and the
     name-to-content error is measured rather than assumed: up to 18.7 h in the row that enumerated
     these consumers. A bound inside that error drops a true pair while claiming it cannot. */
  const MEASURED_NAME_ERROR_MS = 18.7 * 3600 * 1000;
  ok(OVERLAP_MAX_GAP_MS > MEASURED_NAME_ERROR_MS, `the pre-filter bound ${(OVERLAP_MAX_GAP_MS / 3600000).toFixed(0)} h exceeds the measured name error 18.7 h`);

  console.log(fail ? `\nselftest: ${fail} FAILURE(S)` : '\nselftest: all green');
  return fail;
}

if (SELFTEST) process.exit(selftest() ? 1 : 0);
if (!DIR) {
  console.error('need --dir <captures>  (or --selftest)');
  process.exit(2);
}

/* ═══════════════════════════════════════════ CORPUS RUN ════════════════════════════════════════ */
const B = await import(join(ROOT, 'tools/build-core.js'));
const classicify = B.classicify || B.default?.classicify;
function realm(files) {
  const sb = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  sb.window = sb;
  sb.globalThis = sb;
  sb.self = sb;
  sb.document = {
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ style: {}, appendChild() {} }),
    head: { appendChild() {} },
    addEventListener() {},
    documentElement: { outerHTML: '' }
  };
  sb.navigator = { userAgent: 'v' };
  sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const ctx = vm.createContext(sb);
  for (const f of files) vm.runInContext(classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
  return sb;
}
const _ppgRealm = realm(['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ppgdex-registry.js', 'ppgdex-morph.js', 'ppgdex-dsp.js']);
const P = _ppgRealm.PPGDSP;
// The Clock Contract's filename parser, out of the same realm — so this tool never hand-rolls
// a stamp regex (it did, and the one it rolled skipped the range check §2.7 requires).
const DexClock = _ppgRealm.DexClock;
const E = realm(['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ecgdex-registry.js', 'ecgdex-morph.js', 'ecgdex-dsp.js']).ECGDSP;

const walk = (d, o = []) => {
  try {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p, o);
      else o.push({ p, size: st.size });
    }
  } catch (_e) {}
  return o;
};
const PPG_RE = DEVICE === 'verity' ? /(?:VeritySense|Polar_Sense).*_PPG\.txt$/i : /O2Ring.*_PPG\.txt$/i;
/* THE LISTER IS THE POPULATION RULE, AND IT CARRIES A NAME ON PURPOSE. `snapshotEntries` publishes
   `rule: null` for an inline arrow (`corpus-scope.mjs:329`), which would state that nobody chose the
   rule this run applied. The unit is a FILE, not a night: `--dir` is a capture tree and not the
   `YYYY-MM-DD` root `snapshotNights` reads, so a night snapshot here would manufacture a population.
   🔴 IT MUST NOT SWALLOW AN UNREADABLE ROOT. `walk` catches every error, so a root nobody can open
   returns `[]`, and the snapshot would then publish `n: 0` — a MEASUREMENT of zero over a directory
   nothing read (§∅). The root's own readdir runs outside that catch, so the snapshot reports
   `ok: false` with the reason instead. */
function listDevicePpg(root) {
  readdirSync(root);
  return walk(root)
    .filter((f) => PPG_RE.test(f.p))
    .map((f) => relative(root, f.p));
}

const PPG_UNIT = `${DEVICE} PPG files`;
const snap = snapshotEntries(DIR, { list: listDevicePpg, unit: PPG_UNIT });
/* 🔴 STAMP THE CODE THAT RAN, NOT THE CODE AT THE END OF THE RUN. Reading a night of PPG takes long
   enough for a commit to land in this worktree, and Node loaded this module at the start. */
const commitOf = gitCommitOf(ROOT);
const all = walk(DIR);
const ppgs = all
  .filter((f) => PPG_RE.test(f.p))
  .sort((a, b) => b.size - a.size)
  .slice(0, MAX_NIGHTS);
const ecgs = all.filter((f) => /H10.*_ECG\.txt$/i.test(f.p));

/* Cheap filename pre-filter: an ECG whose name stamp sits further than OVERLAP_MAX_GAP_MS from the
   PPG start cannot overlap it. A file without a parseable stamp is NOT rejected — it falls through to
   the full parse, so the filter can only save work there, never silently drop a pair.

   THE BOUND HAS TO EXCEED THE MEASURED NAME ERROR, and a 12 h bound did not. §4 ranks the filename
   as anchor source (2), and the row `2026-09-22-filename-stamp-still-wrong-for-other-consumers`
   measured captures whose name sits up to 18.7 h from their own first data row. A name that wrong
   read as a different night here, so the pair was dropped — which is the one case the old comment
   promised could not happen. 24 h is the bound `dex-ingest.js` already applies to the same question
   (`PICK_MAX_GAP_MS`), and over the 591 ECG files that carry a name stamp in this corpus the worst
   error measures 2.41 h (median 36.7 s, 2 files over 5 min, none at 12 h). So the widening costs no
   work today and removes the case the promise could not cover. */
const stampOf = (p) => {
  /* Both stamp layouts, and the validation this used to skip, come from `DexClock.fileStamp` — §4's
     anchor source (2), with one owner. The `Date.UTC` over digit slices that stood here built an
     instant out of components nothing had range-checked, which §2.7 forbids: a filename run of
     `20261332999999` rolls to 2027-02-01 rather than refusing. */
  const r = DexClock.fileStamp(p);
  return r ? r.tMs : null;
};
const plausiblyOverlaps = (p, t0) => {
  const t = stampOf(p);
  return t == null || Math.abs(t - t0) < OVERLAP_MAX_GAP_MS;
};
const _ecgMemo = new Map();
function ecgCache(p) {
  if (_ecgMemo.has(p)) return _ecgMemo.get(p);
  let v = null;
  try {
    const er = E.parseECG(readFileSync(p, 'utf8'));
    const eres = E.analyze(er);
    if (er.t0Ms != null && eres.peaks) {
      const bp = E.bandpass(er.int16, er.fs);
      v = { lo: er.t0Ms, hi: er.t0Ms + (er.durSec || 0) * 1000, beats: refinePeaks(bp, eres.peaks).map((q) => er.t0Ms + (q / er.fs) * 1000) };
    }
  } catch (_x) {
    v = null;
  }
  _ecgMemo.set(p, v);
  return v;
}

function score(beatMs, eBeats, lo, hi) {
  const ppv = [],
    rec = [],
    jit = [];
  for (let t = lo; t + EPOCH_MS <= hi; t += EPOCH_MS) {
    const fe = beatMs.filter((x) => x >= t && x < t + EPOCH_MS);
    const eeIn = eBeats.filter((x) => x >= t && x < t + EPOCH_MS);
    const ee = eBeats.filter((x) => x >= t - MAX_LAG_MS && x < t + EPOCH_MS + MAX_LAG_MS);
    if (fe.length < 60 || ee.length < 60) continue;
    const coarse = envelopeLagMs(hrEnvelope(fe, t, t + EPOCH_MS), hrEnvelope(ee, t, t + EPOCH_MS));
    if (!coarse) continue;
    const lag = refineLagByMatch(fe, ee, coarse.lagMs);
    const pairs = matchBeats(fe, ee, lag.lagMs);
    ppv.push(pairs.length / fe.length);
    if (eeIn.length) rec.push(pairs.length / eeIn.length);
    const j = ppiJitterMs(fe, ee, pairs);
    if (j) jit.push(j.sd);
  }
  return ppv.length ? { ppv: median(ppv), rec: rec.length ? median(rec) : null, jit: jit.length ? median(jit) : null } : null;
}

console.log('PPGDEX-ALGORITHM-DEEP-DIVE §6 · E-3 — waveform fusion re-scored on PPI jitter, shipped detector');
console.log(`device: ${DEVICE}   ${SLEEP_ONLY ? '(sleep nights only)' : '(all nights)'}\n`);
console.log('night                                   pol  jit_cons  jit_sing  jit_mean  jit_pca   ppv_cons  ppv_mean  ppv_pca   pca weights');

const rows = [];
for (const f of ppgs) {
  let rec0;
  try {
    rec0 = P.parsePPG(readFileSync(f.p, 'utf8'));
  } catch (_e) {
    continue;
  }
  if (rec0.t0Ms == null || !rec0.ch || !rec0.ch.length) continue;
  const keepIdx = P.distinctChannelIdx(rec0.ch);
  if (SLEEP_ONLY && !isSleepNight(f.p.split('/').pop(), rec0.durSec || 0)) continue;
  if (keepIdx.length < 2 || rec0.gap) continue; // fusion needs >=2 real channels; gaps need analyze()'s hold-over
  const perChannel = keepIdx.map((c) => P.detectChannel(rec0.ch[c], rec0.fs));
  const polarityCorrected = P.applyConsensusPolarity(perChannel, (i, sgn) => P.detectChannel(rec0.ch[keepIdx[i]], rec0.fs, sgn));
  const sel = P.pickChannel(rec0);
  const refIdx = Math.max(0, keepIdx.indexOf(sel.idx));

  const bps = perChannel.map((pc) => pc.bp);
  const toMs = (fi) => {
    const i0 = Math.floor(fi),
      i1 = Math.min(rec0.n - 1, i0 + 1),
      fr = fi - i0;
    if (!(i0 >= 0 && i0 < rec0.n)) return null;
    return rec0.t0Ms + (rec0.relSec[i0] * (1 - fr) + rec0.relSec[i1] * fr) * 1000;
  };
  const feetToMs = (feet) => feet.map(toMs).filter((x) => x != null);

  const consensus = P.consensusBeats(perChannel, refIdx, rec0.fs);
  const pca = pca1Fuse(bps);
  const variants = {
    cons: feetToMs(consensus.feet),
    sing: feetToMs(perChannel[refIdx].feet),
    mean: feetToMs(P.detectBeats(meanFuse(bps), rec0.fs).feet),
    pca: feetToMs(P.detectBeats(pca.fused, rec0.fs).feet)
  };
  if (Object.values(variants).some((v) => v.length < 100)) continue;

  const fw = [rec0.t0Ms, rec0.t0Ms + (rec0.durSec || 0) * 1000];
  let best = null;
  for (const e of ecgs) {
    if (!plausiblyOverlaps(e.p, fw[0])) continue;
    const c = ecgCache(e.p);
    if (!c) continue;
    const ov = Math.min(fw[1], c.hi) - Math.max(fw[0], c.lo);
    if (ov > EPOCH_MS && (!best || ov > best.ov)) best = { ov, c };
  }
  if (!best) continue;
  const lo = Math.max(fw[0], best.c.lo),
    hi = Math.min(fw[1], best.c.hi);
  const s = {};
  for (const k of Object.keys(variants)) s[k] = score(variants[k], best.c.beats, lo, hi);
  if (Object.values(s).some((v) => !v || v.jit == null)) continue;

  const row = { rec: relative(DIR, f.p), name: f.p.split('/').pop().slice(0, 38), pol: polarityCorrected, s, w: pca.weights };
  rows.push(row);
  const n2 = (v) => (v == null ? '  n/a' : v.toFixed(2));
  console.log(
    `${row.name.padEnd(40)} ${String(polarityCorrected).padStart(2)}  ${n2(s.cons.jit).padStart(7)}  ${n2(s.sing.jit).padStart(8)}  ${n2(s.mean.jit).padStart(8)}  ${n2(s.pca.jit).padStart(7)}  ${n2(s.cons.ppv * 100).padStart(8)}  ${n2(s.mean.ppv * 100).padStart(8)}  ${n2(s.pca.ppv * 100).padStart(7)}  [${pca.weights.map((w) => w.toFixed(3)).join(' ')}]`
  );
}

/* THE SET MAY HAVE MOVED WHILE THIS RAN, and the closing walk is what says so. Without it a result
   that moved because the tree gained a capture is indistinguishable from one that moved because a
   file changed. */
const population = populationVerdict(snap, snapshotEntries(DIR, { list: listDevicePpg, unit: PPG_UNIT }), {
  commit: commitOf.commit,
  commitReason: commitOf.reason,
  tool: 'tools/ppg-fusion-e3.mjs',
  evidence: ['tools/ppg-fusion-e3.mjs', 'tools/corpus-scope.mjs']
});

/* THE OTHER HALF OF THE POPULATION. The verdict above is about MOVEMENT — what arrived or left while
   the run read. It says nothing about the offered files this run did not score, and a COUNT of them
   names nothing to chase, so the removals go out by name. Both causes land here: the `--max-nights`
   cap and the per-file skips. */
function printPopulation() {
  console.log(
    `\n  population: ${population.status} — ${population.population.checked} offered ${snap.unit} the run can report over, of ${population.population.eligible} it saw${population.reason ? ` · ${population.reason}` : ''}`
  );
  const rl = ruleLine(population);
  if (rl) console.log(rl);
  console.log(`  the read scored ${rows.length} of the ${snap.n} offered under ${DIR}${snap.ok ? '' : ` · ${snap.reason}`}`);
  const missed = notCovered(snap, rows, { key: 'rec' });
  if (missed.length) console.log(`  it removed ${missed.length}, by name: ${missed.slice(0, 8).join(' · ')}${missed.length > 8 ? ` · … (+${missed.length - 8})` : ''}`);
  if (ppgs.length < snap.n) console.log(`  ${snap.n - ppgs.length} of those left under the --max-nights ${MAX_NIGHTS} cap, largest first`);
}

/* 🔴 A RUN THAT SCORED NOTHING STILL OWES ITS POPULATION. The early exit below used to be the only
   line such a run printed, so the one case where the population is the whole story was the one case
   that reported none. */
if (!rows.length) {
  console.log('\nno night scored — E-3 cannot be adjudicated on this corpus.');
  printPopulation();
  process.exit(0);
}
const col = (k, m) => rows.map((r) => (m === 'ppv' ? r.s[k].ppv * 100 : m === 'rec' ? (r.s[k].rec == null ? null : r.s[k].rec * 100) : r.s[k].jit)).filter((v) => v != null);
const fmt = (a) => (a.length ? `median ${median(a).toFixed(2)}  IQR ${quantile(a, 0.25).toFixed(2)}–${quantile(a, 0.75).toFixed(2)}` : 'n/a');
console.log(`\n${rows.length} night(s) scored\n`);
for (const [k, label] of [
  ['cons', 'consensus (SHIPPED)'],
  ['sing', 'best single channel'],
  ['mean', 'mean-of-3 fusion   '],
  ['pca', 'PCA-1 fusion       ']
]) {
  console.log(`  ${label}   jitter ${fmt(col(k, 'jit'))} ms`);
}
console.log('');
for (const [k, label] of [
  ['cons', 'consensus (SHIPPED)'],
  ['sing', 'best single channel'],
  ['mean', 'mean-of-3 fusion   '],
  ['pca', 'PCA-1 fusion       ']
]) {
  console.log(`  ${label}   PPV ${fmt(col(k, 'ppv'))} %   recall ${fmt(col(k, 'rec'))} %`);
}
const mc = median(col('cons', 'jit'));
console.log(`\n  Δ jitter vs the SHIPPED consensus (negative = fusion better):`);
for (const k of ['sing', 'mean', 'pca'])
  console.log(`    ${k.padEnd(5)} ${(median(col(k, 'jit')) - mc >= 0 ? '+' : '') + (median(col(k, 'jit')) - mc).toFixed(2)} ms   (ratio ${(median(col(k, 'jit')) / mc).toFixed(3)}x)`);
const wAbs = rows.map((r) => r.w.map(Math.abs).sort((a, b) => b - a));
console.log(`\n  PCA-1 dominant-weight median ${median(wAbs.map((w) => w[0])).toFixed(3)}  ·  smallest-weight median ${median(wAbs.map((w) => w[w.length - 1])).toFixed(3)}`);
console.log('  ^ §3.1 found the GEV beamformer collapsing to [0.0006, 0.0397, -0.9992] — "it rediscovers');
console.log('    channel selection". PCA-1 does NOT: ~0.577 each = 1/sqrt(3), the equal-weight mean.');
console.log('    With rho = 0.94-0.99 the leading eigenvector IS the average, so mean-of-3 and PCA-1');
console.log('    return identical beat trains. Collapse is a property of GEVD, not of the geometry.');
console.log(`\n  Nights where the shipped polarity pass acted first: ${rows.filter((r) => r.pol > 0).length} of ${rows.length}`);
console.log('  (without it a mean-of-3 on those nights CANCELS the pulse — fusion cannot be measured');
console.log('   until polarity is settled, which is why E-5 was a prerequisite for this experiment.)');

printPopulation();
