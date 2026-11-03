/* Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ════════════════════════════════════════════════════════════════════════
 * hypno-export.js — ONE hypnogram shape for every Dex that stages a night, and the two files it
 * leaves the app as.
 *
 * THE SHAPE. `{ startMs, epochSec, stages, confidence, source }`: `startMs` is the recording anchor
 * (floating wall-clock ms, read back through getUTC* — the Clock Contract, as dex-export.js), `stages`
 * is one of 'Wake' | 'Light' | 'Deep' | 'REM' | null per epoch (null = not scored: a refused window, a
 * gap), `confidence` is one number in [0, 1] per epoch or null for the whole night.
 *
 * CONFIDENCE IS WHAT THE STAGER KNOWS, NEVER A DECORATION. A model with posteriors (OxyDex's net)
 * reports, per epoch, the posterior probability of the stage it SHOWS (the decoded path's stage, not
 * the arg-max — after decoding they can differ, and the number must describe the bar it sits under).
 * A stager without posteriors (ECGDex's rule set) reports `confidence: null`, and the card says so; a
 * constant would be a fabricated certainty.
 *
 * THE TWO FILES.
 *   · `tepna.hypnogram/1` JSON — lossless: the stages at their own epoch, the confidence, the source.
 *   · The CPAP viewer's sleep-stage CSV import (the legacy sleep-headband layout): one header row and
 *     one night row. The importer steps its detailed graph in FIXED 30 s slots and carries no epoch
 *     field, so any other grid is resampled here by MIDPOINT lookup (a 5 min epoch becomes ten slots;
 *     transitions stay within half a slot of their true time and never drift with night length).
 *     Codes: 1 Wake · 2 REM · 3 Light · 4 Deep · 0 no data; the 5 min column is the majority non-empty
 *     code of each ten slots. Confidence does not survive this file — it is a presentation export.
 *     The headband's own quality score and the morning-feel rating were never measured here, so
 *     their columns are EMPTY, never 0 (absence is null — a 0 would read as a score of zero).
 *
 * Pure except `downloadText` and the window global at the bottom. Exports through one list (the owned
 * bundler leaves `export function` in place and strips `export const`'s binding).
 */

const SCHEMA = 'tepna.hypnogram/1';
const STAGE_NAMES = ['Wake', 'Light', 'Deep', 'REM'];
const VIEWER_SLOT_S = 30;
const VIEWER_GROUP = 10; // ten 30 s slots = the 5 min column
const VIEWER_CODE = { Wake: 1, REM: 2, Light: 3, Deep: 4 };
const VIEWER_HEADER = 'Start of Night,End of Night,Rise Time,ZQ,Time to Z,Time in Wake,Time in REM,Time in Light,Time in Deep,Awakenings,Morning Feel,Detailed Sleep Graph,Sleep Graph';
const LOW_CONFIDENCE = 0.5;

const _isStage = (s) => s === 'Wake' || s === 'Light' || s === 'Deep' || s === 'REM';
const _finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * A contiguous indexed path (OxyDex: Viterbi indices into `names`) → the hypnogram shape.
 * `proba` (optional) is the T×K row-major posterior; confidence is the posterior of the decoded stage.
 */
function fromIndexed(idx, opts) {
  const o = opts || {};
  const names = o.names || STAGE_NAMES;
  const T = idx ? idx.length : 0;
  const stages = new Array(T);
  for (let t = 0; t < T; t++) {
    const s = names[idx[t]];
    stages[t] = _isStage(s) ? s : null;
  }
  let confidence = null;
  if (o.proba && T) {
    const K = o.K || names.length;
    if (o.proba.length < T * K) throw new Error('hypno-export: posterior shorter than T × K');
    confidence = new Array(T);
    for (let t = 0; t < T; t++) {
      const p = o.proba[t * K + idx[t]];
      confidence[t] = _finite(p) ? Math.round(Math.min(1, Math.max(0, p)) * 1000) / 1000 : null;
    }
  }
  return { startMs: _finite(o.startMs) ? o.startMs : null, epochSec: o.epochSec || 30, stages, confidence, source: o.source || null };
}

/**
 * A sparse epoch list (ECGDex: `[{ tMin, stage }]`, refused windows absent) → the hypnogram shape on a
 * contiguous grid of `epochSec`; an absent window is a null stage, never the neighbour's stage.
 */
function fromEpochList(list, opts) {
  const o = opts || {};
  const epochSec = o.epochSec || 300;
  const rows = (list || []).filter((e) => e && _finite(e.tMin));
  if (!rows.length) return { startMs: _finite(o.startMs) ? o.startMs : null, epochSec, stages: [], confidence: null, source: o.source || null };
  const first = rows[0].tMin;
  const T = Math.round((rows[rows.length - 1].tMin - first) / (epochSec / 60)) + 1;
  const stages = new Array(T).fill(null);
  for (const e of rows) {
    const t = Math.round((e.tMin - first) / (epochSec / 60));
    if (t >= 0 && t < T) stages[t] = _isStage(e.stage) ? e.stage : null;
  }
  const startMs = _finite(o.startMs) ? o.startMs + first * 60000 : null;
  return { startMs, epochSec, stages, confidence: null, source: o.source || null };
}

