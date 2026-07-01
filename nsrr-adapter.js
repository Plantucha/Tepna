/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   nsrr-adapter.js — bridge real PSG datasets (NSRR: SHHS / MESA / MrOS / CHAT …)
   into the REAL OxyDex pipeline for the ODI-4-vs-AHI bias analysis.
   ----------------------------------------------------------------------------
   100% local. The user supplies the files (NSRR/PhysioNet require a signed DUA —
   they are NOT bundled and cannot be fetched here). For each record the harness
   pairs an EDF (the SpO₂ signal) with its NSRR annotation XML (scored respiratory
   events + sleep staging → reference AHI), runs the REAL OxyDex `processNight`,
   and returns { odi4, ahiOxyEst, scoredAHI, … } for the regression/Bland-Altman.

   Reuses window.CpapEdf.readEDF (the suite's existing EDF reader) and OxyDex's
   real DSP — no second copy of either. Clock Contract honored: EDF clock → floating
   t0Ms; rows are t0Ms + i·1000.

   Exposes window.NSRR.
   ════════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  // SpO₂ channel labels seen across NSRR cohorts (case-insensitive contains)
  var SPO2_LABELS = ['spo2', 'sao2', 'osat', 'sat'];
  var HR_LABELS   = ['pulse', 'heart rate', 'hr', 'pr'];

  function findSignal(signals, names) {
    var keys = Object.keys(signals);
    for (var i = 0; i < keys.length; i++) {
      var lk = keys[i].toLowerCase().replace(/[^a-z0-9]/g, '');
      for (var j = 0; j < names.length; j++) { if (lk.indexOf(names[j].replace(/[^a-z0-9]/g, '')) >= 0) return keys[i]; }
    }
    return null;
  }

  // Resample a signal (any fs) to 1 Hz by nearest-sample, forward-filling physiologic-
  // invalid samples (sensor dropouts) with the last valid value so the 1 Hz trace stays
  // continuous and monotonic (what OxyDex's ODI detector expects). Leading invalids seed
  // from the first valid sample (or a 97% baseline if the whole channel is junk).
  function to1Hz(sig, validLo, validHi) {
    var fs = sig.fs || 1, n = sig.data.length;
    var durSec = Math.floor(n / fs);
    var out = new Float32Array(durSec);
    var last = null;
    for (var s = 0; s < durSec; s++) {
      var v = sig.data[Math.floor(s * fs)];
      if (v >= validLo && v <= validHi) last = v;
      out[s] = (last != null) ? last : NaN;
    }
    // backfill any leading NaNs from the first valid value
    var firstValid = null;
    for (var i = 0; i < durSec; i++) { if (!isNaN(out[i])) { firstValid = out[i]; break; } }
    if (firstValid == null) firstValid = (validLo === 40 ? 97 : 60);   // whole channel junk → baseline
    for (var j = 0; j < durSec && isNaN(out[j]); j++) out[j] = firstValid;
    return out;
  }

  /* EDF → OxyDex rows. Returns { rows, t0Ms, durSec, spo2Pct, hadHR } | null. */
  function edfToOxyRows(edf) {
    if (!edf || !edf.signals) return null;
    var spo2Key = findSignal(edf.signals, SPO2_LABELS);
    if (!spo2Key) return null;
    var spo2 = to1Hz(edf.signals[spo2Key], 40, 100);     // <40% or >100% = artifact
    var hrKey = findSignal(edf.signals, HR_LABELS);
    var hr = hrKey ? to1Hz(edf.signals[hrKey], 20, 240) : null;
    var t0Ms = (edf.clock && edf.clock.t0Ms != null) ? edf.clock.t0Ms : Date.UTC(2020, 0, 1, 22, 0, 0);
    var rows = [];
    for (var i = 0; i < spo2.length; i++) {
      var tMs = t0Ms + i * 1000;
      // canonical OxyDex row: .tMs float + .t Date (read via getUTC*); round SpO₂ to int like a real oximeter
      rows.push({ tMs: tMs, t: new Date(tMs), spo2: Math.round(spo2[i]), hr: hr ? Math.round(hr[i]) : 0, motion: 0 });
    }
    return { rows: rows, t0Ms: t0Ms, durSec: spo2.length, spo2Label: spo2Key, hadHR: !!hr };
  }

  // Respiratory-event concepts in NSRR XML EventConcept text (apnea + hypopnea).
  var RESP_RE = /apnea|hypopnea|hypopnoea|apnoea/i;
  var APNEA_RE = /(obstructive|central|mixed).*apnea|apnea/i;
  var HYPOP_RE = /hypopnea|hypopnoea/i;
  // sleep-stage concepts → count non-Wake epochs for total sleep time
  var STAGE_RE = /(stage|sleep)/i;
  var WAKE_RE  = /wake|stage 0|^0$|\|0\b/i;

  /* Parse an NSRR profusion-style annotation XML → { scoredAHI, tstHours, nApnea, nHypop, events:[{tMs?,sec,kind}] }.
     Robust to the two common shapes: <ScoredEvents><ScoredEvent><EventConcept>…</EventConcept>
     <Start>…</Start><Duration>…</Duration></ScoredEvent>…  AHI = (apnea+hypopnea)/TST_hours.
     TST from staged sleep epochs (each 30 s, non-Wake). Falls back to recording duration if no staging. */
  function parseNsrrXml(xmlText, t0Ms) {
    var doc;
    try { doc = new DOMParser().parseFromString(xmlText, 'text/xml'); }
    catch (e) { return { error: 'XML parse failed: ' + e.message }; }
    if (doc.querySelector('parsererror')) return { error: 'malformed XML' };

    var evNodes = doc.querySelectorAll('ScoredEvent, ScoredEvents > Event, Event');
    var nApnea = 0, nHypop = 0, sleepEpochs = 0, events = [];
    var stageDurSec = 0;
    evNodes.forEach(function (ev) {
      var conceptEl = ev.querySelector('EventConcept, Name, Type');
      var concept = conceptEl ? conceptEl.textContent.trim() : (ev.textContent || '').trim();
      var startEl = ev.querySelector('Start, Onset'); var durEl = ev.querySelector('Duration');
      var startSec = startEl ? parseFloat(startEl.textContent) : null;
      var durSec = durEl ? parseFloat(durEl.textContent) : null;
      if (RESP_RE.test(concept)) {
        var kind = HYPOP_RE.test(concept) ? 'hypopnea' : (APNEA_RE.test(concept) ? 'apnea' : 'resp');
        if (kind === 'hypopnea') nHypop++; else nApnea++;
        events.push({ kind: kind, sec: startSec, durSec: durSec, tMs: (t0Ms != null && startSec != null) ? t0Ms + startSec * 1000 : null, concept: concept });
      } else if (STAGE_RE.test(concept) && !WAKE_RE.test(concept)) {
        // a staged sleep epoch (or block); accumulate its duration if present, else count 30 s
        sleepEpochs++; stageDurSec += (durSec != null && durSec > 0) ? durSec : 30;
      }
    });
    var tstHours = stageDurSec > 0 ? stageDurSec / 3600 : null;
    var scoredAHI = (tstHours && tstHours > 0) ? +((nApnea + nHypop) / tstHours).toFixed(2) : null;
    return { scoredAHI: scoredAHI, tstHours: tstHours, nApnea: nApnea, nHypop: nHypop, nResp: nApnea + nHypop, nEvents: evNodes.length, events: events, staged: sleepEpochs > 0 };
  }

  /* Full record: EDF buffer (+ optional XML text, or an explicit scoredAHI override) → result row. */
  function analyzeRecord(opts) {
    // opts: { id, edfBuffer, xmlText?, scoredAHI?, ahiVar? }
    var out = { id: opts.id || 'record', err: null };
    if (!root.CpapEdf || !root.CpapEdf.readEDF) { out.err = 'CpapEdf not loaded'; return out; }
    if (typeof processNight !== 'function') { out.err = 'OxyDex not loaded'; return out; }
    var edf;
    try { edf = root.CpapEdf.readEDF(opts.edfBuffer); } catch (e) { out.err = 'readEDF: ' + e.message; return out; }
    var conv = edfToOxyRows(edf);
    if (!conv) { out.err = 'no SpO₂ channel in EDF (labels: ' + Object.keys(edf.signals).join(',') + ')'; return out; }
    out.spo2Label = conv.spo2Label; out.durSec = conv.durSec; out.t0Ms = conv.t0Ms;
    var night;
    try { night = processNight(conv.rows, opts.id || 'nsrr.edf'); } catch (e) { out.err = 'processNight: ' + e.message; return out; }
    out.odi4 = night.odi4 ? night.odi4.rate : null;
    out.odi3 = night.odi3 ? night.odi3.rate : null;
    // raw processNight doesn't attach ahiEst (summary/JSONL paths do) → mirror the shipped surrogate
    out.ahiOxyEst = (night.ahiEst && night.ahiEst.ahiODI4 != null) ? night.ahiEst.ahiODI4
                  : (out.odi4 != null ? +(out.odi4 * 1.1).toFixed(1) : null);
    out.minSpo2 = night.stats ? night.stats.minSpo2 : null;
    out.t90 = night.stats ? night.stats.t90pct : null;
    out.durMin = night.stats ? night.stats.durationMin : null;

    if (opts.scoredAHI != null && isFinite(opts.scoredAHI)) { out.scoredAHI = +opts.scoredAHI; out.ahiSource = opts.ahiVar || 'provided'; }
    else if (opts.xmlText) {
      var p = parseNsrrXml(opts.xmlText, conv.t0Ms);
      if (p.error) out.xmlErr = p.error;
      else { out.scoredAHI = p.scoredAHI; out.tstHours = p.tstHours; out.nApnea = p.nApnea; out.nHypop = p.nHypop; out.ahiSource = p.staged ? 'xml(events/TST)' : 'xml(no-staging)'; }
    }
    return out;
  }

  function severityOf(ahi) { return ahi == null ? null : ahi < 5 ? 'none' : ahi < 15 ? 'mild' : ahi < 30 ? 'mod' : 'severe'; }

  root.NSRR = {
    edfToOxyRows: edfToOxyRows,
    parseNsrrXml: parseNsrrXml,
    analyzeRecord: analyzeRecord,
    severityOf: severityOf,
    findSignal: findSignal,
    SPO2_LABELS: SPO2_LABELS,
  };
})(typeof window !== 'undefined' ? window : this);
