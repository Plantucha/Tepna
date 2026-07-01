/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   integrator-render.js — DOM + inline-SVG rendering. No parsing/fusion math.
   Reads helpers off window.IntegratorDSP. Hand-rolled SVG via template strings
   (mirrors PulseDex lineChartSVG pattern). Plain global script.
   ════════════════════════════════════════════════════════════════════════ */
(function(){
  var D = window.IntegratorDSP;
  var esc = function(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };
  var $ = function(id){ return document.getElementById(id); };

  /* ── inject the glassy hero stylesheet ────────────────────────────────────
     Idiomatic for this suite (mirrors metric-registry.js injecting BADGE_CSS):
     keeping the hero look in JS leaves Integrator.src.html untouched, so the
     bundle buildHash is unchanged and the committed fusion provenance fixtures
     stay reproducible. Appended after the page <style> → wins on cascade order. */
  (function injectHeroCSS(){
    if(document.getElementById('integrator-hero-css')) return;
    var css = `
#hero{ margin-bottom:22px; }
/* Robustness: the shared .main-content fadeIn (and any from-opacity:0 entrance)
   leaves content invisible if the document timeline is frozen/throttled
   (preview capture, print, PDF export, background tab). Pin the end-state as
   the base so the app is ALWAYS visible; the subtle fade isn't worth a blank
   screen. Scoped to Integrator via this injected sheet — ans-design.css untouched. */
.main-content{ animation:none !important; opacity:1 !important; transform:none !important; }
/* same guard for the staggered card/KPI entrance animations (cardEntrance/fadeIn,
   fill:both) \u2014 they hold opacity:0 when the doc timeline is frozen. Pin opacity
   only (NOT transform) so hover-lift transitions still work. */
#kpiStrip.show, #kpiStrip .kpi, .chart-card, .finding-card, .pair-card, .metric{ animation:none !important; opacity:1 !important; }
.hero-card{ position:relative; overflow:hidden; border-radius:18px; padding:24px 26px;
  background:linear-gradient(135deg, rgba(255,255,255,.07), rgba(255,255,255,.02)),
             linear-gradient(180deg, rgba(28,38,52,.82), rgba(16,22,31,.74));
  border:1px solid rgba(255,255,255,.10);
  -webkit-backdrop-filter:blur(20px) saturate(1.4); backdrop-filter:blur(20px) saturate(1.4);
  box-shadow:0 16px 46px rgba(0,0,0,.40), inset 0 1px 0 rgba(255,255,255,.08); }
body.light .hero-card{ background:linear-gradient(135deg, rgba(255,255,255,.9), rgba(255,255,255,.66));
  border-color:rgba(0,0,0,.06); box-shadow:0 10px 32px rgba(15,23,42,.09), inset 0 1px 0 rgba(255,255,255,.6); }
.hero-card::before{ content:''; position:absolute; top:-48%; right:-8%; width:54%; height:200%;
  border-radius:50%; pointer-events:none;
  background:radial-gradient(circle, rgba(61,224,208,.16), transparent 62%); }
.hero-amber::before{ background:radial-gradient(circle, rgba(255,184,77,.18), transparent 62%); }
.hero-eyebrow{ font-size:11px; text-transform:uppercase; letter-spacing:.11em; font-weight:700;
  color:var(--teal); display:inline-flex; align-items:center; gap:8px; position:relative; z-index:1; }
.hero-amber .hero-eyebrow{ color:var(--amber); }
.hero-h1{ font-size:28px; font-weight:800; letter-spacing:-.025em; margin-top:10px; color:var(--text);
  line-height:1.12; position:relative; z-index:1; }
.hero-sub{ font-size:13.5px; color:var(--text2); line-height:1.65; margin-top:10px; max-width:780px;
  text-wrap:pretty; position:relative; z-index:1; }
.hero-intro::after{ content:''; position:absolute; bottom:-58%; left:0; width:42%; height:180%;
  border-radius:50%; pointer-events:none;
  background:radial-gradient(circle, rgba(88,166,255,.13), transparent 64%); }
.hero-intro-top{ display:flex; justify-content:space-between; align-items:flex-start; gap:24px;
  position:relative; z-index:1; }
.hero-mark{ font-size:62px; line-height:.9; font-family:'IBM Plex Mono',ui-monospace,monospace; font-weight:700;
  background:linear-gradient(135deg, var(--teal), var(--blue) 60%, var(--purple));
  -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent;
  flex:0 0 auto; opacity:.92; }
.hero-nodes{ display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-top:20px;
  position:relative; z-index:1; }
.hero-nodes-label{ font-size:11px; text-transform:uppercase; letter-spacing:.09em; color:var(--text4);
  font-weight:700; margin-right:4px; }
.hero-node{ display:inline-flex; align-items:center; gap:7px; font-size:12px; font-weight:600;
  color:var(--text2); background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.08);
  border-radius:999px; padding:5px 12px; transition:border-color .15s, background .15s; }
.hero-node:hover{ background:rgba(255,255,255,.07); border-color:rgba(255,255,255,.14); }
.hero-node-dot{ width:8px; height:8px; border-radius:50%; box-shadow:0 0 8px currentColor; }
.hero-flow{ display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-top:22px;
  position:relative; z-index:1; }
.hf-step{ display:flex; align-items:center; gap:10px; font-size:12.5px; color:var(--text2); font-weight:500;
  background:rgba(255,255,255,.035); border:1px solid rgba(255,255,255,.07); border-radius:12px; padding:10px 15px; }
.hf-step b{ display:inline-flex; align-items:center; justify-content:center; width:21px; height:21px;
  border-radius:50%; background:rgba(61,224,208,.15); color:var(--teal); font-size:11px; font-weight:800;
  flex:0 0 auto; }
.hf-arr{ color:var(--text4); font-size:15px; }
body.light .hero-node, body.light .hf-step{ background:rgba(0,0,0,.025); border-color:rgba(0,0,0,.06); }
@media (max-width:680px){ .hero-mark{ display:none; } .hf-arr{ display:none; } .hf-step{ flex:1 1 100%; } }
/* lift the unified export bar above the mobile bottom-nav (\u00a728 bar pins to
   bottom:0, same as the nav) so it stays reachable on narrow viewports */
@media (max-width:1080px){ #exportBar{ bottom:62px !important; } }
/* #2 — unified, inviting empty states across views */
.iv-empty{ display:flex; flex-direction:column; align-items:center; text-align:center; gap:9px; padding:46px 24px; }
.iv-empty .iv-ico{ font-size:28px; line-height:1; opacity:.55; font-family:'IBM Plex Mono',ui-monospace,monospace; color:var(--text3); }
.iv-empty .iv-title{ font-size:14px; font-weight:700; color:var(--text2); letter-spacing:-.01em; }
.iv-empty .iv-sub{ font-size:12.5px; color:var(--text4); max-width:400px; line-height:1.6; text-wrap:pretty; }
/* #5 — provenance / kernel stamp on loaded-node chips */
.chip-prov{ font-size:10px; font-weight:700; letter-spacing:.02em; padding:3px 9px; border-radius:999px; white-space:nowrap; flex:0 0 auto; border:1px solid transparent; cursor:help; }
.chip-prov-ok{ color:var(--green); background:rgba(57,217,138,.10); border-color:rgba(57,217,138,.22); }
.chip-prov-none{ color:var(--text4); background:rgba(255,255,255,.04); border-color:rgba(255,255,255,.09); }
.chip-prov-drift{ color:var(--amber); background:rgba(255,184,77,.10); border-color:rgba(255,184,77,.26); }
body.light .chip-prov-none{ background:rgba(0,0,0,.03); border-color:rgba(0,0,0,.08); }
/* the bar's JSON button is id #exportBtn, which ans-design.css \u00a710 styles as a
   teal\u2192blue gradient CTA \u2014 that breaks the unified eb- look (CSV/PDF are flat
   tinted pills). Re-flatten it to match .eb-json exactly (later same-specificity
   id rule wins; no !important needed). */
#exportBtn{ background:rgba(88,166,255,.10); border:1px solid rgba(88,166,255,.38); color:var(--blue);
  padding:8px 14px; border-radius:var(--r-sm,8px); font-size:11.5px; font-weight:600; box-shadow:none; }
#exportBtn:hover{ filter:brightness(1.18); opacity:1; box-shadow:none; }
body.light #exportBtn{ background:rgba(88,166,255,.12); color:#2563eb; border-color:rgba(88,166,255,.30); }
/* #3 — timeline interactivity (scrub crosshair · zoom · click-a-marker detail) */
.tl-toolbar{ display:flex; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap; }
.tl-zoom-label{ font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--text4); font-weight:700; }
.tl-zoom-btn{ width:24px; height:24px; border-radius:7px; border:1px solid rgba(255,255,255,.10); background:rgba(255,255,255,.04); color:var(--text2); font-size:14px; font-weight:700; cursor:pointer; line-height:1; display:flex; align-items:center; justify-content:center; }
.tl-zoom-btn:hover{ background:rgba(61,224,208,.10); color:var(--teal); border-color:rgba(61,224,208,.25); }
.tl-zoom-val{ font-family:'IBM Plex Mono',ui-monospace,monospace; font-size:12px; color:var(--teal); font-weight:700; min-width:36px; text-align:center; }
.tl-zoom-hint{ font-size:11px; color:var(--text4); }
.tl-cross{ stroke:rgba(255,255,255,.45); stroke-width:1; stroke-dasharray:3 3; pointer-events:none; }
.tl-band-vis{ transition:stroke-width .1s; }
.tl-band-vis.active{ stroke:#fff; stroke-width:3; filter:drop-shadow(0 0 4px rgba(255,107,122,.9)); }
.tl-detail{ margin-top:12px; background:rgba(255,107,122,.05); border:1px solid rgba(255,107,122,.20); border-radius:12px; padding:13px 16px; }
.tld-head{ display:flex; align-items:center; gap:9px; font-size:13px; color:var(--text); flex-wrap:wrap; }
.tld-head b{ font-weight:700; text-transform:capitalize; }
.tld-meta{ font-family:'IBM Plex Mono',ui-monospace,monospace; font-size:11.5px; color:var(--text3); }
.tld-x{ margin-left:auto; background:none; border:none; color:var(--text4); cursor:pointer; font-size:13px; padding:2px 6px; border-radius:6px; }
.tld-x:hover{ color:var(--red); background:rgba(255,107,122,.1); }
.tld-tags{ display:flex; gap:5px; flex-wrap:wrap; margin-top:9px; }
.tld-note{ font-size:12px; color:var(--text2); line-height:1.6; margin-top:9px; text-wrap:pretty; }
/* #4 — finding-card evidence badge alignment + full-width legend */
.fc-head h4{ display:flex; align-items:center; gap:7px; }
/* evidence disc sits in the finding card's bottom-right corner (cohesion v1.1
   placement). The card is position:relative (.chart-card); reserve bottom space
   so the note never runs under it. */
.fc-ev{ position:absolute; right:16px; bottom:13px; display:inline-flex; align-items:center; }
.finding-card{ padding-bottom:32px; }
.fc-legend{ grid-column:1/-1; margin-bottom:2px; }
/* evidence disc on each KPI — inline-leading with the label */
.kpi .kpi-label{ display:flex; align-items:center; gap:6px; }
.kpi-ev{ display:inline-flex; align-items:center; }
/* inline-leading badge in the dense findings table (mandate placement #2) */
.data-table td .ev{ margin-right:6px; vertical-align:middle; }
/* audit fixes — remaining measurement surfaces get a badge (coverage mandate) */
.hero-ev{ position:absolute; right:18px; bottom:16px; }
.pair-ov .ev{ margin-right:5px; vertical-align:middle; }
.cor-card{ position:relative; }
.cor-ev{ position:absolute; right:14px; bottom:12px; }
`;
    var el = document.createElement('style'); el.id='integrator-hero-css'; el.textContent=css;
    (document.head||document.documentElement).appendChild(el);
  })();

  /* shared inviting empty-state block (#2) */
  function emptyState(ico,title,sub){
    return '<div class="iv-empty"><div class="iv-ico">'+ico+'</div>'+
      '<div class="iv-title">'+esc(title)+'</div>'+
      (sub?'<div class="iv-sub">'+esc(sub)+'</div>':'')+'</div>';
  }
  /* per-node provenance / physiology-kernel stamp (#5) — reads the kernelHash the
     dsp carries on each rec and compares to THIS build's DexKernel.HASH. */
  function provStamp(r){
    var expected = (window.DexKernel && window.DexKernel.HASH) || null;
    var h = r.kernelHash || null, cls, lbl, tip;
    if(h==null){ cls='none'; lbl='no kernel stamp';
      tip='Legacy export — built before the physiology-kernel stamp. It loads, but its threshold rulebook can\'t be verified against this Integrator build.'; }
    else if(expected!=null && h===expected){ cls='ok'; lbl='kernel ✓';
      tip='Built against the same physiology kernel ('+(r.kernelVersion||String(h).slice(0,8))+') as this Integrator — thresholds match.'; }
    else { cls='drift'; lbl='kernel ⚠';
      tip='Built against a DIFFERENT physiology kernel ('+(r.kernelVersion||String(h).slice(0,8))+(expected?' vs '+String(expected).slice(0,8):'')+') — thresholds may differ; fusion flags this so drift can\'t masquerade as agreement.'; }
    return '<span class="chip-prov chip-prov-'+cls+'" title="'+esc(tip)+'">'+lbl+'</span>';
  }

  /* #4 — evidence tier for each FUSION output. Author-tunable: these are the
     fusion layer's own epistemic grades on the shared 5-level ladder
     (measured·validated·emerging·experimental·heuristic), sourced from the
     literature each rule cites — NOT a global table; adjust here if the science
     moves. Rendered via the shared MetricRegistry.badge so the disc is
     byte-identical to every node. */
  var FINDING_EVIDENCE = {
    confirmed_apnea:  { evidence:'emerging',     cite:'Cross-signal corroboration — O\u2082 desaturation ⟷ autonomic surge in a directional window (AASM ODI framing; Azarbarzin 2019). A corroboration signal, not a scored AHI.' },
    device_ahi:       { evidence:'validated',    cite:'Firmware-scored AHI on the PAP / oximeter device itself (AASM-style). Used here as the clinical reference; not re-derived.' },
    positional_apnea: { evidence:'experimental', cite:'Supine vs non-supine event rate from ECGDex ACC posture. Directional, small-n.' },
    auto_glycemic:    { evidence:'heuristic',    cite:'Directional night-to-night association between glucose variability and autonomic load. Hypothesis-generating, not causal.' },
    hrv_consensus:    { evidence:'emerging',     cite:'Cross-device consensus of time-domain HRV (rMSSD / SDNN; Task Force 1996). Divergence flags a QC conflict, not a disease state.' },
    desat_match:      { evidence:'measured',     cite:'Raw coverage statistic — matched desaturations ÷ total desaturations inside the overlap window.' },
    periodic_breathing:{ evidence:'experimental', cite:'Cross-signal corroboration of periodic breathing / Cheyne–Stokes — SpO₂ oscillation (OxyDex), device flow (CPAPDex), and/or cardiac CVHR (ECGDex). Tier-weighted, down-weighted; a corroboration signal, not a scored CSR index.' }
  };
  var TYPE_EV = { confirmed_apnea_event:'confirmed_apnea', glucose_autonomic_correlation:'auto_glycemic', periodic_breathing:'periodic_breathing' };
  function evBadge(key){
    var R = window.MetricRegistry;
    if(!R || !R.badge || !key) return '';
    var e = FINDING_EVIDENCE[key]; if(!e) return '';
    return R.badge(e.evidence, e.cite);
  }
  // direct shared-engine badge for surfaces whose tier isn't a FINDING_EVIDENCE key
  // (hero overlap + per-pair overlap = counted → measured; see coverage mandate).
  function mrBadge(evidence, cite){ var R=window.MetricRegistry; return (R&&R.badge)?R.badge(evidence,cite):''; }

  /* ── nav ─────────────────────────────────────────────────────────────── */
  function bindNav(){
    // The skeleton ships 3 legacy .mobile-nav blocks (only the last is complete —
    // it includes Longitudinal); collapse to one so mobile shows a single correct
    // rail instead of three stacked, half-overlapping ones.
    var mnavs = document.querySelectorAll('.mobile-nav');
    for(var i=0;i<mnavs.length-1;i++){ if(mnavs[i].parentNode) mnavs[i].parentNode.removeChild(mnavs[i]); }
    document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(function(a){
      a.addEventListener('click', function(e){ e.preventDefault(); showView(a.dataset.view); });
    });
  }
  function showView(v){
    document.querySelectorAll('.nav-item').forEach(function(a){ a.classList.toggle('active', a.dataset.view===v); });
    document.querySelectorAll('.mobile-nav-item').forEach(function(a){ a.classList.toggle('active', a.dataset.view===v); });
    document.querySelectorAll('.view').forEach(function(s){ s.style.display = (s.dataset.view===v?'block':'none'); });
  }

  /* ── loaded-node chips ───────────────────────────────────────────────── */
  function renderChips(recs, onRemove, onClear){
    var box = $('chips'); if(!box) return;
    if(!recs.length){ box.innerHTML = '<div class="chips-empty">No nodes loaded yet.</div>'; return; }
    box.innerHTML = recs.map(function(r,i){
      var w = D.recWindow(r);
      var win = w ? (D.fmtClock(w.startMs)+'–'+D.fmtClock(w.endMs)) : 'date unknown';
      var dot = '<span class="chip-dot" style="background:'+D.nodeColor(r.node)+'"></span>';
      return '<div class="node-chip" data-i="'+i+'">'+dot+
        '<div class="chip-main"><div class="chip-node">'+esc(r.node)+(r.dateUnknown?' <span class="chip-warn">· date unknown</span>':'')+'</div>'+
        '<div class="chip-meta">'+esc(r.dateStr||'—')+' · '+win+' · '+r.nEvents+' events</div></div>'+
        provStamp(r)+
        '<button class="chip-x" data-rm="'+i+'" title="Remove">✕</button></div>';
    }).join('') + '<button class="btn btn-destructive chip-clear">Clear all</button>';
    box.querySelectorAll('[data-rm]').forEach(function(b){ b.addEventListener('click', function(){ onRemove(+b.dataset.rm); }); });
    var clr = box.querySelector('.chip-clear'); if(clr) clr.addEventListener('click', onClear);
  }

  /* ── warnings ────────────────────────────────────────────────────────── */
  function renderWarnings(warns){
    var box = $('warnBox'); if(!box) return;
    if(!warns.length){ box.style.display='none'; box.innerHTML=''; return; }
    box.style.display='block';
    box.innerHTML = warns.map(function(w){ return '<div class="warn-row">⚠ '+esc(w)+'</div>'; }).join('');
  }

  /* ── hero / honesty header ───────────────────────────────────────────── */
  function renderHero(fusion){
    var box = $('hero'); if(!box) return;
    if(!fusion || !fusion.nodes.length){
      var introNodes = ['ECGDex','OxyDex','GlucoDex','PulseDex','HRVDex'];
      var chips = introNodes.map(function(n){
        var c = D.nodeColor(n);
        return '<span class="hero-node"><span class="hero-node-dot" style="background:'+c+';color:'+c+'"></span>'+n+'</span>';
      }).join('');
      box.innerHTML =
        '<div class="hero-card hero-intro">'+
          '<div class="hero-intro-top">'+
            '<div>'+
              '<div class="hero-eyebrow">Fusion Layer · 100% local</div>'+
              '<div class="hero-h1">One clock for every signal</div>'+
              '<div class="hero-sub">Integrator co-registers your <span class="mono">-Dex</span> exports on the shared floating wall-clock, then surfaces only the findings two or more signals agree on — each one tracing back to its own source events. Nothing leaves this device.</div>'+
            '</div>'+
            '<div class="hero-mark" aria-hidden="true">∮</div>'+
          '</div>'+
          '<div class="hero-nodes"><span class="hero-nodes-label">Reads</span>'+chips+'</div>'+
          '<div class="hero-flow">'+
            '<div class="hf-step"><b>1</b> Drop 2 or more JSON exports</div>'+
            '<div class="hf-arr">→</div>'+
            '<div class="hf-step"><b>2</b> They align on one timeline</div>'+
            '<div class="hf-arr">→</div>'+
            '<div class="hf-step"><b>3</b> Agreeing findings surface</div>'+
          '</div>'+
        '</div>';
      return;
    }
    var dated = fusion.nodes.filter(function(n){ return !n.dateUnknown; });
    if(fusion.anyOverlap){
      var w = fusion.window, ov = w.overlapMin;
      var geom = (w.intersectionMin>0 && fusion.nodes.filter(function(n){return !n.dateUnknown;}).length>2)
        ? ' · '+w.intersectionMin.toFixed(0)+' min all-node' : '';
      var excl = (w.nodesExcluded && w.nodesExcluded.length)
        ? '<div class="hero-sub" style="opacity:.7">Excluded (no temporal overlap): '+esc(w.nodesExcluded.join(', '))+' — reported separately, not fused.</div>'
        : '';
      box.innerHTML =
        '<div class="hero-card hero-ok">'+
        '<div class="hero-eyebrow">Shared timeline established</div>'+
        '<div class="hero-h1">'+(ov.toFixed(0))+' min of overlap across '+dated.length+' recordings'+geom+'</div>'+
        '<div class="hero-sub">Cross-validation enabled. Fusion rules run only inside overlap windows; every finding lists its source events.</div>'+
        excl+
        '<span class="hero-ev">'+mrBadge('measured','Direct overlap of the recordings\' time windows on the shared clock — a counted quantity, not a model.')+'</span>'+
        '</div>';
    } else {
      // build the explicit "no overlap" message from the two widest-apart nodes
      var lines = dated.map(function(n){ return esc(n.node)+' ('+(n.window?D.fmtDayShort(n.window.startMs)+', '+D.fmtClock(n.window.startMs)+'–'+D.fmtClock(n.window.endMs):'?')+')'; });
      box.innerHTML =
        '<div class="hero-card hero-amber">'+
        '<div class="hero-eyebrow">⚠ No overlapping recordings</div>'+
        '<div class="hero-h1">Cross-validation unavailable</div>'+
        '<div class="hero-sub">'+lines.join(' and ')+' do not overlap on the shared clock. Showing each node\'s own events on a common axis — load overlapping nights to enable fusion. No correlations are asserted.</div>'+
        '</div>';
    }
  }

  /* ── KPI strip ───────────────────────────────────────────────────────── */
  function renderKPIs(fusion){
    var strip = $('kpiStrip'); if(!strip) return;
    if(!fusion || !fusion.anyOverlap){ strip.classList.remove('show'); strip.innerHTML=''; return; }
    var a = fusion.apnea, k=[];
    if(a){
      var below = a.nullModel && a.nullModel.belowChance;
      var ahiShown = (a.confirmedAHIReportable && a.confirmedAHI!=null) ? a.confirmedAHI : '—';
      var ahiSub = below
        ? 'below chance · expected '+ (a.nullModel?a.nullModel.expectedConfirmed:'?') +'/night'
        : 'events/h · desat⟷surge';
      k.push(kpi('Confirmed apnea index', ahiShown, ahiSub, below?'neutral':(a.confirmedAHI>5?'warn':'good'), 'confirmed_apnea'));
      if(a.apneaAuthority){
        var aa=a.apneaAuthority;
        var aaSub = (aa.confirmedIndex!=null)
          ? ('reference · confirmed '+aa.confirmedIndex+'/h, +'+aa.residualGap+' central/non-desat')
          : (aa.node+' firmware-scored');
        k.push(kpi('Device-scored AHI', aa.ahi, aaSub, aa.ahi>15?'warn':(aa.ahi>5?'warn':'good'), 'device_ahi'));
      }
      var cSub = below ? ('p(spurious)='+(a.findings[0]?a.findings[0].pSpurious:'?')+' · '+a.overlapHours+' h')
                       : (a.overlapHours+' h overlap');
      k.push(kpi('Confirmed events', a.findings.length + (below?' (unconfirmed)':''), cSub, below?'neutral':'good', 'confirmed_apnea'));
      k.push(kpi('Desat match rate', a.total.desat? Math.round(100*a.matched.desat/a.total.desat)+'%':'—', a.matched.desat+'/'+a.total.desat+' desats paired', 'neutral', 'desat_match'));
    }
    if(fusion.positional && fusion.positional.available){
      var p=fusion.positional;
      k.push(kpi('Supine event rate', p.supineRate!=null?Math.round(p.supineRate*100)+'%':'—', p.supine+' supine · '+p.nonsupine+' non-supine', p.positional?'warn':'good', 'positional_apnea'));
    }
    if(fusion.autoGly && fusion.autoGly.glucoseAutonomicCorrelation!=null){
      k.push(kpi('Autonomic⟷glycemic', fusion.autoGly.glucoseAutonomicCorrelation, fusion.autoGly.r!=null?('r · '+fusion.autoGly.n+' nights'):'directional', 'neutral', 'auto_glycemic'));
    }
    if(fusion.periodicBreathing && fusion.periodicBreathing.blocks && fusion.periodicBreathing.blocks.length){
      var pb0=fusion.periodicBreathing.blocks[0];
      k.push(kpi('Periodic breathing', pb0.nObservers, 'signals corroborate · '+pb0.observerNodes.join(' + '), 'warn', 'periodic_breathing'));
    }
    strip.innerHTML = k.join('');
    if(k.length) strip.classList.add('show');
  }
  function kpi(label,val,sub,cls,evKey){
    var badge = evKey ? evBadge(evKey) : '';
    return '<div class="kpi '+(cls||'')+'"><div class="kpi-label">'+(badge?'<span class="kpi-ev">'+badge+'</span>':'')+esc(label)+'</div>'+
      '<div class="kpi-val">'+esc(val)+'</div><div class="kpi-sub">'+esc(sub)+'</div></div>';
  }

  /* ════════════════════════════════════════════════════════════════════
     THE TIMELINE — one swimlane per node, ticks colored by node + sized by
     conf; fused findings drawn as vertical bands spanning connected lanes.
     ════════════════════════════════════════════════════════════════════ */
  var MAX_LANES = 14;
  var _tlZoom = 1;
  function renderTimeline(recs, fusion){
    var box = $('timeline'); if(!box) return;
    var allDated = recs.filter(function(r){ return !r.dateUnknown; });
    var undated = recs.filter(function(r){ return r.dateUnknown; });
    if(!allDated.length){ box.innerHTML = emptyState('▦','No timeline yet','Load 2 or more dated -Dex exports and they line up here on one shared wall-clock — one swimlane per node.'); return; }

    // Cap lanes for legibility + sandbox safety: prefer nodes that participate
    // in an overlap, then fill by event count.
    var overlapUids = {};
    (fusion.pairs||[]).forEach(function(p){ if(p.overlap){ overlapUids[p.an+'|'+p.aWin.startMs]=1; } });
    var dated = allDated;
    var capped = 0;
    if(allDated.length > MAX_LANES){
      var inOverlap = allDated.filter(function(r){ var w=D.recWindow(r); return w && (fusion.pairs||[]).some(function(p){ return p.overlap && (p.aWin&&p.aWin.startMs===w.startMs || p.bWin&&p.bWin.startMs===w.startMs); }); });
      var rest = allDated.filter(function(r){ return inOverlap.indexOf(r)<0; })
                         .sort(function(a,b){ return b.nEvents-a.nEvents; });
      dated = inOverlap.concat(rest).slice(0, MAX_LANES);
      capped = allDated.length - dated.length;
      dated.sort(function(a,b){ var wa=D.recWindow(a),wb=D.recWindow(b); return (wa?wa.startMs:0)-(wb?wb.startMs:0); });
    }

    // global extent
    var t0=null,t1=null;
    dated.forEach(function(r){ var w=D.recWindow(r); if(!w) return; if(t0==null||w.startMs<t0)t0=w.startMs; if(t1==null||w.endMs>t1)t1=w.endMs; });
    dated.forEach(function(r){ r.events.forEach(function(e){ if(e.tMs<t0)t0=e.tMs; if(e.tMs>t1)t1=e.tMs; }); });
    if(t0==null) t0=Date.now();
    if(t1<=t0) t1=t0+3600000;
    var span = t1-t0;

    var W=1000, padL=128, padR=24, padT=20, laneH=58, laneGap=12;
    var n=dated.length;
    var innerW = W-padL-padR;
    var axisH=34;
    var H = padT + n*(laneH+laneGap) + axisH;
    var X = function(ms){ return padL + innerW*(ms-t0)/span; };

    var svg = '<svg viewBox="0 0 '+W+' '+H+'" class="tl-svg" preserveAspectRatio="xMidYMid meet">';

    // hour gridlines (guarded iteration count)
    var gridStep = chooseGridStep(span);
    while(span/gridStep > 60) gridStep *= 2;   // never draw >~60 gridlines
    var g0 = Math.ceil(t0/gridStep)*gridStep, _gi=0;
    for(var g=g0; g<=t1 && _gi<200; g+=gridStep, _gi++){
      var gx=X(g);
      svg += '<line x1="'+gx.toFixed(1)+'" y1="'+padT+'" x2="'+gx.toFixed(1)+'" y2="'+(H-axisH)+'" stroke="rgba(255,255,255,.05)" stroke-width="1"/>';
      svg += '<text x="'+gx.toFixed(1)+'" y="'+(H-axisH+18)+'" class="tl-axis-lbl" text-anchor="middle">'+D.fmtClock(g)+'</text>';
    }

    // overlap shading (union of pairwise overlaps)
    (fusion.pairs||[]).forEach(function(p){
      if(!p.overlap) return;
      var ox=X(p.overlap.startMs), ow=X(p.overlap.endMs)-ox;
      svg += '<rect x="'+ox.toFixed(1)+'" y="'+padT+'" width="'+Math.max(ow,1).toFixed(1)+'" height="'+(H-axisH-padT)+'" fill="rgba(61,224,208,.045)"/>';
    });

    // fused finding bands (vertical, spanning all lanes)
    var laneY = {};
    dated.forEach(function(r,i){ laneY[r.uid]=padT+i*(laneH+laneGap); });
    (fusion.findings||[]).forEach(function(f){
      if(f.type!=='confirmed_apnea_event' || f.tMs==null) return;
      var fx=X(f.tMs);
      svg += '<line x1="'+fx.toFixed(1)+'" y1="'+padT+'" x2="'+fx.toFixed(1)+'" y2="'+(H-axisH)+'" stroke="rgba(255,107,122,.55)" stroke-width="2" class="tl-band tl-band-vis" data-find="'+f.tMs+'"/>';
      svg += '<line x1="'+fx.toFixed(1)+'" y1="'+padT+'" x2="'+fx.toFixed(1)+'" y2="'+(H-axisH)+'" stroke="transparent" stroke-width="14" class="tl-band tl-band-hit" data-find="'+f.tMs+'" style="cursor:pointer"/>';
      svg += '<circle cx="'+fx.toFixed(1)+'" cy="'+(padT-4)+'" r="3.5" fill="#FF6B7A"/>';
    });

    // lanes
    dated.forEach(function(r,i){
      var y=padT+i*(laneH+laneGap);
      var cy=y+laneH/2;
      var col=D.nodeColor(r.node);
      svg += '<rect x="'+padL+'" y="'+y+'" width="'+innerW+'" height="'+laneH+'" rx="7" fill="rgba(255,255,255,.018)" stroke="rgba(255,255,255,.05)"/>';
      // lane label
      svg += '<text x="'+(padL-12)+'" y="'+(cy-3)+'" class="tl-lane-node" text-anchor="end" fill="'+col+'">'+esc(r.node)+'</text>';
      svg += '<text x="'+(padL-12)+'" y="'+(cy+12)+'" class="tl-lane-date" text-anchor="end">'+esc(r.dateStr||'')+'</text>';
      // window bar
      var w=D.recWindow(r);
      if(w){ svg += '<line x1="'+X(w.startMs).toFixed(1)+'" y1="'+cy+'" x2="'+X(w.endMs).toFixed(1)+'" y2="'+cy+'" stroke="'+col+'" stroke-opacity=".18" stroke-width="2"/>'; }
      // event ticks
      r.events.forEach(function(e){
        var ex=X(e.tMs);
        var conf=(e.conf!=null?e.conf:0.5);
        var h=6+conf*18;
        var op=(0.35+conf*0.55).toFixed(2);
        svg += '<rect x="'+(ex-1.1).toFixed(1)+'" y="'+(cy-h/2).toFixed(1)+'" width="2.2" height="'+h.toFixed(1)+'" rx="1" fill="'+col+'" fill-opacity="'+op+'" class="tl-tick" '+
          'data-tip="'+esc(D.fmtClock(e.tMs)+' · '+e.impulse+' · conf '+(e.conf!=null?e.conf.toFixed(2):'—')+' · '+r.node)+'"/>';
      });
    });

    svg += '<line id="tlCross" class="tl-cross" x1="0" x2="0" y1="'+padT+'" y2="'+(H-axisH)+'" style="display:none"/>';
    svg += '</svg>';
    var legend = dated.map(function(r){ return '<span class="tl-leg"><span class="tl-leg-dot" style="background:'+D.nodeColor(r.node)+'"></span>'+esc(r.node)+'</span>'; }).join('')
      + (fusion.findings && fusion.findings.some(function(f){return f.type==='confirmed_apnea_event';}) ? '<span class="tl-leg"><span class="tl-leg-bar"></span>confirmed apnea</span>' : '')
      + '<span class="tl-leg"><span class="tl-leg-ov"></span>overlap window</span>';
    var notes = '';
    if(capped>0) notes += '<div class="tl-undated">'+capped+' more recording(s) hidden for legibility — showing overlap-relevant + busiest lanes ('+MAX_LANES+' max).</div>';
    if(undated.length) notes += '<div class="tl-undated">'+undated.length+' node(s) excluded from the axis — date unknown, not fabricated.</div>';
    var hasBands = fusion.findings && fusion.findings.some(function(f){return f.type==='confirmed_apnea_event';});
    var toolbar = '<div class="tl-toolbar">'+
      '<span class="tl-zoom-label">Zoom</span>'+
      '<button class="tl-zoom-btn" type="button" data-z="out" aria-label="Zoom out">\u2212</button>'+
      '<span class="tl-zoom-val">'+_tlZoom.toFixed(1)+'\u00d7</span>'+
      '<button class="tl-zoom-btn" type="button" data-z="in" aria-label="Zoom in">+</button>'+
      '<span class="tl-zoom-hint">'+(hasBands?'hover to scrub the clock · click a red apnea marker for detail · scroll when zoomed':'hover to scrub the clock · scroll horizontally when zoomed')+'</span>'+
      '</div>';
    box.innerHTML = toolbar+'<div class="tl-legend">'+legend+'</div><div class="tl-scroll">'+svg+'</div>'+
      '<div id="tlDetail" class="tl-detail" style="display:none"></div>'+notes;
    var meta = { t0:t0, span:span, padL:padL, padR:padR, innerW:innerW, W:W, fusion:fusion };
    var svgEl = box.querySelector('svg'); if(svgEl) svgEl.style.width = (_tlZoom*100)+'%';
    bindTimeline(box, meta);
  }

  function chooseGridStep(span){
    var H=3600000;
    if(span <= 2*H) return 0.5*H;
    if(span <= 8*H) return H;
    if(span <= 24*H) return 2*H;
    return 6*H;
  }

  function ensureTip(){ return $('tlTip') || (function(){ var t=document.createElement('div'); t.id='tlTip'; t.className='tl-tip'; document.body.appendChild(t); return t; })(); }
  function bindTimeline(box, meta){
    var svg = box.querySelector('svg'); if(!svg) return;
    var tip = ensureTip();
    var cross = svg.querySelector('#tlCross');
    // unified scrub: crosshair + live wall-clock readout; tick detail when over a tick
    svg.addEventListener('mousemove', function(ev){
      var r = svg.getBoundingClientRect();
      var scale = r.width/meta.W;
      var vbX = (ev.clientX - r.left)/scale;
      vbX = Math.max(meta.padL, Math.min(meta.W-meta.padR, vbX));
      if(cross){ cross.setAttribute('x1', vbX.toFixed(1)); cross.setAttribute('x2', vbX.toFixed(1)); cross.style.display='block'; }
      var frac = (vbX-meta.padL)/meta.innerW;
      var ms = meta.t0 + frac*meta.span;
      var tickTip = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-tip');
      tip.innerHTML = tickTip ? esc(tickTip) : ('<b>'+esc(D.fmtClock(ms))+'</b> · '+esc(D.fmtDate(ms)));
      tip.style.display='block'; tip.style.left=(ev.clientX+14)+'px'; tip.style.top=(ev.clientY+14)+'px';
    });
    svg.addEventListener('mouseleave', function(){ tip.style.display='none'; if(cross) cross.style.display='none'; });
    // click a fused-finding band → detail panel
    svg.addEventListener('click', function(ev){
      var el = ev.target;
      if(!(el && el.classList && el.classList.contains('tl-band'))) return;
      showFindingDetail(box, meta.fusion, +el.getAttribute('data-find'));
    });
    // horizontal zoom (widens the SVG; .tl-scroll scrolls). Zoom persists across re-renders.
    box.querySelectorAll('.tl-zoom-btn').forEach(function(b){
      b.addEventListener('click', function(){
        _tlZoom = b.dataset.z==='in' ? Math.min(8, _tlZoom*1.5) : Math.max(1, _tlZoom/1.5);
        svg.style.width = (_tlZoom*100)+'%';
        var v=box.querySelector('.tl-zoom-val'); if(v) v.textContent=_tlZoom.toFixed(1)+'\u00d7';
      });
    });
  }
  function showFindingDetail(box, fusion, tMs){
    var det = box.querySelector('#tlDetail'); if(!det) return;
    box.querySelectorAll('.tl-band-vis.active').forEach(function(b){ b.classList.remove('active'); });
    var vis = box.querySelector('.tl-band-vis[data-find="'+tMs+'"]'); if(vis) vis.classList.add('active');
    var f = (fusion.findings||[]).filter(function(x){ return x.tMs===tMs; })[0];
    if(!f){ det.style.display='none'; det.innerHTML=''; return; }
    var badge = evBadge(TYPE_EV[f.type]||'');
    var tags = (f.nodes||[]).map(function(n){ var base=n.split(' ')[0]; return '<span class="fc-tag" style="--c:'+D.nodeColor(base)+'">'+esc(n)+'</span>'; }).join('');
    det.innerHTML =
      '<div class="tld-head">'+badge+'<b>'+esc(f.type.replace(/_/g,' '))+'</b>'+
        '<span class="tld-meta">'+esc(D.fmtDateTime(f.tMs))+' · conf '+(f.conf!=null?f.conf.toFixed(2):'\u2014')+'</span>'+
        '<button class="tld-x" type="button" aria-label="Close">\u2715</button></div>'+
      '<div class="tld-tags">'+tags+'</div>'+
      (f.note?'<div class="tld-note">'+esc(f.note)+'</div>':'');
    det.style.display='block';
    var x=det.querySelector('.tld-x'); if(x) x.addEventListener('click', function(){ det.style.display='none'; if(vis) vis.classList.remove('active'); });
  }

  /* ── findings cards ──────────────────────────────────────────────────── */
  function renderFindings(fusion){
    var box=$('findings'); if(!box) return;
    if(!fusion || !fusion.anyOverlap){
      box.innerHTML=emptyState('◈','No fused findings yet','Fusion needs overlapping recordings. Once two or more nodes share a time window, cross-signal findings appear here — each node\'s own events still show on the timeline.');
      return;
    }
    var cards=[];
    var a=fusion.apnea;
    if(a){
      cards.push(findingCard('Confirmed apnea events', '#FF6B7A',
        '<div class="fc-big">'+a.findings.length+'<span class="fc-unit"> events · index '+(a.confirmedAHI!=null?a.confirmedAHI:'—')+'/h</span></div>',
        'Each is an OxyDex O₂ desaturation matched to an ECGDex/PpgDex autonomic surge inside a directional window (surge −'+fusion.matchWindow.leadMaxSec+'s…+'+fusion.matchWindow.trailMaxSec+'s vs the nadir). '+
        'Matched '+a.matched.desat+'/'+a.total.desat+' desaturations and '+a.matched.surge+'/'+a.total.surge+' surges. '+
        'Unmatched desats ('+a.unmatched.desat.length+') may be central / low-arousal; unmatched surges ('+a.unmatched.surge.length+') may be non-respiratory arousals.',
        ['OxyDex','ECGDex'], 'confirmed_apnea'));
      if(a.apneaAuthority){
        var aa=a.apneaAuthority;
        var comp=aa.components||{};
        var compBits=[];
        if(comp.central!=null) compBits.push('central '+comp.central);
        if(comp.obstructive!=null) compBits.push('obstructive '+comp.obstructive);
        if(comp.hypopnea!=null) compBits.push('hypopnea '+comp.hypopnea);
        var recon = (aa.confirmedIndex!=null)
          ? ('The confirmed index ('+aa.confirmedIndex+'/h, desaturating obstructive events) sits below the device AHI by '+aa.residualGap+'/h — '+
             (aa.agreement==='consistent'
               ? 'expected, since firmware AHI also counts central and non-desaturating events that carry no desat→surge signature.'
               : 'the confirmed index EXCEEDS device scoring — review for a scoring conflict or clock offset.'))
          : 'No desat⟷surge confirmation overlapped this night; the device figure stands alone as the apnea reference.';
        cards.push(findingCard('Device-scored AHI (reference)', '#14B8A6',
          '<div class="fc-big">'+aa.ahi+'<span class="fc-unit">/h · '+aa.node+(aa.therapyHours!=null?(' · '+aa.therapyHours+' h'):'')+'</span></div>',
          'Firmware-scored on the PAP device itself — the strongest single apnea truth on the bus, used here as the clinical reference.'+
          (compBits.length?' Components: '+compBits.join(' · ')+'/h.':'')+' '+recon,
          [aa.node], 'device_ahi'));
      }
    }
    var p=fusion.positional;
    if(p){
      cards.push(findingCard('Positional apnea', p.positional?'#FFB84D':'#3DE0D0',
        p.available ? '<div class="fc-big">'+(p.supineRate!=null?Math.round(p.supineRate*100)+'%'+'<span class="fc-unit"> supine</span>':'—')+'</div>'
                    : '<div class="fc-big fc-na">N/A</div>',
        p.note, ['ECGDex (ACC)'], 'positional_apnea'));
    }
    var ag=fusion.autoGly;
    if(ag){
      var wp=(ag.pairs||[]).filter(function(p){ return p.windowed; });
      var wnote='';
      if(wp.length){
        var covs=wp.map(function(p){ return p.coverage; }).filter(function(v){ return v!=null; });
        var medCov=covs.length?median(covs):null;
        wnote=' Glucose variability is computed on each night\'s EXACT overlap window'
            +(medCov!=null?(' (median coverage '+Math.round(medCov*100)+'%)'):'')
            +', not the whole 30-day wear — windowing lives here at the fusion layer.';
      }
      cards.push(findingCard('Autonomic ⟷ glycemic', '#FFB84D',
        '<div class="fc-big">'+(ag.glucoseAutonomicCorrelation!=null?ag.glucoseAutonomicCorrelation:'—')+'<span class="fc-unit"> '+(ag.r!=null?'r':'directional')+'</span></div>',
        ag.note+wnote+' Closes the reserved handshake both nodes stub (GlucoDex.glucose_autonomic_correlation ↔ ECGDex.glucoseCorrelation).',
        ['ECGDex','GlucoDex'], 'auto_glycemic'));
    }
    var hv=fusion.hrv;
    if(hv){
      hv.blocks.forEach(function(b){
        cards.push(findingCard('HRV consensus · '+b.window, b.qc==='divergent'?'#FF6B7A':'#39D98A',
          '<div class="fc-big">'+(b.divergencePct)+'%<span class="fc-unit"> max divergence</span></div>',
          b.note + ' Sources: '+b.nodes.join(', ')+'.', b.nodes, 'hrv_consensus'));
      });
    }
    var pb=fusion.periodicBreathing;
    if(pb && pb.blocks){
      pb.blocks.forEach(function(b){
        cards.push(findingCard('Periodic breathing · '+b.window, '#FFB84D',
          '<div class="fc-big">'+b.nObservers+'<span class="fc-unit"> signals agree</span></div>',
          b.note, b.observerNodes, 'periodic_breathing'));
      });
    }
    if(!cards.length){ box.innerHTML=emptyState('◈','No findings on these recordings','The fusion rules ran across the overlap but nothing crossed threshold — a clean night, or signals that don\'t corroborate.'); return; }
    var lg = (window.MetricRegistry && MetricRegistry.legend) ? '<div class="fc-legend">'+MetricRegistry.legend({})+'</div>' : '';
    box.innerHTML = lg + cards.join('');
  }
  function findingCard(title,color,big,note,nodes,evKey){
    var tags=(nodes||[]).map(function(n){ var base=n.split(' ')[0]; return '<span class="fc-tag" style="--c:'+D.nodeColor(base)+'">'+esc(n)+'</span>'; }).join('');
    var badge = evKey ? evBadge(evKey) : '';
    return '<div class="finding-card chart-card" style="--card-accent:'+color+'">'+
      '<div class="fc-head"><h4>'+esc(title)+(badge?'<span class="fc-ev">'+badge+'</span>':'')+'</h4><div class="fc-tags">'+tags+'</div></div>'+
      big+'<p class="fc-note">'+esc(note)+'</p></div>';
  }

  /* ── full findings table ─────────────────────────────────────────────── */
  function renderTable(fusion){
    var box=$('findTable'); if(!box) return;
    var rows=(fusion&&fusion.findings)?fusion.findings:[];
    if(!rows.length){ box.innerHTML=emptyState('≣','Nothing to tabulate yet','Confirmed findings are listed here with their wall-clock time, type, confidence and source events.'); return; }
    var body=rows.map(function(f){
      return '<tr><td class="mono">'+(f.tMs!=null?D.fmtDateTime(f.tMs):'—')+'</td>'+
        '<td>'+evBadge(TYPE_EV[f.type]||'')+'<span class="tbl-type" style="--c:'+(f.type==='confirmed_apnea_event'?'#FF6B7A':'#FFB84D')+'">'+esc(f.type)+'</span></td>'+
        '<td class="mono">'+(f.conf!=null?f.conf.toFixed(2):'—')+'</td>'+
        '<td>'+(f.nodes||[]).map(esc).join(' + ')+'</td>'+
        '<td class="tbl-note">'+esc(f.note||'')+'</td></tr>';
    }).join('');
    box.innerHTML='<table class="data-table"><thead><tr><th>Wall clock</th><th>Type</th><th>Conf</th><th>Nodes</th><th>Evidence</th></tr></thead><tbody>'+body+'</tbody></table>';
  }

  /* ── per-pair overlap report ─────────────────────────────────────────── */
  function renderPairs(fusion){
    var box=$('pairs'); if(!box) return;
    var ps=(fusion&&fusion.pairs)?fusion.pairs:[];
    if(!ps.length){ box.innerHTML=emptyState('⇄','Nothing to compare yet','Load 2 or more dated nodes to see how their recording windows overlap, pair by pair.'); return; }
    box.innerHTML = ps.map(function(p){
      var ov=p.overlap;
      var aw=p.aWin?D.fmtDayShort(p.aWin.startMs)+' '+D.fmtClock(p.aWin.startMs)+'–'+D.fmtClock(p.aWin.endMs):'?';
      var bw=p.bWin?D.fmtDayShort(p.bWin.startMs)+' '+D.fmtClock(p.bWin.startMs)+'–'+D.fmtClock(p.bWin.endMs):'?';
      return '<div class="pair-card chart-card" style="--card-accent:'+(ov?'#3DE0D0':'#FFB84D')+'">'+
        '<div class="pair-head"><span class="pair-dot" style="background:'+D.nodeColor(p.an)+'"></span>'+esc(p.a)+
        '<span class="pair-vs">vs</span><span class="pair-dot" style="background:'+D.nodeColor(p.bn)+'"></span>'+esc(p.b)+'</div>'+
        '<div class="pair-rows"><div><span>'+esc(p.an)+'</span><b class="mono">'+aw+'</b></div>'+
        '<div><span>'+esc(p.bn)+'</span><b class="mono">'+bw+'</b></div>'+
        '<div class="pair-ov '+(ov?'ok':'no')+'"><span>'+mrBadge('measured','Overlap of the two recordings\' windows on the shared clock — a counted quantity.')+'Overlap</span><b class="mono">'+(ov?ov.overlapMin.toFixed(0)+' min'+(ov.basis==='utc-instant'?' · UTC-aligned':''):'none')+'</b></div></div>'+
        '</div>';
    }).join('');
  }

  function renderAll(recs, fusion, warns){
    renderChips.lastRecs=recs;
    renderHero(fusion); renderKPIs(fusion); renderTimeline(recs,fusion);
    renderFindings(fusion); renderTable(fusion); renderPairs(fusion); renderWarnings(warns||[]);
    var exb=$('exportBar'); if(exb) exb.classList.toggle('show', recs.length>0);
  }

  window.IntegratorRender = { bindNav, showView, renderChips, renderAll, renderWarnings };
})();
