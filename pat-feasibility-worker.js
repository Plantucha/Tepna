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
  /* `analysis-stats.js` joined 2026-09-26: the confidence-weighted statistics live THERE, not here, for
     the reason `pat-align.js` was extracted from this very file — a worker's top-level functions can only
     ever be SOURCE-SCANNED by the suite, never executed, so a mechanism that lives here cannot carry the
     planted known-answer test it needs. `AnalysisStats` is already loadable and co-loaded in both lanes. */
  ['kernel-constants.js', 'clock.js', 'pat-gate.js', 'pat-align.js', 'analysis-stats.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js'].forEach(loadScript);
  DSP_OK = !!(typeof ECGDSP !== 'undefined' && ECGDSP.parseECG && typeof PPGDSP !== 'undefined' && PPGDSP.parsePPG);
} catch (e) {
  DSP_ERR = String((e && e.message) || e);
}

/* THE RATE AND ITS REASON, IN ONE PLACE. A ppm is a RANGE over a SPAN, so it has two ways to be
   absent and they are not the same sentence: a night with no overlap has nothing to divide by, while a
   night with overlap but no bins has no numerator. Collapsing both to `NaN` — which is what shipped
   until now — hands the page an em-dash and the download a `null` with nothing beside either.
   Bare `isFinite` is the RIGHT form on both arguments and not the null-admitting one: `driftRange` and
   `overlapMin` are numbers-or-NaN by construction here, never null. */
function driftPpmWithReason(driftRange, overlapMin) {
  if (!(overlapMin > 0)) return { ppm: NaN, reason: 'drift rate not measurable: ' + (isFinite(overlapMin) ? overlapMin.toFixed(1) : 'no') + ' min of ECG∩PPG overlap (≤ 0)' };
  if (!isFinite(driftRange)) return { ppm: NaN, reason: 'drift rate not measurable: the drift range it divides is absent' };
  return { ppm: (driftRange / (overlapMin * 60000)) * 1e6, reason: null };
}

var LAG_SEARCH_MS = 2000,
  LAG_TOL_MS = 90,
  BIN_MIN = 5, // bin WIDTH in minutes — NOT a minimum pair count. See BIN_MATCH_MIN.
  PHYS_LO = 200,
  PHYS_HI = 650,
  FINGER_ANKLE_BAND = { lo: 0, hi: 400 }, // finger foot → ankle foot; under one RR, see coupledPAT
  /* A bin earns a vote in the drift statistics by MATCH RATE, never by an absolute pair count
     (PAT-DRIFT-STATISTIC-2026-08-10 §3). Until 2026-08-10 no minimum was applied at all, so a bin
     holding a single paired beat contributed a full median to a max−min range. On 2026-08-03 finger
     the bins setting the extremes held 6–24 paired beats against ~238 ECG beats in the same five
     minutes (3–10 %) with within-bin IQR 106–228 ms, while the 100 %-match bins ran 7–26 ms. Those
     survivors are also EDGE-CENSORED: as the true lag approaches PHYS_HI only the beats whose foot
     lands under the ceiling get paired, so the surviving median is dragged to the window edge —
     which is why they read 619 and 630 ms. Qualifying alone moves that night 404 → 222. */
  BIN_MATCH_MIN = 0.8;

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
  var raw = ECGDSP.detectPeaks(rec.int16, bp, rec.fs);
  /* artifact seconds out BEFORE refinement — ECGDex's own rule (pat-gate.js dropArtifactPeaks) */
  var conf = typeof ECGDSP.hrConfidence === 'function' ? ECGDSP.hrConfidence(rec.int16, bp, raw, rec.fs, rec.t0Ms) : null;
  var gated =
    typeof PATGate !== 'undefined' && PATGate.dropArtifactPeaks ? PATGate.dropArtifactPeaks(raw, conf, rec.fs, rec.t0Ms) : { kept: raw, nRaw: raw.length, nDropped: 0, artifactSec: 0, applied: false };
  var peaks = gated.kept;
  var t = new Float64Array(peaks.length);
  /* R-peak TIME, not rate: ride the host-disciplined axis when one exists. `i / fs` is the DEVICE
     clock, and on 160 of 187 real ECG fragments the ppm path is REFUSED by its 40-min span gate — so
     those fragments carried no time correction at all. Measured over 15 box nights: median divergence
     48 ms on refused fragments (max 1479 ms), against 0.1 ms where the ppm had already applied. A
     48 ms axis error is not survivable against a 60 ms PAT bar. `tMsAt` falls back to device time when
     there is no independent second clock, so this can never fabricate one. */
  /* ── AND THE POSITION MUST BE SUB-SAMPLE, or the axis work above is spent on a rounded input ──────
     `detectPeaks` returns INTEGER indices. `tMsAt` accepts a fractional one — its own comment says
     sub-sample R positions "must not be rounded before the correction is applied" — and this caller
     handed it whole samples anyway, so the refinement the node performs for its own beat series was
     discarded on the way to PAT. PAT-FORENSICS-AXIS-LEG-ASYMMETRY marks this leg ✅ fractional-safe;
     that is true of the FUNCTION and was false of the LEG.
     Measured 2026-09-14 on a real H10 night (35 305 beats): integer vs sub-sample differ p50 1.85 ms,
     p95 6.09 ms, max 7.70 ms — one whole sample at 129.99 Hz, against a 60 ms PAT bar and a lag that
     is a DIFFERENCE of two legs, so the two quantisations do not cancel.
     `refinePeaks` needed exporting from ECGDSP to reach it; it was unreachable, which is why this
     read as a choice rather than a limitation. */
  var refined = typeof ECGDSP.refinePeaks === 'function' ? ECGDSP.refinePeaks(bp, peaks, rec.fs).refIdx : null;
  var posAt = function (k) {
    var p = refined && isFinite(refined[k]) ? refined[k] : peaks[k];
    return p;
  };
  for (var i = 0; i < peaks.length; i++) t[i] = typeof rec.tMsAt === 'function' ? rec.tMsAt(posAt(i)) : rec.t0Ms + (posAt(i) / rec.fs) * 1000;
  /* FORWARDED, because this reshape drops anything it does not name — the lesson ppgdex-dsp.js states
     three lines above `timingSource`'s own definition, re-applied one layer down. `parseECG` already
     decided this fragment's axis provenance and it died here, which is why `PATGate.verdict`'s
     NO SHARED CLOCK / DRAWN AXIS refusals had a caller that never passed an axis and so had never
     fired in the shipped runtime. */
  return {
    t0Ms: rec.t0Ms,
    fs: rec.fs,
    durSec: rec.durSec,
    times: t,
    n: peaks.length,
    nRaw: gated.nRaw,
    artifactSec: gated.artifactSec,
    artifactGate: gated.applied,
    hostAxis: rec.hostAxis || null,
    /* ADDITIVE 2026-09-26 (PAT classic-vs-fused): the per-second confidence Map this function ALREADY
       computes for `dropArtifactPeaks` and then discarded. A consumer that wants to weight a PAT lag by
       how much each end was trusted had no way to get it without re-deriving `hrConfidence` — i.e.
       re-running bandpass + detect + SQI on the same bytes. `null` when the DSP has no `hrConfidence`,
       never an empty Map: absent and "measured, all ones" are different facts (§∅). */
    conf: conf,
    // worker-internal, for the arrival-floor axis below: each R's (sub-sample) position and the sample count
    // the device-time column must match row for row. Never posted.
    pos: Float64Array.from(peaks, function (_, k) {
      return posAt(k);
    }),
    nSamples: rec.int16.length
  };
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
  /* ── `rel[idx]` AT A FRACTIONAL idx IS ALWAYS `undefined`, SO THIS ALWAYS FELL BACK ───────────────
     `cons.feet` are sub-sample foot positions. An array subscript with a fractional index misses every
     time, so the `rel[idx] != null` guard was never satisfied and EVERY foot took the `idx / fs`
     branch — discarding the measured per-sample axis for a synthesised constant-rate one. Not a
     refinement lost: a MEASUREMENT lost, which is the correction PAT-FORENSICS-AXIS-LEG-ASYMMETRY
     makes to its own first draft. Measured 0 / 8948 feet on 8 fragments there; re-measured
     2026-09-14 as 26 035 / 26 035 on a 7.2 h Verity night.

     The cost decomposes into two errors that a single lookup fix removes together:
       SLOW  per-5-min-bin median p50 660 ms, p95 928, max 955 — the synthesised axis walking away
             from the measured one. That file has ZERO gaps and its two spans agree exactly (432.9 min
             both ways), so this is a mean rate matching the endpoints while drifting in between —
             the same shape as the ECG abscissa defect (#2477), on the other leg.
       FAST  within-bin residual p50 10.71 ms, p95 41.43 — sub-sample quantisation. Independently
             reproduces the brief's 10.47 ms median-of-medians / 40.4 ms max on different files.
     Against a 60 ms PAT bar the slow term alone is 11-16x.

     Interpolate, as `tools/pat-matchrate-strict.mjs timeAt` already does and as the corpus run
     confirmed at scale (72 514 / 72 514 feet resolving through `relSec`). Fall back to `idx / fs` only
     where `relSec` genuinely cannot answer — a stampless or synthetic record — so the synthetic axis
     remains reachable but is no longer the default by accident. */
  var relN = rel ? rel.length : 0;
  for (var i = 0; i < cons.feet.length; i++) {
    var idx = cons.feet[i];
    var sec;
    var i0 = Math.floor(idx);
    if (relN > 1 && i0 >= 0 && i0 < relN) {
      var i1 = Math.min(relN - 1, i0 + 1),
        fr = idx - i0;
      var a = rel[i0],
        b = rel[i1];
      sec = isFinite(a) && isFinite(b) ? a * (1 - fr) + b * fr : isFinite(a) ? a : idx / fs;
    } else sec = idx / fs;
    t[i] = t0 + sec * 1000;
  }
  /* ADDITIVE 2026-09-26 (PAT classic-vs-fused): the optical leg's per-second confidence, in the call
     shape `sensor-trio-worker.js ppgHrMapReal` already uses — `beatSQI` over the SELECTED channel's
     bandpassed signal and the consensus feet, then `beatConfidence` keyed on the same second floor.
     Not a new estimator: the same two DSP calls that surface already makes, reached from the feet this
     function had already consensus-detected.
     ⚠️ `null` rather than a default when either call is unavailable, and the consumer must SHOW that.
     The O2Ring's single-channel drawn-axis PPG is the case Wren flagged as unverified: if confidence is
     not usable there, the corner renders UNWEIGHTED AND LABELLED, never silently weighted by 1 (§∅). */
  var _sqi = PPGDSP.beatSQI ? PPGDSP.beatSQI(per[refIdx].bp, cons.feet, rec.fs, null, cons.agree || null) : null;
  var _conf =
    PPGDSP.beatConfidence && _sqi
      ? PPGDSP.beatConfidence(
          cons.feet.map(function (fIdx) {
            return Math.round(fIdx);
          }),
          _sqi,
          rec.fs,
          rec.t0Ms
        )
      : null;
  // Forwarded for the same reason as the ECG leg above — this is the leg that can actually be DRAWN.
  // `feetIdx` / `nSamples`: worker-internal, for the arrival-floor axis below. Never posted.
  return { t0Ms: rec.t0Ms, fs: rec.fs, durSec: rec.durSec, times: t, n: cons.feet.length, hostAxis: rec.hostAxis || null, conf: _conf, feetIdx: cons.feet, nSamples: rec.n };
}
function overlap(ecg, ppg) {
  var s = Math.max(ecg.t0Ms, ppg.t0Ms),
    e = Math.min(ecg.t0Ms + ecg.durSec * 1000, ppg.t0Ms + ppg.durSec * 1000);
  return { start: s, end: e, min: (e - s) / 60000 };
}
/* `sharedClock` moved to pat-gate.js on 2026-08-10, for the reason `verdict()` moved there before it
   (ENGINE-VERIFICATION-FINDINGS §1.5): a gate criterion living in a WORKER cannot be executed by a
   test without hand-extraction via `vm`, and this one was wrong for two years' worth of captures
   without a single assertion touching it. The fix and its evidence are in the pat-gate copy. */
