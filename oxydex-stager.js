/* Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ════════════════════════════════════════════════════════════════════════
 * oxydex-stager.js — sleep stages for an OxyDex night from the control net: the night's 1 Hz SpO₂ and
 * pulse series → the stage-lab feature layout → a `tepna-seqnet/1` weights file the user loads → the
 * JS port of the net → Viterbi → one stage per 30 s epoch.
 *
 * THE WEIGHTS ARE NOT IN THIS REPO. The control net is trained on data under access agreements, so the
 * instrument carries the MECHANISM only: a user loads a weights file through the "Load stager weights"
 * input, every loaded night is staged in the browser, and the card says "control model — not shipped"
 * with the file's own provenance (training tag, fold, inner-validation κ). Nothing is fetched.
 *
 * WHAT THE NET SEES, AND WHAT IT DOES NOT. SpO₂ (harmonised the lab's way: 8 s centred mean, whole
 * percent, 50–100 else missing) and pulse (30–200 bpm else missing). The ring's motion byte is NOT fed:
 * the lab's motion block was trained on wrist-accelerometer activity and no training cohort carries the
 * ring byte, so feeding it would be an untrained input dressed as a measurement. The motion block is
 * ABSENT (its presence flag is 0 and its columns are missing), exactly as for the PSG cohorts the net
 * learned on. The columns the net consumes are selected BY NAME from the weights file's own list; a
 * name the layout does not produce is a refusal, never a zero.
 *
 * Pure except the DOM wiring at the bottom, which only runs inside a page. Exports through one list
 * (the owned bundler leaves `export function` in place and strips `export const`'s binding).
 */
import { EPOCH_S, STAGES, harmonizeSpo2, nightFeatures } from './tools/stage-lab-core.mjs';
import { loadWeights, seqnetForward, viterbi } from './tools/seqnet-infer.mjs';

const BLOCKS_USED = ['spo2', 'pulse', 'motion'];
const BLOCK_PREFIXES = ['spo2.', 'pulse.', 'motion.'];
const WEIGHTS_FORMAT = 'tepna-seqnet/1';
const CLIP = 8;

/** A 1 Hz series (OxyDex: numbers or null per second) → Float64Array with NaN for missing/out-of-range. */
function seriesToSignal(series, lo, hi) {
  const n = series ? series.length : 0;
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = series[i];
    d[i] = typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : NaN;
  }
  return d;
}

/**
 * The stage-lab night contract from OxyDex's per-night series. `nEpochs` is the whole-epoch count;
 * a trailing partial epoch is dropped (the lab does the same). Motion is deliberately absent (header).
 */
function nightFromSeries(spo2Series, hrSeries) {
  const len = Math.max(spo2Series ? spo2Series.length : 0, hrSeries ? hrSeries.length : 0);
  const nEpochs = Math.floor(len / EPOCH_S);
  if (nEpochs < 1) return null;
  const signals = {};
  if (spo2Series && spo2Series.length) signals.spo2 = { fs: 1, data: harmonizeSpo2(seriesToSignal(spo2Series, 50, 100)) };
  if (hrSeries && hrSeries.length) signals.pulse = { fs: 1, data: seriesToSignal(hrSeries, 30, 200) };
  return { nEpochs, signals };
}

/** Parse + validate a weights file. Throws with a plain reason; never returns a half-loaded model. */
function parseWeights(json) {
  if (!json || json.format !== WEIGHTS_FORMAT) throw new Error(`not a ${WEIGHTS_FORMAT} weights file`);
  const meta = json.meta || {};
  if (!Array.isArray(meta.names) || !meta.names.length) throw new Error('weights file carries no feature-name list (meta.names)');
  if (!Array.isArray(meta.logT) || !Array.isArray(meta.logPrior)) throw new Error('weights file carries no HMM priors (meta.logT / meta.logPrior)');
  const model = loadWeights(json);
  if (!model.w['stem.weight']) throw new Error('weights file has no stem.weight');
  const kin = model.w['stem.weight'].shape[1];
  const prefixes = meta.block_prefixes || BLOCK_PREFIXES;
  if (kin !== meta.names.length + 1 + prefixes.length) throw new Error(`stem width ${kin} ≠ ${meta.names.length} names + 1 missing-fraction + ${prefixes.length} presence flags`);
  return { model, meta, prefixes };
}

/**
 * seqnet.py's tensorise, by NAME: the kept columns in the model's order, the per-epoch missing fraction,
 * one presence flag per block (1 when any epoch of any of the block's kept columns is finite), NaN → 0,
 * clip ±8. A name the layout does not produce is a refusal.
 */
function tensoriseByNames(feat, names, prefixes) {
  const idx = new Map(feat.names.map((nm, j) => [nm, j]));
  const cols = names.map((nm) => {
    const j = idx.get(nm);
    if (j === undefined) throw new Error(`the weights file expects feature "${nm}", which this layout does not produce`);
    return j;
  });
  const T = feat.X.length / feat.k;
  const kk = cols.length;
  const kin = kk + 1 + prefixes.length;
  const presence = prefixes.map((pre) => {
    let seen = false;
    for (let c = 0; c < kk && !seen; c++) {
      if (!names[c].startsWith(pre)) continue;
      for (let t = 0; t < T; t++)
        if (Number.isFinite(feat.X[t * feat.k + cols[c]])) {
          seen = true;
          break;
        }
    }
    return seen ? 1 : 0;
  });
  const X = new Float32Array(T * kin);
  for (let t = 0; t < T; t++) {
    let miss = 0;
    for (let c = 0; c < kk; c++) {
      let v = feat.X[t * feat.k + cols[c]];
      if (!Number.isFinite(v)) {
        miss++;
        v = 0;
      }
      X[t * kin + c] = v > CLIP ? CLIP : v < -CLIP ? -CLIP : v;
    }
    X[t * kin + kk] = miss / kk;
    for (let b = 0; b < prefixes.length; b++) X[t * kin + kk + 1 + b] = presence[b];
  }
  return { X, kin, T, presence };
}

