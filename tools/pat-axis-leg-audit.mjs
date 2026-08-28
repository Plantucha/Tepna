/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * pat-axis-leg-audit.mjs — PAT-ROOT-CAUSE-FORENSICS §2/§3/§5: do the two legs of a PAT measurement
 * ride the SAME time axis?
 *
 * ┌─ THE ASYMMETRY THIS MEASURES ────────────────────────────────────────────────────────────────┐
 * │ Both fiducials are SUB-SAMPLE. `refinePeaks` (ECG) and `refineFeet` (PPG) each return a       │
 * │ FRACTIONAL sample index — `refineFeet` computes `cross = ms - (bp[ms]-mv)/msv`, clamped but   │
 * │ never rounded. The two legs then convert index→time by different means:                      │
 * │                                                                                              │
 * │   ECG  ecgdex-dsp.js `tMsAt(i)`   → t0Ms + i*msPerSample + corrAt(devMs)     ARITHMETIC       │
 * │   PPG  pat-feasibility-worker.js  → rel[idx] ?? idx/fs                       ARRAY SUBSCRIPT  │
 * │                                                                                              │
 * │ `tMsAt` accepts a fractional `i` by construction and its own comment says sub-sample R        │
 * │ positions "must not be rounded before the correction is applied". `rel[93.3275]` is           │
 * │ `undefined` for every array, so `rel[idx] != null` is FALSE for every fractional foot and the │
 * │ expression falls through to `idx / fs` — the raw device axis, host correction discarded.      │
 * │                                                                                              │
 * │ So the ECG leg is host-disciplined and the PPG leg is not. The differential is a genuine      │
 * │ cross-device timing error, and Tepna introduces it — the devices did not.                    │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ REPORT THE WITHIN-BIN RESIDUAL, NOT THE RAW ERROR. The discarded correction is a smooth RAMP
 * (measured beat-to-beat |Δ| median 0.05 ms, max 0.44), not jitter. `coupledPAT` bins at
 * `BIN_MIN = 5` minutes and centres within a bin, so a bin absorbs the ramp's offset and keeps only
 * its SLOPE. Quoting the fragment-wide error (median 34.5 ms on part07) would overstate what PAT
 * actually eats by ~3x. The honest quantity is the spread WITHIN one 5-minute bin.
 *
 * NOMINAL-vs-REAL threshold: `2 ms`, adopted from `DexClock.hostAxis`'s own `independent` test
 * (`spreadMs > 2 ms`, twice the stamp quantum) rather than invented here — a fresh constant in a
 * forensic tool is an unagreed threshold, and this one already has a ratified meaning.
 *
 * Usage:
 *   node tools/pat-axis-leg-audit.mjs --selftest
 *   node tools/pat-axis-leg-audit.mjs <ppg-file> [...]
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const NOMINAL_MAX_MS = 2; // hostAxis `independent` threshold — see header
export const BIN_SEC = 300; // coupledPAT BIN_MIN = 5 min

const srt = (a) => a.slice().sort((x, y) => x - y);
const q = (a, p) => (a.length ? srt(a)[Math.min(a.length - 1, Math.floor((a.length - 1) * p))] : Number.NaN);

/* The worker's expression, verbatim — this is the thing under test, not a paraphrase of it. */
export function workerFootSec(rel, idx, fs) {
  return rel && rel[idx] != null && Number.isFinite(rel[idx]) ? rel[idx] : idx / fs;
}

/* What it INTENDED: interpolate relSec across the fractional index, as tools/pat-matchrate-strict.mjs
   `timeAt` already does and as ecgdex's `tMsAt` does arithmetically on the ECG leg. */
export function intendedFootSec(rel, idx, fs) {
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const ok = (k) => rel && rel[k] != null && Number.isFinite(rel[k]);
  if (!ok(lo) || !ok(hi)) return idx / fs;
  return rel[lo] + (idx - lo) * (rel[hi] - rel[lo]);
}

export function auditFeet(rel, feet, fs) {
  let branchTaken = 0;
  let fractional = 0;
  const pts = [];
  for (const idx of feet) {
    if (idx !== Math.floor(idx)) fractional++;
    if (rel && rel[idx] != null && Number.isFinite(rel[idx])) branchTaken++;
    const e = (intendedFootSec(rel, idx, fs) - workerFootSec(rel, idx, fs)) * 1000;
    if (Number.isFinite(e)) pts.push({ t: idx / fs, e });
  }
  const bins = new Map();
  for (const p of pts) {
    const b = Math.floor(p.t / BIN_SEC);
    if (!bins.has(b)) bins.set(b, []);
    bins.get(b).push(p);
  }
  const withinBin = [];
  for (const [, arr] of bins) {
    if (arr.length < 10) continue;
    const es = srt(arr.map((x) => x.e));
    withinBin.push(es[es.length - 1] - es[0]);
  }
  const all = pts.map((p) => p.e);
  const d = [];
  for (let i = 1; i < pts.length; i++) d.push(Math.abs(pts[i].e - pts[i - 1].e));
  return {
    n: feet.length,
    fractional,
    branchTaken,
    fragmentSpreadMs: all.length ? q(all, 1) - q(all, 0) : Number.NaN,
    withinBinMedianMs: q(withinBin, 0.5),
    withinBinP90Ms: q(withinBin, 0.9),
    withinBinMaxMs: withinBin.length ? Math.max(...withinBin) : Number.NaN,
    beatToBeatMedianMs: q(d, 0.5),
    bins: withinBin.length
  };
}

