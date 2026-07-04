/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   CPAPDex · FUSION — Ganglior events + node-export + cross-metrics + table
   (cpapdex-fusion.js)   — loaded after cpapdex-render.js, before cpapdex-app.js
   ────────────────────────────────────────────────────────────────────────
   Clones oxydex-fusion.js's role for CPAP:
     • cpapEvents(night)        → ganglior_events[]  (apnea/hypopnea/periodic_
                                   breathing/desat/large_leak), device-scored
                                   EVE apneas are the TOP apnea tier (§6 #4).
     • cpapBuildExport(night)   → schema.name:"ganglior.node-export"
     • cpapCrossMetrics(night)  → AHI↔ODI concordance + leak↔AHI ("treat the leak")
     • cpapFullMetricsTable(n)  → 6-col METRIC·VALUE·UNIT·NORMAL·STATUS·NOTES
                                   with evidence badges (CpapRegistry.evBadge).

   CLOCK CONTRACT: event `t` is a wall-clock "HH:MM:SS" string with NO date
   (the cross-node currency), reconstructed from startEpochMs's date rolling
   past midnight; each event ALSO carries absolute floating `tMs`. All clock
   read-back is getUTC* only (viewer-timezone-independent).

   FUSION GATE (R4): the apnea↔desat match window LEAD=15 / TRAIL=60 s is
   duplicated in oxydex-fusion.js + integrator-dsp.js and MUST stay identical.
   CPAPDex adds a SOURCE CLASS (device-scored) to this gate; it does NOT change
   the numbers. R7: conf = severity, sqi = leak-quality, kept on a SEPARATE axis.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';

var LEAD = 15, TRAIL = 60;                  // R4 — identical to oxydex-fusion.js / integrator-dsp.js
var LARGE_LEAK_LPM = 24;                    // ResMed large-leak validity threshold (L/min)

function _p2(n){ return (n < 10 ? '0' : '') + n; }
/* "HH:MM:SS" wall-clock (no date) from floating tMs — getUTC* only */
function fmtClockHMS(ms){
  if (ms == null || !isFinite(ms)) return null;
  var d = new Date(ms);
  return _p2(d.getUTCHours()) + ':' + _p2(d.getUTCMinutes()) + ':' + _p2(d.getUTCSeconds());
}
function _esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ── conf per device-scored event (R7 — likelihood/severity, NOT quality) ──
   Device firmware already decided it's an event (it's scored airflow), so the
   floor is high; longer apneas score harder. central > obstructive weighting
   for clinical attention. sqi is the SEPARATE quality axis (session leak). */
function _eventConf(type, durSec){
  var base = type === 'CA' ? 0.9 : type === 'OA' ? 0.85 : type === 'H' ? 0.7 : 0.55;
  var durBoost = Math.min(0.1, (durSec || 0) / 300);    // +0.1 max at ≥30 s
  return +Math.min(0.98, base + durBoost).toFixed(2);
}
function _impulseFor(type){
  return type === 'H' ? 'hypopnea' : (type === 'RE' ? 'rera' : 'apnea');
}
function _classFor(type){
  return type === 'OA' ? 'obstructive' : type === 'CA' ? 'central' : type === 'H' ? 'hypopnea' : 'rera';
}

/* ════════════════════════════════════════════════════════════════════════
   EVENT EMISSION — one ganglior event per device-scored EVE event, plus CSL
   periodic-breathing spans, self-gated SA2 desats, and large-leak excursions.
   ════════════════════════════════════════════════════════════════════════ */
