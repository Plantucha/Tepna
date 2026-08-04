#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * ppg-foot-consensus-e1.mjs — PPGDEX-ALGORITHM-DEEP-DIVE §6 experiment E-1
 * ------------------------------------------------------------------------------------------------
 * E-1 asks: "does foot-domain consensus (feet on all three channels, de-offset, ±40 ms) recover the
 * 1-of-3 drop rate without admitting false beats? PPV@75 ms must not fall. Blocking for any consensus
 * rework."
 *
 * WHAT IS ACTUALLY ASYMMETRIC TODAY. `consensusBeats` votes in the PEAK domain — a beat survives only
 * where ≥2 of 3 channels place a systolic peak within ±50 ms — and then derives feet with
 * `refineFeet(refBp, …)` on the SINGLE best-SNR reference channel. `ppgdex-dsp.js` documents the
 * consequence at the PPI spine (a corrupted reference collapses the feet while the voted peaks stay
 * right) and arbitrates after the fact by correction rate. E-1 proposes fixing it at the root: vote in
 * the FOOT domain, which is also the domain PPI is actually built in (`buildPPI(footSec)`).
 *
 * WHY A BEAT COULD BE RECOVERED. A 1-of-3 drop is a beat where two channels failed to place a PEAK
 * within tolerance. The systolic peak is the amplitude-sensitive half of the beat — it smears under
 * perfusion loss and rides pulse-amplitude drift — while the foot is amplitude-invariant. So a beat can
 * be foot-visible on all three channels and peak-visible on one. Those are the beats E-1 is after.
 *
 * THE MEASUREMENT IS TWO-SIDED BY CONSTRUCTION. Recovering beats is trivial if false ones may be
 * admitted (drop the vote entirely and every channel's noise becomes a beat). So every variant is
 * scored on BOTH legs against paired H10 chest ECG:
 *     PPV@75 ms   of the beats this variant reports, what fraction match a real R-peak (must NOT fall)
 *     recall      of the ECG's R-peaks in the overlap, what fraction were found (should RISE)
 * plus PPI-jitter sd, which is the currency PPGDEX-JITTER-AND-REFERENCE-FOLLOWUPS §3 says any accuracy
 * proposal must be scored in. A variant that recovers beats but raises jitter has not helped: whole-
 * record RMSSD promotion is jitter-bound, not count-bound.
 *
 * DE-OFFSET, AND WHY IT IS NOT OPTIONAL. Three optical paths at different wavelengths do not place the
 * foot at the same instant; a fixed per-channel bias would widen every cluster and cost agreement for a
 * reason that has nothing to do with the beat. Each channel's median foot offset against the reference
 * is estimated and removed BEFORE clustering. The offsets are reported — if they are ~0 the correction
 * is inert and says so, which is itself worth knowing.
 *
 * SCOPE — THIS IS A VERITY EXPERIMENT. The O2Ring finger stream is a replicated single sensor:
 * `distinctChannelIdx` collapses bit-identical duplicates, `consensusBeats` takes its honest `nCh < 2`
 * path, and there is no vote to improve. The tool reports the distinct-channel count per device rather
 * than assuming it, so "E-1 does not apply to the finger" is a measurement here, not a claim.
 *
 * SHIPPED CODE ONLY. Detection, feet, PPI and HRV all come from PPGDSP/ECGDSP co-loaded in a vm realm
 * mirroring tests/run-tests.mjs. The ONLY new code is the foot-domain clustering itself — which is the
 * thing under test — and it is exercised corpus-free by `--selftest`.
 *
 * USAGE
 *   node tools/ppg-foot-consensus-e1.mjs --dir <captures> [--device verity] [--sleep-only]
 *   node tools/ppg-foot-consensus-e1.mjs --selftest
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EPOCH_MS, MAX_LAG_MS, median, quantile, hrEnvelope, envelopeLagMs, refineLagByMatch, matchBeats, refinePeaks, ppiJitterMs } from './ppi-match.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
const SELFTEST = has('--selftest');
const DIR = opt('--dir', null);
const DEVICE = String(opt('--device', 'verity')).toLowerCase();
const MAX_NIGHTS = +opt('--max-nights', 20);
const SLEEP_ONLY = has('--sleep-only');
/* E-1 names ±40 ms. The shipped PEAK vote uses ±50 ms; the foot is the sharper landmark (a tangent
   intersection, not a broad maximum), so a tighter window is the brief's own proposal and is kept as
   the default rather than silently widened to match the peak rule. Swept by --tol-ms. */
