/*
 * tools/device-stability.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * PER-DEVICE TIMING STABILITY, measured against the capture host.
 *
 * This executes the open item in `CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md` §5:
 *
 *   "If per-device timing σ is genuinely wanted, get a third MECHANICAL channel — or measure against
 *    the capture host, which is an independent timing path by construction. Two IMUs is one short."
 *
 * The second route is the one taken here, and the reason is that brief's own §2.6. It pointed
 * `integrator-tch.js` at timing and got σ_ECG = 128 ms — which is not the ECG's clock at all. Both
 * ECG-containing pairs carry PULSE ARRIVAL TIME, so a three-cornered hat over beat-derived offsets
 * attributes physiology to a device. TCH's precondition is independent per-device noise, and beat
 * offsets cannot satisfy it because the pulse is common to all three devices by construction.
 *
 * Measuring against the HOST removes that contamination completely: `Phone timestamp` vs
 * `sensor timestamp [ns]` involves no beat, no pulse, no physiology — it is one device's counter
 * against one disciplined clock. Nothing in it can carry a transit delay, which is exactly the
 * property §2.6 found missing and the reason it wanted "a third MECHANICAL channel".
 *
 * ⚠ WHAT THIS DOES *NOT* REMOVE — and the slope is what tells you. The host stamp is written on BLE
 * ARRIVAL, so the phase series carries delivery jitter (an integer number of connection intervals:
 * H10 45 ms, Verity 30 ms) and the host's own scheduler on top of the crystal. That contamination is
 * not a defect to be subtracted, it is a noise TYPE to be identified: delivery jitter is white phase
 * (τ⁻¹ — it averages away), while a crystal wandering is τ⁺¹ᐟ² (it does not). σ_y(τ)'s slope
 * separates them, which a single σ structurally cannot. This is why the answer here is a CURVE and
 * not the one number §5 asked for; see the brief's §Answer.
 *
 * ⚠ NOT A FOURTH ALLAN IMPLEMENTATION (HOSTAXIS-STABILITY §4.3 forbids one). The curve, the slope,
 * its SE and the noise-type naming all come from `DexClock` — the same spine core the bundles inline
 * and the same one pinned against `capture-host/allan.py` by the `detector-stability` parity group.
 * This file contributes the CORPUS WALK and the per-device roll-up, nothing numerical.
 *
 * Usage:
 *   node tools/device-stability.mjs <corpus-dir> [--json out.json] [--every N]
 *   node tools/device-stability.mjs --selftest
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const DexClock = require(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'clock.js'));

/* Every 200th row, matching `dual-clock-rate.mjs`. The slope needs SPREAD, not every sample, and an
   8 h 130 Hz fragment still leaves ~19k points — far more than the ~10 octave τ the curve can carry.
   Subsampling by ROW keeps the series uniform in the DEVICE axis (the device counter advances at a
   constant rate by construction), which is what ADEV requires. */
export const DEFAULT_EVERY = 200;

/* A stream must be long enough to carry octave τ up to a useful fraction of its span. Below this the
   curve is 2–3 points and its slope is a line through noise — refused rather than printed, because a
   slope IS the finding here and a bad one names the wrong mechanism. */
export const MIN_SPAN_MIN = 20;
export const MIN_TAUS = 4;

/* 🔴 σ_y IS A FUNCTION OF τ, SO TWO DEVICES MAY ONLY BE COMPARED AT THE SAME τ.
   This is the whole reason the suite computes a curve instead of a number, and it is still easy to
   throw away at the last step by tabulating each stream's σ at ITS OWN longest τ. Measured on this
   corpus: τ₀ spans 1.13–19.48 s and τmax spans 311–16153 s, a 52× range — so a σ@τmax column ranks
   streams partly by how long they happened to run and at what rate they happened to sample.
   Every cross-device comparison here is therefore read at ONE reference τ, and a stream whose curve
   does not reach it is REFUSED rather than compared at whatever τ it does reach.
   256 s: octave-friendly (the curve is octave-spaced), an order above the largest τ₀ so it is never
   the first point, and well inside the ~1000 s median τmax so most streams reach it. */
export const REF_TAU_SEC = 256;
export const REF_TAU_TOLERANCE = 2; // nearest octave point must be within this factor of REF_TAU_SEC

