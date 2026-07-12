/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   PpgDex · APP  (ppgdex-app.js)
   ────────────────────────────────────────────────────────────────────────
   Glue: multi-file Polar Sense ingest (PPG + companion ACC/GYRO/PPI/MARKER),
   multi-session model (allSessions keyed by floating t0Ms), pipeline
   orchestration, all UI population, and v2.0 exports (single + multi wrapper).
   Depends on window.PPGDSP, window.PPGUI, window.PPGMorph, window.PPGProfile.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';
const $ = id => document.getElementById(id);
const DSP = window.PPGDSP, UI = window.PPGUI;
const ING = window.DexIngest;   // §2/§3 (ECG-INGEST-FOLLOWUPS): shared, gate-backed file-ingest classification (dex-ingest.js)
const F = DSP;  // fmt helpers
// foreign / set-aside stream labels for the no-PPG drop report (§2)
const _PPG_FOREIGN_LABEL = { ecg:'raw ECG (→ ECGDex)', spo2:'SpO₂ pulse-ox (→ OxyDex)', cgm:'glucose CGM (→ GlucoDex)', magn:'magnetometer', gyro:'gyroscope', skip:'non-PPG stream', duplicate:'duplicate PPG' };

let allSessions = {};      // key (t0Ms string) → result object
let activeKey = null;
let SCOPE = null;

// ── filename classification + timestamp ───────────────────────────────────
// §2/§3 (ECG-INGEST-FOLLOWUPS): classification now delegates to the shared, gate-backed DexIngest.ppgKind
// (dex-ingest.js — the SAME source the routing-table test covers). ppgKind adds a 'skip' lane for foreign
// streams the old default-to-'ppg' would have fed to parsePPG → throw / mis-analyze: raw `*_ECG` (→ ECGDex),
// O2Ring/Wellue SpO₂ (→ OxyDex), Libre/CGM (→ GlucoDex). PPG's companion kinds stay acc/gyro/magn/ppi/marker
// (the asymmetry to ECG's rr/hr/acc, preserved). Device `*_HR` is still ignored-with-note downstream.
function classify(name){ return ING.ppgKind(name); }
function fnameStampMs(name){
  const m = name.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if(m) return Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]);
  return null;
}

// ── multi-part split files ────────────────────────────────────────────────
// Polar Sensor Logger writes long streams as `…_PPG_part01of15.txt` … `…of15`.
// Each part repeats the header line; without merging, PpgDex would treat every
// part as a separate, fragmentary session. The fold (group by part-stripped base,
// concatenate in numeric part order, header from part 1 only) now lives in
// PPGDSP.mergeMultipart — pure + unit-tested in both runners. Companions
// (ACC/GYRO/MAGN/PPI) that arrive split are merged the same way.

// ════════════════════════════════════════════════════════════════════════
//  INGEST — accept a FileList; group PPG sessions + attach companions
// ════════════════════════════════════════════════════════════════════════
function loadFiles(fileList){
  const files = Array.from(fileList||[]); if(!files.length) return;
  progress(6,'Reading '+files.length+' file'+(files.length>1?'s':'')+'…');
  Promise.all(files.map(f=>f.text().then(text=>({ name:f.name, text, kind:classify(f.name), stampMs:fnameStampMs(f.name) }))))
    .then(async parsed=>{
      // SELF-INGEST: a PpgDex OWN ganglior.node-export among the drop → review mode (a faithful VIEW of the
      // stored hrv/quality summary, no recompute). Foreign JSON falls through to the normal classify/skip path.
      try{ if(typeof ppgClearReview==='function') ppgClearReview(); }catch(_pc){}
      for(const _p of parsed){
        if(!/\.json$/i.test(_p.name||'') && ((_p.text||'').replace(/^\uFEFF/,'').trimStart()[0]!=='{')) continue;
        let _j=null; try{ _j=JSON.parse(_p.text); }catch(_pe){}
        if(_j && _j.schema && _j.schema.name==='ganglior.node-export' && ((_j.schema.node||'')+'').trim()==='PpgDex'){
          const _res=(window.PpgDex && typeof window.PpgDex.loadOwnExport==='function')?window.PpgDex.loadOwnExport(_j):null;
          if(_res && _res.ok){ if(typeof ppgRenderReview==='function') ppgRenderReview(_res); if(typeof showOK==='function') showOK('Loaded PpgDex export \u2014 review mode (not recomputed).'); progress(0,''); return; }
        }
      }
      parsed = DSP.mergeMultipart(parsed);   // fold `…_partNNofMM.txt` into one stream per base
      // §1 (ECG-INGEST-FOLLOWUPS-III): the loadFiles ORCHESTRATION — classify → foreign/skip set-aside →
      // duplicate-session de-dupe → per-primary device-ELIGIBILITY — is now the shared, headless, NAME-only
      // DexIngest.planIngestPpg (dex-ingest.js), the SAME source a Dex-Test-Suite group covers DIRECTLY (the
      // mixed Sense+H10 split + the duplicate-`_PPG` set-aside; the equiv gate drives compute({text}) and
      // render-coverage drives genSynthetic — NEITHER a multi-file drop). It is NAME-only, so the byte-reading
      // first-line content-sniff (defence in depth, mirrors ECGDex) stays HERE and feeds verdicts via
      // opts.sniffedForeign: a file that DEFAULTED to 'ppg' (PPG-ish or suffix-less name) but whose FIRST LINE
      // names a foreign stream (raw ECG / O2Ring SpO₂ / Libre CGM / a sensor axis) must not reach parsePPG.
      const sniffedForeign = {};
      parsed.forEach(p=>{ if(p.kind==='ppg'){ const fk=ING.sniffFirstLine((p.text||'').split(/\r?\n/)[0]);
        if(fk && fk!=='ppg') sniffedForeign[p.name]=fk; } });
      const plan = ING.planIngestPpg(parsed, { sniffedForeign });
      const skipped = plan.skipped;          // foreign + sniff-foreign + duplicate-session (set aside, reported)
      let ppgFiles = plan.ppgPrimaries;      // deduped real PPG primaries, drop order
      if(plan.hr.length) showOK('Ignored '+plan.hr.length+' Polar `*_HR.txt` device-HR file'+(plan.hr.length>1?'s':'')+' — PpgDex analyzes the raw PPG waveform; drop the matching `*_PPG.txt`.');
      if(!ppgFiles.length){ reportNoPPG(skipped); progress(0,''); return; }
      let added=0, lastKey=null;
      for(let pi=0; pi<ppgFiles.length; pi++){
        const pf=ppgFiles[pi];
        progress(20+pi/ppgFiles.length*20,'Parsing PPG · '+pf.name+'…');
        let rec;
        try { rec = DSP.parsePPG(pf.text); }
        catch(e){ showErr(e.message||String(e)); continue; }
        rec.source='file'; rec.fname=pf.name;
        // §1 (ECG-INGEST-FOLLOWUPS-III): device ELIGIBILITY (only SAME-device sidecars are candidates for
        // this `_PPG` — a Verity-Sense arm session dropped alongside an H10 session no longer cross-pairs an
        // H10 `_ACC`) is now decided by planIngestPpg; plan.eligibleByPrimary already device-filtered this
        // primary's candidates per kind. The nearest-stamp pick stays HERE because it needs the PARSED
        // rec.t0Ms a NAME-only planner can't see (a bare / non-Polar candidate stayed eligible → nearest).
        const elig = plan.eligibleByPrimary[pf.name] || {};
        // §1 (ECG-INGEST-FOLLOWUPS-IV): the nearest-stamp PICK over the device-eligible candidates is now
        // the shared headless DexIngest.pickNearestByStamp (gate-backed); the parsed rec.t0Ms (else the
        // filename stamp) is the reference a NAME-only planner can't see, so it is still resolved HERE.
        const nearest = (kind)=> ING.pickNearestByStamp(elig[kind]||[], rec.t0Ms||pf.stampMs);
        const accF=nearest('acc'), gyroF=nearest('gyro'), magF=nearest('magn'), ppiF=nearest('ppi'), markF=nearest('marker');
        rec.acc = accF? DSP.parseSensorXYZ(accF.text):null;
        rec.gyro = gyroF? DSP.parseSensorXYZ(gyroF.text):null;
        rec.magn = magF? DSP.parseSensorXYZ(magF.text):null;
        rec.devicePPI = ppiF? DSP.parseDevicePPI(ppiF.text):null;
        rec.companions = { acc:accF?accF.name:null, gyro:gyroF?gyroF.name:null, magn:magF?magF.name:null, ppi:ppiF?ppiF.name:null, marker:markF?markF.name:null };
        if(markF){ const rows=markF.text.split(/\r?\n/); const mk=[];
          for(const line of rows){ const t=line.trim(); if(!t) continue; const p=t.split(';'); if(p.length<2) continue;
            const ts=DSP.parseTimestamp(p[0]); if(!ts) continue; const type=(p[1]||'').trim();
            if(rec.t0Ms!=null) mk.push({ relSec:(ts.tMs-rec.t0Ms)/1000, type }); }
          rec.markers=mk;
        }
        let r;
        try {
          // §2b: detect the 3 optical channels concurrently in the Worker pool (byte-identical
          // serial fallback when Worker is unavailable — the headless/gated path); analyze() then
          // reuses rec._preChannels for the consensus merge + HRV on the main thread.
          rec._preChannels = await DSP.detectChannelsAsync(rec);
          r = DSP.analyze(rec, progress);
        }
        catch(e){ showErr(e.message||String(e)); continue; }
        const key = r.t0Ms!=null ? String(r.t0Ms) : ('nodate_'+pf.name);
        allSessions[key]=r; lastKey=key; added++;
      }
      if(added){ activeKey=lastKey; renderSession(allSessions[activeKey]);
        try{ localStorage.setItem('ppgdex_active', activeKey); }catch(e){}
        let msg='Analyzed '+added+' session'+(added>1?'s':'')+' · '+Object.keys(allSessions).length+' loaded total.';
        if(skipped.length){ const dups=skipped.filter(s=>s.kind==='duplicate').length, fors=skipped.length-dups, bits=[];
          if(fors) bits.push(fors+' foreign/non-PPG'); if(dups) bits.push(dups+' duplicate'+(dups>1?'s':''));
          msg+=' Ignored '+bits.join(' + ')+'.'; }
        showOK(msg);
      }
      setTimeout(()=>{ $('prog').classList.remove('show'); $('proc').textContent=''; },700);
    })
    .catch(e=>{ showErr(e.message||String(e)); progress(0,''); });
}
// §2 no-PPG report: distinguish "a foreign file was dropped" (route to the right Dex) from a truly
// empty / unrecognized drop, instead of the old generic "No PPG file found".
function reportNoPPG(skipped){
  if(!skipped || !skipped.length){
    showErr('No PPG file found. Drop a Polar Sense `*_PPG.txt` (Phone timestamp;sensor ns;ch0;ch1;ch2;ambient).');
    return;
  }
  const counts={}; skipped.forEach(s=>{ const l=_PPG_FOREIGN_LABEL[s.kind]||'non-PPG'; counts[l]=(counts[l]||0)+1; });
  const summary=Object.keys(counts).map(l=>counts[l]+'× '+l).join(', ');
  if(skipped.some(s=>s.kind==='ecg')) showErr('No optical PPG in this drop — these look like raw ECG files ('+summary+'). PpgDex needs a Polar Verity Sense “…_PPG.txt”. For chest-strap ECG, use ECGDex.');
  else if(skipped.some(s=>s.kind==='spo2')) showErr('No PPG in this drop — set aside '+summary+'. That looks like a pulse-oximeter SpO₂ file → load it in OxyDex.');
  else if(skipped.some(s=>s.kind==='cgm')) showErr('No PPG in this drop — set aside '+summary+'. That looks like a CGM glucose file → load it in GlucoDex.');
  else showErr('No PPG file in this drop — set aside '+summary+'. PpgDex reads a Polar Verity Sense “…_PPG.txt” optical waveform (Phone timestamp;sensor ns;ch0;ch1;ch2;ambient).');
}

