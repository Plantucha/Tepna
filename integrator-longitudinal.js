/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   integrator-longitudinal.js — CROSS-NODE LONGITUDINAL read + durable store.
   ────────────────────────────────────────────────────────────────────────
   Orthogonal to the same-night fusion layer. Consumes the standardized
   `ganglior.crossnight` v1.0 envelopes (CROSSNIGHT-ENVELOPE-SPEC.md) that every
   node now emits, persists each node's per-day metric summaries to IndexedDB,
   and date-joins them ACROSS nodes on the shared floating wall-clock to surface
   trends and cross-signal couplings no single node can see — e.g. "declining
   autonomic recovery tracks rising ODI-4 over three weeks."

   Durable by design: the store survives reload, so longitudinal history
   accumulates across sessions. NO network. Floating tMs; getUTC* only.

   Exposes window.IntegratorLong = { open, ingest, render, clear, hasData, state }.
   ════════════════════════════════════════════════════════════════════════ */
(function(global){
'use strict';
var D = global.IntegratorDSP;                 // reuse fmtDate/fmtDayShort/nodeColor

// Synthetic-filter view CSS — injected from this external module (NOT the inline
// .src.html <style>) so adding it leaves the bundle's coarse buildHash untouched
// (buildHash only moves on inline-script/style shell edits), keeping the legacy
// buildHash-stamped fusion fixtures green. manifestHash moves (module changed) →
// BUILD-MANIFEST.json is updated to match on re-bundle.
(function injectSynthCSS(){
  try {
    if(!global.document || global.document.getElementById('long-synth-css')) return;
    var css = '.long-actions{ margin-left:auto; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }'
      + '.cov-grid td.cg-on.cg-synth{ background:transparent; border:1px dashed var(--c); opacity:.9; }'
      + '.cov-grid td.cg-on.cg-synth.cg-lq{ opacity:.4; }'
      + '.ltc-synth{ display:inline-block; margin-left:6px; font-family:\'IBM Plex Mono\',monospace; font-size:8.5px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--text4); border:1px dashed rgba(255,255,255,.22); border-radius:5px; padding:0 5px; vertical-align:middle; }';
    var s = global.document.createElement('style'); s.id='long-synth-css'; s.textContent=css;
    (global.document.head||global.document.documentElement).appendChild(s);
  } catch(e){}
})();
var fmtDate = D ? D.fmtDate : function(ms){ var d=new Date(ms); function p(n){return n<10?'0'+n:''+n;} return d.getUTCFullYear()+'-'+p(d.getUTCMonth()+1)+'-'+p(d.getUTCDate()); };
var fmtDayShort = D ? D.fmtDayShort : fmtDate;
var nodeColor = D ? D.nodeColor : function(){ return '#8C9DB3'; };

// ── IndexedDB store ────────────────────────────────────────────────────────
var DB_NAME='ganglior_integrator', DB_VER=1, STORE='summaries', DEFS='metricDefs';
var _db=null, _rows={}, _defs={}, _meta={};   // in-memory mirror (id→record)

function _openDB(){
  return new Promise(function(res,rej){
    if(!global.indexedDB){ rej(new Error('IndexedDB unavailable')); return; }
    var req=global.indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded=function(e){ var db=e.target.result;
      if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{keyPath:'id'});
      if(!db.objectStoreNames.contains(DEFS))  db.createObjectStore(DEFS, {keyPath:'id'});
    };
    req.onsuccess=function(){ res(req.result); };
    req.onerror=function(){ rej(req.error); };
  });
}
function _txAll(store){
  return new Promise(function(res,rej){
    var out=[], tx=_db.transaction(store,'readonly'), os=tx.objectStore(store);
    var cur=os.openCursor();
    cur.onsuccess=function(e){ var c=e.target.result; if(c){ out.push(c.value); c.continue(); } else res(out); };
    cur.onerror=function(){ rej(cur.error); };
  });
}
function _put(store, recs){
  return new Promise(function(res,rej){
    if(!recs.length){ res(); return; }
    var tx=_db.transaction(store,'readwrite'), os=tx.objectStore(store);
    recs.forEach(function(r){ os.put(r); });
    tx.oncomplete=function(){ res(); }; tx.onerror=function(){ rej(tx.error); };
  });
}
function _clearStore(store){
  return new Promise(function(res,rej){
    var tx=_db.transaction(store,'readwrite'); tx.objectStore(store).clear();
    tx.oncomplete=function(){ res(); }; tx.onerror=function(){ rej(tx.error); };
  });
}

// load the persisted mirror on startup
function open(){
  return _openDB().then(function(db){ _db=db;
    return Promise.all([_txAll(STORE), _txAll(DEFS)]);
  }).then(function(r){
    _rows={}; r[0].forEach(function(x){ _rows[x.id]=x; });
    _defs={}; r[1].forEach(function(x){ _defs[x.id]=x; });
    return true;
  }).catch(function(){ _db=null; return false; });   // degrade gracefully (private mode etc.)
}

// ── detect + ingest a ganglior.crossnight envelope from any loaded JSON ──────
// Returns { count, nodes:[], rows:n } describing what was absorbed.
function _findEnvelopes(json){
  var out=[];
  if(!json || typeof json!=='object') return out;
  function isEnv(o){ return o && o.schema && o.schema.name==='ganglior.crossnight' && o.metrics && Array.isArray(o.series); }
  if(isEnv(json)) out.push(json);
  if(json.crossNight && isEnv(json.crossNight)) out.push(json.crossNight);          // node multi-item wrapper
  // some wrappers nest under different keys — be tolerant
  ['crossnight','cross_night','longitudinal'].forEach(function(k){ if(json[k] && isEnv(json[k])) out.push(json[k]); });
  return out;
}

function ingest(json, filename){
  var envs=_findEnvelopes(json);
  if(!envs.length) return { count:0 };
  var rowRecs=[], defRecs=[], nodes={};
  envs.forEach(function(env){
    var node=(env.schema&&env.schema.node)||'Unknown';
    var eng =(env.schema&&env.schema.engineVersion)||null;
    nodes[node]=1;
    // metric defs (label/unit/goodDirection) — self-describing per the spec
    Object.keys(env.metrics||{}).forEach(function(mid){
      var m=env.metrics[mid];
      var id=node+'|'+mid;
      _defs[id]={ id:id, node:node, metric:mid, label:m.label||mid, unit:m.unit||'',
                  goodDirection:m.goodDirection||'up', evidence:m.evidence||null, cite:m.cite||'', engineVersion:eng };
      defRecs.push(_defs[id]);
    });
    // per-item rows → one persisted row per (node, date)
    (env.series||[]).forEach(function(it){
      if(it.t0Ms==null && it.date==null) return;     // undated → cannot place on axis (never fabricate)
      var date=it.date || (it.t0Ms!=null?fmtDate(it.t0Ms):null);
      if(!date) return;
      var id=node+'|'+date;
      var rec={ id:id, node:node, date:date, t0Ms:(it.t0Ms!=null?it.t0Ms:null),
                values: it.values||{}, weight:(it.weight!=null?it.weight:1),
                lowQuality:!!it.lowQuality, synthetic:!!(env.schema && env.schema.synthetic),
                engineVersion:eng, ingestedAt:Date.now(), src:filename||null };
      _rows[id]=rec; rowRecs.push(rec);
    });
  });
  // write-through to IndexedDB (best-effort; in-memory mirror already updated)
  if(_db){ _put(STORE,rowRecs); _put(DEFS,defRecs); }
  return { count:envs.length, nodes:Object.keys(nodes), rows:rowRecs.length };
}

function clear(){
  _rows={}; _defs={}; _meta={};
  if(_db){ return Promise.all([_clearStore(STORE),_clearStore(DEFS)]); }
  return Promise.resolve();
}
function _deleteIds(store, ids){
  return new Promise(function(res,rej){
    if(!ids.length){ res(); return; }
    var tx=_db.transaction(store,'readwrite'), os=tx.objectStore(store);
    ids.forEach(function(id){ os.delete(id); });
    tx.oncomplete=function(){ res(); }; tx.onerror=function(){ rej(tx.error); };
  });
}
// Delete ONLY synthetic rows (schema.synthetic) — keeps real + pre-Round-I
// (undefined `synthetic`) rows. Mirrors clear()'s sync-mirror + write-through shape.
function clearSynthetic(){
  var ids=Object.keys(_rows).filter(function(id){ return !!_rows[id].synthetic; });
  ids.forEach(function(id){ delete _rows[id]; });     // prune in-memory mirror (sync)
  if(_db){ return _deleteIds(STORE, ids); }           // metricDefs left as-is (shared, harmless)
  return Promise.resolve();
}
function hasData(){ return Object.keys(_rows).length>0; }

// ════════════════════════════════════════════════════════════════════════
//  ANALYSIS — group, align by date across nodes, correlate
// ════════════════════════════════════════════════════════════════════════
// Pure, Node-CI-testable synthetic filter. `includeSynthetic` defaults to true
// (only drops rows when explicitly false). A row with NO `synthetic` field is a
// pre-Round-I real row → treated as real and always kept.
function filterSynthetic(rows, includeSynthetic){
  return includeSynthetic===false ? rows.filter(function(r){ return !r.synthetic; }) : rows;
}
function countSynthetic(){ var n=0; Object.keys(_rows).forEach(function(id){ if(_rows[id].synthetic) n++; }); return n; }
function hasSynthetic(){ return countSynthetic()>0; }

function _allRows(includeSynthetic){
  var rows = Object.keys(_rows).map(function(k){ return _rows[k]; });
  return filterSynthetic(rows, includeSynthetic);
}
function nodes(includeSynthetic){ var s={}; _allRows(includeSynthetic).forEach(function(r){ s[r.node]=1; }); return Object.keys(s).sort(); }
function datesSorted(includeSynthetic){ var s={}; _allRows(includeSynthetic).forEach(function(r){ s[r.date]=1; }); return Object.keys(s).sort(); }

// every (node, metric) that has ≥1 value
function metricKeys(includeSynthetic){
  var s={};
  _allRows(includeSynthetic).forEach(function(r){ Object.keys(r.values||{}).forEach(function(mid){ if(r.values[mid]!=null) s[r.node+'|'+mid]=1; }); });
  return Object.keys(s);
}
// DSP-NITS-2026-07-03 §1: ONE sort key — t0Ms when present (`!= null`: 0 is the sanctioned
// "undated → anchor at 0" value, never rerouted by truthiness), else Date.parse(date) for rows
// with no t0Ms at all. The residual real-UTC-midnight vs floating-t0Ms skew is bounded to one
// tz offset and only affects t0Ms-less rows — do NOT "fix" it by converting t0Ms to real-UTC
// (that would break the floating-clock invariant, Clock Contract §1).
function _sortKey(r){ return r.t0Ms != null ? r.t0Ms : (r.date ? Date.parse(r.date) : 0); }
function seriesFor(node, mid, includeSynthetic){
  return _allRows(includeSynthetic).filter(function(r){ return r.node===node && r.values && r.values[mid]!=null; })
    .map(function(r){ return { date:r.date, t0Ms:r.t0Ms, v:r.values[mid], w:r.weight, lowQuality:r.lowQuality, synthetic:!!r.synthetic }; })
    .sort(function(a,b){ return _sortKey(a) - _sortKey(b); });
}
function defOf(node, mid){ return _defs[node+'|'+mid] || { label:mid, unit:'', goodDirection:'up' }; }

// evidence badge straight from the envelope's self-described evidence field
// (System-Cohesion). Emits ONLY when evidence is present, so a node that does
// not self-describe evidence stays unbadged rather than getting a misleading
// default. Uses the shared MetricRegistry.badge — byte-identical to the nodes.
function evBadge(def){
  try { return (def && def.evidence && global.MetricRegistry) ? global.MetricRegistry.badge(def.evidence, def.cite) : ''; }
  catch(e){ return ''; }
}

function _mean(a){ var s=0; for(var i=0;i<a.length;i++) s+=a[i]; return a.length?s/a.length:0; }
function _pearson(xs,ys){
  var n=xs.length; if(n<3) return null;
  var mx=_mean(xs), my=_mean(ys), sxy=0,sxx=0,syy=0;
  for(var i=0;i<n;i++){ var dx=xs[i]-mx, dy=ys[i]-my; sxy+=dx*dy; sxx+=dx*dx; syy+=dy*dy; }
  if(sxx===0||syy===0) return null;
  return sxy/Math.sqrt(sxx*syy);
}

// cross-node metric couplings: for each pair of (nodeA·metricA, nodeB·metricB)
// with nodeA≠nodeB, join on shared DATE and Pearson-correlate. Ranked by |r|.
// EXPLORATORY (not multiple-comparison corrected) — surfaced as such.
function crossCorrelations(minShared, includeSynthetic){
  minShared = minShared||4;
  var keys=metricKeys(includeSynthetic);
  // index per key: date→value
  var idx={};
  keys.forEach(function(k){ var parts=k.split('|'); var node=parts[0], mid=parts.slice(1).join('|');
    var map={}; seriesFor(node,mid,includeSynthetic).forEach(function(p){ map[p.date]=p.v; }); idx[k]={ node:node, mid:mid, map:map }; });
  var out=[];
  for(var i=0;i<keys.length;i++){
    for(var j=i+1;j<keys.length;j++){
      var A=idx[keys[i]], B=idx[keys[j]];
      if(A.node===B.node) continue;                       // cross-NODE only
      var xs=[], ys=[], dts=[];
      for(var dt in A.map){ if(B.map[dt]!=null){ xs.push(A.map[dt]); ys.push(B.map[dt]); dts.push(dt); } }
      if(xs.length<minShared) continue;
      var r=_pearson(xs,ys); if(r==null) continue;
      var dA=defOf(A.node,A.mid), dB=defOf(B.node,B.mid);
      out.push({ aNode:A.node, aMid:A.mid, aLabel:dA.label, aGood:dA.goodDirection, aEvidence:dA.evidence, aCite:dA.cite,
                 bNode:B.node, bMid:B.mid, bLabel:dB.label, bGood:dB.goodDirection, bEvidence:dB.evidence, bCite:dB.cite,
                 r:+r.toFixed(2), n:xs.length, dates:dts });
    }
  }
  out.sort(function(a,b){ return Math.abs(b.r)-Math.abs(a.r); });
  return out;
}

function state(includeSynthetic){
  return { nodes:nodes(includeSynthetic), dates:datesSorted(includeSynthetic), nRows:_allRows(includeSynthetic).length,
    metricKeys:metricKeys(includeSynthetic), engineVersions:_engineVersions(includeSynthetic) };
}
function _engineVersions(includeSynthetic){ var s={}; _allRows(includeSynthetic).forEach(function(r){ if(r.engineVersion) s[r.engineVersion]=1; }); return Object.keys(s); }

// ════════════════════════════════════════════════════════════════════════
//  RENDER
// ════════════════════════════════════════════════════════════════════════
function _esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function _spark(vals, color, w, h){
  w=w||130; h=h||34; var n=vals.length; if(n<2) return '';
  var mn=Math.min.apply(null,vals), mx=Math.max.apply(null,vals); if(mx===mn)mx=mn+1;
  var P=3, sx=function(i){ return P+i/(n-1)*(w-2*P); }, sy=function(v){ return h-P-(v-mn)/(mx-mn)*(h-2*P); };
  var d=vals.map(function(v,i){ return (i?'L':'M')+sx(i).toFixed(1)+' '+sy(v).toFixed(1); }).join(' ');
  var mean=_mean(vals);
  return '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" style="width:100%;height:'+h+'px">'
    +'<line x1="'+P+'" y1="'+sy(mean).toFixed(1)+'" x2="'+(w-P)+'" y2="'+sy(mean).toFixed(1)+'" stroke="'+color+'" stroke-dasharray="3 3" opacity=".35"/>'
    +'<path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="1.6" stroke-linejoin="round"/>'
    +'<circle cx="'+sx(n-1).toFixed(1)+'" cy="'+sy(vals[n-1]).toFixed(1)+'" r="2.4" fill="'+color+'"/></svg>';
}

function _synthPrefKey(){ return 'ganglior_long_includeSynth'; }
function _readSynthPref(){ try { return localStorage.getItem(_synthPrefKey()) !== '0'; } catch(e){ return true; } }   // default: show
function _writeSynthPref(inc){ try { localStorage.setItem(_synthPrefKey(), inc?'1':'0'); } catch(e){} }

function render(){
  var host=document.getElementById('longBody'); if(!host) return;
  var full=state();                                  // FULL store — drives the store-bar counts
  if(!full.nRows){
    host.innerHTML='<div class="long-empty">No longitudinal data yet. Load any node export that carries a <span class="mono">crossNight</span> block — a PpgDex / ECGDex / OxyDex / PulseDex multi-session export (≥2 recordings), or a bare <span class="mono">ganglior.crossnight</span> envelope. Summaries persist in this browser and accumulate across sessions.</div>';
    var sb0=document.getElementById('longStoreBar'); if(sb0) sb0.innerHTML='';
    return;
  }
  var inc=_readSynthPref();                           // synthetic visibility toggle (persisted)
  var nSyn=countSynthetic();
  var st=state(inc);                                  // VIEW — respects the toggle (coverage/couplings/trends)

  // store status bar
  var sb=document.getElementById('longStoreBar');
  if(sb){
    var engNote = full.engineVersions.length>1 ? ' · <span class="long-warn">⚠ mixed engineVersion '+full.engineVersions.join(', ')+' — trends from different engines are not directly comparable</span>' : (full.engineVersions[0]?(' · engine '+full.engineVersions[0]):'');
    var synNote = nSyn ? ' · <b>'+nSyn+'</b> synthetic'+(inc?'':' <span class="long-warn">hidden</span>') : '';
    var synCtl = nSyn
      ? '<button class="btn long-synth-toggle" id="longSynthToggle" title="Show/hide generated (synthetic) day-summaries in the views below. Real and synthetic rows for the same node|date collide by design (last write wins).">'+(inc?'Hide synthetic':'Show synthetic')+'</button>'
        + '<button class="btn btn-destructive" id="longSynthClear" title="Delete only generated (synthetic) day-summaries; keeps real data.">Clear synthetic</button>'
      : '';
    sb.innerHTML='<span class="long-store-ico">💾</span> <b>'+full.nRows+'</b> day-summaries persisted across <b>'+full.nodes.length+'</b> node'+(full.nodes.length===1?'':'s')+' · <b>'+full.dates.length+'</b> distinct dates · survives reload'+synNote+engNote
      +'<span class="long-actions">'+synCtl+'<button class="btn btn-destructive" id="longClearBtn">Clear store</button></span>';
  }

  var html='';

  // ── 1 · cross-node coverage strip (which nodes have data on which dates) ──
  html+='<div class="section-block"><h3>Cross-node coverage</h3>'
    + '<p class="long-sub">Each node\'s recordings placed on one shared date axis. Where columns line up, the same day is seen by multiple signals — that\'s where cross-signal coupling becomes readable.</p>'
    + _coverageGrid(st, inc) + '</div>';

  // ── 2 · cross-node correlations (the payoff) ──
  var cors=crossCorrelations(4, inc);
  html+='<div class="section-block"><h3>Cross-signal couplings <span class="long-count">'+cors.length+'</span></h3>';
  if(!cors.length){
    html+='<div class="long-empty">No cross-node metric pair yet shares ≥4 dates. Load more overlapping days (or more nodes) — couplings appear once two signals have enough common dates.</div>';
  } else {
    html+='<p class="long-sub">Pearson <i>r</i> between metrics from <b>different nodes</b>, joined on shared dates. Exploratory — ranked by strength, not multiple-comparison corrected. Direction noted against each metric\'s healthy direction.</p>';
    html+='<div class="cor-grid">'+cors.slice(0,8).map(_corCard).join('')+'</div>';
  }
  html+='</div>';

  // ── 3 · per-node metric trends (sparklines) ──
  html+='<div class="section-block"><h3>Per-node trends</h3><div class="long-trend-grid">';
  st.nodes.forEach(function(node){
    var mids={}; _allRows(inc).forEach(function(r){ if(r.node===node) Object.keys(r.values||{}).forEach(function(m){ if(r.values[m]!=null) mids[m]=1; }); });
    Object.keys(mids).forEach(function(mid){
      var ser=seriesFor(node,mid,inc); if(ser.length<2) return;
      var def=defOf(node,mid), col=nodeColor(node);
      var vals=ser.map(function(p){return p.v;});
      var first=vals[0], last=vals[vals.length-1];
      var delta=last-first; var dir = Math.abs(delta)<1e-9?'→':(delta>0?'↑':'↓');
      var synChip = ser.some(function(p){return p.synthetic;}) ? '<span class="ltc-synth" title="includes synthetic (generated) days">synthetic</span>' : '';
      html+='<div class="long-trend-cell"><div class="ltc-head"><span class="ltc-node" style="color:'+col+'">'+_esc(node)+synChip+'</span><span class="ltc-metric">'+_esc(def.label)+evBadge(def)+'</span></div>'
        +_spark(vals,col)
        +'<div class="ltc-foot"><span class="mono">'+(+last.toFixed(2))+' '+_esc(def.unit)+'</span><span class="mono ltc-dir">'+dir+' '+(delta>0?'+':'')+(+delta.toFixed(2))+' over '+ser.length+'d</span></div></div>';
    });
  });
  html+='</div></div>';

  host.innerHTML=html;
  var cb=document.getElementById('longClearBtn');
  if(cb) cb.addEventListener('click', function(){ clear().then(function(){ render(); }); });
  var tg=document.getElementById('longSynthToggle');
  if(tg) tg.addEventListener('click', function(){ _writeSynthPref(!_readSynthPref()); render(); });
  var sc=document.getElementById('longSynthClear');
  if(sc) sc.addEventListener('click', function(){ clearSynthetic().then(function(){ render(); }); });
}

function _coverageGrid(st, includeSynthetic){
  var dates=st.dates, nodesL=st.nodes;
  if(dates.length>60) dates=dates.slice(dates.length-60);   // cap for legibility
  var rows=_allRows(includeSynthetic);
  var has={}; rows.forEach(function(r){ has[r.node+'|'+r.date]=r; });
  var head='<th class="cg-node-h"></th>'+dates.map(function(d){ return '<th class="cg-date-h"><span>'+_esc(d.slice(5))+'</span></th>'; }).join('');
  var body=nodesL.map(function(node){
    var col=nodeColor(node);
    var cells=dates.map(function(d){ var r=has[node+'|'+d];
      if(!r) return '<td class="cg-cell"></td>';
      var lq=r.lowQuality?' cg-lq':'';
      var sy=r.synthetic?' cg-synth':'';
      return '<td class="cg-cell cg-on'+lq+sy+'" style="--c:'+col+'" title="'+_esc(node+' · '+d+(r.lowQuality?' · low quality':'')+(r.synthetic?' · synthetic':''))+'"></td>';
    }).join('');
    return '<tr><td class="cg-node" style="color:'+col+'">'+_esc(node)+'</td>'+cells+'</tr>';
  }).join('');
  return '<div class="cg-scroll"><table class="cov-grid"><thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table></div>';
}

function _corCard(c){
  var strong=Math.abs(c.r)>=0.6, mod=Math.abs(c.r)>=0.4;
  var accent = !mod?'#8C9DB3':(c.r<0?'#FF6B7A':'#3DE0D0');
  var arrow = c.r>0?'co-vary together':'move oppositely';
  // physiological reading against good-direction
  var reading;
  if(c.r>=0.4){ reading=(c.aGood===c.bGood)?'rise and fall together — consistent direction':'one improving tracks the other worsening'; }
  else if(c.r<=-0.4){ reading=(c.aGood===c.bGood)?'one rises as the other falls — divergent':'as one improves the other does too (inverse metrics)'; }
  else reading='weak association';
  return '<div class="cor-card" style="--c:'+accent+'">'
    +'<div class="cor-pair"><span class="cor-node" style="color:'+nodeColor(c.aNode)+'">'+_esc(c.aNode)+'</span> <b>'+_esc(c.aLabel)+evBadge({evidence:c.aEvidence,cite:c.aCite})+'</b>'
      +'<span class="cor-link">'+(c.r<0?'⟷':'⟺')+'</span>'
      +'<span class="cor-node" style="color:'+nodeColor(c.bNode)+'">'+_esc(c.bNode)+'</span> <b>'+_esc(c.bLabel)+evBadge({evidence:c.bEvidence,cite:c.bCite})+'</b></div>'
    +'<div class="cor-r"><span class="cor-rval">r = '+(c.r>0?'+':'')+c.r+'</span><span class="cor-n">'+c.n+' shared days</span></div>'
    +'<div class="cor-note">'+(strong?'Strong':mod?'Moderate':'Weak')+' — metrics '+arrow+'. '+reading+'.</div>'
    +'<span class="cor-ev">'+(global.MetricRegistry?global.MetricRegistry.badge('experimental','Exploratory cross-night Pearson r — ranked by strength, not multiple-comparison corrected.'):'')+'</span></div>';
}

global.IntegratorLong = { open:open, ingest:ingest, render:render, clear:clear, clearSynthetic:clearSynthetic,
  hasData:hasData, hasSynthetic:hasSynthetic, countSynthetic:countSynthetic, filterSynthetic:filterSynthetic,
  state:state, crossCorrelations:crossCorrelations, seriesFor:seriesFor };

})(window);
