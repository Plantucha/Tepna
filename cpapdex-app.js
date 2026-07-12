/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   CPAPDex · APP — orchestration (cpapdex-app.js)
   Loaded LAST (after edf/dsp/render/fusion). Shares page scope.
   ────────────────────────────────────────────────────────────────────────
   • groupEdfFiles  — cluster a dropped AirSense file-set into sessions by the
                      filename timestamp prefix (YYYYMMDD_HHMMSS), assigning each
                      file to BRP/PLD/SA2/EVE/CSL by its suffix.
   • analyzeSet     — decode → buildSessionFromEdf per cluster → buildNight.
   • renderInto     — paint KPIs/cards + hydrate charts + wire export.
   • export         — CpapFusion.cpapBuildExport(night) → ganglior.node-export.json
   100% local: drag-drop reads ArrayBuffers in-browser; the demo button fetches
   the bundled uploads/ set (dev/preview only). Nothing leaves the device.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';

var FILE_TYPES = ['BRP', 'PLD', 'SA2', 'EVE', 'CSL'];
var SESSION_GAP_MS = 15 * 60 * 1000;   // files >15 min apart start a new session cluster
var NIGHT_GAP_MS = 12 * 60 * 60 * 1000; // clusters >12 h apart belong to DIFFERENT nights

function $(id){ return document.getElementById(id); }
function setStatus(msg, kind){
  var el = $('status'); if (!el) return;
  el.textContent = msg || '';
  el.className = 'status' + (kind ? ' ' + kind : '');
}

/* filename → { prefixMs, type } (type from the _XXX suffix before .edf) */
function parseEdfName(name){
  var base = name.replace(/^.*[\\/]/, '');
  var m = base.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  var prefixMs = null;
  if (m) prefixMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);   // floating wall-clock
  var type = null;
  for (var i = 0; i < FILE_TYPES.length; i++) if (new RegExp('_' + FILE_TYPES[i] + '\\.edf$', 'i').test(base)) { type = FILE_TYPES[i]; break; }
  return { name: base, prefixMs: prefixMs, type: type };
}

/* group {name → ArrayBuffer} into ordered session clusters */
function groupEdfFiles(entries){
  // entries: [{ name, buf }]
  var parsed = entries.map(function (e){ var p = parseEdfName(e.name); return { name: e.name, buf: e.buf, prefixMs: p.prefixMs, type: p.type }; })
    .filter(function (e){ return e.type; })
    .sort(function (a, b){ return (a.prefixMs || 0) - (b.prefixMs || 0); });
  var clusters = [];
  parsed.forEach(function (e){
    var c = clusters[clusters.length - 1];
    if (!c || (e.prefixMs != null && c.anchorMs != null && (e.prefixMs - c.anchorMs) > SESSION_GAP_MS)){
      c = { anchorMs: e.prefixMs, files: {} };
      clusters.push(c);
    }
    c.files[e.type] = e;            // last-wins on duplicate type within a cluster
  });
  return clusters;
}

/* decode every file in the clusters → sessions → night(s) */
var LOADED_NIGHTS = [];
var CURRENT = null;   // the night shown in the single-night detail (latest)

/* paint results: a Longitudinal card (when ≥2 nights) + the latest night's full detail.
   Hydrates charts + trend sparklines, re-applies depth tier, reveals export. */
