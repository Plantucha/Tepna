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
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
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
  for (const f of ['clock.js', 'kernel-constants.js', 'cpapdex-edf.js', 'oxydex-util.js', 'oxydex-dsp.js', 'nsrr-adapter.js']) {
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
export function scoreRecord(ctx, rec) {
  const out = ctx.NSRR.analyzeRecord({
    id: rec.id,
    edfBuffer: toArrayBuffer(readFileSync(rec.edf)),
    xmlText: readFileSync(rec.xml, 'utf8')
  });
  if (out.err) return { id: rec.id, err: out.err };
  const est = out.ahiOxyEst,
    ref = out.scoredAHI;
  return {
    id: rec.id,
    spo2Label: out.spo2Label || null,
    hours: out.durSec != null ? +(out.durSec / 3600).toFixed(2) : null,
    odi3: out.odi3 != null ? +out.odi3 : null,
    odi4: out.odi4 != null ? +out.odi4 : null,
    ahiOxyEst: est != null ? +est : null,
    scoredAHI: ref != null ? +ref : null,
    residual: est != null && ref != null ? +(est - ref).toFixed(3) : null,
    classEst: severityClass(est),
    classRef: severityClass(ref)
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
  return {
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
  console.log('\n' + (bad ? '✕ ' + bad + ' failed, ' : '✓ ') + good + ' assertions passed');
  return bad ? 1 : 0;
}

/* ══ MAIN ═════════════════════════════════════════════════════════════════════════════════════ */
const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[36m', d: '\x1b[2m', B: '\x1b[1m', x: '\x1b[0m' };
const paint = (s, c) => (process.stdout.isTTY || process.env.FORCE_COLOR ? c + s + C.x : s);

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
  const rows = [];
  for (const r of recs) {
    try {
      rows.push(scoreRecord(ctx, r));
    } catch (e) {
      rows.push({ id: r.id, err: String((e && e.message) || e) });
    }
    if (!json && process.stderr.isTTY) process.stderr.write(`\r  ${rows.length}/${recs.length}`);
  }
  if (!json && process.stderr.isTTY) process.stderr.write('\r');
  const sum = summarise(rows);

  if (json) {
    console.log(JSON.stringify({ summary: sum, records: rows }, null, 2));
    return 0;
  }

  console.log('\n' + paint('OxyDex ODI-4 → AHI  vs  EXPERT-SCORED PSG AHI', C.B) + '\n');
  console.log(paint('  record            hours    ODI-3   ODI-4   est AHI   scored   resid   class', C.d));
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
    console.log('  ' + r.id.padEnd(17) + f(r.hours, 5) + f(r.odi3, 9) + f(r.odi4, 8) + f(r.ahiOxyEst, 10) + f(r.scoredAHI, 9) + f(r.residual, 8) + '   ' + cls);
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
