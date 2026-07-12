/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   GlucoDex · DSP  (glucodex-dsp.js)
   ────────────────────────────────────────────────────────────────────────
   One signal: continuous glucose (CGM). Robust CSV ingest + the full glycemic
   math: core metrics (mean/GMI/eA1c/SD/CV/TIR), variability suite
   (MAGE/CONGA/MODD/GVP/J-index/LBGI/HBGI), pattern detection (dawn / nocturnal
   hypo / unannotated excursions), AGP percentile aggregation, and a realistic
   synthetic CGM generator. 100% local — nothing leaves the browser.
   Math is ALWAYS on the full cleaned series; decimation is render-only.
   Exposes window.GLUDSP.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';

const MGDL_PER_MMOL = 18.018;

// ─── small stats helpers (avoid spread on large arrays) ───────────────────────
function mean(a){ let s=0,n=0; for(let i=0;i<a.length;i++){ if(isFinite(a[i])){ s+=a[i]; n++; } } return n?s/n:0; }
function std(a, m){ if(m==null) m=mean(a); let s=0,n=0; for(let i=0;i<a.length;i++){ if(isFinite(a[i])){ s+=(a[i]-m)*(a[i]-m); n++; } } return n>1?Math.sqrt(s/(n-1)):0; }
function quantile(sorted, q){ if(!sorted.length) return null; const i=(sorted.length-1)*q, lo=Math.floor(i), hi=Math.ceil(i); if(lo===hi) return sorted[lo]; return sorted[lo]+(sorted[hi]-sorted[lo])*(i-lo); }
function median(a){ const s=[...a].filter(isFinite).sort((x,y)=>x-y); return quantile(s,0.5); }
function round(v,d=1){ return v==null||!isFinite(v)?null:+v.toFixed(d); }

// ════════════════════════════════════════════════════════════════════════
//  CSV PARSE — Lingo/Libre/Dexcom-style. Comma/semicolon/tab.
//  First col = local timestamp (often with trailing ±HH:MM tz offset).
//  A measurement column = mg/dL or mmol/L (auto). Returns raw rows.
// ════════════════════════════════════════════════════════════════════════
/* ════ CANONICAL CLOCK · CLOCK-UNIFY (duplicated locally per app) ═══════════
   tMs = floating wall-clock ms: the recording's LOCAL civil time encoded as if
   it were UTC. ALWAYS read back via getUTC* getters. Viewer-timezone-independent.
   parseTimestamp(s) returns a Number (tMs) here to keep GlucoDex's numeric callers;
   _ckParse exposes { tMs, offsetMin }. See CLOCK-UNIFY-BRIEF.md §1/§2d. */
function tzOffset(instantMs){ return new Date(instantMs).getTimezoneOffset()*60000; }
function _ckNumEpoch(n){
  if(!isFinite(n)) return null;
  if(n < 1e11) n = n*1000;
  if(n < 1e11 || n > 4e12) return null;
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
function _ckParse(raw, opts){
  opts = opts || {};
  var preferDMY = opts.preferDMY !== false;
  if(raw==null) return null;
  if(typeof raw === 'number') return _ckNumEpoch(raw);
  var s = String(raw).trim().replace(/^["']|["']$/g,'');
  if(!s) return null;
  var m;
  if(/^\d{10,13}$/.test(s)) return _ckNumEpoch(parseInt(s,10));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?\s*(Z|[+-]\d{2}:?\d{2})$/);
  if(m){ var of=(m[8]==='Z')?0:_ckZoneMin(m[8]);
    return { tMs: Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],m[6]?+m[6]:0, m[7]?+((m[7]+'00').slice(0,3)):0), offsetMin: of }; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?$/);
  if(m) return { tMs: Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],m[6]?+m[6]:0, m[7]?+((m[7]+'00').slice(0,3)):0), offsetMin: null };
  m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m){ var dm=_ckDMY(+m[4],+m[5],preferDMY);
    return { tMs: Date.UTC(+m[6],dm.mo-1,dm.d,+m[1],+m[2],+m[3]), offsetMin: null }; }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(m){ var dm2=_ckDMY(+m[1],+m[2],preferDMY);
    return { tMs: Date.UTC(+m[3],dm2.mo-1,dm2.d,+m[4],+m[5],m[6]?+m[6]:0), offsetMin: null }; }
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(m) return { tMs: Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],m[6]?+m[6]:0), offsetMin: null };
  return null;
}
function parseTimestamp(s){
  var r = _ckParse(s, {preferDMY:false});   // CGM exports (Libre/Dexcom) are commonly MDY
  return r ? r.tMs : NaN;
}

function detectDelimiter(headerLine){
  const counts = { ',':0, ';':0, '\t':0 };
  for(const ch of headerLine){ if(ch in counts) counts[ch]++; }
  let best=',',bn=-1; for(const k in counts){ if(counts[k]>bn){ bn=counts[k]; best=k; } }
  return best;
}

