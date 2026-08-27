/*
 * pat-align.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ANCHOR-BASED INTER-DEVICE ALIGNMENT — extracted from pat-feasibility-worker.js
 * (PAT-FEASIBILITY-2026-07-08 `estimateDriftACC`) so it can be tested, and reused.
 *
 * WHY ANCHORS. Two devices worn on one body see the same movements at the same true instant —
 * mechanically, with no pulse delay. But correlating their whole signals does NOT recover the
 * offset: as the original put it, "fixed windows drown a shared whole-body turn in decorrelated
 * background". Most of a night is each sensor's own local noise, so a whole-series correlation is
 * broad and flat. Measured while trying exactly that on the reference corpus, a respiration pairing
 * produced a best-lag margin of 0.02 over the runner-up and scattered across ±105 min.
 *
 * The fix is to spend the correlation only where there is information: detect STRONG ISOLATED
 * movements on one device, and cross-correlate a tight window around each against the other. Each
 * such anchor is an independent estimate of the offset AT THAT MOMENT, so a handful of them both
 * pins the offset and traces its drift — with no user taps and no reference clock.
 *
 * Everything here is pure: arrays in, numbers out. No DOM, no workers, no I/O.
 *
 * Exposes: window.PATAlign = { envelope, findAnchors, lagAtAnchor, alignByAnchors, DEFAULTS }
 */
