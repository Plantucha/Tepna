/*
 * derive-sigma-window.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Headless derivation of the two raw-signal 1-Hz HR series a three-device σ
 * window needs (VERITY-SIGMA-CORNER-BRIEF / SIGMA-WINDOW-DERIVATION.md):
 *   • Verity HR  ← raw PPG  via the suite's PPGDSP (SQI-gated)
 *   • H10 HR     ← raw ECG  via the suite's ECGDSP (Pan-Tompkins QRS)
 * It REUSES the production detectors unchanged — it only runs them on more data.
 * Run it where the raw Polar Sensor Logger files live (your machine): they are
 * ~150–350 MB each and exceed this project's 30 MiB ingest limit, so the
 * derivation must happen locally, then the small 1-Hz outputs drop into uploads/.
 *
 * USAGE (Node ≥ 18, run from the project root so it can load the *-dsp.js):
 *   node tools/derive-sigma-window.mjs \
 *        --ppg  "Ecg nightly/Polar_Sense_..._PPG.txt"   (repeat --ppg for each part, in order) \
 *        --ecg  "Ecg nightly/Polar_H10_..._ECG.txt"     (repeat --ecg for each part, in order) \
 *        --date 2026-06-16                              (morning date → output filenames) \
 *        --out  uploads
 *   # PPG-only or ECG-only is fine — pass just the legs you want to derive.
 *
 * Output (the exact format the analysis tool ingests):
 *   uploads/verity-ppg-derived-<date>-HR.txt   "tMs;hr;sqiMean"
 *   uploads/h10-ecg-derived-<date>-HR.txt      "tMs;hr;src"
 *
 * Then append a TRIOS entry in sigma-no-reference-analysis.js (commented stubs
 * for 06-10/11/13/15 are already staged there) and re-run the tool.
 *
 * Clock Contract: timing comes from the modules' own parseTimestamp (PPG) and a
 * mirrored ISO-no-zone regex → Date.UTC (ECG). No new Date(str) on vendor stamps.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// ── tiny arg parser ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const ppg = [],
  ecg = [];
let date = null,
  out = 'uploads',
  sqiGate = 0.5;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--ppg') ppg.push(args[++i]);
  else if (a === '--ecg') ecg.push(args[++i]);
  else if (a === '--date') date = args[++i];
  else if (a === '--out') out = args[++i];
  else if (a === '--sqi-gate') sqiGate = +args[++i];
}
if (!date) {
  console.error('need --date YYYY-MM-DD (morning date of the overnight window)');
  process.exit(1);
}

// ── load the production detectors (IIFEs that assign global.PPGDSP/ECGDSP) ──
// The modules close over `window`; in Node we point that at globalThis.
globalThis.window = globalThis;
async function load(p) {
  await import(pathToFileURL(p).href);
}
await load('./ppgdex-dsp.js');
await load('./ecgdex-dsp.js');
const PPGDSP = globalThis.PPGDSP,
  ECGDSP = globalThis.ECGDSP;

const sFloorMs = (ms) => Math.floor(ms / 1000) * 1000;
// concat parts, keeping the header from the first only
function concatParts(paths) {
  let head = '',
    body = '';
  paths.forEach((p, i) => {
    const t = readFileSync(p, 'utf8');
    const nl = t.indexOf('\n');
    if (i === 0) {
      head = t.slice(0, nl + 1);
      body += t.slice(nl + 1);
    } else body += t.slice(nl + 1);
  });
  return head + body;
}
// bucket per-beat (timeMs, hr, sqi) → 1-Hz mean rows
function toOneHz(beats) {
  const m = new Map();
  for (const b of beats) {
    if (!(b.hr >= 30 && b.hr <= 220)) continue;
    const k = sFloorMs(b.tMs),
      a = m.get(k) || { h: 0, q: 0, n: 0 };
    a.h += b.hr;
    a.q += b.sqi == null ? 1 : b.sqi;
    a.n++;
    m.set(k, a);
  }
  return [...m.keys()]
    .sort((x, y) => x - y)
    .map((k) => {
      const a = m.get(k);
      return { tMs: k, hr: a.h / a.n, sqi: a.q / a.n };
    });
}

// ── Verity: raw PPG → PPGDSP → SQI-gated 1-Hz HR ───────────────────────────
if (ppg.length) {
  console.log(`[PPG] ${ppg.length} part(s) → PPGDSP…`);
  const rec = PPGDSP.parsePPG(concatParts(ppg));
  const res = PPGDSP.analyze(rec);
  const peakSec = res.beatTimes || [],
    sqi = res.sqi || [],
    t0 = res.t0Ms ?? rec.t0Ms;
  const beats = [];
  for (let i = 1; i < peakSec.length; i++) {
    const pp = peakSec[i] - peakSec[i - 1];
    if (!(pp > 0.27 && pp < 2.0)) continue; // 30–220 bpm
    const q = sqi[i];
    if (q != null && q < sqiGate) continue; // SQI gate
    beats.push({ tMs: t0 + peakSec[i] * 1000, hr: 60 / pp, sqi: q });
  }
  const rows = toOneHz(beats);
  const f = `${out}/verity-ppg-derived-${date}-HR.txt`;
  writeFileSync(f, 'tMs;hr;sqiMean\n' + rows.map((r) => `${r.tMs};${r.hr.toFixed(2)};${r.sqi.toFixed(2)}`).join('\n') + '\n');
  console.log(
    `[PPG] meanSQI≈${res.meanSQI} · ${rows.length} 1-Hz s · ${rows.length ? new Date(rows[0].tMs).toISOString().slice(11, 19) : '—'}…${rows.length ? new Date(rows[rows.length - 1].tMs).toISOString().slice(11, 19) : ''} → ${f}`
  );
}

// ── H10: raw ECG → ECGDSP (Pan-Tompkins) → 1-Hz HR ─────────────────────────
function parseECG(text) {
  // columns: Phone timestamp ; sensor ts [ns] ; timestamp [ms] ; ecg [uV]
  const L = text.split(/\r?\n/);
  const uv = [];
  let t0 = null,
    firstRelMs = null,
    lastRelMs = null,
    n = 0;
  const iso = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/;
  for (let i = 1; i < L.length; i++) {
    if (!L[i]) continue;
    const c = L[i].split(';');
    if (c.length < 4) continue;
    const v = +c[3];
    if (!isFinite(v)) continue;
    let clamp = Math.round(v);
    if (clamp > 32767) clamp = 32767;
    if (clamp < -32768) clamp = -32768;
    uv.push(clamp);
    const rel = +c[2];
    if (isFinite(rel)) {
      if (firstRelMs == null) firstRelMs = rel;
      lastRelMs = rel;
    }
    if (t0 == null) {
      const m = c[0].match(iso);
      if (m) t0 = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].padEnd(3, '0') : 0);
    }
    n++;
  }
  const fs = firstRelMs != null && lastRelMs != null && lastRelMs > firstRelMs ? (n - 1) / ((lastRelMs - firstRelMs) / 1000) : 130;
  return { int16: Int16Array.from(uv), fs: Math.round(fs * 100) / 100, t0Ms: t0 };
}
if (ecg.length) {
  console.log(`[ECG] ${ecg.length} part(s) → ECGDSP (fs auto)…`);
  const rec = parseECG(concatParts(ecg));
  const res = ECGDSP.analyze(rec);
  const tt = res.tt || [],
    nn = res.nn || [],
    t0 = res.t0Ms ?? rec.t0Ms; // tt = beat times (s), nn = NN (ms)
  const beats = [];
  for (let i = 0; i < tt.length; i++) {
    const hr = 60000 / nn[i];
    if (hr >= 30 && hr <= 220) beats.push({ tMs: t0 + tt[i] * 1000, hr, sqi: 1 });
  }
  const rows = toOneHz(beats);
  const f = `${out}/h10-ecg-derived-${date}-HR.txt`;
  writeFileSync(f, 'tMs;hr;src\n' + rows.map((r) => `${r.tMs};${r.hr.toFixed(2)};ecg`).join('\n') + '\n');
  console.log(`[ECG] fs≈${rec.fs} · ${rows.length} 1-Hz s → ${f}`);
}

console.log('done. Append a TRIOS entry in sigma-no-reference-analysis.js and re-run the analysis tool.');
