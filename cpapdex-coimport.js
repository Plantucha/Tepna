/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   CPAPDex · CROSS-NODE CO-IMPORT  (cpapdex-coimport.js)
   Loaded after cpapdex-fusion.js, before cpapdex-app.js. Shares page scope.
   ────────────────────────────────────────────────────────────────────────
   Optional ingest of a peer node's `ganglior.node-export` JSON to UPGRADE the
   CPAP read — the same drop-in-JSON pattern OxyDex uses for ECGDex:

     • OxyDex export  → BORROWED OXIMETRY. CPAPDex's own SA2 oximeter is often
       not connected; a paired O2Ring night supplies real ODI / T90 / SpO₂
       nadir + self-gated desats, turning "no oximeter" into a real AHI↔ODI
       concordance. Clearly labelled as external.
     • ECGDex export  → AUTONOMIC CORROBORATION. Device-scored apneas are
       cross-checked against ECG autonomic-surge events (the SHARED LEAD=15/
       TRAIL=60 gate), plus real RR-based HRV, the CVHR apnea screen, ECG
       resp-rate instability (respRateEpochStats — ECGDex emits this FOR us),
       and the cardiorespiratory phase-locking drop during surges.

   Pairing is by TEMPORAL OVERLAP on the shared floating wall-clock (Clock
   Contract) — never date strings — so a peer attaches to the night it actually
   overlaps. Nothing here changes a CPAP metric; it ADDS a corroboration layer.
   Exposes window.CpapCoimport.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';

var LEAD = 15, TRAIL = 60;            // R4 — identical to cpapdex-fusion.js / the suite gate
var MAXGAP_MS = 4 * 3600000;          // tolerate ≤4 h device-start offset when no overlap

var PEERS = { oxy: [], ecg: [] };     // accumulated, normalized peer recordings

/* ── floating-ms helpers (getUTC* only) ── */
function _hmsToMs(startMs, t, prevMs){
  if (startMs == null || !t) return null;
  var m = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(t)); if (!m) return null;
  var d = new Date(startMs);
  var ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), +m[1], +m[2], +(m[3] || 0));
  while (prevMs != null && ms < prevMs - 1000) ms += 86400000;   // roll past midnight, monotonic
  return ms;
}

/* ════════════════ DETECT + NORMALIZE ════════════════ */
function detectNodeExport(json, filename){
  if (!json) return null;
  var node = (json.schema && json.schema.node) || json.node
          || (Array.isArray(json) && json[0] && json[0].stats ? 'OxyDex' : null);
  if (node) return node;
  var f = (filename || '').toLowerCase();
  if (/oxy|o2ring|spo2|oximet/.test(f)) return 'OxyDex';
  if (/ecg|hrv|cardio/.test(f)) return 'ECGDex';
  return null;
}

/* OxyDex export = ARRAY of nights, OR a {nights:[…]} crossnight wrapper. */
function normalizeOxy(json){
  var nights = Array.isArray(json) ? json : (json && Array.isArray(json.nights) ? json.nights : (json && json.stats ? [json] : []));
  return nights.map(function (n){
    var s = n.stats || {};
    var t0 = (n.t0Ms != null) ? n.t0Ms : (s.startTs != null ? s.startTs : null);
    var dur = s.durationMin != null ? s.durationMin : null;
    return {
      node: 'OxyDex', t0Ms: t0, endMs: (t0 != null && dur != null) ? t0 + dur * 60000 : null, durMin: dur,
      meanSpo2: s.meanSpo2 != null ? s.meanSpo2 : null,
      nadir:    s.minSpo2 != null ? s.minSpo2 : null,
      t90:      s.t90pct != null ? s.t90pct : null,
      odi:      (n.odi4 && n.odi4.rate != null) ? n.odi4.rate : ((n.odi3 && n.odi3.rate != null) ? n.odi3.rate : null),
      odiBasis: (n.odi4 && n.odi4.rate != null) ? 'ODI-4' : ((n.odi3 && n.odi3.rate != null) ? 'ODI-3' : null),
      hypoxicBurden: (n.hypoxicBurden && n.hypoxicBurden.rate != null) ? n.hypoxicBurden.rate : null,
      meanHr:   s.meanHr != null ? s.meanHr : null,
      nsi:      (n.comp && n.comp.nsi != null) ? n.comp.nsi : null,
      date:     n.date || null
    };
  }).filter(function (x){ return x.t0Ms != null; });
}

