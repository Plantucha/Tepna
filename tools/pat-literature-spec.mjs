#!/usr/bin/env node
/*
 * tools/pat-literature-spec.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * PAT MEASURED TO THE PUBLISHED SPEC, PLUS AN ERROR BUDGET THAT WORKS BACKWARDS FROM IT.
 *
 * The published beat-to-beat PAT standard deviation is 7.21 ms with an optimised fiducial and
 * 8.22–15.4 ms with traditional ones (PLOS One 2024, doi:10.1371/journal.pone.0298354), of which
 * 3.44–5.12 ms is respiratory modulation. Intersecting tangents reaches RMSE 5.69 ms. This repo's
 * own `PPG-SAMPLE-RATE-AND-PAT` §3 measured residIQR 18.68 ms at 176 Hz with the machinery below.
 * So the target is TENS of ms, and any measurement returning ~90 ms is describing its own harness.
 *
 * THREE RULES TAKEN FROM THE LITERATURE, NOT FROM ANALOGY:
 *
 * 1 · FIDUCIAL — the intersecting-tangent FOOT, from the 3-LED consensus, on the host-disciplined
 *     per-sample axis. This is exactly `pat-feasibility-worker.js ppgFootTimes`:
 *       detectChannel per LED → consensusBeats → cons.feet → rec.relSec[idx].
 *     NOT `PPGDSP.analyze().tt`, which is the Malik-corrected PPI series — a different, coarser
 *     quantity. Substituting it is what produced a 5× inflated scatter in an earlier attempt here.
 *     Ranked fiducials (Physiol. Meas. 2019, doi:10.1088/1361-6579/ab009b): tangent-intersection and
 *     first-derivative apex beat the raw minimum; the plain foot is among the worst.
 *
 * 2 · SEARCH WINDOW — bounded, and a beat with no foot inside it contributes NOTHING. The literature
 *     constrains the foot to within ~RRI/3 of the R-peak (Sci. Rep. 2021, s41598-021-90056-2). The
 *     failure mode this prevents is the expensive one: with a window wider than one RR, a dropped
 *     foot pairs the R-peak with the NEXT cycle and injects a whole heartbeat of error. `pat-align.js
 *     coupleRtoFoot` already implements the rejecting form (`lag > hi` ⇒ "this beat's foot is
 *     missing, contribute nothing") with PHYS = [200, 650] ms; that rule is mirrored here.
 *
 * 3 · STATISTIC — beat-to-beat SD of PAT, which is what the literature reports. Not a windowed IQR:
 *     that was an HRV convention borrowed by analogy, and PAT has its own.
 *
 * THE ERROR BUDGET (the point of the exercise). Timing error adds in quadrature, so knowing what the
 * answer SHOULD be turns the measurement into a subtraction:
 *
 *     sigma_measured² = sigma_sampling² + sigma_respiratory² + sigma_fiducial² + sigma_UNEXPLAINED²
 *
 * The first three are known or bounded from the literature and from this corpus's own sample rates.
 * Whatever is left is the term we are losing somewhere. A large single residual points at one
 * mechanism worth hunting; a residual that vanishes means the budget is closed and the measurement
 * is as good as the hardware allows. (If instead it is seven unrelated small errors, the residual
 * will be modest and no single term will dominate — that is a real possible outcome and it is
 * reported as such rather than forced onto a culprit.)
 *
 *   node tools/pat-literature-spec.mjs --dir <captures root> [--night 2026-08-03] [--site ring|ankle]
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DexBuild = createRequire(import.meta.url)(path.join(ROOT, 'tools', 'build-core.js'));
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const DIR = arg('--dir', null);
const ONLY = arg('--night', null);
const SITE = arg('--site', 'ankle'); // which PPG corner to pair the ECG against
if (!DIR) {
  console.error('need --dir <captures root>');
  process.exit(1);
}

/* PHYS mirrored from pat-align.js — NOT re-derived. A second copy of a threshold drifts. */
const PHYS_LO = 200,
  PHYS_HI = 650;
const SIGMA_RESP_MS = 4.3; // 3.44–5.12 ms, midpoint (PLOS One 2024)
const SIGMA_FID_MS = 5.69; // intersecting tangents RMSE (PTT algorithm paper)

