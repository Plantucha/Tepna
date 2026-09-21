#!/usr/bin/env node
/*
 * tools/oracle-ecg-firmware-rr.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE ORACLE HARNESS, ECG LEG — Tepna's Pan–Tompkins against an INDEPENDENT detector on real H10 nights
 *
 * Runs MEASUREMENT-PROVENANCE-ROADMAP §5's first target over the real corpus: every H10 night that
 * carries both `_ECG.txt` and `_RR.txt` is scored as ECGDex's own R-peak train (sub-sample-refined
 * Pan–Tompkins, Malik-corrected NN) against the strap FIRMWARE's RR train — Polar's detector, run in
 * the strap on the same lead — paired beat by beat, with HR/RR agreement, rMSSD and SDNN on the two
 * trains, and every band stated below BEFORE the first night was read.
 *
 * ── THE REFERENCE IS THE FIRMWARE, AND WHY THAT IS THE RIGHT ONE ─────────────────────────────────
 * §5 names "WFDB/PhysioNet tooling, NeuroKit2-class algorithms" as candidate references and asks for
 * quarantine (a dev-dependency, pinned, a SOUP note, never in a bundle). This harness needs none of
 * that: the corpus ALREADY carries a second, independent implementation of QRS detection on every
 * night — the strap's own firmware — and it is the one that matters for this hardware, because it saw
 * the same 130 Hz single lead the shipped detector sees. MIT-BIH answers a different question
 * (`tools/ecg-physionet-differential.mjs`: do we find the beats experts marked on 360 Hz tape) and is
 * already built. Zero runtime SOUP, zero new dev-deps; the quarantine is satisfied by construction.
 *
 * ── PLACEMENT ──────────────────────────────────────────────────────────────────────────────────
 * §5 says `tools/oracle/`. Both tool gates (`tools/selftest-all.mjs` and `tools/tools-index.mjs`) read
 * `tools/` NON-recursively, so a subdirectory would put this harness outside every gate — the
 * examined-nothing shape in the instrument built to catch it. It lives at the top level with an
 * `oracle-` prefix instead, and imports nothing a bundle could reach.
 *
 * ── MACHINE-PRINTED, EVERY RUN (§5's own rule) ─────────────────────────────────────────────────
 *   A REFERENCE IS A REFERENCE, NOT GROUND TRUTH. Disagreement opens an investigation, never an
 *   auto-fix. Agreement between two algorithms proves nothing physiological — both can be wrong the
 *   same way, and on this lead they share the signal, the electrode and the night.
 *
 * ── WHAT IS DELIBERATELY NOT COMPARED (the kind-instrument rule) ────────────────────────────────
 * ECGDex REFUSES artifact spans and pins rails; the firmware does not. Those are features, not
 * disagreements, and forcing a beat-for-beat comparison across them would score the refusal as a
 * miss. So the pairing is INDEX alignment on the interval trains (`ECGDSP.alignFirmwareRR`), which
 * re-fits its offset per window and REPORTS where the pairing decays instead of averaging over it;
 * the per-beat statistics below are taken over the alignment's own stable range. The `_RR.txt` axis
 * is arrival-stamped (BLE batching), so a time-window pairing is not available and is not faked.
 *
 * ── PRE-STATED BANDS — registered before the first run; do not move them after seeing a number ──
 * Per night, then POOLED as the median across nights with n beside it. One sample at 130 Hz is 7.7 ms.
 *
 *   BEAT COUNT     |nSelf − nDev| / nDev
 *                    ≤ 1 %      CONSISTENT — the two detectors see the same beats
 *                    1–3 %      SHORTFALL   — one side drops or adds beats; report which night
 *                    > 3 %      INVESTIGATE — not the same recording, or a detector failing on it
 *   PER-BEAT RR    median |self − firmware| over the stable range
 *                    ≤ 8 ms     CONSISTENT — within one sample of each other
 *                    8–20 ms    SHORTFALL
 *                    > 20 ms    INVESTIGATE
 *   RR LoA         95 % limits of agreement half-width (1.96·SD of paired differences, stable range)
 *                    ≤ 30 ms    CONSISTENT;  30–60 SHORTFALL;  > 60 INVESTIGATE
 *   MEAN RR        |dMean| ≤ 1 %  CONSISTENT;  1–3 % SHORTFALL;  > 3 % INVESTIGATE
 *   rMSSD          |dRMSSD| ≤ 10 % CONSISTENT; 10–25 % SHORTFALL; > 25 % INVESTIGATE
 *   SDNN           |dSDNN|  ≤ 5 %  CONSISTENT;  5–15 % SHORTFALL; > 15 % INVESTIGATE
 *   PAIRING DECAY  `alignFirmwareRR.pairingDecays` — COUNTED and LISTED, never banded: a night whose
 *                  pairing decays is the "disagreement opens an investigation" case by definition.
 *
 *   POOLED VERDICT per statistic = the band of the across-night MEDIAN, quoted with n nights and total
 *   beats. A night in INVESTIGATE is listed by name. Fewer than 10 scored nights ⇒ the pooled line
 *   prints UNDERPOWERED and no verdict. This tool ships no DSP change; a SHORTFALL or worse is a
 *   finding for a SEPARATE PR.
 *
 * ── PPG LEG ────────────────────────────────────────────────────────────────────────────────────
 * §5 also names PPG pulse detection on Verity nights. The Verity's `_PPI.txt` is the analogous
 * firmware train and CLAUDE.md records it as often header-only; this run reports its COVERAGE
 * (nights with ≥ 300 PPI rows) and compares nothing — the PPG comparison is its own unit, sized from
 * that count. Reported as coverage, not as a result.
 *
 * ── KNOWN LIMIT OF THE PAIRING, found on the first corpus run (2026-09-21) ────────────────────────
 * Per-beat agreement is BIMODAL over 52 nights: ~20 pair within a sample (median |Δ| ≈ 1 ms) and the
 * rest sit at 30–50 ms — not two detectors disagreeing by 5 samples, but the INDEX alignment losing
 * the train. The firmware RR file spans the whole BLE connection while ECGDex's NN covers the accepted
 * stretch, so on 45 of 52 nights the firmware has MORE beats (up to +34 %), often as bursts where
 * ECGDex refused; `alignFirmwareRR` re-fits its offset within ±60 beats per decile, and a burst wider
 * than that is unrecoverable for the rest of the night. `pairingDecays` does NOT flag it (a uniformly
 * wrong pairing is not a decaying one). So: read rMSSD / mean-RR (whole-train, pairing-free) as the
 * detector comparison; read the per-beat lines as "paired within a sample on N nights" and treat the
 * remainder as UNPAIRED, not disagreeing. The instrument that fixes this is a time-anchored pairing —
 * cumulate the firmware RR into a device axis, re-anchor it on the arrival stamps every few hundred
 * beats, and pair by tolerance window — which is the pairing §5 asked for and the next unit.
 *
 * ── TIME-ANCHORED PAIRING (added 2026-09-21, AFTER the index-alignment run and BEFORE its own first run) ──
 * The pairing §5 literally asks for. The firmware RR is CUMULATED into a device axis; per window of
 * 300 beats the axis is anchored to host time by the LOWER ENVELOPE (5th percentile) of
 * `arrival − cumulative` — arrival is never earlier than the beat, so the envelope is the minimum
 * delivery delay, and per-window fitting absorbs drift and any stretch the firmware did not deliver
 * (`anchorJumps` counts windows whose anchor moved > 2 s from the previous one). Beats are then paired
 * ONE-TO-ONE, nearest neighbour within ±150 ms; a firmware beat outside ECGDex's accepted coverage
 * (a gap > 3 s in its own beat train) is `outsideCoverage`, never a miss — the kind-instrument rule.
 *
 *   PRE-STATED BANDS (time pairing)
 *   MATCHED SELF      share of ECGDex beats with a firmware beat within the window
 *                       ≥ 97 %  CONSISTENT;  90–97 % SHORTFALL;  < 90 % INVESTIGATE
 *   MATCHED FIRMWARE  share of firmware beats INSIDE ECGDex coverage that pair
 *                       ≥ 97 %  CONSISTENT;  90–97 % SHORTFALL;  < 90 % INVESTIGATE
 *   RR ON PAIRS       self NN vs firmware RR on consecutively-matched pairs — the SAME bands as the
 *                     index pairing above (median |Δ| ≤ 8/20 ms; LoA ≤ 30/60 ms)
 *   ANCHOR JUMPS      counted and listed, not banded.
 *   STREAM LATENCY    the firmware RR stream is delivered a CONSTANT ~2.7 s after the beat (measured
 *                     2026-07-24: p5–p95 spread 226 ms around it), which no arrival envelope can see
 *                     because every row carries it. It is recovered per night by COINCIDENCE SEARCH —
 *                     the lag in [−6, +6] s (10 ms steps) that maximises ±tol coincidences between the
 *                     two point processes — which does not use the index alignment and is robust to
 *                     surplus beats. Reported as `latencyMs`; a night whose best lag sits at the search
 *                     edge is REFUSED for the time leg (the answer would be the window).
 *   Pooled verdict = band of the across-night median, n beside it, ≥ 10 nights.
 *   ⚠️ ±150 ms and 300-beat windows are CHOICES, stated here; `--tol` / `--anchor-window` re-run them and
 *   a result that moves materially with them is reported as such, not as a finding about the detectors.
 *
 * ── NO FETCHING; ABSENCE IS A SKIP ─────────────────────────────────────────────────────────────
 * Never downloads. No nights ⇒ SKIP printing the roots searched, no metrics. P5 gates PUBLICATION
 * of benchmark numbers, not measurement (owner 2026-09-12): run it, act on it, do not quote it out.
 *
 *   node tools/oracle-ecg-firmware-rr.mjs --selftest
 *   node tools/oracle-ecg-firmware-rr.mjs [--root <captures root>] [--min-beats 3600] [--limit N] [--tol 150] [--anchor-window 300] [--json]
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOTS = ['/srv/data/tepna-corpus/smoketest-captures', join(HERE, '..', 'uploads', 'captures')];
const SAMPLE_MS_130 = 1000 / 130;

export const BANDS = {
  matchedPct: [97, 90],
  beatCountPct: [1, 3],
  medianAbsMs: [8, 20],
  loaMs: [30, 60],
  dMeanPct: [1, 3],
  dRMSSDPct: [10, 25],
  dSDNNPct: [5, 15],
  minNights: 10
};

export function band(key, v) {
  if (v == null || !Number.isFinite(v)) return 'n/a';
  const [a, b] = BANDS[key];
  if (a > b) return v >= a ? 'CONSISTENT' : v >= b ? 'SHORTFALL' : 'INVESTIGATE'; // higher-is-better keys
  return v <= a ? 'CONSISTENT' : v <= b ? 'SHORTFALL' : 'INVESTIGATE';
}

/* ── time-anchored pairing ──────────────────────────────────────────────────────────────────── */

