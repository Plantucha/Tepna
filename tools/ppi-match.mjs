/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * ppi-match.mjs — PPG-beat ↔ ECG-beat alignment and jitter, shared by the §3 apparatus
 * ------------------------------------------------------------------------------------------------
 * Extracted from `ppi-jitter-vs-ecg.mjs` (unchanged) when `ppg-foot-consensus-e1.mjs` needed the same
 * alignment. It is a LIBRARY, not a script: no corpus scan, no top-level side effects, so importing it
 * costs nothing. That is the whole reason for the split — `ppi-jitter-vs-ecg.mjs` does its work at
 * module scope, so importing THAT to reuse a function would run a full corpus pass as a side effect.
 *
 * The reasoning behind each function lives with the function; it is the record of three measurement
 * errors this apparatus made before it was right (PPGDEX-JITTER-AND-REFERENCE-FOLLOWUPS §4), so it
 * moved here verbatim rather than being summarised.
 *
 * Covered by `node tools/ppi-jitter-vs-ecg.mjs --selftest`, which imports from here.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

export const EPOCH_MS = 300000; // 5 min — the brief's unit, and the node's own epochs[] unit
export const MATCH_MS = 75; // §3.3 one-to-one tolerance, applied AFTER the envelope lag is removed
export const HR_BIN_MS = 1000; // instantaneous-HR envelope resolution for the cross-correlation
export const MAX_LAG_MS = 4000; // PTT is 150-250 ms; 4 s of search covers clock skew too

/* ── small stats. Sample sd (÷ n−1), matching the nodes' own convention. ───────────────────────── */
export const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
export function sd(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
}
export function quantile(a, q) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const p = (s.length - 1) * q,
    lo = Math.floor(p),
    hi = Math.ceil(p);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (p - lo);
}
export const median = (a) => quantile(a, 0.5);

/* ── the envelope: instantaneous HR sampled on a fixed grid, mean-removed so the cross-correlation
      scores SHAPE rather than level (a constant HR offset between devices must not drive the lag). ─ */
export function hrEnvelope(beatMs, t0, t1) {
  const n = Math.max(1, Math.round((t1 - t0) / HR_BIN_MS));
  const out = new Array(n).fill(NaN);
  for (let i = 1; i < beatMs.length; i++) {
    const dt = beatMs[i] - beatMs[i - 1];
    if (!(dt > 300 && dt < 2000)) continue;
    const k = Math.floor((beatMs[i] - t0) / HR_BIN_MS);
    if (k >= 0 && k < n) out[k] = 60000 / dt;
  }
  // hold-last-value fill, then mean-remove over the finite part
  let last = NaN;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(out[i])) last = out[i];
    else out[i] = last;
  }
  const fin = out.filter(Number.isFinite);
  if (fin.length < 8) return null;
  const m = mean(fin);
  for (let i = 0; i < n; i++) out[i] = Number.isFinite(out[i]) ? out[i] - m : 0;
  return out;
}

/* Coarse lag by normalised cross-correlation of the two HR envelopes. Returns ms (positive = the
   finger envelope lags the ECG one, which is the physical direction for pulse transit). */
export function envelopeLagMs(aEnv, bEnv) {
  if (!aEnv || !bEnv) return null;
  const maxK = Math.round(MAX_LAG_MS / HR_BIN_MS);
  let best = null,
    bestK = 0;
  for (let k = -maxK; k <= maxK; k++) {
    let s = 0,
      na = 0,
      nb = 0,
      c = 0;
    for (let i = 0; i < aEnv.length; i++) {
      const j = i + k;
      if (j < 0 || j >= bEnv.length) continue;
      s += aEnv[i] * bEnv[j];
      na += aEnv[i] * aEnv[i];
      nb += bEnv[j] * bEnv[j];
      c++;
    }
    if (c < 8 || na <= 0 || nb <= 0) continue;
    const r = s / Math.sqrt(na * nb);
    if (best === null || r > best) {
      best = r;
      bestK = k;
    }
  }
  if (best === null) return null;
  /* §3.3's LOCAL REFINEMENT — the step this tool was missing, and the reason its first corpus run was
     worthless. The envelope is binned at HR_BIN_MS (1000 ms), so the coarse argmax lands on a 1 s grid
     while the matching tolerance is ±75 ms: the alignment was 13x coarser than the thing it feeds. In
     the first run every reported lag was exactly 1000 or 2000 ms — a physical impossibility for a
     150-250 ms pulse transit — and match rates split cleanly by whether the true lag happened to sit
     near a bin edge (95-99 % when it did, 47-55 % when it did not). The jitter figures inherited that
     split, so they described the binning, not the finger.

     Refined in two stages. (a) Parabolic vertex on the three correlation samples around the argmax,
     which turns the 1 s grid into a continuous estimate. (b) A fine search at BEAT resolution: sweep
     ±HR_BIN_MS around that estimate in 5 ms steps and keep the lag that maximises matched beats, since
     the endpoint is beat matching and correlation of a hold-filled envelope is only a proxy for it.
     Stage (b) is what actually earns the ±75 ms tolerance. */
  let lagMs = -bestK * HR_BIN_MS;
  const cAt = (k) => {
    let sm = 0,
      na = 0,
      nb = 0,
      c = 0;
    for (let i = 0; i < aEnv.length; i++) {
      const j = i + k;
      if (j < 0 || j >= bEnv.length) continue;
      sm += aEnv[i] * bEnv[j];
      na += aEnv[i] * aEnv[i];
      nb += bEnv[j] * bEnv[j];
      c++;
    }
    return c < 8 || na <= 0 || nb <= 0 ? null : sm / Math.sqrt(na * nb);
  };
  const cm = cAt(bestK - 1),
    c0 = cAt(bestK),
    cp = cAt(bestK + 1);
  if (cm != null && c0 != null && cp != null) {
    const den = cm - 2 * c0 + cp;
    let d = den !== 0 ? (0.5 * (cm - cp)) / den : 0;
    if (!(d > -0.5 && d < 0.5)) d = 0;
    lagMs = -(bestK + d) * HR_BIN_MS;
  }
  return { lagMs, r: best, coarseMs: -bestK * HR_BIN_MS };
}

