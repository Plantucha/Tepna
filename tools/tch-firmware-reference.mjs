#!/usr/bin/env node
/*
 * tools/tch-firmware-reference.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE HR THREE-CORNERED HAT, CHECKED AGAINST A REFERENCE IT DOES NOT CONTAIN — every night, as a verdict.
 *
 * sensor-trio-night.html splits the HR disagreement of H10 · Verity · O2Ring into one σ per device with a
 * three-cornered hat. The hat cannot check itself, and `tools/r5-hr-reference.mjs` proves why a corner
 * cannot check it either: measured against one of its own corners, the comparison is an identity.
 *
 * THE REFERENCE is a FOURTH series: the beat intervals on which TWO INDEPENDENT R-PEAK DETECTORS agree —
 * ECGDex Pan–Tompkins on the raw `_ECG.txt`, and the strap FIRMWARE's own detector (`_RR.txt`), time-paired
 * window by window with `tools/oracle-ecg-firmware-rr.mjs`'s own functions (firmwareHostTimes →
 * per-window coincidenceLag → pairByTime) and kept only where the two intervals agree within
 * AGREE_MS (one 130 Hz sample is 7.7 ms). Per second: the median HR of those consensus intervals.
 *
 * THE CORNERS are built exactly as the page builds them, by the page's own worker functions: H10 from
 * `ecgHrMap` (Pan–Tompkins on the raw ECG), Verity from `ppgHrMapReal`, O2Ring from `o2MarkerHrMap` (its
 * `156` beat markers) with the page's fallbacks. For each: TRUE σ = SD(corner − reference), BIAS = mean,
 * and the error correlations ρ between corners, all on the seconds where the reference and all three
 * corners exist.
 *
 * JUDGED: the Verity and O2Ring corners. The H10 corner is REPORTED, NEVER JUDGED — the reference is
 * built from its own detections, so its measured error is a lower bound on a quantity the reference
 * cannot see (r5's rule, one step removed).
 *
 * TWO ESTIMATORS, ONE BAND (pre-stated 2026-09-26, before the first run):
 *   a corner PASSES when |σ_est − σ_true| ≤ BAND_ABS bpm OR ≤ BAND_REL × σ_true;
 *   an estimator is PASS when ≥ PASS_FRAC of the judged night-corners pass; UNDERPOWERED below MIN_NIGHTS.
 *   - classic hat (ρ = 0) — what sensor-trio-night shows today. THIS IS THE VERDICT'S STATUS.
 *   - correlated hat — `AnalysisStats.tchSigmasPairwiseFromVars` with the three error correlations
 *     MEASURED AGAINST THE REFERENCE, taken LEAVE-ONE-OUT (median over the OTHER nights). Never the
 *     night's own ρ: TCH-CORRELATED-SOLVE-KNIFE-EDGE §5 proves a ρ measured on the same data is the ρ at
 *     which a corner's σ collapses, and this reference shares the H10's beats. Reported beside the classic
 *     verdict as `result.correlated`; it becomes the page's estimator only if it passes the same band.
 *
 * MEASURED 2026-09-26 (Wren, rig, 37 box nights): classic hat 53/74 = 72 % — FAIL. Verity σ̂ 0.41 against a
 * true 0.73 bpm (hat below true on 32/36), O2Ring 1.46 vs 1.71 (all 37 within the band), H10 0.97 vs a
 * measured 0.81. Optical error correlation ρ(V,O) median 0.32, and bias ≤ 0.04 bpm on every corner. The
 * correlated hat with leave-one-out ρ moved every corner toward truth (Verity 0.61, H10 0.85) but
 * refused 10/36 nights and passed 60 % — also FAIL. WHY, and it is a property of the data, not a tuning
 * miss: the small optical corner is NOT IDENTIFIABLE when ρ(V,O) approaches σ_V/σ_O, because
 * ∂var(V−O)/∂σ_V = 2(σ_V − ρσ_O) → 0 and the difference variances stop depending on σ_V. These nights sit
 * there — ρ ≈ 0.32 against σ_V/σ_O ≈ 0.73/1.71 = 0.43 — so no ρ, measured or guessed, separates the two
 * optical corners reliably from pairwise differences alone. The reference-measured σ does not need to:
 * on a night with firmware RR it IS the answer, and this tool publishes it.
 *
 * NIGHTLY: `--ledger <file.jsonl>` keeps one row per scored night (append-only, outside the repo — these
 * are numbers about a person's nights) and a run scores only the nights the ledger lacks, then pools ALL
 * rows for the verdict. The corpus stays where it is; nothing here is committed data.
 *
 * THREE POPULATIONS, ONE VERDICT EACH (TCH-REFERENCE-POPULATIONS §3): all eligible nights (the headline),
 * the rolling last 30 (a trend, never the headline), and the solid stratum — the nights whose own
 * `SOLID-VERDICT.json` reads PASS, read from the captures tree read-only. A night with no verdict file is
 * OUTSIDE the stratum, not a failed night.
 *
 * `--axis host|wall` IS THE PAIRED COMPARISON, and `host` is what the tool has always done: every corner
 * already rides the host-disciplined axis through its own DSP (`tMsAt` → `correctionAt`, `relSec`), so
 * `wall` is the counterfactual that makes `DexClock.hostAxis` refuse and leaves each device on its raw
 * counter. See `axisPatch` for the measurement behind that sentence. A LEDGER ROW IS KEYED BY NIGHT AND
 * AXIS, so a wall row can never satisfy a host run.
 *
 *   node tools/tch-firmware-reference.mjs --selftest
 *   node tools/tch-firmware-reference.mjs --verdict-sample            # corpus-free shape the adoption gate reads
 *   node tools/tch-firmware-reference.mjs --dir <captures root> [--night 2026-09-25]… [--ledger f.jsonl] [--json]
 *   node tools/tch-firmware-reference.mjs --dir <root> --axis wall --ledger wall.jsonl --json
 *   node tools/tch-firmware-reference.mjs --dir <root> --solid auto | --solid <file|2026-09-28,2026-09-30>
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { coincidenceLag, firmwareHostTimes, pairByTime } from './oracle-ecg-firmware-rr.mjs';
import { isCliEntry } from './argv-guard.mjs';
import { intersectSnapshots, populationVerdict, snapshotNights } from './corpus-scope.mjs';
import { printVerdict } from './verdict-emit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const req = createRequire(import.meta.url);
const AS = req(path.join(ROOT, 'analysis-stats.js'));

export const AGREE_MS = 8;
export const BAND_ABS = 0.3;
export const BAND_REL = 0.3;
export const PASS_FRAC = 0.8;
export const MIN_NIGHTS = 10;
export const MIN_SECONDS = 1000;
const KEYS = ['h10', 'verity', 'o2'];
const JUDGED = ['verity', 'o2'];

/* ── pure core ─────────────────────────────────────────────────────────────────────────────────── */
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
};
export function median(a) {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function corr(x, y) {
  const mx = mean(x),
    my = mean(y);
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
export function withinBand(est, truth) {
  return Number.isFinite(est) && Number.isFinite(truth) && (Math.abs(est - truth) <= BAND_ABS || Math.abs(est - truth) <= BAND_REL * truth);
}
/* Consensus reference: pairs of consecutive self↔firmware matches whose intervals agree within AGREE_MS.
   selfMs/selfNN: our beat times (wall-clock ms on the ECG record's own axis — see the dated note at
   the call site, which measures why that is NOT `tMsAt`'s axis) and the NN interval ending at each;
   fwMs/fwRR: firmware beat times carried onto the same axis by the coincidence lag, and its
   intervals. Returns [[sec, hr], …]. */
export function consensusPairs(selfMs, selfNN, fwMs, fwRR, tolMs = 150) {
  const P = pairByTime(selfMs, fwMs, tolMs).pairs,
    out = [];
  let consecutive = 0;
  for (let k = 1; k < P.length; k++) {
    const [i, j] = P[k],
      [i0, j0] = P[k - 1];
    if (!(i === i0 + 1 && j === j0 + 1)) continue;
    consecutive++;
    if (Math.abs(selfNN[i] - fwRR[j]) <= AGREE_MS) out.push([Math.floor(selfMs[i] / 1000), 60000 / ((selfNN[i] + fwRR[j]) / 2)]);
  }
  return { pairs: out, consecutive };
}
export function perSecondMedian(pairs) {
  const by = new Map();
  for (const [s, v] of pairs) (by.get(s) || by.set(s, []).get(s)).push(v);
  const out = new Map();
  for (const [s, a] of by) out.set(s, median(a));
  return out;
}
/* One night's numbers from four aligned per-second maps (reference + three corners). */
export function scoreSeries(REF, H, V, O) {
  const ks = [...REF.keys()].filter((s) => H.has(s) && V.has(s) && O.has(s)).sort((a, b) => a - b);
  if (ks.length < MIN_SECONDS) return { ok: false, reason: ks.length + ' s with the reference and all three corners (< ' + MIN_SECONDS + ')', n: ks.length };
  const g = (M) => ks.map((s) => M.get(s)),
    ref = g(REF),
    X = { h10: g(H), verity: g(V), o2: g(O) },
    E = {},
    trueSd = {},
    bias = {};
  for (const k of KEYS) {
    E[k] = X[k].map((x, i) => x - ref[i]);
    trueSd[k] = sd(E[k]);
    bias[k] = mean(E[k]);
  }
  const diffVar = (a, b) => AS.variance(X[a].map((x, i) => x - X[b][i]));
  const vHV = diffVar('h10', 'verity'),
    vHO = diffVar('h10', 'o2'),
    vVO = diffVar('verity', 'o2');
  const c = AS.threeCorneredHat(vHV, vHO, vVO);
  const hat = { h10: c.a >= 0 ? Math.sqrt(c.a) : null, verity: c.b >= 0 ? Math.sqrt(c.b) : null, o2: c.c >= 0 ? Math.sqrt(c.c) : null };
  const rho = { hv: corr(E.h10, E.verity), ho: corr(E.h10, E.o2), vo: corr(E.verity, E.o2) };
  return { ok: true, n: ks.length, trueSd, bias, hat, rho, vars: { hv: vHV, ho: vHO, vo: vVO } };
}
/* Correlated hat for ONE night with ρ taken from the OTHER nights (leave-one-out). */
export function correlatedLOO(rows, idx) {
  const others = rows.filter((r, i) => i !== idx && r.ok);
  if (others.length < 3) return { ok: false, reason: 'fewer than 3 other nights to take ρ from' };
  const rho = { ab: median(others.map((r) => r.rho.hv)), ac: median(others.map((r) => r.rho.ho)), bc: median(others.map((r) => r.rho.vo)) };
  const v = rows[idx].vars,
    s = AS.tchSigmasPairwiseFromVars(v.hv, v.ho, v.vo, rho);
  if (!s || !s.ok) return { ok: false, reason: (s && s.reason) || 'correlated solve refused', rho };
  return { ok: true, rho, sigma: { h10: s.a, verity: s.b, o2: s.c } };
}
function judge(rows, pick) {
  let pass = 0,
    total = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.ok) continue;
    const est = pick(r, i);
    for (const k of JUDGED) {
      total++;
      if (est && withinBand(est[k], r.trueSd[k])) pass++;
    }
  }
  return { pass, total, frac: total ? pass / total : null };
}
export function pool(rows) {
  const ok = rows.filter((r) => r.ok);
  const classic = judge(rows, (r) => r.hat);
  const corrRes = rows.map((r, i) => (r.ok ? correlatedLOO(rows, i) : null));
  const correlated = judge(rows, (r, i) => (corrRes[i] && corrRes[i].ok ? corrRes[i].sigma : null));
  const med = (f) => median(ok.map(f));
  const out = { nights: ok.length, classic, correlated: { ...correlated, refused: corrRes.filter((c) => c && !c.ok).length }, medians: {} };
  for (const k of KEYS)
    out.medians[k] = {
      trueSd: med((r) => r.trueSd[k]),
      bias: med((r) => r.bias[k]),
      classic: med((r) => r.hat[k]),
      correlated: median(corrRes.filter((c) => c && c.ok).map((c) => c.sigma[k]))
    };
  out.medians.rho = { hv: med((r) => r.rho.hv), ho: med((r) => r.rho.ho), vo: med((r) => r.rho.vo) };
  return out;
}
/* ── the axis switch and the three populations (TCH-REFERENCE-POPULATIONS §5.1) ─────────────────── */
export const AXES = ['host', 'wall'];
/* ── THE REFERENCE'S OWN AXIS (residue 2026-10-18-tch-reference-and-h10-corner-sit-on-two-axes) ──
   `--axis` decides whether the host discipline runs at all. It does NOT decide which of the two
   timebases the REFERENCE is built on, and until this option existed the answer was fixed: the
   reference rode the raw device counter (`analyze`'s `r.tt`, `ecgdex-dsp.js:2802-2812`) while the
   H10 corner rode the corrected one (`rec.tMsAt`, `ecgdex-dsp.js:5610`). Under `--axis host` the
   H10 was therefore scored against a reference derived from its own beats on a DIFFERENT axis, and
   the divergence between the two is the host discipline's own correction.

   `--reference-axis device` is that status quo and stays the default, so no shipped number moves.
   `--reference-axis corrected` places the reference on the corner's axis by reading the record's own
   accessor at the beat's sample index — `rec.tMsAt(refIdx[k])`, where `tt[k] = devMsAt(refIdx[k])/1000`
   makes k the same beat (`ecgdex-dsp.js:1172-1176`, 2802-2812). NOTHING IN THE ESTIMATOR MOVES: the
   same `nn` values are paired with times that carry the correction (brief §7, owner D7 2026-10-12 —
   the hat itself is out of scope). Under `--axis wall` the two are the same axis by construction,
   because `hostAxis` refuses and `_ecgCorrAt` is then null — which is the negative control. */