/* Firmware beat times on the HOST axis. `dev` = [{tsMs (arrival), rr}] in file order. The device axis is
   the cumulative RR; each window of `winBeats` is anchored by the 5th percentile of arrival − cumulative
   (the minimum delivery delay), and the anchor is applied to that window's beats. Returns
   {timesMs, anchors, anchorJumps}. */
export function firmwareHostTimes(dev, winBeats = 300, jumpMs = 2000) {
  const n = dev.length;
  const cum = new Float64Array(n);
  let c = 0;
  for (let i = 0; i < n; i++) {
    c += dev[i].rr;
    cum[i] = c;
  }
  const timesMs = new Float64Array(n);
  const anchors = [];
  let jumps = 0;
  for (let a = 0; a < n; a += winBeats) {
    const b = Math.min(n, a + winBeats);
    const offs = [];
    for (let i = a; i < b; i++) if (Number.isFinite(dev[i].tsMs)) offs.push(dev[i].tsMs - cum[i]);
    if (!offs.length) continue;
    offs.sort((x, y) => x - y);
    const anchor = offs[Math.floor(0.05 * (offs.length - 1))];
    if (anchors.length && Math.abs(anchor - anchors[anchors.length - 1]) > jumpMs) jumps++;
    anchors.push(anchor);
    for (let i = a; i < b; i++) timesMs[i] = cum[i] + anchor;
  }
  return { timesMs, anchors, anchorJumps: jumps };
}

/* Coverage spans of a beat train: contiguous runs with no gap > gapMs. [[startMs, endMs], …] */
export function coverageSpans(timesMs, gapMs = 3000) {
  const out = [];
  if (!timesMs.length) return out;
  let s = timesMs[0];
  for (let i = 1; i < timesMs.length; i++) {
    if (timesMs[i] - timesMs[i - 1] > gapMs) {
      out.push([s, timesMs[i - 1]]);
      s = timesMs[i];
    }
  }
  out.push([s, timesMs[timesMs.length - 1]]);
  return out;
}

function inSpans(t, spans) {
  for (const [a, b] of spans) if (t >= a && t <= b) return true;
  return false;
}

/* One-to-one nearest-neighbour pairing within ±tolMs between two SORTED time arrays. Greedy in
   |Δ| order over the candidate pairs, so a beat is never claimed twice. Returns {pairs:[[i,j,dMs]],
   unmatchedA, unmatchedB}. */
export function pairByTime(aMs, bMs, tolMs = 150) {
  const cands = [];
  let j = 0;
  for (let i = 0; i < aMs.length; i++) {
    while (j < bMs.length && bMs[j] < aMs[i] - tolMs) j++;
    for (let k = j; k < bMs.length && bMs[k] <= aMs[i] + tolMs; k++) cands.push([Math.abs(bMs[k] - aMs[i]), i, k]);
  }
  cands.sort((x, y) => x[0] - y[0]);
  const usedA = new Uint8Array(aMs.length);
  const usedB = new Uint8Array(bMs.length);
  const pairs = [];
  for (const [d, i, k] of cands) {
    if (usedA[i] || usedB[k]) continue;
    usedA[i] = 1;
    usedB[k] = 1;
    pairs.push([i, k, d]);
  }
  pairs.sort((x, y) => x[0] - y[0]);
  return { pairs, unmatchedA: aMs.length - pairs.length, unmatchedB: bMs.length - pairs.length };
}

