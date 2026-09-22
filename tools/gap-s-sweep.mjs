#!/usr/bin/env node
/*
 * tools/gap-s-sweep.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * WHERE DOES THE CVHR INDEX MOVE AS THE GAP CUT MOVES, ON BOTH NODES? — a MEASUREMENT, not a decision.
 *
 * ECG-SATURATION-ABSENCE §"GAP_S": the cut that turns an inter-beat interval into an ABSENCE (`spansGap`,
 * excluded, never median-filled) is `GAP_S = 10 s` in ecgdex-dsp.js and `PPG_CVHR_GAP_S = 10` in
 * ppgdex-dsp.js — two constants held equal by a comment, and the CVHR index on both nodes sums active
 * seconds under that cut. The owner ruled 2026-09-21: MEASURE BEFORE RULING. This tool sweeps the cut on
 * BOTH nodes together over the paired box nights and reports where the index moves; the owner rules on
 * the numbers. The report was pre-stated before the first run (scratchpad gaps/PRESTATED.md,
 * 2026-09-22T06:24Z, reproduced in the PR body); it carries NO bands.
 *
 * HOW THE CUT IS MOVED WITHOUT EDITING THE SHIPPED FILES. Each value gets its own co-loaded vm realm in
 * which the source text of the ONE declaration line is substituted (`const GAP_S = 10;` /
 * `const PPG_CVHR_GAP_S = 10;`). The substitution REFUSES unless the line matches exactly once — a
 * second declaration, or a renamed one, would otherwise sweep nothing and report a flat curve as a
 * finding (§4b). The value 10 is the shipped realm and is run the same way, so "moved vs shipped" is
 * measured in one instrument, not against a number read off a different run.
 *
 * LAZY (owner rule, ≤ 8 GB): one night at a time, both files read, analysed under every value, and
 * only SCALARS kept (index, active seconds, reason); the checkpoint is appended per night so a killed
 * run resumes. Full-night ECG + PPG through two detectors × 8 values is the cost; it is sized on the
 * first night and printed before the rest run.
 *
 *   node tools/gap-s-sweep.mjs --nights <list.txt: "<date> <ecg> <ppg>" per line, TAB-separated if a path has a space> [--values 3,5,7.5,10,15,20,30,60]
 *                              [--out <json>] [--limit N] [--resume] [--ppg-keep-hz <hz>] [--ppg-only]
 *   --ppg-keep-hz  ROW-KEEPING decimation of the PPG to a coarser grid (a row is kept iff its sensor timestamp
 *                  advanced ≥ 1/hz since the last kept row; nothing is resampled or invented)
 *   node tools/gap-s-sweep.mjs --selftest
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const req = createRequire(import.meta.url);

export const ECG_DECL = /^(\s*)const GAP_S = 10;/m;
export const PPG_DECL = /^(\s*)const PPG_CVHR_GAP_S = 10;/m;

/* Substitute the ONE declaration; refuse on zero or several matches. Pure. */
export function patchConstant(src, decl, value, name) {
  const all = src.match(new RegExp(decl.source, 'gm')) || [];
  if (all.length !== 1) throw new Error(`${name}: expected exactly one declaration line, found ${all.length} — refusing to sweep a constant that may not be the one the index reads`);
  return src.replace(decl, (m, ws) => `${ws}const ${name} = ${value};`);
}

const ECG_FILES = ['kernel-constants.js', 'clock.js', 'signal-frame.js', 'dex-export.js', 'metric-registry.js', 'ecgdex-registry.js', 'ecgdex-dsp.js', 'ecgdex-morph.js'];
const PPG_FILES = [
  'kernel-constants.js',
  'clock.js',
  'signal-frame.js',
  'dex-export.js',
  'metric-registry.js',
  'dex-profile.js',
  'crossnight-envelope.js',
  'ppgdex-registry.js',
  'ppgdex-dsp.js',
  'ppgdex-morph.js',
  'ppgdex-cross.js',
  'ppgdex-profile.js'
];

