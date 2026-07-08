/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   PulseDex — Overview module (HRVDex-matched)
   Hero · Projected ANS Age (+VO₂max/BP) · Profile body-composition · Key Metrics
   Reads the global `lastResult` (r) + `welltoryData` history + profile inputs.
   ════════════════════════════════════════════════════════════════════════ */

// ── profile inputs ───────────────────────────────────────────────────────────
function pxProfile(){
  const DP = window.DexProfile;
  if (DP) {
    const p = DP.get(), man = (DP.getRecord().manual) || {};
    const n = (val,d)=>{ const x=parseFloat(val); return isFinite(x)?x:d; };
    // Detected handoff into COMPUTE (PROFILE-HANDOFF-BRIEF §1): manual wins; else a value
    // DETECTED from a loaded recording (origin==='detected'); else 0 ⇒ node auto.
    const detOr0 = field => { const mv = n(man[field],0); if(mv>0) return mv; const r = DP.resolve(field); return (r.origin==='detected'&&r.v>0)?r.v:0; };
    return {
      age:n(p.age,40), sex:p.sex==='F'?'F':'M',
      weight:n(p.weight,78), height:n(p.height,176),
      sbp:n(p.sbp,120), dbp:n(p.dbp,78),
      vo2gt:detOr0('vo2'),
      hrmax:n(man.hrMax,0)>0?n(man.hrMax,0):0,
      rhr:detOr0('hrRest'),
      elev:n(p.elevation,0)
    };
  }
  const v = (id,d)=>{ const e=document.getElementById(id); const n=e?parseFloat(e.value):NaN; return isFinite(n)?n:d; };
  const sx = document.getElementById('profSex');
  return {
    age:    v('profAge',40),
    sex:    sx?sx.value:'M',
    weight: v('profWeight',78),
    height: v('profHeight',176),
    sbp:    v('profSBP',120),
    dbp:    v('profDBP',78),
    vo2gt:  v('profVO2',0),
    hrmax:  v('profHRmax',0),
    rhr:    v('profRHR',0),
    elev:   v('profElev',0)
  };
}

// ── ANS age REMOVED 2026-06-23 (BADGE-COVERAGE-AUDIT-FOLLOWUPS R1, external-review WP-A):
//    a population age-regression dressed as a personal age — no external validation, needs a
//    "not a real age" disclaimer to surface, so it does not earn a card or a KPI tile. The KPI
//    tile + its pxAnsAge() composite are deleted; VO₂ remains at research depth. Do not reinstate.

// ── Welltory history (the loaded CSV) → arrays + previous measurement ─────────
function pxHistory(){
  if(!welltoryData || !welltoryData.header || !welltoryData.rows.length) return null;
  const H = welltoryData.header;
  const idx = n => H.indexOf(n);
  const iRm=idx('rMSSD'), iSd=idx('SDNN'), iHrv=idx('HRV Score'), iSt=idx('Stress(HRV)'),
        iEn=idx('Energy(HRV)'), iDt=idx('Date')>=0?idx('Date'):idx('Time');
  const rows = welltoryData.rows.map(r=>{
    const p = parseTimestamp(r[iDt]||'', {preferDMY:true});   // CLOCK-UNIFY floating wall-clock
    return {
    tMs: p?p.tMs:NaN,
    date: p?new Date(p.tMs):null,
    rmssd:parseFloat(r[iRm]), sdnn:parseFloat(r[iSd]),
    hrv:parseFloat(r[iHrv]), stress:parseFloat(r[iSt]), energy:parseFloat(r[iEn])
  };}).filter(r=>isFinite(r.rmssd)).sort((a,b)=>(a.tMs||0)-(b.tMs||0));   // oldest→newest
  if(!rows.length) return null;
  return { rows, prev: rows[rows.length-1] };
}

const pxMean = a => a.reduce((s,v)=>s+v,0)/a.length;
const pxStd  = a => { const m=pxMean(a); return Math.sqrt(pxMean(a.map(v=>(v-m)**2))); };
const pxMedian = a => { if(!a.length)return 0; const s=[...a].sort((x,y)=>x-y),n=s.length; return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2; };

