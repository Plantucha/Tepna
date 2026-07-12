/* ════ HRVDex · DSP & METRICS (hrvdex-dsp.js) ───────────────────────────────────────────────
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   Shared data state, Welltory CSV parsing, the derived-metric engine
   (computeDerived), stats helpers, row filtering, and the cardiovascular
   research math (HTN pattern / CAMQ / MAP). No DOM mutation.
   Plain global script — shares page scope with the other hrvdex-*.js files,
   exactly as in the original single-script monolith. No behavior change.
   Load order: hrvdex-dsp → hrvdex-render → hrvdex-profile → hrvdex-app.
   ════════════════════════════════════════════════════════════════════════ */

/* ════ NAMESPACED BUILD (SIGNAL-ADAPTER-FOLLOWUPS §3) — see pulsedex-dsp.js head.
   IIFE-wrapped so the bare helpers (parseCSV, parseTimestamp, mean, std …) stay
   closure-local and don't collide when the Unifier/OverDex co-load all DSPs in one
   realm (root.__DEX_NAMESPACED__ set → no bare spray, only root.HRVDex). App
   back-compat: bare re-export below when the flag is unset; mutable cross-file
   state (allRows/windowDays/charts, written by hrvdex-app.js) is accessor-proxied. */
;(function (root) {

/* ===== GLOBALS ===== */
let allRows = [];
let windowDays = 7;
let charts = {};
// AGE is read dynamically inside computeDerived via getProfile().age


/* ════ CANONICAL CLOCK · CLOCK-UNIFY (duplicated locally per app) ═══════════
   tMs = floating wall-clock ms: the recording's LOCAL civil time encoded as if
   it were UTC — Date.UTC(y,mo-1,d,h,mi,s). ALWAYS read back via getUTC* getters
   (or toLocale*({timeZone:'UTC'})). Viewer-timezone-independent.
   parseTimestamp(raw,opts) → { tMs, offsetMin } | null. See CLOCK-UNIFY-BRIEF.md §1. */
/* ── §1 CLOCK CONTRACT — single-sourced in clock.js (A5, owner-ratified 2026-07-03;
   OWN-THE-BUILD-FOLLOWUPS §3). The former verbatim mirror block lived here; clock.js now
   carries THE canonical tzOffset + _ckP2/_ckNumEpoch/_ckZoneMin/_ckDMY + parseTimestamp and
   loads BEFORE this file in every
   host + bundle (dex-coload.js / *.src.html). Local aliases keep every internal call site
   and the back-compat re-export tail byte-compatible. ── */
var tzOffset = DexClock.tzOffset, _ckP2 = DexClock._ckP2, _ckNumEpoch = DexClock._ckNumEpoch,
    _ckZoneMin = DexClock._ckZoneMin, _ckDMY = DexClock._ckDMY, parseTimestamp = DexClock.parseTimestamp;
// Display — ALWAYS UTC getters (tMs is floating wall-clock)
function fmtClock(ms){ var d=new Date(ms); return _ckP2(d.getUTCHours())+':'+_ckP2(d.getUTCMinutes()); }
function fmtDate(ms){ var d=new Date(ms); return d.getUTCFullYear()+'-'+_ckP2(d.getUTCMonth()+1)+'-'+_ckP2(d.getUTCDate()); }
function fmtDateTime(ms){ return fmtDate(ms)+' '+fmtClock(ms); }
function utcDayKey(ms){ var d=new Date(ms); return d.getUTCFullYear()+'-'+(d.getUTCMonth()+1)+'-'+d.getUTCDate(); }


// PURE summary-CSV parser (Phase-9, SIGNAL-ADAPTER-FOLLOWUPS §4): READING split from
// COMMITTING. Returns the parsed per-measurement rows ({_tMs, _rmssd, _sdnn, …}) with
// NO DOM / localStorage / global mutation, so the welltory-summary adapter + HRVDex.compute
// run it in an isolation host. parseCSV() keeps its old behavior by committing the result.
// DEEP-AUDIT 2026-07-01 Finding 1: an absent/blank TRANSPARENT cell is ABSENCE, not a value.
// '' / undefined / non-finite → null (never a fabricated 0 — a guess in a number's clothes);
// a real numeric string (incl. '0') parses to its number. Used for the objective HRV columns;
// the subjective Welltory black-box columns deliberately keep ||0 (see _hasSubj presence gate).
function numOrNull(cell){
  if(cell == null) return null;
  var s = String(cell).trim();
  if(!s) return null;
  var v = parseFloat(s);
  return isFinite(v) ? v : null;
}
/* First PRESENT alias wins; absent everywhere ⇒ null (never a real-looking 0). The `a || b || 0`
   idiom this replaces conflated three different things — "not in this file", "blank cell", and "the
   vendor really scored 0" — and stored the last one for all three. DEEP-AUDIT-FOLLOWUPS §B3. */
function _firstNum(){
  for(var i=0;i<arguments.length;i++){
    var v = numOrNull(arguments[i]);
    if(v != null) return v;
  }
  return null;
}
function _hrvParseSummaryRows(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/\r/,''));
  const rows = [];
  for(let i=1;i<lines.length;i++){
    const cells = lines[i].split(',');
    if(cells.length < 5) continue;
    const r = {};
    headers.forEach((h,idx) => { r[h] = cells[idx] ? cells[idx].trim().replace(/\r/,'') : ''; });
    // CLOCK-UNIFY: floating wall-clock ms is the source of truth. _date is a derived
    // compat Date, ALWAYS read back with getUTC* / {timeZone:'UTC'}.
    var _rawD = (r['Date']||'').trim();
    var _rawT = (r['Time']||'').trim();
    var _combined = (_rawT && !/\d{1,2}:\d{2}/.test(_rawD)) ? (_rawD+' '+_rawT).trim() : (_rawD||_rawT);
    var _ts = parseTimestamp(_combined, {preferDMY:true});
    r._tMs = _ts ? _ts.tMs : NaN;
    r._offsetMin = _ts ? _ts.offsetMin : null;
    r._date = isFinite(r._tMs) ? new Date(r._tMs) : null;
    // TRANSPARENT (objective) HRV columns → numOrNull: a blank/absent core cell stays null, so a
    // partial Welltory row never fabricates a 0 that would pollute a rolling baseline (Finding 1).
    r._hr = numOrNull(r['Measurement HR']||r['HR']);
    r._meanRR = numOrNull(r['Mean RR']);
    r._sdnn = numOrNull(r['SDNN']);
    r._rmssd = numOrNull(r['rMSSD']);
    r._mxdmn = numOrNull(r['MxDMn']);
    r._pnn50 = numOrNull(r['pNN50']);
    r._amo50 = numOrNull(r['AMo50']);
    r._mode = numOrNull(r['Mode']||r['Mode RR']);
    r._totalPow = numOrNull(r['Total power']||r['Total Power']);
    r._hf = numOrNull(r['HF']);
    r._lf = numOrNull(r['LF']);
    r._vlf = numOrNull(r['VLF']);
    // SUBJECTIVE Welltory black-box columns KEEP ||0: computeDerived's _hasSubj gate relies on the
    // six moving as an all-or-none 0-seed group (WELLTORY-COMPOSITES quarantine); migrating them to
    // null is a separate decision. _hrv = Welltory's proprietary black-box HRV Score (not transparent).
    // DEEP-AUDIT-FOLLOWUPS §B3 — the `||0` siblings of the HRV Score. Each of these turned an ABSENT
    // vendor column into a real-looking 0, exactly as `_hrv` did (§21). None is a hero today, so none
    // was proven to mis-state a surfaced number — which is why they were left rather than changed
    // blind. They are fixed now for the same reason `_hrv` was: absence is not zero, and the safety of
    // every downstream composite currently rests on the coincidence that a real subjective score is
    // never exactly 0. The `_hasSubj` / `> 0` presence gates read `null > 0` as false, so the honest
    // seed changes nothing about which composites fire — it just stops the LIE being stored.
    r._stress = _firstNum(r['Stress(HRV)'], r['Stress']);
    r._energy = _firstNum(r['Energy(HRV)'], r['Energy']);
    r._focus = _firstNum(r['Focus']);
    r._sns = _firstNum(r['ANS balance(SNS)'], r['SNS']);
    r._psns = _firstNum(r['ANS balance(PSNS)'], r['PSNS']);
    r._coherence = _firstNum(r['Coherence index'], r['Coherence']);
    // DEEP-AUDIT §21 — `||0` turned an ABSENT vendor score into a real-looking 0, which the hero
    // rendered as a genuine reading ("0 · Strained · Prioritize rest") for a file that simply never
    // carried the column. Absence is null; the renderer already prints '—' for null.
    r._hrv = numOrNull(r['HRV Score'] != null && String(r['HRV Score']).trim() !== '' ? r['HRV Score'] : r['HRV']);
    r._cv = numOrNull(r['CV']);
    if(isFinite(r._tMs)) rows.push(r);
  }
  return rows;
}
function parseCSV(text, opts) {
  return commitRows(_hrvParseSummaryRows(text), opts || {});
}

