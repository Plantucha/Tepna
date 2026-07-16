/*
 * pat-feasibility-worker.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * Worker lane for the PAT feasibility batch (PAT-FEASIBILITY-2026-07-08-BRIEF). One night
 * per lane: reads its own H10 _ECG.txt + Verity _PPG.txt File objects, runs the PRODUCTION
 * detectors (ECGDSP Pan-Tompkins R-peaks + PPGDSP 3-LED consensus feet), and returns the
 * coupling summary (shared-clock test, match rate, median lag, beat-to-beat IQR, drift +
 * ppm + linear-vs-wander, verdict). The raw ECG is multi-MB → NOTHING runs on the main
 * thread. The compute is byte-identical to the single-file engine (pat-feasibility.js).
 * Co-load order (CONTRIBUTING.md): kernel-constants → clock → DSPs; window→self shim first.
 */
if (typeof window === 'undefined') {
  self.window = self;
} // *-dsp.js reference `window` at load
// ESM-MIGRATION: importScripts SyntaxErrors on a dual-mode DSP's top-level `export`; fall back to
// fetch → DexBuild.classicify → eval (build-core.js is worker-safe, attaches DexBuild to self). No-op
// on classic files, so plain-global helpers load with unchanged scoping.
var _dexBuildLoaded = false;
function loadScript(url) {
  try {
    importScripts(url);
  } catch (e) {
    /* @blob-strip:start — served-only ESM co-load fallback (fetch → classicify → eval).
       DEAD in the build-analysis blob: deps are pre-inlined and importScripts is a no-op stub
       that never throws — build-analysis.mjs strips this region from __WSRC so the offline
       tools carry no transport primitive (no-network static lens). */
    if (!/\bexport\b|\bimport\b/.test(String((e && e.message) || e))) throw e;
    if (!_dexBuildLoaded) {
      importScripts('tools/build-core.js');
      _dexBuildLoaded = true;
    }
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.send();
    if (xhr.status && xhr.status >= 400) throw new Error('pat-feasibility-worker: fetch ' + url + ' → ' + xhr.status);
    (0, eval)(self.DexBuild.classicify(xhr.responseText));
    /* @blob-strip:end */
  }
}
var DSP_OK = false,
  DSP_ERR = '';
try {
  ['kernel-constants.js', 'clock.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js'].forEach(loadScript);
  DSP_OK = !!(typeof ECGDSP !== 'undefined' && ECGDSP.parseECG && typeof PPGDSP !== 'undefined' && PPGDSP.parsePPG);
} catch (e) {
  DSP_ERR = String((e && e.message) || e);
}

var LAG_SEARCH_MS = 2000,
  LAG_TOL_MS = 90,
  BIN_MIN = 5,
  PHYS_LO = 200,
  PHYS_HI = 650;

function median(a) {
  if (!a.length) return NaN;
  var b = a.slice().sort(function (x, y) {
    return x - y;
  });
  var m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}
function quantile(a, q) {
  if (!a.length) return NaN;
  var b = a.slice().sort(function (x, y) {
    return x - y;
  });
  var i = (b.length - 1) * q,
    lo = Math.floor(i),
    hi = Math.ceil(i);
  return lo === hi ? b[lo] : b[lo] + (b[hi] - b[lo]) * (i - lo);
}

