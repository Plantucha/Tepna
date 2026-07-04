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
;(function (root) {
window.UP = window.UP || {};
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
  HR_SPIKE_MIN_PEAK: 75,     // node-local: sensitivity floor of OxyDex's oximeter-pulse arousal/spike detector (no other node detects HR "spikes")
  SPIKE_COOLDOWN_SEC: 30,    // node-local: spike-detector refractory window (algorithmic, not a physiology grade)
  SPO2_OSC_THRESHOLD: 95,    // node-local: SpO2 oscillation crossing level — SpO2 is an OxyDex-only signal; not referenced by any cross-node/fusion logic
  OSC_WINDOW_SEC: 300,       // node-local: 5-min oscillation-analysis window (algorithmic)
  OSC_FLAG_CROSSINGS: 6,     // node-local: min 95%-crossings to flag a periodic-breathing window (detector tuning)
  // O2Ring-S FIRMWARE DEVICE QUIRK — confirmed by Wellue engineering (May 2026, SN 2592302100,
  // fw 1.0.5.0): a timer-driven routine at the top of each clock hour injects a +21–25 BPM step in
  // ONE 1-s sample (SpO2 flat, motion zero), within ±60 s of the hour. Genuinely O2Ring-local —
  // never a kernel constant; no other device/node exhibits it.
  HR_ARTIFACT_JUMP: 20,        // node-local: BPM jump in 1 sample — always artifact (physiologically impossible)
  HR_ARTIFACT_JUMP_SOFT: 15,   // node-local: BPM jump in 1 sample within ±2min of a clock hour — clock-aligned O2Ring artifact
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
  WARMUP_MIN_SEC: 5,       // shortest frozen edge-run to treat as warm-up (≈samples @1 Hz); a 2–3 s flat is normal real signal → kept
  WARMUP_MAX_SEC: 300,     // never trim more than 5 min of edge as warm-up (safety cap)
  WARMUP_SPO2_STEP: 4,     // min abrupt SpO2 step at the perfusion-lock boundary confirming the frozen run was a placeholder (OR'd with |ΔHR|≥HR_ARTIFACT_JUMP)
  // OXYDEX-NADIR-HONESTY (RUNAWAY-FIX-FOLLOWUPS §1/§2) — the headline nadir (minSpo2 / SPO2_CRITICAL_DIP /
  // impression) ignores non-physiological lows: an opening perfusion-settling RAMP (§1) + self-gated
  // ARTIFACT desaturations (§2, the tested SELFGATE verdict). Node-local; SpO2 is an OxyDex-only signal.
  NADIR_RAMP_START_MAX: 88,  // opening qualifies as a settling ramp only if the FIRST sample is ≤ this
  NADIR_RAMP_RECOVER: 90,    // …and it climbs to ≥ this (a normal plateau)
  NADIR_RAMP_MAX_SEC: 120    // …within this many seconds (else it is real low SpO2, not sensor settling)
};

// Capture clean parser source for self-download (runs before any results are rendered)
var APP_VERSION = 'v1.0.0';
var _parserSource = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;

var allNights = {};

// ═══════════════════════════════════════════
// FILE HANDLING
// ═══════════════════════════════════════════
var _fi=document.getElementById('fileInput');
if(_fi) {
  // 'change' fires on desktop; 'input' is more reliable on Android Chrome
  var _lastFileSelect = 0;
  function _onFileSelect(e) {
    var now = Date.now();
    if (now - _lastFileSelect < 500) return;
    _lastFileSelect = now;
    var files = Array.from((e.target.files || e.target && e.target.files) || []);
    if (files.length) { handleFiles(files); }
  }
  _fi.addEventListener('change', _onFileSelect);
  _fi.addEventListener('input',  _onFileSelect);  // Android backup
}
var ua = document.getElementById('uploadArea');
if(ua){                                              // Phase-9: guard so oxydex-dsp.js loads headless (isolation host has no #uploadArea — SIGNAL-ADAPTER-FOLLOWUPS §4)
  ua.addEventListener('dragover',  function(e){ e.preventDefault(); ua.classList.add('drag'); });
  ua.addEventListener('dragleave', function(){ ua.classList.remove('drag'); });
  ua.addEventListener('drop', function(e){
    e.preventDefault(); ua.classList.remove('drag');
    var files = Array.from(e.dataTransfer.files||[]);
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
function isO2RingBin(bytes){
  if(!bytes || bytes.length < 40) return false;
  if(bytes[0]!==0x01 || bytes[1]!==0x03) return false;   // signature
  for(var i=2;i<=7;i++){ if(bytes[i]!==0x00) return false; }
  if(bytes[8]!==0x04 || bytes[9]!==0x00) return false;
  return true;
}
function _o2p2(n){ return n<10 ? '0'+n : ''+n; }

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
var tzOffset = DexClock.tzOffset, _ckP2 = DexClock._ckP2, _ckNumEpoch = DexClock._ckNumEpoch,
    _ckZoneMin = DexClock._ckZoneMin, _ckDMY = DexClock._ckDMY, parseTimestamp = DexClock.parseTimestamp;
// Floating-ms date anchor (00:00) for a recording: filename 14-digit date, else
// file.lastModified (as floating wall-clock), else null. Used for time-only rows.
function _o2DateAnchorMs(fname, file){
  var m = String(fname||'').match(/(\d{14})/);
  if(m){ var s=m[1]; return Date.UTC(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8)); }
  if(file && file.lastModified){ var fl=_ckNumEpoch(file.lastModified);
    if(fl){ var d=new Date(fl.tMs); return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()); } }
  return null;
}
// Start instant (floating wall-clock ms) for the .bin decoder.
function _o2BinStartMs(fname, file){
  var m = String(fname||'').match(/(\d{14})/);
  if(m){ var p=parseTimestamp(m[1]); if(p) return p.tMs; }
  if(file && file.lastModified){ var fl=_ckNumEpoch(file.lastModified); if(fl) return fl.tMs; }
  var nowFl=_ckNumEpoch(Date.now()); return nowFl?nowFl.tMs:0;
}
function decodeO2RingBinToCSV(bytes, fname, file){
  var tMs = _o2BinStartMs(fname, file);            // floating wall-clock ms
  var out = ['Time,Oxygen Level,Pulse Rate,Motion'];
  for(var off=10; off+3<=bytes.length; off+=3){
    var s=bytes[off], h=bytes[off+1], mo=bytes[off+2];
    if(s===0xff && h===0xff) break;                      // end-of-data / trailer
    // ISO timestamp built from floating ms via UTC getters → parseTimestamp step 3
    // (no zone) re-encodes with Date.UTC(components) → identical tMs to the CSV.
    var t = new Date(tMs);
    var iso = t.getUTCFullYear()+'-'+_o2p2(t.getUTCMonth()+1)+'-'+_o2p2(t.getUTCDate())
            +'T'+_o2p2(t.getUTCHours())+':'+_o2p2(t.getUTCMinutes())+':'+_o2p2(t.getUTCSeconds());
    out.push(iso+','+s+','+h+','+(mo*2));
    tMs += 1000;
  }
  return out.join('\n');
}

function handleFiles(files) {
  safeStyle('errorMsg','display','none');
  // SELF-INGEST: a fresh load starts NON-review; readFile re-sets window._oxyReview only when an
  // envelope is among the dropped files (renderAll honors it only if every loaded night is from it).
  try { window._oxyReview = null; } catch(_rv){}
  console.log('[O2Ring] handleFiles called with', files.length, 'files:', files.map(function(f){return f.name;}));
  var _rEl=safeEl('results'); if(!_rEl) return;
  _rEl.innerHTML = '<div class="results-loading">⏳ Reading ' + files.length + ' file' + (files.length>1?'s':'') + '…</div>';
  safeStyle('results','display','block');
  setProgress(3);

  // Per-file progress tracking
  var completed = 0;
  var total = files.length;

  function onFileComplete() {
    completed++;
    var pct = 5 + Math.round((completed / total) * 75); // 5–80% for parsing
    setProgress(pct);
    setStatus('Parsed ' + completed + ' / ' + total + ' file' + (total>1?'s':'') + '…');
  }

  var promises = files.map(function(f){
    return readFile(f).then(function(r){ onFileComplete(); return r; });
  });

  Promise.all(promises).then(function(results){
    setProgress(85);
    setStatus('Building analytics…');
    results.filter(Boolean).forEach(function(r){
      var nightArr = Array.isArray(r) ? r : [r];
      nightArr.forEach(function(night){
        if(!night || !night.date) return;
        // Duplicate check by startTs (same recording imported twice, possibly
        // under a different filename e.g. .csv vs .csv.xls from Excel)
        if (night.stats && night.stats.startTs) {
          var ts = night.stats.startTs;
          var isDup = Object.values(allNights).some(function(ex){
            return ex.stats && ex.stats.startTs && Math.abs(ex.stats.startTs - ts) < 30000;
          });
          if (isDup) {
            if(!window._csvParseErrors) window._csvParseErrors = [];
            window._csvParseErrors.push('Skipped duplicate recording: ' + (night.fname||night.date)
              + ' — same start time as an already-loaded night.');
            return; // skip
          }
        }
        var key = night.date;
        var suffix = 2;
        while (allNights[key]) { key = night.date + '#' + suffix++; }
        night.key = key;
        allNights[key] = night;
      });
    });
    var nights = Object.keys(allNights);
    console.log('[O2Ring] Parsed nights:', Object.keys(allNights).length, JSON.stringify(Object.keys(allNights)));
    if (!nights.length){
      var dbg = window._csvParseErrors && window._csvParseErrors.length
        ? '\n\nDebug info:\n' + window._csvParseErrors.join('\n')
        : '';
      var errMsg = 'No valid data found. Upload raw O2Ring CSV files (O2Ring S *.csv) or pre-processed .json/.jsonl summaries.' + dbg;
      showError(errMsg);
      safeSet('results','innerHTML','<div class="results-error"><strong>⚠️ Parse failed</strong><br>' + errMsg.replace(/\n/g,'<br>') + '</div>');
      safeStyle('results','display','block');
      window._csvParseErrors = [];
      return;
    }
    setProgress(95);
    setStatus('Rendering ' + nights.length + ' night' + (nights.length>1?'s':'') + '…');
    // Small yield to let the progress bar repaint before heavy render
    setTimeout(function(){
      setProgress(100);
  setTimeout(function(){try{if(window._cacheO2CSV&&typeof rawText!=="undefined"&&rawText)window._cacheO2CSV(rawText,(typeof currentFileName!=="undefined"?currentFileName:"")||"o2ring.csv");}catch(e){}},200);
      setStatus('');
      renderAll();
      safeSet('fileInput','value','');
      // Surface any per-file parse warnings as a non-blocking banner
      if(window._csvParseErrors && window._csvParseErrors.length) {
        var warnEl = document.getElementById('results');
        if(warnEl) {
          var banner = document.createElement('details');
          banner.className = 'parse-warning-banner';
          var _errLines = window._csvParseErrors.map(function(e){
            return '<div class="warning-line">' + escHTML(e) + '</div>';
          }).join('');
          banner.innerHTML =
            '<summary class="pwb-summary">'
            + '<span class="pwb-header">⚠️ ' + window._csvParseErrors.length + ' file(s) had parse issues</span>'
            + '<button class="btn btn-outline pwb-dismiss" onclick="event.preventDefault();this.closest(\'.parse-warning-banner\').remove()">✕</button>'
            + '</summary>'
            + '<div class="pwb-body">' + _errLines + '</div>';
          warnEl.insertBefore(banner, warnEl.firstChild);
        }
        window._csvParseErrors = [];
      }
    }, 30);
  }).catch(function(e){
  var errEl = document.getElementById('results');
  if(errEl) {
    errEl.innerHTML = '<div class="results-error-block">'
      + '<strong>⚠ Processing Error</strong><br><code class="error-code">' + String(e) + '</code>'
      + '<br><br><button class="btn btn-outline" onclick="clearAll()">Clear &amp; try again</button></div>';
    errEl.style.display = 'block';
  }
  console.error('processFiles catch:', e);
});
}

function readFile(file) {
  return new Promise(function(resolve){
    var reader = new FileReader();
    reader.onload = function(e){
      try {
        var _buf = e.target.result;                       // ArrayBuffer
        var _bytes = new Uint8Array(_buf);
        // ── O2Ring native binary (.bin, or .bin renamed to .txt) ──
        if(isO2RingBin(_bytes)){
          console.log('[O2Ring] Detected native binary format:', file.name, _bytes.length, 'bytes');
          var _binCsv = decodeO2RingBinToCSV(_bytes, file.name, file);
          var _binRows = parseCSV(_binCsv, {fname:file.name, file:file});
          if(!_binRows || _binRows.length < 60){
            if(!window._csvParseErrors) window._csvParseErrors = [];
            window._csvParseErrors.push(file.name + ': binary decoded to ' + (_binRows?_binRows.length:0) + ' rows (need \u226560).');
          }
          resolve(_binRows && _binRows.length >= 60 ? processNight(_binRows, file.name) : null);
          return;
        }
        // ── Text formats (CSV / JSON / JSONL) — decode UTF-8 (== old readAsText) ──
        var text = new TextDecoder('utf-8').decode(_buf).trim();
        console.log('[O2Ring] readFile:', file.name, 'length:', text.length, 'first50:', text.substring(0,50));
        // Auto-detect: JSON/JSONL (pre-processed summaries) vs raw CSV
        if(text.charAt(0) === '{' || text.charAt(0) === '[') {
          // ── SELF-INGEST: route OxyDex's OWN ganglior.node-export envelope (SELF-INGEST-2026-06-27) ──
          // The v2.0 envelope starts with '{' and has NO top-level date, so parseJSONL returns [] and
          // the single-object branch (needs .date) would miss it. Detect + route to oxyLoadOwnExport
          // BEFORE the legacy paths; a foreign-node export is rejected with a redirect message (surfaced
          // via _csvParseErrors), never mis-loaded. renderAll honors review mode only when EVERY loaded
          // night is _fromExport (a mixed raw+export batch falls back to the normal analysis view).
          try {
            var _env = JSON.parse(text);
            if(_env && _env.schema && _env.schema.name === 'ganglior.node-export'){
              var _r = oxyLoadOwnExport(_env);
              if(!_r.ok){
                if(!window._csvParseErrors) window._csvParseErrors = [];
                window._csvParseErrors.push((file && file.name ? file.name+': ' : '') + _r.message);
                resolve(null); return;
              }
              window._oxyReview = { provenance:_r.provenance, generated:_r.generated, kernel:_r.kernel,
                events:_r.events, crossNight:_r.crossNight, node:_r.node, scrubbed:_r.scrubbed,
                derivedFrom:_r.derivedFrom, recording:_r.recording, multiNight:_r.multiNight };
              resolve(_r.nights); return;
            }
          } catch(_eEnv){ /* not parseable as one JSON object \u2014 fall through to JSONL/array paths */ }
          var nights = parseJSONL(text);
          if(nights.length) { resolve(nights); return; }
          // Try single JSON object
          try {
            var single = JSON.parse(text);
            if(single && single.date) { resolve([single]); return; }
          } catch(e2){ console.warn("[O2Ring] suppressed error:", e2); }
          resolve(null); return;
        }
        // O2Ring/OxyDex summary export is EXPORT-ONLY (DEX-EVENT-UNIFY-AND-CSV-BRIEF Task B).
        // It is NOT a re-import boundary: reconstructing a full night by string-matching ~80
        // human labels was lossy by construction and the dominant historical OxyDex bug source
        // (0-is-falsy drops, key-trim mismatches, ReferenceErrors). To reload an analyzed night,
        // use its .json export — parseJSONL / single-JSON round-trips the full night losslessly.
        var cleanText = text.replace(/^[\uFEFF\r\n\s]+/, '');
        console.log('[O2Ring] cleanText starts:', cleanText.substring(0,60));
        if(cleanText.indexOf('OxyDex Night Summary') === 0 || cleanText.indexOf('O2Ring Night Summary') === 0) {
          console.log('[O2Ring] Summary CSV detected — export-only format, not re-imported');
          if(!window._csvParseErrors) window._csvParseErrors = [];
          window._csvParseErrors.push(file.name + ': this is a human-readable summary CSV (export-only). '
            + 'To reload a night, use its .json export. Raw O2Ring CSVs and .json/.jsonl still import normally.');
          resolve(null); return;
        }

        // Raw CSV path
        var rows = parseCSV(text, {fname:file.name, file:file});
        if(!rows || rows.length < 60){
          // Debug: store first lines for error reporting
          var preview = text.split(/\r?\n/).slice(0,3).join(' | ');
          if(!window._csvParseErrors) window._csvParseErrors = [];
          window._csvParseErrors.push(file.name + ': ' + rows.length + ' rows parsed. Preview: ' + preview.substring(0,120));
        }
        resolve(rows && rows.length >= 60 ? processNight(rows, file.name) : null);
      } catch(err){
          if(!window._csvParseErrors) window._csvParseErrors = [];
          window._csvParseErrors.push(file.name + ' ERROR: ' + (err && err.message ? err.message : String(err)));
          resolve(null);
        }
    };
    reader.onerror = function(){
      if(!window._csvParseErrors) window._csvParseErrors = [];
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
  if(!lines.length) return [];

  // Detect header and column mapping
  var headerLine = '', headerIdx = 0;
  for(var i = 0; i < Math.min(8, lines.length); i++){
    var l = lines[i].toLowerCase();
    if(l.indexOf('spo2') >= 0 || l.indexOf('pulse') >= 0 || l.indexOf('time') >= 0 || l.indexOf('o2') >= 0){
      headerLine = lines[i].toLowerCase();
      headerIdx = i;
      break;
    }
  }

  // Parse header columns
  var hcols = headerLine ? headerLine.split(',').map(function(c){return c.trim().replace(/[^a-z0-9]/g,'');}) : [];
  var timeCol=-1, spo2Col=-1, hrCol=-1, motionCol=-1;
  hcols.forEach(function(c,i){
    if((c.indexOf('time')>=0||c.indexOf('date')>=0) && timeCol<0) timeCol=i;
    if((c.indexOf('spo2')>=0||c.indexOf('o2')>=0||c.indexOf('sao2')>=0||c.indexOf('oxygen')>=0) && spo2Col<0) spo2Col=i;
    if((c.indexOf('pulse')>=0||c.indexOf('pr')===0||c.indexOf('hr')===0||c.indexOf('bpm')>=0) && hrCol<0) hrCol=i;
    if(c.indexOf('motion')>=0 && motionCol<0) motionCol=i;
  });

  // Fallback: if header detection failed or columns not found, try auto-detect from first data row
  var firstDataIdx = headerLine ? headerIdx + 1 : 0;
  if(timeCol<0 || spo2Col<0 || hrCol<0){
    // Try rows until we find a valid one
    for(var i = firstDataIdx; i < Math.min(firstDataIdx+5, lines.length); i++){
      var parts = lines[i].trim().split(',');
      if(parts.length < 3) continue;
      // Find which column looks like a timestamp (contains ':')
      for(var j = 0; j < Math.min(parts.length, 3); j++){
        if(parts[j].indexOf(':') >= 0){
          timeCol = j;
          spo2Col = j+1;
          hrCol   = j+2;
          motionCol = j+3 < parts.length ? j+3 : -1;
          break;
        }
      }
      if(timeCol >= 0) break;
    }
  }

  // Last resort defaults
  if(timeCol<0) timeCol=0;
  if(spo2Col<0) spo2Col=1;
  if(hrCol<0)   hrCol=2;

  var rows = [];
  var _anchorMs = fileMeta ? _o2DateAnchorMs(fileMeta.fname, fileMeta.file) : null;
  var _prevTMs = null;
  for(var i = firstDataIdx; i < lines.length; i++){
    var p = lines[i].trim().split(',');
    if(p.length < 3) continue;
    var tStr = timeCol < p.length ? p[timeCol].trim() : '';
    var sStr = spo2Col < p.length ? p[spo2Col].trim() : '';
    var hStr = hrCol   < p.length ? p[hrCol].trim()   : '';
    var mStr = motionCol>=0 && motionCol<p.length ? p[motionCol].trim() : '0';
    if(!sStr || sStr==='- -' || sStr==='--' || sStr==='') continue;
    var spo2=parseInt(sStr, 10), hr=parseInt(hStr, 10), motion=parseInt(mStr, 10)||0;
    if(isNaN(spo2)||isNaN(hr)) continue;
    if(spo2<50||spo2>100||hr<20||hr>250) continue; // sanity check
    // CLOCK-UNIFY: floating wall-clock ms is the source of truth. row.t is a derived
    // compat Date, ALWAYS read back with getUTC*. Time-only rows anchor to _anchorMs
    // and roll forward monotonically past midnight (no Jan-2000, no +86400000 hack).
    var _ts = parseTimestamp(tStr, { dateAnchorMs:_anchorMs, prevTMs:_prevTMs, preferDMY:true });
    if(!_ts) continue;
    _prevTMs = _ts.tMs;
    rows.push({tMs:_ts.tMs, t:new Date(_ts.tMs), spo2:spo2, hr:hr, motion:motion});
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
  var p = parseTimestamp(s, { preferDMY:true });
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
  if (!n) return { head:0, tail:0 };
  var MIN = CFG.WARMUP_MIN_SEC, MAX = CFG.WARMUP_MAX_SEC;
  var SPO2_STEP = CFG.WARMUP_SPO2_STEP, HR_STEP = CFG.HR_ARTIFACT_JUMP, FLOOR = 60;
  if (n < FLOOR + MIN + 1) return { head:0, tail:0 };   // too short to safely trim anything

  // Length of the run of rows byte-identical in (spo2,hr) to rows[startIdx], walking dir (+1 / -1).
  function frozenRunLen(startIdx, dir) {
    var s = rows[startIdx].spo2, h = rows[startIdx].hr, len = 1, k = startIdx + dir;
    while (k >= 0 && k < n && rows[k].spo2 === s && rows[k].hr === h) { len++; k += dir; }
    return len;
  }

  // ── HEAD: frozen run from row 0, ended by an upward-SpO2 / big-ΔHR lock-on step ──
  var head = 0, hlen = frozenRunLen(0, +1);
  if (hlen >= MIN && hlen <= MAX && hlen < n) {
    var dS = rows[hlen].spo2 - rows[hlen-1].spo2;          // SpO2 step up = perfusion lock
    var dH = Math.abs(rows[hlen].hr - rows[hlen-1].hr);
    if (dS >= SPO2_STEP || dH >= HR_STEP) head = hlen;
  }

  // ── TAIL: frozen run ending at the last row, ENTERED via an abrupt step down ──
  var tail = 0, tlen = frozenRunLen(n-1, -1);
  if (tlen >= MIN && tlen <= MAX && tlen < n - head) {
    var pre = rows[n-1-tlen], first = rows[n-tlen];
    var dS2 = pre.spo2 - first.spo2;                       // step DOWN into placeholder
    var dH2 = Math.abs(pre.hr - first.hr);
    if (dS2 >= SPO2_STEP || dH2 >= HR_STEP) tail = tlen;
  }

  // ── FLOOR guard: never leave fewer than FLOOR rows (favor the head trim) ──
  if (n - head - tail < FLOOR) {
    if (n - head < FLOOR) head = Math.max(0, n - FLOOR);
    tail = Math.max(0, Math.min(tail, n - head - FLOOR));
  }

  if (tail) rows.splice(n - tail, tail);   // splice tail first (original-n indices unaffected by head splice)
  if (head) rows.splice(0, head);
  return { head:head, tail:tail };
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
  var n = rows.length, cleaned = 0;
  var HARD  = CFG.HR_ARTIFACT_JUMP;
  var SOFT  = CFG.HR_ARTIFACT_JUMP_SOFT;
  var RECOV = HARD / 2;
  var MAX_RUN = CFG.HR_ARTIFACT_MAX_RUN_SEC; // O2Ring is ~1 Hz, so this doubles as a sample count
  var i = 1;
  while (i < n) {
    var rise = rows[i].hr - rows[i-1].hr;
    var isHard = Math.abs(rise) >= HARD; // catch both sudden rises AND drops
    var isSoft = false;
    if (!isHard && rise >= SOFT) {
      var t = rows[i].t, minsec = t.getUTCMinutes() + t.getUTCSeconds() / 60;
      isSoft = (minsec <= 2 || minsec >= 58); // v14: full ±2min at ANY clock hour
    }
    if (isHard || isSoft) {
      var baseline = rows[i-1].hr, j = i;
      // For rises: recover when HR returns within RECOV of baseline
      // For drops: recover when HR returns within RECOV of baseline (above baseline-RECOV)
      var isRise = rise > 0;
      while (j < n && (j - i) < MAX_RUN && (isRise ? rows[j].hr > baseline + RECOV : rows[j].hr < baseline - RECOV)) { j++; }
      if ((j - i) >= MAX_RUN) {
        // Recovery never arrived within a plausible artifact duration — the anchor itself was bad, or
        // this is a real sustained transition. Bail WITHOUT clamping; resume scanning from j so a
        // genuinely new jump later on can still be caught against the (now-current) level.
        i = j;
      } else {
        for (var k = i; k < j; k++) { rows[k].hr = baseline; rows[k].hrArtifact = true; cleaned++; }
        i = j > i ? j : i + 1;  // defensive: guarantee progress even if SOFT ≤ RECOV is ever configured
      }
    } else { i++; }
  }
  return cleaned;
}

// Post-spike-detection clock filter: removes spikes whose timestamp falls within
// ±2 min of ANY clock hour (the :58–:02 window — v14; no hour gate, matching
// cleanArtifactHR's soft-artifact rule). Catches gradual-ramp artifacts that the
// single-sample HR cleaner cannot see.
function filterArtifactSpikes(spikes) {
  // v14: clock artifacts occur at ANY hour within ±2min of XX:00 (:58-:02 window)
  return spikes.filter(function(sp) {
    var m = parseInt(sp.time.substr(3, 2), 10);
    var s = parseInt(sp.time.substr(6, 2), 10);
    var minsec = m + s / 60.0;
    return !(minsec <= 2.0 || minsec >= 58.0);
  });
}

// ═══════════════════════════════════════════════════════════════
// v20.2: 15 NEW METRICS
// ═══════════════════════════════════════════════════════════════

// ── SpO2 Pattern ───────────────────────────────────────────────

// CT<94: cumulative seconds and % below 94% SpO2
function computeCT94(rows) {
  var n = rows.length;
  if(n < 60) return null;
  var ct94s = 0;
  for(var i = 0; i < n; i++) { if(rows[i].spo2 < 94) ct94s++; }
  return { ct94Sec: ct94s, ct94Pct: +(ct94s / n * 100).toFixed(2) };
}

// SpO2 dip and recovery slopes + MODL + desaturation clustering
// Builds nadir events inline (same ODI-4 rolling-window logic as computeSpO2Advanced)
function computeDesatSlopes(rows, blArr) {
  var n = rows.length;
  if(n < 60) return null;
  var spo2 = rows.map(function(r){ return r.spo2; });

  // Unified: ONE ceiling-baseline detection (DEX-EVENT-UNIFY Task A). §3 close-mode: ODI-4 entry +
  // anti-chatter HYSTERESIS close (no exitPct) — the SATELLITE set (slopes/MODL/clustering); chatter-
  // merging is desirable here, so this is intentionally NOT event-for-event with the simple-close
  // headline ODI-4 count. §1: shared p90-ceiling blArr threaded (bit-identical, one walk not many).
  var events = detectDesatEvents(spo2, { dropPct: DexKernel.K.ODI_DROP, blArr: blArr });

  if(!events.length) return {
    modl: null, meanDipSlope: null, meanRecSlope: null,
    clusteringIdx: null, firstHalfNadirs: 0, lastHalfNadirs: 0
  };

  // MODL: mean SpO2 of all samples inside dip events
  var dipSamples = [];
  events.forEach(function(e){
    for(var i=e.startIdx; i<=e.endIdx; i++) dipSamples.push(spo2[i]);
  });
  var modl = dipSamples.length
    ? +(dipSamples.reduce(function(a,b){return a+b;},0)/dipSamples.length).toFixed(2)
    : null;

  // Slopes
  var meanDipSlope = events.length ? +(events.reduce(function(a,e){return a+e.dipSlope;},0)/events.length).toFixed(3) : 0;
  var meanRecSlope = events.length ? +(events.reduce(function(a,e){return a+e.recSlope;},0)/events.length).toFixed(3) : 0;

  // Clustering: first-half vs last-half of recording
  var midIdx = Math.floor(n / 2);
  var firstH = events.filter(function(e){ return e.nadirIdx < midIdx; }).length;
  var lastH  = events.filter(function(e){ return e.nadirIdx >= midIdx; }).length;
  var total  = firstH + lastH;
  var clusteringIdx = total > 0 ? +(lastH / total).toFixed(2) : null; // >0.6 = REM-concentrated

  return { modl: modl, meanDipSlope: meanDipSlope, meanRecSlope: meanRecSlope,
           clusteringIdx: clusteringIdx, firstHalfNadirs: firstH, lastHalfNadirs: lastH };
}

// ── Periodic Breathing Characterisation ────────────────────────

function computePBmetrics(rows, osc) {
  var n = rows.length;
  if(!osc || osc.episodeCount < 1) return {
    pbCycleLen: null, pbCycleLenSD: null, pbAmplitude: null, pbLoad: null,
    pbFirstThirdRatio: null, pbEarlyCount: 0, pbLateCount: 0
  };
  var spo2 = rows.map(function(r){ return r.spo2; });
  var WIN = CFG.OSC_WINDOW_SEC; // 5-min windows (same as oscillation detection — single source: CFG)
  var THRESH = CFG.SPO2_OSC_THRESHOLD;

  // Re-detect crossing times to compute inter-crossing intervals
  var crossingTimes = [];
  var amplitudes    = [];
  for(var w = 0; w + WIN <= n; w += WIN){
    var seg = spo2.slice(w, w+WIN);
    var segMean = seg.reduce(function(a,b){return a+b;},0)/seg.length;
    if(segMean >= THRESH) continue; // not an oscillating window
    var lastCross = -1, lastDir = 0, localCross = [];
    for(var i=1; i<seg.length; i++){
      var dir = seg[i] > THRESH ? 1 : (seg[i] < THRESH ? -1 : 0);
      if(dir !== lastDir && dir !== 0){
        localCross.push(w+i);
        lastCross = w+i; lastDir = dir;
      }
    }
    if(localCross.length >= 2) crossingTimes = crossingTimes.concat(localCross);
    // Amplitude: max - min within window
    var mx = seg.length?Math.max.apply(null,seg):0, mn = seg.length?Math.min.apply(null,seg):0;
    amplitudes.push(mx - mn);
  }

  // PB cycle length: mean interval between consecutive crossings (full cycle = 2 crossings)
  var intervals = [];
  for(var i=1; i<crossingTimes.length; i++){
    var iv = crossingTimes[i] - crossingTimes[i-1];
    if(iv > 5 && iv < 300) intervals.push(iv); // sanity: 5s–300s
  }
  // Full cycle = 2 half-cycles
  var cycleIntervals = [];
  for(var i=0; i+1<intervals.length; i++) cycleIntervals.push(intervals[i]+intervals[i+1]);

  var pbCycleLen = cycleIntervals.length
    ? +(cycleIntervals.reduce(function(a,b){return a+b;},0)/cycleIntervals.length).toFixed(1)
    : null;

  var pbCycleLenSD = null;
  if(cycleIntervals.length > 1){
    var mean = cycleIntervals.reduce(function(a,b){return a+b;},0)/cycleIntervals.length;
    var variance = cycleIntervals.reduce(function(a,b){return a+(b-mean)*(b-mean);},0)/cycleIntervals.length;
    pbCycleLenSD = +Math.sqrt(variance).toFixed(1);
  }

  var pbAmplitude = amplitudes.length
    ? +(amplitudes.reduce(function(a,b){return a+b;},0)/amplitudes.length).toFixed(2)
    : null;

  // PB Load: episodeCount × amplitude × estimated mean cycle length / 60 (per hour)
  var durationHr = n / 3600;
  var pbLoad = (pbCycleLen && pbAmplitude && durationHr > 0)
    ? +(osc.episodeCount * pbAmplitude * (pbCycleLen / 60) / durationHr).toFixed(3)
    : null;

  // Distribution: first-third vs last-third
  var t1 = Math.floor(n/3), t2 = Math.floor(2*n/3);
  var earlyCount = crossingTimes.filter(function(t){ return t < t1; }).length;
  var lateCount  = crossingTimes.filter(function(t){ return t >= t2; }).length;
  var total = earlyCount + lateCount;
  var pbFirstThirdRatio = total > 0 ? +(earlyCount/total).toFixed(2) : null; // <0.4 = late/REM dominant

  return { pbCycleLen: pbCycleLen, pbCycleLenSD: pbCycleLenSD,
           pbAmplitude: pbAmplitude, pbLoad: pbLoad,
           pbFirstThirdRatio: pbFirstThirdRatio,
           pbEarlyCount: earlyCount, pbLateCount: lateCount };
}

// ── Sleep Architecture Proxies ─────────────────────────────────

function computeSleepArch(rows) {
  var n = rows.length;
  if(n < 600) return null;
  var WIN = 60; // 1-min HR stability window

  // Sleep onset: first WIN-second window with HR SD < 5 bpm
  var solMin = null, onsetIdx = 0;
  for(var i = 0; i + WIN <= n; i++){
    var seg = rows.slice(i, i+WIN).map(function(r){ return r.hr; });
    var mean = seg.reduce(function(a,b){return a+b;},0)/seg.length;
    var sd = Math.sqrt(seg.reduce(function(a,b){return a+(b-mean)*(b-mean);},0)/seg.length);
    if(sd < 5){ solMin = +(i/60).toFixed(1); onsetIdx = i; break; }
  }

  // WASO: motion-flagged samples AFTER sleep onset only
  // v22.15 fix: guard against onsetIdx=0 fallback when onset is undetectable;
  // return null so UI correctly shows '—' instead of inflated whole-recording value.
  var wasoMin = solMin !== null
    ? +(rows.slice(onsetIdx).filter(function(r){ return r.motion > 0; }).length / 60).toFixed(1)
    : null;

  // Ultradian cycle count: HR valleys separated by 60–120 min
  // 5-min centered rolling mean of HR — O(n) sliding window
  // v22.15 fix: previous trailing window displaced valley indices ~150s forward;
  // centered window aligns hrSmooth[i] with the midpoint of its contributing samples.
  var hrSmooth = new Array(n);
  var SMOOTH = 300, HALF = Math.floor(SMOOTH / 2);
  var rSum = 0, rCnt = 0;
  // Prime the first half-window
  for(var j = 0; j < Math.min(HALF, n); j++){ rSum += rows[j].hr; rCnt++; }
  for(var i = 0; i < n; i++){
    // Add the right edge of the centered window as i advances
    var rEdge = i + HALF;
    if(rEdge < n){ rSum += rows[rEdge].hr; rCnt++; }
    // Remove the left edge that has fallen out of the window
    var lEdge = i - HALF - 1;
    if(lEdge >= 0){ rSum -= rows[lEdge].hr; rCnt--; }
    hrSmooth[i] = rCnt > 0 ? rSum / rCnt : rows[i].hr;
  }
  var valleys = [];
  var MIN_SEP = 3600; // 60 min minimum between valleys
  for(var i=150; i<n-150; i++){
    if(hrSmooth[i] < hrSmooth[i-150] && hrSmooth[i] < hrSmooth[i+150]){
      if(!valleys.length || i - valleys[valleys.length-1] >= MIN_SEP){
        valleys.push(i);
      }
    }
  }
  var ultradianCycles = Math.max(0, valleys.length - 1); // count intervals between valleys

  return { wasoMin: wasoMin, solMin: solMin,
           ultradianCycles: ultradianCycles, ultradianValleys: valleys.length };
}

// ── ODI-1 ──────────────────────────────────────────────────────

function computeODI1(rows, blArr) {
  var n = rows.length;
  if(n < 60) return { odi1Rate: 0, odi1Total: 0 };
  var spo2 = rows.map(function(r){ return r.spo2; });
  // ODI-1 keeps its definitional 1% entry + shallow 0.5% re-rise exit and counts every
  // qualifying dip (minSec:0, no 10s floor) — but now shares the ONE ceiling-baseline
  // primitive instead of a private trailing-mean loop. (DEX-EVENT-UNIFY Task A)
  var events = detectDesatEvents(spo2, { dropPct: 1, exitPct: 0.5, minSec: 0, blArr: blArr }).length;
  var durationHr = n / 3600;
  return { odi1Rate: durationHr > 0 ? +(events/durationHr).toFixed(1) : 0, odi1Total: events };
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
  var ctHigh  = ct90Min >= 5;
  var odiMod  = odi4Rate >= DexKernel.K.MOS_SHORT;
  var ctMod   = ct90Min >= 1;
  var score;
  if(odiHigh && ctHigh)       score = 4;
  else if(odiHigh || ctHigh)  score = 3;
  else if(odiMod || ctMod)    score = 2;
  else                         score = 1;
  var labels = ['','Normal','Borderline','Abnormal','Severely Abnormal'];
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
  var ahiODI4 = +(odi4Rate * 1.1).toFixed(1);
  // Internal linear model (concept per Kulkas 2013 DesSev): AHI ≈ 0.8×ODI3 + 0.6×DesSev + 0.15×T95 − 1.2
  var ahiKulkas = Math.max(0, +(0.8*odi3Rate + 0.6*desSevRate + 0.15*t95Pct - 1.2).toFixed(1));
  return { ahiODI4: ahiODI4, ahiKulkas: ahiKulkas };
}


// ═══════════════════════════════════════════════════════════════
// v20.3: TIER 1 — Night Extras (12 simple metrics)
// ═══════════════════════════════════════════════════════════════
function computeNightExtras(rows, stats, desat, odi1, odi4, hb) {
  var n = rows.length;
  if(n < 60 || !stats) return null;
  var spo2 = rows.map(function(r){ return r.spo2; });
  var hr   = rows.map(function(r){ return r.hr; });
  var TWO_HR = Math.min(n, 7200); // 2h in samples at 1Hz

  // SpO2 range
  var spo2Range = +(stats.maxSpo2 - stats.minSpo2).toFixed(1);

  // Time-in-range 94–99%
  var tirCount = spo2.filter(function(v){ return v >= 94 && v <= 99; }).length; // TIR94-99: excludes ceiling-artifact 100%
  var tir9499  = +(tirCount / n * 100).toFixed(1);

  // Split-night SpO2
  var earlyS = spo2.slice(0, TWO_HR);
  var lateS  = spo2.slice(Math.max(0, n - TWO_HR));
  var meanSpo2Early = +(earlyS.reduce(function(a,b){return a+b;},0)/earlyS.length).toFixed(2);
  var meanSpo2Late  = +(lateS.reduce(function(a,b){return a+b;},0)/lateS.length).toFixed(2);

  // HR range + split-night HR
  var hrRange    = +(stats.maxHr - stats.minHr).toFixed(0);
  var earlyH     = hr.slice(0, TWO_HR);
  var lateH      = hr.slice(Math.max(0, n - TWO_HR));
  var meanHrEarly= +(earlyH.reduce(function(a,b){return a+b;},0)/earlyH.length).toFixed(1);
  var meanHrLate = +(lateH.reduce(function(a,b){return a+b;},0)/lateH.length).toFixed(1);

  // Motion bursts (runs of motion>0 lasting ≥3s)
  var motionBursts = 0;
  var inBurst = false, burstLen = 0;
  for(var i = 0; i < n; i++){
    if(rows[i].motion > 0){ inBurst = true; burstLen++; }
    else {
      if(inBurst && burstLen >= 3) motionBursts++;
      inBurst = false; burstLen = 0;
    }
  }
  if(inBurst && burstLen >= 3) motionBursts++;

  // Longest clean SpO2 run (>95%, in minutes)
  var longestCleanRun = 0, curRun = 0;
  for(var i = 0; i < n; i++){
    if(spo2[i] > 95){ curRun++; if(curRun > longestCleanRun) longestCleanRun = curRun; }
    else curRun = 0;
  }
  longestCleanRun = +(longestCleanRun / 60).toFixed(1);

  // Nadir density
  var nadirCount  = (desat && desat.nadir) ? desat.nadir.count : 0;
  var durationHr  = n / 3600;
  var nadirDensity = durationHr > 0 ? +(nadirCount / durationHr).toFixed(2) : 0;

  // T95 burden score: T95% × sqrt(T-AUC weighted)
  var t95BurdenScore = null;
  if(stats && hb){
    var tAUC = hb.total || 0;
    t95BurdenScore = +(stats.t95pct * Math.sqrt(Math.max(0, tAUC))).toFixed(2);
  }

  // ODI-4/ODI-1 ratio (depth distribution index)
  var odi41ratio = null;
  if(odi4 && odi1 && odi1.odi1Rate > 0){
    odi41ratio = +(odi4.rate / odi1.odi1Rate).toFixed(3);
  }

  return { spo2Range:spo2Range, tir9499:tir9499,
           meanSpo2Early:meanSpo2Early, meanSpo2Late:meanSpo2Late,
           hrRange:hrRange, meanHrEarly:meanHrEarly, meanHrLate:meanHrLate,
           motionBursts:motionBursts, longestCleanRun:longestCleanRun,
           nadirDensity:nadirDensity, t95BurdenScore:t95BurdenScore,
           odi41ratio:odi41ratio };
}

// ═══════════════════════════════════════════════════════════════
// v20.3: TIER 2 — Rolling Window Metrics (8 metrics)
// ═══════════════════════════════════════════════════════════════
function computeRollingMetrics(rows, desat, comp, blArr) {
  var n = rows.length;
  if(n < 600) return null;
  var spo2  = rows.map(function(r){ return r.spo2; });
  var hr    = rows.map(function(r){ return r.hr; });
  var W10   = 600;  // 10-min
  var W30   = 1800; // 30-min
  var W5    = 300;  // 5-min
  var durationHr = n / 3600;

  // Worst 10-min SpO2 window
  var worst10 = 100;
  for(var i = 0; i + W10 <= n; i += 60){
    var seg = spo2.slice(i, i + W10);
    var m = seg.reduce(function(a,b){return a+b;},0)/seg.length;
    if(m < worst10) worst10 = m;
  }
  worst10 = isFinite(worst10) ? +worst10.toFixed(2) : 0;

  // Worst 30-min T95 window
  var worstT95 = 0;
  for(var i = 0; i + W30 <= n; i += 60){
    var seg = spo2.slice(i, i + W30);
    var cnt = seg.filter(function(v){ return v < 95; }).length;
    var pct = cnt / seg.length * 100;
    if(pct > worstT95) worstT95 = pct;
  }
  worstT95 = isFinite(worstT95) ? +worstT95.toFixed(1) : 0;

  // SpO2 stable windows (5-min with SD < 1%)
  var stableWins = 0;
  for(var i = 0; i + W5 <= n; i += W5){
    var seg = spo2.slice(i, i + W5);
    var mean = seg.reduce(function(a,b){return a+b;},0)/seg.length;
    var sd = Math.sqrt(seg.reduce(function(a,b){return a+(b-mean)*(b-mean);},0)/seg.length);
    if(sd < 1) stableWins++;
  }

  // CDI: Cyclic Desaturation Index — SpO2 oscillations crossing mean±2SD per hour
  var globalMean = spo2.reduce(function(a,b){return a+b;},0)/n;
  var globalSD   = Math.sqrt(spo2.reduce(function(a,b){return a+(b-globalMean)*(b-globalMean);},0)/n);
  var hiThresh = globalMean + 2*globalSD, loThresh = globalMean - 2*globalSD;
  var cdiCross = 0, cdiState = 0;
  for(var i = 0; i < n; i++){
    var newState = spo2[i] > hiThresh ? 1 : (spo2[i] < loThresh ? -1 : cdiState);
    if(newState !== cdiState && newState !== 0){ cdiCross++; cdiState = newState; }
  }
  var cdi = durationHr > 0 ? +(cdiCross / durationHr / 2).toFixed(2) : 0; // /2 = full cycles

  // Post-dip HR response: mean HR change 60s after each nadir
  var postDipDeltas = [];
  // §2: dropped the vestigial `desat.nadir.count > 0` pre-gate — a coarse "any events?" check from
  // the pre-unification separate loop. postDipDeltas.length below is the real gate, and it scores the
  // SET THIS USES (ODI-4 entry + anti-chatter HYSTERESIS close — §3 satellite set), not the simple-
  // close self-gated nadir.count. §1: shared p90-ceiling blArr threaded. DEX-EVENT-UNIFY-FOLLOWUPS-II.
  detectDesatEvents(spo2, { dropPct: DexKernel.K.ODI_DROP, blArr: blArr }).forEach(function(e){
    var postIdx = Math.min(n-1, e.nadirIdx + 60);
    if(postIdx < n && e.nadirIdx < n) postDipDeltas.push(hr[postIdx] - hr[e.nadirIdx]);
  });
  var postDipHrResponse = postDipDeltas.length
    ? +(postDipDeltas.reduce(function(a,b){return a+b;},0)/postDipDeltas.length).toFixed(1)
    : null;

  // HR deceleration runs: ≥3 BPM total decrease sustained ≥30s
  var hrDecelRuns = 0, decelLen = 0, decelStartHR = 0;
  for(var i = 1; i < n; i++){
    if(hr[i] < hr[i-1]){
      if(decelLen === 0) decelStartHR = hr[i-1]; // capture baseline before first step
      decelLen++;
    } else {
      if(decelLen >= 30 && (decelStartHR - hr[i-1]) >= 3) hrDecelRuns++;
      decelLen = 0; decelStartHR = 0;
    }
  }
  if(decelLen >= 30 && (decelStartHR - hr[n-1]) >= 3) hrDecelRuns++; // end-of-array run

  // SpO2-HR decoupling: use 30s windows to avoid 1Hz noise domination
  // 1-second comparison is meaningless (random ~50% by quantization noise)
  var decoupled = 0, dcTotal = 0;
  for(var i = 30; i < n; i += 30){
    var dSpo2 = spo2[i] - spo2[i-30];
    var dHr   = hr[i]   - hr[i-30];
    if(dSpo2 !== 0 && dHr !== 0){ dcTotal++; if((dSpo2 > 0) !== (dHr > 0)) decoupled++; }
  }
  var spo2HrDecouplingPct = dcTotal > 0 ? +((decoupled / dcTotal) * 100).toFixed(1) : 0;

  // Intra-night NSI: NSI per 90-min epoch (early/mid/late)
  var EPOCH = 5400; // 90 min
  var intraNightNSI = [];
  for(var e = 0; e < 3; e++){
    var start = e * EPOCH, end = Math.min(n, start + EPOCH);
    if(end <= start) break;
    var seg = rows.slice(start, end);
    var segSpo2 = seg.map(function(r){ return r.spo2; });
    var segHr   = seg.map(function(r){ return r.hr; });
    var segN    = seg.length;
    // Mini-NSI: T95 + HR variance + motion
    var segT95  = segN ? segSpo2.filter(function(v){ return v < 95; }).length / segN * 100 : 0;
    var segHrMean = segN ? segHr.reduce(function(a,b){return a+b;},0)/segN : 0;
    var segHrSD = segN ? Math.sqrt(segHr.reduce(function(a,b){return a+(b-segHrMean)*(b-segHrMean);},0)/segN) : 0;
    var segMot  = segN ? seg.filter(function(r){ return r.motion > 0; }).length / segN * 100 : 0;
    var t95Norm  = Math.min(1, segT95 / 30);
    var hrSdNorm = Math.min(1, segHrSD / 20);
    var motNorm  = Math.min(1, segMot  / 30);
    var miniNSI  = Math.min(100, Math.round((t95Norm + hrSdNorm + motNorm) / 3 * 100));
    intraNightNSI.push(miniNSI);
  }

  return { worst10minSpo2:worst10, worst30minT95:worstT95,
           spo2StableWindows:stableWins, cdi:cdi,
           postDipHrResponse:postDipHrResponse, hrDecelRuns:hrDecelRuns,
           spo2HrDecouplingPct:spo2HrDecouplingPct, intraNightNSI:intraNightNSI };
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
  if(pbMet && pbMet.pbCycleLen !== null){
    if(pbMet.pbCycleLen >= 40 && pbMet.pbCycleLen <= 130) cs++; // clinical CSR cycle window
  }
  if(flags && flags.some(function(f){ return f.code.indexOf('BLUNTED_AROUSAL') >= 0; })) cs++;
  if(cross && cross.crcIdx != null && cross.crcIdx < 0.2) cs++;
  // CS-specific: low ODI despite high PB burden (central = less desaturation per event)
  if(odi4 && odi4.rate < 3 && osc && osc.episodeCount >= 5) cs++;
  cs = Math.min(3, cs);

  // UARS probability (0-3)
  // Criteria: short PB cycles (< 40 s), high AAI, normal-low ODI-4, high SpO2-HR decoupling
  var uars = 0;
  if(pbMet && pbMet.pbCycleLen !== null){
    if(pbMet.pbCycleLen < 40) uars++;
  }
  if(cross && cross.autoArousalIdx >= 3) uars++;
  if(odi4 && odi4.rate < 5 && osc && osc.episodeCount >= 3) uars++;
  if(comp && comp.sfi >= 2) uars++;
  uars = Math.min(3, uars);

  var csLabels   = ['Unlikely','Possible','Probable','Likely'];
  var uarsLabels = ['Unlikely','Possible','Probable','Likely'];

  return { csScore: cs,   csLabel: csLabels[cs],
           uarsScore: uars, uarsLabel: uarsLabels[uars] };
}


// ═══════════════════════════════════════════════════════════════
// v20.4: TIER 3 continued — Signal Processing Metrics
// ═══════════════════════════════════════════════════════════════

// DFA α1 — Detrended Fluctuation Analysis (short-scale exponent)
// OSA signature: α1 ≈ 0.5 (random-walk-like). Normal: α1 ≈ 0.8–1.1.
// Uses log-log regression of RMS fluctuation vs window size (n=4..64).
function computeDFA(rows) {
  var spo2 = (rows || []).map(function(r){ return r && r.spo2!=null ? r.spo2 : null; }).filter(function(v){ return v!=null && isFinite(v); });
  var n = spo2.length;
  if(n < 256) return null;
  spo2 = spo2.slice(0, Math.min(n, 3600));
  n = spo2.length;
  var mean = spo2.reduce(function(a,b){return a+b;},0)/n;
  var y = [];
  var cum = 0;
  for(var i=0;i<n;i++){ cum += spo2[i]-mean; y.push(cum); }
  var scales = [4,8,16,32,64];
  var logN = [], logF = [];
  for(var s=0;s<scales.length;s++){
    var wn = scales[s];
    var rmsSum = 0, count = 0;
    for(var start=0; start+wn<=n; start+=wn){
      var seg = y.slice(start, start+wn);
      var xm = (wn-1)/2;
      var ym = seg.reduce(function(a,b){return a+b;},0)/wn;
      var num=0,den=0;
      for(var k=0;k<wn;k++){ num+=(k-xm)*(seg[k]-ym); den+=(k-xm)*(k-xm); }
      var slope = den ? num/den : 0, intercept = ym - slope*xm;
      var resVar = 0;
      for(var k=0;k<wn;k++){ var r=seg[k]-(slope*k+intercept); resVar+=r*r; }
      rmsSum += Math.sqrt(resVar/wn);
      count++;
    }
    if(count>0){ logN.push(Math.log(wn)); logF.push(Math.log(Math.max(1e-12, rmsSum/count))); }
  }
  if(logN.length < 2 || logF.some(function(v){ return !isFinite(v); })) return { alpha1:null, dfaLabel:'—' };
  var xm2=logN.reduce(function(a,b){return a+b;},0)/logN.length;
  var ym2=logF.reduce(function(a,b){return a+b;},0)/logF.length;
  var num2=0,den2=0;
  for(var i=0;i<logN.length;i++){ num2+=(logN[i]-xm2)*(logF[i]-ym2); den2+=(logN[i]-xm2)*(logN[i]-xm2); }
  var alpha1 = den2 ? +(num2/den2).toFixed(3) : null;
  var label = alpha1===null || !isFinite(alpha1) ? '—' : 'SpO₂ DFA (α1='+alpha1+') — HR-DFA thresholds do not apply to SpO₂ signal';
  return { alpha1: alpha1, dfaLabel: label };
}

// SpO2 FFT — dominant frequency in 0.01–0.05 Hz band (respiratory oscillation)
// Fast: probe 20 candidate frequencies only instead of full DFT
function computeSpO2FFT(rows) {
  var spo2 = rows.map(function(r){ return r.spo2; });
  var n = spo2.length;
  if(n < 512) return null;
  var USE = Math.min(n, 3600); // 1hr max
  var sig = spo2.slice(0, USE);
  var mean = sig.reduce(function(a,b){return a+b;},0)/USE;
  // Probe frequencies: 0.010, 0.013, 0.016, 0.020, 0.025, 0.030, 0.035, 0.040, 0.045, 0.050 Hz
  var freqs = [0.005,0.007,0.008,0.010,0.013,0.016,0.020,0.025,0.030,0.040,0.050]; // extended to 200s to capture PB/CS cycles
  var bestPow = -1, bestFreq = 0;
  for(var fi=0;fi<freqs.length;fi++){
    var f=freqs[fi], re=0, im=0;
    for(var t=0;t<USE;t++){
      var ang=2*Math.PI*f*t;
      re+=(sig[t]-mean)*Math.cos(ang);
      im-=(sig[t]-mean)*Math.sin(ang);
    }
    var pow=re*re+im*im;
    if(pow>bestPow){bestPow=pow;bestFreq=f;}
  }
  var peakFreqHz = isFinite(bestFreq)?+bestFreq.toFixed(4):0;
  var peakCycSec = peakFreqHz > 0 ? +(1/peakFreqHz).toFixed(0) : null;
  return { peakFreqHz: peakFreqHz, peakCycSec: peakCycSec };
}

// HR Sample Entropy proxy — lower = more regular (OSA pattern)
// SampEn(m=2, r=0.2*SD) estimated on motion-free HR
function computeHREntropy(rows) {
  var clean = rows.filter(function(r){ return r.motion===0; }).map(function(r){ return r.hr; });
  var n = clean.length;
  if(n < 200) return null;
  // SYNTH-TEXTURE-FOLLOWUPS-III: bound the O(N²) match-count with WHOLE-NIGHT decimation, NOT a
  // head-slice. The old `clean.slice(0,1000)` (≈ first 16 min of an 8 h night) characterised only the
  // settle-in window and systematically UNDER-stated full-night HR irregularity (committed O2Ring
  // corpus: head-slice SampEn ≈0.42 vs whole-night decimation ≈1.5 — flips most nights from
  // "Low (regular)" to "High (irregular)"). Deterministic uniform stride spans the entire night at the
  // SAME O(cap²) cost; tolerance r tracks the decimated set's SD. Mirrors pulsedex-dsp.js sampEn.
  var CAP = 1000;
  var x;
  if(n > CAP){ var stride = Math.ceil(n / CAP); x = []; for(var di = 0; di < n; di += stride) x.push(clean[di]); }
  else { x = clean.slice(); }
  var USE = x.length;
  // SD for tolerance r
  var mean = x.reduce(function(a,b){return a+b;},0)/USE;
  var variance = x.reduce(function(a,v){return a+(v-mean)*(v-mean);},0)/USE;
  var stdv = Math.sqrt(variance);
  var r = 0.2 * stdv;
  var m = 2;
  // Count template matches for m and m+1
  function countMatches(m, r){
    // k<m: checks exactly m consecutive points (correct for SampEn template length)
    var cnt = 0;
    for(var i=0; i<USE-m; i++){
      for(var j=i+1; j<USE-m; j++){
        var match = true;
        for(var k=0; k<m; k++){
          if(Math.abs(x[i+k]-x[j+k]) > r){ match=false; break; }
        }
        if(match) cnt++;
      }
    }
    return cnt;
  }
  var Bm   = countMatches(m,   r);
  var Am   = countMatches(m+1, r);
  var sampEn = (Bm > 0 && Am > 0) ? +(-Math.log(Am/Bm)).toFixed(4) : null;
  var label  = sampEn===null?'—':sampEn<0.5?'Low (regular)':sampEn<1.2?'Normal':'High (irregular)';
  return { sampEn: sampEn, sampEnLabel: label };
}

// Sympathetic Surge Index — combined arousal load per hour
function computeSympSurge(rows, spikes, cross, rolling, durationHr) {
  if(!durationHr || durationHr < 0.5) return null;
  var spikeRate  = (spikes && spikes.length) ? spikes.length / durationHr : 0;
  // postDipHrResponse is mean bpm arousal — normalize to [0-1] on 0-10 bpm scale
  var postDipAct = rolling && rolling.postDipHrResponse !== null
    ? Math.max(0, Math.min(1, rolling.postDipHrResponse / 10)) : 0;
  var aaiLoad    = cross ? cross.autoArousalIdx / 5 : 0; // normalise AAI 0-5 scale
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
  if(n < 3600) return null;
  var hr = rows.map(function(r){ return r.hr; });
  // Fit y = A*cos(2π*t/T + φ) + C where T = n (full night)
  // Use least-squares for A*cos + B*sin + C
  var sumC=0,sumS=0,sumCC=0,sumSS=0,sumCS=0,sumYC=0,sumYS=0,sumY=0;
  for(var i=0;i<n;i++){
    var ang = 2*Math.PI*i/n;
    var c=Math.cos(ang), s=Math.sin(ang), y=hr[i];
    sumC+=c; sumS+=s; sumCC+=c*c; sumSS+=s*s; sumCS+=c*s;
    sumYC+=y*c; sumYS+=y*s; sumY+=y;
  }
  // Simplified: A ≈ 2/n * ΣY*cos(ωt), B ≈ 2/n * ΣY*sin(ωt)
  var A = 2/n * sumYC, B = 2/n * sumYS;
  var amplitude = +Math.sqrt(A*A+B*B).toFixed(2);
  // Nadir timing: phase offset as fraction of recording
  // f(t) = A*cos(ωt) + B*sin(ωt) = R*cos(ωt − φ), φ = atan2(B, A)
  // Minimum at ωt − φ = π → t_nadir_frac = (φ + π) / (2π)
  var phaseRad = Math.atan2(B, A);
  var nadirFrac = ((phaseRad + Math.PI) / (2*Math.PI)) % 1;
  if(nadirFrac < 0) nadirFrac += 1;
  var nadirHour = +(nadirFrac * (n/3600)).toFixed(1);
  return { circAmplitude: amplitude, circNadirHour: nadirHour };
}

// SpO2 Sample Entropy (same method as HR, applied to SpO2)
function computeSpO2Entropy(rows) {
  var spo2 = rows.map(function(r){ return r.spo2; });
  var n = spo2.length;
  if(n < 200) return null;
  // SYNTH-TEXTURE-FOLLOWUPS-III: WHOLE-NIGHT decimation, not a head-slice (see computeHREntropy).
  // `spo2.slice(0,800)` measured only the first ~13 min; corpus head-slice SampEn ≈0.04–0.17
  // ("Low(periodic)") vs whole-night decimation ≈0.4–0.8 ("Normal"). Deterministic uniform stride,
  // same O(cap²) cost, spans the whole recording. Mirrors pulsedex-dsp.js sampEn.
  var CAP = 800; // smaller for speed on SpO2
  var x;
  if(n > CAP){ var stride = Math.ceil(n / CAP); x = []; for(var di = 0; di < n; di += stride) x.push(spo2[di]); }
  else { x = spo2.slice(); }
  var USE = x.length;
  var mean = x.reduce(function(a,b){return a+b;},0)/USE;
  var stdv = Math.sqrt(x.reduce(function(a,v){return a+(v-mean)*(v-mean);},0)/USE);
  var r = 0.15 * stdv; // tighter tolerance for SpO2 (1% resolution)
  var m = 2;
  var Bm=0, Am=0;
  for(var i=0;i<USE-m;i++){
    for(var j=i+1;j<USE-m;j++){
      var mOk=true, mOk1=true;
      for(var k=0;k<=m;k++){
        var diff = Math.abs(x[i+k]-x[j+k]);
        if(k<m && diff>r) mOk=false;
        if(diff>r) mOk1=false;
      }
      if(mOk) Bm++;
      if(mOk1) Am++;
    }
  }
  var spo2En = (Bm>0&&Am>0) ? +(-Math.log(Am/Bm)).toFixed(4) : null;
  var label  = spo2En===null?'—':spo2En<0.3?'Low(periodic)':spo2En<0.8?'Normal':'High(chaotic)';
  return { spo2SampEn: spo2En, spo2EnLabel: label };
}

// Hypoxic Load (Azarbarzin 2019) — ODI3 × mean dip depth × mean dip duration
function computeHypoxicLoad(desat, odi3, durationHr, rows, blArr) {
  if(!odi3 || durationHr < 0.5) return null;
  // Detect ODI-3 nadir events directly from raw SpO2 (threshold-consistent with odi3)
  // Azarbarzin 2019: HL = ODI3_rate × meanDepth × meanDuration_min
  // ODI-3-depth subset from the ONE shared detector (ceiling baseline, simple re-rise close
  // matching the legacy ODI-3 logic). DEX-EVENT-UNIFY Task A.
  var nadirEvents = [];
  if(rows && rows.length > 60) {
    var spo2 = rows.map(function(r){ return r.spo2; });
    nadirEvents = detectDesatEvents(spo2, { dropPct: 3, exitPct: 3, blArr: blArr }).map(function(e){
      return { depth: e.depth, duration: e.durationSec };
    });
  }
  var nadirCount = nadirEvents.length;
  var meanDepth = nadirCount > 0
    ? nadirEvents.reduce(function(s,e){return s+e.depth;},0) / nadirCount : 0;
  var meanDur = nadirCount > 0
    ? nadirEvents.reduce(function(s,e){return s+e.duration;},0) / nadirCount : 0;
  // Fall back to odi3.rate if no events detected (short recordings, low ODI)
  var rate = durationHr > 0 ? +(nadirCount / durationHr).toFixed(1) : odi3.rate;
  var hl = +(rate * meanDepth * (meanDur / 60)).toFixed(3); // %·events·min/hr
  var label = hl < 1 ? 'Low' : hl < 5 ? 'Moderate' : 'High';
  return { hypoxicLoad: hl, hlLabel: label,
           hl_nadirCount: nadirCount, hl_meanDepth: +meanDepth.toFixed(1),
           hl_meanDurSec: +meanDur.toFixed(0) };
}

// Vagal Index — composite of HRV proxies weighted by oxygen stability
function computeVagalIndex(hrv, extras) {
  if(!hrv || !extras) return null;
  var pnn3    = hrv.pnn3  || 0;
  var hrFloor = hrv.hrFloor || 60;
  var cleanRun = extras.longestCleanRun || 0;
  // Higher pNN3, lower HR floor, longer clean run = better vagal tone
  var vi = +((pnn3 / Math.max(hrFloor, 1)) * Math.log1p(cleanRun)).toFixed(4);
  var label = vi < 0.01 ? 'Low' : vi < 0.05 ? 'Moderate' : 'High';
  return { vagalIndex: vi, vagalLabel: label };
}

// Recovery Index — mean recovery slope / mean dip slope (1=symmetric, >1=fast recovery)
function computeRecoveryIndex(slopes) {
  if(!slopes || !slopes.meanDipSlope || !slopes.meanRecSlope) return null;
  if(slopes.meanDipSlope === 0) return null;
  var ri = +(Math.abs(slopes.meanRecSlope) / Math.abs(slopes.meanDipSlope)).toFixed(3);
  var label = ri > 1.5 ? 'Fast' : ri > 0.8 ? 'Symmetric' : 'Slow';
  return { recoveryIndex: ri, riLabel: label };
}

// Sleep Pressure Index — composite of WASO, motion bursts, SOL
function computeSleepPressure(sleepArch, extras) {
  if(!sleepArch || !extras) return null;
  var waso  = sleepArch.wasoMin || 0;
  var bursts= extras.motionBursts || 0;
  var sol   = sleepArch.solMin !== null ? sleepArch.solMin : 0;
  var spi   = +(waso*0.4 + bursts*0.15 + sol*0.25).toFixed(2);
  var label = spi < 5 ? 'Low' : spi < 15 ? 'Moderate' : 'High';
  return { spi: spi, spiLabel: label };
}

// Breathing Irregularity — CV of inter-nadir intervals
function computeBreathingIrregularity(desat, rows, blArr) {
  if(!rows || rows.length < 60) return null;
  var spo2 = rows.map(function(r){ return r.spo2; });
  // §2: dropped the vestigial `desat.nadir.count < 3` pre-gate — it gated on the simple-close,
  // self-gated nadir.count, a DIFFERENT set than the hysteresis-close inter-nadir set scored here;
  // the `nadirTimes.length < 3` check below is the real gate, on the SET THIS USES. §3 close-mode:
  // ODI-4 entry + anti-chatter HYSTERESIS close (satellite set). §1: shared p90-ceiling blArr threaded.
  var nadirTimes = detectDesatEvents(spo2, { dropPct: DexKernel.K.ODI_DROP, blArr: blArr }).map(function(e){ return e.nadirIdx; });
  if(nadirTimes.length < 3) return null;
  var intervals = [];
  for(var i=1;i<nadirTimes.length;i++) intervals.push(nadirTimes[i]-nadirTimes[i-1]);
  var iMean = intervals.length ? intervals.reduce(function(a,b){return a+b;},0)/intervals.length : 0;
  var iSD   = Math.sqrt(intervals.reduce(function(a,v){return a+(v-iMean)*(v-iMean);},0)/intervals.length);
  var biCV  = iMean > 0 ? +(iSD/iMean*100).toFixed(1) : null;
  var label = biCV===null?'—':biCV<30?'Regular':biCV<60?'Variable':'Irregular';
  return { biCV: biCV, biLabel: label };
}

// OxyCrash — count of SpO2 drops >5% in <30s (rapid acute dips)
function computeOxyCrash(rows) {
  var spo2 = rows.map(function(r){ return r.spo2; });
  var n = spo2.length;
  if(n < 60) return { oxyCrashCount: 0 };
  var crashes = 0;
  var WIN = 30;
  var cooldown = 0;
  for(var i=WIN; i<n; i++){
    if(cooldown > 0){ cooldown--; continue; }
    if(spo2[i-WIN] - spo2[i] >= 5){ crashes++; cooldown = WIN; } // 30s cooldown prevents re-counting sustained drops
  }
  var durationHr = n / 3600;
  return { oxyCrashCount: crashes, oxyCrashRate: durationHr>0 ? +(crashes/durationHr).toFixed(1) : 0 };
}

// Nocturnal HR Dip % — (refHR - hrFloor) / refHR  (higher=better parasympathetic)
function computeHRNoctDip(hrv, stats) {
  if(!hrv || !stats) return null;
  // Intra-night HR descent: (night mean - night floor) / night mean × 100
  // NOTE: true nocturnal dip requires daytime HR (unavailable here)
  // This measures how much HR drops from nightly mean to its lowest — NOT standard clinical dip
  var refHR = stats.meanHr || 60;
  var floor  = hrv.hrFloor || refHR;
  var dip    = +((refHR - floor) / refHR * 100).toFixed(1);
  var label  = dip > 10 ? 'Good (intra-night)' : dip > 5 ? 'Moderate (intra-night)' : 'Low (intra-night)';
  return { hrnDip: dip, hrnDipLabel: label };
}

// Desaturation Asymmetry — mean dip slope / mean recovery slope
// >1 = faster dip than recovery (abrupt obstructive); <1 = slow dip fast recovery (central)
function computeDesatAsymmetry(slopes) {
  if(!slopes || !slopes.meanRecSlope || slopes.meanRecSlope === 0) return null;
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

  var spo2Keys = ['minSpo2','meanSpo2','t95','t90','odi4','odi3','odi1','hb','sbii','pred3p','desSev','wtdsi','cdi'];
  var hrKeys   = ['hrSpikes','nsi','sfi','hrnDip','rmssd','hrFloor'];
  var sleepKeys= ['wasoMin','waso','sleepEff','solMin','sol','motPct','lcsp','remProxy','nremDeep','osc','breathI'];
  function push(key, label, val, score, displayVal, sev) {
    if(val === null || val === undefined) return;
    var cat = spo2Keys.indexOf(key)>=0 ? 'spo2' : hrKeys.indexOf(key)>=0 ? 'hr' : sleepKeys.indexOf(key)>=0 ? 'sleep' : null;
    metrics.push({ key:key, label:label, value:val, displayVal:displayVal||String(val),
                   score:score, sev:sev||(score<3?'g':score<6?'w':'r'), cat:cat });
  }

  // ── SpO2 ──
  if(n.stats){
    var minS = n.stats.minSpo2;
    push('minSpo2','Min SpO₂', minS,
      minS>=93?0:minS>=90?3:minS>=87?5:minS>=85?7:10, minS+'%');
    var t95 = n.stats.t95pct;
    push('t95','T95%', t95,
      t95<1?0:t95<5?2:t95<10?4:t95<20?6:t95<30?8:10, t95+'%');
    var meanS = n.stats ? n.stats.meanSpo2 : 0;
    push('meanSpo2','Mean SpO₂', meanS,
      meanS>=96?0:meanS>=95?1:meanS>=94?3:meanS>=93?5:8, meanS+'%');
  }
  if(n.ct94) push('ct94','CT<94%', n.ct94.ct94Pct,
    n.ct94.ct94Pct<5?1:n.ct94.ct94Pct<15?4:n.ct94.ct94Pct<30?7:10, n.ct94.ct94Pct+'%');

  // ── ODI ──
  if(n.odi4) push('odi4','ODI-4/hr', n.odi4.rate,
    n.odi4.rate<2?0:n.odi4.rate<5?2:n.odi4.rate<15?5:n.odi4.rate<30?8:10, n.odi4.rate+'/hr');
  if(n.odi3) push('odi3','ODI-3/hr', n.odi3.rate,
    n.odi3.rate<3?0:n.odi3.rate<8?2:n.odi3.rate<20?5:n.odi3.rate<35?8:10, n.odi3.rate+'/hr');
  if(n.odi1) push('odi1','ODI-1/hr', n.odi1.odi1Rate,
    n.odi1.odi1Rate<10?0:n.odi1.odi1Rate<20?2:n.odi1.odi1Rate<40?5:8, n.odi1.odi1Rate+'/hr');

  // ── Breathing disruption ──
  if(n.osc) push('pbEp','PB Episodes', n.osc.episodeCount,
    n.osc.episodeCount===0?0:n.osc.episodeCount<3?1:n.osc.episodeCount<8?4:n.osc.episodeCount<15?7:10,
    n.osc.episodeCount+' eps');
  if(n.rolling) push('worst10','Worst 10min SpO₂', n.rolling.worst10minSpo2,
    n.rolling.worst10minSpo2>=95?0:n.rolling.worst10minSpo2>=93?2:n.rolling.worst10minSpo2>=90?5:n.rolling.worst10minSpo2>=87?7:10,
    n.rolling.worst10minSpo2+'%');
  if(n.rolling) push('cdi','CDI/hr', n.rolling.cdi,
    n.rolling.cdi<3?0:n.rolling.cdi<8?2:n.rolling.cdi<15?5:n.rolling.cdi<25?7:10, n.rolling.cdi+'/hr');
  if(n.oxyCrash) push('oxyCrash','OxyCrash/hr', n.oxyCrash.oxyCrashRate,
    n.oxyCrash.oxyCrashRate<1?0:n.oxyCrash.oxyCrashRate<3?3:n.oxyCrash.oxyCrashRate<6?6:10,
    n.oxyCrash.oxyCrashRate+'/hr');

  // ── Hypoxic burden ──
  if(n.hb) push('hbRate','Hypoxic Burden', n.hb.rate,
    n.hb.rate<0.5?0:n.hb.rate<2?2:n.hb.rate<5?5:n.hb.rate<10?7:10, n.hb.rate+'%-min/hr');
  if(n.hypLoad) push('hypLoad','Hypoxic Load', n.hypLoad.hypoxicLoad,
    n.hypLoad.hypoxicLoad<0.5?0:n.hypLoad.hypoxicLoad<2?2:n.hypLoad.hypoxicLoad<5?5:9, n.hypLoad.hypoxicLoad);

  // ── AHI estimate ──
  if(n.ahiEst) push('ahiEst','AHI Estimate', n.ahiEst.ahiODI4,
    n.ahiEst.ahiODI4<5?0:n.ahiEst.ahiODI4<15?3:n.ahiEst.ahiODI4<30?6:9, n.ahiEst.ahiODI4);

  // ── Sleep quality ──
  if(n.sleepArch){
    if(n.sleepArch.wasoMin!==null) push('waso','WASO', n.sleepArch.wasoMin,
      n.sleepArch.wasoMin<5?0:n.sleepArch.wasoMin<15?2:n.sleepArch.wasoMin<30?5:8, n.sleepArch.wasoMin+'m');
    if(n.sleepArch.solMin!==null) push('sol','Sleep Onset', n.sleepArch.solMin,
      n.sleepArch.solMin<10?0:n.sleepArch.solMin<20?2:n.sleepArch.solMin<30?4:7, n.sleepArch.solMin+'m');
  } else if(n.motSleep) {
    if(n.motSleep.wasoPct!=null) push('waso','WASO %', n.motSleep.wasoPct,
      n.motSleep.wasoPct<5?0:n.motSleep.wasoPct<15?2:n.motSleep.wasoPct<30?5:8, n.motSleep.wasoPct+'%');
    if(n.motSleep.sleepEff!=null) push('sleepEff','Sleep Eff', n.motSleep.sleepEff,
      n.motSleep.sleepEff>=95?0:n.motSleep.sleepEff>=90?1:n.motSleep.sleepEff>=80?4:7, n.motSleep.sleepEff+'%');
  }
  if(n.sleepP) push('spi','Sleep Pressure', n.sleepP.spi,
    n.sleepP.spi<5?0:n.sleepP.spi<10?2:n.sleepP.spi<20?5:8, n.sleepP.spi);

  // ── Autonomic / HR ──
  if(n.comp) push('nsi','NSI', n.comp.nsi,
    n.comp.nsi<20?0:n.comp.nsi<40?2:n.comp.nsi<60?5:n.comp.nsi<80?7:10, n.comp.nsi);
  if(n.ssi) push('ssi','Symp Surge', n.ssi.ssi,
    n.ssi.ssi<0.3?0:n.ssi.ssi<0.8?2:n.ssi.ssi<1.5?5:8, n.ssi.ssi);
  if(n.cross) push('aai','AAI', n.cross.autoArousalIdx,
    n.cross.autoArousalIdx<1?0:n.cross.autoArousalIdx<3?2:n.cross.autoArousalIdx<6?5:8,
    n.cross.autoArousalIdx);
  if(n.hrnDip) push('hrnDip','Noct HR Dip', n.hrnDip.hrnDip,
    n.hrnDip.hrnDip>10?0:n.hrnDip.hrnDip>5?3:n.hrnDip.hrnDip>2?6:9, n.hrnDip.hrnDip+'%',
    n.hrnDip.hrnDip>10?'g':n.hrnDip.hrnDip>5?'w':'r');

  // ── Signal quality ──
  // DFA computed on SpO2 — always >1.0, HR-DFA thresholds inapplicable. Excluded from score.
  if(n.recIdx) push('recIdx','Recovery Idx', n.recIdx.recoveryIndex,
    n.recIdx.recoveryIndex>1.5?0:n.recIdx.recoveryIndex>0.8?2:n.recIdx.recoveryIndex>0.5?5:8,
    n.recIdx.recoveryIndex, n.recIdx.recoveryIndex>1.5?'g':n.recIdx.recoveryIndex>0.8?'w':'r');

  // ── Literature-validated severity indices ──
  if(n.sbii && n.sbii.sbii != null) {
    var _sq = n.sbii.sbiiQ||'';
    push('sbii','SBII', n.sbii.sbii,
      _sq==='Q5(high)'?10:_sq==='Q4'?7:_sq==='Q3'?4:_sq==='Q2'?1:0,
      n.sbii.sbii+' %²·min/hr', _sq==='Q5(high)'?'r':_sq==='Q4'?'w':'g');
  }
  if(n.pred3p && n.pred3p.pred3p != null) {
    var _pq = n.pred3p.pred3pQ||'';
    push('pred3p','pRED-3p', n.pred3p.pred3p,
      _pq==='Q5(high)'?10:_pq==='Q4'?7:_pq==='Q3'?4:_pq==='Q2'?1:0,
      n.pred3p.pred3p+'%', _pq==='Q5(high)'?'r':_pq==='Q4'?'w':'g');
  }
  if(n.desSev && n.desSev.desSev != null)
    push('desSev','DesSev', n.desSev.desSev,
      n.desSev.desSev<5?0:n.desSev.desSev<15?3:n.desSev.desSev<30?6:9,
      n.desSev.desSev+'%-min/hr');
  if(n.spo2Adv && n.spo2Adv.wtdsi != null)
    push('wtdsi','WtDSI', n.spo2Adv.wtdsi,
      n.spo2Adv.wtdsi<1?0:n.spo2Adv.wtdsi<3?2:n.spo2Adv.wtdsi<5?5:9,
      n.spo2Adv.wtdsi);


  if(n.patScore){
    if(n.patScore.csScore>0) push('cs','Cheyne-Stokes', n.patScore.csScore,
      n.patScore.csScore*3, n.patScore.csLabel, n.patScore.csScore===1?'w':'r');
    if(n.patScore.uarsScore>0) push('uars','UARS Pattern', n.patScore.uarsScore,
      n.patScore.uarsScore*3, n.patScore.uarsLabel, n.patScore.uarsScore===1?'w':'r');
  }

  // ── Sort by score descending, take top 5 ──
  metrics.sort(function(a,b){ return b.score - a.score; });
  var top5 = metrics.slice(0,5);

  // ── Generate one-line clinical impression ──
  var impression = buildImpression(n, top5, metrics);

  return { ranked: metrics, top5: top5, impression: impression,
           overallScore: top5.length ? Math.round(top5.reduce(function(a,m){return a+m.score;},0)/top5.length) : 0 };
}

function buildImpression(n, top5, all) {
  if(!top5.length) return 'Insufficient data for clinical impression.';

  var parts = [];
  var worstKey  = top5[0].key;
  var worstScore= top5[0].score;

  // Overall severity opener. Guardrail: the all-metric average can read 'clean' while a
  // single metric is red — never label a night clean/mild when its worst finding is severe
  // (would print e.g. "Clean night: severe desaturation"). Floor severity to the lead.
  var avgScore = all.reduce(function(a,m){return a+m.score;},0)/Math.max(all.length,1);
  var severity;
  if(avgScore < 2 && worstScore < 4)      severity = 'Clean night';
  else if(avgScore < 4 && worstScore < 6) severity = 'Mild disruption';
  else if(avgScore < 6)                   severity = 'Moderate burden';
  else                                    severity = 'Significant burden';
  var isolatedSevere = (avgScore < 4 && worstScore >= 6);   // mostly-clean night, one red finding

  // Lead finding
  var leads = {
    minSpo2:   function(){ return n.stats?('nadir SpO₂ '+n.stats.minSpo2+'%'):'nadir unavailable'; },
    t95:       function(){ return n.stats?('T95 '+n.stats.t95pct+'%'):'T95 unavailable'; },
    odi4:      function(){ return n.odi4?('ODI-4 '+n.odi4.rate+'/hr'):'ODI-4 unavailable'; },
    pbEp:      function(){ return n.osc?(n.osc.episodeCount+' PB episodes'):'PB data unavailable'; },
    worst10:   function(){ return 'worst 10-min SpO₂ '+n.rolling.worst10minSpo2+'%'; },
    cdi:       function(){ return n.rolling?('CDI '+n.rolling.cdi+'/hr'):'CDI unavailable'; },
    nsi:       function(){ return n.comp?('NSI '+n.comp.nsi):'NSI unavailable'; },
    waso:      function(){ return n.sleepArch&&n.sleepArch.wasoMin!=null?'WASO '+n.sleepArch.wasoMin+'m':'WASO —'; },
    dfa:       function(){ return n.dfa?('DFA α1 '+n.dfa.alpha1):'DFA unavailable'; },
    hbRate:    function(){ return n.hb?('HB rate '+n.hb.rate+' %-min/hr'):'HB unavailable'; },
    oxyCrash:  function(){ return n.oxyCrash?('OxyCrash '+n.oxyCrash.oxyCrashRate+'/hr'):'OxyCrash unavailable'; },
    ahiEst:    function(){ return n.ahiEst?('AHI est. '+n.ahiEst.ahiODI4):'AHI unavailable'; },
    cs:        function(){ return n.patScore?('CS pattern probable ('+n.patScore.csLabel+')'):'CS unavailable'; },
    uars:      function(){ return n.patScore?('UARS pattern ('+n.patScore.uarsLabel+')'):'UARS unavailable'; },
    hypLoad:   function(){ return n.hypLoad?('hypoxic load '+n.hypLoad.hypoxicLoad):'hypLoad unavailable'; },
    hrnDip:    function(){ return n.hrnDip?('blunted nocturnal HR dip '+n.hrnDip.hrnDip+'%'):'HR dip unavailable'; },
    recIdx:    function(){ return n.recIdx?('impaired SpO₂ recovery (idx '+n.recIdx.recoveryIndex+')'):'recIdx unavailable'; },
  };

  var leadTxt = leads[worstKey] ? leads[worstKey]() : top5[0].label+' '+top5[0].displayVal;

  // Supporting finding
  var supportTxt = top5.length > 1
    ? (leads[top5[1].key] ? leads[top5[1].key]() : top5[1].label+' '+top5[1].displayVal)
    : '';

  // Context qualifier
  var context = '';
  if(n.patScore && n.patScore.csScore >= 2) context = '; CS pattern likely — review CPAP pressure';
  else if(n.patScore && n.patScore.uarsScore >= 2) context = '; UARS pattern — consider UARS protocol';
  else if(n.stab && n.stab.score != null && n.stab.score >= 80) context = '; otherwise stable baseline';
  else if(n.osc && n.osc.episodeCount >= 10) context = '; high PB burden';

  parts.push(severity+': '+leadTxt);
  if(isolatedSevere && !supportTxt) parts.push('otherwise an isolated finding on a quiet night');
  if(supportTxt) parts.push(supportTxt);

  return parts.join(', ')+context+'.';
}

function processNight(rows, fname) {
  var warmupTrim = trimSensorWarmup(rows);       // FIRST — drop device warm-up/cool-down placeholder edge rows (OXYDEX-HR-ARTIFACT-RUNAWAY-FIX Fix 2)
  var artifactsCleaned = cleanArtifactHR(rows);  // then clean HR before any analysis
  var date   = rows.length ? fmtDate(rows[0].t) : 'Unknown';
  var t0Ms   = rows.length ? rows[0].tMs : null;   // CLOCK-UNIFY per-recording anchor
  var stats  = computeStats(rows);
  stats.artifactHrCleaned = artifactsCleaned;
  // EXPORT-INVARIANCE (OXYDEX-HR-ARTIFACT-RUNAWAY-FIX Fix 2): attach the trim counts ONLY when a trim
  // actually fired. `stats` is serialized WHOLESALE into the export (oxyBuildNightElement: stats:n.stats),
  // so an always-present `sensorWarmupTrimmed:0` would move EVERY night's export bytes — including the
  // committed provenance fixtures (20260612 / 20260624, both no-trim). Conditional assignment → zero
  // churn on any untrimmed night; buildFlags reads `>0`, correctly false when the field is absent.
  if (warmupTrim.head > 0) stats.sensorWarmupTrimmed   = warmupTrim.head;
  if (warmupTrim.tail > 0) stats.sensorCooldownTrimmed = warmupTrim.tail;
  var rawSpikes = detectSpikes(rows);
  var spikes    = filterArtifactSpikes(rawSpikes);
  stats.artifactSpikesRemoved = rawSpikes.length - spikes.length;
  var period = detectPeriodicity(spikes);
  var osc    = detectOscillations(rows);
  // OXYDEX-NODE-EXPORT-ENVELOPE §2b: lift the per-episode PB onsets OFF n.osc (keeping its 5-key
  // display shape byte-identical in the export element) onto night_obj.oscEpisodes, where
  // oxyBuildGangliorEvents reads them to emit one periodic_breathing event per oscillation episode.
  var _oscEpisodes = (osc && osc.episodes) ? osc.episodes : [];
  if (osc) delete osc.episodes;
  var tIdx   = computeTIndex(rows);
  var hrv    = computeHRV(rows);
  var spo2s  = rows.map(function(r){return r.spo2;});
  // DEX-EVENT-UNIFY-FOLLOWUPS-II §1 — PERF MEMOIZE: the trailing-p90 CEILING baseline is a pure
  // function of (spo2, WIN=300, pct=90), and EVERY desat consumer below uses those defaults, so each
  // detectDesatEvents call would otherwise re-walk the identical O(n·101) histogram. Compute it ONCE
  // and thread it as opts.blArr — bit-identical numbers (the array is deterministic), ~11 redundant
  // baseline walks collapse to 1. The per-consumer event scan stays local (cheap O(n); and the two
  // close modes mean there is no single shared event set — see detectDesatEvents §3). detectDesatEvents
  // falls back to computing blArr when absent, so every direct/test caller is unaffected.
  var blArr  = computeCeilingBaselineArr(spo2s, 300, 90);
  var odi4   = detectODI(spo2s, DexKernel.K.ODI_DROP, rows.length, blArr);
  var odi3   = detectODI(spo2s, 3, rows.length, blArr);
  var hb     = computeHypoxicBurden(rows);
  var motion = computeMotionProfile(rows);
  var stab   = computeSleepStabilityScore(stats, hrv, osc, hb);
  var durationHr = stats.durationMin / 60;
  var desat  = computeDesaturationProfile(rows, tIdx, odi4, blArr);
  // OXIMETER SELF-GATE (Part A): exclude self-gated artifact desaturations from
  // the ODI-4 rate. The desat profile and the ODI counter share the same
  // inclusive bl-ODI_DROP entry, so each flagged artifact corresponds to one
  // ODI-4 event; subtract them so a probe-squeeze "67% cliff" never inflates ODI.
  if(odi4 && desat && desat.artifactCount){
    odi4.count = Math.max(0, (odi4.count||0) - desat.artifactCount);
    odi4.rate  = +(odi4.count / Math.max(durationHr, 0.01)).toFixed(1);
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
  var cross   = computeCrossSignal(rows, osc, spikes, odi4, durationHr);
  var spo2Adv = computeSpO2Advanced(rows, blArr); // nadir events computed inline
  var hrAdv   = computeHRAdvanced(rows, osc);
  var comp    = computeComposite(rows, spikes, desat, cross, motSleep, durationHr);
  // v20: literature-validated metrics
  var sbii    = computeSBII(rows, null, durationHr, blArr); // nadir events computed inline
  var pred3p  = computePRED3p(rows, null, blArr);
  var desSev  = computeDesSev(rows, blArr);
  var ctPrec  = computeCTprecise(rows);
  // v20.2: 15 new metrics
  var ct94    = computeCT94(rows);
  var slopes  = computeDesatSlopes(rows, blArr);
  var pbMet   = computePBmetrics(rows, osc);
  var sleepArch = computeSleepArch(rows);
  var odi1    = computeODI1(rows, blArr);
  var odi4Rate  = odi4 ? odi4.rate : 0;
  var odi3Rate  = odi3 ? odi3.rate : 0;
  var desSevRate = desSev ? desSev.desSev : 0;
  var t95Pct    = stats ? stats.t95pct : 0;
  var ct90Sec   = ctPrec ? (ctPrec.ct90s || 0) : 0;
  var mos     = computeMOS(odi4Rate, ct90Sec);
  var ahiEst  = computeAHIestimates(odi4Rate, odi3Rate, desSevRate, t95Pct);
  var flags   = buildFlags(stats, spikes, period, osc, odi4, odi3, hrv, motion, stab, hrProf, cross, spo2Adv, comp, sbii, pred3p);
  // v20.3: 20 new metrics
  var extras  = computeNightExtras(rows, stats, desat, odi1, odi4, hb);
  var rolling = computeRollingMetrics(rows, desat, comp, blArr);
  var patScore= computePatternScores(pbMet, osc, cross, flags, odi4, comp);
  // v20.4: 14 new metrics
  var dfa     = computeDFA(rows);
  var fft     = computeSpO2FFT(rows);
  var hrEnt   = computeHREntropy(rows);
  var ssi     = computeSympSurge(rows, spikes, cross, rolling, rows.length/3600);
  var circHR  = computeCircadianHR(rows);
  var spo2Ent = computeSpO2Entropy(rows);
  var hypLoad = computeHypoxicLoad(desat, odi3, rows.length/3600, rows, blArr);
  var vagal   = computeVagalIndex(hrv, extras);
  var recIdx  = computeRecoveryIndex(slopes);
  var sleepP  = computeSleepPressure(sleepArch, extras);
  var breathI = computeBreathingIrregularity(desat, rows, blArr);
  var oxyCrash= computeOxyCrash(rows);
  var hrnDip  = computeHRNoctDip(hrv, stats);
  var desatAsym= computeDesatAsymmetry(slopes);
  // ── v20.6 New Metrics A–O ──────────────────────────────────────
  var spo2Drift  = computeSpO2Drift(rows);
  var odi2       = computeODI2(rows);
  var spo2Over   = computeSpO2Overshoot(rows, desat);
  var spo2Ac1    = computeSpO2Autocorr(rows);
  var hrFreq     = computeHRFreqBands(rows);
  var respRate   = computeRespRateProxy(rows);
  var hrAsym     = computeHRAsymmetry(rows);
  var hrQuart    = computeHRQuartileTrend(rows);
  var spo2HRLag  = computeSpO2HRLag(rows);
  var spkDecay   = computeSpikeDecay(rows, spikes);
  var spkUnder   = computeSpikeUndershoot(rows, spikes);
  var spkRise    = computeSpikeRiseRate(spikes);
  var dataGaps   = computeDataGaps(rows);
  var hrFlat     = computeHRFlatlines(rows);
  var spo2Ceil   = computeSpO2Ceiling(rows);
  // ── v20.7 New Metrics (18 functions) ──────────────────────────
  var odri        = computeODRI(odi1, odi3);
  var spo2Pct     = computeSpO2Percentiles(rows);
  var spo2Shape   = computeSpO2Shape(rows);
  var hrCV        = computeHRCV(rows);
  var hypDose     = computeHypoxicDose(rows);
  var t88t85      = computeT88T85(rows);
  var lcsp        = computeLCSP(rows);
  var poincare    = computePoincareSD(rows);
  var o2hrEff     = computeO2HREfficiency(rows, desat);
  var condSpo2    = computeConditionalSpO2(rows);
  var nadirTrend  = computeNadirTrend(desat);
  var iei         = computeIEI(desat);
  var recovCV     = computeRecoverySlopeCV(desat);
  var hrNadirT    = computeHRNadirTime(rows);
  var spo2NadirT  = computeSpO2NadirTime(rows, desat);
  var rmssdArc    = computeRMSSDarc(rows);
  var spk50Rec    = computeSpike50PctRecovery(rows, spikes);
  var stageProxy  = computeSleepStageProxy(rows);
  var vo2est     = computeVO2maxEstimate(rows, hrv, dfa, hrNadirT, UP.age);
  var bpProj     = null;  // BP projection REMOVED 2026-06-21 (external-review WP-A) — cuffless BP from oximetry is indefensible
  var karv       = computeKarvonenZones(rows, hrv, vo2est, odi4, hypDose, sleepArch, stageProxy, UP.age);
  var night_obj = { date:date, t0Ms:t0Ms, fname:fname, stats:stats, spikes:spikes, period:period, osc:osc, tIdx:tIdx, hrv:hrv, odi4:odi4, odi3:odi3, hb:hb, motion:motion, stab:stab, desat:desat, hrProf:hrProf, motSleep:motSleep, cross:cross, spo2Adv:spo2Adv, hrAdv:hrAdv, comp:comp, sbii:sbii, pred3p:pred3p, desSev:desSev, ctPrec:ctPrec, ct94:ct94, slopes:slopes, pbMet:pbMet, sleepArch:sleepArch, odi1:odi1, mos:mos, ahiEst:ahiEst, extras:extras, rolling:rolling, patScore:patScore, dfa:dfa, fft:fft, hrEnt:hrEnt, ssi:ssi, circHR:circHR, spo2Ent:spo2Ent, hypLoad:hypLoad, vagal:vagal, recIdx:recIdx, sleepP:sleepP, breathI:breathI, oxyCrash:oxyCrash, hrnDip:hrnDip, desatAsym:desatAsym, flags:flags, spo2Drift:spo2Drift, odi2:odi2, spo2Over:spo2Over, spo2Ac1:spo2Ac1, hrFreq:hrFreq, respRate:respRate, hrAsym:hrAsym, hrQuart:hrQuart, spo2HRLag:spo2HRLag, spkDecay:spkDecay, spkUnder:spkUnder, spkRise:spkRise, dataGaps:dataGaps, hrFlat:hrFlat, spo2Ceil:spo2Ceil, odri:odri, spo2Pct:spo2Pct, spo2Shape:spo2Shape, hrCV:hrCV, hypDose:hypDose, t88t85:t88t85, lcsp:lcsp, poincare:poincare, o2hrEff:o2hrEff, condSpo2:condSpo2, nadirTrend:nadirTrend, iei:iei, recovCV:recovCV, hrNadirT:hrNadirT, spo2NadirT:spo2NadirT, rmssdArc:rmssdArc, spk50Rec:spk50Rec, stageProxy:stageProxy, vo2est:vo2est, bpProj:bpProj, karv:karv };
  night_obj.oscEpisodes = _oscEpisodes;
  night_obj.summary = computeSmartSummary(night_obj);
  // EXPORT-IDENTITY §2.1 / -FOLLOWUPS-II §1: deterministic, identity-free recording handle.
  // processNight is the ONE site BOTH the app (exportJSON→allNights→oxyBuildNightElement) AND
  // the headless OxyDex.compute path reach, so the id is single-sourced and can't drift between
  // them. Folds the per-second SpO2 sample array + the floating t0Ms via the CORE
  // SignalFrame.computeContentId (signal-frame.js is bundled into OxyDex); identity-free (no
  // name/serial folded), viewer-TZ-independent (numeric t0Ms), null when SignalFrame absent.
  night_obj.contentId = (typeof SignalFrame!=='undefined' && SignalFrame && SignalFrame.computeContentId)
    ? SignalFrame.computeContentId({ signalType:'spo2', kind:'samples', samples:rows.map(function(r){return r.spo2;}), t0Ms:(t0Ms!=null?t0Ms:null), usable:true })
    : null;
  return night_obj;
}

function computeStats(rows) {
  var spo2=rows.map(function(r){return r.spo2;}),
      hr=rows.map(function(r){return r.hr;}), n=rows.length;
  var mSpo2=avg(spo2), mHr=avg(hr);
  var rawDurMs = rows[n-1].tMs - rows[0].tMs;   // monotonic floating wall-clock → always ≥0
  return {
    durationMin: +(rawDurMs/60000).toFixed(1),
    start: fmtTime(rows[0].t), end: fmtTime(rows[n-1].t),
    meanSpo2: isFinite(mSpo2) ? +mSpo2.toFixed(1) : 0, minSpo2: spo2.length?Math.min.apply(null,spo2):0, maxSpo2: spo2.length?Math.max.apply(null,spo2):0,
    spo2Std: +stdDev(spo2).toFixed(2),
    t95pct: n>0 ? +(spo2.filter(function(v){return v<95;}).length/n*100).toFixed(1) : 0,
    t90pct: n>0 ? +(spo2.filter(function(v){return v<90;}).length/n*100).toFixed(1) : 0,
    meanHr: isFinite(mHr) ? +mHr.toFixed(1) : 0, minHr: hr.length?Math.min.apply(null,hr):0, maxHr: hr.length?Math.max.apply(null,hr):0,
    motionPct: n>0 ? +(rows.filter(function(r){return r.motion>0;}).length/n*100).toFixed(1) : 0, n:n, startTs: rows.length ? rows[0].tMs : null
  };
}

function computeTIndex(rows) {
  var spo2=rows.map(function(r){return r.spo2;}), n=spo2.length, out={};
  [95,94,93,92,91,90,89,88,85,80].forEach(function(t){
    var s=spo2.filter(function(v){return v<t;}).length;
    out[t]={secs:s, pct: n>0 ? +(s/n*100).toFixed(2) : 0};
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
  var clean = rows.filter(function(r){ return r.motion === 0 && !r.hrArtifact; });
  var n = clean.length;
  if (n < 120) return null;

  var hrs  = clean.map(function(r){ return r.hr; });
  var spo2 = clean.map(function(r){ return r.spo2; });

  // 1. SDNN-proxy: SD of all motion-free HR values
  var hrSdnn = +stdDev(hrs).toFixed(2);

  // 2. pNN3-equiv: % consecutive HR pairs with |ΔHR| ≥ 3 BPM
  //    At sleep HR ~53 bpm, 3 bpm ≈ 50 ms RR difference (analogous to pNN50).
  //    1Hz quantization compresses true HF-HRV — use as relative indicator only.
  var nn3 = 0;
  for (var i = 1; i < n; i++) { if (Math.abs(clean[i].hr - clean[i-1].hr) >= 3) nn3++; }
  var pnn3 = +(nn3 / (n - 1) * 100).toFixed(1);

  // 3. HR floor: 5th percentile (robust vs. single-sample outliers in minHr)
  var sorted = hrs.slice().sort(function(a,b){ return a-b; });
  var hrFloor = sorted[Math.floor(sorted.length * 0.05)];

  // 4. HR slope: linear regression of HR over recording (BPM/hr)
  //    Negative = HR falling across the night (healthy parasympathetic recovery).
  //    Positive = rising HR pattern (stress, fragmented sleep, REM rebound).
  var t0 = clean[0].t.getTime();
  var sumX=0, sumY=0, sumXY=0, sumX2=0;
  for (var i = 0; i < n; i++) {
    var x = (clean[i].t.getTime() - t0) / 3600000;
    var y = clean[i].hr;
    sumX += x; sumY += y; sumXY += x*y; sumX2 += x*x;
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
  var rsaProxy = rsaWins.length ? +(rsaWins.reduce(function(a,b){return a+b;},0) / rsaWins.length).toFixed(3) : null;

  // hrSdnnProxy = SD of 1Hz HR values (BPM). NOT RR-interval SDNN. Use for relative night-to-night trending only.
  // RMSSD-proxy (1Hz, bpm): sqrt(mean squared successive HR differences)
  // NOTE: 1Hz quantization gives ~0.4-0.9 bpm; multiply by ~21 to approximate ms at HR≈53
  var rmssd_ss = 0;
  for(var i=1; i<n; i++){ var d=hrs[i]-hrs[i-1]; rmssd_ss+=d*d; }
  var rmssd = n>1 ? +(Math.sqrt(rmssd_ss/(n-1))).toFixed(2) : 0;
  // maxHr: highest clean still HR (used by VO2max as floor check)
  var maxHr = hrs.length ? Math.max.apply(null, hrs) : 0;
  return { hrSdnnProxy:hrSdnn, hrSdnn:hrSdnn, pnn3:pnn3, hrFloor:hrFloor, hrSlope:hrSlope, rsaProxy:rsaProxy, rmssd:rmssd, maxHr:maxHr, n:n };
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
  var dropPct = (opts.dropPct == null) ? DexKernel.K.ODI_DROP : opts.dropPct;
  var hystPct = (opts.hystPct == null) ? DexKernel.K.ODI_HYST : opts.hystPct;
  var exitPct = opts.exitPct;                       // undefined → hysteresis close
  var minSec  = (opts.minSec  == null) ? 10 : opts.minSec;
  var WIN     = opts.WIN || 300;                    // 5-min clinical baseline
  var blArr   = opts.blArr || computeCeilingBaselineArr(spo2, WIN, opts.pct || 90); // O(n) p90 ceiling
  var events  = [];
  var inEv = false, evStart = 0, evNadir = 100, evNadirIdx = 0, evBaseline = 100;
  // Push a completed event (shared by the in-loop close and the end-of-record flush).
  function pushEvent(endIdxRaw) {
    if (endIdxRaw - evStart < minSec) return;       // ignore sub-minSec blips
    var recEnd = Math.min(n - 1, endIdxRaw);
    var dipDur = Math.max(1, evNadirIdx - evStart);
    var recDur = Math.max(1, recEnd - evNadirIdx);
    events.push({
      startIdx: evStart, nadirIdx: evNadirIdx, endIdx: recEnd,
      baseline: isFinite(evBaseline) ? +evBaseline.toFixed(1) : 0, nadir: evNadir,
      depth: +(evBaseline - evNadir).toFixed(1), durationSec: endIdxRaw - evStart,
      dipSlope: +((evNadir - evBaseline) / dipDur).toFixed(3),
      recSlope: +((spo2[recEnd] - evNadir) / recDur).toFixed(3)
    });
  }
  for (var i = 0; i < n; i++) {
    var bl = blArr[i];
    if (!inEv) {
      // inclusive <= : a dip of EXACTLY dropPct% counts (ODI-4 = ≥4%)
      if (spo2[i] <= bl - dropPct) { inEv = true; evStart = i; evNadir = spo2[i]; evNadirIdx = i; evBaseline = bl; }
    } else {
      if (spo2[i] < evNadir) { evNadir = spo2[i]; evNadirIdx = i; }
      // Close: hysteresis (>= bl − hystPct, anti-chatter) OR simple re-rise (> bl − exitPct).
      var reentered = (exitPct == null) ? (spo2[i] >= bl - hystPct) : (spo2[i] > bl - exitPct);
      if (reentered) { pushEvent(i); inEv = false; }
    }
  }
  if (inEv) pushEvent(n);                            // flush a desat still open at EOF
  return events;
}

function detectODI(spo2, drop, n, blArr) {
  // ODI = ceiling-baseline desaturations ≥ drop% lasting ≥10s, per hour. Routed through the
  // ONE primitive with a SIMPLE re-rise close (exitPct === drop) so the count is event-for-
  // event identical to the v22.36 reference detector — ODI-4/ODI-3 are UNCHANGED by the
  // unification, while every satellite metric now scores the SAME events. (DEX-EVENT-UNIFY A)
  var events = detectDesatEvents(spo2, { dropPct: drop, exitPct: drop, blArr: blArr });
  var hrs = n / 3600;
  return { count: events.length, rate: +(events.length / Math.max(hrs, 0.01)).toFixed(1) };
}

function detectSpikes(rows) {
  var spikes = [], lastIdx = -CFG.SPIKE_COOLDOWN_SEC * 2, n = rows.length;
  for (var i = 10; i < n - 20; i++) {
    if (rows[i].motion > 0) continue;
    if (i - lastIdx < CFG.SPIKE_COOLDOWN_SEC) continue;
    // Skip if any sample in the 10-sample baseline window has motion (corrupts baseline)
    var motionInWindow = false;
    for (var k = i - 10; k < i; k++) { if (k >= 0 && rows[k].motion > 0) { motionInWindow = true; break; } }
    if (motionInWindow) continue;
    var bl = 0, cnt = 0;
    for (var k = i - 10; k < i; k++) { if (k >= 0) { bl += rows[k].hr; cnt++; } }
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
    spikes.push({time: fmtTimeFull(rows[i].t), baseline: Math.round(bl), peak: localMax40, duration: dur, spo2: rows[i].spo2, mfm: mfm});
    lastIdx = i;
  }
  return spikes;
}

function detectPeriodicity(spikes) {
  if (spikes.length < 3) return null;
  var times = spikes.map(function(s){ return parseTimeStr(s.time); });
  for (var i = 1; i < times.length; i++) { while (times[i] < times[i-1]) times[i] += 86400; }
  var intervals = [];
  for (var i = 1; i < times.length; i++) intervals.push(Math.round((times[i] - times[i-1]) / 60));
  if (intervals.length < 3) return null;
  var sorted = intervals.slice().sort(function(a,b){ return a-b; });
  var med = sorted[Math.floor(sorted.length/2)];
  var kept = intervals.filter(function(v){ return Math.abs(v - med) <= 10; });
  if (kept.length < 3) return null;
  var avgInterval = Math.round(kept.reduce(function(x,y){ return x+y; },0) / kept.length);
  var spread = Math.max.apply(null, kept) - Math.min.apply(null, kept);
  var regularity = intervals.length ? kept.length / intervals.length : 0;
  var pattern = null;
  if (regularity >= 0.8 && avgInterval >= 50 && avgInterval <= 75 && spread <= 6) pattern = 'REGULAR';
  else if (regularity >= 0.8 && avgInterval >= 20 && avgInterval <= 45 && spread <= 6) pattern = 'PLM_CANDIDATE';
  else if (regularity >= 0.7 && avgInterval >= 75 && avgInterval <= 105 && spread <= 8) pattern = 'REM_BOUNDARY';
  else return null;
  return {avg: avgInterval, spread: spread, pattern: pattern, intervals: kept};
}

function parseTimeStr(s){ var m=s.match(/(\d{2}):(\d{2}):(\d{2})/); return m?+m[1]*3600+ +m[2]*60+ +m[3]:0; }

function detectOscillations(rows) {
  var n = rows.length, WSEC = CFG.OSC_WINDOW_SEC, flagged = [];
  for (var start = 0; start + WSEC <= n; start += WSEC) {
    var cross = 0, below = 0, motion = 0;
    for (var j = start + 1; j < start + WSEC; j++) {
      if ((rows[j-1].spo2 >= CFG.SPO2_OSC_THRESHOLD) !== (rows[j].spo2 >= CFG.SPO2_OSC_THRESHOLD)) cross++;
      if (rows[j].spo2 < CFG.SPO2_OSC_THRESHOLD) below++;
      if (rows[j].motion > 0) motion++;
    }
    var lowMotion = motion / Math.max(WSEC-1,1) < 0.08;
    var sustained = below >= 40;
    // OXYDEX-NODE-EXPORT-ENVELOPE §2b: retain the flagged window's start INDEX + absolute floating
    // tMs so the node-export can emit one periodic_breathing event per episode (Clock Contract §6).
    if (lowMotion && sustained && cross >= CFG.OSC_FLAG_CROSSINGS) flagged.push({cross:cross,below:below,start:fmtTimeFull(rows[start].t),startIdx:start,tMs:rows[start].tMs});
  }
  var totalCross = flagged.reduce(function(s,w){return s+w.cross;},0);
  // NOTE: the leading 5 keys are the FROZEN display shape (the export element serializes them
  // verbatim). `episodes` is added LAST and is stripped back off by processNight (→ oscEpisodes),
  // so the per-night export element stays byte-identical.
  return { episodeCount:flagged.length,
    peakCrossings:flagged.length?Math.max.apply(null,flagged.map(function(w){return w.cross;})):0,
    totalCrossings:totalCross,
    first:flagged.length?flagged[0].start:null, last:flagged.length?flagged[flagged.length-1].start:null,
    episodes:flagged.map(function(w){ return { tMs:(w.tMs!=null?w.tMs:null), startIdx:w.startIdx, cross:w.cross, below:w.below, windowSec:WSEC }; }) };
}

// Shared flag severity derivation — single source of truth used by
// buildFlags, parseSummaryCSV, and parseJSONL so all paths are consistent.
function _flagSev(f) {
  if (f === 'OK') return 'ok';
  var BAD = ['CRITICAL','T90_','T95_HIGH','ODI4_ABNORMAL','BRADYCARDIA','POOR_STABILITY','SBII_Q5','PRED3P_Q5'];
  for (var _i=0; _i<BAD.length; _i++) if (f.indexOf(BAD[_i])>=0) return 'bad';
  if (f.indexOf('NOCTURNAL_STRESS')>=0) {
    var _m = f.match(/\((\d+)\)/); return (_m && parseInt(_m[1], 10)>=80) ? 'bad' : 'warn';
  }
  var WARN = ['PERIODIC','BLUNTED','HIGH_AROUSAL','BORDERLINE','ODI4_BORDERLINE',
              'ODI3_ELEVATED','HR_SPIKES','MAX_HR','HRV_LOW','HRV_HR_RISING',
              'RESTLESS','TACHYCARDIA','WTDSI_ELEVATED','SBII_Q4','PRED3P_Q4'];
  for (var _j=0; _j<WARN.length; _j++) if (f.indexOf(WARN[_j])>=0) return 'warn';
  return 'info';
}
function buildFlags(stats, spikes, period, osc, odi4, odi3, hrv, motion, stab, hrProf, cross, spo2Adv, comp, sbii, pred3p) {
  var f=[];
  if(stats.t90pct>1)         f.push({code:'T90_ELEVATED',sev:'bad'});
  if(stats.t95pct>15)        f.push({code:'T95_HIGH',sev:'bad'});
  if(stats.minSpo2<=88)      f.push({code:'SPO2_CRITICAL_DIP',sev:'bad'});
  if(odi4.rate>=5)           f.push({code:'ODI4_ABNORMAL',sev:'bad'});
  else if(odi4.rate>=2)      f.push({code:'ODI4_BORDERLINE',sev:'warn'});
  if(odi3.rate>=15)          f.push({code:'ODI3_ELEVATED',sev:'warn'});
  if(spikes.length>=4)       f.push({code:'HR_SPIKES('+spikes.length+')',sev:'warn'});
  if(period){
    var sv=period.pattern==='PLM_CANDIDATE'?'warn':'info';
    f.push({code:period.pattern+'~'+period.avg+'min',sev:sv});
  }
  if(osc.episodeCount>=4)    f.push({code:'PERIODIC_BREATHING('+osc.episodeCount+')',sev:'warn'});
  if(stats.maxHr>105)        f.push({code:'MAX_HR('+stats.maxHr+')',sev:'warn'});
  if(hrv) {
    if(hrv.pnn3 < 0.2)       f.push({code:'HRV_LOW_pNN3('+hrv.pnn3+'%)',sev:'warn'});
    if(hrv.hrSlope > 1.5)    f.push({code:'HRV_HR_RISING('+hrv.hrSlope+'bpm/hr)',sev:'warn'});
    if(hrv.hrFloor > 65)     f.push({code:'HRV_FLOOR_HIGH('+hrv.hrFloor+')',sev:'info'});
  }
  if(stats.artifactHrCleaned>0)        f.push({code:'HR_ARTIFACT_CLEANED('+stats.artifactHrCleaned+')',sev:'info'});
  if(stats.artifactSpikesRemoved>0)    f.push({code:'CLOCK_SPIKES_REMOVED('+stats.artifactSpikesRemoved+')',sev:'info'});
  if(stats.sensorWarmupTrimmed>0)      f.push({code:'SENSOR_WARMUP_TRIMMED('+stats.sensorWarmupTrimmed+')',sev:'info'});
  if(stats.sensorCooldownTrimmed>0)    f.push({code:'SENSOR_COOLDOWN_TRIMMED('+stats.sensorCooldownTrimmed+')',sev:'info'});
  if(stats.nadirArtifactExcluded>0)    f.push({code:'SPO2_NADIR_GATED('+stats.minSpo2Raw+'→'+stats.minSpo2+')',sev:'info'});
  if(motion && motion.arousalIndex>=40) f.push({code:'RESTLESS_NIGHT('+motion.arousalIndex+'%)',sev:'warn'});
  if(stab && stab.score != null && stab.score < 50) f.push({code:'POOR_STABILITY('+stab.score+')',sev:'bad'});
  if(hrProf && hrProf.bradyCount>0)    f.push({code:'BRADYCARDIA('+hrProf.bradyCount+')',sev:'bad'});
  if(hrProf && hrProf.tachyCount>0)    f.push({code:'TACHYCARDIA_EVENTS('+hrProf.tachyCount+')',sev:'warn'});
  if(cross && cross.divergePct>=75 && osc && osc.episodeCount>=6) f.push({code:'BLUNTED_AROUSAL('+cross.divergePct+'%)',sev:'warn'});
  if(cross && cross.autoArousalIdx>=5) f.push({code:'HIGH_AROUSAL_IDX('+cross.autoArousalIdx+')',sev:'warn'});
  if(comp  && comp.nsi>=80)           f.push({code:'NOCTURNAL_STRESS('+comp.nsi+')',sev:'bad'});
  else if(comp  && comp.nsi>=60)           f.push({code:'NOCTURNAL_STRESS('+comp.nsi+')',sev:'warn'});

  if(spo2Adv && spo2Adv.wtdsi>5)      f.push({code:'WTDSI_ELEVATED('+spo2Adv.wtdsi+')',sev:'warn'});
  if(sbii   && sbii.sbiiQ==='Q5(high)')  f.push({code:'SBII_Q5('+sbii.sbii+')',sev:'bad'});
  if(sbii   && sbii.sbiiQ==='Q4')        f.push({code:'SBII_Q4('+sbii.sbii+')',sev:'warn'});
  if(pred3p && pred3p.pred3pQ==='Q5(high)') f.push({code:'PRED3P_Q5('+pred3p.pred3p+'%)',sev:'bad'});
  if(pred3p && pred3p.pred3pQ==='Q4')       f.push({code:'PRED3P_Q4('+pred3p.pred3p+'%)',sev:'warn'});
  if(!f.length)                        f.push({code:'OK',sev:'ok'});
  return f;
}


// ═══════════════════════════════════════════
// v14 — NEW ANALYSIS FUNCTIONS
// ═══════════════════════════════════════════

// Hypoxic Burden: area-under-curve below SpO2=94% (%-min total & %-min/hr rate).
// More sensitive than ODI for sustained mild desaturation patterns.
// Clinical reference: >25 %-min/hr is considered elevated.
function computeHypoxicBurden(rows) {
  var burden = 0, n = rows.length;
  for (var i = 0; i < n; i++) { if (rows[i].spo2 < 94) burden += (94 - rows[i].spo2); }
  var durationHr = n / 3600;
  var totalMin = +(burden / 60).toFixed(1);
  var rate = durationHr > 0 ? +(totalMin / durationHr).toFixed(1) : 0;
  return { total: totalMin, rate: rate };
}

// Motion Profile: divide night into 30-min windows, score each for motion %.
// Restless window = any window where motion% >= 2.0.
// Arousal index = % of total windows that are restless (0-100).
function computeMotionProfile(rows) {
  var WIN = 1800, windows = [], n = rows.length, i = 0;
  while (i < n) {
    var sl = rows.slice(i, Math.min(i + WIN, n));
    var mc = sl.filter(function(r){ return r.motion > 0; }).length;
    windows.push({ start: pad(rows[i].t.getUTCHours())+':'+pad(rows[i].t.getUTCMinutes()), motionPct: +(mc/sl.length*100).toFixed(1), samples: sl.length });
    i += WIN;
  }
  // v15: weight by sample count so partial last window doesn't over-inflate arousal index
  var totalSamples = windows.reduce(function(s,w){ return s+w.samples; }, 0);
  var restlessSamples = windows.filter(function(w){ return w.motionPct >= 2.0; }).reduce(function(s,w){ return s+w.samples; }, 0);
  var restless = windows.filter(function(w){ return w.motionPct >= 2.0; }).length;
  var arousalIndex = totalSamples > 0 ? +(restlessSamples/totalSamples*100).toFixed(0) : 0;
  return { windows: windows, restlessWindows: restless, arousalIndex: +arousalIndex, totalWindows: windows.length };
}

// Sleep Stability Score: composite 0-100 (higher = better).
// Weighted across 6 components. Single integrative index for quick trending.
function computeSleepStabilityScore(stats, hrv, osc, hb) {
  var s1 = Math.max(0, Math.min(100, Math.round((2.0 - stats.spo2Std) / 1.5 * 100)));
  var s2 = hrv ? Math.max(0, Math.min(100, Math.round((70 - hrv.hrFloor) / 18 * 100))) : 50;
  var s3 = Math.max(0, Math.min(100, Math.round((2.0 - stats.motionPct) / 1.8 * 100)));
  var s4 = Math.max(0, Math.min(100, Math.round((20 - osc.episodeCount) / 20 * 100)));
  var s5 = Math.max(0, Math.min(100, Math.round((15 - hb.rate) / 15 * 100)));
  var s6 = Math.max(0, Math.min(100, Math.round((20 - stats.t95pct) / 20 * 100)));
  var score = Math.round(s1*0.20 + s2*0.10 + s3*0.15 + s4*0.20 + s5*0.20 + s6*0.15);
  var grade = score >= 80 ? 'Good' : score >= 60 ? 'Fair' : 'Poor';
  var gradeClass = score >= 80 ? 'good' : score >= 60 ? 'warn' : 'bad';
  return { score: score, grade: grade, gradeClass: gradeClass,
    components: { spo2Stab:s1, hrFloor:s2, motion:s3, pb:s4, hypoxicBurden:s5, t95:s6 } };
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

// 1. DESATURATION PROFILE — 8 SpO2-derived metrics
function computeDesaturationProfile(rows, tIdx, odi4, blArr) {
  var spo2 = rows.map(function(r){ return r.spo2; });
  var n = spo2.length, WIN = 300;

  // Delta-index (SpO2 instability): mean |diff of consecutive 12s means|
  var means12 = [];
  for (var i = 0; i + 12 <= n; i += 12) {
    var s = 0; for (var j = i; j < i+12; j++) s += spo2[j];
    means12.push(s/12);
  }
  var deltaIndex = 0;
  for (var i = 1; i < means12.length; i++) deltaIndex += Math.abs(means12[i] - means12[i-1]);
  deltaIndex = means12.length > 1 ? +(deltaIndex/(means12.length-1)).toFixed(3) : 0;

  // SpO2 CoV (%)
  if(!n) return null;
  var meanSpo2 = spo2.reduce(function(a,b){return a+b;},0)/n;
  var spo2CoV = meanSpo2 > 0 ? +(stdDev(spo2)/meanSpo2*100).toFixed(2) : 0;

  // T-Index AUC weighted: each threshold weighted by its clinical severity
  var weights = {95:1, 94:2, 93:3, 92:4, 91:5, 90:6, 89:8, 88:10, 85:15, 80:25};
  var tAucWeighted = 0;
  Object.keys(weights).forEach(function(t){
    if (tIdx[+t]) tAucWeighted += weights[+t] * tIdx[+t].secs;
  });
  tAucWeighted = isFinite(tAucWeighted) ? +tAucWeighted.toFixed(0) : 0;

  // AUC-90 (hypoxic burden below 90%)
  var auc90 = 0;
  for (var i = 0; i < n; i++) { if (spo2[i] < 90) auc90 += (90 - spo2[i]); }
  var durationHr = n / 3600;
  var auc90Total = +(auc90/60).toFixed(1);
  var auc90Rate  = durationHr > 0 ? +(auc90Total/durationHr).toFixed(2) : 0;

  // Nadir Duration Profile + ODI-4 Recovery Time. DEX-EVENT-UNIFY-FOLLOWUPS §1: route
  // through the ONE canonical primitive (trailing-p90 CEILING baseline + simple re-rise
  // close, exitPct === ODI_DROP) so this family scores the SAME event set as the headline
  // ODI-4 (detectODI) — nadir.count now agrees with ODI-4 by construction instead of
  // drifting on a private trailing-MEAN loop. The recovery look-forward (secs back to the
  // onset baseline − 1) + the oximeter self-gate are preserved on top of the shared set.
  var nadirEvents = detectDesatEvents(spo2, { dropPct: DexKernel.K.ODI_DROP, exitPct: DexKernel.K.ODI_DROP, blArr: blArr }).map(function(e){
    var recov = 0;
    for (var k = e.endIdx; k < Math.min(e.endIdx + 120, n); k++) {
      if (spo2[k] >= e.baseline - 1) { recov = k - e.endIdx; break; }
    }
    return { depth: e.depth, duration: e.durationSec, recovery: recov,
             startIdx: e.startIdx, nadirIdx: e.nadirIdx, endIdx: e.endIdx, nadir: e.nadir,
             recoverySlope: recov > 0 ? +((e.baseline - e.nadir) / recov).toFixed(3) : 0 };
  });
  // ── OXIMETER SELF-GATE (Part A): flag optical/mechanical-artifact desats so
  //    they are excluded from ODI and never emitted as ganglior_events. `events`
  //    below carries only the SURVIVING (non-artifact) desats, so every
  //    downstream consumer (O2HR efficiency, nadir trend, IEI, recovery-CV, the
  //    Integrator's event synthesis) inherits the exclusion automatically;
  //    `eventsAll` retains the flagged set for the UI (shown struck-through). ──
  var pulseSeries = rows.map(function(r){ return r.hr; });
  nadirEvents.forEach(function(ev){ ev.onset = ev.startIdx; selfGateDesat(ev, pulseSeries, spo2); });
  var artifactCount = nadirEvents.filter(function(e){ return e.artifact; }).length;
  var realEvents = nadirEvents.filter(function(e){ return !e.artifact; });
  var meanRecovery = realEvents.length ? +(realEvents.reduce(function(s,e){return s+e.recovery;},0)/realEvents.length).toFixed(0) : 0;
  var meanDepth    = realEvents.length ? +(realEvents.reduce(function(s,e){return s+e.depth;},0)/realEvents.length).toFixed(1) : 0;
  var meanDuration = realEvents.length ? +(realEvents.reduce(function(s,e){return s+e.duration;},0)/realEvents.length).toFixed(0) : 0;

  // SpO2 Dip Rate ≥3%/hr — DEX-EVENT-UNIFY-FOLLOWUPS §1: from the ONE canonical
  // primitive (ODI-3 threshold, simple re-rise close, no min-length gate so every
  // distinct ≥3% dip counts), not the removed private trailing-MEAN loop.
  var dip3Count = detectDesatEvents(spo2, { dropPct: 3, exitPct: 3, minSec: 0, blArr: blArr }).length;
  var dip3Rate = durationHr > 0 ? +(dip3Count/durationHr).toFixed(1) : 0;

  return {
    deltaIndex: deltaIndex, spo2CoV: spo2CoV, tAucWeighted: tAucWeighted,
    auc90Total: auc90Total, auc90Rate: auc90Rate,
    nadir: { count: realEvents.length, meanDepth: meanDepth, meanDuration: meanDuration, meanRecovery: meanRecovery },
    events: realEvents,       // SURVIVING desats only — feeds O2HR efficiency, nadir trend, IEI, recovery-CV, Integrator emit
    eventsAll: nadirEvents,   // full set incl. self-gated artifacts (UI shows artifacts struck-through with .reason)
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
  var masked = new Uint8Array(n), ex = 0, i;
  // (a) self-gated ARTIFACT desaturations — mask each flagged event's [startIdx, endIdx]
  var ev = (desat && desat.eventsAll) ? desat.eventsAll : [];
  for (var e = 0; e < ev.length; e++) {
    if (!ev[e].artifact) continue;
    var a = (ev[e].startIdx != null) ? ev[e].startIdx : ev[e].nadirIdx;
    if (a == null) continue;
    var b = (ev[e].endIdx != null) ? ev[e].endIdx : ev[e].nadirIdx;
    a = Math.max(0, a | 0); b = Math.min(n - 1, (b != null ? b : a) | 0);
    for (i = a; i <= b; i++) { if (!masked[i]) { masked[i] = 1; ex++; } }
  }
  // (b) opening perfusion-settling ramp
  if (rows[0].spo2 <= CFG.NADIR_RAMP_START_MAX) {
    var lim = Math.min(n, CFG.NADIR_RAMP_MAX_SEC), k = 0;
    while (k < lim && rows[k].spo2 < CFG.NADIR_RAMP_RECOVER) k++;
    if (k > 0 && k < lim) {                       // reached a normal plateau within the window
      var openMin = rows[0].spo2;                 // require the region to START at (near) its own min
      for (var j = 1; j < k; j++) if (rows[j].spo2 < openMin) openMin = rows[j].spo2;   // = a climb, not a dip after a normal start
      if (rows[0].spo2 <= openMin + 1) { for (i = 0; i < k; i++) { if (!masked[i]) { masked[i] = 1; ex++; } } }
    }
  }
  var mn = Infinity;
  for (i = 0; i < n; i++) { if (masked[i]) continue; if (rows[i].spo2 < mn) mn = rows[i].spo2; }
  if (!isFinite(mn)) return { min: rawMin, excluded: 0 };   // never mask the whole night
  return { min: mn, excluded: ex };
}

// 2. HR PROFILE — 5 HR-derived metrics
function computeHRProfile(rows) {
  var clean = rows.filter(function(r){ return r.motion === 0 && !r.hrArtifact; });
  var n = clean.length;
  if (n < 120) return null;
  var hrs = clean.map(function(r){ return r.hr; });

  // HR Circadian Phase Score: mean(last 60min) - mean(first 60min)
  var first60 = hrs.slice(0, Math.min(3600, n));
  var last60  = hrs.slice(Math.max(0, n-3600));
  var circadianScore = +(avg(last60) - avg(first60)).toFixed(2);

  // HR Deceleration Capacity: max 60-min rolling mean, then find deepest subsequent drop
  var WIN60 = 3600;
  var rollingMeans = [];
  for (var i = 0; i + WIN60 <= n; i += 60) {
    rollingMeans.push(avg(hrs.slice(i, i+WIN60)));
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
  var step = Math.max(1, Math.ceil(hrs.length/300));
  var sub = hrs.filter(function(_,i){ return i%step===0; }); // cap at ~300 samples for ApEn O(n²)
  var subN = sub.length;
  var apEn = 0;
  if (subN >= 20) {
    var r = 0.2 * stdDev(sub);
    function phi(m) {
      // ApEn phi(m): (1/N) × Σ log(Ci/N) — correct mean-of-logs formula
      // (v22.15 fix: previous version used log(sum/N) = log-of-mean, biasing values low)
      var N = subN - m;
      if(N <= 0) return 0;
      var logSum = 0;
      for(var i = 0; i < N; i++) {
        var ci = 0;
        for(var j = 0; j < N; j++) {
          var maxDiff = 0;
          for(var k = 0; k < m; k++) maxDiff = Math.max(maxDiff, Math.abs(sub[i+k]-sub[j+k]));
          if(maxDiff <= r) ci++;
        }
        if(ci > 0) logSum += Math.log(ci / N);
      }
      return logSum / N;
    }
    apEn = +(phi(2) - phi(3)).toFixed(4);
  }

  // Bradycardia Events: HR < 40 for ≥10 consecutive clean samples
  var bradyCount = 0, bradyRun = 0;
  clean.forEach(function(r) {
    if (r.hr < 40) { bradyRun++; if (bradyRun === 10) bradyCount++; }
    else bradyRun = 0;
  });

  // Tachycardia Events: HR > 100 without motion for ≥10 consecutive samples
  var tachyCount = 0, tachyRun = 0;
  clean.forEach(function(r) {
    if (r.hr > 100) { tachyRun++; if (tachyRun === 10) tachyCount++; }
    else tachyRun = 0;
  });

  return { circadianScore: circadianScore, decCapacity: decCapacity, apEn: apEn, bradyCount: bradyCount, tachyCount: tachyCount };
}

// 3. MOTION / SLEEP QUALITY — 3 motion-derived metrics
function computeMotionSleep(rows) {
  var n = rows.length;

  // Sleep Efficiency: % of recording with motion = 0
  var quietCount = rows.filter(function(r){ return r.motion === 0; }).length;
  var sleepEff = +(quietCount/n*100).toFixed(1);

  // WASO Proxy: 5-min windows after first 30 min where motion >5%
  var wasoWindows = 0, WIN5 = 300;
  for (var i = 1800; i + WIN5 <= n; i += WIN5) {
    var sl = rows.slice(i, i+WIN5);
    var mc = sl.filter(function(r){ return r.motion > 0; }).length;
    if (mc/WIN5 > 0.05) wasoWindows++;
  }
  var totalPostOnset = Math.floor((n - 1800) / WIN5);
  var wasoPct = totalPostOnset > 0 ? +(wasoWindows/totalPostOnset*100).toFixed(0) : 0;

  // Positional Shifts: motion bursts that last >60 consecutive seconds
  var posShifts = 0, shiftRun = 0;
  rows.forEach(function(r) {
    if (r.motion > 0) { shiftRun++; if (shiftRun === 61) posShifts++; }
    else shiftRun = 0;
  });

  return { sleepEff: sleepEff, wasoWindows: wasoWindows, wasoPct: wasoPct, posShifts: posShifts };
}

// 4. CROSS-SIGNAL — 4 combined SpO2+HR metrics
function computeCrossSignal(rows, osc, spikes, odi4, durationHr) {
  var n = rows.length;

  // Autonomic Arousal Index: (HR spikes + ODI-4 events) / durationHr
  var autoArousalIdx = durationHr > 0 ? +((spikes.length + odi4.count) / durationHr).toFixed(1) : 0;

  // Cardiorespiratory Coupling: Pearson r of SpO2 and HR 5-min rolling means
  var WIN5 = 300, spo2Means = [], hrMeans = [];
  for (var i = 0; i + WIN5 <= n; i += WIN5) {
    var sl = rows.slice(i, i+WIN5);
    spo2Means.push(sl.reduce(function(s,r){return s+r.spo2;},0)/WIN5);
    hrMeans.push(sl.reduce(function(s,r){return s+r.hr;},0)/WIN5);
  }
  var crcIdx = 0;
  if (spo2Means.length > 3) {
    var ms = avg(spo2Means), mh = avg(hrMeans);
    var num=0, ds=0, dh=0;
    for (var i=0;i<spo2Means.length;i++){
      num += (spo2Means[i]-ms)*(hrMeans[i]-mh);
      ds  += (spo2Means[i]-ms)*(spo2Means[i]-ms);
      dh  += (hrMeans[i]-mh)*(hrMeans[i]-mh);
    }
    crcIdx = (ds>0&&dh>0) ? +(num/Math.sqrt(ds*dh)).toFixed(3) : 0;
  }

  // SpO2-HR Divergence: PB windows with mean SpO2 drop but no spike within ±120s
  var divergeCount = 0;
  if (osc && osc.episodeCount > 0) {
    // Proxy: PB episodes without a matching HR spike nearby (2 spikes per episode assumed)
    // Note: this is an approximation; true divergence requires timestamp alignment
    var coveredEpisodes = Math.min(spikes.length * 2, osc.episodeCount);
    divergeCount = Math.max(0, osc.episodeCount - coveredEpisodes);
  }
  var divergePct = osc && osc.episodeCount > 0 ? +(divergeCount/osc.episodeCount*100).toFixed(0) : 0;

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
  var spo2 = rows.map(function(r){ return r.spo2; });
  var n = spo2.length, WIN = 300;
  if(n < 60) return null;

  // Nadir events from the ONE shared ODI-4 detector (ceiling baseline). §3 close-mode: ODI-4 entry +
  // anti-chatter HYSTERESIS close (no exitPct) — WtDSI is a SATELLITE stat, not the simple-close
  // headline count. §1: shared p90-ceiling blArr threaded. DEX-EVENT-UNIFY-FOLLOWUPS-II.
  var nadirEvents = detectDesatEvents(spo2, { dropPct: DexKernel.K.ODI_DROP, blArr: blArr }).map(function(e){
    return { depth: e.depth, duration: e.durationSec };
  });

  // WtDSI: Σ(depth² × duration) / totalTime
  var wtdsi = 0;
  nadirEvents.forEach(function(e){ wtdsi += (e.depth * e.depth) * e.duration; });
  wtdsi = n > 0 ? +(wtdsi / n).toFixed(3) : 0;

  // SpO2 IQR (p75 - p25)
  var sorted = spo2.slice().sort(function(a,b){return a-b;});
  var p25 = sorted[Math.floor(n*0.25)];
  var p75 = sorted[Math.floor(n*0.75)];
  var iqr = +(p75 - p25).toFixed(1);

  // Conditional mean SpO2 below 94%
  var belowSamples = spo2.filter(function(v){ return v < 94; });
  var condMean = belowSamples.length > 0
    ? +(belowSamples.reduce(function(a,b){return a+b;},0) / belowSamples.length).toFixed(2)
    : null;
  var condPct = n>0 ? +(belowSamples.length / n * 100).toFixed(1) : 0;

  // Nadir depth histogram
  var bins = { above91:0, b90_91:0, b88_89:0, b85_87:0, below85:0 };
  nadirEvents.forEach(function(e){
    if(e.depth < 4)       bins.above91++;
    else if(e.depth < 6)  bins.b90_91++;
    else if(e.depth < 9)  bins.b88_89++;
    else if(e.depth < 12) bins.b85_87++;
    else                   bins.below85++;
  });

  return { wtdsi: wtdsi, spo2IQR: iqr, condMeanBelow94: condMean, condPctBelow94: condPct, nadirBins: bins };
}

// 6. Extended HR metrics (RMSSD proxy, IQR, PB contrast)
function computeHRAdvanced(rows, osc) {
  var clean = rows.filter(function(r){ return r.motion === 0 && !r.hrArtifact; });
  if(clean.length < 60) return null;
  var hrs = clean.map(function(r){ return r.hr; });
  var n = hrs.length;

  // RMSSD proxy (1Hz): sqrt(mean of squared successive differences)
  var ssds = 0, pairs = 0;
  for(var i = 1; i < n; i++){
    var diff = hrs[i] - hrs[i-1];
    ssds += diff * diff;
    pairs++;
  }
  var rmssd = pairs > 0 ? +(Math.sqrt(ssds/pairs)).toFixed(2) : 0;

  // HR IQR
  var sortedHR = hrs.slice().sort(function(a,b){return a-b;});
  var hrP25 = sortedHR[Math.floor(n*0.25)];
  var hrP75 = sortedHR[Math.floor(n*0.75)];
  var hrIQR = hrP75 - hrP25;

  // Mean HR during PB windows vs non-PB windows
  // Use 5-min (300s) windows — flag oscillation windows vs non
  var WIN5 = CFG.OSC_WINDOW_SEC, totalRows = rows.length;
  var pbWinMeans = [], nonPbWinMeans = [];
  for(var i = 0; i + WIN5 <= totalRows; i += WIN5){
    var sl = rows.slice(i, i+WIN5);
    var spo2Vals = sl.map(function(r){return r.spo2;});
    var hrVals   = sl.filter(function(r){return r.motion===0;}).map(function(r){return r.hr;});
    if(!hrVals.length) continue;
    // Count crossings of CFG.SPO2_OSC_THRESHOLD in this window (single source: CFG)
    var crossings = 0, above = spo2Vals[0] >= CFG.SPO2_OSC_THRESHOLD;
    for(var j = 1; j < spo2Vals.length; j++){
      var nowAbove = spo2Vals[j] >= CFG.SPO2_OSC_THRESHOLD;
      if(nowAbove !== above){ crossings++; above = nowAbove; }
    }
    var meanHRwin = avg(hrVals);
    if(crossings >= CFG.OSC_FLAG_CROSSINGS) pbWinMeans.push(meanHRwin);
    else               nonPbWinMeans.push(meanHRwin);
  }
  var meanHRpb    = pbWinMeans.length    ? +(avg(pbWinMeans)).toFixed(1)    : null;
  var meanHRnonPb = nonPbWinMeans.length ? +(avg(nonPbWinMeans)).toFixed(1) : null;
  var hrPbContrast = (meanHRpb && meanHRnonPb) ? +(meanHRpb - meanHRnonPb).toFixed(1) : null;

  return { rmssd: rmssd, hrIQR: hrIQR, meanHRpb: meanHRpb, meanHRnonPb: meanHRnonPb, hrPbContrast: hrPbContrast };
}

// 7. Composite/coupling metrics
function computeComposite(rows, spikes, desat, cross, motSleep, durationHr) {
  var spo2 = rows.map(function(r){ return r.spo2; });
  var n = rows.length;
  var WIN = 300;

  // Oxygen Desat Arousal Coupling Score: % of ODI-4 nadirs followed by HR rise ≥8bpm within 60s
  var nadirEvents = desat ? desat.nadir.count : 0;
  var coupledCount = 0;
  if(nadirEvents > 0 && spikes.length > 0) {
    // proxy: if spike count ≥ 30% of nadir events → coupling present
    coupledCount = Math.min(spikes.length, nadirEvents);
  }
  var couplingScore = nadirEvents > 0 ? +(coupledCount / nadirEvents * 100).toFixed(0) : 0;

  // Sleep Fragmentation Index: (WASO + HR spikes + osc episodes) / hr
  var wasoWin = motSleep ? motSleep.wasoWindows : 0;
  // Use only ODI-4 events (not autoArousalIdx which already includes spikes → avoids double-count)
  var sfi = durationHr > 0 ? +((wasoWin + spikes.length) / durationHr).toFixed(1) : 0;

  // Nocturnal Stress Index (0-100): normalized composite
  // Components: dip3Rate (flag >5), hbRate (flag >5), t95pct (flag >15), AAI (flag >5)
  var dip3  = desat ? Math.min(desat.dip3Rate / 5, 1) : 0;
  var hbR   = desat ? Math.min(desat.auc90Rate / 2, 1) : 0;  // AUC-90 flag >2
  var t95   = 0;
  // Get t95pct from spo2 array
  var below95 = spo2.filter(function(v){return v<95;}).length;
  var t95pct = n>0 ? below95/n*100 : 0;
  t95 = Math.min(t95pct / 15, 1);
  var aai   = cross ? Math.min(cross.autoArousalIdx / 5, 1) : 0;
  var nsi   = +((dip3 + hbR + t95 + aai) / 4 * 100).toFixed(0);

  return { couplingScore: couplingScore, sfi: sfi, nsi: nsi };
}

// 8. Linear regression helper (for multi-night trend slope)
function linReg(xsOrVals, ys) {
  var xs;
  if(ys === undefined) {
    xs = xsOrVals.map(function(_,i){ return i; });
    ys = xsOrVals;
  } else {
    xs = xsOrVals;
  }
  var n = xs.length;
  if(n < 2) return {slope:0, r2:0, intercept:0};
  var sx=0,sy=0,sxx=0,sxy=0;
  for(var i=0;i<n;i++){sx+=xs[i];sy+=ys[i];sxx+=xs[i]*xs[i];sxy+=xs[i]*ys[i];}
  var denom = n*sxx - sx*sx;
  if(denom===0) return {slope:0, r2:0, intercept:ys[0]||0};
  var slope = denom ? (n*sxy - sx*sy)/denom : 0;
  var intercept = n>0 ? (sy - slope*sx)/n : 0;
  var ssTot=0, ssRes=0, yMean = n>0 ? sy/n : 0;
  for(var i=0;i<n;i++){
    ssTot += (ys[i]-yMean)*(ys[i]-yMean);
    ssRes += (ys[i]-(intercept+slope*xs[i]))*(ys[i]-(intercept+slope*xs[i]));
  }
  return {slope: isFinite(slope)?+slope.toFixed(4):0, intercept: isFinite(intercept)?+intercept.toFixed(4):0,
          r2: ssTot>0 ? +(1-ssRes/ssTot).toFixed(3) : 0};
}

// ═══════════════════════════════════════════════════════════════════
// v20.6 NEW METRICS A–O (18 functions, ~30 new scalar output fields)
// ═══════════════════════════════════════════════════════════════════

// ── A. SpO2 Baseline Drift ────────────────────────────────────────
function computeSpO2Drift(rows) {
  var n = rows.length;
  if(n < 600) return null;
  var WIN = 300;
  var windows = [];
  for(var i=0; i+WIN<=n; i+=WIN){
    var seg = rows.slice(i, i+WIN);
    var m = seg.reduce(function(a,r){return a+r.spo2;},0)/WIN;
    windows.push(m);
  }
  if(windows.length < 3) return null;
  var lr = linReg(windows);
  var driftPerHr = +(lr.slope * (3600/WIN)).toFixed(3);
  return { driftSlope: lr.slope, driftPerHr: driftPerHr, driftR2: lr.r2,
           driftLabel: driftPerHr < -0.3 ? 'Declining (hypovent)' : driftPerHr > 0.3 ? 'Rising' : 'Stable' };
}

// ── B. ODI-2 ─────────────────────────────────────────────────────
function computeODI2(rows) {
  var n = rows.length;
  if(n < 120) return null;
  var WIN = 300, count = 0;
  // O(n) sliding window: maintain running sum of spo2[max(0,i-WIN)..i-1]
  var winSum = 0, winLen = 0;
  for(var i = 0; i < n; i++){
    if(i > 0){ winSum += rows[i-1].spo2; winLen++; }
    if(i > WIN){ winSum -= rows[i-WIN-1].spo2; winLen--; }
    if(winLen <= 0) continue;
    var baseline = winSum / winLen;
    if(rows[i].spo2 <= baseline - 2 && rows[i-1].spo2 > baseline - 2) count++;
  }
  var durationHr = n / 3600;
  return { odi2Count: count, odi2Rate: durationHr > 0 ? +(count/durationHr).toFixed(2) : 0 };
}

// ── C. SpO2 Reactive Overshoot ────────────────────────────────────
function computeSpO2Overshoot(rows, desat) {
  if(!desat || !desat.nadir || !desat.nadir.count || desat.nadir.count < 2) return null;
  var n = rows.length;
  var overshoots = [];
  var BW = 180;                 // baseline window: rows[max(0,i-BW)..i-1]
  var winSum = 0, winLen = 0;   // O(n) running mean, replaces per-i slice+reduce
  for(var i=0; i<n; i++){
    if(i > 0){  winSum += rows[i-1].spo2;     winLen++; }
    if(i > BW){ winSum -= rows[i-1-BW].spo2;  winLen--; }
    if(i < 60 || i >= n-120) continue;
    if(winLen < 30) continue;
    var local = winSum / winLen;
    var prev = rows[i-1].spo2, curr = rows[i].spo2;
    if(prev < local - 1 && curr >= local - 1){
      var postSeg = rows.slice(i+60, Math.min(n, i+120));
      if(postSeg.length < 30) continue;
      var postMean = postSeg.reduce(function(a,r){return a+r.spo2;},0)/postSeg.length;
      var os = +(postMean - local).toFixed(2);
      if(os > 0) overshoots.push(os);
    }
  }
  if(!overshoots.length) return null;
  var mean = +(overshoots.reduce(function(a,b){return a+b;},0)/overshoots.length).toFixed(2);
  return { overshootMean: mean, overshootCount: overshoots.length,
           overshootLabel: mean > 1.5 ? 'Elevated (CS pattern)' : mean > 0.5 ? 'Mild' : 'Normal' };
}

// ── D. SpO2 Autocorrelation Lag-1 ────────────────────────────────
function computeSpO2Autocorr(rows) {
  var n = rows.length;
  if(n < 300) return null;
  var USE = Math.min(n, 3600);
  var s = rows.slice(-USE).map(function(r){ return r.spo2; });
  var m = s.reduce(function(a,b){return a+b;},0)/USE;
  var num=0, den=0;
  for(var i=0;i<USE-1;i++){
    num += (s[i]-m)*(s[i+1]-m);
    den += (s[i]-m)*(s[i]-m);
  }
  if(den === 0) return null;
  var ac1 = +(num/den).toFixed(3);
  return { ac1: ac1,
           ac1Label: ac1 > 0.95 ? 'Sustained (hypoventilation)' : ac1 > 0.85 ? 'Persistent' : ac1 < 0.5 ? 'Oscillating (PB pattern)' : 'Transient' };
}

// ── E. HR Power Spectral Density (LF/HF) ─────────────────────────
function computeHRFreqBands(rows) {
  var n = rows.length;
  if(n < 600) return null;
  var USE = Math.min(n, 1800);
  var hr = rows.slice(-USE).map(function(r){ return r.hr; });
  var m = hr.reduce(function(a,b){return a+b;},0)/USE;
  hr = hr.map(function(v){ return v-m; });
  function bandPow(lo, hi, nBins) {
    var power = 0;
    for(var b=0; b<nBins; b++){
      var f = lo + b*(hi-lo)/Math.max(1,nBins-1);
      var re=0, im=0;
      for(var i=0;i<USE;i++){
        var ang = 2*Math.PI*f*i;
        re += hr[i]*Math.cos(ang);
        im += hr[i]*Math.sin(ang);
      }
      power += (re*re+im*im)/USE;
    }
    return +(power/nBins).toFixed(1);
  }
  var lfPow = bandPow(0.04, 0.15, 5);
  var hfPow = bandPow(0.15, 0.40, 6);
  var lfhf  = hfPow > 0 ? +(lfPow/hfPow).toFixed(2) : null;
  return { hrLfPow: lfPow, hrHfPow: hfPow, hrLfHf: lfhf,
           hrLfHfLabel: lfhf===null ? 'N/A' : lfhf > 4 ? 'SNS dominant' : lfhf > 2 ? 'SNS-leaning' : 'Balanced' };
}

// ── F. Respiratory Rate Proxy ─────────────────────────────────────
function computeRespRateProxy(rows) {
  var n = rows.length;
  if(n < 600) return null;
  var USE = Math.min(n, 1800);
  var hr = rows.slice(-USE).map(function(r){ return r.hr; });
  var m = hr.reduce(function(a,b){return a+b;},0)/USE;
  hr = hr.map(function(v){ return v-m; });
  var bestPow = -1, bestFreq = 0.2;
  for(var k=0; k<20; k++){
    var f = 0.13 + k*(0.33-0.13)/19;
    var re=0, im=0;
    for(var i=0;i<USE;i++){
      var ang = 2*Math.PI*f*i;
      re += hr[i]*Math.cos(ang);
      im += hr[i]*Math.sin(ang);
    }
    var p = (re*re+im*im)/USE;
    if(p > bestPow){ bestPow = p; bestFreq = f; }
  }
  var bpm = +(bestFreq*60).toFixed(1);
  return { respRateBpm: bpm, rsaPeakFreq: isFinite(bestFreq)?+bestFreq.toFixed(4):0, rsaPeakPow: +bestPow.toFixed(1),
           respRateLabel: bpm < 10 ? 'Slow (<10)' : bpm > 20 ? 'Fast (>20)' : 'Normal (10-20)' };
}

// ── G. HR Acceleration Asymmetry ─────────────────────────────────
function computeHRAsymmetry(rows) {
  var n = rows.length;
  if(n < 120) return null;
  var ups=[], downs=[];
  for(var i=1;i<n;i++){
    var d = rows[i].hr - rows[i-1].hr;
    if(d > 0) ups.push(d);
    else if(d < 0) downs.push(-d);
  }
  if(!ups.length || !downs.length) return null;
  var meanUp   = ups.reduce(function(a,b){return a+b;},0)/ups.length;
  var meanDown = downs.reduce(function(a,b){return a+b;},0)/downs.length;
  if(meanDown === 0) return null;
  var asym = +(meanUp/meanDown).toFixed(3);
  return { hrAccelAsym: asym, meanUpBpm: isFinite(meanUp)?+meanUp.toFixed(2):0, meanDownBpm: isFinite(meanDown)?+meanDown.toFixed(2):0,
           hrAsymLabel: asym > 1.15 ? 'Arousal-biased' : asym < 0.85 ? 'Vagally dominant' : 'Symmetric' };
}

// ── H. Nocturnal HR Quartile Trend ────────────────────────────────
function computeHRQuartileTrend(rows) {
  var n = rows.length;
  if(n < 1200) return null;
  var q = Math.floor(n/4);
  var qs = [0,1,2,3].map(function(i){
    var seg = rows.slice(i*q, (i===3 ? n : (i+1)*q));
    if(!seg.length) return null;
    return +(seg.reduce(function(a,r){return a+r.hr;},0)/seg.length).toFixed(1);
  });
  if(qs.indexOf(null) >= 0) return null;
  var arc = (qs && qs.length >= 4) ? +(qs[2] - qs[0]).toFixed(1) : 0;
  return { hrQ1: (qs&&qs.length>=4)?qs[0]:null, hrQ2: (qs&&qs.length>=4)?qs[1]:null, hrQ3: (qs&&qs.length>=4)?qs[2]:null, hrQ4: (qs&&qs.length>=4)?qs[3]:null, hrArc: arc,
           remReemergence: qs[3] > qs[2] + 1,
           hrArcLabel: arc < -3 ? 'Good (declining arc)' : arc > 3 ? 'Rising (arousal)' : 'Flat' };
}

// ── I. SpO2-HR Cross-Correlation Peak Lag ────────────────────────
function computeSpO2HRLag(rows) {
  var n = rows.length;
  if(n < 600) return null;
  var USE = Math.min(n, 1800);
  var seg  = rows.slice(-USE);
  var spo2 = seg.map(function(r){ return r.spo2; });
  var hr   = seg.map(function(r){ return r.hr;   });
  var ms2  = spo2.reduce(function(a,b){return a+b;},0)/USE;
  var mhr  = hr.reduce(function(a,b){return a+b;},0)/USE;
  spo2 = spo2.map(function(v){return v-ms2;});
  hr   = hr.map(function(v){return v-mhr;});
  var bestLag = 0, bestCor = -Infinity;
  for(var lag=0; lag<=120; lag++){
    var num=0, d1=0, d2=0;
    for(var i=0; i<USE-lag; i++){
      num += spo2[i]*hr[i+lag];
      d1  += spo2[i]*spo2[i];
      d2  += hr[i+lag]*hr[i+lag];
    }
    var cor = (d1>0 && d2>0) ? num/Math.sqrt(d1*d2) : 0;
    if(cor > bestCor){ bestCor = cor; bestLag = lag; }
  }
  return { crossCorrLag: bestLag, crossCorrPeak: isFinite(bestCor)?+bestCor.toFixed(3):0,
           crossCorrLabel: bestLag < 10 ? 'Near-zero lag (central pattern)' : bestLag < 30 ? 'Moderate lag' : 'Delayed lag' };
}

// ── J. Spike Decay Time ───────────────────────────────────────────
function computeSpikeDecay(rows, spikes) {
  if(!spikes || !spikes.length) return null;
  var decays = [];
  spikes.forEach(function(sp){
    if(!sp || sp.baseline == null || sp.peak == null) return;
    var threshold = sp.baseline + 2;
    var peakIdx = -1;
    // Search near spike timestamp (±5 min) to avoid matching earlier spikes
    var startHr0 = rows.length > 0 ? rows[0].t.getUTCHours()*60+rows[0].t.getUTCMinutes()+rows[0].t.getUTCSeconds()/60 : 0;
    var apxIdx = Math.round(((sp.mfm||0) - startHr0) * 60);
    var s0 = Math.max(0, apxIdx-300), s1 = Math.min(rows.length, apxIdx+300);
    for(var i=s0;i<s1;i++){
      if(rows[i].hr >= sp.peak - 2 && rows[i].hr >= threshold){ peakIdx = i; break; }
    }
    if(peakIdx < 0) return;
    for(var j=peakIdx+1; j<Math.min(rows.length, peakIdx+300); j++){
      if(rows[j].hr <= threshold){ decays.push(j - peakIdx); break; }
    }
  });
  if(!decays.length) return null;
  var mean = +(decays.reduce(function(a,b){return a+b;},0)/decays.length).toFixed(1);
  return { spikeDecayMeanS: mean, spikeDecayCount: decays.length,
           spikeDecayLabel: mean > 120 ? 'Prolonged (SNS load)' : mean > 60 ? 'Moderate' : 'Fast (<60s)' };
}

// ── K. Post-Spike HR Undershoot ───────────────────────────────────
function computeSpikeUndershoot(rows, spikes) {
  if(!spikes || !spikes.length) return null;
  var undershoots = [];
  spikes.forEach(function(sp){
    if(!sp || sp.baseline == null || sp.peak == null) return;
    var peakIdx = -1;
    // Search near spike timestamp to avoid matching wrong spike
    var startHr1 = rows.length > 0 ? rows[0].t.getUTCHours()*60+rows[0].t.getUTCMinutes()+rows[0].t.getUTCSeconds()/60 : 0;
    var apxIdx1 = Math.round(((sp.mfm||0) - startHr1) * 60);
    var u0 = Math.max(0, apxIdx1-300), u1 = Math.min(rows.length, apxIdx1+300);
    for(var i=u0;i<u1;i++){
      if(rows[i].hr >= sp.peak - 2){ peakIdx = i; break; }
    }
    if(peakIdx < 0) return;
    var recIdx = peakIdx;
    for(var j=peakIdx+1; j<Math.min(rows.length, peakIdx+200); j++){
      if(rows[j].hr <= sp.baseline + 1){ recIdx = j; break; }
    }
    var postSeg = rows.slice(recIdx+60, Math.min(rows.length, recIdx+120));
    if(postSeg.length < 20) return;
    var postMean = postSeg.reduce(function(a,r){return a+r.hr;},0)/postSeg.length;
    var us = +(sp.baseline - postMean).toFixed(1);
    if(us > 0) undershoots.push(us);
  });
  if(!undershoots.length) return null;
  var mean = +(undershoots.reduce(function(a,b){return a+b;},0)/undershoots.length).toFixed(1);
  return { spikeUndershootMean: mean, spikeUndershootCount: undershoots.length,
           spikeUndershootLabel: mean > 4 ? 'Strong vagal rebound' : mean > 2 ? 'Moderate' : 'Weak (<2 bpm)' };
}

// ── L. Spike Rise Rate ────────────────────────────────────────────
function computeSpikeRiseRate(spikes) {
  if(!spikes || !spikes.length) return null;
  var rates = [];
  spikes.forEach(function(sp){
    if(!sp || sp.baseline == null || sp.peak == null || !sp.duration) return;
    var rise = sp.peak - sp.baseline;
    // sp.duration = seconds above 75 bpm threshold (sustain time, not rise time)
    // Use fixed 12s rise window (detectSpikes uses 12-sample window for peak detection)
    if(rise > 0) rates.push(+(rise / 12).toFixed(2)); // bpm/s over ~12s detection window
  });
  if(!rates.length) return null;
  var mean = +(rates.reduce(function(a,b){return a+b;},0)/rates.length).toFixed(2);
  return { spikeRiseRate: mean,
           spikeRiseLabel: mean > 5 ? 'Abrupt (>5 bpm/s)' : mean > 2 ? 'Moderate' : 'Gradual (<2 bpm/s)' };
}

// ── M. Data Gap Detection ─────────────────────────────────────────
function computeDataGaps(rows) {
  var n = rows.length;
  if(n < 2) return null;
  var gaps = [], maxGap = 0;
  for(var i=1;i<n;i++){
    var dt = rows[i].t != null && rows[i-1].t != null ? (rows[i].t - rows[i-1].t)/1000 : 0;
    if(dt > 2){ gaps.push(dt); if(dt > maxGap) maxGap = dt; }
  }
  var totalGap = gaps.reduce(function(a,b){return a+b;},0);
  return { gapCount: gaps.length, maxGapSec: +maxGap.toFixed(0),
           gapPct: +(totalGap/n*100).toFixed(1),
           gapLabel: maxGap > 120 ? 'Significant gap (>2min)' : maxGap > 10 ? 'Minor gaps' : 'Clean' };
}

// ── N. HR Flatline Runs ───────────────────────────────────────────
function computeHRFlatlines(rows) {
  var n = rows.length;
  if(n < 60) return null;
  var flatCount = 0, maxFlat = 0, run = 1;
  for(var i=1;i<n;i++){
    if(rows[i].hr === rows[i-1].hr){ run++; }
    else {
      if(run >= 30){ flatCount++; if(run > maxFlat) maxFlat = run; }
      run = 1;
    }
  }
  if(run >= 30){ flatCount++; if(run > maxFlat) maxFlat = run; }
  return { flatlineCount: flatCount, maxFlatlineSec: maxFlat,
           flatlineLabel: flatCount > 5 ? 'Frequent (firmware artifact)' : flatCount > 0 ? 'Occasional' : 'None' };
}

// ── O. SpO2 Ceiling Artifact ──────────────────────────────────────
function computeSpO2Ceiling(rows) {
  var n = rows.length;
  if(n < 60) return null;
  var ceilingRuns = 0, maxCeil = 0, totalCeilSec = 0, run = 0;
  for(var i=0;i<n;i++){
    if(rows[i].spo2 >= 99){ run++; }
    else {
      if(run >= 5){ ceilingRuns++; if(run > maxCeil) maxCeil = run; totalCeilSec += run; }
      run = 0;
    }
  }
  if(run >= 5){ ceilingRuns++; if(run > maxCeil) maxCeil = run; totalCeilSec += run; }
  // ceilingPct derived from runs only (not scattered samples) so pct and label agree
  return { ceilingRuns: ceilingRuns, maxCeilingSec: maxCeil,
           ceilingPct: +(totalCeilSec/n*100).toFixed(1),
           ceilingLabel: ceilingRuns > 3 ? 'Sensor lift likely' : ceilingRuns > 0 ? 'Occasional' : 'None' };
}

// ═══════════════════════════════════════════════════════════════════
// v20.7: 18 NEW METRICS — all derivable from SpO2 / HR / Motion 1Hz
// ═══════════════════════════════════════════════════════════════════

// ── 1. ODRI: Oxygen Desaturation Regularity Index ────────────────
// ODI3/ODI1 — ratio → 1.0 = nearly all dips ≥3% = CS/PB signature
function computeODRI(odi1, odi3) {
  if(!odi1 || !odi3) return null;
  var r1 = (odi1.rate != null ? odi1.rate : odi1.odi1Rate) || 0;
  var r3 = (odi3.rate != null ? odi3.rate : odi3.odi3Rate) || 0;
  if(r1 === 0) return null;
  var odri = +(r3 / r1).toFixed(3);
  return { odri: odri,
           odriLabel: odri > 0.85 ? 'High (CS/PB pattern)' : odri > 0.60 ? 'Moderate' : 'Low (mixed/OA)' };
}

// ── 2. SpO2 Percentile Distribution (p5,p10,p25,p75) ────────────
function computeSpO2Percentiles(rows) {
  var n = rows.length;
  if(n < 60) return null;
  var sorted = rows.map(function(r){ return r.spo2; }).slice().sort(function(a,b){return a-b;});
  function pct(p){ return sorted[Math.floor(p/100*(n-1))]; }
  return { spo2P5: pct(5), spo2P10: pct(10), spo2P25: pct(25),
           spo2P75: pct(75), spo2P90: pct(90),
           spo2IQR: pct(75) - pct(25) };
}

// ── 3. SpO2 Histogram Kurtosis & Skewness ─────────────────────────
function computeSpO2Shape(rows) {
  var n = rows.length;
  if(n < 60) return null;
  var s = rows.map(function(r){ return r.spo2; });
  var mean = s.reduce(function(a,b){return a+b;},0)/n;
  var m2=0, m3=0, m4=0;
  for(var i=0;i<n;i++){
    var d = s[i]-mean;
    m2 += d*d; m3 += d*d*d; m4 += d*d*d*d;
  }
  m2/=n; m3/=n; m4/=n;
  var sd = Math.sqrt(m2);
  if(sd === 0) return null;
  var skew = +(m3/(sd*sd*sd)).toFixed(3);
  var kurt = +(m4/(m2*m2)).toFixed(3);    // excess kurtosis = kurt - 3
  var excessKurt = +(kurt - 3).toFixed(3);
  return { spo2Mean: isFinite(mean)?+mean.toFixed(2):0, spo2SD: isFinite(sd)?+sd.toFixed(2):0,
           spo2Skew: skew, spo2Kurt: kurt, spo2ExcessKurt: excessKurt,
           spo2SkewLabel: skew < -0.5 ? 'Left-skewed (hypox burden)' : skew > 0.5 ? 'Right-skewed' : 'Near-symmetric',
           spo2KurtLabel: excessKurt > 2 ? 'Leptokurtic (heavy tails/events)' : excessKurt < 0 ? 'Platykurtic' : 'Normal-ish' };
}

// ── 4. HR Coefficient of Variation ────────────────────────────────
function computeHRCV(rows) {
  var n = rows.length;
  if(n < 60) return null;
  var hr = rows.map(function(r){ return r.hr; });
  var mean = hr.reduce(function(a,b){return a+b;},0)/n;
  if(mean === 0) return null;
  var sd = Math.sqrt(hr.reduce(function(a,b){return a+(b-mean)*(b-mean);},0)/n);
  if (!mean || mean <= 0) return null;
  var cv = isFinite(sd/mean) ? +(sd/mean*100).toFixed(2) : 0;
  return { hrCV: cv, hrCVmean: +mean.toFixed(1), hrCVsd: +sd.toFixed(2),
           hrCVlabel: cv > 12 ? 'High variability' : cv > 6 ? 'Moderate' : 'Low (<6%)' };
}

// ── 5. Hypoxic Dose + Desaturation AUC ────────────────────────────
// HD = Σ(94-SpO2) per second below 94%   [Lévy 2022]
// AUC = Σ(baseline-SpO2) per second during each event
function computeHypoxicDose(rows) {
  var n = rows.length;
  if(n < 60) return null;
  var WIN = 300;
  var hd94=0, hd90=0, hd88=0, auc=0;
  // O(n) sliding window for AUC baseline (rows[max(0,i-WIN)..i-1])
  var winSum = 0, winLen = 0;
  for(var i=0;i<n;i++){
    if(i > 0){ winSum += rows[i-1].spo2; winLen++; }
    if(i > WIN){ winSum -= rows[i-WIN-1].spo2; winLen--; }
    var v = rows[i].spo2;
    if(v < 94) hd94 += (94-v);
    if(v < 90) hd90 += (90-v);
    if(v < 88) hd88 += (88-v);
    if(winLen > 0){
      var base = winSum / winLen;
      if(v < base - 1) auc += (base - v);
    }
  }
  var durationHr = n/3600;
  return { hd94: +hd94.toFixed(0), hd90: +hd90.toFixed(0), hd88: +hd88.toFixed(0),
           hd94PerHr: durationHr>0 ? +(hd94/durationHr).toFixed(1) : 0,
           desatAUC: +auc.toFixed(0),
           hd94Label: (durationHr > 0 ? hd94/durationHr : 0) > 200 ? 'High (>200/hr)' :
                      (durationHr > 0 ? hd94/durationHr : 0) > 60  ? 'Moderate' : 'Low (<60/hr)' };
}

// ── 6. T88 / T85 ──────────────────────────────────────────────────
function computeT88T85(rows) {
  var n = rows.length;
  if(n < 60) return null;
  var t88 = rows.filter(function(r){return r.spo2 < 88;}).length;
  var t85 = rows.filter(function(r){return r.spo2 < 85;}).length;
  var durationHr = n/3600;
  return { t88Sec: t88, t88Min: +(t88/60).toFixed(1),
           t88Pct: +(t88/n*100).toFixed(2),
           t85Sec: t85, t85Min: +(t85/60).toFixed(1),
           t85Pct: +(t85/n*100).toFixed(2),
           t88Label: t88/n*100 > 1 ? 'Severe hypoxemia (>1%)' :
                     t88/n*100 > 0 ? 'Present' : 'None' };
}

// ── 7. Longest Continuous Still Period (LCSP) ─────────────────────
function computeLCSP(rows) {
  var n = rows.length;
  if(n < 60) return null;
  var maxRun = 0, run = 0, startMax = 0, startCur = 0;
  for(var i=0;i<n;i++){
    if(rows[i].motion === 0){
      if(run === 0) startCur = i;
      run++;
      if(run > maxRun){ maxRun = run; startMax = startCur; }
    } else { run = 0; }
  }
  var lcspMin = +(maxRun/60).toFixed(1);
  var lcspStartMin = +(startMax/60).toFixed(0);
  return { lcspSec: maxRun, lcspMin: lcspMin, lcspStartMin: lcspStartMin,
           lcspLabel: lcspMin < 20 ? 'Severely fragmented (<20min)' :
                      lcspMin < 45 ? 'Fragmented (<45min)' :
                      lcspMin < 90 ? 'Moderate' : 'Good (≥90min)' };
}

// ── 8. Poincaré SD1 / SD2 ─────────────────────────────────────────
// SD1=short-term (parasympathetic), SD2=long-term (sympathetic)
function computePoincareSD(rows) {
  var n = rows.length;
  if(n < 120) return null;
  var hr = rows.filter(function(r){return r.motion===0;}).map(function(r){return r.hr;});
  var m = hr.length;
  if(m < 60) return null;
  // SD1 = sqrt(0.5 * RMSSD²), SD2 = sqrt(2*SDNN² - 0.5*RMSSD²)  [standard Poincaré formulas]
  var hMean = hr.reduce(function(a,b){return a+b;},0)/m;
  var hVar = hr.reduce(function(a,b){return a+(b-hMean)*(b-hMean);},0)/m;
  // SD1 = sqrt(0.5 * RMSSD²), SD2 = sqrt(2*SDNN² - 0.5*RMSSD²)
  var rmssd2 = hr.slice(0,m-1).reduce(function(a,v,i){return a+(hr[i+1]-v)*(hr[i+1]-v);},0)/(m-1);
  var sdnn2  = hVar;
  var sd1 = +Math.sqrt(0.5 * rmssd2).toFixed(2);
  var sd2 = +Math.sqrt(Math.max(0, 2*sdnn2 - 0.5*rmssd2)).toFixed(2);
  var ratio = sd2 > 0 ? +(sd1/sd2).toFixed(3) : null;
  return { sd1: sd1, sd2: sd2, sd1sd2Ratio: ratio,
           // 1Hz proxy thresholds in bpm (not ms); sd1≈RMSSD/√2 ≈ 0.3-0.6 bpm typical
           sd1Label: sd1 < 0.4 ? 'Low (1Hz proxy)' : sd1 > 1.0 ? 'High (1Hz proxy)' : 'Normal (1Hz proxy)',
           sd2Label: sd2 < 2 ? 'Low sympathetic modulation (1Hz proxy)' : 'Normal (1Hz proxy)' };
}

// ── 9. SpO2 → HR Response Efficiency ─────────────────────────────
// Per desat event: HR rise / SpO2 drop magnitude. Low = blunted arousal
function computeO2HREfficiency(rows, desat) {
  if(!desat || !desat.events || !desat.events.length) return null;
  var ratios = [];
  desat.events.forEach(function(ev){
    if(!ev || ev.depth == null || ev.depth <= 0) return;
    // Find HR change in 30s after nadir index
    var nadirIdx = ev.nadirIdx != null ? ev.nadirIdx : -1;
    if(nadirIdx < 0 || nadirIdx >= rows.length) return;
    // preHR: mean of 10s window before nadir (more robust than single sample)
    var preStart = Math.max(0, nadirIdx-10), preCnt=0, preSum=0;
    for(var j=preStart;j<nadirIdx;j++){ preSum+=rows[j].hr; preCnt++; }
    var preHR = preCnt>0 ? preSum/preCnt : rows[Math.max(0,nadirIdx-1)].hr;
    // postHR: mean 5-35s after nadir (skip nadir itself to avoid including trough)
    var postEnd = Math.min(rows.length, nadirIdx+35);
    var postHR = 0, cnt = 0;
    for(var j=Math.min(rows.length-1,nadirIdx+5); j<postEnd; j++){ postHR += rows[j].hr; cnt++; }
    if(cnt === 0) return;
    postHR /= cnt;
    var hrRise = Math.max(0, postHR - preHR);
    var ratio = +(hrRise / ev.depth).toFixed(2);
    ratios.push(ratio);
  });
  if(!ratios.length) return null;
  var mean = +(ratios.reduce(function(a,b){return a+b;},0)/ratios.length).toFixed(2);
  var min_ = +Math.min.apply(null,ratios).toFixed(2);
  var max_ = +Math.max.apply(null,ratios).toFixed(2);
  return { o2hrEff: mean, o2hrEffMin: min_, o2hrEffMax: max_, o2hrEffN: ratios.length,
           o2hrEffLabel: mean < 0.3 ? 'Blunted arousal response' :
                         mean < 0.8 ? 'Moderate' : 'Robust response' };
}

// ── 10. Conditional SpO2 Mean (motion vs no-motion) ──────────────
function computeConditionalSpO2(rows) {
  var n = rows.length;
  if(n < 60) return null;
  var still  = rows.filter(function(r){return r.motion === 0;});
  var moving = rows.filter(function(r){return r.motion >  0;});
  if(!still.length) return null;
  var meanStill  = +(still.reduce(function(a,r){return a+r.spo2;},0)/still.length).toFixed(2);
  var meanMoving = moving.length ?
    +(moving.reduce(function(a,r){return a+r.spo2;},0)/moving.length).toFixed(2) : null;
  var delta = meanMoving !== null ? +(meanStill - meanMoving).toFixed(2) : null;
  return { spo2StillMean: meanStill, spo2MovingMean: meanMoving,
           spo2MotionDelta: delta, stillPct: +(still.length/n*100).toFixed(1),
           // delta = stillMean - movingMean: positive → rest has higher SpO2 → motion creates artifact
           motionArtifactLabel: delta !== null && delta > 1 ?
             'Motion artifact likely (SpO2 lower during movement)' :
             delta !== null && delta < -1 ? 'True apnea pattern (SpO2 worse at rest)' : 'No significant difference' };
}

// ── 11. SpO2 Nadir Trend Across Night ────────────────────────────
// Linear regression of sequential event nadir SpO2 values
function computeNadirTrend(desat) {
  if(!desat || !desat.events || desat.events.length < 4) return null;
  var nadirs = desat.events
    .filter(function(ev){ return ev && ev.nadir != null; })
    .map(function(ev){ return ev.nadir; });
  if(nadirs.length < 4) return null;
  var lr = linReg(nadirs);
  var dir = lr.slope < -0.005 ? 'Worsening (REM-load)' :
            lr.slope >  0.005 ? 'Improving across night' : 'Stable';
  return { nadirTrendSlope: lr.slope, nadirTrendR2: lr.r2,
           nadirTrendN: nadirs.length, nadirTrendLabel: dir };
}

// ── 12. Desaturation Inter-Event Interval (IEI) ───────────────────
function computeIEI(desat) {
  if(!desat || !desat.events || desat.events.length < 3) return null;
  var events = desat.events.filter(function(ev){ return ev && ev.startIdx != null; });
  if(events.length < 3) return null;
  var intervals = [];
  for(var i=1;i<events.length;i++){
    var gap = events[i].startIdx - (events[i-1].startIdx + (events[i-1].duration||0));
    if(gap > 0) intervals.push(gap);
  }
  if(!intervals.length) return null;
  var mean = intervals.reduce(function(a,b){return a+b;},0)/intervals.length;
  var sd   = Math.sqrt(intervals.reduce(function(a,b){return a+(b-mean)*(b-mean);},0)/intervals.length);
  var cv   = mean > 0 ? +(sd/mean).toFixed(2) : null;
  return { ieiMeanSec: +mean.toFixed(1), ieiSDsec: +sd.toFixed(1), ieiCV: cv,
           ieiLabel: cv !== null && cv < 0.3 ? 'Regular (PB/CS pattern)' :
                     cv !== null && cv > 0.8 ? 'Highly variable (OA/mixed)' : 'Moderate variability' };
}

// ── 13. Recovery Slope CV (consistency of arousal) ───────────────
function computeRecoverySlopeCV(desat) {
  if(!desat || !desat.events || desat.events.length < 4) return null;
  var slopes = desat.events
    .filter(function(ev){ return ev && ev.recoverySlope != null && ev.recoverySlope > 0; })
    .map(function(ev){ return ev.recoverySlope; });
  if(slopes.length < 4) return null;
  var mean = slopes.length ? slopes.reduce(function(a,b){return a+b;},0)/slopes.length : 0;
  if(mean === 0) return null;
  var sd = slopes.length ? Math.sqrt(slopes.reduce(function(a,b){return a+(b-mean)*(b-mean);},0)/slopes.length) : 0;
  var cv = +(sd/mean).toFixed(3);
  return { recovSlopeMean: +mean.toFixed(3), recovSlopeSD: +sd.toFixed(3), recovSlopeCV: cv,
           recovSlopeCVlabel: cv > 0.6 ? 'High variability (inconsistent arousal)' :
                              cv > 0.3 ? 'Moderate' : 'Consistent arousal' };
}

// ── 14. HR Nadir Clock Time ───────────────────────────────────────
function computeHRNadirTime(rows) {
  var n = rows.length;
  if(n <= 600) return null;   // need n > 2*WIN(=600) for ≥1 centered window — at n==600 the
                             // loop ran zero times and minHR stayed Infinity (leaked to output)
  var WIN = 300;
  var minHR = Infinity, minIdx = WIN;
  // O(n) centered sliding window sum over [i-WIN..i+WIN]
  var wSum = 0, wCnt = 0;
  // Prime: load initial window for i=WIN (covers [0..2*WIN])
  for(var j = 0; j <= 2*WIN && j < n; j++){ wSum += rows[j].hr; wCnt++; }
  for(var i = WIN; i < n - WIN; i++){
    var m = wCnt > 0 ? wSum / wCnt : rows[i].hr;
    if(m < minHR){ minHR = m; minIdx = i; }
    // Advance window: add right edge rows[i+WIN+1], remove left edge rows[i-WIN]
    if(i + WIN + 1 < n){ wSum += rows[i+WIN+1].hr; wCnt++; }
    if(i - WIN >= 0)    { wSum -= rows[i-WIN].hr;   wCnt--; }
  }
  var nadirMinFromStart = +(minIdx/60).toFixed(0);
  var nadirFracOfNight  = +(minIdx/n).toFixed(2);
  return { hrNadirMinFromStart: nadirMinFromStart,
           hrNadirFrac: nadirFracOfNight,
           hrNadirSmoothed: isFinite(minHR) ? +minHR.toFixed(1) : null,
           hrNadirLabel: nadirFracOfNight < 0.25 ? 'Early nadir (good alignment)' :
                         nadirFracOfNight > 0.60 ? 'Late nadir (fragmented/REM)' : 'Mid-night (normal)' };
}

// ── 15. SpO2 Nadir Clock Time ─────────────────────────────────────
function computeSpO2NadirTime(rows, desat) {
  var n = rows.length;
  if(n < 600 || !desat || !desat.events || !desat.events.length) return null;
  // Find worst event by nadir
  var worst = desat.events.reduce(function(a,b){
    if(!a) return b;
    if(!b) return a;
    return (a.nadir||99) < (b.nadir||99) ? a : b;
  }, null);
  if(!worst || worst.nadirIdx == null) return null;
  var frac = +(worst.nadirIdx / n).toFixed(2);
  var minFromStart = +(worst.nadirIdx / 60).toFixed(0);
  return { spo2NadirMinFromStart: minFromStart,
           spo2NadirFrac: frac,
           spo2NadirValue: worst.nadir,
           spo2NadirLabel: frac > 0.65 ? 'Late-night worst (REM-predominant)' :
                           frac < 0.30 ? 'Early worst (supine/onset)' : 'Mid-night' };
}

// ── 16. RMSSD Arc (per-30min windows) ────────────────────────────
function computeRMSSDarc(rows) {
  var n = rows.length;
  if(n < 1800) return null;
  var WIN = 1800; // 30-min windows
  var windows = [];
  for(var i=0; i+WIN<=n; i+=WIN){
    var seg = rows.slice(i, i+WIN).filter(function(r){return r.motion===0;});
    if(seg.length < 60) { windows.push(null); continue; }
    var hr = seg.map(function(r){return r.hr;});
    var m2 = hr.length;
    var rmssd2 = hr.slice(0,m2-1).reduce(function(a,v,j){return a+(hr[j+1]-v)*(hr[j+1]-v);},0)/(m2-1);
    windows.push(+Math.sqrt(rmssd2).toFixed(1));
  }
  // Build {x, y} pairs using actual window positions (not filtered indices) to preserve time axis
  var validXY = windows.map(function(v,i){return v!==null?{x:i,y:v}:null;}).filter(function(p){return p!==null;});
  var valid = validXY.map(function(p){return p.y;});
  if(valid.length < 2) return null;
  var lr = linReg(validXY.map(function(p){return p.x;}), validXY.map(function(p){return p.y;}));
  var firstHalf = valid.slice(0, Math.floor(valid.length/2));
  var lastHalf  = valid.slice(Math.floor(valid.length/2));
  var mFirst = +(firstHalf.reduce(function(a,b){return a+b;},0)/firstHalf.length).toFixed(1);
  var mLast  = +(lastHalf.reduce(function(a,b){return a+b;},0)/lastHalf.length).toFixed(1);
  return { rmssdArcWindows: windows, rmssdArcSlope: lr.slope, rmssdArcR2: lr.r2,
           rmssdFirstHalf: mFirst, rmssdLastHalf: mLast,
           rmssdArcDelta: +(mLast - mFirst).toFixed(1),
           rmssdArcLabel: lr.slope < -0.2 ? 'Declining (REM/arousal load)' :
                          lr.slope >  0.2 ? 'Rising (recovery/deep sleep)' : 'Flat' };
}

// ── 17. HR 50% Recovery Time Post-Spike ──────────────────────────
function computeSpike50PctRecovery(rows, spikes) {
  if(!spikes || !spikes.length) return null;
  var times = [];
  spikes.forEach(function(sp){
    if(!sp || sp.baseline == null || sp.peak == null) return;
    var amplitude = sp.peak - sp.baseline;
    if(amplitude <= 0) return;
    var halfTarget = sp.baseline + amplitude * 0.5;
    var peakIdx = -1;
    // Find peak near the spike timestamp (search within ±5min of spike time)
    var spMfm = sp.mfm || 0;
    var startHr = rows.length > 0 ? rows[0].t.getUTCHours()*60+rows[0].t.getUTCMinutes()+rows[0].t.getUTCSeconds()/60 : 0;
    var approxIdx = Math.round((spMfm - startHr) * 60);
    var searchStart = Math.max(0, approxIdx - 300);
    var searchEnd   = Math.min(rows.length, approxIdx + 300);
    for(var i=searchStart;i<searchEnd;i++){
      if(rows[i].hr >= sp.peak - 2){ peakIdx = i; break; }
    }
    if(peakIdx < 0) return;
    for(var j=peakIdx+1; j<Math.min(rows.length, peakIdx+180); j++){
      if(rows[j].hr <= halfTarget){ times.push(j - peakIdx); break; }
    }
  });
  if(!times.length) return null;
  var mean = +(times.reduce(function(a,b){return a+b;},0)/times.length).toFixed(1);
  return { spike50PctRecovSec: mean, spike50PctRecovN: times.length,
           spike50PctLabel: mean > 60 ? 'Slow (sympathetic persistence)' :
                            mean > 30 ? 'Moderate' : 'Fast (<30s, good vagal)' };
}

// ── 18. REM-Proxy & NREM-Deep Proxy Windows ──────────────────────
function computeSleepStageProxy(rows) {
  var n = rows.length;
  if(n < 1800) return null;
  var WIN = 120; // 2-min windows
  var hrAll = rows.map(function(r){return r.hr;});
  var hrMean = hrAll.reduce(function(a,b){return a+b;},0)/n;
  var remSec = 0, nremDeepSec = 0;
  for(var i=WIN; i<n-WIN; i+=WIN){
    var seg = rows.slice(i, i+WIN);
    var still = seg.every(function(r){return r.motion===0;});
    if(!still) continue;
    var hr = seg.map(function(r){return r.hr;});
    var segMean = hr.reduce(function(a,b){return a+b;},0)/WIN;
    var segSD = Math.sqrt(hr.reduce(function(a,b){return a+(b-segMean)*(b-segMean);},0)/WIN);
    // NREM deep proxy (evaluated first for mutual exclusion): low motion, HR well below mean
    if(segSD < 4 && segMean < hrMean - 6) { nremDeepSec += WIN; }
    // REM proxy: low motion, low SD, HR near mean (explicitly exclude NREM-Deep windows)
    else if(segSD < 3 && segMean > hrMean - 5 && segMean < hrMean + 5) remSec += WIN;
  }
  return { remProxySec: remSec, remProxyMin: +(remSec/60).toFixed(0),
           remProxyPct: +(remSec/n*100).toFixed(1),
           nremDeepSec: nremDeepSec, nremDeepMin: +(nremDeepSec/60).toFixed(0),
           nremDeepPct: +(nremDeepSec/n*100).toFixed(1),
           remProxyLabel: remSec/60 < 45 ? 'Low REM estimate (<45min)' :
                          remSec/60 > 90 ? 'High REM estimate (>90min)' : 'Normal',
           nremDeepLabel: nremDeepSec/60 < 30 ? 'Low deep sleep estimate' :
                          nremDeepSec/60 > 90 ? 'Good deep sleep estimate' : 'Moderate' };
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
  if (n < 1800) return null;  // need ≥1hr recording

  age = age || 49;  // default to space profile age

  // ── Step 1: HRrest proxy = nocturnal HR floor ──────────────────
  // Use 5th percentile of motion-free HR as proxy (more robust than absolute min)
  var stillHR = rows
    .filter(function(r){ return r.motion === 0 && r.hr > 30 && r.hr < 120; })
    .map(function(r){ return r.hr; })
    .sort(function(a,b){ return a - b; });
  if (stillHR.length < 60) return null;

  var p5idx = Math.floor(0.05 * stillHR.length);
  var hrRestNocturnal = stillHR[p5idx];   // 5th percentile nocturnal still HR
  // Prefer manually entered awake resting HR (more accurate for Uth-Sørensen)
  // Nocturnal HR underestimates true resting HR by ~10-15 bpm, inflating VO2max
  var hrRest = (UP && UP.hrRestOverride && UP.hrRestOverride > 30 && UP.hrRestOverride < 100)
    ? UP.hrRestOverride : hrRestNocturnal;

  // Sanity gate: physiologically plausible HRrest
  if (hrRest < 30 || hrRest > 100) return null;

  // ── Step 2: HRmax estimate ─────────────────────────────────────
  // Tanaka 2001: HRmax = 208 - 0.7 × age  (SD ≈ 7 bpm)
  var hrMaxAge = Math.round(208 - 0.7 * age);

  // Nocturnal max is NOT exercise HRmax; use age formula as primary
  // but use nocturnal max as a floor check
  var hrMax = hrMaxAge;  // age formula is more reliable
  var hrMaxSource = 'Age formula (Tanaka 2001)';

  // ── Step 3: VO2max — Uth-Sørensen formula ─────────────────────
  // VO2max (ml/kg/min) = 15.3 × (HRmax / HRrest)
  var vo2raw = (hrRest && hrRest > 0) ? +(15.3 * (hrMax / hrRest)).toFixed(1) : 0;

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
  var rmssdAdj = 0, rmssdNote = '';
  if (hrv.rmssd != null) {
    var rmssdDelta = hrv.rmssd - 1.4;   // reference: 30ms ≈ 1.4 bpm at HR~53
    rmssdAdj = +(rmssdDelta * 1.05).toFixed(1);  // 0.05/ms × ~21ms/bpm ≈ 1.05/bpm
    rmssdAdj = Math.max(-3, Math.min(3, rmssdAdj));  // cap ±3
    rmssdNote = 'RMSSD ' + hrv.rmssd + 'bpm (1Hz proxy) → adj ' + (rmssdAdj >= 0 ? '+' : '') + rmssdAdj;
  }

  var vo2est = +(vo2raw + dfaAdj + rmssdAdj).toFixed(1);

  // ── Step 6: Population percentile — age & sex adjusted (ACSM norms) ─
  var vo2Category, vo2Pct;
  // upVO2category lives in oxydex-profile.js (a UI sibling); it IS loaded in the standalone
  // bundle (so this stays byte-identical there). Guard it so the headless compute() path —
  // co-loaded WITHOUT the profile module (signal-orchestrate §3) — doesn't throw; vo2Category
  // then stays null, harmless because the whole vo2est block is profile-coupled + strip-listed.
  var _vc = (typeof upVO2category === 'function') ? upVO2category(vo2est) : null;  // uses UP.age and UP.sex
  if (_vc) {
    vo2Category = _vc.cat + ' (' + _vc.pct + ')';
    vo2Pct      = _vc.pct;
  } else {
    vo2Category = 'Unknown'; vo2Pct = '—';
  }

  // ── Step 7: Confidence score (0–100) ─────────────────────────
  var conf = 60;  // base
  if (hrRest >= 40 && hrRest <= 65) conf += 15;  // plausible resting HR
  if (stillHR.length > 3600) conf += 10;         // long recording
  if (hrv.rmssd != null) conf += 10;             // RMSSD available
  if (dfa && dfa.alpha1 != null) conf += 5;      // DFA available
  conf = Math.min(100, conf);

  // ── Step 8: SEE and range ─────────────────────────────────────
  // Uth-Sørensen SEE: ±10.8 ml/kg/min general population; ±5.4 for trained athletes
// Using 10.8 for conservative/honest confidence interval (Uth 2004, n=132 mixed fitness)
  // Nocturnal HRrest adds ~±2 additional uncertainty
  var see = 10.8;  // general population SEE (trained athletes: 5.4)
  var vo2Low  = +(vo2est - see).toFixed(1);
  var vo2High = +(vo2est + see).toFixed(1);

  return {
    vo2est:      vo2est,
    vo2Low:      vo2Low,
    vo2High:     vo2High,
    vo2Category: vo2Category,
    vo2Pct:      vo2Pct,
    vo2Conf:     conf,
    hrRest:      hrRest,
    hrMax:       hrMax,
    hrMaxSource: hrMaxSource,
    see:         see,
    dfaAdj:      dfaAdj,
    dfaNote:     dfaNote,
    rmssdAdj:    rmssdAdj,
    rmssdNote:   rmssdNote,
    formula:     'Uth-Sørensen 2004 (VO2max = 15.3 × HRmax/HRrest)',
    label:       vo2est >= 42 ? 'Top-25% for age ' + age :
                 vo2est >= 35 ? 'Above average' :
                 vo2est >= 30 ? 'Average' : 'Below average',
    disclaimer:  'Surrogate estimate ±10.8 ml/kg/min SEE (general pop.) · ±5.4 for trained athletes. Trend tracking only.'
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
  var hasHrRestSource = (UP && UP.hrRestOverride && UP.hrRestOverride > 30 && UP.hrRestOverride < 100)
                     || (vo2est && vo2est.hrRest);
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
      .filter(function(r){ return r.motion === 0 && r.hr > 30 && r.hr < 120; })
      .map(function(r){ return r.hr; })
      .sort(function(a,b){ return a - b; });
    if (stillHR.length < 60) return null;
    hrRest = stillHR[Math.floor(0.05 * stillHR.length)];
  }
  if (hrRest < 30 || hrRest > 80) return null;

  // ── HRmax via Tanaka ──────────────────────────────────────────
  var hrMax = Math.round(208 - 0.7 * age);
  var hrr   = hrMax - hrRest;  // Heart Rate Reserve

  // ── Zone boundaries (Karvonen) ────────────────────────────────
  function zone(pctLow, pctHigh) {
    return {
      low:  Math.round(hrr * pctLow  + hrRest),
      high: Math.round(hrr * pctHigh + hrRest)
    };
  }
  var zones = {
    z1: zone(0.50, 0.60),
    z2: zone(0.60, 0.70),
    z3: zone(0.70, 0.80),
    z4: zone(0.80, 0.90),
    z5: zone(0.90, 1.00)
  };
  zones.z1.name = 'Z1 Recovery';       zones.z1.color = '#56d364'; zones.z1.purpose = 'Active recovery, easy walk/swim';
  zones.z2.name = 'Z2 Aerobic Base';   zones.z2.color = '#79c0ff'; zones.z2.purpose = 'Fat oxidation, base fitness, Zone 2 training';
  zones.z3.name = 'Z3 Tempo';          zones.z3.color = '#ffa657'; zones.z3.purpose = 'Aerobic capacity building, moderate effort';
  zones.z4.name = 'Z4 Threshold';      zones.z4.color = '#d29922'; zones.z4.purpose = 'Lactate threshold, race pace';
  zones.z5.name = 'Z5 VO₂max';         zones.z5.color = '#f85149'; zones.z5.purpose = 'Peak VO₂max, high-intensity intervals';

  // ── Next-Day Readiness Score (0–100) ─────────────────────────
  // Component weights: HRV 30% | SpO2/hypoxia 25% | Sleep arch 20% | HR floor 15% | HR slope 10%
  var scores = {};

  // 1. RMSSD component (30 pts)
  var rmssdScore = 0;
  if (hrv.rmssd != null) {
    // 1Hz proxy thresholds (bpm): at HR≈53, 1bpm≈21ms. 50ms→2.3, 35ms→1.6, 25ms→1.2, 15ms→0.7
    if      (hrv.rmssd >= 2.3) rmssdScore = 30;
    else if (hrv.rmssd >= 1.6) rmssdScore = 24;
    else if (hrv.rmssd >= 1.2) rmssdScore = 18;
    else if (hrv.rmssd >= 0.7) rmssdScore = 10;
    else                       rmssdScore = 4;
  }
  scores.rmssd = rmssdScore;

  // 2. SpO2 / hypoxic load component (25 pts)
  var spo2Score = 0;
  var odi4Rate = odi4 ? odi4.rate : 0;
  var hd94Rate = hypDose ? hypDose.hd94PerHr : 0;
  if      (odi4Rate < 2  && hd94Rate < 30)  spo2Score = 25;
  else if (odi4Rate < 5  && hd94Rate < 60)  spo2Score = 20;
  else if (odi4Rate < 10 && hd94Rate < 120) spo2Score = 13;
  else if (odi4Rate < 20)                   spo2Score = 7;
  else                                      spo2Score = 2;
  scores.spo2 = spo2Score;

  // 3. Sleep architecture (20 pts): duration + REM + deep estimates
  var sleepScore = 0;
  var durationMin = n > 0 ? n / 60 : (durationMinHint || 360);
  if (durationMin >= 420) sleepScore += 10;  // ≥7h
  else if (durationMin >= 360) sleepScore += 7;
  else if (durationMin >= 300) sleepScore += 4;
  else sleepScore += 1;
  if (stageProxy) {
    if (stageProxy.remProxyMin  >= 45) sleepScore += 5; else if (stageProxy.remProxyMin  >= 20) sleepScore += 3;
    if (stageProxy.nremDeepMin  >= 60) sleepScore += 5; else if (stageProxy.nremDeepMin  >= 30) sleepScore += 3;
  } else {
    sleepScore += 5; // neutral if no stage data
  }
  scores.sleep = sleepScore;

  // 4. HR floor (15 pts): lower nocturnal floor = better recovery
  var hrFloorScore = 0;
  if      (hrRest <= 48) hrFloorScore = 15;
  else if (hrRest <= 54) hrFloorScore = 12;
  else if (hrRest <= 60) hrFloorScore = 8;
  else if (hrRest <= 68) hrFloorScore = 4;
  else                   hrFloorScore = 1;
  scores.hrFloor = hrFloorScore;

  // 5. HR slope / dipping (10 pts): negative slope = good nocturnal dip
  var hrSlopeScore = 0;
  if (hrv.hrSlope != null) {
    if      (hrv.hrSlope < -0.5) hrSlopeScore = 10;
    else if (hrv.hrSlope < 0)    hrSlopeScore = 7;
    else if (hrv.hrSlope < 0.5)  hrSlopeScore = 4;
    else                         hrSlopeScore = 1;
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
  if (readiness >= 85) { mafAdj = '+5 (recovering well)';   mafHR += 5; }
  else if (readiness < 55) { mafAdj = '-10 (recovery deficit)'; mafHR -= 10; }
  else mafAdj = 'no adjustment';

  // ── LTHR estimate (Lactate Threshold HR) ─────────────────────
  // Conservative: HRmax × 0.88 (Seiler 2010 estimate for recreational athletes)
  var lthr = Math.round(hrMax * 0.88);
  var lthrNote = 'Zone 4 top ≈ LTHR. Confirm with field test (30-min max effort, avg last 20 min).';

  return {
    hrRest:       hrRest,
    hrMax:        hrMax,
    hrr:          hrr,
    zones:        zones,
    allZones:     [zones.z1, zones.z2, zones.z3, zones.z4, zones.z5],
    readiness:    readiness,
    readinessTier: readinessTier,
    readinessColor: readinessColor,
    recZones:     recZones,
    trainingNote: trainingNote,
    scores:       scores,
    mafHR:        mafHR,
    mafAdj:       mafAdj,
    lthr:         lthr,
    lthrNote:     lthrNote,
    method:       'Karvonen HRR (ACSM 2022) · Tanaka HRmax · MAF 180-formula'
  };
}








// ═══════════════════════════════════════════
// v20 — LITERATURE-VALIDATED HYPOXIC METRICS
// Source: Hui et al. 2024 (Respirology 29:825–834), Kulkas 2013
// ═══════════════════════════════════════════

// SBII (Sleep Breathing Impairment Index) — Hui 2024, best predictor CVD mortality
// Formula: Σ(D_i² × T_i_min) / TRT_hr  [%²·min/hr] — each event contributes depth² × duration
// nadir events computed inline from ODI-4 rolling baseline; result normalized per hour
function computeSBII(rows, nadirEventsIgnored, durationHr, blArr) {
  var spo2 = rows.map(function(r){return r.spo2;});
  var n = spo2.length, WIN = 300;
  if(n < 60 || durationHr <= 0) return {sbii:0, sbiiQ:'Q1(low)'};
  // Build nadir events from the ONE canonical primitive — DEX-EVENT-UNIFY-FOLLOWUPS §1.
  // Same shared ODI-4 event set as computeDesaturationProfile (ceiling baseline, simple
  // re-rise close), so SBII is scored on the headline desats, not a private MEAN loop.
  var nadirEvents = detectDesatEvents(spo2, { dropPct: DexKernel.K.ODI_DROP, exitPct: DexKernel.K.ODI_DROP, blArr: blArr }).map(function(e){
    return { depth: e.depth, duration: e.durationSec, desatArea: (e.depth * e.durationSec) / 60 };
  });
  if(!nadirEvents.length) return {sbii:0, sbiiQ:'Q1(low)'};
  var sum = 0;
  nadirEvents.forEach(function(e){
    // Correct SBII: Σ(D_i² × T_i_min) / TRT_hr  [%²·min/hr] — Hui 2024
    sum += (e.depth * e.depth) * (e.duration / 60);
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
  if(!n) return {pred3p: 0, pred3pQ: 'Q1'};
  // dip3Events: array of {start, end} indices from ODI-3 detection
  // We build this inline from rows
  var spo2 = rows.map(function(r){return r.spo2;});
  // % of recording time occupied by ≥3% desaturations — DEX-EVENT-UNIFY-FOLLOWUPS §1.
  // Sourced from the ONE canonical primitive (ODI-3 threshold, simple re-rise close, no
  // min-length gate so every qualifying dip's time counts), not a private MEAN loop.
  var totalDuration = detectDesatEvents(spo2, { dropPct: 3, exitPct: 3, minSec: 0, blArr: blArr })
    .reduce(function(s, e){ return s + e.durationSec; }, 0);
  var pred3p = +(totalDuration / n * 100).toFixed(2);
  // Quintile reference (SHHS): Q1<2.78%, Q2 2.78–6.19%, Q3 6.19–10.84%, Q4 10.84–19.04%, Q5>19.04%
  var q = pred3p < 2.78 ? 'Q1(low)' : pred3p < 6.19 ? 'Q2' : pred3p < 10.84 ? 'Q3' : pred3p < 19.04 ? 'Q4' : 'Q5(high)';
  return { pred3p: pred3p, pred3pQ: q };
}

// DesSev (Desaturation Severity) — Kulkas 2013 / Karhu (ABOSA)
// Formula: Σ(desaturation_area) / total_time
// Where desaturation_area = area between baseline (left peak) and SpO2 nadir per event
// This is the proper "area under desaturation curve" without requiring manually scored events
function computeDesSev(rows, blArr) {
  var spo2 = rows.map(function(r){return r.spo2;});
  var n = rows.length;
  if(n < 60) return {desSev: 0};
  // Desaturation area (Kulkas) — DEX-EVENT-UNIFY-FOLLOWUPS §1: events from the ONE
  // canonical primitive at the DesSev ≥1% descent threshold (simple re-rise close, no
  // min-length gate); area = Σ per-second deficit vs each event's onset baseline.
  var totalArea = 0;
  detectDesatEvents(spo2, { dropPct: 1, exitPct: 1, minSec: 0, blArr: blArr }).forEach(function(e){
    for(var k = e.startIdx; k < e.endIdx; k++){
      var d = e.baseline - spo2[k];
      if(d > 0) totalArea += d;
    }
  });
  // Normalize: area in %-seconds → %-min/hr
  var durationHr = n / 3600;
  var desSev = durationHr > 0 ? +((totalArea / 60) / durationHr).toFixed(2) : 0;
  return { desSev: desSev };
}

// CT90 / CT89 / CT88 per-second (precise, already in tIdx but now surfaced as distinct fields)
function computeCTprecise(rows) {
  var spo2 = rows.map(function(r){return r.spo2;});
  var n = rows.length;
  var ct90 = 0, ct89 = 0, ct88 = 0, ct85 = 0, ct80 = 0;
  for(var i=0;i<n;i++){
    var v = spo2[i];
    if(v<90) ct90++;
    if(v<89) ct89++;
    if(v<88) ct88++;
    if(v<85) ct85++;
    if(v<80) ct80++;
  }
  return {
    ct90s: ct90, ct89s: ct89, ct88s: ct88, ct85s: ct85, ct80s: ct80,
    ct90m: +(ct90/60).toFixed(1), ct89m: +(ct89/60).toFixed(1),
    ct88m: +(ct88/60).toFixed(1), ct85m: +(ct85/60).toFixed(1)
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
  if(_t.charAt(0) === '[') {
    try { var _arr = JSON.parse(_t); if(Array.isArray(_arr)) text = _arr.map(function(o){ return JSON.stringify(o); }).join('\n'); }
    catch(e){ /* fall through to line-by-line */ }
  }
  var lines = text.trim().split(/\r?\n/);
  lines.forEach(function(line){
    line = line.trim();
    if(!line) return;
    try {
      var obj = JSON.parse(line);
      // Must have date + stats to be valid
      if(!obj.date || !obj.stats) return;
      var s = obj.stats;
      // Reconstruct night object compatible with renderAll/nightRowInner/nightDetail
      var night = {
        date: obj.date,
        t0Ms: (obj.t0Ms != null) ? obj.t0Ms : (s.startTs != null ? s.startTs : null),
        fname: obj.file || obj.date,
        stats: {
          durationMin: s.durationMin||0, start: s.start||'', end: s.end||'',
          startTs: (s.startTs != null) ? s.startTs : null,
          meanSpo2: s.meanSpo2||0, minSpo2: s.minSpo2||0, maxSpo2: s.maxSpo2||100,
          spo2Std: s.spo2Std||0, t95pct: s.t95pct||0, t90pct: s.t90pct||0,
          meanHr: s.meanHr||0, minHr: s.minHr||0, maxHr: s.maxHr||0,
          motionPct: s.motionPct||0, n: s.n||0,
          artifactHrCleaned: s.artifactHrCleaned||0, artifactSpikesRemoved: s.artifactSpikesRemoved||0
        },
        odi4: obj.odi4 || {rate:0, count:0},
        odi3: obj.odi3 || {rate:0, count:0},
        hrv:  obj.hrv  ? {
          hrSdnn: obj.hrv.hrSdnnProxy||obj.hrv.hrSdnn||0,
          pnn3: obj.hrv.pnn3||0,
          hrFloor: obj.hrv.hrFloor||0,
          hrSlope: obj.hrv.hrSlope||0,
          rsaProxy: obj.hrv.rsaProxy||0,
          rmssd: obj.hrv.rmssd||0,
          maxHr: obj.hrv.maxHr||0,
          n: obj.hrv.n||null
        } : null,
        spikes: (function(){
          var evArr = (obj.hr_spikes && Array.isArray(obj.hr_spikes.events))
            ? obj.hr_spikes.events
            : (Array.isArray(obj.hr_spikes) ? obj.hr_spikes : []);
          if(evArr.length) {
            return evArr.map(function(sp){
              return {time: sp.time||'', baseline: sp.baseline||0, peak: sp.peak||0,
                      duration: sp.duration||0, spo2: sp.spo2||0,
                      mfm: sp.mfm||(sp.time?parseTimeStr(sp.time)/60:0)};
            });
          }
          // No event detail — preserve count for summary-mode nights
          var cnt = (obj.hr_spikes && obj.hr_spikes.count) || 0;
          return cnt > 0 ? { length: cnt } : [];
        })(),
        // osc: import the full oscillations object (peakCrossings / first / last included)
        osc: obj.oscillations
          ? Object.assign({windows:[]}, obj.oscillations)
          : {episodeCount:0, totalCrossings:0, meanAmplitude:0, peakCrossings:0, windows:[]},
        period: (obj.hr_spikes && obj.hr_spikes.periodicity && obj.hr_spikes.periodicity.pattern)
          ? obj.hr_spikes.periodicity
          : null,
        tIdx: (function(){
          var idx = {};
          // Seed T95 and T90 from summary stats — all that's available without raw rows
          if(s.t95pct != null) idx[95] = { pct: s.t95pct, secs: Math.round(s.t95pct/100*(s.durationMin||0)*60) };
          if(s.t90pct != null) idx[90] = { pct: s.t90pct, secs: Math.round(s.t90pct/100*(s.durationMin||0)*60) };
          return idx;
        })(),
        // ── v18–v20 fields: restore from the export's descriptive key names ──
        // (the exporter renames internal fields; reading the short names gives
        //  undefined, which the old code silently treated as null — data lost)
        hb:       obj.hypoxicBurden  || null,
        motion:   obj.motionProfile  || null,
        stab:     obj.sleepStability || null,
        motSleep: obj.sleepQuality   || null,
        desat:    obj.desatProfile   || null,
        hrProf:   obj.hrProfile      || null,
        cross:    obj.crossSignal    || null,
        spo2Adv:  obj.spo2Advanced   || null,
        hrAdv:    obj.hrAdvanced     || null,
        comp:     obj.composite      || null,
        sbii:     obj.sbii           || null,
        pred3p:   obj.pred3p         || null,
        desSev:   obj.desSev         || null,
        ctPrec:   obj.ctPrecise      || null,
        flags: (obj.flags||[]).map(function(f){
          if(typeof f !== 'string') return f;
          return { code: f, sev: _flagSev(f) };
        }),
        // ── newMetrics: the v20.6+ extended metrics packed under one sub-key ──
        spo2Drift:  (obj.newMetrics||{}).spo2Drift       || null,
        odi2:       (obj.newMetrics||{}).odi2             || null,
        spo2Over:   (obj.newMetrics||{}).spo2Overshoot   || null,
        spo2Ac1:    (obj.newMetrics||{}).spo2Ac1         || null,
        hrFreq:     (obj.newMetrics||{}).hrFreqBands     || null,
        respRate:   (obj.newMetrics||{}).respRate         || null,
        hrAsym:     (obj.newMetrics||{}).hrAsymmetry     || null,
        hrQuart:    (obj.newMetrics||{}).hrQuartiles     || null,
        spo2HRLag:  (obj.newMetrics||{}).spo2HRLag       || null,
        spkDecay:   (obj.newMetrics||{}).spikeDecay      || null,
        spkUnder:   (obj.newMetrics||{}).spikeUndershoot || null,
        spkRise:    (obj.newMetrics||{}).spikeRiseRate   || null,
        dataGaps:   (obj.newMetrics||{}).dataGaps        || null,
        hrFlat:     (obj.newMetrics||{}).hrFlatlines     || null,
        spo2Ceil:   (obj.newMetrics||{}).spo2Ceiling     || null,
        odri:       (obj.newMetrics||{}).odri            || null,
        spo2Pct:    (obj.newMetrics||{}).spo2Pct         || null,
        spo2Shape:  (obj.newMetrics||{}).spo2Shape       || null,
        hrCV:       (obj.newMetrics||{}).hrCV            || null,
        hypDose:    (obj.newMetrics||{}).hypDose         || null,
        t88t85:     (obj.newMetrics||{}).t88t85          || null,
        lcsp:       (obj.newMetrics||{}).lcsp            || null,
        poincare:   (obj.newMetrics||{}).poincare        || null,
        o2hrEff:    (obj.newMetrics||{}).o2hrEff         || null,
        condSpo2:   (obj.newMetrics||{}).condSpo2        || null,
        nadirTrend: (obj.newMetrics||{}).nadirTrend      || null,
        iei:        (obj.newMetrics||{}).iei             || null,
        recovCV:    (obj.newMetrics||{}).recovCV         || null,
        hrNadirT:   (obj.newMetrics||{}).hrNadirT        || null,
        spo2NadirT: (obj.newMetrics||{}).spo2NadirT      || null,
        rmssdArc:   (obj.newMetrics||{}).rmssdArc        || null,
        spk50Rec:   (obj.newMetrics||{}).spk50Rec        || null,
        stageProxy: (obj.newMetrics||{}).stageProxy      || null,
        vo2est: (function(){
          var v = (obj.newMetrics||{}).vo2est || null;
          if(!v) return null;
          // Recalculate vo2est in case stored value pre-dates rmssdAdj being applied
          // (older exports stored vo2est = 15.3×HRmax/HRrest without the adjustment)
          if(v.hrRest && v.hrMax && v.rmssdAdj != null) {
            var base = +(15.3*(v.hrMax/v.hrRest)).toFixed(1);
            var corrected = +(base + (v.dfaAdj||0) + v.rmssdAdj).toFixed(1);
            if(corrected !== v.vo2est) v = Object.assign({}, v, { vo2est: corrected });
          }
          return v;
        })(),
        bpProj:     (obj.newMetrics||{}).bpProj          || null,
        karv:       (obj.newMetrics||{}).karv            || null,
        // fields not yet exported (computed from raw rows only)
        ct94:null, extras:null, rolling:null, patScore:null, dfa:null, fft:null,
        hrEnt:null, ssi:null, circHR:null, spo2Ent:null, hypLoad:null, vagal:null,
        recIdx:null, sleepP:null, breathI:null, oxyCrash:null, hrnDip:null,
        desatAsym:null, summary:null, slopes:null, pbMet:null, sleepArch:null,
        odi1:null,
        // Recompute MOS + AHI estimates from available scalars — no raw rows needed
        mos: (function(){
          try {
            var o4r = (obj.odi4&&obj.odi4.rate!=null) ? obj.odi4.rate : 0;
            var ct90s = (obj.ctPrecise&&obj.ctPrecise.ct90s!=null) ? obj.ctPrecise.ct90s : 0;
            return computeMOS(o4r, ct90s);
          } catch(e){ return null; }
        })(),
        ahiEst: (function(){
          try {
            var o4r  = (obj.odi4&&obj.odi4.rate!=null)  ? obj.odi4.rate  : 0;
            var o3r  = (obj.odi3&&obj.odi3.rate!=null)  ? obj.odi3.rate  : 0;
            var dsev = (obj.desSev&&obj.desSev.desSev!=null) ? obj.desSev.desSev : 0;
            var t95  = (obj.stats&&obj.stats.t95pct!=null) ? obj.stats.t95pct : 0;
            return computeAHIestimates(o4r, o3r, dsev, t95);
          } catch(e){ return null; }
        })(),
        _fromJSONL: true
      };
      // Generate Smart Summary for JSONL imports too (tabs were missing).
      try { night.summary = computeSmartSummary(night); }
      catch(e) { night.summary = null; }
      results.push(night);
    } catch(e){ console.warn("[O2Ring] suppressed error:", e); }
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
function oxyLoadOwnExport(json){
  // 1 · detect — a ganglior.node-export at all?
  if(!(json && json.schema && json.schema.name === 'ganglior.node-export'))
    return { ok:false, reason:'not-node-export',
      message:'Not a node-export \u2014 drop a raw O2Ring CSV, or OxyDex\u2019s own .json export.' };
  // 2 · guard — a node only re-ingests its OWN kind. A foreign export is REJECTED with a redirect
  //     message (mirrors the Integrator's detectNode), never silently coerced.
  var node = ((json.schema.node || '') + '').trim();
  if(node !== 'OxyDex')
    return { ok:false, reason:'foreign-node', node:node,
      message:'This is a '+(node||'non-OxyDex')+' export \u2014 open it in '+(node||'its own node')
        +', or drop it into the Integrator to fuse.' };
  // 3 · unwrap to the derived layer — nights[] (a single-record export = the object itself). Reuse
  //     the EXISTING parseJSONL per-element reconstruction (its array-flatten branch) verbatim: no new
  //     parse path, no recompute beyond the deterministic stored-scalar MOS/AHI derive parseJSONL
  //     already does (every nights[] element carries obj.date && obj.stats, so each rebuilds).
  var carrier = Array.isArray(json.nights) ? json.nights
              : ((json.date && json.stats) ? [json] : []);
  var nights = (typeof parseJSONL === 'function') ? parseJSONL(JSON.stringify(carrier)) : [];
  // Mark review-mode on each reconstructed night (the renderer greys raw-only panels + the dashboard
  // takes the review chrome) and PREFER the export's STORED summary over parseJSONL's deterministic
  // re-derive (SELF-INGEST §3 — prefer the stored value; a divergence is a bug, never silently shown).
  nights.forEach(function(n, i){
    n._reviewMode = true; n._fromExport = true;
    var el = carrier[i];
    if(el && el.date === n.date && el.summary != null) n.summary = el.summary;
  });
  // 4 · preserve provenance / kernel / events / crossNight VERBATIM — the view's provenance IS the
  //     export's; the current build's stamp must NOT be written over it (no GangliorProvenance.stamp()).
  return {
    ok:true, reviewMode:true, node:node,
    nights: nights,
    events: Array.isArray(json.ganglior_events) ? json.ganglior_events : [],
    provenance: (json.schema && json.schema.provenance) || null,
    generated:  (json.schema && json.schema.generated)  || null,
    derivedFrom:(json.schema && json.schema.derivedFrom) || null,
    kernel:     json.kernel || null,
    crossNight: json.crossNight || null,
    recording:  json.recording || null,
    scrubbed:  !!(json.schema && json.schema.scrubbed),
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
function oxyScrubExport(envelope){
  if(typeof DexExport !== 'undefined' && DexExport && typeof DexExport.scrubExport === 'function') return DexExport.scrubExport(envelope);
  if(typeof dexScrubExport === 'function') return dexScrubExport(envelope);
  return envelope;   // dex-export.js always ships in the OxyDex bundle, so this fallthrough is never reached
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════
function avg(a){ return a.reduce(function(x,y){return x+y;},0)/a.length; }
function stdDev(a){ var m=avg(a); return Math.sqrt(avg(a.map(function(x){return (x-m)*(x-m);}))); }
function fmtDate(d){ return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate()); }
function fmtTime(d){ return pad(d.getUTCHours())+':'+pad(d.getUTCMinutes())+':'+pad(d.getUTCSeconds()); }
function fmtTimeFull(d){ return fmtTime(d)+' '+pad(d.getUTCDate())+'/'+pad(d.getUTCMonth()+1)+'/'+d.getUTCFullYear(); }
function pad(n){ return n<10?'0'+n:''+n; }
function shortDate(s){ return s.slice(5); } // MM-DD from YYYY-MM-DD

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
function oxyBuildNightElement(n, opts){
  opts = opts || {};
  var _prov = (opts.provenance!==undefined?opts.provenance:null);
  var _kernel = (opts.kernel!==undefined?opts.kernel:null);
  var _ecgFusion = (opts.ecgFusion!==undefined?opts.ecgFusion:null);
  var _ansAge = (opts.ansAge!==undefined?opts.ansAge:null);
  return ({date:n.date, t0Ms:(n.t0Ms!=null?n.t0Ms:null), contentId:(n.contentId!=null?n.contentId:null), file:n.fname, provenance:_prov, kernel:_kernel, stats:n.stats,
    summary: n.summary||null,
    odi4:n.odi4?{rate:n.odi4.rate, count:n.odi4.count}:null,
    odi3:n.odi3?{rate:n.odi3.rate, count:n.odi3.count}:null,
    hrv: n.hrv,
    hypoxicBurden: n.hb,
    motionProfile: {motionPct:n.stats?n.stats.motionPct:null, arousalIndex:n.motion?n.motion.arousalIndex:null, restlessWindows:n.motion?n.motion.restlessWindows:null, totalWindows:n.motion?n.motion.totalWindows:null, windows:n.motion&&n.motion.windows?n.motion.windows:[]},
    sleepQuality: n.motSleep||null,
    desatProfile: n.desat||null,
    hrProfile: n.hrProf||null,
    crossSignal: n.cross||null,
    spo2Advanced: n.spo2Adv||null,
    hrAdvanced: n.hrAdv||null,
    composite: n.comp||null,
    sbii: n.sbii||null,
    pred3p: n.pred3p||null,
    desSev: n.desSev||null,
    ctPrecise: n.ctPrec||null,
    sleepStability: n.stab ? {score:n.stab.score, grade:n.stab.grade, components:n.stab.components} : null,
    artifact:n.stats?{hrSamplesCleaned:n.stats.artifactHrCleaned, clockSpikesRemoved:n.stats.artifactSpikesRemoved}:null,
    hr_spikes:{count:(n.spikes?n.spikes.length:0), events:(Array.isArray(n.spikes)?n.spikes:[]), periodicity:n.period},
    oscillations:n.osc, flags:(n.flags||[]).map(function(f){return f.code;}),
    newMetrics:{
      spo2Drift:n.spo2Drift||null, odi2:n.odi2||null,
      spo2Overshoot:n.spo2Over||null, spo2Ac1:n.spo2Ac1||null,
      hrFreqBands:n.hrFreq||null, respRate:n.respRate||null,
      hrAsymmetry:n.hrAsym||null, hrQuartiles:n.hrQuart||null,
      spo2HRLag:n.spo2HRLag||null, spikeDecay:n.spkDecay||null,
      spikeUndershoot:n.spkUnder||null, spikeRiseRate:n.spkRise||null,
      dataGaps:n.dataGaps||null, hrFlatlines:n.hrFlat||null,
      spo2Ceiling:n.spo2Ceil||null,
      odri:n.odri||null, spo2Pct:n.spo2Pct||null, spo2Shape:n.spo2Shape||null,
      hrCV:n.hrCV||null, hypDose:n.hypDose||null, t88t85:n.t88t85||null,
      lcsp:n.lcsp||null, poincare:n.poincare||null, o2hrEff:n.o2hrEff||null,
      condSpo2:n.condSpo2||null, nadirTrend:n.nadirTrend||null, iei:n.iei||null,
      recovCV:n.recovCV||null, hrNadirT:n.hrNadirT||null, spo2NadirT:n.spo2NadirT||null,
      rmssdArc:n.rmssdArc||null, spk50Rec:n.spk50Rec||null, stageProxy:n.stageProxy||null, vo2est:n.vo2est||null, bpProj:n.bpProj||null, karv:n.karv||null},
    // ── full research coverage (mirrors the CSV; previously JSON-only-missing) ──
    research:{
      tIdx:n.tIdx||null, period:n.period||null, ct94:n.ct94||null, slopes:n.slopes||null,
      pbMet:n.pbMet||null, sleepArch:n.sleepArch||null, odi1:n.odi1||null, mos:n.mos||null,
      ahiEst:n.ahiEst||null, extras:n.extras||null, rolling:n.rolling||null, patScore:n.patScore||null,
      dfa:n.dfa||null, fft:n.fft||null, hrEnt:n.hrEnt||null, ssi:n.ssi||null, circHR:n.circHR||null,
      spo2Ent:n.spo2Ent||null, hypLoad:n.hypLoad||null, vagal:n.vagal||null, recIdx:n.recIdx||null,
      sleepP:n.sleepP||null, breathI:n.breathI||null, oxyCrash:n.oxyCrash||null, hrnDip:n.hrnDip||null,
      desatAsym:n.desatAsym||null},
    // ── paired-ECG fusion + projected ANS age (null when no ECG loaded) ──
    ecgFusion:_ecgFusion,
    ansAge:_ansAge});
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
function oxyBuildGangliorEvents(nightsChrono){
  var out = [];
  (nightsChrono || []).forEach(function(n){
    if(!n) return;
    var t0 = (n.t0Ms != null ? n.t0Ms : null);
    if(t0 == null) return;                       // no clock anchor → cannot place events (never fabricate)
    var stats = n.stats || {};
    var nSamp = stats.n || 0;
    var durMs = (stats.durationMin != null) ? stats.durationMin*60000 : null;
    var dt = (durMs && nSamp) ? durMs/nSamp : 1000;   // O2Ring ≈ 1 Hz (mirrors the Integrator's idx→tMs)
    // 1) desat_event — from desatProfile.events (already artifact-gated, pulseValid≥floor)
    var dp = n.desat || null;
    var devs = (dp && Array.isArray(dp.events)) ? dp.events : [];
    devs.forEach(function(d){
      if(!d || d.artifact) return;               // self-gated artifacts are never on the bus (belt + braces)
      var idx = (d.nadirIdx != null ? d.nadirIdx : (d.startIdx != null ? d.startIdx : null));
      if(idx == null) return;
      var tMs = t0 + idx*dt;
      out.push({ t:fmtTime(new Date(tMs)), tMs:tMs, impulse:'desat_event', node:'OxyDex',
        conf:oxyDesatConf(d),
        meta:{ depth:(d.depth!=null?d.depth:null), duration:(d.duration!=null?d.duration:null),
               recovery:(d.recovery!=null?d.recovery:null), nadir:(d.nadir!=null?d.nadir:null) } });
    });
    // 2) periodic_breathing — one per detected oscillation episode (window onset)
    var eps = Array.isArray(n.oscEpisodes) ? n.oscEpisodes : [];
    eps.forEach(function(ep){
      if(!ep) return;
      var tMs = (ep.tMs != null) ? ep.tMs : (ep.startIdx != null ? t0 + ep.startIdx*dt : null);
      if(tMs == null) return;
      var W = (ep.windowSec != null) ? ep.windowSec : ((typeof CFG !== 'undefined' && CFG.OSC_WINDOW_SEC) || 300);
      var cross = (ep.cross != null) ? ep.cross : null;
      // per-episode cycle-length estimate: W seconds / (#crossings/2 oscillations) = 2W/cross (s)
      var cycleLen = (cross && cross > 0) ? +(2*W/cross).toFixed(1) : null;
      out.push({ t:fmtTime(new Date(tMs)), tMs:tMs, impulse:'periodic_breathing', node:'OxyDex',
        conf:oxyPBConf(ep),
        meta:{ cycleLen:cycleLen, crossings:cross, windowSec:W } });
    });
  });
  out.sort(function(a,b){ return a.tMs - b.tMs; });
  return out;
}
// conf = CONTINUOUS certainty of THIS desaturation (NOT its registry tier — §2 keeps the two axes
// separate; a 9%- and a 4%-depth dip are both 'validated' but get different conf). Monotone in depth
// (dominant — a deeper dip is less likely noise), with a mild duration reinforcement and a small
// recovery-quality bonus (a clean re-rise to baseline reads as a discrete event, not drift). Pinned
// here so it can never silently equal the tier. Clamped [0,1]. Base term mirrors the Integrator's
// legacy synthesis (0.45 + min(depth,12)/24) so emitted confidences stay continuous with prior fusion.
function oxyDesatConf(d){
  var depth = (d && d.depth   != null) ? d.depth    : 0;
  var dur   = (d && d.duration!= null) ? d.duration : 0;
  var rec   = (d && d.recovery!= null) ? d.recovery : 0;
  var base  = 0.45 + Math.min(depth,12)/24;       // depth 4→0.62 … ≥12→0.95 (dominant)
  var durB  = Math.min(dur,60)/60 * 0.05;          // up to +0.05 for a ≥60 s sustained dip
  var recB  = (rec > 0) ? 0.03 : 0;                // +0.03 for a clean recovery to baseline
  return +Math.max(0, Math.min(1, base + durB + recB)).toFixed(2);
}
// conf for a single PB episode — scales with the window's threshold-crossing count (more zero-
// crossings = a stronger periodic signature). PB is an epistemically weak DERIVED pattern, so its
// conf is capped well below a scored desat's ceiling (≤0.6) — honest about the proxy.
function oxyPBConf(ep){
  var cross = (ep && ep.cross != null) ? ep.cross : 0;
  return +Math.max(0.30, Math.min(0.60, 0.30 + Math.min(cross,12)/12 * 0.30)).toFixed(2);
}

// SignalFrame(spo2).samples | rows[] | {text,fileMeta} → normalized rows
// [{tMs, t(Date rebuilt from tMs — cross-realm-safe), spo2, hr, motion}].
function _oxyEnsureRows(arr){
  if(!arr || arr.length==null) return null;
  var out=[];
  for(var i=0;i<arr.length;i++){ var r=arr[i]; if(!r || r.tMs==null) continue;
    out.push({ tMs:r.tMs, t:new Date(r.tMs), spo2:r.spo2, hr:r.hr, motion:(r.motion||0) }); }
  return out;
}
function _oxyRowsFromInput(input){
  if(input==null) return null;
  if(Array.isArray(input)) return _oxyEnsureRows(input);
  if(input.samples!=null) return _oxyEnsureRows(input.samples);
  if(input.rows!=null) return _oxyEnsureRows(input.rows);
  if(typeof input.text==='string') return parseCSV(input.text, input.fileMeta||null);
  return null;
}
function oxyComputeNight(input, fname){
  var rows=_oxyRowsFromInput(input);
  if(!rows || rows.length<1) return null;
  return processNight(rows, fname||null);
}

// Public namespace — the headless surface the orchestrator + app both reach.
var OxyDex = (typeof OxyDex !== 'undefined' && OxyDex) ? OxyDex : {};
OxyDex.compute = function(input, opts){
  opts = opts || {};
  var fname = opts.fname
    || (input && input.provenance && input.provenance.files && input.provenance.files[0])
    || (input && input.fname) || null;
  var night = oxyComputeNight(input, fname);
  if(!night) return null;
  var kfmt = opts.kernel ? { version:opts.kernel.VERSION, hash:opts.kernel.HASH } : null;
  var el = oxyBuildNightElement(night, { provenance:(opts.provenance!==undefined?opts.provenance:null), kernel:kfmt, ecgFusion:null, ansAge:null });
  var t0 = (night.t0Ms!=null ? night.t0Ms : null);
  var schema = {
    name:'ganglior.node-export', version:'2.0', node:'OxyDex', nodeVersion:'1.0', multiNight:false,
    generated:(opts.generated || new Date().toISOString()),
    provenance:(opts.provenance!==undefined?opts.provenance:null),
    doc:'OxyDex single-night SpO₂/oximetry summary computed headless from a SignalFrame(spo2). Emits ganglior_events[] (desat_event from desatProfile + periodic_breathing from oscillation episodes); OxyDex infers respiration from an SpO₂ proxy, not airflow. tMs = floating wall-clock ms (UTC getters); null = unknown, never fabricated.'
  };
  if(opts.ingest) schema.ingest = opts.ingest;   // adapter provenance (unifier/OverDex path)
  return {
    kernel:kfmt,
    schema:schema,
    recording:{ source:'spo2', startEpochMs:t0, offsetMin:(opts.offsetMin!=null?opts.offsetMin:null),
      durationMin:(night.stats?night.stats.durationMin:null), beats:(night.stats?night.stats.n:null), coveragePct:null },
    ganglior_events:oxyBuildGangliorEvents([night]),
    nights:[el]
  };
};
OxyDex.computeNight = oxyComputeNight;
OxyDex.buildNightElement = oxyBuildNightElement;
OxyDex.buildGangliorEvents = oxyBuildGangliorEvents;
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
OxyDex.cleanArtifactHR = cleanArtifactHR;   // exposed for the OXYDEX-HR-ARTIFACT-RUNAWAY-FIX regression gate
OxyDex.computeGatedNadir = computeGatedNadir; // exposed for the OXYDEX-NADIR-HONESTY regression gate

// ── public namespace (always) ──
root.OxyDex = OxyDex;

// ── app back-compat: re-export the bare DSP globals UNLESS co-loaded namespaced ──
if (!root.__DEX_NAMESPACED__) {
  Object.assign(root, {
    CFG, APP_VERSION, _parserSource, _fi, ua, isO2RingBin, _o2p2, tzOffset,
    _ckNumEpoch, _ckZoneMin, _ckDMY, parseTimestamp, _o2DateAnchorMs, _o2BinStartMs, decodeO2RingBinToCSV, handleFiles,
    readFile, parseCSV, parseTime, cleanArtifactHR, trimSensorWarmup, filterArtifactSpikes, computeCT94, computeDesatSlopes, computePBmetrics,
    computeSleepArch, computeODI1, computeMOS, computeAHIestimates, computeNightExtras, computeRollingMetrics, computePatternScores, computeDFA,
    computeSpO2FFT, computeHREntropy, computeSympSurge, computeCircadianHR, computeSpO2Entropy, computeHypoxicLoad, computeVagalIndex, computeRecoveryIndex,
    computeSleepPressure, computeBreathingIrregularity, computeOxyCrash, computeHRNoctDip, computeDesatAsymmetry, computeSmartSummary, buildImpression, processNight,
    computeStats, computeTIndex, computeHRV, detectDesatEvents, detectODI, detectSpikes, detectPeriodicity, parseTimeStr,
    detectOscillations, _flagSev, buildFlags, computeHypoxicBurden, computeMotionProfile, computeSleepStabilityScore, SELFGATE, selfGateDesat,
    computeDesaturationProfile, computeHRProfile, computeMotionSleep, computeCrossSignal, computeSpO2Advanced, computeHRAdvanced, computeComposite, linReg, computeGatedNadir,
    computeSpO2Drift, computeODI2, computeSpO2Overshoot, computeSpO2Autocorr, computeHRFreqBands, computeRespRateProxy, computeHRAsymmetry, computeHRQuartileTrend,
    computeSpO2HRLag, computeSpikeDecay, computeSpikeUndershoot, computeSpikeRiseRate, computeDataGaps, computeHRFlatlines, computeSpO2Ceiling, computeODRI,
    computeSpO2Percentiles, computeSpO2Shape, computeHRCV, computeHypoxicDose, computeT88T85, computeLCSP, computePoincareSD, computeO2HREfficiency,
    computeConditionalSpO2, computeNadirTrend, computeIEI, computeRecoverySlopeCV, computeHRNadirTime, computeSpO2NadirTime, computeRMSSDarc, computeSpike50PctRecovery,
    computeSleepStageProxy, computeVO2maxEstimate, computeKarvonenZones, computeSBII, computePRED3p, computeDesSev, computeCTprecise, parseJSONL,
    avg, stdDev, fmtDate, fmtTime, fmtTimeFull, pad, shortDate, oxyBuildNightElement, oxyBuildGangliorEvents, oxyDesatConf, oxyPBConf, oxyLoadOwnExport, oxyScrubExport,
    _oxyEnsureRows, _oxyRowsFromInput, oxyComputeNight
  });
  // mutable cross-file state — proxy bare `allNights` to the in-closure binding
  Object.defineProperty(root, 'allNights', { configurable: true,
    get: function () { return allNights; }, set: function (v) { allNights = v; } });
}

})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));