/* ════ ADDITIVE INGEST · MERGE / DEDUP / PERSIST (additive-import) ════════════
   Imports are ADDITIVE: every CSV/JSON load APPENDS to allRows so HRVDex builds a
   multi-day table across many files (and multiple measurements per day). A row is
   skipped only when an identical measurement (same floating tMs AND same metric
   values) is already present — re-importing the same file is a clean no-op. Pass
   {replace:true} to wipe first (synthetic generator / restore). The merged table
   is mirrored to localStorage so the accumulated history survives reload; the
   Clear button wipes both memory and that mirror. */
const HRV_STORE_KEY = 'hrvdex_rows_v1';
// Canonical numeric payload of a measurement row (everything computeDerived/render reads).
const HRV_SEED_FIELDS = ['_hr','_meanRR','_sdnn','_rmssd','_mxdmn','_pnn50','_amo50','_mode',
  '_totalPow','_hf','_lf','_vlf','_stress','_energy','_focus','_sns','_psns','_coherence','_hrv','_cv'];
function _hrvNum(v){ return (typeof v==='number' && isFinite(v)) ? Math.round(v*1000)/1000 : ''; }
// Identity = floating tMs + the core metric tuple → distinct same-minute sessions both survive,
// only true value-duplicates collapse ("skip if the values of the measurement are duplicate").
function _hrvSig(r){
  return [Math.round(r._tMs), _hrvNum(r._hr), _hrvNum(r._meanRR), _hrvNum(r._sdnn),
          _hrvNum(r._rmssd), _hrvNum(r._pnn50), _hrvNum(r._hf), _hrvNum(r._lf),
          _hrvNum(r._vlf), _hrvNum(r._stress)].join('|');
}
function _seedFromRow(r){
  const s = { tMs:r._tMs, offsetMin:(r._offsetMin==null?null:r._offsetMin) };
  // Preserve absence through persistence: a null transparent field round-trips as null, NOT a
  // fabricated 0 (Finding 1). Subjective fields are parsed ||0 so they stay finite (0) → unchanged.
  HRV_SEED_FIELDS.forEach(k => { const v=r[k]; s[k]= (typeof v==='number'&&isFinite(v))?v:null; });
  return s;
}
function _rowFromSeed(s){
  const r = {};
  r._tMs = +s.tMs;
  r._offsetMin = (s.offsetMin==null?null:s.offsetMin);
  r._date = isFinite(r._tMs) ? new Date(r._tMs) : null;
  HRV_SEED_FIELDS.forEach(k => { r[k] = (typeof s[k]==='number'&&isFinite(s[k]))?s[k]:null; });
  return r;
}
function persistHRVRows(){
  if(!allRows || !allRows.length){ try{ localStorage.removeItem(HRV_STORE_KEY); }catch(e){} return; }
  const seeds = allRows.map(_seedFromRow);
  try{
    localStorage.setItem(HRV_STORE_KEY, JSON.stringify(seeds));
    return;
  }catch(e){
    // Quota / storage disabled. Don't fail SILENTLY (FOLLOWUP-FINDINGS P5.2): the
    // "missing → visible, never fabricated" rule applies to the saved mirror too. Keep
    // the most-recent measurements that DO fit (halving the tail until it persists) and
    // tell the user the mirror was capped. In-memory accumulation this session is
    // unaffected either way.
    let kept = seeds;
    while(kept.length > 1){
      kept = kept.slice(-Math.max(1, Math.floor(kept.length/2)));   // drop the oldest half
      try{
        localStorage.setItem(HRV_STORE_KEY, JSON.stringify(kept));
        if(typeof setStatus==='function') setStatus('⚠ Saved history capped to the most recent '+kept.length+' of '+seeds.length+' measurements — browser storage is full. The full table is kept for this session only.');
        return;
      }catch(_){ /* still too big — halve again */ }
    }
    if(typeof setStatus==='function') setStatus('⚠ Could not save history to this browser (storage full or disabled). Your data is kept for this session only.');
  }
}
function restoreHRVRows(){
  let seeds = null;
  try{ const raw = localStorage.getItem(HRV_STORE_KEY); if(raw) seeds = JSON.parse(raw); }catch(e){ seeds = null; }
  if(!Array.isArray(seeds) || !seeds.length) return false;
  const rows = seeds.map(_rowFromSeed).filter(r=>isFinite(r._tMs));
  if(!rows.length) return false;
  commitRows(rows, { replace:true, restored:true });
  return true;
}

// Shared commit: dedup-merge newRows into allRows, sort, recompute, persist, render.
function commitRows(newRows, opts){
  opts = opts || {};
  newRows = (newRows||[]).filter(r=>isFinite(r._tMs));
  if(opts.replace) allRows = [];
  const seen = new Set(allRows.map(_hrvSig));
  let added = 0, dup = 0;
  newRows.forEach(r => {
    const sig = _hrvSig(r);
    if(seen.has(sig)){ dup++; return; }
    seen.add(sig); allRows.push(r); added++;
  });
  if(!allRows.length){
    if(typeof setStatus==='function') setStatus('⚠ No valid measurements found in that file.');
    return;
  }
  allRows.sort((a,b) => a._tMs - b._tMs);
  inferFromData();   // v2.9: infer profile first so computeDerived uses real age
  computeDerived();
  persistHRVRows();   // mirror the accumulated table so it survives reload
  setProgress(100);
  if(typeof setStatus==='function'){
    const span = fmtDate(allRows[0]._tMs)+' – '+fmtDate(allRows[allRows.length-1]._tMs);
    if(opts.restored){
      setStatus('↻ Restored '+allRows.length+' measurements from your last session ('+span+'). Import more — they accumulate.');
    } else {
      const skip = dup ? ' · '+dup+' duplicate'+(dup===1?'':'s')+' skipped' : '';
      setStatus('✅ Added '+added+' measurement'+(added===1?'':'s')+skip+' — '+allRows.length+' total · '+span);
    }
  }
  document.getElementById('uploadZone').style.display='none';
  document.getElementById('emptyState').style.display='none';
  document.getElementById('mainUI').style.display='block';
  var _pp=document.getElementById('profilePanel'); if(_pp) _pp.style.display='block';
  _hrvRefreshChrome();
  rerender();
}

