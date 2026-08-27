#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * tch-fused-corpus.mjs — the PER-SECOND fused-weight three-cornered hat, over a
 * committed trio corpus, in Node.
 *
 * WHY THIS EXISTS. `papers/sensor-trio-nights.html` and `papers/sigma-no-reference.html`
 * publish σ from the **fused-weight artifact-robust hat** — a per-second, per-corner
 * confidence `c` driving a weighted-variance TCH (`analysis-stats.js tchSigmasFused`).
 * That estimator lived ONLY in `sensor-trio-worker.js`, a browser worker that re-derived
 * everything from RAW capture files. So the published numbers could not be reproduced
 * from the committed corpus, and the N=10→15 re-fit that `TRIO-POWER-N15-FINDINGS` and
 * `SENSOR-TRIO-NIGHTS-PAPER` are blocked on had no Node path at all.
 *
 * MEASURED, before the export change that unblocked it: **0 of 40 committed OxyDex
 * exports carried ANY HR timeseries** (5-min epoch medians + 1 Hz SpO₂ only), and neither
 * beat series carried `c` (only a 0/1 Malik `corrected` flag). So the O2Ring corner was
 * simply not in the file: the per-second hat was un-runnable on committed data at ANY N,
 * not merely imprecise. `tools/tch-multinight.mjs` runs fine on the same corpus because it
 * is a DIFFERENT estimator at 5-min epoch resolution — which is why the gap stayed
 * invisible: it produced plausible numbers the whole time.
 *
 * The export contract now carries all three (`OxyDex timeseries.hr` 1 Hz · `ECGDex
 * timeseries.rr.conf` · `PpgDex timeseries.ppi.conf`), and this tool is the consumer.
 *
 * FAITHFULNESS. The per-second HR construction MIRRORS `sensor-trio-worker.js` beat for
 * beat: HR from the interval ENDING at each beat, gated to [30,220] bpm, `medMap`
 * per-second median, then the worker's 5-point rolling-median ±20 bpm clean. The O2Ring
 * corner is its native 1 Hz pulse on the same gate, and is trusted at `c=1` outright —
 * the worker's own call ("a smoothed device integer, cannot over-detect").
 *
 * TWO DELIBERATE DIVERGENCES, stated because they move published numbers:
 *   1. Intervals come from the node's MALIK-CORRECTED series (what the export publishes),
 *      where the worker used raw peak deltas.
 *   2. PpgDex `c` rides the node's own motion-gated per-beat SQI; the worker re-derived an
 *      ungated SQI at feet because the export gave it nothing to read.
 * Neither is a bug fix or a regression — they are the difference between "re-derived in a
 * browser from raw" and "reproducible from the committed artifact", and the second is the
 * property the papers need. Expect agreement in magnitude and ordering, not to the decimal.
 *
 * A/B. Every night is solved TWICE — fused (per-corner `c`) and unweighted (all c=1) — so
 * the weighting's effect is measured on this corpus rather than asserted.
 *
 * USAGE
 *   node tools/tch-fused-corpus.mjs --dir uploads/trio
 *   node tools/tch-fused-corpus.mjs --dir <dir> --json
 * ════════════════════════════════════════════════════════════════════════ */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AS = createRequire(import.meta.url)(join(ROOT, 'analysis-stats.js'));

/* ── worker-mirrored constants + helpers ─────────────────────────────────── */
const HR_MIN = 30,
  HR_MAX = 220;
const MIN_OVERLAP_S = 1000; // the worker's own floor: fewer seconds is not a window
const secFloor = (t) => Math.floor(t / 1000);

/** Per-second MEDIAN of every value landing in that second — `medMap` in the worker. */
function medMap(pairs) {
  const by = new Map();
  for (const [s, v] of pairs) {
    let a = by.get(s);
    if (!a) by.set(s, (a = []));
    a.push(v);
  }
  const out = new Map();
  for (const [s, a] of by) {
    a.sort((p, q) => p - q);
    out.set(s, a[a.length >> 1]);
  }
  return out;
}

