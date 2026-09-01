#!/usr/bin/env node
/*
 * tools/pat-matchrate-strict.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * PAT-UNDER-PERBLOCK-ALIGNMENT §4, open item 1:
 *   "A stricter `matchRate` whose chance floor is not 60 %. Until then the coupling leg is not
 *    evidence either way."
 *
 * WHY THE SHIPPED matchRate HAS A 60 % FLOOR — two independent reasons, and only the first is the
 * one the brief names:
 *
 *   (1) THE WINDOW IS WIDE RELATIVE TO A BEAT. Stage one accepts the first foot with a lag in
 *       [PHYS_LO=200, PHYS_HI=650] — a 450 ms window. At 75–85 bpm (RR ≈ 700–800 ms) a foot train
 *       with NO relationship to the R-peaks still lands in that window ~450/750 ≈ 60 % of the time.
 *
 *   (2) STAGE TWO IS SELF-REFERENTIAL, so it does not repair (1). It keeps beats whose lag is within
 *       LAG_TOL_MS=90 of a 30 s LOCAL MEDIAN — but that median is computed FROM the very lags being
 *       filtered. Feed it noise and the median tracks the noise, so the filter passes the noise too.
 *       A test whose reference is derived from the data it is testing cannot fail.
 *
 * This tool does NOT change `pat-gate.js` or the shipped statistic. It measures, next to each other:
 *   · legacy   — the shipped definition, ported verbatim from `pat-feasibility-worker.js`
 *   · strict   — acceptance anchored to a LEAVE-ONE-BLOCK-OUT median lag, window ±STRICT_W_MS
 *   · chance   — for BOTH, from circular-shift surrogates of the real foot train
 *
 * The surrogate is the load-bearing part. It preserves the foot train's own rate and clustering —
 * an idealised Poisson floor (1 − e^{−λw}) would understate chance wherever the feet are regular,
 * which for a pulse train is everywhere. Shifting circularly by ≫ one RR destroys the R↔foot
 * relationship and keeps everything else.
 *
 * WHY LEAVE-ONE-BLOCK-OUT. The strict statistic must not derive its reference from the beats it
 * scores (reason 2 above). Each block's acceptance centre is the median lag of the OTHER blocks, so
 * a night of noise has no self-consistent centre to find. That is the whole difference.
 *
 * This tool adds no signal processing of its own — it orchestrates already-committed DSP surfaces —
 * so it moves no bundle and no manifestHash (same rationale as `tools/trio-batch.mjs`).
 *
 * PRIVACY. Reads the gitignored raw capture folder; emits DERIVED per-night scalars only. No raw
 * signal, no device serial, no filenames in the output.
 *
 * USAGE
 *   node tools/pat-matchrate-strict.mjs --dir uploads/trio            # every night found
 *   node tools/pat-matchrate-strict.mjs --dir uploads/trio --night 2026-07-20
 *   node tools/pat-matchrate-strict.mjs --dir uploads/trio --surrogates 200 --json
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { CFD_FRAC, fractionAmplitudeIndex, halfAmplitudeIndex } from './pat-fiducial.mjs';

// the repo's own ESM→classic shim, so a DSP's `export const` tail does not break the vm realm
const DexBuild = createRequire(import.meta.url)('./build-core.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const JSON_OUT = argv.includes('--json');
const DIR = arg('--dir', 'uploads/trio');
const ONLY = arg('--night', null);
const N_SURR = +arg('--surrogates', 100);

/* Shipped constants — ported, not re-derived. If `pat-feasibility-worker.js` moves these, this
   tool's `legacy` column stops describing the shipped statistic, which is the point of pinning
   them here rather than re-reading them: a silent divergence would make the comparison a lie. */
const LAG_SEARCH_MS = 2000,
  LAG_TOL_MS = 90,
  BIN_MIN = 5,
  PHYS_LO = 200,
  PHYS_HI = 650;
/* The strict window. ±40 ms is ~1/9 of an RR, so the geometric floor is ~11 % rather than ~60 %.
   It is also wider than the 8–45 ms residIQR this corpus shows on clean nights, so it is not so
   tight that a genuinely coupled night fails it for arithmetic reasons. */
const STRICT_W_MS = 40;
const BLOCK_MS = BIN_MIN * 60000;