/* A CRYSTAL DOES NOT CHANGE RATE BETWEEN FRAGMENTS OF ONE NIGHT — `dual-clock-rate.mjs`'s rule
   (MAX_CRYSTAL_SPREAD_PPM), and it must apply here too or this tool re-prints the numbers that one
   refuses. The O2Ring is the case it was written for: WEARABLE-DRIFT-DIRECT §7.1 records it swinging
   2282.6 ppm between fragments of a single night AFTER it stopped being drawn, so the drawn check
   alone no longer disqualifies it. A wide within-night spread is not an imprecise rate, it is the
   ABSENCE of one, and the honest response is to refuse the device for that night rather than print a
   median with a caveat beside it (CROSS-DEVICE-DRIFT-AND-CLOSURE §6: do not quote a ppm that has not
   closed). ⚠ Known limit, inherited: with only ONE usable fragment the spread cannot be computed and
   the check cannot fire. Such a night is marked `unchallenged`, not silently passed. */
export const MAX_CRYSTAL_SPREAD_PPM = 50;

/* The O2Ring's `sensor timestamp` is DRAWN — `sample_index × an assumed rate`, not a counter
   (O2RING-SYNTHESISED-AXIS §5, and CLAUDE.md §7's "a device whose axis was DRAWN is not a clock").
   A drawn axis has essentially every consecutive delta identical. This must be checked on EVERY row,
   not the subsample: quantisation is a property of ADJACENT samples, so comparing every 200th row
   would see jitter that is not there and clear a drawn axis. */
export const DRAWN_MODAL_SHARE = 0.99;

/* PURE verdict — what one stream's fit entitles this tool to CONCLUDE. Separated from the I/O so the
   gate can drive it by value with no files. Ordering is load-bearing and mirrors `classifyRate`:
   a DRAWN axis outranks a derived host column (a drawing is disqualified for a stronger reason than
   an absent second clock), and a length complaint never pre-empts either — "too short" invites "so
   use a longer file", which on a drawn or phone-captured axis is precisely wrong. */
export function classifyStability(r) {
  if (!r || r.ok !== true) return 'unreadable';
  if (r.drawn) return 'drawn-device-axis';
  if (r.independent === false) return 'no-second-clock';
  if (!r.stability) return 'no-curve';
  if (r.spanMin < MIN_SPAN_MIN || r.stability.taus < MIN_TAUS) return 'too-short';
  return 'stability';
}

/* ⚠ UNITS. `allanFromPhase` is given phase in MILLISECONDS and τ in SECONDS, so its `adev` is a
   fractional frequency in ms/s = 1e-3 — which is exactly why the spine turns it into ppm by
   multiplying by 1000. The spine's own field names (`atShortestMs` / `atLongestMs`) therefore read
   as milliseconds and are not; they are ms/s. Everything below is converted to PPM at the boundary
   and labelled ppm, because ppm is the unit this suite already quotes rates in, and a σ_y beside a
   ppm rate is only interpretable if both are the same unit. Reporting the raw value as "ms" would
   understate it 1000-fold. (The spine's misleading field name is left alone here — renaming it is a
   shared-spine change — and is recorded in the follow-up brief.) */
export const MS_PER_S_TO_PPM = 1000;

/* σ_y at ONE reference τ, so two devices can be compared at all. Returns null — never the nearest
   point regardless of distance — when the curve does not reach the reference: a σ quoted at 1000 s
   and one quoted at 30 s are different quantities, and silently substituting is the error this
   function exists to prevent. */
export function sigmaAtRefTau(curve, targetSec) {
  const target = targetSec || REF_TAU_SEC;
  if (!curve || !curve.length) return null;
  let best = null;
  for (const p of curve) {
    if (!(p.tau > 0) || !(p.adev > 0)) continue;
    const ratio = p.tau > target ? p.tau / target : target / p.tau;
    if (ratio > REF_TAU_TOLERANCE) continue;
    if (best === null || ratio < best.ratio) best = { tau: p.tau, ppm: p.adev * MS_PER_S_TO_PPM, ratio };
  }
  return best;
}

