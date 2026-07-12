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
  let ns0=null, t0Ms=null, firstTs=null;   // lastTs is resolved lazily in the fs fallback (§P1)
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
    // Clock Contract: only the FIRST stamp is load-bearing here (t0Ms + offsetMin). The LAST stamp is
    // read ONLY by the degenerate `deltas.length<=20` fs fallback below, which a real capture (190k
    // valid ns deltas) never takes — so resolve it lazily there instead of parsing every one of ~190k
    // rows for a value that is then discarded. parseTimestamp was ~half of parsePPG's entire cost.
    // (EFFICIENCY-AUDIT-FINDINGS-2026-07-12 §P1.)
    if(t0Ms===null){ const ts = parseTimestamp(p[0]); if(ts){ t0Ms=ts.tMs; firstTs=ts; } }
    started=true;
  }
  const n = ch0.length;
  if(n < 10) throw new Error('No PPG samples parsed — expected Polar Sense `*_PPG.txt` (Phone timestamp;sensor ns;ch0;ch1;ch2;ambient).');
  // fs from median ns delta (precise) — fall back to phone-clock span
  let fs = 176;
  const deltas = [];
  for(let i=1;i<n;i++){ const d=nsArr[i]-nsArr[i-1]; if(isFinite(d)&&d>0) deltas.push(d); }
  if(deltas.length>20){ const md = median(deltas); if(md>0) fs = 1e9/md; }
  else {
    // Lazy `lastTs` (§P1): scan BACKWARD for the last row that the loop above would have accepted AND
    // whose stamp parses — byte-identical to the old eager `lastTs`, but paid for only on this
    // degenerate path. The row filter must mirror the main loop's exactly (>=6 fields, finite ch0).
    let lastTs = null;
    for(let li=lines.length-1; li>=0 && !lastTs; li--){
      const line = lines[li].trim(); if(!line) continue;
      const p = line.split(';'); if(p.length < 6) continue;
      if(!isFinite(parseFloat(p[2]))) continue;
      lastTs = parseTimestamp(p[0]);
    }
    if(firstTs && lastTs && lastTs.tMs>firstTs.tMs){ fs = (n-1)/((lastTs.tMs-firstTs.tMs)/1000); }
  }
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
//  CHANNEL RANKING — best-SNR optical path (REFERENCE-channel selection)
//  pulsatility = power in 0.7–3 Hz band ÷ power in 4–8 Hz band (after BP).
//  PPGDEX-BEAT-DETECTION-PERF §2: score on a representative ~90 s WINDOW, not the
//  whole record. SNR is a ratio of band powers, so a mid-recording window ranks the
//  3 LEDs identically to the whole night; the old scorer ran TWO whole-record
//  filtfilt bandpasses (4 biquad passes each) on EVERY channel — ~6 whole-record
//  filter passes before detection even started. Under §1 all three channels are now
//  DETECTED on (3-LED consensus), so this is only a RANKING to pick the reference
//  waveform for the scope/morphology/SQI — never a discard.
// ════════════════════════════════════════════════════════════════════════
function channelSNR(sig, fs){
  // representative mid-recording window (SNR is scale- & length-invariant); touches
  // ≤ ~90 s·fs samples per channel per band instead of the whole night.
  const win=Math.min(sig.length, Math.max(Math.round(fs*90), Math.round(fs*20)));
  let s0=Math.floor((sig.length-win)/2); if(s0<0) s0=0;
  const slice=(s0===0 && win===sig.length) ? sig : sig.subarray(s0, s0+win);
  const pulse = bandpass(slice, fs, 0.7, 3.0);
  const noise = bandpass(slice, fs, 4.0, 8.0);
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
//  OPTICAL BEAT DETECTION — O(N) TERMA (Elgendi 2013, "the Pan-Tompkins of PPG")
//  PPGDEX-BEAT-DETECTION-PERF §1. Two event-related moving averages + a beat-
//  adaptive offset threshold → systolic peaks in ONE forward pass. NO whole-record
//  autocorrelation and NO global period. The old detector swept ~235 lags × N
//  (~1.07e9 mul-adds on a 4.6 M-sample night) to estimate ONE scalar period T, then
//  used that single period + a fixed 0.30 threshold to segment a whole drifting-HR
//  night — which both janked the main thread AND dropped beats where amplitude/shape
//  wandered (the ~19 % missed-beat root cause). TERMA's threshold is LOCAL (tracks
//  MA_beat), adapting beat-to-beat with no tuned period. Strictly O(N) (running-sum
//  moving averages + a single block scan). Feet stay the intersecting-tangent
//  refinement (PPI = foot-to-foot), fed from the new peaks.
// ════════════════════════════════════════════════════════════════════════
/* ── CADENCE PRIOR — windowed autocorrelation of the pulse band ────────────────────────────────
 * Local beat period in SAMPLES for every sample index (Float32Array), or null if the record is too
 * short to window.
 *
 * WHY (the dicrotic-notch double-count — PPGDEX-OPTICAL-DETECTOR §1): TERMA calls a beat wherever the
 * short upstroke-energy average exceeds the long one — a bare `maPeak > maBeat`, with no amplitude
 * discrimination. A prominent DIASTOLIC (reflected) wave is a genuine positive-slope event, so it
 * raises its own block and is detected as a second "beat" about half a cycle after systole. At the
 * sleeping ~48 bpm of the real corpus that is ~625 ms — far outside the fixed 0.30 s refractory, so
 * nothing suppressed it and the optical HR read exactly 2× true. On 2026-06-29 / 07-02 / 07-05 ALL
 * THREE LEDs doubled together, so the 3-LED vote ratified it (2-of-3 agreement on a harmonic is still
 * 2-of-3) and no cross-channel check could see it either.
 *
 * The fundamental is immune to this: a dicrotic notch is a HARMONIC (it sits at T/2), while the
 * autocorrelation still peaks at the true beat T. Against paired chest-ECG on the whole trio corpus the
 * ACF cadence is right on EVERY night — including the four where peak-counting doubles (07-01 47.9 vs
 * ECG 48.0 · 06-29 49.2 vs 49.7 · 07-02 47.9 vs 48.4 · 07-05 56.6 vs 57.8); worst error 1.2 bpm.
 *
 * ⚠️ NOT a return to the retired global-period detector. THAT one used a WHOLE-RECORD autocorrelation
 * period to GATE detection, and was the missed-beat root cause (see the note below). Here the cadence is
 * (a) WINDOWED — it tracks HR drift across a night, arousals included — and (b) used ONLY to size the
 * refractory. TERMA still finds every peak; the cadence only says how close two peaks may legitimately be.
 */
function cadenceSamples(bp, fs){
  const n=bp.length;
  const WIN=Math.round(fs*30), HOP=Math.round(fs*15);
  if(n < WIN+HOP) return null;
  // Pulse band only (0.5–3.0 Hz = 30–180 bpm) — drops the harmonics the notch lives in, so the ACF is
  // dominated by the fundamental. Decimate to ~25 Hz first: the ACF is O(win × lags) and needs no more
  // resolution than that (a 25 Hz lag step is 40 ms, and the period is smoothed across windows anyway).
  const lp=bandpass(bp, fs, 0.5, 3.0);
  const D=Math.max(1, Math.round(fs/25)), fsd=fs/D;
  const m=Math.floor(n/D), x=new Float32Array(m);
  for(let i=0;i<m;i++) x[i]=lp[i*D];
  const lagMin=Math.max(2, Math.round(fsd*0.33));   // 180 bpm ceiling
  const lagMax=Math.round(fsd*2.0);                 //  30 bpm floor
  const wd=Math.round(WIN/D), hd=Math.round(HOP/D);
  const ts=[], ws=[];
  for(let s=0; s+wd<=m; s+=hd){
    let mu=0; for(let i=s;i<s+wd;i++) mu+=x[i]; mu/=wd;
    let best=0, bl=0;
    for(let L=lagMin; L<=lagMax; L++){
      let c=0; for(let i=s; i+L<s+wd; i++) c+=(x[i]-mu)*(x[i+L]-mu);
      if(c>best){ best=c; bl=L; }
    }
    if(bl){ ts.push(bl*D); ws.push(s*D + WIN/2); }   // period in ORIGINAL samples, at the window centre
  }
  if(!ts.length) return null;
  // Piecewise-linear across window centres (HR drifts smoothly); flat outside the first/last centre.
  const out=new Float32Array(n);
  let k=0;
  for(let i=0;i<n;i++){
    while(k<ws.length-2 && i>ws[k+1]) k++;
    if(i<=ws[0]) out[i]=ts[0];
    else if(i>=ws[ws.length-1]) out[i]=ts[ts.length-1];
    else { const f=(i-ws[k])/Math.max(1,(ws[k+1]-ws[k])); out[i]=ts[k]*(1-f)+ts[k+1]*f; }
  }
  return out;
}
// A systolic peak cannot follow the previous one sooner than this fraction of a beat — an interval
// below it is the reflected/diastolic wave, not a heartbeat. 0.60 clears the observed intruder (~0.5 × T:
// a 600–700 ms mode against a 1250 ms beat) while still admitting a genuine beat-to-beat acceleration of
// up to ~1.67×, which no real sinus rhythm exceeds between ADJACENT beats.
const REFR_CADENCE_FRAC = 0.60;
function detectBeats(bp, fs){
  const n=bp.length;
  const peaks=[];
  if(n<3) return { peaks, feet:[], T:Math.round(fs*0.85) };
  // FEATURE = positive-slope (systolic-upstroke) energy. The derivative removes any DC
  // offset AND slow baseline wander (≈0 slope), so — unlike a clipped-amplitude square —
  // it is robust to the large baseline drift + supra-physiologic transients real optical
  // channels carry (a transient inflates only the LOCAL long average, suppressing just its
  // own neighbourhood, not the whole record). Fed into TERMA's dual moving-average block
  // logic, which replaces the old autocorrelation-derived GLOBAL period (the missed-beat
  // root cause) with a LOCAL adaptive threshold.
  const z=new Float32Array(n);
  for(let i=1;i<n;i++){ const dv=bp[i]-bp[i-1]; z[i]=dv>0?dv*dv:0; }
  const W1=Math.max(3, Math.round(fs*0.111));       // systolic-upstroke window (~111 ms)
  const W2=Math.max(W1+2, Math.round(fs*0.667));    // one-beat window (~667 ms)
  const maPeak=movavg(z, W1);
  const maBeat=movavg(z, W2);
  const minW=Math.max(2, Math.round(fs*0.05));      // min systolic-block width (noise reject)
  const refrFloor=Math.round(fs*0.30);               // 200 bpm ceiling — absolute physiologic floor
  // ADAPTIVE refractory: 0.60 × the LOCAL beat (windowed-ACF cadence), floored at the 0.30 s physiologic
  // ceiling. A fixed 0.30 s cannot reject a diastolic wave at a sleeping 48 bpm (it lands ~625 ms out,
  // twice the refractory) — which is exactly how the optical HR came to read 2× true. Null cadence (a
  // clip too short to window) ⇒ the floor, i.e. the old behaviour.
  const cad=cadenceSamples(bp, fs);
  // blocks of interest where the short upstroke-energy average exceeds the LOCAL long
  // average — LOCAL threshold, so no global period and no outlier-inflated global offset;
  // it adapts beat-to-beat as HR/amplitude drift. Kept only if wider than minW.
  let i=1;
  while(i<n){
    if(maPeak[i] > maBeat[i]){
      let j=i; while(j<n && maPeak[j] > maBeat[j]) j++;
      if(j-i >= minW){                                // valid systolic block
        // systolic peak = max of the ORIGINAL waveform across the upstroke block + a short tail
        let sp=i, sv=-Infinity; const hi=Math.min(n, j+Math.round(fs*0.12));
        for(let k=i;k<hi;k++){ const v=bp[k]; if(v>sv){ sv=v; sp=k; } }
        // Refractory sized by the LOCAL cadence. On a conflict the TALLER peak wins (unchanged) — and
        // that is what separates systole from its reflection: the diastolic wave is the smaller of the
        // two, so it loses the arbitration instead of being counted as an extra beat.
        const refr=cad ? Math.max(refrFloor, Math.round(REFR_CADENCE_FRAC*cad[sp])) : refrFloor;
        if(peaks.length===0 || sp-peaks[peaks.length-1]>=refr) peaks.push(sp);
        else if(bp[sp]>bp[peaks[peaks.length-1]]) peaks[peaks.length-1]=sp;
      }
      i=j;
    } else i++;
  }
  // nominal period (samples) from the DETECTED cadence — back-compat scalar for callers
  // + the first-foot lower bound. NOT used to gate detection any more.
  let T=Math.round(fs*0.85);
  if(peaks.length>2){ const dd=[]; for(let k=1;k<peaks.length;k++) dd.push(peaks[k]-peaks[k-1]); const md=median(dd); if(md>0) T=Math.round(md); }
  const feet=refineFeet(bp, peaks, T);
  return { peaks, feet, T };
}
// intersecting-tangent systolic foot per peak (PPI timing point). Extracted so BOTH
// the single-channel detectBeats and the 3-LED consensus (feet re-derived on the
// reference channel) share ONE implementation.
function refineFeet(bp, peaks, T){
  const feet=[];
  for(let k=0;k<peaks.length;k++){
    const p=peaks[k];
    const lo=k>0?peaks[k-1]:Math.max(0,p-T);
    let mi=p, mv=bp[p];
    for(let j=p; j>lo; j--){ if(bp[j]<mv){ mv=bp[j]; mi=j; } }
    let ms=mi, msv=-Infinity;
    for(let j=mi; j<p; j++){ const dv=bp[j+1]-bp[j]; if(dv>msv){ msv=dv; ms=j; } }
    let foot=mi;
    if(msv>1e-9){ const cross = ms - (bp[ms]-mv)/msv; foot = Math.max(lo, Math.min(p, cross)); }
    feet.push(foot);
  }
  return feet;
}
function negate(x){ const y=new Float32Array(x.length); for(let i=0;i<x.length;i++) y[i]=-x[i]; return y; }
// bandpass + orient + O(N) detect for ONE optical channel. PURE + self-contained
// (closes over nothing but the module's pure helpers) so the §2b Web-Worker pool can
// run it verbatim off its own .toString() — serial + worker paths are then byte-
// identical by construction. Returns the reference-usable band-passed waveform too.
function detectChannel(chan, fs){
  const bp0=bandpass(chan, fs, 0.5, 8.0);
  const sign=orient(bp0);
  const bp=sign===1?bp0:negate(bp0);
  const det=detectBeats(bp, fs);
  return { bp, sign, peaks:det.peaks, feet:det.feet, T:det.T };
}
// ════════════════════════════════════════════════════════════════════════
//  3-LED CONSENSUS (PPGDEX-BEAT-DETECTION-PERF §1/§5) — optical bSQI
//  The Polar Sense streams THREE co-located optical paths (ch0/ch1/ch2). Detect
//  independently on each (detectChannel), then keep a beat only where ≥ 2 of 3
//  channels place a systolic peak within ±50 ms — the optical analog of ECGDex's
//  two-detector agreement. A 1/3 beat is almost always motion / poor perfusion:
//  it is DROPPED (a gap), NEVER median-filled — median-fill fabricates regularity
//  and was a prime reason the old whole-record RMSSD read implausibly high. Feet are
//  re-derived on the reference channel so PPI stays foot-to-foot on the best waveform.
//    perChannel : [{ bp, peaks, feet }, …]  (1..3 channels)
//    refIdx     : reference channel index (best windowed SNR, §2)
//  → { peaks, feet, agree:[frac∈{2/3,3/3} per kept beat|null], clusters:[{s,nAgree}],
//      nDropped, kept33, kept22, singleChannel }
// ════════════════════════════════════════════════════════════════════════
function consensusBeats(perChannel, refIdx, fs){
  const nCh=perChannel.length;
  const refBp=perChannel[refIdx].bp;
  // single channel (companion LEDs unavailable) → no consensus possible: pass the
  // reference channel's own beats through, agreement unknown (null ⇒ ribbon hidden).
  if(nCh<2){
    const pk=perChannel[refIdx].peaks.slice();
    return { peaks:pk, feet:perChannel[refIdx].feet.slice(), agree:pk.map(()=>null),
             clusters:pk.map(s=>({ s, nAgree:1 })), nDropped:0, kept33:0, kept22:0, singleChannel:true };
  }
  const tol=Math.max(1, Math.round(0.05*fs));   // ±50 ms agreement window
  const ev=[];
  for(let c=0;c<nCh;c++){ const pks=perChannel[c].peaks; for(let k=0;k<pks.length;k++) ev.push({ s:pks[k], c }); }
  ev.sort((a,b)=>a.s-b.s);
  // cluster events within ±tol — one heartbeat's peaks across channels fall inside tol;
  // the next beat is ≥ refr(0.3 s) away, so a tol(50 ms) window cleanly splits heartbeats.
  const rawPeaks=[], rawAgree=[], clusters=[]; let nDropped=0, kept33=0, kept22=0;
  let i=0;
  while(i<ev.length){
    const chans={}; const ss=[]; let j=i;
    chans[ev[j].c]=1; ss.push(ev[j].s); j++;
    // CHAIN by gap: extend while consecutive events are within tol. One heartbeat's peaks
    // across channels form a chain ≤ tol wide; the next beat is ≥ refr(0.3 s) away, so a beat
    // whose 3 channel-peaks spread slightly (localisation noise) stays ONE cluster instead of
    // boundary-splitting into a spurious 1/3 drop.
    while(j<ev.length && ev[j].s-ev[j-1].s<=tol){ chans[ev[j].c]=1; ss.push(ev[j].s); j++; }
    const nAgree=Object.keys(chans).length;
    const cs=Math.round(median(ss));
    clusters.push({ s:cs, nAgree });
    if(nAgree>=2){ rawPeaks.push(cs); rawAgree.push(nAgree/nCh); if(nAgree>=3) kept33++; else kept22++; }
    else nDropped++;
    i=j;
  }
  // enforce refractory on the merged spine (a boundary split could double a beat)
  const refr=Math.round(fs*0.30); const peaks=[], agree=[];
  for(let k=0;k<rawPeaks.length;k++){
    if(peaks.length && rawPeaks[k]-peaks[peaks.length-1]<refr){
      if(refBp[rawPeaks[k]]>refBp[peaks[peaks.length-1]]){ peaks[peaks.length-1]=rawPeaks[k]; agree[agree.length-1]=rawAgree[k]; }
    } else { peaks.push(rawPeaks[k]); agree.push(rawAgree[k]); }
  }
  let T=Math.round(fs*0.85); if(peaks.length>2){ const dd=[]; for(let k=1;k<peaks.length;k++) dd.push(peaks[k]-peaks[k-1]); const md=median(dd); if(md>0) T=Math.round(md); }
  const feet=refineFeet(refBp, peaks, T);
  return { peaks, feet, agree, clusters, nDropped, kept33, kept22, singleChannel:false };
}
function movavg(x, w){ const y=new Float32Array(x.length); let s=0; for(let i=0;i<x.length;i++){ s+=x[i]; if(i>=w)s-=x[i-w]; y[i]=s/Math.min(i+1,w); } return y; }
function localMax(a,i0,i1){ let m=-Infinity; for(let i=i0;i<i1;i++) if(a[i]>m)m=a[i]; return m; }

// ════════════════════════════════════════════════════════════════════════
//  PER-BEAT SQI  — template correlation × amplitude × motion gate
// ════════════════════════════════════════════════════════════════════════
function beatSQI(bp, peaks, fs, motionAt, agree){
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
    // §5: fold the 3-LED consensus agreement as a multiplicative axis — a 2/3 beat is
    // down-weighted vs a 3/3 beat (1/3 beats were already dropped in consensus). A
    // single-channel session has agree[k]==null → no LED axis (unchanged, back-compat).
    if(agree && agree[k]!=null){ q *= (0.5 + 0.5*agree[k]); }   // 2/3→0.83×, 3/3→1.0×
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
// Foot-spine displacement margin, in PERCENTAGE POINTS of correctRR() correction rate. The peak spine
// replaces the (preferred) foot spine ONLY when it needs at least this much LESS Malik repair.
//
// Why the correction rate and not a "do the two medians agree" threshold: an agreement test detects
// only THAT the halves disagree, never WHICH one is right — and both directions occur in the real
// corpus (2026-06-30 needs peaks, 2026-06-15 needs feet, and both look like "disagreement"). An
// agreement cutoff therefore has to be wrong on one of them; a 0.90 cutoff duly regressed 2026-06-15
// (correct feet at 49.1 bpm → wrong peaks at 57.5). The correction rate is a PHYSIOLOGICAL arbiter
// instead: correctRR rejects impossible/outlier intervals, so a coherent beat series needs few repairs
// while a doubled/corrupted one needs many. Measured on the real trio corpus the separation is stark —
// the good half needs 1–29% correction, the corrupted half 43–98%.
//
// The MARGIN (not a bare `<`) protects clean records: there both spines need the SAME repair (3.6% vs
// 3.6%), and a hair's-width float difference must not flip the spine and churn the committed fixture.
// 10 pp is far below the observed corrupted-vs-good gap (≥ 35 pp) and far above clean-record noise (0 pp).
const PPI_SPINE_MARGIN_PP = 10;
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
function timeDomain(nn, cleanMask){
  if(nn.length<2) return null;
  const meanRR=mean(nn), sdnn=std(nn);            // dispersion: over ALL accepted NN (whole-record)
  // §4 (PPGDEX-BEAT-DETECTION-PERF): the beat-to-beat metrics (rMSSD/pNN50) are computed
  // over adjacent HIGH-SQI CLEAN pairs only, so sub-ectopy-threshold optical PAT jitter +
  // gap boundaries don't inflate them (the whole-record 137 ms → truth). The ectopy/gap
  // band (correctRR PPI_ECTOPY_THR) stays loose to avoid over-rejecting; this is the SEPARATE
  // robust jitter pass the brief asks for. No mask (epoch/back-compat) → all adjacent pairs.
  let sumSq=0,cnt=0,nn50=0;
  for(let i=1;i<nn.length;i++){
    if(cleanMask && !(cleanMask[i-1] && cleanMask[i])) continue;
    const d=nn[i]-nn[i-1]; sumSq+=d*d; cnt++; if(Math.abs(d)>50)nn50++;
  }
  if(cnt<1){ for(let i=1;i<nn.length;i++){ const d=nn[i]-nn[i-1]; sumSq+=d*d; cnt++; if(Math.abs(d)>50)nn50++; } }  // no clean pair → fall back
  const rmssd=Math.sqrt(sumSq/cnt), pnn50=100*nn50/cnt;
  const hr=60000/meanRR;
  // triangular index
  const bins={}; for(const v of nn){ const b=Math.round(v/7.8125); bins[b]=(bins[b]||0)+1; }
  let mx=0; for(const k in bins) if(bins[k]>mx)mx=bins[k];
  const triIdx = mx? nn.length/mx : null;
  return { meanRR:Math.round(meanRR), sdnn:r1(sdnn), rmssd:r1(rmssd), pnn50:r1(pnn50), hr:Math.round(hr), lnRMSSD:r2(Math.log(rmssd)), triIdx:triIdx?r1(triIdx):null };
}
function poincare(nn, cleanMask){
  if(nn.length<3) return null;
  // §4: SD1 (≈ short-term beat-to-beat) from the clean adjacent-pair successive
  // differences; SD2 keeps the whole-record SDNN identity. Mask absent → all pairs.
  const d=[]; for(let i=1;i<nn.length;i++){ if(cleanMask && !(cleanMask[i-1]&&cleanMask[i])) continue; d.push(nn[i]-nn[i-1]); }
  if(d.length<2){ d.length=0; for(let i=1;i<nn.length;i++) d.push(nn[i]-nn[i-1]); }   // fallback
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
function buildEpochs(nn, tt, motion, perfWindow, cleanMask, agreeI){
  const epochs=[]; if(nn.length<2) return epochs;
  const epLen=300; // sec
  const tEnd=tt[tt.length-1];
  for(let e0=0; e0<tEnd; e0+=epLen){
    const idx=[]; for(let i=0;i<tt.length;i++){ if(tt[i]>=e0 && tt[i]<e0+epLen) idx.push(i); }
    if(idx.length<5) continue;
    const seg=idx.map(i=>nn[i]);
    const segMask = cleanMask ? idx.map(i=>cleanMask[i]) : null;   // §4: per-epoch clean adjacency
    const td=timeDomain(seg, segMask); if(!td) continue;
    const ls=lombScargle(idx.map(i=>tt[i]), seg);
    const mi = motion&&motion.hasData ? r2(mean(idx.map(i=>motion.motionAtSec(tt[i])))) : null;
    const pi = perfWindow ? perfWindow(e0+epLen/2) : null;
    const post = (motion&&motion.postureDetailAtSec) ? motion.postureDetailAtSec(e0, e0+epLen) : null;
    const position = post ? post.position : 'unknown';
    // §5: mean 3-LED agreement across this epoch's beats (null when single-channel session)
    let ledAgreementPct=null;
    if(agreeI){ const av=idx.map(i=>agreeI[i]).filter(v=>v!=null); if(av.length) ledAgreementPct=Math.round(100*mean(av)); }
    epochs.push({ tMin:Math.round(e0/60), beats:idx.length, hr:td.hr, meanRR:td.meanRR, rmssd:td.rmssd, sdnn:td.sdnn,
      pnn50:td.pnn50, lf:ls?ls.lf:null, hf:ls?ls.hf:null, lfhf:ls?ls.lfhf:null, respRate:null, pi, motionIndex:mi,
      ledAgreementPct,
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
  P(45,'Ranking optical channels…');
  const sel=pickChannel(rec);
  const raw=rec.ch[sel.idx];

  // §1/§2b: detect on ALL channels (3-LED consensus). rec._preChannels lets the app hand
  // in results already computed in the Web-Worker pool — byte-identical to this serial path
  // (the workers run detectChannel's own source). compute()/tests never set it, so this
  // in-thread detect is the numeric source of truth the gates verify.
  P(55,'Optical beat detection · 3-LED (systolic feet)…');
  const perChannel = (rec._preChannels && rec._preChannels.length===rec.ch.length)
    ? rec._preChannels
    : rec.ch.map(c=>detectChannel(c, rec.fs));
  const bp = perChannel[sel.idx].bp;                 // reference-channel band-passed waveform
  const cons = consensusBeats(perChannel, sel.idx, rec.fs);
  const det = { peaks:cons.peaks, feet:cons.feet, T:0 };

  P(62,'Motion gate (ACC + GYRO)…');
  const motion=analyzeMotion(rec.acc, rec.gyro, rec.t0Ms, rec.durSec, rec.magn);
  const motionAt = motion.hasData ? (samp=>motion.motionAtSec(rec.relSec[Math.max(0,Math.min(rec.n-1,Math.round(samp)))])) : null;

  P(68,'Per-beat SQI (× 3-LED agreement)…');
  const sqi=beatSQI(bp, det.peaks, rec.fs, motionAt, cons.agree);

  // foot times (sec, absolute rel) — interpolate relSec at fractional foot index
  const footSec=det.feet.map(f=>{ const i0=Math.floor(f), i1=Math.min(rec.n-1,i0+1), fr=f-i0;
    return rec.relSec[i0]*(1-fr)+rec.relSec[i1]*fr; });
  const peakSec=det.peaks.map(p=>rec.relSec[Math.max(0,Math.min(rec.n-1,p))]);

  P(74,'PPI + HRV…');
  // ── PPI SPINE — foot-to-foot by default, 3-LED-VOTED peak-to-peak as the fallback ──────────
  // Foot-to-foot is the PREFERRED interval (systolic feet are amplitude-invariant, so PPI does not
  // ride pulse-amplitude drift) and stays the default. But the two halves of a beat are NOT equally
  // trustworthy: `cons.peaks` is the 3-LED CONSENSUS spine (a beat survives only where ≥2 of 3
  // channels agree within ±50 ms — reference-INDEPENDENT), while `cons.feet` is `refineFeet(refBp…)`
  // re-derived on the SINGLE reference channel that pickChannel scored highest. pickChannel ranks by
  // pulse-band SNR (0.7–3.0 Hz) over ONE 90 s mid-record window — and a channel counting HARMONICS
  // still lands in that band (a doubled 48 bpm = 96 bpm = 1.6 Hz), so a corrupted LED can be chosen
  // as the reference. When that happens the vote's robustness is thrown away exactly where it counts:
  // the peak spine stays correct while the feet collapse, and foot-to-foot PPI reads 2–3× the true HR.
  // Observed on the real trio corpus (2026-06-30): consensus peaks → 50.6 bpm (chest ECG: 50.0) while
  // every reference channel's feet → 80–132 bpm.
  // So: measure BOTH off the same spine and cross-check. Agreement ⇒ keep feet (clean records are
  // byte-identical to before — no fixture churn). Disagreement ⇒ the SINGLE-channel half is the
  // unreliable one; fall back to the VOTED peak spine. `ppiAgreementPct` is surfaced either way, so a
  // record where BOTH halves are broken (all 3 LEDs mis-detecting) is visibly flagged rather than
  // silently shipping a plausible-looking wrong HR.
  // Build BOTH spines off the same consensus beats, Malik-correct each, and let the CORRECTION RATE
  // arbitrate (see PPI_SPINE_MARGIN_PP): the spine that needs less repair is the physiologically
  // coherent one. Feet stay the default and are displaced only by a clear margin, so a clean record —
  // where both halves need identical repair — keeps its foot spine and its export stays byte-identical.
  // `ppiAgreementPct` is reported alongside: it does not DECIDE the spine, but a low value means the two
  // halves disagree, and when the WINNING spine still needs heavy correction the optical HR is not
  // trustworthy at all (both halves broken — all 3 LEDs mis-detecting). That is the honest flag.
  const _ppiFoot=buildPPI(footSec), _ppiPeak=buildPPI(peakSec);
  const _corrFoot=correctRR(_ppiFoot.rr, _ppiFoot.tt), _corrPeak=correctRR(_ppiPeak.rr, _ppiPeak.tt);
  const _rateFoot=_ppiFoot.rr.length ? 100*_corrFoot.nCorr/_ppiFoot.rr.length : 100;
  const _ratePeak=_ppiPeak.rr.length ? 100*_corrPeak.nCorr/_ppiPeak.rr.length : 100;
  const footSpineOK=!(_ratePeak < _rateFoot - PPI_SPINE_MARGIN_PP);
  const _mFoot=median(_corrFoot.nn), _mPeak=median(_corrPeak.nn);
  const ppiAgreement=(_mFoot>0 && _mPeak>0) ? Math.min(_mFoot,_mPeak)/Math.max(_mFoot,_mPeak) : 0;
  const ppiSpine=footSpineOK ? 'foot' : 'peak';
  const { rr, tt }=footSpineOK ? _ppiFoot : _ppiPeak;
  const corr=footSpineOK ? _corrFoot : _corrPeak;
  const nn=corr.nn;
  // §4: per-interval CLEAN-adjacency mask — interval i (between beat i & i+1) is clean when it
  // was NOT correction-flagged AND both endpoint beats cleared SQI≥0.5 (SQI folds the 3-LED
  // agreement, §5). rMSSD/pNN50/SD1 are computed over clean adjacent pairs so sub-ectopy optical
  // jitter + gap boundaries can't inflate them; SDNN stays whole-record dispersion.
  const cleanMask=new Array(nn.length);
  for(let i=0;i<nn.length;i++){
    const q0=(sqi[i]!=null?sqi[i]:1), q1=(sqi[i+1]!=null?sqi[i+1]:1);
    cleanMask[i] = (corr.flags[i]===0) && q0>=0.5 && q1>=0.5;
  }
  // §5: per-interval mean LED agreement (null when single-channel) for the per-epoch ribbon
  const agreeI = cons.singleChannel ? null : new Array(nn.length);
  if(agreeI){ for(let i=0;i<nn.length;i++){ const a0=cons.agree[i], a1=cons.agree[i+1]; agreeI[i]=(a0!=null&&a1!=null)?(a0+a1)/2:(a0!=null?a0:(a1!=null?a1:null)); } }
  const td=timeDomain(nn, cleanMask)||{};
  const poin=poincare(nn, cleanMask);
  const freq=lombScargle(corr.tt, nn);
  const dfa1=dfaAlpha1(nn);
  const se=sampEn(nn);

  // perfusion index over windows (AC/DC) for epochs/morph hand-off
  const dc=mean(Array.from(raw).map(Math.abs));
  const acAmp=std(bp);
  const perfWindow=()=> dc>0 ? r2(100*acAmp/dc) : null;

  P(80,'Epochs…');
  const epochs=buildEpochs(nn, corr.tt, motion, perfWindow, cleanMask, agreeI);

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

  // ── Segment-wise SDNN (SDNN-VS-ECG-GROUND-TRUTH, validated on the 2026-07-07 paired night) ──
  // Whole-record SDNN folds in SDANN (drift BETWEEN 5-min means) + a few motion/artifact epochs,
  // which optical baseline-wander/PTT inflates most → +26% vs chest ECG. Segment-wise aggregation
  // removes both: sdnnIndex (mean per-5-min SDNN, Task-Force) → +18%; the QUALITY-GATED MEDIAN of
  // per-5-min SDNN → +3.5% vs ECG truth. These are additive; whole-record `sdnn` is unchanged.
  // Same gate extends to the long-term-dominated metrics that inherit the SDANN inflation:
  // SD2 (whole +54% → robust +4%), LF/HF band power (whole totalPower +89% → gated-median LF+HF +7%).
  // VLF is deliberately NOT robust-corrected — a 5-min epoch can't resolve <0.04 Hz — it stays
  // flagged. Residual HF (+17%) is genuine respiratory PTT — but its excess is MOTION-DRIVEN
  // (+43% high-motion vs +12% low-motion on the paired night), so a low-motion HF + a GRADED
  // per-metric confidence (below) turn the blanket flag into an earned, continuous score.
  let sdnnIndex=null, sdnnRobust=null, sdnnRobustNEpochs=0, sd2Robust=null, lfRobust=null, hfRobust=null, lfhfRobust=null, hfRobustLowMotion=null, hrvConfidence=null;
  if(epochs.length){
    const segAll = epochs.map(e=>e.sdnn).filter(v=>v!=null && isFinite(v));
    if(segAll.length){
      sdnnIndex = r1(mean(segAll));
      // quality gate: keep epochs that are low-motion AND (single-channel OR ≥2/3 LED agreement).
      // A gated set of <3 epochs is unreliable → fall back to the ungated segment median.
      const gatedEp = epochs.filter(e=> e.sdnn!=null && isFinite(e.sdnn)
        && (e.motionIndex==null || e.motionIndex<=0.5)
        && (e.ledAgreementPct==null || e.ledAgreementPct>=67) );
      const usable = gatedEp.length>=3 ? gatedEp : epochs.filter(e=>e.sdnn!=null&&isFinite(e.sdnn));
      const pool = usable.map(e=>e.sdnn);
      sdnnRobust = r1(median(pool));
      sdnnRobustNEpochs = pool.length;
      // SD2 from the robust dispersion + whole-record clean SD1 (beat-to-beat, already un-inflated)
      const sd1 = poin ? poin.sd1 : null;
      if(sd1!=null && sdnnRobust!=null) sd2Robust = r1(Math.sqrt(Math.max(0, 2*sdnnRobust*sdnnRobust - sd1*sd1)));
      // robust frequency = gated-median of per-epoch bands (per-epoch spectrum drops the SDANN/VLF drift)
      const lfA=usable.map(e=>e.lf).filter(v=>v!=null&&isFinite(v));
      const hfA=usable.map(e=>e.hf).filter(v=>v!=null&&isFinite(v));
      const lhA=usable.map(e=>e.lfhf).filter(v=>v!=null&&isFinite(v));
      if(lfA.length>=3) lfRobust=r1(median(lfA));
      if(hfA.length>=3) hfRobust=r1(median(hfA));
      if(lhA.length>=3) lfhfRobust=r2(median(lhA));
    }
    // (a) MOTION-GATED HF — HF excess is motion-driven, so a low-motion-only median approaches the
    // clean floor (~+12% vs ECG) rather than the mixed +17%. Stricter gate than the shared 0.5.
    const MOT_STRICT=0.15;
    const lowMot = epochs.filter(e=> e.motionIndex==null || e.motionIndex<=MOT_STRICT);
    const hfLM = lowMot.map(e=>e.hf).filter(v=>v!=null&&isFinite(v));
    if(hfLM.length>=3) hfRobustLowMotion=r1(median(hfLM));
    // (b) GRADED per-metric confidence (0..1) from measured drivers — replaces the binary flag.
    // Each metric family is scored by the cause that predicts ITS error (validated on paired night):
    // motion→hf, posture/baseline drift→vlf/sdnn, coverage+correction→beat-to-beat.
    const qCov = Math.max(0, Math.min(1, analyzablePct/100));
    const qCorr = Math.max(0, 1 - correctionRate/25);
    const qLowMotion = epochs.length ? lowMot.length/epochs.length : 0;
    let posShift=0; for(let i=1;i<epochs.length;i++){ if(epochs[i].position!==epochs[i-1].position) posShift++; }
    const qPosture = epochs.length>1 ? 1 - posShift/(epochs.length-1) : 1;
    const durFactor = Math.max(0, Math.min(1, (rec.durSec/60)/60)); // VLF needs a long record
    const c=v=>r2(Math.max(0, Math.min(1, v)));
    hrvConfidence = {
      beatToBeat: c(qCov*qCorr),                          // rmssd, sd1, pnn50 — already ECG-accurate
      sdnn:       c(qCov*qCorr*(0.6+0.4*qPosture)),        // + sd2 (robust); posture-drift aware
      lf:         c(qCov*qCorr),
      hf:         c(qLowMotion*qCov),                      // motion-graded (the earned part)
      vlf:        c(Math.min(0.7, qPosture*durFactor)),    // capped: single-site optical VLF inherently baseline-limited
      drivers:{ analyzableFrac:r2(qCov), correctionOK:r2(qCorr), lowMotionFrac:r2(qLowMotion), postureStableFrac:r2(qPosture) },
      note:'0..1 per-metric confidence from measured drivers (motion\u2192hf, posture/baseline\u2192vlf/sdnn, coverage+correction\u2192beat-to-beat). vlf capped 0.7 — single-site optical VLF stays baseline-wander-limited even when clean; not a defect to "fix".'
    };
  }

  // §5: whole-record 3-LED agreement + the per-5-min ribbon series (all clusters incl dropped 1/3)
  let ledAgreementPct=null, ledAgree3of3Pct=null, ledSeries=null;
  if(!cons.singleChannel){
    const kept=cons.agree.filter(a=>a!=null);
    ledAgreementPct = kept.length ? Math.round(100*mean(kept)) : null;
    ledAgree3of3Pct = (cons.kept33+cons.kept22)>0 ? Math.round(100*cons.kept33/(cons.kept33+cons.kept22)) : null;
    const epLen=300, bins={}, relOf=s=>rec.relSec[Math.max(0,Math.min(rec.n-1,Math.round(s)))];
    cons.clusters.forEach(c=>{ const e=Math.floor(relOf(c.s)/epLen); if(!bins[e]) bins[e]={c1:0,c2:0,c3:0};
      if(c.nAgree>=3)bins[e].c3++; else if(c.nAgree===2)bins[e].c2++; else bins[e].c1++; });
    ledSeries=Object.keys(bins).map(e=>{ const b=bins[e], tot=(b.c1+b.c2+b.c3)||1;
      return { tMin:(+e)*5, f3:r2(b.c3/tot), f2:r2(b.c2/tot), f1:r2(b.c1/tot), n:tot }; }).sort((a,b)=>a.tMin-b.tMin);
  }
  // §3: coverage/SQI gate — a sparse / heavily-corrected record must not publish an
  // unqualified whole-record short-term HRV (it would feed the Integrator consensus axis a
  // jitter-inflated number). Keep the values but STAMP low-confidence + reason (option b),
  // applied consistently to hrv.time/poincare/frequency in the exports. Inert on good data.
  const hrvLowConfidence = (analyzablePct<60 || correctionRate>20);
  const hrvLowConfidenceReason = hrvLowConfidence
    ? ('low coverage — analyzable '+analyzablePct+'% / correction '+correctionRate+'% → whole-record short-term HRV down-weighted; use per-5-min epochs[] + ledAgreementPct')
    : null;

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
    sdnnIndex, sdnnRobust, sdnnRobustNEpochs, sd2Robust, lfRobust, hfRobust, lfhfRobust, hfRobustLowMotion, hrvConfidence,
    nn, tt:corr.tt, poincareNN:nn, sd1:poin?poin.sd1:null, sd2:poin?poin.sd2:null, sd1sd2:poin?poin.sd1sd2:null, ellArea:poin?poin.ellArea:null,
    freq, dfa1, sampen:se,
    epochs,
    meanSQI, cleanBeatPct, analyzablePct, coveragePct:cleanBeatPct, correctionRate, nCorrected:corr.nCorr,
    // PPI-spine cross-check (see the PPI SPINE note in analyze()). Export BOTH spines' correction rates,
    // not just the winner's: the loser's rate is the most discriminating number the node has, and a
    // consumer that throws it away cannot re-derive it. `correctionRate` above is the WINNING spine's.
    //   ppiSpine            'foot' (default) | 'peak' (single-channel feet displaced by the voted spine)
    //   ppiAgreementPct     how closely the two corrected medians agree (100 = the halves concur)
    //   ppiCorrFootPct      correctRR repair rate on the foot spine   ┐ the arbiter's own evidence —
    //   ppiCorrPeakPct      correctRR repair rate on the peak spine   ┘ a coherent series needs few
    // NOTE the WINNING rate alone does NOT cleanly separate good records from bad (2026-06-25 is
    // CORRECT at 28.8% while 2026-06-29 is WRONG at 30.5% — they overlap), so do not gate on it in
    // isolation. The decisive test is CROSS-NODE: compare this HR against a paired chest-ECG corner
    // (Integrator / ECGDex). On the real trio corpus that ratio is 0.99–1.01 on good nights vs 1.6–2.9
    // on records where all 3 LEDs mis-detect — bimodal, with nothing in between. These four fields are
    // what let that consumer make the call with evidence instead of a guess.
    ppiSpine, ppiAgreementPct: Math.round(100*ppiAgreement),
    ppiCorrFootPct: r1(_rateFoot), ppiCorrPeakPct: r1(_ratePeak),
    ledAgreementPct, ledAgree3of3Pct, ledSeries, ledSingleChannel:cons.singleChannel, nDroppedBeats:cons.nDropped,
    hrvLowConfidence, hrvLowConfidenceReason,
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

// ════════════════════════════════════════════════════════════════════════
//  §2b — WEB-WORKER per-channel detection pool (SCHEDULING optimisation ONLY)
//  The three LEDs are independent until the consensus merge, so bandpass+orient+
//  detect on ch0/ch1/ch2 run concurrently in a small pool (one Worker per channel,
//  ≤3), each channel transferred via a transferable ArrayBuffer (no copy). The
//  worker runs detectChannel's OWN source (+ its pure deps) rebuilt from
//  Function.toString(), so the result is BYTE-IDENTICAL to the serial detectChannel
//  path — workers change WHEN the work runs, never WHAT it computes. 100% offline:
//  the worker is a blob: URL minted from an INLINED source string (no external
//  script, honours the no-CDN rule). analyze()/compute() stay SYNCHRONOUS + serial
//  (the gated numeric truth); only the live APP awaits this, stashes rec._preChannels,
//  then calls the same analyze(). ANY Worker failure/absence (the headless test/equiv
//  path) → resolve via the serial detectChannel path → identical numbers.
// ════════════════════════════════════════════════════════════════════════
var _ppgWorkerURL=null, _ppgWorkerTriedURL=false;
function _buildWorkerURL(){
  if(_ppgWorkerTriedURL) return _ppgWorkerURL;
  _ppgWorkerTriedURL=true;
  if(typeof Blob==='undefined' || typeof URL==='undefined' || !URL.createObjectURL) return null;
  // ONE source of truth: the worker re-declares the SAME pure functions from their own
  // .toString() — no algorithm is duplicated as a string literal, so it can't drift.
  var deps=[biquad,applyBiquad,reverse,filtfilt,bandpass,mean,std,median,movavg,orient,negate,refineFeet,detectBeats,detectChannel];
  var src = deps.map(function(f){ return f.toString(); }).join('\n')
    + '\nself.onmessage=function(e){var d=e.data;var chan=new Float32Array(d.buf);'
    + 'var r=detectChannel(chan,d.fs);'
    + 'self.postMessage({idx:d.idx,peaks:r.peaks,feet:r.feet,sign:r.sign,T:r.T,bp:r.bp.buffer},[r.bp.buffer]);};';
  try{ _ppgWorkerURL=URL.createObjectURL(new Blob([src],{type:'text/javascript'})); }catch(e){ _ppgWorkerURL=null; }
  return _ppgWorkerURL;
}
function _detectSerial(rec){ return rec.ch.map(function(c){ return detectChannel(c, rec.fs); }); }
function detectChannelsAsync(rec){
  return new Promise(function(resolve){
    var chans=rec.ch, nCh=chans.length;
    var url = (typeof Worker!=='undefined') ? _buildWorkerURL() : null;
    if(!url || !nCh){ resolve(_detectSerial(rec)); return; }
    var out=new Array(nCh), done=0, settled=false, workers=[];
    function serialFallback(){ if(settled) return; settled=true; workers.forEach(function(w){ try{ w.terminate(); }catch(e){} }); resolve(_detectSerial(rec)); }
    try{
      for(var c=0;c<nCh;c++){
        (function(ci){
          var w=new Worker(url); workers.push(w);
          w.onmessage=function(e){ var m=e.data; out[m.idx]={ bp:new Float32Array(m.bp), sign:m.sign, peaks:m.peaks, feet:m.feet, T:m.T };
            try{ w.terminate(); }catch(_){} if(++done===nCh && !settled){ settled=true; resolve(out); } };
          w.onerror=function(){ serialFallback(); };
          var buf=new Float32Array(chans[ci]).buffer;   // COPY → transfer (leaves rec.ch intact for the serial raw/dc path)
          w.postMessage({ idx:ci, buf:buf, fs:rec.fs }, [buf]);
        })(c);
      }
    }catch(e){ serialFallback(); }
    setTimeout(function(){ if(!settled) serialFallback(); }, 20000);   // stall guard
  });
}

global.PPGDSP = {
  parsePPG, parseSensorXYZ, parseDevicePPI, analyze, analyzeMotion, validatePPI,
  bandpass, detectBeats, detectChannel, consensusBeats, refineFeet, detectChannelsAsync,
  buildPPI, correctRR, timeDomain, poincare, lombScargle, dfaAlpha1,
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
    // DEEP-AUDIT-2026-07-11 §16: NORMALIZE the stamp to the contract shape {version, hash}. Passing
    // opts.kernel through raw exported the DexKernel object itself ({K, VERSION, HASH}), and the
    // Integrator reads the lowercase keys — so this node always audited as kernel 'missing'.
    kernel: (opts.kernel ? { version: (opts.kernel.version != null ? opts.kernel.version : opts.kernel.VERSION) || null, hash: (opts.kernel.hash != null ? opts.kernel.hash : opts.kernel.HASH) || null } : null),
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
    out.quality = { analyzablePct:nz(r.analyzablePct), cleanBeatPct:nz(r.cleanBeatPct), coveragePct:nz(r.coveragePct), motionRejectedPct:nz(r.motionRejectedPct), correctionRatePct:nz(r.correctionRate), ledAgreementPct:nz(r.ledAgreementPct), ppiSpine:(r.ppiSpine||null), ppiAgreementPct:nz(r.ppiAgreementPct), ppiCorrFootPct:nz(r.ppiCorrFootPct), ppiCorrPeakPct:nz(r.ppiCorrPeakPct) };
    out.hrv = {
      time:{ meanRR:nz(r.meanRR), hr:nz(r.dispHr), sdnn:nz(r.sdnn), rmssd:nz(r.rmssd), pnn50:nz(r.pnn50),
        sdnnIndex:nz(r.sdnnIndex), sdnnRobust:nz(r.sdnnRobust), sd2Robust:nz(r.sd2Robust),
        window:'wholeRecord', units:'ms', lowConfidence:!!r.hrvLowConfidence, lowConfidenceReason:(r.hrvLowConfidenceReason||null),
        windowNote:'sdnn/rmssd are whole-record (single-site PPG); per-5-min values live in epochs[]. Directly comparable to another node\u2019s wholeRecord SDNN/RMSSD.',
        sdnnNote:'whole-record sdnn runs high on optical (SDANN/baseline-wander inflation, ~+26% vs chest ECG). sdnnIndex = mean of per-5-min SDNN (~+18%); sdnnRobust = quality-gated MEDIAN of per-5-min SDNN (~+3.5% vs ECG truth) — use sdnnRobust for cross-node SDNN comparison.' },
      frequency:{ lf:nz(fq.lf), hf:nz(fq.hf), lfhf:nz(fq.lfhf), method:'Lomb-Scargle', lowConfidence:!!r.hrvLowConfidence, lfRobust:nz(r.lfRobust), hfRobust:nz(r.hfRobust), lfhfRobust:nz(r.lfhfRobust), hfRobustLowMotion:nz(r.hfRobustLowMotion) },
      confidence:(r.hrvConfidence||null)
    };
    out.timeseries = {
      doc:'5-min epochs — primary cross-node feed (posture rides on epochs[].position).',
      epochs:(r.epochs||[]).map(function(e){ return { tMin:e.tMin, hr:nz(e.hr), rmssd:nz(e.rmssd), sdnn:nz(e.sdnn), lfhf:nz(e.lfhf),
        motionIndex:nz(e.motionIndex), ledAgreementPct:nz(e.ledAgreementPct), position:(e.position||'unknown'), positionConf:nz(e.positionConf), headingDeg:nz(e.headingDeg), magInterference:!!e.magInterference }; })
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
// ═══ SELF-INGEST — reload PpgDex's OWN ganglior.node-export as a review-mode clinical VIEW
// (SELF-INGEST-FOLLOWUPS · PpgDex pass, EXPORT-INERT). PpgDex already emits a RICH node-export
// (buildV2/exportSummary: recording + hrv{time,frequency,nonlinear} + personalization + apnea) AND a
// light one (exportGanglior). This reader accepts EITHER, single or a sessions[] multi wrapper, and
// returns whatever derived layer is present VERBATIM. PURE + DOM-FREE; never recomputes, never re-stamps. ═══
function ppgLoadOwnExport(json){
  if(!(json && json.schema && json.schema.name === 'ganglior.node-export'))
    return { ok:false, reason:'not-node-export', message:'Not a node-export \u2014 drop a raw Polar Verity *_PPG.txt, or PpgDex\u2019s own .json export.' };
  var node = ((json.schema.node || '') + '').trim();
  if(node !== 'PpgDex')
    return { ok:false, reason:'foreign-node', node:node,
      message:'This is a '+(node||'non-PpgDex')+' export \u2014 open it in '+(node||'its own node')+', or drop it into the Integrator to fuse.' };
  var carrier = Array.isArray(json.sessions) ? json.sessions : [json];
  var elements = carrier.map(function(el){ var e=JSON.parse(JSON.stringify(el)); e._fromExport=true; e._reviewMode=true; return e; });
  var evAll = Array.isArray(json.ganglior_events) ? json.ganglior_events.slice() : [];
  if(!evAll.length) carrier.forEach(function(el){ if(Array.isArray(el.ganglior_events)) evAll = evAll.concat(el.ganglior_events); });
  evAll.sort(function(a,b){ return ((a&&a.tMs)||0) - ((b&&b.tMs)||0); });
  return {
    ok:true, reviewMode:true, node:node,
    elements:elements, events:evAll,
    provenance:(json.schema && json.schema.provenance) || null,
    generated:(json.schema && json.schema.generated) || null,
    derivedFrom:(json.schema && json.schema.derivedFrom) || null,
    kernel:json.kernel || null,
    recording:(carrier[0] && carrier[0].recording) || json.recording || null,
    hrv:(carrier[0] && carrier[0].hrv) || json.hrv || null,
    quality:(carrier[0] && carrier[0].quality) || json.quality || null,
    personalization:(carrier[0] && carrier[0].personalization) || json.personalization || null,
    crossNight:json.crossNight || null,
    scrubbed:!!(json.schema && json.schema.scrubbed),
    multiNight:elements.length > 1, raw:json
  };
}

global.PpgDex = global.PpgDex || { compute:compute, parsePPG:parsePPG, analyze:analyze,
  buildNodeExport:ppgBuildNodeExport, _build:ppgBuildNodeExport };
global.PpgDex.loadOwnExport = ppgLoadOwnExport;   // SELF-INGEST reload (review-mode clinical view)
// scrub-for-sharing → the SHARED dexScrubExport (D1); lazy delegate, co-load order irrelevant.
global.PpgDex.scrubExport = function(env){
  if(global.DexExport && typeof global.DexExport.scrubExport === 'function') return global.DexExport.scrubExport(env);
  if(typeof global.dexScrubExport === 'function') return global.dexScrubExport(env);
  return env;
};

})(window);