function median(a) {
  if (!a.length) return NaN;
  const b = Float64Array.from(a).sort();
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}
function quantile(a, q) {
  if (!a.length) return NaN;
  const b = Float64Array.from(a).sort();
  const i = (b.length - 1) * q,
    lo = Math.floor(i),
    hi = Math.ceil(i);
  return lo === hi ? b[lo] : b[lo] + (b[hi] - b[lo]) * (i - lo);
}

/* ── the headless DSP realm (same co-load contract as tools/trio-batch.mjs) ───────────────────── */
let ECGDSP, PPGDSP, PATAlign, DexClock;
function loadDsps() {
  if (ECGDSP) return;
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.console = console;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.__DEX_NAMESPACED__ = true;
  const ctx = vm.createContext(sandbox);
  // clock.js FIRST — the delegating DSPs alias DexClock.parseTimestamp at load (CLAUDE.md §Clock Contract)
  for (const f of ['clock.js', 'kernel-constants.js', 'pat-align.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js']) {
    const p = join(ROOT, f);
    if (!existsSync(p)) throw new Error('module not found: ' + f);
    vm.runInContext(DexBuild.classicify(readFileSync(p, 'utf8')), ctx, { filename: f });
  }
  ECGDSP = ctx.ECGDSP || (ctx.ECGDex && ctx.ECGDex._bare);
  PPGDSP = ctx.PPGDSP || (ctx.PpgDex && ctx.PpgDex._bare);
  PATAlign = ctx.PATAlign;
  DexClock = ctx.DexClock; // the Clock Contract's parser, so a sibling never hand-rolls a stamp regex

  for (const [n, v] of Object.entries({ ECGDSP, PPGDSP, PATAlign })) if (!v) throw new Error('pat-matchrate-strict: ' + n + ' did not load into the headless realm');
}

/* ── beat derivation: ported from pat-feasibility-worker.js ───────────────────────────────────────
   `opts.axis` (ADDITIVE — omitted ⇒ byte-identical to every existing caller):
     'linear' / omitted — R time = t0Ms + i/fs·1000, the historical form. `fs` may carry the DSP's
       single-RATE host correction; a step or any non-linear divergence stays in the times.
     'piecewise' — R time = rec.tMsAt(i), the DSP's own host-disciplined position map (raw device
       rate + hostAxis interpolation; ecgdex-dsp.js builds it — H_axis pre-registration,
       PPG-FOOT-PLACEMENT-FOLLOWUPS §1). REPLACE-not-stack is the DSP's construction, not this
       tool's arithmetic: tMsAt rides fsDevice (pre-ppm), so the linear component is never counted
       twice. The map is live only when a real, independent second clock exists (`tMsCorrected`);
       a caller MUST read `tMsCorrected` and treat false as a refusal to discipline — the returned
       times are then plain device-axis, honestly, never a silent zero-correction "success".
   The return also carries `maxStepMs` (a step is reported, never corrected — a mid-file step
   smears across one anchor gap under piecewise and can move a half-mode) and `independent`.
   Sortedness after the transform is ASSERTED: hostAxis bounds slope, but the assertion is free
   and a non-monotonic train would silently break every downstream nearest-forward match. */