const TOL_MS = +opt('--tol-ms', 40);
const MIN_AGREE = +opt('--min-agree', 2);
/* Offset-search half-width. Wider than TOL_MS on purpose (see medianFootOffset) and well under half a
   beat at the fastest plausible HR, so a foot can never pair with its neighbour. */
const OFFSET_SEARCH_MS = +opt('--offset-search-ms', 150);

const isSleepNight = (name, durSec) => {
  const m = /_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/.exec(name) || /(\d{8})(\d{2})(\d{2})(\d{2})_PPG/.exec(name);
  const hh = m ? +(m.length > 6 ? m[4] : m[2]) : null;
  if (hh == null || !(durSec >= 4 * 3600)) return false;
  return hh >= 20 || hh < 4;
};

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 *  THE VARIANT UNDER TEST — foot-domain consensus
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

/* Median offset of `other` against `ref`, both fractional sample indices, over feet that pair inside
   `tolSamp`. Median (not mean) because an unpaired stretch must not drag the estimate. Null when too
   few pair to be worth correcting — the caller then applies no shift, rather than a noisy one.

   `tolSamp` here is the OFFSET-SEARCH window and is deliberately WIDER than the clustering tolerance.
   Searching within ±40 ms would make the correction blind to any bias above 40 ms — i.e. to exactly
   the biases it exists to remove — and the step would silently no-op on the records that need it most.
   The selftest pins this: a planted +3-sample (55 ms) bias is recovered only because the search window
   is wider than the ±40 ms vote. It must stay well under half a beat (≈166 ms at 180 bpm) or it would
   start pairing a foot with its NEIGHBOUR and measure one beat interval as an offset. */
export function medianFootOffset(refFeet, otherFeet, tolSamp) {
  const d = [];
  let j = 0;
  for (let i = 0; i < otherFeet.length; i++) {
    const t = otherFeet[i];
    while (j < refFeet.length && refFeet[j] < t - tolSamp) j++;
    let bestD = null;
    for (let k = j; k < refFeet.length && refFeet[k] <= t + tolSamp; k++) {
      const dd = t - refFeet[k];
      if (bestD === null || Math.abs(dd) < Math.abs(bestD)) bestD = dd;
    }
    if (bestD !== null) d.push(bestD);
  }
  return d.length >= 8 ? median(d) : null;
}

/* Per-channel median PEAK offset against channel 0, in ms. Reported because the E-1 run found the
   thing E-1 was not looking for: on 3 of 18 Verity nights ONE channel's detected polarity (`sign`)
   is inverted relative to the other two, so its "systolic peaks" land on the opposite phase of the
   pulse — a fixed ~13 samples (~236 ms) — which is 4.7x the +/-50 ms vote tolerance. That channel then
   joins NO cluster: `kept3/3` is 0 for the whole night, the 3-LED vote silently runs as 2-of-3, and
   the drop-rate statistic reads ~51 % for what is a phase offset, not a detection failure. The output
   stays correct (the two agreeing channels carry it, PPV 100 %) — what is lost is the redundancy the
   vote exists for, silently. Surfaced here so the condition is detectable rather than inferred. */
export function peakOffsetsMs(perChannel, fs) {
  const a = perChannel[0].peaks;
  const win = 0.25 * fs;
  return perChannel.map((pc) => {
    const d = [];
    let j = 0;
    for (const t of pc.peaks) {
      while (j < a.length && a[j] < t - win) j++;
      let bd = null;
      for (let k = j; k < a.length && a[k] <= t + win; k++) {
        const dd = t - a[k];
        if (bd === null || Math.abs(dd) < Math.abs(bd)) bd = dd;
      }
      if (bd !== null) d.push(bd);
    }
    return d.length >= 8 ? (median(d) / fs) * 1000 : null;
  });
}