// ── HERO: ANS Readiness ───────────────────────────────────────────────────────
function renderHeroPx(r){
  const wrap=document.getElementById('heroWrap'); if(!wrap||!r) return;
  const score=r.hrv;
  let color,tier;
  if(score>=55){color='good';tier='Primed · Peak readiness';}
  else if(score>=45){color='good';tier='Ready · Train as planned';}
  else if(score>=33){color='warn';tier='Moderate · Keep it easy';}
  else {color='bad';tier='Strained · Prioritise rest';}
  const cssColor=color==='good'?'var(--status-ok)':color==='warn'?'var(--status-caution)':'var(--status-concern)';

  const hist=pxHistory();
  // recovery index = today's rMSSD vs 7-day baseline
  let ari=null;
  if(hist){ const last7=hist.rows.slice(-7).map(x=>x.rmssd); if(last7.length>=3) ari=+(r.dispRm/pxMean(last7)).toFixed(2); }

  let note;
  if(score>=55) note='Strong parasympathetic recovery — a green light for higher-intensity training.';
  else if(score>=45) note='Balanced autonomic state — proceed with your planned training load.';
  else if(score>=33) note='HRV is around or below baseline — favour easy aerobic work and recovery today.';
  else note='Marked autonomic strain — prioritise rest, sleep and downregulation.';

  const subs=[
    {v:r.dispRm, fmt:v=>v.toFixed(0), label:'rMSSD', cls:v=>v>35?'ok':v>20?'warn':'bad'},
    {v:r.dispSd, fmt:v=>v.toFixed(0), label:'SDNN',  cls:v=>v>50?'ok':v>35?'warn':'bad'},
    {v:r.stress, fmt:v=>v.toFixed(0), label:'Stress',cls:v=>v<45?'ok':v<65?'warn':'bad'},
    {v:ari,      fmt:v=>v.toFixed(2), label:'Recovery',cls:v=>v>1?'ok':v>0.85?'warn':'bad'}
  ];
  let subsHtml='';
  subs.forEach(s=>{ if(s.v==null||isNaN(s.v))return;
    subsHtml+=`<div class="readiness-subscore"><div class="rs-val ${s.cls(s.v)}">${evBadge(s.label)}${s.fmt(s.v)}</div><div class="rs-label">${s.label}</div></div>`; });

  // trend chips from history
  let chips='';
  if(hist && hist.rows.length>=4){
    const ln=hist.rows.slice(-14).map(x=>Math.log(x.rmssd)).filter(isFinite);
    if(ln.length>=4){
      const xs=ln.map((_,i)=>i); const mx=pxMean(xs),my=pxMean(ln);
      let nu=0,de=0; for(let i=0;i<ln.length;i++){nu+=(xs[i]-mx)*(ln[i]-my);de+=(xs[i]-mx)**2;}
      const mom=de?nu/de:0;
      const c=mom>0.002?'ok':mom>-0.01?'warn':'bad';
      const a=mom>0.002?'↗':mom>-0.01?'→':'↘';
      const t=mom>0.002?'HRV trending up':mom>-0.01?'HRV holding steady':'HRV trending down';
      chips+=`<div class="readiness-zone-chip ${c}">${a} ${t}</div>`;
    }
    // recovery debt: days in last 14 with rMSSD below baseline
    const base=pxMean(hist.rows.map(x=>x.rmssd));
    const debt=hist.rows.slice(-14).filter(x=>x.rmssd<base*0.9).length;
    const dc=debt<3?'ok':debt<7?'warn':'bad';
    chips+=`<div class="readiness-zone-chip ${dc}">Recovery debt ${debt}/14d</div>`;
  }

  const dateStr = (r.t0Ms != null) ? new Date(r.t0Ms).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'}) : '';

  wrap.classList.add('show');
  wrap.innerHTML =
    `<div class="readiness-hero" style="--readiness-color:${cssColor}">`
    +`<div class="readiness-hero-label">ANS Readiness</div>`
    +(dateStr?`<div class="readiness-date-badge">${dateStr} · ${r.modeLabel||''}</div>`:'')
    +`<div class="readiness-score" style="color:${cssColor}">${score!=null?score.toFixed(0):'—'}</div>`
    +`<div class="readiness-tier">${tier}</div>`
    +(subsHtml?`<div class="readiness-scores-grid">${subsHtml}</div>`:'')
    +`<div class="readiness-note">${note}</div>`
    +(chips?`<div class="readiness-zones">${chips}</div>`:'')
    +`</div>`;

  // sidebar badge mirror
  const srbScore=document.getElementById('srbScore'), srbNote=document.getElementById('srbNote'),
        srb=document.getElementById('sidebarReadinessBadge');
  if(srbScore){ srbScore.textContent=score!=null?score.toFixed(0):'—'; srbScore.style.setProperty('--srb-color',cssColor); }
  if(srbNote) srbNote.textContent=tier;
  if(srb) srb.style.display='flex';
}

