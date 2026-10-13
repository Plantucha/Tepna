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

/* ── NSRR DATA ACKNOWLEDGEMENT (data access and use agreement §11, §16) ───────────────────────
   Where this file names an SHHS-measured number: the Sleep Heart Health Study data were obtained
   through the National Sleep Research Resource (NSRR) under its data access and use agreement.
   Publications and presentations of those numbers carry the line
   "NSRR R24 HL114473: NHLBI National Sleep Research Resource" and cite the SHHS references listed
   on its NSRR page. Results of the analysis may be published; no part or excerpt of the Data
   appears here.
     · Quan SF, Howard BV, Iber C, et al. The Sleep Heart Health Study: design, rationale, and
       methods. Sleep. 1997;20(12):1077–85. doi:10.1093/sleep/20.12.1077
     · Zhang GQ, Cui L, Mueller R, et al. The National Sleep Research Resource: towards a sleep
       data commons. J Am Med Inform Assoc. 2018;25(10):1351–1358. doi:10.1093/jamia/ocy064
   Clause source: the signed agreement, §11 and §16. Cohort page: `docs/SHHS-COHORT-REFERENCE.md`. */
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
  /* The oximeter's own STATUS channel — documented by NSRR as "Oximetry Status" (SHHS1 montage: Nonin
     XPOD 3011, 8000 sensor, 1 Hz, sample-aligned with SaO2; the same row appears in the CFS, HAASSA and
     ABC montages under `Ox Status` / `Ox stat`). Matched on the alphanumeric residue like everything
     else here, so `oxstat` covers `OX stat` / `Ox Status` / `OXSTAT` and cannot collide with `sao2`. */
  var OXSTAT_LABELS = ['oxstat', 'oxstatus', 'oximetrystatus', 'oximeterstatus'];

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

  /* Resample a signal (any fs) to 1 Hz by nearest-sample. A physiologically invalid sample is a
     SENSOR DROPOUT, and a dropout is `null` — not the previous reading, not a default.

     ⚠️ THIS FUNCTION USED TO FABRICATE ABSENCE, and it sat upstream of every oximetry number the NSRR
     lane produces. It forward-filled an invalid sample with the last valid one
     (`if (v >= validLo && v <= validHi) last = v; out[s] = last != null ? last : NaN;`) so a dropout
     became a FLAT RUN of the previous saturation for as long as it lasted, and a wholly-invalid
     channel was seeded with a hardcoded `97` (or `60` for HR) — a fabricated saturation and a
     fabricated heart rate. Measured 2026-09-12 over the first 15 SHHS1 records: mean 2.76 % of SaO₂
     samples invalid, and one record held ONE value across an unbroken run over an hour long — a
     flat, invented trace. During a hold no desaturation can be detected there and the rolling baseline is
     contaminated by a run that never happened, so ODI-3/ODI-4 and every AHI estimate derived from
     them were computed partly over data that does not exist.

     The old comment called the fill "what OxyDex's ODI detector expects". It is not: `processNight`
     already SKIPS a row whose value is out of range (`oxydex-dsp.js:843`), so nulls are the shape it
     handles — the fill existed to keep the trace "continuous", which is precisely the property a
     dropout must not have. CLAUDE.md §∅: absence is null, at every layer.

     ⚠️ TWO REPRESENTATION TRAPS, both of which re-fabricate silently if ignored. A `Float32Array`
     CANNOT hold null — it coerces to `0`, which is the same bug one layer down and in-band for HR.
     And `NaN` does not work either: the row filter is `spo2 < 50 || spo2 > 100`, and NaN fails BOTH
     comparisons, so a NaN row passes the guard and reaches the detector. Only `null` is skipped
     (`null < 50` is true). So: a plain Array, carrying `null`. */
  function to1Hz(sig, validLo, validHi) {
    var fs = sig.fs || 1,
      n = sig.data.length;
    var durSec = Math.floor(n / fs);
    var out = new Array(durSec);
    var valid = 0;
    for (var s = 0; s < durSec; s++) {
      var v = sig.data[Math.floor(s * fs)];
      if (v >= validLo && v <= validHi) {
        out[s] = v;
        valid++;
      } else {
        out[s] = null; // a dropout is absent, never the last reading
      }
    }
    out.validCount = valid; // published so a consumer can report coverage rather than assume it
    return out;
  }

  /* EDF → OxyDex rows. Returns { rows, t0Ms, durSec, spo2Pct, hadHR, oxStat } | null.
     opts.ignoreOxStat — read the SaO2 channel WITHOUT applying the oximeter status channel. Exists for
     ONE consumer: `tools/nsrr-oxstat-validate.mjs`, whose paired design needs the pre-fix arm to stay
     measurable after the fix. Not a runtime option; nothing in the suite passes it.

     ── THE OXIMETER SAYS WHICH OF ITS OWN SAMPLES TO TRUST, AND THIS USED TO BE DISCARDED ──────────
     `to1Hz` nulls an out-of-RANGE sample. That guard cannot see an in-range sample the device itself
     flagged — CLAUDE.md §∅'s in-band case, where validity has to travel OUT-OF-BAND. SHHS1 ships
     exactly that channel and nothing read it. Measured 2026-09-15 (`nsrr-oxstat-validate.mjs`, 300
     records, paired): flagged samples are a median 5.33 % of the night, in-range and accepted; nulling
     them and re-running the SAME detector moves ODI-4 by a median −0.700 events/h against a shipped
     median of 3.05 (−23 %), lower on 258/278 records. About a quarter of the reported index came from
     samples the device said not to use.

     ⚠️ THE VALUES ARE NOT DOCUMENTED, AND THIS CODE DOES NOT PRETEND THEY ARE. NSRR's SHHS1
     documentation (montage + equipment pages, the MOP, and the CFS/HAASSA/ABC siblings — read
     2026-09-20) names the device and the sampling rate and defines NO value semantics; the 0–3 code is
     Compumedics', whose algorithms the equipment page records as not shared. What IS established, and
     is all this code relies on: (a) the channel is documented as the oximeter's STATUS, i.e. validity
     information about SaO2; (b) value 0 is distributionally indistinguishable from a normal overnight
     trace (100 % in-range, mean 95.0, p5 92.2) while every non-zero value is shifted or out of range
     (stat 1: mean 87.95, p5 74.2; stat 2: 50 % in-range; stat 3: 0.1 % in-range). So the rule is the
     §∅-conservative one and nothing finer: a sample the device marks as anything but its normal state is
     ABSENT for computation, and the rows carry how many. If Nonin/Compumedics documentation later shows
     a non-zero state under which the reading is still true, this is over-conservative in a KNOWN,
     REPORTED amount (`oxStat.inRangeFlaggedSec`) and the figures restate from that field — which is the
     point of carrying it.

     ⚠️ ABSENCE OF THE CHANNEL IS NEITHER "FLAGGED" NOR "CLEAN". 22 of 300 SHHS1 records carry no
     status channel at all. Those rows are passed through untouched and `oxStat.present` is false, so a
     consumer can see the night was not status-qualified rather than infer it was. */
  function edfToOxyRows(edf, opts) {
    if (!edf || !edf.signals) return null;
    var spo2Key = findSignal(edf.signals, SPO2_LABELS);
    if (!spo2Key) return null;
    var spo2 = to1Hz(edf.signals[spo2Key], 40, 100); // <40% or >100% = artifact
    var statKey = findSignal(edf.signals, OXSTAT_LABELS);
    var statPresent = !!(statKey && edf.signals[statKey] && edf.signals[statKey].data);
    var statApplied = statPresent && !(opts && opts.ignoreOxStat);
    var stat = statApplied ? edf.signals[statKey] : null; // present-but-ignored is reported, never silently equated with absent
    var statFs = stat ? stat.fs || 1 : 1;
    var statFlagged = 0,
      statInRangeFlagged = 0,
      statUncovered = 0;
    var hrKey = findSignal(edf.signals, HR_LABELS);
    var hr = hrKey ? to1Hz(edf.signals[hrKey], 20, 240) : null;
    var t0Ms = edf.clock && edf.clock.t0Ms != null ? edf.clock.t0Ms : Date.UTC(2020, 0, 1, 22, 0, 0);
    var rows = [];
    for (var i = 0; i < spo2.length; i++) {
      var tMs = t0Ms + i * 1000;
      /* canonical OxyDex row: .tMs float + .t Date (read via getUTC*); SpO₂ rounded to int like a real
         oximeter — but `Math.round(null)` is 0, so absence must be carried through explicitly rather
         than rounded. A null row is SKIPPED by processNight's range guard, which is the correct
         treatment of a dropout and the reason no fill is needed. */
      var sv = spo2[i],
        hv = hr ? hr[i] : null;
      if (stat) {
        var si = Math.floor(i * statFs);
        if (si < stat.data.length) {
          var st = stat.data[si];
          /* any non-normal status ⇒ absent. `st > 0` is deliberately the whole test: NaN and negative
             values fail it and pass through un-flagged rather than being invented into a verdict. */
          if (st > 0) {
            if (sv != null) statInRangeFlagged++; // would have been ACCEPTED by the range guard
            statFlagged++;
            sv = null;
          }
        } else {
          statUncovered++; // the status channel ended before the SaO2 channel did — reported, not assumed
        }
      }
      rows.push({
        tMs: tMs,
        t: new Date(tMs),
        spo2: sv == null ? null : Math.round(sv),
        /* When the EDF carries NO HR channel at all, this stays 0 — unchanged from before, and it is
           why such a record yields no usable rows (0 fails `hr < 20`). That is a separate defect and
           is deliberately not altered here; what changes is that a DROPOUT within a present channel is
           now null instead of the previous beat. */
        hr: hr ? (hv == null ? null : Math.round(hv)) : 0,
        motion: 0
      });
    }
    /* §∅: an output computed over absent input reports the absence. Coverage travels with the rows so
       a consumer can qualify a rate instead of assuming the night was fully observed. */
    var spo2Valid = (spo2.validCount || 0) - statInRangeFlagged; // the status removed samples the range guard had kept
    return {
      rows: rows,
      t0Ms: t0Ms,
      durSec: spo2.length,
      spo2Label: spo2Key,
      hadHR: !!hr,
      spo2ValidSec: spo2Valid,
      spo2CoveragePct: spo2.length ? +((100 * spo2Valid) / spo2.length).toFixed(2) : null,
      hrValidSec: hr ? hr.validCount || 0 : null,
      /* §∅: the device's own validity verdict travels with the rows. `present:false` is the honest
         shape for the 22/300 records without the channel — not flagged, not clean, not qualified. */
      oxStat: statPresent
        ? { present: true, applied: statApplied, label: statKey, flaggedSec: statFlagged, inRangeFlaggedSec: statInRangeFlagged, uncoveredSec: statUncovered }
        : { present: false, applied: false }
    };
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
    // opts: { id, edfBuffer, xmlText?, scoredAHI?, ahiVar?, ahiVia? }
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
    /* §∅: carried out of the adapter so a rate can be qualified by what was actually observed. An ODI
       computed over a night that was 15 % dropout is not the same claim as one over a complete night,
       and before this the two were indistinguishable because the gaps had been filled in. */
    out.spo2CoveragePct = conv.spo2CoveragePct;
    out.spo2ValidSec = conv.spo2ValidSec;
    out.hrValidSec = conv.hrValidSec;
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
    /* `computeAHIestimates` produces TWO estimates and this adapter used to surface only one, which
       is why the other had never been evaluated against a real scored AHI by anything: every NSRR
       measurement in this repo reads the adapter, and what the adapter drops is invisible to all of
       them. `ahiKulkas` is the internal linear model `0.8*ODI3 + 0.6*DesSev + 0.15*T95 - 1.2`
       (oxydex-dsp.js). Additive and null-safe; `ahiOxyEst` is unchanged for every existing caller. */
    out.ahiKulkas = night.ahiEst && night.ahiEst.ahiKulkas != null ? night.ahiEst.ahiKulkas : null;
    /* The PREDICTOR, not only the estimate. `ahiKulkas` is `0.8*ODI3 + 0.6*DesSev + 0.15*T95 - 1.2`,
       so a refit of those coefficients against a harmonized reference column needs DesSev itself;
       surfacing only the combined estimate made the middle term unreachable to every caller of this
       adapter, which is the whole NSRR lane (AHI-SURROGATE-REFIT-PAPER §4.3). ODI-3 and T95 were
       already surfaced below. Additive and null-safe: `computeDesSev` refuses under 60 samples and
       returns null, which this carries through rather than reading as a measured 0 (§∅). */
    out.desSev = night.desSev && night.desSev.desSev != null ? night.desSev.desSev : null;
    out.minSpo2 = night.stats ? night.stats.minSpo2 : null;
    out.t90 = night.stats ? night.stats.t90pct : null;
    /* Additive (2026-09-22): the two saturation summaries the NSRR lane had reported through this adapter
       but never surfaced per record, so `2026-09-21-nsrr-t90-counted-dropouts-as-desaturation` could not be
       measured on the cohort. Both come from `computeStats`, which since that fix rates over MEASURED
       seconds only; null-safe like every other stats field here. */
    out.meanSpo2 = night.stats && night.stats.meanSpo2 != null ? night.stats.meanSpo2 : null;
    out.t95 = night.stats && night.stats.t95pct != null ? night.stats.t95pct : null;
    out.durMin = night.stats ? night.stats.durationMin : null;

    if (opts.scoredAHI != null && isFinite(opts.scoredAHI)) {
      out.scoredAHI = +opts.scoredAHI;
      /* `ahiSource` is the reference's own IDENTITY — the exact dataset column name, so a scored row
         says which of the four AHI definitions it was compared against (AHI-SURROGATE-REFIT-SIZING
         item 3). It used to carry the lookup ROUTE instead (`csv`, `csv(id)`), which names how the
         value was found and nothing about what it means. The route keeps its own field. */
      out.ahiSource = opts.ahiVar || 'provided';
      out.ahiVia = opts.ahiVia || null;
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

  /* ════ NSRR dataset CSV → reference AHI (AHI-SURROGATE-REFIT-SIZING-2026-10-12 item 3) ════
     `odi-bias-analysis.js` held this reader, where nothing could execute it: that page's tail wires
     twelve DOM handlers, so neither test lane loads the module — only its TEXT, for a source scan.
     The knowledge is about the NSRR dataset rather than about one page, so it sits beside the rest of
     the adapter and is asserted headlessly.

     ⚠ THE PREFERENCE ORDER IS A SCIENTIFIC CHOICE, NOT A CONVENIENCE — do not sort it back.
     The mechanism this page measures is that ODI is blind to hypopneas which terminate in an arousal
     WITHOUT a qualifying desaturation. So the reference definition decides the answer before any data
     is read: pick a reference that is itself defined by desaturation (`ahi_a0h4` = apneas + hypopneas
     with >= 4 % desat) and reference and estimator share the blind spot, the events ODI cannot see are
     absent from BOTH sides, and the tool reports a small bias — about a comparison it never made.
     `ahi_a0h4` led this list until 2026-08-16, i.e. the default was the one variable guaranteed to mask
     the effect. Arousal-inclusive definitions now lead, lowest desaturation threshold first, since that
     is the most inclusive reference and therefore the one that can SEE the events ODI misses.

     The four `nsrr_ahi_*` names are the harmonized dataset's own, read from
     `shhs-data-dictionary-0.21.0-variables.csv` (NSRR SHHS 0.21.0, offline):
       `nsrr_ahi_hp3r_aasm15`  apneas + hypopneas, >= 30 % flow reduction and >= 3 % desat OR arousal
       `nsrr_ahi_hp4r`         apneas + hypopneas, >= 4 % desat OR arousal        (source `:ahi_a0h4a:`)
       `nsrr_ahi_hp3u`         apneas + hypopneas, >= 3 % desat                   (source `:ahi_a0h3:`)
       `nsrr_ahi_hp4u_aasm15`  apneas + hypopneas, >= 30 % flow reduction and >= 4 % desat
     A trailing `r` counts arousal-terminated hypopneas and `u` does not, which is the only property
     this ordering depends on. The dictionary names the native twin for two of the four; the other two
     were joined to theirs over 5804 SHHS1 subjects on 2026-10-13. Each harmonized column agrees with
     exactly one native to within 0.005 events/h on 100.00 % of subjects — `nsrr_ahi_hp3u` with
     `ahi_a0h3`, `nsrr_ahi_hp3r_aasm15` with `ahi_a0h3a`, `nsrr_ahi_hp4u_aasm15` with `ahi_a0h4`,
     `nsrr_ahi_hp4r` with `ahi_a0h4a` — while every other pairing agrees on at most 3 % of subjects and
     differs by up to 43.6 events/h. A harmonized name may therefore precede its native twin, because
     that order costs at most 0.005 events/h. Adding the four changes no existing selection either: no
     NSRR dataset file carries both spellings (the harmonized CSV holds the four `nsrr_ahi_*` columns
     and no native one, each per-visit CSV the reverse), so the four can only turn today's refusal into
     a read. */
  var NSRR_AHI_VARS = [
    'nsrr_ahi_hp3r_aasm15',
    'ahi_a0h3a',
    'nsrr_ahi_hp4r',
    'ahi_a0h4a',
    'nsrr_ahi_hp3u',
    'ahi_a0h3',
    'nsrr_ahi_hp4u_aasm15',
    'ahi_a0h4',
    'ahi_c0h3',
    'ahi_c0h4',
    'ahi_ap0nop',
    'poohi3',
    'poohi4',
    'rdi3p',
    'rdi4p',
    'oahi3',
    'oahi4',
    'ahi',
    'rdi'
  ];

  /* Reference definitions that count arousal-terminated hypopneas. Explicit rather than a suffix
     regex: `rdi3p`/`poohi3` also end in a digit-plus-letter shape, and guessing wrong here mislabels
     the confound in the direction that hides it. Unknown ⇒ null ⇒ the caller warns. */
  var AHI_VARS_WITH_AROUSAL = ['nsrr_ahi_hp3r_aasm15', 'nsrr_ahi_hp4r', 'ahi_a0h3a', 'ahi_a0h4a', 'ahi_c0h3a', 'ahi_c0h4a', 'ahi_o0h3a', 'ahi_o0h4a'];

  function ahiCountsArousals(v) {
    if (!v) return null;
    if (AHI_VARS_WITH_AROUSAL.indexOf(v) >= 0) return true;
    if (NSRR_AHI_VARS.indexOf(v) >= 0) return false;
    return null; // unrecognised variable — caller must not assume either way
  }

  var NSRR_ID_VARS = ['nsrrid', 'pptid', 'subject', 'id', 'studyid', 'mesaid', 'idtype'];

  /* RFC 4180 field split, because a naive `split(delim)` reads the wrong column on a real NSRR
     dataset CSV. `shhs2-dataset-0.21.0.csv` carries a free-text `comm` column at position 856 that
     holds a comma on 701 of its 4311 rows, and the four native AHI columns sit at 1229-1232, i.e.
     AFTER it. Measured 2026-10-13: a naive split shifts the read onto a neighbouring variable on 685
     of the 2651 rows that carry a value (25.8 %), and every one of those 685 values still parses as a
     number, so it is stored rather than skipped — median |delta| 4.50 events/h, mean 7.09, max
     102.23, and 46.3 % of them differ by more than 5. A plausible wrong reference clears every range check, so quoting has
     to be honoured here rather than assumed away. */
  function splitCsvLine(line, delim) {
    var out = [],
      cur = '',
      q = false,
      s = String(line == null ? '' : line),
      d = delim || ',';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (q) {
        if (ch !== '"') cur += ch;
        else if (s.charAt(i + 1) === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else if (ch === '"') q = true;
      else if (ch === d) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function cell(c, i) {
    return i >= 0 && i < c.length ? c[i].trim().replace(/^"|"$/g, '') : '';
  }

  /* Only SHHS encodes the visit in the record id — `shhs1-999999` is subject 999999 at visit 1 — and
     SHHS is the only cohort this repository is licensed for. Any other stem answers null, and then a
     bare subject id is used only where it is unambiguous. */
  function stemVisit(stem) {
    var m = /^shhs(\d+)[-_]/i.exec(String(stem == null ? '' : stem));
    return m ? m[1] : null;
  }

  /* Read an NSRR dataset CSV into `{ byKey, ahiVar, arousals, … }`. Two shapes: a wide dataset export
     (a real header, one chosen AHI variable) and a simple `id,ahi` pair list.

     The visit travels IN THE KEY for a wide file that carries `visitnumber`, because the harmonized
     dataset pools every visit into one file keyed by `nsrrid` + `visitnumber`, where a bare `nsrrid`
     names no single recording. Measured 2026-10-13 on `shhs-harmonized-dataset-0.21.0.csv`: 4311 of
     its 5804 subjects carry two rows, the visit-2 row comes last in all 4311, and 2651 of those hold
     a visit-2 value — so a visit-blind `byKey[id] = ahi` would hand the visit-2 AHI to a visit-1
     recording for 2651 subjects, mean |delta| 9.10 events/h, max 92.58, and 30.2 % of them over 10.
     That is a reference measured on a different night, which `lookupAhi` must never substitute for an
     absent one. A subject reached by more than one visit therefore gets NO bare key, and the count of
     those sits in `ambiguous` for the caller to surface. */
  function parseAhiCsv(text, opts) {
    var out = { byKey: {}, ahiVar: null, arousals: null, rows: 0, subjects: 0, visits: {}, ambiguous: 0, idVar: null, visitKeyed: false, wide: false, error: null };
    var lines = String(text == null ? '' : text)
      .split(/\r?\n/)
      .filter(function (l) {
        return l.trim();
      });
    if (!lines.length) {
      out.error = 'empty CSV';
      return out;
    }
    var delim = lines[0].indexOf('\t') >= 0 ? '\t' : ',';
    var head = splitCsvLine(lines[0], delim).map(function (h) {
      return h.trim().replace(/^"|"$/g, '').toLowerCase();
    });
    /* A caller that NAMES the column gets that column or an error — never a different definition's
       value under the name it asked for. The refit scores four definitions out of one harmonized
       file (`briefs/AHI-SURROGATE-REFIT-PAPER-2026-10-13-BRIEF.md` §4.4), and the default search
       order below would hand all four fits the same column. New parameter, last and optional: a
       caller that passes nothing reads exactly the bytes it read before. */
    var want = opts && opts.ahiVar ? String(opts.ahiVar).trim().toLowerCase() : null;

    if (
      !head.some(function (h) {
        return isNaN(parseFloat(h));
      })
    ) {
      // simple `id,ahi` (header optional): every row is a pair, and no variable is being chosen.
      if (want) {
        /* No header, so nothing here can be the named column: the caller asked for a definition this
           file cannot identify, and an unnamed pair would answer under the wrong name. */
        out.error = 'requested AHI column "' + want + '" but this file is a bare id,ahi pair list with no header';
        return out;
      }
      lines.forEach(function (ln) {
        var c = splitCsvLine(ln, ln.indexOf('\t') >= 0 ? '\t' : ',');
        if (c.length < 2) return;
        var id = cell(c, 0),
          ahi = parseFloat(c[1]);
        if (id && isFinite(ahi)) {
          out.byKey[id.replace(/\.(edf|xml)$/i, '')] = ahi;
          out.rows++;
        }
      });
      out.subjects = out.rows;
      return out;
    }

    out.wide = true;
    var idCol = -1;
    for (var a = 0; a < NSRR_ID_VARS.length && idCol < 0; a++) idCol = head.indexOf(NSRR_ID_VARS[a]);
    if (idCol < 0) idCol = 0;
    out.idVar = head[idCol];
    var ahiCol = -1;
    if (want) {
      ahiCol = head.indexOf(want);
      if (ahiCol < 0) {
        out.error = 'requested AHI column "' + want + '" is not in this file';
        return out;
      }
      out.ahiVar = want;
    }
    for (var v = 0; v < NSRR_AHI_VARS.length && ahiCol < 0; v++) {
      var ix = head.indexOf(NSRR_AHI_VARS[v]);
      if (ix >= 0) {
        ahiCol = ix;
        out.ahiVar = NSRR_AHI_VARS[v];
      }
    }
    if (ahiCol < 0) {
      out.error = 'no known AHI column (looked for nsrr_ahi_hp3r_aasm15, ahi_a0h3a, poohi4, rdi4p…)';
      return out;
    }
    out.arousals = ahiCountsArousals(out.ahiVar);

    var visitCol = head.indexOf('visitnumber');
    var bare = {},
      seen = {};
    for (var r = 1; r < lines.length; r++) {
      var c = splitCsvLine(lines[r], delim);
      if (c.length <= (idCol > ahiCol ? idCol : ahiCol)) continue;
      var id = cell(c, idCol),
        ahi = parseFloat(c[ahiCol]);
      if (!id || !isFinite(ahi)) continue;
      var visit = visitCol >= 0 ? cell(c, visitCol) : '';
      if (/^\d+$/.test(visit)) {
        out.byKey['visit' + visit + ':' + id] = ahi;
        out.visits[visit] = (out.visits[visit] || 0) + 1;
        out.visitKeyed = true;
        bare[id] = Object.prototype.hasOwnProperty.call(bare, id) ? null : ahi;
      } else {
        bare[id] = ahi; // no visit column ⇒ one row per recording, last row wins (unchanged)
      }
      if (!seen[id]) {
        seen[id] = 1;
        out.subjects++;
      }
      out.rows++;
    }
    for (var b in bare) {
      if (!Object.prototype.hasOwnProperty.call(bare, b)) continue;
      if (bare[b] === null) out.ambiguous++;
      else out.byKey[b] = bare[b];
    }
    return out;
  }

  /* Tolerant id lookup: an EDF stem `shhs1-999999` should match nsrrid `999999`. Tries the full stem,
     then the trailing numeric id, then a `cohortN-` strip — under the stem's own visit first whenever
     the table is visit-keyed. Returns `{ ahi, ahiVar, via }`, where `ahiVar` is the exact column name
     the value came from, or null when this table holds no reference for THIS recording. */
  function lookupAhi(table, stem) {
    if (!table || !table.byKey || !stem) return null;
    var map = table.byKey,
      s = String(stem);
    var num = (s.match(/(\d{3,})\s*$/) || [])[1];
    var strip = s.replace(/^[a-z]+\d*[-_]/i, '');
    var visit = stemVisit(s);
    if (visit && table.visitKeyed) {
      var cands = [s, num, strip];
      for (var i = 0; i < cands.length; i++) {
        var k = cands[i] == null ? null : 'visit' + visit + ':' + cands[i];
        if (k && map[k] != null) return { ahi: map[k], ahiVar: table.ahiVar, via: 'csv(visit ' + visit + ')' };
      }
      /* The visit is KNOWN and that visit has no row. Falling through to the bare id would answer with
         the other visit's night, so this refuses: an absent reference, never a borrowed one. */
      return null;
    }
    if (map[s] != null) return { ahi: map[s], ahiVar: table.ahiVar, via: 'csv' };
    if (num && map[num] != null) return { ahi: map[num], ahiVar: table.ahiVar, via: 'csv(id)' };
    if (strip && map[strip] != null) return { ahi: map[strip], ahiVar: table.ahiVar, via: 'csv(id)' };
    return null;
  }

  function severityOf(ahi) {
    return ahi == null ? null : ahi < 5 ? 'none' : ahi < 15 ? 'mild' : ahi < 30 ? 'mod' : 'severe';
  }

  root.NSRR = {
    edfToOxyRows: edfToOxyRows,
    parseAhiCsv: parseAhiCsv,
    lookupAhi: lookupAhi,
    ahiCountsArousals: ahiCountsArousals,
    splitCsvLine: splitCsvLine,
    stemVisit: stemVisit,
    AHI_VARS: NSRR_AHI_VARS,
    AHI_VARS_WITH_AROUSAL: AHI_VARS_WITH_AROUSAL,
    ID_VARS: NSRR_ID_VARS,
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
