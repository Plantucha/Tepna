/* ════ OxyDex · ECGDex FUSION + ANS-AGE PROJECTION + FULL METRICS TABLE ════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   Loaded after oxydex-render.js, before oxydex-app.js. Shares page scope.

   Adds, without touching the oximetry pipeline:
   • A "Projected ANS Age" card beside the readiness hero (#heroTop).
       – native: a clearly-labelled PROXY from 1 Hz pulse-rate variability +
         nocturnal HR floor (OxyDex has no true RR-based HRV).
       – when an ECGDex JSON export for the same night is dropped in: the REAL
         ECG-derived ANS age + rMSSD/SDNN composite.
   • An "ECG Cross-Confirmation" section that fuses OxyDex desaturations with
     ECGDex autonomic-surge Ganglior events (confirmed-apnea story), cross-checks
     pulse-rate vs ECG heart-rate, and shows real HRV next to the proxy.
   • An ECGDex-style 6-column Full Metrics Table (replaces the old research dump).

   CLOCK CONTRACT: ECGDex event `t` ("HH:MM:SS", no date) is reconstructed to an
   absolute floating-wall-clock ms against the export's floating startEpochMs date
   using Date.UTC + getUTC* only (viewer-timezone-independent), rolling past
   midnight monotonically. OxyDex desat times come from t0Ms + sampleIdx·1000 (1 Hz).
   ════════════════════════════════════════════════════════════════════════ */

window._ecgByDate = window._ecgByDate || {};

/* ── floating-ms helpers (getUTC* only, per the clock contract) ── */
function _oxyEcgDate(startEpochMs){
  if(startEpochMs==null) return null;
  var d=new Date(startEpochMs);
  return d.getUTCFullYear()+'-'+('0'+(d.getUTCMonth()+1)).slice(-2)+'-'+('0'+d.getUTCDate()).slice(-2);
}
// "HH:MM:SS" → absolute floating ms anchored on startEpochMs's civil date,
// rolled forward past midnight (monotonic relative to prevMs).
function _oxyHHMMSStoMs(startEpochMs, hhmmss, prevMs){
  if(startEpochMs==null || !hhmmss) return null;
  var p=String(hhmmss).split(':'); if(p.length<2) return null;
  var d=new Date(startEpochMs);
  var base=Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
                    +p[0]||0, +p[1]||0, +(p[2]||0)||0);
  // allow the first event to sit slightly before the anchor; otherwise roll forward
  while(base < startEpochMs - 3600000) base += 86400000;
  if(prevMs!=null){ while(base < prevMs - 1000) base += 86400000; }
  return base;
}

/* ── match an ECGDex export to an OxyDex night by TEMPORAL OVERLAP ──
   Date-string matching is unreliable: an overnight OxyDex night and a separate
   next-evening night can both anchor near the same civil date, and a single
   loaded ECG must NOT be smeared across every night. Instead we compare the two
   recordings' actual [start,end] windows on the shared floating wall-clock
   (per the clock contract both are floating ms, so this is viewer-tz-independent).
   An ECG pairs to the night whose window it overlaps most; if none truly overlap
   we allow a small gap (devices started a little apart) but never across a whole
   day. ── */
function _oxyNightWindow(n){
  if(!n || n.t0Ms==null) return null;
  var dur=(n.stats&&n.stats.durationMin!=null)?n.stats.durationMin:0;
  return { a:n.t0Ms, b:n.t0Ms + dur*60000 };
}
function _oxyEcgWindow(ecg){
  var rec=ecg&&ecg.recording; if(!rec||rec.startEpochMs==null) return null;
  var durMin=(rec.durationMin!=null)?rec.durationMin
            :(rec.durationSec!=null?rec.durationSec/60:0);
  return { a:rec.startEpochMs, b:rec.startEpochMs + durMin*60000 };
}
function oxyEcgForNight(n){
  if(!n || !window._ecgByDate) return null;
  var keys=Object.keys(window._ecgByDate);
  if(!keys.length) return null;

  var nw=_oxyNightWindow(n);
  if(nw){
    // pick the ECG with the greatest temporal overlap (or smallest gap) to THIS night
    var best=null, bestScore=-Infinity, MAXGAP=4*3600000; // tolerate ≤4 h device-start offset
    keys.forEach(function(k){
      var ecg=window._ecgByDate[k], ew=_oxyEcgWindow(ecg);
      if(!ew){
        // ECG lacks a usable window → fall back to civil-date equality only
        if(k===n.date){ if(0>bestScore){ bestScore=0; best=ecg; } }
        return;
      }
      var overlap=Math.min(nw.b,ew.b)-Math.max(nw.a,ew.a); // >0 ⇒ windows intersect
      var score;
      if(overlap>0){ score=overlap; }
      else {
        var gap=Math.max(nw.a,ew.a)-Math.min(nw.b,ew.b); // shortest distance between windows
        if(gap>MAXGAP) return;                            // different night entirely → skip
        score=-gap;                                       // closer (smaller gap) ranks higher
      }
      if(score>bestScore){ bestScore=score; best=ecg; }
    });
    if(best) return best;
  }

  // no usable night window → exact civil-date match, else the lone ECG
  if(n.date && window._ecgByDate[n.date]) return window._ecgByDate[n.date];
  if(keys.length===1 && !nw) return window._ecgByDate[keys[0]];
  return null;
}

/* ── ECG sleep-stage lookup at a given minute-from-recording-start (5-min bins) ── */
function _oxyStageAt(ecg, minFromStart){
  var st=ecg && ecg.timeseries && ecg.timeseries.sleepStages;
  if(!st || !st.length || minFromStart==null || minFromStart<-2.5) return null;
  var bin=Math.floor(minFromStart/5)*5, exact=null, nearest=null, na=Infinity;
  for(var i=0;i<st.length;i++){
    if(st[i].tMin===bin){ exact=st[i].stage; break; }
    var a=Math.abs(st[i].tMin-minFromStart);
    if(a<na){ na=a; nearest=st[i].stage; }
  }
  return exact!=null ? exact : (na<=5 ? nearest : null);
}