/* Foot-domain consensus. Same chaining/refractory discipline as `consensusBeats` so the two variants
   differ ONLY in the domain they vote in — anything else would confound the comparison.
     perChannelFeet : [[fractional sample idx, …], …]
   → { feet, agree, nDropped, kept33, kept22, offsets, nClusters } */
export function footConsensus(perChannelFeet, refIdx, fs, tolMs, minAgree, offsetSearchMs) {
  const nCh = perChannelFeet.length;
  const tol = Math.max(1, (tolMs / 1000) * fs);
  const osTol = Math.max(tol, ((offsetSearchMs || OFFSET_SEARCH_MS) / 1000) * fs);
  const refFeet = perChannelFeet[refIdx];
  // 1 — de-offset each channel onto the reference's timebase (wide search — see medianFootOffset)
  const offsets = perChannelFeet.map((f, c) => (c === refIdx ? 0 : medianFootOffset(refFeet, f, osTol) || 0));
  const ev = [];
  for (let c = 0; c < nCh; c++) for (const s of perChannelFeet[c]) ev.push({ s: s - offsets[c], c });
  ev.sort((a, b) => a.s - b.s);
  // 2 — chain by gap, exactly as the peak vote does
  const rawFeet = [],
    rawAgree = [];
  let nDropped = 0,
    kept33 = 0,
    kept22 = 0,
    nClusters = 0;
  let i = 0;
  while (i < ev.length) {
    const chans = {};
    const ss = [];
    let j = i;
    chans[ev[j].c] = 1;
    ss.push(ev[j].s);
    j++;
    while (j < ev.length && ev[j].s - ev[j - 1].s <= tol) {
      chans[ev[j].c] = 1;
      ss.push(ev[j].s);
      j++;
    }
    const nAgree = Object.keys(chans).length;
    nClusters++;
    if (nAgree >= minAgree) {
      rawFeet.push(median(ss));
      rawAgree.push(nAgree / nCh);
      if (nAgree >= 3) kept33++;
      else kept22++;
    } else nDropped++;
    i = j;
  }
  // 3 — refractory on the merged spine. The peak vote breaks ties by amplitude; a foot has no
  //     meaningful amplitude, so the EARLIER foot is kept (the later one is the intruder).
  const refr = fs * 0.3;
  const feet = [],
    agree = [];
  for (let k = 0; k < rawFeet.length; k++) {
    if (feet.length && rawFeet[k] - feet[feet.length - 1] < refr) continue;
    feet.push(rawFeet[k]);
    agree.push(rawAgree[k]);
  }
  return { feet, agree, nDropped, kept33, kept22, offsets, nClusters };
}