// ════════════════════════════════════════════════════════════════════════
//  RENDER one session
// ════════════════════════════════════════════════════════════════════════
function renderSession(r){
  $('scopeSection').style.display='block';
  if(!SCOPE){ SCOPE = new UI.PPGScope($('ppgCanvas'), $('ppgMini')); SCOPE.onView=updateScopeReadout; }
  SCOPE.setData(r);
  updateScopeReadout(SCOPE.view, r.fs, r.n, SCOPE._secAt.bind(SCOPE));

  if(window.PPGProfile) window.PPGProfile.render(r);
  renderContext(r);
  renderKPI(r);
  renderQuality(r);
  renderCharts(r);
  renderMorph(r);
  renderMotion(r);
  renderValidation(r);
  renderGanglior(r);
  renderTable(r);
  renderSwitcher();
  renderCrossNight();

  document.body.classList.add('has-data');
  $('exportBar').classList.add('show');
  $('sidebarDataCard').style.display='block';
  $('sidebarDataInfo').innerHTML = 'Wrist PPG · '+r.fs+' Hz<br>'+r.nPulses.toLocaleString()+' pulses · '+r.dispHr+' bpm · '+
    (r.durSec>=3600?(r.durSec/3600).toFixed(1)+' h':(r.durSec/60).toFixed(1)+' min')+'<br>'+r.analyzablePct+'% analyzable';
}

function updateScopeReadout(view, fs, N, secAt){
  const s0=secAt(view.start), s1=secAt(view.start+view.span), span=s1-s0;
  const fmt=s=>{ const m=Math.floor(s/60),sec=(s%60); return (m>0?m+'m ':'')+sec.toFixed(span<8?2:0)+'s'; };
  $('scopeReadout').innerHTML=`<span>window <b>${fmt(s0)} – ${fmt(s1)}</b></span><span>span ${span<60?span.toFixed(span<8?2:0)+' s':(span/60).toFixed(1)+' min'}</span><span>${(N/fs/60).toFixed(1)} min total</span>`;
}

const sc=(v,ok,warn)=>v>=ok?'ok':v>=warn?'warn':'bad';
const hrStat=v=>v<40?'bad':v<=90?'ok':v<=100?'warn':'bad';

function renderContext(r){
  const tierColor={ 'ultra-short':'warn','short':'ok','overnight':'ok' }[r.tier]||'neutral';
  let notes='';
  if(r.tier==='ultra-short') notes='<div class="ctx-note">⚠ Ultra-short / spot recording — rMSSD, pNN50, SD1 &amp; pulse morphology are valid; SDNN, LF, VLF need ≥5 min and are flagged. Pulse-wave indices (rise time, dicrotic notch, AI, perfusion) are robust at this length.</div>';
  else if(r.tier==='short') notes='<div class="ctx-note">5-min standard window — full short-term HRV suite valid (Task Force 1996). The overnight CVHR apnea screen needs ≥90 min.</div>';
  else if(r.tier==='overnight') notes='<div class="ctx-note">Overnight — per-epoch medians representative; CVHR apnea screen from the PPI bradycardia-rebound signature is unlocked at this length.</div>';
  $('ctxBanner').innerHTML=`<div class="ctx-main">
      <div><div class="ctx-mode">${({['ultra-short']:'Spot / ultra-short',short:'5-min standard',overnight:'Overnight'}[r.tier])} recording</div>
      <div class="ctx-why">${r.durMin} min · ${r.nPulses.toLocaleString()} pulses · ${r.fs} Hz · ch${r.channel} (best SNR) · ${r.epochs.length} × 5-min epoch${r.epochs.length===1?'':'s'}</div></div>
      <div class="ctx-conf ${tierColor}">${r.tierMsg}</div></div>${notes}`;
  $('ctxBanner').style.display='flex';
}

function renderKPI(r){
  const p=r.profile||{};
  const pb = r.perfusionIndex==null?'neutral':(r.perfusionIndex>=1?'ok':r.perfusionIndex>=0.4?'warn':'bad');
  // ANS Age REMOVED 2026-06-21 (external-review WP-A)
  const items=[
    {l:'HRV Score', v:r.hrvScore!=null?r.hrvScore:'—', sub:'autonomic readiness', s:r.hrvScore==null?'neutral':r.hrvScore>=45?'ok':r.hrvScore>=33?'warn':'bad'},
    {l:'Pulse HR', v:r.dispHr+'bpm', sub:r.expRHR?('age norm ~'+r.expRHR):'mean', s:hrStat(r.dispHr)},
    {l:'VO₂max Est', v:r.vo2adj!=null?r.vo2adj:'—', sub:'ml/kg/min · HR-ratio', s:r.vo2adj==null?'neutral':r.vo2adj>=45?'ok':r.vo2adj>=38?'warn':'bad'},
    {l:'rMSSD', v:r.rmssd+'ms', sub:r.expRmssd?('age norm ~'+r.expRmssd):'≥30 good', s:r.expRmssd?(r.rmssd>=r.expRmssd?'ok':r.rmssd>r.expRmssd*0.7?'warn':'bad'):sc(r.rmssd,30,20)},
    {l:'SDNN', v:(r.sdnnRobust!=null?r.sdnnRobust:r.sdnn)+'ms', sub:r.tier==='ultra-short'?'needs ≥5min':(r.sdnnRobust!=null?'robust · per-5-min median':'≥50 good'), s:r.tier==='ultra-short'?'neutral':sc(r.sdnnRobust!=null?r.sdnnRobust:r.sdnn,50,30)},
    {l:'Perfusion Idx', v:r.perfusionIndex==null?'—':r.perfusionIndex+'%', sub:'AC/DC · contact', s:pb},
    {l:'Motion-rejected', v:r.motionRejectedPct+'%', sub:r.motion&&r.motion.hasData?'ACC+GYRO gate':'no motion data', s:r.motionRejectedPct<10?'ok':r.motionRejectedPct<30?'warn':'bad'},
  ];
  if(r.morph){
    items.push({l:'Rise time', v:r.morph.riseTimeMs==null?'—':r.morph.riseTimeMs+'ms', sub:'foot→systolic', s:'neutral'});
    items.push({l:'Dicrotic notch', v:r.morph.dicroticNotchPresent?'Present':'—', sub:r.morph.augmentationIndexPct!=null?('AI '+r.morph.augmentationIndexPct+'%'):'reflection', s:r.morph.dicroticNotchPresent?'ok':'neutral'});
  }
  items.push(
    {l:'% Analyzable', v:r.analyzablePct+'%', sub:r.cleanBeatPct+'% clean beats', s:r.analyzablePct>=90?'ok':r.analyzablePct>=75?'warn':'bad'},
    {l:'Correction', v:r.correctionRate+'%', sub:'PPIs fixed', s:r.correctionRate<5?'ok':r.correctionRate<12?'warn':'bad'},
    {l:'Mean SQI', v:r.meanSQI, sub:'0–1 · conf', s:r.meanSQI>=0.7?'ok':r.meanSQI>=0.5?'warn':'bad'},
    {l:'DFA α1', v:r.dfa1==null?'—':r.dfa1, sub:'0.9–1.2', s:r.dfa1==null?'neutral':(r.dfa1>=0.9&&r.dfa1<=1.2?'ok':'warn')},
  );
  if(r.ledAgreementPct!=null) items.push({l:'3-LED agree', v:r.ledAgreementPct+'%', sub:(r.ledAgree3of3Pct!=null?r.ledAgree3of3Pct+'% all-3 LEDs':'optical bSQI'), s:r.ledAgreementPct>=90?'ok':r.ledAgreementPct>=75?'warn':'bad'});
  $('kpiGrid').innerHTML=items.map(k=>`<div class="kpi ${k.s}"><div class="kpi-label">${k.l}${evBadge(k.l)}</div><div class="kpi-val ${k.s}">${k.v}</div><div class="kpi-sub">${k.sub}</div></div>`).join('');
  $('kpiGrid').classList.add('show'); $('slKPI').style.display='flex';
}

function renderQuality(r){
  const m=r.motion;
  $('qualityCard').innerHTML=`
    <div class="q-grid">
      <div class="q-stat">${evBadge('Analyzable')}<div class="q-val ${r.analyzablePct>=90?'ok':r.analyzablePct>=75?'warn':'bad'}">${r.analyzablePct}%</div><div class="q-lbl">Analyzable</div><div class="q-sub">clean-beat × motion gate</div></div>
      <div class="q-stat"><div class="q-val ${r.cleanBeatPct>=85?'ok':r.cleanBeatPct>=65?'warn':'bad'}">${r.cleanBeatPct}%</div><div class="q-lbl">Clean pulses${evBadge('Clean pulses')}</div><div class="q-sub">SQI ≥ 0.5</div></div>
      <div class="q-stat"><div class="q-val ${r.motionRejectedPct<10?'ok':r.motionRejectedPct<30?'warn':'bad'}">${r.motionRejectedPct}%</div><div class="q-lbl">Motion-rejected${evBadge('Motion-rejected')}</div><div class="q-sub">${m&&m.hasData?'ACC+GYRO':'no ACC/GYRO'}</div></div>
      <div class="q-stat"><div class="q-val ${r.meanSQI>=0.7?'ok':r.meanSQI>=0.5?'warn':'bad'}">${r.meanSQI}</div><div class="q-lbl">Mean SQI${evBadge('Mean SQI')}</div><div class="q-sub">→ Ganglior conf</div></div>
      ${r.ledAgreementPct!=null?`<div class="q-stat"><div class="q-val ${r.ledAgreementPct>=90?'ok':r.ledAgreementPct>=75?'warn':'bad'}">${r.ledAgreementPct}%</div><div class="q-lbl">3-LED agree${evBadge('LED agreement')}</div><div class="q-sub">${r.ledAgree3of3Pct!=null?r.ledAgree3of3Pct+'% all-3':'optical consensus'}</div></div>`:''}
    </div>
    <div class="q-note">Per-pulse SQI = template cross-correlation against the median pulse × the <b>ACC+GYRO motion gate</b>. PPIs &gt;20% off the local median (Malik) are corrected; ${r.nCorrected} of ${r.nPulses.toLocaleString()} fixed. ${m&&m.hasData?`Motion bursts (accel-magnitude variance + gyro magnitude, resampled to the PPG base) <b>down-weight</b> pulses — wrist PPG's signature quality channel that OxyDex/ECGDex don't have. Mean motion index ${m.meanMotionIndex}.`:'<b>No ACC/GYRO loaded</b> — motion gating skipped; load the companion files for the full quality channel.'} SQI feeds the <b>conf</b> of every Ganglior event.</div>
    ${(r.ledSeries&&r.ledSeries.length&&UI.ledRibbon)?`<div class="mini-h" style="margin-top:14px">${evBadge('LED agreement')}3-LED agreement ribbon <span class="mini-sub">green 3/3 · amber 2/3 (kept) · red 1/3 (dropped) · ref ch${r.channel}</span></div>${UI.ledRibbon(r.ledSeries,{W:680,H:120})}<div class="q-note" style="margin-top:4px">The Polar Sense streams 3 optical channels; a beat is kept only when <b>≥2 of 3</b> place a systolic peak within ±50 ms (optical bSQI) — single-LED beats are <b>dropped, not median-filled</b> (${r.nDroppedBeats||0} dropped this session). Low-agreement spans line up with the motion / poor-perfusion windows.</div>`:''}`;
  $('qualitySection').style.display='block';
}