/* Coincidence-maximising lag of train B relative to A: the shift s (ms) that maximises the number
   of A beats with a B beat within ±tol at time t_A + s. Coarse-to-fine: 100 ms steps over ±rangeMs,
   then 10 ms steps around the best. Returns {lagMs, coincidences, atEdge}. */
export function coincidenceLag(aMs, bMs, tolMs = 150, rangeMs = 6000) {
  const count = (lag) => {
    let c = 0;
    let j = 0;
    for (let i = 0; i < aMs.length; i++) {
      const t = aMs[i] + lag;
      while (j < bMs.length && bMs[j] < t - tolMs) j++;
      if (j < bMs.length && bMs[j] <= t + tolMs) c++;
    }
    return c;
  };
  /* Coarse scan for the peak AND the background: the count at a wrong lag is chance coincidence
     (~2·tol/RR of the beats), so a real latency shows as a peak well above the scan's median. No peak
     ⇒ REFUSE — a maximum always exists, a lag does not. */
  const coarse = [];
  for (let lag = -rangeMs; lag <= rangeMs; lag += 100) coarse.push([lag, count(lag)]);
  const counts = coarse.map((x) => x[1]).sort((x, y) => x - y);
  const background = counts[Math.floor(counts.length / 2)];
  let bestC = -1;
  for (const [, c] of coarse) if (c > bestC) bestC = c;
  /* The count PLATEAUS over ±tol around the true lag (every lag inside the window matches every
     beat), so the peak is a plateau and its CENTRE is the estimate — the first maximum would be the
     plateau's edge, biased by up to tol. Fine scan across the coarse plateau, then the median of the
     lags that attain the maximum. */
  const plateau = coarse.filter((x) => x[1] === bestC).map((x) => x[0]);
  const lo = Math.min(...plateau) - 100;
  const hi = Math.max(...plateau) + 100;
  let fineBest = -1;
  const fine = [];
  for (let lag = lo; lag <= hi; lag += 10) {
    const c = count(lag);
    fine.push([lag, c]);
    if (c > fineBest) fineBest = c;
  }
  const top = fine.filter((x) => x[1] === fineBest).map((x) => x[0]);
  const lagMs = top[Math.floor(top.length / 2)];
  const peakRatio = background > 0 ? fineBest / background : Number.POSITIVE_INFINITY;
  const atEdge = Math.abs(lagMs) >= rangeMs - 100;
  return { lagMs, coincidences: fineBest, background, peakRatio, atEdge, refused: atEdge || peakRatio < 2 };
}

/* The whole time-pairing leg for one night. selfMs = ECGDex beat times (host ms), selfNN = the NN
   interval ending at each beat, dev = firmware rows. */
export function timePairing(selfMs, selfNN, dev, opts = {}) {
  const tol = opts.tolMs || 150;
  const fw = firmwareHostTimes(dev, opts.anchorWindow || 300);
  /* LATENCY PER WINDOW, not per night. Measured 2026-07-25/26: the stream's delivery lag sits at
     ~2.3–2.7 s for most of a night and STEPS at reconnections (1.3 s, 0.2 s, −1.2 s, +4.6 s windows
     observed), so one lag for the night pairs the majority and mis-pairs the rest. Each window of
     `lagWindow` firmware beats gets its own coincidence search against the self beats near it; a
     window with no peak is UNANCHORED — its beats are excluded from pairing and counted, never
     paired at the night's average. */
  const lagWin = opts.lagWindow || 600;
  const range = opts.lagRangeMs || 6000;
  const selfArr = Array.from(selfMs);
  const fwT = new Float64Array(fw.timesMs.length);
  const anchored = new Uint8Array(fw.timesMs.length);
  const lags = [];
  let unanchoredWindows = 0;
  let windows = 0;
  /* A window that STRADDLES a latency step has two peaks and its "best" lag pairs neither half
     (planted: 2.7 → 1.3 s mid-window lost the whole window). So a window whose best lag captures
     fewer than 70 % of its beats is HALVED and searched again, down to `minLagWindow` beats; only a
     window that cannot be anchored at that size is given up. */
  const minWin = opts.minLagWindow || 150;
  const anchorSpan = (a, b) => {
    const w = Array.from(fw.timesMs.subarray(a, b));
    windows++;
    const lo = w[0] - range - tol;
    const hi = w[w.length - 1] + range + tol;
    const near = selfArr.filter((t) => t >= lo && t <= hi);
    const L = near.length >= 50 ? coincidenceLag(near, w, tol, range) : { refused: true, coincidences: 0 };
    // halve FIRST — a straddling window's two half-peaks read as "no peak" against the chance
    // background, so a refusal at full size is not yet a refusal
    if ((L.refused || L.coincidences < 0.7 * w.length) && b - a >= 2 * minWin) {
      windows--;
      const mid = a + Math.floor((b - a) / 2);
      anchorSpan(a, mid);
      anchorSpan(mid, b);
      return;
    }
    if (L.refused) {
      unanchoredWindows++;
      return;
    }
    lags.push(L.lagMs);
    for (let i = a; i < b; i++) {
      fwT[i] = fw.timesMs[i] - L.lagMs;
      anchored[i] = 1;
    }
  };
  for (let a = 0; a < fw.timesMs.length; a += lagWin) anchorSpan(a, Math.min(fw.timesMs.length, a + lagWin));
  if (!lags.length) return { refused: 'no window found a coincidence peak — the two trains do not share a latency anywhere', windows, unanchoredWindows };
  const lagSorted = lags.slice().sort((x, y) => x - y);
  const spans = coverageSpans(selfMs, opts.coverageGapMs || 3000);
  const fwIn = [];
  let outside = 0;
  let unanchored = 0;
  for (let i = 0; i < fwT.length; i++) {
    if (!anchored[i]) {
      unanchored++;
      continue;
    }
    if (inSpans(fwT[i], spans)) fwIn.push(i);
    else outside++;
  }
  const fwMs = fwIn.map((i) => fwT[i]);
  const P = pairByTime(Array.from(selfMs), fwMs, tol);
  const matchedSelfPct = selfMs.length ? (100 * P.pairs.length) / selfMs.length : null;
  const matchedFwPct = fwMs.length ? (100 * P.pairs.length) / fwMs.length : null;
  const dts = P.pairs.map((p) => p[2]);
  // RR on CONSECUTIVELY matched pairs: self interval i (ending at beat i) vs firmware rr at the matched row
  const dRR = [];
  for (let k = 1; k < P.pairs.length; k++) {
    const [i, j] = P.pairs[k];
    const [i0, j0] = P.pairs[k - 1];
    if (i === i0 + 1 && j === j0 + 1) dRR.push(selfNN[i] - dev[fwIn[j]].rr);
  }
  let rr = null;
  if (dRR.length >= 2) {
    const abs = dRR.map(Math.abs);
    const mean = dRR.reduce((x, y) => x + y, 0) / dRR.length;
    const sd = Math.sqrt(dRR.reduce((x, y) => x + (y - mean) * (y - mean), 0) / (dRR.length - 1));
    const sorted = dRR.slice().sort((x, y) => x - y);
    const q = (pq) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(pq * (sorted.length - 1))))];
    rr = { n: dRR.length, medianAbsMs: median(abs), biasMs: mean, loaMs: 1.96 * sd, empirical95Ms: (q(0.975) - q(0.025)) / 2 };
  }
  return {
    tolMs: tol,
    anchorWindow: opts.anchorWindow || 300,
    latencyMs: median(lags),
    latencySpreadMs: +(lagSorted[Math.floor(0.95 * (lagSorted.length - 1))] - lagSorted[Math.floor(0.05 * (lagSorted.length - 1))]).toFixed(0),
    lagWindows: windows,
    unanchoredWindows,
    unanchoredBeats: unanchored,
    anchorJumps: fw.anchorJumps,
    nSelf: selfMs.length,
    nFirmware: fw.timesMs.length,
    firmwareInCoverage: fwMs.length,
    outsideCoverage: outside,
    paired: P.pairs.length,
    matchedSelfPct: matchedSelfPct == null ? null : +matchedSelfPct.toFixed(2),
    matchedFwPct: matchedFwPct == null ? null : +matchedFwPct.toFixed(2),
    medianDtMs: median(dts),
    rr,
    bands: {
      matchedSelf: band('matchedPct', matchedSelfPct),
      matchedFw: band('matchedPct', matchedFwPct),
      rrMedianAbs: band('medianAbsMs', rr && rr.medianAbsMs),
      rrLoa: band('loaMs', rr && rr.loaMs)
    }
  };
}