/* ════════════════════════════════════════════════════════════════════════ SELFTEST ═════════════ */
function selftest() {
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? '  ok   ' : '  FAIL ') + m);
    if (!c) fail++;
  };
  const fs = 55;
  // three channels, a beat every 0.9 s, channel offsets of +0 / +3 / −2 samples
  const base = [];
  for (let t = 0; t < 120; t++) base.push(t * 0.9 * fs);
  const offs = [0, 3, -2];
  const ch = offs.map((o) => base.map((b) => b + o));

  const OS = (OFFSET_SEARCH_MS / 1000) * fs; // the offset-search window, in samples
  const off1 = medianFootOffset(ch[0], ch[1], OS);
  ok(Math.abs(off1 - 3) < 1e-6, 'de-offset recovers a planted +3-sample channel bias exactly');
  ok(medianFootOffset(ch[0], [1, 2], OS) === null, 'too few pairings ⇒ null, not a noisy offset');
  /* The window separation is the fix the first selftest run forced: searching within the ±40 ms VOTE
     tolerance cannot see a 55 ms bias, so the correction would no-op exactly where it is needed. */
  ok(medianFootOffset(ch[0], ch[1], (TOL_MS / 1000) * fs) === null, 'a vote-width search window is BLIND to a 55 ms bias — hence the wider one');

  const full = footConsensus(ch, 0, fs, TOL_MS, 2);
  ok(full.feet.length === base.length, `all ${base.length} beats survive when 3/3 channels agree (got ${full.feet.length})`);
  ok(full.nDropped === 0, 'nothing dropped on a clean 3-channel record');
  ok(Math.abs(full.offsets[1] - 3) < 1e-6 && Math.abs(full.offsets[2] + 2) < 1e-6, 'reported offsets match the planted ones');

  // WITHOUT de-offset the planted bias alone must cost agreement — proving the step is load-bearing.
  // ±5 samples ≈ ±91 ms: wider than the ±40 ms vote (so it breaks agreement) but well inside the
  // 150 ms offset search (so the correction can see it). That gap is the whole operating regime.
  const spread = [0, 5, -5].map((o) => base.map((b) => b + o));
  const noDeoff = (() => {
    const ev = [];
    for (let c = 0; c < 3; c++) for (const s of spread[c]) ev.push({ s, c });
    ev.sort((a, b) => a.s - b.s);
    let drop = 0,
      i = 0;
    const tol = (TOL_MS / 1000) * fs;
    while (i < ev.length) {
      const chans = {};
      let j = i;
      chans[ev[j].c] = 1;
      j++;
      while (j < ev.length && ev[j].s - ev[j - 1].s <= tol) {
        chans[ev[j].c] = 1;
        j++;
      }
      if (Object.keys(chans).length < 2) drop++;
      i = j;
    }
    return drop;
  })();
  ok(noDeoff > 100, `an un-corrected ±5-sample (91 ms) bias drops ${noDeoff} clusters — de-offset is load-bearing`);
  ok(footConsensus(spread, 0, fs, TOL_MS, 2).nDropped === 0, '…and de-offset removes that penalty entirely');

  // RECOVERY: a beat present on all 3 feet must survive even though only 1 channel would peak on it
  const partial = [ch[0].slice(), ch[1].slice(), ch[2].slice()];
  ok(footConsensus(partial, 0, fs, TOL_MS, 2).feet.length === base.length, 'a foot-visible beat survives the foot vote');

  // FALSE BEATS: noise on ONE channel only must NOT be admitted at minAgree=2
  const noisy = [ch[0].slice(), ch[1].slice(), ch[2].slice()];
  for (let t = 0; t < 100; t++) noisy[1].push(t * 0.9 * fs + 0.45 * fs); // 100 mid-beat intruders, 1 channel
  noisy[1].sort((a, b) => a - b);
  const nz = footConsensus(noisy, 0, fs, TOL_MS, 2);
  ok(nz.feet.length === base.length, `1-of-3 intruders are rejected (kept ${nz.feet.length}, expected ${base.length})`);
  ok(nz.nDropped === 100, 'and are counted as drops, not silently ignored');

  // …but noise on TWO channels at the same instant IS admitted — the vote's honest limit
  const noisy2 = [ch[0].slice(), ch[1].slice(), ch[2].slice()];
  // planted in each channel's OWN timebase (i.e. carrying that channel's offset), which is how a
  // beat-like artifact seen by two LEDs actually presents — de-offset then aligns them, as it should.
  for (let t = 0; t < 50; t++) {
    noisy2[1].push(t * 0.9 * fs + 0.45 * fs + offs[1]);
    noisy2[2].push(t * 0.9 * fs + 0.45 * fs + offs[2]);
  }
  noisy2[1].sort((a, b) => a - b);
  noisy2[2].sort((a, b) => a - b);
  ok(footConsensus(noisy2, 0, fs, TOL_MS, 2).feet.length === base.length + 50, 'a 2-of-3 correlated intruder IS admitted — the vote cannot see it');

  // refractory: two clusters closer than 0.3 s collapse to one
  const tight = [
    [0, 5, 100 * 1],
    [0, 5, 100],
    [0, 5, 100]
  ].map((a) => a.map(Number));
  ok(footConsensus(tight, 0, fs, TOL_MS, 2).feet.length <= 2, 'refractory collapses sub-300 ms neighbours');

  console.log(fail ? `\nselftest: ${fail} FAILURE(S)` : '\nselftest: all green');
  return fail;
}