function cpapEvents(night){
  if (!night || !night.sessions) return [];
  var out = [];
  night.sessions.forEach(function (s){
    var sqi = (s.sqi != null ? s.sqi : 1);
    // ── device-scored apnea / hypopnea / RERA (TOP apnea tier) ──
    (s.events || []).forEach(function (ev){
      var tMs = (ev.tMs != null) ? ev.tMs : (s.t0Ms + (ev.timeSec || 0) * 1000);
      out.push({
        t: fmtClockHMS(tMs), tMs: tMs,
        impulse: _impulseFor(ev.type),
        node: 'CPAPDex',
        conf: _eventConf(ev.type, ev.durSec),
        sqi: +sqi.toFixed(2),
        meta: { class: _classFor(ev.type), durSec: ev.durSec || 0, source: 'device-scored' }
      });
    });
    // ── periodic breathing (CSL spans) — one event marking the night's PB burden ──
    if (s.pbSec && s.pbSec > 0){
      out.push({
        t: fmtClockHMS(s.t0Ms), tMs: s.t0Ms,
        impulse: 'periodic_breathing', node: 'CPAPDex',
        conf: 0.8, sqi: +sqi.toFixed(2),
        meta: { totalSec: Math.round(s.pbSec), pct: s.metrics ? s.metrics.periodicBreathingPct : null, source: 'device-scored' }
      });
    }
    // ── SA2 desats (only the ones NOT self-gated as artifact) ──
    var oxi = s.oximetry;
    if (oxi && oxi.available && oxi.events){
      oxi.events.forEach(function (d){
        if (d.artifact) return;                            // §4.4 — never emit a squeeze
        var tMs = s.t0Ms + (d.nadirIdx != null ? d.nadirIdx : d.startIdx) * 1000;  // 1 Hz
        out.push({
          t: fmtClockHMS(tMs), tMs: tMs,
          impulse: 'desat_event', node: 'CPAPDex',          // EVENT-LEXICON §1 canonical (was 'desat'; OXYDEX-...-FOLLOWUPS-II §1)
          conf: +Math.min(0.95, 0.5 + (d.depth || 0) / 20).toFixed(2),
          sqi: +(d.sqi != null ? d.sqi : sqi).toFixed(2),
          meta: { depthPct: d.depth, durSec: d.duration, nadir: d.nadir, source: 'sa2-oximeter', selfGated: false }
        });
      });
    }
    // ── large-leak excursion (context for other nodes; not an apnea) ──
    var m = s.metrics || {};
    if (m.largeLeakPct != null && m.largeLeakPct > 1){
      out.push({
        t: fmtClockHMS(s.t0Ms), tMs: s.t0Ms,
        impulse: 'large_leak', node: 'CPAPDex',
        conf: +Math.min(0.95, m.largeLeakPct / 100 + 0.3).toFixed(2),
        sqi: +sqi.toFixed(2),
        meta: { pctNight: m.largeLeakPct, p95Lpm: m.p95Leak, maxLpm: m.maxLeak, thresholdLpm: LARGE_LEAK_LPM, source: 'leak-channel' }
      });
    }
  });
  out.sort(function (a, b){ return (a.tMs || 0) - (b.tMs || 0); });
  return out;
}

/* ════════════════════════════════════════════════════════════════════════
   CROSS-METRICS — AHI↔ODI concordance + leak↔AHI ("treat the leak")
   ════════════════════════════════════════════════════════════════════════ */
