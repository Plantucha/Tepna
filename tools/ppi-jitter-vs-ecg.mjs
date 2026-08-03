#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * ppi-jitter-vs-ecg.mjs — O2RING-FINGER-HRV-VALIDATION §3, the PRIMARY endpoint
 * ------------------------------------------------------------------------------------------------
 * PPI-jitter sd for the O2Ring FINGER pleth against paired H10 chest ECG, reported as median + IQR
 * across nights so it is directly comparable to the Verity wrist's 5.92 ms.
 *
 * The brief says "adopt the deep-dive's validated apparatus verbatim". That apparatus was never
 * committed — like the two O2Ring sweeps §5b found dead, and like the §3 scratchpad whose numbers can
 * no longer be re-derived. So this is it, committed, with a corpus-free `--selftest`.
 *
 * WHY BEAT MATCHING NEEDS PER-EPOCH ALIGNMENT (§3.3, non-negotiable). The finger pulse arrives
 * ~150-250 ms after the R-peak and that pulse-transit time DRIFTS over a night. A single global lag
 * scores ~F1 0.26 and a nonsense −1 ms PTT. Worse, aligning on the beat trains themselves pins the
 * offset only MODULO one heartbeat — a beat train is periodic, so a whole-RR error is invisible.
 *
 * So the coarse lag is taken on the INSTANTANEOUS-HR ENVELOPE, not the beat times: HR wanders
 * aperiodically over a 5-min epoch (respiratory sinus arrhythmia, arousals), and an aperiodic signal
 * cannot alias by a beat. Only after that envelope lag is removed is ±75 ms one-to-one beat matching
 * meaningful, and only within the epoch it was measured on.
 *
 * WHAT IS REPORTED
 *   PPI-jitter sd  sd of (finger interval − its matched ECG interval), per epoch, median over epochs
 *                  per night, then median + IQR over nights.   PRIMARY.
 *   RMSSD bias %   finger whole-record RMSSD vs ECG, per night.
 *   sdnnRobust %   the jitter-robust family the brief expects to survive where RMSSD does not.
 *   match rate     fraction of finger beats matched within ±75 ms after alignment — a low rate makes
 *                  the jitter figure meaningless and is reported beside it, never folded in.
 *
 * SHIPPED CODE ONLY — PPGDSP/ECGDSP co-loaded in a vm realm mirroring tests/run-tests.mjs. No
 * reimplemented HRV math: RMSSD/SDNN come from the node's own analyze().
 *
 * USAGE
 *   node tools/ppi-jitter-vs-ecg.mjs --dir <captures> [--min-epochs 3] [--max-nights 20]
 *   node tools/ppi-jitter-vs-ecg.mjs --selftest
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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
const MIN_EPOCHS = +opt('--min-epochs', 3);
const MAX_NIGHTS = +opt('--max-nights', 20);
/* WHICH PPG DEVICE. The finger is this brief's subject, but the Verity must be runnable through the
   SAME instrument. The deep-dive's 5.92 ms wrist figure is `[CORPUS]`-marked and its §2.2 apparatus was
   never committed — §2.2 describes the method and names no tool — so quoting a finger number against it
   would compare two instruments, only one of which can be re-run. Measuring both here makes the
   comparison same-instrument and turns 5.92 ms into a CHECK ON THIS TOOL rather than a constant. */
const DEVICE = String(opt('--device', 'o2ring')).toLowerCase();
const PPG_RE = DEVICE === 'verity' ? /VeritySense.*_PPG\.txt$/i : /O2Ring.*_PPG\.txt$/i;

const EPOCH_MS = 300000; // 5 min — the brief's unit, and the node's own epochs[] unit
const MATCH_MS = 75; // §3.3 one-to-one tolerance, applied AFTER the envelope lag is removed
const HR_BIN_MS = 1000; // instantaneous-HR envelope resolution for the cross-correlation
const MAX_LAG_MS = 4000; // PTT is 150-250 ms; 4 s of search covers clock skew too

