/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   ECGDex · DSP ENGINE  (ecgdex-dsp.js)
   ────────────────────────────────────────────────────────────────────────
   One signal in: raw ECG (µV @ 130 Hz). Everything is computed from it.
     · synthetic overnight ECG generator (demo, with ground-truth RR)
     · 5–15 Hz band-pass → Pan-Tompkins R-peak detection
     · sub-sample R-peak refinement (parabolic vertex on band-passed signal)
     · per-beat SQI gate (flatline · kurtosis · two-detector agreement · RR plausibility)
     · NN interpolation, % analyzable night, correction rate
     · full HRV suite (time · Poincaré · Lomb–Scargle freq · DFA · SampEn · fragmentation)
     · 5-min epoch engine + aggregation
     · CVHR (cyclic variation of HR — apnea autonomic signature)
     · EDR (ECG-derived respiration) via R-peak amplitude modulation
     · cardiorespiratory sleep staging (HRV + EDR)
     · Ganglior event emission (conf = SQI)
   No external libraries. Exposes a single global: window.ECGDSP
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';

// ─── tiny math ───────────────────────────────────────────────────────────────
const mean = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; };
const std  = a => { if (a.length < 2) return 0; const m = mean(a); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i]-m)*(a[i]-m); return Math.sqrt(s/(a.length-1)); }; // sample SD (÷N−1) — HRV Task Force / Kubios convention, unified fleet-wide 2026-06-24
const rmssd = a => { let s = 0, n = 0; for (let i = 1; i < a.length; i++){ const d = a[i]-a[i-1]; s += d*d; n++; } return n ? Math.sqrt(s/n) : 0; };

/* ════ CANONICAL CLOCK · CLOCK-UNIFY (duplicated locally per app — Clock Contract §2) ═══════════
   tMs = floating wall-clock ms: the recording's LOCAL civil time encoded as if it were UTC.
   ALWAYS read back via getUTC* getters. Viewer-timezone-independent.
   parseTimestamp(raw,opts) → { tMs, offsetMin } | null. Mirrors the other nodes byte-for-byte so
   ECGDex's stamp handling cannot silently diverge (WP-G truth table). ECGDex's hot ingest path
   (Polar Sensor Logger `timestamp [ms]` epoch column) uses the inline parseTSfloat fast-path, but
   this full mirror is the contract-faithful reference + the public ECGDSP.parseTimestamp export. */
function tzOffset(instantMs){ return new Date(instantMs).getTimezoneOffset()*60000; }
function _ckP2(n){ return n<10?'0'+n:''+n; }
function _ckNumEpoch(n){
  if(!isFinite(n)) return null;
  if(n < 1e11) n = n*1000;                       // 10-digit (or smaller) → seconds → ms
  if(n < 1e11 || n > 4e12) return null;          // implausible epoch range
  var off = tzOffset(n);
  return { tMs: n - off, offsetMin: -off/60000 };
}
function _ckZoneMin(z){ var zs=z.replace(':',''); var sign=zs[0]==='-'?-1:1;
  return sign*(parseInt(zs.slice(1,3),10)*60 + parseInt(zs.slice(3,5),10)); }
function _ckDMY(a,b,preferDMY){
  if(a>12) return {d:a,mo:b};
  if(b>12) return {d:b,mo:a};
  return preferDMY ? {d:a,mo:b} : {d:b,mo:a};
}
function parseTimestamp(raw, opts){
  opts = opts || {};
  var preferDMY = opts.preferDMY !== false;
  var anchor = (opts.dateAnchorMs != null && isFinite(opts.dateAnchorMs)) ? opts.dateAnchorMs : null;
  if(raw == null) return null;
  if(typeof raw === 'number') return _ckNumEpoch(raw);
  var s = String(raw).trim().replace(/^["']|["']$/g,'');
  if(!s) return null;
  var m;
  if(/^\d{10,13}$/.test(s)) return _ckNumEpoch(parseInt(s,10));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?\s*(Z|[+-]\d{2}:?\d{2})$/);
  if(m){ var off=(m[8]==='Z')?0:_ckZoneMin(m[8]);
    return { tMs: Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],m[6]?+m[6]:0, m[7]?+((m[7]+'00').slice(0,3)):0), offsetMin: off }; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?$/);
  if(m) return { tMs: Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],m[6]?+m[6]:0, m[7]?+((m[7]+'00').slice(0,3)):0), offsetMin: null };
  m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m){ var dm=_ckDMY(+m[4],+m[5],preferDMY);
    return { tMs: Date.UTC(+m[6],dm.mo-1,dm.d,+m[1],+m[2],+m[3]), offsetMin: null }; }
  m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if(m) return { tMs: Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]), offsetMin: null };
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(m){ var dm2=_ckDMY(+m[1],+m[2],preferDMY);
    return { tMs: Date.UTC(+m[3],dm2.mo-1,dm2.d,+m[4],+m[5],m[6]?+m[6]:0), offsetMin: null }; }
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(m) return { tMs: Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],m[6]?+m[6]:0), offsetMin: null };
  m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(m){
    if(anchor == null) return null;
    var d0 = new Date(anchor);
    var t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate(), +m[1],+m[2], m[3]?+m[3]:0);
    if(opts.prevTMs != null && isFinite(opts.prevTMs)){ while(t < opts.prevTMs) t += 86400000; }
    return { tMs: t, offsetMin: null };
  }
  return null;   // NEVER now() — a missing stamp stays visible (null)
}
const pnn50 = a => { let n = 0; for (let i = 1; i < a.length; i++) if (Math.abs(a[i]-a[i-1]) > 50) n++; return a.length>1 ? n/(a.length-1)*100 : 0; };
const nn50c = a => { let n = 0; for (let i = 1; i < a.length; i++) if (Math.abs(a[i]-a[i-1]) > 50) n++; return n; };
const median = a => { if (!a.length) return 0; const s = [...a].sort((x,y)=>x-y), n = s.length; return n%2 ? s[(n-1)/2] : (s[n/2-1]+s[n/2])/2; };
const quant = (a,q) => { if(!a.length) return 0; const s=[...a].sort((x,y)=>x-y),i=(s.length-1)*q,l=Math.floor(i),h=Math.ceil(i); return s[l]+(s[h]-s[l])*(i-l); };
const arrMin = a => { let m = Infinity; for (let i=0;i<a.length;i++) if(a[i]<m) m=a[i]; return m; };
const arrMax = a => { let m = -Infinity; for (let i=0;i<a.length;i++) if(a[i]>m) m=a[i]; return m; };
const modeV = a => { const f={}; a.forEach(v=>{const k=Math.round(v/5)*5;f[k]=(f[k]||0)+1;}); return +Object.entries(f).sort((x,y)=>y[1]-x[1])[0][0]; };
const amo50 = (a,mo) => a.filter(v=>Math.abs(v-mo)<=25).length/a.length*100;
const sd1 = r => r/Math.sqrt(2);
const sd2 = (s,r) => Math.sqrt(Math.max(0, 2*s*s - r*r/2));
// Geometric Poincaré: SD1/SD2 computed directly from the rotated coordinates of the
// SAME NN array that gets plotted — guarantees the ellipse matches the scatter cloud.
// SD1 = SDSD/√2 (short axis, beat-to-beat), SD2 = √(2·SDNN² − SD1²) (long axis).
function poincareGeo(nn){
  const n = nn.length; if (n < 3) return { sd1:0, sd2:0 };
  let ds=0, dc=0;
  for (let i=1;i<n;i++){ ds += (nn[i]-nn[i-1]); dc++; }
  const dmean = ds/dc;
  let dvar=0; for (let i=1;i<n;i++){ const d = (nn[i]-nn[i-1]) - dmean; dvar += d*d; }
  const sdsd = Math.sqrt(dvar/dc);
  const s1 = sdsd/Math.sqrt(2);
  const sdnnv = std(nn);
  const s2 = Math.sqrt(Math.max(0, 2*sdnnv*sdnnv - s1*s1));
  return { sd1:s1, sd2:s2 };
}

function linfit(x,y){
  const n=x.length, mx=mean(x), my=mean(y); let num=0, den=0;
  for(let i=0;i<n;i++){ num+=(x[i]-mx)*(y[i]-my); den+=(x[i]-mx)*(x[i]-mx); }
  const slope = den ? num/den : 0;
  return { slope, intercept: my - slope*mx };
}

// ════════════════════════════════════════════════════════════════════════
//  SYNTHETIC OVERNIGHT ECG  — builds a ground-truth RR series with realistic
//  HRV / sleep architecture / CVHR apnea clusters, then renders PQRST morphology
//  into a µV Int16Array. Returns the ECG plus the ground-truth (device-equivalent)
//  RR so the self-RR validation has something to compare against.
// ════════════════════════════════════════════════════════════════════════
function genSynthetic(opts){
  opts = opts || {};
  const fs = opts.fs || 130;
  const durSec = opts.durSec || 3*3600;          // ~3 h compressed overnight by default
  const ambulatory = (opts.scenario==='ambulatory' || opts.ambulatory===true);
  const seedRef = { s: (opts.seed||20260601) >>> 0 };
  const rnd = () => { // xorshift32
    let x = seedRef.s; x ^= x<<13; x ^= x>>>17; x ^= x<<5; seedRef.s = x>>>0; return (seedRef.s & 0xffffff)/0x1000000;
  };
  const gauss = () => { let u=0,v=0; while(u===0)u=rnd(); while(v===0)v=rnd(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); };

  // ── sleep architecture: cycles ~90 min; each cycle dips into deep (N3) then up to REM ──
  const cycleLen = 95*60;                          // sec
  const stageAt = (t) => {                          // returns {mean RR base ms, vagal 0..1, stage}
    if (ambulatory){
      // sustained daytime exercise: HR climbs ~82 → ~94 bpm across the walk, low vagal,
      // NO sleep architecture. (AMBULATORY-MODE fixture — a walk, not a sleep study.)
      const base = 730 - 90*Math.min(1, t/durSec*1.2);
      return { base, vagal:0.30, stage:'Wake' };
    }
    const ph = (t % cycleLen)/cycleLen;             // 0..1 within a cycle
    // descending into deep then ascending to REM near the end of each cycle
    let stage, base, vagal;
    if (t < 7*60)            { stage='Wake'; base=860; vagal=0.35; }      // sleep onset
    else if (ph < 0.18)      { stage='N1';   base=980;  vagal=0.55; }
    else if (ph < 0.40)      { stage='N2';   base=1060; vagal=0.72; }
    else if (ph < 0.66)      { stage='N3';   base=1135; vagal=0.92; }     // deep — high vagal, low HR
    else if (ph < 0.82)      { stage='N2';   base=1050; vagal=0.70; }
    else                     { stage='REM';  base=915;  vagal=0.42; }     // REM — sympathetic, irregular
    // slow circadian downward drift in HR across the night
    base += Math.min(60, t/durSec*55);
    return { base, vagal, stage };
  };

  // ── CVHR (apnea) clusters: windows where HR cyclically oscillates ~22–30 s ──
  const apneaWindows = ambulatory ? [] : [
    { t0: 38*60,  t1: 66*60,  cyc: 28, depth: 0.15 },   // moderate cluster
    { t0: 120*60, t1: 152*60, cyc: 24, depth: 0.20 },   // stronger cluster
  ].filter(w => w.t0 < durSec);

  // ── artifact spans (strap shift / electrode pop) to exercise SQI ──
  const artifacts = [
    { t0: 88*60,  t1: 88*60+40,  kind: 'noise' },
    { t0: 175*60, t1: 175*60+55, kind: 'flat'  },
  ].filter(w => w.t0 < durSec);

  // ── build beat times + ground-truth RR + beat TYPE (N normal · V PVC · S PAC) ──
  const beatT = [];                                 // R-peak time (sec)
  const gtRR  = [];                                 // ground-truth RR (ms) — interval ending at this beat
  const gtType = [];                                // 'N' | 'V' | 'S'
  const respHz0 = 0.235;                            // ~14 breaths/min baseline
  // respiration phase = 2π·∫f dτ (accumulated), NOT 2π·f(t)·t — the latter chirps the
  // instantaneous frequency badly. f wanders ±0.03 Hz with a 600 s period.
  const respPhase = tt => 2*Math.PI*respHz0*tt - 0.03*600*(Math.cos(2*Math.PI*tt/600)-1);
  let t = 0.4, lf = 0, lfTarget = 0, bw = 0;        // bw = slow correlated (fractal) drift
  let sinusRR = 900;                                // running "expected" sinus interval
  let pendingComp = 0;                              // ms of compensatory pause owed to the next beat
  let bi = 0;
  while (t < durSec - 0.4){
    const sa = stageAt(t);
    // respiration (RSA) — vagal scales HF amplitude; resp rate wanders slowly
    const rsa = sa.vagal * 38 * Math.sin(respPhase(t));
    // LF (~0.1 Hz Mayer) ornstein-uhlenbeck-ish
    lfTarget = 0.985*lfTarget + 0.17*gauss();
    lf = 0.9*lf + 0.1*lfTarget;
    const lfMs = lf * 24 * (1.1 - sa.vagal*0.5);
    // slow correlated drift → long-range (1/f-like) structure for DFA α1 ≈ 1.
    bw = 0.992*bw + gauss()*0.9;
    // CVHR oscillation inside apnea windows
    let cvhr = 0;
    for (const w of apneaWindows){
      if (t >= w.t0 && t < w.t1){
        const ramp = Math.min(1, (t-w.t0)/40) * Math.min(1, (w.t1-t)/40);
        cvhr += ramp * w.depth * sa.base * Math.sin(2*Math.PI*t/w.cyc);
      }
    }
    sinusRR = sa.base + rsa + lfMs + bw*3.0 + cvhr + gauss()*5;
    let rr = sinusRR, type = 'N';
    if (pendingComp > 0){ rr = sinusRR + pendingComp; pendingComp = 0; }   // pause after an ectopic
    else if (rnd() < 0.0017){                                              // PVC — premature, full compensatory pause
      type = 'V'; const coupling = sinusRR*(0.50+0.12*rnd());
      rr = coupling; pendingComp = 2*sinusRR - coupling - sinusRR;         // so coupling+pause ≈ 2 sinus cycles
    } else if (rnd() < 0.0011){                                            // PAC — premature, partial (non-compensatory) pause
      type = 'S'; const coupling = sinusRR*(0.58+0.12*rnd());
      rr = coupling; pendingComp = sinusRR*0.35;
    }
    rr = Math.max(360, Math.min(1700, rr));
    gtRR.push(rr); gtType.push(type); beatT.push(t);
    t += rr/1000;
    bi++;
  }

  // ── render PQRST morphology into µV samples ──
  const N = Math.round(durSec*fs);
  const ecg = new Float32Array(N);
  // baseline wander (respiration + slow drift), µV
  for (let i = 0; i < N; i++){
    const ti = i/fs;
    ecg[i] = 45*Math.sin(2*Math.PI*0.22*ti) + 30*Math.sin(2*Math.PI*0.05*ti + 1.3);
  }
  // PQRST as a sum of gaussians (µV), placed at each beat
  // [center ms, amp µV, width ms]
  const tmpl = [
    [-185, 95,  20],   // P
    [-28, -115, 9],    // Q
    [0,   1080, 7],    // R
    [28, -240, 11],    // S
    [240, 255,  54],   // T  (later + wider → physiological QT/QTc)
  ];
  for (let k = 0; k < beatT.length; k++){
    const c = Math.round(beatT[k]*fs);
    const respAmp = 1 + 0.11*Math.sin(respPhase(beatT[k]));         // EDR: R-amplitude modulation, coherent with RSA
    const isPVC = gtType[k]==='V';
    const isPAC = gtType[k]==='S';
    for (const [cms, amp, wms] of tmpl){
      const w = wms/1000*fs;
      const ctr = c + cms/1000*fs;
      let a = amp*respAmp, ww = w;
      if (isPVC){                                                  // wide, tall, bizarre; no P
        a = (cms===0)? amp*1.5*respAmp : (cms>40? amp*1.9 : amp*0.35);
        if (cms===0 || cms===26 || cms===-28) ww = w*1.9;          // broaden QRS
      }
      if (isPVC && cms===-200) continue;                           // PVC: drop P wave
      if (isPAC && cms===-200){ a = amp*0.7*respAmp; }             // PAC: small/early P (normal QRS)
      const lo = Math.max(0, Math.floor(ctr-4*ww)), hi = Math.min(N-1, Math.ceil(ctr+4*ww));
      for (let i = lo; i <= hi; i++){
        const d = (i-ctr)/ww;
        ecg[i] += a*Math.exp(-0.5*d*d);
      }
    }
  }
  // sensor noise
  for (let i = 0; i < N; i++) ecg[i] += gauss()*8;

  // ── inject artifacts ──
  for (const w of artifacts){
    const s = Math.round(w.t0*fs), e = Math.min(N, Math.round(w.t1*fs));
    if (w.kind === 'flat'){ const v = ecg[s]||0; for (let i=s;i<e;i++) ecg[i] = v; }       // electrode pop → flat
    else { for (let i=s;i<e;i++) ecg[i] = (rnd()-0.5)*2600; }                               // burst noise
  }

  // ── quantize to Int16 µV ──
  const int16 = new Int16Array(N);
  for (let i = 0; i < N; i++){ let v = Math.round(ecg[i]); if (v>32767) v=32767; if (v<-32768) v=-32768; int16[i] = v; }

  // ground-truth device RR rows (timestamp ms epoch + RR) — for validation card
  const t0 = ambulatory ? Date.UTC(2026,5,1,12,14,0) : Date.UTC(2026,5,1,23,30,0);   // floating wall-clock (CLOCK-UNIFY)
  const devRR = gtRR.map((r,k)=>({ tsMs: t0 + Math.round(beatT[k]*1000), rr: Math.round(r) }));

  // ground-truth device HR (1 Hz) — instantaneous HR from the same beats, with light
  // firmware EMA smoothing + noise (so the HR cross-check has something real to agree with).
  const Mhr = Math.max(1, Math.floor(durSec));
  const devHR = new Array(Mhr); let _bi = 0;
  for (let s=0; s<Mhr; s++){
    while (_bi < beatT.length-1 && beatT[_bi+1] <= s) _bi++;
    let hr = 60000/gtRR[Math.min(_bi, gtRR.length-1)] + gauss()*0.7;
    devHR[s] = { tsMs: t0 + s*1000, hr };
  }
  for (let s=1; s<Mhr; s++) devHR[s].hr = 0.55*devHR[s].hr + 0.45*devHR[s-1].hr;
  for (let s=0; s<Mhr; s++) devHR[s].hr = +devHR[s].hr.toFixed(1);

  // ground-truth tri-axial accelerometer — gravity (posture) + respiratory chest
  // movement (ties to EDR breathing) + activity bursts. Overnight: 4 Hz still-sleeper.
  // Ambulatory: 26 Hz with a real walking step oscillation (≥7 Hz fs so the gait band
  // 0.5–3.5 Hz resolves) so the gait detector logs steps/cadence (AMBULATORY-MODE fixture).
  let ACCfs, devACC;
  if (ambulatory){
    ACCfs = 26;
    const Macc = Math.max(1, Math.floor(durSec*ACCfs));
    devACC = new Array(Macc);
    // upright-ish chest (gravity mostly on z); a step oscillation ON the gravity axis so the
    // vector-magnitude actually swings at the step rate. Cadence alternates light-walk (~90
    // spm) and brisk (~110 spm) with brief standing pauses → ~27% of minutes in the brisk zone.
    for (let i=0; i<Macc; i++){
      const ti = i/ACCfs;
      const breath = 30*Math.sin(respPhase(ti));
      const phase = (ti % 600)/600;                    // 10-min macro-cycle
      let stepHz, moving=true;
      if (phase < 0.12){ moving=false; stepHz=0; }     // standing pause (~12% → sedentary)
      else if (phase < 0.39){ stepHz = 1.83; }         // brisk walk ~110 spm (~27%)
      else { stepHz = 1.50; }                           // light walk ~90 spm
      const step = moving ? 190*Math.sin(2*Math.PI*stepHz*ti) : 0;
      const sway = moving ? 80*Math.sin(2*Math.PI*stepHz*ti*0.5) : 0;
      const nz = moving ? 26 : 6;
      devACC[i] = { tsMs: t0 + Math.round(ti*1000),
        x: Math.round(40  + sway + gauss()*nz),
        y: Math.round(120 + sway*0.6 + breath*0.4 + gauss()*nz),
        z: Math.round(980 + step + breath*0.5 + gauss()*nz) };
    }
  } else {
    ACCfs = 4;
    const Macc = Math.max(1, Math.floor(durSec*ACCfs));
    devACC = new Array(Macc);
    // realistic sleep postures as gravity vectors (mg). Chest-strap convention: +z anterior.
    // supine z-up, prone z-down, left/right side gravity along ±x, brief upright at wake.
    const POSTURES = [ [25,-18,990], [970,-40,90], [-965,30,70], [60,35,-985] ];  // supine, left, right, prone
    let posture = POSTURES[0];
    for (let i=0; i<Macc; i++){
      const ti = i/ACCfs, sa = stageAt(ti);
      const breath = 42*Math.sin(respPhase(ti));                      // chest movement → ACC respiration (same breath)
      // posture shifts are more likely during Wake/REM arousals (realistic position changes)
      const shiftP = (sa.stage==='Wake'||sa.stage==='REM') ? 0.0016 : 0.0004;
      if (rnd() < shiftP/ACCfs*4) posture = POSTURES[(Math.floor(rnd()*POSTURES.length))];
      let act = sa.stage==='Wake'?1.0 : sa.stage==='REM'?0.5 : sa.stage==='N1'?0.32 : 0.07;
      for (const w of apneaWindows){ if (ti>=w.t0 && ti<w.t1){ const ph=(ti-w.t0)%w.cyc; if (ph>w.cyc-3) act += 0.55; } }
      const mv = act * gauss()*60;
      devACC[i] = { tsMs: t0 + Math.round(ti*1000),
        x: Math.round(posture[0] + breath*0.75 + mv),
        y: Math.round(posture[1] + breath*0.30 + mv*0.8),
        z: Math.round(posture[2] + mv*0.5) };
    }
  }

  return { int16, fs, gaps: [], t0Ms: t0, source:'synthetic', durSec,
           deviceRR: devRR, deviceHR: devHR, deviceACC: devACC, accFs: ACCfs,
           nBeatsTrue: gtRR.length, scenario: opts.scenario || 'overnight' };
}

