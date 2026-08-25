#!/usr/bin/env node
/*
 * tools/pat-host-offset.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * PAT-UNDER-PERBLOCK-ALIGNMENT §3e.4, the shipped form of the scout.
 *
 * WHAT CHANGES vs `tools/pat-matchrate-strict.mjs`, and why each change is forced:
 *
 *   1. THE OFFSET IS READ, NOT ESTIMATED FROM MOTION. §3e measured the ACC anchors disagreeing with
 *      THEMSELVES by 1171–3094 ms inside a single pair — 13–34× the ±90 ms tolerance — so no model
 *      built on them can work, and the three that were tried came out three coin-flips. On a BOX
 *      capture both streams are stamped by the SAME daemon, and each device carries the pair needed
 *      to measure its own host divergence: `sensor timestamp [ns]` against `Phone timestamp`, on the
 *      same row. That is exactly `DexClock.hostAxis`'s anchor contract, so this drives the SHIPPED
 *      `hostAxis` rather than the re-implementation §3e.4 scouted with.
 *
 *   2. WINDOWS, NOT WHOLE NIGHTS. §3e.4 measured the inter-device offset IQR growing monotonically
 *      with duration — 123 min → 39 ms, 563 min → 128 ms — because the offset wanders over hours. A
 *      9 h night cannot be one scoring block at this precision. `--window` (default 120 min) is the
 *      unit, and it is a stated parameter rather than an emergent property of which fragment was big.
 *
 *   3. NO PAIR SELECTION AT ALL — IT ENUMERATES. §3c showed legacy `matchRate` spanning 0–77 % across
 *      pairs of ONE night, and §3c.4 that selecting the best pair BY the statistic is circular. The
 *      fix is not a better rule, it is to stop choosing: every pair and every non-overlapping window
 *      is scored and the whole distribution is reported. A distribution cannot be cherry-picked.
 *
 * REFUSALS ARE LOUD. A window whose `hostAxis` returns `ok:false`, or `independent:false` (the host
 * column was derived from the device stamp and is not a second clock — see clock.js), is reported
 * with its reason and scored NOT AT ALL. Silently falling back to an uncorrected axis is how a
 * measurement of the alignment turns into a measurement of nothing.
 *
 * This tool adds NO signal processing of its own — it orchestrates already-committed surfaces
 * (`DexClock`, `ECGDSP`, `PPGDSP`) and imports the two `matchRate` definitions and their
 * circular-shift null from `pat-matchrate-strict.mjs` — so it moves no bundle and no manifestHash.
 *
 * PRIVACY. Reads the gitignored raw capture folder; emits DERIVED per-window scalars only. No raw
 * signal, no device serial, no filenames in the output.
 *
 * USAGE
 *   node tools/pat-host-offset.mjs --dir <captures>                     # every night found
 *   node tools/pat-host-offset.mjs --dir <captures> --night 2026-07-28
 *   node tools/pat-host-offset.mjs --dir <captures> --window 120 --surrogates 50 --json
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { legacyMatchRate, strictMatchRate, circShift, rawLags } from './pat-matchrate-strict.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DexBuild = require(join(ROOT, 'tools', 'build-core.js'));

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const DIR = arg('dir', 'uploads/trio');
const ONLY = arg('night', null);
const WINDOW_MIN = Number(arg('window', 120));
const N_SURR = Number(arg('surrogates', 50));
const CANDIDATES = Number(arg('candidates', 4));
const JSON_OUT = process.argv.includes('--json');
const SCAN = process.argv.includes('--scan');
const SCAN_LO = Number(arg('scan-lo', -1200)),
  SCAN_HI = Number(arg('scan-hi', 1200)),
  SCAN_STEP = Number(arg('scan-step', 25));
/* The scan gets its OWN surrogate count. Its p is floored at 1/(n+1), so re-using a divided-down
   count silently caps it ABOVE 0.05 and every window then reports the same non-significant p —
   observed at n=8, where all four windows read exactly 0.111 and the statistic could not have come
   out any other way. Defaults to the main count rather than a fraction of it. */