/* ── status helper ── */
function _oxySev(good, warn, val, lowerBetter){
  if(val==null || !isFinite(val)) return '';
  if(lowerBetter) return val<=good?'ok':val<=warn?'warn':'bad';
  return val>=good?'ok':val>=warn?'warn':'bad';
}

/* ════════════════════════════════════════════════════════════════════════
   VALIDATED BENCH CARD — sits beside the readiness hero (replaces the former
   "Projected ANS Age" card, removed 2026-06-21 per external-review WP-A).
   Surfaces the node's VALIDATED apnea bench — hypoxic burden (Azarbarzin 2019)
   headline + ODI-4 / ODI-3 (AASM) — instead of a heuristic age number. No
   disclaimer needed; these are the clinically meaningful summary metrics.
   ════════════════════════════════════════════════════════════════════════ */
function oxyHeroBenchCard(n, ecg){
  if(!n) return '';
  var hb=n.hb||null, od4=n.odi4||null, od3=n.odi3||null;
  if((!hb||hb.rate==null) && (!od4||od4.rate==null) && (!od3||od3.rate==null)) return '';
  var headVal, headUnit, headLbl, sev;
  if(hb && hb.rate!=null){
    headVal=hb.rate; headUnit='%·min/h'; headLbl='hypoxic burden';
    sev = hb.rate<5?'proj-good':hb.rate<25?'proj-warn':'proj-bad';
  } else if(od4 && od4.rate!=null){
    headVal=od4.rate; headUnit='/hr'; headLbl='ODI-4';
    sev = od4.rate<5?'proj-good':od4.rate<15?'proj-warn':'proj-bad';
  } else {
    headVal=od3.rate; headUnit='/hr'; headLbl='ODI-3';
    sev = od3.rate<5?'proj-good':od3.rate<15?'proj-warn':'proj-bad';
  }
  var vc = sev==='proj-good'?'var(--green)':sev==='proj-warn'?'var(--amber)':'var(--red)';
  var _ev=function(l){ return (typeof evBadge==='function')?evBadge(l):''; };
  var row=function(lbl,sub,v,unit){ return '<div class="opc-row"><span>'+_ev(lbl)+lbl+' <span style="opacity:.55">'+sub+'</span></span><span class="v">'+(v!=null?'→ '+v+' '+unit:'—')+'</span></div>'; };
  var rows='';
  if(hb && hb.rate!=null)  rows+=row('Hypoxic burden','Azarbarzin 2019 · AUC<94%', hb.rate, '%·min/h');
  if(od4 && od4.rate!=null) rows+=row('ODI-4','AASM 4% desat index', od4.rate, '/hr');
  if(od3 && od3.rate!=null) rows+=row('ODI-3','AASM 3% desat index', od3.rate, '/hr');
  // ── Measured oximetry KPIs — fill out the card with the raw severity
  // descriptors that sit alongside the indices on any apnea bench. All are
  // direct sensor statistics (measured tier), so they share the card's badge.
  var st=n.stats||{};
  var kpi=function(lbl,val,cls){ return '<div class="opc-kpi opc-'+cls+'"><div class="opc-kpi-v">'+val+'</div><div class="opc-kpi-l">'+_ev(lbl)+lbl+'</div></div>'; };
  var kpis='';
  if(st.minSpo2!=null)  kpis+=kpi('Min SpO₂',  st.minSpo2+'%',  st.minSpo2>=90?'good':st.minSpo2>=85?'warn':'bad');
  if(st.meanSpo2!=null) kpis+=kpi('Mean SpO₂', st.meanSpo2+'%', st.meanSpo2>=95?'good':st.meanSpo2>=92?'warn':'bad');
  if(st.t90pct!=null)   kpis+=kpi('T90 time',  st.t90pct+'%',   st.t90pct<0.5?'good':st.t90pct<2?'warn':'bad');
  return '<div class="oxy-projcard '+sev+'">'
    + '<div class="opc-head"><span class="opc-icon">🫁</span><span class="opc-title">Apnea Bench · Last Night</span>'
    +   '<span class="opc-badge real">validated</span></div>'
    + '<div class="opc-main"><div class="opc-val" style="color:'+vc+'">'+headVal+'</div><div class="opc-unit">'+headUnit+' · '+_ev(headLbl)+headLbl+'</div></div>'
    + '<div class="opc-wf">'+rows+'</div>'
    + (kpis?'<div class="opc-kpis">'+kpis+'</div>':'')
    + '<div class="opc-cite">Validated apnea-severity bench — hypoxic burden (Azarbarzin 2019), AASM oxygen-desaturation indices, and the measured SpO₂ severity descriptors. The clinically meaningful summary for the night.</div>'
    + '</div>';
}

/* ════════════════════════════════════════════════════════════════════════
   PROXY ANS AGE + PROJECTED ANS-AGE CARD REMOVED 2026-06-21 (external-review WP-A)
   — a population age regression dressed as a personal metric. The readiness hero now
   shows oxyHeroBenchCard (validated apnea bench); node exports keep ansAge:null for
   back-compat. oxyAnsAgeProxy()/oxyProjAgeCard() deleted; no surface consumes them.
   ════════════════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════════════════
   ECG CROSS-CONFIRMATION (fusion) — COMPUTE (data only; shared by render + export)
   ════════════════════════════════════════════════════════════════════════ */