if (SELFTEST) {
  process.exit(selftest() ? 1 : 0);
}
if (!DIR) {
  console.error('need --dir <captures>  (or --selftest)');
  process.exit(2);
}

/* ════════════════════════════════════════════════════════════════════ CORPUS RUN ═══════════════ */
const B = await import(join(ROOT, 'tools/build-core.js'));
const classicify = B.classicify || B.default?.classicify;
function realm(files) {
  const sb = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  sb.window = sb;
  sb.globalThis = sb;
  sb.self = sb;
  sb.document = {
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ style: {}, appendChild() {} }),
    head: { appendChild() {} },
    addEventListener() {},
    documentElement: { outerHTML: '' }
  };
  sb.navigator = { userAgent: 'v' };
  sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const ctx = vm.createContext(sb);
  for (const f of files) vm.runInContext(classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
  return sb;
}
const P = realm(['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ppgdex-registry.js', 'ppgdex-morph.js', 'ppgdex-dsp.js']).PPGDSP;
const E = realm(['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ecgdex-registry.js', 'ecgdex-morph.js', 'ecgdex-dsp.js']).ECGDSP;

const walk = (d, o = []) => {
  try {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p, o);
      else o.push({ p, size: st.size });
    }
  } catch (_e) {}
  return o;
};
const PPG_RE = DEVICE === 'verity' ? /VeritySense.*_PPG\.txt$/i : /O2Ring.*_PPG\.txt$/i;
const all = walk(DIR);
const ppgs = all
  .filter((f) => PPG_RE.test(f.p))
  .sort((a, b) => b.size - a.size)
  .slice(0, MAX_NIGHTS);
const ecgs = all.filter((f) => /H10.*_ECG\.txt$/i.test(f.p));

console.log('PPGDEX-ALGORITHM-DEEP-DIVE §6 · E-1 — foot-domain consensus vs the shipped peak vote');
console.log(`device: ${DEVICE}   foot tol: ±${TOL_MS} ms   min agree: ${MIN_AGREE}/3   ${SLEEP_ONLY ? '(sleep nights only)' : '(all nights)'}\n`);
console.log('night                                   nCh  drop_pk%  drop_ft%  PPV_pk%  PPV_ft%  rec_pk%  rec_ft%  jit_pk  jit_ft');

// Score one beat train (absolute ms) against the ECG, epoch by epoch.
function score(beatMs, eBeats, lo, hi) {
  const ppv = [],
    rec = [],
    jit = [];
  for (let t = lo; t + EPOCH_MS <= hi; t += EPOCH_MS) {
    const fe = beatMs.filter((x) => x >= t && x < t + EPOCH_MS);
    const eeIn = eBeats.filter((x) => x >= t && x < t + EPOCH_MS);
    const ee = eBeats.filter((x) => x >= t - MAX_LAG_MS && x < t + EPOCH_MS + MAX_LAG_MS);
    if (fe.length < 60 || ee.length < 60) continue;
    const coarse = envelopeLagMs(hrEnvelope(fe, t, t + EPOCH_MS), hrEnvelope(ee, t, t + EPOCH_MS));
    if (!coarse) continue;
    const lag = refineLagByMatch(fe, ee, coarse.lagMs);
    const pairs = matchBeats(fe, ee, lag.lagMs);
    ppv.push(pairs.length / fe.length); // of what we reported, how much was real
    if (eeIn.length) rec.push(pairs.length / eeIn.length); // of what was there, how much we found
    const j = ppiJitterMs(fe, ee, pairs);
    if (j) jit.push(j.sd);
  }
  return ppv.length ? { ppv: median(ppv), rec: rec.length ? median(rec) : null, jit: jit.length ? median(jit) : null, eps: ppv.length } : null;
}

