#!/usr/bin/env node
/*
 * tools/ecg-template-xcorr-residual.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE ECG DETECTOR'S FIDUCIAL RESIDUAL, AGAINST TEMPLATE CROSS-CORRELATION — a producer for the
 * figure `papers/ppg-ecg-hrv-validation.html` §2.1 carries from Draft v2 with none.
 *
 * Residue `2026-10-28-three-paper-panels-are-carried-from-draft-v2-with-no-producer` names three
 * published panels whose producer was never committed. This is the first of them: "Pan–Tompkins with
 * sub-sample parabolic refinement, validated against template cross-correlation at 0.244 ms residual
 * jitter (median night) versus the 2.213 ms the bare 7.69 ms sample grid would impose". Both numbers
 * are 2026-07 measurements on pre-removal bytes, and `tools/ppi-jitter-vs-ecg.mjs` re-cuts neither.
 *
 * ── WHAT THE ESTIMATOR IS, AND WHY IT IS INDEPENDENT OF THE THING IT JUDGES ─────────────────────
 * The shipped refinement fits a parabola to THREE samples of the band-passed R peak
 * (`tools/ppi-match.mjs refinePeaks`). This tool times the same beat a second way: it builds an
 * average QRS template from the segment's own beats on an interpolated grid, then cross-correlates
 * each beat's window against that template and interpolates the correlation peak. The template reads
 * the whole QRS morphology rather than three samples at its apex, so the two estimates share the
 * signal and not the rule. The spread of their difference is the fiducial residual the paper quotes.
 *
 * THE CONTROL IS THE SAME MEASUREMENT WITHOUT THE REFINEMENT. Windows cut at the detector's INTEGER
 * sample index carry that beat's own quantisation error, so their residual must land near the bare
 * grid's Δ/√12 — the paper's second number. A run in which refinement does not beat the grid is a
 * failing run, not a surprising one, and the band below says so before the first night is read.
 *
 * ── PRE-STATED, before the first corpus read (§🧾). None is derived from the data it judges ──────
 *   WIN_MS 80          half-window around the beat; ±80 ms covers the QRS at this lead
 *   UPSAMPLE 8         interpolation factor — 7.69 ms / 8 = 0.96 ms of grid, below the residual
 *   SEARCH_MS 20       half-range of the lag search; a beat displaced further is not this beat
 *   SEG_BEATS 300      one template per 300 beats, so overnight morphology drift is not read as
 *                      jitter (the firmware oracle's own anchor window, for the same reason)
 *   SEG_MIN_BEATS 100  a template under 100 beats is an average of noise; the segment is excluded
 *   CARRIED_BAND 0.5   the carried figure REPRODUCES when |measured − carried| / carried ≤ 0.5.
 *                      Wide on purpose: Draft v2 measured 20 nights of pre-removal bytes and this
 *                      reads today's corpus under today's code, so population alone can move it.
 *
 * ── WHAT IT REPORTS ────────────────────────────────────────────────────────────────────────────
 *   residualMs      per night, the SD of (template-xcorr time − refined detector time) after the
 *                   segment's own median lag is removed; pooled as the median across nights.
 *   gridMs          the same statistic over UNREFINED integer peak indices — the control.
 *   gridBoundMs     Δ/√12 at the night's own measured fs — what a uniform quantiser would give.
 *   every exclusion counted by reason (§∅): a beat, a segment or a night that was not measured is
 *   named, never folded into a zero.
 *
 * USAGE
 *   node tools/ecg-template-xcorr-residual.mjs [--dir <captures>] [--max-nights N] [--json]
 *   node tools/ecg-template-xcorr-residual.mjs --selftest
 *   node tools/ecg-template-xcorr-residual.mjs --verdict-sample
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, relative } from 'node:path';
import { capByNights, gitCommitOf, headNightKeyWith, populationVerdict, ruleLine, snapshotEntries } from './corpus-scope-core.mjs';
import { readRunsSidecar, validityLine } from './trio-fold-validity.mjs';
import { median, quantile, refinePeaks, sd } from './ppi-match.mjs';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
const TOOL = 'tools/ecg-template-xcorr-residual.mjs';
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

/* ═════════════════════════════ PRE-STATED CONSTANTS ═════════════════════════════ */
export const WIN_MS = 80;
export const UPSAMPLE = 8;
export const SEARCH_MS = 20;
export const SEG_BEATS = 300;
export const SEG_MIN_BEATS = 100;
export const CARRIED_BAND = 0.5;
export const CARRIED_RESIDUAL_MS = 0.244;
export const CARRIED_GRID_MS = 2.213;
/* The population the carried figure was measured over, read from the paper's own §2.1 and §5: 30
   paired nights, 2026-06-10 → 2026-07-13. A residual measured on a different window would be a
   different claim, so the window is PRE-STATED here beside the figures it is held against and only
   `--all-dates` widens it. */
export const PAPER_FROM = '2026-06-10';
export const PAPER_TO = '2026-07-13';

/* ═════════════════════════════ THE PURE HALF ═════════════════════════════ */

/* Δ/√12 — the SD a uniform quantiser of one sample imposes on a time estimate. Not a measurement of
   this corpus: it is what the grid alone would give, so it is the bar the refinement has to clear. */
export function gridBoundMs(fs) {
  if (!(fs > 0)) return null;
  return 1000 / fs / Math.sqrt(12);
}