function ecgRpeakTimes(text, opts) {
  const rec = ECGDSP.parseECG(text);
  if (rec.t0Ms == null) throw new Error('ECG file carried no phone timestamp.');
  const bp = ECGDSP.bandpass(rec.int16, rec.fs);
  const peaks = ECGDSP.detectPeaks(rec.int16, bp, rec.fs);
  const piecewise = opts && opts.axis === 'piecewise';
  const t = new Float64Array(peaks.length);
  for (let i = 0; i < peaks.length; i++) t[i] = piecewise ? rec.tMsAt(peaks[i]) : rec.t0Ms + (peaks[i] / rec.fs) * 1000;
  if (piecewise) {
    for (let i = 1; i < t.length; i++) if (!(t[i] >= t[i - 1])) throw new Error(`piecewise ECG axis broke sortedness at beat ${i}`);
  }
  return {
    t0Ms: rec.t0Ms,
    fs: rec.fs,
    durSec: rec.durSec,
    times: t,
    n: peaks.length,
    tMsAt: rec.tMsAt,
    tMsCorrected: !!rec.tMsCorrected,
    independent: rec.hostAxis ? rec.hostAxis.independent : null,
    maxStepMs: rec.hostAxis ? rec.hostAxis.maxStepMs : null
  };
}
function ppgFootTimes(text) {
  const rec = PPGDSP.parsePPG(text);
  if (rec.t0Ms == null) throw new Error('PPG file carried no phone timestamp.');
  const per = rec.ch.map((c) => PPGDSP.detectChannel(c, rec.fs));
  /* CONSENSUS POLARITY — the node's `analyze` applies this and THIS TOOL CHAIN DID NOT, so every PAT
     measurement ran on per-channel polarity guesses the shipping node would have overruled.
     `orientByRise` decides each channel independently, and on a split night the dissenting channel is
     detected UPSIDE DOWN: its "feet" are peaks, ~half a cardiac cycle out. Measured on the box nights
     behind the ΔPAT work — 2026-08-14 splits [+1,+1,-1] while 08-13/15/16 are unanimous — and 08-14 is
     exactly the night that produced the first arousal-shaped dip index and a sub-chance Katz fraction.
     PPG-FOOT-PLACEMENT §0 is the same defect one layer down (`orient` vs `orientByRise`); this is its
     WIRING half: a fix that ships in the node but never reaches the tools measuring it.
     `applyConsensusPolarity` re-detects exactly the dissenters with the majority sign, and is a no-op
     on a unanimous set. */
  const flipped = PPGDSP.applyConsensusPolarity(per, (i, sgn) => PPGDSP.detectChannel(rec.ch[i], rec.fs, sgn));
  let refIdx = 0,
    best = -1;
  per.forEach((p, i) => {
    if (p.peaks.length > best) {
      best = p.peaks.length;
      refIdx = i;
    }
  });
  const cons = PPGDSP.consensusBeats(per, refIdx, rec.fs);
  const rel = rec.relSec,
    fs = rec.fs,
    t0 = rec.t0Ms;
  /* A fiducial index may be FRACTIONAL (the half-amplitude crossing is interpolated between two
     samples), so the index→time map has to interpolate `relSec` too. Truncating to an integer
     sample would quantise the very sub-sample precision the alternative fiducial exists to buy —
     at 55 Hz one sample is 18 ms, which is the same order as the PAT differences under test. */
  const timeAt = (idx) => {
    if (!(idx >= 0)) return Number.NaN;
    const lo = Math.floor(idx),
      hi = Math.ceil(idx),
      fr = idx - lo;
    const relOk = (k) => rel && rel[k] != null && isFinite(rel[k]);
    const sec = relOk(lo) && relOk(hi) ? rel[lo] + fr * (rel[hi] - rel[lo]) : idx / fs;
    return t0 + sec * 1000;
  };
  const t = new Float64Array(cons.feet.length);
  for (let i = 0; i < cons.feet.length; i++) t[i] = timeAt(cons.feet[i]);
  /* ── THE ALTERNATIVE FIDUCIAL (EXTERNAL-METHODS-SURVEY §1) ───────────────────────────────────
     Ajtay et al. (2023) rank the 1/2-amplitude point BEST and the base (foot) WORST for
     beat-to-beat PAT imprecision. Computed here rather than in a sibling because it needs the
     reference channel's bandpassed trace and the consensus (foot, peak) pairing, both of which are
     local to this function; deriving them again elsewhere would be a second, divergable copy.
     ADDITIVE - `times` is unchanged, so every existing caller is byte-identical.

     [!] `halfTimes` IS INDEX-PARALLEL WITH `times`, NaN where the beat has no usable rising edge -
     it is deliberately NOT compacted. The (half minus foot) offset per beat is the quantity that
     says how far a foot-tuned acceptance window would have to move, and a compacted array silently
     pairs beat i's half with beat j's foot, manufacturing an offset out of the dropped beats. A
     consumer filters NaN; it cannot recover a correspondence that was thrown away here. */
  const refBp = per[refIdx].bp;
  const half = new Float64Array(cons.feet.length);
  /* `cfdTimes` — the SAME crossing at f = CFD_FRAC (PPG-FOOT-PLACEMENT §3's constant-fraction
     discriminator), under the same index-parallel/NaN contract as `halfTimes`. ADDITIVE: `times`
     and `halfTimes` are unchanged, so every existing caller is byte-identical. */
  const cfd = new Float64Array(cons.feet.length);
  let nUnusable = 0;
  let nCfdUnusable = 0;
  for (let i = 0; i < cons.feet.length; i++) {
    const h = halfAmplitudeIndex(refBp, cons.feet[i], cons.peaks[i]);
    if (h == null) {
      nUnusable++;
      half[i] = Number.NaN;
    } else {
      half[i] = timeAt(h);
    }
    const c = fractionAmplitudeIndex(refBp, cons.feet[i], cons.peaks[i], CFD_FRAC);
    if (c == null) {
      nCfdUnusable++;
      cfd[i] = Number.NaN;
    } else {
      cfd[i] = timeAt(c);
    }
  }
  return {
    t0Ms: rec.t0Ms,
    fs: rec.fs,
    durSec: rec.durSec,
    times: t,
    n: cons.feet.length,
    polarityFlipped: flipped,
    halfTimes: half,
    nHalfUnusable: nUnusable,
    cfdTimes: cfd,
    nCfdUnusable
  };
}