const SCAN_SURR = Number(arg('scan-surrogates', N_SURR));
/* WHICH PPG TIMING POINT. The foot is the standard for PAT/PTT and is what O2RING-PPG-GAP §3 argues
   for on PPI grounds (the intersecting-tangent foot reads the diastolic trough and the steepest rise,
   and is untouched by a sentinel near the systolic peak). But the foot is also the HARDER of the two
   to detect in low-perfusion PPG, and that gives §3f's intermittency a THIRD candidate explanation
   the brief did not list: not the physiology and not the offset, but the timing point itself getting
   noisier. `consensusBeats` already returns both, so the question costs one argument to ask.
   ⚠ NOT a like-for-like swap at δ=0: the peak trails the foot by ~100-250 ms, so a peak lag can leave
   the [PHYS_LO, PHYS_HI] window that was calibrated for feet. Compare the two under --scan, which is
   free to absorb that constant, and not on the raw δ=0 score. */
const TIMING_POINT = arg('timing-point', 'foot');
/* ── THE REFERENCE TRAIN — `ecg` (default) or `ppg-ppg` ──────────────────────────────────────────────
   PAT = PEP + PTT. The pre-ejection period varies beat-to-beat with contractility and preload, so an
   ECG→foot interval carries it and a foot→foot interval does not: two peripheral sites CANCEL PEP by
   construction. §3i located the blocker as ~84-96 ms of beat-to-beat scatter and could not say whether
   it is cardiac or vascular/detector. This decides it — if the scatter is PEP, an arm→finger
   measurement collapses it; if it does not move, the looseness is downstream of the heart and dual-site
   PTT will not rescue PAT either. Either result is informative, which is the point.
   `INTEGRATOR-PAT-VASCULAR` §4 proposes the DIFFERENCED form (one R → two feet) as Phase 2; it was
   parked behind a NO-GO Phase 0 and never measured. This is the direct form, which needs no ECG and
   therefore takes the H10 out of the timing chain entirely.
   ⚠ Arm→finger transit is TENS of ms, far below PHYS_LO=200, so the un-scanned δ=0 score is meaningless
   for this pairing — run it with --scan, which is free to carry the lag into the window. The scatter
   statistic is an IQR about the MODAL lag and is unaffected by that shift. */
const REF_MODE = arg('ref', 'ecg');
/* Anchors are sampled, not taken per row: a 9 h ECG is ~4 M rows and `hostAxis`'s running median is
   O(n·win). One anchor per ANCHOR_STEP rows is ~0.5 s at 130 Hz, far denser than the ~1 s wander the
   correction describes, and the median needs density only relative to that. */
const ANCHOR_STEP = 60;

let ECGDSP, PPGDSP, DexClock;
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
  for (const f of ['clock.js', 'kernel-constants.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js']) {
    const p = join(ROOT, f);
    if (!existsSync(p)) throw new Error('module not found: ' + f);
    vm.runInContext(DexBuild.classicify(readFileSync(p, 'utf8')), ctx, { filename: f });
  }
  ECGDSP = ctx.ECGDSP || (ctx.ECGDex && ctx.ECGDex._bare);
  PPGDSP = ctx.PPGDSP || (ctx.PpgDex && ctx.PpgDex._bare);
  DexClock = ctx.DexClock;
  for (const [n, v] of Object.entries({ ECGDSP, PPGDSP, DexClock })) if (!v) throw new Error('pat-host-offset: ' + n + ' did not load into the headless realm');
}

/* ── the {devMs, hostMs} anchors, read off the SAME row ───────────────────────────────────────────
   This is the whole point of the tool, so it reads the columns directly rather than through a parser
   that discards one of them. `sensor timestamp [ns]` is the device counter; `Phone timestamp` is the
   one host clock both devices are stamped by on a box capture. */
function hostAnchors(path) {
  const txt = readFileSync(path, 'utf8');
  const nl = txt.indexOf('\n');
  const hdr = txt.slice(0, nl).trim().split(';');
  const ci = hdr.indexOf('sensor timestamp [ns]');
  if (ci < 0) return { ok: false, reason: 'no `sensor timestamp [ns]` column — not a PSL-layout capture' };
  const out = [];
  let i = nl + 1,
    row = 0;
  while (i < txt.length) {
    const e = txt.indexOf('\n', i);
    const end = e < 0 ? txt.length : e;
    if (row++ % ANCHOR_STEP === 0) {
      const line = txt.slice(i, end);
      const p = line.split(';');
      if (p.length > ci) {
        const stamp = DexClock.parseTimestamp(p[0]);
        const dev = Number(p[ci]);
        if (stamp && isFinite(dev)) out.push({ devMs: dev / 1e6, hostMs: stamp.tMs });
      }
    }
    if (e < 0) break;
    i = e + 1;
  }
  return out.length >= 3 ? { ok: true, anchors: out } : { ok: false, reason: 'only ' + out.length + ' anchors' };
}