/* ── small stats. Sample sd (÷ n−1), matching the nodes' own convention. ───────────────────────── */
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function sd(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
}
function quantile(a, q) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const p = (s.length - 1) * q,
    lo = Math.floor(p),
    hi = Math.ceil(p);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (p - lo);
}
const median = (a) => quantile(a, 0.5);

/* ── the envelope: instantaneous HR sampled on a fixed grid, mean-removed so the cross-correlation
      scores SHAPE rather than level (a constant HR offset between devices must not drive the lag). ─ */
export function hrEnvelope(beatMs, t0, t1) {
  const n = Math.max(1, Math.round((t1 - t0) / HR_BIN_MS));
  const out = new Array(n).fill(NaN);
  for (let i = 1; i < beatMs.length; i++) {
    const dt = beatMs[i] - beatMs[i - 1];
    if (!(dt > 300 && dt < 2000)) continue;
    const k = Math.floor((beatMs[i] - t0) / HR_BIN_MS);
    if (k >= 0 && k < n) out[k] = 60000 / dt;
  }
  // hold-last-value fill, then mean-remove over the finite part
  let last = NaN;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(out[i])) last = out[i];
    else out[i] = last;
  }
  const fin = out.filter(Number.isFinite);
  if (fin.length < 8) return null;
  const m = mean(fin);
  for (let i = 0; i < n; i++) out[i] = Number.isFinite(out[i]) ? out[i] - m : 0;
  return out;
}

/* Coarse lag by normalised cross-correlation of the two HR envelopes. Returns ms (positive = the
   finger envelope lags the ECG one, which is the physical direction for pulse transit). */
export function envelopeLagMs(aEnv, bEnv) {
  if (!aEnv || !bEnv) return null;
  const maxK = Math.round(MAX_LAG_MS / HR_BIN_MS);
  let best = null,
    bestK = 0;
  for (let k = -maxK; k <= maxK; k++) {
    let s = 0,
      na = 0,
      nb = 0,
      c = 0;
    for (let i = 0; i < aEnv.length; i++) {
      const j = i + k;
      if (j < 0 || j >= bEnv.length) continue;
      s += aEnv[i] * bEnv[j];
      na += aEnv[i] * aEnv[i];
      nb += bEnv[j] * bEnv[j];
      c++;
    }
    if (c < 8 || na <= 0 || nb <= 0) continue;
    const r = s / Math.sqrt(na * nb);
    if (best === null || r > best) {
      best = r;
      bestK = k;
    }
  }
  if (best === null) return null;
  /* §3.3's LOCAL REFINEMENT — the step this tool was missing, and the reason its first corpus run was
     worthless. The envelope is binned at HR_BIN_MS (1000 ms), so the coarse argmax lands on a 1 s grid
     while the matching tolerance is ±75 ms: the alignment was 13x coarser than the thing it feeds. In
     the first run every reported lag was exactly 1000 or 2000 ms — a physical impossibility for a
     150-250 ms pulse transit — and match rates split cleanly by whether the true lag happened to sit
     near a bin edge (95-99 % when it did, 47-55 % when it did not). The jitter figures inherited that
     split, so they described the binning, not the finger.

     Refined in two stages. (a) Parabolic vertex on the three correlation samples around the argmax,
     which turns the 1 s grid into a continuous estimate. (b) A fine search at BEAT resolution: sweep
     ±HR_BIN_MS around that estimate in 5 ms steps and keep the lag that maximises matched beats, since
     the endpoint is beat matching and correlation of a hold-filled envelope is only a proxy for it.
     Stage (b) is what actually earns the ±75 ms tolerance. */
  let lagMs = -bestK * HR_BIN_MS;
  const cAt = (k) => {
    let sm = 0,
      na = 0,
      nb = 0,
      c = 0;
    for (let i = 0; i < aEnv.length; i++) {
      const j = i + k;
      if (j < 0 || j >= bEnv.length) continue;
      sm += aEnv[i] * bEnv[j];
      na += aEnv[i] * aEnv[i];
      nb += bEnv[j] * bEnv[j];
      c++;
    }
    return c < 8 || na <= 0 || nb <= 0 ? null : sm / Math.sqrt(na * nb);
  };
  const cm = cAt(bestK - 1),
    c0 = cAt(bestK),
    cp = cAt(bestK + 1);
  if (cm != null && c0 != null && cp != null) {
    const den = cm - 2 * c0 + cp;
    let d = den !== 0 ? (0.5 * (cm - cp)) / den : 0;
    if (!(d > -0.5 && d < 0.5)) d = 0;
    lagMs = -(bestK + d) * HR_BIN_MS;
  }
  return { lagMs, r: best, coarseMs: -bestK * HR_BIN_MS };
}