/** The worker's post-clean: drop a second deviating >20 bpm from its 5-point local median. */
function rollingClean(perSec) {
  const secs = [...perSec.keys()].sort((a, b) => a - b);
  const vals = secs.map((s) => perSec.get(s));
  const out = new Map();
  for (let j = 0; j < secs.length; j++) {
    const win = vals.slice(Math.max(0, j - 2), Math.min(vals.length, j + 3)).sort((a, b) => a - b);
    if (Math.abs(vals[j] - win[win.length >> 1]) <= 20) out.set(secs[j], vals[j]);
  }
  return out;
}

/**
 * Per-second HR + confidence from a beat-interval export block (`rr` or `ppi`).
 * `tSec[i]` is the beat time from `startEpochMs`; `ms[i]` is the interval ENDING there.
 * Confidence is per-SECOND upstream (`beatConfidence` returns a second-keyed map), so every
 * beat inside a second carries the same `c`; `min` is taken anyway so a future per-beat
 * definition degrades safely rather than silently averaging an artifact away.
 */
function beatSeriesToPerSec(block, t0Ms) {
  if (!block || !Array.isArray(block.tSec) || !Array.isArray(block.ms)) return null;
  const conf = Array.isArray(block.conf) && block.conf.length === block.ms.length ? block.conf : null;
  const pairs = [];
  const cBy = new Map();
  for (let i = 0; i < block.ms.length; i++) {
    const rr = block.ms[i];
    if (!(rr > 250 && rr < 2200)) continue;
    const hr = 60000 / rr;
    if (!(hr >= HR_MIN && hr <= HR_MAX)) continue;
    const s = secFloor(t0Ms + block.tSec[i] * 1000);
    pairs.push([s, hr]);
    const c = conf && Number.isFinite(conf[i]) ? conf[i] : 1;
    cBy.set(s, Math.min(cBy.has(s) ? cBy.get(s) : 1, c));
  }
  if (pairs.length < 30) return null;
  const hrMap = rollingClean(medMap(pairs));
  if (hrMap.size < 30) return null;
  return { hr: hrMap, conf: cBy, hasConf: !!conf };
}

/** O2Ring native 1 Hz pulse on the uniform grid — `values[i]` at `startEpochMs + i*1000`. */
function gridToPerSec(block, t0Ms) {
  if (!block || !Array.isArray(block.values)) return null;
  const base = secFloor(t0Ms);
  const pairs = [];
  for (let i = 0; i < block.values.length; i++) {
    const v = block.values[i];
    if (v == null || !Number.isFinite(v)) continue; // an unreported second is a HOLE, never 0
    if (v < HR_MIN || v > HR_MAX) continue;
    pairs.push([base + i, v]);
  }
  return pairs.length >= 30 ? { hr: medMap(pairs), conf: new Map(), hasConf: false } : null;
}

/* ── per-night solve ─────────────────────────────────────────────────────── */
/* Mean and variance of each pairwise difference over the night's aligned seconds. */
function pairMoments(hh, vv, oo) {
  const mom = (a, b) => {
    let s1 = 0,
      s2 = 0;
    const n = a.length;
    for (let i = 0; i < n; i++) {
      const d = a[i] - b[i];
      s1 += d;
      s2 += d * d;
    }
    const mu = s1 / n;
    return { n, mu, var: Math.max(0, s2 / n - mu * mu) };
  };
  return { hv: mom(hh, vv), ho: mom(hh, oo), vo: mom(vv, oo) };
}

/* Exported so the pooled-seconds hat can reuse this alignment rather than duplicating it —
   the per-second key-matching here is the load-bearing part (R5-HR-TRIPLET §5) and a second
   copy would drift. `pairs` is ADDITIVE; existing consumers read the same fields as before. */
