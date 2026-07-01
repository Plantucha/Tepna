/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   CPAPDex · DSP / METRICS  (cpapdex-dsp.js)   — SCAFFOLD / STARTING POINT
   ────────────────────────────────────────────────────────────────────────
   Consumes decoded EDF records from cpapdex-edf.js and produces per-session +
   per-night therapy metrics. Ports the compute specs from
   codegen/manifests/cpapdex.manifest.json onto FLOATING-tMs time (CLAUDE.md
   THE CLOCK CONTRACT) — NOT the Unix-seconds the codegen assumed.

   What this scaffold does:
     • prepare(raw)        — maskOn = pressure>0, precompute filtered arrays
     • computeMetrics(s)   — the 14 manifest metrics, real math (no stubs except
                             compliancePct which is longitudinal by definition)
     • buildSession(files) — merge one timestamp-prefix file-set → one session
     • buildNight(sessions)— sort by t0Ms, off-mask gaps, night anchor (§2:
                             ONE night, N sessions, gaps — not N nights)
     • fmt* display helpers — getUTC* only (viewer-timezone-independent)
     • parseTimestamp      — LOCAL mirror (Clock Contract): filename prefix /
                             14-digit fallback; EDF header clock comes from
                             cpapdex-edf.parseEdfClock. Do NOT extract a shared util.

   What it deliberately leaves to the next coder (see CPAPDEX-BUILD-BRIEF.md):
     • flow-derived breath detection (§3), CSL periodic-breathing %, EPR delta,
       CPAP/APAP mode detection, ventilation stability
     • the SA2 oximeter self-gate (§4.4) — gate desats before ODI
     • cpapdex-fusion.js events/export, cpapdex-registry.js + render cohesion
   Load AFTER cpapdex-edf.js.   Self-test:  node cpapdex-dsp.js --selftest
   Exposes: window.CpapDsp
   ════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var EDF = (typeof require !== 'undefined') ? require('./cpapdex-edf.js') : (root && root.CpapEdf);

/* ── DISPLAY — always getUTC* (tMs is floating)  (Clock Contract §5) ───────── */
function _p2(n) { return (n < 10 ? '0' : '') + n; }
function fmtClock(ms)    { var d = new Date(ms); return _p2(d.getUTCHours()) + ':' + _p2(d.getUTCMinutes()); }
function fmtDate(ms)     { var d = new Date(ms); return d.getUTCFullYear() + '-' + _p2(d.getUTCMonth() + 1) + '-' + _p2(d.getUTCDate()); }
function fmtDateTime(ms) { return fmtDate(ms) + ' ' + fmtClock(ms); }

/* ── LOCAL parseTimestamp (Clock Contract §2/§3) — mirror, do not share ─────
   CPAPDex's primary clock is the EDF header (cpapdex-edf.parseEdfClock). This
   local mirror covers the filename anchors only: file-set prefix
   "YYYYMMDD_HHMMSS_" and the 14-digit "YYYYMMDDHHMMSS". Returns
   { tMs, offsetMin } | null. NEVER new Date()/now() on a miss. ──────────────── */
function parseTimestamp(raw) {
  var s = String(raw == null ? '' : raw).trim();
  // ISO / "YYYY-MM-DD[ T]HH:MM[:SS[.mmm]]" — capture fractional seconds (Clock Contract §2 step 3).
  // No zone ⇒ components verbatim → Date.UTC (floating), offsetMin null.
  var iso = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?/.exec(s);
  if (iso) {
    var Y = +iso[1], Mo = +iso[2], D = +iso[3], H = +iso[4], Mi = +iso[5],
        S = +(iso[6] || 0), Ms = iso[7] ? +((iso[7] + '00').slice(0, 3)) : 0;
    if (Mo >= 1 && Mo <= 12 && D >= 1 && D <= 31 && H <= 23 && Mi <= 59 && S <= 59) {
      return { tMs: Date.UTC(Y, Mo - 1, D, H, Mi, S, Ms), offsetMin: null };
    }
  }
  var m = /(\d{4})(\d{2})(\d{2})[_\-]?(\d{2})(\d{2})(\d{2})/.exec(s);   // YYYYMMDD(_)HHMMSS
  if (m) {
    var y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], se = +m[6];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h <= 23 && mi <= 59 && se <= 59) {
      return { tMs: Date.UTC(y, mo - 1, d, h, mi, se), offsetMin: null };   // floating, EDF has no zone
    }
  }
  return null;
}

/* ════════════════════════════════════════════════════════════════════════
   STATS KERNEL (ported from dex-analysis-gen.js, pure)
   ════════════════════════════════════════════════════════════════════════ */
function _finite(a) { var o = []; for (var i = 0; i < a.length; i++) { var v = a[i]; if (v != null && isFinite(v)) o.push(v); } return o; }
function _mean(a) { var f = _finite(a); if (!f.length) return NaN; var s = 0; for (var i = 0; i < f.length; i++) s += f[i]; return s / f.length; }
function _sd(a)   { var f = _finite(a); if (f.length < 2) return NaN; var m = _mean(f), s = 0; for (var i = 0; i < f.length; i++) s += (f[i] - m) * (f[i] - m); return Math.sqrt(s / (f.length - 1)); }
function _cov(a)  { var m = _mean(a); return (m === 0 || isNaN(m)) ? NaN : _sd(a) / Math.abs(m) * 100; }
function _p(a, q) { var f = _finite(a).sort(function (x, y) { return x - y; }); if (!f.length) return NaN; var idx = (q / 100) * (f.length - 1); var lo = Math.floor(idx), hi = Math.ceil(idx); if (lo === hi) return f[lo]; return f[lo] + (f[hi] - f[lo]) * (idx - lo); }
function _iqr(a)  { return _p(a, 75) - _p(a, 25); }
function _countWhere(a, pred) { var c = 0; for (var i = 0; i < a.length; i++) if (pred(a[i])) c++; return c; }
function _filterBy(a, mask) { var o = []; for (var i = 0; i < a.length; i++) if (mask[i]) o.push(a[i]); return o; }
/* Leak CV is only meaningful when there IS appreciable leak. A well-sealed mask
   sits at ~0 L/min unintentional leak, where SD/mean blows up (÷ near-zero) into
   a nonsense % — so below LEAK_CV_FLOOR (mean L/min) we report null, not 6000%.
   (Generic _cov is left untouched — minVentStability et al. have healthy means.) */
var LEAK_CV_FLOOR = 2;
function _leakCV(a) { var m = _mean(a); if (isNaN(m) || m < LEAK_CV_FLOOR) return null; var c = _cov(a); return isNaN(c) ? null : +c.toFixed(1); }

/* ════════════════════════════════════════════════════════════════════════
   prepare(raw) — raw = { t0Ms, fs, pressure:Float32Array, leak:Float32Array,
                          events:[{type,timeSec,durSec}], mode? }
   Builds maskOn (pressure>0) + filtered arrays. Mirrors the codegen prepare,
   but on floating tMs and tolerant of missing leak.
   ════════════════════════════════════════════════════════════════════════ */
function prepare(raw) {
  var n = raw.pressure ? raw.pressure.length : 0;
  var maskOn = new Uint8Array(n);
  for (var i = 0; i < n; i++) maskOn[i] = raw.pressure[i] > 0 ? 1 : 0;
  var leak = raw.leak || new Float32Array(n);
  return {
    t0Ms: raw.t0Ms, fs: raw.fs || 1, mode: raw.mode || null,
    pressure: raw.pressure || new Float32Array(0), leak: leak,
    events: raw.events || [],
    maskOn: maskOn,
    pressureMaskOn: _filterBy(raw.pressure || [], maskOn),
    leakMaskOn: _filterBy(leak, maskOn),
    usageHours: _countWhere(raw.pressure || [], function (v) { return v > 0; }) / ((raw.fs || 1) * 3600)
  };
}

/* event rate over a denominator (events/hr) */
function _eventRate(events, types, denomHours) {
  if (!(denomHours > 0)) return NaN;
  var set = {}; types.forEach(function (t) { set[t] = 1; });
  var c = 0; for (var i = 0; i < events.length; i++) if (set[events[i].type]) c++;
  return c / denomHours;
}

/* ════════════════════════════════════════════════════════════════════════
   computeMetrics(session) → { id: value } for the 14 manifest metrics.
   Source of truth for labels/ranges/tiers/evidence = the manifest + (to build)
   cpapdex-registry.js. This returns raw numbers only.
   ════════════════════════════════════════════════════════════════════════ */
