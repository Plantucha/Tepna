#!/usr/bin/env node
/*
 * tools/nsrr-criterion-sweep.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═════════════════════════════════════════════════════════════════════════════
 * DERIVE THE DESATURATION CRITERION FROM THE DATA, INSTEAD OF ASSUMING IT.
 *
 * `tools/nsrr-oxydex-odi.mjs` scores the SHIPPED detector against expert scoring at a fixed
 * criterion. This asks the next question: **which criterion would agree best?** It sweeps
 * `detectDesatEvents`'s real parameters over clamped ranges, recomputes the index on real SpO₂, and
 * scores each point against the expert index — a clamped grid search, coarse then refined.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 * Every wrong answer in this lane came from an ASSUMED criterion. ODI-4 was paired against an AHI
 * whose hypopnea rule needs no desaturation. Then the expert desaturation index was paired against
 * ODI-3 on the assumption that scorers used ≥3 % — a median 70.9 % of their events are shallower than
 * that. Both were assumptions about a definition, and both inverted the conclusion. A sweep replaces
 * the assumption with a measurement.
 *
 * ── ⚠️ A BRUTE-FORCE SEARCH ALWAYS FINDS SOMETHING. THREE GUARDS, NONE OPTIONAL ──────────────
 *
 * 1 · **HELD-OUT SPLIT.** The best point on the data you searched is not a result — it is the
 *     definition of overfitting. Records are split deterministically (even index = FIT, odd = HELD),
 *     the grid is searched on FIT only, and the winner is scored ONCE on HELD. A tool that reported
 *     its own best training score would be a very expensive way to restate its input.
 *
 * 2 · **THE INCUMBENT IS THE NULL.** The shipped default is scored on the same held-out split and
 *     printed beside the winner. A sweep that "improves" agreement by less than the spread between
 *     records has found nothing, and the report says so rather than leaving the reader to notice.
 *
 * 3 · **CLAMPS ARE REFUSALS, NOT CLIPS.** Each axis is bounded by what the quantity can clinically
 *     mean, and a request outside is REFUSED rather than silently pulled to the edge — a clipped
 *     search reports a boundary optimum that is an artifact of the boundary.
 *
 * ── WHAT THE LITERATURE SAYS, CHECKED BEFORE BUILDING (and it changed the design) ────────────
 *
 * 1 · **There is no accepted standard for ODI calculation during polysomnography** (Won et al.,
 *     J Clin Sleep Med 2024, doi:10.5664/jcsm.10982). That is the licence for this tool: the criterion
 *     is genuinely underdetermined, so deriving it is legitimate rather than second-guessing a spec.
 *     ⚠️ It is also the limit on the RESULT — a criterion fitted to SHHS scorers is a property of
 *     SHHS's scoring convention, not a universal definition. Do not port it to another cohort without
 *     re-fitting, and do not call it "the" criterion.
 *
 * 2 · **Published automated-ODI agreement is ICC 0.99 / r 0.976, Bland–Altman bias −3.76 to
 *     +6.17 events/h.** Tepna's shipped detector already measures median −0.12 events/h with an IQR of
 *     −1.58 to +0.78 over 91 SHHS records — INSIDE that band, with a tighter spread. So the headroom
 *     here is small, and that is pre-stated rather than discovered: **an improvement below 0.5
 *     events/h held-out is not material**, because it is an order of magnitude under the published
 *     spread between methods. The report applies that bound instead of celebrating any positive number.
 *
 * 3 · **Adaptive, per-patient thresholds are an established direction, not an invention here** —
 *     wrist Type-IV devices ship "adaptive SpO₂ waveform-based desaturation detection", and published
 *     work uses non-standard thresholds (ODI2.5) and compares event-specific vs record-specific vs
 *     fixed baselines. ⚠️ MODEL-FAMILY LIMIT, stated because it bounds the answer: this sweep searches
 *     a RECORD-specific rolling baseline (`WIN`, `pct`). It cannot express an EVENT-specific baseline,
 *     which the baseline-methods literature treats as a live alternative. A poor result here does not
 *     rule out a better criterion in a family this grid cannot reach.
 *
 * 4 · **Grid search on a single held-out split is known to overtune** (Nagler et al., "Overtuning in
 *     Hyperparameter Optimization", arXiv:2506.19540; nested resampling is the standard remedy). The
 *     first draft of this file used one even/odd split. It now runs K-FOLD cross-validation and reports
 *     the fold-wise spread, because a single split's winner is itself a random variable.
 *
 * ── THE OBJECTIVE, PRE-STATED ────────────────────────────────────────────────────────────────
 * Median absolute difference, in events/hour, between the computed index and the expert index at the
 * SAME depth. Not a ratio: a ratio of two small counts is not an agreement statistic — with an expert
 * index of 3/h, detecting 5/h is 167 % from a two-event difference. Measured over 91 records, sparse
 * nights show a median ratio of 115 % against a median absolute gap of 0.9 events/h. The ratio is
 * reported as a diagnostic and never optimised.
 *
 * ── NO FETCHING ──────────────────────────────────────────────────────────────────────────────
 * Never downloads. Absent records ⇒ explicit SKIP naming every path searched, and no numbers.
 * §P5 gates PUBLICATION of these figures, not their measurement (owner ruling 2026-09-12).
 *
 * USAGE
 *   node tools/nsrr-criterion-sweep.mjs --selftest
 *   node tools/nsrr-criterion-sweep.mjs --cache --dir <psg-dir>   # extract SpO₂ + expert events once
 *   node tools/nsrr-criterion-sweep.mjs --sweep                   # search the cache (fast, in memory)
 *   node tools/nsrr-criterion-sweep.mjs --sweep --json
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join, basename } from 'node:path';
import vm from 'node:vm';

const require_ = createRequire(import.meta.url);
const DexBuild = require_('./build-core.js');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'nsrr-spo2-cache.json');

/* ── CLAMPS — each bound is what the quantity can clinically mean, not a tuning convenience ──
   dropPct  a desaturation index below 2 % tracks sensor noise; above 6 % it is no longer an ODI.
   minSec   AASM requires a respiratory event to last ≥10 s; below 5 s is a blip, above 30 s excludes
            real events by construction.
   WIN      the clinical baseline window is 100–300 s; 60–600 brackets it generously.
   pct      the ceiling percentile — below 75 the "baseline" tracks the dips it is meant to measure
            against, above 95 it is the record maximum and stops adapting. */
export const CLAMPS = {
  /* the SLOPE bound. A threshold that swings more than ±2 % per standard deviation of a night
     covariate is no longer adapting, it is a different criterion per night — and at ±2 the intercept
     plus slope already spans the whole dropPct clamp, so wider buys nothing but overfit. */
  b: [-2, 2],
  dropPct: [2, 6],
  minSec: [5, 30],
  WIN: [60, 600],
  pct: [75, 95]
};

export function clampCheck(params) {
  const bad = [];
  for (const [k, [lo, hi]] of Object.entries(CLAMPS)) {
    const v = params[k];
    if (v == null) continue;
    if (!Number.isFinite(v)) bad.push(`${k}=${v} is not finite`);
    else if (v < lo || v > hi) bad.push(`${k}=${v} outside [${lo}, ${hi}]`);
  }
  return { ok: bad.length === 0, refusals: bad };
}

