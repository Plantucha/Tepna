/*
 * tools/dual-clock-rate.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * DIRECT device-vs-host rate, from the two clocks already in every raw file.
   Polar Sensor Logger / the capture host write BOTH:
     "Phone timestamp"      — the HOST clock (chrony-disciplined on the vigil box, 0.008 ppm)
     "sensor timestamp [ns]" — the DEVICE's own crystal
   Regressing one against the other inside a single fragment gives that device's rate offset in ppm
   directly. No beat matching, no 5-min blocks, no comb, no unwrapping — none of the machinery that
   has produced four retractions. If a device runs fast against the host, this sees it.
 *
 * MEASURED (WEARABLE-DRIFT-DIRECT-2026-08-02): H10 -20 ppm and Verity -27 ppm against the host, each
 * stable to +-2-3 ppm across fragments AND across four nights, so the inter-device rate is ~7 ppm —
 * 176 ms over a 7 h night, comfortably under one RR. Beat-derived estimates of 89-216 ppm are an
 * unwrap artifact. The O2Ring's `sensor timestamp` column is NOT a clock (-1441 to +141 ppm between
 * fragments of one night) and must never be used as one.
 *
 * Usage: node tools/dual-clock-rate.mjs <capture-night-dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const DIR = process.argv[2] || '/home/michal/tepna-smoketest/captures/2026-07-26';

function parsePhone(s) {
  // Clock Contract: components as written -> Date.UTC (floating wall clock). Never Date.parse.
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(s);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].padEnd(3, '0') : 0);
}

async function rateOf(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let header = null, n = 0, kept = 0;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  let t0 = null, d0 = null, lastT = null, lastD = null;
  for await (const line of rl) {
    if (header === null) { header = line; continue; }
    n++;
    if (n % 200 !== 0) continue; // subsample: the SLOPE needs spread, not every row
    const f = line.split(';');
    if (f.length < 2) continue;
    const ph = parsePhone(f[0]);
    const dv = Number(f[1]);
    if (ph == null || !isFinite(dv) || dv <= 0) continue;
    if (t0 == null) { t0 = ph; d0 = dv; }
    const x = (dv - d0) / 1e6; // device ms elapsed
    const y = ph - t0; // host ms elapsed
    if (!isFinite(x) || !isFinite(y)) continue;
    sx += x; sy += y; sxx += x * x; sxy += x * y; kept++;
    lastT = ph; lastD = dv;
  }
  if (kept < 50) return null;
  const den = kept * sxx - sx * sx;
  if (!den) return null;
  const slope = (kept * sxy - sx * sy) / den; // host ms per device ms
  const spanMin = (lastT - t0) / 60000;
  return { file: path.basename(file), spanMin, ppm: (slope - 1) * 1e6, samples: kept };
}

const files = fs.readdirSync(DIR).filter((f) => /(H10.*_ECG|VeritySense.*_PPG|O2Ring.*_PPG)\.txt$/.test(f));
const big = files.map((f) => ({ f, sz: fs.statSync(path.join(DIR, f)).size })).filter((x) => x.sz > 3e6).sort((a, b) => b.sz - a.sz).slice(0, 6);
console.log('DEVICE RATE vs HOST CLOCK — measured directly from the two columns in each raw file\n');
console.log('device   spanMin   ppm vs host   samples   file');
for (const { f } of big) {
  const r = await rateOf(path.join(DIR, f));
  if (!r) { console.log('  (unreadable)', f); continue; }
  const dev = /H10/.test(f) ? 'H10   ' : /Verity/.test(f) ? 'VERITY' : 'O2RING';
  console.log(`${dev}  ${r.spanMin.toFixed(1).padStart(7)}   ${r.ppm.toFixed(1).padStart(11)}   ${String(r.samples).padStart(7)}   ${r.file}`);
}