function renderResults(){
  var host = $('results'); if (!host) return;
  // SELF-INGEST: a normal (EDF) render is NOT review mode — clear any review context + body flag.
  window._cpapReview = null; try { document.body.classList.remove('cpap-review'); } catch(_r){}
  var R = global.CpapRender, D = global.CpapDsp;
  LOADED_NIGHTS.sort(function (a, b){ return (a.t0Ms || 0) - (b.t0Ms || 0); });
  CURRENT = LOADED_NIGHTS[LOADED_NIGHTS.length - 1] || null;   // latest night = detail focus
  if (!CURRENT) return;
  var history = (LOADED_NIGHTS.length >= 2 && R.renderHistory) ? R.renderHistory(LOADED_NIGHTS) : '';
  host.innerHTML = history + R.renderNight(CURRENT);
  R.hydrate(host, CURRENT);
  if (history && R.hydrateHistory) R.hydrateHistory(host, LOADED_NIGHTS);
  if (global.MetricRegistry) try { global.MetricRegistry.applyTier(global.MetricRegistry.getTier()); } catch(e){}
  var hdr = $('nightHeader');
  if (hdr){
    var multi = LOADED_NIGHTS.length > 1;
    hdr.innerHTML = '<div class="nh-date">' + (D ? D.fmtDate(CURRENT.t0Ms) : '') + (multi ? ' <span style="color:var(--text3);font-size:.6em;font-weight:600">latest of ' + LOADED_NIGHTS.length + ' nights</span>' : '') + '</div>'
      + '<div class="nh-meta">' + (D ? D.fmtClock(CURRENT.t0Ms) : '') + ' start · ' + CURRENT.therapyHours + ' h therapy · '
      + CURRENT.nSessions + ' session' + (CURRENT.nSessions === 1 ? '' : 's') + '</div>';
    hdr.style.display = 'block';
  }
  var ex = $('exportBtn'); if (ex){ ex.style.display = 'inline-flex'; ex.textContent = LOADED_NIGHTS.length >= 3 ? '⤓ Export multi-night JSON' : '⤓ Export node JSON'; }
  var up = $('uploadCard'); if (up) up.style.display = 'none';
  var rv = $('resultsView'); if (rv) rv.style.display = 'block';
  var eb = $('exportBar'); if (eb) eb.classList.add('show');
  var addBtn = $('addNightsBtn'); if (addBtn) addBtn.style.display = 'inline-flex';
}

/* SELF-INGEST: paint the review-mode clinical view from a reloaded CPAPDex export (window._cpapReview).
   Renders the export's STORED values verbatim (no recompute); the export bar re-exports as DERIVED. */
function renderReview(){
  var host = $('results'); if (!host) return;
  var review = window._cpapReview; if (!review) return;
  var R = global.CpapRender, D = global.CpapDsp;
  try { document.body.classList.add('cpap-review'); } catch(_r){}
  host.innerHTML = (R && R.renderReviewView) ? R.renderReviewView(review) : '';
  if (global.MetricRegistry) try { global.MetricRegistry.applyTier(global.MetricRegistry.getTier()); } catch(e){}
  var els = review.elements || [];
  var t0 = (els[0] && els[0].recording) ? els[0].recording.startEpochMs : null;
  var hdr = $('nightHeader');
  if (hdr){
    hdr.innerHTML = '<div class="nh-date">' + ((D && t0 != null) ? D.fmtDate(t0) : 'Export')
      + ' <span style="color:var(--text3);font-size:.6em;font-weight:600">review mode \u00b7 ' + els.length + ' night' + (els.length === 1 ? '' : 's') + '</span></div>'
      + '<div class="nh-meta">Loaded from a CPAPDex node-export \u00b7 not recomputed</div>';
    hdr.style.display = 'block';
  }
  var up = $('uploadCard'); if (up) up.style.display = 'none';
  var rv = $('resultsView'); if (rv) rv.style.display = 'block';
  var eb = $('exportBar'); if (eb) eb.classList.add('show');
  var addBtn = $('addNightsBtn'); if (addBtn) addBtn.style.display = 'none';   // no "add nights" in review
  var ex = $('exportBtn'); if (ex){ ex.style.display = 'inline-flex'; ex.textContent = '\u2913 Re-export (derived)'; }
}

function handleEntries(entries){
  setStatus('Decoding ' + entries.length + ' file' + (entries.length === 1 ? '' : 's') + '…', 'busy');
  try {
    var res = analyzeSet(entries);
    mergeNights(res.nights);
    renderResults();
    setStatus(res.nights.length > 1 ? ('Loaded ' + res.nights.length + ' nights') : '');
  } catch (err){
    setStatus(err.message || String(err), 'error');
    console.error(err);
  }
}

/* decode every file in the clusters → sessions, then group sessions into NIGHTS
   (a >12 h gap between consecutive sessions starts a new night). Returns nights[]. */