export const REFERENCE_AXES = ['device', 'corrected'];
export const REF_AXIS_DEFAULT = 'device';
/* §∅ — A BEAT THAT CANNOT BE PLACED IS DROPPED, NEVER PLACED AT t0. The corrected branch refuses the
   whole night when the record carries no `tMsAt` or a `refIdx` that is not aligned with `nn`: a
   silent fall back to the device axis would make a corrected-axis row a device-axis row wearing the
   other label, which is the very confusion this option exists to end. `applied` reports
   `rec.tMsCorrected`, so a reader can tell "placed on the corrected axis" from "the correction was
   live", which are different gates (`ecgdex-dsp.js:5612`). */
export function referenceBeatTimes(rec, r, refAxis) {
  const axis = refAxis || REF_AXIS_DEFAULT;
  if (REFERENCE_AXES.indexOf(axis) < 0) throw new Error('unknown reference axis "' + axis + '" — one of ' + REFERENCE_AXES.join('|'));
  const nn = (r && r.nn) || [],
    tt = (r && r.tt) || [],
    t0 = (r && r.t0Ms) || (rec && rec.t0Ms) || 0,
    ms = [],
    vals = [],
    inBand = (x) => Number.isFinite(x) && x >= 200 && x <= 3000;
  if (axis === 'corrected') {
    /* 🔴 nn/tt ARE NOT INDEX-ALIGNED WITH refIdx, AND THE GUARD IS WHAT FOUND IT. `analyze` runs a
       beat-confidence filter after `buildNN` and PUSHES the survivors (`ecgdex-dsp.js:2882-2894`), so
       on a real night 5829 refined peaks become 5808 intervals. Its own comment says it: "`peaks[i]`,
       `nnRes.nn[i]` and `sqi[i]` share an index only BEFORE the confidence filter below." The first
       version of this function took the index for granted and the alignment check refused 2 of 2
       nights rather than mis-pairing them.

       So the beat is recovered BY ITS VALUE, not by its position. `tt[i]` is pushed unchanged from
       `times[k] = devMsAt(refIdx[k]) / 1000` (`ecgdex-dsp.js:2802-2812`), so rebuilding that same
       quantity over the unfiltered `refIdx` and keying it gives each surviving interval its sample
       index back. Two beats sharing a device ms collapse to one key harmlessly: the correction is a
       function of the device ms alone.

       THE KEY IS ROUNDED TO MICROSECONDS, and raw float equality would have been a trap. In the real
       path both sides evaluate the same expression on the same inputs and agree to the last bit, so
       `===` works — and it stops working the moment either side is written differently. `3 * 0.01`
       and `30 / 1000` are different doubles, which the selftest below plants on purpose. A microsecond
       key cannot collide either: refined peaks sit ~7.7 ms apart at 130 Hz.

       THIS BRANCH NEEDS THE DEVICE COUNTER. Without one, `analyze` builds its beat clock from the
       sample index plus a dead-time fold and `tMsAt` does the same — there is no device axis to
       correct, and a match by value would be a match between two different quantities. It refuses. */
    const idx = r && r.refIdx;
    if (typeof (rec && rec.tMsAt) !== 'function' || typeof (rec && rec.devMsAt) !== 'function' || !idx || !idx.length)
      return {
        ms: null,
        nn: null,
        axis,
        applied: null,
        dropped: null,
        matched: null,
        reason:
          'the corrected reference axis needs rec.tMsAt, rec.devMsAt and a non-empty refIdx — got ' +
          typeof (rec && rec.tMsAt) +
          ', ' +
          typeof (rec && rec.devMsAt) +
          ' and ' +
          (idx ? idx.length : 'no refIdx')
      };
    const byDevMs = new Map();
    for (let k = 0; k < idx.length; k++) {
      const d = rec.devMsAt(idx[k]);
      if (d == null || !Number.isFinite(d))
        return {
          ms: null,
          nn: null,
          axis,
          applied: null,
          dropped: null,
          matched: null,
          reason:
            'the record carries no usable device counter at refined peak ' +
            k +
            ' of ' +
            idx.length +
            ', so the beat clock is not on the device axis and there is nothing to place on the corrected one'
        };
      byDevMs.set(Math.round(d * 1e3), idx[k]);
    }
    let dropped = 0,
      wanted = 0;
    for (let i = 0; i < nn.length; i++) {
      if (!inBand(nn[i]) || !Number.isFinite(tt[i])) continue;
      wanted++;
      const at = byDevMs.get(Math.round(tt[i] * 1e6));
      const t = at === undefined ? null : rec.tMsAt(at);
      if (!Number.isFinite(t)) {
        dropped++;
        continue;
      }
      ms.push(t);
      vals.push(nn[i]);
    }
    /* A night that mostly fails to match is not a measurement of the corrected axis. The identity
       above either holds for a record or it does not; a partial match means it broke, so the night
       says so instead of scoring a mixture. */
    if (wanted && ms.length < 0.99 * wanted)
      return {
        ms: null,
        nn: null,
        axis,
        applied: null,
        dropped,
        matched: ms.length,
        reason: 'only ' + ms.length + ' of ' + wanted + ' in-band beats matched a refined peak by device ms — the beat-clock identity this branch rests on does not hold for this record'
      };
    return { ms, nn: vals, axis, applied: !!rec.tMsCorrected, dropped, matched: ms.length, reason: null };
  }
  for (let i = 0; i < nn.length; i++) if (inBand(nn[i]) && Number.isFinite(tt[i])) ms.push(t0 + tt[i] * 1000), vals.push(nn[i]);
  return { ms, nn: vals, axis, applied: false, dropped: 0, matched: ms.length, reason: null };
}
export const ROLLING_N = 30;
export const AXIS_WALL_REASON = '--axis wall: host discipline suppressed for the paired comparison';
export const SOLID_GATE = 'solid-night';

