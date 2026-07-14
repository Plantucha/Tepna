/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   integrator-app.js — glue: ingest (drag-drop + picker), dedupe, run fusion,
   render, export/write-back. Plain global script. No DOM construction beyond
   wiring; rendering lives in integrator-render.js.
   ════════════════════════════════════════════════════════════════════════ */
(function(){
  var D = window.IntegratorDSP, R = window.IntegratorRender, L = window.IntegratorLong;
  var $ = function(id){ return document.getElementById(id); };

  var RECS = [];          // normalized NodeRec[]
  var WARN = [];          // ingest warnings
  var FUSION = null;
  var TOL = 120;          // match tolerance seconds (configurable)
  var _longDirty = false; // longitudinal store changed since last render

  function recompute(){
    FUSION = D.runFusion(RECS, { toleranceSec: TOL });
    R.renderChips(RECS, removeAt, clearAll);
    // P8/kernel: surface any node built against a different physiology kernel as a
    // visible banner alongside ingest warnings — a silent threshold drift otherwise.
    var warnAll = WARN.slice();
    var ka = FUSION && FUSION.kernelAudit;
    if(ka && ka.mismatches && ka.mismatches.length){
      ka.mismatches.forEach(function(m){
        warnAll.push('Node '+m.node+' built against kernel '+(m.hash||'(none)')
          +', expected '+(ka.expected||'(unknown)')+' — thresholds may differ.');
      });
    }
    R.renderAll(RECS, FUSION, warnAll);
    if(L){ try { L.render(); } catch(e){} }
  }
  function removeAt(i){ RECS.splice(i,1); recompute(); }
  function clearAll(){ RECS=[]; WARN=[]; recompute(); }

  function ingestJSON(json, filename){
    // Structural conformance (precise diagnostics; ADVISORY — never blocks ingest,
    // the adapters still read by structure). Surfaces exact reasons a node export is
    // malformed instead of the generic "no events found".
    if(json && json.schema && json.schema.name==='ganglior.node-export'
       && window.CrossNightEnvelope && CrossNightEnvelope.validateNodeExport){
      try {
        var vr = CrossNightEnvelope.validateNodeExport(json);
        vr.errors.forEach(function(e){ WARN.push((filename||(json.schema&&json.schema.node)||'export')+' — '+e); });
      } catch(_){}
    }
    var res = D.normalizeFile(json, filename);
    res.warnings.forEach(function(w){ WARN.push(w); });
    if(res.recs.length){
      var dd = D.dedupeRecs(RECS, res.recs);
      dd.warns.forEach(function(w){ WARN.push(w); });
      dd.kept.forEach(function(r){ RECS.push(r); });
    }
    // ── cross-node longitudinal: absorb any ganglior.crossnight envelope ──
    // Orthogonal to fusion — a multi-session node export carries BOTH an event
    // stream (→ fusion, above) and a crossNight block (→ longitudinal store here).
    if(L){
      try {
        var li = L.ingest(json, filename);
        if(li && li.count){ WARN.push('✓ Longitudinal: absorbed '+li.rows+' day-summary row'+(li.rows===1?'':'s')+' from '+li.nodes.join(', ')+' (persisted).'); _longDirty=true; }
      } catch(e){ /* never let longitudinal break fusion ingest */ }
    }
  }

  function readFiles(fileList){
    WARN = WARN.slice(); // keep prior warnings
    var files = Array.prototype.slice.call(fileList);
    if(!files.length) return;
    var pending = files.length;
    files.forEach(function(file){
      var reader = new FileReader();
      reader.onload = function(){
        try {
          var json = JSON.parse(reader.result);
          ingestJSON(json, file.name);
        } catch(err){
          WARN.push('"'+file.name+'" — not valid JSON, skipped ('+err.message+')');
        }
        if(--pending===0) recompute();
      };
      reader.onerror = function(){ WARN.push('"'+file.name+'" — could not be read'); if(--pending===0) recompute(); };
      reader.readAsText(file);
    });
  }

  /* ── drag-drop + picker ──────────────────────────────────────────────── */
  function bindLoad(){
    var dz = $('dropZone'), input = $('fileInput');
    if(input) input.addEventListener('change', function(){ readFiles(input.files); input.value=''; });
    if(dz){
      // skip interactive children (Choose-files is now data-act="clickEl"; the synth-line
      // isolates itself) so the zone doesn't also fire input.click() — CSP-strict migration.
      dz.addEventListener('click', function(e){ if(e.target.closest('button,a,label,select,input,.synth-line')) return; if(input) input.click(); });
      ['dragenter','dragover'].forEach(function(ev){ dz.addEventListener(ev, function(e){ e.preventDefault(); dz.classList.add('drag'); }); });
      ['dragleave','dragend','drop'].forEach(function(ev){ dz.addEventListener(ev, function(e){ e.preventDefault(); dz.classList.remove('drag'); }); });
      dz.addEventListener('drop', function(e){ if(e.dataTransfer && e.dataTransfer.files) readFiles(e.dataTransfer.files); });
    }
    // also allow body-wide drop
    ['dragover','drop'].forEach(function(ev){ window.addEventListener(ev, function(e){ if(e.target.closest && e.target.closest('#dropZone')) return; e.preventDefault(); if(ev==='drop' && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) readFiles(e.dataTransfer.files); }); });
  }

  /* ── tolerance control ───────────────────────────────────────────────── */
  function bindTol(){
    var t=$('tolInput'), lbl=$('tolVal');
    if(!t) return;
    t.addEventListener('input', function(){ TOL=+t.value; if(lbl) lbl.textContent=TOL+'s'; });
    t.addEventListener('change', function(){ TOL=+t.value; if(lbl) lbl.textContent=TOL+'s'; recompute(); });
  }

  /* ── export + write-back ─────────────────────────────────────────────── */
  // CSV cell — missing(null/undefined/NaN/±Inf)→blank · real 0 preserved · RFC-4180 + Excel-formula-safe.
  function csvCell(v){
    if(v==null) return '';
    if(typeof v==='number') return Number.isFinite(v) ? String(v) : '';
    v=String(v);
    if(v && '=+-@\t\r'.indexOf(v[0])!==-1) v='\t'+v;
    return /[",\r\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v;
  }
  function csvDoc(rows){ return '\uFEFF'+rows.map(function(r){return r.map(csvCell).join(',');}).join('\r\n')+'\r\n'; }
  function download(name, obj){
    var blob = new Blob([JSON.stringify(obj,null,2)], {type:'application/json;charset=utf-8'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click();
    setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }
  function exportFusion(){
    if(!FUSION){ return; }
    var out = D.buildFusionExport(RECS, FUSION);
    // EXPORT-HYGIENE §2: name via the shared exportName() — recording-anchored to the fusion window
    // start (getUTC*), span-aware, controlled-vocab; the fusion DIGEST is the window's 'summary'. The
    // old now() fallback (new Date().toISOString() = export-click, TZ-dependent — a Clock-Contract
    // fabrication) is DROPPED → exportName yields 'undated' when the window has no start (honest).
    var _ws=FUSION.window.startMs, _we=FUSION.window.endMs;
    var _span=(_ws!=null&&_we!=null)?Math.round((_we-_ws)/864e5):null;
    download(exportName({node:'Integrator', t0Ms:(_ws!=null?_ws:null), kind:'summary', ext:'json', spanDays:_span}), out);
  }
  function copyFusion(){
    if(!FUSION) return;
    var out = D.buildFusionExport(RECS, FUSION);
    navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(out,null,2)).then(function(){
      var b=$('copyBtn'); if(b){ var t=b.textContent; b.textContent='Copied ✓'; setTimeout(function(){ b.textContent=t; },1400); }
    });
  }
  /* Findings CSV — the fusion findings table (mirrors the on-screen #findTable) as tidy
     data: one row per finding, built from FUSION.findings (not a DOM scrape) so Type /
     Confidence / Duration are clean machine-readable values, missing→blank, real 0 kept. */
  function exportCSV(){
    if(!FUSION) return;
    var head = ['Wall clock','Type','Confidence','Duration (s)','Nodes','Below chance','p(spurious)','Evidence'];
    var rows = [head];
    (FUSION.findings||[]).forEach(function(f){
      rows.push([
        f.tMs!=null ? D.fmtDateTime(f.tMs) : '',
        f.type,
        f.conf,
        (f.durSec!=null ? f.durSec : ''),
        (f.nodes||[]).join(' + '),
        (f.belowChance!=null ? f.belowChance : ''),
        (f.pSpurious!=null ? f.pSpurious : ''),
        f.note
      ]);
    });
    // findings CSV = one row per finding → 'series'; recording-anchored + span-aware (EXPORT-HYGIENE §2),
    // now() fallback dropped (honest 'undated' when the window has no start).
    var _ws=FUSION.window.startMs, _we=FUSION.window.endMs;
    var _span=(_ws!=null&&_we!=null)?Math.round((_we-_ws)/864e5):null;
    var blob = new Blob([csvDoc(rows)], {type:'text/csv;charset=utf-8;'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href=url; a.download=exportName({node:'Integrator', t0Ms:(_ws!=null?_ws:null), kind:'series', ext:'csv', spanDays:_span});
    document.body.appendChild(a); a.click();
    setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }
  /* ── unified export bar (§28 contract) ──────────────────────────────────────
     Built from JS (mirrors hrvdex-dsp.js setting #exportBar.innerHTML) so the
     canonical eb- layout ships without editing Integrator.src.html — buildHash
     stays put and the committed fusion provenance fixtures stay reproducible.
     Integrator emits a fusion digest; JSON is the full cross-node currency, and
     CSV now serializes the fusion FINDINGS table (one row per finding) for quick
     spreadsheet / AI use (§28 matrix: JSON ✓, CSV ✓ findings, PDF ✓). */
  function buildExportBar(){
    var bar = $('exportBar'); if(!bar) return;
    bar.innerHTML =
      '<span class="eb-label">Export</span>'+
      '<div class="eb-grp">'+
        '<button class="eb-btn eb-json" type="button" id="exportBtn">⬇ JSON</button>'+
        '<button class="eb-btn eb-csv" type="button" id="csvBtn">⬇ CSV</button>'+
        '<button class="eb-btn eb-pdf" type="button" id="pdfBtn">⬇ PDF</button>'+
        '<span class="eb-div"></span>'+
        '<button class="eb-btn eb-ghost" type="button" id="copyBtn">⧉ Copy JSON</button>'+
      '</div>'+
      '<span class="eb-spacer"></span>'+
      '<div class="eb-grp">'+
        '<button class="eb-btn eb-ghost" type="button" id="addFilesBtn">＋ Add files</button>'+
        '<button class="eb-btn eb-danger" type="button" id="clearAllBtn">✕ Clear</button>'+
      '</div>';
    $('exportBtn').addEventListener('click', exportFusion);
    $('csvBtn').addEventListener('click', exportCSV);
    $('copyBtn').addEventListener('click', copyFusion);
    $('pdfBtn').addEventListener('click', function(){ window.print(); });
    $('addFilesBtn').addEventListener('click', function(){ var i=$('fileInput'); if(i) i.click(); });
    $('clearAllBtn').addEventListener('click', clearAll);

    // Unify the sidebar "Export" view's action row with the SAME eb- button set
    // (was legacy .btn-export "Download fusion JSON" / .btn "Copy to clipboard").
    var viewRow = $('exportBtnMain') ? $('exportBtnMain').parentElement : null;
    if(viewRow){
      viewRow.className = 'eb-grp';
      viewRow.style.cssText = 'margin-top:16px;flex-wrap:wrap';
      viewRow.innerHTML =
        '<button class="eb-btn eb-json" type="button" id="exportBtnMain">\u2b07 JSON</button>'+
        '<button class="eb-btn eb-csv" type="button" id="csvBtnMain">\u2b07 CSV</button>'+
        '<button class="eb-btn eb-pdf" type="button" id="pdfBtnMain">\u2b07 PDF</button>'+
        '<button class="eb-btn eb-ghost" type="button" id="copyBtnMain">\u29c9 Copy JSON</button>';
      $('exportBtnMain').addEventListener('click', exportFusion);
      $('csvBtnMain').addEventListener('click', exportCSV);
      $('pdfBtnMain').addEventListener('click', function(){ window.print(); });
      $('copyBtnMain').addEventListener('click', copyFusion);
    }
  }

  /* ── load bundled sample exports from uploads/ (verification convenience) ─
     These MUST be git-tracked synthetic exports, never the author's real recordings —
     a demo that names a gitignored path 404s in every clone/deploy (CPAP-REAL-CORPUS
     -FOLLOWUPS-II §3; gate: dex-tests.js "Demo-inputs"). The two trio/ node-exports below
     are same-night (2026-06-12) synthetic ECG+Oxy, so the demo produces a real same-night
     fusion finding. */
  function bindSamples(){
    var b=$('loadSamples'); if(!b) return;
    b.addEventListener('click', function(){
      var files=['uploads/trio/2026-06-12/ECGDex_2026-06-12.node-export.json','uploads/trio/2026-06-12/OxyDex_2026-06-12.node-export.json'];
      var pending=files.length, got=0;
      files.forEach(function(path){
        fetch(path).then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); })
          .then(function(json){ ingestJSON(json, path.split('/').pop()); got++; })
          .catch(function(err){ WARN.push('Sample "'+path+'" unavailable ('+err.message+') — drag files in manually.'); })
          .finally(function(){ if(--pending===0) recompute(); });
      });
    });
  }

  /* ── synthetic patient generator (shared coherence engine · dex-patient-gen.js) ─
     Builds N nights for one patient and feeds the REAL ingest path: per-node
     ganglior.crossnight envelopes (→ longitudinal trends + cross-node couplings)
     plus a fusable last night (→ same-night fusion finding). Up to 180 days. */
  function genSynthetic(){
    if(!window.DexPatientGen || !window.SYNTH){ WARN.push('Generator unavailable (SYNTH not loaded).'); recompute(); return; }
    var r = window.DexPatientGen.fromControls('genScenario','genDays');
    if(!r) return;
    var S = window.SYNTH;
    var oxyRows=[], ecgRows=[], gluRows=[], hrvRows=[], pulseRows=[];
    r.tls.forEach(function(tl){
      var durH = tl.durSec/3600;
      var sevs = tl.events.map(function(e){ return e.severity; });
      var desN = tl.events.filter(function(e){ return e.severity>=4; }).length;
      var odi4 = +(desN/durH).toFixed(1);
      var maxDep = sevs.length ? Math.max.apply(null, sevs) : 4;
      var minSpo2 = Math.max(70, Math.round(96 - maxDep));
      var hrv = S.hrvMetrics(S.buildRR(tl));
      var rmssd = +(+hrv.rmssd).toFixed(1), sdnn = +(+hrv.sdnn).toFixed(1);
      // PLANTED coupling: glycemic variability co-moves with apnea burden (the
      // cross-node story the fusion is meant to surface). Per-night jitter so it
      // isn't a flat line. Severity (odi4) drives CV up.
      var jit = (Math.floor(tl.t0Ms/8.64e7)%5)-2;
      var gluCV = +Math.max(11, Math.min(46, 16 + odi4*0.55 + jit)).toFixed(1);
      var date = window.IntegratorDSP ? IntegratorDSP.fmtDate(tl.t0Ms) : null;
      oxyRows.push({ t0Ms:tl.t0Ms, date:date, values:{ odi4:odi4, minSpo2:minSpo2 } });
      ecgRows.push({ t0Ms:tl.t0Ms, date:date, values:{ rmssd:rmssd, sdnn:sdnn } });
      gluRows.push({ t0Ms:tl.t0Ms, date:date, values:{ glucoseCV:gluCV } });
      // Independent devices → consensus with a small honest spread (HRVDex ≈ −4%, PulseDex ≈ +5%)
      hrvRows.push({ t0Ms:tl.t0Ms, date:date, values:{ rmssd:+(rmssd*0.96).toFixed(1), sdnn:+(sdnn*1.04).toFixed(1) } });
      pulseRows.push({ t0Ms:tl.t0Ms, date:date, values:{ rmssd:+(rmssd*1.05).toFixed(1), sdnn:+(sdnn*0.97).toFixed(1) } });
    });
    // autonomic-instability slope = trend of ln(rMSSD) across nights (per night) →
    // the ECG leg the glucose⟷autonomic coupling pairs against.
    function lnSlope(rows){
      var xs=[], ys=[];
      rows.forEach(function(row,i){ var v=row.values.rmssd; if(v>0){ xs.push(i); ys.push(Math.log(v)); } });
      var m=xs.length; if(m<2) return null;
      var mx=xs.reduce(function(a,b){return a+b;},0)/m, my=ys.reduce(function(a,b){return a+b;},0)/m;
      var num=0, den=0; for(var i=0;i<m;i++){ num+=(xs[i]-mx)*(ys[i]-my); den+=(xs[i]-mx)*(xs[i]-mx); }
      return den ? +(num/den).toFixed(4) : null;
    }
    var autoSlope = lnSlope(ecgRows);
    function env(node, metrics, rows){
      return { schema:{ name:'ganglior.crossnight', version:'1.0', engineVersion:'1.0.0', node:node, generated:new Date().toISOString(), synthetic:true },
        window:{ unit:'night', count:rows.length, firstT0Ms:rows.length?rows[0].t0Ms:null, lastT0Ms:rows.length?rows[rows.length-1].t0Ms:null },
        metrics:metrics, series:rows, headline:[] };
    }
    // Evidence grade is a NODE fact resolved by IntegratorDSP.gradeFor — it mirrors
    // the node registries (gated by the shared suite's grade-mirror group) and prefers
    // a live registry object if one is loaded. See integrator-dsp.js. NO ad-hoc grades.
    var gradeFor = (D && D.gradeFor) ? D.gradeFor : function(node, id){ return 'experimental'; };
    var oxyMetrics = { odi4:{ label:'ODI-4', unit:'/h', goodDirection:'down', evidence:gradeFor('OxyDex','odi4') },
                       minSpo2:{ label:'Min SpO\u2082', unit:'%', goodDirection:'up', evidence:gradeFor('OxyDex','minSpo2') } };
    var hrvDefs = { rmssd:{ label:'rMSSD', unit:'ms', goodDirection:'up', evidence:gradeFor('ECGDex','rmssd') },
                    sdnn:{ label:'SDNN', unit:'ms', goodDirection:'up', evidence:gradeFor('ECGDex','sdnn') } };
    var gluMetrics = { glucoseCV:{ label:'Glucose CV', unit:'%', goodDirection:'down', evidence:gradeFor('GlucoDex','glucoseCV') } };
    // last night → fusable: desat⟷surge pair + whole-record HRV (3-way consensus) +
    // CGM variability (⟷ autonomic) so EVERY fusion rule has something to chew on.
    var last = r.tls[r.tls.length-1];
    var desats = last.events.filter(function(e){ return e.severity>=4; }).slice(0,60);
    // EVENT-LEXICON §1: the synthetic demo emits the canonical `desat_event` (was `spo2_desaturation`).
    var oxyEvents = desats.map(function(e){ return { tMs:e.t0Ms, impulse:'desat_event', node:'OxyDex',
      conf:+Math.min(0.95, 0.45 + e.severity/24).toFixed(2), meta:{ depth:e.severity, durSec:e.durSec } }; });
    var ecgEvents = desats.map(function(e){ return { tMs:e.t0Ms+5000, impulse:'autonomic_surge', node:'ECGDex', conf:0.7, meta:{} }; });
    var lastOdi4 = oxyRows[oxyRows.length-1].values.odi4;
    // §2 PB corroboration demo: emit OxyDex SpO₂-oscillation periodic_breathing events ONLY when
    // the night carries enough apnea burden to plausibly show PB (healthy nights stay PB-free).
    var oxyPB = [];
    if(lastOdi4 >= 5){
      var pbSrc = desats.filter(function(e,i){ return i % Math.max(1, Math.floor(desats.length/5)) === 0; }).slice(0,6);
      oxyPB = pbSrc.map(function(e){ return { tMs:e.t0Ms, impulse:'periodic_breathing', node:'OxyDex',
        conf:0.6, meta:{ cycleLen:Math.round(45+(e.severity||4)), crossings:8, windowSec:120 } }; });
      oxyEvents = oxyEvents.concat(oxyPB);
    }
    var durMin = Math.round(last.durSec/60);
    var rec = { startEpochMs:last.t0Ms, durationMin:durMin, offsetMin:null };
    var lastRmssd = ecgRows[ecgRows.length-1].values.rmssd, lastSdnn = ecgRows[ecgRows.length-1].values.sdnn;
    var lastCV = gluRows[gluRows.length-1].values.glucoseCV;
    // body-position (ACC) series so positional-apnea fusion has trunk posture to read
    // (was N/A: "No ACC / body-position series in any node export"). Deterministic +
    // supine-dominant (typical OSA) so confirmed desats cluster supine.
    var accSeed = ((last.seed||1)>>>0)||12345;
    function accRnd(){ accSeed=(accSeed*1664525+1013904223)>>>0; return accSeed/4294967296; }
    var posAcc=[]; for(var pm=0; pm<durMin; pm+=5){ var u=accRnd(); posAcc.push({ tMin:pm, position:(u<0.72?'supine':(u<0.87?'left':(u<0.98?'right':'prone'))) }); }
    var scenEl = $('genScenario'); var scenario = scenEl ? scenEl.value : (r.profile||'');
    var oxyExport = { schema:{ name:'ganglior.node-export', node:'OxyDex' }, recording:rec,
      ganglior_events:oxyEvents, crossNight:env('OxyDex', oxyMetrics, oxyRows) };
    var ecgExport = { schema:{ name:'ganglior.node-export', node:'ECGDex' }, recording:rec,
      hrv:{ time:{ rmssd:lastRmssd, sdnn:lastSdnn } },
      hrvStability:{ mean_lnRMSSD_slope:autoSlope }, acc:posAcc,
      apnea:{ cvhrIndex:+Math.min(35, Math.max(0, lastOdi4*0.8)).toFixed(1) },
      ganglior_events:ecgEvents, crossNight:env('ECGDex', hrvDefs, ecgRows) };
    var gluExport = { schema:{ name:'ganglior.node-export', node:'GlucoDex' }, recording:rec,
      glycemic:{ cv:lastCV }, variability:{ cv:lastCV },
      ganglior_events:[], crossNight:env('GlucoDex', gluMetrics, gluRows) };
    var hrvExport = { schema:{ name:'ganglior.node-export', node:'HRVDex' }, recording:rec,
      hrv:{ time:{ rmssd:+(lastRmssd*0.96).toFixed(1), sdnn:+(lastSdnn*1.04).toFixed(1) } },
      ganglior_events:[], crossNight:env('HRVDex', hrvDefs, hrvRows) };
    var pulseExport = { schema:{ name:'ganglior.node-export', node:'PulseDex' }, recording:rec,
      hrv:{ time:{ rmssd:+(lastRmssd*1.05).toFixed(1), sdnn:+(lastSdnn*0.97).toFixed(1) } },
      ganglior_events:[], crossNight:env('PulseDex', hrvDefs, pulseRows) };
    RECS=[]; WARN=[];   // fresh fusion view for the freshly generated night
    ingestJSON(oxyExport, 'OxyDex_synthetic_'+r.profile+'_'+r.days+'d.json');
    ingestJSON(ecgExport, 'ECGDex_synthetic_'+r.profile+'_'+r.days+'d.json');
    ingestJSON(gluExport, 'GlucoDex_synthetic_'+r.profile+'_'+r.days+'d.json');
    ingestJSON(hrvExport, 'HRVDex_synthetic_'+r.profile+'_'+r.days+'d.json');
    ingestJSON(pulseExport, 'PulseDex_synthetic_'+r.profile+'_'+r.days+'d.json');
    var nodesGen = ['OxyDex','ECGDex','GlucoDex','HRVDex','PulseDex'];
    // On-CPAP scenario → emit the PAP device node. Its firmware-scored RESIDUAL AHI
    // is the strongest apnea truth on the bus (_deviceScoredAuthority) → surfaces the
    // "Device-scored AHI (reference)" card, reconciled against the confirmed index.
    if(scenario==='cpap'){
      var residRows = oxyRows.map(function(row){ return { t0Ms:row.t0Ms, date:row.date, values:{ residualAHI:+Math.max(1.2, row.values.odi4+1.6).toFixed(1) } }; });
      var resid = residRows[residRows.length-1].values.residualAHI;
      // §2 PB demo: device-flow periodic-breathing % + a few device-scored PB events, scaled to
      // residual burden (0 on a well-controlled night → CPAPDex is not a PB observer).
      var cpapPbPct = Math.max(0, Math.min(30, Math.round((resid-3)*5)));
      var cpapPB = (cpapPbPct>0 ? oxyPB.slice(0,3) : []).map(function(e){ return { tMs:e.tMs+1000, impulse:'periodic_breathing', node:'CPAPDex', conf:0.8, meta:{} }; });
      var cpapExport = { schema:{ name:'ganglior.node-export', node:'CPAPDex' },
        recording:{ startEpochMs:last.t0Ms, durationMin:durMin, offsetMin:null, therapyHours:+(durMin/60*0.94).toFixed(1), sessions:[{ mode:'CPAP' }] },
        metrics:{ residualAHI:resid, centralIndex:+(resid*0.35).toFixed(1), obstructiveIndex:+(resid*0.4).toFixed(1),
                  hypopneaIndex:+(resid*0.25).toFixed(1), periodicBreathingPct:cpapPbPct, largeLeakPct:4.2, medianPressure:8.6 },
        ganglior_events:cpapPB, crossNight:env('CPAPDex', { residualAHI:{ label:'Residual AHI', unit:'/h', goodDirection:'down', evidence:gradeFor('CPAPDex','residualAHI') } }, residRows) };
      ingestJSON(cpapExport, 'CPAPDex_synthetic_'+r.profile+'_'+r.days+'d.json');
      nodesGen.push('CPAPDex');
    }
    WARN.push('\u2713 Generated '+r.days+'-day synthetic patient ('+r.label+') \u2014 '+nodesGen.join(' \u00b7 ')+'. Last night fused (apnea, positional, glucose\u27f7autonomic, 3-way HRV consensus'+(oxyPB.length?', periodic breathing':'')+(scenario==='cpap'?', device-scored AHI':'')+').');
    recompute();
    if(R && R.showView) R.showView('findings');
  }
  function bindGen(){ var b=$('genBtn'); if(b) b.addEventListener('click', genSynthetic); }

  function init(){
    R.bindNav(); bindLoad(); bindTol(); buildExportBar(); bindSamples(); bindGen();
    R.showView('load');
    // open the durable longitudinal store, then render (history survives reload)
    if(L){ L.open().then(function(){ try { L.render(); } catch(e){} }); }
    recompute();
    // theme toggle
    var tt=$('themeToggle'); if(tt) tt.addEventListener('click', function(){ document.body.classList.toggle('light'); });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
})();


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