function analyzeSet(entries){
  if (!global.CpapEdf || !global.CpapDsp) throw new Error('modules not loaded');
  var clusters = groupEdfFiles(entries);
  if (!clusters.length) throw new Error('no recognizable AirSense EDF files (expected *_BRP/PLD/SA2/EVE/CSL.edf)');
  var sessions = [];
  clusters.forEach(function (c){
    var set = {};
    FILE_TYPES.forEach(function (t){
      if (c.files[t]){
        try { set[t] = global.CpapEdf.readEDF(c.files[t].buf); }
        catch (err){ set[t] = null; console.warn('readEDF failed for', c.files[t].name, err); }
      }
    });
    var sess = global.CpapDsp.buildSessionFromEdf(set, { fname: (c.files.PLD || c.files.BRP || {}).name || null });
    if (sess) sessions.push(sess);
  });
  if (!sessions.length) throw new Error('no therapy session could be built (missing PLD/BRP pressure channel?)');
  sessions.sort(function (a, b){ return (a.t0Ms || 0) - (b.t0Ms || 0); });
  // split sessions into nights on a >12 h gap
  var groups = [], cur = null;
  sessions.forEach(function (s){
    if (!cur || (s.t0Ms - cur._lastEnd) > NIGHT_GAP_MS){ cur = { ss: [], _lastEnd: s.endMs }; groups.push(cur); }
    cur.ss.push(s); cur._lastEnd = Math.max(cur._lastEnd, s.endMs);
  });
  var nights = groups.map(function (g){ return global.CpapDsp.buildNight(g.ss); });
  return { nights: nights, clusters: clusters, sessions: sessions };
}

/* merge freshly-parsed nights into the accumulator (append flow; dedupe by t0Ms
   within 30 s so re-dropping the same set doesn't double-count). */
function mergeNights(fresh){
  fresh.forEach(function (nn){
    var dup = LOADED_NIGHTS.some(function (ex){ return ex.t0Ms != null && nn.t0Ms != null && Math.abs(ex.t0Ms - nn.t0Ms) < 30000; });
    if (!dup) LOADED_NIGHTS.push(nn);
  });
  LOADED_NIGHTS.sort(function (a, b){ return (a.t0Ms || 0) - (b.t0Ms || 0); });
  return LOADED_NIGHTS;
}

/* read a FileList → route .edf (AirSense set) and .json (peer node-exports) */
function handleFileList(fileList){
  var all = Array.prototype.slice.call(fileList);
  var edfs = all.filter(function (f){ return /\.edf$/i.test(f.name); });
  var jsons = all.filter(function (f){ return /\.json$/i.test(f.name); });
  if (!edfs.length && !jsons.length){ setStatus('Drop your AirSense .edf set — and optionally an OxyDex/ECGDex .json export to upgrade the read.', 'error'); return; }

  var pending = edfs.length + jsons.length, entries = [], peerMsgs = [], reviewPending = null;
  function done(){
    if (--pending > 0) return;
    if (entries.length) handleEntries(entries);                 // EDF wins → normal (non-review) dashboard
    else if (reviewPending){                                     // SELF-INGEST: CPAPDex own export → review-mode clinical view
      window._cpapReview = reviewPending;
      renderReview();
      setStatus('Loaded CPAPDex export \u00b7 review mode \u2014 ' + reviewPending.elements.length + ' night' + (reviewPending.elements.length === 1 ? '' : 's') + '. Not recomputed.');
    }
    else if (peerMsgs.length){                                   // JSON-only drop: re-render with new corroboration
      if (!LOADED_NIGHTS.length){ setStatus('Loaded ' + peerMsgs.join(' + ') + '. Now drop the AirSense .edf set to pair it.', 'busy'); return; }
      renderResults();
      setStatus('Paired ' + peerMsgs.join(' + ') + ' to ' + LOADED_NIGHTS.length + ' night' + (LOADED_NIGHTS.length === 1 ? '' : 's') + '.');
    }
  }
  if (pending === 0){ setStatus('No readable files.', 'error'); return; }
  setStatus('Reading ' + pending + ' file' + (pending === 1 ? '' : 's') + '…', 'busy');

  edfs.forEach(function (f){
    var rd = new FileReader();
    rd.onload = function (){ entries.push({ name: f.name, buf: rd.result }); done(); };
    rd.onerror = function (){ done(); };
    rd.readAsArrayBuffer(f);
  });
  jsons.forEach(function (f){
    var rd = new FileReader();
    rd.onload = function (){
      var parsed = null;
      try { parsed = JSON.parse(rd.result); } catch (e){ peerMsgs.push(f.name + ' (invalid JSON)'); done(); return; }
      // SELF-INGEST: CPAPDex's OWN node-export → review-mode clinical view (NOT co-import). A foreign
      // OxyDex/ECGDex export falls through to CpapCoimport below (borrowed corroboration).
      if (parsed && parsed.schema && parsed.schema.name === 'ganglior.node-export' && parsed.schema.node === 'CPAPDex'
          && global.CpapFusion && typeof global.CpapFusion.cpapLoadOwnExport === 'function'){
        var r = global.CpapFusion.cpapLoadOwnExport(parsed);
        if (r && r.ok){
          reviewPending = { provenance:r.provenance, generated:r.generated, derivedFrom:r.derivedFrom, kernel:r.kernel,
            events:r.events, elements:r.elements, crossNight:r.crossNight, node:r.node,
            scrubbed:r.scrubbed, multiNight:r.multiNight, raw:r.raw };
        } else {
          peerMsgs.push(f.name + ' (' + ((r && r.message) || 'not loadable') + ')');
        }
        done(); return;
      }
      try {
        var res = global.CpapCoimport ? global.CpapCoimport.ingest(parsed, f.name) : null;
        if (res && res.count) peerMsgs.push(res.node + (res.count > 1 ? ' ×' + res.count : ''));
        else peerMsgs.push(f.name + ' (unrecognized — need an OxyDex/ECGDex node-export)');
      } catch (e){ peerMsgs.push(f.name + ' (invalid JSON)'); }
      done();
    };
    rd.onerror = function (){ done(); };
    rd.readAsText(f);
  });
}