/** Stage one night with a parsed weights file. Returns null when the night has no whole epoch. */
function stageNight(parsed, night) {
  if (!night) return null;
  const { model, meta, prefixes } = parsed;
  const feat = nightFeatures(night, BLOCKS_USED);
  const { X, T, presence } = tensoriseByNames(feat, meta.names, prefixes);
  const r = seqnetForward(model, X, T);
  const K = r.K;
  const logT = Float64Array.from(meta.logT.flat());
  const logPrior = Float64Array.from(meta.logPrior);
  const stages = viterbi(r.proba, T, K, logT, logPrior);
  const counts = new Array(K).fill(0);
  for (let t = 0; t < T; t++) counts[stages[t]]++;
  const minutes = {};
  STAGES.forEach((s, i) => {
    minutes[s.toLowerCase()] = (counts[i] * EPOCH_S) / 60;
  });
  return {
    epochSec: EPOCH_S,
    nEpochs: T,
    stages,
    proba: r.proba,
    minutes,
    presence: { spo2: presence[0], pulse: presence[1], motion: presence[2] },
    model: {
      tag: meta.tag || null,
      fold: meta.fold != null ? meta.fold : null,
      innerValKappa: meta.inner_val_kappa != null ? meta.inner_val_kappa : null,
      classWeight: meta.class_weight || null,
      cohorts: typeof meta.cohorts === 'string' ? meta.cohorts.split(',').length : null,
      random: !!meta.random
    }
  };
}

function stageFromSeries(parsed, spo2Series, hrSeries) {
  return stageNight(parsed, nightFromSeries(spo2Series, hrSeries));
}

/** A hypnogram strip as inline SVG: one lane per stage (Wake top … REM bottom), one bar per epoch. */
function hypnogramSvg(stages, width, height) {
  const T = stages.length;
  const W = width || 640;
  const H = height || 56;
  const laneH = H / STAGES.length;
  const colours = ['#c0392b', '#2980b9', '#1f4e79', '#8e44ad'];
  let bars = '';
  let run = 0;
  for (let t = 0; t <= T; t++) {
    if (t === T || stages[t] !== stages[run]) {
      const s = stages[run];
      const x = (run / T) * W;
      const w = ((t - run) / T) * W;
      bars += `<rect x="${x.toFixed(2)}" y="${(s * laneH).toFixed(2)}" width="${Math.max(w, 0.5).toFixed(2)}" height="${laneH.toFixed(2)}" fill="${colours[s]}"/>`;
      run = t;
    }
  }
  const labels = STAGES.map((s, i) => `<text x="2" y="${(i * laneH + laneH * 0.72).toFixed(2)}" font-size="${Math.min(10, laneH - 2).toFixed(1)}" fill="#fff" opacity="0.85">${s}</text>`).join('');
  return `<svg class="hypnogram" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="hypnogram, ${T} epochs">${bars}${labels}</svg>`;
}

/* ── DOM wiring: the weights input stages every loaded night, then re-renders ─────────────────────── */
function wireStager(doc, win) {
  const inp = doc.getElementById('stagerWeightsInput');
  const status = doc.getElementById('stagerStatus');
  if (!inp || inp._wired) return;
  inp._wired = 1;
  const setS = (msg, ok) => {
    if (status) {
      status.textContent = msg;
      status.classList.toggle('ok', !!ok);
    }
  };
  inp.addEventListener('change', function () {
    const file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      let parsed;
      try {
        parsed = parseWeights(JSON.parse(rd.result));
      } catch (e) {
        setS('⚠ ' + e.message, false);
        return;
      }
      win._stagerModel = parsed;
      const nights = win.allNights ? Object.values(win.allNights) : [];
      let staged = 0;
      for (const n of nights) {
        try {
          n.stager = stageFromSeries(parsed, n.spo2Series, n.hrSeries);
          n.stagerError = n.stager ? null : 'no whole 30 s epoch';
          if (n.stager) staged++;
        } catch (e) {
          n.stager = null;
          n.stagerError = e.message;
        }
      }
      const m = parsed.meta;
      setS(
        `✓ ${m.tag || 'weights'}${m.fold != null ? ' · fold ' + m.fold : ''}${m.inner_val_kappa != null ? ' · inner-val κ ' + Number(m.inner_val_kappa).toFixed(3) : ''} · ${staged}/${nights.length} night(s) staged · control model, not shipped`,
        true
      );
      try {
        if (typeof win.renderAll === 'function' && nights.length) win.renderAll();
      } catch (_e) {
        /* the card re-renders on the next load */
      }
    };
    rd.onerror = () => setS('⚠ could not read file', false);
    rd.readAsText(file);
  });
}
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const w = /** @type {any} */ (window);
  w.OxyDexStager = { parseWeights, stageFromSeries, stageNight, nightFromSeries, hypnogramSvg };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => wireStager(document, w));
  else wireStager(document, w);
}

export { BLOCKS_USED, BLOCK_PREFIXES, WEIGHTS_FORMAT, seriesToSignal, nightFromSeries, parseWeights, tensoriseByNames, stageNight, stageFromSeries, hypnogramSvg, wireStager };
