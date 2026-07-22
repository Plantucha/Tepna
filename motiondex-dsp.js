/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   MotionDex · DSP  (motiondex-dsp.js)
   ────────────────────────────────────────────────────────────────────────
   One signal: inertial MOTION (IMU). Ingests the Polar Sensor Logger IMU
   streams — Verity Sense + H10 chest ACC / GYRO / MAGN — on the Clock
   Contract and computes the SINGLE-SIGNAL motion metrics:
     · body position   (gravity-vector decomposition → supine/lateral/prone/upright)
     · actigraphy      (de-gravitated activity counts, movement / immobility epochs)
     · respiratory effort (chest-ACC thoraco-abdominal effort waveform + rate)
     · motion SQI      (flatline / sensor-off / clip flags → Ganglior `conf`)

   Cross-sensor fusions (apnea typing = motion×desat, sleep staging = motion×HRV,
   motion-gated HRV) live in the Integrator and CONSUME this node's export —
   NOT here. Keep MotionDex honest to its one signal.

   Parsing mirrors ppgdex-dsp.js `parseSensorXYZ` (the shared Polar idiom);
   timestamps DELEGATE to DexClock (Clock Contract, single-sourced in clock.js).
   100% local — nothing leaves the browser. Exposes window.MOTIONDSP / window.MotionDex.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  // ─── Clock Contract — delegate the PARSER to the single-sourced clock.js (co-loads first);
  //     display helpers are local getUTC* per §5 (DexClock exposes only the parser family).
  var parseTimestamp = DexClock.parseTimestamp;
  function p2(v, w) {
    v = String(v);
    while (v.length < (w || 2)) v = '0' + v;
    return v;
  }
  function fmtClock(ms) {
    if (ms == null) return null;
    var d = new Date(ms);
    return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds());
  }

  // ─── small helpers (avoid spread on large arrays) ──────────────────────────
  function mean(a) {
    var s = 0,
      n = a.length;
    if (!n) return NaN;
    for (var i = 0; i < n; i++) s += a[i];
    return s / n;
  }
  function median(a) {
    if (!a.length) return NaN;
    var b = Array.prototype.slice.call(a).sort(function (x, y) {
      return x - y;
    });
    var m = b.length >> 1;
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  }
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
  // centred moving average (odd-ish window); returns Float32Array same length
  function movavg(arr, w) {
    var n = arr.length,
      out = new Float32Array(n);
    if (w < 1) w = 1;
    var half = w >> 1,
      acc = 0,
      i;
    for (i = 0; i < n; i++) {
      acc += arr[i];
      if (i >= w) acc -= arr[i - w];
      // running window [i-w+1 .. i]; recentre by shifting index
      var j = i - half;
      if (j >= 0) out[j] = acc / Math.min(w, i + 1);
    }
    // tail fill
    for (i = Math.max(0, n - half); i < n; i++) out[i] = out[i] || arr[i];
    for (i = 0; i < n; i++) if (!isFinite(out[i])) out[i] = arr[i];
    return out;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  PARSE — Polar Sensor Logger IMU stream
  //  header:  Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]      (ACC)
  //           Phone timestamp;sensor timestamp [ns];X [dps];Y [dps];Z [dps]   (GYRO)
  //           …[µT]…                                                          (MAGN)
  //  row:     2026-06-10T21:15:41.382;599628005694359040;-580;573;529
  //  Phone timestamp = ISO-8601 no-zone → floating tMs via DexClock (Clock Contract §2.3).
  //  sensor ns = Polar monotonic device counter → precise inter-sample Δ (relNs).
  // ════════════════════════════════════════════════════════════════════════
  var UNIT_RE = /\[\s*(mg|dps|deg\/s|µT|uT|g|G)\s*\]/i;
  function streamKindFromHeader(headerLine) {
    var h = (headerLine || '').toLowerCase();
    var m = (headerLine || '').match(UNIT_RE);
    var unit = m ? m[1] : null;
    // GYRO — angular rate.
    if (/dps|deg\/s/.test(h)) return { kind: 'gyro', unit: unit || 'dps' };
    // MAGNETOMETER — µT/uT, a MAGN header, OR Gauss `[G]`. DEEP-AUDIT-II §7.9: a capital-G `[G]` is GAUSS,
    // a MAGNETIC unit — NOT gravity 'g'/'mg'. The old acc branch `/mg|(^g$)|G/` matched it and returned
    // {kind:'acc', unit:'G'}, so a real Polar-Sense `X [G]` MAGN file was typed as acceleration and read as
    // gravity-g by toG. CASE is the discriminator (UNIT_RE's /i capture preserves it): `unit==='G'` is Gauss,
    // `'g'` is gravity. Gauss → µT (1 G = 100 µT, CLAUDE.md §📏) is applied at the parse boundary below.
    if (/µt|ut/i.test(h) || /magn/.test(h) || unit === 'G') return { kind: 'mag', unit: unit === 'G' ? 'G' : unit || 'µT' };
    // ACC — milli-g (mg, case-insensitive: a `[mG]` header is still milli-g) or gravity-g (lowercase g).
    if (unit && /^mg$/i.test(unit)) return { kind: 'acc', unit: 'mg' };
    if (unit === 'g') return { kind: 'acc', unit: 'g' };
    if (/\[\s*mg\s*\]/i.test(h)) return { kind: 'acc', unit: 'mg' };
    return { kind: 'acc', unit: 'mg' }; // XYZ default (milli-g)
  }
  // Filename stream token (ACC / GYRO / MAGN), tolerant of Polar Sensor Logger "(1)" re-downloads.
  function streamKindFromName(name) {
    var m = /_(ACC|GYRO|MAGN?|MAG)\b/i.exec(name || '');
    if (!m) return null;
    var t = m[1].toUpperCase();
    if (t === 'ACC') return 'acc';
    if (t === 'GYRO') return 'gyro';
    return 'mag'; // MAG / MAGN
  }

  // ── Column indices come from the HEADER, never from fixed positions ──────────────────────────────
  // Layouts legitimately vary and will keep varying. Our capture host emitted an extra
  // `timestamp [ms]` column before 2026-07-18 11:43 and not after; Polar Sensor Logger's own PPG
  // header reads `channel 0..2` where ours once read `ppg0..2`; and per-stream RATE SELECTION means
  // more variants are expected, not exceptional. A fixed index silently SHIFTS when a column appears:
  // measured on 478 real pre-11:43 files, `x` received the millisecond value, `y` received true X,
  // `z` received true Y, and true Z was discarded — with no error anywhere.
  function xyzColsFromHeader(headerLine) {
    var p = String(headerLine || '').split(';');
    var idx = { x: -1, y: -1, z: -1, ns: -1, phone: -1 };
    for (var i = 0; i < p.length; i++) {
      var h = p[i].trim().toLowerCase();
      if (/^x(\s|\[|$)/.test(h)) idx.x = i;
      else if (/^y(\s|\[|$)/.test(h)) idx.y = i;
      else if (/^z(\s|\[|$)/.test(h)) idx.z = i;
      else if (/sensor\s+timestamp/.test(h)) idx.ns = i;
      else if (/phone\s+timestamp/.test(h)) idx.phone = i;
    }
    return idx.x >= 0 && idx.y >= 0 && idx.z >= 0 ? idx : null;
  }
  // Fallback for a headerless/unknown file: the LAST THREE numeric columns. Correct for BOTH the 5-
  // and 6-column layouts and for any future LEADING column, because XYZ is always the tail.
  function xyzColsByTail(p) {
    var nums = [];
    for (var k = 0; k < p.length; k++) {
      if (isFinite(parseFloat(p[k]))) nums.push(k);
    }
    if (nums.length < 3) return null;
    return { x: nums[nums.length - 3], y: nums[nums.length - 2], z: nums[nums.length - 1], ns: 1, phone: 0 };
  }
  function parseSensorXYZ(text) {
    var lines = String(text || '').split(/\r?\n/);
    var out = [];
    var ns0 = null;
    var headerKind = null;
    var cols = null;
    for (var li = 0; li < lines.length; li++) {
      var t = lines[li].trim();
      if (!t) continue;
      if (headerKind === null && /timestamp/i.test(t)) {
        headerKind = streamKindFromHeader(t);
        cols = xyzColsFromHeader(t) || cols;
        continue;
      }
      var p = t.split(';');
      if (p.length < 5) continue;
      var c = cols || xyzColsByTail(p);
      if (!c) continue;
      var x = parseFloat(p[c.x]);
      if (!isFinite(x)) continue; // skips a stray header row too
      var relNs = NaN;
      try {
        var b = BigInt(p[c.ns >= 0 ? c.ns : 1].trim());
        if (ns0 === null) ns0 = b;
        relNs = Number(b - ns0);
      } catch {}
      var ts = parseTimestamp(p[c.phone >= 0 ? c.phone : 0]);
      out.push({ relNs: relNs, tMs: ts ? ts.tMs : null, x: x, y: parseFloat(p[c.y]), z: parseFloat(p[c.z]) });
    }
    out._kind = headerKind ? headerKind.kind : null;
    out._unit = headerKind ? headerKind.unit : null;
    // DEEP-AUDIT-II §7.9 — normalize a Gauss magnetometer stream to SI µT at the parse boundary (1 G = 100 µT,
    // CLAUDE.md §📏) so a `[G]` file is an honest µT mag stream and can never be read as gravity-g downstream.
    if (out._kind === 'mag' && out._unit === 'G') {
      for (var gi = 0; gi < out.length; gi++) {
        out[gi].x *= 100;
        out[gi].y *= 100;
        out[gi].z *= 100;
      }
      out._unit = 'µT';
    }
    return out;
  }

  // The first wall-clock stamp of a stream — its base for anchoring the per-stream device counter.
  function streamBaseMs(rows) {
    if (rows) for (var i = 0; i < rows.length; i++) if (rows[i] && rows[i].tMs != null) return rows[i].tMs;
    return null;
  }
  // seconds-from-t0Ms of a row. relNs is the precise device counter but is PER-STREAM (0 at THIS
  // stream's first sample), so it must be anchored to the stream's own wall-clock base before being
  // measured against the GLOBAL t0Ms — else a later-starting stream (e.g. the chest sensor, when
  // t0Ms = the earlier wrist start) is time-shifted by (streamStart − t0Ms). DEEP-AUDIT-II §7.2.
  // baseMs = streamBaseMs(theStream); pass it so the precise relNs lands on the right absolute instant.
  function relSecOf(r, t0Ms, baseMs) {
    if (isFinite(r.relNs) && baseMs != null && t0Ms != null) return (baseMs - t0Ms) / 1000 + r.relNs / 1e9;
    if (r.tMs != null && t0Ms != null) return (r.tMs - t0Ms) / 1000;
    if (isFinite(r.relNs)) return r.relNs / 1e9; // no wall-clock anchor available — stream-relative fallback
    return null;
  }
  // convert an ACC row's XYZ to g (gravity units) given its unit
  function toG(v, unit) {
    // DEEP-AUDIT-II §7.9 — mg is matched CASE-INSENSITIVELY (a `[mG]` header is still milli-g; the old
    // `unit === 'mg'` missed it and read the value as g → 1000× motion metrics). Gauss never reaches here
    // (routed to mag + converted to µT at the parse boundary); a plain 'g' that does is already in g.
    return /^mg$/i.test(unit) ? v / 1000 : v;
  }
  function sampleHz(rows, t0Ms) {
    if (rows.length < 3) return NaN;
    var baseMs = streamBaseMs(rows);
    var a = relSecOf(rows[0], t0Ms, baseMs),
      b = relSecOf(rows[rows.length - 1], t0Ms, baseMs);
    if (a == null || b == null || b <= a) return NaN;
    return (rows.length - 1) / (b - a);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  BODY POSITION — gravity-vector decomposition (Rocha et al. 2026 [Ro26])
  //  Device-frame convention (documented, uncalibrated → the LABEL is
  //  experimental-tier; the gravity ANGLES are measured). For a torso/chest
  //  sensor: Y ≈ superior-inferior, Z ≈ antero-posterior, X ≈ medio-lateral.
  //    upright  |gy| dominant           supine   gz > 0     prone   gz < 0
  //    lateral  |gx| dominant (sign → L/R)
  //  ⚠️ THE Z SIGN IS FLEET-WIDE, NOT NODE-LOCAL. An accelerometer at rest reads
  //  +1 g on the axis pointing UP, so a chest sensor worn anterior-face-out reads
  //  gz > 0 when the wearer is SUPINE. ECGDex (`uz > 0 ? 'Supine' : 'Prone'`) and
  //  PPGDex both already encode that; MotionDex had it INVERTED until 2026-07-20,
  //  which labelled a real supine night 100 % prone off the same H10 ACC that
  //  ECGDex read as supine (owner-confirmed supine; chest Z measured +973 mg).
  //  Its own synthetic twin emitted gravity on −Z under the comment "supine", so
  //  the golden agreed with the bug and never caught it — see
  //  briefs/POSTURE-SIGN-AND-NADIR-LABELS-2026-07-20-BRIEF.md.
  // ════════════════════════════════════════════════════════════════════════
  var POSITIONS = ['supine', 'prone', 'left', 'right', 'upright', 'unknown'];
  function classifyGravity(gx, gy, gz) {
    var mag = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (!(mag > 0.4) || mag > 2.0) return 'unknown'; // not ~1g static → moving / off
    gx /= mag;
    gy /= mag;
    gz /= mag;
    var ax = Math.abs(gx),
      ay = Math.abs(gy),
      az = Math.abs(gz);
    if (ay >= ax && ay >= az) return 'upright';
    if (ax >= az) return gx < 0 ? 'left' : 'right';
    return gz > 0 ? 'supine' : 'prone';
  }
  function bodyPosition(accRows, t0Ms, durSec, unit) {
    if (!accRows || accRows.length < 10) return { hasData: false };
    var baseMs = streamBaseMs(accRows); // §7.2 anchor
    var epoch = 30; // s
    var nE = Math.max(1, Math.ceil(durSec / epoch));
    // bucket gravity (slow-averaged XYZ) per epoch via component medians
    var bx = [],
      by = [],
      bz = [];
    for (var e = 0; e < nE; e++) {
      bx.push([]);
      by.push([]);
      bz.push([]);
    }
    for (var i = 0; i < accRows.length; i++) {
      var s = relSecOf(accRows[i], t0Ms, baseMs);
      if (s == null || s < 0) continue;
      var idx = Math.min(nE - 1, Math.floor(s / epoch));
      bx[idx].push(toG(accRows[i].x, unit));
      by[idx].push(toG(accRows[i].y, unit));
      bz[idx].push(toG(accRows[i].z, unit));
    }
    var track = [],
      covered = 0, // epochs that HAD accelerometer samples — the dwell-fraction denominator
      dwell = { supine: 0, prone: 0, left: 0, right: 0, upright: 0, unknown: 0 };
    for (e = 0; e < nE; e++) {
      if (!bx[e].length) {
        // NOT RECORDING this epoch (gap / before the sensor started). It leaves the denominator
        // entirely — it is neither a posture nor "unknown posture". Counting it dilutes every
        // dwellFrac (a longer wrist file's tail then halves a real supineFrac). DEEP-AUDIT-II §7.4 —
        // the CLEAN mirror of the seen/covered fix `actigraphy` already carries (:298-323). The track
        // keeps 'unknown' so the timeline stays dense and the posture_change export skips it.
        track.push({ tStartMs: t0Ms != null ? t0Ms + e * epoch * 1000 : null, pos: 'unknown' });
        continue;
      }
      covered++;
      var pos = classifyGravity(median(bx[e]), median(by[e]), median(bz[e]));
      dwell[pos]++;
      track.push({ tStartMs: t0Ms != null ? t0Ms + e * epoch * 1000 : null, pos: pos });
    }
    var frac = {};
    for (var k = 0; k < POSITIONS.length; k++) frac[POSITIONS[k]] = covered ? dwell[POSITIONS[k]] / covered : 0;
    var supineFrac = frac.supine;
    return { hasData: true, epochSec: epoch, track: track, dwellEpochs: dwell, coveredEpochs: covered, dwellFrac: frac, supineFrac: supineFrac };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ACTIGRAPHY — de-gravitated activity counts + movement / immobility epochs
  // ════════════════════════════════════════════════════════════════════════
  function actigraphy(accRows, t0Ms, durSec, unit) {
    if (!accRows || accRows.length < 10) return { hasData: false };
    var baseMs = streamBaseMs(accRows); // §7.2 anchor
    var hz = sampleHz(accRows, t0Ms);
    if (!isFinite(hz) || hz <= 0) hz = accRows.length / Math.max(1, durSec);
    var mags = new Float32Array(accRows.length);
    for (var i = 0; i < accRows.length; i++) {
      var gx = toG(accRows[i].x, unit),
        gy = toG(accRows[i].y, unit),
        gz = toG(accRows[i].z, unit);
      mags[i] = Math.sqrt(gx * gx + gy * gy + gz * gz);
    }
    // gravity baseline via ~1s moving average → dynamic (de-gravitated) magnitude
    var w = Math.max(3, Math.round(hz));
    var base = movavg(mags, w);
    var epoch = 30,
      nE = Math.max(1, Math.ceil(durSec / epoch));
    var counts = new Float64Array(nE);
    // per-epoch SAMPLE COUNT — 0 means the accelerometer was NOT RECORDING that epoch. Without this an
    // uncovered epoch scores counts=0 ⇒ moving=false ⇒ counted as IMMOBILE, i.e. a recording gap
    // fabricates stillness. `moving` is therefore TRI-STATE (true / false / null-for-no-coverage) and
    // uncovered epochs leave the immobileFrac denominator entirely.
    var seen = new Uint32Array(nE);
    var MOVE_G = 0.02; // ~20 mg dynamic threshold
    for (i = 0; i < accRows.length; i++) {
      var s = relSecOf(accRows[i], t0Ms, baseMs);
      if (s == null || s < 0) continue;
      var idx = Math.min(nE - 1, Math.floor(s / epoch));
      seen[idx]++;
      var dyn = Math.abs(mags[i] - base[i]);
      if (dyn > MOVE_G) counts[idx] += dyn;
    }
    var epochs = [],
      immobile = 0,
      covered = 0,
      total = 0;
    for (var e = 0; e < nE; e++) {
      var tEp = t0Ms != null ? t0Ms + e * epoch * 1000 : null;
      if (!seen[e]) {
        epochs.push({ tStartMs: tEp, count: null, moving: null }); // NOT RECORDING — never "immobile"
        continue;
      }
      covered++;
      var moving = counts[e] > 1.0; // counts are Σ dynamic-g in the 30 s epoch
      if (!moving) immobile++;
      total += counts[e];
      epochs.push({ tStartMs: tEp, count: counts[e], moving: moving });
    }
    return {
      hasData: true,
      epochSec: epoch,
      hz: hz,
      epochs: epochs,
      coveredEpochs: covered,
      totalCounts: total,
      immobileFrac: covered ? immobile / covered : null,
      movementIndex: covered ? total / covered : null
    };
  }

  /* ════════════════════════════════════════════════════════════════════════
     RESPIRATORY RATE — spectral ridge tracking (MOTIONDEX-RESPIRATORY-RATE-2026-07-21)
     ────────────────────────────────────────────────────────────────────────
     Validated on 26 nights / 172 h / 19,193 epochs of Polar H10 chest ACC against
     ResMed CPAP `Flow.40ms` breath-by-breath reference:
        MAE 1.01 brpm (95% CI 0.91-1.12), 91.6% within 2 brpm, at 100% coverage;
        MAE 0.56 / 97.8% at 70% coverage, i.e. AT the reference's own 0.70 brpm floor.
     The predecessor zero-crossing estimator (still below, still exported) scored
     MAE 3.59 on the same epochs — worse than predicting a constant (1.50).

     Design notes, each measured rather than assumed:
       · 3 band-passed acceleration axes. A tilt-ANGLE channel is NOT built: for a
         DC-coupled chest sensor the band-passed raw axis ALREADY IS the gravity-
         reprojection signal scaled by g, so arcsin is near-identity over
         physiological tilt. Measured corr(spectrum(acc-X), spectrum(tilt-1)) = +1.000.
       · Viterbi ridge tracking beats per-epoch peak-picking (MAE 1.18 vs 1.54) —
         respiratory rate is temporally smooth.
       · A time-domain zero-crossing estimate is blended into the spectral likelihood
         (Charlton et al. 2016, Physiol Meas 37(4):610, 314 algorithms: every
         top-ranked algorithm used time-domain breath detection). MAE 1.08 -> 1.02.
     ⚠ POSTURE ROBUSTNESS IS UNTESTED. The validation corpus has gravity-roll IQR
     13.1-17.9 deg — one posture. Do not claim posture robustness anywhere.
     ════════════════════════════════════════════════════════════════════════ */
  var RR_FS = 5.0; // Hz — analysis rate after decimation
  var RR_BAND_LO = 0.13,
    RR_BAND_HI = 0.5; // respiratory band-pass (Hz)
  var RR_F_LO = 0.1,
    RR_F_HI = 0.6; // rate search band (6–36 brpm)
  var RR_F_STEP = 0.004; // spectral grid (~0.24 brpm)
  var RR_TAPER_F = 0.16,
    RR_TAPER_W = 0.01; // soft spectral high-pass
  var RR_WIN_SEC = 60,
    RR_HOP_SEC = 30;
  var RR_VITERBI_SIGMA = 1.2; // brpm — per-hop rate-change scale
  var RR_CONF_HALF_BINS = 6; // ±6 bins ≈ ±1.4 brpm
  var RR_NFFT = 2048;
  var RR_TD_WEIGHT = 0.3,
    RR_TD_SIGMA = 1.0; // time-domain blend
  /* Corpus-median under-estimate against the CPAP-flow reference: +0.58 brpm,
     consistent on all 26 nights (per-night −0.20..−1.27), and the validation MAE of
     1.01 was measured WITH it applied leave-one-night-out.
     DEFAULT IS ZERO, deliberately. It is SUBJECT-FITTED, and it is a property of real
     breathing measured against `60/median(period)` — a pure sinusoid has no such
     offset, so applying it by default both smuggles one person's constant into every
     other user's data AND breaks the synthetic known-answer test (15 brpm reads 15.7).
     Callers who have re-derived it for their own subject pass `opts.biasBrpm`. */
  var RR_BIAS_BRPM_CORPUS = 0.58; // documented, NOT applied by default
  var RR_CONF_MIN = 0.28; // abstain below this — abstention is the largest accuracy lever

  // Butterworth SOS via bilinear transform (order must be even).
  function butterSOS(order, fcHz, fsHz, type) {
    var w = Math.tan((Math.PI * fcHz) / fsHz);
    var sos = [],
      k,
      nSec = order >> 1;
    for (k = 0; k < nSec; k++) {
      var theta = (Math.PI * (2 * k + 1)) / (2 * order);
      var sinT = 2 * Math.sin(theta);
      if (sinT === 0) sinT = 1e-9;
      var alpha = w * sinT;
      var d = 1 + alpha + w * w;
      var b0, b1, b2;
      if (type === 'low') {
        b0 = (w * w) / d;
        b1 = 2 * b0;
        b2 = b0;
      } else {
        b0 = 1 / d;
        b1 = -2 * b0;
        b2 = b0;
      }
      sos.push([b0, b1, b2, 1, (2 * (w * w - 1)) / d, (1 - alpha + w * w) / d]);
    }
    return sos;
  }

  function sosfilt(x, sos) {
    var n = x.length,
      s,
      i,
      out = new Float64Array(n);
    for (i = 0; i < n; i++) out[i] = x[i];
    for (s = 0; s < sos.length; s++) {
      var b0 = sos[s][0],
        b1 = sos[s][1],
        b2 = sos[s][2],
        a1 = sos[s][4],
        a2 = sos[s][5];
      var z1 = 0,
        z2 = 0;
      for (i = 0; i < n; i++) {
        var xi = out[i];
        var y = b0 * xi + z1;
        z1 = b1 * xi - a1 * y + z2;
        z2 = b2 * xi - a2 * y;
        out[i] = y;
      }
    }
    return out;
  }

  function revArr(a) {
    var n = a.length,
      o = new Float64Array(n),
      i;
    for (i = 0; i < n; i++) o[i] = a[n - 1 - i];
    return o;
  }

  // Zero-phase forward–backward filtering with odd reflection padding.
  function sosfiltfilt(x, sos) {
    var n = x.length;
    if (n < 8) return Float64Array.from(x);
    var pad = Math.min(n - 1, 6 * sos.length + 1);
    var ext = new Float64Array(n + 2 * pad),
      i;
    for (i = 0; i < pad; i++) ext[i] = 2 * x[0] - x[pad - i];
    for (i = 0; i < n; i++) ext[pad + i] = x[i];
    for (i = 0; i < pad; i++) ext[pad + n + i] = 2 * x[n - 1] - x[n - 2 - i];
    var y = revArr(sosfilt(revArr(sosfilt(ext, sos)), sos));
    return y.subarray(pad, pad + n);
  }

  // In-place radix-2 complex FFT.
  function fftR2(re, im) {
    var n = re.length,
      i,
      j = 0,
      k,
      t;
    for (i = 0; i < n - 1; i++) {
      if (i < j) {
        t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
      k = n >> 1;
      while (k <= j) {
        j -= k;
        k >>= 1;
      }
      j += k;
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = (-2 * Math.PI) / len,
        wr = Math.cos(ang),
        wi = Math.sin(ang);
      var half = len >> 1;
      for (i = 0; i < n; i += len) {
        var cr = 1,
          ci = 0;
        for (k = 0; k < half; k++) {
          var ar = re[i + k],
            ai = im[i + k];
          var br = re[i + k + half] * cr - im[i + k + half] * ci;
          var bi = re[i + k + half] * ci + im[i + k + half] * cr;
          re[i + k] = ar + br;
          im[i + k] = ai + bi;
          re[i + k + half] = ar - br;
          im[i + k + half] = ai - bi;
          var ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }
  }

  // Resample the chest stream onto a uniform RR_FS grid, anti-aliased at the NATIVE rate.
  // The native rate is MEASURED (median inter-sample interval), never assumed: the H10 ACC
  // runs ~25.3–25.4 Hz on 49/50 corpus nights but 202.9 Hz on one, and the Verity ~25.8 Hz.
  function respResample(rows, unit, t0Ms, baseMs) {
    var n = rows.length,
      i;
    var tSec = new Float64Array(n);
    for (i = 0; i < n; i++) {
      var ts = relSecOf(rows[i], t0Ms, baseMs);
      if (ts == null) return null;
      tSec[i] = ts;
    }
    var d = [];
    for (i = 1; i < Math.min(n, 4000); i++) d.push(tSec[i] - tSec[i - 1]);
    var dm = median(d);
    if (!isFinite(dm) || dm <= 0) return null;
    var fsNative = 1 / dm;
    var dur = tSec[n - 1] - tSec[0];
    var nOut = Math.floor(dur * RR_FS) + 1;
    if (nOut < 64) return null;
    var aa = butterSOS(6, 0.8 * (RR_FS / 2), fsNative, 'low');
    var axes = ['x', 'y', 'z'],
      out = [];
    for (var a = 0; a < 3; a++) {
      var raw = new Float64Array(n);
      for (i = 0; i < n; i++) raw[i] = toG(rows[i][axes[a]], unit);
      var f = sosfiltfilt(raw, aa);
      var col = new Float64Array(nOut),
        p = 0;
      for (var k = 0; k < nOut; k++) {
        var tt = tSec[0] + k / RR_FS;
        while (p < n - 2 && tSec[p + 1] < tt) p++;
        var ta = tSec[p],
          tb = tSec[p + 1],
          u = 0;
        if (tb > ta) u = (tt - ta) / (tb - ta);
        col[k] = f[p] * (1 - u) + f[p + 1] * u;
      }
      out.push(col);
    }
    return { xyz: out, fsNative: fsNative, t0Sec: tSec[0] };
  }

  function respBandpass(x) {
    var lp = sosfiltfilt(x, butterSOS(4, RR_BAND_HI, RR_FS, 'low'));
    return sosfiltfilt(lp, butterSOS(4, RR_BAND_LO, RR_FS, 'high'));
  }

  // Positive-going zero crossings with a refractory period → brpm.
  function respZeroCross(x, i0, nWin) {
    var mu = 0,
      i;
    for (i = 0; i < nWin; i++) mu += x[i0 + i];
    mu /= nWin;
    var refractory = 1 / RR_F_HI,
      last = -1e9,
      count = 0;
    for (i = 1; i < nWin; i++) {
      if (x[i0 + i - 1] - mu <= 0 && x[i0 + i] - mu > 0) {
        var t = i / RR_FS;
        if (t - last >= refractory) {
          count++;
          last = t;
        }
      }
    }
    return count / (nWin / RR_FS / 60);
  }

  function respGrid() {
    var g = [];
    for (var f = RR_F_LO; f <= RR_F_HI + 1e-9; f += RR_F_STEP) g.push(f);
    return g;
  }

  // One window → a normalised in-band likelihood over the rate grid.
  function respWindowSpectrum(chans, i0, nWin, grid, hann) {
    var F = grid.length,
      S = new Float64Array(F),
      c,
      i,
      k;
    var re = new Float64Array(RR_NFFT),
      im = new Float64Array(RR_NFFT);
    var df = RR_FS / RR_NFFT;
    for (c = 0; c < chans.length; c++) {
      var x = chans[c],
        mu = 0;
      for (i = 0; i < nWin; i++) mu += x[i0 + i];
      mu /= nWin;
      var sd = 0;
      for (i = 0; i < nWin; i++) {
        var v = x[i0 + i] - mu;
        sd += v * v;
      }
      if (sd < 1e-24) continue;
      for (i = 0; i < RR_NFFT; i++) {
        re[i] = 0;
        im[i] = 0;
      }
      for (i = 0; i < nWin; i++) re[i] = (x[i0 + i] - mu) * hann[i];
      fftR2(re, im);
      var tmp = new Float64Array(F),
        sum = 0;
      for (k = 0; k < F; k++) {
        var pos = grid[k] / df,
          j = Math.floor(pos),
          u = pos - j;
        if (j < 0 || j + 1 >= RR_NFFT / 2) continue;
        var p0 = re[j] * re[j] + im[j] * im[j];
        var p1 = re[j + 1] * re[j + 1] + im[j + 1] * im[j + 1];
        tmp[k] = p0 * (1 - u) + p1 * u;
        sum += tmp[k];
      }
      if (sum <= 0) continue;
      for (k = 0; k < F; k++) S[k] += tmp[k] / sum;
    }
    // soft spectral high-pass — removes the sub-respiratory 1/f tail that otherwise
    // drags the peak onto the low band edge (the predecessor's dominant failure)
    var tot = 0;
    for (k = 0; k < F; k++) {
      S[k] *= 1 / (1 + Math.exp(-(grid[k] - RR_TAPER_F) / RR_TAPER_W));
      tot += S[k];
    }
    if (tot > 0) for (k = 0; k < F; k++) S[k] /= tot;
    // blend the time-domain estimate in as a Gaussian likelihood bump
    var zs = [];
    for (c = 0; c < chans.length; c++) {
      var z = respZeroCross(chans[c], i0, nWin);
      if (z >= 6 && z <= 36) zs.push(z);
    }
    if (zs.length) {
      zs.sort(function (p, q) {
        return p - q;
      });
      var med = zs[zs.length >> 1],
        bsum = 0;
      var bump = new Float64Array(F);
      for (k = 0; k < F; k++) {
        var dd = grid[k] * 60 - med;
        bump[k] = Math.exp(-(dd * dd) / (2 * RR_TD_SIGMA * RR_TD_SIGMA));
        bsum += bump[k];
      }
      if (bsum > 0) {
        tot = 0;
        for (k = 0; k < F; k++) {
          S[k] = (1 - RR_TD_WEIGHT) * S[k] + RR_TD_WEIGHT * (bump[k] / bsum);
          tot += S[k];
        }
        if (tot > 0) for (k = 0; k < F; k++) S[k] /= tot;
      }
    }
    return S;
  }

  // Viterbi ridge track: maximise Σ log S[t,f] − (Δbrpm)²/(2σ²).
  function respViterbi(specs, grid, bias) {
    var W = specs.length,
      F = grid.length,
      t,
      i,
      j;
    var brpm = new Float64Array(F);
    for (i = 0; i < F; i++) brpm[i] = grid[i] * 60;
    var dp = new Float64Array(F),
      ndp = new Float64Array(F),
      bp = [];
    for (i = 0; i < F; i++) dp[i] = Math.log(Math.max(specs[0][i], 1e-6));
    var inv = 1 / (2 * RR_VITERBI_SIGMA * RR_VITERBI_SIGMA);
    for (t = 1; t < W; t++) {
      var row = new Int32Array(F);
      for (i = 0; i < F; i++) {
        var bestV = -Infinity,
          bestJ = 0;
        for (j = 0; j < F; j++) {
          var d = brpm[i] - brpm[j];
          var v = dp[j] - d * d * inv;
          if (v > bestV) {
            bestV = v;
            bestJ = j;
          }
        }
        ndp[i] = Math.log(Math.max(specs[t][i], 1e-6)) + bestV;
        row[i] = bestJ;
      }
      bp.push(row);
      for (i = 0; i < F; i++) dp[i] = ndp[i];
    }
    var path = new Int32Array(W),
      best = 0;
    for (i = 1; i < F; i++) if (dp[i] > dp[best]) best = i;
    path[W - 1] = best;
    for (t = W - 1; t > 0; t--) path[t - 1] = bp[t - 1][path[t]];
    var rr = [],
      conf = [];
    for (t = 0; t < W; t++) {
      var p = path[t],
        s = 0;
      var lo = Math.max(0, p - RR_CONF_HALF_BINS),
        hi = Math.min(F - 1, p + RR_CONF_HALF_BINS);
      for (i = lo; i <= hi; i++) s += specs[t][i];
      rr.push(brpm[p] + bias);
      conf.push(s);
    }
    return { rr: rr, conf: conf };
  }

  /* Per-epoch respiratory rate from the chest ACC.
     → { hasData, epochSec, series:[{tMs,brpm|null,conf}], medianBrpm, coverage, method } */
  function respiratoryRate(chestRows, t0Ms, unit, opts) {
    opts = opts || {};
    var bias = 0;
    if (typeof opts.biasBrpm === 'number' && isFinite(opts.biasBrpm)) bias = opts.biasBrpm;
    var confMin = RR_CONF_MIN;
    if (typeof opts.confMin === 'number' && isFinite(opts.confMin)) confMin = opts.confMin;
    if (!chestRows || chestRows.length < 400) return { hasData: false };
    var baseMs = streamBaseMs(chestRows);
    var rs = respResample(chestRows, unit, t0Ms, baseMs);
    if (!rs) return { hasData: false };
    var chans = [respBandpass(rs.xyz[0]), respBandpass(rs.xyz[1]), respBandpass(rs.xyz[2])];
    var grid = respGrid();
    var nWin = Math.round(RR_WIN_SEC * RR_FS),
      hop = Math.round(RR_HOP_SEC * RR_FS);
    var N = rs.xyz[0].length;
    if (N < nWin) return { hasData: false };
    var hann = new Float64Array(nWin);
    for (var i = 0; i < nWin; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (nWin - 1));
    var specs = [],
      starts = [];
    for (var s = 0; s + nWin <= N; s += hop) {
      specs.push(respWindowSpectrum(chans, s, nWin, grid, hann));
      starts.push(s);
    }
    if (!specs.length) return { hasData: false };
    var v = respViterbi(specs, grid, bias);
    var series = [],
      kept = [];
    for (i = 0; i < v.rr.length; i++) {
      var tEp = null;
      if (t0Ms != null) tEp = t0Ms + Math.round((rs.t0Sec + starts[i] / RR_FS) * 1000);
      var brpm = null;
      if (v.conf[i] >= confMin) {
        brpm = Math.round(v.rr[i] * 10) / 10;
        kept.push(brpm);
      }
      series.push({ tMs: tEp, brpm: brpm, conf: Math.round(v.conf[i] * 1e3) / 1e3 });
    }
    var med = null;
    if (kept.length) med = median(kept);
    return {
      hasData: kept.length > 0,
      epochSec: RR_HOP_SEC,
      series: series,
      medianBrpm: med == null ? null : Math.round(med * 10) / 10,
      coverage: series.length ? kept.length / series.length : 0,
      biasApplied: bias,
      method: 'acc-spectral-viterbi'
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  RESPIRATORY EFFORT — chest-ACC thoraco-abdominal effort (Ryser et al. 2022 [R22])
  //  band-limit ~0.1–0.6 Hz (remove <0.1 Hz gravity/drift via a 10 s MA, remove
  //  >0.6 Hz cardiac/motion via a ~1.5 s MA), count breaths on the residual.
  // ════════════════════════════════════════════════════════════════════════
  // effort-series contract (predesigned for the Integrator apnea-typing fusion, §1.1):
  var EFFORT_CAD_SEC = 10; // epoch cadence (s) — fine enough to resolve a single ~10–30 s desat window
  var EFFORT_FLOOR_G = 0.004; // RMS threshold (g) for effort PRESENT vs flat — experimental, uncalibrated (Ryser'22 scale)
  function respiratoryEffort(chestRows, t0Ms, durSec, unit) {
    if (!chestRows || chestRows.length < 30) return { hasData: false };
    var baseMs = streamBaseMs(chestRows); // §7.2 anchor — chest may start after t0Ms
    // DEEP-AUDIT-II §7.3 — the passed `durSec` is the MAX over all streams (compute():501). Using it to
    // divide a CHEST-only quantity (breaths, sample rate) HALVES the value whenever a wrist file runs
    // longer than the chest strap. Both the respiratory rate and the hz fallback must divide by the
    // chest stream's OWN span — durationOf against the chest's own base cancels the (base − t0Ms) offset,
    // leaving the chest recording's true duration independent of the wrist.
    var chestDurSec = durationOf(chestRows, baseMs);
    var hz = sampleHz(chestRows, t0Ms);
    if (!isFinite(hz) || hz <= 0) hz = chestRows.length / Math.max(1, chestDurSec);
    // use the axis with the largest respiratory-band variance (AP motion dominates effort)
    var axes = ['x', 'y', 'z'];
    var best = null;
    for (var a = 0; a < 3; a++) {
      var raw = new Float32Array(chestRows.length);
      for (var i = 0; i < chestRows.length; i++) raw[i] = toG(chestRows[i][axes[a]], unit);
      var lo = movavg(raw, Math.max(3, Math.round(hz * 10))); // drift/gravity
      var band = new Float32Array(raw.length);
      for (i = 0; i < raw.length; i++) band[i] = raw[i] - lo[i];
      var sm = movavg(band, Math.max(3, Math.round(hz * 1.5))); // de-noise cardiac
      var v = 0,
        mu = mean(sm);
      for (i = 0; i < sm.length; i++) v += (sm[i] - mu) * (sm[i] - mu);
      if (!best || v > best.var) best = { var: v, sig: sm };
    }
    // count zero-up-crossings → breaths
    var sig = best.sig,
      breaths = 0,
      lastUp = -1e9,
      minSepSec = 1.2; // <50 brpm ceiling
    for (i = 1; i < sig.length; i++) {
      if (sig[i - 1] <= 0 && sig[i] > 0) {
        var s2 = i / hz;
        if (s2 - lastUp >= minSepSec) {
          breaths++;
          lastUp = s2;
        }
      }
    }
    var minutes = chestDurSec / 60; // §7.3 — chest's own span, not the longest stream's
    var rate = minutes > 0 ? breaths / minutes : NaN;
    // amplitude proxy: RMS of the effort signal
    var rms = Math.sqrt(best.var / Math.max(1, sig.length));

    // ── effort SERIES — a per-epoch presence track. Standalone: MotionDex's own effort-trend read.
    //    PREDESIGNED for the Integrator apnea-typing fusion (§1.1): the cadence resolves a single
    //    ~10–30 s desat window, so a consumer can ask "effort present in [desat−15 s, end]?".
    //    `present:null` where the epoch has no chest samples — coverage-honest (absent ≠ not-recorded).
    // DEEP-AUDIT-II §7.1 — window each epoch by WALL-CLOCK TIME, not sample index. `sig` is 1:1 with
    // chestRows, so slicing it by `e·CAD·hz` assumes a gapless, exactly-uniform rate; on any gap or
    // off-nominal rate the sample-index window drifts away from the epoch's own `tEp` stamp, so the
    // effort-present flag the Integrator reads for apnea typing lands on the WRONG samples (typing comes
    // out INVERTED). Bucket each sample by its t0Ms-relative time instead — identical to the index window
    // on clean uniform data, correct across gaps. A moving pointer keeps it O(n) (tSec is non-decreasing).
    var tSec = new Float64Array(sig.length);
    for (i = 0; i < chestRows.length; i++) {
      var ts0 = relSecOf(chestRows[i], t0Ms, baseMs);
      tSec[i] = ts0 == null ? i / hz : ts0; // index-time fallback only when a sample is unstamped
    }
    var series = [];
    var nE = Math.max(1, Math.ceil(durSec / EFFORT_CAD_SEC));
    var kp = 0;
    for (var e = 0; e < nE; e++) {
      var w0 = e * EFFORT_CAD_SEC,
        w1 = (e + 1) * EFFORT_CAD_SEC;
      var tEp = t0Ms != null ? t0Ms + Math.round(e * EFFORT_CAD_SEC * 1000) : null;
      while (kp < sig.length && tSec[kp] < w0) kp++;
      var ss = 0,
        cnt = 0;
      for (var k = kp; k < sig.length && tSec[k] < w1; k++) {
        ss += sig[k] * sig[k];
        cnt++;
      }
      if (cnt < 3) {
        series.push({ tMs: tEp, amp: null, present: null });
        continue;
      }
      var eamp = Math.sqrt(ss / cnt);
      series.push({ tMs: tEp, amp: Math.round(eamp * 1e4) / 1e4, present: eamp >= EFFORT_FLOOR_G });
    }

    // ── RATE now comes from the spectral ridge tracker, not from zero crossings.
    // Same field, better number: on 26 corpus nights the zero-crossing rate scored
    // MAE 3.59 brpm against CPAP-flow truth (worse than a constant 1.50); the
    // spectral estimate scores 1.01. The zero-crossing count is RETAINED as
    // `nBreaths` for back-compat and as the effort-waveform sanity check, but it is
    // no longer the reported rate. Falls back to the legacy rate if the spectral
    // path cannot run (too few samples, unstamped rows).
    var spec = respiratoryRate(chestRows, t0Ms, unit);
    var legacyRate = null;
    if (isFinite(rate)) legacyRate = Math.round(rate * 10) / 10;
    var outRate = legacyRate;
    var method = 'acc-zero-crossing';
    if (spec.hasData && spec.medianBrpm != null) {
      outRate = spec.medianBrpm;
      method = spec.method;
    }

    return {
      hasData: (spec.hasData && outRate != null) || (breaths >= 3 && isFinite(rate)),
      hz: hz,
      rateBrpm: outRate,
      nBreaths: breaths,
      amplitudeG: Math.round(rms * 1e4) / 1e4,
      series: series,
      cadenceSec: EFFORT_CAD_SEC,
      floorG: EFFORT_FLOOR_G,
      // ── added 2026-07-21 (additive; every field above is unchanged) ──
      rateSeries: spec.hasData ? spec.series : [],
      rateEpochSec: RR_HOP_SEC,
      rateCoverage: spec.hasData ? Math.round(spec.coverage * 1e3) / 1e3 : 0,
      respRateMethod: method,
      rateBrpmLegacy: legacyRate
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  SQI — motion signal quality → Ganglior `conf`
  // ════════════════════════════════════════════════════════════════════════
  function motionSQI(accRows, unit) {
    if (!accRows || accRows.length < 10) return { conf: 0, flags: ['no-data'] };
    var flags = [],
      n = accRows.length,
      clip = 0,
      flat = 0,
      last = null,
      staticN = 0;
    for (var i = 0; i < n; i++) {
      var gx = toG(accRows[i].x, unit),
        gy = toG(accRows[i].y, unit),
        gz = toG(accRows[i].z, unit);
      var m = Math.sqrt(gx * gx + gy * gy + gz * gz);
      if (m > 7.5) clip++; // >7.5 g → clip / impact-range (ACC full-scale abuse)
      if (last != null && Math.abs(m - last) < 1e-4) flat++;
      if (m < 0.05) staticN++; // near-zero → sensor off / detached
      last = m;
    }
    var clipFrac = clip / n,
      flatFrac = flat / n,
      offFrac = staticN / n;
    if (clipFrac > 0.02) flags.push('clip');
    if (flatFrac > 0.5) flags.push('flatline');
    if (offFrac > 0.2) flags.push('sensor-off');
    var conf = clamp(1 - clipFrac * 5 - flatFrac - offFrac * 2, 0, 1);
    return { conf: Math.round(conf * 100) / 100, flags: flags, clipFrac: clipFrac, flatFrac: flatFrac, offFrac: offFrac };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  COMPUTE — orchestrate the single-signal motion metrics
  //  input: { acc, gyro, mag, chestAcc }  (each = raw file text OR pre-parsed rows)
  //  acc/gyro/mag = the wrist/arm Verity streams; chestAcc = the H10 effort channel.
  // ════════════════════════════════════════════════════════════════════════
  function asRows(v) {
    if (!v) return null;
    if (typeof v === 'string') return parseSensorXYZ(v);
    if (Array.isArray(v)) return v;
    return null;
  }
  function durationOf(rows, t0Ms) {
    if (!rows || rows.length < 2) return 0;
    var last = relSecOf(rows[rows.length - 1], t0Ms, streamBaseMs(rows));
    return last != null && last > 0 ? last : rows.length / 26;
  }
  function firstTMs(rowsList) {
    for (var i = 0; i < rowsList.length; i++) {
      var r = rowsList[i];
      if (r && r.length) {
        for (var j = 0; j < r.length; j++) if (r[j].tMs != null) return r[j].tMs;
      }
    }
    return null;
  }

  function compute(input) {
    input = input || {};
    var acc = asRows(input.acc),
      gyro = asRows(input.gyro),
      mag = asRows(input.mag),
      chest = asRows(input.chestAcc);
    var accUnit = (acc && acc._unit) || 'mg',
      chestUnit = (chest && chest._unit) || 'mg';
    var t0Ms = firstTMs([acc, chest, gyro, mag]);
    // POSITION prefers the chest sensor (torso frame), falling back to the wrist ACC; ACTIGRAPHY prefers
    // the WRIST ACC (de-gravitated activity is a wrist signal), falling back to the position source.
    var posSrc = chest && chest.length > 10 ? chest : acc;
    var posUnit = posSrc === chest ? chestUnit : accUnit;
    var actiSrc = acc && acc.length > 10 ? acc : posSrc;
    var actiUnit = actiSrc === acc ? accUnit : posUnit;
    var durSec = Math.max(durationOf(acc, t0Ms), durationOf(chest, t0Ms), durationOf(gyro, t0Ms));

    var position = bodyPosition(posSrc, t0Ms, durSec, posUnit);
    var activity = actigraphy(actiSrc, t0Ms, durSec, actiUnit);
    var effort = respiratoryEffort(chest, t0Ms, durSec, chestUnit);
    // DEEP-AUDIT-II §7.5 — PER-STREAM SQI. `sqi` qualifies the posture/chest source (and the posture_change
    // event conf). A single SQI on the chest would leave the WRIST-derived movement metrics (immobileFrac,
    // movementIndex, activitySeries) qualified by a DIFFERENT sensor: a flatlined wrist under a clean chest
    // would read high confidence while the actigraphy is garbage. So the actigraphy stream carries its OWN
    // SQI. Reuse `sqi` when actigraphy ran on the SAME source (single-stream night) — identical by
    // construction, not by luck.
    var sqi = motionSQI(posSrc, posUnit);
    var sqiActivity = actiSrc === posSrc ? sqi : motionSQI(actiSrc, actiUnit);

    var summary = {
      node: 'MotionDex',
      t0Ms: t0Ms,
      durSec: Math.round(durSec),
      streams: {
        acc: acc ? acc.length : 0,
        gyro: gyro ? gyro.length : 0,
        mag: mag ? mag.length : 0,
        chestAcc: chest ? chest.length : 0
      },
      position: position,
      activity: activity,
      effort: effort,
      sqi: sqi,
      sqiActivity: sqiActivity
    };
    return summary;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  SYNTHETIC IMU — deterministic (seeded) generator for the committed fixture
  //  + the equiv gate. No Date.now / Math.random (reproducible bytes).
  // ════════════════════════════════════════════════════════════════════════
  function mulberry32(seed) {
    var s = seed >>> 0;
    return function () {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Emit a Polar-Sensor-Logger-format ACC stream: supine, quiet breathing, seeded jitter.
  function genSyntheticACC(opts) {
    opts = opts || {};
    var hz = opts.hz || 26,
      sec = opts.sec || 120,
      brpm = opts.brpm || 15,
      seed = opts.seed || 1;
    var rnd = mulberry32(seed);
    var startMs = Date.UTC(2026, 5, 10, 22, 0, 0); // fixed civil anchor (Clock Contract floating tMs)
    var nsBase = 599628000000000000;
    var lines = ['Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]'];
    var n = Math.round(hz * sec),
      dtMs = 1000 / hz,
      dtNs = Math.round(1e9 / hz);
    // supine torso: gravity mostly on +Z; small AP respiratory sway on Z.
    // +Z (not −Z): at rest an accelerometer reads +1 g on the UP axis, so a
    // chest sensor worn anterior-face-out reads +1 g on Z when supine. This twin
    // emitted −1 g under a "supine" comment until 2026-07-20, which is why it
    // agreed with the inverted classifier instead of catching it.
    /* ADVERSARIAL OPTIONS (default off — every existing caller is unaffected).
       `flipAtSec`  — posture change: supine (gravity on +Z, respiratory sway on Z) becomes
                      left-lateral (gravity on +Y, sway on Y). This is the case the REAL corpus
                      cannot exercise: its gravity-roll IQR is 13.1–17.9°, i.e. one posture, so
                      posture robustness is otherwise UNTESTABLE. A fixed-axis or whole-night
                      max-variance estimator loses the breath after the flip; summing the three
                      band-passed axes survives it. That difference is the point of the twin.
       `pauseAtSec` / `pauseDurSec` — breathing stops (an apnea). The rate estimate over that
                      stretch is meaningless by construction, so the estimator must LOSE
                      CONFIDENCE rather than emit a confident wrong number. */
    var flipAt = opts.flipAtSec == null ? null : opts.flipAtSec;
    var pauseAt = opts.pauseAtSec == null ? null : opts.pauseAtSec;
    var pauseDur = opts.pauseDurSec == null ? 30 : opts.pauseDurSec;
    for (var i = 0; i < n; i++) {
      var tSec = i / hz;
      var resp = Math.sin(2 * Math.PI * (brpm / 60) * tSec); // breathing
      if (pauseAt != null && tSec >= pauseAt && tSec < pauseAt + pauseDur) resp = 0; // apnea
      var gx = 30 + (rnd() - 0.5) * 12;
      var gy = 40 + (rnd() - 0.5) * 12;
      var gz = 1000 + (rnd() - 0.5) * 10;
      var lateral = flipAt != null && tSec >= flipAt;
      if (lateral) {
        // gravity has rotated onto +Y; the respiratory sway rotates with it
        gy = 1000 + resp * 22 + (rnd() - 0.5) * 10;
        gz = 40 + (rnd() - 0.5) * 12;
      } else {
        gz += resp * 22; // ~+1 g + effort on the supine AP axis
      }
      var ms = startMs + i * dtMs;
      lines.push(isoStamp(ms) + ';' + (nsBase + i * dtNs) + ';' + Math.round(gx) + ';' + Math.round(gy) + ';' + Math.round(gz));
    }
    return lines.join('\n') + '\n';
  }
  // ISO-8601 no-zone stamp with ms, read via getUTC* (Clock Contract §5)
  function isoStamp(ms) {
    var d = new Date(ms);
    return (
      d.getUTCFullYear() +
      '-' +
      p2(d.getUTCMonth() + 1) +
      '-' +
      p2(d.getUTCDate()) +
      'T' +
      p2(d.getUTCHours()) +
      ':' +
      p2(d.getUTCMinutes()) +
      ':' +
      p2(d.getUTCSeconds()) +
      '.' +
      p2(d.getUTCMilliseconds(), 3)
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  //  EXPORT — ganglior.node-export (node:"MotionDex")
  // ════════════════════════════════════════════════════════════════════════
  function buildNodeExport(summary) {
    summary = summary || {};
    var t0 = summary.t0Ms;
    var events = [];
    // position-transition events (impulse per posture change) — the fusion currency
    var track = summary.position && summary.position.track;
    if (track && track.length) {
      var prev = null;
      for (var i = 0; i < track.length; i++) {
        var seg = track[i];
        if (seg.pos !== prev && seg.pos !== 'unknown') {
          events.push({
            t: seg.tStartMs != null ? fmtClock(seg.tStartMs) : null,
            tMs: seg.tStartMs,
            impulse: 'posture_change',
            node: 'MotionDex',
            conf: summary.sqi ? summary.sqi.conf : null,
            meta: { position: seg.pos }
          });
          prev = seg.pos;
        }
      }
    }
    return {
      schema: { name: 'ganglior.node-export', version: 1, node: 'MotionDex' },
      recording: { startEpochMs: t0, durSec: summary.durSec },
      motion: {
        streams: summary.streams,
        supineFrac: summary.position ? summary.position.supineFrac : null,
        dwellFrac: summary.position ? summary.position.dwellFrac : null,
        immobileFrac: summary.activity ? summary.activity.immobileFrac : null,
        movementIndex: summary.activity ? summary.activity.movementIndex : null,
        // per-epoch movement track — a MotionDex standalone read (movement timeline) AND the input the
        // Integrator gates HRV with (§2.4). `moving` is TRI-STATE: null = accelerometer not recording,
        // which must never be read as "still" (that is how a gap fabricates a quiet night).
        activitySeries:
          summary.activity && summary.activity.epochs
            ? summary.activity.epochs.map(function (e) {
                return { tMs: e.tStartMs, count: e.count, moving: e.moving };
              })
            : null,
        activityCadenceSec: summary.activity ? summary.activity.epochSec : null,
        respRateBrpm: summary.effort ? summary.effort.rateBrpm : null,
        // effort-presence series — a MotionDex standalone read AND the Integrator apnea-typing input (§1.1).
        // Coverage-honest: an epoch's `present` is null where chest ACC was not recording, never a false absent.
        effortSeries: summary.effort && summary.effort.series ? summary.effort.series : null,
        effortCadenceSec: summary.effort ? summary.effort.cadenceSec : null,
        effortFloorG: summary.effort ? summary.effort.floorG : null,
        sqi: summary.sqi ? summary.sqi.conf : null,
        // DEEP-AUDIT-II §7.5 — per-stream SQI. `sqi` above qualifies the posture/chest source (and the
        // posture_change event conf); `sqiActivity` qualifies the WRIST stream the actigraphy metrics
        // (immobileFrac / movementIndex / activitySeries) are derived from. Equal to `sqi` on a
        // single-stream night; a consumer trusts the movement metrics against THIS, not the chest SQI.
        sqiActivity: summary.sqiActivity ? summary.sqiActivity.conf : null
      },
      ganglior_events: events
    };
  }

  // ─── public API (dual-mode: window attach for classic co-load + ESM tail) ───
  global.MOTIONDSP = {
    parseSensorXYZ: parseSensorXYZ,
    streamKindFromHeader: streamKindFromHeader,
    streamKindFromName: streamKindFromName,
    bodyPosition: bodyPosition,
    classifyGravity: classifyGravity,
    actigraphy: actigraphy,
    respiratoryEffort: respiratoryEffort,
    respiratoryRate: respiratoryRate,
    motionSQI: motionSQI,
    compute: compute,
    genSyntheticACC: genSyntheticACC,
    buildNodeExport: buildNodeExport,
    parseTimestamp: parseTimestamp
  };
  global.MotionDex = global.MotionDex || {
    compute: compute,
    parseSensorXYZ: parseSensorXYZ,
    genSynthetic: genSyntheticACC,
    buildNodeExport: buildNodeExport,
    _build: buildNodeExport
  };
  global.MotionDex.scrubExport = function (env) {
    if (global.DexExport && typeof global.DexExport.scrubExport === 'function') return global.DexExport.scrubExport(env);
    if (typeof global.dexScrubExport === 'function') return global.dexScrubExport(env);
    return env;
  };
})(window);

// ESM-MIGRATION: MotionDex is ESM-from-birth (fan-out complete). The IIFE above attaches
// window.MOTIONDSP / window.MotionDex (the external node API + every classic co-load consumer —
// the orchestrators + both test runners, which classic-load this file via build-core.js `classicify`).
// These re-exports let the owned ESM bundle's motiondex-app.js `import { MOTIONDSP, MotionDex }`.
export const MOTIONDSP = window.MOTIONDSP;
export const MotionDex = window.MotionDex;