/* WHO ALREADY RIDES THE HOST AXIS — measured in the source before this option was written, because
   the brief's §2.3 reads as if nobody does. `sensor-trio-worker.js` indeed calls no `DexClock.hostAxis`,
   and it does not need to: the DSPs it delegates to own that call. ECGDex's `tMsAt` rides
   `correctionAt` (`ecgdex-dsp.js:5510`, and `ecgHrMap` uses `rec.tMsAt` for the beat's position in
   time), and PpgDex builds `relSec` from it (`ppgdex-dsp.js:1268`), which is what carries the Verity
   and the O2Ring corners. This tool loads `clock.js` into its realm, so EVERY corner it joins is
   already host-disciplined today.

   `--axis wall` is therefore the COUNTERFACTUAL leg of §3's paired comparison, not the status quo: it
   makes `hostAxis` return its own documented refusal, and each parser then falls back to the raw
   device counter — "ok:false ⇒ caller keeps the raw device axis" (`clock.js`, hostAxis's contract).
   NOTHING HERE CORRECTS A RATE (Clock Contract §7 forbids a node hand-rolling one); the only lever is
   whether the one correction the DSPs already own is allowed to run. In ECGDex that one refusal moves
   both legs at once — `fs` stays on the device clock and `tMsAt` stays on the device counter — which is
   exactly the "no host discipline" leg and is stated here so nobody reads `wall` as time-only.

   In BOTH modes the wrapper RECORDS each call, so a night can report whether a second clock existed at
   all. Clock Contract §7: read `independent`, never a ~0 ppm — AND read `deviceDrawn` first, because a
   host column synthesized from the device stamp can read `independent` while carrying no second clock
   at all (`CK_AXIS_DRAWN_SHARE` in `clock.js`). A drawn axis may be PLACED on a host timeline, never
   SPENT as a clock, so the summary tallies it as its own outcome instead of as independence. This tool
   REPORTS those flags beside the ppm and applies no rate itself. */
export function axisPatch(ctx, axis) {
  if (AXES.indexOf(axis) < 0) throw new Error('unknown axis "' + axis + '" — one of ' + AXES.join('|'));
  const D = ctx && ctx.DexClock;
  if (!D || typeof D.hostAxis !== 'function') return { axis, patched: false, reason: 'the realm carries no DexClock.hostAxis, so there is nothing to discipline or to suppress' };
  const real = D.hostAxis;
  ctx.__axis = axis;
  ctx.__axisCalls = [];
  ctx.__axisTag = null;
  const wrapped = function (anchors, opts) {
    const r = axis === 'wall' ? { ok: false, reason: AXIS_WALL_REASON, n: anchors ? anchors.length : 0 } : real(anchors, opts);
    ctx.__axisCalls.push({
      tag: ctx.__axisTag,
      ok: !!r.ok,
      n: Number.isFinite(r.n) ? r.n : null,
      ppm: Number.isFinite(r.ppm) ? r.ppm : null,
      independent: r.independent === undefined ? null : r.independent,
      deviceDrawn: r.deviceDrawn === undefined ? null : r.deviceDrawn,
      drawnShare: Number.isFinite(r.drawnShare) ? r.drawnShare : null
    });
    return r;
  };
  try {
    D.hostAxis = wrapped;
  } catch {
    /* a frozen export is replaced wholesale below */
  }
  if (D.hostAxis !== wrapped) ctx.DexClock = Object.assign({}, D, { hostAxis: wrapped });
  return { axis, patched: true, reason: null };
}
/* What the recorder saw, per corner. `independent` counts, never a mean ppm: a tally of real second
   clocks is the thing a reader of a corrected axis needs first — and `deviceDrawn` decides FIRST, so a
   drawn host column is tallied as `drawn` rather than inflating either `independent` or `inert`. */
export function axisSummary(calls) {
  const by = {};
  for (const c of calls || []) {
    const k = c.tag || 'untagged';
    if (!by[k]) by[k] = { calls: 0, refused: 0, drawn: 0, independent: 0, inert: 0, _ppm: [] };
    const s = by[k];
    s.calls++;
    if (!c.ok) s.refused++;
    if (c.deviceDrawn === true) s.drawn++;
    else if (c.independent === true) s.independent++;
    else if (c.independent === false) s.inert++;
    if (c.ppm != null) s._ppm.push(c.ppm);
  }
  for (const k of Object.keys(by)) {
    by[k].ppmMedian = median(by[k]._ppm);
    delete by[k]._ppm;
  }
  return by;
}

/* THE SOLID STRATUM comes from the box's per-night `SOLID-VERDICT.json`, READ-ONLY (brief §3). A night
   with no verdict file is OUTSIDE the stratum and is NOT a failed night — ∅: absence is not a 0, and
   it is not a FAIL either. A file whose gate is not `solid-night` is unreadable here rather than
   assumed: fail closed, and say how many. */
export function solidFromDir(dir, nights) {
  const inSet = [],
    absent = [],
    notPass = [],
    unreadable = [];
  for (const n of nights || []) {
    const p = path.join(dir, n, 'SOLID-VERDICT.json');
    let v = null;
    try {
      v = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      absent.push(n);
      continue;
    }
    if (!v || v.gate !== SOLID_GATE) unreadable.push(n);
    else if (v.status === 'PASS') inSet.push(n);
    else notPass.push(n);
  }
  return { nights: inSet, absent, notPass, unreadable, parsed: true, source: 'SOLID-VERDICT.json (gate ' + SOLID_GATE + ', status PASS) under the captures root', reason: null };
}
/* `--solid auto` | a path to a list | a comma- or space-separated list of YYYY-MM-DD.
   A spec that names no night is an ERROR, never an empty stratum: a typo must not read as "no solid
   nights", which is the examined-nothing shape with a number beside it. */
export function parseSolidSpec(spec, opts) {
  opts = opts || {};
  if (spec == null || spec === '') return { nights: [], parsed: false, source: null, reason: 'no --solid list given' };
  if (spec === 'auto') {
    if (!opts.dir) return { nights: [], parsed: false, source: null, reason: '--solid auto needs --dir to find the per-night SOLID-VERDICT.json' };
    return solidFromDir(opts.dir, opts.nights || []);
  }
  let text = spec,
    source = '--solid <list>';
  if (fs.existsSync(spec)) {
    text = fs.readFileSync(spec, 'utf8');
    source = spec;
  }
  const nights = [
    ...new Set(
      text
        .split('\n')
        .map((l) => l.replace(/#.*$/, ''))
        .join(' ')
        .split(/[\s,]+/)
        .filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t))
    )
  ].sort();
  if (!nights.length) return { nights: [], parsed: false, source: null, reason: 'no YYYY-MM-DD night in --solid ' + JSON.stringify(spec.slice(0, 60)) };
  return { nights, parsed: true, source, absent: [], notPass: [], unreadable: [], reason: null };
}

