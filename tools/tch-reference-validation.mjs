/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * See briefs/TCH-REFERENCE-VALIDATION-2026-07-12-BRIEF.md
 * ════════════════════════════════════════════════════════════════════════════ */
/* P6 — validate the reference-free σ (three-cornered-hat) estimator against a TRUE reference.
 *
 * The σ programme exists BECAUSE there is no reference: you cannot measure a device's error
 * without a truth signal, so you triangulate three devices and hope the estimator is sound.
 * Nobody has ever been able to check whether it is.
 *
 * CPAP changes that. Its PLD channel writes MEASURED respiration from a calibrated flow sensor
 * in the therapy path. So on the quad-modal nights we have, for RESPIRATORY RATE:
 *
 *   CPAP RespRate  — measured (ResMed flow sensor)      ← treat as TRUTH
 *   ECG  respRate  — Lomb-Scargle HF peak of NN (H10)   ← estimate
 *   PPG  respRate  — Lomb-Scargle HF peak of PPI (Verity) ← estimate
 *
 * Then:
 *   σ_measured(X) = std(X − CPAP)                      the ACTUAL error, because we have truth
 *   σ_TCH(X)      = threeCorneredHat(CPAP, ECG, PPG)   the REFERENCE-FREE estimate
 *
 * If TCH is sound, σ_TCH ≈ σ_measured. That is the validation the programme could never run.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const REPO = '/media/michal/647A504F7A50205A/GENOME/Michal/Tepna';
const EN = '/media/michal/647A504F7A50205A/Ecg nightly';
const CLIP_MIN = +(process.env.CLIP_MIN || 30);      // minutes of each raw signal to analyse
const EPOCH_MIN = 5;

/* ── realm ── */
const noop = () => {};
const el = () => ({ style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  setAttribute: noop, getAttribute: () => null, appendChild: noop, append: noop, removeChild: noop,
  querySelector: () => null, querySelectorAll: () => [], addEventListener: noop, removeEventListener: noop });
const sb = { console, setTimeout, clearTimeout, TextEncoder, TextDecoder, crypto: globalThis.crypto,
  document: { getElementById: () => null, createElement: el, createTextNode: () => ({}), querySelector: () => null,
    querySelectorAll: () => [], head: el(), body: el(), documentElement: el(), addEventListener: noop, readyState: 'complete' },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop, clear: noop } };
sb.window = sb; sb.self = sb; sb.globalThis = sb;
const ctx = vm.createContext(sb);
ctx.__DEX_NAMESPACED__ = true;
for (const f of ['kernel-constants.js', 'clock.js', 'crossnight-envelope.js', 'cpapdex-edf.js', 'cpapdex-dsp.js',
  'ecgdex-dsp.js', 'ppgdex-dsp.js', 'ecgdex-morph.js', 'ppgdex-morph.js', 'integrator-tch.js']) {
  try { vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f }); }
  catch (e) { console.error('  ! load ' + f + ': ' + e.message); }
}
const ECG = ctx.ECGDSP, PPG = ctx.PPGDSP, EDF = ctx.CpapEdf, CD = ctx.CpapDsp;
const TCH = ctx.IntegratorTCH || ctx.INTEGRATOR_TCH || ctx.TCH || null;

/* read only the first N minutes of a huge raw file (they are 180–330 MB each) */
function readClip(file, approxBytes) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(approxBytes);
  const n = fs.readSync(fd, buf, 0, approxBytes, 0);
  fs.closeSync(fd);
  let s = buf.subarray(0, n).toString('utf8');
  return s.slice(0, s.lastIndexOf('\n'));            // drop the partial last row
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const std = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

