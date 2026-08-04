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
  return { t0Ms: rec.t0Ms, fs: rec.fs, durSec: rec.durSec, idx: cons.feet };
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
      bd = NaN;
    for (let d = loMs; d <= hiMs; d += stepMs) {
      const sh = new Float64Array(feet.length);
      for (let i = 0; i < feet.length; i++) sh[i] = feet[i] + d;
      const l = rawLags(rT, sh);
      if (l.length < MIN_LAGS) continue;
      const m = strictMatchRate(l, rT.length).matchRate;
      if (isFinite(m) && m > bs) {
        bs = m;
        bd = d;
      }
    }
    return { score: bs, offset: bd };
  };
  const obs = best(fT);
  if (!isFinite(obs.score)) return { refused: 'no offset in the scan produced enough lags' };
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
      E = biggest(dir, /_ECG\.txt$/i, CANDIDATES);
      let pp = biggest(dir, /verity.*_PPG\.txt$/i, CANDIDATES);
      if (!pp.length) pp = biggest(dir, /_PPG\.txt$/i, CANDIDATES);
      P = pp;
    } catch {
      continue;
    }
    for (const ef of E)
      for (const pf of P) {
        let er, pr, ea, pa;
        try {
          er = ecgBeats(readFileSync(ef.f, 'utf8'));
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
          rows.push({ night, win, ppmE: ax.ppm, ppmP: px.ppm, ...sc, ...(extra.refused ? {} : extra) });
        }
      }
  }
  if (JSON_OUT) {
    console.log(JSON.stringify({ windowMin: WINDOW_MIN, surrogates: N_SURR, rows, refusals }, null, 2));
  } else {
    console.log(`\nPAT under a hostAxis-READ inter-device offset (PAT-UNDER-PERBLOCK-ALIGNMENT §3e.4)`);
    console.log(`windows ${WINDOW_MIN} min · ${N_SURR} surrogates · every pair and window scored, none selected\n`);
    console.log(SCAN ? 'night        win  beats |  strict  chance     p  |  BEST  chance     p  bestOff modRR    RR' : 'night        win  beats |  legacy  chance     p  |  strict  chance     p');
    console.log('─'.repeat(SCAN ? 82 : 74));
    const f = (x) => (x == null || !isFinite(x) ? '  —  ' : (x * 100).toFixed(0).padStart(4) + '%');
    for (const r of rows)
      console.log(
        SCAN
          ? `${r.night} ${String(r.win).padStart(4)} ${String(r.n).padStart(6)} | ${f(r.strict)} ${f(r.strictChance)} ${r.strictP.toFixed(3).padStart(6)} | ${f(r.bestScore)} ${f(r.scanChance)} ${(isFinite(r.scanP) ? r.scanP.toFixed(3) : '  —  ').padStart(6)} ${(isFinite(r.bestOffsetMs) ? r.bestOffsetMs + '' : '—').padStart(6)} ${(isFinite(r.bestOffsetModRR) ? Math.round(r.bestOffsetModRR) + '' : '—').padStart(6)} ${(isFinite(r.medRRms) ? Math.round(r.medRRms) + '' : '—').padStart(5)}`
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