/* The night span a population covers — the date range §6 asks every verdict to carry. */
export function dateSpan(rows) {
  /* A DATE range, so only a night that IS a date contributes: a synthetic row's name is not a date,
     and reporting `synthetic-0 → synthetic-9` as a range would be a shape with no meaning. */
  const d = (rows || [])
    .map((r) => r && r.night)
    .filter((n) => typeof n === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(n))
    .sort();
  return { first: d.length ? d[0] : null, last: d.length ? d[d.length - 1] : null };
}
/* THREE POPULATIONS, one verdict each (brief §3). `rolling30` is a TREND and never the headline, so
   it carries its own gate name; `solid` is a STRATUM beside the headline. A listed solid night the run
   holds no row for is simply not in the population — it was not examined, so it is neither checked nor
   excluded here, and `listed` says how many the list named. */
export function selectPopulations(rows, solid) {
  const byDate = (rows || []).slice().sort((a, b) => (a.night < b.night ? -1 : a.night > b.night ? 1 : 0));
  const set = new Set((solid && solid.nights) || []);
  const inSet = byDate.filter((r) => set.has(r.night));
  return [
    { name: 'all', gate: 'tch-firmware-reference', label: 'all eligible nights', rows: byDate, listed: null, notRun: null },
    { name: 'rolling30', gate: 'tch-firmware-reference:rolling30', label: 'rolling last ' + ROLLING_N + ' eligible nights', rows: byDate.slice(-ROLLING_N), listed: null, notRun: null },
    {
      name: 'solid',
      gate: 'tch-firmware-reference:solid',
      label: 'solid nights only (' + SOLID_GATE + ' PASS)',
      rows: inSet,
      listed: set.size,
      notRun: inSet.length ? null : ((solid && solid.reason) || 'the solid list names ' + set.size + ' night(s) and this run scored none of them') + ' — no solid stratum was examined'
    }
  ];
}
/* A LEDGER ROW IS KEYED BY NIGHT **AND** AXIS. Without the axis a wall-axis row satisfies a host-axis
   run and the paired comparison silently compares a population with itself. A legacy row carries no
   `axis` field and reads as `host`, which is what it was: every row written before this option existed
   was produced with `clock.js` in the realm, i.e. host-disciplined. THE SAME HOLDS FOR THE REFERENCE
   AXIS: a row with no `referenceAxis` reads as `device`, which is the only axis the reference was ever
   built on before `--reference-axis` existed. A matched-axis row and a mixed-axis row must never share
   a key, or the paired comparison compares a population with itself. */
export function ledgerKey(night, axis, refAxis) {
  return String(night) + '\u0000' + (axis || 'host') + '\u0000' + (refAxis || REF_AXIS_DEFAULT);
}

export function verdictObject(P, rows, meta) {
  meta = meta || {};
  const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
  const span = dateSpan(rows);
  const axis = meta.axis || 'host';
  /* BOTH axes ride the verdict. A σ measured against a reference on the device counter and one
     measured against a reference on the corrected axis are different measurements of the same night;
     a reader that sees only `axis` cannot tell them apart. */
  const refAxis = meta.referenceAxis || REF_AXIS_DEFAULT;
  const axisWord = 'axis ' + axis + ' · reference axis ' + refAxis;
  let status,
    reason = null;
  if (meta.notRun) {
    status = 'NOT_RUN';
    reason = meta.notRun;
  } else if (P.nights < MIN_NIGHTS) {
    status = 'UNDERPOWERED';
    reason = `${P.nights} night(s) scored < the pre-stated minimum of ${MIN_NIGHTS} · ${axisWord}`;
  } else if (P.classic.frac >= PASS_FRAC) status = 'PASS';
  else {
    status = 'FAIL';
    reason = `classic hat: ${P.classic.pass}/${P.classic.total} optical night-corners within ±${BAND_ABS} bpm or ±${BAND_REL * 100} % of the reference-measured σ (< ${PASS_FRAC * 100} %); Verity σ̂ ${r3(P.medians.verity.classic)} vs true ${r3(P.medians.verity.trueSd)} bpm, ρ(V,O) ${r3(P.medians.rho.vo)} · ${axisWord}`;
  }
  const m = {};
  for (const k of KEYS) m[k] = { trueSd: r3(P.medians[k].trueSd), bias: r3(P.medians[k].bias), classic: r3(P.medians[k].classic), correlated: r3(P.medians[k].correlated) };
  return {
    schema: 'tepna.verdict/1',
    gate: meta.gate || 'tch-firmware-reference',
    axis,
    referenceAxis: refAxis,
    scope: 'internal',
    status,
    population: {
      name: meta.population || 'all',
      checked: P.nights,
      eligible: rows.length,
      excluded: rows.length - P.nights,
      first: span.first,
      last: span.last,
      ...(meta.listed == null ? {} : { listed: meta.listed })
    },
    criterion: { name: 'classic_hat_optical_corners_within_band_fraction', threshold: PASS_FRAC, unit: 'fraction', direction: 'gte' },
    result:
      status === 'NOT_RUN' || (status === 'UNDERPOWERED' && !P.nights)
        ? null
        : {
            classicPassFraction: r3(P.classic.frac),
            correlated: { passFraction: r3(P.correlated.frac), refused: P.correlated.refused, status: P.correlated.frac >= PASS_FRAC ? 'PASS' : 'FAIL' },
            medians: m,
            rho: { hv: r3(P.medians.rho.hv), ho: r3(P.medians.rho.ho), vo: r3(P.medians.rho.vo) }
          },
    evidence: ['tools/tch-firmware-reference.mjs', ...(meta.roots || []).map((r) => `${r}/**/{*_ECG.txt,*_RR.txt,*_PPG.txt,*_SPO2.csv}`)],
    reason,
    producedBy: {
      tool: 'tools/tch-firmware-reference.mjs',
      commit: meta.commit || null,
      ...(meta.commit ? {} : { commitReason: meta.sample ? '--verdict-sample: synthetic rows, no code identity claimed' : 'not run inside a git checkout' })
    },
    at: (meta.at || new Date().toISOString()).replace(/\.\d{3}Z$/, 'Z')
  };
}

/* ── synthetic nights (selftest + --verdict-sample): planted σ and ρ, known truth ─────────────── */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return (s & 0xffffff) / 0x1000000;
  };
}
function gauss(r) {
  return Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());
}
export function syntheticMaps(seed, sig, rhoVO, n = 4000) {
  const r = rng(seed),
    REF = new Map(),
    H = new Map(),
    V = new Map(),
    O = new Map();
  for (let s = 0; s < n; s++) {
    const hr = 55 + 5 * Math.sin(s / 600) + gauss(r),
      z = gauss(r),
      zv = gauss(r),
      zo = gauss(r);
    REF.set(s, hr);
    H.set(s, hr + sig.h10 * gauss(r));
    // a shared optical term makes corr(eV, eO) = rhoVO with the planted marginal σs
    V.set(s, hr + sig.verity * (Math.sqrt(rhoVO) * z + Math.sqrt(1 - rhoVO) * zv));
    O.set(s, hr + sig.o2 * (Math.sqrt(rhoVO) * z + Math.sqrt(1 - rhoVO) * zo));
  }
  return { REF, H, V, O };
}
export function syntheticRows(k, rhoVO, sig = { h10: 0.8, verity: 0.7, o2: 1.7 }) {
  return Array.from({ length: k }, (_, i) => {
    const m = syntheticMaps(1000 + i, sig, rhoVO);
    return { night: 'synthetic-' + i, ...scoreSeries(m.REF, m.H, m.V, m.O) };
  });
}
export function verdictSample() {
  const rows = syntheticRows(12, 0.3);
  return verdictObject(pool(rows), rows, { roots: ['<synthetic>'], commit: null, at: '2026-09-26T20:00:00Z', sample: true });
}

