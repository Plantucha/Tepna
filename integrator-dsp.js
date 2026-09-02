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
   earlier than the recording's start-of-day clock (handles 22:50 → 02:14).

   ⚠️ prevTMs is DELIBERATELY pinned to t0Ms — NOT threaded from the previously
   reconstructed event (DEEP-AUDIT-II #42). A fixed anchor keeps reconstruction
   ORDER-INDEPENDENT: every event resolves on its own, so the result never
   depends on iteration order or on which events were seen first. Do NOT "fix"
   this into a stateful prevTMs roll: it would trade a real invariant
   (order-independence) for nothing.

   ⚠ SIGNAL-PATH-AUDIT F3 (2026-08-20): this comment used to claim the pinned
   anchor was "EXACT for any recording ≤ 24 h". FALSE — the parser's day-roll
   slack is 12 h, so a t-only event whose true offset lay in [12 h, 24 h) got a
   same-date candidate 0–12 h BEFORE t0Ms (inside the slack), the roll was
   refused, and the event landed 24 h early — before the recording began.
   Executed reproduction: t0 = 20:00, t:"08:00:00" (+12 h) → −24.00 h. The
   post-correction below restores the true ≤ 24 h contract while staying a pure
   function of (ev.t, t0Ms): an event belongs to [t0Ms − grace, t0Ms + 24 h), so
   a candidate below that window is advanced exactly one day. The 60 s grace
   absorbs second-rounding jitter between an event stamp and t0 without
   re-admitting the bug (the failure band started at +12 h, far above it).

   Known limit (latent, out-of-contract): a t-ONLY event whose true offset from
   t0Ms exceeds 24 h can only roll one day, so its date is genuinely UNKNOWN.
   This does not bite in practice — per-recording envelopes are < 24 h, and
   modern emitters carry absolute `tMs` (§6), which the fast-path below returns
   verbatim before any roll. Disambiguating a >24 h t-only envelope would need
   the caller's span; it is flagged here rather than silently mis-dated. */
function reconstructEventTMs(ev, t0Ms) {
  if (ev && typeof ev.tMs === 'number' && isFinite(ev.tMs)) return ev.tMs; // already absolute
  if (t0Ms == null || ev == null || ev.t == null) return null;
  var p = parseTimestamp(ev.t, { dateAnchorMs: t0Ms, prevTMs: t0Ms });
  if (!p) return null;
  var t = p.tMs;
  if (t < t0Ms - 60000) t += 86400000; // F3: the event window is [t0 − 60 s, t0 + 24 h); see above
  return t;
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
  MotionDex: '#F0A860',
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
    // DEEP-AUDIT-II §7.6 — MotionDex's export writes recording.durSec (motiondex-dsp.js buildNodeExport),
    // which none of the keys above name, so a MotionDex envelope's declared length was ignored here and its
    // fusion-overlap window collapsed to the last posture_change event (all-node overlap read ~40 min for an
    // 8 h night). Honor `durSec` too — additive + back-compat (only consulted when durationSec is absent).
    var _durSec = _rec.durationSec != null ? _rec.durationSec : _rec.durSec != null ? _rec.durSec : json.durationSec != null ? json.durationSec : json.durSec != null ? json.durSec : null;
    if (_endEp != null) _declEnd = _endEp;
    else if (_durMin != null) _declEnd = t0Ms + _durMin * 60000;
    else if (_durMs != null) _declEnd = t0Ms + _durMs;
    else if (_durSec != null) _declEnd = t0Ms + _durSec * 1000;
    if (_declEnd != null) endMs = endMs != null ? Math.max(endMs, _declEnd) : _declEnd;
    /* §6.2 — SPARSE coverage extends the ENVELOPE (so the record is no longer a point and stops being
       "excluded — no temporal overlap") WITHOUT claiming the span was recorded. The segments travel
       separately and are what overlap is actually judged on; `spanSec` is never treated as a duration. */
    if (_rec.coverage && Array.isArray(_rec.coverage.segments) && _rec.coverage.segments.length) {
      var _cs = _rec.coverage.segments;
      var _last = _cs[_cs.length - 1];
      if (_last && _last.startMs != null && isFinite(_last.startMs)) {
        var _cEnd = _last.startMs + (_last.durSec != null && isFinite(_last.durSec) ? _last.durSec * 1000 : 0);
        endMs = endMs != null ? Math.max(endMs, _cEnd) : _cEnd;
      }
    }
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
    /* ECGDex's `apnea.estimatedAHI` is RETIRED (ECGDEX-CARDIOPULMONARY-COUPLING §10) and is NOT read
       into `summary.estAHI` any more — not even when a LEGACY export still carries it.

       It was never an AHI: `value` was `Math.round(cvhrIndex)` with AHI's clinical bands stapled on,
       and §9 measured that index against device-scored residual AHI over 39 paired nights at
       r = −0.151, p = 0.36. Current exports omit the field, so this line only ever fired on a
       pre-2026-07-31 export — and precisely there it did the most damage, because `:555` overwrites
       `estAHI` from CPAP's device-scored `residualAHI` ONLY when a CPAP night is present. A NON-CPAP
       fusion of a legacy ECGDex export therefore surfaced the retired proxy as the night's AHI, with
       nothing downstream to correct it.

       Deliberately NOT deleting the tolerant read elsewhere: consumers must keep PARSING legacy
       exports (Clock-Contract §6's spirit — tolerate what old emitters wrote). What changes is that
       the value is no longer TRUSTED. `ahiSource` says so, so a reader can tell "no AHI known" from
       "AHI is zero". */
    summary.estAHI = null;
    summary.ahiSource = json.apnea && json.apnea.estimatedAHI ? 'none — legacy ECGDex estimatedAHI ignored (retired: r = −0.151 vs device AHI)' : 'none — ECGDex measures CVHR, not AHI';
    // R8: cross-node HRV must compare the SAME analysis window. ECGDex's bare
    // hrv.time.{sdnn,rmssd} is the DISPLAY value (epoch-median for overnight) —
    // NOT comparable to another node's whole-record SDNN. Normalize the consensus
    // axis to WHOLE-RECORD, and carry the epoch-scoped variants under explicit keys.
    var _ht = (json.hrv && json.hrv.time) || {},
      _hf = (json.hrv && json.hrv.frequency) || {};
    summary.rmssd = _ht.wholeRecordRMSSD != null ? _ht.wholeRecordRMSSD : _ht.rmssd != null ? _ht.rmssd : json.hrv ? json.hrv.rmssd : null;
    summary.sdnn = _ht.wholeRecordSDNN != null ? _ht.wholeRecordSDNN : _ht.sdnn != null ? _ht.sdnn : json.hrv ? json.hrv.sdnn : null;
    summary.lfhf = _hf.lfhf != null ? _hf.lfhf : json.hrv ? json.hrv.lfhf : null;
    // §2.2: ECGDex's RSA/EDR respiration estimate. It is ALREADY in the rich export
    // (hrv.frequency.respRate, method 'RSA (HF-peak of RR spectrum)') — the Integrator simply never
    // read it, so a respiration vital the suite computes reached no fusion. 0 means 'not estimated'
    // in the DSP's spectral path, so it is normalized to null here rather than published as 0 bpm.
    summary.respRateBrpm = _hf.respRate != null && _hf.respRate > 0 ? _hf.respRate : null;
    summary.respRateMethod = summary.respRateBrpm != null ? _hf.respRateMethod || 'RSA (ECG)' : null;
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
      /* DEEP-AUDIT-FOLLOWUPS §C2 — this leg divides by TOTAL SLEEP; the OxyDex leg further down
         divides by RECORDING. Naming the basis is what lets fuseStagingConsensus refuse to compare
         across them instead of silently treating the two as commensurate. */
      summary.remFractionBasis = 'sleep';
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
      // OXYDEX-PULSE-RESOURCING §Phase 2: the optical site + the WAVEFORM-derived pulse HR. Only a
      // `site:'finger'` PpgDex export is the O2Ring's own pleth — the honest leg fusePulseCrossCheck
      // compares against the ring's smoothed 1 Hz pulse.
      summary.site = _dig(json, ['recording', 'site']) || 'wrist';
      summary.pulseHr = _dig(json, ['hrv', 'time', 'hr']);
      // OXYDEX-PULSE-RESOURCING §Phase 3: the finger-waveform WHOLE-RECORD HRV (ms — real RR-interval
      // RMSSD/SDNN). fuseHrvResource publishes these as the honest, ring-context HRV that SUPERSEDES the
      // O2Ring 1 Hz bpm-proxy when a finger capture exists. sdnnRobust is the cross-node-comparable SDNN
      // (quality-gated per-5-min median, ~+3.5% vs ECG truth per the PpgDex export's own sdnnNote).
      summary.rmssdMs = _dig(json, ['hrv', 'time', 'rmssd']);
      summary.sdnnRobustMs = _dig(json, ['hrv', 'time', 'sdnnRobust']);
      summary.sdnnMs = _dig(json, ['hrv', 'time', 'sdnn']);
      summary.hrvLowConfidence = _dig(json, ['hrv', 'time', 'lowConfidence']);
      // OXYDEX-PULSE-RESOURCING §Phase 4: the finger-PPI CVHR (events/h, autonomic apnea correlate).
      // DISTINCT field from ECGDex's `summary.cvhrIndex` on purpose — the PB-consensus _pbObserver reads
      // `cvhrIndex` (ECGDex/OxyDex/CPAPDex only), so a separate name keeps that consensus + its fixtures
      // byte-identical while fuseCvhrCorroboration corroborates this against the ECGDex cardiac CVHR.
      summary.cvhrIndexWave = _dig(json, ['apnea', 'cvhrIndex']);
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
  if (node === 'OxyDex') {
    // OXYDEX-PULSE-RESOURCING §Phase 2: surface the ring's SMOOTHED 1 Hz pulse HR (stats.meanHr) so
    // fusePulseCrossCheck can hold it up against a finger-PpgDex WAVEFORM HR. This is the DEVICE leg,
    // not the honest one — §5: the 1 Hz field is never ground truth, only the compared-against value.
    // ⚠️ ROUTING (corrected — INTEGRATOR-OXYDEX-ADAPTER-GAP §4.1, verified on the real corpus): this
    // branch is NOT the live OxyDex path. `normalizeFile` intercepts EVERY OxyDex shape at the
    // `json.nights || json.desatProfile || json.hr_spikes || Array.isArray(json)` test and routes it to
    // adaptOxyDex — the envelope always carries `nights` (oxydex-dsp.js:5604) and a bare single-night
    // object always carries `hr_spikes` (:5733), so the predicate cannot miss. All 7 corpus exports
    // (incl. the synthetic golden) take adaptOxyDex. Keep the two summaries RECONCILED anyway: this
    // branch is the fallback for any future OxyDex-shaped payload that fails that predicate.
    summary.pulseHr1Hz = _dig(json, ['stats', 'meanHr']);
    // OXYDEX-PULSE-RESOURCING §Phase 3: the ring's own 1 Hz HRV PROXIES (bpm-DOMAIN — RMSSD/SD of the
    // pulse RATE, NOT RR intervals). fuseHrvResource carries them ALONGSIDE the finger-waveform ms-HRV
    // for continuity; it never averages across the unit boundary (bpm ≠ ms). `hrv.hrSdnn` is hrVarSd.
    summary.rmssd1Hz = _dig(json, ['hrv', 'rmssd']);
    summary.hrVarSd1Hz = _dig(json, ['hrv', 'hrSdnn']);
  }
  if (node === 'MotionDex') {
    // Motion / IMU node-export (APNEA-TYPING-FUSION-2026-07-18 §1.1). The per-epoch respiratory-EFFORT
    // series is the apnea-typing input; the scalars are the night-level motion surface. Everything here is
    // additive + null-tolerant — a night with no MotionDex simply carries none of it and the typing
    // degrades to "not typed" (nodes are independent; MotionDex is OPTIONAL to the Integrator).
    var mo = json.motion || {};
    summary.supineFrac = mo.supineFrac != null ? mo.supineFrac : null;
    summary.dwellFrac = mo.dwellFrac || null;
    summary.immobileFrac = mo.immobileFrac != null ? mo.immobileFrac : null;
    summary.movementIndex = mo.movementIndex != null ? mo.movementIndex : null;
    summary.respRateBrpm = mo.respRateBrpm != null ? mo.respRateBrpm : null;
    summary.respRateMethod = summary.respRateBrpm != null ? 'chest-ACC (thoraco-abdominal)' : null;
    summary.motionSqi = mo.sqi != null ? mo.sqi : null;
    summary.effortSeries = _motionEffortSeries(json, t0Ms);
    summary.effortCadenceSec = mo.effortCadenceSec != null ? mo.effortCadenceSec : null;
    // per-epoch movement track (§2.4 HRV gate). `moving` is TRI-STATE — null = accelerometer not
    // recording, which must never be counted as "still" (a gap would otherwise buy a quiet night).
    summary.activitySeries = _motionActivitySeries(json, t0Ms);
    summary.activityCadenceSec = mo.activityCadenceSec != null ? mo.activityCadenceSec : null;
    // MotionDex publishes posture as run-length `posture_change` events — expand them into the SAME
    // { tMs, pos } series ECGDex/PpgDex use, so the existing positional-apnea path consumes it directly.
    // (§1.2. This previously called _ecgPostureSeries, which reads json.acc / json.timeseries.acc —
    // fields a MotionDex export does not carry — so it silently produced an empty series.)
    summary.posture = _motionPostureSeries(json, t0Ms);
    if (summary.posture && summary.posture.length) summary.postureSource = 'motion-acc';
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
          /* This map is a WHITELIST — a key the node adds is dropped here unless named. `hrStat` says
             WHICH statistic the node's `hr` is (R5-HR-TRIPLET-FOLLOWUPS); without it the HR-hat
             differences three legs that do not agree on the question, which is how a 0.299 bpm
             estimator gap was read as a 0.36 bpm device bias. `null` on a node that has not declared
             one — absent, never assumed. */
          hrStat: typeof e.hrStat === 'string' && e.hrStat ? e.hrStat : null,
          motion: e.motionIndex != null && isFinite(e.motionIndex) ? e.motionIndex : null
        };
      })
      .filter(function (x) {
        return x;
      });
  }
  /* THE OXIMETER'S PRIMARY SIGNAL, NOW THAT IT LEAVES THE NODE (OXYDEX-SPO2-SERIES).

     OxyDex exported SpO2 nowhere until 2026-07-31: the timeseries block was 89 five-minute epochs of
     {hr, motionIndex} for a night in which the device recorded ~26,500 samples. The series now ships
     at 1 Hz — and until this reader existed the fusion still could not see it, so the field benefited
     analysis scripts only. A producer with no consumer is half a change.

     CARRIED, NOT RESAMPLED. The grid is uniform from `startEpochMs` at `hz`, so a consumer derives an
     absolute stamp by index and nothing here needs to interpolate. `null` is preserved as `null`: a
     second the device never reported is not 0 — which reads as the most severe desaturation physically
     possible — and not the previous value, which reads as stable oxygen. Resampling onto some other
     grid HERE would have to invent a rule for those holes, and the honest rule is to hand the caller
     the holes.

     NULL-TOLERANT AND ADDITIVE, like every series above: a node without the block (an export predating
     the field, or a night with no usable SpO2) simply carries none. */
  var _sp = json.timeseries && json.timeseries.spo2;
  if (_sp && Array.isArray(_sp.values) && _sp.values.length && t0Ms != null) {
    var _hz = _sp.hz != null && isFinite(_sp.hz) && _sp.hz > 0 ? _sp.hz : 1;
    seriesOut.spo2 = {
      hz: _hz,
      t0Ms: t0Ms,
      // Sanitised on the way in: a non-finite entry becomes an explicit hole rather than a NaN that
      // would propagate silently through whatever consumes it.
      values: _sp.values.map(function (v) {
        return v != null && isFinite(v) ? v : null;
      })
    };
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
      // WHERE THIS RECORDING'S TIMING CAME FROM — plumbed from the node export's top-level
      // `timingSource` (ppgdex-dsp.js:3333; also accepted under hostAxis for a raw export). WITHOUT
      // THIS the field never reaches the fusion recs, so every drawn-axis guard downstream — closure's
      // §F3 filter AND _tchHat — reads `undefined` and keeps a leg that carries NO timing (proven: a
      // `timingSource:'none'` PpgDex was spent as a full TCH corner). 'none' = drawn axis, no host
      // anchors; 'host'/'device+host'/'device'/null = usable. WEARABLE-HOST-AXIS-FOLLOWUPS §F1/§F3.
      /* `quality.timingSource` ADDED 2026-08-17 — WITHOUT IT THIS GUARD WAS INERT. The chain read the
         top level and `hostAxis`; PpgDex writes it under `quality` (verified on a real export:
         `quality.timingSource === 'device+host'`, top level ABSENT). So every node resolved to `null`
         and both drawn-axis guards downstream — closure's §F3 filter and `_tchHat` — excluded NOBODY
         on the whole trio corpus. The comment above cites `ppgdex-dsp.js:3333` for a top-level field;
         that line is `buildEpochs` today, so the reference drifted and the path was never re-checked
         against an actual export. */
      timingSource:
        json.timingSource != null
          ? json.timingSource
          : (json.quality && json.quality.timingSource) || (json.hostAxis && json.hostAxis.timingSource) || (json.recording && json.recording.timingSource) || null,
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
      /* §6.2 — SPARSE coverage travels so overlap can be judged on RECORDED time (recSegments /
         segmentsOverlap). Null for every node that records continuously, which is all of them today
         except HRVDex — the envelope path is unchanged for those. */
      coverage: (json.recording && json.recording.coverage) || null,
      /* FINISHED-WORK-IMPROVEMENTS §A 2b — RTC verification fields the source node's export declares
         when a `*_rtclog.csv` sidecar was matched (see 2a in oxydex-dsp.js). Carried onto the rec so
         the clock-skew path can DECLARE (not silently correct) a large `|rtcOffsetS|` as a finding
         with `source:'rtc-readback'` and VETO a rec whose ring RTC reset mid-recording (a reset's
         offset is unmeasured by definition — the rec's placement is FLAGGED, never auto-shifted).
         Absent on every non-OxyDex node and on OxyDex nights that carried no sidecar — the rec keeps
         its historical shape and existing fixtures do not move. */
      rtcOffsetS: json.recording && json.recording.rtcOffsetS != null && isFinite(json.recording.rtcOffsetS) ? json.recording.rtcOffsetS : null,
      rtcVerifiedAtMs: json.recording && json.recording.rtcVerifiedAtMs != null && isFinite(json.recording.rtcVerifiedAtMs) ? json.recording.rtcVerifiedAtMs : null,
      rtcResetSuspect: !!(json.recording && json.recording.rtcResetSuspect),
      /* §F6 — a SLIM beat array, so beat-level timing is reachable inside the fusion.
         P9 above dropped the whole `json` because keeping multi-MB timeseries alive per recording
         bloated multi-night batches, and that decision stands: this carries beat INSTANTS only, as a
         packed Float64Array, and nothing else from `timeseries`. A 7 h night is ~30 k beats ≈ 240 kB,
         against the several MB the full block cost. Null for every node that emits no interval series. */
      beats: _beatTimes(json, t0Ms),
      raw: { ganglior_events: json.ganglior_events || json.events || null },
      _src: filename
    }
  ];
}

/* Absolute beat instants from the node-export's interval series (WEARABLE-HOST-AXIS-FOLLOWUPS §F6).
   `timeseries.rr.tSec` (ECGDex) and `timeseries.ppi.tSec` (PpgDex / PulseDex) are already in the export
   contract, so this needs no emitter change — it is the same reconstruction `tools/trio-batch.mjs` does
   to feed `fitClockDrift`, moved to where the fusion can reach it.

   CORRECTED BEATS ARE EXCLUDED. Both emitters mark interpolated / Malik-corrected intervals in a
   parallel `corrected[]`, and a corrected interval's endpoint is a beat nobody observed. Handing those
   to a timing estimator is the same class of error as reading a drawn axis as a clock — fabricated
   instants that a correspondence check will happily "agree" on, because both legs were smoothed toward
   the same place. */