function cpapCrossMetrics(night){
  if (!night) return null;
  var nm = night.metrics || {};
  var ahi = nm.residualAHI;
  // pool oximetry across sessions that had a live lane
  var oxiSessions = (night.sessions || []).filter(function (s){ return s.oximetry && s.oximetry.available; });
  var odi = null, t90 = null, oxiAvailable = oxiSessions.length > 0;
  if (oxiAvailable){
    var odiSum = 0, t90Sum = 0;
    oxiSessions.forEach(function (s){ odiSum += (s.oximetry.odi || 0); t90Sum += (s.oximetry.t90Pct || 0); });
    odi = +(odiSum / oxiSessions.length).toFixed(2);
    t90 = +(t90Sum / oxiSessions.length).toFixed(2);
  }
  // AHI↔ODI concordance: do scored apneas line up with desats?
  var concordance = null, concordanceNote = null;
  if (oxiAvailable && ahi != null && odi != null){
    var ratio = odi > 0 ? ahi / odi : (ahi > 0 ? Infinity : 1);
    if (ratio >= 0.7 && ratio <= 1.5){ concordance = 'concordant'; concordanceNote = 'scored apneas track desaturations — coherent obstructive picture'; }
    else if (ratio > 1.5){ concordance = 'ahi-led'; concordanceNote = 'AHI exceeds ODI — events without deep desats (central / brief / well-oxygenated)'; }
    else { concordance = 'odi-led'; concordanceNote = 'desats exceed scored apneas — possible flow-limit / non-apneic hypoxemia, or a leak masking scoring'; }
  } else if (!oxiAvailable){
    concordanceNote = 'no oximeter this night — AHI stands on the airflow scoring alone';
  }
  // leak↔AHI: does residual AHI rise when leak is high → "treat the leak"
  var leakImpact = null, leakNote = null;
  var largeLeak = nm.largeLeakPct;
  if (largeLeak != null && ahi != null){
    if (largeLeak > 10 && ahi >= 5){ leakImpact = 'leak-confounded'; leakNote = 'high leak + elevated residual AHI — the leak likely corrupts scoring; treat the seal before titrating pressure'; }
    else if (largeLeak > 10){ leakImpact = 'leak-high-ahi-ok'; leakNote = 'high leak but residual AHI controlled — watch the seal, therapy still effective'; }
    else { leakImpact = 'leak-ok'; leakNote = 'leak within validity threshold — AHI is trustworthy'; }
  }
  return {
    ahi: ahi, odi: odi, t90: t90, oximetryAvailable: oxiAvailable,
    concordance: concordance, concordanceNote: concordanceNote,
    leakImpact: leakImpact, leakNote: leakNote, largeLeakPct: largeLeak
  };
}

/* ════════════════════════════════════════════════════════════════════════
   NODE EXPORT — schema.name:"ganglior.node-export"
   ════════════════════════════════════════════════════════════════════════ */