// Export sticky bar + profile auto-pills + sidebar data card (shared by every commit).
function _hrvRefreshChrome(){
  (function(){
    var eb = document.getElementById('exportBar');
    if(eb){
      eb.innerHTML =
        '<span class="eb-label">Export</span>' +
        '<div class="eb-grp">' +
          '<button class="eb-btn eb-json" type="button" data-act="exportJSONL">⬇ JSON</button>' +
          '<button class="eb-btn eb-csv" type="button" data-act="exportCSV">⬇ CSV</button>' +
          '<button class="eb-btn eb-pdf" type="button" data-act="print">⬇ PDF</button>' +
        '</div>' +
        // SIGNAL-ADAPTER-FOLLOWUPS-X §2: visible scope hint (filled by _hrvUpdateExportHint).
        // Inline-styled so no .src.html <style> edit is needed → buildHash stays put.
        '<span class="eb-hint" id="ebScopeHint" style="font-size:10.5px;font-weight:600;color:var(--text4);align-self:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0"></span>' +
        '<span class="eb-spacer"></span>' +
        '<div class="eb-grp">' +
          '<button class="eb-btn eb-ghost" type="button" data-act="clickEl" data-target="fileInput">＋ Add files</button>' +
          '<button class="eb-btn eb-danger" type="button" data-act="clearAll" title="Wipe every accumulated measurement and the saved history in this browser">✕ Clear saved history</button>' +
        '</div>';
      eb.classList.add('show');
      _hrvUpdateExportHint();
    }
    var pat = document.getElementById('profileAutoText');
    if(pat && allRows && allRows.length){
      const fmt = ms => new Date(ms).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit',timeZone:'UTC'});
      const pills = [
        allRows.length + ' measurements over ' + (Math.round((allRows[allRows.length-1]._tMs - allRows[0]._tMs)/(864e5))+1) + ' days',
        fmt(allRows[0]._tMs) + ' – ' + fmt(allRows[allRows.length-1]._tMs)
      ];
      // ANS-age auto-pill REMOVED 2026-06-23 (DEX-METRIC-REMOVAL-AUDIT 🔴).
      pat.innerHTML = pills.map(p => '<span class="auto-pill">'+p+'</span>').join('');
    }
  })();
  (function(){
    var sdc=document.getElementById('sidebarDataCard');
    var sdi=document.getElementById('sidebarDataInfo');
    if(sdc&&sdi&&allRows&&allRows.length){
      sdc.style.display='block';
      sdi.innerHTML=allRows.length+' sessions &bull; 85 metrics<br>'+
        (allRows[0] && fmtDate(allRows[0]._tMs)+' &rarr; '+fmtDate(allRows[allRows.length-1]._tMs));
    }
  })();
}

/* ════ ECGDex / Ganglior JSON INGEST (older ECGDex export → HRVDex rows) ═══════
   Accepts a ganglior.node-export envelope (node:"ECGDex") — single, the
   multiRecording {recordings:[…]} array, or a bare array of envelopes — and maps
   each recording's HRV summary to one additive HRVDex measurement row. Many days
   (and multiple sessions per day) land in one import; the dedup keeps re-imports
   idempotent. Welltory-app-only subjective metrics (Stress/Energy/Coherence) have
   no ECG equivalent → left NULL, so their derived cards read '—'. */
function _envToSeed(env){
  if(!env || typeof env!=='object') return null;
  const rec = env.recording||{}, hrv = env.hrv||{};
  const tm = hrv.time||{}, fq = hrv.frequency||{};
  const tMs = (rec.startEpochMs!=null && isFinite(rec.startEpochMs)) ? +rec.startEpochMs : NaN;
  if(!isFinite(tMs)) return null;
  /* DEEP-AUDIT-FOLLOWUPS §B2 — absence seeds to NULL, not 0. This used to map every missing field to
     `0`, which is what collapsed HRVDex's n.u. denominator to an epsilon in §3 (`_totalPow − _vlf`
     → `0 − 0` → the `|| 0.001` fallback → HF n.u. = 125,000,000 %). The §3 presence gates made that
     harmless — but only because a real band power is never EXACTLY 0, i.e. the safety rested on a
     coincidence of physiology rather than on the code being right. `null > 0` is false, so every
     existing gate reads identically; the difference is that an absent value is now stored as absent. */
  const n = v => (typeof v==='number' && isFinite(v)) ? v : null;
  // Prefer whole-record SDNN/RMSSD for cross-node comparability (ECGDex's own guidance).
  const sdnn  = n(tm.wholeRecordSDNN  != null ? tm.wholeRecordSDNN  : tm.sdnn);
  const rmssd = n(tm.wholeRecordRMSSD != null ? tm.wholeRecordRMSSD : tm.rmssd);
  return {
    tMs, offsetMin:(rec.offsetMin==null?null:rec.offsetMin),
    _hr:n(tm.hr), _meanRR:n(tm.meanRR), _sdnn:sdnn, _rmssd:rmssd, _mxdmn:n(tm.mxDMn),
    _pnn50:n(tm.pnn50), _amo50:n(tm.amo50), _mode:n(tm.mode),
    _totalPow:n(fq.totalPower), _hf:n(fq.hf), _lf:n(fq.lf), _vlf:n(fq.vlf),
    // Welltory-app-only subjective scores have no ECG equivalent — they are ABSENT here, not zero (§B2).
    _stress:null, _energy:null, _focus:null, _sns:null, _psns:null, _coherence:null,
    _hrv:n(env.personalization && env.personalization.ansReadinessScore), _cv:n(tm.cv)
  };
}
function ingestGangliorJSON(text, opts){
  let data;
  try{ data = JSON.parse(text); }
  catch(e){ if(typeof setStatus==='function') setStatus('⚠ Could not read that file as CSV or JSON.'); return; }
  let envs = [];
  if(Array.isArray(data)) envs = data;                       // bare array of envelopes
  else if(data && Array.isArray(data.recordings)) envs = data.recordings;  // multiRecording payload
  else if(data && (data.recording || data.hrv)) envs = [data];            // single envelope
  const seeds = envs.map(_envToSeed).filter(Boolean);
  if(!seeds.length){
    if(typeof setStatus==='function') setStatus('⚠ No ECGDex/Ganglior HRV recordings found in that JSON (need recording.startEpochMs + hrv.time).');
    return;
  }
  const rows = seeds.map(_rowFromSeed).filter(r=>isFinite(r._tMs));
  commitRows(rows, opts || {});
}


/* computeDerived(rowsArg?) — derives every d_* column IN PLACE on `rowsArg`, defaulting to the module's
   allRows (so every existing caller is byte-unchanged). The optional argument makes the derivation a PURE,
   headless surface the test runners can drive on a synthetic row without touching app state — exposed as
   HRVDex.derive() below, which is how the §3/§4 presence-gate regression legs reach these columns. */
