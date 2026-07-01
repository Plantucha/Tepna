/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   PpgDex · DSP  (ppgdex-dsp.js)
   ────────────────────────────────────────────────────────────────────────
   Raw wrist-PPG → systolic feet/peaks → PP intervals (self-PPI) → HRV.
   PpgDex is ECGDex's optical twin: once the waveform becomes a beat-to-beat
   interval series, the downstream HRV is identical. NEW here vs ECGDex:
     · optical beat detection (soft upstroke — Pan-Tompkins does NOT apply)
     · ACC+GYRO motion gate (the signature feature)
     · pulse-wave morphology (see ppgdex-morph.js)
   Exposes window.PPGDSP. parseTimestamp duplicated locally (Clock Contract).
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';

// ════════════════════════════════════════════════════════════════════════
//  CLOCK CONTRACT — floating wall-clock parseTimestamp (mirror of ECGDex)
// ════════════════════════════════════════════════════════════════════════
function tzOffset(instantMs){ return new Date(instantMs).getTimezoneOffset()*60000; }
function parseTimestamp(raw, opts){
  opts = opts || {};
  if(raw==null) return null;
  const s = String(raw).trim().replace(/^["']|["']$/g,'');
  if(!s) return null; let m;
  // 1 — numeric epoch
  if(/^\d{10,13}$/.test(s)){ let x=parseInt(s,10); if(x<1e11)x*=1000; if(x<1e11||x>4e12) return null;
    return { tMs: x - tzOffset(x), offsetMin: -tzOffset(x)/60000 }; }
  // 2/3 — ISO-8601 (zone authoritative if present, else components verbatim)
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/);
  if(m){
    const ms = m[7] ? Math.round(parseFloat('0.'+m[7])*1000) : 0;
    const tMs = Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],m[6]?+m[6]:0,ms);
    let offsetMin = null;
    if(m[8]){ if(m[8]==='Z') offsetMin=0; else { const z=m[8].replace(':',''); offsetMin=(z[0]==='-'?-1:1)*(parseInt(z.slice(1,3),10)*60+parseInt(z.slice(3,5),10)); } }
    return { tMs, offsetMin };
  }
  return null;
}

// ── small numeric helpers (duplicated locally, suite convention) ──
function mean(a){ if(!a.length) return NaN; let s=0; for(let i=0;i<a.length;i++) s+=a[i]; return s/a.length; }
function std(a){ if(a.length<2) return 0; const m=mean(a); let s=0; for(let i=0;i<a.length;i++){ const d=a[i]-m; s+=d*d; } return Math.sqrt(s/(a.length-1)); }
function median(a){ if(!a.length) return NaN; const b=a.slice().sort((x,y)=>x-y); const h=b.length>>1; return b.length%2?b[h]:(b[h-1]+b[h])/2; }
function quantile(a,q){ if(!a.length) return NaN; const b=a.slice().sort((x,y)=>x-y); const p=(b.length-1)*q, lo=Math.floor(p), hi=Math.ceil(p); return lo===hi?b[lo]:b[lo]+(b[hi]-b[lo])*(p-lo); }
function r2(v){ return Math.round(v*100)/100; }
function r1(v){ return Math.round(v*10)/10; }

// ════════════════════════════════════════════════════════════════════════
//  BIQUAD filtering (RBJ cookbook) + zero-phase filtfilt
// ════════════════════════════════════════════════════════════════════════
function biquad(type, f0, fs, Q){
  const w0 = 2*Math.PI*f0/fs, c = Math.cos(w0), s = Math.sin(w0), alpha = s/(2*Q);
  let b0,b1,b2,a0,a1,a2;
  if(type==='lp'){ b0=(1-c)/2; b1=1-c; b2=(1-c)/2; a0=1+alpha; a1=-2*c; a2=1-alpha; }
  else { b0=(1+c)/2; b1=-(1+c); b2=(1+c)/2; a0=1+alpha; a1=-2*c; a2=1-alpha; } // hp
  return { b0:b0/a0, b1:b1/a0, b2:b2/a0, a1:a1/a0, a2:a2/a0 };
}
function applyBiquad(x, c){
  const y = new Float32Array(x.length);
  let x1=0,x2=0,y1=0,y2=0;
  for(let i=0;i<x.length;i++){
    const xn=x[i];
    const yn=c.b0*xn + c.b1*x1 + c.b2*x2 - c.a1*y1 - c.a2*y2;
    x2=x1; x1=xn; y2=y1; y1=yn; y[i]=yn;
  }
  return y;
}
function reverse(x){ const y=new Float32Array(x.length); for(let i=0;i<x.length;i++) y[i]=x[x.length-1-i]; return y; }
function filtfilt(x, c){ return reverse(applyBiquad(reverse(applyBiquad(x,c)),c)); }
function bandpass(x, fs, lo, hi){
  let y = filtfilt(x, biquad('hp', lo, fs, 0.707));
  y = filtfilt(y, biquad('lp', hi, fs, 0.707));
  return y;
}

// ════════════════════════════════════════════════════════════════════════
//  PARSE  — Polar Sense *_PPG.txt
//  Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient
// ════════════════════════════════════════════════════════════════════════
function parsePPG(text){
  const lines = text.split(/\r?\n/);
  const ch0=[], ch1=[], ch2=[], amb=[];
  const nsArr=[];           // BigInt deltas avoided — store as Number of (ns - ns0)/1 via BigInt math
  let ns0=null, t0Ms=null, firstTs=null, lastTs=null;
  let started=false;
  for(let li=0; li<lines.length; li++){
    const line = lines[li].trim();
    if(!line) continue;
    const p = line.split(';');
    if(p.length < 6) continue;
    const v0=parseFloat(p[2]);
    if(!isFinite(v0)){ continue; }      // header / junk
    ch0.push(v0);
    ch1.push(parseFloat(p[3]));
    ch2.push(parseFloat(p[4]));
    amb.push(parseFloat(p[5]));
    // sensor ns → relative seconds (BigInt: values exceed Number safe range)
    let relNs = 0;
    try { const b=BigInt(p[1].trim()); if(ns0===null) ns0=b; relNs=Number(b-ns0); } catch(e){ relNs = NaN; }
    nsArr.push(relNs);
    const ts = parseTimestamp(p[0]);
    if(ts){ if(t0Ms===null){ t0Ms=ts.tMs; firstTs=ts; } lastTs=ts; }
    started=true;
  }
  const n = ch0.length;
  if(n < 10) throw new Error('No PPG samples parsed — expected Polar Sense `*_PPG.txt` (Phone timestamp;sensor ns;ch0;ch1;ch2;ambient).');
  // fs from median ns delta (precise) — fall back to phone-clock span
  let fs = 176;
  const deltas = [];
  for(let i=1;i<n;i++){ const d=nsArr[i]-nsArr[i-1]; if(isFinite(d)&&d>0) deltas.push(d); }
  if(deltas.length>20){ const md = median(deltas); if(md>0) fs = 1e9/md; }
  else if(firstTs && lastTs && lastTs.tMs>firstTs.tMs){ fs = (n-1)/((lastTs.tMs-firstTs.tMs)/1000); }
  fs = Math.round(fs*100)/100;
  // relSec per sample from ns (most accurate), else index/fs
  const relSec = new Float64Array(n);
  if(deltas.length>20){ for(let i=0;i<n;i++) relSec[i] = isFinite(nsArr[i]) ? nsArr[i]/1e9 : i/fs; }
  else { for(let i=0;i<n;i++) relSec[i]=i/fs; }
  return { ch:[Float32Array.from(ch0),Float32Array.from(ch1),Float32Array.from(ch2)], amb:Float32Array.from(amb),
           relSec, fs, n, t0Ms:(t0Ms!=null?t0Ms:null), offsetMin:firstTs?firstTs.offsetMin:null,
           durSec:(n-1)/fs };
}

