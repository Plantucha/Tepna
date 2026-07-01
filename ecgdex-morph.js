/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   ECGDex · MORPHOLOGY · ECTOPY · RHYTHM  (ecgdex-morph.js)
   ────────────────────────────────────────────────────────────────────────
   The "second half" of single-lead ECG — everything beyond RR/HRV:
     · median-beat template from high-SQI normal beats
     · delineation → QRS duration · QT · QTc (Bazett + Fridericia) · PR ·
       ST level · P/T/R amplitudes  (Tier 3 — DIRECTIONAL within-subject trends,
       single lead ≠ 12-lead, honestly flagged)
     · per-beat classification N / PVC(V) / PAC(S) → counts · burden · couplets ·
       runs(VT flag) · bigeminy · longest run   (Tier 1 — solid)
     · AF screen from RR irregularity (Shannon entropy of ΔRR + CV) — SCREEN ONLY,
       P-wave weak at 130 Hz   (Tier 2)
   Exposes window.ECGMorph.  Pure functions; no UI.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';

const mean = a => { let s=0; for(let i=0;i<a.length;i++) s+=a[i]; return a.length?s/a.length:0; };
const std  = a => { const m=mean(a); let s=0; for(let i=0;i<a.length;i++) s+=(a[i]-m)*(a[i]-m); return Math.sqrt(s/(a.length||1)); };
const median = a => { if(!a.length) return 0; const s=[...a].sort((x,y)=>x-y),n=s.length; return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2; };

// ─── local (windowed) median RR around beat k, normal beats only ───────────────
function localMedRR(rr, k, half){
  const seg=[]; for(let j=Math.max(1,k-half); j<=Math.min(rr.length-1,k+half); j++){ if(j!==k && rr[j]>=300 && rr[j]<=2000) seg.push(rr[j]); }
  return seg.length ? median(seg) : (rr[k]||900);
}