/* One beat's window on the interpolated grid, centred at `at` (a FLOAT sample index, so the refined
   and the integer estimate differ only in what is passed here). Linear interpolation between
   samples; `null` when the window would run off either end — an edge beat is excluded, never
   zero-padded, because a pad is a value the signal never carried (§∅). */
export function windowAt(series, at, halfW, up) {
  const n = halfW * up;
  const lo = at - halfW;
  const hi = at + halfW;
  if (!(at >= 0) || !(lo >= 0) || !(hi <= series.length - 1)) return null;
  const out = new Float64Array(2 * n + 1);
  for (let k = -n; k <= n; k++) {
    const x = at + k / up;
    const i = Math.floor(x);
    const f = x - i;
    const a = series[i];
    const b = series[i + 1 <= series.length - 1 ? i + 1 : i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    out[k + n] = a + (b - a) * f;
  }
  return out;
}

/* Mean-removed, unit-L2 — so the correlation reads MORPHOLOGY and an amplitude swing over the night
   neither weights a beat nor moves its time. `null` for a flat window, which carries no fiducial. */
export function normalise(win) {
  if (!win || win.length === 0) return null;
  let m = 0;
  for (let i = 0; i < win.length; i++) m += win[i];
  m /= win.length;
  let ss = 0;
  const out = new Float64Array(win.length);
  for (let i = 0; i < win.length; i++) {
    out[i] = win[i] - m;
    ss += out[i] * out[i];
  }
  if (!(ss > 0)) return null;
  const inv = 1 / Math.sqrt(ss);
  for (let i = 0; i < out.length; i++) out[i] *= inv;
  return out;
}

/* The segment's template: the mean of its normalised windows, normalised again. */
export function templateOf(wins) {
  const good = wins.filter((w) => w && w.length === wins[0] && wins[0].length);
  const use = good.length ? good : wins.filter(Boolean);
  if (use.length < 1) return null;
  const n = use[0].length;
  const acc = new Float64Array(n);
  for (const w of use) {
    if (w.length !== n) continue;
    for (let i = 0; i < n; i++) acc[i] += w[i];
  }
  for (let i = 0; i < n; i++) acc[i] /= use.length;
  return normalise(acc);
}

/* THE LAG, IN UPSAMPLED SAMPLES, at which this beat best matches the template — a NORMALISED
   cross-correlation over the template's OWN support, so every lag is scored on the same number of
   samples. That fixed support is load-bearing: scoring each lag over whatever happens to overlap
   lets the truncation, not the alignment, shape the correlation, and a parabola on that curve reads
   a fraction of the real displacement (measured on a planted 2 ms shift: 0.37 of it).
   `null` when the best integer lag sits on the search edge — the peak is then unbracketed, and a
   parabola through an unbracketed maximum reports a number the data does not bound. */
export function nccLag(wide, tmpl, searchUp) {
  if (!wide || !tmpl || !(tmpl.length > 2)) return null;
  const m = tmpl.length;
  const centre = Math.round((wide.length - m) / 2);
  if (!(centre - searchUp >= 0) || !(centre + searchUp + m <= wide.length)) return null;
  const c = new Map();
  let best = null;
  let bestC = -Infinity;
  for (let lag = -searchUp; lag <= searchUp; lag++) {
    const s = wide.subarray(centre + lag, centre + lag + m);
    const n = normalise(s);
    if (!n) continue;
    let d = 0;
    for (let i = 0; i < m; i++) d += n[i] * tmpl[i];
    c.set(lag, d);
    if (d > bestC) {
      bestC = d;
      best = lag;
    }
  }
  if (best == null || best === -searchUp || best === searchUp) return null;
  const y0 = c.get(best - 1);
  const y1 = c.get(best);
  const y2 = c.get(best + 1);
  if (![y0, y1, y2].every(Number.isFinite)) return null;
  const den = y0 - 2 * y1 + y2;
  let d = den !== 0 ? (0.5 * (y0 - y2)) / den : 0;
  if (!(d > -1 && d < 1)) d = 0;
  return best + d;
}

/* The residual: the spread of the per-beat lags after the segment's OWN median lag is removed.
   The median lag is the template's constant offset against the detector's rule and is not jitter;
   what remains is beat-to-beat disagreement between the two estimators. */
export function residualOf(lagsUp, fs, up) {
  const fin = lagsUp.filter((x) => Number.isFinite(x));
  if (fin.length < 2) return null;
  const med = median(fin);
  const msPerUp = 1000 / fs / up;
  const d = fin.map((x) => (x - med) * msPerUp);
  /* `medMs` is the segment's own fiducial-to-template OFFSET, kept uncentred. It is not part of the
     per-beat residual; it exists so the pool can report how an aggregated statistic would read. */
  return { n: d.length, medMs: med * msPerUp, sdMs: sd(d), iqrMs: quantile(d, 0.75) - quantile(d, 0.25) };
}

/* Does the measured figure reproduce the one the paper carries? A pre-stated relative band, never
   the measurement's own spread — a band read off the data it judges decides nothing (§🧾). */
export function reproduces(measuredMs, carriedMs, band = CARRIED_BAND) {
  if (!(measuredMs > 0) || !(carriedMs > 0)) return null;
  const dev = Math.abs(measuredMs - carriedMs) / carriedMs;
  return { deviation: dev, within: dev <= band, band };
}

/* Segment boundaries over a beat train: whole segments of SEG_BEATS, the remainder joined to the
   last one when it is short, so no beat is silently dropped for being last. */
export function segmentsOf(nBeats, segBeats = SEG_BEATS, minBeats = SEG_MIN_BEATS) {
  const segs = [];
  if (!(nBeats > 0)) return segs;
  for (let i = 0; i < nBeats; i += segBeats) segs.push([i, Math.min(nBeats, i + segBeats)]);
  if (segs.length > 1) {
    const last = segs[segs.length - 1];
    if (last[1] - last[0] < minBeats) {
      segs[segs.length - 2][1] = last[1];
      segs.pop();
    }
  }
  return segs;
}

/* ONE SERIES, BOTH ARMS, with every exclusion named. `refined` picks the frame for the measurement
   and `peaks` for the control; nothing else differs between them, which is what makes the control a
   control. The window is cut WIDER than the template by the whole search range, so every lag is
   scored on the template's full support (see `nccLag`). */
/* 🔴 A BLANKING RUN THE BOX RECORDED IS NOT SIGNAL (§∅). A flat rail inside the template window is a
   plausible diastole, and nothing downstream can tell it from one, so a beat whose window TOUCHES a
   recorded span is excluded by name rather than correlated. `spans` is `undefined` when no sidecar
   reached the parse and `null` when one did and no row could be placed — neither is an empty list,
   and neither licenses treating the stream as clean. Both leave every beat scored, with the sidecar
   state carried beside the number instead. */
export function touchesBlanked(spans, at, halfWide) {
  if (!Array.isArray(spans) || !spans.length) return false;
  const lo = at - halfWide;
  const hi = at + halfWide;
  for (const s of spans) {
    if (!s || !Number.isFinite(s.first) || !Number.isFinite(s.n)) continue;
    if (s.first <= hi && s.first + s.n > lo) return true;
  }
  return false;
}

export function measureSeries(series, peaks, refined, fs, opts = {}) {
  const winMs = opts.winMs ?? WIN_MS;
  const up = opts.up ?? UPSAMPLE;
  const searchMs = opts.searchMs ?? SEARCH_MS;
  const segBeats = opts.segBeats ?? SEG_BEATS;
  const minBeats = opts.minBeats ?? SEG_MIN_BEATS;
  const halfW = Math.max(2, Math.round((winMs / 1000) * fs));
  const searchUp = Math.max(2, Math.round((searchMs / 1000) * fs * up));
  const halfWide = halfW + Math.ceil(searchUp / up) + 1;
  const m = 2 * halfW * up + 1;
  const blanked = Array.isArray(opts.blankingSpans) ? opts.blankingSpans : null;
  const excl = { edge: 0, flat: 0, blanked: 0, unbracketed: 0, shortSegment: 0, noTemplate: 0 };
  const arms = { refined: [], grid: [] };
  const inner = (wide) => {
    const c = Math.round((wide.length - m) / 2);
    return normalise(wide.subarray(c, c + m));
  };
  for (const [a, b] of segmentsOf(peaks.length, segBeats, minBeats)) {
    if (b - a < minBeats) {
      excl.shortSegment += b - a;
      continue;
    }
    for (const arm of ['refined', 'grid']) {
      const src = arm === 'refined' ? refined : peaks;
      const wides = [];
      const cores = [];
      for (let i = a; i < b; i++) {
        if (touchesBlanked(blanked, src[i], halfWide)) {
          if (arm === 'refined') excl.blanked++;
          continue;
        }
        const w = windowAt(series, src[i], halfWide, up);
        if (!w) {
          if (arm === 'refined') excl.edge++;
          continue;
        }
        const core = inner(w);
        if (!core) {
          if (arm === 'refined') excl.flat++;
          continue;
        }
        wides.push(w);
        cores.push(core);
      }
      const tmpl = templateOf(cores);
      if (!tmpl) {
        if (arm === 'refined') excl.noTemplate += cores.length;
        continue;
      }
      const lags = [];
      for (const w of wides) {
        const l = nccLag(w, tmpl, searchUp);
        if (l == null) {
          if (arm === 'refined') excl.unbracketed++;
          continue;
        }
        lags.push(l);
      }
      const r = residualOf(lags, fs, up);
      if (r) arms[arm].push(r);
    }
  }
  /* 🔴 `segMedianSdMs` IS A DIAGNOSTIC, NEVER THE CRITERION. The criterion is the per-beat residual
     `sdMs`, because the thing it is held against — the Δ/√12 sample-grid bound — is a per-beat
     quantity. A statistic computed over segment aggregates is smaller by roughly √n and comparing
     one to the grid bound compares two different populations. It is reported so a reader can see
     which reading of "residual jitter" a carried figure could have come from. */
  const pool = (rows) =>
    rows.length
      ? {
          segments: rows.length,
          beats: rows.reduce((s, r) => s + r.n, 0),
          sdMs: median(rows.map((r) => r.sdMs)),
          iqrMs: median(rows.map((r) => r.iqrMs)),
          segMedianSdMs: rows.length > 1 ? sd(rows.map((r) => r.medMs)) : null
        }
      : null;
  return { fs, beats: peaks.length, refined: pool(arms.refined), grid: pool(arms.grid), gridBoundMs: gridBoundMs(fs), excluded: excl };
}

/* The verdict. The criterion is the ROW's question — does a committed producer reproduce the figure
   the paper carries — and the control rides in `result`, where an inversion sets the status too. */
export function verdictOf(nights, opts = {}) {
  const scored = nights.filter((n) => n.refined && n.refined.sdMs > 0);
  const measured = scored.length ? median(scored.map((n) => n.refined.sdMs)) : null;
  const gridRows = scored.filter((n) => n.grid && n.grid.sdMs > 0);
  const gridMs = gridRows.length ? median(gridRows.map((n) => n.grid.sdMs)) : null;
  const rep = reproduces(measured, CARRIED_RESIDUAL_MS, opts.band ?? CARRIED_BAND);
  const controlHolds = measured != null && gridMs != null ? measured < gridMs : null;
  const reasons = [];
  if (!scored.length) reasons.push('no night produced a residual, so nothing was measured');
  if (rep && !rep.within)
    reasons.push(
      `the measured ${measured.toFixed(3)} ms deviates from the carried ${CARRIED_RESIDUAL_MS} ms by ${(rep.deviation * 100).toFixed(0)} %, outside the pre-stated ${(CARRIED_BAND * 100).toFixed(0)} % band`
    );
  if (controlHolds === false) reasons.push(`the control inverted: refinement read ${measured.toFixed(3)} ms against the integer grid's ${gridMs.toFixed(3)} ms`);
  if (controlHolds == null && scored.length) reasons.push('the control arm produced no residual, so the refinement was never held against the grid');
  const v = Verdict.make({
    gate: 'ecg-template-xcorr-residual',
    status: !scored.length ? 'NOT_RUN' : reasons.length ? 'FAIL' : 'PASS',
    population: { checked: scored.length, eligible: nights.length, excluded: nights.length - scored.length },
    criterion: { name: 'carried_figure_relative_deviation', threshold: opts.band ?? CARRIED_BAND, unit: 'fraction', direction: 'lte' },
    result: !scored.length
      ? null
      : {
          residualMs: measured,
          carriedResidualMs: CARRIED_RESIDUAL_MS,
          deviation: rep ? rep.deviation : null,
          gridMs,
          carriedGridMs: CARRIED_GRID_MS,
          gridBoundMs: scored.length ? median(scored.map((n) => n.gridBoundMs)) : null,
          controlHolds,
          beats: scored.reduce((s, n) => s + (n.refined ? n.refined.beats : 0), 0),
          window: { from: opts.from ?? null, to: opts.to ?? null },
          capturesEligibleInWindow: opts.eligible ?? null,
          validitySidecars: opts.validity ?? null,
          /* diagnostic only — see the note above `pool` in measureSeries */
          segAggregateSdMs: (() => {
            const rows = scored.filter((n) => n.refined && Number.isFinite(n.refined.segMedianSdMs));
            return rows.length ? median(rows.map((n) => n.refined.segMedianSdMs)) : null;
          })()
        },
    evidence: [TOOL, 'papers/ppg-ecg-hrv-validation.html'],
    reason: reasons.length ? reasons.join('; ') : null,
    producedBy: { tool: TOOL, commit: opts.commit ?? null, commitReason: opts.commit ? null : (opts.commitReason ?? 'not a git checkout') },
    at: opts.at ?? new Date().toISOString()
  });
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`verdict invalid: ${chk.errors.join('; ')}`);
  return v;
}

