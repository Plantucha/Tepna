#!/usr/bin/env node
/*
 * stage-lab.mjs — train and evaluate sleep stagers from any mix of signals, against expert PSG labels
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. See the LICENSE and
 * NOTICE files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * Brief: briefs/STAGE-LAB-2026-09-27-BRIEF.md (bands and plants are PRE-STATED there, before any run).
 * Library: tools/stage-lab-core.mjs (feature blocks, context, GBDT, HMM — pure, browser-importable).
 *
 * COHORTS (night adapters → { id, nEpochs, labels:Int8Array, signals:{ spo2:{fs:1,data} , ... } }):
 *   challenge — PhysioNet/CinC 2018 training (ODC-By): WFDB MAT-v4 signals + `.arousal` WFDB annotations
 *   shhs      — NSRR SHHS1 EDF + profusion XML (DUA: nothing per-night may ever enter the repo)
 *   ucddb     — PhysioNet St Vincent's/UCD apnea DB (ODC-By): EDF `.rec` + one code per 30 s epoch
 *   capslpdb  — PhysioNet CAP Sleep DB (ODC-By): EDF + R&K rows placed by clock time (columns found by header name)
 *   boas      — Bitbrain Open Access Sleep, OpenNeuro ds005555 (CC0): BIDS PSG EDF + human-consensus stage_hum
 *   isruc     — ISRUC-Sleep (internal only: citation-required): EDF .rec + two scorers' per-epoch codes
 * Future adapters (Tepna's own O2Ring / H10 nights, Muse EEG) plug in beside these two.
 *
 *   node tools/stage-lab.mjs --selftest
 *   node tools/stage-lab.mjs features --cohort challenge --dir <training-dir> --cache <dir> [--workers N]
 *   node tools/stage-lab.mjs features --cohort shhs --dir <polysomnography-dir> --cache <dir>
 *   node tools/stage-lab.mjs eval --cache <dir> --cv challenge --extra shhs --extra-n 0,500,all
 *   node tools/stage-lab.mjs formula --cache <dir> --train ucddb,capslpdb,boas --test challenge,shhs
 *
 * TOOL BUILD STANDARD (briefs/TOOL-BUILD-STANDARD-2026-09-13-BRIEF.md):
 *  §2.2 resumable — one cache file per night, written atomically; a rerun skips finished nights.
 *  §2.3 killable — workers are children in this process group; SIGINT/SIGTERM kills the group.
 *  §2.4/2.5 heartbeat — one line every 15 s to stderr AND <cache>/heartbeat.txt: done, rate, ETA,
 *        and the running answer (nights cached / kappa of the folds finished so far).
 *  §2.6 profile (single night, 2026-09-27): feature extraction dominates; GBDT fit is
 *        O(rows x features x leaves) per tree — CPU, rows subsampled by --row-stride; GPU not used.
 *  §2.8 pool = min(--workers, cores - 2), floor 1: the box is shared with other sessions' gates.
 *  §2.11 NOT IMPLEMENTED: ecg-hrv / motion / eeg feature blocks; any cohort not listed above; neural sequence
 *        models (bench's sequence arm is auto-context stacking); GPU (not measured to pay — §2.6).
 * ∅: a sample outside physiology (SpO2 < 50 or > 100) is null, never clamped; an unscored epoch is -1.
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, writeFileSync, appendFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { basename, join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as Core from './stage-lab-core.mjs';
import { makeRealm } from './nsrr-stage-validate.mjs';
import { isCliEntry } from './argv-guard.mjs';
import { makeRealm as makeEcgRealm } from './ecg-physionet-differential.mjs'; // v16: the suite's own Pan–Tompkins for ECG-derived pulse

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);

/* ── WFDB annotation file (MIT format) → [{ sample, aux }] ─────────────────────────────────────── */
export function parseWfdbAnnotations(buf) {
  const out = [];
  let t = 0,
    i = 0,
    pendingAux = null;
  while (i + 1 < buf.length) {
    const w = buf[i] | (buf[i + 1] << 8);
    i += 2;
    const A = w >> 10,
      I = w & 0x3ff;
    if (A === 0 && I === 0) break; // end of file
    if (A === 59) {
      t += buf[i + 2] | (buf[i + 3] << 8) | (buf[i] << 16) | (buf[i + 1] << 24);
      i += 4;
      continue;
    } // SKIP: PDP-11 long
    if (A === 63) {
      const s = buf
        .slice(i, i + I)
        .toString('latin1')
        .replace(/\0+$/, '');
      i += I + (I & 1);
      if (out.length) out[out.length - 1].aux = s;
      continue;
    }
    if (A >= 59) continue; // NUM / SUB / CHN: not needed here
    t += I;
    out.push({ sample: t, code: A, aux: pendingAux });
    pendingAux = null;
  }
  return out;
}

/* Stage annotations (aux W/N1/N2/N3/R at transition samples) → per-epoch labels, forward-filled. */
export function stagesFromAnnotations(anns, fs, nSamples) {
  const n = Math.floor(nSamples / (fs * Core.EPOCH_S)),
    y = new Int8Array(n).fill(-1);
  const st = anns.filter((a) => a.aux in Core.STAGE_INDEX).sort((a, b) => a.sample - b.sample);
  for (let k = 0; k < st.length; k++) {
    const from = Math.round(st[k].sample / (fs * Core.EPOCH_S)),
      to = k + 1 < st.length ? Math.round(st[k + 1].sample / (fs * Core.EPOCH_S)) : n;
    for (let e = Math.max(0, from); e < Math.min(n, to); e++) y[e] = Core.STAGE_INDEX[st[k].aux];
  }
  return y;
}

/* ── adapters ──────────────────────────────────────────────────────────────────────────────────── */
function secondMedians(x, fs) {
  // per-second median, NaN outside 50–100 %
  const secs = Math.floor(x.length / fs),
    out = new Float64Array(secs),
    w = new Float64Array(fs);
  for (let s = 0; s < secs; s++) {
    for (let k = 0; k < fs; k++) w[k] = x[s * fs + k];
    const srt = Array.from(w).sort((a, b) => a - b),
      m = srt[fs >> 1];
    out[s] = m >= 50 && m <= 100 ? m : NaN;
  }
  return out;
}

/* ── EDF: one channel by label, in physical units (header parsed here; no dependency) ──────────── */
export function readEdfChannel(path, labelRe) {
  const fd = openSync(path, 'r'),
    h0 = Buffer.alloc(256);
  readSync(fd, h0, 0, 256, 0);
  const ns = parseInt(h0.toString('latin1', 252, 256)),
    nrec = parseInt(h0.toString('latin1', 236, 244)),
    dur = parseFloat(h0.toString('latin1', 244, 252));
  const H = Buffer.alloc(256 * ns);
  readSync(fd, H, 0, H.length, 256);
  const fld = (off, w, i) => H.toString('latin1', ns * off + i * w, ns * off + (i + 1) * w).trim();
  const labels = Array.from({ length: ns }, (_, i) => fld(0, 16, i)),
    e = labels.findIndex((l) => labelRe.test(l));
  if (e < 0) {
    closeSync(fd);
    return null;
  }
  const pmin = +fld(104, 8, e),
    pmax = +fld(112, 8, e),
    dmin = +fld(120, 8, e),
    dmax = +fld(128, 8, e);
  const nsamp = Array.from({ length: ns }, (_, i) => parseInt(fld(216, 8, i))),
    recBytes = 2 * nsamp.reduce((a, b) => a + b, 0);
  const before = 2 * nsamp.slice(0, e).reduce((a, b) => a + b, 0),
    k = nsamp[e],
    out = new Float64Array(nrec * k),
    b = Buffer.alloc(2 * k);
  for (let r = 0; r < nrec; r++) {
    readSync(fd, b, 0, 2 * k, 256 * (ns + 1) + r * recBytes + before);
    for (let i = 0; i < k; i++) out[r * k + i] = pmin + ((b.readInt16LE(2 * i) - dmin) * (pmax - pmin)) / (dmax - dmin);
  }
  closeSync(fd);
  const t = h0.toString('latin1', 176, 184).split('.').map(Number); // hh.mm.ss of the recording start
  return { fs: k / dur, data: out, startSec: t[0] * 3600 + t[1] * 60 + t[2] };
}

const spo2Of = (ch) => (Math.round(ch.fs) === 1 ? Float64Array.from(ch.data, (v) => (v >= 50 && v <= 100 ? v : NaN)) : secondMedians(ch.data, Math.round(ch.fs)));

/* ── pulse sources (v16, brief §15) ───────────────────────────────────────────────────────────
   A device pulse rate where the PSG carries one (SHHS `H.R.` · UCDDB `Pulse` · CAP `HR`), else the instantaneous heart
   rate derived from the ECG with the suite's own Pan–Tompkins (ECGDSP.analyze → beat times): 60/RR held between beats,
   sampled at 1 Hz, RR outside 0.3–2 s → NaN, then a 4 s mean so it resembles an oximeter's smoothed PR. The two sources
   are NOT the same instrument — a confound the brief states and the per-cohort table shows. BOAS has no readable pulse
   (PSG_PULSE's unit is unknown): its pulse columns are NaN (§∅), never a guess. */