// ════════════════════════════════════════════════════════════════════════
//  PER-BEAT CLASSIFICATION  → N (normal) · V (PVC) · S (PAC)
//  features: prematurity (rr / local-median) · QRS width (band-passed energy) ·
//  template cross-correlation · compensatory pause.
// ════════════════════════════════════════════════════════════════════════
function classifyBeats(int16, bp, fs, refIdx, rr, sqi){
  const n = refIdx.length;
  const peakI = new Int32Array(n); for(let k=0;k<n;k++) peakI[k]=Math.round(refIdx[k]);
  const halfQ = Math.round(0.09*fs);               // ±90 ms QRS search half-window

  // per-beat QRS width (ms) from band-passed |bp| energy
  const qrsW = new Float32Array(n);
  for(let k=0;k<n;k++){
    const i=peakI[k], s=Math.max(0,i-halfQ), e=Math.min(bp.length-1,i+halfQ);
    let pk=0; for(let j=s;j<=e;j++){ const a=Math.abs(bp[j]); if(a>pk) pk=a; }
    const thr=0.25*pk; let lo=i,hi=i;
    for(let j=i;j>=s;j--){ if(Math.abs(bp[j])>=thr) lo=j; else break; }
    for(let j=i;j<=e;j++){ if(Math.abs(bp[j])>=thr) hi=j; else break; }
    qrsW[k]=(hi-lo)/fs*1000;
  }
  const medW = median(Array.from(qrsW).filter(w=>w>30&&w<200));

  // normal template (raw, baseline-removed) from beats with rr≈median & high SQI & normal width
  const tHalf=Math.round(0.07*fs), tLen=2*tHalf+1;
  const acc=new Float64Array(tLen); let nAcc=0;
  const medRR=median(Array.from(rr).filter(v=>v>=300&&v<=2000));
  for(let k=2;k<n-2;k++){
    if(sqi[k]<0.6) continue;
    if(rr[k]<0.88*medRR||rr[k]>1.12*medRR) continue;
    if(qrsW[k]>medW*1.25) continue;
    const i=peakI[k]; if(i-tHalf<0||i+tHalf>=int16.length) continue;
    const b=int16[i-tHalf];
    for(let j=0;j<tLen;j++) acc[j]+=int16[i-tHalf+j]-b;
    nAcc++; if(nAcc>=400) break;
  }
  const tmpl=new Float64Array(tLen); for(let j=0;j<tLen;j++) tmpl[j]=acc[j]/(nAcc||1);
  // normalize template
  let tm=mean(Array.from(tmpl)), ts=std(Array.from(tmpl))||1;
  const tN=tmpl.map(v=>(v-tm)/ts);

  // correlation per beat
  const corr=new Float32Array(n);
  for(let k=0;k<n;k++){
    const i=peakI[k]; if(i-tHalf<0||i+tHalf>=int16.length){ corr[k]=1; continue; }
    let s=0,ss=0; const win=new Float64Array(tLen);
    for(let j=0;j<tLen;j++){ const v=int16[i-tHalf+j]; win[j]=v; s+=v; ss+=v*v; }
    const m=s/tLen, sd=Math.sqrt(Math.max(1e-6,ss/tLen-m*m));
    let c=0; for(let j=0;j<tLen;j++) c+=((win[j]-m)/sd)*tN[j];
    corr[k]=c/tLen;
  }

  // classify
  const types=new Array(n).fill('N');
  for(let k=1;k<n-1;k++){
    if(sqi[k]<0.55){ types[k]='N'; continue; }      // only call ectopy on clean beats (avoids artifact-driven false runs)
    const lm=localMedRR(rr,k,8);
    const prem=rr[k]/lm;
    const wide=qrsW[k]>medW*1.6;
    const lowCorr=corr[k]<0.6;
    const nextPause=(k+1<n)? rr[k+1]/lm : 1;
    if(prem<0.84){                                   // clearly premature beat
      if(wide||lowCorr) types[k]='V';                // wide OR bizarre morphology → PVC
      else types[k]='S';                             // narrow + normal morphology → PAC
    } else if(wide && lowCorr && nextPause>1.18 && prem<0.97){
      types[k]='V';                                  // late/interpolated PVC
    }
  }

  // rhythm aggregation
  let nV=0,nS=0,couplets=0,longestRun=0,run=0,bigemCycles=0;
  for(let k=0;k<n;k++){
    if(types[k]==='V'){ nV++; run++; if(run>longestRun) longestRun=run;
      if(k>0&&types[k-1]==='V') couplets++; }
    else { run=0; }
    if(types[k]==='S') nS++;
    // bigeminy: N,V alternation
    if(k>=3 && types[k]==='V'&&types[k-1]==='N'&&types[k-2]==='V'&&types[k-3]==='N') bigemCycles++;
  }
  // runs ≥3 → ventricular run / NSVT flag
  let runsGE3=0, r2=0;
  for(let k=0;k<n;k++){ if(types[k]==='V'){ r2++; } else { if(r2>=3) runsGE3++; r2=0; } }
  if(r2>=3) runsGE3++;

  return {
    types, qrsW, corr, medW: +medW.toFixed(0),
    nPVC:nV, nPAC:nS,
    pvcBurden:+(nV/n*100).toFixed(2), pacBurden:+(nS/n*100).toFixed(2),
    ectopyBurden:+((nV+nS)/n*100).toFixed(2),
    couplets, longestRun, runsGE3, bigeminyCycles:bigemCycles,
    template: Array.from(tmpl), tHalf, nTemplate:nAcc
  };
}