function ecgRpeakTimes(text) {
  var rec = ECGDSP.parseECG(text);
  if (rec.t0Ms == null) throw new Error('ECG file carried no phone timestamp.');
  var bp = ECGDSP.bandpass(rec.int16, rec.fs);
  var peaks = ECGDSP.detectPeaks(rec.int16, bp, rec.fs);
  var t = new Float64Array(peaks.length);
  for (var i = 0; i < peaks.length; i++) t[i] = rec.t0Ms + (peaks[i] / rec.fs) * 1000;
  return { t0Ms: rec.t0Ms, fs: rec.fs, durSec: rec.durSec, times: t, n: peaks.length };
}
function ppgFootTimes(text) {
  var rec = PPGDSP.parsePPG(text);
  if (rec.t0Ms == null) throw new Error('PPG file carried no phone timestamp.');
  var per = rec.ch.map(function (c) {
    return PPGDSP.detectChannel(c, rec.fs);
  });
  var refIdx = 0,
    best = -1;
  per.forEach(function (p, i) {
    if (p.peaks.length > best) {
      best = p.peaks.length;
      refIdx = i;
    }
  });
  var cons = PPGDSP.consensusBeats(per, refIdx, rec.fs);
  var rel = rec.relSec,
    fs = rec.fs,
    t0 = rec.t0Ms,
    t = new Float64Array(cons.feet.length);
  for (var i = 0; i < cons.feet.length; i++) {
    var idx = cons.feet[i];
    var sec = rel && rel[idx] != null && isFinite(rel[idx]) ? rel[idx] : idx / fs;
    t[i] = t0 + sec * 1000;
  }
  return { t0Ms: rec.t0Ms, fs: rec.fs, durSec: rec.durSec, times: t, n: cons.feet.length };
}
function overlap(ecg, ppg) {
  var s = Math.max(ecg.t0Ms, ppg.t0Ms),
    e = Math.min(ecg.t0Ms + ecg.durSec * 1000, ppg.t0Ms + ppg.durSec * 1000);
  return { start: s, end: e, min: (e - s) / 60000 };
}
function sharedClock(ecg, ppg) {
  var dT0 = Math.abs(ecg.t0Ms - ppg.t0Ms),
    beatRatio = Math.abs(ecg.n - ppg.n) / Math.max(ecg.n, ppg.n, 1);
  return { dT0: dT0, beatRatio: beatRatio, ok: dT0 <= 5000 && beatRatio <= 0.12 };
}
function coupledPAT(rTimes, fTimes) {
  var lags = [],
    lagAtR = [],
    j = 0,
    nf = fTimes.length;
  for (var i = 0; i < rTimes.length; i++) {
    var r = rTimes[i];
    while (j < nf && fTimes[j] < r) j++;
    var k = j,
      bestLag = null;
    while (k < nf && fTimes[k] - r <= LAG_SEARCH_MS) {
      var lag = fTimes[k] - r;
      if (lag >= 0) {
        bestLag = lag;
        break;
      }
      k++;
    }
    if (bestLag != null) {
      lags.push(bestLag);
      lagAtR.push({ t: r, lag: bestLag });
    }
  }
  if (lags.length < 20) return { ok: false, reason: 'Too few R→foot pairs (' + lags.length + ') — no overlap or detection failed.' };
  var modal = median(lags),
    LOCAL_WIN_MS = 30000,
    pat = [],
    patAtR = [],
    resid = [],
    lo = 0,
    hi = 0;
  for (var m = 0; m < lagAtR.length; m++) {
    var tt0 = lagAtR[m].t;
    while (lo < lagAtR.length && lagAtR[lo].t < tt0 - LOCAL_WIN_MS) lo++;
    while (hi < lagAtR.length && lagAtR[hi].t <= tt0 + LOCAL_WIN_MS) hi++;
    var win = [];
    for (var wI = lo; wI < hi; wI++) win.push(lagAtR[wI].lag);
    var localMed = median(win),
      d0 = lagAtR[m].lag - localMed;
    if (Math.abs(d0) <= LAG_TOL_MS) {
      pat.push(lagAtR[m].lag);
      patAtR.push(lagAtR[m]);
      resid.push(d0);
    }
  }
  var matchRate = pat.length / rTimes.length;
  var residIQR = resid.length ? quantile(resid, 0.75) - quantile(resid, 0.25) : NaN;
  var t0 = patAtR.length ? patAtR[0].t : 0,
    bins = {};
  for (var p = 0; p < patAtR.length; p++) {
    var b = Math.floor((patAtR[p].t - t0) / (BIN_MIN * 60000));
    (bins[b] || (bins[b] = [])).push(patAtR[p].lag);
  }
  var binKeys = Object.keys(bins)
    .map(Number)
    .sort(function (a, b) {
      return a - b;
    });
  var binMed = binKeys.map(function (b) {
    return { min: b * BIN_MIN, med: median(bins[b]) };
  });
  var medVals = binMed.map(function (x) {
    return x.med;
  });
  var driftRange = medVals.length ? Math.max.apply(null, medVals) - Math.min.apply(null, medVals) : NaN;
  var slope = NaN,
    linR2 = NaN;
  if (binMed.length >= 3) {
    var n = binMed.length,
      sx = 0,
      sy = 0,
      sxx = 0,
      sxy = 0;
    binMed.forEach(function (d) {
      sx += d.min;
      sy += d.med;
      sxx += d.min * d.min;
      sxy += d.min * d.med;
    });
    var den = n * sxx - sx * sx || 1e-9,
      b1 = (n * sxy - sx * sy) / den,
      b0 = (sy - b1 * sx) / n;
    slope = b1 * 60;
    var ssTot = 0,
      ssRes = 0,
      my = sy / n;
    binMed.forEach(function (d) {
      var fit = b0 + b1 * d.min;
      ssRes += (d.med - fit) * (d.med - fit);
      ssTot += (d.med - my) * (d.med - my);
    });
    linR2 = ssTot > 0 ? 1 - ssRes / ssTot : NaN;
  }
  return {
    ok: true,
    modal: modal,
    patAtR: patAtR,
    pat: pat,
    med: median(pat),
    p25: quantile(pat, 0.25),
    p75: quantile(pat, 0.75),
    matchRate: matchRate,
    nCoupled: pat.length,
    residIQR: residIQR,
    binMed: binMed,
    driftRange: driftRange,
    slope: slope,
    linR2: linR2,
    inPhysPct: pat.length
      ? pat.filter(function (v) {
          return v >= PHYS_LO && v <= PHYS_HI;
        }).length / pat.length
      : 0
  };
}
function verdict(ov, cp, sc) {
  if (ov.min <= 0) return { tier: 'no', label: 'NO OVERLAP' };
  if (!cp.ok) return { tier: 'no', label: 'NOT COUPLED' };
  if (!sc.ok) return { tier: 'no', label: 'NOT SIMULTANEOUS' };
  var tightBeat = isFinite(cp.residIQR) && cp.residIQR <= 60,
    goodMatch = cp.matchRate >= 0.55;
  var physical = cp.med >= 60 && cp.med <= 700,
    driftMs = isFinite(cp.driftRange) ? cp.driftRange : Infinity;
  if (goodMatch && tightBeat && physical && driftMs <= 60) return { tier: 'go', label: 'FEASIBLE' };
  if (goodMatch && tightBeat && driftMs > 250) return { tier: 'no', label: 'DRIFT-DOMINATED' };
  if (tightBeat && physical) return { tier: 'maybe', label: 'PROMISING' };
  return { tier: 'maybe', label: 'WEAK COUPLING' };
}