const ctx = vm.createContext({
  console: { log() {}, warn() {}, error() {} },
  Math,
  JSON,
  Date,
  Uint8Array,
  Int16Array,
  Float32Array,
  Float64Array,
  Array,
  Object,
  Number,
  String,
  isFinite,
  isNaN,
  parseInt,
  parseFloat
});
ctx.window = ctx;
ctx.self = ctx;
ctx.globalThis = ctx;
for (const f of ['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js']) {
  try {
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(ROOT, f), 'utf8')), ctx, { filename: f });
  } catch (e) {
    console.error('load fail', f, e.message.slice(0, 110));
  }
}
const ECGDSP = ctx.ECGDSP || ctx.ECGDex,
  PPGDSP = ctx.PPGDSP || ctx.PpgDex;
for (const fn of ['detectChannel', 'consensusBeats', 'parsePPG'])
  if (typeof PPGDSP[fn] !== 'function') {
    console.error(`PPGDSP.${fn} unavailable — cannot use the sanctioned fiducial`);
    process.exit(1);
  }

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
};
const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const iqr = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length * 0.75)] - s[Math.floor(s.length * 0.25)];
};

/* ── the sanctioned extractors, ported verbatim in behaviour from pat-feasibility-worker.js ── */
function ecgRpeakTimes(text) {
  const rec = ECGDSP.parseECG(text);
  if (!rec || rec.t0Ms == null) return null;
  const bp = ECGDSP.bandpass(rec.int16, rec.fs);
  const peaks = ECGDSP.detectPeaks(rec.int16, bp, rec.fs);
  const t = new Float64Array(peaks.length);
  for (let i = 0; i < peaks.length; i++) t[i] = rec.t0Ms + (peaks[i] / rec.fs) * 1000;
  return { fs: rec.fs, times: Array.from(t), n: peaks.length };
}
function ppgFootTimes(text) {
  const rec = PPGDSP.parsePPG(text);
  if (!rec || rec.t0Ms == null) return null;
  const per = rec.ch.map((c) => PPGDSP.detectChannel(c, rec.fs));
  let refIdx = 0,
    best = -1;
  per.forEach((p, i) => {
    if (p.peaks.length > best) {
      best = p.peaks.length;
      refIdx = i;
    }
  });
  const cons = PPGDSP.consensusBeats(per, refIdx, rec.fs);
  const rel = rec.relSec,
    fs = rec.fs,
    t0 = rec.t0Ms;
  const t = [];
  for (let i = 0; i < cons.feet.length; i++) {
    const idx = cons.feet[i];
    const sec = rel && rel[idx] != null && isFinite(rel[idx]) ? rel[idx] : idx / fs;
    t.push(t0 + sec * 1000);
  }
  return { fs: rec.fs, times: t, n: cons.feet.length, usedRelSec: !!(rel && rel.length) };
}
/* coupleRtoFoot — the REJECTING form. A beat whose foot is not inside the window contributes nothing. */
function coupleRtoFoot(R, F, lo, hi) {
  const pairs = [];
  let j = 0,
    missed = 0;
  for (let i = 0; i < R.length; i++) {
    const r = R[i];
    while (j < F.length && F[j] < r) j++;
    let got = false;
    for (let k = j; k < F.length; k++) {
      const lag = F[k] - r;
      if (lag > hi) break; // foot missing for this beat — REJECT, never take the next cycle
      if (lag >= lo) {
        pairs.push(lag);
        got = true;
        break;
      }
    }
    if (!got) missed++;
  }
  return { lags: pairs, missed, yield: pairs.length / Math.max(1, R.length) };
}
const biggest = (dir, re) =>
  fs
    .readdirSync(dir)
    .filter((f) => re.test(f))
    .map((f) => ({ f: path.join(dir, f), s: fs.statSync(path.join(dir, f)).size }))
    .sort((a, b) => b.s - a.s)[0];

const RE = { ankle: /veritysense.*_PPG\.txt$/i, ring: /o2ring.*_PPG\.txt$/i };
console.log(`PAT TO THE PUBLISHED SPEC — ECG R-peak → intersecting-tangent consensus FOOT (${SITE})`);
console.log(`  window [${PHYS_LO}, ${PHYS_HI}] ms, a beat with no foot inside it is REJECTED (never paired to the next cycle)`);
console.log(`  target: literature beat-to-beat SD 7.21 ms (optimised) … 15.4 ms (worst traditional); repo's own prior run 18.68 ms\n`);
console.log('  night        R-peaks   feet   paired  yield  |  PAT med   SD    IQR   | relSec');
console.log('  ' + '-'.repeat(88));