function sandbox() {
  const sb = {
    console,
    Math,
    Date,
    JSON,
    Number,
    String,
    Array,
    Object,
    Float32Array,
    Float64Array,
    Int16Array,
    Int32Array,
    Uint8Array,
    Uint32Array,
    Map,
    Set,
    Promise,
    TextEncoder,
    TextDecoder,
    isFinite,
    isNaN,
    parseFloat,
    parseInt,
    setTimeout,
    clearTimeout,
    performance,
    Error,
    TypeError,
    RangeError
  };
  sb.window = sb;
  sb.self = sb;
  sb.globalThis = sb;
  const ctx = vm.createContext(sb);
  ctx.__DEX_NAMESPACED__ = true;
  return ctx;
}
function realm(files, patchFile, decl, name, value) {
  const DexBuild = req(join(ROOT, 'tools', 'build-core.js'));
  const ctx = sandbox();
  for (const f of files) {
    let src = readFileSync(join(ROOT, f), 'utf8');
    if (f === patchFile) src = patchConstant(src, decl, value, name);
    vm.runInContext(DexBuild.classicify(src), ctx, { filename: f + '@' + value });
  }
  return ctx;
}

/* ROW-KEEPING decimation of a PPG text to a coarser grid: the source is binned into 1/hz-second bins by
   its own sensor timestamp [ns] and the FIRST original row entering each bin is kept — an achieved rate
   of ≈ hz with jittered spacing (the box's own stream is also not on an exact grid). "Advance ≥ 1/hz
   since the last kept row" was tried first and snaps to every 4th row (44 Hz) on the 176 → 55 ratio,
   which is why the rule is bin entry. No sample is invented (never a resample); the header is kept; a
   row whose timestamp does not parse is dropped. Pure. */
export function decimatePpgText(text, hz) {
  if (!(hz > 0)) return text;
  const lines = text.split('\n');
  const out = [lines[0]];
  let lastBin = null;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    const j = l.indexOf(';');
    const k = l.indexOf(';', j + 1);
    if (j < 0 || k < 0) continue;
    const t = Number(l.slice(j + 1, k));
    if (!Number.isFinite(t)) continue;
    const bin = Math.floor((t * hz) / 1e9);
    if (bin !== lastBin) {
      out.push(l);
      lastBin = bin;
    }
  }
  return out.join('\n') + '\n';
}

/* One night under one value on both nodes → scalars only. opts.ppgKeepHz decimates the PPG text by rows;
   opts.ppgOnly skips the ECG (its index is then null WITH the reason). */
export function scoreNight(realms, ecgText, ppgText, opts) {
  opts = opts || {};
  if (opts.ppgKeepHz) ppgText = decimatePpgText(ppgText, opts.ppgKeepHz);
  const E = realms.ecg;
  const P = realms.ppg;
  let ecg = { index: null, reason: 'threw' };
  let ppg = { index: null, reason: 'threw' };
  if (opts.ppgOnly) ecg = { index: null, reason: 'skipped (--ppg-only)' };
  else {
    try {
      const r = E.ECGDSP.analyze(E.ECGDSP.parseECG(ecgText), null);
      ecg = {
        index: r.cvhr ? r.cvhr.index : null,
        denomSec: r.cvhr ? r.cvhr.denomSec : null,
        events: r.cvhr && r.cvhr.events ? r.cvhr.events.length : null,
        nBeats: r.nBeats != null ? r.nBeats : null,
        reason: r.cvhr && r.cvhr.suppressed ? 'suppressed' : null
      };
    } catch (e) {
      ecg = { index: null, reason: 'threw: ' + String(e && e.message).slice(0, 80) };
    }
  }
  try {
    const r = P.PPGDSP.analyze(P.PPGDSP.parsePPG(ppgText, undefined), null);
    ppg = {
      index: r.cvhrIndex != null ? r.cvhrIndex : null,
      events: r.cvhrEvents != null ? r.cvhrEvents : null,
      nBeats: r.nBeats != null ? r.nBeats : null,
      reason: r.cvhrReason || null,
      ...(opts.ppgKeepHz ? { keepHz: opts.ppgKeepHz, rows: ppgText.split('\n').length - 2 } : {})
    };
  } catch (e) {
    ppg = { index: null, reason: 'threw: ' + String(e && e.message).slice(0, 80) };
  }
  return { ecg, ppg };
}