const prOf = (x, fs) => {
  const d = Math.round(fs) === 1 ? Float64Array.from(x) : secondMediansAny(x, Math.round(fs), 30, 200);
  for (let i = 0; i < d.length; i++) if (!(d[i] >= 30 && d[i] <= 200)) d[i] = NaN;
  return d;
};
const sigs = (spo2, pulse) => (pulse ? { spo2: { fs: 1, data: spo2 }, pulse: { fs: 1, data: pulse } } : { spo2: { fs: 1, data: spo2 } });
let ecgRealm = null;
// ECGDSP.analyze on a raw lead, once per (array, fs): the pulse proxy and the beat block share the call
const ecgMemo = new WeakMap();
function ecgAnalyze(x, fs) {
  if (!x || x.length < fs * 60) return null;
  if (ecgMemo.has(x)) return ecgMemo.get(x);
  if (!ecgRealm) ecgRealm = makeEcgRealm();
  // robust scale to a ±~2000 integer range: Pan–Tompkins thresholds adapt, the physical unit does not matter
  const s = Float64Array.from(x).filter(Number.isFinite).sort();
  let out = null;
  if (s.length) {
    const med = s[s.length >> 1],
      a = Float64Array.from(s, (v) => Math.abs(v - med)).sort(),
      mad = a[a.length >> 1] || 1;
    const int16 = new Int16Array(x.length);
    for (let i = 0; i < x.length; i++) {
      const v = ((x[i] - med) / mad) * 200;
      int16[i] = Number.isFinite(v) ? Math.max(-32000, Math.min(32000, Math.round(v))) : 0;
    }
    out = ecgRealm.ECGDSP.analyze({ int16, fs, t0Ms: 0, durSec: x.length / fs, gaps: [] });
  }
  ecgMemo.set(x, out);
  return out;
}

/* v28e (brief §25): the beat series for the ecg-hrv block, gated the way ECGDex gates HRV — a beat is usable at
   SQI >= 0.3 (ecgdex-dsp.js sqiThr default) and when its NN does not span a gap. R amplitude is read on the
   band-passed trace (baseline wander removed), the input of ECG-derived respiration. */
export const ECG_SQI_MIN = 0.3;
export function ecgBeats(x, fs) {
  const out = ecgAnalyze(x, fs);
  const t = out && out.ttSec;
  if (!t || t.length < 10) return null;
  const m = t.length,
    ok = new Uint8Array(m),
    amp = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    ok[j] = out.sqi[j] >= ECG_SQI_MIN && !out.nnSpansGap[j] ? 1 : 0;
    const p = out.peaksIdx[j];
    amp[j] = out.bp && p >= 0 && p < out.bp.length ? out.bp[p] : NaN;
  }
  return { t: Float64Array.from(t), nn: Float64Array.from(out.nnMs), ok, amp };
}

/* Each cohort's ECG lead, read only when the ecg-hrv block is asked for. A cohort without one is absent from ECG
   training, never a night of zeros. Challenge's lead comes from its loader (the .mat stream is read once). */
const ECG_SOURCES = {
  shhs: (dir, id) => readEdfChannel(join(dir, 'edfs', 'shhs1', id + '.edf'), /^ecg$/i),
  shhs2: (dir, id) => readEdfChannel(join(dir, 'edfs', 'shhs2', id + '.edf'), /^ecg$/i),
  ucddb: (dir, id) => readEdfChannel(join(dir, id + '.rec'), /^ecg$/i),
  capslpdb: (dir, id) => readEdfChannel(join(dir, id + '.edf'), /ecg/i),
  isruc: (dir, key) => readEdfChannel(join(dir, key.replace(/~/g, '/') + '.rec'), /^(x2|ecg.*)$/i)
};

function ihrFromEcg(x, fs) {
  const out = ecgAnalyze(x, fs);
  const t = out && out.times;
  if (!t || t.length < 10) return null;
  const secs = Math.floor(x.length / fs),
    hr = new Float64Array(secs).fill(NaN);
  for (let i = 1; i < t.length; i++) {
    const rr = t[i] - t[i - 1];
    if (!(rr >= 0.3 && rr <= 2)) continue;
    const lo = Math.floor(t[i - 1]),
      hi = Math.min(secs, Math.ceil(t[i]));
    for (let k = lo; k < hi; k++) hr[k] = 60 / rr;
  }
  const sm = new Float64Array(secs).fill(NaN);
  for (let k = 0; k < secs; k++) {
    let n = 0,
      acc = 0;
    for (let j = -2; j <= 1; j++) {
      const v = hr[k + j];
      if (Number.isFinite(v)) {
        acc += v;
        n++;
      }
    }
    if (n) sm[k] = acc / n;
  }
  return sm;
}

/* UCDDB (ODC-By): EDF in `.rec`; `<id>_stage.txt` = one code per 30 s epoch from the recording start:
   0 Wake · 1 REM · 2 S1 · 3 S2 · 4 S3 · 5 S4 · 6 artifact · 7 indeterminate (PhysioNet ucddb documentation). */
const UCDDB_CODE = { 0: 0, 1: 3, 2: 1, 3: 1, 4: 2, 5: 2 };
const ucddb = {
  list: (dir) =>
    readdirSync(dir)
      .filter((f) => /^ucddb\d+\.rec$/.test(f))
      .map((f) => f.slice(0, -4))
      .sort(),
  load(dir, id) {
    const ch = readEdfChannel(join(dir, id + '.rec'), /^(spo2|sao2)$/i);
    if (!ch) return null;
    const codes = readFileSync(join(dir, id + '_stage.txt'), 'latin1')
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '');
    const labels = Int8Array.from(codes, (c) => (c.trim() in UCDDB_CODE ? UCDDB_CODE[c.trim()] : -1));
    const pr = readEdfChannel(join(dir, id + '.rec'), /^pulse$/i);
    return { id, nEpochs: labels.length, labels, signals: sigs(spo2Of(ch), pr ? prOf(pr.data, pr.fs) : null) };
  }
};

/* CAP Sleep DB (ODC-By): `<id>.txt` rows "Stage<TAB>Position<TAB>hh:mm:ss<TAB>Event<TAB>Duration…"; only
   `SLEEP-` events are stages (R&K: W, S1–S4, R, MT). Rows are placed by clock time against the EDF start. */
const CAP_CODE = { W: 0, S1: 1, S2: 1, S3: 2, S4: 2, R: 3, REM: 3 };
const capslpdb = {
  list: (dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.edf'))
      .map((f) => f.slice(0, -4))
      .sort(),
  load(dir, id) {
    const ch = readEdfChannel(join(dir, id + '.edf'), /^(spo2|sao2)$/i);
    if (!ch) return null;
    const secs = Math.floor(ch.data.length / ch.fs),
      n = Math.floor(secs / Core.EPOCH_S),
      labels = new Int8Array(n).fill(-1);
    let col = null; // columns located by HEADER NAME: some files omit "Position"
    for (const line of readFileSync(join(dir, id + '.txt'), 'latin1').split(/\r?\n/)) {
      const c = line.split('\t');
      if (!col) {
        if (/^Sleep Stage/i.test(c[0])) col = { st: 0, t: c.findIndex((h) => /^Time/i.test(h)), ev: c.findIndex((h) => /^Event/i.test(h)), du: c.findIndex((h) => /^Duration/i.test(h)) };
        continue;
      }
      if (col.t < 0 || col.ev < 0 || !/^SLEEP-/.test(c[col.ev] || '') || !/^\d{1,2}[:.]\d\d[:.]\d\d$/.test(c[col.t] || '')) continue;
      const [hh, mm, ss] = c[col.t].split(/[:.]/).map(Number);
      let off = hh * 3600 + mm * 60 + ss - ch.startSec;
      if (off < -43200) off += 86400; // past midnight
      const e0 = Math.round(off / Core.EPOCH_S),
        m = Math.max(1, Math.round((+c[col.du] || 30) / Core.EPOCH_S));
      for (let k = 0; k < m; k++) if (e0 + k >= 0 && e0 + k < n) labels[e0 + k] = c[col.st] in CAP_CODE ? CAP_CODE[c[col.st]] : -1;
    }
    const hr = readEdfChannel(join(dir, id + '.edf'), /^(hr|pulse|pr)$/i);
    let pulse = hr ? prOf(hr.data, hr.fs) : null;
    if (!pulse) {
      const ecg = readEdfChannel(join(dir, id + '.edf'), /ecg/i);
      if (ecg) pulse = ihrFromEcg(ecg.data, ecg.fs);
    }
    return { id, nEpochs: n, labels, signals: sigs(spo2Of(ch), pulse) };
  }
};

/* BOAS — Bitbrain Open Access Sleep (OpenNeuro ds005555, CC0). BIDS layout: sub-N/eeg/sub-N_task-Sleep_acq-psg_*.
   Labels: `stage_hum` ONLY (majority vote of 3 expert scorers; README: 0 W · 1 N1 · 2 N2 · 3 N3 · 4 REM; 8 is
   undefined there → unscored). `stage_ai` is NEVER read: training on another model's output would be circular.
   Only sessions whose PSG carries PSG_SPO2 load (104 of 128); PSG_PULSE is kept for the pulse block. */
const BOAS_CODE = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 3 };
const boas = {
  list: (dir) =>
    readdirSync(dir)
      .filter((d) => /^sub-\d+$/.test(d) && existsSync(join(dir, d, 'eeg', `${d}_task-Sleep_acq-psg_eeg.edf`)))
      .sort((a, b) => +a.slice(4) - +b.slice(4)),
  load(dir, id) {
    const base = join(dir, id, 'eeg', `${id}_task-Sleep_acq-psg_`);
    const ch = readEdfChannel(base + 'eeg.edf', /^PSG_SPO2$/);
    if (!ch) return null;
    const rows = readFileSync(base + 'events.tsv', 'utf8')
      .trim()
      .split('\n')
      .map((l) => l.split('\t'));
    const hi = rows[0].indexOf('stage_hum'),
      oi = rows[0].indexOf('onset');
    if (hi < 0 || oi < 0) return null;
    const spo2 = spo2Of(ch),
      n = Math.floor(spo2.length / Core.EPOCH_S),
      labels = new Int8Array(n).fill(-1);
    for (const r of rows.slice(1)) {
      const e = Math.round(+r[oi] / Core.EPOCH_S);
      if (e >= 0 && e < n && r[hi] in BOAS_CODE) labels[e] = BOAS_CODE[r[hi]];
    }
    /* PSG_PULSE is NOT read: its unit is "unknown" and its median (e.g. 34) is not a plausible pulse RATE — it may be
       the pleth waveform. Absent beats wrong (§∅); verify its meaning before the pulse block uses BOAS. */
    return { id, nEpochs: n, labels, signals: { spo2: { fs: 1, data: spo2 } } };
  }
};

