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
  ['kernel-constants.js', 'clock.js', 'pat-gate.js', 'pat-align.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js'].forEach(loadScript);
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
    /* The pairing window is the PHYSIOLOGICAL one, not the raw search span.
       Before: any foot with `lag >= 0` within LAG_SEARCH_MS (2000 ms) was accepted. 2000 ms is WIDER
       THAN ONE RR INTERVAL (~1200 ms at 50 bpm), so whenever a foot was missed — a detection dropout,
       a motion-rejected beat — the NEXT beat's foot fell inside the window and was accepted as this
       beat's PAT. The reported value then jumped by a whole cardiac cycle.
       That is why `driftRange` read ~900-1250 ms across the corpus while `residIQR` stayed at 8-45 ms:
       measured drift/RR clustered at 0.85-0.98 and the per-bin medians were BIMODAL exactly one RR
       apart. A night cannot have 8 ms of beat-to-beat scatter and 1058 ms of genuine clock wander —
       the "drift" was beat-slip, and the go/no-go gate was reading it as a capture-path failure.
       PHYS_LO/PHYS_HI were already declared for this purpose but only fed the `inPhysPct` diagnostic;
       enforcing them here makes slip STRUCTURALLY impossible, because PHYS_HI (650 ms) is less than
       one RR. A beat whose foot is genuinely missing now contributes nothing instead of a wrong value. */
    var k = j,
      bestLag = null;
    while (k < nf && fTimes[k] - r <= LAG_SEARCH_MS) {
      var lag = fTimes[k] - r;
      if (lag >= PHYS_LO && lag <= PHYS_HI) {
        bestLag = lag;
        break;
      }
      if (lag > PHYS_HI) break; // past the physiological window — the foot for this beat is missing
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
// verdict() + its thresholds now live in pat-gate.js (single-sourced; ENGINE-VERIFICATION-FINDINGS §1.5).
// The renderer reads the SAME constants, and the suite executes the math — neither was true before.

// ── ACC-sync: trace the inter-device clock drift from shared body motion ─────
// Both the H10 (chest) and Verity (arm) accelerometers register the SAME sleep movements at the
// SAME true instant (mechanical, not pulse-delayed), so a windowed cross-correlation around each
// shared movement gives the relative clock offset there. Those anchors trace the (non-linear)
// drift curve — no user taps needed.
//
// The algorithm now lives in `pat-align.js` (PATAlign) rather than inline here: it is pure maths
// that was previously reachable only by loading this worker, so no gate could execute it
// (TEST-COVERAGE-FOLLOWUPS §3 flags exactly that). This keeps the identical contract —
// {ok, anchors, coverage, offsetAt, offRange} — as a thin adapter over the shared implementation.
function estimateDriftACC(h10Text, vText, t0, t1) {
  var eA = PATAlign.envelope(PPGDSP.parseSensorXYZ(h10Text), t0, t1, {}),
    eB = PATAlign.envelope(PPGDSP.parseSensorXYZ(vText), t0, t1, {});
  if (!eA || !eB) return { ok: false, reason: 'ACC parse failed' };
  var r = PATAlign.alignByAnchors(eA, eB, t0, {});
  if (!r.ok) return { ok: false, reason: r.reason + ' — chest & ankle motion too decorrelated', anchors: r.anchors.length };
  var anchors = r.anchors;
  var cov = (anchors[anchors.length - 1].tMs - anchors[0].tMs) / (t1 - t0 || 1);
  // Piecewise-linear between anchors, flat outside them: drift is measured where a shared movement
  // actually happened and is never extrapolated past the last one.
  function offsetAt(t) {
    if (t <= anchors[0].tMs) return anchors[0].offsetMs;
    if (t >= anchors[anchors.length - 1].tMs) return anchors[anchors.length - 1].offsetMs;
    for (var i = 1; i < anchors.length; i++)
      if (t <= anchors[i].tMs) {
        var a = anchors[i - 1],
          b = anchors[i],
          f = (t - a.tMs) / (b.tMs - a.tMs || 1);
        return a.offsetMs + f * (b.offsetMs - a.offsetMs);
      }
    return anchors[anchors.length - 1].offsetMs;
  }
  return { ok: true, anchors: anchors.length, coverage: cov, offsetAt: offsetAt, offRange: r.offsetRangeMs };
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
          vd = PATGate.verdict(ov, cp, sc);
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
          driftSource: 'raw', // §1.5 — `vd` reflects UNCORRECTED drift; see `vdCorr` for the ACC-corrected gate

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
            // §1.5 — the ACC-corrected coupling used to be rendered but NEVER re-gated, so a night whose
            // corrected drift cleared the bar still reported DRIFT-DOMINATED. Evaluate the same gate on it
            // and publish BOTH, each tagged with the drift it reflects. The primary `vd` is deliberately
            // left on RAW drift — promoting on corrected drift is an owner call, not a refactor.
            out.vdCorr = PATGate.verdict(ov, cpCorr, sc);
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
