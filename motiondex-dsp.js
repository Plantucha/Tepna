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
    if (unit && /mg|(^g$)|G/.test(unit) && !/dps|µt|ut/i.test(unit)) return { kind: 'acc', unit: unit };
    if (/dps|deg\/s/.test(h)) return { kind: 'gyro', unit: unit || 'dps' };
    if (/µt|ut/i.test(h) || /magn/.test(h)) return { kind: 'mag', unit: unit || 'µT' };
    if (/\[mg\]/.test(h)) return { kind: 'acc', unit: 'mg' };
    return { kind: 'acc', unit: unit || 'mg' }; // XYZ default
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

  function parseSensorXYZ(text) {
    var lines = String(text || '').split(/\r?\n/);
    var out = [];
    var ns0 = null;
    var headerKind = null;
    for (var li = 0; li < lines.length; li++) {
      var t = lines[li].trim();
      if (!t) continue;
      if (headerKind === null && /timestamp/i.test(t)) {
        headerKind = streamKindFromHeader(t);
        continue;
      }
      var p = t.split(';');
      if (p.length < 5) continue;
      var x = parseFloat(p[2]);
      if (!isFinite(x)) continue; // skips a stray header row too
      var relNs = NaN;
      try {
        var b = BigInt(p[1].trim());
        if (ns0 === null) ns0 = b;
        relNs = Number(b - ns0);
      } catch {}
      var ts = parseTimestamp(p[0]);
      out.push({ relNs: relNs, tMs: ts ? ts.tMs : null, x: x, y: parseFloat(p[3]), z: parseFloat(p[4]) });
    }
    out._kind = headerKind ? headerKind.kind : null;
    out._unit = headerKind ? headerKind.unit : null;
    return out;
  }

  // seconds-from-start of a row (prefer the precise device counter, fall back to wall-clock)
  function relSecOf(r, t0Ms) {
    if (isFinite(r.relNs)) return r.relNs / 1e9;
    if (r.tMs != null && t0Ms != null) return (r.tMs - t0Ms) / 1000;
    return null;
  }
  // convert an ACC row's XYZ to g (gravity units) given its unit
  function toG(v, unit) {
    return unit === 'mg' ? v / 1000 : v; // 'g'/'G' already in g
  }
  function sampleHz(rows, t0Ms) {
    if (rows.length < 3) return NaN;
    var a = relSecOf(rows[0], t0Ms),
      b = relSecOf(rows[rows.length - 1], t0Ms);
    if (a == null || b == null || b <= a) return NaN;
    return (rows.length - 1) / (b - a);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  BODY POSITION — gravity-vector decomposition (Rocha et al. 2026 [Ro26])
  //  Device-frame convention (documented, uncalibrated → the LABEL is
  //  experimental-tier; the gravity ANGLES are measured). For a torso/chest
  //  sensor: Y ≈ superior-inferior, Z ≈ antero-posterior, X ≈ medio-lateral.
  //    upright  |gy| dominant           supine   gz < 0     prone   gz > 0
  //    lateral  |gx| dominant (sign → L/R)
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
    return gz < 0 ? 'supine' : 'prone';
  }
  function bodyPosition(accRows, t0Ms, durSec, unit) {
    if (!accRows || accRows.length < 10) return { hasData: false };
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
      var s = relSecOf(accRows[i], t0Ms);
      if (s == null || s < 0) continue;
      var idx = Math.min(nE - 1, Math.floor(s / epoch));
      bx[idx].push(toG(accRows[i].x, unit));
      by[idx].push(toG(accRows[i].y, unit));
      bz[idx].push(toG(accRows[i].z, unit));
    }
    var track = [],
      dwell = { supine: 0, prone: 0, left: 0, right: 0, upright: 0, unknown: 0 };
    for (e = 0; e < nE; e++) {
      if (!bx[e].length) {
        dwell.unknown++;
        track.push({ tStartMs: t0Ms != null ? t0Ms + e * epoch * 1000 : null, pos: 'unknown' });
        continue;
      }
      var pos = classifyGravity(median(bx[e]), median(by[e]), median(bz[e]));
      dwell[pos]++;
      track.push({ tStartMs: t0Ms != null ? t0Ms + e * epoch * 1000 : null, pos: pos });
    }
    var frac = {};
    for (var k = 0; k < POSITIONS.length; k++) frac[POSITIONS[k]] = nE ? dwell[POSITIONS[k]] / nE : 0;
    var supineFrac = frac.supine;
    return { hasData: true, epochSec: epoch, track: track, dwellEpochs: dwell, dwellFrac: frac, supineFrac: supineFrac };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ACTIGRAPHY — de-gravitated activity counts + movement / immobility epochs
  // ════════════════════════════════════════════════════════════════════════
  function actigraphy(accRows, t0Ms, durSec, unit) {
    if (!accRows || accRows.length < 10) return { hasData: false };
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
      var s = relSecOf(accRows[i], t0Ms);
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
    var hz = sampleHz(chestRows, t0Ms);
    if (!isFinite(hz) || hz <= 0) hz = chestRows.length / Math.max(1, durSec);
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
    var minutes = durSec / 60;
    var rate = minutes > 0 ? breaths / minutes : NaN;
    // amplitude proxy: RMS of the effort signal
    var rms = Math.sqrt(best.var / Math.max(1, sig.length));

    // ── effort SERIES — a per-epoch presence track. Standalone: MotionDex's own effort-trend read.
    //    PREDESIGNED for the Integrator apnea-typing fusion (§1.1): the cadence resolves a single
    //    ~10–30 s desat window, so a consumer can ask "effort present in [desat−15 s, end]?".
    //    `present:null` where the epoch has no chest samples — coverage-honest (absent ≠ not-recorded).
    var series = [];
    var nE = Math.max(1, Math.ceil(durSec / EFFORT_CAD_SEC));
    for (var e = 0; e < nE; e++) {
      var lo2 = Math.floor(e * EFFORT_CAD_SEC * hz),
        hi2 = Math.min(sig.length, Math.floor((e + 1) * EFFORT_CAD_SEC * hz));
      var tEp = t0Ms != null ? t0Ms + Math.round(e * EFFORT_CAD_SEC * 1000) : null;
      if (hi2 - lo2 < 3) {
        series.push({ tMs: tEp, amp: null, present: null });
        continue;
      }
      var ss = 0;
      for (var k = lo2; k < hi2; k++) ss += sig[k] * sig[k];
      var eamp = Math.sqrt(ss / (hi2 - lo2));
      series.push({ tMs: tEp, amp: Math.round(eamp * 1e4) / 1e4, present: eamp >= EFFORT_FLOOR_G });
    }

    return {
      hasData: breaths >= 3 && isFinite(rate),
      hz: hz,
      rateBrpm: isFinite(rate) ? Math.round(rate * 10) / 10 : null,
      nBreaths: breaths,
      amplitudeG: Math.round(rms * 1e4) / 1e4,
      series: series,
      cadenceSec: EFFORT_CAD_SEC,
      floorG: EFFORT_FLOOR_G
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
    var last = relSecOf(rows[rows.length - 1], t0Ms);
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
    // position + actigraphy prefer the chest sensor (torso frame); fall back to wrist ACC
    var posSrc = chest && chest.length > 10 ? chest : acc;
    var posUnit = posSrc === chest ? chestUnit : accUnit;
    var durSec = Math.max(durationOf(acc, t0Ms), durationOf(chest, t0Ms), durationOf(gyro, t0Ms));

    var position = bodyPosition(posSrc, t0Ms, durSec, posUnit);
    var activity = actigraphy(acc && acc.length > 10 ? acc : posSrc, t0Ms, durSec, acc && acc.length > 10 ? accUnit : posUnit);
    var effort = respiratoryEffort(chest, t0Ms, durSec, chestUnit);
    var sqi = motionSQI(posSrc, posUnit);

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
      sqi: sqi
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
    // supine torso: gravity mostly on -Z; small AP respiratory sway on Z
    for (var i = 0; i < n; i++) {
      var tSec = i / hz;
      var resp = Math.sin(2 * Math.PI * (brpm / 60) * tSec); // breathing
      var gx = 30 + (rnd() - 0.5) * 12;
      var gy = 40 + (rnd() - 0.5) * 12;
      var gz = -1000 + resp * 22 + (rnd() - 0.5) * 10; // ~-1 g + effort
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
        sqi: summary.sqi ? summary.sqi.conf : null
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