// ════════════════════════════════════════════════════════════════════════
//  CHANNEL SELECTION — best-SNR green channel
//  pulsatility = power in 0.7–3 Hz band ÷ power in 4–8 Hz band (after BP)
// ════════════════════════════════════════════════════════════════════════
function channelSNR(sig, fs){
  const pulse = bandpass(sig, fs, 0.7, 3.0);
  const noise = bandpass(sig, fs, 4.0, 8.0);
  const ps = std(pulse), ns = std(noise) || 1e-6;
  return { snr: ps/ns, amp: ps };
}
function pickChannel(rec){
  let best=0, bestScore=-Infinity, scores=[];
  for(let c=0;c<rec.ch.length;c++){
    const s = channelSNR(rec.ch[c], rec.fs);
    scores.push(s);
    if(s.snr > bestScore){ bestScore=s.snr; best=c; }
  }
  return { idx:best, scores };
}

// ── orientation: systolic upstroke should be the steep, sharp deflection ──
function orient(bp){
  // PPG upstroke (systole→peak) is steeper than the diastolic decay.
  // skewness of the derivative is positive when peaks point "up" correctly.
  const d=new Float32Array(bp.length);
  for(let i=1;i<bp.length;i++) d[i]=bp[i]-bp[i-1];
  let s=0,n=0; const m=mean(d), sd=std(d)||1e-9;
  for(let i=1;i<d.length;i++){ const z=(d[i]-m)/sd; s+=z*z*z; n++; }
  const skew=s/n;
  // positive derivative-skew → sharp rises dominate → peaks already "up"
  return skew>=0 ? 1 : -1;
}

// ════════════════════════════════════════════════════════════════════════
//  OPTICAL BEAT DETECTION  → systolic peaks + intersecting-tangent feet
// ════════════════════════════════════════════════════════════════════════
function detectBeats(bp, fs){
  const n=bp.length;
  // dominant pulse interval via autocorrelation (36–200 bpm → lag 0.3–1.66 s)
  const loLag=Math.round(fs*0.33), hiLag=Math.round(fs*1.66);
  let bestLag=Math.round(fs*0.85), bestR=-Infinity;
  const m=mean(bp);
  for(let lag=loLag; lag<=hiLag && lag<n; lag++){
    let s=0; for(let i=0;i<n-lag;i++) s+=(bp[i]-m)*(bp[i+lag]-m);
    if(s>bestR){ bestR=s; bestLag=lag; }
  }
  const T=bestLag;                      // expected samples between beats
  const refr=Math.max(Math.round(fs*0.30), Math.round(T*0.5));
  // adaptive systolic-peak detection on a smoothed upslope energy
  const d=new Float32Array(n);
  for(let i=1;i<n;i++){ const dv=bp[i]-bp[i-1]; d[i]=dv>0?dv*dv:0; }  // positive-slope energy
  const win=Math.max(3,Math.round(fs*0.10));
  const e=movavg(d,win);
  // dynamic threshold = running fraction of local max
  const peaks=[];
  let i=1;
  const segLen=Math.round(T*1.2);
  while(i<n-1){
    // local search window
    const j0=i, j1=Math.min(n-1,i+segLen);
    let pk=-1, pv=-Infinity;
    for(let j=j0;j<j1;j++){ if(e[j]>pv){ pv=e[j]; pk=j; } }
    // threshold relative to robust scale
    const thr = 0.30*localMax(e, Math.max(0,pk-segLen), Math.min(n,pk+segLen));
    if(pv>thr && pk>0){
      // refine to the true signal maximum (systolic peak) just after the upslope energy peak
      let sp=pk, sv=bp[pk];
      for(let j=pk; j<Math.min(n,pk+Math.round(fs*0.15)); j++){ if(bp[j]>sv){ sv=bp[j]; sp=j; } }
      if(peaks.length===0 || sp-peaks[peaks.length-1]>=refr) peaks.push(sp);
      else if(bp[sp]>bp[peaks[peaks.length-1]]) peaks[peaks.length-1]=sp;
      i = sp+refr;
    } else i = j1;
  }
  // feet via intersecting-tangent (per peak)
  const feet=[];
  for(let k=0;k<peaks.length;k++){
    const p=peaks[k];
    const lo=k>0?peaks[k-1]:Math.max(0,p-T);
    // diastolic min between previous peak and this peak
    let mi=p, mv=bp[p];
    for(let j=p; j>lo; j--){ if(bp[j]<mv){ mv=bp[j]; mi=j; } }
    // max upslope point between min and peak
    let ms=mi, msv=-Infinity;
    for(let j=mi; j<p; j++){ const dv=bp[j+1]-bp[j]; if(dv>msv){ msv=dv; ms=j; } }
    // intersecting tangent: foot = where tangent at ms crosses baseline (y=mv)
    let foot=mi;
    if(msv>1e-9){ const cross = ms - (bp[ms]-mv)/msv; foot = Math.max(lo, Math.min(p, cross)); }
    feet.push(foot);
  }
  return { peaks, feet, T };
}
function movavg(x, w){ const y=new Float32Array(x.length); let s=0; for(let i=0;i<x.length;i++){ s+=x[i]; if(i>=w)s-=x[i-w]; y[i]=s/Math.min(i+1,w); } return y; }
function localMax(a,i0,i1){ let m=-Infinity; for(let i=i0;i<i1;i++) if(a[i]>m)m=a[i]; return m; }

// ════════════════════════════════════════════════════════════════════════
//  PER-BEAT SQI  — template correlation × amplitude × motion gate
// ════════════════════════════════════════════════════════════════════════
function beatSQI(bp, peaks, fs, motionAt){
  const n=peaks.length; if(!n) return [];
  const pre=Math.round(fs*0.20), post=Math.round(fs*0.45), L=pre+post;
  // build amplitude-normalised beats around peaks
  const beats=[];
  for(let k=0;k<n;k++){ const p=peaks[k]; const seg=new Float32Array(L); let ok=true;
    for(let j=0;j<L;j++){ const idx=p-pre+j; if(idx<0||idx>=bp.length){ ok=false; break; } seg[j]=bp[idx]; }
    beats.push(ok?seg:null);
  }
  // template = median across valid beats (normalised)
  const norm=b=>{ if(!b) return null; const mn=Math.min.apply(null,b), mx=Math.max.apply(null,b); const r=(mx-mn)||1; const o=new Float32Array(b.length); for(let j=0;j<b.length;j++)o[j]=(b[j]-mn)/r; return o; };
  const nb=beats.map(norm).filter(Boolean);
  const tmpl=new Float32Array(L);
  if(nb.length){ for(let j=0;j<L;j++){ const col=[]; for(const b of nb) col.push(b[j]); tmpl[j]=median(col); } }
  const sqi=[];
  for(let k=0;k<n;k++){
    const b=norm(beats[k]);
    let corr=0;
    if(b){ corr=pearson(b,tmpl); }
    const mot = motionAt ? motionAt(peaks[k]) : 0;   // 0..1 motion index at beat
    const motFactor = 1 - Math.min(1, mot);          // high motion → low conf
    let q = Math.max(0, corr) * (0.4 + 0.6*motFactor);
    sqi.push(Math.max(0, Math.min(1, q)));
  }
  return sqi;
}
function pearson(a,b){ const n=Math.min(a.length,b.length); const ma=mean(a),mb=mean(b); let sa=0,sb=0,sab=0;
  for(let i=0;i<n;i++){ const da=a[i]-ma, db=b[i]-mb; sa+=da*da; sb+=db*db; sab+=da*db; }
  const den=Math.sqrt(sa*sb)||1e-9; return sab/den; }