/* ── per-block alignment, via the repo's own anchor aligner ───────────────────────────────────────
   Without this the whole measurement is meaningless: the two device clocks sit seconds apart (they
   are re-synced per connect, not disciplined), so raw R→foot lags do not land in the physiological
   window at all and every matchRate collapses toward zero for a reason that has nothing to do with
   coupling.

   Alignment must NOT be done on the beat trains themselves. Matching beats to beats pins the offset
   only modulo one RR interval — a whole-heartbeat error is invisible to the fit and would silently
   manufacture "coupling" out of a slipped beat. The chest and arm accelerometers see the SAME
   mechanical movements at the SAME true instant, so `PATAlign.alignByAnchors` anchors on those
   instead. That is the entire reason `pat-align.js` exists.

   The alignment is applied ONCE, to the observed foot train, BEFORE surrogation — so every surrogate
   is a rotation of the SAME aligned train. Whatever favour alignment grants the observation, it
   grants the null identically. A chance floor measured on unaligned surrogates would be flattering
   and worthless. */
/* `parseSensorXYZ` returns a flat ARRAY of {relNs,tMs,x,y,z} — NOT a {t0Ms,durSec} record like
   parseECG/parsePPG do. Reading it as a record silently yields undefined bounds, zero overlap, and a
   clean-looking "no overlapping ACC" skip on nights that have plenty. Bounds come from the samples.
   These files are large (a single night's Verity ACC is ~339 MB / 6.1 M samples), so only the two
   largest candidates per device are parsed. */
/* Prefilter ACC candidates by TIME, not size. The largest fragment of a night is usually the long
   early-morning one; if the chosen ECG/PPG pair sits at 22:31 then the two biggest ACC files can
   both end hours before it, and a size-ranked shortlist reports "no overlapping ACC" on a night that
   has plenty. The filename's YYYYMMDDHHMMSS is the cheap key that avoids parsing 339 MB to find out. */
function nameStartMs(f) {
  const m = /_(\d{14})_/.exec(f);
  if (!m) return null;
  const s = m[1];
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
}
function nearInTime(dir, re, t0, t1, n) {
  return readdirSync(dir)
    .filter((f) => re.test(f))
    .map((f) => ({ f: join(dir, f), start: nameStartMs(f) }))
    .filter((c) => c.start != null && c.start <= t1)
    .sort((a, b) => Math.abs(a.start - t0) - Math.abs(b.start - t0))
    .slice(0, n);
}
function bestAccFor(dir, deviceRe, t0, t1) {
  let best = null;
  for (const c of nearInTime(dir, deviceRe, t0, t1, 3)) {
    let s;
    try {
      s = PPGDSP.parseSensorXYZ(readFileSync(c.f, 'utf8'));
    } catch {
      continue;
    }
    if (!s || !s.length || s[0].tMs == null) continue;
    const ov = Math.min(t1, s[s.length - 1].tMs) - Math.max(t0, s[0].tMs);
    if (ov > (best?.ov ?? 0)) best = { ov, samples: s };
  }
  return best;
}
/* `timesOverride` lets a caller align a DIFFERENT train off the same PPG record — the alternative
   fiducial above — without re-running the ACC anchor fit. Omitted ⇒ `ppg.times`, i.e. unchanged.
   ⚠ The anchors come from the two ACCELEROMETERS, never from the beat trains, so the offset is a
   property of the CLOCKS alone. That is what makes the fiducial comparison meaningful: an aligner
   fitted to the beats would silently absorb the constant foot→half offset and report no difference
   where there is one. */
