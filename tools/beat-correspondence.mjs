#!/usr/bin/env node
/*
 * tools/beat-correspondence.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE BEAT-CORRESPONDENCE AUDIT — the measurement `papers/dead-ends.html` §2.7 names as outstanding:
 *   "matching beat counts to 0.02 % refutes net dropout but not local insertion/deletion pairs,
 *    which preserve the total while scrambling which foot belongs to which beat."
 *
 * The formal object is the VICTOR–PURPURA edit distance on point processes (Victor & Purpura 1996,
 * doi:10.1152/jn.1996.76.2.1310; INTERDISCIPLINARY-LITERATURE §13h.2): transform train A into train B
 * at minimum cost — delete a beat (cost 1), insert a beat (cost 1), or shift a beat by Δt (cost q·|Δt|).
 * 2/q is the timescale at which shifting costs as much as delete+insert: the explicit form of the
 * "same beat moved, or a different beat?" boundary every matching window leaves implicit. The dynamic
 * programme returns the ALIGNMENT, not just a score — which beats pair, which are insertions, which
 * deletions — i.e. the audit itself.
 *
 * WHY THIS IS NOT AN UNWRAP. §4's GNSS cycle-slip line was closed as not-owed because the unwrap was
 * the wrong construction (a wrong multiple rides a cumulative sum all night — JOINT-UNWRAP measured
 * it). An edit-distance alignment never unwraps: there is no cumulative phase, only pairings, so one
 * bad region costs its own indels and cannot poison the rest of the night.
 *
 * BANDED, AND THE BAND EDGE IS A REFUSAL. Full DP over two ~30k-beat trains is ~10⁹ cells. With the
 * §2-RESULT-IV integer-lag anchor the true alignment stays near one diagonal, so the DP runs in a
 * Sakoe–Chiba band around it (Sakoe & Chiba 1978 — already in the diagnosis §3.4). ⚠️ If the optimal
 * path TOUCHES the band boundary the answer is the band, not the data — the same lesson as
 * CROSS-DEVICE-DRIFT §4's "a result piled against a window edge is the window" — so edge contact
 * returns ok:false rather than a number. Planted-truth test: a shift beyond the band REFUSES rather
 * than reporting a wrong alignment.
 *
 * ⚠️ WHAT THIS MUST NEVER BE USED FOR (diagnosis §3.4, verbatim): an association method quantifies
 * AMBIGUITY; it must never be used to FORCE a coupling result. This tool counts indel pairs under an
 * anchor established independently (interval-sequence NCC); it does not certify PAT.
 *
 * Usage:
 *   node tools/beat-correspondence.mjs --selftest
 *   node tools/beat-correspondence.mjs <night-dir> [--q 1/150] [--band 48]
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DexBuild = createRequire(import.meta.url)(join(ROOT, 'tools', 'build-core.js'));

/* ── PURE CORE ──────────────────────────────────────────────────────────────────────────────── */

/* Integer beat-index anchor by normalised cross-correlation of INTERVAL sequences — §2-RESULT-IV's
   method, reimplemented pure so the gate can drive it. Intervals, not times: an RR sequence is
   aperiodic where a beat train is not ([[beat-trains-align-only-mod-rr]]), so the NCC peak is unique
   where a time comb is one tooth among many. `margin` (best − second-best, excluding neighbours of
   the best) is the identifiability measure; the caller decides what margin is enough — RESULT-IV's
   two identifiable nights sit at 0.196–0.223 against ≤0.036 for the 24 unidentifiable ones. */