// ════════════════════════════════════════════════════════════════════════
//  PPI + correction (Malik-style) and HRV suite
// ════════════════════════════════════════════════════════════════════════
function buildPPI(footSec){
  const rr=[], tt=[];
  for(let i=1;i<footSec.length;i++){ const d=(footSec[i]-footSec[i-1])*1000; rr.push(d); tt.push(footSec[i]); }
  return { rr, tt };
}
function correctRR(rr, tt){
  // reject physiologically impossible + local-median outliers; interpolate.
  // Gate against a robust running median of ACCEPTED intervals (not the
  // immediately-previous value, which can itself be a false detection and
  // cascade the whole series to a constant).
  const out=[], ot=[], flags=[]; let nCorr=0;
  // robust global baseline from in-range intervals
  const inRange=rr.filter(v=>v>=300&&v<=2000);
  const globalMed = inRange.length? median(inRange) : 800;
  const accepted=[];                       // recent accepted intervals (window)
  const localRef=()=> accepted.length? median(accepted.slice(-7)) : globalMed;
  // PPI artifact threshold, deliberately looser than the 0.20 Malik rule ECGDex/
  // PulseDex apply to ECG/RR: optical pulse-arrival-time jitter is larger than
  // R-peak jitter, so 0.20 would over-reject clean PPG beats. Per-signal by
  // design (WP-D audit / DEX-DSP-AUDIT-BEATS-ARTIFACT.md), not accidental drift.
  const PPI_ECTOPY_THR = 0.30;
  for(let i=0;i<rr.length;i++){
    let v=rr[i]; const ref=localRef(); let bad=false;
    if(v<300||v>2000) bad=true;
    else if(Math.abs(v-ref)/ref>PPI_ECTOPY_THR) bad=true;   // >30% off the local median
    if(bad){ v=ref; nCorr++; flags.push(1); }
    else { accepted.push(v); flags.push(0); }
    out.push(v); ot.push(tt[i]);
  }
  return { nn:out, tt:ot, nCorr, flags };
}
function timeDomain(nn){
  if(nn.length<2) return null;
  const meanRR=mean(nn), sdnn=std(nn);
  let sumSq=0,cnt=0,nn50=0;
  for(let i=1;i<nn.length;i++){ const d=nn[i]-nn[i-1]; sumSq+=d*d; cnt++; if(Math.abs(d)>50)nn50++; }
  const rmssd=Math.sqrt(sumSq/cnt), pnn50=100*nn50/cnt;
  const hr=60000/meanRR;
  // triangular index
  const bins={}; for(const v of nn){ const b=Math.round(v/7.8125); bins[b]=(bins[b]||0)+1; }
  let mx=0; for(const k in bins) if(bins[k]>mx)mx=bins[k];
  const triIdx = mx? nn.length/mx : null;
  return { meanRR:Math.round(meanRR), sdnn:r1(sdnn), rmssd:r1(rmssd), pnn50:r1(pnn50), hr:Math.round(hr), lnRMSSD:r2(Math.log(rmssd)), triIdx:triIdx?r1(triIdx):null };
}
function poincare(nn){
  if(nn.length<3) return null;
  const d=[]; for(let i=1;i<nn.length;i++) d.push(nn[i]-nn[i-1]);
  const sd1=Math.sqrt(0.5)*std(d);
  const sdnn=std(nn);
  const sd2=Math.sqrt(Math.max(0,2*sdnn*sdnn-0.5*std(d)*std(d)));
  return { sd1:r1(sd1), sd2:r1(sd2), sd1sd2:r2(sd1/(sd2||1)), ellArea:Math.round(Math.PI*sd1*sd2) };
}
// Lomb–Scargle on irregular RR for frequency-domain HRV
function lombScargle(tt, nn){
  if(nn.length<8) return null;
  const t=tt.map(x=>x); const y=nn.slice();
  // Linear detrend (Task Force) — parity with ECGDex/PulseDex; stops slow drift
  // leaking into VLF/LF. Was mean-only before 2026-06-21 (external-review WP-C).
  const N=y.length; let st=0,sy=0,stt=0,sty=0;
  for(let i=0;i<N;i++){ st+=t[i]; sy+=y[i]; stt+=t[i]*t[i]; sty+=t[i]*y[i]; }
  const den=N*stt-st*st||1e-9; const slope=(N*sty-st*sy)/den, icpt=(sy-slope*st)/N;
  for(let i=0;i<N;i++) y[i]-=(slope*t[i]+icpt);
  const bands={ vlf:[0.003,0.04], lf:[0.04,0.15], hf:[0.15,0.40] };
  const fmin=0.003, fmax=0.40, df=0.002;
  let vlf=0, lf=0, hf=0;
  for(let f=fmin; f<=fmax; f+=df){
    const w=2*Math.PI*f; let ss=0,sc=0;
    for(let i=0;i<t.length;i++){ ss+=Math.sin(2*w*t[i]); sc+=Math.cos(2*w*t[i]); }
    const tau=Math.atan2(ss,sc)/(2*w);
    let c1=0,c2=0,s1=0,s2=0;
    for(let i=0;i<t.length;i++){ const wt=w*(t[i]-tau); const co=Math.cos(wt), si=Math.sin(wt); c1+=y[i]*co; c2+=co*co; s1+=y[i]*si; s2+=si*si; }
    const P=0.5*((c1*c1)/(c2||1e-9)+(s1*s1)/(s2||1e-9));
    const pw=P*df;
    if(f>=bands.vlf[0]&&f<bands.vlf[1]) vlf+=pw;
    else if(f>=bands.lf[0]&&f<bands.lf[1]) lf+=pw;
    else if(f>=bands.hf[0]&&f<bands.hf[1]) hf+=pw;
  }
  let total=vlf+lf+hf;
  // Parseval calibration — ∫PSD = signal variance, so band powers land in ms²
  // and are comparable to ECGDex/PulseDex (external-review WP-C). Ratios
  // (lfhf/lfnu/hfnu) are scale-invariant, so they are unchanged by this.
  let variance=0; for(let i=0;i<N;i++) variance+=y[i]*y[i]; variance/=N;
  const scF = total>0 ? variance/total : 1;
  vlf*=scF; lf*=scF; hf*=scF; total*=scF;
  const lfhf=hf>0?lf/hf:null;
  const lfnu=(lf+hf)>0?100*lf/(lf+hf):null, hfnu=(lf+hf)>0?100*hf/(lf+hf):null;
  return { vlf:Math.round(vlf), lf:Math.round(lf), hf:Math.round(hf), totalPower:Math.round(total),
           lfhf:lfhf!=null?r2(lfhf):null, lfnu:lfnu!=null?Math.round(lfnu):null, hfnu:hfnu!=null?Math.round(hfnu):null };
}
function dfaAlpha1(nn){
  if(nn.length<50) return null;
  const N=nn.length; const m=mean(nn);
  const y=new Float64Array(N); let acc=0; for(let i=0;i<N;i++){ acc+=nn[i]-m; y[i]=acc; }
  const scales=[]; for(let s=4;s<=16;s++) scales.push(s);
  const xs=[],ys=[];
  for(const s of scales){
    const nWin=Math.floor(N/s); if(nWin<1) continue; let F=0;
    for(let w=0;w<nWin;w++){
      const o=w*s; let sx=0,sy=0,sxx=0,sxy=0;
      for(let i=0;i<s;i++){ sx+=i; sy+=y[o+i]; sxx+=i*i; sxy+=i*y[o+i]; }
      const den=s*sxx-sx*sx||1e-9; const b=(s*sxy-sx*sy)/den, a=(sy-b*sx)/s;
      let e=0; for(let i=0;i<s;i++){ const r=y[o+i]-(a+b*i); e+=r*r; } F+=e;
    }
    F=Math.sqrt(F/(nWin*s));
    xs.push(Math.log(s)); ys.push(Math.log(F||1e-9));
  }
  // slope
  const mx=mean(xs),myy=mean(ys); let num=0,den=0;
  for(let i=0;i<xs.length;i++){ num+=(xs[i]-mx)*(ys[i]-myy); den+=(xs[i]-mx)*(xs[i]-mx); }
  return den?r2(num/den):null;
}
function sampEn(nn, m, r){
  m=m||2; let N=nn.length; if(N<60) return null;
  const sd=std(nn); const tol=(r||0.2)*sd;
  // O(N²) pair-counting CAP — mirror pulsedex-dsp.js MAXN (PPGDEX-FOLLOWUPS §4 / SYNTH-TEXTURE-FOLLOWUPS §2).
  // analyze() calls this on the WHOLE corrected interval series. The in-app + 6.5-min equiv callers pass a
  // bounded series (≤ a few hundred beats), so this NEVER triggers today (inert, byte-identical). It only
  // caps a FUTURE caller that hands SampEn a full overnight *_PPG.txt (~30k+ beats ⇒ ~10⁹ ops) via the
  // Unifier/OverDex orchestrate path, where N² would jank the main thread. Deterministic uniform decimation
  // to MAXN preserves the interval distribution; tol stays scaled to the ORIGINAL SD (computed above,
  // pre-decimation), matching PulseDex.
  const MAXN=20000;
  if(N>MAXN){ const stride=Math.ceil(N/MAXN), dec=[]; for(let i=0;i<N;i+=stride) dec.push(nn[i]); nn=dec; N=nn.length; }
  function phi(mm){ let cnt=0; for(let i=0;i<N-mm;i++){ for(let j=i+1;j<N-mm;j++){ let ok=true; for(let k=0;k<mm;k++){ if(Math.abs(nn[i+k]-nn[j+k])>tol){ ok=false; break; } } if(ok) cnt++; } } return cnt; }
  const B=phi(m), A=phi(m+1);
  if(!B||!A) return null;
  return r2(-Math.log(A/B));
}