// ════════════════════════════════════════════════════════════════════════
//  BAND-PASS 5–15 Hz  (Pan-Tompkins cascade: integer low-pass then high-pass,
//  here as one-pole biquad approximations tuned to fs). Returns Float32Array.
// ════════════════════════════════════════════════════════════════════════
function bandpass(int16, fs){
  const N = int16.length, x = new Float32Array(N);
  // remove DC / slow drift with high-pass (~5 Hz), then low-pass (~15 Hz)
  // high-pass: y = a*(yPrev + x - xPrev)
  const RChp = 1/(2*Math.PI*5), aHp = RChp/(RChp + 1/fs);
  let yh = 0, xp = 0;
  for (let i = 0; i < N; i++){ const xi = int16[i]; yh = aHp*(yh + xi - xp); xp = xi; x[i] = yh; }
  // low-pass: simple 2-pass moving exponential (~15 Hz)
  const RClp = 1/(2*Math.PI*15), aLp = (1/fs)/(RClp + 1/fs);
  let yl = 0;
  for (let i = 0; i < N; i++){ yl = yl + aLp*(x[i]-yl); x[i] = yl; }
  return x;
}

// derivative → square → moving-window integrate (Pan-Tompkins front end)
function ptFeature(bp, fs){
  const N = bp.length;
  const d = new Float32Array(N);
  for (let i = 2; i < N-2; i++) d[i] = (2*bp[i+1]+bp[i+2]-bp[i-2]-2*bp[i-1]);
  const sq = new Float32Array(N);
  for (let i = 0; i < N; i++) sq[i] = d[i]*d[i];
  const win = Math.max(1, Math.round(0.10*fs));     // ~100 ms integration window
  const integ = new Float32Array(N);
  let acc = 0;
  for (let i = 0; i < N; i++){
    acc += sq[i];
    if (i >= win) acc -= sq[i-win];
    integ[i] = acc/win;
  }
  return integ;
}

// Robust seed scale for the Pan-Tompkins integrate threshold: a SUBSAMPLED HIGH
// PERCENTILE of the whole-record integrate feature (≈ a strong-QRS level), instead
// of the max of the first 2 s. The integrate's elevated regions are wide (~100 ms
// window), so a strided subsample reliably samples them; the ~99th pct lands at the
// strong-QRS level on a clean record (so clean-file detection is ~unchanged) while a
// ≤2 s startup transient is a negligible fraction of a night → it no longer moves the
// seed. Degenerate (flat) → falls back to the legacy first-2 s max. ECG-RPEAK-SEED-FIX.
function _seedScale(integ, fs){
  const N = integ.length;
  if (!N) return 0;
  const stride = Math.max(1, Math.floor(N/20000)), s = [];
  for (let i = 0; i < N; i += stride){ const v = integ[i]; if (isFinite(v) && v > 0) s.push(v); }
  if (s.length){
    s.sort(function(a,b){ return a-b; });
    const p = s[Math.min(s.length-1, Math.floor(0.99*s.length))];
    if (p > 0) return p;
  }
  let mx = 0; const initN = Math.min(N, 2*fs); for (let i = 0; i < initN; i++) if (integ[i] > mx) mx = integ[i];
  return mx;
}

// ════════════════════════════════════════════════════════════════════════
//  PAN-TOMPKINS R-PEAK DETECTION (adaptive double-threshold)
//  returns raw integer peak indices on the original signal
// ════════════════════════════════════════════════════════════════════════
function detectPeaks(int16, bp, fs){
  const N = int16.length;
  const integ = ptFeature(bp, fs);
  const refractory = Math.round(0.20*fs);           // 200 ms — physiological min RR
  // Seed thresholds from a ROBUST GLOBAL scale, not max(first 2 s). A first-2 s max
  // poisons the seed when a recording opens mid electrode-settling (a multi-kµV
  // transient ≫ the real QRS): squared in the integrate it sets the seed ~10–20× the
  // true QRS level, and SPKI only decays when a peak FIRES — so once seeded high it
  // never recovers → no beat crosses THRI → <12 peaks → false "signal may be flat"
  // throw on an otherwise-good night (ECG-RPEAK-SEED-FIX-2026-06-27).
  let init = _seedScale(integ, fs);
  let SPKI = 0.5*init, NPKI = 0.1*init, THRI = NPKI + 0.25*(SPKI-NPKI);
  const peaks = [];
  let last = -refractory;
  // STALL-RECOVERY (ECGDEX-FOLLOWUPS-II §1). SPKI only updates when a peak FIRES, so a
  // single supra-physiologic IN-BAND transient — a multi-kµV electrode-settling/motion
  // artifact, ~20–30× a real QRS in the SQUARED integrate — can park SPKI (hence THRI)
  // above every subsequent real QRS, and detection then dies SILENTLY for the rest of the
  // recording (the robust seed prevents the <12-peak THROW, NOT this mid-record stall:
  // verified on a real Polar-H10 20260625 night that collapsed to 63 beats / 4 min of a
  // ~7 h record — integ artifact 1.1e7 vs ~5e5 real QRS). Guard: once a beat cadence is
  // established (rrAvg>0) and detection stalls past a non-physiologic gap (>2.5 s ⇒
  // sustained <24 bpm ⇒ the THRESHOLD, not the heart, is stuck), BLEED SPKI toward the
  // noise floor so a real QRS can re-cross THRI. Inert on clean records — a real RR never
  // exceeds 2.5 s, so beat output is BYTE-IDENTICAL there (verified vs the pre-guard path).
  const idleLimit = Math.round(2.5*fs);
  const rr = []; let rrAvg = 0;
  for (let i = 1; i < N-1; i++){
    if (integ[i] > integ[i-1] && integ[i] >= integ[i+1] && integ[i] > THRI){
      if (i - last > refractory){
        // localise the true R on the original signal within ±70 ms of the integrate peak
        const w = Math.round(0.07*fs);
        let bi = i, bv = -Infinity;
        for (let j = Math.max(0,i-w); j <= Math.min(N-1,i+w); j++){ if (int16[j] > bv){ bv = int16[j]; bi = j; } }
        peaks.push(bi);
        if (last >= 0){ const d = i - last; if (d > 0){ rr.push(d); if (rr.length > 8) rr.shift(); let s = 0; for (let k = 0; k < rr.length; k++) s += rr[k]; rrAvg = s/rr.length; } }
        last = i;
        SPKI = 0.125*integ[i] + 0.875*SPKI;
      } else {
        NPKI = 0.125*integ[i] + 0.875*NPKI;
      }
    } else if (integ[i] > integ[i-1] && integ[i] >= integ[i+1]){
      NPKI = 0.125*integ[i] + 0.875*NPKI;
    }
    THRI = NPKI + 0.25*(SPKI-NPKI);
    // un-stick a threshold parked by a supra-physiologic transient (see header note)
    if (rrAvg > 0 && (i - last) > idleLimit){ SPKI = Math.max(NPKI, SPKI*0.99); THRI = NPKI + 0.25*(SPKI-NPKI); }
  }
  return peaks;
}

// Secondary detector (different front-end: slope+amplitude on band-passed signal)
// used only for bSQI two-detector agreement.
function detectPeaksB(bp, fs){
  const N = bp.length, refractory = Math.round(0.22*fs);
  let mx = 0; for (let i=0;i<N;i++){ const a=Math.abs(bp[i]); if(a>mx) mx=a; }
  let thr = 0.35*mx, last = -refractory; const peaks = [];
  // running amplitude estimate
  let env = thr;
  for (let i = 1; i < N-1; i++){
    const a = Math.abs(bp[i]);
    env = 0.999*env + 0.001*a;
    const t = Math.max(0.30*env, 0.18*mx);
    if (bp[i] > bp[i-1] && bp[i] >= bp[i+1] && bp[i] > t && i-last > refractory){ peaks.push(i); last = i; }
  }
  return peaks;
}

// ════════════════════════════════════════════════════════════════════════
//  SUB-SAMPLE R-PEAK REFINEMENT — parabolic vertex on the band-passed signal.
//  delta = 0.5*(a-c)/(a-2b+c);  t = (i+delta)/fs.  Recovers ~Ts/10 (~0.8 ms).
// ════════════════════════════════════════════════════════════════════════
function refinePeaks(bp, peaks, fs){
  const times = new Float64Array(peaks.length);
  const refIdx = new Float64Array(peaks.length);
  for (let k = 0; k < peaks.length; k++){
    let i = peaks[k];
    // snap to local max of |bp| in a tiny window (band-passed R is the dominant lobe)
    const w = Math.round(0.04*fs);
    let bi = i, bv = -Infinity;
    for (let j = Math.max(1,i-w); j <= Math.min(bp.length-2,i+w); j++){ if (bp[j] > bv){ bv = bp[j]; bi = j; } }
    i = bi;
    const a = bp[i-1], b = bp[i], c = bp[i+1], den = (a - 2*b + c);
    let delta = den !== 0 ? 0.5*(a-c)/den : 0;
    if (!isFinite(delta) || Math.abs(delta) > 1) delta = 0;
    refIdx[k] = i + delta;
    times[k] = (i + delta)/fs;
  }
  return { times, refIdx };
}

// kurtosis (peakedness) of a window — clean ECG is leptokurtic
function kurtosis(int16, s, e){
  let m=0,n=0; for(let i=s;i<e;i++){ m+=int16[i]; n++; } if(!n) return 0; m/=n;
  let m2=0,m4=0; for(let i=s;i<e;i++){ const d=int16[i]-m; m2+=d*d; m4+=d*d*d*d; }
  m2/=n; m4/=n; return m2>0 ? m4/(m2*m2) : 0;
}

// ════════════════════════════════════════════════════════════════════════
//  PER-BEAT SQI  (composite 0..1 → Ganglior conf)
//  flatline/rail · kurtosis · two-detector agreement (bSQI) · RR plausibility · range
// ════════════════════════════════════════════════════════════════════════
function computeSQI(int16, fs, peaks, times, peaksB){
  const n = peaks.length;
  const sqi = new Float32Array(n);
  // RR (ms) from refined times
  const rr = new Float64Array(n);
  for (let k = 1; k < n; k++) rr[k] = (times[k]-times[k-1])*1000;
  rr[0] = rr[1] || 1000;
  // bSQI: does detector B have a peak within ±50 ms of each A peak?
  const tolB = 0.05*fs;
  let bp2 = 0;
  const matchB = new Uint8Array(n);
  for (let k = 0; k < n; k++){
    const target = peaks[k];
    while (bp2 < peaksB.length && peaksB[bp2] < target - tolB) bp2++;
    // search nearby (don't consume monotonically too aggressively)
    let found = false;
    for (let j = Math.max(0,bp2-2); j < peaksB.length && peaksB[j] <= target + tolB; j++){
      if (Math.abs(peaksB[j]-target) <= tolB){ found = true; break; }
    }
    matchB[k] = found ? 1 : 0;
  }
  for (let k = 0; k < n; k++){
    const i = peaks[k];
    const s = Math.max(0, i - Math.round(0.13*fs)), e = Math.min(int16.length, i + Math.round(0.13*fs));
    // flatline / rail: count identical or near-identical runs
    let flatRun = 0, maxFlat = 0, railHit = 0, prev = int16[s];
    for (let j = s+1; j < e; j++){
      if (Math.abs(int16[j]-prev) < 2){ flatRun++; if(flatRun>maxFlat) maxFlat=flatRun; } else flatRun = 0;
      if (Math.abs(int16[j]) > 31000) railHit++;
      prev = int16[j];
    }
    const flatBad = (maxFlat > 0.20*fs) || (railHit > 3);   // >200 ms flat
    // kurtosis
    const kurt = kurtosis(int16, s, e);
    const kSQI = Math.max(0, Math.min(1, (kurt - 2.5)/8));   // clean QRS window: kurt ~5–15
    // RR plausibility
    const rrk = rr[k];
    const rrOK = rrk >= 300 && rrk <= 2000;
    let rrDev = 0;
    if (k > 1 && k < n-1){ const loc = (rr[k-1]+rr[k+1])/2; rrDev = loc ? Math.abs(rrk-loc)/loc : 0; }
    const rrPlaus = rrOK ? Math.max(0, 1 - Math.max(0, rrDev-0.2)/0.6) : 0;
    // range / amplitude sanity
    let mn=Infinity,mx=-Infinity; for(let j=s;j<e;j++){ if(int16[j]<mn)mn=int16[j]; if(int16[j]>mx)mx=int16[j]; }
    const amp = mx-mn;
    const ampOK = amp > 180 && amp < 6000 ? 1 : (amp<=180 ? 0 : 0.4);
    // composite
    let q = 0.30*kSQI + 0.28*matchB[k] + 0.24*rrPlaus + 0.18*ampOK;
    if (flatBad) q *= 0.15;
    sqi[k] = Math.max(0, Math.min(1, q));
  }
  return { sqi, rr };
}