function renderCharts(r){
  const stepT=Math.max(1,Math.floor(r.nn.length/1600));
  const tach=[]; for(let i=0;i<r.nn.length;i+=stepT) tach.push({ x:r.tt[i]/60, y:r.nn[i] });
  $('tachoBody').innerHTML = tach.length>2
    ? UI.lineChart(tach, UI.COLORS.teal, { W:680,H:170, med:r.meanRR, xfmt:x=>x.toFixed(1)+'m' })
    : `<div class="q-note" style="padding:24px 8px;text-align:center">Too few pulse intervals to plot a tachogram.</div>`;
  $('poincareBody').innerHTML = UI.poincare(r.poincareNN||r.nn, r.sd1, r.sd2);
  $('poincareStats').innerHTML = `${evBadge('SD1')}SD1 <b>${r.sd1}</b> ms · ${evBadge('SD2')}SD2 <b>${r.sd2}</b> ms · ${evBadge('SD1/SD2')}SD1/SD2 <b>${r.sd1sd2}</b> · area <b>${(r.ellArea||0).toLocaleString()}</b> ms²`;
  if(r.epochs.length>=3){
    const rmPts=r.epochs.map(e=>({x:e.tMin,y:e.rmssd})), hrPts=r.epochs.map(e=>({x:e.tMin,y:e.hr}));
    $('trendBody').innerHTML=
      `<div class="mini-h">${evBadge('rMSSD')}rMSSD per 5-min epoch <span class="mini-sub">median ${r.rmssd} ms</span></div>`+
      UI.lineChart(rmPts, UI.COLORS.teal, { W:680,H:140, med:r.rmssd, xfmt:x=>(x/60).toFixed(1)+'h' })+
      `<div class="mini-h" style="margin-top:10px">${evBadge('Pulse HR')}Pulse rate per epoch <span class="mini-sub">median ${r.dispHr} bpm</span></div>`+
      UI.lineChart(hrPts, UI.COLORS.blue, { W:680,H:140, med:r.dispHr, xfmt:x=>(x/60).toFixed(1)+'h' });
    $('trendCard').style.display='block';
  } else $('trendCard').style.display='none';
  $('chartsSection').style.display='block';
  // chart card with no inner metric label gets the disc on its title (PPI tachogram)
  (function(){ if(typeof evBadge!=='function')return; const b=document.getElementById('tachoBody'); if(!b)return;
    const c=b.closest('.card'); const h=c&&c.querySelector('.card-h'); if(h&&!h.querySelector('.ev')){ const d=evBadge('Mean RR'); if(d) h.insertAdjacentHTML('afterbegin', d+' '); } })();
}

function renderMorph(r){
  const m=r.morph; if(!m){ $('morphSection').style.display='none'; return; }
  const d=m.delin;
  if(d&&d.valid&&m.medianBeat){
    $('medianBeatBody').innerHTML=UI.medianPulseChart(m.medianBeat,d);
    $('medianBeatStats').innerHTML=`median of <b>${m.medianBeat.nUsed}</b> clean pulses · ${evBadge('Rise time')}rise <b>${d.riseTimeMs}</b> ms · ${d.dicroticNotchPresent?'notch <b>present</b>':'notch <b>not resolved</b>'}${d.augmentationIndexPct!=null?` · AI <b>${d.augmentationIndexPct}%</b>`:''}`;
  } else {
    $('medianBeatBody').innerHTML=`<div class="q-note" style="padding:24px 8px;text-align:center">Too few clean pulses for a stable median-beat template.</div>`;
    $('medianBeatStats').innerHTML='';
  }
  const rows=[
    ['Rise time', m.riseTimeMs, 'ms', 'foot → systolic peak (intersecting-tangent)'],
    ['Pulse width', m.pulseWidthMs, 'ms', 'at half systolic amplitude'],
    ['Dicrotic notch', m.dicroticNotchPresent?'present':'—', '', '2nd-derivative inflection on the downslope'],
    ['Notch time', m.notchTimeMs, 'ms', 'foot → dicrotic notch — wave-reflection timing'],
    ['Augmentation index', m.augmentationIndexPct, '%', '(reflected − systolic) ÷ systolic — arterial stiffness/tone'],
    ['Reflection index', m.reflectionIndex, '', 'diastolic ÷ systolic peak amplitude — wave reflection'],
    ['SDPPG b/a', m.sdppgBA, '', '2nd-derivative b/a ratio (Takazawa) — stiffness/aging; rises toward 0 with stiffness'],
    ['Aging index', m.sdppgAGI, '', '(b−c−d−e)/a — SDPPG vascular-aging index'],
    ['Perfusion index', m.perfusionIndexPct, '%', 'AC ÷ DC — peripheral perfusion / contact'],
  ];
  $('morphMetrics').innerHTML=rows.map(([l,v,u,d2])=>`<div class="morph-row"><div class="mr-l">${typeof evBadge==='function'?evBadge(l):''}${l}</div><div class="mr-v">${v==null?'<span class="dim">—</span>':v+(u?' '+u:'')}</div><div class="mr-d">${d2}</div></div>`).join('');
  // per-window AI / PI drift
  if(m.perWindow&&m.perWindow.length>=3){
    const aiPts=m.perWindow.filter(w=>w.ai!=null).map(w=>({x:w.tMin,y:w.ai}));
    const piPts=m.perWindow.filter(w=>w.pi!=null).map(w=>({x:w.tMin,y:w.pi}));
    let html='';
    if(aiPts.length>=3) html+=`<div class="mini-h">${evBadge('Augmentation index')}Augmentation index drift <span class="mini-sub">vascular tone</span></div>`+UI.lineChart(aiPts, UI.COLORS.amber, { W:680,H:130, xfmt:x=>x.toFixed(0)+'m' });
    if(piPts.length>=3) html+=`<div class="mini-h" style="margin-top:10px">${evBadge('Perfusion index')}Perfusion index drift <span class="mini-sub">AC/DC %</span></div>`+UI.lineChart(piPts, UI.COLORS.green, { W:680,H:130, xfmt:x=>x.toFixed(0)+'m' });
    $('morphTrendBody').innerHTML=html;
    $('morphTrendCard').style.display = html?'block':'none';
  } else $('morphTrendCard').style.display='none';
  $('morphSection').style.display='block';
}

function renderMotion(r){
  const m=r.motion;
  if(!m||!m.hasData){ $('motionCard').innerHTML=`<div class="q-note" style="padding:20px 8px">No ACC/GYRO companion files loaded. Drop the matching <code>*_ACC.txt</code> and <code>*_GYRO.txt</code> for this session to enable the motion gate — PpgDex's signature quality channel.</div>`; $('motionSection').style.display='block'; return; }
  const ribbon = m.series && m.series.length>2 ? UI.lineChart(m.series.map(p=>({x:p.x,y:p.y})), UI.COLORS.purple, { W:680,H:140, ymn:0, ymx:1, xfmt:x=>x.toFixed(0)+'m', med:0.5 }) : '<div class="q-note" style="text-align:center;padding:16px">motion index unavailable</div>';
  $('motionCard').innerHTML=`
    <div class="q-grid">
      <div class="q-stat">${evBadge('Mean motion idx')}<div class="q-val ${m.meanMotionIndex<0.2?'ok':m.meanMotionIndex<0.5?'warn':'bad'}">${m.meanMotionIndex}</div><div class="q-lbl">Mean motion idx</div><div class="q-sub">0 still · 1 moving</div></div>
      <div class="q-stat"><div class="q-val ${r.motionRejectedPct<10?'ok':r.motionRejectedPct<30?'warn':'bad'}">${r.motionRejectedPct}%</div><div class="q-lbl">Pulses rejected${evBadge('Pulses rejected')}</div><div class="q-sub">idx &gt; 0.5</div></div>
      <div class="q-stat"><div class="q-val neutral">${m.accFs||'—'}</div><div class="q-lbl">ACC Hz${evBadge('ACC Hz')}</div><div class="q-sub">${m.nAcc.toLocaleString()} samples</div></div>
      <div class="q-stat"><div class="q-val neutral">${m.gyroFs||'—'}</div><div class="q-lbl">GYRO Hz${evBadge('GYRO Hz')}</div><div class="q-sub">${m.nGyro.toLocaleString()} samples</div></div>
    </div>
    <div class="mini-h" style="margin-top:6px">${evBadge('Mean motion idx')}Motion index (ACC magnitude variance ∪ GYRO magnitude, resampled to PPG base) <span class="mini-sub">band ≥ 0.5 = rejected</span></div>
    ${ribbon}
    <div class="q-note">Purple bands on the waveform scope above mark these high-motion spans. Pulses inside them are down-weighted in HRV and drop the Ganglior <b>conf</b>; sustained bursts emit a <code>motion_artifact_segment</code> impulse.</div>
    ${(()=>{ if(!m.postureAtSec && !m.hasMag && !(r.epochs&&r.epochs.some(e=>e.position&&e.position!=='unknown'))) return '';
      const pc={}; (r.epochs||[]).forEach(e=>{ if(e.position){ pc[e.position]=(pc[e.position]||0)+1; } });
      const tot=(r.epochs||[]).length||1;
      const chip=(p,pct,interf)=>`<span style="display:inline-flex;gap:6px;align-items:center;padding:3px 10px;border:1px solid var(--line,#22303a);border-radius:999px;font-size:12px;margin:4px 6px 0 0;${interf?'opacity:.6':''}">${p}<b style="color:var(--teal,#3DE0D0)">${pct}%</b></span>`;
      const rows=Object.entries(pc).sort((a,b)=>b[1]-a[1]).map(([p,n])=>chip(p,Math.round(n/tot*100))).join('') || '<span class="dim">insufficient coverage (&lt;30 s/epoch)</span>';
      const mag = m.hasMag
        ? `<div class="q-note" style="margin-top:8px"><b>Magnetometer ✓</b> ${(m.nMag||0).toLocaleString()} samples @ ${m.magFs||'—'} Hz · |B| baseline ${m.magBaseG} G · L/R datum ${m.refHeadingDeg!=null?m.refHeadingDeg+'°':'—'} <span class="dim">(relative)</span>. Splits <code>lateral</code> → <code>lateral_L/R</code> via tilt-compensated heading; <code>magInterference</code> on <b>${r.magInterferencePct!=null?r.magInterferencePct:0}%</b> of epochs — informational, does <b>not</b> alter SQI. <span class="dim">Earth-field-scale only · not biomagnetic HR.</span></div>`
        : `<div class="q-note dim" style="margin-top:8px">No <code>*_MAGN.txt</code> for this session — L/R lateral merged as <code>lateral</code>. Drop the MAGN file to disambiguate sides + flag magnetic artifacts.</div>`;
      return `<div class="mini-h" style="margin-top:12px">${typeof evBadge==='function'?evBadge('Limb position'):''}Limb position <span class="mini-sub">ACC gravity${m.hasMag?' + MAGN heading':''} · per-epoch in export</span></div><div style="display:flex;flex-wrap:wrap">${rows}</div>${mag}`;
    })()}`;
  $('motionSection').style.display='block';
}