export function axisIsNominal(rel, n, fs) {
  let maxDev = 0;
  for (let i = 0; i < n; i++) {
    const dv = Math.abs(rel[i] - i / fs);
    if (dv > maxDev) maxDev = dv;
  }
  return { nominal: maxDev * 1000 < NOMINAL_MAX_MS, maxDevMs: maxDev * 1000 };
}

function selftest() {
  const fails = [];
  const ok = (c, m) => {
    if (!c) fails.push(m);
  };
  const fs = 100;
  const n = 1000;
  /* A relSec that DIVERGES from i/fs by a known ramp: 20 ms over the record. */
  const rel = new Float64Array(n);
  for (let i = 0; i < n; i++) rel[i] = i / fs + (0.02 * i) / (n - 1);
  ok(!axisIsNominal(rel, n, fs).nominal, 'a 20 ms ramp must not read as NOMINAL');
  const flat = new Float64Array(n);
  for (let i = 0; i < n; i++) flat[i] = i / fs;
  ok(axisIsNominal(flat, n, fs).nominal, 'an exactly-nominal axis must read as NOMINAL');

  /* THE BUG: fractional feet never take the relSec branch. */
  const fracFeet = [10.25, 200.5, 400.75, 600.125, 800.5];
  const a = auditFeet(rel, fracFeet, fs);
  ok(a.fractional === 5, `all 5 planted feet are fractional, got ${a.fractional}`);
  ok(a.branchTaken === 0, `relSec branch must be dead for fractional feet, taken ${a.branchTaken}`);

  /* POSITIVE CONTROL — the harness must be able to see the branch TAKEN. Integer feet on the same
     data take it, so a zero above is a property of fractional indexing and not of this test. */
  const intFeet = [10, 200, 400, 600, 800];
  const b = auditFeet(rel, intFeet, fs);
  ok(b.branchTaken === 5, `integer feet must take the relSec branch, taken ${b.branchTaken}`);
  ok(b.fragmentSpreadMs < 1e-9, 'integer feet: intended == worker, so spread is 0');

  /* MAGNITUDE: with a 20 ms ramp the fractional-foot error spans ~16 ms over these five feet. */
  ok(a.fragmentSpreadMs > 10 && a.fragmentSpreadMs < 20, `planted ramp error spread ~16 ms, got ${a.fragmentSpreadMs.toFixed(2)}`);

  console.log(fails.length ? `SELFTEST FAIL (${fails.length})\n  ${fails.join('\n  ')}` : 'SELFTEST PASS (7/7)');
  return fails.length === 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) {
    process.exit(selftest() ? 0 : 1);
  }
  const files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    console.error('usage: node tools/pat-axis-leg-audit.mjs --selftest | <ppg-file> [...]');
    process.exit(2);
  }
  const { getDsps } = await import(join(HERE, 'pat-matchrate-strict.mjs'));
  const { PPGDSP } = getDsps();
  const rows = [];
  for (const f of files) {
    let rec;
    try {
      rec = PPGDSP.parsePPG(readFileSync(f, 'utf8'));
    } catch (e) {
      console.log(`${f}: parse failed — ${e.message.slice(0, 70)}`);
      continue;
    }
    if (!rec || rec.t0Ms == null || !rec.relSec) {
      console.log(`${f}: no t0Ms/relSec`);
      continue;
    }
    const per = rec.ch.map((c) => PPGDSP.detectChannel(c, rec.fs));
    let refIdx = 0;
    let best = -1;
    per.forEach((p, i) => {
      if (p.peaks.length > best) {
        best = p.peaks.length;
        refIdx = i;
      }
    });
    const feet = PPGDSP.consensusBeats(per, refIdx, rec.fs).feet;
    const ax = axisIsNominal(rec.relSec, rec.n, rec.fs);
    const a = auditFeet(rec.relSec, feet, rec.fs);
    rows.push({ file: f.split('/').pop(), ax, a });
    console.log(`${f.split('/').pop()}`);
    console.log(`   axis ${ax.nominal ? 'NOMINAL' : 'REAL'} (max dev ${ax.maxDevMs.toFixed(1)} ms) · feet ${a.n} fractional ${a.fractional} · relSec branch taken ${a.branchTaken}/${a.n}`);
    console.log(`   within-5min-bin residual: median ${a.withinBinMedianMs.toFixed(2)} ms  p90 ${a.withinBinP90Ms.toFixed(2)}  max ${a.withinBinMaxMs.toFixed(2)}  (${a.bins} bins)`);
    console.log(`   beat-to-beat |delta| median ${a.beatToBeatMedianMs.toFixed(3)} ms  -> ramp, not jitter`);
  }
  if (rows.length > 1) {
    const wb = rows.map((r) => r.a.withinBinMedianMs).filter(Number.isFinite);
    const taken = rows.reduce((s, r) => s + r.a.branchTaken, 0);
    const tot = rows.reduce((s, r) => s + r.a.n, 0);
    console.log(`\nAGGREGATE over ${rows.length} files: relSec branch taken ${taken}/${tot} feet · within-bin residual median-of-medians ${q(wb, 0.5).toFixed(2)} ms`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('pat-axis-leg-audit.mjs')) await main();
