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
 * ⚠ FIRST ASK WHETHER THERE IS A SECOND CLOCK AT ALL (CLAUDE.md §7). A rate of ~0 ppm has two
 * OPPOSITE meanings: two independent clocks that agree, or a host column the capture app DERIVED from
 * the device stamp — the absence of a measurement wearing the shape of one. The discriminator is the
 * residual SPREAD about the fitted line, not the slope, and it is bimodal in this corpus: box captures
 * 101.89–5124 ms, phone captures 0.13–1.00 ms, nothing in between (the phone maximum is exactly one
 * stamp quantum, because its host column IS the device time rounded). Measured with this tool on three
 * ~8 h Polar-Sensor-Logger nights: −0.0 / 0.0 / −0.0 ppm at a residual spread of exactly 1.00 ms.
 * Before the `independent` check below, all three were long enough to be QUOTED in the summary, and a
 * reader would have taken "0.0 ppm, spread 0.0" as a perfect crystal. So a non-independent fragment
 * gets its rate REFUSED, not printed — same honesty rule as the Clock Contract's §2.6 null.
 *
 * Usage: node tools/dual-clock-rate.mjs <capture-night-dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { MAX_CRYSTAL_SPREAD_PPM, MS_PER_S_TO_PPM, crystalVerdict } from './device-stability.mjs';

/* σ_y comes from the SPINE's Allan core, not a local reimplementation — `clock.js` owns
   `allanFromPhase`/`allanSlope` and `device-stability.mjs` owns the one-reference-τ picker. This tool
   contributes only the phase series; every line of the statistics is borrowed. */
const _require = createRequire(import.meta.url);
const DexClock = _require(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'clock.js'));

const DIR = process.argv[2] || '/home/michal/tepna-smoketest/captures/2026-07-26';

/* The host stamp is written to millisecond resolution, so a host column derived from the device time
   lands within one quantum of the fitted line every row. Two quanta is the §7 threshold — a property
   of the data (the bimodality has a ~100× gap), not a tuned knob. */
const MIN_SPAN_MIN = 60;
export const HOST_QUANTUM_MS = 1;
export const INDEPENDENT_MIN_SPREAD_MS = 2 * HOST_QUANTUM_MS;
/* A CRYSTAL does not change rate between fragments of one night. The two Polar devices hold ±1.6 ppm
   across a night and ±2–3 ppm across four; the worst real crystal in this corpus is −3035 ppm but it is
   STABLE. So a wide cross-fragment spread is not an imprecise rate, it is the absence of one, and the
   median must be REFUSED rather than printed with a caveat beside it.
   This became load-bearing on 2026-08-01: the O2Ring's axis stopped being DRAWN (identical-delta share
   99.4 % on 2026-07-27 → 2.2 %), so the drawn check no longer catches it — and it promptly reported a
   median of 160.5 ppm at a spread of 2282.6. Something in the capture changed; it did not become a
   clock. A device can fail this check for a new reason after passing an old one. */
/* ONE IMPLEMENTATION, OWNED BY `device-stability.mjs` (CROSS-DEVICE-DRIFT-FOLLOWUPS §Done-when).
   The bound was authored here and COPIED there, which is why that file carries the comment "…and it
   must apply here too or this tool re-prints the numbers that one rejects". Two copies of a decision
   rule drift silently: nothing fails when only one is updated, and the two tools then disagree about
   the same night. The richer verdict lives there — it adds a weighted-χ² test THROUGH the error bars —
   so the direction of the merge is toward it, and this re-export keeps the name importable here.

   ⚠️ HALF OF THAT DONE-WHEN ITEM IS **NOT** SATISFIED, AND SAYING SO IS THE POINT. It asks that this
   tool's rule "read uncertainties". It cannot yet: this tool computes NO per-fragment uncertainty —
   there is no `ppmUncertainty`, `sigma` or `stderr` anywhere in it, and `device-stability.mjs`
   sources its own from σ_y at the recording's own span, i.e. from the Allan machinery this tool does
   not run. So `crystalVerdict` here takes its no-uncertainties branch and falls back to the raw
   bound — deliberately, since that branch exists precisely to refuse inventing a σ, and a fabricated
   error bar would make every spread explicable. Sharing the implementation landed in #1530; READING
   uncertainties landed 2026-08-27 — each fragment now carries `ppmUncertainty` from σ_y at REF_TAU_SEC
   (spine Allan core, `device-stability.sigmaAtRefTau`), so the χ² branch is reachable. A fragment whose
   curve does not reach that τ still yields null, and the fallback still refuses to invent one. */