function renderValidation(r){
  const v=r.validation;
  let body;
  if(!v||!v.hasData){
    body=`<div class="q-note" style="padding:20px 8px">No device <code>*_PPI.txt</code> loaded (or it's empty — the Polar Sense streams PP-intervals only on some firmware). PpgDex's <b>self-PPI</b> from the raw waveform stands alone; load the device PPI file to cross-validate. <span class="dim">This is a validation lane only — self-PPI is never replaced by device PPI, and PPI is never handed to PulseDex.</span></div>`;
  } else if(!v.usable){
    body=`<div class="q-note" style="padding:20px 8px">Device PPI present (${v.nDevice} interval${v.nDevice===1?'':'s'}) but too sparse / blocker-flagged to validate against. Showing self-PPI only.</div>`;
  } else {
    body=`<div class="q-grid">
      <div class="q-stat">${evBadge('Agreement')}<div class="q-val ${v.deviceAgreementPct>=95?'ok':v.deviceAgreementPct>=88?'warn':'bad'}">${v.deviceAgreementPct}%</div><div class="q-lbl">Agreement</div><div class="q-sub">self vs device mean</div></div>
      <div class="q-stat"><div class="q-val neutral">${v.meanAbsDevMs}</div><div class="q-lbl">Mean abs dev${evBadge('Mean abs dev')}</div><div class="q-sub">ms</div></div>
      <div class="q-stat"><div class="q-val neutral">${v.selfMean}/${v.devMean}</div><div class="q-lbl">Mean PPI${evBadge('Mean PPI')}</div><div class="q-sub">self / device ms</div></div>
      <div class="q-stat"><div class="q-val neutral">${v.selfRMSSD}/${v.devRMSSD}</div><div class="q-lbl">rMSSD${evBadge('rMSSD')}</div><div class="q-sub">self / device ms</div></div>
    </div>
    <div class="q-note">Self-PPI (${v.nSelf} intervals detected from the optical waveform) cross-checked against the device's on-board PP-intervals (${v.nDevice} clean). This proves the extracted intervals are trustworthy — the value-add over a node that's simply <i>handed</i> RR/PPI.</div>`;
  }
  $('validationCard').innerHTML=body;
  $('validationSection').style.display='block';
}

function renderGanglior(r){
  const ev=r.events||[];
  const counts={};
  ev.forEach(e=>{ counts[e.impulse]=(counts[e.impulse]||0)+1; });
  const chip=(k,col)=>counts[k]?`<span class="g-chip ${col}">${counts[k]} ${k}</span>`:'';
  $('gangliorSummary').innerHTML = ev.length
    ? chip('hrv_drop','bad')+chip('autonomic_surge','warn')+chip('cvhr_cluster','bad')+chip('perfusion_drop','warn')+chip('motion_artifact_segment','neutral')+chip('pulse_morphology_shift','warn')+chip('contact_loss','bad')
    : '<span class="g-chip ok">no events — clean window</span>';
  const rows = ev.slice(0,60).map(e=>`<tr><td class="mono">${e.t}</td><td>${e.impulse}</td><td class="mono">${e.conf}</td><td class="mono dim">${e.meta?Object.entries(e.meta).map(([k,val])=>k+':'+val).join(' '):''}</td></tr>`).join('');
  $('gangliorBody').innerHTML = ev.length
    ? `<table class="data-table"><thead><tr><th>t (wall)</th><th>impulse</th><th>conf</th><th>meta</th></tr></thead><tbody>${rows}</tbody></table>${ev.length>60?`<div class="dim" style="padding:6px 4px">+${ev.length-60} more in export</div>`:''}`
    : `<div class="q-note" style="padding:16px 8px;text-align:center">No events emitted — no HRV collapse, perfusion drop, or sustained motion this session.</div>`;
  $('gangliorSection').style.display='block';
}

function renderTable(r){
  const f=r._fmt||DSP;
  const fr=v=>v==null?'<span class="dim">—</span>':v;
  // status pill — mirrors OxyDex's Full Metrics Table (OK / WATCH / FLAG)
  const pill=st=> st==='ok'?'<span class="pill pill-green">OK</span>'
    : st==='warn'?'<span class="pill pill-yellow">WATCH</span>'
    : st==='bad'?'<span class="pill pill-red">FLAG</span>'
    : '<span class="dim">—</span>';
  // rows: [metric, value, unit, note, status?] — status optional, '' ⇒ no pill.
  const sec=(title,rows)=>`<tr class="tbl-sec"><td colspan="5">${title}</td></tr>`+rows.map(([m,v,u,n,st])=>
    `<tr><td class="fmt-m">${evBadge(m)}${m}</td><td class="mono ${st||''}">${fr(v)}</td><td class="dim">${u||''}</td><td>${pill(st||'')}</td><td class="dim">${n||''}</td></tr>`).join('');
  const fq=r.freq||{};
  const us=r.tier==='ultra-short';
  let html=`<table class="data-table"><thead><tr><th>Metric</th><th>Value</th><th>Unit</th><th>Status</th><th>Note</th></tr></thead><tbody>`;
  html+=sec('Recording', [
    ['Start (wall clock)', f.fmtDateTime(r.t0Ms), '', 'floating tMs · getUTC*'],
    ['Duration', r.durMin, 'min', r.tier, us?'warn':'ok'],
    ['Sample rate', r.fs, 'Hz', 'median ns delta'],
    ['Channel used', 'ch'+r.channel, '', 'best SNR of 3 green'],
    ['Pulses detected', r.nPulses, '', 'optical foot/peak'],
  ]);
  html+=sec('Time-domain HRV (PPI-derived)', [
    ['Mean PPI', r.meanRR, 'ms', 'pulse-to-pulse'],
    ['Pulse rate', r.dispHr, 'bpm', '', hrStat(r.dispHr)],
    ['SDNN', (r.sdnnRobust!=null?r.sdnnRobust:r.sdnn), 'ms', us?'needs ≥5 min':(r.sdnnRobust!=null?'robust · per-5-min median':'≥50 good'), us?'':sc(r.sdnnRobust!=null?r.sdnnRobust:r.sdnn,50,30)],
    ['rMSSD', r.rmssd, 'ms', 'parasympathetic · ≥30 good', sc(r.rmssd,30,20)],
    ['pNN50', r.pnn50, '%', ''],
    ['ln rMSSD', r.lnRMSSD, '', ''],
    ['Triangular index', r.triIdx, '', ''],
  ]);
  html+=sec('Poincaré', [
    ['SD1', r.sd1, 'ms', 'short-term'],
    ['SD2', r.sd2, 'ms', 'long-term'],
    ['SD1/SD2', r.sd1sd2, '', ''],
    ['Ellipse area', r.ellArea, 'ms²', ''],
  ]);
  html+=sec('Frequency (Lomb–Scargle)', [
    ['VLF', fq.vlf, 'ms²', ''],
    ['LF', fq.lf, 'ms²', ''],
    ['HF', fq.hf, 'ms²', ''],
    ['LF/HF', fq.lfhf, '', 'sympatho-vagal'],
    ['LF n.u.', fq.lfnu, 'n.u.', ''],
    ['HF n.u.', fq.hfnu, 'n.u.', ''],
    ['Total power', fq.totalPower, 'ms²', ''],
  ]);
  html+=sec('Nonlinear', [
    ['DFA α1', r.dfa1, '', '0.9–1.2 healthy', r.dfa1==null?'':(r.dfa1>=0.9&&r.dfa1<=1.2?'ok':'warn')],
    ['SampEn', r.sampen, '', 'complexity'],
  ]);
  if(r.morph) html+=sec('Pulse-wave morphology', [
    ['Rise time', r.morph.riseTimeMs, 'ms', 'foot→systolic'],
    ['Pulse width', r.morph.pulseWidthMs, 'ms', 'half-amplitude'],
    ['Dicrotic notch', r.morph.dicroticNotchPresent?'present':'—', '', '', r.morph.dicroticNotchPresent?'ok':''],
    ['Notch time', r.morph.notchTimeMs, 'ms', 'foot→notch'],
    ['Augmentation index', r.morph.augmentationIndexPct, '%', 'stiffness/tone'],
    ['Reflection index', r.morph.reflectionIndex, '', 'wave reflection'],
    ['SDPPG b/a', r.morph.sdppgBA, '', 'stiffness/aging (Takazawa)'],
    ['Aging index', r.morph.sdppgAGI, '', '(b−c−d−e)/a'],
    ['Perfusion index', r.morph.perfusionIndexPct, '%', 'AC/DC',
      r.morph.perfusionIndexPct==null?'':(r.morph.perfusionIndexPct>=1?'ok':r.morph.perfusionIndexPct>=0.4?'warn':'bad')],
  ]);
  html+=sec('Quality', [
    ['Analyzable', r.analyzablePct, '%', '', r.analyzablePct>=90?'ok':r.analyzablePct>=75?'warn':'bad'],
    ['Clean beats', r.cleanBeatPct, '%', 'SQI≥0.5', r.cleanBeatPct>=85?'ok':r.cleanBeatPct>=65?'warn':'bad'],
    ['Mean SQI', r.meanSQI, '', '0–1 · conf', r.meanSQI>=0.7?'ok':r.meanSQI>=0.5?'warn':'bad'],
    ['Motion-rejected', r.motionRejectedPct, '%', r.motion&&r.motion.hasData?'ACC+GYRO':'n/a',
      r.motionRejectedPct<10?'ok':r.motionRejectedPct<30?'warn':'bad'],
    ['Correction rate', r.correctionRate, '%', 'PPIs fixed', r.correctionRate<5?'ok':r.correctionRate<12?'warn':'bad'],
  ]);
  html+='</tbody></table>';
  $('metricsTable').innerHTML=html;
  $('tableSection').style.display='block';
}