function selftest() {
  const fails = [];
  let ran = 0;
  const ok = (c, m) => {
    ran++;
    if (!c) fails.push(m);
  };
  const V = req(path.join(ROOT, 'verdict.js'));
  // 1 · the measurement recovers planted truth
  const m = syntheticMaps(7, { h10: 0.8, verity: 0.7, o2: 1.7 }, 0);
  const s0 = scoreSeries(m.REF, m.H, m.V, m.O);
  ok(s0.ok && Math.abs(s0.trueSd.verity - 0.7) < 0.05 && Math.abs(s0.trueSd.o2 - 1.7) < 0.08, 'true σ recovers the planted σ (ρ = 0)');
  // 2 · with independent errors the classic hat is right; with correlated optical errors it under-reads them
  ok(s0.hat.verity != null && Math.abs(s0.hat.verity - 0.7) < 0.1, 'classic hat is right when ρ = 0');
  const mc = syntheticMaps(8, { h10: 0.8, verity: 0.7, o2: 1.7 }, 0.4),
    sc = scoreSeries(mc.REF, mc.H, mc.V, mc.O);
  ok(sc.ok && Math.abs(sc.rho.vo - 0.4) < 0.06, 'ρ(V,O) measured against the reference recovers the planted 0.4');
  ok(sc.hat.verity == null || sc.hat.verity < sc.trueSd.verity - 0.1, 'ANTI-VACUITY · the classic hat under-reads a correlated optical corner');
  ok(sc.hat.h10 > sc.trueSd.h10 + 0.1, 'ANTI-VACUITY · …and charges the shared error to the H10');
  // 3 · leave-one-out: a planted outlier night's own ρ never reaches its own solve
  const rows = syntheticRows(8, 0.4);
  rows.push({ night: 'outlier', ...scoreSeries(...Object.values(syntheticMaps(99, { h10: 0.8, verity: 0.7, o2: 1.7 }, 0.9))) });
  const loo = correlatedLOO(rows, rows.length - 1);
  ok(loo.rho && Math.abs(loo.rho.bc - 0.4) < 0.08, 'leave-one-out ρ for the outlier comes from the OTHER nights (≈0.4, not its own 0.9)');
  // 4 · where σ is identifiable (ρ well below σ_small/σ_large = 0.7/1.7 ≈ 0.41), the reference ρ fixes the hat
  const P = pool(syntheticRows(12, 0.3));
  ok(P.correlated.frac >= PASS_FRAC && P.correlated.frac > P.classic.frac, 'correlated hat (ρ from the reference) passes where the classic hat fails, ρ = 0.3');
  // 4b · NEAR ρ ≈ σ_small/σ_large THE SMALL CORNER IS NOT IDENTIFIABLE: ∂vVO/∂σV = 2(σV − ρσO) ≈ 0, so the
  //      difference variances barely move with σV. The solve must mostly REFUSE there, never pass by luck.
  const Pe = pool(syntheticRows(12, 0.4));
  ok(Pe.correlated.refused >= 6 && Pe.correlated.frac < PASS_FRAC, 'at ρ ≈ σV/σO the correlated solve refuses most nights and does not PASS (' + Pe.correlated.refused + ' refused)');
  // 5 · band + verdict contract
  ok(withinBand(1.0, 1.25) && withinBand(2.0, 2.5) && !withinBand(0.41, 0.73), 'band: ±0.3 bpm or ±30 %; the measured Verity miss fails it');
  const vs = verdictSample();
  ok(V.validate(vs).ok, 'verdict sample validates: ' + V.validate(vs).errors.join(' | '));
  const few = syntheticRows(3, 0);
  ok(verdictObject(pool(few), few, { at: '2026-09-26T20:00:00Z' }).status === 'UNDERPOWERED', 'fewer than MIN_NIGHTS ⇒ UNDERPOWERED, never PASS');
  const bad = [{ night: 'x', ok: false, reason: 'no overlap' }];
  const vb = verdictObject(pool(bad), bad, { at: '2026-09-26T20:00:00Z' });
  ok(vb.population.checked === 0 && vb.population.excluded === 1 && V.validate(vb).ok, 'an all-refused run is UNDERPOWERED over checked 0, and says so');
  // 6 · the axis switch: one call site, both modes recorded, and an unknown axis fails closed
  const fakeReal = (anchors) => ({ ok: true, n: anchors.length, ppm: -20.5, independent: true, correctionAt: () => 5 });
  const A3 = [
    { devMs: 0, hostMs: 0 },
    { devMs: 1000, hostMs: 1001 },
    { devMs: 2000, hostMs: 2003 }
  ];
  const cH = { DexClock: { hostAxis: fakeReal } };
  ok(axisPatch(cH, 'host').patched === true, 'axisPatch installs on a realm that carries DexClock.hostAxis');
  cH.__axisTag = 'h10';
  const rH = cH.DexClock.hostAxis(A3);
  ok(rH.ok === true && rH.ppm === -20.5 && typeof rH.correctionAt === 'function', 'ANTI-VACUITY · host mode passes the real axis through untouched, `correctionAt` included');
  const cW = { DexClock: { hostAxis: fakeReal } };
  axisPatch(cW, 'wall');
  cW.__axisTag = 'verity';
  const rW = cW.DexClock.hostAxis(A3);
  ok(rW.ok === false && rW.reason === AXIS_WALL_REASON && rW.correctionAt === undefined, "wall mode returns hostAxis's OWN refusal shape, so every parser keeps the raw device axis");
  ok(axisSummary(cH.__axisCalls).h10.independent === 1 && axisSummary(cW.__axisCalls).verity.refused === 1, 'both modes RECORD the call, tagged by corner — `independent`, never a ~0 ppm');
  /* A DRAWN AXIS IS NOT A SECOND CLOCK, and it arrives wearing independence. Shown to discriminate in
     both directions on the same recorder: the drawn call lands in `drawn` and NOT in `independent`,
     while the call above (no `deviceDrawn`) still counts as independent. */
  const cD = { DexClock: { hostAxis: () => ({ ok: true, n: 3, ppm: -20.5, independent: true, deviceDrawn: true, drawnShare: 0.91, correctionAt: () => 0 }) } };
  axisPatch(cD, 'host');
  cD.__axisTag = 'o2';
  cD.DexClock.hostAxis(A3);
  const sD = axisSummary(cD.__axisCalls).o2;
  ok(sD.drawn === 1 && sD.independent === 0 && sD.inert === 0, 'a drawn host column tallies as `drawn`, never as independence (Clock Contract §7)');
  let threw = null;
  try {
    axisPatch({ DexClock: { hostAxis: fakeReal } }, 'wallclock');
  } catch (e) {
    threw = String((e && e.message) || e);
  }
  ok(threw != null && /unknown axis/.test(threw), 'an unknown --axis THROWS rather than quietly running one of the two');
  const bare = axisPatch({}, 'host');
  ok(bare.patched === false && /no DexClock/.test(bare.reason), 'a realm with no DexClock says so instead of crashing mid-night');
  ok(
    ledgerKey('2026-09-26', 'wall') !== ledgerKey('2026-09-26', 'host') && ledgerKey('2026-09-26', null) === ledgerKey('2026-09-26', 'host'),
    'the ledger key separates the two axes, and a legacy row with no axis reads as host — which is what it was'
  );
  // 6b · the reference's own axis: the two timebases, the plant that separates them, and no silent fallback
  const mkRec = (corr) => ({
    t0Ms: 1000000,
    tMsCorrected: !!corr,
    devMsAt: (i) => i * 10,
    tMsAt: (i) => 1000000 + i * 10 + (corr ? corr(i * 10) : 0)
  });
  /* nn[1] is out of band on purpose: both branches must drop the same beat, or a "same axis"
     comparison would also be comparing different beat sets. */
  const rBeats = { t0Ms: 1000000, nn: [900, 50, 1000, 1000], tt: [0, 0.01, 0.02, 0.03], refIdx: [0, 1, 2, 3] };
  const rbD = referenceBeatTimes(mkRec(null), rBeats, 'device');
  ok(rbD.ms.join(',') === '1000000,1000020,1000030' && rbD.nn.join(',') === '900,1000,1000' && rbD.axis === 'device', 'the device branch is t0 + tt·1000 over the in-band beats, unchanged');
  const rbZ = referenceBeatTimes(
    mkRec(() => 0),
    rBeats,
    'corrected'
  );
  ok(rbZ.ms.join(',') === rbD.ms.join(',') && rbZ.nn.join(',') === rbD.nn.join(','), 'NEGATIVE CONTROL · with a zero correction the corrected axis reproduces the device axis beat for beat');
  const rbC = referenceBeatTimes(
    mkRec((d) => d * 0.001),
    rBeats,
    'corrected'
  );
  ok(
    rbC.ms.length === 3 && rbC.ms.every((t, k) => Math.abs(t - rbD.ms[k] - (rbD.ms[k] - 1000000) * 0.001) < 1e-9) && rbC.ms[2] !== rbD.ms[2],
    'ANTI-VACUITY · a planted +1000 ppm correction moves every reference beat time by exactly the plant (' + (rbC.ms[2] - rbD.ms[2]).toFixed(3) + ' ms at the last beat)'
  );
  ok(rbC.applied === true && rbD.applied === false, 'the row reports whether the correction was LIVE (rec.tMsCorrected), which is not the same gate as which axis was asked for');
  /* THE REAL SHAPE: `analyze`'s confidence filter drops beats, so nn/tt is SHORTER than refIdx and
     carries no index into it. Recovery is by device ms, so the survivors still place exactly. */
  const filtered = referenceBeatTimes(
    mkRec((d) => d * 0.001),
    { t0Ms: 1000000, nn: [900, 1000, 1000], tt: [0, 0.02, 0.05], refIdx: [0, 1, 2, 3, 4, 5] },
    'corrected'
  );
  ok(
    filtered.ms.length === 3 && filtered.matched === 3 && Math.abs(filtered.ms[2] - (1000000 + 50 + 0.05)) < 1e-9,
    'a filtered nn/tt shorter than refIdx still places every surviving beat — the beat is found by its device ms, never by its position'
  );
  let threwRef = null;
  try {
    referenceBeatTimes(mkRec(null), rBeats, 'corrrected');
  } catch (e) {
    threwRef = String((e && e.message) || e);
  }
  ok(threwRef != null && /unknown reference axis/.test(threwRef), 'an unknown --reference-axis THROWS rather than quietly running the default');
  const noAcc = referenceBeatTimes({ t0Ms: 1000000 }, rBeats, 'corrected');
  ok(noAcc.ms === null && /needs rec.tMsAt/.test(noAcc.reason), 'a record with no tMsAt REFUSES the night by name — it never falls back to the device axis wearing the corrected label');
  const noCounter = referenceBeatTimes({ t0Ms: 1000000, tMsAt: (i) => 1000000 + i * 10, devMsAt: () => null }, rBeats, 'corrected');
  ok(noCounter.ms === null && /no usable device counter/.test(noCounter.reason), 'a record whose counter is unusable refuses: there is no device axis to place on the corrected one');
  const shortIdx = referenceBeatTimes(mkRec(null), { ...rBeats, refIdx: [0, 1] }, 'corrected');
  ok(
    shortIdx.ms === null && shortIdx.matched === 1 && /beat-clock identity/.test(shortIdx.reason),
    'beats that match no refined peak by device ms refuse the night — a partial match means the identity broke, so no mixture is scored'
  );
  const holedRec = { ...mkRec(null), tMsAt: (i) => (i === 2 ? NaN : 1000000 + i * 10) };
  const holed = referenceBeatTimes(
    holedRec,
    { t0Ms: 1000000, nn: Array.from({ length: 200 }, () => 1000), tt: Array.from({ length: 200 }, (_, i) => i * 0.01), refIdx: Array.from({ length: 200 }, (_, i) => i) },
    'corrected'
  );
  ok(holed.ms.length === 199 && holed.dropped === 1 && holed.matched === 199, '§∅ · one unplaceable beat in 200 is dropped and COUNTED, never placed at t0');
  const holedMany = referenceBeatTimes(holedRec, rBeats, 'corrected');
  ok(holedMany.ms === null && /beat-clock identity/.test(holedMany.reason), 'one unplaceable beat in three is past the 99 % floor, so that night refuses instead of scoring two thirds of a reference');
  /* DECOY · the key must separate the matched pair from the mixed one. A device-axis reference under
     --axis host is exactly the row the paired comparison must not accept as a corrected-axis row. */
  ok(
    ledgerKey('2026-09-26', 'host', 'corrected') !== ledgerKey('2026-09-26', 'host', 'device') &&
      ledgerKey('2026-09-26', 'host') === ledgerKey('2026-09-26', 'host', 'device') &&
      ledgerKey('2026-09-26', 'wall', 'corrected') !== ledgerKey('2026-09-26', 'host', 'corrected'),
    'the ledger key separates the reference axes too, and a legacy row with no referenceAxis reads as device — the only axis the reference ever had'
  );
  const vref = verdictObject(pool(syntheticRows(3, 0)), syntheticRows(3, 0), { axis: 'host', referenceAxis: 'corrected', at: '2026-10-20T00:00:00Z' });
  ok(vref.referenceAxis === 'corrected' && /axis host · reference axis corrected/.test(vref.reason || ''), 'the verdict carries the reference axis and every non-PASS reason names BOTH axes');
  ok(
    verdictObject(pool(syntheticRows(3, 0)), syntheticRows(3, 0), { at: '2026-10-20T00:00:00Z' }).referenceAxis === 'device',
    'a verdict written with no reference axis reads as device, so a legacy verdict file is not relabelled'
  );
  // 7 · the solid stratum, read-only from each night's own verdict; a typo never reads as "no solid nights"
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tchref-solid-'));
  const plant = (n, o) => {
    fs.mkdirSync(path.join(tmp, n));
    if (o) fs.writeFileSync(path.join(tmp, n, 'SOLID-VERDICT.json'), JSON.stringify(o));
  };
  plant('2026-09-01', { gate: SOLID_GATE, status: 'PASS' });
  plant('2026-09-02', { gate: SOLID_GATE, status: 'UNKNOWN' });
  plant('2026-09-03', null);
  plant('2026-09-04', { gate: 'solid-night-draft', status: 'PASS' });
  const sd = solidFromDir(tmp, ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
  ok(
    sd.nights.join(',') === '2026-09-01' && sd.notPass.length === 1 && sd.absent.length === 1 && sd.unreadable.length === 1,
    'solid = PASS under gate ' + SOLID_GATE + '; a non-PASS, an absent file and a foreign gate each stay OUT and are counted separately'
  );
  const lf = path.join(tmp, 'list.txt');
  fs.writeFileSync(lf, '# 2026-08-31 was excluded\n2026-09-01\n2026-09-02\n');
  ok(parseSolidSpec(lf, {}).nights.join(',') === '2026-09-01,2026-09-02', 'a --solid FILE reads one night per line, and a # comment contributes none of its dates');
  ok(parseSolidSpec('2026-09-02, 2026-09-01', {}).nights.join(',') === '2026-09-01,2026-09-02', 'a --solid comma list parses and sorts');
  const typo = parseSolidSpec('2026-9-1', {});
  ok(typo.parsed === false && !typo.nights.length && /no YYYY-MM-DD/.test(typo.reason), 'a malformed --solid spec FAILS CLOSED with a reason, never as an empty stratum');
  ok(parseSolidSpec('auto', {}).parsed === false && /needs --dir/.test(parseSolidSpec('auto', {}).reason), '--solid auto without --dir names what it lacks');
  fs.rmSync(tmp, { recursive: true, force: true });
  // 8 · three populations, one verdict each, each carrying ITS OWN date range
  const dates = Array.from({ length: 40 }, (_, i) => '2026-09-' + String(i + 1).padStart(2, '0'));
  const dated = syntheticRows(40, 0.4).map((r, i) => ({ ...r, night: dates[i] }));
  const sol = { nights: [dates[0], dates[5], dates[39], '2026-12-31'], parsed: true, reason: null };
  const pops = selectPopulations(dated, sol);
  ok(pops.length === 3 && pops.map((p) => p.name).join(',') === 'all,rolling30,solid', 'three populations: all · rolling30 · solid');
  ok(pops[1].rows.length === ROLLING_N && pops[1].rows[0].night === dates[10] && pops[1].rows[ROLLING_N - 1].night === dates[39], 'rolling30 takes the LAST 30 by date, not the first 30');
  ok(pops[2].rows.length === 3 && pops[2].listed === 4, 'a listed solid night this run holds no row for is not in the population, and `listed` says how many the list named');
  const pv = pops.map((p) =>
    verdictObject(pool(p.rows), p.rows, { roots: ['<synthetic>'], commit: null, axis: 'wall', gate: p.gate, population: p.name, listed: p.listed, notRun: p.notRun, at: '2026-10-18T00:00:00Z' })
  );
  ok(
    pv.every((v) => V.validate(v).ok),
    'every population verdict validates: ' + pv.map((v) => V.validate(v).errors.join(' | ')).join(' // ')
  );
  ok(pv[0].population.first === dates[0] && pv[0].population.last === dates[39] && pv[1].population.first === dates[10], 'each verdict carries the date range of ITS OWN population');
  ok(
    pv[0].gate === 'tch-firmware-reference' && pv[1].gate === 'tch-firmware-reference:rolling30' && pv[2].gate === 'tch-firmware-reference:solid',
    'the headline keeps the gate name existing readers quote; the trend and the stratum name themselves'
  );
  ok(
    pv[2].status === 'UNDERPOWERED' && pv.every((v) => v.axis === 'wall' && (v.status === 'PASS' || /axis wall/.test(v.reason || ''))),
    'the axis rides every verdict and every non-PASS reason names it — a σ is not comparable across axes'
  );
  const noSolid = selectPopulations(dated, parseSolidSpec(null, {}))[2];
  const nv = verdictObject(pool(noSolid.rows), noSolid.rows, { roots: ['<synthetic>'], commit: null, gate: noSolid.gate, population: 'solid', notRun: noSolid.notRun, at: '2026-10-18T00:00:00Z' });
  ok(nv.status === 'NOT_RUN' && nv.result === null && V.validate(nv).ok, 'no --solid list ⇒ the solid verdict reads NOT_RUN with result null — never a PASS, a FAIL or an UNDERPOWERED over nothing');
  /* ── the population a run measures is one continuous set ───────────────────────────────────────
     Residue `2026-10-20-a-daily-corpus-resync-moves-the-population-mid-measurement`: the daily
     re-sync preserves mtimes, so a night arriving mid-run moves ctime alone and two legs 60 s apart
     read 93 night directories and 97. The arrival and departure arithmetic is proven in
     `tools/corpus-scope.mjs --selftest` over real temp directories, including the leg that shows the
     root's own mtime does not move. What is proven HERE is the wiring: that this tool reaches the
     primitive, reports the real night set, and takes its two snapshots around the scoring loop
     rather than beside each other. ⚠️ No leg drives an end-to-end SHORTFALL, because an arrival
     cannot be timed into another process's run without blocking that process on a FIFO, and a gate
     leg that can hang is worse than a named limit. The ordering legs below are what a later edit
     would break. */
  const popTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tch-pop-'));
  try {
    for (const n of ['2026-09-01', '2026-09-02']) fs.mkdirSync(path.join(popTmp, n));
    fs.writeFileSync(path.join(popTmp, 'README.md'), 'not a night\n');
    fs.mkdirSync(path.join(popTmp, '2026-09-0'));
    const out = execFileSync(process.execPath, [path.join(HERE, 'tch-firmware-reference.mjs'), '--dir', popTmp, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const ps = JSON.parse(out.slice(out.indexOf('{'))).detail.populationStability;
    ok(ps && ps.gate === 'corpus-population' && V.validate(ps).ok, 'a run carries a validating `corpus-population` verdict beside its own');
    ok(ps.status === 'PASS' && ps.reason === null, 'a root that does not move during the run reads PASS with no reason');
    ok(ps.population.checked === 2 && ps.population.eligible === 2 && ps.population.excluded === 0, 'the figure is the real night count, and nothing is excluded from a set that did not move');
    ok(ps.result.n === 2 && ps.result.digest && ps.result.root === popTmp, 'the verdict names the root it enumerated and digests the set, so two runs are comparable');
    ok(ps.producedBy.commit !== null, 'the commit is read before the verdict is built, never left null in a checkout');
  } finally {
    fs.rmSync(popTmp, { recursive: true, force: true });
  }
  /* ⚠️ Every anchor below is ASSEMBLED FROM FRAGMENTS. Written as a literal, each one's first
     occurrence in this file is the leg's own text, which sits above `main` — so `indexOf` would
     compare two selftest-internal positions and the ordering would read as satisfied whatever
     `main` does. That is §👥.4's `pgrep -f` self-match two layers down, and it scored one of these
     three legs green before the fragments went in. */
  const src = fs.readFileSync(path.join(HERE, 'tch-firmware-reference.mjs'), 'utf8');
  const at = (...frag) => src.indexOf(frag.join(''));
  const iOpen = at('const popBe', 'fore = snapshotNights(dir)');
  /* The anchor moved with the code it describes: the scored list is now DERIVED from the opening
     snapshot, so the thing to pin is that derivation and not a second night regex. */
  const iEnum = at('const nights = popBe', 'fore.nights.filter(');
  const iRows = at('let rows = [...seen', '.values()]');
  const iClose = at('const popAf', 'ter = snapshotNights(dir)');
  const iCut = at('intersectSnapshots(popBefore,', ' popAfter)');
  const iSelect = at('parseSolidSpec(solid', 'Spec');
  ok(
    [iOpen, iEnum, iRows, iClose, iCut, iSelect].every((n) => n > 0),
    'ANTI-VACUITY · every ordering anchor is found, so no leg below passes on a pair of −1s'
  );
  ok(iOpen < iEnum, 'ORDERING · the opening snapshot is taken before the nights are enumerated');
  ok(at('fs\n    .readdir', 'Sync(dir)') < 0, 'ONE WALK · the scored nights come out of the snapshot, so no second enumeration of the root can disagree with the verdict');
  ok(iClose > iRows, 'ORDERING · the closing snapshot is taken after the scoring loop, not beside the opening one');
  ok(iCut < iSelect, 'ORDERING · the intersection narrows the rows before any population is selected from them');
  console.log(fails.length ? `SELFTEST FAIL (${fails.length}/${ran})\n  ${fails.join('\n  ')}` : `SELFTEST PASS (${ran}/${ran})`);
  return fails.length ? 1 : 0;
}

/* ── corpus side: the page's own worker functions in a headless realm ─────────────────────────── */
function loadRealm(axis, refAxis) {
  const DexBuild = req(path.join(ROOT, 'tools', 'build-core.js'));
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    Math,
    JSON,
    Date,
    Map,
    Set,
    Uint8Array,
    Int16Array,
    Int32Array,
    Float32Array,
    Float64Array,
    Array,
    Object,
    Number,
    String,
    isFinite,
    isNaN,
    parseInt,
    parseFloat,
    Proxy,
    Symbol,
    Error,
    RegExp,
    BigInt
  });
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  ctx.importScripts = () => {};
  ctx.postMessage = () => {};
  for (const f of ['clock.js', 'kernel-constants.js', 'metric-registry.js', 'analysis-stats.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js', 'sensor-trio-worker.js'])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(ROOT, f), 'utf8')), ctx, { filename: f });
  /* The realm carries `clock.js`, so every parser below disciplines its own axis unless this says
     otherwise. The patch also RECORDS each call, which is how a night reports whether the device had a
     second clock at all. */
  const patched = axisPatch(ctx, axis || 'host');
  if (!patched.patched) throw new Error('axis ' + (axis || 'host') + ' not installed: ' + patched.reason);
  const rA = refAxis || REF_AXIS_DEFAULT;
  if (REFERENCE_AXES.indexOf(rA) < 0) throw new Error('unknown reference axis "' + rA + '" — one of ' + REFERENCE_AXES.join('|'));
  ctx.__refAxis = rA;
  return ctx;
}
function largest(dir, re) {
  const c = fs.readdirSync(dir).filter((f) => re.test(f));
  return c.length ? path.join(dir, c.sort((a, b) => fs.statSync(path.join(dir, b)).size - fs.statSync(path.join(dir, a)).size)[0]) : null;
}
export function scoreNightDir(ctx, dir) {
  const E = ctx.ECGDSP,
    fn = (n) => vm.runInContext(n, ctx),
    night = path.basename(dir),
    axis = ctx.__axis || 'host',
    refAxis = ctx.__refAxis || REF_AXIS_DEFAULT,
    tag = (t) => {
      ctx.__axisTag = t;
    };
  if (Array.isArray(ctx.__axisCalls)) ctx.__axisCalls.length = 0;
  const f = {
    ecg: largest(dir, /H10.*_ECG\.txt$/),
    rr: largest(dir, /H10.*_RR\.txt$/),
    ppg: largest(dir, /VeritySense.*_PPG\.txt$/),
    ring: largest(dir, /O2Ring.*_PPG\.txt$/),
    spo2: largest(dir, /_SPO2\.csv$/)
  };
  const missing = ['ecg', 'rr', 'ppg'].filter((k) => !f[k]).concat(f.ring || f.spo2 ? [] : ['ring']);
  if (missing.length) return { night, axis, referenceAxis: refAxis, ok: false, reason: 'missing ' + missing.join(', ') };
  try {
    const ecgTxt = fs.readFileSync(f.ecg, 'utf8');
    tag('reference·h10');
    const rec = E.parseECG(ecgTxt),
      dev = E.parseDeviceRR(fs.readFileSync(f.rr, 'utf8')),
      r = E.analyze(rec, null);
    const ref = referenceBeatTimes(rec, r, refAxis);
    if (ref.reason) return { night, axis, referenceAxis: refAxis, ok: false, reason: ref.reason };
    const selfMs = ref.ms,
      selfNN = ref.nn;
    /* ⚠️ THE REFERENCE AND THE H10 CORNER DO NOT SHARE AN AXIS (read 2026-10-18, Osprey; left
       standing on purpose). `analyze` builds `r.tt` from `rec.devMsAt` — the RAW device counter,
       with no `correctionAt` (`ecgdex-dsp.js:2824-2831`) — while the H10 corner's HR series below
       rides `rec.tMsAt`, which adds the correction (`ecgdex-dsp.js:5610`). Under `--axis host` the
       two therefore diverge across a night by the host discipline's own correction, and the H10's
       apparent error against a reference derived from its own beats carries that divergence; under
       `--axis wall` both collapse onto the device counter and agree. Moving the reference onto
       `tMsAt` changes the estimator's inputs, which the brief puts out of scope (§7), so this stays
       a named defect rather than a silent repair. */
    const fw = firmwareHostTimes(dev, 300),
      fwMs = [],
      fwRR = [];
    for (let a = 0; a < fw.timesMs.length; a += 600) {
      const b = Math.min(fw.timesMs.length, a + 600),
        w = Array.from(fw.timesMs.subarray(a, b));
      const near = selfMs.filter((t) => t >= w[0] - 6200 && t <= w[w.length - 1] + 6200);
      if (near.length < 50) continue;
      const L = coincidenceLag(near, w, 150, 6000);
      if (L.refused) continue;
      for (let i = a; i < b; i++) {
        fwMs.push(fw.timesMs[i] - L.lagMs);
        fwRR.push(dev[i].rr);
      }
    }
    const cp = consensusPairs(selfMs, selfNN, fwMs, fwRR);
    const REF = perSecondMedian(cp.pairs);
    const unwrap = (x) => (x && x.hr ? x.hr : x);
    tag('h10');
    const H = unwrap(fn('ecgHrMap')(ecgTxt));
    tag('verity');
    const V = unwrap(fn('ppgHrMapReal')(fs.readFileSync(f.ppg, 'utf8')));
    tag('o2');
    let O = null,
      o2Source = null;
    if (f.ring) {
      const t = fs.readFileSync(f.ring, 'utf8');
      O = fn('o2MarkerHrMap')(t);
      if (O) o2Source = 'ring·156-markers';
      else {
        O = unwrap(fn('ppgHrMapReal')(t));
        if (O) o2Source = 'ring·PPGDSP';
      }
    }
    if (!O && f.spo2) {
      O = fn('o2PulseMap')(fs.readFileSync(f.spo2, 'utf8'));
      if (O) o2Source = 'ring·SpO2-csv';
    }
    if (!H || !V || !O) return { night, axis, ok: false, reason: 'a corner produced no HR map (' + (!H ? 'H10 ' : '') + (!V ? 'Verity ' : '') + (!O ? 'O2Ring' : '') + ')' };
    const s = scoreSeries(REF, H, V, O);
    return {
      night,
      axis,
      referenceAxis: refAxis,
      o2Source,
      reference: { consecutivePairs: cp.consecutive, agreeing: cp.pairs.length, seconds: REF.size, beats: selfNN.length, axisApplied: ref.applied, unplaceable: ref.dropped },
      hostAxis: axisSummary(ctx.__axisCalls),
      ...s
    };
  } catch (e) {
    return { night, axis, referenceAxis: refAxis, ok: false, reason: String((e && e.message) || e).slice(0, 160) };
  }
}