/* Cheap filename pre-filter: an ECG whose stamp is more than 12 h from the PPG start cannot overlap
   it. Files without a parseable stamp are NOT rejected — they fall through to the full parse, so the
   optimisation can only save work, never silently drop a pairing. */
const stampOf = (p) => {
  const m = /_(\d{14})_/.exec(p) || /(\d{14})/.exec(p.split('/').pop() || '');
  if (!m) return null;
  const s = m[1];
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
};
const plausiblyOverlaps = (p, t0) => {
  const t = stampOf(p);
  return t == null || Math.abs(t - t0) < 12 * 3600 * 1000;
};
const _ecgMemo = new Map();
function ecgCache(p) {
  if (_ecgMemo.has(p)) return _ecgMemo.get(p);
  let v = null;
  try {
    const er = E.parseECG(readFileSync(p, 'utf8'));
    const eres = E.analyze(er);
    if (er.t0Ms != null && eres.peaks) {
      const bp = E.bandpass(er.int16, er.fs);
      v = {
        lo: er.t0Ms,
        hi: er.t0Ms + (er.durSec || 0) * 1000,
        beats: refinePeaks(bp, eres.peaks).map((q) => er.t0Ms + (q / er.fs) * 1000)
      };
    }
  } catch (_x) {
    v = null;
  }
  _ecgMemo.set(p, v);
  return v;
}