// ════════════════════════════════════════════════════════════════════════
//  SESSION SWITCHER + CROSS-NIGHT
// ════════════════════════════════════════════════════════════════════════
function sessionsSorted(){ return Object.values(allSessions).sort((a,b)=>(a.t0Ms||0)-(b.t0Ms||0)); }
function renderSwitcher(){
  const list=sessionsSorted();
  const wrap=$('sessionSwitcher');
  if(list.length<=1){ wrap.style.display='none'; return; }
  wrap.style.display='block';
  wrap.innerHTML=`<div class="sec-label">Sessions · ${list.length}</div>`+list.map(s=>{
    const key=s.t0Ms!=null?String(s.t0Ms):('nodate_'+s.fname);
    const active=key===activeKey;
    const q=s.analyzablePct>=90?'ok':s.analyzablePct>=75?'warn':'bad';
    return `<button class="sess-item ${active?'active':''}" data-key="${key}">
      <div class="si-top"><span class="si-date">${DSP.fmtDateTime(s.t0Ms)}</span><span class="si-q ${q}">${s.analyzablePct}%</span></div>
      <div class="si-sub">${s.durMin} min · ${s.dispHr} bpm · rMSSD ${s.rmssd}</div></button>`;
  }).join('');
  wrap.querySelectorAll('.sess-item').forEach(btn=>btn.addEventListener('click',()=>{
    activeKey=btn.getAttribute('data-key'); try{ localStorage.setItem('ppgdex_active',activeKey); }catch(e){}
    renderSession(allSessions[activeKey]);
  }));
}

function renderCrossNight(){
  const list=sessionsSorted();
  const card=$('crossNightSection');
  if(list.length<2){ card.style.display='none'; return; }
  card.style.display='block';
  const CN=window.PPGCross;
  const metrics=[
    {k:'rmssd', label:'rMSSD', unit:'ms', good:'up', get:s=>s.rmssd},
    {k:'sdnn', label:'SDNN', unit:'ms', good:'up', get:s=>s.sdnn},
    {k:'hr', label:'Pulse HR', unit:'bpm', good:'down', get:s=>s.dispHr},
    {k:'pi', label:'Perfusion', unit:'%', good:'up', get:s=>s.perfusionIndex},
    {k:'ai', label:'Aug. index', unit:'%', good:'down', get:s=>s.morph?s.morph.augmentationIndexPct:null},
    {k:'motion', label:'Motion-rej', unit:'%', good:'down', get:s=>s.motionRejectedPct},
  ];
  const cov=list.map(s=>Math.max(0.05,(s.analyzablePct||0)/100));
  let rows='';
  const headline=[];
  metrics.forEach(m=>{
    const series=list.map((s,i)=>({ x:i, t:s.t0Ms, v:m.get(s), w:cov[i] })).filter(p=>p.v!=null&&isFinite(p.v));
    if(series.length<2){ return; }
    const st=CN.crossNight(series, { good:m.good });
    const spark=UI.lineChart(series.map(p=>({x:p.x,y:p.v})), trendColor(st.trendLabel,m.good), { W:220,H:54, med:st.mean });
    const zCol=st.zLatest==null?'neutral':(Math.abs(st.zLatest)>=DexKernel.K.Z_BAD?'bad':Math.abs(st.zLatest)>=DexKernel.K.Z_WARN?'warn':'ok');
    const trCol=st.trendLabel==='improving'?'ok':st.trendLabel==='declining'?'bad':'neutral';
    rows+=`<tr>
      <td class="cn-metric fmt-m">${evBadge(m.label)}${m.label}<span class="dim"> ${m.unit}</span></td>
      <td class="cn-spark">${spark}</td>
      <td class="mono">${st.mean}<span class="dim"> ±${st.sd}</span></td>
      <td class="mono">${st.cv}%</td>
      <td class="mono">${st.slopePerDay==null?'—':(st.slopePerDay>0?'+':'')+st.slopePerDay}<span class="dim">/d</span></td>
      <td class="mono">${st.tau==null?'—':st.tau} <span class="dim">p${st.p==null?'—':st.p}</span></td>
      <td><span class="cn-trend ${trCol}">${st.trendLabel}</span></td>
      <td class="mono"><span class="cn-z ${zCol}">${st.zLatest==null?'—':(st.zLatest>0?'+':'')+st.zLatest+'σ'}</span></td>
    </tr>`;
    if(st.zLatest!=null && Math.abs(st.zLatest)>=DexKernel.K.Z_HEADLINE) headline.push(`${m.label} ${st.zLatest>0?'+':''}${st.zLatest}σ vs your ${st.n}-night baseline`);
    if(st.ci && (st.ci[0]>0 || st.ci[1]<0) && st.n>=7) headline.push(`${m.label} shifted ${st.deltaHalves>0?'+':''}${st.deltaHalves}${m.unit} (95% CI excludes 0)`);
  });
  $('crossNightTable').innerHTML=`<table class="data-table cn-table"><thead><tr><th>Metric</th><th>Trend</th><th>Mean</th><th>CV</th><th>Slope</th><th>Mann–Kendall</th><th>Direction</th><th>Latest z</th></tr></thead><tbody>${rows}</tbody></table>`;
  $('crossNightHeadline').innerHTML = headline.length
    ? `<div class="cn-head-label">Newest night vs baseline</div>`+headline.slice(0,3).map(h=>`<div class="cn-head-item">${h}</div>`).join('')
    : `<div class="cn-head-label">Newest night vs baseline</div><div class="cn-head-item dim">No metric is beyond ±1σ of its personal baseline — a consistent night.</div>`;
  $('crossNightNote').innerHTML=`${list.length} sessions · OLS slope vs date + non-parametric <b>Mann–Kendall</b> (τ, p) for short noisy series · personal-baseline <b>z-scores</b> · coverage-weighted by each night's analyzable %. The same <code>crossNight()</code> engine powers ECGDex &amp; OxyDex trends.`;
}
function trendColor(label,good){ if(label==='improving') return UI.COLORS.green; if(label==='declining') return UI.COLORS.red; return UI.COLORS.blue; }