function computeMetrics(d) {
  var uh = d.usageHours, fs = d.fs;
  return {
    // ── Usage & Adherence ──
    usageHours:       uh,
    compliancePct:    null,  // longitudinal (≥4h nights / 30d) — needs night history; computed in buildLongitudinal()
    maskOnLatency:    (function () { var idx = -1; for (var i = 0; i < d.pressure.length; i++) if (d.pressure[i] > 0) { idx = i; break; } return idx === -1 ? NaN : idx / (fs * 60); })(),
    // ── Pressure Profile ──
    medianPressure:   _p(d.pressureMaskOn, 50),
    p95Pressure:      _p(d.pressureMaskOn, 95),
    pressureRange:    _iqr(d.pressureMaskOn),
    // ── Residual Events ──
    residualAHI:      _eventRate(d.events, ['OA', 'CA', 'H'], uh),
    centralIndex:     _eventRate(d.events, ['CA'], uh),
    obstructiveIndex: _eventRate(d.events, ['OA'], uh),
    hypopneaIndex:    _eventRate(d.events, ['H'], uh),
    // ── Leak Dynamics ──
    medianLeak:       _p(d.leakMaskOn, 50),
    p95Leak:          _p(d.leakMaskOn, 95),
    largeLeakPct:     d.leakMaskOn.length ? _countWhere(d.leakMaskOn, function (v) { return v > 24; }) / d.leakMaskOn.length * 100 : NaN,
    leakCV:           _leakCV(d.leakMaskOn)   // floor-guarded like the real paths (§ near-zero-leak); raw _cov blows up on a well-sealed mask
  };
}

/* sqi from leak quality (§4.3): high large-leak fraction corrupts AHI → lowers sqi */
function leakSqi(metrics) {
  var ll = metrics.largeLeakPct;
  if (ll == null || isNaN(ll)) return 1;
  return Math.max(0, Math.min(1, 1 - ll / 100));
}

/* ════════════════════════════════════════════════════════════════════════
   SESSION + NIGHT  (Clock Contract §2/§4)
   A "session" is one mask-on file-set (its own t0Ms). A "night" is N sessions
   with off-mask gaps between them — NOT N nights.
   ════════════════════════════════════════════════════════════════════════ */
function buildSession(prepared, meta) {
  meta = meta || {};
  var m = computeMetrics(prepared);
  var durMin = prepared.usageHours * 60;
  return {
    t0Ms: prepared.t0Ms,
    endMs: prepared.t0Ms + durMin * 60000,
    durMin: +durMin.toFixed(1),
    mode: prepared.mode,
    fname: meta.fname || null,
    metrics: m,
    sqi: leakSqi(m),
    nEvents: prepared.events.length
  };
}

function buildNight(sessions) {
  var s = sessions.slice().sort(function (a, b) { return (a.t0Ms || 0) - (b.t0Ms || 0); });
  var gaps = [];
  for (var i = 1; i < s.length; i++) {
    var gapMs = s[i].t0Ms - s[i - 1].endMs;            // off-mask gap (monotonic; no 24h jump)
    gaps.push({ afterIdx: i - 1, afterSession: i - 1, gapMin: +(gapMs / 60000).toFixed(1) });
  }
  // night-level metrics = therapy-hour-weighted recompute over pooled mask-on time
  var totalHours = s.reduce(function (a, x) { return a + x.durMin / 60; }, 0);
  return {
    t0Ms: s.length ? s[0].t0Ms : null,                 // night anchor = first session
    dateAnchorMs: s.length ? Date.UTC(new Date(s[0].t0Ms).getUTCFullYear(), new Date(s[0].t0Ms).getUTCMonth(), new Date(s[0].t0Ms).getUTCDate()) : null,
    offsetMin: null,
    sessions: s,
    offMaskGaps: gaps,
    nSessions: s.length,
    therapyHours: +totalHours.toFixed(2),
    metrics: nightMetrics(s)                            // pooled per-night surface (null for synthetic sessions w/o _pool)
  };
}

/* OLS slope of values vs their index (per-night step). null if <2 finite points. */
function _olsSlope(arr) {
  var pts = []; for (var i = 0; i < arr.length; i++) if (arr[i] != null && isFinite(arr[i])) pts.push([pts.length, arr[i]]);
  var n = pts.length; if (n < 2) return null;
  var sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (var k = 0; k < n; k++) { sx += pts[k][0]; sy += pts[k][1]; sxx += pts[k][0] * pts[k][0]; sxy += pts[k][0] * pts[k][1]; }
  var den = n * sxx - sx * sx; if (Math.abs(den) < 1e-12) return null;
  return +(((n * sxy - sx * sy) / den)).toFixed(3);
}

/* Multi-night longitudinal roll-up (OxyDex-style). Accepts an array of night
   objects (buildNight outputs) OR lightweight {therapyHours} stubs (back-compat).
   Returns:
     • compliancePct   — % of nights with ≥4 h usage (CMS-style adherence)
     • usageTrend7d     — OLS slope of usage hours over the trailing 7 nights (hr/night)
     • ahiTrend30d      — residual-AHI mean ± SD over the trailing 30 nights
     • crossNight       — ganglior.crossnight v1.0 block (CPAPCross, robust trends)
   crossNight math is CPAPCross.crossNightBlock (shared envelope shape + local
   crossNight engine) — null if that module isn't bundled (DSP stays standalone). */
function buildLongitudinal(nights) {
  if (!nights || !nights.length) return { compliancePct: null, nights: 0, usageTrend7d: null, ahiTrend30d: null, crossNight: null };
  var usageH = function (n) { return n.therapyHours != null ? n.therapyHours : (n.metrics ? n.metrics.usageHours : null); };
  var ahiOf  = function (n) { return n.metrics ? n.metrics.residualAHI : (n.residualAHI != null ? n.residualAHI : null); };
  var qualifying = nights.filter(function (n) { var h = usageH(n); return h != null && h >= 4; }).length;
  var compliancePct = +(qualifying / nights.length * 100).toFixed(1);
  // chronological ascending by floating t0Ms (null t0 keeps input order, sorted last)
  var chrono = nights.slice().map(function (n, i) { return { n: n, t0: n.t0Ms, i: i }; })
    .sort(function (a, b) { return (a.t0 == null) - (b.t0 == null) || (a.t0 || 0) - (b.t0 || 0) || a.i - b.i; })
    .map(function (x) { return x.n; });
  var usageTrend7d = _olsSlope(chrono.slice(-7).map(usageH));
  var last30 = chrono.slice(-30).map(ahiOf).filter(function (v) { return v != null && isFinite(v); });
  var ahiTrend30d = last30.length ? { mean: +_mean(last30).toFixed(2), sd: last30.length > 1 ? +_sd(last30).toFixed(2) : 0, n: last30.length } : null;
  var crossNight = (root && root.CPAPCross && root.CPAPCross.crossNightBlock) ? root.CPAPCross.crossNightBlock(chrono) : null;
  return { compliancePct: compliancePct, nights: nights.length, usageTrend7d: usageTrend7d, ahiTrend30d: ahiTrend30d, crossNight: crossNight };
}

/* ════════════════════════════════════════════════════════════════════════
   REAL-SIGNAL ADAPTER  (CPAPDEX-BUILD-BRIEF §1 output → DSP)
   ────────────────────────────────────────────────────────────────────────
   The EDF reader hands us per-file decoded records with VENDOR labels
   ("Press.40ms", "Leak.2s", "Pulse.1s", …) plus a junk "Crc16" checksum lane.
   chan(rec, base) strips the ".<rate><unit>" suffix and returns the channel
   for a canonical base name, ignoring Crc16. leakToLpm honours the header dim
   ("L/s" → ×60 L/min) — AirSense writes leak in L/s but the 24 L/min large-leak
   threshold (§3) is in L/min, so we convert before any leak metric.
   ════════════════════════════════════════════════════════════════════════ */
