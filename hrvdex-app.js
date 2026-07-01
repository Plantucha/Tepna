/* ════ HRVDex · APP · INGEST · EXPORTS · GLUE (hrvdex-app.js) ───────────────────────────────────────────────
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   File ingest (drag/drop + paste), CSV/JSON exports, clear-all, progress bar,
   theme + back-to-top, and startup profile load. Loaded LAST.
   Plain global script — shares page scope with the other hrvdex-*.js files,
   exactly as in the original single-script monolith. No behavior change.
   Load order: hrvdex-dsp → hrvdex-render → hrvdex-profile → hrvdex-app.
   ════════════════════════════════════════════════════════════════════════ */

/* ===== FILE LOAD ===== */
const uploadZone = document.getElementById('uploadZone');
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag'));
uploadZone.addEventListener('drop', e => { e.preventDefault(); uploadZone.classList.remove('drag'); const fs = e.dataTransfer.files; if(fs && fs.length) Array.from(fs).forEach(processFile); });

function loadFile(e) { setProgress(10); const fs = e.target.files; if(!fs || !fs.length) return; Array.from(fs).forEach(processFile); }
function loadPasted() {
  const text = document.getElementById('pasteArea').value.trim();
  if(!text){ alert('Please paste CSV content first.'); return; }
  document.getElementById('pasteFallback').style.display='none';
  // Paste is an import too → additive (a leading { or [ means a pasted ECGDex/Ganglior JSON).
  const head = text.replace(/^\uFEFF/,'').trimStart();
  if((head[0]==='{' || head[0]==='[') && typeof ingestGangliorJSON==='function') ingestGangliorJSON(text, {});
  else parseCSV(text, {});
}

// ── Synthetic patient generator (shared coherence engine · dex-patient-gen.js) ──
// HRV is multi-day by nature → render N nights for one patient as a Welltory CSV.
function genSyntheticPatient(){
  if(!window.DexPatientGen || !window.SYNTH){ return; }
  const r = DexPatientGen.fromControls('genScenario','genDays');
  if(!r) return;
  document.getElementById('pasteArea').value = SYNTH.renderHRVAll(r.tls);
  // Generating a fresh synthetic patient REPLACES the table (a new subject, not more data).
  parseCSV(document.getElementById('pasteArea').value, { replace:true });
}
// Wire the generate button (markup sits above this script, so it already exists).
(function(){ const b=document.getElementById('genBtn'); if(b) b.addEventListener('click', genSyntheticPatient); })();

// Imports are additive and accept BOTH a Welltory-style CSV and an ECGDex / Ganglior
// JSON export (single or multiRecording). Detection is by extension + first non-BOM char.
function processFile(file) {
  if(!file) return;
  const reader = new FileReader();
  const name = (file.name||'').toLowerCase();
  reader.onload = ev => {
    const text = ev.target.result || '';
    const head = text.replace(/^\uFEFF/,'').trimStart();
    const looksJSON = name.endsWith('.json') || head[0]==='{' || head[0]==='[';
    if(looksJSON && typeof ingestGangliorJSON==='function') ingestGangliorJSON(text, {});
    else parseCSV(text, {});
    try{ var fi=document.getElementById('fileInput'); if(fi) fi.value=''; }catch(_){}   // allow re-adding the same file
  };
  reader.readAsText(file);
}