export function nccAnchor(intervalsA, intervalsB, maxLag) {
  const a = intervalsA,
    b = intervalsB;
  if (!a || !b || a.length < 32 || b.length < 32) return { ok: false, reason: 'too-few-intervals' };
  const L = Math.min(maxLag || 400, Math.max(a.length, b.length) - 16);
  let best = { lag: 0, ncc: -2 },
    second = -2;
  for (let lag = -L; lag <= L; lag++) {
    let n = 0,
      sa = 0,
      sb = 0,
      saa = 0,
      sbb = 0,
      sab = 0;
    const lo = Math.max(0, -lag),
      hi = Math.min(a.length, b.length - lag);
    if (hi - lo < 32) continue;
    for (let i = lo; i < hi; i++) {
      const x = a[i],
        y = b[i + lag];
      n++;
      sa += x;
      sb += y;
      saa += x * x;
      sbb += y * y;
      sab += x * y;
    }
    const cov = sab - (sa * sb) / n,
      va = saa - (sa * sa) / n,
      vb = sbb - (sb * sb) / n;
    const ncc = va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : -2;
    if (ncc > best.ncc) {
      if (Math.abs(best.lag - lag) > 2) second = Math.max(second, best.ncc);
      best = { lag, ncc };
    } else if (ncc > second && Math.abs(lag - best.lag) > 2) second = ncc;
  }
  if (best.ncc <= -2) return { ok: false, reason: 'no-overlap' };
  return { ok: true, lag: best.lag, ncc: best.ncc, margin: best.ncc - second };
}

/* Victor–Purpura alignment inside a Sakoe–Chiba band around a seed diagonal.
   timesA/timesB in ms, sorted ascending. `lag` in BEAT INDEX (from nccAnchor); `offsetMs` the time
   offset to remove before matching (median of tB[i+lag] − tA[i], computed by the caller or here).
   `q` in 1/ms: match cost q·|Δt|, indel cost 1, so a shift beyond 2/q ms is dearer than delete+insert.
   Returns ok:false with a reason instead of a number when the answer would be the band, not the data. */