// ════════════════════════════════════════════════════════════════════════
//  BUILD NN SERIES  — gate by SQI, interpolate excluded/implausible beats so
//  the tachogram stays time-aligned (Kubios/Malik style). Surfaces correction
//  rate + % analyzable.
// ════════════════════════════════════════════════════════════════════════
function buildNN(times, rr, sqi, sqiThr, ectopyThr){
  sqiThr = sqiThr == null ? 0.30 : sqiThr;
  ectopyThr = ectopyThr == null ? 0.20 : ectopyThr;   // Malik 20% rule (Task Force 1996 / Kubios)
  const n = rr.length;
  const nn = new Float64Array(n);
  const tt = new Float64Array(n);
  const corrected = new Uint8Array(n);
  let nEctopy = 0;
  for (let k = 0; k < n; k++){ nn[k] = rr[k]; tt[k] = times[k]; }
  // Replace beats that are (a) low signal-quality, (b) physiologically implausible, OR
  // (c) ectopic — i.e. deviating >ectopyThr from the local clean median. (c) is the key
  // one: a PAC/PVC has a clean QRS (high SQI) and in-range RR, so it passes (a)+(b)
  // untouched yet injects two large beat-to-beat jumps that massively inflate rMSSD/pNN50.
  // Without it, ECGDex disagrees with PulseDex/Kubios on the same recording.
  // NB: start at k=0 — the FIRST beat (sensor-contact startup artifact, e.g. a 474 ms
  // beat ≈127 bpm against a ~1200 ms mean) must be range/relative-gated too, or it
  // survives into minRR/maxHR. The local median uses forward neighbours for k=0.
  for (let k = 0; k < n; k++){
    const seg = [];
    for (let j = Math.max(0,k-5); j < Math.min(n,k+6); j++){ if (j!==k && sqi[j]>=sqiThr && rr[j]>=300 && rr[j]<=2000) seg.push(rr[j]); }
    seg.sort((a,b)=>a-b);
    const med = seg.length ? seg[seg.length>>1] : 0;
    const dev = med ? Math.abs(nn[k]-med)/med : 0;            // deviation from local median (relative-plausibility gate)
    const rangeBad = sqi[k] < sqiThr || nn[k] < 300 || nn[k] > 2000;
    const ectopic  = med && dev > ectopyThr;
    if (rangeBad || ectopic){
      nn[k] = med || (nn[k+1] || nn[k-1] || 1000);
      corrected[k] = 1;
      if (ectopic && !rangeBad) nEctopy++;
    }
  }
  let nCorr = 0; for (let k=0;k<n;k++) nCorr += corrected[k];
  let nGood = 0; for (let k=0;k<n;k++) if (sqi[k] >= sqiThr) nGood++;
  // ── gap-aware coverage ──────────────────────────────────────────────────────
  // A real recording with the strap off (or a sensor dropout) leaves big inter-beat
  // gaps. tt[N-1] then over-states duration and % clean-beats hides the dead time.
  // GAP_S: any inter-beat interval longer than this is a coverage gap, not a missed beat.
  const GAP_S = 10;
  let activeSec = 0, gapSec = 0, nGaps = 0;
  for (let k = 1; k < n; k++){
    const d = tt[k] - tt[k-1];
    if (d <= 0) continue;
    if (d > GAP_S){ gapSec += d; nGaps++; }
    else activeSec += d;
  }
  const spanSec = n>1 ? (tt[n-1]-tt[0]) : 0;
  const coveragePct = spanSec>0 ? +(activeSec/spanSec*100).toFixed(1) : 100;
  const cleanBeatPct = +(nGood/n*100).toFixed(1);
  // Honest headline: clean-beat fraction discounted by how much of the span is covered.
  const analyzablePct = +(cleanBeatPct*Math.min(1, coveragePct/100)).toFixed(1);
  return { nn, tt, corrected, correctionRate: +(nCorr/n*100).toFixed(2),
           analyzablePct, cleanBeatPct, coveragePct, nCorrected: nCorr, nEctopyCorrected: nEctopy,
           activeSec, spanSec, gapSec, nGaps };
}

// ════════════════════════════════════════════════════════════════════════
//  FREQUENCY DOMAIN — Lomb–Scargle on unevenly-sampled NN → VLF/LF/HF + resp.
// ════════════════════════════════════════════════════════════════════════
function lombScargle(nn, times, nf){
  const N = nn.length;
  if (N < 12) return { tp:0, vlf:0, lf:0, hf:0, lfhf:0, respRate:0 };
  const t = times.slice(0, N);
  const dt = linfit(Array.from(t), Array.from(nn));
  const x = []; for (let i=0;i<N;i++) x.push(nn[i] - (dt.slope*t[i] + dt.intercept));
  const fLo=0.003, fHi=0.40; nf = nf||300; const df=(fHi-fLo)/(nf-1);
  let tp=0,vlf=0,lf=0,hf=0,peakF=0,peakP=0;
  for (let kf=0; kf<nf; kf++){
    const f=fLo+kf*df, w=2*Math.PI*f;
    let s2=0,c2=0; for(let i=0;i<N;i++){ s2+=Math.sin(2*w*t[i]); c2+=Math.cos(2*w*t[i]); }
    const tau=Math.atan2(s2,c2)/(2*w);
    let nC=0,nS=0,dC=0,dS=0;
    for(let i=0;i<N;i++){ const wt=w*(t[i]-tau),cw=Math.cos(wt),sw=Math.sin(wt); nC+=x[i]*cw; dC+=cw*cw; nS+=x[i]*sw; dS+=sw*sw; }
    const P=0.5*((nC*nC/(dC||1))+(nS*nS/(dS||1)));
    const e=P*df; tp+=e;
    if(f<0.04) vlf+=e; else if(f<0.15) lf+=e; else { hf+=e; if(P>peakP){peakP=P;peakF=f;} }
  }
  const variance=x.reduce((s,v)=>s+v*v,0)/N, sc = tp>0 ? variance/tp : 1;
  return { tp:Math.round(tp*sc), vlf:Math.round(vlf*sc), lf:Math.round(lf*sc), hf:Math.round(hf*sc),
           lfhf:+(lf/(hf||1)).toFixed(3), respRate:+(peakF*60).toFixed(1) };
}

function dfaAlpha1(a){
  const N=a.length; if(N<16) return null;
  const m=mean(a); let acc=0; const y=[];
  for(let i=0;i<N;i++){ acc+=a[i]-m; y.push(acc); }
  const logn=[], logF=[];
  for(let n=4;n<=16;n++){
    const nB=Math.floor(N/n); if(nB<1) continue;
    let sumSq=0,cnt=0; const xs=[]; for(let i=0;i<n;i++) xs.push(i);
    for(let b=0;b<nB;b++){
      const seg=y.slice(b*n,(b+1)*n); const {slope,intercept}=linfit(xs,seg);
      for(let i=0;i<n;i++){ const r=seg[i]-(slope*i+intercept); sumSq+=r*r; cnt++; }
    }
    const F=Math.sqrt(sumSq/cnt); if(F>0){ logn.push(Math.log10(n)); logF.push(Math.log10(F)); }
  }
  if(logn.length<3) return null;
  return +linfit(logn,logF).slope.toFixed(3);
}

function sampEn(a,m,r){
  const N=a.length; if(N<m+2) return null; let B=0,A=0;
  for(let i=0;i<N-m;i++){ for(let j=i+1;j<N-m;j++){
    let k=0; while(k<m && Math.abs(a[i+k]-a[j+k])<=r) k++;
    if(k===m){ B++; if(Math.abs(a[i+m]-a[j+m])<=r) A++; }
  }}
  if(B===0||A===0) return null; return +(-Math.log(A/B)).toFixed(3);
}

function triangularIndex(a){
  const binW=1000/128; const f={}; let maxC=0;
  a.forEach(v=>{ const k=Math.round(v/binW); f[k]=(f[k]||0)+1; if(f[k]>maxC) maxC=f[k]; });
  return +(a.length/maxC).toFixed(2);
}

function prsaCapacity(a, sign){
  const N=a.length, L=2; const win=[];
  for(let i=L;i<N-L;i++){
    const isAnchor = sign>0 ? a[i]>a[i-1] : a[i]<a[i-1];
    if(!isAnchor) continue;
    if(Math.abs(a[i]-a[i-1])/a[i-1] > 0.05) continue;
    win.push([a[i-2],a[i-1],a[i],a[i+1],a[i+2]]);
  }
  if(win.length<3) return null;
  const X=[]; for(let k=0;k<5;k++){ let s=0; win.forEach(w=>s+=w[k]); X.push(s/win.length); }
  return +((X[2]+X[3]-X[1]-X[0])/4).toFixed(2);
}

function fragmentation(a){
  const N=a.length; if(N<4) return null;
  const d=[]; for(let i=1;i<N;i++) d.push(a[i]-a[i-1]);
  const s=d.map(v=> v>0?1 : v<0?-1 : 0);
  for(let i=0;i<s.length;i++){ if(s[i]===0) s[i]= i>0?s[i-1]:1; }
  let ip=0; for(let i=1;i<s.length;i++) if(s[i]!==s[i-1]) ip++;
  const PIP=ip/N*100;
  const runs=[]; let len=1;
  for(let i=1;i<s.length;i++){ if(s[i]===s[i-1]) len++; else { runs.push(len); len=1; } }
  runs.push(len);
  const IALS=runs.length/N; let tot=0,shortNN=0;
  runs.forEach(L=>{ tot+=L; if(L<3) shortNN+=L; });
  return { pip:+PIP.toFixed(1), ials:+IALS.toFixed(3), pss:+(shortNN/tot*100).toFixed(1) };
}

// ════════════════════════════════════════════════════════════════════════
//  5-MIN EPOCH ENGINE — window the NN series; per-epoch short-term suite.
// ════════════════════════════════════════════════════════════════════════
function epochEngine(nn, tt, winSec){
  winSec = winSec||300;
  const N=nn.length, tEnd=tt[N-1]; const epochs=[]; let i=0;
  for (let w0=0; w0<=tEnd; w0+=winSec){
    const w1=w0+winSec, seg=[], segT=[];
    while(i<N && tt[i]<w1){ seg.push(nn[i]); segT.push(tt[i]); i++; }
    // back up i so windows that share a boundary still see beats (non-overlap, simple advance is fine)
    if (seg.length>=20){
      const m=mean(seg);
      const ls = lombScargle(seg, segT, 160);
      epochs.push({
        tMin:+(w0/60).toFixed(1), n:seg.length, hr:+(60000/m).toFixed(1),
        meanRR:+m.toFixed(1), rmssd:+rmssd(seg).toFixed(1), sdnn:+std(seg).toFixed(1),
        pnn:+pnn50(seg).toFixed(1), lf:ls.lf, hf:ls.hf, lfhf:ls.lfhf, resp:ls.respRate
      });
    }
  }
  return epochs;
}

// ════════════════════════════════════════════════════════════════════════
//  DYNAMIC HRV STABILITY  (Li & Kiyono 2026, Sensors 26(4):1118 [CC BY 4.0])
//  The within-night TREND of ln(RMSSD) instability — Cohen's |d| > 1.1 vs
//  glucose metabolism. We compute, per 30-min window, the SD of ln(RMSSD)
//  across that window's 5-min epochs → bσ(ln(RMSSD)); then regress those
//  window SDs against time → nocturnal trend (slope).
//    slope < 0  → DECREASING overnight = progressive autonomic stabilization
//                 (favourable; lower-eHbA1c group pattern)
//    slope > 0  → INCREASING overnight = persistent autonomic instability
//                 (glycemic-risk signal; higher-eHbA1c group pattern)
//  We ALSO report the within-window variance trend bs²(ln(RMSSD)) (same finding).
// ════════════════════════════════════════════════════════════════════════
function hrvStability(epochs){
  if (!epochs || epochs.length < 12) return null;        // need ≥ ~1 h
  const WIN_MIN = 30;
  // group 5-min epochs into 30-min windows
  const windows = [];
  let cur = [], wStart = epochs[0].tMin;
  for (const e of epochs){
    if (e.tMin - wStart >= WIN_MIN){ if (cur.length>=3) windows.push({ tMin:wStart, epochs:cur }); cur=[]; wStart=e.tMin; }
    cur.push(e);
  }
  if (cur.length>=3) windows.push({ tMin:wStart, epochs:cur });
  if (windows.length < 3) return null;

  const pts = [];     // { tMin, lnSD, lnVar, lnMean }
  for (const w of windows){
    const lnR = w.epochs.map(e=>Math.log(Math.max(1, e.rmssd)));
    const m = mean(lnR), sd = std(lnR);
    pts.push({ tMin:w.tMin, lnSD:sd, lnVar:sd*sd, lnMean:m });
  }
  const xs = pts.map(p=>p.tMin/60);                       // hours
  const sdSlope  = linfit(xs, pts.map(p=>p.lnSD)).slope;  // bσ(ln(RMSSD)) trend
  const varSlope = linfit(xs, pts.map(p=>p.lnVar)).slope; // bs²(ln(RMSSD)) trend
  const meanSlope= linfit(xs, pts.map(p=>p.lnMean)).slope;

  // classify per Li/Kiyono direction (thresholds in ln-units per hour)
  let cls, sev;
  if (sdSlope < -0.015){ cls='Stabilizing — progressive autonomic stabilization (favourable)'; sev='good'; }
  else if (sdSlope > 0.015){ cls='Rising instability — persistent autonomic instability (glycemic-risk signal)'; sev='bad'; }
  else { cls='Flat — no clear nocturnal trend'; sev='warn'; }

  return {
    nWindows: windows.length,
    sigma_lnRMSSD_slope: +sdSlope.toFixed(4),     // bσ(ln(RMSSD))
    var_lnRMSSD_slope:   +varSlope.toFixed(4),     // bs²(ln(RMSSD))
    mean_lnRMSSD_slope:  +meanSlope.toFixed(4),
    classification: cls, severity: sev,
    series: pts.map(p=>({ tMin:p.tMin, lnSD:+p.lnSD.toFixed(3), lnMean:+p.lnMean.toFixed(3) }))
  };
}

// ── Surge-density escalation: does CVHR cluster later in the night?
//    (Li/Kiyono note this escalation IS the HRV-instability signature.) ──
function surgeEscalation(cvhrEvents, durSec){
  if (!cvhrEvents || cvhrEvents.length < 4 || durSec < 90*60) return null;
  const third = durSec/3;
  const counts = [0,0,0];
  for (const e of cvhrEvents){ const k=Math.min(2, Math.floor(e.sec/third)); counts[k]++; }
  const perHour = counts.map(c=>+(c/(third/3600)).toFixed(1));
  const escal = perHour[0] > 0 ? +((perHour[2]-perHour[0])/perHour[0]*100).toFixed(0) : (perHour[2]>0?100:0);
  return { perHourThirds: perHour, escalationPct: escal,
           label: escal > 40 ? 'Surge density escalates overnight — instability signature'
                 : escal < -20 ? 'Surge density eases overnight'
                 : 'Surge density roughly stable' };
}