/* The report over the checkpoint's rows, pure — the pre-stated three sections, no bands. */
export function report(rows, values, shipped) {
  const per = {};
  const med = (a) => {
    const s = a.filter((v) => v != null && Number.isFinite(v)).sort((x, y) => x - y);
    return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
  };
  /* AVERAGE ranks for ties. The first version broke ties by input order, which put the decimation
     result at 0.4999 against a pre-stated 0.5 band while average ranks gave 0.508 — a tie rule must not
     be the thing that decides a band, so it is the textbook one now. */
  const rank = (a) => {
    const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
    const r = new Array(a.length);
    let k = 0;
    while (k < idx.length) {
      let j = k;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[k][0]) j++;
      const avg = (k + j) / 2;
      for (let m = k; m <= j; m++) r[idx[m][1]] = avg;
      k = j + 1;
    }
    return r;
  };
  const spearman = (a, b) => {
    const pairs = a.map((v, i) => [v, b[i]]).filter(([x, y]) => x != null && y != null && Number.isFinite(x) && Number.isFinite(y));
    if (pairs.length < 4) return null;
    const ra = rank(pairs.map((p) => p[0]));
    const rb = rank(pairs.map((p) => p[1]));
    const n = pairs.length;
    const ma = (n - 1) / 2;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < n; i++) {
      sxy += (ra[i] - ma) * (rb[i] - ma);
      sxx += (ra[i] - ma) ** 2;
      syy += (rb[i] - ma) ** 2;
    }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
  };
  for (const v of values) {
    const at = (node) => rows.map((r) => (r.byValue[String(v)] ? r.byValue[String(v)][node] : null));
    const ship = (node) => rows.map((r) => (r.byValue[String(shipped)] ? r.byValue[String(shipped)][node] : null));
    const sec = {};
    for (const node of ['ecg', 'ppg']) {
      const cur = at(node);
      const base = ship(node);
      const idx = cur.map((x) => (x ? x.index : null));
      const bidx = base.map((x) => (x ? x.index : null));
      const both = idx.map((x, i) => [x, bidx[i]]).filter(([x, y]) => x != null && y != null);
      sec[node] = {
        nights: idx.filter((x) => x != null).length,
        refused: cur.filter((x) => x && x.index == null).length,
        medianIndex: med(idx),
        movedAbs1: both.length ? both.filter(([x, y]) => Math.abs(x - y) >= 1).length / both.length : null,
        movedRel10: both.length ? both.filter(([x, y]) => (y === 0 ? x !== 0 : Math.abs(x - y) / Math.abs(y) >= 0.1)).length / both.length : null,
        medianDeltaVsShipped: med(both.map(([x, y]) => x - y))
      };
    }
    const e = at('ecg').map((x) => (x ? x.index : null));
    const p = at('ppg').map((x) => (x ? x.index : null));
    const pairs = e.map((x, i) => [x, p[i]]).filter(([x, y]) => x != null && y != null);
    sec.cross = { nights: pairs.length, medianAbsDiff: med(pairs.map(([x, y]) => Math.abs(x - y))), spearman: spearman(e, p) };
    per[String(v)] = sec;
  }
  const knee = { below: null, above: null };
  for (const v of values.filter((x) => x < shipped).sort((a, b) => b - a)) {
    const s = per[String(v)];
    if ((s.ecg.movedRel10 != null && s.ecg.movedRel10 >= 0.25) || (s.ppg.movedRel10 != null && s.ppg.movedRel10 >= 0.25)) {
      knee.below = v;
      break;
    }
  }
  for (const v of values.filter((x) => x > shipped).sort((a, b) => a - b)) {
    const s = per[String(v)];
    if ((s.ecg.movedRel10 != null && s.ecg.movedRel10 >= 0.25) || (s.ppg.movedRel10 != null && s.ppg.movedRel10 >= 0.25)) {
      knee.above = v;
      break;
    }
  }
  return {
    nights: rows.length,
    values,
    shipped,
    perValue: per,
    knee,
    kneeNote: 'the nearest value on each side of the shipped cut at which ≥ 25 % of nights move by ≥ 10 % on either node — where sensitivity lives, not a recommendation'
  };
}