// ── PROJECTED ANS AGE + projected-BP card REMOVED 2026-06-21 (external-review WP-A):
//    a population age regression + cuffless BP from HRV. VO₂ remains at research depth
//    in the KPI grid; pxAnsAge() is still used for the KPI delta.

// ── SECONDARY HERO: VALIDATED HRV BENCH (time-domain) ─────────────────────────
//    Replaces the removed ANS-age card in the #heroTop secondary slot with the
//    node's validated bench — RMSSD/SDNN/pNN50 (Task Force 1996) against their
//    population reference ranges. Reuses the .proj-card heroTop styling.
function renderHrvBenchPx(r){
  const top=document.getElementById('heroTop'); if(!top||!r) return;
  let host=document.getElementById('heroBenchPx');
  if(!host){ host=document.createElement('div'); host.id='heroBenchPx'; host.className='proj-grid'; top.appendChild(host); }
  const rm=r.dispRm, sd=r.dispSd, pn=(r.longRec?r.dispPn:r.pnn50), hr=r.dispHr, tri=r.triIdx;
  const sev = rm>=35?'proj-good':rm>=20?'proj-warn':'proj-bad';
  const vc  = rm>=35?'proj-val-good':rm>=20?'proj-val-warn':'proj-val-bad';
  const f=(lbl,sub,val,unit,cls)=>`<div class="proj-factor"><span>${evBadge(lbl)}${lbl} <span style="opacity:.55">${sub}</span></span><span class="pf-val cv-${cls}">${val!=null&&!isNaN(val)?val+' '+unit:'—'}</span></div>`;
  const sdC = sd>50?'good':sd>35?'warn':'bad';
  const pnC = pn>=15?'good':pn>=3?'warn':'bad';
  const st=(lbl,val,unit,cls)=>`<div class="proj-stat ps-${cls}"><span class="ps-label">${evBadge(lbl)}${lbl}</span><span class="ps-val">${val!=null&&!isNaN(val)?val:'—'}<span class="ps-unit">${unit}</span></span></div>`;
  host.innerHTML =
    `<div class="proj-card ${sev}">`
    + `<div class="proj-header"><span class="proj-icon">💓</span><span class="proj-title">HRV Bench · Time-Domain</span>`
    +   `<span class="proj-badge proj-good">validated</span></div>`
    + `<div class="proj-main"><div class="proj-value ${vc}">${rm!=null&&!isNaN(rm)?rm:'—'}</div><div class="proj-unit">ms · ${evBadge('rMSSD')}rMSSD (vagal tone)</div></div>`
    + `<div class="proj-waterfall">`
    +   f('rMSSD','norm 20–50 ms', rm, 'ms', rm>=35?'good':rm>=20?'warn':'bad')
    +   f('SDNN','norm 50–100 ms', sd, 'ms', sdC)
    +   f('pNN50','norm ≥ 3 %', pn, '%', pnC)
    + `</div>`
    + `<div class="proj-extra">`
    +   st('Mean HR', hr!=null&&!isNaN(hr)?Math.round(hr):null, 'bpm', 'good')
    +   st('Tri Index', tri, '', tri>=15?'good':tri>=9?'warn':'bad')
    + `</div>`
    + `<div class="proj-subline" style="margin-top:auto;opacity:.8">Validated time-domain HRV — RMSSD · SDNN · pNN50 (Task Force 1996). The reference-grade autonomic summary for this reading.</div>`
    + `</div>`;
}