// ════════════════════════════════════════════════════════════════════════
//  MEDIAN-BEAT TEMPLATE  (full P-QRS-T window) from high-SQI NORMAL beats
//  → used for delineation. Robust per-sample median across a subset of beats.
// ════════════════════════════════════════════════════════════════════════
function medianBeat(int16, fs, refIdx, rr, sqi, types){
  const pre=Math.round(0.32*fs), post=Math.round(0.46*fs), L=pre+post+1;
  const medRR=median(Array.from(rr).filter(v=>v>=300&&v<=2000));
  const rWin=Math.round(0.03*fs);                    // ±30 ms re-find window for raw R-peak
  // try progressively looser SQI gates so real (noisier) recordings still build a beat
  for (const sqiGate of [0.65, 0.5, 0.35, 0]){
    const cols=[]; for(let j=0;j<L;j++) cols.push([]);
    let used=0;
    const stride=Math.max(1, Math.floor(refIdx.length/700));
    for(let k=2;k<refIdx.length-2;k+=stride){
      if(sqi[k]<sqiGate||types[k]!=='N') continue;
      if(rr[k]<0.85*medRR||rr[k]>1.15*medRR) continue;
      let i=Math.round(refIdx[k]); if(i-pre<0||i+post>=int16.length) continue;
      // snap to the true raw R-peak (|max|) within ±30 ms — refIdx is on the band-passed signal
      let bi=i, bv=Math.abs(int16[i]);
      for(let j=Math.max(0,i-rWin);j<=Math.min(int16.length-1,i+rWin);j++){ const a=Math.abs(int16[j]); if(a>bv){bv=a;bi=j;} }
      i=bi; if(i-pre<0||i+post>=int16.length) continue;
      const b=median([int16[i-pre],int16[i-pre+1],int16[i-pre+2],int16[i-pre+3]]);
      for(let j=0;j<L;j++) cols[j].push(int16[i-pre+j]-b);
      used++;
    }
    if(used>=8){
      const beat=new Float64Array(L);
      for(let j=0;j<L;j++) beat[j]=cols[j].length?median(cols[j]):0;
      // validity: R peak must actually stand out from baseline
      const B=mean(Array.from(beat).slice(0,Math.round(0.05*fs)));
      const Ramp=Math.abs(beat[pre]-B);
      if(Ramp>=80) return { beat:Array.from(beat), pre, post, L, fs, nUsed:used, medRR:+medRR.toFixed(0), valid:true };
    }
  }
  return { beat:null, pre, post, L, fs, nUsed:0, medRR:+medRR.toFixed(0), valid:false };
}

// ─── median beat restricted to a SUBSET of beat indices (for the QTc trend) ───
function medianBeatFrom(int16, fs, refIdx, rr, sqi, types, kList){
  const pre=Math.round(0.32*fs), post=Math.round(0.46*fs), L=pre+post+1;
  const medRR=median(kList.map(k=>rr[k]).filter(v=>v>=300&&v<=2000));
  const rWin=Math.round(0.03*fs);
  for (const sqiGate of [0.6, 0.45, 0.3, 0]){
    const cols=[]; for(let j=0;j<L;j++) cols.push([]);
    let used=0;
    const stride=Math.max(1, Math.floor(kList.length/300));
    for(let kk=0;kk<kList.length;kk+=stride){
      const k=kList[kk];
      if(sqi[k]<sqiGate||types[k]!=='N') continue;
      if(rr[k]<0.85*medRR||rr[k]>1.15*medRR) continue;
      let i=Math.round(refIdx[k]); if(i-pre<0||i+post>=int16.length) continue;
      let bi=i,bv=Math.abs(int16[i]);
      for(let j=Math.max(0,i-rWin);j<=Math.min(int16.length-1,i+rWin);j++){ const a=Math.abs(int16[j]); if(a>bv){bv=a;bi=j;} }
      i=bi; if(i-pre<0||i+post>=int16.length) continue;
      const b=median([int16[i-pre],int16[i-pre+1],int16[i-pre+2],int16[i-pre+3]]);
      for(let j=0;j<L;j++) cols[j].push(int16[i-pre+j]-b);
      used++;
    }
    if(used>=8){
      const beat=new Float64Array(L);
      for(let j=0;j<L;j++) beat[j]=cols[j].length?median(cols[j]):0;
      const B=mean(Array.from(beat).slice(0,Math.round(0.05*fs)));
      const Ramp=Math.abs(beat[pre]-B);
      if(Ramp>=80) return { beat:Array.from(beat), pre, post, L, fs, nUsed:used, medRR:+medRR.toFixed(0), valid:true };
    }
  }
  return { beat:null, pre, post, L, fs, nUsed:0, medRR:+medRR.toFixed(0), valid:false };
}