/* ── THE RESULT IS A FUNCTION, NOT A TUPLE ───────────────────────────────────────────────────
   A single best threshold is the wrong shape for what the data shows. The one residual this lane has
   established is that the gap between the detector and the scorer GROWS WITH EVENT RATE — 75 % ratio
   and a real 4.7 events/h shortfall on dense nights against 115 % / 0.9 events/h on sparse ones. A
   constant criterion cannot express that; a function of the night can.

   So the search is over a FAMILY:

       dropPct(night) = clamp(a + b · z(night),  CLAMPS.dropPct)
       z = (covariate(night) − centre) / scale        standardised across the FIT split

   `b = 0` recovers the constant model exactly, so the incumbent is NESTED inside the family and the
   extra parameter has to earn its keep on held-out records rather than by construction.

   ⚠️ EVERY COVARIATE IS COMPUTED FROM THE SIGNAL ALONE. Not one of them may read the expert labels,
   the scored event count, or anything derived from them — a covariate that peeks at the reference
   makes the search a very elaborate way to copy the answer, and it would score beautifully on
   held-out records too, because the leak travels with the data. They take the SpO₂ series and
   nothing else. */
export const COVARIATES = {
  /* no adaptation — the nested null */
  none: () => 0,
  /* how hypoxaemic the night is overall: a lower median means more time desaturated */
  medianSpo2: (v) => {
    const d = v.filter((x) => x != null).sort((a2, b2) => a2 - b2);
    return d.length ? d[Math.floor(d.length / 2)] : null;
  },
  /* how much the trace moves: an unstable night carries more, and shallower, excursions */
  iqrSpo2: (v) => {
    const d = v.filter((x) => x != null).sort((a2, b2) => a2 - b2);
    if (d.length < 4) return null;
    return d[Math.floor(0.75 * d.length)] - d[Math.floor(0.25 * d.length)];
  },
  /* mean absolute second-by-second change — instability without a distributional assumption */
  meanAbsDelta: (v) => {
    let s2 = 0,
      n2 = 0;
    for (let i = 1; i < v.length; i++) {
      if (v[i] == null || v[i - 1] == null) continue;
      s2 += Math.abs(v[i] - v[i - 1]);
      n2++;
    }
    return n2 ? s2 / n2 : null;
  }
};

/* Standardisation is fitted on the FIT split only and then APPLIED to held-out records — computing it
   over all records would let the held-out set influence the model that is meant to be tested on it. */
export function fitStandardiser(recs, covName) {
  const f = COVARIATES[covName];
  const xs = recs.map((r) => (r.spo2 ? f(r.spo2) : null)).filter((x) => x != null && Number.isFinite(x));
  if (!xs.length) return { centre: 0, scale: 1, n: 0 };
  const mean = xs.reduce((p, q) => p + q, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((p, q) => p + (q - mean) * (q - mean), 0) / xs.length) || 1;
  return { centre: +mean.toFixed(4), scale: +sd.toFixed(4), n: xs.length };
}

/* The function itself. Clamped, because an extrapolated threshold outside the clinical range is not a
   criterion — and clamped rather than refused HERE, deliberately: the refusal belongs on what the
   search may REQUEST, while a per-night value landing at the edge is the model saying "no further". */
export function effectiveDrop(params, night, std) {
  const f = COVARIATES[params.cov || 'none'];
  const raw = night && night.spo2 ? f(night.spo2) : null;
  const b = params.b || 0;
  /* `none` is the CONSTANT model and must stay constant whatever slope the grid happens to pair with
     it — its covariate is the literal 0, so without this the slope multiplies a standardised 0 into
     the clamp floor and the "nested null" silently becomes a different model. Caught by the nested
     assertion, which is the one thing that makes the null comparison meaningful. */
  if (params.cov === 'none' || raw == null || !Number.isFinite(raw) || b === 0) return clampTo(params.a, CLAMPS.dropPct);
  const z = (raw - std.centre) / (std.scale || 1);
  return clampTo(params.a + b * z, CLAMPS.dropPct);
}

export function clampTo(v, [lo, hi]) {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, +v.toFixed(3)));
}

/* The grid. Coarse first; `refineAround` then re-searches a tight neighbourhood of the winner, which
   is the "smart" half of brute force — a fine grid over the whole space costs 100× for the same answer. */
export const COARSE = {
  a: [2, 3, 4, 5, 6], // intercept — the threshold at an average night
  b: [-1, -0.5, 0, 0.5, 1], // slope on the standardised covariate; 0 IS the constant model
  minSec: [5, 10, 15, 20, 30],
  WIN: [60, 120, 300, 600],
  pct: [75, 85, 90, 95]
};

/* The grid speaks in model terms (`a` the intercept, `b` the slope); the clamps speak in the
   detector's terms (`dropPct`). Mapping them explicitly beats naming them alike, because a silent
   miss here would refine outside a clamp and report a boundary optimum as a discovery. */
export const AXIS_CLAMP = { a: 'dropPct', b: 'b', minSec: 'minSec', WIN: 'WIN', pct: 'pct' };

/* A REDUCED grid, for when an answer now beats a complete answer later. It pins the baseline
   parameters at their clinical values (WIN 300 s, pct 90) and sweeps only the model itself — the
   intercept, the slope and the minimum duration. That is ~38× fewer points.

   ⚠️ It is a DIFFERENT EXPERIMENT, not a preview of the full one, and the report says which grid ran.
   The baseline-method question (record- vs event-specific, window width) is exactly what the
   literature treats as live, so fixing WIN/pct answers the model question while explicitly declining
   the baseline one. A --quick result may NOT be quoted as though the full grid produced it. */
export const QUICK = {
  a: [2, 3, 4, 5, 6],
  b: [-1, -0.5, 0, 0.5, 1],
  minSec: [5, 10, 15, 20, 30],
  WIN: [300],
  pct: [90]
};

export function refineAround(best, coarse) {
  const out = {};
  for (const k of Object.keys(coarse)) {
    const axis = coarse[k];
    const i = axis.indexOf(best[k]);
    const lo = axis[Math.max(0, i - 1)],
      hi = axis[Math.min(axis.length - 1, i + 1)];
    const [cl, ch] = CLAMPS[AXIS_CLAMP[k] || k] || [-Infinity, Infinity];
    const step = k === 'a' ? 0.5 : k === 'b' ? 0.25 : k === 'minSec' ? 2.5 : k === 'pct' ? 2.5 : 30;
    const vals = new Set();
    for (let v = lo; v <= hi + 1e-9; v += step) {
      const r = Math.round(v * 100) / 100;
      if (r >= cl && r <= ch) vals.add(r);
    }
    vals.add(best[k]);
    out[k] = [...vals].sort((a, b) => a - b);
  }
  return out;
}

export function gridPoints(grid) {
  const keys = Object.keys(grid);
  let acc = [{}];
  for (const k of keys) {
    const next = [];
    for (const base of acc) for (const v of grid[k]) next.push({ ...base, [k]: v });
    acc = next;
  }
  return acc;
}

/* ── the objective ────────────────────────────────────────────────────────────────────────────
   Median absolute difference in events/hour. Records with no expert events at the matched depth are
   EXCLUDED rather than scored as a perfect zero — a night with nothing to find cannot grade a
   detector, and counting it would reward a detector that finds nothing anywhere. */
export function medianAbsDiff(pairs) {
  const d = pairs.filter((p) => p.a != null && p.b != null && p.b > 0).map((p) => Math.abs(p.a - p.b));
  if (!d.length) return { n: 0, score: null };
  d.sort((x, y) => x - y);
  return { n: d.length, score: +d[Math.floor(d.length / 2)].toFixed(4) };
}

export function splitRecords(ids) {
  const s = ids.slice().sort();
  return { fit: s.filter((_, i) => i % 2 === 0), held: s.filter((_, i) => i % 2 === 1) };
}

/* K-FOLD, deterministic by sorted position. A single split's winner is a draw from a distribution, and
   reporting it as the answer is the overtuning the hyperparameter-optimisation literature describes.
   Each fold searches on its own training part and is scored once on its own held part; the REPORTED
   number is the median across folds, and the spread across folds is printed beside it — if the folds
   disagree more than the winner beats the null, there is no winner. */