(function (root) {
  'use strict';

  var DEFAULTS = {
    dtMs: 50, // envelope bin — 20 Hz is ample for body movement
    emaAlpha: 0.02, // baseline tracker; the envelope is |g - baseline|
    anchorSigma: 4, // a movement must exceed mean + 4σ to be an anchor
    anchorLocalBins: 12, // …and be the local maximum within ±this many bins
    anchorMinGapMs: 3000, // …and be ≥3 s from the previous anchor
    windowHalfMs: 1600, // half-width of the correlation window around an anchor
    maxLagMs: 1600, // ± search range around the anchor
    minCorr: 0.6, // an anchor is only used if its best correlation clears this
    minOverlapFrac: 0.85, // a lag is only scored if this much of the window is in range
    minAnchors: 2
  };

  /* Motion envelope on a fixed grid: per bin, the largest deviation of |acc| from its slow EMA
     baseline. Deviation, not raw magnitude, because gravity dominates |acc| and is posture-dependent
     — two devices on different body segments never agree on it, but they do agree on the DISTURBANCE.
     `samples` is [{tMs, x, y, z}] or [{tMs, v}] (v = an already-scalar activity measure). */
  function envelope(samples, t0, t1, opts) {
    opts = opts || {};
    var dt = opts.dtMs != null ? opts.dtMs : DEFAULTS.dtMs;
    var alpha = opts.emaAlpha != null ? opts.emaAlpha : DEFAULTS.emaAlpha;
    if (!samples || samples.length < 20 || !(t1 > t0)) return null;
    var ng = Math.max(1, Math.floor((t1 - t0) / dt) + 1);
    var grid = new Float32Array(ng);
    var ema = null;
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      if (!s || s.tMs == null || !isFinite(s.tMs)) continue;
      var g = s.v != null ? s.v : Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
      if (!isFinite(g)) continue;
      ema = ema == null ? g : ema + alpha * (g - ema);
      var b = Math.floor((s.tMs - t0) / dt);
      var d = Math.abs(g - ema);
      if (b >= 0 && b < ng && d > grid[b]) grid[b] = d;
    }
    return grid;
  }

  /* Bins carrying a STRONG, ISOLATED movement: above mean + kσ, a local maximum, and separated from
     the previous anchor. All three matter — the threshold alone fires repeatedly across one long
     turn, and every extra hit on the same event is a correlated vote, not an independent one. */
  function findAnchors(env, opts) {
    opts = opts || {};
    var dt = opts.dtMs != null ? opts.dtMs : DEFAULTS.dtMs;
    var kSigma = opts.anchorSigma != null ? opts.anchorSigma : DEFAULTS.anchorSigma;
    var localBins = opts.anchorLocalBins != null ? opts.anchorLocalBins : DEFAULTS.anchorLocalBins;
    var minGapMs = opts.anchorMinGapMs != null ? opts.anchorMinGapMs : DEFAULTS.anchorMinGapMs;
    var half = Math.round((opts.windowHalfMs != null ? opts.windowHalfMs : DEFAULTS.windowHalfMs) / dt);
    var out = [];
    if (!env || !env.length) return out;
    var ng = env.length,
      m = 0;
    for (var i = 0; i < ng; i++) m += env[i];
    m /= ng;
    var v = 0;
    for (var i2 = 0; i2 < ng; i2++) {
      var d = env[i2] - m;
      v += d * d;
    }
    var sd = Math.sqrt(v / ng) || 1;
    var thr = m + kSigma * sd,
      last = -1e9;
    for (var c = half; c + half < ng; c++) {
      if (env[c] < thr) continue;
      var isMax = true;
      for (var k = c - localBins; k <= c + localBins; k++) {
        if (k >= 0 && k < ng && env[k] > env[c]) {
          isMax = false;
          break;
        }
      }
      if (!isMax) continue;
      if ((c - last) * dt < minGapMs) continue;
      out.push(c);
      last = c;
    }
    return out;
  }

  /* Normalized cross-correlation of B against A over one window, with PARABOLIC sub-bin refinement:
     the true offset rarely lands on a bin centre, and fitting the three points around the peak
     recovers the fraction — which is what turns a 50 ms grid into a sub-10 ms estimate. Returns null
     when the best correlation does not clear `minCorr`, so a window without a genuinely shared event
     contributes nothing rather than a confident wrong number. */
  function lagAtAnchor(A, B, centre, opts) {
    opts = opts || {};
    var dt = opts.dtMs != null ? opts.dtMs : DEFAULTS.dtMs;
    var half = Math.round((opts.windowHalfMs != null ? opts.windowHalfMs : DEFAULTS.windowHalfMs) / dt);
    var maxLag = Math.round((opts.maxLagMs != null ? opts.maxLagMs : DEFAULTS.maxLagMs) / dt);
    var lagBias = Math.round((opts.lagBiasMs != null ? opts.lagBiasMs : 0) / dt); // centre of the search
    var minCorr = opts.minCorr != null ? opts.minCorr : DEFAULTS.minCorr;
    var minOv = opts.minOverlapFrac != null ? opts.minOverlapFrac : DEFAULTS.minOverlapFrac;
    if (!A || !B) return null;
    var ng = B.length,
      s = centre - half,
      e = centre + half;
    if (s < 0 || e > A.length) return null;
    var aMean = 0;
    for (var i = s; i < e; i++) aMean += A[i];
    aMean /= e - s;
    var corrs = new Float64Array(2 * maxLag + 1);
    var best = -2,
      bestK = 0;
    for (var lag = -maxLag; lag <= maxLag; lag++) {
      var shift = lag + lagBias;
      var bMean = 0,
        cnt = 0;
      for (var i2 = s; i2 < e; i2++) {
        var j = i2 + shift;
        if (j < 0 || j >= ng) continue;
        bMean += B[j];
        cnt++;
      }
      if (cnt < (e - s) * minOv) {
        corrs[lag + maxLag] = -2;
        continue;
      }
      bMean /= cnt;
      var sa = 0,
        sb = 0,
        sab = 0;
      for (var i3 = s; i3 < e; i3++) {
        var j2 = i3 + shift;
        if (j2 < 0 || j2 >= ng) continue;
        var da = A[i3] - aMean,
          db = B[j2] - bMean;
        sa += da * da;
        sb += db * db;
        sab += da * db;
      }
      var corr = sab / (Math.sqrt(sa * sb) || 1e-9);
      corrs[lag + maxLag] = corr;
      if (corr > best) {
        best = corr;
        bestK = lag + maxLag;
      }
    }
    if (!(best > minCorr)) return null;
    var lagRef = bestK - maxLag;
    if (bestK > 0 && bestK < 2 * maxLag) {
      var y1 = corrs[bestK - 1],
        y2 = corrs[bestK],
        y3 = corrs[bestK + 1],
        den = y1 - 2 * y2 + y3;
      if (den < 0 && y1 > -2 && y3 > -2) {
        var frac = (0.5 * (y1 - y3)) / den;
        if (frac > -1 && frac < 1) lagRef += frac;
      }
    }
    return { offsetMs: (lagRef + lagBias) * dt, corr: best };
  }

  /* Full pass: envelope A's anchors → a per-anchor offset against B. The anchors ARE the result —
     their spread is the drift, their median the standing offset. */
  function alignByAnchors(envA, envB, t0, opts) {
    opts = opts || {};
    var dt = opts.dtMs != null ? opts.dtMs : DEFAULTS.dtMs;
    var minAnchors = opts.minAnchors != null ? opts.minAnchors : DEFAULTS.minAnchors;
    var minGapMs = opts.anchorMinGapMs != null ? opts.anchorMinGapMs : DEFAULTS.anchorMinGapMs;
    if (!envA || !envB) return { ok: false, reason: 'missing envelope', anchors: [] };
    /* Candidate scan and correlation run in ONE pass, and the spacing counter advances only when an
       anchor is ACCEPTED — matching the original inline implementation exactly. A candidate whose
       correlation fails therefore does not block the next one 3 s later, which is the behaviour the
       PAT feasibility numbers were validated against. (Separating the two loops looks cleaner and is
       a different algorithm: it changed the anchor count on a real 7.1 h night. An extraction has to
       preserve behaviour; improving it is a separate, deliberate change.) */
    var cand = findAnchors(envA, Object.assign({}, opts, { anchorMinGapMs: 0 })),
      anchors = [],
      lastAccepted = -1e9;
    for (var i = 0; i < cand.length; i++) {
      var c = cand[i];
      if ((c - lastAccepted) * dt < minGapMs) continue;
      var r = lagAtAnchor(envA, envB, c, opts);
      if (!r) continue;
      anchors.push({ tMs: t0 + c * dt, offsetMs: r.offsetMs, corr: r.corr });
      lastAccepted = c;
    }
    if (anchors.length < minAnchors) return { ok: false, reason: 'too few clean shared movements (' + anchors.length + ')', anchors: anchors, candidates: cand.length };
    var offs = anchors
      .map(function (a) {
        return a.offsetMs;
      })
      .sort(function (a, b) {
        return a - b;
      });
    var med = offs.length % 2 ? offs[offs.length >> 1] : (offs[(offs.length >> 1) - 1] + offs[offs.length >> 1]) / 2;
    return {
      ok: true,
      anchors: anchors,
      candidates: cand.length,
      medianOffsetMs: med,
      offsetRangeMs: offs[offs.length - 1] - offs[0],
      minOffsetMs: offs[0],
      maxOffsetMs: offs[offs.length - 1]
    };
  }

  /* R-peak -> peripheral foot pairing, with the PHYSIOLOGICAL WINDOW ENFORCED.
     Extracted from pat-feasibility-worker.js `coupledPAT` so it can be gated, and carrying the fix
     that measurement forced.

     THE DEFECT. The original accepted the first foot with `lag >= 0` inside a 2000 ms search span,
     while declaring a physiological window (200-650 ms) that only ever fed a display diagnostic. But
     2000 ms is WIDER THAN ONE RR INTERVAL (~1200 ms at 50 bpm), so any missed foot — a detection
     dropout, a motion-rejected beat — let the NEXT beat's foot be accepted as this beat's PAT, and the
     reported value jumped a whole cardiac cycle.

     Measured over 24 pairings on two corpora: `driftRange` read 900-1250 ms while `residIQR` stayed
     at 8-45 ms, drift/RR clustered at 0.85-0.98, and the per-bin medians were BIMODAL exactly one RR
     apart. A night cannot have 8 ms of beat-to-beat scatter and 1058 ms of genuine clock wander. The
     "inter-device drift" the PAT go/no-go gate was rejecting on was beat-slip.

     Enforcing the window makes slip STRUCTURALLY impossible (PHYS_HI < 1 RR): a beat whose foot is
     genuinely absent now contributes NOTHING rather than a wrong value. `matchRate` consequently
     reports real coupling instead of a trivially-high number.

     ⚠️ `driftRange` is still NOT a clock-drift estimator — post-fix it tracks the window width under
     low coupling (~420 ms vs a 450 ms window). It is returned for continuity, never as drift.

     ── SECOND DEFECT, fixed 2026-08-04: the DENOMINATOR counted uncoverable beats ──────────────────
     `matchRate` was `pairs.length / R.length` — every R-peak in the ECG recording, including those
     the PPG recording does not span at all. A beat with no optical coverage cannot be paired, so it
     was counted as a coupling failure. The statistic therefore measured RECORDING OVERLAP as much as
     coupling, and the two devices routinely disagree on length (different batteries, different BLE
     reconnect patterns; a night in this corpus is dozens of fragments per device).

     The consequence is not cosmetic — it flips the gate. `pat-gate.js` bars on `COUPLING_MIN 0.55`,
     so pairing a perfectly-coupled 2 h ECG with the 1 h PPG that overlaps it scored 0.50, FAILED the
     `goodMatch` leg and was downgraded from `go`/FEASIBLE to `maybe`/PROMISING — with every other leg
     (tightBeat, physical, driftOK) identical, so the only thing separating the two verdicts was how
     long the ECG ran. And `overlap()` already reports the shared span as its OWN gate leg (`ov.min`),
     so the overlap fact was being counted twice while the coupling fact was not measured at all.

     The denominator is now the R-peaks inside the SHARED span, which both trains already determine —
     no new parameter, no caller change. The pre-fix value is kept as `matchRateRaw` for continuity.
     Where the trains have equal extent (the common case, and every pre-existing test) the two are
     identical, which is why nothing caught this. */
  var PHYS = { LO_MS: 200, HI_MS: 650 };
  function coupleRtoFoot(rTimes, fTimes, opts) {
    opts = opts || {};
    var lo = opts.physLoMs != null ? opts.physLoMs : PHYS.LO_MS;
    var hi = opts.physHiMs != null ? opts.physHiMs : PHYS.HI_MS;
    var minPairs = opts.minPairs != null ? opts.minPairs : 20;
    var R = rTimes || [],
      F = fTimes || [],
      nf = F.length;
    var pairs = [],
      j = 0;
    for (var i = 0; i < R.length; i++) {
      var r = R[i];
      while (j < nf && F[j] < r) j++;
      for (var k = j; k < nf; k++) {
        var lag = F[k] - r;
        if (lag > hi) break; // past the window — this beat's foot is missing, contribute nothing
        if (lag >= lo) {
          pairs.push({ tMs: r, patMs: lag });
          break;
        }
      }
    }
    if (pairs.length < minPairs) return { ok: false, reason: 'too few R->foot pairs in the physiological window (' + pairs.length + ')', pairs: pairs.length, nR: R.length };
    var lags = pairs.map(function (p) {
      return p.patMs;
    });
    var srt = lags.slice().sort(function (a, b) {
      return a - b;
    });
    var q = function (t) {
      var x = (srt.length - 1) * t,
        l = Math.floor(x),
        h = Math.ceil(x);
      return l === h ? srt[l] : srt[l] + (srt[h] - srt[l]) * (x - l);
    };
    /* Beats the PPG could physically have covered. A foot for beat r can only exist at r+[lo,hi], so
       the last coverable R is F[last]-lo, not F[last]. Using the raw span would still count the final
       few beats as failures. */
    var nCoverable = 0;
    if (F.length) {
      var wLo = F[0] - hi,
        wHi = F[nf - 1] - lo;
      for (var w = 0; w < R.length; w++) if (R[w] >= wLo && R[w] <= wHi) nCoverable++;
    }
    return {
      ok: true,
      pairs: pairs,
      matchRate: pairs.length / Math.max(nCoverable, 1),
      matchRateRaw: pairs.length / Math.max(R.length, 1), // pre-2026-08-04 value, kept for continuity
      nCoverable: nCoverable,
      medianPatMs: srt[srt.length >> 1],
      patIQRms: q(0.75) - q(0.25),
      minPatMs: srt[0],
      maxPatMs: srt[srt.length - 1]
    };
  }

  /* ── ΔPAT DIP DETECTION — the RELATIVE estimand (PAT-RELATIVE-REFRAME-2026-08-17) ────────────────
     Everything above serves ABSOLUTE PAT, whose own literature caps it at R²≈0.39 / ±17 mmHg against
     an intra-arterial line (Payne 2006). What sleep medicine validated is the DIP: a transient PAT
     fall of ~10-30 ms marking an autonomic arousal — 15.1±1.4 ms at provoked arousals and 9.9 ms even
     without visible EEG change (Pitson 1994); catching 80-91 % of respiratory events against EEG's
     43-55 % (Katz 2003); indexing OSA severity and CPAP response (Schwartz 2005). DOIs and the full
     argument live in the brief; per the citation policy, moving them into this file's prose is what
     requires CITATION-VERIFICATION entries — the brief carries them.

     WHY THIS ESTIMAND SURVIVES THE BLOCKERS THAT STOP ABSOLUTE PAT HERE:
       · the ~2.2 s per-connection BLE offset is NOT constant within a connection, and the sentence
         that stood here — "a within-connection difference cancels it exactly" — was measured FALSE on
         2026-08-27 (`tools/pat-connection-stability.mjs`, 14 nights, 31 connections, capture-host
         corpus): first-half vs second-half offset differs by a median of 43.8 ms, p90 142.9 ms, max
         815.6 ms, and 8 of 31 connections (26 %) exceed the ±90 ms PAT tolerance. `segments` still
         gate runs — a reconnect IS a genuine discontinuity — but they are not what makes the dip safe.
         WHAT ACTUALLY PROTECTS THE DIP is the centered rolling-median baseline below: the dip is read
         against a LOCAL baseline over `baselineWinMs`, not against the connection start, and over one
         60 s window that same drift is a median of 1.18 ms (p90 9.37, max 47.16) against Θ = 10 ms.
         ⚠ QUOTED WITH ITS WINDOW, because a drift without one is as underdetermined as a ppm without
         its span (§🔒.7): 43.8 ms is per CONNECTION, 1.18 ms is per BASELINE WINDOW, and only the
         second is the quantity the detector is exposed to.
         ⚠ THE TAIL IS NOT CLEARED, and this is deliberately left as a bound rather than a rate: the
         p90 (9.37 ms) is 94 % of Θ and the max (47.16 ms) is 4.7×Θ, both under `maxExcursionMs` so
         neither is rejected as an artifact. The measurement is a first/second-half FIT DIFFERENCE, so
         it cannot distinguish a slow RAMP — which a centered median largely tracks out — from a STEP,
         which it does not. So these figures bound the drift; they do NOT establish a fabrication rate.
         ⚠ SETTLED 2026-08-27, AND THE ANSWER IS THAT IT CANNOT BE SETTLED — "bound, not rate" is now
         the PERMANENT honest answer, not a placeholder. The residual shape was measured
         (`pat-connection-stability --json`, `baselineExposure`) under a pre-registered criterion:
         persistence threshold P ∈ {2.5,5,10,20,40} ms × horizon H ∈ {60,300} s, with a COUNT-MATCHED
         NULL CONTROL at random non-run positions. Both pre-stated bars failed:
           · the step fraction swings 33.5 pp across P ∈ [5,20] (bar: ≤10 pp), so it is a property of
             the threshold, not of the data;
           · real runs persist at 0.96-1.08× the null in EVERY one of the ten cells (bar: ≥2×), so the
             classification carries NO information about runs — random positions persist identically.
         THE REASON IS IDENTIFIABILITY, not sample size: the observable is lag = BLE offset + true PAT,
         and within one connection there is no independent handle on either term. A step and a dip
         differ in shape, but ambient drift makes every position look like a step at the same rate, so
         shape cannot recover the split. More nights will not fix this; a second, offset-only observable
         would. Until one exists, the p90/max figures above are a BOUND and any "fabrication rate"
         derived from this data is an artifact of its own threshold;
       · the anatomical sign of the LEVEL is irrelevant — only the excursion is read;
       · PEP is an amplifier, not a confound, at arousal (sympathetic activation shortens both PEP
         and vascular transit) — which is also why the output is an AUTONOMIC index and must never
         be surfaced as BP or "vascular";
       · no absolute plausibility window is needed, so PHYS cannot censor (§6.2's w/√12 family).

     DESIGN NOTES, each earned by a prior defect in this file's history:
       · pairing is NEAREST-fiducial, both directions — but a |lag − baseline| beyond
         `maxExcursionMs` is an ARTIFACT (a beat-slip is ~1 RR ≈ 1000 ms; a real dip is <60 ms), so
         slip cannot fabricate a dip NOR poison the baseline (it is excluded from the median input).
         This is how the beat-slip lesson of `coupleRtoFoot` is honoured without importing PHYS.
       · the baseline is a CENTERED rolling median over `baselineWinMs`: a 5-15 s dip inside a 60 s
         window is ≤25 % contamination, well under a median's breakdown point, so the dip does not
         drag its own reference down (the mean would).
       · a pairing gap > `maxGapMs`, a segment boundary, or an artifact beat BREAKS a run — a dip
         must be contiguous evidence, not a pattern stitched across a dropout.
       · dips are FALLS only. A symmetric rise is not an arousal signature (a PAT rise = BP fall);
         counting both would double the false-positive surface for nothing. */
  var DIP_DEFAULTS = {
    baselineWinMs: 60000, // centered rolling-median window
    minDipMs: 10, // Θ: fall below baseline that counts (Pitson: 15.1 cortical, 9.9 subcortical)
    minBeats: 4, // consecutive beats below Θ before an event is declared
    maxExcursionMs: 120, // |lag − baseline| beyond this = artifact/slip, never a dip
    maxGapMs: 5000, // a pairing gap longer than this breaks any run
    minPairs: 240 // ~4 min of beats — below this, refuse rather than index noise
  };

  /* Nearest-foot lag per R-peak. Sign-agnostic on the LEVEL (the per-connection offset may put the
     nominal lag anywhere, including negative); the dip logic reads only deviations from baseline.
     BOTH trains are sorted defensively: the two-pointer walk assumes monotone times, and a foot train
     is NOT guaranteed monotone in the wild — a detector glitch or a post-reconnect re-emission can
     interleave, and an unsorted train silently makes "nearest" wrong (found by the slip twin, whose
     +1 RR feet legitimately leapfrog their successors). */
  function _nearestLags(R, F) {
    var Rs = (R || []).slice().sort(function (a, b) {
      return a - b;
    });
    var Fs = (F || []).slice().sort(function (a, b) {
      return a - b;
    });
    var out = [],
      j = 0,
      nf = Fs.length;
    for (var i = 0; i < Rs.length; i++) {
      var r = Rs[i];
      while (j + 1 < nf && Math.abs(Fs[j + 1] - r) <= Math.abs(Fs[j] - r)) j++;
      if (nf) out.push({ tMs: r, lagMs: Fs[j] - r });
    }
    return out;
  }

  function patDipEvents(rTimes, fTimes, opts) {
    opts = opts || {};
    var W = opts.baselineWinMs != null ? opts.baselineWinMs : DIP_DEFAULTS.baselineWinMs;
    var THETA = opts.minDipMs != null ? opts.minDipMs : DIP_DEFAULTS.minDipMs;
    var NBEATS = opts.minBeats != null ? opts.minBeats : DIP_DEFAULTS.minBeats;
    var MAXEX = opts.maxExcursionMs != null ? opts.maxExcursionMs : DIP_DEFAULTS.maxExcursionMs;
    var MAXGAP = opts.maxGapMs != null ? opts.maxGapMs : DIP_DEFAULTS.maxGapMs;
    var MINP = opts.minPairs != null ? opts.minPairs : DIP_DEFAULTS.minPairs;
    var segs = opts.segments || null; // [[t0,t1],…] BLE-connection spans; runs never cross them

    /* SURROGATE MODE — `shiftFeetMs` circularly rotates the foot train within its own span before
       anything else runs. This is the estimand's honest null (the event-coupling.js philosophy):
       both trains keep their marginal statistics — every foot interval, every R interval — and only
       the ALIGNMENT is destroyed, so whatever survives is the alignment. It lives INSIDE the
       detector, not in a harness, so the null takes the identical code path: same pairing, same
       shadowing, same baseline, same hysteresis. A null that runs a different pipeline measures the
       difference between pipelines. */
    var F0 = fTimes || [];
    if (opts.shiftFeetMs) {
      var srtF = F0.slice().sort(function (a, b) {
        return a - b;
      });
      if (srtF.length > 1) {
        var span = srtF[srtF.length - 1] - srtF[0],
          f0 = srtF[0];
        var sh = ((opts.shiftFeetMs % span) + span) % span;
        F0 = srtF.map(function (f) {
          return f0 + ((f - f0 + sh) % span);
        });
      }
    }

    var L = _nearestLags(rTimes || [], F0);
    if (L.length < MINP) return { ok: false, reason: 'too few R↔foot pairs (' + L.length + ' < ' + MINP + ')', nPairs: L.length };

    /* FOOT-GAP SHADOW — the slip twin's fabrication mode, closed at the source. A missed foot does
       not only lose one beat: the PREVIOUS beat's late (or next beat's early) foot then pairs with
       the wrong R at ≈ RR − (1 RR slip) — a pseudo-excursion of ±(RR − 1000) ≈ ±50 ms that sits
       INSIDE any sane artifact bound and reads as a perfect dip (measured by the twin: two 46 ms
       "events", 4-5 beats each, exactly at the planted slip stretches). The tell is not the lag —
       it is the FOOT TRAIN: a dropout leaves an inter-foot interval far from the running median
       (2× at the gap, and interleaved sub-0.5× where re-emitted feet land). So: any foot adjacent
       to an inter-foot interval outside [0.5×, 1.5×] the median is SUSPECT, and a beat that leans
       on a suspect foot is an artifact — a dip needs continuous optical evidence. */
    var Fs = F0.slice().sort(function (a, b) {
      return a - b;
    });
    var ffs = [];
    for (var fi = 1; fi < Fs.length; fi++) ffs.push(Fs[fi] - Fs[fi - 1]);
    var ffSorted = ffs.slice().sort(function (a, b) {
      return a - b;
    });
    var ffMed = ffSorted.length ? ffSorted[ffSorted.length >> 1] : 0;
    var suspect = {}; // foot TIME → true (times are unique enough at ms resolution for this purpose)
    for (var gi = 0; gi < ffs.length; gi++) {
      if (ffMed > 0 && (ffs[gi] > 1.5 * ffMed || ffs[gi] < 0.5 * ffMed)) {
        suspect[Fs[gi]] = true;
        suspect[Fs[gi + 1]] = true;
      }
    }
    var isSuspect = function (rT, lagMs) {
      return suspect[rT + lagMs] === true; // the paired foot's absolute time
    };

    var segOf = function (t) {
      if (!segs) return 0;
      for (var s = 0; s < segs.length; s++) if (t >= segs[s][0] && t <= segs[s][1]) return s;
      return -1; // outside every declared connection → excluded
    };

    /* Pass 1 — centered rolling median per beat, LEAVE-SELF-OUT. The beat's own lag is excluded
       from its baseline window, and the exclusion is load-bearing: over any locally MONOTONE stretch
       (a slow clock drift between the two axes is enough) the median of a centered window IS the
       centre element, so a self-inclusive baseline makes dev ≡ 0 exactly — measured on the first
       ankle-leg run as a 0.0 ms "noise floor" that was first misdiagnosed as fiducial quantization
       (the feet were 100 % fractional; the zeros were self-agreement). A statistic that contains the
       value it judges cannot deviate — the same self-reference family as §8's "a statistic whose
       reference comes from the data it tests cannot fail". */
    var half = W / 2,
      lo = 0,
      hi = 0,
      n = L.length;
    var base = new Array(n),
      dev = new Array(n);
    for (var i = 0; i < n; i++) {
      var t = L[i].tMs;
      while (lo < n && L[lo].tMs < t - half) lo++;
      while (hi < n && L[hi].tMs <= t + half) hi++;
      var win = [];
      for (var k = lo; k < hi; k++) if (k !== i) win.push(L[k].lagMs);
      if (!win.length) win.push(L[i].lagMs); // a beat alone in its window has no external reference
      win.sort(function (a, b) {
        return a - b;
      });
      base[i] = win[win.length >> 1];
      dev[i] = L[i].lagMs - base[i];
    }

    /* Pass 2 — dip runs with HYSTERESIS (Schmitt-style): a run is a contiguous stretch of
       dev ≤ −Θ/2, and it becomes an EVENT when ≥ NBEATS of it are CORE beats (dev ≤ −Θ). Without
       the two thresholds, one beat whose noise draw lands at −0.9 Θ splits a genuine arousal into
       fragments below NBEATS — measured by the straddle twin, where a real 8-beat, 15 ms dip
       vanished on a single −9.1 ms beat. The event bar stays on CORE beats, so the exit threshold
       adds no sensitivity to noise (a chance run needs NBEATS independent ≤ −Θ draws regardless).
       Runs are still broken by gaps, segment edges, artifacts, and suspect-foot beats. */
    var events = [],
      run = [],
      lastT = null,
      lastSeg = null;
    var flush = function () {
      var core = run.filter(function (b) {
        return b.d <= -THETA;
      });
      if (core.length >= NBEATS) {
        var depths = core.map(function (b) {
          return -b.d;
        });
        events.push({
          tMs: run[0].t,
          durMs: run[run.length - 1].t - run[0].t,
          nBeats: run.length,
          nCore: core.length,
          depthMs: Math.max.apply(null, depths),
          medianDepthMs: depths.slice().sort(function (a, b) {
            return a - b;
          })[depths.length >> 1]
        });
      }
      run = [];
    };
    var artifacts = 0;
    for (var m = 0; m < n; m++) {
      var b = { t: L[m].tMs, d: dev[m] };
      var sg = segOf(b.t);
      var broke = (lastT != null && b.t - lastT > MAXGAP) || (lastSeg != null && sg !== lastSeg) || sg === -1;
      if (broke) flush();
      lastT = b.t;
      lastSeg = sg;
      if (sg === -1) continue;
      if (Math.abs(b.d) > MAXEX || isSuspect(b.t, L[m].lagMs)) {
        artifacts++;
        flush(); // an artifact breaks a run; it never extends or seeds one
        continue;
      }
      if (b.d <= -THETA / 2) run.push(b);
      else flush();
    }
    flush();

    /* Covered time = beat-to-beat spans that could have hosted a run (gaps excluded), so the index
       has an honest denominator — an index over the wall span would dilute on fragmented nights. */
    var coveredMs = 0;
    for (var c = 1; c < n; c++) {
      var dt = L[c].tMs - L[c - 1].tMs;
      if (dt <= MAXGAP && segOf(L[c].tMs) !== -1 && segOf(L[c].tMs) === segOf(L[c - 1].tMs)) coveredMs += dt;
    }
    if (!(coveredMs > 0)) return { ok: false, reason: 'no covered span after gap/segment exclusion', nPairs: n };

    var absDev = dev
      .map(function (d) {
        return Math.abs(d);
      })
      .sort(function (a, b) {
        return a - b;
      });
    var floor = absDev[absDev.length >> 1];

    /* READABILITY REFUSAL — defined is not informative. When the per-beat noise floor exceeds the
       dip threshold itself, every "event" is four unlucky draws in a row and the index measures the
       noise, not arousals — measured on the first five real nights this ran: floors of 80-122 ms
       against Θ = 10 produced 54-78 "dips"/h with 56-62 ms "depths", i.e. ~Pitson × 4 at ~2× the
       plausible arousal rate, from a signal whose display-waveform feet carry 91.8 ms of foot-to-foot
       sd (PAT-COMPENDIUM §5.2). An index computed there is a well-formed number carrying no
       information, and the tool must say WHY rather than print it. The stats are still returned on
       the refusal so the caller can see how far from readable the night was. */
    if (floor > 2 * THETA) {
      return {
        ok: false,
        reason: 'noise floor ' + floor.toFixed(1) + ' ms > 2×Θ (' + 2 * THETA + ' ms) — per-beat scatter drowns dip-scale excursions',
        nPairs: n,
        coveredHr: coveredMs / 3600000,
        artifactShare: artifacts / n,
        medianAbsDevMs: floor,
        thetaMs: THETA
      };
    }
    /* …and the OPPOSITE degeneracy: a floor of ~0 with a dominant exactly-zero share means the
       deviations are DEGENERATE — either genuinely quantized fiducials (integer-sample feet on a
       coarse grid), or a baseline that contains the value it judges (the self-inclusion defect now
       fixed above — kept as a guard because a regression re-introducing it would resurface exactly
       here). Either way the floor statistic has no dynamic range and the index must not be read.
       The compendium's N-corner-hat trap (§8: "returns 0.00 ms … print the exactly-zero share"). */
    var zeroShare =
      absDev.filter(function (v) {
        return v === 0;
      }).length / absDev.length;
    if (floor === 0 && zeroShare > 0.25) {
      return {
        ok: false,
        reason: 'deviations are QUANTIZED (' + (100 * zeroShare).toFixed(0) + ' % exactly zero) — integer-sample fiducials; sub-sample the foot before indexing dips',
        nPairs: n,
        coveredHr: coveredMs / 3600000,
        artifactShare: artifacts / n,
        medianAbsDevMs: floor,
        zeroShare: zeroShare,
        thetaMs: THETA
      };
    }
    /* CHANCE LINE — an index without a null beside it is a number wearing a costume. Under a
       (deliberately optimistic) independence assumption, the expected rate of ≥NBEATS-core runs from
       noise alone is pairs/h × p^N × (1−p), with p MEASURED as the share of devs at or below −Θ —
       not a Gaussian guess. Optimistic because real devs are autocorrelated, so the true chance rate
       is HIGHER than this line; an observed index near or below it is therefore certainly noise,
       while an index well above it is only *candidate* signal (the shuffle null in the brief remains
       owed for any published claim). Measured on the first readable real night: floor 17 ms against
       Θ = 10 gave 76.8 dips/h — chance-dominated, and this line is what says so. */
    var pBelow =
      dev.filter(function (d) {
        return d <= -THETA;
      }).length / n;
    var pairsPerHr = n / (coveredMs / 3600000);
    var chancePerHr = pairsPerHr * Math.pow(pBelow, NBEATS) * (1 - pBelow);
    var idx = events.length / (coveredMs / 3600000);
    return {
      ok: true,
      events: events,
      dipIndexPerHr: idx,
      chanceIndexPerHr: chancePerHr,
      liftVsChance: chancePerHr > 0 ? idx / chancePerHr : idx > 0 ? Infinity : null,
      pBelowTheta: pBelow,
      nEvents: events.length,
      nPairs: n,
      coveredHr: coveredMs / 3600000,
      artifactShare: artifacts / n,
      medianAbsDevMs: floor, // the noise floor the Θ threshold competes with
      thetaMs: THETA
    };
  }

  var api = {
    envelope: envelope,
    findAnchors: findAnchors,
    lagAtAnchor: lagAtAnchor,
    alignByAnchors: alignByAnchors,
    coupleRtoFoot: coupleRtoFoot,
    patDipEvents: patDipEvents,
    PHYS: PHYS,
    DEFAULTS: DEFAULTS,
    DIP_DEFAULTS: DIP_DEFAULTS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PATAlign = api;
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : null);