function oxyComputeFusion(n, ecg){
  if(!n || !ecg) return null;
  var s=n.stats||{}, hrv=n.hrv||{};
  var rec=ecg.recording||{}, t=(ecg.hrv&&ecg.hrv.time)||{}, ap=ecg.apnea||null;

  // ── apnea fusion + matched-pair latency (metric 1) ──
  // SHARED GATE with the Integrator (integrator-dsp.js fuseApneaEvents): an
  // obstructive arousal should coincide-or-trail the SpO₂ nadir, so the match
  // window is ASYMMETRIC in seconds — surge may lead by ≤LEAD, trail by ≤TRAIL.
  // Keep these two numbers identical in both files (R4 consistency).
  var LEAD=15, TRAIL=60;
  var surges=[];
  if(Array.isArray(ecg.ganglior_events) && rec.startEpochMs!=null){
    var prev=null;
    ecg.ganglior_events.forEach(function(ev){
      if(!ev || ev.impulse!=='autonomic_surge') return;
      var ms=_oxyHHMMSStoMs(rec.startEpochMs, ev.t, prev);
      if(ms!=null){ surges.push(ms); prev=ms; }
    });
    surges.sort(function(a,b){return a-b;});
  }
  var desatMs=[], desatDepth=[];
  if(n.desat && Array.isArray(n.desat.events) && n.t0Ms!=null){
    n.desat.events.forEach(function(e){
      var idx=(e.nadirIdx!=null?e.nadirIdx:e.startIdx);
      if(idx!=null){
        desatMs.push(n.t0Ms + idx*1000);
        desatDepth.push(e.depth!=null?e.depth:(e.baseline!=null&&e.nadir!=null?(e.baseline-e.nadir):0));
      }
    });
  }
  var confirmed=0, latencies=[], usedSurge={};
  if(surges.length && desatMs.length){
    desatMs.forEach(function(dm){
      var best=null, bestAbs=Infinity, bestI=-1;
      for(var i=0;i<surges.length;i++){
        if(usedSurge[i]) continue;
        var d=surges[i]-dm, lat=d/1000;
        if(lat < -LEAD || lat > TRAIL) continue;        // directionality gate
        var a=Math.abs(d);
        if(a<bestAbs){ bestAbs=a; best=d; bestI=i; }
      }
      if(best!=null){ usedSurge[bestI]=1; confirmed++; latencies.push(best/1000); }
    });
  }
  var desN=desatMs.length, confPct = desN? Math.round(confirmed/desN*100) : null;
  // ── null model (mirror of Integrator): expected confirmations by chance ──
  var _w0=Math.min.apply(null,[].concat(surges,desatMs)), _w1=Math.max.apply(null,[].concat(surges,desatMs));
  var _unionSec=(surges.length&&desatMs.length&&isFinite(_w0)&&isFinite(_w1))?Math.max(1,(_w1-_w0)/1000):0;
  var _rate=_unionSec>0?surges.length/_unionSec:0;
  var _lambda=desN*Math.min(1,_rate*(LEAD+TRAIL));
  var _term=Math.exp(-_lambda), _cum=0; for(var _k=0;_k<confirmed;_k++){ _cum+=_term; _term*=_lambda/(_k+1); }
  var pSpurious=Math.max(0,Math.min(1,1-_cum));
  var belowChance=(confirmed===0)||(confirmed<=_lambda)||(pSpurious>=0.05);
  var medLat=null, apneaType=null, latType=null;
  if(latencies.length){
    var ls=latencies.slice().sort(function(a,b){return a-b;});
    medLat=ls[Math.floor(ls.length/2)];
    if(medLat>=5){ apneaType='obstructive-type'; latType='bad'; }
    else if(medLat<=-5){ apneaType='central-type'; latType='warn'; }
    else { apneaType='mixed / co-incident'; latType='warn'; }
  }

  // ── metric 2: hypoxic dose per confirmed CVHR event (%·min / event) ──
  var hbTotal = (n.hb && n.hb.total!=null) ? n.hb.total : null;
  var cvhrEv  = (ap && ap.cvhrEvents!=null) ? ap.cvhrEvents : null;
  var doseDenom = confirmed>0 ? confirmed : (cvhrEv||0);
  var doseBasis = confirmed>0 ? 'confirmed desat' : (cvhrEv?'ECG CVHR':null);
  var dosePerEv = (hbTotal!=null && doseDenom>0) ? +(hbTotal/doseDenom).toFixed(1) : null;

  // ── metric 4: SpO₂ nadir depth per ECG-staged sleep stage ──
  // ECG staging is precise but only covers its own recording window. Desats the
  // paired ECG didn't cover go into an explicit "Unstaged" bucket (choice a) so
  // the breakdown still populates — we do NOT fabricate a stage from the
  // aggregate OxyDex proxy. OxyDex's own REM/deep proxy is surfaced separately
  // as context (stageProxyCtx).
  var stageAgg={}; // stage -> {sum,count,deepest}
  var hasEcgStaging = !!(ecg.timeseries && Array.isArray(ecg.timeseries.sleepStages) && ecg.timeseries.sleepStages.length && rec.startEpochMs!=null);
  for(var di=0; di<desatMs.length; di++){
    var stg=null;
    if(hasEcgStaging){ stg=_oxyStageAt(ecg, (desatMs[di]-rec.startEpochMs)/60000); }
    var key = stg || 'Unstaged';
    if(!stageAgg[key]) stageAgg[key]={sum:0,count:0,deepest:0,unstaged:!stg};
    var dp=desatDepth[di]||0;
    stageAgg[key].sum+=dp; stageAgg[key].count++; if(dp>stageAgg[key].deepest) stageAgg[key].deepest=dp;
  }
  // OxyDex's own (oximetry-derived) stage proxy — context only, not per-event
  var sp=n.stageProxy||null;
  var stageProxyCtx = sp ? { remProxyPct:sp.remProxyPct, nremDeepProxyPct:sp.nremDeepPct,
    remProxyMin:sp.remProxyMin, nremDeepMin:sp.nremDeepMin } : null;

  // ── chip 8: cardiorespiratory phase-locking drop during surges ──
  var cr=ecg.cardiorespiratory||{};
  var plvB=(cr.plvBaseline!=null)?cr.plvBaseline:null, plvS=(cr.plvDuringSurges!=null)?cr.plvDuringSurges:null;

  // ── HR cross-check ──
  var oxyMeanHr=s.meanHr, ecgMeanHr=(t.hr!=null?t.hr:null);
  var hrDelta=(oxyMeanHr!=null&&ecgMeanHr!=null)?+(oxyMeanHr-ecgMeanHr).toFixed(1):null;
  var oxyFloor=hrv.hrFloor, ecgFloor=(ecg.personalization&&(ecg.personalization.restingHRNocturnalFloor||ecg.personalization.restingHR))||null;

  // ── resp-rate instability (metric 6) ──
  var rstat=(ecg.hrv&&ecg.hrv.frequency&&ecg.hrv.frequency.respRateEpochStats)
          || (ecg.hrv&&ecg.hrv.respRateEpochStats) || null;

  return { rec:rec, t:t, ap:ap, cr:cr, surges:surges,
    confirmed:confirmed, desN:desN, confPct:confPct, latencies:latencies,
    belowChance:belowChance, pSpurious:+pSpurious.toFixed(3), expectedConfirmed:+_lambda.toFixed(2),
    gate:{ leadMaxSec:LEAD, trailMaxSec:TRAIL },
    medLat:medLat, apneaType:apneaType, latType:latType,
    hbTotal:hbTotal, cvhrEv:cvhrEv, doseDenom:doseDenom, doseBasis:doseBasis, dosePerEv:dosePerEv,
    stageAgg:stageAgg, stageProxyCtx:stageProxyCtx, plvB:plvB, plvS:plvS,
    oxyMeanHr:oxyMeanHr, ecgMeanHr:ecgMeanHr, hrDelta:hrDelta, oxyFloor:oxyFloor, ecgFloor:ecgFloor,
    rstat:rstat };
}