/** Minutes per stage, sleep onset, awakenings and the confidence read — from the epochs themselves. */
function summarize(h) {
  const T = h.stages.length;
  const min = { Wake: 0, Light: 0, Deep: 0, REM: 0 };
  let scored = 0;
  let onset = -1;
  let lastSleep = -1;
  for (let t = 0; t < T; t++) {
    const s = h.stages[t];
    if (!s) continue;
    scored++;
    min[s] += h.epochSec / 60;
    if (s !== 'Wake') {
      if (onset < 0) onset = t;
      lastSleep = t;
    }
  }
  // An awakening is a Wake bout that starts after sleep onset and is followed by more sleep: the
  // wake after the last sleep epoch is getting up, not waking in the night.
  let awakenings = 0;
  for (let t = Math.max(onset, 0) + 1; onset >= 0 && t <= lastSleep; t++) {
    if (h.stages[t] === 'Wake' && h.stages[t - 1] !== 'Wake') awakenings++;
  }
  let meanConfidence = null;
  let lowConfidencePct = null;
  if (h.confidence) {
    const c = h.confidence.filter((v, t) => _finite(v) && h.stages[t]);
    if (c.length) {
      meanConfidence = Math.round((c.reduce((a, b) => a + b, 0) / c.length) * 1000) / 1000;
      lowConfidencePct = Math.round((c.filter((v) => v < LOW_CONFIDENCE).length / c.length) * 1000) / 10;
    }
  }
  return {
    epochs: T,
    scored,
    minutes: min,
    sleepMin: min.Light + min.Deep + min.REM,
    sleepOnsetMin: onset >= 0 ? (onset * h.epochSec) / 60 : null,
    awakenings,
    meanConfidence,
    lowConfidencePct
  };
}

/** The 30 s viewer raster: slot k samples the epoch under its midpoint; codes 0–4. */
function viewerSlots(h) {
  const spanSec = h.stages.length * h.epochSec;
  const n = Math.floor(spanSec / VIEWER_SLOT_S);
  const out = new Array(n);
  for (let k = 0; k < n; k++) {
    const t = Math.floor(((k + 0.5) * VIEWER_SLOT_S) / h.epochSec);
    const s = h.stages[t];
    out[k] = s ? VIEWER_CODE[s] : 0;
  }
  return out;
}

const _pad = (v) => String(v).padStart(2, '0');
/** Floating wall-clock ms → 'YYYY-MM-DD HH:MM:SS' through getUTC* (never the viewer's timezone). */
function wallClock(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${_pad(d.getUTCMonth() + 1)}-${_pad(d.getUTCDate())} ${_pad(d.getUTCHours())}:${_pad(d.getUTCMinutes())}:${_pad(d.getUTCSeconds())}`;
}

/** The viewer CSV (header + one night). Refuses a night with no anchor or no scored slot. */
function toViewerCsv(h) {
  if (!_finite(h.startMs)) throw new Error('hypno-export: the recording has no start time, and the viewer places a night by it');
  const slots = viewerSlots(h);
  if (!slots.some((c) => c > 0)) throw new Error('hypno-export: no scored epoch to export');
  const s = summarize(h);
  const end = wallClock(h.startMs + slots.length * VIEWER_SLOT_S * 1000);
  const groups = [];
  for (let g = 0; g < slots.length; g += VIEWER_GROUP) {
    const votes = [0, 0, 0, 0, 0];
    for (let k = g; k < Math.min(g + VIEWER_GROUP, slots.length); k++) votes[slots[k]]++;
    let best = 0;
    for (let c = 1; c <= 4; c++) if (votes[c] > votes[best]) best = c;
    groups.push(best);
  }
  const m = (x) => Math.round(x);
  const row = [
    wallClock(h.startMs),
    end,
    end,
    '',
    s.sleepOnsetMin != null ? m(s.sleepOnsetMin) : '',
    m(s.minutes.Wake),
    m(s.minutes.REM),
    m(s.minutes.Light),
    m(s.minutes.Deep),
    s.awakenings,
    '',
    `"${slots.join(' ')}"`,
    `"${groups.join(' ')}"`
  ];
  return VIEWER_HEADER + '\n' + row.join(',') + '\n';
}

/** The lossless file: stages at their own epoch, confidence, source and the summary. */
function toJson(h) {
  return {
    schema: SCHEMA,
    source: h.source || null,
    start: _finite(h.startMs) ? wallClock(h.startMs).replace(' ', 'T') : null,
    startMs: _finite(h.startMs) ? h.startMs : null,
    epochSec: h.epochSec,
    stageNames: STAGE_NAMES.slice(),
    stages: h.stages.slice(),
    confidence: h.confidence ? h.confidence.slice() : null,
    summary: summarize(h)
  };
}

/** A confidence strip as inline SVG under the hypnogram: darker = surer; a gap = no number. */
function confidenceSvg(conf, width, height) {
  const T = conf ? conf.length : 0;
  const W = width || 640;
  const H = height || 10;
  let bars = '';
  for (let t = 0; t < T; t++) {
    const c = conf[t];
    if (!_finite(c)) continue;
    const x = (t / T) * W;
    const w = Math.max(W / T, 0.5);
    bars += `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${H}" fill="#7f8c8d" fill-opacity="${(0.1 + 0.9 * c).toFixed(2)}"/>`;
  }
  return `<svg class="hypno-conf" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="per-epoch confidence, ${T} epochs">${bars}</svg>`;
}

/** Browser-only: hand `text` to the user as a file. */
function downloadText(doc, name, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const a = doc.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  doc.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}

if (typeof window !== 'undefined') {
  /** @type {any} */ (window).HypnoExport = { fromIndexed, fromEpochList, summarize, viewerSlots, toViewerCsv, toJson, confidenceSvg, downloadText, LOW_CONFIDENCE };
}

export { SCHEMA, STAGE_NAMES, VIEWER_HEADER, VIEWER_SLOT_S, LOW_CONFIDENCE, fromIndexed, fromEpochList, summarize, viewerSlots, wallClock, toViewerCsv, toJson, confidenceSvg, downloadText };