/* ── per-night: three respiration series on a shared epoch grid ── */
function night(dateISO) {
  const ymd = dateISO.replace(/-/g, '');
  const out = { date: dateISO };

  // 1 · CPAP — MEASURED respiration (the reference)
  const cdir = path.join(EN, 'CPAP', ymd);
  if (!fs.existsSync(cdir)) return null;
  const pld = fs.readdirSync(cdir).find((f) => /_PLD\.edf$/.test(f));
  if (!pld) return null;
  const b = fs.readFileSync(path.join(cdir, pld));
  const rec = EDF.readEDF(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const rrCh = CD.chan(rec, 'RespRate');
  const prCh = CD.chan(rec, 'Press');
  if (!rrCh || !prCh) return null;
  const cT0 = rec.clock.t0Ms, cFs = rrCh.fs;

  // 2 · ECG — Lomb-Scargle HF peak of the NN series
  const ecgF = fs.readdirSync(EN).find((f) => f.includes(ymd) && /_ECG\.txt$/.test(f));
  if (!ecgF) return null;
  const eRec = ECG.parseECG(readClip(path.join(EN, ecgF), CLIP_MIN * 60 * 130 * 60));
  if (!eRec || !eRec.int16 || !eRec.int16.length) return null;
  // detectPeaks returns a plain array of R-peak SAMPLE INDICES; build the NN series from it.
  const eIdx = ECG.detectPeaks(eRec.int16, ECG.bandpass(eRec.int16, eRec.fs), eRec.fs);
  const eNN = { nn: [], times: [] };
  for (let i = 1; i < eIdx.length; i++) {
    const v = ((eIdx[i] - eIdx[i - 1]) / eRec.fs) * 1000;
    if (v > 300 && v < 2000) { eNN.nn.push(v); eNN.times.push(eIdx[i] / eRec.fs); }
  }
  out.eT0 = eRec.t0Ms;

  // 3 · PPG — same estimator, on the PPI series (independent device)
  const ppgF = fs.readdirSync(EN).find((f) => f.includes(ymd) && /_PPG\.txt$/.test(f));
  if (!ppgF) return null;
  const pRec = PPG.parsePPG(readClip(path.join(EN, ppgF), CLIP_MIN * 60 * 135 * 100));
  if (!pRec) return null;
  const pAn = PPG.analyze(pRec);                       // → { nn, tt, ... } (Malik-corrected PPI)
  const ppi = pAn && pAn.nn && pAn.tt ? { rr: pAn.nn, tt: pAn.tt } : null;
  out.pT0 = pRec.t0Ms;

  // ── shared epoch grid, on the FLOATING clock (all three are Clock-Contract tMs) ──
  const t0 = Math.max(cT0, eRec.t0Ms, pRec.t0Ms);
  const tEnd = t0 + CLIP_MIN * 60000;
  const rows = [];
  for (let e = t0; e + EPOCH_MIN * 60000 <= tEnd; e += EPOCH_MIN * 60000) {
    const e1 = e + EPOCH_MIN * 60000;

    // CPAP: median RespRate over the epoch, mask-on only
    const i0 = Math.max(0, Math.floor(((e - cT0) / 1000) * cFs));
    const i1 = Math.min(rrCh.data.length, Math.ceil(((e1 - cT0) / 1000) * cFs));
    const cv = [];
    for (let i = i0; i < i1; i++) if (prCh.data[i] > 0 && rrCh.data[i] > 4 && rrCh.data[i] < 40) cv.push(rrCh.data[i]);
    if (cv.length < 20) continue;
    const cpap = +mean(cv).toFixed(2);

    // ECG: NN within the epoch → Lomb-Scargle
    const en = [], et = [];
    for (let i = 0; i < eNN.nn.length; i++) {
      const tms = eRec.t0Ms + eNN.times[i] * 1000;
      if (tms >= e && tms < e1) { en.push(eNN.nn[i]); et.push(eNN.times[i]); }
    }
    if (en.length < 40) continue;
    const eLs = ECG.lombScargle(en, et);
    if (!eLs || !(eLs.respRate > 5 && eLs.respRate < 35)) continue;

    // PPG: PPI within the epoch → same estimator
    if (!ppi || !ppi.rr || !ppi.tt) continue;
    const pn = [], pt = [];
    for (let i = 0; i < ppi.rr.length; i++) {
      const tms = pRec.t0Ms + ppi.tt[i] * 1000;
      if (tms >= e && tms < e1) { pn.push(ppi.rr[i]); pt.push(ppi.tt[i]); }
    }
    if (pn.length < 40) continue;
    // NB: PPGDSP.lombScargle returns {vlf,lf,hf,totalPower,lfhf,lfnu,hfnu} — it never tracks the HF
    // PEAK FREQUENCY, so it cannot yield respRate (which is exactly why PpgDex's epochs hardcode
    // respRate:null). ECGDSP's version does (respRate = peakF*60). Use the SAME estimator on both
    // interbeat series, so any difference is DEVICE error, not method error — which is what TCH needs.
    const pLs = ECG.lombScargle(pn, pt);
    if (!pLs || !(pLs.respRate > 5 && pLs.respRate < 35)) continue;

    rows.push({ tMs: e, cpap, ecg: eLs.respRate, ppg: pLs.respRate });
  }
  out.rows = rows;
  return out;
}

/* ── run ── */
const DATES = fs.readdirSync(path.join(REPO, 'uploads', 'trio')).filter((d) => /^2026-/.test(d)).sort();
const ONLY = process.env.ONLY ? [process.env.ONLY] : DATES;
const all = [];
for (const d of ONLY) {
  let r = null;
  try { r = night(d); } catch (e) { console.log(`  ! ${d}: ${e.message}`); continue; }
  if (!r || !r.rows || !r.rows.length) { console.log(`  ∘ ${d}: no usable epochs`); continue; }
  console.log(`  ✓ ${d}: ${r.rows.length} epochs  (CPAP ${mean(r.rows.map((x) => x.cpap)).toFixed(1)} · ECG ${mean(r.rows.map((x) => x.ecg)).toFixed(1)} · PPG ${mean(r.rows.map((x) => x.ppg)).toFixed(1)} br/min)`);
  all.push(...r.rows);
}
if (!all.length) { console.log('\n  no data'); process.exit(0); }

fs.writeFileSync(process.env.OUT || '/tmp/p6.json', JSON.stringify(all));
console.log(`\n  total epochs: ${all.length}`);