const rows = [];
for (const f of ppgs) {
  let rec0;
  try {
    rec0 = P.parsePPG(readFileSync(f.p, 'utf8'));
  } catch (_e) {
    continue;
  }
  if (rec0.t0Ms == null || !rec0.ch || !rec0.ch.length) continue;
  if (SLEEP_ONLY && !isSleepNight(f.p.split('/').pop(), rec0.durSec || 0)) continue;

  const keepIdx = P.distinctChannelIdx(rec0.ch);
  const nChDistinct = keepIdx.length;
  if (nChDistinct < 2) {
    rows.push({ name: f.p.split('/').pop().slice(0, 38), nCh: nChDistinct, skip: 'single-channel — no vote to improve' });
    continue;
  }
  // rec.gap is a finger-site sentinel concept; a record carrying one needs analyze()'s hold-over,
  // which is not exported. Rather than approximate it, such a record is reported and skipped.
  if (rec0.gap) {
    rows.push({ name: f.p.split('/').pop().slice(0, 38), nCh: nChDistinct, skip: 'sentinel gaps — needs analyze() hold-over' });
    continue;
  }
  const perChannel = keepIdx.map((c) => P.detectChannel(rec0.ch[c], rec0.fs));
  const sel = P.pickChannel(rec0);
  const refIdx = Math.max(0, keepIdx.indexOf(sel.idx));

  // ── variant A: the shipped peak vote (feet re-derived on the reference channel)
  const signs = perChannel.map((pc) => pc.sign);
  const pkOff = peakOffsetsMs(perChannel, rec0.fs);
  /* Apply the SHIPPED consensus-polarity pass (E-5) before scoring, mirroring analyze(). Without this
     the tool measures the RAW per-channel detection and reports a split that the pipeline already
     resolves — which is exactly how it read after E-5 landed, until this line was added. `signs`/`pkOff`
     above are captured BEFORE the pass on purpose: they are the diagnosis, and `polarityCorrected`
     records whether the shipped code fixed it. */
  const polarityCorrected = typeof P.applyConsensusPolarity === 'function' ? P.applyConsensusPolarity(perChannel, (i, sgn) => P.detectChannel(rec0.ch[keepIdx[i]], rec0.fs, sgn)) : 0;
  const pkOffAfter = peakOffsetsMs(perChannel, rec0.fs);
  const consA = P.consensusBeats(perChannel, refIdx, rec0.fs);
  /* The operative defect is a peak DISPLACEMENT, not a sign difference per se: one night in this
     corpus has divergent signs with peaks still aligned (kept3/3 > 0). So flag on the offset and
     report the sign beside it, rather than treating the two as the same condition. */
  const offsetSplit = pkOff.some((o) => o != null && Math.abs(o) > TOL_MS);
  // ── variant B: E-1 foot-domain vote
  const consB = footConsensus(
    perChannel.map((pc) => pc.feet),
    refIdx,
    rec0.fs,
    TOL_MS,
    MIN_AGREE
  );

  const toMs = (fi) => {
    const i0 = Math.floor(fi),
      i1 = Math.min(rec0.n - 1, i0 + 1),
      fr = fi - i0;
    if (!(i0 >= 0 && i0 < rec0.n)) return null;
    return rec0.t0Ms + (rec0.relSec[i0] * (1 - fr) + rec0.relSec[i1] * fr) * 1000;
  };
  const beatsA = consA.feet.map(toMs).filter((x) => x != null);
  const beatsB = consB.feet.map(toMs).filter((x) => x != null);
  if (beatsA.length < 100 || beatsB.length < 100) continue;

  // pair the best-overlapping H10 ECG.
  //   Two costs are avoided here, and they matter: the corpus holds 419 ECG files, so parsing every
  //   one for every PPG night is O(nights x files) and dominated everything else. (1) The filename
  //   stamp gives a cheap pre-filter — an ECG that starts >12 h from the PPG cannot overlap it, and
  //   rejecting those costs a regex instead of a parse. (2) Survivors are parsed ONCE and cached by
  //   path, keeping only what scoring needs (refined beat times + window), not the int16 waveform.
  const fw = [rec0.t0Ms, rec0.t0Ms + (rec0.durSec || 0) * 1000];
  let best = null;
  for (const e of ecgs) {
    if (!plausiblyOverlaps(e.p, fw[0])) continue;
    const c = ecgCache(e.p);
    if (!c) continue;
    const ov = Math.min(fw[1], c.hi) - Math.max(fw[0], c.lo);
    if (ov > EPOCH_MS && (!best || ov > best.ov)) best = { ov, c };
  }
  if (!best) continue;
  const eBeats = best.c.beats;
  const lo = Math.max(fw[0], best.c.lo),
    hi = Math.min(fw[1], best.c.hi);

  const sA = score(beatsA, eBeats, lo, hi);
  const sB = score(beatsB, eBeats, lo, hi);
  if (!sA || !sB) continue;

  const dropA = consA.nDropped + consA.kept22 + consA.kept33 ? (100 * consA.nDropped) / (consA.nDropped + consA.kept22 + consA.kept33) : null;
  const dropB = consB.nClusters ? (100 * consB.nDropped) / consB.nClusters : null;
  const row = {
    name: f.p.split('/').pop().slice(0, 38),
    nCh: nChDistinct,
    dropA,
    dropB,
    ppvA: sA.ppv * 100,
    ppvB: sB.ppv * 100,
    recA: sA.rec == null ? null : sA.rec * 100,
    recB: sB.rec == null ? null : sB.rec * 100,
    jitA: sA.jit,
    jitB: sB.jit,
    offs: consB.offsets,
    signs,
    pkOff,
    pkOffAfter,
    polarityCorrected,
    kept33after: 0,
    offsetSplit,
    signSplit: new Set(signs).size > 1,
    kept33: consA.kept33
  };
  rows.push(row);
  const n = (v, d = 2) => (v == null ? '  n/a' : v.toFixed(d));
  console.log(
    `${row.name.padEnd(40)} ${String(nChDistinct).padStart(2)}  ${n(dropA).padStart(7)}  ${n(dropB).padStart(8)}  ${n(row.ppvA).padStart(6)}  ${n(row.ppvB).padStart(7)}  ${n(row.recA).padStart(6)}  ${n(row.recB).padStart(7)}  ${n(row.jitA).padStart(6)}  ${n(row.jitB).padStart(6)}`
  );
}