// ════════════════════════════════════════════════════════════════════════
//  EXPORTS
// ════════════════════════════════════════════════════════════════════════
// null-safe numeric rounding for exported epoch fields (mirrors ECGDex/GlucoDex round()):
// kills float noise (42.317480… → 42.32) in JSON/CSV; null/NaN/non-number pass through unchanged.
function _round(v,d=2){ return (v==null||typeof v!=='number'||!isFinite(v)) ? (v==null?null:v) : +v.toFixed(d); }
function buildV2(r){
  const fq=r.freq||{}; const m=r.morph||{};
  const epochs=r.epochs.map(e=>({ tMin:e.tMin, beats:e.beats, hr:_round(e.hr,1), meanRR:_round(e.meanRR,1), rmssd:_round(e.rmssd,2), sdnn:_round(e.sdnn,2), pnn50:_round(e.pnn50,1), lf:_round(e.lf,1), hf:_round(e.hf,1), lfhf:_round(e.lfhf,3), respRate:_round(e.respRate,1), pi:_round(e.pi,1), motionIndex:_round(e.motionIndex,3), ledAgreementPct:_round(e.ledAgreementPct,0), position:e.position||'unknown', positionConf:_round(e.positionConf,2), headingDeg:_round(e.headingDeg,1), magInterference:!!e.magInterference }));
  return {
    kernel:(window.DexKernel?{version:DexKernel.VERSION,hash:DexKernel.HASH}:null),
    schema:{ name:'ganglior.node-export', version:'2.0', node:'PpgDex', nodeVersion:'1.0',
      generated:new Date().toISOString(),
      provenance:(window.GangliorProvenance?GangliorProvenance.stamp():null),   // R1: build + input fingerprints
      doc:'Single-signal wrist-PPG node. Floating wall-clock tMs (Clock Contract). Single-site → no SpO₂/PTT/BP; 2-site fusion lives in the Integrator.',
      units:{ ppi:'ms', rmssd:'ms', sdnn:'ms', hr:'bpm', power:'ms^2', pi:'%', riseTime:'ms', ai:'%', motionIndex:'0..1', headingDeg:'deg', positionConf:'0..1' } },
    recording:{ source:r.fname||'wrist-ppg', device:'Polar Sense', sampleRateHz:r.fs, durationSec:Math.round(r.durSec),
      durationMin:r.durMin, startEpochMs:r.t0Ms, offsetMin:r.offsetMin, beats:r.nPulses, channel:r.channel, epochs5min:r.epochs.length, tier:r.tier,
      cpapInUse:(r.cpapInUse!=null?r.cpapInUse:(r.profile&&r.profile.cpap!=null?r.profile.cpap:null)) },
    quality:{ analyzablePct:r.analyzablePct, cleanBeatPct:r.cleanBeatPct, coveragePct:r.coveragePct,
      meanSQI:r.meanSQI, motionRejectedPct:r.motionRejectedPct, correctionRatePct:r.correctionRate,
      ledAgreementPct:(r.ledAgreementPct!=null?r.ledAgreementPct:null), ledAgree3of3Pct:(r.ledAgree3of3Pct!=null?r.ledAgree3of3Pct:null), droppedBeats:(r.nDroppedBeats!=null?r.nDroppedBeats:null),
      magInterferencePct:(r.magInterferencePct!=null?r.magInterferencePct:null),
      deviceAgreementPct:r.validation&&r.validation.usable?r.validation.deviceAgreementPct:null },
    hrv:{ time:{ meanRR:r.meanRR, hr:r.dispHr, sdnn:r.sdnn, rmssd:r.rmssd, pnn50:r.pnn50, lnRMSSD:r.lnRMSSD, triIdx:r.triIdx,
        sdnnIndex:(r.sdnnIndex!=null?r.sdnnIndex:null), sdnnRobust:(r.sdnnRobust!=null?r.sdnnRobust:null), sd2Robust:(r.sd2Robust!=null?r.sd2Robust:null),
        window:'wholeRecord', units:'ms', lowConfidence:!!r.hrvLowConfidence, lowConfidenceReason:(r.hrvLowConfidenceReason||null),
        windowNote:'sdnn/rmssd are whole-record (single-site PPG); per-5-min values live in epochs[]. Directly comparable to another node\u2019s wholeRecord SDNN/RMSSD.',
        sdnnNote:'whole-record sdnn runs high on optical (SDANN/baseline-wander inflation, ~+26% vs chest ECG). sdnnIndex = mean of per-5-min SDNN (~+18%); sdnnRobust = quality-gated MEDIAN of per-5-min SDNN (~+3.5% vs ECG truth) \u2014 use sdnnRobust for cross-node SDNN comparison.' },
      poincare:{ sd1:r.sd1, sd2:r.sd2, sd1sd2:r.sd1sd2, ellipseArea:r.ellArea },
      frequency:{ vlf:fq.vlf, lf:fq.lf, hf:fq.hf, lfhf:fq.lfhf, lfnu:fq.lfnu, hfnu:fq.hfnu, totalPower:fq.totalPower, method:'Lomb-Scargle', lowConfidence:!!r.hrvLowConfidence, lfRobust:(r.lfRobust!=null?r.lfRobust:null), hfRobust:(r.hfRobust!=null?r.hfRobust:null), lfhfRobust:(r.lfhfRobust!=null?r.lfhfRobust:null), hfRobustLowMotion:(r.hfRobustLowMotion!=null?r.hfRobustLowMotion:null) },
      nonlinear:{ dfaAlpha1:r.dfa1, sampEn:r.sampen },
      confidence:(r.hrvConfidence||null) },
    // DEEP-AUDIT §19 — the raw profile shipped the POPULATION DEFAULT (42 y · M · 80 kg · 178 cm) as
    // though the user had entered it. Split it: `profile` = only what was actually entered/detected,
    // `assumedDefaults` = the priors COMPUTE ran on. Tolerates a profile with no _origins (legacy).
    personalization:{ profile:(function(){
        var pr = r.profile || null; if (!pr || typeof pr !== 'object') return pr || null;
        var o = pr._origins || null;
        var ent = function (f, v) { return (o && (o[f]==='you' || o[f]==='detected')) ? v : null; };
        return { age:ent('age',pr.age), sex:ent('sex',pr.sex), weight:ent('weight',pr.weight),
                 height:ent('height',pr.height), elev:ent('elevation',pr.elev), cpap:ent('cpap',pr.cpap),
                 hrmax:(pr.hrmax>0?pr.hrmax:null), rhr:(pr.rhr>0?pr.rhr:null), vo2gt:(pr.vo2gt>0?pr.vo2gt:null),
                 note:'Only what the user entered/selected, or a node detected. null = left on auto/default.' };
      })(),
      assumedDefaults:(function(){
        var pr = r.profile || null; if (!pr || typeof pr !== 'object') return null;
        var o = pr._origins || null;
        var asm = function (f, v) { return (o && (o[f]==='you' || o[f]==='detected')) ? null : v; };
        return { age:asm('age',pr.age), sex:asm('sex',pr.sex), weight:asm('weight',pr.weight),
                 height:asm('height',pr.height), elev:asm('elevation',pr.elev),
                 source:'population norm (NHANES age×sex) — the value the analysis ran on',
                 note:'NOT a measurement of this person.' };
      })(),
      ansReadinessScore:r.hrvScore, ansAge:null, /* ANS Age REMOVED 2026-06-21 (external-review WP-A); null for node-export back-compat. */
      restingHR:r.rhrEff, vo2maxEst:r.vo2adj, expectedRmssd:r.expRmssd },
    apnea: r.longRec ? { screen:'CVHR (PPI-derived bradycardia-rebound)', note:'screen not diagnosis', index:null } : null,
    morphology:{ riseTimeMs:m.riseTimeMs, crestTimeMs:m.crestTimeMs, dicroticNotchPresent:!!m.dicroticNotchPresent,
      augmentationIndexPct:m.augmentationIndexPct, reflectionIndex:m.reflectionIndex, pulseWidthMs:m.pulseWidthMs,
      notchTimeMs:m.notchTimeMs, sdppgBA:m.sdppgBA, sdppgAGI:m.sdppgAGI,
      perfusionIndexPct:m.perfusionIndexPct,
      medianBeat: m.medianBeat ? { fs:m.medianBeat.fs, pre:m.medianBeat.pre, nUsed:m.medianBeat.nUsed, samples:Array.from(m.medianBeat.beat).map(v=>+v.toFixed(4)) } : null,
      perWindow: m.perWindow||[] },
    validation: r.validation&&r.validation.usable ? { deviceAgreementPct:r.validation.deviceAgreementPct, meanAbsDevMs:r.validation.meanAbsDevMs,
      beatsCompared:r.validation.nSelf, correctedPct:r.correctionRate, note:'self-PPI vs device PPI; validation lane only — PPI not handed to PulseDex' } : { note:'no usable device PPI' },
    motion: r.motion&&r.motion.hasData ? { meanMotionIndex:r.motion.meanMotionIndex, motionRejectedPct:r.motionRejectedPct,
      source:'ACC+GYRO', accFs:r.motion.accFs, gyroFs:r.motion.gyroFs, perEpochMotion:r.epochs.map(e=>e.motionIndex),
      position: r.motion.postureAtSec ? { source:(r.motion.hasMag?'limb-acc+mag':'limb-acc'), reliability:'low',
        note:'Per-epoch body position is in epochs[].position (+positionConf, +headingDeg, +magInterference). Derived from the limb-worn ACC gravity vector — Polar Sense sits on the WRIST or ANKLE (site not auto-detected), so this is limb orientation, an approximate body-position proxy. Integrator MUST down-weight vs ECGDex chest-strap posture.',
        magnetometer: r.motion.hasMag ? { present:true, headingRef:'relative', magFs:r.motion.magFs, magBaseG:r.motion.magBaseG, refHeadingDeg:r.motion.refHeadingDeg, magInterferencePct:r.magInterferencePct,
          note:'Earth-field-scale only (~0.15 µT LSB). Splits merged lateral into lateral_L/lateral_R via tilt-compensated heading offset from a supine/upright datum — L/R labels are RELATIVE (may be mirrored without a calibration gesture). magInterference is an informational artifact flag; it does NOT modify beat SQI/conf here. NOT biomagnetic HR (cardiac field ~3000× below one LSB).' } : { present:false },
        breakdown:(()=>{ const t={}; r.epochs.forEach(e=>{ if(e.position){ t[e.position]=(t[e.position]||0)+1; } }); const tot=r.epochs.length||1; return Object.entries(t).map(([p,n])=>({ position:p, pct:Math.round(n/tot*100) })).sort((a,b)=>b.pct-a.pct); })() } : { source:'none', note:'no ACC — position unavailable' } } : { source:'none', note:'no ACC/GYRO loaded' },
    timeseries:{ doc:'5-min epochs — primary cross-node feed', epochs, markers:(r.markers||[]).map(mk=>({ relSec:+mk.relSec.toFixed(2), type:mk.type })) },
    ganglior_events: r.events.map(e=>({ t:e.t, tMs:e.tMs, impulse:e.impulse, node:e.node, conf:e.conf, meta:e.meta })),
    reserved:{ doc:'hooks for the Integrator 2-site fusion', ptt:null, pttSource:'Integrator',
      deltaSBP:null, deltaSBPSource:'Integrator (wrist⟷fingertip PTT)', spo2Correlation:null, spo2Source:'OxyDex' }
  };
}
function exportJSON(){
  const list=sessionsSorted();
  if(!list.length) return;
  // EXPORT-HYGIENE §2/§2.4: recording-anchored, span-aware filename via the shared exportName().
  const _ts=list.map(x=>x.t0Ms).filter(v=>v!=null);
  const _aT0=_ts.length?Math.min.apply(null,_ts):null;
  const _aSpan=_ts.length>1?Math.round((Math.max.apply(null,_ts)-Math.min.apply(null,_ts))/864e5):null;
  let payload;
  if(list.length===1){ payload=buildV2(list[0]); }
  else {
    payload={ kernel:(window.DexKernel?{version:DexKernel.VERSION,hash:DexKernel.HASH}:null), schema:{ name:'ganglior.node-export', version:'2.0', node:'PpgDex', multiSession:true, generated:new Date().toISOString(), provenance:(window.GangliorProvenance?GangliorProvenance.stamp():null) },
      generated:new Date().toISOString(), sessionCount:list.length,
      crossNight: buildCrossNightEnvelope(list),
      sessions: list.map(buildV2) };
  }
  download(JSON.stringify(payload,null,2), exportName({node:'PpgDex',t0Ms:_aT0,kind:(list.length>1?'series':'summary'),ext:'json',spanDays:_aSpan}), 'application/json;charset=utf-8');
}