function selftest() {
  let fail = 0;
  const ok = (n, c, d) => {
    console.log((c ? '  ok   ' : '  FAIL ') + n + (!c && d != null ? '  — ' + d : ''));
    if (!c) fail++;
  };
  ok('patchConstant: substitutes the one declaration', /const GAP_S = 7\.5;/.test(patchConstant('  const GAP_S = 10; // x\n', ECG_DECL, 7.5, 'GAP_S')));
  let threw = null;
  try {
    patchConstant('const GAP_S = 10;\nconst GAP_S = 10;\n', ECG_DECL, 5, 'GAP_S');
  } catch (e) {
    threw = e.message;
  }
  ok('patchConstant: refuses two declarations', /found 2/.test(threw), threw);
  threw = null;
  try {
    patchConstant('const GAPS = 10;\n', ECG_DECL, 5, 'GAP_S');
  } catch (e) {
    threw = e.message;
  }
  ok('patchConstant: refuses zero declarations (a renamed constant sweeps nothing)', /found 0/.test(threw), threw);
  ok(
    'the shipped files carry exactly one declaration each (the sweep would refuse otherwise)',
    (readFileSync(join(ROOT, 'ecgdex-dsp.js'), 'utf8').match(new RegExp(ECG_DECL.source, 'gm')) || []).length === 1 &&
      (readFileSync(join(ROOT, 'ppgdex-dsp.js'), 'utf8').match(new RegExp(PPG_DECL.source, 'gm')) || []).length === 1
  );
  const rows = [];
  for (let i = 0; i < 8; i++) {
    const byValue = {};
    for (const v of [5, 10, 20]) byValue[String(v)] = { ecg: { index: 10 + i + (v === 5 ? 3 : v === 20 ? -0.2 : 0) }, ppg: { index: 9 + i + (v === 5 ? 2 : 0) } };
    rows.push({ night: 'n' + i, byValue });
  }
  const R = report(rows, [5, 10, 20], 10);
  ok('report: the shipped value moves 0 % vs itself', R.perValue['10'].ecg.movedRel10 === 0 && R.perValue['10'].ecg.medianDeltaVsShipped === 0);
  ok(
    'report: a +3 shift on every night at 5 s is 100 % moved by ≥ 1 and by ≥ 10 %',
    R.perValue['5'].ecg.movedAbs1 === 1 && R.perValue['5'].ecg.movedRel10 === 1 && R.perValue['5'].ecg.medianDeltaVsShipped === 3
  );
  ok('report: a −0.2 shift at 20 s moves 0 % by ≥ 1 and 0 % by ≥ 10 %', R.perValue['20'].ecg.movedAbs1 === 0 && R.perValue['20'].ecg.movedRel10 === 0);
  ok('report: cross-node Spearman is 1 on monotone planted indices', Math.abs(R.perValue['10'].cross.spearman - 1) < 1e-12, String(R.perValue['10'].cross.spearman));
  {
    const tied = [
      { night: 'a', byValue: { 10: { ecg: { index: 1 }, ppg: { index: 2 } } } },
      { night: 'b', byValue: { 10: { ecg: { index: 1 }, ppg: { index: 3 } } } },
      { night: 'c', byValue: { 10: { ecg: { index: 2 }, ppg: { index: 1 } } } },
      { night: 'd', byValue: { 10: { ecg: { index: 3 }, ppg: { index: 4 } } } }
    ];
    // average ranks: ecg [1.5,1.5,3,4] ↔ ppg [2,3,1,4] → ρ = 1 − 6·Σd²/(n(n²−1)) with d = [−0.5,−1.5,2,0] → 1 − 6·6.5/60 = 0.35
    ok(
      'report: ties take AVERAGE ranks (planted: ρ 0.3162 = Pearson over the ranks; the 1 − 6Σd²/(n(n²−1)) shortcut is exact only without ties)',
      Math.abs(report(tied, [10], 10).perValue['10'].cross.spearman - 0.31622776601683794) < 1e-9,
      String(report(tied, [10], 10).perValue['10'].cross.spearman)
    );
  }
  ok('report: the knee below the shipped cut is 5 (the only value that moved), none above', R.knee.below === 5 && R.knee.above === null, JSON.stringify(R.knee));
  /* NULL CONTROL — the instrument must SEE the cut. A flat curve on the real corpus is only a finding if a
     planted gap moves the number: a synthetic ECG night with one 20 s gap is analysed in patched realms at
     10 s and 30 s — at 10 the gap is an absence (excluded from the CVHR denominator), at 30 it is inside
     the cut and counted — so the active seconds must differ by ~20 s, and NOT differ between 3 and 10
     (the gap is an absence under both). Without this, a renamed constant or a dead code path would sweep
     nothing and report "GAP_S does not matter" as a result (§4b). */
  {
    const r10 = realm(ECG_FILES, 'ecgdex-dsp.js', ECG_DECL, 'GAP_S', 10);
    const r30 = realm(ECG_FILES, 'ecgdex-dsp.js', ECG_DECL, 'GAP_S', 30);
    const r3 = realm(ECG_FILES, 'ecgdex-dsp.js', ECG_DECL, 'GAP_S', 3);
    const mk = (ctx) => {
      const rec = ctx.ECGDSP.genSynthetic({ durSec: 1800, seed: 20260922 });
      const mid = Math.floor(rec.int16.length / 2);
      return ctx.ECGDSP.analyze(Object.assign({}, rec, { gaps: [{ idx: mid, ms: 20000 }] }), null);
    };
    const d10 = mk(r10).cvhr.denomSec;
    const d30 = mk(r30).cvhr.denomSec;
    const d3 = mk(r3).cvhr.denomSec;
    ok('NULL CONTROL · a planted 20 s gap is counted at GAP_S 30 and excluded at 10: denominator differs by ~20 s', d30 - d10 > 15 && d30 - d10 < 25, JSON.stringify({ d10, d30 }));
    ok('NULL CONTROL · …and is an absence under both 3 and 10 (no difference)', Math.abs(d10 - d3) < 1, JSON.stringify({ d3, d10 }));
  }
  {
    const hdr = 'Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient';
    const rows = [];
    for (let i = 0; i < 1760; i++) rows.push('x;' + Math.round((i * 1e9) / 176) + ';1;2;3;4'); // 10 s at 176 Hz
    const dec = decimatePpgText(hdr + '\n' + rows.join('\n') + '\n', 55);
    const kept = dec.split('\n').filter(Boolean).length - 1;
    ok('decimatePpgText: 10 s at 176 Hz keeps ≈ 550 rows at 55 Hz (bin entry, row-keeping, never a resample)', kept >= 545 && kept <= 555, String(kept));
    ok(
      'decimatePpgText: every kept row is an ORIGINAL row (no invented sample)',
      dec
        .split('\n')
        .filter(Boolean)
        .slice(1)
        .every((l) => rows.includes(l))
    );
    ok('decimatePpgText: the header survives and hz ≤ 0 is a no-op', dec.startsWith(hdr) && decimatePpgText('h\na;1;\n', 0) === 'h\na;1;\n');
  }
  const R0 = report([{ night: 'x', byValue: { 10: { ecg: { index: null, reason: 'threw' }, ppg: { index: null } } } }], [10], 10);
  ok('report: refused nights count as refused and yield nulls, never zeros', R0.perValue['10'].ecg.refused === 1 && R0.perValue['10'].ecg.medianIndex === null);
  console.log(fail ? fail + ' failed of 16' : 'all 16 selftests passed');
  return fail ? 1 : 0;
}

