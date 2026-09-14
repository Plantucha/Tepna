#!/usr/bin/env node
/*
 * tools/nsrr-oxydex-odi.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═════════════════════════════════════════════════════════════════════════════
 * SCORE OxyDex's ODI-4 → AHI ESTIMATE AGAINST EXPERT-SCORED PSG AHI.
 *
 * The second NSRR arm. `tools/nsrr-stage-validate.mjs` drives the ECG channel into the sleep stager;
 * this one drives the **SaO2** channel into OxyDex and compares its AHI estimate to the AHI a human
 * scorer derived from the full montage.
 *
 * SHHS EDFs carry `SaO2 @ 1 Hz` — the O2Ring's exact modality and sample rate — so this is not a
 * domain-shifted proxy for the shipped oximetry path. It is the same kind of signal.
 *
 * ── EVERYTHING THIS NEEDS ALREADY EXISTED; ONLY THE HEADLESS DRIVER DID NOT ──────────────────
 * `nsrr-adapter.js` converts an EDF to OxyDex rows AND parses the profusion XML into a reference AHI
 * (scored apneas + hypopneas ÷ staged sleep hours) — `NSRR.analyzeRecord`. Its only callers were the
 * browser tools (`odi-bias-analysis.html`), so the pipeline could not be run over a corpus without a
 * person clicking. This file is that driver and nothing more; it reimplements no adapter logic.
 *
 * ── THE PRE-REGISTERED HYPOTHESIS (not invented here — read off the paper) ────────────────────
 * `papers/odi4-ahi-bias.html` characterises a **severity-proportional ODI-4 under-count** and records
 * that it was *"traced to its mechanism and corrected at the detector level"* (v22.36, June 2026).
 * The ODI README calls NSRR PSG *"the publishable lane — real PSG-scored AHI"*, so this run is the
 * first test of that correction against expert scoring rather than against the apparatus that found it.
 *
 * So the question is sharp and falsifiable: **does the correction hold on real PSG, or was it fitted
 * to the population that exposed it?** Bands, registered BEFORE the first run:
 *
 *   SEVERITY GRADIENT — OLS slope of (ahiOxyEst − scoredAHI) on scoredAHI:
 *     |slope| ≤ 0.15   → no material gradient; the detector-level correction generalises.
 *     slope < −0.15    → the under-count SURVIVES on real PSG — the paper's headline result does not
 *                        generalise, and that is a finding about the correction, not about NSRR.
 *     slope > +0.15    → over-correction: the fix overshot on this population.
 *   AGREEMENT — Bland–Altman of the same residual:
 *     |bias| ≤ 5 events/h and 95 % LoA half-width ≤ 15 → usable as a screening estimate.
 *   SEVERITY CLASS — exact agreement on the clinical 4-class split (<5 · 5–15 · 15–30 · ≥30):
 *     ≥ 70 % exact and ≥ 95 % within one class → clinically coherent.
 *
 * ⚠️ A gradient is the informative outcome either way. Do not tune the bands after seeing the slope.
 *
 * ── SCOPE, and what this CANNOT say ──────────────────────────────────────────────────────────
 * ⚠️ CARRY THE DOMAIN SHIFT. SHHS is clinical PSG on an older clinical cohort; the shipped path is a
 * consumer ring on one healthy sleeper. A good number here does not retire the real-night falsifiers,
 * and a bad one does not by itself convict the ring.
 * ⚠️ The reference AHI is itself scorer-derived, with known inter-scorer variance, and the hypopnea
 * rule a cohort used changes AHI materially. This measures agreement with SHHS's scoring, not truth.
 *
 * ── P5 ───────────────────────────────────────────────────────────────────────────────────────
 * `STRATEGIC-PRIORITIES` §P5 gates PUBLICATION of public-benchmark numbers, not their measurement
 * (owner ruling 2026-09-12). Running this and acting on what it finds is permitted; quoting a rate
 * outside the repo is not, until the owner opens that gate.
 *
 * ── NO FETCHING ──────────────────────────────────────────────────────────────────────────────
 * Never downloads anything. Absent records ⇒ an explicit SKIP printing every path searched, and no
 * metrics — an absence spent as a green is CLAUDE.md §4b's failure.
 *
 * USAGE
 *   node tools/nsrr-oxydex-odi.mjs --selftest
 *   node tools/nsrr-oxydex-odi.mjs --dir <psg-dir>            # EDF + XML pairs in one directory
 *   node tools/nsrr-oxydex-odi.mjs --edfs <d> --anns <d>      # the NSRR tree layout, unmodified
 *   node tools/nsrr-oxydex-odi.mjs --edfs <d> --anns <d> --json
 *   node tools/nsrr-oxydex-odi.mjs --dir <psg-dir> --no-cache   # score every record cold
 *
 * INCREMENTAL BY DEFAULT. Per-record scores are cached under `.cache/`, keyed on the record's EDF
 * size AND a fingerprint of the six sources the scoring realm loads — so a re-run costs nothing for
 * what it has already scored, and a change to ANY of those sources discards the cache rather than
 * serving pre-change numbers. Measured on 3 real records: 11.31 s cold, 0.02 s warm, byte-identical
 * output; after touching `oxydex-dsp.js`, 11.08 s again. `--no-cache` opts out entirely.
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join, basename } from 'node:path';
import vm from 'node:vm';

const require_ = createRequire(import.meta.url);
const DexBuild = require_('./build-core.js');
const AnalysisStats = require_('../analysis-stats.js');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const BANDS = {
  slopeAbs: 0.15,
  biasAbs: 5,
  loaHalf: 15,
  classExact: 0.7,
  classWithinOne: 0.95
};

/* Clinical 4-class AHI split. Shared by both arms of the comparison so a disagreement is a real
   disagreement and not two different bin edges. */