export { MAX_CRYSTAL_SPREAD_PPM };

/* PURE decision predicate for the per-device roll-up, separated from the I/O for the same reason
   `classifyRate` is — so it is gateable on values rather than by scanning the streaming loop. */
export function crystalCoherence(vals) {
  const v = crystalVerdict(vals || []);
  /* `chi2` and `note` are ADDITIVE and load-bearing for the reader: they say WHICH branch decided.
     A `not-a-crystal` with note 'no uncertainties' is the raw-bound fallback; one with a finite chi2
     is the actual test. Collapsing both to a boolean is how the fallback hid. */
  return { incoherent: v.verdict === 'not-a-crystal', verdict: v.verdict, spreadPpm: v.spreadPpm, n: v.n, chi2: v.chi2 ?? null, note: v.note ?? null };
}

/* PURE decision predicate — what this tool is entitled to CONCLUDE from one fragment's fit. Separated
   from the I/O so it is gateable on values (tests/dex-tests.js `dual-clock-rate`), which a source scan
   over the streaming loop could never be. Order matters: a DRAWN device axis is reported even when the
   host column is also non-independent, because it names a different, more serious defect. */
export function classifyRate(r) {
  if (!r || !isFinite(r.ppm)) return { usable: false, kind: 'unreadable', reason: 'no fit' };
  if (r.drawn)
    return {
      usable: false,
      kind: 'drawn-device-axis',
      reason: 'device axis is DRAWN (' + (100 * r.quantizedShare).toFixed(1) + '% of deltas identical) — this ppm is the assumed-rate error, not a clock'
    };
  if (!isFinite(r.residualSpreadMs) || r.residualSpreadMs <= INDEPENDENT_MIN_SPREAD_MS)
    return {
      usable: false,
      kind: 'no-second-clock',
      reason:
        'residual spread ' +
        (isFinite(r.residualSpreadMs) ? r.residualSpreadMs.toFixed(2) : '?') +
        ' ms ≤ ' +
        INDEPENDENT_MIN_SPREAD_MS +
        ' ms — the host column is the device stamp, so there is NO second clock here and this ppm is not a rate'
    };
  if (r.spanMin < MIN_SPAN_MIN) return { usable: false, kind: 'too-short', reason: 'under ' + MIN_SPAN_MIN + ' min, not a rate' };
  return { usable: true, kind: 'rate', reason: '' };
}

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
  /* The residual SPREAD is the independence discriminator (§7) and it cannot be had from running sums
     alone — it needs the fit before it can measure deviation from it. Keeping the subsampled points is
     cheap: every 200th row of an 8 h 130 Hz fragment is ~19k points. */
  const px = [],
    py = [];
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
    px.push(x);
    py.push(y);
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
  const intercept = (sy - slope * sx) / kept;
  let rMin = Infinity,
    rMax = -Infinity;
  for (let i = 0; i < px.length; i++) {
    const e = py[i] - (slope * px[i] + intercept);
    if (e < rMin) rMin = e;
    if (e > rMax) rMax = e;
  }
  const residualSpreadMs = rMax - rMin;
  /* PER-FRAGMENT UNCERTAINTY (CROSS-DEVICE-DRIFT-FOLLOWUPS §"reads uncertainties").
     The residuals about the fitted line ARE a phase series in ms, sampled uniformly in the device
     axis, which is exactly what ADEV wants. σ_y at one reference τ is then the fragment's own rate
     uncertainty, in the same unit as `ppm` so the two are comparable at all.
     ⚠ It REFUSES rather than substitutes: `sigmaAtRefTau` returns null when the curve does not reach
     REF_TAU_SEC within tolerance, and a short fragment simply has no error bar. That is the whole
     point — `crystalVerdict`'s no-uncertainties branch exists to avoid inventing one, and a
     fabricated bar would make every spread explicable. */
  const resid = [];
  for (let i = 0; i < px.length; i++) resid.push(py[i] - (slope * px[i] + intercept));
  let uncPpm = null,
    uncTauSec = null;
  if (resid.length >= 8 && spanMin > 0) {
    const spanSec = spanMin * 60;
    const tau0Sec = spanSec / (resid.length - 1);
    const curve = DexClock.allanFromPhase(resid, tau0Sec);
    /* ⚠ σ_y AT THE WRONG τ IS NOT THIS FRAGMENT'S RATE UNCERTAINTY, and the naive reading is off by
       two orders of magnitude. σ_y(256 s) on this corpus is ~300 ppm — it measures BLE delivery jitter
       at short averaging times — while the same device's rate reproduces to 1.1 ppm across a night's
       fragments. Quoting the short-τ figure as the error bar would make EVERY spread explicable, which
       is the fabricated-bar failure `crystalVerdict`'s fallback exists to avoid.
       The rate is fitted over the WHOLE span, so its uncertainty is σ_y at τ = span. That τ is past the
       last measured point (the curve reaches ~span/4), so it is reached by extrapolating ALONG THE
       FITTED SLOPE from the longest MEASURED point — a factor of ~4, anchored on data, using the
       spine's own `allanSlope`. The slope is used NUMERICALLY; no noise TYPE is named, deliberately —
       `clock.js` refuses to name one near a boundary and nothing here needs the name. */
    const fit = curve && curve.length ? DexClock.allanSlope(curve) : null;
    let anchor = null;
    for (const pt of curve || []) if (pt.tau > 0 && pt.adev > 0 && (anchor === null || pt.tau > anchor.tau)) anchor = pt;
    if (fit && anchor && spanSec > anchor.tau) {
      uncPpm = anchor.adev * MS_PER_S_TO_PPM * Math.pow(spanSec / anchor.tau, fit.slope);
      uncTauSec = spanSec;
    }
  }
  return {
    file: path.basename(file),
    spanMin,
    ppm: (slope - 1) * 1e6,
    /* §🔒.7 — a rate is never quoted without its span, and an error bar is a rate. `ppmUncertainty`
       is meaningless without the τ it was read at, so the two travel together or not at all. */
    ppmUncertainty: uncPpm,
    uncertaintyTauSec: uncTauSec,
    samples: kept,
    quantizedShare,
    drawn: quantizedShare != null && quantizedShare >= 0.99,
    residualSpreadMs,
    independent: residualSpreadMs > INDEPENDENT_MIN_SPREAD_MS
  };
}