/* ════════════════════════════════════════════════════════════════════════
   ECG CROSS-CONFIRMATION (fusion) — apnea confirm · HR cross-check · real HRV
   ════════════════════════════════════════════════════════════════════════ */
function oxyEcgFusionSection(n, ecg){
  if(!n || !ecg) return '';
  var F=oxyComputeFusion(n, ecg); if(!F) return '';
  var s=n.stats||{}, hrv=n.hrv||{};
  var rec=F.rec, t=F.t, ap=F.ap, cr=F.cr, surges=F.surges;
  var confirmed=F.confirmed, desN=F.desN, confPct=F.confPct, latencies=F.latencies;
  var belowChance=F.belowChance, pSpurious=F.pSpurious, expectedConfirmed=F.expectedConfirmed;
  var GATE=F.gate||{leadMaxSec:15,trailMaxSec:60};
  var medLat=F.medLat, apneaType=F.apneaType, latType=F.latType;
  var hbTotal=F.hbTotal, doseDenom=F.doseDenom, doseBasis=F.doseBasis, dosePerEv=F.dosePerEv;
  var stageAgg=F.stageAgg, stageProxyCtx=F.stageProxyCtx, plvB=F.plvB, plvS=F.plvS;
  var oxyMeanHr=F.oxyMeanHr, ecgMeanHr=F.ecgMeanHr, hrDelta=F.hrDelta, oxyFloor=F.oxyFloor, ecgFloor=F.ecgFloor;
  var rstat=F.rstat;

  var tile=function(val,cls,lbl,sub){
    return '<div class="efz-tile"><div class="efz-val '+(cls||'')+'">'+val+'</div>'
      +'<div class="efz-lbl">'+lbl+'</div>'+(sub?'<div class="efz-sub">'+sub+'</div>':'')+'</div>';
  };

  var html='<div class="sec-label sec-label-lg" id="sec-ecgfusion">⚡ ECG Cross-Confirmation '
    + '<span style="color:var(--text3);font-weight:var(--fw-regular);font-size:13px">· paired ECGDex export ('
    + (_oxyEcgDate(rec.startEpochMs)||'ECG')+')</span></div>';
  html+='<div class="ecg-fusion">';
  // chip 8 — CRC-PLV drop during surges (Cardiorespiratory coupling breakdown)
  if(plvB!=null && plvS!=null){
    var plvDrop=+(plvB-plvS).toFixed(3), plvOk=plvS<plvB;
    html+='<div class="efz-chiprow"><span class="efz-chip '+(plvOk?'ok':'')+'">'
      + (plvOk?'✓':'•')+' CRC-PLV '+(plvOk?'drops':'holds')+' during surges &nbsp;'
      + '<b>'+plvB.toFixed(3)+' → '+plvS.toFixed(3)+'</b>'+(plvOk?' (−'+plvDrop.toFixed(3)+')':'')
      + '</span><span class="efz-chip-note">'
      + (plvOk?'cardiorespiratory coupling weakens during autonomic surges — consistent with arousal-driven events'
             :'coupling held through surges — surges look non-respiratory')
      + (cr.crcPLV!=null?' · whole-night CRC-PLV '+cr.crcPLV:'')+'</span></div>';
  }
  html+='<div class="efz-grid">';

  // apnea confirmation tile
  if(desN){
    var gateTxt='−'+GATE.leadMaxSec+'s…+'+GATE.trailMaxSec+'s';
    if(confirmed>0 && !belowChance){
      var apCls = confPct>=50?'bad':confPct>=25?'warn':'ok';
      html+=tile(confirmed+'/'+desN, apCls, 'Confirmed apnea',
        confPct+'% of desats co-occur with a directionally-consistent ECG surge ('+gateTxt+')');
    } else if(confirmed>0 && belowChance){
      html+=tile(confirmed+'/'+desN, 'warn', 'Confirmed apnea',
        'at/below chance (expected ≈'+expectedConfirmed+', p='+pSpurious+') — not asserted');
    } else {
      html+=tile('0/'+desN, 'ok', 'Confirmed apnea',
        'no desat had a directionally-consistent surge ('+gateTxt+')');
    }
  } else {
    html+=tile('—','blue','Confirmed apnea','no scored desaturations this night');
  }
  // ECG apnea band
  if(ap && ap.estimatedAHI){
    var band=ap.estimatedAHI.band||'—', av=ap.estimatedAHI.value;
    var bCls = /sever/i.test(band)?'bad':/moder/i.test(band)?'warn':/mild/i.test(band)?'warn':'ok';
    html+=tile((av!=null?av:'—')+'<span style="font-size:13px;color:var(--text3)"> /h</span>', bCls,
      'ECG-estimated AHI', band+(ap.cvhrIndex!=null?' · CVHR '+ap.cvhrIndex+'/h':''));
  }
  // HR cross-check
  if(hrDelta!=null){
    var hCls = Math.abs(hrDelta)<=3?'ok':Math.abs(hrDelta)<=6?'warn':'bad';
    html+=tile((hrDelta>0?'+':'')+hrDelta+'<span style="font-size:13px;color:var(--text3)"> bpm</span>', hCls,
      'Pulse vs ECG HR', 'OxyDex '+oxyMeanHr+' · ECG '+ecgMeanHr+' bpm mean');
  }
  // real HRV vs proxy
  if(t.rmssd!=null){
    html+=tile(t.rmssd+'<span style="font-size:13px;color:var(--text3)"> ms</span>','blue',
      'Real rMSSD (ECG)', 'OxyDex carries only a pulse-rate proxy');
  }
  // metric 1 — desat→arousal latency (apnea typing)
  if(medLat!=null){
    html+=tile((medLat>0?'+':'')+Math.round(medLat)+'<span style="font-size:13px;color:var(--text3)"> s</span>', latType,
      'Desat→arousal latency', apneaType+' · '+latencies.length+' paired event'+(latencies.length>1?'s':'')+' (median surge−nadir)');
  } else if(desN){
    html+=tile('—','blue','Desat→arousal latency','no desat aligned to a surge — typing needs a confirmed pair');
  }
  // metric 2 — hypoxic dose per confirmed CVHR event
  if(dosePerEv!=null){
    var dCls = dosePerEv<=2?'ok':dosePerEv<=5?'warn':'bad';
    html+=tile(dosePerEv+'<span style="font-size:13px;color:var(--text3)"> %·min</span>', dCls,
      'Hypoxic dose / event', 'per '+doseBasis+' event · burden '+(hbTotal!=null?hbTotal+' %·min':'—')+' ÷ '+doseDenom);
  }
  html+='</div>'; // efz-grid

  // metric 4 — SpO₂ nadir depth by ECG sleep stage
  var stageKeys=Object.keys(stageAgg);
  if(stageKeys.length){
    var STAGE_ORDER=['Wake','REM','Light','Deep','N1','N2','N3','Unstaged'];
    stageKeys.sort(function(a,b){ var ia=STAGE_ORDER.indexOf(a), ib=STAGE_ORDER.indexOf(b); return (ia<0?99:ia)-(ib<0?99:ib); });
    var maxDeep=0; stageKeys.forEach(function(k){ if(stageAgg[k].deepest>maxDeep) maxDeep=stageAgg[k].deepest; });
    var bars='';
    stageKeys.forEach(function(k){
      var a=stageAgg[k], mean=+(a.sum/a.count).toFixed(1), w=maxDeep>0?Math.round(a.deepest/maxDeep*100):0;
      var un=a.unstaged?' efz-stage-un':'';
      var nm=a.unstaged?'Unstaged':escHTML(k);
      bars+='<div class="efz-stagerow'+un+'"><span class="efz-stagename">'+nm+'</span>'
        +'<span class="efz-stagebar"><span class="efz-stagefill" style="width:'+Math.max(w,6)+'%"></span></span>'
        +'<span class="efz-stageval">−'+a.deepest.toFixed(0)+'% deepest · −'+mean+'% mean · '+a.count+'×'+(a.unstaged?' · no ECG coverage':'')+'</span></div>';
    });
    var ctx='';
    if(stageProxyCtx && stageProxyCtx.remProxyPct!=null){
      ctx='<div class="efz-stagectx">OxyDex stage proxy (oximetry-derived, whole-night): REM ≈ '
        +stageProxyCtx.remProxyPct+'% · deep ≈ '+(stageProxyCtx.nremDeepProxyPct!=null?stageProxyCtx.nremDeepProxyPct:'—')
        +'% — used as context only; per-desat staging above is from the ECG hypnogram.</div>';
    }
    html+='<div class="efz-stagewrap"><div class="efz-stagehd">SpO₂ nadir depth by sleep stage</div>'+bars+ctx+'</div>';
  } else if(stageProxyCtx && stageProxyCtx.remProxyPct!=null){
    html+='<div class="efz-stagewrap"><div class="efz-stagehd">Sleep-stage context</div>'
      +'<div class="efz-stagectx">No scored desaturations to stage this night. OxyDex stage proxy: REM ≈ '
      +stageProxyCtx.remProxyPct+'% · deep ≈ '+(stageProxyCtx.nremDeepProxyPct!=null?stageProxyCtx.nremDeepProxyPct:'—')+'%.</div></div>';
  }

  // narrative
  var story='The fusion layer (Ganglior) correlates ECGDex <code>autonomic_surge</code> events against '
    + 'OxyDex desaturations on the shared timeline — ';
  if(desN && surges.length){
    story += confirmed>0
      ? (belowChance
          ? '<b style="color:var(--text)">'+confirmed+' of '+desN+'</b> desaturation'+(confirmed>1?'s':'')+' fell within the directional window of an ECG surge, '
            + 'but that is at or below what chance alone would produce here (expected \u2248'+expectedConfirmed+'), so it is <b>not asserted</b> as confirmed apnea.'
          : '<b style="color:var(--text)">'+confirmed+' of '+desN+'</b> desaturations line up with a directionally-consistent ECG surge (\u2212'+GATE.leadMaxSec+'s\u2026+'+GATE.trailMaxSec+'s), '
            + 'the cardiac fingerprint of obstructive events. Neither node can claim apnea alone; together they confirm it.')
      : 'none of this night\u2019s desaturations align with an ECG surge in the directional window — desats here look non-apneic (e.g. positional / artefact).';
  } else {
    story += 'this pairing adds the ECG view (real HRV, CVHR/AHI, autonomic surges) to the oximetry record.';
  }
  if(ap && ap.riskCategory) story += ' ECG apnea read: <b style="color:var(--text)">'+ap.riskCategory+'</b>.';
  if(apneaType) story += ' The desat→arousal latency (<b style="color:var(--text)">'+(medLat>0?'+':'')+Math.round(medLat)+' s</b>) reads <b style="color:var(--text)">'+apneaType+'</b>.';
  html+='<div class="efz-note">'+story+'</div>';

  // metric 6 — respiratory-rate instability cross-validation
  if(rstat && rstat.sd!=null){
    var unstable=rstat.sd>=3;
    html+='<div class="efz-note" style="margin-top:8px"><b style="color:var(--text)">Resp-rate instability (ECG-derived):</b> '
      + 'SD '+rstat.sd+' br/min'+(rstat.median!=null?' around '+rstat.median+' br/min':'')
      + ' — '+(unstable?'<b style="color:var(--amber)">unstable</b>, consistent with periodic breathing':'stable')
      + (n.osc&&n.osc.episodeCount!=null?'. OxyDex flagged '+n.osc.episodeCount+' oscillation window'+(n.osc.episodeCount===1?'':'s')+' — '
          +((unstable&&n.osc.episodeCount>0)||(!unstable&&n.osc.episodeCount===0)?'the two nodes agree':'the two nodes diverge, worth a look')+'.':'.')
      + '</div>';
  }

  // real-HRV strip
  html+='<div class="efz-note" style="margin-top:8px"><b style="color:var(--text)">Real HRV (from ECG):</b> '
    + 'rMSSD '+(t.rmssd!=null?t.rmssd:'—')+' ms · SDNN '+(t.sdnn!=null?t.sdnn:'—')+' ms · '
    + 'mean HR '+(t.hr!=null?t.hr:'—')+' bpm'
    + (oxyFloor!=null&&ecgFloor!=null?' &nbsp;·&nbsp; resting floor: OxyDex '+oxyFloor+' vs ECG '+ecgFloor+' bpm':'')
    + '. OxyDex\u2019s own HRV (SD '+(hrv.hrSdnn!=null?hrv.hrSdnn:'—')+' bpm) is a 1 Hz pulse-rate proxy — use the ECG values for clinical HRV.</div>';

  html+='</div>'; // ecg-fusion
  return html;
}