// ════════════════════════════════════════════════════════════════════════
//  CARDIORESPIRATORY COUPLING  (EDR ⟷ RR) — three zero-new-sensor metrics,
//  all derived from the SAME raw ECG already in hand:
//    · rsaEfficiencyRatio  — inspiratory:expiratory HR ratio across the
//      respiratory cycle (Border et al. 2025, arXiv:2507.00597 — RSA minimises
//      cardiac power; efficient hearts raise HR ~1.5× on inspiration).
//    · crcPLV              — phase-locking value between the RR oscillation and
//      the EDR respiration (model-free CRC strength, arXiv:2508.00773). [0..1]
//    · couplingStrength    — CSI-style single-number cardiorespiratory-sync
//      index (arXiv:2605.18802), a PLV/RSA composite. [0..1]
//  EDR = R-peak amplitude modulation (the chest sensor's electrical axis swings
//  with lung volume). No airflow, no PPG, no extra hardware — just the ECG.
// ════════════════════════════════════════════════════════════════════════
function _detrendMov(x, win){
  const half = win>>1, N = x.length, o = new Float64Array(N);
  for (let i=0;i<N;i++){ let a=0,c=0; for(let k=-half;k<=half;k++){ const u=i+k; if(u>=0&&u<N){ a+=x[u]; c++; } } o[i]=x[i]-a/c; }
  return o;
}
function _interpGrid(xs, ys, grid){
  const N = xs.length, M = grid.length, o = new Float64Array(M); let j=0;
  for (let i=0;i<M;i++){ const g=grid[i];
    while (j<N-2 && xs[j+1]<g) j++;
    const x0=xs[j], x1=xs[j+1], y0=ys[j], y1=ys[j+1];
    const f = x1>x0 ? (g-x0)/(x1-x0) : 0; o[i]=y0+(y1-y0)*Math.max(0,Math.min(1,f));
  }
  return o;
}
function _maHalf(x, half){
  const N=x.length, o=new Float64Array(N);
  for (let i=0;i<N;i++){ let a=0,c=0; for(let k=-half;k<=half;k++){ const u=i+k; if(u>=0&&u<N){ a+=x[u]; c++; } } o[i]=a/c; }
  return o;
}
// resp-band band-pass (~0.1–0.4 Hz) as a difference of moving averages
function _bandResp(x, fs){
  const hi = _maHalf(x, Math.max(1, Math.round(0.30*fs)));   // drop > ~0.4 Hz
  const lo = _maHalf(x, Math.max(2, Math.round(2.0*fs)));    // drop < ~0.1 Hz
  const o = new Float64Array(x.length);
  for (let i=0;i<x.length;i++) o[i] = hi[i]-lo[i];
  return o;
}
// narrowband instantaneous phase via quadrature: for x≈A·cos φ, sin φ ≈ −ẋ/ω₀
function _narrowPhase(x, fs, f0){
  const w0 = 2*Math.PI*Math.max(0.05, f0), N = x.length, ph = new Float64Array(N);
  for (let i=0;i<N;i++){
    const xm = i>0 ? x[i-1] : x[i], xp = i<N-1 ? x[i+1] : x[i];
    const dx = (xp-xm)*fs/2;                  // central-difference derivative
    ph[i] = Math.atan2(-dx/w0, x[i]);
  }
  return ph;
}
function cardiorespCoupling(nn, tt, int16, refIdx, fs, respHint, epochs){
  const n = nn.length;
  if (n < 60 || !refIdx || refIdx.length < n) return null;
  // 1) EDR — R-peak amplitude per beat (local max of raw signal at the refined peak)
  const amp = new Float64Array(n);
  for (let k=0;k<n;k++){
    const c = Math.round(refIdx[k]); let hi = -Infinity;
    for (let j=Math.max(0,c-2); j<=Math.min(int16.length-1,c+2); j++) if (int16[j] > hi) hi = int16[j];
    amp[k] = isFinite(hi) ? hi : 0;
  }
  const edr = _detrendMov(amp, 40);                 // remove posture/drift → respiration modulation
  const hrAbs = new Float64Array(n); for (let k=0;k<n;k++) hrAbs[k] = 60000/nn[k];
  const hrR = _detrendMov(hrAbs, 40);               // resp-band HR oscillation (RSA)
  // 2) resample EDR · HRresp · HRabs onto a uniform 4 Hz grid
  const FS = 4, t0 = tt[0], t1 = tt[n-1], M = Math.max(16, Math.floor((t1-t0)*FS));
  if (M < 16) return null;
  const grid = new Float64Array(M); for (let i=0;i<M;i++) grid[i] = t0 + i/FS;
  const edrU  = _interpGrid(tt, edr,   grid);
  const hrU   = _interpGrid(tt, hrR,   grid);
  const hrAbsU= _interpGrid(tt, hrAbs, grid);
  const edrB = _bandResp(edrU, FS), hrB = _bandResp(hrU, FS);
  // 3) respiration rate measured DIRECTLY from the EDR band (dominant period via
  // autocorrelation), not echoed from the Lomb hint. Center the phase analysis on it.
  const edrPeriod = _autocorrPeriod(edrB, FS, 2.5, 10);
  const respFromEDR = edrPeriod ? +(60/edrPeriod).toFixed(1)
                    : ((respHint && respHint>=6 && respHint<=24) ? +respHint.toFixed(1) : 15);
  const f0 = (respFromEDR>=6 && respFromEDR<=24) ? respFromEDR/60 : 0.25;
  const phE = _narrowPhase(edrB, FS, f0), phH = _narrowPhase(hrB, FS, f0);
  // windowed PLV — averaged over 60 s windows so slow respiratory-frequency drift
  // (the resp rate wanders all night) doesn't wash out a real phase-lock.
  const wN = Math.max(16, Math.round(60*FS)), wStep = Math.max(8, Math.round(30*FS));
  const localPLV = (s,e)=>{ let r2=0,i2=0,c=0; for(let i=s;i<e;i++){ const d=phH[i]-phE[i]; r2+=Math.cos(d); i2+=Math.sin(d); c++; } return c? Math.sqrt(r2*r2+i2*i2)/c : 0; };
  let plvAcc=0, plvCnt=0, bestPLV=-1, bestS=0;
  for (let s=0; s+wN<=M; s+=wStep){ const lp = localPLV(s, s+wN); plvAcc+=lp; plvCnt++; if (lp>bestPLV){ bestPLV=lp; bestS=s; } }
  const plv = plvCnt ? plvAcc/plvCnt : 0;
  // 4) RSA amplitude = robust peak-to-trough of the resp-band HR oscillation (the RSA itself),
  // drift- and polarity-proof. Efficiency ratio = inspiratory:expiratory HR (Border 2025).
  const meanHRabs = mean(Array.from(hrAbsU));
  const hrBarr = Array.from(hrB);
  const rsaAmp = Math.max(0, quant(hrBarr,0.92) - quant(hrBarr,0.08));
  const rsaRatio = (meanHRabs - rsaAmp/2) > 0 ? (meanHRabs + rsaAmp/2)/(meanHRabs - rsaAmp/2) : 1;
  const rsaAmpNorm = Math.min(1, rsaAmp/(0.10*meanHRabs || 1));
  const couplingStrength = Math.max(0, Math.min(1, 0.65*plv + 0.35*rsaAmpNorm));
  // phase-averaged HR over the BEST-coherence 60 s window (a clean RSA loop for the chart)
  const NB = 16; const binSum = new Float64Array(NB), binN = new Float64Array(NB);
  for (let i=bestS;i<Math.min(M,bestS+wN);i++){ let ph = phE[i] % (2*Math.PI); if (ph<0) ph += 2*Math.PI;
    const b = Math.min(NB-1, Math.floor(ph/(2*Math.PI)*NB)); binSum[b]+=hrAbsU[i]; binN[b]++; }
  const phaseCurve = [];
  for (let b=0;b<NB;b++){ phaseCurve.push(binN[b]>=2 ? +(binSum[b]/binN[b]).toFixed(1) : null); }
  // 5) per-epoch PLV (windowed) — drops during CVHR/apnea clusters → CVHR confidence channel
  const epochCRC = [];
  if (epochs && epochs.length){
    for (const e of epochs){ const w0=e.tMin*60, w1=w0+300;
      const s0=Math.max(0,Math.round((w0-grid[0])*FS)), s1=Math.min(M,Math.round((w1-grid[0])*FS));
      if (s1-s0 < wN){ continue; }
      let acc=0,cnt=0; for (let s=s0; s+wN<=s1; s+=wStep){ acc+=localPLV(s,s+wN); cnt++; }
      if (cnt) epochCRC.push({ tMin:e.tMin, plv:+(acc/cnt).toFixed(3) });
    }
  }
  return {
    respFromEDR,
    rsaEfficiencyRatio:+rsaRatio.toFixed(2), rsaAmplitudeBpm:+rsaAmp.toFixed(1),
    crcPLV:+plv.toFixed(3), couplingStrength:+couplingStrength.toFixed(3),
    phaseCurve, nbins:NB, nGrid:M, epochCRC,
    plvDuringSurges:null, plvBaseline:null
  };
}

// ════════════════════════════════════════════════════════════════════════
//  CVHR — Cyclic Variation of Heart Rate (apnea autonomic signature).
//  Detect dips/cycles in the per-second HR envelope with 20–60 s period and
//  the characteristic bradycardia→tachycardia rebound. Returns events + index.
// ════════════════════════════════════════════════════════════════════════
function detectCVHR(nn, tt){
  const N = nn.length; if (N < 60) return { events:[], index:0, hrSeries:[] };
  // resample instantaneous HR to 1 Hz
  const tEnd = tt[N-1]; const M = Math.floor(tEnd);
  const hr = new Float64Array(M); let j=0;
  for (let s=0;s<M;s++){
    while (j<N-1 && tt[j+1] < s) j++;
    hr[s] = 60000/nn[Math.min(j,N-1)];
  }
  // smooth (5 s) for the display series
  const sm = new Float64Array(M);
  for (let s=0;s<M;s++){ let a=0,c=0; for(let k=-2;k<=2;k++){ const u=s+k; if(u>=0&&u<M){a+=hr[u];c++;} } sm[s]=a/c; }
  // ── apnea-band band-pass (~20–45 s period ≈ 0.022–0.05 Hz) ──
  // wide moving-average (45 s) removes circadian/LF trend; narrow (9 s) removes RSA/HF.
  const ma = (src,half)=>{ const o=new Float64Array(M); let acc=0;
    for(let s=0;s<M;s++){ acc+=src[s]; if(s>2*half) acc-=src[s-2*half-1]; const c=Math.min(s,2*half)+1; o[Math.max(0,s-half)]=acc/c; }
    // simpler centered pass
    const o2=new Float64Array(M); for(let s=0;s<M;s++){ let a=0,n=0; for(let k=-half;k<=half;k++){const u=s+k; if(u>=0&&u<M){a+=src[u];n++;}} o2[s]=a/n; } return o2; };
  const lo = ma(sm, 23);            // removes < ~0.022 Hz (slow trend)
  const hiCut = ma(sm, 4);          // keeps up to ~0.05 Hz, removes RSA
  const res = new Float64Array(M); for(let s=0;s<M;s++) res[s]=hiCut[s]-lo[s];   // apnea-band signal
  // ── envelope (smoothed |res|) → only sustained oscillation trains count as CVHR ──
  const env = new Float64Array(M);
  for (let s=0;s<M;s++){ let a=0,n=0; for(let k=-12;k<=12;k++){const u=s+k; if(u>=0&&u<M){a+=Math.abs(res[u]);n++;}} env[s]=a/n; }
  const ENV_ON = 2.6;               // bpm — sustained-oscillation gate
  // detect dip→rebound cycles ONLY where the envelope says a train is active
  const events = [];
  let lastT = -100;
  for (let s=8; s<M-8; s++){
    if (env[s] < ENV_ON) continue;                        // not a sustained oscillation → skip (rejects sporadic LF)
    if (res[s] < res[s-1] && res[s] <= res[s+1] && res[s] < -2.4){
      let pk=-Infinity, pkAt=-1;
      for (let u=s+8; u<Math.min(M, s+48); u++){ if (res[u]>pk){ pk=res[u]; pkAt=u; } }
      const amp = pk - res[s];
      const period = pkAt - s;
      if (amp >= 5 && period >= 14 && period <= 46 && s-lastT > 14){
        events.push({ sec:s, ampBpm:+amp.toFixed(1), periodSec:period });
        lastT = s;
      }
    }
  }
  // CVHR index = events per hour
  const hours = tEnd/3600;
  const index = hours>0 ? +(events.length/hours).toFixed(1) : 0;
  return { events, index, hrSeries: Array.from(sm), resSeries: Array.from(res), M };
}

// ════════════════════════════════════════════════════════════════════════
//  CARDIORESPIRATORY SLEEP STAGING (HRV + EDR, simplified).
//  Per-epoch features → Wake / REM / Light(N1-N2) / Deep(N3) with smoothing.
// ════════════════════════════════════════════════════════════════════════
function stageSleep(epochs){
  if (!epochs.length) return [];
  const rmAll = epochs.map(e=>e.rmssd);
  const hrAll = epochs.map(e=>e.hr);
  const rmMed = median(rmAll), hrMed = median(hrAll), hrSd = std(hrAll)||1;
  const raw = epochs.map(e=>{
    const hrZ = (e.hr - hrMed)/hrSd;
    const lfhf = e.lfhf;
    let stage;
    if (hrZ > 1.1 || e.rmssd < rmMed*0.45) stage = 'Wake';
    else if (lfhf > 2.2 && e.rmssd < rmMed*0.85) stage = 'REM';
    else if (e.rmssd > rmMed*1.12 && e.hr < hrMed) stage = 'Deep';
    else stage = 'Light';
    return stage;
  });
  // smooth: majority of ±1 neighbours
  const order = { Wake:3, REM:2, Light:1, Deep:0 };
  const sm = raw.slice();
  for (let i=1;i<raw.length-1;i++){ if (raw[i-1]===raw[i+1] && raw[i]!==raw[i-1]) sm[i]=raw[i-1]; }
  return epochs.map((e,i)=>({ tMin:e.tMin, stage:sm[i], y:order[sm[i]] }));
}

// ════════════════════════════════════════════════════════════════════════
//  GANGLIOR EVENTS — emit canonical bus events.
//  conf = EVENT LIKELIHOOD (scaled to CVHR surge magnitude); sqi = local signal
//  quality, emitted SEPARATELY so the fusion layer can weight likelihood by
//  quality instead of conflating the two (R7). Older consumers that read only
//  `conf` still get a sensible, severity-bearing number.
// ════════════════════════════════════════════════════════════════════════
function gangliorEvents(cvhr, stages, t0Ms, sqi, times, epochPos){
  const events = [];
  // Clock Contract §2.6: a missing anchor must be VISIBLE (null), never fabricated.
  // No t0 → emit t:null / tMs:null (date-unknown) so the export's startEpochMs:null and
  // the events agree; deterministic (two exports of the same stampless file match).
  const hasT0 = (t0Ms!=null);
  const clock = (sec)=>{ if(!hasT0) return null; const d=new Date(t0Ms + sec*1000); const _p=x=>String(x).padStart(2,'0'); return _p(d.getUTCHours())+':'+_p(d.getUTCMinutes())+':'+_p(d.getUTCSeconds()); };
  // absolute floating wall-clock ms per event (Clock Contract §6 "new emitters SHOULD write tMs"); null when stampless.
  const tmsAt = (sec)=> hasT0 ? (t0Ms + Math.round(sec*1000)) : null;
  // body position at a given second: the covering 5-min epoch's posture (companion ACC).
  // null when no ACC was loaded, so consumers can distinguish 'no data' from 'unknown posture'.
  const posAt = (sec)=>{
    if (!epochPos || !epochPos.length) return null;
    const m = sec/60; let best=null, bd=Infinity;
    for (const p of epochPos){ const d=Math.abs(p.tMin+2.5 - m); if (m>=p.tMin && m<p.tMin+5){ return p.position; } if (d<bd){ bd=d; best=p; } }
    return best ? best.position : null;
  };
  // local SQI near a time
  const sqiAt = (sec)=>{ // nearest beat
    let lo=0,hi=times.length-1,best=0;
    for (let k=0;k<times.length;k++){ if (Math.abs(times[k]-sec) < Math.abs(times[best]-sec)) best=k; }
    // average SQI of a 10 s window
    let a=0,c=0; for(let k=0;k<times.length;k++){ if(Math.abs(times[k]-sec)<5){ a+=sqi[k]; c++; } }
    return c? a/c : sqi[best]||0.5;
  };
  // CVHR surge magnitude → likelihood. Amplitudes run ~6–22 bpm; map monotonically
  // into 0.45–0.95 so a strong cyclic surge scores higher than a weak one. SQI no
  // longer leaks into conf — it rides alongside as its own field.
  const surgeConf = (ampBpm)=> +Math.max(0.45, Math.min(0.95, 0.45 + Math.min(ampBpm||0, 24)/48)).toFixed(2);
  for (const ev of cvhr.events){
    events.push({ t: clock(ev.sec), tMs: tmsAt(ev.sec), impulse:'autonomic_surge', node:'ECGDex',
                  _sec: ev.sec,                          // internal: enables late-ACC position re-stamp (stripped on export)
                  conf: surgeConf(ev.ampBpm),
                  sqi: +sqiAt(ev.sec).toFixed(2),
                  meta:{ ampBpm:ev.ampBpm, periodSec:ev.periodSec,
                         position:posAt(ev.sec),        // supine posture worsens OSA → fusion can weight osaConf/AHI
                         osaLabel:null, osaConf:null,    // reserved: Almarshad 2026 transformer (Phase 2)
                         deltaSBP:null } });             // reserved: BioZDex fusion
  }
  // sleep stage transitions as lower-priority events (model confidence, quality-neutral)
  let prev=null;
  for (const s of stages){
    if (s.stage!==prev){ events.push({ t:clock(s.tMin*60), tMs:tmsAt(s.tMin*60), impulse:'stage_'+s.stage.toLowerCase(),
                          node:'ECGDex', conf:0.7, sqi:null, meta:{} }); prev=s.stage; }
  }
  // stable order: by relative seconds when stampless (t is null), else by clock string.
  events.sort((a,b)=> (a.tMs!=null&&b.tMs!=null) ? a.tMs-b.tMs : (a.t<b.t?-1:1));
  return events;
}

