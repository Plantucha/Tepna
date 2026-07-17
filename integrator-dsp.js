/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   integrator-dsp.js — Ganglior Fusion Layer · parse / normalize / fuse
   NO DOM. Pure data. Loaded as a plain global script (shares page scope).

   THE CLOCK CONTRACT (CLAUDE.md §) is obeyed verbatim:
     tMs = UTC-normalized FLOATING wall-clock ms. Read back ONLY via getUTC*.
     parseTimestamp / tzOffset / fmtClock / fmtDate / fmtDateTime are
     duplicated locally (mirrored from pulsedex-dsp.js) — never a shared util.
   ════════════════════════════════════════════════════════════════════════ */

/* Bus name lives in ONE constant — rename Ganglior→Fascia is a one-line change. */
const BUS = 'ganglior';
/* Bus values we accept on INPUT regardless of the active name (case-insensitive). */
const BUS_ALIASES = ['ganglior', 'fascia'];

/* ── §1 CLOCK CONTRACT — single-sourced in clock.js (A5, owner-ratified 2026-07-03;
   OWN-THE-BUILD-FOLLOWUPS §3). The former verbatim mirror block lived here; clock.js now
   carries THE canonical tzOffset + _ckP2/_ckNumEpoch/_ckZoneMin/_ckDMY + parseTimestamp and
   loads BEFORE this file in every
   host + bundle (dex-coload.js / *.src.html). Local aliases keep every internal call site
   and the back-compat re-export tail byte-compatible. ── */
var _tzOffset = DexClock.tzOffset,
  _ckP2 = DexClock._ckP2,
  _ckNumEpoch = DexClock._ckNumEpoch,
  _ckZoneMin = DexClock._ckZoneMin,
  _ckDMY = DexClock._ckDMY,
  parseTimestamp = DexClock.parseTimestamp;
function fmtClock(ms) {
  var d = new Date(ms);
  return _ckP2(d.getUTCHours()) + ':' + _ckP2(d.getUTCMinutes());
}
function fmtClockS(ms) {
  var d = new Date(ms);
  return _ckP2(d.getUTCHours()) + ':' + _ckP2(d.getUTCMinutes()) + ':' + _ckP2(d.getUTCSeconds());
}
function fmtDate(ms) {
  var d = new Date(ms);
  return d.getUTCFullYear() + '-' + _ckP2(d.getUTCMonth() + 1) + '-' + _ckP2(d.getUTCDate());
}
function fmtDateTime(ms) {
  return fmtDate(ms) + ' ' + fmtClock(ms);
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDayShort(ms) {
  var d = new Date(ms);
  return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
}

/* ── §3 Reconstruct an event's absolute floating tMs from t0Ms + "HH:MM:SS" ──
   SAME overnight rule as the parser: roll forward a day whenever the clock is
   earlier than the recording's start-of-day clock (handles 22:50 → 02:14). */
function reconstructEventTMs(ev, t0Ms) {
  if (ev && typeof ev.tMs === 'number' && isFinite(ev.tMs)) return ev.tMs; // already absolute
  if (t0Ms == null || ev == null || ev.t == null) return null;
  var p = parseTimestamp(ev.t, { dateAnchorMs: t0Ms, prevTMs: t0Ms });
  return p ? p.tMs : null;
}

/* ── confidence blend: 1 − Π(1 − cᵢ), capped 0.97 (never invent precision) ── */
function combineConf(confs) {
  var prod = 1,
    any = false;
  for (var i = 0; i < confs.length; i++) {
    var c = confs[i];
    if (c == null || !isFinite(c)) continue;
    any = true;
    prod *= 1 - Math.max(0, Math.min(1, c));
  }
  if (!any) return null;
  return Math.min(0.97, +(1 - prod).toFixed(3));
}
function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}
/* Merge a list of [startMs,endMs] intervals → total covered ms (union, no double-count). */
function _mergeMs(ivs) {
  if (!ivs || !ivs.length) return 0;
  var a = ivs.slice().sort(function (x, y) {
    return x[0] - y[0];
  });
  var total = 0,
    curS = a[0][0],
    curE = a[0][1];
  for (var i = 1; i < a.length; i++) {
    if (a[i][0] <= curE) {
      curE = Math.max(curE, a[i][1]);
    } else {
      total += curE - curS;
      curS = a[i][0];
      curE = a[i][1];
    }
  }
  total += curE - curS;
  return total;
}
/* Quality-weighted event likelihood for the noisy-OR (R7): a surge's CVHR-magnitude
   `conf` is attenuated by its local signal quality `sqi`. A weak/noisy surge thus
   contributes less evidence than a clean strong one. sqi==null ⇒ quality-neutral (×1).
   NOTE (SIGNAL-ADAPTER-FOLLOWUPS-III §2): event `meta.derived` / `meta.evidence`
   (stamped by the HRVDex/Welltory black-box-composite path) is **audit-only today —
   NOT consumed by fusion**. effConf attenuates by `sqi` ONLY; a derived vendor-composite
   event currently fuses with the SAME weight as a measured one. The tag is provenance-
   honest for the export trail, but down-weighting `meta.derived` here is a deliberate
   future Integrator pass (the cheaper doc-note option was taken now) — do NOT assume the
   tag is load-bearing in the posterior until that wire-up lands + a test asserts it. */
function effConf(e) {
  if (!e || e.conf == null || !isFinite(e.conf)) return null;
  var q = e.sqi == null || !isFinite(e.sqi) ? 1 : Math.max(0, Math.min(1, e.sqi));
  return Math.max(0, Math.min(1, e.conf)) * q;
}
/* PpgDex SQI FLOOR (NODE-RESIDUE-FOLLOWUPS-2026-06-30 §3): a fusion-layer CATEGORICAL
   quality floor for PpgDex events, MIRRORING the GlucoDex clamp-floor down-weight below.
   effConf() already tapers a PpgDex surge's likelihood PROPORTIONALLY by its per-event sqi
   (conf × sqi, fleet-generic) in the noisy-OR; this adds an EXTRA-distrust penalty for the
   UNUSABLE-quality tail — a PPG beat window whose local sqi is below PPG_SQI_FLOOR is too
   noisy to trust even proportionally, so adaptEnvelopeNode halves that event's conf and tags
   it sqiFloor at ingest, exactly as a clip-floor CGM hypo is (×0.5 + clampFloor). The two are
   COMPLEMENTARY (smooth proportional taper + hard categorical floor), NOT double-counting a
   single axis — sqi RIDES ALONGSIDE conf (R7), never folded in, and is preserved. Integrator-
   LOCAL (a fusion corroboration knob, NOT a node physiology threshold — do NOT kernel-source;
   the PB_CVHR_MIN precedent). sqi==null ⇒ no floor (quality-neutral, back-compat — mirrors
   effConf + the clean-CGM clamp path). */