/* ════════════════════════════════════════════════════════════════════════
   FULL METRICS TABLE — ECGDex-style 6 columns
   METRIC · VALUE · UNIT · NORMAL RANGE · STATUS · NOTES
   ════════════════════════════════════════════════════════════════════════ */
/* ── prettify a camelCase/underscore key for table display ── */
function _oxyPretty(k){
  return String(k).replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/_/g,' ')
    .replace(/\b\w/g, function(c){ return c.toUpperCase(); })
    .replace(/\bSpo2\b/g,'SpO₂').replace(/\bHr\b/g,'HR').replace(/\bHrv\b/g,'HRV')
    .replace(/\bOdi\b/g,'ODI').replace(/\bAhi\b/g,'AHI').replace(/\bPb\b/g,'PB')
    .replace(/\bRmssd\b/g,'rMSSD').replace(/\bSdnn\b/g,'SDNN').replace(/\bCv\b/g,'CV');
}

/* ── every extended-metric family, grouped, for the COMPLETE table + JSON dump.
   Keys are read live off the night object so names can't drift out of sync. ── */
var OXY_RESEARCH_GROUPS = [
  ['SpO₂ — Extended Signal',
    ['spo2Drift','odi2','odi1','spo2Over','spo2Ac1','spo2Shape','spo2Pct',
     'condSpo2','t88t85','ct94','slopes','desatAsym','nadirTrend','iei',
     'recovCV','spo2NadirT','spo2Ceil','odri','o2hrEff','hypLoad','hypDose','oxyCrash']],
  ['Heart Rate / HRV — Extended',
    ['hrFreq','respRate','hrAsym','hrQuart','hrCV','circHR','hrEnt','poincare',
     'rmssdArc','hrNadirT','hrnDip','vagal','ssi','dfa','hrFlat','spo2HRLag']],
  ['HR Spike Kinematics',
    ['spkDecay','spkUnder','spkRise','spk50Rec']],
  ['Periodic Breathing & Pattern Probability',
    ['pbMet','fft','spo2Ent','patScore']],
  ['Sleep Architecture — Extended',
    ['stageProxy','lcsp','recIdx','sleepP','breathI','rolling']],
  ['Derived Indices & Recording QA',
    ['mos','ahiEst','extras','dataGaps','sbii','pred3p','desSev','ctPrec','tIdx','period','cross','spo2Adv','hrAdv','comp']]
];