/* ── demo loader ───────────────────────────────────────────────────────────────────────────
   The demo fetches a COMMITTED, SYNTHETIC EDF set (tools/make-synthetic-edf.mjs): closed-form
   waveforms calibrated to a real corpus's distributions, carrying no recording of any person and
   no device identifier (the EDF+ header identity fields are blank).

   It used to point at TEN REAL AirSense .edf files — which are gitignored personal recordings.
   They exist only on the maintainer's machine, so on ANY fresh clone all ten fetches 404'd and
   the demo died with "Demo data unavailable in this build". **The shipped demo had never worked
   for anyone but the maintainer**, and the browser render-coverage gate that would have caught it
   was silently not running its assertions (fixed by GATE-INTEGRITY-AND-DEVLOOP, which is what
   exposed this).

   That is the same disease as CPAP-REAL-CORPUS §M5 — a surface that only works where the personal
   data happens to be — except here it is a USER-FACING feature, not a test. The cure is the same
   one §P2 already built and committed: a synthetic input carries no personal data, so it can ship.
   Keep it that way: a demo MUST NOT depend on anything gitignored.                              */
var DEMO_FILES = [
  '20260613_231433_BRP.edf', '20260613_231433_PLD.edf', '20260613_231433_SA2.edf',
  '20260613_231433_EVE.edf', '20260613_231433_CSL.edf'
];
function loadDemo(){
  setStatus('Loading demo night…', 'busy');
  var entries = [], pending = DEMO_FILES.length, failed = 0;
  DEMO_FILES.forEach(function (name){
    fetch('uploads/' + name).then(function (r){
      if (!r.ok) throw new Error(r.status); return r.arrayBuffer();
    }).then(function (buf){
      entries.push({ name: name, buf: buf });
    }).catch(function (){ failed++; }).then(function (){
      if (--pending === 0){
        if (!entries.length){ setStatus('Demo data unavailable in this build — drop your own AirSense .edf files.', 'error'); return; }
        // The captured AirSense demo nights were recorded with NO oximeter on the
        // SA2 channel (all sentinel). To exercise the SA2 oximetry lane in the demo,
        // synthesize a plausible SpO₂/Pulse trace IN MEMORY over the real SA2 record
        // geometry — the captured .edf on disk is never modified (capture provenance
        // stays intact). Gated to the demo path only; user-dropped files are untouched.
        // Desaturations are placed at the night's OWN scored apnea/hypopnea events
        // (parsed from the EVE/CSL annotations) so ODI tracks the device AHI rather
        // than reading high against a well-controlled airflow night.
        var eventTimesMs = [];
        if (global.CpapEdf) entries.forEach(function (e){
          if (/_(EVE|CSL)\.edf$/i.test(e.name)) {
            try { (global.CpapEdf.readEDF(e.buf).annotations || []).forEach(function (a){
              if (a.tMs != null && /Apnea|Hypopnea|Cheyne|Periodic/i.test(a.class)) eventTimesMs.push(a.tMs);
            }); } catch(_){}
          }
        });
        var simulated = 0;
        entries.forEach(function (e){
          if (/_SA2\.edf$/i.test(e.name)) { try { e.buf = simulateOximetrySA2(e.buf, eventTimesMs); simulated++; } catch(_){} }
        });
        handleEntries(entries);
        if (simulated) setStatus('Loaded demo night · SpO₂ oximeter simulated on the SA2 lane (desats aligned to scored events)');
      }
    });
  });
}