function chan(rec, base) {
  if (!rec || !rec.signals) return null;
  var keys = Object.keys(rec.signals);
  for (var i = 0; i < keys.length; i++) {
    if (/crc/i.test(keys[i])) continue;
    var b = keys[i].replace(/\.[0-9].*$/, '');            // "Leak.2s"→"Leak", "Press.40ms"→"Press"
    if (b.toLowerCase() === base.toLowerCase()) return rec.signals[keys[i]];
  }
  return null;
}
function leakToLpm(ch) {
  if (!ch || !ch.data) return null;
  var k = /\/\s*s/i.test(ch.dim || '') ? 60 : 1;          // L/s → L/min (dim is authoritative)
  if (k === 1) return ch.data;
  var out = new Float32Array(ch.data.length);
  for (var i = 0; i < ch.data.length; i++) out[i] = ch.data[i] * k;
  return out;
}
function _pearson(a, b) {
  var n = Math.min(a.length, b.length); if (n < 3) return NaN;
  var sa = 0, sb = 0; for (var i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  var ma = sa / n, mb = sb / n, num = 0, da = 0, db = 0;
  for (var j = 0; j < n; j++) { var x = a[j] - ma, y = b[j] - mb; num += x * y; da += x * x; db += y * y; }
  return (da > 0 && db > 0) ? num / Math.sqrt(da * db) : NaN;
}

/* ════════════════════════════════════════════════════════════════════════
   OXIMETER SELF-GATE · Part A  (MIRRORED VERBATIM from oxydex-dsp.js)
   ────────────────────────────────────────────────────────────────────────
   A desat coincident with the oximeter's OWN perfusion/pulse-signal collapse,
   or with non-physiologic fall kinetics, is an optical/mechanical artifact —
   not blood. Decided LOCALLY on one device (no network, no headcount vote).
   Mirror — like parseTimestamp, do NOT extract a shared util; CPAPDex's SA2 is
   as displacement-prone as a finger ring and must stand alone. See
   OXIMETER-SELFGATE-AND-CONSEQUENCE-COROBORATION.md Part A. Artifact desats are
   EXCLUDED from ODI and NOT emitted as ganglior_events.
   ════════════════════════════════════════════════════════════════════════ */
var SELFGATE = {
  WIN_SEC: 10,                 // ± window (s) around the desat onset at 1 Hz
  PULSE_MIN: 30, PULSE_MAX: 220,   // physiologic pulse-rate band (bpm)
  PULSE_VALID_FLOOR: 0.5,      // <50% valid pulse in the window ⇒ perfusion collapse
  FALL_RATE_MAX: 1.5,          // %/s — a real systemic desat falls over tens of s
  EDGE_PULSE_DROP: 40          // bpm step at the SpO2 edge that mirrors it (occlusion)
};
function selfGateDesat(desat, pulseSeries, spo2Series) {
  if (!desat) return desat;
  var onset  = (desat.onset   != null ? desat.onset   : desat.startIdx);
  var nadir  = (desat.nadirIdx != null ? desat.nadirIdx : onset);
  var endIdx = (desat.endIdx  != null ? desat.endIdx  : nadir);
  desat.artifact = false;
  if (onset == null || !pulseSeries || !pulseSeries.length) return desat;
  var W = SELFGATE.WIN_SEC, N = pulseSeries.length;
  var lo = Math.max(0, onset - W), hi = Math.min(N - 1, (endIdx != null ? endIdx : nadir) + W);
  // (1) perfusion: fraction of the window with a present, in-band pulse
  var valid = 0, tot = 0;
  for (var i = lo; i <= hi; i++) {
    tot++;
    var p = pulseSeries[i];
    if (p != null && isFinite(p) && p >= SELFGATE.PULSE_MIN && p <= SELFGATE.PULSE_MAX) valid++;
  }
  var pulseValid = tot > 0 ? valid / tot : 0;
  // (2) kinetics: steepest 1-second SpO2 fall over the leading edge (%/s, 1 Hz)
  var fallRate = 0;
  if (spo2Series && spo2Series.length) {
    var a = Math.max(1, onset - 3), b = Math.min(spo2Series.length - 1, nadir);
    for (var k = a; k <= b; k++) { var d = spo2Series[k - 1] - spo2Series[k]; if (d > fallRate) fallRate = d; }
  } else if (desat.depth != null && desat.duration) {
    fallRate = desat.depth / Math.max(1, desat.duration);
  }
  // (3) edge collapse: pulse craters / goes invalid EXACTLY at the SpO2 edge
  var edgeCollapse = false;
  if (nadir != null && nadir < N) {
    var pBefore = pulseSeries[Math.max(0, onset - 2)];
    var pAt = pulseSeries[Math.min(N - 1, nadir)];
    var beforeOk = pBefore != null && isFinite(pBefore) && pBefore >= SELFGATE.PULSE_MIN && pBefore <= SELFGATE.PULSE_MAX;
    var atBad = pAt == null || !isFinite(pAt) || pAt < SELFGATE.PULSE_MIN || pAt > SELFGATE.PULSE_MAX
              || (beforeOk && (pBefore - pAt) >= SELFGATE.EDGE_PULSE_DROP);
    edgeCollapse = beforeOk && atBad;
  }
  if (fallRate > SELFGATE.FALL_RATE_MAX) {
    desat.artifact = true; desat.reason = 'nonphysiologic-kinetics'; desat.sqi = 0.2;
  } else if (pulseValid < SELFGATE.PULSE_VALID_FLOOR || edgeCollapse) {
    desat.artifact = true; desat.reason = 'perfusion-collapse'; desat.sqi = 0.2;
  }
  desat.fallRate = +fallRate.toFixed(3);
  desat.pulseValid = +pulseValid.toFixed(2);
  return desat;
}

/* ════════════════════════════════════════════════════════════════════════
   SA2 OXIMETRY QC LANE  (§3 oximetry · §4.4 self-gate)
   1 Hz Pulse + SpO2. Device writes -1 (and any out-of-band value) as a "no
   oximeter connected" sentinel → treated as MISSING. If valid coverage is too
   low the lane reports { available:false } and ODI/T90/nadir are null (the real
   AirSense night ships NO oximeter — this must not crash or fabricate). Desats
   are detected with a trailing-baseline ODI-3 detector, then SELF-GATED before
   ODI: artifact desats are excluded and never emitted downstream.
   ════════════════════════════════════════════════════════════════════════ */
var OXI = { SPO2_MIN: 50, SPO2_MAX: 100, DROP: 3, MIN_DUR: 10, BASE_WIN: 180, COVERAGE_FLOOR: 0.5 };
function _spo2Valid(v) { return v != null && isFinite(v) && v >= OXI.SPO2_MIN && v <= OXI.SPO2_MAX; }
function detectDesats(spo2, drop) {
  drop = drop || OXI.DROP;
  var n = spo2.length, W = OXI.BASE_WIN, events = [];
  var inEv = false, st = 0, nad = 100, nadIdx = 0, base = 95;
  function close(end) { if (inEv && end - st >= OXI.MIN_DUR) events.push({ startIdx: st, onset: st, nadirIdx: nadIdx, endIdx: end, depth: +(base - nad).toFixed(1), duration: end - st, nadir: nad }); inEv = false; }
  for (var i = 0; i < n; i++) {
    if (!_spo2Valid(spo2[i])) { close(i); continue; }       // missing breaks any event
    var bmax = -Infinity, lo = Math.max(0, i - W);
    for (var j = lo; j < i; j++) { var v = spo2[j]; if (_spo2Valid(v) && v > bmax) bmax = v; }
    if (bmax === -Infinity) bmax = spo2[i];
    if (spo2[i] <= bmax - drop) {
      if (!inEv) { inEv = true; st = i; nad = spo2[i]; nadIdx = i; base = bmax; }
      else if (spo2[i] < nad) { nad = spo2[i]; nadIdx = i; }
    } else { close(i); }
  }
  close(n);
  return events;
}
function oximetryLane(sa2, durSec) {
  var spo2Ch = chan(sa2, 'SpO2'), pulseCh = chan(sa2, 'Pulse');
  if (!spo2Ch || !spo2Ch.data || !spo2Ch.data.length) return { available: false, reason: 'no-spo2-channel', coverage: 0 };
  var spo2 = spo2Ch.data, pulse = pulseCh ? pulseCh.data : new Float32Array(spo2.length);
  var n = spo2.length, valid = 0;
  for (var i = 0; i < n; i++) if (_spo2Valid(spo2[i])) valid++;
  var coverage = n ? valid / n : 0;
  if (valid === 0 || coverage < OXI.COVERAGE_FLOOR)
    return { available: false, reason: valid === 0 ? 'oximeter-not-connected' : 'low-coverage', coverage: +coverage.toFixed(3), validSamples: valid, totalSamples: n };

  var hours = (durSec || n) / 3600;
  var events = detectDesats(spo2, OXI.DROP);
  events.forEach(function (ev) { selfGateDesat(ev, pulse, spo2); });
  var real = events.filter(function (e) { return !e.artifact; });
  var artifactCount = events.length - real.length;
  // distributional stats over VALID samples only
  var vArr = [], below90 = 0, nadir = 100, sum = 0;
  for (var k = 0; k < n; k++) { var s = spo2[k]; if (_spo2Valid(s)) { vArr.push(s); sum += s; if (s < 90) below90++; if (s < nadir) nadir = s; } }
  var pv = []; for (var m = 0; m < pulse.length; m++) { var p = pulse[m]; if (p >= SELFGATE.PULSE_MIN && p <= SELFGATE.PULSE_MAX) pv.push(p); }
  return {
    available: true, coverage: +coverage.toFixed(3),
    odi: hours > 0 ? +(real.length / hours).toFixed(2) : null,
    desatCount: real.length, artifactCount: artifactCount,
    t90Pct: vArr.length ? +(below90 / vArr.length * 100).toFixed(2) : null,
    spo2Nadir: vArr.length ? nadir : null,
    spo2Mean: vArr.length ? +(sum / vArr.length).toFixed(1) : null,
    pulseMedian: pv.length ? +_p(pv, 50).toFixed(0) : null,
    pulseRange: pv.length ? +(_p(pv, 95) - _p(pv, 5)).toFixed(0) : null,
    events: events
  };
}

/* ════════════════════════════════════════════════════════════════════════
   FLOW-DERIVED BREATH DETECTION  (§3 — 25 Hz BRP Flow)
   Detrend (subtract a ~4 s running mean) then count negative→positive zero
   crossings of the detrended flow as inspiratory onsets (hysteresis on a noise
   floor). I:E = inspiratory-flow time / expiratory-flow time. Cross-checks the
   device-reported RespRate. O(n) single pass.
   ════════════════════════════════════════════════════════════════════════ */
function detectBreaths(flowCh, durSec) {
  if (!flowCh || !flowCh.data || !flowCh.data.length) return null;
  var flow = flowCh.data, fs = flowCh.fs || 25, n = flow.length;
  var W = Math.max(1, Math.round(fs * 4));                 // running-mean window for detrend
  // running mean via prefix sums
  var run = 0, breaths = 0, lastSign = 0, inspSamp = 0, expSamp = 0;
  var noise = 0; for (var s = 0; s < n; s++) noise += Math.abs(flow[s]); noise = (noise / n) * 0.15;  // 15% of mean |flow|
  // prefix sum for O(n) centered-ish trailing mean
  var ps = new Float64Array(n + 1); for (var a = 0; a < n; a++) ps[a + 1] = ps[a] + flow[a];
  var lastCrossIdx = -1, minBreathSamp = Math.round(fs * 1.2);  // ≥1.2 s/breath (≤50 brpm ceiling)
  for (var i = 0; i < n; i++) {
    var lo = Math.max(0, i - W), hi = Math.min(n, i + W);
    var base = (ps[hi] - ps[lo]) / (hi - lo);
    var d = flow[i] - base;
    if (d > noise) { inspSamp++; if (lastSign <= 0 && (lastCrossIdx < 0 || i - lastCrossIdx >= minBreathSamp)) { breaths++; lastCrossIdx = i; } lastSign = 1; }
    else if (d < -noise) { expSamp++; lastSign = -1; }
  }
  var breathRate = durSec > 0 ? +(breaths / (durSec / 60)).toFixed(1) : null;
  var ieRatio = expSamp > 0 ? +(inspSamp / expSamp).toFixed(2) : null;
  return { breathCount: breaths, breathRate: breathRate, ieRatio: ieRatio };
}

/* ════════════════════════════════════════════════════════════════════════
   EVENT MAPPING — EDF EVE/CSL annotations → typed events / PB spans  (§3, §6)
   ════════════════════════════════════════════════════════════════════════ */
function eveClassToType(cls) {
  switch (cls) {
    case 'Obstructive Apnea': return 'OA';
    case 'Central Apnea':     return 'CA';
    case 'Mixed Apnea':       return 'OA';   // obstructive component scored toward AHI
    case 'Hypopnea':          return 'H';
    case 'RERA':              return 'RE';
    default:                  return null;   // Unclassified / timekeeping
  }
}
// EVE annotations (absolute tMs) → session-relative events {type,timeSec,durSec,class}
function eveEvents(annotations, sessionT0Ms) {
  if (!annotations) return [];
  var out = [];
  for (var i = 0; i < annotations.length; i++) {
    var a = annotations[i], type = eveClassToType(a.class);
    if (!type) continue;
    var timeSec = (a.tMs != null) ? (a.tMs - sessionT0Ms) / 1000 : a.onsetSec;
    out.push({ type: type, timeSec: timeSec, durSec: a.durSec || 0, class: a.class, tMs: a.tMs });
  }
  return out;
}
// CSL spans (Cheyne-Stokes / PeriodicBreathing) → total seconds in periodic breathing
function periodicBreathingSec(annotations) {
  if (!annotations) return 0;
  var sum = 0;
  for (var i = 0; i < annotations.length; i++) {
    var c = annotations[i].class;
    if (c === 'Cheyne-Stokes' || c === 'PeriodicBreathing') sum += (annotations[i].durSec || 0);
  }
  return sum;
}

/* ════════════════════════════════════════════════════════════════════════
   SESSION FROM REAL EDF FILE-SET  (§2 §3 §4)
   set = { BRP, PLD, SA2, EVE, CSL } — each a readEDF() result or null. Produces
   one session: core therapy clock + the full metric surface + the SA2 QC lane.
   The night anchor / off-mask gaps come from buildNight() over these.
   ════════════════════════════════════════════════════════════════════════ */
function buildSessionFromEdf(set, meta) {
  meta = meta || {};
  set = set || {};
  var therapy = set.PLD || set.BRP || set.SA2;             // therapy clock source
  if (!therapy || !therapy.clock) return null;
  var t0Ms = therapy.clock.t0Ms;
  var recDur = therapy.recDurSec || 60;
  var durSec = (therapy.recordsRead || 0) * recDur;

  // ── PLD detail channels (0.5 Hz) ──
  var pressCh = chan(set.PLD, 'Press') || chan(set.PLD, 'MaskPress');
  var eprCh   = chan(set.PLD, 'EprPress');
  // Expiratory pressure channel for EPAP95: a dedicated EPAP lane (true bilevel/BiPAP)
  // if the device writes one, else the AirSense EPR-relieved expiratory pressure.
  // On a fixed-CPAP machine with no EPR this equals delivered pressure (epap95≈p95).
  var epapCh  = chan(set.PLD, 'EPAP') || eprCh;
  var leak    = leakToLpm(chan(set.PLD, 'Leak'));
  var rrCh    = chan(set.PLD, 'RespRate');
  var tvCh    = chan(set.PLD, 'TidVol');
  var mvCh    = chan(set.PLD, 'MinVent');
  var snCh    = chan(set.PLD, 'Snore');
  var flCh    = chan(set.PLD, 'FlowLim');
  var fs      = pressCh ? pressCh.fs : 0.5;
  var pressure = pressCh ? pressCh.data : new Float32Array(0);

  // mask-on = delivered pressure > 0
  var maskOn = new Uint8Array(pressure.length);
  for (var i = 0; i < pressure.length; i++) maskOn[i] = pressure[i] > 0 ? 1 : 0;
  var pressureMaskOn = _filterBy(pressure, maskOn);
  var leakMaskOn = leak ? _filterBy(leak, maskOn) : [];
  var usageHours = _countWhere(pressure, function (v) { return v > 0; }) / ((fs || 0.5) * 3600);

  // ── events from EVE; PB span from CSL ──
  var events = eveEvents(set.EVE && set.EVE.annotations, t0Ms);
  var pbSec = periodicBreathingSec(set.CSL && set.CSL.annotations);

  // ── EPR delta + mode (CPAP fixed vs APAP variable) ──
  var eprDelta = null;
  if (eprCh && pressCh) {
    var nn = Math.min(eprCh.data.length, pressCh.data.length), diffs = [];
    for (var e = 0; e < nn; e++) if (pressCh.data[e] > 0) diffs.push(pressCh.data[e] - eprCh.data[e]);
    eprDelta = diffs.length ? +_p(diffs, 50).toFixed(1) : null;
  }
  var pressIqr = _iqr(pressureMaskOn);
  var mode = (isFinite(pressIqr) && pressIqr > 1.0) ? 'APAP' : 'CPAP';   // >1 cmH₂O IQR ⇒ auto-titrating
  var epapMaskOn = epapCh ? _filterBy(epapCh.data, maskOn) : [];
  var epap95 = epapMaskOn.length ? +(_p(epapMaskOn, 95)).toFixed(2) : null;   // bilevel EPAP / EPR expiratory P95

  // ── ventilation, flow-limitation, snore ──
  var rrMaskOn = rrCh ? _filterBy(rrCh.data, maskOn) : [];
  var mvMaskOn = mvCh ? _filterBy(mvCh.data, maskOn) : [];
  var snMaskOn = snCh ? _filterBy(snCh.data, maskOn) : [];
  var flMaskOn = flCh ? _filterBy(flCh.data, maskOn) : [];

  // ── breath detection from 25 Hz BRP Flow ──
  var breath = detectBreaths(chan(set.BRP, 'Flow'), durSec);

  // ── SA2 oximetry QC lane (self-gated) ──
  var oxi = oximetryLane(set.SA2, durSec);

  // ── assemble metric surface ──
  var aCount = function (t) { return events.filter(function (x) { return x.type === t; }).length; };
  var nApnea = aCount('OA') + aCount('CA') + aCount('H');
  var metrics = {
    // Usage & Adherence
    usageHours:       +usageHours.toFixed(3),
    compliancePct:    null,                                 // longitudinal (buildLongitudinal)
    maskOnLatency:    (function () { for (var i = 0; i < pressure.length; i++) if (pressure[i] > 0) return +(i / (fs * 60)).toFixed(2); return NaN; })(),
    // Pressure
    medianPressure:   +(_p(pressureMaskOn, 50)).toFixed(2),
    p95Pressure:      +(_p(pressureMaskOn, 95)).toFixed(2),
    pressureRange:    +pressIqr.toFixed(2),
    eprDelta:         eprDelta,
    epap95:           epap95,
    mode:             mode,
    // Residual events (device-scored EVE — top tier)
    residualAHI:      usageHours > 0 ? +(nApnea / usageHours).toFixed(2) : null,
    obstructiveIndex: usageHours > 0 ? +(aCount('OA') / usageHours).toFixed(2) : null,
    centralIndex:     usageHours > 0 ? +(aCount('CA') / usageHours).toFixed(2) : null,
    hypopneaIndex:    usageHours > 0 ? +(aCount('H') / usageHours).toFixed(2) : null,
    reraIndex:        usageHours > 0 ? +(aCount('RE') / usageHours).toFixed(2) : null,
    periodicBreathingPct: durSec > 0 ? +(pbSec / durSec * 100).toFixed(2) : 0,
    // Leak (converted to L/min)
    medianLeak:       leak ? +(_p(leakMaskOn, 50)).toFixed(2) : null,
    p95Leak:          leak ? +(_p(leakMaskOn, 95)).toFixed(2) : null,
    maxLeak:          leak ? +Math.max.apply(null, leakMaskOn.length ? leakMaskOn : [0]).toFixed(2) : null,
    largeLeakPct:     leakMaskOn.length ? +(_countWhere(leakMaskOn, function (v) { return v > 24; }) / leakMaskOn.length * 100).toFixed(2) : null,
    leakCV:           leak ? _leakCV(leakMaskOn) : null,
    // Ventilation
    respRateMedian:   rrMaskOn.length ? +(_p(rrMaskOn, 50)).toFixed(1) : null,
    respRateRange:    rrMaskOn.length ? +(_iqr(rrMaskOn)).toFixed(1) : null,
    tidVolMedian:     tvCh ? +(_p(_filterBy(tvCh.data, maskOn), 50)).toFixed(2) : null,
    minVentMedian:    mvMaskOn.length ? +(_p(mvMaskOn, 50)).toFixed(2) : null,
    minVentStability: mvMaskOn.length ? +(_cov(mvMaskOn)).toFixed(1) : null,
    // Flow limitation
    flowLimMean:      flMaskOn.length ? +(_mean(flMaskOn)).toFixed(3) : null,
    flowLimitedPct:   flMaskOn.length ? +(_countWhere(flMaskOn, function (v) { return v > 0.3; }) / flMaskOn.length * 100).toFixed(2) : null,
    // Snore
    snorePct:         snMaskOn.length ? +(_countWhere(snMaskOn, function (v) { return v > 0.2; }) / snMaskOn.length * 100).toFixed(2) : null,
    snorePressureCorr: (snMaskOn.length && pressureMaskOn.length) ? +(_pearson(snMaskOn, pressureMaskOn)).toFixed(2) : null,
    // Breath detection (flow-derived — validates device RespRate)
    breathCount:      breath ? breath.breathCount : null,
    breathRate:       breath ? breath.breathRate : null,
    ieRatio:          breath ? breath.ieRatio : null
  };

  var sqi = leakSqi(metrics);
  return {
    t0Ms: t0Ms,
    endMs: t0Ms + durSec * 1000,                            // WALL duration (for off-mask gap math)
    durMin: +(durSec / 60).toFixed(1),
    usageHours: +usageHours.toFixed(3),
    mode: mode,
    fname: meta.fname || null,
    truncated: !!therapy.truncated,
    recordsRead: therapy.recordsRead, numRecords: therapy.numRecords,
    metrics: metrics,
    oximetry: oxi,
    events: events,
    pbSec: pbSec,
    sqi: sqi,
    nEvents: events.length,
    // pooled raw for night-level recompute (kept lightweight: mask-on slices only)
    _pool: { pressureMaskOn: pressureMaskOn, epapMaskOn: epapMaskOn, leakMaskOn: leakMaskOn, usageHours: usageHours, nApnea: nApnea, nOA: aCount('OA'), nCA: aCount('CA'), nH: aCount('H'), nRE: aCount('RE'), pbSec: pbSec, durSec: durSec }
  };
}

/* Night-level pooled metrics over all sessions' mask-on samples + total therapy
   hours (§3 "per-night AND per-session"). Pools events for AHI; recomputes
   distributional pressure/leak from concatenated mask-on slices. */
function nightMetrics(sessions) {
  var pools = sessions.map(function (s) { return s._pool; }).filter(Boolean);
  if (!pools.length) return null;
  var P = [], E = [], L = [], totHours = 0, nA = 0, nOA = 0, nCA = 0, nH = 0, nRE = 0, pbSec = 0, durSec = 0;
  pools.forEach(function (p) {
    for (var i = 0; i < p.pressureMaskOn.length; i++) P.push(p.pressureMaskOn[i]);
    if (p.epapMaskOn) for (var k = 0; k < p.epapMaskOn.length; k++) E.push(p.epapMaskOn[k]);
    for (var j = 0; j < p.leakMaskOn.length; j++) L.push(p.leakMaskOn[j]);
    totHours += p.usageHours; nA += p.nApnea; nOA += p.nOA; nCA += p.nCA; nH += p.nH; nRE += p.nRE; pbSec += p.pbSec; durSec += p.durSec;
  });
  return {
    usageHours:       +totHours.toFixed(3),
    residualAHI:      totHours > 0 ? +(nA / totHours).toFixed(2) : null,
    obstructiveIndex: totHours > 0 ? +(nOA / totHours).toFixed(2) : null,
    centralIndex:     totHours > 0 ? +(nCA / totHours).toFixed(2) : null,
    hypopneaIndex:    totHours > 0 ? +(nH / totHours).toFixed(2) : null,
    reraIndex:        totHours > 0 ? +(nRE / totHours).toFixed(2) : null,
    periodicBreathingPct: durSec > 0 ? +(pbSec / durSec * 100).toFixed(2) : 0,
    medianPressure:   +(_p(P, 50)).toFixed(2),
    p95Pressure:      +(_p(P, 95)).toFixed(2),
    pressureRange:    +(_iqr(P)).toFixed(2),
    epap95:           E.length ? +(_p(E, 95)).toFixed(2) : null,
    medianLeak:       L.length ? +(_p(L, 50)).toFixed(2) : null,
    p95Leak:          L.length ? +(_p(L, 95)).toFixed(2) : null,
    largeLeakPct:     L.length ? +(_countWhere(L, function (v) { return v > 24; }) / L.length * 100).toFixed(2) : null,
    leakCV:           L.length ? _leakCV(L) : null
  };
}

/* ════════════════════════════════════════════════════════════════════════
   SELF-TEST — synthetic session with known truth, asserts every metric.
   Mirrors the codegen test expectations (usage 7.5h, AHI 0.625, etc.) but on
   floating tMs + the real session/gap logic.
   ════════════════════════════════════════════════════════════════════════ */
function _synthRaw(opts) {
  opts = opts || {};
  var hours = opts.hours || 7.5, fs = 1, n = Math.round(hours * 3600 * fs);
  var startBlank = opts.maskOnLatencySec || 30;       // 30s of pressure=0 before therapy
  var pressure = new Float32Array(n), leak = new Float32Array(n);
  for (var i = 0; i < n; i++) {
    pressure[i] = i < startBlank ? 0 : 10 + (Math.sin(i / 500) * 0.05);   // ~10 cmH2O, tiny noise
    leak[i] = 5 + (Math.sin(i / 300) * 0.5);                              // ~5 L/min
  }
  // events: AHI target 0.625/hr over 7.5h ⇒ ~4.69 ≈ 5 events. Use 3 H + 1 OA + 1 CA = 5.
  var events = [
    { type: 'H', timeSec: 1000, durSec: 12 }, { type: 'H', timeSec: 5000, durSec: 11 }, { type: 'H', timeSec: 9000, durSec: 14 },
    { type: 'OA', timeSec: 14000, durSec: 18 }, { type: 'CA', timeSec: 20000, durSec: 16 }
  ];
  return { t0Ms: Date.UTC(2026, 5, 13, 23, 14, 33), fs: fs, pressure: pressure, leak: leak, events: events, mode: 'CPAP' };
}

/* Synthetic EDF file-set shaped like readEDF() outputs, for buildSessionFromEdf
   tests. opts: { oxi } valid oximeter w/ a gentle real desat, { squeeze } adds a
   perfusion-collapse artifact desat, { cs } adds a CSL Cheyne-Stokes span. */
function _mkSig(n, fn, fs, dim) { var a = new Float32Array(n); for (var i = 0; i < n; i++) a[i] = fn(i); return { data: a, fs: fs, dim: dim, _spr: Math.round(fs * 60) }; }
function _synthEdfSet(opts) {
  opts = opts || {};
  var R = 10, recDur = 60, durSec = R * recDur, t0 = Date.UTC(2026, 5, 12, 22, 28, 30);
  var nH = Math.round(durSec * 0.5), n1 = durSec, n25 = durSec * 25;
  var PLD = { clock: { t0Ms: t0 }, recordsRead: R, recDurSec: recDur, numRecords: R, truncated: false, signals: {
    'Press.2s':    _mkSig(nH, function (i) { return 10 + Math.sin(i / 50) * 0.1; }, 0.5, 'cmH2O'),
    'EprPress.2s': _mkSig(nH, function () { return 7; }, 0.5, 'cmH2O'),
    'Leak.2s':     _mkSig(nH, function () { return 0.08; }, 0.5, 'L/s'),   // 4.8 L/min
    'RespRate.2s': _mkSig(nH, function () { return 14; }, 0.5, 'bpm'),
    'TidVol.2s':   _mkSig(nH, function () { return 0.5; }, 0.5, 'L'),
    'MinVent.2s':  _mkSig(nH, function () { return 7; }, 0.5, 'L/min'),
    'Snore.2s':    _mkSig(nH, function () { return 0.05; }, 0.5, ''),
    'FlowLim.2s':  _mkSig(nH, function () { return 0.1; }, 0.5, ''),
    'Crc16':       _mkSig(R, function () { return 1; }, 1 / 60, '')
  } };
  var BRP = { clock: { t0Ms: t0 }, recordsRead: R, recDurSec: recDur, numRecords: R, truncated: false, signals: {
    'Flow.40ms':  _mkSig(n25, function (i) { return Math.sin(2 * Math.PI * 0.25 * i / 25); }, 25, 'L/s'),  // 0.25 Hz = 15 brpm
    'Press.40ms': _mkSig(n25, function () { return 10; }, 25, 'cmH2O')
  } };
  var spo2 = new Float32Array(n1), pulse = new Float32Array(n1);
  if (opts.oxi) {
    for (var i = 0; i < n1; i++) { spo2[i] = 96; pulse[i] = 60; }
    for (var k = 200; k < 220; k++) spo2[k] = 96 - (k - 200) * 0.35;       // gentle real desat → ~89
    for (var k2 = 220; k2 < 240; k2++) spo2[k2] = 89 + (k2 - 220) * 0.35;
    if (opts.squeeze) {                                                    // perfusion-collapse artifact
      for (var s = 400; s < 404; s++) spo2[s] = 96 - (s - 399) * 7;        // ~28%/s cliff → 68
      for (var s2 = 404; s2 < 420; s2++) { spo2[s2] = 68; pulse[s2] = -1; }// pulse craters with it
      pulse[400] = -1; pulse[401] = -1; pulse[402] = -1; pulse[403] = -1;
    }
  } else {
    for (var z = 0; z < n1; z++) { spo2[z] = -1; pulse[z] = -1; }          // oximeter not connected
  }
  var SA2 = { clock: { t0Ms: t0 }, recordsRead: R, recDurSec: recDur, signals: {
    'SpO2.1s':  { data: spo2,  fs: 1, dim: '%',   _spr: 60 },
    'Pulse.1s': { data: pulse, fs: 1, dim: 'bpm', _spr: 60 }
  } };
  var EVE = { clock: { t0Ms: t0 }, recordsRead: 1, recDurSec: 0, signals: {}, annotations: [
    { class: 'Obstructive Apnea', durSec: 15, onsetSec: 100, tMs: t0 + 100000 },
    { class: 'Obstructive Apnea', durSec: 18, onsetSec: 200, tMs: t0 + 200000 },
    { class: 'Central Apnea',     durSec: 12, onsetSec: 300, tMs: t0 + 300000 },
    { class: 'Hypopnea',          durSec: 20, onsetSec: 400, tMs: t0 + 400000 },
    { class: 'RERA',              durSec: 8,  onsetSec: 500, tMs: t0 + 500000 }
  ] };
  var CSL = { clock: { t0Ms: t0 }, annotations: opts.cs
    ? [{ class: 'Cheyne-Stokes', durSec: 120, onsetSec: 50, tMs: t0 + 50000 }]
    : [{ class: 'Unclassified', durSec: 0, onsetSec: 0, tMs: t0 }] };
  return { PLD: PLD, BRP: BRP, SA2: SA2, EVE: EVE, CSL: CSL };
}

function selfTest() {
  var pass = 0, fail = 0, log = [];
  function near(a, b, tol) { return a != null && isFinite(a) && Math.abs(a - b) <= tol; }
  function ok(name, cond, got) { (cond ? pass++ : fail++); log.push((cond ? '✓ ' : '✗ ') + name + (cond ? '' : ' — got ' + got)); }

  var prep = prepare(_synthRaw());
  var m = computeMetrics(prep);
  ok('usageHours ≈ 7.5', near(m.usageHours, 7.5, 0.02), m.usageHours);
  ok('maskOnLatency ≈ 0.5 min (30s)', near(m.maskOnLatency, 0.5, 0.05), m.maskOnLatency);
  ok('medianPressure ≈ 10', near(m.medianPressure, 10, 0.2), m.medianPressure);
  ok('p95Pressure ≈ 10', near(m.p95Pressure, 10, 0.2), m.p95Pressure);
  ok('pressureRange (IQR) small', near(m.pressureRange, 0, 0.2), m.pressureRange);
  ok('residualAHI ≈ 0.667 (5 ev / 7.5h)', near(m.residualAHI, 5 / 7.5, 0.02), m.residualAHI);
  ok('centralIndex ≈ 0.133', near(m.centralIndex, 1 / 7.5, 0.02), m.centralIndex);
  ok('obstructiveIndex ≈ 0.133', near(m.obstructiveIndex, 1 / 7.5, 0.02), m.obstructiveIndex);
  ok('hypopneaIndex ≈ 0.4', near(m.hypopneaIndex, 3 / 7.5, 0.02), m.hypopneaIndex);
  ok('medianLeak ≈ 5', near(m.medianLeak, 5, 0.6), m.medianLeak);
  ok('largeLeakPct = 0 (no >24)', near(m.largeLeakPct, 0, 0.01), m.largeLeakPct);
  ok('leakSqi = 1 (clean)', near(leakSqi(m), 1, 1e-9), leakSqi(m));

  // session + night + off-mask gap (two sessions, one night)
  var s1 = buildSession(prepare(_synthRaw({ hours: 4 })), { fname: 'a' });
  var raw2 = _synthRaw({ hours: 3 }); raw2.t0Ms = s1.endMs + 20 * 60000;   // 20-min off-mask gap
  var s2 = buildSession(prepare(raw2), { fname: 'b' });
  var night = buildNight([s2, s1]);   // intentionally out of order
  ok('night anchor = earliest session', night.t0Ms === s1.t0Ms, fmtDateTime(night.t0Ms));
  ok('sessions sorted by t0Ms', night.sessions[0].fname === 'a' && night.sessions[1].fname === 'b', night.sessions.map(function(x){return x.fname;}).join(','));
  ok('one off-mask gap ≈ 20 min', night.offMaskGaps.length === 1 && near(night.offMaskGaps[0].gapMin, 20, 0.2), JSON.stringify(night.offMaskGaps));
  ok('off-mask gap carries afterIdx (render/fusion contract)', night.offMaskGaps[0].afterIdx === 0, JSON.stringify(night.offMaskGaps[0]));
  ok('therapyHours ≈ 7 (4+3, no 24h jump)', near(night.therapyHours, 7, 0.05), night.therapyHours);
  ok('overnight stays monotonic (gap > 0)', night.offMaskGaps[0].gapMin > 0, night.offMaskGaps[0].gapMin);

  // longitudinal compliance
  var lng = buildLongitudinal([{ therapyHours: 7 }, { therapyHours: 3.5 }, { therapyHours: 6 }, { therapyHours: 5 }]);
  ok('compliancePct = 75 (3/4 nights ≥4h)', near(lng.compliancePct, 75, 0.01), lng.compliancePct);

  // multi-night longitudinal trends (OxyDex-style)
  var mkN = function (day, hrs, ahi) { return { t0Ms: Date.UTC(2026, 5, day, 22, 30, 0), therapyHours: hrs, metrics: { usageHours: hrs, residualAHI: ahi, centralIndex: 0, largeLeakPct: 0 }, sessions: [] }; };
  var hist = [mkN(1, 5, 8), mkN(2, 5.5, 7), mkN(3, 6, 6), mkN(4, 6.5, 5), mkN(5, 7, 4), mkN(6, 7, 3), mkN(7, 7.5, 2)];
  var lng2 = buildLongitudinal(hist);
  ok('longitudinal: usageTrend7d > 0 (usage rising)', lng2.usageTrend7d > 0, lng2.usageTrend7d);
  ok('longitudinal: ahiTrend30d mean ≈ 5 over 7 nights', lng2.ahiTrend30d && near(lng2.ahiTrend30d.mean, 5, 0.6), JSON.stringify(lng2.ahiTrend30d));
  ok('longitudinal: chronological order independent of input order', buildLongitudinal(hist.slice().reverse()).usageTrend7d === lng2.usageTrend7d, 'reversed == forward');
  if (root.CPAPCross) ok('longitudinal: crossNight block present (CPAPCross bundled)', !!(lng2.crossNight && lng2.crossNight.metrics && lng2.crossNight.metrics.residualAHI), JSON.stringify(lng2.crossNight && lng2.crossNight.schema));

  // parseTimestamp mirror — floating + fractional seconds (Clock Contract §2)
  var pt1 = parseTimestamp('20260612_222830');
  ok('parseTimestamp: filename prefix → floating tMs', pt1 && pt1.tMs === Date.UTC(2026, 5, 12, 22, 28, 30) && pt1.offsetMin === null, JSON.stringify(pt1));
  var pt2 = parseTimestamp('2026-06-12 22:28:30.250');
  ok('parseTimestamp: ISO captures fractional seconds (ms)', pt2 && pt2.tMs === Date.UTC(2026, 5, 12, 22, 28, 30, 250), JSON.stringify(pt2));
  ok('parseTimestamp: stamp-less → null (never now())', parseTimestamp('no clock here') === null);

  // ════════ STEP 2 ADDITIONS — real-signal adapter, self-gate, QC lane ════════

  // ── oximeter self-gate (Part A, mirrored) ──
  var spA = [], puA = [];                                  // 1.5 s cliff 98→67 w/ pulse flatline
  for (var i = 0; i < 30; i++) { spA.push(98); puA.push(60); }
  spA.push(82); puA.push(NaN); spA.push(67); puA.push(NaN);
  for (var i = 32; i < 50; i++) { spA.push(67); puA.push(NaN); }
  var evA = { onset: 30, startIdx: 30, nadirIdx: 31, endIdx: 49, depth: 31, duration: 19 };
  selfGateDesat(evA, puA, spA);
  ok('self-gate: 1.5 s cliff ⇒ artifact (nonphysiologic-kinetics)', evA.artifact === true && evA.reason === 'nonphysiologic-kinetics', evA.reason);

  var spB = [], puB = [];                                  // gentle 30 s desat, valid pulse
  for (var i = 0; i < 20; i++) { spB.push(96); puB.push(60); }
  for (var i = 0; i < 30; i++) { spB.push(96 - i * 0.27); puB.push(60); }
  for (var i = 0; i < 20; i++) { spB.push(88 + i * 0.4); puB.push(60); }
  var evB = { onset: 20, startIdx: 20, nadirIdx: 49, endIdx: 50, depth: 8, duration: 30 };
  selfGateDesat(evB, puB, spB);
  ok('self-gate: gentle 30 s desat w/ valid pulse ⇒ kept', evB.artifact === false, evB.reason);

  var puC = puB.map(function () { return 0; });            // perfusion collapse (pulse all out-of-band)
  var evC = { onset: 20, startIdx: 20, nadirIdx: 49, endIdx: 50, depth: 8, duration: 30 };
  selfGateDesat(evC, puC, spB);
  ok('self-gate: <50% valid pulse ⇒ artifact (perfusion-collapse)', evC.artifact === true && evC.reason === 'perfusion-collapse', evC.reason);

  // ── leak L/s → L/min conversion (dim-driven) ──
  ok('leakToLpm: L/s ×60', leakToLpm({ data: Float32Array.from([0.5]), dim: 'L/s' })[0] === 30);
  ok('leakToLpm: L/min unchanged', leakToLpm({ data: Float32Array.from([12]), dim: 'L/min' })[0] === 12);

  // ── EVE/CSL mapping ──
  var evMap = eveEvents([{ class: 'Obstructive Apnea', durSec: 10, tMs: 1000, onsetSec: 1 }, { class: 'Cheyne-Stokes', durSec: 60, tMs: 2000, onsetSec: 2 }], 0);
  ok('eveEvents maps OA, drops Cheyne-Stokes', evMap.length === 1 && evMap[0].type === 'OA', JSON.stringify(evMap));
  ok('periodicBreathingSec sums CS/PB spans', periodicBreathingSec([{ class: 'Cheyne-Stokes', durSec: 60 }, { class: 'Hypopnea', durSec: 10 }]) === 60);

  // ── full EDF-set integration: buildSessionFromEdf on a synthetic file-set ──
  var sess = buildSessionFromEdf(_synthEdfSet({ cs: true }), { fname: 's1' });
  var uh = 600 / 3600;
  ok('EDF session: usageHours ≈ 0.167', near(sess.usageHours, uh, 0.01), sess.usageHours);
  ok('EDF session: mode = CPAP (low pressure IQR)', sess.mode === 'CPAP', sess.mode);
  ok('EDF session: EPR delta ≈ 3', near(sess.metrics.eprDelta, 3, 0.3), sess.metrics.eprDelta);
  ok('EDF session: epap95 present (expiratory P95 ≈ 7)', near(sess.metrics.epap95, 7, 0.5), sess.metrics.epap95);
  ok('EDF session: medianLeak ≈ 4.8 L/min (L/s×60)', near(sess.metrics.medianLeak, 4.8, 0.4), sess.metrics.medianLeak);
  ok('EDF session: AHI = 4 apneas+hypopnea / hr', near(sess.metrics.residualAHI, 4 / uh, 0.5), sess.metrics.residualAHI);
  ok('EDF session: obstructiveIndex from 2 OA', near(sess.metrics.obstructiveIndex, 2 / uh, 0.5), sess.metrics.obstructiveIndex);
  ok('EDF session: reraIndex from 1 RERA', near(sess.metrics.reraIndex, 1 / uh, 0.5), sess.metrics.reraIndex);
  ok('EDF session: periodicBreathingPct = 20% (120/600 s)', near(sess.metrics.periodicBreathingPct, 20, 0.5), sess.metrics.periodicBreathingPct);
  ok('EDF session: breathRate ≈ 15 brpm (flow-derived)', near(sess.metrics.breathRate, 15, 3), sess.metrics.breathRate);
  ok('EDF session: SA2 sentinel ⇒ oximetry lane unavailable', sess.oximetry.available === false && sess.oximetry.reason === 'oximeter-not-connected', JSON.stringify(sess.oximetry));

  // ── oximetry lane WHEN a valid oximeter + a real desat is present ──
  var sessO = buildSessionFromEdf(_synthEdfSet({ oxi: true }), {});
  ok('EDF session: valid oximeter ⇒ lane available', sessO.oximetry.available === true, JSON.stringify(sessO.oximetry));
  ok('EDF session: real desat detected, NOT self-gated', sessO.oximetry.desatCount >= 1 && sessO.oximetry.artifactCount === 0, JSON.stringify(sessO.oximetry));
  ok('EDF session: spo2Nadir ≈ 89', near(sessO.oximetry.spo2Nadir, 89, 1.5), sessO.oximetry.spo2Nadir);

  // ── injected squeeze: a real-looking desat with a perfusion collapse is gated out of ODI ──
  var sessSq = buildSessionFromEdf(_synthEdfSet({ oxi: true, squeeze: true }), {});
  ok('EDF session: injected squeeze flagged artifact + excluded from ODI', sessSq.oximetry.artifactCount >= 1, JSON.stringify(sessSq.oximetry));

  // ── night-level pooled metrics from real sessions ──
  var nightR = buildNight([buildSessionFromEdf(_synthEdfSet({}), { fname: 'n1' })]);
  ok('night metrics pooled from sessions (AHI present)', !!(nightR.metrics && nightR.metrics.residualAHI != null), JSON.stringify(nightR.metrics));

  return { pass: pass, fail: fail, log: log };
}

/* ════════════════════════════════════════════════════════════════════════
   PHASE-9 SIGNAL-ADAPTER — namespaced node surface (CPAPDex.compute)
   (SIGNAL-ADAPTER-PHASE9-REMAINING-NODES, node 4/4 — the CPAPDex leg.)
   ────────────────────────────────────────────────────────────────────────
   FRAME-SHAPE DECISION (owned by GENERIC-EMIT-GATE-FOLLOWUPS-I §1 — recorded
   here + in cpapdex-registry.js + the export `doc`): a `SignalFrame` has NO
   event carrier, but CPAPDex's headline value is the device-scored EVE/CSL
   events (AHI/OA/CA/H/RERA/PB) the firmware writes into the EDF ANNOTATIONS —
   graded `measured`, NOT derivable from the flow waveform. So:
     • A NEW `cpap` SignalSpec entry (kind:'samples', unit 'L/s') makes the 25 Hz
       BRP FLOW waveform the canonical sample payload (so validateFrame passes:
       a samples frame needs samples + fs>0). This is option (b)+(c) of the §1
       fork: the device-scored events + the rest of the decoded multi-signal set
       ride as a STRUCTURED SIDECAR on the frame (`frame.edfSets` = the decoded
       {BRP,PLD,SA2,EVE,CSL} set(s)) — exactly how ECG carries deviceRR/deviceACC
       companions (PPGDEX-FOLLOWUPS §8 pattern). No validateFrame change needed
       (extra frame fields are allowed; the flow `samples` satisfies the contract).
     • CPAPDex goes emittable via SignalOrchestrate.canEmit('cpap') + the
       emitCpapNodeExport dispatch + a generic-gate provider — WITHOUT a classic
       text-stream adapter. The Data Unifier / OverDex ingest boundary is
       readAsText (data-unifier-app.js), which CANNOT round-trip a BINARY EDF
       file, so a registered text adapter would receive mangled bytes and have to
       fabricate — dishonest. EDF binary ingest stays the CPAPDex APP's job (it
       reads ArrayBuffers). The generic-emit gate's DRIVER 2 (canEmit-bound) still
       FORCES a schema-valid orchestrate emit path here, so the shape can't drift.
   compute() is SELF-CONTAINED (CONTRIBUTING §6): it runs the node's REAL pipeline
   (buildSessionFromEdf → buildNight) and hands the night to the SAME shared
   builder the app uses (CpapFusion.cpapBuildExport — ONE event source, byte-
   identical to the app's exportNight), resolved lazily + typeof-guarded.
   ════════════════════════════════════════════════════════════════════════ */
// Resolve a `night` (buildNight output) from any accepted compute() input:
//   · a canonical cpap SignalFrame carrying `edfSets` (decoded {BRP,PLD,SA2,EVE,CSL} set(s));
//   · a single already-decoded EDF set ({BRP|PLD|SA2…});
//   · an array of decoded sets;
//   · an already-built night (has sessions[].metrics) or { night }.
function _nightFromInput(input) {
  if (!input || typeof input !== 'object') return null;
  // already a night (a session carries a computed metric surface)?
  if (Array.isArray(input.sessions) && input.sessions.length && input.sessions[0] && input.sessions[0].metrics) return input;
  if (input.night && Array.isArray(input.night.sessions)) return input.night;
  // canonical cpap frame sidecar, or an explicit decoded-set array
  var sets = input.edfSets || input.sets || null;
  // a single decoded EDF set handed straight in
  if (!sets && (input.PLD || input.BRP || input.SA2 || input.EVE)) sets = [input];
  if (!Array.isArray(sets) || !sets.length) return null;
  var sessions = [];
  for (var i = 0; i < sets.length; i++) {
    var s = buildSessionFromEdf(sets[i], { fname: (sets[i] && sets[i]._fname) || ('set' + i) });
    if (s) sessions.push(s);
  }
  return sessions.length ? buildNight(sessions) : null;
}
// Headless public surface — decoded EDF → night → shared node-export builder.
// Accepts the canonical cpap SignalFrame (edfSets sidecar), a decoded set, or a night.
function compute(input, opts) {
  opts = opts || {};
  var night = _nightFromInput(input);
  if (!night) throw new Error('CPAPDex.compute: need a cpap SignalFrame (with edfSets), a decoded EDF set {BRP,PLD,SA2,EVE,CSL}, or a night object');
  // ONE event source: the SAME builder cpapdex-app.js exportNight uses → the
  // Unifier/OverDex export is byte-identical to the app's (brief §1B parity).
  var build = root && root.CpapFusion && root.CpapFusion.cpapBuildExport;
  if (typeof build !== 'function')
    throw new Error('CPAPDex.compute: CpapFusion.cpapBuildExport unavailable — co-load cpapdex-fusion.js in this realm (it carries the shared node-export builder)');
  return build(night);
}

/* ── exports + CLI ──────────────────────────────────────────────────────── */
var api = {
  fmtClock: fmtClock, fmtDate: fmtDate, fmtDateTime: fmtDateTime, parseTimestamp: parseTimestamp,
  prepare: prepare, computeMetrics: computeMetrics, leakSqi: leakSqi,
  buildSession: buildSession, buildNight: buildNight, buildLongitudinal: buildLongitudinal,
  // Step 2 — real-signal adapter + flow/oximetry DSP
  chan: chan, leakToLpm: leakToLpm,
  selfGateDesat: selfGateDesat, detectDesats: detectDesats, oximetryLane: oximetryLane,
  detectBreaths: detectBreaths, eveEvents: eveEvents, eveClassToType: eveClassToType,
  periodicBreathingSec: periodicBreathingSec,
  buildSessionFromEdf: buildSessionFromEdf, nightMetrics: nightMetrics,
  compute: compute, _nightFromInput: _nightFromInput,
  SELFGATE: SELFGATE, OXI: OXI,
  _synthRaw: _synthRaw, _synthEdfSet: _synthEdfSet, selfTest: selfTest,
  _kernel: { _mean: _mean, _sd: _sd, _cov: _cov, _p: _p, _iqr: _iqr, _pearson: _pearson }
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (root) {
  root.CpapDsp = api;
  // ONE namespaced global (brief §1A) — signal-orchestrate.cpapHost() resolves root.CPAPDex.
  // The whole DSP is inside this IIFE (leaks nothing bare), so no __DEX_NAMESPACED__
  // suppression gate is needed; standalone bundles still read CpapDsp. compute() is the
  // Phase-9 emit entry; buildNightFromSets is exposed for harness convenience.
  root.CPAPDex = root.CPAPDex || { compute: compute, buildNightFromSets: _nightFromInput, _synthEdfSet: _synthEdfSet };
}

if (typeof process !== 'undefined' && process.argv && process.argv.indexOf('--selftest') !== -1) {
  var r = selfTest();
  r.log.forEach(function (l) { console.log('  ' + l); });
  console.log('\n  CPAPDex DSP self-test: ' + r.pass + ' passed, ' + r.fail + ' failed\n');
  if (typeof process.exitCode !== 'undefined') process.exitCode = r.fail ? 1 : 0;
}

})(typeof window !== 'undefined' ? window : null);