// ════════════════════════════════════════════════════════════════════════
//  MOTION GATE  — ACC + GYRO → per-time motion index (0..1)
// ════════════════════════════════════════════════════════════════════════
function parseSensorXYZ(text){
  const lines=text.split(/\r?\n/); const out=[]; let ns0=null;
  for(const line of lines){ const t=line.trim(); if(!t) continue; const p=t.split(';');
    if(p.length<5) continue; const x=parseFloat(p[2]); if(!isFinite(x)) continue;
    let relNs=NaN; try{ const b=BigInt(p[1].trim()); if(ns0===null)ns0=b; relNs=Number(b-ns0);}catch(e){}
    const ts=parseTimestamp(p[0]);
    out.push({ relNs, tMs:ts?ts.tMs:null, x, y:parseFloat(p[3]), z:parseFloat(p[4]) });
  }
  return out;
}
function analyzeMotion(accRows, gyroRows, t0Ms, durSec, magRows){
  // magRows is LAST + optional so the historical 4-arg contract analyzeMotion(acc,gyro,t0,dur)
  // (and the shared regression suite) keeps working unchanged.
  const has = (accRows&&accRows.length>5)||(gyroRows&&gyroRows.length>5);
  if(!has) return { hasData:false };
  // build a uniform 4 Hz motion-index grid over [0, durSec]
  const dt=0.25, nG=Math.max(1,Math.ceil(durSec/dt));
  const grid=new Float32Array(nG);
  // ACC dynamic magnitude (de-gravitated)
  function relSecOf(r){ if(isFinite(r.relNs)) return r.relNs/1e9; if(r.tMs!=null&&t0Ms!=null) return (r.tMs-t0Ms)/1000; return null; }
  let accMag=[];
  if(accRows&&accRows.length>5){
    const mags=accRows.map(r=>Math.sqrt(r.x*r.x+r.y*r.y+r.z*r.z));
    // gravity baseline via slow moving average
    const w=Math.max(3,Math.round(accRows.length/durSec*1.0)); // ~1s
    const base=movavg(Float32Array.from(mags),w);
    accMag=accRows.map((r,i)=>({ s:relSecOf(r), v:Math.abs(mags[i]-base[i]) }));
  }
  let gyroMag=[];
  if(gyroRows&&gyroRows.length>5){
    gyroMag=gyroRows.map(r=>({ s:relSecOf(r), v:Math.sqrt(r.x*r.x+r.y*r.y+r.z*r.z) }));
  }
  // accumulate into grid (max within each 0.25s cell)
  const accCell=new Float32Array(nG), gyCell=new Float32Array(nG);
  for(const a of accMag){ if(a.s==null) continue; const g=Math.floor(a.s/dt); if(g>=0&&g<nG) accCell[g]=Math.max(accCell[g],a.v); }
  for(const a of gyroMag){ if(a.s==null) continue; const g=Math.floor(a.s/dt); if(g>=0&&g<nG) gyCell[g]=Math.max(gyCell[g],a.v); }
  // normalise: accel in mg (dynamic), gyro in dps. Scale so "still" ≈ 0.
  const accNorm=v=>Math.min(1, v/120);   // ~120 mg dynamic = full motion
  const gyNorm=v=>Math.min(1, v/40);     // ~40 dps = full motion
  for(let i=0;i<nG;i++){ grid[i]=Math.max(accNorm(accCell[i]), gyNorm(gyCell[i])); }
  // smooth
  const sm=movavg(grid, 3);
  const motionAtSec=sec=>{ const g=Math.floor(sec/dt); return (g>=0&&g<nG)?sm[g]:0; };
  const meanMI=mean(Array.from(sm));
  // display series (downsampled, per ~minute or per cell)
  const series=[]; const stride=Math.max(1,Math.floor(nG/600));
  for(let i=0;i<nG;i+=stride) series.push({ x:i*dt/60, y:r2(sm[i]) });
  // ── posture (LIMB orientation) — gravity vector per axis via slow moving average.
  //    NOTE: Polar Sense is worn on the WRIST or the ANKLE (ankle is common for the
  //    arterial-stiffness proxy). The wear site is NOT auto-detected, so this is the
  //    limb's orientation — an approximate, lower-reliability proxy for true body
  //    position (a chest strap / ECGDex is far better). Exposed for cross-node parity
  //    but tagged positionSource:'limb-acc' so the Integrator down-weights it heavily.
  //    null when no ACC (gyro-only sessions).
  let postureAtSec = null, postureDetailAtSec = null, gAxis = null;
  // ── MAGNETOMETER (optional, additive) — Polar Sense 3-axis mag, Gauss, ~10 Hz, ±50 G
  //    range, ~0.0015 G (0.15 µT) LSB. EARTH-FIELD-SCALE ONLY: heading + left/right-lateral
  //    disambiguation + a calibration-free interference flag. NEVER biomagnetic HR — the
  //    cardiac field (~50 pT) is ~3000× below one LSB (see project assessment), and any
  //    pulse-rate peak in MAGN is limb micro-motion aliased through Earth's field, which the
  //    ACC/GYRO gate already captures better. magInterference is exposed as an informational
  //    SQI channel; it does NOT alter beat SQI / conf here (left to the Integrator to weight).
  const magHas = !!(magRows && magRows.length>5);
  let magState = { has:magHas };
  if(magHas){
    magState.ss   = magRows.map(relSecOf);
    magState.mx   = magRows.map(r=>r.x);
    magState.my   = magRows.map(r=>r.y);
    magState.mz   = magRows.map(r=>r.z);
    magState.mag  = magRows.map(r=>Math.hypot(r.x,r.y,r.z));
    magState.base = median(magState.mag.filter(isFinite)) || 0;  // session |B| baseline (Gauss)
  }
  // tilt-compensated heading (deg) from a window-median mag vector + gravity vector (Gauss/mg)
  function tiltHeading(Mx,My,Mz,g){
    if(g){
      const gn=Math.hypot(g.x,g.y,g.z)||1, ux=g.x/gn, uy=g.y/gn, uz=g.z/gn;
      const dot=Mx*ux+My*uy+Mz*uz;                       // remove field component along gravity
      const hx=Mx-dot*ux, hy=My-dot*uy, hz=Mz-dot*uz;    // → horizontal field
      let ax=0,ay=0,az=0; if(Math.abs(ux)<0.9) ax=1; else ay=1;   // ref axis ∦ gravity
      let e1x=uy*az-uz*ay, e1y=uz*ax-ux*az, e1z=ux*ay-uy*ax; const e1n=Math.hypot(e1x,e1y,e1z)||1; e1x/=e1n; e1y/=e1n; e1z/=e1n;
      const e2x=uy*e1z-uz*e1y, e2y=uz*e1x-ux*e1z, e2z=ux*e1y-uy*e1x;   // e2 = ĝ × e1
      return Math.atan2(hx*e2x+hy*e2y+hz*e2z, hx*e1x+hy*e1y+hz*e1z)*180/Math.PI;
    }
    return Math.atan2(My,Mx)*180/Math.PI;
  }
  if(accRows&&accRows.length>5){
    const w=Math.max(3,Math.round(accRows.length/durSec*2.0)); // ~2s low-pass → gravity
    const gx=movavg(Float32Array.from(accRows.map(r=>r.x)),w);
    const gy=movavg(Float32Array.from(accRows.map(r=>r.y)),w);
    const gz=movavg(Float32Array.from(accRows.map(r=>r.z)),w);
    const ss=accRows.map(relSecOf);
    gAxis = { gx, gy, gz, ss };
    const gStride=Math.max(1,Math.floor(ss.length/5000));
    function gravMed(s0,s1){ const ex=[],ey=[],ez=[]; for(let i=0;i<ss.length;i+=gStride){ if(ss[i]!=null&&ss[i]>=s0&&ss[i]<s1){ ex.push(gx[i]); ey.push(gy[i]); ez.push(gz[i]); } } return ex.length? { x:median(ex), y:median(ey), z:median(ez), n:ex.length } : null; }
    // window-median heading (relative, uncalibrated for absolute north)
    function headingAtSec(s0,s1){
      if(!magState.has) return null;
      const sx=[],sy=[],sz=[]; for(let i=0;i<magState.ss.length;i++){ const s=magState.ss[i]; if(s!=null&&s>=s0&&s<s1){ sx.push(magState.mx[i]); sy.push(magState.my[i]); sz.push(magState.mz[i]); } }
      if(sx.length<3) return null;
      const g=gravMed(s0,s1);
      return tiltHeading(median(sx),median(sy),median(sz), g);
    }
    // calibration-free interference: field wobble within a (still) window, or |B| off baseline
    function magInterfAtSec(s0,s1){
      if(!magState.has) return false;
      const v=[]; for(let i=0;i<magState.ss.length;i++){ const s=magState.ss[i]; if(s!=null&&s>=s0&&s<s1) v.push(magState.mag[i]); }
      if(v.length<3) return false;
      const sd=std(v), md=median(v), bg=magState.base||1;
      return !!(sd > Math.max(0.03, 0.04*bg) || Math.abs(md-bg)/bg > 0.25);   // ~>4 µT wobble or >25% off baseline
    }
    // reference heading from the longest non-lateral (supine/prone/upright) spans → L/R datum.
    // Relative datum: the L/R *labels* may be mirrored without a calibration gesture (tagged).
    let refHeading=null;
    if(magState.has){
      let sumS=0,sumC=0,cnt=0;
      for(let s=0;s<durSec;s+=30){
        const g=gravMed(s,s+30); if(!g) continue;
        const base=_posturePPG(g.x,g.y,g.z);
        if(base==='supine'||base==='prone'||base==='upright'){ const h=headingAtSec(s,s+30); if(h!=null){ const rad=h*Math.PI/180; sumS+=Math.sin(rad); sumC+=Math.cos(rad); cnt++; } }
      }
      if(cnt>0) refHeading=Math.atan2(sumS,sumC)*180/Math.PI;
    }
    magState.refHeading=refHeading;
    // Rich per-window posture: { position, conf, heading, magInterf }. postureAtSec (below)
    // returns just the position STRING — the stable contract consumed by the test suite.
    postureDetailAtSec=(s0,s1)=>{
      const g=gravMed(s0,s1);
      const need=(accRows.length/durSec)*30;            // need ≥30 s of gravity samples
      if(!g || g.n < need/gStride) return { position:'unknown', conf:0, heading:null, magInterf:false };
      let base=_normPositionPPG(_posturePPG(g.x,g.y,g.z));
      const heading = magState.has ? headingAtSec(s0,s1) : null;
      const magInterf = magState.has ? magInterfAtSec(s0,s1) : false;
      // split merged 'lateral' into L/R using heading offset from the supine/upright datum
      if(base==='lateral' && heading!=null && refHeading!=null && !magInterf){
        let d=heading-refHeading; while(d>180)d-=360; while(d<-180)d+=360;
        if(Math.abs(d)>=30) base = d>=0 ? 'lateral_R' : 'lateral_L';
      }
      // confidence: axis dominance × coverage × mag bonus / interference penalty
      const gn=Math.hypot(g.x,g.y,g.z)||1, dom=Math.max(Math.abs(g.x/gn),Math.abs(g.y/gn),Math.abs(g.z/gn));
      let conf=Math.max(0,Math.min(1,(dom-0.577)/(1-0.577)));
      conf*=Math.max(0.3,Math.min(1,(g.n*gStride)/need));
      if(magState.has && !magInterf && (base==='lateral_L'||base==='lateral_R')) conf=Math.min(1,conf*1.05+0.05);
      if(magInterf) conf*=0.6;
      return { position:base, conf:r2(conf), heading:(heading!=null? Math.round(((heading%360)+360)%360):null), magInterf };
    };
    postureAtSec=(s0,s1)=>postureDetailAtSec(s0,s1).position;   // string contract (back-compat)
  }
  return { hasData:true, grid:sm, dt, motionAtSec, postureAtSec, postureDetailAtSec, meanMotionIndex:r2(meanMI), series,
           accFs: accRows&&accRows.length>1? Math.round(accRows.length/durSec):null,
           gyroFs: gyroRows&&gyroRows.length>1? Math.round(gyroRows.length/durSec):null,
           nAcc: accRows?accRows.length:0, nGyro: gyroRows?gyroRows.length:0,
           hasMag: magState.has, nMag: magRows?magRows.length:0,
           magFs: magRows&&magRows.length>1? Math.round(magRows.length/durSec):null,
           magBaseG: magState.has? r2(magState.base):null,
           refHeadingDeg: (magState.has && magState.refHeading!=null)? Math.round(((magState.refHeading%360)+360)%360):null };
}
// classify body position from a gravity vector (mg). Mount-independent tilt is the robust
// axis (supine/prone ≈ flat, upright ≈ vertical). Left/right fold into 'lateral'. Mirrors
// ECGDex's _posture/_normPosition (duplicated locally — these nodes don't share modules).
function _posturePPG(gx,gy,gz){
  const g=Math.hypot(gx,gy,gz)||1, ux=gx/g, uy=gy/g, uz=gz/g;
  if(Math.abs(uz) >= 0.70) return uz>0 ? 'supine' : 'prone';
  if(Math.abs(uy) >= 0.55) return 'upright';
  return 'lateral';
}
function _normPositionPPG(p){ return ['supine','prone','lateral','upright'].indexOf(p)>=0 ? p : 'unknown'; }