export function solveNight(dir, night) {
  const rd = (node) => {
    const p = join(dir, night, `${node}_${night}.node-export.json`);
    try {
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  };
  const E = rd('ECGDex'),
    V = rd('PpgDex'),
    O = rd('OxyDex');
  if (!E || !V || !O) return { night, skip: 'missing a node-export' };

  const t0 = (j) => (j.recording && Number.isFinite(j.recording.startEpochMs) ? j.recording.startEpochMs : null);
  if (t0(E) == null || t0(V) == null || t0(O) == null) return { night, skip: 'no startEpochMs' };

  const h = beatSeriesToPerSec(E.timeseries && E.timeseries.rr, t0(E));
  const v = beatSeriesToPerSec(V.timeseries && V.timeseries.ppi, t0(V));
  const o = gridToPerSec(O.timeseries && O.timeseries.hr, t0(O));
  const missing = [!h && 'ECGDex rr', !v && 'PpgDex ppi', !o && 'OxyDex timeseries.hr'].filter(Boolean);
  if (missing.length) return { night, skip: `no per-second HR for ${missing.join(' + ')}` };

  /* ABSOLUTE floating-second keys — each node's `tMin` is node-local, so aligning on
     node-relative time silently offsets the corners (R5-HR-TRIPLET §5). */
  const ks = [...h.hr.keys()].filter((s) => v.hr.has(s) && o.hr.has(s)).sort((a, b) => a - b);
  if (ks.length < MIN_OVERLAP_S) return { night, skip: `${ks.length} s overlap < ${MIN_OVERLAP_S}` };

  const hh = [],
    vv = [],
    oo = [],
    cH = [],
    cV = [],
    cO = [],
    one = [];
  for (const s of ks) {
    hh.push(h.hr.get(s));
    vv.push(v.hr.get(s));
    oo.push(o.hr.get(s));
    cH.push(h.conf.has(s) ? h.conf.get(s) : 1);
    cV.push(v.conf.has(s) ? v.conf.get(s) : 1);
    cO.push(1); // O2Ring native pulse — a smoothed device integer, cannot over-detect ⇒ trust 1
    one.push(1);
  }

  const fused = AS.tchSigmasFused(hh, vv, oo, cH, cV, cO);
  const plain = AS.tchSigmasFused(hh, vv, oo, one, one, one); // same code path, weights disabled
  const r = (a, b) => AS.pearson(a, b);
  return {
    night,
    n: ks.length,
    hasConf: h.hasConf && v.hasConf,
    fused: { h10: fused.h10, verity: fused.verity, o2: fused.o2, neg: fused.neg },
    plain: { h10: plain.h10, verity: plain.verity, o2: plain.o2, neg: plain.neg },
    r: { hv: r(hh, vv), ho: r(hh, oo), vo: r(vv, oo) },
    /* Per-night PAIRWISE moments — the inputs a pooled-seconds hat needs. A pooled variance is
       Σ w·Var + [Σ w·μ² − (Σ w·μ)²]: within-night plus a BETWEEN-night bias term, and the second
       term is exactly what a median over nights discards. */
    pairs: pairMoments(hh, vv, oo),
    meanC: { h10: cH.reduce((a, b) => a + b, 0) / cH.length, verity: cV.reduce((a, b) => a + b, 0) / cV.length }
  };
}

/* ── corpus aggregation ──────────────────────────────────────────────────── */
const q = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.max(0, Math.min(a.length - 1, Math.floor(p * (a.length - 1))))] : null);
const f2 = (x) => (x == null ? '  —  ' : x.toFixed(2).padStart(5));