var sharedClock =
  (typeof PATGate !== 'undefined' && PATGate.sharedClock) ||
  function () {
    return { ok: false, reason: 'pat-gate.js not loaded' };
  };
/* `band` (optional, { lo, hi } ms): the pairing window. Omitted ⇒ the chest→peripheral PHYS window, byte-identical
   to every caller before 2026-09-26. The finger→ankle leg passes its own band: the ankle foot follows the finger
   foot by ~100 ms (measured 96–99 ms on 2026-09-25), far below PHYS_LO, and both bands stay under one RR, which
   is what keeps beat slip structurally impossible (see the note in the loop). */
/* ── TIME ORDER IS A PRECONDITION, CHECKED — never assumed, never sorted silently ────────────────────────────
   The pairing below walks both lists forward with one shared cursor, so it is only correct on ascending times.
   A handful of out-of-order stamps at the head is enough to strand the cursor for the whole night: measured on
   2026-09-28, the ring's first 76 feet were placed up to 402 min late by a broken axis (43 inversions), and the
   finger legs "coupled" 6 and 12 beats out of ~23 600 — reported as "no overlap or detection failed", which was
   wrong on both counts. The inversions are a DEFECT UPSTREAM (the axis that produced them), so the honest answer
   is a refusal that names them, not a sort that would pair beats to times that are hours wrong. */
function orderFault(t, what) {
  var inv = 0,
    first = -1;
  for (var i = 1; i < t.length; i++) {
    if (t[i] < t[i - 1]) {
      inv++;
      if (first < 0) first = i;
    }
  }
  return inv ? what + ' times are not in time order — ' + inv + ' inversion(s), the first at index ' + first + '; the axis that produced them is broken, and pairing assumes order' : null;
}
/* `names` (optional, { start, end }): what the two time lists ARE, for the refusal's wording. Omitted ⇒ R-peak →
   pulse-foot; the finger → ankle leg passes its own, because its first list is finger feet, not R-peaks. */