// ════════════════════════════════════════════════════════════════════════
//  DEVICE-PPI VALIDATION  — self-PPI vs Polar *_PPI.txt (validation lane only)
// ════════════════════════════════════════════════════════════════════════
function parseDevicePPI(text){
  const lines=text.split(/\r?\n/); const out=[];
  for(const line of lines){ const t=line.trim(); if(!t) continue; const p=t.split(';');
    if(p.length<2) continue; const ppi=parseFloat(p[1]); if(!isFinite(ppi)) continue;
    const ts=parseTimestamp(p[0]);
    const err=parseFloat(p[2]); const blocker=parseFloat(p[3]); const contact=parseFloat(p[4]);
    out.push({ tMs:ts?ts.tMs:null, ppi, err:isFinite(err)?err:null, blocker:isFinite(blocker)?blocker:null,
               contact:isFinite(contact)?contact:null, hr:parseFloat(p[p.length-1]) });
  }
  return out;
}
function validatePPI(selfNN, devicePPI){
  if(!devicePPI || !devicePPI.length) return { hasData:false };
  const dev=devicePPI.filter(d=>d.ppi>300&&d.ppi<2000&&(d.blocker==null||d.blocker===0)).map(d=>d.ppi);
  if(dev.length<3 || selfNN.length<3) return { hasData:true, usable:false, nDevice:dev.length };
  const sM=mean(selfNN), dM=mean(dev);
  const sR=rmssdOf(selfNN), dR=rmssdOf(dev);
  const agree=100*(1-Math.min(1, Math.abs(sM-dM)/dM));
  return { hasData:true, usable:true, nSelf:selfNN.length, nDevice:dev.length,
           selfMean:Math.round(sM), devMean:Math.round(dM), meanAbsDevMs:Math.round(Math.abs(sM-dM)),
           selfRMSSD:r1(sR), devRMSSD:r1(dR), deviceAgreementPct:r1(agree) };
}
function rmssdOf(rr){ let s=0,c=0; for(let i=1;i<rr.length;i++){ const d=rr[i]-rr[i-1]; s+=d*d; c++; } return Math.sqrt(s/c); }