function computeDerived(rowsArg) {
  // Cache profile ONCE before the loop — avoids 4× DOM reads per row.
  // getProfile() lives in hrvdex-profile.js (a UI module). Guard it so the derivation runs HEADLESS:
  // with no profile the profile-dependent columns (d_bap, d_vo2_*) fall to NaN — which is the honest
  // answer when age/sex/BP were never supplied — instead of throwing and taking the whole row with them.
  const _p = (typeof getProfile === 'function') ? getProfile() : {};
  const _rows = rowsArg || allRows;
  _rows.forEach((r,i,arr) => {
    // SIGNAL-ADAPTER-FOLLOWUPS-V §1: ONE predicate for "the Welltory black-box subjective
    // inputs are actually present (>0)". On a real summary file the six move as a group
    // (all present); on a raw / ECGDex-ingest recording they are all seed-0 together. Every
    // composite FED by a subjective score must gate on this so a raw recording renders —
    // (NaN), never a fabricated 0 (§8 #2 "a guess in the clothes of a number"). The already-
    // gated composites below (d_ans_load/d_incoherent_stress/d_abs/d_efc/d_crs/d_welfare) use
    // equivalent per-metric subsets — value-identical to _hasSubj since the six are all-or-none.
    const _hasSubj = (r._stress > 0 && r._energy > 0 && r._focus > 0 && r._coherence > 0 && r._sns > 0 && r._psns > 0);
    // Time-domain
    r.d_cv_calc = r._sdnn && r._meanRR ? (r._sdnn / r._meanRR * 100) : NaN;
    r.d_rmssd_sdnn = r._sdnn ? r._rmssd / r._sdnn : NaN;
    r.d_se_div = _hasSubj ? Math.abs(r._stress - r._energy) : NaN;
    r.d_lnrmssd = r._rmssd > 0 ? Math.log(r._rmssd) : NaN;
    // Baevsky SI — Mode/MxDMn guarded to SECONDS via the SAME DexUnits.guardBaevsky /
    // RR_MS_THRESHOLD the welltory-summary adapter uses (single-source; do NOT fork the
    // threshold). A ms-unit vendor export silently mis-scaled d_si by up to 10⁶× here before
    // (divides by BOTH Mode·MxDMn) — SIGNAL-ADAPTER-AND-FRONTIER §6/§8 #1, -III §1. Falls back
    // to the original unguarded math ONLY if quantity.js isn't loaded (DexUnits is canonical).
    var _baev = (typeof DexUnits !== 'undefined' && DexUnits && DexUnits.guardBaevsky)
              ? DexUnits.guardBaevsky(r._mode, r._mxdmn) : null;
    if(_baev){
      var _si = (r._amo50 && _baev.modeS && _baev.mxdmnS) ? DexUnits.baevskySI(r._amo50, _baev.modeS, _baev.mxdmnS) : null;
      r.d_si = (_si == null) ? NaN : _si;
      r.d_si_ms = _baev.assumedMs;        // ms-scale Mode/MxDMn detected → normalized to s
      r.d_si_flagged = _baev.flagged;     // post-conversion value implausible → surface, don't trust
      r._baevskyS = { modeS:_baev.modeS, mxdmnS:_baev.mxdmnS };  // seconds-normalized, reused by CSI
    } else {
      r.d_si = (r._amo50 && r._mode && r._mxdmn) ? r._amo50 / (2 * r._mode * r._mxdmn) : NaN;
      r.d_si_ms = false; r.d_si_flagged = false; r._baevskyS = null;
    }
    // MxDMn/MeanRR is the SAME quantity as d_csi below, and like it MUST divide the guard-normalized
    // (seconds) MxDMn by meanRR in seconds. Reading raw _mxdmn (SECONDS in a Welltory export) against raw
    // _meanRR (ms) made this ratio 1000× LOW — the un-guarded sibling of the very mixed-unit trap
    // DexUnits.guardBaevsky exists for (DEEP-AUDIT-2026-07-11 §4). Same operands as d_csi; do not re-fork.
    var _mxdmnS0 = (r._baevskyS && r._baevskyS.mxdmnS != null) ? r._baevskyS.mxdmnS : r._mxdmn;
    var _meanRRs0 = r._meanRR / 1000;
    r.d_mxdmn_meanrr = (_meanRRs0 > 0 && _mxdmnS0 != null) ? (_mxdmnS0 / _meanRRs0) : NaN;

    /* ── Frequency-domain — PRESENCE-gated (DEEP-AUDIT-2026-07-11 §3) ────────────────────────────────
       `x || 0.001` treats an ABSENT band as 0 and then substitutes a 1000×-too-small epsilon. ECGDex and
       PpgDex export lf/hf but NO totalPower/vlf, so on that (documented) ingest path the denominator
       collapsed to the epsilon and HF n.u. surfaced as 125,000,000 % — a quantity that is 0–100 BY
       DEFINITION — and went NEGATIVE when only vlf was present. An absent band must read (NaN), never a
       fabricated number. This is the spectral sibling of the _hasSubj gate above; same rule, same reason:
       gate on inputs being PRESENT, not on them being non-zero. */
    const _hasLfHf = (r._lf > 0 && r._hf > 0);
    const _hasNu = (r._totalPow > 0 && r._vlf != null && r._totalPow > r._vlf);
    const _hasBands = (r._hf > 0 && r._lf > 0 && r._vlf > 0);
    r.d_lfhf = _hasLfHf ? (r._lf / r._hf) : NaN;
    r.d_hfnu = _hasNu ? (r._hf / (r._totalPow - r._vlf)) * 100 : NaN;
    r.d_lfnu = _hasNu ? (r._lf / (r._totalPow - r._vlf)) * 100 : NaN;
    r.d_vlf_pct = (r._totalPow > 0 && r._vlf != null) ? (r._vlf / r._totalPow * 100) : NaN;
    r.d_svi = _hasLfHf ? (Math.log(r._lf) - Math.log(r._hf)) : NaN;
    // spectral entropy over normalized [hf,lf,vlf] — needs all THREE bands; the old `||0.0001` floor
    // fabricated a VLF share for an export that never carried one.
    if(_hasBands){
      // Normalize to HF+LF+VLF (not TotalPow which may include DC) for correct entropy
      const bandSum = r._hf + r._lf + r._vlf;
      const bands = [r._hf, r._lf, r._vlf].map(v => v / bandSum);
      r.d_spectral_ent = -bands.reduce((s,p) => s + p*Math.log(p), 0) / Math.log(3);
    } else r.d_spectral_ent = NaN;
    r.d_lfhf_totpow = (r._totalPow > 0 && _hasLfHf) ? ((r._lf + r._hf) / r._totalPow) : NaN;
    // Composite
    // Black-box composite — when the Welltory subjective inputs are ABSENT (a raw/ECGDex-ingest
    // recording seeds SNS/Stress/PSNS/Energy = 0), DON'T surface a fabricated 0; require them
    // PRESENT (>0), never just != null (SIGNAL-ADAPTER §8 #2 — a guess in the clothes of a number).
    r.d_ans_load = (r._sns > 0 && r._stress > 0 && r._psns > 0 && r._energy > 0)
      ? (r._sns * r._stress) / (r._psns * r._energy + 1) : NaN;
    r.d_coh_energy = _hasSubj ? r._coherence * r._energy / 100 : NaN;
    r.d_pti = _hasSubj ? r._psns * r._rmssd / 100 : NaN;
    r.d_incoherent_stress = r._coherence > 0 ? r._stress * (100 / r._coherence) : NaN;
    r.d_vei = r._hr > 0 ? r._rmssd / r._hr : NaN;
    // §3: the old guard `(hf + psns*10 + 0.001)` is ALWAYS truthy (the +0.001 sees to that), so with the
    // spectrum absent this evaluated to a real-looking 0. Gate on the spectral inputs being present.
    r.d_sdi = _hasLfHf ? (r._lf + r._sns * 10) / (r._hf + r._psns * 10) : NaN;
    // ── Poincaré SD1 / SD2 ──
    r.d_sd1 = r._rmssd / Math.sqrt(2);
    const sd2sq = Math.max(0, 2 * r._sdnn * r._sdnn - r.d_sd1 * r.d_sd1);
    r.d_sd2 = Math.sqrt(sd2sq);
    r.d_sd1_sd2 = r.d_sd2 > 0 ? r.d_sd1 / r.d_sd2 : NaN;

    // ── Toichi CVI / CSI ──
    const meanRR_s = r._meanRR / 1000;
    // Toichi CVI: log10(rMSSD_ms × MeanRR_ms) — both in ms for correct units
    // Typical resting values: 3.5–4.5; threshold thresholds updated accordingly
    r.d_cvi = (r._rmssd > 0 && r._meanRR > 0) ? Math.log10(r._rmssd * r._meanRR) : NaN;
    // CSI: MxDMn in SECONDS / meanRR in seconds. Uses the SAME guard-normalized MxDMn as d_si
    // (was a hard "assumes seconds" → ~10³× mis-scale on a ms-unit file; -III §1). meanRR_s already
    // converts meanRR ms→s above, so both operands are seconds; do NOT re-fork the threshold.
    var _mxdmnS = (r._baevskyS && r._baevskyS.mxdmnS != null) ? r._baevskyS.mxdmnS : r._mxdmn;
    r.d_csi = (meanRR_s > 0 && _mxdmnS != null) ? _mxdmnS / meanRR_s : NaN;

    // ── Autonomic Balance Score ──
    r.d_abs = (r._sns + r._psns > 0) ? (r._psns - r._sns) / (r._psns + r._sns) : NaN;

    // ── Stress-Focus Dissociation ──
    r.d_sfd = _hasSubj ? r._stress - r._focus : NaN;

    // ── Focus Efficiency ──
    r.d_focus_eff = _hasSubj ? r._focus / (r._sns + 1) : NaN;

    // ── EFC Readiness Index ── (black-box composite — NaN unless its subjective inputs were
    //    actually measured (>0); a raw recording seeds Energy/Focus/Coherence=0 → fake EFC=0. §8 #2)
    r.d_efc = (r._energy > 0 && r._focus > 0 && r._coherence > 0)
      ? (r._energy * 0.4 + r._focus * 0.3 + r._coherence * 0.3) / 100 : NaN;

    // ── Cardiac Resilience Score ──
    r.d_crs = (r._stress > 0) ? (r._coherence * r._rmssd * r._pnn50) / (r._stress * 1000 + 0.001) : NaN;

    // ── RSA Power Proxy ── (§3: an absent HF divided into a real meanRR yielded a confident 0)
    r.d_rsa = (meanRR_s > 0 && r._hf > 0) ? r._hf / (meanRR_s * meanRR_s) : NaN;

    // ── Spectral Asymmetry Index ── (§3: with only ONE band present this returned ±1, a fabricated extreme)
    r.d_sai = _hasLfHf ? (r._lf - r._hf) / (r._lf + r._hf) : NaN;

    // ── VLF/HF ratio ── (§3: an absent VLF over a real HF yielded a confident 0)
    r.d_vlf_hf = (r._hf > 0 && r._vlf > 0) ? r._vlf / r._hf : NaN;

    // ── HRV Power Law Slope (3-band log-log) ──
    if(r._vlf > 0 && r._lf > 0 && r._hf > 0){
      // Use geometric center frequencies of each band (not boundaries)
      // VLF: 0.003–0.04 Hz center ≈ 0.011; LF: 0.04–0.15 Hz center ≈ 0.075; HF: 0.15–0.4 Hz center ≈ 0.245
      const lf_arr = [Math.log10(0.011), Math.log10(0.075), Math.log10(0.245)];
      const lp_arr = [Math.log10(r._vlf), Math.log10(r._lf), Math.log10(r._hf)];
      const mxf = (lf_arr[0]+lf_arr[1]+lf_arr[2])/3, mxp = (lp_arr[0]+lp_arr[1]+lp_arr[2])/3;
      const num_s = lf_arr.reduce((s,v,i)=>s+(v-mxf)*(lp_arr[i]-mxp),0);
      const den_s = lf_arr.reduce((s,v)=>s+(v-mxf)*(v-mxf),0);
      r.d_plaw = den_s > 0 ? num_s/den_s : NaN;
    } else r.d_plaw = NaN;

    // Autonomic (ANS) Age Estimate REMOVED 2026-06-23 (DEX-METRIC-REMOVAL-AUDIT 🔴):
    // a population age-regression dressed as a personal "autonomic age" — indefensible
    // single-number framing, no validation. d_auto_age and its two trend charts are gone.

    // ── DFA α1 Proxy (SD1/SD2 based) ──
    r.d_dfa_proxy = !isNaN(r.d_sd1_sd2) ? 1 - r.d_sd1_sd2 * 0.5 : NaN;

    // ── PNS Efficiency Index ──
    // PNS Efficiency: NaN when pNN50 < 1% — low pNN50 collapses denominator toward ε,
    // producing paradoxically HIGH values on worst stress days (confirmed: 8 days in dataset).
    r.d_pns_eff = (r._pnn50 >= 1 && r._sdnn > 0)
      ? r._rmssd / (r._sdnn * (r._pnn50 / 100)) : NaN;

    // ── Overtraining Risk Index ──
    r.d_otr = (r._psns > 0 && r._pnn50 >= 0) ? Math.min(500, (r._sns / (r._psns + 0.001)) * (100 / (r._pnn50 + 0.01))) : NaN;
    r.d_otr_sat = (!isNaN(r.d_otr) && r.d_otr >= 499) ? true : false;  // saturated flag

    // ── Circadian-Adjusted rMSSD ──
    const mHour = r._date instanceof Date ? r._date.getUTCHours() : 8;
    const circAdj = mHour < 10 ? 1.08 : (mHour > 16 ? 0.95 : 1.0);
    r.d_rmssd_circ = r._rmssd / circAdj;

    // ── NN50 estimate ──
    const meanRR_s_local = r._meanRR > 0 ? r._meanRR / 1000 : NaN; // fix: use per-row value
    const beats5min = (meanRR_s_local > 0) ? 300 / meanRR_s_local : NaN;
    r.d_nn50 = !isNaN(beats5min) ? (r._pnn50 / 100) * beats5min : NaN;

    // ── VO2max Estimates ──────────────────────────────────────────
    const p_prof = _p;
    const AGE = _p.age;
    const _tanakaR = 208 - 0.7 * AGE;
    const _hrRestR = p_prof.hrrest_manual > 0 ? p_prof.hrrest_manual : r._hr;
    const hrmax_tanaka = (p_prof.hrmax_manual > 0 && p_prof.hrmax_manual >= 140 && p_prof.hrmax_manual > _hrRestR + 45)
      ? p_prof.hrmax_manual : _tanakaR;
    const _altFR = p_prof.elev <= 1500 ? 1 : Math.max(0.55, 1 - (p_prof.elev-1500)/300*0.01);
    // Method 1: Uth-Sørensen (2004) — resting HR ratio, altitude-corrected
    r.d_vo2_base = r._hr > 0 ? 15.3 * (hrmax_tanaka / r._hr) * _altFR : NaN;
    // Method 2: HRV-adjusted — rMSSD modulation ±8% band
    const ln_rmssd_ref = 3.7;
    const rmssd_adj = r._rmssd > 0 ? 1 + 0.08 * (Math.log(r._rmssd) - ln_rmssd_ref) : 1;
    r.d_vo2_hrv = !isNaN(r.d_vo2_base) ? r.d_vo2_base * rmssd_adj : NaN;
    // 7-day rolling VO2max mean
    // v2.9: date-keyed VO2 7-day window
    const _vo2win7 = [];
    { const _seenvo2 = new Set();
      for(let j=i; j>=0 && _vo2win7.length < 7; j--){
        const _dk = isFinite(arr[j]._tMs) ? utcDayKey(arr[j]._tMs) : '';
        if(_dk && !_seenvo2.has(_dk)){ _seenvo2.add(_dk); _vo2win7.unshift(arr[j]); }
      }
    }
    const vo2_win = _vo2win7.map(x=>x.d_vo2_hrv).filter(v=>!isNaN(v)&&v>0);
    r.d_vo2_roll7 = vo2_win.length >= 3 ? vo2_win.reduce((a,b)=>a+b,0)/vo2_win.length : NaN;
    // VO2max fitness category for age 49 male
    // <35 Poor, 35-40 Fair, 41-44 Good, 45-49 Excellent, ≥50 Superior
    r.d_vo2_cat = isNaN(r.d_vo2_hrv) ? '—' : calcVo2Cat(r.d_vo2_hrv, _p.age, _p.sex);
    // Delta from user-entered VO2max ground truth
    r.d_vo2_delta = (!isNaN(r.d_vo2_hrv) && _p.vo2gt > 0) ? r.d_vo2_hrv - _p.vo2gt : NaN; // NaN when no GT entered

    // ── BP Autonomic Load Index REMOVED 2026-06-21 (external-review WP-A) ──
    // Cuffless SBP/DBP from HRV is indefensible; the charts, the correlation-explorer
    // entry, and this heuristic regression (d_sbp_est/d_dbp_est/d_bp_risk/d_delta_sbp/
    // d_sbp_roll7/d_bp_comp_*) were all removed. d_bap (Baevsky AP) below uses the
    // user-entered profile SBP/DBP, not an estimate, so it stays.

    // Clinical
    // Full Baevsky AP: 0.011×HR + 0.014×age + 0.008×SBP + 0.014×DBP - 0.009×weight - 0.009×height - 0.27
    r.d_bap = 0.011*r._hr + 0.014*AGE + 0.008*_p.sbp + 0.014*_p.dbp
              - 0.009*_p.weight - 0.009*_p.height - 0.27;
    // d_bap uses full Baevsky AP formula (all 7 terms) when SBP/DBP/weight/height set in profile
    r.d_ortho = r._sdnn > 0 ? r._hr * (1 / r._sdnn) : NaN;
    r.d_hile = _hasSubj ? ((r._stress > 60 && r._energy < 40) ? 1 : 0) : NaN;

    // ── NEW v2.5 METRICS ──────────────────────────────────────────

    // Cardiac Autonomic Index: geometric mean of Poincaré axes (ms)
    // Captures combined short+long-term variability in a single value
    r.d_cai = (!isNaN(r.d_sd1) && !isNaN(r.d_sd2) && r.d_sd1 > 0 && r.d_sd2 > 0)
              ? Math.sqrt(r.d_sd1 * r.d_sd2) : NaN;

    // Welfare Index: (Energy × Coherence) / (Stress + 1)
    // High = high energy AND coherence with low stress burden
    // Black-box composite — require the DRIVING subjective inputs PRESENT (>0), not just != null:
    // a raw recording seeds Energy/Coherence/Stress=0, and 0 != null produced a fake welfare=0
    // (SIGNAL-ADAPTER §8 #2 — "a guess in the clothes of a measurement").
    r.d_welfare = (r._energy > 0 && r._coherence > 0)
                  ? (r._energy * r._coherence) / (r._stress + 1) : NaN;

    // Autonomic Reactivity: day-to-day rMSSD % change (filled in rolling pass)
    // Filled later after full-array pass (needs prev row)
  });

  // Day-to-day rMSSD % change (autonomic reactivity)
  // Only compute when gap is EXACTLY 1 calendar day:
  //   gap=0  → same-day intraday sessions (not day-to-day reactivity)
  //   gap>1  → multi-day gap (missing measurements)
  //   gap=1  → genuine consecutive day comparison ✓
  allRows.forEach((r, i, arr) => {
    if(i === 0) { r.d_rmssd_delta_pct = NaN; return; }
    const prev = arr[i-1];
    const dayGap = (isFinite(r._tMs) && isFinite(prev._tMs))
      ? Math.round((r._tMs - prev._tMs) / 86400000) : 1;
    r.d_rmssd_delta_pct = (dayGap === 1 && prev._rmssd > 0 && !isNaN(r._rmssd))
      ? ((r._rmssd - prev._rmssd) / prev._rmssd) * 100 : NaN;
  });


  // Rolling windows
  allRows.forEach((r,i,arr) => {
    // v2.9: collect exactly 7 distinct calendar days backwards from row i
    const window7 = [];
    { const _seen7 = new Set();
      for(let j=i; j>=0 && window7.length < 7; j--){
        const _dk = isFinite(arr[j]._tMs) ? utcDayKey(arr[j]._tMs) : '';
        if(_dk && !_seen7.has(_dk)){ _seen7.add(_dk); window7.unshift(arr[j]); }
      }
    }
    const rmssd7 = window7.map(x => x._rmssd).filter(v => !isNaN(v) && v > 0);
    const sdnn7 = window7.map(x => x._sdnn).filter(v => !isNaN(v) && v > 0);   // Finding 1: symmetric w/ rmssd7 — drop null/≤0 (absent SDNN) so a fabricated 0 never biases meanSDNN7/stdSDNN7
    const stress7 = window7.map(x => x._stress).filter(v => !isNaN(v));
    const pnn507 = window7.map(x => x._pnn50).filter(v => Number.isFinite(v));   // §2 (FOLLOWUPS): drop absent (null), KEEP a real 0 (pNN50=0 is physiological); !isNaN(null) was true → a blank pNN50 polluted the slope as 0

    const mean7rmssd = rmssd7.length ? rmssd7.reduce((a,b)=>a+b,0)/rmssd7.length : NaN;
    const mean7lnrmssd = rmssd7.length ? rmssd7.map(v=>Math.log(v)).reduce((a,b)=>a+b,0)/rmssd7.length : NaN;
    r.d_ari = (mean7rmssd > 0 && window7.length >= 4) ? r._rmssd / mean7rmssd : NaN;
    r.d_rmssd_rolling_ln = mean7lnrmssd;
    r.d_stress_auc = stress7.length ? stress7.reduce((a,b)=>a+b,0) : NaN;
    r.d_rmssd_cv7 = (rmssd7.length > 1) ? (std(rmssd7)/mean7rmssd*100) : NaN;

    const meanSDNN7 = sdnn7.length ? sdnn7.reduce((a,b)=>a+b,0)/sdnn7.length : NaN;
    const stdSDNN7 = sdnn7.length > 1 ? std(sdnn7) : NaN;
    r.d_sdnn_z = (r._sdnn > 0 && stdSDNN7 > 0) ? (r._sdnn - meanSDNN7) / stdSDNN7 : NaN;   // Finding 1: an absent-SDNN row has no z (guard the row's OWN value, not just the baseline)

    // Stress autocorrelation lag-1 (14-day window)
    // v2.9: date-keyed 14-day window for autocorrelation
    const _win14ac = [];
    { const _seen14ac = new Set();
      for(let j=i; j>=0 && _win14ac.length < 14; j--){
        const _dk = isFinite(arr[j]._tMs) ? utcDayKey(arr[j]._tMs) : '';
        if(_dk && !_seen14ac.has(_dk)){ _seen14ac.add(_dk); _win14ac.unshift(arr[j]); }
      }
    }
    const ac_raw = _win14ac.map(x => x._stress);
    const ac_pairs = []; for(let j=0;j<ac_raw.length-1;j++){ if(!isNaN(ac_raw[j])&&!isNaN(ac_raw[j+1])) ac_pairs.push([ac_raw[j],ac_raw[j+1]]); }
    r.d_stress_ac = ac_pairs.length > 3 ? pearsonCorr(ac_pairs.map(p=>p[0]), ac_pairs.map(p=>p[1])) : NaN;

    // pNN50 rolling slope (7d linear regression slope)
    if(pnn507.length > 2){
      const win_dates = window7.filter(x=>Number.isFinite(x._pnn50)).map(x=>x._tMs/86400000);
      const win_pnn = window7.filter(x=>Number.isFinite(x._pnn50)).map(x=>x._pnn50);
      r.d_pnn50_slope = linRegSlope(win_dates, win_pnn);
    } else r.d_pnn50_slope = NaN;

    // v2.9: HRV Momentum — date-keyed 14-day window
    const window14 = [];
    { const _seen14 = new Set();
      for(let j=i; j>=0 && window14.length < 14; j--){
        const _dk = isFinite(arr[j]._tMs) ? utcDayKey(arr[j]._tMs) : '';
        if(_dk && !_seen14.has(_dk)){ _seen14.add(_dk); window14.unshift(arr[j]); }
      }
    }
    const lnrmssd14 = window14.filter(x=>x._rmssd>0).map(x=>Math.log(x._rmssd));
    if(lnrmssd14.length >= 5){
      const dates14 = window14.filter(x=>x._rmssd>0).map(x=>x._tMs/86400000);
      r.d_hrv_momentum = linRegSlope(dates14, lnrmssd14);
    } else r.d_hrv_momentum = NaN;

    // Cumulative Recovery Debt: count of ARI < 0.9 days in last 14 days
    const ari14 = window14.map(x=>x.d_ari).filter(v=>!isNaN(v));
    r.d_recovery_debt = ari14.filter(v=>v < 0.9).length;
  });
}