// ── ACC-sync: trace the inter-device clock drift from shared body motion ─────
// Both the H10 (chest) and Verity (arm) accelerometers register the SAME sleep
// movements at the SAME true instant (mechanical, not pulse-delayed). Build each
// device's motion envelope on a common absolute-ms grid, then windowed normalized
// cross-correlation gives the relative clock offset wherever a real movement occurs.
// Those anchors trace the (non-linear) drift curve — no user taps needed.
function motionEnv(text, t0, t1, dt) {
  var rows = PPGDSP.parseSensorXYZ(text);
  if (rows.length < 20) return null;
  var ema = null,
    A = 0.02,
    ng = Math.max(1, Math.floor((t1 - t0) / dt) + 1),
    grid = new Float32Array(ng);
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.tMs == null) continue;
    var g = Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z);
    ema = ema == null ? g : ema + A * (g - ema);
    var b = Math.floor((r.tMs - t0) / dt),
      d = Math.abs(g - ema);
    if (b >= 0 && b < ng && d > grid[b]) grid[b] = d;
  }
  return grid;
}
function estimateDriftACC(h10Text, vText, t0, t1) {
  var dt = 50,
    A = motionEnv(h10Text, t0, t1, dt),
    B = motionEnv(vText, t0, t1, dt);
  if (!A || !B) return { ok: false, reason: 'ACC parse failed' };
  var ng = A.length,
    MAXLAG = Math.round(1600 / dt),
    EHALF = Math.round(1600 / dt);
  // EVENT-TRIGGERED matching (option 2): fixed windows drown a shared whole-body turn in
  // decorrelated chest-vs-ankle background. Instead, detect STRONG isolated movements on the
  // chest (H10) and do a tight ±1.6 s cross-correlation around each against the ankle (Verity),
  // locking only on the big turns that actually shake both segments.
  var mA = 0;
  for (var i = 0; i < ng; i++) mA += A[i];
  mA /= ng;
  var vA = 0;
  for (var i = 0; i < ng; i++) {
    var d = A[i] - mA;
    vA += d * d;
  }
  var sA = Math.sqrt(vA / ng) || 1;
  var thr = mA + 4 * sA,
    anchors = [],
    lastC = -1e9;
  for (var c = EHALF; c + EHALF < ng; c++) {
    if (A[c] < thr) continue;
    var isMax = true;
    for (var k = c - 12; k <= c + 12; k++) {
      if (k >= 0 && k < ng && A[k] > A[c]) {
        isMax = false;
        break;
      }
    }
    if (!isMax) continue;
    if ((c - lastC) * dt < 3000) continue; // ≥3 s between events
    var s = c - EHALF,
      e = c + EHALF,
      aMean = 0;
    for (var i = s; i < e; i++) aMean += A[i];
    aMean /= e - s;
    var corrs = new Float64Array(2 * MAXLAG + 1),
      best = -2,
      bestK = 0;
    for (var lag = -MAXLAG; lag <= MAXLAG; lag++) {
      var bMean = 0,
        cnt = 0;
      for (var i = s; i < e; i++) {
        var j = i + lag;
        if (j < 0 || j >= ng) continue;
        bMean += B[j];
        cnt++;
      }
      if (cnt < (e - s) * 0.85) {
        corrs[lag + MAXLAG] = -2;
        continue;
      }
      bMean /= cnt;
      var sa = 0,
        sb = 0,
        sab = 0;
      for (var i = s; i < e; i++) {
        var j = i + lag;
        if (j < 0 || j >= ng) continue;
        var da = A[i] - aMean,
          db = B[j] - bMean;
        sa += da * da;
        sb += db * db;
        sab += da * db;
      }
      var corr = sab / (Math.sqrt(sa * sb) || 1e-9);
      corrs[lag + MAXLAG] = corr;
      if (corr > best) {
        best = corr;
        bestK = lag + MAXLAG;
      }
    }
    if (best > 0.6) {
      // stricter: only clean shared events
      var lagRef = bestK - MAXLAG;
      if (bestK > 0 && bestK < 2 * MAXLAG) {
        var y1 = corrs[bestK - 1],
          y2 = corrs[bestK],
          y3 = corrs[bestK + 1],
          den = y1 - 2 * y2 + y3;
        if (den < 0 && y1 > -2 && y3 > -2) {
          var dd = (0.5 * (y1 - y3)) / den;
          if (dd > -1 && dd < 1) lagRef += dd;
        }
      }
      anchors.push({ t: t0 + c * dt, off: lagRef * dt, corr: best });
      lastC = c;
    }
  }
  if (anchors.length < 2) return { ok: false, reason: 'too few clean shared movements (' + anchors.length + ') — chest & ankle motion too decorrelated', anchors: anchors.length };
  anchors.sort(function (a, b) {
    return a.t - b.t;
  });
  var cov = (anchors[anchors.length - 1].t - anchors[0].t) / (t1 - t0 || 1);
  function offsetAt(t) {
    if (t <= anchors[0].t) return anchors[0].off;
    if (t >= anchors[anchors.length - 1].t) return anchors[anchors.length - 1].off;
    for (var i = 1; i < anchors.length; i++)
      if (t <= anchors[i].t) {
        var a = anchors[i - 1],
          b = anchors[i],
          f = (t - a.t) / (b.t - a.t || 1);
        return a.off + f * (b.off - a.off);
      }
    return anchors[anchors.length - 1].off;
  }
  return {
    ok: true,
    anchors: anchors.length,
    coverage: cov,
    offsetAt: offsetAt,
    offRange:
      Math.max.apply(
        null,
        anchors.map(function (a) {
          return a.off;
        })
      ) -
      Math.min.apply(
        null,
        anchors.map(function (a) {
          return a.off;
        })
      )
  };
}