// ════════════════════════════════════════════════════════════════════════
//  EPOCHS — 5-min windows over the corrected interval series
// ════════════════════════════════════════════════════════════════════════
function buildEpochs(nn, tt, motion, perfWindow){
  const epochs=[]; if(nn.length<2) return epochs;
  const epLen=300; // sec
  const tEnd=tt[tt.length-1];
  for(let e0=0; e0<tEnd; e0+=epLen){
    const idx=[]; for(let i=0;i<tt.length;i++){ if(tt[i]>=e0 && tt[i]<e0+epLen) idx.push(i); }
    if(idx.length<5) continue;
    const seg=idx.map(i=>nn[i]);
    const td=timeDomain(seg); if(!td) continue;
    const ls=lombScargle(idx.map(i=>tt[i]), seg);
    const mi = motion&&motion.hasData ? r2(mean(idx.map(i=>motion.motionAtSec(tt[i])))) : null;
    const pi = perfWindow ? perfWindow(e0+epLen/2) : null;
    const post = (motion&&motion.postureDetailAtSec) ? motion.postureDetailAtSec(e0, e0+epLen) : null;
    const position = post ? post.position : 'unknown';
    epochs.push({ tMin:Math.round(e0/60), beats:idx.length, hr:td.hr, meanRR:td.meanRR, rmssd:td.rmssd, sdnn:td.sdnn,
      pnn50:td.pnn50, lf:ls?ls.lf:null, hf:ls?ls.hf:null, lfhf:ls?ls.lfhf:null, respRate:null, pi, motionIndex:mi,
      position, positionConf: post?post.conf:null, headingDeg: post?post.heading:null, magInterference: post?!!post.magInterf:false });
  }
  return epochs;
}

// ════════════════════════════════════════════════════════════════════════
//  fmt helpers (Clock Contract — always getUTC*)
// ════════════════════════════════════════════════════════════════════════
function pad2(x){ return (x<10?'0':'')+x; }
function fmtClock(ms){ if(ms==null) return '—'; const d=new Date(ms); return pad2(d.getUTCHours())+':'+pad2(d.getUTCMinutes()); }
function fmtClockSec(ms){ if(ms==null) return '—'; const d=new Date(ms); return pad2(d.getUTCHours())+':'+pad2(d.getUTCMinutes())+':'+pad2(d.getUTCSeconds()); }
function fmtDate(ms){ if(ms==null) return '—'; const d=new Date(ms); return d.getUTCFullYear()+'-'+pad2(d.getUTCMonth()+1)+'-'+pad2(d.getUTCDate()); }
function fmtDateTime(ms){ if(ms==null) return '—'; return fmtDate(ms)+' '+fmtClock(ms); }

// ════════════════════════════════════════════════════════════════════════
//  MAIN PIPELINE
// ════════════════════════════════════════════════════════════════════════
function analyze(rec, progress){
  const P=progress||function(){};
  P(45,'Selecting best-SNR channel…');
  const sel=pickChannel(rec);
  const raw=rec.ch[sel.idx];
  const bp0=bandpass(raw, rec.fs, 0.5, 8.0);
  const sign=orient(bp0);
  const bp=sign===1?bp0:bp0.map(v=>-v);

  P(55,'Optical beat detection (systolic feet)…');
  const det=detectBeats(bp, rec.fs);

  P(62,'Motion gate (ACC + GYRO)…');
  const motion=analyzeMotion(rec.acc, rec.gyro, rec.t0Ms, rec.durSec, rec.magn);
  const motionAt = motion.hasData ? (samp=>motion.motionAtSec(rec.relSec[Math.max(0,Math.min(rec.n-1,Math.round(samp)))])) : null;

  P(68,'Per-beat SQI…');
  const sqi=beatSQI(bp, det.peaks, rec.fs, motionAt);

  // foot times (sec, absolute rel) — interpolate relSec at fractional foot index
  const footSec=det.feet.map(f=>{ const i0=Math.floor(f), i1=Math.min(rec.n-1,i0+1), fr=f-i0;
    return rec.relSec[i0]*(1-fr)+rec.relSec[i1]*fr; });
  const peakSec=det.peaks.map(p=>rec.relSec[Math.max(0,Math.min(rec.n-1,p))]);

  P(74,'PPI + HRV…');
  const { rr, tt }=buildPPI(footSec);
  const corr=correctRR(rr, tt);
  const nn=corr.nn;
  const td=timeDomain(nn)||{};
  const poin=poincare(nn);
  const freq=lombScargle(corr.tt, nn);
  const dfa1=dfaAlpha1(nn);
  const se=sampEn(nn);

  // perfusion index over windows (AC/DC) for epochs/morph hand-off
  const dc=mean(Array.from(raw).map(Math.abs));
  const acAmp=std(bp);
  const perfWindow=()=> dc>0 ? r2(100*acAmp/dc) : null;

  P(80,'Epochs…');
  const epochs=buildEpochs(nn, corr.tt, motion, perfWindow);

  // quality
  const meanSQI=sqi.length?r2(mean(sqi)):0;
  const cleanBeats=sqi.filter(s=>s>=0.5).length;
  const cleanBeatPct=sqi.length?Math.round(100*cleanBeats/sqi.length):0;
  const motionRejected = motion.hasData ? det.peaks.filter((p,k)=>motionAt(p)>0.5).length : 0;
  const motionRejectedPct = det.peaks.length? r1(100*motionRejected/det.peaks.length):0;
  const correctionRate = rr.length? r1(100*corr.nCorr/rr.length):0;
  const analyzablePct = Math.round(cleanBeatPct*(1-motionRejectedPct/100));
  // magnetometer interference coverage (informational — does not alter SQI/conf)
  const magEpochs = epochs.filter(e=>e.magInterference).length;
  const magInterferencePct = (motion.hasMag && epochs.length)? Math.round(100*magEpochs/epochs.length) : null;

  // tier (mirror ECGDex)
  const durMin=rec.durSec/60;
  let tier='short', tierMsg='';
  if(durMin<1){ tier='ultra-short'; }
  else if(durMin<5){ tier='ultra-short'; }
  else if(durMin<90){ tier='short'; }
  else tier='overnight';
  const longRec = durMin>=90;
  tierMsg = ({'ultra-short':'Ultra-short — rMSSD/pNN50/SD1/HF valid; SDNN/LF/VLF withheld','short':'5-min standard window — full short-term suite valid','overnight':'Overnight — CVHR & per-epoch medians unlocked'})[tier];

  // morphology (ppgdex-morph.js)
  let morph=null;
  if(global.PPGMorph){ try{ morph=global.PPGMorph.analyze(bp, raw, det, rec.fs, sqi); }catch(e){ morph=null; } }

  // PPI validation lane
  const validation=validatePPI(nn, rec.devicePPI);

  // markers
  const markers=(rec.markers||[]).map(mk=>({ relSec:mk.relSec, type:mk.type }));

  // events (Stage scaffold — autonomic_surge / perfusion_drop / motion_artifact)
  const events=buildEvents({ epochs, nn, tt:corr.tt, t0Ms:rec.t0Ms, motion, det, sqi, peakSec, morph });

  P(92,'Finalising…');
  const dispHr = longRec && epochs.length ? median(epochs.map(e=>e.hr)) : td.hr;

  return {
    source:rec.source||'file', fname:rec.fname||'', fs:rec.fs, n:rec.n, t0Ms:rec.t0Ms, offsetMin:rec.offsetMin,
    durSec:rec.durSec, durMin:r1(durMin), tier, tierMsg, longRec, relSec:rec.relSec,
    channel:sel.idx, channelScores:sel.scores,
    disp:bp, peakSamp:det.peaks, footSamp:det.feet, beatTimes:peakSec, footSec, sqi,
    nPulses:det.peaks.length, nBeats:det.peaks.length,
    hr:td.hr, dispHr, dispRm:td.rmssd, dispSd:td.sdnn, dispPn:td.pnn50,
    meanRR:td.meanRR, sdnn:td.sdnn, rmssd:td.rmssd, pnn50:td.pnn50, lnRMSSD:td.lnRMSSD, triIdx:td.triIdx,
    nn, tt:corr.tt, poincareNN:nn, sd1:poin?poin.sd1:null, sd2:poin?poin.sd2:null, sd1sd2:poin?poin.sd1sd2:null, ellArea:poin?poin.ellArea:null,
    freq, dfa1, sampen:se,
    epochs,
    meanSQI, cleanBeatPct, analyzablePct, coveragePct:cleanBeatPct, correctionRate, nCorrected:corr.nCorr,
    motion, motionRejectedPct, magHasData:motion.hasMag, magInterferencePct,
    validation, markers, morph,
    perfusionIndex: perfWindow(),
    events,
    // clock fmt helpers exposed for render/export
    _fmt:{ fmtClock, fmtClockSec, fmtDate, fmtDateTime }
  };
}