var PPG_SQI_FLOOR = 0.3;
// FU §2 — a PpgDex HRV summary whose whole-record 3-LED agreement is below this optical-consensus
// floor is too single-LED-carried to trust in the cross-node HRV consensus (excluded like a
// sub-QFLOOR night). Whole-record analog of the per-event PPG_SQI_FLOOR.
var LED_CONSENSUS_FLOOR = 50;
function median(a) {
  if (!a.length) return null;
  var s = a.slice().sort(function (x, y) {
    return x - y;
  });
  var m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function pearson(xs, ys) {
  var n = xs.length;
  if (n < 3) return null;
  var mx =
      xs.reduce(function (s, v) {
        return s + v;
      }, 0) / n,
    my =
      ys.reduce(function (s, v) {
        return s + v;
      }, 0) / n;
  var sxy = 0,
    sxx = 0,
    syy = 0;
  for (var i = 0; i < n; i++) {
    var dx = xs[i] - mx,
      dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return +(sxy / Math.sqrt(sxx * syy)).toFixed(3);
}

/* ════════════════════════════════════════════════════════════════════════
   §2 NODE DETECTION + ADAPTERS → normalized recording records
   NodeRec = { uid, node, label, dateStr, t0Ms, endMs, offsetMin, dateUnknown,
               events:[{tMs,t,impulse,node,conf,meta}], series:{}, summary:{},
               nEvents, raw, _src }
   ════════════════════════════════════════════════════════════════════════ */
const NODE_COLORS = {
  ECGDex: '#FF6B7A',
  OxyDex: '#58A6FF',
  GlucoDex: '#FFB84D',
  PulseDex: '#3DE0D0',
  PpgDex: '#B98AFF',
  HRVDex: '#39D98A',
  CPAPDex: '#14B8A6',
  Unknown: '#8C9DB3'
};
function nodeColor(n) {
  return NODE_COLORS[n] || NODE_COLORS.Unknown;
}

function busOK(v) {
  if (v == null) return true; // missing bus → tolerate, never reject
  return BUS_ALIASES.indexOf(String(v).toLowerCase()) >= 0;
}
function detectNode(json, filename) {
  var n = (json && json.schema && json.schema.node) || (json && json.node) || null;
  if (n) return n;
  var f = (filename || '').toLowerCase();
  if (/ecgdex|ganglior_ecg/.test(f)) return 'ECGDex';
  if (/oxydex|o2ring/.test(f)) return 'OxyDex';
  if (/glucodex|glucose|cgm|lingo/.test(f)) return 'GlucoDex';
  if (/ppgdex/.test(f)) return 'PpgDex';
  if (/pulsedex/.test(f)) return 'PulseDex';
  if (/hrvdex|welltory/.test(f)) return 'HRVDex';
  // shape sniffing
  if (Array.isArray(json) && json[0] && (json[0].desatProfile || json[0].hr_spikes || (json[0].t0Ms != null && json[0].stats))) return 'OxyDex';
  return 'Unknown';
}

/* Build the event list + window for a node-export envelope (ECGDex/GlucoDex/slim). */
function _eventsFromEnvelope(json, node) {
  var t0Ms = (json.recording && json.recording.startEpochMs) || json.startEpochMs || json.t0Ms || null;
  var raw = Array.isArray(json.ganglior_events) ? json.ganglior_events : Array.isArray(json.fascia_events) ? json.fascia_events : Array.isArray(json.events) ? json.events : [];
  // If no t0Ms but events carry absolute tMs, derive t0Ms from earliest.
  if (t0Ms == null) {
    var abs = raw
      .map(function (e) {
        return e && typeof e.tMs === 'number' ? e.tMs : null;
      })
      .filter(function (v) {
        return v != null;
      });
    if (abs.length) t0Ms = Math.min.apply(null, abs);
  }
  var events = [];
  for (var i = 0; i < raw.length; i++) {
    var e = raw[i] || {};
    var tMs = reconstructEventTMs(e, t0Ms);
    if (tMs == null) continue;
    events.push({
      tMs: tMs,
      t: e.t || fmtClockS(tMs),
      impulse: e.impulse || 'event',
      node: e.node || node,
      conf: e.conf != null ? e.conf : null,
      sqi: e.sqi != null ? e.sqi : null,
      meta: e.meta || {}
    });
  }
  events.sort(function (a, b) {
    return a.tMs - b.tMs;
  });
  return { t0Ms: t0Ms, events: events };
}

function adaptEnvelopeNode(json, node, filename) {
  var r = _eventsFromEnvelope(json, node);
  var t0Ms = r.t0Ms,
    events = r.events;
  var dateUnknown = t0Ms == null;
  var endMs = events.length ? events[events.length - 1].tMs : t0Ms;
  // honor the declared recording length when present — a node with sparse / early-
  // clustered events (e.g. a short PulseDex reading) otherwise collapses to a
  // ~zero-length window, overlaps nothing, and is wrongly dropped as 'excluded'.
  var _rec = json.recording || {};
  if (t0Ms != null) {
    var _declEnd = null;
    // honor declared length from the recording envelope OR, as a fallback, the flat
    // top-level fields a node's *summary* export carries (PulseDex lastResult →
    // json.durMin). Without this fallback a stray summary collapses to a zero-span
    // window, overlaps nothing, and is wrongly dropped as 'excluded' (the PulseDex bug).
    var _endEp = _rec.endEpochMs != null ? _rec.endEpochMs : json.endEpochMs != null ? json.endEpochMs : null;
    var _durMin = _rec.durationMin != null ? _rec.durationMin : json.durationMin != null ? json.durationMin : json.durMin != null ? json.durMin : null;
    var _durMs = _rec.durationMs != null ? _rec.durationMs : json.durationMs != null ? json.durationMs : null;
    var _durSec = _rec.durationSec != null ? _rec.durationSec : json.durationSec != null ? json.durationSec : null;
    if (_endEp != null) _declEnd = _endEp;
    else if (_durMin != null) _declEnd = t0Ms + _durMin * 60000;
    else if (_durMs != null) _declEnd = t0Ms + _durMs;
    else if (_durSec != null) _declEnd = t0Ms + _durSec * 1000;
    if (_declEnd != null) endMs = endMs != null ? Math.max(endMs, _declEnd) : _declEnd;
  }
  // include series end if present
  var offsetMin = null;
  for (var i = 0; i < events.length; i++) {
    if (events[i].meta && events[i].meta.offsetMin != null) {
      offsetMin = events[i].meta.offsetMin;
      break;
    }
  }
  if (json.recording && json.recording.offsetMin != null) offsetMin = json.recording.offsetMin;
  // node-specific summary for fusion
  var summary = {};
  var seriesOut = {};
  if (node === 'ECGDex') {
    summary.autonomicInstabilitySlope =
      json.hrvStability && json.hrvStability.mean_lnRMSSD_slope != null
        ? json.hrvStability.mean_lnRMSSD_slope
        : json.reserved && json.reserved.autonomicInstabilitySlope != null
          ? json.reserved.autonomicInstabilitySlope
          : null;
    // AMBULATORY-MODE-BRIEF §3: a node may report mode:"ambulatory" and SUPPRESS its sleep /
    // apnea fields with a reason (reportable:false / suppressed:true). A suppressed-with-reason
    // field is ABSENT, not a zero — do NOT fold it into any confirmed finding or baseline.
    var _apneaSuppressed = !!(json.apnea && json.apnea.reportable === false);
    var _sleepSuppressed = !!(json.sleep && json.sleep.suppressed === true);
    summary.ambulatory = !!(json.recording && json.recording.ambulatory) || _apneaSuppressed || _sleepSuppressed;
    summary.cvhrIndex = json.apnea && !_apneaSuppressed && json.apnea.cvhrIndex != null ? json.apnea.cvhrIndex : null;
    summary.estAHI = json.apnea && !_apneaSuppressed && json.apnea.estimatedAHI ? json.apnea.estimatedAHI.value : null;
    // R8: cross-node HRV must compare the SAME analysis window. ECGDex's bare
    // hrv.time.{sdnn,rmssd} is the DISPLAY value (epoch-median for overnight) —
    // NOT comparable to another node's whole-record SDNN. Normalize the consensus
    // axis to WHOLE-RECORD, and carry the epoch-scoped variants under explicit keys.
    var _ht = (json.hrv && json.hrv.time) || {},
      _hf = (json.hrv && json.hrv.frequency) || {};
    summary.rmssd = _ht.wholeRecordRMSSD != null ? _ht.wholeRecordRMSSD : _ht.rmssd != null ? _ht.rmssd : json.hrv ? json.hrv.rmssd : null;
    summary.sdnn = _ht.wholeRecordSDNN != null ? _ht.wholeRecordSDNN : _ht.sdnn != null ? _ht.sdnn : json.hrv ? json.hrv.sdnn : null;
    summary.lfhf = _hf.lfhf != null ? _hf.lfhf : json.hrv ? json.hrv.lfhf : null;
    summary.hrvWindow = 'wholeRecord';
    summary.hrvUnits = 'ms';
    summary.sdnnEpochMedian = _ht.sdnn != null ? _ht.sdnn : null; // the overnight display value (rep 5-min)
    summary.hrvQualityPct = _dig(json, ['quality', 'analyzablePct']); // gate motion/coverage-trashed HRV out of consensus
    summary.sdnnIndex = _ht.sdnnIndex != null ? _ht.sdnnIndex : null; // mean of per-5-min SDNN
    summary.rmssdEpochMedian = _ht.rmssd != null ? _ht.rmssd : null;
    // body-position / posture series (ACC) → array of {tMs, pos}
    summary.posture = _ecgPostureSeries(json, t0Ms);
    // T2: single-signal sleep-stage fractions for cross-node consistency checking.
    // (Absent when staging was suppressed for an ambulatory recording — never folded as 0.)
    if (!_sleepSuppressed && json.sleep && json.sleep.stageMinutes && json.sleep.totalSleepMin > 0) {
      var _sm = json.sleep.stageMinutes,
        _tot = json.sleep.totalSleepMin;
      summary.remFraction = _sm.REM != null ? +(_sm.REM / _tot).toFixed(3) : null;
      summary.deepFraction = _sm.Deep != null ? +(_sm.Deep / _tot).toFixed(3) : null;
      summary.stagingMethod = 'ECG cardiorespiratory (HRV + EDR), single-signal estimate';
    }
  }
  if (node === 'GlucoDex') {
    var f = json.fusion || {};
    // whole-wear CV — kept as a FALLBACK for legacy exports without timeseries.cells
    /* DEEP-AUDIT-2026-07-11 §13: GlucoDex's LIGHT ganglior export — the one users are told to drop into
       the Integrator — writes its metrics under `glucose{}` (the 2026-07-04 enrichment). This read-chain
       only knew the RICH summary's `glycemic{}`, so glucoseCV resolved to null on EVERY ganglior export,
       and fuseAutonomicGlycemic then published a glucose⟷autonomic coupling computed from the ECG slope
       ALONE — 0.44 with n=0 and no glucose value in it, surfaced as the "Autonomic⟷glycemic" KPI. */
    summary.glucoseCV =
      _dig(json, ['glucose', 'cv']) || _dig(json, ['glycemic', 'cv']) || _dig(json, ['variability', 'cv']) || _dig(json, ['glycemia', 'cv']) || (json.summary ? json.summary.cv : null);
    summary.dawnSurge =
      // GlucoDex's light export writes glucose.dawn.medianDelta (present ⇒ ≥20 mg/dL, dawnPhenomenon);
      // the older read chain pointed only at pre-enrichment keys (riseMgdl is per-EVENT meta, not the
      // summary) and so resolved null for EVERY GlucoDex export — the un-fixed sibling of the §13
      // glucose.cv read-drift. medianDelta first, then the legacy shapes.
      _dig(json, ['glucose', 'dawn', 'medianDelta']) ||
      _dig(json, ['glucose', 'dawn', 'riseMgdl']) ||
      _dig(json, ['fusion', 'dawnSurge']) ||
      _dig(json, ['dawn', 'surge']) ||
      (json.patterns && json.patterns.dawnPhenomenon ? json.patterns.dawnPhenomenon.medianRiseMgdl : null) ||
      null;
    summary.glucoseAutonomicCorrelation = json.reserved && json.reserved.glucoseAutonomicCorrelation != null ? json.reserved.glucoseAutonomicCorrelation : f.r != null ? f.r : null;
    summary.autonomicInstabilitySlope = json.reserved && json.reserved.autonomicInstabilitySlope != null ? json.reserved.autonomicInstabilitySlope : null;
    // CLAMP-SATURATION (GLUCODEX-FOLLOWUPS §2): a clipped CGM (Abbott Lingo 55–200, etc.) under-counts
    // below/above-range, so its clip-floor nocturnal_hypo events may be artifacts. Surface the fact +
    // DOWN-WEIGHT those events (the emitter stamps meta.clampFloor on the affected ones) so fusion trusts
    // them less. Absent clamp field (legacy/clean export) → null, no down-weight (back-compat).
    var _clamp = json.recording && json.recording.clamp;
    summary.clampSat =
      _clamp && _clamp.detected
        ? { vendor: _clamp.vendor || null, floor: _clamp.floor != null ? _clamp.floor : null, ceiling: _clamp.ceiling != null ? _clamp.ceiling : null, blindMetrics: _clamp.blindMetrics || [] }
        : null;
    if (_clamp && _clamp.detected) {
      for (var _ei = 0; _ei < events.length; _ei++) {
        var _ev = /** @type {any} */ (events[_ei]);
        if (_ev && _ev.impulse === 'nocturnal_hypo' && _ev.meta && _ev.meta.clampFloor) {
          // AUDIT-ONLY tag (NODE-RESIDUE-FOLLOWUPS-II §2, decided 2026-07-02): the conf ×0.5 on the next line is
          // the LOAD-BEARING down-weight (it flows through effConf → the noisy-OR → the posterior). clampFloor
          // itself is a provenance breadcrumb — grep-confirmed NOT read by fusion/render/export today — exactly
          // like the meta.derived note above. Do NOT assume it gates anything in the posterior until a reader + test land.
          _ev.clampFloor = true;
          if (typeof _ev.conf === 'number') _ev.conf = +(_ev.conf * 0.5).toFixed(3); // clip-floor hypo: trusted less (LOAD-BEARING)
        }
      }
    }
    // ── §3.1 INGEST the sliceable cell trace onto the floating axis ──────────
    // GlucoDex is ONE continuous node; cells[] let the Integrator window it to
    // each session's exact overlap. Cells carry absolute floating tMs → trust + sort,
    // no reconstruction. (Index-only cells reconstructed from t0Ms + idx·cadence.)
    var ts = json.timeseries || {};
    var t0c = ts.t0Ms != null ? ts.t0Ms : t0Ms;
    var cadMin = ts.cadenceMin != null ? ts.cadenceMin : null;
    seriesOut.cadenceMin = cadMin;
    seriesOut.cells = (Array.isArray(ts.cells) ? ts.cells : [])
      .map(function (cl) {
        return { tMs: cl.tMs != null ? cl.tMs : t0c != null && cl.i != null && cadMin != null ? t0c + cl.i * cadMin * 60000 : null, v: cl.v, f: cl.f != null ? cl.f : 0 };
      })
      .filter(function (cl) {
        return cl.tMs != null && cl.v != null;
      })
      .sort(function (a, b) {
        return a.tMs - b.tMs;
      });
    // a continuous CGM's true end is its last cell — extend the window so overlaps
    // against same-night ECG/Oxy sessions are computed against the whole wear.
    if (seriesOut.cells.length) {
      var lastCell = seriesOut.cells[seriesOut.cells.length - 1].tMs;
      endMs = endMs != null ? Math.max(endMs, lastCell) : lastCell;
    }
  }
  if (node === 'PulseDex' || node === 'HRVDex' || node === 'PpgDex') {
    // These nodes' bare hrv.time.{sdnn,rmssd} ARE whole-record (single-window or
    // short readings), so they're directly comparable to ECGDex's wholeRecord axis.
    summary.rmssd = _dig(json, ['hrv', 'time', 'rmssd']) || _dig(json, ['hrv', 'rmssd']) || _dig(json, ['metrics', 'rmssd']) || (json.rmssd != null ? json.rmssd : null);
    summary.sdnn = _dig(json, ['hrv', 'time', 'sdnn']) || _dig(json, ['hrv', 'sdnn']) || _dig(json, ['metrics', 'sdnn']) || (json.sdnn != null ? json.sdnn : null);
    summary.lfhf = _dig(json, ['hrv', 'frequency', 'lfhf']) || _dig(json, ['hrv', 'lfhf']) || (json.lfhf != null ? json.lfhf : null);
    summary.hrvWindow = 'wholeRecord';
    /* DEEP-AUDIT-2026-07-11 §14: HRVDex — THE HRV node — could never join the HRV consensus. Its export
       writes per-reading HRV under `measurements[]` (the 2026-07-04 SELF-INGEST enrichment); this chain
       only knew `hrv.time.*`, so summary.rmssd/sdnn were null on 100 % of HRVDex exports and
       fuseHRVConsensus's source filter dropped it every time — SILENTLY, with its rMSSD values sitting
       right there unread.
       Read them. But label the window HONESTLY: a Welltory capture is a short spot reading, and an
       export spans many of them, so their median is NOT the same quantity as an overnight whole-record
       rMSSD. Calling it 'wholeRecord' would let R8's like-window guard compare a month of morning
       readings against one night's ECG — a false comparison dressed as a consensus. It is tagged
       'measurementMedian' instead, which the guard then reports as a REASONED, VISIBLE exclusion
       (crossWindowExcluded) rather than the silent null it used to be. */
    if (summary.rmssd == null && Array.isArray(json.measurements) && json.measurements.length) {
      var _msd = json.measurements
        .filter(function (m) {
          return m && m.sdnn != null;
        })
        .map(function (m) {
          return m.sdnn;
        });
      var _mrm = json.measurements
        .filter(function (m) {
          return m && m.rmssd != null;
        })
        .map(function (m) {
          return m.rmssd;
        });
      var _med = function (a) {
        if (!a.length) return null;
        var b = a.slice().sort(function (x, y) {
          return x - y;
        });
        var h = b.length >> 1;
        return +(b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2).toFixed(2);
      };
      if (_mrm.length) summary.rmssd = _med(_mrm);
      if (_msd.length) summary.sdnn = _med(_msd);
      if (summary.rmssd != null || summary.sdnn != null) {
        summary.hrvWindow = 'measurementMedian';
        summary.hrvWindowNote = 'median of ' + json.measurements.length + ' spot readings — NOT an overnight whole-record value; not directly comparable to a wholeRecord HRV axis.';
      }
    }
    var _hq = _dig(json, ['quality', 'analyzablePct']);
    if (_hq == null) _hq = _dig(json, ['quality', 'coveragePct']);
    if (_hq == null) _hq = _dig(json, ['recording', 'coveragePct']);
    summary.hrvQualityPct = _hq;
    summary.hrvUnits = 'ms';
    // FU §2: the node self-reports a coverage/SQI lowConfidence flag on its whole-record HRV
    // (PpgDex §3 gate; harmless null→false for PulseDex/HRVDex) — carried onto the summary so the
    // HRV-consensus can down-weight a sparse night even when its analyzablePct clears QFLOOR.
    summary.hrvLowConfidence = !!_dig(json, ['hrv', 'time', 'lowConfidence']);
    // PpgDex carries limb-worn ACC posture (lower reliability than a chest strap) —
    // expose it as a posture series so it can be a positional-apnea FALLBACK when no
    // ECGDex chest-ACC is present. Tagged via postureSource so the fusion down-weights it.
    if (node === 'PpgDex') {
      summary.posture = _ecgPostureSeries(json, t0Ms);
      summary.postureSource = 'limb-acc';
      // FU §2: 3-LED optical consensus (% of kept beats where ≥2/3 channels agree) — a whole-
      // record optical trust axis folded into the HRV-consensus gate alongside the per-event floor.
      summary.ledAgreementPct = _dig(json, ['quality', 'ledAgreementPct']);
      // SQI FLOOR (NODE-RESIDUE-FOLLOWUPS §3): categorically down-weight UNUSABLE-quality PpgDex
      // events (a noisy autonomic_surge / motion_artifact_segment is trusted less), MIRRORING the
      // GlucoDex clamp-floor loop above. effConf already tapers a surge PROPORTIONALLY by sqi in the
      // noisy-OR; this adds a hard floor for the noisy tail so a beat window too noisy to trust barely
      // corroborates. sqi PRESERVED (R7 — rides alongside conf); sqi==null / ≥floor → untouched.
      // NO SYMMETRIC ECGDex FLOOR — INTENTIONAL, not an oversight (NODE-RESIDUE-FOLLOWUPS-II §1, decided
      // 2026-07-02). ECGDex surges ALSO carry per-event sqi and effConf already tapers them proportionally,
      // but the categorical floor is PpgDex-ONLY on purpose: PpgDex is limb-worn OPTICAL (Polar Verity Sense),
      // motion-prone, its sqi legitimately dips into the unusable tail → the extra categorical distrust is
      // warranted; ECGDex is a CHEST STRAP (Polar H10) whose sqi rarely reaches < PPG_SQI_FLOOR on a real
      // recording, so a floor would almost never fire and effConf's smooth taper suffices. Different sensor
      // physics → different treatment; deliberately NOT a shared NODE_SQI_FLOOR table. See EVENT-LEXICON §6.10.
      for (var _pi = 0; _pi < events.length; _pi++) {
        var _pe = /** @type {any} */ (events[_pi]);
        if (_pe && _pe.sqi != null && isFinite(_pe.sqi) && _pe.sqi < PPG_SQI_FLOOR) {
          // AUDIT-ONLY tag (NODE-RESIDUE-FOLLOWUPS-II §2): the conf ×0.5 on the next line is the LOAD-BEARING
          // down-weight (flows through effConf → noisy-OR → posterior); sqiFloor is a provenance breadcrumb,
          // grep-confirmed NOT read by fusion/render/export today — mirrors the meta.derived note above.
          _pe.sqiFloor = true;
          if (typeof _pe.conf === 'number') _pe.conf = +(_pe.conf * 0.5).toFixed(3); // unusable-SQI PPG event: trusted less (LOAD-BEARING)
        }
      }
    }
  }
  if (node === 'CPAPDex') {
    // PAP therapy node-export. metrics = night-level pooled surface; the
    // device-scored apnea/hypopnea ganglior_events are the strongest AHI on the
    // bus, so estAHI is published as device-scored (not a CVHR/desat estimate).
    var cm = json.metrics || {};
    summary.residualAHI = cm.residualAHI != null ? cm.residualAHI : null;
    summary.centralIndex = cm.centralIndex != null ? cm.centralIndex : null;
    summary.obstructiveIndex = cm.obstructiveIndex != null ? cm.obstructiveIndex : null;
    summary.hypopneaIndex = cm.hypopneaIndex != null ? cm.hypopneaIndex : null;
    summary.periodicBreathingPct = cm.periodicBreathingPct != null ? cm.periodicBreathingPct : null;
    summary.largeLeakPct = cm.largeLeakPct != null ? cm.largeLeakPct : null;
    summary.medianPressure = cm.medianPressure != null ? cm.medianPressure : null;
    summary.therapyHours = json.recording && json.recording.therapyHours != null ? json.recording.therapyHours : null;
    // §6 (DEEP-AUDIT-2026-07-14): honor the NODE's night-level mode, never resurrect sessions[0].mode — the
    // per-session label CPAPDex deliberately retired (it flipped 7× across 182 real nights; the node forces
    // metrics.mode=null). Reading sessions[0].mode surfaced a value the node chose to null.
    summary.mode = json.metrics && json.metrics.mode != null ? json.metrics.mode : null;
    summary.estAHI = cm.residualAHI != null ? cm.residualAHI : null; // device-scored AHI — strongest apnea truth in the bus
    summary.ahiSource = 'device-scored';
    // body-position passthrough if a future PAP firmware embeds it in event meta
    summary.posture = _ecgPostureSeries(json, t0Ms);
  }
  // TCH (INTEGRATOR-THREE-CORNERED-HAT §1): carry the per-epoch HRV/HR SERIES so the
  // fusion layer can run a three-cornered-hat across nodes (TCH needs aligned series,
  // not the whole-record scalars above). motion = per-epoch motionIndex (the co-motion
  // proxy for the correlated-TCH rho, finding §1). Additive + null-tolerant; a node with
  // no epoch grid simply carries no series and TCH degrades to pairwise consensus.
  var _tchEps = json.timeseries && json.timeseries.epochs;
  if (Array.isArray(_tchEps) && _tchEps.length) {
    seriesOut.hrvEpochs = _tchEps
      .map(function (e) {
        if (!e) return null;
        var tMin = e.tMin != null ? e.tMin : e.t != null ? e.t : null;
        if (tMin == null || !isFinite(tMin)) return null;
        return {
          tMin: tMin,
          tMs: t0Ms != null ? t0Ms + tMin * 60000 : null,
          rmssd: e.rmssd != null && isFinite(e.rmssd) ? e.rmssd : null,
          hr: e.hr != null && isFinite(e.hr) ? e.hr : null,
          motion: e.motionIndex != null && isFinite(e.motionIndex) ? e.motionIndex : null
        };
      })
      .filter(function (x) {
        return x;
      });
  }
  return [
    {
      node: node,
      label: node + (t0Ms != null ? ' · ' + fmtDayShort(t0Ms) : ' · date unknown'),
      dateStr: t0Ms != null ? fmtDate(t0Ms) : null,
      t0Ms: t0Ms,
      endMs: endMs,
      offsetMin: offsetMin,
      dateUnknown: dateUnknown,
      events: events,
      series: seriesOut,
      summary: summary,
      nEvents: events.length,
      // P8/kernel: carry the source build's physiology-kernel stamp so the fusion can
      // detect a node built against a DIFFERENT rulebook (cross-deployment drift).
      kernelHash: _kernelHash(json.kernel),
      kernelVersion: _kernelVersion(json.kernel),
      // P9: retain ONLY the raw event array (the sole downstream consumer is _recSig's
      // stampless-dedup signature). Storing the whole `json` kept multi-MB timeseries /
      // morphology arrays alive per recording — and duplicated series.cells (already in
      // seriesOut) — bloating memory on large / multi-night batches. Slim it.
      // EXPORT-IDENTITY-FOLLOWUPS-II §1: carry the identity-free recording.contentId so dedupeRecs can
      // dedup on exact content identity (strongest signal) when the emitter stamped one; null = legacy export.
      contentId: (json.recording && json.recording.contentId) || null,
      raw: { ganglior_events: json.ganglior_events || json.events || null },
      _src: filename
    }
  ];
}

function _dig(o, path) {
  var c = o;
  for (var i = 0; i < path.length; i++) {
    if (c == null) return null;
    c = c[path[i]];
  }
  return c == null ? null : c;
}

/* ECGDex body-position series from acc / sleepStages.posture / timeseries posture. */
function _ecgPostureSeries(json, t0Ms) {
  var out = [];
  var acc = json.acc || (json.timeseries && json.timeseries.acc) || null;
  function push(tMin, pos) {
    if (pos == null) return;
    var tMs = t0Ms != null && tMin != null ? t0Ms + tMin * 60000 : null;
    out.push({ tMs: tMs, tMin: tMin, pos: String(pos).toLowerCase() });
  }
  if (Array.isArray(acc)) {
    acc.forEach(function (a) {
      push(a.tMin != null ? a.tMin : a.t, a.position || a.pos || a.bodyPosition);
    });
  }
  // PRIMARY source: the dense per-5-min epoch grid (ECGDex/PpgDex write
  // timeseries.epochs[].position). 'unknown' is skipped so it never outvotes a
  // real posture at the nearest-neighbour lookup.
  var eps = json.timeseries && json.timeseries.epochs;
  if (Array.isArray(eps)) {
    eps.forEach(function (e) {
      if (e && e.position && e.position !== 'unknown') push(e.tMin, e.position);
    });
  }
  // also accept position events embedded in ganglior_events meta
  if (Array.isArray(json.ganglior_events)) {
    json.ganglior_events.forEach(function (e) {
      var p = e.meta && (e.meta.position || e.meta.pos || e.meta.bodyPosition);
      if (p) {
        var tMs = reconstructEventTMs(e, t0Ms);
        if (tMs != null) out.push({ tMs: tMs, pos: String(p).toLowerCase() });
      }
    });
  }
  out.sort(function (a, b) {
    return (a.tMs || 0) - (b.tMs || 0);
  });
  return out;
}

/* OxyDex summary export = ARRAY of nights. Each night → its own NodeRec.
   v2.0 ENVELOPE (OXYDEX-NODE-EXPORT-ENVELOPE-2026-06-27): when the export carries a TOP-LEVEL
   ganglior_events[] (desat_event + periodic_breathing, the real node emission), that stream is
   AUTHORITATIVE — partition it by night window and use it verbatim (Clock-Contract round-trip:
   tMs is read back unchanged). LEGACY exports (bare per-night array, or a single night with no
   top-level events) fall through to per-night SYNTHESIS of desat_event (from desatProfile.events)
   + autonomic_arousal (from hr_spikes). The tolerant reader accepts BOTH Array.isArray(json) (legacy)
   and json.nights[] (envelope), normalizing to nights[] internally — old fixtures keep ingesting. */
function adaptOxyDex(json, filename) {
  var _topKernel = json && !Array.isArray(json) && json.kernel ? json.kernel : null;
  var nights = Array.isArray(json) ? json : Array.isArray(json.nights) ? json.nights : [json];
  // v2.0: the top-level ganglior_events[] (if present) is the authoritative stream. Normalize it
  // ONCE, then bucket each event to exactly one night (the latest-starting night whose [t0Ms,endMs]
  // window contains its tMs) so a multi-night export can't double-count an event across nights.
  var _topT0 = json && !Array.isArray(json) && json.recording && json.recording.startEpochMs != null ? json.recording.startEpochMs : null;
  var _topEvents =
    json && !Array.isArray(json) && Array.isArray(json.ganglior_events) && json.ganglior_events.length
      ? _eventsFromEnvelope({ ganglior_events: json.ganglior_events, startEpochMs: _topT0 }, 'OxyDex').events
      : null;
  var _eventBuckets = null;
  if (_topEvents) {
    var _wins = nights.map(function (nn) {
      var s = nn && nn.t0Ms != null ? nn.t0Ms : nn && nn.stats && nn.stats.t0Ms != null ? nn.stats.t0Ms : nn && nn.stats ? nn.stats.startTs : null;
      var dm = nn && nn.stats && nn.stats.durationMin != null ? nn.stats.durationMin * 60000 : null;
      return { s: s, e: s != null && dm != null ? s + dm : null };
    });
    _eventBuckets = nights.map(function () {
      return [];
    });
    _topEvents.forEach(function (e) {
      if (e.tMs == null) return;
      var best = -1,
        bestS = -Infinity;
      for (var wi = 0; wi < _wins.length; wi++) {
        var w = _wins[wi];
        if (w.s == null || e.tMs < w.s) continue;
        if (w.e != null && e.tMs > w.e) continue;
        if (w.s > bestS) {
          bestS = w.s;
          best = wi;
        }
      }
      // no window strictly contains it → attach to the latest night starting at/before it
      if (best < 0) {
        for (var wj = 0; wj < _wins.length; wj++) {
          var w2 = _wins[wj];
          if (w2.s != null && e.tMs >= w2.s && w2.s > bestS) {
            bestS = w2.s;
            best = wj;
          }
        }
      }
      if (best >= 0) _eventBuckets[best].push(e);
    });
  }
  var recs = [];
  nights.forEach(function (n, ni) {
    if (!n || typeof n !== 'object') return;
    var t0Ms = n.t0Ms != null ? n.t0Ms : n.stats && n.stats.t0Ms != null ? n.stats.t0Ms : n.stats ? n.stats.startTs : null;
    var stats = n.stats || {};
    var nSamp = stats.n || 0;
    var durMs = stats.durationMin != null ? stats.durationMin * 60000 : null;
    var dt = durMs && nSamp ? durMs / nSamp : 1000; // O2Ring ≈ 1 Hz
    var endMs = t0Ms != null && durMs != null ? t0Ms + durMs : null;
    var events = [];
    // 0) v2.0 envelope: this night's slice of the authoritative top-level ganglior_events[]
    if (_topEvents) {
      events = (_eventBuckets[ni] || []).slice();
      // 1) native PER-NIGHT ganglior events (legacy emit-shim that wrote events into a night)
    } else if (Array.isArray(n.ganglior_events) && n.ganglior_events.length) {
      var rr = _eventsFromEnvelope({ ganglior_events: n.ganglior_events, startEpochMs: t0Ms }, 'OxyDex');
      events = rr.events;
    } else {
      // 2) synthesize desaturation events from the desat profile
      var dp = n.desatProfile || n.desat || null;
      var devs = dp && Array.isArray(dp.events) ? dp.events : [];
      devs.forEach(function (d) {
        if (d.artifact) return; // Part A: self-gated artifact desats are never emitted as ganglior_events
        var idx = d.nadirIdx != null ? d.nadirIdx : d.startIdx != null ? d.startIdx : null;
        if (idx == null || t0Ms == null) return;
        var tMs = t0Ms + idx * dt;
        var depth = d.depth != null ? d.depth : null;
        var conf = clamp(0.45 + (depth != null ? Math.min(depth, 12) / 24 : 0.1), 0.4, 0.95);
        // EVENT-LEXICON §1/§5: canonical desat impulse is `desat_event` (was `spo2_desaturation`).
        // The Integrator now surfaces ONE desat name for OxyDex whether it read a v2.0 stream or
        // synthesized one from a legacy bare array. Fusion still gathers both names (back-compat).
        events.push({ tMs: tMs, t: fmtClockS(tMs), impulse: 'desat_event', node: 'OxyDex', conf: +conf.toFixed(2), meta: { depth: depth, nadir: d.nadir, durSec: d.duration, recovery: d.recovery } });
      });
      // 3) synthesize autonomic arousals from HR spikes
      var hs = n.hr_spikes || null;
      var sevs = hs && Array.isArray(hs.events) ? hs.events : Array.isArray(n.spikes) ? n.spikes : [];
      sevs.forEach(function (sp) {
        var p = parseTimestamp(sp.time, { dateAnchorMs: t0Ms, prevTMs: t0Ms, preferDMY: true });
        var tMs = p ? p.tMs : sp.idx != null && t0Ms != null ? t0Ms + sp.idx * dt : null;
        if (tMs == null) return;
        var rise = sp.peak != null && sp.baseline != null ? sp.peak - sp.baseline : null;
        var conf = clamp(0.4 + (rise != null ? Math.min(rise, 40) / 80 : 0.15), 0.4, 0.9);
        events.push({
          tMs: tMs,
          t: fmtClockS(tMs),
          impulse: 'autonomic_arousal',
          node: 'OxyDex',
          conf: +conf.toFixed(2),
          meta: { peak: sp.peak, baseline: sp.baseline, rise: rise, mfm: sp.mfm, spo2: sp.spo2 }
        });
      });
    }
    events.sort(function (a, b) {
      return a.tMs - b.tMs;
    });
    var summary = {
      odi4: n.odi4 ? n.odi4.rate : null,
      minSpo2: stats.minSpo2,
      meanSpo2: stats.meanSpo2,
      durationMin: stats.durationMin,
      hypoxicBurden: n.hb ? n.hb.rate : null,
      desatCount: events.filter(function (e) {
        return e.impulse === 'spo2_desaturation' || e.impulse === 'desat_event';
      }).length
    };
    // T2: oximetry REM proxy for cross-node staging consistency (single-signal estimate).
    // DEEP-AUDIT-2026-07-11 §7: the node now self-reports `plausible:false` when its HR-stability REM
    // estimator over-fires on quiet sleep (>30 % of the recording — every real night in the corpus). An
    // implausible proxy is NOT a comparable single-signal estimate, so it must not be folded into the
    // staging consensus as one; feeding it in would manufacture a "staging_disagreement" out of a known
    // node-side failure. Absent (not 0) — the same rule the ambulatory-suppression path already follows.
    // The ceiling is re-checked HERE, not just trusted from the flag, so a LEGACY export (emitted before
    // the node self-reported plausibility) is judged on its own number rather than folded in blind.
    var _sp = (n.newMetrics && n.newMetrics.stageProxy) || n.stageProxy || null;
    var _remImplausible = !!_sp && (_sp.plausible === false || (_sp.remProxyPct != null && _sp.remProxyPct > 30));
    if (_sp && _sp.remProxyPct != null && !_remImplausible) {
      summary.remFraction = +(_sp.remProxyPct / 100).toFixed(3);
      summary.deepFraction = _sp.nremDeepPct != null ? +(_sp.nremDeepPct / 100).toFixed(3) : null;
      summary.stagingMethod = 'SpO₂/PR oximetry proxy, single-signal estimate';
    } else if (_remImplausible) {
      summary.stagingSuppressed = _sp.plausibilityNote || 'oximetry REM proxy implausible (' + _sp.remProxyPct + '% of the recording)';
    }
    recs.push({
      uid: 'OxyDex@' + (t0Ms || 'n' + ni),
      node: 'OxyDex',
      label: 'OxyDex · ' + (t0Ms != null ? fmtDayShort(t0Ms) : n.date || 'night ' + (ni + 1)),
      dateStr: n.date || (t0Ms != null ? fmtDate(t0Ms) : null),
      t0Ms: t0Ms,
      endMs: endMs,
      offsetMin: null,
      dateUnknown: t0Ms == null,
      events: events,
      series: { sampleDt: dt },
      summary: summary,
      kernelHash: _kernelHash(n.kernel || _topKernel),
      kernelVersion: _kernelVersion(n.kernel || _topKernel),
      contentId: n.contentId != null ? n.contentId : null, // EXPORT-IDENTITY-FOLLOWUPS-II §1 (per-night identity-free handle)
      nEvents: events.length,
      raw: n,
      _src: filename
    });
  });
  return recs;
}

/* ── Top-level normalize: returns { recs:[NodeRec], warnings:[] } ──────────── */
function normalizeFile(json, filename) {
  var warnings = [];
  if (json == null) {
    return { recs: [], warnings: ['Empty or unreadable JSON — skipped'] };
  }
  // bus check (input only — never reject on bus name)
  var busVal = json.bus || (json.schema && json.schema.bus) || null;
  if (!busOK(busVal)) {
    warnings.push('Unknown bus "' + busVal + '" — accepting anyway (case-insensitive)');
  }
  var node = detectNode(json, filename);
  // ── R2 GUARD: every recognized node must resolve to a registered color + a
  //    summary adapter, or it silently becomes grey "Unknown" and drops out of
  //    fusion (the PpgDex bug). Surface it loudly instead of failing quietly. ──
  var KNOWN_NODES = ['ECGDex', 'OxyDex', 'GlucoDex', 'PulseDex', 'PpgDex', 'HRVDex', 'CPAPDex'];
  if (node !== 'Unknown' && KNOWN_NODES.indexOf(node) < 0) {
    warnings.push('Node "' + node + '" is not registered in the Integrator (no color / summary adapter) — ' + 'it will load but be excluded from fusion. Add it to NODE_COLORS + the summary branch.');
  }
  // ── SUMMARY-SHAPE GUARD ──────────────────────────────────────────────────
  // A node's flat metrics "summary" export (e.g. PulseDex's Export-JSON button →
  // PulseDex_*_summary.json = the raw lastResult) carries top-level t0Ms +
  // windows/durMin but NO ganglior_events / recording / kernel envelope. With the
  // window fallback above it can still be placed on the clock + read for whole-
  // record HRV, but it has NO events to fuse — and silently loading it as an empty
  // node is exactly how PulseDex "vanished" from a night. Warn loudly and point at
  // the Ganglior export button. Non-destructive: the file is still adapted below.
  var _looksSummary =
    json &&
    !Array.isArray(json) &&
    !json.ganglior_events &&
    !json.fascia_events &&
    !json.events &&
    !json.recording &&
    json.t0Ms != null &&
    (Array.isArray(json.windows) || json.nWindows != null || json.durMin != null);
  if (_looksSummary && node !== 'Unknown') {
    warnings.push(
      '"' +
        (filename || node) +
        '" looks like a ' +
        node +
        ' SUMMARY export (flat metrics: ' +
        'has t0Ms + windows but no ganglior_events / recording envelope). It will load with a ' +
        "window + whole-record HRV but contributes NO events to fuse. Re-export via the node's " +
        '“Ganglior” button (→ *_ganglior.json) to fuse its events.'
    );
  }
  try {
    if (node === 'OxyDex' && (Array.isArray(json) || json.desatProfile || json.hr_spikes || json.nights)) {
      return { recs: adaptOxyDex(json, filename), warnings: warnings };
    }
    // §2 (DEEP-AUDIT-2026-07-14): a MULTI-NIGHT wrapper carries its per-night node-exports under
    // nights[] and NO top-level recording / ganglior_events / metrics. Only OxyDex (above) unwrapped
    // nights[]; a CPAPDex ≥3-night Export fell through to the flat adaptEnvelopeNode below, which read
    // an empty envelope → one date-unknown rec, no events, null device-scored AHI, and NO warning — the
    // strongest apnea truth on the bus silently gone. Unwrap ANY schema.multiNight wrapper generically:
    // each night is itself a full single-night node-export, adapted like any other envelope, so every
    // multi-night emitter is handled like OxyDex (whose own nights[]-aware adapter runs above).
    if (node !== 'Unknown' && Array.isArray(json.nights) && json.schema && json.schema.multiNight) {
      var mnRecs = [];
      for (var _ni = 0; _ni < json.nights.length; _ni++) {
        var _nightRecs = adaptEnvelopeNode(json.nights[_ni], node, filename);
        if (_nightRecs && _nightRecs.length) mnRecs = mnRecs.concat(_nightRecs);
      }
      return { recs: mnRecs, warnings: warnings };
    }
    if (node === 'Unknown' && !json.ganglior_events && !json.events && !json.fascia_events) {
      return { recs: [], warnings: warnings.concat(['"' + (filename || 'file') + '" — unrecognized format, no events found; skipped']) };
    }
    return { recs: adaptEnvelopeNode(json, node, filename), warnings: warnings };
  } catch (err) {
    return { recs: [], warnings: warnings.concat(['"' + (filename || 'file') + '" — parse error: ' + err.message]) };
  }
}

/* ── §2.4 de-dupe: dated → same node + startEpochMs within ±30 s; stampless →
   same node + identical content signature (event count + first/last event clock).
   The stampless path closes a silent bug: file / file (1) / file (2) copies of a
   DATE-UNKNOWN recording have t0Ms=null every time, slipped the ±30 s guard, and
   were counted N times — inflating node lists, event/burden totals, and exports. */
function _recSig(r) {
  // content fingerprint for a STAMPLESS recording (no clock to dedupe on).
  // Uses RAW events (which survive even when normalized events are dropped for
  // lacking a reconstructable tMs) + summary HRV, NOT the filename (_src) — file /
  // file (1) differ there but are the SAME recording. Two genuinely different
  // stampless recordings won't collide; re-loaded copies will.
  var raw = r.raw || {};
  var ev = raw.ganglior_events || raw.events || r.events || [];
  var first = ev.length ? ev[0].t || ev[0].tMs || '' : '';
  var last = ev.length ? ev[ev.length - 1].t || ev[ev.length - 1].tMs || '' : '';
  var rm = r.summary && r.summary.rmssd != null ? r.summary.rmssd : '';
  var sd = r.summary && r.summary.sdnn != null ? r.summary.sdnn : '';
  return r.node + '|n' + ev.length + '|' + first + '→' + last + '|' + rm + '/' + sd;
}
function dedupeRecs(existing, incoming) {
  var kept = [],
    warns = [];
  incoming.forEach(function (nr) {
    var nsig = nr.t0Ms == null ? _recSig(nr) : null;
    var dup = existing.concat(kept).find(function (e) {
      if (e.node !== nr.node) return false;
      // EXPORT-IDENTITY-FOLLOWUPS-II §1: when BOTH carry an identity-free recording.contentId, that
      // content digest is the STRONGEST duplicate signal — same node + same contentId = the same
      // recording regardless of stamp (catches a re-load / cross-stamp dup the ±30 s and stampless-sig
      // heuristics can miss). Absent on either side → fall back to the stamp / sig rules (full back-compat).
      if (e.contentId && nr.contentId) return e.contentId === nr.contentId;
      if (e.t0Ms != null && nr.t0Ms != null) return Math.abs(e.t0Ms - nr.t0Ms) <= 30000; // dated: ±30 s
      if (e.t0Ms == null && nr.t0Ms == null) return _recSig(e) === nsig; // stampless: content sig
      return false;
    });
    if (dup) {
      warns.push(nr.label + ' looks like a duplicate of an already-loaded recording — skipped');
    } else kept.push(nr);
  });
  return { kept: kept, warns: warns };
}

/* ════════════════════════════════════════════════════════════════════════
   §4 OVERLAP DETECTION
   ════════════════════════════════════════════════════════════════════════ */
function recWindow(r) {
  if (r.t0Ms == null) return null;
  var end = r.endMs != null ? r.endMs : r.events.length ? r.events[r.events.length - 1].tMs : r.t0Ms;
  return { startMs: r.t0Ms, endMs: Math.max(end, r.t0Ms) };
}
function overlapInterval(a, b) {
  var wa = recWindow(a),
    wb = recWindow(b);
  if (!wa || !wb) return null;
  // same-day different-timezone: align on real instants only when BOTH offsets present AND differ
  var sa = wa.startMs,
    ea = wa.endMs,
    sb = wb.startMs,
    eb = wb.endMs,
    basis = 'wall-clock';
  if (a.offsetMin != null && b.offsetMin != null && a.offsetMin !== b.offsetMin) {
    sa -= a.offsetMin * 60000;
    ea -= a.offsetMin * 60000;
    sb -= b.offsetMin * 60000;
    eb -= b.offsetMin * 60000;
    basis = 'utc-instant';
  }
  var s = Math.max(sa, sb),
    e = Math.min(ea, eb);
  if (e <= s) return null;
  return { startMs: Math.max(wa.startMs, wb.startMs), endMs: Math.min(wa.endMs, wb.endMs), overlapMin: +((e - s) / 60000).toFixed(1), basis: basis };
}

/* ════════════════════════════════════════════════════════════════════════
   §5 FUSION RULES — each independently skippable; evidence-based.
   ════════════════════════════════════════════════════════════════════════ */
function _byNode(recs, node) {
  return recs.filter(function (r) {
    return r.node === node && !r.dateUnknown;
  });
}
function _eventsOfType(rec, types) {
  return rec.events.filter(function (e) {
    return types.indexOf(e.impulse) >= 0;
  });
}

/* ════ CONSEQUENCE-COROBORATION · Part B (oximeter self-gate brief) ══════════
   A real systemic desaturation FORCES a compensatory tachycardia / sympathetic
   surge on ANY live HR node (and usually an arousal). This is NOT a headcount
   vote — it is a capability + consequence filter:
     · capability — only sensors that can observe the event OR its obligate
       consequence vote. Green-LED PPG carries no SpO₂ value to corroborate WITH,
       but it can still REFUTE the event via the HR consequence.
     · lone truths are real — a genuine isolated desat (only an oximeter worn)
       is never discarded; with no live HR witness it reads 'unconfirmed-desat'.
   This is an ADDITIONAL gate on `desat` findings; the apnea match window
   (LEAD=15 / TRAIL=60, R4) is left untouched. R7: it affects the verdict/publish
   decision only and never retro-edits `conf` (down-weighting still flows through
   effConf = conf × (sqi ?? 1)). */
var CONSEQUENCE = { SURGE_WIN_SEC: 30, EXPECT_DEPTH_PCT: 4 };
// HR-source authority ladder (capability filter, §6): chest ECG is the most
// reliable HR/bpm source, then the pulse-oximeter pulse rate, then green-LED PPG.
// Used to pick the witness for consequence-corroboration AND for graceful HR/bpm
// degradation when a higher-authority source drops out (Part C).
var HR_AUTHORITY = { ECGDex: 1, PulseDex: 2, OxyDex: 2, PpgDex: 3 };
function pickHRAuthority(hrNodesLive) {
  if (!Array.isArray(hrNodesLive) || !hrNodesLive.length) return null;
  var ranked = hrNodesLive
    .filter(function (h) {
      return h && HR_AUTHORITY[h.node] != null;
    })
    .slice()
    .sort(function (a, b) {
      return HR_AUTHORITY[a.node] - HR_AUTHORITY[b.node];
    });
  return ranked.length ? ranked[0] : null;
}
function corroborateDesat(desat, hrNodesLive) {
  if (!desat) return desat;
  if (desat.artifact) {
    desat.verdict = 'artifact';
    return desat;
  } // already self-gated at the node
  var onset = desat.tMs != null ? desat.tMs : desat.onsetMs;
  var depth = desat.depthPct != null ? desat.depthPct : desat.meta && desat.meta.depth != null ? desat.meta.depth : desat.meta && desat.meta.desatDepth != null ? desat.meta.desatDepth : desat.depth;
  var expectSurge = depth != null && depth >= CONSEQUENCE.EXPECT_DEPTH_PCT; // meaningful desats demand an HR response
  var hrNode = pickHRAuthority(hrNodesLive); // ECG > pulse-ox > PPG
  if (hrNode) {
    var w0 = onset,
      w1 = onset + CONSEQUENCE.SURGE_WIN_SEC * 1000;
    var surges = hrNode.surges || [];
    var surge =
      onset != null &&
      surges.some(function (s) {
        var t = s != null && s.tMs != null ? s.tMs : s;
        return t != null && t >= w0 && t <= w1;
      });
    if (expectSurge && !surge) {
      desat.verdict = 'artifact-no-consequence';
    } // depth demanded a surge; none came ⇒ drop
    else {
      desat.verdict = 'confirmed';
    }
    desat.hrWitness = hrNode.node;
  } else {
    desat.verdict = 'unconfirmed-desat'; // real-or-not unknowable; never publish the nadir as truth
  }
  return desat;
}

/* 1 — desat ⟷ autonomic surge ⇒ confirmed_apnea_event (the headline). */
function fuseApneaEvents(recs, dtMs, gate) {
  // CARDIAC surge sources: ECGDex (primary) + PpgDex (PPG-derived). A desat is
  // confirmable by an autonomic surge from EITHER — PpgDex is a first-class node
  // here, not silently dropped (R2). OxyDex anchors the desaturation.
  /* DEEP-AUDIT-2026-07-11 §15: the desaturation pool was keyed by NODE (`_byNode(recs,'OxyDex')`), not by
     IMPULSE. EVENT-LEXICON.md is explicit that impulses are keyed by the EVENT, not the signal that
     observed it, and it lists CPAPDex as a first-class `desat_event` emitter (it was deliberately migrated
     desat → desat_event to join this very pool). It could not: a CPAP+ECG night produced fusion.apnea =
     null. Metamorphic proof: a byte-identical desat_event stream changes only its `node` label and the
     whole rule vanishes. Pool by the events a record actually CARRIES — any node that observes a
     desaturation can corroborate one. (The per-node confidence tiering downstream is unchanged.) */
  var DESAT_TYPES = ['spo2_desaturation', 'desat_event'];
  var oxy = recs.filter(function (r) {
    return !r.dateUnknown && _eventsOfType(r, DESAT_TYPES).length;
  });
  var ecg = _byNode(recs, 'ECGDex'),
    ppg = _byNode(recs, 'PpgDex');
  var cardiac = ecg.concat(ppg);
  if (!oxy.length || !cardiac.length) return null;
  // ── R5 DIRECTIONALITY GATE ───────────────────────────────────────────────
  // An obstructive event's autonomic surge should COINCIDE-OR-TRAIL the SpO₂
  // nadir (it may lead only slightly as effort ramps). Asymmetric window, in
  // SECONDS: latencySec = (surge − desat)/1000 must satisfy −lead ≤ lat ≤ +trail.
  gate = gate || {};
  var leadMaxSec = gate.leadMaxSec != null ? gate.leadMaxSec : 15;
  var trailMaxSec = gate.trailMaxSec != null ? gate.trailMaxSec : 60;

  // ── Build the MERGED UNION of every OxyDex × (ECGDex|PpgDex) overlap interval.
  //    Using a union (not the sum of pairwise overlaps) means a single OxyDex
  //    night overlapping two cardiac recordings is counted ONCE — no
  //    double-counting of events and no inflated AHI denominator. ────────────
  var raw = [];
  oxy.forEach(function (o) {
    cardiac.forEach(function (g) {
      var w = overlapInterval(o, g);
      if (w) raw.push([w.startMs, w.endMs]);
    });
  });
  if (!raw.length)
    return {
      findings: [],
      confirmedAHI: null,
      confirmedAHIReportable: false,
      overlapHours: 0,
      apneaAuthority: _deviceScoredAuthority(recs, null),
      matched: { desat: 0, surge: 0 },
      total: { desat: 0, surge: 0 },
      unmatched: { desat: [], surge: [] },
      nullModel: { expectedConfirmed: 0, pAtLeastObserved: 1, belowChance: true, surgeRatePerHr: 0, directionalWindowSec: leadMaxSec + trailMaxSec },
      coupling: null
    };
  raw.sort(function (a, b) {
    return a[0] - b[0];
  });
  var merged = [raw[0].slice()];
  for (var ri = 1; ri < raw.length; ri++) {
    var last = merged[merged.length - 1],
      cur = raw[ri];
    if (cur[0] <= last[1])
      last[1] = Math.max(last[1], cur[1]); // overlap → extend
    else merged.push(cur.slice()); // disjoint → new interval
  }
  var totHrs = 0;
  merged.forEach(function (iv) {
    totHrs += (iv[1] - iv[0]) / 3600000;
  });
  function inUnion(tMs) {
    for (var i = 0; i < merged.length; i++) {
      if (tMs >= merged[i][0] - dtMs && tMs <= merged[i][1] + dtMs) return true;
    }
    return false;
  }

  // ── Gather ALL desats / surges inside the union, then DEDUPE identical events
  //    (same impulse + tMs within 1 s) so the same night seen via two ECG
  //    recordings can't enter the pool twice. ────────────────────────────────
  function gather(recList, types) {
    var pool = [],
      seen = {};
    recList.forEach(function (r) {
      _eventsOfType(r, types).forEach(function (e) {
        if (!inUnion(e.tMs)) return;
        var key = e.impulse + '@' + Math.round(e.tMs / 1000);
        if (seen[key]) return;
        seen[key] = 1;
        pool.push(e);
      });
    });
    pool.sort(function (a, b) {
      return a.tMs - b.tMs;
    });
    return pool;
  }
  var desats = gather(oxy, ['spo2_desaturation', 'desat_event']);
  // EVENT-LEXICON §4 (OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-II §3): cvhr_surge DROPPED — no node
  // emits it (ECGDex + PpgDex emit autonomic_surge for CVHR surges); autonomic_arousal stays for the
  // legacy OxyDex bare-array synthesis fallback. Canonical surge name is autonomic_surge.
  var surges = gather(cardiac, ['autonomic_surge', 'autonomic_arousal']);

  // ── Single global matching pass: each desat → nearest UNUSED surge whose
  //    latency passes the DIRECTIONALITY GATE (−lead ≤ lat ≤ +trail). A surge
  //    that precedes the nadir by more than `lead` is rejected (it cannot be
  //    that desat's arousal response). Greedy in desat-time order. ────────────
  var findings = [],
    unmatchedDesat = [],
    usedSurge = new Set();
  desats.forEach(function (d) {
    var best = /** @type {any} */ (null),
      bd = Infinity;
    surges.forEach(function (s, si) {
      if (usedSurge.has(si)) return;
      var lat = (s.tMs - d.tMs) / 1000; // +ve = surge AFTER desat
      if (lat < -leadMaxSec || lat > trailMaxSec) return; // directionality gate
      var dd = Math.abs(s.tMs - d.tMs);
      if (dd < bd) {
        bd = dd;
        best = si;
      }
    });
    if (best != null) {
      usedSurge.add(best);
      var s = surges[best];
      findings.push({
        tMs: d.tMs,
        durSec: (d.meta && d.meta.durSec) || null,
        type: 'confirmed_apnea_event',
        conf: combineConf([effConf(d), effConf(s)]),
        nodes: ['OxyDex', s.node || 'ECGDex'],
        sources: [
          { node: 'OxyDex', impulse: d.impulse, tMs: d.tMs, conf: d.conf, sqi: d.sqi != null ? d.sqi : null, effConf: +(effConf(d) || 0).toFixed(3) },
          { node: s.node || 'ECGDex', impulse: s.impulse, tMs: s.tMs, conf: s.conf, sqi: s.sqi != null ? s.sqi : null, effConf: +(effConf(s) || 0).toFixed(3) }
        ],
        meta: { desatDepth: d.meta && d.meta.depth, nadir: d.meta && d.meta.nadir, latencySec: +((s.tMs - d.tMs) / 1000).toFixed(0), surgeNode: s.node || 'ECGDex' },
        note: 'O₂ desaturation confirmed by a directionally-consistent autonomic surge (' + '−' + leadMaxSec + 's…+' + trailMaxSec + 's). Neither node alone can assert this.'
      });
    } else unmatchedDesat.push(d);
  });
  // surges rejected purely on direction (a surge that LEADS a desat too far) are
  // still surfaced as unmatched, same as surges with no nearby desat.
  var unmatchedSurge = surges.filter(function (s, si) {
    return !usedSurge.has(si);
  });
  findings.sort(function (a, b) {
    return a.tMs - b.tMs;
  });

  // ── CONSEQUENCE-COROBORATION (Part B) ─────────────────────────────────────
  // The headline rule above already confirms desat⟷surge pairs by the R5
  // directional window. As an ADDITIONAL gate (it does NOT alter the matched /
  // AHI counts), classify EVERY desat by whether a real systemic desat's obligate
  // HR consequence is present on a live HR node, picked by authority (ECG >
  // pulse-ox > PPG). Confirmed pairs carry verdict 'confirmed'; unmatched desats
  // get 'artifact-no-consequence' (depth demanded a surge, none came) or
  // 'unconfirmed-desat' (no live HR witness). Witnesses are the cardiac surge
  // pool grouped by node — never the oximeter that reported the desat. ─────────
  var hrByNode = {};
  surges.forEach(function (s) {
    var k = s.node || 'ECGDex';
    (hrByNode[k] = hrByNode[k] || []).push(s.tMs);
  });
  var hrNodesLive = Object.keys(hrByNode).map(function (k) {
    return { node: k, surges: hrByNode[k] };
  });
  findings.forEach(function (f) {
    f.verdict = 'confirmed';
  });
  unmatchedDesat.forEach(function (d) {
    corroborateDesat(d, hrNodesLive);
  });
  var consequence = {
    hrWitness: (pickHRAuthority(hrNodesLive) || {}).node || null,
    confirmed: findings.length,
    noConsequence: unmatchedDesat.filter(function (d) {
      return d.verdict === 'artifact-no-consequence';
    }).length,
    unconfirmed: unmatchedDesat.filter(function (d) {
      return d.verdict === 'unconfirmed-desat';
    }).length
  };

  // ── R5 NULL MODEL ─────────────────────────────────────────────────────────
  // How many confirmations would chance alone produce? Treat surges as a Poisson
  // process over the union; each desat exposes a directional window of width
  // (lead+trail). λ = nDesats · min(1, rate·window). Flag findings that don't
  // exceed chance (P(≥observed) not significant) so a coincidence can't pose as
  // a clinical event. Emit-but-flag — nothing is silently dropped. ────────────
  var unionSec = totHrs * 3600;
  var surgeRate = unionSec > 0 ? surges.length / unionSec : 0; // surges per second
  var winSec = leadMaxSec + trailMaxSec;
  var pPerDesat = Math.min(1, surgeRate * winSec);
  var lambda = desats.length * pPerDesat; // expected confirmations by chance
  var nConf = findings.length;
  var pAtLeast = _poissonSf(nConf, lambda); // P(≥ nConf | chance)
  var belowChance = nConf === 0 || nConf <= lambda || pAtLeast >= 0.05;
  findings.forEach(function (f) {
    f.belowChance = belowChance;
    f.pSpurious = +pAtLeast.toFixed(3);
  });

  // ── EVENT-COUPLING (P7 — CPAP-REAL-CORPUS-FOLLOWUPS-II §P7) ───────────────────
  // The Poisson `nullModel` above answers "is desat⟷surge above chance?" with a memoryless
  // λ that ignores the surges' internal structure and has no explicit power/saturation guard.
  // EventCoupling.coupling() answers the same question with circular time-shift surrogates and
  // the four hard-won guards (wrapping · coverage · power floor · resonance — see
  // EVENT-COUPLING-2026-07-13-BRIEF.md). **Coverage is the recording OVERLAP (`merged`)**, so a
  // desat that fell outside the cardiac window is EXCLUDED, never counted as a miss (the ×0.72
  // anti-coupling artifact). Additive + guarded: the headline (findings/AHI/belowChance above) is
  // UNCHANGED; `coupling.real`/`.lift` are the rigorous verdict, and MUST be read only where
  // `usable` (neither underpowered nor saturated). On a single night few desats ⇒ usually
  // underpowered, and the block honestly says so instead of over-claiming. */
  var _EC = (typeof EventCoupling !== 'undefined' && EventCoupling) || (typeof window !== 'undefined' && window.EventCoupling) || null;
  var coupling = null;
  if (_EC && typeof _EC.coupling === 'function' && desats.length && surges.length && merged.length) {
    var ec = _EC.coupling(desats, surges, { window: [-leadMaxSec * 1000, trailMaxSec * 1000], coverage: merged });
    var usable = !ec.underpowered && !ec.saturated;
    coupling = {
      lift: ec.lift,
      observedPct: ec.observedPct,
      chancePct: ec.chancePct,
      expectedHits: ec.expectedHits,
      underpowered: ec.underpowered,
      saturated: ec.saturated,
      maxLift: ec.maxLift,
      n: ec.n,
      hits: ec.hits,
      excluded: ec.excluded,
      coverageAssumed: ec.coverageAssumed,
      window: ec.window,
      usable: usable,
      // a coupling is REAL only on a usable window where observed genuinely exceeds chance.
      real: usable && isFinite(ec.lift) && ec.lift > 1 && ec.observedPct > ec.chancePct
    };
  }

  // AHI over the *union* hours; keep 2 decimals so a real but low index isn't rounded to 0.
  var ahi = totHrs > 0 ? +(nConf / totHrs).toFixed(2) : null;
  return {
    findings: findings,
    confirmedAHI: ahi,
    confirmedAHIReportable: !belowChance && nConf > 0,
    overlapHours: +totHrs.toFixed(2),
    apneaAuthority: _deviceScoredAuthority(recs, ahi),
    matched: { desat: nConf, surge: nConf },
    total: { desat: desats.length, surge: surges.length },
    unmatched: { desat: unmatchedDesat, surge: unmatchedSurge },
    consequence: consequence,
    nullModel: {
      expectedConfirmed: +lambda.toFixed(2),
      pAtLeastObserved: +pAtLeast.toFixed(3),
      belowChance: belowChance,
      surgeRatePerHr: +(surgeRate * 3600).toFixed(1),
      directionalWindowSec: winSec
    },
    coupling: coupling
  };
}

/* DEVICE-SCORED AHI (CPAPDex) — the strongest apnea truth on the bus. The
   confirmed index is OxyDex-desat ⟷ ECGDex-surge (obstructive-type, desaturating).
   A PAP device's firmware-scored AHI counts ALL scored events — including CENTRAL
   apneas, which produce no desat→surge signature — so the confirmed index is ≤
   device AHI by construction; the gap ≈ central / non-desaturating events. A
   confirmed index ABOVE device AHI flags a scoring conflict. */
function _deviceScoredAuthority(recs, confirmedIndex) {
  var cpap = _byNode(recs, 'CPAPDex');
  for (var ci = 0; ci < cpap.length; ci++) {
    var cs = cpap[ci].summary || {};
    if (cs.residualAHI != null) {
      var dev = cs.residualAHI;
      return {
        source: 'device-scored',
        node: 'CPAPDex',
        ahi: dev,
        components: {
          central: cs.centralIndex != null ? cs.centralIndex : null,
          obstructive: cs.obstructiveIndex != null ? cs.obstructiveIndex : null,
          hypopnea: cs.hypopneaIndex != null ? cs.hypopneaIndex : null
        },
        therapyHours: cs.therapyHours != null ? cs.therapyHours : null,
        confirmedIndex: confirmedIndex != null ? confirmedIndex : null,
        residualGap: confirmedIndex != null ? +(dev - confirmedIndex).toFixed(2) : null,
        agreement: confirmedIndex != null ? (confirmedIndex <= dev * 1.2 ? 'consistent' : 'confirmed-exceeds-device') : null
      };
    }
  }
  return null;
}

/* Poisson survival P(X ≥ k) for mean `lam` — small λ, small k; pure + stable. */
function _poissonSf(k, lam) {
  if (lam <= 0) return k <= 0 ? 1 : 0;
  var cum = 0,
    term = Math.exp(-lam);
  for (var i = 0; i < k; i++) {
    cum += term;
    term *= lam / (i + 1);
  }
  return Math.max(0, Math.min(1, 1 - cum));
}

/* 2 — positional apnea via ECGDex ACC body-position lookup at each confirmed event. */
function labelPositionalApnea(recs, apneaResult) {
  if (!apneaResult || !apneaResult.findings.length) return null;
  var ecg = _byNode(recs, 'ECGDex');
  var posture = [];
  ecg.forEach(function (g) {
    if (g.summary && g.summary.posture) posture = posture.concat(g.summary.posture);
  });
  posture = posture
    .filter(function (p) {
      return p.tMs != null;
    })
    .sort(function (a, b) {
      return a.tMs - b.tMs;
    });
  // fall back to PpgDex limb-ACC posture when no chest-strap posture is available
  var src = 'chest-acc';
  if (!posture.length) {
    var ppg = _byNode(recs, 'PpgDex');
    ppg.forEach(function (g) {
      if (g.summary && g.summary.posture) posture = posture.concat(g.summary.posture);
    });
    posture = posture
      .filter(function (p) {
        return p.tMs != null;
      })
      .sort(function (a, b) {
        return a.tMs - b.tMs;
      });
    if (posture.length) src = 'limb-acc';
  }
  if (!posture.length) return { available: false, note: 'No ACC / body-position series in any node export — positional analysis unavailable.' };
  function posAt(tMs) {
    var best = null,
      bd = 1e12;
    posture.forEach(function (p) {
      var d = Math.abs(p.tMs - tMs);
      if (d < bd) {
        bd = d;
        best = p;
      }
    });
    return best && bd <= 10 * 60000 ? /** @type {any} */ (best).pos : null;
  }
  var supine = 0,
    nonsupine = 0,
    unknown = 0;
  apneaResult.findings.forEach(function (f) {
    var p = posAt(f.tMs);
    f.meta = f.meta || {};
    f.meta.position = p;
    if (p == null) unknown++;
    else if (/supine|back/.test(p)) supine++;
    else nonsupine++;
  });
  var rate = supine + nonsupine > 0 ? supine / (supine + nonsupine) : null;
  var positional = rate != null && supine >= 3 && rate >= 0.7 && (nonsupine === 0 || supine / Math.max(nonsupine, 1) >= 2);
  return {
    available: true,
    supine: supine,
    nonsupine: nonsupine,
    unknown: unknown,
    supineRate: rate != null ? +rate.toFixed(2) : null,
    positional: positional,
    postureSource: src,
    note:
      'Provisional — body position is ' +
      (src === 'limb-acc' ? 'LIMB-worn ACC (Polar Sense; lower reliability — wrist/ankle orientation, not trunk)' : 'chest-ACC-derived') +
      ', not PSG. ' +
      (positional ? 'Confirmed events cluster supine (provisional positional apnea).' : 'No strong supine clustering of confirmed events.')
  };
}

/* ── §3.2 glucoseMetricsInWindow — slice the continuous CGM cells to an exact
   [startMs,endMs] overlap window and compute the per-window glycemic metrics the
   fusion rule needs. PURE. Floating tMs throughout; getUTC* only (viewer-tz
   independent). Math ported from GlucoDex coreMetrics/mage/dawn/hypo. Compression
   cells (f===3) are held OUT of value stats (positional artifacts), mirroring the
   emitter. Returns null when coverage < minCoverage (never fabricate a thin window). */
function _mageWin(v, sd) {
  var n = v.length;
  if (n < 4) return Math.round(sd);
  var tp = [0],
    dir = 0,
    i;
  for (i = 1; i < n; i++) {
    var d = v[i] - v[tp[tp.length - 1]];
    if (dir === 0) {
      if (Math.abs(d) > 0) dir = d > 0 ? 1 : -1;
    } else {
      var s = v[i] - v[i - 1];
      var sg = s > 0 ? 1 : s < 0 ? -1 : 0;
      if (sg !== 0 && sg !== dir) {
        tp.push(i - 1);
        dir = sg;
      }
    }
  }
  tp.push(n - 1);
  var exc = [];
  for (i = 1; i < tp.length; i++) {
    var amp = Math.abs(v[tp[i]] - v[tp[i - 1]]);
    if (amp > sd) exc.push(amp);
  }
  if (!exc.length) return Math.round(sd);
  var sum = 0;
  for (i = 0; i < exc.length; i++) sum += exc[i];
  return Math.round(sum / exc.length);
}
function glucoseMetricsInWindow(cgmRec, startMs, endMs, opts) {
  opts = opts || {};
  var minCov = opts.minCoverage != null ? opts.minCoverage : 0.5;
  var minMin = opts.minWindowMin != null ? opts.minWindowMin : 60; // reject thin slivers (a ~20-min overlap is not an overnight)
  var cells = (cgmRec && cgmRec.series && cgmRec.series.cells) || [];
  if (!cells.length || startMs == null || endMs == null || endMs <= startMs) return null;
  var cadMin = cgmRec.series.cadenceMin != null && cgmRec.series.cadenceMin > 0 ? cgmRec.series.cadenceMin : 5;
  var nMin = (endMs - startMs) / 60000;
  if (nMin < minMin) return null; // honest: overlap too short to characterize
  var i,
    win = [];
  for (i = 0; i < cells.length; i++) {
    if (cells[i].tMs >= startMs && cells[i].tMs <= endMs) win.push(cells[i]);
  }
  // value stats exclude compression artifacts (f===3); keep OK + gap-interp
  var vals = [],
    valsT = [];
  for (i = 0; i < win.length; i++) {
    if (win[i].f === 3) continue;
    if (win[i].v == null) continue;
    vals.push(win[i].v);
    valsT.push(win[i].tMs);
  }
  var expected = nMin / cadMin + 1; // inclusive endpoints → +1 cell
  var coverage = expected > 0 ? win.length / expected : 0;
  if (vals.length < 3 || coverage < minCov) return null; // honest: too thin → skip
  // mean / SD / CV
  var m = 0;
  for (i = 0; i < vals.length; i++) m += vals[i];
  m /= vals.length;
  var ss = 0;
  for (i = 0; i < vals.length; i++) {
    var dv = vals[i] - m;
    ss += dv * dv;
  }
  var sd = vals.length > 1 ? Math.sqrt(ss / (vals.length - 1)) : 0;
  var cv = m > 0 ? (sd / m) * 100 : 0;
  // TIR 70–140 · nadir · time-below-70
  var tt = 0,
    below = 0,
    nadir = Infinity,
    nadirT = null;
  for (i = 0; i < vals.length; i++) {
    var g = vals[i];
    if (g >= 70 && g <= 140) tt++;
    if (g < 70) below++;
    if (g < nadir) {
      nadir = g;
      nadirT = valsT[i];
    }
  }
  // dawn rise: min(03:00–06:00) → max(06:00–08:00) by UTC hour
  var dawnNadir = Infinity,
    dawnMax = -Infinity,
    dawnT = null;
  for (i = 0; i < vals.length; i++) {
    var h = new Date(valsT[i]).getUTCHours();
    if (h >= 3 && h < 6) {
      if (vals[i] < dawnNadir) dawnNadir = vals[i];
    } else if (h >= 6 && h < 8) {
      if (vals[i] > dawnMax) {
        dawnMax = vals[i];
        dawnT = valsT[i];
      }
    }
  }
  var dawnRise = isFinite(dawnNadir) && isFinite(dawnMax) ? Math.round(dawnMax - dawnNadir) : null;
  return {
    nMin: +nMin.toFixed(1),
    coverage: +coverage.toFixed(3),
    nCells: win.length,
    nocturnalMean: Math.round(m),
    nocturnalCV: +cv.toFixed(1),
    nadirValue: Math.round(nadir),
    nadirTimeMs: nadirT,
    dawnRise: dawnRise,
    dawnRiseTimeMs: dawnT,
    tir70_140: +((tt / vals.length) * 100).toFixed(1),
    mage: _mageWin(vals, sd),
    timeBelow70Min: Math.round(below * cadMin)
  };
}

/* 3 — ECGDex autonomic instability ⟷ GlucoDex glycemic variability (closes the
   reserved handshake both nodes stub). Mirrors GlucoDex computeFusion intent. */
function fuseAutonomicGlycemic(recs, dtMs, opts2) {
  var ecg = _byNode(recs, 'ECGDex'),
    glu = _byNode(recs, 'GlucoDex');
  if (!ecg.length || !glu.length) return null;
  var pairs = [];
  ecg.forEach(function (g) {
    glu.forEach(function (c) {
      var win = overlapInterval(g, c);
      if (!win) return;
      var slope = g.summary && g.summary.autonomicInstabilitySlope;
      var hasCells = !!(c.series && c.series.cells && c.series.cells.length);
      var cv,
        dawn,
        coverage = null,
        windowed = false;
      if (hasCells) {
        // §3.3 window the continuous CGM to THIS night's exact overlap
        var gm = glucoseMetricsInWindow(c, win.startMs, win.endMs, { minCoverage: opts2 && opts2.minCoverage });
        if (!gm) return; // thin window → skip, honest (no fabricated CV)
        cv = gm.nocturnalCV;
        dawn = gm.dawnRise;
        coverage = gm.coverage;
        windowed = true;
      } else {
        // legacy export without timeseries.cells → fall back to whole-wear summary
        cv = c.summary && c.summary.glucoseCV;
        dawn = c.summary && c.summary.dawnSurge;
      }
      pairs.push({ ecg: g.label, glu: c.label, overlapMin: win.overlapMin, slope: slope, glucoseCV: cv, dawnSurge: dawn, coverage: coverage, windowed: windowed });
    });
  });
  if (!pairs.length) return null;
  // r from paired (slope, CV) across overlapping nights when ≥3 pairs; else directional single-pair note
  var xs = [],
    ys = [];
  pairs.forEach(function (p) {
    if (p.slope != null && p.glucoseCV != null) {
      xs.push(p.slope);
      ys.push(p.glucoseCV);
    }
  });
  var r = xs.length >= 3 ? pearson(xs, ys) : null;
  /* Single-pair directional estimate: positive slope + elevated CV ⇒ positive coupling.
     DEEP-AUDIT-2026-07-11 §13: this used to fall back to `p0.slope` ALONE. With glucoseCV absent (which
     it ALWAYS was on a ganglior export — see the read-chain fix above) it still published a confident
     glucose⟷autonomic coupling of 0.44 with n=0, computed entirely from the ECG side. A coupling between
     two signals cannot be estimated from one of them: it now requires the pair to actually CARRY a
     glucose value, and is null (with a reason) otherwise. */
  var directional = null;
  if (r == null && pairs.length) {
    var p0 = pairs.find(function (p) {
      return p.slope != null && p.glucoseCV != null;
    });
    if (p0) directional = clamp(0.5 + clamp(p0.slope, -0.5, 0.5), 0, 1);
  }
  var value = r != null ? r : directional != null ? +directional.toFixed(2) : null;
  var anyGlucose = pairs.some(function (p) {
    return p.glucoseCV != null;
  });
  return {
    pairs: pairs,
    r: r,
    directional: directional != null ? +directional.toFixed(2) : null,
    glucoseAutonomicCorrelation: value,
    n: xs.length,
    note:
      r != null
        ? 'Pearson r over ' + xs.length + ' overlapping nights between ECG autonomic-instability slope and CGM glucose variability. Directional, small n.'
        : !anyGlucose
          ? 'No glucose variability reached the fusion (the CGM export carried no CV on the overlapping window), so an autonomic⟷glycemic coupling CANNOT be estimated — a coupling needs both signals. Reported as unknown, not zero.'
          : 'Single overlapping night — directional estimate only (need ≥3 nights for a correlation). Rising autonomic instability co-travels with glycemic variability.'
  };
}

/* 4 — HRV consensus across PulseDex / HRVDex / ECGDex / PpgDex on shared windows.
   R8: only compares metrics from the SAME analysis window (all normalized to
   wholeRecord in adaptEnvelopeNode), so a definitional mismatch can't masquerade
   as a data-quality divergence. The window is stated in every block. */
/* ── TCH consensus helpers (INTEGRATOR-THREE-CORNERED-HAT-2026-07-02 §3) ────────
   Reference-free per-sensor error from the per-epoch rmssd SERIES carried on each rec
   (series.hrvEpochs, added in adaptEnvelopeNode). PURE; returns a reason-stamped null
   when <3 nodes carry an alignable series (→ pairwise consensus is used unchanged). */
function _tchEngine() {
  return (typeof IntegratorTCH !== 'undefined' && IntegratorTCH) || (typeof window !== 'undefined' && window.IntegratorTCH) || null;
}
// Cross-node epoch alignment MUST key on the SAME wall-clock instant, not the node-relative offset
// (FU-II §1 / Clock Contract): co-recorded devices start minutes apart, so a shared node-relative tMin
// is a DIFFERENT absolute time per node → inflated pairwise-difference variance + a mis-ranked culprit.
// Key on the absolute 5-min wall-clock grid (min) whenever the epoch carries a floating tMs (already
// stamped in adaptEnvelopeNode); fall back to node-relative tMin only when t0Ms is unknown (tMs null).
// Same-start nights are byte-identical: the same monotonic key-shift applies to every node, so the
// alignTriplet intersection membership + order (hence every σ²/weight/level) is unchanged.
function _epKey(e) {
  return e && e.tMs != null && isFinite(e.tMs) ? Math.round(e.tMs / 300000) * 5 : e ? e.tMin : null;
}
function _rmssdPts(s) {
  return ((s.series && s.series.hrvEpochs) || [])
    .filter(function (e) {
      return e && e.tMin != null && e.rmssd != null;
    })
    .map(function (e) {
      return { tMin: _epKey(e), v: e.rmssd };
    });
}
// §2 HR-hat — per-epoch pulse-HR series (ECGDex/PpgDex/OxyDex all now emit timeseries.epochs[].hr).
function _hrPts(s) {
  return ((s.series && s.series.hrvEpochs) || [])
    .filter(function (e) {
      return e && e.tMin != null && e.hr != null;
    })
    .map(function (e) {
      return { tMin: _epKey(e), v: e.hr };
    });
}
function _meanMotion(s, keys) {
  var set = {};
  keys.forEach(function (k) {
    set[k] = 1;
  });
  var eps = (s.series && s.series.hrvEpochs) || [];
  var vs = eps
    .filter(function (e) {
      return e && set[_epKey(e)] && e.motion != null;
    })
    .map(function (e) {
      return e.motion;
    });
  if (!vs.length) return null;
  return +(
    vs.reduce(function (a, b) {
      return a + b;
    }, 0) / vs.length
  ).toFixed(3);
}
// §1 external-ρ — a per-node motion vector ALIGNED to the triplet's common epoch keys (null when a
// node carries no per-epoch motion). Feeds the common-mode correlation the classic TCH can't see.
function _tchAlignedMotion(s, keys) {
  var m = {};
  ((s.series && s.series.hrvEpochs) || []).forEach(function (e) {
    if (e && e.tMin != null && e.motion != null) m[_epKey(e)] = e.motion;
  });
  var v = keys.map(function (k) {
    return m[k] != null ? m[k] : null;
  });
  return v.some(function (x) {
    return x != null;
  })
    ? v
    : null;
}
function _tchPearson(a, b) {
  var xs = [],
    ys = [],
    i;
  for (i = 0; i < a.length; i++) {
    if (a[i] != null && b[i] != null && isFinite(a[i]) && isFinite(b[i])) {
      xs.push(a[i]);
      ys.push(b[i]);
    }
  }
  var n = xs.length;
  if (n < 4) return null;
  var mx = 0,
    my = 0;
  for (i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  var sxy = 0,
    sxx = 0,
    syy = 0;
  for (i = 0; i < n; i++) {
    var dx = xs[i] - mx,
      dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx < 1e-12 || syy < 1e-12) return null;
  return sxy / Math.sqrt(sxx * syy);
}
// Estimate the common-mode ρ for the correlated-TCH solve from CROSS-NODE per-epoch motion: the mean
// of the POSITIVE pairwise motion correlations across the triplet's nodes. Needs ≥2 motion-bearing
// nodes; null otherwise (→ classic). Clamped to [0, 0.9]. A proxy — co-motion correlation stands in
// for the shared motion-driven noise correlation the reference-free estimator cannot itself recover.
function _tchRhoFromMotion(triplet, keys) {
  var ms = triplet
    .map(function (s) {
      return { node: s.node, m: _tchAlignedMotion(s, keys) };
    })
    .filter(function (x) {
      return x.m;
    });
  if (ms.length < 2) return null;
  var rs = [];
  for (var i = 0; i < ms.length; i++)
    for (var j = i + 1; j < ms.length; j++) {
      var r = _tchPearson(ms[i].m, ms[j].m);
      if (r != null) rs.push(r);
    }
  if (!rs.length) return null;
  var pos = rs.map(function (r) {
    return Math.max(r, 0);
  });
  var mean =
    pos.reduce(function (a, b) {
      return a + b;
    }, 0) / pos.length;
  var rho = Math.max(0, Math.min(0.9, mean));
  return { value: +rho.toFixed(3), method: 'cross-node-motion', nMotionNodes: ms.length, meanPairR: +mean.toFixed(3), nPairs: rs.length };
}
// Generic reference-free per-sensor hat for ONE metric ('rmssd' | 'hr'). PURE; {ok:false, reason}
// when <3 nodes carry that per-epoch series (→ caller degrades). Estimates ρ from cross-node motion
// (§1) and passes it to the estimator's external-ρ path; attaches per-node mean level for reconciling.
function _tchHat(like, ptsFn, metric) {
  var TCH = _tchEngine();
  if (!TCH) return null;
  var ws = like.filter(function (s) {
    return ptsFn(s).length >= 12;
  });
  if (ws.length < 3)
    return {
      ok: false,
      metric: metric,
      reason: 'need ≥3 nodes with a per-epoch ' + metric + ' series; have ' + ws.length,
      nodesWithSeries: ws.map(function (s) {
        return s.node;
      })
    };
  var best = null; // the triple with the most common aligned epochs
  for (var i = 0; i < ws.length; i++)
    for (var j = i + 1; j < ws.length; j++)
      for (var k = j + 1; k < ws.length; k++) {
        var al = TCH.alignTriplet(ptsFn(ws[i]), ptsFn(ws[j]), ptsFn(ws[k]), { key: 'tMin', val: 'v' });
        if (!best || al.keys.length > best.al.keys.length) best = { A: ws[i], B: ws[j], C: ws[k], al: al };
      }
  if (!best || best.al.keys.length < 12) return { ok: false, metric: metric, reason: metric + ' best triple overlap ' + (best ? best.al.keys.length : 0) + ' epochs < 12' };
  // Decorrelation quality gate (TRIO-METHODS-REUSE §Do 3): if one node's series decorrelates
  // from BOTH others (failed extraction / lost contact), a 3-way solve folds its garbage into
  // every per-sensor σ. Screen the chosen triplet first; if exactly one node is decorrelated
  // (and the surviving pair still agrees), DROP it and degrade to the trustworthy pair rather
  // than emit a falsely-confident hat. Zero drops → proceed unchanged (inert on good data).
  if (typeof TCH.screenTriplet === 'function') {
    var scr = TCH.screenTriplet(best.al.A, best.al.B, best.al.C, { labels: [best.A.node, best.B.node, best.C.node] });
    if (scr && scr.drop) {
      return {
        ok: false,
        metric: metric,
        reason: 'decorrelated node dropped — ' + scr.reason,
        dropped: scr.drop,
        keptPair: scr.keptPair,
        corr: scr.corr,
        nodesWithSeries: ws.map(function (s) {
          return s.node;
        })
      };
    }
  }
  var rho = _tchRhoFromMotion([best.A, best.B, best.C], best.al.keys); // §1
  var opts = { labels: [best.A.node, best.B.node, best.C.node], minN: 12 };
  if (rho && rho.value > 0) opts.rho = rho.value;
  var r = TCH.threeCorneredHat(best.al.A, best.al.B, best.al.C, opts);
  if (!r.ok) {
    r.metric = metric;
    return r;
  }
  r.metric = metric;
  r.coMotion = {};
  [best.A, best.B, best.C].forEach(function (s) {
    r.coMotion[s.node] = _meanMotion(s, best.al.keys);
  });
  r.rhoEstimate = rho || null; // §1 provenance: how ρ was derived (null → classic solve)
  r.levels = {};
  [best.A, best.B, best.C].forEach(function (s) {
    var mp = {};
    ptsFn(s).forEach(function (p) {
      mp[p.tMin] = p.v;
    });
    var vs = best.al.keys
      .map(function (kk) {
        return mp[kk];
      })
      .filter(function (v) {
        return v != null;
      });
    r.levels[s.node] = vs.length
      ? +(
          vs.reduce(function (a, b) {
            return a + b;
          }, 0) / vs.length
        ).toFixed(1)
      : null;
  });
  if (typeof TCH.allanTriplet === 'function') {
    var _al = TCH.allanTriplet(best.al.A, best.al.B, best.al.C, { labels: [best.A.node, best.B.node, best.C.node], taus: [1, 2, 4, 8] });
    if (_al) {
      var _keys = best.al.keys,
        _gaps = [];
      for (var _i = 1; _i < _keys.length; _i++) _gaps.push(_keys[_i] - _keys[_i - 1]);
      _gaps.sort(function (a, b) {
        return a - b;
      });
      var _epMin = _gaps.length ? _gaps[Math.floor(_gaps.length / 2)] : 5;
      _al.epochMin = _epMin;
      _al.tausMin = _al.taus.map(function (m) {
        return +(m * _epMin).toFixed(0);
      });
      r.allan = _al;
    }
  }
  // §5 (FU-II) — reference-free TCH determines the QUIET sensors poorly: their pairwise-difference
  // variance is small, so sampling noise dominates the split (the culprit + its σ² are trustworthy,
  // the two quieter sensors are "both low, order uncertain"). Flag when the two quietest σ² sit within
  // a ×2 factor — a caveat, NOT a change to the estimate. (documentation + a small flag)
  var _s2sorted = Object.keys(r.sigma2)
    .map(function (k) {
      return { k: k, v: r.sigma2[k] };
    })
    .sort(function (a, b) {
      return b.v - a.v;
    });
  var _quiet = _s2sorted.slice(1); // drop the loudest (the culprit)
  r.quietSensors = _quiet.map(function (x) {
    return x.k;
  });
  r.quietOrderUncertain = _quiet.length >= 2 && _quiet[0].v > 0 && _quiet[_quiet.length - 1].v > 0 ? _quiet[0].v / _quiet[_quiet.length - 1].v < 2 : false;
  return r;
}
// Back-compat: the RMSSD hat IS the historical _tchConsensus return (block.tch).
function _tchConsensus(like) {
  return _tchHat(like, _rmssdPts, 'rmssd');
}
function fuseHRVConsensus(recs, dtMs) {
  var sources = recs.filter(function (r) {
    return ['ECGDex', 'PulseDex', 'HRVDex', 'PpgDex'].indexOf(r.node) >= 0 && !r.dateUnknown && r.summary && (r.summary.rmssd != null || r.summary.sdnn != null);
  });
  if (sources.length < 2) return null;
  // only compare sources whose windows overlap
  var groups = [];
  sources.forEach(function (s) {
    var placed = false;
    for (var i = 0; i < groups.length; i++) {
      if (
        groups[i].some(function (o) {
          return overlapInterval(o, s);
        })
      ) {
        groups[i].push(s);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([s]);
  });
  var blocks = groups
    .filter(function (g) {
      return g.length >= 2;
    })
    .map(function (g) {
      // R8: compare only sources sharing the same HRV window (all wholeRecord today).
      var win = (g[0].summary && g[0].summary.hrvWindow) || 'wholeRecord';
      var likeWin = g.filter(function (s) {
        return ((s.summary && s.summary.hrvWindow) || 'wholeRecord') === win;
      });
      var crossWindow = likeWin.length < g.length;
      // R-quality: a grossly motion/coverage-compromised source (e.g. a trashed wrist-PPG
      // night) otherwise fabricates a false cross-device 'divergence'. Prune sources below
      // a quality floor — but only while ≥2 trustworthy sources remain.
      var QFLOOR = DexKernel.K.QFLOOR;
      // FU §2: a source is untrusted for HRV consensus if its coverage is below QFLOOR, OR it
      // self-reported hrv.time.lowConfidence (a sparse/heavily-corrected night that can clear the
      // analyzablePct floor yet stay jitter-inflated), OR (PpgDex) its whole-record 3-LED agreement
      // is below the optical-consensus floor. Reason strings stay human-readable (node + why).
      function _hrvUntrusted(s) {
        var sm = s.summary || {};
        if (sm.hrvQualityPct != null && sm.hrvQualityPct < QFLOOR) return s.node + ' (' + sm.hrvQualityPct + '%)';
        if (sm.hrvLowConfidence === true) return s.node + ' (lowConfidence)';
        if (sm.ledAgreementPct != null && sm.ledAgreementPct < LED_CONSENSUS_FLOOR) return s.node + ' (LED ' + sm.ledAgreementPct + '%)';
        return null;
      }
      var usable = likeWin.filter(function (s) {
        return !_hrvUntrusted(s);
      });
      var lowQ = likeWin.map(_hrvUntrusted).filter(Boolean);
      var like = usable.length >= 2 ? usable : likeWin;
      var lowQExcluded = usable.length >= 2 && lowQ.length ? lowQ : null;
      function spread(key) {
        var vs = like
          .map(function (s) {
            return s.summary[key];
          })
          .filter(function (v) {
            return v != null;
          });
        if (vs.length < 2) return null;
        var mn = Math.min.apply(null, vs),
          mx = Math.max.apply(null, vs),
          md = median(vs);
        var divPct = md ? +(((mx - mn) / md) * 100).toFixed(0) : null;
        return {
          values: like
            .map(function (s) {
              return { node: s.node, v: s.summary[key] };
            })
            .filter(function (o) {
              return o.v != null;
            }),
          min: mn,
          max: mx,
          median: md,
          divergencePct: divPct
        };
      }
      var rm = spread('rmssd'),
        sd = spread('sdnn'),
        lf = spread('lfhf');
      /* DEEP-AUDIT-2026-07-11 §12: spread() correctly returns NULL for a key no two sources share (each
       node honestly nulls what it lacks — legal under the node-export contract). `|| 0` converted that
       ABSENCE into a measured 0 % divergence, which then drove qc:'agreement' and the surfaced note
       "Sources agree within 0% … reconciled autonomic state is reliable." Nothing was compared, so
       nothing agreed. With no comparable metric the divergence is UNKNOWN — null — and the block says so. */
      var _divs = [rm && rm.divergencePct, sd && sd.divergencePct].filter(function (v) {
        return v != null;
      });
      var worst = _divs.length ? Math.max.apply(null, _divs) : null;
      var comparable = worst != null;
      // TCH (INTEGRATOR-THREE-CORNERED-HAT §3): reference-free per-sensor error across ≥3
      // series-bearing nodes. ADDITIVE — the pairwise spread/divergence above is unchanged;
      // degrades to a reason-stamped null (tchStatus) when <3 nodes carry an alignable series.
      var tch = _tchConsensus(like);
      if (tch && tch.ok && rm && rm.values) {
        // inverse-variance reconciled RMSSD (weight ∝ 1/σ²)
        var _ws = 0,
          _acc = 0;
        rm.values.forEach(function (o) {
          var w = tch.weights[o.node];
          if (w != null) {
            _acc += w * o.v;
            _ws += w;
          }
        });
        if (_ws > 0) rm.weightedMean = +(_acc / _ws).toFixed(1);
      }
      // §2 HR-hat — reference-free per-sensor HR error across ECG+PPG+Oxy, INDEPENDENT of the rmssd hat
      // (which needs a 3rd rmssd node). The HR triplet may include NON-HRV nodes that carry a per-epoch
      // hr series (notably OxyDex, excluded from the rmssd/sdnn consensus above) — union `like` with any
      // overlapping hr-bearing rec. Fires the moment 3 nodes carry a per-epoch hr series; additive.
      var hrLike = like.slice();
      recs.forEach(function (rc) {
        if (hrLike.indexOf(rc) >= 0 || rc.dateUnknown || _hrPts(rc).length < 12) return;
        if (
          g.some(function (o) {
            return overlapInterval(o, rc);
          })
        )
          hrLike.push(rc);
      });
      var tchHR = _tchHat(hrLike, _hrPts, 'hr');
      var hrReconciled = null;
      if (tchHR && tchHR.ok && tchHR.levels) {
        // inverse-variance reconciled HR (weight ∝ 1/σ²)
        var _hw = 0,
          _ha = 0;
        Object.keys(tchHR.levels).forEach(function (nd) {
          var v = tchHR.levels[nd],
            w = tchHR.weights[nd];
          if (v != null && w != null) {
            _ha += w * v;
            _hw += w;
          }
        });
        if (_hw > 0) hrReconciled = +(_ha / _hw).toFixed(1);
      }
      var note =
        (!comparable
          ? 'No HRV metric is carried by ≥2 of these sources (' +
            like
              .map(function (s) {
                return s.node;
              })
              .join(', ') +
            ') — nothing could be compared, so agreement is UNKNOWN, not confirmed.'
          : worst > 30
            ? 'Cross-device divergence ' + worst + '% on RMSSD/SDNN (' + win + ') — flag as data-quality issue; reconcile before trusting a single value.'
            : 'Sources agree within ' + worst + '% on ' + win + ' HRV — reconciled autonomic state is reliable.') +
        (lowQExcluded ? ' Excluded low-quality source(s): ' + lowQExcluded.join(', ') + '.' : '');
      if (tch && tch.ok)
        note += ' TCH: ' + tch.culprit + ' carries the largest error variance (σ²≈' + Math.round(tch.sigma2[tch.culprit]) + ' ms², ' + tch.method + ') — down-weight it in the reconciled value.';
      if (tchHR && tchHR.ok)
        note +=
          ' HR-hat: ' +
          tchHR.culprit +
          ' is the noisiest HR estimator (σ≈' +
          (tchHR.sigma[tchHR.culprit] != null ? tchHR.sigma[tchHR.culprit].toFixed(1) : '?') +
          ' bpm, ' +
          tchHR.method +
          (tchHR.rho ? ', ρ=' + tchHR.rho : '') +
          ')' +
          (hrReconciled != null ? '; reconciled HR ' + hrReconciled + ' bpm.' : '.');
      return {
        nodes: like.map(function (s) {
          return s.node;
        }),
        window: fmtDayShort(g[0].t0Ms),
        hrvWindow: win,
        units: 'ms',
        crossWindowExcluded: crossWindow,
        rmssd: rm,
        sdnn: sd,
        lfhf: lf,
        divergencePct: worst,
        lowQualityExcluded: lowQExcluded,
        tch: tch && tch.ok ? tch : null,
        tchStatus: tch ? (tch.ok ? 'ok' : tch.reason) : 'not-attempted',
        tchHR: tchHR && tchHR.ok ? tchHR : null,
        tchHRStatus: tchHR ? (tchHR.ok ? 'ok' : tchHR.reason) : 'not-attempted',
        hrReconciled: hrReconciled,
        qc: !comparable ? 'incomparable' : worst > 30 ? 'divergent' : 'agreement',
        note: note
      };
    });
  return blocks.length ? { blocks: blocks } : null;
}

/* T2 — cross-node sleep-staging consistency. Single-signal stagers (ECG vs oximetry)
   often disagree wildly; surface that instead of letting two dashboards assert
   contradictory hypnograms. Compares REM fraction across overlapping nodes that
   report one; flags when the spread exceeds `remGapThresh` (default 20 pts). */
function fuseStagingConsensus(recs, remGapThresh) {
  remGapThresh = remGapThresh == null ? 0.2 : remGapThresh;
  var src = recs.filter(function (r) {
    return !r.dateUnknown && r.summary && r.summary.remFraction != null;
  });
  if (src.length < 2) return null;
  // group by temporal overlap (same night)
  var groups = [];
  src.forEach(function (s) {
    var placed = false;
    for (var i = 0; i < groups.length; i++) {
      if (
        groups[i].some(function (o) {
          return overlapInterval(o, s);
        })
      ) {
        groups[i].push(s);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([s]);
  });
  var blocks = groups
    .filter(function (g) {
      return g.length >= 2;
    })
    .map(function (g) {
      var vals = g.map(function (s) {
        return { node: s.node, remPct: +(s.summary.remFraction * 100).toFixed(1), method: s.summary.stagingMethod || null };
      });
      var fr = g.map(function (s) {
        return s.summary.remFraction;
      });
      var gap = Math.max.apply(null, fr) - Math.min.apply(null, fr);
      var disagree = gap > remGapThresh;
      return {
        window: fmtDayShort(g[0].t0Ms),
        nodes: g.map(function (s) {
          return s.node;
        }),
        remByNode: vals,
        remGapPct: +(gap * 100).toFixed(1),
        disagreement: disagree,
        note: disagree
          ? 'Single-signal sleep stages disagree by ' +
            (gap * 100).toFixed(0) +
            ' pts of REM (' +
            vals
              .map(function (v) {
                return v.node + ' ' + v.remPct + '%';
              })
              .join(' vs ') +
            '). Neither is a validated hypnogram — treat both as low-confidence estimates; PSG needed to arbitrate.'
          : 'Single-signal REM estimates agree within ' + (gap * 100).toFixed(0) + ' pts.'
      };
    });
  return blocks.length ? { blocks: blocks } : null;
}

/* ════ PERIODIC-BREATHING CROSS-NODE CORROBORATION (OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-II §2) ══
   Periodic breathing / Cheyne–Stokes is observable by several INDEPENDENT signals:
     · OxyDex  — SpO₂ oscillation (periodic_breathing events) ............ tier EXPERIMENTAL
     · CPAPDex — device flow (periodic_breathing events + metrics.periodicBreathingPct) · DEVICE-SCORED
     · ECGDex  — cardiac CVHR (cyclic variation of HR; summary.cvhrIndex), the autonomic
                 CORRELATE of the breathing cycle — NOT a direct PB read ... tier EMERGING
   A PB window seen by ≥2 of these is stronger than one — mirrors fuseStagingConsensus /
   fuseHRVConsensus: group observers by temporal overlap, surface only CORROBORATED windows.
   Honest about the source mix + DOWN-WEIGHTED by tier (device 1.0 · CVHR 0.8 · oximetry-proxy
   0.6); the fused finding is graded EXPERIMENTAL — a corroboration signal, NOT a scored CSR/PB
   index. No node is re-scored; this reads events/metrics already on the bus.
   Returns { blocks:[ {window,t0Ms,observerNodes,nObservers,corroborated,conf,sources,note} ] } | null. */
var PB_TIER_WEIGHT = { 'device-scored': 1.0, emerging: 0.8, experimental: 0.6 };
var PB_CVHR_MIN = 5; // ECGDex cvhrIndex (events/h) under this is too weak to count as a PB-consistent cardiac signature.
// -III §3 (decision): INTENTIONALLY Integrator-local — a FUSION-LAYER corroboration knob (how
// strong a cardiac CVHR train must be to COUNT as one PB observer), NOT a node physiology
// threshold, so it does NOT belong in DexKernel.K (the cross-fleet single source). Kernel-sourcing
// it would bump KERNEL_HASH + force the 8-app fleet rebuild for an UNVALIDATED rule-of-thumb —
// unwarranted (the DEX-EVENT-UNIFY C2 precedent: OxyDex's SpO₂-only detector params stay node-local).
// Promote to the kernel ONLY once validated against the corpus. (EVENT-LEXICON.md §6.4.)

function _pbObserver(rec) {
  // one node's PB evidence in its own window → observer | null
  if (rec.node === 'OxyDex' || rec.node === 'CPAPDex') {
    var pb = _eventsOfType(rec, ['periodic_breathing']);
    var pct = rec.summary && rec.summary.periodicBreathingPct != null ? rec.summary.periodicBreathingPct : null;
    if (!pb.length && !(pct != null && pct > 0)) return null;
    var cs = pb
      .map(function (e) {
        return e.conf;
      })
      .filter(function (c) {
        return c != null && isFinite(c);
      });
    var conf = cs.length ? median(cs) : pct != null ? clamp(0.5 + (Math.min(pct, 40) / 40) * 0.4, 0.5, 0.9) : 0.6;
    return rec.node === 'CPAPDex'
      ? { node: 'CPAPDex', channel: 'device flow', tier: 'device-scored', episodes: pb.length, pbPct: pct != null ? pct : null, cvhrIndex: null, conf: +conf.toFixed(2) }
      : { node: 'OxyDex', channel: 'SpO₂ oscillation', tier: 'experimental', episodes: pb.length, pbPct: null, cvhrIndex: null, conf: +conf.toFixed(2) };
  }
  if (rec.node === 'ECGDex') {
    var idx = rec.summary && rec.summary.cvhrIndex != null ? rec.summary.cvhrIndex : null;
    if (idx == null || idx < PB_CVHR_MIN) return null;
    var c = clamp(0.4 + (Math.min(idx, 30) / 30) * 0.4, 0.4, 0.8);
    return { node: 'ECGDex', channel: 'cardiac CVHR (autonomic correlate)', tier: 'emerging', episodes: null, pbPct: null, cvhrIndex: idx, conf: +c.toFixed(2) };
  }
  return null;
}
function fusePeriodicBreathing(recs) {
  var src = (recs || [])
    .filter(function (r) {
      return !r.dateUnknown;
    })
    .map(function (r) {
      var o = _pbObserver(r);
      return o ? { rec: r, obs: o } : null;
    })
    .filter(function (x) {
      return x;
    });
  if (src.length < 2) return null;
  // group by temporal overlap (same night) — identical pattern to staging / HRV consensus
  var groups = [];
  src.forEach(function (s) {
    var placed = false;
    for (var i = 0; i < groups.length; i++) {
      if (
        groups[i].some(function (o) {
          return overlapInterval(o.rec, s.rec);
        })
      ) {
        groups[i].push(s);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([s]);
  });
  var blocks = groups
    .map(function (g) {
      // collapse to ONE observer per node (a node seen via two recordings in a night counts once;
      // keep the richer evidence) so nObservers is a DISTINCT-NODE count, never inflated.
      var byNode = {};
      g.forEach(function (s) {
        var ex = byNode[s.obs.node];
        if (!ex || (s.obs.episodes || 0) > (ex.episodes || 0)) byNode[s.obs.node] = s.obs;
      });
      var obs = Object.keys(byNode).map(function (k) {
        return byNode[k];
      });
      var t0 = Math.min.apply(
        null,
        g.map(function (s) {
          return s.rec.t0Ms != null ? s.rec.t0Ms : Infinity;
        })
      );
      if (!isFinite(t0)) t0 = null;
      var conf = combineConf(
        obs.map(function (o) {
          return (o.conf != null ? o.conf : 0) * (PB_TIER_WEIGHT[o.tier] || 0.6);
        })
      );
      var note =
        'Periodic breathing corroborated across ' +
        obs.length +
        ' independent signals — ' +
        obs
          .map(function (o) {
            return (
              o.node +
              ' (' +
              o.channel +
              (o.episodes != null ? ', ' + o.episodes + ' episode' + (o.episodes === 1 ? '' : 's') : '') +
              (o.pbPct != null ? ', ' + o.pbPct + '% of night' : '') +
              (o.cvhrIndex != null ? ', CVHR ' + o.cvhrIndex + '/h' : '') +
              ')'
            );
          })
          .join('; ') +
        '. Tier-weighted (device-scored > cardiac CVHR > oximetry proxy); a cross-signal corroboration, not a scored Cheyne–Stokes index.';
      return {
        t0Ms: t0,
        window: t0 != null ? fmtDayShort(t0) : 'date unknown',
        observerNodes: obs.map(function (o) {
          return o.node;
        }),
        nObservers: obs.length,
        corroborated: obs.length >= 2,
        conf: conf,
        sources: obs,
        note: note
      };
    })
    .filter(function (b) {
      return b.corroborated;
    });
  return blocks.length ? { blocks: blocks } : null;
}
/* Read a node's physiology-kernel stamp, WHICHEVER SHAPE it arrives in (DEEP-AUDIT-2026-07-11 §16).
   OxyDex / PulseDex / HRVDex / CPAPDex NORMALIZE the stamp to `{version, hash}` before exporting, but
   ECGDex / PpgDex / GlucoDex pass `opts.kernel` straight through — which is the RAW DexKernel object,
   `{K, VERSION, HASH}`. The Integrator only ever read the lowercase keys, so those three nodes always
   resolved to `hash: null` → status 'missing'. Two consequences, both bad:
     · On EVERY real multi-node night the user was told "Node ECGDex built against kernel (none),
       expected 118ebed5 — thresholds may differ." That is FALSE: the export carries exactly 118ebed5,
       under HASH. Three of seven nodes cried wolf on every fusion.
     · Worse, a GENUINE kernel drift in those nodes produced the IDENTICAL 'missing' verdict — so the
       audit could not distinguish real threshold drift from its own blindness. The one thing it exists
       to catch was the one thing it could not see.
   Read both spellings here rather than only fixing the emitters, so exports ALREADY IN THE WILD are
   audited correctly too. (The emitters are normalized as well — see the *-dsp.js kernel stamps.) */
function _kernelHash(k) {
  return (k && (k.hash != null ? k.hash : k.HASH)) || null;
}
function _kernelVersion(k) {
  return (k && (k.version != null ? k.version : k.VERSION)) || null;
}

/* P8/kernel: compare each node's stamped physiology-kernel hash against THIS
   Integrator's own DexKernel.HASH. A node whose hash differs (or is missing) was
   built against a different rulebook — flag it so a cross-deployment threshold
   drift can't masquerade as agreement. Additive: legacy exports (no kernel stamp)
   are reported as 'missing', never crash. */
function auditNodeKernels(recs) {
  var expected = (typeof window !== 'undefined' && window.DexKernel && window.DexKernel.HASH) || null;
  var version = (typeof window !== 'undefined' && window.DexKernel && window.DexKernel.VERSION) || null;
  var nodes = [],
    mismatches = [],
    seen = {};
  (recs || []).forEach(function (r) {
    var key = r.node + '|' + (r.kernelHash || '');
    if (seen[key]) return;
    seen[key] = 1;
    var hash = r.kernelHash || null;
    var status = hash == null ? 'missing' : expected != null && hash === expected ? 'match' : 'mismatch';
    var entry = { node: r.node, hash: hash, version: r.kernelVersion || null, status: status };
    nodes.push(entry);
    if (status !== 'match') mismatches.push(entry);
  });
  return { expected: expected, version: version, nodes: nodes, mismatches: mismatches, ok: mismatches.length === 0 };
}
function runFusion(recs, opts) {
  opts = opts || {};
  var dtMs = (opts.toleranceSec != null ? opts.toleranceSec : 120) * 1000;
  // ── P8/kernel audit: every node carries the physiology-kernel stamp of the
  // build that produced it. If a node's hash ≠ THIS Integrator's own kernel
  // hash (or is missing), the two are running different threshold rulebooks —
  // they would "agree with themselves" while silently diverging. Surface it. ─
  var kernelAudit = auditNodeKernels(recs);
  // R5 directionality gate params (asymmetric, seconds). Surge may lead the
  // nadir by ≤leadMaxSec and trail by ≤trailMaxSec.
  var gate = { leadMaxSec: opts.leadMaxSec != null ? opts.leadMaxSec : 15, trailMaxSec: opts.trailMaxSec != null ? opts.trailMaxSec : 60 };
  var dated = recs.filter(function (r) {
    return !r.dateUnknown;
  });
  // overall window across dated recs + pairwise overlaps
  var startMs = null,
    endMs = null;
  dated.forEach(function (r) {
    var w = recWindow(r);
    if (!w) return;
    if (startMs == null || w.startMs < startMs) startMs = w.startMs;
    if (endMs == null || w.endMs > endMs) endMs = w.endMs;
  });
  var pairs = [];
  for (var i = 0; i < dated.length; i++)
    for (var j = i + 1; j < dated.length; j++) {
      var ov = overlapInterval(dated[i], dated[j]);
      pairs.push({ a: dated[i].label, an: dated[i].node, b: dated[j].label, bn: dated[j].node, aWin: recWindow(dated[i]), bWin: recWindow(dated[j]), overlap: ov });
    }
  var anyOverlap = pairs.some(function (p) {
    return p.overlap;
  });

  // ── R3: TRUE overlap geometry, not a sum of pairwise overlaps. ────────────
  //   overlapUnionMin  = minutes covered by ANY pair (merged union — no double count)
  //   intersectionMin  = minutes where ALL dated nodes coincide (N-way; 0 if any disjoint)
  //   pairwiseSumMin    = the OLD (mislabeled) number, kept only for transparency
  //   nodesExcluded     = dated nodes that overlap nothing (e.g. GlucoDex 66 days off)
  var ivs = [];
  pairs.forEach(function (p) {
    if (p.overlap) ivs.push([p.overlap.startMs, p.overlap.endMs]);
  });
  var overlapUnionMs = _mergeMs(ivs);
  var pairwiseSumMin = pairs.reduce(function (s, p) {
    return s + (p.overlap ? p.overlap.overlapMin : 0);
  }, 0);
  // N-way intersection of every dated rec
  var interStart = /** @type {any} */ (null),
    interEnd = /** @type {any} */ (null),
    haveAll = dated.length >= 2;
  dated.forEach(function (r) {
    var w = recWindow(r);
    if (!w) {
      haveAll = false;
      return;
    }
    interStart = interStart == null ? w.startMs : Math.max(interStart, w.startMs);
    interEnd = interEnd == null ? w.endMs : Math.min(interEnd, w.endMs);
  });
  var intersectionMin = haveAll && interStart != null && interEnd > interStart ? (interEnd - interStart) / 60000 : 0;
  // a dated node is "excluded" if it overlaps no other node at all
  var nodesExcluded = dated
    .filter(function (r) {
      return !pairs.some(function (p) {
        return p.overlap && (p.a === r.label || p.b === r.label);
      });
    })
    .map(function (r) {
      return r.node + (r.dateStr ? ' · ' + r.dateStr : '');
    });

  var apnea = anyOverlap ? fuseApneaEvents(recs, dtMs, gate) : null;
  var positional = apnea ? labelPositionalApnea(recs, apnea) : null;
  var autoGly = anyOverlap ? fuseAutonomicGlycemic(recs, dtMs, opts) : null;
  var hrv = anyOverlap ? fuseHRVConsensus(recs, dtMs) : null;
  var staging = anyOverlap ? fuseStagingConsensus(recs) : null;
  var periodicBreathing = anyOverlap ? fusePeriodicBreathing(recs) : null;

  // ── Part C — GRACEFUL HR/bpm DEGRADATION (§6 authority matrix) ─────────────
  // Pick the authoritative LIVE HR/bpm source (ECG > pulse-ox > PPG). When the
  // chest ECG drops out mid-record the Integrator must fall back to the next
  // authority WITHOUT inheriting that backup's artifacts: a dropout on signal A
  // never opens the gate to a false event on signal B (desats stay independently
  // self-gated at the node + consequence-checked above). Additive — does not
  // change any fusion count. ─────────────────────────────────────────────────
  var hrLive = dated
    .filter(function (r) {
      return HR_AUTHORITY[r.node] != null && r.nEvents > 0;
    })
    .map(function (r) {
      return { node: r.node, label: r.label, nEvents: r.nEvents };
    });
  var hrPick = pickHRAuthority(hrLive);
  var hrSource = hrLive.length
    ? {
        node: hrPick ? hrPick.node : null,
        authority: hrPick ? HR_AUTHORITY[hrPick.node] : null,
        fellBack: !!(hrPick && hrPick.node !== 'ECGDex'),
        available: hrLive.map(function (h) {
          return h.node;
        }),
        note: hrPick
          ? hrPick.node === 'ECGDex'
            ? 'HR/bpm from chest ECG (primary authority).'
            : 'Chest ECG unavailable — HR/bpm sourced from ' + hrPick.node + ' (authority ' + HR_AUTHORITY[hrPick.node] + '). A fault on another signal does not open the gate to a false event here.'
          : 'No live HR/bpm source.'
      }
    : null;

  // flatten findings list
  var findings = apnea ? apnea.findings.slice() : [];
  if (autoGly && autoGly.glucoseAutonomicCorrelation != null) {
    findings.push({
      tMs: startMs || 0,
      type: 'glucose_autonomic_correlation',
      conf: 0.6,
      nodes: ['ECGDex', 'GlucoDex'],
      sources: [],
      meta: { r: autoGly.r, directional: autoGly.directional, n: autoGly.n },
      note: autoGly.note
    });
  }
  // T2: surface single-signal staging disagreement as an explicit finding
  if (staging && staging.blocks) {
    staging.blocks.forEach(function (b) {
      if (!b.disagreement) return;
      findings.push({ tMs: startMs || 0, type: 'staging_disagreement', conf: null, nodes: b.nodes, sources: [], meta: { remGapPct: b.remGapPct, remByNode: b.remByNode }, note: b.note });
    });
  }
  // §2: surface CORROBORATED periodic-breathing windows (≥2 independent signals) as findings
  if (periodicBreathing && periodicBreathing.blocks) {
    periodicBreathing.blocks.forEach(function (b) {
      findings.push({
        tMs: b.t0Ms != null ? b.t0Ms : startMs || 0,
        type: 'periodic_breathing',
        conf: b.conf,
        nodes: b.observerNodes,
        sources: b.sources,
        meta: {
          nObservers: b.nObservers,
          corroborated: b.corroborated,
          window: b.window,
          byNode: b.sources.map(function (o) {
            return { node: o.node, channel: o.channel, tier: o.tier, episodes: o.episodes, pbPct: o.pbPct, cvhrIndex: o.cvhrIndex, conf: o.conf };
          })
        },
        note: b.note
      });
    });
  }
  // P2: one canonical chronological order shared by UI table, JSON and CSV (nulls last)
  findings.sort(function (a, b) {
    return (a.tMs == null ? Infinity : a.tMs) - (b.tMs == null ? Infinity : b.tMs);
  });

  return {
    bus: BUS,
    kind: 'fusion',
    generated: new Date().toISOString(),
    window: {
      startMs: startMs,
      endMs: endMs,
      spanMin: startMs != null && endMs != null ? +(/** @type {any} */ ((endMs - /** @type {any} */ (startMs)) / 60000).toFixed(1)) : null,
      // overlapMin now = TRUE merged-union minutes (was: sum of pairwise — see R3)
      overlapMin: +(overlapUnionMs / 60000).toFixed(1),
      overlapUnionMin: +(overlapUnionMs / 60000).toFixed(1),
      intersectionMin: +intersectionMin.toFixed(1),
      pairwiseSumMin: +pairwiseSumMin.toFixed(1),
      nodesExcluded: nodesExcluded
    },
    matchWindow: { leadMaxSec: gate.leadMaxSec, trailMaxSec: gate.trailMaxSec, directionalWindowSec: gate.leadMaxSec + gate.trailMaxSec, unionPrefilterSec: dtMs / 1000 },
    anyOverlap: anyOverlap,
    kernelAudit: kernelAudit,
    hrSource: hrSource,
    pairs: pairs,
    apnea: apnea,
    positional: positional,
    autoGly: autoGly,
    hrv: hrv,
    staging: staging,
    periodicBreathing: periodicBreathing,
    findings: findings,
    unmatched: apnea ? apnea.unmatched : { desat: [], surge: [] },
    nodes: recs.map(function (r) {
      return { node: r.node, label: r.label, date: r.dateStr, window: recWindow(r), nEvents: r.nEvents, dateUnknown: r.dateUnknown };
    })
  };
}

/* Build the slim export object (the cross-node currency written back to the bus). */
function buildFusionExport(recs, fusion) {
  return {
    kernel: window.DexKernel ? { version: DexKernel.VERSION, hash: DexKernel.HASH } : null,
    kernelAudit: fusion.kernelAudit || null,
    schema: {
      name: BUS + '.fusion-export',
      version: '1.3',
      generated: fusion.generated,
      provenance: window.GangliorProvenance ? GangliorProvenance.stamp() : null, // R1: build + input fingerprints
      doc: 'Integrator (Ganglior fusion layer) cross-signal findings. Times are floating wall-clock ms (tMs); string fields via fmtDateTime (UTC getters).',
      method: {
        confidence:
          'Each finding conf = noisy-OR of its sources: conf = 1 − ∏(1 − cᵢ), capped at 0.97, rounded to 3 dp. Per source, cᵢ = effConf = conf × (sqi ?? 1): the event-likelihood (scaled to surge magnitude / desat depth) attenuated by local signal quality (R7). Raw conf, sqi and effConf are retained in each finding’s sources[].',
        apneaMatch:
          'confirmed_apnea_event = SpO₂ desaturation ⟷ nearest unused autonomic surge from ECGDex|PpgDex, within an asymmetric directional window (surge may lead the nadir by ≤leadMaxSec, trail by ≤trailMaxSec; R5). One surge confirms at most one desat.',
        nullModel:
          'confirmedApneaIndex is published (reportable=true) only when the confirmed count exceeds a per-night Poisson chance expectation; otherwise findings carry belowChance=true + pSpurious and the index is withheld (R5).',
        apneaCoupling:
          'apneaCoupling is the EventCoupling shuffled-null verdict for desat⟷surge: circular time-shift surrogates vs a coverage-aware baseline (coverage = the recording overlap, so a desat outside the cardiac window is excluded, not a miss). Read real/lift ONLY when usable (neither underpowered=expectedHits<3 nor saturated=maxLift<1.5). Additive to the Poisson nullModel; does not change reportability (§P7).',
        window:
          'window.overlapMin / overlapUnionMin = merged-union minutes where ≥2 nodes coincide (NOT a sum of pairwise overlaps); intersectionMin = N-way all-node overlap; pairwiseSumMin retained for transparency; nodesExcluded = dated nodes overlapping nothing (R3).',
        hrvConsensus: 'HRV consensus compares whole-record SDNN/RMSSD/LF-HF across nodes (window-normalized; epoch-scoped variants kept separately); same-window only (R8).',
        periodicBreathing:
          'periodic_breathing = a PB / Cheyne–Stokes window corroborated across ≥2 independent signals (OxyDex SpO₂ oscillation · CPAPDex device flow · ECGDex cardiac CVHR), grouped by night-overlap; conf is the tier-weighted noisy-OR (device 1.0 · CVHR 0.8 · oximetry proxy 0.6). Graded experimental — a corroboration signal, not a scored CSR index (§2).'
      }
    },
    bus: BUS,
    kind: 'fusion',
    generated: fusion.generated,
    window: {
      startMs: fusion.window.startMs,
      endMs: fusion.window.endMs,
      start: fusion.window.startMs != null ? fmtDateTime(fusion.window.startMs) : null,
      end: fusion.window.endMs != null ? fmtDateTime(fusion.window.endMs) : null,
      spanMin: fusion.window.spanMin,
      overlapMin: fusion.window.overlapMin,
      overlapUnionMin: fusion.window.overlapUnionMin,
      intersectionMin: fusion.window.intersectionMin,
      pairwiseSumMin: fusion.window.pairwiseSumMin,
      nodesExcluded: fusion.window.nodesExcluded
    },
    matchWindow: fusion.matchWindow,
    nodes: fusion.nodes,
    confirmedApneaIndex: fusion.apnea ? fusion.apnea.confirmedAHI : null,
    confirmedApneaIndexReportable: fusion.apnea ? !!fusion.apnea.confirmedAHIReportable : false,
    apneaNullModel: fusion.apnea ? fusion.apnea.nullModel : null,
    // P7: the EventCoupling shuffled-null verdict for desat⟷surge (coverage-aware; read `real`/`lift`
    // only where `usable`). Additive + null-tolerant; the Poisson apneaNullModel above is unchanged.
    apneaCoupling: fusion.apnea ? fusion.apnea.coupling || null : null,
    // P1: serialize the 3 computed-and-displayed results the export previously dropped (additive, null-tolerant)
    positional: fusion.positional || null,
    hrvConsensus: fusion.hrv || null,
    periodicBreathing: fusion.periodicBreathing || null,
    deviceScoredAHI: (fusion.apnea && fusion.apnea.apneaAuthority) || null,
    findings: fusion.findings.map(function (f) {
      return {
        tMs: f.tMs,
        time: f.tMs != null ? fmtDateTime(f.tMs) : null,
        type: f.type,
        conf: f.conf,
        belowChance: f.belowChance != null ? f.belowChance : undefined,
        pSpurious: f.pSpurious != null ? f.pSpurious : undefined,
        durSec: f.durSec || null,
        nodes: f.nodes,
        sources: f.sources,
        meta: f.meta,
        note: f.note
      };
    }),
    unmatched: {
      desat: fusion.unmatched.desat.map(function (e) {
        return { tMs: e.tMs, time: fmtDateTime(e.tMs), conf: e.conf, meta: e.meta };
      }),
      surge: fusion.unmatched.surge.map(function (e) {
        return { tMs: e.tMs, time: fmtDateTime(e.tMs), conf: e.conf };
      })
    },
    // §6 closed handshakes written back so nodes can ingest
    handshakes: {
      glucodex_ready: { glucose_autonomic_correlation: fusion.autoGly ? fusion.autoGly.glucoseAutonomicCorrelation : null },
      ecgdex_ready: { glucoseCorrelation: fusion.autoGly ? fusion.autoGly.glucoseAutonomicCorrelation : null }
    }
  };
}

/* ── Evidence-grade resolver — a metric's tier is a NODE fact from its
   <node>-registry.js (CLAUDE.md single-source rule). The Integrator bundle does NOT
   load the node registries, so GRADE_MIRROR carries the authoritative tiers and
   gradeFor() prefers the live registry object if one is present (auto-tracks).
   GRADE_SOURCES is the single (id ↔ node ↔ registry) map both the mirror and the
   test read; the shared suite's "Integrator evidence-grade mirror" group asserts
   GRADE_MIRROR ≡ each registry's evidence, so the mirror can never silently drift.
   Verified June 2026: minSpo2 + residualAHI are 'measured' (raw device readings),
   NOT 'validated' — the prior hardcoding mis-graded them. */
var GRADE_SOURCES = [
  { node: 'OxyDex', id: 'odi4', reg: 'OXY_REGISTRY', regId: 'odi4' },
  { node: 'OxyDex', id: 'minSpo2', reg: 'OXY_REGISTRY', regId: 'minSpo2' },
  { node: 'ECGDex', id: 'rmssd', reg: 'ECG_REGISTRY', regId: 'rmssd' },
  { node: 'ECGDex', id: 'sdnn', reg: 'ECG_REGISTRY', regId: 'sdnn' },
  { node: 'GlucoDex', id: 'glucoseCV', reg: 'GLU_REGISTRY', regId: 'cv' }, // envelope id → registry id
  { node: 'CPAPDex', id: 'residualAHI', reg: 'CPAP_REGISTRY', regId: 'residualAHI' }
];
var GRADE_MIRROR = { odi4: 'validated', minSpo2: 'measured', rmssd: 'validated', sdnn: 'validated', glucoseCV: 'validated', residualAHI: 'measured' };
function gradeFor(node, id) {
  try {
    for (var i = 0; i < GRADE_SOURCES.length; i++) {
      var s = GRADE_SOURCES[i];
      if (s.node === node && s.id === id) {
        var reg = typeof window !== 'undefined' ? window[s.reg] : null;
        if (reg && reg[s.regId] && reg[s.regId].evidence) return reg[s.regId].evidence; // live registry wins
        break;
      }
    }
  } catch (_) {}
  return GRADE_MIRROR[id] || 'experimental';
}

/* expose to other page scripts (plain global scope, but be explicit) */
window.IntegratorDSP = {
  BUS: BUS,
  parseTimestamp,
  reconstructEventTMs,
  fmtClock,
  fmtClockS,
  fmtDate,
  fmtDateTime,
  fmtDayShort,
  nodeColor,
  NODE_COLORS,
  normalizeFile,
  dedupeRecs,
  recWindow,
  overlapInterval,
  runFusion,
  buildFusionExport,
  combineConf,
  glucoseMetricsInWindow,
  corroborateDesat,
  pickHRAuthority,
  gradeFor,
  GRADE_MIRROR,
  GRADE_SOURCES
};
