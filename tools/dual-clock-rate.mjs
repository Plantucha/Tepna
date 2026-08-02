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
 * unwrap artifact. The O2Ring's `sensor timestamp` column is NOT a clock and must never be used as one:
 * it is DRAWN (WEARABLE-HOST-AXIS-2026-08-02 §3) — `sample_index x 7,953,045 ns` on every session up to
 * 2026-07-27, one delta value at 100 % across 16 files. Its apparent ppm is the error in that assumed
 * rate, not a crystal property, which is why it is erratic and occasionally near-perfect. Do NOT respond
 * by re-calibrating the constant: a better number makes a drawn axis more plausible without making it a
 * measurement, and erases the evidence that it is drawn.
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
  let header = null,
    n = 0,
    kept = 0;
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  let t0 = null,
    d0 = null,
    lastT = null,
    lastD = null;
  /* Delta distribution, to name the CAUSE rather than only the symptom (O2RING-SYNTHESISED-AXIS §5).
     A drawn axis is `sample_index x constant`, so essentially every consecutive delta is identical.
     Counted on EVERY row (not the subsample the slope uses) because quantization is a property of
     adjacent samples — subsampling every 200th row would compare non-adjacent ones and see jitter
     that is not there. Reference delta is the first observed; for a drawn axis that IS the modal one. */
  let prevRaw = null,
    dRef = null,
    dSame = 0,
    dTot = 0;
  for await (const line of rl) {
    if (header === null) {
      header = line;
      continue;
    }
    n++;
    {
      const rawNs = Number(line.split(';')[1]);
      if (isFinite(rawNs)) {
        if (prevRaw !== null) {
          const dd = rawNs - prevRaw;
          if (dd > 0) {
            if (dRef === null) dRef = dd;
            if (dd === dRef) dSame++;
            dTot++;
          }
        }
        prevRaw = rawNs;
      }
    }
    if (n % 200 !== 0) continue; // subsample: the SLOPE needs spread, not every row
    const f = line.split(';');
    if (f.length < 2) continue;
    const ph = parsePhone(f[0]);
    const dv = Number(f[1]);
    if (ph == null || !isFinite(dv) || dv <= 0) continue;
    if (t0 == null) {
      t0 = ph;
      d0 = dv;
    }
    const x = (dv - d0) / 1e6; // device ms elapsed
    const y = ph - t0; // host ms elapsed
    if (!isFinite(x) || !isFinite(y)) continue;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
    kept++;
    lastT = ph;
    lastD = dv;
  }
  if (kept < 50) return null;
  const den = kept * sxx - sx * sx;
  if (!den) return null;
  const slope = (kept * sxy - sx * sy) / den; // host ms per device ms
  const spanMin = (lastT - t0) / 60000;
  const quantizedShare = dTot > 20 ? dSame / dTot : null;
  return { file: path.basename(file), spanMin, ppm: (slope - 1) * 1e6, samples: kept, quantizedShare, drawn: quantizedShare != null && quantizedShare >= 0.99 };
}

/* A ppm slope needs TIME LEVERAGE, and file size is not a proxy for it — a high-rate ECG
   fragment can exceed 3 MB while spanning eleven minutes. Measured on 2026-07-27 with this
   tool: the 373-minute H10 fragment gives -20.3 ppm, the 10.9-minute one gives -65.8. Both
   pass a 3 MB filter; only one is a rate. Fragments under MIN_SPAN_MIN are still printed —
   silently dropping them would hide how few long fragments a night actually has — but they
   are marked, and excluded from any summary a reader would quote. */
const MIN_SPAN_MIN = 60;

const files = fs.readdirSync(DIR).filter((f) => /(H10.*_ECG|VeritySense.*_PPG|O2Ring.*_PPG)\.txt$/.test(f));
const big = files
  .map((f) => ({ f, sz: fs.statSync(path.join(DIR, f)).size }))
  .filter((x) => x.sz > 3e6)
  .sort((a, b) => b.sz - a.sz)
  .slice(0, 6);
console.log('DEVICE RATE vs HOST CLOCK — measured directly from the two columns in each raw file\n');
const byDev = {};
const drawnBy = {}; // device -> count of long fragments whose axis is drawn
console.log('device   spanMin   ppm vs host   samples   file');
for (const { f } of big) {
  const r = await rateOf(path.join(DIR, f));
  if (!r) {
    console.log('  (unreadable)', f);
    continue;
  }
  const dev = /H10/.test(f) ? 'H10   ' : /Verity/.test(f) ? 'VERITY' : 'O2RING';
  const short = r.spanMin < MIN_SPAN_MIN;
  if (!short) {
    const k = dev.trim();
    if (!byDev[k]) byDev[k] = [];
    byDev[k].push(r.ppm);
  }
  if (r.drawn) drawnBy[dev.trim()] = (drawnBy[dev.trim()] || 0) + 1;
  /* A DRAWN axis outranks every other note on the row: `under 60 min, not a rate` is about
     precision, but a drawn axis has no rate to be imprecise about. */
  const note = r.drawn
    ? `   ← DRAWN axis (${(100 * r.quantizedShare).toFixed(1)}% of deltas identical) — this ppm is the assumed-rate error, not a clock`
    : short
      ? `   ← under ${MIN_SPAN_MIN} min, not a rate`
      : '';
  console.log(`${dev}  ${r.spanMin.toFixed(1).padStart(7)}   ${r.ppm.toFixed(1).padStart(11)}   ${String(r.samples).padStart(7)}   ${r.file}${note}`);
}

/* Summary over the long fragments only. A wide spread is the SYMPTOM; where the axis is drawn, the
   CAUSE is named instead — `not a disciplined clock` is true of the O2Ring but points at its crystal,
   which is innocent. There is no crystal in the file at all (O2RING-SYNTHESISED-AXIS §5). */
console.log('\n            fragments ≥' + MIN_SPAN_MIN + ' min   median ppm   spread');
for (const [dev, vals] of Object.entries(byDev)) {
  if (!vals.length) continue;
  const s2 = vals.slice().sort((a, b) => a - b);
  const md = s2[s2.length >> 1];
  const spread = s2[s2.length - 1] - s2[0];
  const nDrawn = drawnBy[dev] || 0;
  const why = nDrawn ? `   ← ${nDrawn}/${vals.length} fragments have a DRAWN axis: no device clock in the file, so these ppm are drawing error` : spread > 50 ? '   ← not a disciplined clock' : '';
  console.log(`  ${dev.padEnd(8)} ${String(vals.length).padStart(12)}   ${md.toFixed(1).padStart(10)}   ${spread.toFixed(1).padStart(6)}${why}`);
}
