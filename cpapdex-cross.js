/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   CPAPDex · CROSS-NIGHT ANALYTICS ENGINE  (cpapdex-cross.js)
   ────────────────────────────────────────────────────────────────────────
   ONE pure helper, duplicated locally per app (suite convention — same math as
   oxydex-cross.js / ppgdex-cross.js / ecgdex-cross.js, BYTE-IDENTICAL crossNight
   so the P12 cross-Dex drift gate holds). Computes, across loaded nights, per
   outcome metric:
     1. central tendency + spread (n, mean, SD, median, IQR, min/max, CV%)
     2. trend — OLS slope vs night-index AND vs real date (uneven gaps), R²,
        + a Mann–Kendall non-parametric test (τ, p) for short series
     3. significance — n≥7 first-half vs second-half delta + bootstrap 95% CI
     4. personal baseline + per-night z-scores (|z|≥Z_HEADLINE flagged)
     5. coverage-weighting (each night weighted by therapy-hour completeness)

   CPAP trend metrics are OUTCOMES with a clear good-direction — residual AHI,
   usage hours, large-leak %, central-apnea index, and ODI (only the nights an
   oximeter was attached). Delivered PRESSURE is a therapy SETTING, not an
   outcome, so it is deliberately NOT trended here (a rising pressure is not
   "worse"). Input series = [{ x:nightIdx, t:t0Ms, v:value, w:coverageWeight }].
   Clock Contract: t0Ms is floating; dates rendered via getUTC*.
   Exposes window.CPAPCross.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';

// Physiology-kernel constants. In a bundle/browser realm kernel-constants.js is already
// co-loaded and DexKernel is a global. Under CommonJS nothing has loaded it, so pull it
// in for its side effect — it self-registers on globalThis (it is already dual-realm) —
// which makes the bare `DexKernel` reads below resolve. Without this, requiring this
// module threw and buildLongitudinal() silently produced crossNight:null (brief §F5).
// CrossNightEnvelope stays OPTIONAL: it is behind a truthiness guard and simply absent
// under CommonJS, which selects the local (non-envelope) code path by design.
if (typeof DexKernel === 'undefined' && typeof require !== 'undefined') {
  try { require('./kernel-constants.js'); } catch (e) { /* browser/bundle realm — already global */ }
}

const r1=v=>v==null||!isFinite(v)?null:Math.round(v*10)/10;
const r2=v=>v==null||!isFinite(v)?null:Math.round(v*100)/100;
const r3=v=>v==null||!isFinite(v)?null:Math.round(v*1000)/1000;

function wmean(vals,w){ let s=0,sw=0; for(let i=0;i<vals.length;i++){ s+=vals[i]*w[i]; sw+=w[i]; } return sw?s/sw:NaN; }
function mean(a){ let s=0; for(const v of a) s+=v; return a.length?s/a.length:NaN; }
function sd(a){ if(a.length<2) return 0; const m=mean(a); let s=0; for(const v of a){ const d=v-m; s+=d*d; } return Math.sqrt(s/(a.length-1)); }
function median(a){ if(!a.length) return NaN; const b=[...a].sort((x,y)=>x-y),n=b.length; return n%2?b[(n-1)/2]:(b[n/2-1]+b[n/2])/2; }
function quantile(a,q){ if(!a.length) return NaN; const b=[...a].sort((x,y)=>x-y),p=(b.length-1)*q,lo=Math.floor(p),hi=Math.ceil(p); return lo===hi?b[lo]:b[lo]+(b[hi]-b[lo])*(p-lo); }

// OLS slope/intercept/R² of y vs x (weighted)
function ols(x,y,w){
  const n=x.length; if(n<2) return { slope:null, intercept:null, r2:null };
  let sw=0,sx=0,sy=0,sxx=0,sxy=0,syy=0;
  for(let i=0;i<n;i++){ const wi=w?w[i]:1; sw+=wi; sx+=wi*x[i]; sy+=wi*y[i]; sxx+=wi*x[i]*x[i]; sxy+=wi*x[i]*y[i]; syy+=wi*y[i]*y[i]; }
  const den=sw*sxx-sx*sx; if(Math.abs(den)<1e-12) return { slope:null, intercept:null, r2:null };
  const slope=(sw*sxy-sx*sy)/den, intercept=(sy-slope*sx)/sw;
  const num=sw*sxy-sx*sy; const r2v=(num*num)/((sw*sxx-sx*sx)*(sw*syy-sy*sy)||1e-12);
  return { slope, intercept, r2:Math.max(0,Math.min(1,r2v)) };
}

// Mann–Kendall τ + normal-approx two-sided p
function mannKendall(y){
  const n=y.length; if(n<3) return { tau:null, p:null, S:0 };
  let S=0; for(let i=0;i<n-1;i++) for(let j=i+1;j<n;j++){ const d=y[j]-y[i]; S+=d>0?1:d<0?-1:0; }
  const varS=n*(n-1)*(2*n+5)/18;
  let z=0; if(S>0) z=(S-1)/Math.sqrt(varS); else if(S<0) z=(S+1)/Math.sqrt(varS);
  const p=2*(1-normCdf(Math.abs(z)));
  const tau=S/(0.5*n*(n-1));
  return { tau:r2(tau), p:r3(Math.max(0,Math.min(1,p))), S };
}
function normCdf(x){ return 0.5*(1+erf(x/Math.SQRT2)); }
function erf(x){ const t=1/(1+0.3275911*Math.abs(x));
  const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);
  return x>=0?y:-y; }