export function median(xs) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null;
}

/* Paired differences for the LoA. ⚠️ FIRST VERSION PAIRED WITH ONE GLOBAL OFFSET and read LoA ≈ 165 ms
   against a per-beat median of 0.45 ms on the same night — the two detectors differ by ~1.5 % of beats
   DISTRIBUTED through a night, so a single offset drifts by a beat somewhere and every later pair is
   off by one (differences at HRV scale, ~160 ms at the 95th percentile). That was the INSTRUMENT
   measuring its own pairing, not the detectors. So this pairs the way `ECGDSP.alignFirmwareRR` does:
   the night is cut into `windows`, each window fits its own offset (the one minimising the median
   |Δ| over ±maxOffset beats), and only the windows the alignment calls stable contribute. Returns
   {n, medianAbsMs, maxAbsMs, biasMs, loaMs, empirical95Ms, offsets} or null. */
export function pairedRR(selfNN, devRR, align, opts = {}) {
  if (!align || !Number.isFinite(align.offset)) return null;
  const windows = opts.windows || 10;
  const maxOff = opts.maxOffset || 60;
  const nWin = Array.isArray(align.medianAbsByWindow) ? align.medianAbsByWindow.length : windows;
  const nDev = devRR.length;
  if (nDev < windows * 2 || selfNN.length < windows * 2) return null;
  const d = [];
  const offsets = [];
  const lo = align.stableWindowRange ? align.stableWindowRange[0] : 0;
  const hi = align.stableWindowRange ? align.stableWindowRange[1] : nWin - 1;
  for (let w = 0; w < nWin; w++) {
    if (w < lo || w > hi) continue;
    const a = Math.floor((w * nDev) / nWin);
    const b = Math.floor(((w + 1) * nDev) / nWin);
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let off = -align.offset - maxOff; off <= -align.offset + maxOff; off++) {
      const tmp = [];
      for (let i = a; i < b; i++) {
        const sv = selfNN[i + off];
        if (Number.isFinite(sv) && Number.isFinite(devRR[i])) tmp.push(Math.abs(sv - devRR[i]));
      }
      if (tmp.length < 50) continue;
      const m = median(tmp);
      if (m < bestScore) {
        bestScore = m;
        best = off;
      }
    }
    if (best == null) continue;
    offsets.push(best);
    for (let i = a; i < b; i++) {
      const sv = selfNN[i + best];
      if (Number.isFinite(sv) && Number.isFinite(devRR[i])) d.push(sv - devRR[i]);
    }
  }
  if (d.length < 2) return null;
  const abs = d.map(Math.abs);
  const mean = d.reduce((x, y) => x + y, 0) / d.length;
  const sd = Math.sqrt(d.reduce((x, y) => x + (y - mean) * (y - mean), 0) / (d.length - 1));
  /* Beside the parametric LoA, the EMPIRICAL 95 % half-width ((p97.5 − p2.5)/2). Not banded — the
     band was registered on 1.96·SD and stays there — but printed, because one mispaired beat is a
     ±RR outlier that moves an SD by tens of ms while moving a percentile by nothing, and a reader
     must be able to see which of the two the LoA is measuring. */
  const sorted = d.slice().sort((x, y) => x - y);
  const q = (pq) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(pq * (sorted.length - 1))))];
  let mx = 0;
  for (const v of abs) if (v > mx) mx = v;
  return { n: d.length, medianAbsMs: median(abs), maxAbsMs: mx, biasMs: mean, loaMs: 1.96 * sd, empirical95Ms: (q(0.975) - q(0.025)) / 2, offsets };
}

/* One night: everything the bands need, or a refusal with its reason. */
export function scoreNight(ECGDSP, ecgText, rrText, opts = {}) {
  const rec = ECGDSP.parseECG(ecgText);
  if (!rec || !rec.int16 || !rec.fs) return { ok: false, reason: 'ECG did not parse' };
  rec.deviceRR = ECGDSP.parseDeviceRR(rrText);
  if (!rec.deviceRR.length) return { ok: false, reason: 'firmware RR file carries no intervals' };
  const r = ECGDSP.analyze(rec, null);
  if (!r || !r.nn || r.nn.length < (opts.minBeats || 0)) return { ok: false, reason: 'fewer than ' + (opts.minBeats || 0) + ' NN beats (' + ((r && r.nn && r.nn.length) || 0) + ')' };
  /* THE SAME FILTER ON BOTH SIDES. `parseDeviceRR` keeps firmware intervals in 200–3000 ms; `r.nn`
     keeps every interval, including the ones that straddle a dropout (§∅ — flagged as `nnSpansGap`
     inside `analyze`, excluded from the headline rMSSD/SDNN there, and NOT published on the result).
     Fed raw, the self train carried 22 967 ms "rMSSD" on 2026-09-03 against a firmware 34.9 — the
     instrument comparing a non-measurement. So the self train is filtered to the firmware's own
     window before any comparison, and the count excluded is reported beside the night. ⚠️ ECGDex's
     own `validateRR`/`out.validation` are fed the raw train and carry this defect; that is a DSP
     change and a separate PR, per this tool's rule that it ships none. */
  const rawNN = Array.from(r.nn);
  const keep = rawNN.map((x) => Number.isFinite(x) && x >= 200 && x <= 3000);
  const selfNN = rawNN.filter((_, i) => keep[i]);
  /* TIME PAIRING: ECGDex beat times on the host axis (t0Ms + tt), the interval ending at each beat
     beside them; the same 200–3000 ms filter keeps the two legs on identical footing. */
  const t0 = r.t0Ms || rec.t0Ms || 0;
  const selfMs = [];
  const selfNNAtBeat = [];
  for (let i = 0; i < rawNN.length; i++) {
    if (!keep[i] || !Number.isFinite(r.tt[i])) continue;
    selfMs.push(t0 + r.tt[i] * 1000);
    selfNNAtBeat.push(rawNN[i]);
  }
  const tp = timePairing(selfMs, selfNNAtBeat, rec.deviceRR, { tolMs: opts.tolMs, anchorWindow: opts.anchorWindow });
  const selfExcluded = rawNN.length - selfNN.length;
  const v = ECGDSP.validateRR(selfNN, rec.deviceRR);
  if (!v) return { ok: false, reason: 'validateRR refused (too few intervals on one side)' };
  const al = ECGDSP.alignFirmwareRR(selfNN, rec.deviceRR, { fs: rec.fs });
  const devVals = rec.deviceRR.map((d) => d.rr);
  const pr = pairedRR(selfNN, devVals, al);
  const beatCountPct = (100 * Math.abs(v.nSelf - v.nDev)) / v.nDev;
  return {
    ok: true,
    fs: rec.fs,
    nSelf: v.nSelf,
    nDev: v.nDev,
    selfExcluded,
    beatCountPct: +beatCountPct.toFixed(3),
    dMeanPct: v.dMean,
    dRMSSDPct: v.dRMSSD,
    dSDNNPct: v.dSDNN,
    selfRMSSD: v.selfRMSSD,
    devRMSSD: v.devRMSSD,
    selfSDNN: v.selfSDNN,
    devSDNN: v.devSDNN,
    medianAbsMs: al ? al.medianAbsMs : null,
    medianAbsWorstMs: al ? al.medianAbsWorstMs : null,
    pairingDecays: !!(al && al.pairingDecays),
    offset: al ? al.offset : null,
    paired: pr,
    time: tp,
    bands: {
      beatCount: band('beatCountPct', beatCountPct),
      medianAbs: band('medianAbsMs', al ? al.medianAbsMs : null),
      loa: band('loaMs', pr ? pr.loaMs : null),
      dMean: band('dMeanPct', v.dMean),
      dRMSSD: band('dRMSSDPct', v.dRMSSD),
      dSDNN: band('dSDNNPct', v.dSDNN)
    }
  };
}

