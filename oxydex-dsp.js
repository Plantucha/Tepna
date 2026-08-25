/* ════ OxyDex · DSP & METRICS — OXYDSP (oxydex-dsp.js) ──────────────────────────────────────────────────
   The whole analysis engine: CONFIG/allNights, file ingest + parsing
   (parseCSV/parseJSONL/processNight; summary-CSV is export-only), artifact cleaning, and
   every metric tier (night extras, rolling, pattern scores, DFA/FFT/entropy,
   composites, literature scores, VO₂max/BP/Karvonen, JSONL import, helpers).
   Plain global script — shares page scope with the other oxydex-*.js files,
   exactly as in the original single-script monolith. No behavior change.
   Load order: oxydex-util → oxydex-profile → oxydex-dsp → oxydex-render → oxydex-app.
   ════════════════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════════════════
// OxyDex — Nocturnal Oximetry Analyzer  v1.0.0  ·  Tepna
// ═══════════════════════════════════════════════════════════════════════
// Open-source sleep oximetry analysis tool.
// Processes raw 1Hz SpO2 / HR / Motion CSV data from O2Ring and
// compatible pulse oximeters (Wellue, ViATOM, and generic CSV format).
//
// Features:
//   • 75+ derived metrics across SpO2, HR, HRV, motion, and coupling
//   • Fully client-side — no server, no data upload, no accounts
//   • Multi-night longitudinal tracking and trend analysis
//   • JSONL export for downstream analysis
//   • Works offline after first load
//
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License"); you may not
// use this file except in compliance with the License. See the LICENSE and
// NOTICE files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
// Source  : https://github.com/Plantucha/OxyDex
//
// Contributing: PRs welcome.
// Issues      : Please report bugs via GitHub Issues.
//
// Changelog: moved to docs-archive/oxydex-dsp-changelog.md (git is the source of truth).
//            See `git log -- oxydex-dsp.js` for changes after that snapshot.
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
/* ════ NAMESPACED BUILD (SIGNAL-ADAPTER-FOLLOWUPS §3) — see pulsedex-dsp.js head.
   IIFE-wrapped so the bare helpers (parseCSV, parseTimestamp, processNight, the
   compute* metric family …) stay closure-local and don't collide when the
   Unifier/OverDex co-load all DSPs in one realm (root.__DEX_NAMESPACED__ set → no
   bare spray, only root.OxyDex). App back-compat: bare re-export below when the
   flag is unset; mutable cross-file state (allNights, written by oxydex-app.js) is
   accessor-proxied. The top-level #fileInput/#uploadArea wiring stays guarded by
   its existing `if(_fi)`/`if(ua)` checks, so it no-ops in the co-load realm (the
   Unifier/OverDex pages carry neither element). */
(function (root) {
  window.UP = window.UP || {};

  /* ── DSP→UI hooks (ESM-MIGRATION-FOLLOWUPS-II item 3 — dependency injection) ────────────────────
     oxydex-dsp used to reach UP into its co-loaded UI siblings as bare page globals: setStatus/
     setProgress/renderAll/showError (side-effects, in the handleFiles upload path) and upVO2category
     (a VO₂ classifier in oxydex-profile.js, typeof-guarded). Those bare reach-ins are why
     oxydex-globals.d.ts declared them. Now the UI modules INJECT their implementations via
     OxyDex.setHooks({…}); the DSP calls `_ui.x(…)` only. Defaults are HEADLESS-SAFE and reproduce the
     pre-DI headless path EXACTLY (upVO2category→null, matching the old typeof-guard; the rest no-op) —
     none is in the compute() golden path, so the export is byte-identical. The oxydex-util helpers
     (safeStyle/safeSet/safeEl/escHTML/computeCeilingBaselineArr) are NOT reach-ins — they are the
     node's own util dependency (gate-accepted) and stay. */
  var _ui = /** @type {any} */ ({
    setStatus: function (_msg) {},
    setProgress: function (_pct) {},
    renderAll: function () {},
    showError: function (_msg) {},
    upVO2category: function (_vo2) {
      return null;
    }
  });
  function setHooks(h) {
    if (h) for (var k in _ui) if (typeof h[k] === 'function') _ui[k] = h[k];
  }
  /* The counterpart to setHooks, so an installed hook can be UNDONE exactly — see the longer note
     in hrvdex-dsp.js. Returns a SHALLOW COPY, never `_ui` itself. Additive; nothing else reads it.
     (MUTATION-PROGRAM-FOLLOWUPS §9.4) */
  function getHooks() {
    var out = {};
    for (var gk in _ui) out[gk] = _ui[gk];
    return out;
  }

  // CONFIG
  // ═══════════════════════════════════════════
  // CFG — OxyDex-LOCAL constants. The kernel-constants (DexKernel.K) migration audit
  // (DEX-EVENT-UNIFY-AND-CSV-BRIEF §4 C2) classified every entry below: NONE is a cross-fleet
  // physiology threshold, so by design they stay here, OUT of DexKernel.K. They are SpO2-signal-only
  // oscillation params (no other node consumes SpO2) + an O2Ring-S firmware device quirk — none is
  // read by any shared cross-night/fusion code, and moving them into the kernel would bump
  // KERNEL_HASH (re-bundling all 8 nodes + regenerating every fixture) for zero cross-node benefit.
  // The genuinely shared thresholds already live in DexKernel.K (P8/KERNEL-BUILD pass); the
  // cross-node RR/Malik bounds (ECG/Pulse 300/2200/0.20 vs PPG 300/2000/0.30) are intentionally
  // per-signal (see ppgdex-dsp.js + DEX-DSP-AUDIT-BEATS-ARTIFACT.md) and likewise stay node-local.
  var CFG = {
    HR_SPIKE_MIN_PEAK: 75, // node-local: sensitivity floor of OxyDex's oximeter-pulse arousal/spike detector (no other node detects HR "spikes")
    /* Physiologic ceiling on 1 s cardiac acceleration, applied at the SPIKE level as a backstop behind
       HR_ARTIFACT_JUMP/_SOFT above (which clean the impossible SAMPLES first). Same value as _SOFT on
       purpose — the physiology is identical; what differs is that this one is NOT gated on clock
       position, so it also catches an artifact that drifted off the hour. Measured over 37 O2Ring
       nights: genuine arousals peak at 7 BPM/s, artifact onsets run 15-56, so this separates them with
       >2x headroom and zero false rejections on the post-firmware-fix control.
       See detectSpikes + O2RING-HOURLY-HR-ARTIFACT-2026-08-02-BRIEF. */
    HR_SPIKE_MAX_PHYSIOLOGIC_RISE: 15, // BPM per 1 s sample
    SPIKE_COOLDOWN_SEC: 30, // node-local: spike-detector refractory window (algorithmic, not a physiology grade)
    SPO2_OSC_THRESHOLD: 95, // node-local: SpO2 oscillation crossing level — SpO2 is an OxyDex-only signal; not referenced by any cross-node/fusion logic
    OSC_WINDOW_SEC: 300, // node-local: 5-min oscillation-analysis window (algorithmic)
    OSC_FLAG_CROSSINGS: 6, // node-local: min 95%-crossings to flag a periodic-breathing window (detector tuning)
    // OXYDEX-PB-DETECTOR §2 — the periodicity gate. These constants ARE the detector's spec; §2.3
    // measured each against the adversarial twins, so none is a free knob to retune against a corpus
    // episode count (that is the tuning the brief's §5 forbids).
    PB_BASELINE_WIN_SEC: 181, // rolling-median baseline, ~1.4x the 130 s ceiling so one cycle cannot flatten it
    PB_CYCLE_MIN_SEC: 40, // §2.1 SETTLED: AASM's FLOOR (Berry 2012) — not the low end of a 40-90 window
    PB_CYCLE_MAX_SEC: 130, // §2.1 SETTLED: ~mean+2SD of the worst-LVEF group's 86+/-23 s (Wedewardt 2010)
    // §2 criterion 3, counted on DISJOINT pairs (§2.2). AASM's floor is >= 3 consecutive events, and
    // this is deliberately ONE HIGHER. AASM scores central apneas/hypopneas from airflow on a PSG; this
    // estimator sees SpO2 crossings from a wrist oximeter, which is the noisier instrument. At 3 the
    // measured false-positive rate on the aperiodic twin is 5/40 seeds — a random dip train contains a
    // chance run of three similar gaps. At 4 it is 0/40, with true positives unchanged at 40/40 for
    // both 0 s and +/-10 s cycle jitter. The extra cycle costs no sensitivity and is not free-tuned.
    PB_MIN_CYCLES: 4,
    PB_MIN_AMP: 2, // %SpO2 peak-to-trough; stops 1 Hz integer dither reading as an oscillation
    PB_MAX_CYCLE_CV: 0.13, // §2.3 criterion 4 (REGULARITY): rejects 0/40 red-noise seeds (min CV 0.147), accepts 40/40 PB to +/-10 s jitter (max CV 0.111)
    // O2Ring-S FIRMWARE DEVICE QUIRK — confirmed by Wellue engineering (May 2026, SN 2592302100,
    // fw 1.0.5.0): a timer-driven routine at the top of each clock hour injects a +21–25 BPM step in
    // ONE 1-s sample (SpO2 flat, motion zero), within ±60 s of the hour. Genuinely O2Ring-local —
    // never a kernel constant; no other device/node exhibits it.
    HR_ARTIFACT_JUMP: 20, // node-local: BPM jump in 1 sample — always artifact (physiologically impossible)
    HR_ARTIFACT_JUMP_SOFT: 15, // node-local: BPM jump in 1 sample within ±2min of a clock hour — clock-aligned O2Ring artifact
    HR_ARTIFACT_MAX_RUN_SEC: 60, // node-local: cap (seconds, ≈samples at O2Ring's ~1 Hz) on how long
    // cleanArtifactHR keeps clamping toward one anchor before giving up on
    // it — see cleanArtifactHR below (OXYDEX-HR-ARTIFACT-RUNAWAY-FIX). A
    // real artifact resolves in seconds; this bounds the blast radius of a
    // bad anchor to ~1 min instead of the rest of the recording.
    // OXYDEX-HR-ARTIFACT-RUNAWAY-FIX Fix 2 (2026-07-03) — device warm-up / cool-down PLACEHOLDER trim.
    // The O2Ring emits a byte-frozen (SpO2,HR) block — observed SpO2 84 / HR 100 — for the seconds
    // before the finger/ear clip gets an optical perfusion lock, then the real signal appears with an
    // abrupt lock-on step. That placeholder seeded BOTH the runaway HR clamp AND a false critical
    // minSpo2. Trim is ADAPTIVE (per-night length; 0 / 8 / 25 s observed) + CONSERVATIVE (see
    // trimSensorWarmup). Node-local: no other device/node exhibits this placeholder.
    WARMUP_MIN_SEC: 5, // shortest frozen edge-run to treat as warm-up (≈samples @1 Hz); a 2–3 s flat is normal real signal → kept
    WARMUP_MAX_SEC: 300, // never trim more than 5 min of edge as warm-up (safety cap)
    WARMUP_SPO2_STEP: 4, // min abrupt SpO2 step at the perfusion-lock boundary confirming the frozen run was a placeholder (OR'd with |ΔHR|≥HR_ARTIFACT_JUMP)
    // OXYDEX-NADIR-HONESTY (RUNAWAY-FIX-FOLLOWUPS §1/§2) — the headline nadir (minSpo2 / SPO2_CRITICAL_DIP /
    // impression) ignores non-physiological lows: an opening perfusion-settling RAMP (§1) + self-gated
    // ARTIFACT desaturations (§2, the tested SELFGATE verdict). Node-local; SpO2 is an OxyDex-only signal.
    NADIR_RAMP_START_MAX: 88, // opening qualifies as a settling ramp only if the FIRST sample is ≤ this
    NADIR_RAMP_RECOVER: 90, // …and it climbs to ≥ this (a normal plateau)
    NADIR_RAMP_MAX_SEC: 120 // …within this many seconds (else it is real low SpO2, not sensor settling)
  };

  // Capture clean parser source for self-download (runs before any results are rendered)
  var APP_VERSION = 'v1.0.0';
  var _parserSource = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;

  var allNights = {};

  // ═══════════════════════════════════════════
  // FILE HANDLING
  // ═══════════════════════════════════════════
  var _fi = document.getElementById('fileInput');
  if (_fi) {
    // 'change' fires on desktop; 'input' is more reliable on Android Chrome
    var _lastFileSelect = 0;
    function _onFileSelect(e) {
      var now = Date.now();
      if (now - _lastFileSelect < 500) return;
      _lastFileSelect = now;
      var files = Array.from(e.target.files || (e.target && e.target.files) || []);
      if (files.length) {
        handleFiles(files);
      }
    }
    _fi.addEventListener('change', _onFileSelect);
    _fi.addEventListener('input', _onFileSelect); // Android backup
  }
  var ua = document.getElementById('uploadArea');
  if (ua) {
    // Phase-9: guard so oxydex-dsp.js loads headless (isolation host has no #uploadArea — SIGNAL-ADAPTER-FOLLOWUPS §4)
    ua.addEventListener('dragover', function (e) {
      e.preventDefault();
      /** @type {HTMLElement} */ (ua).classList.add('drag');
    });
    ua.addEventListener('dragleave', function () {
      /** @type {HTMLElement} */ (ua).classList.remove('drag');
    });
    ua.addEventListener('drop', function (e) {
      e.preventDefault();
      /** @type {HTMLElement} */ (ua).classList.remove('drag');
      var files = Array.from(/** @type {any} */ (e.dataTransfer).files || []);
      if (files.length) handleFiles(files);
    });
  }

  // ═══════════════════════════════════════════
  // O2RING NATIVE BINARY (.bin / renamed .txt)
  // ═══════════════════════════════════════════
  // The O2Ring stores its recording as a compact binary: a 10-byte header
  // (01 03 00 00 00 00 00 00 04 00) followed by one 3-byte record PER SECOND —
  // [SpO2, PulseRate, Motion]. An 'ff ff xx' record marks the end-of-data / gap
  // trailer. This holds the SAME 1Hz data the device's CSV export contains (no
  // extra optical/PPG waveform). We decode it to the standard O2Ring CSV text and
  // hand it to parseCSV() so every downstream metric is computed identically.
  function isO2RingBin(bytes) {
    if (!bytes || bytes.length < 40) return false;
    if (bytes[0] !== 0x01 || bytes[1] !== 0x03) return false; // signature
    for (var i = 2; i <= 7; i++) {
      if (bytes[i] !== 0x00) return false;
    }
    if (bytes[8] !== 0x04 || bytes[9] !== 0x00) return false;
    return true;
  }
  function _o2p2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  /* ════ CANONICAL CLOCK · CLOCK-UNIFY (duplicated locally per app) ═══════════
   tMs = floating wall-clock ms: the recording's LOCAL civil time encoded as if
   it were UTC. ALWAYS read back via getUTC* getters. Viewer-timezone-independent.
   parseTimestamp(raw,opts) → { tMs, offsetMin } | null. See CLOCK-UNIFY-BRIEF.md §1. */
  /* ── §1 CLOCK CONTRACT — single-sourced in clock.js (A5, owner-ratified 2026-07-03;
   OWN-THE-BUILD-FOLLOWUPS §3). The former verbatim mirror block lived here; clock.js now
   carries THE canonical tzOffset + _ckP2/_ckNumEpoch/_ckZoneMin/_ckDMY + parseTimestamp and
   loads BEFORE this file in every
   host + bundle (dex-coload.js / *.src.html). Local aliases keep every internal call site
   and the back-compat re-export tail byte-compatible. ── */
  var tzOffset = DexClock.tzOffset,
    _ckP2 = DexClock._ckP2,
    _ckNumEpoch = DexClock._ckNumEpoch,
    _ckZoneMin = DexClock._ckZoneMin,
    _ckDMY = DexClock._ckDMY,
    parseTimestamp = DexClock.parseTimestamp;
  // Floating-ms date anchor (00:00) for a recording: filename 14-digit date, else
  // file.lastModified (as floating wall-clock), else null. Used for time-only rows.
  /* §F2 (DEEP-AUDIT-III-FOLLOWUPS) — VALIDATE THE COMPONENTS, and ANCHOR the regex.
     This surfaced as the ADJACENT finding when the audit refuted a different claim, so it never reached
     the punch-list — two audit classes, zero tickets. Both defects are real and measured:
       · `Date.UTC` SILENTLY ROLLS out-of-range components (Clock Contract §2.7), so a filename run of
         `20261332999999` (month 13, day 32) produced a night dated 2027-02-01, and `99999999999999`
         produced 10007-06-07. A fabricated instant, from a filename, with no flag.
       · the capture is UNANCHORED (class 12), so on a name carrying an 8-digit device serial the first
         14 consecutive digits found need not be the stamp at all.
     `clock.js` already solved exactly this in `_ckMk` — a date that does not round-trip is refused —
     so this validates the same way rather than inventing a second rule. Refusing returns null, which
     `_o2DateAnchorMs` already treats as "date unknown"; that path is honest and already exercised. */
  function _o2DateAnchorMs(fname, file) {
    var m = String(fname || '').match(/(?:^|[^0-9])(\d{14})(?:[^0-9]|$)/);
    if (m) {
      var s = m[1];
      var _y = +s.slice(0, 4),
        _mo = +s.slice(4, 6),
        _d = +s.slice(6, 8);
      var _t = Date.UTC(_y, _mo - 1, _d);
      var _rt = new Date(_t);
      // round-trip: a rolled component (month 13, Feb 30, day 32) cannot survive this
      if (_rt.getUTCFullYear() === _y && _rt.getUTCMonth() === _mo - 1 && _rt.getUTCDate() === _d) return _t;
      return null; // out-of-range stamp ⇒ date unknown, never a fabricated night
    }
    if (file && file.lastModified) {
      var fl = _ckNumEpoch(file.lastModified);
      if (fl) {
        var d = new Date(fl.tMs);
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      }
    }
    return null;
  }
  // Start instant (floating wall-clock ms) for the .bin decoder. The .bin body carries NO absolute
  // time (just 3-byte SpO2/HR/motion records at 1 Hz), so the date can only come from the 14-digit
  // filename stamp or file.lastModified. Neither present ⇒ the date is genuinely UNKNOWN → null
  // (Clock Contract §4). NEVER fabricate now(): that stamped the whole night at the current instant,
  // mis-placing an undated recording in crossnight/fusion at a real, wrong date. (Sibling
  // _o2DateAnchorMs already returns null here — this makes the two symmetric.)
  function _o2BinStartMs(fname, file) {
    var m = String(fname || '').match(/(\d{14})/);
    if (m) {
      var p = parseTimestamp(m[1]);
      if (p) return p.tMs;
    }
    if (file && file.lastModified) {
      var fl = _ckNumEpoch(file.lastModified);
      if (fl) return fl.tMs;
    }
    return null; // date unknown — do not fabricate (Clock Contract §4)
  }
  /* FINISHED-WORK-IMPROVEMENTS §A 2a — VERIFY the ring's binary .dat timebase against the host.
     `decodeO2RingBinToCSV` anchors on the 14-digit filename stamp — i.e. the RING RTC, unverified.
     `capture-host/writers.RingClockLogWriter` writes `*_rtclog.csv` per session with rows shaped
     `Phone timestamp;event;rtc_offset_s;battery_state;battery_level;battery_raw2;battery_raw3`.
     If a sidecar is dropped in the batch, DECLARE the verification against it. Never SHIFT time —
     the house rule at `oxydex-dsp.js:3235` (a silent correction becomes an invisible bug). */
  function parseRingClockLog(text) {
    if (typeof text !== 'string' || !text) return [];
    var lines = text.split(/\r?\n/);
    var out = [];
    for (var i = 1; i < lines.length; i++) {
      var c = lines[i].split(';');
      if (c.length < 3) continue;
      var p = parseTimestamp(c[0], {});
      if (!p || !isFinite(p.tMs)) continue;
      var offRaw = c[2];
      var offS = offRaw !== '' && offRaw != null && isFinite(+offRaw) ? +offRaw : null;
      out.push({ tMs: p.tMs, event: c[1], offsetS: offS });
    }
    return out;
  }
  /* MATCH a decoded night against the sidecar rows and DECLARE — never CORRECT — its RTC verdict.
     Contract:
       reset-suspect inside the night's span ⇒ `rtcResetSuspect=true` + verification BLOCKED (a reset's
         offset is unmeasured by definition, so no `timingSource`/`rtcOffsetS` is attached even if
         reads exist alongside it).
       otherwise, the NEAREST `read` event within ±12 h of `t0Ms` becomes the verification anchor —
         `timingSource='device+host-verified'`, `rtcOffsetS=offsetS`, `rtcVerifiedAtMs=event.tMs`.
       no read within ±12 h ⇒ verification silently absent (the export block stays byte-identical
         to the same night decoded without a sidecar). */
  function _o2AttachRtcVerification(night, log) {
    if (!night || !night.stats || !isFinite(night.stats.startTs) || !log || !log.length) return;
    var t0 = night.stats.startTs;
    var durMs = isFinite(night.stats.durationMin) ? night.stats.durationMin * 60000 : 0;
    var TOL_MS = 12 * 3600000;
    for (var i = 0; i < log.length; i++) {
      var e = log[i];
      if (e.event === 'reset-suspect' && e.tMs >= t0 && e.tMs <= t0 + durMs) {
        night.rtcResetSuspect = true;
        return;
      }
    }
    var bestR = null,
      bestD = Infinity;
    for (var j = 0; j < log.length; j++) {
      var r = log[j];
      if (r.event !== 'read' || r.offsetS == null) continue;
      var d = Math.abs(r.tMs - t0);
      if (d > TOL_MS) continue;
      if (d < bestD) {
        bestR = r;
        bestD = d;
      }
    }
    if (bestR) {
      night.timingSource = 'device+host-verified';
      night.rtcOffsetS = bestR.offsetS;
      night.rtcVerifiedAtMs = bestR.tMs;
    }
  }

  /* ACQ-EVIDENCE-CONTRACT Phase C — attach the Acquisition Evidence envelope to a night by matching the
     envelope's session_id against the .dat night's source filename stamp. DECLARE, never modify: the
     envelope is surfaced read-only and touches NO science field (contract §4). A night with no matching
     envelope is unchanged (§19 back-compat). */
  function _o2AttachAcqEvidence(night, bag) {
    if (!night || !bag) return;
    var fname = night.fname || '';
    for (var sid in bag) {
      if (!Object.prototype.hasOwnProperty.call(bag, sid)) continue;
      if (sid && fname.indexOf(sid) >= 0) {
        night.acquisitionEvidence = bag[sid];
        return;
      }
    }
  }
  function decodeO2RingBinToCSV(bytes, fname, file) {
    var tMs = _o2BinStartMs(fname, file); // floating wall-clock ms, or null when the date is unknown
    var dated = tMs != null;
    var relS = 0; // relative seconds from record 0, used when the absolute date is unknown
    var out = ['Time,Oxygen Level,Pulse Rate,Motion'];
    for (var off = 10; off + 3 <= bytes.length; off += 3) {
      var s = bytes[off],
        h = bytes[off + 1],
        mo = bytes[off + 2];
      if (s === 0xff && h === 0xff) break; // end-of-data / trailer
      var stamp;
      if (dated) {
        // ISO timestamp built from floating ms via UTC getters → parseTimestamp step 3
        // (no zone) re-encodes with Date.UTC(components) → identical tMs to the CSV.
        var t = new Date(tMs);
        stamp = t.getUTCFullYear() + '-' + _o2p2(t.getUTCMonth() + 1) + '-' + _o2p2(t.getUTCDate()) + 'T' + _o2p2(t.getUTCHours()) + ':' + _o2p2(t.getUTCMinutes()) + ':' + _o2p2(t.getUTCSeconds());
        tMs += 1000;
      } else {
        // Date unknown → emit a time-only HH:MM:SS clock (no fabricated date). Downstream parseCSV
        // rolls it forward monotonically against whatever dateAnchor it can find (_o2DateAnchorMs),
        // and leaves the night undated when there is none — never today's date on an undated file.
        stamp = _o2p2(Math.floor(relS / 3600) % 24) + ':' + _o2p2(Math.floor(relS / 60) % 60) + ':' + _o2p2(relS % 60);
        relS += 1;
      }
      out.push(stamp + ',' + s + ',' + h + ',' + mo * 2);
    }
    return out.join('\n');
  }

  function handleFiles(files) {
    safeStyle('errorMsg', 'display', 'none');
    // SELF-INGEST: a fresh load starts NON-review; readFile re-sets window._oxyReview only when an
    // envelope is among the dropped files (renderAll honors it only if every loaded night is from it).
    try {
      window._oxyReview = null;
    } catch (_rv) {}
    // N2 (PRIVACY-SECURITY-AUDIT-2026-07-13): removed a console.log dumping every dropped filename.
    var _rEl = safeEl('results');
    if (!_rEl) return;
    _rEl.innerHTML = '<div class="results-loading">⏳ Reading ' + files.length + ' file' + (files.length > 1 ? 's' : '') + '…</div>';
    safeStyle('results', 'display', 'block');
    _ui.setProgress(3);

    // Per-file progress tracking
    var completed = 0;
    var total = files.length;

    function onFileComplete() {
      completed++;
      var pct = 5 + Math.round((completed / total) * 75); // 5–80% for parsing
      _ui.setProgress(pct);
      _ui.setStatus('Parsed ' + completed + ' / ' + total + ' file' + (total > 1 ? 's' : '') + '…');
    }

    var promises = files.map(function (f) {
      return readFile(f).then(function (r) {
        onFileComplete();
        return r;
      });
    });

    Promise.all(promises)
      .then(function (results) {
        _ui.setProgress(85);
        _ui.setStatus('Building analytics…');
        results.filter(Boolean).forEach(function (r) {
          var nightArr = Array.isArray(r) ? r : [r];
          nightArr.forEach(function (night) {
            if (!night || !night.date) return;
            // Duplicate check by startTs (same recording imported twice, possibly
            // under a different filename e.g. .csv vs .csv.xls from Excel)
            if (night.stats && night.stats.startTs) {
              var ts = night.stats.startTs;
              var isDup = Object.values(allNights).some(function (ex) {
                return ex.stats && ex.stats.startTs && Math.abs(ex.stats.startTs - ts) < 30000;
              });
              if (isDup) {
                if (!window._csvParseErrors) window._csvParseErrors = [];
                window._csvParseErrors.push('Skipped duplicate recording: ' + (night.fname || night.date) + ' — same start time as an already-loaded night.');
                return; // skip
              }
            }
            var key = night.date;
            var suffix = 2;
            while (allNights[key]) {
              key = night.date + '#' + suffix++;
            }
            night.key = key;
            allNights[key] = night;
          });
        });
        // FINISHED-WORK-IMPROVEMENTS §A 2a — after every file resolves, match each .bin/.dat night
        // against the sidecar bag and declare its RTC verification (or a reset-suspect VETO). Runs
        // BEFORE the empty-batch guard because a batch with only a sidecar and no .bin still exits
        // cleanly (`_o2BinSource` filter → zero matches, nothing attached).
        try {
          var _rtcLog = (typeof window !== 'undefined' && window._oxyRtcLog) || [];
          if (_rtcLog.length) {
            Object.keys(allNights).forEach(function (_k) {
              var _n = allNights[_k];
              if (_n && _n._o2BinSource === true) _o2AttachRtcVerification(_n, _rtcLog);
              if (_n) _o2AttachAcqEvidence(_n, (typeof window !== 'undefined' && window._oxyAcqEvidence) || null);
            });
          }
        } catch (_eRt) {
          /* the matcher is pure — a throw here means a shape we did not expect, not a compute path */
        }
        var nights = Object.keys(allNights);
        console.log('[O2Ring] Parsed nights:', Object.keys(allNights).length); // N2: dropped the date-list dump
        if (!nights.length) {
          var dbg = window._csvParseErrors && window._csvParseErrors.length ? '\n\nDebug info:\n' + window._csvParseErrors.join('\n') : '';
          var errMsg = 'No valid data found. Upload raw O2Ring CSV files (O2Ring S *.csv) or pre-processed .json/.jsonl summaries.' + dbg;
          _ui.showError(errMsg);
          safeSet('results', 'innerHTML', '<div class="results-error"><strong>⚠️ Parse failed</strong><br>' + errMsg.replace(/\n/g, '<br>') + '</div>');
          safeStyle('results', 'display', 'block');
          window._csvParseErrors = [];
          return;
        }
        _ui.setProgress(95);
        _ui.setStatus('Rendering ' + nights.length + ' night' + (nights.length > 1 ? 's' : '') + '…');
        // Small yield to let the progress bar repaint before heavy render
        setTimeout(function () {
          _ui.setProgress(100);
          // SECURITY-REMEDIATION-2026-07-11 F4 (drop): removed the _cacheO2CSV call that persisted the
          // whole raw CSV to localStorage — raw recordings no longer sit at rest (minimization-clean;
          // also removes F1's payload). The window._cacheO2CSV definition went with the shell block.
          _ui.setStatus('');
          _ui.renderAll();
          // Waveform SpO₂ pairs (0x05 stream + device CSV): compute + render once both halves are in.
          // A lone pair matches by exclusivity when the stems differ (e.g. re-exported filenames).
          try {
            var _w2 = window._oxyW2 || {};
            var _w2s = window._oxyW2S || {};
            var _wk = Object.keys(_w2);
            var _sk = Object.keys(_w2s);
            _wk.forEach(function (stem) {
              var exact = Object.prototype.hasOwnProperty.call(_w2s, stem);
              var rows2 = exact ? _w2s[stem] : _wk.length === 1 && _sk.length === 1 ? _w2s[_sk[0]] : null;
              if (!rows2) return;
              var res = spo2WaveformTrend(parsePPG2W(_w2[stem]), rows2);
              /* An EXACT-stem pair always renders — including its refusals; that is the honesty
                 surface. The lone-pair exclusivity fallback exists for re-exported filenames, and it
                 can guess WRONG across sessions (measured 2026-08-20: it paired a fresh waveform with
                 a stale device series from an earlier drop — zero time overlap — then consumed the
                 stash, so the REAL pair arriving one drop later found nothing to pair with). So the
                 fallback only COMMITS (renders + consumes) when the trend is actually usable; an
                 unusable guess leaves the stash intact for the right partner. */
              if (exact || res.usable) {
                if (typeof window.oxyRenderSpo2w === 'function') window.oxyRenderSpo2w(res, stem);
                delete _w2[stem];
              }
            });
          } catch (_ew2) {
            /* a trend failure must never block night rendering */
          }
          safeSet('fileInput', 'value', '');
          // Surface any per-file parse warnings as a non-blocking banner
          if (window._csvParseErrors && window._csvParseErrors.length) {
            var warnEl = document.getElementById('results');
            if (warnEl) {
              var banner = document.createElement('details');
              banner.className = 'parse-warning-banner';
              var _errLines = window._csvParseErrors
                .map(function (e) {
                  return '<div class="warning-line">' + escHTML(e) + '</div>';
                })
                .join('');
              banner.innerHTML =
                '<summary class="pwb-summary">' +
                '<span class="pwb-header">⚠️ ' +
                window._csvParseErrors.length +
                ' file(s) had parse issues</span>' +
                '<button class="btn btn-outline pwb-dismiss" data-act="removeClosest" data-sel=".parse-warning-banner">✕</button>' +
                '</summary>' +
                '<div class="pwb-body">' +
                _errLines +
                '</div>';
              warnEl.insertBefore(banner, warnEl.firstChild);
            }
            window._csvParseErrors = [];
          }
        }, 30);
      })
      .catch(function (e) {
        var errEl = document.getElementById('results');
        if (errEl) {
          errEl.innerHTML =
            '<div class="results-error-block">' +
            '<strong>⚠ Processing Error</strong><br><code class="error-code">' +
            escHTML(String(e)) +
            '</code>' + // F3: escape error text (may echo a crafted filename)
            '<br><br><button class="btn btn-outline" data-act="clearAll">Clear &amp; try again</button></div>';
          errEl.style.display = 'block';
        }
        console.error('processFiles catch:', e);
      });
  }

  function readFile(file) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var _buf = /** @type {any} */ (e.target).result; // ArrayBuffer
          var _bytes = new Uint8Array(_buf);
          // ── O2Ring native binary (.bin, or .bin renamed to .txt) ──
          if (isO2RingBin(_bytes)) {
            var _binCsv = decodeO2RingBinToCSV(_bytes, file.name, file);
            var _binRows = parseCSV(_binCsv, { fname: file.name, file: file });
            if (!_binRows || _binRows.length < 60) {
              if (!window._csvParseErrors) window._csvParseErrors = [];
              window._csvParseErrors.push(file.name + ': binary decoded to ' + (_binRows ? _binRows.length : 0) + ' rows (need \u226560).');
            }
            var _binNight = _binRows && _binRows.length >= 60 ? processNight(_binRows, file.name) : null;
            // FINISHED-WORK-IMPROVEMENTS §A 2a — a .bin/.dat night's timebase is the RING RTC (via the
            // 14-digit filename stamp); mark it so the drop-batch matcher below knows this is the
            // RTC-auditable population (a CSV night is host-stamped by the phone — attaching a
            // sidecar read's offset there would misattribute).
            if (_binNight) _binNight._o2BinSource = true;
            resolve(_binNight);
            return;
          }
          // Ring-clock sidecar (\`*_rtclog.csv\`, capture-host/writers.py:RingClockLogWriter). Stash
          // rows onto a batch bag; the pairing with each .bin/.dat night runs after every file
          // resolves, so drop order does not matter (same posture as \`_PPG2W.txt\`/\`_SPO2.csv\`).
          if (/_rtclog\.csv$/i.test(file.name)) {
            var _rtcText = new TextDecoder('utf-8').decode(_buf);
            var _rtcRows = parseRingClockLog(_rtcText);
            if (_rtcRows.length) {
              window._oxyRtcLog = (window._oxyRtcLog || []).concat(_rtcRows);
            }
            resolve(null);
            return;
          }
          // Acquisition Evidence sidecar (`*.meta.json`, capture-host/pull_session.py — the generalized
          // sidecar carrying `acquisition_evidence`, ACQ-EVIDENCE-CONTRACT-2026-08-24-BRIEF Phase C).
          // Same batch-bag posture as the rtclog above: stash the envelope keyed by session_id; the
          // pairing with each .dat night runs after every file resolves, so drop order does not matter.
          // READ-ONLY surfacing — this NEVER gates or modifies any science (contract §4); a batch with
          // no envelope behaves exactly as today (contract §19 back-compat).
          if (/\.meta\.json$/i.test(file.name)) {
            try {
              var _metaObj = JSON.parse(new TextDecoder('utf-8').decode(_buf));
              var _acqEv = _metaObj && _metaObj.acquisition_evidence;
              if (_acqEv && _acqEv.session_id) {
                window._oxyAcqEvidence = window._oxyAcqEvidence || {};
                window._oxyAcqEvidence[_acqEv.session_id] = _acqEv;
              }
            } catch (_me) {
              /* a malformed sidecar is ignored — never blocks the night's own science */
            }
            resolve(null);
            return;
          }
          // ── Text formats (CSV / JSON / JSONL) — decode UTF-8 (== old readAsText) ──
          var text = new TextDecoder('utf-8').decode(_buf).trim();
          // Auto-detect: JSON/JSONL (pre-processed summaries) vs raw CSV
          if (text.charAt(0) === '{' || text.charAt(0) === '[') {
            // ── SELF-INGEST: route OxyDex's OWN ganglior.node-export envelope (SELF-INGEST-2026-06-27) ──
            // The v2.0 envelope starts with '{' and has NO top-level date, so parseJSONL returns [] and
            // the single-object branch (needs .date) would miss it. Detect + route to oxyLoadOwnExport
            // BEFORE the legacy paths; a foreign-node export is rejected with a redirect message (surfaced
            // via _csvParseErrors), never mis-loaded. renderAll honors review mode only when EVERY loaded
            // night is _fromExport (a mixed raw+export batch falls back to the normal analysis view).
            try {
              var _env = JSON.parse(text);
              if (_env && _env.schema && _env.schema.name === 'ganglior.node-export') {
                var _r = oxyLoadOwnExport(_env);
                if (!_r.ok) {
                  if (!window._csvParseErrors) window._csvParseErrors = [];
                  window._csvParseErrors.push((file && file.name ? file.name + ': ' : '') + _r.message);
                  resolve(null);
                  return;
                }
                window._oxyReview = {
                  provenance: _r.provenance,
                  generated: _r.generated,
                  kernel: _r.kernel,
                  events: _r.events,
                  crossNight: _r.crossNight,
                  node: _r.node,
                  scrubbed: _r.scrubbed,
                  derivedFrom: _r.derivedFrom,
                  recording: _r.recording,
                  multiNight: _r.multiNight
                };
                resolve(_r.nights);
                return;
              }
            } catch (_eEnv) {
              /* not parseable as one JSON object \u2014 fall through to JSONL/array paths */
            }
            var nights = parseJSONL(text);
            if (nights.length) {
              resolve(nights);
              return;
            }
            // Try single JSON object
            try {
              var single = JSON.parse(text);
              if (single && single.date) {
                resolve([single]);
                return;
              }
            } catch (e2) {
              console.warn('[O2Ring] suppressed error:', e2);
            }
            resolve(null);
            return;
          }
          // O2Ring/OxyDex summary export is EXPORT-ONLY (DEX-EVENT-UNIFY-AND-CSV-BRIEF Task B).
          // It is NOT a re-import boundary: reconstructing a full night by string-matching ~80
          // human labels was lossy by construction and the dominant historical OxyDex bug source
          // (0-is-falsy drops, key-trim mismatches, ReferenceErrors). To reload an analyzed night,
          // use its .json export — parseJSONL / single-JSON round-trips the full night losslessly.
          var cleanText = text.replace(/^[\uFEFF\r\n\s]+/, '');
          // N2: removed console.log of raw cleanText bytes.
          // Waveform SpO₂ pair intake (owner-ordered 2026-08-20, moved from PpgDex — OxyDex is the
          // SpO₂ node): a capture-host `_PPG2W.txt` is the O2Ring 0x05 raw two-channel stream, not a
          // night CSV. Stash it for pairing with its `_SPO2.csv` sibling; the pairing + trend render
          // happen after ALL dropped files are read, so drop order cannot matter. Never a night alone.
          if (/_PPG2W\.txt$/i.test(file.name)) {
            (window._oxyW2 = window._oxyW2 || {})[file.name.replace(/_PPG2W\.txt$/i, '')] = text;
            resolve(null);
            return;
          }
          if (cleanText.indexOf('OxyDex Night Summary') === 0 || cleanText.indexOf('O2Ring Night Summary') === 0) {
            if (!window._csvParseErrors) window._csvParseErrors = [];
            window._csvParseErrors.push(
              file.name + ': this is a human-readable summary CSV (export-only). ' + 'To reload a night, use its .json export. Raw O2Ring CSVs and .json/.jsonl still import normally.'
            );
            resolve(null);
            return;
          }

          // Raw CSV path
          var rows = parseCSV(text, { fname: file.name, file: file });
          // The _SPO2.csv half of a waveform pair: keep the parsed rows for spo2WaveformTrend (the
          // night itself still loads normally below — the trend is an EXTRA card, never a replacement).
          if (/_SPO2\.csv$/i.test(file.name) && rows && rows.length) {
            (window._oxyW2S = window._oxyW2S || {})[file.name.replace(/_SPO2\.csv$/i, '')] = rows;
          }
          if (!rows || rows.length < 60) {
            // Debug: store first lines for error reporting
            var preview = text.split(/\r?\n/).slice(0, 3).join(' | ');
            if (!window._csvParseErrors) window._csvParseErrors = [];
            window._csvParseErrors.push(file.name + ': ' + rows.length + ' rows parsed. Preview: ' + preview.substring(0, 120));
          }
          resolve(rows && rows.length >= 60 ? processNight(rows, file.name) : null);
        } catch (err) {
          if (!window._csvParseErrors) window._csvParseErrors = [];
          window._csvParseErrors.push(file.name + ' ERROR: ' + (err && err.message ? err.message : String(err)));
          resolve(null);
        }
      };
      reader.onerror = function () {
        if (!window._csvParseErrors) window._csvParseErrors = [];
        window._csvParseErrors.push(file.name + ': file could not be read (FileReader error)');
        resolve(null);
      };
      reader.readAsArrayBuffer(file);
    });
  }

  // ═══════════════════════════════════════════
  // PARSE
  // ═══════════════════════════════════════════
  function parseCSV(text, fileMeta) {
    text = text.replace(/^\uFEFF/, '');
    var lines = text.split(/\r?\n/);
    if (!lines.length) return [];

    // Detect header and column mapping
    var headerLine = '',
      headerIdx = 0;
    for (var i = 0; i < Math.min(8, lines.length); i++) {
      var l = lines[i].toLowerCase();
      if (l.indexOf('spo2') >= 0 || l.indexOf('pulse') >= 0 || l.indexOf('time') >= 0 || l.indexOf('o2') >= 0) {
        headerLine = lines[i].toLowerCase();
        headerIdx = i;
        break;
      }
    }

    // DELIMITER (OXYDEX-PULSE-RESOURCING §4 Phase 1). The ViHealth SpO₂ export is comma-separated;
    // the Health-Box `*_OXYFRAME.txt` sidecar is a semicolon-separated SUPERSET of it — same
    // spo2/pulse/motion columns (so every SpO₂ metric is byte-identical either way) PLUS the O2Ring
    // live-header **perfusion index** (`pi_pct`, from frame byte [7]÷10) that the ViHealth CSV layout
    // has no column for. Detect the delimiter once so OxyDex can ingest either; a comma file simply
    // has no pi column and PI reads null (absent-safe, no fabrication).
    var DELIM = headerLine.indexOf(';') >= 0 && (headerLine.indexOf(';') < headerLine.indexOf(',') || headerLine.indexOf(',') < 0) ? ';' : ',';

    // Parse header columns
    var hcols = headerLine
      ? headerLine.split(DELIM).map(function (c) {
          return c.trim().replace(/[^a-z0-9]/g, '');
        })
      : [];
    var timeCol = -1,
      spo2Col = -1,
      hrCol = -1,
      motionCol = -1,
      piCol = -1;
    hcols.forEach(function (c, i) {
      if ((c.indexOf('time') >= 0 || c.indexOf('date') >= 0) && timeCol < 0) timeCol = i;
      if ((c.indexOf('spo2') >= 0 || c.indexOf('o2') >= 0 || c.indexOf('sao2') >= 0 || c.indexOf('oxygen') >= 0) && spo2Col < 0) spo2Col = i;
      if ((c.indexOf('pulse') >= 0 || c.indexOf('pr') === 0 || c.indexOf('hr') === 0 || c.indexOf('bpm') >= 0) && hrCol < 0) hrCol = i;
      if (c.indexOf('motion') >= 0 && motionCol < 0) motionCol = i;
      // `pi_pct` → 'pipct'; guard against 'ppi'/'spo2'/'pulse' by requiring it to START with 'pi' or name 'perfus'
      if ((c.indexOf('pi') === 0 || c.indexOf('perfus') >= 0) && piCol < 0) piCol = i;
    });

    // Fallback: if header detection failed or columns not found, try auto-detect from first data row
    var firstDataIdx = headerLine ? headerIdx + 1 : 0;
    if (timeCol < 0 || spo2Col < 0 || hrCol < 0) {
      // Try rows until we find a valid one
      for (var i = firstDataIdx; i < Math.min(firstDataIdx + 5, lines.length); i++) {
        var parts = lines[i].trim().split(',');
        if (parts.length < 3) continue;
        // Find which column looks like a timestamp (contains ':')
        for (var j = 0; j < Math.min(parts.length, 3); j++) {
          if (parts[j].indexOf(':') >= 0) {
            timeCol = j;
            spo2Col = j + 1;
            hrCol = j + 2;
            motionCol = j + 3 < parts.length ? j + 3 : -1;
            break;
          }
        }
        if (timeCol >= 0) break;
      }
    }

    // Last resort defaults
    if (timeCol < 0) timeCol = 0;
    if (spo2Col < 0) spo2Col = 1;
    if (hrCol < 0) hrCol = 2;

    var rows = [];
    var _anchorMs = fileMeta ? _o2DateAnchorMs(fileMeta.fname, fileMeta.file) : null;
    var _prevTMs = null;
    // CLOCK CONTRACT §3 — resolve the file's date order ONCE, before parsing any row. O2Ring ships BOTH
    // DD/MM/YYYY and MM/DD/YYYY; deciding per-row lets an MM/DD file flip order mid-file (06/12 → Dec 6,
    // then 06/13 → Jun 13), which runs the clock BACKWARD and collapses the night's ODI to 0.
    var _stamps = [];
    for (var _si = firstDataIdx; _si < lines.length; _si++) {
      var _sp = lines[_si].trim().split(DELIM);
      if (_sp.length >= 3 && timeCol < _sp.length) _stamps.push(_sp[timeCol].trim());
    }
    var _order = DexClock.resolveDMY(_stamps, true); // O2Ring default is DMY when genuinely ambiguous
    // §1.1 — pass the contradiction through so the ambiguous slash shapes refuse instead of guessing.
    // This is the node the finding's repro used: one anomalous row moved a proven-MDY night 6 months.
    var _tsOpts = { preferDMY: _order.dmy, dmyLocked: _order.locked, dmyContradictory: _order.contradictory === true };
    for (var i = firstDataIdx; i < lines.length; i++) {
      var p = lines[i].trim().split(DELIM);
      if (p.length < 3) continue;
      var tStr = timeCol < p.length ? p[timeCol].trim() : '';
      var sStr = spo2Col < p.length ? p[spo2Col].trim() : '';
      var hStr = hrCol < p.length ? p[hrCol].trim() : '';
      /* NO MOTION COLUMN IS ABSENCE, NOT STILLNESS (DEEP-AUDIT-V §2.3 F15 — bug class 3a).
         This defaulted to the STRING '0' whenever the file carried no Motion column (a 3-column
         oximeter CSV — a supported OxyDex input, `oxydex-spo2` detects it at 0.8) or the row was too
         short to reach it. Every downstream consumer reads `motion > 0` as movement, so "this device
         has no accelerometer" was published as "the body never moved". Measured on a real night with
         the Motion column removed and SpO₂/HR/time byte-identical:
             motionPct   1.8 → 0        motSleep.sleepEff  98.2 → 100
             wasoPct       4 → 0        sleepArch.wasoMin   8.4 → 0
             stab.components.motion 11 → 100 (a PERFECT motion sub-score) → stab.score 22 → 35
         `null` is the honest value and it reads correctly at every one of the ~20 consumer sites for
         free, because they all test `motion > 0` or `motion === 0` — and `null` satisfies NEITHER, so
         an absent reading is neither moving nor still. (Note this is the OPPOSITE of the `null >= 0`
         trap: `>=` would have admitted it. Do not "simplify" those comparisons to `>=`.)
         The ABSENCE is then handled once, at the same seam `_motionColumnStuck` already uses — see
         `_motionAbsent` in processNight. Deliberately unchanged: a PRESENT column with an empty or
         unparseable cell still reads 0, exactly as before; only a value that was never written at all
         becomes null. */
      var mStr = motionCol >= 0 && motionCol < p.length ? p[motionCol].trim() : null;
      if (!sStr || sStr === '- -' || sStr === '--' || sStr === '') continue;
      var spo2 = parseInt(sStr, 10),
        hr = parseInt(hStr, 10),
        motion = mStr == null ? null : parseInt(mStr, 10) || 0;
      if (isNaN(spo2) || isNaN(hr)) continue;
      if (spo2 < 50 || spo2 > 100 || hr < 20 || hr > 250) continue; // sanity check
      // Perfusion index (§4 Phase 1): present only on the OXYFRAME sidecar. `pi_pct` = 0 is the ring's
      // "no perfusion reading" sentinel, NOT a real 0 % — treat it as ABSENT (null), never as a value
      // (mirrors the SpO₂ '- -' handling above). A comma file has no pi column ⇒ piCol < 0 ⇒ null.
      var pi = null;
      if (piCol >= 0 && piCol < p.length) {
        var _pv = parseFloat(p[piCol]);
        if (isFinite(_pv) && _pv > 0) pi = _pv;
      }
      // CLOCK-UNIFY: floating wall-clock ms is the source of truth. row.t is a derived
      // compat Date, ALWAYS read back with getUTC*. Time-only rows anchor to _anchorMs
      // and roll forward monotonically past midnight (no Jan-2000, no +86400000 hack).
      var _ts = parseTimestamp(tStr, { dateAnchorMs: _anchorMs, prevTMs: _prevTMs, preferDMY: _tsOpts.preferDMY, dmyLocked: _tsOpts.dmyLocked, dmyContradictory: _tsOpts.dmyContradictory });
      if (!_ts) continue;
      _prevTMs = _ts.tMs;
      rows.push({ tMs: _ts.tMs, t: new Date(_ts.tMs), spo2: spo2, hr: hr, motion: motion, pi: pi });
    }
    return rows;
  }

  // ═══════════════════════════════════════════════════════════════════
  // parseSummaryCSV REMOVED (DEX-EVENT-UNIFY-AND-CSV-BRIEF Task B): the human-readable summary
  // CSV is now export-only. It reconstructed a full night by string-matching ~80 human labels —
  // lossy by construction and the dominant historical bug source. To reload an analyzed night,
  // use its .json export (parseJSONL round-trips losslessly). exportCSV is unchanged.
  // ═══════════════════════════════════════════════════════════════════
  /* parseSummaryCSV() removed — see comment above. */

  // CLOCK-UNIFY: parseTime is retired. The canonical parseTimestamp() (above) is the
  // single source of truth; parseCSV calls it directly with a dateAnchorMs + monotonic
  // prevTMs. This thin wrapper remains only for any legacy caller and returns a derived
  // Date built from floating wall-clock ms (read it back with getUTC*).
  function parseTime(s) {
    var p = parseTimestamp(s, { preferDMY: true });
    return p ? new Date(p.tMs) : null;
  }

  // ═══════════════════════════════════════════
  // ARTIFACT CLEANING
  // ═══════════════════════════════════════════

  // OXYDEX-HR-ARTIFACT-RUNAWAY-FIX Fix 2 (2026-07-03): trim a device warm-up / cool-down PLACEHOLDER
  // block from the edges BEFORE any metric reads the rows. Runs first in processNight — same class of
  // action as parseCSV already dropping the device's '- -' no-reading rows (a non-signal edge block,
  // not real data). The O2Ring holds a byte-frozen (SpO2,HR) placeholder (observed 84/100, motion 0)
  // until the optical perfusion lock, then the true signal starts with an abrupt lock-on step. Left in,
  // that block (a) pins cleanArtifactHR's baseline to the bogus 100 → runaway clamp, and (b) donates a
  // false critical nadir (SpO2 84) to the stats. Detection is:
  //   ADAPTIVE     — trims the frozen run's ACTUAL length (0/8/25 s seen), never a fixed window;
  //   CONSERVATIVE — the run must be byte-frozen-identical in (SpO2,HR), sit at the very edge, be
  //                  ≥ WARMUP_MIN_SEC long, AND be bounded from the real signal by an abrupt lock-on
  //                  step (SpO2 jump ≥ WARMUP_SPO2_STEP OR |ΔHR| ≥ HR_ARTIFACT_JUMP). A smoothly
  //                  settling flat (real elevated HR easing down, stable deep-sleep SpO2, an immediate
  //                  sample-1 lock) has no such step → NOT trimmed;
  //   BOUNDED      — never past WARMUP_MAX_SEC, never below a 60-row floor.
  // Returns {head, tail} counts and mutates `rows` in place so every downstream reader — cleanArtifactHR,
  // computeStats, t0Ms — sees the true signal start. Symmetric tail guard is belt-and-suspenders (this
  // night's cool-down is '- -' rows already dropped by parseCSV); it fires only on a frozen low block
  // entered via an abrupt step DOWN, so genuine stable-sleep flat tails are kept.
  function trimSensorWarmup(rows) {
    var n = rows.length;
    if (!n) return { head: 0, tail: 0 };
    var MIN = CFG.WARMUP_MIN_SEC,
      MAX = CFG.WARMUP_MAX_SEC;
    var SPO2_STEP = CFG.WARMUP_SPO2_STEP,
      HR_STEP = CFG.HR_ARTIFACT_JUMP,
      FLOOR = 60;
    if (n < FLOOR + MIN + 1) return { head: 0, tail: 0 }; // too short to safely trim anything

    // Length of the run of rows byte-identical in (spo2,hr) to rows[startIdx], walking dir (+1 / -1).
    function frozenRunLen(startIdx, dir) {
      var s = rows[startIdx].spo2,
        h = rows[startIdx].hr,
        len = 1,
        k = startIdx + dir;
      while (k >= 0 && k < n && rows[k].spo2 === s && rows[k].hr === h) {
        len++;
        k += dir;
      }
      return len;
    }

    // ── HEAD: frozen run from row 0, ended by an upward-SpO2 / big-ΔHR lock-on step ──
    var head = 0,
      hlen = frozenRunLen(0, +1);
    if (hlen >= MIN && hlen <= MAX && hlen < n) {
      var dS = rows[hlen].spo2 - rows[hlen - 1].spo2; // SpO2 step up = perfusion lock
      var dH = Math.abs(rows[hlen].hr - rows[hlen - 1].hr);
      if (dS >= SPO2_STEP || dH >= HR_STEP) head = hlen;
    }

    // ── TAIL: frozen run ending at the last row, ENTERED via an abrupt step down ──
    var tail = 0,
      tlen = frozenRunLen(n - 1, -1);
    if (tlen >= MIN && tlen <= MAX && tlen < n - head) {
      var pre = rows[n - 1 - tlen],
        first = rows[n - tlen];
      var dS2 = pre.spo2 - first.spo2; // step DOWN into placeholder
      var dH2 = Math.abs(pre.hr - first.hr);
      if (dS2 >= SPO2_STEP || dH2 >= HR_STEP) tail = tlen;
    }

    // ── FLOOR guard: never leave fewer than FLOOR rows (favor the head trim) ──
    if (n - head - tail < FLOOR) {
      if (n - head < FLOOR) head = Math.max(0, n - FLOOR);
      tail = Math.max(0, Math.min(tail, n - head - FLOOR));
    }

    if (tail) rows.splice(n - tail, tail); // splice tail first (original-n indices unaffected by head splice)
    if (head) rows.splice(0, head);
    return { head: head, tail: tail };
  }

  // Two-tier filter:
  //   Hard:  any 1-sample HR rise ≥ 20 BPM  → always artifact (physiologically impossible)
  //   Soft:  any 1-sample HR rise ≥ 15 BPM  within ±2 min of a clock hour → clock-aligned artifact
  //          (catches slower-ramp firmware cycles that don't trip the hard threshold)
  // OXYDEX-HR-ARTIFACT-RUNAWAY-FIX (2026-07-03, user-reported "100 bpm all night"): the recovery
  // search below used to run UNBOUNDED — if the signal never wandered back within RECOV of the
  // pre-jump `baseline`, every remaining row got overwritten with that one stale anchor, all the way
  // to the end of the recording. That anchor is often ITSELF the bad reading (an O2Ring warm-up /
  // contact-settling transient before the finger/ear clip seats — the first jump is usually seen in
  // the opening seconds), or the jump is a genuine sustained transition (e.g. awake→sleep HR drop)
  // that simply never returns near the pre-transition level. Either way, one early 1-sample trigger
  // could silently replace an entire multi-hour night with a flat, wrong number (observed: 22083 of
  // 22108 samples clamped to a flat 100 bpm, against the SAME night's independent ECGDex-measured
  // 48.4 bpm). HR_ARTIFACT_MAX_RUN_SEC bounds the search: if recovery hasn't arrived within that many
  // seconds, stop trusting the anchor and let the raw values stand — mirrors ECGDex's local-median
  // beat correction, which is bounded by construction (DEX-DSP-AUDIT-BEATS-ARTIFACT.md), and the
  // ECG-RPEAK-SEED-FIX precedent for a startup transient poisoning a whole-night detector.
  function cleanArtifactHR(rows) {
    var n = rows.length,
      cleaned = 0;
    var HARD = CFG.HR_ARTIFACT_JUMP;
    var SOFT = CFG.HR_ARTIFACT_JUMP_SOFT;
    var RECOV = HARD / 2;
    var MAX_RUN = CFG.HR_ARTIFACT_MAX_RUN_SEC; // O2Ring is ~1 Hz, so this doubles as a sample count
    var i = 1;
    while (i < n) {
      var rise = rows[i].hr - rows[i - 1].hr;
      var isHard = Math.abs(rise) >= HARD; // catch both sudden rises AND drops
      var isSoft = false;
      if (!isHard && rise >= SOFT) {
        var t = rows[i].t,
          minsec = t.getUTCMinutes() + t.getUTCSeconds() / 60;
        isSoft = minsec <= 2 || minsec >= 58; // v14: full ±2min at ANY clock hour
      }
      if (isHard || isSoft) {
        var baseline = rows[i - 1].hr,
          j = i;
        // For rises: recover when HR returns within RECOV of baseline
        // For drops: recover when HR returns within RECOV of baseline (above baseline-RECOV)
        var isRise = rise > 0;
        while (j < n && j - i < MAX_RUN && (isRise ? rows[j].hr > baseline + RECOV : rows[j].hr < baseline - RECOV)) {
          j++;
        }
        if (j - i >= MAX_RUN) {
          // Recovery never arrived within a plausible artifact duration — the anchor itself was bad, or
          // this is a real sustained transition. Bail WITHOUT clamping; resume scanning from j so a
          // genuinely new jump later on can still be caught against the (now-current) level.
          i = j;
        } else {
          for (var k = i; k < j; k++) {
            rows[k].hr = baseline;
            rows[k].hrArtifact = true;
            cleaned++;
          }
          i = j > i ? j : i + 1; // defensive: guarantee progress even if SOFT ≤ RECOV is ever configured
        }
      } else {
        i++;
      }
    }
    return cleaned;
  }

  // Post-spike-detection clock filter: removes spikes whose timestamp falls within
  // ±2 min of ANY clock hour (the :58–:02 window — v14; no hour gate, matching
  // cleanArtifactHR's soft-artifact rule). Catches gradual-ramp artifacts that the
  // single-sample HR cleaner cannot see.
  /* Reject the O2Ring's firmware HR artifact by WHAT IT IS, not by WHEN IT HAPPENS.
     (O2RING-HOURLY-HR-ARTIFACT-2026-08-02-BRIEF; vendor-confirmed by Wellue 2026-05-14 as a
     timer-driven routine that transiently double-counts cardiac cycles.)

     The previous rule dropped every spike landing within ±2 min of a clock hour — the vendor's own
     advice, and the obvious thing to do before the mechanism was understood. Measured across the
     corpus's 37 O2Ring nights (79 detected spikes; "artifact" = an onset no heart can produce):

         rule                    artifacts missed    GENUINE AROUSALS DELETED
         ±2 min clock window      1 of 44             11 of 35   (31 %)
         onset ≥ 15 BPM/s         0 of 44              0 of 35

     ±4 minutes of every hour is 6.7 % of the night, so the window rule was discarding real events for
     the crime of occurring near a clock hour — and still missed an artifact that drifted outside it.
     The onset test is what actually distinguishes them: a heart cannot gain 20 BPM in one second, an
     algorithm double-counting cycles can. Genuine arousals on post-firmware-fix nights top out at
     7 BPM/s (13 spikes, ≥2026-05-28) — that control is the non-circular evidence, since on the
     affected nights "impossible onset" is the definition of artifact rather than an independent test.

     `clockAligned` is still computed and reported, because the hourly pattern is the signature that
     identified this in the first place — but it is EVIDENCE, never the criterion. */
  function filterArtifactSpikes(spikes) {
    /* This is also the boundary between DETECTION INTERNALS and what the rest of the system sees.
       `onsetRise`/`clockAligned`/`artifact`/`artifactReason` are why a spike was judged; they are not
       properties of a surviving arousal, and every survivor carries `artifact:false` by construction —
       zero information, serialized into `hr_spikes.events` for every consumer forever. So the survivor
       keeps its original shape EXACTLY (which also means this change moves no export byte), and the
       verdict is published once per night as `stats.artifactSpikesRemoved` instead. */
    var kept = [];
    for (var i = 0; i < spikes.length; i++) {
      var sp = spikes[i];
      if (sp.artifact) continue;
      kept.push({ time: sp.time, baseline: sp.baseline, peak: sp.peak, duration: sp.duration, spo2: sp.spo2, mfm: sp.mfm });
    }
    return kept;
  }

  // ═══════════════════════════════════════════════════════════════
  // v20.2: 15 NEW METRICS
  // ═══════════════════════════════════════════════════════════════

  // ── SpO2 Pattern ───────────────────────────────────────────────

  // CT<94: cumulative seconds and % below 94% SpO2
  function computeCT94(rows) {
    var n = rows.length;
    if (n < 60) return null;
    var ct94s = 0;
    for (var i = 0; i < n; i++) {
      if (rows[i].spo2 < 94) ct94s++;
    }
    return { ct94Sec: ct94s, ct94Pct: +((ct94s / n) * 100).toFixed(2) };
  }

  // SpO2 dip and recovery slopes + MODL + desaturation clustering
  // Builds nadir events inline (same ODI-4 rolling-window logic as computeSpO2Advanced)
  function computeDesatSlopes(rows, blArr) {
    var n = rows.length;
    if (n < 60) return null;
    var spo2 = rows.map(function (r) {
      return r.spo2;
    });

    // Unified: ONE ceiling-baseline detection (DEX-EVENT-UNIFY Task A). §3 close-mode: ODI-4 entry +
    // anti-chatter HYSTERESIS close (no exitPct) — the SATELLITE set (slopes/MODL/clustering); chatter-
    // merging is desirable here, so this is intentionally NOT event-for-event with the simple-close
    // headline ODI-4 count. §1: shared p90-ceiling blArr threaded (bit-identical, one walk not many).
    var events = detectDesatEvents(spo2, { dropPct: DexKernel.K.ODI_DROP, blArr: blArr });

    if (!events.length)
      return {
        modl: null,
        meanDipSlope: null,
        meanRecSlope: null,
        clusteringIdx: null,
        firstHalfNadirs: 0,
        lastHalfNadirs: 0
      };

    // MODL: mean SpO2 of all samples inside dip events
    var dipSamples = [];
    events.forEach(function (e) {
      for (var i = e.startIdx; i <= e.endIdx; i++) dipSamples.push(spo2[i]);
    });
    var modl = dipSamples.length
      ? +(
          dipSamples.reduce(function (a, b) {
            return a + b;
          }, 0) / dipSamples.length
        ).toFixed(2)
      : null;

    // Slopes
    var meanDipSlope = events.length
      ? +(
          events.reduce(function (a, e) {
            return a + e.dipSlope;
          }, 0) / events.length
        ).toFixed(3)
      : 0;
    var meanRecSlope = events.length
      ? +(
          events.reduce(function (a, e) {
            return a + e.recSlope;
          }, 0) / events.length
        ).toFixed(3)
      : 0;

    // Clustering: first-half vs last-half of recording
    var midIdx = Math.floor(n / 2);
    var firstH = events.filter(function (e) {
      return e.nadirIdx < midIdx;
    }).length;
    var lastH = events.filter(function (e) {
      return e.nadirIdx >= midIdx;
    }).length;
    var total = firstH + lastH;
    var clusteringIdx = total > 0 ? +(lastH / total).toFixed(2) : null; // >0.6 = REM-concentrated

    return { modl: modl, meanDipSlope: meanDipSlope, meanRecSlope: meanRecSlope, clusteringIdx: clusteringIdx, firstHalfNadirs: firstH, lastHalfNadirs: lastH };
  }

  // ── Periodic Breathing Characterisation ────────────────────────

  function computePBmetrics(rows, osc) {
    var n = rows.length;
    if (!osc || osc.episodeCount < 1)
      return {
        pbCycleLen: null,
        pbCycleLenSD: null,
        pbAmplitude: null,
        pbLoad: null,
        pbFirstThirdRatio: null,
        pbEarlyCount: 0,
        pbLateCount: 0
      };
    var spo2 = rows.map(function (r) {
      return r.spo2;
    });
    var WIN = CFG.OSC_WINDOW_SEC; // 5-min windows (same as oscillation detection — single source: CFG)
    var THRESH = CFG.SPO2_OSC_THRESHOLD;

    // Re-detect crossing times to compute inter-crossing intervals
    var crossingTimes = [];
    var amplitudes = [];
    for (var w = 0; w + WIN <= n; w += WIN) {
      var seg = spo2.slice(w, w + WIN);
      var segMean =
        seg.reduce(function (a, b) {
          return a + b;
        }, 0) / seg.length;
      if (segMean >= THRESH) continue; // not an oscillating window
      var lastCross = -1,
        lastDir = 0,
        localCross = [];
      for (var i = 1; i < seg.length; i++) {
        var dir = seg[i] > THRESH ? 1 : seg[i] < THRESH ? -1 : 0;
        if (dir !== lastDir && dir !== 0) {
          localCross.push(w + i);
          lastCross = w + i;
          lastDir = dir;
        }
      }
      if (localCross.length >= 2) crossingTimes = crossingTimes.concat(localCross);
      // Amplitude: max - min within window
      var mx = seg.length ? Math.max.apply(null, seg) : 0,
        mn = seg.length ? Math.min.apply(null, seg) : 0;
      amplitudes.push(mx - mn);
    }

    // PB cycle length: mean interval between consecutive crossings (full cycle = 2 crossings)
    var intervals = [];
    for (var i = 1; i < crossingTimes.length; i++) {
      var iv = crossingTimes[i] - crossingTimes[i - 1];
      // ⚠️ `iv < 300` IS COUPLED TO `WIN` (= CFG.OSC_WINDOW_SEC = 300) AND MUST TRACK IT.
      // `crossingTimes` is concatenated across windows while non-oscillating windows are skipped
      // above, so two consecutive entries can sit either side of a skipped stretch. Straddling a whole
      // skipped window forces `iv` past the window width, which is why this bound catches every such
      // pair — measured 2026-08-17 on 61 real nights: 184 of 2438 intervals straddle a skipped window,
      // and 0 survive this guard. That is structural, not luck. Raise `OSC_WINDOW_SEC` without raising
      // this and gap-spanning pairs start being recorded as cycles across stretches already judged
      // non-oscillating. (OXYDEX-PB-DETECTOR-FOLLOWUPS §6.)
      if (iv > 5 && iv < 300) intervals.push(iv); // sanity: 5s–300s
    }
    // Full cycle = 2 half-cycles.
    // ⚠️ THIS IS A SLIDING VIEW: `.length` IS NOT THE NUMBER OF CYCLES. Each entry shares a half-cycle
    // with its neighbour, so `k` true cycles produce `2k − 1` entries (2 → 3, 3 → 5, 10 → 19). That is
    // harmless for what reads it here — the mean and SD below are unaffected (measured: SD 1.43 sliding
    // vs 1.41 disjoint) — but it is a trap for any future "≥ N consecutive cycles" test, which is
    // exactly the criterion AASM states and exactly what `detectSpO2Periodicity` needed; that function
    // pairs DISJOINTLY (`j += 2`) for this reason. If you need a cycle COUNT, do not use this array's
    // length. (OXYDEX-PB-DETECTOR-FOLLOWUPS §1.)
    var cycleIntervals = [];
    for (var i = 0; i + 1 < intervals.length; i++) cycleIntervals.push(intervals[i] + intervals[i + 1]);

    var pbCycleLen = cycleIntervals.length
      ? +(
          cycleIntervals.reduce(function (a, b) {
            return a + b;
          }, 0) / cycleIntervals.length
        ).toFixed(1)
      : null;

    var pbCycleLenSD = null;
    if (cycleIntervals.length > 1) {
      var mean =
        cycleIntervals.reduce(function (a, b) {
          return a + b;
        }, 0) / cycleIntervals.length;
      var variance =
        cycleIntervals.reduce(function (a, b) {
          return a + (b - mean) * (b - mean);
        }, 0) / cycleIntervals.length;
      pbCycleLenSD = +Math.sqrt(variance).toFixed(1);
    }

    var pbAmplitude = amplitudes.length
      ? +(
          amplitudes.reduce(function (a, b) {
            return a + b;
          }, 0) / amplitudes.length
        ).toFixed(2)
      : null;

    // PB Load: episodeCount × amplitude × estimated mean cycle length / 60 (per hour)
    var durationHr = n / 3600;
    var pbLoad = pbCycleLen && pbAmplitude && durationHr > 0 ? +((osc.episodeCount * pbAmplitude * (pbCycleLen / 60)) / durationHr).toFixed(3) : null;

    // Distribution: first-third vs last-third
    var t1 = Math.floor(n / 3),
      t2 = Math.floor((2 * n) / 3);
    var earlyCount = crossingTimes.filter(function (t) {
      return t < t1;
    }).length;
    var lateCount = crossingTimes.filter(function (t) {
      return t >= t2;
    }).length;
    var total = earlyCount + lateCount;
    var pbFirstThirdRatio = total > 0 ? +(earlyCount / total).toFixed(2) : null; // <0.4 = late/REM dominant

    return { pbCycleLen: pbCycleLen, pbCycleLenSD: pbCycleLenSD, pbAmplitude: pbAmplitude, pbLoad: pbLoad, pbFirstThirdRatio: pbFirstThirdRatio, pbEarlyCount: earlyCount, pbLateCount: lateCount };
  }

  // ── Sleep Architecture Proxies ─────────────────────────────────

  function computeSleepArch(rows) {
    var n = rows.length;
    if (n < 600) return null;
    var WIN = 60; // 1-min HR stability window

    // Sleep onset: first WIN-second window with HR SD < 5 bpm
    var solMin = null,
      onsetIdx = 0;
    for (var i = 0; i + WIN <= n; i++) {
      var seg = rows.slice(i, i + WIN).map(function (r) {
        return r.hr;
      });
      var mean =
        seg.reduce(function (a, b) {
          return a + b;
        }, 0) / seg.length;
      var sd = Math.sqrt(
        seg.reduce(function (a, b) {
          return a + (b - mean) * (b - mean);
        }, 0) / seg.length
      );
      if (sd < 5) {
        solMin = +(i / 60).toFixed(1);
        onsetIdx = i;
        break;
      }
    }

    // WASO: motion-flagged samples AFTER sleep onset only
    // v22.15 fix: guard against onsetIdx=0 fallback when onset is undetectable;
    // return null so UI correctly shows '—' instead of inflated whole-recording value.
    var wasoMin =
      solMin !== null
        ? +(
            rows.slice(onsetIdx).filter(function (r) {
              return r.motion > 0;
            }).length / 60
          ).toFixed(1)
        : null;

    // Ultradian cycle count: HR valleys separated by 60–120 min
    // 5-min centered rolling mean of HR — O(n) sliding window
    // v22.15 fix: previous trailing window displaced valley indices ~150s forward;
    // centered window aligns hrSmooth[i] with the midpoint of its contributing samples.
    var hrSmooth = new Array(n);
    var SMOOTH = 300,
      HALF = Math.floor(SMOOTH / 2);
    var rSum = 0,
      rCnt = 0;
    // Prime the first half-window
    for (var j = 0; j < Math.min(HALF, n); j++) {
      rSum += rows[j].hr;
      rCnt++;
    }
    for (var i = 0; i < n; i++) {
      // Add the right edge of the centered window as i advances
      var rEdge = i + HALF;
      if (rEdge < n) {
        rSum += rows[rEdge].hr;
        rCnt++;
      }
      // Remove the left edge that has fallen out of the window
      var lEdge = i - HALF - 1;
      if (lEdge >= 0) {
        rSum -= rows[lEdge].hr;
        rCnt--;
      }
      hrSmooth[i] = rCnt > 0 ? rSum / rCnt : rows[i].hr;
    }
    var valleys = [];
    var MIN_SEP = 3600; // 60 min minimum between valleys
    for (var i = 150; i < n - 150; i++) {
      if (hrSmooth[i] < hrSmooth[i - 150] && hrSmooth[i] < hrSmooth[i + 150]) {
        if (!valleys.length || i - valleys[valleys.length - 1] >= MIN_SEP) {
          valleys.push(i);
        }
      }
    }
    var ultradianCycles = Math.max(0, valleys.length - 1); // count intervals between valleys

    return { wasoMin: wasoMin, solMin: solMin, ultradianCycles: ultradianCycles, ultradianValleys: valleys.length };
  }

  // ── ODI-1 ──────────────────────────────────────────────────────

  function computeODI1(rows, blArr) {
    var n = rows.length;
    if (n < 60) return { odi1Rate: 0, odi1Total: 0 };
    var spo2 = rows.map(function (r) {
      return r.spo2;
    });
    // ODI-1 keeps its definitional 1% entry + shallow 0.5% re-rise exit and counts every
    // qualifying dip (minSec:0, no 10s floor) — but now shares the ONE ceiling-baseline
    // primitive instead of a private trailing-mean loop. (DEX-EVENT-UNIFY Task A)
    var events = detectDesatEvents(spo2, { dropPct: 1, exitPct: 0.5, minSec: 0, blArr: blArr }).length;
    var durationHr = n / 3600;
    return { odi1Rate: durationHr > 0 ? +(events / durationHr).toFixed(1) : 0, odi1Total: events };
  }

  // ── Literature Scores ──────────────────────────────────────────

  // McGill OxiMetry Score (MOS) 0-4
  // Grade 1: ODI-4 < 5, CT<90 < 1min
  // Grade 2: ODI-4 5-15 OR CT<90 1-5min
  // Grade 3: ODI-4 > 15 OR CT<90 > 5min, one criterion
  // Grade 4: both criteria exceeded
  function computeMOS(odi4Rate, ct90Sec) {
    var ct90Min = ct90Sec / 60;
    var odiHigh = odi4Rate >= DexKernel.K.MOS_LONG;
    var ctHigh = ct90Min >= 5;
    var odiMod = odi4Rate >= DexKernel.K.MOS_SHORT;
    var ctMod = ct90Min >= 1;
    var score;
    if (odiHigh && ctHigh) score = 4;
    else if (odiHigh || ctHigh) score = 3;
    else if (odiMod || ctMod) score = 2;
    else score = 1;
    var labels = ['', 'Normal', 'Borderline', 'Abnormal', 'Severely Abnormal'];
    return { mos: score, mosLabel: labels[score] };
  }

  // AHI estimates
  function computeAHIestimates(odi4Rate, odi3Rate, desSevRate, t95Pct) {
    // ODI-4 as AHI surrogate: AHI_est ≈ ODI-4 × 1.1 (ODI-4 is a widely-used oximetry AHI
    // surrogate; this conservative constant is OxyDex's). RE-EXAMINED after the v22.36 ceiling-
    // baseline fix removed the severity-proportional ODI undercount (OXYDEX-ODI-CEILING-FIX-
    // BRIEF.md §2c): on the v1.6 20k-cohort the residual through-origin relation is
    // truth-AHI ≈ 1.4 × ODI-4 — i.e. with the corrected detector ODI-4 still modestly
    // UNDER-represents planted AHI (expected: not every scored hypopnea desaturates ≥4%),
    // so the feared over-shoot did NOT materialize. Per the brief's guardrail (do not tune
    // the surrogate to chase the simulator), ×1.1 is retained UNCHANGED — conservative and
    // literature-consistent — rather than inflated to the synthetic-only slope.
    /* `null * 1.1` is 0, so an absent ODI-4 published an AHI estimate of 0.0 — the most reassuring
       possible reading of a measurement that never happened. */
    var ahiODI4 = odi4Rate == null ? null : +(odi4Rate * 1.1).toFixed(1);
    // Internal linear model (concept per Kulkas 2013 DesSev): AHI ≈ 0.8×ODI3 + 0.6×DesSev + 0.15×T95 − 1.2
    /* REFUSE rather than treat an absent term as zero (§2.6). `0.6 * null` is 0 in JS, so an
       unmeasured DesSev silently vanished from the sum and the estimate came out LOW — the
       reassuring direction, from missing data. Each estimate refuses only on the inputs it
       actually uses, so a missing DesSev does not take ahiODI4 down with it. */
    var ahiKulkas = odi3Rate == null || desSevRate == null || t95Pct == null ? null : Math.max(0, +(0.8 * odi3Rate + 0.6 * desSevRate + 0.15 * t95Pct - 1.2).toFixed(1));
    return { ahiODI4: ahiODI4, ahiKulkas: ahiKulkas };
  }

  // ═══════════════════════════════════════════════════════════════
  // v20.3: TIER 1 — Night Extras (12 simple metrics)
  // ═══════════════════════════════════════════════════════════════
  function computeNightExtras(rows, stats, desat, odi1, odi4, hb) {
    var n = rows.length;
    if (n < 60 || !stats) return null;
    var spo2 = rows.map(function (r) {
      return r.spo2;
    });
    var hr = rows.map(function (r) {
      return r.hr;
    });
    var TWO_HR = Math.min(n, 7200); // 2h in samples at 1Hz

    // SpO2 range
    var spo2Range = +(stats.maxSpo2 - stats.minSpo2).toFixed(1);

    // Time-in-range 94–99%
    var tirCount = spo2.filter(function (v) {
      return v >= 94 && v <= 99;
    }).length; // TIR94-99: excludes ceiling-artifact 100%
    var tir9499 = +((tirCount / n) * 100).toFixed(1);

    // Split-night SpO2
    var earlyS = spo2.slice(0, TWO_HR);
    var lateS = spo2.slice(Math.max(0, n - TWO_HR));
    var meanSpo2Early = +(
      earlyS.reduce(function (a, b) {
        return a + b;
      }, 0) / earlyS.length
    ).toFixed(2);
    var meanSpo2Late = +(
      lateS.reduce(function (a, b) {
        return a + b;
      }, 0) / lateS.length
    ).toFixed(2);

    // HR range + split-night HR
    var hrRange = +(stats.maxHr - stats.minHr).toFixed(0);
    var earlyH = hr.slice(0, TWO_HR);
    var lateH = hr.slice(Math.max(0, n - TWO_HR));
    var meanHrEarly = +(
      earlyH.reduce(function (a, b) {
        return a + b;
      }, 0) / earlyH.length
    ).toFixed(1);
    var meanHrLate = +(
      lateH.reduce(function (a, b) {
        return a + b;
      }, 0) / lateH.length
    ).toFixed(1);

    // Motion bursts (runs of motion>0 lasting ≥3s)
    var motionBursts = 0;
    var inBurst = false,
      burstLen = 0;
    for (var i = 0; i < n; i++) {
      if (rows[i].motion > 0) {
        inBurst = true;
        burstLen++;
      } else {
        if (inBurst && burstLen >= 3) motionBursts++;
        inBurst = false;
        burstLen = 0;
      }
    }
    if (inBurst && burstLen >= 3) motionBursts++;

    // Longest clean SpO2 run (>95%, in minutes)
    var longestCleanRun = 0,
      curRun = 0;
    for (var i = 0; i < n; i++) {
      if (spo2[i] > 95) {
        curRun++;
        if (curRun > longestCleanRun) longestCleanRun = curRun;
      } else curRun = 0;
    }
    longestCleanRun = +(longestCleanRun / 60).toFixed(1);

    // Nadir density
    var nadirCount = desat && desat.nadir ? desat.nadir.count : 0;
    var durationHr = n / 3600;
    var nadirDensity = durationHr > 0 ? +(nadirCount / durationHr).toFixed(2) : 0;

    // T95 burden score: T95% × sqrt(T-AUC weighted)
    var t95BurdenScore = null;
    if (stats && hb) {
      var tAUC = hb.total || 0;
      t95BurdenScore = +(stats.t95pct * Math.sqrt(Math.max(0, tAUC))).toFixed(2);
    }

    // ODI-4/ODI-1 ratio (depth distribution index)
    var odi41ratio = null;
    if (odi4 && odi1 && odi1.odi1Rate > 0) {
      odi41ratio = +(odi4.rate / odi1.odi1Rate).toFixed(3);
    }

    return {
      spo2Range: spo2Range,
      tir9499: tir9499,
      meanSpo2Early: meanSpo2Early,
      meanSpo2Late: meanSpo2Late,
      hrRange: hrRange,
      meanHrEarly: meanHrEarly,
      meanHrLate: meanHrLate,
      motionBursts: motionBursts,
      longestCleanRun: longestCleanRun,
      nadirDensity: nadirDensity,
      t95BurdenScore: t95BurdenScore,
      odi41ratio: odi41ratio
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // v20.3: TIER 2 — Rolling Window Metrics (8 metrics)
  // ═══════════════════════════════════════════════════════════════
  function computeRollingMetrics(rows, desat, comp, blArr) {
    var n = rows.length;
    if (n < 600) return null;
    var spo2 = rows.map(function (r) {
      return r.spo2;
    });
    var hr = rows.map(function (r) {
      return r.hr;
    });
    var W10 = 600; // 10-min
    var W30 = 1800; // 30-min
    var W5 = 300; // 5-min
    var durationHr = n / 3600;

    // Worst 10-min SpO2 window
    var worst10 = 100;
    for (var i = 0; i + W10 <= n; i += 60) {
      var seg = spo2.slice(i, i + W10);
      var m =
        seg.reduce(function (a, b) {
          return a + b;
        }, 0) / seg.length;
      if (m < worst10) worst10 = m;
    }
    worst10 = isFinite(worst10) ? +worst10.toFixed(2) : 0;

    // Worst 30-min T95 window
    var worstT95 = 0;
    for (var i = 0; i + W30 <= n; i += 60) {
      var seg = spo2.slice(i, i + W30);
      var cnt = seg.filter(function (v) {
        return v < 95;
      }).length;
      var pct = (cnt / seg.length) * 100;
      if (pct > worstT95) worstT95 = pct;
    }
    worstT95 = isFinite(worstT95) ? +worstT95.toFixed(1) : 0;

    // SpO2 stable windows (5-min with SD < 1%)
    var stableWins = 0;
    for (var i = 0; i + W5 <= n; i += W5) {
      var seg = spo2.slice(i, i + W5);
      var mean =
        seg.reduce(function (a, b) {
          return a + b;
        }, 0) / seg.length;
      var sd = Math.sqrt(
        seg.reduce(function (a, b) {
          return a + (b - mean) * (b - mean);
        }, 0) / seg.length
      );
      if (sd < 1) stableWins++;
    }

    // CDI: Cyclic Desaturation Index — SpO2 oscillations crossing mean±2SD per hour
    var globalMean =
      spo2.reduce(function (a, b) {
        return a + b;
      }, 0) / n;
    var globalSD = Math.sqrt(
      spo2.reduce(function (a, b) {
        return a + (b - globalMean) * (b - globalMean);
      }, 0) / n
    );
    var hiThresh = globalMean + 2 * globalSD,
      loThresh = globalMean - 2 * globalSD;
    var cdiCross = 0,
      cdiState = 0;
    for (var i = 0; i < n; i++) {
      var newState = spo2[i] > hiThresh ? 1 : spo2[i] < loThresh ? -1 : cdiState;
      if (newState !== cdiState && newState !== 0) {
        cdiCross++;
        cdiState = newState;
      }
    }
    var cdi = durationHr > 0 ? +(cdiCross / durationHr / 2).toFixed(2) : 0; // /2 = full cycles

    // Post-dip HR response: mean HR change 60s after each nadir
    var postDipDeltas = [];
    // §2: dropped the vestigial `desat.nadir.count > 0` pre-gate — a coarse "any events?" check from
    // the pre-unification separate loop. postDipDeltas.length below is the real gate, and it scores the
    // SET THIS USES (ODI-4 entry + anti-chatter HYSTERESIS close — §3 satellite set), not the simple-
    // close self-gated nadir.count. §1: shared p90-ceiling blArr threaded. DEX-EVENT-UNIFY-FOLLOWUPS-II.
    detectDesatEvents(spo2, { dropPct: DexKernel.K.ODI_DROP, blArr: blArr }).forEach(function (e) {
      var postIdx = Math.min(n - 1, e.nadirIdx + 60);
      if (postIdx < n && e.nadirIdx < n) postDipDeltas.push(hr[postIdx] - hr[e.nadirIdx]);
    });
    var postDipHrResponse = postDipDeltas.length
      ? +(
          postDipDeltas.reduce(function (a, b) {
            return a + b;
          }, 0) / postDipDeltas.length
        ).toFixed(1)
      : null;

    // HR deceleration runs: ≥3 BPM total decrease sustained ≥30s
    var hrDecelRuns = 0,
      decelLen = 0,
      decelStartHR = 0;
    for (var i = 1; i < n; i++) {
      if (hr[i] < hr[i - 1]) {
        if (decelLen === 0) decelStartHR = hr[i - 1]; // capture baseline before first step
        decelLen++;
      } else {
        if (decelLen >= 30 && decelStartHR - hr[i - 1] >= 3) hrDecelRuns++;
        decelLen = 0;
        decelStartHR = 0;
      }
    }
    if (decelLen >= 30 && decelStartHR - hr[n - 1] >= 3) hrDecelRuns++; // end-of-array run

    // SpO2-HR decoupling: use 30s windows to avoid 1Hz noise domination
    // 1-second comparison is meaningless (random ~50% by quantization noise)
    var decoupled = 0,
      dcTotal = 0;
    for (var i = 30; i < n; i += 30) {
      var dSpo2 = spo2[i] - spo2[i - 30];
      var dHr = hr[i] - hr[i - 30];
      if (dSpo2 !== 0 && dHr !== 0) {
        dcTotal++;
        if (dSpo2 > 0 !== dHr > 0) decoupled++;
      }
    }
    // DEEP-AUDIT-FOLLOWUPS §B4 — the sibling of §18's coupling fix. With no comparable 30 s windows
    // the decoupled FRACTION is 0/0 — undefined, not "0 % decoupled, a perfectly coupled night". The
    // value ships in the node-export, so a consumer reading 0 would take it as a measurement.
    var spo2HrDecouplingPct = dcTotal > 0 ? +((decoupled / dcTotal) * 100).toFixed(1) : null;

    // Intra-night NSI: NSI per 90-min epoch (early/mid/late)
    var EPOCH = 5400; // 90 min
    var intraNightNSI = [];
    for (var e = 0; e < 3; e++) {
      var start = e * EPOCH,
        end = Math.min(n, start + EPOCH);
      if (end <= start) break;
      var seg = rows.slice(start, end);
      var segSpo2 = seg.map(function (r) {
        return r.spo2;
      });
      var segHr = seg.map(function (r) {
        return r.hr;
      });
      var segN = seg.length;
      // Mini-NSI: T95 + HR variance + motion
      var segT95 = segN
        ? (segSpo2.filter(function (v) {
            return v < 95;
          }).length /
            segN) *
          100
        : 0;
      var segHrMean = segN
        ? segHr.reduce(function (a, b) {
            return a + b;
          }, 0) / segN
        : 0;
      var segHrSD = segN
        ? Math.sqrt(
            segHr.reduce(function (a, b) {
              return a + (b - segHrMean) * (b - segHrMean);
            }, 0) / segN
          )
        : 0;
      var segMot = segN
        ? (seg.filter(function (r) {
            return r.motion > 0;
          }).length /
            segN) *
          100
        : 0;
      var t95Norm = Math.min(1, segT95 / 30);
      var hrSdNorm = Math.min(1, segHrSD / 20);
      var motNorm = Math.min(1, segMot / 30);
      var miniNSI = Math.min(100, Math.round(((t95Norm + hrSdNorm + motNorm) / 3) * 100));
      intraNightNSI.push(miniNSI);
    }

    return {
      worst10minSpo2: worst10,
      worst30minT95: worstT95,
      spo2StableWindows: stableWins,
      cdi: cdi,
      postDipHrResponse: postDipHrResponse,
      hrDecelRuns: hrDecelRuns,
      spo2HrDecouplingPct: spo2HrDecouplingPct,
      intraNightNSI: intraNightNSI
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // v20.3: TIER 3 — Pattern Probability Scores
  // ═══════════════════════════════════════════════════════════════
  function computePatternScores(pbMet, osc, cross, flags, odi4, comp) {
    // NOTE: cs/uars are CONSTRUCTED, NON-VALIDATED composite scores (0-3) meant as
    // directional flags for discussion, not diagnoses. See the on-page disclaimer.
    //
    // Cheyne-Stokes probability (0-3)
    // CS criterion: PB cycle within the clinical CSR range (~40-130 s; classic
    // 45-90 s, up to ~120 s in severe heart failure), plus BLUNTED_AROUSAL,
    // low cardiorespiratory coupling, and low ODI-4 despite high PB burden.
    var cs = 0;
    if (pbMet && pbMet.pbCycleLen !== null) {
      if (pbMet.pbCycleLen >= 40 && pbMet.pbCycleLen <= 130) cs++; // clinical CSR cycle window
    }
    if (
      flags &&
      flags.some(function (f) {
        return f.code.indexOf('BLUNTED_AROUSAL') >= 0;
      })
    )
      cs++;
    if (cross && cross.crcIdx != null && cross.crcIdx < 0.2) cs++;
    // CS-specific: low ODI despite high PB burden (central = less desaturation per event)
    if (odi4 && odi4.rate < 3 && osc && osc.episodeCount >= 5) cs++;
    cs = Math.min(3, cs);

    // UARS probability (0-3)
    // Criteria: short PB cycles (< 40 s), high AAI, normal-low ODI-4, high SpO2-HR decoupling
    var uars = 0;
    if (pbMet && pbMet.pbCycleLen !== null) {
      if (pbMet.pbCycleLen < 40) uars++;
    }
    if (cross && cross.autoArousalIdx >= 3) uars++;
    if (odi4 && odi4.rate < 5 && osc && osc.episodeCount >= 3) uars++;
    if (comp && comp.sfi >= 2) uars++;
    uars = Math.min(3, uars);

    /* THE LIKELIHOOD LADDER IS WITHDRAWN (OXYDEX-PB-OVERCALL-FOLLOWUPS §2).
       Both of these read `['Unlikely', 'Possible', 'Probable', 'Likely']` and were indexed by a 0-3
       INDICATOR COUNT. That is a likelihood word attached to a number that cannot carry one, and for
       CS the parent brief measured exactly why: `detectOscillations` has NO periodicity test — no
       cycle-length criterion, no crescendo-decrescendo — and counts crossings of an ABSOLUTE 95 %
       level, so on a corpus whose overnight mean is 94.6-96.6 % it tracks mild hypoxemia burden
       (r = 0.893 with time below 95 %) rather than the respiratory rhythm "Cheyne-Stokes" names.
       Night-level agreement with the CPAP's own PB scoring was kappa = -0.039, worse than chance.

       The score, its 0-3 ladder and every gate on it are UNCHANGED — this is a wording fix, not a
       retune, and §5.2 found no defensible threshold on this corpus so retuning would be guessing.
       What changes is that the surface now states the count it actually has. Same shape as the
       context line at the one-line impression, which the parent already tempered. */
    var csLabels = ['0/3 indicators', '1/3 indicators', '2/3 indicators', '3/3 indicators'];
    var uarsLabels = ['0/3 indicators', '1/3 indicators', '2/3 indicators', '3/3 indicators'];

    return { csScore: cs, csLabel: csLabels[cs], uarsScore: uars, uarsLabel: uarsLabels[uars] };
  }

  // ═══════════════════════════════════════════════════════════════
  // v20.4: TIER 3 continued — Signal Processing Metrics
  // ═══════════════════════════════════════════════════════════════

  // DFA α1 — Detrended Fluctuation Analysis (short-scale exponent)
  // OSA signature: α1 ≈ 0.5 (random-walk-like). Normal: α1 ≈ 0.8–1.1.
  // Uses log-log regression of RMS fluctuation vs window size (n=4..64).
  function computeDFA(rows) {
    var spo2 = (rows || [])
      .map(function (r) {
        return r && r.spo2 != null ? r.spo2 : null;
      })
      .filter(function (v) {
        return v != null && isFinite(v);
      });
    var n = spo2.length;
    if (n < 256) return null;
    // DEEP-AUDIT-2026-07-11 §9: the old `spo2.slice(0, 3600)` analysed only the FIRST HOUR of a 6–10 h
    // night and disclosed nothing — the surfaced DFA α1 chip described the settle-in window, not the
    // night. The cap was never performance-motivated (DFA is O(N·scales)), so it is simply gone: α1 now
    // spans the whole recording. Same defect the sibling computeHREntropy below already fixed — it was
    // applied to one of three siblings and these two were missed.
    var mean =
      spo2.reduce(function (a, b) {
        return a + b;
      }, 0) / n;
    var y = [];
    var cum = 0;
    for (var i = 0; i < n; i++) {
      cum += spo2[i] - mean;
      y.push(cum);
    }
    var scales = [4, 8, 16, 32, 64];
    var logN = [],
      logF = [];
    for (var s = 0; s < scales.length; s++) {
      var wn = scales[s];
      var rmsSum = 0,
        count = 0;
      for (var start = 0; start + wn <= n; start += wn) {
        var seg = y.slice(start, start + wn);
        var xm = (wn - 1) / 2;
        var ym =
          seg.reduce(function (a, b) {
            return a + b;
          }, 0) / wn;
        var num = 0,
          den = 0;
        for (var k = 0; k < wn; k++) {
          num += (k - xm) * (seg[k] - ym);
          den += (k - xm) * (k - xm);
        }
        var slope = den ? num / den : 0,
          intercept = ym - slope * xm;
        var resVar = 0;
        for (var k = 0; k < wn; k++) {
          var r = seg[k] - (slope * k + intercept);
          resVar += r * r;
        }
        rmsSum += Math.sqrt(resVar / wn);
        count++;
      }
      if (count > 0) {
        logN.push(Math.log(wn));
        logF.push(Math.log(Math.max(1e-12, rmsSum / count)));
      }
    }
    if (
      logN.length < 2 ||
      logF.some(function (v) {
        return !isFinite(v);
      })
    )
      return { alpha1: null, dfaLabel: '—' };
    var xm2 =
      logN.reduce(function (a, b) {
        return a + b;
      }, 0) / logN.length;
    var ym2 =
      logF.reduce(function (a, b) {
        return a + b;
      }, 0) / logF.length;
    var num2 = 0,
      den2 = 0;
    for (var i = 0; i < logN.length; i++) {
      num2 += (logN[i] - xm2) * (logF[i] - ym2);
      den2 += (logN[i] - xm2) * (logN[i] - xm2);
    }
    var alpha1 = den2 ? +(num2 / den2).toFixed(3) : null;
    var label = alpha1 === null || !isFinite(alpha1) ? '—' : 'SpO₂ DFA (α1=' + alpha1 + ') — HR-DFA thresholds do not apply to SpO₂ signal';
    return { alpha1: alpha1, dfaLabel: label };
  }

  // SpO2 FFT — dominant frequency in 0.01–0.05 Hz band (respiratory oscillation)
  // Fast: probe 20 candidate frequencies only instead of full DFT
  // FFT CYCLE LENGTH — periodic breathing / Cheyne-Stokes period, WITH A NULL.
  //
  // ⚠️ THIS USED TO RETURN A NUMBER ALWAYS. It took a raw-power argmax over 11 unevenly-spaced probe
  // frequencies with no background and no significance test, so it could not say "no cycle detected".
  // Measured on pure AR(1) with nothing planted, it pinned to the 0.005 Hz band edge in 12 % of runs at
  // rho=0, rising to 55 % at rho=0.995: on a featureless night it reported a confident cycle length.
  //
  // ⚠️ AND YET THE CORPUS SAYS THE METRIC IS REAL, which is why this is a significance test and NOT a
  // retraction. Across 103 O2Ring nights (median lag-1 rho 0.9813) only 19/103 = 18 % hit the 200 s edge
  // against a 42 % null — exact one-sided p = 3.3e-7, Wilson CI [0.121, 0.270] excluding 0.42 — and the
  // cycles spread across 62-125 s, the classic periodic-breathing range. The fix must KEEP those and drop
  // the fabricated ones. (OXYDEX-FFT-CYCLE-NULL-2026-08-16-BRIEF.)
  //
  // METHOD — Mann, M. E. & Lees, J. M. (1996), Climatic Change 33, 409-445, doi 10.1007/BF00142586:
  // test peak HEIGHT against a fitted red background, never peak LOCATION. In a red spectrum the argmax
  // sits near the low-frequency end by construction, so its position carries no information.
  //
  //   1. rho = lag-1 autocorrelation of the mean-removed series (the background's only parameter).
  //   2. AR(1) spectrum  S(f) ~ (1-rho^2) / (1 - 2 rho cos(2 pi f / fs) + rho^2), evaluated on the probe
  //      grid and scaled by the MEDIAN observed/theoretical ratio — median so a real peak cannot inflate
  //      the background that is supposed to expose it.
  //   3. A periodogram ordinate over its background is ~exponential (chi-square, 2 dof), so
  //      P(ratio > x) = exp(-x). With 11 probes the Sidak-corrected 95 % threshold is
  //      -ln(1 - 0.95^(1/11)) ~= 5.37.
  //
  // This ALSO fixes the uneven-grid bias the brief flagged: dividing by a frequency-dependent background
  // is the normalisation. Comparing raw power across unevenly spaced probes favoured the low end no
  // matter what the signal did.
  // ⚠️ NO FIXED PROBE GRID — the record's OWN Fourier bins.
  // Two grids were tried and both failed for the same reason. The original 11 hand-picked probes left
  // blind spots: a cycle planted at 80 s, between the 100 s and 77 s teeth, measured SNR p05 1.6 against
  // p05 37.0 for the same amplitude at 100 s — invisible. Log-spacing 33 probes did not fix it, it just
  // moved the teeth: 0.01 Hz stopped being a probe and the on-grid case collapsed to p05 3.2.
  //
  // The cause is resolution, not density. An N-sample record resolves fs/N; anything evaluated BETWEEN
  // its Fourier bins loses power to scalloping no matter how many spot frequencies you pick. So evaluate
  // ON the bins — k/N for every k in the band — which is also the basis in which periodogram statistics
  // are actually defined. `_FFT_MAX_BINS` strides if a long night would otherwise cost more than it is
  // worth; striding costs coverage, so it is reported rather than silent.
  var _FFT_LO_HZ = 0.005; // 200 s
  var _FFT_HI_HZ = 0.05; // 20 s
  var _FFT_MAX_BINS = 400;
  // ⚠️ THE THEORETICAL THRESHOLD IS ANTI-CONSERVATIVE AND THE GAP IS MEASURED, NOT GUESSED.
  // Sidak assumes a KNOWN background; ours is fitted from the same series, so the null tail is much
  // heavier than exp(-x) predicts. Measured over 80 pure-AR(1) runs at rho=0.98 (nothing planted):
  //     null   p50 6.1   p95 10.3   p99 14.6   max 23.9      theoretical threshold: 6.98
  // i.e. the theoretical value sits at the null MEDIAN and would fire on ~half of featureless nights.
  // The same geometry with a 2 %-amplitude 80 s cycle planted gives p05 23.7 / p50 43.1, so inflating
  // by 2.2x (-> ~15.4) puts the bar above the null p99 and well below the planted p05.
  // This is a correction for BACKGROUND ESTIMATION, stated and reproducible, not a fitted constant:
  // re-run the group's null/planted report if the background model changes.
  var _FFT_EST_BG_INFLATION = 2.2;
  var _FFT_CONF = 0.95;
  // The Sidak threshold is computed PER CALL from the bins actually tested — see computeSpO2FFT.

  function _lag1(x, mean) {
    var num = 0,
      den = 0,
      i;
    for (i = 0; i < x.length; i++) den += (x[i] - mean) * (x[i] - mean);
    for (i = 1; i < x.length; i++) num += (x[i] - mean) * (x[i - 1] - mean);
    if (!(den > 0)) return 0;
    var r = num / den;
    // A background needs a POSITIVE persistence; a negative or absurd rho is not a red spectrum, and
    // clamping is honest here because the alternative is a background that curves the wrong way.
    return r > 0.999 ? 0.999 : r < 0 ? 0 : r;
  }

  function _median(a) {
    var b = a.slice().sort(function (p, q) {
      return p - q;
    });
    var m = b.length >> 1;
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  }

  function computeSpO2FFT(rows, fs) {
    var spo2 = rows.map(function (r) {
      return r.spo2;
    });
    var n = spo2.length;
    if (n < 512) return null;
    var RATE = fs > 0 ? fs : 1; // SpO2 rows are 1 Hz; the argument keeps that testable
    var mean =
      spo2.reduce(function (a, b) {
        return a + b;
      }, 0) / n;
    var rho = _lag1(spo2, mean);

    var kLo = Math.max(1, Math.ceil((_FFT_LO_HZ * n) / RATE));
    var kHi = Math.min(Math.floor(n / 2) - 1, Math.floor((_FFT_HI_HZ * n) / RATE));
    if (kHi <= kLo) return null;
    var stride = Math.max(1, Math.ceil((kHi - kLo + 1) / _FFT_MAX_BINS));

    var pows = [],
      bg = [],
      fss = [],
      k,
      t;
    for (k = kLo; k <= kHi; k += stride) {
      var f = (k * RATE) / n,
        re = 0,
        im = 0;
      for (t = 0; t < n; t++) {
        var ang = (2 * Math.PI * k * t) / n;
        re += (spo2[t] - mean) * Math.cos(ang);
        im -= (spo2[t] - mean) * Math.sin(ang);
      }
      pows.push((re * re + im * im) / n);
      var w = (2 * Math.PI * f) / RATE;
      bg.push((1 - rho * rho) / (1 - 2 * rho * Math.cos(w) + rho * rho));
      fss.push(f);
    }
    // Sidak across the bins ACTUALLY tested — the correction must follow the grid, not a constant.
    // Sidak across the bins ACTUALLY tested — the correction must follow the grid, not a constant.
    var thresh = -Math.log(1 - Math.pow(_FFT_CONF, 1 / pows.length)) * _FFT_EST_BG_INFLATION;

    // Scale the AR(1) SHAPE to the data by the MEDIAN ratio. Median, because a mean would let one real
    // peak raise the background that is supposed to expose it.
    var ratios = [],
      fi;
    for (fi = 0; fi < pows.length; fi++) ratios.push(bg[fi] > 0 ? pows[fi] / bg[fi] : 0);
    var scale = _median(ratios);

    var bestSnr = -1,
      bestFreq = null;
    for (fi = 0; fi < pows.length; fi++) {
      var snr = scale > 0 && bg[fi] > 0 ? pows[fi] / (scale * bg[fi]) : 0;
      if (snr > bestSnr) {
        bestSnr = snr;
        bestFreq = fss[fi];
      }
    }
    var ok = bestFreq != null && bestSnr >= thresh;
    // Computed under the guard rather than in a ternary so the null-narrowing is direct — a ternary on
    // `ok` does not tell the checker that `bestFreq` is non-null inside it.
    var peakF = null,
      peakC = null;
    if (ok && bestFreq != null) {
      peakF = +bestFreq.toFixed(4);
      peakC = +(1 / bestFreq).toFixed(0);
    }
    return {
      // NULL, not 0 and not a spurious number: a missing measurement must be visible as missing
      // (CLAUDE.md §🔒, by analogy). Every consumer must tolerate an absent cycle.
      peakFreqHz: peakF,
      peakCycSec: peakC,
      // Published so the verdict can be audited against the ground it was computed from.
      snr: +bestSnr.toFixed(2),
      threshold: +thresh.toFixed(2),
      bins: pows.length,
      strided: stride > 1,
      rhoLag1: +rho.toFixed(4),
      detected: ok
    };
  }

  function computeHREntropy(rows) {
    var clean = rows
      .filter(function (r) {
        return r.motion === 0;
      })
      .map(function (r) {
        return r.hr;
      });
    var n = clean.length;
    if (n < 200) return null;
    // SYNTH-TEXTURE-FOLLOWUPS-III: bound the O(N²) match-count with WHOLE-NIGHT decimation, NOT a
    // head-slice. The old `clean.slice(0,1000)` (≈ first 16 min of an 8 h night) characterised only the
    // settle-in window and systematically UNDER-stated full-night HR irregularity (committed O2Ring
    // corpus: head-slice SampEn ≈0.42 vs whole-night decimation ≈1.5 — flips most nights from
    // "Low (regular)" to "High (irregular)"). Deterministic uniform stride spans the entire night at the
    // SAME O(cap²) cost; tolerance r tracks the decimated set's SD. Mirrors pulsedex-dsp.js sampEn.
    var CAP = 1000;
    var x;
    if (n > CAP) {
      var stride = Math.ceil(n / CAP);
      x = [];
      for (var di = 0; di < n; di += stride) x.push(clean[di]);
    } else {
      x = clean.slice();
    }
    var USE = x.length;
    // SD for tolerance r
    var mean =
      x.reduce(function (a, b) {
        return a + b;
      }, 0) / USE;
    var variance =
      x.reduce(function (a, v) {
        return a + (v - mean) * (v - mean);
      }, 0) / USE;
    var stdv = Math.sqrt(variance);
    var r = 0.2 * stdv;
    var m = 2;
    // Count template matches for m and m+1
    function countMatches(m, r) {
      // k<m: checks exactly m consecutive points (correct for SampEn template length)
      var cnt = 0;
      for (var i = 0; i < USE - m; i++) {
        for (var j = i + 1; j < USE - m; j++) {
          var match = true;
          for (var k = 0; k < m; k++) {
            if (Math.abs(x[i + k] - x[j + k]) > r) {
              match = false;
              break;
            }
          }
          if (match) cnt++;
        }
      }
      return cnt;
    }
    var Bm = countMatches(m, r);
    var Am = countMatches(m + 1, r);
    var sampEn = Bm > 0 && Am > 0 ? +(-Math.log(Am / Bm)).toFixed(4) : null;
    var label = sampEn === null ? '—' : sampEn < 0.5 ? 'Low (regular)' : sampEn < 1.2 ? 'Normal' : 'High (irregular)';
    return { sampEn: sampEn, sampEnLabel: label };
  }

  // Sympathetic Surge Index — combined arousal load per hour
  function computeSympSurge(rows, spikes, cross, rolling, durationHr) {
    if (!durationHr || durationHr < 0.5) return null;
    var spikeRate = spikes && spikes.length ? spikes.length / durationHr : 0;
    // postDipHrResponse is mean bpm arousal — normalize to [0-1] on 0-10 bpm scale
    var postDipAct = rolling && rolling.postDipHrResponse !== null ? Math.max(0, Math.min(1, rolling.postDipHrResponse / 10)) : 0;
    var aaiLoad = cross ? cross.autoArousalIdx / 5 : 0; // normalise AAI 0-5 scale
    var ssi = +(spikeRate * 0.4 + postDipAct * 0.4 + aaiLoad * 0.2).toFixed(3);
    var label = ssi < 0.5 ? 'Low' : ssi < 1.5 ? 'Moderate' : 'High';
    return { ssi: ssi, ssiLabel: label };
  }

  // ═══════════════════════════════════════════════════════════════
  // v20.4: TIER 5 — Novel Composite/Derived Metrics
  // ═══════════════════════════════════════════════════════════════

  // Circadian HR fit — cosine fit amplitude + nadir timing
  function computeCircadianHR(rows) {
    var n = rows.length;
    if (n < 3600) return null;
    var hr = rows.map(function (r) {
      return r.hr;
    });
    // Fit y = A*cos(2π*t/T + φ) + C where T = n (full night)
    // Use least-squares for A*cos + B*sin + C
    var sumC = 0,
      sumS = 0,
      sumCC = 0,
      sumSS = 0,
      sumCS = 0,
      sumYC = 0,
      sumYS = 0,
      sumY = 0;
    for (var i = 0; i < n; i++) {
      var ang = (2 * Math.PI * i) / n;
      var c = Math.cos(ang),
        s = Math.sin(ang),
        y = hr[i];
      sumC += c;
      sumS += s;
      sumCC += c * c;
      sumSS += s * s;
      sumCS += c * s;
      sumYC += y * c;
      sumYS += y * s;
      sumY += y;
    }
    // Simplified: A ≈ 2/n * ΣY*cos(ωt), B ≈ 2/n * ΣY*sin(ωt)
    var A = (2 / n) * sumYC,
      B = (2 / n) * sumYS;
    var amplitude = +Math.sqrt(A * A + B * B).toFixed(2);
    // Nadir timing: phase offset as fraction of recording
    // f(t) = A*cos(ωt) + B*sin(ωt) = R*cos(ωt − φ), φ = atan2(B, A)
    // Minimum at ωt − φ = π → t_nadir_frac = (φ + π) / (2π)
    var phaseRad = Math.atan2(B, A);
    var nadirFrac = ((phaseRad + Math.PI) / (2 * Math.PI)) % 1;
    if (nadirFrac < 0) nadirFrac += 1;
    var nadirHour = +(nadirFrac * (n / 3600)).toFixed(1);
    return { circAmplitude: amplitude, circNadirHour: nadirHour };
  }

  // SpO2 Sample Entropy (same method as HR, applied to SpO2)
  function computeSpO2Entropy(rows) {
    var spo2 = rows.map(function (r) {
      return r.spo2;
    });
    var n = spo2.length;
    if (n < 200) return null;
    // SYNTH-TEXTURE-FOLLOWUPS-III: WHOLE-NIGHT decimation, not a head-slice (see computeHREntropy).
    // `spo2.slice(0,800)` measured only the first ~13 min; corpus head-slice SampEn ≈0.04–0.17
    // ("Low(periodic)") vs whole-night decimation ≈0.4–0.8 ("Normal"). Deterministic uniform stride,
    // same O(cap²) cost, spans the whole recording. Mirrors pulsedex-dsp.js sampEn.
    var CAP = 800; // smaller for speed on SpO2
    var x;
    if (n > CAP) {
      var stride = Math.ceil(n / CAP);
      x = [];
      for (var di = 0; di < n; di += stride) x.push(spo2[di]);
    } else {
      x = spo2.slice();
    }
    var USE = x.length;
    var mean =
      x.reduce(function (a, b) {
        return a + b;
      }, 0) / USE;
    var stdv = Math.sqrt(
      x.reduce(function (a, v) {
        return a + (v - mean) * (v - mean);
      }, 0) / USE
    );
    var r = 0.15 * stdv; // tighter tolerance for SpO2 (1% resolution)
    var m = 2;
    var Bm = 0,
      Am = 0;
    for (var i = 0; i < USE - m; i++) {
      for (var j = i + 1; j < USE - m; j++) {
        var mOk = true,
          mOk1 = true;
        for (var k = 0; k <= m; k++) {
          var diff = Math.abs(x[i + k] - x[j + k]);
          if (k < m && diff > r) mOk = false;
          if (diff > r) mOk1 = false;
        }
        if (mOk) Bm++;
        if (mOk1) Am++;
      }
    }
    var spo2En = Bm > 0 && Am > 0 ? +(-Math.log(Am / Bm)).toFixed(4) : null;
    var label = spo2En === null ? '—' : spo2En < 0.3 ? 'Low(periodic)' : spo2En < 0.8 ? 'Normal' : 'High(chaotic)';
    return { spo2SampEn: spo2En, spo2EnLabel: label };
  }

  // Hypoxic Load (Azarbarzin 2019) — ODI3 × mean dip depth × mean dip duration
  function computeHypoxicLoad(desat, odi3, durationHr, rows, blArr) {
    if (!odi3 || durationHr < 0.5) return null;
    // Detect ODI-3 nadir events directly from raw SpO2 (threshold-consistent with odi3)
    // Azarbarzin 2019: HL = ODI3_rate × meanDepth × meanDuration_min
    // ODI-3-depth subset from the ONE shared detector (ceiling baseline, simple re-rise close
    // matching the legacy ODI-3 logic). DEX-EVENT-UNIFY Task A.
    var nadirEvents = [];
    if (rows && rows.length > 60) {
      var spo2 = rows.map(function (r) {
        return r.spo2;
      });
      // FINDING 1: gate the ODI-3-depth subset on the artifact self-gate (pulse from rows.hr) so
      // hypoxicLoad excludes the SAME probe-squeeze / finger-off artifacts ODI-4 already excludes.
      var pulseSeries = rows.map(function (r) {
        return r.hr;
      });
      nadirEvents = detectDesatEventsGated(spo2, { dropPct: 3, exitPct: 3, blArr: blArr }, pulseSeries).map(function (e) {
        return { depth: e.depth, duration: e.durationSec };
      });
    }
    var nadirCount = nadirEvents.length;
    var meanDepth =
      nadirCount > 0
        ? nadirEvents.reduce(function (s, e) {
            return s + e.depth;
          }, 0) / nadirCount
        : 0;
    var meanDur =
      nadirCount > 0
        ? nadirEvents.reduce(function (s, e) {
            return s + e.duration;
          }, 0) / nadirCount
        : 0;
    // Fall back to odi3.rate if no events detected (short recordings, low ODI)
    var rate = durationHr > 0 ? +(nadirCount / durationHr).toFixed(1) : odi3.rate;
    var hl = +(rate * meanDepth * (meanDur / 60)).toFixed(3); // %·events·min/hr
    var label = hl < 1 ? 'Low' : hl < 5 ? 'Moderate' : 'High';
    return { hypoxicLoad: hl, hlLabel: label, hl_nadirCount: nadirCount, hl_meanDepth: +meanDepth.toFixed(1), hl_meanDurSec: +meanDur.toFixed(0) };
  }

  // Vagal Index — composite of HRV proxies weighted by oxygen stability
  function computeVagalIndex(hrv, extras) {
    if (!hrv || !extras) return null;
    var pnn3 = hrv.pnn3 || 0;
    var hrFloor = hrv.hrFloor || 60;
    var cleanRun = extras.longestCleanRun || 0;
    // Higher pNN3, lower HR floor, longer clean run = better vagal tone
    var vi = +((pnn3 / Math.max(hrFloor, 1)) * Math.log1p(cleanRun)).toFixed(4);
    var label = vi < 0.01 ? 'Low' : vi < 0.05 ? 'Moderate' : 'High';
    return { vagalIndex: vi, vagalLabel: label };
  }

  // Recovery Index — mean recovery slope / mean dip slope (1=symmetric, >1=fast recovery)
  function computeRecoveryIndex(slopes) {
    if (!slopes || !slopes.meanDipSlope || !slopes.meanRecSlope) return null;
    if (slopes.meanDipSlope === 0) return null;
    var ri = +(Math.abs(slopes.meanRecSlope) / Math.abs(slopes.meanDipSlope)).toFixed(3);
    var label = ri > 1.5 ? 'Fast' : ri > 0.8 ? 'Symmetric' : 'Slow';
    return { recoveryIndex: ri, riLabel: label };
  }

  // Sleep Pressure Index — composite of WASO, motion bursts, SOL
  function computeSleepPressure(sleepArch, extras) {
    if (!sleepArch || !extras) return null;
    // FINDING 6 (SPI inversion): wasoMin/solMin are a v22.15 TRI-STATE — both null together when
    // sleep onset is undetectable (computeSleepArch withholds them rather than seeding the onsetIdx=0
    // fallback). The old `wasoMin || 0` / `solMin !== null ? : 0` FABRICATED them to 0, collapsing the
    // two DOMINANT SPI terms (0.4·WASO + 0.25·SOL = 65% of the weight) to 0 EXACTLY on the worse
    // (undetected-onset) nights — so an undetected-onset night scored LOWER pressure than a calm
    // detected one: a literal inversion. It was also internally inconsistent with the night-quality
    // push, which gates WASO/SOL on `!== null` yet pushed the fabricated SPI unconditionally. Withhold
    // SPI (null) when its dominant inputs were withheld — gate on inputs PRESENT, never seed one
    // (mirrors sleepArch's own tri-state and computeSleepStabilityScore's null hrFloor handling). The
    // night-quality push is already `if (n.sleepP)`-guarded, so a withheld SPI no longer enters the
    // quality score. A bursts-only SPI would not be a meaningful "sleep pressure", so null (not a
    // renormalized bursts-only proxy) is the honest tri-state here.
    if (sleepArch.wasoMin == null || sleepArch.solMin == null) return null;
    var waso = sleepArch.wasoMin;
    var bursts = extras.motionBursts || 0;
    var sol = sleepArch.solMin;
    var spi = +(waso * 0.4 + bursts * 0.15 + sol * 0.25).toFixed(2);
    var label = spi < 5 ? 'Low' : spi < 15 ? 'Moderate' : 'High';
    return { spi: spi, spiLabel: label };
  }

  // Breathing Irregularity — CV of inter-nadir intervals
  function computeBreathingIrregularity(desat, rows, blArr) {
    if (!rows || rows.length < 60) return null;
    var spo2 = rows.map(function (r) {
      return r.spo2;
    });
    // §2: dropped the vestigial `desat.nadir.count < 3` pre-gate — it gated on the simple-close,
    // self-gated nadir.count, a DIFFERENT set than the hysteresis-close inter-nadir set scored here;
    // the `nadirTimes.length < 3` check below is the real gate, on the SET THIS USES. §3 close-mode:
    // ODI-4 entry + anti-chatter HYSTERESIS close (satellite set). §1: shared p90-ceiling blArr threaded.
    var nadirTimes = detectDesatEvents(spo2, { dropPct: DexKernel.K.ODI_DROP, blArr: blArr }).map(function (e) {
      return e.nadirIdx;
    });
    if (nadirTimes.length < 3) return null;
    var intervals = [];
    for (var i = 1; i < nadirTimes.length; i++) intervals.push(nadirTimes[i] - nadirTimes[i - 1]);
    var iMean = intervals.length
      ? intervals.reduce(function (a, b) {
          return a + b;
        }, 0) / intervals.length
      : 0;
    var iSD = Math.sqrt(
      intervals.reduce(function (a, v) {
        return a + (v - iMean) * (v - iMean);
      }, 0) / intervals.length
    );
    var biCV = iMean > 0 ? +((iSD / iMean) * 100).toFixed(1) : null;
    var label = biCV === null ? '—' : biCV < 30 ? 'Regular' : biCV < 60 ? 'Variable' : 'Irregular';
    return { biCV: biCV, biLabel: label };
  }

  // OxyCrash — count of SpO2 drops >5% in <30s (rapid acute dips)
  function computeOxyCrash(rows) {
    var spo2 = rows.map(function (r) {
      return r.spo2;
    });
    var n = spo2.length;
    if (n < 60) return { oxyCrashCount: 0 };
    var crashes = 0;
    var WIN = 30;
    var cooldown = 0;
    for (var i = WIN; i < n; i++) {
      if (cooldown > 0) {
        cooldown--;
        continue;
      }
      if (spo2[i - WIN] - spo2[i] >= 5) {
        crashes++;
        cooldown = WIN;
      } // 30s cooldown prevents re-counting sustained drops
    }
    var durationHr = n / 3600;
    return { oxyCrashCount: crashes, oxyCrashRate: durationHr > 0 ? +(crashes / durationHr).toFixed(1) : 0 };
  }

  // Nocturnal HR Dip % — (refHR - hrFloor) / refHR  (higher=better parasympathetic)
  function computeHRNoctDip(hrv, stats) {
    if (!hrv || !stats) return null;
    // Intra-night HR descent: (night mean - night floor) / night mean × 100
    // NOTE: true nocturnal dip requires daytime HR (unavailable here)
    // This measures how much HR drops from nightly mean to its lowest — NOT standard clinical dip
    var refHR = stats.meanHr || 60;
    var floor = hrv.hrFloor || refHR;
    var dip = +(((refHR - floor) / refHR) * 100).toFixed(1);
    var label = dip > 10 ? 'Good (intra-night)' : dip > 5 ? 'Moderate (intra-night)' : 'Low (intra-night)';
    return { hrnDip: dip, hrnDipLabel: label };
  }

  // Desaturation Asymmetry — mean dip slope / mean recovery slope
  // >1 = faster dip than recovery (abrupt obstructive); <1 = slow dip fast recovery (central)
  function computeDesatAsymmetry(slopes) {
    if (!slopes || !slopes.meanRecSlope || slopes.meanRecSlope === 0) return null;
    var asym = +(Math.abs(slopes.meanDipSlope) / Math.abs(slopes.meanRecSlope)).toFixed(3);
    var label = asym > 1.5 ? 'Abrupt (obstructive)' : asym > 0.7 ? 'Symmetric' : 'Gradual (central)';
    return { desatAsym: asym, asymLabel: label };
  }

  // ═══════════════════════════════════════════════════════════════
  // v20.6: 8 BUG FIXES + 18 NEW METRICS (A-O) — auto-rank 5 worst metrics + clinical impression
  // ═══════════════════════════════════════════════════════════════
  function computeSmartSummary(n) {
    // Each entry: { key, label, value, displayVal, score (0=best,10=worst), sev ('g'/'w'/'r') }
    var metrics = [];

    var spo2Keys = ['minSpo2', 'meanSpo2', 't95', 't90', 'odi4', 'odi3', 'odi1', 'hb', 'sbii', 'pred3p', 'desSev', 'wtdsi', 'cdi'];
    var hrKeys = ['hrSpikes', 'nsi', 'sfi', 'hrnDip', 'rmssd', 'hrFloor'];
    var sleepKeys = ['wasoMin', 'waso', 'sleepEff', 'solMin', 'sol', 'motPct', 'lcsp', 'remProxy', 'nremDeep', 'osc', 'breathI'];
    function push(key, label, val, score, displayVal, sev) {
      if (val === null || val === undefined) return;
      var cat = spo2Keys.indexOf(key) >= 0 ? 'spo2' : hrKeys.indexOf(key) >= 0 ? 'hr' : sleepKeys.indexOf(key) >= 0 ? 'sleep' : null;
      metrics.push({ key: key, label: label, value: val, displayVal: displayVal || String(val), score: score, sev: sev || (score < 3 ? 'g' : score < 6 ? 'w' : 'r'), cat: cat });
    }

    // ── SpO2 ──
    if (n.stats) {
      var minS = n.stats.minSpo2;
      push('minSpo2', 'Min SpO₂', minS, minS >= 93 ? 0 : minS >= 90 ? 3 : minS >= 87 ? 5 : minS >= 85 ? 7 : 10, minS + '%');
      var t95 = n.stats.t95pct;
      push('t95', 'T95%', t95, t95 < 1 ? 0 : t95 < 5 ? 2 : t95 < 10 ? 4 : t95 < 20 ? 6 : t95 < 30 ? 8 : 10, t95 + '%');
      var meanS = n.stats ? n.stats.meanSpo2 : 0;
      push('meanSpo2', 'Mean SpO₂', meanS, meanS >= 96 ? 0 : meanS >= 95 ? 1 : meanS >= 94 ? 3 : meanS >= 93 ? 5 : 8, meanS + '%');
    }
    if (n.ct94) push('ct94', 'CT<94%', n.ct94.ct94Pct, n.ct94.ct94Pct < 5 ? 1 : n.ct94.ct94Pct < 15 ? 4 : n.ct94.ct94Pct < 30 ? 7 : 10, n.ct94.ct94Pct + '%');

    // ── ODI ──
    if (n.odi4) push('odi4', 'ODI-4/hr', n.odi4.rate, n.odi4.rate < 2 ? 0 : n.odi4.rate < 5 ? 2 : n.odi4.rate < 15 ? 5 : n.odi4.rate < 30 ? 8 : 10, n.odi4.rate + '/hr');
    if (n.odi3) push('odi3', 'ODI-3/hr', n.odi3.rate, n.odi3.rate < 3 ? 0 : n.odi3.rate < 8 ? 2 : n.odi3.rate < 20 ? 5 : n.odi3.rate < 35 ? 8 : 10, n.odi3.rate + '/hr');
    if (n.odi1) push('odi1', 'ODI-1/hr', n.odi1.odi1Rate, n.odi1.odi1Rate < 10 ? 0 : n.odi1.odi1Rate < 20 ? 2 : n.odi1.odi1Rate < 40 ? 5 : 8, n.odi1.odi1Rate + '/hr');

    // ── Breathing disruption ──
    if (n.osc)
      push(
        'pbEp',
        'PB Episodes',
        n.osc.episodeCount,
        n.osc.episodeCount === 0 ? 0 : n.osc.episodeCount < 3 ? 1 : n.osc.episodeCount < 8 ? 4 : n.osc.episodeCount < 15 ? 7 : 10,
        n.osc.episodeCount + ' eps'
      );
    if (n.rolling)
      push(
        'worst10',
        'Worst 10min SpO₂',
        n.rolling.worst10minSpo2,
        n.rolling.worst10minSpo2 >= 95 ? 0 : n.rolling.worst10minSpo2 >= 93 ? 2 : n.rolling.worst10minSpo2 >= 90 ? 5 : n.rolling.worst10minSpo2 >= 87 ? 7 : 10,
        n.rolling.worst10minSpo2 + '%'
      );
    if (n.rolling) push('cdi', 'CDI/hr', n.rolling.cdi, n.rolling.cdi < 3 ? 0 : n.rolling.cdi < 8 ? 2 : n.rolling.cdi < 15 ? 5 : n.rolling.cdi < 25 ? 7 : 10, n.rolling.cdi + '/hr');
    if (n.oxyCrash)
      push(
        'oxyCrash',
        'OxyCrash/hr',
        n.oxyCrash.oxyCrashRate,
        n.oxyCrash.oxyCrashRate < 1 ? 0 : n.oxyCrash.oxyCrashRate < 3 ? 3 : n.oxyCrash.oxyCrashRate < 6 ? 6 : 10,
        n.oxyCrash.oxyCrashRate + '/hr'
      );

    // ── Hypoxic burden ──
    if (n.hb) push('hbRate', 'Hypoxic Burden', n.hb.rate, n.hb.rate < 0.5 ? 0 : n.hb.rate < 2 ? 2 : n.hb.rate < 5 ? 5 : n.hb.rate < 10 ? 7 : 10, n.hb.rate + '%-min/hr');
    if (n.hypLoad) push('hypLoad', 'Hypoxic Load', n.hypLoad.hypoxicLoad, n.hypLoad.hypoxicLoad < 0.5 ? 0 : n.hypLoad.hypoxicLoad < 2 ? 2 : n.hypLoad.hypoxicLoad < 5 ? 5 : 9, n.hypLoad.hypoxicLoad);

    // ── AHI estimate ──
    if (n.ahiEst) push('ahiEst', 'AHI Estimate', n.ahiEst.ahiODI4, n.ahiEst.ahiODI4 < 5 ? 0 : n.ahiEst.ahiODI4 < 15 ? 3 : n.ahiEst.ahiODI4 < 30 ? 6 : 9, n.ahiEst.ahiODI4);

    // ── Sleep quality ──
    if (n.sleepArch) {
      if (n.sleepArch.wasoMin !== null)
        push('waso', 'WASO', n.sleepArch.wasoMin, n.sleepArch.wasoMin < 5 ? 0 : n.sleepArch.wasoMin < 15 ? 2 : n.sleepArch.wasoMin < 30 ? 5 : 8, n.sleepArch.wasoMin + 'm');
      if (n.sleepArch.solMin !== null)
        push('sol', 'Sleep Onset', n.sleepArch.solMin, n.sleepArch.solMin < 10 ? 0 : n.sleepArch.solMin < 20 ? 2 : n.sleepArch.solMin < 30 ? 4 : 7, n.sleepArch.solMin + 'm');
    } else if (n.motSleep) {
      if (n.motSleep.wasoPct != null) push('waso', 'WASO %', n.motSleep.wasoPct, n.motSleep.wasoPct < 5 ? 0 : n.motSleep.wasoPct < 15 ? 2 : n.motSleep.wasoPct < 30 ? 5 : 8, n.motSleep.wasoPct + '%');
      if (n.motSleep.sleepEff != null)
        push('sleepEff', 'Sleep Eff', n.motSleep.sleepEff, n.motSleep.sleepEff >= 95 ? 0 : n.motSleep.sleepEff >= 90 ? 1 : n.motSleep.sleepEff >= 80 ? 4 : 7, n.motSleep.sleepEff + '%');
    }
    if (n.sleepP) push('spi', 'Sleep Pressure', n.sleepP.spi, n.sleepP.spi < 5 ? 0 : n.sleepP.spi < 10 ? 2 : n.sleepP.spi < 20 ? 5 : 8, n.sleepP.spi);

    // ── Autonomic / HR ──
    if (n.comp) push('nsi', 'NSI', n.comp.nsi, n.comp.nsi < 20 ? 0 : n.comp.nsi < 40 ? 2 : n.comp.nsi < 60 ? 5 : n.comp.nsi < 80 ? 7 : 10, n.comp.nsi);
    if (n.ssi) push('ssi', 'Symp Surge', n.ssi.ssi, n.ssi.ssi < 0.3 ? 0 : n.ssi.ssi < 0.8 ? 2 : n.ssi.ssi < 1.5 ? 5 : 8, n.ssi.ssi);
    if (n.cross) push('aai', 'AAI', n.cross.autoArousalIdx, n.cross.autoArousalIdx < 1 ? 0 : n.cross.autoArousalIdx < 3 ? 2 : n.cross.autoArousalIdx < 6 ? 5 : 8, n.cross.autoArousalIdx);
    if (n.hrnDip)
      push(
        'hrnDip',
        'Noct HR Dip',
        n.hrnDip.hrnDip,
        n.hrnDip.hrnDip > 10 ? 0 : n.hrnDip.hrnDip > 5 ? 3 : n.hrnDip.hrnDip > 2 ? 6 : 9,
        n.hrnDip.hrnDip + '%',
        n.hrnDip.hrnDip > 10 ? 'g' : n.hrnDip.hrnDip > 5 ? 'w' : 'r'
      );

    // ── Signal quality ──
    // DFA computed on SpO2 — always >1.0, HR-DFA thresholds inapplicable. Excluded from score.
    if (n.recIdx)
      push(
        'recIdx',
        'Recovery Idx',
        n.recIdx.recoveryIndex,
        n.recIdx.recoveryIndex > 1.5 ? 0 : n.recIdx.recoveryIndex > 0.8 ? 2 : n.recIdx.recoveryIndex > 0.5 ? 5 : 8,
        n.recIdx.recoveryIndex,
        n.recIdx.recoveryIndex > 1.5 ? 'g' : n.recIdx.recoveryIndex > 0.8 ? 'w' : 'r'
      );

    // ── Literature-validated severity indices ──
    if (n.sbii && n.sbii.sbii != null) {
      var _sq = n.sbii.sbiiQ || '';
      push(
        'sbii',
        'SBII',
        n.sbii.sbii,
        _sq === 'Q5(high)' ? 10 : _sq === 'Q4' ? 7 : _sq === 'Q3' ? 4 : _sq === 'Q2' ? 1 : 0,
        n.sbii.sbii + ' %²·min/hr',
        _sq === 'Q5(high)' ? 'r' : _sq === 'Q4' ? 'w' : 'g'
      );
    }
    if (n.pred3p && n.pred3p.pred3p != null) {
      var _pq = n.pred3p.pred3pQ || '';
      push(
        'pred3p',
        'pRED-3p',
        n.pred3p.pred3p,
        _pq === 'Q5(high)' ? 10 : _pq === 'Q4' ? 7 : _pq === 'Q3' ? 4 : _pq === 'Q2' ? 1 : 0,
        n.pred3p.pred3p + '%',
        _pq === 'Q5(high)' ? 'r' : _pq === 'Q4' ? 'w' : 'g'
      );
    }
    if (n.desSev && n.desSev.desSev != null) push('desSev', 'DesSev', n.desSev.desSev, n.desSev.desSev < 5 ? 0 : n.desSev.desSev < 15 ? 3 : n.desSev.desSev < 30 ? 6 : 9, n.desSev.desSev + '%-min/hr');
    if (n.spo2Adv && n.spo2Adv.wtdsi != null) push('wtdsi', 'WtDSI', n.spo2Adv.wtdsi, n.spo2Adv.wtdsi < 1 ? 0 : n.spo2Adv.wtdsi < 3 ? 2 : n.spo2Adv.wtdsi < 5 ? 5 : 9, n.spo2Adv.wtdsi);

    if (n.patScore) {
      if (n.patScore.csScore > 0) push('cs', 'Cheyne-Stokes', n.patScore.csScore, n.patScore.csScore * 3, n.patScore.csLabel, n.patScore.csScore === 1 ? 'w' : 'r');
      if (n.patScore.uarsScore > 0) push('uars', 'UARS Pattern', n.patScore.uarsScore, n.patScore.uarsScore * 3, n.patScore.uarsLabel, n.patScore.uarsScore === 1 ? 'w' : 'r');
    }

    // ── Sort by score descending, take top 5 ──
    metrics.sort(function (a, b) {
      return b.score - a.score;
    });
    var top5 = metrics.slice(0, 5);

    // ── Generate one-line clinical impression ──
    var impression = buildImpression(n, top5, metrics);

    return {
      ranked: metrics,
      top5: top5,
      impression: impression,
      overallScore: top5.length
        ? Math.round(
            top5.reduce(function (a, m) {
              return a + m.score;
            }, 0) / top5.length
          )
        : 0
    };
  }

  function buildImpression(n, top5, all) {
    if (!top5.length) return 'Insufficient data for clinical impression.';

    var parts = [];
    var worstKey = top5[0].key;
    var worstScore = top5[0].score;

    // Overall severity opener. Guardrail: the all-metric average can read 'clean' while a
    // single metric is red — never label a night clean/mild when its worst finding is severe
    // (would print e.g. "Clean night: severe desaturation"). Floor severity to the lead.
    var avgScore =
      all.reduce(function (a, m) {
        return a + m.score;
      }, 0) / Math.max(all.length, 1);
    /* MULTINIGHT-CORPUS-FINDINGS §4 — the guardrail had swallowed the whole ladder. Gating
       `Clean night` on `worstScore < 4` and `Mild disruption` on `< 6` is unreachable in practice:
       with 28 ranked metrics SOMETHING always scores 8-10, so across a 37-night corpus every single
       night printed `Moderate burden` while `avgScore` — the statistic actually driving it — ranged
       1.19 to 5.21. A label constant over a 4.4x spread carries no information; it reads as a
       verdict and is really a formatting artifact.

       The guardrail's INTENT is kept: never call a night clean while a finding on it is severe.
       What changes is its strength. It now floors only on a 10 — a metric at the very top of its
       scale — instead of on anything >= 4/6. An 8 is common enough to be the worst finding on the
       corpus's QUIETEST night (2026-07-21: ODI3 0.8/h, T90 0.2 %, nadir 90 %), so treating an 8 as
       disqualifying is exactly what collapsed the vocabulary. The lead finding still opens the
       sentence either way, so a quiet night carrying one red metric reads
       `Mild disruption: nadir SpO2 84%` — the severity word describes the night, the clause names
       what was found, and neither has to lie for the other.

       Bands are read off the observed distribution rather than left at their original guesses.
       Owner-ratified 2026-07-29. */
    var severity;
    if (avgScore < 2 && worstScore < 10) severity = 'Clean night';
    else if (avgScore < 3 && worstScore < 10) severity = 'Mild disruption';
    else if (avgScore < 4.5) severity = 'Moderate burden';
    else severity = 'Significant burden';
    var isolatedSevere = avgScore < 4 && worstScore >= 6; // mostly-clean night, one red finding

    // Lead finding
    var leads = {
      minSpo2: function () {
        return n.stats ? 'nadir SpO₂ ' + n.stats.minSpo2 + '%' : 'nadir unavailable';
      },
      t95: function () {
        return n.stats ? 'T95 ' + n.stats.t95pct + '%' : 'T95 unavailable';
      },
      odi4: function () {
        return n.odi4 ? 'ODI-4 ' + n.odi4.rate + '/hr' : 'ODI-4 unavailable';
      },
      pbEp: function () {
        return n.osc ? n.osc.episodeCount + ' PB episodes' : 'PB data unavailable';
      },
      worst10: function () {
        return 'worst 10-min SpO₂ ' + n.rolling.worst10minSpo2 + '%';
      },
      cdi: function () {
        return n.rolling ? 'CDI ' + n.rolling.cdi + '/hr' : 'CDI unavailable';
      },
      nsi: function () {
        return n.comp ? 'NSI ' + n.comp.nsi : 'NSI unavailable';
      },
      waso: function () {
        return n.sleepArch && n.sleepArch.wasoMin != null ? 'WASO ' + n.sleepArch.wasoMin + 'm' : 'WASO —';
      },
      dfa: function () {
        return n.dfa ? 'DFA α1 ' + n.dfa.alpha1 : 'DFA unavailable';
      },
      hbRate: function () {
        return n.hb ? 'HB rate ' + n.hb.rate + ' %-min/hr' : 'HB unavailable';
      },
      oxyCrash: function () {
        return n.oxyCrash ? 'OxyCrash ' + n.oxyCrash.oxyCrashRate + '/hr' : 'OxyCrash unavailable';
      },
      ahiEst: function () {
        return n.ahiEst ? 'AHI est. ' + n.ahiEst.ahiODI4 : 'AHI unavailable';
      },
      cs: function () {
        /* Read "CS pattern probable (Likely)" before the fix — a likelihood asserted twice, from a
           score that cannot support it once. Now a bare VALUE, in the same shape as the sibling leads
           ("HB rate 12 %-min/hr", "AHI est. 14"). Deliberately terser than the context qualifier: the
           first regeneration against the real corpus emitted the caveat here too and the impression
           read the identical sentence twice ("… CS pattern indicators 3/3 — screening signal, no
           periodicity test; CS pattern indicators 3/3 — screening signal, no periodicity test."). The
           lead carries the count; the context line carries the caveat, once. */
        return n.patScore ? 'CS indicators ' + n.patScore.csScore + '/3' : 'CS unavailable';
      },
      uars: function () {
        return n.patScore ? 'UARS indicators ' + n.patScore.uarsScore + '/3' : 'UARS unavailable';
      },
      hypLoad: function () {
        return n.hypLoad ? 'hypoxic load ' + n.hypLoad.hypoxicLoad : 'hypLoad unavailable';
      },
      hrnDip: function () {
        return n.hrnDip ? 'blunted nocturnal HR dip ' + n.hrnDip.hrnDip + '%' : 'HR dip unavailable';
      },
      recIdx: function () {
        return n.recIdx ? 'impaired SpO₂ recovery (idx ' + n.recIdx.recoveryIndex + ')' : 'recIdx unavailable';
      }
    };

    var leadTxt = leads[worstKey] ? leads[worstKey]() : top5[0].label + ' ' + top5[0].displayVal;

    // Supporting finding
    var supportTxt = top5.length > 1 ? (leads[top5[1].key] ? leads[top5[1].key]() : top5[1].label + ' ' + top5[1].displayVal) : '';

    /* Context qualifier — an OBSERVATION, never an instruction (OXYDEX-PB-OVERCALL §4 item 3).
       These two lines used to read "CS pattern likely — review CPAP pressure" and "UARS pattern —
       consider UARS protocol". Both prescribed a therapy action off a 0-3 heuristic score, and the CS
       one fired on 25 of the 37 corpus nights (68 %). Two things were wrong with that:

         1. It prescribed. A one-line impression telling two thirds of nights to review CPAP pressure is
            an instruction the evidence cannot carry, and this suite is explicitly not a medical device.
         2. "likely" overclaimed. §5.1 measured what the detector under `csScore` actually gates on:
            `detectOscillations` has NO periodicity test at all — no cycle-length criterion (cycleLen is
            computed into meta AFTER the decision and gates nothing), no crescendo-decrescendo, and it
            counts crossings of an ABSOLUTE 95 % level. On a corpus whose overnight mean is 94.6-96.6 %
            the trace straddles that line all night, and 1 Hz oximetry reports INTEGERS — so a value
            dithering 94/95/96 crosses continually with no breathing periodicity whatever. The episode
            count correlates r = 0.893 with time below 95 % and r = -0.821 with mean SpO2. It is
            measuring mild hypoxemia burden, which is a real quantity but not the one "Cheyne-Stokes"
            names.

       So the surface now states the score it actually has and what that score is not. The score itself,
       its 0-3 ladder and the >= 2 gate are UNCHANGED — this is a wording fix, not a retune. §5.2 found
       no defensible threshold on this corpus, so retuning would be guessing; naming the thing honestly
       does not require a number nobody can derive. */
    var context = '';
    if (n.patScore && n.patScore.csScore >= 2) context = '; CS pattern indicators ' + n.patScore.csScore + '/3 — screening signal, no periodicity test';
    else if (n.patScore && n.patScore.uarsScore >= 2) context = '; UARS pattern indicators ' + n.patScore.uarsScore + '/3 — screening signal';
    else if (n.stab && n.stab.score != null && n.stab.score >= 80) context = '; otherwise stable baseline';
    else if (n.osc && n.osc.episodeCount >= 10) context = '; high PB burden';

    parts.push(severity + ': ' + leadTxt);
    if (isolatedSevere && !supportTxt) parts.push('otherwise an isolated finding on a quiet night');
    if (supportTxt) parts.push(supportTxt);

    return parts.join(', ') + context + '.';
  }

  function processNight(rows, fname) {
    var warmupTrim = trimSensorWarmup(rows); // FIRST — drop device warm-up/cool-down placeholder edge rows (OXYDEX-HR-ARTIFACT-RUNAWAY-FIX Fix 2)
    var artifactsCleaned = cleanArtifactHR(rows); // then clean HR before any analysis
    var date = rows.length ? fmtDate(rows[0].t) : 'Unknown';
    var t0Ms = rows.length ? rows[0].tMs : null; // CLOCK-UNIFY per-recording anchor
    var stats = computeStats(rows);
    stats.artifactHrCleaned = artifactsCleaned;
    // EXPORT-INVARIANCE (OXYDEX-HR-ARTIFACT-RUNAWAY-FIX Fix 2): attach the trim counts ONLY when a trim
    // actually fired. `stats` is serialized WHOLESALE into the export (oxyBuildNightElement: stats:n.stats),
    // so an always-present `sensorWarmupTrimmed:0` would move EVERY night's export bytes — including the
    // committed provenance fixtures (20260612 / 20260624, both no-trim). Conditional assignment → zero
    // churn on any untrimmed night; buildFlags reads `>0`, correctly false when the field is absent.
    if (warmupTrim.head > 0) stats.sensorWarmupTrimmed = warmupTrim.head;
    if (warmupTrim.tail > 0) stats.sensorCooldownTrimmed = warmupTrim.tail;
    var rawSpikes = detectSpikes(rows);
    var spikes = filterArtifactSpikes(rawSpikes);
    stats.artifactSpikesRemoved = rawSpikes.length - spikes.length;
    /* How many of the rejected ones sat near a clock hour — the vendor-confirmed firmware signature.
       Reported, not acted on: a night where these two counts diverge is either a device whose artifact
       has moved off the hour, or a genuine arousal cluster, and both are worth a human noticing. */
    var clockAlignedRejected = 0;
    for (var si = 0; si < rawSpikes.length; si++) if (rawSpikes[si].artifact && rawSpikes[si].clockAligned) clockAlignedRejected++;
    if (clockAlignedRejected > 0) stats.artifactSpikesClockAligned = clockAlignedRejected;
    var period = detectPeriodicity(spikes);
    var osc = detectOscillations(rows);
    // OXYDEX-NODE-EXPORT-ENVELOPE §2b: lift the per-episode PB onsets OFF n.osc (keeping its 5-key
    // display shape byte-identical in the export element) onto night_obj.oscEpisodes, where
    // oxyBuildGangliorEvents reads them to emit one periodic_breathing event per oscillation episode.
    var _oscEpisodes = osc && osc.episodes ? osc.episodes : [];
    if (osc) delete (/** @type {any} */ (osc).episodes);
    var tIdx = computeTIndex(rows);
    var hrv = computeHRV(rows);
    var spo2s = rows.map(function (r) {
      return r.spo2;
    });
    // DEX-EVENT-UNIFY-FOLLOWUPS-II §1 — PERF MEMOIZE: the trailing-p90 CEILING baseline is a pure
    // function of (spo2, WIN=300, pct=90), and EVERY desat consumer below uses those defaults, so each
    // detectDesatEvents call would otherwise re-walk the identical O(n·101) histogram. Compute it ONCE
    // and thread it as opts.blArr — bit-identical numbers (the array is deterministic), ~11 redundant
    // baseline walks collapse to 1. The per-consumer event scan stays local (cheap O(n); and the two
    // close modes mean there is no single shared event set — see detectDesatEvents §3). detectDesatEvents
    // falls back to computing blArr when absent, so every direct/test caller is unaffected.
    var blArr = computeCeilingBaselineArr(spo2s, 300, 90);
    // FINDING 1: pulse series for the ODI-3 artifact self-gate. ODI-4 is left UNGATED here — its
    // artifacts are subtracted below via desat.artifactCount — so ONLY the ODI-3 call receives it.
    var pulseSeries = rows.map(function (r) {
      return r.hr;
    });
    var odi4 = detectODI(spo2s, DexKernel.K.ODI_DROP, rows.length, blArr);
    var odi3 = detectODI(spo2s, 3, rows.length, blArr, pulseSeries);
    var hb = computeHypoxicBurden(rows);
    /* NO MOTION READING ANYWHERE ⇒ THE MOTION FAMILY IS ABSENT, NOT ZERO (DA-V §2.3 F15).
       The parse boundary now yields `null` for a device that wrote no Motion column at all. That is
       the SAME category as `_motionColumnStuck` — "this motion series cannot be trusted, so nothing
       derived from it may be published" — and it takes the SAME suppression path, which is why this
       fix needs no change at any of the ~20 downstream `motion > 0` / `motion === 0` sites. It is
       distinguished in the export by its own flag, because "the device has no accelerometer" and "the
       writer emitted a stuck column" are different facts a reader must be able to tell apart. */
    var _motionAbsent = !rows.some(function (r) {
      return r.motion != null && isFinite(r.motion);
    });
    var _motionStuck = _motionAbsent ? false : _motionColumnStuck(rows);
    var _motionUnusable = _motionAbsent || _motionStuck === true;
    var motion = _motionUnusable ? null : computeMotionProfile(rows);
    var durationHr = /** @type {number} */ (stats.durationMin) / 60;
    var desat = computeDesaturationProfile(rows, tIdx, odi4, blArr);
    // OXIMETER SELF-GATE (Part A): exclude self-gated artifact desaturations from
    // the ODI-4 rate. The desat profile and the ODI counter share the same
    // inclusive bl-ODI_DROP entry, so each flagged artifact corresponds to one
    // ODI-4 event; subtract them so a probe-squeeze "67% cliff" never inflates ODI.
    if (odi4 && desat && desat.artifactCount) {
      odi4.count = Math.max(0, (odi4.count || 0) - desat.artifactCount);
      // §5 (DEEP-AUDIT-2026-07-14): re-rate on the SAME sample basis detectODI/computeODI1/nadir/crashRate
      // use (rows.length/3600), NOT the elapsed span (stats.durationMin/60). On a gappy night the two diverge
      // (dropped rows ⇒ rows.length < span), and mixing them made odi4.rate span-based while odi1Rate stayed
      // sample-based — so the surfaced ODI-4/hr and odi41ratio sat on incompatible clocks. Sample basis is the
      // clinically honest "per hour of analyzable recording" denominator, and the one every other ODI-family
      // site already uses. Inert on the current corpus (the O2Ring drops ~0 samples); a real finger-off or a
      // sparse-cadence oximeter would surface it. Gated by a committed gap+artifact synthetic twin.
      odi4.rate = +(odi4.count / Math.max(rows.length / 3600, 0.01)).toFixed(1);
      odi4.artifactExcluded = desat.artifactCount;
    }
    // OXYDEX-NADIR-HONESTY (RUNAWAY-FIX-FOLLOWUPS §1/§2): route the HEADLINE nadir through the artifact
    // gate. computeStats' raw Math.min can be a single-second dropout or the opening settling ramp;
    // recompute minSpo2 excluding self-gated artifact desats + the opening ramp (computeGatedNadir).
    // Preserve the raw absolute min as minSpo2Raw ONLY when the gate changes it (conditional → byte-
    // identical export on the common case + the committed fixtures). SPO2_CRITICAL_DIP / buildImpression /
    // the minSpo2 card all read stats.minSpo2, so they become honest automatically.
    var _gatedNadir = computeGatedNadir(rows, desat, stats.minSpo2);
    if (_gatedNadir.min !== stats.minSpo2) {
      stats.minSpo2Raw = stats.minSpo2;
      stats.minSpo2 = _gatedNadir.min;
      stats.nadirArtifactExcluded = _gatedNadir.excluded;
    }
    var hrProf = computeHRProfile(rows);
    var motSleep = computeMotionSleep(rows);
    /* MULTINIGHT-CORPUS-FINDINGS §3 — a motion column that is NEVER zero is a sensor/writer fault,
       not a night of continuous movement, and everything derived from it is meaningless rather than
       extreme. On 2026-07-16 and 07-17 the capture host wrote a Motion field pinned at ~19–27 for
       every sample of the night (every other night in the corpus is >= 98 % zero); OxyDex read
       `motion > 0` as movement and published `motionPct 100`, `sleepEff 0`, `arousalIndex 100`,
       `wasoPct 100` — a confident description of a night that did not happen — while every
       motion-GATED metric silently ran on an empty sample set.

       The response is the `_durBad`/`durationInflated` one directly above: surface the absence, do
       not publish a plausible wrong number. `computeHRV` already self-nulls here (it has no
       motion-free samples to work with), which is the behaviour the rest now matches.

       The whole NIGHT's motion family is dropped even though the fault is per-source, because a
       merged night carries no source provenance by the time it reaches here — and a motion series
       that is part fabrication cannot be partially trusted. See `_motionColumnStuck` for why the
       detector measures a contiguous run rather than the night's zero-fraction. */
    if (_motionUnusable) {
      motSleep = /** @type {any} */ (null);
      /* `motionPct` is the one motion number that survives — as an explicit null plus the reason,
         because a reader who sees the field absent must be able to tell "the sensor lied" from
         "this build predates the field". Conditional assignment (the EXPORT-INVARIANCE convention
         a few lines below) keeps every healthy night's export byte-identical. */
      stats.motionPct = /** @type {any} */ (null);
      // Name WHICH fault, or a reader cannot tell "this oximeter has no accelerometer" (nothing to
      // fix, the metric simply does not exist for this device) from "the writer emitted a stuck
      // column" (a capture-side fault worth chasing). Both suppress; only one is a bug.
      if (_motionAbsent) stats.motionColumnAbsent = true;
      else stats.motionColumnStuck = true;
    } else if (_motionStuck === null) {
      /* INDETERMINATE (DA-V §2.3 F23) — under a minute of samples, unbroken continuity carries no
         information either way, so the detector reached NO verdict. Publish the motion numbers (there
         is no evidence against them) but say that plainly, so a reader cannot read "not tested" as
         "tested clean". Conditional assignment, like the branch above, so every night that DID get a
         verdict keeps its export byte-identical. */
      stats.motionColumnStuckUnknown = true;
    }
    /* ORDERING IS LOAD-BEARING (DA-V §2.3, found while fixing F15 — it is a PRE-EXISTING leak in the
       `_motionStuck` path too, not something F15 introduced). `computeSleepStabilityScore` already
       does the right thing with an absent motion figure: its §3 branch nulls the motion subscore when
       `stats.motionPct == null` and renormalizes the remaining weight. But it used to be CALLED ~30
       lines ABOVE the block that nulls `stats.motionPct`, so it never saw the null and its own fix
       could not fire. Measured on the real 592-row stuck file: `stab.components.motion` = 0 (the worst
       possible score, from a column the code had just condemned as unreadable) where the comment three
       lines into that function says it must be null; on a Motion-less file it was 100 — a PERFECT
       stillness score from a device with no accelerometer. Computed here instead, after the verdict is
       known. `stab` has no other consumer before `buildFlags` below, so nothing else moves. */
    var stab = computeSleepStabilityScore(stats, hrv, osc, hb);
    var cross = computeCrossSignal(rows, osc, spikes, odi4, durationHr);
    var spo2Adv = computeSpO2Advanced(rows, blArr); // nadir events computed inline
    var hrAdv = computeHRAdvanced(rows, osc);
    var comp = computeComposite(rows, spikes, desat, cross, motSleep, durationHr);
    // v20: literature-validated metrics
    // §2.1/§2.2 — both score the ARTIFACT-GATED canonical desat set (`desat.events`), so the
    // self-gate exclusion already applied to ODI-4 above is inherited instead of re-derived.
    var sbii = computeSBII(rows, desat, durationHr, blArr);
    var pred3p = computePRED3p(rows, null, blArr);
    var desSev = computeDesSev(rows, blArr, desat);
    var ctPrec = computeCTprecise(rows);
    // v20.2: 15 new metrics
    var ct94 = computeCT94(rows);
    var slopes = computeDesatSlopes(rows, blArr);
    var pbMet = computePBmetrics(rows, osc);
    var sleepArch = computeSleepArch(rows);
    /* `wasoMin` is a MOTION metric wearing a sleep-architecture name — it counts `r.motion > 0` after
       sleep onset — so it inherits the same verdict (DA-V §2.3 F15). Without this it read a confident
       `0` ("no wake after sleep onset") off a device with no accelerometer, and the reader has no way
       to tell that from a genuinely unbroken night. Suppressed HERE rather than inside
       `computeSleepArch`, which takes only `rows` and cannot know the verdict; `solMin` and the
       ultradian figures are HR-derived and stay measured. */
    if (_motionUnusable && sleepArch) sleepArch.wasoMin = /** @type {any} */ (null);
    var odi1 = computeODI1(rows, blArr);
    var odi4Rate = odi4 ? odi4.rate : 0;
    var odi3Rate = odi3 ? odi3.rate : 0;
    /* Propagate the refusal. `desSev.desSev` may now be null, and `0.6 * null` is 0 inside
       computeAHIestimates — which would silently drop the DesSev term and UNDER-estimate AHI,
       i.e. fail toward the reassuring answer, which is the bias this whole change exists to end. */
    var desSevRate = desSev ? desSev.desSev : null;
    var t95Pct = stats ? stats.t95pct : 0;
    var ct90Sec = ctPrec ? ctPrec.ct90s || 0 : 0;
    var mos = computeMOS(odi4Rate, ct90Sec);
    var ahiEst = computeAHIestimates(odi4Rate, odi3Rate, desSevRate, t95Pct);
    var flags = buildFlags(stats, spikes, period, osc, odi4, odi3, hrv, motion, stab, hrProf, cross, spo2Adv, comp, sbii, pred3p);
    // v20.3: 20 new metrics
    var extras = computeNightExtras(rows, stats, desat, odi1, odi4, hb);
    var rolling = computeRollingMetrics(rows, desat, comp, blArr);
    var patScore = computePatternScores(pbMet, osc, cross, flags, odi4, comp);
    // v20.4: 14 new metrics
    var dfa = computeDFA(rows);
    var fft = computeSpO2FFT(rows);
    var hrEnt = computeHREntropy(rows);
    var ssi = computeSympSurge(rows, spikes, cross, rolling, rows.length / 3600);
    var circHR = computeCircadianHR(rows);
    var spo2Ent = computeSpO2Entropy(rows);
    var hypLoad = computeHypoxicLoad(desat, odi3, rows.length / 3600, rows, blArr);
    var vagal = computeVagalIndex(hrv, extras);
    var recIdx = computeRecoveryIndex(slopes);
    var sleepP = computeSleepPressure(sleepArch, extras);
    var breathI = computeBreathingIrregularity(desat, rows, blArr);
    var oxyCrash = computeOxyCrash(rows);
    var hrnDip = computeHRNoctDip(hrv, stats);
    var desatAsym = computeDesatAsymmetry(slopes);
    // ── v20.6 New Metrics A–O ──────────────────────────────────────
    var spo2Drift = computeSpO2Drift(rows);
    var odi2 = computeODI2(rows);
    var spo2Over = computeSpO2Overshoot(rows, desat);
    var spo2Ac1 = computeSpO2Autocorr(rows);
    var hrFreq = computeHRFreqBands(rows);
    var respRate = computeRespRateProxy(rows);
    var hrAsym = computeHRAsymmetry(rows);
    var hrQuart = computeHRQuartileTrend(rows);
    var spo2HRLag = computeSpO2HRLag(rows);
    var spkDecay = computeSpikeDecay(rows, spikes);
    var spkUnder = computeSpikeUndershoot(rows, spikes);
    var spkRise = computeSpikeRiseRate(spikes);
    var dataGaps = computeDataGaps(rows);
    var hrFlat = computeHRFlatlines(rows);
    var spo2Ceil = computeSpO2Ceiling(rows);
    // ── v20.7 New Metrics (18 functions) ──────────────────────────
    var odri = computeODRI(odi1, odi3);
    var spo2Pct = computeSpO2Percentiles(rows);
    var spo2Shape = computeSpO2Shape(rows);
    var hrCV = computeHRCV(rows);
    var hypDose = computeHypoxicDose(rows);
    var t88t85 = computeT88T85(rows);
    var lcsp = computeLCSP(rows);
    var poincare = computePoincareSD(rows);
    var o2hrEff = computeO2HREfficiency(rows, desat);
    var condSpo2 = computeConditionalSpO2(rows);
    var nadirTrend = computeNadirTrend(desat);
    var iei = computeIEI(desat);
    var recovCV = computeRecoverySlopeCV(desat);
    var hrNadirT = computeHRNadirTime(rows);
    var spo2NadirT = computeSpO2NadirTime(rows, desat);
    var rmssdArc = computeRMSSDarc(rows);
    var spk50Rec = computeSpike50PctRecovery(rows, spikes);
    var stageProxy = computeSleepStageProxy(rows);
    var vo2est = computeVO2maxEstimate(rows, hrv, dfa, hrNadirT, UP.age);
    var bpProj = null; // BP projection REMOVED 2026-06-21 (external-review WP-A) — cuffless BP from oximetry is indefensible
    var karv = computeKarvonenZones(rows, hrv, vo2est, odi4, hypDose, sleepArch, stageProxy, UP.age);
    var night_obj = {
      date: date,
      t0Ms: t0Ms,
      // Where inside the night the oximeter was actually recording (INTEGRATOR-GAP-AWARE-OVERLAP
      // part 2). `dataGaps` above already found these holes and reported only a percentage; the
      // Integrator needs their POSITIONS to divide by recorded rather than envelope hours.
      // Null on a contiguous night, which keeps every clean export byte-identical.
      coverage: oxyCoverage(rows, t0Ms),
      fname: fname,
      stats: stats,
      spikes: spikes,
      period: period,
      osc: osc,
      tIdx: tIdx,
      hrv: hrv,
      odi4: odi4,
      odi3: odi3,
      hb: hb,
      motion: motion,
      stab: stab,
      desat: desat,
      hrProf: hrProf,
      motSleep: motSleep,
      cross: cross,
      spo2Adv: spo2Adv,
      hrAdv: hrAdv,
      comp: comp,
      sbii: sbii,
      pred3p: pred3p,
      desSev: desSev,
      ctPrec: ctPrec,
      ct94: ct94,
      slopes: slopes,
      pbMet: pbMet,
      sleepArch: sleepArch,
      odi1: odi1,
      mos: mos,
      ahiEst: ahiEst,
      extras: extras,
      rolling: rolling,
      patScore: patScore,
      dfa: dfa,
      fft: fft,
      hrEnt: hrEnt,
      ssi: ssi,
      circHR: circHR,
      spo2Ent: spo2Ent,
      hypLoad: hypLoad,
      vagal: vagal,
      recIdx: recIdx,
      sleepP: sleepP,
      breathI: breathI,
      oxyCrash: oxyCrash,
      hrnDip: hrnDip,
      desatAsym: desatAsym,
      flags: flags,
      spo2Drift: spo2Drift,
      odi2: odi2,
      spo2Over: spo2Over,
      spo2Ac1: spo2Ac1,
      hrFreq: hrFreq,
      respRate: respRate,
      hrAsym: hrAsym,
      hrQuart: hrQuart,
      spo2HRLag: spo2HRLag,
      spkDecay: spkDecay,
      spkUnder: spkUnder,
      spkRise: spkRise,
      dataGaps: dataGaps,
      hrFlat: hrFlat,
      spo2Ceil: spo2Ceil,
      odri: odri,
      spo2Pct: spo2Pct,
      spo2Shape: spo2Shape,
      hrCV: hrCV,
      hypDose: hypDose,
      t88t85: t88t85,
      lcsp: lcsp,
      poincare: poincare,
      o2hrEff: o2hrEff,
      condSpo2: condSpo2,
      nadirTrend: nadirTrend,
      iei: iei,
      recovCV: recovCV,
      hrNadirT: hrNadirT,
      spo2NadirT: spo2NadirT,
      rmssdArc: rmssdArc,
      spk50Rec: spk50Rec,
      stageProxy: stageProxy,
      vo2est: vo2est,
      bpProj: bpProj,
      karv: karv
    };
    night_obj.oscEpisodes = _oscEpisodes;
    // INTEGRATOR-THREE-CORNERED-HAT §2/§1 — per-epoch cross-node feed (5-min HR + motion). Binned
    // from the SAME cleaned 1 Hz rows every metric reads, keyed on tMin from t0Ms (matches ECG/PPG's
    // node-relative grid). Feeds the Integrator HR-hat 3rd corner + a 2nd per-epoch motion series for
    // the correlated-TCH ρ (only PpgDex had one). Additive; empty when rows/t0Ms are absent.
    night_obj.tchEpochs = oxyBuildEpochSeries(rows, t0Ms);
    // The oximeter's primary signal at its recorded rate — see oxyBuildSpo2Series. Additive; null
    // when rows/t0Ms are absent, so a consumer can distinguish "no field" from "no usable SpO2".
    night_obj.spo2Series = oxyBuildSpo2Series(rows, t0Ms, 'spo2');
    /* THE THIRD CORNER'S HR, AT THE RATE IT WAS RECORDED (TRIO-ARTIFACT-GATE — the `ms;hr;c` corpus).
       The node exported pulse rate ONLY as 5-min `tchEpochs[].hr` medians — ~300 samples folded into
       one number. Measured on the committed trio corpus: 0 of 40 OxyDex exports carried any HR
       timeseries, so the per-second three-cornered hat the σ-papers publish could not be re-fit from
       committed data AT ALL, at any N — the O2Ring corner simply was not in the file. That is a
       harder blocker than a missing confidence channel, and it was invisible because the epoch hat
       runs fine and produces plausible numbers from the same exports.
       Same 1 Hz uniform grid + explicit holes as spo2Series, from the same rows. */
    night_obj.hrSeries = oxyBuildSpo2Series(rows, t0Ms, 'hr');
    night_obj.summary = computeSmartSummary(night_obj);
    // EXPORT-IDENTITY §2.1 / -FOLLOWUPS-II §1: deterministic, identity-free recording handle.
    // processNight is the ONE site BOTH the app (exportJSON→allNights→oxyBuildNightElement) AND
    // the headless OxyDex.compute path reach, so the id is single-sourced and can't drift between
    // them. Folds the per-second SpO2 sample array + the floating t0Ms via the CORE
    // SignalFrame.computeContentId (signal-frame.js is bundled into OxyDex); identity-free (no
    // name/serial folded), viewer-TZ-independent (numeric t0Ms), null when SignalFrame absent.
    night_obj.contentId =
      typeof SignalFrame !== 'undefined' && SignalFrame && SignalFrame.computeContentId
        ? SignalFrame.computeContentId({
            signalType: 'spo2',
            kind: 'samples',
            samples: rows.map(function (r) {
              return r.spo2;
            }),
            t0Ms: t0Ms != null ? t0Ms : null,
            usable: true
          })
        : null;
    return night_obj;
  }

  function computeStats(rows) {
    var spo2 = rows.map(function (r) {
        return r.spo2;
      }),
      hr = rows.map(function (r) {
        return r.hr;
      }),
      n = rows.length;
    var mSpo2 = avg(spo2),
      mHr = avg(hr);
    // Perfusion index (OXYDEX-PULSE-RESOURCING §4 Phase 1) — mean over the frames that actually
    // carry a reading. `r.pi` is null on the ViHealth CSV path (no column) and on the ring's
    // no-perfusion sentinel, so a night with no PI data yields meanPi = null, not a fabricated 0.
    var _piVals = [];
    for (var _pi = 0; _pi < rows.length; _pi++) if (rows[_pi].pi != null && isFinite(rows[_pi].pi)) _piVals.push(rows[_pi].pi);
    var meanPi = _piVals.length ? +avg(_piVals).toFixed(2) : null;
    // Monotonicity is now ENFORCED, not assumed: parseCSV locks the file's date order (Clock Contract
    // §3), so rows cannot run backward. If one still does, that is a clock failure — surface it as an
    // absent duration, never as a negative number that would silently divide the ODI/burden denominators.
    var rawDurMs = rows[n - 1].tMs - rows[0].tMs;
    /* §F1.4 — the guard was one-SIDED: `!(rawDurMs >= 0)` catches a NEGATIVE span and lets an INFLATED
       one pass as a real number. That is how a 120-minute night reported 1560 minutes with
       `clockNonMonotonic` still false. §1.2's roll fix removed the CAUSE; this closes the GUARD, because
       defence-in-depth is the point of a guard — any future clock disorder that inflates a span should
       be visible rather than surfaced as a duration.
       The bound comes from the data, not a constant: with n rows at the observed median cadence, the
       span cannot honestly exceed n × cadence by much. 1.5× is deliberately generous (real recordings
       carry genuine gaps), so this fires only on the multiple-of-24 h shape a rolled date produces. */
    var _cad = null;
    if (n > 8) {
      var _d = [];
      for (var _i = 1; _i < n; _i++) {
        var _dt = rows[_i].t - rows[_i - 1].t;
        if (_dt > 0) _d.push(_dt);
      }
      if (_d.length > 4) {
        _d.sort(function (a, b) {
          return a - b;
        });
        _cad = _d[_d.length >> 1];
      }
    }
    var _durInflated = _cad != null && rawDurMs > 1.5 * n * _cad + 3600000;
    var _durBad = !(rawDurMs >= 0) || _durInflated;
    return {
      durationMin: _durBad ? null : +(rawDurMs / 60000).toFixed(1),
      clockNonMonotonic: _durBad || undefined,
      // §F1.4 — distinguish the two failures: a span that ran BACKWARDS vs one inflated far past what
      // the row count and cadence can support. Both null the duration; only one is non-monotonic.
      durationInflated: _durInflated || undefined,
      start: fmtTime(rows[0].t),
      end: fmtTime(rows[n - 1].t),
      meanSpo2: isFinite(mSpo2) ? +mSpo2.toFixed(1) : 0,
      minSpo2: spo2.length ? Math.min.apply(null, spo2) : 0,
      maxSpo2: spo2.length ? Math.max.apply(null, spo2) : 0,
      spo2Std: +stdDev(spo2).toFixed(2),
      t95pct:
        n > 0
          ? +(
              (spo2.filter(function (v) {
                return v < 95;
              }).length /
                n) *
              100
            ).toFixed(1)
          : 0,
      t90pct:
        n > 0
          ? +(
              (spo2.filter(function (v) {
                return v < 90;
              }).length /
                n) *
              100
            ).toFixed(1)
          : 0,
      meanHr: isFinite(mHr) ? +mHr.toFixed(1) : 0,
      minHr: hr.length ? Math.min.apply(null, hr) : 0,
      maxHr: hr.length ? Math.max.apply(null, hr) : 0,
      // §4 Phase 1: mean perfusion index (%), or null when the input carried no PI (ViHealth CSV).
      // A NULL metric is honest absence — never coerced to 0, which would read as zero perfusion.
      meanPi: meanPi,
      piFrames: _piVals.length,
      motionPct:
        n > 0
          ? +(
              (rows.filter(function (r) {
                return r.motion > 0;
              }).length /
                n) *
              100
            ).toFixed(1)
          : 0,
      n: n,
      startTs: rows.length ? rows[0].tMs : null
    };
  }

  function computeTIndex(rows) {
    var spo2 = rows.map(function (r) {
        return r.spo2;
      }),
      n = spo2.length,
      out = {};
    [95, 94, 93, 92, 91, 90, 89, 88, 85, 80].forEach(function (t) {
      var s = spo2.filter(function (v) {
        return v < t;
      }).length;
      out[t] = { secs: s, pct: n > 0 ? +((s / n) * 100).toFixed(2) : 0 };
    });
    return out;
  }

  // ═══════════════════════════════════════════
  // HRV  (1Hz proxy metrics)
  // ═══════════════════════════════════════════
  // Note: true HRV requires IBI at ms precision. At 1Hz, these are directional
  // proxies only — valid for night-to-night relative comparison, not clinical HRV norms.
  function computeHRV(rows) {
    // Exclude motion and device-artifact samples for cleaner signal
    var clean = rows.filter(function (r) {
      return r.motion === 0 && !r.hrArtifact;
    });
    var n = clean.length;
    if (n < 120) return null;

    var hrs = clean.map(function (r) {
      return r.hr;
    });
    var spo2 = clean.map(function (r) {
      return r.spo2;
    });

    // 1. SDNN-proxy: SD of all motion-free HR values
    var hrSdnn = +stdDev(hrs).toFixed(2);

    // 2. pNN3-equiv: % consecutive HR pairs with |ΔHR| ≥ 3 BPM
    //    At sleep HR ~53 bpm, 3 bpm ≈ 50 ms RR difference (analogous to pNN50).
    //    1Hz quantization compresses true HF-HRV — use as relative indicator only.
    var nn3 = 0;
    for (var i = 1; i < n; i++) {
      if (Math.abs(clean[i].hr - clean[i - 1].hr) >= 3) nn3++;
    }
    var pnn3 = +((nn3 / (n - 1)) * 100).toFixed(1);

    // 3. HR floor: 5th percentile (robust vs. single-sample outliers in minHr)
    var sorted = hrs.slice().sort(function (a, b) {
      return a - b;
    });
    var hrFloor = sorted[Math.floor(sorted.length * 0.05)];

    // 4. HR slope: linear regression of HR over recording (BPM/hr)
    //    Negative = HR falling across the night (healthy parasympathetic recovery).
    //    Positive = rising HR pattern (stress, fragmented sleep, REM rebound).
    var t0 = clean[0].t.getTime();
    var sumX = 0,
      sumY = 0,
      sumXY = 0,
      sumX2 = 0;
    for (var i = 0; i < n; i++) {
      var x = (clean[i].t.getTime() - t0) / 3600000;
      var y = clean[i].hr;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }
    var denom = n * sumX2 - sumX * sumX;
    var hrSlope = denom ? +((n * sumXY - sumX * sumY) / denom).toFixed(2) : 0;

    // 5. RSA proxy: mean SpO2 SD across 30-second non-overlapping windows
    //    SpO2 oscillates slightly with each breath (~0.15–0.4 Hz); SD in short windows
    //    reflects respiratory modulation of oxygenation — indirect HF-HRV proxy.
    var WIN = 30;
    var rsaWins = [];
    for (var i = 0; i + WIN <= n; i += WIN) {
      rsaWins.push(stdDev(spo2.slice(i, i + WIN)));
    }
    var rsaProxy = rsaWins.length
      ? +(
          rsaWins.reduce(function (a, b) {
            return a + b;
          }, 0) / rsaWins.length
        ).toFixed(3)
      : null;

    // hrSdnnProxy = SD of 1Hz HR values (BPM). NOT RR-interval SDNN. Use for relative night-to-night trending only.
    // RMSSD-proxy (1Hz, bpm): sqrt(mean squared successive HR differences)
    // NOTE: 1Hz quantization gives ~0.4-0.9 bpm; multiply by ~21 to approximate ms at HR≈53
    var rmssd_ss = 0;
    for (var i = 1; i < n; i++) {
      var d = hrs[i] - hrs[i - 1];
      rmssd_ss += d * d;
    }
    var rmssd = n > 1 ? +Math.sqrt(rmssd_ss / (n - 1)).toFixed(2) : 0;
    // maxHr: highest clean still HR (used by VO2max as floor check)
    var maxHr = hrs.length ? Math.max.apply(null, hrs) : 0;
    return { hrSdnnProxy: hrSdnn, hrSdnn: hrSdnn, pnn3: pnn3, hrFloor: hrFloor, hrSlope: hrSlope, rsaProxy: rsaProxy, rmssd: rmssd, maxHr: maxHr, n: n };
  }

  // ═══════════════════════════════════════════════════════════════
  // detectDesatEvents — THE single desaturation-event primitive (DEX-EVENT-UNIFY Task A)
  // ═══════════════════════════════════════════════════════════════
  // One ceiling-baseline walk → a reusable, rich event list. Every desaturation consumer
  // (ODI, slopes, hypoxic load, breathing-irregularity, post-dip HR, WtDSI/nadir bins)
  // derives from THIS so they all score the SAME events against the SAME baseline, instead
  // of each re-running a private trailing-MEAN loop that silently disagreed with the headline
  // ODI. Baseline is the v22.36 trailing p90 CEILING (computeCeilingBaselineArr) — NOT the
  // trailing MEAN — so every consumer inherits the ceiling fix (severe-OSA dips sit in the
  // lower tail and can't drag the threshold down). See DEX-EVENT-UNIFY-AND-CSV-BRIEF.md §2.
  //
  //   opts.dropPct  enter when spo2 <= baseline − dropPct   (default K.ODI_DROP = 4;
  //                 pass 3 for the ODI-3 / hypoxic-load set, 1 for ODI-1)
  //   opts.exitPct  if set, SIMPLE re-rise close when spo2 > baseline − exitPct (matches the
  //                 legacy ODI/ODI-3/ODI-1 detectors). If omitted, anti-chatter HYSTERESIS
  //                 close at spo2 >= baseline − hystPct.
  //   opts.hystPct  hysteresis re-rise level (default K.ODI_HYST = 2); used only when exitPct
  //                 is not given.
  //   opts.minSec   minimum event length (samples ≈ seconds @1Hz) to keep (default 10; ODI-1
  //                 passes 0 — it counts every qualifying dip).
  //   opts.WIN/opts.pct  ceiling window (300) / percentile (90); opts.blArr precomputed array.
  //
  // Returns [{ startIdx, nadirIdx, endIdx, baseline, nadir, depth, durationSec, dipSlope, recSlope }]
  // dipSlope  = (nadir − baseline) / (nadirIdx − startIdx)   — neg %/s, baseline → nadir
  // recSlope  = (spo2[endIdx] − nadir) / (endIdx − nadirIdx) — observed resaturation %/s
  //
  // CLOSE-MODE DECISION (DEX-EVENT-UNIFY-FOLLOWUPS-II §3): the shared primitive runs in TWO close
  // modes BY DESIGN, not one. (1) SIMPLE re-rise close (exitPct set) — the COUNT family that must be
  // event-for-event with the headline ODI: detectODI (ODI-4/ODI-3), computeDesaturationProfile, SBII,
  // PRED3p, DesSev, ODI-1. (2) anti-chatter HYSTERESIS close (no exitPct) — the SATELLITE stats where
  // chatter-merging is desirable: computeDesatSlopes (MODL/clustering), post-dip HR, breathing-
  // irregularity, WtDSI. On the committed CSV both yield the SAME 14-event ODI-4 set; they can diverge
  // on edge data (a dip re-rising into the hysteresis band but not past the entry threshold). This is
  // intentional and is tagged at each call site — do NOT collapse to one mode without re-validating
  // every satellite, since the count family is contractually tied to ODI and the satellites are not.
  function detectDesatEvents(spo2, opts) {
    opts = opts || {};
    var n = spo2.length;
    var dropPct = opts.dropPct == null ? DexKernel.K.ODI_DROP : opts.dropPct;
    var hystPct = opts.hystPct == null ? DexKernel.K.ODI_HYST : opts.hystPct;
    var exitPct = opts.exitPct; // undefined → hysteresis close
    var minSec = opts.minSec == null ? 10 : opts.minSec;
    var WIN = opts.WIN || 300; // 5-min clinical baseline
    var blArr = opts.blArr || computeCeilingBaselineArr(spo2, WIN, opts.pct || 90); // O(n) p90 ceiling
    var events = [];
    var inEv = false,
      evStart = 0,
      evNadir = 100,
      evNadirIdx = 0,
      evBaseline = 100;
    // Push a completed event (shared by the in-loop close and the end-of-record flush).
    function pushEvent(endIdxRaw) {
      if (endIdxRaw - evStart < minSec) return; // ignore sub-minSec blips
      var recEnd = Math.min(n - 1, endIdxRaw);
      var dipDur = Math.max(1, evNadirIdx - evStart);
      var recDur = Math.max(1, recEnd - evNadirIdx);
      events.push({
        startIdx: evStart,
        nadirIdx: evNadirIdx,
        endIdx: recEnd,
        baseline: isFinite(evBaseline) ? +evBaseline.toFixed(1) : 0,
        nadir: evNadir,
        depth: +(evBaseline - evNadir).toFixed(1),
        durationSec: endIdxRaw - evStart,
        dipSlope: +((evNadir - evBaseline) / dipDur).toFixed(3),
        recSlope: +((spo2[recEnd] - evNadir) / recDur).toFixed(3)
      });
    }
    for (var i = 0; i < n; i++) {
      var bl = blArr[i];
      if (!inEv) {
        // inclusive <= : a dip of EXACTLY dropPct% counts (ODI-4 = ≥4%)
        if (spo2[i] <= bl - dropPct) {
          inEv = true;
          evStart = i;
          evNadir = spo2[i];
          evNadirIdx = i;
          evBaseline = bl;
        }
      } else {
        if (spo2[i] < evNadir) {
          evNadir = spo2[i];
          evNadirIdx = i;
        }
        // Close: hysteresis (>= bl − hystPct, anti-chatter) OR simple re-rise (> bl − exitPct).
        var reentered = exitPct == null ? spo2[i] >= bl - hystPct : spo2[i] > bl - exitPct;
        if (reentered) {
          pushEvent(i);
          inEv = false;
        }
      }
    }
    if (inEv) pushEvent(n); // flush a desat still open at EOF
    return events;
  }

  function detectODI(spo2, drop, n, blArr, pulseSeries) {
    // ODI = ceiling-baseline desaturations ≥ drop% lasting ≥10s, per hour. Routed through the
    // ONE primitive with a SIMPLE re-rise close (exitPct === drop) so the count is event-for-
    // event identical to the v22.36 reference detector — ODI-4/ODI-3 are UNCHANGED by the
    // unification, while every satellite metric now scores the SAME events. (DEX-EVENT-UNIFY A)
    // FINDING 1: optional pulseSeries → artifact-gate the events (the ODI-3 path passes it). ODI-4
    // stays UNGATED here on purpose — processNight subtracts its artifacts via desat.artifactCount,
    // so gating here too would double-subtract. Back-compat: param is LAST + optional (absent ⇒
    // ungated, byte-identical to the old signature for every existing caller/test).
    var events = pulseSeries ? detectDesatEventsGated(spo2, { dropPct: drop, exitPct: drop, blArr: blArr }, pulseSeries) : detectDesatEvents(spo2, { dropPct: drop, exitPct: drop, blArr: blArr });
    var hrs = n / 3600;
    return { count: events.length, rate: +(events.length / Math.max(hrs, 0.01)).toFixed(1) };
  }

  function detectSpikes(rows) {
    var spikes = [],
      lastIdx = -CFG.SPIKE_COOLDOWN_SEC * 2,
      n = rows.length;
    for (var i = 10; i < n - 20; i++) {
      if (rows[i].motion > 0) continue;
      if (i - lastIdx < CFG.SPIKE_COOLDOWN_SEC) continue;
      // Skip if any sample in the 10-sample baseline window has motion (corrupts baseline)
      var motionInWindow = false;
      for (var k = i - 10; k < i; k++) {
        if (k >= 0 && rows[k].motion > 0) {
          motionInWindow = true;
          break;
        }
      }
      if (motionInWindow) continue;
      var bl = 0,
        cnt = 0;
      for (var k = i - 10; k < i; k++) {
        if (k >= 0) {
          bl += rows[k].hr;
          cnt++;
        }
      }
      bl /= Math.max(cnt, 1);
      // Detection trigger: 12-sample lookahead to fire early in the ramp
      var localMax12 = rows[i].hr;
      for (var j = i; j < Math.min(i + 12, n); j++) if (rows[j].hr > localMax12) localMax12 = rows[j].hr;
      var peakRise12 = localMax12 - bl;
      if (localMax12 < CFG.HR_SPIKE_MIN_PEAK || peakRise12 < 20) continue;
      var sustain = 0;
      for (var j = i; j < Math.min(i + 18, n); j++) if (rows[j].hr >= Math.max(CFG.HR_SPIKE_MIN_PEAK, bl + 12)) sustain++;
      if (sustain < 5) continue;
      // Peak reporting: wider 40-sample window so fast-rising spikes aren't under-reported
      var localMax40 = localMax12;
      for (var j = i + 12; j < Math.min(i + 40, n); j++) if (rows[j].hr > localMax40) localMax40 = rows[j].hr;
      var dur = 0;
      for (var j = i; j < Math.min(i + 30, n); j++) if (rows[j].hr >= CFG.HR_SPIKE_MIN_PEAK) dur++;
      var mfm = rows[i].t.getUTCHours() * 60 + rows[i].t.getUTCMinutes() + rows[i].t.getUTCSeconds() / 60;
      /* ── FIRMWARE ARTIFACT REJECTION (O2RING-HOURLY-HR-ARTIFACT-2026-08-02) ──────────────────
         A heart cannot accelerate 20 BPM in one second. The vendor (Wellue, 2026-05-14) confirmed a
         timer-driven firmware routine near the top of each clock hour that transiently double-counts
         cardiac cycles, producing a step of +21..25 BPM in a SINGLE 1 Hz sample with SpO2 flat and
         motion zero.

         THIS IS A BACKSTOP, NOT THE PRIMARY DEFENCE — and saying so matters, because the obvious
         reading of the raw CSV (the spike clears MIN_PEAK, motion is 0, and the 8-13 s plateau passes
         `sustain`) suggests it reaches hrSpikes. It does not: `cleanArtifactHR` runs FIRST and removes
         the impossible SAMPLES (HR_ARTIFACT_JUMP = 20 BPM/s unconditionally, or 15 within ±2 min of an
         hour), so `detectSpikes` normally never sees the excursion at all. What this catches is the
         residue that upstream pass misses: an onset in [15, 20) BPM/s occurring AWAY from a clock hour,
         where the soft clock-gated threshold does not apply — 1 of 44 artifacts in the corpus.

         The discriminator is the ONSET RATE, not the clock alignment. Measured over the corpus's 37
         O2Ring nights, per detected spike (on RAW rows, i.e. before cleanArtifactHR):
             affected nights (<= 2026-05-27): median 22 BPM/s, max 56   — 45 of 75 at >= 15
             clean nights    (>= 2026-05-28): median  5 BPM/s, max  7   —  0 of 13 at >= 15
         So a >=15 BPM/s bar has better than 2x headroom over the fastest genuine arousal this device
         has ever reported, and rejects NOTHING on the clean control. Onset is preferred over "within
         60 s of the hour" deliberately: clock alignment is corroborating evidence, but a real arousal
         may fall near an hour by chance (1.7 % of the time) and must not be deleted for it. 30 of the
         75 affected-night spikes have normal onsets and are kept — this rejects events, not nights.

         REJECTED, NOT SILENTLY DROPPED. The vendor's advice was "ignore +-60 s around each hour";
         that is a silent correction, and this repo declares instead (cf. quality.timingSource). The
         event is returned with `artifact:true` so a caller can still see it, and the honest count is
         published beside the raw one. */
      var onsetRise = 0;
      for (var j = Math.max(1, i - 2); j < Math.min(i + 14, n); j++) {
        var stepUp = rows[j].hr - rows[j - 1].hr;
        if (stepUp > onsetRise) onsetRise = stepUp;
      }
      var secPastHour = rows[i].t.getUTCMinutes() * 60 + rows[i].t.getUTCSeconds();
      var isArtifact = onsetRise >= CFG.HR_SPIKE_MAX_PHYSIOLOGIC_RISE;
      spikes.push({
        time: fmtTimeFull(rows[i].t),
        baseline: Math.round(bl),
        peak: localMax40,
        duration: dur,
        spo2: rows[i].spo2,
        mfm: mfm,
        onsetRise: onsetRise,
        // Corroborating only — never the rejection criterion. 60 s of 3600 = 1.7 % by chance.
        clockAligned: secPastHour <= 60 || secPastHour >= 3540,
        artifact: isArtifact,
        artifactReason: isArtifact ? 'onset ' + onsetRise + ' BPM/s exceeds the ' + CFG.HR_SPIKE_MAX_PHYSIOLOGIC_RISE + ' BPM/s physiologic ceiling — firmware double-count, not a heart' : null
      });
      lastIdx = i;
    }
    return spikes;
  }

  function detectPeriodicity(spikes) {
    if (spikes.length < 3) return null;
    var times = spikes.map(function (s) {
      return parseTimeStr(s.time);
    });
    for (var i = 1; i < times.length; i++) {
      while (times[i] < times[i - 1]) times[i] += 86400;
    }
    var intervals = [];
    for (var i = 1; i < times.length; i++) intervals.push(Math.round((times[i] - times[i - 1]) / 60));
    if (intervals.length < 3) return null;
    var sorted = intervals.slice().sort(function (a, b) {
      return a - b;
    });
    var med = sorted[Math.floor(sorted.length / 2)];
    var kept = intervals.filter(function (v) {
      return Math.abs(v - med) <= 10;
    });
    if (kept.length < 3) return null;
    var avgInterval = Math.round(
      kept.reduce(function (x, y) {
        return x + y;
      }, 0) / kept.length
    );
    var spread = Math.max.apply(null, kept) - Math.min.apply(null, kept);
    var regularity = intervals.length ? kept.length / intervals.length : 0;
    var pattern = null;
    if (regularity >= 0.8 && avgInterval >= 50 && avgInterval <= 75 && spread <= 6) pattern = 'REGULAR';
    else if (regularity >= 0.8 && avgInterval >= 20 && avgInterval <= 45 && spread <= 6) pattern = 'PLM_CANDIDATE';
    else if (regularity >= 0.7 && avgInterval >= 75 && avgInterval <= 105 && spread <= 8) pattern = 'REM_BOUNDARY';
    else return null;
    return { avg: avgInterval, spread: spread, pattern: pattern, intervals: kept };
  }

  function parseTimeStr(s) {
    var m = s.match(/(\d{2}):(\d{2}):(\d{2})/);
    return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
  }

  // ── OXYDEX-PB-DETECTOR §2 · the periodicity gate ──────────────────────────────────────────────
  // Four criteria, ALL gating. The predecessor counted crossings of an ABSOLUTE 95 % level inside a
  // fixed window, so nothing it computed depended on the SPACING of those crossings — it measured
  // hypoxemia burden (r = +0.893 against time-below-95) and could not separate a periodic night from
  // an aperiodic one with the same burden.
  //
  //   1. crossings of the wearer's OWN rolling-median baseline, not a fixed 95 %
  //   2. cycle length inside the clinical CSR window, from DISJOINT half-cycle pairs (§2.2: the
  //      sliding view in computePatternScores reports 2k-1 cycles for k, so 2 would satisfy ">= 3")
  //   3. >= PB_MIN_CYCLES consecutive in-window cycles
  //   4. those cycle lengths REGULAR (CV < PB_MAX_CYCLE_CV) — §2.3 measured that criteria 1-3 alone
  //      fire on 40/40 red-noise seeds, because a red series crosses its own baseline at intervals
  //      set by its correlation time. A run-length test is not a periodicity test.
  function pbRollingMedianBaseline(x, win) {
    var half = win >> 1,
      n = x.length,
      out = new Array(n);
    for (var i = 0; i < n; i++) {
      var lo = i - half < 0 ? 0 : i - half,
        hi = i + half > n - 1 ? n - 1 : i + half;
      var seg = x.slice(lo, hi + 1).sort(function (a, b) {
        return a - b;
      });
      out[i] = seg[seg.length >> 1];
    }
    return out;
  }

  // Baseline crossings, with an amplitude guard so integer dither is not an oscillation.
  function pbCrossingIndices(spo2, cfg) {
    var base = pbRollingMedianBaseline(spo2, cfg.PB_BASELINE_WIN_SEC),
      cross = [],
      lastSign = 0,
      extreme = 0;
    for (var i = 0; i < spo2.length; i++) {
      var d = spo2[i] - base[i];
      var s = d > 0 ? 1 : d < 0 ? -1 : 0;
      if (s === 0) continue;
      if (lastSign === 0) {
        lastSign = s;
        extreme = d;
        continue;
      }
      if (s === lastSign) {
        if (Math.abs(d) > Math.abs(extreme)) extreme = d;
        continue;
      }
      // A sign flip closes an excursion; keep it only if that excursion was deep enough. Half of
      // PB_MIN_AMP because the guard applies per half-cycle, peak-to-trough spans two.
      if (Math.abs(extreme) >= cfg.PB_MIN_AMP / 2) cross.push(i);
      lastSign = s;
      extreme = d;
    }
    return cross;
  }

  // Returns the periodicity verdict for one SpO2 series (1 Hz). Pure — no rows, no clock.
  function detectSpO2Periodicity(spo2, opts) {
    var cfg = opts || CFG;
    var cross = pbCrossingIndices(spo2, cfg),
      halves = [];
    for (var i = 1; i < cross.length; i++) halves.push(cross[i] - cross[i - 1]);
    // DISJOINT pairing (i += 2). A sliding pair would double-count: see §2.2.
    var cycles = [];
    for (var j = 0; j + 1 < halves.length; j += 2) cycles.push(halves[j] + halves[j + 1]);
    var best = 0,
      bestLens = [],
      run = 0,
      runLens = [];
    for (var k = 0; k < cycles.length; k++) {
      var c = cycles[k];
      if (c >= cfg.PB_CYCLE_MIN_SEC && c <= cfg.PB_CYCLE_MAX_SEC) {
        run++;
        runLens.push(c);
        if (run > best) {
          best = run;
          bestLens = runLens.slice();
        }
      } else {
        run = 0;
        runLens = [];
      }
    }
    var cv = null,
      med = null;
    if (bestLens.length) {
      var sorted = bestLens.slice().sort(function (a, b) {
        return a - b;
      });
      med = sorted[sorted.length >> 1];
    }
    if (bestLens.length > 1) {
      var m =
        bestLens.reduce(function (a, b) {
          return a + b;
        }, 0) / bestLens.length;
      cv =
        Math.sqrt(
          bestLens.reduce(function (s, b) {
            return s + (b - m) * (b - m);
          }, 0) / bestLens.length
        ) / m;
    }
    // Criterion 4 gates: a run that is long enough but IRREGULAR is not periodic breathing.
    var periodic = best >= cfg.PB_MIN_CYCLES && cv !== null && cv < cfg.PB_MAX_CYCLE_CV;

    // EPISODES — maximal runs of in-window cycles that also clear the count and regularity gates.
    // Cycle j is built from halves[2j] + halves[2j+1], so it spans cross[2j] .. cross[2j+2]; a run of
    // cycles a..b therefore spans cross[2a] .. cross[2b+2].
    // A whole maximal run is accepted or rejected as ONE unit — a long in-window but irregular stretch
    // is NOT re-scanned for a regular sub-run. That is deliberate and conservative: this detector exists
    // because the predecessor over-called, and searching sub-runs for the most regular window is exactly
    // the multiple-comparisons move that let a random dip train look periodic (§2.3).
    var episodes = [],
      runStart = -1,
      curLens = [];
    function closeRun(endCycleIdx) {
      if (runStart >= 0 && curLens.length >= cfg.PB_MIN_CYCLES) {
        var mm =
          curLens.reduce(function (a, b) {
            return a + b;
          }, 0) / curLens.length;
        var vv =
          Math.sqrt(
            curLens.reduce(function (s, b) {
              return s + (b - mm) * (b - mm);
            }, 0) / curLens.length
          ) / mm;
        if (vv < cfg.PB_MAX_CYCLE_CV) {
          var sIdx = cross[2 * runStart],
            eIdx = cross[2 * endCycleIdx + 2];
          if (sIdx != null && eIdx != null) episodes.push({ startIdx: sIdx, endIdx: eIdx, cycles: curLens.length, cycleLen: +mm.toFixed(1), cycleCV: +vv.toFixed(4) });
        }
      }
      runStart = -1;
      curLens = [];
    }
    for (var e = 0; e < cycles.length; e++) {
      if (cycles[e] >= cfg.PB_CYCLE_MIN_SEC && cycles[e] <= cfg.PB_CYCLE_MAX_SEC) {
        if (runStart < 0) runStart = e;
        curLens.push(cycles[e]);
      } else closeRun(e - 1);
    }
    closeRun(cycles.length - 1);

    return {
      periodic: periodic,
      longestRun: best,
      cycleLen: med,
      cycleCV: cv === null ? null : +cv.toFixed(4),
      nCycles: cycles.length,
      episodes: episodes
    };
  }

  // OXYDEX-PB-DETECTOR §2 — this now GATES on periodicity. It used to flag a fixed 300 s window on
  // (lowMotion && >=40 samples below an ABSOLUTE 95 % && >=6 crossings of that same level), so nothing
  // it computed depended on the SPACING of the crossings: it tracked hypoxemia burden (r = +0.893 with
  // time-below-95) and could not tell a periodic night from an aperiodic one of equal burden.
  //
  // The 300 s window could not survive the fix. A cycle may run to PB_CYCLE_MAX_SEC = 130 s, so four
  // consecutive cycles need up to 520 s — an episode that cannot fit in the window it was scored in.
  // Episodes are therefore VARIABLE-LENGTH runs, which is also how AASM defines them.
  // Low-motion rejection is kept: it is an artifact guard, independent of periodicity.
  function detectOscillations(rows) {
    var n = rows.length,
      flagged = [],
      spo2Series = [],
      si;
    for (si = 0; si < n; si++) spo2Series.push(rows[si].spo2);
    var pb = detectSpO2Periodicity(spo2Series, CFG);
    for (var ei = 0; ei < pb.episodes.length; ei++) {
      var ep = pb.episodes[ei],
        cross = 0,
        below = 0,
        motion = 0,
        span = Math.max(ep.endIdx - ep.startIdx, 1);
      for (var j = ep.startIdx + 1; j <= ep.endIdx && j < n; j++) {
        if (rows[j - 1].spo2 >= CFG.SPO2_OSC_THRESHOLD !== rows[j].spo2 >= CFG.SPO2_OSC_THRESHOLD) cross++;
        if (rows[j].spo2 < CFG.SPO2_OSC_THRESHOLD) below++;
        if (rows[j].motion > 0) motion++;
      }
      // Motion artifact can manufacture a regular-looking trace; reject the episode, not the night.
      if (motion / span >= 0.08) continue;
      // OXYDEX-NODE-EXPORT-ENVELOPE §2b: retain the episode's start INDEX + absolute floating tMs so
      // the node-export can emit one periodic_breathing event per episode (Clock Contract §6).
      flagged.push({
        cross: cross,
        below: below,
        start: fmtTimeFull(rows[ep.startIdx].t),
        startIdx: ep.startIdx,
        tMs: rows[ep.startIdx].tMs,
        windowSec: span,
        cycles: ep.cycles,
        cycleLen: ep.cycleLen,
        cycleCV: ep.cycleCV
      });
    }
    var totalCross = flagged.reduce(function (s, w) {
      return s + w.cross;
    }, 0);
    // NOTE: the leading 5 keys are the FROZEN display shape (the export element serializes them
    // verbatim). `episodes` is added LAST and is stripped back off by processNight (→ oscEpisodes),
    // so the per-night export element stays byte-identical.
    return {
      episodeCount: flagged.length,
      peakCrossings: flagged.length
        ? Math.max.apply(
            null,
            flagged.map(function (w) {
              return w.cross;
            })
          )
        : 0,
      totalCrossings: totalCross,
      first: flagged.length ? flagged[0].start : null,
      last: flagged.length ? flagged[flagged.length - 1].start : null,
      // `windowSec` is now the episode's OWN duration, not the retired fixed 300 s scan window — an
      // episode of >= 4 cycles at up to 130 s each cannot fit in 300 s. `cycles`/`cycleLen`/`cycleCV`
      // are added LAST so the leading keys stay the frozen display shape.
      episodes: flagged.map(function (w) {
        return {
          tMs: w.tMs != null ? w.tMs : null,
          startIdx: w.startIdx,
          cross: w.cross,
          below: w.below,
          windowSec: w.windowSec,
          cycles: w.cycles,
          cycleLen: w.cycleLen,
          cycleCV: w.cycleCV
        };
      })
    };
  }

  // Shared flag severity derivation — single source of truth used by
  // buildFlags, parseSummaryCSV, and parseJSONL so all paths are consistent.
  function _flagSev(f) {
    if (f === 'OK') return 'ok';
    var BAD = ['CRITICAL', 'T90_', 'T95_HIGH', 'ODI4_ABNORMAL', 'BRADYCARDIA', 'POOR_STABILITY', 'SBII_Q5', 'PRED3P_Q5'];
    for (var _i = 0; _i < BAD.length; _i++) if (f.indexOf(BAD[_i]) >= 0) return 'bad';
    if (f.indexOf('NOCTURNAL_STRESS') >= 0) {
      var _m = f.match(/\((\d+)\)/);
      return _m && parseInt(_m[1], 10) >= 80 ? 'bad' : 'warn';
    }
    var WARN = [
      'PERIODIC',
      'BLUNTED',
      'HIGH_AROUSAL',
      'BORDERLINE',
      'ODI4_BORDERLINE',
      'ODI3_ELEVATED',
      'HR_SPIKES',
      'MAX_HR',
      'HRV_LOW',
      'HRV_HR_RISING',
      'RESTLESS',
      'TACHYCARDIA',
      'WTDSI_ELEVATED',
      'SBII_Q4',
      'PRED3P_Q4'
    ];
    for (var _j = 0; _j < WARN.length; _j++) if (f.indexOf(WARN[_j]) >= 0) return 'warn';
    return 'info';
  }
  function buildFlags(stats, spikes, period, osc, odi4, odi3, hrv, motion, stab, hrProf, cross, spo2Adv, comp, sbii, pred3p) {
    var f = [];
    if (stats.t90pct > 1) f.push({ code: 'T90_ELEVATED', sev: 'bad' });
    if (stats.t95pct > 15) f.push({ code: 'T95_HIGH', sev: 'bad' });
    if (stats.minSpo2 <= 88) f.push({ code: 'SPO2_CRITICAL_DIP', sev: 'bad' });
    if (odi4.rate >= 5) f.push({ code: 'ODI4_ABNORMAL', sev: 'bad' });
    else if (odi4.rate >= 2) f.push({ code: 'ODI4_BORDERLINE', sev: 'warn' });
    if (odi3.rate >= 15) f.push({ code: 'ODI3_ELEVATED', sev: 'warn' });
    if (spikes.length >= 4) f.push({ code: 'HR_SPIKES(' + spikes.length + ')', sev: 'warn' });
    if (period) {
      var sv = period.pattern === 'PLM_CANDIDATE' ? 'warn' : 'info';
      f.push({ code: period.pattern + '~' + period.avg + 'min', sev: sv });
    }
    if (osc.episodeCount >= 4) f.push({ code: 'PERIODIC_BREATHING(' + osc.episodeCount + ')', sev: 'warn' });
    if (stats.maxHr > 105) f.push({ code: 'MAX_HR(' + stats.maxHr + ')', sev: 'warn' });
    if (hrv) {
      if (hrv.pnn3 < 0.2) f.push({ code: 'HRV_LOW_pNN3(' + hrv.pnn3 + '%)', sev: 'warn' });
      if (hrv.hrSlope > 1.5) f.push({ code: 'HRV_HR_RISING(' + hrv.hrSlope + 'bpm/hr)', sev: 'warn' });
      if (hrv.hrFloor > 65) f.push({ code: 'HRV_FLOOR_HIGH(' + hrv.hrFloor + ')', sev: 'info' });
    }
    if (stats.artifactHrCleaned > 0) f.push({ code: 'HR_ARTIFACT_CLEANED(' + stats.artifactHrCleaned + ')', sev: 'info' });
    if (stats.artifactSpikesRemoved > 0) f.push({ code: 'CLOCK_SPIKES_REMOVED(' + stats.artifactSpikesRemoved + ')', sev: 'info' });
    if (stats.sensorWarmupTrimmed > 0) f.push({ code: 'SENSOR_WARMUP_TRIMMED(' + stats.sensorWarmupTrimmed + ')', sev: 'info' });
    if (stats.sensorCooldownTrimmed > 0) f.push({ code: 'SENSOR_COOLDOWN_TRIMMED(' + stats.sensorCooldownTrimmed + ')', sev: 'info' });
    if (stats.nadirArtifactExcluded > 0) f.push({ code: 'SPO2_NADIR_GATED(' + stats.minSpo2Raw + '→' + stats.minSpo2 + ')', sev: 'info' });
    if (motion && motion.arousalIndex >= 40) f.push({ code: 'RESTLESS_NIGHT(' + motion.arousalIndex + '%)', sev: 'warn' });
    if (stab && stab.score != null && stab.score < 50) f.push({ code: 'POOR_STABILITY(' + stab.score + ')', sev: 'bad' });
    if (hrProf && hrProf.bradyCount > 0) f.push({ code: 'BRADYCARDIA(' + hrProf.bradyCount + ')', sev: 'bad' });
    if (hrProf && hrProf.tachyCount > 0) f.push({ code: 'TACHYCARDIA_EVENTS(' + hrProf.tachyCount + ')', sev: 'warn' });
    if (cross && cross.divergePct >= 75 && osc && osc.episodeCount >= 6) f.push({ code: 'BLUNTED_AROUSAL(' + cross.divergePct + '%)', sev: 'warn' });
    if (cross && cross.autoArousalIdx >= 5) f.push({ code: 'HIGH_AROUSAL_IDX(' + cross.autoArousalIdx + ')', sev: 'warn' });
    if (comp && comp.nsi >= 80) f.push({ code: 'NOCTURNAL_STRESS(' + comp.nsi + ')', sev: 'bad' });
    else if (comp && comp.nsi >= 60) f.push({ code: 'NOCTURNAL_STRESS(' + comp.nsi + ')', sev: 'warn' });

    if (spo2Adv && spo2Adv.wtdsi > 5) f.push({ code: 'WTDSI_ELEVATED(' + spo2Adv.wtdsi + ')', sev: 'warn' });
    if (sbii && sbii.sbiiQ === 'Q5(high)') f.push({ code: 'SBII_Q5(' + sbii.sbii + ')', sev: 'bad' });
    if (sbii && sbii.sbiiQ === 'Q4') f.push({ code: 'SBII_Q4(' + sbii.sbii + ')', sev: 'warn' });
    if (pred3p && pred3p.pred3pQ === 'Q5(high)') f.push({ code: 'PRED3P_Q5(' + pred3p.pred3p + '%)', sev: 'bad' });
    if (pred3p && pred3p.pred3pQ === 'Q4') f.push({ code: 'PRED3P_Q4(' + pred3p.pred3p + '%)', sev: 'warn' });
    if (!f.length) f.push({ code: 'OK', sev: 'ok' });
    return f;
  }

  // ═══════════════════════════════════════════
  // v14 — NEW ANALYSIS FUNCTIONS
  // ═══════════════════════════════════════════

  // Hypoxic Burden: area-under-curve below SpO2=94% (%-min total & %-min/hr rate).
  // More sensitive than ODI for sustained mild desaturation patterns.
  // Clinical reference: >25 %-min/hr is considered elevated.
  function computeHypoxicBurden(rows) {
    var burden = 0,
      n = rows.length;
    for (var i = 0; i < n; i++) {
      if (rows[i].spo2 < 94) burden += 94 - rows[i].spo2;
    }
    var durationHr = n / 3600;
    var totalMin = +(burden / 60).toFixed(1);
    var rate = durationHr > 0 ? +(totalMin / durationHr).toFixed(1) : 0;
    return { total: totalMin, rate: rate };
  }

  // Motion Profile: divide night into 30-min windows, score each for motion %.
  // Restless window = any window where motion% >= 2.0.
  // Arousal index = % of total windows that are restless (0-100).
  /* MULTINIGHT-CORPUS-FINDINGS §3 — is the motion column STUCK (a writer/sensor fault) rather than
     reporting a genuinely restless night?

     The test is the LONGEST CONTIGUOUS RUN of non-zero samples, not the whole-night fraction, and
     the corpus is why. The fault is per-SOURCE, not per-night: on 2026-07-16/17/18 the capture
     host's live BLE stream wrote a motion field that never returned to zero, while the O2Ring's own
     onboard `.dat` backup for the SAME nights is 94–98 % zero. A folded night merges both, so its
     overall zero-fraction lands at a healthy-looking 50–63 % and any fraction test is blind to it.
     A run test is not, because it asks the question locally.

     The separation it gets is not marginal — measured over 13 consecutive capture nights:

         faulted (07-16 / 07-17 / 07-18):   110 min · 366 min · 302 min of unbroken movement
         every healthy night (07-19..28):     3 s –  13 s

     ~500x, with nothing in between. 10 minutes sits 46x above the worst healthy observation and 11x
     below the smallest fault, so the threshold is read off a gap rather than chosen. A sleeper who
     genuinely never stills for ten minutes does not then produce a night whose next-longest run is
     four seconds; the shape is a writer, not a body.

     This also catches 2026-07-18, which a whole-night fraction test cannot (18.7 % zero looks like a
     restless night by fraction, and is 302 minutes of impossible continuity by run).

     Non-finite/absent motion values break no run and start none: a file with no motion column is
     missing data, a different condition that already reads as zero motion downstream. */
  var MOTION_STUCK_RUN_SAMPLES = 600; // 10 min at the O2Ring's 1 Hz cadence

  /* THE ABSOLUTE RUN LENGTH MADE THE TEST STRUCTURALLY BLIND ON A SHORT RECORD (DEEP-AUDIT-V §2.3 F23).
     A fixed 600-sample bar cannot be cleared by a recording that HAS fewer than 600 samples, so a file
     whose motion column is stuck for its entire length was not condemned — and the not-condemned path
     then published exactly the numbers this detector exists to suppress. Measured on two REAL files
     from the same device on the same night, both 100 % unbroken non-zero motion:

         642 rows · longest run 642  →  stuck TRUE   →  motionPct null      (correctly condemned)
         592 rows · longest run 592  →  stuck false  →  motionPct 100       ← the same fault, published

     Fifty samples decided it. So the bar is now RELATIVE as well as absolute: a run that covers
     ~90 % of a short record is the same evidence as a 600-sample run in a long one — the signature is
     "unbroken continuity across the record", and on a short record the whole record IS the run.

     The 0.9 factor is read off the SAME measured gap the 600 came from, not chosen: every healthy
     night in the 13-night capture series tops out at 3–13 s of unbroken movement, so on a 592-sample
     record the relative bar sits at 533 — 41x above the worst healthy observation and still below the
     592 the fault produces. Nothing lands in between.

     `min()` is what keeps this EXPORT-INERT for real nights: for any record of ≥ 667 samples the
     relative bar is ≥ 600 and the absolute one governs unchanged, so every full night keeps its
     existing verdict byte-for-byte. Only records too short for the old test to work at all change.

     Below MOTION_STUCK_MIN_SAMPLES the question is genuinely unanswerable — a 30-sample record of
     continuous movement is a person moving, not a broken writer — so it returns `null` (indeterminate)
     rather than a `false` that would read as a clean bill of health. That is the §3a rule applied to a
     verdict instead of a series: not-measured is its own state, never the negative one.

     Non-finite/absent motion values still break no run and start none, and they are excluded from the
     record length the relative bar is computed against — a file with no motion column is missing data,
     which is a different condition handled at the parse boundary (F15). */
  var MOTION_STUCK_MIN_SAMPLES = 60; // 1 min — below this, continuity carries no information
  var MOTION_STUCK_RUN_FRAC = 0.9; // a run covering ~the whole short record is the same evidence
  function _motionColumnStuck(rows) {
    if (!rows || !rows.length) return false;
    var run = 0,
      nFinite = 0,
      best = 0;
    for (var i = 0; i < rows.length; i++) {
      var m = rows[i].motion;
      if (m == null || !isFinite(m)) continue;
      nFinite++;
      if (m === 0) {
        run = 0;
        continue;
      }
      if (++run > best) best = run;
    }
    if (nFinite < MOTION_STUCK_MIN_SAMPLES) return null; // indeterminate — too short to ask
    var bar = Math.min(MOTION_STUCK_RUN_SAMPLES, Math.ceil(MOTION_STUCK_RUN_FRAC * nFinite));
    return best >= bar;
  }

  function computeMotionProfile(rows) {
    var WIN = 1800,
      windows = [],
      n = rows.length,
      i = 0;
    while (i < n) {
      var sl = rows.slice(i, Math.min(i + WIN, n));
      var mc = sl.filter(function (r) {
        return r.motion > 0;
      }).length;
      windows.push({ start: pad(rows[i].t.getUTCHours()) + ':' + pad(rows[i].t.getUTCMinutes()), motionPct: +((mc / sl.length) * 100).toFixed(1), samples: sl.length });
      i += WIN;
    }
    // v15: weight by sample count so partial last window doesn't over-inflate arousal index
    var totalSamples = windows.reduce(function (s, w) {
      return s + w.samples;
    }, 0);
    var restlessSamples = windows
      .filter(function (w) {
        return w.motionPct >= 2.0;
      })
      .reduce(function (s, w) {
        return s + w.samples;
      }, 0);
    var restless = windows.filter(function (w) {
      return w.motionPct >= 2.0;
    }).length;
    var arousalIndex = totalSamples > 0 ? +((restlessSamples / totalSamples) * 100).toFixed(0) : 0;
    return { windows: windows, restlessWindows: restless, arousalIndex: +arousalIndex, totalWindows: windows.length };
  }

  // Sleep Stability Score: composite 0-100 (higher = better).
  // Weighted across 6 components. Single integrative index for quick trending.
  function computeSleepStabilityScore(stats, hrv, osc, hb) {
    var s1 = Math.max(0, Math.min(100, Math.round(((2.0 - stats.spo2Std) / 1.5) * 100)));
    // HR-floor subscore is null when HR is UNMEASURABLE (computeHRV → null on <120 motion-free,
    // non-artifact samples). Seeding a neutral 50 here (the old behavior) FABRICATED absence — it
    // fed a fixed 5-point contribution and exported as a real subscore, differing from a genuinely
    // poor-but-measured floor (0 pts) by up to 5 score points. Instead drop it and renormalize the
    // remaining 0.9 of weight to 1.0 so the score reflects only the components actually measured,
    // and surface hrFloor=null so the absence is visible (gate on inputs PRESENT, never seed one).
    var s2 = hrv ? Math.max(0, Math.min(100, Math.round(((70 - hrv.hrFloor) / 18) * 100))) : null;
    /* §3 — the motion subscore inherits s2's rule, and must: `stats.motionPct` is now null on a
       faulted motion column, and `(2.0 - null)/1.8` is 1.11 → clamps to a PERFECT 100. A stuck
       sensor would have scored the night's stillness top marks, which is the same fabricated-absence
       bug the note above s2 exists to prevent. Drop the component instead. */
    var s3 = stats.motionPct == null ? null : Math.max(0, Math.min(100, Math.round(((2.0 - stats.motionPct) / 1.8) * 100)));
    var s4 = Math.max(0, Math.min(100, Math.round(((20 - osc.episodeCount) / 20) * 100)));
    var s5 = Math.max(0, Math.min(100, Math.round(((15 - hb.rate) / 15) * 100)));
    var s6 = Math.max(0, Math.min(100, Math.round(((20 - stats.t95pct) / 20) * 100)));
    /* Renormalize over the components actually MEASURED, generalizing the s2-only branch this
       replaces. Arithmetically identical where it applied — with nothing null the divisor is 1.0,
       with only s2 null it is 0.9 — so no existing export moves. */
    var _parts = [
      [s1, 0.2],
      [s2, 0.1],
      [s3, 0.15],
      [s4, 0.2],
      [s5, 0.2],
      [s6, 0.15]
    ].filter(function (p) {
      return p[0] != null;
    });
    var _wSum = _parts.reduce(function (a, p) {
      return a + /** @type {number} */ (p[1]);
    }, 0);
    var score = Math.round(
      _parts.reduce(function (a, p) {
        return a + /** @type {number} */ (p[0]) * /** @type {number} */ (p[1]);
      }, 0) / _wSum
    );
    var grade = score >= 80 ? 'Good' : score >= 60 ? 'Fair' : 'Poor';
    var gradeClass = score >= 80 ? 'good' : score >= 60 ? 'warn' : 'bad';
    return { score: score, grade: grade, gradeClass: gradeClass, components: { spo2Stab: s1, hrFloor: s2, motion: s3, pb: s4, hypoxicBurden: s5, t95: s6 } };
  }

  // ═══════════════════════════════════════════
  // v18 — EXTENDED ANALYSIS FUNCTIONS
  // ═══════════════════════════════════════════

  /* ════ OXIMETER SELF-GATE · Part A (self-gate-and-consequence-corroboration) ══
   A desaturation coincident with the oximeter's OWN perfusion/pulse-signal
   collapse, or with non-physiologic fall kinetics, is an optical/mechanical
   artifact — not blood. Decided LOCALLY on one device (no network, no headcount
   vote). MIRROR this routine verbatim in cpapdex-dsp.js — like parseTimestamp,
   do not extract a shared util; the two nodes ship independently and must each
   stand alone. See OXIMETER-SELFGATE-AND-CONSEQUENCE-COROBORATION.md Part A.

   A real desat glides down over 10–40 s with the pulse STILL VALID (often rising);
   a probe squeeze cliffs in 1–2 s and the pulse signal craters at the same instant
   (the optical path is occluded so BOTH channels die together). selfGateDesat
   annotates the SAME event:  .artifact (bool) · .reason ('perfusion-collapse' |
   'nonphysiologic-kinetics') · .sqi (0.2 when artifact, for effConf = conf×sqi).
   Artifact desats are EXCLUDED from ODI and NOT emitted as ganglior_events. */
  var SELFGATE = {
    WIN_SEC: 10, // ± window (s) around the desat onset at 1 Hz
    PULSE_MIN: 30,
    PULSE_MAX: 220, // physiologic pulse-rate band (bpm)
    PULSE_VALID_FLOOR: 0.5, // <50% valid pulse in the window ⇒ perfusion collapse
    FALL_RATE_MAX: 1.5, // %/s — a real systemic desat falls over tens of s
    EDGE_PULSE_DROP: 40 // bpm step at the SpO2 edge that mirrors it (occlusion)
  };
  function selfGateDesat(desat, pulseSeries, spo2Series) {
    if (!desat) return desat;
    var onset = desat.onset != null ? desat.onset : desat.startIdx;
    var nadir = desat.nadirIdx != null ? desat.nadirIdx : onset;
    var endIdx = desat.endIdx != null ? desat.endIdx : nadir;
    desat.artifact = false;
    if (onset == null || !pulseSeries || !pulseSeries.length) return desat;
    var W = SELFGATE.WIN_SEC,
      N = pulseSeries.length;
    var lo = Math.max(0, onset - W),
      hi = Math.min(N - 1, (endIdx != null ? endIdx : nadir) + W);
    // (1) perfusion: fraction of the window with a present, in-band pulse
    var valid = 0,
      tot = 0;
    for (var i = lo; i <= hi; i++) {
      tot++;
      var p = pulseSeries[i];
      if (p != null && isFinite(p) && p >= SELFGATE.PULSE_MIN && p <= SELFGATE.PULSE_MAX) valid++;
    }
    var pulseValid = tot > 0 ? valid / tot : 0;
    // (2) kinetics: steepest 1-second SpO2 fall over the leading edge (%/s, 1 Hz)
    var fallRate = 0;
    if (spo2Series && spo2Series.length) {
      var a = Math.max(1, onset - 3),
        b = Math.min(spo2Series.length - 1, nadir);
      for (var k = a; k <= b; k++) {
        var d = spo2Series[k - 1] - spo2Series[k];
        if (d > fallRate) fallRate = d;
      }
    } else if (desat.depth != null && desat.duration) {
      fallRate = desat.depth / Math.max(1, desat.duration);
    }
    // (3) edge collapse: pulse craters / goes invalid EXACTLY at the SpO2 edge
    var edgeCollapse = false;
    if (nadir != null && nadir < N) {
      var pBefore = pulseSeries[Math.max(0, onset - 2)];
      var pAt = pulseSeries[Math.min(N - 1, nadir)];
      var beforeOk = pBefore != null && isFinite(pBefore) && pBefore >= SELFGATE.PULSE_MIN && pBefore <= SELFGATE.PULSE_MAX;
      var atBad = pAt == null || !isFinite(pAt) || pAt < SELFGATE.PULSE_MIN || pAt > SELFGATE.PULSE_MAX || (beforeOk && pBefore - pAt >= SELFGATE.EDGE_PULSE_DROP);
      edgeCollapse = beforeOk && atBad;
    }
    if (fallRate > SELFGATE.FALL_RATE_MAX) {
      desat.artifact = true;
      desat.reason = 'nonphysiologic-kinetics';
      desat.sqi = 0.2;
    } else if (pulseValid < SELFGATE.PULSE_VALID_FLOOR || edgeCollapse) {
      desat.artifact = true;
      desat.reason = 'perfusion-collapse';
      desat.sqi = 0.2;
    }
    desat.fallRate = +fallRate.toFixed(3);
    desat.pulseValid = +pulseValid.toFixed(2);
    return desat;
  }

  /* ODI-3 ARTIFACT SELF-GATE (DEEP-AUDIT FINDING 1 — the ODI-3 THRESHOLD family was inflated by
     artifacts). `selfGateDesat` flags probe-squeeze / finger-off artifact desats and `processNight`
     subtracts them from ODI-4 (via desat.artifactCount) — but the drop:3 family re-detected the raw
     signal with NO gate: odi3 (detectODI), hypoxicLoad, pRED3p, dip3Rate, and ahiKulkas (via
     odi3Rate). A ≥4% drop IS a ≥3% drop, so every artifact removed from ODI-4 SURVIVED in the ODI-3
     superset (~2.4× inflation). This wrapper runs the SAME tested SELFGATE kinetics/perfusion verdict
     on the drop:3 detections and drops the flagged artifacts, so the whole ODI-3 family inherits the
     identical exclusion ODI-4 already trusts. desat.events CANNOT be reused here — those are the
     drop:4 set. Returns the SURVIVING (non-artifact) events; a no-op returning ALL events when no
     pulse series is available to judge them (same honesty as selfGateDesat's own no-pulse guard). */
  function detectDesatEventsGated(spo2, opts, pulseSeries) {
    var events = detectDesatEvents(spo2, opts);
    if (!pulseSeries || !pulseSeries.length) return events;
    return events.filter(function (e) {
      /** @type {any} */ (e).onset = e.startIdx;
      selfGateDesat(e, pulseSeries, spo2);
      return !(/** @type {any} */ (e).artifact);
    });
  }

  // 1. DESATURATION PROFILE — 8 SpO2-derived metrics
  function computeDesaturationProfile(rows, tIdx, odi4, blArr) {
    var spo2 = rows.map(function (r) {
      return r.spo2;
    });
    var n = spo2.length,
      WIN = 300;

    // Delta-index (SpO2 instability): mean |diff of consecutive 12s means|
    var means12 = [];
    for (var i = 0; i + 12 <= n; i += 12) {
      var s = 0;
      for (var j = i; j < i + 12; j++) s += spo2[j];
      means12.push(s / 12);
    }
    var deltaIndex = 0;
    for (var i = 1; i < means12.length; i++) deltaIndex += Math.abs(means12[i] - means12[i - 1]);
    deltaIndex = means12.length > 1 ? +(deltaIndex / (means12.length - 1)).toFixed(3) : 0;

    // SpO2 CoV (%)
    if (!n) return null;
    var meanSpo2 =
      spo2.reduce(function (a, b) {
        return a + b;
      }, 0) / n;
    var spo2CoV = meanSpo2 > 0 ? +((stdDev(spo2) / meanSpo2) * 100).toFixed(2) : 0;

    // T-Index AUC weighted: each threshold weighted by its clinical severity
    var weights = { 95: 1, 94: 2, 93: 3, 92: 4, 91: 5, 90: 6, 89: 8, 88: 10, 85: 15, 80: 25 };
    var tAucWeighted = 0;
    Object.keys(weights).forEach(function (t) {
      if (tIdx[+t]) tAucWeighted += weights[+t] * tIdx[+t].secs;
    });
    tAucWeighted = isFinite(tAucWeighted) ? +tAucWeighted.toFixed(0) : 0;

    // AUC-90 (hypoxic burden below 90%)
    var auc90 = 0;
    for (var i = 0; i < n; i++) {
      if (spo2[i] < 90) auc90 += 90 - spo2[i];
    }
    var durationHr = n / 3600;
    var auc90Total = +(auc90 / 60).toFixed(1);
    var auc90Rate = durationHr > 0 ? +(auc90Total / durationHr).toFixed(2) : 0;

    // Nadir Duration Profile + ODI-4 Recovery Time. DEX-EVENT-UNIFY-FOLLOWUPS §1: route
    // through the ONE canonical primitive (trailing-p90 CEILING baseline + simple re-rise
    // close, exitPct === ODI_DROP) so this family scores the SAME event set as the headline
    // ODI-4 (detectODI) — nadir.count now agrees with ODI-4 by construction instead of
    // drifting on a private trailing-MEAN loop. The recovery look-forward (secs back to the
    // onset baseline − 1) + the oximeter self-gate are preserved on top of the shared set.
    var nadirEvents = detectDesatEvents(spo2, { dropPct: DexKernel.K.ODI_DROP, exitPct: DexKernel.K.ODI_DROP, blArr: blArr }).map(function (e) {
      var recov = 0;
      for (var k = e.endIdx; k < Math.min(e.endIdx + 120, n); k++) {
        if (spo2[k] >= e.baseline - 1) {
          recov = k - e.endIdx;
          break;
        }
      }
      return {
        depth: e.depth,
        duration: e.durationSec,
        recovery: recov,
        startIdx: e.startIdx,
        nadirIdx: e.nadirIdx,
        endIdx: e.endIdx,
        nadir: e.nadir,
        recoverySlope: recov > 0 ? +((e.baseline - e.nadir) / recov).toFixed(3) : 0
      };
    });
    // ── OXIMETER SELF-GATE (Part A): flag optical/mechanical-artifact desats so
    //    they are excluded from ODI and never emitted as ganglior_events. `events`
    //    below carries only the SURVIVING (non-artifact) desats, so every
    //    downstream consumer (O2HR efficiency, nadir trend, IEI, recovery-CV, the
    //    Integrator's event synthesis) inherits the exclusion automatically;
    //    `eventsAll` retains the flagged set for the UI (shown struck-through). ──
    var pulseSeries = rows.map(function (r) {
      return r.hr;
    });
    nadirEvents.forEach(function (ev) {
      /** @type {any} */ (ev).onset = ev.startIdx;
      selfGateDesat(ev, pulseSeries, spo2);
    });
    var artifactCount = nadirEvents.filter(function (e) {
      return /** @type {any} */ (e).artifact;
    }).length;
    var realEvents = nadirEvents.filter(function (e) {
      return !(/** @type {any} */ (e).artifact);
    });
    var meanRecovery = realEvents.length
      ? +(
          realEvents.reduce(function (s, e) {
            return s + e.recovery;
          }, 0) / realEvents.length
        ).toFixed(0)
      : 0;
    var meanDepth = realEvents.length
      ? +(
          realEvents.reduce(function (s, e) {
            return s + e.depth;
          }, 0) / realEvents.length
        ).toFixed(1)
      : 0;
    var meanDuration = realEvents.length
      ? +(
          realEvents.reduce(function (s, e) {
            return s + e.duration;
          }, 0) / realEvents.length
        ).toFixed(0)
      : 0;

    // SpO2 Dip Rate ≥3%/hr — DEX-EVENT-UNIFY-FOLLOWUPS §1: from the ONE canonical
    // primitive (ODI-3 threshold, simple re-rise close, no min-length gate so every
    // distinct ≥3% dip counts), not the removed private trailing-MEAN loop.
    // FINDING 1: gate the ≥3% dip count on the artifact self-gate (pulseSeries built above at the
    // profile's self-gate step) so dip3Rate inherits the same exclusion as ODI-4 — an artifact
    // desat is a ≥3% dip too, and was surviving here at the drop:3 threshold.
    var dip3Count = detectDesatEventsGated(spo2, { dropPct: 3, exitPct: 3, minSec: 0, blArr: blArr }, pulseSeries).length;
    var dip3Rate = durationHr > 0 ? +(dip3Count / durationHr).toFixed(1) : 0;

    /* CLOCK: stamp each event with the REAL wall-clock time of its own row (DEEP-AUDIT-2026-07-11 §8).
       parseCSV DROPS rows (the device's '- -' no-reading, out-of-band values, unparsable stamps), so a row
       INDEX is not a second-offset — yet both consumers rebuilt event time from the index and disagreed
       with each other AND with the row's own parsed stamp: oxydex-dsp's bus export used t0 + idx·dt (a
       uniform stretch that smears a dropout evenly across the night) and oxydex-fusion used t0 + idx·1000
       (hard-coded 1 Hz). On a real lossy night the worst desat landed 422 s / 849 s from its true time —
       against a coincidence gate of LEAD 15 s / TRAIL 60 s, so desat↔surge corroboration was noise.
       rows[idx].tMs is the honest value and was already sitting right here. */
    var _stampEvent = function (e) {
      var r0 = rows[e.startIdx],
        rN = rows[e.nadirIdx],
        rE = rows[e.endIdx];
      e.tMs = rN && rN.tMs != null ? rN.tMs : null; // the nadir IS the event's instant
      e.startTMs = r0 && r0.tMs != null ? r0.tMs : null;
      e.endTMs = rE && rE.tMs != null ? rE.tMs : null;
      return e;
    };
    realEvents.forEach(_stampEvent);
    nadirEvents.forEach(_stampEvent);

    return {
      deltaIndex: deltaIndex,
      spo2CoV: spo2CoV,
      tAucWeighted: tAucWeighted,
      auc90Total: auc90Total,
      auc90Rate: auc90Rate,
      nadir: { count: realEvents.length, meanDepth: meanDepth, meanDuration: meanDuration, meanRecovery: meanRecovery },
      events: realEvents, // SURVIVING desats only — feeds O2HR efficiency, nadir trend, IEI, recovery-CV, Integrator emit
      eventsAll: nadirEvents, // full set incl. self-gated artifacts (UI shows artifacts struck-through with .reason)
      artifactCount: artifactCount,
      dip3Rate: dip3Rate
    };
  }

  // OXYDEX-NADIR-HONESTY (RUNAWAY-FIX-FOLLOWUPS §1/§2): a physiologically-plausible nadir for the
  // headline minSpo2 / SPO2_CRITICAL_DIP / "nadir SpO₂ N%" impression. The raw Math.min can be a single-
  // second instrument dropout or the sensor's opening settling ramp — either fabricates a scary nadir.
  // Excludes samples that are (a) INSIDE a self-gated ARTIFACT desaturation (desat.eventsAll[].artifact —
  // the SAME tested SELFGATE kinetics/perfusion verdict the ODI already trusts: deep, fast cliffs where
  // the pulse craters), or (b) part of an OPENING settling RAMP (SpO2 starts ≤ NADIR_RAMP_START_MAX and
  // climbs to ≥ NADIR_RAMP_RECOVER within NADIR_RAMP_MAX_SEC, starting at/near its own min — the gradual
  // sibling of the frozen placeholder that trimSensorWarmup already removes). NOT deletion: rows are
  // untouched (the trace + ODI + every other metric are unaffected); ONLY the nadir STATISTIC skips the
  // excluded samples. Returns { min, excluded }. Never masks everything (falls back to rawMin) — an honest
  // low is preserved, we only drop the physiologically-impossible ones. The SpO2 twin of the parent's HR bound.
  function computeGatedNadir(rows, desat, rawMin) {
    var n = rows.length;
    if (!n) return { min: rawMin, excluded: 0 };
    var masked = new Uint8Array(n),
      ex = 0,
      i;
    // (a) self-gated ARTIFACT desaturations — mask each flagged event's [startIdx, endIdx]
    var ev = desat && desat.eventsAll ? desat.eventsAll : [];
    for (var e = 0; e < ev.length; e++) {
      if (!ev[e].artifact) continue;
      var a = ev[e].startIdx != null ? ev[e].startIdx : ev[e].nadirIdx;
      if (a == null) continue;
      var b = ev[e].endIdx != null ? ev[e].endIdx : ev[e].nadirIdx;
      a = Math.max(0, a | 0);
      b = Math.min(n - 1, (b != null ? b : a) | 0);
      for (i = a; i <= b; i++) {
        if (!masked[i]) {
          masked[i] = 1;
          ex++;
        }
      }
    }
    // (b) opening perfusion-settling ramp
    if (rows[0].spo2 <= CFG.NADIR_RAMP_START_MAX) {
      var lim = Math.min(n, CFG.NADIR_RAMP_MAX_SEC),
        k = 0;
      while (k < lim && rows[k].spo2 < CFG.NADIR_RAMP_RECOVER) k++;
      if (k > 0 && k < lim) {
        // reached a normal plateau within the window
        var openMin = rows[0].spo2; // require the region to START at (near) its own min
        for (var j = 1; j < k; j++) if (rows[j].spo2 < openMin) openMin = rows[j].spo2; // = a climb, not a dip after a normal start
        if (rows[0].spo2 <= openMin + 1) {
          for (i = 0; i < k; i++) {
            if (!masked[i]) {
              masked[i] = 1;
              ex++;
            }
          }
        }
      }
    }
    var mn = Infinity;
    for (i = 0; i < n; i++) {
      if (masked[i]) continue;
      if (rows[i].spo2 < mn) mn = rows[i].spo2;
    }
    if (!isFinite(mn)) return { min: rawMin, excluded: 0 }; // never mask the whole night
    return { min: mn, excluded: ex };
  }

  // 2. HR PROFILE — 5 HR-derived metrics
  function computeHRProfile(rows) {
    var clean = rows.filter(function (r) {
      return r.motion === 0 && !r.hrArtifact;
    });
    var n = clean.length;
    if (n < 120) return null;
    var hrs = clean.map(function (r) {
      return r.hr;
    });

    // HR Circadian Phase Score: mean(last 60min) - mean(first 60min)
    var first60 = hrs.slice(0, Math.min(3600, n));
    var last60 = hrs.slice(Math.max(0, n - 3600));
    var circadianScore = +(avg(last60) - avg(first60)).toFixed(2);

    // HR Deceleration Capacity: max 60-min rolling mean, then find deepest subsequent drop
    var WIN60 = 3600;
    var rollingMeans = [];
    for (var i = 0; i + WIN60 <= n; i += 60) {
      rollingMeans.push(avg(hrs.slice(i, i + WIN60)));
    }
    var decCapacity = 0;
    if (rollingMeans.length > 1) {
      var peakMean = Math.max.apply(null, rollingMeans);
      var minAfterPeak = peakMean;
      var pastPeak = false;
      for (var i = 0; i < rollingMeans.length; i++) {
        if (rollingMeans[i] === peakMean) pastPeak = true;
        if (pastPeak && rollingMeans[i] < minAfterPeak) minAfterPeak = rollingMeans[i];
      }
      decCapacity = +(peakMean - minAfterPeak).toFixed(2);
    }

    // Approximate Entropy (ApEn) m=2, r=0.2*SD — use subsample for speed
    var step = Math.max(1, Math.ceil(hrs.length / 300));
    var sub = hrs.filter(function (_, i) {
      return i % step === 0;
    }); // cap at ~300 samples for ApEn O(n²)
    var subN = sub.length;
    var apEn = 0;
    if (subN >= 20) {
      var r = 0.2 * stdDev(sub);
      function phi(m) {
        // ApEn phi(m): (1/N) × Σ log(Ci/N) — correct mean-of-logs formula
        // (v22.15 fix: previous version used log(sum/N) = log-of-mean, biasing values low)
        var N = subN - m;
        if (N <= 0) return 0;
        var logSum = 0;
        for (var i = 0; i < N; i++) {
          var ci = 0;
          for (var j = 0; j < N; j++) {
            var maxDiff = 0;
            for (var k = 0; k < m; k++) maxDiff = Math.max(maxDiff, Math.abs(sub[i + k] - sub[j + k]));
            if (maxDiff <= r) ci++;
          }
          if (ci > 0) logSum += Math.log(ci / N);
        }
        return logSum / N;
      }
      apEn = +(phi(2) - phi(3)).toFixed(4);
    }

    // Bradycardia Events: HR < 40 for ≥10 consecutive clean samples
    var bradyCount = 0,
      bradyRun = 0;
    clean.forEach(function (r) {
      if (r.hr < 40) {
        bradyRun++;
        if (bradyRun === 10) bradyCount++;
      } else bradyRun = 0;
    });

    // Tachycardia Events: HR > 100 without motion for ≥10 consecutive samples
    var tachyCount = 0,
      tachyRun = 0;
    clean.forEach(function (r) {
      if (r.hr > 100) {
        tachyRun++;
        if (tachyRun === 10) tachyCount++;
      } else tachyRun = 0;
    });

    return { circadianScore: circadianScore, decCapacity: decCapacity, apEn: apEn, bradyCount: bradyCount, tachyCount: tachyCount };
  }

  // 3. MOTION / SLEEP QUALITY — 3 motion-derived metrics
  function computeMotionSleep(rows) {
    var n = rows.length;

    // Sleep Efficiency: % of recording with motion = 0
    var quietCount = rows.filter(function (r) {
      return r.motion === 0;
    }).length;
    var sleepEff = +((quietCount / n) * 100).toFixed(1);

    // WASO Proxy: 5-min windows after first 30 min where motion >5%
    var wasoWindows = 0,
      WIN5 = 300;
    for (var i = 1800; i + WIN5 <= n; i += WIN5) {
      var sl = rows.slice(i, i + WIN5);
      var mc = sl.filter(function (r) {
        return r.motion > 0;
      }).length;
      if (mc / WIN5 > 0.05) wasoWindows++;
    }
    var totalPostOnset = Math.floor((n - 1800) / WIN5);
    var wasoPct = totalPostOnset > 0 ? +((wasoWindows / totalPostOnset) * 100).toFixed(0) : 0;

    // Positional Shifts: motion bursts that last >60 consecutive seconds
    var posShifts = 0,
      shiftRun = 0;
    rows.forEach(function (r) {
      if (r.motion > 0) {
        shiftRun++;
        if (shiftRun === 61) posShifts++;
      } else shiftRun = 0;
    });

    return { sleepEff: sleepEff, wasoWindows: wasoWindows, wasoPct: wasoPct, posShifts: posShifts };
  }

  // 4. CROSS-SIGNAL — 4 combined SpO2+HR metrics
  function computeCrossSignal(rows, osc, spikes, odi4, durationHr) {
    var n = rows.length;

    // Autonomic Arousal Index: (HR spikes + ODI-4 events) / durationHr
    var autoArousalIdx = durationHr > 0 ? +((spikes.length + odi4.count) / durationHr).toFixed(1) : 0;

    // Cardiorespiratory Coupling: Pearson r of SpO2 and HR 5-min rolling means
    var WIN5 = 300,
      spo2Means = [],
      hrMeans = [];
    for (var i = 0; i + WIN5 <= n; i += WIN5) {
      var sl = rows.slice(i, i + WIN5);
      spo2Means.push(
        sl.reduce(function (s, r) {
          return s + r.spo2;
        }, 0) / WIN5
      );
      hrMeans.push(
        sl.reduce(function (s, r) {
          return s + r.hr;
        }, 0) / WIN5
      );
    }
    /* NOT COMPUTABLE IS `null`, NEVER 0 (DEEP-AUDIT-V §2.3 F22). `crcIdx` is a CORRELATION, so 0 is a
       real, meaningful reading — "SpO₂ and HR are uncoupled" — and it is also the value this variable
       held whenever the correlation was never computed at all: fewer than four 5-minute windows (any
       recording under ~20 min), or a degenerate window set with zero variance in either series.
       Its consumer reads `crcIdx < 0.2` as the Cheyne-Stokes "low cardiorespiratory coupling"
       criterion (:1507), so an un-computed 0 satisfied it and pushed `csScore` to 1 →
       **"Cheyne-Stokes: Possible"** into `summary.ranked` at warn severity, on every short recording.
       Measured on a real O2Ring night truncated in place:
           5 min / 15 min / 19 min → crcIdx 0      → csScore 1 → "Cheyne-Stokes · Possible"  ← fabricated
           25 min                  → crcIdx −0.177 → a real measurement that legitimately qualifies
       Note the consumer guard at :1507 was ALREADY `crcIdx != null && crcIdx < 0.2` — it was written
       expecting an honest null that the producer never emitted. This makes the producer keep that
       promise; :1507 needs no change. */
    var crcIdx = null;
    if (spo2Means.length > 3) {
      var ms = avg(spo2Means),
        mh = avg(hrMeans);
      var num = 0,
        ds = 0,
        dh = 0;
      for (var i = 0; i < spo2Means.length; i++) {
        num += (spo2Means[i] - ms) * (hrMeans[i] - mh);
        ds += (spo2Means[i] - ms) * (spo2Means[i] - ms);
        dh += (hrMeans[i] - mh) * (hrMeans[i] - mh);
      }
      // Zero variance in either series ⇒ the correlation is UNDEFINED, not zero (same rule as above).
      crcIdx = ds > 0 && dh > 0 ? +(num / Math.sqrt(ds * dh)).toFixed(3) : null;
    }

    // SpO2-HR Divergence: PB windows with mean SpO2 drop but no spike within ±120s
    var divergeCount = 0;
    if (osc && osc.episodeCount > 0) {
      // Proxy: PB episodes without a matching HR spike nearby (2 spikes per episode assumed)
      // Note: this is an approximation; true divergence requires timestamp alignment
      var coveredEpisodes = Math.min(spikes.length * 2, osc.episodeCount);
      divergeCount = Math.max(0, osc.episodeCount - coveredEpisodes);
    }
    var divergePct = osc && osc.episodeCount > 0 ? +((divergeCount / osc.episodeCount) * 100).toFixed(0) : 0;

    // HR Recovery after PB: mean HR slope in 5min post each osc first/last window
    // Simplified: compare mean HR in windows adjacent to osc episodes using stats only
    // (full implementation requires cross-referencing osc timestamps with HR array)
    var hrRecovery = null; // reserved for future implementation requiring timestamp alignment

    return { autoArousalIdx: autoArousalIdx, crcIdx: crcIdx, divergeCount: divergeCount, divergePct: +divergePct, hrRecovery: hrRecovery };
  }

  // ═══════════════════════════════════════════
  // v19 — ADVANCED ANALYSIS FUNCTIONS
  // ═══════════════════════════════════════════

  // 5. Extended SpO2 metrics (WtDSI, IQR, conditional mean, nadir histogram)
  function computeSpO2Advanced(rows, blArr) {
    var spo2 = rows.map(function (r) {
      return r.spo2;
    });
    var n = spo2.length,
      WIN = 300;
    if (n < 60) return null;

    // Nadir events from the ONE shared ODI-4 detector (ceiling baseline). §3 close-mode: ODI-4 entry +
    // anti-chatter HYSTERESIS close (no exitPct) — WtDSI is a SATELLITE stat, not the simple-close
    // headline count. §1: shared p90-ceiling blArr threaded. DEX-EVENT-UNIFY-FOLLOWUPS-II.
    // `nadir` is the ABSOLUTE SpO₂ floor of the event and is carried because nadirBins is keyed by
    // absolute level (above91/b90_91/…). It used to be dropped here, which forced the histogram to
    // bin on `depth` under absolute-level key names — see the nadirBins comment below.
    var nadirEvents = detectDesatEvents(spo2, { dropPct: DexKernel.K.ODI_DROP, blArr: blArr }).map(function (e) {
      return { depth: e.depth, duration: e.durationSec, nadir: e.nadir };
    });

    // WtDSI: Σ(depth² × duration) / totalTime
    var wtdsi = 0;
    nadirEvents.forEach(function (e) {
      wtdsi += e.depth * e.depth * e.duration;
    });
    wtdsi = n > 0 ? +(wtdsi / n).toFixed(3) : 0;

    // SpO2 IQR (p75 - p25)
    var sorted = spo2.slice().sort(function (a, b) {
      return a - b;
    });
    var p25 = sorted[Math.floor(n * 0.25)];
    var p75 = sorted[Math.floor(n * 0.75)];
    var iqr = +(p75 - p25).toFixed(1);

    // Conditional mean SpO2 below 94%
    var belowSamples = spo2.filter(function (v) {
      return v < 94;
    });
    var condMean =
      belowSamples.length > 0
        ? +(
            belowSamples.reduce(function (a, b) {
              return a + b;
            }, 0) / belowSamples.length
          ).toFixed(2)
        : null;
    var condPct = n > 0 ? +((belowSamples.length / n) * 100).toFixed(1) : 0;

    // Nadir histogram — binned on the ABSOLUTE SpO₂ floor each event reached, which is what the key
    // names (above91 / b90_91 / b88_89 / b85_87 / below85) assert. It previously binned on `depth`
    // (the DROP in points) against thresholds 4/6/9/12 — a proxy that only lines up with the labels
    // when the baseline happens to sit near 95 %. On the real 2026-07-19 night that proxy reported
    // `b88_89: 4` while the lowest SpO₂ all night was 91 %, i.e. it claimed hypoxemia that never
    // happened. Bins tile the whole range so every event lands in exactly one.
    var bins = { above91: 0, b90_91: 0, b88_89: 0, b85_87: 0, below85: 0 };
    nadirEvents.forEach(function (e) {
      var nad = e.nadir;
      if (!isFinite(nad)) return; // no floor recorded → cannot claim a level; never guess one
      if (nad > 91) bins.above91++;
      else if (nad >= 90) bins.b90_91++;
      else if (nad >= 88) bins.b88_89++;
      else if (nad >= 85) bins.b85_87++;
      else bins.below85++;
    });

    return { wtdsi: wtdsi, spo2IQR: iqr, condMeanBelow94: condMean, condPctBelow94: condPct, nadirBins: bins };
  }

  // 6. Extended HR metrics (RMSSD proxy, IQR, PB contrast)
  function computeHRAdvanced(rows, osc) {
    var clean = rows.filter(function (r) {
      return r.motion === 0 && !r.hrArtifact;
    });
    if (clean.length < 60) return null;
    var hrs = clean.map(function (r) {
      return r.hr;
    });
    var n = hrs.length;

    // RMSSD proxy (1Hz): sqrt(mean of squared successive differences)
    var ssds = 0,
      pairs = 0;
    for (var i = 1; i < n; i++) {
      var diff = hrs[i] - hrs[i - 1];
      ssds += diff * diff;
      pairs++;
    }
    var rmssd = pairs > 0 ? +Math.sqrt(ssds / pairs).toFixed(2) : 0;

    // HR IQR
    var sortedHR = hrs.slice().sort(function (a, b) {
      return a - b;
    });
    var hrP25 = sortedHR[Math.floor(n * 0.25)];
    var hrP75 = sortedHR[Math.floor(n * 0.75)];
    var hrIQR = hrP75 - hrP25;

    // Mean HR during PB windows vs non-PB windows
    // Use 5-min (300s) windows — flag oscillation windows vs non
    var WIN5 = CFG.OSC_WINDOW_SEC,
      totalRows = rows.length;
    var pbWinMeans = [],
      nonPbWinMeans = [];
    for (var i = 0; i + WIN5 <= totalRows; i += WIN5) {
      var sl = rows.slice(i, i + WIN5);
      var spo2Vals = sl.map(function (r) {
        return r.spo2;
      });
      var hrVals = sl
        .filter(function (r) {
          return r.motion === 0;
        })
        .map(function (r) {
          return r.hr;
        });
      if (!hrVals.length) continue;
      // Count crossings of CFG.SPO2_OSC_THRESHOLD in this window (single source: CFG)
      var crossings = 0,
        above = spo2Vals[0] >= CFG.SPO2_OSC_THRESHOLD;
      for (var j = 1; j < spo2Vals.length; j++) {
        var nowAbove = spo2Vals[j] >= CFG.SPO2_OSC_THRESHOLD;
        if (nowAbove !== above) {
          crossings++;
          above = nowAbove;
        }
      }
      var meanHRwin = avg(hrVals);
      if (crossings >= CFG.OSC_FLAG_CROSSINGS) pbWinMeans.push(meanHRwin);
      else nonPbWinMeans.push(meanHRwin);
    }
    var meanHRpb = pbWinMeans.length ? +avg(pbWinMeans).toFixed(1) : null;
    var meanHRnonPb = nonPbWinMeans.length ? +avg(nonPbWinMeans).toFixed(1) : null;
    var hrPbContrast = meanHRpb && meanHRnonPb ? +(meanHRpb - meanHRnonPb).toFixed(1) : null;

    return { rmssd: rmssd, hrIQR: hrIQR, meanHRpb: meanHRpb, meanHRnonPb: meanHRnonPb, hrPbContrast: hrPbContrast };
  }

  // 7. Composite/coupling metrics
  function computeComposite(rows, spikes, desat, cross, motSleep, durationHr) {
    var spo2 = rows.map(function (r) {
      return r.spo2;
    });
    var n = rows.length;
    var WIN = 300;

    // Oxygen Desat Arousal Coupling Score: % of ODI-4 nadirs followed by HR rise ≥8bpm within 60s
    var nadirEvents = desat ? desat.nadir.count : 0;
    var coupledCount = 0;
    if (nadirEvents > 0 && spikes.length > 0) {
      // proxy: if spike count ≥ 30% of nadir events → coupling present
      coupledCount = Math.min(spikes.length, nadirEvents);
    }
    // With no nadirs the ratio is 0/0 — UNDEFINED, not 0 %. A literal 0 rendered as a real
    // measurement ("Coupling 0 %", red) on a night that simply had nothing to couple; the
    // renderer's own guard (oxydex-render.js `cp.couplingScore != null`) was already written
    // expecting null. DEEP-AUDIT §18.
    var couplingScore = nadirEvents > 0 ? +((coupledCount / nadirEvents) * 100).toFixed(0) : null;

    // Sleep Fragmentation Index: (WASO + HR spikes + osc episodes) / hr
    var wasoWin = motSleep ? motSleep.wasoWindows : 0;
    // Use only ODI-4 events (not autoArousalIdx which already includes spikes → avoids double-count)
    var sfi = durationHr > 0 ? +((wasoWin + spikes.length) / durationHr).toFixed(1) : 0;

    // Nocturnal Stress Index (0-100): normalized composite
    // Components: dip3Rate (flag >5), hbRate (flag >5), t95pct (flag >15), AAI (flag >5)
    var dip3 = desat ? Math.min(desat.dip3Rate / 5, 1) : 0;
    var hbR = desat ? Math.min(desat.auc90Rate / 2, 1) : 0; // AUC-90 flag >2
    var t95 = 0;
    // Get t95pct from spo2 array
    var below95 = spo2.filter(function (v) {
      return v < 95;
    }).length;
    var t95pct = n > 0 ? (below95 / n) * 100 : 0;
    t95 = Math.min(t95pct / 15, 1);
    var aai = cross ? Math.min(cross.autoArousalIdx / 5, 1) : 0;
    var nsi = +(((dip3 + hbR + t95 + aai) / 4) * 100).toFixed(0);

    return { couplingScore: couplingScore, sfi: sfi, nsi: nsi };
  }

  // 8. Linear regression helper (for multi-night trend slope)
  function linReg(xsOrVals, ys) {
    var xs;
    if (ys === undefined) {
      xs = xsOrVals.map(function (_, i) {
        return i;
      });
      ys = xsOrVals;
    } else {
      xs = xsOrVals;
    }
    var n = xs.length;
    if (n < 2) return { slope: 0, r2: 0, intercept: 0 };
    var sx = 0,
      sy = 0,
      sxx = 0,
      sxy = 0;
    for (var i = 0; i < n; i++) {
      sx += xs[i];
      sy += ys[i];
      sxx += xs[i] * xs[i];
      sxy += xs[i] * ys[i];
    }
    var denom = n * sxx - sx * sx;
    if (denom === 0) return { slope: 0, r2: 0, intercept: ys[0] || 0 };
    var slope = denom ? (n * sxy - sx * sy) / denom : 0;
    var intercept = n > 0 ? (sy - slope * sx) / n : 0;
    var ssTot = 0,
      ssRes = 0,
      yMean = n > 0 ? sy / n : 0;
    for (var i = 0; i < n; i++) {
      ssTot += (ys[i] - yMean) * (ys[i] - yMean);
      ssRes += (ys[i] - (intercept + slope * xs[i])) * (ys[i] - (intercept + slope * xs[i]));
    }
    return { slope: isFinite(slope) ? +slope.toFixed(4) : 0, intercept: isFinite(intercept) ? +intercept.toFixed(4) : 0, r2: ssTot > 0 ? +(1 - ssRes / ssTot).toFixed(3) : 0 };
  }

  // ═══════════════════════════════════════════════════════════════════
  // v20.6 NEW METRICS A–O (18 functions, ~30 new scalar output fields)
  // ═══════════════════════════════════════════════════════════════════

  // ── A. SpO2 Baseline Drift ────────────────────────────────────────
  function computeSpO2Drift(rows) {
    var n = rows.length;
    if (n < 600) return null;
    var WIN = 300;
    var windows = [];
    for (var i = 0; i + WIN <= n; i += WIN) {
      var seg = rows.slice(i, i + WIN);
      var m =
        seg.reduce(function (a, r) {
          return a + r.spo2;
        }, 0) / WIN;
      windows.push(m);
    }
    if (windows.length < 3) return null;
    var lr = linReg(windows);
    var driftPerHr = +(lr.slope * (3600 / WIN)).toFixed(3);
    return { driftSlope: lr.slope, driftPerHr: driftPerHr, driftR2: lr.r2, driftLabel: driftPerHr < -0.3 ? 'Declining (hypovent)' : driftPerHr > 0.3 ? 'Rising' : 'Stable' };
  }

  // ── B. ODI-2 ─────────────────────────────────────────────────────
  function computeODI2(rows) {
    var n = rows.length;
    if (n < 120) return null;
    var WIN = 300,
      count = 0;
    // O(n) sliding window: maintain running sum of spo2[max(0,i-WIN)..i-1]
    var winSum = 0,
      winLen = 0;
    for (var i = 0; i < n; i++) {
      if (i > 0) {
        winSum += rows[i - 1].spo2;
        winLen++;
      }
      if (i > WIN) {
        winSum -= rows[i - WIN - 1].spo2;
        winLen--;
      }
      if (winLen <= 0) continue;
      var baseline = winSum / winLen;
      if (rows[i].spo2 <= baseline - 2 && rows[i - 1].spo2 > baseline - 2) count++;
    }
    var durationHr = n / 3600;
    return { odi2Count: count, odi2Rate: durationHr > 0 ? +(count / durationHr).toFixed(2) : 0 };
  }

  // ── C. SpO2 Reactive Overshoot ────────────────────────────────────
  function computeSpO2Overshoot(rows, desat) {
    if (!desat || !desat.nadir || !desat.nadir.count || desat.nadir.count < 2) return null;
    var n = rows.length;
    var overshoots = [];
    var BW = 180; // baseline window: rows[max(0,i-BW)..i-1]
    var winSum = 0,
      winLen = 0; // O(n) running mean, replaces per-i slice+reduce
    for (var i = 0; i < n; i++) {
      if (i > 0) {
        winSum += rows[i - 1].spo2;
        winLen++;
      }
      if (i > BW) {
        winSum -= rows[i - 1 - BW].spo2;
        winLen--;
      }
      if (i < 60 || i >= n - 120) continue;
      if (winLen < 30) continue;
      var local = winSum / winLen;
      var prev = rows[i - 1].spo2,
        curr = rows[i].spo2;
      if (prev < local - 1 && curr >= local - 1) {
        var postSeg = rows.slice(i + 60, Math.min(n, i + 120));
        if (postSeg.length < 30) continue;
        var postMean =
          postSeg.reduce(function (a, r) {
            return a + r.spo2;
          }, 0) / postSeg.length;
        var os = +(postMean - local).toFixed(2);
        if (os > 0) overshoots.push(os);
      }
    }
    if (!overshoots.length) return null;
    var mean = +(
      overshoots.reduce(function (a, b) {
        return a + b;
      }, 0) / overshoots.length
    ).toFixed(2);
    return { overshootMean: mean, overshootCount: overshoots.length, overshootLabel: mean > 1.5 ? 'Elevated (CS pattern)' : mean > 0.5 ? 'Mild' : 'Normal' };
  }

  /* ══ DEEP-AUDIT-FOLLOWUPS §C1 — the tail-slice family ═══════════════════════
     Four metrics reported on `rows.slice(-USE)`: the LAST 30–60 min of a 6–10 h night. §9 had already
     fixed the HEAD-slice twins; this family was left because it was "not proven to move a surfaced
     number". Measured across 76 real O2Ring nights by sliding the window end across each night, it
     moves a great deal — the published number is an artifact of where the recording stopped:

       metric          median swing    relative    nights whose published LABEL flips
       spo2Ac1              0.061          6 %              70 / 76
       hrLfHf              99            308 %              64 / 76
       respRateBpm         10.1 bpm       87 %              76 / 76   <- every night
       crossCorrLag       120 s          187 %              75 / 76

     Two different fixes, because these are two different kinds of quantity:

     - `spo2Ac1` is a GLOBAL statistic: lag-1 autocorrelation is defined over the whole series and
       costs O(n). It now uses the whole record. There is no window left to disclose.

     - The other three are LOCAL: an LF/HF ratio, a respiratory rate and a coupling lag are only
       meaningful where the signal is stationary, which a whole night is not (the Task-Force HRV
       convention is 5-min windows for exactly that reason). Computing them whole-record would trade
       an arbitrary window for a meaningless one. They are instead evaluated over CONSECUTIVE windows
       spanning the night and reduced by MEDIAN - the same robust-median shape PpgDex already uses for
       `sdnnRobust` and ECGDex for `window: 'epochMedian5min'`. The reported number now describes the
       night rather than its last half hour, and one disturbed window can no longer set it.

     All four DISCLOSE their basis in the export (`basis`, plus `windowsUsed` where a reduction
     happened) - the other half of what §C1 asked for: a consumer must be able to tell a whole-record
     number from a windowed one without reading the source. */
  var TAIL_WIN_SEC = 1800; // 30 min - the span each LOCAL metric is stationary over
  function _nightWindows(rows, winSec) {
    var out = [],
      n = rows.length;
    if (n < winSec) return out;
    // Consecutive, non-overlapping, anchored at the START so a short tail remnant is dropped rather
    // than evaluated on a partial window - a partial window is what made the old answer arbitrary.
    for (var i = 0; i + winSec <= n; i += winSec) out.push(rows.slice(i, i + winSec));
    return out;
  }
  function _medianOf(vals) {
    var v = vals
      .filter(function (x) {
        return x != null && isFinite(x);
      })
      .sort(function (a, b) {
        return a - b;
      });
    if (!v.length) return null;
    var h = v.length >> 1;
    return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
  }

  // ── D. SpO2 Autocorrelation Lag-1 ────────────────────────────────
  function computeSpO2Autocorr(rows) {
    var n = rows.length;
    if (n < 300) return null;
    var USE = n; // §C1: whole record - ac1 is global and O(n); the 3600 cap bought nothing
    var s = rows.map(function (r) {
      return r.spo2;
    });
    var m =
      s.reduce(function (a, b) {
        return a + b;
      }, 0) / USE;
    var num = 0,
      den = 0;
    for (var i = 0; i < USE - 1; i++) {
      num += (s[i] - m) * (s[i + 1] - m);
      den += (s[i] - m) * (s[i] - m);
    }
    if (den === 0) return null;
    var ac1 = +(num / den).toFixed(3);
    return {
      ac1: ac1,
      ac1Label: ac1 > 0.95 ? 'Sustained (hypoventilation)' : ac1 > 0.85 ? 'Persistent' : ac1 < 0.5 ? 'Oscillating (PB pattern)' : 'Transient',
      basis: 'wholeRecord' // §C1 disclosure
    };
  }

  // ── E. HR Power Spectral Density (LF/HF) ─────────────────────────
  /* §C1: `_hrFreqBandsWindow` is the ORIGINAL kernel, unchanged, now scoped to one stationary window;
     `computeHRFreqBands` reduces it across the night by median. Keeping the kernel intact means the
     per-window physics is exactly what it always was — only the choice of which window to publish
     changed, which is the defect. */
  function computeHRFreqBands(rows) {
    var wins = _nightWindows(rows, TAIL_WIN_SEC);
    if (!wins.length) return _hrFreqBandsWindow(rows); // record shorter than one window: unchanged
    var per = /** @type {any[]} */ (
      wins
        .map(function (w) {
          return _hrFreqBandsWindow(w);
        })
        .filter(Boolean)
    );
    if (!per.length) return null;
    var lfhf = _medianOf(
      per.map(function (p) {
        return p.hrLfHf;
      })
    );
    /* Re-round every reduced value: a median of an EVEN count averages the two middles, so a median
       of 1-decimal powers can land on 0.15000000000000002 and ship that into the export. The per-
       window kernel's own precision is the contract; the reduction must not widen it. */
    var _r1 = function (v) {
      return v == null ? null : +v.toFixed(1);
    };
    return {
      hrLfPow: _r1(
        _medianOf(
          per.map(function (p) {
            return p.hrLfPow;
          })
        )
      ),
      hrHfPow: _r1(
        _medianOf(
          per.map(function (p) {
            return p.hrHfPow;
          })
        )
      ),
      hrLfHf: lfhf == null ? null : +lfhf.toFixed(2),
      hrLfHfLabel: lfhf === null ? 'N/A' : lfhf > 4 ? 'SNS dominant' : lfhf > 2 ? 'SNS-leaning' : 'Balanced',
      basis: 'medianOf' + TAIL_WIN_SEC / 60 + 'minWindows', // §C1 disclosure
      windowsUsed: per.length
    };
  }
  function _hrFreqBandsWindow(rows) {
    var n = rows.length;
    if (n < 600) return null;
    var USE = Math.min(n, 1800);
    var hr = rows.slice(-USE).map(function (r) {
      return r.hr;
    });
    var m =
      hr.reduce(function (a, b) {
        return a + b;
      }, 0) / USE;
    hr = hr.map(function (v) {
      return v - m;
    });
    function bandPow(lo, hi, nBins) {
      var power = 0;
      for (var b = 0; b < nBins; b++) {
        var f = lo + (b * (hi - lo)) / Math.max(1, nBins - 1);
        var re = 0,
          im = 0;
        for (var i = 0; i < USE; i++) {
          var ang = 2 * Math.PI * f * i;
          re += hr[i] * Math.cos(ang);
          im += hr[i] * Math.sin(ang);
        }
        power += (re * re + im * im) / USE;
      }
      return +(power / nBins).toFixed(1);
    }
    var lfPow = bandPow(0.04, 0.15, 5);
    var hfPow = bandPow(0.15, 0.4, 6);
    var lfhf = hfPow > 0 ? +(lfPow / hfPow).toFixed(2) : null;
    return { hrLfPow: lfPow, hrHfPow: hfPow, hrLfHf: lfhf, hrLfHfLabel: lfhf === null ? 'N/A' : lfhf > 4 ? 'SNS dominant' : lfhf > 2 ? 'SNS-leaning' : 'Balanced' };
  }

  // ── F. Respiratory Rate Proxy ─────────────────────────────────────
  /* §C1: original kernel scoped to one window (`_respRateProxyWindow`), reduced across the night by
     median. This was the worst of the four — 76 of 76 nights changed their published label depending
     on which half hour the recording happened to end in. */
  function computeRespRateProxy(rows) {
    var wins = _nightWindows(rows, TAIL_WIN_SEC);
    if (!wins.length) return _respRateProxyWindow(rows);
    var per = /** @type {any[]} */ (
      wins
        .map(function (w) {
          return _respRateProxyWindow(w);
        })
        .filter(Boolean)
    );
    if (!per.length) return null;
    var bpm = _medianOf(
      per.map(function (p) {
        return p.respRateBpm;
      })
    );
    if (bpm == null) return null;
    bpm = +bpm.toFixed(1);
    return {
      respRateBpm: bpm,
      rsaPeakFreq: +(bpm / 60).toFixed(4),
      rsaPeakPow: (function (v) {
        return v == null ? null : +v.toFixed(1); // see the re-round note in computeHRFreqBands
      })(
        _medianOf(
          per.map(function (p) {
            return p.rsaPeakPow;
          })
        )
      ),
      respRateLabel: bpm < 10 ? 'Slow (<10)' : bpm > 20 ? 'Fast (>20)' : 'Normal (10-20)',
      basis: 'medianOf' + TAIL_WIN_SEC / 60 + 'minWindows', // §C1 disclosure
      windowsUsed: per.length
    };
  }
  function _respRateProxyWindow(rows) {
    var n = rows.length;
    if (n < 600) return null;
    var USE = Math.min(n, 1800);
    var hr = rows.slice(-USE).map(function (r) {
      return r.hr;
    });
    var m =
      hr.reduce(function (a, b) {
        return a + b;
      }, 0) / USE;
    hr = hr.map(function (v) {
      return v - m;
    });
    var bestPow = -1,
      bestFreq = 0.2;
    for (var k = 0; k < 20; k++) {
      var f = 0.13 + (k * (0.33 - 0.13)) / 19;
      var re = 0,
        im = 0;
      for (var i = 0; i < USE; i++) {
        var ang = 2 * Math.PI * f * i;
        re += hr[i] * Math.cos(ang);
        im += hr[i] * Math.sin(ang);
      }
      var p = (re * re + im * im) / USE;
      if (p > bestPow) {
        bestPow = p;
        bestFreq = f;
      }
    }
    var bpm = +(bestFreq * 60).toFixed(1);
    return {
      respRateBpm: bpm,
      rsaPeakFreq: isFinite(bestFreq) ? +bestFreq.toFixed(4) : 0,
      rsaPeakPow: +bestPow.toFixed(1),
      respRateLabel: bpm < 10 ? 'Slow (<10)' : bpm > 20 ? 'Fast (>20)' : 'Normal (10-20)'
    };
  }

  // ── G. HR Acceleration Asymmetry ─────────────────────────────────
  function computeHRAsymmetry(rows) {
    var n = rows.length;
    if (n < 120) return null;
    var ups = [],
      downs = [];
    for (var i = 1; i < n; i++) {
      var d = rows[i].hr - rows[i - 1].hr;
      if (d > 0) ups.push(d);
      else if (d < 0) downs.push(-d);
    }
    if (!ups.length || !downs.length) return null;
    var meanUp =
      ups.reduce(function (a, b) {
        return a + b;
      }, 0) / ups.length;
    var meanDown =
      downs.reduce(function (a, b) {
        return a + b;
      }, 0) / downs.length;
    if (meanDown === 0) return null;
    var asym = +(meanUp / meanDown).toFixed(3);
    return {
      hrAccelAsym: asym,
      meanUpBpm: isFinite(meanUp) ? +meanUp.toFixed(2) : 0,
      meanDownBpm: isFinite(meanDown) ? +meanDown.toFixed(2) : 0,
      hrAsymLabel: asym > 1.15 ? 'Arousal-biased' : asym < 0.85 ? 'Vagally dominant' : 'Symmetric'
    };
  }

  // ── H. Nocturnal HR Quartile Trend ────────────────────────────────
  function computeHRQuartileTrend(rows) {
    var n = rows.length;
    if (n < 1200) return null;
    var q = Math.floor(n / 4);
    var qs = [0, 1, 2, 3].map(function (i) {
      var seg = rows.slice(i * q, i === 3 ? n : (i + 1) * q);
      if (!seg.length) return null;
      return +(
        seg.reduce(function (a, r) {
          return a + r.hr;
        }, 0) / seg.length
      ).toFixed(1);
    });
    if (qs.indexOf(null) >= 0) return null;
    var q1hr = /** @type {number} */ (qs[0]);
    var q3hr = /** @type {number} */ (qs[2]);
    var arc = qs && qs.length >= 4 ? +(q3hr - q1hr).toFixed(1) : 0;
    return {
      hrQ1: qs && qs.length >= 4 ? qs[0] : null,
      hrQ2: qs && qs.length >= 4 ? qs[1] : null,
      hrQ3: qs && qs.length >= 4 ? qs[2] : null,
      hrQ4: qs && qs.length >= 4 ? qs[3] : null,
      hrArc: arc,
      remReemergence: /** @type {number} */ (qs[3]) > /** @type {number} */ (qs[2]) + 1,
      hrArcLabel: arc < -3 ? 'Good (declining arc)' : arc > 3 ? 'Rising (arousal)' : 'Flat'
    };
  }

  // ── I. SpO2-HR Cross-Correlation Peak Lag ────────────────────────
  /* §C1: original kernel scoped to one window, reduced across the night by median. The lag search
     spans 0-120 s, and the old tail slice swung across that entire range night to night — a reported
     "lag" that could be anything the search allows is not a measurement of coupling. */
  function computeSpO2HRLag(rows) {
    var wins = _nightWindows(rows, TAIL_WIN_SEC);
    if (!wins.length) return _spO2HRLagWindow(rows);
    var per = /** @type {any[]} */ (
      wins
        .map(function (w) {
          return _spO2HRLagWindow(w);
        })
        .filter(Boolean)
    );
    if (!per.length) return null;
    var lag = _medianOf(
      per.map(function (p) {
        return p.crossCorrLag;
      })
    );
    if (lag == null) return null;
    lag = Math.round(lag);
    return {
      crossCorrLag: lag,
      crossCorrPeak: (function (v) {
        return v == null ? null : +v.toFixed(3); // see the re-round note in computeHRFreqBands
      })(
        _medianOf(
          per.map(function (p) {
            return p.crossCorrPeak;
          })
        )
      ),
      crossCorrLabel: lag < 10 ? 'Near-zero lag (central pattern)' : lag < 30 ? 'Moderate lag' : 'Delayed lag',
      basis: 'medianOf' + TAIL_WIN_SEC / 60 + 'minWindows', // §C1 disclosure
      windowsUsed: per.length
    };
  }
  function _spO2HRLagWindow(rows) {
    var n = rows.length;
    if (n < 600) return null;
    var USE = Math.min(n, 1800);
    var seg = rows.slice(-USE);
    var spo2 = seg.map(function (r) {
      return r.spo2;
    });
    var hr = seg.map(function (r) {
      return r.hr;
    });
    var ms2 =
      spo2.reduce(function (a, b) {
        return a + b;
      }, 0) / USE;
    var mhr =
      hr.reduce(function (a, b) {
        return a + b;
      }, 0) / USE;
    spo2 = spo2.map(function (v) {
      return v - ms2;
    });
    hr = hr.map(function (v) {
      return v - mhr;
    });
    var bestLag = 0,
      bestCor = -Infinity;
    for (var lag = 0; lag <= 120; lag++) {
      var num = 0,
        d1 = 0,
        d2 = 0;
      for (var i = 0; i < USE - lag; i++) {
        num += spo2[i] * hr[i + lag];
        d1 += spo2[i] * spo2[i];
        d2 += hr[i + lag] * hr[i + lag];
      }
      var cor = d1 > 0 && d2 > 0 ? num / Math.sqrt(d1 * d2) : 0;
      if (cor > bestCor) {
        bestCor = cor;
        bestLag = lag;
      }
    }
    return {
      crossCorrLag: bestLag,
      crossCorrPeak: isFinite(bestCor) ? +bestCor.toFixed(3) : 0,
      crossCorrLabel: bestLag < 10 ? 'Near-zero lag (central pattern)' : bestLag < 30 ? 'Moderate lag' : 'Delayed lag'
    };
  }

  // ── J. Spike Decay Time ───────────────────────────────────────────
  function computeSpikeDecay(rows, spikes) {
    if (!spikes || !spikes.length) return null;
    var decays = [];
    spikes.forEach(function (sp) {
      if (!sp || sp.baseline == null || sp.peak == null) return;
      var threshold = sp.baseline + 2;
      var peakIdx = -1;
      // Search near spike timestamp (±5 min) to avoid matching earlier spikes
      var startHr0 = rows.length > 0 ? rows[0].t.getUTCHours() * 60 + rows[0].t.getUTCMinutes() + rows[0].t.getUTCSeconds() / 60 : 0;
      var apxIdx = Math.round(((sp.mfm || 0) - startHr0) * 60);
      var s0 = Math.max(0, apxIdx - 300),
        s1 = Math.min(rows.length, apxIdx + 300);
      for (var i = s0; i < s1; i++) {
        if (rows[i].hr >= sp.peak - 2 && rows[i].hr >= threshold) {
          peakIdx = i;
          break;
        }
      }
      if (peakIdx < 0) return;
      for (var j = peakIdx + 1; j < Math.min(rows.length, peakIdx + 300); j++) {
        if (rows[j].hr <= threshold) {
          decays.push(j - peakIdx);
          break;
        }
      }
    });
    if (!decays.length) return null;
    var mean = +(
      decays.reduce(function (a, b) {
        return a + b;
      }, 0) / decays.length
    ).toFixed(1);
    return { spikeDecayMeanS: mean, spikeDecayCount: decays.length, spikeDecayLabel: mean > 120 ? 'Prolonged (SNS load)' : mean > 60 ? 'Moderate' : 'Fast (<60s)' };
  }

  // ── K. Post-Spike HR Undershoot ───────────────────────────────────
  function computeSpikeUndershoot(rows, spikes) {
    if (!spikes || !spikes.length) return null;
    var undershoots = [];
    spikes.forEach(function (sp) {
      if (!sp || sp.baseline == null || sp.peak == null) return;
      var peakIdx = -1;
      // Search near spike timestamp to avoid matching wrong spike
      var startHr1 = rows.length > 0 ? rows[0].t.getUTCHours() * 60 + rows[0].t.getUTCMinutes() + rows[0].t.getUTCSeconds() / 60 : 0;
      var apxIdx1 = Math.round(((sp.mfm || 0) - startHr1) * 60);
      var u0 = Math.max(0, apxIdx1 - 300),
        u1 = Math.min(rows.length, apxIdx1 + 300);
      for (var i = u0; i < u1; i++) {
        if (rows[i].hr >= sp.peak - 2) {
          peakIdx = i;
          break;
        }
      }
      if (peakIdx < 0) return;
      var recIdx = peakIdx;
      for (var j = peakIdx + 1; j < Math.min(rows.length, peakIdx + 200); j++) {
        if (rows[j].hr <= sp.baseline + 1) {
          recIdx = j;
          break;
        }
      }
      var postSeg = rows.slice(recIdx + 60, Math.min(rows.length, recIdx + 120));
      if (postSeg.length < 20) return;
      var postMean =
        postSeg.reduce(function (a, r) {
          return a + r.hr;
        }, 0) / postSeg.length;
      var us = +(sp.baseline - postMean).toFixed(1);
      if (us > 0) undershoots.push(us);
    });
    if (!undershoots.length) return null;
    var mean = +(
      undershoots.reduce(function (a, b) {
        return a + b;
      }, 0) / undershoots.length
    ).toFixed(1);
    return { spikeUndershootMean: mean, spikeUndershootCount: undershoots.length, spikeUndershootLabel: mean > 4 ? 'Strong vagal rebound' : mean > 2 ? 'Moderate' : 'Weak (<2 bpm)' };
  }

  // ── L. Spike Rise Rate ────────────────────────────────────────────
  function computeSpikeRiseRate(spikes) {
    if (!spikes || !spikes.length) return null;
    var rates = [];
    spikes.forEach(function (sp) {
      if (!sp || sp.baseline == null || sp.peak == null || !sp.duration) return;
      var rise = sp.peak - sp.baseline;
      // sp.duration = seconds above 75 bpm threshold (sustain time, not rise time)
      // Use fixed 12s rise window (detectSpikes uses 12-sample window for peak detection)
      if (rise > 0) rates.push(+(rise / 12).toFixed(2)); // bpm/s over ~12s detection window
    });
    if (!rates.length) return null;
    var mean = +(
      rates.reduce(function (a, b) {
        return a + b;
      }, 0) / rates.length
    ).toFixed(2);
    return { spikeRiseRate: mean, spikeRiseLabel: mean > 5 ? 'Abrupt (>5 bpm/s)' : mean > 2 ? 'Moderate' : 'Gradual (<2 bpm/s)' };
  }

  // ── M. Data Gap Detection ─────────────────────────────────────────
  // A step longer than this is MISSING TIME, not a sample interval. The O2Ring samples at 1 Hz, so
  // two seconds is one skipped sample — loose enough that ordinary jitter never trips it. Named
  // because `computeDataGaps` (the QC lane) and `oxyCoverage` (the export block) must agree: a hole
  // one calls a gap and the other counts as recorded time is a contradiction the export would publish.
  var GAP_STEP_SEC = 2;
  function computeDataGaps(rows) {
    var n = rows.length;
    if (n < 2) return null;
    var gaps = [],
      maxGap = 0;
    for (var i = 1; i < n; i++) {
      var dt = rows[i].t != null && rows[i - 1].t != null ? (rows[i].t - rows[i - 1].t) / 1000 : 0;
      if (dt > GAP_STEP_SEC) {
        gaps.push(dt);
        if (dt > maxGap) maxGap = dt;
      }
    }
    var totalGap = gaps.reduce(function (a, b) {
      return a + b;
    }, 0);
    // DEEP-AUDIT-II §2.3 — gapPct is a fraction of TIME, so both sides must be seconds.
    // This divided gap SECONDS by a SAMPLE COUNT, which only looks right because the O2Ring
    // samples at exactly 1 Hz (n samples ≈ n seconds). At any other cadence the ratio is
    // scaled by fs, and because the denominator counted only RECORDED samples while the
    // numerator counted MISSING time, the result was biased high and unbounded above 100 %
    // (a true 25 % read 33.4 %). Denominator is now the wall-clock span the recording covers
    // — recorded time PLUS the gaps in it — so the value is a genuine percentage in [0,100].
    // It is rendered, via the generic auto-walk in oxydex-fusion.js.
    var _spanSec = rows[n - 1].t != null && rows[0].t != null ? (rows[n - 1].t - rows[0].t) / 1000 : 0;
    if (!(_spanSec > 0)) _spanSec = n + totalGap; // stampless fallback: 1 Hz assumption, made explicit
    return {
      gapCount: gaps.length,
      maxGapSec: +maxGap.toFixed(0),
      gapPct: +Math.min(100, (totalGap / _spanSec) * 100).toFixed(1),
      gapLabel: maxGap > 120 ? 'Significant gap (>2min)' : maxGap > 10 ? 'Minor gaps' : 'Clean'
    };
  }

  /* recording.coverage for an oximetry night — INTEGRATOR-GAP-AWARE-OVERLAP part 2.
     `computeDataGaps` has always FOUND these holes; it reported them as a QC percentage and threw the
     positions away. The Integrator needs the positions: `durationMin` is the envelope, and dividing a
     confirmed apnea count by an envelope that contains an hour of missing oximetry overstates the
     denominator and understates the index. Same rows, same threshold, one extra product.

     Null when the night is contiguous — the common case, and the one that keeps every clean export
     byte-identical. */
  function oxyCoverage(rows, t0Ms) {
    if (!rows || rows.length < 2) return null;
    var segs = [],
      segStart = null,
      prev = null;
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i] && rows[i].t;
      if (t == null || !isFinite(t)) continue;
      if (segStart === null) segStart = t;
      else if ((t - prev) / 1000 > GAP_STEP_SEC) {
        segs.push([segStart, prev]);
        segStart = t;
      }
      prev = t;
    }
    if (segStart !== null && prev !== null) segs.push([segStart, prev]);
    if (segs.length < 2) return null; // contiguous ⇒ no claim to make (DexExport contract)
    // t0Ms is the night's anchor; the rows already carry absolute floating ms, so it is only a guard
    // against a stampless night reaching us — one that cannot be placed on a clock cannot declare
    // coverage on one either.
    if (t0Ms == null || !isFinite(t0Ms)) return null;
    return typeof DexExport !== 'undefined' && DexExport && DexExport.coverageFromSegments ? DexExport.coverageFromSegments(segs, { source: 'sensor-dropout' }) : null;
  }

  // ── N. HR Flatline Runs ───────────────────────────────────────────
  function computeHRFlatlines(rows) {
    var n = rows.length;
    if (n < 60) return null;
    var flatCount = 0,
      maxFlat = 0,
      run = 1;
    for (var i = 1; i < n; i++) {
      if (rows[i].hr === rows[i - 1].hr) {
        run++;
      } else {
        if (run >= 30) {
          flatCount++;
          if (run > maxFlat) maxFlat = run;
        }
        run = 1;
      }
    }
    if (run >= 30) {
      flatCount++;
      if (run > maxFlat) maxFlat = run;
    }
    return { flatlineCount: flatCount, maxFlatlineSec: maxFlat, flatlineLabel: flatCount > 5 ? 'Frequent (firmware artifact)' : flatCount > 0 ? 'Occasional' : 'None' };
  }

  // ── O. SpO2 Ceiling Artifact ──────────────────────────────────────
  function computeSpO2Ceiling(rows) {
    var n = rows.length;
    if (n < 60) return null;
    var ceilingRuns = 0,
      maxCeil = 0,
      totalCeilSec = 0,
      run = 0;
    for (var i = 0; i < n; i++) {
      if (rows[i].spo2 >= 99) {
        run++;
      } else {
        if (run >= 5) {
          ceilingRuns++;
          if (run > maxCeil) maxCeil = run;
          totalCeilSec += run;
        }
        run = 0;
      }
    }
    if (run >= 5) {
      ceilingRuns++;
      if (run > maxCeil) maxCeil = run;
      totalCeilSec += run;
    }
    // ceilingPct derived from runs only (not scattered samples) so pct and label agree
    return {
      ceilingRuns: ceilingRuns,
      maxCeilingSec: maxCeil,
      ceilingPct: +((totalCeilSec / n) * 100).toFixed(1),
      ceilingLabel: ceilingRuns > 3 ? 'Sensor lift likely' : ceilingRuns > 0 ? 'Occasional' : 'None'
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // v20.7: 18 NEW METRICS — all derivable from SpO2 / HR / Motion 1Hz
  // ═══════════════════════════════════════════════════════════════════

  // ── 1. ODRI: Oxygen Desaturation Regularity Index ────────────────
  // ODI3/ODI1 — ratio → 1.0 = nearly all dips ≥3% = CS/PB signature
  function computeODRI(odi1, odi3) {
    if (!odi1 || !odi3) return null;
    var r1 = (odi1.rate != null ? odi1.rate : odi1.odi1Rate) || 0;
    var r3 = (odi3.rate != null ? odi3.rate : odi3.odi3Rate) || 0;
    if (r1 === 0) return null;
    var odri = +(r3 / r1).toFixed(3);
    return { odri: odri, odriLabel: odri > 0.85 ? 'High (CS/PB pattern)' : odri > 0.6 ? 'Moderate' : 'Low (mixed/OA)' };
  }

  // ── 2. SpO2 Percentile Distribution (p5,p10,p25,p75) ────────────
  function computeSpO2Percentiles(rows) {
    var n = rows.length;
    if (n < 60) return null;
    var sorted = rows
      .map(function (r) {
        return r.spo2;
      })
      .slice()
      .sort(function (a, b) {
        return a - b;
      });
    function pct(p) {
      return sorted[Math.floor((p / 100) * (n - 1))];
    }
    return { spo2P5: pct(5), spo2P10: pct(10), spo2P25: pct(25), spo2P75: pct(75), spo2P90: pct(90), spo2IQR: pct(75) - pct(25) };
  }

  // ── 3. SpO2 Histogram Kurtosis & Skewness ─────────────────────────
  function computeSpO2Shape(rows) {
    var n = rows.length;
    if (n < 60) return null;
    var s = rows.map(function (r) {
      return r.spo2;
    });
    var mean =
      s.reduce(function (a, b) {
        return a + b;
      }, 0) / n;
    var m2 = 0,
      m3 = 0,
      m4 = 0;
    for (var i = 0; i < n; i++) {
      var d = s[i] - mean;
      m2 += d * d;
      m3 += d * d * d;
      m4 += d * d * d * d;
    }
    m2 /= n;
    m3 /= n;
    m4 /= n;
    var sd = Math.sqrt(m2);
    if (sd === 0) return null;
    var skew = +(m3 / (sd * sd * sd)).toFixed(3);
    var kurt = +(m4 / (m2 * m2)).toFixed(3); // excess kurtosis = kurt - 3
    var excessKurt = +(kurt - 3).toFixed(3);
    return {
      spo2Mean: isFinite(mean) ? +mean.toFixed(2) : 0,
      spo2SD: isFinite(sd) ? +sd.toFixed(2) : 0,
      spo2Skew: skew,
      spo2Kurt: kurt,
      spo2ExcessKurt: excessKurt,
      spo2SkewLabel: skew < -0.5 ? 'Left-skewed (hypox burden)' : skew > 0.5 ? 'Right-skewed' : 'Near-symmetric',
      spo2KurtLabel: excessKurt > 2 ? 'Leptokurtic (heavy tails/events)' : excessKurt < 0 ? 'Platykurtic' : 'Normal-ish'
    };
  }

  // ── 4. HR Coefficient of Variation ────────────────────────────────
  function computeHRCV(rows) {
    var n = rows.length;
    if (n < 60) return null;
    var hr = rows.map(function (r) {
      return r.hr;
    });
    var mean =
      hr.reduce(function (a, b) {
        return a + b;
      }, 0) / n;
    if (mean === 0) return null;
    var sd = Math.sqrt(
      hr.reduce(function (a, b) {
        return a + (b - mean) * (b - mean);
      }, 0) / n
    );
    if (!mean || mean <= 0) return null;
    var cv = isFinite(sd / mean) ? +((sd / mean) * 100).toFixed(2) : 0;
    return { hrCV: cv, hrCVmean: +mean.toFixed(1), hrCVsd: +sd.toFixed(2), hrCVlabel: cv > 12 ? 'High variability' : cv > 6 ? 'Moderate' : 'Low (<6%)' };
  }

  // ── 5. Hypoxic Dose + Desaturation AUC ────────────────────────────
  // HD = Σ(94-SpO2) per second below 94%   [Lévy 2022]
  // AUC = Σ(baseline-SpO2) per second during each event
  function computeHypoxicDose(rows) {
    var n = rows.length;
    if (n < 60) return null;
    var WIN = 300;
    var hd94 = 0,
      hd90 = 0,
      hd88 = 0,
      auc = 0;
    // O(n) sliding window for AUC baseline (rows[max(0,i-WIN)..i-1])
    var winSum = 0,
      winLen = 0;
    for (var i = 0; i < n; i++) {
      if (i > 0) {
        winSum += rows[i - 1].spo2;
        winLen++;
      }
      if (i > WIN) {
        winSum -= rows[i - WIN - 1].spo2;
        winLen--;
      }
      var v = rows[i].spo2;
      if (v < 94) hd94 += 94 - v;
      if (v < 90) hd90 += 90 - v;
      if (v < 88) hd88 += 88 - v;
      if (winLen > 0) {
        var base = winSum / winLen;
        if (v < base - 1) auc += base - v;
      }
    }
    var durationHr = n / 3600;
    return {
      hd94: +hd94.toFixed(0),
      hd90: +hd90.toFixed(0),
      hd88: +hd88.toFixed(0),
      hd94PerHr: durationHr > 0 ? +(hd94 / durationHr).toFixed(1) : 0,
      desatAUC: +auc.toFixed(0),
      hd94Label: (durationHr > 0 ? hd94 / durationHr : 0) > 200 ? 'High (>200/hr)' : (durationHr > 0 ? hd94 / durationHr : 0) > 60 ? 'Moderate' : 'Low (<60/hr)'
    };
  }

  // ── 6. T88 / T85 ──────────────────────────────────────────────────
  function computeT88T85(rows) {
    var n = rows.length;
    if (n < 60) return null;
    var t88 = rows.filter(function (r) {
      return r.spo2 < 88;
    }).length;
    var t85 = rows.filter(function (r) {
      return r.spo2 < 85;
    }).length;
    var durationHr = n / 3600;
    return {
      t88Sec: t88,
      t88Min: +(t88 / 60).toFixed(1),
      t88Pct: +((t88 / n) * 100).toFixed(2),
      t85Sec: t85,
      t85Min: +(t85 / 60).toFixed(1),
      t85Pct: +((t85 / n) * 100).toFixed(2),
      t88Label: (t88 / n) * 100 > 1 ? 'Severe hypoxemia (>1%)' : (t88 / n) * 100 > 0 ? 'Present' : 'None'
    };
  }

  // ── 7. Longest Continuous Still Period (LCSP) ─────────────────────
  function computeLCSP(rows) {
    var n = rows.length;
    if (n < 60) return null;
    var maxRun = 0,
      run = 0,
      startMax = 0,
      startCur = 0;
    for (var i = 0; i < n; i++) {
      if (rows[i].motion === 0) {
        if (run === 0) startCur = i;
        run++;
        if (run > maxRun) {
          maxRun = run;
          startMax = startCur;
        }
      } else {
        run = 0;
      }
    }
    var lcspMin = +(maxRun / 60).toFixed(1);
    var lcspStartMin = +(startMax / 60).toFixed(0);
    return {
      lcspSec: maxRun,
      lcspMin: lcspMin,
      lcspStartMin: lcspStartMin,
      lcspLabel: lcspMin < 20 ? 'Severely fragmented (<20min)' : lcspMin < 45 ? 'Fragmented (<45min)' : lcspMin < 90 ? 'Moderate' : 'Good (≥90min)'
    };
  }

  // ── 8. Poincaré SD1 / SD2 ─────────────────────────────────────────
  // SD1=short-term (parasympathetic), SD2=long-term (sympathetic)
  function computePoincareSD(rows) {
    var n = rows.length;
    if (n < 120) return null;
    var hr = rows
      .filter(function (r) {
        return r.motion === 0;
      })
      .map(function (r) {
        return r.hr;
      });
    var m = hr.length;
    if (m < 60) return null;
    // SD1 = sqrt(0.5 * RMSSD²), SD2 = sqrt(2*SDNN² - 0.5*RMSSD²)  [standard Poincaré formulas]
    var hMean =
      hr.reduce(function (a, b) {
        return a + b;
      }, 0) / m;
    var hVar =
      hr.reduce(function (a, b) {
        return a + (b - hMean) * (b - hMean);
      }, 0) / m;
    // SD1 = sqrt(0.5 * RMSSD²), SD2 = sqrt(2*SDNN² - 0.5*RMSSD²)
    var rmssd2 =
      hr.slice(0, m - 1).reduce(function (a, v, i) {
        return a + (hr[i + 1] - v) * (hr[i + 1] - v);
      }, 0) /
      (m - 1);
    var sdnn2 = hVar;
    var sd1 = +Math.sqrt(0.5 * rmssd2).toFixed(2);
    var sd2 = +Math.sqrt(Math.max(0, 2 * sdnn2 - 0.5 * rmssd2)).toFixed(2);
    var ratio = sd2 > 0 ? +(sd1 / sd2).toFixed(3) : null;
    return {
      sd1: sd1,
      sd2: sd2,
      sd1sd2Ratio: ratio,
      // 1Hz proxy thresholds in bpm (not ms); sd1≈RMSSD/√2 ≈ 0.3-0.6 bpm typical
      sd1Label: sd1 < 0.4 ? 'Low (1Hz proxy)' : sd1 > 1.0 ? 'High (1Hz proxy)' : 'Normal (1Hz proxy)',
      sd2Label: sd2 < 2 ? 'Low sympathetic modulation (1Hz proxy)' : 'Normal (1Hz proxy)'
    };
  }

  // ── 9. SpO2 → HR Response Efficiency ─────────────────────────────
  // Per desat event: HR rise / SpO2 drop magnitude. Low = blunted arousal
  function computeO2HREfficiency(rows, desat) {
    if (!desat || !desat.events || !desat.events.length) return null;
    var ratios = [];
    desat.events.forEach(function (ev) {
      if (!ev || ev.depth == null || ev.depth <= 0) return;
      // Find HR change in 30s after nadir index
      var nadirIdx = ev.nadirIdx != null ? ev.nadirIdx : -1;
      if (nadirIdx < 0 || nadirIdx >= rows.length) return;
      // preHR: mean of 10s window before nadir (more robust than single sample)
      var preStart = Math.max(0, nadirIdx - 10),
        preCnt = 0,
        preSum = 0;
      for (var j = preStart; j < nadirIdx; j++) {
        preSum += rows[j].hr;
        preCnt++;
      }
      var preHR = preCnt > 0 ? preSum / preCnt : rows[Math.max(0, nadirIdx - 1)].hr;
      // postHR: mean 5-35s after nadir (skip nadir itself to avoid including trough)
      var postEnd = Math.min(rows.length, nadirIdx + 35);
      var postHR = 0,
        cnt = 0;
      for (var j = Math.min(rows.length - 1, nadirIdx + 5); j < postEnd; j++) {
        postHR += rows[j].hr;
        cnt++;
      }
      if (cnt === 0) return;
      postHR /= cnt;
      var hrRise = Math.max(0, postHR - preHR);
      var ratio = +(hrRise / ev.depth).toFixed(2);
      ratios.push(ratio);
    });
    if (!ratios.length) return null;
    var mean = +(
      ratios.reduce(function (a, b) {
        return a + b;
      }, 0) / ratios.length
    ).toFixed(2);
    var min_ = +Math.min.apply(null, ratios).toFixed(2);
    var max_ = +Math.max.apply(null, ratios).toFixed(2);
    return { o2hrEff: mean, o2hrEffMin: min_, o2hrEffMax: max_, o2hrEffN: ratios.length, o2hrEffLabel: mean < 0.3 ? 'Blunted arousal response' : mean < 0.8 ? 'Moderate' : 'Robust response' };
  }

  // ── 10. Conditional SpO2 Mean (motion vs no-motion) ──────────────
  function computeConditionalSpO2(rows) {
    var n = rows.length;
    if (n < 60) return null;
    var still = rows.filter(function (r) {
      return r.motion === 0;
    });
    var moving = rows.filter(function (r) {
      return r.motion > 0;
    });
    if (!still.length) return null;
    var meanStill = +(
      still.reduce(function (a, r) {
        return a + r.spo2;
      }, 0) / still.length
    ).toFixed(2);
    var meanMoving = moving.length
      ? +(
          moving.reduce(function (a, r) {
            return a + r.spo2;
          }, 0) / moving.length
        ).toFixed(2)
      : null;
    var delta = meanMoving !== null ? +(meanStill - meanMoving).toFixed(2) : null;
    return {
      spo2StillMean: meanStill,
      spo2MovingMean: meanMoving,
      spo2MotionDelta: delta,
      stillPct: +((still.length / n) * 100).toFixed(1),
      // delta = stillMean - movingMean: positive → rest has higher SpO2 → motion creates artifact
      motionArtifactLabel:
        delta !== null && delta > 1 ? 'Motion artifact likely (SpO2 lower during movement)' : delta !== null && delta < -1 ? 'True apnea pattern (SpO2 worse at rest)' : 'No significant difference'
    };
  }

  // ── 11. SpO2 Nadir Trend Across Night ────────────────────────────
  // Linear regression of sequential event nadir SpO2 values
  function computeNadirTrend(desat) {
    if (!desat || !desat.events || desat.events.length < 4) return null;
    var nadirs = desat.events
      .filter(function (ev) {
        return ev && ev.nadir != null;
      })
      .map(function (ev) {
        return ev.nadir;
      });
    if (nadirs.length < 4) return null;
    var lr = linReg(nadirs);
    var dir = lr.slope < -0.005 ? 'Worsening (REM-load)' : lr.slope > 0.005 ? 'Improving across night' : 'Stable';
    return { nadirTrendSlope: lr.slope, nadirTrendR2: lr.r2, nadirTrendN: nadirs.length, nadirTrendLabel: dir };
  }

  // ── 12. Desaturation Inter-Event Interval (IEI) ───────────────────
  function computeIEI(desat) {
    if (!desat || !desat.events || desat.events.length < 3) return null;
    var events = desat.events.filter(function (ev) {
      return ev && ev.startIdx != null;
    });
    if (events.length < 3) return null;
    var intervals = [];
    for (var i = 1; i < events.length; i++) {
      var gap = events[i].startIdx - (events[i - 1].startIdx + (events[i - 1].duration || 0));
      if (gap > 0) intervals.push(gap);
    }
    if (!intervals.length) return null;
    var mean =
      intervals.reduce(function (a, b) {
        return a + b;
      }, 0) / intervals.length;
    var sd = Math.sqrt(
      intervals.reduce(function (a, b) {
        return a + (b - mean) * (b - mean);
      }, 0) / intervals.length
    );
    var cv = mean > 0 ? +(sd / mean).toFixed(2) : null;
    return {
      ieiMeanSec: +mean.toFixed(1),
      ieiSDsec: +sd.toFixed(1),
      ieiCV: cv,
      ieiLabel: cv !== null && cv < 0.3 ? 'Regular (PB/CS pattern)' : cv !== null && cv > 0.8 ? 'Highly variable (OA/mixed)' : 'Moderate variability'
    };
  }

  // ── 13. Recovery Slope CV (consistency of arousal) ───────────────
  function computeRecoverySlopeCV(desat) {
    if (!desat || !desat.events || desat.events.length < 4) return null;
    var slopes = desat.events
      .filter(function (ev) {
        return ev && ev.recoverySlope != null && ev.recoverySlope > 0;
      })
      .map(function (ev) {
        return ev.recoverySlope;
      });
    if (slopes.length < 4) return null;
    var mean = slopes.length
      ? slopes.reduce(function (a, b) {
          return a + b;
        }, 0) / slopes.length
      : 0;
    if (mean === 0) return null;
    var sd = slopes.length
      ? Math.sqrt(
          slopes.reduce(function (a, b) {
            return a + (b - mean) * (b - mean);
          }, 0) / slopes.length
        )
      : 0;
    var cv = +(sd / mean).toFixed(3);
    return {
      recovSlopeMean: +mean.toFixed(3),
      recovSlopeSD: +sd.toFixed(3),
      recovSlopeCV: cv,
      recovSlopeCVlabel: cv > 0.6 ? 'High variability (inconsistent arousal)' : cv > 0.3 ? 'Moderate' : 'Consistent arousal'
    };
  }

  // ── 14. HR Nadir Clock Time ───────────────────────────────────────
  function computeHRNadirTime(rows) {
    var n = rows.length;
    if (n <= 600) return null; // need n > 2*WIN(=600) for ≥1 centered window — at n==600 the
    // loop ran zero times and minHR stayed Infinity (leaked to output)
    var WIN = 300;
    var minHR = Infinity,
      minIdx = WIN;
    // O(n) centered sliding window sum over [i-WIN..i+WIN]
    var wSum = 0,
      wCnt = 0;
    // Prime: load initial window for i=WIN (covers [0..2*WIN])
    for (var j = 0; j <= 2 * WIN && j < n; j++) {
      wSum += rows[j].hr;
      wCnt++;
    }
    for (var i = WIN; i < n - WIN; i++) {
      var m = wCnt > 0 ? wSum / wCnt : rows[i].hr;
      if (m < minHR) {
        minHR = m;
        minIdx = i;
      }
      // Advance window: add right edge rows[i+WIN+1], remove left edge rows[i-WIN]
      if (i + WIN + 1 < n) {
        wSum += rows[i + WIN + 1].hr;
        wCnt++;
      }
      if (i - WIN >= 0) {
        wSum -= rows[i - WIN].hr;
        wCnt--;
      }
    }
    var nadirMinFromStart = +(minIdx / 60).toFixed(0);
    var nadirFracOfNight = +(minIdx / n).toFixed(2);
    return {
      hrNadirMinFromStart: nadirMinFromStart,
      hrNadirFrac: nadirFracOfNight,
      hrNadirSmoothed: isFinite(minHR) ? +minHR.toFixed(1) : null,
      hrNadirLabel: nadirFracOfNight < 0.25 ? 'Early nadir (good alignment)' : nadirFracOfNight > 0.6 ? 'Late nadir (fragmented/REM)' : 'Mid-night (normal)'
    };
  }

  // ── 15. SpO2 Nadir Clock Time ─────────────────────────────────────
  function computeSpO2NadirTime(rows, desat) {
    var n = rows.length;
    if (n < 600 || !desat || !desat.events || !desat.events.length) return null;
    // Find worst event by nadir
    var worst = desat.events.reduce(function (a, b) {
      if (!a) return b;
      if (!b) return a;
      return (a.nadir || 99) < (b.nadir || 99) ? a : b;
    }, null);
    if (!worst || worst.nadirIdx == null) return null;
    var frac = +(worst.nadirIdx / n).toFixed(2);
    var minFromStart = +(worst.nadirIdx / 60).toFixed(0);
    return {
      spo2NadirMinFromStart: minFromStart,
      spo2NadirFrac: frac,
      spo2NadirValue: worst.nadir,
      spo2NadirLabel: frac > 0.65 ? 'Late-night worst (REM-predominant)' : frac < 0.3 ? 'Early worst (supine/onset)' : 'Mid-night'
    };
  }

  // ── 16. RMSSD Arc (per-30min windows) ────────────────────────────
  function computeRMSSDarc(rows) {
    var n = rows.length;
    if (n < 1800) return null;
    var WIN = 1800; // 30-min windows
    var windows = [];
    for (var i = 0; i + WIN <= n; i += WIN) {
      var seg = rows.slice(i, i + WIN).filter(function (r) {
        return r.motion === 0;
      });
      if (seg.length < 60) {
        windows.push(null);
        continue;
      }
      var hr = seg.map(function (r) {
        return r.hr;
      });
      var m2 = hr.length;
      var rmssd2 =
        hr.slice(0, m2 - 1).reduce(function (a, v, j) {
          return a + (hr[j + 1] - v) * (hr[j + 1] - v);
        }, 0) /
        (m2 - 1);
      windows.push(+Math.sqrt(rmssd2).toFixed(1));
    }
    // Build {x, y} pairs using actual window positions (not filtered indices) to preserve time axis
    var validXY = windows
      .map(function (v, i) {
        return v !== null ? { x: i, y: v } : null;
      })
      .filter(function (p) {
        return p !== null;
      });
    var valid = validXY.map(function (p) {
      return p.y;
    });
    if (valid.length < 2) return null;
    var lr = linReg(
      validXY.map(function (p) {
        return p.x;
      }),
      validXY.map(function (p) {
        return p.y;
      })
    );
    var firstHalf = valid.slice(0, Math.floor(valid.length / 2));
    var lastHalf = valid.slice(Math.floor(valid.length / 2));
    var mFirst = +(
      firstHalf.reduce(function (a, b) {
        return a + b;
      }, 0) / firstHalf.length
    ).toFixed(1);
    var mLast = +(
      lastHalf.reduce(function (a, b) {
        return a + b;
      }, 0) / lastHalf.length
    ).toFixed(1);
    return {
      rmssdArcWindows: windows,
      rmssdArcSlope: lr.slope,
      rmssdArcR2: lr.r2,
      rmssdFirstHalf: mFirst,
      rmssdLastHalf: mLast,
      rmssdArcDelta: +(mLast - mFirst).toFixed(1),
      rmssdArcLabel: lr.slope < -0.2 ? 'Declining (REM/arousal load)' : lr.slope > 0.2 ? 'Rising (recovery/deep sleep)' : 'Flat'
    };
  }

  // ── 17. HR 50% Recovery Time Post-Spike ──────────────────────────
  function computeSpike50PctRecovery(rows, spikes) {
    if (!spikes || !spikes.length) return null;
    var times = [];
    spikes.forEach(function (sp) {
      if (!sp || sp.baseline == null || sp.peak == null) return;
      var amplitude = sp.peak - sp.baseline;
      if (amplitude <= 0) return;
      var halfTarget = sp.baseline + amplitude * 0.5;
      var peakIdx = -1;
      // Find peak near the spike timestamp (search within ±5min of spike time)
      var spMfm = sp.mfm || 0;
      var startHr = rows.length > 0 ? rows[0].t.getUTCHours() * 60 + rows[0].t.getUTCMinutes() + rows[0].t.getUTCSeconds() / 60 : 0;
      var approxIdx = Math.round((spMfm - startHr) * 60);
      var searchStart = Math.max(0, approxIdx - 300);
      var searchEnd = Math.min(rows.length, approxIdx + 300);
      for (var i = searchStart; i < searchEnd; i++) {
        if (rows[i].hr >= sp.peak - 2) {
          peakIdx = i;
          break;
        }
      }
      if (peakIdx < 0) return;
      for (var j = peakIdx + 1; j < Math.min(rows.length, peakIdx + 180); j++) {
        if (rows[j].hr <= halfTarget) {
          times.push(j - peakIdx);
          break;
        }
      }
    });
    if (!times.length) return null;
    var mean = +(
      times.reduce(function (a, b) {
        return a + b;
      }, 0) / times.length
    ).toFixed(1);
    return { spike50PctRecovSec: mean, spike50PctRecovN: times.length, spike50PctLabel: mean > 60 ? 'Slow (sympathetic persistence)' : mean > 30 ? 'Moderate' : 'Fast (<30s, good vagal)' };
  }

  // ── 18. REM-Proxy & NREM-Deep Proxy Windows ──────────────────────
  function computeSleepStageProxy(rows) {
    var n = rows.length;
    if (n < 1800) return null;
    var WIN = 120; // 2-min windows
    var hrAll = rows.map(function (r) {
      return r.hr;
    });
    var hrMean =
      hrAll.reduce(function (a, b) {
        return a + b;
      }, 0) / n;
    var remSec = 0,
      nremDeepSec = 0;
    for (var i = WIN; i < n - WIN; i += WIN) {
      var seg = rows.slice(i, i + WIN);
      var still = seg.every(function (r) {
        return r.motion === 0;
      });
      if (!still) continue;
      var hr = seg.map(function (r) {
        return r.hr;
      });
      var segMean =
        hr.reduce(function (a, b) {
          return a + b;
        }, 0) / WIN;
      var segSD = Math.sqrt(
        hr.reduce(function (a, b) {
          return a + (b - segMean) * (b - segMean);
        }, 0) / WIN
      );
      // NREM deep proxy (evaluated first for mutual exclusion): low motion, HR well below mean
      if (segSD < 4 && segMean < hrMean - 6) {
        nremDeepSec += WIN;
      }
      // REM proxy: low motion, low SD, HR near mean (explicitly exclude NREM-Deep windows)
      else if (segSD < 3 && segMean > hrMean - 5 && segMean < hrMean + 5) remSec += WIN;
    }
    /* PLAUSIBILITY GATE (DEEP-AUDIT-2026-07-11 §7).
       These criteria ("still + low HR SD + HR near the night mean") describe the bulk of quiet sleep, not
       REM — REM shows INCREASED heart-rate variability. On the committed corpus the proxy therefore fires
       on most of the night: all 39 real O2Ring nights return 39.6–87.8 % "REM" (median 77.5 %), against a
       physiological norm of ~20–25 %. Every one of them used to render as KPI colour "good" and be exported
       to the Integrator as a comparable single-signal estimate.
       Re-deriving an oximetry REM detector is research, not an audit fix. What the node MUST NOT do is
       assert an impossible number as a healthy finding: past the ceiling, the estimator has failed, and the
       output is reported as IMPLAUSIBLE rather than as a high-REM night. This is the node-side half of
       INTEGRATOR-FUSION-ISSUES §T2 — which was marked ✅ but only ever shipped the Integrator half, so a
       STANDALONE OxyDex user (the common case — every Dex runs alone) saw the bare number with nothing to
       disagree with it. */
    var REM_CEILING_PCT = 30; // adult REM ≈ 20–25 % of sleep; >30 % of the RECORDING is not physiological
    var remPct = +((remSec / n) * 100).toFixed(1);
    var deepPct = +((nremDeepSec / n) * 100).toFixed(1);
    var remPlausible = remPct <= REM_CEILING_PCT;
    return {
      remProxySec: remSec,
      remProxyMin: +(remSec / 60).toFixed(0),
      remProxyPct: remPct,
      nremDeepSec: nremDeepSec,
      nremDeepMin: +(nremDeepSec / 60).toFixed(0),
      nremDeepPct: deepPct,
      // the honest self-assessment the Integrator (and a standalone user) can read
      plausible: remPlausible,
      plausibilityNote: remPlausible
        ? null
        : 'REM proxy implausible (' + remPct + '% of the recording; physiological ≈20–25%) — the HR-stability estimator over-fires on quiet sleep. Not a high-REM night; treat as unreliable.',
      remProxyLabel: !remPlausible ? 'Implausible — estimator unreliable' : remSec / 60 < 45 ? 'Low REM estimate (<45min)' : remSec / 60 > 90 ? 'High REM estimate (>90min)' : 'Normal',
      nremDeepLabel: nremDeepSec / 60 < 30 ? 'Low deep sleep estimate' : nremDeepSec / 60 > 90 ? 'Good deep sleep estimate' : 'Moderate'
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // v20.7 EXTENSION: VO2max Estimate + BP Projection
  // ═══════════════════════════════════════════════════════════════════
  // Both are ESTIMATES from surrogate markers — not clinical measurements.
  // For informational / trend-tracking only. Consult a physician for
  // clinical interpretation.

  // ── computeVO2maxEstimate ─────────────────────────────────────────
  // Inputs: hrFloor (nocturnal HR min, proxy for HRrest),
  //         maxHr (nocturnal max, less reliable than exercise HRmax),
  //         dfa (DFA α1), rmssd, age (optional, defaults 45)
  // Formula: Uth-Sørensen (2004): VO2max = 15.3 × (HRmax/HRrest)
  // Confidence: high if HRfloor plausible (40-65), low if maxHr noisy
  function computeVO2maxEstimate(rows, hrv, dfa, hrNadirT, age) {
    if (!hrv) return null;
    var n = rows.length;
    if (n < 1800) return null; // need ≥1hr recording

    age = age || 49; // default to space profile age

    // ── Step 1: HRrest proxy = nocturnal HR floor ──────────────────
    // Use 5th percentile of motion-free HR as proxy (more robust than absolute min)
    var stillHR = rows
      .filter(function (r) {
        return r.motion === 0 && r.hr > 30 && r.hr < 120;
      })
      .map(function (r) {
        return r.hr;
      })
      .sort(function (a, b) {
        return a - b;
      });
    if (stillHR.length < 60) return null;

    var p5idx = Math.floor(0.05 * stillHR.length);
    var hrRestNocturnal = stillHR[p5idx]; // 5th percentile nocturnal still HR
    // Prefer manually entered awake resting HR (more accurate for Uth-Sørensen)
    // Nocturnal HR underestimates true resting HR by ~10-15 bpm, inflating VO2max
    var hrRest = UP && UP.hrRestOverride && UP.hrRestOverride > 30 && UP.hrRestOverride < 100 ? UP.hrRestOverride : hrRestNocturnal;

    // Sanity gate: physiologically plausible HRrest
    if (hrRest < 30 || hrRest > 100) return null;

    // ── Step 2: HRmax estimate ─────────────────────────────────────
    // Tanaka 2001: HRmax = 208 - 0.7 × age  (SD ≈ 7 bpm)
    var hrMaxAge = Math.round(208 - 0.7 * age);

    // Nocturnal max is NOT exercise HRmax; use age formula as primary
    // but use nocturnal max as a floor check
    var hrMax = hrMaxAge; // age formula is more reliable
    var hrMaxSource = 'Age formula (Tanaka 2001)';

    // ── Step 3: VO2max — Uth-Sørensen formula ─────────────────────
    // VO2max (ml/kg/min) = 15.3 × (HRmax / HRrest)
    var vo2raw = hrRest && hrRest > 0 ? +(15.3 * (hrMax / hrRest)).toFixed(1) : 0;

    // ── Step 4: DFA α1 modifier ───────────────────────────────────
    // DFA α1 < 0.75 = aerobic training adaptation → small upward adj
    // DFA α1 > 1.0  = sedentary / high load → small downward adj
    var dfaAdj = 0;
    var dfaNote = 'DFA α1 computed on SpO₂ (not HR) — SpO₂ DFA is always >1.0 at short scales; HR-DFA sedentary thresholds do not apply. Adjustment disabled.';
    // NOTE: DFA adjustment removed — SpO₂ short-scale DFA is systematically >1.0
    // regardless of fitness; applying HR-DFA clinical thresholds here is a misapplication.

    // ── Step 5: RMSSD modifier ────────────────────────────────────
    // Higher RMSSD → higher parasympathetic tone → aerobically fitter
    // Regression: each 10ms RMSSD above 30ms adds ~0.5 VO2 unit (approximate)
    // NOTE: hrv.rmssd is a 1Hz proxy in bpm, NOT ms.
    // At sleep HR ~53 bpm: 1 bpm ≈ 21ms, so 30ms ≈ 1.4 bpm; 0.05/ms × 21ms/bpm ≈ 1.05/bpm
    var rmssdAdj = 0,
      rmssdNote = '';
    if (hrv.rmssd != null) {
      var rmssdDelta = hrv.rmssd - 1.4; // reference: 30ms ≈ 1.4 bpm at HR~53
      rmssdAdj = +(rmssdDelta * 1.05).toFixed(1); // 0.05/ms × ~21ms/bpm ≈ 1.05/bpm
      rmssdAdj = Math.max(-3, Math.min(3, rmssdAdj)); // cap ±3
      rmssdNote = 'RMSSD ' + hrv.rmssd + 'bpm (1Hz proxy) → adj ' + (rmssdAdj >= 0 ? '+' : '') + rmssdAdj;
    }

    var vo2est = +(vo2raw + dfaAdj + rmssdAdj).toFixed(1);

    // ── Step 6: Population percentile — age & sex adjusted (ACSM norms) ─
    var vo2Category, vo2Pct;
    // upVO2category lives in oxydex-profile.js (a UI sibling); it IS loaded in the standalone
    // bundle (so this stays byte-identical there). Guard it so the headless compute() path —
    // co-loaded WITHOUT the profile module (signal-orchestrate §3) — doesn't throw; vo2Category
    // then stays null, harmless because the whole vo2est block is profile-coupled + strip-listed.
    var _vc = _ui.upVO2category(vo2est); // uses UP.age and UP.sex
    if (_vc) {
      vo2Category = _vc.cat + ' (' + _vc.pct + ')';
      vo2Pct = _vc.pct;
    } else {
      vo2Category = 'Unknown';
      vo2Pct = '—';
    }

    // ── Step 7: Confidence score (0–100) ─────────────────────────
    var conf = 60; // base
    if (hrRest >= 40 && hrRest <= 65) conf += 15; // plausible resting HR
    if (stillHR.length > 3600) conf += 10; // long recording
    if (hrv.rmssd != null) conf += 10; // RMSSD available
    if (dfa && dfa.alpha1 != null) conf += 5; // DFA available
    conf = Math.min(100, conf);

    // ── Step 8: SEE and range ─────────────────────────────────────
    // Uth-Sørensen SEE: ±10.8 ml/kg/min general population; ±5.4 for trained athletes
    // Using 10.8 for conservative/honest confidence interval (Uth 2004, n=132 mixed fitness)
    // Nocturnal HRrest adds ~±2 additional uncertainty
    var see = 10.8; // general population SEE (trained athletes: 5.4)
    var vo2Low = +(vo2est - see).toFixed(1);
    var vo2High = +(vo2est + see).toFixed(1);

    return {
      vo2est: vo2est,
      vo2Low: vo2Low,
      vo2High: vo2High,
      vo2Category: vo2Category,
      vo2Pct: vo2Pct,
      vo2Conf: conf,
      hrRest: hrRest,
      hrMax: hrMax,
      hrMaxSource: hrMaxSource,
      see: see,
      dfaAdj: dfaAdj,
      dfaNote: dfaNote,
      rmssdAdj: rmssdAdj,
      rmssdNote: rmssdNote,
      formula: 'Uth-Sørensen 2004 (VO2max = 15.3 × HRmax/HRrest)',
      label: vo2est >= 42 ? 'Top-25% for age ' + age : vo2est >= 35 ? 'Above average' : vo2est >= 30 ? 'Average' : 'Below average',
      disclaimer: 'Surrogate estimate ±10.8 ml/kg/min SEE (general pop.) · ±5.4 for trained athletes. Trend tracking only.'
    };
  }

  // computeBPProjection REMOVED 2026-06-21 (external-review WP-A) — cuffless BP from
  // sleep oximetry is indefensible; bpProj is now hard-null. No caller remains.

  // ═══════════════════════════════════════════════════════════════════
  // computeKarvonenZones — Karvonen Heart Rate Reserve training zones
  // + Next-Day Training Readiness score derived from sleep quality
  // ═══════════════════════════════════════════════════════════════════
  // Karvonen formula: THR = (HRmax − HRrest) × %intensity + HRrest
  // HRmax via Tanaka 2001: 208 − 0.7 × age
  // HRrest: nocturnal 5th-percentile still HR (computed in VO2max fn)
  // Zone boundaries: American College of Sports Medicine (ACSM) 2022
  //   Z1 Recovery  50–60% HRR
  //   Z2 Base/Aerobic  60–70% HRR
  //   Z3 Tempo     70–80% HRR
  //   Z4 Threshold 80–90% HRR
  //   Z5 VO2max    90–100% HRR
  // Next-Day Readiness: composite of SpO2 quality, HRV, sleep duration,
  //   hypoxic load, RMSSD, and HR floor — scaled 0–100
  function computeKarvonenZones(rows, hrv, vo2est, odi4, hypDose, sleepArch, stageProxy, age, durationMinHint) {
    if (!hrv) return null;
    var n = rows ? rows.length : 0;
    // Only require rows if we can't get hrRest from profile override or stored vo2est
    var hasHrRestSource = (UP && UP.hrRestOverride && UP.hrRestOverride > 30 && UP.hrRestOverride < 100) || (vo2est && vo2est.hrRest);
    if (!hasHrRestSource && n < 3600) return null;

    age = age || 49;

    // ── HRrest: prefer manual entry, then vo2est, then recompute ──
    var hrRest;
    if (UP && UP.hrRestOverride && UP.hrRestOverride > 30 && UP.hrRestOverride < 100) {
      hrRest = UP.hrRestOverride; // manually entered awake resting HR
    } else if (vo2est && vo2est.hrRest) {
      hrRest = vo2est.hrRest;
    } else {
      if (!rows || rows.length < 60) return null;
      var stillHR = rows
        .filter(function (r) {
          return r.motion === 0 && r.hr > 30 && r.hr < 120;
        })
        .map(function (r) {
          return r.hr;
        })
        .sort(function (a, b) {
          return a - b;
        });
      if (stillHR.length < 60) return null;
      hrRest = stillHR[Math.floor(0.05 * stillHR.length)];
    }
    if (hrRest < 30 || hrRest > 80) return null;

    // ── HRmax via Tanaka ──────────────────────────────────────────
    var hrMax = Math.round(208 - 0.7 * age);
    var hrr = hrMax - hrRest; // Heart Rate Reserve

    // ── Zone boundaries (Karvonen) ────────────────────────────────
    function zone(pctLow, pctHigh) {
      return {
        low: Math.round(hrr * pctLow + hrRest),
        high: Math.round(hrr * pctHigh + hrRest)
      };
    }
    var zones = {
      z1: zone(0.5, 0.6),
      z2: zone(0.6, 0.7),
      z3: zone(0.7, 0.8),
      z4: zone(0.8, 0.9),
      z5: zone(0.9, 1.0)
    };
    zones.z1.name = 'Z1 Recovery';
    zones.z1.color = '#56d364';
    zones.z1.purpose = 'Active recovery, easy walk/swim';
    zones.z2.name = 'Z2 Aerobic Base';
    zones.z2.color = '#79c0ff';
    zones.z2.purpose = 'Fat oxidation, base fitness, Zone 2 training';
    zones.z3.name = 'Z3 Tempo';
    zones.z3.color = '#ffa657';
    zones.z3.purpose = 'Aerobic capacity building, moderate effort';
    zones.z4.name = 'Z4 Threshold';
    zones.z4.color = '#d29922';
    zones.z4.purpose = 'Lactate threshold, race pace';
    zones.z5.name = 'Z5 VO₂max';
    zones.z5.color = '#f85149';
    zones.z5.purpose = 'Peak VO₂max, high-intensity intervals';

    // ── Next-Day Readiness Score (0–100) ─────────────────────────
    // Component weights: HRV 30% | SpO2/hypoxia 25% | Sleep arch 20% | HR floor 15% | HR slope 10%
    var scores = {};

    // 1. RMSSD component (30 pts)
    var rmssdScore = 0;
    if (hrv.rmssd != null) {
      // 1Hz proxy thresholds (bpm): at HR≈53, 1bpm≈21ms. 50ms→2.3, 35ms→1.6, 25ms→1.2, 15ms→0.7
      if (hrv.rmssd >= 2.3) rmssdScore = 30;
      else if (hrv.rmssd >= 1.6) rmssdScore = 24;
      else if (hrv.rmssd >= 1.2) rmssdScore = 18;
      else if (hrv.rmssd >= 0.7) rmssdScore = 10;
      else rmssdScore = 4;
    }
    scores.rmssd = rmssdScore;

    // 2. SpO2 / hypoxic load component (25 pts)
    var spo2Score = 0;
    var odi4Rate = odi4 ? odi4.rate : 0;
    var hd94Rate = hypDose ? hypDose.hd94PerHr : 0;
    if (odi4Rate < 2 && hd94Rate < 30) spo2Score = 25;
    else if (odi4Rate < 5 && hd94Rate < 60) spo2Score = 20;
    else if (odi4Rate < 10 && hd94Rate < 120) spo2Score = 13;
    else if (odi4Rate < 20) spo2Score = 7;
    else spo2Score = 2;
    scores.spo2 = spo2Score;

    // 3. Sleep architecture (20 pts): duration + REM + deep estimates
    var sleepScore = 0;
    var durationMin = n > 0 ? n / 60 : durationMinHint || 360;
    if (durationMin >= 420)
      sleepScore += 10; // ≥7h
    else if (durationMin >= 360) sleepScore += 7;
    else if (durationMin >= 300) sleepScore += 4;
    else sleepScore += 1;
    if (stageProxy) {
      if (stageProxy.remProxyMin >= 45) sleepScore += 5;
      else if (stageProxy.remProxyMin >= 20) sleepScore += 3;
      if (stageProxy.nremDeepMin >= 60) sleepScore += 5;
      else if (stageProxy.nremDeepMin >= 30) sleepScore += 3;
    } else {
      sleepScore += 5; // neutral if no stage data
    }
    scores.sleep = sleepScore;

    // 4. HR floor (15 pts): lower nocturnal floor = better recovery
    var hrFloorScore = 0;
    if (hrRest <= 48) hrFloorScore = 15;
    else if (hrRest <= 54) hrFloorScore = 12;
    else if (hrRest <= 60) hrFloorScore = 8;
    else if (hrRest <= 68) hrFloorScore = 4;
    else hrFloorScore = 1;
    scores.hrFloor = hrFloorScore;

    // 5. HR slope / dipping (10 pts): negative slope = good nocturnal dip
    var hrSlopeScore = 0;
    if (hrv.hrSlope != null) {
      if (hrv.hrSlope < -0.5) hrSlopeScore = 10;
      else if (hrv.hrSlope < 0) hrSlopeScore = 7;
      else if (hrv.hrSlope < 0.5) hrSlopeScore = 4;
      else hrSlopeScore = 1;
    } else hrSlopeScore = 5;
    scores.hrSlope = hrSlopeScore;

    var readiness = rmssdScore + spo2Score + sleepScore + hrFloorScore + hrSlopeScore;
    readiness = Math.min(100, Math.max(0, readiness));

    // ── Readiness tier ─────────────────────────────────────────────
    var readinessTier, readinessColor, zoneRec, trainingNote;
    if (readiness >= 85) {
      readinessTier = 'Optimal';
      readinessColor = 'good';
      zoneRec = 'z4_z5';
      trainingNote = 'Full training. Threshold, intervals, or VO₂max work appropriate.';
    } else if (readiness >= 70) {
      readinessTier = 'Good';
      readinessColor = 'good';
      zoneRec = 'z3_z4';
      trainingNote = 'Tempo or sub-threshold work. Avoid all-out efforts.';
    } else if (readiness >= 55) {
      readinessTier = 'Moderate';
      readinessColor = 'warn';
      zoneRec = 'z2_z3';
      trainingNote = 'Zone 2 aerobic base or moderate tempo. Skip HIIT.';
    } else if (readiness >= 40) {
      readinessTier = 'Low';
      readinessColor = 'warn';
      zoneRec = 'z1_z2';
      trainingNote = 'Recovery or easy Zone 2 only. Prioritize sleep tonight.';
    } else {
      readinessTier = 'Rest Day';
      readinessColor = 'bad';
      zoneRec = 'z1';
      trainingNote = 'Rest or active recovery walk only. Training will deepen deficit.';
    }

    // ── Recommended zones for tomorrow ───────────────────────────
    var recZones = [];
    if (zoneRec === 'z4_z5') recZones = [zones.z3, zones.z4, zones.z5];
    else if (zoneRec === 'z3_z4') recZones = [zones.z2, zones.z3, zones.z4];
    else if (zoneRec === 'z2_z3') recZones = [zones.z2, zones.z3];
    else if (zoneRec === 'z1_z2') recZones = [zones.z1, zones.z2];
    else recZones = [zones.z1];

    // ── MAF training HR (Phil Maffetone): 180 − age ────────────────
    // Widely used aerobic base-building ceiling
    var mafHR = 180 - age;
    var mafAdj = '';
    if (readiness >= 85) {
      mafAdj = '+5 (recovering well)';
      mafHR += 5;
    } else if (readiness < 55) {
      mafAdj = '-10 (recovery deficit)';
      mafHR -= 10;
    } else mafAdj = 'no adjustment';

    // ── LTHR estimate (Lactate Threshold HR) ─────────────────────
    // Conservative: HRmax × 0.88 (Seiler 2010 estimate for recreational athletes)
    var lthr = Math.round(hrMax * 0.88);
    var lthrNote = 'Zone 4 top ≈ LTHR. Confirm with field test (30-min max effort, avg last 20 min).';

    return {
      hrRest: hrRest,
      hrMax: hrMax,
      hrr: hrr,
      zones: zones,
      allZones: [zones.z1, zones.z2, zones.z3, zones.z4, zones.z5],
      readiness: readiness,
      readinessTier: readinessTier,
      readinessColor: readinessColor,
      recZones: recZones,
      trainingNote: trainingNote,
      scores: scores,
      mafHR: mafHR,
      mafAdj: mafAdj,
      lthr: lthr,
      lthrNote: lthrNote,
      method: 'Karvonen HRR (ACSM 2022) · Tanaka HRmax · MAF 180-formula'
    };
  }

  // ═══════════════════════════════════════════
  // v20 — LITERATURE-VALIDATED HYPOXIC METRICS
  // Source: Hui et al. 2024 (Respirology 29:825–834), Kulkas 2013
  // ═══════════════════════════════════════════

  // SBII (Sleep Breathing Impairment Index) — Hui 2024, best predictor CVD mortality
  // Formula: Σ(D_i² × T_i_min) / TRT_hr  [%²·min/hr] — each event contributes depth² × duration
  // nadir events computed inline from ODI-4 rolling baseline; result normalized per hour
  function computeSBII(rows, desat, durationHr, blArr) {
    var spo2 = rows.map(function (r) {
      return r.spo2;
    });
    var n = spo2.length,
      WIN = 300;
    /* REFUSE (Clock Contract §2.6). `sbii` is `emerging` with goodDirection `down`, so 0 is the BEST
       value on the scale — and `Q1(low)` names the lowest-risk SHHS quintile explicitly. Returning
       those from insufficient data does not merely fabricate a number, it fabricates a CLINICAL
       STRATIFICATION: the reader sees a judgement already made, not a missing measurement. The cite
       is "best oximetry predictor of CVD mortality (Hui 2024, Respirology 29:825)". */
    if (n < 60 || durationHr <= 0) return { sbii: null, sbiiQ: null };
    // Nadir events from the ONE canonical primitive — DEX-EVENT-UNIFY-FOLLOWUPS §1 — scored on
    // the headline desats, not a private MEAN loop.
    //
    // DEEP-AUDIT-II §2.1: this re-ran `detectDesatEvents` itself and never read `desat.events`,
    // so it scored the UNGATED set. The oximeter self-gate (`selfGateDesat`) flags probe-squeeze
    // and finger-off artifacts, and `processNight` already subtracts them from the ODI-4 rate —
    // but SBII squares depth (D²·T), so an artifact "67 % cliff" that ODI-4 had explicitly
    // rejected re-entered here with quadratic weight: up to 6.5×, moving 3 of 11 nights a full
    // quintile. Take `desat.events` (the SURVIVING set) so the exclusion is inherited rather
    // than re-litigated. The `durationHr` denominator is deliberately untouched (ratified).
    // NOTE the two event shapes: the raw primitive emits `durationSec`, while
    // computeDesaturationProfile RE-SHAPES its events to `duration` (and drops `baseline`,
    // keeping `nadir`+`depth`). Read both, or the profile path silently yields NaN — which
    // JSON-serialises to null and, being NaN, fails every quintile comparison so the label
    // lands on 'Q5(high)'. A wrong-but-plausible worst-case grade, from a units mismatch.
    var _src = desat && Array.isArray(desat.events) ? desat.events : detectDesatEvents(spo2, { dropPct: DexKernel.K.ODI_DROP, exitPct: DexKernel.K.ODI_DROP, blArr: blArr });
    var nadirEvents = _src
      .map(function (e) {
        var dur = e.durationSec != null ? e.durationSec : e.duration;
        return { depth: e.depth, duration: dur, desatArea: (e.depth * dur) / 60 };
      })
      .filter(function (e) {
        return isFinite(e.depth) && isFinite(e.duration);
      });
    /* DELIBERATELY NOT A REFUSAL, and the distinction is the whole point of this change. This branch
       is reached only AFTER the guard above proved n >= 60 and durationHr > 0 — so the night was
       long enough and the detector simply found no desaturation events. That is a MEASUREMENT, and
       its honest answer is zero: a clean night genuinely sits in Q1(low). Nulling it here would
       fabricate ABSENCE where there is a real result, which is the mirror of the defect being fixed
       and destroys a true negative. Refuse when you could not look; report zero when you looked and
       found nothing. */
    if (!nadirEvents.length) return { sbii: 0, sbiiQ: 'Q1(low)' };
    var sum = 0;
    nadirEvents.forEach(function (e) {
      // Correct SBII: Σ(D_i² × T_i_min) / TRT_hr  [%²·min/hr] — Hui 2024
      sum += e.depth * e.depth * (e.duration / 60);
    });
    var sbii = durationHr > 0 ? +(sum / durationHr).toFixed(3) : 0;
    var q = sbii < 2.58 ? 'Q1(low)' : sbii < 6.49 ? 'Q2' : sbii < 12.8 ? 'Q3' : sbii < 25.54 ? 'Q4' : 'Q5(high)';
    return { sbii: sbii, sbiiQ: q };
  }

  // pRED_3p — Hui 2024, best predictor CVD morbidity
  // Formula: % of total recording time occupied by durations of events with ≥3% desaturation
  // Proxy from SpO2 only: cumulative duration of all ODI-3 dip events / total time × 100
  function computePRED3p(rows, dip3Events, blArr) {
    var n = rows.length;
    /* REFUSE (§2.6) — no rows at all is an absent measurement, not a clean night. `pred3p` is
       `emerging`, goodDirection `down`, so 0 is the best value on its scale, and `Q1` is the
       lowest-risk SHHS quintile. Contrast the nadir-events branch in computeSBII, which DOES
       report zero: there the night was long enough and the detector found nothing. */
    if (!n) return { pred3p: null, pred3pQ: null };
    // dip3Events: array of {start, end} indices from ODI-3 detection
    // We build this inline from rows
    var spo2 = rows.map(function (r) {
      return r.spo2;
    });
    // % of recording time occupied by ≥3% desaturations — DEX-EVENT-UNIFY-FOLLOWUPS §1.
    // Sourced from the ONE canonical primitive (ODI-3 threshold, simple re-rise close, no
    // min-length gate so every qualifying dip's time counts), not a private MEAN loop.
    // FINDING 1: artifact-gated (pulse from rows.hr) — an artifact desat's DURATION would
    // otherwise inflate pRED-3p exactly as its COUNT inflated the rest of the ODI-3 family.
    var pulseSeries = rows.map(function (r) {
      return r.hr;
    });
    var totalDuration = detectDesatEventsGated(spo2, { dropPct: 3, exitPct: 3, minSec: 0, blArr: blArr }, pulseSeries).reduce(function (s, e) {
      return s + e.durationSec;
    }, 0);
    var pred3p = +((totalDuration / n) * 100).toFixed(2);
    // Quintile reference (SHHS): Q1<2.78%, Q2 2.78–6.19%, Q3 6.19–10.84%, Q4 10.84–19.04%, Q5>19.04%
    var q = pred3p < 2.78 ? 'Q1(low)' : pred3p < 6.19 ? 'Q2' : pred3p < 10.84 ? 'Q3' : pred3p < 19.04 ? 'Q4' : 'Q5(high)';
    return { pred3p: pred3p, pred3pQ: q };
  }

  // DesSev (Desaturation Severity) — Kulkas 2013 / Karhu (ABOSA)
  // Formula: Σ(desaturation_area) / total_time
  // Where desaturation_area = area between baseline (left peak) and SpO2 nadir per event
  // This is the proper "area under desaturation curve" without requiring manually scored events
  function computeDesSev(rows, blArr, desat) {
    var spo2 = rows.map(function (r) {
      return r.spo2;
    });
    var n = rows.length;
    /* REFUSE (§2.6). `desSev` is `emerging`, goodDirection `down` — 0 is the best value it can
       report, so under a minute of data it published the most reassuring possible answer. */
    if (n < 60) return { desSev: null };
    // Desaturation area (Kulkas) — area = Σ per-second deficit vs each event's onset baseline,
    // scored over the CANONICAL ODI event set.
    //
    // DEEP-AUDIT-II §2.2: this previously ran the primitive at `dropPct:1, exitPct:1, minSec:0`.
    // A 1 % descent with NO minimum duration is not a desaturation — it is ordinary SpO₂ ripple,
    // so the integral swept most of the night and the index stopped discriminating: across the
    // 37-night O2Ring corpus it spanned 27.8–61.8 %-min/hr, the "good" band (<5) was unreachable
    // on EVERY night, and `ahiKulkas` — which takes desSev at weight 0.6 — ran a median 17× its
    // sibling `ahiODI4`, reporting "moderate apnea" (24) on nights ODI-4 scored normal (1.2).
    // A metric returning the same verdict for all 37 nights is measuring the noise floor.
    //
    // Now scored over `desat.events`: the same ≥4 % / ≥10 s ODI-4 set every other consumer uses,
    // already artifact-gated (§2.1), so the area is taken over events that are actually
    // desaturations. Falls back to deriving that canonical set when no profile is supplied so
    // direct callers keep working — the fallback is NOT artifact-gated, so the profile path is
    // preferred. Kulkas' area-under-the-curve concept is unchanged; only the event set is.
    var _evts = desat && Array.isArray(desat.events) ? desat.events : detectDesatEvents(spo2, { dropPct: DexKernel.K.ODI_DROP, exitPct: DexKernel.K.ODI_DROP, blArr: blArr });
    // Two event shapes (see computeSBII): the raw primitive carries `baseline`, while the
    // profile's re-shaped events drop it and keep `nadir`+`depth` — from which the onset
    // baseline is recoverable exactly. Without this the subtraction is NaN, every `d > 0`
    // is false, and the index reports a silent, confident 0.
    var totalArea = 0;
    _evts.forEach(function (e) {
      var base = e.baseline != null ? e.baseline : e.nadir != null && e.depth != null ? e.nadir + e.depth : null;
      if (base == null || !isFinite(base)) return;
      for (var k = e.startIdx; k < e.endIdx; k++) {
        var d = base - spo2[k];
        if (d > 0) totalArea += d;
      }
    });
    // Normalize: area in %-seconds → %-min/hr
    var durationHr = n / 3600;
    var desSev = durationHr > 0 ? +(totalArea / 60 / durationHr).toFixed(2) : 0;
    return { desSev: desSev };
  }

  // CT90 / CT89 / CT88 per-second (precise, already in tIdx but now surfaced as distinct fields)
  function computeCTprecise(rows) {
    var spo2 = rows.map(function (r) {
      return r.spo2;
    });
    var n = rows.length;
    var ct90 = 0,
      ct89 = 0,
      ct88 = 0,
      ct85 = 0,
      ct80 = 0;
    for (var i = 0; i < n; i++) {
      var v = spo2[i];
      if (v < 90) ct90++;
      if (v < 89) ct89++;
      if (v < 88) ct88++;
      if (v < 85) ct85++;
      if (v < 80) ct80++;
    }
    return {
      ct90s: ct90,
      ct89s: ct89,
      ct88s: ct88,
      ct85s: ct85,
      ct80s: ct80,
      ct90m: +(ct90 / 60).toFixed(1),
      ct89m: +(ct89 / 60).toFixed(1),
      ct88m: +(ct88 / 60).toFixed(1),
      ct85m: +(ct85 / 60).toFixed(1)
    };
  }

  // ═══════════════════════════════════════════
  // JSONL IMPORT — load pre-processed night summaries
  // ═══════════════════════════════════════════
  function parseJSONL(text) {
    var results = [];
    // Accept a top-level JSON array (the unified _summary.json export) by
    // flattening it to one-object-per-line, then reuse the JSONL line loop.
    var _t = text.trim();
    if (_t.charAt(0) === '[') {
      try {
        var _arr = JSON.parse(_t);
        if (Array.isArray(_arr))
          text = _arr
            .map(function (o) {
              return JSON.stringify(o);
            })
            .join('\n');
      } catch (e) {
        /* fall through to line-by-line */
      }
    }
    var lines = text.trim().split(/\r?\n/);
    lines.forEach(function (line) {
      line = line.trim();
      if (!line) return;
      try {
        var obj = JSON.parse(line);
        // Must have date + stats to be valid
        if (!obj.date || !obj.stats) return;
        var s = obj.stats;
        // Reconstruct night object compatible with renderAll/nightRowInner/nightDetail
        var night = {
          date: obj.date,
          t0Ms: obj.t0Ms != null ? obj.t0Ms : s.startTs != null ? s.startTs : null,
          fname: obj.file || obj.date,
          stats: {
            durationMin: s.durationMin || 0,
            start: s.start || '',
            end: s.end || '',
            startTs: s.startTs != null ? s.startTs : null,
            meanSpo2: s.meanSpo2 || 0,
            minSpo2: s.minSpo2 || 0,
            maxSpo2: s.maxSpo2 || 100,
            spo2Std: s.spo2Std || 0,
            t95pct: s.t95pct || 0,
            t90pct: s.t90pct || 0,
            meanHr: s.meanHr || 0,
            minHr: s.minHr || 0,
            maxHr: s.maxHr || 0,
            // §4 Phase 1: perfusion index — null (NOT 0) when the input carried no PI, so a consumer
            // reading the export can tell "no PI sensor data" from "zero perfusion".
            meanPi: s.meanPi != null ? s.meanPi : null,
            piFrames: s.piFrames || 0,
            // §3 — same reasoning as meanPi directly above: `|| 0` would turn a faulted motion
            // column into a report of a perfectly still night, which is the opposite of the truth.
            motionPct: s.motionPct != null ? s.motionPct : null,
            n: s.n || 0,
            artifactHrCleaned: s.artifactHrCleaned || 0,
            artifactSpikesRemoved: s.artifactSpikesRemoved || 0
          },
          odi4: obj.odi4 || { rate: 0, count: 0 },
          odi3: obj.odi3 || { rate: 0, count: 0 },
          hrv: obj.hrv
            ? {
                hrSdnn: obj.hrv.hrSdnnProxy || obj.hrv.hrSdnn || 0,
                pnn3: obj.hrv.pnn3 || 0,
                hrFloor: obj.hrv.hrFloor || 0,
                hrSlope: obj.hrv.hrSlope || 0,
                rsaProxy: obj.hrv.rsaProxy || 0,
                rmssd: obj.hrv.rmssd || 0,
                maxHr: obj.hrv.maxHr || 0,
                n: obj.hrv.n || null
              }
            : null,
          spikes: (function () {
            var evArr = obj.hr_spikes && Array.isArray(obj.hr_spikes.events) ? obj.hr_spikes.events : Array.isArray(obj.hr_spikes) ? obj.hr_spikes : [];
            if (evArr.length) {
              return evArr.map(function (sp) {
                return {
                  time: sp.time || '',
                  baseline: sp.baseline || 0,
                  peak: sp.peak || 0,
                  duration: sp.duration || 0,
                  spo2: sp.spo2 || 0,
                  mfm: sp.mfm || (sp.time ? parseTimeStr(sp.time) / 60 : 0)
                };
              });
            }
            // No event detail — preserve count for summary-mode nights
            var cnt = (obj.hr_spikes && obj.hr_spikes.count) || 0;
            return cnt > 0 ? { length: cnt } : [];
          })(),
          // osc: import the full oscillations object (peakCrossings / first / last included)
          osc: obj.oscillations ? Object.assign({ windows: [] }, obj.oscillations) : { episodeCount: 0, totalCrossings: 0, meanAmplitude: 0, peakCrossings: 0, windows: [] },
          period: obj.hr_spikes && obj.hr_spikes.periodicity && obj.hr_spikes.periodicity.pattern ? obj.hr_spikes.periodicity : null,
          tIdx: (function () {
            var idx = {};
            // Seed T95 and T90 from summary stats — all that's available without raw rows
            if (s.t95pct != null) idx[95] = { pct: s.t95pct, secs: Math.round((s.t95pct / 100) * (s.durationMin || 0) * 60) };
            if (s.t90pct != null) idx[90] = { pct: s.t90pct, secs: Math.round((s.t90pct / 100) * (s.durationMin || 0) * 60) };
            return idx;
          })(),
          // ── v18–v20 fields: restore from the export's descriptive key names ──
          // (the exporter renames internal fields; reading the short names gives
          //  undefined, which the old code silently treated as null — data lost)
          hb: obj.hypoxicBurden || null,
          motion: obj.motionProfile || null,
          stab: obj.sleepStability || null,
          motSleep: obj.sleepQuality || null,
          desat: obj.desatProfile || null,
          hrProf: obj.hrProfile || null,
          cross: obj.crossSignal || null,
          spo2Adv: obj.spo2Advanced || null,
          hrAdv: obj.hrAdvanced || null,
          comp: obj.composite || null,
          sbii: obj.sbii || null,
          pred3p: obj.pred3p || null,
          desSev: obj.desSev || null,
          ctPrec: obj.ctPrecise || null,
          flags: (obj.flags || []).map(function (f) {
            if (typeof f !== 'string') return f;
            return { code: f, sev: _flagSev(f) };
          }),
          // ── newMetrics: the v20.6+ extended metrics packed under one sub-key ──
          spo2Drift: (obj.newMetrics || {}).spo2Drift || null,
          odi2: (obj.newMetrics || {}).odi2 || null,
          spo2Over: (obj.newMetrics || {}).spo2Overshoot || null,
          spo2Ac1: (obj.newMetrics || {}).spo2Ac1 || null,
          hrFreq: (obj.newMetrics || {}).hrFreqBands || null,
          respRate: (obj.newMetrics || {}).respRate || null,
          hrAsym: (obj.newMetrics || {}).hrAsymmetry || null,
          hrQuart: (obj.newMetrics || {}).hrQuartiles || null,
          spo2HRLag: (obj.newMetrics || {}).spo2HRLag || null,
          spkDecay: (obj.newMetrics || {}).spikeDecay || null,
          spkUnder: (obj.newMetrics || {}).spikeUndershoot || null,
          spkRise: (obj.newMetrics || {}).spikeRiseRate || null,
          dataGaps: (obj.newMetrics || {}).dataGaps || null,
          hrFlat: (obj.newMetrics || {}).hrFlatlines || null,
          spo2Ceil: (obj.newMetrics || {}).spo2Ceiling || null,
          odri: (obj.newMetrics || {}).odri || null,
          spo2Pct: (obj.newMetrics || {}).spo2Pct || null,
          spo2Shape: (obj.newMetrics || {}).spo2Shape || null,
          hrCV: (obj.newMetrics || {}).hrCV || null,
          hypDose: (obj.newMetrics || {}).hypDose || null,
          t88t85: (obj.newMetrics || {}).t88t85 || null,
          lcsp: (obj.newMetrics || {}).lcsp || null,
          poincare: (obj.newMetrics || {}).poincare || null,
          o2hrEff: (obj.newMetrics || {}).o2hrEff || null,
          condSpo2: (obj.newMetrics || {}).condSpo2 || null,
          nadirTrend: (obj.newMetrics || {}).nadirTrend || null,
          iei: (obj.newMetrics || {}).iei || null,
          recovCV: (obj.newMetrics || {}).recovCV || null,
          hrNadirT: (obj.newMetrics || {}).hrNadirT || null,
          spo2NadirT: (obj.newMetrics || {}).spo2NadirT || null,
          rmssdArc: (obj.newMetrics || {}).rmssdArc || null,
          spk50Rec: (obj.newMetrics || {}).spk50Rec || null,
          stageProxy: (obj.newMetrics || {}).stageProxy || null,
          vo2est: (function () {
            var v = (obj.newMetrics || {}).vo2est || null;
            if (!v) return null;
            // Recalculate vo2est in case stored value pre-dates rmssdAdj being applied
            // (older exports stored vo2est = 15.3×HRmax/HRrest without the adjustment)
            if (v.hrRest && v.hrMax && v.rmssdAdj != null) {
              var base = +(15.3 * (v.hrMax / v.hrRest)).toFixed(1);
              var corrected = +(base + (v.dfaAdj || 0) + v.rmssdAdj).toFixed(1);
              if (corrected !== v.vo2est) v = Object.assign({}, v, { vo2est: corrected });
            }
            return v;
          })(),
          bpProj: (obj.newMetrics || {}).bpProj || null,
          karv: (obj.newMetrics || {}).karv || null,
          // fields not yet exported (computed from raw rows only)
          ct94: null,
          extras: null,
          rolling: null,
          patScore: null,
          dfa: null,
          fft: null,
          hrEnt: null,
          ssi: null,
          circHR: null,
          spo2Ent: null,
          hypLoad: null,
          vagal: null,
          recIdx: null,
          sleepP: null,
          breathI: null,
          oxyCrash: null,
          hrnDip: null,
          desatAsym: null,
          summary: null,
          slopes: null,
          pbMet: null,
          sleepArch: null,
          odi1: null,
          // Recompute MOS + AHI estimates from available scalars — no raw rows needed
          mos: (function () {
            try {
              var o4r = obj.odi4 && obj.odi4.rate != null ? obj.odi4.rate : 0;
              var ct90s = obj.ctPrecise && obj.ctPrecise.ct90s != null ? obj.ctPrecise.ct90s : 0;
              return computeMOS(o4r, ct90s);
            } catch (e) {
              return null;
            }
          })(),
          ahiEst: (function () {
            try {
              var o4r = obj.odi4 && obj.odi4.rate != null ? obj.odi4.rate : 0;
              var o3r = obj.odi3 && obj.odi3.rate != null ? obj.odi3.rate : 0;
              /* null, not 0 — see computeAHIestimates: substituting 0 for an unmeasured DesSev
                 drops its term from the Kulkas estimate and under-reports AHI. */
              var dsev = obj.desSev && obj.desSev.desSev != null ? obj.desSev.desSev : null;
              var t95 = obj.stats && obj.stats.t95pct != null ? obj.stats.t95pct : 0;
              return computeAHIestimates(o4r, o3r, dsev, t95);
            } catch (e) {
              return null;
            }
          })(),
          _fromJSONL: true
        };
        // Generate Smart Summary for JSONL imports too (tabs were missing).
        try {
          night.summary = /** @type {any} */ (computeSmartSummary(night));
        } catch (e) {
          night.summary = null;
        }
        results.push(night);
      } catch (e) {
        console.warn('[O2Ring] suppressed error:', e);
      }
    });
    return results;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SELF-INGEST — reload OxyDex's OWN export as a REVIEW-MODE clinical view
  //  (SELF-INGEST-2026-06-27-BRIEF · prerequisite: the v2.0 envelope)
  // ───────────────────────────────────────────────────────────────────────────
  //  Let a user drop OxyDex's own ganglior.node-export back into OxyDex to get a
  //  faithful, print/PDF-able CLINICAL SUMMARY (findings · KPIs · event timeline ·
  //  evidence badges) to bring to a doctor WITHOUT the raw dataset — showing what
  //  was computed AT EXPORT TIME, never recomputing, re-grading, or re-stamping.
  //
  //  WHY THIS WAS BROKEN: the v2.0 envelope starts with '{' and has NO top-level
  //  date/stats (those live in nights[]) — so parseJSONL (whose array-flatten
  //  branch only fires on a leading '[', and whose line loop needs obj.date &&
  //  obj.stats) returns [] for it, and readFile's single-object branch (needs
  //  .date) misses it too. The fleet's own export was therefore NOT self-reloadable
  //  into its own app. oxyLoadOwnExport closes that.
  //
  //  PURE + DOM-FREE: returns a structured result; the app glue (readFile →
  //  handleFiles → renderAll) sets window._oxyReview, paints the review banner,
  //  greys raw-only panels, and renders the clinical summary. Tested directly in
  //  BOTH runners via OxyDex.loadOwnExport. This path must NEVER call
  //  GangliorProvenance.stamp() — a reload is a VIEW of a past computation, stamped
  //  with the build that MADE it, not a fresh computation (SELF-INGEST §3).
  function oxyLoadOwnExport(json) {
    // 1 · detect — a ganglior.node-export at all?
    if (!(json && json.schema && json.schema.name === 'ganglior.node-export'))
      return { ok: false, reason: 'not-node-export', message: 'Not a node-export \u2014 drop a raw O2Ring CSV, or OxyDex\u2019s own .json export.' };
    // 2 · guard — a node only re-ingests its OWN kind. A foreign export is REJECTED with a redirect
    //     message (mirrors the Integrator's detectNode), never silently coerced.
    var node = ((json.schema.node || '') + '').trim();
    if (node !== 'OxyDex')
      return {
        ok: false,
        reason: 'foreign-node',
        node: node,
        message: 'This is a ' + (node || 'non-OxyDex') + ' export \u2014 open it in ' + (node || 'its own node') + ', or drop it into the Integrator to fuse.'
      };
    // 3 · unwrap to the derived layer — nights[] (a single-record export = the object itself). Reuse
    //     the EXISTING parseJSONL per-element reconstruction (its array-flatten branch) verbatim: no new
    //     parse path, no recompute beyond the deterministic stored-scalar MOS/AHI derive parseJSONL
    //     already does (every nights[] element carries obj.date && obj.stats, so each rebuilds).
    var carrier = Array.isArray(json.nights) ? json.nights : json.date && json.stats ? [json] : [];
    var nights = typeof parseJSONL === 'function' ? parseJSONL(JSON.stringify(carrier)) : [];
    // Mark review-mode on each reconstructed night (the renderer greys raw-only panels + the dashboard
    // takes the review chrome) and PREFER the export's STORED summary over parseJSONL's deterministic
    // re-derive (SELF-INGEST §3 — prefer the stored value; a divergence is a bug, never silently shown).
    nights.forEach(function (n, i) {
      n._reviewMode = true;
      n._fromExport = true;
      var el = carrier[i];
      if (el && el.date === n.date && el.summary != null) n.summary = el.summary;
    });
    // 4 · preserve provenance / kernel / events / crossNight VERBATIM — the view's provenance IS the
    //     export's; the current build's stamp must NOT be written over it (no GangliorProvenance.stamp()).
    return {
      ok: true,
      reviewMode: true,
      node: node,
      nights: nights,
      events: Array.isArray(json.ganglior_events) ? json.ganglior_events : [],
      provenance: (json.schema && json.schema.provenance) || null,
      generated: (json.schema && json.schema.generated) || null,
      derivedFrom: (json.schema && json.schema.derivedFrom) || null,
      kernel: json.kernel || null,
      crossNight: json.crossNight || null,
      recording: json.recording || null,
      scrubbed: !!(json.schema && json.schema.scrubbed),
      multiNight: nights.length > 1,
      raw: json
    };
  }

  // ── SCRUB FOR SHARING (SELF-INGEST §5) ──────────────────────────────────────────────────────────────
  // De-raw'd \u2260 de-identified: an OxyDex export's schema.provenance.inputs[].name carries the O2Ring
  // DEVICE SERIAL (e.g. "O2Ring S 2100_\u2026csv") + inputs[].sha256. For clinical sharing, return a deep
  // CLONE with those stripped while KEEPING: the full clinical summary (nights[] + ganglior_events[] +
  // crossNight), a COARSE build stamp (buildHash + generated, so provenance integrity survives), and
  // recording.contentId (the identity-free EXPORT-IDENTITY handle — preserved when present; OxyDex does
  // not surface it yet, see SELF-INGEST §10 / EXPORT-IDENTITY-FOLLOWUPS). PURE: never mutates the input.
  // SELF-INGEST §5 · "scrub for sharing" — FOLDED INTO the shared dexScrubExport (D1, SELF-INGEST-FOLLOWUPS
  // executed 2026-07-04). The ONE implementation now lives in dex-export.js; this stays a thin OxyDex alias
  // for the app call site + the namespace/back-compat exports + the §7 tests. The shared version is a strict
  // SUPERSET of the old local copy — it ALSO strips device/serial/model from each per-night recording block
  // in a multi-night series export (a gap the local copy missed). Default OFF at the call site, so a normal
  // export stays byte-identical; a single-night scrub is byte-identical to the old local result.
  function oxyScrubExport(envelope) {
    if (typeof DexExport !== 'undefined' && DexExport && typeof DexExport.scrubExport === 'function') return DexExport.scrubExport(envelope);
    if (typeof dexScrubExport === 'function') return dexScrubExport(envelope);
    return envelope; // dex-export.js always ships in the OxyDex bundle, so this fallthrough is never reached
  }

  // ═══════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════
  function avg(a) {
    return (
      a.reduce(function (x, y) {
        return x + y;
      }, 0) / a.length
    );
  }
  function stdDev(a) {
    var m = avg(a);
    return Math.sqrt(
      avg(
        a.map(function (x) {
          return (x - m) * (x - m);
        })
      )
    );
  }
  function fmtDate(d) {
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function fmtTime(d) {
    return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
  }
  function fmtTimeFull(d) {
    return fmtTime(d) + ' ' + pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
  }
  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }
  function shortDate(s) {
    return s.slice(5);
  } // MM-DD from YYYY-MM-DD

  // ═══════════════════════════════════════════════════════════════════════════
  //  HEADLESS PUBLIC COMPUTE SURFACE · OxyDex.compute (Phase 9)
  //  ────────────────────────────────────────────────────────────────────────
  //  SIGNAL-ADAPTER-FOLLOWUPS §4 (the OxyDex leg of the long tail). Split READING
  //  (parseCSV — already pure) from COMPUTING (processNight — pure analysis) and
  //  expose a public entry the Data Unifier + OverDex call in the isolated OxyDex
  //  host: OxyDex.compute(SignalFrame(spo2) | rows | {text,fileMeta}) →
  //  ganglior.node-export. The export is a single-night SUMMARY element (the SAME
  //  shape oxydex-app.js exportJSON emits, now built by the SHARED
  //  oxyBuildNightElement) wrapped as a node-export; the Integrator's adaptOxyDex
  //  synthesizes spo2_desaturation + autonomic_arousal events from
  //  desatProfile/hr_spikes (it always has — OxyDex never emitted top-level
  //  ganglior_events). No paired ECG in the OverDex single-file context, so
  //  ecgFusion/ansAge are null — identical to dropping a raw O2Ring file into
  //  OxyDex with no ECG loaded. oxydex-dsp.js stays grandfathered-impure (the
  //  top-level file-input wiring is guarded so the module LOADS headless).
  // ═══════════════════════════════════════════════════════════════════════════

  // Per-night node-export ELEMENT — the single source of the export shape, shared
  // by oxydex-app.js exportJSON AND OxyDex.compute. opts: { provenance, kernel,
  // ecgFusion, ansAge }. compute() passes ecgFusion/ansAge = null (no paired ECG).
  function oxyBuildNightElement(n, opts) {
    opts = opts || {};
    var _prov = opts.provenance !== undefined ? opts.provenance : null;
    var _kernel = opts.kernel !== undefined ? opts.kernel : null;
    var _ecgFusion = opts.ecgFusion !== undefined ? opts.ecgFusion : null;
    var _ansAge = opts.ansAge !== undefined ? opts.ansAge : null;
    return {
      date: n.date,
      t0Ms: n.t0Ms != null ? n.t0Ms : null,
      contentId: n.contentId != null ? n.contentId : null,
      file: n.fname,
      provenance: _prov,
      kernel: _kernel,
      stats: n.stats,
      summary: n.summary || null,
      odi4: n.odi4 ? { rate: n.odi4.rate, count: n.odi4.count } : null,
      odi3: n.odi3 ? { rate: n.odi3.rate, count: n.odi3.count } : null,
      hrv: n.hrv,
      hypoxicBurden: n.hb,
      motionProfile: {
        motionPct: n.stats ? n.stats.motionPct : null,
        // §3 — present ONLY on a faulted night, so no healthy export moves. Without it a null
        // motionPct is indistinguishable from an oximeter that never had a motion column.
        ...(n.stats && n.stats.motionColumnStuck ? { columnStuck: true } : {}),
        arousalIndex: n.motion ? n.motion.arousalIndex : null,
        restlessWindows: n.motion ? n.motion.restlessWindows : null,
        totalWindows: n.motion ? n.motion.totalWindows : null,
        windows: n.motion && n.motion.windows ? n.motion.windows : []
      },
      sleepQuality: n.motSleep || null,
      desatProfile: n.desat || null,
      hrProfile: n.hrProf || null,
      crossSignal: n.cross || null,
      spo2Advanced: n.spo2Adv || null,
      hrAdvanced: n.hrAdv || null,
      composite: n.comp || null,
      sbii: n.sbii || null,
      pred3p: n.pred3p || null,
      desSev: n.desSev || null,
      ctPrecise: n.ctPrec || null,
      sleepStability: n.stab ? { score: n.stab.score, grade: n.stab.grade, components: n.stab.components } : null,
      artifact: n.stats ? { hrSamplesCleaned: n.stats.artifactHrCleaned, clockSpikesRemoved: n.stats.artifactSpikesRemoved } : null,
      hr_spikes: { count: n.spikes ? n.spikes.length : 0, events: Array.isArray(n.spikes) ? n.spikes : [], periodicity: n.period },
      oscillations: n.osc,
      flags: (n.flags || []).map(function (f) {
        return f.code;
      }),
      newMetrics: {
        spo2Drift: n.spo2Drift || null,
        odi2: n.odi2 || null,
        spo2Overshoot: n.spo2Over || null,
        spo2Ac1: n.spo2Ac1 || null,
        hrFreqBands: n.hrFreq || null,
        respRate: n.respRate || null,
        hrAsymmetry: n.hrAsym || null,
        hrQuartiles: n.hrQuart || null,
        spo2HRLag: n.spo2HRLag || null,
        spikeDecay: n.spkDecay || null,
        spikeUndershoot: n.spkUnder || null,
        spikeRiseRate: n.spkRise || null,
        dataGaps: n.dataGaps || null,
        hrFlatlines: n.hrFlat || null,
        spo2Ceiling: n.spo2Ceil || null,
        odri: n.odri || null,
        spo2Pct: n.spo2Pct || null,
        spo2Shape: n.spo2Shape || null,
        hrCV: n.hrCV || null,
        hypDose: n.hypDose || null,
        t88t85: n.t88t85 || null,
        lcsp: n.lcsp || null,
        poincare: n.poincare || null,
        o2hrEff: n.o2hrEff || null,
        condSpo2: n.condSpo2 || null,
        nadirTrend: n.nadirTrend || null,
        iei: n.iei || null,
        recovCV: n.recovCV || null,
        hrNadirT: n.hrNadirT || null,
        spo2NadirT: n.spo2NadirT || null,
        rmssdArc: n.rmssdArc || null,
        spk50Rec: n.spk50Rec || null,
        stageProxy: n.stageProxy || null,
        vo2est: n.vo2est || null,
        bpProj: n.bpProj || null,
        karv: n.karv || null
      },
      // ── full research coverage (mirrors the CSV; previously JSON-only-missing) ──
      research: {
        tIdx: n.tIdx || null,
        period: n.period || null,
        ct94: n.ct94 || null,
        slopes: n.slopes || null,
        pbMet: n.pbMet || null,
        sleepArch: n.sleepArch || null,
        odi1: n.odi1 || null,
        mos: n.mos || null,
        ahiEst: n.ahiEst || null,
        extras: n.extras || null,
        rolling: n.rolling || null,
        patScore: n.patScore || null,
        dfa: n.dfa || null,
        fft: n.fft || null,
        hrEnt: n.hrEnt || null,
        ssi: n.ssi || null,
        circHR: n.circHR || null,
        spo2Ent: n.spo2Ent || null,
        hypLoad: n.hypLoad || null,
        vagal: n.vagal || null,
        recIdx: n.recIdx || null,
        sleepP: n.sleepP || null,
        breathI: n.breathI || null,
        oxyCrash: n.oxyCrash || null,
        hrnDip: n.hrnDip || null,
        desatAsym: n.desatAsym || null
      },
      // ── paired-ECG fusion + projected ANS age (null when no ECG loaded) ──
      ecgFusion: _ecgFusion,
      ansAge: _ansAge
    };
  }

  // ── ganglior_events[] builder (OXYDEX-NODE-EXPORT-ENVELOPE-2026-06-27) ───────────────────────
  // ONE source of the OxyDex event stream, shared by exportJSON (app) and OxyDex.compute (headless),
  // so the two paths can never drift. Input = FULL night objects (ascending by time) carrying t0Ms +
  // desat (desatProfile) + oscEpisodes (per-PB-episode onsets stashed by processNight). Emits exactly
  // two honest impulse types — OxyDex infers respiration from an SpO₂ PROXY, it does NOT measure airflow,
  // so the model stays modest:
  //   • desat_event       — one per SURVIVING (non-artifact) scored desaturation
  //   • periodic_breathing — one per detected oscillation/Cheyne-Stokes episode (weaker, lower tier)
  // Tier is a NODE fact resolved by CONSUMERS from OXY_REGISTRY (desat→odi4/odi3, PB→periodicBreathing);
  // it is NOT written into the event. conf is a CONTINUOUS per-event certainty (≠ tier, §2). Clock
  // Contract §6: every event carries BOTH t "HH:MM:SS" (UTC getters) and absolute floating tMs,
  // chronological + monotonic across midnight by construction (tMs derives from each night's floating t0Ms).
  function oxyBuildGangliorEvents(nightsChrono) {
    var out = [];
    (nightsChrono || []).forEach(function (n) {
      if (!n) return;
      var t0 = n.t0Ms != null ? n.t0Ms : null;
      if (t0 == null) return; // no clock anchor → cannot place events (never fabricate)
      var stats = n.stats || {};
      var nSamp = stats.n || 0;
      var durMs = stats.durationMin != null ? stats.durationMin * 60000 : null;
      var dt = durMs && nSamp ? durMs / nSamp : 1000; // O2Ring ≈ 1 Hz (mirrors the Integrator's idx→tMs)
      // 1) desat_event — from desatProfile.events (already artifact-gated, pulseValid≥floor)
      var dp = n.desat || null;
      var devs = dp && Array.isArray(dp.events) ? dp.events : [];
      devs.forEach(function (d) {
        if (!d || d.artifact) return; // self-gated artifacts are never on the bus (belt + braces)
        var idx = d.nadirIdx != null ? d.nadirIdx : d.startIdx != null ? d.startIdx : null;
        if (idx == null) return;
        // §8: prefer the event's OWN parsed row stamp. The index→time fallback is a uniform stretch that
        // is only correct on a gapless recording; on a lossy night it drifts by minutes (see the stamp
        // note in computeDesaturationProfile). Keep it ONLY for a legacy event with no stamp.
        var tMs = d.tMs != null ? d.tMs : t0 + idx * dt;
        out.push({
          t: fmtTime(new Date(tMs)),
          tMs: tMs,
          impulse: 'desat_event',
          node: 'OxyDex',
          conf: oxyDesatConf(d),
          /* `tMs` is the NADIR — the event's instant for scoring, and that stays the contract. But the
             nadir is the wrong fiducial for TIMING: a desaturation begins when saturation starts
             falling and reaches its nadir a desaturation-duration later, so anything correlating
             desat against another signal measures the coupling PLUS that duration. Measured: the
             apnea->desat transit reads ~59 s off the nadir and ~29 s off the onset, and the ~30 s gap
             is the desaturation itself.

             `startTMs`/`endTMs` were already computed and correctly stamped from the parsed rows
             (see _stampEvent) and were then discarded here — the same loss at the same boundary as
             the SpO2 series. Both are surfaced; null stays null, never an index-derived guess, because
             the index->time fallback drifts by minutes on a lossy night. */
          meta: {
            depth: d.depth != null ? d.depth : null,
            duration: d.duration != null ? d.duration : null,
            recovery: d.recovery != null ? d.recovery : null,
            nadir: d.nadir != null ? d.nadir : null,
            onsetTMs: d.startTMs != null ? d.startTMs : null,
            endTMs: d.endTMs != null ? d.endTMs : null
          }
        });
      });
      // 2) periodic_breathing — one per detected oscillation episode (window onset)
      var eps = Array.isArray(n.oscEpisodes) ? n.oscEpisodes : [];
      eps.forEach(function (ep) {
        if (!ep) return;
        var tMs = ep.tMs != null ? ep.tMs : ep.startIdx != null ? t0 + ep.startIdx * dt : null;
        if (tMs == null) return;
        var W = ep.windowSec != null ? ep.windowSec : (typeof CFG !== 'undefined' && CFG.OSC_WINDOW_SEC) || 300;
        var cross = ep.cross != null ? ep.cross : null;
        // per-episode cycle-length estimate: W seconds / (#crossings/2 oscillations) = 2W/cross (s)
        var cycleLen = cross && cross > 0 ? +((2 * W) / cross).toFixed(1) : null;
        out.push({ t: fmtTime(new Date(tMs)), tMs: tMs, impulse: 'periodic_breathing', node: 'OxyDex', conf: oxyPBConf(ep), meta: { cycleLen: cycleLen, crossings: cross, windowSec: W } });
      });
    });
    out.sort(function (a, b) {
      return a.tMs - b.tMs;
    });
    return out;
  }
  // conf = CONTINUOUS certainty of THIS desaturation (NOT its registry tier — §2 keeps the two axes
  // separate; a 9%- and a 4%-depth dip are both 'validated' but get different conf). Monotone in depth
  // (dominant — a deeper dip is less likely noise), with a mild duration reinforcement and a small
  // recovery-quality bonus (a clean re-rise to baseline reads as a discrete event, not drift). Pinned
  // here so it can never silently equal the tier. Clamped [0,1]. Base term mirrors the Integrator's
  // legacy synthesis (0.45 + min(depth,12)/24) so emitted confidences stay continuous with prior fusion.
  function oxyDesatConf(d) {
    var depth = d && d.depth != null ? d.depth : 0;
    var dur = d && d.duration != null ? d.duration : 0;
    var rec = d && d.recovery != null ? d.recovery : 0;
    var base = 0.45 + Math.min(depth, 12) / 24; // depth 4→0.62 … ≥12→0.95 (dominant)
    var durB = (Math.min(dur, 60) / 60) * 0.05; // up to +0.05 for a ≥60 s sustained dip
    var recB = rec > 0 ? 0.03 : 0; // +0.03 for a clean recovery to baseline
    return +Math.max(0, Math.min(1, base + durB + recB)).toFixed(2);
  }
  // conf for a single PB episode — scales with the window's threshold-crossing count (more zero-
  // crossings = a stronger periodic signature). PB is an epistemically weak DERIVED pattern, so its
  // conf is capped well below a scored desat's ceiling (≤0.6) — honest about the proxy.
  function oxyPBConf(ep) {
    var cross = ep && ep.cross != null ? ep.cross : 0;
    return +Math.max(0.3, Math.min(0.6, 0.3 + (Math.min(cross, 12) / 12) * 0.3)).toFixed(2);
  }

  // SignalFrame(spo2).samples | rows[] | {text,fileMeta} → normalized rows
  // [{tMs, t(Date rebuilt from tMs — cross-realm-safe), spo2, hr, motion}].
  function _oxyEnsureRows(arr) {
    if (!arr || arr.length == null) return null;
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var r = arr[i];
      if (!r || r.tMs == null) continue;
      out.push({ tMs: r.tMs, t: new Date(r.tMs), spo2: r.spo2, hr: r.hr, motion: r.motion || 0 });
    }
    return out;
  }
  function _oxyRowsFromInput(input) {
    if (input == null) return null;
    if (Array.isArray(input)) return _oxyEnsureRows(input);
    if (input.samples != null) return _oxyEnsureRows(input.samples);
    if (input.rows != null) return _oxyEnsureRows(input.rows);
    if (typeof input.text === 'string') return parseCSV(input.text, input.fileMeta || null);
    return null;
  }
  // ── Per-epoch cross-node series (INTEGRATOR-THREE-CORNERED-HAT §2 — OxyDex per-epoch HR) ─────────
  // Bin the cleaned 1 Hz rows into 5-min epochs: hr = MEDIAN pulse-HR (robust to residual spikes),
  // motionIndex = MEAN O2Ring motion count. tMin is node-relative (minutes from t0Ms), matching the
  // ECG/PpgDex epochs[] grid so the Integrator's alignTriplet lines them up. Epochs with <60 s of HR
  // coverage are dropped (sparse edge windows). PURE; [] when rows/t0Ms absent. The O2Ring's motion
  // column makes this the SECOND per-epoch motion series in the HR triplet → unblocks correlated-TCH ρ.
  function oxyBuildEpochSeries(rows, t0Ms) {
    if (!rows || !rows.length || t0Ms == null) return [];
    var EP = 300000,
      bins = {}; // 5 min in ms
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || r.tMs == null) continue;
      var k = Math.floor((r.tMs - t0Ms) / EP);
      if (k < 0) continue;
      var b = bins[k];
      if (!b) {
        b = { hr: [], mo: [] };
        bins[k] = b;
      }
      if (typeof r.hr === 'number' && isFinite(r.hr)) b.hr.push(r.hr);
      if (typeof r.motion === 'number' && isFinite(r.motion)) b.mo.push(r.motion);
    }
    function _median(a) {
      if (!a.length) return null;
      var s = a.slice().sort(function (x, y) {
        return x - y;
      });
      var m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
    function _mean(a) {
      if (!a.length) return null;
      var t = 0;
      for (var j = 0; j < a.length; j++) t += a[j];
      return t / a.length;
    }
    var out = [];
    Object.keys(bins)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      })
      .forEach(function (k) {
        var b = bins[k];
        if (b.hr.length < 60) return; // ≥1 min HR coverage in the 5-min window
        var mh = _median(b.hr),
          mm = _mean(b.mo);
        /* `hrStat` — R5-HR-TRIPLET-FOLLOWUPS. This leg is the ODD ONE on statistic: ECGDex and
           PpgDex both publish 60000/mean(RR), this publishes the median of 1 Hz rates, and the two
           differ by 0.299 bpm on real RR — the size of the bias R5 attributed to the O2Ring itself. */
        out.push({ tMin: k * 5, hr: mh != null ? +mh.toFixed(1) : null, hrStat: 'median-rate', motionIndex: mm != null ? +mm.toFixed(3) : null });
      });
    return out;
  }
  /* THE OXIMETER'S PRIMARY SIGNAL, AT THE RATE IT WAS RECORDED.

     Until now this node exported SpO2 nowhere. The whole timeseries block was 5-minute epochs of
     `{hr, motionIndex}` — 89 rows for a night in which the device recorded ~26,500 SpO2 samples, a
     ~300x reduction applied at the export boundary, not by the sensor. Every cross-node question that
     needs oxygen saturation in time therefore could not be asked: the apnea->desaturation transit
     measurement (WEARABLE-SYNC-APPLIED §3) resolved 3 nights of 39 for exactly this reason — it had a
     dozen `desat_event` timestamps standing in for a continuous signal.

     WHY 1 Hz AND NOT A BINNED SUMMARY — and the measurement that argues the other way.

     1 Hz IS provably oversampled on this corpus. Measured on 2026-07-26 (26,546 samples): only 6.5 %
     of adjacent seconds differ, the median run of an identical value is 8 s, and 2 s bins keeping the
     MINIMUM have a worst-case within-bin spread of 1 percentage point (mean 0.03). Binning to 2 s
     would halve the cost and lose nothing detectable on this night.

     It is still emitted at 1 Hz, because that 8 s figure is a property of ONE subject, ONE oximeter
     and ONE night. A patient with faster desaturations, or a device with less internal averaging than
     the O2Ring's, would be silently degraded by a bin size baked into an export contract — and the
     degradation would be invisible, because the export is all a consumer ever sees. Choosing a rate
     from an n=1 bandwidth measurement is the same generalisation error this suite keeps finding.
     Downsampling later is always available to a consumer; recovering what an export dropped is not.

     `field` (trailing, optional, default 'spo2') selects WHICH per-second column is gridded, so the
     pulse-rate series rides the identical contract rather than a second near-copy of it. Both columns
     come off the SAME row list, and parseCSV drops a row unless BOTH parse and clear their sanity
     bands (spo2 50–100, hr 20–250) — so the two grids share a hole pattern by construction, and a
     consumer may align them index-for-index without re-checking. There is no sentinel to strain out
     here: a −1 / 0 "no reading" never becomes a row in the first place.

     The cost is real and was underestimated once already: the export grows ~80 KB -> ~390 KB, because
     the writers pretty-print (the array alone is 78 KB compact, 156 KB indented). These are local
     files with no network in the path, so the trade is storage against information, and information
     is the thing this node exists to produce.

     A UNIFORM GRID WITH EXPLICIT HOLES, not a list of stamped samples. `startMs` + `hz` + one array is
     both far smaller and unambiguous, and — the part that matters — a second the device never reported
     is `null`, never carried forward and never zero. A fabricated 0 % saturation would be read as the
     most severe desaturation possible; a fabricated hold reads as stable oxygen. Absence is not zero,
     and here it is not stability either. */
  function oxyBuildSpo2Series(rows, t0Ms, field) {
    field = field || 'spo2';
    if (!rows || !rows.length || t0Ms == null) return null;
    var last = null;
    for (var i = rows.length - 1; i >= 0; i--)
      if (rows[i] && rows[i].tMs != null) {
        last = rows[i].tMs;
        break;
      }
    if (last == null || last < t0Ms) return null;
    var n = Math.floor((last - t0Ms) / 1000) + 1;
    if (n < 2 || n > 48 * 3600) return null; // a >48 h grid means a broken stamp, not a long night
    var out = new Array(n);
    for (var q = 0; q < n; q++) out[q] = null;
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      if (!r || r.tMs == null) continue;
      var k = Math.round((r.tMs - t0Ms) / 1000);
      if (k < 0 || k >= n) continue;
      // The LAST sample wins a shared second — deterministic, and matches how the row list is ordered.
      if (typeof r[field] === 'number' && isFinite(r[field])) out[k] = r[field];
    }
    return out;
  }
  // Top-level `timeseries` block — sibling to nights[], where adaptEnvelopeNode reads
  // json.timeseries.epochs[].{hr,motionIndex}. Kept OUT of the per-night element so nights[0] stays
  // byte-identical (the OxyDex equiv fixtures diff nights[0]). Single-recording only (multi-night uses
  // the crossNight longitudinal path, not per-epoch TCH); null when no epochs.
  function oxyBuildTimeseriesBlock(nightsChrono) {
    var n = nightsChrono && nightsChrono.length === 1 ? nightsChrono[0] : null;
    if (!n || !Array.isArray(n.tchEpochs) || !n.tchEpochs.length) return null;
    var block = {
      doc: '5-min epochs — cross-node feed for three-cornered-hat: hr = median pulse-HR (bpm), motionIndex = mean O2Ring motion count. HR-hat 3rd corner (ECG+PPG+Oxy) + a 2nd per-epoch motion series for the correlated-TCH ρ.',
      epochs: n.tchEpochs
    };
    /* ADDITIVE. Consumers that read `epochs` are untouched; `spo2` is a new sibling. Absent rather
       than empty when it cannot be built, so a reader can tell "this export predates the field" from
       "this night had no usable SpO2". */
    if (Array.isArray(n.spo2Series) && n.spo2Series.length) {
      block.spo2 = {
        doc: 'SpO₂ at the recorded 1 Hz, on a uniform grid from startEpochMs. values[i] is the saturation (%) at startEpochMs + i*1000 ms; null = the device reported no sample for that second — NOT zero and NOT the previous value. Emitted at source rate deliberately: binning is a bandwidth claim this node has not measured.',
        hz: 1,
        n: n.spo2Series.length,
        values: n.spo2Series
      };
    }
    /* ADDITIVE sibling, same grid, same absence rule. This is the O2Ring corner of the per-second
       three-cornered hat: `analysis-stats.js tchSigmasFused(hh, vv, oo, cH, cV, cO)` wants three
       ALIGNED per-second HR series, and the worker assigns this corner `cO = 1` outright ("native
       pulse — a smoothed device integer, cannot over-detect ⇒ trust 1"), so the O2Ring needs no
       confidence channel — only this. Absent rather than empty when unbuildable. */
    if (Array.isArray(n.hrSeries) && n.hrSeries.length) {
      block.hr = {
        doc: 'Pulse rate at the recorded 1 Hz, on the SAME uniform grid as spo2 (from startEpochMs). values[i] is the rate (bpm) at startEpochMs + i*1000 ms; null = the device reported no usable sample for that second — NOT zero and NOT the previous value. Index-aligned with spo2.values by construction (a row is kept only if BOTH columns parse and clear their sanity bands). This is the per-second series the three-cornered hat consumes; the 5-min epochs[].hr median is a summary of it, not a substitute — and `median(1 Hz rate)` is NOT the statistic ECGDex publishes (`60000/mean(RR)`), a confound worth ~0.3 bpm (R5-HR-TRIPLET-FOLLOWUPS §3), so do not difference the two nodes’ epoch HR and call it a device bias.',
        hz: 1,
        n: n.hrSeries.length,
        values: n.hrSeries
      };
    }
    return block;
  }
  function oxyComputeNight(input, fname) {
    var rows = _oxyRowsFromInput(input);
    if (!rows || rows.length < 1) return null;
    return processNight(rows, fname || null);
  }

  // Public namespace — the headless surface the orchestrator + app both reach.
  var OxyDex = typeof OxyDex !== 'undefined' && OxyDex ? OxyDex : {};
  OxyDex.compute = function (input, opts) {
    opts = opts || {};
    var fname = opts.fname || (input && input.provenance && input.provenance.files && input.provenance.files[0]) || (input && input.fname) || null;
    var night = oxyComputeNight(input, fname);
    if (!night) return null;
    var kfmt = opts.kernel ? { version: opts.kernel.VERSION, hash: opts.kernel.HASH } : null;
    var el = oxyBuildNightElement(night, { provenance: opts.provenance !== undefined ? opts.provenance : null, kernel: kfmt, ecgFusion: null, ansAge: null });
    var t0 = night.t0Ms != null ? night.t0Ms : null;
    var schema = {
      name: 'ganglior.node-export',
      version: '2.0',
      node: 'OxyDex',
      nodeVersion: '1.0',
      multiNight: false,
      generated: opts.generated || new Date().toISOString(),
      provenance: opts.provenance !== undefined ? opts.provenance : null,
      doc: 'OxyDex single-night SpO₂/oximetry summary computed headless from a SignalFrame(spo2). Emits ganglior_events[] (desat_event from desatProfile + periodic_breathing from oscillation episodes); OxyDex infers respiration from an SpO₂ proxy, not airflow. tMs = floating wall-clock ms (UTC getters); null = unknown, never fabricated.'
    };
    if (opts.ingest) schema.ingest = opts.ingest; // adapter provenance (unifier/OverDex path)
    var _out = {
      kernel: kfmt,
      schema: schema,
      recording: {
        source: 'spo2',
        startEpochMs: t0,
        offsetMin: opts.offsetMin != null ? opts.offsetMin : null,
        durationMin: night.stats ? night.stats.durationMin : null,
        beats: night.stats ? night.stats.n : null,
        coveragePct: null
      },
      ganglior_events: oxyBuildGangliorEvents([night]),
      timeseries: oxyBuildTimeseriesBlock([night]),
      nights: [el]
    };
    /* SPARSE COVERAGE — INTEGRATOR-GAP-AWARE-OVERLAP part 2. `durationMin` above is the ENVELOPE the
       oximeter spanned; on a night where the ring lost contact it contains time no oximeter was
       recording, and the Integrator divided a confirmed apnea count by all of it. `coveragePct` beside
       it stays null — a different, still-unfilled field, and the two must not be read as each other.
       Assigned conditionally so a contiguous night's export stays byte-identical.
       Kept OUT of the literal deliberately: NODE-EXPORT-RECORDING-DURATION §4.3's gate source-scans
       for a `recording: {` block and reads the duration keys inside it, so the literal must survive
       intact — hoisting it into a variable makes that gate blind. */
    if (night.coverage) _out.recording.coverage = night.coverage;
    /* FINISHED-WORK-IMPROVEMENTS §A 2a — RTC verification against a `*_rtclog.csv` sidecar. Attached
       CONDITIONALLY (same coveragePct posture), so every committed fixture whose input carried no
       sidecar keeps its export bytes intact. `timingSource:'device+host-verified'` and its offset
       land only when the drop-batch matcher found a `read` event within ±12 h of `t0Ms`;
       `rtcResetSuspect:true` marks a battery-event window inside the night and BLOCKS verification
       (a reset's offset is unmeasured by definition). Never a time SHIFT — declare, never correct
       (`oxydex-dsp.js:3235`). */
    if (night.timingSource) _out.recording.timingSource = night.timingSource;
    if (night.rtcOffsetS != null && isFinite(night.rtcOffsetS)) _out.recording.rtcOffsetS = night.rtcOffsetS;
    if (night.rtcVerifiedAtMs != null && isFinite(night.rtcVerifiedAtMs)) _out.recording.rtcVerifiedAtMs = night.rtcVerifiedAtMs;
    if (night.rtcResetSuspect) _out.recording.rtcResetSuspect = true;
    return _out;
  };
  OxyDex.computeNight = oxyComputeNight;
  OxyDex.buildNightElement = oxyBuildNightElement;
  OxyDex.buildGangliorEvents = oxyBuildGangliorEvents;
  OxyDex.buildTimeseriesBlock = oxyBuildTimeseriesBlock;
  OxyDex.buildEpochSeries = oxyBuildEpochSeries;
  // SELF-INGEST (SELF-INGEST-2026-06-27): the pure self-reload + share-scrub surface, exposed on the
  // namespace so BOTH the app (readFile routing) and the test runners reach the SAME functions.
  OxyDex.loadOwnExport = oxyLoadOwnExport;
  OxyDex.scrubExport = oxyScrubExport;
  // Pure SpO₂ CSV parser exposed on the namespace so the co-load host (signal-orchestrate
  // §3) can hand it to the oxydex-spo2 adapter via ctx.parseCSV WITHOUT a bare global —
  // in the namespaced realm `parseCSV` no longer sprays onto window.
  OxyDex.parseCSV = parseCSV;
  // OXYDEX-HR-ARTIFACT-RUNAWAY-FIX Fix 2: expose the warm-up trim for the regression harness + any
  // headless caller that wants to pre-clean rows the way processNight does.
  OxyDex.trimSensorWarmup = trimSensorWarmup;
  OxyDex.coverage = oxyCoverage; // INTEGRATOR-GAP-AWARE-OVERLAP part 2 — pure, so the segment derivation is gateable
  OxyDex.cleanArtifactHR = cleanArtifactHR; // exposed for the OXYDEX-HR-ARTIFACT-RUNAWAY-FIX regression gate
  OxyDex.computeGatedNadir = computeGatedNadir; // exposed for the OXYDEX-NADIR-HONESTY regression gate
  // TRIO-BATCH-O2RING-DAT: the O2Ring writes a native .dat beside the vendor CSV, and when the CSV
  // export stops the .dat is all that survives. The browser drop path already decodes it; compute()
  // takes {samples|rows|text} and never bytes, so a headless caller (tools/trio-batch.mjs) needs the
  // SAME decoder rather than a second copy of the 3-byte layout / 0xFFFF trailer / motion×2 rules.
  OxyDex.isO2RingBin = isO2RingBin;
  OxyDex.decodeO2RingBinToCSV = decodeO2RingBinToCSV;
  // FINISHED-WORK-IMPROVEMENTS §A 2a — RTC sidecar helpers, exposed pure so the test suite can hit
  // them without a browser drop batch or the DSP realm's file-input plumbing.
  OxyDex.parseRingClockLog = parseRingClockLog;
  OxyDex._attachRtcVerification = _o2AttachRtcVerification;
  OxyDex._attachAcqEvidence = _o2AttachAcqEvidence;
  // Waveform SpO₂ (0x05 pair) — pure, exposed for the test suite + headless callers.
  OxyDex.parsePPG2W = parsePPG2W;
  OxyDex.spo2WaveformTrend = spo2WaveformTrend;

  // ════════════════════════════════════════════════════════════════════════
  //  WAVEFORM-DERIVED SpO₂ TREND (owner-ordered ship, 2026-08-20; moved PpgDex→OxyDex same day — OxyDex is the SpO₂ node — experimental tier)
  //  O2RING-RAW-DUAL-WAVELENGTH §1.2④-REOPENED: the 0x05 two-channel ratio tracks the device's own
  //  SpO₂ at corpus scale (19,006 bins, pooled r 0.500, LOO [0.484,0.511], monotonic dose–response;
  //  functionally ch0=IR, ch1=RED). This ships it HONESTLY: per-session SELF-CALIBRATED against the
  //  co-recorded device SpO₂ (a per-device regression, never a universal curve), badged experimental,
  //  and REFUSED (usable:false + reason) when the pair is absent or the session's ratio does not
  //  track. The device SpO₂ is never replaced — the trend is a second, waveform-provenance estimate
  //  rendered beside it.
  // ════════════════════════════════════════════════════════════════════════

  /** Parse the capture host's `_PPG2W.txt` (Phone timestamp;sensor ns;channel 0;channel 1;motion).
   *  Strict Clock Contract: the ISO phone stamp via the local parseTimestamp; no fabricated dates.
   *  Returns { t0Ms, rows:[{tMs, ch0, ch1, motion}] } or { rows: [] } when nothing parses. */
  function parsePPG2W(text) {
    var rows = [];
    var lines = String(text || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (!ln || ln.charCodeAt(0) === 0x50 /* 'P'hone header */) continue;
      var p = ln.split(';');
      if (p.length < 5) continue;
      var ts = parseTimestamp(p[0]);
      if (!ts) continue;
      var a = +p[2],
        b = +p[3],
        mo = +p[4];
      if (!isFinite(a) || !isFinite(b)) continue;
      rows.push({ tMs: ts.tMs, ch0: a, ch1: b, motion: isFinite(mo) ? mo : 0 });
    }
    return { t0Ms: rows.length ? rows[0].tMs : null, rows: rows };
  }

  /** Per-buffer {ac, dc}: linear-detrended RMS + |mean|. RMS (not peak-to-peak) won the 2026-08-20
   *  brute-force sweep — 1344 estimator/model configs over all 49 corpus sessions; the winning config
   *  (RMS AC · 60 s mean bins · +10 s firmware lag) holds LOO held-out pooled r 0.659, per-session
   *  median r 0.723, 28/28 positive, RMSE 0.56 %. PURE. */
  function _w2AcDc(vals) {
    var n = vals.length;
    var m = 0;
    for (var i = 0; i < n; i++) m += vals[i];
    m /= n;
    var mx = (n - 1) / 2,
      sxx = 0,
      sxy = 0;
    for (i = 0; i < n; i++) {
      sxx += (i - mx) * (i - mx);
      sxy += (i - mx) * (vals[i] - m);
    }
    var sl = sxx > 0 ? sxy / sxx : 0;
    var ss = 0,
      cnt = 0;
    for (i = 2; i < n - 2; i++) {
      var v = vals[i] - m - sl * (i - mx);
      ss += v * v;
      cnt++;
    }
    return { ac: cnt ? Math.sqrt(ss / cnt) : 0, dc: Math.abs(m) };
  }

  /** The trend: buffer-split (re-anchor jumps), per-buffer R = (AC/DC)₀/(AC/DC)₁, 60 s MEAN bins,
   *  device series read at +10 s lag (the firmware's own averaging delay — its 1 Hz output lags the
   *  waveform that produced it; sweep-measured, peak of the lag marginal), per-session OLS
   *  self-calibration SpO₂ ≈ a + b·R against the co-recorded device series, and the calibrated
   *  waveform trend + summary. The three knobs (RMS AC · 60 s mean · +10 s lag) are the winners of
   *  the 2026-08-20 brute-force sweep (1344 configs, 49 sessions, LOO-validated — see the brief's
   *  full-corpus re-fit block); 60 s bins are the single biggest lever (marginal median r 0.368 at
   *  5 s → 0.585 at 60 s). REFUSES (usable:false + reason) rather than guessing:
   *  no device series → 'no co-recorded device SpO₂ (self-calibration impossible)';
   *  < 40 usable bins → 'too little paired data'; |r| < 0.3 → 'ratio does not track this session'.
   *  The r floor is the honesty gate — an uncalibratable session must not render a trend. */
  function spo2WaveformTrend(rec, spo2Rows, opts) {
    opts = opts || {};
    var binS = opts.binS || 60;
    var lagS = opts.lagS != null ? opts.lagS : 10;
    /** @type {{usable:boolean, reason:(string|null), bins:any[], calib:(any|null), summary:(any|null), trend?:any[], oneHz?:any[], compare?:(any|null)}} */
    var out = { usable: false, reason: null, bins: [], calib: null, summary: null };
    if (!rec || !rec.rows || rec.rows.length < 5000) {
      out.reason = 'no usable ppg2w stream (need ≥5000 samples)';
      return out;
    }
    if (!spo2Rows || !spo2Rows.length) {
      out.reason = 'no co-recorded device SpO₂ (self-calibration impossible)';
      return out;
    }
    var sp = {};
    for (var i = 0; i < spo2Rows.length; i++) sp[Math.floor(spo2Rows[i].tMs / 1000)] = spo2Rows[i].spo2;
    // buffer split at re-anchor jumps (|Δ − modal| ≥ 3 ms)
    var rows = rec.rows,
      d = [],
      hist = {};
    for (i = 1; i < rows.length; i++) {
      var dd = Math.round(rows[i].tMs - rows[i - 1].tMs);
      d.push(dd);
      hist[dd] = (hist[dd] || 0) + 1;
    }
    var modal = null,
      best = -1;
    for (var k in hist)
      if (hist[k] > best) {
        best = hist[k];
        modal = +k;
      }
    if (modal == null) {
      out.reason = 'no cadence';
      return out;
    }
    var pts = [],
      s0 = 0;
    var flush = function (b) {
      if (b.length < 90) return;
      var A = _w2AcDc(
        b.map(function (r) {
          return r.ch0;
        })
      );
      var B = _w2AcDc(
        b.map(function (r) {
          return r.ch1;
        })
      );
      if (A.dc < 1 || B.dc < 1 || A.ac <= 0 || B.ac <= 0) return;
      var R = A.ac / A.dc / (B.ac / B.dc);
      var tm = b[(b.length / 2) | 0].tMs;
      var sec = Math.floor(tm / 1000) + lagS;
      var s = sp[sec] != null ? sp[sec] : sp[sec - 1] != null ? sp[sec - 1] : sp[sec + 1];
      if (s != null && isFinite(R) && R > 0) pts.push({ tMs: tm, R: R, s: s });
    };
    for (i = 0; i < d.length; i++) {
      if (Math.abs(d[i] - modal) >= 3) {
        flush(rows.slice(s0, i + 1));
        s0 = i + 1;
      }
    }
    flush(rows.slice(s0));
    // 60 s MEAN bins (sweep winner — mean beats median at every bin width, marginal 0.549 vs 0.482)
    var bins = {},
      kk;
    var med = function (a) {
      var s2 = a.slice().sort(function (x, y) {
        return x - y;
      });
      return s2.length ? s2[s2.length >> 1] : null;
    };
    // only ever called behind the ≥8-points-per-bin guard, so a.length > 0 by construction
    var avg = function (a) {
      var t2 = 0;
      for (var j = 0; j < a.length; j++) t2 += a[j];
      return t2 / a.length;
    };
    for (i = 0; i < pts.length; i++) {
      kk = Math.floor(pts[i].tMs / (binS * 1000));
      if (!bins[kk]) bins[kk] = { R: [], s: [], t: [] };
      bins[kk].R.push(pts[i].R);
      bins[kk].s.push(pts[i].s);
      bins[kk].t.push(pts[i].tMs);
    }
    var B2 = [];
    for (kk in bins) if (bins[kk].R.length >= 8) B2.push({ tMs: med(bins[kk].t), R: avg(bins[kk].R), s: avg(bins[kk].s) });
    B2.sort(function (a, b) {
      return a.tMs - b.tMs;
    });
    if (B2.length < 40) {
      out.reason = 'too little paired data (' + B2.length + ' bins, need ≥40)';
      return out;
    }
    // OLS self-calibration SpO₂ = a + b·R, and its r
    var n = B2.length,
      mR = 0,
      mS = 0;
    for (i = 0; i < n; i++) {
      mR += B2[i].R;
      mS += B2[i].s;
    }
    mR /= n;
    mS /= n;
    var sRR = 0,
      sSS = 0,
      sRS = 0;
    for (i = 0; i < n; i++) {
      var dr = B2[i].R - mR,
        ds = B2[i].s - mS;
      sRR += dr * dr;
      sSS += ds * ds;
      sRS += dr * ds;
    }
    if (!(sRR > 0) || !(sSS > 0)) {
      out.reason = 'zero variance — nothing to calibrate against';
      return out;
    }
    var r = sRS / Math.sqrt(sRR * sSS);
    if (!(r >= 0.3)) {
      out.reason = 'ratio does not track this session (r=' + r.toFixed(2) + ' < 0.3) — trend refused';
      return out;
    }
    var b1 = sRS / sRR,
      a1 = mS - b1 * mR;
    var trend = B2.map(function (bb) {
      var w = a1 + b1 * bb.R;
      return { tMs: bb.tMs, spo2w: Math.max(60, Math.min(100, w)), dev: bb.s };
    });
    var ws = trend.map(function (t) {
      return t.spo2w;
    });
    out.usable = true;
    out.bins = B2;
    out.calib = { a: a1, b: b1, r: r, n: n };
    out.trend = trend;
    out.summary = {
      medianSpo2w: med(ws),
      minSpo2w: Math.min.apply(null, ws),
      pctBelow90:
        Math.round(
          (ws.filter(function (w) {
            return w < 90;
          }).length /
            ws.length) *
            1000
        ) / 10,
      trackR: Math.round(r * 1000) / 1000,
      bins: n
    };
    /* ── 1 Hz SIGNAL + FIRMWARE COMPARATOR (owner-ordered 2026-08-20) ──────────────────────────────
       ECGDex's alignFirmwareRR pattern transposed to SpO₂: the device's own 1 Hz output is compared
       second-by-second against a waveform-derived 1 Hz signal, and the DECAY STRUCTURE is reported,
       never averaged over — a comparison whose agreement silently degrades produces a number rather
       than an error, which is the failure mode this suite keeps paying for (ECGDex measured a night
       flat at ~2.3 ms for five deciles then climbing to 30 ms while every whole-record summary stayed
       green). Direct transpositions: the per-decile |error| fan replaces the per-decile |ΔRR| fan; the
       baseline is the BEST decile (not the first — a bad start must not become the yardstick); the
       tolerance is the looser of 3× best and the DEVICE'S 1 % DISPLAY QUANTUM, which plays exactly the
       role ECGDex gives one ECG sample period — a disagreement below the output's own resolution is
       not a detectable disagreement at all.
       ⚠️ The whole-record BIAS is ~0 BY CONSTRUCTION (the OLS self-calibration zeroes the mean
       residual over its bins), so bias is reported for honesty but carries no information — the fan,
       the worst window, and the longest within-tolerance run are the content. */
    var oneHzHalf = Math.floor(binS / 2);
    var secAgg = {};
    for (i = 0; i < pts.length; i++) {
      var sc = Math.floor(pts[i].tMs / 1000);
      if (!secAgg[sc]) secAgg[sc] = { sum: 0, n: 0 };
      secAgg[sc].sum += pts[i].R;
      secAgg[sc].n++;
    }
    var secKeys = Object.keys(secAgg)
      .map(Number)
      .sort(function (x, y) {
        return x - y;
      });
    var firstSec = secKeys[0];
    var span = secKeys[secKeys.length - 1] - firstSec + 1;
    var series = [];
    if (span > 0 && span < 48 * 3600) {
      var pSum = new Float64Array(span + 1);
      var pN = new Float64Array(span + 1);
      for (i = 0; i < span; i++) {
        var ag = secAgg[firstSec + i];
        pSum[i + 1] = pSum[i] + (ag ? ag.sum : 0);
        pN[i + 1] = pN[i] + (ag ? ag.n : 0);
      }
      for (i = 0; i < span; i++) {
        var loW = Math.max(0, i - oneHzHalf);
        var hiW = Math.min(span, i + oneHzHalf + 1);
        var nW = pN[hiW] - pN[loW];
        if (nW < 8) continue; // a second whose window holds under 8 buffers renders nothing — §2.6
        var wv = a1 + (b1 * (pSum[hiW] - pSum[loW])) / nW;
        series.push({ sec: firstSec + i, spo2w: Math.max(60, Math.min(100, wv)) });
      }
    }
    out.oneHz = series;
    /* Pair each 1 Hz second with the device value at the same +lag the calibration used — with the
       device side put through the SAME 60 s centered mean as the waveform side. ECGDex's
       corrected-vs-corrected rule: both sides at one bandwidth, or a fast real transient (a desat!)
       reads as estimator disagreement when it is only a bandwidth mismatch. */
    var dSecs = Object.keys(sp)
      .map(Number)
      .sort(function (x, y) {
        return x - y;
      });
    var dFirst = dSecs.length ? dSecs[0] : 0;
    var dSpan = dSecs.length ? dSecs[dSecs.length - 1] - dFirst + 1 : 0;
    var devAt = function (sec2) {
      return sp[sec2] != null ? sp[sec2] : sp[sec2 - 1] != null ? sp[sec2 - 1] : sp[sec2 + 1];
    };
    var devSmooth = devAt; // fallback: raw lookup when the span is degenerate
    if (dSpan > 0 && dSpan < 48 * 3600) {
      var dpSum = new Float64Array(dSpan + 1);
      var dpN = new Float64Array(dSpan + 1);
      for (i = 0; i < dSpan; i++) {
        var dvv = sp[dFirst + i];
        dpSum[i + 1] = dpSum[i] + (dvv != null ? dvv : 0);
        dpN[i + 1] = dpN[i] + (dvv != null ? 1 : 0);
      }
      devSmooth = function (sec2) {
        var lo2 = Math.max(0, sec2 - dFirst - oneHzHalf);
        var hi2 = Math.min(dSpan, sec2 - dFirst + oneHzHalf + 1);
        if (hi2 <= lo2) return null;
        var nn2 = dpN[hi2] - dpN[lo2];
        // require the device window at least half-populated — a sparse window is not the same signal
        return nn2 >= (hi2 - lo2) / 2 ? (dpSum[hi2] - dpSum[lo2]) / nn2 : null;
      };
    }
    var pairs = [];
    for (i = 0; i < series.length; i++) {
      var dv = devSmooth(series[i].sec + lagS);
      if (dv != null) pairs.push({ w: series[i].spo2w, d: dv });
    }
    out.compare = null;
    if (pairs.length >= 300) {
      // 300 paired seconds = 5 min, mirroring ECGDex's RR_ALIGN_MIN_PAIRS floor
      var sumE = 0;
      var sumAbs = 0;
      var sumSq = 0;
      var w1 = 0;
      var w2c = 0;
      for (i = 0; i < pairs.length; i++) {
        var e = pairs[i].w - pairs[i].d;
        sumE += e;
        sumAbs += Math.abs(e);
        sumSq += e * e;
        if (Math.abs(e) <= 1) w1++;
        if (Math.abs(e) <= 2) w2c++;
      }
      var mW = 0;
      var mD = 0;
      for (i = 0; i < pairs.length; i++) {
        mW += pairs[i].w;
        mD += pairs[i].d;
      }
      mW /= pairs.length;
      mD /= pairs.length;
      var sWW = 0;
      var sDD = 0;
      var sWD = 0;
      for (i = 0; i < pairs.length; i++) {
        sWW += (pairs[i].w - mW) * (pairs[i].w - mW);
        sDD += (pairs[i].d - mD) * (pairs[i].d - mD);
        sWD += (pairs[i].w - mW) * (pairs[i].d - mD);
      }
      var rHz = sWW > 0 && sDD > 0 ? sWD / Math.sqrt(sWW * sDD) : null;
      // per-decile median |error| — the fan a single median hides
      var W = 10;
      var stepW = Math.floor(pairs.length / W);
      var byWindow = [];
      for (var kd = 0; kd < W; kd++) {
        var errs = [];
        for (i = kd * stepW; i < (kd + 1) * stepW && i < pairs.length; i++) errs.push(Math.abs(pairs[i].w - pairs[i].d));
        if (!errs.length) {
          byWindow.push(null);
          continue;
        }
        errs.sort(function (x, y) {
          return x - y;
        });
        byWindow.push(Math.round(errs[errs.length >> 1] * 100) / 100);
      }
      var seenW = byWindow.filter(function (v) {
        return v != null;
      });
      var bestW = seenW.length ? Math.min.apply(null, seenW) : null;
      var worstW = seenW.length ? Math.max.apply(null, seenW) : null;
      // tolerance: looser of 3× best and the device's 1 % display quantum (the "one sample" floor)
      var tol = bestW != null ? Math.max(3 * bestW, 1.0) : Infinity;
      var nonUniform = bestW != null && worstW != null && worstW > tol;
      // longest contiguous within-tolerance run of deciles — where the match holds, not just how long
      var runFrom = -1;
      var runTo = -1;
      var bestLen = 0;
      var curFrom = -1;
      for (var kk2 = 0; kk2 <= byWindow.length; kk2++) {
        var wv2 = kk2 < byWindow.length ? byWindow[kk2] : null;
        if (wv2 != null && wv2 <= tol) {
          if (curFrom < 0) curFrom = kk2;
        } else {
          if (curFrom >= 0 && kk2 - curFrom > bestLen) {
            bestLen = kk2 - curFrom;
            runFrom = curFrom;
            runTo = kk2 - 1;
          }
          curFrom = -1;
        }
      }
      out.compare = {
        n: pairs.length,
        bias: Math.round((sumE / pairs.length) * 1000) / 1000,
        mae: Math.round((sumAbs / pairs.length) * 100) / 100,
        rmse: Math.round(Math.sqrt(sumSq / pairs.length) * 100) / 100,
        r: rHz != null ? Math.round(rHz * 1000) / 1000 : null,
        within1Pct: Math.round((w1 / pairs.length) * 1000) / 10,
        within2Pct: Math.round((w2c / pairs.length) * 1000) / 10,
        byWindow: byWindow,
        best: bestW,
        worst: worstW,
        tol: Math.round(tol * 100) / 100,
        nonUniform: nonUniform,
        runFrom: runFrom,
        runTo: runTo
      };
    }
    return out;
  }

  // ── public namespace (always) ──
  root.OxyDex = OxyDex;

  // ── app back-compat: re-export the bare DSP globals UNLESS co-loaded namespaced ──
  // ESM-MIGRATION Phase 4: the bare-helper surface, exposed ON the namespace so the ESM UI
  // modules destructure it explicitly (const { … } = window.OxyDex._bare) instead of depending
  // on the bare-global spray below — which now serves ONLY the non-namespaced classic realms
  // (the test suite + the six workers, a deliberate test-access surface, not debt).
  var BARE = {
    CFG,
    APP_VERSION,
    _parserSource,
    _fi,
    ua,
    isO2RingBin,
    _o2p2,
    tzOffset,
    _ckNumEpoch,
    _ckZoneMin,
    _ckDMY,
    parseTimestamp,
    _o2DateAnchorMs,
    _o2BinStartMs,
    decodeO2RingBinToCSV,
    handleFiles,
    readFile,
    parseCSV,
    parseTime,
    cleanArtifactHR,
    trimSensorWarmup,
    filterArtifactSpikes,
    computeCT94,
    computeDesatSlopes,
    computePBmetrics,
    computeSleepArch,
    computeODI1,
    computeMOS,
    computeAHIestimates,
    computeNightExtras,
    computeRollingMetrics,
    computePatternScores,
    computeDFA,
    computeSpO2FFT,
    computeHREntropy,
    computeSympSurge,
    computeCircadianHR,
    computeSpO2Entropy,
    computeHypoxicLoad,
    computeVagalIndex,
    computeRecoveryIndex,
    computeSleepPressure,
    computeBreathingIrregularity,
    computeOxyCrash,
    computeHRNoctDip,
    computeDesatAsymmetry,
    computeSmartSummary,
    buildImpression,
    processNight,
    computeStats,
    computeTIndex,
    computeHRV,
    detectDesatEvents,
    detectDesatEventsGated,
    detectODI,
    detectSpikes,
    detectPeriodicity,
    parseTimeStr,
    detectOscillations,
    detectSpO2Periodicity, // OXYDEX-PB-DETECTOR §2 — SpO2 periodicity. NOT detectPeriodicity above, which is the HR-SPIKE detector (line ~3239) and is a different measurement on different input
    _flagSev,
    buildFlags,
    computeHypoxicBurden,
    computeMotionProfile,
    _motionColumnStuck,
    computeSleepStabilityScore,
    SELFGATE,
    selfGateDesat,
    computeDesaturationProfile,
    computeHRProfile,
    computeMotionSleep,
    computeCrossSignal,
    computeSpO2Advanced,
    computeHRAdvanced,
    computeComposite,
    linReg,
    computeGatedNadir,
    computeSpO2Drift,
    computeODI2,
    computeSpO2Overshoot,
    computeSpO2Autocorr,
    computeHRFreqBands,
    computeRespRateProxy,
    computeHRAsymmetry,
    computeHRQuartileTrend,
    computeSpO2HRLag,
    computeSpikeDecay,
    computeSpikeUndershoot,
    computeSpikeRiseRate,
    computeDataGaps,
    computeHRFlatlines,
    computeSpO2Ceiling,
    computeODRI,
    computeSpO2Percentiles,
    computeSpO2Shape,
    computeHRCV,
    computeHypoxicDose,
    computeT88T85,
    computeLCSP,
    computePoincareSD,
    computeO2HREfficiency,
    computeConditionalSpO2,
    computeNadirTrend,
    computeIEI,
    computeRecoverySlopeCV,
    computeHRNadirTime,
    computeSpO2NadirTime,
    computeRMSSDarc,
    computeSpike50PctRecovery,
    computeSleepStageProxy,
    computeVO2maxEstimate,
    computeKarvonenZones,
    computeSBII,
    computePRED3p,
    computeDesSev,
    computeCTprecise,
    parseJSONL,
    avg,
    stdDev,
    fmtDate,
    fmtTime,
    fmtTimeFull,
    pad,
    shortDate,
    oxyBuildNightElement,
    oxyBuildGangliorEvents,
    oxyDesatConf,
    oxyPBConf,
    oxyLoadOwnExport,
    oxyScrubExport,
    _oxyEnsureRows,
    _oxyRowsFromInput,
    oxyComputeNight,
    // Exposed so the SpO2 series can be gated directly. Nothing else consumes it — the export path
    // reaches it through processNight — but a field that ships ungated is a field nobody is defending.
    oxyBuildSpo2Series,
    // FINISHED-WORK-IMPROVEMENTS §A 2a — pure surface for the ring-clock sidecar contract tests.
    parseRingClockLog,
    _attachRtcVerification: _o2AttachRtcVerification,
    _attachAcqEvidence: _o2AttachAcqEvidence
  };
  OxyDex._bare = BARE;
  // DSP→UI hook injection (FOLLOWUPS-II item 3): the co-loaded UI modules register their
  // setStatus/setProgress/renderAll/showError/upVO2category here; headless callers never register,
  // so the no-op/null defaults hold and the export is byte-identical.
  OxyDex.setHooks = setHooks;
  OxyDex.getHooks = getHooks;
  // mutable cross-file state, namespace-proxied — the DSP closure owns `allNights`; the app
  // module bridges window.allNights to this on its own page (the guarded window proxy below
  // keeps serving the non-namespaced classic realms).
  Object.defineProperty(OxyDex, 'allNights', {
    configurable: true,
    get: function () {
      return allNights;
    },
    set: function (v) {
      allNights = v;
    }
  });
  // ESM-MIGRATION-FOLLOWUPS-II items 1-2: the bare-global back-compat spray was REMOVED. Every realm is
  // now namespaced — the app page sets __DEX_NAMESPACED__ and destructures `OxyDex._bare`, the test
  // runner co-loads namespaced, and cohort-worker sets __DEX_NAMESPACED__ and pulls parseCSV/processNight
  // from `OxyDex._bare` explicitly. Nothing consumes a bare `OxyDex` helper or bare `allNights` any more,
  // so neither the `Object.assign(root, BARE)` spray nor its mutable-state proxy is emitted.
})(/** @type {any} */ (typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));

// ESM-MIGRATION (deep-3 fan-out): dsp is now a DUAL-MODE module. The IIFE above still attaches
// window.OxyDex (the external node API + every classic co-load consumer — the orchestrators and
// both test runners, which classic-load this file via tools/build-core.js `classicify`) and, when
// not namespaced, the bare-global back-compat spray (incl. the `allNights` mutable proxy). This
// re-export lets the owned ESM bundle's oxydex-app.js import edge replace tag-order convention.
export const OxyDex = window.OxyDex;