export function vpAlign(timesA, timesB, opts) {
  const o = opts || {};
  const q = o.q > 0 ? o.q : 1 / 150; // default: 2/q = 300 ms — well past honest beat scatter, inside one RR
  const band = o.band > 0 ? o.band | 0 : 48;
  const lag = Number.isFinite(o.lag) ? o.lag | 0 : 0;
  const nA = timesA ? timesA.length : 0,
    nB = timesB ? timesB.length : 0;
  if (nA < 2 || nB < 2) return { ok: false, reason: 'too-few-beats', nA, nB };

  /* Offset: remove the constant clock/transit offset so q acts on RESIDUAL Δt, not on the clock.
     ⚠️ NEAREST-NEIGHBOUR, NOT INDEX-PAIRED — this was a measured bug, not a style choice. The first
     version took the median of tB[i+lag] − tA[i], and a SINGLE planted insertion shifted every
     subsequent index pairing by one whole beat: 90 % of the sampled deltas landed one RR off, the
     median picked that wrong population, and the DP recovered by inventing a spurious delete+insert
     pair (planted 1 insertion → reported d=1, i=2). The estimator was poisoned by exactly the indels
     the tool exists to count. Nearest-neighbour deltas ignore indices entirely: every surviving beat's
     nearest partner sits at the true offset, and indel victims are a minority the median rejects.
     Mod-RR caveat, stated: this identifies the offset only within ±RR/2 of zero — which holds for the
     ECG↔PPG transit this audits (PAT ≪ RR/2) and is the same limit [[beat-trains-align-only-mod-rr]]
     records; the beat-INDEX ambiguity is nccAnchor's job, not this estimator's. */
  let offsetMs = o.offsetMs;
  if (!Number.isFinite(offsetMs)) {
    const d = [];
    const step = Math.max(1, (nA / 512) | 0 || 1);
    for (let i = 0; i < nA; i += step) {
      const x = timesA[i];
      let lo = 0,
        hi = nB - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (timesB[mid] < x) lo = mid + 1;
        else hi = mid;
      }
      const cand = lo > 0 && Math.abs(timesB[lo - 1] - x) < Math.abs(timesB[lo] - x) ? timesB[lo - 1] : timesB[lo];
      d.push(cand - x);
    }
    d.sort((x, y) => x - y);
    if (!d.length) return { ok: false, reason: 'no-overlap' };
    offsetMs = d[d.length >> 1];
  }

  /* Banded DP. Rows = A (i), columns constrained to j ∈ [i + lag − band, i + lag + band].
     moves: 1 = match (diag), 2 = delete A (up), 3 = insert B (left). */
  const W = 2 * band + 1;
  const INF = Infinity;
  let prev = new Float64Array(W).fill(INF),
    cur = new Float64Array(W);
  const moves = new Uint8Array((nA + 1) * W);
  const jOf = (i, k) => i + lag - band + k;
  // row 0: aligning nothing of A against j beats of B = j insertions (only where the band allows)
  for (let k = 0; k < W; k++) {
    const j = jOf(0, k);
    prev[k] = j >= 0 && j <= nB ? j : INF;
  }
  for (let i = 1; i <= nA; i++) {
    cur.fill(INF);
    for (let k = 0; k < W; k++) {
      const j = jOf(i, k);
      if (j < 0 || j > nB) continue;
      let bestC = INF,
        mv = 0;
      // delete A[i-1]: from (i-1, j) — same j, band index shifts by −1 going down a row
      if (k + 1 < W && prev[k + 1] !== INF && prev[k + 1] + 1 < bestC) {
        bestC = prev[k + 1] + 1;
        mv = 2;
      }
      // insert B[j-1]: from (i, j-1)
      if (k - 1 >= 0 && cur[k - 1] !== INF && cur[k - 1] + 1 < bestC) {
        bestC = cur[k - 1] + 1;
        mv = 3;
      }
      // match A[i-1] with B[j-1]: from (i-1, j-1) — same k in the previous row
      if (j >= 1 && prev[k] !== INF) {
        const c = prev[k] + q * Math.abs(timesB[j - 1] - offsetMs - timesA[i - 1]);
        if (c < bestC) {
          bestC = c;
          mv = 1;
        }
      }
      cur[k] = bestC;
      moves[i * W + k] = mv;
    }
    [prev, cur] = [cur, prev];
  }
  const endK = nB - (nA + lag) + band;
  if (endK < 0 || endK >= W) return { ok: false, reason: 'end-outside-band', nA, nB, lag, band };
  const distance = prev[endK];
  if (!Number.isFinite(distance)) return { ok: false, reason: 'no-path-in-band', nA, nB, lag, band };

  // Traceback: count pairings and indels, and record whether the path ever TOUCHES the band edge.
  let i = nA,
    k = endK,
    matched = 0,
    delA = 0,
    insB = 0,
    edgeContact = false,
    sumAbsDt = 0,
    maxAbsDt = 0;
  let kMin = endK,
    kMax = endK,
    firstContactI = null;
  while (i > 0 || jOf(i, k) > 0) {
    if (k < kMin) kMin = k;
    if (k > kMax) kMax = k;
    if (k === 0 || k === W - 1) {
      edgeContact = true;
      if (firstContactI === null) firstContactI = i;
    }
    const mv = i > 0 ? moves[i * W + k] : 3;
    if (mv === 1) {
      const j = jOf(i, k);
      const dt = Math.abs(timesB[j - 1] - offsetMs - timesA[i - 1]);
      sumAbsDt += dt;
      if (dt > maxAbsDt) maxAbsDt = dt;
      matched++;
      i--; // k unchanged: diagonal keeps the same band index
    } else if (mv === 2) {
      delA++;
      i--;
      k++;
    } else {
      insB++;
      k--;
      if (i === 0 && jOf(i, k) < 0) break;
    }
  }
  /* Edge contact ⇒ the optimum was CONSTRAINED, so the counts describe the band. Refuse — same rule
     as hostAxis's implausible-rate bound: when the input cannot be trusted the answer is "no answer",
     not a confident wrong one. */
  if (edgeContact) return { ok: false, reason: 'alignment-touches-band-edge — widen --band or fix the anchor', nA, nB, lag, band, kMin, kMax, firstContactI };
  return {
    ok: true,
    q,
    twoOverQMs: 2 / q,
    band,
    lag,
    offsetMs,
    nA,
    nB,
    matched,
    deletionsA: delA,
    insertionsB: insB,
    indelRate: (delA + insB) / (nA + nB),
    meanAbsDtMs: matched ? sumAbsDt / matched : null,
    maxAbsDtMs: matched ? maxAbsDt : null,
    distance
  };
}