function alignFeet(dir, ecg, ppg, timesOverride) {
  const t0 = Math.max(ecg.t0Ms, ppg.t0Ms);
  const t1 = Math.min(ecg.t0Ms + ecg.durSec * 1000, ppg.t0Ms + ppg.durSec * 1000);
  const a = bestAccFor(dir, /H10.*_ACC\.txt$/i, t0, t1);
  const b = bestAccFor(dir, /verity.*_ACC\.txt$/i, t0, t1);
  if (!a || !b) return { ok: false, reason: 'no overlapping ACC on one or both devices' };
  const eA = PATAlign.envelope(a.samples, t0, t1, {});
  const eB = PATAlign.envelope(b.samples, t0, t1, {});
  if (!eA || !eB) return { ok: false, reason: 'ACC envelope failed' };
  const r = PATAlign.alignByAnchors(eA, eB, t0, {});
  if (!r.ok) return { ok: false, reason: r.reason + ' (anchors=' + (r.anchors ? r.anchors.length : 0) + ')' };
  const an = r.anchors;
  // piecewise-linear between anchors, FLAT outside — drift is never extrapolated past the last one
  const offsetAt = (t) => {
    if (t <= an[0].tMs) return an[0].offsetMs;
    if (t >= an[an.length - 1].tMs) return an[an.length - 1].offsetMs;
    for (let i = 1; i < an.length; i++)
      if (t <= an[i].tMs) {
        const p = an[i - 1],
          q = an[i];
        return p.offsetMs + ((t - p.tMs) / (q.tMs - p.tMs || 1)) * (q.offsetMs - p.offsetMs);
      }
    return an[an.length - 1].offsetMs;
  };
  const src = timesOverride || ppg.times;
  const out = new Float64Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] - offsetAt(src[i]);
  return { ok: true, times: Float64Array.from(out).sort(), nAnchors: an.length, offRange: r.offsetRangeMs };
}

/* Stage one, shared by both definitions: the first foot after each R with a PHYSIOLOGICAL lag.
   Returns one entry per R-peak that HAS such a foot. Both statistics start here, so any difference
   between them is entirely in the acceptance rule that follows. */
function rawLags(rTimes, fTimes) {
  const out = [];
  let j = 0;
  const nf = fTimes.length;
  for (let i = 0; i < rTimes.length; i++) {
    const r = rTimes[i];
    while (j < nf && fTimes[j] < r) j++;
    let k = j;
    while (k < nf && fTimes[k] - r <= LAG_SEARCH_MS) {
      const lag = fTimes[k] - r;
      if (lag >= PHYS_LO && lag <= PHYS_HI) {
        out.push({ t: r, lag: lag });
        break;
      }
      if (lag > PHYS_HI) break;
      k++;
    }
  }
  return out;
}

/* LEGACY — verbatim second stage: keep a beat if its lag is within LAG_TOL_MS of the median of a
   ±30 s window of the SAME lag series. Self-referential by construction (see header). */
function legacyMatchRate(lagAtR, nR) {
  const LOCAL_WIN_MS = 30000;
  let lo = 0,
    hi = 0,
    kept = 0;
  const resid = [];
  for (let m = 0; m < lagAtR.length; m++) {
    const tt0 = lagAtR[m].t;
    while (lo < lagAtR.length && lagAtR[lo].t < tt0 - LOCAL_WIN_MS) lo++;
    while (hi < lagAtR.length && lagAtR[hi].t <= tt0 + LOCAL_WIN_MS) hi++;
    const win = [];
    for (let w = lo; w < hi; w++) win.push(lagAtR[w].lag);
    const d0 = lagAtR[m].lag - median(win);
    if (Math.abs(d0) <= LAG_TOL_MS) {
      kept++;
      resid.push(d0);
    }
  }
  return {
    matchRate: nR ? kept / nR : NaN,
    residIQR: resid.length ? quantile(resid, 0.75) - quantile(resid, 0.25) : NaN
  };
}

/* STRICT — acceptance centre for each block is the median lag of every OTHER block. A night with no
   real R↔foot relationship has no centre that generalises across blocks, so it cannot self-confirm. */