/* Put a stream's drawn axis (`t0Ms + idx/fs`, which rides the DEVICE rate) onto the host axis.
   The correction is taken RELATIVE TO THE FIRST ANCHOR because `t0Ms` already anchors the start —
   adding the absolute correction would double-count it, the same trap clock.js §7 documents. */
function hostCorrector(axis, devStartMs) {
  const c0 = axis.correctionAt(devStartMs);
  return (devMs) => axis.correctionAt(devMs) - c0;
}

function ecgBeats(text) {
  const rec = ECGDSP.parseECG(text);
  if (rec.t0Ms == null) throw new Error('ECG file carried no phone timestamp.');
  const bp = ECGDSP.bandpass(rec.int16, rec.fs);
  const peaks = ECGDSP.detectPeaks(rec.int16, bp, rec.fs);
  return { t0Ms: rec.t0Ms, fs: rec.fs, durSec: rec.durSec, idx: peaks };
}
function ppgFeet(text) {
  const rec = PPGDSP.parsePPG(text);
  if (rec.t0Ms == null) throw new Error('PPG file carried no phone timestamp.');
  const per = rec.ch.map((c) => PPGDSP.detectChannel(c, rec.fs));
  let refIdx = 0,
    best = -1;
  per.forEach((p, i) => {
    if (p.peaks.length > best) {
      best = p.peaks.length;
      refIdx = i;
    }
  });
  const cons = PPGDSP.consensusBeats(per, refIdx, rec.fs);
  const pts = TIMING_POINT === 'peak' ? cons.peaks : cons.feet;
  if (!pts) throw new Error('consensusBeats exposed no `' + TIMING_POINT + '` series');
  return { t0Ms: rec.t0Ms, fs: rec.fs, durSec: rec.durSec, idx: pts };
}
/* idx -> host-axis ms. `idx/fs` IS the device's own clock by construction (that is what makes the
   axis drawn), so it is also the right argument to `correctionAt`. */
function toHostAxis(rec, corr, devStartMs) {
  const t = new Float64Array(rec.idx.length);
  for (let i = 0; i < rec.idx.length; i++) {
    const rel = (rec.idx[i] / rec.fs) * 1000;
    t[i] = rec.t0Ms + rel + corr(devStartMs + rel);
  }
  return t;
}

function biggest(dir, re, n) {
  return readdirSync(dir)
    .filter((f) => re.test(f))
    .map((f) => ({ f: join(dir, f), size: statSync(join(dir, f)).size }))
    .sort((a, b) => b.size - a.size)
    .slice(0, n);
}

/* A window that produced (almost) no stage-one lags is NOT a measurement of weak coupling — it is a
   measurement of nothing, and it must be refused rather than scored. Found in the first corpus run:
   `strictMatchRate` returns `matchRate: NaN` on an empty lag list, and a permutation p of
   `count(surrogate >= NaN) + 1` over `n+1` is then (0+1)/41 = **0.024** — so a window with no data
   reported as SIGNIFICANT, twice in 60. That is the family this whole brief keeps finding: a check
   that reports success about something it never examined. `null` here becomes a loud refusal. */
const MIN_LAGS = 50;

/* ── OFFSET SCAN — attributing §3f's intermittency ────────────────────────────────────────────────
   §3f found strict coupling on 20/57 windows and a MEDIAN window at exactly its chance floor. Two
   explanations predict that shape and §3f.4 could not separate them: the physiology genuinely comes
   and goes, or the residual inter-device offset wanders in and out of the `[200,650]` ms acceptance
   window. This asks the question that separates them: **is there ANY constant offset at which this
   window couples?**

   The statistic is `max over δ` — which is a selection, so THE NULL IS MAXED THE SAME WAY. Each
   circular-shift surrogate is scanned over the identical δ grid and its own maximum taken, so
   whatever advantage scanning grants the observation it grants the null identically. That is the same
   discipline `pat-matchrate-strict`'s surrogate already applies to alignment, one level up.

   `bestOffsetMs` is the other half and is free: a δ that is STABLE across a night's windows while the
   score varies says the offset was fine and the coupling moved; a δ that jumps says the offset moved. */