/* per-second median with a plausibility window (∅: outside [lo, hi] is not a measurement) */
function secondMediansAny(x, fs, lo, hi) {
  const secs = Math.floor(x.length / fs),
    out = new Float64Array(secs);
  for (let s = 0; s < secs; s++) {
    const w = Array.from(x.subarray(s * fs, (s + 1) * fs)).sort((a, b) => a - b),
      m = w[fs >> 1];
    out[s] = m >= lo && m <= hi ? m : NaN;
  }
  return out;
}

/* ISRUC-Sleep (sleeptight.isr.uc.pt; INTERNAL use only — the site asks for citation, never in a published model).
   Layout as downloaded: <group>/<subject>[/<session>]/<n>.rec (EDF) beside <n>_1.txt and <n>_2.txt — one AASM code per
   30 s epoch from each of TWO scorers (0 W · 1 N1 · 2 N2 · 3 N3 · 5 REM). Scorer 1 is the label; scorer 2 is kept
   for the human–human ceiling. Oximetry is labelled SpO2 or SaO2 depending on the recording. */
const ISRUC_CODE = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3 };
function isrucStages(p) {
  if (!existsSync(p)) return null;
  return Int8Array.from(
    readFileSync(p, 'latin1')
      .split(/\r?\n/)
      .filter((l) => l.trim() !== ''),
    (c) => (c.trim() in ISRUC_CODE ? ISRUC_CODE[c.trim()] : -1)
  );
}
const isruc = {
  list(dir) {
    const out = [],
      walk = (d, rel) => {
        for (const e of readdirSync(join(dir, d), { withFileTypes: true })) {
          if (e.isDirectory()) walk(join(d, e.name), rel ? rel + '/' + e.name : e.name);
          else if (e.name.endsWith('.rec')) out.push((rel ? rel + '/' : '') + e.name.slice(0, -4));
        }
      };
    walk('', '');
    return out.sort().map((p) => p.replace(/\//g, '~')); // ids are cache FILE names: no '/'
  },
  load(dir, key) {
    const id = key.replace(/~/g, '/');
    const ch = readEdfChannel(join(dir, id + '.rec'), /^(spo2|sao2)$/i);
    if (!ch) return null;
    const s1 = isrucStages(join(dir, id + '_1.txt'));
    if (!s1) return null;
    const spo2 = spo2Of(ch),
      n = Math.min(s1.length, Math.floor(spo2.length / Core.EPOCH_S));
    return {
      id: key,
      nEpochs: n,
      labels: s1.subarray(0, n),
      labels2: isrucStages(join(dir, id + '_2.txt')),
      signals: sigs(
        spo2,
        (() => {
          const ecg = readEdfChannel(join(dir, id + '.rec'), /^(x2|ecg.*)$/i);
          return ecg ? ihrFromEcg(ecg.data, ecg.fs) : null;
        })()
      )
    };
  }
};

export /* ── prepared wrist-accelerometer cohorts (v17): ~/stagetest/motion-prep.py converts each dataset to 1 Hz f64 series +
   a labels JSON (data conversion only; the features are computed HERE). No SpO₂ in any of them → those columns are NaN. */
const prepared = (source) => ({
  list: (dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .sort(),
  load(dir, id) {
    const m = JSON.parse(readFileSync(join(dir, id + '.json'), 'utf8'));
    const f64 = (nm) => {
      const p = join(dir, `${id}.${nm}.f64`);
      if (!existsSync(p)) return null;
      const b = readFileSync(p);
      return { fs: 1, data: new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) };
    };
    const signals = { motion: f64('motion') },
      pulse = f64('pulse');
    if (pulse) signals.pulse = pulse;
    if (!signals.motion) return null;
    return { id, nEpochs: m.n, labels: Int8Array.from(m.labels), signals, source: source + ' · ' + (m.source || '') };
  }
});

const COHORTS = {
  sleepaccel: prepared('sleep-accel'),
  bidsleep: prepared('bidsleep'),
  newcastle: prepared('newcastle'),
  isruc,
  boas,
  ucddb,
  capslpdb,
  challenge: {
    list: (dir) =>
      readdirSync(dir)
        .filter((d) => /^tr\d\d-\d{4}$/.test(d))
        .sort(),
    load(dir, id) {
      const hea = readFileSync(join(dir, id, id + '.hea'), 'utf8')
        .trim()
        .split('\n');
      const [, nsigS, fsS, nS] = hea[0].split(/\s+/),
        nsig = +nsigS,
        fs = +fsS,
        nSamp = +nS;
      const lines = hea.slice(1, 1 + nsig),
        row = lines.findIndex((l) => /\sSaO2$/.test(l.trim())),
        rowE = lines.findIndex((l) => /\sECG$/.test(l.trim()));
      if (row < 0) return null;
      const gtok = lines[row].split(/\s+/)[2],
        gain = parseFloat(gtok),
        base = parseFloat(gtok.split('(')[1]);
      const fd = openSync(join(dir, id, id + '.mat'), 'r'),
        hdr = Buffer.alloc(20);
      readSync(fd, hdr, 0, 20, 0);
      const off = 20 + hdr.readInt32LE(16),
        chunk = fs * 600,
        x = new Float64Array(nSamp),
        xe = rowE >= 0 ? new Float64Array(nSamp) : null,
        b = Buffer.alloc(chunk * nsig * 2);
      for (let s0 = 0; s0 < nSamp; s0 += chunk) {
        // stream: never hold the whole 13-channel file
        const k = Math.min(chunk, nSamp - s0);
        readSync(fd, b, 0, k * nsig * 2, off + s0 * nsig * 2);
        for (let i = 0; i < k; i++) {
          x[s0 + i] = (b.readInt16LE((i * nsig + row) * 2) - base) / gain;
          if (xe) xe[s0 + i] = b.readInt16LE((i * nsig + rowE) * 2);
        }
      }
      closeSync(fd);
      const labels = stagesFromAnnotations(parseWfdbAnnotations(readFileSync(join(dir, id, id + '.arousal'))), fs, nSamp);
      return { id, nEpochs: labels.length, labels, signals: sigs(secondMedians(x, fs), xe ? ihrFromEcg(xe, fs) : null), ecgRaw: xe ? { data: xe, fs } : null };
    }
  },
  shhs: shhsVisit('shhs1'),
  shhs2: shhsVisit('shhs2') // v18: the same subjects five years later — folds MUST group by subject (--group-subjects)
};

function shhsVisit(visit) {
  return {
    list: (dir) =>
      readdirSync(join(dir, 'edfs', visit))
        .filter((f) => f.endsWith('.edf'))
        .map((f) => f.slice(0, -4))
        .sort(),
    realm: null,
    load(dir, id) {
      if (!this.realm) this.realm = makeRealm(); // the realm nsrr-stage-validate already maintains
      const { CpapEdf, NSRR } = this.realm;
      const b = readFileSync(join(dir, 'edfs', visit, id + '.edf'));
      const edf = CpapEdf.readEDF(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      const key = Object.keys(edf.signals).find((k) => /^(sao2|spo2)$/i.test(k.replace(/\s/g, '')));
      if (!key) return null;
      const sig = edf.signals[key],
        fs = Math.round(sig.fs) || 1;
      const ann = NSRR.parseNsrrXml(readFileSync(join(dir, 'annotations-events-nsrr', visit, id + '-nsrr.xml'), 'utf8'), 0);
      if (!ann.hasStageLabels) return null;
      const spo2 = fs === 1 ? Float64Array.from(sig.data, (v) => (v >= 50 && v <= 100 ? v : NaN)) : secondMedians(sig.data, fs);
      const n = Math.floor(spo2.length / Core.EPOCH_S),
        labels = new Int8Array(n).fill(-1);
      for (let e = 0; e < Math.min(n, ann.epochs.length); e++) {
        const s = ann.epochs[e];
        if (s && s in Core.STAGE_INDEX) labels[e] = Core.STAGE_INDEX[s];
      }
      const hk = Object.keys(edf.signals).find((k) => /^(h\.?r\.?|pr|pulse)$/i.test(k.replace(/\s/g, '')));
      return { id, nEpochs: n, labels, signals: sigs(spo2, hk ? prOf(edf.signals[hk].data, edf.signals[hk].fs) : null) };
    }
  };
}

/* ── cache: one binary file per night (atomic rename), plus a JSON sidecar ────────────────────── */
function cachePaths(cache, cohort, id, tag) {
  const d = join(cache, cohort);
  return { d, bin: join(d, `${id}.${tag}.f32`), meta: join(d, `${id}.${tag}.json`) };
}

function buildOne(cohort, dir, cache, id, blocks, harm, tagOverride = null) {
  // --tag names a feature SET (e.g. oxy1) so a changed block layout never mixes with an older cache under the same name
  const tag = tagOverride || (harm ? blocks.map((b) => (b === 'spo2' ? 'spo2h' : b)).join('+') : blocks.join('+')),
    p = cachePaths(cache, cohort, id, tag);
  if (existsSync(p.meta)) return 'skip';
  const night = COHORTS[cohort].load(dir, id);
  if (!night) {
    writeFileSync(p.meta, JSON.stringify({ id, skipped: 'no usable signal or labels' }));
    return 'none';
  }
  const sp = night.signals.spo2 && night.signals.spo2.data;
  const valid = sp ? sp.reduce((k, v) => k + (Number.isFinite(v) ? 1 : 0), 0) / Math.max(1, sp.length) : 0;
  if (sp && blocks.includes('spo2') && valid < 0.5) {
    // a present-but-empty channel is not a night of SpO2; a cohort with NO SpO2 channel keeps the night (NaN columns, §∅)
    writeFileSync(p.meta, JSON.stringify({ id, skipped: `SpO2 valid ${(valid * 100).toFixed(0)} % < 50 %` }));
    return 'none';
  }
  if (harm && night.signals.spo2) night.signals.spo2 = { fs: 1, data: Core.harmonizeSpo2(night.signals.spo2.data) }; // one virtual oximeter
  if (blocks.includes('ecg-hrv')) {
    const raw = night.ecgRaw || (ECG_SOURCES[cohort] ? ECG_SOURCES[cohort](dir, id) : null),
      beats = raw ? ecgBeats(raw.data, Math.round(raw.fs)) : null;
    if (!beats) {
      writeFileSync(p.meta, JSON.stringify({ id, skipped: raw ? 'ECG present, under 10 beats detected' : 'no ECG lead' }));
      return 'none';
    }
    night.signals.ecg = beats;
  }
  delete night.ecgRaw;
  const F = Core.nightFeatures(night, blocks);
  writeFileSync(p.bin + '.tmp', Buffer.from(F.X.buffer));
  renameSync(p.bin + '.tmp', p.bin);
  writeFileSync(p.meta + '.tmp', JSON.stringify({ id, n: night.nEpochs, k: F.k, names: F.names, labels: Array.from(night.labels) }));
  renameSync(p.meta + '.tmp', p.meta);
  return 'ok';
}

function loadCached(cache, cohort, tag) {
  const d = join(cache, cohort);
  if (!existsSync(d)) return [];
  const out = [];
  for (const f of readdirSync(d)
    .filter((f) => f.endsWith(`.${tag}.json`))
    .sort()) {
    const m = JSON.parse(readFileSync(join(d, f), 'utf8'));
    if (m.skipped) continue;
    // LAZY (§2.8 pool sizing, owner 2026-09-30 "max 8 GB at a time"): only the path is held; `xOf(t)` reads the matrix
    // when a model needs it and lets it go. A night with `keep` (bench --drop) is projected on read.
    out.push({ id: m.id, n: m.n, k: m.k, names: m.names, y: Int8Array.from(m.labels), bin: join(d, f.replace(/\.json$/, '.f32')) });
  }
  return out;
}

/* Read a night's matrix: materialised X if the object carries one, else from disk, projected by `keep` if set. */
function xOf(t) {
  if (t.X) return t.X;
  const b = readFileSync(t.bin),
    full = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  if (!t.keep) return full;
  const kf = full.length / t.n,
    X = new Float32Array(t.n * t.keep.length);
  for (let i = 0; i < t.n; i++) for (let j = 0; j < t.keep.length; j++) X[i * t.keep.length + j] = full[i * kf + t.keep[j]];
  return X;
}

/* ── heartbeat (§2.4/2.5): stderr AND a file, so it survives redirection ─────────────────────── */
function heartbeat(cache, label) {
  const t0 = Date.now();
  let last = { done: 0, total: 0, answer: '—' };
  const tick = () => {
    const el = (Date.now() - t0) / 1000,
      rate = last.done / Math.max(el, 1),
      eta = rate > 0 ? (last.total - last.done) / rate : NaN;
    const line = `[${new Date().toISOString().slice(11, 19)}] ${label}: ${last.done}/${last.total} · ${rate.toFixed(2)}/s · ETA ${Number.isFinite(eta) ? Math.round(eta) + 's' : 'unknown (no unit finished yet)'} · running: ${last.answer}`;
    process.stderr.write(line + '\n');
    try {
      appendFileSync(join(cache, 'heartbeat.txt'), line + '\n');
    } catch {
      /* the heartbeat never kills the job */
    }
  };
  const h = setInterval(tick, 15000);
  h.unref();
  return {
    set: (o) => Object.assign(last, o),
    stop: () => {
      clearInterval(h);
      tick();
    }
  };
}

/* ── features: shard across children (killable as a group) ───────────────────────────────────── */
async function cmdFeatures(a) {
  const cohort = a.cohort,
    dir = a.dir,
    cache = a.cache,
    blocks = (a.blocks || 'spo2').split(',');
  if (!COHORTS[cohort]) throw new Error(`cohort "${cohort}" is NOT IMPLEMENTED (have: ${Object.keys(COHORTS).join(', ')})`);
  mkdirSync(join(cache, cohort), { recursive: true });
  if (a.shard != null) {
    // child
    const ids = COHORTS[cohort].list(dir).slice(0, a.limit ? +a.limit : undefined); // --limit: a smoke run on the first N nights
    for (let i = +a.shard; i < ids.length; i += +a.shards) {
      try {
        buildOne(cohort, dir, cache, ids[i], blocks, !!a.harmonize, a.tag || null);
      } catch (e) {
        writeFileSync(join(cache, cohort, `${ids[i]}.err`), String(e && e.message));
      }
    }
    return;
  }
  const ids = COHORTS[cohort].list(dir).slice(0, a.limit ? +a.limit : undefined),
    tag = a.tag || (a.harmonize ? blocks.map((b) => (b === 'spo2' ? 'spo2h' : b)).join('+') : blocks.join('+'));
  const workers = Math.max(1, Math.min(+(a.workers || 8), cpus().length - 2));
  const hb = heartbeat(cache, `features ${cohort}`);
  const count = () => readdirSync(join(cache, cohort)).filter((f) => f.endsWith(`.${tag}.json`) || f.endsWith('.err')).length;
  const kids = [];
  const killAll = () => {
    for (const k of kids)
      try {
        k.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    process.exit(130);
  };
  process.on('SIGINT', killAll);
  process.on('SIGTERM', killAll);
  for (let s = 0; s < workers; s++)
    kids.push(
      spawn(
        process.execPath,
        [
          fileURLToPath(import.meta.url),
          'features',
          '--cohort',
          cohort,
          '--dir',
          dir,
          '--cache',
          cache,
          '--blocks',
          blocks.join(','),
          ...(a.harmonize ? ['--harmonize'] : []),
          ...(a.tag ? ['--tag', a.tag] : []), // the feature-set name must reach every worker
          ...(a.limit ? ['--limit', String(a.limit)] : []),
          '--shard',
          String(s),
          '--shards',
          String(workers)
        ],
        { stdio: 'inherit' }
      )
    );
  const poll = setInterval(() => hb.set({ done: count(), total: ids.length, answer: `${count()} nights cached` }), 5000);
  await Promise.all(kids.map((k) => new Promise((r) => k.on('exit', r))));
  clearInterval(poll);
  hb.set({ done: count(), total: ids.length, answer: 'done' });
  hb.stop();
  const errs = readdirSync(join(cache, cohort)).filter((f) => f.endsWith('.err')).length;
  console.log(`features ${cohort}: ${count() - errs} cached, ${errs} errors (see *.err in the cache)`);
}

/* ── eval: grouped CV on one cohort, optional extra training cohort, learning curve ──────────── */
function stackNights(nights, stride) {
  let rows = 0;
  for (const t of nights) rows += Math.ceil(t.n / stride);
  const k = nights[0].k,
    X = new Float32Array(rows * k),
    y = new Int8Array(rows);
  let r = 0;
  for (const t of nights) {
    const Xt = xOf(t);
    for (let i = 0; i < t.n; i += stride) {
      X.set(Xt.subarray(i * k, i * k + k), r * k);
      y[r++] = t.y[i];
    }
  }
  return { X, y, rows, k };
}

function trainModel(nights, o) {
  const S = stackNights(nights, o.stride);
  const model = Core.fitGBDT(S.X, S.y, S.rows, S.k, { iters: o.iters, lr: o.lr, maxLeaves: o.leaves, minLeaf: o.minLeaf, binSample: 4 });
  const cnt = new Float64Array(4);
  for (const v of S.y) if (v >= 0) cnt[v]++;
  const tot = cnt.reduce((a, b) => a + b, 0);
  return { model, logT: Core.transitions(nights.map((t) => t.y)), logPrior: Array.from(cnt, (c) => Math.log((c + 1) / (tot + 4))) };
}

function scoreNight(M, t, smooth) {
  const P = Core.predictProba(M.model, xOf(t), t.n, t.k);
  const p = smooth
    ? Core.viterbi(P, t.n, 4, M.logT, M.logPrior)
    : Int32Array.from({ length: t.n }, (_, i) => {
        let b = 0;
        for (let c = 1; c < 4; c++) if (P[i * 4 + c] > P[i * 4 + b]) b = c;
        return b;
      });
  return p;
}

async function cmdEval(a) {
  const blocks = (a.blocks || 'spo2').split(','),
    tag = blocks.join('+');
  const cv = loadCached(a.cache, a.cv, tag),
    extra = a.extra ? loadCached(a.cache, a.extra, tag) : [];
  if (!cv.length) throw new Error(`no cached ${a.cv} nights for blocks "${tag}" — run features first`);
  const folds = +(a.folds || 5),
    o = { stride: +(a['row-stride'] || 2), iters: +(a.iters || 300), lr: +(a.lr || 0.1), leaves: +(a.leaves || 31), minLeaf: +(a['min-leaf'] || 100) };
  const sizes = (a['extra-n'] || '0').split(',').map((s) => (s === 'all' ? extra.length : Math.min(+s, extra.length)));
  let seed = 20260927 >>> 0;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const order = extra.map((_, i) => i); // Fisher-Yates, seeded: the extra nights added first are a fixed random draw
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const foldOf = cv.map((_, i) => i % folds);
  const hb = heartbeat(a.cache, `eval ${a.cv}+${a.extra || 'none'}`);
  const results = [];
  for (const kx of sizes) {
    const perNight = new Array(cv.length),
      preds = new Array(cv.length);
    for (let f = 0; f < folds; f++) {
      const train = cv.filter((_, i) => foldOf[i] !== f).concat(order.slice(0, kx).map((i) => extra[i]));
      const M = trainModel(train, o);
      cv.forEach((t, i) => {
        if (foldOf[i] === f) {
          preds[i] = scoreNight(M, t, a.smooth !== 'none');
          perNight[i] = Core.confusion(t.y, preds[i]);
        }
      });
      const done = perNight.filter(Boolean);
      hb.set({ done: results.length * folds + f + 1, total: sizes.length * folds, answer: `extra=${kx} folds ${f + 1}/${folds} kappa so far ${Core.kappa(Core.sumMatrices(done)).toFixed(3)}` });
    }
    const K = Core.kappa(Core.sumMatrices(perNight)),
      ci = Core.bootstrapKappa(perNight);
    const shift = Core.kappa(
      Core.sumMatrices(
        cv.map((t, i) => {
          const n = t.n,
            h = n >> 1;
          const ys = Int8Array.from({ length: n }, (_, e) => t.y[(e + h) % n]);
          return Core.confusion(ys, preds[i]);
        })
      )
    );
    const M4 = Core.sumMatrices(perNight),
      recall = M4.map((row, c) => row[c] / row.reduce((s, v) => s + v, 0));
    results.push({ extra: kx, kappa: K, ci, shiftKappa: shift, plantFires: shift < 0.5 * K, recall });
    console.log(
      `extra ${a.extra || '-'} ${kx}: kappa ${K.toFixed(3)} [${ci[0].toFixed(3)}, ${ci[1].toFixed(3)}]  recall W/L/D/R ${recall.map((v) => Math.round(v * 100) + '%').join('/')}  half-night-shift ${shift.toFixed(3)} (${shift < 0.5 * K ? 'fires' : 'DOES NOT FIRE'})`
    );
  }
  hb.stop();
  return emitVerdict(a, results, cv.length, extra.length);
}

/* ── formula: train the explicit formula (and the teacher trees, as a ceiling) on some cohorts, test on others ──
   node tools/stage-lab.mjs formula --cache <dir> --train ucddb,capslpdb,boas --test challenge,shhs [--stride 2]
   Pre-stated (brief §5): the pass line is kappa >= 0.390 on the TEST cohort `challenge`; P1 must fire. */
async function cmdFormula(a) {
  const tag = 'spo2',
    stride = +(a.stride || 2);
  const load = (cs) => cs.split(',').flatMap((c) => loadCached(a.cache, c, tag).map((t) => ({ ...t, cohort: c })));
  const train = load(a.train),
    tests = a.test.split(',');
  if (!train.length) throw new Error('no cached training nights for ' + a.train);
  const hb = heartbeat(a.cache, `formula ${a.train} -> ${a.test}`);
  const B = (t) => Core.formulaBasis(t.names, xOf(t), t.n, t.k);
  // stack the training basis (every `stride`-th epoch)
  let rows = 0;
  const parts = train.map((t) => {
    const b = B(t);
    rows += Math.ceil(t.n / stride);
    return { b, t };
  });
  const m = parts[0].b.m,
    Z = new Float64Array(rows * m),
    y = new Int8Array(rows);
  let r = 0;
  for (const { b, t } of parts)
    for (let i = 0; i < t.n; i += stride) {
      Z.set(b.Z.subarray(i * m, i * m + m), r * m);
      y[r++] = t.y[i];
    }
  hb.set({ done: 0, total: 2, answer: `fitting formula on ${train.length} nights / ${rows} epochs` });
  const F = Core.fitSoftmax(Z, y, rows, m, { iters: +(a.iters || 400) });
  const logT = Core.transitions(train.map((t) => t.y));
  const cnt = new Float64Array(4);
  for (const v of y) if (v >= 0) cnt[v]++;
  const tot = cnt.reduce((s, v) => s + v, 0),
    logPrior = Array.from(cnt, (c) => Math.log((c + 1) / (tot + 4)));
  hb.set({ done: 1, total: 2, answer: 'formula fitted; fitting teacher trees' });
  const T = trainModel(train, { stride: Math.max(stride, 4), iters: +(a['tree-iters'] || 200), lr: 0.1, leaves: 31, minLeaf: 200 });
  hb.set({ done: 2, total: 2, answer: 'scoring test cohorts' });
  const results = {};
  for (const c of tests) {
    const test = loadCached(a.cache, c, tag);
    if (!test.length) {
      console.log(`${c}: no cached nights`);
      continue;
    }
    for (const [label, pred] of [
      [
        'formula+HMM',
        (t) => {
          const b = B(t);
          return Core.viterbi(Core.softmaxProba(F, b.Z, t.n, b.m), t.n, 4, logT, logPrior);
        }
      ],
      ['teacher trees+HMM', (t) => scoreNight(T, t, true)]
    ]) {
      const per = [],
        shifted = [];
      for (const t of test) {
        const p = pred(t);
        per.push(Core.confusion(t.y, p));
        const h = t.n >> 1;
        shifted.push(
          Core.confusion(
            Int8Array.from({ length: t.n }, (_, e) => t.y[(e + h) % t.n]),
            p
          )
        );
      }
      const k = Core.kappa(Core.sumMatrices(per)),
        ci = Core.bootstrapKappa(per),
        ks = Core.kappa(Core.sumMatrices(shifted));
      const M = Core.sumMatrices(per),
        rec = M.map((row, q) => row[q] / row.reduce((s, v) => s + v, 0));
      console.log(
        `${c.padEnd(10)} ${label.padEnd(18)} kappa ${k.toFixed(3)} [${ci[0].toFixed(3)}, ${ci[1].toFixed(3)}]  recall W/L/D/R ${rec.map((v) => Math.round(v * 100) + '%').join('/')}  half-night-shift ${ks.toFixed(3)} (${ks < 0.5 * k ? 'fires' : 'DOES NOT FIRE'})  n=${test.length}`
      );
      results[`${c}:${label}`] = { kappa: k, ci, plantFires: ks < 0.5 * k, n: test.length };
    }
  }
  hb.stop();
  console.log('\nTHE FORMULA (log-odds per stage; terms are per-night z, bend at the night median):');
  const labels = Core.formulaBasis(train[0].names, xOf(train[0]), 1, train[0].k).labels;
  console.log('term'.padEnd(44) + ['Wake', 'Light', 'Deep', 'REM'].map((s) => s.padStart(8)).join(''));
  labels.forEach((l, j) => console.log(l.padEnd(44) + F.coef.map((c) => c.w[j].toFixed(3).padStart(8)).join('')));
  console.log('intercept'.padEnd(44) + F.coef.map((c) => c.b.toFixed(3).padStart(8)).join(''));
  const main = results['challenge:formula+HMM'];
  if (main)
    emitVerdict(
      { ...a, blocks: 'spo2-formula', cv: 'challenge(test)', extra: a.train },
      [{ extra: train.length, kappa: main.kappa, ci: main.ci, shiftKappa: 0, plantFires: main.plantFires, recall: [] }],
      main.n,
      train.length
    );
  if (a.out) writeFileSync(a.out, JSON.stringify({ formula: F, logT, logPrior, trainedOn: a.train.split(',').map((c) => c) }));
}

/* ── megalab: every cohort pooled, SpO2 harmonised to one virtual oximeter (brief §6, v9) ──────────
   node tools/stage-lab.mjs megalab --cache <dir> --cohorts challenge,shhs,ucddb,capslpdb,boas --fold 0..4 | --loco challenge
   node tools/stage-lab.mjs megalab --cache <dir> --summarize
   Each fold/loco job is its own process (run them in parallel); each writes per-night confusions to
   <cache>/megalab/<job>.json. The fit reports progress from INSIDE its loop (a setInterval cannot fire
   while a synchronous fit holds the event loop — the Tool Build Standard §2.4 failure found 2026-09-27). */
async function cmdMegalab(a) {
  const tag = 'spo2h',
    dir = join(a.cache, 'megalab');
  mkdirSync(dir, { recursive: true });
  if (a.summarize) return megalabSummary(a, dir);
  const cohorts = a.cohorts.split(','),
    all = [];
  for (const c of cohorts) {
    const got = loadCached(a.cache, c, tag);
    if (!got.length) throw new Error(`megalab: cohort "${c}" has 0 cached ${tag} nights; refusing to run without it (a silent drop reproduced v9 as v10, 2026-09-28)`);
    for (const t of got) all.push({ ...t, cohort: c });
  }
  const folds = 5,
    foldOf = (t) => {
      let h = 0;
      for (const ch of t.cohort + t.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      return h % folds;
    };
  const job = a.loco ? `loco-${a.loco}` : `fold-${a.fold}`;
  if (existsSync(join(dir, job + '.json')) && !a.force) {
    console.log(`megalab ${job}: already done (resumable skip; --force to redo)`);
    return;
  }
  const isTest = a.loco ? (t) => t.cohort === a.loco : (t) => foldOf(t) === +a.fold;
  const train = all.filter((t) => !isTest(t)),
    test = all.filter(isTest);
  const beat = (msg) => {
    const line = `[${new Date().toISOString().slice(11, 19)}] megalab ${job}: ${msg}`;
    process.stderr.write(line + '\n');
    try {
      appendFileSync(join(a.cache, 'heartbeat.txt'), line + '\n');
    } catch {
      /* never kills the job */
    }
  };
  beat(`train ${train.length} nights / test ${test.length} nights`);
  const S = stackNights(train, +(a.stride || 4)),
    t0 = Date.now();
  const model = Core.fitGBDT(S.X, S.y, S.rows, S.k, { iters: +(a.iters || 200), lr: 0.1, maxLeaves: 31, minLeaf: 200, binSample: 4 }, (it, n) => {
    if (it % 10 === 0 || it === n) {
      const el = (Date.now() - t0) / 1000;
      beat(`tree iter ${it}/${n} · ${(it / el).toFixed(2)}/s · ETA ${Math.round((n - it) / (it / el))}s`);
    }
  });
  const cnt = new Float64Array(4);
  for (const v of S.y) if (v >= 0) cnt[v]++;
  const tot = cnt.reduce((s, v) => s + v, 0);
  const M = { model, logT: Core.transitions(train.map((t) => t.y)), logPrior: Array.from(cnt, (c) => Math.log((c + 1) / (tot + 4))) };
  const out = test.map((t) => {
    const p = scoreNight(M, t, true),
      h = t.n >> 1;
    return {
      cohort: t.cohort,
      conf: Core.confusion(t.y, p).map((r) => Array.from(r)),
      shift: Core.confusion(
        Int8Array.from({ length: t.n }, (_, e) => t.y[(e + h) % t.n]),
        p
      ).map((r) => Array.from(r))
    };
  });
  writeFileSync(join(dir, job + '.json'), JSON.stringify({ job, trainNights: train.length, out }));
  beat(`done, ${out.length} test nights scored`);
}

function megalabSummary(a, dir) {
  const jobs = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const toM = (x) => x.map((r) => Float64Array.from(r));
  const report = (label, nights) => {
    if (!nights.length) return null;
    const per = nights.map((n) => toM(n.conf)),
      k = Core.kappa(Core.sumMatrices(per)),
      ci = Core.bootstrapKappa(per),
      ks = Core.kappa(Core.sumMatrices(nights.map((n) => toM(n.shift))));
    const Mx = Core.sumMatrices(per),
      rec = Mx.map((row, q) => row[q] / row.reduce((s, v) => s + v, 0));
    console.log(
      `${label.padEnd(34)} kappa ${k.toFixed(3)} [${ci[0].toFixed(3)}, ${ci[1].toFixed(3)}]  recall W/L/D/R ${rec.map((v) => Math.round(v * 100) + '%').join('/')}  shift ${ks.toFixed(3)} (${ks < 0.5 * k ? 'fires' : 'DOES NOT FIRE'})  n=${nights.length}`
    );
    return { k, ci, fires: ks < 0.5 * k, n: nights.length };
  };
  const cv = jobs.filter((j) => j.job.startsWith('fold-')).flatMap((j) => j.out);
  console.log(`megalab pooled CV (${jobs.filter((j) => j.job.startsWith('fold-')).length}/5 folds present)`);
  const res = {};
  for (const c of [...new Set(cv.map((n) => n.cohort))])
    res[c] = report(
      `  CV, ${c} nights`,
      cv.filter((n) => n.cohort === c)
    );
  report('  CV, all nights', cv);
  for (const j of jobs.filter((j) => j.job.startsWith('loco-'))) report(`cross-lab: train others -> ${j.job.slice(5)}`, j.out);
  const main = res.challenge;
  if (main)
    emitVerdict(
      { ...a, blocks: 'spo2h-megalab', cv: 'megalab(challenge nights)', extra: 'all cohorts' },
      [{ extra: 0, kappa: main.k, ci: main.ci, shiftKappa: 0, plantFires: main.fires, recall: [] }],
      main.n,
      cv.length
    );
}

/* ── bench: several model families on IDENTICAL folds of the pooled cohorts (brief §8, v11) ──────────
   node tools/stage-lab.mjs bench --cache <dir> --cohorts a,b,.. --model <m> --fold <0..4>     (one job; run many in parallel)
   node tools/stage-lab.mjs bench --cache <dir> --summarize
   Models: gbdt · gbdt-big · logistic · formula · autocontext. Every model gets the same HMM smoothing, the same
   folds (hash of cohort+night, as megalab) and writes <cache>/bench/<model>-fold-<f>.json. Resumable per job. */
const BENCH_MODELS = [
  'gbdt',
  'gbdt-big',
  'logistic',
  'formula',
  'autocontext',
  'hsmm',
  'autocontext-hsmm',
  'oracle-ctx',
  'oracle-far',
  'hsmm-notime',
  'seqnet',
  'waveformula',
  'waveformula-nowave',
  'waveformula-distill',
  'autocontext3',
  'waveformula-p3'
];
/* seqnet is trained by ~/stagetest/seqnet.py (PyTorch); its fold files land in the same bench dir and are summarised here. */
/* v13 (brief §10): hsmm = gbdt posteriors decoded by the explicit-duration HSMM with the time-of-night prior;
   autocontext-hsmm = the same decoder on autocontext posteriors; oracle-ctx = DIAGNOSTIC ONLY — stage 2 sees the TRUE
   neighbouring stages (never the epoch itself), so it bounds what sequence structure could give. Never a verdict. */
const BENCH_DIAGNOSTIC = new Set(['oracle-ctx', 'oracle-far', 'hsmm-notime', 'waveformula-nowave']);
const AC_OFFSETS = [-20, -10, -5, -2, -1, 1, 2, 5, 10, 20],
  AC_WINDOWS = [5, 15, 40];

/* Auto-context: from a night's class probabilities P (n x 4), the neighbourhood of predictions — probabilities at
   fixed offsets, centred means over three windows, and the night's overall predicted stage mix. Out of range → NaN. */
function autoContext(P, n, excludeCentre = false, minOff = 0) {
  const off = AC_OFFSETS.filter((d) => Math.abs(d) >= minOff),
    ex = Math.max(excludeCentre ? 1 : 0, minOff); // v13b: |d| ≥ minOff, windows drop ±(minOff−1)
  const k = off.length * 4 + AC_WINDOWS.length * 4 + 4,
    F = new Float32Array(n * k).fill(NaN),
    mix = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) mix[c] += P[i * 4 + c] / n;
  const cs = Array.from({ length: 4 }, (_, c) => {
    const a = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) a[i + 1] = a[i] + P[i * 4 + c];
    return a;
  });
  for (let i = 0; i < n; i++) {
    let o = i * k;
    for (const d of off) {
      const j = i + d;
      for (let c = 0; c < 4; c++) F[o++] = j >= 0 && j < n ? P[j * 4 + c] : NaN;
    }
    for (const w of AC_WINDOWS) {
      const lo = Math.max(0, i - w),
        hi = Math.min(n, i + w + 1);
      const xl = Math.max(lo, i - ex + 1),
        xh = Math.min(hi, i + ex);
      for (let c = 0; c < 4; c++) F[o++] = ex ? (cs[c][hi] - cs[c][lo] - (cs[c][xh] - cs[c][xl])) / Math.max(1, hi - lo - (xh - xl)) : (cs[c][hi] - cs[c][lo]) / (hi - lo);
    }
    for (let c = 0; c < 4; c++) F[o++] = mix[c];
  }
  return { F, k };
}
function withAC(t, P, excludeCentre = false, minOff = 0) {
  const Xt = xOf(t);
  const { F, k } = autoContext(P, t.n, excludeCentre, minOff),
    K = t.k + k,
    X = new Float32Array(t.n * K);
  for (let i = 0; i < t.n; i++) {
    X.set(Xt.subarray(i * t.k, i * t.k + t.k), i * K);
    X.set(F.subarray(i * k, i * k + k), i * K + t.k);
  }
  return { ...t, X, k: K };
}

function benchFit(model, train, beat) {
  const hmm = () => {
    const cnt = new Float64Array(4);
    for (const t of train) for (const v of t.y) if (v >= 0) cnt[v]++;
    const tot = cnt.reduce((s, v) => s + v, 0);
    return { logT: Core.transitions(train.map((t) => t.y)), logPrior: Array.from(cnt, (c) => Math.log((c + 1) / (tot + 4))) };
  };
  const H = hmm(),
    tick = (it, n) => {
      if (it % 20 === 0 || it === n) beat(`${model} iter ${it}/${n}`);
    };
  const gb = (nights, o) => {
    const S = stackNights(nights, o.stride);
    return Core.fitGBDT(S.X, S.y, S.rows, S.k, { binSample: 4, minLeaf: 200, ...o }, tick);
  };
  const soft = (nights, basis) => {
    let rows = 0;
    const parts = nights.map((t) => {
      const b = basis(t);
      rows += Math.ceil(t.n / 4);
      return { b, t };
    });
    const m = parts[0].b.m,
      Z = new Float64Array(rows * m),
      y = new Int8Array(rows);
    let r = 0;
    for (const { b, t } of parts)
      for (let i = 0; i < t.n; i += 4) {
        Z.set(b.Z.subarray(i * m, i * m + m), r * m);
        y[r++] = t.y[i];
      }
    return Core.fitSoftmax(Z, y, rows, m, { iters: 300 });
  };
  const allCols = (t) => {
    const Z = Float64Array.from(xOf(t), (v) => (Number.isFinite(v) ? v : 0));
    return { Z, m: t.k };
  };
  const fBasis = (t) => Core.formulaBasis(t.names, xOf(t), t.n, t.k);
  if (model === 'gbdt') {
    const G = gb(train, { stride: 4, iters: 200, lr: 0.1, maxLeaves: 31 });
    return { ...H, P: (t) => Core.predictProba(G, xOf(t), t.n, t.k) };
  }
  if (model === 'gbdt-big') {
    const G = gb(train, { stride: 4, iters: 400, lr: 0.05, maxLeaves: 63 });
    return { ...H, P: (t) => Core.predictProba(G, xOf(t), t.n, t.k) };
  }
  if (model === 'logistic') {
    const F = soft(train, allCols);
    return {
      ...H,
      P: (t) => {
        const b = allCols(t);
        return Core.softmaxProba(F, b.Z, t.n, b.m);
      }
    };
  }
  if (model === 'formula') {
    const F = soft(train, fBasis);
    return {
      ...H,
      P: (t) => {
        const b = fBasis(t);
        return Core.softmaxProba(F, b.Z, t.n, b.m);
      }
    };
  }
  const oneHot = (t) => {
    const P = new Float32Array(t.n * 4);
    for (let i = 0; i < t.n; i++)
      if (t.y[i] >= 0) P[i * 4 + t.y[i]] = 1;
      else P.fill(0.25, i * 4, i * 4 + 4);
    return P;
  };
  if (model === 'hsmm' || model === 'autocontext-hsmm' || model === 'hsmm-notime') {
    const inner = benchFit(model === 'autocontext-hsmm' ? 'autocontext' : 'gbdt', train, beat),
      S = Core.hsmmFit(train.map((t) => t.y)),
      tw = model === 'hsmm-notime' ? 0 : 1;
    return { ...inner, decode: (P, n) => Core.hsmmViterbi(P, n, 4, S, inner.logPrior, tw) };
  }
  if (model === 'oracle-ctx' || model === 'oracle-far') {
    const mo = model === 'oracle-far' ? 5 : 0;
    beat(model + ' stage-2 on TRUE neighbour stages (diagnostic)');
    const G2 = gb(
      train.map((t) => withAC(t, oneHot(t), true, mo)),
      { stride: 4, iters: 200, lr: 0.1, maxLeaves: 31 }
    );
    return {
      ...H,
      P: (t) => {
        const t2 = withAC(t, oneHot(t), true, mo);
        return Core.predictProba(G2, xOf(t2), t2.n, t2.k);
      }
    };
  }
  if (model === 'autocontext3') {
    // v15c: rounds of out-of-fold stacking; round r trains on [X, ctx(round r-1 OOF predictions)]
    const inner = 3,
      rounds = 3,
      gbo = { stride: 6, iters: 120, lr: 0.12, maxLeaves: 31 };
    let oof = null,
      full = null,
      prevFull = [];
    const withR = (t, i, P) => (P ? withAC(t, P) : t);
    for (let r = 1; r <= rounds; r++) {
      const next = new Array(train.length);
      for (let f = 0; f < inner; f++) {
        beat(`autocontext3 round ${r} inner fold ${f + 1}/${inner}`);
        const G = gb(
          train.filter((_, i) => i % inner !== f).map((t, j) => withR(t, j, oof && oof[train.indexOf(t)])),
          r === rounds ? { stride: 4, iters: 200, lr: 0.1, maxLeaves: 31 } : gbo
        );
        train.forEach((t, i) => {
          if (i % inner === f) {
            const tt = withR(t, i, oof && oof[i]);
            next[i] = Core.predictProba(G, xOf(tt), tt.n, tt.k);
          }
        });
      }
      beat(`autocontext3 round ${r} full`);
      full = gb(
        train.map((t, i) => withR(t, i, oof && oof[i])),
        r === rounds ? { stride: 4, iters: 200, lr: 0.1, maxLeaves: 31 } : gbo
      );
      prevFull.push(full);
      oof = next;
    }
    return {
      ...H,
      P: (t) => {
        let P = null;
        for (const G of prevFull) {
          const tt = P ? withAC(t, P) : t;
          P = Core.predictProba(G, xOf(tt), tt.n, tt.k);
        }
        return P;
      }
    };
  }
  if (model === 'autocontext') {
    // stage 1 out-of-fold on the TRAINING nights (3 inner folds), so stage 2 learns from honest predictions
    const oof = new Array(train.length),
      inner = 3;
    for (let f = 0; f < inner; f++) {
      beat(`autocontext stage-1 inner fold ${f + 1}/${inner}`);
      const G = gb(
        train.filter((_, i) => i % inner !== f),
        { stride: 6, iters: 120, lr: 0.12, maxLeaves: 31 }
      );
      train.forEach((t, i) => {
        if (i % inner === f) oof[i] = Core.predictProba(G, xOf(t), t.n, t.k);
      });
    }
    beat('autocontext stage-1 full');
    const G1 = gb(train, { stride: 6, iters: 120, lr: 0.12, maxLeaves: 31 });
    beat('autocontext stage-2');
    const G2 = gb(
      train.map((t, i) => withAC(t, oof[i])),
      { stride: 4, iters: 200, lr: 0.1, maxLeaves: 31 }
    );
    return {
      ...H,
      P: (t) => {
        const t2 = withAC(t, Core.predictProba(G1, xOf(t), t.n, t.k));
        return Core.predictProba(G2, xOf(t2), t2.n, t2.k);
      }
    };
  }
  throw new Error(`unknown model "${model}" (have: ${BENCH_MODELS.join(', ')})`);
}

function dropCols(t, re) {
  const keep = [];
  t.names.forEach((nm, j) => {
    if (!re.test(nm)) keep.push(j);
  });
  if (keep.length === t.k) return t;
  return { ...t, k: keep.length, names: keep.map((j) => t.names[j]), keep: t.keep ? keep.map((j) => t.keep[j]) : keep, X: t.X ? xOf({ ...t, keep, X: null }) : undefined };
}

async function cmdBench(a) {
  const tag = a.features || 'spo2h',
    dir = join(a.cache, tag === 'spo2h' ? 'bench' : 'bench-' + tag),
    drop = a.drop ? new RegExp(a.drop) : null; // v17: ablation by column name; the job name carries it
  mkdirSync(dir, { recursive: true });
  if (a.summarize) return benchSummary(dir, tag);
  const job = `${a.model}${a.drop ? '[drop ' + a.drop + ']' : ''}-fold-${a.fold}`;
  if (existsSync(join(dir, job + '.json')) && !a.force) {
    console.log(`bench ${job}: already done (resumable skip)`);
    return;
  }
  const all = [];
  for (const c of a.cohorts.split(',')) {
    const got = loadCached(a.cache, c, tag);
    if (!got.length) throw new Error(`bench: cohort "${c}" has 0 cached nights`);
    for (const t of got) all.push({ ...(drop ? dropCols(t, drop) : t), cohort: c });
  }
  const foldKey = (t) => (a['group-subjects'] && /^shhs[12]-/.test(t.id) ? 'shhs' + t.id.replace(/^shhs[12]-/, '') : t.cohort + t.id);
  const foldOf = (t) => {
    let h = 0;
    for (const ch of foldKey(t)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % 5;
  }; // == megalab; --group-subjects (v18) keys SHHS1/SHHS2 nights of one subject together
  const train = all.filter((t) => foldOf(t) !== +a.fold),
    test = all.filter((t) => foldOf(t) === +a.fold);
  const beat = (msg) => {
    const line = `[${new Date().toISOString().slice(11, 19)}] bench ${job}: ${msg}`;
    process.stderr.write(line + '\n');
    try {
      appendFileSync(join(a.cache, 'heartbeat.txt'), line + '\n');
    } catch {
      /* never kills the job */
    }
  };
  beat(`train ${train.length} / test ${test.length} nights`);
  const M = benchFit(a.model, train, beat);
  const out = test.map((t) => {
    const P = M.P(t),
      p = M.decode ? M.decode(P, t.n) : Core.viterbi(P, t.n, 4, M.logT, M.logPrior),
      h = t.n >> 1;
    return {
      cohort: t.cohort,
      conf: Core.confusion(t.y, p).map((r) => Array.from(r)),
      shift: Core.confusion(
        Int8Array.from({ length: t.n }, (_, e) => t.y[(e + h) % t.n]),
        p
      ).map((r) => Array.from(r))
    };
  });
  writeFileSync(join(dir, job + '.json'), JSON.stringify({ job, model: a.model + (a.drop ? '[drop ' + a.drop + ']' : ''), out }));
  beat('done');
}

/* Pass line PRE-STATED (brief §8, owner 2026-09-28: "at least half as good as human"): the human scorer-vs-scorer κ
   measured on ISRUC is 0.829, so half is 0.415. Judged on ALL pooled nights and reported per cohort. */
export const BENCH_CRITERION = { name: 'pooled grouped-CV Cohen kappa >= half the human inter-scorer kappa (0.829 on ISRUC)', threshold: 0.415, unit: 'kappa', direction: 'gte' };

function benchSummary(dir, tag = 'spo2h') {
  const jobs = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const toM = (x) => x.map((r) => Float64Array.from(r)),
    cohorts = [...new Set(jobs.flatMap((j) => j.out.map((n) => n.cohort)))];
  const kOf = (ns) => (ns.length ? Core.kappa(Core.sumMatrices(ns.map((n) => toM(n.conf)))) : NaN);
  const med = (ns) => {
    const v = ns
      .map((n) => Core.kappa(toM(n.conf)))
      .filter(Number.isFinite)
      .sort((p, q) => p - q);
    return v.length ? v[v.length >> 1] : NaN;
  };
  console.log('model'.padEnd(17) + 'folds ' + cohorts.map((c) => c.slice(0, 9).padStart(10)).join('') + '       all  med/night   (pooled kappa per cohort; P1 = half-night shift)');
  let best = null;
  for (const m of [...BENCH_MODELS, ...new Set(jobs.map((j) => j.model).filter((v) => v.includes('[drop')))]) {
    const js = jobs.filter((j) => j.model === m);
    if (!js.length) continue;
    const nights = js.flatMap((j) => j.out),
      kall = kOf(nights),
      ks = Core.kappa(Core.sumMatrices(nights.map((n) => toM(n.shift)))),
      fires = ks < 0.5 * kall;
    console.log(
      (BENCH_DIAGNOSTIC.has(m) ? m + '*' : m).padEnd(17) +
        String(js.length).padEnd(6) +
        cohorts
          .map((c) =>
            kOf(nights.filter((n) => n.cohort === c))
              .toFixed(3)
              .padStart(10)
          )
          .join('') +
        kall.toFixed(3).padStart(10) +
        med(nights).toFixed(3).padStart(11) +
        `   P1 ${fires ? 'fires' : 'DOES NOT FIRE'} (${ks.toFixed(3)})`
    );
    if (js.length === 5 && fires && !BENCH_DIAGNOSTIC.has(m) && (!best || kall > best.k)) best = { m, k: kall, n: nights.length, ci: Core.bootstrapKappa(nights.map((n) => toM(n.conf))) };
  }
  if (!best) {
    console.log('no model has all 5 folds with a firing plant yet: no verdict');
    return;
  }
  const V = require_(join(ROOT, 'verdict.js'));
  let commit = null;
  try {
    commit = require_('node:child_process').execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD']).toString().trim();
  } catch {
    /* stated below */
  }
  const v = V.make({
    gate: 'stage-lab-bench-' + tag,
    status: best.k >= BENCH_CRITERION.threshold ? 'PASS' : 'FAIL',
    reason: best.k >= BENCH_CRITERION.threshold ? null : `best model ${best.m} kappa ${best.k.toFixed(3)} < ${BENCH_CRITERION.threshold}`,
    criterion: BENCH_CRITERION,
    population: { checked: best.n, eligible: best.n, excluded: 0 },
    result: {
      value: +best.k.toFixed(4),
      ci95: best.ci.map((x) => +x.toFixed(4)),
      n: best.n,
      label: `best of ${BENCH_MODELS.length - BENCH_DIAGNOSTIC.size} models (diagnostics excluded): ${best.m}, pooled 5-fold CV`
    },
    evidence: ['tools/stage-lab.mjs', 'briefs/STAGE-LAB-2026-09-27-BRIEF.md'],
    producedBy: { tool: 'tools/stage-lab.mjs', commit, commitReason: commit ? undefined : 'git unavailable' }
  });
  const errs = V.validate(v);
  if (errs && errs.length) console.error('verdict does not validate: ' + errs.join('; '));
  console.log('VERDICT (tepna.verdict/1): ' + JSON.stringify(v));
}
/* ── verdict (tepna.verdict/1). Criterion PRE-STATED in the brief: kappa >= 0.390 (the proprietary oximeter-only comparator,
   published offline decode, Challenge-2018 holdout — a CROSS-STUDY comparison), P1 plant must fire. ── */
export const CRITERION = { name: 'grouped-CV Cohen kappa vs the proprietary comparator published offline 0.390', threshold: 0.39, unit: 'kappa', direction: 'gte' };

function emitVerdict(a, results, nCv, nExtra, sample = false) {
  const V = require_(join(ROOT, 'verdict.js'));
  const best = results.reduce((b, r) => (r.kappa > b.kappa ? r : b), results[0]);
  const status = !best.plantFires ? 'UNKNOWN' : best.kappa >= CRITERION.threshold ? 'PASS' : 'FAIL';
  const reason = !best.plantFires
    ? 'the half-night-shift plant did not fire: the instrument is not shown to react'
    : status === 'PASS'
      ? null
      : `kappa ${best.kappa.toFixed(3)} below ${CRITERION.threshold}`;
  let commit = null;
  try {
    if (!sample) commit = require_('node:child_process').execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD']).toString().trim();
  } catch {
    /* reported below */
  }
  const v = V.make({
    gate: 'stage-lab-' + (a.blocks || 'spo2').replace(/,/g, '+'),
    status,
    reason,
    criterion: CRITERION,
    population: { checked: nCv, eligible: nCv, excluded: 0 }, // every cached night was scored; nights skipped at feature time are not in this population
    result: {
      value: +best.kappa.toFixed(4),
      ci95: best.ci.map((x) => +x.toFixed(4)),
      n: nCv,
      label: `${a.cv} grouped ${a.folds || 5}-fold CV`,
      extraTraining: `${a.extra || 'none'}:${best.extra}/${nExtra}`,
      curve: results.map((r) => ({ extra: r.extra, kappa: +r.kappa.toFixed(4) }))
    },
    evidence: ['tools/stage-lab.mjs', 'briefs/STAGE-LAB-2026-09-27-BRIEF.md'],
    producedBy: { tool: 'tools/stage-lab.mjs', commit, commitReason: commit ? undefined : sample ? '--verdict-sample: synthetic result, no code identity claimed' : 'git unavailable' }
  });
  const errs = V.validate(v);
  if (errs && errs.length) console.error('verdict does not validate: ' + errs.join('; '));
  console.log('VERDICT (tepna.verdict/1): ' + JSON.stringify(v));
  return v;
}

/* ── selftest: the PIPELINE on synthetic nights (never evidence about staging accuracy — REM-STAGING
   §1 bans that); proves adapters' arithmetic, cache round trip and the verdict path. ───────────── */
async function selftest() {
  /* COUNTED BY THE HELPER, never typed: `selftest-all.mjs` reads the printed number as this tool's
     assertion total, so a figure a hand wrote would survive deleting an assertion. A green tool whose
     summary that script cannot parse is a named FAIL there unless it joins UNPARSEABLE_RATCHET, which
     is debt that may only shrink — so this prints a real count instead of joining it. */
  let n = 0;
  const ok = (c, m) => {
    n++;
    if (!c) {
      console.error('SELFTEST FAIL: ' + m);
      process.exitCode = 1;
    } else console.log('ok  ' + m);
  };
  // encode two NOTE annotations (code 22) with AUX text, per the WFDB MIT annotation format
  const word = (A, I) => [I & 0xff, ((A << 2) | (I >> 8)) & 0xff];
  const aux = (s) => {
    const b = [...word(63, s.length), ...Buffer.from(s, 'latin1')];
    if (s.length & 1) b.push(0);
    return b;
  };
  const ann = Buffer.from([...word(22, 0), ...aux('W'), ...word(22, 1000), ...aux('N1'), 0, 0]);
  const A = parseWfdbAnnotations(ann);
  ok(A.length === 2 && A[0].aux === 'W' && A[1].aux === 'N1' && A[1].sample === 1000, 'WFDB annotations: two stage notes, their aux text and sample times');
  const y = stagesFromAnnotations(
    [
      { sample: 0, aux: 'W' },
      { sample: 6000, aux: 'N2' },
      { sample: 12000, aux: 'R' }
    ],
    200,
    18000
  );
  ok(y.join(',') === '0,1,3', 'stages forward-fill onto the 30 s grid (W, N2→Light, R→REM)');
  ok(
    Number.isNaN(
      secondMedians(
        Float64Array.from({ length: 200 }, () => 30),
        200
      )[0]
    ),
    'an SpO2 second outside 50–100 % is null, not a number (§∅)'
  );
  ok(CRITERION.threshold === 0.39, 'criterion is the pre-stated 0.390');
  {
    // hsmm: a night of known bouts, decoded from noisy one-hot posteriors, must come back exactly
    const y = Int8Array.from([...Array(40).fill(0), ...Array(60).fill(1), ...Array(50).fill(2), ...Array(30).fill(1), ...Array(25).fill(3), ...Array(15).fill(0)]);
    const S = Core.hsmmFit([y, y, y]);
    const P = new Float32Array(y.length * 4);
    for (let i = 0; i < y.length; i++) for (let c = 0; c < 4; c++) P[i * 4 + c] = c === y[i] ? 0.7 : 0.1;
    const p = Core.hsmmViterbi(
      P,
      y.length,
      4,
      S,
      [0, 0, 0, 0].map(() => Math.log(0.25))
    );
    let wrong = 0;
    for (let i = 0; i < y.length; i++) if (p[i] !== y[i]) wrong++;
    ok(wrong === 0, 'hsmm decodes planted bouts (' + wrong + ' wrong)');
    ok(Math.abs(S.logDur[1].reduce((a, v) => a + (Number.isFinite(v) ? Math.exp(v) : 0), 0) + Math.exp(S.logTail[1]) - 1) < 1e-9, 'hsmm duration mass sums to one');
  }
  if (process.exitCode) console.error('\u2717 ' + n + ' assertion(s) ran, at least one failed');
  else console.log('\u2713 all ' + n + ' selftests passed');
}

function args(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      a[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else a._.push(argv[i]);
  }
  return a;
}

const IS_CLI = isCliEntry(import.meta.url);
if (IS_CLI) {
  const a = args(process.argv.slice(2));
  /* --verdict-sample: the SHAPE of the verdict on a synthetic result, for tools/verdict-adoption.mjs (never a real rate) */
  const run = a['verdict-sample']
    ? async () => emitVerdict({ blocks: 'spo2', cv: 'sample', folds: 5 }, [{ kappa: 0.41, ci: [0.4, 0.42], plantFires: true, extra: 0 }], 5, 0, true)
    : a.selftest
      ? selftest
      : a._[0] === 'features'
        ? () => cmdFeatures(a)
        : a._[0] === 'eval'
          ? () => cmdEval(a)
          : a._[0] === 'formula'
            ? () => cmdFormula(a)
            : a._[0] === 'megalab'
              ? () => cmdMegalab(a)
              : a._[0] === 'bench'
                ? () => cmdBench(a)
                : null;
  if (!run) {
    console.error('usage: stage-lab.mjs --selftest | features … | eval …  (see header)');
    process.exit(2);
  }
  run().catch((e) => {
    console.error(e.stack || e);
    process.exit(1);
  });
}