function cpapBuildExport(night){
  if (!night) return null;
  var events = cpapEvents(night);
  var cross = cpapCrossMetrics(night);
  var D = global.CpapDsp;
  return {
    // P8/kernel: stamp THIS build's physiology-kernel hash so the Integrator's
    // kernel audit can detect a CPAPDex built against a different rulebook.
    kernel: (global.DexKernel ? { version: global.DexKernel.VERSION, hash: global.DexKernel.HASH } : null),
    schema: {
      name: 'ganglior.node-export', version: '2.0', node: 'CPAPDex', nodeVersion: '1.0',
      generated: new Date().toISOString(),
      provenance: (global.GangliorProvenance ? global.GangliorProvenance.stamp() : null),  // R1
      doc: 'Single-signal PAP-therapy analyzer export. All metrics computed in-browser from the AirSense EDF set only (nothing leaves the device). Device-scored EVE/CSL events are the top apnea tier. SA2 oximetry is a self-gated QC lane — artifact desats are excluded and never emitted. null = not present/computed at this quality. Event `t` is wall-clock HH:MM:SS (no date); `tMs` is absolute floating ms.',
      units: { pressure: 'cmH2O', leak: 'L/min', ahi: '/hr', odi: '/hr', respRate: '/min', tidVol: 'L', minVent: 'L/min', spo2: '%', pulse: 'bpm', time: 'min', conf: '0..1', sqi: '0..1' }
    },
    recording: {
      source: 'ResMed AirSense 11 (EDF set)',
      // EXPORT-IDENTITY §2.1 / -FOLLOWUPS-II §1: identity-free contentId (signal-frame.js bundled into
      // CPAPDex). The raw 25 Hz flow is not retained on `night`, so this folds the per-session structural
      // signature (floating t0Ms / durations / usage / EDF record counts / mode) + the night anchor —
      // deterministic, identity-free (source is a generic device family, no serial), single-sourced here
      // (both cpapdex-app.js exportNight + headless CPAPDex.compute reach this builder; the multi-night
      // wrapper maps it per night, so each night element carries its own contentId).
      contentId: ((typeof SignalFrame!=='undefined' && SignalFrame && SignalFrame.computeContentId && (night.sessions||[]).length) ? SignalFrame.computeContentId({ signalType:'flow', kind:'samples', samples:(night.sessions||[]).map(function(s){ return {t:s.t0Ms, dur:s.durMin, usage:s.usageHours, rec:s.recordsRead, num:s.numRecords, mode:s.mode}; }), t0Ms:(night.t0Ms!=null?night.t0Ms:null), usable:true }) : null),
      startEpochMs: night.t0Ms,                              // floating t0Ms (first session)
      dateAnchorMs: night.dateAnchorMs, offsetMin: null,     // EDF carries no zone
      therapyHours: night.therapyHours, sessionCount: night.nSessions,
      sessions: (night.sessions || []).map(function (s, i){
        return { idx: i, startEpochMs: s.t0Ms, durMin: s.durMin, usageHours: s.usageHours, mode: s.mode,
                 truncated: s.truncated, recordsRead: s.recordsRead, numRecords: s.numRecords,
                 oximeter: s.oximetry && s.oximetry.available ? 'connected' : (s.oximetry ? s.oximetry.reason : 'absent') };
      }),
      offMaskGaps: (night.offMaskGaps || []).map(function (g){ return { afterSession: g.afterIdx, gapMin: g.gapMin }; })
    },
    metrics: night.metrics || null,
    crossMetrics: cross,
    oximetry: (night.sessions || []).map(function (s, i){
      var o = s.oximetry || {};
      return { session: i, available: !!o.available, reason: o.reason || null, coverage: o.coverage != null ? o.coverage : null,
               odi: o.odi != null ? o.odi : null, t90Pct: o.t90Pct != null ? o.t90Pct : null,
               spo2Nadir: o.spo2Nadir != null ? o.spo2Nadir : null, spo2Mean: o.spo2Mean != null ? o.spo2Mean : null,
               desatCount: o.desatCount != null ? o.desatCount : null, artifactCount: o.artifactCount != null ? o.artifactCount : null,
               selfGate: 'active' };
    }),
    quality: {
      sqi: (night.sessions || []).length ? +(night.sessions.reduce(function (a, s){ return a + (s.sqi != null ? s.sqi : 1); }, 0) / night.sessions.length).toFixed(3) : null,
      sqiBasis: 'leak-quality (1 − largeLeakFraction) — R7 separate from conf',
      lowUsage: night.therapyHours != null && night.therapyHours < 2,
      truncatedSessions: (night.sessions || []).filter(function (s){ return s.truncated; }).length
    },
    ganglior_events: events,
    crossNode: (global.CpapCoimport ? (function (){
      var cn = global.CpapCoimport.crossNode(night);
      if (!cn) return null;
      // DESCRIPTIVE only — borrowed peer data is source-attributed and NEVER
      // re-emitted as CPAPDex ganglior_events, so the Integrator (which ingests
      // OxyDex/ECGDex directly) does not double-count.
      return {
        doc: 'Optional corroboration from peer node-exports the user dropped in. Source-attributed; not part of CPAPDex ganglior_events.',
        borrowedOximetry: cn.oximetry || null,
        autonomicCorroboration: cn.autonomic || null,
        ahiOdiConcordance: cn.concordance || null, ahiOdiNote: cn.concordanceNote || null
      };
    })() : null),
    reserved: {
      doc: 'Slots awaiting Integrator fusion; null until paired.',
      ahiOdiConcordance: cross ? cross.concordance : null,
      oximetrySource: 'CPAPDex-SA2 (peer of O2Ring)',
      apneaAuthority: 'device-scored (top tier)'
    },
    fmtVersion: D ? 'CpapDsp' : null
  };
}