/* ── corpus discovery: an ECG file and the RR file that shares its stamp ──────────────────────── */
export function discoverPairs(root) {
  const out = [];
  if (!existsSync(root)) return out;
  for (const night of readdirSync(root).sort()) {
    const d = join(root, night);
    let names;
    try {
      names = readdirSync(d);
    } catch {
      continue;
    }
    for (const n of names) {
      const m = /^(Polar_H10_[^_]+_(\d{14}))_ECG\.txt$/.exec(n);
      if (!m) continue;
      const rr = m[1] + '_RR.txt';
      if (names.includes(rr)) out.push({ night, stamp: m[2], ecg: join(d, n), rr: join(d, rr), bytes: statSync(join(d, n)).size });
    }
  }
  return out;
}

export function ppiCoverage(root) {
  let nights = 0;
  let usable = 0;
  if (!existsSync(root)) return { nights, usable };
  for (const night of readdirSync(root)) {
    let names;
    try {
      names = readdirSync(join(root, night));
    } catch {
      continue;
    }
    const ppi = names.filter((n) => /VeritySense.*_PPI\.txt$/.test(n));
    if (!ppi.length) continue;
    nights++;
    const rows = Math.max(
      ...ppi.map(
        (n) =>
          readFileSync(join(root, night, n), 'utf8')
            .split('\n')
            .filter((l) => /^\d{4}-/.test(l)).length
      )
    );
    if (rows >= 300) usable++;
  }
  return { nights, usable };
}

export function pooled(rows) {
  const ok = rows.filter((r) => r.ok);
  const stat = (k, get) => {
    const v = ok.map(get);
    const m = median(v);
    return { median: m, n: v.filter(Number.isFinite).length, band: ok.length >= BANDS.minNights ? band(k, m) : 'UNDERPOWERED' };
  };
  return {
    nights: ok.length,
    refused: rows.length - ok.length,
    beats: ok.reduce((a, r) => a + r.nSelf, 0),
    beatCount: stat('beatCountPct', (r) => r.beatCountPct),
    medianAbs: stat('medianAbsMs', (r) => r.medianAbsMs),
    loa: stat('loaMs', (r) => (r.paired ? r.paired.loaMs : null)),
    empirical95: { median: median(ok.map((r) => (r.paired ? r.paired.empirical95Ms : null))), n: ok.filter((r) => r.paired).length, band: 'not banded' },
    dMean: stat('dMeanPct', (r) => r.dMeanPct),
    dRMSSD: stat('dRMSSDPct', (r) => r.dRMSSDPct),
    dSDNN: stat('dSDNNPct', (r) => r.dSDNNPct),
    withinSample: ok.filter((r) => Number.isFinite(r.medianAbsMs) && r.medianAbsMs <= BANDS.medianAbsMs[0]).length,
    unpaired: ok.filter((r) => Number.isFinite(r.medianAbsMs) && r.medianAbsMs > BANDS.medianAbsMs[1]).length,
    time: {
      latency: { median: median(ok.map((r) => (r.time && !r.time.refused ? r.time.latencyMs : null))), n: ok.filter((r) => r.time && !r.time.refused).length, band: 'not banded' },
      refused: ok.filter((r) => r.time && r.time.refused).map((r) => r.night),
      matchedSelf: stat('matchedPct', (r) => (r.time ? r.time.matchedSelfPct : null)),
      matchedFw: stat('matchedPct', (r) => (r.time ? r.time.matchedFwPct : null)),
      rrMedianAbs: stat('medianAbsMs', (r) => (r.time && r.time.rr ? r.time.rr.medianAbsMs : null)),
      rrLoa: stat('loaMs', (r) => (r.time && r.time.rr ? r.time.rr.loaMs : null)),
      rrEmpirical95: { median: median(ok.map((r) => (r.time && r.time.rr ? r.time.rr.empirical95Ms : null))), n: ok.filter((r) => r.time && r.time.rr).length, band: 'not banded' },
      medianDt: { median: median(ok.map((r) => (r.time ? r.time.medianDtMs : null))), n: ok.filter((r) => r.time).length, band: 'not banded' },
      outsideCoverage: ok.reduce((a, r) => a + (r.time && !r.time.refused ? r.time.outsideCoverage : 0), 0),
      unanchoredBeats: ok.reduce((a, r) => a + (r.time && !r.time.refused ? r.time.unanchoredBeats : 0), 0),
      unanchoredWindows: ok.reduce((a, r) => a + (r.time ? r.time.unanchoredWindows || 0 : 0), 0),
      latencySpread: { median: median(ok.map((r) => (r.time && !r.time.refused ? r.time.latencySpreadMs : null))), n: ok.filter((r) => r.time && !r.time.refused).length, band: 'not banded' },
      anchorJumps: ok.filter((r) => r.time && r.time.anchorJumps > 0).map((r) => r.night + ':' + r.time.anchorJumps),
      investigate: ok.filter((r) => r.time && r.time.bands && Object.values(r.time.bands).includes('INVESTIGATE')).map((r) => r.night)
    },
    decays: ok.filter((r) => r.pairingDecays).map((r) => r.night),
    investigate: ok.filter((r) => Object.values(r.bands).includes('INVESTIGATE')).map((r) => r.night)
  };
}