/* ECGDex export = single node-export object. */
function normalizeEcg(json){
  if (!json || Array.isArray(json)) return [];
  var rec = json.recording || {}, t = (json.hrv && json.hrv.time) || {}, ap = json.apnea || {},
      cr = json.cardiorespiratory || {}, freq = (json.hrv && json.hrv.frequency) || {};
  var t0 = rec.startEpochMs != null ? rec.startEpochMs : (json.startEpochMs != null ? json.startEpochMs : null);
  if (t0 == null) return [];
  var dur = rec.durationMin != null ? rec.durationMin : (rec.durationSec != null ? rec.durationSec / 60 : null);
  // autonomic-surge event times (absolute floating ms)
  var surges = [], prev = null;
  if (Array.isArray(json.ganglior_events)){
    json.ganglior_events.forEach(function (ev){
      if (!ev || ev.impulse !== 'autonomic_surge') return;
      var ms = (ev.tMs != null) ? ev.tMs : _hmsToMs(t0, ev.t, prev);
      if (ms != null){ surges.push(ms); prev = ms; }
    });
  }
  var rrStats = freq.respRateEpochStats || (json.hrv && json.hrv.respRateEpochStats) || null;
  return [{
    node: 'ECGDex', t0Ms: t0, endMs: (dur != null) ? t0 + dur * 60000 : null, durMin: dur,
    rmssd: t.rmssd != null ? t.rmssd : null, sdnn: t.sdnn != null ? t.sdnn : null, hr: t.hr != null ? t.hr : null,
    cvhrIndex: ap.cvhrIndex != null ? ap.cvhrIndex : null, cvhrEvents: ap.cvhrEvents != null ? ap.cvhrEvents : null,
    estAHI: (ap.estimatedAHI && ap.estimatedAHI.value != null) ? ap.estimatedAHI.value : null,
    estAHIband: (ap.estimatedAHI && ap.estimatedAHI.band) ? ap.estimatedAHI.band : null,
    riskCategory: ap.riskCategory || null,
    ansAge: (json.personalization && json.personalization.ansAge && json.personalization.ansAge.composite != null) ? json.personalization.ansAge.composite : null,
    respRateSd: rrStats && rrStats.sd != null ? rrStats.sd : null,
    respRateMedian: rrStats && rrStats.median != null ? rrStats.median : (freq.respRate != null ? freq.respRate : null),
    plvBaseline: cr.plvBaseline != null ? cr.plvBaseline : null,
    plvDuringSurges: cr.plvDuringSurges != null ? cr.plvDuringSurges : null,
    surges: surges
  }];
}

/* ingest a parsed JSON → store normalized peer(s). Returns { node, count } or null. */
function ingest(json, filename){
  var node = detectNodeExport(json, filename);
  if (node === 'OxyDex'){ var o = normalizeOxy(json); o.forEach(function (x){ PEERS.oxy.push(x); }); return { node: 'OxyDex', count: o.length }; }
  if (node === 'ECGDex'){ var e = normalizeEcg(json); e.forEach(function (x){ PEERS.ecg.push(x); }); return { node: 'ECGDex', count: e.length }; }
  return null;
}
function reset(){ PEERS = { oxy: [], ecg: [] }; }
function peers(){ return PEERS; }

/* ════════════════ TEMPORAL-OVERLAP PAIRING ════════════════ */
function _nightWindow(night){
  if (!night || night.t0Ms == null) return null;
  var end = night.t0Ms;
  (night.sessions || []).forEach(function (s){ if (s.endMs != null && s.endMs > end) end = s.endMs; });
  if (end === night.t0Ms && night.therapyHours) end = night.t0Ms + night.therapyHours * 3600000;
  return { a: night.t0Ms, b: end };
}
function _bestOverlap(nw, list){
  if (!nw || !list.length) return null;
  var best = null, bestScore = -Infinity;
  list.forEach(function (p){
    if (p.t0Ms == null) return;
    var pb = p.endMs != null ? p.endMs : p.t0Ms;
    var overlap = Math.min(nw.b, pb) - Math.max(nw.a, p.t0Ms);
    var score;
    if (overlap > 0) score = overlap;
    else { var gap = Math.max(nw.a, p.t0Ms) - Math.min(nw.b, pb); if (gap > MAXGAP_MS) return; score = -gap; }
    if (score > bestScore){ bestScore = score; best = p; }
  });
  return best;
}
function _overlapPct(nw, p){
  if (!nw || !p || p.t0Ms == null) return null;
  var pb = p.endMs != null ? p.endMs : p.t0Ms;
  var overlap = Math.max(0, Math.min(nw.b, pb) - Math.max(nw.a, p.t0Ms));
  var span = Math.max(nw.b - nw.a, 1);
  return +(Math.min(1, overlap / span) * 100).toFixed(0);
}
function oxyForNight(night){ return _bestOverlap(_nightWindow(night), PEERS.oxy); }
function ecgForNight(night){ return _bestOverlap(_nightWindow(night), PEERS.ecg); }