/* Demo-only oximeter simulation. Rewrites ONLY the SpO2 + Pulse sample bytes of a
   real SA2 EDF buffer with a synthetic overnight trace (baseline ~96% with gentle,
   physiologic desaturation dips + an in-band pulse), so the SA2 oximetry lane has a
   signal to score. Header/timing/other signals/annotations are left byte-identical,
   guaranteeing the synthetic SA2 still pairs to its session. Returns a NEW ArrayBuffer. */
function simulateOximetrySA2(srcBuf, eventTimesMs){
  var out = srcBuf.slice(0);
  var u8 = new Uint8Array(out), dv = new DataView(out);
  function trim(s,l){ var o=''; for (var i=0;i<l;i++) o+=String.fromCharCode(u8[s+i]); return o.replace(/\u0000+$/,'').trim(); }
  var ns = parseInt(trim(252,4),10);
  if (!ns || ns<1) return out;
  var headerBytes = parseInt(trim(184,8),10) || (256+ns*256);
  var recDur = parseFloat(trim(244,8)) || 1;
  // session start (floating tMs) — to align desats to absolute event times
  var t0Ms = null;
  if (global.CpapEdf && global.CpapEdf.parseEdfClock) {
    var clk = global.CpapEdf.parseEdfClock(trim(168,8), trim(176,8));
    if (clk) t0Ms = clk.t0Ms;
  }
  var o = 256;
  function block(w){ var a=[]; for (var s=0;s<ns;s++) a.push(trim(o+s*w,w)); o+=ns*w; return a; }
  var labels = block(16);
  o += ns*80;                       // transducer
  block(8);                         // dims (advance o)
  var physMin = block(8).map(Number), physMax = block(8).map(Number);
  var digMin  = block(8).map(Number), digMax  = block(8).map(Number);
  o += ns*80;                       // prefilter
  var sampPerRec = block(8).map(function(v){ return parseInt(v,10)||0; });
  // record geometry + per-signal byte offset within a record
  var total = sampPerRec.reduce(function(a,b){ return a+b; }, 0);
  var bytesPerRec = total*2, byteOff = [], acc = 0;
  for (var s=0;s<ns;s++){ byteOff.push(acc); acc += sampPerRec[s]*2; }
  var spo2 = labels.findIndex(function(l){ return /^SpO2/i.test(l); });
  var pulse = labels.findIndex(function(l){ return /^Pulse/i.test(l); });
  if (spo2 < 0) return out;
  var maxWhole = Math.floor((out.byteLength - headerBytes) / bytesPerRec);
  var nRec = parseInt(trim(236,8),10); if (nRec==null||nRec<0||nRec>maxWhole) nRec = maxWhole;
  var fsSp = (sampPerRec[spo2]||1)/recDur;
  var spanSec = nRec * recDur;
  function toDig(idx, phys){
    var pMin=physMin[idx], pMax=physMax[idx], dMin=digMin[idx], dMax=digMax[idx];
    var sc = (pMax-pMin)/(((dMax-dMin)||1));
    var dig = Math.round((phys - pMin)/(sc||1) + dMin);
    return Math.max(dMin, Math.min(dMax, dig));
  }
  // desat onset-seconds within THIS session: the scored apnea/hypopnea events that
  // fall in this session's span. The desaturation lags the event onset by ~12 s
  // (blood + lung kinetics). With one ~4.5% dip per event, ODI ≈ the device AHI.
  var onsets = [];
  if (t0Ms != null && eventTimesMs && eventTimesMs.length) {
    eventTimesMs.forEach(function (ms){ var sec = (ms - t0Ms)/1000; if (sec >= 0 && sec <= spanSec) onsets.push(sec); });
  }
  // fallback (no annotations available): a sparse, mostly-controlled pattern (~3/hr)
  if (!onsets.length) { for (var k=900; k<spanSec; k+=1200) onsets.push(k); }
  onsets.sort(function(a,b){ return a-b; });
  // gentle gaussian dip (σ≈9 s ⇒ steepest fall ≈0.3 %/s, well under the self-gate's 1.5 %/s)
  function spo2At(t){
    var base = 96 + 0.4*Math.sin(t/640) + 0.3*Math.sin(t/3.0);
    var dip = 0;
    for (var e=0;e<onsets.length;e++){ var dt = t - (onsets[e] + 12); if (dt>-22 && dt<22){ var d = 4.6*Math.exp(-(dt*dt)/(2*81)); if (d>dip) dip = d; } }
    return Math.max(86, Math.min(99, base - dip));
  }
  function pulseAt(t){
    var base = 56 + 3*Math.sin(t/300) + 2*Math.sin(t/2.4);
    var surge = 0;
    for (var e=0;e<onsets.length;e++){ var dt = t - (onsets[e] + 22); if (dt>-12 && dt<14){ var sgv = 9*Math.exp(-(dt*dt)/(2*64)); if (sgv>surge) surge = sgv; } }
    return Math.max(46, Math.min(94, base + surge));
  }
  for (var r=0;r<nRec;r++){
    var recBase = headerBytes + r*bytesPerRec;
    var spr = sampPerRec[spo2];
    for (var i=0;i<spr;i++){
      var t = (r*spr + i)/fsSp;
      dv.setInt16(recBase + byteOff[spo2] + i*2, toDig(spo2, spo2At(t)), true);
      if (pulse>=0 && sampPerRec[pulse]===spr)
        dv.setInt16(recBase + byteOff[pulse] + i*2, toDig(pulse, pulseAt(t)), true);
    }
  }
  return out;
}