function _oxyFmt(v, dec){
  if(v==null || v==='' || (typeof v==='number' && !isFinite(v))) return '—';
  if(typeof v==='number') return (dec!=null)?(+v).toFixed(dec):String(v);
  return String(v);
}
function buildFullMetricsTable(n){
  if(!n) return '';
  var s=n.stats||{}, hrv=n.hrv||{}, ecg=(typeof oxyEcgForNight==='function')?oxyEcgForNight(n):null;
  var rows=[]; // [section] or [metric, value, unit, normal, status, notes]
  var sec=function(t){ rows.push({sec:t}); };
  var r=function(m,v,u,nm,st,note){ rows.push({m:m,v:v,u:u||'',nm:nm||'—',st:st||'',note:note||''}); };

  // ── Recording ──
  sec('Recording');
  r('Source', n.fname||'O2Ring CSV', '', '—', '', 'Raw 1 Hz SpO₂ · pulse · motion');
  r('Date', n.date||'—');
  r('Duration', _oxyFmt(s.durationMin,1), 'min', '≥360', _oxySev(360,300,s.durationMin), 'Recording span');
  r('Start', s.start||'—'); r('End', s.end||'—');
  r('Sample rate', 1, 'Hz', '1', '', 'O2Ring / Wellue native');

  // ── SpO₂ ──
  sec('Oxygen Saturation (SpO₂)');
  r('Mean SpO₂', _oxyFmt(s.meanSpo2,1), '%', '≥94', _oxySev(94,92,s.meanSpo2), 'Whole-night average');
  r('Min SpO₂', _oxyFmt(s.minSpo2), '%', '≥88', _oxySev(90,85,s.minSpo2), 'Lowest sample');
  r('Max SpO₂', _oxyFmt(s.maxSpo2), '%', '—');
  r('SpO₂ Std Dev', _oxyFmt(s.spo2Std,2), '%', '<1.5', _oxySev(1,1.5,s.spo2Std,true), 'Signal stability');
  r('T95 (time <95%)', _oxyFmt(s.t95pct,1), '%', '<10', _oxySev(5,10,s.t95pct,true), 'Fraction of night below 95%');
  r('T90 (time <90%)', _oxyFmt(s.t90pct,2), '%', '<1', _oxySev(0.5,1,s.t90pct,true), 'Clinically watched threshold');

  // ── Desaturation index ──
  sec('Desaturation Index (ODI)');
  if(n.odi4){ r('ODI-4', _oxyFmt(n.odi4.rate,1), '/h', '<5', _oxySev(5,15,n.odi4.rate,true), n.odi4.count+' events ≥4% drop'); }
  if(n.odi3){ r('ODI-3', _oxyFmt(n.odi3.rate,1), '/h', '<5', _oxySev(5,15,n.odi3.rate,true), n.odi3.count+' events ≥3% drop'); }
  if(n.hb){ r('Hypoxic burden', _oxyFmt(n.hb.total,1), '%·min', '—', '', 'Area under 90% (Azarbarzin)');
            r('Hypoxic burden rate', _oxyFmt(n.hb.rate,2), '%·min/h', '—'); }

  // ── Pulse / HRV proxy ──
  sec('Pulse & HRV (1 Hz proxy)');
  r('Mean HR', _oxyFmt(s.meanHr,1), 'bpm', '—', '', 'Nocturnal pulse');
  r('Min HR', _oxyFmt(s.minHr), 'bpm', '—');
  r('Max HR', _oxyFmt(s.maxHr), 'bpm', '—');
  if(hrv.hrFloor!=null) r('HR floor (p5)', _oxyFmt(hrv.hrFloor), 'bpm', '≤55', _oxySev(55,62,hrv.hrFloor,true), 'Resting nocturnal floor');
  if(hrv.hrSdnn!=null)  r('HR-Var proxy', _oxyFmt(hrv.hrSdnn,2), 'SD bpm', '—', '', 'Pulse-rate variability (proxy, not RR)');
  if(hrv.rsaProxy!=null) r('RSA proxy', _oxyFmt(hrv.rsaProxy,2), '', '—');
  if(n.spikes) r('HR spikes', n.spikes.length, '', '—', _oxySev(5,15,n.spikes.length,true), 'Sympathetic surges');

  // ── Periodic breathing / oscillation ──
  if(n.osc){
    sec('Periodic Breathing');
    r('Oscillation windows', _oxyFmt(n.osc.episodeCount), '5-min', '0', _oxySev(0,3,n.osc.episodeCount,true), 'PB/CSR pattern windows');
    if(n.osc.totalCrossings!=null) r('Total crossings', _oxyFmt(n.osc.totalCrossings), '', '—', '', 'PB burden');
  }

  // ── Movement / sleep ──
  sec('Movement & Sleep');
  r('Motion', _oxyFmt(s.motionPct,1), '%', '<5', _oxySev(3,5,s.motionPct,true), 'Restless fraction');
  if(n.motion){ r('Arousal index', _oxyFmt(n.motion.arousalIndex), '/h', '<10', _oxySev(5,10,n.motion.arousalIndex,true)); }
  if(n.motSleep){ r('Sleep efficiency', _oxyFmt(n.motSleep.sleepEff,1), '%', '≥85', _oxySev(85,75,n.motSleep.sleepEff), 'Motion-derived'); }
  if(n.stab){ r('Sleep stability', _oxyFmt(n.stab.score), '/100', '≥80', _oxySev(80,60,n.stab.score), n.stab.grade||''); }

  // ── Readiness / projections ──
  if(n.karv || n.vo2est || n.bpProj){
    sec('Readiness & Projections');
    if(n.karv) r('Recovery readiness', _oxyFmt(n.karv.readiness), '/100', '≥70',
      n.karv.readinessColor==='good'?'ok':n.karv.readinessColor==='warn'?'warn':'bad', n.karv.readinessTier||'');
    if(n.vo2est) r('VO₂max estimate', _oxyFmt(n.vo2est.vo2est,1), 'ml/kg/min', '≥35',
      _oxySev(42,35,n.vo2est.vo2est), n.vo2est.vo2Category||'Uth–Sørensen, HRV-adj');
    if(n.bpProj) r('BP projection', _oxyFmt(n.bpProj.sbpEst)+'/'+_oxyFmt(n.bpProj.dbpEst), 'mmHg', '<120/80',
      n.bpProj.sbpColor||'', '⚠ epidemiological estimate, not a measurement');
  }

  // ── ECG-paired (real) ──
  if(ecg){
    var t=(ecg.hrv&&ecg.hrv.time)||{}, aa=(ecg.personalization&&ecg.personalization.ansAge)||{}, ap=ecg.apnea||{};
    sec('Paired ECG (ECGDex · real RR-based)');
    r('ECG mean HR', _oxyFmt(t.hr,1), 'bpm', '—', '', 'From R-peaks');
    r('rMSSD', _oxyFmt(t.rmssd,1), 'ms', '—', '', 'Parasympathetic tone');
    r('SDNN', _oxyFmt(t.sdnn,1), 'ms', '—', '', 'Total variability');
    if(t.pnn50!=null) r('pNN50', _oxyFmt(t.pnn50,1), '%', '—');
    if(aa.composite!=null) r('ANS age (ECG)', aa.composite, 'yr', '—', '', 'rMSSD·SDNN·restHR composite');
    if(ap.estimatedAHI) r('ECG-estimated AHI', _oxyFmt(ap.estimatedAHI.value), '/h', '<5',
      /sever/i.test(ap.estimatedAHI.band||'')?'bad':/mild|moder/i.test(ap.estimatedAHI.band||'')?'warn':'ok', ap.estimatedAHI.band||'');
    if(ap.cvhrIndex!=null) r('CVHR index', _oxyFmt(ap.cvhrIndex,1), '/h', '—', '', (ap.cvhrEvents!=null?ap.cvhrEvents+' cyclic events':''));
  }

  // ── Flags ──
  if(n.flags && n.flags.length){
    sec('Flags');
    r('Active flags', n.flags.map(function(f){return f.code;}).join(' · '), '', '—', '', n.flags.length+' raised');
  }

  // ── ALL remaining computed research metrics (auto-walked, nothing hidden) ──
  // Mirrors the old auto-dump: every extended-metric family not already shown
  // above is emitted here so the table is COMPLETE, not curated-only.
  OXY_RESEARCH_GROUPS.forEach(function(g){
    var groupRows=[];
    g[1].forEach(function(key){
      var obj=n[key];
      if(obj==null || typeof obj!=='object') return;
      Object.keys(obj).forEach(function(f){
        var v=obj[f];
        if(v==null || v==='') return;
        if(typeof v==='object'){
          try { v = Array.isArray(v) ? v.slice(0,12).join(' / ') : JSON.stringify(v); } catch(e){ return; }
          if(v.length>90) v=v.slice(0,87)+'…';
        }
        if(typeof v==='number' && !isFinite(v)) return;
        var st='';
        if(typeof v==='string'){
          if(/\b(high|severe|abrupt|worsening|critical|significant)\b/i.test(v)) st='bad';
          else if(/\b(low|normal|stable|mild|none|regular|symmetric)\b/i.test(v)) st='ok';
          else if(/\b(moderate|elevated|variable|mixed|early|blunted)\b/i.test(v)) st='warn';
        }
        groupRows.push({ m:_oxyPretty(f), v:v, u:'', nm:'—', st:st, note:_oxyPretty(key) });
      });
    });
    if(groupRows.length){ sec(g[0]); rows=rows.concat(groupRows); }
  });

  // ── render ──
  var pill=function(st){
    if(st==='ok')   return '<span class="pill pill-green">OK</span>';
    if(st==='warn') return '<span class="pill pill-yellow">WATCH</span>';
    if(st==='bad')  return '<span class="pill pill-red">FLAG</span>';
    return '<span style="color:var(--text4)">—</span>';
  };
  var body='';
  rows.forEach(function(row){
    if(row.sec){
      body+='<tr class="fmt-sec"><td colspan="6">'+escHTML(row.sec)+'</td></tr>';
    } else {
      body+='<tr>'
        +'<td class="fmt-m">'
          + ( typeof evBadge==='function' ? evBadge(row.m) : '' )
          + escHTML(String(row.m))
          + '</td>'
        +'<td class="fmt-v">'+ (typeof row.v==='string'&&row.v.indexOf('<')>=0 ? row.v : escHTML(String(row.v))) +'</td>'
        +'<td>'+escHTML(String(row.u))+'</td>'
        +'<td>'+escHTML(String(row.nm))+'</td>'
        +'<td>'+pill(row.st)+'</td>'
        +'<td class="fmt-note">'+escHTML(String(row.note))+'</td>'
        +'</tr>';
    }
  });
  return '<div class="table-wrap oxy-fulltable"><table><thead><tr>'
    + '<th>Metric</th><th>Value</th><th>Unit</th><th>Normal Range</th><th>Status</th><th>Notes</th>'
    + '</tr></thead><tbody>'+body+'</tbody></table></div>';
}