/* ═════════════════════════════ SELFTEST — corpus-free, with the control pair ═════════════════════
 * The planted signal is the whole point: a synthetic QRS train whose TRUE sub-sample positions are
 * known. Hand the estimator positions displaced by a known SD and it must recover that SD; hand it
 * the same positions rounded to the sample grid and it must recover Δ/√12. A tool that cannot tell
 * those two apart cannot report the paper's figure either.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */
let ASSERTED = 0;
let FAILED = 0;
function ok(cond, what, detail) {
  ASSERTED++;
  if (cond) {
    console.log(`  ✓ ${what}${detail ? `  — ${detail}` : ''}`);
    return true;
  }
  FAILED++;
  console.log(`  ✗ ${what}${detail ? `  — ${detail}` : ''}`);
  return false;
}

/* A deterministic generator — a seeded LCG, so a red leg is reproducible. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}
function gauss(rnd) {
  const u = Math.max(1e-12, rnd());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

/* One QRS: a biphasic spike of ~80 ms, the shape the band-passed H10 lead carries. */
export function synthEcg(fs, nBeats, rrMs, seed = 7) {
  const rnd = lcg(seed);
  const truth = [];
  let t = 2 * fs;
  for (let i = 0; i < nBeats; i++) {
    truth.push(t);
    t += ((rrMs + gauss(rnd) * 20) / 1000) * fs;
  }
  const n = Math.ceil(truth[truth.length - 1] + 2 * fs);
  const y = new Float64Array(n);
  const w = (0.04 * fs) | 0;
  for (const p of truth) {
    for (let k = -3 * w; k <= 3 * w; k++) {
      const i = Math.round(p) + k;
      if (i < 0 || i >= n) continue;
      const x = (p + k - Math.round(p) - k + k) / w; // sample offset in QRS widths
      const dx = (Math.round(p) + k - p) / w;
      y[i] += -dx * Math.exp(-0.5 * dx * dx) * 1000 + 0 * x;
    }
  }
  for (let i = 0; i < n; i++) y[i] += gauss(rnd) * 2;
  return { y, truth, fs };
}