/* export: a single-night ganglior.node-export, OR (≥3 nights) a multi-night array
   wrapped in a ganglior.crossnight v1.0 aggregate header — same pattern as OxyDex. */
function exportNight(){
  // SELF-INGEST review-mode RE-EXPORT: re-emit the LOADED export stamped schema.derivedFrom (the
  // original build's identity) — NEVER GangliorProvenance.stamp() over it — with optional scrub.
  if (window._cpapReview){
    var rv = window._cpapReview;
    var env = JSON.parse(JSON.stringify(rv.raw || {}));
    env.schema = env.schema || {};
    env.schema.derivedFrom = {
      buildHash: (rv.provenance && rv.provenance.buildHash) || (rv.derivedFrom && rv.derivedFrom.buildHash) || null,
      generated: (rv.provenance && rv.provenance.generated) || rv.generated || null,
      via: 'CPAPDex review-mode re-export'
    };
    var outEnv = (window._cpapScrub && global.dexScrubExport) ? global.dexScrubExport(env) : env;
    var t0R = (outEnv.recording && outEnv.recording.startEpochMs != null) ? outEnv.recording.startEpochMs
            : ((rv.elements && rv.elements[0] && rv.elements[0].recording) ? rv.elements[0].recording.startEpochMs : null);
    var fnameR = exportName({ node:'CPAPDex', t0Ms:t0R, kind:(rv.multiNight ? 'series' : 'ganglior'), ext:'json' });
    var blobR = new Blob([JSON.stringify(outEnv, null, 2)], { type:'application/json;charset=utf-8' });
    var urlR = URL.createObjectURL(blobR);
    var aR = document.createElement('a'); aR.href = urlR; aR.download = fnameR;
    document.body.appendChild(aR); aR.click(); document.body.removeChild(aR);
    setTimeout(function (){ URL.revokeObjectURL(urlR); }, 1000);
    return;
  }
  if (!LOADED_NIGHTS.length || !global.CpapFusion) return;
  var D = global.CpapDsp, payload, fname;
  if (LOADED_NIGHTS.length >= 3 && global.CPAPCross && global.CrossNightEnvelope){
    var chrono = LOADED_NIGHTS.slice().sort(function (a, b){ return (a.t0Ms || 0) - (b.t0Ms || 0); });
    // CPAPDEX-PHASE9-FOLLOWUPS-IV §2: the multi-night envelope is now the shared
    // CpapFusion.cpapBuildMultiNightExport (lifted beside cpapBuildExport) so the gate
    // exercises the SAME builder the app runs (the -III in-test reconstruction + 4-assert
    // source-pin is retired). The guard above confirmed CPAPCross + CrossNightEnvelope present.
    payload = global.CpapFusion.cpapBuildMultiNightExport(chrono);
    // EXPORT-HYGIENE §2: name through the shared exportName() (the cpapdex- D.fmtDate stamp was already
    // recording-anchored/Clock-Contract-clean — this is vocab + single-source adoption). series + span.
    fname = exportName({node:'CPAPDex', t0Ms:(chrono[0]&&chrono[0].t0Ms), kind:'series', ext:'json',
      spanDays:(chrono.length>1?Math.round(((chrono[chrono.length-1].t0Ms||0)-(chrono[0].t0Ms||0))/864e5):null)});
  } else {
    payload = global.CpapFusion.cpapBuildExport(CURRENT);
    // single-night cpapBuildExport IS the ganglior node-export (the fusion currency) → kind 'ganglior'.
    fname = exportName({node:'CPAPDex', t0Ms:(CURRENT?CURRENT.t0Ms:null), kind:'ganglior', ext:'json'});
  }
  // SELF-INGEST §5 — optional "scrub for sharing" (default OFF): strip device serial / filename / input
  // sha256 while keeping the clinical summary + a coarse build stamp. OFF → byte-identical to before.
  var outPayload = (window._cpapScrub && global.dexScrubExport) ? global.dexScrubExport(payload) : payload;
  var blob = new Blob([JSON.stringify(outPayload, null, 2)], { type: 'application/json;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = fname;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function (){ URL.revokeObjectURL(url); }, 1000);
}

/* ── CSV toolkit ── missing(null/undefined/NaN/±Inf)→blank · real 0 preserved · RFC-4180 + Excel-safe. */
function csvCell(v){
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  v = String(v);
  if (v && '=+-@\t\r'.indexOf(v[0]) !== -1) v = '\t' + v;
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function csvDoc(rows){ return '\uFEFF' + rows.map(function (r){ return r.map(csvCell).join(','); }).join('\r\n') + '\r\n'; }

/* CSV export: one flat row per loaded night (longitudinal summary, chrono order).
   Dates via CpapDsp.fmt* (Clock Contract); every cell via csvCell so an un-computed
   metric is blank, never a fabricated 0. Oximetry columns come from the night's first
   SpO₂-bearing session and stay blank on nights with no oximeter connected. */
function exportCSV(){
  var nights = (LOADED_NIGHTS || []).slice().sort(function (a, b){ return (a.t0Ms || 0) - (b.t0Ms || 0); });
  if (!nights.length) return;
  var D = global.CpapDsp;
  var head = ['Date', 'Therapy h', 'Sessions', 'Residual AHI (/hr)', 'Obstructive (/hr)', 'Central (/hr)',
              'Median Pressure (cmH2O)', 'P95 Pressure (cmH2O)', 'Large Leak (%)', 'Median Leak (L/min)',
              'ODI (/hr)', 'T90 (%)', 'SpO2 Nadir (%)', 'SpO2 Mean (%)'];
  var rows = [head];
  nights.forEach(function (n){
    var nm = n.metrics || {};
    var s0 = (n.sessions || []).filter(function (s){ return s.oximetry && s.oximetry.available; })[0];
    var o = (s0 && s0.oximetry) || {};
    rows.push([
      D ? D.fmtDate(n.t0Ms) : '', n.therapyHours, n.nSessions,
      nm.residualAHI, nm.obstructiveIndex, nm.centralIndex,
      nm.medianPressure, nm.p95Pressure, nm.largeLeakPct, nm.medianLeak,
      o.odi, o.t90Pct, o.spo2Nadir, o.spo2Mean
    ]);
  });
  var blob = new Blob([csvDoc(rows)], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = exportName({node:'CPAPDex', t0Ms:(nights[0]&&nights[0].t0Ms), kind:'summary', ext:'csv',
    spanDays:(nights.length>1?Math.round(((nights[nights.length-1].t0Ms||0)-(nights[0].t0Ms||0))/864e5):null)});
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function (){ URL.revokeObjectURL(url); }, 1000);
}

/* wire DOM once */
function init(){
  var zone = $('dropZone'), input = $('fileInput');
  if (zone){
    zone.addEventListener('click', function (e){ if (e.target.closest('button, a, label')) return; if (input) input.click(); });
    ['dragover', 'dragenter'].forEach(function (ev){ zone.addEventListener(ev, function (e){ e.preventDefault(); zone.classList.add('drag'); }); });
    ['dragleave', 'dragend'].forEach(function (ev){ zone.addEventListener(ev, function (e){ e.preventDefault(); if (e.target === zone) zone.classList.remove('drag'); }); });
    zone.addEventListener('drop', function (e){ e.preventDefault(); zone.classList.remove('drag'); if (e.dataTransfer && e.dataTransfer.files) handleFileList(e.dataTransfer.files); });
  }
  if (input) input.addEventListener('change', function (){ if (input.files) handleFileList(input.files); });
  var demo = $('demoBtn'); if (demo) demo.addEventListener('click', function (e){ e.preventDefault(); e.stopPropagation(); loadDemo(); });
  var ex = $('exportBtn'); if (ex) ex.addEventListener('click', exportNight);
  var bj = $('btnJSON'); if (bj) bj.addEventListener('click', exportNight);
  var bc = $('btnCSV'); if (bc) bc.addEventListener('click', exportCSV);   // per-night summary table
  // "+ Add nights" — append more file-sets WITHOUT clearing the loaded history
  var addBtn = $('addNightsBtn'); if (addBtn) addBtn.addEventListener('click', function (){ if (input){ input.value = ''; input.click(); } });
  // "New" — clear all loaded nights and return to the drop zone
  var again = $('newSetBtn'); if (again) again.addEventListener('click', function (){
    LOADED_NIGHTS = []; CURRENT = null;
    if (global.CpapCoimport) global.CpapCoimport.reset();
    window._cpapReview = null; try { document.body.classList.remove('cpap-review'); } catch(_r){}   // SELF-INGEST: exit review
    var up = $('uploadCard'); if (up) up.style.display = '';
    var rv = $('resultsView'); if (rv) rv.style.display = 'none';
    var eb = $('exportBar'); if (eb) eb.classList.remove('show');
    if (input) input.value = '';
  });
  // SELF-INGEST §5 — inject the "scrub for sharing" toggle into the export bar (default OFF). JS-injected
  // so the .src.html shell (and thus buildHash) stays put; read at export time via window._cpapScrub.
  (function wireScrub(){
    if (global.CpapRender && global.CpapRender.injectSelfIngestCSS) try { global.CpapRender.injectSelfIngestCSS(); } catch(_c){}
    var bar = $('exportBar'); if (!bar || bar.querySelector('.eb-scrub')) return;
    var lbl = document.createElement('label'); lbl.className = 'eb-scrub';
    var cb = document.createElement('input'); cb.type = 'checkbox';
    cb.addEventListener('change', function (){ window._cpapScrub = !!cb.checked; });
    lbl.appendChild(cb); lbl.appendChild(document.createTextNode(' scrub for sharing'));
    bar.appendChild(lbl);
  })();
  // shared depth selector
  if (global.MetricRegistry) try { global.MetricRegistry.mountDepthSelector($('modeBar')); } catch(e){}
  if (location.hash === '#demo') setTimeout(loadDemo, 200);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

global.CpapApp = {
  groupEdfFiles: groupEdfFiles, analyzeSet: analyzeSet, mergeNights: mergeNights,
  renderResults: renderResults, renderReview: renderReview, handleFileList: handleFileList, loadDemo: loadDemo, exportNight: exportNight,
  nights: function (){ return LOADED_NIGHTS; }, current: function (){ return CURRENT; },
  review: function (){ return window._cpapReview || null; }
};

})(window);


/* ── PDF/print: render a clean, light, chrome-free page. Leverages the shipped
   light theme (a user-facing feature) + a print-only stylesheet. JS-injected so
   the .src.html skeleton — and thus buildHash + provenance fixtures — stays put.
   Mirrored verbatim across nodes (like the Clock Contract). ── */
(function(){
  if(window.__dexPrintWired) return; window.__dexPrintWired=true;
  var st=document.createElement('style');
  st.textContent='@media print{'
    +'@page{margin:12mm}'
    +'html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#fff!important;color:#0a0e12!important}'
    +'.sidebar,#exportBar,#exportBar.show,#backToTop,#themeToggle,#themeToggleBtn,.theme-toggle,#themeBtn,.mob-bar,#mobBar,.mobile-nav,.mobile-sticky-header,.mode-bar{display:none!important}'
    +'.app-shell{grid-template-columns:1fr!important}'
    +'.main-wrap,.content,.main,main,.app-main,.main-content{margin-left:0!important;max-width:100%!important}'
    +'.kpi,.metric,.chart-wrap,.chart-card,canvas,svg,figure,tr,td,th{break-inside:avoid}'
    +'table{break-inside:auto}thead{display:table-header-group}tfoot{display:table-footer-group}'
    +'}';
  (document.head||document.documentElement).appendChild(st);
  var _added=false;
  function pre(){ _added=!document.body.classList.contains('light'); if(_added) document.body.classList.add('light'); }
  function post(){ if(_added){ document.body.classList.remove('light'); _added=false; } }
  window.addEventListener('beforeprint', pre);
  window.addEventListener('afterprint', post);
  if(window.matchMedia){ try{ window.matchMedia('print').addEventListener('change', function(e){ e.matches?pre():post(); }); }catch(_){} }
})();