/* ── selftest: PLANTED TRUTH, not plausibility ──────────────────────────────────────────────── */
function selftest() {
  let seed = 424242;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647; // MINSTD — same series in any lane
    return seed / 2147483647 - 0.5;
  };
  let fails = 0;
  const say = (ok, msg) => {
    if (!ok) fails++;
    console.log((ok ? 'PASS ' : 'FAIL ') + msg);
  };

  // A realistic beat train: ~1000 ms RR with HRV.
  const A = [];
  let t = 0;
  for (let i = 0; i < 3000; i++) {
    t += 1000 + 120 * rnd();
    A.push(t);
  }

  // (1) IDENTITY + jitter: everything matches, zero indels.
  const B1 = A.map((x) => x + 40 + 20 * rnd());
  let r = vpAlign(A, B1, { q: 1 / 150, band: 32 });
  say(r.ok === true && r.deletionsA === 0 && r.insertionsB === 0 && r.matched === 3000, `jittered identity: all matched, 0 indels (got m=${r.matched} d=${r.deletionsA} i=${r.insertionsB})`);

  // (2) PLANTED INDELS — the audit case. Delete 7 beats from B, insert 4 spurious ones.
  const B2 = A.map((x) => x + 40 + 20 * rnd());
  const delIdx = [200, 500, 900, 1400, 1900, 2300, 2800];
  for (let d = delIdx.length - 1; d >= 0; d--) B2.splice(delIdx[d], 1);
  const insAt = [300, 1100, 1700, 2500];
  for (const j of insAt) B2.splice(j, 0, (B2[j - 1] + B2[j]) / 2 + 100 * rnd());
  B2.sort((x, y) => x - y);
  r = vpAlign(A, B2, { q: 1 / 150, band: 32 });
  say(r.ok === true && r.deletionsA === 7 && r.insertionsB === 4, `planted 7 deletions + 4 insertions recovered exactly (got d=${r.deletionsA} i=${r.insertionsB})`);
  say(r.ok === true && r.matched === 3000 - 7, `matched count is n − deletions (got ${r.matched})`);

  // (3) BEAT-INDEX LAG: B starts 25 beats in. nccAnchor finds it; vpAlign under it is clean.
  const B3 = A.slice(25).map((x) => x + 40 + 15 * rnd());
  const rrA = A.slice(1).map((x, i) => x - A[i]);
  const rrB3 = B3.slice(1).map((x, i) => x - B3[i]);
  const an = nccAnchor(rrA, rrB3, 200);
  say(an.ok === true && an.lag === -25, `nccAnchor recovers a planted −25-beat lag (got ${an.lag}, ncc ${an.ncc && an.ncc.toFixed(3)})`);
  r = vpAlign(A, B3, { q: 1 / 150, band: 32, lag: an.lag });
  say(r.ok === true && r.deletionsA === 25 && r.insertionsB === 0, `under that anchor: the 25 unpaired leading beats are DELETIONS, not noise (got d=${r.deletionsA} i=${r.insertionsB})`);

  // (4) THE BAND EDGE REFUSES — a lag past the band must not return a confident wrong alignment.
  r = vpAlign(A, B3, { q: 1 / 150, band: 8, lag: 0 });
  say(r.ok === false, `a 25-beat lag against an 8-beat band REFUSES (${r.reason || 'no reason'}) rather than reporting`);

  /* (5) q IS LOAD-BEARING, shown at its extremes — and the first version of this test expected the
     wrong thing at the top end, which is worth keeping visible. q→0: shifting is free, so planted
     indels are ABSORBED as cheap matches — the audit under-counts (11 planted → 3 seen). q→∞ on the
     long train: the all-indel optimum must WALK THE BAND EDGE, so the honest outcome is the REFUSAL,
     not a count — asserting `matched === 0` there was asserting a number the band forbids reporting.
     On a short train with a full-width band the all-indel path is unconstrained and matched IS 0. */
  const rLo = vpAlign(A, B2, { q: 1e-9, band: 32 });
  say(rLo.ok === true && rLo.deletionsA + rLo.insertionsB < 11, `q→0 ABSORBS planted indels — the audit under-counts (11 planted, ${rLo.deletionsA + rLo.insertionsB} seen)`);
  const rHiLong = vpAlign(A, B2, { q: 10, band: 32 });
  say(rHiLong.ok === false, `q→∞ on the long train REFUSES (all-indel path needs the band edge): ${rHiLong.reason || 'no reason'}`);
  const As = A.slice(0, 60),
    Bs = B1.slice(0, 60);
  /* Two wrong expectations preceded this line, each corrected by the code being right:
     q=10 matched five beats — their residuals sat under 2/q = 0.2 ms, exactly as the cost model says.
     q=1e6 still matched ONE — the estimated offset is the MEDIAN of sampled deltas, so one beat's
     residual is exactly 0 by construction, and 0 beats any q. "Every beat is an indel" is reachable
     only with an offset the data did not choose: */
  const rHi = vpAlign(As, Bs, { q: 1e6, band: 70, offsetMs: 0 });
  say(
    rHi.ok === true && rHi.matched === 0 && rHi.deletionsA === 60 && rHi.insertionsB === 60,
    `q→∞ with an unconstraining band: every beat is an indel (m=${rHi.matched} d=${rHi.deletionsA} i=${rHi.insertionsB})`
  );

  // (6) refusal on degenerate input.
  say(vpAlign([], [], {}).ok === false && vpAlign([1], [1], {}).ok === false, 'degenerate trains refuse');
  say(nccAnchor([1, 2], [1, 2], 10).ok === false, 'nccAnchor refuses under 32 intervals');

  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
}