/* ===== STATS HELPERS ===== */
function mean(arr){ return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : NaN; }
function std(arr){ const m=mean(arr); return arr.length > 1 ? Math.sqrt(arr.reduce((s,v)=>s+(v-m)*(v-m),0)/(arr.length-1)) : 0; }
function pearsonCorr(x,y){
  const n=Math.min(x.length,y.length); if(n<2) return NaN;
  const mx=mean(x.slice(0,n)),my=mean(y.slice(0,n));
  let num=0,dx=0,dy=0;
  for(let i=0;i<n;i++){num+=(x[i]-mx)*(y[i]-my);dx+=(x[i]-mx)**2;dy+=(y[i]-my)**2;}
  return (dx*dy>0) ? num/Math.sqrt(dx*dy) : NaN;
}
function linRegSlope(x,y){
  const n=x.length; const mx=mean(x),my=mean(y);
  const num=x.reduce((s,xi,i)=>s+(xi-mx)*(y[i]-my),0);
  const den=x.reduce((s,xi)=>s+(xi-mx)**2,0);
  return den ? num/den : NaN;
}
function smooth(arr, k){
  if(k===0) return arr;
  return arr.map((v,i,a)=>{
    const slice=a.slice(Math.max(0,i-k),i+1).filter(x=>!isNaN(x));  // v2.9: trailing MA only
    return slice.length ? mean(slice) : NaN;
  });
}