/* ════════════════════════════════════════════════════════════════════════
   MULTI-NIGHT NODE EXPORT — ≥3 nights wrapped in a ganglior.crossnight v1.0
   aggregate header (CPAPDEX-PHASE9-FOLLOWUPS-IV §2). cpapdex-app.js exportNight
   DELEGATES here so the gate exercises the SAME builder the app runs (retiring
   the -III in-test reconstruction + source-pin). Globals (DexKernel /
   GangliorProvenance / CPAPCross) read at CALL time, as exportNight did; the
   app guard (chrono.length>=3 && CPAPCross && CrossNightEnvelope) still fronts it.
   ════════════════════════════════════════════════════════════════════════ */
function cpapBuildMultiNightExport(chrono){
  if (!chrono || !chrono.length) return null;
  return {
    kernel: (global.DexKernel ? { version: global.DexKernel.VERSION, hash: global.DexKernel.HASH } : null),
    schema: {
      name: 'ganglior.node-export', version: '2.0', node: 'CPAPDex', nodeVersion: '1.0', multiNight: true,
      generated: new Date().toISOString(),
      provenance: (global.GangliorProvenance ? global.GangliorProvenance.stamp() : null),
      doc: 'Array of per-night CPAPDex node-exports (each unchanged) + a ganglior.crossnight v1.0 aggregate header.'
    },
    generated: new Date().toISOString(), nightCount: chrono.length,
    crossNight: global.CPAPCross.crossNightBlock(chrono),
    nights: chrono.map(function (n){ return cpapBuildExport(n); })
  };
}

/* ════════════════════════════════════════════════════════════════════════
   FULL METRICS TABLE — 6 columns, evidence badge leads the metric-name cell
   ════════════════════════════════════════════════════════════════════════ */