/* A device's within-night rate agreement, and the verdict it earns. PURE, so the gate drives it by
   value. `unchallenged` is deliberately NOT a pass: one fragment cannot contradict itself, and
   reporting that as agreement is the shape of check this suite keeps finding passing while
   examining nothing.
 *
 * 🔴 THE RAW SPREAD IS THE WRONG TEST, AND IT WAS THE FIRST ONE WRITTEN HERE. Comparing fragment
 * rates by max−min treats a −21.0 ± 2.4 ppm measurement and a −119.5 ± 309 ppm one as two readings
 * of equal standing, so the second "disagrees" with the first by 98 ppm. It does not disagree at
 * all — it is the SAME measurement, made over 28 minutes instead of 563. Measured on this corpus:
 * that naive rule failed 25 of 40 device-nights including 10 H10 nights, which would have
 * contradicted WEARABLE-DRIFT-DIRECT §1's ±2–3 ppm — and the brief was right, because it filtered to
 * fragments > 3 MB and this did not.
 *
 * So the test is whether the scatter is EXPLAINED BY THE FRAGMENTS' OWN UNCERTAINTIES: an
 * inverse-variance weighted mean, then reduced χ². That is only possible because `hostAxis.stability`
 * publishes `ppmUncertainty` — σ_y at the recording's own span. This is the concrete payoff of the
 * σ_y(τ) work: without the curve there is no σ_i, and without σ_i this decision cannot be made
 * correctly at all, only made confidently.
 *
 * ⚠ NOT `integrator-tch.js inverseVarianceWeights`, deliberately. That function FLOORS each σ² at
 * 8 % of the largest, to stop a spuriously near-zero σ² from capturing all the weight on short
 * records. Here the σ are genuinely separated by two orders of magnitude (2.4 ppm against 376 ppm)
 * and the smallest is the most trustworthy, not the most suspect — so its regularisation would
 * discard exactly the fragment that carries the answer. Same formula, opposite failure mode; the
 * reuse would have been wrong. (This is the §3.4 open item, answered with a reason.) */
export const CRYSTAL_MAX_REDUCED_CHI2 = 3;

export function crystalVerdict(entries) {
  const f = (entries || []).map((e) => (typeof e === 'number' ? { ppm: e, ppmUncertainty: null } : e)).filter((e) => e && isFinite(e.ppm));
  if (f.length === 0) return { verdict: 'none', spreadPpm: null, n: 0, chi2: null };
  if (f.length === 1) return { verdict: 'unchallenged', spreadPpm: null, n: 1, chi2: null };
  const spread = Math.max(...f.map((e) => e.ppm)) - Math.min(...f.map((e) => e.ppm));
  /* Fast path, and the sibling tool's rule kept intact: fragments already agreeing inside
     MAX_CRYSTAL_SPREAD_PPM are a crystal whether or not uncertainties are available. */
  if (spread <= MAX_CRYSTAL_SPREAD_PPM) return { verdict: 'crystal', spreadPpm: spread, n: f.length, chi2: null };
  const usable = f.filter((e) => isFinite(e.ppmUncertainty) && e.ppmUncertainty > 0);
  /* No uncertainties ⇒ the χ² test cannot run. Fall back to the raw bound rather than inventing a
     σ — a fabricated error bar would make every spread explicable. */
  if (usable.length !== f.length) return { verdict: 'not-a-crystal', spreadPpm: spread, n: f.length, chi2: null, note: 'no uncertainties; raw-spread bound only' };
  let sw = 0,
    swx = 0;
  for (const e of usable) {
    const w = 1 / (e.ppmUncertainty * e.ppmUncertainty);
    sw += w;
    swx += w * e.ppm;
  }
  const mean = swx / sw;
  let chi2 = 0;
  for (const e of usable) chi2 += ((e.ppm - mean) / e.ppmUncertainty) ** 2;
  const red = chi2 / (usable.length - 1);
  return {
    verdict: red <= CRYSTAL_MAX_REDUCED_CHI2 ? 'crystal' : 'not-a-crystal',
    spreadPpm: spread,
    n: f.length,
    chi2: red,
    weightedPpm: mean,
    weightedSigmaPpm: Math.sqrt(1 / sw)
  };
}