function header() {
  return [
    'oracle-ecg-firmware-rr — ECGDex Pan–Tompkins vs the H10 FIRMWARE detector, real nights',
    '  A REFERENCE IS A REFERENCE, NOT GROUND TRUTH. Disagreement opens an investigation, never an auto-fix.',
    '  Agreement between two algorithms proves nothing physiological — they share the lead, the electrode and the night.',
    '  Bands were registered in this file before the first run; a band moved after a number is a number, not a test.'
  ].join('\n');
}

function fmt(x, d = 1) {
  return x == null || !Number.isFinite(x) ? 'n/a' : x.toFixed(d);
}

function report(rows, P, cov, roots) {
  const L = [header(), ''];
  L.push(`roots: ${roots.join(' · ')}`);
  L.push(`nights scored ${P.nights} · refused ${P.refused} · beats ${P.beats}`);
  L.push('');
  L.push(
    'night        stamp           nSelf  nDev   excl  Δn%    med|Δ| ms  LoA ms  emp95   bias ms  dMean%  dRMSSD%  dSDNN%   decay  bands        | time: lat.ms self% fw%  RR|Δ|  LoA   outside jumps'
  );
  for (const r of rows) {
    if (!r.ok) {
      L.push(`${r.night}  ${r.stamp}  ⊘ ${r.reason}`);
      continue;
    }
    const b = r.bands;
    const worst = Object.values(b).includes('INVESTIGATE') ? 'INVESTIGATE' : Object.values(b).includes('SHORTFALL') ? 'SHORTFALL' : 'CONSISTENT';
    L.push(
      `${r.night}  ${r.stamp}  ${String(r.nSelf).padStart(5)}  ${String(r.nDev).padStart(5)}  ${String(r.selfExcluded).padStart(4)}  ${fmt(r.beatCountPct, 2).padStart(5)}  ${fmt(r.medianAbsMs, 2).padStart(9)}  ${fmt(r.paired && r.paired.loaMs).padStart(6)}  ${fmt(r.paired && r.paired.empirical95Ms).padStart(5)}  ${fmt(r.paired && r.paired.biasMs).padStart(7)}  ${fmt(r.dMeanPct).padStart(6)}  ${fmt(r.dRMSSDPct).padStart(7)}  ${fmt(r.dSDNNPct).padStart(6)}   ${r.pairingDecays ? 'YES' : ' no'}   ${worst.padEnd(11)} | ${r.time && r.time.refused ? '⊘ ' + r.time.refused : r.time ? fmt(r.time.latencyMs, 0).padStart(6) + ' ' + fmt(r.time.matchedSelfPct).padStart(5) + ' ' + fmt(r.time.matchedFwPct).padStart(5) + '  ' + fmt(r.time.rr && r.time.rr.medianAbsMs, 2).padStart(5) + '  ' + fmt(r.time.rr && r.time.rr.loaMs).padStart(5) + '  ' + String(r.time.outsideCoverage).padStart(6) + ' ' + String(r.time.anchorJumps).padStart(4) : 'n/a'}`
    );
  }
  L.push('');
  const line = (name, s, unit) => `  ${name.padEnd(14)} median ${fmt(s.median, 2)} ${unit}  (n=${s.n})  → ${s.band}`;
  L.push(`POOLED (median across ${P.nights} nights, ${P.beats} beats; verdict needs ≥ ${BANDS.minNights} nights):`);
  L.push(line('beat count Δ', P.beatCount, '%'));
  L.push(line('per-beat |Δ|', P.medianAbs, 'ms'));
  L.push(line('RR LoA', P.loa, 'ms'));
  L.push(line('RR emp. 95 %', P.empirical95, 'ms'));
  L.push(line('mean RR Δ', P.dMean, '%'));
  L.push(line('rMSSD Δ', P.dRMSSD, '%'));
  L.push(line('SDNN Δ', P.dSDNN, '%'));
  L.push(
    `  per-beat pairing: within one sample (≤ ${BANDS.medianAbsMs[0]} ms) on ${P.withinSample} night(s) · beyond ${BANDS.medianAbsMs[1]} ms (read as UNPAIRED — see the header's known limit) on ${P.unpaired}`
  );
  L.push(`  pairing decays on ${P.decays.length} night(s)${P.decays.length ? ': ' + P.decays.join(', ') : ''}`);
  L.push(`  INVESTIGATE on ${P.investigate.length} night(s)${P.investigate.length ? ': ' + P.investigate.join(', ') : ''}`);
  L.push('');
  L.push(
    `TIME-ANCHORED PAIRING (±${rows.find((r) => r.ok && r.time) ? rows.find((r) => r.ok && r.time).time.tolMs : '?'} ms, one-to-one; firmware beats outside ECGDex coverage excluded, not missed):`
  );
  L.push(line('stream latency', P.time.latency, 'ms'));
  L.push(line('latency p5–p95', P.time.latencySpread, 'ms'));
  L.push(line('matched self', P.time.matchedSelf, '%'));
  L.push(line('matched firmw.', P.time.matchedFw, '%'));
  L.push(line('RR |Δ| pairs', P.time.rrMedianAbs, 'ms'));
  L.push(line('RR LoA pairs', P.time.rrLoa, 'ms'));
  L.push(line('RR emp. 95 %', P.time.rrEmpirical95, 'ms'));
  L.push(line('|Δt| of pairs', P.time.medianDt, 'ms'));
  L.push(
    `  firmware beats outside ECGDex coverage: ${P.time.outsideCoverage} · anchor jumps on ${P.time.anchorJumps.length} night(s)${P.time.anchorJumps.length ? ': ' + P.time.anchorJumps.join(', ') : ''}`
  );
  L.push(`  time leg refused on ${P.time.refused.length} night(s)${P.time.refused.length ? ': ' + P.time.refused.join(', ') : ''}`);
  L.push(`  INVESTIGATE (time leg) on ${P.time.investigate.length} night(s)${P.time.investigate.length ? ': ' + P.time.investigate.join(', ') : ''}`);
  L.push('');
  L.push(`PPG leg (coverage only, not compared): Verity nights with a _PPI.txt ${cov.nights}, with ≥ 300 rows ${cov.usable}`);
  L.push('  one sample at 130 Hz = ' + SAMPLE_MS_130.toFixed(2) + ' ms; bands: count ≤1/3 % · |Δ| ≤8/20 ms · LoA ≤30/60 ms · mean ≤1/3 % · rMSSD ≤10/25 % · SDNN ≤5/15 %');
  return L.join('\n');
}

/* ── selftest: the PLANTS. No corpus, no DSP — the arithmetic and the bands, each with a case that
   must fire and a case that must not. ──────────────────────────────────────────────────────────── */