/* ===== CSV TOOLKIT (mirrored per node; null≠0, RFC-4180, Excel-safe) ===== */
// missing(null/undefined/NaN/±Inf)→blank · real 0 preserved · formula-injection guarded.
function csvCell(v){
  if(v==null) return '';
  if(typeof v==='number') return Number.isFinite(v) ? String(v) : '';
  v=String(v);
  if(v && '=+-@\t\r'.indexOf(v[0])!==-1) v='\t'+v;
  return /[",\r\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v;
}
function csvDoc(rows){ return '\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n'; }

/* ===== EXPORT CSV ===== */
function exportCSV(){
  const rows = getFilteredRows();
  const keys = TABLE_COLS.filter(c=>c.key!=='_date').map(c=>c.key);
  const out = [['Date', ...TABLE_COLS.filter(c=>c.key!=='_date').map(c=>c.label)]];
  rows.forEach(r=>{
    const date = r._date instanceof Date ? r._date.toISOString().split('T')[0] : '';
    // keep 4-dp precision for finite numbers; missing→blank, real 0→"0" (csvCell)
    const vals = keys.map(k=>{ const v=r[k]; return (typeof v==='number'&&isFinite(v)) ? +v.toFixed(4) : v; });
    out.push([date, ...vals]);
  });
  // Span-aware filename (EXPORT-HYGIENE §2.4): CSV/JSONL export the dashboard WINDOW view, so the name
  // carries first-night + Nd span, not a single misleading export-click HHMM (EXPORT-HYGIENE-FOLLOWUPS §1).
  const _tms = rows.map(r=>r._tMs).filter(v=>isFinite(v));
  const _aT0 = _tms.length ? Math.min.apply(null,_tms) : null;
  const _aSpan = _tms.length>1 ? Math.round((Math.max.apply(null,_tms)-Math.min.apply(null,_tms))/864e5) : null;
  const blob = new Blob([csvDoc(out)], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = exportName({node:'HRVDex',t0Ms:_aT0,kind:'summary',ext:'csv',spanDays:_aSpan});
  a.click();
}

// Export download FILENAMES come from the shared dex-export.js exportName() — recording-anchored,
// viewer-TZ-independent, span-aware, controlled-vocab (EXPORT-HYGIENE §2). The old local-clock
// _exportTs() (== _hrvTs(); new Date()+LOCAL getters = export-click wall-clock) is DELETED.

// JSONL export — one JSON object per measurement (AI-friendly, like OxyDex)
function exportJSONL(){
  const rows = getFilteredRows();
  const keys = TABLE_COLS.filter(c=>c.key!=='_date').map(c=>c.key);
  const lines = rows.map(function(r){
    const o = { date: r._date instanceof Date ? r._date.toISOString().split('T')[0] : null };
    keys.forEach(function(k){ var v=r[k]; o[k] = (v===undefined||(typeof v==='number'&&isNaN(v)))?null:v; });
    return o;
  });
  // per-measurement ARRAY (multi-day window) → 'series'; span-aware name like the CSV view.
  const _tms = rows.map(r=>r._tMs).filter(v=>isFinite(v));
  const _aT0 = _tms.length ? Math.min.apply(null,_tms) : null;
  const _aSpan = _tms.length>1 ? Math.round((Math.max.apply(null,_tms)-Math.min.apply(null,_tms))/864e5) : null;
  const blob = new Blob([JSON.stringify(lines,null,2)], {type:'application/json;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = exportName({node:'HRVDex',t0Ms:_aT0,kind:'series',ext:'json',spanDays:_aSpan});
  a.click();
}

// ─── GANGLIOR BUS EMIT SHIM (Phase 0 → Phase 9) ───────────────────────────────
// HRVDex per-measurement rows → a ganglior.node-export the Integrator fuses as a
// first-class node. Phase-9 (SIGNAL-ADAPTER-FOLLOWUPS §4): the event set + envelope
// are now built by the SHARED hrvBuildNodeExport (hrvdex-dsp.js) that HRVDex.compute
// ALSO uses — so a Unifier/OverDex summary export is byte-identical to this one.
function exportGanglior(){
  // SIGNAL-ADAPTER-FOLLOWUPS-IX §1: the Ganglior BUS export carries the FULL ingested recording
  // (every accumulated measurement, full precision) — NOT the dashboard's getFilteredRows() VIEW,
  // which defaults to the last windowDays (7) + optional morning-only. The window is a HUMAN view
  // (the CSV/JSONL exports keep it); the machine bus export must be complete so the Integrator /
  // Data Unifier fuse the SAME recording the headless HRVDex.compute({text}) path emits — otherwise
  // a >7-day Welltory file silently fused only its last 7 days when exported from the app.
  const rows = ((typeof allRows!=='undefined' && Array.isArray(allRows)) ? allRows : []);
  if(!rows.length){ if(typeof setStatus==='function') setStatus('No measurements loaded.'); return; }
  const out = hrvBuildNodeExport(rows.filter(r=>isFinite(r._tMs)), { kernel:(window.DexKernel||null) });
  const blob = new Blob([JSON.stringify(out,null,2)], {type:'application/json;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  // ganglior export covers the FULL recording — anchor + span come from its OWN computed recording block.
  a.download = exportName({node:'HRVDex',t0Ms:out.recording.startEpochMs,kind:'ganglior',ext:'json',spanDays:out.recording.spanDays});
  a.click();
  if(typeof setStatus==='function') setStatus('✅ Ganglior bus export — '+out.ganglior_events.length+' events from '+out.recording.measurements+' measurements. Drop into Integrator to fuse.');
}

// Clear all accumulated data + wipe the saved history mirror, then return to upload
function clearAll(){
  if(!confirm('Clear all accumulated measurements and wipe the saved history from this browser? This cannot be undone.')) return;
  allRows = [];
  try { localStorage.removeItem(typeof HRV_STORE_KEY!=='undefined' ? HRV_STORE_KEY : 'hrvdex_rows_v1'); } catch(e){}
  var mu=document.getElementById('mainUI');     if(mu) mu.style.display='none';
  var pp=document.getElementById('profilePanel'); if(pp) pp.style.display='none';
  var uz=document.getElementById('uploadZone'); if(uz) uz.style.display='';
  var es=document.getElementById('emptyState'); if(es) es.style.display='';
  var eb=document.getElementById('exportBar');  if(eb){ eb.classList.remove('show'); eb.style.display='none'; }
  window.scrollTo({top:0,behavior:'smooth'});
}

// Load saved profile + restore the accumulated measurement history on startup.
// NB: in the bundled build the app scripts are injected AFTER DOMContentLoaded has
// already fired, so a DOMContentLoaded listener would never run — invoke directly
// (this script sits at end of <body>, so the DOM is already parsed) and only fall
// back to the event on the off chance the DOM is still loading.
function _hrvInit(){
  loadProfile();
  // Enable multi-file selection without touching the .src.html skeleton (keeps buildHash stable).
  try{ var fi=document.getElementById('fileInput'); if(fi) fi.multiple = true; }catch(_){}
  try{ if(typeof restoreHRVRows==='function') restoreHRVRows(); }catch(e){}
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _hrvInit);
else _hrvInit();


// ── Progress bar ───────────────────────────────────────────────
function setProgress(pct){
  var pw = document.getElementById('progressWrap');
  var pb = document.getElementById('progressBar');
  if(!pw || !pb) return;
  pw.style.display = 'block';
  pb.style.width = pct + '%';
  if(pct >= 100) setTimeout(function(){ pw.style.display = 'none'; pw.classList.remove('show'); }, 700);
}

// ── Light / dark theme toggle ──────────────────────────────────
(function(){
  var STORAGE_KEY = 'welltory_theme';
  var icon  = function(){ return document.getElementById('themeIcon');  };
  var label = function(){ return document.getElementById('themeLabel'); };

  function applyTheme(theme){
    if(theme === 'light'){
      document.body.classList.add('light');
      if(icon())  icon().textContent  = '🌙';
      if(label()) label().textContent = 'Dark';
    } else {
      document.body.classList.remove('light');
      if(icon())  icon().textContent  = '☀️';
      if(label()) label().textContent = 'Light';
    }
    try { localStorage.setItem(STORAGE_KEY, theme); } catch(e){}
  }

  window.toggleTheme = function(){
    applyTheme(document.body.classList.contains('light') ? 'dark' : 'light');
  };

  // Restore saved preference
  var saved = 'dark';
  try { saved = localStorage.getItem(STORAGE_KEY) || 'dark'; } catch(e){}
  applyTheme(saved);
})();

// ── Back to top button visibility ──────────────────────────────
(function(){
  var btn = document.getElementById('backToTop');
  if(!btn) return;
  var visible = false;
  window.addEventListener('scroll', function(){
    var should = window.scrollY > 300;
    if(should !== visible){
      visible = should;
      btn.style.opacity  = visible ? '1' : '0';
      btn.style.pointerEvents = visible ? 'auto' : 'none';
    }
  }, { passive:true });
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