function _sev(good, warn, val, lowerBetter){
  if (val == null || !isFinite(val)) return '';
  if (lowerBetter) return val <= good ? 'ok' : val <= warn ? 'warn' : 'bad';
  return val >= good ? 'ok' : val >= warn ? 'warn' : 'bad';
}
function _fmt(v, dec){
  if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) return '—';
  if (typeof v === 'number') return dec != null ? (+v).toFixed(dec) : String(v);
  return String(v);
}
function cpapFullMetricsTable(night){
  if (!night) return '';
  var nm = night.metrics || {};
  var s0 = (night.sessions && night.sessions[0]) || {};
  var m = s0.metrics || {};
  var cross = cpapCrossMetrics(night);
  var rows = [];
  var sec = function (t){ rows.push({ sec: t }); };
  // id is the registry id so evBadge resolves the evidence dot
  var r = function (id, label, v, unit, normal, st, note){ rows.push({ id: id, m: label, v: v, u: unit || '', nm: normal || '—', st: st || '', note: note || '' }); };

  sec('Recording');
  r(null, 'Source', 'ResMed AirSense 11 (EDF)', '', '—', '', 'BRP 25 Hz · PLD 0.5 Hz · SA2 1 Hz · EVE/CSL annotations');
  r(null, 'Night start', global.CpapDsp ? global.CpapDsp.fmtDateTime(night.t0Ms) : night.t0Ms, '', '—', '', 'Floating wall-clock (viewer-tz-independent)');
  r(null, 'Sessions', night.nSessions, '', '—', '', (night.offMaskGaps && night.offMaskGaps.length ? night.offMaskGaps.length + ' off-mask gap(s)' : 'single session'));
  r('usageHours', 'Therapy hours', _fmt(night.therapyHours, 2), 'hr', '≥4', _sev(4, 2, night.therapyHours), 'Total mask-on time across sessions');

  sec('Residual Events (device-scored EVE — top tier)');
  r('residualAHI', 'Residual AHI', _fmt(nm.residualAHI, 2), '/hr', '<5', _sev(5, 15, nm.residualAHI, true), 'AirSense firmware-scored apneas+hypopneas / therapy hr');
  r('obstructiveIndex', 'Obstructive Index', _fmt(nm.obstructiveIndex, 2), '/hr', '<5', _sev(5, 15, nm.obstructiveIndex, true), 'OA / hr');
  r('centralIndex', 'Central Apnea Index', _fmt(nm.centralIndex, 2), '/hr', '<5', _sev(5, 10, nm.centralIndex, true), 'CA / hr');
  r('hypopneaIndex', 'Hypopnea Index', _fmt(nm.hypopneaIndex, 2), '/hr', '<5', _sev(5, 15, nm.hypopneaIndex, true), 'H / hr');
  r('reraIndex', 'RERA Index', _fmt(nm.reraIndex, 2), '/hr', '<5', _sev(5, 15, nm.reraIndex, true), 'Respiratory-effort arousals / hr');
  r('periodicBreathingPct', 'Periodic Breathing', _fmt(nm.periodicBreathingPct, 2), '%', '<2', _sev(2, 10, nm.periodicBreathingPct, true), '% therapy in CSL Cheyne-Stokes/PB spans');

  sec('Pressure');
  r('medianPressure', 'Median Pressure', _fmt(nm.medianPressure, 1), 'cmH₂O', '—', '', 'P50 delivered (mask-on) · mode ' + (s0.mode || '—'));
  r('p95Pressure', '95th-%ile Pressure', _fmt(nm.p95Pressure, 1), 'cmH₂O', '—', '', 'P95 delivered');
  r('pressureRange', 'Pressure Range (IQR)', _fmt(nm.pressureRange, 1), 'cmH₂O', '—', '', 'Auto-titration spread (>1 ⇒ APAP)');
  r('eprDelta', 'EPR Delta', _fmt(m.eprDelta, 1), 'cmH₂O', '—', '', 'Median expiratory pressure relief (session 1)');

  sec('Leak');
  r('medianLeak', 'Median Leak', _fmt(nm.medianLeak, 1), 'L/min', '<24', _sev(12, 24, nm.medianLeak, true), 'P50 mask leak (L/s→L/min)');
  r('p95Leak', '95th-%ile Leak', _fmt(nm.p95Leak, 1), 'L/min', '<24', _sev(18, 24, nm.p95Leak, true), 'P95 mask leak');
  r('largeLeakPct', 'Large Leak %', _fmt(nm.largeLeakPct, 2), '%', '<5', _sev(2, 5, nm.largeLeakPct, true), '% therapy >24 L/min (ResMed validity)');
  r('leakCV', 'Leak CV', _fmt(nm.leakCV, 1), '%', '—', '', 'Seal stability (SD/mean)');

  sec('Ventilation & Flow');
  r('respRateMedian', 'Resp Rate', _fmt(m.respRateMedian, 1), '/min', '12–20', _sev(20, 24, m.respRateMedian, true), 'Device P50 respiratory rate');
  r('breathRate', 'Breath Rate (flow-derived)', _fmt(m.breathRate, 1), '/min', '12–20', '', 'Zero-crossing on 25 Hz flow — cross-checks device RR');
  r('ieRatio', 'I:E Ratio', _fmt(m.ieRatio, 2), '', '—', '', 'Inspiratory/expiratory flow-time ratio');
  r('tidVolMedian', 'Tidal Volume', _fmt(m.tidVolMedian, 2), 'L', '0.3–0.6', '', 'Device P50 tidal volume');
  r('minVentMedian', 'Minute Ventilation', _fmt(m.minVentMedian, 1), 'L/min', '4–8', '', 'Device P50 minute ventilation');
  r('flowLimitedPct', 'Flow-Limited %', _fmt(m.flowLimitedPct, 1), '%', '<10', _sev(10, 25, m.flowLimitedPct, true), '% therapy with flow-limitation >0.3');
  r('snorePct', 'Snore %', _fmt(m.snorePct, 1), '%', '<5', _sev(5, 15, m.snorePct, true), '% therapy with snore index >0.2');

  // ── Oximetry QC lane (only when an oximeter was connected) ──
  if (cross && cross.oximetryAvailable){
    sec('Oximetry QC Lane (SA2 · self-gated)');
    r('odi', 'ODI (3%)', _fmt(cross.odi, 2), '/hr', '<5', _sev(5, 15, cross.odi, true), 'Self-gated desaturation index — squeeze artifacts excluded');
    r('t90Pct', 'T90', _fmt(cross.t90, 2), '%', '<1', _sev(1, 5, cross.t90, true), '% valid SpO₂ below 90%');
    var oxiS = (night.sessions || []).filter(function (s){ return s.oximetry && s.oximetry.available; })[0];
    if (oxiS){
      r('spo2Nadir', 'SpO₂ Nadir', _fmt(oxiS.oximetry.spo2Nadir), '%', '≥88', _sev(90, 85, oxiS.oximetry.spo2Nadir), 'Lowest valid SpO₂');
      r('spo2Mean', 'Mean SpO₂', _fmt(oxiS.oximetry.spo2Mean, 1), '%', '≥94', _sev(94, 92, oxiS.oximetry.spo2Mean), 'Mean valid SpO₂');
      r(null, 'Artifact desats', _fmt(oxiS.oximetry.artifactCount), '', '—', '', 'Self-gated out of ODI (perfusion/kinetics)');
    }
  } else {
    sec('Oximetry QC Lane (SA2)');
    r(null, 'Oximeter', 'not connected', '', '—', '', 'No SpO₂ accessory this night — ODI/T90 n/a (not fabricated)');
  }

  // ── render ──
  var pill = function (st){
    if (st === 'ok') return '<span class="pill pill-green">OK</span>';
    if (st === 'warn') return '<span class="pill pill-yellow">WATCH</span>';
    if (st === 'bad') return '<span class="pill pill-red">FLAG</span>';
    return '<span style="color:var(--text4)">—</span>';
  };
  var evBadge = (global.CpapRegistry && global.CpapRegistry.evBadge) ? global.CpapRegistry.evBadge : function(){ return ''; };
  var body = '';
  rows.forEach(function (row){
    if (row.sec){ body += '<tr class="fmt-sec"><td colspan="6">' + _esc(row.sec) + '</td></tr>'; return; }
    body += '<tr>'
      + '<td class="fmt-m">' + (row.id ? evBadge(row.id) : '') + _esc(String(row.m)) + '</td>'
      + '<td class="fmt-v">' + (typeof row.v === 'string' && row.v.indexOf('<') >= 0 ? row.v : _esc(String(row.v))) + '</td>'
      + '<td>' + _esc(String(row.u)) + '</td>'
      + '<td>' + _esc(String(row.nm)) + '</td>'
      + '<td>' + pill(row.st) + '</td>'
      + '<td class="fmt-note">' + _esc(String(row.note)) + '</td>'
      + '</tr>';
  });
  return '<div class="table-wrap cpap-fulltable"><table><thead><tr>'
    + '<th>Metric</th><th>Value</th><th>Unit</th><th>Normal Range</th><th>Status</th><th>Notes</th>'
    + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}

