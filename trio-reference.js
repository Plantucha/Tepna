/*
 * trio-reference.js — Tepna · the H10 beat reference for the sensor trio, one source for page and tool
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the repository root.
 *
 * WHY THIS FILE EXISTS (residue 2026-09-26-tch-hat-misattributes-shared-optical-error). The page
 * `sensor-trio-night.html` printed only the three-cornered hat's σ, and the hat assumes the three
 * devices' errors are independent. The Verity and the O2Ring share an optical error (ρ ≈ 0.24), so
 * the hat over-reads the H10 and under-reads the Verity. The fix is not a new estimator (owner D7
 * option A puts the estimator out of scope, and the optical corner is not identifiable from three
 * pairwise variances). The fix is to MEASURE: on a night that carries the H10's own `_RR.txt`, the
 * firmware's beats and ECGDex's beats agree on most intervals, and the per-second median of the
 * agreeing intervals is a reference every corner is scored against directly.
 *
 * `tools/tch-firmware-reference.mjs` built that reference for the published record and nowhere
 * else. These functions MOVED here from it unchanged, so the tool and the page worker run one copy.
 * The tool re-exports them. `pairByTime`, `coincidenceLag` and `firmwareHostTimes` are COPIES of
 * `tools/oracle-ecg-firmware-rr.mjs`: that oracle imports nothing a bundle or page can reach, so the
 * quarantine stays and `tests/dex-tests.js` pins the two copies to one behaviour.
 *
 * The H10 corner is REPORTED, NEVER JUDGED: the reference is built from the H10's own beats, so its
 * measured σ is a lower bound. Classic script; `self.TrioReference` / `module.exports`.
 */
(function (root) {
  'use strict';
  /* The hat arithmetic stays in analysis-stats.js. Resolved at call time, because the worker loads
     analysis-stats.js first and the Node tools load it through require. */
  function stats() {
    var s = root.AnalysisStats || (typeof module !== 'undefined' && typeof require === 'function' ? require('./analysis-stats.js') : null);
    if (!s || typeof s.threeCorneredHat !== 'function') throw new Error('trio-reference.js needs analysis-stats.js loaded first');
    return s;
  }
  const AGREE_MS = 8;
  const MIN_SECONDS = 1000;
  const KEYS = ['h10', 'verity', 'o2'];

  /* ── copies of tools/oracle-ecg-firmware-rr.mjs (see the header) ── */
  /* Firmware beat times on the HOST axis. `dev` = [{tsMs (arrival), rr}] in file order. The device axis is
   the cumulative RR; each window of `winBeats` is anchored by the 5th percentile of arrival − cumulative
   (the minimum delivery delay), and the anchor is applied to that window's beats. Returns
   {timesMs, anchors, anchorJumps}. */
  function firmwareHostTimes(dev, winBeats = 300, jumpMs = 2000) {
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

  /* One-to-one nearest-neighbour pairing within ±tolMs between two SORTED time arrays. Greedy in
   |Δ| order over the candidate pairs, so a beat is never claimed twice. Returns {pairs:[[i,j,dMs]],
   unmatchedA, unmatchedB}. */
  function pairByTime(aMs, bMs, tolMs = 150) {
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
  function coincidenceLag(aMs, bMs, tolMs = 150, rangeMs = 6000) {
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

  /* ── moved from tools/tch-firmware-reference.mjs ── */
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const sd = (a) => {
    const m = mean(a);
    return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
  };
  function median(a) {
    const s = a.filter(Number.isFinite).sort((x, y) => x - y);
    if (!s.length) return null;
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function corr(x, y) {
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
  /* Consensus reference: pairs of consecutive self↔firmware matches whose intervals agree within AGREE_MS.
   selfMs/selfNN: our beat times (wall-clock ms on the ECG record's own axis — see the dated note at
   the call site, which measures why that is NOT `tMsAt`'s axis) and the NN interval ending at each;
   fwMs/fwRR: firmware beat times carried onto the same axis by the coincidence lag, and its
   intervals. Returns [[sec, hr], …]. */
  function consensusPairs(selfMs, selfNN, fwMs, fwRR, tolMs = 150) {
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
  function perSecondMedian(pairs) {
    const by = new Map();
    for (const [s, v] of pairs) (by.get(s) || by.set(s, []).get(s)).push(v);
    const out = new Map();
    for (const [s, a] of by) out.set(s, median(a));
    return out;
  }
  /* One night's numbers from four aligned per-second maps (reference + three corners). */
  function scoreSeries(REF, H, V, O) {
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
    const diffVar = (a, b) => stats().variance(X[a].map((x, i) => x - X[b][i]));
    const vHV = diffVar('h10', 'verity'),
      vHO = diffVar('h10', 'o2'),
      vVO = diffVar('verity', 'o2');
    const c = stats().threeCorneredHat(vHV, vHO, vVO);
    const hat = { h10: c.a >= 0 ? Math.sqrt(c.a) : null, verity: c.b >= 0 ? Math.sqrt(c.b) : null, o2: c.c >= 0 ? Math.sqrt(c.c) : null };
    const rho = { hv: corr(E.h10, E.verity), ho: corr(E.h10, E.o2), vo: corr(E.verity, E.o2) };
    return { ok: true, n: ks.length, trueSd, bias, hat, rho, vars: { hv: vHV, ho: vHO, vo: vVO } };
  }
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
  const REFERENCE_AXES = ['device', 'corrected'];
  const REF_AXIS_DEFAULT = 'device';
  /* §∅ — A BEAT THAT CANNOT BE PLACED IS DROPPED, NEVER PLACED AT t0. The corrected branch refuses the
   whole night when the record carries no `tMsAt` or a `refIdx` that is not aligned with `nn`: a
   silent fall back to the device axis would make a corrected-axis row a device-axis row wearing the
   other label, which is the very confusion this option exists to end. `applied` reports
   `rec.tMsCorrected`, so a reader can tell "placed on the corrected axis" from "the correction was
   live", which are different gates (`ecgdex-dsp.js:5612`). */
  function referenceBeatTimes(rec, r, refAxis) {
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

  /* The firmware leg for one night, as `tools/tch-firmware-reference.mjs scoreNightDir` ran it inline.
     `dev` = `ECGDSP.parseDeviceRR` rows. Each 600-beat firmware window is carried onto the ECG
     beats' axis by its own coincidence lag; a window with fewer than 50 nearby beats, or with no lag
     peak, is skipped. Returns the per-second reference map, or a named refusal (§∅: never an empty
     map that reads as a night with no agreement). */
  function buildReference(rec, r, dev, refAxis) {
    const ref = referenceBeatTimes(rec, r, refAxis);
    if (ref.reason) return { ok: false, reason: ref.reason, ref, cp: null, REF: null };
    const selfMs = ref.ms,
      selfNN = ref.nn;
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
    return { ok: true, reason: null, ref, cp, REF: perSecondMedian(cp.pairs) };
  }

  const TrioReference = {
    AGREE_MS,
    MIN_SECONDS,
    KEYS,
    REFERENCE_AXES,
    REF_AXIS_DEFAULT,
    median,
    corr,
    firmwareHostTimes,
    pairByTime,
    coincidenceLag,
    consensusPairs,
    perSecondMedian,
    scoreSeries,
    referenceBeatTimes,
    buildReference
  };
  root.TrioReference = TrioReference;
  if (typeof module !== 'undefined' && module.exports) module.exports = TrioReference;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