function buildEvents(ctx){
  const ev=[]; const { epochs, t0Ms, motion, det, sqi, peakSec, nn, tt }=ctx;
  const node='PpgDex';
  // local PPG signal quality near a time (mean SQI of beats within ±5 s)
  function sqiAt(relSec){
    if(!sqi||!sqi.length||!peakSec) return null;
    let a=0,c=0; for(let k=0;k<peakSec.length;k++){ if(peakSec[k]!=null && Math.abs(peakSec[k]-relSec)<5){ a+=sqi[k]; c++; } }
    return c? r2(a/c) : null;
  }
  // surge magnitude (HR jump, bpm) → likelihood, mirroring ECGDex's mapping so the
  // two cardiac nodes are calibrated alike (R7). SQI rides alongside, not inside conf.
  const surgeConf = (ampBpm)=> r2(Math.max(0.45, Math.min(0.9, 0.45 + Math.min(ampBpm||0, 24)/48)));
  function evt(relSec, impulse, conf, meta, sqiVal){
    const tMs = t0Ms!=null? t0Ms+Math.round(relSec*1000) : null;
    ev.push({ t: fmtClockSec(tMs!=null?tMs:relSec*1000), tMs, impulse, node, conf:r2(conf),
              sqi:(sqiVal!==undefined?sqiVal:null), meta:meta||undefined });
  }
  // hrv_drop / autonomic_surge between consecutive epochs
  for(let i=1;i<epochs.length;i++){
    const a=epochs[i-1], b=epochs[i];
    if(a.rmssd && b.rmssd){
      const drop=(a.rmssd-b.rmssd)/a.rmssd;
      if(drop>0.35) evt(b.tMin*60,'hrv_drop',0.7,{ rmssdFrom:a.rmssd, rmssdTo:b.rmssd, position:(b.position&&b.position!=='unknown')?b.position:null, positionConf:(b.positionConf!=null?b.positionConf:undefined), magInterference:b.magInterference?true:undefined }, sqiAt(b.tMin*60));
    }
    if(a.hr && b.hr && (b.hr-a.hr)>8){ const amp=Math.round(b.hr-a.hr); evt(b.tMin*60,'autonomic_surge',surgeConf(amp),{ ampBpm:amp, position:(b.position&&b.position!=='unknown')?b.position:null, positionConf:(b.positionConf!=null?b.positionConf:undefined), magInterference:b.magInterference?true:undefined }, sqiAt(b.tMin*60)); }
  }
  // motion_artifact_segment — contiguous high-motion beats (quality flag; conf is its own low prior)
  if(motion&&motion.hasData){
    let runStart=null;
    for(let k=0;k<det.peaks.length;k++){
      const hi = peakSec[k]!=null && motion.motionAtSec(peakSec[k])>0.5;
      if(hi && runStart===null) runStart=peakSec[k];
      if((!hi||k===det.peaks.length-1) && runStart!==null){ evt(runStart,'motion_artifact_segment',0.3,{ }, sqiAt(runStart)); runStart=null; }
    }
  }
  return ev;
}

// ── multi-part split files (Polar Sensor Logger) ───────────────────────────
// Polar writes long streams as `…_PPG_part01of15.txt` … `of15`; each part
// repeats the header. Group by the part-stripped base and concatenate in numeric
// part order (header from part 1 only) so a split capture becomes ONE stream
// instead of N fragmentary sessions. Pure + DOM-free → unit-tested in BOTH
// runners; the PpgDex app (and ECGDex's companion text path) delegate here.
function partKey(name){
  const m = String(name||'').match(/^(.*)_part(\d+)of(\d+)(\.[^.]*)?$/i);
  return m ? { base: m[1] + (m[4]||''), part:+m[2], total:+m[3] } : null;
}
function mergeMultipart(parsed){           // parsed = [{name,text,kind?,stampMs?}]
  const groups = new Map(), singles = [];
  for(const f of parsed){
    const pk = partKey(f.name);
    if(!pk){ singles.push(f); continue; }
    if(!groups.has(pk.base)) groups.set(pk.base, []);
    groups.get(pk.base).push(Object.assign({}, f, { _part: pk.part }));
  }
  const merged = [];
  groups.forEach((arr, base)=>{
    arr.sort((a,b)=>a._part - b._part);    // numeric → part2 before part10
    let text = arr[0].text;
    for(let i=1;i<arr.length;i++){
      const lines = arr[i].text.split(/\r?\n/); lines.shift(); // drop repeated header
      text += (text.endsWith('\n')?'':'\n') + lines.join('\n');
    }
    merged.push({ name: base, text, kind: arr[0].kind, stampMs: arr[0].stampMs, parts: arr.length });
  });
  return singles.concat(merged);
}

global.PPGDSP = {
  parsePPG, parseSensorXYZ, parseDevicePPI, analyze, analyzeMotion, validatePPI,
  bandpass, detectBeats, buildPPI, correctRR, timeDomain, poincare, lombScargle, dfaAlpha1,
  parseTimestamp, fmtClock, fmtClockSec, fmtDate, fmtDateTime,
  mean, std, median, quantile,
  partKey, mergeMultipart
};

