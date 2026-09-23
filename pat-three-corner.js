/*
 * pat-three-corner.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. See the LICENSE and
 * NOTICE files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ALL THREE PAT LEGS ON ONE 5-MIN GRID, AND A CLASSIC THREE-CORNERED HAT ON THEIR SCATTER.
 *
 * The per-night kernel of tools/pat-three-corner.mjs (which scored the same three legs from the rig),
 * made a plain classic script so pat-night.html's worker and any Node caller solve a night the SAME
 * way. PURE: beat times in, numbers out — no DSP, no I/O, no clock. The fiducials are the caller's
 * (pat-feasibility-worker.js: `ecgRpeakTimes` sub-sample R on the host-disciplined axis; `ppgFootTimes`
 * the intersecting-tangent foot from the 3-LED consensus on the measured per-sample axis — the
 * sanctioned pair, tools/pat-literature-spec.mjs rule 1; NOT PPGDSP.analyze().tt).
 *
 * THE MODEL. Three sites see one heart:  A = H10 chest ECG (R-peak)  ·  V = Verity foot (arm or ankle)
 * ·  R = O2Ring finger foot. Each leg is a first-foot-in-a-bounded-band pairing (rule 2: a beat whose
 * foot is not inside the band CONTRIBUTES NOTHING, so a dropped foot cannot pair with the next cycle —
 * `pat-align.js coupleRtoFoot`'s rejecting form, generalised to a band that may start below zero for
 * the pulse-to-pulse leg). Per 5-minute window the statistic is the BEAT-TO-BEAT SD of the lag (rule 3,
 * what the literature reports); IQR/1.349 rides beside it as the robust cross-check the rig tool used.
 * Then, if all three legs are present,
 *      Var(A−V) = σ²A + σ²V   Var(A−R) = σ²A + σ²R   Var(V−R) = σ²V + σ²R
 * the CLASSIC hat (ρ = 0, no truth corner — TCH-CORRELATED-SOLVE-KNIFE-EDGE: any ρ estimated from these
 * same series is circular). A NEGATIVE variance is a REFUSAL, never square-rooted.
 *
 * WHAT THE NUMBERS ARE NOT (PAT-COMPENDIUM ⛔ + §8, honoured in the output, not just the prose):
 *   · not absolute PAT — a per-connection BLE buffering offset δ spans seconds between nights; the
 *     within-window SCATTER is the quantity, the median lag is context and carries the sign only;
 *   · every σ is returned with `wRatio = σ ÷ (bandWidth/√12)` — a uniform on the band has that sd, and a
 *     ratio near 1 means the measurement is the window (§6.2, the most expensive trap in this family);
 *   · `repeatShare` per leg — an integer-sample fiducial makes the hat read 0.00 on a MAD of 0 (§8);
 *   · closure  lag(A→R) − lag(A→V) − lag(V→R)  is a TAUTOLOGY whenever both paths pick the same beat
 *     (2001/2001 on a synthetic train) — returned as `closureMs` with `closureVacuous: true` so a
 *     renderer can only ever draw it as a warning against itself;
 *   · the hat books real inter-site transit variation as sensor noise (§8, "two legs per site"): σ per
 *     site is "timing scatter AT that site", physiology included, not detector jitter alone.
 *
 * ERROR BUDGET (tools/pat-literature-spec.mjs): σ² = σ²sampling ⊕ σ²respiratory ⊕ σ²fiducial ⊕ σ²unexplained.
 * Sampling from each leg's two sample rates ((1000/fs)/√12 each, in quadrature); respiratory 4.3 ms
 * (3.44–5.12, PLOS One 2024); fiducial 5.69 ms (intersecting tangents RMSE). Published for ECG→PPG
 * legs; the pulse-to-pulse leg gets its sampling floor only — no published budget, so none is invented.
 *
 * Exposes: PATThreeCorner = { LEGS, SITES, RULES, LIT, lagsOf, windowLegs, hat, budget, solveNight }
 */