/* Device identity from the capture-host / Polar-Sensor-Logger filename convention
   `<Vendor>_<Model>_<DeviceId>_<YYYYMMDDHHMMSS>_<STREAM>.<ext>` (CAPTURE-HOST §7). The DEVICE is the
   unit of the roll-up — the question §5 asks is "WHICH clock is unstable", and a clock belongs to a
   device, not to a stream. Streams are kept underneath so a per-stream disagreement stays visible
   rather than being averaged into the device's answer. */
export function parseName(base) {
  const m = /^([A-Za-z0-9]+)_([A-Za-z0-9-]+)_([A-Za-z0-9]+)_(\d{14})_([A-Z0-9]+)\.(txt|csv)$/.exec(base);
  if (!m) return null;
  return { vendor: m[1], model: m[2], deviceId: m[3], stamp: m[4], stream: m[5] };
}

function parsePhone(s) {
  // Clock Contract §5: components as written -> Date.UTC (floating wall clock). Never Date.parse.
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(s);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].padEnd(3, '0') : 0);
}

/* Read one raw stream into `{devMs, hostMs}` anchors and hand them to the spine. */
async function stabilityOf(file, every) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  const anchors = [];
  let header = null,
    n = 0;
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
    const f = line.split(';');
    if (f.length < 2) continue;
    const rawNs = Number(f[1]);
    if (isFinite(rawNs) && rawNs > 0) {
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
    if (n % every !== 0) continue;
    const ph = parsePhone(f[0]);
    if (ph == null || !isFinite(rawNs) || rawNs <= 0) continue;
    anchors.push({ devMs: rawNs / 1e6, hostMs: ph });
  }
  if (anchors.length < 3) return { ok: false, reason: 'too-few-anchors', rows: n };
  const ax = DexClock.hostAxis(anchors, {});
  if (!ax || ax.ok !== true) return { ok: false, reason: (ax && ax.reason) || 'refused', rows: n, anchors: anchors.length };
  const spanMin = (anchors[anchors.length - 1].devMs - anchors[0].devMs) / 60000;
  /* `stability` publishes σ at the curve's OWN ends but not the curve, and a common-τ read needs the
     points. Rebuild the phase series exactly as `hostAxis` does — sort by device time, r = host −
     device, relative to the first anchor — and hand it to the SAME spine core the axis used, so this
     is one more read of one curve, not a second opinion. The selftest pins the two against each
     other; if they ever disagree, this construction is wrong, not the spine's. */
  let curve = null,
    refSigma = null;
  if (ax.stability) {
    const pts = anchors
      .map((a) => ({ d: Number(a.devMs), r: Number(a.hostMs) - Number(a.devMs) }))
      .filter((p) => isFinite(p.d) && isFinite(p.r))
      .sort((x, y) => x.d - y.d);
    const r0 = pts[0].r;
    curve = DexClock.allanFromPhase(
      pts.map((p) => p.r - r0),
      ax.stability.tau0Sec
    );
    refSigma = sigmaAtRefTau(curve, REF_TAU_SEC);
  }
  return {
    ok: true,
    rows: n,
    anchors: anchors.length,
    spanMin,
    /* A rate is reported ONLY to sit beside its uncertainty. WEARABLE-DRIFT-DIRECT §7.5's convention
       is preserved verbatim from `hostAxis` — do not re-sign it here; two sign conventions in this
       family were each established only by PLANTING TRUTH, and each wrong guess produced a
       confident, publishable, wrong answer. */
    ppm: ax.ppm,
    independent: ax.independent,
    spreadMs: ax.spreadMs,
    drawn: dTot > 0 && dSame / dTot >= DRAWN_MODAL_SHARE,
    modalDeltaShare: dTot > 0 ? dSame / dTot : null,
    stability: ax.stability,
    /* THE ONLY FIGURE THAT MAY BE COMPARED ACROSS DEVICES. Null when the curve does not reach the
       reference τ — such a stream is dropped from the comparison, not compared at its own τ. */
    refSigma
  };
}