self.onmessage = function (e) {
  var m = e.data || {};
  if (m.type === 'ping') {
    self.postMessage({ type: 'ready', ok: DSP_OK, err: DSP_ERR });
    return;
  }
  if (m.type !== 'job') return;
  var key = m.key;
  if (!DSP_OK) {
    self.postMessage({ type: 'result', key: key, error: 'DSP modules failed to load: ' + DSP_ERR });
    return;
  }
  var reads = [m.ecgFile.text(), m.ppgFile.text()];
  var hasAcc = !!(m.ecgAccFile && m.ppgAccFile);
  if (hasAcc) {
    reads.push(m.ecgAccFile.text(), m.ppgAccFile.text());
  }
  Promise.all(reads)
    .then(function (t) {
      try {
        var ecg = ecgRpeakTimes(t[0]),
          ppg = ppgFootTimes(t[1]);
        var ov = overlap(ecg, ppg),
          cp = coupledPAT(ecg.times, ppg.times),
          sc = sharedClock(ecg, ppg),
          vd = verdict(ov, cp, sc);
        var ppm = ov.min > 0 && isFinite(cp.driftRange) ? (cp.driftRange / (ov.min * 60000)) * 1e6 : NaN;
        function packCp(c) {
          return c.ok
            ? {
                ok: true,
                med: c.med,
                p25: c.p25,
                p75: c.p75,
                matchRate: c.matchRate,
                nCoupled: c.nCoupled,
                residIQR: c.residIQR,
                driftRange: c.driftRange,
                slope: c.slope,
                linR2: c.linR2,
                inPhysPct: c.inPhysPct,
                ppm: ov.min > 0 && isFinite(c.driftRange) ? (c.driftRange / (ov.min * 60000)) * 1e6 : NaN,
                binMed: c.binMed
              }
            : { ok: false, reason: c.reason };
        }
        var out = {
          type: 'result',
          key: key,
          label: m.label,
          ecg: { t0Ms: ecg.t0Ms, fs: ecg.fs, n: ecg.n, durSec: ecg.durSec },
          ppg: { t0Ms: ppg.t0Ms, fs: ppg.fs, n: ppg.n, durSec: ppg.durSec },
          ov: ov,
          sc: sc,
          vd: vd,
          cp: packCp(cp)
        };
        // ── ACC-sync stage (only if both accelerometer files were provided) ──
        var cpCorr = null,
          drift = null;
        if (hasAcc && sc.ok && ov.min > 0) {
          drift = estimateDriftACC(t[2], t[3], ov.start, ov.end);
          if (drift.ok) {
            var fc = new Float64Array(ppg.times.length);
            for (var i = 0; i < ppg.times.length; i++) fc[i] = ppg.times[i] - drift.offsetAt(ppg.times[i]);
            cpCorr = coupledPAT(ecg.times, fc);
            out.accSync = { available: true, anchors: drift.anchors, coverage: drift.coverage, offRangeMs: drift.offRange };
            out.cpCorr = packCp(cpCorr);
          } else {
            out.accSync = { available: false, reason: drift.reason, anchors: drift.anchors || 0 };
          }
        } else {
          out.accSync = { available: false, reason: hasAcc ? 'not simultaneous' : 'no ACC files' };
        }
        if (m.detail) {
          var pack = function (c) {
            if (!c || !c.ok) return null;
            var step = Math.max(1, Math.ceil(c.patAtR.length / 4000));
            return {
              patAtR: c.patAtR.filter(function (_, i) {
                return i % step === 0;
              }),
              pat: c.pat
            };
          };
          out.detail = pack(cp);
          out.detailCorr = pack(cpCorr);
        }
        self.postMessage(out);
      } catch (err) {
        self.postMessage({ type: 'result', key: key, label: m.label, error: String((err && err.message) || err) });
      }
    })
    .catch(function (err) {
      self.postMessage({ type: 'result', key: key, label: m.label, error: String((err && err.message) || err) });
    });
};