/* Stage (b): pick the lag that maximises MATCHED BEATS, not envelope correlation. The envelope is
   hold-filled and mean-removed, so its optimum is close but not identical to the matching optimum —
   and it is the match that the ±75 ms tolerance and the jitter statistic both rest on. */
export function refineLagByMatch(fingerMs, ecgMs, seedMs, spanMs, stepMs) {
  const span = spanMs || HR_BIN_MS;
  const step = stepMs || 5;
  let bestLag = seedMs,
    bestN = -1;
  for (let L = seedMs - span; L <= seedMs + span; L += step) {
    const n = matchBeats(fingerMs, ecgMs, L).length;
    if (n > bestN) {
      bestN = n;
      bestLag = L;
    }
  }
  return { lagMs: bestLag, matched: bestN };
}

/* One-to-one greedy matching inside ±MATCH_MS, after the lag is removed. Each ECG beat is consumed at
   most once — a many-to-one match would understate jitter by pairing every finger beat to its nearest
   neighbour regardless of whether that neighbour was already spoken for. */
export function matchBeats(fingerMs, ecgMs, lagMs) {
  const used = new Set();
  const pairs = [];
  let j = 0;
  for (let i = 0; i < fingerMs.length; i++) {
    const t = fingerMs[i] - lagMs;
    while (j < ecgMs.length && ecgMs[j] < t - MATCH_MS) j++;
    let bestK = -1,
      bestD = Infinity;
    for (let k = j; k < ecgMs.length && ecgMs[k] <= t + MATCH_MS; k++) {
      if (used.has(k)) continue;
      const d = Math.abs(ecgMs[k] - t);
      if (d < bestD) {
        bestD = d;
        bestK = k;
      }
    }
    if (bestK >= 0) {
      used.add(bestK);
      pairs.push({ fi: i, ei: bestK });
    }
  }
  return pairs;
}

/* SUB-SAMPLE R-PEAK REFINEMENT — §3.2 requires it, and the shipped detector does not provide it.
   `ECGDSP.analyze().peaks` returns INTEGER sample indices. At the H10's 130 Hz that is a 7.69 ms grid,
   so peak position alone carries a uniform quantization error of sd = 7.69/√12 = 2.22 ms, and an
   INTERVAL (a difference of two) carries √2 × that = 3.14 ms. That error lands in the reference leg of
   every comparison: a finger with 5.0 ms of true jitter would measure √(5.0² + 3.14²) = 5.9 ms, and the
   inflation is largest exactly where the device is best. §3.2 names 0.47 ms interval agreement for the
   refined reference — 6.7× smaller than the quantization it removes, which is why the brief calls for it.

   Refined by fitting a parabola to the BANDPASSED signal (the same `ECGDSP.bandpass` the detector peaks
   on — shipped code, not a reimplementation) at [p−1, p, p+1] and taking its vertex. Clamped to ±0.5
   samples: a vertex outside the bracket means the three points are not a peak, and shifting a beat
   further than the grid it was found on would fabricate precision rather than recover it. */
export function refinePeaks(bp, peaks) {
  const out = new Array(peaks.length);
  for (let i = 0; i < peaks.length; i++) {
    const p = peaks[i];
    if (p <= 0 || p >= bp.length - 1) {
      out[i] = p;
      continue;
    }
    const y0 = bp[p - 1],
      y1 = bp[p],
      y2 = bp[p + 1];
    const den = y0 - 2 * y1 + y2;
    let d = den !== 0 ? (0.5 * (y0 - y2)) / den : 0;
    if (!(d > -0.5 && d < 0.5)) d = 0;
    out[i] = p + d;
  }
  return out;
}