/* ════════════════ BORROWED OXIMETRY (OxyDex) ════════════════ */
function borrowedOximetry(night){
  var nativeOxi = (night.sessions || []).some(function (s){ return s.oximetry && s.oximetry.available; });
  var oxy = oxyForNight(night);
  if (!oxy) return null;
  return {
    source: 'OxyDex', date: oxy.date, overlapPct: _overlapPct(_nightWindow(night), oxy),
    nativeAvailable: nativeOxi,                 // if true, native SA2 wins; this is corroboration
    odi: oxy.odi, odiBasis: oxy.odiBasis, t90: oxy.t90, nadir: oxy.nadir, mean: oxy.meanSpo2,
    hypoxicBurden: oxy.hypoxicBurden, meanHr: oxy.meanHr, nsi: oxy.nsi
  };
}

/* ════════════════ AUTONOMIC CORROBORATION (ECGDex) ════════════════ */
function autonomicCorroboration(night){
  var ecg = ecgForNight(night);
  if (!ecg) return null;
  // scored apneas (from all sessions) with absolute tMs that fall inside the ECG window
  var apneas = [];
  (night.sessions || []).forEach(function (s){
    (s.events || []).forEach(function (ev){
      if (ev.type === 'RE') return;                 // AHI events only
      var tMs = ev.tMs != null ? ev.tMs : (s.t0Ms + (ev.timeSec || 0) * 1000);
      if (ecg.t0Ms != null && (ecg.endMs == null || (tMs >= ecg.t0Ms - 60000 && tMs <= ecg.endMs + 60000))) apneas.push(tMs);
    });
  });
  // each apnea corroborated if an ECG autonomic surge sits within [-LEAD, +TRAIL] s
  var matched = 0;
  apneas.forEach(function (aMs){
    var hit = ecg.surges.some(function (sMs){ var d = (sMs - aMs) / 1000; return d >= -LEAD && d <= TRAIL; });
    if (hit) matched++;
  });
  var corroboratedPct = apneas.length ? +(matched / apneas.length * 100).toFixed(0) : null;
  var plvDrop = (ecg.plvBaseline != null && ecg.plvDuringSurges != null)
    ? +((ecg.plvBaseline - ecg.plvDuringSurges)).toFixed(3) : null;
  return {
    source: 'ECGDex', overlapPct: _overlapPct(_nightWindow(night), ecg),
    apneasInWindow: apneas.length, surges: ecg.surges.length, matched: matched, corroboratedPct: corroboratedPct,
    cvhrIndex: ecg.cvhrIndex, cvhrEvents: ecg.cvhrEvents, estAHI: ecg.estAHI, estAHIband: ecg.estAHIband, riskCategory: ecg.riskCategory,
    rmssd: ecg.rmssd, sdnn: ecg.sdnn, hr: ecg.hr, ansAge: ecg.ansAge,
    respRateSd: ecg.respRateSd, respRateMedian: ecg.respRateMedian,
    plvBaseline: ecg.plvBaseline, plvDuringSurges: ecg.plvDuringSurges, plvDrop: plvDrop
  };
}

/* combined cross-node summary for render + export (null if no peer paired). */
function crossNode(night){
  var oxi = borrowedOximetry(night), aut = autonomicCorroboration(night);
  if (!oxi && !aut) return null;
  // real AHI↔ODI concordance from borrowed oximetry (when native SA2 absent)
  var ahi = night.metrics ? night.metrics.residualAHI : null, concordance = null, concNote = null;
  if (oxi && oxi.odi != null && ahi != null){
    var ratio = oxi.odi > 0 ? ahi / oxi.odi : (ahi > 0 ? Infinity : 1);
    if (ratio >= 0.7 && ratio <= 1.5){ concordance = 'concordant'; concNote = 'scored apneas track the borrowed desaturations — coherent obstructive picture'; }
    else if (ratio > 1.5){ concordance = 'ahi-led'; concNote = 'AHI exceeds external ODI — events without deep desats (central / brief / well-oxygenated)'; }
    else { concordance = 'odi-led'; concNote = 'external desats exceed scored apneas — non-apneic hypoxemia or leak-masked scoring'; }
  }
  return { oximetry: oxi, autonomic: aut, ahi: ahi, concordance: concordance, concordanceNote: concNote };
}

global.CpapCoimport = {
  LEAD: LEAD, TRAIL: TRAIL,
  detectNodeExport: detectNodeExport, normalizeOxy: normalizeOxy, normalizeEcg: normalizeEcg,
  ingest: ingest, reset: reset, peers: peers,
  oxyForNight: oxyForNight, ecgForNight: ecgForNight,
  borrowedOximetry: borrowedOximetry, autonomicCorroboration: autonomicCorroboration, crossNode: crossNode
};

})(window);