// ── PROFILE body-composition derivations ───────────────────────────────────────
function renderProfileDerivedPx(){
  if (window._pxPanel) { window._pxPanel.refresh(); return; }   // unified panel owns derived now
  const d=document.getElementById('profileDerived'); if(!d) return;
  const p=pxProfile();
  const bmi=p.weight/((p.height/100)**2);
  const bsa=Math.sqrt((p.height*p.weight)/3600);
  const ibw=p.sex==='M'?50+2.3*((p.height/2.54)-60):45.5+2.3*((p.height/2.54)-60);
  const hrmax=p.hrmax>0?Math.round(p.hrmax):Math.round(208-0.7*p.age);   // entered HRmax, else Tanaka (matches VO₂ calc)
  const map_=Math.round(p.dbp+(p.sbp-p.dbp)/3);
  const pp=p.sbp-p.dbp;
  const bmr=p.sex==='M'?Math.round(10*p.weight+6.25*p.height-5*p.age+5):Math.round(10*p.weight+6.25*p.height-5*p.age-161);
  const vo2abs=p.vo2gt>0?(p.vo2gt*p.weight/1000).toFixed(2):'—';
  const bmiCat=bmi<18.5?'Underweight':bmi<25?'Normal':bmi<30?'Overweight':'Obese';
  // VO₂ percentile (Cooper Institute bands)
  function vo2Perc(vo2,age,sex){
    if(!(vo2>0)) return null;
    const m={'20':[[31,5],[37,20],[42,40],[49,60],[55,80],[62,95]],'30':[[29,5],[35,20],[40,40],[46,60],[52,80],[59,95]],'40':[[25,5],[31,20],[36,40],[42,60],[49,80],[56,95]],'50':[[22,5],[27,20],[31,40],[37,60],[44,80],[51,95]],'60':[[18,5],[23,20],[27,40],[32,60],[38,80],[45,95]]};
    const f={'20':[[26,5],[31,20],[36,40],[41,60],[48,80],[55,95]],'30':[[24,5],[29,20],[33,40],[39,60],[45,80],[52,95]],'40':[[21,5],[25,20],[29,40],[34,60],[40,80],[47,95]],'50':[[18,5],[22,20],[26,40],[30,60],[37,80],[44,95]],'60':[[15,5],[19,20],[22,40],[27,60],[34,80],[40,95]]};
    const bin=age<30?'20':age<40?'30':age<50?'40':age<60?'50':'60';
    const pts=(sex==='M'?m:f)[bin];
    for(let j=0;j<pts.length-1;j++){ if(vo2>=pts[j][0]&&vo2<pts[j+1][0]){ const fr=(vo2-pts[j][0])/(pts[j+1][0]-pts[j][0]); return Math.round(pts[j][1]+fr*(pts[j+1][1]-pts[j][1])); } }
    return vo2>=pts[pts.length-1][0]?99:1;
  }
  const vp=vo2Perc(p.vo2gt,p.age,p.sex);
  const vCat=p.vo2gt>0?(vp>=80?'Excellent':vp>=60?'Good':vp>=40?'Average':vp>=20?'Fair':'Poor'):'(enter VO₂)';
  const inch=(p.height/2.54).toFixed(0);
  const di=(l,v,f)=>`<div class="prof-derived-item"><b>${l}</b> ${v}${f?`<span class="pdi-formula">${f}</span>`:''}</div>`;
  const grp=(l,items)=>`<div class="pd-group"><span class="pd-group-label">${l}</span><div class="pd-group-grid">${items}</div></div>`;
  d.innerHTML=
    grp('Body composition',
      di('BMI', bmi.toFixed(1)+' ('+bmiCat+')', 'kg ÷ m² = '+p.weight+' ÷ '+(p.height/100).toFixed(2)+'²')+
      di('IBW', ibw.toFixed(1)+' kg', 'Devine: '+(p.sex==='M'?'50':'45.5')+' + 2.3·('+inch+'in−60)')+
      di('BSA', bsa.toFixed(2)+' m²', 'Mosteller: √('+p.height+'·'+p.weight+'/3600)')+
      di('BMR', bmr+' kcal', 'Mifflin: 10·w+6.25·h−5·a'+(p.sex==='M'?'+5':'−161')))+
    grp('Cardiovascular',
      di('HRmax', hrmax+' bpm', p.hrmax>0?'your entry':'Tanaka: 208−0.7·'+p.age)+
      di('MAP', map_+' mmHg', 'DBP + ⅓(SBP−DBP)')+
      di('Pulse pressure', pp+' mmHg', 'SBP − DBP = '+p.sbp+'−'+p.dbp)+
      di('Resting BP', p.sbp+'/'+p.dbp, 'your entry'))+
    grp('Respiratory / fitness',
      di('VO₂ absolute', vo2abs+(vo2abs!=='—'?' L/min':''), p.vo2gt>0?'VO₂·weight/1000 = '+p.vo2gt+'·'+p.weight+'/1000':'enter VO₂max ground truth')+
      di('VO₂ category', vCat, 'Cooper Institute norms')+
      di('VO₂ percentile', vp!=null?'~'+vp+'th':'—', 'Cooper bands ('+(p.age<30?'20s':p.age<40?'30s':p.age<50?'40s':p.age<60?'50s':'60+')+' '+(p.sex==='M'?'M':'F')+')'));
}