export function severityClass(ahi) {
  if (ahi == null || !Number.isFinite(ahi)) return null;
  if (ahi < 5) return 'none';
  if (ahi < 15) return 'mild';
  if (ahi < 30) return 'moderate';
  return 'severe';
}
const CLASS_ORDER = ['none', 'mild', 'moderate', 'severe'];

/* OLS slope + intercept of y on x. Exported so the gate can assert the arithmetic with no corpus. */
export function olsSlope(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return { n, slope: null, intercept: null };
  let sx = 0,
    sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n,
    my = sy / n;
  let num = 0,
    den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) * (xs[i] - mx);
  }
  if (den === 0) return { n, slope: null, intercept: null };
  const slope = num / den;
  return { n, slope, intercept: my - slope * mx };
}

export function verdictSlope(slope) {
  if (slope == null) return 'NO DATA';
  if (Math.abs(slope) <= BANDS.slopeAbs) return 'NO GRADIENT';
  return slope < 0 ? 'UNDER-COUNT SURVIVES' : 'OVER-CORRECTED';
}

/* ── headless realm ───────────────────────────────────────────────────────────────────────────
   `nsrr-adapter.js` needs CpapEdf (the EDF reader, which lives in cpapdex-edf.js and NOT the CPAP
   DSP) and OxyDex's processNight. `clock.js` first: the adapter stamps rows on the floating-ms grid. */
/* THE REALM'S SOURCE SET, hoisted so `makeRealm` and `codeFingerprint` cannot disagree about what
   "the scoring code" is. Two copies of this list would be the drift CLAUDE.md warns about for any
   duplicated threshold, and here it would be worse than drift: a fingerprint computed over a DIFFERENT
   set than the realm actually loads would certify a cache as current while the code that produced it
   had moved. ⚠️ ORDER IS LOAD-BEARING for makeRealm (oxydex-util before oxydex-dsp) and irrelevant to
   the hash, which is why the hash mixes each NAME in beside its bytes rather than relying on order. */
const REALM_SOURCES = ['clock.js', 'kernel-constants.js', 'cpapdex-edf.js', 'oxydex-util.js', 'oxydex-dsp.js', 'nsrr-adapter.js'];

/* A SCORE CACHE MUST BE KEYED ON THE CODE, NOT ONLY ON THE INPUT — this is the half the residue row
   did not name, and without it the cache is a liability rather than a saving. The sibling
   `nsrr-criterion-sweep.mjs --cache` keys on `id` + `srcBytes` alone, and that is CORRECT THERE
   because it caches EXTRACTED SIGNAL (spo2 rows, expert depths), which is a function of the file. This
   tool would be caching SCORES, which are a function of the file AND of `processNight` — so on the
   same key a detector change would silently serve pre-change numbers, with nothing to notice it. That
   is the fabricated-authority shape §🎫 exists to stop, one layer down.
   Same projection idea as the suite's own `computeHash`: hash the closure that can reach the result. */
export function codeFingerprint(read) {
  const h = createHash('sha256');
  for (const f of REALM_SOURCES)
    h.update(f)
      .update('\0')
      .update((read || readFileSync)(join(ROOT, f), 'utf8'));
  return h.digest('hex').slice(0, 12);
}

/* Atomic like the sibling's: write a sibling .tmp and rename, so an interrupted run leaves either the
   previous cache or the new one and never a half-written file a later run would trust. */