// ════════════════════════════════════════════════════════════════════════
//  ACTIVITY-GATED MODE CLASSIFIER  (AMBULATORY-MODE-BRIEF §1)
//  The mode decision must consult the activity/gait/ACC evidence the node ALREADY
//  computes — a high-motion daytime walk must NOT fall through a duration/time-of-day
//  heuristic into "overnight" and unlock sleep-only analyses. Activity WINS: when
//  sustained gait or ACC-wake dominates, the recording is `ambulatory` and the
//  duration/time heuristic cannot override it. Low-activity records keep the existing
//  overnight / nap / short-reading classes. Decision is recorded transparently in modeWhy.
// ════════════════════════════════════════════════════════════════════════
function classifyMode(durSec, t0Ms, accEx, longRec){
  const durMin = durSec/60;
  const _p = x=>String(x).padStart(2,'0');
  let clockStr = '—';
  // floating wall-clock → read with UTC getters (Clock Contract §5) so time-of-day is
  // viewer-timezone-independent.
  if (t0Ms!=null){ const d=new Date(t0Ms); clockStr = _p(d.getUTCHours())+':'+_p(d.getUTCMinutes()); }

  // ── activity evidence (all from ACC the node already computes) ──
  let steps=0, briskPct=0, cadencePresentPct=0, accWakePct=null;
  const gait = accEx && accEx.gait;
  if (gait && gait.walking){
    steps = gait.totalSteps||0;
    if (gait.zonePct) briskPct = gait.zonePct.filter(z=>z.zone==='Brisk walk'||z.zone==='Vigorous').reduce((s,z)=>s+(z.pct||0),0);
    if (gait.cadEpochs && gait.cadEpochs.length){
      const act = gait.cadEpochs.filter(c=>c.cadence>=20).length;       // ≥20 steps/min epoch = ambulatory
      cadencePresentPct = Math.round(act/gait.cadEpochs.length*100);
    }
  }
  const cons = accEx && accEx.consensus;
  if (cons && cons.voteRows && cons.voteRows.length){
    const w = cons.voteRows.filter(v=>v.vote==='Wake (motion)').length;  // sleepStageConsensus ACC vote
    accWakePct = Math.round(w/cons.voteRows.length*100);
  }

  // sustained activity → ambulatory. The duration/time-of-day heuristic CANNOT override this.
  const sustainedGait   = (steps>=500 && cadencePresentPct>=30);
  const accWakeDominant = (accWakePct!=null && accWakePct>=75);
  const ambulatory = sustainedGait || accWakeDominant;

  // auditable activity scalar 0..1 (any strong channel saturates it)
  const sStep  = Math.min(1, steps/2500);
  const sBrisk = Math.min(1, briskPct/20);
  const sCad   = Math.min(1, cadencePresentPct/50);
  const sWake  = accWakePct!=null ? Math.min(1, accWakePct/85) : 0;
  const activityScore = +Math.max(sStep, sBrisk, sCad, sWake).toFixed(2);

  let mode, modeLabel, modeWhy, modeConf;
  if (ambulatory){
    mode='ambulatory'; modeLabel='🚶 Ambulatory';
    const bits = [];
    if (steps) bits.push('gait '+steps+' steps'+(briskPct?', '+briskPct+'% brisk':''));
    if (accWakePct!=null) bits.push('ACC-wake '+accWakePct+'%');
    modeWhy = 'ambulatory: '+(bits.join('; ')||'sustained motion')+' — overnight veto';
    modeConf = Math.round(Math.max(0.7, activityScore)*100);
  } else if (longRec){
    mode='overnight'; modeLabel='🌙 Overnight';
    modeWhy = (durMin/60).toFixed(1)+' h from '+clockStr; modeConf=90;
  } else if (durMin>=20){
    mode='nap'; modeLabel='😴 Nap';
    modeWhy = Math.round(durMin)+' min from '+clockStr; modeConf=80;
  } else {
    mode='short-reading'; modeLabel='⏱ Short reading';
    modeWhy = Math.round(durMin)+' min reading'; modeConf=80;
  }
  return { mode, modeLabel, modeWhy, modeConf, ambulatory, activityScore,
           suppressReason:'high-activity / ambulatory',
           activity:{ steps, briskPct, cadencePresentPct, accWakePct } };
}

// ════════════════════════════════════════════════════════════════════════
//  FULL PIPELINE — orchestrates everything from an Int16 ECG buffer.
//  onProgress(pct,msg) optional.
// ════════════════════════════════════════════════════════════════════════
function analyze(rec, onProgress){
  const prog = onProgress || (()=>{});
  const { int16, fs } = rec;
  prog(8, 'Band-passing 5–15 Hz…');
  const bp = bandpass(int16, fs);
  prog(20, 'Pan-Tompkins R-peak detection…');
  const peaks = detectPeaks(int16, bp, fs);
  if (peaks.length < 12) throw new Error('Too few R-peaks detected — signal may be flat or not ECG.');
  const peaksB = detectPeaksB(bp, fs);
  prog(34, 'Sub-sample peak refinement…');
  const { times, refIdx } = refinePeaks(bp, peaks, fs);
  prog(46, 'Per-beat signal-quality scoring…');
  const { sqi, rr } = computeSQI(int16, fs, peaks, times, peaksB);
  prog(56, 'Gating + NN interpolation…');
  const nnRes = buildNN(times, rr, sqi);
  const nn = Array.from(nnRes.nn), tt = Array.from(nnRes.tt);
  const N = nn.length;

  prog(64, 'HRV suite…');
  const meanRR = mean(nn), sdnn = std(nn), rm = rmssd(nn), pn = pnn50(nn);
  const hr = +(60000/meanRR).toFixed(1);
  // Duration = ACTIVE (beat-covered) time, not raw span. Stray beats detected in
  // noise hours after the strap comes off must NOT inflate duration or the tier.
  const spanSec = nnRes.spanSec || (tt[N-1]||0);
  const durSec = nnRes.activeSec > 0 ? nnRes.activeSec : (tt[N-1] || rec.durSec || (N*meanRR/1000));
  const longRec = durSec >= 90*60;
  const lowCoverage = nnRes.coveragePct != null && nnRes.coveragePct < 80;

  prog(72, '5-min epoch engine…');
  const epochs = epochEngine(nn, tt, 300);

  // representative window for advanced metrics (epoch with rmssd closest to median)
  let repSeg = nn, repT = tt, repTMin = null, repIdx = null;
  if (epochs.length >= 3){
    const rmA = epochs.map(e=>e.rmssd), rmMed = median(rmA);
    let bi=0,bd=Infinity; for(let i=0;i<rmA.length;i++){ const d=Math.abs(rmA[i]-rmMed); if(d<bd){bd=d;bi=i;} }
    // rebuild the representative segment beats from tt window
    const w0=epochs[bi].tMin*60, w1=w0+300, seg=[], segT=[];
    for (let i=0;i<N;i++){ if (tt[i]>=w0 && tt[i]<w1){ seg.push(nn[i]); segT.push(tt[i]); } }
    if (seg.length>=20){ repSeg=seg; repT=segT; repTMin=epochs[bi].tMin; repIdx=bi; }
  }

  // aggregate display values (long rec → per-epoch medians)
  let dispRm=+rm.toFixed(1), dispSd=+sdnn.toFixed(1), dispHr=hr, dispPn=+pn.toFixed(1), sdann=null, sdnnIdx=null;
  if (longRec && epochs.length>=3){
    dispRm=+median(epochs.map(e=>e.rmssd)).toFixed(1);
    dispSd=+median(epochs.map(e=>e.sdnn)).toFixed(1);
    dispHr=+median(epochs.map(e=>e.hr)).toFixed(1);
    dispPn=+median(epochs.map(e=>e.pnn)).toFixed(1);
    sdann=+std(epochs.map(e=>e.meanRR)).toFixed(1);
    sdnnIdx=+mean(epochs.map(e=>e.sdnn)).toFixed(1);
  }

  prog(80, 'Spectral (Lomb–Scargle)…');
  // Robust whole-record respiratory-rate scalar = MEDIAN of per-epoch EDR estimates.
  // The single-window HF peak (peakF·60) can latch onto a transient fast-breathing
  // burst and over-report — e.g. 21.3 bpm when the epoch median is 15.3. Compute it
  // ONCE so the long-record spectrum, the short-record representative spectrum, and
  // cardiorespiratory coupling all report the same value. (Also fixes a latent
  // `||[0]` no-op — an empty array is truthy — that risked median([])→NaN.)
  const _respEpoch = epochs.filter(e=>e.resp>0).map(e=>e.resp);
  const _respMedian = _respEpoch.length>=3 ? +median(_respEpoch).toFixed(1) : null;

  let spec;
  if (longRec && epochs.length>=3){
    spec = { tp:Math.round(median(epochs.map(e=>e.hf+e.lf))), hf:Math.round(median(epochs.map(e=>e.hf))),
             lf:Math.round(median(epochs.map(e=>e.lf))), vlf:0,
             lfhf:+median(epochs.map(e=>e.lfhf)).toFixed(3),
             respRate: _respMedian!=null ? _respMedian : 0 };
    const whole = lombScargle(nn, tt, 220); spec.vlf = whole.vlf; spec.tp = whole.tp;
  } else {
    spec = lombScargle(repSeg, repT, 300);
    // prefer the per-epoch median over the single representative-window HF peak
    if (_respMedian!=null) spec.respRate = _respMedian;
  }

  prog(86, 'Non-linear (DFA · SampEn · fragmentation)…');
  const dfa1 = dfaAlpha1(repSeg);
  const sampen = sampEn(repSeg, 2, 0.2*std(repSeg));
  const triIdx = triangularIndex(nn);
  const dc = prsaCapacity(nn, 1), ac = prsaCapacity(nn, -1);
  const frag = fragmentation(nn) || { pip:null, ials:null, pss:null };
  // Poincaré — geometric SD1/SD2 from the exact array that gets plotted.
  // Overnight: use the representative 5-min window (standard short-term Poincaré, norms apply);
  // shorter records: use the whole NN series. Guarantees ellipse == cloud.
  const poincareNN = (longRec && repSeg.length >= 20) ? repSeg : nn;
  const pg = poincareGeo(poincareNN);
  const sd1v = +pg.sd1.toFixed(2), sd2v = +pg.sd2.toFixed(2);

  prog(92, 'CVHR / apnea detection…');
  const cvhrRaw = detectCVHR(nn, tt);
  const stages = longRec ? stageSleep(epochs) : [];

  // ── activity-gated mode (AMBULATORY-MODE-BRIEF §1) ───────────────────────────
  // Consult the activity/gait/ACC evidence ALREADY computed before letting duration/
  // time-of-day unlock sleep-only analyses. accExtras (gait + sleep-stage consensus) is
  // computed once here and cached on the result so the UI/export reuse it (no 2nd pass).
  const _accEx = (rec.deviceACC && rec.accFs && rec.deviceACC.length >= rec.accFs*30 && accExtras)
    ? accExtras(rec.deviceACC, rec.accFs, rec.t0Ms, durSec, epochs, stages) : null;
  const modeInfo = classifyMode(durSec, rec.t0Ms, _accEx, longRec);
  const ambulatory = modeInfo.ambulatory;

  // suppress-with-reason (NOT delete): a walk is not a sleep study, but consumers must
  // never hit a missing field — emit a present, explicitly-suppressed shape instead.
  const sleepSuppressed = ambulatory
    ? { suppressed:true, suppressedReason:modeInfo.suppressReason, stages:null } : null;
  const apneaSuppressed = ambulatory
    ? { reportable:false, suppressedReason:modeInfo.suppressReason, cvhrIndex:null, estimatedAHI:null } : null;

  // CVHR apnea screen is invalid under exercise → withhold the index/events. The HR series
  // is kept (heart rate IS valid for a walk); only the apnea interpretation is suppressed.
  const cvhr = ambulatory
    ? { index:null, events:[], hrSeries:cvhrRaw.hrSeries, resSeries:cvhrRaw.resSeries, M:cvhrRaw.M, suppressed:true }
    : cvhrRaw;
  const hrvStab  = (longRec && !ambulatory) ? hrvStability(epochs) : null;          // Li/Kiyono 2026 (nocturnal-only)
  const surgeEsc = (longRec && !ambulatory) ? surgeEscalation(cvhrRaw.events, durSec) : null;

  // Cardiorespiratory coupling (EDR ⟷ RR) — RSA efficiency · CRC PLV · coupling strength.
  // Zero new sensors: EDR comes from the same ECG. Per-epoch PLV cross-references CVHR.
  const crc = cardiorespCoupling(nn, tt, int16, refIdx, fs, spec.respRate, epochs);
  if (crc && crc.epochCRC.length && cvhr.events.length){
    const surgeMin = cvhr.events.map(e=>e.sec/60);
    const sIn=[], sOut=[];
    for (const ec of crc.epochCRC){
      const has = surgeMin.some(m => m>=ec.tMin && m<ec.tMin+5);
      (has?sIn:sOut).push(ec.plv);
    }
    crc.plvDuringSurges = sIn.length ? +mean(sIn).toFixed(3) : null;
    crc.plvBaseline     = sOut.length ? +mean(sOut).toFixed(3) : null;
  }
  // per-epoch respiratory-rate spread (EDR) — CPAPDex can flag resp-rate instability without airflow
  const respVals = epochs.filter(e=>e.resp>0).map(e=>e.resp);
  const respStats = respVals.length>=3
    ? { n:respVals.length, min:+arrMin(respVals).toFixed(1), max:+arrMax(respVals).toFixed(1),
        median:+median(respVals).toFixed(1), sd:+std(respVals).toFixed(2) }
    : null;

  prog(94, 'Morphology · ectopy · rhythm…');
  let morph = null;
  if (global.ECGMorph){
    try { morph = global.ECGMorph.analyze(int16, bp, fs, refIdx, rr, Array.from(sqi)); }
    catch(e){ morph = null; }
  }

  prog(96, 'Ganglior events…');
  // per-epoch body position from companion ACC (mutates epochs → epoch.position; feeds event meta)
  const epochPos = stampEpochPositions(epochs, rec.deviceACC, rec.accFs, rec.t0Ms, durSec);
  // Clock Contract §2.6: thread the real anchor (or null) — NEVER fabricate now(). A stampless
  // recording yields events with t:null/tMs:null, matching the export's startEpochMs:null.
  const events = gangliorEvents(cvhr, ambulatory?[]:stages, rec.t0Ms!=null?rec.t0Ms:null, sqi, times, epochPos);

  // sleep stage summary
  const stageMin = { Wake:0, REM:0, Light:0, Deep:0 };
  stages.forEach((s,i)=>{ const dur = (i<stages.length-1? (stages[i+1].tMin-s.tMin):5); stageMin[s.stage]+=dur; });
  const totSleep = stageMin.REM+stageMin.Light+stageMin.Deep;

  // validity tier
  const durMin = durSec/60;
  let tier, tierMsg;
  if (durMin < 2){ tier='insufficient'; tierMsg='< 2 min — HRV not reliable'; }
  else if (durMin < 5){ tier='ultra-short'; tierMsg='Ultra-short: HR · rMSSD · pNN50 · SD1 · HF valid; SDNN/LF/VLF/LF:HF withheld'; }
  else if (durMin < 90){ tier='short'; tierMsg='5-min standard: full short-term suite valid (Task Force 1996)'; }
  else { tier='overnight'; tierMsg='Overnight: + VLF · DFA α1 · CVHR/apnea · sleep staging'; }
  if (lowCoverage){
    tierMsg += ` · ⚠ only ${nnRes.coveragePct}% beat coverage across a ${(spanSec/60).toFixed(0)}-min span (${nnRes.nGaps} gap${nnRes.nGaps===1?'':'s'}, ${(nnRes.gapSec/60).toFixed(0)} min off-body) — metrics reflect the ${durMin.toFixed(0)} min of usable signal only`;
  }

  prog(100, 'Done');

  return {
    source: rec.source, fs, durSec, durMin:+durMin.toFixed(1), longRec, tier, tierMsg,
    mode: modeInfo.mode, modeLabel: modeInfo.modeLabel, modeWhy: modeInfo.modeWhy, modeConf: modeInfo.modeConf,
    ambulatory, activityScore: modeInfo.activityScore, activity: modeInfo.activity,
    sleepSuppressed, apneaSuppressed, _accEx,
    t0Ms: rec.t0Ms,
    // raw refs for canvas + charts
    int16, bp, peaks, refIdx, times: Array.from(times), sqi: Array.from(sqi),
    nn, tt, corrected: Array.from(nnRes.corrected),
    // quality
    analyzablePct: nnRes.analyzablePct, correctionRate: nnRes.correctionRate, nCorrected: nnRes.nCorrected, nEctopyCorrected: nnRes.nEctopyCorrected,
    cleanBeatPct: nnRes.cleanBeatPct, coveragePct: nnRes.coveragePct, nGaps: nnRes.nGaps,
    spanMin:+(spanSec/60).toFixed(1), gapMin:+(nnRes.gapSec/60).toFixed(1), activeMin:+(nnRes.activeSec/60).toFixed(1), lowCoverage,
    nBeats: N, meanSQI:+(mean(Array.from(sqi))).toFixed(3),
    // time domain
    hr, meanRR:+meanRR.toFixed(1), sdnn:+sdnn.toFixed(1), rmssd:+rm.toFixed(1), pnn50:+pn.toFixed(1),
    nn50: nn50c(nn), cv:+(sdnn/meanRR*100).toFixed(2), minRR:+arrMin(nn).toFixed(0), maxRR:+arrMax(nn).toFixed(0),
    medianRR:+median(nn).toFixed(0), q25:+quant(nn,.25).toFixed(0), q75:+quant(nn,.75).toFixed(0),
    dispRm, dispSd, dispHr, dispPn, sdann, sdnnIdx,
    // poincaré
    sd1:sd1v, sd2:sd2v, sd1sd2:+(sd1v/(sd2v||1)).toFixed(3), ellArea:+(Math.PI*sd1v*sd2v).toFixed(0),
    poincareNN, poincareRep: (longRec && repSeg.length>=20), poincareRepTMin: repTMin, poincareRepIdx: repIdx,
    // frequency
    tp:spec.tp, hf:spec.hf, lf:spec.lf, vlf:spec.vlf, lfhf:spec.lfhf, respRate:spec.respRate, respStats,
    hfnu:+(spec.hf/((spec.hf+spec.lf)||1)*100).toFixed(1), lfnu:+(spec.lf/((spec.hf+spec.lf)||1)*100).toFixed(1),
    // non-linear
    dfa1, sampen, triIdx, dc, ac, pip:frag.pip, ials:frag.ials, pss:frag.pss,
    lnrmssd:+Math.log(longRec?dispRm:rm).toFixed(3),
    // epochs + sleep + cvhr + events
    epochs, stages, stageMin, totSleep:+totSleep.toFixed(0),
    cvhr: { index: cvhr.index, events: cvhr.events, hrSeries: cvhr.hrSeries, resSeries: cvhr.resSeries },
    hrvStab, surgeEsc, crc,
    events,
    // morphology · ectopy · rhythm · AF screen
    morph,
    // device cross-check inputs (synthetic carries ground truth)
    deviceRR: rec.deviceRR || null,
    deviceHR: rec.deviceHR || null,
    deviceACC: rec.deviceACC || null,
    accFs: rec.accFs || null,
    t0Ms: rec.t0Ms || null
  };
}