// ════════════════════════════════════════════════════════════════════════
//  PHASE-9 SIGNAL-ADAPTER — namespaced node surface (PpgDex.compute)
//  Shared node-export builder: ONE event source (analyze→buildEvents→r.events)
//  feeds BOTH the app's exportGanglior() and the headless compute(). DOM-free
//  and self-contained — kernel/provenance arrive via opts (typeof-guarded by the
//  caller), never reached off window here (CONTRIBUTING.md §6 / brief §1B).
// ════════════════════════════════════════════════════════════════════════
function ppgBuildNodeExport(r, opts){
  opts = opts || {};
  // PPGDEX-FOLLOWUPS §3: preserve the per-event sqi axis (R7 — "SQI rides ALONGSIDE conf", a SEPARATE
  // quality axis, not folded into conf). buildEvents stamps sqi on EVERY event (a number for the per-beat-
  // quality impulses e.g. motion_artifact_segment via sqiAt(); null where it doesn't apply). The old
  // explicit field-list here DROPPED sqi, so the PpgDex node-export silently diverged from ECGDex (whose
  // ecgBuildNodeExport copies all keys → its export carries sqi). Carry it through so the sqi round-trip is
  // REAL and fleet-consistent. 0-event exports (e.g. the equiv fixture) are byte-identical (empty array).
  var events = (r.events||[]).map(function(e){
    return { t:e.t, tMs:e.tMs, impulse:e.impulse, node:e.node, conf:e.conf, sqi:(e.sqi!==undefined?e.sqi:null), meta:e.meta };
  });
  var out = {
    kernel: opts.kernel || null,
    schema:{ name:'ganglior.node-export', version:'2.0', node:'PpgDex', nodeVersion:'1.0',
      bus:'ganglior', generated:(opts.generated || new Date().toISOString()),
      provenance: opts.provenance || null,
      doc:'PpgDex PPG-derived events → Ganglior bus. t/tMs = floating wall-clock ms (UTC getters). null = unknown, never fabricated.' },
    // EXPORT-IDENTITY §2.1 / -FOLLOWUPS-II §1: identity-free contentId, single-sourced in this
    // shared builder (both app exportGanglior + headless compute reach it). Folds the NN beat series.
    recording:{ source:'ppg', contentId:((typeof SignalFrame!=='undefined' && SignalFrame && SignalFrame.computeContentId && r.nn && r.nn.length) ? SignalFrame.computeContentId({ signalType:'ppg', kind:'intervals', intervals:r.nn, t0Ms:(r.t0Ms!=null?r.t0Ms:null), usable:true }) : null), startEpochMs:(r.t0Ms!=null?r.t0Ms:null), sessions:1, events:events.length },
    ganglior_events:events,
    reserved:{ doc:'Awaiting other fleet nodes; null until available.' }
  };
  // ── RICH export (gated: opts.rich) — ECG-PPG-FOLLOWUPS-HANDOFF §1 option (a) / PPGDEX-FOLLOWUPS §1 ──
  // By DEFAULT this builder emits the LIGHT export above and the app's exportGanglior() calls WITHOUT
  // opts.rich → the app's Ganglior stream stays BYTE-IDENTICAL. Only the orchestrate emitter
  // (signal-orchestrate.emitPpgNodeExport) passes opts.rich, so a Unifier/OverDex-routed PPG file
  // additionally carries the slice the Integrator's adaptEnvelopeNode('PpgDex') consumes: hrv.time
  // .{rmssd,sdnn} (single-site PPG → these ARE whole-record, the consensus axis directly), hrv.frequency
  // .lfhf, quality.analyzablePct, and the per-5-min timeseries.epochs[].position grid (limb-acc posture —
  // populated once companions land, §1b). Field math MIRRORS ppgdex-app.js buildV2 (same `r`, same numbers).
  // SHARED SHAPE with ecgBuildNodeExport (ECGDEX-FOLLOWUPS-II §2) — keep the two aligned (handoff no-divergence).
  if (opts.rich){
    var nz = function(v){ return (v==null || (typeof v==='number' && !isFinite(v))) ? null : v; };
    var fq = r.freq || {};
    out.quality = { analyzablePct:nz(r.analyzablePct), cleanBeatPct:nz(r.cleanBeatPct), coveragePct:nz(r.coveragePct), motionRejectedPct:nz(r.motionRejectedPct) };
    out.hrv = {
      time:{ meanRR:nz(r.meanRR), hr:nz(r.dispHr), sdnn:nz(r.sdnn), rmssd:nz(r.rmssd), pnn50:nz(r.pnn50),
        window:'wholeRecord', units:'ms',
        windowNote:'sdnn/rmssd are whole-record (single-site PPG); per-5-min values live in epochs[]. Directly comparable to another node\u2019s wholeRecord SDNN/RMSSD.' },
      frequency:{ lf:nz(fq.lf), hf:nz(fq.hf), lfhf:nz(fq.lfhf), method:'Lomb-Scargle' }
    };
    out.timeseries = {
      doc:'5-min epochs — primary cross-node feed (posture rides on epochs[].position).',
      epochs:(r.epochs||[]).map(function(e){ return { tMin:e.tMin, hr:nz(e.hr), rmssd:nz(e.rmssd), sdnn:nz(e.sdnn), lfhf:nz(e.lfhf),
        motionIndex:nz(e.motionIndex), position:(e.position||'unknown'), positionConf:nz(e.positionConf), headingDeg:nz(e.headingDeg), magInterference:!!e.magInterference }; })
    };
  }
  return out;
}

// Headless public surface — parse → analyze (REAL pipeline) → shared node-export.
// Accepts a Polar Sense `*_PPG.txt` string, {text}, an already-parsed rec {ch:[…]},
// or the canonical ppg SignalFrame (samples PACKS the multi-channel optical waveform).
function compute(input, opts){
  opts = opts || {};
  var rec;
  if(input && input.samples && input.samples.ch && Array.isArray(input.samples.ch)){
    // Canonical ppg SignalFrame (signal-frame.js): samples PACKS the parsed optical waveform
    // ({ch:[F32×3], amb, relSec, n, durSec, length:n}). PPG is 100+ Hz, so per-sample row
    // objects would be millions — the typed-array channels ride through `samples` instead, with
    // fs/t0Ms/offsetMin on the frame (ECG-like). signal-orchestrate.emitPpgNodeExport hands this
    // shape STRAIGHT to compute(), so rebuild the parsePPG-shaped rec DIRECTLY from the frame's
    // own already-parsed channels (the polar-sense-ppg adapter already ran PpgDex.parsePPG — do
    // NOT re-parse). Without this branch the orchestrate PPG path throws (the {text}/rec branches
    // below both miss a samples frame — the §1 compute()-shape gap that bit GlucoDex).
    var s = input.samples;
    var n = (s.n!=null ? s.n : (s.ch[0] ? s.ch[0].length : 0));
    var fs = (input.fs!=null ? input.fs : s.fs);
    var relSec = s.relSec;
    if(!relSec){ relSec = new Float64Array(n); for(var i=0;i<n;i++) relSec[i]=i/(fs||1); }
    rec = { ch:s.ch, amb:(s.amb||null), relSec:relSec, n:n, fs:fs,
            t0Ms:(input.t0Ms!=null ? input.t0Ms : (s.t0Ms!=null ? s.t0Ms : null)),
            offsetMin:(input.offsetMin!=null ? input.offsetMin : null),
            durSec:(s.durSec!=null ? s.durSec : (n>1 ? (n-1)/(fs||1) : 0)),
            acc:(input.acc||null), gyro:(input.gyro||null), magn:(input.magn||null),
            devicePPI:(input.devicePPI||null), markers:(input.markers||null) };
  } else if(input && Array.isArray(input.ch)){
    rec = input;                                         // already a parsed rec (app / test path)
  } else {
    var text = (typeof input === 'string') ? input
             : (input && typeof input.text === 'string') ? input.text
             : (input && input.samples && typeof input.samples.text === 'string') ? input.samples.text
             : null;
    if(text == null) throw new Error('PpgDex.compute: need a Polar Sense *_PPG.txt string, {text}, a parsed rec {ch:[…]}, or a ppg SignalFrame {samples:{ch:[…]}}.');
    rec = parsePPG(text);
  }
  if(opts.source) rec.source = opts.source;
  if(opts.fname && !rec.fname) rec.fname = opts.fname;
  var r = analyze(rec, null);
  return ppgBuildNodeExport(r, opts);
}

global.PPGDSP.compute = compute;
global.PPGDSP.buildNodeExport = ppgBuildNodeExport;
// ONE namespaced global (brief §1A). PpgDex leaks nothing bare (the whole DSP is in this
// IIFE) → no __DEX_NAMESPACED__ suppression gate needed; this is an explicit named global,
// collision-free in the co-load realm. Standalone bundles still read PPGDSP.
global.PpgDex = global.PpgDex || { compute:compute, parsePPG:parsePPG, analyze:analyze,
  buildNodeExport:ppgBuildNodeExport, _build:ppgBuildNodeExport };

})(window);