function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  const arg = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
  };
  const list = arg('--nights', null);
  if (!list) {
    console.error('usage: node tools/gap-s-sweep.mjs --nights <list.txt> [--values 3,5,7.5,10,15,20,30,60] [--out <json>] [--limit N] [--resume] | --selftest');
    return 2;
  }
  const values = String(arg('--values', '3,5,7.5,10,15,20,30,60'))
    .split(',')
    .map(Number)
    .filter((v) => Number.isFinite(v) && v > 0);
  const SHIPPED = 10;
  if (!values.includes(SHIPPED)) values.push(SHIPPED);
  values.sort((a, b) => a - b);
  const out = arg('--out', join(ROOT, '.cache', 'gap-s-sweep.json'));
  const limit = Number(arg('--limit', '0'));
  const ppgKeepHz = Number(arg('--ppg-keep-hz', '0')) || 0;
  const ppgOnly = argv.includes('--ppg-only');
  const nights = readFileSync(list, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      /* TAB-separated when a path carries a space (`Ecg nightly`); whitespace-split otherwise. A path
         split on its own space read as ENOENT on the first phone night — the list format is stated. */
      const parts = l.includes('\t') ? l.split('\t') : l.split(/\s+/);
      const [night, ecg, ppg] = parts.map((x) => x.trim());
      return { night, ecg, ppg };
    })
    .slice(0, limit > 0 ? limit : undefined);
  let rows = [];
  if (argv.includes('--resume') && existsSync(out)) rows = JSON.parse(readFileSync(out, 'utf8')).rows || [];
  const done = new Set(rows.map((r) => r.night));
  console.error(`▸ gap-s-sweep · ${nights.length} night(s) · values ${values.join(',')} · shipped ${SHIPPED} · resuming ${done.size}`);
  const t0 = Date.now();
  const realms = {};
  for (const v of values) realms[String(v)] = { ecg: realm(ECG_FILES, 'ecgdex-dsp.js', ECG_DECL, 'GAP_S', v), ppg: realm(PPG_FILES, 'ppgdex-dsp.js', PPG_DECL, 'PPG_CVHR_GAP_S', v) };
  console.error(`  realms built in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  for (const n of nights) {
    if (done.has(n.night)) continue;
    const tn = Date.now();
    const ecgText = ppgOnly ? '' : readFileSync(n.ecg, 'utf8');
    const ppgText = readFileSync(n.ppg, 'utf8');
    const byValue = {};
    for (const v of values) byValue[String(v)] = scoreNight(realms[String(v)], ecgText, ppgText, { ppgKeepHz, ppgOnly });
    rows.push({ night: n.night, ecg: n.ecg, ppg: n.ppg, byValue, ms: Date.now() - tn });
    writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), values, shipped: SHIPPED, ppgKeepHz: ppgKeepHz || null, ppgOnly, rows, report: report(rows, values, SHIPPED) }, null, 1));
    console.error(
      `  ${n.night}  ${((Date.now() - tn) / 1000).toFixed(0)} s  ecg@10 ${byValue[String(SHIPPED)].ecg.index}  ppg@10 ${byValue[String(SHIPPED)].ppg.index}  (${rows.length}/${nights.length}, ${((Date.now() - t0) / 60000).toFixed(1)} min)`
    );
  }
  console.error('  results   ' + out);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