const nights = fs
  .readdirSync(DIR)
  .filter((d) => /^2026-/.test(d) && (!ONLY || d === ONLY) && fs.statSync(path.join(DIR, d)).isDirectory())
  .sort();
const ALL = [];
let anyFs = { ecg: null, ppg: null };
for (const n of nights) {
  const dir = path.join(DIR, n);
  const eF = biggest(dir, /Polar_H10_.*_ECG\.txt$/i),
    pF = biggest(dir, RE[SITE]);
  if (!eF || !pF) {
    console.log(`  ${n}  ⊘ missing a stream`);
    continue;
  }
  let E = null,
    P = null;
  try {
    E = ecgRpeakTimes(fs.readFileSync(eF.f, 'utf8'));
  } catch (e) {}
  try {
    P = ppgFootTimes(fs.readFileSync(pF.f, 'utf8'));
  } catch (e) {}
  if (!E || !P) {
    console.log(`  ${n}  ⊘ extractor failed (ECG ${!!E} · PPG ${!!P})`);
    continue;
  }
  anyFs = { ecg: E.fs, ppg: P.fs };
  const c = coupleRtoFoot(E.times, P.times, PHYS_LO, PHYS_HI);
  if (c.lags.length < 200) {
    console.log(`  ${n}  ⊘ only ${c.lags.length} pairs in the window`);
    continue;
  }
  console.log(
    `  ${n}  ${String(E.n).padStart(7)} ${String(P.n).padStart(6)} ${String(c.lags.length).padStart(8)}  ${(100 * c.yield).toFixed(0).padStart(4)}%  | ` +
      `${med(c.lags).toFixed(0).padStart(6)}ms ${sd(c.lags).toFixed(1).padStart(6)} ${iqr(c.lags).toFixed(0).padStart(5)}   | ${P.usedRelSec ? 'yes' : 'NO'}`
  );
  ALL.push(...c.lags);
}
console.log('  ' + '-'.repeat(88));
if (!ALL.length) {
  console.log('\n  nothing measured.');
  process.exit(0);
}

const S = sd(ALL);
console.log(`\n  CORPUS — ${ALL.length} paired beats · PAT median ${med(ALL).toFixed(0)} ms · SD ${S.toFixed(1)} ms · IQR ${iqr(ALL).toFixed(0)} ms`);

/* ══ THE ERROR BUDGET — work backwards from what the number SHOULD be ══ */
const qSamp = (f) => 1000 / f / Math.sqrt(12); // uniform quantisation SD of one sample interval
const sEcg = qSamp(anyFs.ecg || 130),
  sPpg = qSamp(anyFs.ppg || 176);
const sSamp = Math.hypot(sEcg, sPpg);
const known = Math.hypot(sSamp, SIGMA_RESP_MS, SIGMA_FID_MS);
const unexp = S > known ? Math.sqrt(S * S - known * known) : 0;
console.log(`\n  ERROR BUDGET   sigma_measured² = sampling² + respiratory² + fiducial² + UNEXPLAINED²`);
console.log(`    sampling      ECG ${anyFs.ecg} Hz → ${sEcg.toFixed(2)} ms · PPG ${anyFs.ppg} Hz → ${sPpg.toFixed(2)} ms   ⇒ ${sSamp.toFixed(2)} ms`);
console.log(`    respiratory   ${SIGMA_RESP_MS.toFixed(2)} ms  (3.44–5.12 published, irreducible physiology)`);
console.log(`    fiducial      ${SIGMA_FID_MS.toFixed(2)} ms  (intersecting-tangent RMSE)`);
console.log(`    ── known total (quadrature) : ${known.toFixed(2)} ms`);
console.log(`    ── MEASURED                 : ${S.toFixed(2)} ms`);
console.log(`    ── UNEXPLAINED              : ${unexp.toFixed(2)} ms   (${((100 * unexp) / Math.max(S, 1e-9)).toFixed(0)}% of the measured SD)`);
if (unexp < 5) console.log(`\n    Budget CLOSES. Nothing material is being lost — this is hardware-limited.`);
else if (unexp > 3 * known) console.log(`\n    ONE term dominates (${unexp.toFixed(0)} ms vs ${known.toFixed(0)} ms known). A single mechanism is worth hunting.`);
else console.log(`\n    Residual is comparable to the known terms — consistent with SEVERAL small unrelated errors\n    rather than one culprit. No single fix will close this.`);