// SIGNAL-ADAPTER-FOLLOWUPS-X §2 (decision: human exports = the view you're looking at).
// The JSON / CSV downloads are built from getFilteredRows() — the CURRENT dashboard window
// (last windowDays + optional morning-only), NOT the full accumulated log. That is deliberate
// ("export what I'm looking at"); only the machine Ganglior BUS export must be complete (it
// carries the full allRows recording — IX §1). This hint makes the human-export truncation
// VISIBLE so a >7-day file's older rows aren't silently dropped from a CSV/JSON without notice.
function _hrvUpdateExportHint(){
  var el = document.getElementById('ebScopeHint'); if(!el) return;
  var n  = (typeof windowDays!=='undefined') ? windowDays : 7;
  var mo = !!(document.getElementById('morningOnly') && document.getElementById('morningOnly').checked);
  var scope = (n>=999) ? 'all measurements' : ('last '+n+' day'+(n===1?'':'s'));
  el.textContent = 'JSON / CSV export the current view — '+scope+(mo?', mornings only':'');
  el.title = 'The JSON and CSV downloads contain only the measurements currently in view ('+scope+(mo?', mornings only':'')+'); older rows are excluded. The Ganglior bus export and the PDF carry the full recording.';
}

/* ===== FILTER ROWS ===== */
function getFilteredRows(){
  let rows = allRows;
  if((document.getElementById('morningOnly') ? document.getElementById('morningOnly').checked : false)){
    rows = rows.filter(r => r._date.getUTCHours() < 10);
  }
  if(windowDays < 999){
    // Always anchor window to the last measurement in allRows (not morning-filtered subset)
    const lastMs = allRows[allRows.length-1]._tMs - (windowDays-1)*86400000;
    rows = rows.filter(r => r._tMs >= lastMs);
  }
  return rows;
}