function selftest() {
  const FS = 130;
  console.log('ecg-template-xcorr-residual --selftest');

  /* ── pure legs ── */
  const gb = gridBoundMs(FS);
  ok(gb > 2.2 && gb < 2.25, 'the grid bound is Δ/√12 at the sample rate', `${gb.toFixed(3)} ms at ${FS} Hz`);
  ok(gridBoundMs(0) === null && gridBoundMs(-1) === null, 'a rate that is not a rate has no bound, rather than a zero');
  const ser = new Float64Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  ok(windowAt(ser, 4, 2, 2) !== null, 'a window inside the series is cut');
  ok(windowAt(ser, 1, 2, 2) === null && windowAt(ser, 7.5, 2, 2) === null, 'an edge beat is EXCLUDED, never zero-padded (§∅)');
  const nan = new Float64Array([0, 1, Number.NaN, 3, 4, 5, 6, 7, 8]);
  ok(windowAt(nan, 4, 2, 2) === null, 'a window touching a non-finite sample is excluded');

  /* ── population legs: who gets read, and who is excluded by NAME ── */
  ok(nightStampOf('Polar_H10_02849638_20260825195615_ECG.txt') === '2026-08-25', 'the 14-digit stamp shape dates a capture');
  ok(nightStampOf('Polar_H10_02849638_20260606_220643_ECG.txt') === '2026-06-06', 'the underscore stamp shape dates the same way');
  ok(nightStampOf('Polar_H10_nostamp_ECG.txt') === null, 'an undated name reads null, never today (§∅)');
  ok(nightStampOf('Polar_H10_x_20261332195615_ECG.txt') === null, 'a stamp naming month 13 is not a date');
  ok(touchesBlanked([{ first: 100, n: 10 }], 104, 3) === true, 'a beat inside a recorded blanking run is excluded, never correlated (§∅)');
  ok(touchesBlanked([{ first: 100, n: 10 }], 130, 3) === false, 'a beat clear of every run is kept');
  ok(touchesBlanked([{ first: 100, n: 10 }], 96, 5) === true, 'a beat whose WINDOW touches a run is excluded, not just its peak');
  ok(touchesBlanked(undefined, 104, 3) === false && touchesBlanked(null, 104, 3) === false, 'no sidecar excludes nothing — unknown validity is carried beside the number, not acted on');
  const dd = dedupeByName([{ p: '/a/N_20260612221819_ECG.txt' }, { p: '/b/N_20260612221819_ECG.txt' }, { p: '/c/M_20260613221819_ECG.txt' }]);
  ok(dd.kept.length === 2 && dd.dropped === 1, 'one capture under two roots is one night', `kept ${dd.kept.length}, dropped ${dd.dropped}`);
  ok(inWindow('x_20260612221819_ECG.txt', PAPER_FROM, PAPER_TO).ok === true, "a capture inside the paper's window is eligible");
  ok(inWindow('x_20260825195615_ECG.txt', PAPER_FROM, PAPER_TO).why === 'outsideWindow', 'a capture after the window is excluded by window');
  ok(inWindow('x_nostamp_ECG.txt', PAPER_FROM, PAPER_TO).why === 'undatedName', 'an undated capture is excluded under its own named reason');
  ok(inWindow('x_20260825195615_ECG.txt', null, null).ok === true, '--all-dates admits every dated capture');
  ok(normalise(new Float64Array([3, 3, 3])) === null, 'a flat window carries no fiducial and normalises to null');
  const nz = normalise(new Float64Array([0, 1, 0]));
  ok(Math.abs(nz.reduce((s, x) => s + x, 0)) < 1e-12, 'a normalised window has zero mean');
  ok(Math.abs(Math.sqrt(nz.reduce((s, x) => s + x * x, 0)) - 1) < 1e-12, '…and unit L2, so amplitude cannot weight a beat');
  ok(templateOf([]) === null, 'no window means no template, rather than a template of nothing');
  const tmplS = normalise(new Float64Array([0, 1, 4, 1, 0]));
  const wideS = new Float64Array([0, 0, 0, 1, 4, 1, 0, 0, 0]);
  ok(nccLag(wideS, tmplS, 2) !== null && Math.abs(nccLag(wideS, tmplS, 2)) < 1e-6, 'a beat sitting at the template reads lag zero', String(nccLag(wideS, tmplS, 2)));
  const wideOff = new Float64Array([0, 1, 4, 1, 0, 0, 0, 0, 0]);
  ok(nccLag(wideOff, tmplS, 2) === null, 'a best lag on the search edge is unbracketed and reads null');
  ok(nccLag(wideS, null, 2) === null && nccLag(null, tmplS, 2) === null, 'a missing side has no lag');
  ok(nccLag(new Float64Array([1, 2, 3]), tmplS, 9) === null, 'a window too narrow for the search range has no lag, rather than a truncated one');
  ok(residualOf([1], 130, 8) === null, 'one lag is not a spread');
  const r0 = residualOf([0, 0, 0, 0], 130, 8);
  ok(r0 && r0.sdMs === 0 && r0.n === 4, 'identical lags read a zero spread over the lags they came from');
  ok(segmentsOf(0).length === 0, 'no beat means no segment');
  const sg = segmentsOf(640);
  ok(sg.length === 2 && sg[1][1] === 640, 'a short remainder joins the previous segment rather than being dropped', JSON.stringify(sg));
  ok(segmentsOf(900).length === 3, 'whole segments split at the pre-stated width');
  const rp = reproduces(0.3, 0.244);
  ok(rp.within === true && Math.abs(rp.deviation - 0.2295) < 0.01, 'a figure inside the pre-stated band reproduces', rp.deviation.toFixed(4));
  ok(reproduces(1.0, 0.244).within === false, '…and one outside it does not');
  ok(reproduces(null, 0.244) === null && reproduces(0.3, 0) === null, 'an absent figure is not a reproduction of anything (§∅)');

  /* ── THE CONTROL PAIR, on a planted signal ── */
  const SIG = synthEcg(FS, 420, 1000, 11);
  const peaks = SIG.truth.map((p) => Math.round(p));
  const rnd = lcg(5);
  const PLANT_MS = 0.25;
  const refined = SIG.truth.map((p) => p + (gauss(rnd) * PLANT_MS * FS) / 1000);
  const m = measureSeries(SIG.y, peaks, refined, FS, { segBeats: 200, minBeats: 100 });
  ok(m.refined != null, 'the planted train produces a refined residual', m.refined && `${m.refined.sdMs.toFixed(3)} ms over ${m.refined.beats} beat(s)`);
  ok(m.refined && Math.abs(m.refined.sdMs - PLANT_MS) < 0.15, 'the estimator RECOVERS the planted displacement SD', m.refined && `planted ${PLANT_MS} ms, read ${m.refined.sdMs.toFixed(3)} ms`);
  ok(
    m.grid != null && Math.abs(m.grid.sdMs - m.gridBoundMs) < 0.6,
    'the integer-grid arm lands on Δ/√12 — the control',
    m.grid && `${m.grid.sdMs.toFixed(3)} ms against a bound of ${m.gridBoundMs.toFixed(3)} ms`
  );
  ok(m.refined && m.grid && m.refined.sdMs < m.grid.sdMs, 'refinement beats the grid on the planted signal', m.refined && `${m.refined.sdMs.toFixed(3)} < ${m.grid.sdMs.toFixed(3)} ms`);
  ok(
    Object.values(m.excluded).every((v) => Number.isFinite(v)),
    'every exclusion is counted by reason',
    JSON.stringify(m.excluded)
  );
  const mShort = measureSeries(SIG.y, peaks.slice(0, 40), refined.slice(0, 40), FS);
  ok(mShort.refined === null && mShort.excluded.shortSegment === 40, 'a segment under the floor is excluded BY NAME, not scored', JSON.stringify(mShort.excluded));

  /* ── CONTROL · a train the estimator must NOT flatter: displace by a whole sample ── */
  const wild = SIG.truth.map((p, i) => p + (i % 2 ? 1 : -1) * 1.0);
  const mw = measureSeries(SIG.y, peaks, wild, FS, { segBeats: 200, minBeats: 100 });
  ok(mw.refined && mw.refined.sdMs > m.refined.sdMs * 3, 'a deliberately displaced train reads WORSE, so the number is not a constant', mw.refined && `${mw.refined.sdMs.toFixed(3)} ms`);

  /* ── verdict legs ── */
  const nightsOk = [
    { refined: { sdMs: 0.25, beats: 100, segments: 1 }, grid: { sdMs: 2.2, beats: 100, segments: 1 }, gridBoundMs: 2.22 },
    { refined: { sdMs: 0.27, beats: 100, segments: 1 }, grid: { sdMs: 2.1, beats: 100, segments: 1 }, gridBoundMs: 2.22 }
  ];
  const vOk = verdictOf(nightsOk, { commit: 'abcdef1' });
  ok(vOk.status === 'PASS' && vOk.reason === null, 'two reproducing nights with a holding control read PASS');
  ok(vOk.population.checked + vOk.population.excluded === vOk.population.eligible, 'the population adds up');
  const vFar = verdictOf([{ refined: { sdMs: 1.4, beats: 100, segments: 1 }, grid: { sdMs: 2.2, beats: 100, segments: 1 }, gridBoundMs: 2.22 }], { commit: 'abcdef1' });
  ok(vFar.status === 'FAIL' && /outside the pre-stated/.test(vFar.reason), 'a figure outside the band FAILS and the reason says so');
  const vInv = verdictOf([{ refined: { sdMs: 0.25, beats: 100, segments: 1 }, grid: { sdMs: 0.1, beats: 100, segments: 1 }, gridBoundMs: 2.22 }], { commit: 'abcdef1' });
  ok(vInv.status === 'FAIL' && /control inverted/.test(vInv.reason), 'an inverted control FAILS even when the figure reproduces');
  const vNone = verdictOf([], { commit: 'abcdef1' });
  ok(vNone.status === 'NOT_RUN' && vNone.reason !== null, 'no night examined reads NOT_RUN with a reason, never PASS over nothing');
  ok(verdictOf(nightsOk, {}).producedBy.commitReason !== null, 'a run outside a checkout names why it has no commit');

  console.log(`\n${ASSERTED - FAILED} passed, ${FAILED} failed`);
  return FAILED === 0 ? 0 : 1;
}