// Find which column is the glucose value & which is the timestamp.
function locateColumns(rows, delim){
  // Scan up to ~40 rows; a glucose column is mostly numeric in a physiologic band,
  // a timestamp column parses as a date.
  const sample = rows.slice(0, Math.min(rows.length, 60));
  const ncol = Math.max(...sample.map(r=>r.split(delim).length));
  let tsCol=-1, gCol=-1, gScore=-1;
  for(let c=0;c<ncol;c++){
    let dateHits=0, numHits=0, inBand=0, total=0, sum=0;
    for(const line of sample){
      const cells=line.split(delim); if(c>=cells.length) continue;
      const cell=(cells[c]||'').trim().replace(/^["']|["']$/g,'');
      if(!cell) continue; total++;
      if(isFinite(parseTimestamp(cell)) && /[:\-/]/.test(cell) && cell.length>=8) dateHits++;
      const num=parseFloat(cell.replace(',','.'));
      if(isFinite(num) && /^[\s+-]*[\d.,]+\s*$/.test(cell)){ numHits++; sum+=num; if((num>=2&&num<=30)||(num>=30&&num<=600)) inBand++; }
    }
    if(total<3) continue;
    if(dateHits/total>0.6 && tsCol<0) tsCol=c;
    // prefer the numeric column with the most physiologic in-band hits (not the date)
    const sc = inBand/total - (dateHits/total);
    if(numHits/total>0.6 && sc>gScore){ gScore=sc; gCol=c; }
  }
  if(tsCol<0) tsCol=0;
  if(gCol<0) gCol=1;
  return { tsCol, gCol };
}

function parseCSV(text){
  const lines = text.split(/\r?\n/);
  // drop fully blank lines
  const nonEmpty = lines.filter(l=>l.trim().length);
  if(nonEmpty.length<2) throw new Error('File has too few rows to be a CGM export.');
  const delim = detectDelimiter(nonEmpty[0]);
  const { tsCol, gCol } = locateColumns(nonEmpty, delim);

  const T=[], V=[];
  for(const line of nonEmpty){
    const cells = line.split(delim);
    if(gCol>=cells.length) continue;
    const gRaw=(cells[gCol]||'').trim().replace(/^["']|["']$/g,'').replace(',','.');
    const g=parseFloat(gRaw);
    if(!isFinite(g)) continue;                       // header / non-numeric
    const tRaw=(cells[tsCol]||'').trim();
    const ms=parseTimestamp(tRaw);
    if(!isFinite(ms)) continue;                      // need a timestamp to place the sample
    T.push(ms); V.push(g);
  }
  if(T.length<10) throw new Error('Parsed only '+T.length+' valid readings — is this a CGM CSV with a timestamp + glucose column?');

  // sort by time (vendors sometimes export newest-first)
  const idx=T.map((_,i)=>i).sort((a,b)=>T[a]-T[b]);
  const Ts=idx.map(i=>T[i]), Vs=idx.map(i=>V[i]);

  // unit auto-detect: physiologic mmol/L sit ~3–22; mg/dL ~50–400. Median<30 ⇒ mmol/L.
  const med = median(Vs);
  let unit='mg/dL', vals=Vs;
  if(med<30){ unit='mmol/L'; vals=Vs.map(v=>v*MGDL_PER_MMOL); }   // normalise everything to mg/dL internally

  return { tMs:Ts, vMgdl:vals, unit, t0Ms:Ts[0] };
}

// ════════════════════════════════════════════════════════════════════════
//  CLEAN — cadence detect · warm-up suppress · gap flag+interp · compression-low
// ════════════════════════════════════════════════════════════════════════
/* GAP vs GAP_LONG (DEEP-AUDIT-2026-07-11 §5). A SHORT gap is a physiologic bridge — interpolating across
   one missed 5-min reading is sound, and those cells stay analyzable. A LONG gap (a sensor change, a
   dropout) is hours of straight line the sensor never saw; it must NOT be counted as measured glucose.
   Both used to carry FLAG.GAP, and analyzableIndex filtered neither — so a routine 14 h sensor-change gap
   was interpolated straight into TIR/GMI/CV/MAGE, the validated-tier headline KPIs (TIR read 11 % where
   the truth was 0 %). The distinction is the fix; the code's own comment already claimed it existed. */
const FLAG = { OK:0, WARMUP:1, GAP:2, COMPRESSION:3, GAP_LONG:4 };

// ── disambiguate a genuine sharp nocturnal hypo from a positional (compression) artifact ──
// GLUCODEX-HYPO-DISAMBIG (June 2026): the compression-rejection pass used to eat true sharp
// nocturnal hypos (sub-70 dive + Somogyi rebound) because a hypo's recovery shoulder is the exact
// bracket it screens for. This pure predicate enforces the discriminator the existing comment
// already names ("gradual, within an already-low trend"): a genuine insulin hypo sits SUSTAINED
// < 70 mg/dL, reaches a REAL nadir (≤ ~60), and is entered/left GRADUALLY (descent & rebound span
// multiple cells). A positional artifact is a near-vertical single-cell drop onto a low plateau
// and a near-vertical single-cell recovery. Protect a sustained+deep run UNLESS BOTH edges are
// near-vertical. Additive — no existing signature/return changes; the artifact rule below just
// consults this before flagging f===COMPRESSION, so a true hypo survives into nocturnalHypo().
function _looksLikeGenuineHypo(gV, gF, N, i, j, lo, cadence){
  const sustainedCells = Math.max(3, Math.round(15/cadence));   // ≥~15 min sustained sub-70
  let below70=0; for(let k=i;k<j;k++){ if(gF[k]===FLAG.OK && gV[k]<70) below70++; }
  if(below70 < sustainedCells) return false;      // too brief to be a clinical hypo
  if(lo > 60) return false;                       // no real nadir → ambiguous, leave to artifact rule
  // edge steepness: largest single-cell drop entering the dip & largest single-cell rise leaving it
  let maxDropStep=0;
  for(let k=Math.max(1,i-2);k<=Math.min(N-1,i+1);k++){ const d=gV[k-1]-gV[k]; if(d>maxDropStep) maxDropStep=d; }
  let maxRiseStep=0;
  for(let k=Math.max(1,j-1);k<=Math.min(N-1,j+1);k++){ const d=gV[k]-gV[k-1]; if(d>maxRiseStep) maxRiseStep=d; }
  const VERTICAL=22;                              // a near-instant single-cell artifact edge (mg/dL)
  if(maxDropStep>=VERTICAL && maxRiseStep>=VERTICAL) return false;   // both edges vertical ⇒ artifact
  return true;                                    // sustained + deep + ≥1 gradual edge ⇒ genuine hypo
}

function clean(parsed, progress){
  const { tMs, vMgdl, unit, t0Ms } = parsed;
  progress && progress(20,'Detecting cadence & cleaning…');
  const n=tMs.length;
  // cadence = median dt (minutes)
  const dts=[]; for(let i=1;i<n;i++){ const d=(tMs[i]-tMs[i-1])/60000; if(d>0&&d<240) dts.push(d); }
  dts.sort((a,b)=>a-b);
  const cadence = dts.length? +(quantile(dts,0.5)).toFixed(2) : 5;
  const gapThresh = Math.max(cadence*2.5, cadence+3);   // minutes

  // Build a uniform timeline at `cadence` so AGP/MODD/CONGA are well-defined.
  // We resample onto a regular grid by nearest-with-interpolation; flag interpolated cells.
  const stepMs = cadence*60000;
  const spanMs = tMs[n-1]-tMs[0];
  const N = Math.min(200000, Math.max(2, Math.round(spanMs/stepMs)+1));
  const gT=new Float64Array(N), gV=new Float64Array(N), gF=new Int8Array(N);

  // pointer walk through raw samples
  let j=0;
  for(let i=0;i<N;i++){
    const t = tMs[0] + i*stepMs;
    gT[i]=t;
    while(j<n-1 && tMs[j+1]<=t) j++;
    // nearest raw on each side
    const tL=tMs[j], vL=vMgdl[j];
    const k=Math.min(n-1,j+1); const tR=tMs[k], vR=vMgdl[k];
    const gapL=(t-tL)/60000, gapR=(tR-t)/60000;
    if(Math.min(gapL,gapR) <= cadence*0.75){
      gV[i] = gapL<=gapR ? vL : vR;                  // snap to the real reading
      gF[i] = FLAG.OK;
    } else if(tR>tL && gapL<gapThresh && gapR<gapThresh){
      const f=(t-tL)/(tR-tL); gV[i]=vL+(vR-vL)*f; gF[i]=FLAG.GAP;   // short gap → interpolate
    } else {
      // long gap — carry the interpolation (the chart still needs a line) but mark it GAP_LONG so it is
      // excluded from every distribution metric. These cells are drawn, never measured.
      const f=tR>tL?(t-tL)/(tR-tL):0; gV[i]= tR>tL? vL+(vR-vL)*f : vL; gF[i]=FLAG.GAP_LONG;
    }
  }

  // warm-up suppression: first ~60 min reads low/erratic on a fresh sensor.
  // Heuristic — only suppress if the opening hour is physiologically implausible
  // (very low mean or steep monotonic climb out of the weeds).
  const warmCells=Math.min(N, Math.round(60/cadence));
  let warmMean=0,wc=0; for(let i=0;i<warmCells;i++){ if(gF[i]===FLAG.OK){ warmMean+=gV[i]; wc++; } }
  warmMean= wc? warmMean/wc : 999;
  const post=[]; for(let i=warmCells;i<Math.min(N,warmCells*3);i++) if(gF[i]===FLAG.OK) post.push(gV[i]);
  const postMean=post.length?mean(post):warmMean;
  if(wc>4 && warmMean<55 && warmMean < postMean-25){
    for(let i=0;i<warmCells;i++) gF[i]=FLAG.WARMUP;
  }

  // ── compression lows (positional artifact: sleeping on the sensor) ──
  // v1.1 span detector, per critique: a SUSTAINED non-physiologic nocturnal dip
  // (≥~25 min) during sleep hours that is inconsistent with its surrounding 2-h
  // context and recovers sharply on BOTH sides. Thresholds are RELATIVE to the
  // person's own baseline (a low-set-point runner shouldn't escape detection, nor a
  // high one over-trigger). That bracketing-recovery signature separates a positional
  // artifact from a genuine insulin nocturnal hypo (gradual, within an already-low trend).
  // Flagged, not deleted — but excluded from TBR / LBGI / hypo events so artifacts don't inflate them.
  {
    const okv=[]; for(let i=0;i<N;i++){ if(gF[i]===FLAG.OK) okv.push(gV[i]); }
    const baseline = okv.length? quantile(okv.slice().sort((a,b)=>a-b),0.5) : 100;
    const dipCeil = Math.min(80, baseline*0.78);     // a dip must fall below this
    const shoulderFloor = Math.max(72, baseline*0.86); // shoulders must sit near/above baseline
    const minRun=Math.max(3,Math.round(25/cadence));     // ≥~25 min sustained
    const ctxW=Math.max(4,Math.round(120/cadence));      // 2-h context shoulders
    const isNight=ms=>{ const h=new Date(ms).getUTCHours(); return h>=23||h<8; };
    const medOf=(a,b)=>{ const v=[]; for(let k=Math.max(0,a);k<Math.min(N,b);k++){ if(gF[k]===FLAG.OK) v.push(gV[k]); } return v.length?quantile(v.sort((x,y)=>x-y),0.5):null; };
    let i=0;
    while(i<N){
      if(gF[i]===FLAG.OK && isNight(gT[i]) && gV[i]<dipCeil){
        let j=i, lo=gV[i];
        while(j<N && gV[j]<shoulderFloor && isNight(gT[j])){ lo=Math.min(lo,gV[j]); j++; }
        const runLen=j-i, runMin=runLen*cadence;
        if(runLen>=minRun && runMin<=150){
          const before=medOf(i-ctxW,i), after=medOf(j,j+ctxW);
          // both shoulders solidly above baseline and the dip deep & fast-recovering on BOTH sides…
          // …but DON'T eat a genuine sharp insulin hypo (sustained sub-70, real nadir, gradual edges).
          if(before!=null && after!=null && before>shoulderFloor && after>shoulderFloor && (before-lo)>30 && (after-lo)>26
             && !_looksLikeGenuineHypo(gV, gF, N, i, j, lo, cadence)){
            for(let k=i;k<j;k++) if(gF[k]===FLAG.OK) gF[k]=FLAG.COMPRESSION;
          }
        }
        i=j;
      } else i++;
    }
  }

  // count gaps (runs of GAP cells longer than one cadence) — BOTH gap classes count as gap/inactive time,
  // so pctActive / gapMin keep their previous meaning exactly (only analyzability changes below).
  let nGaps=0, gapCells=0, run=0;
  const _isGap = f => (f===FLAG.GAP || f===FLAG.GAP_LONG);
  for(let i=0;i<N;i++){ if(_isGap(gF[i])){ run++; gapCells++; } else { if(run>=2) nGaps++; run=0; } }
  if(run>=2) nGaps++;

  let warmupCells=0,compCells=0; for(let i=0;i<N;i++){ if(gF[i]===FLAG.WARMUP) warmupCells++; else if(gF[i]===FLAG.COMPRESSION) compCells++; }

  const activeCells = N - gapCells - warmupCells;
  const pctActive = +(activeCells/N*100).toFixed(1);

  return {
    unit, t0Ms, cadence, stepMs,
    gT, gV, gF, N,
    spanMin: Math.round(spanMs/60000), spanSec: spanMs/1000,
    activeMin: Math.round(activeCells*cadence), gapMin: Math.round(gapCells*cadence),
    warmupMin: Math.round(warmupCells*cadence), compMin: Math.round(compCells*cadence),
    nGaps, pctActive,
    nRaw:n, FLAG
  };
}

// analysis mask: cells that count toward glycemic math (exclude warm-up & long gaps).
// We KEEP short interpolated gaps (they're physiologic bridges) but exclude warm-up, compression lows,
// and LONG gaps from distribution metrics. The long-gap exclusion is the point: those cells are a straight
// line drawn across hours the sensor never saw, and admitting them into TIR/GMI/CV/MAGE reports
// interpolation as measured glucose (DEEP-AUDIT-2026-07-11 §5 — this function's docstring already claimed
// the exclusion; the code never did it).
function analyzableIndex(c){
  const ok=[]; const v=[];
  for(let i=0;i<c.N;i++){
    if(c.gF[i]===c.FLAG.WARMUP) continue;
    if(c.gF[i]===c.FLAG.COMPRESSION) continue;
    if(c.gF[i]===c.FLAG.GAP_LONG) continue;
    ok.push(i); v.push(c.gV[i]);
  }
  return { idx:ok, vals:v };
}

// ════════════════════════════════════════════════════════════════════════
//  SENSOR SESSIONS & DRIFT  (v1.2)
//  A multi-week file usually spans several sensor wears. Each wear can sit at a
//  slightly different bias (factory calibration varies) and can drift slowly
//  across its life. We split the series into sessions on long gaps / warm-ups,
//  report each session's level + intra-session drift slope, and offer two
//  honest, reference-free corrections:
//    · levelSessions — align each session's median to the global median
//      (removes step-changes BETWEEN sensors; defensible, assumes your true
//      long-run average is stable across wears)
//    · deDrift — remove the slow linear trend WITHIN each session, re-centred on
//      the session mean (flattens baseline wander; experimental — can shave real
//      slow physiology, so it's off by default and labelled informational)
// ════════════════════════════════════════════════════════════════════════
function detectSessions(c){
  const boundaryGapMin=90;                 // a ≥90-min gap ⇒ likely sensor change
  const minSessionCells=Math.round(360/c.cadence);   // ≥6 h to count
  const bounds=[]; let start=0, i=0;
  while(i<c.N){
    if(c.gF[i]===c.FLAG.GAP){
      let j=i; while(j<c.N && c.gF[j]===c.FLAG.GAP) j++;
      if((j-i)*c.cadence >= boundaryGapMin){
        if(i-start>minSessionCells) bounds.push([start,i]);
        start=j;
      }
      i=j;
    } else if(c.gF[i]===c.FLAG.WARMUP && i>start+minSessionCells){
      // a warm-up block mid-stream also marks a new sensor
      bounds.push([start,i]); start=i; i++;
    } else i++;
  }
  if(c.N-start>minSessionCells) bounds.push([start,c.N]);
  if(!bounds.length) bounds.push([0,c.N]);
  // per-session stats + drift slope (mg/dL per day) via least squares on OK cells
  return bounds.map(([s,e],k)=>{
    const xs=[],ys=[]; const dayMs=86400000;
    for(let p=s;p<e;p++){ if(c.gF[p]===c.FLAG.WARMUP||c.gF[p]===c.FLAG.COMPRESSION) continue; xs.push((c.gT[p]-c.gT[s])/dayMs); ys.push(c.gV[p]); }
    if(ys.length<10) return { idx:k+1, s, e, startMs:c.gT[s], endMs:c.gT[e-1], days:+((e-s)*c.cadence/1440).toFixed(1), n:ys.length, mean:null, median:null, driftPerDay:null };
    const m=mean(ys), md=quantile(ys.slice().sort((a,b)=>a-b),0.5);
    const xRange=Math.max(...xs)-Math.min(...xs);
    let slope=null;
    if(xRange>=0.5){   // need ≥½-day span before a per-day drift slope is meaningful
      const mx=mean(xs); let num=0,den=0; for(let q=0;q<xs.length;q++){ num+=(xs[q]-mx)*(ys[q]-m); den+=(xs[q]-mx)*(xs[q]-mx); }
      if(den>0){ slope=num/den; slope=Math.max(-40,Math.min(40,slope)); }   // clamp to physiologic drift
    }
    return { idx:k+1, s, e, startMs:c.gT[s], endMs:c.gT[e-1], days:+((e-s)*c.cadence/1440).toFixed(1), n:ys.length,
      mean:Math.round(m), median:Math.round(md), driftPerDay:slope==null?null:+slope.toFixed(1) };
  });
}

// apply per-session corrections in place on c.gV; returns a summary of what changed
function applySessionCorrections(c, sessions, levelSessions, deDrift){
  if(!levelSessions && !deDrift) return { leveled:false, deDrifted:false, offsets:[] };
  const allMed = quantile(analyzableIndex(c).vals.slice().sort((a,b)=>a-b),0.5);
  const offsets=[];
  for(const sess of sessions){
    if(sess.median==null){ offsets.push(0); continue; }
    let off = levelSessions ? (allMed - sess.median) : 0;
    offsets.push(Math.round(off));
    const dayMs=86400000;
    for(let p=sess.s;p<sess.e;p++){
      let v=c.gV[p];
      if(levelSessions) v+=off;
      if(deDrift && sess.driftPerDay!=null){ const dDay=(c.gT[p]-c.gT[sess.s])/dayMs; const mid=sess.days/2; v-=sess.driftPerDay*(dDay-mid); }
      c.gV[p]=Math.max(20,v);
    }
  }
  return { leveled:!!levelSessions, deDrifted:!!deDrift, offsets, globalMedian:Math.round(allMed) };
}

// ════════════════════════════════════════════════════════════════════════
//  CORE GLYCEMIC METRICS
// ════════════════════════════════════════════════════════════════════════
const TIR_CUT = { vlow:54, low:70, high:180, vhigh:250 };   // mg/dL consensus 2019

function coreMetrics(vals){
  const m=mean(vals), sd=std(vals,m);
  const cv=m>0?sd/m*100:0;
  const gmi=3.31 + 0.02392*m;                    // GMI % (lab-A1c proxy, NOT A1c)
  const ea1c=(m+46.7)/28.7;                      // ADAG eHbA1c %
  let tbr2=0,tbr1=0,tir=0,tar1=0,tar2=0;
  for(const g of vals){
    if(g<TIR_CUT.vlow) tbr2++;
    else if(g<TIR_CUT.low) tbr1++;
    else if(g<=TIR_CUT.high) tir++;
    else if(g<=TIR_CUT.vhigh) tar1++;
    else tar2++;
  }
  let tight=0; for(const g of vals){ if(g>=70&&g<=140) tight++; }   // Time in Tight Range (2023 consensus addition)
  const n=vals.length||1;
  const pct=x=>+(x/n*100).toFixed(1);
  const sorted=[...vals].sort((a,b)=>a-b);
  return { mean:round(m,0), sd:round(sd,0), cv:round(cv,1), gmi:round(gmi,1), ea1c:round(ea1c,1),
    titr:pct(tight),
    min:round(sorted[0],0), max:round(sorted[sorted.length-1],0),
    p10:round(quantile(sorted,0.1),0), p25:round(quantile(sorted,0.25),0),
    median:round(quantile(sorted,0.5),0), p75:round(quantile(sorted,0.75),0), p90:round(quantile(sorted,0.9),0),
    tir:{ tbr2:pct(tbr2), tbr1:pct(tbr1), tir:pct(tir), tar1:pct(tar1), tar2:pct(tar2) },
    tirN:{ tbr2,tbr1,tir,tar1,tar2 }, n };
}

// ════════════════════════════════════════════════════════════════════════
//  VARIABILITY SUITE
// ════════════════════════════════════════════════════════════════════════
// MAGE — mean amplitude of glycemic excursions > 1 SD (direction-counted turning points)
function mage(series, sd){
  // find turning points (peaks/valleys) on the cleaned series, count excursions > 1 SD
  const v=series; const n=v.length; if(n<4) return null;
  const tp=[0];
  let dir=0;
  for(let i=1;i<n;i++){
    const d=v[i]-v[tp[tp.length-1]];
    if(dir===0){ if(Math.abs(d)>0){ dir=Math.sign(d); } }
    else if(Math.sign(v[i]-v[i-1])!==0 && Math.sign(v[i]-v[i-1])!==dir){
      // local extremum at i-1
      tp.push(i-1); dir=Math.sign(v[i]-v[i-1]);
    }
  }
  tp.push(n-1);
  const exc=[];
  for(let i=1;i<tp.length;i++){ const amp=Math.abs(v[tp[i]]-v[tp[i-1]]); if(amp>sd) exc.push(amp); }
  return exc.length? round(mean(exc),0) : round(sd,0);
}

// CONGA(n hours): SD of (G(t) − G(t−n))
function conga(c, hours){
  const lag=Math.round(hours*60/c.cadence); if(lag<1) return null;
  const diffs=[];
  for(let i=lag;i<c.N;i++){
    if(c.gF[i]===c.FLAG.WARMUP||c.gF[i-lag]===c.FLAG.WARMUP) continue;
    diffs.push(c.gV[i]-c.gV[i-lag]);
  }
  if(diffs.length<5) return null;
  return round(std(diffs),0);
}

// MODD: mean of |G(t) − G(t−24h)|
function modd(c){
  const lag=Math.round(24*60/c.cadence); if(lag<1||c.N<=lag) return null;
  const diffs=[];
  for(let i=lag;i<c.N;i++){
    if(c.gF[i]===c.FLAG.WARMUP||c.gF[i-lag]===c.FLAG.WARMUP) continue;
    diffs.push(Math.abs(c.gV[i]-c.gV[i-lag]));
  }
  if(diffs.length<5) return null;
  return round(mean(diffs),0);
}

// GVP: glucose variability percentage = trace path length vs flat line, %
function gvp(c){
  let L=0, L0=0;
  const dtMin=c.cadence;
  for(let i=1;i<c.N;i++){
    if(c.gF[i]===c.FLAG.WARMUP) continue;
    const dg=c.gV[i]-c.gV[i-1];
    L += Math.sqrt(dtMin*dtMin + dg*dg);
    L0 += dtMin;
  }
  return L0>0? round((L/L0-1)*100,1) : null;
}

// LBGI / HBGI (Kovatchev) — mg/dL symmetrization
function bgRisk(vals){
  let rl=0, rh=0, n=0;
  for(const bg of vals){
    if(bg<=0) continue;
    const f=1.509*(Math.pow(Math.log(bg),1.084)-5.381);
    const r=10*f*f;
    if(f<0) rl+=r; else rh+=r;
    n++;
  }
  return { lbgi:round(n?rl/n:0,1), hbgi:round(n?rh/n:0,1) };
}

function variability(c, ana, core){
  const sd=core.sd;
  return {
    mage: mage(ana.vals, sd),
    conga1: conga(c,1), conga2: conga(c,2), conga4: conga(c,4),
    modd: modd(c),
    gvp: gvp(c),
    jIndex: round(0.001*Math.pow(core.mean+sd,2),1),
    magRate: magRate(c),
    grade: grade(ana.vals),
    adrr: adrr(c),
    ...bgRisk(ana.vals)
  };
}

// MAG — mean absolute glucose change per hour (rate of change magnitude)
function magRate(c){
  let sum=0, hrs=0;
  for(let i=1;i<c.N;i++){
    if(c.gF[i]===c.FLAG.WARMUP||c.gF[i-1]===c.FLAG.WARMUP) continue;
    sum+=Math.abs(c.gV[i]-c.gV[i-1]); hrs+=c.cadence/60;
  }
  return hrs>0? round(sum/hrs,1) : null;
}

// GRADE — Glycaemic Risk Assessment Diabetes Equation (Hill 2007), + zone contributions
function grade(vals){
  let sum=0,n=0, hypo=0,eu=0,hyper=0;
  for(const bg of vals){
    const mmol=bg/MGDL_PER_MMOL; if(mmol<=1) continue;
    let g=425*Math.pow(Math.log10(Math.log10(mmol))+0.16,2);
    if(!isFinite(g)) continue; g=Math.min(50,g);
    sum+=g; n++;
    if(bg<70) hypo+=g; else if(bg<=140) eu+=g; else hyper+=g;
  }
  if(!n) return null;
  const tot=sum||1;
  return { score:round(sum/n,1), hypoPct:round(hypo/tot*100,0), euPct:round(eu/tot*100,0), hyperPct:round(hyper/tot*100,0) };
}

// ADRR — Average Daily Risk Range (Kovatchev): mean over days of (LRmax + HRmax) in risk space
function adrr(c){
  const days=byDay(c);
  let sum=0,nd=0;
  for(const [k,cells] of days){
    let lrMax=0,hrMax=0,cnt=0;
    for(const i of cells){
      if(c.gF[i]===c.FLAG.WARMUP||c.gF[i]===c.FLAG.COMPRESSION) continue;
      const bg=c.gV[i]; if(bg<=0) continue;
      const f=1.509*(Math.pow(Math.log(bg),1.084)-5.381); const r=10*f*f;
      if(f<0) lrMax=Math.max(lrMax,r); else hrMax=Math.max(hrMax,r);
      cnt++;
    }
    if(cnt>20){ sum+=lrMax+hrMax; nd++; }
  }
  return nd>=2? round(sum/nd,1) : null;
}

// ─── POSTPRANDIAL RESPONSE (leverages meal markers) ───
//     per meal: pre-meal baseline, peak rise, time-to-peak, +2 h delta, % returned to baseline
function postprandial(c, meals){
  if(!meals||!meals.length) return null;
  const days=byDay(c);
  const acc=meals.map(m=>({ label:m.label, category:m.category, minOfDay:m.minOfDay, baselines:[], peaks:[], ttp:[], d2h:[], ret:[] }));
  for(const [k,cells] of days){
    for(let mi=0;mi<meals.length;mi++){
      const m=meals[mi]; const base=[]; const seq=[];
      for(const i of cells){
        if(c.gF[i]===c.FLAG.WARMUP||c.gF[i]===c.FLAG.COMPRESSION) continue;
        const d=new Date(c.gT[i]); const mod=d.getUTCHours()*60+d.getUTCMinutes(); const rel=mod-m.minOfDay;
        if(rel>=-30 && rel<0) base.push(c.gV[i]);
        if(rel>=0 && rel<=180) seq.push({ rel, v:c.gV[i] });
      }
      if(seq.length<6 || base.length<2) continue;
      seq.sort((a,b)=>a.rel-b.rel);
      const baseline=mean(base);
      let peak=-1, ttp=0; for(const s of seq){ if(s.v>peak){ peak=s.v; ttp=s.rel; } }
      let v2=null,best=1e9; for(const s of seq){ const dd=Math.abs(s.rel-120); if(dd<best){ best=dd; v2=s.v; } }
      const ret=seq.some(s=>s.rel>ttp && s.v<=baseline+15);
      const pm=acc[mi];
      pm.baselines.push(baseline); pm.peaks.push(peak-baseline); pm.ttp.push(ttp);
      if(v2!=null) pm.d2h.push(v2-baseline); pm.ret.push(ret?1:0);
    }
  }
  const out=acc.map(pm=>({ label:pm.label, category:pm.category, nDays:pm.peaks.length,
    baseline: pm.baselines.length?round(mean(pm.baselines),0):null,
    peakDelta: pm.peaks.length?round(mean(pm.peaks),0):null,
    timeToPeakMin: pm.ttp.length?round(mean(pm.ttp),0):null,
    delta2h: pm.d2h.length?round(mean(pm.d2h),0):null,
    returnedPct: pm.ret.length?round(mean(pm.ret)*100,0):null })).filter(s=>s.nDays>0);
  return out.length? out : null;
}

// ════════════════════════════════════════════════════════════════════════
//  PATTERN DETECTION (event-level → Ganglior)
// ════════════════════════════════════════════════════════════════════════
function hourOf(ms){ const d=new Date(ms); return d.getUTCHours()+d.getUTCMinutes()/60; }
function dayKey(ms){ const d=new Date(ms); return d.getUTCFullYear()+'-'+(d.getUTCMonth()+1)+'-'+d.getUTCDate(); }
function hhmm(ms){ const d=new Date(ms); return String(d.getUTCHours()).padStart(2,'0')+':'+String(d.getUTCMinutes()).padStart(2,'0')+':'+String(d.getUTCSeconds()).padStart(2,'0'); }

// group cells into calendar days
function byDay(c){
  const days=new Map();
  for(let i=0;i<c.N;i++){ const k=dayKey(c.gT[i]); if(!days.has(k)) days.set(k,[]); days.get(k).push(i); }
  return days;
}

// Dawn phenomenon: nadir 03:00–06:00 → pre-breakfast 06:00–08:00 rise, per day; flag ≥20 mg/dL
function dawnPhenomenon(c){
  const days=byDay(c);
  const deltas=[];
  for(const [k,cells] of days){
    let nadir=Infinity, pre=[];
    for(const i of cells){
      if(c.gF[i]===c.FLAG.WARMUP||c.gF[i]===c.FLAG.GAP) continue;
      const h=hourOf(c.gT[i]);
      if(h>=3 && h<6) nadir=Math.min(nadir,c.gV[i]);
      else if(h>=6 && h<8) pre.push(c.gV[i]);
    }
    if(isFinite(nadir) && pre.length>=2){
      const preMean=mean(pre);
      deltas.push({ day:k, nadir:Math.round(nadir), pre:Math.round(preMean), delta:Math.round(preMean-nadir),
        atMs: cells.find(i=>{const h=hourOf(c.gT[i]);return h>=6&&h<8;}) != null ? c.gT[cells.find(i=>{const h=hourOf(c.gT[i]);return h>=6&&h<8;})] : c.gT[cells[0]] });
    }
  }
  if(!deltas.length) return { present:false, days:[] };
  const md=Math.round(median(deltas.map(d=>d.delta)));
  return { present: md>=20, medianDelta:md, days:deltas, nDays:deltas.length };
}

// Nocturnal hypo: 00:00–06:00 runs ≥15 min < 70 mg/dL
function nocturnalHypo(c){
  const minCells=Math.max(2,Math.round(15/c.cadence));
  const eps=[]; let run=null;
  for(let i=0;i<c.N;i++){
    const h=hourOf(c.gT[i]);
    const night = h<6;
    const lo = c.gF[i]!==c.FLAG.WARMUP && c.gF[i]!==c.FLAG.COMPRESSION && c.gV[i]<70;
    if(night && lo){
      if(!run) run={ s:i, min:c.gV[i] };
      run.min=Math.min(run.min,c.gV[i]); run.e=i;
    } else {
      if(run && (run.e-run.s+1)>=minCells) eps.push({ startMs:c.gT[run.s], endMs:c.gT[run.e], min:Math.round(run.min), durMin:Math.round((run.e-run.s+1)*c.cadence) });
      run=null;
    }
  }
  if(run && (run.e-run.s+1)>=minCells) eps.push({ startMs:c.gT[run.s], endMs:c.gT[run.e], min:Math.round(run.min), durMin:Math.round((run.e-run.s+1)*c.cadence) });
  return eps;
}

// ─── daypart variability (CV by time-of-day) — mirrors Lingo's overnight/morning/
//     afternoon/evening CV breakdown. Total CV is core.cv; these localise it. ───
function daypartVariability(c, totalCV){
  const parts={ overnight:[], morning:[], afternoon:[], evening:[] };
  for(let i=0;i<c.N;i++){
    if(c.gF[i]===c.FLAG.WARMUP||c.gF[i]===c.FLAG.COMPRESSION) continue;
    const h=new Date(c.gT[i]).getUTCHours();
    const k = h<6?'overnight' : h<12?'morning' : h<18?'afternoon' : 'evening';
    parts[k].push(c.gV[i]);
  }
  const stat=a=>{ if(a.length<5) return { cv:null, mean:null, n:a.length }; const m=mean(a); return { cv:round(std(a,m)/m*100,1), mean:round(m,0), n:a.length }; };
  return { total:totalCV,
    overnight:stat(parts.overnight), morning:stat(parts.morning),
    afternoon:stat(parts.afternoon), evening:stat(parts.evening),
    windows:{ overnight:'00:00–06:00', morning:'06:00–12:00', afternoon:'12:00–18:00', evening:'18:00–24:00' } };
}

// Unannotated excursions: rapid sustained rises (no meal markers in v1) → excursion events
function excursions(c, meals){
  // slope over ~15 min; a rise of ≥ ~45 mg/dL peak-over-trough with rate ≥ 1.0 mg/dL/min
  const w=Math.max(1,Math.round(15/c.cadence));
  const evs=[]; let i=0;
  // meal markers are time-of-day {minOfDay, category} recurring daily; match an excursion
  // start that falls within a window from -20 min to +75 min of a meal time.
  const matchMeal=(ms)=>{ if(!meals||!meals.length) return null; const d=new Date(ms); const mod=d.getUTCHours()*60+d.getUTCMinutes();
    let best=null,bd=1e9; for(const m of meals){ let diff=mod-m.minOfDay; if(diff<-20||diff>75) continue; if(Math.abs(diff)<bd){ bd=Math.abs(diff); best=m; } } return best; };
  while(i<c.N-w){
    if(c.gF[i]===c.FLAG.WARMUP){ i++; continue; }
    const trough=c.gV[i];
    const maxAhead=Math.min(c.N-1, i+Math.round(180/c.cadence));
    let peak=trough, peakI=i;
    for(let k=i;k<=maxAhead;k++){ if(c.gV[k]>peak){ peak=c.gV[k]; peakI=k; } if(c.gV[k]<trough-10) break; }
    const rise=peak-trough;
    const durMin=(peakI-i)*c.cadence;
    const rate=durMin>0?rise/durMin:0;
    if(rise>=45 && rate>=1.0 && c.gV[i]<160){
      const meal=matchMeal(c.gT[i]);
      evs.push({ startMs:c.gT[i], peakMs:c.gT[peakI], trough:Math.round(trough), peak:Math.round(peak), rise:Math.round(rise), rateMgMin:+rate.toFixed(2), durMin:Math.round(durMin),
        meal: meal? meal.label : null, mealCat: meal? meal.category : null, annotated: !!meal });
      i=peakI+w;
    } else i++;
  }
  return evs;
}

// ════════════════════════════════════════════════════════════════════════
//  AGP AGGREGATION — per-hour percentile bands + per-day rollups
// ════════════════════════════════════════════════════════════════════════
function agp(c){
  // 48 half-hour bins across the 24h clock
  const NB=48; const bins=Array.from({length:NB},()=>[]);
  for(let i=0;i<c.N;i++){
    if(c.gF[i]===c.FLAG.WARMUP||c.gF[i]===c.FLAG.COMPRESSION) continue;
    const h=hourOf(c.gT[i]); const b=Math.min(NB-1,Math.floor(h*2));
    bins[b].push(c.gV[i]);
  }
  const hourly=bins.map((arr,b)=>{
    if(arr.length<2) return { h:b/2, n:arr.length, p10:null,p25:null,p50:null,p75:null,p90:null };
    const s=arr.sort((a,b)=>a-b);
    return { h:b/2, n:arr.length, p10:round(quantile(s,0.1),0), p25:round(quantile(s,0.25),0), p50:round(quantile(s,0.5),0), p75:round(quantile(s,0.75),0), p90:round(quantile(s,0.9),0) };
  });
  return hourly;
}

function perDay(c){
  const days=byDay(c); const out=[];
  for(const [k,cells] of days){
    const vals=[]; for(const i of cells){ if(c.gF[i]!==c.FLAG.WARMUP&&c.gF[i]!==c.FLAG.COMPRESSION) vals.push(c.gV[i]); }
    if(vals.length<6) continue;
    const cm=coreMetrics(vals);
    out.push({ day:k, startMs:c.gT[cells[0]], n:vals.length, mean:cm.mean, cv:cm.cv, tir:cm.tir.tir, gmi:cm.gmi,
      tbr:+(cm.tir.tbr1+cm.tir.tbr2).toFixed(1), tar:+(cm.tir.tar1+cm.tir.tar2).toFixed(1) });
  }
  return out.sort((a,b)=>a.startMs-b.startMs);
}

// ════════════════════════════════════════════════════════════════════════
//  TIER GATING
// ════════════════════════════════════════════════════════════════════════
function tierOf(activeDays, pctActive){
  if(activeDays<1) return { tier:'partial', label:'Partial day', msg:'< 24 h · mean glucose · GMI · SD · CV · basic TIR valid — MODD & AGP bands need more days' };
  if(activeDays<14) return { tier:'multi-day', label:(Math.round(activeDays))+'-day', msg:Math.round(activeDays)+' days · full TIR/TAR/TBR · MAGE · CONGA · GVP · dawn valid — AGP percentile bands firm up at ≥14 d' };
  return { tier:'agp', label:'AGP-standard', msg:'≥14 days · AGP percentile envelope, MODD & robust GMI all valid (international consensus standard)' };
}

// ════════════════════════════════════════════════════════════════════════
//  GANGLIOR EVENTS
// ════════════════════════════════════════════════════════════════════════
function buildEvents(r){
  const ev=[]; const conf = +(0.55 + 0.4*Math.min(1, r.pctActive/100)).toFixed(2);
  // dawn surges (per day, if flagged)
  if(r.dawn.present){
    for(const d of r.dawn.days){ if(d.delta>=20) ev.push({ t:hhmm(d.atMs), tMs:d.atMs, impulse:'dawn_surge', node:'GlucoDex', conf, meta:{ riseMgdl:d.delta, nadir:d.nadir } }); }
  }
  // nocturnal hypos (high priority)
  for(const h of r.nocturnalHypo) ev.push({ t:hhmm(h.startMs), tMs:h.startMs, impulse:'nocturnal_hypo', node:'GlucoDex', conf:+(Math.min(0.97,conf+0.1)).toFixed(2), meta:{ minMgdl:h.min, durMin:h.durMin } });
  // excursions
  for(const e of r.excursions) ev.push({ t:hhmm(e.startMs), tMs:e.startMs, impulse:'glucose_excursion', node:'GlucoDex', conf, meta:{ riseMgdl:e.rise, rateMgMin:e.rateMgMin, peak:e.peak, meal:e.meal||'unannotated' } });
  // sort by absolute floating ms (Clock Contract §6); falls back to clock string
  ev.sort((a,b)=> (a.tMs!=null&&b.tMs!=null) ? a.tMs-b.tMs : (a.t<b.t?-1:1));
  return ev;
}

// ════════════════════════════════════════════════════════════════════════
//  CLAMP / SATURATION DETECTION
//  Some CGM exports clip readings to a fixed display band — notably Abbott
//  Lingo, which exports only 55–200 mg/dL. Clipped values pile up as a hard
//  spike at the bound, and everything beyond it is simply ABSENT from the file,
//  so TBR / severe-low / TAR / LBGI / HBGI computed from such a file UNDER-count.
//  We can't recover the lost readings, but we DETECT the clip and flag the
//  affected metrics honestly. Full-range exports (Libre/Dexcom ~40–400) don't trip.
//  Operates on the RAW exported readings (pre warm-up/gap/bias handling).
// ════════════════════════════════════════════════════════════════════════
function detectClampSaturation(vals){
  const empty = { detected:false, floor:null, ceiling:null, vendor:null, blindMetrics:[], note:null };
  const n = vals ? vals.length : 0;
  if(n < 20) return empty;
  let lo=Infinity, hi=-Infinity;
  for(let i=0;i<n;i++){ const v=vals[i]; if(!isFinite(v)) continue; if(v<lo) lo=v; if(v>hi) hi=v; }
  if(!isFinite(lo)||!isFinite(hi)||hi<=lo) return empty;
  /* A genuine distribution tail THINS toward its extreme; a hardware/software clip PILES UP at the bound.
     Compare LIKE FOR LIKE: the count AT the exact bound vs the MEAN PER-BIN count of the bins just inside
     it. The old test compared a ±1 (≈2-wide) bound window against a 5-wide inner slab — the slab was
     therefore almost always the thicker of the two, so `at >= 1.5*inner` could essentially never fire on
     real data. The real committed Abbott Lingo export — a hard rail at 54 mg/dL, with 46 readings AT the
     floor against 15 and 14 in the bins beside it, and zero readings below — went undetected and shipped
     37 unflagged `nocturnal_hypo` events at conf 0.97 (DEEP-AUDIT-2026-07-11 §6).
     vals are mg/dL integers, so a 1 mg/dL bin is the natural resolution.

     CLIP_RATIO: a genuine density near an extremum piles up only MILDLY — a glucose curve lingers at its
     nadir (an arcsine/turning-point effect), so some excess at the exact minimum is PHYSIOLOGICAL and must
     not be called a clip; flagging a real nadir as an artifact would HIDE true hypoglycemia, which is worse
     than the bug this fixes. A clip instead pins ALL the sub-bound mass onto one bin, which is a step
     change. Measured anchors: a real unclipped nocturnal hypo → 1.7× · the real Lingo rail → 3.2× · a hard
     synthetic rail → 184×. 2.5 sits in the gap, with margin on both sides. */
  const INNER_BINS = 2;
  const CLIP_RATIO = 2.5;
  function spikeAt(bound, dir){             // dir +1 = floor (inside is above) · −1 = ceiling
    let at=0; const innerBin=new Array(INNER_BINS).fill(0);
    for(let i=0;i<n;i++){
      const v=vals[i]; if(!isFinite(v)) continue;
      const d=(v-bound)*dir;                // 0 at the bound, positive just inside it
      if(Math.abs(d) < 0.5){ at++; continue; }
      const b=Math.round(d)-1;              // d≈1 → bin 0 · d≈2 → bin 1
      if(b>=0 && b<INNER_BINS) innerBin[b]++;
    }
    const innerMean = innerBin.reduce((s,x)=>s+x,0)/INNER_BINS;
    const pct=+(at/n*100).toFixed(2);
    const saturated = at>=3 && pct>=0.3 && at >= CLIP_RATIO*Math.max(1,innerMean);
    return { value:Math.round(bound), count:at, pct, saturated, innerMean:+innerMean.toFixed(1) };
  }
  const floor = spikeAt(lo, +1), ceiling = spikeAt(hi, -1);
  // Known vendor band: Lingo clips to 55–200 mg/dL (≈54–200 if the file was mmol/L)
  const nearLingoFloor = lo>=53 && lo<=57, nearLingoCeil = hi>=195 && hi<=205;
  let vendor=null;
  if(floor.saturated && ceiling.saturated && nearLingoFloor && nearLingoCeil) vendor='lingo';
  else if((floor.saturated&&nearLingoFloor) || (ceiling.saturated&&nearLingoCeil)) vendor='lingo-like';
  const blindMetrics=[]
    .concat(floor.saturated   ? ['tbr1','tbr2','lbgi','min','nocturnalHypo'] : [])
    .concat(ceiling.saturated ? ['tar1','tar2','hbgi','max'] : []);
  const detected = floor.saturated || ceiling.saturated;
  let note=null;
  if(detected){
    const lows=floor.saturated, highs=ceiling.saturated;
    note = 'Readings are clipped'
      + (lows ? ' at a '+floor.value+' mg/dL floor' : '')
      + (lows&&highs ? ' and' : '')
      + (highs ? ' at a '+ceiling.value+' mg/dL ceiling' : '')
      + (vendor==='lingo' ? ' (Abbott Lingo exports only 55–200 mg/dL)' : '')
      + '. Values beyond the clip are absent from the file, so '
      + (lows ? 'time-below-range & severe-low' : '')
      + (lows&&highs ? ' and ' : '')
      + (highs ? 'time-above-range & severe-high' : '')
      + ' metrics under-count.';
  }
  return { detected, floor, ceiling, vendor, blindMetrics, note };
}

// ════════════════════════════════════════════════════════════════════════
//  ANALYZE — orchestrate
// ════════════════════════════════════════════════════════════════════════
function analyze(parsed, progress, opts){
  opts=opts||{};
  const meals=opts.mealMarkers||null;
  const biasOffset=+opts.biasOffset||0;
  const c=clean(parsed, progress);
  // sensor-bias calibration: shift the whole series by a lab-A1c-derived offset (mg/dL)
  if(biasOffset){ for(let i=0;i<c.N;i++) c.gV[i]=Math.max(20, c.gV[i]+biasOffset); }
  // sensor sessions + optional per-session level / de-drift corrections (v1.2)
  const sessions=detectSessions(c);
  const sessionCorr=applySessionCorrections(c, sessions, opts.levelSessions, opts.deDrift);
  // if corrections changed the series, recompute session stats for honest reporting
  const sessionsOut = (sessionCorr.leveled||sessionCorr.deDrifted) ? detectSessions(c) : sessions;
  progress && progress(45,'Computing glycemic metrics…');
  const ana=analyzableIndex(c);
  if(ana.vals.length<6) throw new Error('Too few analyzable readings after cleaning (warm-up/gaps removed).');
  // clip/saturation flag — read off the RAW exported readings (Lingo 55–200, etc.)
  const clampSat = detectClampSaturation(parsed.vMgdl);
  const core=coreMetrics(ana.vals);
  progress && progress(60,'Variability suite…');
  const vari=variability(c, ana, core);
  const daypart=daypartVariability(c, core.cv);
  progress && progress(72,'Pattern detection…');
  const dawn=dawnPhenomenon(c);
  const noct=nocturnalHypo(c);
  const exc=excursions(c, meals);
  const ppgr=postprandial(c, meals);
  // optional nutrition correlation (Cronometer daily summary date-matched to per-day glycemia)
  let nutrition=null;
  if(opts.nutrition && opts.nutrition.daily && opts.nutrition.daily.length){
    nutrition=correlateNutrition(opts.nutrition, perDay(c));
  }
  progress && progress(84,'AGP aggregation…');
  const hourly=agp(c);
  const daily=perDay(c);
  const activeDays=c.activeMin/1440;
  const t=tierOf(activeDays, c.pctActive);

  const r = {
    source: parsed.source||'file', unit:c.unit, t0Ms:c.t0Ms, cadence:c.cadence,
    durSec:c.spanSec, durMin:c.spanMin, durDays:+activeDays.toFixed(2),
    spanMin:c.spanMin, activeMin:c.activeMin, gapMin:c.gapMin, warmupMin:c.warmupMin, compMin:c.compMin,
    nGaps:c.nGaps, pctActive:c.pctActive, nReadings:c.nRaw,
    clampSat,
    tier:t.tier, tierLabel:t.label, tierMsg:t.msg,
    longRec: activeDays>=1,
    // series (cleaned, mg/dL) for render
    series:{ gT:c.gT, gV:c.gV, gF:c.gF, N:c.N, cadence:c.cadence, FLAG:c.FLAG },
    // metrics
    ...core, ...vari,
    daypart, mealMarkers:meals||[], postprandial:ppgr, biasOffset, nutrition,
    sessions:sessionsOut, sessionCorr, nSessions:sessionsOut.length,
    dawn, nocturnalHypo:noct, excursions:exc,
    hourly, daily,
    TIR_CUT
  };
  r.events = buildEvents(r);
  progress && progress(96,'Done');
  return r;
}

// ════════════════════════════════════════════════════════════════════════
//  SYNTHETIC CGM GENERATOR — realistic demoable days
// ════════════════════════════════════════════════════════════════════════
function genSynthetic(opts){
  opts=opts||{};
  const days = opts.days||14;
  const profile = opts.profile||'healthy';     // 'healthy' | 'predm'
  const cadenceMin = opts.cadence||5;
  const t0 = Date.now() - days*86400000;
  // align start to local-civil midnight, stored as floating wall-clock ms (CLOCK-UNIFY)
  const d0=new Date(t0);
  const start=Date.UTC(d0.getFullYear(), d0.getMonth(), d0.getDate());
  const stepMs=cadenceMin*60000;
  const N=Math.round(days*1440/cadenceMin);
  const tMs=new Array(N), vMgdl=new Array(N);

  const base = profile==='predm'? 112 : 92;
  const dawnAmp = profile==='predm'? 32 : 16;
  const mealPeak = profile==='predm'? {b:78,l:70,d:88} : {b:42,l:38,d:50};
  const mealDecay = profile==='predm'? 150 : 95;       // min back toward base
  const noiseSd = 5;

  // meal times (h) with small per-day jitter
  function gaussian(){ let u=0,v=0; while(u===0)u=Math.random(); while(v===0)v=Math.random(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }

  // pre-roll gap schedule: drop a sensor gap on ~1/3 of days, plus one warm-up at very start
  const gapDays=new Set(); for(let dd=0;dd<days;dd++){ if(Math.random()<0.3) gapDays.add(dd); }

  for(let i=0;i<N;i++){
    const t=start+i*stepMs; tMs[i]=t;
    const dt=new Date(t); const dayIdx=Math.floor((t-start)/86400000);
    const h=dt.getUTCHours()+dt.getUTCMinutes()/60;
    let g=base;

    // overnight gentle dip (00:00–04:00)
    g -= 6*Math.exp(-Math.pow((h-2.5)/2.2,2));
    // dawn phenomenon rise 3:00 → 7:00
    g += dawnAmp/(1+Math.exp(-(h-4.5)*1.6)) * Math.exp(-Math.pow(Math.max(0,h-7)/2,2));

    // meals: breakfast ~7.8, lunch ~12.8, dinner ~19.3 (+ jitter via day seed)
    const meals=[{t:7.8+0.4*Math.sin(dayIdx*1.7),amp:mealPeak.b},{t:12.8+0.4*Math.sin(dayIdx*2.3),amp:mealPeak.l},{t:19.3+0.5*Math.sin(dayIdx*1.1),amp:mealPeak.d}];
    for(const m of meals){
      if(h>=m.t){
        const dm=(h-m.t)*60;                          // minutes since meal
        // rapid rise (peak ~45min) then exp decay
        const rise=Math.exp(-Math.pow((dm-45)/30,2));
        const decay=Math.exp(-dm/mealDecay);
        g += m.amp*Math.max(rise, decay*0.9);
      }
    }
    // post-lunch dip / exercise occasionally
    if(profile==='healthy' && h>16.5 && h<17.5 && Math.random()<0.02) g-=12;

    // noise + sensor wobble
    g += gaussian()*noiseSd;
    g = Math.max(45, Math.min(profile==='predm'?260:210, g));

    // compression low: rare nocturnal dip
    if((h>1&&h<4) && Math.random()<0.0008) g=Math.max(42,g-55);

    vMgdl[i]=+g.toFixed(0);
  }

  // carve gaps: remove a 40–110 min stretch on gap days (sensor off / out of range)
  const removed=new Set();
  for(const dd of gapDays){
    const gapStartH=2+Math.random()*18;
    const gapLen=40+Math.random()*70;
    const s=Math.round((dd*1440 + gapStartH*60)/cadenceMin);
    const e=Math.round((dd*1440 + gapStartH*60 + gapLen)/cadenceMin);
    for(let i=s;i<e&&i<N;i++) removed.add(i);
  }
  // warm-up garbage at very start (first 55 min reads low/erratic)
  const warm=Math.round(55/cadenceMin);
  for(let i=0;i<warm;i++) vMgdl[i]=Math.max(40, 50 - i*1.5 + gaussian()*6 + i*0.4);

  const fT=[], fV=[];
  for(let i=0;i<N;i++){ if(removed.has(i)) continue; fT.push(tMs[i]); fV.push(vMgdl[i]); }

  return { tMs:fT, vMgdl:fV, unit:'mg/dL', t0Ms:fT[0], source:'synthetic' };
}

// ════════════════════════════════════════════════════════════════════════
//  NUTRITION LOG (Cronometer) — optional second input
//  Two shapes accepted:
//   · DAILY SUMMARY (one row/day; Date + nutrient totals): DATE-matched to
//     GlucoDex per-day metrics → carbs-vs-glycemia correlation.
//   · TIMESTAMPED SERVINGS (rows with a time): times → meal markers (carb g →
//     light/medium/heavy) for excursion tagging.
// ════════════════════════════════════════════════════════════════════════
function pearson(xs, ys){
  const n=Math.min(xs.length,ys.length); if(n<3) return null;
  let sx=0,sy=0; for(let i=0;i<n;i++){ sx+=xs[i]; sy+=ys[i]; }
  const mx=sx/n,my=sy/n; let num=0,dx=0,dy=0;
  for(let i=0;i<n;i++){ const a=xs[i]-mx,b=ys[i]-my; num+=a*b; dx+=a*a; dy+=b*b; }
  if(dx===0||dy===0) return null;
  return +(num/Math.sqrt(dx*dy)).toFixed(2);
}
function carbCategory(g){ return g==null?'medium' : g<30?'light' : g<75?'medium' : 'heavy'; }
function dayKeyStr(ms){ const d=new Date(ms); return d.getUTCFullYear()+'-'+(d.getUTCMonth()+1)+'-'+d.getUTCDate(); }

function parseNutrition(text){
  const lines=text.split(/\r?\n/).filter(l=>l.trim().length);
  if(lines.length<2) throw new Error('Nutrition file has too few rows.');
  const delim=detectDelimiter(lines[0]);
  const splitRow=line=>{ const out=[]; let cur='',q=false; for(const ch of line){ if(ch==='"'){ q=!q; } else if(ch===delim&&!q){ out.push(cur); cur=''; } else cur+=ch; } out.push(cur); return out.map(s=>s.trim().replace(/^"|"$/g,'')); };
  const header=splitRow(lines[0]).map(h=>h.toLowerCase());
  const find=(...names)=>{ for(const nm of names){ const i=header.findIndex(h=>h.includes(nm)); if(i>=0) return i; } return -1; };
  const ci={
    date: find('date','day'), time: find('time'), group: find('group'),
    energy: find('energy','kcal','calorie'),
    netCarbs: header.findIndex(h=>h.includes('net carb')),
    carbs: header.findIndex(h=>h.startsWith('carbs')||h.includes('carbohydrate')||(h.includes('carb')&&!h.includes('net'))),
    sugars: header.findIndex(h=>h.includes('sugar')&&!h.includes('added')),
    added: header.findIndex(h=>h.includes('added sugar')),
    fiber: find('fiber','fibre'), protein: find('protein'),
    fat: header.findIndex(h=>h==='fat (g)'||h.startsWith('fat ('))
  };
  if(ci.date<0) throw new Error('No Date column — is this a Cronometer export?');
  const num=(cells,i)=>{ if(i<0||i>=cells.length) return null; const v=parseFloat((cells[i]||'').replace(/[, ]/g,'')); return isFinite(v)?v:null; };
  const hasTime = ci.time>=0 && lines.slice(1,12).some(l=>{ const c=splitRow(l); return c[ci.time]&&/\d{1,2}:\d{2}/.test(c[ci.time]); });

  const days=new Map();
  const servings=[];
  for(let r=1;r<lines.length;r++){
    const cells=splitRow(lines[r]); if(cells.length<2) continue;
    const dateRaw=cells[ci.date]; if(!dateRaw) continue;
    const grp=(ci.group>=0?(cells[ci.group]||''):'').toLowerCase();
    const carbVal = num(cells,ci.netCarbs)!=null?num(cells,ci.netCarbs):num(cells,ci.carbs);
    const ms=parseTimestamp(hasTime&&cells[ci.time]?(dateRaw+' '+cells[ci.time]):dateRaw);
    if(!isFinite(ms)) continue;
    // daily summary rows are usually Group=Total; skip per-food rows from totals aggregation
    const rec={ energy:num(cells,ci.energy), netCarbs:num(cells,ci.netCarbs), carbs:num(cells,ci.carbs),
      sugars:num(cells,ci.sugars), added:num(cells,ci.added), fiber:num(cells,ci.fiber), protein:num(cells,ci.protein), fat:num(cells,ci.fat) };
    const key=dayKeyStr(ms);
    if(hasTime && carbVal!=null && carbVal>=8){
      const d=new Date(ms); servings.push({ ms, minOfDay:d.getUTCHours()*60+d.getUTCMinutes(), carbs:carbVal, label:(cells[ci.group]||'Meal') });
    }
    if(!hasTime || grp.includes('total') || ci.group<0){
      // aggregate to the day (sum nutrients)
      if(!days.has(key)) days.set(key,{ key, ms, energy:0,netCarbs:0,carbs:0,sugars:0,added:0,fiber:0,protein:0,fat:0, _n:0 });
      const D=days.get(key);
      for(const k of ['energy','netCarbs','carbs','sugars','added','fiber','protein','fat']) if(rec[k]!=null) D[k]+=rec[k];
      D._n++;
    }
  }

  // build meal markers from timestamped servings (cluster within 45 min → one meal)
  let mealMarkers=null;
  if(hasTime && servings.length){
    servings.sort((a,b)=>a.minOfDay-b.minOfDay);
    const byMeal=new Map();
    for(const s of servings){ const bucket=Math.round(s.minOfDay/45); const k=bucket;
      if(!byMeal.has(k)) byMeal.set(k,{ minSum:0, carbs:0, n:0, label:s.label }); const m=byMeal.get(k); m.minSum+=s.minOfDay; m.carbs+=s.carbs; m.n++; }
    mealMarkers=[...byMeal.values()].map(m=>{ const mod=Math.round(m.minSum/m.n); const carbs=Math.round(m.carbs/Math.max(1, [...byMeal.values()].length>0?1:1));
      return { minOfDay:mod, category:carbCategory(m.carbs/Math.max(1,m.n*0+1)), label:m.label, carbsAvg:Math.round(m.carbs) }; });
    // category from per-occurrence average carbs
    mealMarkers.forEach(mm=>{ mm.category=carbCategory(mm.carbsAvg); });
  }

  const daily=[...days.values()].filter(d=>d._n>0).sort((a,b)=>a.ms-b.ms)
    .map(d=>({ key:d.key, ms:d.ms, energy:Math.round(d.energy)||null, netCarbs:Math.round(d.netCarbs)||null, carbs:Math.round(d.carbs)||null,
      sugars:Math.round(d.sugars)||null, added:Math.round(d.added)||null, fiber:Math.round(d.fiber)||null, protein:Math.round(d.protein)||null, fat:Math.round(d.fat)||null }));

  return { shape: hasTime&&mealMarkers&&mealMarkers.length? 'servings':'daily', hasTime, daily, mealMarkers, nDays:daily.length, nServings:servings.length };
}

// correlate a Cronometer daily summary against GlucoDex per-day metrics by shared date
function correlateNutrition(nut, daily){
  // index glycemia days by calendar key
  const gmap=new Map();
  for(const d of daily){ const k=dayKeyStr(d.startMs); gmap.set(k, d); }
  const matched=[];
  for(const nd of nut.daily){
    const g=gmap.get(nd.key);
    if(g) matched.push({ date:nd.key, ms:nd.ms,
      netCarbs:nd.netCarbs, carbs:nd.carbs, sugars:nd.sugars, added:nd.added, fiber:nd.fiber, energy:nd.energy, protein:nd.protein,
      mean:g.mean, tir:g.tir, cv:g.cv, tar:g.tar, gmi:g.gmi });
  }
  if(matched.length<3) return { matchedDays:matched.length, note:'Fewer than 3 shared days between the CGM and nutrition logs — need more overlap for a correlation.', overlap:matched.length };
  const col=k=>matched.map(m=>m[k]);
  const carbsKey = matched.some(m=>m.netCarbs!=null)?'netCarbs':'carbs';
  const carbs=col(carbsKey).map(v=>v==null?NaN:v);
  const pair=(a,b)=>{ const xs=[],ys=[]; for(let i=0;i<matched.length;i++){ if(isFinite(a[i])&&b[i]!=null){ xs.push(a[i]); ys.push(b[i]); } } return pearson(xs,ys); };
  const corr={
    carbsVsMean: pair(carbs, col('mean')),
    carbsVsTIR:  pair(carbs, col('tir')),
    carbsVsCV:   pair(carbs, col('cv')),
    carbsVsTAR:  pair(carbs, col('tar')),
    sugarsVsMean: pair(col('sugars').map(v=>v==null?NaN:v), col('mean')),
    fiberVsTIR:   pair(col('fiber').map(v=>v==null?NaN:v), col('tir')),
  };
  return { matchedDays:matched.length, carbsKey, matched, corr, overlap:matched.length };
}

// ════════════════════════════════════════════════════════════════════════
//  PHASE-9 SIGNAL-ADAPTER — namespaced node surface (GlucoDex.compute)
//  Shared node-export builder: ONE event source (analyze→buildEvents→r.events)
//  feeds BOTH the app's exportGanglior() and the headless compute(). DOM-free
//  and self-contained — kernel/provenance arrive via opts (typeof-guarded by the
//  caller), never reached off window here (CONTRIBUTING.md §6 / brief §1B).
// ════════════════════════════════════════════════════════════════════════
function glucoBuildNodeExport(r, opts){
  opts = opts || {};
  // CLAMP-SATURATION HONESTY (GLUCODEX-FOLLOWUPS §2). When the CGM export clipped at the floor (Abbott
  // Lingo 55 mg/dL, etc.) the nocturnal_hypo events fired off that clip floor may be clip ARTIFACTS, not
  // true hypos — surface the clamp fact on `recording.clamp` AND stamp those events `meta.clampFloor:true`
  // so a fusion consumer (the Integrator's adaptGlucoDex) can down-weight them. Additive + back-compat:
  // `recording.clamp` is always present ({detected:false} when clean) so a consumer always knows it was
  // CHECKED, and a non-clamped file's event stream is byte-identical (the map is a no-op when !floorSat).
  var cs = r.clampSat || null;
  var floorSat = !!(cs && cs.floor && cs.floor.saturated);
  var events = (r.events || []).map(function(e){
    if (floorSat && e && e.impulse === 'nocturnal_hypo'){
      var m = {}; for (var k in e.meta){ if (Object.prototype.hasOwnProperty.call(e.meta, k)) m[k] = e.meta[k]; }
      m.clampFloor = true;                          // this hypo fired off the clip floor — possibly an artifact
      return { t:e.t, tMs:e.tMs, impulse:e.impulse, node:e.node, conf:e.conf, meta:m };
    }
    return e;
  });
  return {
    kernel: opts.kernel || null,
    schema:{ name:'ganglior.node-export', version:'2.0', node:'GlucoDex', nodeVersion:'1.0',
      bus:'ganglior', generated:(opts.generated || new Date().toISOString()),
      provenance: opts.provenance || null,
      doc:'GlucoDex glycemic events → Ganglior bus. t/tMs = floating wall-clock (UTC getters). null = unknown, never fabricated.' },
    // EXPORT-IDENTITY §2.1 / -FOLLOWUPS-II §1: identity-free contentId, single-sourced in this
    // shared builder (both app exportGanglior + headless compute reach it). Folds the cleaned CGM series.
    recording:{ source:r.source, contentId:((typeof SignalFrame!=='undefined' && SignalFrame && SignalFrame.computeContentId && r.series && r.series.gV && r.series.gV.length) ? SignalFrame.computeContentId({ signalType:'cgm', kind:'samples', samples:r.series.gV, t0Ms:(r.t0Ms!=null?r.t0Ms:null), usable:true }) : null), startEpochMs:(r.t0Ms!=null?r.t0Ms:null), events:events.length,
      clamp:(cs && cs.detected) ? {
        detected:true, vendor:(cs.vendor||null),
        floor:(cs.floor && cs.floor.saturated && cs.floor.value!=null ? cs.floor.value : null),
        ceiling:(cs.ceiling && cs.ceiling.saturated && cs.ceiling.value!=null ? cs.ceiling.value : null),
        blindMetrics:(cs.blindMetrics||[]) } : { detected:false } },
    glucose:{ mean:r.mean, gmi:r.gmi, ea1c:r.ea1c, sd:r.sd, cv:r.cv, tir:r.tir, titr:r.titr,
      mage:(r.mage==null?null:r.mage), modd:(r.modd==null?null:r.modd), adrr:(r.adrr==null?null:r.adrr),
      gvp:(r.gvp==null?null:r.gvp), lbgi:r.lbgi, hbgi:r.hbgi, stabilityScore:r.stabilityScore,
      pctActive:r.pctActive, tier:(r.tier||null),
      dawn:(r.dawn && r.dawn.present ? { present:true, medianDelta:r.dawn.medianDelta } : { present:false }),
      daypart:(r.daypart||null) },
    ganglior_events:events,
    reserved:{ doc:'Awaiting other fleet nodes; null until available.' }
  };
}

// Headless public surface — parse → analyze (REAL pipeline) → shared node-export.
// Accepts a CSV string, {text}, or an already-parsed {tMs,vMgdl,unit,t0Ms} frame.
function compute(input, opts){
  opts = opts || {};
  let parsed;
  if(input && Array.isArray(input.tMs) && Array.isArray(input.vMgdl)){
    parsed = input;                                  // pre-parsed frame {tMs,vMgdl,unit,t0Ms} (genSynthetic / SignalSpec.cgm dsp-resolver leg)
  } else if(input && Array.isArray(input.samples) && input.samples.length &&
            input.samples[0] && typeof input.samples[0] === 'object' && typeof input.samples[0].v === 'number'){
    // Canonical cgm SignalFrame (signal-frame.js): samples=[{tMs,v}] + parallel tsMs[], with unit/t0Ms
    // on the frame. signal-orchestrate.emitCgmNodeExport hands this shape STRAIGHT to compute(), so
    // reconstruct the parseCSV-shaped {tMs,vMgdl,unit,t0Ms} the pipeline consumes DIRECTLY from the
    // frame's own already-parsed samples (the libre-cgm adapter already ran GlucoDex.parseCSV — the
    // values are mg/dL-normalised + time-sorted; do NOT re-parse). Without this branch the orchestrate
    // CGM path throws (the {tMs,vMgdl} branch above + the {text} branch below both miss a samples frame).
    const sm = input.samples;
    parsed = { tMs: sm.map(function(s){ return s.tMs; }), vMgdl: sm.map(function(s){ return s.v; }),
               unit: input.unit || 'mg/dL', t0Ms: (input.t0Ms != null ? input.t0Ms : (sm.length ? sm[0].tMs : null)) };
  } else {
    const text = (typeof input === 'string') ? input
               : (input && typeof input.text === 'string') ? input.text
               : (input && input.samples && typeof input.samples.text === 'string') ? input.samples.text
               : null;
    if(text == null) throw new Error('GlucoDex.compute: need a CSV string, {text}, a parsed {tMs,vMgdl} frame, or a cgm SignalFrame {samples:[{tMs,v}]}.');
    parsed = parseCSV(text);
  }
  if(opts.source) parsed.source = opts.source;
  const r = analyze(parsed, null, opts);
  return glucoBuildNodeExport(r, opts);
}

global.GLUDSP = { parseCSV, analyze, genSynthetic, coreMetrics, detectClampSaturation, TIR_CUT, MGDL_PER_MMOL, _mean:mean, _std:std, _median:median, _quantile:quantile, hhmm, parseNutrition, pearson };
// ONE namespaced global (brief §1A). GlucoDex leaks nothing bare (whole DSP is in
// this IIFE) → no __DEX_NAMESPACED__ suppression gate needed; this is an explicit
// named global, collision-free in the co-load realm. Standalone bundles still read GLUDSP.
// ═══════════════════════════════════════════════════════════════════════════
//  SELF-INGEST — reload GlucoDex's OWN ganglior.node-export as a review-mode
//  clinical VIEW (SELF-INGEST-FOLLOWUPS · GlucoDex pass, enrich-first D2 path b).
//  PURE + DOM-FREE: detect → own-node guard → mark reviewMode → return the
//  provenance/kernel/glucose/events VERBATIM. Never recomputes, never re-stamps.
//  The enriched export now carries the `glucose` summary block (mean/GMI/CV/TIR/
//  MODD/ADRR/dawn/daypart), so the review view renders the glycemic dashboard
//  from stored values; the full-resolution per-reading trace is greyed.
// ═══════════════════════════════════════════════════════════════════════════
function glucoLoadOwnExport(json){
  if(!(json && json.schema && json.schema.name === 'ganglior.node-export'))
    return { ok:false, reason:'not-node-export', message:'Not a node-export \u2014 drop a raw CGM CSV, or GlucoDex\u2019s own .json export.' };
  var node = ((json.schema.node || '') + '').trim();
  if(node !== 'GlucoDex')
    return { ok:false, reason:'foreign-node', node:node,
      message:'This is a '+(node||'non-GlucoDex')+' export \u2014 open it in '+(node||'its own node')+', or drop it into the Integrator to fuse.' };
  var el = JSON.parse(JSON.stringify(json)); el._fromExport = true; el._reviewMode = true;
  var evAll = Array.isArray(json.ganglior_events) ? json.ganglior_events.slice() : [];
  evAll.sort(function(a,b){ return ((a&&a.tMs)||0) - ((b&&b.tMs)||0); });
  return {
    ok:true, reviewMode:true, node:node,
    elements:[el], events:evAll,
    provenance:(json.schema && json.schema.provenance) || null,
    generated:(json.schema && json.schema.generated) || null,
    derivedFrom:(json.schema && json.schema.derivedFrom) || null,
    kernel:json.kernel || null, recording:json.recording || null,
    glucose:json.glucose || null,
    scrubbed:!!(json.schema && json.schema.scrubbed),
    multiNight:false, raw:json
  };
}

global.GlucoDex = global.GlucoDex || { compute, parseCSV, analyze, genSynthetic, buildNodeExport:glucoBuildNodeExport, _build:glucoBuildNodeExport };
global.GlucoDex.loadOwnExport = glucoLoadOwnExport;   // SELF-INGEST reload (review-mode clinical view)
// scrub-for-sharing → the SHARED dexScrubExport (D1); lazy delegate, co-load order irrelevant.
global.GlucoDex.scrubExport = function(env){
  if(global.DexExport && typeof global.DexExport.scrubExport === 'function') return global.DexExport.scrubExport(env);
  if(typeof global.dexScrubExport === 'function') return global.dexScrubExport(env);
  return env;
};

})(window);