// ═══ Cardiovascular Research Pattern computations (v1.0.0) ═══
// Reference values from published literature (see references in HTML section)
// NOTE: computeHtnPatternScore + estimateMAP REMOVED 2026-06-23 (DEX-METRIC-REMOVAL-AUDIT 🔴):
// HRV→hypertension-risk and HRV→MAP are cuffless-BP-from-HRV proxies with no individual
// validity (medical-claim risk). CAMQ below is an autonomic-balance index (NOT blood
// pressure) and stays. prof_sbp/prof_dbp remain USER-ENTERED cuff inputs elsewhere.
function computeCAMQ(r) {
  // Cardiac Autonomic Modulation Quality
  // Parasympathetic indicators (positive contribution): RMSSD, HF power, pNN50
  // Sympathetic indicators (negative contribution): LF/HF ratio, AMo50
  // Output: 0-100 scale, higher = healthier
  if (!r) return null;
  var paraScore = 0, paraCount = 0;
  if (r._rmssd > 0)  { paraScore += Math.min(100, r._rmssd * 2.5); paraCount++; }
  if (r._pnn50 >= 0) { paraScore += Math.min(100, r._pnn50 * 4); paraCount++; }
  if (r._hf > 0)     { paraScore += Math.min(100, Math.log10(r._hf+1) * 28); paraCount++; }
  var paraAvg = paraCount ? paraScore / paraCount : 50;

  var sympPenalty = 0;
  if (r._hf > 0 && r._lf > 0) {
    var lfhf = r._lf / r._hf;
    sympPenalty = Math.max(0, (lfhf - 1.0) * 15);  // penalty grows above LF/HF=1.0
  }
  var camq = Math.max(0, Math.min(100, paraAvg - sympPenalty));
  return Math.round(camq);
}


// ═════════════════════════════════════════════════════════════════
//  HEADLESS PUBLIC COMPUTE SURFACE · HRVDex.compute (Phase 9)
//  ─────────────────────────────────────────────────────────────────
//  SIGNAL-ADAPTER-FOLLOWUPS §4 (the HRVDex leg). Split READING (the now-pure
//  _hrvParseSummaryRows) from EMITTING (the ganglior.node-export builder) and
//  expose a public entry the Data Unifier + OverDex call in an isolated HRVDex
//  host: HRVDex.compute(SignalFrame(hrv) | rows[] | {text}) → ganglior.node-export.
//  ONE shared event/export builder (hrvBuildNodeExport) that hrvdex-app.js's
//  exportGanglior now delegates to — so a Unifier/OverDex export is byte-identical
//  to HRVDex.html's own. hrv_low is a MEASURED time-domain drop (rMSSD); stress_high
//  is derived from Welltory's BLACK-BOX composite Stress(HRV) score, so it is tagged
//  meta.derived:true at the 'heuristic' tier (the Integrator never treats a vendor
//  composite as a measured fact). The Baevsky SI/CSI ms-vs-s unit guard is applied
//  at the summary INGEST boundary in adapters/welltory-summary.js.
// ═════════════════════════════════════════════════════════════════

function _hrvClockS(ms){ var d=new Date(ms), p=function(n){return(n<10?'0':'')+n;}; return p(d.getUTCHours())+':'+p(d.getUTCMinutes())+':'+p(d.getUTCSeconds()); }

// Shared event set — used by BOTH the app's exportGanglior AND HRVDex.compute.
function hrvEventsFromRows(rows){
  var ev=[];
  (rows||[]).forEach(function(r){
    if(!r || !isFinite(r._tMs)) return;
    var tMs=r._tMs;
    if(isFinite(r._rmssd) && r._rmssd>0 && r._rmssd<20)         // parasympathetic-low measurement (measured)
      ev.push({tMs:tMs, t:_hrvClockS(tMs), impulse:'hrv_low', node:'HRVDex',
        conf:+Math.max(0.4,Math.min(0.9,(20-r._rmssd)/20)).toFixed(2),
        meta:{rmssd:r._rmssd, sdnn:r._sdnn, hr:r._hr, evidence:'measured'}});
    if(isFinite(r._stress) && r._stress>=70)                    // high-stress: Welltory black-box composite (heuristic)
      ev.push({tMs:tMs, t:_hrvClockS(tMs), impulse:'stress_high', node:'HRVDex',
        conf:+Math.max(0.4,Math.min(0.9,(r._stress-50)/50)).toFixed(2),
        meta:{stress:r._stress, rmssd:r._rmssd, energy:r._energy, evidence:'heuristic', derived:true, source:'welltory-composite'}});
  });
  ev.sort(function(a,b){return a.tMs-b.tMs;});
  return ev;
}