/* Stage (b): pick the lag that maximises MATCHED BEATS, not envelope correlation. The envelope is
   hold-filled and mean-removed, so its optimum is close but not identical to the matching optimum —
   and it is the match that the ±75 ms tolerance and the jitter statistic both rest on. */
export function refineLagByMatch(fingerMs, ecgMs, seedMs, spanMs, stepMs) {
  const span = spanMs || HR_BIN_MS;
  const step = stepMs || 5;
  let bestLag = seedMs,
    bestN = -1;
  for (let L = seedMs - span; L <= seedMs + span; L += step) {
    const n = matchBeats(fingerMs, ecgMs, L).length;
    if (n > bestN) {
      bestN = n;
      bestLag = L;
    }
  }
  return { lagMs: bestLag, matched: bestN };
}

/* One-to-one greedy matching inside ±MATCH_MS, after the lag is removed. Each ECG beat is consumed at
   most once — a many-to-one match would understate jitter by pairing every finger beat to its nearest
   neighbour regardless of whether that neighbour was already spoken for. */
export function matchBeats(fingerMs, ecgMs, lagMs) {
  const used = new Set();
  const pairs = [];
  let j = 0;
  for (let i = 0; i < fingerMs.length; i++) {
    const t = fingerMs[i] - lagMs;
    while (j < ecgMs.length && ecgMs[j] < t - MATCH_MS) j++;
    let bestK = -1,
      bestD = Infinity;
    for (let k = j; k < ecgMs.length && ecgMs[k] <= t + MATCH_MS; k++) {
      if (used.has(k)) continue;
      const d = Math.abs(ecgMs[k] - t);
      if (d < bestD) {
        bestD = d;
        bestK = k;
      }
    }
    if (bestK >= 0) {
      used.add(bestK);
      pairs.push({ fi: i, ei: bestK });
    }
  }
  return pairs;
}

/* SUB-SAMPLE R-PEAK REFINEMENT — §3.2 requires it, and the shipped detector does not provide it.
   `ECGDSP.analyze().peaks` returns INTEGER sample indices. At the H10's 130 Hz that is a 7.69 ms grid,
   so peak position alone carries a uniform quantization error of sd = 7.69/√12 = 2.22 ms, and an
   INTERVAL (a difference of two) carries √2 × that = 3.14 ms. That error lands in the reference leg of
   every comparison: a finger with 5.0 ms of true jitter would measure √(5.0² + 3.14²) = 5.9 ms, and the
   inflation is largest exactly where the device is best. §3.2 names 0.47 ms interval agreement for the
   refined reference — 6.7× smaller than the quantization it removes, which is why the brief calls for it.

   Refined by fitting a parabola to the BANDPASSED signal (the same `ECGDSP.bandpass` the detector peaks
   on — shipped code, not a reimplementation) at [p−1, p, p+1] and taking its vertex. Clamped to ±0.5
   samples: a vertex outside the bracket means the three points are not a peak, and shifting a beat
   further than the grid it was found on would fabricate precision rather than recover it. */
export function refinePeaks(bp, peaks) {
  const out = new Array(peaks.length);
  for (let i = 0; i < peaks.length; i++) {
    const p = peaks[i];
    if (p <= 0 || p >= bp.length - 1) {
      out[i] = p;
      continue;
    }
    const y0 = bp[p - 1],
      y1 = bp[p],
      y2 = bp[p + 1];
    const den = y0 - 2 * y1 + y2;
    let d = den !== 0 ? (0.5 * (y0 - y2)) / den : 0;
    if (!(d > -0.5 && d < 0.5)) d = 0;
    out[i] = p + d;
  }
  return out;
}

/* PPI jitter: sd of (finger interval − matched ECG interval) over CONSECUTIVE matched pairs.
   Consecutive is load-bearing — an interval spanning a missed beat is not a jitter sample. */
export function ppiJitterMs(fingerMs, ecgMs, pairs) {
  const d = [];
  for (let p = 1; p < pairs.length; p++) {
    if (pairs[p].fi !== pairs[p - 1].fi + 1) continue;
    if (pairs[p].ei !== pairs[p - 1].ei + 1) continue;
    const fIv = fingerMs[pairs[p].fi] - fingerMs[pairs[p - 1].fi];
    const eIv = ecgMs[pairs[p].ei] - ecgMs[pairs[p - 1].ei];
    if (fIv > 300 && fIv < 2000 && eIv > 300 && eIv < 2000) d.push(fIv - eIv);
  }
  return d.length >= 8 ? { sd: sd(d), n: d.length } : null;
}