/* PPI jitter: sd of (finger interval − matched ECG interval) over CONSECUTIVE matched pairs.
   Consecutive is load-bearing — an interval spanning a missed beat is not a jitter sample. */
export function ppiJitterMs(fingerMs, ecgMs, pairs) {
  const d = [];
  for (let p = 1; p < pairs.length; p++) {
    if (pairs[p].fi !== pairs[p - 1].fi + 1) continue;
    if (pairs[p].ei !== pairs[p - 1].ei + 1) continue;
    const fIv = fingerMs[pairs[p].fi] - fingerMs[pairs[p - 1].fi];
    const eIv = ecgMs[pairs[p].ei] - ecgMs[pairs[p - 1].ei];
    if (fIv > 300 && fIv < 2000 && eIv > 300 && eIv < 2000) d.push(fIv - eIv);
  }
  return d.length >= 8 ? { sd: sd(d), n: d.length } : null;
}

/* ════════════════════════════════════════ SELFTEST ════════════════════════════════════════ */
function selftest() {
  let fail = 0;
  const ok = (n, c, d) => {
    console.log((c ? '  ok   ' : '  FAIL ') + n + (d != null && !c ? '  — ' + d : ''));
    if (!c) fail++;
  };
  // A synthetic beat train with an APERIODIC HR wander, a known PTT lag, and known jitter.
  const mk = (lagMs, jitterSd, seed) => {
    let s = seed || 1;
    const rnd = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff - 0.5;
    };
    const ecg = [],
      finger = [];
    let t = 0;
    for (let i = 0; i < 400; i++) {
      // aperiodic wander: two incommensurate slow components, so the envelope cannot alias
      const rr = 900 + 60 * Math.sin(i / 17.3) + 40 * Math.sin(i / 7.1 + 1.3);
      t += rr;
      ecg.push(t);
      finger.push(t + lagMs + (jitterSd ? rnd() * jitterSd * 3.46 : 0)); // uniform → sd ≈ jitterSd
    }
    return { ecg, finger };
  };
  const A = mk(200, 0, 7);
  const t0 = 0,
    t1 = A.ecg[A.ecg.length - 1];
  const lag = envelopeLagMs(hrEnvelope(A.finger, t0, t1), hrEnvelope(A.ecg, t0, t1));
  ok('an envelope lag is recovered at all', lag != null, JSON.stringify(lag));
  /* THE POINT of using the HR envelope: it is aperiodic, so the recovered lag is NOT ambiguous modulo
     one RR (~900 ms here). A beat-train correlation would be. */
  ok('the recovered lag is within one HR bin of the planted 200 ms — not a whole-RR alias', lag && Math.abs(lag.lagMs - 200) <= HR_BIN_MS, 'lag=' + (lag && lag.lagMs));
  ok('…and the envelope correlation is strong on identical wander', lag && lag.r > 0.9, 'r=' + (lag && lag.r));

  /* THE LEG THAT WOULD HAVE CAUGHT THE FIRST RUN. The coarse envelope argmax is on a 1 s grid, so on a
     200 ms lag it reports 0 — and ±75 ms matching against a 200 ms error matches almost nothing. §3.3's
     local refinement is what recovers it. Asserting the COARSE stage is wrong is as important as
     asserting the refined stage is right: without this, a tool that skipped refinement still passed. */
  ok('the COARSE envelope lag is grid-quantised and cannot serve ±75 ms matching on its own', lag && Math.abs(lag.coarseMs - 200) >= 75, 'coarse=' + (lag && lag.coarseMs) + ' vs true 200');
  const seeded = refineLagByMatch(A.finger, A.ecg, lag.coarseMs);
  ok('…and the local refinement recovers the true lag to within the matching tolerance', Math.abs(seeded.lagMs - 200) <= MATCH_MS, 'refined=' + seeded.lagMs);
  ok(
    '…which is what makes the match rate usable (coarse would strand it)',
    seeded.matched >= A.finger.length - 5 && matchBeats(A.finger, A.ecg, lag.coarseMs).length < seeded.matched,
    'refined ' + seeded.matched + ' vs coarse ' + matchBeats(A.finger, A.ecg, lag.coarseMs).length
  );
  const pairs = matchBeats(A.finger, A.ecg, 200);
  ok('a zero-jitter train matches one-to-one, essentially completely', pairs.length >= A.finger.length - 2, pairs.length + '/' + A.finger.length);
  const j0 = ppiJitterMs(A.finger, A.ecg, pairs);
  ok('zero planted jitter ⇒ ~0 ms measured', j0 && j0.sd < 0.5, 'sd=' + (j0 && j0.sd));

  const B = mk(200, 6, 11);
  const pb = matchBeats(B.finger, B.ecg, 200);
  const j6 = ppiJitterMs(B.finger, B.ecg, pb);
  /* Interval jitter is the DIFFERENCE of two independent beat jitters, so sd scales by √2. A 6 ms beat
     jitter must read ~8.5 ms of interval jitter — asserting the raw 6 would silently accept a tool that
     measured beat error instead of interval error. */
  ok('6 ms beat jitter reads ~8.5 ms INTERVAL jitter (√2 — the difference of two jitters)', j6 && j6.sd > 6 && j6.sd < 11, 'sd=' + (j6 && j6.sd));

  // one-to-one: an ECG beat may not be consumed twice
  const dup = matchBeats([1000, 1010], [1005], 0);
  ok('one ECG beat cannot match two finger beats', dup.length === 1, JSON.stringify(dup));
  // a gap must not become a jitter sample
  const gj = ppiJitterMs(
    [0, 900, 5000, 5900],
    [0, 900, 5000, 5900],
    [
      { fi: 0, ei: 0 },
      { fi: 1, ei: 1 },
      { fi: 3, ei: 3 }
    ]
  );
  ok('a non-consecutive pair contributes no jitter sample (too few ⇒ null)', gj === null, JSON.stringify(gj));
  ok('sd is the SAMPLE sd (÷ n−1)', Math.abs(sd([800, 900]) - Math.sqrt(5000)) < 1e-9);
  ok('quantile interpolates — IQR is not a nearest-rank approximation', quantile([1, 2, 3, 4], 0.25) === 1.75, String(quantile([1, 2, 3, 4], 0.25)));
  console.log(fail ? '\nselftest: ' + fail + ' FAILED' : '\nselftest: all green');
  return fail;
}
if (SELFTEST) process.exit(selftest());