function strictMatchRate(lagAtR, nR) {
  if (!lagAtR.length) return { matchRate: NaN, residIQR: NaN, nBlocks: 0 };
  const t0 = lagAtR[0].t;
  const byBlock = new Map();
  for (const e of lagAtR) {
    const b = Math.floor((e.t - t0) / BLOCK_MS);
    if (!byBlock.has(b)) byBlock.set(b, []);
    byBlock.get(b).push(e.lag);
  }
  const blocks = [...byBlock.keys()].sort((a, b) => a - b);
  if (blocks.length < 2) return { matchRate: NaN, residIQR: NaN, nBlocks: blocks.length };
  let kept = 0;
  const resid = [];
  for (const b of blocks) {
    const others = [];
    for (const o of blocks) if (o !== b) others.push(...byBlock.get(o));
    const centre = median(others); // held-out — never this block's own lags
    for (const lag of byBlock.get(b)) {
      const d0 = lag - centre;
      if (Math.abs(d0) <= STRICT_W_MS) {
        kept++;
        resid.push(d0);
      }
    }
  }
  return {
    matchRate: nR ? kept / nR : NaN,
    residIQR: resid.length ? quantile(resid, 0.75) - quantile(resid, 0.25) : NaN,
    nBlocks: blocks.length
  };
}

/* Circular-shift surrogate: rotate the foot train inside its own span. Preserves the exact set of
   inter-foot intervals (rate, regularity, dropouts) and destroys only the R↔foot relationship —
   which is precisely the null these matchRates are supposed to be tested against.
   Deterministic offsets (no Math.random): the i-th of N surrogates is shifted by an irrational-ish
   fraction of the span, so runs are reproducible and reviewable. */
function circShift(fTimes, span, frac) {
  const shift = span * frac;
  const out = new Float64Array(fTimes.length);
  const lo = fTimes[0];
  for (let i = 0; i < fTimes.length; i++) out[i] = lo + ((((fTimes[i] - lo + shift) % span) + span) % span);
  return Float64Array.from(out).sort();
}

function analyseNight(night, dir, ecg, ppg, overlapMin) {
  const al = alignFeet(dir, ecg, ppg);
  if (!al.ok) return { night, skipped: 'alignment: ' + al.reason };
  /* Score ONLY the shared window. matchRate's denominator is R-peaks, so an ECG fragment that runs
     hours past the PPG would count every uncovered beat as a miss — the statistic would then measure
     recording overlap, not coupling, and read ~31 % where the shipped pipeline reads ~95 %. */
  const wLo = Math.max(ecg.t0Ms, al.times[0]),
    wHi = Math.min(ecg.t0Ms + ecg.durSec * 1000, al.times[al.times.length - 1]);
  const feet = al.times.filter((t) => t >= wLo && t <= wHi);
  const rT = Array.from(ecg.times).filter((t) => t >= wLo && t <= wHi);
  if (rT.length < 20 || feet.length < 20) return { night, skipped: 'shared window has too few beats' };
  const span = feet[feet.length - 1] - feet[0];
  if (!(span > 0)) return { night, skipped: 'zero span in the shared window' };

  const nR = rT.length;
  const obsLags = rawLags(rT, feet);
  const legacy = legacyMatchRate(obsLags, nR);
  const strict = strictMatchRate(obsLags, nR);

  const legChance = [],
    strChance = [];
  for (let s = 0; s < N_SURR; s++) {
    // golden-ratio spacing keeps the offsets well spread and never lands on 0 or the full span
    const frac = ((s + 1) * 0.6180339887498949) % 1;
    if (frac < 0.05 || frac > 0.95) continue; // a near-zero shift is not a surrogate
    const sf = circShift(feet, span, frac);
    const sl = rawLags(rT, sf);
    legChance.push(legacyMatchRate(sl, nR).matchRate);
    strChance.push(strictMatchRate(sl, nR).matchRate);
  }
  const summarise = (obs, ch) => {
    const good = ch.filter((x) => isFinite(x));
    const mu = good.length ? good.reduce((a, b) => a + b, 0) / good.length : NaN;
    const sd = good.length > 1 ? Math.sqrt(good.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (good.length - 1)) : NaN;
    // how many surrogates matched or beat the observed value — an exact p, no distributional assumption
    const ge = good.filter((x) => x >= obs).length;
    return {
      chanceMean: +mu.toFixed(4),
      chanceP95: +quantile(good, 0.95).toFixed(4),
      ratio: isFinite(mu) && mu > 0 ? +(obs / mu).toFixed(2) : null,
      z: isFinite(sd) && sd > 0 ? +((obs - mu) / sd).toFixed(1) : null,
      pPerm: +((ge + 1) / (good.length + 1)).toFixed(4),
      nSurr: good.length
    };
  };
  return {
    night,
    nR,
    nFeet: feet.length,
    overlapMin: +overlapMin.toFixed(1),
    nAnchors: al.nAnchors,
    hours: +(span / 3600000).toFixed(2),
    legacy: { matchRate: +legacy.matchRate.toFixed(4), residIQR: +legacy.residIQR.toFixed(1), ...summarise(legacy.matchRate, legChance) },
    strict: { matchRate: +strict.matchRate.toFixed(4), residIQR: +strict.residIQR.toFixed(1), nBlocks: strict.nBlocks, ...summarise(strict.matchRate, strChance) }
  };
}