function median(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) return selftest();
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) {
    console.error('usage: node tools/device-stability.mjs <corpus-dir> [--json out.json] [--every N]');
    process.exit(2);
  }
  const everyIx = args.indexOf('--every');
  const every = everyIx >= 0 ? Number(args[everyIx + 1]) : DEFAULT_EVERY;
  const jsonIx = args.indexOf('--json');

  const nights = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort();

  const rows = [];
  for (const night of nights) {
    const nd = path.join(dir, night);
    for (const base of fs.readdirSync(nd).sort()) {
      const nm = parseName(base);
      if (!nm) continue;
      // Streams whose rows carry a `sensor timestamp [ns]` column. HR/RR/PPI/OXYFRAME do not.
      if (!/^(ECG|PPG|ACC|GYRO|MAG)$/.test(nm.stream)) continue;
      const full = path.join(nd, base);
      let r;
      try {
        r = await stabilityOf(full, every);
      } catch (e) {
        r = { ok: false, reason: 'unreadable: ' + e.message };
      }
      const verdict = classifyStability(r);
      rows.push({ night, device: nm.model + '_' + nm.deviceId, model: nm.model, stream: nm.stream, file: base, verdict, ...r });
      const st = r.stability;
      console.log(
        [
          night,
          (nm.model + '/' + nm.stream).padEnd(24),
          verdict.padEnd(18),
          /* A REFUSED stream prints — where its numbers were. Printing them beside the reason they are
             not measurements invites exactly the quote the reason forbids (WEARABLE-DRIFT-DIRECT §7). */
          verdict === 'stability' ? (r.ppm >= 0 ? '+' : '') + r.ppm.toFixed(1) + ' ppm' : '—',
          verdict === 'stability' ? 'slope ' + st.slope.toFixed(2) + '±' + st.slopeSE.toFixed(2) : '—',
          verdict === 'stability' ? st.noise || '(ambiguous)' : '—',
          verdict === 'stability' ? (r.refSigma ? `σ_y(${r.refSigma.tau.toFixed(0)}s) ${r.refSigma.ppm.toFixed(1)} ppm` : 'σ_y(ref) — curve does not reach τ') : '—'
        ].join('  ')
      );
    }
  }

  /* IS THIS DEVICE A CRYSTAL AT ALL, on this night? Applied per (night, device) because that is the
     scope over which a crystal must hold its rate. A device that fails here is excluded from the
     stability roll-up: a σ_y curve describes a clock, and this check is what establishes there is
     one to describe. */
  const crystal = new Map();
  for (const r of rows) {
    if (r.verdict !== 'stability') continue;
    const k = r.night + '|' + r.model;
    if (!crystal.has(k)) crystal.set(k, []);
    crystal.get(k).push({ ppm: r.ppm, ppmUncertainty: r.stability.ppmUncertainty });
  }
  const crystalOf = new Map();
  for (const [k, ppms] of crystal) crystalOf.set(k, crystalVerdict(ppms));
  console.log('\n=== IS IT A CRYSTAL? (within-night rate spread, per device-night) ===');
  const notCrystal = [...crystalOf].filter(([, v]) => v.verdict === 'not-a-crystal');
  for (const [k, v] of [...crystalOf].sort()) {
    if (v.verdict === 'crystal') continue; // the expected case; only the exceptions are worth lines
    console.log(
      `  ${k.padEnd(28)} ${v.verdict.padEnd(14)} ` +
        (v.spreadPpm === null
          ? '(n=1)'
          : `raw spread ${v.spreadPpm.toFixed(1)} ppm over ${v.n} fragments` +
            (v.chi2 === null ? '' : `  χ²red ${v.chi2.toFixed(2)}` + (v.weightedPpm != null ? `  ⇒ ${v.weightedPpm.toFixed(1)} ± ${v.weightedSigmaPpm.toFixed(1)} ppm` : '')))
    );
  }
  console.log(`  ${[...crystalOf].filter(([, v]) => v.verdict === 'crystal').length} device-nights hold a crystal · ${notCrystal.length} do not`);

  // Per-DEVICE roll-up — the question §5 actually asks: which clock is unstable?
  const byDevice = new Map();
  for (const r of rows) {
    if (r.verdict !== 'stability') continue;
    if (crystalOf.get(r.night + '|' + r.model).verdict === 'not-a-crystal') continue;
    if (!byDevice.has(r.model)) byDevice.set(r.model, []);
    byDevice.get(r.model).push(r);
  }
  console.log(`\n=== PER-DEVICE σ_y AT A COMMON τ = ${REF_TAU_SEC} s ===`);
  console.log('(streams whose curve does not reach it are DROPPED, never compared at their own τ)');
  const summary = [];
  for (const [model, rs] of [...byDevice].sort()) {
    const withRef = rs.filter((r) => r.refSigma);
    const slopes = rs.map((r) => r.stability.slope);
    const noises = [...new Set(rs.map((r) => r.stability.noise || '(ambiguous)'))];
    const ref = withRef.map((r) => r.refSigma.ppm);
    const s = {
      device: model,
      streams: rs.length,
      streamsAtRefTau: withRef.length,
      nights: new Set(rs.map((r) => r.night)).size,
      medianSlope: median(slopes),
      slopeRange: [Math.min(...slopes), Math.max(...slopes)],
      refTauSec: REF_TAU_SEC,
      medianSigmaAtRefTauPpm: ref.length ? median(ref) : null,
      sigmaAtRefTauRangePpm: ref.length ? [Math.min(...ref), Math.max(...ref)] : null,
      noiseTypes: noises
    };
    summary.push(s);
    console.log(
      `${model.padEnd(14)} n=${String(withRef.length).padStart(3)}/${String(rs.length).padEnd(3)} over ${s.nights} nights  ` +
        `slope ${s.medianSlope.toFixed(2)} [${s.slopeRange[0].toFixed(2)}…${s.slopeRange[1].toFixed(2)}]  ` +
        (ref.length
          ? `σ_y(${REF_TAU_SEC}s) ${s.medianSigmaAtRefTauPpm.toFixed(0)} ppm [${s.sigmaAtRefTauRangePpm[0].toFixed(0)}…${s.sigmaAtRefTauRangePpm[1].toFixed(0)}]  `
          : 'σ_y(ref) — no stream reached τ  ') +
        `${noises.join(',')}`
    );
  }
  // Refusals are reported as a census, never silently dropped — a stream missing from the roll-up
  // because it was refused and one missing because it was never read look identical otherwise.
  const census = {};
  for (const r of rows) census[r.verdict] = (census[r.verdict] || 0) + 1;
  console.log(
    '\nverdicts: ' +
      Object.entries(census)
        .map(([k, v]) => `${k}=${v}`)
        .join(' · ')
  );

  if (jsonIx >= 0) {
    const crystalRows = [...crystalOf].map(([k, v]) => ({ night: k.split('|')[0], device: k.split('|')[1], ...v }));
    fs.writeFileSync(args[jsonIx + 1], JSON.stringify({ corpus: dir, every, refTauSec: REF_TAU_SEC, rows, crystal: crystalRows, summary, census }, null, 2));
    console.log('wrote ' + args[jsonIx + 1]);
  }
}