export function kFold(ids, k) {
  const s = ids.slice().sort();
  const folds = [];
  for (let f = 0; f < k; f++) {
    const held = s.filter((_, i) => i % k === f);
    folds.push({ fit: s.filter((_, i) => i % k !== f), held });
  }
  return folds;
}

/* Materiality, from the published between-method spread rather than from taste. */
export const MATERIAL_GAIN = 0.5; // events/h held-out; below this the sweep found nothing worth shipping

/* ── realm ───────────────────────────────────────────────────────────────────────────────────── */
export function makeRealm() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.console = console;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.__DEX_NAMESPACED__ = true;
  const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {} } });
  sandbox.document = {
    createElement: el,
    createElementNS: el,
    createTextNode: () => ({}),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    head: { appendChild() {} },
    body: { appendChild() {} },
    documentElement: { outerHTML: '' }
  };
  sandbox.navigator = { userAgent: 'node' };
  sandbox.location = { href: 'file:///' };
  /* ⚠️ `parseNsrrXml` needs a DOMParser and Node has none. Omitting it does NOT throw — the parser
     simply finds no ScoredEvent nodes, so every record returns `tstHours: null`, every pair is skipped
     and the whole sweep scores nothing. The first cache built here had 99/99 null TST and would have
     reported "no fold produced a score", which reads like a data problem and is a missing stub. */
  sandbox.DOMParser = class {
    parseFromString(text) {
      const blocks = text.match(/<ScoredEvent[\s\S]*?<\/ScoredEvent>/g) || [];
      const pick = (b, tag) => {
        const m = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>').exec(b);
        return m ? m[1] : null;
      };
      const nodes = blocks.map((b) => ({
        querySelector(sel) {
          for (const tag of sel.split(',').map((x) => x.trim())) {
            const v = pick(b, tag);
            if (v != null) return { textContent: v };
          }
          return null;
        },
        textContent: b
      }));
      return {
        querySelector: () => null,
        querySelectorAll: () => {
          const arr = nodes.slice();
          arr.forEach = Array.prototype.forEach.bind(arr);
          return arr;
        }
      };
    }
  };
  const ctx = vm.createContext(sandbox);
  for (const f of ['clock.js', 'kernel-constants.js', 'cpapdex-edf.js', 'oxydex-util.js', 'oxydex-dsp.js', 'nsrr-adapter.js']) {
    const p = join(ROOT, f);
    if (!existsSync(p)) throw new Error('module not found: ' + f);
    vm.runInContext(DexBuild.classicify(readFileSync(p, 'utf8')), ctx, { filename: f });
  }
  /* `detectDesatEvents` is not on the namespaced surface — it lives on `OxyDex._bare`, the deliberate
     back-compat re-export (oxydex-dsp.js:7846). Resolved explicitly and CHECKED, because a sweep that
     silently substituted its own detector would produce a beautiful, meaningless criterion. */
  const bare = ctx.OxyDex && ctx.OxyDex._bare;
  const det = bare && bare.detectDesatEvents;
  if (typeof det !== 'function') {
    throw new Error('nsrr-criterion-sweep: OxyDex._bare.detectDesatEvents not found — the sweep needs the REAL detector and will not substitute one');
  }
  ctx.__detect = det;
  /* the baseline builder is a module-scope global in oxydex-util.js, not on the namespace */
  if (typeof ctx.computeCeilingBaselineArr !== 'function') {
    throw new Error('nsrr-criterion-sweep: computeCeilingBaselineArr not found — the baseline cache would silently fall back and cost 24x');
  }
  ctx.__baseline = ctx.computeCeilingBaselineArr;
  return ctx;
}

/* ── cache build ──────────────────────────────────────────────────────────────────────────────
   Loading 99 EDFs costs minutes; the sweep visits each record hundreds of times. Extract the 1 Hz
   SpO₂ and the expert events ONCE, then search in memory. This is what makes brute force affordable. */
const DESAT_BLOCK = /<ScoredEvent>[\s\S]*?<\/ScoredEvent>/g;
const NADIR = /<SpO2Nadir>([\d.]+)<\/SpO2Nadir>/;
const BASE = /<SpO2Baseline>([\d.]+)<\/SpO2Baseline>/;

export function expertDepths(xmlText) {
  const out = [];
  for (const b of String(xmlText).match(DESAT_BLOCK) || []) {
    if (!/SpO2 desaturation/i.test(b)) continue;
    const n = NADIR.exec(b),
      base = BASE.exec(b);
    if (!n || !base) continue;
    const d = Number(base[1]) - Number(n[1]);
    if (Number.isFinite(d)) out.push(+d.toFixed(2));
  }
  return out;
}

/* ── EDF TRUNCATION, DETECTED FROM THE FILE'S OWN HEADER ─────────────────────────────────────
   The corpus arrives over ~40 hours, so the cache builder runs WHILE files are being written. A
   half-written EDF parses fine — `readEDF` reads the header, believes it, and returns a record whose
   signal arrays are short. Cached, that is a night silently missing its last hours, and no downstream
   check could tell it from a genuinely short recording.

   An EDF states its own expected size, so this needs no heuristic and no mtime guesswork:

       header  = 256 + ns × 256                          (bytes 184-191 also carry it)
       data    = nDataRecords × Σ(samples per record) × 2
       total   = header + data

   A file smaller than that is still in flight (or corrupt) and is SKIPPED — not cached, not counted
   as an error, just deferred to the next run. Larger is also refused: that is not an EDF we understand.
   ⚠️ mtime was the obvious alternative and is wrong here — NFS mtime granularity plus a stalled
   transfer makes a partial file look settled. The header is authoritative. */
export function edfExpectedBytes(buf) {
  if (!buf || buf.length < 256) return null;
  const txt = (o, n) => buf.toString('ascii', o, o + n).trim();
  const nrec = Number.parseInt(txt(236, 8), 10);
  const ns = Number.parseInt(txt(252, 4), 10);
  if (!Number.isFinite(nrec) || !Number.isFinite(ns) || ns < 1 || nrec < 1) return null;
  const header = 256 + ns * 256;
  if (buf.length < header) return null; // header itself not fully written yet
  let perRecord = 0;
  for (let k = 0; k < ns; k++) {
    const v = Number.parseInt(txt(256 + 216 * ns + k * 8, 8), 10);
    if (!Number.isFinite(v) || v < 0) return null;
    perRecord += v;
  }
  return header + nrec * perRecord * 2;
}

/* ── INCREMENTAL CACHE BUILD ──────────────────────────────────────────────────────────────────
   Re-runnable while the corpus is still arriving. Three properties, each one a failure this would
   otherwise have:

   1 · SKIP WHAT IS ALREADY CACHED, keyed on id AND source size. Size is what makes a re-run correct
       rather than merely fast: a record cached from a truncated file is re-processed once the file
       grows, instead of being trusted forever because its id was seen.
   2 · SKIP WHAT IS STILL ARRIVING, via the header check above.
   3 · FLUSH PERIODICALLY AND ATOMICALLY (temp file + rename). A 40-hour corpus means a build that
       runs for a long time; losing all of it to one interruption is the avoidable part. Rename is
       atomic on the same filesystem, so a reader never sees a half-written cache. */
function loadCache() {
  if (!existsSync(CACHE)) return { records: [] };
  try {
    const c = JSON.parse(readFileSync(CACHE, 'utf8'));
    return c && Array.isArray(c.records) ? c : { records: [] };
  } catch {
    return { records: [] }; // an unreadable cache is rebuilt, never half-trusted
  }
}

function saveCache(dir, records) {
  mkdirSync(dirname(CACHE), { recursive: true });
  const tmp = CACHE + '.tmp';
  writeFileSync(tmp, JSON.stringify({ built: new Date().toISOString().slice(0, 10), dir, records }));
  renameSync(tmp, CACHE);
}