// ─── self-RR vs device-RR validation ─────────────────────────────────────────
// Malik 20% local-median correction — same rule buildNN now applies to selfNN, so the
// comparison is corrected-vs-corrected (apples-to-apples). Without this, a device that
// leaves ectopy/missed-beats in its RR (Polar does) shows a false 40%+ rMSSD "mismatch".
function _malikCorrect(vals){
  const n=vals.length, out=vals.slice(), W=5; let nc=0;
  for(let i=0;i<n;i++){ const seg=[];
    for(let j=Math.max(0,i-W);j<=Math.min(n-1,i+W);j++){ if(j!==i && vals[j]>=300 && vals[j]<=2200) seg.push(vals[j]); }
    seg.sort((a,b)=>a-b); const med=seg.length?seg[seg.length>>1]:0; const dev=med?Math.abs(vals[i]-med)/med:0;
    if(vals[i]<300||vals[i]>2200||dev>0.20){ out[i]=med||out[i-1]||1000; nc++; } }
  return { out, nc };
}
function validateRR(selfNN, deviceRR){
  if (!deviceRR || !deviceRR.length) return null;
  const devRaw = deviceRR.map(d=>d.rr);
  const devC = _malikCorrect(devRaw);                 // correct device RR the same way as selfNN
  const devVals = devC.out;
  const selfRMSSD = rmssd(selfNN), devRMSSD = rmssd(devVals);
  const selfSDNN = std(selfNN), devSDNN = std(devVals);
  const selfMean = mean(selfNN), devMean = mean(devVals);
  return {
    nSelf: selfNN.length, nDev: devVals.length,
    devEctopyCorrected: devC.nc, devRawRMSSD:+rmssd(devRaw).toFixed(1),
    selfRMSSD:+selfRMSSD.toFixed(1), devRMSSD:+devRMSSD.toFixed(1), dRMSSD:+(Math.abs(selfRMSSD-devRMSSD)/devRMSSD*100).toFixed(1),
    selfSDNN:+selfSDNN.toFixed(1), devSDNN:+devSDNN.toFixed(1), dSDNN:+(Math.abs(selfSDNN-devSDNN)/devSDNN*100).toFixed(1),
    selfMean:+selfMean.toFixed(1), devMean:+devMean.toFixed(1), dMean:+(Math.abs(selfMean-devMean)/devMean*100).toFixed(2),
    selfHR:+(60000/selfMean).toFixed(1), devHR:+(60000/devMean).toFixed(1)
  };
}

// ─── self-HR vs device-HR cross-check ────────────────────────────────────────
function _rollMedian(x, win){
  const n=x.length, half=win>>1, o=new Float64Array(n);
  for(let i=0;i<n;i++){ const s=[]; for(let k=-half;k<=half;k++){ const u=i+k; if(u>=0&&u<n&&isFinite(x[u])) s.push(x[u]); }
    if(!s.length){ o[i]=x[i]; continue; } s.sort((a,b)=>a-b); o[i]=s[s.length>>1]; }
  return o;
}
function _alignDevSeconds(rows, ecgT0Ms, durSec){
  if (!rows || !rows.length) return [];
  let inWin = 0;
  if (ecgT0Ms) for (const r of rows){ const s=(r.tsMs-ecgT0Ms)/1000; if (s>=-2 && s<=durSec+2) inWin++; }
  const base = (ecgT0Ms && inWin > rows.length*0.5) ? ecgT0Ms : rows[0].tsMs;
  return rows.map(r=>({ sec:(r.tsMs-base)/1000, row:r }));
}
function validateHR(ecgHrSeries, deviceHR, ecgT0Ms){
  if (!ecgHrSeries || !ecgHrSeries.length || !deviceHR || !deviceHR.length) return null;
  const M = ecgHrSeries.length;
  const aligned = _alignDevSeconds(deviceHR, ecgT0Ms, M);
  const dev = new Float64Array(M).fill(NaN);
  for (const a of aligned){ const s=Math.round(a.sec); if (s>=0 && s<M) dev[s]=a.row.hr; }
  let last=NaN; for (let s=0;s<M;s++){ if (isFinite(dev[s])) last=dev[s]; else if (isFinite(last)) dev[s]=last; }
  // device HR is firmware-smoothed; smooth the ECG instantaneous HR the same way + clip
  // to a physiological window around the record's own median so artifact false-peaks
  // (burst-noise spans → spurious 150–180 bpm) don't pollute the comparison.
  const rawVals = Array.from(ecgHrSeries).filter(h=>h>=30&&h<=220);
  const hrMed = rawVals.length? median(rawVals) : 60;
  const lo = Math.max(30, hrMed-45), hi = Math.min(210, hrMed+45);
  const ecgC = Float64Array.from(ecgHrSeries, h => (h>=lo&&h<=hi)? h : NaN);
  const devC = Float64Array.from(dev, h => (h>=lo&&h<=hi)? h : NaN);
  const ecgS = _rollMedian(ecgC, 9), devS = _rollMedian(devC, 9);
  // EXCLUDE the electrode-settling lead-in from the CORRELATION (not the overlay): the first
  // ~60 s after strap-on is unreliable on BOTH sensors and, moving in opposite directions
  // (ECG-derived rising as the device dips), drags r toward zero. Only on records long enough
  // that 60 s is a negligible fraction.
  const lead = (M > 300) ? 60 : 0;
  const xs=[], ys=[];
  for (let s=lead;s<M;s++){ const e=ecgS[s], d=devS[s]; if (isFinite(e)&&isFinite(d)&&e>30&&d>30){ xs.push(e); ys.push(d); } }
  if (xs.length<10) return null;
  const me=mean(xs), md=mean(ys);
  let num=0,dx=0,dy=0,mae=0,maxe=0;
  for (let i=0;i<xs.length;i++){ const ce=xs[i]-me, cd=ys[i]-md; num+=ce*cd; dx+=ce*ce; dy+=cd*cd;
    const ae=Math.abs(xs[i]-ys[i]); mae+=ae; if(ae>maxe) maxe=ae; }
  const r=(dx>0&&dy>0)? num/Math.sqrt(dx*dy):0;
  // Pearson r is MEANINGLESS when HR was near-constant (tiny variance → noise-dominated) or the
  // window is too short — flag it so a flat overnight stretch never reads as "weak beat
  // detection" (the RR-paired validateRR card is the authoritative agreement check). spreadE/D
  // are the smoothed-HR SDs the consumer uses to explain a flat verdict.
  const sdE=Math.sqrt(dx/xs.length), sdD=Math.sqrt(dy/ys.length);
  const rMeaningful = xs.length>=120 && sdE>=1.5 && sdD>=1.5;
  const step=Math.max(1,Math.floor(M/240)), overlay=[];
  for (let s=0;s<M;s+=step) overlay.push({ t:s, ecg:isFinite(ecgS[s])?+ecgS[s].toFixed(1):null, dev:isFinite(devS[s])?+devS[s].toFixed(1):null });
  return { n:xs.length, ecgMean:+me.toFixed(1), devMean:+md.toFixed(1), dMean:+Math.abs(me-md).toFixed(1),
    mae:+(mae/xs.length).toFixed(1), maxErr:+maxe.toFixed(0), r:+r.toFixed(3), rMeaningful,
    spreadE:+sdE.toFixed(1), spreadD:+sdD.toFixed(1),
    ecgMin:+arrMin(xs).toFixed(0), ecgMax:+arrMax(xs).toFixed(0), devMin:+arrMin(ys).toFixed(0), devMax:+arrMax(ys).toFixed(0), overlay };
}

// ─── device accelerometer: derived respiration + motion/activity ─────────────
// resp rate via autocorrelation of the band-passed chest axis (robust to movement
// noise, unlike zero-crossing counting).
function _autocorrPeriod(x, fs, loSec, hiSec){
  // classic pitch-detection: autocorrelate, skip to the first negative-going zero
  // crossing (past the central lobe), then take the lag of the largest peak. Avoids
  // locking onto half-period sidelobes that fooled a naive global-max search.
  const n=x.length, maxL=Math.min(n-1,Math.round(hiSec*fs)), minL=Math.max(1,Math.round(loSec*fs));
  let denom=0; for(let i=0;i<n;i++) denom+=x[i]*x[i]; if(denom<=0) return null;
  const ac=new Float64Array(maxL+1);
  for(let lag=0;lag<=maxL;lag++){ let s=0; for(let i=0;i+lag<n;i++) s+=x[i]*x[i+lag]; ac[lag]=s/denom; }
  let z=1; while(z<=maxL && ac[z]>0) z++;                 // first zero crossing
  const start=Math.max(z,minL); let best=-1,bestLag=0;
  for(let lag=start;lag<=maxL;lag++){ if(ac[lag]>best){ best=ac[lag]; bestLag=lag; } }
  return (bestLag>0 && best>0.1) ? bestLag/fs : null;
}
function _bandRespACC(x, fs){
  // low-pass ~0.6 Hz then remove the ~<0.12 Hz baseline → isolate the respiratory band
  const lp = _maHalf(x, Math.max(1, Math.round(0.8*fs/2)));
  const base = _maHalf(lp, Math.max(2, Math.round(4*fs/2)));
  const o = new Float64Array(x.length);
  for (let i=0;i<x.length;i++) o[i] = lp[i]-base[i];
  return o;
}
function _posture(gx,gy,gz){
  // classify body position from the gravity (DC) vector. Orientation depends on how the
  // strap sensor is mounted; tilt from horizontal is the robust, mount-independent figure
  // (supine/prone ≈ 0°, upright ≈ 90°). Chest-strap convention: +z = anterior (chest-up).
  const g=Math.hypot(gx,gy,gz)||1, ux=gx/g, uy=gy/g, uz=gz/g;
  const tiltDeg = +(Math.acos(Math.min(1,Math.abs(uz)))*180/Math.PI).toFixed(0);
  let label;
  if (Math.abs(uz) >= 0.70) label = uz>0 ? 'Supine' : 'Prone';
  else if (Math.abs(uy) >= 0.55) label = uy>0 ? 'Upright' : 'Head-down';
  else label = ux>0 ? 'Left side' : 'Right side';
  return { label, tiltDeg };
}
// canonical sleep-position vocabulary shared across nodes (epoch.position + event meta.position).
// Supine posture worsens OSA → consumers (Integrator) can weight osaConf/AHI by position.
// 'Head-down' is sensor-mount noise; folds into 'upright'. Left/Right side → 'lateral'.
function _normPosition(label){
  switch(label){
    case 'Supine':     return 'supine';
    case 'Prone':      return 'prone';
    case 'Left side':
    case 'Right side': return 'lateral';
    case 'Upright':
    case 'Head-down':  return 'upright';
    default:           return 'unknown';
  }
}
// Per-epoch body position from the companion accelerometer's gravity vector.
// Mirrors accAnalyze's window math EXACTLY (same off/baseOffset alignment) so the
// posture timeline shown in the UI and the position stamped on epochs/events agree.
// Mutates each epoch in place (epoch.position) AND returns a sorted [{tMin,position}]
// lookup for event-meta propagation. No ACC → every epoch.position = 'unknown'.
function stampEpochPositions(epochs, deviceACC, accFs, ecgT0Ms, durSec){
  if (!epochs || !epochs.length) return [];
  const fs = accFs||4;
  if (!deviceACC || deviceACC.length < fs*30){
    epochs.forEach(e=>{ e.position = 'unknown'; });
    return epochs.map(e=>({ tMin:e.tMin, position:'unknown' }));
  }
  const xs=deviceACC.map(d=>d.x), ys=deviceACC.map(d=>d.y), zs=deviceACC.map(d=>d.z);
  const baseOffset = (ecgT0Ms && deviceACC[0].tsMs) ? (deviceACC[0].tsMs-ecgT0Ms)/1000 : 0;
  const off = (baseOffset>=-2 && baseOffset<=durSec) ? baseOffset : 0;
  const N = deviceACC.length, out=[];
  for (const e of epochs){
    const s0=Math.max(0,Math.round((e.tMin*60-off)*fs)), s1=Math.min(N,Math.round((e.tMin*60+300-off)*fs));
    const ex=[],ey=[],ez=[];
    for (let i=s0;i<s1;i++){ ex.push(xs[i]); ey.push(ys[i]); ez.push(zs[i]); }
    // need ≥30 s of samples for a trustworthy median gravity vector
    const pos = (ex.length > fs*30) ? _normPosition(_posture(median(ex),median(ey),median(ez)).label) : 'unknown';
    e.position = pos;
    out.push({ tMin:e.tMin, position:pos });
  }
  return out;
}
function accAnalyze(deviceACC, accFs, ecgT0Ms, durSec, epochs){
  const fs = accFs||4;
  if (!deviceACC || deviceACC.length < fs*30) return null;
  const xs=deviceACC.map(d=>d.x), ys=deviceACC.map(d=>d.y), zs=deviceACC.map(d=>d.z);
  // vector-magnitude + timeline alignment
  const vm=new Float64Array(deviceACC.length);
  for (let i=0;i<deviceACC.length;i++) vm[i]=Math.hypot(xs[i],ys[i],zs[i]);
  const baseOffset = (ecgT0Ms && deviceACC[0].tsMs) ? (deviceACC[0].tsMs-ecgT0Ms)/1000 : 0;
  const off = (baseOffset>=-2 && baseOffset<=durSec) ? baseOffset : 0;
  // posture — robust gravity vector (per-axis median) → body position + tilt
  const overall = _posture(median(xs), median(ys), median(zs));
  // respiration: breathing is only cleanly visible when STILL, so locate the quietest
  // ~2-min window (lowest motion) and estimate the dominant respiratory period there.
  const winN = Math.min(vm.length, Math.round(Math.min(durSec,120)*fs));
  let qStart=0, qBest=Infinity;
  if (vm.length>winN){ const stepN=Math.max(1,Math.round(10*fs));
    for (let s=0;s+winN<=vm.length;s+=stepN){ let m=0; for(let i=s;i<s+winN;i++) m+=vm[i]; m/=winN;
      let v=0; for(let i=s;i<s+winN;i++) v+=(vm[i]-m)**2; v/=winN; if(v<qBest){ qBest=v; qStart=s; } } }
  const qEnd=Math.min(vm.length, qStart+winN);
  let bestAxis='x', bestP=-1, bestBand=null;
  for (const [name,arr] of [['x',xs],['y',ys],['z',zs]]){
    const seg=Float64Array.from(arr.slice(qStart,qEnd));
    const b=_bandRespACC(seg, fs); let p=0; for (let i=0;i<b.length;i++) p+=b[i]*b[i];
    if (p>bestP){ bestP=p; bestAxis=name; bestBand=b; }
  }
  const period = bestBand ? _autocorrPeriod(bestBand, fs, 2.5, 10) : null;
  const respRate = period ? +(60/period).toFixed(1) : 0;
  // fixed-bin motion trace (always available, even for short spot recordings)
  const binSec = Math.max(4, Math.round((deviceACC.length/fs)/120)) , motionSeries=[];
  const nb = Math.max(1, Math.floor((deviceACC.length/fs)/binSec));
  for (let b=0;b<nb;b++){ const i0=Math.round(b*binSec*fs), i1=Math.round((b+1)*binSec*fs);
    let m=0,c=0; for(let i=i0;i<Math.min(vm.length,i1);i++){ m+=vm[i]; c++; }
    if(!c) continue; const mn=m/c; let v=0; for(let i=i0;i<Math.min(vm.length,i1);i++) v+=(vm[i]-mn)**2;
    motionSeries.push({ x:+(((b+0.5)*binSec - off)/60).toFixed(2), y:+Math.sqrt(v/c).toFixed(1) }); }
  const mvVals=motionSeries.map(p=>p.y), mvMed=mvVals.length?median(mvVals):0;
  // per-epoch movement + posture timeline
  const actSeries=[], postureSeries=[];
  if (epochs && epochs.length){
    for (const e of epochs){ const s0=Math.round((e.tMin*60-off)*fs), s1=Math.round((e.tMin*60+300-off)*fs);
      const ex=[],ey=[],ez=[],seg=[]; for (let i=Math.max(0,s0);i<Math.min(vm.length,s1);i++){ seg.push(vm[i]); ex.push(xs[i]); ey.push(ys[i]); ez.push(zs[i]); }
      if (seg.length>fs*30){ actSeries.push({ tMin:e.tMin, act:+std(seg).toFixed(1), resp:e.resp||null });
        const pp=_posture(median(ex),median(ey),median(ez)); postureSeries.push({ tMin:e.tMin, label:pp.label, tilt:pp.tiltDeg }); } }
  }
  const acts=actSeries.map(a=>a.act), actMed=acts.length? median(acts):0;
  const highMotion=actSeries.filter(a=>a.act>actMed*2.2).map(a=>a.tMin);
  // time-in-posture + transition count
  const postureTally={}; let transitions=0, prev=null;
  for (const ps of postureSeries){ postureTally[ps.label]=(postureTally[ps.label]||0)+1; if(prev&&prev!==ps.label) transitions++; prev=ps.label; }
  const postureBreakdown = Object.entries(postureTally).map(([label,n])=>({ label, pct:Math.round(n/postureSeries.length*100) })).sort((a,b)=>b.pct-a.pct);
  return { respRate, respAxis:bestAxis, respConfident:!!period, accFs:fs,
    posture:overall.label, tiltDeg:overall.tiltDeg, postureSeries, postureBreakdown, postureTransitions:transitions,
    motionSeries, motionMedian:+mvMed.toFixed(1),
    activitySeries:actSeries, activityMedian:+actMed.toFixed(1), highMotionEpochs:highMotion,
    nSamples:deviceACC.length, durMin:+(deviceACC.length/fs/60).toFixed(1) };
}