/* KNOWN ANSWER. The tool's contribution is the walk and the roll-up, so what must be pinned is that a
   PLANTED noise type comes back named — otherwise the corpus numbers are a shape, not a measurement
   (`assertions-encode-shape-not-contract`).
   ⚠ THE TWO RANDOM WALKS ARE NOT THE SAME MECHANISM, and confusing them is easy because both are
   "a random walk". y = dx/dt, so a random walk in PHASE is white FREQUENCY noise — slope −1ᐟ², which
   still averages away, only slower. The mechanism that does NOT average away is a random walk in
   FREQUENCY (slope +1ᐟ²), where every extra minute of averaging makes the estimate WORSE. Those two
   have opposite engineering consequences, so all three are planted: if the tool cannot separate −1,
   −1ᐟ² and +1ᐟ² it cannot answer §5, because §5's question is precisely "does averaging help". */
function selftest() {
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647; // MINSTD — exact in a double, same series in both lanes
    return seed / 2147483647 - 0.5;
  };
  const N = 4000,
    dt = 1000;
  let fails = 0;
  const say = (ok, msg) => {
    if (!ok) fails++;
    console.log((ok ? 'PASS ' : 'FAIL ') + msg);
  };

  // (1) WHITE PHASE — independent jitter on each host stamp. Expect slope ~ -1.
  let a = [];
  for (let i = 0; i < N; i++) a.push({ devMs: i * dt, hostMs: i * dt + 200 * rnd() });
  let r = DexClock.hostAxis(a, {});
  say(r.ok === true && r.stability != null, 'white phase yields a curve');
  say(r.stability && r.stability.slope < -0.8, `white phase slope ~ -1 (got ${r.stability && r.stability.slope.toFixed(2)})`);

  // (2) RANDOM-WALK PHASE = WHITE FREQUENCY. Expect ~ -1/2: averaging still helps, but slower.
  a = [];
  let w = 0;
  for (let i = 0; i < N; i++) {
    w += 20 * rnd();
    a.push({ devMs: i * dt, hostMs: i * dt + w });
  }
  const wfm = DexClock.hostAxis(a, {});
  say(wfm.ok === true && wfm.stability != null, 'random-walk phase yields a curve');
  say(wfm.stability && wfm.stability.slope > -0.75 && wfm.stability.slope < -0.25, `random-walk phase reads as white FREQUENCY, slope ~ -0.5 (got ${wfm.stability && wfm.stability.slope.toFixed(2)})`);

  /* (3) RANDOM-WALK FREQUENCY — the mechanism where more averaging makes the answer WORSE. Integrate
     the walk once more (frequency wanders, so phase is its integral). Expect a POSITIVE slope, the
     one verdict that would change what a caller should do with a long recording. */
  a = [];
  let freq = 0,
    ph2 = 0;
  for (let i = 0; i < N; i++) {
    freq += 0.02 * rnd();
    ph2 += freq * dt;
    a.push({ devMs: i * dt, hostMs: i * dt + ph2 });
  }
  const rwfm = DexClock.hostAxis(a, {});
  say(rwfm.ok === true && rwfm.stability != null, 'random-walk frequency yields a curve');
  say(rwfm.stability && rwfm.stability.slope > 0.2, `random-walk frequency reads POSITIVE — averaging hurts (got ${rwfm.stability && rwfm.stability.slope.toFixed(2)})`);
  say(r.stability.slope < wfm.stability.slope && wfm.stability.slope < rwfm.stability.slope, 'the three planted mechanisms come back strictly ordered -1 < -1/2 < +1/2');

  // (4) NO SECOND CLOCK — a host column that is the device stamp rounded. Must refuse, not describe.
  a = [];
  for (let i = 0; i < N; i++) a.push({ devMs: i * dt + 0.4 * rnd(), hostMs: Math.round(i * dt) });
  const inert = DexClock.hostAxis(a, {});
  say(inert.ok !== true || inert.independent === false, 'a derived host column reads independent:false');
  say(inert.ok !== true || inert.stability === null, '…and yields NO curve rather than one built from rounding');
  say(classifyStability({ ok: true, independent: false, stability: null }) === 'no-second-clock', 'classifyStability names it');

  // (5) ORDERING — a drawn axis outranks a derived host column and both outrank a length complaint.
  say(classifyStability({ ok: true, drawn: true, independent: false, stability: null, spanMin: 1 }) === 'drawn-device-axis', 'a drawn axis outranks no-second-clock');
  say(classifyStability({ ok: true, drawn: false, independent: false, stability: null, spanMin: 1 }) === 'no-second-clock', 'no-second-clock outranks too-short');

  /* (6) THE COMMON-τ READ. σ_y(τ) is a function, so the one figure compared across devices must be
     read at ONE τ — and a curve that does not reach it must drop out rather than contribute its own.
     Planted white phase (σ ∝ τ⁻¹) makes the expected value checkable rather than merely present. */
  const curve = DexClock.allanFromPhase(
    Array.from({ length: 2048 }, () => 200 * rnd()),
    1
  );
  const at256 = sigmaAtRefTau(curve, 256);
  const at256sRaw = curve.find((p) => p.tau === (at256 && at256.tau)).adev;
  say(at256 != null && at256.tau >= 128 && at256.tau <= 512, `a curve reaching 256 s is read there (τ=${at256 && at256.tau})`);
  say(sigmaAtRefTau(curve, 1e6) === null, 'a curve that does NOT reach the reference τ returns null, not its own longest point');
  const at64 = sigmaAtRefTau(curve, 64);
  say(at64 && at256 && at64.ppm > at256.ppm, `white phase falls with τ, so σ(64s) > σ(256s) (${at64 && at64.ppm.toFixed(1)} > ${at256 && at256.ppm.toFixed(1)} ppm)`);
  say(at256 && Math.abs(at256.ppm - at256sRaw * MS_PER_S_TO_PPM) < 1e-9, 'the reference read is in PPM — the spine value times 1000, not relabelled');

  /* (7) THE CRYSTAL CHECK — a rate that moves between fragments of one night is the ABSENCE of a
     rate, not an imprecise one. And one fragment cannot contradict itself: `unchallenged` must not
     read as a pass. */
  say(crystalVerdict([-20.3, -19.1, -21.6]).verdict === 'crystal', 'fragments agreeing to ±3 ppm are a crystal');
  say(crystalVerdict([-188.0]).verdict === 'unchallenged', 'a single fragment is UNCHALLENGED, never a pass');
  say(crystalVerdict([]).verdict === 'none', 'no fragments is not a verdict either');
  /* THE CASE THAT OVERTURNED THE FIRST VERSION, taken verbatim from 2026-08-01 H10: one precise long
     fragment and four imprecise short ones. Raw spread 132 ppm; every short value within ~1σ. */
  const real2601 = [
    { ppm: -119.5, ppmUncertainty: 309.1 },
    { ppm: -93.3, ppmUncertainty: 155.1 },
    { ppm: -13.2, ppmUncertainty: 93.3 },
    { ppm: -19.7, ppmUncertainty: 121.3 },
    { ppm: 12.5, ppmUncertainty: 306.9 },
    { ppm: -21.0, ppmUncertainty: 2.4 }
  ];
  const cv = crystalVerdict(real2601);
  say(cv.verdict === 'crystal', `a 132 ppm raw spread explained by its own error bars IS a crystal (χ²red ${cv.chi2 && cv.chi2.toFixed(2)})`);
  say(Math.abs(cv.weightedPpm - -21.0) < 1.0, `…and the weighted rate is carried by the precise fragment (${cv.weightedPpm && cv.weightedPpm.toFixed(1)} ppm, not the -39 ppm unweighted mean)`);
  /* And it must still REFUSE a genuine incoherence — the O2Ring, whose fragments disagree far beyond
     any of their error bars. Otherwise the fix above would simply have disabled the check. */
  const ring = [
    { ppm: -967.7, ppmUncertainty: 12.0 },
    { ppm: 904.4, ppmUncertainty: 18.0 },
    { ppm: 2454.3, ppmUncertainty: 25.0 }
  ];
  say(crystalVerdict(ring).verdict === 'not-a-crystal', 'fragments disagreeing far beyond their error bars are still refused');
  say(
    crystalVerdict([
      { ppm: -20, ppmUncertainty: null },
      { ppm: 400, ppmUncertainty: null }
    ]).verdict === 'not-a-crystal',
    'with no uncertainties available it falls back to the raw bound, never inventing a sigma'
  );

  /* (8) THE PHASE SERIES THIS TOOL REBUILDS MUST BE THE ONE THE SPINE USED. If the reconstruction
     drifts from `hostAxis`'s, every common-τ figure describes a different series than the slope and
     noise type printed beside it — and nothing downstream would show it. */
  const anch = [];
  let ww = 0;
  for (let i = 0; i < 2000; i++) {
    ww += 8 * rnd();
    anch.push({ devMs: i * 500, hostMs: i * 500 + ww + 300 * rnd() });
  }
  const ha = DexClock.hostAxis(anch, {});
  const pts = anch.map((a) => ({ d: a.devMs, r: a.hostMs - a.devMs })).sort((x, y) => x.d - y.d);
  const rebuilt = DexClock.allanFromPhase(
    pts.map((p) => p.r - pts[0].r),
    ha.stability.tau0Sec
  );
  say(Math.abs(rebuilt[rebuilt.length - 1].adev - ha.stability.atLongestMs) < 1e-9, 'the rebuilt phase series reproduces hostAxis σ at τmax exactly');
  say(Math.abs(rebuilt[0].adev - ha.stability.atShortestMs) < 1e-9, '…and at τ₀');

  // (9) The filename convention the per-device roll-up depends on.
  const nm = parseName('Polar_VeritySense_0C301E3F_20260807215043_PPG.txt');
  say(nm && nm.model === 'VeritySense' && nm.deviceId === '0C301E3F' && nm.stream === 'PPG', 'filename parses to device + stream');
  say(parseName('QC-SUMMARY.json') === null, 'a non-capture file is not mistaken for a stream');

  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