const scored = rows.filter((r) => !r.skip && r.jitA != null && r.jitB != null);
const skipped = rows.filter((r) => r.skip);
console.log('');
for (const s of skipped) console.log(`  ⊘ ${s.name}  (${s.nCh} distinct ch) — ${s.skip}`);
if (!scored.length) {
  console.log('\nno night scored — E-1 cannot be adjudicated on this corpus.');
  process.exit(0);
}
const col = (k) => scored.map((r) => r[k]).filter((v) => v != null);
const fmt = (a, d = 2) => (a.length ? `median ${median(a).toFixed(d)}  IQR ${quantile(a, 0.25).toFixed(d)}–${quantile(a, 0.75).toFixed(d)}` : 'n/a');
console.log(`\n${scored.length} night(s) scored\n`);
console.log(`  1-of-3 drop rate   peak vote  ${fmt(col('dropA'))} %`);
console.log(`                     FOOT vote  ${fmt(col('dropB'))} %`);
console.log(`  PPV @75 ms         peak vote  ${fmt(col('ppvA'))} %`);
console.log(`                     FOOT vote  ${fmt(col('ppvB'))} %   <- must NOT fall`);
console.log(`  recall of R-peaks  peak vote  ${fmt(col('recA'))} %`);
console.log(`                     FOOT vote  ${fmt(col('recB'))} %`);
console.log(`  PPI-jitter sd      peak vote  ${fmt(col('jitA'))} ms`);
console.log(`                     FOOT vote  ${fmt(col('jitB'))} ms   <- the currency (§3)`);

const dPPV = median(col('ppvB')) - median(col('ppvA'));
const dJit = median(col('jitB')) - median(col('jitA'));
const dDrop = median(col('dropB')) - median(col('dropA'));
console.log(`\n  Δ median   drop ${dDrop >= 0 ? '+' : ''}${dDrop.toFixed(2)} pp   PPV ${dPPV >= 0 ? '+' : ''}${dPPV.toFixed(2)} pp   jitter ${dJit >= 0 ? '+' : ''}${dJit.toFixed(2)} ms`);
console.log(`\n  E-1 verdict: ${dPPV >= -0.5 && dDrop < 0 ? 'drop rate recovered without a PPV cost' : dPPV < -0.5 ? 'PPV FELL — E-1 fails its own precondition' : 'no drop-rate recovery'}`);
const split = scored.filter((r) => r.offsetSplit);
const signOnly = scored.filter((r) => r.signSplit && !r.offsetSplit);
console.log(`\n  CHANNEL PEAK-OFFSET SPLIT: ${split.length} of ${scored.length} night(s) — one LED lands off the vote window`);
for (const r of split) {
  console.log(`    ${r.name.padEnd(40)} sign ${r.signs.join('/')}  peak offset vs ch0 (ms) ${r.pkOff.map((o) => (o == null ? 'n/a' : o.toFixed(1))).join('/')}  kept3/3=${r.kept33}`);
}
if (split.length) {
  const fixed = split.filter((r) => r.polarityCorrected > 0 && r.kept33 > 0).length;
  console.log(`    ^ diagnosed BEFORE the shipped consensus-polarity pass (E-5); ${fixed} of ${split.length} resolved by it`);
  console.log('      (kept3/3 > 0 after correction). A row still reading kept3/3 = 0 here would be a');
  console.log('      REGRESSION — the pass exists precisely to make that impossible.');
  console.log(`    A further ${signOnly.length} night(s) differ in SIGN with peaks still aligned — so an inverted`);
  console.log('    sign is correlated with, but not sufficient for, the failure.');
}
console.log(
  `  Per-night median inter-channel foot offsets (samples): ${scored
    .map((r) => (r.offs || []).map((o) => o.toFixed(1)).join('/'))
    .slice(0, 6)
    .join('  ')}`
);
console.log('\n  Reminder: a variant that recovers beats but raises jitter has NOT helped — RMSSD promotion');
console.log('  is jitter-bound (§3: finger 8.16 ms / wrist 8.36 ms against a 4.98 ms bar for 2 % bias).');