// bootstrap 95% CI on (second-half mean − first-half mean)
function bootstrapDeltaCI(vals){
  const n=vals.length; if(n<7) return { delta:null, ci:null };
  const half=Math.floor(n/2);
  const A=vals.slice(0,half), B=vals.slice(n-half);
  const delta=mean(B)-mean(A);
  const B_iter=1000, deltas=[];
  let seed=12345; const rnd=()=>{ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; };
  for(let b=0;b<B_iter;b++){
    const ra=[],rb=[];
    for(let i=0;i<A.length;i++) ra.push(A[Math.floor(rnd()*A.length)]);
    for(let i=0;i<B.length;i++) rb.push(B[Math.floor(rnd()*B.length)]);
    deltas.push(mean(rb)-mean(ra));
  }
  deltas.sort((a,b)=>a-b);
  return { delta:r2(delta), ci:[r2(quantile(deltas,0.025)), r2(quantile(deltas,0.975))] };
}

function crossNight(series, opts){
  opts=opts||{}; const good=opts.good||'up';
  const pts=series.filter(p=>p.v!=null&&isFinite(p.v));
  const n=pts.length;
  if(n<2) return { n, mean:n?r2(pts[0].v):null, sd:null, cv:null, slopePerDay:null, tau:null, p:null, zLatest:null, trendLabel:'—' };
  const vals=pts.map(p=>p.v), w=pts.map(p=>p.w!=null?p.w:1);
  const idx=pts.map((p,i)=>i);
  const m=wmean(vals,w), s=sd(vals);
  const med=median(vals), iqr=quantile(vals,0.75)-quantile(vals,0.25);
  const cv=m!==0?Math.abs(100*s/m):null;
  // OLS vs night index (coverage-weighted)
  const byIdx=ols(idx,vals,w);
  // OLS vs real date (days since first) honours uneven gaps
  const haveT=pts.every(p=>p.t!=null);
  let slopePerDay=null, r2date=null;
  if(haveT){ const days=pts.map(p=>(p.t-pts[0].t)/86400000); const od=ols(days,vals,w); slopePerDay=r2(od.slope); r2date=r2(od.r2); }
  else { slopePerDay=byIdx.slope!=null?r2(byIdx.slope):null; }
  const mk=mannKendall(vals);
  // personal baseline = mean±SD of all-but-latest; z of latest
  let zLatest=null;
  let baselineMean=null, baselineSd=null;
  if(n>=3){
    const prior=vals.slice(0,n-1); const pm=mean(prior), psRaw=sd(prior);
    baselineMean=r2(pm);
    // Guard a degenerate (near-zero) baseline spread: dividing by ~0 SD explodes z to
    // absurd magnitudes (±1e8 σ) that overflow the trend card. Floor the SD relative to
    // the baseline mean and clamp the result to a sane display range.
    const psFloor=Math.max(psRaw, 1e-6*Math.max(1,Math.abs(pm)));
    baselineSd=r1(psFloor);
    let z=(vals[n-1]-pm)/psFloor; if(!isFinite(z)) z=0;
    zLatest=r2(Math.max(-20,Math.min(20,z)));
  }
  // significance
  const boot=bootstrapDeltaCI(vals);
  // trend label by good-direction + Mann-Kendall significance
  let trendLabel='stable';
  const rising = (byIdx.slope||0)>0;
  const signif = mk.p!=null && mk.p<DexKernel.K.SIGNIF_P && Math.abs(mk.tau||0)>DexKernel.K.SIGNIF_TAU;
  if(signif){ const improving = (good==='up'&&rising)||(good==='down'&&!rising); trendLabel=improving?'improving':'declining'; }
  return {
    n, mean:r2(m), sd:r1(s), median:r2(med), iqr:r1(iqr),
    min:r2(Math.min.apply(null,vals)), max:r2(Math.max.apply(null,vals)), cv:r1(cv),
    slope:byIdx.slope!=null?r3(byIdx.slope):null, slopePerDay, r2:byIdx.r2!=null?r2(byIdx.r2):null, r2date,
    tau:mk.tau, p:mk.p, zLatest, baselineMean, baselineSd,
    deltaHalves:boot.delta, ci:boot.ci,
    trendLabel
  };
}

// ── Clock Contract — floating tMs displayed via getUTC* ──
function _p2(x){ return (x<10?'0':'')+x; }
function fmtDateUTC(ms){ if(ms==null) return null; const d=new Date(ms); return d.getUTCFullYear()+'-'+_p2(d.getUTCMonth()+1)+'-'+_p2(d.getUTCDate()); }