/* ════════════════════════════════════════════════════════════════════════
   SELF-INGEST — reload CPAPDex's OWN export as a REVIEW-MODE clinical view
   (SELF-INGEST-FOLLOWUPS-2026-07-03-BRIEF · CPAPDex pass; pattern: OxyDex pilot)
   ────────────────────────────────────────────────────────────────────────
   Drop CPAPDex's own ganglior.node-export back into CPAPDex to get a faithful,
   print/PDF-able CLINICAL SUMMARY (findings · KPIs · badged event timeline ·
   provenance) to bring to a clinician WITHOUT the raw EDF set — showing what was
   computed AT EXPORT TIME, never recomputing, re-grading, or re-stamping.

   The CPAPDex export carries a RICH per-night derived layer (metrics · oximetry[]
   · quality · ganglior_events[]) but NOT the raw 25 Hz flow / 0.5 Hz pressure /
   leak waveforms — so the review renders the stored values verbatim and GREYS the
   per-session waveform panels (never fabricates a curve). No night reconstruction:
   the review reads each export element's stored fields directly (SELF-INGEST §1
   step 4 — no recompute).

   PURE + DOM-FREE: returns a structured result; the app glue (handleFileList →
   renderReview) sets window._cpapReview, paints the banner + clinical summary +
   greyed panels. This path must NEVER call GangliorProvenance.stamp() — a reload
   is a VIEW of a past computation, stamped with the build that MADE it (§3).

   Carrier: multi-night = json.nights[] (each a full cpapBuildExport element);
   single-night = the object itself (has recording + metrics, no nights[]). A
   FOREIGN export (schema.node !== CPAPDex) is REJECTED with a redirect message —
   the app routes OxyDex/ECGDex exports to CpapCoimport (corroboration) instead.
   ════════════════════════════════════════════════════════════════════════ */