/* Front-page (all-modes) collapsible wrapper for the latest night's table */
function oxyFrontFullTable(n){
  if(!n) return '';
  var tbl;
  try { tbl=buildFullMetricsTable(n); } catch(e){ return ''; }
  if(!tbl) return '';
  return '<div class="sec-section" id="sec-fulltable">'
    + '<div class="research-accordion oxy-fulltable-acc">'
    + '<div class="research-accordion-header" data-act="toggleResearchAccordion">'
    +   '<span>📋 Full Metrics Table</span>'
    +   '<span class="research-accordion-header-line"></span>'
    +   '<span class="research-accordion-chevron">▼</span></div>'
    + '<div class="research-accordion-body">'+tbl+'</div></div></div>';
}

/* ════════════════════════════════════════════════════════════════════════
   ECGDex JSON UPLOADER — parse, store by date, re-render
   ════════════════════════════════════════════════════════════════════════ */
function handleEcgJson(file){
  if(!file) return;
  var statusEl=document.getElementById('ecgJsonStatus');
  var setS=function(msg,ok){ if(statusEl){ statusEl.textContent=msg; statusEl.classList.toggle('ok',!!ok); } };
  var rd=new FileReader();
  rd.onload=function(){
    var obj;
    try { obj=JSON.parse(rd.result); }
    catch(e){ setS('⚠ not valid JSON',false); return; }
    var isEcg = obj && obj.schema && /ecgdex/i.test(obj.schema.node||'')
             || (obj && obj.personalization && obj.personalization.ansAge);
    if(!isEcg){ setS('⚠ not an ECGDex export',false); return; }
    var date = _oxyEcgDate(obj.recording && obj.recording.startEpochMs);
    if(!date){ date = 'ecg-'+(Object.keys(window._ecgByDate).length+1); }
    window._ecgByDate[date]=obj;
    var nApnea = obj.apnea ? ' · AHI '+((obj.apnea.estimatedAHI&&obj.apnea.estimatedAHI.value)||'—')+'/h' : '';
    var aa = (obj.personalization&&obj.personalization.ansAge&&obj.personalization.ansAge.composite);
    setS('✓ '+date+(aa!=null?' · ANS age '+aa+' yr':'')+nApnea, true);
    var chip=document.getElementById('ecgJsonChip');
    if(chip){ chip.style.display='inline-flex'; chip.textContent='⚡ ECGDex '+date+' linked'; }
    // re-render so the hero card + fusion section pick up the paired ECG
    try { if(typeof renderAll==='function' && typeof allNights!=='undefined' && Object.keys(allNights).length) renderAll(); } catch(e){}
  };
  rd.onerror=function(){ setS('⚠ could not read file',false); };
  rd.readAsText(file);
}

/* wire the uploader once the DOM is ready */
(function(){
  function wire(){
    var inp=document.getElementById('ecgJsonInput');
    if(inp && !inp._wired){ inp._wired=1; inp.addEventListener('change', function(){ if(this.files&&this.files[0]) handleEcgJson(this.files[0]); this.value=''; }); }
    var zone=document.getElementById('ecgXcheck');
    if(zone && !zone._wired){
      zone._wired=1;
      zone.addEventListener('dragover', function(e){ e.preventDefault(); zone.classList.add('drag'); });
      zone.addEventListener('dragleave', function(){ zone.classList.remove('drag'); });
      zone.addEventListener('drop', function(e){ e.preventDefault(); zone.classList.remove('drag');
        if(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) handleEcgJson(e.dataTransfer.files[0]); });
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