// ── KEY METRICS grid (HRVDex-style, fed by PulseDex metrics) ───────────────────
function renderKpiGridPx(r){
  const g=document.getElementById('kpiGrid'); if(!g||!r) return;
  const hist=pxHistory(); const prev=hist?hist.prev:null;
  let ari=null,ariSub='>1.05 = above base',sdz=null,sdzSub='vs 7d baseline';
  if(hist){
    const r7=hist.rows.slice(-7);
    if(r7.length>=3){ ari=+(r.dispRm/pxMean(r7.map(x=>x.rmssd))).toFixed(2);
      const sd7=r7.map(x=>x.sdnn); const sg=pxStd(sd7); sdz=sg?+((r.dispSd-pxMean(sd7))/sg).toFixed(2):null; }
  }
  // Intra-recording fallbacks so both always generate (esp. overnight, no log loaded)
  if(ari==null && r.windows && r.windows.length>=6){
    const w=r.windows, t=Math.floor(w.length/3);
    const early=pxMedian(w.slice(0,t).map(x=>x.rmssd)), late=pxMedian(w.slice(-t).map(x=>x.rmssd));
    if(early>0){ ari=+(late/early).toFixed(2); ariSub='late/early rMSSD'; }
  }
  if(sdz==null){   // population z-score: adult SDNN norm ≈ 50 ms, SD ≈ 16 (Task Force / Nunan 2010)
    sdz=+((r.dispSd-50)/16).toFixed(2); sdzSub='vs population norm';
  }
  const vei=+(r.dispRm/r.dispHr).toFixed(2);
  const D=(cur,key,inv)=> prev&&isFinite(prev[key])?{d:(cur-prev[key]),inv:!!inv}:null;
  const K=[
    {l:'HRV Score', v:r.hrv,            s:'vs prev',          c:r.hrv>45?'good':r.hrv>33?'warn':'bad', delta:D(r.hrv,'hrv')},
    {l:'SDNN',      v:r.dispSd+'',      s:'ms · 5-min',       c:r.dispSd>50?'good':r.dispSd>35?'warn':'bad', delta:D(r.dispSd,'sdnn'),u:'ms'},
    {l:'rMSSD',     v:r.dispRm+'',      s:'ms · parasymp.',   c:r.dispRm>35?'good':r.dispRm>20?'warn':'bad', delta:D(r.dispRm,'rmssd'),u:'ms'},
    {l:'Stress',    v:r.stress,         s:'HRV score',        c:r.stress<45?'good':r.stress<65?'warn':'bad', delta:D(r.stress,'stress',1)},
    {l:'Energy',    v:r.energy,         s:'HRV score',        c:r.energy>55?'good':r.energy>35?'warn':'bad', delta:D(r.energy,'energy')},
    {l:'Baevsky SI',v:r.si,             s:'<150 normal',      c:r.si<150?'good':r.si<250?'warn':'bad'},
    {l:'LF/HF',     v:r.lfhf,           s:'0.5–2.0 optimal',  c:(r.lfhf>0.4&&r.lfhf<2.5)?'good':'warn'},
    {l:'Recov Index',v:ari!=null?ari:'—',s:ariSub,c:ari==null?'neutral':ari>1?'good':ari>0.85?'warn':'bad'},
    {l:'Coherence', v:r.coherence,      s:'PulseDex-native',  c:r.coherence>60?'good':r.coherence>30?'warn':'bad'},
    {l:'SDNN Z',    v:sdz!=null?sdz:'—',s:sdzSub,            c:sdz==null?'neutral':sdz>-0.5?'good':sdz>-1.5?'warn':'bad'},
    {l:'SD1/SD2',   v:r.sd1sd2,         s:'0.25–0.5 typical', c:(r.sd1sd2>0.2&&r.sd1sd2<0.5)?'good':'warn'},
    {l:'HF n.u.',   v:r.hfnu,           s:'parasympathetic %',c:r.hfnu>35?'good':r.hfnu>20?'warn':'bad'},
    {l:'VO₂max Est',v:r.vo2adj,         s:'ml/kg/min',        c:r.vo2adj>=45?'good':r.vo2adj>=40?'warn':'bad'},
    /* SBP Est / DBP Est rows REMOVED 2026-06-21 (external-review WP-A) — cuffless BP from HRV. */
    {l:'ABS',       v:r.abs,            s:'−1=SNS +1=PSNS',   c:r.abs>0?'good':r.abs>-0.3?'warn':'bad'},
    {l:'Vagal Eff', v:vei,              s:'rMSSD/HR',         c:vei>0.55?'good':vei>0.4?'warn':'bad'},
    {l:'EFC Ready', v:r.efc,            s:'readiness 0–100',  c:r.efc>60?'good':r.efc>40?'warn':'bad'},
    {l:'DFA α1',    v:r.dfa1==null?'—':r.dfa1, s:'fractal scaling', c:r.dfa1==null?'neutral':(r.dfa1>=0.9&&r.dfa1<=1.2)?'good':(r.dfa1<0.75||r.dfa1>1.5)?'bad':'warn'},
    {l:'SampEn',    v:r.sampen==null?'—':r.sampen, s:'complexity', c:r.sampen==null?'neutral':r.sampen>=1?'good':r.sampen>=0.6?'warn':'bad'},
    {l:'Tri Index', v:r.triIdx,         s:'geometric HRV',    c:r.triIdx>=15?'good':r.triIdx>=9?'warn':'bad'},
    {l:'Decel Cap', v:r.dc==null?'—':r.dc, s:'ms · vagal',    c:r.dc==null?'neutral':r.dc>=4.5?'good':r.dc>=2.5?'warn':'bad',u:'ms'},
    {l:'Resp Rate', v:r.respRate,       s:'br/min (RSA)',     c:(r.respRate>=10&&r.respRate<=20)?'good':'warn'},
    {l:'pNN50',     v:(r.longRec?r.dispPn:r.pnn50)+'', s:'beat-pair %',  c:(r.longRec?r.dispPn:r.pnn50)>=15?'good':(r.longRec?r.dispPn:r.pnn50)>=5?'warn':'bad',u:'%'},
    {l:'Coverage',  v:r.coverage+'',    s:'data captured',    c:r.coverage>=95?'good':r.coverage>=85?'warn':'bad',u:'%'},
    {l:'Artifacts', v:r.artifactPct+'', s:'corrected',        c:r.artifactPct<2?'good':r.artifactPct<8?'warn':'bad',u:'%'},
  ];
  if(r.longRec && r.sdann!=null) K.push({l:'SDANN',v:r.sdann,s:'long-recording',c:r.sdann>50?'good':r.sdann>30?'warn':'bad',u:'ms'});

  g.innerHTML = K.map(k=>{
    let dH='';
    if(k.delta){ const v=k.delta.d; const good=k.delta.inv?v<0:v>0; const cls=Math.abs(v)<0.05?'neutral':good?'up':'down';
      const ar=Math.abs(v)<0.05?'→':v>0?'↑':'↓'; dH=`<div class="kpi-delta ${cls}">${ar} ${Math.abs(v).toFixed(1)}${k.u||''} vs prev</div>`; }
    const col=k.c==='good'?'green':k.c==='warn'?'yellow':k.c==='bad'?'red':'blue';
    const val=(k.v===undefined||k.v===null||k.v===''||k.v==='NaN'||(typeof k.v==='number'&&isNaN(k.v)))?'—':k.v;
    return `<div class="kpi ${k.c}"><div class="kpi-label">${evBadge(k.l)}${k.l}</div><div class="kpi-val" style="color:var(--${col})">${val}</div>${dH}<div class="kpi-sub">${k.s}</div></div>`;
  }).join('');
  g.classList.add('show');
  document.getElementById('slKPI').style.display='flex';
}

