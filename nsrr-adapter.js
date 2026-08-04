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

  /* Resolve OxyDex's real `processNight` from the NAMESPACE, not from a bare global.
     ESM-MIGRATION-FOLLOWUPS-II removed oxydex-dsp's `Object.assign(root, BARE)` back-compat spray, so
     all 132 `OxyDex._bare` helpers stopped being reachable as bare globals in EVERY realm.
     `cohort-worker.js` was migrated to `OxyDex._bare.processNight` at the time; this adapter was not, so
     its `typeof processNight !== 'function'` guard has been TRUE ever since and `analyzeRecord` returned
     `err:'OxyDex not loaded'` before reading a byte of the EDF — on the shipped `odi-bias-analysis.html`
     page as much as in any test realm. Nothing caught it because nothing ever executed this path:
     DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS §AD deferred the only test that would have, as "genuinely
     fixture-heavy". Writing that test is what surfaced this.
     The bare branch is kept FIRST so a legacy sprayed realm still resolves; the namespace lookup is the
     one that actually fires today. */
  function _resolveProcessNight() {
    if (typeof processNight === 'function') return processNight; // legacy sprayed realm
    var O = root.OxyDex;
    return O && O._bare && typeof O._bare.processNight === 'function' ? O._bare.processNight : null;
  }

  // SpO₂ channel labels seen across NSRR cohorts (case-insensitive contains)
  var SPO2_LABELS = ['spo2', 'sao2', 'osat', 'sat'];
  var HR_LABELS = ['pulse', 'heart rate', 'hr', 'pr'];

  function findSignal(signals, names) {
    var keys = Object.keys(signals);
    for (var i = 0; i < keys.length; i++) {
      var lk = keys[i].toLowerCase().replace(/[^a-z0-9]/g, '');
      for (var j = 0; j < names.length; j++) {
        if (lk.indexOf(names[j].replace(/[^a-z0-9]/g, '')) >= 0) return keys[i];
      }
    }
    return null;
  }

  // Resample a signal (any fs) to 1 Hz by nearest-sample, forward-filling physiologic-
  // invalid samples (sensor dropouts) with the last valid value so the 1 Hz trace stays
  // continuous and monotonic (what OxyDex's ODI detector expects). Leading invalids seed
  // from the first valid sample (or a 97% baseline if the whole channel is junk).
  function to1Hz(sig, validLo, validHi) {
    var fs = sig.fs || 1,
      n = sig.data.length;
    var durSec = Math.floor(n / fs);
    var out = new Float32Array(durSec);
    var last = null;
    for (var s = 0; s < durSec; s++) {
      var v = sig.data[Math.floor(s * fs)];
      if (v >= validLo && v <= validHi) last = v;
      out[s] = last != null ? last : NaN;
    }
    // backfill any leading NaNs from the first valid value
    var firstValid = null;
    for (var i = 0; i < durSec; i++) {
      if (!isNaN(out[i])) {
        firstValid = out[i];
        break;
      }
    }
    if (firstValid == null) firstValid = validLo === 40 ? 97 : 60; // whole channel junk → baseline
    for (var j = 0; j < durSec && isNaN(out[j]); j++) out[j] = firstValid;
    return out;
  }

  /* EDF → OxyDex rows. Returns { rows, t0Ms, durSec, spo2Pct, hadHR } | null. */
  function edfToOxyRows(edf) {
    if (!edf || !edf.signals) return null;
    var spo2Key = findSignal(edf.signals, SPO2_LABELS);
    if (!spo2Key) return null;
    var spo2 = to1Hz(edf.signals[spo2Key], 40, 100); // <40% or >100% = artifact
    var hrKey = findSignal(edf.signals, HR_LABELS);
    var hr = hrKey ? to1Hz(edf.signals[hrKey], 20, 240) : null;
    var t0Ms = edf.clock && edf.clock.t0Ms != null ? edf.clock.t0Ms : Date.UTC(2020, 0, 1, 22, 0, 0);
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
  var WAKE_RE = /wake|stage 0|^0$|\|0\b/i;

  /* ── PER-EPOCH STAGE LABELS (REM-STAGING-FOLLOWUPS §2a) ──────────────────────────────────────────
     These annotation files are PSG-scored: every 30 s epoch carries an expert stage. Until now this
     parser reduced all of them to ONE scalar — `stageDurSec`, for total sleep time — so the stage
     IDENTITY (the thing two blocked staging efforts are short of) was read off disk and discarded on
     the same line. §2a asked whether the labels were absent or merely unparsed. They are unparsed.

     NSRR/Compumedics writes a stage EventConcept as "<text>|<code>", and the CODE is authoritative
     because the text varies across cohorts ("Stage 1 sleep" · "NREM1" · "N1"):
         0 Wake · 1 N1 · 2 N2 · 3 N3 · 4 N4 (scored as N3 under AASM) · 5 REM · 6 Movement · 9 Unscored
     Recognising the code — not just the words "stage"/"sleep" — also FIXES a TST bug: a cohort that
     writes a bare `REM|5` matched neither STAGE_RE nor WAKE_RE, so REM fell out of total sleep time
     entirely and inflated every AHI computed from it. `Stage 2 sleep|2` was never affected, which is
     why the existing known-answer test could not see it. */
  var EPOCH_SEC = 30;
  var STAGE_CODE_RE = /\|\s*([0-9])\s*$/;
  var STAGE_BY_CODE = { 0: 'Wake', 1: 'N1', 2: 'N2', 3: 'N3', 4: 'N3', 5: 'REM', 6: 'Movement', 9: 'Unscored' };
  var SLEEP_STAGES = { N1: 1, N2: 1, N3: 1, REM: 1 }; // what counts toward TST — Wake/Movement/Unscored do not
  var REM_TEXT_RE = /\brem\b/i;
  var N1_RE = /(stage\s*1|nrem\s*1|\bn1\b)/i;
  var N2_RE = /(stage\s*2|nrem\s*2|\bn2\b)/i;
  var N3_RE = /(stage\s*[34]|nrem\s*[34]|\bn[34]\b|slow\s*wave)/i;

  /* concept → canonical stage name, or null if this event is not a stage at all.
     Code first (authoritative), text second (cohorts that omit the code).

     The text fallback is deliberately NARROW. "Arousal (ARO RES)|Arousal ()" is not a stage, and a
     loose word-match would eventually classify one as N-something; a stage series polluted by arousal
     events is worse than no series, because it looks like labels. So text is trusted only when the
     concept SAYS stage/sleep, or when the whole leading token IS the stage name. */
  var BARE_STAGE_RE = /^\s*(wake|rem|nrem\s*[1234]|n[1234]|s[01234])\b/i;
  /* EDF+ Annotations spell it "Sleep stage W|R|N1|N2|N3|N4|1|2|3|4" — unambiguous, but W/R are single
     letters that must NOT be matched loosely anywhere else. Anchored whole-string, so they cannot. */
  var EDFPLUS_RE = /^\s*sleep\s+stage\s+([WR]|N?[1234])\s*$/i;
  var EDFPLUS_MAP = { W: 'Wake', R: 'REM', 1: 'N1', 2: 'N2', 3: 'N3', 4: 'N3' };
  function stageOf(concept) {
    var m = STAGE_CODE_RE.exec(concept);
    if (m) {
      var byCode = STAGE_BY_CODE[+m[1]];
      if (byCode) return byCode;
    }
    var ep = EDFPLUS_RE.exec(concept);
    if (ep) return EDFPLUS_MAP[ep[1].toUpperCase().replace(/^N/, '')] || null;
    if (!STAGE_RE.test(concept) && !BARE_STAGE_RE.test(concept)) return null;
    if (WAKE_RE.test(concept)) return 'Wake';
    if (REM_TEXT_RE.test(concept)) return 'REM';
    if (N1_RE.test(concept)) return 'N1';
    if (N2_RE.test(concept)) return 'N2';
    if (N3_RE.test(concept)) return 'N3';
    return null; // says "stage"/"sleep" but names no stage we can pin — do not guess
  }

  /* Scored blocks → the 30 s epoch grid the scorer used, indexed from recording start, so a feature
     vector computed per epoch joins to a label by INDEX alone — which is the whole point of §2b.

     Kept separate from parseNsrrXml on purpose: parseNsrrXml needs DOMParser and therefore runs in the
     BROWSER lane only, while the Node lane is what gates every PR. The XML walk cannot escape that;
     this arithmetic can, so it does.

     A block with no Start cannot be placed and is left out of the GRID — but it still counted toward
     TST upstream, and dropping it from both would silently move an existing number. Later blocks win
     on overlap (a re-scored epoch is the scorer's correction). Holes stay `undefined`: an unscored
     gap is not Wake, and filling it would invent 8 h of labels out of a truncated file. */
  function stagesToEpochs(stages) {
    var epochs = [];
    var stageCounts = {};
    for (var s = 0; s < stages.length; s++) {
      var b = stages[s];
      var n = Math.max(1, Math.round(b.durSec / EPOCH_SEC));
      stageCounts[b.stage] = (stageCounts[b.stage] || 0) + n;
      if (b.sec == null || !isFinite(b.sec)) continue;
      var i0 = Math.round(b.sec / EPOCH_SEC);
      if (i0 < 0) continue;
      for (var k = 0; k < n; k++) epochs[i0 + k] = b.stage;
    }
    var nSleepEp = 0,
      nRemEp = 0;
    for (var e = 0; e < epochs.length; e++) {
      if (!epochs[e]) continue;
      if (SLEEP_STAGES[epochs[e]]) nSleepEp++;
      if (epochs[e] === 'REM') nRemEp++;
    }
    return {
      epochs: epochs,
      stageCounts: stageCounts,
      nSleepEpochs: nSleepEp,
      nRemEpochs: nRemEp,
      remFrac: nSleepEp > 0 ? +(nRemEp / nSleepEp).toFixed(4) : null
    };
  }

  /* Parse an NSRR profusion-style annotation XML →
       { scoredAHI, tstHours, nApnea, nHypop, events:[{tMs?,sec,kind}],
         stages:[{stage,sec,durSec,tMs?}], epochs:[stage…], epochSec, stageCounts, remFrac, hasStageLabels }.
     Robust to the two common shapes: <ScoredEvents><ScoredEvent><EventConcept>…</EventConcept>
     <Start>…</Start><Duration>…</Duration></ScoredEvent>…  AHI = (apnea+hypopnea)/TST_hours.
     TST from staged sleep epochs (each 30 s, non-Wake). Falls back to recording duration if no staging. */
  function parseNsrrXml(xmlText, t0Ms) {
    var doc;
    try {
      doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    } catch (e) {
      return { error: 'XML parse failed: ' + e.message };
    }
    if (doc.querySelector('parsererror')) return { error: 'malformed XML' };

    var evNodes = doc.querySelectorAll('ScoredEvent, ScoredEvents > Event, Event');
    var nApnea = 0,
      nHypop = 0,
      sleepEpochs = 0,
      events = [];
    var stageDurSec = 0;
    var stages = [];
    evNodes.forEach(function (ev) {
      var conceptEl = ev.querySelector('EventConcept, Name, Type');
      var concept = conceptEl ? conceptEl.textContent.trim() : (ev.textContent || '').trim();
      var startEl = ev.querySelector('Start, Onset');
      var durEl = ev.querySelector('Duration');
      var startSec = startEl ? parseFloat(startEl.textContent) : null;
      var durSec = durEl ? parseFloat(durEl.textContent) : null;
      if (RESP_RE.test(concept)) {
        var kind = HYPOP_RE.test(concept) ? 'hypopnea' : APNEA_RE.test(concept) ? 'apnea' : 'resp';
        if (kind === 'hypopnea') nHypop++;
        else nApnea++;
        events.push({ kind: kind, sec: startSec, durSec: durSec, tMs: t0Ms != null && startSec != null ? t0Ms + startSec * 1000 : null, concept: concept });
      } else {
        var stage = stageOf(concept);
        if (!stage) return;
        // a staged block (one epoch, or many consecutive epochs of one stage sharing a Duration)
        var blockSec = durSec != null && durSec > 0 ? durSec : EPOCH_SEC;
        stages.push({
          stage: stage,
          sec: startSec,
          durSec: blockSec,
          tMs: t0Ms != null && startSec != null ? t0Ms + startSec * 1000 : null,
          concept: concept
        });
        if (SLEEP_STAGES[stage]) {
          sleepEpochs++;
          stageDurSec += blockSec;
        }
      }
    });
    var tstHours = stageDurSec > 0 ? stageDurSec / 3600 : null;
    var scoredAHI = tstHours && tstHours > 0 ? +((nApnea + nHypop) / tstHours).toFixed(2) : null;

    var grid = stagesToEpochs(stages);
    return {
      scoredAHI: scoredAHI,
      tstHours: tstHours,
      nApnea: nApnea,
      nHypop: nHypop,
      nResp: nApnea + nHypop,
      nEvents: evNodes.length,
      events: events,
      staged: sleepEpochs > 0,
      // ── §2a: the expert labels, no longer discarded ──
      stages: stages, // scored blocks, file order
      epochs: grid.epochs, // 30 s grid from recording start; holes are unscored gaps
      epochSec: EPOCH_SEC,
      stageCounts: grid.stageCounts, // epochs per stage, from block durations
      nSleepEpochs: grid.nSleepEpochs,
      remFrac: grid.remFrac,
      hasStageLabels: stages.length > 0
    };
  }

  /* Full record: EDF buffer (+ optional XML text, or an explicit scoredAHI override) → result row. */
  function analyzeRecord(opts) {
    // opts: { id, edfBuffer, xmlText?, scoredAHI?, ahiVar? }
    var out = { id: opts.id || 'record', err: null };
    if (!root.CpapEdf || !root.CpapEdf.readEDF) {
      out.err = 'CpapEdf not loaded';
      return out;
    }
    var runNight = _resolveProcessNight();
    if (!runNight) {
      out.err = 'OxyDex not loaded';
      return out;
    }
    var edf;
    try {
      edf = root.CpapEdf.readEDF(opts.edfBuffer);
    } catch (e) {
      out.err = 'readEDF: ' + e.message;
      return out;
    }
    var conv = edfToOxyRows(edf);
    if (!conv) {
      out.err = 'no SpO₂ channel in EDF (labels: ' + Object.keys(edf.signals).join(',') + ')';
      return out;
    }
    out.spo2Label = conv.spo2Label;
    out.durSec = conv.durSec;
    out.t0Ms = conv.t0Ms;
    var night;
    try {
      night = runNight(conv.rows, opts.id || 'nsrr.edf');
    } catch (e) {
      out.err = 'processNight: ' + e.message;
      return out;
    }
    out.odi4 = night.odi4 ? night.odi4.rate : null;
    out.odi3 = night.odi3 ? night.odi3.rate : null;
    /* READ OxyDex's surrogate; never re-derive it. The former line here carried a local
       `+(out.odi4 * 1.1).toFixed(1)` fallback under the comment "raw processNight doesn't attach ahiEst
       (summary/JSONL paths do)". That comment was WRONG: `computeAHIestimates` runs inside
       `processNight` and attaches `ahiEst` whenever there is an ODI-4 (oxydex-dsp.js, `ahiODI4 =
       +(odi4Rate * 1.1).toFixed(1)`), so the first branch always won and the mirrored constant was
       unreachable. Proven by mutation: changing the local 1.1 to 1.5 moved no surfaced value.
       A dead duplicate of a tunable constant is worse than none — it reads as a second source of truth
       and would silently diverge the day someone "fixed" one of the two. There is now exactly one ×1.1
       in the suite, in oxydex-dsp, and the end-to-end known-answer leg gates it there. */
    out.ahiOxyEst = night.ahiEst && night.ahiEst.ahiODI4 != null ? night.ahiEst.ahiODI4 : null;
    out.minSpo2 = night.stats ? night.stats.minSpo2 : null;
    out.t90 = night.stats ? night.stats.t90pct : null;
    out.durMin = night.stats ? night.stats.durationMin : null;

    if (opts.scoredAHI != null && isFinite(opts.scoredAHI)) {
      out.scoredAHI = +opts.scoredAHI;
      out.ahiSource = opts.ahiVar || 'provided';
    } else if (opts.xmlText) {
      var p = parseNsrrXml(opts.xmlText, conv.t0Ms);
      if (p.error) out.xmlErr = p.error;
      else {
        out.scoredAHI = p.scoredAHI;
        out.tstHours = p.tstHours;
        out.nApnea = p.nApnea;
        out.nHypop = p.nHypop;
        out.ahiSource = p.staged ? 'xml(events/TST)' : 'xml(no-staging)';
      }
    }
    return out;
  }

  function severityOf(ahi) {
    return ahi == null ? null : ahi < 5 ? 'none' : ahi < 15 ? 'mild' : ahi < 30 ? 'mod' : 'severe';
  }

  root.NSRR = {
    edfToOxyRows: edfToOxyRows,
    parseNsrrXml: parseNsrrXml,
    analyzeRecord: analyzeRecord,
    severityOf: severityOf,
    findSignal: findSignal,
    stageOf: stageOf,
    stagesToEpochs: stagesToEpochs,
    STAGE_BY_CODE: STAGE_BY_CODE,
    SLEEP_STAGES: SLEEP_STAGES,
    SPO2_LABELS: SPO2_LABELS
  };
})(typeof window !== 'undefined' ? window : this);