/* ════════════════════════════════════════ CORPUS RUN ════════════════════════════════════════ */
if (!DIR) {
  console.error('usage: node tools/ppi-jitter-vs-ecg.mjs --dir <captures> [--min-epochs N] [--max-nights N]  |  --selftest');
  process.exit(2);
}
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
const P = realm(['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ppgdex-registry.js', 'ppgdex-morph.js', 'ppgdex-dsp.js']).PPGDSP;
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
const all = walk(DIR);
const fingers = all
  .filter((f) => PPG_RE.test(f.p))
  .sort((a, b) => b.size - a.size)
  .slice(0, MAX_NIGHTS);
const ecgs = all.filter((f) => /H10.*_ECG\.txt$/i.test(f.p));

console.log('O2RING-FINGER-HRV-VALIDATION §3 — PPI-jitter sd vs paired H10 ECG (per-epoch alignment)');
console.log('device: ' + (DEVICE === 'verity' ? 'Polar Verity Sense (WRIST — the deep-dive reference leg)' : "Wellue O2Ring (FINGER — this brief's subject)") + '\n');
console.log('night                                        eps  jitter_sd  match%   lag_ms   RMSSD_f  RMSSD_e  bias%   sdnnRob%');

const nights = [];
for (const f of fingers) {
  let frec, fres;
  try {
    const txt = readFileSync(f.p, 'utf8');
    frec = P.parsePPG(txt);
    fres = P.analyze(frec);
  } catch (_e) {
    continue;
  }
  if (frec.t0Ms == null || !fres.beatTimes) continue;
  const fBeats = (fres.footSec || []).map((s) => frec.t0Ms + s * 1000);
  if (fBeats.length < 100) continue;
  const fw = [frec.t0Ms, frec.t0Ms + (frec.durSec || 0) * 1000];
  let best = null;
  for (const e of ecgs) {
    let er, eres;
    try {
      er = E.parseECG(readFileSync(e.p, 'utf8'));
      eres = E.analyze(er);
    } catch (_x) {
      continue;
    }
    if (er.t0Ms == null || !eres.peaks) continue;
    const ew = [er.t0Ms, er.t0Ms + (er.durSec || 0) * 1000];
    const ov = Math.min(fw[1], ew[1]) - Math.max(fw[0], ew[0]);
    if (ov > EPOCH_MS && (!best || ov > best.ov)) best = { ov, er, eres };
  }
  if (!best) continue;
  /* §3.2 — refine the REFERENCE before comparing against it. Unrefined, the H10's integer grid injects
     3.14 ms of interval quantization into the finger's measured jitter. */
  const eBp = E.bandpass(best.er.int16, best.er.fs);
  const eRef = refinePeaks(eBp, best.eres.peaks);
  const eBeats = eRef.map((p) => best.er.t0Ms + (p / best.er.fs) * 1000);
  const eBeatsRaw = best.eres.peaks.map((p) => best.er.t0Ms + (p / best.er.fs) * 1000);

  const jit = [],
    rawJit = [],
    lags = [],
    rates = [];
  const lo = Math.max(fw[0], best.er.t0Ms),
    hi = Math.min(fw[1], best.er.t0Ms + (best.er.durSec || 0) * 1000);
  for (let t = lo; t + EPOCH_MS <= hi; t += EPOCH_MS) {
    const fe = fBeats.filter((x) => x >= t && x < t + EPOCH_MS);
    const ee = eBeats.filter((x) => x >= t - MAX_LAG_MS && x < t + EPOCH_MS + MAX_LAG_MS);
    if (fe.length < 60 || ee.length < 60) continue;
    const coarse = envelopeLagMs(hrEnvelope(fe, t, t + EPOCH_MS), hrEnvelope(ee, t, t + EPOCH_MS));
    if (!coarse) continue;
    const lag = refineLagByMatch(fe, ee, coarse.lagMs); // §3.3 stage (b)
    const pairs = matchBeats(fe, ee, lag.lagMs);
    const rate = pairs.length / fe.length;
    const j = ppiJitterMs(fe, ee, pairs);
    if (!j) continue;
    jit.push(j.sd);
    /* The SAME epoch scored against the UNREFINED reference, so §3.2's refinement is measured rather
       than assumed. Measured on this corpus it removes ~0.08 ms at the finger's ~26 ms jitter (they add
       in quadrature, so 3.14 ms against 26 ms is invisible) — but it would be ~13 % at the Verity's
       ~6 ms. Reported, because "negligible" is a claim about a specific device's noise floor, not a
       property of the method. */
    const eeRaw = eBeatsRaw.filter((x) => x >= t - MAX_LAG_MS && x < t + EPOCH_MS + MAX_LAG_MS);
    const jr = ppiJitterMs(fe, eeRaw, matchBeats(fe, eeRaw, lag.lagMs));
    if (jr) rawJit.push(jr.sd);
    lags.push(lag.lagMs);
    rates.push(rate);
  }
  if (jit.length < MIN_EPOCHS) continue;
  const rf = fres.rmssd,
    re = best.eres.rmssd;
  /* READ `dispSd`, NOT `sdnn`. This is the field that makes §4's sdnnRobust criterion measurable, and
     getting it wrong produced a confident −29 % that was an artifact of pairing.

       ECGDex `sdnn`    whole-record SDNN — carries the between-epoch (SDANN) variance
       ECGDex `dispSd`  MEDIAN of per-5-min epoch SDNN — and it is what the EXPORT publishes as
                        `hrv.time.sdnn` for a long record
       PpgDex `sdnnRobust`  quality-gated MEDIAN of per-5-min epoch SDNN

     So `dispSd` is `sdnnRobust`'s like-for-like counterpart and always was; ECGDex simply names it
     differently. Verified rather than assumed: `dispSd` === median(epochs[].sdnn) to the reported
     decimal. On one night the wrong pair reads −35.0 % and the right pair +13.7 %; the wrong pair also
     read −29 % on BOTH devices, which was the tell — a constant offset of construction. */
  const sf = fres.sdnnRobust,
    se = best.eres.dispSd != null ? best.eres.dispSd : best.eres.sdnn;
  nights.push({
    name: f.p.split('/').pop(),
    eps: jit.length,
    jitter: median(jit),
    rate: median(rates),
    lag: median(lags),
    refGain: rawJit.length ? median(rawJit) - median(jit) : null,
    rf,
    re,
    bias: rf != null && re ? ((rf - re) / re) * 100 : null,
    sdnnBias: sf != null && se ? ((sf - se) / se) * 100 : null
  });
  const n = nights[nights.length - 1];
  console.log(
    `${n.name.slice(0, 42).padEnd(42)} ${String(n.eps).padStart(4)} ${n.jitter.toFixed(2).padStart(10)} ${(n.rate * 100).toFixed(1).padStart(7)} ${n.lag.toFixed(0).padStart(8)} ${String(n.rf ?? '—').padStart(9)} ${String(n.re ?? '—').padStart(8)} ${(n.bias == null ? '—' : n.bias.toFixed(1)).padStart(7)} ${(n.sdnnBias == null ? '—' : n.sdnnBias.toFixed(1)).padStart(9)}`
  );
}