/* ── the real corpus run ────────────────────────────────────────────────────────────────────── */
let ECGDSP, PPGDSP;
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
  for (const [n, v] of Object.entries({ ECGDSP, PPGDSP })) if (!v) throw new Error('beat-correspondence: ' + n + ' did not load');
}

function ecgRpeakTimes(text) {
  const rec = ECGDSP.parseECG(text);
  if (rec.t0Ms == null) throw new Error('ECG file carried no phone timestamp.');
  const bp = ECGDSP.bandpass(rec.int16, rec.fs);
  const peaks = ECGDSP.detectPeaks(rec.int16, bp, rec.fs);
  const t = new Float64Array(peaks.length);
  for (let i = 0; i < peaks.length; i++) t[i] = rec.t0Ms + (peaks[i] / rec.fs) * 1000;
  return t;
}
function ppgFootTimes(text) {
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
  /* Per-ELEMENT guard on relSec, copied from pat-matchrate-strict verbatim — the array can exist with
     non-finite entries, and an array-level truthiness check propagates NaN into every downstream time. */
  const rel = rec.relSec,
    fs = rec.fs,
    t0 = rec.t0Ms;
  const t = new Float64Array(cons.feet.length);
  for (let i = 0; i < cons.feet.length; i++) {
    const idx = cons.feet[i];
    const sec = rel && rel[idx] != null && isFinite(rel[idx]) ? rel[idx] : idx / fs;
    t[i] = t0 + sec * 1000;
  }
  return t;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) return selftest();
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) {
    console.error('usage: node tools/beat-correspondence.mjs <night-dir> [--q 1/150] [--band 48] | --selftest');
    process.exit(2);
  }
  const getOpt = (name, dflt) => {
    const i = args.indexOf(name);
    if (i < 0) return dflt;
    const v = args[i + 1];
    return v.includes('/') ? Number(v.split('/')[0]) / Number(v.split('/')[1]) : Number(v);
  };
  const q = getOpt('--q', 1 / 150),
    band = getOpt('--band', 48);
  loadDsps();
  const files = readdirSync(dir);
  const ecgF = files.filter((f) => /_ECG\.txt$/.test(f) && /H10/.test(f)).sort();
  const ppgF = files.filter((f) => /_PPG\.txt$/.test(f) && /Sense|Verity/.test(f) && !/\(1\)/.test(f)).sort();
  if (!ecgF.length || !ppgF.length) {
    console.error(`no H10 _ECG / Verity _PPG pair in ${dir}`);
    process.exit(2);
  }
  console.log(`ECG: ${ecgF[0]}   PPG: ${ppgF[0]}   q=${q.toExponential(3)} (2/q=${(2 / q).toFixed(0)} ms)  band=±${band}`);
  const tA = Array.from(ecgRpeakTimes(readFileSync(join(dir, ecgF[0]), 'utf8')));
  const tB = Array.from(ppgFootTimes(readFileSync(join(dir, ppgF[0]), 'utf8')));
  const rrA = tA.slice(1).map((x, i) => x - tA[i]),
    rrB = tB.slice(1).map((x, i) => x - tB[i]);
  console.log(
    `extracted: ECG ${tA.length} R-peaks (${((tA[tA.length - 1] - tA[0]) / 60000).toFixed(0)} min)   PPG ${tB.length} feet (${((tB[tB.length - 1] - tB[0]) / 60000).toFixed(0)} min)   t0 delta ${((tB[0] - tA[0]) / 1000).toFixed(1)} s`
  );
  const an = nccAnchor(rrA, rrB, 400);
  console.log(`anchor: ${an.ok ? `lag ${an.lag} beats, ncc ${an.ncc.toFixed(4)}, margin ${an.margin.toFixed(4)}` : 'REFUSED — ' + an.reason}`);
  if (!an.ok) process.exit(1);

  /* THE MOD-RR PLANE IS AN INTEGER AMBIGUITY, RESOLVED THE §4 WAY — sweep the candidates, score each,
     and the margin between best and second-best is the ratio test. On a phone capture there is no
     shared clock ([[wearable-clocks-diverge]]): the absolute inter-train offset is unknowable, only
     its value mod one RR ([[beat-trains-align-only-mod-rr]]). A nearest-neighbour offset therefore
     lands on SOME plane — measured on 2026-07-12 it chose 44.6 ms where the physiological transit is
     ~400+, i.e. it paired each R-peak with the PREVIOUS cycle's foot; on that plane the residual
     absorbs HRV-scale variance and the audit manufactures indels. The VP distance itself is the
     principled per-plane cost: run the alignment once per candidate plane (base + k·medianRR), take
     the minimum, and report the margin so an ambiguous night REFUSES rather than picking silently. */
  const medRR = [...rrA].sort((x, y) => x - y)[rrA.length >> 1];
  const probe = vpAlign(tA, tB, { q, band, lag: an.lag });
  const baseOff = probe.ok ? probe.offsetMs : Number.isFinite(probe.offsetMs) ? probe.offsetMs : 0;
  const planes = [];
  for (let k = -2; k <= 2; k++) {
    const r = vpAlign(tA, tB, { q, band, lag: an.lag, offsetMs: baseOff + k * medRR });
    planes.push({ k, off: baseOff + k * medRR, r });
    console.log(
      `  plane k=${String(k).padStart(2)}  offset ${(baseOff + k * medRR).toFixed(1).padStart(9)} ms  ` +
        (r.ok ? `VP ${r.distance.toFixed(0).padStart(7)}  indels ${r.deletionsA + r.insertionsB}  mean|Δt| ${r.meanAbsDtMs.toFixed(0)} ms` : `REFUSED ${r.reason}`)
    );
  }
  const okP = planes.filter((p) => p.r.ok).sort((a, b) => a.r.distance - b.r.distance);
  if (!okP.length) {
    const p0 = planes[2].r;
    console.log(`ALL PLANES REFUSED` + (p0.kMin != null ? `  [k ${p0.kMin}..${p0.kMax} of 0..${2 * p0.band}, first contact i=${p0.firstContactI}]` : ''));
    process.exit(1);
  }
  const bestP = okP[0],
    marginP = okP.length > 1 ? (okP[1].r.distance - bestP.r.distance) / bestP.r.distance : Infinity;
  console.log(`plane picked: k=${bestP.k} (margin over next: ${(100 * marginP).toFixed(1)} %${okP.length < 2 ? ', others refused' : ''})`);
  const r = bestP.r;
  console.log(`beats  ECG ${r.nA}  PPG ${r.nB}   offset ${r.offsetMs.toFixed(1)} ms`);
  console.log(`matched ${r.matched}   deletions(ECG-only) ${r.deletionsA}   insertions(PPG-only) ${r.insertionsB}   indel rate ${(100 * r.indelRate).toFixed(2)} %`);
  console.log(`residual |Δt|: mean ${r.meanAbsDtMs.toFixed(1)} ms   max ${r.maxAbsDtMs.toFixed(1)} ms   VP distance ${r.distance.toFixed(1)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