function main() {
  const argv = process.argv.slice(2);
  const dirI = argv.indexOf('--dir');
  if (dirI < 0 || !argv[dirI + 1]) {
    console.error('usage: node tools/tch-fused-corpus.mjs --dir <corpus> [--json]');
    process.exit(2);
  }
  const dir = argv[dirI + 1],
    asJson = argv.includes('--json');
  const nights = readdirSync(dir)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && statSync(join(dir, d)).isDirectory())
    .sort();
  if (!nights.length) {
    console.error(`no YYYY-MM-DD night folders under ${dir}`);
    process.exit(2);
  }

  const rows = nights.map((n) => solveNight(dir, n));
  const solved = rows.filter((r) => !r.skip);
  const skipped = rows.filter((r) => r.skip);

  if (asJson) {
    console.log(JSON.stringify({ dir, nights: rows }, null, 2));
    return;
  }

  console.log(`\n  fused-weight three-cornered hat — per-second, ${dir}\n`);
  console.log('  night        n_s   r(H,V) r(H,O) r(V,O) │  FUSED  σ H10/Verity/O2   │  UNWEIGHTED σ');
  console.log('  ' + '─'.repeat(94));
  for (const r of rows) {
    if (r.skip) {
      console.log(`  ${r.night}   ⊘ ${r.skip}`);
      continue;
    }
    const F = r.fused,
      P = r.plain;
    console.log(
      `  ${r.night} ${String(r.n).padStart(6)}   ${r.r.hv.toFixed(2)}   ${r.r.ho.toFixed(2)}   ${r.r.vo.toFixed(2)}  │ ` +
        ` ${f2(F.h10)}/${f2(F.verity)}/${f2(F.o2)}${F.neg ? ' ⚠neg' : '     '} │ ` +
        ` ${f2(P.h10)}/${f2(P.verity)}/${f2(P.o2)}${P.neg ? ' ⚠neg' : ''}`
    );
  }

  const pick = (k, which) => solved.map((r) => r[which][k]).filter((x) => x != null && x > 0);
  console.log('\n  ' + '─'.repeat(94));
  console.log(`  solved ${solved.length} / ${rows.length} night(s)${skipped.length ? ` · ${skipped.length} skipped` : ''}`);
  if (!solved.length) return;
  const noConf = solved.filter((r) => !r.hasConf).length;
  if (noConf)
    console.log(
      `\n  ⚠ ${noConf} of ${solved.length} night(s) carry NO per-beat \`conf\` — those corners fell back to c=1,\n` +
        '    so their "fused" column is the unweighted hat wearing the fused label. Re-derive with\n' +
        '    tools/trio-batch.mjs on a build that exports rr.conf / ppi.conf before quoting a fused σ.'
    );

  console.log('\n  corpus σ (median [IQR] over solved nights, bpm)');
  for (const [key, label] of [
    ['o2', 'O2Ring  (OxyDex)'],
    ['h10', 'Polar H10 (ECGDex)'],
    ['verity', 'Verity  (PpgDex)']
  ]) {
    const F = pick(key, 'fused'),
      P = pick(key, 'plain');
    console.log(
      `    ${label.padEnd(20)} fused ${f2(q(F, 0.5))} [${f2(q(F, 0.25))}–${f2(q(F, 0.75))}]  n=${String(F.length).padStart(2)}` +
        `   │  unweighted ${f2(q(P, 0.5))} [${f2(q(P, 0.25))}–${f2(q(P, 0.75))}]  n=${P.length}`
    );
  }
  const negF = solved.filter((r) => r.fused.neg).length,
    negP = solved.filter((r) => r.plain.neg).length;
  console.log(`\n    negative-variance nights: fused ${negF}/${solved.length} · unweighted ${negP}/${solved.length}`);
  console.log('\n  A median over nights is NOT the pooled-seconds hat the papers quote; it is the\n' + '  across-night distribution. Report it with N and the IQR, never as a bare σ.\n');
}

/* ⚠️ ENTRY GUARD — without it this file runs its CLI the moment anything imports it, and calls `process.exit` (2 sites), which
   terminates the importing process rather than throwing something catchable.
   Swept 2026-08-19 alongside `device-stability.mjs` and `beat-leg-closure.mjs`: a bare top-level
   `main()` is indistinguishable from a module until something imports it, and `tests/run-tests.mjs`
   wraps tool imports in `try { … } catch { return null }` — so the consequence surfaces as a
   SILENT SKIP or a killed parent, never as a red. No importer exists for this file today (verified:
   0 real `import` statements repo-wide, the apparent hits being prose that names it), so this is
   PREVENTIVE — the guard costs one line and the absence costs a debugging session. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