// night-level ODI = mean of available-oximeter sessions (null if no oximeter that night)
function nightOdi(n){
  if(!n.sessions) return null;
  var live=n.sessions.filter(function(s){ return s.oximetry && s.oximetry.available && s.oximetry.odi!=null; });
  if(!live.length) return null;
  var sum=0; live.forEach(function(s){ sum+=s.oximetry.odi; }); return sum/live.length;
}
// CPAPDex outcome metric defs — each an OUTCOME with a clear good-direction.
var CPAP_DEFS = {
  residualAHI:  { good:'down', label:'Residual AHI', unit:'/hr',    evidence:'measured',     get:function(n){ return n.metrics?n.metrics.residualAHI:null; } },
  usageHours:   { good:'up',   label:'Usage Hours',   unit:'hr',    evidence:'measured',     get:function(n){ return n.therapyHours!=null?n.therapyHours:(n.metrics?n.metrics.usageHours:null); } },
  largeLeakPct: { good:'down', label:'Large Leak %', unit:'%',      evidence:'validated',    get:function(n){ return n.metrics?n.metrics.largeLeakPct:null; } },
  centralIndex: { good:'down', label:'Central Apnea Index', unit:'/hr', evidence:'measured',  get:function(n){ return n.metrics?n.metrics.centralIndex:null; } },
  odi:          { good:'down', label:'ODI', unit:'/hr',             evidence:'validated',    get:nightOdi },
  // -III §1: device-scored PERIODIC-BREATHING burden (% therapy in CSL Cheyne-Stokes/PB spans) so the
  // Integrator Longitudinal view trends PB across nights + couples it against residualAHI/centralIndex/etc.
  // The generic ganglior.crossnight ingester picks it up with no Integrator code. MEASURED per
  // cpapdex-registry — firmware-scored CSL annotation, a direct device read.
  periodicBreathingPct:{ good:'down', label:'Periodic Breathing', unit:'%', evidence:'measured',
    cite:'% therapy in CSL Cheyne-Stokes/PB spans — device-scored',
    get:function(n){ return n.metrics?n.metrics.periodicBreathingPct:null; } }
};
function nightTms(n){ return n && n.t0Ms!=null ? n.t0Ms : null; }
// weight each night by therapy-hour completeness (a 40-min session weighs less than a full night)
function nightWeight(n){ var h=n.therapyHours!=null?n.therapyHours:(n.metrics?n.metrics.usageHours:null);
  return h!=null?Math.max(0.05,Math.min(1,h/6)):1; }

// build the cross-night EXPORT block via the shared CrossNightEnvelope (shape only;
// math is CPAPDex's local crossNight). nightsChrono = ascending by time.
function crossNightBlock(nightsChrono){
  if(global.CrossNightEnvelope){
    return global.CrossNightEnvelope.build({
      node:'CPAPDex', nodeVersion:'1.0', unit:'night',
      items:nightsChrono,
      t0Of: nightTms,
      weightOf: nightWeight,
      crossNight: crossNight,
      metrics: Object.keys(CPAP_DEFS).map(function(id){ var d=CPAP_DEFS[id];
        return { id:id, label:d.label, unit:d.unit, goodDirection:d.good, evidence:d.evidence, cite:d.cite, get:d.get }; })
    });
  }
  // legacy fallback (pre-envelope shape)
  var out={ doc:'night-to-night robust stats — same crossNight() engine as the rest of the suite', metrics:{} };
  for(var k in CPAP_DEFS){ var d=CPAP_DEFS[k];
    var ser=nightsChrono.map(function(n,i){ return { x:i, t:nightTms(n), v:d.get(n), w:nightWeight(n) }; });
    out.metrics[k]=crossNight(ser, { good:d.good });
  }
  return out;
}

/* compliancePct — % of nights meeting ≥4 h usage (CMS-style adherence) over the
   loaded window. Separate from the per-metric trends (it's an aggregate count). */
function compliancePct(nights, thresholdH){
  thresholdH = thresholdH==null ? 4 : thresholdH;
  if(!nights || !nights.length) return null;
  var ok=0; nights.forEach(function(n){ var h=n.therapyHours!=null?n.therapyHours:(n.metrics?n.metrics.usageHours:0); if(h>=thresholdH) ok++; });
  return +(ok/nights.length*100).toFixed(1);
}

var api = { crossNight, crossNightBlock, compliancePct, ols, mannKendall, bootstrapDeltaCI, fmtDateUTC, CPAP_DEFS, nightTms, nightWeight, nightOdi };

// Dual-realm, matching the house pattern already used by cpapdex-dsp.js / -edf.js /
// -fusion.js. This file used to close over a bare `window` and expose NOTHING to
// CommonJS, so `require('./cpapdex-cross.js')` THREW ("window is not defined") — which
// is why buildLongitudinal() handed back crossNight:null in every Node realm, silently
// (brief §F5). Browser behaviour is unchanged: global.CPAPCross is still set.
//
// `globalThis` (not null) is passed in Node because the body does bare `global.X`
// feature lookups (CrossNightEnvelope): it needs a real object on which the optional
// dependency is simply absent, so the existing truthiness guard does its job.
if (global) global.CPAPCross = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