/* A ppm slope needs TIME LEVERAGE, and file size is not a proxy for it — a high-rate ECG
   fragment can exceed 3 MB while spanning eleven minutes. Measured on 2026-07-27 with this
   tool: the 373-minute H10 fragment gives -20.3 ppm, the 10.9-minute one gives -65.8. Both
   pass a 3 MB filter; only one is a rate. Fragments under MIN_SPAN_MIN are still printed —
   silently dropping them would hide how few long fragments a night actually has — but they
   are marked, and excluded from any summary a reader would quote. */

/* Importable: the predicate above is gated on VALUES by tests/dex-tests.js, and importing a module
   must not fire its I/O. Only a direct `node tools/dual-clock-rate.mjs …` runs the report. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = fs.readdirSync(DIR).filter((f) => /(H10.*_ECG|(?:Verity)?Sense.*_PPG|O2Ring.*_PPG)\.txt$/.test(f));
  const big = files
    .map((f) => ({ f, sz: fs.statSync(path.join(DIR, f)).size }))
    .filter((x) => x.sz > 3e6)
    .sort((a, b) => b.sz - a.sz)
    .slice(0, 6);
  console.log('DEVICE RATE vs HOST CLOCK — measured directly from the two columns in each raw file\n');
  const byDev = {};
  const entriesBy = {}; // device -> [{ppm, ppmUncertainty}] for the χ² crystal verdict
  const drawnBy = {}; // device -> count of long fragments whose axis is drawn
  const refusedBy = {}; // device -> { kind: count } — why a fragment yielded no rate
  console.log('device   spanMin   ppm vs host   sigma_y ppm @tau   resid ms   samples   file');
  for (const { f } of big) {
    const r = await rateOf(path.join(DIR, f));
    if (!r) {
      console.log('  (unreadable)', f);
      continue;
    }
    const dev = /H10/.test(f) ? 'H10   ' : /Verity/.test(f) ? 'VERITY' : 'O2RING';
    const k = dev.trim();
    /* ONE predicate decides whether this fragment yields a rate. It used to be an inline
       `spanMin < 60` test, which admitted every non-independent fragment — and those are the
       dangerous ones, because they are long AND look perfect. */
    const v = classifyRate(r);
    if (v.usable) {
      if (!byDev[k]) byDev[k] = [];
      byDev[k].push(r.ppm);
      /* Parallel entry array carrying the error bar. `vals` stays numeric because the median/spread
         display is a different question from the verdict; the verdict now gets what it always wanted. */
      if (!entriesBy[k]) entriesBy[k] = [];
      entriesBy[k].push({ ppm: r.ppm, ppmUncertainty: r.ppmUncertainty });
    } else {
      if (!refusedBy[k]) refusedBy[k] = {};
      refusedBy[k][v.kind] = (refusedBy[k][v.kind] || 0) + 1;
    }
    if (r.drawn) drawnBy[k] = (drawnBy[k] || 0) + 1;
    /* A REFUSED fragment shows a dash where its ppm was. Printing the number next to the reason it
       is not a rate invites exactly the quote the reason forbids. */
    const shown = v.usable ? r.ppm.toFixed(1) : '—';
    /* §🔒.7 — the error bar travels WITH its τ or not at all. A fragment whose Allan curve does not
       reach REF_TAU_SEC prints a dash: it has no uncertainty, which is a fact about the fragment, not
       a zero. */
    const unc = v.usable && r.ppmUncertainty != null ? `${r.ppmUncertainty.toFixed(2)} @${Math.round(r.uncertaintyTauSec)}s` : '—';
    console.log(
      `${dev}  ${r.spanMin.toFixed(1).padStart(7)}   ${shown.padStart(11)}   ${unc.padStart(15)}   ${r.residualSpreadMs.toFixed(2).padStart(9)}   ${String(r.samples).padStart(7)}   ${r.file}${v.usable ? '' : '   ← ' + v.reason}`
    );
  }

  /* Summary over fragments that ACTUALLY YIELD A RATE. A wide spread is the SYMPTOM; where the axis is
     drawn, the CAUSE is named instead — `not a disciplined clock` is true of the O2Ring but points at its
     crystal, which is innocent. There is no crystal in the file at all (O2RING-SYNTHESISED-AXIS §5).
     A device with NO usable fragment gets a line saying so rather than no line: silence would read as
     "not present in this capture", which is a different fact. */
  console.log('\n            fragments yielding a rate   median ppm   spread');
  const devices = Array.from(new Set([...Object.keys(byDev), ...Object.keys(refusedBy)])).sort();
  for (const dev of devices) {
    const vals = byDev[dev] || [];
    const ref = refusedBy[dev] || {};
    const refTxt = Object.entries(ref)
      .map(([kind, n]) => n + ' ' + kind)
      .join(', ');
    if (!vals.length) {
      console.log(`  ${dev.padEnd(8)} ${String(0).padStart(24)}   ${'—'.padStart(10)}   ${'—'.padStart(6)}   ← NO RATE from this capture (${refTxt || 'none read'})`);
      continue;
    }
    const s2 = vals.slice().sort((a, b) => a - b);
    const md = s2[s2.length >> 1];
    const spread = s2[s2.length - 1] - s2[0];
    const nDrawn = drawnBy[dev] || 0;
    const coh = crystalCoherence(entriesBy[dev] || []);
    const incoherent = coh.incoherent;
    const why = nDrawn
      ? `   ← ${nDrawn} fragment(s) have a DRAWN axis: no device clock in the file, so those ppm are drawing error`
      : incoherent
        ? `   ← REFUSED: fragments of one night disagree by ${spread.toFixed(0)} ppm (> ${MAX_CRYSTAL_SPREAD_PPM}). A crystal does not do that — this is not a rate`
        : '';
    console.log(
      `  ${dev.padEnd(8)} ${String(vals.length).padStart(24)}   ${(incoherent ? '—' : md.toFixed(1)).padStart(10)}   ${spread.toFixed(1).padStart(6)}${why}${refTxt ? '   (refused: ' + refTxt + ')' : ''}`
    );
  }
}