if (!nights.length) {
  console.log('\nno night produced ≥' + MIN_EPOCHS + ' comparable epochs — nothing to report.');
  process.exit(0);
}
const J = nights.map((n) => n.jitter);
const Bs = nights.filter((n) => n.bias != null).map((n) => n.bias);
const S = nights.filter((n) => n.sdnnBias != null).map((n) => n.sdnnBias);
const R = nights.map((n) => n.rate * 100);
const fmt = (a) => (a.length ? `median ${median(a).toFixed(2)}  IQR ${quantile(a, 0.25).toFixed(2)}–${quantile(a, 0.75).toFixed(2)}` : 'n/a');
console.log(`\n${nights.length} night(s) with ≥${MIN_EPOCHS} comparable epochs\n`);
console.log(`  PPI-jitter sd (PRIMARY)   ${fmt(J)} ms      [Verity wrist reference: 5.92 ms]`);
console.log(`  beat match rate           ${fmt(R)} %`);
console.log(`  RMSSD bias vs ECG         ${fmt(Bs)} %`);
/* §4's `sdnnRobust → validated` bar is ±3.5 %, and THIS TOOL CANNOT ADJUDICATE IT — so the number is
   withheld rather than printed with a caveat nobody reads. `sdnnRobust` is a quality-gated MEDIAN of
   per-5-min SDNN; ECGDex publishes only whole-record `sdnn`, which structurally includes the
   between-epoch (SDANN) variance the per-5-min median excludes. Comparing them is comparing two
   different quantities, and the measurement says so plainly: it read −29 % on the FINGER and −29 % on
   the WRIST, i.e. a constant offset of construction, not a property of either device. PpgDex's own
   export note puts sdnnRobust at ~+3.5 % vs "ECG truth" — meaning the ECG's per-5-min equivalent, which
   nothing currently computes. Constructing that reference here would be reimplemented HRV math (§3.5
   forbids it) and would be approximate exactly where the bar is ±3.5 %. */
console.log(`  sdnnRobust vs ECG dispSd  ${fmt(S)} %      [§4 promotion bar: within ~±3.5 %]`);
console.log(`  ^ dispSd is ECGDex's MEDIAN of per-5-min epoch SDNN — sdnnRobust's like-for-like counterpart.
    Pairing it against whole-record \`sdnn\` instead reads ~−29 % on BOTH devices: an offset of construction.`);
console.log(
  '\nThe match rate is reported BESIDE the jitter, never folded into it: a low rate means the jitter\n' +
    'figure describes whichever beats happened to pair, not the night. Read them together or not at all.'
);