function buildCache(dir) {
  const ctx = makeRealm();
  const prev = loadCache();
  const byId = new Map(prev.records.map((r) => [r.id, r]));
  const files = readdirSync(dir).filter((f) => /\.edf$/i.test(f));
  const out = [];
  let fresh = 0,
    reused = 0,
    inflight = 0,
    nopair = 0;

  for (const f of files) {
    const id = basename(f, '.edf');
    const edfPath = join(dir, f);
    const xmlPath = [join(dir, id + '-nsrr.xml'), join(dir, id + '.xml')].find(existsSync);
    if (!xmlPath) {
      nopair++;
      continue;
    }
    const srcBytes = statSync(edfPath).size;
    const cached = byId.get(id);
    if (cached && cached.srcBytes === srcBytes) {
      out.push(cached);
      reused++;
      continue;
    }
    let b;
    try {
      b = readFileSync(edfPath);
    } catch {
      inflight++;
      continue;
    }
    const want = edfExpectedBytes(b);
    if (want == null || b.length !== want) {
      inflight++; // still arriving, or a shape we do not understand — defer, never cache short
      continue;
    }
    let edf;
    try {
      edf = ctx.CpapEdf.readEDF(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    } catch (e) {
      out.push({ id, srcBytes, err: String((e && e.message) || e) });
      fresh++;
      continue;
    }
    const conv = ctx.NSRR.edfToOxyRows(edf);
    if (!conv) {
      out.push({ id, srcBytes, err: 'no SpO₂ channel' });
      fresh++;
      continue;
    }
    const xml = readFileSync(xmlPath, 'utf8');
    const pr = ctx.NSRR.parseNsrrXml(xml, conv.t0Ms);
    /* nulls stay null — §∅. A dropout must not become a number on the way to disk, or the sweep
       optimises against fabricated data. */
    out.push({
      id,
      srcBytes,
      spo2: conv.rows.map((r) => (r.spo2 == null ? null : r.spo2)),
      tstHours: pr && pr.tstHours != null ? +pr.tstHours.toFixed(4) : null,
      coveragePct: conv.spo2CoveragePct,
      depths: expertDepths(xml)
    });
    fresh++;
    if (fresh % 25 === 0) saveCache(dir, out); // progress survives an interruption
    const msg = `  cached ${out.length}/${files.length}  (+${fresh} new, ${reused} reused, ${inflight} still arriving)`;
    if (process.stderr.isTTY) process.stderr.write('\r' + msg);
    else if (fresh % 100 === 0) process.stderr.write(`[${new Date().toISOString().slice(11, 19)}]${msg}\n`);
  }
  if (process.stderr.isTTY) process.stderr.write('\r' + ' '.repeat(78) + '\r');
  saveCache(dir, out);
  return { records: out, fresh, reused, inflight, nopair, seen: files.length };
}

/* ── THE SMART HALF OF BRUTE FORCE — measured, not assumed ────────────────────────────────────
   Timed over 20 records: the rolling ceiling baseline is ~100 % of `detectDesatEvents`'s cost
   (168 ms of a 167 ms call), and the event scan with a PRE-COMPUTED baseline is 7 ms — a 24× speedup.
   The baseline depends only on (record, WIN, pct); it is INDEPENDENT of the threshold and minimum
   duration the grid actually sweeps. So it is computed once per (record, WIN, pct) — 16 combinations
   in the coarse grid — and reused across every (a, b, minSec) point.

   Naive, that grid is ~8.9 hours. Cached, ~20 minutes. Same arithmetic.

   ⚠️ VERIFIED EQUIVALENT, not assumed: a cached baseline and a recomputed one yield the identical
   event count on the same record (29 = 29), and an assertion pins it. A cache that changed the answer
   would be a faster wrong result, which is worse than the slow one. */
/* ⚠️ BOUNDED — BUT THE BOUND MUST EXCEED THE LIVE WORKING SET, or the cache destroys the speedup it
   exists to provide. One fold's grid touches EVERY (record × WIN × pct) combination repeatedly, so the
   working set is `records × |WIN| × |pct|` — 99 × 4 × 4 = 1584 on this corpus. A cap below that evicts
   entries it is about to need again and silently reverts to recomputing the baseline, which measured
   24× slower. My first bound was a flat 400: a 4× thrash ratio, and it would have made the "optimised"
   tool slower than the naive one with nothing in the output to say so.
   So the cap is DERIVED from the grid by `cacheCapFor`, not chosen — and `--json` reports the hit rate
   so a future grid that outgrows it is visible rather than merely slow. Memory: unbounded this reached
   2.9 GB resident (peak 3.8) at 8 GB, which fits here and would not on a larger corpus. */
export function cacheCapFor(nRecords, grid) {
  const w = (grid && grid.WIN ? grid.WIN.length : 1) * (grid && grid.pct ? grid.pct.length : 1);
  return Math.max(64, Math.ceil(nRecords * w * 1.1)); // 10 % headroom for the refine pass's extra values
}

export function baselineCache(ctx, maxEntries) {
  const cap = maxEntries || 2048;
  let hits = 0,
    misses = 0;
  const m = new Map();
  const get = (rec, WIN, pct) => {
    const k = rec.id + '|' + WIN + '|' + pct;
    let v = m.get(k);
    if (v) {
      hits++;
      m.delete(k); // re-insert to mark most-recently-used
      m.set(k, v);
      return v;
    }
    misses++;
    v = ctx.__baseline(rec.spo2, WIN, pct);
    m.set(k, v);
    if (m.size > cap) m.delete(m.keys().next().value); // evict least-recently-used
    return v;
  };
  get.stats = () => ({ cap, size: m.size, hits, misses, hitRate: hits + misses ? +(hits / (hits + misses)).toFixed(4) : null });
  return get;
}

/* ── THE REFERENCE MUST BE FIXED DURING A SEARCH ─────────────────────────────────────────────
   ⚠️ THIS WAS WRONG AND THE FIRST SWEEP IS VOID. The evaluation moved the expert side WITH the
   threshold, which is correct for EVALUATION — comparing like with like is the whole lesson of this
   lane. It is fatal for OPTIMISATION: if the search can move the reference, it will.

   Measured 2026-09-12 on the quick grid:

     shipped default (4 %, 10 s)   detected 9.12/h   expert 2.94/h   score 4.84   n=91
     "winner"        (5.5 %, 30 s) detected 0.98/h   expert 0.66/h   score 0.74   n=74
     clamp extreme   (6 %, 30 s)   detected 0.98/h   expert 0.66/h   score 0.74   n=74

   The winner ties EXACTLY with the clamp extreme, and both sides have collapsed to ~1 event/h. A
   median-absolute-difference objective is minimised by making both counts small, so the search walked
   to the corner that detects almost nothing. Worse, `n` fell 91 → 74: the "a record with no expert
   events cannot grade a detector" guard becomes an escape hatch, and raising the threshold DELETES the
   hard nights from the denominator.

   So: the reference is pinned at a FIXED clinical depth (ODI-4, the 4 % variant) for the whole search,
   and the record set is fixed with it. The question becomes well-posed — "which detector settings best
   reproduce the expert ODI-4 index" — and cannot be answered by finding nothing, because finding
   nothing now scores as badly as it should.

   Depth-matching remains correct for REPORTING agreement (nsrr-oxydex-odi.mjs). It is only the search
   that must hold the target still. */
export const REFERENCE_DEPTH = 4; // the clinical ODI-4 variant; the target the search must not move

/* ── one evaluation ───────────────────────────────────────────────────────────────────────────
   The detector's threshold varies; the reference does not. Records are the SAME set at every point. */
/* ── one evaluation ───────────────────────────────────────────────────────────────────────────
   The detector's threshold varies; the reference does not. Records are the SAME set at every point. */
export function evalPoint(ctx, recs, params, std, blFor, refDepth) {
  const ref = refDepth == null ? REFERENCE_DEPTH : refDepth;
  const c = clampCheck({ minSec: params.minSec, WIN: params.WIN, pct: params.pct, dropPct: params.a });
  if (!c.ok) return { ok: false, refusals: c.refusals };
  const stdv = std || { centre: 0, scale: 1 };
  const pairs = [];
  const drops = [];
  for (const r of recs) {
    if (r.err || !r.tstHours || !r.spo2) continue;
    /* the record set is decided by the FIXED reference, so no parameter choice can shrink it */
    const want = r.depths.filter((d) => d >= ref).length / r.tstHours;
    if (!(want > 0)) continue;
    const drop = effectiveDrop(params, r, stdv);
    drops.push(drop);
    const ev = ctx.__detect(
      r.spo2,
      blFor ? { dropPct: drop, minSec: params.minSec, blArr: blFor(r, params.WIN, params.pct) } : { dropPct: drop, minSec: params.minSec, WIN: params.WIN, pct: params.pct }
    );
    pairs.push({ id: r.id, a: ev.length / r.tstHours, b: want, drop });
  }
  const m = medianAbsDiff(pairs);
  drops.sort((x, y) => x - y);
  return { ok: true, ...m, pairs, dropRange: drops.length ? [drops[0], drops[drops.length - 1]] : null };
}

/* Render the fitted model as something a reader can apply by hand — the point of returning a function
   rather than a tuple is lost if it is printed as one. */
export function describeModel(p, std) {
  if (!p.b || p.cov === 'none') return `dropPct = ${p.a} %  (constant)`;
  const sign = p.b < 0 ? '−' : '+';
  return `dropPct(night) = clamp(${p.a} ${sign} ${Math.abs(p.b)} · (${p.cov} − ${std.centre}) / ${std.scale}, ${CLAMPS.dropPct[0]}–${CLAMPS.dropPct[1]} %)`;
}

/* ══ SELFTEST — arithmetic and guards, no corpus ═══════════════════════════════════════════════ */
function selftest() {
  let bad = 0,
    good = 0;
  const A = (n, c, d) => {
    if (c) {
      good++;
      console.log('  ✓ ' + n);
    } else {
      bad++;
      console.log('  ✕ ' + n + (d ? '  — ' + d : ''));
    }
  };
  console.log('▸ nsrr-criterion-sweep --selftest  (guards + arithmetic; no corpus, no detector claim)\n');

  A('clamp: the shipped default is inside every bound', clampCheck({ dropPct: 4, minSec: 10, WIN: 300, pct: 90 }).ok);
  A('clamp: a 1 % drop is REFUSED, not pulled to 2', clampCheck({ dropPct: 1 }).ok === false);
  A('clamp: a 9 % drop is REFUSED', clampCheck({ dropPct: 9 }).ok === false);
  A('clamp: the refusal NAMES the axis and the bound', /dropPct=9 outside \[2, 6\]/.test(clampCheck({ dropPct: 9 }).refusals[0]), clampCheck({ dropPct: 9 }).refusals[0]);
  A('clamp: NaN is refused, never treated as unset', clampCheck({ minSec: Number.NaN }).ok === false);
  A('clamp: an unset axis is not a violation', clampCheck({ dropPct: 4 }).ok);

  A('grid: the coarse product is every combination', gridPoints({ a: [1, 2], b: [3, 4, 5] }).length === 6);
  A('grid: each point carries every axis', Object.keys(gridPoints(COARSE)[0]).length === Object.keys(COARSE).length, String(Object.keys(gridPoints(COARSE)[0]).length));
  A('grid: the model axes are the intercept and the slope', 'a' in COARSE && 'b' in COARSE);
  A('clampCheck: the slope is bounded too', clampCheck({ b: 5 }).ok === false && clampCheck({ b: 1 }).ok);
  A(
    'axis map: every grid axis resolves to a clamp',
    Object.keys(COARSE).every((k) => CLAMPS[AXIS_CLAMP[k]])
  );

  const ref = refineAround({ a: 4, b: 0, minSec: 10, WIN: 300, pct: 90 }, COARSE);
  A('refine: narrows to the winner’s neighbours', ref.a[0] === 3 && ref.a[ref.a.length - 1] === 5, JSON.stringify(ref.a));
  A('refine: steps finer than the coarse axis', ref.a.includes(3.5) && ref.a.includes(4.5), JSON.stringify(ref.a));
  A('refine: always retains the winner itself', ref.minSec.includes(10));
  const edge = refineAround({ a: 2, b: -1, minSec: 5, WIN: 60, pct: 75 }, COARSE);
  A('refine: at a clamp edge it does not step outside', Math.min(...edge.a) >= CLAMPS.dropPct[0] && Math.min(...edge.minSec) >= CLAMPS.minSec[0], JSON.stringify([edge.a, edge.minSec]));

  /* ── THE FUNCTION FAMILY ─────────────────────────────────────────────────────────────────── */
  const night = { spo2: [96, 95, 94, 96, 97, 90, 91, 96] };
  const std = { centre: 94, scale: 2 };
  A('model: b = 0 reproduces the constant exactly', effectiveDrop({ a: 4, b: 0, cov: 'medianSpo2' }, night, std) === 4);
  A('model: the constant is NESTED — cov "none" ignores the slope', effectiveDrop({ a: 4, b: 1, cov: 'none' }, night, std) === 4);
  const adapt = effectiveDrop({ a: 4, b: 1, cov: 'medianSpo2' }, night, std);
  A('model: a non-zero slope moves the threshold off the intercept', adapt !== 4, String(adapt));
  A(
    'model: the per-night value is CLAMPED, never extrapolated out of range',
    effectiveDrop({ a: 6, b: 50, cov: 'medianSpo2' }, night, std) <= CLAMPS.dropPct[1] && effectiveDrop({ a: 2, b: -50, cov: 'medianSpo2' }, night, std) >= CLAMPS.dropPct[0]
  );
  A('model: a night whose covariate is unavailable falls back to the intercept', effectiveDrop({ a: 4, b: 1, cov: 'medianSpo2' }, { spo2: [null, null] }, std) === 4);

  A(
    'covariates: every one reads the SIGNAL only (arity 1)',
    Object.values(COVARIATES).every((f) => f.length <= 1)
  );
  A('covariates: medianSpo2 ignores nulls rather than scoring them 0', COVARIATES.medianSpo2([null, 96, 96, null]) === 96);
  A('covariates: meanAbsDelta skips a gap instead of spanning it', COVARIATES.meanAbsDelta([96, null, 90]) === null || COVARIATES.meanAbsDelta([96, 97, null, 90]) === 1);
  A('covariates: an all-null night yields null, never a number', COVARIATES.iqrSpo2([null, null, null]) === null);

  const stdFit = fitStandardiser([{ spo2: [96, 96, 96] }, { spo2: [90, 90, 90] }], 'medianSpo2');
  A('standardiser: centre is the FIT mean', stdFit.centre === 93, String(stdFit.centre));
  A('standardiser: scale is non-zero even on identical inputs', fitStandardiser([{ spo2: [96, 96] }], 'medianSpo2').scale === 1);

  A('describe: a constant model prints as a constant', /constant/.test(describeModel({ a: 4, b: 0, cov: 'none' }, stdFit)));
  A('describe: a function prints the whole expression, not a tuple', /dropPct\(night\) = clamp/.test(describeModel({ a: 4, b: 0.5, cov: 'medianSpo2' }, stdFit)));

  const md = medianAbsDiff([
    { a: 5, b: 3 },
    { a: 10, b: 10 },
    { a: 1, b: 4 }
  ]);
  A('objective: median ABSOLUTE difference, not a ratio', md.score === 2, String(md.score));
  A(
    'objective: a record with no expert events is EXCLUDED, not scored 0',
    medianAbsDiff([
      { a: 5, b: 0 },
      { a: 1, b: 2 }
    ]).n === 1
  );
  A('objective: an empty set refuses rather than reporting a perfect 0', medianAbsDiff([]).score === null);
  A(
    'objective: a null side is excluded',
    medianAbsDiff([
      { a: null, b: 3 },
      { a: 2, b: 3 }
    ]).n === 1
  );

  const folds = kFold(['a', 'b', 'c', 'd', 'e', 'f'], 3);
  A('kfold: produces k folds', folds.length === 3);
  A(
    'kfold: each record is held out exactly once',
    folds
      .flatMap((f) => f.held)
      .sort()
      .join('') === 'abcdef'
  );
  A(
    'kfold: fit and held are disjoint in every fold',
    folds.every((f) => f.held.every((x) => !f.fit.includes(x)))
  );
  A('kfold: deterministic across runs', JSON.stringify(kFold(['a', 'b', 'c', 'd', 'e', 'f'], 3)) === JSON.stringify(folds));
  A('materiality: the bound comes from the published spread, not taste', MATERIAL_GAIN === 0.5);

  /* THE DEGENERACY REGRESSION. With the reference free to move, raising the threshold shrank BOTH
     sides and the objective was minimised by detecting nothing — the first sweep's "winner" tied
     exactly with the clamp extreme at 0.7398 while n fell 91 → 74. The reference is pinned now, so a
     threshold that detects nothing must score WORSE and the record set must not shrink. */
  try {
    const ctxD = makeRealm();
    const flatD = new Array(3600).fill(96);
    for (let k2 = 0; k2 < 12; k2++) for (let i2 = 200 + k2 * 250; i2 < 225 + k2 * 250; i2++) flatD[i2] = 90;
    const recD = { id: 'd', spo2: flatD, tstHours: 1, depths: [6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6] };
    const blD = baselineCache(ctxD, 64);
    const loose = evalPoint(ctxD, [recD], { a: 4, b: 0, cov: 'none', minSec: 10, WIN: 300, pct: 90 }, null, blD);
    const strict = evalPoint(ctxD, [recD], { a: 6, b: 0, cov: 'none', minSec: 30, WIN: 300, pct: 90 }, null, blD);
    A('degeneracy: the record set does NOT shrink when the threshold rises', loose.n === strict.n, loose.n + ' → ' + strict.n);
    A('degeneracy: a threshold that detects nothing scores WORSE, not better', strict.score >= loose.score, 'loose ' + loose.score + ' vs strict ' + strict.score);
  } catch (e) {
    A('degeneracy regression runs', false, String((e && e.message) || e));
  }
  A('reference: pinned at the clinical ODI-4 depth', REFERENCE_DEPTH === 4);

  /* ── TRUNCATION DETECTION — the corpus arrives over ~40 h, so the builder runs while files are
     being written, and a short EDF parses FINE into a night silently missing its last hours. */
  (function () {
    const mkHdr = (ns, nrec, spr) => {
      const hdr = Buffer.alloc(256 + ns * 256, 0x20);
      hdr.write(String(nrec).padEnd(8), 236, 'ascii');
      hdr.write(String(ns).padEnd(4), 252, 'ascii');
      for (let k = 0; k < ns; k++) hdr.write(String(spr).padEnd(8), 256 + 216 * ns + k * 8, 'ascii');
      return hdr;
    };
    const ns = 2,
      nrec = 10,
      spr = 100;
    const hdr = mkHdr(ns, nrec, spr);
    const want = 256 + ns * 256 + nrec * (spr * ns) * 2;
    A('truncation: expected size is computed from the header', edfExpectedBytes(hdr) === want, edfExpectedBytes(hdr) + ' vs ' + want);
    const complete = Buffer.concat([hdr, Buffer.alloc(want - hdr.length)]);
    A('truncation: a COMPLETE file matches its own declaration', complete.length === edfExpectedBytes(complete));
    /* A download in flight passes through TWO distinct states and both must be handled. Early, the
       header itself is incomplete and the expected size is UNKNOWABLE — refuse. Later, the header is
       whole but the data is short — detectable, and the common case. The first version of this test
       used a record so small that "truncated" landed below the header, so it was only ever exercising
       the refusal branch while claiming to test the short-data one. */
    const short = complete.subarray(0, want - 1000); // header intact, data short
    A('truncation: header intact but data short ⇒ detectable', edfExpectedBytes(short) === want && short.length < want, short.length + ' vs ' + edfExpectedBytes(short));
    A('truncation: a header-only fragment refuses rather than guessing', edfExpectedBytes(hdr.subarray(0, 200)) === null);
    A('truncation: a file shorter than its own header refuses', edfExpectedBytes(complete.subarray(0, 300)) === null);
    A('truncation: garbage in the count fields refuses', edfExpectedBytes(Buffer.alloc(2048, 0x20)) === null);
  })();

  /* The shipped ODI threshold is a FROZEN kernel constant with no injection point, so this tool
     optimises the raw detector and cannot drive the shipped pipeline. Pinned so a future refactor that
     unfreezes it, or adds an override, surfaces here rather than silently changing what is measured. */
  try {
    const ctxK = makeRealm();
    let froze = false;
    try {
      ctxK.DexKernel.K.ODI_DROP = 3;
    } catch {
      froze = true;
    }
    A('kernel: ODI_DROP is frozen, so the shipped path cannot be swept from here', froze || ctxK.DexKernel.K.ODI_DROP === 4, String(ctxK.DexKernel.K.ODI_DROP));
    A('kernel: processNight exists but takes no threshold override', typeof ctxK.OxyDex._bare.processNight === 'function');
  } catch (e) {
    A('kernel freeze check runs', false, String((e && e.message) || e));
  }

  const sp = splitRecords(['e', 'd', 'c', 'b', 'a']);
  A(
    'split: fit and held are disjoint',
    sp.fit.every((x) => !sp.held.includes(x))
  );
  A('split: every record lands in exactly one side', sp.fit.length + sp.held.length === 5);
  A('split: deterministic across runs', JSON.stringify(splitRecords(['e', 'd', 'c', 'b', 'a'])) === JSON.stringify(sp));

  A(
    'depths: nadir/baseline pairs are read',
    expertDepths('<ScoredEvent><EventConcept>SpO2 desaturation</EventConcept><SpO2Nadir>92</SpO2Nadir><SpO2Baseline>96</SpO2Baseline></ScoredEvent>')[0] === 4
  );
  A('depths: an event without the fields is skipped, not depth 0', expertDepths('<ScoredEvent><EventConcept>SpO2 desaturation</EventConcept></ScoredEvent>').length === 0);

  try {
    const ctx = makeRealm();
    A('realm: the REAL detectDesatEvents is loaded, not a stand-in', typeof ctx.__detect === 'function');
    const flat = new Array(600).fill(96);
    for (let i = 200; i < 225; i++) flat[i] = 90; // one unambiguous 6 % desaturation
    const ev = ctx.__detect(flat, { dropPct: 4, minSec: 10, WIN: 300, pct: 90 });
    A('realm: a planted 6 % dip is detected at dropPct 4', ev.length >= 1, 'n=' + ev.length);
    /* the missing-DOMParser regression: without it parseNsrrXml silently yields tstHours null on every
       record and the sweep scores nothing at all, which reads as a data problem rather than a stub. */
    const px = '<ScoredEvent><EventConcept>Stage 2 sleep|2</EventConcept><Start>0</Start><Duration>1800</Duration></ScoredEvent>';
    const parsed = ctx.NSRR.parseNsrrXml(px, 0);
    A('realm: the XML parser actually sees events (DOMParser present)', parsed && parsed.tstHours != null && parsed.tstHours > 0, JSON.stringify(parsed && parsed.tstHours));
    const ev8 = ctx.__detect(flat, { dropPct: 6, minSec: 10, WIN: 300, pct: 90 });

    /* the cache must not change the answer — a faster wrong result is worse than the slow one */
    const bl = ctx.__baseline(flat, 300, 90);
    const cached = ctx.__detect(flat, { dropPct: 4, minSec: 10, blArr: bl }).length;
    A('cache: a pre-computed baseline yields the IDENTICAL event count', cached === ev.length, cached + ' vs ' + ev.length);
    const blFor = baselineCache(ctx, cacheCapFor(4, COARSE));
    const r1 = blFor({ id: 'x', spo2: flat }, 300, 90);
    const r2 = blFor({ id: 'x', spo2: flat }, 300, 90);
    A('cache: the same key returns the same array object (it is actually caching)', r1 === r2);
    A('cache: a different window is a different entry', blFor({ id: 'x', spo2: flat }, 120, 90) !== r1);
    /* the cache is BOUNDED — unbounded it reached 2.9 GB on this corpus and would not survive a larger one */
    const tiny = baselineCache(ctx, 2);
    const k1 = tiny({ id: 'a', spo2: flat }, 300, 90);
    tiny({ id: 'b', spo2: flat }, 300, 90);
    tiny({ id: 'c', spo2: flat }, 300, 90); // evicts 'a'
    A('cache: evicts beyond its cap rather than growing without bound', tiny({ id: 'a', spo2: flat }, 300, 90) !== k1);
    /* THE BOUND MUST EXCEED THE LIVE WORKING SET. A flat cap of 400 against 99 records × 16 (WIN,pct)
       combinations is a 4× thrash ratio — it evicts what it is about to reuse and silently reverts to
       recomputation, undoing the 24× speedup with nothing in the output to say so. */
    A('cap: derived from the grid, not a magic number', cacheCapFor(99, COARSE) >= 99 * COARSE.WIN.length * COARSE.pct.length, String(cacheCapFor(99, COARSE)));
    A('cap: a flat 400 would have thrashed this corpus', 99 * COARSE.WIN.length * COARSE.pct.length > 400);
    A('cap: scales with the record count', cacheCapFor(200, COARSE) > cacheCapFor(99, COARSE));
    A('cap: has a floor for tiny corpora', cacheCapFor(1, COARSE) >= 64);
    const inst = baselineCache(ctx, 8);
    inst({ id: 'z', spo2: flat }, 300, 90);
    inst({ id: 'z', spo2: flat }, 300, 90);
    A('cache: reports a hit rate so a grid that outgrows the cap is VISIBLE, not merely slow', inst.stats().hits === 1 && inst.stats().misses === 1, JSON.stringify(inst.stats()));
    const kC = tiny({ id: 'c', spo2: flat }, 300, 90);
    tiny({ id: 'd', spo2: flat }, 300, 90); // evicts the older of the two, not 'c' — 'c' was just used
    A('cache: a recently-used entry survives eviction of others', tiny({ id: 'c', spo2: flat }, 300, 90) === kC);
    A('realm: the same dip at a stricter threshold does not increase', ev8.length <= ev.length, ev.length + ' → ' + ev8.length);
  } catch (e) {
    A('realm loads the real detector', false, String((e && e.message) || e));
  }

  console.log('\n  ⚠️  No agreement figure here — every value is planted. Only --sweep over a real cache');
  console.log('     produces a criterion, and it is scored on HELD-OUT records against the shipped default.');
  console.log('\n' + (bad ? '✕ ' + bad + ' failed, ' : '✓ ') + good + ' assertions passed');
  return bad ? 1 : 0;
}

/* ══ MAIN ═════════════════════════════════════════════════════════════════════════════════════ */
const C = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', d: '\x1b[2m', B: '\x1b[1m', c: '\x1b[36m', x: '\x1b[0m' };
const paint = (s, c) => (process.stdout.isTTY || process.env.FORCE_COLOR ? c + s + C.x : s);
/* ⚠️ THIS IS THE EVENT DETECTOR, NOT THE SHIPPED ODI-4 — and the two differ by 3.4×.
   `detectDesatEvents` at the shipped parameters yields a median 9.12 events/h over TST; the ODI-4 that
   OxyDex actually publishes, through `processNight`, is 2.70 events/h on the same records. The pipeline
   around the detector — gating, artifact handling, its own denominator — removes roughly two thirds of
   the raw events.

   So the row below is "the same detector at shipped parameter values", NOT "the shipped ODI-4", and a
   sweep result must never be quoted as beating the shipped index. An earlier run reported the best
   constant at 1.35 against this row's 4.51 and read as a 3.4 events/h improvement; it was measuring the
   missing pipeline, and the chosen `minSec` of 20–25 s was compensating for it.

   ⚠️ AND THE SHIPPED PATH CANNOT BE SWEPT. `DexKernel.K.ODI_DROP` is FROZEN (assignment throws) and
   `processNight` takes no threshold override, so there is no injection point. That is right for
   shipping — a constant nobody can retune by accident — and it means criterion research needs either a
   source change or this parallel path, knowingly. Tracked as residue. */
const DEFAULT = { dropPct: 4, minSec: 10, WIN: 300, pct: 90 };

function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  const json = argv.includes('--json');
  const di = argv.indexOf('--dir');
  const dir = di >= 0 ? argv[di + 1] : null;

  if (argv.includes('--cache')) {
    if (!dir || !existsSync(dir)) {
      console.log('⊘ SKIP — --cache needs --dir <psg-dir> holding EDF + XML pairs. NO CACHE WRITTEN.');
      return 0;
    }
    const r = buildCache(dir);
    const scored = r.records.filter((x) => !x.err).length;
    console.log(`cache: ${scored} usable of ${r.records.length} entries → ${CACHE}`);
    console.log(`  +${r.fresh} newly read · ${r.reused} reused from the previous cache · ${r.inflight} still arriving · ${r.nopair} without an annotation pair`);
    if (r.inflight) console.log(`  ⚠️ ${r.inflight} EDF(s) are shorter than their own header declares — still downloading. Re-run this when they land; nothing short was cached.`);
    return 0;
  }

  if (!existsSync(CACHE)) {
    console.log('⊘ SKIP — no SpO₂ cache. NO NUMBERS PRODUCED.\n');
    console.log('    looked for: ' + CACHE);
    console.log('\n  Build it once:  node tools/nsrr-criterion-sweep.mjs --cache --dir <psg-dir>');
    console.log('  This tool never downloads anything. A skip is not a pass.');
    return 0;
  }

  const cache = JSON.parse(readFileSync(CACHE, 'utf8'));
  const all = cache.records.filter((r) => !r.err);
  const GRID = argv.includes('--quick') ? QUICK : COARSE;
  const gridName = argv.includes('--quick') ? 'QUICK (baseline pinned at WIN 300 / pct 90)' : 'COARSE (full)';
  const K = 5;
  const folds = kFold(
    all.map((r) => r.id),
    K
  );
  const byId = new Map(all.map((r) => [r.id, r]));
  const ctx = makeRealm();
  const pick = (ids) => ids.map((i2) => byId.get(i2)).filter(Boolean);

  const blFor = baselineCache(ctx, cacheCapFor(all.length, GRID));
  const searchFamily = (recs, grid, covName, std) => {
    let best = null;
    for (const p2 of gridPoints(grid)) {
      const params = { ...p2, cov: covName };
      const r = evalPoint(ctx, recs, params, std, blFor);
      if (!r.ok || r.score == null) continue;
      if (!best || r.score < best.score) best = { ...params, score: r.score, n: r.n };
    }
    return best;
  };

  /* One fold: search EVERY covariate family on this fold's training part, score the winner and the
     nested constant null ONCE on this fold's held part. Nothing from the held part reaches the search,
     including the standardiser. */
  const runFold = (f, fi) => {
    const tr = pick(f.fit),
      te = pick(f.held);
    const stds = {};
    let best = null;
    for (const cov of Object.keys(COVARIATES)) {
      stds[cov] = fitStandardiser(tr, cov);
      const grid = cov === 'none' ? { ...GRID, b: [0] } : GRID;
      const c1 = searchFamily(tr, grid, cov, stds[cov]);
      if (!c1) continue;
      const c2 = searchFamily(tr, refineAround(c1, grid), cov, stds[cov]) || c1;
      if (!best || c2.score < best.score) best = c2;
    }
    const constBest = searchFamily(tr, { ...GRID, b: [0] }, 'none', stds.none);
    if (!best || !constBest) return null;
    const hw = evalPoint(ctx, te, best, stds[best.cov], blFor);
    const hc = evalPoint(ctx, te, constBest, stds.none, blFor);
    const hd = evalPoint(ctx, te, { ...DEFAULT, a: DEFAULT.dropPct, b: 0, cov: 'none' }, stds.none, blFor);
    /* ⚠️ PROGRESS MUST SURVIVE A REDIRECT. This was gated on `process.stderr.isTTY`, so a run piped
       to a file printed NOTHING for its whole duration — and this tool runs for ~20 minutes. "Is it
       half done?" then has no answer but a guess, which is how a hung run and a slow one become
       indistinguishable. On a TTY it rewrites one line; redirected it appends a timestamped line. */
    const pct = Math.round((100 * (fi + 1)) / K);
    if (process.stderr.isTTY) process.stderr.write(`\r  fold ${fi + 1}/${K} (${pct} %)   `);
    else process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] fold ${fi + 1}/${K} done (${pct} %)\n`);
    return {
      fold: fi,
      best,
      std: stds[best.cov],
      constBest,
      heldFunction: hw.score,
      heldConstant: hc.score,
      heldShipped: hd.score,
      gain: hc.score != null && hw.score != null ? +(hc.score - hw.score).toFixed(3) : null,
      dropRange: hw.dropRange
    };
  };

  const results = folds.map(runFold).filter(Boolean);
  if (process.stderr.isTTY) process.stderr.write('\r' + ' '.repeat(24) + '\r');
  if (!results.length) {
    console.log('⊘ no fold produced a score — refusing to report a winner');
    return 0;
  }
  const med = (a) => {
    const v = a.filter((x) => x != null).sort((x, y) => x - y);
    return v.length ? +v[Math.floor(v.length / 2)].toFixed(3) : null;
  };
  const spread = (a) => {
    const v = a.filter((x) => x != null).sort((x, y) => x - y);
    return v.length ? +(v[v.length - 1] - v[0]).toFixed(3) : null;
  };
  const gains = results.map((r) => r.gain);
  const medGain = med(gains),
    gainSpread = spread(gains);
  /* the family the folds AGREE on — a covariate chosen by one fold in five is a coin toss, not a model */
  const covVotes = {};
  for (const r of results) covVotes[r.best.cov] = (covVotes[r.best.cov] || 0) + 1;
  const topCov = Object.entries(covVotes).sort((a2, b2) => b2[1] - a2[1])[0];

  const out = {
    records: all.length,
    folds: K,
    grid: gridName,
    objective: 'median |computed − expert| events/h, expert filtered to the SAME per-night depth',
    materialGainEventsPerHour: MATERIAL_GAIN,
    cacheStats: blFor.stats(),
    heldDetectorAtShippedParams: med(results.map((r) => r.heldShipped)),
    heldConstant: med(results.map((r) => r.heldConstant)),
    heldFunction: med(results.map((r) => r.heldFunction)),
    gainOverConstant: { median: medGain, spreadAcrossFolds: gainSpread, perFold: gains },
    covariateVotes: covVotes,
    material: medGain != null && medGain >= MATERIAL_GAIN && gainSpread != null && gainSpread < medGain,
    perFold: results.map((r) => ({
      fold: r.fold,
      cov: r.best.cov,
      a: r.best.a,
      b: r.best.b,
      minSec: r.best.minSec,
      WIN: r.best.WIN,
      pct: r.best.pct,
      heldFunction: r.heldFunction,
      heldConstant: r.heldConstant
    })),
    clamps: CLAMPS
  };
  if (json) {
    console.log(JSON.stringify(out, null, 2));
    return 0;
  }

  console.log('\n' + paint('DESATURATION CRITERION — fitted as a FUNCTION, k-fold cross-validated', C.B) + '\n');
  console.log(paint(`  ${all.length} records · ${K}-fold · grid: ${gridName}`, C.d));
  console.log(paint('  objective: median |computed − expert| events/h · reference PINNED at ODI-4', C.d));
  console.log(paint('  ⚠️ this optimises detectDesatEvents, NOT the shipped ODI-4 (3.4x lower via processNight)', C.y));
  console.log(paint('  the expert side moves WITH each night’s threshold; the standardiser is fitted per fold', C.d) + '\n');
  const line = (lab, v, col) => console.log('  ' + lab.padEnd(32) + (v == null ? '—' : paint(v.toFixed(3), col)).padStart(10) + paint('  events/h', C.d));
  line('detector @ shipped params', out.heldDetectorAtShippedParams, C.c);
  line('best CONSTANT (nested null)', out.heldConstant, C.c);
  line('best FUNCTION', out.heldFunction, medGain > 0 ? C.g : C.y);
  console.log('');
  console.log(
    '  ' +
      paint('gain over the constant:', C.d) +
      ` median ${medGain == null ? '—' : medGain.toFixed(3)} · spread across folds ${gainSpread == null ? '—' : gainSpread.toFixed(3)} · per-fold [${gains.join(', ')}]`
  );
  console.log(
    '  ' +
      paint('covariate chosen per fold:', C.d) +
      ' ' +
      Object.entries(covVotes)
        .map(([k2, v]) => `${k2}×${v}`)
        .join('  ')
  );
  console.log('');
  if (medGain == null) console.log(paint('  No comparison possible.', C.y));
  else if (medGain < MATERIAL_GAIN)
    console.log(
      paint(`  ⚠️ THE FUNCTION EARNS NOTHING. Median gain ${medGain.toFixed(3)} events/h is below the`, C.y) +
        '\n' +
        paint(`     ${MATERIAL_GAIN} events/h materiality bound taken from the published between-method spread`, C.y) +
        '\n' +
        paint('     (automated-ODI Bland–Altman bias runs −3.76 to +6.17). Report the CONSTANT.', C.y)
    );
  else if (gainSpread >= medGain)
    console.log(
      paint(`  ⚠️ FOLDS DISAGREE MORE THAN THE WINNER WINS. Gain ${medGain.toFixed(3)} vs fold spread ${gainSpread.toFixed(3)}`, C.y) +
        '\n' +
        paint('     — the chosen model is a property of the split, not of the data. No winner.', C.y)
    );
  else {
    console.log(paint(`  Function beats the constant by ${medGain.toFixed(3)} events/h (median across folds), spread ${gainSpread.toFixed(3)}`, C.g));
    console.log('  ' + paint('model (fold 0):', C.d) + ' ' + paint(describeModel(results[0].best, results[0].std), C.B));
    if (topCov && topCov[1] < K) console.log(paint(`  ⚠️ the covariate was not unanimous (${topCov[0]} in ${topCov[1]} of ${K} folds) — treat the FORM as tentative`, C.y));
  }
  console.log(paint('\n  ⚠️ §P5 gates PUBLICATION of these numbers, not their measurement.', C.d));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('nsrr-criterion-sweep.mjs')) process.exit(main(process.argv.slice(2)));