/* ── night discovery ──────────────────────────────────────────────────────────────────────────── */
/* A capture night is NOT one file per device. BLE drops and reconnects, so a night is dozens of
   fragments (2026-07-18: 110 ECG × 414 Verity PPG). Taking the first of each would pair two
   recordings that never overlapped and report a matchRate on an empty intersection — which would
   look like a measured negative rather than a harness bug.
   So: parse the CANDIDATES largest fragments of each device, and pick the pair with the largest true
   temporal overlap. Size is only a prefilter; the decision is made on parsed t0Ms/durSec. */
const CANDIDATES = 4;
const MIN_OVERLAP_MIN = 20;
function biggest(dir, re, n) {
  return readdirSync(dir)
    .filter((f) => re.test(f))
    .map((f) => ({ f: join(dir, f), size: statSync(join(dir, f)).size }))
    .sort((a, b) => b.size - a.size)
    .slice(0, n);
}
function bestPair(dir) {
  const ecgs = biggest(dir, /_ECG\.txt$/i, CANDIDATES);
  let ppgs = biggest(dir, /verity.*_PPG\.txt$/i, CANDIDATES);
  if (!ppgs.length) ppgs = biggest(dir, /_PPG\.txt$/i, CANDIDATES);
  if (!ecgs.length || !ppgs.length) return null;
  const parse = (list, fn) =>
    list
      .map((c) => {
        try {
          const r = fn(readFileSync(c.f, 'utf8'));
          return r.t0Ms == null ? null : { ...c, rec: r };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  const E = parse(ecgs, ecgRpeakTimes),
    P = parse(ppgs, ppgFootTimes);
  let best = null;
  for (const e of E)
    for (const p of P) {
      const s = Math.max(e.rec.t0Ms, p.rec.t0Ms);
      const end = Math.min(e.rec.t0Ms + e.rec.durSec * 1000, p.rec.t0Ms + p.rec.durSec * 1000);
      const min = (end - s) / 60000;
      if (min > (best?.overlapMin ?? 0)) best = { ecg: e.rec, ppg: p.rec, overlapMin: min };
    }
  return best && best.overlapMin >= MIN_OVERLAP_MIN ? best : best ? { ...best, tooShort: true } : null;
}

/* ── exports for the gate ────────────────────────────────────────────────────────────────────────
   The statistics are pure and are what the suite asserts. They are exported so a test can reach
   them WITHOUT running the CLI: a bare `import` of a tool that executes at module scope starts a
   full corpus run inside the test process (this repo has been bitten by exactly that with
   `tools/mutate.mjs`). Everything below the guard runs only when this file is the entry point. */
export { legacyMatchRate, strictMatchRate, circShift, rawLags, STRICT_W_MS, PHYS_LO, PHYS_HI, LAG_TOL_MS };
/* Beat derivation is exported for the SAME reason as the statistics above: a sibling tool must be
   able to reuse it without forking the headless-realm loader. `tools/pat-finger-coupler.mjs` runs
   the O2Ring finger leg, which cannot use this file's ACC alignment (the ring has no accelerometer
   — O2RING-RAW-STREAMS-ABSENT §6) but must derive R-peaks and feet identically, or the two legs
   would not be comparable. Additive only; nothing above changes. */
/* The loaded realm itself, so a sibling can derive a DIFFERENT PPG FIDUCIAL without a second loader.
   PAT is defined against a fiducial and the choice is load-bearing: the FOOT is classical but sits at
   the trough where SNR is worst, while the systolic PEAK detects far more reliably and merely adds a
   (near-constant) ejection interval — which the strict statistic's leave-one-block-out centre absorbs
   exactly as it absorbs delta. A null under one fiducial is not a null under the other. */
function getDsps() {
  loadDsps();
  return { ECGDSP, PPGDSP, PATAlign, DexClock };
}
export { loadDsps, getDsps, ecgRpeakTimes, ppgFootTimes, median, quantile, BIN_MIN };
/* Night selection and clock alignment, so the fiducial comparison runs on exactly the pair and the
   offsets this tool would have used. Forking either would make the two legs incomparable — which is
   the whole failure `pat-finger-coupler.mjs`'s note above was written to avoid. Additive. */
export { bestPair, alignFeet, MIN_OVERLAP_MIN };

const IS_CLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (IS_CLI) {
  // the raw corpus lives OUTSIDE the repo volume (it is gitignored), so an absolute --dir must work
  const base = DIR.startsWith('/') ? DIR : join(ROOT, DIR);
  if (!existsSync(base)) {
    console.error(`pat-matchrate-strict: ${DIR} not found. The raw corpus is gitignored — pass --dir.`);
    process.exit(2);
  }
  const nights = readdirSync(base)
    .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n) && statSync(join(base, n)).isDirectory())
    .filter((n) => !ONLY || n === ONLY)
    .sort();

  loadDsps();
  const rows = [];
  for (const n of nights) {
    try {
      const pair = bestPair(join(base, n));
      if (!pair) {
        rows.push({ night: n, skipped: 'no parseable ECG+Verity-PPG pair' });
        continue;
      }
      if (pair.tooShort) {
        rows.push({ night: n, skipped: `best overlap only ${pair.overlapMin.toFixed(1)} min (< ${MIN_OVERLAP_MIN})` });
        continue;
      }
      rows.push(analyseNight(n, join(base, n), pair.ecg, pair.ppg, pair.overlapMin));
    } catch (e) {
      rows.push({ night: n, skipped: String((e && e.message) || e) });
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ strictWindowMs: STRICT_W_MS, blockMin: BIN_MIN, surrogates: N_SURR, rows }, null, 2));
  } else {
    const ok = rows.filter((r) => !r.skipped);
    console.log(`\nPAT matchRate — shipped definition vs a held-out-anchor definition, each against its own circular-shift null`);
    console.log(`strict window ±${STRICT_W_MS} ms · blocks ${BIN_MIN} min · ${N_SURR} surrogates/night\n`);
    console.log('night        beats  |  legacy  chance  ratio   p    |  strict  chance  ratio   p');
    console.log('─'.repeat(84));
    for (const r of rows) {
      if (r.skipped) {
        console.log(`${r.night}  ⊘ ${r.skipped}`);
        continue;
      }
      const f = (x) => (x == null || !isFinite(x) ? '  —  ' : (x * 100).toFixed(0).padStart(4) + '%');
      console.log(
        `${r.night}  ${String(r.nR).padStart(5)}  |  ${f(r.legacy.matchRate)}  ${f(r.legacy.chanceMean)}  ${String(r.legacy.ratio ?? '—').padStart(5)}  ${String(r.legacy.pPerm).padStart(6)} ` +
          `|  ${f(r.strict.matchRate)}  ${f(r.strict.chanceMean)}  ${String(r.strict.ratio ?? '—').padStart(5)}  ${String(r.strict.pPerm).padStart(6)}`
      );
    }
    if (ok.length) {
      const mean = (sel) =>
        (ok
          .map(sel)
          .filter(isFinite)
          .reduce((a, b) => a + b, 0) /
          ok.map(sel).filter(isFinite).length) *
        100;
      console.log('─'.repeat(84));
      console.log(
        `mean            |  ${mean((r) => r.legacy.matchRate).toFixed(0)}%   ${mean((r) => r.legacy.chanceMean).toFixed(0)}%          |  ${mean((r) => r.strict.matchRate).toFixed(0)}%   ${mean((r) => r.strict.chanceMean).toFixed(0)}%`
      );
      console.log(`\n${ok.length} night(s) scored.  A definition is evidence only where its chance column is LOW and its ratio is HIGH.`);
    }
  }
}
