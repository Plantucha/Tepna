/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   PpgDex · RENDER  (ppgdex-render.js)
   ────────────────────────────────────────────────────────────────────────
   · PPGScope — canvas waveform explorer (min/max envelope pyramid, pan/zoom),
     systolic-peak + foot markers, greyed motion/SQI-excluded spans. Cloned
     from ECGDex's scope; fed the band-passed PPG quantised to Int16.
   · hand-rolled inline-SVG charts (PPI tachogram · Poincaré · motion ribbon ·
     median-pulse morphology overlay · epoch trends) — PulseDex pattern.
   Exposes window.PPGUI
   ════════════════════════════════════════════════════════════════════════ */

// ── evidence badge hook (System-Cohesion) — resolves a badge from a rendered
// label via PpgRegistry (ppgdex-registry.js). Zero-touch; safe no-op if the
// registry is unloaded. Global so app.js can call it directly.
function evBadge(label, fallback){
  try { return (window.PpgRegistry && window.PpgRegistry.badgeForLabel(label, fallback!==false)) || ''; }
  catch(e){ return ''; }
}

(function (global) {
'use strict';

const C = { teal:'#3DE0D0', blue:'#58A6FF', green:'#39D98A', amber:'#FFB84D', red:'#FF6B7A', purple:'#a78bfa',
            grid:'rgba(255,255,255,.07)', axis:'rgba(255,255,255,.14)', dim:'#6F8096' };

function buildEnvelope(int16, factor){
  const n = Math.ceil(int16.length/factor);
  const mins = new Int16Array(n), maxs = new Int16Array(n);
  for (let b = 0; b < n; b++){
    let lo = 32767, hi = -32768; const s = b*factor, e = Math.min(s+factor, int16.length);
    for (let i = s; i < e; i++){ const v = int16[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    mins[b] = lo; maxs[b] = hi;
  }
  return { mins, maxs, factor };
}

// ════════════════════════════════════════════════════════════════════════
//  PPGScope — interactive canvas
// ════════════════════════════════════════════════════════════════════════
class PPGScope {
  constructor(canvas, mini){
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.mini = mini; this.mctx = mini ? mini.getContext('2d') : null;
    this.data = null; this.view = { start:0, span:0 };
    this._bindEvents();
  }
  setData(r){
    this.fs = r.fs; this.N = r.disp.length;
    // quantise band-passed PPG to Int16 for the envelope pyramid
    let lo=Infinity,hi=-Infinity; for(let i=0;i<this.N;i++){ const v=r.disp[i]; if(v<lo)lo=v; if(v>hi)hi=v; }
    const rng=(hi-lo)||1; const scale=28000/rng;
    const int16=new Int16Array(this.N);
    for(let i=0;i<this.N;i++) int16[i]=Math.max(-32768,Math.min(32767,Math.round((r.disp[i]-(lo+hi)/2)*scale)));
    this.int16=int16;
    const factors=[1,8,64,512,4096]; this.pyr={}; for(const f of factors) this.pyr[f]= f===1?null:buildEnvelope(int16,f); this.factors=factors;
    this.peakSamp = r.peakSamp || [];
    this.footSamp = r.footSamp || [];
    this.times = r.beatTimes || [];           // systolic-peak times (sec)
    this.relSec = r.relSec;
    this.sqi = r.sqi || [];
    this.motion = r.motion && r.motion.hasData ? r.motion : null;
    let ylo=32767,yhi=-32768,step=Math.max(1,Math.floor(this.N/40000));
    for(let i=0;i<this.N;i+=step){ const v=int16[i]; if(v<ylo)ylo=v; if(v>yhi)yhi=v; }
    const pad=(yhi-ylo)*0.10||100; this.yLo=ylo-pad; this.yHi=yhi+pad;
    const tenS=Math.min(this.N,10*this.fs); this.view={ start:0, span:tenS };
    this.resize(); this.draw(); this.drawMini();
  }
  resize(){
    const dpr=window.devicePixelRatio||1;
    for(const cv of [this.canvas,this.mini]){ if(!cv) continue; const r=cv.getBoundingClientRect();
      cv.width=Math.max(2,Math.round(r.width*dpr)); cv.height=Math.max(2,Math.round(r.height*dpr)); }
  }
  _secAt(samp){ const i=Math.max(0,Math.min(this.N-1,Math.round(samp))); return this.relSec?this.relSec[i]:i/this.fs; }
  _pickLevel(spp){ let best=1; for(const f of this.factors){ if(f<=spp) best=f; } return best; }
  draw(){
    if(!this.int16) return;
    const ctx=this.ctx,W=this.canvas.width,H=this.canvas.height,dpr=window.devicePixelRatio||1;
    ctx.clearRect(0,0,W,H);
    const padL=4*dpr,padR=4*dpr,padT=6*dpr,padB=18*dpr,plotW=W-padL-padR,plotH=H-padT-padB;
    const { start, span }=this.view;
    const sy=v=>padT+(this.yHi-v)/(this.yHi-this.yLo)*plotH;
    const secStart=this._secAt(start), secEnd=this._secAt(start+span), secSpan=secEnd-secStart||span/this.fs;
    // gridlines
    ctx.strokeStyle=C.grid; ctx.lineWidth=1;
    let tick=secSpan/8>1?Math.ceil(secSpan/8):(secSpan/8>0.2?0.5:0.2);
    if(secSpan>120) tick=Math.ceil(secSpan/8/60)*60;
    ctx.fillStyle=C.dim; ctx.font=(10*dpr)+'px ui-monospace, monospace'; ctx.textAlign='center';
    for(let t=Math.ceil(secStart/tick)*tick; t<secStart+secSpan; t+=tick){
      const x=padL+(t-secStart)/secSpan*plotW;
      ctx.beginPath(); ctx.moveTo(x,padT); ctx.lineTo(x,padT+plotH); ctx.stroke();
      const lbl=secSpan>120?(t/60).toFixed(0)+'m':(secSpan>12?t.toFixed(0)+'s':t.toFixed(1)+'s');
      ctx.fillText(lbl,x,H-5*dpr);
    }
    // greyed motion / low-SQI spans (motion ribbon overlay)
    if(this.motion){
      ctx.fillStyle='rgba(167,139,250,.10)';
      const dt=this.motion.dt, grid=this.motion.grid;
      for(let g=0;g<grid.length;g++){ if(grid[g]>0.5){ const t0=g*dt,t1=t0+dt;
        const x0=padL+(t0-secStart)/secSpan*plotW, x1=padL+(t1-secStart)/secSpan*plotW;
        if(x1>padL&&x0<padL+plotW) ctx.fillRect(Math.max(padL,x0),padT,Math.min(padL+plotW,x1)-Math.max(padL,x0),plotH);
      } }
    }
    // waveform via envelope
    const spp=span/plotW*dpr, f=this._pickLevel(spp);
    ctx.strokeStyle=C.teal; ctx.lineWidth=1.2*dpr; ctx.beginPath();
    if(f===1){ const i0=Math.max(0,Math.floor(start)),i1=Math.min(this.N-1,Math.ceil(start+span)); let first=true;
      for(let i=i0;i<=i1;i++){ const x=padL+(i-start)/span*plotW,y=sy(this.int16[i]); if(first){ctx.moveTo(x,y);first=false;}else ctx.lineTo(x,y); }
      ctx.stroke();
    } else { const env=this.pyr[f]; const b0=Math.max(0,Math.floor(start/f)),b1=Math.min(env.mins.length-1,Math.ceil((start+span)/f));
      for(let b=b0;b<=b1;b++){ const x=padL+(b*f-start)/span*plotW; ctx.moveTo(x,sy(env.maxs[b])); ctx.lineTo(x,sy(env.mins[b])); }
      ctx.stroke();
    }
    // systolic-peak + foot markers (when zoomed enough)
    if(span<45*this.fs && this.peakSamp.length){
      for(let k=0;k<this.peakSamp.length;k++){
        const ps=this.peakSamp[k]; if(ps<start||ps>start+span) continue;
        const x=padL+(ps-start)/span*plotW;
        const good=!this.sqi.length||this.sqi[k]>=0.4;
        ctx.fillStyle=good?C.amber:C.red;
        const yTop=sy(this.int16[Math.round(ps)]||0)-6*dpr;
        ctx.beginPath(); ctx.arc(x,yTop,2.6*dpr,0,2*Math.PI); ctx.fill();
        // foot tick
        const fsmp=this.footSamp[k]; if(fsmp!=null && fsmp>=start && fsmp<=start+span){ const fx=padL+(fsmp-start)/span*plotW;
          ctx.strokeStyle='rgba(88,166,255,.6)'; ctx.lineWidth=1*dpr; ctx.beginPath();
          ctx.moveTo(fx,sy(this.int16[Math.round(fsmp)]||0)); ctx.lineTo(fx,sy(this.int16[Math.round(fsmp)]||0)+8*dpr); ctx.stroke(); }
      }
    }
  }
  drawMini(){
    if(!this.mctx) return;
    const ctx=this.mctx,W=this.mini.width,H=this.mini.height; ctx.clearRect(0,0,W,H);
    const env=this.pyr[4096]||this.pyr[512]; if(!env) return;
    const sy=v=>2+(this.yHi-v)/(this.yHi-this.yLo)*(H-4);
    ctx.strokeStyle='rgba(61,224,208,.45)'; ctx.lineWidth=1; ctx.beginPath();
    const nB=env.mins.length;
    for(let px=0;px<W;px++){ const b=Math.floor(px/W*nB); ctx.moveTo(px,sy(env.maxs[b])); ctx.lineTo(px,sy(env.mins[b])); }
    ctx.stroke();
    const x0=this.view.start/this.N*W,x1=(this.view.start+this.view.span)/this.N*W;
    ctx.fillStyle='rgba(88,166,255,.18)'; ctx.fillRect(x0,0,Math.max(2,x1-x0),H);
    ctx.strokeStyle=C.blue; ctx.lineWidth=1.5; ctx.strokeRect(x0,0.5,Math.max(2,x1-x0),H-1);
  }
  zoom(factor,cf){ const c=this.view.start+this.view.span*(cf==null?0.5:cf); let span=this.view.span*factor;
    span=Math.max(this.fs*0.5,Math.min(this.N,span)); let start=c-span*(cf==null?0.5:cf);
    start=Math.max(0,Math.min(this.N-span,start)); this.view={start,span}; this.draw(); this.drawMini(); this._emit(); }
  fitAll(){ this.view={start:0,span:this.N}; this.draw(); this.drawMini(); this._emit(); }
  setSpanSec(sec){ const c=this.view.start+this.view.span/2; let span=Math.max(this.fs*0.5,Math.min(this.N,sec*this.fs));
    let start=Math.max(0,Math.min(this.N-span,c-span/2)); this.view={start,span}; this.draw(); this.drawMini(); this._emit(); }
  _emit(){ if(this.onView) this.onView(this.view,this.fs,this.N,this._secAt.bind(this)); }
  _bindEvents(){
    const cv=this.canvas;
    cv.addEventListener('wheel',e=>{ if(!this.int16)return; e.preventDefault();
      const r=cv.getBoundingClientRect(); const frac=(e.clientX-r.left)/r.width; this.zoom(e.deltaY>0?1.25:0.8,frac); },{passive:false});
    let drag=null;
    cv.addEventListener('pointerdown',e=>{ drag={x:e.clientX,start:this.view.start}; cv.setPointerCapture(e.pointerId); cv.style.cursor='grabbing'; });
    cv.addEventListener('pointermove',e=>{ if(!drag||!this.int16)return; const r=cv.getBoundingClientRect();
      const dPx=e.clientX-drag.x; const dSamp=-dPx/r.width*this.view.span;
      let start=Math.max(0,Math.min(this.N-this.view.span,drag.start+dSamp)); this.view.start=start; this.draw(); this.drawMini(); this._emit(); });
    const end=()=>{ drag=null; cv.style.cursor='grab'; };
    cv.addEventListener('pointerup',end); cv.addEventListener('pointercancel',end);
    if(this.mini){ const jump=e=>{ const r=this.mini.getBoundingClientRect(); const frac=(e.clientX-r.left)/r.width;
        let start=Math.max(0,Math.min(this.N-this.view.span,frac*this.N-this.view.span/2)); this.view.start=start; this.draw(); this.drawMini(); this._emit(); };
      let md=false; this.mini.addEventListener('pointerdown',e=>{ md=true; jump(e); });
      this.mini.addEventListener('pointermove',e=>{ if(md) jump(e); }); window.addEventListener('pointerup',()=>md=false);
    }
    window.addEventListener('resize',()=>{ if(this.int16){ this.resize(); this.draw(); this.drawMini(); } });
  }
}

// ════════════════════════════════════════════════════════════════════════
//  SVG CHARTS
// ════════════════════════════════════════════════════════════════════════
function lineChart(pts, color, opts){
  opts=opts||{}; const W=opts.W||680,H=opts.H||150,P={l:46,r:14,t:14,b:24},n=pts.length;
  if(!n) return '';
  let ymn=opts.ymn!=null?opts.ymn:Infinity,ymx=opts.ymx!=null?opts.ymx:-Infinity,xmn=Infinity,xmx=-Infinity;
  for(const p of pts){ if(opts.ymn==null&&p.y<ymn)ymn=p.y; if(opts.ymx==null&&p.y>ymx)ymx=p.y; if(p.x<xmn)xmn=p.x; if(p.x>xmx)xmx=p.x; }
  if(ymx===ymn)ymx=ymn+1; if(xmx===xmn)xmx=xmn+1;
  const sx=x=>P.l+(x-xmn)/(xmx-xmn)*(W-P.l-P.r);
  const sy=y=>H-P.b-(y-ymn)/(ymx-ymn)*(H-P.t-P.b);
  const line=pts.map((p,k)=>(k?'L':'M')+sx(p.x).toFixed(1)+' '+sy(p.y).toFixed(1)).join(' ');
  const area=`M${sx(pts[0].x).toFixed(1)} ${(H-P.b)} `+pts.map(p=>'L'+sx(p.x).toFixed(1)+' '+sy(p.y).toFixed(1)).join(' ')+` L${sx(pts[n-1].x).toFixed(1)} ${(H-P.b)} Z`;
  const xt=[]; const xstep=(xmx-xmn)/5; for(let i=0;i<=5;i++) xt.push(xmn+i*xstep);
  const med=opts.med;
  const marks=(opts.marks||[]).map(m=>`<line x1="${sx(m).toFixed(1)}" y1="${P.t}" x2="${sx(m).toFixed(1)}" y2="${H-P.b}" stroke="${C.red}" stroke-width="1" opacity=".5"/>`).join('');
  const gid='g'+Math.random().toString(36).slice(2,7);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" style="width:100%;height:auto">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <line x1="${P.l}" y1="${H-P.b}" x2="${W-P.r}" y2="${H-P.b}" stroke="${C.axis}"/>
    <line x1="${P.l}" y1="${P.t}" x2="${P.l}" y2="${H-P.b}" stroke="${C.axis}"/>
    ${med!=null?`<line x1="${P.l}" y1="${sy(med).toFixed(1)}" x2="${W-P.r}" y2="${sy(med).toFixed(1)}" stroke="${color}" stroke-dasharray="4 4" opacity=".5"/>`:''}
    <text x="${P.l-6}" y="${(sy(ymx)+4).toFixed(1)}" fill="${C.dim}" font-size="9" text-anchor="end" font-family="ui-monospace,monospace">${ymx.toFixed(0)}</text>
    <text x="${P.l-6}" y="${(sy(ymn)+4).toFixed(1)}" fill="${C.dim}" font-size="9" text-anchor="end" font-family="ui-monospace,monospace">${ymn.toFixed(0)}</text>
    ${xt.map(x=>`<text x="${sx(x).toFixed(1)}" y="${H-7}" fill="${C.dim}" font-size="9" text-anchor="middle" font-family="ui-monospace,monospace">${opts.xfmt?opts.xfmt(x):x.toFixed(0)}</text>`).join('')}
    ${marks}
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`;
}

function poincare(nn, sd1v, sd2v){
  const W=320,H=300,P=34; const n=nn.length; if(n<3) return '';
  const xs=[],ys=[]; for(let i=1;i<n;i++){ xs.push(nn[i-1]); ys.push(nn[i]); }
  let mn=Math.min(arrMin(xs),arrMin(ys)),mx=Math.max(arrMax(xs),arrMax(ys));
  const pad=(mx-mn)*0.06||30; mn-=pad; mx+=pad;
  const sc=v=>P+(v-mn)/(mx-mn)*(W-2*P), scY=v=>H-P-(v-mn)/(mx-mn)*(H-2*P);
  const m=meanA(nn); const stepP=Math.max(1,Math.floor(xs.length/2600));
  let dots=''; for(let i=0;i<xs.length;i+=stepP){ dots+=`<circle cx="${sc(xs[i]).toFixed(1)}" cy="${scY(ys[i]).toFixed(1)}" r="1.3" fill="${C.teal}" opacity=".5"/>`; }
  const cx=sc(m),cy=scY(m); const ex=sd2v/(mx-mn)*(W-2*P), ey=sd1v/(mx-mn)*(H-2*P);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" style="width:100%;height:auto;max-width:340px;margin:0 auto;display:block">
    <line x1="${P}" y1="${H-P}" x2="${W-P}" y2="${P}" stroke="${C.axis}" stroke-dasharray="3 3"/>
    <line x1="${P}" y1="${H-P}" x2="${W-P}" y2="${H-P}" stroke="${C.axis}"/>
    <line x1="${P}" y1="${P}" x2="${P}" y2="${H-P}" stroke="${C.axis}"/>
    ${dots}
    <g transform="rotate(-45 ${cx} ${cy})"><ellipse cx="${cx}" cy="${cy}" rx="${Math.abs(ex).toFixed(1)}" ry="${Math.abs(ey).toFixed(1)}" fill="rgba(88,166,255,.10)" stroke="${C.blue}" stroke-width="1.4"/></g>
    <text x="${W/2}" y="${H-8}" fill="${C.dim}" font-size="10" text-anchor="middle" font-family="ui-monospace,monospace">PPIₙ (ms)</text>
    <text x="12" y="${H/2}" fill="${C.dim}" font-size="10" text-anchor="middle" font-family="ui-monospace,monospace" transform="rotate(-90 12 ${H/2})">PPIₙ₊₁ (ms)</text>
  </svg>`;
}

// median-pulse with morphology fiducials (foot · systolic · notch · diastolic)
function medianPulseChart(mb, del){
  const W=680,H=260,P={l:30,r:16,t:24,b:34};
  const beat=del.beat||mb.beat, L=beat.length, fs=mb.fs;
  let ymn=Infinity,ymx=-Infinity; for(const v of beat){ if(v<ymn)ymn=v; if(v>ymx)ymx=v; }
  const pad=(ymx-ymn)*0.12||0.1; ymn-=pad; ymx+=pad;
  const sx=i=>P.l+i/(L-1)*(W-P.l-P.r);
  const sy=v=>H-P.b-(v-ymn)/(ymx-ymn)*(H-P.t-P.b);
  const path=beat.map((v,i)=>(i?'L':'M')+sx(i).toFixed(1)+' '+sy(v).toFixed(1)).join(' ');
  const area=`M${sx(0).toFixed(1)} ${H-P.b} `+beat.map((v,i)=>'L'+sx(i).toFixed(1)+' '+sy(v).toFixed(1)).join(' ')+` L${sx(L-1).toFixed(1)} ${H-P.b} Z`;
  const m=del.marks||{};
  const dot=(i,col,lbl)=> i>=0?`<circle cx="${sx(i).toFixed(1)}" cy="${sy(beat[Math.round(i)]).toFixed(1)}" r="3.4" fill="${col}"/><text x="${sx(i).toFixed(1)}" y="${(sy(beat[Math.round(i)])-9).toFixed(1)}" fill="${col}" font-size="9.5" text-anchor="middle" font-family="ui-monospace,monospace">${lbl}</text>`:'';
  const vline=(i,col)=> i>=0?`<line x1="${sx(i).toFixed(1)}" y1="${P.t}" x2="${sx(i).toFixed(1)}" y2="${H-P.b}" stroke="${col}" stroke-width="1" stroke-dasharray="3 3" opacity=".45"/>`:'';
  const gid='mp'+Math.random().toString(36).slice(2,7);
  // rise-time span bar foot→systolic
  let riseBar='';
  if(m.footI!=null&&m.sysI!=null){ const y=H-P.b+14;
    riseBar=`<line x1="${sx(m.footI).toFixed(1)}" y1="${y}" x2="${sx(m.sysI).toFixed(1)}" y2="${y}" stroke="${C.blue}" stroke-width="2"/><line x1="${sx(m.footI).toFixed(1)}" y1="${y-3}" x2="${sx(m.footI).toFixed(1)}" y2="${y+3}" stroke="${C.blue}"/><line x1="${sx(m.sysI).toFixed(1)}" y1="${y-3}" x2="${sx(m.sysI).toFixed(1)}" y2="${y+3}" stroke="${C.blue}"/><text x="${((sx(m.footI)+sx(m.sysI))/2).toFixed(1)}" y="${y-4}" fill="${C.blue}" font-size="8.5" text-anchor="middle" font-family="ui-monospace,monospace">rise ${del.riseTimeMs}ms</text>`; }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" style="width:100%;height:auto">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.teal}" stop-opacity=".22"/><stop offset="1" stop-color="${C.teal}" stop-opacity="0"/></linearGradient></defs>
    ${vline(m.notchI,C.amber)}
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${path}" fill="none" stroke="${C.teal}" stroke-width="2" stroke-linejoin="round"/>
    ${dot(m.footI,C.blue,'foot')}
    ${dot(m.sysI,C.teal,'systolic')}
    ${m.notchI>=0?dot(m.notchI,C.amber,'notch'):''}
    ${m.diaI>=0?dot(m.diaI,C.purple,'reflected'):''}
    ${riseBar}
  </svg>`;
}

function arrMin(a){let m=Infinity;for(let i=0;i<a.length;i++)if(a[i]<m)m=a[i];return m;}
function arrMax(a){let m=-Infinity;for(let i=0;i<a.length;i++)if(a[i]>m)m=a[i];return m;}
function meanA(a){let s=0;for(let i=0;i<a.length;i++)s+=a[i];return s/a.length;}

// ════════════════════════════════════════════════════════════════════════
//  3-LED AGREEMENT RIBBON (PPGDEX-BEAT-DETECTION-PERF §5)
//  Per-5-min-epoch stacked fraction of 3/3 (green · all LEDs agree) · 2/3 (amber ·
//  kept, one LED dissents) · 1/3 (red · single-LED, DROPPED as a gap) beats. Hand-
//  rolled inline SVG, the existing chart idiom; sits beside the motion ribbon so a
//  user sees at a glance where the optical signal was trustworthy vs where only one
//  LED carried it — the low-agreement spans line up with high correction / low-
//  analyzable windows. Hidden when there is no per-channel data (single-channel
//  legacy export → series null/empty → '' → app hides the card).
// ════════════════════════════════════════════════════════════════════════
function ledRibbon(series, opts){
  opts=opts||{}; if(!series||!series.length) return '';
  const W=opts.W||680, H=opts.H||120, P={l:38,r:14,t:12,b:24};
  const plotW=W-P.l-P.r, plotH=H-P.t-P.b;
  let xmn=Infinity,xmx=-Infinity; for(const s of series){ if(s.tMin<xmn)xmn=s.tMin; if(s.tMin>xmx)xmx=s.tMin; }
  if(xmx===xmn)xmx=xmn+5;
  const span=xmx-xmn||5;
  const bw=Math.max(3, Math.min(plotW*0.9, (plotW/(span/5+1))*0.82));   // 5-min epochs
  const sx=x=>P.l+(x-xmn)/span*(plotW-bw)+bw/2;
  const bars=series.map(s=>{
    const x0=(sx(s.tMin)-bw/2);
    let y=P.t+plotH; const out=[];
    const seg=(frac,col)=>{ const hh=(frac||0)*plotH; if(hh<=0.2) return; y-=hh; out.push(`<rect x="${x0.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}" fill="${col}"/>`); };
    seg(s.f3,C.green); seg(s.f2,C.amber); seg(s.f1,C.red);   // stack bottom→top: 3/3, 2/3, 1/3
    return out.join('');
  }).join('');
  const xt=[]; for(let i=0;i<=4;i++) xt.push(xmn+i*span/4);
  const xf=x=>span>120?(x/60).toFixed(1)+'h':x.toFixed(0)+'m';
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" style="width:100%;height:auto">
    <line x1="${P.l}" y1="${H-P.b}" x2="${W-P.r}" y2="${H-P.b}" stroke="${C.axis}"/>
    <line x1="${P.l}" y1="${P.t}" x2="${P.l}" y2="${H-P.b}" stroke="${C.axis}"/>
    <text x="${P.l-6}" y="${P.t+8}" fill="${C.dim}" font-size="9" text-anchor="end" font-family="ui-monospace,monospace">100%</text>
    <text x="${P.l-6}" y="${H-P.b}" fill="${C.dim}" font-size="9" text-anchor="end" font-family="ui-monospace,monospace">0</text>
    ${bars}
    ${xt.map(x=>`<text x="${sx(x).toFixed(1)}" y="${H-7}" fill="${C.dim}" font-size="9" text-anchor="middle" font-family="ui-monospace,monospace">${xf(x)}</text>`).join('')}
  </svg>`;
}

global.PPGUI = { PPGScope, lineChart, poincare, medianPulseChart, ledRibbon, buildEnvelope, COLORS:C };

})(window);