const CACHE = join(ROOT, '.cache', 'nsrr-odi-scores.json');
export function loadScoreCache(path) {
  const f = path || CACHE;
  if (!existsSync(f)) return { code: null, records: [] };
  try {
    const c = JSON.parse(readFileSync(f, 'utf8'));
    return c && Array.isArray(c.records) ? c : { code: null, records: [] };
  } catch {
    return { code: null, records: [] }; // a corrupt cache is a cold start, never a hard failure
  }
}
function saveScoreCache(code, records, path) {
  const f = path || CACHE;
  mkdirSync(dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  writeFileSync(tmp, JSON.stringify({ built: new Date().toISOString().slice(0, 10), code, records }));
  renameSync(tmp, f);
}

/* REUSABLE iff the record is the same bytes AND the scoring code is the same. `srcBytes` catches a
   still-arriving or replaced EDF (the sibling's rule, and the reason a size and not an mtime: mtime
   moves on a re-download of identical content and does not move on some copies). `code` catches the
   case that key cannot see. A cache written by different code is not partially valid — every row in
   it was produced by that code — so a fingerprint mismatch discards the WHOLE file rather than
   trying to salvage rows, which is the honest read of what changed. */
export function cacheUsable(entry, srcBytes, cacheCode, code) {
  return !!entry && entry.srcBytes === srcBytes && cacheCode != null && cacheCode === code;
}

export function makeRealm() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.console = console;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.__DEX_NAMESPACED__ = true;
  /* `oxydex-dsp.js` is an app-side module and touches `document` at evaluation time. This stub exists
     ONLY to let it evaluate headlessly — nothing in the ODI path renders. It is deliberately inert
     rather than clever: a stub that pretended to build DOM could let a render-dependent code path
     appear to work and quietly produce a number from nothing. The realm assertion in --selftest
     checks `NSRR.analyzeRecord` is a real function, so a stub that swallowed the module would fail
     rather than pass silently. */
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
    /* `nsrr-adapter.js` snapshots `document.documentElement.outerHTML` at load into `_parserSource`
       (a provenance string for the page that ran it). Headless there is no page, so it reads as the
       empty string — honest, and NOT a fabricated page identity. */
    documentElement: { outerHTML: '' }
  };
  sandbox.navigator = { userAgent: 'node' };
  sandbox.location = { href: 'file:///' };
  sandbox.DOMParser = class {
    parseFromString(text) {
      const blocks = text.match(/<ScoredEvent[\s\S]*?<\/ScoredEvent>/g) || [];
      const pick = (b, tag) => {
        const m = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>').exec(b);
        return m ? m[1] : null;
      };
      const nodes = blocks.map((b) => ({
        querySelector(sel) {
          for (const tag of sel.split(',').map((s) => s.trim())) {
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
          const a = nodes.slice();
          a.forEach = Array.prototype.forEach.bind(a);
          return a;
        }
      };
    }
  };
  const ctx = vm.createContext(sandbox);
  /* ⚠️ `oxydex-util.js` BEFORE `oxydex-dsp.js`, and it is load-bearing: the DSP's `processNight`
     calls `computeCeilingBaselineArr` from it. Omitted, the realm builds and every record fails at
     run time with "computeCeilingBaselineArr is not defined" — loudly, per record, which is the
     behaviour wanted: a missing co-load must not degrade into a night that simply scores nothing. */
  for (const f of REALM_SOURCES) {
    const p = join(ROOT, f);
    if (!existsSync(p)) throw new Error('module not found: ' + f);
    vm.runInContext(DexBuild.classicify(readFileSync(p, 'utf8')), ctx, { filename: f });
  }
  if (!ctx.NSRR) throw new Error('nsrr-oxydex-odi: NSRR adapter did not load');
  if (!ctx.CpapEdf) throw new Error('nsrr-oxydex-odi: CpapEdf did not load');
  return ctx;
}

export function toArrayBuffer(b) {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

/* ── record discovery ─────────────────────────────────────────────────────────────────────────
   Two layouts: one flat directory of pairs, or the NSRR tree with edfs/ and annotations/ apart. The
   XML stem carries a `-nsrr` suffix the EDF does not. */
function pairsFrom(edfDir, annDir) {
  if (!existsSync(edfDir) || !existsSync(annDir)) return [];
  const anns = readdirSync(annDir).filter((f) => /\.xml$/i.test(f));
  const byStem = new Map();
  for (const a of anns)
    byStem.set(
      basename(a)
        .replace(/\.xml$/i, '')
        .replace(/-nsrr$/, ''),
      join(annDir, a)
    );
  const out = [];
  for (const e of readdirSync(edfDir).filter((f) => /\.edf$/i.test(f))) {
    const stem = basename(e).replace(/\.edf$/i, '');
    const x = byStem.get(stem);
    if (x) out.push({ id: stem, edf: join(edfDir, e), xml: x });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function discover(argv) {
  const arg = (f) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : null;
  };
  const searched = [];
  const tryPair = (e, a, why) => {
    searched.push(why + ': ' + e + (a === e ? '' : '  +  ' + a));
    return pairsFrom(e, a);
  };
  const dir = arg('--dir');
  if (dir) {
    const r = tryPair(dir, dir, '--dir');
    if (r.length) return { recs: r, searched };
  }
  const ed = arg('--edfs'),
    an = arg('--anns');
  if (ed && an) {
    const r = tryPair(ed, an, '--edfs/--anns');
    if (r.length) return { recs: r, searched };
  }
  const env = process.env.DEX_NSRR;
  const roots = [];
  if (env) roots.push(env);
  roots.push('/srv/data/shhs/polysomnography', join(ROOT, 'uploads', 'nsrr'));
  for (const base of roots)
    for (const cohort of ['shhs1', 'shhs2', '']) {
      const e = join(base, 'edfs', cohort),
        a = join(base, 'annotations-events-nsrr', cohort);
      const r = tryPair(e, a, 'tree');
      if (r.length) return { recs: r, searched };
    }
  return { recs: [], searched };
}

/* ── one record ──────────────────────────────────────────────────────────────────────────────
   Everything here is `NSRR.analyzeRecord`; this function only reads bytes and normalises the row. */
/* ── THE UNCONFOUNDED COMPARISON ──────────────────────────────────────────────────────────────
   ODI-4 against scored AHI is NOT apples to apples, and reporting only that would overstate what the
   run shows. SHHS scored a hypopnea without requiring a 4 % desaturation, so an ODI-derived estimate
   is expected to sit below AHI on DEFINITION alone, before any detector behaviour is involved.

   But the same annotation files score `SpO2 desaturation` events directly — the same quantity OxyDex
   computes, on the same channel, over the same night. Comparing OxyDex's desaturation index to the
   SCORER's desaturation index removes the definitional gap entirely and isolates the detector.

   ⚠️ It does not remove EVERY difference: SHHS scorers marked desaturations at a ≥3 % drop, so the
   honest pairing is the expert index against OxyDex's ODI-3, with ODI-4 reported beside it as the
   stricter variant. That is why both are carried. */
/* ⚠️ AND THE EXPERT EVENT LIST IS NOT A ≥3 % POPULATION EITHER — measured, after asserting otherwise.
   An earlier version of this file stated that "SHHS scorers marked desaturations at a ≥3 % drop" and
   paired their event count against ODI-3 on that basis. That was an ASSUMPTION, and it is false.
   Measured 2026-09-12 over 99 records from the scorers' own `SpO2Baseline`/`SpO2Nadir` fields: a MEDIAN
   66.7 % of scored desaturations are shallower than 3 %, and the minimum observed drop is 0.0 %.

   ⚠️ THAT FIGURE IS NOW COHORT-SCALE, and it corrects an earlier one. It was first measured as 70.9 %
   over the 99 records that have SIGNALS. The annotation side of SHHS1 is the FULL cohort — 5136 scored
   records, no EDF required — so the convention can be measured 50× wider for the cost of parsing:

       5136 records · 735 880 scored desaturations · 0 records with none
       depth: min 0.0 · p25 1.0 · MEDIAN 2.0 · p75 4.0 · p95 8.0 · max 59.0 %
       pooled share below 3 %: 59.3 %   ·   below 4 %: 74.6 %
       median PER-RECORD share below 3 %: 66.7 %   (the 70.9 % figure, re-measured)

   The conclusion is unchanged and the number moved ~4 points, which is the useful part: a scoring
   convention is a property of the COHORT, and 99 records happened to over-state it. Quote 66.7 % with
   its n, or 59.3 % pooled — the two answer different questions and are not interchangeable.

   So `SpO2 desaturation` names two different populations — the scorer's, and any threshold index. A
   3 %-threshold detector CANNOT count an event the scorer marked at 1 %, and the shortfall that produces
   is arithmetic, not detector behaviour. Reported against the unfiltered list, OxyDex looked like it
   found 37 % of desaturations. Depth-matched it finds a median 119 % (ODI-3 vs ≥3 %) and 96.5 %
   (ODI-4 vs ≥4 %) — the opposite conclusion.

   The index is therefore computed at a DEPTH THRESHOLD and paired with the matching ODI variant. The
   unfiltered count is kept beside it, labelled, so the two can never again be mistaken for each other. */
const DESAT_BLOCK_RE = /<ScoredEvent>[\s\S]*?<\/ScoredEvent>/g;
const NADIR_RE = /<SpO2Nadir>([\d.]+)<\/SpO2Nadir>/;
const BASELINE_RE = /<SpO2Baseline>([\d.]+)<\/SpO2Baseline>/;

export function expertDesatDepths(xmlText) {
  const out = [];
  for (const b of String(xmlText).match(DESAT_BLOCK_RE) || []) {
    if (!/SpO2 desaturation/i.test(b)) continue;
    const n = NADIR_RE.exec(b),
      base = BASELINE_RE.exec(b);
    if (!n || !base) continue;
    const d = Number(base[1]) - Number(n[1]);
    if (Number.isFinite(d)) out.push(d);
  }
  return out;
}

export function expertDesatIndex(xmlText, tstHours, minDropPct) {
  const depths = expertDesatDepths(xmlText);
  const keep = minDropPct == null ? depths : depths.filter((d) => d >= minDropPct);
  return {
    nDesat: keep.length,
    nAll: depths.length,
    index: tstHours && tstHours > 0 ? +(keep.length / tstHours).toFixed(2) : null,
    shallowSharePct: depths.length ? +((100 * (depths.length - keep.length)) / depths.length).toFixed(1) : null
  };
}

export function scoreRecord(ctx, rec) {
  const xmlText = readFileSync(rec.xml, 'utf8');
  const out = ctx.NSRR.analyzeRecord({
    id: rec.id,
    edfBuffer: toArrayBuffer(readFileSync(rec.edf)),
    xmlText
  });
  if (out.err) return { id: rec.id, err: out.err };
  const est = out.ahiOxyEst,
    ref = out.scoredAHI;
  return {
    id: rec.id,
    spo2Label: out.spo2Label || null,
    /* §∅: a rate computed over a night that was partly absent is not the same claim as one over a
       complete night. Published per record so the two are never indistinguishable again. */
    coveragePct: out.spo2CoveragePct != null ? out.spo2CoveragePct : null,
    hours: out.durSec != null ? +(out.durSec / 3600).toFixed(2) : null,
    odi3: out.odi3 != null ? +out.odi3 : null,
    odi4: out.odi4 != null ? +out.odi4 : null,
    ahiOxyEst: est != null ? +est : null,
    scoredAHI: ref != null ? +ref : null,
    residual: est != null && ref != null ? +(est - ref).toFixed(3) : null,
    classEst: severityClass(est),
    classRef: severityClass(ref),
    ...(() => {
      const all = expertDesatIndex(xmlText, out.tstHours, null);
      const d3 = expertDesatIndex(xmlText, out.tstHours, 3);
      const d4 = expertDesatIndex(xmlText, out.tstHours, 4);
      const odi3 = out.odi3 != null ? +out.odi3 : null;
      const odi4 = out.odi4 != null ? +out.odi4 : null;
      const ratio = (a, b) => (a != null && b ? +(a / b).toFixed(3) : null);
      return {
        tstHours: out.tstHours != null ? +out.tstHours.toFixed(2) : null,
        // UNFILTERED — kept and labelled, never paired with a threshold index
        expertDesatAllIdx: all.index,
        expertShallowSharePct: d3.shallowSharePct,
        // DEPTH-MATCHED — each ODI variant against the scorer's events at the SAME depth
        expertDesat3Idx: d3.index,
        expertDesat4Idx: d4.index,
        ratio3: ratio(odi3, d3.index),
        ratio4: ratio(odi4, d4.index),
        desatResidual3: odi3 != null && d3.index != null ? +(odi3 - d3.index).toFixed(2) : null
      };
    })()
  };
}

/* ⚠️ A RATIO OF TWO SMALL COUNTS IS NOT AN AGREEMENT STATISTIC, and reporting one was a third
   confounder in this file's short history. Most SHHS nights are sparse in ≥4 % desaturations: with an
   expert index of 3/h, detecting 5/h is a ratio of 167 % from a difference of two events. Measured over
   91 records — sparse nights (<5/h, n=58) show a median ratio of 115 % but a median absolute difference
   of only 0.9 events/h, while dense nights (≥15/h, n=8) show a ratio of 75 % and a real 4.7 events/h gap.
   The ratio calls the sparse nights disagreement and understates the dense ones; the absolute difference
   does neither. Both are reported, and the ABSOLUTE one is the headline. */
export function absAgreement(pairs) {
  const d = pairs
    .filter((p) => p.a != null && p.b != null)
    .map((p) => p.a - p.b)
    .sort((x, y) => x - y);
  if (!d.length) return { n: 0, median: null, q1: null, q3: null, within2: null };
  const at = (f) => d[Math.min(d.length - 1, Math.floor(f * d.length))];
  return {
    n: d.length,
    median: +at(0.5).toFixed(2),
    q1: +at(0.25).toFixed(2),
    q3: +at(0.75).toFixed(2),
    within2: d.filter((x) => Math.abs(x) <= 2).length
  };
}

export function summarise(rows) {
  const ok = rows.filter((r) => !r.err && r.residual != null);
  const ref = ok.map((r) => r.scoredAHI),
    res = ok.map((r) => r.residual);
  const ba = res.length ? AnalysisStats.blandAltman(res) : { n: 0, bias: null, sd: null, loa: null };
  const fit = olsSlope(ref, res);
  let exact = 0,
    within1 = 0;
  for (const r of ok) {
    const a = CLASS_ORDER.indexOf(r.classEst),
      b = CLASS_ORDER.indexOf(r.classRef);
    if (a < 0 || b < 0) continue;
    if (a === b) exact++;
    if (Math.abs(a - b) <= 1) within1++;
  }
  const n = ok.length;
  /* the stable statistic, on the scale the quantity is actually measured in */
  const desatAbs = absAgreement(rows.filter((r) => !r.err).map((r) => ({ a: r.odi4, b: r.expertDesat4Idx })));
  return {
    desatAbsDiff: desatAbs,
    records: rows.length,
    scored: n,
    failed: rows.filter((r) => r.err).length,
    biasEventsPerHour: ba.bias,
    sd: ba.sd,
    loaHalfWidth: ba.loa,
    slope: fit.slope,
    intercept: fit.intercept,
    slopeVerdict: verdictSlope(fit.slope),
    classExactPct: n ? (100 * exact) / n : null,
    classWithinOnePct: n ? (100 * within1) / n : null,
    bands: BANDS
  };
}

/* ══ SELFTEST — arithmetic only, no corpus, no detector rate ═══════════════════════════════════ */
function selftest() {
  let bad = 0,
    good = 0;
  const A = (name, cond, detail) => {
    if (cond) {
      good++;
      console.log('  ✓ ' + name);
    } else {
      bad++;
      console.log('  ✕ ' + name + (detail ? '  — ' + detail : ''));
    }
  };
  console.log('▸ nsrr-oxydex-odi --selftest  (arithmetic; no records, no detector rate)\n');

  A(
    'severity: the clinical 4-class edges',
    severityClass(4.9) === 'none' &&
      severityClass(5) === 'mild' &&
      severityClass(14.9) === 'mild' &&
      severityClass(15) === 'moderate' &&
      severityClass(29.9) === 'moderate' &&
      severityClass(30) === 'severe'
  );
  A('severity: a missing AHI is null, never a class', severityClass(null) === null && severityClass(Number.NaN) === null);

  /* THE DEPTH-MATCHING REGRESSION. Planted scorer events at known depths: an index computed WITHOUT a
     depth filter counts shallow events a threshold detector cannot see, and pairing the two is the
     error that produced a 37 % figure where the depth-matched answer is ~119 %. */
  const xml = [0.5, 1, 2, 2.9, 3, 3.5, 4, 5, 9]
    .map((d) => '<ScoredEvent><EventConcept>SpO2 desaturation|SpO2 desaturation</EventConcept><SpO2Nadir>' + (95 - d) + '</SpO2Nadir><SpO2Baseline>95</SpO2Baseline></ScoredEvent>')
    .join('');
  A('depths: every scored event is read', expertDesatDepths(xml).length === 9, String(expertDesatDepths(xml).length));

  /* the ratio-vs-difference trap, planted: a 2-event gap on a sparse night is a 167 % ratio */
  const sparse = absAgreement([{ a: 5, b: 3 }]);
  A('abs: a 2-event gap reads as 2, not as 167 %', sparse.median === 2, String(sparse.median));
  const mixed = absAgreement([
    { a: 5, b: 3 },
    { a: 20, b: 25 },
    { a: 1, b: 1 },
    { a: 4, b: 4 }
  ]);
  A('abs: median difference over a mixed set', mixed.median === 0 || mixed.median === 2, String(mixed.median));
  A('abs: counts records within ±2 events/h', mixed.within2 === 3, String(mixed.within2));
  A(
    'abs: a null side is excluded, never treated as 0',
    absAgreement([
      { a: 5, b: null },
      { a: 3, b: 1 }
    ]).n === 1
  );
  A('abs: an empty set refuses rather than reporting 0', absAgreement([]).median === null);
  A('index: unfiltered counts all 9 over 1 h', expertDesatIndex(xml, 1, null).index === 9);
  A('index: a >=3 % filter keeps 5, not 9', expertDesatIndex(xml, 1, 3).index === 5, String(expertDesatIndex(xml, 1, 3).index));
  A('index: a >=4 % filter keeps 3', expertDesatIndex(xml, 1, 4).index === 3, String(expertDesatIndex(xml, 1, 4).index));
  A('index: the shallow share is REPORTED, not silently dropped', expertDesatIndex(xml, 1, 3).shallowSharePct === 44.4, String(expertDesatIndex(xml, 1, 3).shallowSharePct));
  A('index: 2.9 % is below a 3 % threshold — the edge is not rounded in', expertDesatIndex(xml, 1, 3).nDesat === 5);
  A('index: an event with no nadir/baseline is skipped, never counted as depth 0', expertDesatDepths('<ScoredEvent><EventConcept>SpO2 desaturation</EventConcept></ScoredEvent>' + xml).length === 9);

  // a PLANTED severity-proportional under-count must be recovered as a negative slope
  const ref = [2, 6, 10, 18, 25, 33, 44, 60];
  const under = ref.map((a) => -0.3 * a); // residual = est − ref
  const f1 = olsSlope(ref, under);
  A('OLS recovers a planted −0.30 gradient', Math.abs(f1.slope + 0.3) < 1e-9, 'slope=' + f1.slope);
  A('…and that is called UNDER-COUNT SURVIVES', verdictSlope(f1.slope) === 'UNDER-COUNT SURVIVES');
  const f0 = olsSlope(
    ref,
    ref.map(() => 1.5)
  );
  A('OLS on a constant offset gives slope 0', Math.abs(f0.slope) < 1e-9, 'slope=' + f0.slope);
  A('…and that is called NO GRADIENT', verdictSlope(f0.slope) === 'NO GRADIENT');
  A('an over-correction is named separately', verdictSlope(0.4) === 'OVER-CORRECTED');
  A('too few points refuse rather than fit', olsSlope([1, 2], [1, 2]).slope === null);
  A('a zero-variance x refuses rather than divide by 0', olsSlope([5, 5, 5], [1, 2, 3]).slope === null);

  // summarise(): planted rows, so the aggregate is checkable
  const rows = ref.map((a, i) => ({ id: 'r' + i, scoredAHI: a, ahiOxyEst: a - 0.3 * a, residual: -0.3 * a, classEst: severityClass(a - 0.3 * a), classRef: severityClass(a) }));
  const s = summarise(rows);
  A('summarise counts every scored row', s.scored === ref.length, 'scored=' + s.scored);
  A('summarise propagates the gradient verdict', s.slopeVerdict === 'UNDER-COUNT SURVIVES');
  A('summarise reports a NEGATIVE mean bias for an under-count', s.biasEventsPerHour < 0, 'bias=' + s.biasEventsPerHour);
  const perfect = ref.map((a, i) => ({ id: 'p' + i, scoredAHI: a, ahiOxyEst: a, residual: 0, classEst: severityClass(a), classRef: severityClass(a) }));
  const sp = summarise(perfect);
  A('perfect agreement ⇒ 100 % exact severity class', sp.classExactPct === 100, 'exact=' + sp.classExactPct);
  A('perfect agreement ⇒ zero bias and NO GRADIENT', sp.biasEventsPerHour === 0 && sp.slopeVerdict === 'NO GRADIENT');
  // a row the adapter could not score must not silently enter the denominator
  const sMixed = summarise([...perfect, { id: 'bad', err: 'no SpO₂ channel' }]);
  A('an errored record is counted as failed, NOT scored', sMixed.scored === perfect.length && sMixed.failed === 1, JSON.stringify({ scored: sMixed.scored, failed: sMixed.failed }));

  // the realm must actually load the real modules — a stub would make every number meaningless
  try {
    const ctx = makeRealm();
    A('realm loads CpapEdf + OxyDex + the NSRR adapter', !!(ctx.CpapEdf && ctx.NSRR && typeof ctx.NSRR.analyzeRecord === 'function'));
  } catch (e) {
    A('realm loads CpapEdf + OxyDex + the NSRR adapter', false, String((e && e.message) || e));
  }

  console.log('\n  ⚠️  No agreement figure is produced here by design — every value above is planted, so it');
  console.log('     measures the ARITHMETIC. Only --dir / --edfs over real scored records yields a result.');
  /* ── SCORE CACHE ─────────────────────────────────────────────────────────────────────────────
     The property that makes a SCORE cache sound rather than dangerous: the key carries the code. A
     cache keyed on input alone would serve pre-change numbers after a detector edit, silently. */
  const _fpA = codeFingerprint(() => 'const a = 1;');
  const _fpB = codeFingerprint(() => 'const a = 2;');
  A('codeFingerprint moves when the scoring source moves', _fpA !== _fpB, _fpA + ' vs ' + _fpB);
  /* Bound to names rather than compared inline: two identical calls read to the linter as a
     self-comparison, and it is right that they do — the point being asserted is that two SEPARATE
     evaluations agree, which only a binding makes explicit. */
  const _fpC1 = codeFingerprint(() => 'x');
  const _fpC2 = codeFingerprint(() => 'x');
  A('…and is stable for identical source', _fpC1 === _fpC2, _fpC1 + ' vs ' + _fpC2);
  A('the real realm fingerprints to 12 hex chars', /^[0-9a-f]{12}$/.test(codeFingerprint()), codeFingerprint());
  const _e = { id: 'r1', srcBytes: 100, row: { id: 'r1' } };
  A('cacheUsable: same bytes AND same code → reuse', cacheUsable(_e, 100, 'aaa', 'aaa') === true);
  A('cacheUsable: DIFFERENT code → refuse, even on identical bytes', cacheUsable(_e, 100, 'aaa', 'bbb') === false);
  A('cacheUsable: different bytes → refuse (a replaced or still-arriving EDF)', cacheUsable(_e, 101, 'aaa', 'aaa') === false);
  A('cacheUsable: a cache with NO recorded code is never reused', cacheUsable(_e, 100, null, 'aaa') === false);
  A('cacheUsable: a missing entry is a miss, not a crash', cacheUsable(undefined, 100, 'aaa', 'aaa') === false);
  /* A corrupt or absent cache must be a COLD START, never a hard failure — a tool that dies on a
     half-written cache turns a cheap re-run into a manual cleanup. */
  A('loadScoreCache: absent file → empty, no throw', loadScoreCache('/nonexistent/x.json').records.length === 0);
  const _tmp = join(ROOT, '.cache', 'selftest-corrupt.json');
  mkdirSync(dirname(_tmp), { recursive: true });
  writeFileSync(_tmp, '{ not json');
  A('loadScoreCache: corrupt file → empty, no throw', loadScoreCache(_tmp).records.length === 0 && loadScoreCache(_tmp).code === null);
  writeFileSync(_tmp, JSON.stringify({ code: 'zz', records: [{ id: 'a', srcBytes: 1, row: {} }] }));
  A('loadScoreCache: a well-formed cache round-trips its code', loadScoreCache(_tmp).code === 'zz' && loadScoreCache(_tmp).records.length === 1);

  console.log('\n' + (bad ? '✕ ' + bad + ' failed, ' : '✓ ') + good + ' assertions passed');
  return bad ? 1 : 0;
}

/* ══ MAIN ═════════════════════════════════════════════════════════════════════════════════════ */
const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[36m', d: '\x1b[2m', B: '\x1b[1m', x: '\x1b[0m' };
const paint = (s, c) => (process.stdout.isTTY || process.env.FORCE_COLOR ? c + s + C.x : s);

/* One cache entry per record actually scored or reused in THIS run, carrying the bytes it was scored
   against. Records that errored are cached too: an error is a result, and re-reading a 36 MB EDF to
   rediscover the same "no SpO₂ channel" every run is the cost this exists to remove. */
function _entries(recs, rows, byId) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = recs[i];
    let srcBytes = null;
    try {
      srcBytes = statSync(r.edf).size;
    } catch {
      srcBytes = (byId.get(r.id) || {}).srcBytes ?? null;
    }
    if (srcBytes != null) out.push({ id: r.id, srcBytes, row: rows[i] });
  }
  return out;
}

function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  const json = argv.includes('--json');
  const { recs, searched } = discover(argv);

  if (!recs.length) {
    if (json) console.log(JSON.stringify({ status: 'skipped', reason: 'no EDF+XML pairs found', searched }, null, 2));
    else {
      console.log('⊘ SKIP — no NSRR EDF + annotation pairs found. NO METRICS PRODUCED.\n');
      for (const s of searched) console.log('    · ' + s);
      console.log('\n  This tool never downloads anything. Point it with --dir, --edfs/--anns, or DEX_NSRR.');
      console.log('  ⚠️ A skip is not a pass: nothing here says the detector agrees with anything.');
    }
    return 0;
  }

  const ctx = makeRealm();
  /* INCREMENTAL BY DEFAULT. `discover()` enumerates once at startup, so a run launched mid-download
     scores exactly what existed then — measured 2026-09-13, a run launched at 2271 records was still
     executing when the corpus reached 4084. The fix for that is not to re-enumerate mid-run (which
     would score a moving population and make the denominator unquotable) but to make RE-RUNNING cheap,
     so the second run picks up the arrivals and pays nothing for the 2271 it already has.
     ⚠️ What is cached is the SCORE, and that is only sound because the key carries `codeFingerprint`.
     Profiled at `nsrr-score-pool.mjs:31`, `processNight` is ~95 % of an `analyzeRecord` call, so
     caching only the EDF extraction — the shape the sibling uses — would save the I/O and leave the
     expensive 95 % to be repaid every run. The saving worth having is the one that needs the code key. */
  const useCache = !argv.includes('--no-cache');
  const code = codeFingerprint();
  const prev = useCache ? loadScoreCache() : { code: null, records: [] };
  const byId = new Map(prev.records.map((r) => [r.id, r]));
  const rows = [];
  let reused = 0,
    fresh = 0;
  for (const r of recs) {
    let srcBytes = null;
    try {
      srcBytes = statSync(r.edf).size;
    } catch {
      srcBytes = null; // unreadable now — fall through and let scoreRecord report the real error
    }
    const hit = useCache && srcBytes != null ? byId.get(r.id) : null;
    if (cacheUsable(hit, srcBytes, prev.code, code)) {
      rows.push(hit.row);
      reused++;
    } else {
      try {
        rows.push(scoreRecord(ctx, r));
      } catch (e) {
        rows.push({ id: r.id, err: String((e && e.message) || e) });
      }
      fresh++;
      // progress survives an interruption, exactly as the sibling's build does
      if (useCache && srcBytes != null && fresh % 25 === 0) saveScoreCache(code, _entries(recs, rows, byId), undefined);
    }
    if (!json && process.stderr.isTTY) process.stderr.write(`\r  ${rows.length}/${recs.length}  (+${fresh} scored, ${reused} reused)`);
  }
  if (useCache) saveScoreCache(code, _entries(recs, rows, byId), undefined);
  if (!json && process.stderr.isTTY) process.stderr.write('\r');
  const sum = summarise(rows);

  if (json) {
    console.log(JSON.stringify({ summary: sum, records: rows }, null, 2));
    return 0;
  }

  console.log('\n' + paint('OxyDex ODI-4 → AHI  vs  EXPERT-SCORED PSG AHI', C.B) + '\n');
  console.log(paint('  record            hours   cov   ODI-3   ODI-4   est AHI   scored   resid   class', C.d));
  console.log(paint('  ' + '─'.repeat(76), C.d));
  for (const r of rows) {
    if (r.err) {
      console.log('  ' + r.id.padEnd(17) + paint('ERROR — ' + r.err, C.r));
      continue;
    }
    const agree = r.classEst === r.classRef;
    const near = Math.abs(CLASS_ORDER.indexOf(r.classEst) - CLASS_ORDER.indexOf(r.classRef)) === 1;
    const cls = agree ? paint('✓ ' + r.classRef, C.g) : near ? paint('~ ' + r.classEst + '/' + r.classRef, C.y) : paint('✗ ' + r.classEst + '/' + r.classRef, C.r);
    const f = (v, w) => (v == null ? '—'.padStart(w) : v.toFixed(1).padStart(w));
    const cov = r.coveragePct;
    const covTxt = cov == null ? '   —' : paint(cov.toFixed(0).padStart(3) + '%', cov >= 99 ? C.g : cov >= 90 ? C.y : C.r);
    console.log('  ' + r.id.padEnd(17) + f(r.hours, 5) + '  ' + covTxt + f(r.odi3, 8) + f(r.odi4, 8) + f(r.ahiOxyEst, 10) + f(r.scoredAHI, 9) + f(r.residual, 8) + '   ' + cls);
  }
  const okc = (v, lim) => (v == null ? C.d : Math.abs(v) <= lim ? C.g : C.r);
  console.log(paint('  ' + '─'.repeat(76), C.d));
  console.log(`\n  ${sum.scored} scored · ${sum.failed} failed, of ${sum.records} records`);
  console.log(
    '  Bland–Altman  bias ' +
      paint((sum.biasEventsPerHour == null ? '—' : sum.biasEventsPerHour.toFixed(2)) + ' /h', okc(sum.biasEventsPerHour, BANDS.biasAbs)) +
      '   95 % LoA ±' +
      (sum.loaHalfWidth == null ? '—' : sum.loaHalfWidth.toFixed(2))
  );
  console.log(
    '  Severity gradient  slope ' +
      paint(sum.slope == null ? '—' : sum.slope.toFixed(4), okc(sum.slope, BANDS.slopeAbs)) +
      '   → ' +
      paint(sum.slopeVerdict, sum.slopeVerdict === 'NO GRADIENT' ? C.g : C.r)
  );
  console.log(
    '  Severity class  exact ' +
      (sum.classExactPct == null ? '—' : sum.classExactPct.toFixed(1) + ' %') +
      '   within one ' +
      (sum.classWithinOnePct == null ? '—' : sum.classWithinOnePct.toFixed(1) + ' %')
  );
  console.log(paint('\n  ⚠️ CARRY THE DOMAIN SHIFT: clinical PSG on a clinical cohort is not a consumer ring on a', C.d));
  console.log(paint('     healthy sleeper, and the reference AHI is scorer-derived, not truth.', C.d));
  console.log(paint('     §P5 gates PUBLICATION of these numbers, not their measurement.', C.d));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('nsrr-oxydex-odi.mjs')) process.exit(main(process.argv.slice(2)));
