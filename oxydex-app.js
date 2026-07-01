/* ════ OxyDex · APP · UI HELPERS · EXPORTS (oxydex-app.js) ──────────────────────────────────────────────────
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   Loaded LAST: UI helper utilities and all exporters (CSV / JSON / parser
   self-download). Page-level glue (mode toggle, theme, mobile nav, #demo
   autoload) stays as small inline <script> blocks in the shell.
   Plain global script — shares page scope with the other oxydex-*.js files,
   exactly as in the original single-script monolith. No behavior change.
   Load order: oxydex-util → oxydex-profile → oxydex-dsp → oxydex-render → oxydex-app.
   ════════════════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════
// UI helpers
// ═══════════════════════════════════════════
function setProgress(pct){
  var pw=document.getElementById('progressWrap'),pb=document.getElementById('progressBar');
  if(!pw||!pb) return;
  pw.style.display='block'; pb.style.width=pct+'%';
  if(pct>=100) setTimeout(function(){pw.style.display='none';},600);
}
function setStatus(msg){ var el=document.getElementById('procStatus'); if(!el) return; el.textContent=msg; el.style.display=msg?'block':'none'; }
function showError(msg){
  setProgress(0); setStatus('');
  var el=document.getElementById('errorMsg'); if(!el) return; el.textContent='⚠ '+msg; el.style.display='block';
}
function reset(){
  safeStyle('uploadArea','display','block');
  safeSet('fileInput','value','');
  safeStyle('errorMsg','display','none');
  setStatus('');
}
function addMoreFiles(){
  // Show upload area, scroll to top, then trigger native file picker.
  // The fileInput change handler appends new nights to allNights without
  // clearing existing data, so this is a true "append" flow.
  reset();
  try { window.scrollTo({ top:0, behavior:'smooth' }); } catch(_){ window.scrollTo(0,0); }
  setTimeout(function(){
    var fi = document.getElementById('fileInput');
    if (fi) fi.click();
  }, 60);
}
function clearAll(){
  allNights={};
  // SELF-INGEST: clearing data also exits review mode (the reloaded export's context no longer applies).
  try { window._oxyReview = null; var _b=document.body; if(_b) _b.classList.remove('oxy-review'); } catch(_cr){}
  _lineChartCache={};
  window._upHRrest=null;
  safeSet('results','innerHTML','');
  safeStyle('results','display','none');
  safeStyle('errorMsg','display','none');
  safeStyle('userProfilePanel','display','none');
  safeStyle('progressWrap','display','none');
  safeStyle('progressBar','width','0%');
  setStatus('');
  reset();
}

// ═══════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════
// Export download FILENAMES now come from the shared dex-export.js exportName() — recording-anchored
// (the night's t0Ms, read via getUTC*), viewer-TZ-independent, controlled-vocab (EXPORT-HYGIENE §2).
// The old local-clock _exportTs() (new Date() + LOCAL getters = export-click wall-clock, TZ-dependent,
// naming the wrong night for an overnight recording) is DELETED (EXPORT-HYGIENE-FOLLOWUPS §1).
// SELF-INGEST §5 — toggle the "scrub for sharing" export mode (default OFF). The export-bar checkbox
// already reflects the click in the DOM, so this just flips the flag; exportJSON reads it at click time
// and routes through OxyDex.scrubExport. Sticky as a session preference (harmless with no data loaded).
function oxySetScrub(on){ try { window._oxyScrub = !!on; } catch(_s){} }

function exportJSON(){
  var nights=Object.values(allNights).sort(function(a,b){return a.date<b.date?1:a.date>b.date?-1:0;});
  // Recording anchor for the filename: earliest night (nights is DESC → reverse to ascending), span-aware.
  var _asc=nights.slice().reverse(), _aF=_asc[0], _aL=_asc[_asc.length-1];
  var _aT0=_aF?_aF.t0Ms:null;
  var _aSpan=(nights.length>1 && _aF&&_aL&&_aF.t0Ms!=null&&_aL.t0Ms!=null)?Math.round((_aL.t0Ms-_aF.t0Ms)/864e5):null;
  // SELF-INGEST §3 — a review-mode RE-EXPORT is a DERIVED VIEW of a past computation, NOT a fresh one:
  // use the reloaded export's ORIGINAL provenance and NEVER call GangliorProvenance.stamp() (that would
  // stamp the current build over the original). A normal (non-review) export stamps as before.
  var _reviewCtx = (typeof window!=='undefined' && window._oxyReview) ? window._oxyReview : null;
  var _prov = _reviewCtx ? (_reviewCtx.provenance || null)
                         : (window.GangliorProvenance ? GangliorProvenance.stamp() : null);   // R1: build + input fingerprints
  var _kernel = _reviewCtx ? (_reviewCtx.kernel || null)
                           : (window.DexKernel?{version:DexKernel.VERSION,hash:DexKernel.HASH}:null);   // P8: physiology-kernel stamp
  var lines=nights.map(function(n){
    // paired ECG + fusion + ANS age (computed the same way the dashboard renders them)
    var _ecg = (typeof oxyEcgForNight==='function') ? oxyEcgForNight(n) : null;
    var _F   = (_ecg && typeof oxyComputeFusion==='function') ? oxyComputeFusion(n,_ecg) : null;
    var _ecgFusion = _F ? {
      pairedEcgDate: (typeof _oxyEcgDate==='function' && _F.rec ? _oxyEcgDate(_F.rec.startEpochMs) : null),
      confirmedApnea: { confirmed:_F.confirmed, desaturations:_F.desN, pct:_F.confPct },
      desatArousalLatencySec: _F.medLat, apneaType: _F.apneaType, pairedEvents: _F.latencies.length,
      hypoxicDosePerEvent: _F.dosePerEv, doseBasis: _F.doseBasis, doseDenominator: _F.doseDenom,
      nadirDepthByStage: Object.keys(_F.stageAgg).reduce(function(o,k){ var a=_F.stageAgg[k];
        o[k]={ count:a.count, deepestPct:+a.deepest.toFixed(1), meanPct:+(a.sum/a.count).toFixed(1), unstaged:!!a.unstaged }; return o; }, {}),
      stageProxyContext: _F.stageProxyCtx,
      crcPLV: { baseline:_F.plvB, duringSurges:_F.plvS, dropsDuringSurges: (_F.plvB!=null&&_F.plvS!=null)?(_F.plvS<_F.plvB):null, wholeNight:(_F.cr?_F.cr.crcPLV:null) },
      hrCrossCheck: { oxyMeanHr:_F.oxyMeanHr, ecgMeanHr:_F.ecgMeanHr, deltaBpm:_F.hrDelta, oxyFloor:_F.oxyFloor, ecgFloor:_F.ecgFloor },
      realHRV: { rmssd:_F.t.rmssd, sdnn:_F.t.sdnn, pnn50:_F.t.pnn50, meanHr:_F.t.hr },
      ecgApnea: _F.ap ? { estimatedAHI:_F.ap.estimatedAHI, cvhrIndex:_F.ap.cvhrIndex, cvhrEvents:_F.ap.cvhrEvents, riskCategory:_F.ap.riskCategory } : null,
      respRateInstability: _F.rstat
    } : null;
    var _ansAge = null;  // ANS age REMOVED 2026-06-21 (external-review WP-A);
    // key kept (null) for node-export back-compat — consumers tolerate null.
    // Element built by the SHARED oxyBuildNightElement (pulsedex-dsp sibling) so
    // OxyDex.compute (the Unifier/OverDex headless path) emits a byte-identical
    // per-night element from ONE source (SIGNAL-ADAPTER-FOLLOWUPS §4).
    return oxyBuildNightElement(n, { provenance:_prov, kernel:_kernel, ecgFusion:_ecgFusion, ansAge:_ansAge });
  });
  // ── ganglior.node-export v2.0 envelope — UNCONDITIONAL (OXYDEX-NODE-EXPORT-ENVELOPE-2026-06-27) ──
  // EVERY export (1..N nights) is now ONE schema-validated envelope carrying a real ganglior_events[]
  // (desat_event + periodic_breathing). This closes the <3-night bare-array drift gap: the Integrator
  // validates ONE shape instead of forking array-vs-object. The per-night nights[] elements are
  // byte-identical to the legacy array (the wrapper is purely additive); ganglior_events[] is
  // chronological across all nights (each event's tMs disambiguates its night). The ganglior.crossnight
  // aggregate BLOCK stays gated at ≥3 nights (its stats need ≥3 to be meaningful) — the ENVELOPE is
  // unconditional, the crossNight block is not (null below 3). _asc = nights ascending by time.
  var _events = (typeof oxyBuildGangliorEvents==='function') ? oxyBuildGangliorEvents(_asc) : [];
  // SELF-INGEST §3/§4 — in review mode, re-emit the EXPORT's events VERBATIM (faithful timeline). A
  // rebuild from the reconstructed nights would drop periodic_breathing onsets (oscEpisodes is a
  // processNight-internal field, not carried in the export), so prefer the stored event stream.
  if(_reviewCtx && Array.isArray(_reviewCtx.events)) _events = _reviewCtx.events;
  var _crossNight = _reviewCtx ? (_reviewCtx.crossNight || null)
    : ((nights.length>=3 && window.OXYCross && window.CrossNightEnvelope)
        ? window.OXYCross.crossNightBlock(_asc) : null);
  var _envelope = {
    kernel:_kernel,
    schema:{ name:'ganglior.node-export', version:'2.0', node:'OxyDex', nodeVersion:'1.0',
      multiNight:(nights.length>1), generated:new Date().toISOString(), provenance:_prov,
      doc:'OxyDex SpO₂/oximetry node-export. nights[] = per-night summaries (unchanged). ganglior_events[] = desat_event (per scored desaturation) + periodic_breathing (per oscillation episode); OxyDex infers respiration from an SpO₂ proxy, not airflow. crossNight = ganglior.crossnight v1.0 aggregate (≥3 nights only, else null). tMs = floating wall-clock ms (UTC getters); null = unknown, never fabricated.' },
    recording:{ startEpochMs:(_aT0!=null?_aT0:null), offsetMin:(_aF&&_aF.offsetMin!=null?_aF.offsetMin:null) },
    ganglior_events:_events,
    crossNight:_crossNight,
    nights: lines
  };
  // SELF-INGEST §3 — mark a review-mode re-export as DERIVED (carries the original build's identity
  // rather than masquerading as a fresh computation).
  if(_reviewCtx){
    _envelope.schema.derivedFrom = {
      buildHash: (_reviewCtx.provenance && _reviewCtx.provenance.buildHash)
                 || (_reviewCtx.derivedFrom && _reviewCtx.derivedFrom.buildHash) || null,
      generated: (_reviewCtx.provenance && _reviewCtx.provenance.generated) || _reviewCtx.generated || null,
      via: 'OxyDex review-mode re-export'
    };
  }
  // SELF-INGEST §5 — optional "scrub for sharing" (default OFF): strip device serial / filename / input
  // sha256 while keeping the clinical summary + a coarse build stamp. OFF → byte-identical to before.
  var _outEnv = (typeof window!=='undefined' && window._oxyScrub && window.OxyDex && typeof OxyDex.scrubExport==='function')
    ? OxyDex.scrubExport(_envelope) : _envelope;
  download(JSON.stringify(_outEnv,null,2),exportName({node:'OxyDex',t0Ms:_aT0,kind:(nights.length>1?'series':'summary'),ext:'json',spanDays:_aSpan}),'application/json;charset=utf-8');
}

function exportCSV(){
  var nights=Object.values(allNights).sort(function(a,b){return a.date<b.date?1:a.date>b.date?-1:0;});
  var _asc=nights.slice().reverse(), _aF=_asc[0], _aL=_asc[_asc.length-1];   // ascending; anchor = earliest night
  var _aT0=_aF?_aF.t0Ms:null;
  var _aSpan=(nights.length>1 && _aF&&_aL&&_aF.t0Ms!=null&&_aL.t0Ms!=null)?Math.round((_aL.t0Ms-_aF.t0Ms)/864e5):null;
  var lines=[];
  nights.forEach(function(n){
    var s=n.stats;
    lines=lines.concat([
      'OxyDex Night Summary','Source,'+csvSafe(n.fname),'Date,'+n.date,'',
      'RECORDING','Duration (min),'+s.durationMin,'Start,'+s.start,'End,'+s.end,'',
      'SPO2','Mean SpO2 (%),'+s.meanSpo2,'Min SpO2 (%),'+s.minSpo2,'Max SpO2 (%),'+s.maxSpo2,
      'Std Dev,'+s.spo2Std,'T95 (%),'+s.t95pct,'T90 (%),'+s.t90pct,'',
      'T-INDEX','Threshold,% Time,Seconds'
    ]);
    [95,94,93,92,91,90,89,88,85,80].forEach(function(t){ var _td=n.tIdx&&(n.tIdx[t]||n.tIdx['t'+t]); if(_td){ lines.push('T'+t+','+(_td.pct||0)+','+(_td.secs||_td.sec||0)); } });
    lines=lines.concat(['','DESATURATION INDEX',
      'ODI-4 (events/hr),'+(n.odi4?n.odi4.rate:''),'ODI-4 total events,'+(n.odi4?n.odi4.count:''),
      'ODI-3 (events/hr),'+(n.odi3?n.odi3.rate:''),'ODI-3 total events,'+(n.odi3?n.odi3.count:''),'',
      'PULSE','Mean HR (bpm),'+s.meanHr,'Min HR (bpm),'+s.minHr,'Max HR (bpm),'+s.maxHr,'Motion (%),'+s.motionPct,''
    ]);
    lines.push('','DEEP ANALYSIS','HR Spikes,'+n.spikes.length);
    if(n.spikes.length) lines.push('Spike #,Time,Baseline (bpm),Peak (bpm),Rise (bpm),Duration (s),SpO2 (%)');
    (Array.isArray(n.spikes)?n.spikes:[]).forEach(function(sp,i){
      lines.push('Spike '+(i+1)+','+sp.time+','+sp.baseline+','+sp.peak+','+(sp.peak-sp.baseline)+','+sp.duration+','+sp.spo2);
    });
    if(n.period) lines.push('HR Periodicity,'+n.period.pattern+' avg '+n.period.avg+'min');
    if(n.osc) lines.push('Oscillation Windows (5min),'+n.osc.episodeCount);
    if(n.osc) lines.push('Total Crossings (burden),'+(n.osc.totalCrossings||0));
    lines.push('','FLAGS,'+(n.flags||[]).map(function(f){return f.code;}).join(' | '));
    lines.push('','MOVEMENT','Motion %,'+(n.stats?n.stats.motionPct:''),'Arousal Index %,'+(n.motion?n.motion.arousalIndex:''),'Restless Windows,'+(n.motion?n.motion.restlessWindows:''));
    if(n.motSleep){lines.push('','SLEEP QUALITY (MOTION-DERIVED)','  Sleep Efficiency %,'+n.motSleep.sleepEff,'  WASO Windows,'+n.motSleep.wasoWindows,'  WASO %,'+n.motSleep.wasoPct,'  Positional Shifts,'+n.motSleep.posShifts);}
    if(n.desat){var _nd=n.desat.nadir||{};lines.push('','DESATURATION PROFILE','  Delta-Index,'+n.desat.deltaIndex,'  SpO2 CoV %,'+n.desat.spo2CoV,'  T-AUC Weighted,'+n.desat.tAucWeighted,'  AUC-90 Total (%-min),'+n.desat.auc90Total,'  AUC-90 Rate (%-min/hr),'+n.desat.auc90Rate,'  Dip-3 Rate (/hr),'+n.desat.dip3Rate,'  Nadir Count,'+(_nd.count!=null?_nd.count:''),'  Nadir Mean Depth (%),'+(_nd.meanDepth!=null?_nd.meanDepth:''),'  Nadir Mean Duration (s),'+(_nd.meanDuration!=null?_nd.meanDuration:''),'  Nadir Mean Recovery (s),'+(_nd.meanRecovery!=null?_nd.meanRecovery:''));}
    if(n.hrProf){lines.push('','HR PROFILE','  Circadian Score (bpm),'+n.hrProf.circadianScore,'  Deceleration Capacity (bpm),'+n.hrProf.decCapacity,'  Approx Entropy (ApEn),'+n.hrProf.apEn,'  Bradycardia Events,'+n.hrProf.bradyCount,'  Tachycardia Events,'+n.hrProf.tachyCount);}
    if(n.cross){lines.push('','CROSS-SIGNAL','  Autonomic Arousal Index (/hr),'+n.cross.autoArousalIdx,'  Cardiorespiratory Coupling (r),'+n.cross.crcIdx,'  PB-HR Divergent Episodes,'+n.cross.divergeCount,'  Divergence %,'+n.cross.divergePct);}
    if(n.spo2Adv){lines.push('','SPO2 ADVANCED','  WtDSI,'+n.spo2Adv.wtdsi,'  SpO2 IQR (%),'+n.spo2Adv.spo2IQR,'  Cond Mean <94% SpO2,'+n.spo2Adv.condMeanBelow94,'  Cond % <94,'+n.spo2Adv.condPctBelow94,'  Nadir Depth <4%,'+n.spo2Adv.nadirBins.above91,'  Nadir 4-6%,'+n.spo2Adv.nadirBins.b90_91,'  Nadir 6-9%,'+n.spo2Adv.nadirBins.b88_89,'  Nadir >9%,'+(n.spo2Adv.nadirBins.b85_87+n.spo2Adv.nadirBins.below85));}
    if(n.hrAdv){lines.push('','HR ADVANCED','  RMSSD Proxy (bpm),'+n.hrAdv.rmssd,'  HR IQR (bpm),'+n.hrAdv.hrIQR,'  Mean HR PB Windows,'+n.hrAdv.meanHRpb,'  Mean HR Non-PB,'+n.hrAdv.meanHRnonPb,'  HR PB Contrast (bpm),'+n.hrAdv.hrPbContrast);}
    if(n.comp){lines.push('','COMPOSITE','  Nocturnal Stress Index,'+n.comp.nsi,'  Desat-Arousal Coupling %,'+n.comp.couplingScore,'  Sleep Fragmentation Index,'+n.comp.sfi);}
    if(n.sbii){lines.push('','SBII (Hui 2024)','  SBII (%\u00B2\u00B7min/hr),'+n.sbii.sbii,'  SBII Quintile,'+n.sbii.sbiiQ);}
    if(n.pred3p){lines.push('','PRED3P (Hui 2024)','  pRED-3p (%),'+n.pred3p.pred3p,'  pRED-3p Quintile,'+n.pred3p.pred3pQ);}
    if(n.desSev){lines.push('','DESSEV (Kulkas)','  DesSev (%-min/hr),'+n.desSev.desSev);}
    if(n.ctPrec){lines.push('','CT THRESHOLDS (seconds)','  CT<90 (s),'+n.ctPrec.ct90s,'  CT<89 (s),'+n.ctPrec.ct89s,'  CT<88 (s),'+n.ctPrec.ct88s,'  CT<85 (s),'+n.ctPrec.ct85s,'  CT<90 (min),'+n.ctPrec.ct90m,'  CT<89 (min),'+n.ctPrec.ct89m,'  CT<88 (min),'+n.ctPrec.ct88m,'  CT<85 (min),'+n.ctPrec.ct85m);}
    if(n.ct94){lines.push('','CT<94 THRESHOLD','  CT<94 (s),'+n.ct94.ct94Sec,'  CT<94 (%),'+n.ct94.ct94Pct);}
    if(n.slopes){var sl=n.slopes;lines.push('','DESATURATION SLOPES','  Mean Dip Slope (%/s),'+(sl.meanDipSlope!==null?sl.meanDipSlope:''),'  Mean Recovery Slope (%/s),'+(sl.meanRecSlope!==null?sl.meanRecSlope:''),'  MODL (mean SpO2 in dips),'+(sl.modl!==null?sl.modl:''),'  Clustering Index,'+(sl.clusteringIdx!==null?sl.clusteringIdx:''),'  Nadirs First Half,'+sl.firstHalfNadirs,'  Nadirs Last Half,'+sl.lastHalfNadirs);}
    if(n.pbMet){var pb=n.pbMet;lines.push('','PB CHARACTERISATION','  PB Cycle Length (s),'+(pb.pbCycleLen!==null?pb.pbCycleLen:''),'  PB Cycle Length SD (s),'+(pb.pbCycleLenSD!==null?pb.pbCycleLenSD:''),'  PB Amplitude (% swing),'+(pb.pbAmplitude!==null?pb.pbAmplitude:''),'  PB Load Index,'+(pb.pbLoad!==null?pb.pbLoad:''),'  PB First-Third Ratio,'+(pb.pbFirstThirdRatio!==null?pb.pbFirstThirdRatio:''),'  PB Early Count,'+pb.pbEarlyCount,'  PB Late Count,'+pb.pbLateCount);}
    if(n.sleepArch){var sa=n.sleepArch;lines.push('','SLEEP ARCHITECTURE PROXY','  WASO Duration (min),'+sa.wasoMin,'  Sleep Onset Latency (min),'+(sa.solMin!==null?sa.solMin:''),'  Ultradian Cycles (approx),'+sa.ultradianCycles,'  HR Valleys Detected,'+sa.ultradianValleys);}
    if(n.odi1){lines.push('','ODI-1','  ODI-1 (events/hr),'+n.odi1.odi1Rate,'  ODI-1 total events,'+n.odi1.odi1Total);}
    if(n.mos){lines.push('','McGILL OxiMetry Score (MOS)','  MOS (0-4),'+n.mos.mos,'  MOS Label,'+n.mos.mosLabel);}
    if(n.ahiEst){lines.push('','AHI ESTIMATES (Derived)','  AHI est. ODI4x1.1 (internal calibration),'+n.ahiEst.ahiODI4,'  AHI est. internal linear model,'+n.ahiEst.ahiKulkas);}
    if(n.extras){var ex=n.extras;lines.push('','NIGHT EXTRAS','  SpO2 Range (%),'+ex.spo2Range,'  Time-in-Range 94-99% (%),'+ex.tir9499,'  Mean SpO2 Early (2h),'+ex.meanSpo2Early,'  Mean SpO2 Late (2h),'+ex.meanSpo2Late,'  HR Range (bpm),'+ex.hrRange,'  Mean HR Early (2h),'+ex.meanHrEarly,'  Mean HR Late (2h),'+ex.meanHrLate,'  Motion Bursts,'+ex.motionBursts,'  Longest Clean Run (min),'+ex.longestCleanRun,'  Nadir Density (/hr),'+ex.nadirDensity,'  T95 Burden Score,'+(ex.t95BurdenScore!==null?ex.t95BurdenScore:''),'  ODI-4/ODI-1 Ratio,'+(ex.odi41ratio!==null?ex.odi41ratio:''));}
    if(n.rolling){var ro=n.rolling;lines.push('','ROLLING WINDOW METRICS','  Worst 10-min SpO2 (%),'+ro.worst10minSpo2,'  Worst 30-min T95 (%),'+ro.worst30minT95,'  SpO2 Stable Windows (5min),'+ro.spo2StableWindows,'  CDI (/hr),'+ro.cdi,'  Post-Dip HR Response (bpm),'+(ro.postDipHrResponse!==null?ro.postDipHrResponse:''),'  HR Decel Runs,'+ro.hrDecelRuns,'  SpO2-HR Decoupling (%),'+ro.spo2HrDecouplingPct,'  Intra-Night NSI (E/M/L),'+(ro.intraNightNSI?ro.intraNightNSI.join('/'):''));}
    if(n.patScore){var ps=n.patScore;lines.push('','PATTERN SCORES','  Cheyne-Stokes Score (0-3),'+ps.csScore,'  Cheyne-Stokes Label,'+ps.csLabel,'  UARS Score (0-3),'+ps.uarsScore,'  UARS Label,'+ps.uarsLabel);}
    var _hasSP = n.dfa||n.fft||n.hrEnt||n.spo2Ent||n.ssi;
    if(_hasSP){lines.push('','SIGNAL PROCESSING');}
    if(n.dfa){lines.push('  DFA α1,'+n.dfa.alpha1,'  DFA Label,'+n.dfa.dfaLabel);}
    if(n.fft){lines.push('  FFT Peak Freq (Hz),'+n.fft.peakFreqHz,'  FFT Cycle Length (s),'+n.fft.peakCycSec);}
    if(n.hrEnt){lines.push('  HR SampEn,'+n.hrEnt.sampEn,'  HR SampEn Label,'+n.hrEnt.sampEnLabel);}
    if(n.spo2Ent){lines.push('  SpO2 SampEn,'+n.spo2Ent.spo2SampEn,'  SpO2 SampEn Label,'+n.spo2Ent.spo2EnLabel);}
    if(n.ssi){lines.push('  Sympathetic Surge Index,'+n.ssi.ssi,'  SSI Label,'+n.ssi.ssiLabel);}
    if(n.circHR){lines.push('','CIRCADIAN HR','  Amplitude (bpm),'+n.circHR.circAmplitude,'  HR Nadir Hour,'+n.circHR.circNadirHour);}
    if(n.hypLoad){lines.push('','HYPOXIC LOAD (Azarbarzin 2019)','  Hypoxic Load,'+n.hypLoad.hypoxicLoad,'  HL Label,'+n.hypLoad.hlLabel);}
    var _hasCI = n.vagal||n.recIdx||n.sleepP||n.breathI||n.oxyCrash||n.hrnDip||n.desatAsym;
    if(_hasCI){lines.push('','COMPOSITE INDICES');}
    if(n.vagal){lines.push('  Vagal Index,'+n.vagal.vagalIndex,'  Vagal Label,'+n.vagal.vagalLabel);}
    if(n.recIdx){lines.push('  Recovery Index,'+n.recIdx.recoveryIndex,'  Recovery Label,'+n.recIdx.riLabel);}
    if(n.sleepP){lines.push('  Sleep Pressure Index,'+n.sleepP.spi,'  SPI Label,'+n.sleepP.spiLabel);}
    if(n.breathI){lines.push('  Breathing Irregularity CV (%),'+n.breathI.biCV,'  BI Label,'+n.breathI.biLabel);}
    if(n.oxyCrash){lines.push('  OxyCrash Count,'+n.oxyCrash.oxyCrashCount,'  OxyCrash Rate (/hr),'+n.oxyCrash.oxyCrashRate);}
    if(n.hrnDip){lines.push('  Nocturnal HR Dip (%),'+n.hrnDip.hrnDip,'  HRN Dip Label,'+n.hrnDip.hrnDipLabel);}
    if(n.desatAsym){lines.push('  Desaturation Asymmetry,'+n.desatAsym.desatAsym,'  Asym Label,'+n.desatAsym.asymLabel);}
    lines.push('','HYPOXIC BURDEN','Total (%-min),'+(n.hb?n.hb.total:''),'Rate (%-min/hr),'+(n.hb?n.hb.rate:''));
    lines.push('','SLEEP STABILITY','Score (0-100),'+(n.stab?n.stab.score:''),'Grade,'+(n.stab?n.stab.grade:''));
    // Stability component subscores (same as JSONL)
    if(n.stab && n.stab.components) {
      var c=n.stab.components;
      lines.push('  SpO2 Stability Score,'+c.spo2Stab,'  HR Floor Score,'+c.hrFloor,
        '  Motion Score,'+c.motion,'  PB Windows Score,'+c.pb,
        '  Hypoxic Burden Score,'+c.hypoxicBurden,'  T95 Score,'+c.t95);
    }
    // HRV metrics (same as JSONL)
    lines.push('','HRV METRICS');
    if(n.hrv) {
      lines.push('  HR-Var Proxy (SD bpm),'+n.hrv.hrSdnn,
        '  pNN3 (%),'+n.hrv.pnn3,
        '  RSA Proxy,'+n.hrv.rsaProxy,
        '  HR Slope (bpm/hr),'+n.hrv.hrSlope,
        '  HR Floor (p5 bpm),'+n.hrv.hrFloor,
        '  Samples,'+n.hrv.n);
    } else { lines.push('  (insufficient data)'); }
    // Oscillation detail (same as JSONL)
    lines.push('','OSCILLATION DETAIL',
      '  Episode Count,'+(n.osc?n.osc.episodeCount:''),
      '  Peak Crossings (max/window),'+(n.osc?n.osc.peakCrossings||0:''),
      '  Total Crossings (burden),'+(n.osc?n.osc.totalCrossings||0:''),
      '  First Episode,'+(n.osc?n.osc.first||'':''),
      '  Last Episode,'+(n.osc?n.osc.last||'':''));
    // ANS age (proxy + ECG-real) REMOVED 2026-06-21 (external-review WP-A) —
    // no longer written to the CSV export.
    var _ecg = (typeof oxyEcgForNight==='function') ? oxyEcgForNight(n) : null;
    var _F = (_ecg && typeof oxyComputeFusion==='function') ? oxyComputeFusion(n,_ecg) : null;
    if(_F){
      lines.push('','ECG CROSS-CONFIRMATION (paired ECGDex)',
        '  Paired ECG Date,'+((typeof _oxyEcgDate==='function'&&_F.rec)?(_oxyEcgDate(_F.rec.startEpochMs)||''):''),
        '  Confirmed Apnea,'+_F.confirmed+' / '+_F.desN+(_F.confPct!=null?' ('+_F.confPct+'%)':''),
        '  Desat→Arousal Latency (s),'+(_F.medLat!=null?_F.medLat:''),
        '  Apnea Type,'+(_F.apneaType||''),
        '  Hypoxic Dose / Event (%-min),'+(_F.dosePerEv!=null?_F.dosePerEv:''),
        '  Pulse vs ECG HR Δ (bpm),'+(_F.hrDelta!=null?_F.hrDelta:''),
        '  Real rMSSD (ms),'+(_F.t.rmssd!=null?_F.t.rmssd:''),
        '  Real SDNN (ms),'+(_F.t.sdnn!=null?_F.t.sdnn:''),
        '  CRC-PLV Baseline,'+(_F.plvB!=null?_F.plvB:''),
        '  CRC-PLV During Surges,'+(_F.plvS!=null?_F.plvS:''));
      Object.keys(_F.stageAgg).forEach(function(k){ var a=_F.stageAgg[k]; lines.push('  Nadir@'+k+' (deepest% / mean% / n),'+a.deepest.toFixed(1)+' / '+(a.sum/a.count).toFixed(1)+' / '+a.count); });
    }
    lines.push('','---','');
  });
  // BOM + CRLF (RFC 4180 / Excel-safe); final pass blanks any stray missing token so
  // an un-computed value is empty, never the literal "null"/"undefined"/"NaN" (≠ a real 0).
  var _csv=('\uFEFF'+lines.join('\r\n')).replace(/(^|,)(?:null|undefined|NaN)(?=,|\r|\n|$)/g,'$1');
  download(_csv,exportName({node:'OxyDex',t0Ms:_aT0,kind:'summary',ext:'csv',spanDays:_aSpan}),'text/csv');
}

function downloadParser(){
  // Parser SOURCE download — a tool/utility snapshot, NOT a recording export, so it stays OFF the
  // <Node>_<date>_<kind> scheme (EXPORT-HYGIENE-FOLLOWUPS §4 interop precedent). Version-stamped, not
  // clock-stamped — the old _exportTs() here was a pure export-click wall-clock (the bug), now dropped.
  download(_parserSource, 'OxyDex_'+APP_VERSION+'_parser.html', 'text/html');
}

// ── Synthetic patient generator (shared coherence engine · dex-patient-gen.js) ──
// Renders N consecutive nights for one patient as O2Ring CSVs → multi-night ingest.
function genSyntheticPatient(){
  if(!window.DexPatientGen || !window.SYNTH){ setStatus&&setStatus('⚠ generator unavailable',true); return; }
  var r=DexPatientGen.fromControls('genScenario','genDays');
  if(!r){ setStatus&&setStatus('⚠ generator unavailable',true); return; }
  try{ setProgress&&setProgress(3); }catch(_){}
  try{
    var files=r.tls.map(function(tl,i){
      return new File([SYNTH.renderOxy(tl)], 'O2Ring_synthetic_'+r.profile+'_day'+(i+1)+'.csv', {type:'text/csv'});
    });
    handleFiles(files);
  }catch(e){ setStatus&&setStatus('⚠ '+e.message,true); }
}
(function(){ var b=document.getElementById('genBtn'); if(b) b.addEventListener('click', genSyntheticPatient); })();

// ═══════════════════════════════════════════
// Restore last O2Ring session (bundle-safe). FOLLOWUP-FINDINGS P1.
// The "reload last session" chip is wired by a small inline <script> in the
// shell via a bare DOMContentLoaded listener. In the BUNDLE the inliner runs
// app scripts AFTER DOMContentLoaded has fired, so that inline listener never
// runs and the chip never appears. Rather than edit the shell (which would move
// the bundle's buildHash and flip OxyDex's provenance fixtures), we drive the
// restore from this external module — which lands in the manifest, leaving the
// template/buildHash stable (same approach as hrvdex-app.js _hrvInit).
// Guard so dev (unbundled) keeps using the inline listener and we never double-add:
//   bundle → readyState 'complete' here → run now (inline listener is dead).
//   dev    → readyState 'loading' here → skip; the inline listener fires normally.
function _oxyRestoreLast(){
  if(document.getElementById('lastSessionChip')) return;   // never duplicate
  var CK='oxydex_last_csv', NK='oxydex_last_name', cached, name;
  try{ cached=localStorage.getItem(CK)||localStorage.getItem('o2ring_last_csv');
       name=localStorage.getItem(NK)||localStorage.getItem('o2ring_last_name')||'last session'; }catch(e){}
  if(!cached) return;
  var chip=document.createElement('div');
  chip.id='lastSessionChip';
  chip.style.cssText='cursor:pointer;margin:8px 0;display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(61,224,208,.08);border:1px solid rgba(61,224,208,.2);border-radius:8px;font-size:12px;color:#3DE0D0';
  chip.innerHTML='📂 Reload: <strong>'+name+'</strong>';
  chip.onclick=function(){
    try{ setProgress&&setProgress(3); handleFiles([new File([cached],name,{type:'text/csv'})]); }
    catch(e){ setStatus&&setStatus('⚠ '+e.message,true); }
  };
  var ua=document.getElementById('uploadArea');
  if(ua&&ua.parentNode) ua.parentNode.insertBefore(chip,ua);
}
if(document.readyState!=='loading') _oxyRestoreLast();

function download(content, fname, type){
  try {
    var blob=new Blob([content],{type:type+';charset=utf-8;'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a'); a.href=url; a.download=fname;
    document.body.appendChild(a); a.click();
    setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(url);},1000);
  } catch(e){
    window.open('data:'+type+';charset=utf-8,'+encodeURIComponent(content),'_blank');
  }
}