function scanOffsets(rT, fT, nSurr, loMs, hiMs, stepMs) {
  const best = (feet) => {
    let bs = -Infinity,
      bd = NaN,
      bq = NaN;
    for (let d = loMs; d <= hiMs; d += stepMs) {
      const sh = new Float64Array(feet.length);
      for (let i = 0; i < feet.length; i++) sh[i] = feet[i] + d;
      const l = rawLags(rT, sh);
      if (l.length < MIN_LAGS) continue;
      const r = strictMatchRate(l, rT.length);
      const m = r.matchRate;
      if (isFinite(m) && m > bs) {
        bs = m;
        bd = d;
        bq = r.residIQR;
      }
    }
    return { score: bs, offset: bd, residIQR: bq };
  };
  const obs = best(fT);
  if (!isFinite(obs.score)) return { refused: 'no offset in the scan produced enough lags' };
  /* ⚠ `strictMatchRate.residIQR` MUST NOT BE COMPARED TO pat-gate.js's 60 ms BAR. It is the IQR of the
     residuals of the beats strict ACCEPTED, and acceptance is |d0| <= STRICT_W_MS (40 ms) — so it is
     bounded by its own window and reads 31-44 ms on this corpus no matter what the signal does. Read
     as a gate result it says 52/52 windows pass, which is a tautology, not a measurement. (Found while
     trying to reproduce INTEGRATOR-PAT-VASCULAR §2-RESULT-II.3's ~96 ms and getting 38 ms.)
     The gate-comparable quantity is the one that brief measures: the IQR of (lag - modal lag) over the
     beats within a WIDE band of the modal lag, which is free to exceed the bar. Computed here so the
     two harnesses can agree or disagree instead of talking past each other. */
  const SCATTER_BAND_MS = 100; // theirs, so the numbers are comparable
  const lags = rawLags(rT, Float64Array.from(Array.from(fT).map((t) => t + obs.offset))).map((e) => e.lag);
  let scatterIQR = NaN;
  if (lags.length >= MIN_LAGS) {
    const so = [...lags].sort((a, b) => a - b);
    const modal = so[so.length >> 1];
    const near = lags
      .filter((l) => Math.abs(l - modal) <= SCATTER_BAND_MS)
      .map((l) => l - modal)
      .sort((a, b) => a - b);
    if (near.length >= 20) scatterIQR = near[Math.floor(near.length * 0.75)] - near[Math.floor(near.length * 0.25)];
  }
  /* ⚠ A beat train is PERIODIC, so matching it pins an offset only MOD ONE RR INTERVAL — δ and
     δ ± RR are indistinguishable by construction. `bestOffsetMs` alone therefore looks like it
     "jumps" between windows when it may only be aliasing. The identifiable quantity is δ mod RR,
     and the median RR is published beside it so the reduction is checkable rather than assumed.

     ⚠ AND IT IS WEAKER STILL: any δ that keeps the lag inside [PHYS_LO, PHYS_HI] scores IDENTICALLY,
     so the argmax sits on a PLATEAU as wide as that acceptance window (450 ms), not at a point. Found
     by a gate assertion that expected ~0 on planted data and got -200 — the code being right. So
     `bestOffsetMs` bounds the offset to a 450 ms band mod RR; it does not estimate it, and two windows
     differing by less than that band are NOT evidence the offset moved. */
  const rr = [];
  for (let i = 1; i < rT.length; i++) rr.push(rT[i] - rT[i - 1]);
  rr.sort((a, b) => a - b);
  const medRR = rr.length ? rr[rr.length >> 1] : NaN;
  const modRR = isFinite(medRR) && medRR > 0 ? ((obs.offset % medRR) + medRR) % medRR : NaN;
  const span = fT[fT.length - 1] - fT[0];
  const sur = [];
  for (let s = 0; s < nSurr; s++) sur.push(best(circShift(fT, span, (s + 1) / (nSurr + 1))).score);
  const ok = sur.filter(isFinite);
  return {
    bestScore: obs.score,
    bestOffsetMs: obs.offset,
    /* THE BINDING METRIC, and this tool did not report it until 2026-08-04. The scan maximises a COUNT
       (matchRate); `pat-gate.js` gates on a DISPERSION (residIQR <= 60 ms). A free offset can raise the
       count without tightening the scatter, so a high scan score says nothing about whether PAT is
       measurable. INTEGRATOR-PAT-VASCULAR §2-RESULT-II.3 measured residIQR ~96 ms offset-free across 54
       pairings and concluded the limit is beat-to-beat scatter, not the offset — reporting it here is
       what lets this harness agree or disagree with that instead of talking past it. */
    residIQRms: obs.residIQR,
    scatterIQRms: scatterIQR,
    medRRms: medRR,
    bestOffsetModRR: modRR,
    scanChance: ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : NaN,
    scanP: ok.length ? (ok.filter((x) => x >= obs.score).length + 1) / (ok.length + 1) : NaN
  };
}