// ════════════════════════════════════════════════════════════════════════
//  ACC FULL PIPELINE — RRacc · EDR-agreement · sleep-stage consensus · gait.
//  Adapts the original 200/52-Hz·30-s-epoch brief to the suite's real data:
//  4-Hz synthetic ground-truth ACC + the 5-min epoch engine. Respiration is
//  recovered by FFT on an ~8-Hz working grid (Nyquist far above the 0.45-Hz
//  resp band); steps run at the NATIVE fs and only when the band is resolvable
//  (fs ≥ 7 Hz → Nyquist > 3.5 Hz). All timing stays relative-seconds off the
//  floating t0Ms (Clock Contract) — no Date math here.
// ════════════════════════════════════════════════════════════════════════

// radix-2 iterative in-place FFT (Cooley–Tukey). re/im: Float64Array, len = 2^k.
function _fft(re, im){
  const n = re.length;
  for (let i=1,j=0;i<n;i++){ let bit=n>>1; for(;j&bit;bit>>=1) j^=bit; j^=bit;
    if(i<j){ const tr=re[i];re[i]=re[j];re[j]=tr; const ti=im[i];im[i]=im[j];im[j]=ti; } }
  for (let len=2; len<=n; len<<=1){
    const ang=-2*Math.PI/len, wr0=Math.cos(ang), wi0=Math.sin(ang);
    for (let i=0;i<n;i+=len){ let cr=1, ci=0;
      for (let k=0;k<(len>>1);k++){
        const a=i+k, b=a+(len>>1);
        const tr=re[b]*cr-im[b]*ci, ti=re[b]*ci+im[b]*cr;
        re[b]=re[a]-tr; im[b]=im[a]-ti; re[a]+=tr; im[a]+=ti;
        const ncr=cr*wr0-ci*wi0; ci=cr*wi0+ci*wr0; cr=ncr;
      }
    }
  }
}
// block-mean resample of a magnitude series fsIn → fsOut
function _resampleMag(vm, fsIn, fsOut){
  if (Math.abs(fsIn-fsOut) < 0.51) return Float64Array.from(vm);
  const ratio=fsIn/fsOut, M=Math.max(1,Math.floor(vm.length/ratio)), o=new Float64Array(M);
  for (let i=0;i<M;i++){ const s0=Math.floor(i*ratio), s1=Math.max(s0+1,Math.floor((i+1)*ratio));
    let a=0,c=0; for(let k=s0;k<Math.min(vm.length,s1);k++){ a+=vm[k]; c++; } o[i]=c?a/c:0; }
  return o;
}
// RBJ constant-0-dB bandpass biquad (causal) — used for the step band
function _biquadBand(x, fs, f0, bw){
  const w0=2*Math.PI*f0/fs, Q=f0/bw, sw=Math.sin(w0), cw=Math.cos(w0), alpha=sw/(2*Q);
  let b0=alpha, b1=0, b2=-alpha, a0=1+alpha, a1=-2*cw, a2=1-alpha;
  b0/=a0; b1/=a0; b2/=a0; a1/=a0; a2/=a0;
  const N=x.length, y=new Float64Array(N); let x1=0,x2=0,y1=0,y2=0;
  for(let i=0;i<N;i++){ const xi=x[i], yi=b0*xi+b1*x1+b2*x2-a1*y1-a2*y2; x2=x1; x1=xi; y2=y1; y1=yi; y[i]=yi; }
  return y;
}
// Feature 1 — RRacc per 30-s epoch: detrend (5-s moving avg) → Hann → FFT →
// dominant bin in 0.15–0.45 Hz; SNR = peak / mean(out-of-band), gate at 3 dB.
function _rraccEpochs(vm, fs, off){
  const WR=8, useRs=fs>WR+0.5, wr=useRs?_resampleMag(vm,fs,WR):Float64Array.from(vm), wfs=useRs?WR:fs, N=wr.length;
  const half=Math.max(1,Math.round(2.5*wfs)), d=new Float64Array(N);
  for (let i=0;i<N;i++){ const a=Math.max(0,i-half), b=Math.min(N,i+half+1); let s=0; for(let k=a;k<b;k++) s+=wr[k]; d[i]=wr[i]-s/(b-a); }
  const epochLen=Math.round(30*wfs); if (epochLen<8 || N<epochLen) return [];
  let nf=1; while(nf<epochLen) nf<<=1; nf=Math.min(nf,2048);
  const df=wfs/nf, loBin=Math.max(1,Math.round(0.15/df)), hiBin=Math.min((nf>>1)-1,Math.round(0.45/df)), out=[];
  for (let e=0; (e+1)*epochLen<=N; e++){
    const s0=e*epochLen, re=new Float64Array(nf), im=new Float64Array(nf);
    let mu=0; for(let i=0;i<epochLen;i++) mu+=d[s0+i]; mu/=epochLen;
    for (let i=0;i<epochLen;i++){ const w=0.5-0.5*Math.cos(2*Math.PI*i/(epochLen-1)); re[i]=(d[s0+i]-mu)*w; }
    _fft(re, im);
    const half2=nf>>1, pw=new Float64Array(half2);
    for (let b=1;b<half2;b++) pw[b]=re[b]*re[b]+im[b]*im[b];
    let peak=-1, peakBin=loBin, obSum=0, obN=0;
    for (let b=loBin;b<=hiBin;b++){ if(pw[b]>peak){ peak=pw[b]; peakBin=b; } }
    for (let b=1;b<half2;b++){ if(b<loBin||b>hiBin){ obSum+=pw[b]; obN++; } }
    const obMean=obN?obSum/obN:1e-9, snrDb=10*Math.log10((peak||1e-12)/(obMean||1e-12));
    out.push({ tStartMin:+(((e*30)-off)/60).toFixed(2), rr:+(peakBin*df*60).toFixed(1),
               snrDb:+snrDb.toFixed(1), conf: snrDb>=3?'high':'low' });
  }
  return out;
}
// Feature 4 — step detection + gait on the NATIVE-fs de-gravitated magnitude
function _gait(vm, fs, off){
  const N=vm.length, stepBandOK = fs>=7;
  if (!stepBandOK) return { totalSteps:0, walking:false, reason:'lowfs', accFs:fs, bouts:[], cadEpochs:[], zonePct:[] };
  // vertical proxy: magnitude − 30-s running-mean gravity baseline (prefix sums)
  const win=Math.max(1,Math.round(30*fs)), half=win>>1, ps=new Float64Array(N+1), V=new Float64Array(N);
  for(let i=0;i<N;i++) ps[i+1]=ps[i]+vm[i];
  for(let i=0;i<N;i++){ const a=Math.max(0,i-half), b=Math.min(N,i+half+1); V[i]=vm[i]-(ps[b]-ps[a])/(b-a); }
  const F=_biquadBand(V, fs, Math.sqrt(0.5*3.5), 3.0);
  const minGap=Math.round(0.25*fs), maxGap=Math.round(2.0*fs), peaks=[]; let lastPk=-1e9; const recent=[];
  for (let i=1;i<N-1;i++){ if (F[i]>F[i-1] && F[i]>=F[i+1]){
    const rms=recent.length?Math.sqrt(recent.reduce((s,v)=>s+v*v,0)/recent.length):0, thr=0.6*rms;
    if (F[i]>thr && (i-lastPk)>=minGap){ peaks.push(i); lastPk=i; recent.push(F[i]); if(recent.length>10) recent.shift(); } } }
  // bouts: runs of peaks with gap ≤ maxGap, ≥10 steps
  const bouts=[]; let cur=[];
  for (let k=0;k<peaks.length;k++){
    if (!cur.length){ cur=[peaks[k]]; continue; }
    if (peaks[k]-cur[cur.length-1]<=maxGap) cur.push(peaks[k]);
    else { if(cur.length>=10) bouts.push(cur); cur=[peaks[k]]; } }
  if (cur.length>=10) bouts.push(cur);
  const boutObjs=bouts.map(b=>{ const durS=(b[b.length-1]-b[0])/fs||1, cad=[];
    for(let k=1;k<b.length;k++){ const dt=(b[k]-b[k-1])/fs; if(dt>0) cad.push(60/dt); }
    const mc=cad.length?mean(cad):0, cv=cad.length>1&&mc>0?std(cad)/mc*100:0;
    return { startMin:+(((b[0]/fs)-off)/60).toFixed(2), durSec:+durS.toFixed(0), steps:b.length, cadence:+mc.toFixed(0), cadenceCV:+cv.toFixed(0) }; });
  const totalSteps=boutObjs.reduce((s,b)=>s+b.steps,0);
  const epLen=Math.round(60*fs), cadEp=[];
  for (let e=0; (e+1)*epLen<=N; e++){ const s0=e*epLen, s1=(e+1)*epLen; let c=0; for(const p of peaks){ if(p>=s0&&p<s1) c++; }
    cadEp.push({ tMin:+(((e*60)-off)/60).toFixed(2), cadence:c }); }
  const zoneDef=[['Sedentary',0,20,'gray'],['Low active',20,60,'blue'],['Light walk',60,100,'green'],['Brisk walk',100,120,'amber'],['Vigorous',120,1e9,'red']];
  const zones={}; zoneDef.forEach(z=>zones[z[0]]=0);
  cadEp.forEach(c=>{ for(const z of zoneDef){ if(c.cadence>=z[1]&&c.cadence<z[2]){ zones[z[0]]++; break; } } });
  const totalEp=cadEp.length||1, zonePct=zoneDef.map(z=>({ zone:z[0], col:z[3], pct:Math.round(zones[z[0]]/totalEp*100), epochs:zones[z[0]] }));
  return { totalSteps, walking:totalSteps>=50, accFs:fs, bouts:boutObjs, cadEpochs:cadEp, zonePct };
}
// Orchestrator — returns the four feature payloads (or null if no usable ACC).
function accExtras(deviceACC, accFs, ecgT0Ms, durSec, epochs, stages){
  const fs=accFs||4;
  if (!deviceACC || deviceACC.length < fs*30) return null;
  const N=deviceACC.length, xs=deviceACC.map(d=>d.x), ys=deviceACC.map(d=>d.y), zs=deviceACC.map(d=>d.z);
  const vm=new Float64Array(N); for(let i=0;i<N;i++) vm[i]=Math.hypot(xs[i],ys[i],zs[i]);
  const baseOffset=(ecgT0Ms && deviceACC[0].tsMs)?(deviceACC[0].tsMs-ecgT0Ms)/1000:0;
  const off=(baseOffset>=-2 && baseOffset<=durSec)?baseOffset:0;

  // ── Feature 1: RRacc per 30-s epoch ──
  const rracc=_rraccEpochs(vm, fs, off);
  const hi=rracc.filter(e=>e.conf==='high'), rrVals=hi.map(e=>e.rr);
  const rraccSummary=rracc.length?{ mean:rrVals.length?+mean(rrVals).toFixed(1):null,
    sd:rrVals.length>1?+std(rrVals).toFixed(1):null, highPct:Math.round(hi.length/rracc.length*100), nEpochs:rracc.length }:null;

  // ── Feature 2: RRacc vs EDR agreement (paired at the 5-min EDR cadence) ──
  let agreement=null;
  const edrEp=(epochs||[]).filter(e=>e.resp>0).map(e=>({ tMin:e.tMin, edr:e.resp }));
  if (rracc.length && edrEp.length){
    const pairs=[];
    for (const ep of edrEp){ const inWin=hi.filter(r=>r.tStartMin>=ep.tMin && r.tStartMin<ep.tMin+5);
      if (inWin.length) pairs.push({ acc:median(inWin.map(r=>r.rr)), edr:ep.edr, tMin:ep.tMin }); }
    if (pairs.length>=3){
      const deltas=pairs.map(p=>p.acc-p.edr), md=mean(deltas), sdd=std(deltas), mae=mean(deltas.map(d=>Math.abs(d)));
      const ax=pairs.map(p=>p.acc), ex=pairs.map(p=>p.edr), max=mean(ax), mex=mean(ex);
      let num=0,da=0,de=0; for(let i=0;i<pairs.length;i++){ const va=ax[i]-max, ve=ex[i]-mex; num+=va*ve; da+=va*va; de+=ve*ve; }
      const r=(da>0&&de>0)?num/Math.sqrt(da*de):0, disagree=deltas.filter(x=>Math.abs(x)>3).length;
      agreement={ n:pairs.length, meanDelta:+md.toFixed(2), sdDelta:+sdd.toFixed(2), mae:+mae.toFixed(2),
        r:+r.toFixed(2), disagreeRate:Math.round(disagree/pairs.length*100),
        loa:[+(md-1.96*sdd).toFixed(1),+(md+1.96*sdd).toFixed(1)],
        ba:pairs.map(p=>({ mean:+((p.acc+p.edr)/2).toFixed(1), diff:+(p.acc-p.edr).toFixed(1) })) };
    }
  }

  // ── Feature 3: sleep-stage consensus (ACC motion vote vs HRV stages) ──
  let consensus=null;
  if (epochs && epochs.length && stages && stages.length){
    const stageBy={}; stages.forEach(s=>stageBy[s.tMin.toFixed(1)]=s.stage);
    // GROSS-motion index from jerk (|Δ vector-magnitude|): suppresses the always-present
    // respiratory chest movement + gravity baseline, so only real body movement scores.
    const dmv=new Float64Array(N); for(let i=1;i<N;i++) dmv[i]=Math.abs(vm[i]-vm[i-1]);
    const rawMot=[];
    for (const e of epochs){ const s0=Math.round((e.tMin*60-off)*fs), s1=Math.round((e.tMin*60+300-off)*fs);
      let a=0,c=0; for(let i=Math.max(1,s0);i<Math.min(N,s1);i++){ a+=dmv[i]; c++; }
      rawMot.push({ tMin:e.tMin, act: c>fs*30? a/c : null }); }
    const actVals=rawMot.filter(m=>m.act!=null).map(m=>m.act).slice().sort((a,b)=>a-b);
    const qOf=p=>actVals.length?actVals[Math.min(actVals.length-1,Math.floor(actVals.length*p))]:0;
    const floor=qOf(0.50), top=qOf(0.95), span=Math.max(top-floor,1e-6);   // typical-sleep median → 0, p95 → 100
    let agreed=0,total=0; const conflicts=[], voteRows=[];
    for (const m of rawMot){
      if (m.act==null) continue;
      const hrv=stageBy[m.tMin.toFixed(1)]; if(!hrv) continue;
      const idx=Math.max(0,Math.min(100,(m.act-floor)/span*100)), vote=idx>20?'Wake (motion)':idx>=5?'Ambiguous':'Sleep (still)', hrvWake=hrv==='Wake';
      total++; let status;
      if (vote==='Ambiguous'){ agreed++; status='ambiguous'; }
      else if (hrvWake && vote==='Wake (motion)'){ agreed++; status='confirm-wake'; }
      else if (!hrvWake && vote==='Sleep (still)'){ agreed++; status='confirm-sleep'; }
      else { status='conflict'; conflicts.push({ tMin:m.tMin, hrv, vote, dir: hrvWake?'HRV Wake · ACC still':('HRV '+hrv+' · ACC motion') }); }
      voteRows.push({ tMin:m.tMin, idx:Math.round(idx), vote, hrv, status });
    }
    if (total>=3) consensus={ rate:Math.round(agreed/total*100), n:total, nConflict:conflicts.length, conflicts:conflicts.slice(0,40), voteRows };
  }

  // ── Feature 4: step count & gait ──
  const gait=_gait(vm, fs, off);

  return { rracc, rraccSummary, agreement, consensus, gait, off, accFs:fs, durMin:+(N/fs/60).toFixed(1) };
}

// ── multi-part split files (Polar Sensor Logger) ───────────────────────────
// `…_ECG_part01of05.txt` … `of05` (and split ACC). Each part repeats the header.
// Group by part-stripped base, concatenate in numeric part order (header from
// part 1 only). Pure + DOM-free → unit-tested in both runners. The ECGDex app
// streams primary-ECG part groups into one worker run and uses mergeMultipart
// for the small companion (ACC/RR/HR) text streams.
function partKey(name){
  var m = String(name||'').match(/^(.*)_part(\d+)of(\d+)(\.[^.]*)?$/i);
  return m ? { base: m[1] + (m[4]||''), part:+m[2], total:+m[3] } : null;
}
function mergeMultipart(parsed){           // parsed = [{name,text,kind?,stampMs?}]
  var groups = new Map(), singles = [];
  parsed.forEach(function(f){
    var pk = partKey(f.name);
    if(!pk){ singles.push(f); return; }
    if(!groups.has(pk.base)) groups.set(pk.base, []);
    groups.get(pk.base).push(Object.assign({}, f, { _part: pk.part }));
  });
  var merged = [];
  groups.forEach(function(arr, base){
    arr.sort(function(a,b){ return a._part - b._part; });   // numeric → part2 before part10
    var text = arr[0].text;
    for(var i=1;i<arr.length;i++){
      var lines = arr[i].text.split(/\r?\n/); lines.shift();  // drop repeated header
      text += (text.endsWith('\n')?'':'\n') + lines.join('\n');
    }
    merged.push({ name: base, text: text, kind: arr[0].kind, stampMs: arr[0].stampMs, parts: arr.length });
  });
  return singles.concat(merged);
}