function coupledPAT(rTimes, fTimes, band, names) {
  var fault = orderFault(rTimes, (names && names.start) || 'R-peak') || orderFault(fTimes, (names && names.end) || 'pulse-foot');
  if (fault) return { ok: false, reason: fault };
  var PLO = band ? band.lo : PHYS_LO,
    PHI = band ? band.hi : PHYS_HI;
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
      if (lag >= PLO && lag <= PHI) {
        bestLag = lag;
        break;
      }
      if (lag > PHI) break; // past the physiological window — the foot for this beat is missing
      k++;
    }
    if (bestLag != null) {
      lags.push(bestLag);
      lagAtR.push({ t: r, lag: bestLag });
    }
  }
  if (lags.length < 20) return { ok: false, reason: 'Too few R→foot pairs (' + lags.length + ') — no overlap or detection failed.' };
  /* HOW MUCH OF THE NIGHT DOES THE PHYSIOLOGICAL WINDOW THROW AWAY? (PAT-WINDOW-CENSORING-2026-08-11)
     `[PHYS_LO, PHYS_HI]` is applied above as if it were a plausibility filter. It is a CENSORING CUT:
     where the inter-device offset puts the true R→foot lag outside it, the window silently keeps
     whatever fraction happens to fall inside and every statistic downstream is computed on that
     remnant. Measured over the box corpus it discarded most of the data on 16 of 19 site-nights — one
     night ran a median lag of 831 ms with 95.9 % above `PHYS_HI` and still produced a confident PAT
     number, and the surviving beats are edge-biased because only the ones under the ceiling pair.
     So measure it: pair again with NO window, bounded only by 0.9 × the LOCAL RR — the constraint that
     actually prevents beat slip (a bound above one RR admits the next beat's foot, the defect
     `pat-align` fixed) — and report the share that lands outside. Diagnostic here; the gate weighs it. */
  var censOut = 0,
    censIn = 0,
    cj = 0;
  for (var ci = 0; ci + 1 < rTimes.length; ci++) {
    var cr = rTimes[ci],
      crr = rTimes[ci + 1] - cr;
    if (!(crr > 300 && crr < 2000)) continue;
    var ccap = 0.9 * crr;
    while (cj < nf && fTimes[cj] < cr) cj++;
    for (var ck = cj; ck < nf; ck++) {
      var cl = fTimes[ck] - cr;
      if (cl > ccap) break;
      if (cl > 0) {
        if (cl < PLO || cl > PHI) censOut++;
        else censIn++;
        break;
      }
    }
  }
  var censTot = censOut + censIn,
    censoredPct = censTot >= 200 ? (100 * censOut) / censTot : NaN;
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
  /* DENOMINATOR = beats the PPG could physically have covered, NOT every beat in the ECG file.
     `pat.length / rTimes.length` counted an R-peak the optical recording never spans as a coupling
     failure, so `matchRate` measured RECORDING OVERLAP as much as coupling — and the two devices
     routinely disagree on length (batteries, BLE reconnects). It flipped the verdict: a perfectly
     coupled 2 h ECG paired with the 1 h PPG overlapping it scored 0.50 against `COUPLING_MIN 0.55`,
     failed the `goodMatch` leg and dropped from `go`/FEASIBLE to `maybe`/PROMISING — a downgrade
     caused by a battery, with every other gate leg identical. `overlap()`
     already reports the shared span as its own gate leg, so that fact was counted twice while
     coupling was not measured at all. Mirrors the fix in `pat-align.js coupleRtoFoot`; see the long
     note there. `matchRateRaw` keeps the pre-2026-08-04 value. */
  var nCoverable = 0;
  if (nf) {
    var covLo = fTimes[0] - PHI,
      covHi = fTimes[nf - 1] - PLO;
    for (var ci = 0; ci < rTimes.length; ci++) if (rTimes[ci] >= covLo && rTimes[ci] <= covHi) nCoverable++;
  }
  var matchRate = pat.length / Math.max(nCoverable, 1);
  var matchRateRaw = pat.length / Math.max(rTimes.length, 1);
  var residIQR = resid.length ? quantile(resid, 0.75) - quantile(resid, 0.25) : NaN;
  /* §∅ — THE REASON IS WRITTEN WHERE THE ABSENCE IS MADE. Every one of these three quantities used to
     leave here as a bare NaN, which `JSON.stringify` turns into `null` in the download and the page
     turns into an em-dash: the reader gets "absent" and never "why". The reason is a SIBLING, computed
     on the same line as the NaN, so the page and the download cannot disagree about it — there is one
     source. Shape is outcome-independent (tests/dex-tests.js §"absence is null, not absent"): the key
     is always present and is `null` when the number IS published, so `'residIQRReason' in cp` can
     never come to mean "this failed". */
  var residIQRReason = resid.length ? null : 'beat-to-beat spread not measurable: ' + resid.length + ' residuals (< 1)';
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
  /* Denominator per bin = the ECG beats falling in that same bin, so a bin's weight comes from the
     fraction of beats that paired, not from how many happened to. */
  var rInBin = {};
  for (var rb = 0; rb < rTimes.length; rb++) {
    var rk = Math.floor((rTimes[rb] - t0) / (BIN_MIN * 60000));
    rInBin[rk] = (rInBin[rk] || 0) + 1;
  }
  var binMed = binKeys.map(function (b) {
    var v = bins[b],
      nR = rInBin[b] || 0;
    return {
      min: b * BIN_MIN,
      bin: b,
      med: median(v),
      n: v.length,
      nBeats: nR,
      iqr: quantile(v, 0.75) - quantile(v, 0.25),
      matchRate: nR ? v.length / nR : 0
    };
  });
  var medVals = binMed.map(function (x) {
    return x.med;
  });
  /* `driftRange` is RETAINED as a diagnostic and NO LONGER GATED ON (PAT-DRIFT-STATISTIC-2026-08-10).
     Pairing is confined to a window PHYS_HI − PHYS_LO = 450 ms wide, so every bin median lies in a
     450 ms interval by construction and the range is bounded by 450 — and SATURATES there: the nine
     box recordings longer than ~6 h read 442 431 430 427 427 425 423 423 420, i.e. 93–98 % of the
     ceiling. That is the window width reported nine times, not nine measurements of drift, and a
     statistic that pins to a constant for anything long enough can neither rank nights nor fail safe.
     It saturates because it is the envelope of a DRIFTLESS walk: the bin-to-bin slope is ≈0 (Theil–Sen
     −6.9…+24.8 ppm, median ≈ −1) and the median |step| is 6–35 ms, so the range grows as σ·√N. On
     2026-08-02 finger, 22 bins at median |step| 12 ms predict √(8N/π)·σ ≈ 133 ms; measured 125.
     That walk is why every earlier diagnosis came back null — no trend to find, only √2 from halving
     the span, nothing from re-selecting beats, and no covariate (ρ against heart rate runs −0.63…+0.32
     with the sign flipping, and removing the lag~RR fit leaves the range unchanged: 72 → 78). */
  var driftRange = medVals.length ? Math.max.apply(null, medVals) - Math.min.apply(null, medVals) : NaN;
  var driftRangeReason = medVals.length ? null : 'drift range not measurable: ' + medVals.length + ' bin medians (< 1)';
  /* THE GATED QUANTITY comes from PATGate.driftStats — single-sourced there because this file is in
     no test lane. Absent pat-gate.js the drift fields go undefined and PATGate.verdict falls back to
     `driftRange`, i.e. exactly the pre-2026-08-10 behaviour. */
  var ds = typeof PATGate !== 'undefined' && PATGate.driftStats ? PATGate.driftStats(binMed) : { stepP95: NaN, nSteps: 0, binsQualified: 0, binsTotal: binMed.length, driftRangeQual: NaN };
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
    matchRateRaw: matchRateRaw, // pre-2026-08-04 value (denominator = every ECG beat)
    nCoverable: nCoverable,
    nCoupled: pat.length,
    residIQR: residIQR,
    residIQRReason: residIQRReason,
    binMed: binMed,
    censoredPct: censoredPct, // GATED: share of beats the PHYS window discards (NaN if too few beats)
    censoredN: censTot,
    driftRange: driftRange, // diagnostic only — duration-dependent, saturates at PHYS_HI − PHYS_LO
    driftRangeReason: driftRangeReason,
    driftRangeQual: ds.driftRangeQual, // the same range over qualified bins — also diagnostic
    stepP95: ds.stepP95, // GATED: p95 |Δ bin median| between adjacent qualified bins
    nSteps: ds.nSteps,
    binsQualified: ds.binsQualified,
    binsTotal: ds.binsTotal,
    slope: slope,
    linR2: linR2,
    inPhysPct: pat.length
      ? pat.filter(function (v) {
          return v >= PLO && v <= PHI;
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
/* ── THREE SITES, ONE GRID: the classic three-cornered hat on 5-min PAT medians ──────────────────────────
   A = chest ECG R · B = O2Ring finger foot · C = Verity ankle foot. One pair cannot say which site carries the
   scatter — Var(A−B) is symmetric — three can: Var(AB)=σ²A+σ²B, Var(AC)=σ²A+σ²C, Var(BC)=σ²B+σ²C, so
   σ²A = ½(V_AB + V_AC − V_BC) and cyclically. The CLASSIC hat (ρ = 0), as `tools/pat-three-corner.mjs`: a ρ
   estimated from these same three series is circular (TCH-CORRELATED-SOLVE-KNIFE-EDGE-FOLLOWUPS §5). The
   dispersion is the IQR/1.349 of the window medians, robust to the odd mis-paired window. A window enters only
   when ALL THREE pairs coupled ≥ HAT_MIN_BEATS beats inside it. A NEGATIVE variance is returned as null with
   its value beside it — never square-rooted: it means the independent-error model does not fit this night. */
var HAT_WIN_MS = 300000,
  HAT_MIN_BEATS = 50,
  HAT_MIN_WINDOWS = 12;
/* `wAB`/`wAC`/`wBC` (OPTIONAL): per-pair weight arrays aligned to each leg's `patAtR`, from `legWeights`.
   Omitted ⇒ every window median is the plain median and this is byte-identical to every caller before
   2026-09-26 — the classic column IS this function, not a reproduction of it. Supplied ⇒ each window
   median is the WEIGHTED median of the same pairs, and the solve below is unchanged. One hat solver;
   `tch-parity` reds any page that grows a private one. */
function threeHat(cAB, cAC, cBC, wAB, wAC, wBC) {
  /* Name WHICH leg refused and why — "a leg did not couple" hid an axis defect behind a coupling word. */
  var legs = [
      ['chest → finger', cAB],
      ['chest → ankle', cAC],
      ['finger → ankle', cBC]
    ].filter(function (l) {
      return !(l[1] && l[1].ok);
    }),
    why = legs
      .map(function (l) {
        return l[0] + ': ' + ((l[1] && l[1].reason) || 'not coupled');
      })
      .join(' · ');
  if (legs.length) return { ok: false, reason: 'a leg did not couple — ' + why };
  function bucket(c, ws) {
    var o = {};
    for (var i = 0; i < c.patAtR.length; i++) {
      var b = Math.floor(c.patAtR[i].t / HAT_WIN_MS);
      (o[b] || (o[b] = [])).push(ws ? { lag: c.patAtR[i].lag, w: ws[i] } : c.patAtR[i].lag);
    }
    return o;
  }
  /* The per-window statistic, and the ONLY place the two columns differ. A weighted bucket carries
     `{lag, w}` objects; an unweighted one carries plain numbers, exactly as before. */
  function winMed(v) {
    if (!v.length || typeof v[0] === 'number') return median(v);
    return AnalysisStats.weightedMedian(
      v.map(function (o) {
        return o.lag;
      }),
      v.map(function (o) {
        return o.w;
      })
    );
  }
  var bAB = bucket(cAB, wAB),
    bAC = bucket(cAC, wAC),
    bBC = bucket(cBC, wBC),
    win = [];
  Object.keys(bAC)
    .map(Number)
    .sort(function (a, b) {
      return a - b;
    })
    .forEach(function (b) {
      if (bAB[b] && bBC[b] && bAB[b].length >= HAT_MIN_BEATS && bAC[b].length >= HAT_MIN_BEATS && bBC[b].length >= HAT_MIN_BEATS)
        win.push({ t: (b + 0.5) * HAT_WIN_MS, ab: winMed(bAB[b]), ac: winMed(bAC[b]), bc: winMed(bBC[b]) });
    });
  if (win.length < HAT_MIN_WINDOWS) return { ok: false, reason: win.length + ' windows with all three legs coupled (< ' + HAT_MIN_WINDOWS + ')', windows: win };
  function sd(k) {
    var v = win.map(function (w) {
      return w[k];
    });
    return (quantile(v, 0.75) - quantile(v, 0.25)) / 1.349;
  }
  var sAB = sd('ab'),
    sAC = sd('ac'),
    sBC = sd('bc'),
    vAB = sAB * sAB,
    vAC = sAC * sAC,
    vBC = sBC * sBC;
  var v2 = { chest: 0.5 * (vAB + vAC - vBC), finger: 0.5 * (vAB + vBC - vAC), ankle: 0.5 * (vAC + vBC - vAB) },
    sigma = {};
  Object.keys(v2).forEach(function (k) {
    sigma[k] = v2[k] >= 0 ? Math.sqrt(v2[k]) : null;
  });
  var lag = function (k) {
    return median(
      win.map(function (w) {
        return w[k];
      })
    );
  };
  /* ADDITIVE (PAT-HAT-DRIFT-DIFFERENCED-2026-09-27): every field above is unchanged. A negative corner now
     says WHICH kind of negative it is — `underpowered` (its CI reaches 0, as on 2026-09-26) or
     `independence-failed` (its CI is wholly below 0, with the correlation that would explain it) — and
     `diff` is the drift-removed estimate, labelled as NOT comparable to this one. */
  var col = function (k) {
      return win.map(function (w) {
        return w[k];
      });
    },
    ci = AnalysisStats.patHatBootstrapCI(col('ab'), col('ac'), col('bc'));
  return {
    ok: true,
    n: win.length,
    winMin: HAT_WIN_MS / 60000,
    lagMed: { ab: lag('ab'), ac: lag('ac'), bc: lag('bc') },
    pairSd: { ab: sAB, ac: sAC, bc: sBC },
    variance: v2,
    sigma: sigma,
    windows: win,
    ci: ci,
    corners: AnalysisStats.patHatCornerStatus(v2, ci),
    diff: AnalysisStats.patDifferencedHat(win, HAT_WIN_MS, { minPairs: HAT_MIN_WINDOWS })
  };
}
/* ── THE ARRIVAL-FLOOR AXIS (route-PAT fix, owner-ordered 2026-09-27) ────────────────────────────────────────
   WHAT WAS WRONG. The corrected path ("ACC-sync") put both accelerometers on their PHONE stamps and re-aligned
   the ankle PPG by the offset between the two motion envelopes. A phone stamp is the arrival of the packet,
   back-timed across it, so that offset was (Verity buffering − H10 buffering): the ~400 ms the page reported
   as "drift after ACC-sync" is a BUFFERING difference, inside the −867..+1321 ms range capture-host/writers.py
   PmdArrivalLogWriter measured per connection, and not a clock drift at all.
   WHY NOT "TIME THE ACC ON ITS DEVICE COUNTER" AND KEEP THE REST. The two PAT legs are on `tMsAt` / `relSec`,
   both host-disciplined by `hostAxis`, which anchors on the MEDIAN of (host − device) and so carries that
   stream's MEDIAN buffering. What PAT needs removed is that buffering; a floor-anchored ACC would read ≈ 0 and
   delete a real correction (Wren's arithmetic, confirmed by Kestrel before building).
   WHAT THIS DOES INSTEAD. Every stream's device counter is placed on the host by its OWN arrival FLOOR — the
   packet-arrival sidecar records each PMD packet's true arrival beside its first sample's device stamp, and
   buffering is one-sided, so a low quantile of (arrival − device) is clock offset + the link's MINIMUM
   latency, with the buffering gone. Per 10-min device-time window: the 1st percentile (writers.floor_ms's
   rule); a window is REFUSED under 100 packets or when the gap to the minimum exceeds 10 ms (a smeared edge
   is not a floor); a jump > 30 s in (arrival − device) is a counter step and splits a segment; anchors are
   interpolated inside a segment, flat at its edges. Then R and foot = device time + floor, the corrected
   coupling is re-gated, and the accelerometers — re-timed the same way — become an INDEPENDENT CHECK that
   should read ≈ 0 (the two links' minimum-latency difference). Nothing falls back to a phone stamp or to
   `hostAxis` here: a median anchor carries buffering, so it cannot deliver this property (§∅ — refuse, with
   the reason). The raw legs and the primary `vd` are untouched. */
var FLOOR_WIN_MS = 600000,
  FLOOR_MIN_PACKETS = 100,
  FLOOR_MAX_SPREAD_MS = 10,
  /* a COUNTER STEP, not buffering: per-packet buffering alone moves (arrival − device) by seconds (Heron measured a
     Verity p95 near 2.5 s), and a 2 s threshold chopped a buffered stream into fragments too short for any window —
     the plant caught it. Real resyncs step by tens of seconds to years (the 2026-09-24 time sync: 2.44e8 s). */
  FLOOR_STEP_MS = 30000,
  FLOOR_MIN_WINDOWS = 3,
  FLOOR_Q = 0.01,
  FLOOR_EDGE_MS = 5000; // a sample may sit up to one packet past the last packet's first stamp
function arrivalHostMs(stamp) {
  var r = typeof DexClock !== 'undefined' && DexClock.parseTimestamp ? DexClock.parseTimestamp(stamp) : null;
  return r && isFinite(r.tMs) ? r.tMs : null;
}
/* Per data row, the device counter in ms (NaN for an unparseable stamp). Comment lines are skipped the way the
   parsers skip them; the caller compares the row count to the DSP's sample count and refuses on a mismatch, so
   a row the DSP rejected can never shift every later index. */
function devMsColumn(text) {
  var L = String(text).split(/\r?\n/),
    head = (L[0] || '').split(';').map(function (x) {
      return x.trim();
    }),
    ci = head.indexOf('sensor timestamp [ns]');
  if (ci < 0) return null;
  var out = [];
  for (var i = 1; i < L.length; i++) {
    var line = L[i];
    if (!line || line.charAt(0) === '#') continue;
    var v = +line.split(';')[ci];
    out.push(isFinite(v) ? v / 1e6 : NaN);
  }
  return Float64Array.from(out);
}
/* A packet's (device ms, arrival ms) from its sidecar row — the DEFAULT, for a device that stamps its own
   samples. `last_sensor_ns` is column 4. The `d > 0` guard is also what keeps the O2Ring OUT of this path:
   E11 writes both ns columns BLANK for a device with no clock, and `+"" === 0` in JS, so a ring row is
   skipped here rather than entering the floor as a sample at the epoch (§∅). The ring has its own
   extractor below, keyed on the counter it DOES have. */
function stampedPacket(c) {
  // the packet's LAST sample: it was taken just before the packet left, so (arrival − last) is clock offset +
  // link latency. The FIRST sample also carries the packet-fill time (n−1)/fs, which smears every stream
  // whose packet size varies (Heron, 2026-09-27: Verity acc 118 → 11 ms spread when keyed on last).
  var a = arrivalHostMs(c[0]),
    d = +c[4] / 1e6;
  if (a == null || !isFinite(d) || !(d > 0)) return null;
  return [d, a];
}
function floorMap(sidecarText, meas, pick) {
  var L = String(sidecarText).split(/\r?\n/),
    pk = [],
    get = pick || stampedPacket;
  for (var i = 1; i < L.length; i++) {
    if (!L[i]) continue;
    var c = L[i].split(';');
    if (c[2] !== meas) continue;
    var da = get(c);
    if (!da) continue;
    pk.push([da[0], da[1] - da[0]]);
  }
  if (pk.length < FLOOR_MIN_PACKETS) return { ok: false, reason: pk.length + ' `' + meas + '` packets in the arrival sidecar (< ' + FLOOR_MIN_PACKETS + ')' };
  var segs = [[pk[0]]];
  for (var k = 1; k < pk.length; k++) {
    var prev = pk[k - 1];
    if (pk[k][0] < prev[0] || Math.abs(pk[k][1] - prev[1]) > FLOOR_STEP_MS) segs.push([]);
    segs[segs.length - 1].push(pk[k]);
  }
  var S = segs.map(function (sg) {
    return { lo: sg[0][0], hi: sg[sg.length - 1][0], pk: sg, anchors: [] };
  });
  var sorted = S.slice().sort(function (x, y) {
    return x.lo - y.lo;
  });
  for (var j = 1; j < sorted.length; j++)
    if (sorted[j].lo < sorted[j - 1].hi) return { ok: false, reason: 'device-counter segments overlap (the counter went backwards) — one device time would map to two host times' };
  var windows = 0,
    refused = 0,
    spreads = [];
  S.forEach(function (sg) {
    var by = {};
    sg.pk.forEach(function (p) {
      var w = Math.floor((p[0] - sg.lo) / FLOOR_WIN_MS);
      (by[w] || (by[w] = [])).push(p);
    });
    Object.keys(by)
      .map(Number)
      .sort(function (x, y) {
        return x - y;
      })
      .forEach(function (w) {
        var g = by[w];
        if (g.length < FLOOR_MIN_PACKETS) return;
        windows++;
        var v = g
          .map(function (p) {
            return p[1];
          })
          .sort(function (x, y) {
            return x - y;
          });
        var q = v[Math.min(v.length - 1, Math.floor(FLOOR_Q * v.length))],
          spread = q - v[0];
        spreads.push(spread);
        if (spread > FLOOR_MAX_SPREAD_MS) {
          refused++;
          return;
        }
        sg.anchors.push({
          d: median(
            g.map(function (p) {
              return p[0];
            })
          ),
          off: q
        });
      });
  });
  var valid = windows - refused;
  if (valid < FLOOR_MIN_WINDOWS)
    return {
      ok: false,
      reason:
        valid +
        ' usable 10-min floor window(s) for `' +
        meas +
        '` (< ' +
        FLOOR_MIN_WINDOWS +
        '; ' +
        refused +
        ' refused as smeared, median spread ' +
        (spreads.length ? median(spreads).toFixed(1) : '—') +
        ' ms)'
    };
  function map(dev) {
    for (var i2 = 0; i2 < S.length; i2++) {
      var sg = S[i2],
        A = sg.anchors;
      if (!(dev >= sg.lo - FLOOR_EDGE_MS && dev <= sg.hi + FLOOR_EDGE_MS) || !A.length) continue;
      if (dev <= A[0].d) return A[0].off;
      if (dev >= A[A.length - 1].d) return A[A.length - 1].off;
      for (var m2 = 1; m2 < A.length; m2++)
        if (dev <= A[m2].d) {
          var f = (dev - A[m2 - 1].d) / (A[m2].d - A[m2 - 1].d || 1);
          return A[m2 - 1].off + f * (A[m2].off - A[m2 - 1].off);
        }
    }
    return null;
  }
  return { ok: true, meas: meas, packets: pk.length, windows: windows, refused: refused, segments: S.length, spreadMedianMs: median(spreads), map: map };
}
/* ── THE RING'S FLOOR: the device's OWN counter, never the host-synthesized grid ─────────────────────────
   The O2Ring has no clock, so E11 (#3267) writes `PPG_FRAME` rows carrying the host arrival, the frame's
   delivered sample count, and `first_sample_idx` — the ring's own cumulative stream position
   (`oxyii.ppg_stream_offset`). That counter, divided by the ADC rate, IS the device-side axis an arrival
   floor needs.

   ⚠️ TWO COUNTERS EXIST AND ONLY THIS ONE MAY ANCHOR. `_PPG.txt`'s `sensor timestamp [ns]` column is the
   HOST-SYNTHESIZED grid (`capture.py` `O2PpgGrid`): exactly 8.000 ms per step by construction, anchored on
   the session `t0`, with honest gaps inserted from ELAPSED HOST TIME. A floor taken against it would
   measure partly its own construction, and the Clock Contract §7 says a stream whose inter-sample deltas
   are ≥99 % one value was DRAWN and is never a clock. So the grid times the SAMPLES for display and the
   sidecar's counter anchors the FLOOR; they are never mixed.

   The rate is the ADC's, cited rather than assumed: `capture.py O2PPG_FS_DEFAULT = 125.000`, one sample
   every 8.000 ms. If a unit's ADC is ever measured differently the host overrides it in config, and this
   constant would then be wrong in the same direction for every ring — which is why the refusals below are
   on ACCOUNTING (counts and steps) and never on a rate agreeing with this number. */
var RING_FS = 125.0,
  RING_MS_PER_SAMPLE = 1000 / RING_FS;
function ringPacket(c) {
  // The frame's LAST delivered sample, for the same reason `stampedPacket` uses it: keying on the first
  // would fold the frame-fill time ((n−1)/fs, up to ~1 s on this device) into the floor.
  var a = arrivalHostMs(c[0]),
    n = +c[5],
    i0 = c.length > 6 ? +c[6] : NaN;
  // A SIX-column row is a pre-E11 file (or a resumed one that keeps the narrow shape for life): it carries
  // no position, so there is nothing to anchor and the row is skipped — not defaulted to 0.
  if (a == null || !isFinite(n) || !(n > 0) || !isFinite(i0) || !(i0 >= 0) || c[6] === '') return null;
  return [(i0 + n - 1) * RING_MS_PER_SAMPLE, a];
}
/* Device ms of every DELIVERED sample in `_PPG.txt`, walked from the sidecar's frames — so a foot's file
   position can be placed on the device axis without trusting the grid.

   WHY THE FILE'S OWN ROW INDEX WILL NOT DO: an honest gap writes NO rows (`capture.py:936` — the survivors
   are deliberately not compressed, the grid index jumps instead), so after the first gap a row index is no
   longer a device position. The sidecar's frames are delivered in order and each declares
   (`first_sample_idx`, `n_samples`), which converts the k-th delivered sample into an exact device offset.

   REFUSES, never patches, on any of: no positioned frames; a frame whose position goes backwards or
   overlaps its predecessor; and `Σ n_samples` not equal to the file's row count. That last one is the same
   accounting refusal the ECG and Verity legs already carry — if the totals differ, one dropped row shifts
   every later foot, and a silently shifted axis is worse than a refused one. */
function ringDevColumn(sidecarText, nRows) {
  var L = String(sidecarText).split(/\r?\n/),
    frames = [];
  for (var i = 1; i < L.length; i++) {
    if (!L[i]) continue;
    var c = L[i].split(';');
    if (c[2] !== 'PPG_FRAME') continue;
    var n = +c[5],
      i0 = c.length > 6 ? +c[6] : NaN;
    if (!isFinite(n) || !(n > 0) || !isFinite(i0) || !(i0 >= 0) || c[6] === '') continue;
    frames.push([i0, n]);
  }
  if (!frames.length) {
    /* ∅ NAME WHICH ABSENCE THIS IS. Two different captures reach here and their remedies differ:
       · a PRE-E11 sidecar has no `PPG_FRAME` rows at all — it carries only `OXYLIVE_DURATION_S` — and the
         remedy is a night recorded after the box restarted on #3267;
       · a SPLIT-MODE night (RING-POLL-SPLIT) has `PPG_FRAME_A` rows: the wave arrived on 0x03
         LIVE_SAMPLES_A, whose 6-byte reply header carries only a declared count, so the frames ARE logged
         and the POSITION is what is missing — by the opcode's nature, not by the capture's age.
       Telling a reader "a pre-E11 capture" about a split night sends them to the wrong fix. */
    return {
      ok: false,
      reason: /;PPG_FRAME_A;/.test(String(sidecarText))
        ? 'the ring’s wave arrived on 0x03 (LIVE_SAMPLES_A) in split mode, which carries no cumulative stream position — the frames are logged, the device position is not, so the finger has no floor to anchor'
        : 'no positioned `PPG_FRAME` rows in the ring sidecar — a pre-E11 capture carries arrival rows with no stream position'
    };
  }
  /* ── THE FIELD IS DEVICE-DEAD ON THIS RING, AND THAT IS NOT A CORRUPT FILE ──────────────────────────
     Measured 2026-10-04 (Wren, two independent witnesses): `oxyii.ppg_stream_offset` — 0x04's `[20:24]`,
     which is what E11 writes into `first_sample_idx` — is ZERO on every frame this ring has ever sent.
     819 `*_OXYFRAME.txt` files from 07-25 to 10-04 carry no nonzero `ppg_offset` row, and the committed
     real frame `tests/test_oxyii.py::_REAL_PPG_FRAME` reads `[20:24] = 00000000` while its `[0:4]`
     duration says 10,719 s — a frame three hours into a session reporting position zero. The firmware
     never fills the vendor's field; the vendor's own SDK decodes and discards it too.

     ⚠️ WHY THIS NEEDS ITS OWN REFUSAL WHEN TWO GUARDS ALREADY FIRE. Measured on all-zero rows: the
     overlap check below returns "positions overlap or go backwards at frame 1 (0 after 126)", and
     `floorMap` returns "0 usable windows … refused as smeared, median spread 6000.0 ms". So no wrong
     floor was ever produced — but both messages describe a CORRUPT capture, and a reader who believes
     them goes looking for a bad file or a resync. The absence is structural and permanent on this
     device, and saying so is the difference between "wait for a better night" and "this ring cannot
     anchor a floor at all".

     ∅ THE TEST IS NON-ADVANCE, NEVER THE VALUE 0. `ppg_stream_offset`'s own docstring records that
     "0 is a real offset — it is what the first frame of a session reports", so a value-keyed detector
     would refuse a legitimate first frame, and the rule in CLAUDE.md §∅ says to detect by the stream's
     own behaviour rather than by value membership. A constant offset at ANY value is equally dead, and
     this catches those too. */
  var advances = false;
  for (var a0 = 1; a0 < frames.length; a0++)
    if (frames[a0][0] !== frames[0][0]) {
      advances = true;
      break;
    }
  if (!advances && frames.length > 1)
    return {
      ok: false,
      reason:
        'ring-offset-never-advances: all ' +
        frames.length +
        ' `PPG_FRAME` rows report stream position ' +
        frames[0][0] +
        " — the O2Ring firmware does not fill the vendor's offset field (measured 2026-10-04 over 819 OXYFRAME files and the committed real frame), so the ring exposes NO device position and the finger has no floor to anchor. This is structural, not a bad capture."
    };
  var total = 0;
  for (var k = 0; k < frames.length; k++) {
    if (k && frames[k][0] < frames[k - 1][0] + frames[k - 1][1])
      return {
        ok: false,
        reason:
          'ring frame positions overlap or go backwards at frame ' + k + ' (' + frames[k][0] + ' after ' + (frames[k - 1][0] + frames[k - 1][1]) + ') — one device position would map to two samples'
      };
    total += frames[k][1];
  }
  if (total !== nRows)
    return {
      ok: false,
      reason: total + ' samples declared across ' + frames.length + ' ring frames vs ' + nRows + ' rows in `_PPG.txt` — the row accounting differs, so positions cannot be mapped'
    };
  var out = new Float64Array(nRows),
    w = 0;
  for (var f = 0; f < frames.length; f++) for (var j = 0; j < frames[f][1]; j++) out[w++] = (frames[f][0] + j) * RING_MS_PER_SAMPLE;
  return { ok: true, dev: out, frames: frames.length, samples: total };
}
/* Host time on the floor axis of each (fractional) sample position: interpolated device time + floor offset.
   Positions whose device time falls outside every anchored segment are DROPPED and counted, never placed. */
/* One device, one counter: every stream it sends is stamped by the same clock, so the device is anchored on
   whichever of its streams gives the most usable floor windows, and both of its legs map through that one.
   Measured 2026-09-27: the ACC edge is the sharp one on both devices (H10 3.5–3.9 ms, Verity 10.7–11.2 ms
   keyed on the last sample); the Verity PPG edge stays ~17 ms and would refuse under the 10 ms bar. */
function deviceFloor(sidecarText, metas) {
  var best = null,
    tried = [];
  metas.forEach(function (ms) {
    var f = floorMap(sidecarText, ms);
    tried.push(ms + ': ' + (f.ok ? f.windows - f.refused + ' usable window(s)' : f.reason));
    if (f.ok && (!best || f.windows - f.refused > best.windows - best.refused)) best = f;
  });
  return best || { ok: false, reason: tried.join('; ') };
}
function floorTimes(devCol, positions, fmap) {
  var out = [],
    unmapped = 0;
  for (var i = 0; i < positions.length; i++) {
    var p = positions[i],
      i0 = Math.floor(p),
      i1 = Math.min(devCol.length - 1, i0 + 1),
      fr = p - i0;
    var dev = i0 >= 0 && i0 < devCol.length ? devCol[i0] * (1 - fr) + devCol[i1] * fr : NaN,
      off = isFinite(dev) ? fmap.map(dev) : null;
    if (off == null || !isFinite(dev)) {
      unmapped++;
      continue;
    }
    out.push(dev + off);
  }
  out.sort(function (x, y) {
    return x - y;
  });
  return { hostMs: Float64Array.from(out), unmapped: unmapped };
}
/* The motion check: both accelerometers on their arrival floors, the motion envelopes aligned by the
   shared movement anchors. On a correct floor axis the offset measures only the two links' minimum-latency
   difference and should read ≈ 0; a large value means a floor is wrong, never a correction to apply. NOT fully
   independent when a device is anchored on its ACC stream (the usual case): it then tests that shared motion
   aligns across two separately-anchored devices, which a wrong floor on either still fails. */
var CHECK_TOL_MS = 25;
function accFloorCheck(h10AccText, verAccText, fA, fB, t0, t1) {
  function samples(text, fmap) {
    var L = String(text).split(/\r?\n/),
      head = (L[0] || '').split(';').map(function (x) {
        return x.trim();
      }),
      ci = head.indexOf('sensor timestamp [ns]'),
      out = [];
    if (ci < 0) return out;
    var ix = ci + 1;
    for (var i = 1; i < L.length; i++) {
      if (!L[i] || L[i].charAt(0) === '#') continue;
      var c = L[i].split(';'),
        dev = +c[ci] / 1e6,
        off = isFinite(dev) ? fmap.map(dev) : null;
      if (off == null) continue;
      out.push({ tMs: dev + off, x: +c[ix], y: +c[ix + 1], z: +c[ix + 2] });
    }
    return out;
  }
  /* 20 ms bins, not pat-align's 50 ms default: the check is judged at ±15 ms, and a 50 ms grid moves in whole-bin
     steps (a planted 0 read 46 ms). Not finer: the Verity ACC samples at ~52 Hz (19 ms), and a bin narrower than a
     sample leaves the envelope with empty bins and no clean movement at all (10 ms: 0 anchors). The bin-COUNTED
     default is rescaled so its time extent is unchanged. */
  var O = { dtMs: 20, anchorLocalBins: 30 };
  /* RESOLUTION, stated because a bar finer than it measures nothing: the lag moves in 20 ms bins and the Verity
     ACC samples every ~19 ms, so a perfect axis reads within about one bin of 0 (the plant: 19.8 ms). The check
     is judged at CHECK_TOL_MS = one bin + half a Verity sample; the PAT correction itself is not limited by it
     (the floors recover a planted PAT to ~5 ms). */
  /* The baseline EMA's α is PER SAMPLE, so one α gives the H10 (~205 Hz) a 0.24 s time constant and the Verity
     (~52 Hz) a 0.96 s one: the same movement then peaks at different offsets and the check reads a bias of about
     one bin on a perfect axis (planted 0 read 23 ms). Each device gets α for a common 1 s time constant from its
     own median sample interval — the shared pat-align.js default is left alone. */
  function withAlpha(sm) {
    var d = [];
    for (var i = 1; i < sm.length && d.length < 5000; i++) d.push(sm[i].tMs - sm[i - 1].tMs);
    var dtS = median(
      d.filter(function (x) {
        return x > 0;
      })
    );
    return { dtMs: O.dtMs, anchorLocalBins: O.anchorLocalBins, emaAlpha: isFinite(dtS) ? 1 - Math.exp(-dtS / 1000) : undefined };
  }
  var sA = samples(h10AccText, fA),
    sB = samples(verAccText, fB);
  var eA = PATAlign.envelope(sA, t0, t1, withAlpha(sA)),
    eB = PATAlign.envelope(sB, t0, t1, withAlpha(sB));
  if (!eA || !eB) return { ok: false, reason: 'no accelerometer samples on the floor axis' };
  var r = PATAlign.alignByAnchors(eA, eB, t0, O);
  if (!r.ok) return { ok: false, reason: r.reason + ' — chest & ankle motion too decorrelated', anchors: r.anchors.length };
  var offs = r.anchors.map(function (x) {
    return x.offsetMs;
  });
  return { ok: true, anchors: offs.length, deltaMedianMs: median(offs), offRangeMs: r.offsetRangeMs, tolMs: CHECK_TOL_MS };
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
  /* The O2Ring finger PPG is OPTIONAL and read last, so every index above is unchanged without it. */
  var hasFinger = !!m.fingerFile;
  if (hasFinger) reads.push(m.fingerFile.text());
  var iFinger = hasFinger ? reads.length - 1 : -1;
  /* The packet-arrival sidecars (one per device) — the corrected path's only anchor. Read last, OPTIONAL. */
  var hasArr = !!(m.ecgArrFile && m.ppgArrFile),
    iArrE = -1,
    iArrP = -1;
  // The RING's sidecar is independent of the Polar pair: chest → ankle can be corrected without it, and it
  // alone is what the finger leg needs. Kept a separate flag so a missing ring sidecar refuses the FINGER
  // floor with its own reason instead of refusing the pair that does have one.
  var hasRingArr = !!m.ringArrFile,
    iArrR = -1;
  if (hasArr) {
    reads.push(m.ecgArrFile.text(), m.ppgArrFile.text());
    iArrE = reads.length - 2;
    iArrP = reads.length - 1;
  }
  if (hasRingArr) {
    reads.push(m.ringArrFile.text());
    iArrR = reads.length - 1;
  }
  Promise.all(reads)
    .then(function (t) {
      try {
        var ecg = ecgRpeakTimes(t[0]),
          ppg = ppgFootTimes(t[1]);
        var ov = overlap(ecg, ppg),
          cp = coupledPAT(ecg.times, ppg.times),
          sc = sharedClock(ecg, ppg, ov),
          /* THE AXIS THE GATE JUDGES ON. Both parsers now forward theirs; `worstAxis` picks the leg that
             decides (drawn > non-independent > either), because a PAT number is only as good as the
             worse of the two clocks. Passing nothing here — which is what this call did until
             2026-08-17 — left the gate's clock refusals inert in the one path that ships them. */
          ax = PATGate.worstAxis(ecg.hostAxis, ppg.hostAxis),
          vd = PATGate.verdict(ov, cp, sc, ax);
        /* `ovL` — THE SPAN THIS LEG'S RATE IS DIVIDED BY, now passed in rather than closed over.
           `packCp` read the outer `ov` (chest→ankle) for every leg, so `cpF`'s rate was the FINGER
           leg's drift range over the ANKLE leg's span and `cpFA`'s was a range over a span belonging to
           neither of its two ends. Nothing read those two numbers, which is why it survived — but the
           refusal sentence added here QUOTES the span in minutes, and a sentence naming the wrong
           recording would be worse than the silence it replaces. Each call now names its own overlap. */
        function packCp(c, ovL) {
          if (!c.ok) return { ok: false, reason: c.reason };
          var dpr = driftPpmWithReason(c.driftRange, ovL.min);
          return {
            ok: true,
            med: c.med,
            p25: c.p25,
            p75: c.p75,
            matchRate: c.matchRate,
            nCoupled: c.nCoupled,
            residIQR: c.residIQR,
            censoredPct: c.censoredPct,
            censoredN: c.censoredN,
            driftRange: c.driftRange,
            driftRangeQual: c.driftRangeQual,
            stepP95: c.stepP95,
            nSteps: c.nSteps,
            binsQualified: c.binsQualified,
            binsTotal: c.binsTotal,
            slope: c.slope,
            linR2: c.linR2,
            inPhysPct: c.inPhysPct,
            ppm: dpr.ppm,
            ppmReason: dpr.reason,
            residIQRReason: c.residIQRReason,
            driftRangeReason: c.driftRangeReason,
            binMed: c.binMed,
            /* ADDITIVE 2026-09-26: the surviving coupled pairs, `{t, lag}` per beat — `coupledPAT`
                   has always RETURNED these and `packCp` dropped them. A PAT lag's weight needs both
                   of its ends, and both are derivable from here: the R second is `t`, the foot second
                   is `t + lag`. Keeping the pairs is what lets the weighting live in the CONSUMER, so
                   `coupledPAT` and every number above it stay untouched and a classic column built
                   from this object is PAT Feasibility's own output rather than a reproduction of it. */
            /* The surviving coupled pairs, `{t, lag}` per beat — `coupledPAT` has always returned
                   these and `packCp` dropped them. ⚠️ ONLY WHEN `m.detail` IS SET (Wren, 2026-09-26): the
                   batch path packs every leg of every night, and a full `patAtR` is ~23k objects per leg —
                   ×3 legs × N nights across `postMessage` with no reader, which is the dead-cross-boundary
                   shape the unwired gate holds at zero. The page requests `detail` anyway.
                   ⚠️ And note what this list is NOT for: `pack()` DECIMATES it to ~4000 points, so it is
                   for drawing, never for weighting. Every fused number below is computed inside this
                   worker on the FULL accepted set, which is why the weighting lives here at all. */
            patAtR: m.detail ? c.patAtR : undefined
          };
        }
        var out = {
          type: 'result',
          key: key,
          label: m.label,
          ecg: { t0Ms: ecg.t0Ms, fs: ecg.fs, n: ecg.n, durSec: ecg.durSec, nRaw: ecg.nRaw, artifactSec: ecg.artifactSec, artifactGate: ecg.artifactGate },
          ppg: { t0Ms: ppg.t0Ms, fs: ppg.fs, n: ppg.n, durSec: ppg.durSec },
          ov: ov,
          sc: sc,
          vd: vd,
          driftSource: 'raw', // §1.5 — `vd` reflects UNCORRECTED drift; see `vdCorr` for the arrival-floor-corrected gate

          cp: packCp(cp, ov)
        };
        // ── THIRD SITE: chest→finger, finger→ankle and the hat (only if the O2Ring _PPG.txt was provided) ──
        var cpF = null,
          cpFA = null;
        if (hasFinger) {
          try {
            var fin = ppgFootTimes(t[iFinger]),
              ovF = overlap(ecg, fin),
              scF = sharedClock(ecg, fin, ovF);
            cpF = coupledPAT(ecg.times, fin.times);
            cpFA = coupledPAT(fin.times, ppg.times, FINGER_ANKLE_BAND, { start: 'finger-foot', end: 'ankle-foot' });
            var ovFA = overlap(fin, ppg); // the finger→ankle leg's OWN span — neither end of it is the chest
            out.finger = { t0Ms: fin.t0Ms, fs: fin.fs, n: fin.n, durSec: fin.durSec };
            out.cpF = packCp(cpF, ovF);
            /* the ring's axis is DRAWN (sample index × an assumed rate), so the gate refuses to CERTIFY this leg;
               the lag is still computed and shown, signed NOT CERTIFIED with the gate's own reason */
            out.vdF = PATGate.verdict(ovF, cpF, scF, PATGate.worstAxis(ecg.hostAxis, fin.hostAxis));
            out.cpFA = packCp(cpFA, ovFA);
            out.three = threeHat(cpF, cp, cpFA);
            /* ── THE FUSED TWIN, on the FULL accepted set of each leg ──────────────────────────────────
               Corners: A = chest (H10 ECG, `ecg.conf`), B = finger (O2Ring, `fin.conf`), C = ankle
               (Verity, `ppg.conf`). Legs pair the two ends they actually join, so each leg's weight is the
               product of ITS OWN two corners' confidence — not a per-corner weight reused across legs.
               The classic numbers above are untouched; `out.three` is the same call it always was. */
            var lwF = AnalysisStats.legWeights(cpF, ecg.conf, fin.conf), // chest → finger
              lwAC = AnalysisStats.legWeights(cp, ecg.conf, ppg.conf), // chest → ankle
              lwFA = AnalysisStats.legWeights(cpFA, fin.conf, ppg.conf); // finger → ankle
            out.fused = {
              cpF: AnalysisStats.fusedLeg(cpF, lwF),
              cp: AnalysisStats.fusedLeg(cp, lwAC),
              cpFA: AnalysisStats.fusedLeg(cpFA, lwFA),
              /* Which corners published a confidence series at all, so the page can say UNWEIGHTED and
                 WHY rather than showing a number that silently fell back to 1 (§∅). The O2Ring's
                 single-channel drawn-axis PPG is the corner whose confidence is UNVERIFIED — that is a
                 different claim from unusable, and the page must not upgrade it. */
              corners: { chest: !!ecg.conf, finger: !!fin.conf, ankle: !!ppg.conf }
            };
            out.threeFused =
              lwF.ok && lwAC.ok && lwFA.ok
                ? threeHat(cpF, cp, cpFA, lwF.w, lwAC.w, lwFA.w)
                : {
                    ok: false,
                    reason:
                      'a leg could not be weighted: ' +
                      [lwF, lwAC, lwFA]
                        .filter(function (l) {
                          return !l.ok;
                        })
                        .map(function (l) {
                          return l.reason;
                        })[0]
                  };
          } catch (fe) {
            out.fingerError = String((fe && fe.message) || fe);
          }
        }
        // ── the corrected path: both legs on their own streams' ARRIVAL FLOORS (see the block above floorMap) ──
        var cpCorr = null;
        function refuseFloor(why) {
          out.floorSync = { available: false, reason: why };
        }
        if (!hasArr)
          refuseFloor(
            'no packet-arrival sidecar for ' +
              (!m.ecgArrFile && !m.ppgArrFile ? 'either device' : !m.ecgArrFile ? 'the H10' : 'the Verity') +
              ' — the floor axis has no anchor, and a phone stamp would reintroduce the buffering'
          );
        else if (!(sc.ok && ov.min > 0)) refuseFloor('the two recordings do not share a clock window');
        else {
          var fE = deviceFloor(t[iArrE], ['acc', 'ecg']),
            fP = deviceFloor(t[iArrP], ['acc', 'ppg']),
            devE = devMsColumn(t[0]),
            devP = devMsColumn(t[1]);
          if (!fE.ok) refuseFloor('H10 ECG: ' + fE.reason);
          else if (!fP.ok) refuseFloor('Verity PPG: ' + fP.reason);
          else if (!devE || devE.length !== ecg.nSamples)
            refuseFloor('H10 ECG: ' + (devE ? devE.length : 0) + ' device-stamp rows vs ' + ecg.nSamples + ' samples — the row accounting differs, so positions cannot be mapped');
          else if (!devP || devP.length !== ppg.nSamples)
            refuseFloor('Verity PPG: ' + (devP ? devP.length : 0) + ' device-stamp rows vs ' + ppg.nSamples + ' samples — the row accounting differs, so positions cannot be mapped');
          else {
            var R = floorTimes(devE, ecg.pos, fE),
              F = floorTimes(devP, ppg.feetIdx, fP);
            cpCorr = coupledPAT(R.hostMs, F.hostMs);
            out.cpCorr = packCp(cpCorr, ov);
            // the same gate, on the corrected coupling; the primary `vd` stays on the raw legs (an owner call)
            out.vdCorr = PATGate.verdict(ov, cpCorr, sc, ax);
            var leg = function (f, tm) {
              return { stream: f.meas, windows: f.windows, refused: f.refused, segments: f.segments, spreadMedianMs: f.spreadMedianMs, unmapped: tm.unmapped };
            };
            var chk = null;
            if (hasAcc) {
              var fAE = floorMap(t[iArrE], 'acc'),
                fAP = floorMap(t[iArrP], 'acc');
              chk = !fAE.ok ? { ok: false, reason: 'H10 ACC: ' + fAE.reason } : !fAP.ok ? { ok: false, reason: 'Verity ACC: ' + fAP.reason } : accFloorCheck(t[2], t[3], fAE, fAP, ov.start, ov.end);
            }
            /* ── THE FINGER ON ITS OWN FLOOR, AND THE HAT ON THREE OF THEM ──────────────────────────
               Until #3267 the ring had no arrival sidecar, so both pages solved the hat on RAW receive
               stamps and every corner's σ carried its link's buffering. With the finger on its own floor
               the three legs finally share one KIND of axis. The raw hat stays exactly where it was —
               `out.three` / `out.threeFused` are untouched — and this is a second, separately labelled
               result, never a delta between them (the drift-removed row's rule, PAT-HAT-DRIFT-DIFFERENCED). */
            var ringLeg = null;
            // `fin` / `ovF` / `ovFA` are `var`-hoisted out of the finger block above, so they are in scope
            // here — but only BOUND if that block's try did not throw. `fin` undefined means the finger leg
            // itself failed (`out.fingerError` says how), which is a different refusal from having no sidecar.
            if (hasFinger && fin && cpCorr && cpCorr.ok) {
              if (!hasRingArr)
                ringLeg = {
                  ok: false,
                  reason:
                    'no arrival sidecar for the O2Ring — E11 (#3267) writes one per PPG frame, so a capture from before the box restarted on it has none, and the synthesized grid may not stand in for a floor'
                };
              else {
                var fR = floorMap(t[iArrR], 'PPG_FRAME', ringPacket),
                  devR = fR.ok ? ringDevColumn(t[iArrR], fin.nSamples) : null;
                if (!fR.ok) ringLeg = { ok: false, reason: 'O2Ring PPG: ' + fR.reason };
                else if (!devR.ok) ringLeg = { ok: false, reason: 'O2Ring PPG: ' + devR.reason };
                else {
                  var FR = floorTimes(devR.dev, fin.feetIdx, fR),
                    cpFCorr = coupledPAT(R.hostMs, FR.hostMs),
                    cpFACorr = coupledPAT(FR.hostMs, F.hostMs, FINGER_ANKLE_BAND, { start: 'finger-foot', end: 'ankle-foot' });
                  out.cpFCorr = packCp(cpFCorr, ovF);
                  out.cpFACorr = packCp(cpFACorr, ovFA);
                  // The hat on three floor axes — the thing none of this could produce before.
                  out.threeCorr = threeHat(cpFCorr, cpCorr, cpFACorr);
                  ringLeg = {
                    ok: true,
                    stream: 'PPG_FRAME',
                    windows: fR.windows,
                    refused: fR.refused,
                    segments: fR.segments,
                    spreadMedianMs: fR.spreadMedianMs,
                    unmapped: FR.unmapped,
                    frames: devR.frames,
                    samples: devR.samples
                  };
                }
              }
            } else if (hasFinger)
              ringLeg = {
                ok: false,
                reason: !fin ? 'the finger leg did not parse — see `fingerError`' : 'the chest → ankle corrected coupling did not solve, so a three-floor hat has no second leg'
              };
            out.floorSync = {
              available: true,
              anchor: 'arrival-floor',
              ecg: leg(fE, R),
              ppg: leg(fP, F),
              finger: ringLeg,
              // what the median-anchored legs carried and this removed: the links' median buffering difference
              bufferingDiffMs: cp.ok && cpCorr.ok ? cp.med - cpCorr.med : null,
              accCheck: chk || { ok: false, reason: 'no ACC files' }
            };
          }
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
          out.detailF = pack(cpF);
          out.detailFA = pack(cpFA);
          /* `detailCorr = pack(cpCorr)` used to be emitted here too — computed, sent across the
             boundary, read by nobody (residue 2026-09-02-pat-detailcorr-unread, the same class as
             `vdCorr` before #2117). Its parent finding, ENGINE-VERIFICATION §1.5, closed as MOOT:
             "re-instrumenting a feasibility tool whose feasibility question has a final answer would
             be work with no consumer" — so the field is deleted rather than given a surface. The
             corrected coupling's SUMMARY (`cpCorr`, `vdCorr`, `floorSync`) is read and stays. The
             `dead-cross-boundary` gate now holds the known-dead set at ZERO. */
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