function selftest() {
  const fails = [];
  const ok = (c, m) => (c ? null : fails.push(m));
  ok(
    band('medianAbsMs', 7.7) === 'CONSISTENT' && band('medianAbsMs', 8) === 'CONSISTENT' && band('medianAbsMs', 8.01) === 'SHORTFALL' && band('medianAbsMs', 21) === 'INVESTIGATE',
    'band edges are closed on the consistent side'
  );
  ok(band('dRMSSDPct', null) === 'n/a' && band('dRMSSDPct', Number.NaN) === 'n/a', 'an absent statistic is n/a, never a band');
  ok(median([3, 1, 2]) === 2 && median([4, 1, 3, 2]) === 2.5 && median([]) === null, 'median: odd, even, empty');
  // pairedRR: a planted constant offset of +5 ms with self shifted by 2 beats
  // NON-periodic: a periodic train makes every offset ≡ k (mod period) tie, which is a plant artifact
  let seed = 7;
  const dev = Array.from({ length: 1000 }, () => {
    seed = (seed * 16807) % 2147483647;
    return 700 + (seed % 400);
  });
  const self = [0, 0].concat(dev.map((x) => x + 5));
  const pr = pairedRR(self, dev, { offset: 2, medianAbsByWindow: [1, 1, 1, 1], stableWindowRange: null });
  ok(
    pr && pr.n === 1000 && pr.medianAbsMs === 5 && pr.maxAbsMs === 5 && Math.abs(pr.biasMs - 5) < 1e-9 && pr.loaMs === 0,
    'PLANT: a +5 ms constant offset at beat offset 2 pairs every beat, bias 5, LoA 0'
  );
  // stable range restricts the pairs: windows 0..1 of 4 ⇒ first half only
  const pr2 = pairedRR(self, dev, { offset: 2, medianAbsByWindow: [1, 1, 1, 1], stableWindowRange: [0, 1] });
  ok(pr2 && pr2.n === 500, 'the stable window range restricts the pairs (' + (pr2 && pr2.n) + ')');
  // a jittered difference gives a non-zero LoA that 1.96·SD reproduces
  const self3 = [0, 0].concat(dev.map((x, i) => x + (i % 2 ? 10 : -10)));
  const pr3 = pairedRR(self3, dev, { offset: 2, medianAbsByWindow: [1], stableWindowRange: null });
  ok(pr3 && Math.abs(pr3.loaMs - 1.96 * Math.sqrt((1000 * 100) / 999)) < 1e-6, 'LoA is 1.96·SD of the signed differences');
  ok(pr3 && Math.abs(pr3.empirical95Ms - 10) < 1e-9, 'the empirical 95 % half-width of a ±10 ms alternation is 10 ms');
  // ONE mispaired beat (a ±900 ms outlier among 1000) moves the SD-based LoA by tens of ms and the empirical one by ~nothing
  const self4 = self.slice();
  self4[500] += 900;
  const pr4 = pairedRR(self4, dev, { offset: 2, medianAbsByWindow: [1], stableWindowRange: null });
  ok(
    pr4 && pr4.loaMs > 50 && pr4.empirical95Ms < 1,
    'PLANT: one mispaired beat inflates 1.96·SD (' + fmt(pr4 && pr4.loaMs) + ' ms) and not the empirical width (' + fmt(pr4 && pr4.empirical95Ms, 2) + ')'
  );
  ok(pairedRR(self, dev, null) === null && pairedRR([1], [1], { offset: 0 }) === null, 'no alignment or too few beats ⇒ null, not a number');
  // PLANT: a beat DELETED from self mid-night shifts every later pair by one. A global offset would
  // read HRV-scale differences for the whole second half; per-window fitting recovers the pair.
  const self5 = self.slice();
  self5.splice(500, 1);
  const pr5 = pairedRR(self5, dev, { offset: 2, medianAbsByWindow: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], stableWindowRange: null });
  ok(
    pr5 && pr5.medianAbsMs === 5 && pr5.empirical95Ms < 1 && pr5.offsets.length === 10 && new Set(pr5.offsets).size === 2,
    'PLANT: a deleted beat mid-night is absorbed by per-window offsets (' + (pr5 && pr5.offsets.join(',')) + ')'
  );
  // ── TIME PAIRING PLANTS ──
  // a firmware train whose arrival stamps carry +[0,900] ms batching delay and +0.05 % drift: the
  // per-window lower envelope must recover beat times within ~the batching floor, not the median delay
  let rseed = 11;
  const rrs = Array.from({ length: 3000 }, () => {
    rseed = (rseed * 16807) % 2147483647;
    return 700 + (rseed % 400); // non-periodic: a periodic train aliases every coincidence lag
  });
  let tcum = 0;
  const trueMs = [];
  const devRows = [];
  // HOST-time truth: the device runs slow by 500 ppm relative to the host (a real-scale value), so the
  // beat's host time is cum·1.0005; delivery adds a 30 ms floor plus [0, 900) ms batching. The floor is
  // inseparable from the anchor by construction, so the recovered times sit ~30–75 ms LATE, uniformly.
  for (let i = 0; i < rrs.length; i++) {
    tcum += rrs[i];
    trueMs.push(1000000 + tcum * 1.0005);
    devRows.push({ tsMs: 1000000 + tcum * 1.0005 + 30 + ((i * 7919) % 900), rr: rrs[i] });
  }
  const fw = firmwareHostTimes(devRows, 300);
  const errs = Array.from(fw.timesMs, (t, i) => t - trueMs[i]);
  const errSorted = errs.slice().sort((a, b) => a - b);
  ok(
    fw.anchorJumps === 0 && median(errs) > 0 && median(errs) < 150 && errSorted[errSorted.length - 1] - errSorted[0] < 300,
    'PLANT: the envelope anchor recovers beat times through batching + drift, late by the inseparable delivery floor only (median err ' +
      fmt(median(errs)) +
      ' ms, spread ' +
      fmt(errSorted[errSorted.length - 1] - errSorted[0]) +
      ')'
  );
  // an un-delivered stretch: 200 beats missing from the firmware file mid-night ⇒ the cumulative axis
  // falls behind by their sum; per-window anchoring re-absorbs it and reports ONE jump
  const devGap = devRows.filter((_, i) => i < 1500 || i >= 1700);
  const fwG = firmwareHostTimes(devGap, 300);
  ok(fwG.anchorJumps >= 1, 'PLANT: an un-delivered stretch shows as an anchor jump (' + fwG.anchorJumps + ')');
  // pairing: exact same trains ⇒ 100 % both ways, |Δt| 0; a beat DELETED from self is one unmatched firmware
  const A = trueMs.map((t) => t);
  const PB = pairByTime(A, A, 150);
  ok(PB.pairs.length === A.length && PB.unmatchedA === 0 && PB.unmatchedB === 0, 'pairing: identical trains pair 1:1');
  const Adel = A.filter((_, i) => i !== 1000);
  const PD = pairByTime(Adel, A, 150);
  ok(PD.pairs.length === Adel.length && PD.unmatchedB === 1 && PD.unmatchedA === 0, 'pairing: one deleted beat ⇒ exactly one unmatched on the other side, nothing else disturbed');
  // one-to-one: two self beats 100 ms apart near one firmware beat claim it once
  const PT = pairByTime([1000, 1100], [1050], 150);
  ok(PT.pairs.length === 1 && PT.unmatchedA === 1, 'pairing: a firmware beat is claimed once (nearest wins)');
  // coverage: firmware beats in a 10-minute hole of the self train are OUTSIDE coverage, not missed
  const selfHole = A.filter((t) => !(t > 1000000 + 1200000 && t < 1000000 + 1800000));
  const nnHole = selfHole.map(() => 900);
  const tpH = timePairing(selfHole, nnHole, devRows, { tolMs: 150, anchorWindow: 300 });
  // a window entirely inside the hole has no self beats to anchor to ⇒ UNANCHORED; a beat near the
  // hole's edges in an anchored window ⇒ outsideCoverage. Both are "not a miss", and they sum.
  ok(
    tpH.outsideCoverage + tpH.unanchoredBeats > 500 && tpH.matchedSelfPct > 95 && tpH.firmwareInCoverage + tpH.outsideCoverage + tpH.unanchoredBeats === devRows.length,
    'PLANT: firmware beats inside a self hole are outsideCoverage (' +
      tpH.outsideCoverage +
      ') or unanchored (' +
      tpH.unanchoredBeats +
      '), never misses; matchedSelf ' +
      fmt(tpH.matchedSelfPct) +
      ' %'
  );
  const lagP = coincidenceLag(
    A,
    A.map((t) => t + 2700),
    150,
    6000
  );
  ok(Math.abs(lagP.lagMs - 2700) <= 20 && !lagP.atEdge, 'PLANT: a 2.7 s constant stream latency is recovered by coincidence search (' + lagP.lagMs + ' ms)');
  const beyond = coincidenceLag(
    A,
    A.map((t) => t + 7000),
    150,
    6000
  );
  ok(beyond.refused === true, 'a latency beyond the search range is REFUSED (no peak: ratio ' + beyond.peakRatio.toFixed(2) + ', edge ' + beyond.atEdge + '), never reported as a lag');
  const unrelated = coincidenceLag(
    A,
    A.map((t, i) => t + ((i * 7919) % 5000) - 2500),
    150,
    6000
  );
  ok(unrelated.refused === true, 'two trains with no shared latency are refused (ratio ' + unrelated.peakRatio.toFixed(2) + ')');
  const tpL = timePairing(
    A,
    A.map(() => 900),
    devRows.map((d) => ({ tsMs: d.tsMs + 2700, rr: d.rr })),
    { tolMs: 150, anchorWindow: 300 }
  );
  ok(
    !tpL.refused && Math.abs(tpL.latencyMs - 2700) <= 150 && tpL.matchedSelfPct > 95,
    'PLANT: the time leg removes the latency and pairs (' + tpL.latencyMs + ' ms, ' + fmt(tpL.matchedSelfPct) + ' %)'
  );
  const stepped = devRows.map((d, i) => ({ tsMs: d.tsMs + (i < 1500 ? 2700 : 1300), rr: d.rr }));
  const tpS = timePairing(
    A,
    A.map(() => 900),
    stepped,
    { tolMs: 150, anchorWindow: 300, lagWindow: 600 }
  );
  ok(
    !tpS.refused && tpS.matchedSelfPct > 95 && Number(tpS.latencySpreadMs) > 1000,
    'PLANT: a latency STEP mid-night (2.7 → 1.3 s) is followed per window — matched ' + fmt(tpS.matchedSelfPct) + ' %, spread ' + tpS.latencySpreadMs + ' ms'
  );
  ok(band('matchedPct', 97) === 'CONSISTENT' && band('matchedPct', 96.9) === 'SHORTFALL' && band('matchedPct', 89) === 'INVESTIGATE', 'higher-is-better band edges');

  // pooled: UNDERPOWERED below minNights, banded at or above
  const mk = (n, night) => ({
    ok: true,
    night,
    nSelf: 100,
    beatCountPct: 0.2,
    medianAbsMs: 3,
    dMeanPct: 0.1,
    dRMSSDPct: 2,
    dSDNNPct: 1,
    paired: { loaMs: 12 },
    pairingDecays: n % 3 === 0,
    bands: { beatCount: 'CONSISTENT', medianAbs: 'CONSISTENT', loa: 'CONSISTENT', dMean: 'CONSISTENT', dRMSSD: 'CONSISTENT', dSDNN: n === 4 ? 'INVESTIGATE' : 'CONSISTENT' }
  });
  const few = pooled([mk(1, 'a'), mk(2, 'b'), { ok: false }]);
  ok(few.nights === 2 && few.refused === 1 && few.medianAbs.band === 'UNDERPOWERED', 'fewer than minNights ⇒ UNDERPOWERED, no verdict');
  const many = pooled(Array.from({ length: 12 }, (_, i) => mk(i, 'n' + i)));
  ok(
    many.nights === 12 && many.medianAbs.band === 'CONSISTENT' && many.investigate.length === 1 && many.investigate[0] === 'n4' && many.decays.length === 4,
    'at minNights the median is banded, INVESTIGATE nights and decays are LISTED'
  );
  ok(/NOT GROUND TRUTH/.test(header()) && /proves nothing physiological/.test(header()), "the header prints §5's two caveats");
  for (const f of fails) console.error('  ✗ ' + f);
  console.log(fails.length ? fails.length + ' failed of 26' : 'all 26 selftests passed');
  return fails.length ? 1 : 0;
}