global.ECGDSP = { genSynthetic, analyze, classifyMode, validateRR, validateHR, accAnalyze, accExtras, stampEpochPositions, bandpass, detectPeaks, buildNN, median, mean, std, rmssd, partKey, mergeMultipart, lombScargle, dfaAlpha1, sampEn, parseTimestamp };

// ════════════════════════════════════════════════════════════════════════
//  PURE ECG TEXT PARSER  (headless mirror of the app's streaming worker)
//  ─────────────────────────────────────────────────────────────────────
//  The app streams raw ECG in a Web Worker (built from a Blob so it bundles) —
//  but a Worker cannot run in the co-load realm (Data Unifier / OverDex / the
//  test suite), so the headless compute() path needs a PURE, DOM-free parser
//  for the SAME Polar Sensor Logger `*_ECG.txt` layout the worker reads:
//    Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]   (~130 Hz)
//  Behaviour mirrors WORKER_SRC / parseTSfloat in ecgdex-app.js byte-for-byte:
//  last column = µV sample (clamped Int16), first column = Phone-timestamp →
//  t0Ms (via the LOCAL parseTimestamp — Clock Contract §2, no fabrication), and
//  the `timestamp [ms]` column (index 2) sets fs from its step. NB the app's
//  ingest substitutes _floatNow() when a file carries no stamp; the headless
//  parser does NOT — a stampless file keeps t0Ms:null (Clock Contract §2.6: a
//  missing anchor stays visible, never now()), and gangliorEvents already emits
//  t:null/tMs:null for that case. Returns the SAME rec shape genSynthetic/the
//  worker hand analyze(): { int16, fs, gaps, t0Ms, offsetMin, source, durSec }.
// ════════════════════════════════════════════════════════════════════════
function parseECGText(text){
  var lines = String(text == null ? '' : text).split(/\r?\n/);
  var cap = 1 << 16, arr = new Int16Array(cap), n = 0;
  var t0Ms = null, offsetMin = null, fs = 130, prevMs = null, msStep = null;
  var gaps = [];
  function push(v){ if (n >= cap){ cap *= 2; var na = new Int16Array(cap); na.set(arr); arr = na; } arr[n++] = v; }
  for (var li = 0; li < lines.length; li++){
    var line = lines[li].trim(); if (!line) continue;
    var p = line.split(/[;\t,]/);
    var v = parseFloat(p[p.length - 1]);
    if (!isFinite(v)) continue;                          // header / junk row (non-numeric last column)
    push(Math.max(-32768, Math.min(32767, Math.round(v))));
    if (t0Ms === null){ var pt = parseTimestamp(p[0]); if (pt && pt.tMs != null){ t0Ms = pt.tMs; offsetMin = (pt.offsetMin != null ? pt.offsetMin : null); } }
    if (p.length >= 3){
      var ms = parseFloat(p[2]);
      if (isFinite(ms)){
        if (prevMs !== null){ var d = ms - prevMs; if (msStep === null && d > 0 && d < 50) msStep = d;
          if (msStep && d > msStep * 2.5) gaps.push({ idx: n - 1, ms: d }); }
        prevMs = ms;
      }
    }
  }
  if (msStep && msStep > 0) fs = Math.round(1000 / msStep);
  return { int16: arr.slice(0, n), fs: fs, gaps: gaps, t0Ms: t0Ms, offsetMin: offsetMin, source: 'file', durSec: n / fs };
}

// COMPANION device-stream parsers (ECG-PPG-FOLLOWUPS-HANDOFF §2(b)) — the Polar Sensor
// Logger sidecars the app's loadDeviceRR/HR/ACC parse with DOM FileReaders. These are the
// PURE headless mirrors (Clock-Contract-faithful — regex parseTimestamp, NEVER Date.parse /
// now()), referenced BY the polar-h10-ecg adapter so a Unifier/OverDex-routed `*_ECG.txt`
// carries its matched `*_RR/_HR/_ACC` companions on the orchestrate path. compute() reads
// rec.deviceRR/deviceHR/deviceACC straight off the frame; analyze() then runs
// stampEpochPositions(deviceACC) → epochs[].position (posture) + accExtras. Mirrors PpgDex's
// DSP-resident parseSensorXYZ/parseDevicePPI (companion parsers live in the DSP).
// `*_RR.txt` (device RR, ms in the last column) → [{tsMs, rr}], 200–3000 ms.
function parseDeviceRR(text){
  var lines = String(text == null ? '' : text).split(/\r?\n/), out = [];
  for (var i = 0; i < lines.length; i++){
    var t = lines[i].trim(); if (!t) continue;
    var p = t.split(/[;\t,]/);
    var rr = parseFloat(p[p.length - 1]); if (!isFinite(rr) || rr < 200 || rr > 3000) continue;
    var ts = parseTimestamp(p[0]);
    out.push({ tsMs: (ts && ts.tMs != null) ? ts.tMs : null, rr: rr });
  }
  return out;
}
// `*_HR.txt` (device onboard HR, bpm in the last column) → [{tsMs, hr}], 20–260 bpm.
function parseDeviceHR(text){
  var lines = String(text == null ? '' : text).split(/\r?\n/), out = [];
  for (var i = 0; i < lines.length; i++){
    var t = lines[i].trim(); if (!t) continue;
    var p = t.split(/[;\t,]/);
    var hr = parseFloat(p[p.length - 1]); if (!isFinite(hr) || hr < 20 || hr > 260) continue;
    var ts = parseTimestamp(p[0]);
    out.push({ tsMs: (ts && ts.tMs != null) ? ts.tMs : null, hr: hr });   // null stamp stays null — never fabricated
  }
  return out;
}
// `*_ACC.txt` (tri-axial accelerometer; last 3 numeric cols = x,y,z) → { acc:[{tsMs,x,y,z}],
// accFs } — fs inferred from the median stamp dt. A stampless file is relative-from-0
// (+ _relBase) so the caller can re-base onto the ECG's t0Ms (Clock Contract §2.6 — never now()).
function parseDeviceACC(text){
  var lines = String(text == null ? '' : text).split(/\r?\n/), out = [];
  for (var i = 0; i < lines.length; i++){
    var t = lines[i].trim(); if (!t) continue;
    var p = t.split(/[;\t,]/);
    var nums = []; for (var k = 0; k < p.length; k++){ var v = parseFloat(p[k]); if (isFinite(v)) nums.push(v); }
    if (nums.length < 3) continue;
    var ts = parseTimestamp(p[0]);
    out.push({ tsMs: (ts && ts.tMs != null) ? ts.tMs : null, x: nums[nums.length - 3], y: nums[nums.length - 2], z: nums[nums.length - 1] });
  }
  if (out.length < 30) return { acc: null, accFs: null };
  var fs = 4, ts2 = []; for (var j = 0; j < out.length; j++){ if (isFinite(out[j].tsMs)) ts2.push(out[j].tsMs); }
  if (ts2.length > 5){ var dt = []; for (var m = 1; m < ts2.length; m++) dt.push(ts2[m] - ts2[m - 1]); dt.sort(function(a,b){ return a - b; }); var md = dt[dt.length >> 1]; if (md > 0) fs = Math.max(1, Math.min(200, Math.round(1000 / md))); }
  if (!isFinite(out[0].tsMs)){ for (var q = 0; q < out.length; q++) out[q].tsMs = Math.round(q / fs * 1000); out._relBase = true; }
  return { acc: out, accFs: fs };
}

// ════════════════════════════════════════════════════════════════════════
//  PHASE-9 SIGNAL-ADAPTER — namespaced node surface (ECGDex.compute)
//  (SIGNAL-ADAPTER-PHASE9-REMAINING-NODES, node 3 of 4 — the ECGDex leg.)
//  Shared node-export builder: ONE event source (analyze→gangliorEvents→r.events)
//  feeds BOTH the app's exportGanglior() and the headless compute(). DOM-free and
//  self-contained — kernel/provenance arrive via opts (never reached off window
//  here, CONTRIBUTING.md §6 / brief §1B). ECG is SINGLE-CHANNEL, so the canonical
//  ecg SignalFrame uses the STANDARD {samples:Float32Array, fs, t0Ms} shape
//  signal-spec.ecg declares — NOT PpgDex's packed multi-channel `samples` object
//  (PPGDEX-FOLLOWUPS §8); compute() reads samples+fs straight off the frame.
// ════════════════════════════════════════════════════════════════════════
function ecgBuildNodeExport(r, opts){
  opts = opts || {};
  // strip the internal _sec helper (surge events carry it for late-ACC re-stamp) —
  // mirrors buildV2's event map so the LIGHT Ganglior stream matches the rich one.
  var events = (r.events || []).map(function(ev){
    var c = {}; for (var k in ev){ if (k !== '_sec' && Object.prototype.hasOwnProperty.call(ev, k)) c[k] = ev[k]; } return c;
  });
  var out = {
    kernel: opts.kernel || null,
    schema:{ name:'ganglior.node-export', version:'2.0', node:'ECGDex', nodeVersion:'1.0',
      bus:'ganglior', generated:(opts.generated || new Date().toISOString()),
      provenance: opts.provenance || null,
      doc:'ECGDex beat-derived events → Ganglior bus. tMs = floating wall-clock ms (UTC getters). null = unknown, never fabricated.' },
    // EXPORT-IDENTITY §2.1 / -FOLLOWUPS-II §1: identity-free contentId, single-sourced in this
    // shared builder (both app exportGanglior + headless compute reach it). Folds the NN beat series.
    recording:{ source:'ecg', contentId:((typeof SignalFrame!=='undefined' && SignalFrame && SignalFrame.computeContentId && r.nn && r.nn.length) ? SignalFrame.computeContentId({ signalType:'ecg', kind:'intervals', intervals:r.nn, t0Ms:(r.t0Ms!=null?r.t0Ms:null), usable:true }) : null), startEpochMs:(r.t0Ms!=null?r.t0Ms:null),
      offsetMin:(r.offsetMin!=null?r.offsetMin:(opts.offsetMin!=null?opts.offsetMin:null)),
      events:events.length },
    ganglior_events:events,
    reserved:{ doc:'Awaiting other fleet nodes; null until available.' }
  };
  // ── RICH export (gated: opts.rich) — ECG-PPG-FOLLOWUPS-HANDOFF §1 option (a) / ECGDEX-FOLLOWUPS-II §2 ──
  // By DEFAULT this builder emits the LIGHT export above (recording + ganglior_events) and the app's
  // exportGanglior() calls WITHOUT opts.rich → the app's Ganglior stream stays BYTE-IDENTICAL. Only the
  // orchestrate emitter (signal-orchestrate.emitEcgNodeExport) passes opts.rich, so a Unifier/OverDex-routed
  // ECG file additionally carries the slice the Integrator's adaptEnvelopeNode('ECGDex') consumes: the
  // whole-record HRV axis (wholeRecordRMSSD/SDNN — the consensus key), hrv.frequency.lfhf, quality.analyzablePct,
  // the per-5-min timeseries.epochs[].position grid (posture — populated once companions land, §2b), and the
  // sleep stage minutes. Field math MIRRORS ecgdex-app.js buildV2 (same `r`, same numbers). SHARED SHAPE with
  // ppgBuildNodeExport (PPGDEX-FOLLOWUPS §1) — keep the two aligned (the handoff's no-divergence mandate).
  if (opts.rich){
    var nz = function(v){ return (v==null || (typeof v==='number' && !isFinite(v))) ? null : v; };
    var amb = !!r.ambulatory, lng = !!r.longRec;
    out.quality = { analyzablePct:nz(r.analyzablePct), cleanBeatPct:nz(r.cleanBeatPct), coveragePct:nz(r.coveragePct) };
    out.hrv = {
      time:{ hr:nz(r.dispHr), meanRR:nz(r.meanRR), sdnn:nz(r.dispSd), rmssd:nz(r.dispRm), pnn50:nz(r.dispPn),
        sdnnIndex:nz(r.sdnnIdx), wholeRecordHR:nz(r.hr), wholeRecordSDNN:nz(r.sdnn), wholeRecordRMSSD:nz(r.rmssd),
        units:'ms',
        windowNote:'sdnn/rmssd/pnn50 here are DISPLAY values = representative 5-min epoch median on overnight recordings (short recs: whole-record). For CROSS-NODE comparison use wholeRecordSDNN/wholeRecordRMSSD.' },
      frequency:{ lf:nz(r.lf), hf:nz(r.hf), lfhf:nz(r.lfhf), method:'Lomb\u2013Scargle' }
    };
    out.timeseries = {
      doc:'Per-5-min-epoch aggregates — the primary cross-node feed (posture rides on epochs[].position).',
      epochs:(r.epochs||[]).map(function(e){ return { tMin:e.tMin, hr:nz(e.hr), rmssd:nz(e.rmssd), sdnn:nz(e.sdnn), lfhf:nz(e.lfhf), position:(e.position||'unknown') }; }),
      sleepStages:(lng && !amb && Array.isArray(r.stages)) ? r.stages.map(function(s){ return { tMin:s.tMin, stage:s.stage }; }) : null
    };
    out.sleep = amb ? { suppressed:true, suppressedReason:((r.sleepSuppressed && r.sleepSuppressed.suppressedReason) || 'high-activity / ambulatory'), stages:null }
              : (lng ? { totalSleepMin:nz(r.totSleep), stageMinutes:(r.stageMin||null) } : null);
  }
  return out;
}

// Headless public surface — parse → analyze (REAL Pan-Tompkins pipeline, no Worker)
// → shared node-export. Accepts a Polar Sensor Logger `*_ECG.txt` string, {text}, an
// already-parsed rec {int16,fs}, or the canonical ecg SignalFrame {samples:Float32Array,fs,t0Ms}.
function compute(input, opts){
  opts = opts || {};
  var rec;
  if (input && input.samples != null && input.samples.length != null && !Array.isArray(input.samples.ch)){
    // Canonical ecg SignalFrame (signal-frame.js): single-channel samples (Float32Array|Int16Array|number[])
    // + fs/t0Ms/offsetMin on the frame. signal-orchestrate.emitEcgNodeExport hands this STRAIGHT to
    // compute() (the §1/§4#2 compute()-shape contract — accept the canonical frame, not only {text}).
    // Rebuild the analyze-rec DIRECTLY from the frame's own samples (the polar-h10-ecg adapter already
    // ran ECGDex.parseECG — do NOT re-parse). Int16 is what analyze's SQI/rail checks expect, so coerce.
    var s = input.samples, N = s.length, int16 = (s instanceof Int16Array) ? s : new Int16Array(N);
    if (!(s instanceof Int16Array)){ for (var i = 0; i < N; i++){ var vv = Math.round(s[i]); int16[i] = vv > 32767 ? 32767 : (vv < -32768 ? -32768 : vv); } }
    var fs = (input.fs != null ? input.fs : 130);
    rec = { int16: int16, fs: fs, gaps: (input.gaps || []),
            t0Ms: (input.t0Ms != null ? input.t0Ms : null),
            offsetMin: (input.offsetMin != null ? input.offsetMin : null),
            source: (opts.source || 'signal-frame'), durSec: N / (fs || 130),
            deviceRR: (input.deviceRR || null), deviceHR: (input.deviceHR || null),
            deviceACC: (input.deviceACC || null), accFs: (input.accFs || null) };
  } else if (input && (input.int16 != null) && (input.fs != null)){
    rec = input;                                         // already a parsed rec (app / synthetic / test path)
  } else {
    var txt = (typeof input === 'string') ? input
            : (input && typeof input.text === 'string') ? input.text
            : (input && input.samples && typeof input.samples.text === 'string') ? input.samples.text
            : null;
    if (txt == null) throw new Error('ECGDex.compute: need a Polar Sensor Logger *_ECG.txt string, {text}, a parsed rec {int16,fs}, or an ecg SignalFrame {samples:Float32Array,fs}.');
    rec = parseECGText(txt);
  }
  if (opts.source) rec.source = opts.source;
  if (opts.offsetMin != null && rec.offsetMin == null) rec.offsetMin = opts.offsetMin;
  var r = analyze(rec, null);
  if (r.offsetMin == null && rec.offsetMin != null) r.offsetMin = rec.offsetMin;   // carry zone (analyze doesn't propagate it)
  return ecgBuildNodeExport(r, opts);
}

global.ECGDSP.parseECG = parseECGText;
global.ECGDSP.parseDeviceRR = parseDeviceRR;
global.ECGDSP.parseDeviceHR = parseDeviceHR;
global.ECGDSP.parseDeviceACC = parseDeviceACC;
global.ECGDSP.compute = compute;
global.ECGDSP.buildNodeExport = ecgBuildNodeExport;
// ONE namespaced global (brief §1A). ECGDex leaks nothing bare (the whole DSP is in this
// IIFE) → no __DEX_NAMESPACED__ suppression gate needed; this is an explicit named global,
// collision-free in the co-load realm. Standalone bundles still read ECGDSP.
global.ECGDex = global.ECGDex || { compute:compute, parseECG:parseECGText, analyze:analyze,
  genSynthetic:genSynthetic, buildNodeExport:ecgBuildNodeExport, _build:ecgBuildNodeExport,
  parseDeviceRR:parseDeviceRR, parseDeviceHR:parseDeviceHR, parseDeviceACC:parseDeviceACC };

})(window);