export function verdictSample() {
  return verdictOf(
    [
      { refined: { sdMs: 0.26, beats: 28000, segments: 95 }, grid: { sdMs: 2.18, beats: 28000, segments: 95 }, gridBoundMs: 2.22 },
      { refined: { sdMs: 0.24, beats: 26500, segments: 90 }, grid: { sdMs: 2.21, beats: 26500, segments: 90 }, gridBoundMs: 2.22 }
    ],
    { commit: null, commitReason: 'synthetic sample — no corpus, no checkout read', at: '2026-11-03T00:00:00Z' }
  );
}

/* ═════════════════════════════ CORPUS DISCOVERY ═════════════════════════════ */
export const ECG_RE = /Polar_H10.*_ECG\.txt$/i;
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

/* The capture stamp a H10 filename carries, in either shape the corpus holds: `…_20260825195615_ECG`
   and `…_20260606_220643_ECG`. `null` for a name that carries no date — never today's date, and never
   a guess, so an undated capture is EXCLUDED BY NAME rather than silently dated into the window. */
export const STAMP_RE = /_(\d{4})(\d{2})(\d{2})_?(\d{2})(\d{2})(\d{2})_ECG\.txt$/i;
export function nightStampOf(name) {
  const m = STAMP_RE.exec(name);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (!(y >= 2000 && y <= 2100) || !(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/* 🔴 ONE CAPTURE IS ONE NIGHT, HOWEVER MANY PATHS HOLD IT. Measured 2026-11-03: the corpus carries
   669 H10 ECG paths over 367 distinct captures, several of them under three roots at once, and a
   first run pooled the same night three times — its median was a weighted vote, not a corpus median.
   The basename IS the capture identity (device serial + start stamp), so dedupe on it and count what
   that drops. */
export function dedupeByName(files) {
  const seen = new Set();
  const kept = [];
  let dropped = 0;
  for (const f of files) {
    const b = basename(f.p);
    if (seen.has(b)) {
      dropped++;
      continue;
    }
    seen.add(b);
    kept.push(f);
  }
  return { kept, dropped };
}

export function inWindow(name, from, to) {
  const s = nightStampOf(name);
  if (!s) return { ok: false, why: 'undatedName' };
  if (from && s < from) return { ok: false, why: 'outsideWindow' };
  if (to && s > to) return { ok: false, why: 'outsideWindow' };
  return { ok: true, stamp: s };
}

/* 🔴 THE ROOT'S OWN readdir RUNS OUTSIDE THE CATCH. `walk` swallows every error, so an unreadable
   root would return `[]` and the snapshot would publish a MEASUREMENT of zero nights (§∅). This
   refuses instead.

   🔴 AND THE LISTER IS THE POPULATION. It applies the same dedupe and the same window the scoring
   loop applies, because a snapshot of 669 paths beside a run over 30 captures reports a set the run
   never read. */
export function listH10Ecg(root, opts = {}) {
  readdirSync(root);
  const hits = walk(root).filter((f) => ECG_RE.test(f.p));
  const { kept } = dedupeByName(hits);
  return kept.filter((f) => inWindow(basename(f.p), opts.from ?? null, opts.to ?? null).ok).map((f) => relative(root, f.p));
}

export function printVerdict(v) {
  console.log(`  tepna.verdict/1: ${v.status}  ·  ${v.population.checked} checked / ${v.population.eligible} eligible / ${v.population.excluded} excluded`);
  console.log(`  ${JSON.stringify(v)}`);
  if (v.reason) console.log(`  reason: ${v.reason}`);
}

if (has('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample()));
  process.exit(0);
}
if (has('--selftest')) process.exit(selftest());

/* ═════════════════════════════ THE CORPUS RUN ═════════════════════════════ */
const DIR = opt('--dir', null);
const MAX_NIGHTS = Number(opt('--max-nights', 30));
const UNIT = 'H10 ECG files';

if (!DIR) {
  console.error(`${TOOL} — the ECG detector's fiducial residual against template cross-correlation

  node ${TOOL} --dir <captures root> [--max-nights 30] [--json]
  node ${TOOL} --selftest
  node ${TOOL} --verdict-sample

A corpus root is required: this tool measures real H10 nights and refuses to imply a population it
never read. docs/CORPUS-LOCATIONS.md names the roots.`);
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
const E = realm(['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ecgdex-registry.js', 'ecgdex-morph.js', 'ecgdex-dsp.js']).ECGDSP;

const FROM = has('--all-dates') ? null : opt('--from', PAPER_FROM);
const TO = has('--all-dates') ? null : opt('--to', PAPER_TO);
/* ── THE VALIDITY SIDECAR RIDES WITH THE STREAM ─────────────────────────────────────────────────────
   Row 2026-10-17-sample-parsers-called-without-their-sidecar. The tally prints beside the numbers:
   §∅, an ABSENT sidecar is validity UNKNOWN for that stream and never a clean one, and most of this
   corpus predates the writer, so most streams read `absent` and parse as they did before. */
const VALIDITY = {};
const runsOf = (streamPath, stream) => readRunsSidecar(streamPath, stream, { tally: VALIDITY }).runsText;

const commitOf = gitCommitOf(ROOT);
const lister = (root) => listH10Ecg(root, { from: FROM, to: TO });
const snapBefore = snapshotEntries(DIR, { list: lister, unit: UNIT });

const hits = walk(DIR).filter((f) => ECG_RE.test(f.p));
const { kept, dropped } = dedupeByName(hits);
/* Sorted by NAME, so the capture stamp orders the run and the same corpus gives the same 30 nights
   whatever the filesystem hands back. A size sort reads "the longest nights", which is a selected
   subpopulation and not what the carried figure claims. */
const windowed = [];
const outside = { undatedName: 0, outsideWindow: 0 };
for (const f of kept.sort((a, b) => basename(a.p).localeCompare(basename(b.p)))) {
  const w = inWindow(basename(f.p), FROM, TO);
  if (w.ok) windowed.push(f);
  else outside[w.why]++;
}
/* ── THE CAP IS NAMED FOR NIGHTS, SO IT SELECTS NIGHTS ────────────────────────────────────────────
   Row 2026-11-05-three-more-max-nights-caps-still-cut-files: this line sliced `--max-nights` out of
   a list of CAPTURES. The order was never size-biased, so the subsample was not, but a night
   recorded as two sessions still spent two of the budget and the count the flag names was an output
   of the cut rather than the cut itself.

   THE KEY IS THE PARSED CLOCK, NOT THE NAME THE WINDOW USES. `inWindow` reads the 14-digit filename
   stamp, which is the SESSION's start taken before the link is up, so two sessions either side of
   midnight read as two nights by name and as one night by the clock. The window keeps its name rule,
   which is what the carried figure's date range means; the cap reads each candidate's head through
   this node's own parser. The probe's sidecar read is untallied, because `VALIDITY` describes the
   streams this run SCORED and a candidate the cap drops is not one of them (§∅). */
const headNightKey = headNightKeyWith({
  parse: (t, o) => {
    const rt = o && o.runsText;
    return rt ? E.parseECG(t, { runsText: rt }) : E.parseECG(t);
  },
  runsOf: (path) => readRunsSidecar(path, 'ECG').runsText
});
const _cap = capByNights(windowed, MAX_NIGHTS, headNightKey);
const files = _cap.kept;

console.log(`ECG fiducial residual against template cross-correlation`);
console.log(
  `window ${FROM ?? 'any'} → ${TO ?? 'any'} · ${hits.length} path(s) walked, ${dropped} duplicate path(s) of one capture dropped, ${outside.outsideWindow} outside the window, ${outside.undatedName} undated by name → ${windowed.length} capture(s) eligible, ${files.length} read` +
    `\n  the --max-nights ${MAX_NIGHTS} cap kept ${_cap.keptNights.length} of ${_cap.nights.length} dated night(s), earliest first, whole nights only` +
    (_cap.droppedNights.length ? ` · nights left by name: ${_cap.droppedNights.slice(0, 8).join(' · ')}${_cap.droppedNights.length > 8 ? ` · … (+${_cap.droppedNights.length - 8})` : ''}` : '') +
    (_cap.undated.length ? ` · ∅ ${_cap.undated.length} candidate head(s) carried no clock, offered after every dated night, ${_cap.keptUndated.length} read` : '') +
    '\n'
);
console.log('file                                            fs      beats  refined  grid   bound  seg-ag  excluded');
const nights = [];
for (const f of files) {
  let row = null;
  let why = null;
  try {
    const rec = E.parseECG(readFileSync(f.p, 'utf8'), { runsText: runsOf(f.p, 'ECG') });
    const res = rec && rec.t0Ms != null ? E.analyze(rec) : null;
    if (!res || !res.peaks || res.peaks.length < SEG_MIN_BEATS) why = res && res.peaks ? `only ${res.peaks.length} beat(s)` : 'the node returned no peaks';
    else {
      const bp = E.bandpass(rec.int16, rec.fs);
      row = measureSeries(bp, res.peaks, refinePeaks(bp, res.peaks), rec.fs, { blankingSpans: rec.blankingSpans });
    }
  } catch (e) {
    why = `refused: ${String(e && e.message).slice(0, 60)}`;
  }
  const name = relative(DIR, f.p);
  if (!row) {
    nights.push({ file: name, refined: null, grid: null, gridBoundMs: null, why });
    console.log(`${basename(name).padEnd(44)}  ${'—'.padStart(6)}  ${'—'.padStart(6)}  ${'—'.padStart(7)}  ${'—'.padStart(5)}  ${'—'.padStart(5)}  ${'—'.padStart(6)}  ${why}`);
    continue;
  }
  nights.push({ file: name, ...row });
  console.log(
    `${basename(name).padEnd(44)}  ${row.fs.toFixed(2).padStart(6)}  ${String(row.beats).padStart(6)}  ${(row.refined ? row.refined.sdMs.toFixed(3) : '—').padStart(7)}  ${(row.grid ? row.grid.sdMs.toFixed(3) : '—').padStart(5)}  ${(row.gridBoundMs ?? 0).toFixed(3).padStart(5)}  ${(row.refined && row.refined.segMedianSdMs != null ? row.refined.segMedianSdMs.toFixed(3) : '—').padStart(6)}  ${JSON.stringify(row.excluded)}`
  );
}

const population = populationVerdict(snapBefore, snapshotEntries(DIR, { list: lister, unit: UNIT }), {
  tool: TOOL,
  commit: commitOf.commit,
  commitReason: commitOf.reason,
  evidence: [TOOL]
});
const vline = validityLine(VALIDITY);
const v = verdictOf(nights, { commit: commitOf.commit, commitReason: commitOf.reason, from: FROM, to: TO, eligible: windowed.length, validity: VALIDITY });
if (has('--json')) console.log(JSON.stringify({ nights, population, verdict: v }, null, 2));
else {
  console.log('');
  /* `validityLine` returns null over an empty tally: a run that read no stream states nothing rather
     than four zeros, which read exactly like a sweep where every sidecar was there. */
  if (vline) console.log(vline);
  console.log(ruleLine(population));
  console.log(`POPULATION (tepna.verdict/1): ${JSON.stringify(population)}`);
  console.log('');
  printVerdict(v);
}
process.exit(v.status === 'PASS' ? 0 : 1);