// ════════════════════════════════════════════════════════════════════════
//  NOCTURNAL QTc TREND  — windowed median-beat delineation across the record.
//  Per ~15-min window: build a median beat from that window's clean normal beats,
//  delineate → QTc. The cross-node feed GlucoDex lines up against overnight glucose
//  (rising QTc as glucose falls = the beat-level hypoglycemia⟷repolarisation link).
//  Tier 3 — within-subject TREND, single lead ≠ 12-lead.
// ════════════════════════════════════════════════════════════════════════
function qtcTrend(int16, fs, refIdx, rr, sqi, types, winMin, medW){
  winMin = winMin || 15;
  const n = refIdx.length; if(n < 60) return null;
  const tSec = k => refIdx[k]/fs;
  const t0 = tSec(0), tN = tSec(n-1), span = tN - t0;
  if(span < winMin*60*1.5) return null;                 // need ≥~1.5 windows to be a trend
  const winSec = winMin*60, out = [];
  let k0 = 0;
  for(let w0=t0; w0<tN; w0+=winSec){
    const w1 = w0 + winSec;
    while(k0<n && tSec(k0) < w0) k0++;
    const idxs = [];
    for(let k=k0; k<n && tSec(k) < w1; k++) idxs.push(k);
    if(idxs.length >= 40){
      const mb = medianBeatFrom(int16, fs, refIdx, rr, sqi, types, idxs);
      if(medW!=null) mb.medW = medW;
      const d = delineate(mb);
      if(d.valid && d.qtcBazett != null){
        out.push({ tMin:+(w0/60).toFixed(1), qtc:d.qtcBazett, qtcFridericia:d.qtcFrid, qt:d.qt, qrsDur:d.qrsDur, qrsSaturated:!!d.qrsSaturated, nBeats:mb.nUsed });
      }
    }
  }
  if(out.length < 2) return null;
  // Delineation-stability guard: a per-window QTc that jumps far from the robust
  // trend median is a T-end / QRS-saturation delineation artifact (lead-vector flip),
  // NOT a physiological repolarisation change — flag it so a spurious "QTc cliff"
  // isn't read as a hypoglycemia signal. Values are kept; windows are only annotated.
  if(out.length >= 3){
    const _qs = out.map(w=>w.qtc).slice().sort((a,b)=>a-b);
    const _med = _qs[_qs.length>>1];
    for(const w of out) w.unstable = Math.abs(w.qtc - _med) > 60;
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════
//  T-WAVE ALTERNANS  (MMA — Modified Moving Average, Nearing/Verrier)
//  Beat-to-beat ABAB alternation of the ST-T complex amplitude (µV). Two running
//  averaged templates (odd / even beats) updated with a capped step; TWA = max
//  |odd − even| across the ST-T window. ≥47 µV = abnormal (MTWA marker of
//  electrical instability). RR-matched normal beats only. Single lead, screen.
// ════════════════════════════════════════════════════════════════════════
function tWaveAlternans(int16, fs, refIdx, rr, sqi, types){
  const n = refIdx.length; if(n < 60) return null;
  const pre = Math.round(0.03*fs);
  const js = Math.round(0.08*fs), je = Math.round(0.40*fs), L = je - js;   // ST-T window after R
  if(L < 4) return null;
  const medRR = median(Array.from(rr).filter(v=>v>=300&&v<=2000));
  let A=null, B=null, parity=0, used=0;
  const CAP = 32;                                        // µV step cap (classic MMA)
  for(let k=2; k<n-2; k++){
    if(sqi[k] < 0.6 || types[k] !== 'N') continue;
    if(rr[k] < 0.85*medRR || rr[k] > 1.15*medRR) continue;     // exclude RR-driven T changes
    const i = Math.round(refIdx[k]);
    if(i+je >= int16.length || i-pre < 0) continue;
    const base = median([int16[i-pre], int16[i-pre+1], int16[i-pre+2]]);
    const vec = new Float64Array(L);
    for(let j=0;j<L;j++) vec[j] = int16[i+js+j] - base;
    if(!A){ A=vec.slice(0); B=vec.slice(0); parity^=1; used++; continue; }
    const cur = parity ? A : B;
    for(let j=0;j<L;j++){ let d=vec[j]-cur[j]; if(d>CAP)d=CAP; else if(d<-CAP)d=-CAP; cur[j]+=d/8; }
    parity ^= 1; used++;
  }
  if(used < 40 || !A) return null;
  let twa=0; for(let j=0;j<L;j++){ const d=Math.abs(A[j]-B[j]); if(d>twa) twa=d; }
  return { uv:+twa.toFixed(0), nBeats:used, abnormal: twa>=47, method:'MMA (modified moving average, ST-T window)' };
}
function delineate(mb){
  if(!mb || !mb.valid || !mb.beat){
    return { valid:false, baseline:null, qrsDur:null, qrsSaturated:false, qt:null, qtcBazett:null, qtcFrid:null,
             pr:null, st:null, Ramp:null, Tamp:null, Pamp:null, pPresent:false, marks:null };
  }
  const { beat, pre, fs } = mb;
  const ms = s => s/fs*1000;
  const R = pre;
  const B = mean(beat.slice(0, Math.round(0.05*fs)));          // baseline (early window)
  const Ramp = beat[R]-B;
  const qrsPk = Math.abs(Ramp);
  const thr = 0.08*qrsPk;

  // QRS onset/offset via RETURN-TO-BASELINE (not "outermost departure in a fixed
  // window"). The old ±60 ms (8-sample) window pegged every wide-ish beat at its
  // boundary → 16 samples = 123 ms @130 Hz (a hard ceiling). Search ±120 ms so a
  // genuinely wide QRS (to ~180 ms) is measurable, and stop at the sustained return
  // to baseline so the wider window doesn't bleed into the P-wave / ST-T.
  const qWin=Math.round(0.12*fs);
  const SUS=2;                                  // consecutive baseline samples confirm a return
  var Qon=Math.max(1,R-qWin), qHit=false;
  { var run=0; for(var i=R-1; i>=Math.max(1,R-qWin); i--){
      if(Math.abs(beat[i]-B)<=thr){ if(++run>=SUS){ Qon=Math.min(R, i+SUS); qHit=true; break; } } else run=0; } }
  var Joff=Math.min(beat.length-2,R+qWin), jHit=false;
  { var run2=0; for(var i2=R+1; i2<=Math.min(beat.length-2,R+qWin); i2++){
      if(Math.abs(beat[i2]-B)<=thr){ if(++run2>=SUS){ Joff=Math.max(R, i2-SUS); jHit=true; break; } } else run2=0; } }
  const qrsSaturated = !qHit || !jHit;          // boundary reached without a clean baseline return
  // The raw return-to-baseline search is reliable on clean synthetic beats but on
  // real median beats the ST segment often never drops within `thr` of baseline
  // inside the window → the offset saturates at the edge, over-stating QRS AND
  // pushing the J-point (hence the T-search/QT) late. When that happens — or when
  // the delineated width wildly disagrees with the validated energy-median `medW`
  // — anchor Q/J to medW (QRS ≈40% before R, 60% after) so QRS, the J-point, and
  // the downstream QT all stay physiological. medW is the cross-checked truth.
  var medW = (mb.medW!=null && isFinite(mb.medW)) ? mb.medW : null;
  var Qon0=Qon, Joff0=Joff;
  if(medW && (qrsSaturated || Math.abs(ms(Joff-Qon)-medW) > 30)){
    Qon  = Math.max(1, R - Math.round((medW*0.40)/1000*fs));
    Joff = Math.min(beat.length-2, R + Math.round((medW*0.60)/1000*fs));
  }
  const qrsDur = ms(Joff-Qon);
  if(qrsDur < 20 || qrsDur > 220){            // degenerate (flat) or implausible → withhold all intervals
    return { valid:false, baseline:+B.toFixed(0), qrsDur:null, qrsSaturated:qrsSaturated, qt:null, qtcBazett:null, qtcFrid:null,
             pr:null, st:null, Ramp:+Ramp.toFixed(0), Tamp:null, Pamp:null, pPresent:false, marks:null };
  }

  // T-wave — search [J+40ms, J+400ms]; peak = max |dev|
  const ts=Math.min(beat.length-2, Joff+Math.round(0.04*fs)), te=Math.min(beat.length-2, Joff+Math.round(0.40*fs));
  let Tpk=ts, Tdev=0; for(let i=ts;i<=te;i++){ const d=Math.abs(beat[i]-B); if(d>Tdev){ Tdev=d; Tpk=i; } }
  const Tamp = beat[Tpk]-B;
  // T-end via tangent method: steepest slope after Tpk, extrapolate to baseline
  let Tend=Tpk, steep=0, steepAt=Tpk;
  for(let i=Tpk;i<Math.min(beat.length-2,Tpk+Math.round(0.20*fs));i++){ const sl=beat[i+1]-beat[i]; if(Math.sign(sl)!==Math.sign(Tamp)&&Math.abs(sl)>Math.abs(steep)){ steep=sl; steepAt=i; } }
  if(steep!==0){ const t=steepAt+(B-beat[steepAt])/steep; Tend=Math.max(Tpk, Math.min(beat.length-1, t)); }
  const qt = ms(Tend-Qon);
  const rrS = mb.medRR/1000;
  const qtcB = rrS>0 ? qt/Math.sqrt(rrS) : null;          // Bazett
  const qtcF = rrS>0 ? qt/Math.cbrt(rrS) : null;          // Fridericia

  // P-wave — search [R-280ms, R-70ms]; peak = max |dev|
  const ps=Math.max(1, R-Math.round(0.28*fs)), pe=Math.max(2, R-Math.round(0.07*fs));
  let Ppk=ps, Pdev=0; for(let i=ps;i<=pe;i++){ const d=Math.abs(beat[i]-B); if(d>Pdev){ Pdev=d; Ppk=i; } }
  const Pamp = beat[Ppk]-B;
  // P onset — walk left from Ppk to baseline
  let Pon=Ppk; for(let i=Ppk;i>ps;i--){ if(Math.abs(beat[i]-B)<0.25*Math.abs(Pamp)){ Pon=i; break; } Pon=i; }
  const pr = ms(Qon-Pon);
  const pPresent = Math.abs(Pamp) > 18 && Math.abs(Pamp) > 0.04*qrsPk;   // P detectable?

  // ST level at J+60 ms (µV vs baseline)
  const stI=Math.min(beat.length-1, Joff+Math.round(0.06*fs));
  const st = beat[stI]-B;

  return {
    valid:true,
    baseline:+B.toFixed(0),
    qrsDur:+qrsDur.toFixed(0), qrsSaturated:qrsSaturated, qt:+qt.toFixed(0),
    qtcBazett: qtcB==null?null:+qtcB.toFixed(0), qtcFrid: qtcF==null?null:+qtcF.toFixed(0),
    pr: pPresent? +pr.toFixed(0) : null,
    st:+st.toFixed(0), Ramp:+Ramp.toFixed(0), Tamp:+Tamp.toFixed(0), Pamp:+Pamp.toFixed(0),
    pPresent,
    marks:{ Pon, Ppk, Qon, R, Joff, Tpk, Tend, B },
  };
}

// ════════════════════════════════════════════════════════════════════════
//  AF SCREEN — RR-irregularity. Shannon entropy of ΔRR distribution + CV of RR
//  over rolling 30-beat windows (normal beats). SCREEN ONLY (P-wave weak @130 Hz).
// ════════════════════════════════════════════════════════════════════════
function afScreen(rr, sqi, types){
  // use windows of 30 beats; flag windows that are irregularly irregular but NOT just ectopy
  const W=32, n=rr.length; if(n<W+2) return { suspiciousPct:0, irregIndex:0, verdict:'insufficient', shannon:0 };
  let flagged=0, total=0, shAcc=0, cvAcc=0;
  for(let s=0;s+W<=n;s+=W){
    const seg=[],ect=[]; for(let j=s;j<s+W;j++){ if(sqi[j]>=0.4&&rr[j]>=300&&rr[j]<=2000){ seg.push(rr[j]); ect.push(types[j]); } }
    if(seg.length<20) continue;
    total++;
    const m=mean(seg), sd=std(seg), cv=sd/m;
    // Shannon entropy of ΔRR binned at 25 ms (normalized 0..1; AF → high)
    const bins={}; for(let i=1;i<seg.length;i++){ const b=Math.round((seg[i]-seg[i-1])/25); bins[b]=(bins[b]||0)+1; }
    const tot=seg.length-1; let H=0; Object.values(bins).forEach(c=>{ const p=c/tot; H-=p*Math.log(p); });
    const Hn=H/Math.log(tot);
    // ectopy fraction — high ectopy can mimic irregularity; discount it
    const ectFrac=ect.filter(t=>t!=='N').length/ect.length;
    shAcc+=Hn; cvAcc+=cv;
    // AF-suspicious: high CV AND high entropy AND not explained by sparse ectopy
    if(cv>0.13 && Hn>0.72 && ectFrac<0.25) flagged++;
  }
  const suspiciousPct=total?+(flagged/total*100).toFixed(1):0;
  const shannon=total?+(shAcc/total).toFixed(3):0;
  const irregIndex=total?+(cvAcc/total).toFixed(3):0;
  let verdict;
  if(suspiciousPct>=30) verdict='possible-af';
  else if(suspiciousPct>=8) verdict='occasional-irregular';
  else verdict='no-af';
  return { suspiciousPct, irregIndex, shannon, verdict };
}

// ════════════════════════════════════════════════════════════════════════
//  ORCHESTRATOR
// ════════════════════════════════════════════════════════════════════════
function analyze(int16, bp, fs, refIdx, rr, sqi){
  const rrArr = Array.isArray(rr)?rr:Array.from(rr);
  const cls = classifyBeats(int16, bp, fs, refIdx, rrArr, sqi);
  const mb  = medianBeat(int16, fs, refIdx, rrArr, sqi, cls.types);
  mb.medW = cls.medW;                              // validated energy-median QRS width → delineate anchor
  const del = delineate(mb);
  const af  = afScreen(rrArr, sqi, cls.types);
  let qtcTr=null, twa=null;
  try { qtcTr = qtcTrend(int16, fs, refIdx, rrArr, sqi, cls.types, 15, cls.medW); } catch(e){ qtcTr=null; }
  try { twa = tWaveAlternans(int16, fs, refIdx, rrArr, sqi, cls.types); } catch(e){ twa=null; }
  return { ...cls, medianBeat:mb, delin:del, af, qtcTrend:qtcTr, twa };
}

global.ECGMorph = { analyze, classifyBeats, medianBeat, medianBeatFrom, delineate, afScreen, qtcTrend, tWaveAlternans };

})(window);