// ── orchestrator (called from calculate) ──────────────────────────────────────
function renderOverviewPx(r){
  document.getElementById('heroTop').style.display='grid';
  document.getElementById('sec-profile').style.display='block';
  document.getElementById('profilePanel').style.display='block';
  computeProfileHints(r);
  renderHeroPx(r);
  renderHrvBenchPx(r);
  renderProfileDerivedPx();
  renderKpiGridPx(r);
}

// ════════════════════════════════════════════════════════════════════════════
//  PROFILE — persistence · predictive hints · population/ideal norms
// ════════════════════════════════════════════════════════════════════════════
const PX_PROFILE_KEYS = ['profAge','profSex','profWeight','profHeight','profSBP','profDBP','profVO2','profHRmax','profRHR','profElev'];

function loadProfile(){
  // Storage unified onto the shared DexProfile engine (key `tepna_profile`,
  // PROFILE-UNIFY-BRIEF). DOM stays the runtime source of truth (pxProfile reads it);
  // only the persistence backend changes. Pristine guard keeps PulseDex's own HTML
  // defaults until the shared record holds real identity data.
  if (window.DexProfile) {
    try {
      DexProfile.migrate();
      if (window.DexProfile.renderPanel && !window._pxPanel) {
        window._pxPanel = window.DexProfile.renderPanel({ node:'pulsedex', mount:'dexProfilePanel', onChange:function(){ if(typeof reRender==='function') reRender(); } });
      }
      if (!DexProfile.isPristine()) {
        const p = DexProfile.get(), man = (DexProfile.getRecord().manual) || {};
        const set = (id,v) => { const el=document.getElementById(id); if(el!=null && v!=null && v!=='') el.value=v; };
        set('profAge', p.age); const sx=document.getElementById('profSex'); if(sx) sx.value = p.sex==='F'?'F':'M';
        set('profWeight', p.weight); set('profHeight', p.height);
        set('profSBP', p.sbp); set('profDBP', p.dbp);
        set('profVO2', man.vo2!=null?man.vo2:''); set('profHRmax', man.hrMax!=null?man.hrMax:'');
        set('profRHR', man.hrRest!=null?man.hrRest:''); set('profElev', p.elevation!=null?p.elevation:'');
      }
    } catch(e) {}
    renderProfileDerivedPx();
    return;
  }
  let saved=null;
  try{ saved=JSON.parse(localStorage.getItem('pulsedex_profile')||'null'); }catch(e){}
  if(saved){ PX_PROFILE_KEYS.forEach(k=>{ const el=document.getElementById(k); if(el&&saved[k]!=null&&saved[k]!=='') el.value=saved[k]; }); }
  renderProfileDerivedPx();
}
function saveProfile(){
  if (window.DexProfile) {
    try {
      const g = id => { const e=document.getElementById(id); return e?e.value:''; };
      const num = v => { const n=parseFloat(v); return isFinite(n)?n:null; };
      // Guard on element existence — post panel-swap the legacy inputs are gone and the
      // unified panel owns persistence; this prevents a stray save from clobbering manual.
      if(document.getElementById('profAge')){
        DexProfile.setManual('age', num(g('profAge')));
        if(document.getElementById('profSex')) DexProfile.setManual('sex', g('profSex'));
        if(document.getElementById('profWeight')) DexProfile.setManual('weight', num(g('profWeight')));
        if(document.getElementById('profHeight')) DexProfile.setManual('height', num(g('profHeight')));
        if(document.getElementById('profSBP')) DexProfile.setManual('sbp', num(g('profSBP')));
        if(document.getElementById('profDBP')) DexProfile.setManual('dbp', num(g('profDBP')));
        if(document.getElementById('profVO2')) DexProfile.setManual('vo2', num(g('profVO2'))>0?num(g('profVO2')):null);
        if(document.getElementById('profHRmax')) DexProfile.setManual('hrMax', num(g('profHRmax'))>0?num(g('profHRmax')):null);
        if(document.getElementById('profRHR')) DexProfile.setManual('hrRest', num(g('profRHR'))>0?num(g('profRHR')):null);
        if(document.getElementById('profElev')) DexProfile.setManual('elevation', num(g('profElev')));
      }
    } catch(e) {}
    return;
  }
  const o={}; PX_PROFILE_KEYS.forEach(k=>{ const el=document.getElementById(k); if(el) o[k]=el.value; });
  try{ localStorage.setItem('pulsedex_profile', JSON.stringify(o)); }catch(e){}
}