function scoreWindow(rT, fT, nSurr) {
  const lag = rawLags(rT, fT);
  if (lag.length < MIN_LAGS) return { refused: `only ${lag.length} stage-one lag(s) in the window (< ${MIN_LAGS})` };
  const lg = legacyMatchRate(lag, rT.length);
  const st = strictMatchRate(lag, rT.length);
  if (!isFinite(lg.matchRate) || !isFinite(st.matchRate)) return { refused: 'matchRate is not finite — refusing rather than scoring' };
  const lgS = [],
    stS = [];
  const span = fT[fT.length - 1] - fT[0];
  for (let s = 0; s < nSurr; s++) {
    // fractions spread over (0,1) — a shift of ≫ one RR destroys the R↔foot phase and keeps the
    // train's own rate, regularity and dropouts (the surrogate contract in pat-matchrate-strict).
    const sh = circShift(fT, span, (s + 1) / (nSurr + 1));
    const l2 = rawLags(rT, sh);
    lgS.push(legacyMatchRate(l2, rT.length).matchRate);
    stS.push(strictMatchRate(l2, rT.length).matchRate);
  }
  const mean = (a) => a.filter(isFinite).reduce((x, y) => x + y, 0) / (a.filter(isFinite).length || 1);
  // NaN-safe by construction: a non-finite observation cannot be compared, so it is refused above
  // rather than silently scoring (0+1)/(n+1) — see MIN_LAGS. Surrogates are filtered for the same reason.
  const pOf = (obs, sur) => {
    const s = sur.filter(isFinite);
    return isFinite(obs) && s.length ? (s.filter((x) => x >= obs).length + 1) / (s.length + 1) : NaN;
  };
  return {
    n: rT.length,
    legacy: lg.matchRate,
    legacyChance: mean(lgS),
    legacyP: pOf(lg.matchRate, lgS),
    strict: st.matchRate,
    strictChance: mean(stS),
    strictP: pOf(st.matchRate, stS)
  };
}

export { hostAnchors, hostCorrector, toHostAxis, scoreWindow, scanOffsets };