async function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  const arg = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
  };
  const roots = argv.includes('--root') ? [arg('--root')] : DEFAULT_ROOTS;
  const minBeats = +arg('--min-beats', 3600);
  const limit = +arg('--limit', 0);
  let pairs = [];
  for (const r of roots) pairs = pairs.concat(discoverPairs(r));
  if (!pairs.length) {
    console.log(header() + '\nSKIP — no H10 ECG+RR pairs found. Searched:\n  ' + roots.join('\n  ') + '\nNo metrics reported; this tool never fetches.');
    return 0;
  }
  // one pair per night: the largest ECG file (the overnight session, not a fragment)
  const byNight = new Map();
  for (const p of pairs) if (!byNight.has(p.night) || byNight.get(p.night).bytes < p.bytes) byNight.set(p.night, p);
  let chosen = [...byNight.values()].sort((a, b) => (a.night < b.night ? -1 : 1));
  if (limit > 0) chosen = chosen.slice(0, limit);
  const { getDsps } = await import(join(HERE, 'pat-matchrate-strict.mjs'));
  const { ECGDSP } = getDsps();
  const rows = [];
  const t0 = Date.now();
  for (const p of chosen) {
    let s;
    try {
      s = scoreNight(ECGDSP, readFileSync(p.ecg, 'utf8'), readFileSync(p.rr, 'utf8'), { minBeats, tolMs: +arg('--tol', 150), anchorWindow: +arg('--anchor-window', 300) });
    } catch (e) {
      s = { ok: false, reason: 'threw: ' + String(e && e.message).slice(0, 80) };
    }
    rows.push({ night: p.night, stamp: p.stamp, ...s });
    process.stderr.write(`  ${p.night} ${s.ok ? 'scored' : '⊘ ' + s.reason} · ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
  }
  const P = pooled(rows);
  const cov = ppiCoverage(roots[0]);
  if (argv.includes('--json')) console.log(JSON.stringify({ bands: BANDS, roots, pooled: P, ppiCoverage: cov, nights: rows }, null, 1));
  else console.log(report(rows, P, cov, roots));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2)).then((c) => process.exit(c));