// user edited a field → persist + mark it as a manual override + re-derive
function onProfileInput(id, lblId){
  saveProfile();
  if(lblId){ const l=document.getElementById(lblId); if(l){ l.textContent='✓ your value'; l.classList.remove('est'); } }
  reRender();
}

function toggleProfilePanel(){
  const body=document.getElementById('profileBody'), btn=document.getElementById('profileToggleBtn');
  const open=body.style.display!=='none';
  body.style.display=open?'none':'block';
  if(btn) btn.textContent=open?'▼ expand':'▲ collapse';
}

// population average weight/height by sex (rough adult means), and ideal (BMI 22.5)
function popNorms(sex,age){
  const h = sex==='F' ? 163 : 177;                    // cm
  const w = sex==='F' ? 71  : 86;                     // kg (US adult mean)
  return {h, w};
}
function applyAgeNorms(ideal){
  if(!document.getElementById('profSex')) return;   // unified panel active — legacy norm buttons removed
  const sex=document.getElementById('profSex').value;
  const age=parseFloat(document.getElementById('profAge').value)||40;
  const n=popNorms(sex,age);
  const h=n.h;
  const w=ideal ? +(22.5*(h/100)**2).toFixed(1) : n.w;
  document.getElementById('profHeight').value=h;
  document.getElementById('profWeight').value=w;
  saveProfile(); reRender();
}