function cpapLoadOwnExport(json){
  // 1 · detect — a ganglior.node-export at all?
  if (!(json && json.schema && json.schema.name === 'ganglior.node-export'))
    return { ok:false, reason:'not-node-export',
      message:'Not a node-export \u2014 drop your AirSense .edf set, or CPAPDex\u2019s own .json export.' };
  // 2 · guard — a node only re-ingests its OWN kind. A foreign export is REJECTED with a redirect
  //     message (mirrors the pilot); the app sends OxyDex/ECGDex exports to CpapCoimport, not here.
  var node = ((json.schema.node || '') + '').trim();
  if (node !== 'CPAPDex')
    return { ok:false, reason:'foreign-node', node:node,
      message:'This is a ' + (node || 'non-CPAPDex') + ' export \u2014 open it in ' + (node || 'its own node')
        + ', or drop it into the Integrator to fuse. (In CPAPDex an OxyDex/ECGDex export is borrowed as corroboration alongside your .edf set.)' };
  // 3 · unwrap → per-night export elements (single-night = the object itself). Each element is an
  //     unchanged cpapBuildExport tree; the review renders its STORED values verbatim (no recompute).
  var carrier = Array.isArray(json.nights) ? json.nights.slice()
              : ((json.recording && (json.metrics || json.oximetry)) ? [json] : []);
  // gather events across elements (single-night: json IS carrier[0], so its ganglior_events ride along),
  // chronological + monotonic by tMs (Clock Contract) for the clinical timeline.
  var events = [];
  carrier.forEach(function (el){ if (el && Array.isArray(el.ganglior_events)) events = events.concat(el.ganglior_events); });
  events.sort(function (a, b){ return ((a && a.tMs) || 0) - ((b && b.tMs) || 0); });
  // mark review-mode on each element (the renderer greys raw-only panels; nothing here recomputes).
  carrier.forEach(function (el){ if (el){ el._reviewMode = true; el._fromExport = true; } });
  // 4 · preserve provenance / kernel / events / crossNight VERBATIM — the view's provenance IS the
  //     export's; the current build's stamp must NOT be written over it (no GangliorProvenance.stamp()).
  return {
    ok:true, reviewMode:true, node:node,
    elements: carrier,
    events: events,
    provenance: (json.schema && json.schema.provenance) || null,
    generated:  (json.schema && json.schema.generated)  || null,
    derivedFrom:(json.schema && json.schema.derivedFrom) || null,
    kernel:     json.kernel || null,
    crossNight: json.crossNight || null,
    multiNight: carrier.length > 1 || !!(json.schema && json.schema.multiNight),
    scrubbed:  !!(json.schema && json.schema.scrubbed),
    raw: json
  };
}

global.CpapFusion = {
  LEAD: LEAD, TRAIL: TRAIL, LARGE_LEAK_LPM: LARGE_LEAK_LPM,
  fmtClockHMS: fmtClockHMS,
  cpapEvents: cpapEvents, cpapCrossMetrics: cpapCrossMetrics,
  cpapBuildExport: cpapBuildExport, cpapBuildMultiNightExport: cpapBuildMultiNightExport,
  cpapFullMetricsTable: cpapFullMetricsTable,
  // SELF-INGEST (SELF-INGEST-FOLLOWUPS-2026-07-03): the pure self-reload surface, exposed on the
  // namespace so BOTH the app (handleFileList routing) and the test runners reach the SAME function.
  cpapLoadOwnExport: cpapLoadOwnExport
};

})(window);