function _beatTimes(json, t0Ms) {
  if (!json || t0Ms == null || !isFinite(t0Ms)) return null;
  var ts = json.timeseries || {};
  var ser = ts.rr || ts.ppi || null;
  if (!ser || !ser.tSec || !ser.tSec.length) return null;
  var src = ser.tSec,
    corr = ser.corrected,
    out = new Float64Array(src.length),
    n = 0;
  for (var i = 0; i < src.length; i++) {
    var s = src[i];
    if (s == null || !isFinite(s)) continue;
    if (corr && corr[i] != null && corr[i] !== 0) continue;
    out[n++] = t0Ms + s * 1000;
  }
  if (!n) return null;
  return { tMs: out.subarray(0, n), n: n, source: ts.rr ? 'rr' : 'ppi' };
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
/* MotionDex per-epoch respiratory-EFFORT track → [{ tMs, amp, present }] (APNEA-TYPING-FUSION §1.1).
   `present` is TRI-STATE and that is the whole point: true = effort detected, false = flat (no drive),
   NULL = the chest accelerometer was not recording that epoch. A null must NEVER be read as "no effort"
   — that is exactly how a coverage gap manufactures a central apnea (the ×0.72 artifact EVENT-COUPLING
   §2 found one modality over). tMs is reconstructed from t0Ms + i·cadence when the epoch omits it. */
function _motionEffortSeries(json, t0Ms) {
  var mo = (json && json.motion) || {};
  var src = mo.effortSeries;
  if (!Array.isArray(src) || !src.length) return null;
  var cadMs = (mo.effortCadenceSec != null ? mo.effortCadenceSec : 10) * 1000;
  var out = [];
  for (var i = 0; i < src.length; i++) {
    var e = src[i] || {};
    var tMs = e.tMs != null ? e.tMs : t0Ms != null ? t0Ms + i * cadMs : null;
    out.push({ tMs: tMs, amp: e.amp != null ? e.amp : null, present: e.present == null ? null : !!e.present });
  }
  return out;
}
/* MotionDex body-position track → the SAME { tMs, pos } series shape ECGDex/PpgDex publish
   (MULTI-SENSOR-DERIVATIONS §1.2). MotionDex emits posture as `posture_change` ganglior_events — a
   RUN-LENGTH encoding (a position holds until the next change), which is why it must be expanded here
   rather than exported densely: the step form is compact on the bus, and `posAt()` downstream matches on
   NEAREST-sample-within-10-min, which would miss a position that legitimately held for hours.
   Hold-last-value from each change up to a bounded MAX-HOLD horizon (NOT to the recording end).

   TRI-STATE PARITY (audit B·3a — a sensor-off gap must not fabricate a posture). MotionDex exports
   posture as sparse run-length `posture_change` events and DELIBERATELY drops 'unknown'/gap epochs, so
   the bus carries NO gap marker — a position that genuinely held for hours and a sensor-off gap AFTER
   that position are INDISTINGUISHABLE here (both are just "no further posture_change"). The old code
   hold-last-value-expanded the final transition all the way to t0Ms+durSec*1000, so a single early
   snapshot fabricated a whole night's posture; posAt() (nearest-within-10-min) then always found that
   fabricated value and positionalApnea() counted the apnea as supine/nonsupine — a MANUFACTURED clinical
   finding. Cap the hold at _MOTION_POS_MAX_HOLD_MS and emit NO sample beyond it, so during an un-held span
   posAt() finds nothing within its window → positionalApnea() takes its unknown++ path (leaving the
   supine/nonsupine DENOMINATOR), matching how _motionEffortSeries.present / _motionActivitySeries.moving
   drop a null gap epoch from their consumers' denominators. This is the Integrator-side stopgap; the real
   fix (MotionDex emitting an explicit gap/'unknown' marker on the bus) lives in motiondex-dsp.js.

   MAX-HOLD = 60 min. It must be long enough to preserve a legitimate run-length hold between two real
   posture transitions (position shifts in sleep occur ~1–3×/h, i.e. a mean inter-shift interval of
   ~20–60 min, with the longest stable supine stretches reaching an hour) yet short enough that a single
   unrefreshed snapshot is never projected across a multi-hour span where a dropped-gap export is at least
   as consistent with sensor-off as with a genuine hold. One hour is the upper end of the normal inter-shift
   distribution: within it we still hold-last-value (as MotionDex's run-length encoding intends); beyond it
   the leg abstains rather than invent a posture. _ecgPostureSeries (chest strap, higher §1.2 priority) is
   unaffected — it pushes only REAL samples and so already returns null during gaps. */
var _MOTION_POS_CAD_MS = 60000; // expansion cadence — well inside posAt()'s 10-min match window
var _MOTION_POS_MAX = 5000; // hard cap so a pathological export can't blow up memory
var _MOTION_POS_MAX_HOLD_MS = 3600000; // 60 min — max span a single posture snapshot is trusted without a refresh
function _motionPostureSeries(json, t0Ms) {
  var evs = (json && (json.ganglior_events || json.events)) || [];
  var steps = [];
  for (var i = 0; i < evs.length; i++) {
    var e = evs[i];
    if (!e || e.impulse !== 'posture_change') continue;
    var tMs = e.tMs != null ? e.tMs : t0Ms != null && e.t ? reconstructEventTMs(e, t0Ms) : null;
    var pos = e.meta && e.meta.position ? String(e.meta.position).toLowerCase() : null;
    if (tMs != null && pos && pos !== 'unknown') steps.push({ tMs: tMs, pos: pos });
  }
  if (!steps.length) return [];
  steps.sort(function (a, b) {
    return a.tMs - b.tMs;
  });
  var out = [];
  for (i = 0; i < steps.length && out.length < _MOTION_POS_MAX; i++) {
    var from = steps[i].tMs,
      next = i + 1 < steps.length ? steps[i + 1].tMs : Infinity,
      // Hold last value only up to the max-hold horizon — never across a longer gap (or to durSec end),
      // where the dropped-gap export can no longer be distinguished from the sensor being off.
      to = Math.min(next, from + _MOTION_POS_MAX_HOLD_MS);
    for (var t = from; t < to && out.length < _MOTION_POS_MAX; t += _MOTION_POS_CAD_MS) out.push({ tMs: t, pos: steps[i].pos });
  }
  return out;
}
/* MotionDex per-epoch MOVEMENT track → [{ tMs, count, moving }] (MULTI-SENSOR-DERIVATIONS §2.4).
   `moving` is TRI-STATE for the same reason `present` is on the effort series: null means the
   accelerometer was not recording that epoch, and a gap is NOT stillness. Reading null as "still"
   would hand a motion-gated HRV window a quality score it never earned. */
function _motionActivitySeries(json, t0Ms) {
  var mo = (json && json.motion) || {};
  var src = mo.activitySeries;
  if (!Array.isArray(src) || !src.length) return null;
  var cadMs = (mo.activityCadenceSec != null ? mo.activityCadenceSec : 30) * 1000;
  var out = [];
  for (var i = 0; i < src.length; i++) {
    var e = src[i] || {};
    var tMs = e.tMs != null ? e.tMs : t0Ms != null ? t0Ms + i * cadMs : null;
    out.push({ tMs: tMs, count: e.count != null ? e.count : null, moving: e.moving == null ? null : !!e.moving });
  }
  return out;
}
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
      // CLOCK CONTRACT §3 — resolve this stream's date order ONCE (DEEP-AUDIT-II §1.10). Most
      // node-export event times are bare `HH:MM:SS` (the §6 export contract), which carries no
      // ambiguity and leaves resolveDMY unlocked — harmless. But a legacy/foreign export CAN carry a
      // full vendor stamp, and there the per-row preference lets the order flip between events in one
      // stream. Resolving up front makes the whole stream agree by construction.
      var _spOrder =
        typeof DexClock !== 'undefined' && DexClock.resolveDMY
          ? DexClock.resolveDMY(
              sevs.map(function (x) {
                return x && x.time;
              }),
              true
            )
          : { dmy: true, locked: false };
      sevs.forEach(function (sp) {
        var p = parseTimestamp(sp.time, { dateAnchorMs: t0Ms, prevTMs: t0Ms, preferDMY: _spOrder.dmy, dmyLocked: _spOrder.locked });
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
      // OXYDEX-PULSE-RESOURCING §Phase 2: the O2Ring's 1 Hz firmware pulse — the SMOOTHED leg, exposed
      // for the finger-waveform-vs-device cross-check (fusePulseCrossCheck), never as ground truth.
      pulseHr1Hz: stats.meanHr != null && isFinite(stats.meanHr) ? stats.meanHr : null,
      // OXYDEX-PULSE-RESOURCING §Phase 3 — RECONCILED here by INTEGRATOR-OXYDEX-ADAPTER-GAP §4.1. These
      // were set ONLY in the generic normalizer, which no real OxyDex export reaches, so fuseHrvResource's
      // `s.rmssd1Hz != null` guard could never pass and the ring's 1 Hz proxy leg was dead on all 7 corpus
      // exports. bpm-DOMAIN (RMSSD/SD of the pulse RATE, not RR intervals) — carried ALONGSIDE the finger
      // waveform ms-HRV, never averaged across the unit boundary. `hrv.hrSdnn` is hrVarSd.
      rmssd1Hz: _dig(n, ['hrv', 'rmssd']),
      hrVarSd1Hz: _dig(n, ['hrv', 'hrSdnn']),
      // The EXPORTED night renames OxyDex's internal `hb` to `hypoxicBurden` (oxydex-dsp.js:5712), so
      // reading `n.hb` here only ever matched OxyDex's in-process shape — every exported night yielded
      // null. Prefer the exported key; keep `hb` as the fallback for an in-process night object.
      hypoxicBurden: _dig(n, ['hypoxicBurden', 'rate']) != null ? _dig(n, ['hypoxicBurden', 'rate']) : _dig(n, ['hb', 'rate']),
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
      /* DEEP-AUDIT-FOLLOWUPS §C2 — RECORDING time, not sleep time (`oxydex-dsp computeSleepStageProxy`
         divides by the sample count). Measured over 76 real nights, converting this leg onto the
         ECGDex leg's sleep-time denominator is NOT available: OxyDex's own sleep estimate is
         motion-derived and reads 99.1–99.9 % on every night, so `sleepEff × recording` misses ECGDex's
         TST by a median 58 min (bias +47, worst 115) against a 335 min median — and on four nights the
         converted REM fraction exceeds 100 %, i.e. more REM than there is sleep. So the basis is
         DECLARED and the comparison refuses, rather than a denominator being fabricated. */
      summary.remFractionBasis = 'recording';
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

/* Every spelling of a MULTI-RECORD wrapper the fleet emits (DEEP-AUDIT-II §8.1). A node that batches
   several recordings into one export wraps them in a carrier array and sets a corroborating schema
   flag — but the three raw-waveform nodes chose different words for it than OxyDex/CPAPDex did:

     nights[]     + schema.multiNight      OxyDex, CPAPDex
     recordings[] + schema.multiRecording  ECGDex, PulseDex
     sessions[]   + schema.multiSession    PpgDex

   Only the first pair was ever matched, so the other two silently lost every event they carried.
   This table is the ONE place that knowledge lives; adding a fourth spelling is a line here, not a
   new branch. Keep it in sync with the emitters (ecgdex-app / pulsedex-app / ppgdex-app buildV2). */
var MULTI_CARRIERS = [
  { key: 'nights', flag: 'multiNight' },
  { key: 'recordings', flag: 'multiRecording' },
  { key: 'sessions', flag: 'multiSession' }
];

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
  var KNOWN_NODES = ['ECGDex', 'OxyDex', 'GlucoDex', 'PulseDex', 'PpgDex', 'HRVDex', 'CPAPDex', 'MotionDex'];
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
    // DEEP-AUDIT-II §8.1 — "generically" above meant any NODE, not any CARRIER KEY. The guard only
    // ever matched `nights[]` + `schema.multiNight`, but the three raw-waveform nodes wrap their
    // multi-record exports differently: ECGDex and PulseDex emit `multiRecording` + `recordings[]`,
    // PpgDex emits `multiSession` + `sessions[]`. None sets multiNight, none uses nights[]. All three
    // fell through to the flat adaptEnvelopeNode below, which then read the WRAPPER's own (empty)
    // envelope — so every event in a multi-record ECG / PPG / RR export was dropped, with ZERO
    // warnings, while the longitudinal trends still rendered and confirmed "the file loaded". The
    // `Unknown`-only skip notice on the next branch cannot fire for a recognized node, which is
    // precisely what made the loss silent.
    // Keyed off the CARRIER ARRAY (flag as corroboration) so a fourth wrapper spelling is a one-line
    // addition to MULTI_CARRIERS rather than another silent drop.
    var _carrier = null;
    for (var _ck = 0; _ck < MULTI_CARRIERS.length; _ck++) {
      var _c = MULTI_CARRIERS[_ck];
      if (Array.isArray(json[_c.key]) && json.schema && json.schema[_c.flag]) {
        _carrier = _c;
        break;
      }
    }
    if (node !== 'Unknown' && _carrier) {
      var _list = json[_carrier.key];
      var mnRecs = [];
      for (var _ni = 0; _ni < _list.length; _ni++) {
        var _nightRecs = adaptEnvelopeNode(_list[_ni], node, filename);
        if (_nightRecs && _nightRecs.length) mnRecs = mnRecs.concat(_nightRecs);
      }
      // A multi-record wrapper that yields NOTHING is the §8.1 failure mode itself. Say so — an empty
      // return is indistinguishable from "this file genuinely had no events", which is how the
      // original defect stayed invisible for so long.
      if (!mnRecs.length) {
        return {
          recs: [],
          warnings: warnings.concat(['"' + (filename || 'file') + '" — ' + node + ' multi-record export (' + _carrier.key + '[' + _list.length + ']) yielded no usable records'])
        };
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

/* SPARSE COVERAGE (DEEP-AUDIT-III §6.2). A node may declare `recording.coverage.segments` — the
   intervals it ACTUALLY recorded — instead of a single span. HRVDex's 29-day export is the motivating
   case: its envelope is 29 days, its coverage is a handful of spot measurements, and collapsing the two
   into one `durSec` would declare 29 continuous days of recording. Read the segments when they are
   there; fall back to the envelope when they are not, so nothing regresses for a continuous node. */
function recSegments(r) {
  var cov = r && r.coverage;
  if (!cov || !Array.isArray(cov.segments) || !cov.segments.length) return null;
  var out = [];
  for (var i = 0; i < cov.segments.length; i++) {
    var sg = cov.segments[i];
    if (!sg || sg.startMs == null || !isFinite(sg.startMs)) continue;
    // durSec null ⇒ a POINT: the measurement happened, its length is unknown. A point cannot create
    // overlap on its own, which is the honest consequence of not knowing.
    var dur = sg.durSec != null && isFinite(sg.durSec) && sg.durSec > 0 ? sg.durSec * 1000 : 0;
    out.push([sg.startMs, sg.startMs + dur]);
  }
  return out.length ? out : null;
}

/* Do two records share any RECORDED time? Segment-aware: with sparse coverage on either side, the
   answer is whether any pair of segments intersects — not whether the envelopes do. Two 29-day HRVDex
   exports whose envelopes overlap entirely can still share no recorded minute. */
function segmentsOverlap(a, b) {
  var sa = recSegments(a),
    sb = recSegments(b);
  if (!sa && !sb) return null; // neither is sparse — caller uses the envelope
  var wa = recWindow(a),
    wb = recWindow(b);
  if (!sa) sa = wa ? [[wa.startMs, wa.endMs]] : null;
  if (!sb) sb = wb ? [[wb.startMs, wb.endMs]] : null;
  if (!sa || !sb) return null;
  var totalMs = 0;
  for (var i = 0; i < sa.length; i++) {
    for (var j = 0; j < sb.length; j++) {
      var s = Math.max(sa[i][0], sb[j][0]),
        e = Math.min(sa[i][1], sb[j][1]);
      if (e > s) totalMs += e - s;
    }
  }
  return { overlapMin: +(totalMs / 60000).toFixed(1), any: totalMs > 0 };
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

/* EVERY intersected RECORDED interval between two records — the quantity-bearing sibling of
   `segmentsOverlap`, which only ever answered the boolean "did they overlap at all".
   INTEGRATOR-GAP-AWARE-OVERLAP: §6.2 shipped the coverage MECHANISM but wired it to a boolean, so
   every published quantity — `apnea.overlapHours`, `confirmedAHI = nConf / totHrs`, and the Poisson
   null model's chance expectation — was still divided by ENVELOPE hours. On the real capture corpus a
   BLE drop opens a new segment and one night routinely spans 24-47 of them per stream, so the envelope
   is not a recording, it is a bracket around one. Measured on 2026-07-23: three-way recorded overlap
   2.1 h against an envelope 6.86 h, a factor of 3.3 — on the one night in eleven that was marked
   `confirmedAHIReportable`.
   BACK-COMPAT BY CONSTRUCTION: when NEITHER side declares segments this delegates to `overlapInterval`
   and returns exactly the interval the old code pushed, so a corpus that declares no coverage produces
   byte-identical unions, hours and indices. The gap-aware path engages only where a node has said, in
   its own export, that it has holes. */
function overlapIntervals(a, b) {
  var sa = recSegments(a),
    sb = recSegments(b);
  if (!sa && !sb) {
    var w = overlapInterval(a, b);
    return w ? [[w.startMs, w.endMs]] : [];
  }
  var wa = recWindow(a),
    wb = recWindow(b);
  if (!wa || !wb) return [];
  if (!sa) sa = [[wa.startMs, wa.endMs]];
  if (!sb) sb = [[wb.startMs, wb.endMs]];
  // Same alignment rule as overlapInterval: real instants only when BOTH offsets are present AND
  // differ. Intersect in the aligned frame, report back in a's own wall-clock frame.
  var shA = 0,
    shB = 0;
  if (a.offsetMin != null && b.offsetMin != null && a.offsetMin !== b.offsetMin) {
    shA = a.offsetMin * 60000;
    shB = b.offsetMin * 60000;
  }
  var out = [];
  for (var i = 0; i < sa.length; i++) {
    for (var j = 0; j < sb.length; j++) {
      var st = Math.max(sa[i][0] - shA, sb[j][0] - shB),
        en = Math.min(sa[i][1] - shA, sb[j][1] - shB);
      if (en > st) out.push([st + shA, en + shA]);
    }
  }
  return out;
}

/* "Could these two have been recorded together?" — for the fusion rules that publish a ONE-SESSION
   claim (§3.4, §3.5). A proven-disjoint pair must never be fused. But a record whose WINDOW IS
   UNKNOWN is not a disjoint record: §6.2 of the same audit shows HRVDex and GlucoDex declare no
   duration key at all, so `recWindow` returns null for them. Rejecting those would trade a wrong
   number for a MISSING one and silently drop whole nodes out of fusion — the mirror-image defect.
   So: fuse when the windows overlap, or when at least one window is unknown; and publish whether
   the overlap was actually VERIFIED so the "one session" claim can be read for what it is. */
function _mayOverlap(a, b) {
  if (!recWindow(a) || !recWindow(b)) return true; // unknown ⇒ cannot disprove
  // §6.2 — when either side declares sparse coverage, "did they overlap" is a question about RECORDED
  // time, not about envelopes. An envelope overlap between two sparse records proves nothing.
  var seg = segmentsOverlap(a, b);
  if (seg) return seg.any;
  return !!overlapInterval(a, b);
}
function _overlapVerified(a, b) {
  return !!(recWindow(a) && recWindow(b) && overlapInterval(a, b));
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
/* ── APNEA TYPING — TYPE WITHDRAWN (INTEGRATOR-APNEA-TYPING-REVIEW-2026-07-22 §4, option 1) ──────
   APNEA-TYPING-FUSION-2026-07-18 §1.1 typed each desaturation OBSTRUCTIVE vs CENTRAL from MotionDex's
   chest-ACC effort series (effort present ⇒ obstructive, flat ⇒ central). The PLUMBING was sound — it
   abstained on missing coverage and never guessed. **The FEATURE does not carry the information the
   rule assumed**, and 26 nights / 172 h of H10 chest ACC against device-scored AASM events measured it:

     effort during CENTRAL apnea, vs that night's own baseline ... 0.99×  — not absent, NORMAL
     effort during OBSTRUCTIVE apnea .............................. 1.72×
     best achievable discrimination (relative, early-70% window) .. AUC 0.691 (p = 0.0002)
     central apneas below HALF baseline ........................... 16.5%   (one RIP belt gets 84%)

   An ABSOLUTE floor (`amp >= EFFORT_FLOOR_G`, 0.004 g) therefore reads effort "present" through
   83.5–95.4% of central apneas ⇒ they typed OBSTRUCTIVE. On a corpus whose residual events are
   overwhelmingly central (370 vs 31) the rule was wrong for the DOMINANT class, silently.

   Three facts forbid simply re-tuning the constant: (1) 0.004 g is Ryser 2022's PEAK threshold on a
   3-axis vector magnitude at 50 Hz, applied here to the RMS of one differently-filtered axis — net
   0.2×–3× and rate-dependent; (2) an absolute gate is the wrong SHAPE regardless of value, since AASM
   defines apnea relative to the patient's own recent baseline and tilt amplitude is posture- and
   coupling-dependent; (3) the mechanism is unexplained — the obvious candidate (PAP mechanically
   driving the chest) was tested against MaskPress.2s and FAILS, effort is NEGATIVELY associated with
   pressure (Spearman ρ = −0.174, p = 0.0008, n = 367).

   So we ABSTAIN rather than re-base: even done well, option 2's relative measure tops out at AUC ≈ 0.69,
   below clinical utility. This matches the published asymmetry (Nassi 2022: one effort channel recovers
   84% of central but only 51% of obstructive — thoracoabdominal paradox is unobservable with a single
   sensor) and the most recent chest-accelerometer AHI system's own limitation: it "is not capable of
   distinguishing obstructive from central apnea events" (Schipper 2026, Front Sleep).

   WHAT REMAINS. The effort series is a real signal and MotionDex keeps emitting it unchanged; this
   function keeps walking it to report COVERAGE — how many desats the chest ACC actually witnessed —
   which is a measurement, not an inference. What it no longer does is name a TYPE from amplitude:
     every covered desat ⇒ UNTYPED, with `typingWithdrawn:true` + a reason
     no effort COVERAGE   ⇒ UNTYPED (unchanged — a coverage gap never manufactured a central)
     no MotionDex on bus  ⇒ null (unchanged graceful no-op)
   `obstructive`/`central` are NULL, not 0 — a zero would read as "measured none", which is precisely
   the false claim being withdrawn (Clock Contract §2.6's honesty rule, applied to a count).
   `usable:false` + `underpowered:true` are held so that EVERY pre-existing consumer gate closes.
   Re-opening this needs a second sensor (thorax+abdomen) or a second modality (PAT), not a new constant. */
var APNEA_TYPE_LEAD_MS = 15000; // look this far BEFORE the desat — SpO₂ lags the apnea (circulation + lung O₂ stores)
/* `APNEA_TYPE_OBSTRUCTIVE_FRAC` (0.5) and `APNEA_TYPE_MIN_TYPED` (5) were deleted with the rule they
   parameterised — a live constant for a withdrawn decision is an invitation to re-enable it by tuning. */
// Significance level for the desat⟷surge coupling verdict (§3.2). Also sets how many circular-shift
// surrogates the Integrator must request: p can never fall below 1/(shifts+1), so a verdict at 0.05
// needs ≥ 20 of them. Conventional α, stated once, read by both the request and the verdict.
var COUPLING_ALPHA = 0.05;

function typeApneaByEffort(recs) {
  var motion = _byNode(recs, 'MotionDex').filter(function (r) {
    return r.summary && Array.isArray(r.summary.effortSeries) && r.summary.effortSeries.length;
  });
  if (!motion.length) return null; // no MotionDex on the bus → no typing (graceful)

  var eps = [],
    cadMs = 10000;
  // (`motionSqi` was folded into each typed event's `conf`; with no typed event emitted there is
  // nothing to weight, and MotionDex already publishes it on the bus for anyone who wants it.)
  motion.forEach(function (r) {
    if (r.summary.effortCadenceSec != null) cadMs = r.summary.effortCadenceSec * 1000;
    r.summary.effortSeries.forEach(function (e) {
      if (e.tMs != null) eps.push(e);
    });
  });
  if (!eps.length) return null;
  eps.sort(function (a, b) {
    return a.tMs - b.tMs;
  });

  var DESAT_TYPES = ['spo2_desaturation', 'desat_event'];
  var desats = [];
  recs.forEach(function (r) {
    if (r.dateUnknown) return;
    _eventsOfType(r, DESAT_TYPES).forEach(function (e) {
      if (e.tMs != null) desats.push({ ev: e, node: r.node });
    });
  });
  if (!desats.length) return null;

  var out = {
    obstructive: null, // NULL, not 0 — see the header: a zero reads as "measured none"
    central: null,
    untyped: 0,
    total: desats.length,
    events: [], // no typed impulse is emitted onto the bus any more
    effortCovered: 0, // desats the chest ACC actually witnessed — a MEASUREMENT, retained
    coverageAssumed: false,
    typed: 0,
    typingWithdrawn: true,
    withdrawnReason:
      'effort amplitude does not separate central from obstructive: central-apnea effort is 0.99x that night’s own baseline (26 nights / 172 h vs device-scored AASM), so an absolute floor typed 83.5-95.4% of centrals as obstructive; best achievable AUC 0.691. INTEGRATOR-APNEA-TYPING-REVIEW-2026-07-22 §4 option 1.',
    underpowered: true,
    usable: false
  };
  desats.forEach(function (d) {
    var durMs = (d.ev.meta && d.ev.meta.durSec != null ? d.ev.meta.durSec : 10) * 1000;
    var lo = d.ev.tMs - APNEA_TYPE_LEAD_MS,
      hi = d.ev.tMs + durMs;
    var covered = 0;
    for (var i = 0; i < eps.length; i++) {
      if (eps[i].tMs + cadMs <= lo) continue;
      if (eps[i].tMs >= hi) break;
      if (eps[i].present == null) continue; // chest ACC NOT recording — out of the denominator, never a "central"
      covered++;
    }
    // Every desat is UNTYPED now. `effortCovered` still distinguishes "the chest ACC was there and we
    // decline to type it" from "the chest ACC was not recording" — the same distinction the old
    // no-coverage branch protected, kept as a count instead of as a type.
    if (covered) out.effortCovered++;
    out.untyped++;
  });
  return out;
}

/* ── ONE OBSERVER OWNS THE DESAT SPINE (DEEP-AUDIT-III §3.1) ─────────────────
   `gather()` below dedupes the desat pool by `impulse@round(tMs/1000)`. That key
   only ever collapses events whose stamps round to the SAME SECOND — i.e. the
   same record loaded twice. Two DIFFERENT oximeters watching one night run on two
   clocks and never round together, so every apnea entered the pool twice and the
   surfaced index DOUBLED: 7.5/h (mild) became 15/h (moderate) by adding a device,
   not a symptom. DEEP-AUDIT-2026-07-11 §15 opened this door for a good reason
   (impulse-keyed pooling, so CPAPDex's desat_event can fuse) and the double-count
   rode in with it.

   Why an AUTHORITY SPINE and not a time-window merge: the only tolerance in scope
   is `dtMs`, which defaults to 120 s. Apneas recur every 20–60 s in severe OSA, so
   merging "desats within dtMs from different nodes" would collapse genuinely
   distinct events and UNDER-count exactly where the count matters most. Any
   tighter tolerance would be a guess about inter-device clock skew AND about
   device-specific nadir averaging. So we do what `pickHRAuthority` already does
   for the HR witness: ONE observer supplies the events, the rest are recorded as
   corroboration.

   The choice is COVERAGE-first — the observer that actually witnessed more of the
   night (its own union with the cardiac nodes) — because coverage is measured, not
   claimed, and counts hours rather than events, so it cannot bias toward a noisier
   device. Only ties fall through to a node ladder, which encodes one physical
   fact: a wired oximeter cannot drop a BLE link. Events AND the AHI denominator
   both come from the chosen observer, so the index stays self-consistent. */
var DESAT_OBSERVER_AUTHORITY = { CPAPDex: 1, OxyDex: 2, PpgDex: 3 };

/* Merged union of every (oxy × cardiac) overlap. A union — not the sum of pairwise
   overlaps — so one oximeter night overlapping two cardiac recordings is counted
   ONCE (no inflated AHI denominator). */
function _desatUnion(oxyRecs, cardiacRecs, opts) {
  // `envelopeOnly` reproduces the pre-gap-aware union deliberately — NOT as a fallback, but so the
  // export can publish the envelope figure BESIDE the recorded one. A reader who cannot see both
  // cannot tell 7 h-of-7 from 2 h-of-7, which is the whole complaint this brief opened with.
  var envelopeOnly = !!(opts && opts.envelopeOnly);
  var raw = [];
  oxyRecs.forEach(function (o) {
    cardiacRecs.forEach(function (g) {
      // GAP-AWARE: every intersected RECORDED interval, not one envelope intersection. Identical to
      // the old single-interval push whenever neither side declares coverage (see overlapIntervals).
      if (envelopeOnly) {
        var w = overlapInterval(o, g);
        if (w) raw.push([w.startMs, w.endMs]);
        return;
      }
      var ivs = overlapIntervals(o, g);
      for (var k = 0; k < ivs.length; k++) raw.push([ivs[k][0], ivs[k][1]]);
    });
  });
  if (!raw.length) return { merged: [], hours: 0 };
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
  return { merged: merged, hours: totHrs };
}

/* Pick the observer whose own union with the cardiac nodes covers the most of the
   night; ties → the authority ladder; still tied → node name, so the choice is
   deterministic. Returns null when nothing observed a desaturation. */
function pickDesatObserver(oxyRecs, cardiacRecs) {
  var byNode = {};
  (oxyRecs || []).forEach(function (r) {
    var n = r.node || 'unknown';
    (byNode[n] = byNode[n] || []).push(r);
  });
  var names = Object.keys(byNode);
  if (!names.length) return null;
  var scored = names.map(function (n) {
    return { node: n, recs: byNode[n], hours: _desatUnion(byNode[n], cardiacRecs).hours };
  });
  scored.sort(function (a, b) {
    if (b.hours !== a.hours) return b.hours - a.hours; // more of the night witnessed wins
    var ra = DESAT_OBSERVER_AUTHORITY[a.node] != null ? DESAT_OBSERVER_AUTHORITY[a.node] : 99;
    var rb = DESAT_OBSERVER_AUTHORITY[b.node] != null ? DESAT_OBSERVER_AUTHORITY[b.node] : 99;
    if (ra !== rb) return ra - rb;
    return a.node < b.node ? -1 : a.node > b.node ? 1 : 0;
  });

  return {
    node: scored[0].node,
    recs: scored[0].recs,
    alsoObservedBy: scored.slice(1).map(function (s) {
      return s.node;
    }),
    candidates: scored.map(function (s) {
      return { node: s.node, overlapHours: +s.hours.toFixed(2) };
    })
  };
}

/* The audit trail for `apnea.overlapHours` — see its call site for why it exists. Pure; derives
   nothing the union did not already compute except the envelope comparison. */
function _overlapCoverage(oxyRecs, cardiacRecs, u, totHrs) {
  var declaredBy = [];
  (oxyRecs || []).concat(cardiacRecs || []).forEach(function (r) {
    if (r && recSegments(r) && declaredBy.indexOf(r.node) < 0) declaredBy.push(r.node || 'unknown');
  });
  var envHrs = declaredBy.length ? _desatUnion(oxyRecs, cardiacRecs, { envelopeOnly: true }).hours : totHrs;
  return {
    basis: declaredBy.length ? 'recorded' : 'envelope',
    recordedHours: +totHrs.toFixed(2),
    envelopeHours: +envHrs.toFixed(2),
    // How much of the bracket was actually recorded. Null rather than 1 when the envelope is zero —
    // a ratio with no denominator is unknown, not complete.
    recordedFrac: envHrs > 0 ? +(totHrs / envHrs).toFixed(3) : null,
    segments: u && u.merged ? u.merged.length : 0,
    declaredBy: declaredBy.sort()
  };
}

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
  var oxyAll = recs.filter(function (r) {
    return !r.dateUnknown && _eventsOfType(r, DESAT_TYPES).length;
  });
  var ecg = _byNode(recs, 'ECGDex'),
    ppg = _byNode(recs, 'PpgDex');
  var cardiac = ecg.concat(ppg);
  if (!oxyAll.length || !cardiac.length) return null;
  // ONE observer supplies the desat spine (§3.1). With a single oximeter on the
  // bus — every night in the corpus today — this is a no-op.
  var observer = pickDesatObserver(oxyAll, cardiac);
  var oxy = observer ? observer.recs : oxyAll;
  var desatObserver = observer ? { node: observer.node, alsoObservedBy: observer.alsoObservedBy, candidates: observer.candidates } : null;
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
  var _u = _desatUnion(oxy, cardiac);
  if (!_u.merged.length)
    return {
      findings: [],
      confirmedAHI: null,
      confirmedAHIReportable: false,
      overlapHours: 0,
      // Same block on the no-overlap path so a reader never has to branch on its presence. A zero
      // recorded union with a NON-zero envelope is exactly the case worth seeing: the recordings
      // bracketed each other but never ran at the same time.
      overlapCoverage: _overlapCoverage(oxy, cardiac, _u, 0),
      apneaAuthority: _deviceScoredAuthority(recs, null),
      desatObserver: desatObserver,
      matched: { desat: 0, surge: 0 },
      total: { desat: 0, surge: 0 },
      unmatched: { desat: [], surge: [] },
      nullModel: { expectedConfirmed: 0, pAtLeastObserved: 1, belowChance: true, surgeRatePerHr: 0, directionalWindowSec: leadMaxSec + trailMaxSec },
      coupling: null
    };
  var merged = _u.merged,
    totHrs = _u.hours;
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
        /* §3.3 — CARRY THE OBSERVING NODE. This hardcoded 'OxyDex' on the desat side, which was
           correct while the pool was `_byNode(recs,'OxyDex')`; DEEP-AUDIT-2026-07-11 §15 made the
           pool IMPULSE-keyed so any observer's desat_event can fuse, and the attribution was never
           updated with it. Result: every confirmed_apnea_event credited OxyDex even when OxyDex was
           not on the bus at all. The surge side was already done right (`s.node || 'ECGDex'`) — this
           is that, mirrored. */
        nodes: [d.node || 'OxyDex', s.node || 'ECGDex'],
        sources: [
          { node: d.node || 'OxyDex', impulse: d.impulse, tMs: d.tMs, conf: d.conf, sqi: d.sqi != null ? d.sqi : null, effConf: +(effConf(d) || 0).toFixed(3) },
          { node: s.node || 'ECGDex', impulse: s.impulse, tMs: s.tMs, conf: s.conf, sqi: s.sqi != null ? s.sqi : null, effConf: +(effConf(s) || 0).toFixed(3) }
        ],
        meta: { desatDepth: d.meta && d.meta.depth, nadir: d.meta && d.meta.nadir, latencySec: +((s.tMs - d.tMs) / 1000).toFixed(0), desatNode: d.node || 'OxyDex', surgeNode: s.node || 'ECGDex' },
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
  /* SURGE RATE IS PER PERSON, NOT PER DEVICE (DEEP-AUDIT-III-FOLLOWUPS §1.2 — the surge-side twin of
     §3.1, found by mutation-checking §3.1's own fix). `gather()` dedupes with `impulse@round(tMs/1000)`,
     which only collapses stamps landing in the SAME second; two cardiac observers run two clocks and
     never round together, so the pooled surge count DOUBLED. That count feeds
     `surgeRate → pPerDesat → lambda`, and a doubled lambda pushes `belowChance` true — this defect
     SUPPRESSES real findings rather than inflating a count, which is the worse direction: a number that
     is too high eventually gets questioned, a missing one does not.
     The desat-side remedy (one observer owns the spine) must NOT be copied here. R2 above is a
     deliberate design decision — "a desat is confirmable by an autonomic surge from EITHER; PpgDex is a
     first-class node here, not silently dropped" — so MATCHING keeps the whole pool. What is per-person
     is the RATE: one body has one autonomic surge rate however many devices watch it. So the null model
     takes its rate from a SINGLE observer, chosen by the HR_AUTHORITY ladder that already exists for
     exactly this judgement, while every observer remains eligible to confirm. */
  var _surgeByNode = {};
  surges.forEach(function (sv) {
    var n = sv.node || 'ECGDex';
    _surgeByNode[n] = (_surgeByNode[n] || 0) + 1;
  });
  var _surgeNodes = Object.keys(_surgeByNode).sort(function (a, b) {
    var ra = HR_AUTHORITY[a] != null ? HR_AUTHORITY[a] : 99,
      rb = HR_AUTHORITY[b] != null ? HR_AUTHORITY[b] : 99;
    if (ra !== rb) return ra - rb;
    if (_surgeByNode[b] !== _surgeByNode[a]) return _surgeByNode[b] - _surgeByNode[a];
    return a < b ? -1 : 1;
  });
  var _rateNode = _surgeNodes.length ? _surgeNodes[0] : null;
  var _rateCount = _rateNode ? _surgeByNode[_rateNode] : surges.length;
  var surgeRate = unionSec > 0 ? _rateCount / unionSec : 0; // surges per second, from ONE observer
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
    // §3.2: buy enough surrogates that a p < ALPHA verdict is REACHABLE. The primitive's default
    // 10 shifts floor p at 1/11 = 0.091, so "significant at 0.05" would be arithmetically
    // impossible off them — the power has to be bought before the claim can be made.
    var _shifts = typeof _EC.shiftsForAlpha === 'function' ? _EC.shiftsForAlpha(COUPLING_ALPHA) : null;
    var _opts = { window: [-leadMaxSec * 1000, trailMaxSec * 1000], coverage: merged };
    if (_shifts) _opts.nullShifts = _shifts;
    var ec = _EC.coupling(desats, surges, _opts);
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
      pPerm: ec.pPerm,
      pFloor: ec.pFloor,
      alpha: COUPLING_ALPHA,
      /* THE VERDICT (DEEP-AUDIT-III §3.2). This was `lift > 1 && observedPct > chancePct`, which is
         not a test: chancePct IS the surrogate distribution's mean, so under the null "observed >
         chance" is a fair coin — measured at a 54% false-positive rate over 300 independent-stream
         trials (162 fired, every one of them `usable`). It is now the exact one-sided permutation
         p-value against this window's own surrogates. `usable` still gates it, because a p-value on
         an underpowered or saturated window answers a question nobody should be asking. */
      real: usable && isFinite(ec.pPerm) && ec.pPerm < COUPLING_ALPHA
    };
  }

  // AHI over the *union* hours; keep 2 decimals so a real but low index isn't rounded to 0.
  var ahi = totHrs > 0 ? +(nConf / totHrs).toFixed(2) : null;
  return {
    findings: findings,
    confirmedAHI: ahi,
    confirmedAHIReportable: !belowChance && nConf > 0,
    overlapHours: +totHrs.toFixed(2),
    /* WHAT THAT DENOMINATOR IS (INTEGRATOR-GAP-AWARE-OVERLAP §6 — "the fusion export publishes the
       coverage it used"). `overlapHours` alone cannot be audited: 2.1 and 6.86 look equally
       reasonable, and on 2026-07-23 the difference between them decided a reportability verdict.
       So publish the envelope figure beside the recorded one, name the nodes whose declared coverage
       moved it, and count the segments. `basis:'envelope'` means no node declared coverage — the two
       hours figures are then equal by construction, which is itself the honest statement. */
    overlapCoverage: _overlapCoverage(oxy, cardiac, _u, totHrs),
    apneaAuthority: _deviceScoredAuthority(recs, ahi),
    desatObserver: desatObserver,
    matched: { desat: nConf, surge: nConf },
    total: { desat: desats.length, surge: surges.length },
    unmatched: { desat: unmatchedDesat, surge: unmatchedSurge },
    consequence: consequence,
    nullModel: {
      expectedConfirmed: +lambda.toFixed(2),
      pAtLeastObserved: +pAtLeast.toFixed(3),
      belowChance: belowChance,
      surgeRatePerHr: +(surgeRate * 3600).toFixed(1),
      // which observer the rate came from, and who else saw surges — so a reader can tell a
      // one-device night from a corroborated one without the count silently changing the null.
      surgeRateObserver: _rateNode,
      surgeAlsoObservedBy: _surgeNodes.slice(1),
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
  // Posture-source precedence (§1.2): ECGDex chest strap → MotionDex IMU → PpgDex limb ACC.
  // MotionDex is a purpose-built IMU node and outranks a limb-worn optical device, but sits BELOW the
  // chest strap because its body frame is UNCALIBRATED (the posture label is experimental-tier in
  // motiondex-registry.js — Rocha'26 reaches its F1 only after a calibration step MotionDex doesn't do).
  var src = 'chest-acc';
  if (!posture.length) {
    var motion = _byNode(recs, 'MotionDex');
    motion.forEach(function (g) {
      if (g.summary && g.summary.posture) posture = posture.concat(g.summary.posture);
    });
    posture = posture
      .filter(function (p) {
        return p.tMs != null;
      })
      .sort(function (a, b) {
        return a.tMs - b.tMs;
      });
    if (posture.length) src = 'motion-acc';
  }
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
      (src === 'limb-acc'
        ? 'LIMB-worn ACC (Polar Sense; lower reliability — wrist/ankle orientation, not trunk)'
        : src === 'motion-acc'
          ? 'MotionDex IMU gravity-vector position (uncalibrated device frame — the posture label is a convention, experimental tier)'
          : 'chest-ACC-derived') +
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
  /* DEEP-AUDIT-II §8.3 — a LONG gap is not measured glucose, and must not be counted as coverage.
     GlucoDex settled this in its own node (DEEP-AUDIT-2026-07-11 §5) and its comment states the
     contract: "A LONG gap (a sensor change, a dropout) is hours of straight line the sensor never
     saw; it must NOT be counted as measured glucose." The Integrator never got the same treatment —
     it excluded COMPRESSION (3) and KEPT GAP_LONG (4), so a 14 h sensor-change gap was interpolated
     straight into the fused mean/SD/CV. The node reported TIR 0 % on such a night; the Integrator
     reported 11.6 % from the same data.
     The Integrator reads these flags as bare NUMERIC LITERALS and never imports the name, which is
     why GlucoDex's fix could not propagate and why grepping for GAP_LONG finds nothing here. Named
     locally with the owning definition cited, so the coupling is visible to the next reader. */
  var GFLAG = { OK: 0, WARMUP: 1, GAP: 2, COMPRESSION: 3, GAP_LONG: 4 }; // ← mirrors glucodex-dsp.js FLAG
  var vals = [],
    valsT = [];
  for (i = 0; i < win.length; i++) {
    if (win[i].f === GFLAG.COMPRESSION || win[i].f === GFLAG.GAP_LONG) continue;
    if (win[i].v == null) continue;
    vals.push(win[i].v);
    valsT.push(win[i].tMs);
  }
  var expected = nMin / cadMin + 1; // inclusive endpoints → +1 cell
  /* …and coverage must count the cells that actually CONTRIBUTED, not the raw slice. `win.length`
     counted every interpolated and artifact cell, so a fully-interpolated window self-reported
     coverage ≈ 1.00 and sailed through the `minCov` gate below — the one guard written to catch
     exactly this condition was blind to it. */
  var coverage = expected > 0 ? vals.length / expected : 0;
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
    nCells: win.length, // RAW cells in the slice, incl. artifact/long-gap. Do NOT re-derive coverage from this (§8.3) — `coverage` above counts only the cells that contributed.
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
  var rs = [],
    ns = [];
  for (var i = 0; i < ms.length; i++)
    for (var j = i + 1; j < ms.length; j++) {
      var r = _tchPearson(ms[i].m, ms[j].m);
      if (r == null) continue;
      rs.push(r);
      /* HOW MANY EPOCHS THAT PAIR ACTUALLY SHARED (FU-IV FOLLOWUPS §4). ρ was published with no
         indication of the evidence under it: on the real corpus 2026-07-11 supplies ρ = 0.72 from an
         overlap of TWENTY epochs, and a consumer could not tell that from one that used 90. Counting
         is free — it is the same finite-pair test `_tchPearson` already runs internally.
         Deliberately a DIAGNOSTIC, not a gate: a minimum-n rule would need a threshold, and picking
         one from a round number rather than from the corpus is the invented constant this suite
         refuses. Publish the evidence first; derive the rule from it later if one is warranted. */
      var nOv = 0;
      for (var k = 0; k < ms[i].m.length; k++) {
        var a = ms[i].m[k],
          b = ms[j].m[k];
        if (a != null && b != null && isFinite(a) && isFinite(b)) nOv++;
      }
      ns.push(nOv);
    }
  if (!rs.length) return null;
  var pos = rs.map(function (r) {
    return Math.max(r, 0);
  });
  var denom = pos.reduce(function (a, b) {
    return a + b;
  }, 0);
  var mean = denom / pos.length;
  /*      COUPLED-PAIR-WEIGHTED, not the plain mean (FU-IV §1, executed 2026-08-03). The mean was chosen
     when only two nodes carried motion, where it is the single pair and the choice is vacuous. With
     ECGDex's chest-ACC motion on the bus there are THREE pairs, and the quiet-order shape is one
     tightly-coupled pair against two loose ones — which the mean dilutes, exactly in the regime the
     external ρ exists to rescue. Weighting each pair by its own magnitude (Σr²/Σr) lets a dominant
     pair lead WITHOUT discarding the other two.

     Why not max(r), which rescues more: it is the maximum of three noisy estimates, so it is biased
     UPWARD by selection even when all three measure the same common mode. Σr²/Σr has neither problem —
     it equals the mean when the pairs are equal (so it is inert on nights with no coupled pair) and
     approaches the max only when one pair genuinely dominates. It is bounded above by max(r), so it
     cannot become the degenerate "always ≈0.9" that FU-IV §1.3 warns rescues everything and means
     nothing.

     Measured on the 25-night refolded trio corpus, changing only this aggregation:
        mean  ρ-rejected 12/25 · 3 nights excluded · median σ E/P/O 0.79/2.71/1.09
        Σr²/Σr           8/25  · 2 excluded        ·                0.87/2.54/1.14
        max(r)           5/25  · 2 excluded        ·                1.01/2.54/1.23
     FU-IV §5's invariant holds for all three: ρ lowered Σσ² on ZERO of 25 nights. */
  var weighted =
    denom > 0
      ? pos.reduce(function (a, b) {
          return a + b * b;
        }, 0) / denom
      : 0;
  var rho = Math.max(0, Math.min(0.9, weighted));
  /* `method` deliberately KEEPS its string: the aggregation is an implementation detail and consumers
     branch on this value. `meanPairR` is retained (it was the published aggregate) beside
     `weightedPairR`, the one actually used, so the change is inspectable without a contract break. */
  // `nOverlapMin` is the WEAKEST pair's evidence — the binding constraint on ρ, and the number a
  // consumer needs to judge it. `nOverlapMax` bounds the other end so a lopsided set is visible.
  return {
    value: +rho.toFixed(3),
    method: 'cross-node-motion',
    nMotionNodes: ms.length,
    meanPairR: +mean.toFixed(3),
    weightedPairR: +weighted.toFixed(3),
    nPairs: rs.length,
    nOverlapMin: ns.length ? Math.min.apply(null, ns) : null,
    nOverlapMax: ns.length ? Math.max.apply(null, ns) : null
  };
}
// Generic reference-free per-sensor hat for ONE metric ('rmssd' | 'hr'). PURE; {ok:false, reason}
// when <3 nodes carry that per-epoch series (→ caller degrades). Estimates ρ from cross-node motion
// (§1) and passes it to the estimator's external-ρ path; attaches per-node mean level for reconciling.
function _tchHat(like, ptsFn, metric) {
  var TCH = _tchEngine();
  if (!TCH) return null;
  /* A LEG WITH NO TIMING IS NOT A CLOCK — the same rule fitClockClosure applies (§F3), applied here
     because THIS is the hat the app actually runs (fitClockClosure is tool-only; fuseHRVConsensus →
     _tchHat is the shipped path). A drawn axis with no host anchors (`timingSource:'none'`) contributes
     a constant, not a clock; both its pairs then faithfully measure a fiction and the hat returns a
     confident number about nothing — CLOCK-CLOSURE-THREE-SOURCE's "all legs confident" failure. Proven
     shipped: a `timingSource:'none'` PpgDex was spent as a full TCH corner (2026-08-08). null/omitted
     stays usable, so every existing fixture is byte-unchanged. */
  var tchExcluded = [];
  var timed = like.filter(function (s) {
    if (s.timingSource === 'none') {
      tchExcluded.push(s.node);
      return false;
    }
    return true;
  });
  var ws = timed.filter(function (s) {
    return ptsFn(s).length >= 12;
  });
  if (ws.length < 3)
    return {
      ok: false,
      metric: metric,
      reason: 'need ≥3 nodes with a per-epoch ' + metric + ' series; have ' + ws.length + (tchExcluded.length ? ' (excluded drawn-axis: ' + tchExcluded.join(', ') + ')' : ''),
      excluded: tchExcluded,
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
    /* THE SCREEN HAS THREE OUTCOMES; THIS IMPLEMENTED TWO (DEEP-AUDIT-V §2.1 F4).
       `screenTriplet`'s own docstring: "Exactly-one → drop it and name the trustworthy pair; zero →
       proceed with the full triplet; two-or-more mutual decorrelations → AMBIGUOUS (can't tell which
       is truth) → don't drop, DON'T TRUST." Only the first two were handled — the branch above tests
       `scr.drop`, and every refusal that sets `drop: null` fell straight through to the solve.

       There are FOUR such refusals in `screenTriplet` (`need three series`, `insufficient overlap /
       degenerate series`, the AMBIGUOUS `N nodes mutually decorrelate`, and `the surviving pair also
       disagrees — not dropped`), and all four produced a confident per-sensor sigma card. Measured on
       three 96-epoch exports built to mutually decorrelate: the screen returned
       `{ok:false, drop:null, ambiguous:true}` and the block still published
       `sigma {ECGDex:19.99, PpgDex:0.51, HRVDex:30.77}` with the ambiguity surfaced NOWHERE —
       ranking pure noise as the QUIETEST sensor and handing it ~79 % of the inverse-variance fusion
       weight in the reconciled mean.

       Branch on the VERDICT, not on one of its fields. The block then degrades to the pairwise
       consensus with a stated reason — the same shape the drop branch above already returns — and the
       `ambiguous` / `corr` fields travel with it so a reader can see WHY rather than infer it. */
    if (scr && scr.ok === false) {
      return {
        ok: false,
        metric: metric,
        reason: scr.reason || 'correlation screen refused the triplet',
        ambiguous: !!scr.ambiguous,
        corr: scr.corr || null,
        nodesWithSeries: ws.map(function (s) {
          return s.node;
        })
      };
    }
  }
  var rho = _tchRhoFromMotion([best.A, best.B, best.C], best.al.keys); // §1
  /* CORNER IDENTITY != NODE LABEL (DEEP-AUDIT-V §2.1 F5). `labels` was `[A.node, B.node, C.node]`
     straight off `schema.node`, and the capture tree writes a Verity `_PPG` and an O2Ring `_PPG` on
     the same night — BOTH routed to PpgDex. Two corners then shared a key, `_bylabel` overwrote, and
     a "three-cornered hat" published TWO sigmas: measured, the Verity's 2.961 replaced by the
     O2Ring's 16.779, with the surviving PpgDex weight applied to BOTH rows of the reconciled mean.
     `integrator-tch.js` now REFUSES a non-distinct triple, so without this the same night would go
     from a wrong number to no number — the refusal is the safety net, not the fix. Disambiguate with
     the recording's own file/device label when a node repeats. The renderer already splits on ' '
     for its colour (`k.split(' ')[0]`), so a space-separated suffix renders correctly today. */
  var _cornerIds = (function (srcs) {
    var seen = {},
      out = [];
    srcs.forEach(function (s) {
      var base = s.node || 'node';
      seen[base] = (seen[base] || 0) + 1;
      out.push(base);
    });
    var used = {};
    return out.map(function (base, i) {
      if (seen[base] < 2) return base;
      used[base] = (used[base] || 0) + 1;
      var sv = srcs[i];
      // Prefer something that names the DEVICE/recording; fall back to an ordinal so the corners are
      // at least distinguishable rather than silently merged.
      var tag = sv.deviceKey || sv.file || sv.fname || (sv.recording && sv.recording.device) || used[base];
      return base + ' ' + String(tag).replace(/\s+/g, '_');
    });
  })([best.A, best.B, best.C]);
  var opts = { labels: _cornerIds, minN: 12 };
  if (rho && rho.value > 0) opts.rho = rho.value;
  var r = TCH.threeCorneredHat(best.al.A, best.al.B, best.al.C, opts);
  if (!r.ok) {
    r.metric = metric;
    return r;
  }
  r.metric = metric;
  /* PSEUDO THREE-CORNERED HAT — the corner's axis, not the corner's crystal (2026-08-17).
     The `timingSource === 'none'` filter above removes a leg that declares it has no timing. It cannot
     see the commoner case: a leg that declares NOTHING. OxyDex emits no `quality` block at all, so it
     resolves to `null`, which the filter deliberately keeps ("null/omitted stays usable").

     Keeping it is right — excluding it would leave two corners and no hat at all, so the choice is not
     "clean TCH vs contaminated TCH" but "contaminated TCH vs no estimate". What is wrong is quoting the
     result at the SAME tier as one whose corners are all timed.

     The mechanism, stated on instability rather than on clock-ness: the O2Ring HAS a crystal and a
     disciplined RTC (`capture-host/oxyii.py` SET_UTC_TIME 0xC0) — it genuinely measures HR. What its
     EXPORT lacks is per-sample clock readings; the axis is an anchor plus a nominal rate. An axis of
     `index × nominal_rate` has ZERO APPARENT INSTABILITY BY CONSTRUCTION — it cannot disagree with
     itself — while its real error reappears as a TIMING error that misplaces samples, contributing
     ≈ δ·dHR/dt at each shared epoch. That term is a function of the COMMON signal's derivative, so it
     is correlated with the other corners by construction and largest exactly where HR moves. TCH's
     uncorrelated-error premise is violated in the one way it cannot absorb.

     So: report the number, refuse the tier. `pseudo` drives a heuristic badge at the render layer.
     A corner counts as TIMED only on a positive declaration — `device` or `device+host`. `host`
     (a drawn axis) and `null` (nothing declared) both fail, because absence of evidence is not
     evidence of independence. This upgrades itself the day OxyDex publishes axis provenance. */
  r.axisProvenance = {};
  [best.A, best.B, best.C].forEach(function (s, i) {
    r.axisProvenance[_cornerIds[i]] = s.timingSource != null ? s.timingSource : null;
  });
  r.pseudo = [best.A, best.B, best.C].some(function (s) {
    return s.timingSource !== 'device' && s.timingSource !== 'device+host';
  });
  r.pseudoReason = r.pseudo ? 'a corner declares no per-sample device timing — σ is a ranking, not a calibrated instability' : null;
  r.coMotion = {};
  // Same corner ids as the solve — a map keyed differently from sigma2 cannot be joined to it.
  [best.A, best.B, best.C].forEach(function (s, i) {
    r.coMotion[_cornerIds[i]] = _meanMotion(s, best.al.keys);
  });
  r.rhoEstimate = rho || null; // §1 provenance: how ρ was derived (null → classic solve)
  r.levels = {};
  [best.A, best.B, best.C].forEach(function (s, _ci) {
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
    r.levels[_cornerIds[_ci]] = vs.length
      ? +(
          vs.reduce(function (a, b) {
            return a + b;
          }, 0) / vs.length
        ).toFixed(1)
      : null;
  });
  if (typeof TCH.allanTriplet === 'function') {
    var _al = TCH.allanTriplet(best.al.A, best.al.B, best.al.C, { labels: _cornerIds, taus: [1, 2, 4, 8] });
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
  if (tchExcluded.length) r.excluded = tchExcluded; // drawn-axis legs dropped before the hat (§F3)
  return r;
}
// Back-compat: the RMSSD hat IS the historical _tchConsensus return (block.tch).
function _tchConsensus(like) {
  return _tchHat(like, _rmssdPts, 'rmssd');
}
/* ── MOTION-GATED HRV (MULTI-SENSOR-DERIVATIONS §2.4) ────────────────────────────────────────────
   HRV read across a night full of movement is worth less than the same number off a still night —
   motion inflates artifact-driven RR/PPI variance. MotionDex's per-epoch movement track lets the
   Integrator SCORE that instead of asserting it: over the HRV sources' shared window, what fraction of
   RECORDED epochs were still?
     `quiet` ⇒ ≥ HRV_QUIET_FRAC of recorded epochs immobile — the HRV block is motion-clean
   Coverage-honest: epochs with `moving == null` (accelerometer not recording) are excluded from the
   denominator, never counted as still — otherwise a recording gap buys a spuriously "quiet" night.
   Returns null when the bus carries no MotionDex movement track or no HRV source: this ANNOTATES
   HRV, it never gates it away, and it is a silent no-op when MotionDex is absent (nodes stay
   independent; the Integrator is optional; MotionDex is optional to the Integrator).
   EMERGING tier — a confidence annotation, not a correction: no HRV value is altered. */
var HRV_QUIET_FRAC = 0.8; // ≥80% of recorded epochs immobile ⇒ motion-clean window
var HRV_SOURCE_NODES = ['ECGDex', 'PulseDex', 'HRVDex', 'PpgDex'];

function gateHRVByMotion(recs) {
  var motion = _byNode(recs, 'MotionDex').filter(function (r) {
    return r.summary && Array.isArray(r.summary.activitySeries) && r.summary.activitySeries.length;
  });
  if (!motion.length) return null;
  var hrvSrc = recs.filter(function (r) {
    return HRV_SOURCE_NODES.indexOf(r.node) >= 0 && !r.dateUnknown && r.summary && (r.summary.rmssd != null || r.summary.sdnn != null);
  });
  if (!hrvSrc.length) return null;
  var lo = Infinity,
    hi = -Infinity;
  hrvSrc.forEach(function (r) {
    if (r.t0Ms != null) lo = Math.min(lo, r.t0Ms);
    if (r.endMs != null) hi = Math.max(hi, r.endMs);
  });
  if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return null;
  var covered = 0,
    moving = 0;
  motion.forEach(function (r) {
    r.summary.activitySeries.forEach(function (e) {
      if (e.tMs == null || e.tMs < lo || e.tMs >= hi) return;
      if (e.moving == null) return; // NOT RECORDING — out of the denominator, never "still"
      covered++;
      if (e.moving) moving++;
    });
  });
  if (!covered) return null; // motion track present but none of it overlaps the HRV window
  var immobileFrac = (covered - moving) / covered;
  return {
    immobileFrac: +immobileFrac.toFixed(2),
    movingEpochs: moving,
    coveredEpochs: covered,
    quiet: immobileFrac >= HRV_QUIET_FRAC,
    coverageAssumed: false,
    windowMs: [lo, hi]
  };
}

/* ── RESPIRATION-RATE FUSION (MULTI-SENSOR-DERIVATIONS §2.2) ─────────────────────────────────────
   Respiration is a vital the suite COMPUTES but never surfaced: ECGDex has carried an RSA/EDR estimate
   in `hrv.frequency.respRate` all along and nothing read it; MotionDex adds an independent chest-ACC
   estimate. Fusing them is a rare WITHIN-SUBJECT method comparison — two physiologically independent
   routes to the same number (cardiac RSA vs thoraco-abdominal movement), so their agreement is itself
   the evidence. This does NOT average a disagreement away: it publishes every source, the consensus AND
   the spread, and says plainly when they disagree.
   PpgDex's RIIV would be the third source; it currently exports `respRate: null` (a known DSP defect —
   `PPGDSP.lombScargle` never tracks the HF peak), so it simply does not appear. This is n-agnostic and
   will pick it up the day it emits, with no change here.
   Returns null below 2 sources — a "fusion" of one estimate is just that estimate.
   EMERGING tier. Agreement band from Ryser 2022 [R22]: chest-ACC RR validates to ~1.8 br/min vs RIP. */
var RR_AGREE_BRPM = 2.0;
// OXYDEX-PULSE-RESOURCING §Phase 2 — the finger-waveform-vs-ring-1 Hz pulse-HR agreement band.
// Measured on the real tri-device corpus: the O2Ring waveform tracks the ring's own field to a
// median 0.4 bpm and the paired chest ECG to ~1 bpm (docs/O2RING-FINGER-ROUNDTRIP-2026-07-20.md),
// so 3 bpm is a generous agreement threshold, not a tight one.
var PULSE_AGREE_BPM = 3.0;
// OXYDEX-PULSE-RESOURCING §Phase 3 — the ring's 1 Hz RMSSD is a pulse-RATE (bpm) quantity; the finger
// waveform RMSSD is an RR-INTERVAL (ms) quantity. They are not the same unit, so fuseHrvResource never
// computes a numeric delta. It DOES run a first-order order-of-magnitude BRIDGE (δinterval ≈ 60000/HR²·δrate)
// purely to flag gross disagreement; "concordant" = the waveform ms-RMSSD lands within this multiplicative
// band of the bridged proxy. Wide on purpose (the 1 Hz stream is smoothed and under-states) — it catches a
// broken leg, not a calibration gap. The waveform is ALWAYS the reference.
var HRV_CONCORDANCE_FACTOR = 3.0;

// OXYDEX-PULSE-RESOURCING §Phase 2 — the O2Ring's own WAVEFORM pulse vs its SMOOTHED 1 Hz firmware
// pulse. This is the third application of CLAUDE.md §🎙️ (the H10 `_HR.txt` and the Verity `_HR.txt`
// already get it): the vendor's 1 Hz summary is smoothed and is NEVER the reference — the honest leg
// is the waveform-derived PPI. So the comparison is DIRECTIONAL: the finger PpgDex HR is the truth,
// the ring's 1 Hz field is what is being checked. READ-ONLY — it adds a cross-check block and changes
// no existing metric. The DISAGREEMENT is reported, never averaged away (integrator-dsp.js precedent:
// fuseRespirationRate / "report the SPREAD"). Returns null unless BOTH a `site:'finger'` PpgDex export
// and an O2Ring OxyDex export are on the bus (the ring's own waveform + its own summary, one session).
/* §3.5 — the doc comment states a contract the code did not enforce: "the ring's own waveform + its
   own summary, ONE SESSION". It took the FIRST candidate of each kind from the whole bus, so a finger
   PpgDex export and an O2Ring OxyDex export from nights apart were compared as if simultaneous,
   yielding a signed biasBpm and an `agree: true` verdict about vendor smoothing that measures nothing.
   Now the pair must TEMPORALLY OVERLAP; when several candidates exist, the overlapping pair is chosen
   rather than the first of each. No overlapping pair ⇒ null, which is the honest answer. */
function fusePulseCrossCheck(recs) {
  var waves = [],
    devs = [];
  recs.forEach(function (r) {
    if (!r || r.dateUnknown || !r.summary) return;
    if (r.node === 'PpgDex' && r.summary.site === 'finger' && r.summary.pulseHr != null && isFinite(r.summary.pulseHr) && r.summary.pulseHr > 0) {
      waves.push({ rec: r, node: r.node, hr: +Number(r.summary.pulseHr).toFixed(1) });
    }
    if (r.node === 'OxyDex' && r.summary.pulseHr1Hz != null && isFinite(r.summary.pulseHr1Hz) && r.summary.pulseHr1Hz > 0) {
      devs.push({ rec: r, node: r.node, hr: +Number(r.summary.pulseHr1Hz).toFixed(1) });
    }
  });
  var wave = null,
    dev = null;
  for (var wi = 0; wi < waves.length && !wave; wi++) {
    for (var di = 0; di < devs.length; di++) {
      if (_mayOverlap(waves[wi].rec, devs[di].rec)) {
        wave = waves[wi];
        dev = devs[di];
        break;
      }
    }
  }
  if (!wave || !dev) return null;
  // signed bias = device − waveform: > 0 means the ring's 1 Hz field reads HIGH vs the honest waveform.
  var biasBpm = +(dev.hr - wave.hr).toFixed(1);
  var absBpm = Math.abs(biasBpm);
  // percent relative to the WAVEFORM (the reference leg), not the device — the honest denominator.
  var pctOfWaveform = +((absBpm / wave.hr) * 100).toFixed(2);
  var agree = absBpm <= PULSE_AGREE_BPM;
  var ovVerified = _overlapVerified(wave.rec, dev.rec);
  return {
    waveformHr: wave.hr,
    deviceHr: dev.hr,
    // §3.5 — false ⇒ at least one record declares no window, so "one session" is UNVERIFIED, not proven.
    overlapVerified: ovVerified,
    reference: 'waveform', // the finger pleth is the honest leg; the 1 Hz field is the smoothed one
    biasBpm: biasBpm,
    absBpm: +absBpm.toFixed(1),
    pctOfWaveform: pctOfWaveform,
    agree: agree,
    agreeThresholdBpm: PULSE_AGREE_BPM,
    note:
      'O2Ring finger-waveform HR ' +
      wave.hr +
      " vs the ring's smoothed 1 Hz field " +
      dev.hr +
      ' bpm — device ' +
      (biasBpm === 0 ? 'matches' : (biasBpm > 0 ? 'reads +' : 'reads ') + biasBpm + ' bpm vs') +
      ' the waveform (the honest leg); ' +
      (agree
        ? 'within the ±' + PULSE_AGREE_BPM + ' bpm agreement band — vendor smoothing costs little here.'
        : 'BEYOND the ±' + PULSE_AGREE_BPM + ' bpm band; trust the waveform, not the 1 Hz field.') +
      ' The disagreement is reported, never averaged.'
  };
}

// OXYDEX-PULSE-RESOURCING §Phase 3 — RE-SOURCE the O2Ring's HRV. The ring's own `rmssd`/`hrVarSd` are
// derived from its SMOOTHED 1 Hz pulse RATE — the registry confesses it ("1 Hz pulse-rate RMSSD proxy —
// not RR-interval HRV"). When a finger PpgDex capture is on the bus (the ring's OWN single-channel pleth),
// its WHOLE-RECORD waveform HRV (ms, real RR intervals) is the honest measure. This publishes the waveform
// HRV as the resourced value that SUPERSEDES the 1 Hz proxy, and carries the proxy alongside for continuity —
// but the two are DIFFERENT UNITS (ms vs bpm) so they are NEVER averaged. Tier is `emerging`, NOT `validated`:
// the brief (§Phase 3) grants `validated` only once the finger path is shown to reproduce the audited PulseDex
// HRV path on the real corpus — release-time work this cannot run. READ-ONLY: no existing OxyDex metric moves;
// OxyDex keeps its 1 Hz proxies as the single-signal fallback for nights with no finger capture. Returns null
// unless BOTH a finger PpgDex ms-HRV and an O2Ring OxyDex proxy are present (both non-dateUnknown).
function fuseHrvResource(recs) {
  var wave = /** @type {any} */ (null),
    proxy = /** @type {any} */ (null);
  recs.forEach(function (r) {
    if (!r || r.dateUnknown || !r.summary) return;
    var s = r.summary;
    if (r.node === 'PpgDex' && s.site === 'finger' && s.rmssdMs != null && isFinite(s.rmssdMs) && s.rmssdMs > 0 && !wave) {
      var robust = s.sdnnRobustMs != null && isFinite(s.sdnnRobustMs);
      wave = {
        node: r.node,
        rmssdMs: +Number(s.rmssdMs).toFixed(1),
        sdnnMs: robust ? +Number(s.sdnnRobustMs).toFixed(1) : s.sdnnMs != null && isFinite(s.sdnnMs) ? +Number(s.sdnnMs).toFixed(1) : null,
        sdnnMetric: robust ? 'sdnnRobust' : 'sdnn',
        lowConfidence: !!s.hrvLowConfidence
      };
    }
    if (r.node === 'OxyDex' && s.rmssd1Hz != null && isFinite(s.rmssd1Hz) && s.pulseHr1Hz != null && isFinite(s.pulseHr1Hz) && s.pulseHr1Hz > 0 && !proxy) {
      proxy = {
        node: r.node,
        rmssdBpm: +Number(s.rmssd1Hz).toFixed(2),
        hrVarSdBpm: s.hrVarSd1Hz != null && isFinite(s.hrVarSd1Hz) ? +Number(s.hrVarSd1Hz).toFixed(2) : null,
        meanHr: +Number(s.pulseHr1Hz).toFixed(1)
      };
    }
  });
  if (!wave || !proxy) return null;
  // cross-unit BRIDGE (first-order, order-of-magnitude ONLY): interval(ms) = 60000/rate(bpm) ⇒
  // |δinterval| ≈ (60000/HR²)·|δrate|, so an approximate ms-equivalent of the ring's bpm rate-RMSSD is
  // rmssdBpm·60000/HR². The 1 Hz stream is SMOOTHED so it under-states — the waveform ms-RMSSD is expected
  // to run HIGHER. This is a sanity flag, never a conversion we publish as the value.
  var k = 60000 / (proxy.meanHr * proxy.meanHr);
  var proxyRmssdAsMs = +(proxy.rmssdBpm * k).toFixed(1);
  var ratio = proxyRmssdAsMs > 0 ? +(wave.rmssdMs / proxyRmssdAsMs).toFixed(2) : null;
  var concordance = ratio == null ? null : ratio >= 1 / HRV_CONCORDANCE_FACTOR && ratio <= HRV_CONCORDANCE_FACTOR ? 'concordant' : 'diverges';
  return {
    reference: 'waveform', // the finger PPI is the honest RR-interval leg; the 1 Hz rate proxy is superseded
    tier: 'emerging', // NOT validated — see the function header (real-corpus PulseDex-path reproduction owed)
    // the RESOURCED HRV — real RR-interval (ms) values from the finger waveform; these are the ones to trust
    resourced: {
      rmssd: { value: wave.rmssdMs, unit: 'ms', basis: 'RR-interval RMSSD (finger PPI, wholeRecord)' },
      hrVarSd: { value: wave.sdnnMs, unit: 'ms', basis: wave.sdnnMetric + ' (finger PPI, wholeRecord)' }
    },
    // carried for continuity — DIFFERENT units/construct (pulse RATE, not RR interval); NEVER averaged in
    proxy1Hz: {
      rmssd: { value: proxy.rmssdBpm, unit: 'bpm*', basis: '1 Hz pulse-rate RMSSD proxy' },
      hrVarSd: { value: proxy.hrVarSdBpm, unit: 'bpm', basis: 'SD of 1 Hz pulse rate' }
    },
    supersedes: 'OxyDex 1 Hz pulse-rate proxy (bpm) — a smoothed rate series cannot resolve beat-to-beat intervals',
    // an approximate cross-unit sanity bridge, not a published value (see the header + the constant)
    bridge: { meanHr: proxy.meanHr, proxyRmssdAsMs: proxyRmssdAsMs, ratio: ratio, factorBand: HRV_CONCORDANCE_FACTOR, concordance: concordance },
    lowConfidence: wave.lowConfidence,
    note:
      'Finger-waveform HRV RMSSD ' +
      wave.rmssdMs +
      ' ms / ' +
      (wave.sdnnMetric === 'sdnnRobust' ? 'SDNN(robust) ' : 'SDNN ') +
      wave.sdnnMs +
      ' ms is the RE-SOURCED (real RR-interval) HRV and supersedes the ring’s 1 Hz proxy (RMSSD ' +
      proxy.rmssdBpm +
      ' bpm*, HR-Var SD ' +
      (proxy.hrVarSdBpm != null ? proxy.hrVarSdBpm : 'n/a') +
      ' bpm). Units differ (ms vs bpm) so the two are carried side-by-side, never averaged; ' +
      (concordance === 'concordant'
        ? 'a first-order bridge (≈' + proxyRmssdAsMs + ' ms) puts them within the same order of magnitude — the proxy tracks the waveform.'
        : concordance === 'diverges'
          ? 'a first-order bridge (≈' + proxyRmssdAsMs + ' ms) puts them well apart — trust the waveform, treat the proxy as unreliable here.'
          : 'no bridge available.') +
      (wave.lowConfidence ? ' ⚠ the finger HRV is flagged low-confidence.' : '') +
      ' Tier emerging — validated is owed a real-corpus reproduction of the audited PulseDex path.'
  };
}

// OXYDEX-PULSE-RESOURCING §Phase 4 — publish a CORROBORATED CVHR that NAMES its source (§3.1 owner
// decision (b)). CVHR (cyclic variation of HR, Hayano) is the autonomic cardiac correlate of apnea. The
// O2Ring's 1 Hz pulse cannot resolve it; a finger PpgDex (the ring's own pleth) computes a real one from
// its NN series (ppgdex-dsp cvhrFromNN, a port of ECGDex detectCVHR). When a finger PpgDex + an OxyDex
// (the O2Ring night) are both present, this publishes the finger-PPI CVHR, named + tier `emerging`, and
// corroborates it against any OTHER node's cardiac CVHR (ECGDex `summary.cvhrIndex`) — reporting
// agreement, never averaging. CRITICAL (§3.1 (b)): this is NOT an AHI and emits none — the ONLY published
// AHI stays OxyDex's own `ahiEst`. cvhrIndex 0 is a real reading (no CVHR detected), so it is accepted.
// Returns null unless a finger PpgDex cvhrIndexWave AND an OxyDex rec are present (both non-dateUnknown).
var CVHR_AGREE_PER_H = 5.0; // events/h — CVHR indices within this band corroborate (mirrors PB_CVHR_MIN scale)
function fuseCvhrCorroboration(recs) {
  var wave = /** @type {any} */ (null),
    hasOxy = false;
  var corroborators = [];
  recs.forEach(function (r) {
    if (!r || r.dateUnknown || !r.summary) return;
    var s = r.summary;
    if (r.node === 'PpgDex' && s.site === 'finger' && s.cvhrIndexWave != null && isFinite(s.cvhrIndexWave) && s.cvhrIndexWave >= 0 && !wave) {
      wave = { node: r.node, cvhrIndex: +Number(s.cvhrIndexWave).toFixed(1) };
    }
    if (r.node === 'OxyDex') hasOxy = true;
    // any OTHER node carrying a cardiac CVHR index (ECGDex today) is a corroborator — NOT the finger leg
    if (r.node !== 'PpgDex' && s.cvhrIndex != null && isFinite(s.cvhrIndex) && s.cvhrIndex >= 0) {
      corroborators.push({ node: r.node, cvhrIndex: +Number(s.cvhrIndex).toFixed(1), channel: r.node === 'ECGDex' ? 'cardiac CVHR (ECG R-R)' : 'CVHR' });
    }
  });
  if (!wave || !hasOxy) return null;
  // agreement vs each corroborator (events/h). The finger PPI is the reference; we report the gap.
  var checked = corroborators.map(function (c) {
    var gap = +Math.abs(c.cvhrIndex - wave.cvhrIndex).toFixed(1);
    return { node: c.node, channel: c.channel, cvhrIndex: c.cvhrIndex, gapPerH: gap, agree: gap <= CVHR_AGREE_PER_H };
  });
  var anyAgree = checked.some(function (c) {
    return c.agree;
  });
  var anyDisagree = checked.some(function (c) {
    return !c.agree;
  });
  return {
    reference: 'waveform', // the finger PPI CVHR is the honest measure; the ring's 1 Hz pulse cannot yield one
    source: 'finger PPI (PpgDex) — the O2Ring’s own single-channel pleth, whole-record Hayano CVHR',
    cvhrIndex: wave.cvhrIndex,
    unit: 'events/h',
    tier: 'emerging', // NOT validated — owed a real-corpus PSG/PulseDex comparison, same standing as verifiedUnder
    corroborators: checked, // OTHER nodes' cardiac CVHR, each with the gap vs the finger leg (never averaged)
    agreeThresholdPerH: CVHR_AGREE_PER_H,
    // §3.1 (b): this fusion publishes NO AHI — the only AHI on the bus stays OxyDex's ahiEst.
    ahiPublished: false,
    ahiOwner: 'OxyDex.ahiEst',
    note:
      'Finger-PPI CVHR ' +
      wave.cvhrIndex +
      ' events/h (the O2Ring’s own pleth, Hayano — the ring’s 1 Hz pulse cannot resolve it) is published at emerging' +
      (checked.length
        ? '; corroborated against ' +
          checked
            .map(function (c) {
              return c.node + ' ' + c.cvhrIndex + '/h (' + (c.agree ? 'agrees, Δ' + c.gapPerH : 'DIVERGES, Δ' + c.gapPerH) + ')';
            })
            .join(', ') +
          '. '
        : ' (no other CVHR source this night to corroborate against). ') +
      (checked.length ? (anyDisagree && !anyAgree ? 'Divergence reported, never averaged — trust the finger waveform. ' : anyAgree ? 'Agreement supports the reading. ' : '') : '') +
      'No AHI is published here — the only AHI is OxyDex’s ahiEst (§3.1 owner decision b).'
  };
}

/* §3.4 — "N INDEPENDENT ESTIMATES" MUST BE N INDEPENDENT OBSERVERS, ON ONE NIGHT.
   This collected every rec carrying a respRateBrpm with only a `dateUnknown` filter and gated on
   `sources.length < 2`, and runFusion is called with the WHOLE loaded bus. Two ECGDex exports from two
   DIFFERENT NIGHTS were therefore fused into one "consensus" and published as
   "2 independent estimates (ECGDex + ECGDex) … agreement within the ±2 br/min chest-ACC validation
   band" — same device, same RSA method, no chest-ACC leg present, no temporal overlap. That is
   AUDIT-PROMPT class 11 (a consensus statistic over inputs that are not independent) in its purest
   form. The sibling `fusePeriodicBreathing` already implements both missing guards; this ports them:
     (a) fuse only within a TEMPORALLY OVERLAPPING group, and
     (b) collapse to ONE observer per node before the <2 check, so `n` counts DISTINCT sources. */
function fuseRespirationRate(recs) {
  var cand = [];
  recs.forEach(function (r) {
    if (r.dateUnknown || !r.summary) return;
    var v = r.summary.respRateBrpm;
    if (v == null || !isFinite(v) || v <= 0) return;
    cand.push({ rec: r, node: r.node, method: r.summary.respRateMethod || null, brpm: +Number(v).toFixed(1) });
  });
  if (cand.length < 2) return null;
  // (a) Largest mutually-overlapping group: seed on each candidate and keep everything that overlaps
  // it, then take the biggest. Cheap (n is a handful) and deterministic.
  var best = /** @type {any[]} */ (cand.slice(0, 1)); // seeded non-null: cand.length >= 2 here
  for (var i = 0; i < cand.length; i++) {
    var grp = [cand[i]];
    for (var j = 0; j < cand.length; j++) {
      if (j === i) continue;
      if (_mayOverlap(cand[i].rec, cand[j].rec)) grp.push(cand[j]);
    }
    if (!best || grp.length > best.length) best = grp;
  }
  // (b) One observer per node — a second export from the same device is not a second opinion.
  var seenNode = {},
    sources = [];
  best.forEach(function (c) {
    if (seenNode[c.node]) return;
    seenNode[c.node] = 1;
    sources.push({ node: c.node, method: c.method, brpm: c.brpm });
  });
  if (sources.length < 2) return null;
  /* (c) ONE OBSERVER PER MECHANISM IS NOT THE SAME AS ONE PER NODE
     (TCH-REFERENCE-VALIDATION R3). §3.4 above stopped two exports from the same DEVICE being sold as
     "2 independent estimates"; two different devices deriving respiration the SAME WAY is the same
     overclaim one level up. ECGDex and PpgDex both report `RSA (HF-peak of RR spectrum)` — respiratory
     sinus arrhythmia read off the interval series — so they are two looks at one mechanism, not two
     looks at respiration. When RSA is wrong (Cheyne-Stokes, a paced or irregular rhythm, a sub-HF
     respiratory rate) it is wrong on both, and their agreement is partly tautological.
     Only MotionDex's `chest-ACC (thoraco-abdominal)` is mechanically independent of the RSA pair —
     which also matters because the ±RR_AGREE_BRPM band quoted below is Ryser 2022's CHEST-ACC
     validation band, derived against an independent comparator.
     R3 asked for "refuse, or loudly flag". Flag: the consensus is still the best available number and
     suppressing it would lose information — what is withdrawn is the claim of independence. */
  var famOf = function (m) {
    var t = String(m || '').toLowerCase();
    if (/rsa|hf[- ]peak/.test(t)) return 'RSA';
    if (/acc|thoraco/.test(t)) return 'chest-ACC';
    return 'other';
  };
  var mechs = sources.map(function (s) {
    return famOf(s.method);
  });
  var uniqMech = mechs.filter(function (m, i) {
    return mechs.indexOf(m) === i;
  });
  var mechIndependent = uniqMech.length > 1;

  var vals = sources.map(function (s) {
    return s.brpm;
  });
  var mn = Math.min.apply(null, vals),
    mx = Math.max.apply(null, vals),
    md = median(vals);
  var spread = +(mx - mn).toFixed(1);
  var agree = spread <= RR_AGREE_BRPM;
  var ovAllVerified = sources.length > 1 && best.length > 1 && _overlapVerified(best[0].rec, best[1].rec);
  return {
    sources: sources,
    n: sources.length,
    // §3.4 — n is DISTINCT observers on one overlapping group; false ⇒ a window was unknown, so the
    // simultaneity is unverified rather than proven.
    overlapVerified: ovAllVerified,
    consensusBrpm: +Number(md).toFixed(1),
    minBrpm: mn,
    maxBrpm: mx,
    spreadBrpm: spread,
    agree: agree,
    agreeThresholdBrpm: RR_AGREE_BRPM,
    // R3: the mechanism behind each estimate, and whether the set spans more than one.
    mechanisms: mechs,
    mechanismsIndependent: mechIndependent,
    note:
      sources.length +
      (mechIndependent ? ' independent estimates (' : ' estimates sharing ONE mechanism (' + uniqMech.join('/') + ') (') +
      sources
        .map(function (s) {
          return s.node;
        })
        .join(' + ') +
      '); spread ' +
      spread +
      ' br/min — ' +
      (agree
        ? 'agreement within the ±' + RR_AGREE_BRPM + ' br/min chest-ACC validation band (Ryser 2022).'
        : 'DISAGREEMENT beyond the ±' + RR_AGREE_BRPM + ' br/min band; treat the consensus as provisional.') +
      (mechIndependent
        ? ''
        : ' ⚠ Not independent looks at respiration: every corner is ' +
          uniqMech.join('/') +
          ', so a mechanism-level failure (Cheyne-Stokes, irregular rhythm, a sub-HF rate) moves them together and the agreement above is partly tautological. The ±' +
          RR_AGREE_BRPM +
          " br/min band is Ryser 2022's CHEST-ACC band, derived against an independent comparator.")
  };
}

/* DEEP-AUDIT-VI F11 — temporal-overlap grouping is a CONNECTED COMPONENT, not a greedy first-fit.
   fuseHRVConsensus / fuseStagingConsensus / fusePeriodicBreathing used to place each record in the
   first existing group it overlapped and never merged groups, so a record that BRIDGES two groups (an
   HRVDex envelope spanning days, an oximeter night spanning an evening strap and a therapy session)
   left membership a function of file-drop order: the same three records in three orders produced
   three different consensus blocks (['HRVDex+PulseDex'] / ['ECGDex+HRVDex+PulseDex'] /
   ['ECGDex+HRVDex']) and a periodic-breathing corroboration of conf 0.885 · 0.697 · 0.752 for
   IDENTICAL data. Union-find over the overlap relation makes each block the transitive closure, and
   the canonical member order (earliest window start, then node name, then original index as the
   tiebreak) makes `g[0]` — which fuseHRVConsensus reads for the reference hrvWindow — a function of
   the data too. `ov(a, b)` is the caller's overlap test on its own element shape. */
function _overlapComponents(items, ov) {
  var n = items.length;
  var parent = new Array(n);
  for (var i = 0; i < n; i++) parent[i] = i;
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  for (var a = 0; a < n; a++)
    for (var b = a + 1; b < n; b++) {
      if (!ov(items[a], items[b])) continue;
      var ra = find(a),
        rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    }
  var byRoot = {};
  for (var k = 0; k < n; k++) {
    var r = find(k);
    if (!byRoot[r]) byRoot[r] = [];
    byRoot[r].push(k);
  }
  function startOf(idx) {
    var w = recWindow(items[idx].rec || items[idx]);
    return w && isFinite(w.startMs) ? w.startMs : Infinity;
  }
  function nodeOf(idx) {
    var it = items[idx].rec || items[idx];
    return String((it && it.node) || '');
  }
  function cmp(x, y) {
    var sx = startOf(x),
      sy = startOf(y);
    if (sx !== sy) return sx < sy ? -1 : 1;
    var nx = nodeOf(x),
      ny = nodeOf(y);
    if (nx !== ny) return nx < ny ? -1 : 1;
    return x - y;
  }
  return Object.keys(byRoot)
    .map(function (root) {
      return byRoot[root].sort(cmp);
    })
    .sort(function (g, h) {
      return cmp(g[0], h[0]);
    })
    .map(function (g) {
      return g.map(function (idx) {
        return items[idx];
      });
    });
}

function fuseHRVConsensus(recs, dtMs) {
  var sources = recs.filter(function (r) {
    return ['ECGDex', 'PulseDex', 'HRVDex', 'PpgDex'].indexOf(r.node) >= 0 && !r.dateUnknown && r.summary && (r.summary.rmssd != null || r.summary.sdnn != null);
  });
  if (sources.length < 2) return null;
  // only compare sources whose windows overlap
  var groups = _overlapComponents(sources, function (a, b) {
    return !!overlapInterval(a, b);
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
      /* DEEP-AUDIT 2026-07-22 finding A: PpgDex's bare hrv.time.sdnn (summary.sdnn) is a
         WHOLE-RECORD optical SDNN that runs baseline-wander-inflated (~+26% vs chest ECG per
         its own sdnnNote); summary.sdnnRobustMs (hrv.time.sdnnRobust, the quality-gated per-5-min
         median, ~+3.5% vs ECG truth) is the cross-node-comparable axis — the same one
         fuseHrvResource already uses (:2318). For the SDNN consensus, resolve PpgDex to its robust
         axis so the surfaced divergence/qc reflects real agreement, not the wander inflation.
         summary.sdnn is deliberately left untouched (it feeds the per-source display rows). */
      function _cmpVal(s, key) {
        if (key === 'sdnn' && s.node === 'PpgDex') {
          var rob = s.summary.sdnnRobustMs;
          if (rob != null && isFinite(rob)) return rob;
        }
        return s.summary[key];
      }
      function spread(key) {
        var vs = like
          .map(function (s) {
            return _cmpVal(s, key);
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
              return { node: s.node, v: _cmpVal(s, key) };
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
      /* ── DO THE THREE LEGS EVEN ANSWER THE SAME QUESTION? (R5-HR-TRIPLET-FOLLOWUPS) ──────────────
         The hat differences three nodes' epoch HR. That is only a comparison of SENSORS if all three
         summarise an epoch with the same statistic — and they do not: OxyDex publishes
         `median(1 Hz rate)` where ECGDex and PpgDex publish `60000/mean(RR)`, a 0.299 bpm gap on real
         RR. That gap is the entire "OxyDex under-reads by 0.36 bpm" finding this hat was used to
         support. So the hat must SAY when its legs disagree rather than quietly attributing the
         difference to a device. Reported, not refused: the σ effect is under 2 %, so suppressing an
         otherwise-good hat would lose more than it protects. A node that declares nothing is `null`
         and counts as unknown, never as agreeing. */
      var _hrStats = hrLike.map(function (rc) {
        var eps = (rc.series && rc.series.hrvEpochs) || [];
        for (var i = 0; i < eps.length; i++) if (eps[i] && eps[i].hrStat) return eps[i].hrStat;
        return null;
      });
      var _hrStatSet = _hrStats.filter(function (v, i) {
        return v != null && _hrStats.indexOf(v) === i;
      });
      var _hrStatMixed = _hrStatSet.length > 1 || _hrStats.indexOf(null) >= 0;
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
          (hrReconciled != null ? '; reconciled HR ' + hrReconciled + ' bpm.' : '.') +
          (_hrStatMixed
            ? ' ⚠ Its legs do NOT share one epoch statistic (' +
              hrLike
                .map(function (rc, i) {
                  return rc.node + '=' + (_hrStats[i] || 'undeclared');
                })
                .join(', ') +
              '), so part of this spread is the choice of statistic, not the sensors: median-rate sits ≈0.3 bpm below rate-of-mean on real RR. Do not read a per-device bias off it.'
            : '');
      return {
        // R5-HR-TRIPLET-FOLLOWUPS — machine-readable siblings of the ⚠ in `note`, so a consumer can
        // gate on the confound instead of parsing prose. Additive; null when there is no HR hat.
        hrStats: tchHR && tchHR.ok ? _hrStats : null,
        hrStatMixed: tchHR && tchHR.ok ? _hrStatMixed : null,
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
  var groups = _overlapComponents(src, function (a, b) {
    return !!overlapInterval(a, b);
  });
  /* DEEP-AUDIT-FOLLOWUPS §C2 — FAIL CLOSED across denominators.
     `remFraction` does not mean the same thing on every leg: ECGDex divides REM by TOTAL SLEEP,
     OxyDex by RECORDING span. Subtracting one from the other and calling the result a "REM gap" is a
     unit error, and it fabricates disagreement (or hides it) out of arithmetic rather than physiology.

     Measured over 76 real nights before writing this: the OxyDex proxy is suppressed by the §7
     plausibility ceiling on 75 of them, so the comparison almost never runs today — this is a latent
     defect, not a live one, and it is fixed now precisely because the REM estimator is being
     re-derived and the day it starts producing plausible numbers is the day this starts firing.

     Converting is not available: OxyDex's only sleep estimate is motion-derived and reads 99.1–99.9 %
     on every night of the corpus, missing ECGDex's TST by a median 58 min, and on four nights the
     converted fraction exceeds 100 % — more REM than sleep. So a group whose legs disagree about the
     denominator is NOT fused; it is reported as unfusable, naming the bases, which is the honest
     answer and the one that survives whatever the estimator becomes.

     Legs that predate the field (no `remFractionBasis`) are treated as commensurate with each other
     but not with a declared-different one — a legacy export must not silently acquire a basis it
     never had. */
  var _basisOf = function (s) {
    return (s.summary && s.summary.remFractionBasis) || null;
  };
  var _mixedBasis = function (g) {
    var seen = {};
    for (var i = 0; i < g.length; i++) seen[String(_basisOf(g[i]))] = true;
    return Object.keys(seen).length > 1;
  };
  var blocks = groups
    .filter(function (g) {
      return g.length >= 2;
    })
    .map(function (g) {
      if (_mixedBasis(g)) {
        return {
          window: fmtDayShort(g[0].t0Ms),
          nodes: g.map(function (s) {
            return s.node;
          }),
          remByNode: g.map(function (s) {
            return { node: s.node, remPct: +(s.summary.remFraction * 100).toFixed(1), basis: _basisOf(s), method: s.summary.stagingMethod || null };
          }),
          remGapPct: null, // §C2: not computed — the legs are not commensurate
          disagreement: null, // neither agreement nor disagreement is knowable here
          unfusable:
            'mixed remFraction denominators (' +
            g
              .map(function (s) {
                return s.node + '=' + (_basisOf(s) || 'undeclared');
              })
              .join(', ') +
            ') — REM fractions on different clocks are not comparable; no gap computed',
          note: 'Sleep-stage legs could not be fused: they denominate REM on different clocks. Reported separately rather than differenced.'
        };
      }
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
  var groups = _overlapComponents(src, function (a, b) {
    return !!overlapInterval(a.rec, b.rec);
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

/* ════════════════════════════════════════════════════════════════════════════
   CROSS-DEVICE-CLOCK-SKEW §3.1 — a node whose clock is wrong looks exactly like
   a node that observed nothing.

   `runFusion` pairs events within `toleranceSec` (default 120 s). A device whose
   internal clock is off by more than that never co-occurs with anything, and the
   fusion reports a quiet, confident nothing. Measured on the reference corpus:
   the CPAP's clock runs ~39 min slow, so NO CPAP event has ever co-occurred with
   any other node's — `alsoObservedBy`, the apnea-confirmation path and the
   redundancy accounting all ran on an empty intersection without a word.

   A fusion that finds ZERO overlap between two nodes that each reported plenty of
   events has learned something. These functions stop discarding it.

   The estimator needs no reference clock, which matters here: the machine is on
   its own cell network, so it cannot be disciplined by NTP and the skew is
   permanent. It recovers the offset from the DATA — the lag at which two nodes'
   events coincide most — and reports the peak-over-floor that justifies the
   claim, so a weak or absent peak declares nothing rather than inventing a shift.
   ════════════════════════════════════════════════════════════════════════════ */

/* COARSE GATE (stage 1 of 2). Lag (seconds) at which B's events best coincide with A's, by direct
   search over the full +/-90 min range.

   This is deliberately a COARSE instrument and is scoped as one. Measured on the reference corpus it
   is precise but sparse: 6 of 38 nights resolved, ZERO false positives, and every hit within
   37.5-40.0 min of the independently-established 39.5 min offset. Tightening it to that precision
   cost recall (a looser setting found 17 nights but also named a host-captured node as 29 min skewed
   on a night with no CPAP present at all) — and for a correction that gets APPLIED, a wrong 30-minute
   shift on good data is worse than a missed detection.

   Its job is therefore to NARROW THE SEARCH, not to be the final answer: it turns an unbounded
   +/-90 min hunt into a few-minute window that a precise estimator can resolve inside. The fine
   stage is the anchor-based cross-correlation already shipped in `pat-feasibility-worker.js`
   (`estimateDriftACC`), which locks onto strong isolated body movements — simultaneous in two
   devices by physics — instead of correlating whole noisy series. See
   `CROSS-DEVICE-CLOCK-SKEW-2026-07-29-BRIEF.md`.

   Lag (seconds) at which B's events best coincide with A's.
   Returns null when either side is too sparse to carry an opinion.
   `peakOverFloor` is the honesty term: the peak count divided by the MEAN count
   across all scanned lags — i.e. how much better the winner does than a random
   alignment of the same two event sets. A true skew produced 4.3–6.2x on the
   reference corpus; noise sits at ~1. */
function estimateEventLag(aTimes, bTimes, opts) {
  opts = opts || {};
  var maxSec = opts.maxLagSec != null ? opts.maxLagSec : 5400; // ±90 min
  var stepSec = opts.stepSec != null ? opts.stepSec : 30;
  var tolMs = (opts.matchSec != null ? opts.matchSec : 60) * 1000;
  var minEvents = opts.minEvents != null ? opts.minEvents : 5;
  var A = (aTimes || []).filter(function (t) {
    return t != null && isFinite(t);
  });
  var B = (bTimes || [])
    .filter(function (t) {
      return t != null && isFinite(t);
    })
    .sort(function (x, y) {
      return x - y;
    });
  if (A.length < minEvents || B.length < minEvents) return null;
  var best = null,
    total = 0,
    nLags = 0;
  for (var L = -maxSec; L <= maxSec; L += stepSec) {
    var shift = L * 1000,
      hits = 0;
    for (var i = 0; i < A.length; i++) {
      var t = A[i] + shift;
      // nearest-neighbour by binary search — O(n log m) per lag, not O(n·m)
      var lo = 0,
        hi = B.length - 1,
        near = Infinity;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1,
          d = Math.abs(B[mid] - t);
        if (d < near) near = d;
        if (B[mid] < t) lo = mid + 1;
        else hi = mid - 1;
      }
      if (near <= tolMs) hits++;
    }
    total += hits;
    nLags++;
    /* A hard match window makes the peak a PLATEAU about 2x`matchSec` wide, not a spike: every lag
       that puts each event within the window scores identically. Keeping the first, the last, or the
       one nearest zero all bias the estimate by up to the window. Collect the whole plateau and take
       its CENTRE, which is unbiased and — for a genuinely aligned pair — is exactly 0 by symmetry. */
    if (!best || hits > best.hits) best = { hits: hits, lags: [L] };
    else if (hits === best.hits) best.lags.push(L);
  }
  if (!best || !nLags) return null;
  var floor = total / nLags;
  var centre = Math.round((best.lags[0] + best.lags[best.lags.length - 1]) / 2 / stepSec) * stepSec;
  return {
    lagSec: centre,
    plateauSec: best.lags[best.lags.length - 1] - best.lags[0],
    hits: best.hits,
    floor: +floor.toFixed(2),
    peakOverFloor: floor > 0 ? +(best.hits / floor).toFixed(2) : null,
    nA: A.length,
    nB: B.length
  };
}

/* A DETERMINISTIC PRNG, seeded from the sample itself.

   The bootstrap below has to be reproducible: a confidence interval that moves on re-run is not a
   measurement, and it would make every fixture that carries one non-deterministic — the exact failure
   `PROVENANCE-NONDETERMINISM` was written to kill. `Math.random()` is therefore not an option. */
function _seededRng(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* The MODE of a delta distribution, at second resolution.

   `estimateEventLag` scans on a 30 s grid with a ±60 s match window, so it cannot report better than
   its own coarseness — quoting its peak as the offset states the INSTRUMENT's resolution as if it were
   the DATA's. Given the coarse peak, the deltas themselves locate far tighter: with hundreds of pairs
   the mode is pinnable to seconds, and four independent sensors on the real corpus agreed to 12 s.

   Smoothed by a ±`smoothSec` window rather than taken as a bare histogram argmax, because a raw argmax
   on 1 s bins ties constantly and the tie-break is arbitrary — which is precisely how a spurious −72.5
   min was once reported as a measurement when −17.5 tied it exactly. */
function deltaModeSec(deltasSec, opts) {
  opts = opts || {};
  var smooth = opts.smoothSec != null ? opts.smoothSec : 15;
  if (!deltasSec || !deltasSec.length) return null;
  var counts = Object.create(null);
  for (var i = 0; i < deltasSec.length; i++) {
    var k = Math.round(deltasSec[i]);
    for (var o = -smooth; o <= smooth; o++) {
      var key = k + o;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  var bestV = -1;
  for (var k0 in counts) if (counts[k0] > bestV) bestV = counts[k0];
  // Every bin holding the maximum. A smoothed histogram maximum is a PLATEAU, not a point, so taking
  // a bare argmax returns whichever EDGE the iterator happened to reach first — an arbitrary answer
  // that moves with key order.
  var tied = [];
  for (var k1 in counts) if (counts[k1] === bestV) tied.push(+k1);
  if (!tied.length) return null;
  tied.sort(function (x, y) {
    return x - y;
  });
  // Split into contiguous runs: one plateau is a single estimate, but two SEPARATED clusters are a
  // genuinely bimodal distribution, and averaging across them would invent a value that no cluster
  // supports (a mid-point between -600 and +600 is not "0 s of skew", it is a refusal dressed as a
  // measurement). Each run collapses to its own centre; the runs then compete.
  var runs = [[tied[0]]];
  for (var i2 = 1; i2 < tied.length; i2++) {
    if (tied[i2] - tied[i2 - 1] <= 1) runs[runs.length - 1].push(tied[i2]);
    else runs.push([tied[i2]]);
  }
  var centres = runs.map(function (r) {
    return Math.round((r[0] + r[r.length - 1]) / 2);
  });
  // Nearest-to-zero wins, and an exact |tie| resolves to the smaller value — deterministic either
  // way. Arbitrary tie-breaking is precisely how a tied rival was once promoted to a finding.
  var best = centres[0];
  for (var i3 = 1; i3 < centres.length; i3++) {
    var c = centres[i3];
    if (Math.abs(c) < Math.abs(best) || (Math.abs(c) === Math.abs(best) && c < best)) best = c;
  }
  return best;
}

/* Refine a coarse lag to seconds, with a bootstrap interval.

   Deltas are collected only within ±`windowSec` of the coarse peak: outside that they are unrelated
   event pairs, and letting them in would drag the mode toward the centre of whatever range was
   searched. Returns null when too few pairs survive — an interval computed from a handful of pairs is
   a number without a measurement behind it. */
function refineLagByDeltaMode(aTimes, bTimes, coarseLagSec, opts) {
  opts = opts || {};
  var windowSec = opts.windowSec != null ? opts.windowSec : 360;
  /* 10, not 25. A single night carries only ~15-50 scored apneas, so a threshold tuned for the
     POOLED corpus (hundreds of pairs) can never be met per night and every channel reports "too few
     pairs" — a gate that silently rejects the whole use case it was built for. Ten pairs gives a wide
     interval, which is the honest outcome and is published as such. */
  var minPairs = opts.minPairs != null ? opts.minPairs : 10;
  var iters = opts.bootstrapIters != null ? opts.bootstrapIters : 200;
  if (coarseLagSec == null || !isFinite(coarseLagSec)) return null;
  var B = (bTimes || [])
    .filter(function (t) {
      return t != null && isFinite(t);
    })
    .sort(function (x, y) {
      return x - y;
    });
  var A = (aTimes || []).filter(function (t) {
    return t != null && isFinite(t);
  });
  if (!A.length || !B.length) return null;
  var deltas = [];
  for (var i = 0; i < A.length; i++) {
    var best = null,
      bd = Infinity;
    for (var j = 0; j < B.length; j++) {
      var d = (B[j] - A[i]) / 1000;
      var off = Math.abs(d - coarseLagSec);
      if (off <= windowSec && off < bd) {
        bd = off;
        best = d;
      }
    }
    if (best != null) deltas.push(best);
  }
  if (deltas.length < minPairs) return null;
  var mode = deltaModeSec(deltas, opts);
  // Seed from the sample so the interval is reproducible run to run and machine to machine.
  var seed = deltas.length;
  for (var s = 0; s < deltas.length; s++) seed = (seed * 31 + Math.round(deltas[s])) >>> 0;
  var rnd = _seededRng(seed),
    modes = [];
  for (var b = 0; b < iters; b++) {
    var re = new Array(deltas.length);
    for (var r = 0; r < deltas.length; r++) re[r] = deltas[(rnd() * deltas.length) | 0];
    modes.push(deltaModeSec(re, opts));
  }
  // `deltaModeSec` is typed `number | null`; a resample can in principle be empty. Coerce before the
  // comparator rather than subtracting possibly-null operands.
  modes = modes.map(function (m) {
    return m == null ? 0 : m;
  });
  modes.sort(function (x, y) {
    return x - y;
  });
  return {
    offsetSec: mode,
    ciLoSec: modes[Math.floor(modes.length * 0.025)],
    ciHiSec: modes[Math.floor(modes.length * 0.975)],
    nPairs: deltas.length
  };
}

/* FIT THE CLOCK OFFSET OF ONE NODE FROM EVERY OTHER SENSOR AVAILABLE.

   `anchor` is the suspect (the CPAP, whose clock has no user-settable time); `channels` are every
   other event stream, each from some node and some impulse. Each channel is estimated INDEPENDENTLY
   and reported separately, because that is what makes the answer auditable: on the real corpus a
   finger oximeter, a chest ECG and an arm IMU agreed within 12 s through four unrelated mechanisms,
   and seeing the three numbers side by side is what establishes that — a single blended figure would
   not.

   DEGRADES BY DESIGN. Channels are independent, so any subset works: a night with only the oximeter
   still fits, one with no partner at all reports `confident:false` with a reason rather than a
   fabricated number. A channel that cannot be estimated is RETAINED in `channels` with `usable:false`
   and why — never dropped silently, because a missing contributor is itself information (that is the
   whole lesson of the silent-zero class this suite keeps finding).

   The combined estimate is the MEDIAN of the usable channel modes, not a mean: one bad channel must
   not drag the answer, and with 3+ channels the median is immune to a single outlier. `spreadSec` is
   published alongside because agreement across independent mechanisms IS the confidence — and where
   the channels disagree, the disagreement is physiological latency (movement fires at arousal,
   desaturation trails it by circulation transit), so a small spread is expected and a large one is a
   warning, not noise to average away. */
function fitClockOffset(anchorTimes, channels, opts) {
  opts = opts || {};
  var minPeakOverFloor = opts.minPeakOverFloor != null ? opts.minPeakOverFloor : 3;
  var out = [];
  var A = (anchorTimes || []).filter(function (t) {
    return t != null && isFinite(t);
  });
  for (var i = 0; i < (channels || []).length; i++) {
    var ch = channels[i] || {};
    /** @type {any} — progressively filled: the literal initialiser would otherwise pin these fields
        to `null` and reject every later assignment. */
    var rec = {
      node: ch.node || null,
      channel: ch.channel || null,
      nEvents: (ch.times || []).length,
      usable: false,
      offsetSec: null,
      ciLoSec: null,
      ciHiSec: null,
      nPairs: null,
      peakOverFloor: null,
      reason: null
    };
    if (!A.length) rec.reason = 'no anchor events';
    else if (rec.nEvents < (opts.minEvents != null ? opts.minEvents : 5)) rec.reason = 'too few events';
    else {
      var coarse = estimateEventLag(A, ch.times, opts);
      if (!coarse) rec.reason = 'no coarse peak';
      else {
        rec.peakOverFloor = coarse.peakOverFloor;
        if (coarse.peakOverFloor == null || coarse.peakOverFloor < minPeakOverFloor) rec.reason = 'peak does not clear the floor';
        else {
          var fine = refineLagByDeltaMode(A, ch.times, coarse.lagSec, opts);
          if (!fine) rec.reason = 'too few pairs to refine';
          else if (fine.ciHiSec - fine.ciLoSec > (opts.maxCiSec != null ? opts.maxCiSec : 300)) {
            /* A DATA-DRIVEN quality gate, deliberately not an allow-list of impulse names. Sleep-STATE
               impulses (`stage_light`, `stage_deep`, …) are long segments spread across the whole
               night, so on a 20-event night they clear a peak-over-floor test at essentially arbitrary
               lags — and blending them in produced per-night answers from -80 to +60 min. What
               separates them from a real arousal marker is not their NAME but their STABILITY: a
               genuine coincidence has a repeatable mode, so its bootstrap interval is tight, while a
               chance alignment moves under resampling. Gating on CI width therefore generalises to
               sensors and impulses this code has never seen — which is the whole point, since the
               offset must be measurable on someone else's hardware, not just this deployment's. */
            rec.offsetSec = fine.offsetSec;
            rec.ciLoSec = fine.ciLoSec;
            rec.ciHiSec = fine.ciHiSec;
            rec.nPairs = fine.nPairs;
            rec.reason = 'unstable under resampling (CI ' + Math.round(fine.ciHiSec - fine.ciLoSec) + ' s)';
          } else {
            rec.usable = true;
            rec.offsetSec = fine.offsetSec;
            rec.ciLoSec = fine.ciLoSec;
            rec.ciHiSec = fine.ciHiSec;
            rec.nPairs = fine.nPairs;
          }
        }
      }
    }
    out.push(rec);
  }
  var good = out.filter(function (r) {
    return r.usable;
  });
  if (!good.length) return { offsetSec: null, spreadSec: null, confident: false, reason: 'no channel could be estimated', channels: out };
  /* AGREEMENT, not an average. A plain median over every channel that clears the floor is wrong,
     and measurably so: sleep-STAGE impulses (`stage_light`, `stage_deep`, …) are long segments spread
     across the whole night, so on a 20-event night they clear a 3x floor by chance at arbitrary lags.
     Blending them in produced per-night answers from -45 to +60 min with 7000 s "spreads" — a number
     with no measurement behind it.

     So cluster the estimates and let the clusters compete on INDEPENDENT CORROBORATION: the winner is
     the one supported by the most distinct NODES. Two unrelated sensors agreeing to within a couple of
     minutes is evidence; five channels of one node scattering is not. Ties break on channel count,
     then on tightness — deterministically, never on iteration order. */
  var sorted = good.slice().sort(function (x, y) {
    return x.offsetSec - y.offsetSec;
  });
  var tolSec = opts.agreeSec != null ? opts.agreeSec : 180;
  var clusters = [[sorted[0]]];
  for (var q = 1; q < sorted.length; q++) {
    var cur = clusters[clusters.length - 1];
    if (sorted[q].offsetSec - cur[cur.length - 1].offsetSec <= tolSec) cur.push(sorted[q]);
    else clusters.push([sorted[q]]);
  }
  var scored = clusters.map(function (c) {
    var nodes = {};
    c.forEach(function (r) {
      if (r.node) nodes[r.node] = 1;
    });
    return { c: c, nodes: Object.keys(nodes).length, width: c[c.length - 1].offsetSec - c[0].offsetSec };
  });
  /* Rank on (distinct nodes, then channels, then tightness). The comparison is STRICT-improvement, so
     when nothing separates two clusters the incumbent keeps the win — and the incumbent is `scored[0]`,
     the cluster with the SMALLEST offset, because `sorted` is ascending. Deterministic, but ARBITRARY:
     on a real tie the answer is decided by which offset happens to be numerically lower.

     Not hypothetical. 2026-07-30 produced exactly two single-channel clusters — `ECGDex/movement_onset`
     at -21.82 min and `ECGDex/autonomic_surge` at +74.92 min — identical on all three criteria (1 node,
     1 channel, 0 s width). The fit reported -21.82 with nothing to say a rival 96 minutes away was
     equally supported. Had the surge landed at -80, it would have "won" instead.

     So a tie is now REPORTED, not broken. `confident` is forced false even when the winner carries two
     corroborating nodes: "two clusters, each corroborated" is an ambiguous night, not a measured one —
     and that is precisely the case where the old code returned an arbitrary pick wearing a confidence
     flag. */
  var cmp = function (z, y) {
    return z.nodes !== y.nodes ? z.nodes - y.nodes : z.c.length !== y.c.length ? z.c.length - y.c.length : y.width - z.width;
  };
  var win = scored[0];
  for (var w = 1; w < scored.length; w++) if (cmp(scored[w], win) > 0) win = scored[w];
  var tied = scored.filter(function (z) {
    return z !== win && cmp(z, win) === 0;
  });
  var medOf = function (c) {
    var v = c
      .map(function (r) {
        return r.offsetSec;
      })
      .sort(function (x, y) {
        return x - y;
      });
    var m = v.length >> 1;
    return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
  };
  var median = medOf(win.c);
  win.c.forEach(function (r) {
    r.agreed = true;
  });
  // The rivals the tie-break could equally have chosen. Surfaced so a reader sees the disagreement
  // rather than a single number that happens to have sorted first.
  var alternativesSec = tied.map(function (z) {
    return medOf(z.c);
  });
  var tieReason = null;
  if (tied.length) {
    var everyOffsetMin = [median]
      .concat(alternativesSec)
      .map(function (s) {
        return (s / 60).toFixed(2);
      })
      .join(' / ');
    tieReason = 'ambiguous — ' + (tied.length + 1) + ' equally-supported offsets (' + everyOffsetMin + ' min); the evidence does not choose between them';
  }
  return {
    offsetSec: median,
    spreadSec: win.width,
    nChannels: win.c.length,
    nNodes: win.nodes,
    // AMBIGUOUS beats corroborated. A tie means the evidence does not pick a winner, so no number of
    // agreeing nodes rescues it — reporting one side as confident would be the fabricated authority
    // this whole estimator exists to avoid.
    ambiguous: tied.length > 0,
    alternativesSec: alternativesSec,
    // One node is an estimate; two or more DISTINCT nodes agreeing through unrelated mechanisms is a
    // measurement. Channel count alone does not qualify — five channels of one device share its faults.
    confident: win.nodes >= 2 && !tied.length,
    reason: tieReason || (win.nodes >= 2 ? null : 'only one device agrees — corroboration unavailable'),
    channels: out
  };
}

/* COINCIDENCE COUNT PER CANDIDATE LAG, exactly — the kernel of the pooled fit.

   For every lag on the grid, how many ANCHORS have at least one partner event within +/-`matchSec`
   of `t + L`. Anchors, not pairs: a burst of ten partner events around one anchor is one piece of
   evidence, and counting it ten times is the same correlated-votes error the movement-onset isolation
   rule exists to prevent.

   Computed by STABBING rather than by scanning lags. For one anchor and one partner event the set of
   lags that match is the interval [d-matchSec, d+matchSec] around their delta; the lags that match the
   ANCHOR are the UNION of those intervals over its events. Union bounds go into a difference array and
   one prefix sum yields every lag at once — O(nA·nE) total instead of O(nLags·(nA+nE)), which is what
   makes a 30-iteration in-run null affordable rather than a minute of CPU. Because the partner list is
   sorted the deltas are too, so the union is a single forward merge with no sort. */
function _coincidenceCurve(A, E, nLags, maxSec, stepSec, matchSec) {
  var diff = new Float64Array(nLags + 1);
  var span = (maxSec + matchSec) * 1000;
  for (var i = 0; i < A.length; i++) {
    var a = A[i];
    // First event that can possibly match at the most negative lag.
    var lo = 0,
      hi = E.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (E[mid] < a - span) lo = mid + 1;
      else hi = mid;
    }
    var curLo = 0,
      curHi = -1; // empty run
    for (var j = lo; j < E.length; j++) {
      var d = (E[j] - a) / 1000;
      if (d > maxSec + matchSec) break;
      var iLo = Math.ceil((d - matchSec + maxSec) / stepSec);
      var iHi = Math.floor((d + matchSec + maxSec) / stepSec);
      if (iHi < 0 || iLo > nLags - 1) continue;
      if (iLo < 0) iLo = 0;
      if (iHi > nLags - 1) iHi = nLags - 1;
      if (curHi < curLo) {
        curLo = iLo;
        curHi = iHi;
      } else if (iLo <= curHi + 1) {
        if (iHi > curHi) curHi = iHi;
      } else {
        diff[curLo] += 1;
        diff[curHi + 1] -= 1;
        curLo = iLo;
        curHi = iHi;
      }
    }
    if (curHi >= curLo) {
      diff[curLo] += 1;
      diff[curHi + 1] -= 1;
    }
  }
  var out = new Float64Array(nLags),
    run = 0;
  for (var k = 0; k < nLags; k++) {
    run += diff[k];
    out[k] = run;
  }
  return out;
}

/* Z-SCORE A CHANNEL AGAINST ITS OWN CHANCE FLOOR. The load-bearing line of the whole pooled fit.

   Raw coincidence counts are not comparable across channels: a channel with 2000 movement onsets
   scores an order of magnitude more hits at EVERY lag than one with 30 desaturations, so summing raw
   counts lets event density masquerade as evidence. Dividing each channel's excess by its own Poisson
   noise (`sqrt(mean)`, the mean taken across all scanned lags — the same floor `estimateEventLag`
   already publishes as `peakOverFloor`) makes the statistic SCALE-FREE, so a sparse-but-sharp channel
   and a dense-but-vague one are weighed by information rather than by volume. */
function _zCurve(counts) {
  var n = counts.length,
    sum = 0;
  for (var i = 0; i < n; i++) sum += counts[i];
  var mean = sum / n;
  var z = new Float64Array(n);
  if (!(mean > 0)) return z;
  var sd = Math.sqrt(mean);
  for (var j = 0; j < n; j++) z[j] = (counts[j] - mean) / sd;
  return z;
}

/* The pooled statistic and its peak. Sum of per-channel z divided by `sqrt(nChannels)`, so that under
   the chance floor the pooled value keeps unit variance whatever the channel count — which is what
   lets "1 pooled unit" be used below as the noise scale for deciding what counts as a rival peak.
   The peak is the CENTRE of its plateau, for the same reason `estimateEventLag` centres its own: a
   hard match window makes equal-scoring neighbours, and keeping the first would bias by the window. */
function _pooledPeak(zs) {
  var m = zs.length,
    n = m ? zs[0].length : 0,
    denom = Math.sqrt(m || 1);
  var Z = new Float64Array(n);
  for (var i = 0; i < n; i++) {
    var s = 0;
    for (var c = 0; c < m; c++) s += zs[c][i];
    Z[i] = s / denom;
  }
  var bi = 0;
  for (var k = 1; k < n; k++) if (Z[k] > Z[bi]) bi = k;
  var lo = bi,
    hi = bi;
  while (lo > 0 && Z[lo - 1] === Z[bi]) lo--;
  while (hi < n - 1 && Z[hi + 1] === Z[bi]) hi++;
  return { Z: Z, idx: (lo + hi) >> 1, peak: Z[bi] };
}

/* THE NULL ANCHOR SET — the same events, rearranged so that any real alignment is destroyed.

   Shuffling the GAPS rather than scattering anchors uniformly is deliberate. It preserves the count,
   the first anchor, the total span AND the inter-event interval distribution, so the null differs from
   the truth in exactly one respect: the arrangement. Uniform scatter would additionally destroy the
   anchor process's burstiness and would therefore understate the chance floor for a bursty night.

   It also earns an honest failure mode for free. If the anchors are near-PERIODIC, a gap shuffle
   reproduces almost the same point set, the null scores almost as high as the truth, and the fit
   reports low confidence — which is correct, because a periodic anchor train only determines the
   offset modulo its period. A uniform null would have hidden that ambiguity behind a confident flag. */
function _shuffledAnchors(A, rnd) {
  var n = A.length;
  if (n < 3) return A.slice();
  var gaps = [];
  for (var i = 1; i < n; i++) gaps.push(A[i] - A[i - 1]);
  for (var j = gaps.length - 1; j > 0; j--) {
    var k = (rnd() * (j + 1)) | 0;
    var t = gaps[j];
    gaps[j] = gaps[k];
    gaps[k] = t;
  }
  var out = [A[0]];
  for (var q = 0; q < gaps.length; q++) out.push(out[q] + gaps[q]);
  return out;
}

/* FIT THE CLOCK OFFSET BY POOLING EVERY CHANNEL AT ONE CANDIDATE OFFSET.

   `fitClockOffset` above estimates each channel INDEPENDENTLY, keeps the ones that clear a floor,
   clusters them by proximity and lets the clusters compete on distinct-node count. Every failure it
   has is a symptom of that shape: it computes `peakOverFloor` and a confidence interval per channel,
   REPORTS both, and then picks the winner by counting nodes — so on 2026-06-15 three weak channels
   (peaks 3.40-4.46) outvoted one strong one (desaturation, peak 6.75, CI 22 s wide) and the night was
   published as a corroborated 1.53 min when the truth was near 40.

   Pooling asks the question the other way round: slide ONE candidate offset across the night and score
   EVERY channel at it. On the real corpus (31 nights, `POOLED-CLOCK-FIT-2026-07-31-BRIEF.md`) this put
   29/29 pre-correction nights inside the expected band against 22/25 for the vote, AND resolved four
   nights where no individual channel could be estimated at all — eight weak channels together carry
   what none carries alone. That is the argument for pooling in one sentence.

   IT NEEDS NO EXCLUSION LIST. A channel carrying no timing information contributes noise at EVERY lag,
   so it cannot move the peak; `stage_*` impulses are simply included and are harmless. The
   strongest-channel rule needed them excluded by name to reach 25/25. An estimator that needs an
   allow-list of trustworthy channels is wrong the first time a node ships a new impulse.

   CONFIDENCE IS MEASURED IN-RUN, NOT THRESHOLDED. The corpus null (93 random anchor sets) puts real
   nights at Z 6.2-17.2 and null nights at 3.4-9.6 — OVERLAPPING, so no fixed Z threshold is honest and
   12 of 31 real nights sit under the null's maximum. What separates truth from chance is concentration
   across nights, not height within one. So each night calibrates against ITS OWN null: shuffle this
   night's anchor gaps `nullIters` times, refit, and report where the real peak falls against that
   night's own chance distribution. Self-calibrating, no corpus constant, and it degrades honestly on
   exactly the nights that deserve it. */

/* ══ WEARABLE-TO-WEARABLE ALIGNMENT FROM RAW ACCELEROMETERS ═══════════════════
   Everything above measures a wearable against the CPAP. Nothing measured the
   wearables against EACH OTHER, and the estimator quietly assumed they agreed.
   They do not: on this corpus the H10 and the Verity sit **~3.3 s apart on every
   phone-captured night** (24 of 24, median 3.3 s, none inside 1 s) and ~0.2 s
   apart on every box-captured night. A systematic bias, invisible for months,
   because no code ever compared them.

   Two accelerometers strapped to one body see the same turn at the same instant —
   physics, with no physiology in between — which makes ACC-vs-ACC the only
   contrast able to check this on EVERY night, rather than on the 8 of 31 where a
   sparse event channel happened to clear its null.

   WINDOWED, NOT GLOBAL — published practice, not preference. SOURCES:
     · Brønd JC, Pedersen NH, Larsen KT, Grøntved A (2021) "Temporal Alignment of Dual
       Monitor Accelerometry Recordings." Sensors 21(14):4777.
       doi:10.3390/s21144777 — windowed cross-correlation of accelerometer NORMS;
       offset AND drift modelled as linear in time.
     · "BMAR: Barometric and Motion-based Alignment and Refinement for Offline
       Signal Synchronization across Devices." arXiv:2501.16015 (2025) — coarse
       pre-align, then refine by correlating ACC in patches; explicitly motivated
       by robustness to short-term misalignment.
     · Xiao R, Ding C, Hu X (2022) "Time Synchronization of Multimodal Physiological
       Signals through Alignment of Common Signal Types." J. Imaging 8(5):120.
       doi:10.3390/jimaging8050120 — align on a COMMON signal type shared by both
       devices, agnostic to which signal it is.
     · Knapp CH, Carter GC (1976) "The Generalized Correlation Method for
       Estimation of Time Delay." IEEE Trans. ASSP 24(4):320-327.
       doi:10.1109/TASSP.1976.1162830 — reference treatment of correlation-based
       TDOA. PHAT weighting is the documented next refinement for this code.
   One
   correlation over a whole night yields one number and hides everything: it cannot
   tell a constant offset from a drifting one, and a single restless hour dominates
   it. Correlating in windows and regressing lag against time yields BOTH terms —
   intercept = offset, slope = clock drift in ppm — plus residual scatter as the
   honest quality measure. Drift is the term this corpus could never reach before:
   regressing the CPAP offset across 48 days gave -12.8 +/- 6.3 ppm, marginal at
   2 sigma, because per-night precision (~50 s) was worse than the whole 48-day
   drift (~53 s). Measured WITHIN a night, drift no longer has to fight that noise. */

/* Gravity-removed activity envelope from tri-axial acceleration.

   The devices are on different limbs in different orientations, so no axis
   corresponds to any other; only the MAGNITUDE of change is comparable — the
   correlate-the-norms convention used whenever sensor frames are unknown.
   First-differencing is the high-pass: it removes the 1 g gravity vector AND
   posture, so lying still on one side cannot masquerade as motion. `log1p`
   compression stops one violent turn from owning the night — without it the
   correlation is decided by a single event, which is a sample size of one wearing
   the costume of an 8-hour recording. */
function activityEnvelope(x, y, z, dtSec) {
  var n = Math.min(x ? x.length : 0, y ? y.length : 0, z ? z.length : 0);
  if (n < 2 || !(dtSec > 0)) return new Float64Array(0);
  var out = new Float64Array(n);
  out[0] = 0;
  for (var i = 1; i < n; i++) {
    var d = Math.abs(x[i] - x[i - 1]) + Math.abs(y[i] - y[i - 1]) + Math.abs(z[i] - z[i - 1]);
    out[i] = isFinite(d) ? Math.log1p(d) : 0;
  }
  return out;
}

/* Pearson correlation of `a` against `b` shifted by `k`, over the VALID OVERLAP ONLY.

   Mean and variance are recomputed on exactly the samples being compared. Not
   pedantry: normalising over a whole array and then correlating a subset produced
   r = 1.044 in the prototype for this code — an impossible correlation, and the
   tell that the two were different sample sets. A similarity score that can exceed
   1 cannot be compared against a threshold or against a null. */
function _ncc(a, b, k, step) {
  step = step || 1;
  var i0 = Math.max(0, -k),
    i1 = Math.min(a.length, b.length - k);
  var n = 0,
    sa = 0,
    sb = 0;
  for (var i = i0; i < i1; i += step) {
    var u = a[i],
      v = b[i + k];
    if (!isFinite(u) || !isFinite(v)) continue;
    sa += u;
    sb += v;
    n++;
  }
  if (n < 8) return null;
  var ma = sa / n,
    mb = sb / n,
    saa = 0,
    sbb = 0,
    sab = 0;
  for (var j = i0; j < i1; j += step) {
    var p = a[j],
      q = b[j + k];
    if (!isFinite(p) || !isFinite(q)) continue;
    var da = p - ma,
      db = q - mb;
    saa += da * da;
    sbb += db * db;
    sab += da * db;
  }
  var den = Math.sqrt(saa * sbb);
  return den > 0 ? sab / den : null;
}

/* Theil-Sen robust line fit. Theil H (1950) Proc. K. Ned. Akad. Wet. 53:386-392;
   Sen PK (1968) J. Am. Stat. Assoc. 63(324):1379-1389,
   doi:10.1080/01621459.1968.10480934.

   The median of all pairwise slopes. Chosen over least squares because a
   window containing no body movement produces a lag that is pure chance, and one
   such window is enough to tilt an OLS line into a fabricated drift. Theil-Sen
   tolerates ~29 % such windows before it breaks, and it is deterministic. */
function _theilSen(xs, ys) {
  var slopes = [];
  for (var i = 0; i < xs.length; i++)
    for (var j = i + 1; j < xs.length; j++) {
      var dx = xs[j] - xs[i];
      if (Math.abs(dx) > 1e-9) slopes.push((ys[j] - ys[i]) / dx);
    }
  if (!slopes.length) return null;
  slopes.sort(function (p, q) {
    return p - q;
  });
  var m = slopes[slopes.length >> 1];
  var res = xs.map(function (x, k) {
    return ys[k] - m * x;
  });
  res.sort(function (p, q) {
    return p - q;
  });
  /* ── THE SLOPE'S OWN INTERVAL, and whether the median is an ATOM ──────────────────────────────
     A point slope with no interval beside it is the failure `WEARABLE-HOST-AXIS-FOLLOWUPS` §F7
     documented: three fits of the SAME usable windows spanning 0 → 720 ppm, and 7 of 14 nights
     returning exactly 0.0. Both are now computable here rather than discoverable later.

     `loSlope`/`hiSlope` — the standard distribution-free interval for the Theil–Sen slope: an
     order statistic of the sorted pairwise slopes, with C = z·sqrt(n(n−1)(2n+5)/18) the Kendall-S
     standard deviation (Sen PK 1968, J. Am. Stat. Assoc. 63:1379, doi:10.1080/01621459.1968.10480934;
     interval per Hollander & Wolfe, Nonparametric Statistical Methods §9.4). z = 1.96 → 95 %.

     `tieFrac` — the fraction of pairwise slopes lying EXACTLY on the median. Window lags are
     quantised (`bestK / fsHz`, an integer sample lag), so every pair drawn from one plateau
     contributes an identical slope. When those ties are the majority the median is not a location
     estimate at all, it is the plateau's value — which is precisely how "exactly 0.00 ppm" is
     manufactured on a night with no measurable trend. */
  var n = xs.length,
    N = slopes.length;
  var C = 1.96 * Math.sqrt((n * (n - 1) * (2 * n + 5)) / 18);
  // Sen's interval is expressed over the sorted PAIRWISE slopes, so the ranks are taken over N.
  var kLo = Math.max(0, Math.min(N - 1, Math.floor((N - C) / 2)));
  var kHi = Math.max(0, Math.min(N - 1, Math.ceil((N + C) / 2)));
  var ties = 0;
  for (var t = 0; t < N; t++) if (Math.abs(slopes[t] - m) <= 1e-12) ties++;
  return { slope: m, intercept: res[res.length >> 1], loSlope: slopes[kLo], hiSlope: slopes[kHi], nSlopes: N, tieFrac: ties / N };
}

/* Exact binomial upper tail P(X >= k | n, p). Small n here, so summing terms is
   both cheaper and more transparent than a normal approximation — and it does not
   quietly break at the tiny p0 values this test uses (tol/maxLag ~ 0.007). */
function _binomUpperTail(k, n, p0) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p0 <= 0) return 0;
  if (p0 >= 1) return 1;
  var lp = Math.log(p0),
    lq = Math.log(1 - p0),
    logC = 0,
    tail = 0;
  for (var i = 0; i <= n; i++) {
    if (i >= k) tail += Math.exp(logC + i * lp + (n - i) * lq);
    if (i < n) logC += Math.log(n - i) - Math.log(i + 1);
  }
  return Math.min(1, tail);
}

/* ALIGN TWO ENVELOPES: constant offset + clock drift, from windowed correlation.
   Degrades in one direction only — too few usable windows to fit a slope reports
   the OFFSET with `driftPpm: null`, never a slope through two points. */
function alignEnvelopes(a, b, fsHz, opts) {
  opts = opts || {};
  var winSec = opts.windowSec != null ? opts.windowSec : 600;
  var hopSec = opts.hopSec != null ? opts.hopSec : 300;
  var maxLagSec = opts.maxLagSec != null ? opts.maxLagSec : 30;
  var minR = opts.minR != null ? opts.minR : 0.2;
  var nullIters = opts.nullIters != null ? opts.nullIters : 20;
  var minWindows = opts.minWindows != null ? opts.minWindows : 4;
  /* A COUNT of surviving windows is not evidence — it is a multiple-comparisons
     trap. Each window's null admits ~1/(nullIters+1) of chance windows, so across
     143 windows about 7 survive by luck alone; the first version of this code
     called two UNRELATED nights `confident` on exactly that basis (4 of 47).
     A FRACTION threshold was the first repair and it was also wrong: on a real
     sleeping night most windows contain no movement at all, so all six box nights
     scored 6-20 % usable while agreeing to within 0.2 s — obviously measured, and
     rejected by an arbitrary cutoff.
     What actually separates signal from chance is CONCENTRATION, the same argument
     the pooled fit makes at corpus level. A chance lag is ~uniform across the
     +/-maxLag search, so the probability it lands within +/-tol of any particular
     value is tol/maxLag; k of n agreeing that closely has an exact binomial tail.
     Real: 8 of 8 within 0.1 s over a +/-30 s search — p ~ 1e-15. Chance: scattered. */
  var concTolSec = opts.concTolSec != null ? opts.concTolSec : Math.max(0.5, maxLagSec / 20);
  /** @type {any} — progressively filled; the literal initialiser would otherwise pin every field to
      `null` (or `windows` to `never[]`) and reject each later assignment. Same annotation, for the
      same reason, as `fitClockOffsetPooled`'s per-channel record below. */
  var out = {
    offsetSec: null,
    driftPpm: null,
    windows: [],
    nUsable: 0,
    nWindows: 0,
    nConcentrated: 0,
    concP: null,
    madSec: null,
    // §F7 — the drift term's own interval + why it was (or was not) published. See the fit block below.
    driftCiPpm: null,
    driftIdentifiable: false,
    driftTieFrac: null,
    driftReason: null,
    // §F7 — the spread MAD cannot report when the median sits on a tie block.
    lagSpreadSec: null,
    madDegenerate: false,
    medR: null,
    rmsResidSec: null,
    confident: false,
    underpowered: false,
    pFloor: null,
    reason: null
  };
  if (!(fsHz > 0) || !a || !b || a.length < 2 || b.length < 2) {
    out.reason = 'no data';
    return out;
  }
  /* The same 1/(N+1) floor the pooled fit publishes: a permutation p-value cannot
     go below it, so an under-shuffled run says it is underpowered rather than
     reporting a negative result it was never able to reach. Surrogate practice
     follows Louis S, Borgelt C, Gruen S (2010) Front. Comput. Neurosci. 4:127,
     doi:10.3389/fncom.2010.00127. */
  var pFloor = 1 / (nullIters + 1);
  out.pFloor = +pFloor.toFixed(4);
  out.underpowered = pFloor > 0.05;
  var W = Math.round(winSec * fsHz),
    H = Math.round(hopSec * fsHz),
    L = Math.round(maxLagSec * fsHz);
  var N = Math.min(a.length, b.length);
  if (W < 4 * L) {
    out.reason = 'window shorter than 4x the search range — the correlation cannot localise';
    return out;
  }
  var rnd = _seededRng((N * 2654435761) >>> 0);
  for (var s = 0; s + W <= N; s += H) {
    out.nWindows++;
    var av = a.subarray(s, s + W);
    var lo = Math.max(0, s - L);
    var bv = b.subarray(lo, Math.min(N, s + W + L));
    var off = s - lo;
    var bestR = -2,
      bestK = 0;
    for (var k = -L; k <= L; k++) {
      var c = _ncc(av, bv, off + k);
      if (c != null && c > bestR) {
        bestR = c;
        bestK = k;
      }
    }
    /* The window's OWN null. A quiet stretch of night correlates two noise floors
       and will happily report a lag; only a window that beats its own surrogate
       maximum is allowed to vote. */
    var nullBest = -2;
    /* The null is searched on a STRIDED lag grid. What is wanted is the chance
       MAXIMUM over the range, and that surface is smooth on the scale of the
       envelope's own autocorrelation, so ~40 samples estimate it within noise at
       1/15th the cost. Without this the function is O(nullIters x lags x window)
       per window and a six-hour night does not finish. The stride applies ONLY to
       the null — the real peak is searched at full resolution, because that one is
       the answer. */
    var stride = Math.max(1, Math.round((2 * L + 1) / 40));
    /* The null's windows are also DECIMATED. Fewer effective samples raise the
       chance-max slightly, which makes the null harder to beat — the conservative
       direction, and the only one acceptable in a significance test. Together with
       the lag stride this is what lets a six-hour night finish. */
    var nStep = Math.max(1, Math.round(W / 600));
    for (var it = 0; it < nullIters; it++) {
      var sh = 1 + ((rnd() * (bv.length - 2)) | 0);
      var rot = new Float64Array(bv.length);
      for (var q = 0; q < bv.length; q++) rot[q] = bv[(q + sh) % bv.length];
      for (var k2 = -L; k2 <= L; k2 += stride) {
        var c2 = _ncc(av, rot, off + k2, nStep);
        if (c2 != null && c2 > nullBest) nullBest = c2;
      }
    }
    var usable = bestR >= minR && bestR > nullBest;
    out.windows.push({ tSec: (s + W / 2) / fsHz, lagSec: bestK / fsHz, r: +bestR.toFixed(3), nullR: +nullBest.toFixed(3), usable: usable });
    if (usable) out.nUsable++;
  }
  var good = out.windows.filter(function (w) {
    return w.usable;
  });
  if (!good.length) {
    out.reason = 'no window beat its own null — the two streams share no detectable motion';
    return out;
  }
  var lags = good
    .map(function (w) {
      return w.lagSec;
    })
    .sort(function (p, q) {
      return p - q;
    });
  out.offsetSec = lags[lags.length >> 1];
  var rs = good
    .map(function (w) {
      return w.r;
    })
    .sort(function (p, q) {
      return p - q;
    });
  out.medR = rs[rs.length >> 1];
  var med = lags[lags.length >> 1];
  var dev = good
    .map(function (w) {
      return Math.abs(w.lagSec - med);
    })
    .sort(function (p, q) {
      return p - q;
    });
  out.madSec = +dev[dev.length >> 1].toFixed(3);
  /* ── MAD IS PRESENTED AS PRECISION AND ON A PLATEAU IT IS NOT (§F7) ────────────────────────────
     On 2026-07-26, 15 of 28 usable windows sat EXACTLY on the median, so MAD reported `0.00` while
     two windows sat 1.2 s away. That is the same quantisation that manufactures the drift atom: a
     majority tie makes the median deviation zero no matter what the rest of the distribution does.
     `madSec` is kept (it is what it is, and callers read it), but it never travels alone now —
     `lagSpreadSec` is the FULL half-range and cannot report agreement that is not there, and
     `madDegenerate` says outright that MAD is resting on a tie block. */
  out.lagSpreadSec = +dev[dev.length - 1].toFixed(3);
  out.madDegenerate = out.madSec === 0 && out.lagSpreadSec > 0;
  var conc = 0;
  for (var w2 = 0; w2 < good.length; w2++) if (Math.abs(good[w2].lagSec - med) <= concTolSec) conc++;
  out.nConcentrated = conc;
  /* One window is within tolerance of the median BY CONSTRUCTION — the median is
     one of them. Counting it would be scoring a tautology, so the test is run on
     the remaining n-1. Conservative, and it keeps the p-value meaning what it says. */
  out.concP = +_binomUpperTail(conc - 1, good.length - 1, Math.min(1, concTolSec / maxLagSec)).toExponential(2);
  if (good.length >= minWindows) {
    var ts = good.map(function (w) {
        return w.tSec;
      }),
      ls = good.map(function (w) {
        return w.lagSec;
      });
    var fit = _theilSen(ts, ls);
    if (fit) {
      var mid = (ts[0] + ts[ts.length - 1]) / 2;
      /* ── THE DRIFT TERM REFUSES UNLESS IT IS IDENTIFIABLE (WEARABLE-HOST-AXIS-FOLLOWUPS §F7) ──
         This slope was published unconditionally, and on this corpus it is not a measurement:
         three estimators over the SAME usable windows spanned 0 → 720 ppm (2026-07-29: Theil–Sen
         0.0, OLS −485.5, endpoint −720.4), 7 of 14 nights returned exactly 0.0, and −181.8 ppm
         shipped as MEASURED on 2026-07-17. A point estimate cannot say any of that about itself,
         so the interval is computed and the point estimate is gated on it.

         THE TEST IS THE INTERVAL, and only the interval: if the 95 % interval spans zero then
         neither the magnitude nor the DIRECTION of the drift is established, so there is nothing to
         publish. `driftCiPpm` is published either way, because the interval is the honest result
         even when the point estimate is not. This says "not identifiable", NOT "no drift" — an
         unidentifiable slope and a true zero are indistinguishable here, and conflating them is the
         error the whole guard exists to stop making.

         ⚠️ A TIE-FRACTION REFUSAL WAS TRIED HERE AND IS WRONG — recorded so it is not re-added.
         The reasoning was that a majority of pairwise slopes sitting exactly on the median means the
         median is a quantised plateau's tie value rather than a location estimate. It refuses the
         atom at 0.00 correctly, but it ALSO refuses a strong, correctly-measured ramp: at a planted
         900 ppm the interval is [833, 926] ppm — bracketing the truth — while tieFrac is 0.59,
         because evenly-spaced windows climbing one lag quantum at a time produce many pairs with
         identical Δt AND identical Δlag. A high tie fraction is the signature of a CLEAN quantised
         ramp at least as often as a flat one. It was caught by a surviving mutant: disabling the tie
         branch changed no test, because the interval had already refused every case that mattered.
         `tieFrac` survives as a published diagnostic and as the reason wording below — never as a
         refusal. */
      var loPpm = fit.loSlope * 1e6,
        hiPpm = fit.hiSlope * 1e6;
      out.driftCiPpm = [+loPpm.toFixed(2), +hiPpm.toFixed(2)];
      out.driftTieFrac = +fit.tieFrac.toFixed(3);
      var tied = fit.tieFrac >= 0.5;
      var spansZero = loPpm <= 0 && hiPpm >= 0;
      out.driftIdentifiable = !spansZero;
      if (out.driftIdentifiable) {
        // A lag growing by `slope` seconds per second IS the fractional frequency error.
        out.driftPpm = +(fit.slope * 1e6).toFixed(2);
        out.offsetSec = +(fit.intercept + fit.slope * mid).toFixed(3);
      } else {
        /* THE OFFSET FALLS BACK TO THE PLAIN MEDIAN LAG, and this is not defensive padding — it is
           worth 0.107 s on the sub-resolution case in the gate below (2.143 fitted vs 2.250 median).
           `intercept + slope·mid` evaluates a line whose slope was just declared unidentifiable, so
           it carries that slope's error into the one quantity this corpus finds trustworthy (offset
           median 0.20 s; |offset| > 1 s on 0 of 13 nights). On a ZERO-slope plateau the two agree
           exactly, which is why a test written only against that case cannot see this. */
        out.offsetSec = med;
        /* The wording states the tie VALUE rather than asserting it is zero. The zero plateau is the
           case the corpus kept hitting, but a tie block at a non-zero slope is reachable in principle
           and "tied at exactly zero" would then be a false sentence — the precise defect class this
           work-unit exists to remove. Naming the value is true by construction and needs no guard. */
        out.driftReason = tied
          ? 'drift NOT identifiable — ' +
            (100 * fit.tieFrac).toFixed(0) +
            '% of pairwise slopes are tied at ' +
            (fit.slope * 1e6).toFixed(2) +
            ' ppm, so the median is a quantised tie value rather than a located slope'
          : 'drift NOT identifiable — the 95% interval [' + out.driftCiPpm[0] + ', ' + out.driftCiPpm[1] + '] ppm spans zero, so not even its sign is established';
      }
      var sr = 0;
      for (var g = 0; g < ts.length; g++) {
        var e = ls[g] - (fit.intercept + fit.slope * ts[g]);
        sr += e * e;
      }
      out.rmsResidSec = +Math.sqrt(sr / ts.length).toFixed(3);
    }
  } else {
    out.reason = good.length + ' usable window(s) — too few to separate drift from offset, so offset only';
  }
  out.confident = !out.underpowered && out.nUsable >= minWindows && out.medR >= minR && out.concP <= 0.01;
  if (!out.confident && !out.underpowered) {
    if (out.nUsable < minWindows) out.reason = 'only ' + out.nUsable + ' window(s) beat their own null';
    else if (out.concP > 0.01)
      out.reason = 'the ' + out.nUsable + ' usable windows do not agree (' + conc + ' within ' + concTolSec.toFixed(1) + ' s, p=' + out.concP + ') — a real offset is ONE number';
    else if (!out.reason) out.reason = 'correlation below the floor';
  } else if (out.underpowered) out.reason = 'UNDERPOWERED — raise nullIters to >=19';
  return out;
}

/* DESATURATION ONSETS AS A TIMING FIDUCIAL, from the carried SpO2 series.

   OxyDex already detects desaturations and it is right not to use those here. `desat_event` is the
   CLINICAL definition — artifact-gated, thresholded to the ODI drop, ~7-15 events a night — because
   ODI has to be a defensible index. A timing measurement wants the opposite trade: many
   well-localised edges, shallower ones accepted, no artifact gate that removes a real fall for being
   small. Forcing one definition to serve both is how a node ends up exporting a number nobody can use
   for the other purpose, which is exactly why `timeseries.spo2` was added.

   Measured on the corpus, the apnea->desaturation transit resolved 3 nights of 39 off `desat_event`
   and 10 off a rule like this one. That rule lived in an analysis script — ungated, unswept, and
   quoting a 29 s median on its authority. This is that rule, made inspectable.

   ONSET, NOT NADIR (DESAT-ONSET-FIDUCIAL): the fall begins where the timing information is. The
   returned instant is the last sample BEFORE the descent, which is the fiducial an anchor should be
   compared against.

   HOLES BREAK THE WINDOW rather than being interpolated across. A dropout spanning a recovery would
   otherwise manufacture a fall from the pre-gap value to the post-gap one — a desaturation that never
   happened, at an instant that never happened. */
function desatOnsetsFromSeries(spo2, opts) {
  opts = opts || {};
  var dropPct = opts.dropPct != null ? opts.dropPct : 3;
  var winSec = opts.windowSec != null ? opts.windowSec : 30;
  var out = [];
  if (!spo2 || !Array.isArray(spo2.values) || spo2.t0Ms == null) return out;
  var hz = spo2.hz != null && isFinite(spo2.hz) && spo2.hz > 0 ? spo2.hz : 1;
  var v = spo2.values,
    W = Math.max(1, Math.round(winSec * hz));
  for (var i = 0; i + 1 < v.length; i++) {
    var a = v[i];
    if (a == null || !isFinite(a)) continue;
    var mn = a,
      mnAt = i,
      hole = false,
      lim = Math.min(v.length - 1, i + W);
    for (var j = i + 1; j <= lim; j++) {
      var b = v[j];
      if (b == null || !isFinite(b)) {
        hole = true;
        break;
      }
      if (b < mn) {
        mn = b;
        mnAt = j;
      }
    }
    if (hole) continue;
    if (a - mn >= dropPct) {
      /* WALK BACK TO THE TOP OF THE DESCENT. `i` is merely the first index whose forward window
         happens to reach the nadir, which can be a whole window EARLY — on the planted fixture it
         stamped 27 s before the fall began, i.e. a fiducial placed in flat signal. The onset is the
         last sample before the decline, so retreat from the nadir while the series is strictly
         falling and stop at the first non-decrease. Strict `>` is deliberate: `>=` would walk back
         through the flat pre-fall plateau to the start of the recording. */
      var on = mnAt;
      while (on > 0 && v[on - 1] != null && isFinite(v[on - 1]) && v[on - 1] > v[on]) on--;
      // `on` IS the last sample before the descent — v[on] still sits at the pre-fall level and
      // v[on+1] is the first lower one. Subtracting a further sample would step into flat signal.
      out.push(spo2.t0Ms + (on * 1000) / hz);
      /* Resume PAST the nadir, not one sample on. Every index inside a long fall satisfies the drop
         test, so scanning through one desaturation would emit it dozens of times and hand a
         correlation a burst that looks like dozens of independent coincidences. */
      i = mnAt;
    }
  }
  return out;
}

/* ── DRIFT-AWARE BEAT ALIGNMENT (WEARABLE-DRIFT-FIT) ────────────────────────────────────────────
   Two body-worn devices agree on ~90 % of heartbeats — and a CONSTANT-offset fit reports 16 %,
   because they do not share a timebase across a night. Measured on 2026-07-26:

     median local correspondence, 5-min blocks   90.6 %   (chance control, +1 h: 21.3 %)
     linear drift                                5.2 ms/min = 87 ppm  →  2,264 ms over 435 min

   Two seconds exceeds an RR interval, so one offset walks off the correct beat partway through the
   night and every later beat is matched to the wrong one. Fitting ONE number to a pair that needs TWO
   is what produced the retracted "beat trains cannot align these devices" conclusion.

   So: fit the offset LOCALLY in short blocks, then regress block offset against block time — the same
   shape `alignEnvelopes` uses for accelerometer envelopes, applied to beat times, which are already
   in the node-export (`timeseries.rr.tSec` / `timeseries.ppi.tSec`) and need no contract change.

   PURE: numbers in, numbers out. `chanceCorrespondence` runs the identical search on a deliberately
   wrong alignment, because the block fit maximises the very statistic it reports — without that
   control a flat, meaningless sweep still returns a confident-looking best block. */
/* CPAP CLOCK — STEP-AWARE LONGITUDINAL OFFSET MODEL (CPAP-CLOCK-LONGITUDINAL-SEGMENT-2026-08-21).
   The per-fusion path measures a night's CPAP offset when a co-recorded reference exists; this fills the
   OTHER nights (CPAP-only) by fitting the drift WITHIN step-bounded segments, and REFUSES across steps
   and on extrapolation rather than smearing one offset over the corpus (the CPAP clock drifts AND steps
   on travel — #1606). Pure + deterministic (no Date.now); the fit never overrides a real measurement.

   nightOffsets: [{ dateMs, offsetSec, confident }]  (unanchored nights carry offsetSec:null)
   → { nights:[{ dateMs, offsetSec, source:'measured'|'interpolated'|'refused', reason? }], segments:[…] } */
var CLK_SEG = {
  STEP_ABS_SEC: 600, // a >10 min jump between adjacent anchors is a step (travel), not crystal drift
  STEP_PPM_MAX: 200, // …or an implied rate over 200 ppm between anchors — beyond any crystal
  FIT_RES_SEC: 90, // a usable segment fit leaves ≤90 s RMS residual
  FIT_PPM_MAX: 200 // …and a plausible crystal rate (|ppm| ≤ 200); else the segment is refused wholesale
};
function fitClockOffsetSegments(nightOffsets, opts) {
  opts = opts || {};
  var C = {
    STEP_ABS_SEC: opts.stepAbsSec != null ? opts.stepAbsSec : CLK_SEG.STEP_ABS_SEC,
    STEP_PPM_MAX: opts.stepPpmMax != null ? opts.stepPpmMax : CLK_SEG.STEP_PPM_MAX,
    FIT_RES_SEC: opts.fitResSec != null ? opts.fitResSec : CLK_SEG.FIT_RES_SEC,
    FIT_PPM_MAX: opts.fitPpmMax != null ? opts.fitPpmMax : CLK_SEG.FIT_PPM_MAX
  };
  var nights = (nightOffsets || [])
    .filter(function (n) {
      return n && isFinite(n.dateMs);
    })
    .slice()
    .sort(function (x, y) {
      return x.dateMs - y.dateMs;
    });
  var anchors = nights.filter(function (n) {
    return n.confident && n.offsetSec != null && isFinite(n.offsetSec);
  });
  /** @type {{nights:any[], segments:any[]}} */
  var out = { nights: [], segments: [] };
  if (!anchors.length) {
    out.nights = nights.map(function (n) {
      return { dateMs: n.dateMs, offsetSec: null, source: 'refused', reason: 'no confident anchor in the corpus' };
    });
    return out;
  }
  // segment the anchors at steps
  var PPM = function (dSec, dMs) {
    return dMs > 0 ? (dSec * 1000 * 1e6) / dMs : Infinity;
  };
  var segs = [];
  var cur = [anchors[0]];
  for (var i = 1; i < anchors.length; i++) {
    var a = anchors[i - 1],
      b = anchors[i];
    var dSec = b.offsetSec - a.offsetSec,
      dMs = b.dateMs - a.dateMs;
    var isStep = Math.abs(dSec) >= C.STEP_ABS_SEC || Math.abs(PPM(dSec, dMs)) > C.STEP_PPM_MAX;
    if (isStep) {
      segs.push(cur);
      cur = [b];
    } else cur.push(b);
  }
  segs.push(cur);
  // fit each segment (least squares offsetSec vs dateMs), validate
  /** @type {{lo:number,hi:number,anchors:number,slope?:number,intercept?:number,resRmsSec?:number,ppm?:number,ok:boolean,reason:(string|null)}[]} */
  var fitted = segs.map(function (s) {
    var lo = s[0].dateMs,
      hi = s[s.length - 1].dateMs;
    if (s.length < 2) return { lo: lo, hi: hi, anchors: s.length, ok: false, reason: 'single-anchor segment (drift not fittable)' };
    var n = s.length,
      mx = 0,
      my = 0;
    for (var j = 0; j < n; j++) {
      mx += s[j].dateMs;
      my += s[j].offsetSec;
    }
    mx /= n;
    my /= n;
    var sxx = 0,
      sxy = 0;
    for (j = 0; j < n; j++) {
      var dx = s[j].dateMs - mx;
      sxx += dx * dx;
      sxy += dx * (s[j].offsetSec - my);
    }
    var slope = sxx > 0 ? sxy / sxx : 0,
      icept = my - slope * mx;
    var ss = 0;
    for (j = 0; j < n; j++) {
      var e = s[j].offsetSec - (icept + slope * s[j].dateMs);
      ss += e * e;
    }
    var resRms = Math.sqrt(ss / n);
    var ppm = slope * 1e6; // slope is sec/ms → ×1e6 = ppm
    var ok = resRms <= C.FIT_RES_SEC && Math.abs(ppm) <= C.FIT_PPM_MAX;
    return {
      lo: lo,
      hi: hi,
      anchors: n,
      slope: slope,
      intercept: icept,
      resRmsSec: Math.round(resRms * 100) / 100,
      ppm: Math.round(ppm * 100) / 100,
      ok: ok,
      reason: ok ? null : resRms > C.FIT_RES_SEC ? 'segment fit residual too large (' + resRms.toFixed(0) + ' s)' : 'implied rate implausible (' + ppm.toFixed(0) + ' ppm)'
    };
  });
  out.segments = fitted;
  var segFor = function (ms) {
    for (var k = 0; k < segs.length; k++) if (ms >= fitted[k].lo && ms <= fitted[k].hi) return fitted[k];
    return null;
  };
  var anchorAt = {};
  anchors.forEach(function (an) {
    anchorAt[an.dateMs] = an.offsetSec;
  });
  out.nights = nights.map(function (nn) {
    if (Object.prototype.hasOwnProperty.call(anchorAt, nn.dateMs)) {
      return { dateMs: nn.dateMs, offsetSec: anchorAt[nn.dateMs], source: 'measured', reason: null };
    }
    var sg = segFor(nn.dateMs); // only matches INSIDE a segment's anchor span (no extrapolation)
    if (!sg) return { dateMs: nn.dateMs, offsetSec: null, source: 'refused', reason: 'outside all fitted segments (extrapolation refused)' };
    if (!sg.ok || sg.intercept == null || sg.slope == null) return { dateMs: nn.dateMs, offsetSec: null, source: 'refused', reason: sg.reason };
    var off = sg.intercept + sg.slope * nn.dateMs;
    return { dateMs: nn.dateMs, offsetSec: Math.round(off * 100) / 100, source: 'interpolated', reason: null };
  });
  return out;
}

function fitClockDrift(aTimes, bTimes, opts) {
  opts = opts || {};
  var blockMs = opts.blockMs != null ? opts.blockMs : 300000;
  var searchMs = opts.searchMs != null ? opts.searchMs : 3000;
  var stepMs = opts.stepMs != null ? opts.stepMs : 20;
  var tolMs = opts.tolMs != null ? opts.tolMs : 80;
  var minBeats = opts.minBeats != null ? opts.minBeats : 30;
  var minBlocks = opts.minBlocks != null ? opts.minBlocks : 5;
  var A = (aTimes || [])
    .filter(function (t) {
      return t != null && isFinite(t);
    })
    .sort(function (x, y) {
      return x - y;
    });
  var B = (bTimes || [])
    .filter(function (t) {
      return t != null && isFinite(t);
    })
    .sort(function (x, y) {
      return x - y;
    });
  if (A.length < minBeats * 2 || B.length < minBeats * 2) return { offsetMs: null, driftPpm: null, confident: false, reason: 'too few beats' };

  /* Correspondence of one block at one offset: fraction of A-beats whose nearest B-beat sits within
     tolMs of the block's OWN median delta. Centring on the median rather than zero is what makes this
     measure agreement instead of the acceptance window's width. */
  function corrAt(bA, off) {
    if (bA.length < minBeats) return null;
    var dl = [];
    for (var i = 0; i < bA.length; i++) {
      var x = bA[i] + off,
        bd = null;
      var lo = 0,
        hi = B.length - 1;
      while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (B[mid] < x) lo = mid + 1;
        else hi = mid;
      }
      for (var k = Math.max(0, lo - 2); k < Math.min(B.length, lo + 2); k++) {
        var q = B[k] - x;
        if (bd == null || Math.abs(q) < Math.abs(bd)) bd = q;
      }
      if (bd != null) dl.push(bd);
    }
    if (dl.length < minBeats) return null;
    dl.sort(function (x2, y2) {
      return x2 - y2;
    });
    var med = dl[Math.floor(dl.length / 2)];
    var hit = 0;
    for (var j = 0; j < dl.length; j++) if (Math.abs(dl[j] - med) <= tolMs) hit++;
    return { frac: hit / bA.length, med: med, iqr: dl[Math.floor(dl.length * 0.75)] - dl[Math.floor(dl.length * 0.25)] };
  }

  function runBlocks(bias) {
    var rows = [];
    for (var s = A[0]; s + blockMs < A[A.length - 1]; s += blockMs) {
      var bA = [];
      for (var i = 0; i < A.length; i++) if (A[i] >= s && A[i] < s + blockMs) bA.push(A[i]);
      /* SUPPORT CENTROID, not argmax. Correspondence is FLAT over a plateau roughly `tolMs` wide —
         every offset inside it keeps the same beats matched — so the argmax lands arbitrarily within
         it and a planted control shows the resulting bias (measured: ~330 ms on a 20 ms grid).
         Averaging the offsets that share the peak takes the plateau's centre instead. Same fix
         POOLED-CLOCK-FIT applied after its own planted-offset control caught a 37 s argmax bias. */
      var peak = -1,
        acc = 0,
        accN = 0,
        pIqr = null;
      for (var o = bias - searchMs; o <= bias + searchMs; o += stepMs) {
        var r = corrAt(bA, o);
        if (!r) continue;
        if (r.frac > peak + 1e-9) {
          peak = r.frac;
          acc = o;
          accN = 1;
          pIqr = r.iqr;
        } else if (Math.abs(r.frac - peak) <= 1e-9) {
          acc += o;
          accN++;
        }
      }
      /* The offset is fitted from the block's beats, so it describes the block's MIDPOINT, not its
         start — regressing it against the start would tilt the drift by half a block. */
      if (accN > 0) rows.push({ tMs: s + blockMs / 2, off: acc / accN, frac: peak, iqr: pIqr });
    }
    return rows;
  }

  var rows = runBlocks(0);
  if (rows.length < minBlocks) return { offsetMs: null, driftPpm: null, confident: false, reason: 'too few usable blocks', blocks: rows.length };
  /* NOT UNWRAPPED — a KNOWN LIMITATION, measured rather than assumed.
     CROSS-DEVICE-DRIFT-AND-CLOSURE §2.2 showed the per-block offset is a PHASE: two periodic beat
     trains give a coincidence comb one RR apart, so as the true offset drifts past a tooth the argmax
     falls back exactly one RR and the raw series saws. Confirmed here — 3 jumps of one-to-two RR
     across 87 blocks on 2026-07-27, where the drift reads 45.9 ppm unwrapped-not and 97.2 unwrapped.

     A naive per-pair unwrap was implemented and MEASURED TO BE WORSE: greedily stepping each block by
     whole RRs to minimise its jump degraded three-source closure from 101/101/58 ppm to
     -266/209/-202. A single wrong multiple on a weakly-locking pair propagates through the cumulative
     sum forever. That is §2.3's point — where a pair locks poorly the phase is undersampled and the
     unwrap picks the wrong tooth — and §5's open item: the unwrap must use the closure constraint
     across all three pairs JOINTLY, which is over-determined and can reject a bad multiple.

     So this returns a drift that may carry sawtooth, and `unwrapSteps` is NOT reported because no
     unwrap is performed. Per that brief's §6 guardrail, a ppm figure from this function is not
     evidence unless a closure residual is quoted beside it. */
  var fr = rows
    .map(function (r) {
      return r.frac;
    })
    .sort(function (x, y) {
      return x - y;
    });
  var medFrac = fr[Math.floor(fr.length / 2)];
  // CHANCE CONTROL — identical search on a deliberately wrong alignment.
  var ctlRows = runBlocks(opts.controlMs != null ? opts.controlMs : 3600000);
  var cf = ctlRows
    .map(function (r) {
      return r.frac;
    })
    .sort(function (x, y) {
      return x - y;
    });
  var chance = cf.length ? cf[Math.floor(cf.length / 2)] : null;

  // Linear regression of block offset on block time → offset at t0 + drift.
  var n = rows.length,
    mx = 0,
    my = 0;
  for (var i2 = 0; i2 < n; i2++) {
    mx += rows[i2].tMs;
    my += rows[i2].off;
  }
  mx /= n;
  my /= n;
  var num = 0,
    den = 0;
  for (var i3 = 0; i3 < n; i3++) {
    num += (rows[i3].tMs - mx) * (rows[i3].off - my);
    den += (rows[i3].tMs - mx) * (rows[i3].tMs - mx);
  }
  var slope = den ? num / den : 0; // ms of offset per ms of elapsed time
  /* `pIqr` starts null, so a block that scored no offset can carry one through. Collected with an
     explicit loop rather than map/filter/sort: a null reaching the comparator silently reorders the
     median, and the filter does not narrow the type for the checker either. */
  /** @type {number[]} */
  /* The wrapped-residual fit (see _wrappedSlopeFit) — reported BESIDE the raw regression rather than
     replacing it, so the two can be compared on real data and the raw one stays available for the
     nights where the phase is undersampled and wrapping buys nothing. */
  var _d2 = [];
  for (var u2 = 1; u2 < A.length; u2++) {
    var dd2 = A[u2] - A[u2 - 1];
    if (dd2 > 200 && dd2 < 3000) _d2.push(dd2);
  }
  _d2.sort(function (x, y) {
    return x - y;
  });
  var _rrMs = _d2.length ? _d2[Math.floor(_d2.length / 2)] : null;
  var _wrapped = _rrMs ? _wrappedSlopeFit(rows, _rrMs, opts) : null;

  var iq = [];
  for (var i4 = 0; i4 < rows.length; i4++) {
    var iv = rows[i4].iqr;
    if (iv != null && isFinite(iv)) iq.push(iv);
  }
  iq.sort(function (x, y) {
    return x - y;
  });
  return {
    /* THE SERIES THE FIT WAS MADE FROM, which was being discarded. `off` at `tMs` is a PHASE series —
       the only input from which this leg's own rate uncertainty can be measured. Without it a consumer
       can see the slope but not how far to trust it, which is precisely what left `fitClockClosure`
       with a tolerance guessed from magnitude (`0.25 * maxleg`) rather than derived from precision.
       Measured: closure error is UNCORRELATED with leg magnitude (r = -0.24 over the corpus), so the
       proportional model has no support; and naive OLS on these blocks underestimates the observed
       closure noise 10x, because consecutive block offsets share the same wander and OLS assumes
       independent residuals. A correlation-safe uncertainty needs the series, not a summary of it. */
    blocks_: rows.map(function (b) {
      return { tMs: b.tMs, off: b.off };
    }),
    offsetMs: my + slope * (A[0] - mx),
    driftPpm: slope * 1e6,
    medianCorrespondence: medFrac,
    chanceCorrespondence: chance,
    medianIqrMs: iq.length ? iq[Math.floor(iq.length / 2)] : null,
    blocks: n,
    rrMs: _rrMs,
    /* PHASE-AWARE alternative to `driftPpm`: same blocks, scored modulo one RR so a whole-RR argmax
       fallback costs nothing. `wrappedConcentration` near 1 means every block agrees on the phase;
       low values are the undersampled case where the number is not a measurement. */
    wrappedDriftPpm: _wrapped ? _wrapped.driftPpm : null,
    wrappedConcentration: _wrapped ? _wrapped.concentration : null,
    wrappedResidRmsMs: _wrapped ? _wrapped.residRmsMs : null,
    spanMin: Math.round((A[A.length - 1] - A[0]) / 60000),
    /* The search window BOUNDS what drift can be seen: a pair drifting faster than this walks out of
       range mid-night and the regression flattens toward zero (measured: a planted 250 ppm reads 49).
       Published so a caller can tell "no drift" from "drift beyond my reach" — the distinction a bare
       number hides. */
    maxDriftPpm: A[A.length - 1] > A[0] ? (searchMs / (A[A.length - 1] - A[0])) * 1e6 : null,
    /* Correspondence must beat its OWN chance control by a clear margin — the block fit maximises the
       statistic it reports, so "high" alone means nothing. 2x is deliberately conservative: the
       measured pair sits at 90.6 % vs 21.3 %, a 4.3x margin. */
    confident: chance != null && medFrac >= 2 * chance && medFrac >= 0.5,
    reason: chance == null ? 'no control blocks' : medFrac < 2 * chance ? 'correspondence does not clear its own chance control' : null,
    perBlock: rows
  };
}

/* ── CLOSURE TEST over three or more beat sources (WEARABLE-DRIFT-FIT-FOLLOWUPS) ─────────────────
   For any three clocks the pairwise drifts must sum to zero identically:

       d(A,B) + d(B,C) + d(C,A) ≡ 0        because (dA−dB)+(dB−dC)+(dC−dA) = 0

   So a non-zero CLOSURE ERROR proves at least one pairwise fit is wrong — **with no reference clock
   and no ground truth**, which is precisely what a pairwise fit cannot do for itself. On the real
   2026-07-26 trio it reads 100.9 ppm against an identity of 0, and independently condemns the two
   O2Ring legs that a correspondence check also flags (47 % / 49 % against a ~20 % chance floor).

   THE BLIND SPOT, found by a planted control that REFUSED to fire. Closure tests the MEASUREMENTS,
   never the clocks. A device whose clock is genuinely wrong — stepped mid-night by a re-sync, say —
   is measured FAITHFULLY by both of its pairs, and the error cancels: the identity holds for any dC
   whatsoever. A planted 900 ms step left closure at −0.10 ppm. So closure catches a BAD FIT and is
   structurally incapable of catching a bad clock that both pairs agree about; only degrading a
   source until its fits became unreliable made it fire (−50.6 ppm, both weak legs named).

   It is a CONSISTENCY test, not an attribution: with three clocks a closure violation says "one of
   these MEASUREMENTS is wrong" and cannot say which. Pair it with each leg's own `confident` flag — the leg
   that fails both is the suspect. Attempting more (a three-cornered-hat variance decomposition) on
   legs this weak returns a NEGATIVE variance and a reconstruction that disagrees with its own input;
   that was tried and is not shipped. */
/* ── WRAPPED-RESIDUAL SLOPE FIT — the unwrap that cannot propagate ───────────────────────────────
   The per-block offset is a PHASE on a comb one RR wide (CROSS-DEVICE-DRIFT-AND-CLOSURE §2.2), so a
   raw slope measures the sawtooth. The obvious repair — walk the series and step each block by whole
   RRs to minimise its jump — was implemented and MEASURED TO BE WORSE: three-source closure went from
   101/101/58 ppm to −266/209/−202, because a single wrong multiple on a weakly-locking pair rides the
   cumulative sum for the rest of the night.

   The defect is sequential accumulation, so remove it. Do not unwrap at all: grid-search the SLOPE and
   score each candidate by its residuals taken MODULO one RR. A whole-RR fallback then costs nothing —
   it wraps to the same residual — while a wrong slope misaligns every block at once. No step can
   propagate because no step is ever taken.

   MEASURED, AND IT DOES NOT YET WORK ON THIS CORPUS — shipped as a DIAGNOSTIC, not as the answer.
   `concentration` is the falsifier: 1 means every block agrees on the phase, and on real nights it
   reads 0.15-0.59. Wrapped residuals that near-uniform have nothing to lock onto, so the wrapped slope
   is no better than the raw one (three-source closure across a 3x3 sweep of blockMs x tolMs came out
   77, -164, -44, -10, 268, 0, 70, -142, -451 ppm — one value lands on zero, and picking it from nine
   tries scattered +-450 would be cherry-picking). Concentration rises with block length (0.29 at 5 min
   to 0.59 at 15 min) exactly as more beats per block predicts, which locates the blocker: it is the
   PRECISION OF THE PER-BLOCK OFFSET relative to one RR, not the unwrap algorithm. Until a block offset
   is good to well under an RR, no unwrap — sequential or phase-regressed — has a signal to unwrap.

   So `driftPpm` remains the raw regression and `wrappedDriftPpm` rides beside it with its own
   concentration, so a caller can see both and trust neither without a closure residual.

   This is ordinary phase regression, and it leaves CLOSURE INTACT AS A FREE CHECK: each pair is fitted
   independently, so d(A,B)+d(B,C)+d(C,A) is still an over-determined constraint that the fit never
   used and therefore cannot have fabricated. (Enforcing closure inside the fit would make it exact by
   construction and destroy it as evidence — the reason the joint solve below is reported SEPARATELY.) */
function _wrappedSlopeFit(rows, rrMs, opts) {
  opts = opts || {};
  if (!rows || rows.length < 4 || !(rrMs > 0)) return null;
  var t0 = rows[0].tMs;
  var maxPpm = opts.maxSlopePpm != null ? opts.maxSlopePpm : 400;
  var stepPpm = opts.slopeStepPpm != null ? opts.slopeStepPpm : 0.5;
  var wrap = function (v) {
    var w = v - rrMs * Math.round(v / rrMs);
    return w;
  };
  var best = null;
  for (var ppm = -maxPpm; ppm <= maxPpm; ppm += stepPpm) {
    var sl = ppm / 1e6; // ms of offset per ms of elapsed time
    /* The intercept is itself only known modulo RR, so it must be fitted too — solved as a circular
       mean of the wrapped residuals rather than a second grid, which keeps this O(slopes × blocks). */
    var sx = 0,
      sy = 0;
    for (var i = 0; i < rows.length; i++) {
      var ang = (2 * Math.PI * (rows[i].off - sl * (rows[i].tMs - t0))) / rrMs;
      sx += Math.cos(ang);
      sy += Math.sin(ang);
    }
    var phase = (Math.atan2(sy, sx) / (2 * Math.PI)) * rrMs;
    var cost = 0;
    for (var j = 0; j < rows.length; j++) {
      var r = wrap(rows[j].off - sl * (rows[j].tMs - t0) - phase);
      cost += r * r;
    }
    /* Concentration of the wrapped residuals — 1 = every block agrees, 0 = uniform around the circle.
       Reported because a low-concentration "best" slope is the undersampled-phase case §2.3 warns
       about, where the answer is a broken unwrap wearing ppm units. */
    var R = Math.sqrt(sx * sx + sy * sy) / rows.length;
    if (!best || cost < best.cost) best = { ppm: ppm, cost: cost, phaseMs: phase, concentration: R };
  }
  if (!best) return null;
  var rms = Math.sqrt(best.cost / rows.length);
  return { driftPpm: best.ppm, offsetMs: best.phaseMs, residRmsMs: rms, concentration: best.concentration, blocks: rows.length };
}

/* ── CROSS-NODE HR AGREEMENT (2026-08-13) ────────────────────────────────────────────────────────
   THE CHECK THIS SUITE DID NOT HAVE, AND THE TWO BUGS THAT PROVED IT WAS MISSING. On 2026-08-13
   `ppgdex-dsp.js` was found to (a) resolve the WRONG OPTICAL POLARITY on 10 of 20 real nights and
   (b) LOCK `correctRR` to a stale reference and emit a constant interval series for 25 minutes at a
   time. Both shipped past five green PpgDex fixtures, and neither was findable inside the node: a
   polarity flip is COMMON-MODE across all three LEDs, and a locked reference is SELF-CONSISTENT.
   What found them was comparing PpgDex against the simultaneous ECG and the ring — which is this
   layer's whole reason to exist, and which nothing was doing.

   THE RULE IS THE ONE GNSS INTEGRITY MONITORING (RAIM) STATES: redundancy DETECTS a fault, but
   ISOLATING which source is at fault needs one more source than detecting it. Two sources that
   disagree name a PAIR, never a culprit — an error made by hand during that investigation and
   corrected only by bringing in the third sensor. So:

       2 sources → `detected` may be true, `adjudicated` is FALSE and `outlier` is null
       3+        → the outlier is the source furthest from the MEDIAN, and it is named

   Alignment is on ABSOLUTE time, never on an epoch index: each node carries its own
   `startEpochMs` and they differ by up to 24 minutes on this corpus, so comparing `tMin` across
   nodes compares different moments (also made by hand, also corrected). A source with no epoch
   inside `tolMs` of the reference instant does not vote — it is absent, not agreeing.

   Consistent with this file's existing stance on disagreement: it publishes every source and the
   spread and says plainly when they disagree. It does NOT average, and it does NOT repair a node. */
var HR_AGREE_TOL_BPM = 15; // a disagreement worth naming; sleep HR moves far less than this between sensors
var HR_AGREE_ALIGN_MS = 150000; // ±2.5 min — half a 5-minute epoch, so an epoch matches at most one
/* A TRUNCATED EPOCH IS NOT A MEASUREMENT, and every node emits them without saying so. At a recording
   boundary the last (or first) 5-minute epoch may hold seconds of data, yet it carries an `hr` that
   looks exactly like a full one — normal rmssd, normal sdnn, nothing marking it. Measured on this
   corpus: 15 of 2275 epochs hold under a quarter of their own night's median beat count, and ALL
   FIFTEEN are ECGDex, so this is a systematic edge effect rather than chance. The worst reports
   122.4 bpm from 24 beats where its neighbours hold 261-287 and read 56 — a strap coming off, scored
   as tachycardia.
   Such an epoch is DROPPED from the comparison rather than flagged: it is a fragment, and a
   disagreement with a fragment says nothing about either sensor. `beats` is already on every epoch,
   so this needs no new emitter field — only for someone to read it. */
var HR_AGREE_MIN_BEAT_FRAC = 0.25; // of that source's own median epoch beat count

function hrAgreement(sources, opts) {
  opts = opts || {};
  var tol = opts.tolBpm != null ? opts.tolBpm : HR_AGREE_TOL_BPM;
  var alignMs = opts.alignMs != null ? opts.alignMs : HR_AGREE_ALIGN_MS;
  var src = (sources || []).filter(function (s) {
    return s && s.node && s.epochs && s.epochs.length;
  });
  if (src.length < 2) return { ok: false, reason: 'need >=2 sources with epochs', sources: src.length };

  // index each source by absolute instant, dropping fragments (see HR_AGREE_MIN_BEAT_FRAC)
  var minFrac = opts.minBeatFrac != null ? opts.minBeatFrac : HR_AGREE_MIN_BEAT_FRAC;
  var dropped = 0;
  var idx = src.map(function (s) {
    var all = [];
    for (var i = 0; i < s.epochs.length; i++) {
      var e = s.epochs[i];
      if (e && isFinite(e.tMs) && isFinite(e.hr)) all.push({ t: e.tMs, hr: e.hr, beats: isFinite(e.beats) ? e.beats : null });
    }
    // Median beat count of THIS source — the yardstick has to be per-node, since the three sensors
    // have different pulse counts per epoch and a shared constant would mis-scale two of them.
    var bs = all
      .map(function (x) {
        return x.beats;
      })
      .filter(function (v) {
        return v != null && v > 0;
      })
      .sort(function (a, b) {
        return a - b;
      });
    var medB = bs.length ? bs[bs.length >> 1] : null;
    var m = all.filter(function (x) {
      if (medB == null || x.beats == null) return true; // no beat count ⇒ cannot judge ⇒ keep
      var ok = x.beats >= minFrac * medB;
      if (!ok) dropped++;
      return ok;
    });
    m.sort(function (a, b) {
      return a.t - b.t;
    });
    return { node: s.node, pts: m };
  });
  var near = function (pts, t) {
    var best = null;
    for (var i = 0; i < pts.length; i++) {
      var d = Math.abs(pts[i].t - t);
      if (d <= alignMs && (best === null || d < Math.abs(pts[best].t - t))) best = i;
    }
    return best === null ? null : pts[best];
  };

  var epochs = [],
    fault = {},
    compared = 0,
    flagged = 0,
    adjudicable = 0;
  for (var k = 0; k < idx.length; k++) fault[idx[k].node] = 0;

  /* THE TIMELINE IS THE UNION, NOT THE FIRST SOURCE'S. Using sources[0] as the reference makes the
     result depend on ARGUMENT ORDER: every instant the first source lacks is never compared, so if
     PpgDex stops early (trio passes it first) every later ECG/ring disagreement is invisible. Caught
     by testing the function against its own argument order rather than by reading it.
     Anchors are spaced at least `alignMs` apart so each real epoch is compared exactly once — without
     that, three sources a minute apart would raise three near-duplicate comparisons of one moment. */
  var anchors = [];
  for (var u = 0; u < idx.length; u++) {
    for (var v = 0; v < idx[u].pts.length; v++) anchors.push(idx[u].pts[v].t);
  }
  anchors.sort(function (a, b) {
    return a - b;
  });
  var picked = [];
  for (var w = 0; w < anchors.length; w++) {
    if (!picked.length || anchors[w] - picked[picked.length - 1] > alignMs) picked.push(anchors[w]);
  }

  for (var p = 0; p < picked.length; p++) {
    var t = picked[p];
    var vals = [];
    for (var q = 0; q < idx.length; q++) {
      var hit = near(idx[q].pts, t);
      if (hit) vals.push({ node: idx[q].node, hr: hit.hr });
    }
    if (vals.length < 2) continue;
    compared++;
    var hrs = vals
      .map(function (v) {
        return v.hr;
      })
      .slice()
      .sort(function (a, b) {
        return a - b;
      });
    var med = hrs.length % 2 ? hrs[(hrs.length - 1) / 2] : (hrs[hrs.length / 2 - 1] + hrs[hrs.length / 2]) / 2;
    var spread = hrs[hrs.length - 1] - hrs[0];
    /* DETECTION CRITERION DIFFERS BY SOURCE COUNT, and getting this wrong silently halves the
       sensitivity. With TWO sources the median is their midpoint, so each sits spread/2 from it and a
       26 bpm disagreement reads as 13 — under any sane tolerance. A pair is detected on its SPREAD.
       With three or more the median is a real consensus and distance-from-it is the right measure. */
    var out =
      vals.length === 2
        ? spread > tol
          ? vals.slice()
          : []
        : vals.filter(function (v) {
            return Math.abs(v.hr - med) > tol;
          });
    if (vals.length >= 3) adjudicable++;
    if (!out.length) continue;
    flagged++;
    /* WITH ONLY TWO SOURCES THE OUTLIER IS NOT KNOWABLE. Both sit `spread/2` from their own median,
       so "furthest from the median" is a coin toss dressed as an answer. Report the disagreement and
       decline to name anyone — that is the RAIM detect-vs-exclude boundary. */
    var adjudicated = vals.length >= 3;
    var culprit = null;
    if (adjudicated) {
      culprit = out[0].node;
      for (var r = 1; r < out.length; r++) if (Math.abs(out[r].hr - med) > Math.abs(out[0].hr - med)) culprit = out[r].node;
      fault[culprit]++;
    }
    epochs.push({
      tMs: t,
      sources: vals,
      median: med,
      spreadBpm: Math.round(spread * 10) / 10,
      adjudicated: adjudicated,
      outlier: culprit
    });
  }
  return {
    ok: true,
    tolBpm: tol,
    nodes: idx.map(function (s) {
      return s.node;
    }),
    compared: compared,
    adjudicable: adjudicable,
    droppedFragments: dropped,
    flagged: flagged,
    flaggedPct: compared ? Math.round((1000 * flagged) / compared) / 10 : 0,
    fault: fault,
    /* WHAT A FAULT COUNT DOES NOT SAY. `fault` attributes disagreements to a node; it cannot say
       whether that node's detector is intrinsically noisy or was fine and met a real event. Where a
       source shipped its own detector-stability curve (PpgDex `validation.stability` — see
       `readDetectorStability`), it is carried through here UNCHANGED, keyed by node, so a reader
       weighing an attribution has the one fact that settles it. Deliberately not folded INTO `fault`:
       a stability slope is evidence about a detector, an epoch disagreement is evidence about a
       moment, and silently blending the two would produce a number that answers neither question.
       Empty object when no source carried one — never a fabricated default. */
    stability: (function () {
      var out = {};
      for (var i = 0; i < src.length; i++) {
        var st = src[i].stability || readDetectorStability(src[i].export || src[i]);
        if (st && isFinite(st.slope)) out[src[i].node] = st;
      }
      return out;
    })(),
    epochs: epochs
  };
}

/* ── ARRIVAL-DERIVED INTER-DEVICE OFFSET (2026-08-13) ────────────────────────────────────────────
   The capture box writes a per-packet sidecar carrying the HOST arrival stamp beside the DEVICE
   counter. Two devices stamped by one host are therefore measurable against each other DIRECTLY —
   no beat matching, which is the method that can only ever pin an offset modulo one heartbeat.

   THIS PUBLISHES THE MEASUREMENT; IT DOES NOT APPLY IT. Measured on 2026-08-12, PAT's in-window yield
   goes 69 % -> 99 % once an offset is applied — and then SATURATES at 99.2 % from +50 ms all the way
   to +316 ms. So the gate cannot tell which offset is right: choosing one by maximising yield is
   selecting on the statistic being judged, the circular analysis this file already warns about
   elsewhere. An INDEPENDENT measurement is the only way out, and that is what this is.

   REFUSALS, because a number here is worse than a gap:
     · a device whose axis is DRAWN (`plausibleCrystal:false`) is not a clock. The O2Ring reports
       2730 ppm where a real crystal is +/-100, and it passes `independent` only because that flag
       compares two COLUMNS, not two clocks. It may be PLACED on the host timeline, never spent as an
       opinion about it.
     · a device whose host column is the device stamp ROUNDED (`independent:false`) has no second
       clock at all — a phone capture reads ~1.00 ms spread, one stamp quantum.
     · fewer than two survivors ⇒ there is no pair to offset. */

/* ── DETECTOR STABILITY, INGESTED FROM A NODE EXPORT (PpgDex `validation.stability`) ──────────────
   WHAT IT IS. A node that ships its own firmware beat detector can compare its waveform-derived beat
   times against that firmware's on the SAME axis. The shared physiology cancels in the difference, so
   the overlapping Allan deviation of that difference describes the NODE'S OWN DETECTOR NOISE versus
   averaging time — not the subject's heart, and not any clock offset between devices. Today only
   PpgDex emits it, and only for the O2Ring marker source where one axis genuinely carries both.

   WHY THE INTEGRATOR WANTS IT. `hrAgreement` names a FAULTY node when epochs disagree, and its verdict
   is a bare attribution — it cannot say whether the accused node's detector is intrinsically noisy or
   was fine and hit a real event. `slope` answers exactly that, and it is the only field here carrying
   a decision: at −1 the disagreement is jitter that averages away, so a SUSTAINED divergence is a
   genuine fault rather than accumulated noise; at 0 there is a FLOOR no averaging removes, and a fault
   attribution against that node is worth less. `optimalTauSec` is the averaging window this pairing
   actually supports — the principled replacement for an epoch length chosen by intuition.

   READ, NEVER DERIVE. This returns what the node measured, or null. It does not recompute the curve
   from an export (an export carries no beat times) and does not infer a slope from a single scalar.
   Absent, malformed or non-finite ⇒ null, so a consumer branches on presence rather than on a
   fabricated default. `node`/`source` travel with it because a wrist device's firmware estimate and a
   finger ring's are different detectors, and a reader that cannot tell them apart cannot weigh this. */
function readDetectorStability(nodeExport) {
  var v = nodeExport && nodeExport.validation;
  var s = v && v.stability;
  if (!s || typeof s !== 'object') return null;
  if (!isFinite(s.slope)) return null; // the slope IS the verdict; without it there is nothing to say
  var num = function (x) {
    return isFinite(x) ? x : null;
  };
  return {
    node: (nodeExport && (nodeExport.node || (nodeExport.schema && nodeExport.schema.node))) || null,
    source: v.source || null,
    slope: s.slope,
    noise: s.noise || null,
    meaning: s.meaning || null,
    beatsPaired: num(s.beatsPaired),
    tau0Sec: num(s.tau0Sec),
    atShortestMs: num(s.atShortestMs),
    atLongestMs: num(s.atLongestMs),
    atShortestPpm: num(s.atShortestPpm),
    atLongestPpm: num(s.atLongestPpm),
    optimalTauSec: num(s.optimalTauSec),
    /* The one derived field, and it is a THRESHOLD RESTATEMENT rather than a fresh inference: a slope
       below the white/flicker-phase boundary (the same −0.75 midpoint `capture-host/allan.py` and
       `ppgdex-dsp.js` use) means averaging keeps paying, so a persistent divergence cannot be noise. */
    sustainedDivergenceIsFault: s.slope < -0.75
  };
}

function arrivalPairOffsets(devices, opts) {
  opts = opts || {};
  var list = (devices || []).filter(function (d) {
    /* `deviceDrawn !== true` is the PROVENANCE refusal; the two beside it are not substitutes for it.
       `independent` compares two COLUMNS, and a drawn counter's coarse quantisation makes its residual
       spread enormous, so it reads MORE independent the more fabricated it is. `plausibleCrystal` is a
       MAGNITUDE proxy (|ppm| ≤ 200) and catches a drawn axis only when its assumed rate happens to be
       badly wrong. Measured 2026-08-14 over 395 sidecars: one real O2Ring segment (1.72 h) reports
       −22.83 ppm at a 99.3 % drawn-delta share — a textbook-plausible crystal between the H10's −20
       and the Verity's −34 — and passes BOTH. It has no oscillator. Only the delta-concentration test
       separates it, and it does so with no overlap (real ≤ 56.00 %, drawn ≥ 79.04 % over 381 files). */
    return d && d.ok === true && d.independent === true && d.deviceDrawn !== true && d.plausibleCrystal !== false && isFinite(d.offsetMs);
  });
  var refused = (devices || [])
    .filter(function (d) {
      return list.indexOf(d) < 0;
    })
    .map(function (d) {
      return {
        device: d && d.device,
        reason:
          !d || d.ok !== true
            ? 'axis refused'
            : d.independent !== true
              ? 'host column is not an independent clock'
              : d.deviceDrawn === true
                ? 'device axis is DRAWN — ' +
                  (d.drawnShare == null ? 'delta concentration' : (d.drawnShare * 100).toFixed(1) + ' % of deltas share one value') +
                  '; a synthesised counter, not a clock, whatever ppm it reports'
                : d.plausibleCrystal === false
                  ? 'drawn axis — ' + d.ppm + ' ppm is not a crystal'
                  : 'incomplete anchor'
      };
    });
  if (list.length < 2) return { ok: false, reason: 'need >=2 usable clocks', usable: list.length, refused: refused };

  var pairs = [];
  for (var i = 0; i < list.length; i++) {
    for (var j = i + 1; j < list.length; j++) {
      var a = list[i],
        b = list[j];
      /* Each device's (host - counter) constant. Two Polars share the PMD counter epoch, so the
         DIFFERENCE of those constants is their clock offset directly. Devices from different vendors
         do not share an epoch — the difference is then not an offset, and saying so is the point of
         `sameEpoch`. */
      /* The MEDIAN (host - counter) per device. A single anchor is not an estimate here: measured
         arrival spread is 3013-7005 ms, and the first packet put this 1355 ms off. */
      var ca = a.offsetMs;
      var cb = b.offsetMs;
      var sameEpoch = Math.abs(ca - cb) < 3600000; // within an hour ⇒ the same counter origin
      pairs.push({
        a: a.device,
        b: b.device,
        offsetMs: sameEpoch ? Math.round((ca - cb) * 10) / 10 : null,
        sameEpoch: sameEpoch,
        reason: sameEpoch ? undefined : 'different counter epochs — the difference is not an offset',
        madMs: Math.max(a.offsetMadMs || 0, b.offsetMadMs || 0),
        ppmA: a.ppm,
        ppmB: b.ppm,
        spanSec: Math.min(a.spanSec || 0, b.spanSec || 0)
      });
    }
  }
  return { ok: true, usable: list.length, pairs: pairs, refused: refused };
}

function fitClockClosure(sources, opts) {
  opts = opts || {};
  var withBeats = (sources || []).filter(function (s) {
    return s && s.name && s.times && s.times.length;
  });
  /* ── A LEG WITH NO TIMING IS NOT A CLOCK (WEARABLE-HOST-AXIS-FOLLOWUPS §F3) ──────────────────
     Closure's whole claim is that three INDEPENDENT measurements over-determine each other. A source
     whose time axis was DRAWN — `sample_index x an assumed rate`, which is what every O2Ring session up
     to 2026-07-27 reports — contributes a constant, not a clock: its apparent drift is the error in
     that assumption. Fed in anyway, both of its pairs faithfully measure a fiction, and closure returns
     a confident number about nothing. That is exactly how six nights of CLOCK-CLOSURE-THREE-SOURCE
     failed with "all legs confident".

     A caller passes `timingSource` straight through from a node export's `quality.timingSource`:
       'device+host'  real device timestamps, host-disciplined  → usable
       'host'         axis drawn, but the capture host disciplined it → usable, and REPORTED, because
                      two such legs share one timebase and are correspondingly less independent
       'none'         drawn AND no host anchors → NO timing information exists → EXCLUDED
     OMITTED is treated as usable, so every existing caller is byte-unchanged (no fixture moves). This
     refuses by a COMPUTED provenance flag rather than asking anyone to remember which nights were bad. */
  var excluded = [];
  var src = withBeats.filter(function (s) {
    if (s.timingSource === 'none') {
      excluded.push(s.name);
      return false;
    }
    return true;
  });
  if (src.length < 3) {
    return {
      ok: false,
      reason: excluded.length
        ? 'need >=3 sources with a real time axis — excluded ' + excluded.join(', ') + ' (drawn axis, no host anchors: no timing information exists)'
        : 'need >=3 sources with beats',
      sources: src.length,
      excluded: excluded
    };
  }
  var hostOnly = src
    .filter(function (s) {
      return s.timingSource === 'host';
    })
    .map(function (s) {
      return s.name;
    });
  var pairs = [];
  for (var i = 0; i < src.length; i++)
    for (var j = i + 1; j < src.length; j++) {
      var r = fitClockDrift(src[i].times, src[j].times, opts);
      pairs.push({
        a: src[i].name,
        b: src[j].name,
        driftPpm: r.driftPpm,
        offsetMs: r.offsetMs,
        confident: !!r.confident,
        correspondence: r.medianCorrespondence,
        chance: r.chanceCorrespondence,
        reason: r.reason,
        wrappedDriftPpm: r.wrappedDriftPpm,
        wrappedConcentration: r.wrappedConcentration
      });
    }
  var byKey = {};
  pairs.forEach(function (p) {
    byKey[p.a + '|' + p.b] = p;
  });
  var dOf = function (a, b) {
    var p = byKey[a + '|' + b];
    if (p) return p.driftPpm;
    p = byKey[b + '|' + a];
    return p ? -p.driftPpm : null; // d(B,A) = -d(A,B)
  };
  var triples = [];
  for (var x = 0; x < src.length; x++)
    for (var y = x + 1; y < src.length; y++)
      for (var z = y + 1; z < src.length; z++) {
        var A = src[x].name,
          B = src[y].name,
          C = src[z].name;
        var d1 = dOf(A, B),
          d2 = dOf(B, C),
          d3 = dOf(C, A);
        if (d1 == null || d2 == null || d3 == null || !isFinite(d1) || !isFinite(d2) || !isFinite(d3)) continue;
        var err = d1 + d2 + d3;
        var conf = [byKey[A + '|' + B], byKey[B + '|' + C], byKey[A + '|' + C]].filter(Boolean);
        /* The tolerance is the LEGS' own scale, not a constant: a triple of weak fits is allowed a
           looser closure than a triple of sharp ones, and a fixed threshold would either excuse the
           first or condemn the second. */
        var _tol = opts.closureTolPpm != null ? opts.closureTolPpm : Math.max(5, 0.25 * Math.max(Math.abs(d1), Math.abs(d2), Math.abs(d3)));
        triples.push({
          nodes: [A, B, C],
          closurePpm: err,
          tolPpm: _tol,
          // Declared at construction, not assigned afterwards — a later `t.consistent = …` leaves the
          // checker with no such property on the object's inferred shape.
          consistent: Math.abs(err) <= _tol,
          allLegsConfident:
            conf.length === 3 &&
            conf.every(function (p) {
              return p.confident;
            }),
          weakLegs: conf
            .filter(function (p) {
              return !p.confident;
            })
            .map(function (p) {
              return p.a + '-' + p.b;
            })
        });
      }
  return {
    ok: true,
    pairs: pairs,
    triples: triples,
    anyInconsistent: triples.some(function (t) {
      return !t.consistent;
    }),
    // Legs dropped for having no time axis at all, and legs whose timing is the HOST's rather than the
    // device's. `sharedHostTimebase` is a caveat, not a failure: two host-disciplined legs still close,
    // but they are less independent than the identity's derivation assumes, so a reader should know.
    excluded: excluded,
    hostTimedLegs: hostOnly,
    sharedHostTimebase: hostOnly.length >= 2
  };
}

/* ── THE CONSTANT-OFFSET PRECONDITION (CROSS-DEVICE-DRIFT-AND-CLOSURE §3.1/§5) ───────────────────
   Every consumer of a per-night CONSTANT offset inherits an assumption nothing states: that the pair's
   relative drift, times the night, is small against that consumer's OWN resolution. The tolerance is
   therefore a property of the CONSUMER, not of the fit — which is why one number cannot be baked in:

     consumer                        resolution     max drift over a 7 h night   at the MEASURED 7 ppm
     runFusion event pairing         +-120 s        ~4,700 ppm     safe          safe
     desat<->apnea coupling          -15..+60 s     ~2,400 ppm     safe          safe
     fitClockOffsetPooled support     ~30 s         ~1,200 ppm     safe for CPAP safe
     fitClockDrift beat matching     +-80 ms        ~3 ppm         NOT safe      NOT safe over 7 h — but safe under 3.2 h
     pat-gate.js                     <=60 ms        ~2.4 ppm       NOT safe      NOT safe over 7 h — but safe under 2.4 h

   So the CPAP path is not safe by luck, as §3.1 supposed — it is safe by three orders of magnitude.
   What is unsafe is anything at BEAT resolution, which is exactly the two consumers that matter for PAT.

   ⚠ THE RATE IN THE OLD PARENTHETICAL WAS RETRACTED. This table used to justify the last two rows with
   "(wearables run 100+)". That figure came from the beat-derived stack — match beats, block, unwrap a
   comb, regress — which produced four retractions in two days. WEARABLE-DRIFT-DIRECT measured the rate
   DIRECTLY off the two clocks already in every capture file (host stamp vs device counter): Polar H10
   -20.3 ppm and Verity -27.0 ppm against the capture host, each stable to +-2-3 ppm across fragments
   AND across nights, so the INTER-DEVICE rate is ~7 ppm, not 100+. Over 7 h that is 202 ms, not 2.5 s.

   The two verdicts do NOT flip — 7 ppm still exceeds a 3 / 2.4 ppm budget — but the margin is 2-3x,
   not 30x, and that changes what is POSSIBLE: a constant offset is defensible at beat resolution over a
   SHORT ENOUGH window. `maxSafeSpanSec` below is that question asked the useful way round. Under
   "100+ ppm" the answer was ~10 minutes and nobody would bother; at the measured rate it is hours.
   Exported so a caller can ask rather than assume. */
function maxTolerableDriftPpm(spanSec, resolutionSec) {
  if (!(spanSec > 0) || !(resolutionSec > 0)) return null;
  return (resolutionSec / spanSec) * 1e6;
}

/* The same precondition asked the way a caller can ACT on: given my resolution and the pair's measured
   drift, how long may the window be before a constant offset stops being defensible? The other
   direction only ever answers "no"; this one answers "not longer than this".
   `driftPpm` defaults to WEARABLE-DRIFT-DIRECT's measured inter-device rate. It is a DEFAULT, not a
   constant of nature — a caller with its own measured pair rate should pass it, and a caller comparing
   against the CPAP (-9..-29 ppm vs a wearable) has a much larger figure to pass. Sign is irrelevant, so
   the magnitude is taken; a zero or non-finite rate has no bound to give and returns null rather than
   Infinity, because "no limit" is a claim and this function has not measured one. */
var MEASURED_WEARABLE_PAIR_PPM = 7;
function maxSafeSpanSec(resolutionSec, driftPpm) {
  var ppm = driftPpm == null ? MEASURED_WEARABLE_PAIR_PPM : Math.abs(driftPpm);
  if (!(resolutionSec > 0) || !isFinite(ppm) || !(ppm > 0)) return null;
  return resolutionSec / (ppm * 1e-6);
}

function fitClockOffsetPooled(anchorTimes, channels, opts) {
  opts = opts || {};
  var maxSec = opts.maxLagSec != null ? opts.maxLagSec : 5400; // +/-90 min
  var stepSec = opts.stepSec != null ? opts.stepSec : 5;
  /* matchSec 45 -> 30 (POOLED-CLOCK-FIT-FOLLOWUPS §5, swept 2026-08-01). Both numbers were
     INHERITED, never chosen; §5 asked for a sweep so they could be. Swept 6 windows x 5 grids
     against a planted control (truth known) and all 36 reproducible corpus nights:

       PLANTED: accuracy is FLAT — median |error| ~0 s at every combination, confirming the
       centroid removes the window's bias. What the window buys is RESOLUTION: the peak's support
       runs ~1.5x matchSec (0-1 s at 10, 16 at 20, 36 at 30, 67 at 45, 158 at 90). On planted data
       alone the answer would be "use 10".

       CORPUS: and that answer would be WRONG, which is why the planted leg cannot decide this.
       Real responder jitter exceeds a 10 s window and it loses SEVEN nights.

         matchSec   confident   support   cross-night MAD
             10        15          4 s        17 s     <- too narrow, drops nights
             20        21          8 s        10 s
             30        22         15 s        17 s     <- chosen
             45        22         20 s        22 s     <- inherited
             90        23         46 s        33 s

       30 strictly dominates 45: the same 22 confident nights, 25 % narrower support, and a 23 %
       better MAD across nights — which is the meaningful check, since the CPAP's offset is
       physically near-constant, so agreement BETWEEN nights is the only accuracy proxy available
       without a reference clock. Nothing gets worse.

     THE HONEST LIMIT: this is calibrated on 36 nights from ONE deployment, and §3 of the same brief
     warns against fitting the estimator to its own corpus. The defence is that matchSec is a
     PHYSICAL parameter — how far a responder may lag its anchor — so setting it from measured
     responder behaviour is calibration rather than curve-fitting. It is still one deployment's
     physiology. `stepSec` stays 5: 1 vs 5 vs 10 differ by under a second of accuracy, and 5 is
     5x cheaper than 1. */
  var matchSec = opts.matchSec != null ? opts.matchSec : 30;
  var minEvents = opts.minEvents != null ? opts.minEvents : 5;
  var nullIters = opts.nullIters != null ? opts.nullIters : 30;
  // Two peaks closer than this are the same answer seen twice, not a disagreement.
  var sepSec = opts.separateSec != null ? opts.separateSec : 180;
  var nLags = Math.floor((2 * maxSec) / stepSec) + 1;
  var lagOf = function (idx) {
    return -maxSec + idx * stepSec;
  };

  var A = (anchorTimes || [])
    .filter(function (t) {
      return t != null && isFinite(t);
    })
    .sort(function (x, y) {
      return x - y;
    });

  /* Every channel is RETAINED in the output, usable or not, with the reason — a contributor that went
     missing is itself information, which is the whole lesson of the silent-zero class. */
  var out = [],
    live = [];
  for (var i = 0; i < (channels || []).length; i++) {
    var ch = channels[i] || {};
    var E = (ch.times || [])
      .filter(function (t) {
        return t != null && isFinite(t);
      })
      .sort(function (x, y) {
        return x - y;
      });
    /** @type {any} — progressively filled; a literal initialiser would pin these fields to `null`. */
    var rec = {
      node: ch.node || null,
      channel: ch.channel || null,
      nEvents: E.length,
      usable: false,
      zAtPeak: null,
      ownOffsetSec: null,
      /* Present-and-null on the refusal paths too, so every record is one shape. */
      ownSpreadSec: null,
      agreed: false,
      reason: null
    };
    if (A.length < minEvents) rec.reason = 'too few anchor events';
    else if (E.length < minEvents) rec.reason = 'too few events';
    else {
      rec.usable = true;
      live.push({ rec: rec, times: E });
    }
    out.push(rec);
  }

  var fail = function (reason) {
    return {
      offsetSec: null,
      spreadSec: null,
      nChannels: 0,
      nNodes: 0,
      z: null,
      nullZ: null,
      nullMedianZ: null,
      nullExceeded: null,
      pValue: null,
      pFloor: null,
      underpowered: false,
      ambiguous: false,
      alternativesSec: [],
      confident: false,
      reason: reason,
      channels: out
    };
  };
  if (A.length < minEvents) return fail(A.length ? 'too few anchor events' : 'no anchor events');
  if (!live.length) return fail('no channel could be estimated');

  var zs = live.map(function (c) {
    return _zCurve(_coincidenceCurve(A, c.times, nLags, maxSec, stepSec, matchSec));
  });
  var pk = _pooledPeak(zs);
  var Z = pk.Z,
    bestIdx = pk.idx,
    bestLag = lagOf(bestIdx);

  /* §5.3 — the per-channel table survives pooling, and gets STRICTLY more informative. Under the vote
     it listed each channel's own argmax, which are not comparable to each other; here it lists each
     channel's z AT THE CHOSEN OFFSET, which are. Both are kept: `ownOffsetSec` is what makes a
     genuinely disagreeing sensor visible, the one thing the vote did better by leaving it out of the
     agreeing set. Pooling without this trades one blindness for another. */
  var nodes = {};
  for (var c2 = 0; c2 < live.length; c2++) {
    var zc = zs[c2],
      own = 0;
    for (var s2 = 1; s2 < zc.length; s2++) if (zc[s2] > zc[own]) own = s2;
    live[c2].rec.zAtPeak = +zc[bestIdx].toFixed(2);
    /* THE SAME CENTROID THE POOLED PATH USES, AND FOR THE SAME REASON — it was applied there and not
       here, in this one function. `ownOffsetSec` took the raw per-channel argmax, so it inherited the
       whole plateau bias the block above documents ("the argmax landed 37 s low; the centroid lands
       within a second"). Measured 2026-08-19 on planted data at +/-0.1 s jitter, single channel:

         matchSec   10    20    30    45    90
         own bias   -7   -17   -27   -42   -87      (pooled error: +0.5 s at every one)

       i.e. the bias is almost exactly -matchSec, so with the shipped default of 30 every per-channel
       offset read ~27 s low, at ANY true offset (checked at 0, 37, 137, 300, -137). That is not
       internal: `integrator-app.js` renders it to the user as "(own peak N min - does NOT support this
       offset)", so a channel that agreed could be shown disagreeing by ~0.45 min, and `trio-batch`
       prints it in the batch report.

       The pooled path computes this same centroid inline (with its own grid rounding and `spreadSec`);
       it is deliberately NOT refactored here, because touching it would move numbers this function has
       shipped for months to fix a defect that never existed on that side. */
    var ownLo = own,
      ownHi = own,
      ownPeak = zc[own];
    while (ownLo > 0 && zc[ownLo - 1] >= ownPeak - 1) ownLo--;
    while (ownHi < zc.length - 1 && zc[ownHi + 1] >= ownPeak - 1) ownHi++;
    var ownWSum = 0,
      ownWLag = 0;
    for (var p3 = ownLo; p3 <= ownHi; p3++) {
      var w3 = zc[p3] - (ownPeak - 1);
      if (w3 <= 0) continue;
      ownWSum += w3;
      ownWLag += w3 * lagOf(p3);
    }
    live[c2].rec.ownOffsetSec = ownWSum > 0 ? +(ownWLag / ownWSum).toFixed(3) : lagOf(own);
    /* THE WIDTH THE CENTROID WAS TAKEN OVER — published, because it was already computed and thrown
       away. `ownLo`/`ownHi` bound the lags this channel alone cannot distinguish from its own peak,
       by the same "within 1 unit of the peak" rule the pooled `spreadSec` uses, and on the same
       unit-noise footing (`zc` is a per-channel z; the pooled `Z` is those summed over sqrt(n), so
       both are unit-noise by construction and the rule transfers unchanged).

       ⚠️ THIS IS A RESOLUTION, NOT A sigma, AND THE DISTINCTION IS THE WHOLE VALUE OF THE FIELD.
       `CROSS-DEVICE-DRIFT-AND-CLOSURE` §3.4 wants a per-channel PRECISION so `inverseVarianceWeights`
       can replace the pooled fit's equal weighting. This is the raw material for that and is NOT
       itself the weight: mapping a support width to a variance needs an assumed peak shape, and
       asserting one here would manufacture exactly the precision the weighting is meant to measure.
       So the width ships under its own name and the mapping stays an open, deliberate step.
       Same discipline as the sigma_y ppm fields (#1587): publish the quantity in the unit it is
       actually in, rather than a converted one that implies more than was measured. */
    live[c2].rec.ownSpreadSec = +(lagOf(ownHi) - lagOf(ownLo)).toFixed(3);
    live[c2].rec.agreed = zc[bestIdx] >= 1;
    if (live[c2].rec.node) nodes[live[c2].rec.node] = 1;
  }

  /* RESOLUTION, not agreement-spread. The pooled statistic has unit noise by construction, so the
     lags that stay within 1 unit of the peak are the ones the data cannot distinguish from it — the
     honest width of the measurement. (The vote's `spreadSec` meant something else: how far apart the
     agreeing channels' separate estimates sat. There is no such quantity here, and reusing the name
     for a different thing is the point at which a consumer must read this comment.) */
  var supLo = bestIdx,
    supHi = bestIdx;
  while (supLo > 0 && Z[supLo - 1] >= pk.peak - 1) supLo--;
  while (supHi < nLags - 1 && Z[supHi + 1] >= pk.peak - 1) supHi++;

  /* THE POINT ESTIMATE IS THE SUPPORT'S CENTROID, NOT THE ARGMAX — measured, not cosmetic.

     A hard +/-`matchSec` match window makes the peak a PLATEAU about 2*matchSec wide: every lag that
     puts each partner inside the window scores identically, so on planted data the argmax is decided
     by whichever unrelated channel happens to tilt the plateau, not by the planted offset. Measured on
     the planted fixture the argmax landed 37 s low; the centroid lands within a second. Weighting by
     `Z - (peak - 1)` reduces to the plain midpoint on a flat plateau and to the peak on a sharp one,
     so it is the right estimator in both regimes. `spreadSec` publishes the width being centred, which
     is the honest resolution of the measurement — the centroid is a better point inside that interval,
     it does not make the interval smaller. */
  var wSum = 0,
    wLag = 0;
  for (var p2 = supLo; p2 <= supHi; p2++) {
    var w = Z[p2] - (pk.peak - 1);
    if (w <= 0) continue;
    wSum += w;
    wLag += w * lagOf(p2);
  }
  /* ROUNDED TO THE GRID, NOT TO WHOLE SECONDS. `Math.round(wLag / wSum)` quantised every answer this
     function has ever returned to 1 s — the value is in SECONDS, so rounding it to an integer throws
     away exactly the precision `stepSec` exists to provide. Invisible for the clock work it was built
     for (a +/-45 s match window makes a ~90 s plateau, so a 1 s quantum is far inside the noise) and
     fatal the first time it was pointed at a sub-second question: beat-train lags came back as 6000,
     -2000, 10000, 16000 ms — every one an exact multiple of 1000, which is a quantiser, not a
     measurement. The centroid legitimately interpolates BETWEEN grid points, so it is kept to
     millisecond resolution rather than snapped to `stepSec`; anything finer would be false precision
     against a 20 ms grid, and anything coarser discards a real interpolation. */
  var bestSec = wSum > 0 ? +(wLag / wSum).toFixed(3) : bestLag;

  /* RIVALS. Under a continuous statistic an exact tie is vanishingly unlikely, so the vote's tie rule
     does not port — but a NEAR tie is real and must still be reported rather than resolved. A rival is
     any peak more than `sepSec` from the winner that comes within one noise unit of it. */
  var alternativesSec = [],
    lastRival = -1,
    runBest = -1;
  var flush = function () {
    if (runBest >= 0) alternativesSec.push(lagOf(runBest));
    lastRival = -1;
    runBest = -1;
  };
  for (var r = 0; r < nLags; r++) {
    var isRival = Z[r] >= pk.peak - 1 && Math.abs(lagOf(r) - bestSec) > sepSec;
    if (!isRival) {
      // Rivals closer than `sepSec` to one another are one rival seen across its own plateau.
      if (lastRival >= 0 && lagOf(r) - lagOf(lastRival) > sepSec) flush();
      continue;
    }
    if (runBest < 0 || Z[r] > Z[runBest]) runBest = r;
    lastRival = r;
  }
  flush();

  /* THE IN-RUN NULL. Seeded from the data itself so the verdict is reproducible run to run and machine
     to machine — a confidence that moves on re-run is not a measurement, and it would make every
     fixture carrying one non-deterministic. */
  var seed = A.length * 2654435761;
  for (var sd2 = 0; sd2 < A.length; sd2++) seed = (seed * 31 + (A[sd2] % 1000000)) >>> 0;
  for (var sc = 0; sc < live.length; sc++) seed = (seed * 31 + live[sc].times.length) >>> 0;
  var rnd = _seededRng(seed);
  var nullPeaks = [];
  for (var it = 0; it < nullIters; it++) {
    var sh = _shuffledAnchors(A, rnd);
    var nzs = live.map(function (cc) {
      return _zCurve(_coincidenceCurve(sh, cc.times, nLags, maxSec, stepSec, matchSec));
    });
    nullPeaks.push(_pooledPeak(nzs).peak);
  }
  var exceeded = nullPeaks.filter(function (v) {
    return v >= pk.peak;
  }).length;
  nullPeaks.sort(function (x, y) {
    return x - y;
  });
  var nullMax = nullPeaks.length ? nullPeaks[nullPeaks.length - 1] : null;
  var nullMed = nullPeaks.length ? nullPeaks[nullPeaks.length >> 1] : null;
  // The standard permutation p-value, +1 on both sides: with 30 shuffles the best attainable is
  // 1/31 = 0.032, and claiming p=0 from 30 draws would be exactly the fabricated authority this
  // estimator exists to avoid.
  var pValue = nullPeaks.length ? (exceeded + 1) / (nullPeaks.length + 1) : null;

  var nNodes = Object.keys(nodes).length;
  var ambiguous = alternativesSec.length > 0;
  var reason = null;
  /* THE NULL MUST BE ABLE TO REACH THE THRESHOLD IT IS JUDGED AGAINST.
     A permutation p-value from N shuffles bottoms out at 1/(N+1), so with fewer than 19 shuffles
     `p <= 0.05` is UNREACHABLE and every night comes back "indistinguishable from its own null" —
     which reads as "no signal found" when the truth is "this run could not have found one". Caught
     the first time the estimator was pointed at a new question with `nullIters: 10`: 44 channel pairs,
     zero significant, entirely because of the setting. An underpowered run must say it is underpowered
     rather than report a negative result it was never able to contradict. */
  var pFloor = nullPeaks.length ? 1 / (nullPeaks.length + 1) : null;
  var underpowered = pFloor != null && pFloor > 0.05;
  /* The null verdict is reported FIRST when it fails. On a night that is indistinguishable from its own
     chance floor the peak is noise, and so are its rivals — leading with "3 equally-supported offsets"
     would dress a null result up as a close call between real candidates. */
  // `pFloor != null` is redundant with `underpowered` at runtime but not to the type-checker, which
  // narrows on the guard it can see rather than on a boolean computed three lines earlier.
  if (pFloor != null && underpowered) {
    reason =
      'UNDERPOWERED — ' + nullPeaks.length + ' null shuffles can only reach p=' + pFloor.toFixed(3) + ', so p<=0.05 is unreachable; raise nullIters to >=19 before reading this as a negative result';
  } else if (pValue != null && pValue > 0.05) {
    reason = 'indistinguishable from this night’s own null (p=' + pValue.toFixed(3) + ', Z ' + pk.peak.toFixed(1) + ' vs null max ' + (nullMax == null ? '?' : nullMax.toFixed(1)) + ')';
  } else if (ambiguous) {
    reason =
      'ambiguous — ' +
      (alternativesSec.length + 1) +
      ' offsets within one noise unit (' +
      [bestSec]
        .concat(alternativesSec)
        .map(function (v) {
          return (v / 60).toFixed(2);
        })
        .join(' / ') +
      ' min); the evidence does not choose between them';
  }
  return {
    offsetSec: bestSec,
    spreadSec: (supHi - supLo) * stepSec,
    nChannels: live.length,
    nNodes: nNodes,
    z: +pk.peak.toFixed(2),
    nullZ: nullMax == null ? null : +nullMax.toFixed(2),
    nullMedianZ: nullMed == null ? null : +nullMed.toFixed(2),
    nullExceeded: nullPeaks.length ? exceeded : null,
    pValue: pValue == null ? null : +pValue.toFixed(4),
    // The best p this run COULD have reported. A caller comparing `pValue` against a threshold below
    // `pFloor` is reading a verdict the run was incapable of returning.
    pFloor: pFloor == null ? null : +pFloor.toFixed(4),
    underpowered: underpowered,
    ambiguous: ambiguous,
    alternativesSec: alternativesSec,
    /* Corroboration is NOT a node count here. The vote needed `nNodes >= 2` because it had no measure
       of evidence strength; the in-run null is that measure, and it already accounts for how many
       channels contributed (they are pooled before the null sees them). A single-node night whose peak
       beats its own 30-shuffle null is a measurement; a two-node night that does not, is not. */
    confident: !underpowered && !ambiguous && pValue != null && pValue <= 0.05,
    reason: reason,
    channels: out
  };
}

/* Which node's clock is wrong, and by how much?
   Every dated pair is estimated. A pair counts as SKEWED when its best lag sits
   outside the fusion tolerance AND its peak clearly beats the floor. A node is
   then named as the offender when it is skewed against EVERY other node it was
   compared with, by a consistent sign — one device disagreeing with all the
   others is the one that is wrong, whereas two nodes disagreeing only with each
   other names nobody (reported, not attributed). */
function detectClockSkew(recs, opts) {
  opts = opts || {};
  var tolSec = opts.toleranceSec != null ? opts.toleranceSec : 120;
  // 4x, not 3x: on the reference corpus the true skew ran 3.5-7.2x and spurious peaks 3.0-3.8x,
  // so 3 sat inside the noise. The partner-agreement test below is what actually separates them;
  // this only keeps the weakest claims out of the running.
  var minPeak = opts.minPeakOverFloor != null ? opts.minPeakOverFloor : 4;
  /* FINISHED-WORK-IMPROVEMENTS §A 2b — a rec whose ring RTC RESET mid-recording is VETOED from the
     event-pair estimator. Its own placement is unmeasured by definition (a reset's offset is), so it
     can neither be shifted itself nor drag another node's pair estimate toward it. The veto is
     surfaced separately below so the fusion output records WHICH rec was excluded and WHY. */
  var vetoes = (recs || [])
    .filter(function (r) {
      return r && r.rtcResetSuspect === true;
    })
    .map(function (r) {
      return {
        node: r.node,
        source: 'rtc-reset-suspect',
        rtcVerifiedAtMs: r.rtcVerifiedAtMs != null && isFinite(r.rtcVerifiedAtMs) ? r.rtcVerifiedAtMs : null,
        note: r.node + ' RTC reset-suspect on this rec — placement UNMEASURED (excluded from anchor fits).'
      };
    });
  var dated = (recs || []).filter(function (r) {
    return r && !r.dateUnknown && !r.rtcResetSuspect && r.events && r.events.length;
  });
  var times = function (r) {
    return r.events
      .map(function (e) {
        return e.tMs;
      })
      .filter(function (t) {
        return t != null && isFinite(t);
      });
  };
  var pairs = [];
  for (var i = 0; i < dated.length; i++)
    for (var j = i + 1; j < dated.length; j++) {
      var est = estimateEventLag(times(dated[i]), times(dated[j]), opts);
      if (!est) continue;
      pairs.push({
        a: dated[i].node,
        b: dated[j].node,
        lagSec: est.lagSec,
        peakOverFloor: est.peakOverFloor,
        hits: est.hits,
        floor: est.floor,
        skewed: Math.abs(est.lagSec) > tolSec && est.peakOverFloor != null && est.peakOverFloor >= minPeak
      });
    }
  // attribute: a node skewed against EVERY partner, all with the same sign
  var byNode = {};
  pairs.forEach(function (p) {
    /* `estimateEventLag(A, B).lagSec` is the shift that must be ADDED TO A to line it up with B.
       So A's own correction is +lag and B's is its negation — getting this backwards inverts the
       sign of every reported skew, which is why the gate pins the direction and not just the size. */
    (byNode[p.a] = byNode[p.a] || []).push({ other: p.b, lagSec: p.lagSec, skewed: p.skewed, peakOverFloor: p.peakOverFloor });
    (byNode[p.b] = byNode[p.b] || []).push({ other: p.a, lagSec: -p.lagSec, skewed: p.skewed, peakOverFloor: p.peakOverFloor });
  });
  var findings = [];
  Object.keys(byNode).forEach(function (node) {
    var rel = byNode[node];
    if (
      rel.length < 1 ||
      !rel.every(function (r) {
        return r.skewed;
      })
    )
      return;
    var signs = rel.map(function (r) {
      return r.lagSec > 0 ? 1 : -1;
    });
    if (
      !signs.every(function (s) {
        return s === signs[0];
      })
    )
      return;
    var lags = rel
      .map(function (r) {
        return r.lagSec;
      })
      .sort(function (x, y) {
        return x - y;
      });
    var medLag = lags[lags.length >> 1];
    /* AGREEMENT ACROSS PARTNERS — the discriminator that peak-over-floor alone does not give.
       A device whose CLOCK is wrong is wrong by the same amount against everything it is compared
       with; a spurious peak in one noisy pairing is not. Measured on the reference corpus, requiring
       consistent SIGN alone produced 7 false positives in 38 nights (a host-captured node named as
       29 min skewed, once on a night with no CPAP present at all) — enough to corrupt good data if
       applied. Requiring the per-partner estimates to AGREE removes them: the true CPAP skew held
       37.5-40.0 min across every partner, while the false ones scattered.
       Tolerance is 2x the match window, i.e. the width of the coincidence plateau itself — two
       honest estimates of the same offset cannot differ by more than that for a real reason. */
    var spread = lags[lags.length - 1] - lags[0];
    var agreeTol = 2 * (opts.matchSec != null ? opts.matchSec : 60);
    if (rel.length > 1 && spread > agreeTol) return;
    findings.push({
      node: node,
      // The correction to ADD to this node's timestamps to align it with the rest.
      offsetSec: medLag,
      againstNodes: rel.map(function (r) {
        return r.other;
      }),
      peakOverFloor: Math.min.apply(
        null,
        rel.map(function (r) {
          return r.peakOverFloor;
        })
      ),
      method: 'event-coincidence cross-correlation vs the other nodes (no external reference)',
      note: node + ' timestamps appear ' + Math.abs(Math.round(medLag / 60)) + ' min ' + (medLag > 0 ? 'BEHIND' : 'AHEAD OF') + ' every other node — its internal clock is wrong, not its physiology.'
    });
  });
  /* FINISHED-WORK-IMPROVEMENTS §A 2b — declared RTC-readback findings. A rec that carries a
     `rtcOffsetS` above the same tolerance the pairwise estimator uses is a claim from a DEVICE+HOST
     RTC readback (the ring's crystal watched against the host, `_rtclog.csv` via
     `capture-host/writers.RingClockLogWriter`). It rides the existing applied/attributed pipeline
     with `source:'rtc-readback'` (distinct from `pairwise`/`pooled`) so a consumer can tell where the
     number came from. Reset-suspect recs are excluded above; their placement is unmeasured, not
     off by a knowable amount. */
  (recs || []).forEach(function (r) {
    if (!r || r.rtcResetSuspect === true) return;
    var o = r.rtcOffsetS;
    if (o == null || !isFinite(o)) return;
    if (Math.abs(o) <= tolSec) return;
    findings.push({
      node: r.node,
      offsetSec: o,
      againstNodes: [],
      peakOverFloor: null,
      method: 'device+host RTC readback (`_rtclog.csv` via capture-host/writers.RingClockLogWriter, matched within \u00b112 h of the recording start)',
      source: 'rtc-readback',
      rtcVerifiedAtMs: r.rtcVerifiedAtMs != null && isFinite(r.rtcVerifiedAtMs) ? r.rtcVerifiedAtMs : null,
      note: r.node + ' RTC readback declares clock ' + Math.abs(Math.round(o)) + 's ' + (o > 0 ? 'BEHIND' : 'AHEAD OF') + ' host — declared, not silently corrected.'
    });
  });
  return { pairs: pairs, findings: findings, beatCheck: _beatSkewCheck(recs, pairs, opts), vetoes: vetoes };
}

/* ── BEAT-LEVEL CORROBORATION OF THE EVENT-DERIVED SKEW (§F6) ──────────────────────────────────────
   Everything above is estimated from SPARSE EVENT times — a handful of desaturations and apneas per
   night, cross-correlated on a coarse grid, with a ±120 s fusion tolerance. That is the right
   instrument for "is a device 42 minutes out", and it is a blunt one for anything smaller.

   Two hr-bearing nodes carry tens of thousands of BEATS over the same night, and `fitClockDrift`
   already turns two beat trains into an offset with its own chance control. Now that the beats reach
   the fusion (§F6's carrier above), that far sharper estimate is computable here.

   IT CORROBORATES; IT DOES NOT DECIDE. `skewApplied` shifts real event times, and nothing in this
   function is allowed to influence which node gets shifted or by how much — the event path's decisions
   are unchanged, byte for byte. What this adds is a second observer that can DISAGREE, and a
   disagreement between a coarse and a sharp estimate of the same quantity is a finding either way.

   A beat offset is reported only when `fitClockDrift` says it is confident (correspondence clearing
   its own chance control), because an unconfident beat fit is exactly the "unwrap failure wearing the
   same units" the drift briefs' §6 guardrail is about. */
function _beatSkewCheck(recs, pairs, opts) {
  opts = opts || {};
  var minBeats = opts.minBeatsForCheck != null ? opts.minBeatsForCheck : 500;
  var withBeats = (recs || []).filter(function (r) {
    return r && r.beats && r.beats.n >= minBeats && !r.dateUnknown;
  });
  if (withBeats.length < 2) return { pairs: [], reason: 'fewer than two nodes carry a usable beat series' };
  var out = [];
  for (var i = 0; i < withBeats.length; i++)
    for (var j = i + 1; j < withBeats.length; j++) {
      var A = withBeats[i],
        B = withBeats[j];
      var fit = fitClockDrift(Array.prototype.slice.call(A.beats.tMs), Array.prototype.slice.call(B.beats.tMs), {});
      if (!fit || fit.offsetMs == null) {
        out.push({ a: A.node, b: B.node, offsetSec: null, confident: false, reason: fit ? fit.reason : 'no fit' });
        continue;
      }
      /* The event-derived lag for the SAME pair, if one was estimated, so the two observers can be
         compared directly. `estimateEventLag(A,B)` and `fitClockDrift(A,B)` share the a→b direction. */
      var ev = null;
      for (var k = 0; k < (pairs || []).length; k++) {
        if (pairs[k].a === A.node && pairs[k].b === B.node) ev = pairs[k].lagSec;
        else if (pairs[k].a === B.node && pairs[k].b === A.node) ev = -pairs[k].lagSec;
      }
      var beatSec = fit.offsetMs / 1000;
      out.push({
        a: A.node,
        b: B.node,
        offsetSec: +beatSec.toFixed(3),
        nBeats: Math.min(A.beats.n, B.beats.n),
        correspondence: fit.medianCorrespondence,
        chance: fit.chanceCorrespondence,
        confident: fit.confident === true,
        reason: fit.reason,
        eventLagSec: ev,
        /* DISAGREEMENT, against the coarse estimator's OWN resolution. The event lag is quoted off a
           30 s grid with a ±60 s match window, so anything inside that is agreement by construction;
           only a gap wider than the coarse instrument can explain is a real conflict. */
        disagrees: ev == null || fit.confident !== true ? null : Math.abs(beatSec - ev) > 2 * (opts.matchSec != null ? opts.matchSec : 60)
      });
    }
  return { pairs: out };
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

  /* CROSS-DEVICE-CLOCK-SKEW §3.1/§3.2 — measure the skew BEFORE fusing, declare it, and align on it.
     The ResMed sits on its own cell network, so it cannot be NTP-disciplined and the offset is
     permanent: refusing to fuse would mean permanently discarding a signal that is perfectly good
     apart from its timestamps. So the offset is FITTED from the data and APPLIED — but never
     silently. Everything it touches is stamped, `clockSkew` rides in the fusion output, and the
     render surfaces it as a warning banner, because a corrected number that does not say it was
     corrected is the failure this whole line of work exists to stop.

     Applied to a SHALLOW COPY: the caller's recs keep their original timestamps, so nothing
     downstream inherits a shifted clock by surprise. */
  var skew = detectClockSkew(recs, { toleranceSec: opts.toleranceSec != null ? opts.toleranceSec : 120, minPeakOverFloor: opts.minPeakOverFloor });
  /* REFINE the coarse skew to seconds, and ATTRIBUTE it per contributing sensor.
     `detectClockSkew` scans a 30 s grid with a ±60 s match window, so its lag cannot honestly be
     quoted finer than that. Each partner node is split BY IMPULSE so every contribution is
     attributable to a sensor AND a mechanism — on the real corpus a finger oximeter (desaturation), a
     chest ECG (autonomic surge) and an arm IMU (movement) agreed to within 12 s through unrelated
     physiology, and it is seeing those three SEPARATELY that makes the number auditable rather than
     asserted. Channels that cannot be estimated are kept with a reason, so a sensor that was absent or
     too quiet is visible rather than silently missing. */
  var skewFits = {};
  /* POOLED-FIT-DECIDES (EXPORT-PATH-UNREACHABLE-FOLLOWUPS-V) — this loop used to be
     `skew.findings.forEach`, i.e. the pooled fit only ever ran for a node the COARSE detector had
     ALREADY declared skewed, and then only to REPORT a refinement. Two consequences, both measured on
     the 24 trio nights that also carry CPAP EDFs:

       coarse detectClockSkew produced a CPAPDex finding      1 / 24
       pooled fit confident                                  19 / 24
       pooled offset inside the documented 30-50 min band    24 / 24  (37.6-41.7 min, tight)

     So the Integrator corrected ONE night in twenty-four while the instrument it already shipped
     would correct nineteen. The veto is not the `minPeakOverFloor` threshold — on the corpus most
     nights score 5-12 against a bar of 4 — it is the ALL-PARTNERS-MUST-AGREE clause: ECGDex emits
     sleep stages and autonomic surges, cannot witness a respiratory event, and its noise lag then
     discards the whole night. A witness that could not see the event has no business casting a veto.

     `tools/trio-batch.mjs` already does the right thing — one unconditional
     `fitClockOffsetPooled(cpapApneaTimes, allWearableChannels, {})` per night. This runs the same
     way: EVERY dated node with events is fitted as the anchor against every OTHER node's channels.

     ATTRIBUTION falls out of the statistic rather than needing a rule. The pooled fit scores one
     candidate offset across all channels at once, so for the node whose clock is actually wrong every
     channel agrees at the same large offset (a sharp confident peak), while for a healthy node its
     channel set is split — the offender pulls one way, its peers sit at zero — and the peak lands at
     ~0. The offender is therefore simply the confident fit with the largest |offset|. */
  var _fitFor = function (node) {
    /** @type {any} */ var anchor = null;
    /** @type {any[]} */ var chans = [];
    (recs || []).forEach(function (r) {
      if (!r || r.dateUnknown || !r.events || !r.events.length) return;
      if (r.node === node) {
        anchor = r.events
          .map(function (e) {
            return e.tMs;
          })
          .filter(function (t) {
            return t != null && isFinite(t);
          });
        return;
      }
      var byImpulse = {};
      r.events.forEach(function (e) {
        if (e.tMs == null || !isFinite(e.tMs)) return;
        var k = e.impulse || 'event';
        (byImpulse[k] = byImpulse[k] || []).push(e.tMs);
      });
      Object.keys(byImpulse)
        .sort()
        .forEach(function (imp) {
          chans.push({ node: r.node, channel: imp, times: byImpulse[imp] });
        });
    });
    /* POOLED, not voted (POOLED-CLOCK-FIT-2026-07-31-BRIEF §5.5). A REPORTED refinement only —
       `skewApplied` below shifts events by `skew.findings[].offsetSec` from `detectClockSkew`, never by
       anything computed here — so the cutover changes what a reader is TOLD, not what is done to the
       data. On the 31-night corpus it put 29/29 pre-correction nights in the expected band against
       22/25 for the vote, and resolved 4 nights no single channel could fit at all. */
    return anchor && anchor.length && chans.length ? fitClockOffsetPooled(anchor, chans, opts) : null;
  };
  var _fitNodes = {};
  (recs || []).forEach(function (r) {
    if (!r || r.dateUnknown || !r.events || !r.events.length || _fitNodes[r.node]) return;
    _fitNodes[r.node] = 1;
    var fit = _fitFor(r.node);
    if (fit) skewFits[r.node] = fit;
  });

  /* THE CORRECTION THAT IS APPLIED (EXPORT-PATH-UNREACHABLE-FOLLOWUPS-V).
     Previously: `skew.findings[].offsetSec` — the coarse detector's number, quoted off a 30 s grid
     with a ±60 s match window, and only ever available on a night the coarse detector had already
     accepted. Now the POOLED fit decides and supplies the number, because it is both more available
     (19/24 vs 1/24) and finer (#624 took it sub-second; the coarse grid cannot resolve below 30 s).

     ONE node is corrected per fusion — the confident pooled fit with the largest |offset|, and only
     when that exceeds the match tolerance. That matches the physical model this corpus shows: the
     phone/host-captured devices share one clock, and it is the CPAP — on its own cell modem, with no
     user-settable clock and no NTP — that drifts away from them. Correcting two nodes at once from
     mutually-derived offsets would double-count the same relative shift.
     LIMITATION, stated rather than hidden: if two devices are independently skewed, only the larger
     is corrected here, and `clockSkew.fits` carries every node's fit so the second is visible.

     The coarse detector is KEPT — its `pairs` are the per-partner diagnostics a reader needs to see
     WHICH sensor corroborated, and its `findings` still ride in the output — it simply no longer
     holds a veto over the better instrument. */
  /* WHICH NODE IS THE ONE WITH THE WRONG CLOCK — decided by the physical asymmetry, not by the
     statistic, because the statistic cannot decide it. Fitting A-vs-rest and B-vs-rest recovers the
     SAME relative shift with opposite signs, and on the corpus `nNodes` is 3 for every node on almost
     every night, so corroboration breadth does not separate them either: ranking by it still blamed
     OxyDex for the CPAP's 39 min on 2026-06-25/28 and ECGDex on 07-11.

     What DOES separate them is documented in this file already and in tools/trio-batch.mjs: the
     wearables are captured through one host and share its disciplined clock (measured at 0.10-0.39 s
     apart on box-captured nights), while "the ResMed sits on its own cell network, so it cannot be
     NTP-disciplined and the offset is permanent". So the un-disciplined device is the one that moves,
     and on all 24 corpus nights carrying both it is the CPAP.

     Named as a PROPERTY with its reason rather than assumed silently: a node listed here is one whose
     clock no host can set. Anything not listed keeps the previous behaviour exactly — the pairwise
     detector's own attribution — so this widens what gets corrected without inventing a side for any
     node the evidence cannot place. */
  var UNDISCIPLINED_NODES = { CPAPDex: 'no user-settable clock, no NTP — its offset is permanent and must be measured' };
  var _tolSec = opts.toleranceSec != null ? opts.toleranceSec : 120;
  var _cands = Object.keys(skewFits)
    .filter(function (n) {
      return Object.prototype.hasOwnProperty.call(UNDISCIPLINED_NODES, n);
    })
    .map(function (n) {
      return { node: n, fit: skewFits[n] };
    })
    .filter(function (c) {
      return c.fit && c.fit.confident && c.fit.offsetSec != null && isFinite(c.fit.offsetSec) && Math.abs(c.fit.offsetSec) > _tolSec;
    })
    /* ATTRIBUTION — rank on CORROBORATION BREADTH, not on magnitude. Ranking by |offset| alone
       mis-attributed 4 of 24 corpus nights (2026-06-15 and 07-11 blamed OxyDex/ECGDex for the CPAP's
       own ~39 min, with the sign flipped): a healthy node fitted against a skewed partner sees that
       partner's large offset too, so the shift is real but the side is wrong.
       `nNodes` separates them. It counts the DISTINCT partner nodes backing the winning cluster, so
       the node whose clock is actually wrong is corroborated by every peer (3 wearables agree the CPAP
       is late), while a healthy node's large-offset cluster is backed only by the offender itself.
       Magnitude breaks ties last, after corroboration and then significance. */
    .sort(function (x, y) {
      var xn = x.fit.nNodes || 0,
        yn = y.fit.nNodes || 0;
      if (xn !== yn) return yn - xn;
      var xz = x.fit.z || 0,
        yz = y.fit.z || 0;
      if (xz !== yz) return yz - xz;
      return Math.abs(y.fit.offsetSec) - Math.abs(x.fit.offsetSec);
    });
  var _pooledPick = _cands.length ? _cands[0] : null;

  var skewApplied = [];
  if ((skew.findings.length || _pooledPick) && opts.applyClockSkew !== false) {
    var byNode = {};
    skew.findings.forEach(function (f) {
      /* The coarse finding's own number is superseded by the pooled one for the SAME node — same
         correction, measured better — so a night the coarse detector did accept is not shifted twice
         nor shifted by the blunter estimate. */
      byNode[f.node] = f;
    });
    if (_pooledPick) {
      byNode[_pooledPick.node] = {
        node: _pooledPick.node,
        /* `fitClockOffsetPooled` returns the shift that must be ADDED to the ANCHOR (this node) to
           line it up with the others — the same direction detectClockSkew's offsetSec carries, which
           is why it can be substituted here without a sign flip. The gate pins that direction. */
        offsetSec: _pooledPick.fit.offsetSec,
        peakOverFloor: _pooledPick.fit.z != null ? _pooledPick.fit.z : null,
        method: 'pooled joint fit across every partner channel (POOLED-CLOCK-FIT §5.5)',
        source: 'pooled',
        z: _pooledPick.fit.z,
        pValue: _pooledPick.fit.pValue,
        spreadSec: _pooledPick.fit.spreadSec,
        note: _pooledPick.fit.reason || null
      };
    }
    recs = recs.map(function (r) {
      var f = r && byNode[r.node];
      if (!f || !r.events || !r.events.length) return r;
      var shift = f.offsetSec * 1000;
      var copy = {};
      for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) copy[k] = r[k];
      copy.events = r.events.map(function (e) {
        var e2 = {};
        for (var k2 in e) if (Object.prototype.hasOwnProperty.call(e, k2)) e2[k2] = e[k2];
        if (e2.tMs != null && isFinite(e2.tMs)) e2.tMs = e2.tMs + shift;
        return e2;
      });
      if (copy.t0Ms != null && isFinite(copy.t0Ms)) copy.t0Ms = copy.t0Ms + shift;
      if (copy.endMs != null && isFinite(copy.endMs)) copy.endMs = copy.endMs + shift;
      /* `source` says WHICH estimator produced the number that moved this node's timestamps — a
         corrected value that does not say how it was corrected is the failure this line of work
         exists to stop, and 'pooled' vs 'pairwise' is now a real distinction. */
      copy.clockSkewApplied = {
        offsetSec: f.offsetSec,
        peakOverFloor: f.peakOverFloor,
        method: f.method,
        source: f.source || 'pairwise',
        z: f.z != null ? f.z : null,
        pValue: f.pValue != null ? f.pValue : null,
        spreadSec: f.spreadSec != null ? f.spreadSec : null
      };
      skewApplied.push({ node: r.node, offsetSec: f.offsetSec, source: f.source || 'pairwise', spreadSec: f.spreadSec != null ? f.spreadSec : null });
      return copy;
    });
  }
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
  // APNEA-TYPING-FUSION §1.1 — now a chest-ACC COVERAGE report, not a type (the obstructive/central call
  // was withdrawn by INTEGRATOR-APNEA-TYPING-REVIEW §4; see the header on typeApneaByEffort). Independent
  // of `apnea` (it needs only desats + an effort series, not a cardiac corroborator), and null when
  // MotionDex is absent from the bus. Additive: it never touched confirmedAHI or its reportability.
  var apneaTyping = typeApneaByEffort(recs);
  var autoGly = anyOverlap ? fuseAutonomicGlycemic(recs, dtMs, opts) : null;
  var hrv = anyOverlap ? fuseHRVConsensus(recs, dtMs) : null;
  // §2.4 motion-gated HRV: SCORE each consensus block's window for stillness from MotionDex's movement
  // track. Purely additive — no HRV value is altered and nothing is excluded; null without MotionDex.
  var hrvMotionGate = gateHRVByMotion(recs);
  // §2.2 respiration-rate fusion — n-agnostic, null below 2 sources, alters nothing.
  var respiration = fuseRespirationRate(recs);
  // §Phase 2 — no overlap gate: a whole-record HR comparison between two summaries on the same bus.
  var pulseCrossCheck = fusePulseCrossCheck(recs);
  var hrvResource = fuseHrvResource(recs);
  var cvhrCorroboration = fuseCvhrCorroboration(recs);
  if (hrv && hrv.blocks && hrvMotionGate)
    hrv.blocks.forEach(function (b) {
      // Attach ONLY when a gate exists, so a night without MotionDex keeps a byte-identical export
      // (no `motionGate: null` noise on every block). Cast because the block literal is inferred.
      /** @type {any} */ (b).motionGate = hrvMotionGate;
    });
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
    /* CROSS-DEVICE-CLOCK-SKEW §3.1 — always present, so a consumer can tell "checked, clean" from
       "never checked". `findings` names the offending node and the fitted offset; `applied` names
       what was actually shifted before fusing; `pairs` is the raw per-pair evidence. */
    clockSkew: { findings: skew.findings, applied: skewApplied, pairs: skew.pairs, fits: skewFits, vetoes: skew.vetoes && skew.vetoes.length ? skew.vetoes : undefined },
    hrSource: hrSource,
    pairs: pairs,
    apnea: apnea,
    apneaTyping: apneaTyping,
    positional: positional,
    autoGly: autoGly,
    hrv: hrv,
    hrvMotionGate: hrvMotionGate,
    respiration: respiration,
    pulseCrossCheck: pulseCrossCheck,
    hrvResource: hrvResource,
    cvhrCorroboration: cvhrCorroboration,
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
  var _exp = {
    kernel: window.DexKernel ? { version: DexKernel.VERSION, hash: DexKernel.HASH } : null,
    kernelAudit: fusion.kernelAudit || null,
    // §3.1 — the export carries it too: a fused number that was time-corrected must say so.
    clockSkew: fusion.clockSkew || null,
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
    // APNEA-TYPING-FUSION §1.1, WITHDRAWN by INTEGRATOR-APNEA-TYPING-REVIEW-2026-07-22 §4 (option 1).
    // `obstructive`/`central` are now permanently NULL and `typingWithdrawn` is true with a machine-
    // readable `withdrawnReason` — a consumer that reads the split gets an explicit "not known", never a
    // zero it could mistake for "measured none". `untyped` therefore equals `total`; `effortCovered` is
    // the surviving MEASUREMENT (how many desats the chest ACC actually witnessed). Still null with no
    // MotionDex on the bus, and `usable` stays false so every pre-existing consumer gate closes.
    apneaTyping: fusion.apneaTyping
      ? {
          obstructive: fusion.apneaTyping.obstructive,
          central: fusion.apneaTyping.central,
          untyped: fusion.apneaTyping.untyped,
          typed: fusion.apneaTyping.typed,
          total: fusion.apneaTyping.total,
          effortCovered: fusion.apneaTyping.effortCovered,
          typingWithdrawn: fusion.apneaTyping.typingWithdrawn,
          withdrawnReason: fusion.apneaTyping.withdrawnReason,
          underpowered: fusion.apneaTyping.underpowered,
          usable: fusion.apneaTyping.usable,
          coverageAssumed: fusion.apneaTyping.coverageAssumed
        }
      : null,
    // P1: serialize the 3 computed-and-displayed results the export previously dropped (additive, null-tolerant)
    positional: fusion.positional || null,
    hrvConsensus: fusion.hrv || null,
    // §2.4: stillness score for the HRV window from MotionDex movement (EMERGING — a confidence
    // annotation, never a correction). `quiet` ⇒ ≥80% of RECORDED epochs immobile; uncovered epochs
    // are excluded, never counted as still. null when MotionDex is absent.
    hrvMotionGate: fusion.hrvMotionGate || null,
    // §2.2: independent respiration estimates + their agreement (EMERGING). Publishes every source
    // and the SPREAD — a disagreement is reported, never averaged away. null below 2 sources.
    respiration: fusion.respiration || null,
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
  // §Phase 2 — the finger-waveform-vs-ring-1 Hz pulse cross-check. ATTACHED ONLY when it exists (a
  // `site:'finger'` PpgDex + an O2Ring OxyDex on the same bus), so every export without that pair —
  // which is every committed fixture — stays byte-identical (same rule as the motionGate attach above).
  if (fusion.pulseCrossCheck) _exp.pulseCrossCheck = fusion.pulseCrossCheck;
  if (fusion.hrvResource) _exp.hrvResource = fusion.hrvResource;
  if (fusion.cvhrCorroboration) _exp.cvhrCorroboration = fusion.cvhrCorroboration;
  return _exp;
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
  segmentsOverlap: segmentsOverlap, // §6.2 — recorded-time overlap (sparse-aware); gate-visible
  overlapIntervals: overlapIntervals, // gap-aware intersected intervals — the quantity-bearing sibling
  recSegments: recSegments,
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
  // CROSS-DEVICE-CLOCK-SKEW §3.1 — exported so the gate can drive them without a whole fusion.
  estimateEventLag,
  deltaModeSec,
  refineLagByDeltaMode,
  /* DEPRECATED — superseded by `fitClockOffsetPooled` (POOLED-CLOCK-FIT-2026-07-31-BRIEF).
     Kept, not deleted: the two must stay comparable on the corpus for at least one cycle, and it is
     still the only estimator that publishes a per-channel bootstrap CI. New consumers use the pooled
     fit; do not add callers here. */
  fitClockOffset,
  fitClockOffsetPooled,
  fitClockOffsetSegments,
  maxTolerableDriftPpm,
  maxSafeSpanSec,
  MEASURED_WEARABLE_PAIR_PPM,
  fitClockDrift,
  fitClockClosure,
  /* arrival-sidecar offsets — published as a measurement, never applied here (see the block) */
  arrivalPairOffsets,
  /* the cross-node HR agreement gate — see the block above it for why this layer, not the nodes */
  hrAgreement,
  readDetectorStability,
  _wrappedSlopeFit,
  // Timing fiducial over timeseries.spo2 — deliberately NOT OxyDex's clinical desat_event.
  desatOnsetsFromSeries,
  // Wearable-to-wearable alignment (see the ACC block above): offset + drift in ppm.
  activityEnvelope,
  alignEnvelopes,
  detectClockSkew,
  combineConf,
  glucoseMetricsInWindow,
  corroborateDesat,
  typeApneaByEffort,
  gateHRVByMotion,
  fuseRespirationRate,
  fusePulseCrossCheck,
  fuseHrvResource,
  fuseCvhrCorroboration,
  pickHRAuthority,
  gradeFor,
  GRADE_MIRROR,
  GRADE_SOURCES
};