// predictive sublabels — show what each field WOULD be if auto-estimated
function computeProfileHints(r){
  if(!document.getElementById('profSex')) return;   // unified panel active — legacy hint inputs removed
  const set=(id,txt,est)=>{ const l=document.getElementById(id); if(!l)return; l.textContent=txt; l.classList.toggle('est',!!est); };
  const sex=document.getElementById('profSex').value;
  const age=parseFloat(document.getElementById('profAge').value)||40;
  const n=popNorms(sex,age);
  // ANS-age age hint REMOVED 2026-06-21 (external-review WP-A) — population age regression.
  // Weight ← pop avg + ideal
  const ideal=+(22.5*((parseFloat(document.getElementById('profHeight').value)||n.h)/100)**2).toFixed(1);
  set('lbl_weight','~ pop. avg '+n.w+' kg · ideal '+ideal+' kg');
  set('lbl_height','~ pop. avg '+n.h+' cm');
  // SBP/DBP HRV-projection hints REMOVED 2026-06-21 (external-review WP-A) — cuffless BP from HRV.
  // VO2 ← Uth-Sørensen base (HRmax over awake resting HR), altitude-corrected
  if(r){ const hm=r.hrmaxEff||Math.round(208-0.7*age); const rh=Math.round(r.rhrEff||r.dispHr);
    const altTxt=(r.altFactor&&r.altFactor<1)?' · alt ×'+r.altFactor:'';
    set('lbl_vo2gt','~ Uth-Sørensen → '+r.vo2base+' (HRmax '+hm+'/HRrest '+rh+altTxt+')');
    // HRmax field: warn if an implausible entry was rejected
    if(r.hrmaxRejected) set('lbl_hrmax','⚠ entry too low — using Tanaka '+r.tanaka+' bpm',true);
    else { const hrIn=Number(document.getElementById('profHRmax').value)||0;
      set('lbl_hrmax', hrIn>0?'✓ your value '+hm+' bpm':'~ Tanaka: 208 − 0.7 × age = '+r.tanaka); }
    // Elevation hint
    const ev=Number(document.getElementById('profElev').value)||0;
    if(ev>=2500) set('lbl_elev','🏔 '+ev.toLocaleString()+' m · VO₂ ×'+r.altFactor+' · HRV norms = sea-level (caution)',true);
    else if(ev>1500) set('lbl_elev','⛰ '+ev.toLocaleString()+' m · VO₂ ×'+r.altFactor,true);
    else set('lbl_elev','~ sea level · adjusts VO₂max & norms above 1500 m');
    const rhrIn=Number(document.getElementById('profRHR').value)||0;
    if(rhrIn>0) set('lbl_rhr','✓ your value');
    else if(r.longRec && r.hrFloor!=null) set('lbl_rhr','~ nocturnal floor '+r.hrFloor+' + 8 = '+r.autoRHR+' bpm (awake est)',true);
    else set('lbl_rhr','~ measured '+Math.round(r.dispHr)+' bpm (awake reading)',true); }
}

// expose for inline handlers
Object.assign(window,{onProfileInput,toggleProfilePanel,applyAgeNorms,loadProfile,saveProfile,computeProfileHints,renderOverviewPx,reRender:typeof reRender!=='undefined'?reRender:undefined});