const IS_CLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (IS_CLI) {
  const base = DIR.startsWith('/') ? DIR : join(ROOT, DIR);
  if (!existsSync(base)) {
    console.error(`pat-host-offset: ${DIR} not found. The raw corpus is gitignored — pass --dir.`);
    process.exit(2);
  }
  loadDsps();
  const nights = readdirSync(base)
    .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n) && statSync(join(base, n)).isDirectory())
    .filter((n) => !ONLY || n === ONLY)
    .sort();
  const rows = [],
    refusals = [];
  for (const night of nights) {
    const dir = join(base, night);
    let E = [],
      P = [];
    try {
      if (REF_MODE === 'ppg-ppg') {
        E = biggest(dir, /verity.*_PPG\.txt$/i, CANDIDATES); // reference = ARM foot train
        P = biggest(dir, /Wellue.*_PPG\.txt$/i, CANDIDATES); // target    = FINGER foot train
      } else {
        E = biggest(dir, /_ECG\.txt$/i, CANDIDATES);
        let pp = biggest(dir, /verity.*_PPG\.txt$/i, CANDIDATES);
        if (!pp.length) pp = biggest(dir, /_PPG\.txt$/i, CANDIDATES);
        P = pp;
      }
    } catch {
      continue;
    }
    for (const ef of E)
      for (const pf of P) {
        let er, pr, ea, pa;
        try {
          er = REF_MODE === 'ppg-ppg' ? ppgFeet(readFileSync(ef.f, 'utf8')) : ecgBeats(readFileSync(ef.f, 'utf8'));
          pr = ppgFeet(readFileSync(pf.f, 'utf8'));
        } catch (e) {
          // Reported, not swallowed — see the header. A `continue` here would let a detector failure
          // shrink the scored set silently, which reads as "these windows had no coupling".
          refusals.push(`${night}: parse/detect — ${String((e && e.message) || e)}`);
          continue;
        }
        const lo = Math.max(er.t0Ms, pr.t0Ms);
        const hi = Math.min(er.t0Ms + er.durSec * 1000, pr.t0Ms + pr.durSec * 1000);
        if (hi - lo < WINDOW_MIN * 60000) continue;
        ea = hostAnchors(ef.f);
        pa = hostAnchors(pf.f);
        if (!ea.ok || !pa.ok) {
          refusals.push(`${night}: anchors — ${!ea.ok ? 'ECG ' + ea.reason : 'PPG ' + pa.reason}`);
          continue;
        }
        const ax = DexClock.hostAxis(ea.anchors),
          px = DexClock.hostAxis(pa.anchors);
        if (!ax.ok || !px.ok) {
          refusals.push(`${night}: hostAxis refused — ${!ax.ok ? 'ECG ' + ax.reason : 'PPG ' + px.reason}`);
          continue;
        }
        if (!ax.independent || !px.independent) {
          refusals.push(`${night}: NOT INDEPENDENT — ${!ax.independent ? 'ECG ' + ax.inertReason : 'PPG ' + px.inertReason}`);
          continue;
        }
        /* AND THE DEVICE COLUMN MUST BE A CLOCK, which `independent` cannot tell you — it compares two
           COLUMNS, so a counter synthesised as `index × an assumed rate` reads MORE independent the
           coarser its quantisation. The target here is the Wellue finger PPG (line 371), and that is
           precisely the drawn-axis device: 20 of 20 O2Ring streams in the corpus are flagged, against
           0 of 6 for H10 ECG and 0 of 19 for Verity PPG. One real segment (2026-08-13, 1.72 h) reports
           −22.83 ppm at a 99.3 % drawn-delta share — a plausible-looking crystal from a stream with no
           oscillator — so the magnitude cannot be the discriminator either. `hostAxis` publishes
           `deviceDrawn`; refuse on it, because `toHostAxis` below would otherwise place beats on a
           fabricated timebase and the offset it yields would be an artefact of the assumed rate. */
        if (ax.deviceDrawn === true || px.deviceDrawn === true) {
          const which = ax.deviceDrawn === true ? { tag: 'ECG', r: ax } : { tag: 'PPG', r: px };
          refusals.push(`${night}: DRAWN AXIS — ${which.tag} ${which.r.drawnReason || 'device column is a synthesised counter, not a clock'}`);
          continue;
        }
        const eT = toHostAxis(er, hostCorrector(ax, ea.anchors[0].devMs), ea.anchors[0].devMs);
        const fT = toHostAxis(pr, hostCorrector(px, pa.anchors[0].devMs), pa.anchors[0].devMs);
        for (let w = lo; w + WINDOW_MIN * 60000 <= hi; w += WINDOW_MIN * 60000) {
          const w1 = w + WINDOW_MIN * 60000;
          const rW = Float64Array.from(Array.from(eT).filter((t) => t >= w && t < w1));
          const fW = Float64Array.from(Array.from(fT).filter((t) => t >= w - 1000 && t < w1 + 1000));
          const win = Math.round((w - lo) / 60000);
          if (rW.length < 300 || fW.length < 200) {
            refusals.push(`${night} win${win}: too few beats/feet in the window (R=${rW.length}, feet=${fW.length})`);
            continue;
          }
          const sc = scoreWindow(rW, fW, N_SURR);
          if (sc.refused) {
            refusals.push(`${night} win${win}: ${sc.refused}`);
            continue;
          }
          const extra = SCAN ? scanOffsets(rW, fW, SCAN_SURR, SCAN_LO, SCAN_HI, SCAN_STEP) : {};
          if (extra.refused) refusals.push(`${night} win${win}: scan — ${extra.refused}`);
          /* `maxStepMs` rides alongside `ppm` because they answer DIFFERENT questions and §3f.5
             eliminated only the one `ppm` asks. A ppm is a RATE, and integrating it over a window
             predicts a smooth accumulation — which is why §3f.5 could show differential drift is ~6x
             too small to cross the ~450 ms identifiability band. `maxStepMs` is the other shape: a
             genuine clock STEP smeared across one anchor gap, which a single ppm renders as a gentle
             slope and therefore hides. CLAUDE.md §7 records the O2Ring doing exactly that — sub-ppm
             for hours, then ~12.5 s/h from the first BLE dropout. Emitting it costs nothing (hostAxis
             already computes it) and it is the only field that can test the stalled-link candidate. */
          rows.push({
            night,
            win,
            ppmE: ax.ppm,
            ppmP: px.ppm,
            maxStepE: ax.maxStepMs,
            maxStepP: px.maxStepMs,
            ...sc,
            ...(extra.refused ? {} : extra)
          });
        }
      }
  }
  if (JSON_OUT) {
    console.log(JSON.stringify({ windowMin: WINDOW_MIN, surrogates: N_SURR, rows, refusals }, null, 2));
  } else {
    console.log(`\nPAT under a hostAxis-READ inter-device offset (PAT-UNDER-PERBLOCK-ALIGNMENT §3e.4)`);
    console.log(`windows ${WINDOW_MIN} min · ${N_SURR} surrogates · ref: ${REF_MODE} · PPG timing point: ${TIMING_POINT} · every pair and window scored, none selected\n`);
    console.log(
      SCAN ? 'night        win  beats |  strict  chance     p  |  BEST  chance     p  bestOff modRR    RR resIQR scatIQR' : 'night        win  beats |  legacy  chance     p  |  strict  chance     p'
    );
    console.log('─'.repeat(SCAN ? 82 : 74));
    const f = (x) => (x == null || !isFinite(x) ? '  —  ' : (x * 100).toFixed(0).padStart(4) + '%');
    for (const r of rows)
      console.log(
        SCAN
          ? `${r.night} ${String(r.win).padStart(4)} ${String(r.n).padStart(6)} | ${f(r.strict)} ${f(r.strictChance)} ${r.strictP.toFixed(3).padStart(6)} | ${f(r.bestScore)} ${f(r.scanChance)} ${(isFinite(r.scanP) ? r.scanP.toFixed(3) : '  —  ').padStart(6)} ${(isFinite(r.bestOffsetMs) ? r.bestOffsetMs + '' : '—').padStart(6)} ${(isFinite(r.bestOffsetModRR) ? Math.round(r.bestOffsetModRR) + '' : '—').padStart(6)} ${(isFinite(r.medRRms) ? Math.round(r.medRRms) + '' : '—').padStart(5)} ${(isFinite(r.residIQRms) ? Math.round(r.residIQRms) + '' : '—').padStart(6)} ${(isFinite(r.scatterIQRms) ? Math.round(r.scatterIQRms) + '' : '—').padStart(7)}`
          : `${r.night} ${String(r.win).padStart(4)} ${String(r.n).padStart(6)} | ${f(r.legacy)} ${f(r.legacyChance)} ${r.legacyP.toFixed(3).padStart(6)} | ${f(r.strict)} ${f(r.strictChance)} ${r.strictP.toFixed(3).padStart(6)}`
      );
    console.log('─'.repeat(74));
    if (rows.length) {
      const mean = (s) => (rows.map(s).reduce((a, b) => a + b, 0) / rows.length) * 100;
      const sig = rows.filter((r) => r.strictP < 0.05).length;
      console.log(
        `${rows.length} window(s)   mean legacy ${mean((r) => r.legacy).toFixed(0)}% (chance ${mean((r) => r.legacyChance).toFixed(0)}%)   mean strict ${mean((r) => r.strict).toFixed(0)}% (chance ${mean((r) => r.strictChance).toFixed(0)}%)`
      );
      console.log(`strict beats its own null at p<0.05 on ${sig}/${rows.length} window(s)`);
    } else console.log('no window scored.');
    for (const r of refusals) console.log(`⊘ ${r}`);
  }
}