(function (root) {
  'use strict';
  var SITES = ['h10', 'verity', 'ring'];
  /* Bands per anatomy, mirrored from tools/pat-three-corner.mjs: chest→finger and chest→Verity include
     PEP (the Verity band reaches 900 for the ankle placement; the arm sits well inside it); the
     pulse-to-pulse leg is tens of ms either way, so its band is symmetric and narrower than one RR at
     any plausible sleeping rate — a wider one would let the pairing slip a whole beat. */
  var LEGS = [
    { key: 'hv', from: 'h10', to: 'verity', band: [80, 900], label: 'H10 → Verity' },
    { key: 'hr', from: 'h10', to: 'ring', band: [80, 700], label: 'H10 → O2Ring' },
    { key: 'vr', from: 'verity', to: 'ring', band: [-250, 250], label: 'Verity → O2Ring' }
  ];
  var RULES = {
    winMin: 5,
    minBeats: 100, // per stream per window
    rateLo: 30, // beats/min plausibility, per stream
    rateHi: 120,
    maxArtifact: 0.2, // share of RR outside [rrLo, rrHi]
    rrLo: 300,
    rrHi: 2000,
    minPairs: 30, // per leg per window
    histStepMs: 10,
    histLo: -250,
    histHi: 900
  };
  var LIT = {
    sigmaRespMs: 4.3, // 3.44–5.12 ms respiratory modulation, midpoint (PLOS One 2024 — cited with its DOI on pat-night.html
    // and in tools/pat-literature-spec.mjs, which derives these two constants; the ledger carries them there)
    sigmaFidMs: 5.69, // intersecting-tangent foot RMSE (same source)
    bandLoMs: 8.22, // published beat-to-beat PAT sd, traditional fiducials
    bandHiMs: 15.4,
    optimisedMs: 7.21 // optimised fiducial
  };
  var SQRT12 = Math.sqrt(12);

  function mean(a) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i];
    return a.length ? s / a.length : NaN;
  }
  function sd(a) {
    if (a.length < 2) return NaN;
    var m = mean(a),
      s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / (a.length - 1));
  }
  function sorted(a) {
    return a.slice().sort(function (x, y) {
      return x - y;
    });
  }
  function med(a) {
    if (!a.length) return NaN;
    var s = sorted(a),
      m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function iqr(a) {
    if (a.length < 4) return NaN;
    var s = sorted(a);
    return s[Math.floor(s.length * 0.75)] - s[Math.floor(s.length * 0.25)];
  }
  // share of lags that repeat another lag EXACTLY — the integer-sample tell (a continuous fiducial
  // on a measured axis repeats almost never; a quantised one repeats constantly)
  function repeatShare(a) {
    if (a.length < 2) return NaN;
    var s = sorted(a),
      rep = 0;
    for (var i = 1; i < s.length; i++) if (s[i] === s[i - 1]) rep++;
    return rep / (s.length - 1);
  }
  /* Per-stream artefact share on the RR range rule. This is the FALLBACK; the primary is PulseDex's
     `artifactClean` (the Malik rule the rest of the suite rejects beats with), which a caller INJECTS as
     `opts.artifactFrac` — the kernel stays pure and two callers with the same DSP loaded reject the same
     windows. tools/pat-three-corner.mjs uses PulseDex when it loads and this rule when it does not; the
     landing page's worker loads it, so both reject alike. Substituting one for the other silently would
     change which windows are kept without changing any number's name, which is how two tools come to
     disagree for reasons nobody can see. */
  function artifactFrac(times) {
    if (times.length < 11) return 1;
    var bad = 0;
    for (var i = 1; i < times.length; i++) {
      var rr = times[i] - times[i - 1];
      if (rr < RULES.rrLo || rr > RULES.rrHi) bad++;
    }
    return bad / (times.length - 1);
  }
  /* pair X→Y inside a band; the FIRST Y at or after x+lo is the candidate and it either lands inside
     the band or the beat contributes nothing — never the next cycle's foot */
  function lagsOf(X, Y, band) {
    var out = [],
      j = 0,
      lo = band[0],
      hi = band[1];
    for (var i = 0; i < X.length; i++) {
      var x = X[i];
      while (j < Y.length && Y[j] < x + lo) j++;
      if (j >= Y.length) break;
      var d = Y[j] - x;
      if (d >= lo && d <= hi) out.push(d);
    }
    return out;
  }
  function slice(times, a, b) {
    var out = [];
    for (var i = 0; i < times.length; i++) if (times[i] >= a && times[i] < b) out.push(times[i]);
    return out;
  }
  function streamOk(w, winMin, frac) {
    return w.length >= RULES.minBeats && w.length / winMin >= RULES.rateLo && w.length / winMin <= RULES.rateHi && (frac || artifactFrac)(w) <= RULES.maxArtifact;
  }
  // one window, all active legs — null legs mean "did not pair enough beats", never zero
  function windowLegs(win, legs) {
    var out = {};
    for (var i = 0; i < legs.length; i++) {
      var L = legs[i],
        lags = lagsOf(win[L.from], win[L.to], L.band);
      out[L.key] = lags.length >= RULES.minPairs ? { n: lags.length, med: med(lags), sd: sd(lags), iqr: iqr(lags), rep: repeatShare(lags), lags: lags } : null;
    }
    return out;
  }
  // classic hat on three pairwise variances; a non-positive corner is returned as null with its value
  function hat(vHV, vHR, vVR) {
    var a = (vHV + vHR - vVR) / 2,
      v = (vHV + vVR - vHR) / 2,
      r = (vHR + vVR - vHV) / 2;
    var sq = function (x) {
      return x > 0 ? Math.sqrt(x) : null;
    };
    return { h10: sq(a), verity: sq(v), ring: sq(r), varH10: a, varVerity: v, varRing: r, refused: !(a > 0 && v > 0 && r > 0) };
  }
  function budget(sigmaMs, fsFrom, fsTo, ecgLeg) {
    var q = function (fs) {
      return fs > 0 ? 1000 / fs / SQRT12 : null;
    };
    var qa = q(fsFrom),
      qb = q(fsTo);
    var samp = qa != null && qb != null ? Math.sqrt(qa * qa + qb * qb) : null;
    var resp = ecgLeg ? LIT.sigmaRespMs : null,
      fid = ecgLeg ? LIT.sigmaFidMs : null;
    var known = (samp == null ? 0 : samp * samp) + (resp == null ? 0 : resp * resp) + (fid == null ? 0 : fid * fid);
    var unexplained = sigmaMs == null || !isFinite(sigmaMs) ? null : Math.sqrt(Math.max(0, sigmaMs * sigmaMs - known));
    return { sigma: sigmaMs, samp: samp, resp: resp, fid: fid, unexplained: unexplained, published: !!ecgLeg };
  }
  /* solveNight({ legs: { h10:[ms], verity:[ms], ring:[ms] }, fs: { h10, verity, ring }, winMin,
                  artifactFrac })
     Any site may be absent; the legs between present sites are scored, the hat only with all three.
     `artifactFrac(times) → share` is injected by a caller that has PulseDex loaded (see above). */
  function solveNight(inp) {
    var T = (inp && inp.legs) || {},
      FS = (inp && inp.fs) || {},
      frac = (inp && inp.artifactFrac) || artifactFrac,
      winMin = (inp && inp.winMin) || RULES.winMin,
      wm = winMin * 60000;
    var present = [];
    for (var si = 0; si < SITES.length; si++) if (T[SITES[si]] && T[SITES[si]].length > RULES.minBeats) present.push(SITES[si]);
    var active = LEGS.filter(function (L) {
      return present.indexOf(L.from) >= 0 && present.indexOf(L.to) >= 0;
    });
    if (active.length === 0) return { skip: true, reason: 'fewer than two sites carry beats (' + present.join(', ') + ')', present: present };
    var t0 = -Infinity,
      tE = Infinity;
    for (var pi = 0; pi < present.length; pi++) {
      var a = T[present[pi]];
      if (a[0] > t0) t0 = a[0];
      if (a[a.length - 1] < tE) tE = a[a.length - 1];
    }
    if (!(tE > t0 + 2 * wm)) return { skip: true, reason: 'overlap of the present sites is under two windows', present: present, t0: t0, tE: tE };
    var windows = [],
      kept = 0,
      pool = {},
      hist = {},
      nb = Math.round((RULES.histHi - RULES.histLo) / RULES.histStepMs);
    for (var li = 0; li < active.length; li++) {
      pool[active[li].key] = [];
      hist[active[li].key] = new Array(nb).fill(0);
    }
    for (var s = t0; s + wm <= tE; s += wm) {
      var win = {},
        q = {},
        n = {},
        ok = true;
      for (var wi = 0; wi < present.length; wi++) {
        var k = present[wi];
        win[k] = slice(T[k], s, s + wm);
        n[k] = win[k].length;
        q[k] = streamOk(win[k], winMin, frac);
        if (!q[k]) ok = false;
      }
      var rec = { t: s, n: n, q: q, kept: false, legs: {} };
      if (ok) {
        var wl = windowLegs(win, active);
        var allLegs = true;
        for (var ai = 0; ai < active.length; ai++) if (!wl[active[ai].key]) allLegs = false;
        if (allLegs) {
          rec.kept = true;
          kept++;
          for (var bi = 0; bi < active.length; bi++) {
            var key = active[bi].key,
              w = wl[key];
            rec.legs[key] = { n: w.n, med: w.med, sd: w.sd, iqr: w.iqr, rep: w.rep };
            pool[key].push(w);
            for (var hi = 0; hi < w.lags.length; hi++) {
              var b = Math.floor((w.lags[hi] - RULES.histLo) / RULES.histStepMs);
              if (b >= 0 && b < nb) hist[key][b]++;
            }
          }
        }
      }
      windows.push(rec);
    }
    var legs = {};
    for (var ci = 0; ci < active.length; ci++) {
      var L = active[ci],
        P = pool[L.key];
      var sigmaSd = P.length
          ? med(
              P.map(function (w) {
                return w.sd;
              })
            )
          : null,
        sigmaIqr = P.length
          ? med(
              P.map(function (w) {
                return w.iqr;
              })
            ) / 1.349
          : null;
      legs[L.key] = {
        from: L.from,
        to: L.to,
        band: L.band,
        nWin: P.length,
        nPairs: P.reduce(function (t, w) {
          return t + w.n;
        }, 0),
        medLag: P.length
          ? med(
              P.map(function (w) {
                return w.med;
              })
            )
          : null,
        sigmaSd: sigmaSd,
        sigmaIqr: sigmaIqr,
        wRatio: sigmaSd == null ? null : sigmaSd / ((L.band[1] - L.band[0]) / SQRT12),
        repeatShare: P.length
          ? med(
              P.map(function (w) {
                return w.rep;
              })
            )
          : null,
        budget: budget(sigmaSd, FS[L.from], FS[L.to], L.from === 'h10'),
        hist: hist[L.key]
      };
    }
    var H = null,
      Hiqr = null,
      closureMs = null;
    if (active.length === 3 && kept > 0) {
      var v = function (f, k) {
        return legs[k][f] * legs[k][f];
      };
      H = hat(v('sigmaSd', 'hv'), v('sigmaSd', 'hr'), v('sigmaSd', 'vr'));
      Hiqr = hat(v('sigmaIqr', 'hv'), v('sigmaIqr', 'hr'), v('sigmaIqr', 'vr'));
      closureMs = med(
        windows
          .filter(function (w) {
            return w.kept;
          })
          .map(function (w) {
            return w.legs.hr.med - w.legs.hv.med - w.legs.vr.med;
          })
      );
    }
    return {
      skip: false,
      present: present,
      winMin: winMin,
      t0: t0,
      tE: tE,
      nWindows: windows.length,
      nKept: kept,
      windows: windows,
      legs: legs,
      hat: H,
      hatIqr: Hiqr,
      closureMs: closureMs,
      closureVacuous: true,
      hist: { lo: RULES.histLo, hi: RULES.histHi, step: RULES.histStepMs },
      artifactRule: frac === artifactFrac ? 'rr-range' : 'injected', // which rejection rule kept these windows
      rules: RULES,
      lit: LIT
    };
  }
  var api = { SITES: SITES, LEGS: LEGS, RULES: RULES, LIT: LIT, lagsOf: lagsOf, windowLegs: windowLegs, hat: hat, budget: budget, solveNight: solveNight, _artifactFrac: artifactFrac };
  if (root) root.PATThreeCorner = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