// ═══════════════════════════════════════════════════════════════════════════
//  SELF-INGEST review mode (SELF-INGEST-FOLLOWUPS · PpgDex pass, export-inert)
//  A dropped PpgDex OWN node-export → a faithful clinical VIEW from the stored
//  hrv/quality summary + events. No recompute, no re-stamp; the optical waveform,
//  LED-agreement ribbon + per-beat Poincaré are greyed (raw not carried).
// ═══════════════════════════════════════════════════════════════════════
function _pgesc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function _pgD(tMs){ if(tMs==null) return '\u2014'; var d=new Date(tMs); return d.getUTCFullYear()+'-'+('0'+(d.getUTCMonth()+1)).slice(-2)+'-'+('0'+d.getUTCDate()).slice(-2); }
function _pgFmtGen(g){ if(!g) return ''; try{ return String(g).replace('T',' ').replace(/\..*$/,'').replace(/Z$/,' UTC'); }catch(e){ return String(g); } }
function _ppgInjectReviewCSS(){
  if(typeof document==='undefined'||document.getElementById('ppg-selfingest-css')) return;
  var css=''
   + '#ppgReviewCard{margin:0 0 22px}'
   + '.pgrv-banner{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;margin:0 0 18px;padding:13px 18px;border-radius:12px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.28);font-size:13px;color:var(--text2,#9FB0C3);line-height:1.5}'
   + '.pgrv-tag{display:inline-flex;align-items:center;gap:6px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:11px;color:var(--amber,#F59E0B)}'
   + '.pgrv-dot{width:8px;height:8px;border-radius:50%;background:var(--amber,#F59E0B)}'
   + '.pgrv-meta code{font-family:ui-monospace,monospace;color:var(--text2,#9FB0C3)}'
   + '.pgrv-spacer{flex:1 1 auto}'
   + '.pgrv-print{display:inline-flex;align-items:center;gap:7px;cursor:pointer;padding:8px 15px;border-radius:9px;border:1px solid rgba(61,224,208,.4);background:rgba(61,224,208,.12);color:var(--teal,#3DE0D0);font-size:12.5px;font-weight:700}'
   + '.pgrv-card{padding:24px 26px;border-radius:14px;background:var(--surface,#10151D);border:1px solid var(--border,#1f2e45)}'
   + '.pgrv-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;padding-bottom:14px;margin-bottom:16px;border-bottom:1px solid var(--border,#1f2e45)}'
   + '.pgrv-title{font-size:19px;font-weight:800;color:var(--text,#E6EDF5)}'
   + '.pgrv-sub{font-size:13px;color:var(--text3,#5E7187)}'
   + '.pgrv-sec{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text3,#5E7187);margin:18px 0 9px}'
   + '.pgrv-imp{font-size:14px;line-height:1.55;color:var(--text2,#9FB0C3)}'
   + '.pgrv-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}'
   + '.pgrv-kpi{padding:12px 14px;border-radius:10px;background:var(--surface2,#0C0F15);border:1px solid var(--border,#1f2e45)}'
   + '.pgrv-kpi .k-lab{font-size:11px;color:var(--text3,#5E7187);margin-bottom:5px}'
   + '.pgrv-kpi .k-val{font-size:21px;font-weight:800;color:var(--text,#E6EDF5)}'
   + '.pgrv-kpi .k-sub{font-size:10.5px;color:var(--text3,#5E7187);margin-top:3px}'
   + '.pgrv-tl{display:flex;flex-direction:column;border:1px solid var(--border,#1f2e45);border-radius:10px;overflow:hidden}'
   + '.pgrv-tlrow{display:grid;grid-template-columns:110px 1fr auto;align-items:center;gap:10px;padding:8px 13px;font-size:12.5px;border-top:1px solid var(--border,#1f2e45)}'
   + '.pgrv-tlrow:first-child{border-top:none}'
   + '.pgrv-tlrow .tl-t{font-family:ui-monospace,monospace;color:var(--text3,#5E7187);font-size:12px}'
   + '.pgrv-none{font-size:13px;color:var(--text3,#5E7187);font-style:italic;padding:6px 2px}'
   + '.pgrv-greyed{border:1px dashed var(--border,#1f2e45);border-radius:12px;padding:20px;margin-top:4px;background:repeating-linear-gradient(135deg,rgba(255,255,255,.012) 0 10px,transparent 10px 20px);color:var(--text3,#5E7187);font-size:12.5px;text-align:center}'
   + '.pgrv-greyed strong{display:block;color:var(--text2,#9FB0C3);font-size:13px;margin-bottom:4px}'
   + '.pgrv-disc{margin-top:20px;padding-top:14px;border-top:1px solid var(--border,#1f2e45);font-size:11px;line-height:1.55;color:var(--text3,#5E7187)}'
   + '.pgrv-disc .dxl{font-weight:700;color:var(--text2,#9FB0C3)}'
   + '@media print{body > *:not(#ppgReviewCard){display:none !important} #ppgReviewCard .pgrv-print{display:none !important}}';
  var st=document.createElement('style'); st.id='ppg-selfingest-css'; st.textContent=css;
  (document.head||document.documentElement).appendChild(st);
}
function ppgReviewTimeline(events){
  var evs=Array.isArray(events)?events.slice():[];
  if(!evs.length) return '<div class="pgrv-none">No scored events in this export.</div>';
  evs.sort(function(a,b){return (a.tMs||0)-(b.tMs||0);});
  var nm=function(e){ var i=e.impulse||'event'; if(i==='autonomic_surge') return 'Autonomic surge'; if(i==='hrv_drop') return 'HRV drop'; if(i==='motion_artifact_segment') return 'Motion artifact'; return i; };
  var h='<div class="pgrv-tl">'+evs.slice(0,40).map(function(e){ return '<div class="pgrv-tlrow"><span class="tl-t">'+_pgesc(_pgD(e.tMs)+' '+(e.t||''))+'</span><span>'+_pgesc(nm(e))+'</span><span class="tl-t">conf '+(e.conf!=null?e.conf:'\u2014')+'</span></div>'; }).join('')+'</div>';
  if(evs.length>40) h+='<div class="pgrv-none">+ '+(evs.length-40)+' more events</div>';
  return h;
}
function ppgReviewView(review){
  var rec=review.recording||{}, hrv=review.hrv||{}, t=hrv.time||{}, fq=hrv.frequency||{}, q=review.quality||{};
  var prov=review.provenance||{}, bh=prov.buildHash||(review.derivedFrom&&review.derivedFrom.buildHash)||null, gen=_pgFmtGen(prov.generated||review.generated);
  var nv=function(v,d){ return (v==null||Number.isNaN(v))?(d||'\u2014'):v; };
  var h='<div class="pgrv-banner" role="status">'
    +'<span class="pgrv-tag"><span class="pgrv-dot"></span>Review mode</span>'
    +'<span>Loaded from export \u00b7 <strong>not recomputed</strong>'+(review.scrubbed?' \u00b7 <strong>scrubbed for sharing</strong>':'')+'</span>'
    +'<span class="pgrv-meta">'+(bh?'built <code>'+_pgesc(bh)+'</code>':'build unknown')+(gen?' on <code>'+_pgesc(gen)+'</code>':'')+'</span>'
    +'<span class="pgrv-spacer"></span>'
    +'<button class="pgrv-print" type="button" data-act="print">\ud83d\udda8 Save clinical PDF</button></div>';
  h+='<div class="pgrv-card">';
  h+='<div class="pgrv-head"><span class="pgrv-title">PpgDex \u2014 wrist-PPG review</span>'
    +'<span class="pgrv-sub">'+_pgesc(rec.source||'ppg')+(rec.durationMin!=null?' \u00b7 '+Math.round(rec.durationMin)+' min':'')+(rec.beats!=null?' \u00b7 '+rec.beats+' beats':'')+'</span></div>';
  h+='<div class="pgrv-sec">Impression</div>';
  h+='<div class="pgrv-imp">Mean HR '+nv(t.hr)+' bpm \u00b7 rMSSD '+nv(t.rmssd)+' ms \u00b7 SDNN '+nv(t.sdnn)+' ms'+(q.analyzablePct!=null?' \u00b7 analyzable '+q.analyzablePct+'%':'')+(t.lowConfidence?' \u00b7 ⚠ low-confidence HRV':'')+'. Rendered from the export\u2019s stored values \u2014 no waveform recomputation.</div>';
  var kpis=[['Mean HR',nv(t.hr),'bpm'],['rMSSD',nv(t.rmssd),'ms'],['SDNN',nv(t.sdnn),'ms'],['pNN50',nv(t.pnn50),'%'],['LF/HF',nv(fq.lfhf),'ratio'],['Analyzable',nv(q.analyzablePct),'%'],['LED agreement',nv(q.ledAgreementPct),'%'],['Beats',nv(rec.beats),'count']];
  h+='<div class="pgrv-sec">Key metrics</div><div class="pgrv-kpis">'
    +kpis.map(function(k){ return '<div class="pgrv-kpi"><div class="k-lab">'+(typeof evBadge==='function'?evBadge(k[0]):'')+_pgesc(k[0])+'</div><div class="k-val">'+_pgesc(k[1])+'</div><div class="k-sub">'+_pgesc(k[2])+'</div></div>'; }).join('')
    +'</div>';
  h+='<div class="pgrv-sec">Event timeline</div>'+ppgReviewTimeline(review.events);
  h+='<div class="pgrv-sec">Raw signal</div>'
    +'<div class="pgrv-greyed"><strong>Optical waveform, LED-agreement ribbon &amp; Poincaré not included</strong>Raw optical samples are not carried in the export \u2014 review mode shows the derived HRV/quality layer only. Re-run the original *_PPG.txt for the waveform + morphology charts.</div>';
  h+='<div class="pgrv-disc">'
    +(bh?'Provenance \u00b7 build <code>'+_pgesc(bh)+'</code>'+(gen?' \u00b7 generated '+_pgesc(gen):''):'Provenance \u00b7 build unknown')
    +'<br><span class="dxl">Tepna \u00b7 not a medical device.</span> Computes PPG/HRV patterns for personal self-quantification; does not diagnose, treat, or monitor any condition.'
    +'</div></div>';
  return h;
}
function ppgRenderReview(review){
  if(typeof document==='undefined'||!review) return;
  _ppgInjectReviewCSS();
  var host=document.getElementById('ppgReviewCard');
  if(!host){ host=document.createElement('section'); host.id='ppgReviewCard';
    var m=document.querySelector('main')||document.body; m.insertBefore(host, m.firstChild); }
  host.innerHTML=ppgReviewView(review); host.style.display='';
  try{ window.scrollTo(0,0); }catch(e){}
}
function ppgClearReview(){ var h=document.getElementById('ppgReviewCard'); if(h){ h.innerHTML=''; h.style.display='none'; } }
// F5 (SELF-INGEST-FOLLOWUPS-II): fleet convention — the review renderer is reachable via the node
// namespace (<Node>.reviewView / .renderReview) so the suite's live review probe (and any global
// caller) can drive it; the bare names stay IIFE-local.
try{ if(typeof window!=='undefined' && window.PpgDex){ window.PpgDex.reviewView=ppgReviewView; window.PpgDex.renderReview=ppgRenderReview; } }catch(_rvx){}
function exportGanglior(){
  const list=sessionsSorted(); if(!list.length) return;
  const _ts=list.map(x=>x.t0Ms).filter(v=>v!=null);
  const _aT0=_ts.length?Math.min.apply(null,_ts):null;
  const _aSpan=_ts.length>1?Math.round((Math.max.apply(null,_ts)-Math.min.apply(null,_ts))/864e5):null;
  const stamp={ kernel:(window.DexKernel?{version:DexKernel.VERSION,hash:DexKernel.HASH}:null),
    provenance:(window.GangliorProvenance?GangliorProvenance.stamp():null) };
  let out;
  if(list.length===1){
    // ONE shared builder (ppgdex-dsp.js) — the SAME node-export compute() emits, so the app
    // stream and the headless/Unifier export stay byte-identical (brief §1B parity).
    out=(window.PpgDex||window.PPGDSP).buildNodeExport(list[0], stamp);
  } else {
    // multi-session aggregate (app-only path — compute() is single-recording). Each session's
    // events come from the SAME r.events source; only the cross-session envelope is local here.
    const events=[];
    list.forEach(s=>{ s.events.forEach(e=>events.push({ t:e.t, tMs:e.tMs, impulse:e.impulse, node:e.node, conf:e.conf, meta:e.meta, session:s.t0Ms })); });
    const t0=list[0].t0Ms;
    out = {
      kernel:stamp.kernel,
      schema:{ name:'ganglior.node-export', version:'2.0', node:'PpgDex', nodeVersion:'1.0',
        bus:'ganglior', generated:new Date().toISOString(),
        provenance:stamp.provenance,
        doc:'PpgDex PPG-derived events across sessions → Ganglior bus. tMs = floating wall-clock ms (UTC getters). null = unknown, never fabricated.' },
      recording:{ source:'ppg', startEpochMs:(t0!=null?t0:null), sessions:list.length, events:events.length },
      ganglior_events:events,
      reserved:{ doc:'Awaiting other fleet nodes; null until available.' }
    };
  }
  download(JSON.stringify(out,null,2), exportName({node:'PpgDex',t0Ms:_aT0,kind:'ganglior',ext:'json',spanDays:_aSpan}),'application/json;charset=utf-8');
}
function exportPPI(){
  const r=allSessions[activeKey]; if(!r) return;
  let out='Phone Data RX timestamp;PP-interval [ms];error estimate [ms];blocker;contact;contact;hr [bpm]\n';
  for(let i=0;i<r.nn.length;i++){ const tMs=r.t0Ms!=null?r.t0Ms+Math.round(r.tt[i]*1000):null;
    const ts=tMs!=null?new Date(tMs).toISOString().replace('Z',''):'';
    out+=`${ts};${Math.round(r.nn[i])};0;0;1;1;${Math.round(60000/r.nn[i])}\n`; }
  // INTEROP file (self-PPI in Polar device .txt format, for the PulseDex handoff) — stays OFF the
  // <Node>_<date>_<kind> scheme (EXPORT-HYGIENE-FOLLOWUPS §4), recording-anchored inline (getUTC* via
  // DSP.fmtDate), like ECGDex's computed-RR / PulseDex's welltory exports.
  download(out,'ppgdex_selfPPI_'+(r.t0Ms!=null?DSP.fmtDate(r.t0Ms).replace(/-/g,''):'session')+'.txt','text/plain');
}
// ── CSV toolkit ── missing(null/undefined/NaN/±Inf)→blank · real 0 preserved · RFC-4180 + Excel-safe.
function csvCell(v){
  if(v==null) return '';
  if(typeof v==='number') return Number.isFinite(v) ? String(v) : '';
  v=String(v);
  if(v && '=+-@\t\r'.indexOf(v[0])!==-1) v='\t'+v;
  return /[",\r\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v;
}
function csvDoc(rows){ return '\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n'; }
function exportCSV(){
  const r=allSessions[activeKey]; if(!r) return;
  const cols=['epoch_min','beats','hr_bpm','meanRR_ms','rmssd_ms','sdnn_ms','pnn50_pct','lf','hf','lfhf','pi_pct','motionIndex'];
  const rows=[cols];
  r.epochs.forEach(e=>{ rows.push([e.tMin,e.beats,_round(e.hr,1),_round(e.meanRR,1),_round(e.rmssd,2),_round(e.sdnn,2),_round(e.pnn50,1),_round(e.lf,1),_round(e.hf,1),_round(e.lfhf,3),_round(e.pi,1),_round(e.motionIndex,3)]); });
  download(csvDoc(rows),exportName({node:'PpgDex',t0Ms:r.t0Ms,kind:'series',ext:'csv'}),'text/csv');
}
// stampName() REMOVED (EXPORT-HYGIENE-FOLLOWUPS §1): PpgDex node exports (JSON summary/series,
// ganglior, epochs CSV) now name through the shared dex-export.js exportName(); the lone interop
// selfPPI .txt inlines its own recording-anchored date (off-scheme by design, §4).

// ── standardized cross-night envelope (ganglior.crossnight v1.0) ──
// DELEGATES to PpgDex's shared cross module (ppgdex-cross.js), which now builds the
// envelope itself via CrossNightEnvelope.build (shape) + PpgDex's local crossNight (math)
// — ONE source for the helper and the app (CROSS-MODULE-RUNTIME-COVERAGE-FOLLOWUPS §2).
// PPGCross.crossNightBlock falls back to the legacy flat shape only if the shared builder
// isn't bundled (it always is in PpgDex.html), so the multi-session export is unchanged.
function buildCrossNightEnvelope(list){
  return window.PPGCross.crossNightBlock(list);
}
function download(text,name,type){ const blob=new Blob([text],{type}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }

function clearAll(){ allSessions={}; activeKey=null; if(SCOPE){ SCOPE=null; }
  try{ localStorage.removeItem('ppgdex_active'); }catch(e){}
  document.body.classList.remove('has-data');
  ['scopeSection','qualitySection','chartsSection','morphSection','motionSection','validationSection','gangliorSection','tableSection','crossNightSection','ctxBanner'].forEach(id=>{ const el=$(id); if(el) el.style.display='none'; });
  $('kpiGrid').classList.remove('show'); $('sessionSwitcher').style.display='none';
  $('exportBar').classList.remove('show'); $('sidebarDataCard').style.display='none';
  if(window.PPGProfile) window.PPGProfile.hide();
  const srb=$('sidebarReadinessBadge'); if(srb) srb.style.display='none';
  showOK('Cleared. Drop a Polar Sense PPG session to begin.');
}

// ── UI helpers ────────────────────────────────────────────────────────────
function progress(pct,msg){ const p=$('prog'); p.classList.add('show'); $('progBar').style.width=Math.min(100,pct)+'%'; if(msg) $('proc').textContent=msg; }
function showErr(msg){ const a=$('alert'); a.className='alert err show'; a.innerHTML='⚠ '+msg; clearTimeout(a._t); a._t=setTimeout(()=>a.classList.remove('show'),9000); }
function showOK(msg){ const a=$('alert'); a.className='alert ok show'; a.innerHTML='✓ '+msg; clearTimeout(a._t); a._t=setTimeout(()=>a.classList.remove('show'),5000); }

// ── scope controls ────────────────────────────────────────────────────────
function zoomIn(){ if(SCOPE) SCOPE.zoom(0.6); }
function zoomOut(){ if(SCOPE) SCOPE.zoom(1.6); }
function fitAll(){ if(SCOPE) SCOPE.fitAll(); }
function span(sec){ if(SCOPE) SCOPE.setSpanSec(sec); }

// ── wiring ────────────────────────────────────────────────────────────────
// Synthetic patient generator (shared coherence engine · dex-patient-gen.js).
// Renders N consecutive nights for one patient as Polar-Sense PPG sessions.
function genSyntheticPatient(){
  if(!window.DexPatientGen || !window.SYNTH){ return; }
  const r = DexPatientGen.fromControls('genScenario','genDays');
  if(!r) return;
  const files = [];
  r.tls.forEach(tl=>{
    const win = SYNTH.pickWindow(tl);
    const base = 'Polar_Sense_synthetic_'+r.profile+'_'+tl.cfg.date;
    files.push(new File([SYNTH.renderPPG(tl, win)], base+'_PPG.txt', {type:'text/plain'}));
    // Companion device *_PPI.txt — the Polar Sense's own on-board pulse-pulse
    // intervals, so the Pulse-Interval Validation lane has a reference to check
    // PpgDex's self-extracted PPI against. Built from the SAME window's ground-truth
    // RR beats. We add per-interval Gaussian beat-detection noise (σ≈34 ms) so the
    // DEVICE rMSSD lands in the same range as the optically self-detected rMSSD
    // (zero-mean noise leaves the MEAN — the headline agreement — tight at ~96%, but
    // lifts rMSSD to match, closing the 2× beat-to-beat gap the clean truth produced).
    if(typeof SYNTH.buildRR==='function'){
      const t0Win = tl.t0Ms + win.startRel*1000, t1Win = t0Win + win.lenSec*1000;
      const beats = (SYNTH.buildRR(tl)||[]).filter(b => b.tMs>=t0Win && b.tMs<=t1Win && isFinite(b.rr));
      if(beats.length>=3){
        const gauss = ()=>{ let u=0,v=0; while(!u)u=Math.random(); while(!v)v=Math.random(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); };
        let ppiTxt = 'Phone Data RX timestamp;PP-interval [ms];error estimate [ms];blocker;contact;contact;hr [bpm]\n';
        for(const b of beats){
          const noise = 34*gauss();                       // optical beat-detection jitter (zero-mean)
          const ppi = Math.max(300, Math.min(2000, Math.round(b.rr + noise)));
          const ts = new Date(b.tMs).toISOString().replace('Z','');
          ppiTxt += ts+';'+ppi+';'+Math.round(Math.abs(noise))+';0;1;1;'+Math.round(60000/ppi)+'\n';
        }
        files.push(new File([ppiTxt], base+'_PPI.txt', {type:'text/plain'}));
      }
    }
  });
  loadFiles(files);
}
function init(){
  if(window.PPGProfile) window.PPGProfile.init(()=>{ if(activeKey&&allSessions[activeKey]) renderSession(allSessions[activeKey]); });
  const fileInput=$('fileInput'), drop=$('dropZone');
  $('loadBtn').addEventListener('click',e=>{ e.stopPropagation(); fileInput.click(); });
  const addBtn=$('addBtn'); if(addBtn) addBtn.addEventListener('click',e=>{ e.stopPropagation(); fileInput.click(); });
  fileInput.addEventListener('change',e=>{ loadFiles(e.target.files); e.target.value=''; });
  { const gb=$('genBtn'); if(gb) gb.addEventListener('click',e=>{ e.stopPropagation(); genSyntheticPatient(); }); }
  if(drop){
    ['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{ e.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{ e.preventDefault(); if(ev==='drop'||e.target===drop) drop.classList.remove('drag'); }));
    drop.addEventListener('drop',e=>{ const dt=e.dataTransfer; if(dt&&dt.files&&dt.files.length) loadFiles(dt.files); });
    drop.addEventListener('click',e=>{ if(e.target.closest('button')) return; fileInput.click(); });
  }
  // whole-window drag-drop
  ['dragover','drop'].forEach(ev=>window.addEventListener(ev,e=>{ if(e.target.closest&&e.target.closest('input')) return; e.preventDefault(); }));
  window.addEventListener('drop',e=>{ if(e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files.length && !e.target.closest('#dropZone')){ loadFiles(e.dataTransfer.files); } });

  $('btnExportJSON').addEventListener('click',exportJSON);
  $('btnExportPPI').addEventListener('click',exportPPI);
  $('btnExportCSV').addEventListener('click',exportCSV);
  $('btnClear').addEventListener('click',clearAll);
  $('zoomIn').addEventListener('click',zoomIn);
  $('zoomOut').addEventListener('click',zoomOut);
  $('fitAll').addEventListener('click',fitAll);
  document.querySelectorAll('[data-span]').forEach(b=>b.addEventListener('click',()=>span(+b.getAttribute('data-span'))));
  // Section-header evidence badges: raw waveform = directly measured signal; Ganglior
  // events are detected straight off that measured signal (conf = SQI × motion gate).
  // Routed through MetricRegistry.badge so the disc stays single-sourced (no hardcoded CSS).
  if(window.MetricRegistry){
    const wf=document.querySelector('#scopeSection .section-title');
    if(wf && !wf.querySelector('.ev')) wf.insertAdjacentHTML('beforeend',' '+MetricRegistry.badge('measured','Raw optical PPG waveform — direct sensor signal'));
    const ge=document.querySelector('#gangliorSection .section-title');
    if(ge && !ge.querySelector('.ev')){ const note=ge.querySelector('.st-note'); const b=MetricRegistry.badge('measured','Events detected directly off the measured signal · conf = SQI × motion gate');
      if(note) note.insertAdjacentHTML('beforebegin', b+' '); else ge.insertAdjacentHTML('beforeend',' '+b); }
  }
}
// Event-delegation actions (CSP strict script-src — dex-actions.js). `print` is a DexActions
// builtin; the profile toggle is a PpgDex global (ppgdex-profile.js).
if(window.DexActions) DexActions.registerAll({ ppgProfileToggle:function(){ ppgProfileToggle(); } });
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();

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