async function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  if (argv.includes('--verdict-sample')) {
    console.log(JSON.stringify(verdictSample(), null, 1));
    return 0;
  }
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] != null ? argv[i + 1] : null;
  };
  const dir = arg('--dir');
  const axis = arg('--axis') || 'host';
  const refAxis = arg('--reference-axis') || REF_AXIS_DEFAULT;
  if (!dir || !fs.existsSync(dir) || AXES.indexOf(axis) < 0 || REFERENCE_AXES.indexOf(refAxis) < 0) {
    console.error(
      'usage: node tools/tch-firmware-reference.mjs --selftest | --verdict-sample | --dir <captures root> [--axis host|wall] [--reference-axis device|corrected] [--solid auto|<file|list>] [--night YYYY-MM-DD]… [--ledger f.jsonl] [--json]'
    );
    if (AXES.indexOf(axis) < 0) console.error('  --axis must be one of ' + AXES.join('|') + ', got ' + JSON.stringify(axis));
    if (REFERENCE_AXES.indexOf(refAxis) < 0) console.error('  --reference-axis must be one of ' + REFERENCE_AXES.join('|') + ', got ' + JSON.stringify(refAxis));
    return 2;
  }
  /* THE OPENING POPULATION, taken before anything is scored. A daily job re-syncs this root with
     mtimes preserved, so a night can arrive mid-run and no timestamp on the root shows it (residue
     `2026-10-20-a-daily-corpus-resync-moves-the-population-mid-measurement`: two legs 60 s apart
     read 93 night directories and 97). The closing snapshot is taken after the scoring loop and the
     figure is reported over the INTERSECTION, so every population below describes one continuous
     set rather than whichever set the enumeration happened to catch. */
  const popBefore = snapshotNights(dir);
  const only = argv.flatMap((a, i) => (a === '--night' && argv[i + 1] ? [argv[i + 1]] : []));
  const ledger = arg('--ledger');
  const seen = new Map();
  if (ledger && fs.existsSync(ledger))
    for (const l of fs.readFileSync(ledger, 'utf8').split('\n'))
      if (l.trim()) {
        const r = JSON.parse(l);
        seen.set(ledgerKey(r.night, r.axis, r.referenceAxis), r);
      }
  /* THE SCORED SET IS THE SNAPSHOT, NEVER A THIRD WALK. This used to re-enumerate `dir` here, so
     the verdict below described one walk and the loop scored another, and a night arriving between
     the two was scored into a figure whose population never saw it. The intersection repaired the
     symptom after the fact; taking the list from `popBefore` removes the second population
     (RESIDUE 2026-10-21-forty-one-corpus-enumerators-report-no-population). */
  const nights = popBefore.nights.filter((n) => !only.length || only.includes(n));
  let ctx = null;
  for (const n of nights) {
    if (seen.has(ledgerKey(n, axis, refAxis))) continue;
    ctx = ctx || loadRealm(axis, refAxis);
    const row = scoreNightDir(ctx, path.join(dir, n));
    seen.set(ledgerKey(n, axis, refAxis), row);
    if (ledger) fs.appendFileSync(ledger, JSON.stringify(row) + '\n');
    console.error(`${n}  axis ${axis}/${refAxis}  ${row.ok ? 'scored ' + row.n + ' s' : 'refused: ' + row.reason}`);
  }
  /* A row from the OTHER axis — EITHER axis — is a different measurement of the same night, never a
     substitute. The reference axis filters here as well as keying the ledger, because a legacy ledger
     holds device-axis rows under both `--axis` values. */
  let rows = [...seen.values()]
    .filter((r) => (r.axis || 'host') === axis && (r.referenceAxis || REF_AXIS_DEFAULT) === refAxis && (!only.length || only.includes(r.night)))
    .sort((a, b) => (a.night < b.night ? -1 : 1));
  let commit = null;
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    /* not a checkout → commit null with commitReason */
  }
  const popAfter = snapshotNights(dir);
  const popStability = populationVerdict(popBefore, popAfter, { commit, tool: 'tools/tch-firmware-reference.mjs', evidence: ['tools/tch-firmware-reference.mjs'] });
  /* The intersection narrows the FIGURE. A night that arrived mid-run is not scored into a
     population it was absent from at the start, and one that left is not counted as present. The
     ledger may hold rows for either, which is why the filter is by name against the intersection
     rather than by what `seen` contains. */
  if (popStability.status !== 'PASS') console.error(`population: ${popStability.reason}`);
  if (popStability.status === 'SHORTFALL') {
    const keep = new Set(intersectSnapshots(popBefore, popAfter).nights);
    const dropped = rows.filter((r) => !keep.has(r.night)).map((r) => r.night);
    rows = rows.filter((r) => keep.has(r.night));
    if (dropped.length) console.error(`population: ${dropped.length} row(s) left out of every figure: ${dropped.join(', ')}`);
  }
  const solidSpec = arg('--solid');
  const solid = parseSolidSpec(solidSpec, { dir, nights: rows.map((r) => r.night) });
  if (solidSpec && !solid.parsed) {
    console.error('--solid: ' + solid.reason);
    return 2;
  }
  const P = pool(rows);
  const pops = selectPopulations(rows, solid);
  const verdicts = pops.map((p) => verdictObject(pool(p.rows), p.rows, { roots: [dir], commit, axis, referenceAxis: refAxis, gate: p.gate, population: p.name, listed: p.listed, notRun: p.notRun }));
  /* The ALL population stays at the top level, byte-shape unchanged for every existing reader
     (`tepna-tchref-nightly.service` writes this object straight to its verdict file); the two new
     populations ride beside it in `verdicts`. */
  const verdict = verdicts[0];
  if (argv.includes('--json'))
    console.log(
      JSON.stringify(
        {
          ...verdict,
          verdicts,
          detail: {
            axis,
            referenceAxis: refAxis,
            solid,
            populationStability: popStability,
            populations: pops.map((p) => ({ name: p.name, label: p.label, nights: p.rows.length, listed: p.listed })),
            pooled: P,
            nights: rows
          }
        },
        null,
        1
      )
    );
  else {
    const f = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
    console.log(`HR three-cornered hat vs the two-detector reference — ${P.nights} night(s) scored of ${rows.length} · axis ${axis} · reference axis ${refAxis}`);
    for (const k of KEYS) {
      const M = P.medians[k];
      console.log(
        `  ${k.padEnd(7)} true σ ${f(M.trueSd)} · classic hat ${f(M.classic)} · correlated (LOO ρ) ${f(M.correlated)} · bias ${f(M.bias)} bpm${k === 'h10' ? '   (reported, not judged)' : ''}`
      );
    }
    console.log(`  ρ of errors vs reference: HV ${f(P.medians.rho.hv)} · HO ${f(P.medians.rho.ho)} · VO ${f(P.medians.rho.vo)}`);
    console.log(
      `  classic ${P.classic.pass}/${P.classic.total} · correlated ${P.correlated.pass}/${P.correlated.total} (refused ${P.correlated.refused}) within ±${BAND_ABS} bpm or ±${BAND_REL * 100} %`
    );
    for (const v of verdicts)
      console.log(
        `  ${v.population.name.padEnd(9)} ${v.status.padEnd(13)} checked ${v.population.checked}/${v.population.eligible}` +
          (v.population.first ? ` · ${v.population.first} → ${v.population.last}` : '') +
          (v.population.listed == null ? '' : ` · ${v.population.listed} listed`)
      );
    printVerdict(verdict);
  }
  return 0;
}

if (isCliEntry(import.meta.url)) main(process.argv.slice(2)).then((c) => process.exit(c));