// Per-recording node-export — the single source of the export shape. opts:
// { kernel (DexKernel obj|null), ingest, generated }. The app passes kernel only;
// the orchestrator (unifier/OverDex) also passes ingest (adapter provenance).
function hrvBuildNodeExport(rows, opts){
  opts = opts || {};
  // SIGNAL-ADAPTER-FOLLOWUPS-VII §1: sort ascending by floating tMs HERE — ONE ordering rule
  // for both callers. The app path passes the already-commitRows-sorted allRows (idempotent
  // re-sort); the headless HRVDex.compute({text}) path passed _hrvParseSummaryRows in FILE order,
  // which is newest-first for Welltory exports → dated[0] was the LAST day, giving a negative
  // spanDays and a startEpochMs that violated the Clock Contract (§4/§6: startEpochMs = the
  // EARLIEST valid sample). Sorting on a fresh filtered array; does not mutate the caller's rows.
  var dated = (rows||[]).filter(function(r){return r && isFinite(r._tMs);})
                        .sort(function(a,b){return a._tMs - b._tMs;});
  var t0 = dated.length?dated[0]._tMs:null;
  var last = dated.length?dated[dated.length-1]:null;
  var ev = hrvEventsFromRows(dated);
  var BUS = 'ganglior';
  var kfmt = opts.kernel ? { version:opts.kernel.VERSION, hash:opts.kernel.HASH }
           : ((typeof DexKernel!=='undefined' && DexKernel) ? { version:DexKernel.VERSION, hash:DexKernel.HASH } : null);
  var schema = { name:BUS+'.node-export', version:'2.0', node:'HRVDex', nodeVersion:'1.0',
    bus:BUS, generated:(opts.generated || new Date().toISOString()),
    doc:'HRVDex per-measurement HRV (Welltory-style) → Ganglior events. tMs = floating wall-clock ms (UTC getters). null = unknown, never fabricated. stress_high derives from a vendor black-box composite (meta.derived:true, heuristic tier).' };
  if(opts.ingest) schema.ingest = opts.ingest;   // adapter provenance (unifier/OverDex path)
  return {
    kernel:kfmt,
    schema:schema,
    // EXPORT-IDENTITY §2.1 / -FOLLOWUPS-II §1: identity-free contentId, single-sourced in this
    // shared builder (both app exportGanglior + headless compute reach it). Folds the per-measurement series.
    recording:{ source:'welltory', contentId:((typeof SignalFrame!=='undefined' && SignalFrame && SignalFrame.computeContentId && dated.length) ? SignalFrame.computeContentId({ signalType:'hrv', kind:'samples', samples:dated.map(function(r){return {t:r._tMs, rmssd:r._rmssd, sdnn:r._sdnn, hr:r._hr};}), t0Ms:t0, usable:true }) : null), startEpochMs:t0,
      offsetMin:(dated[0] && dated[0]._offsetMin!=null ? dated[0]._offsetMin : null),
      measurements:dated.length, firstTMs:t0, lastTMs:last?last._tMs:null,
      spanDays:(t0!=null && last)?Math.round((last._tMs-t0)/864e5)+1:null },
    // SELF-INGEST enrich (D2 path b, 2026-07-04): the per-measurement table — the whole HRVDex clinical
    // value — now travels so a reloaded export renders the HRV dashboard. Transparent fields stay null when
    // absent; SD1/SD2 derived from rMSSD/SDNN (same formula as computeDerived); vendor black-box composites
    // ride under composites.meta{derived,tier:'heuristic'} ONLY when present (>0) — NO tier upgrade on reload.
    measurements: dated.map(function(r){
      var sd1 = (r._rmssd>0) ? r._rmssd/Math.SQRT2 : null;
      var sd2 = (sd1!=null && r._sdnn>0) ? Math.sqrt(Math.max(0, 2*r._sdnn*r._sdnn - sd1*sd1)) : null;
      var m = { tMs:r._tMs, offsetMin:(r._offsetMin==null?null:r._offsetMin),
        hr:r._hr, meanRR:r._meanRR, sdnn:r._sdnn, rmssd:r._rmssd, pnn50:r._pnn50, mxdmn:r._mxdmn,
        sd1:(sd1==null?null:+sd1.toFixed(2)), sd2:(sd2==null?null:+sd2.toFixed(2)) };
      var comp = {};
      if(r._stress>0) comp.stress=r._stress; if(r._energy>0) comp.energy=r._energy;
      if(r._focus>0) comp.focus=r._focus; if(r._sns>0) comp.sns=r._sns;
      if(r._psns>0) comp.psns=r._psns; if(r._coherence>0) comp.coherence=r._coherence;
      if(r._hrv>0) comp.hrvScore=r._hrv;
      if(Object.keys(comp).length){ comp.meta={ derived:true, tier:'heuristic' }; m.composites=comp; }
      return m;
    }),
    ganglior_events:ev,
    reserved:{ doc:'Awaiting other fleet nodes; null until available.', glucoseCorrelation:null, glucoseSource:'GlucoDex' }
  };
}

// SignalFrame(hrv).samples | rows[] | {text} → the per-measurement row array.
function _hrvRowsFromInput(input){
  if(input==null) return null;
  if(Array.isArray(input)) return input.filter(function(r){return r && isFinite(r._tMs);});
  if(input.samples!=null) return _hrvRowsFromInput(input.samples);
  if(input.rows!=null) return _hrvRowsFromInput(input.rows);
  if(typeof input.text==='string') return _hrvParseSummaryRows(input.text);
  return null;
}

// ═══ SELF-INGEST — reload HRVDex's OWN ganglior.node-export as a review-mode clinical VIEW
// (SELF-INGEST-FOLLOWUPS · HRVDex enrich-first D2 path b). PURE + DOM-FREE: detect → own-node guard →
// mark reviewMode → return provenance/kernel/measurements/events VERBATIM. Never recomputes, never
// re-stamps. The enriched export carries the per-measurement `measurements[]` table, so the review view
// renders the HRV dashboard from stored values (no re-derive, no tier upgrade). ═══
function hrvLoadOwnExport(json){
  if(!(json && json.schema && json.schema.name === 'ganglior.node-export'))
    return { ok:false, reason:'not-node-export', message:'Not a node-export \u2014 drop a Welltory CSV, or HRVDex\u2019s own .json export.' };
  var node = ((json.schema.node || '') + '').trim();
  if(node !== 'HRVDex')
    return { ok:false, reason:'foreign-node', node:node,
      message:'This is a '+(node||'non-HRVDex')+' export \u2014 open it in '+(node||'its own node')+', or drop it into the Integrator to fuse.' };
  var el = JSON.parse(JSON.stringify(json)); el._fromExport=true; el._reviewMode=true;
  var evAll = Array.isArray(json.ganglior_events) ? json.ganglior_events.slice() : [];
  evAll.sort(function(a,b){ return ((a&&a.tMs)||0) - ((b&&b.tMs)||0); });
  return {
    ok:true, reviewMode:true, node:node,
    elements:[el], events:evAll,
    provenance:(json.schema && json.schema.provenance) || null,
    generated:(json.schema && json.schema.generated) || null,
    derivedFrom:(json.schema && json.schema.derivedFrom) || null,
    kernel:json.kernel || null, recording:json.recording || null,
    measurements:Array.isArray(json.measurements) ? json.measurements : null,
    scrubbed:!!(json.schema && json.schema.scrubbed),
    multiNight:false, raw:json
  };
}

// Public namespace — the headless surface the orchestrator + app + adapter reach.
var HRVDex = (typeof HRVDex !== 'undefined' && HRVDex) ? HRVDex : {};
HRVDex.compute = function(input, opts){
  opts = opts || {};
  var rows = _hrvRowsFromInput(input);
  if(!rows || !rows.length) return null;
  return hrvBuildNodeExport(rows, opts);
};
HRVDex.parseRows = _hrvParseSummaryRows;
// Headless derivation surface (DEEP-AUDIT-2026-07-11 §3/§4): derive the d_* columns on caller-supplied
// rows without touching app state, so both runners can gate the spectral presence-gates + the unit-guarded
// MxDMn/MeanRR ratio directly. Also exposes the node-export→row seeding the ECGDex/Ganglior ingest uses.
HRVDex.derive = function(rows){ computeDerived(rows); return rows; };
HRVDex.rowFromNodeExport = function(env){ var s = _envToSeed(env); return s ? _rowFromSeed(s) : null; };
HRVDex.eventsFromRows = hrvEventsFromRows;
HRVDex.buildNodeExport = hrvBuildNodeExport;
HRVDex.loadOwnExport = hrvLoadOwnExport;   // SELF-INGEST reload (review-mode clinical view)
// scrub-for-sharing → the SHARED dexScrubExport (D1); lazy delegate, co-load order irrelevant.
HRVDex.scrubExport = function(env){
  if(typeof DexExport !== 'undefined' && DexExport && typeof DexExport.scrubExport === 'function') return DexExport.scrubExport(env);
  if(typeof dexScrubExport === 'function') return dexScrubExport(env);
  return env;
};

// ── public namespace (always) ──
root.HRVDex = HRVDex;

// ── app back-compat: re-export the bare DSP globals UNLESS co-loaded namespaced ──
if (!root.__DEX_NAMESPACED__) {
  Object.assign(root, {
    tzOffset, _ckP2, _ckNumEpoch, _ckZoneMin, _ckDMY, parseTimestamp, fmtClock, fmtDate,
    fmtDateTime, utcDayKey, _hrvParseSummaryRows, parseCSV, HRV_STORE_KEY, HRV_SEED_FIELDS, _hrvNum, _hrvSig,
    _seedFromRow, _rowFromSeed, persistHRVRows, restoreHRVRows, commitRows, _hrvRefreshChrome, _envToSeed, ingestGangliorJSON,
    computeDerived, mean, std, pearsonCorr, linRegSlope, smooth, getFilteredRows, computeCAMQ,
    _hrvClockS, hrvEventsFromRows, hrvBuildNodeExport, _hrvRowsFromInput, _hrvUpdateExportHint, hrvLoadOwnExport
  });
  // mutable cross-file state — proxy bare names to the in-closure bindings
  Object.defineProperty(root, 'allRows',    { configurable: true, get: function () { return allRows; },    set: function (v) { allRows = v; } });
  Object.defineProperty(root, 'windowDays', { configurable: true, get: function () { return windowDays; }, set: function (v) { windowDays = v; } });
  Object.defineProperty(root, 'charts',     { configurable: true, get: function () { return charts; },     set: function (v) { charts = v; } });
}

})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));


