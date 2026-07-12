/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   Ganglior · METRIC REGISTRY  (metric-registry.js)
   ────────────────────────────────────────────────────────────────────────
   The ONE shared piece in the disclosure / epistemic-hierarchy system — the
   companion to crossnight-envelope.js. It standardizes the LOGIC + VISUAL
   CONSTANTS, never the per-node DATA. Each node declares its own registry map
   (`<NODE>_REGISTRY`) locally — same split as the envelope:

       <NODE>_REGISTRY            → DATA   → local per node (label/unit/depth/evidence/cite)
       MetricRegistry.badge(...)  → SHAPE  → this file (shared)

   Two INDEPENDENT axes travel with every metric:
     • depth     ∈ basic | advanced | research   → disclosure tiering
                   (emits the existing [data-tier] / body[data-mode] mechanism)
     • evidence  ∈ validated | emerging | experimental | heuristic
                   → epistemic visual hierarchy (a NON-HUE fill ladder badge)

   See SYSTEM-COHESION-BRIEF.md + Visual-Language-Spec.html.

   Exposes window.MetricRegistry = {
     EVIDENCE, DEPTHS, TIERS,
     depthToTier, tierToShows, visibleAtTier,
     entry, badge, legend, evClass,
     getTier, setTier, applyTier, mountDepthSelector,
     STORAGE_KEY, VERSION
   }.
   Pure logic + DOM-string badge helpers + one-time injected stylesheet.
   No network, no deps, no fonts. 100% local.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';

var VERSION     = '1.0';
var STORAGE_KEY = 'dex_depth_tier';          // SHARED across every node (brief §locked-4)
var LEGACY_KEYS = ['oxydex_dashMode', 'o2r_dashMode', 'hrvdex_dashMode']; // migrate-from

/* ── EVIDENCE taxonomy — the fill ladder = the confidence ladder ──────────
   ink is ONE neutral META hue (#aab8cc), deliberately OUTSIDE the status
   hues (green/amber/red) and the brand hues (teal/blue), so the evidence
   channel can never collide with status color. */
var EVIDENCE = {
  measured:     { rank:0, glyph:'\u25C9', label:'Measured',     fill:'target',
    desc:'Direct sensor reading or a raw statistic of the recorded signal (mean/min/max/nadir/duration). The ground truth a node senses — not computed.' },
  validated:    { rank:1, glyph:'\u25CF', label:'Validated',    fill:'solid',
    desc:'Established, externally validated, clinically meaningful DERIVED metric.' },
  emerging:     { rank:2, glyph:'\u25D0', label:'Emerging',     fill:'half',
    desc:'Published and promising, but less standardized or device-dependent.' },
  experimental: { rank:3, glyph:'\u25CB', label:'Experimental', fill:'hollow',
    desc:'Plausible node-computed composite, not externally validated. Directional only.' },
  heuristic:    { rank:4, glyph:'\u25CC', label:'Heuristic',    fill:'dashed',
    desc:'Convenience estimate / population proxy. A trend, not a measurement.' }
};
var EVIDENCE_ORDER = ['measured','validated','emerging','experimental','heuristic'];

/* ── DEPTH axis ↔ existing tier attributes ────────────────────────────────
   basic   → (no data-tier)      → always visible / Core
   advanced→ data-tier=secondary → Advanced+
   research→ data-tier=research  → Research only                         */
var DEPTHS = ['basic','advanced','research'];
var TIERS  = ['core','advanced','research'];      // body[data-mode] values
var DEPTH_TO_TIERATTR = { basic:'', advanced:'secondary', research:'research' };
var TIER_SHOWS = { core:[''], advanced:['','secondary'], research:['','secondary','research'] };

function depthToTier(depth){ return DEPTH_TO_TIERATTR[depth] != null ? DEPTH_TO_TIERATTR[depth] : 'secondary'; }

// is a metric of <depth> visible when the app is in <tier> mode?
function visibleAtTier(depth, tier){
  var attr = depthToTier(depth);
  var shows = TIER_SHOWS[tier] || TIER_SHOWS.core;
  return shows.indexOf(attr) >= 0;
}
function tierToShows(tier){ return (TIER_SHOWS[tier] || TIER_SHOWS.core).slice(); }

/* ── entry(registry, id) → normalized metric def ──────────────────────────
   A metric with no registry entry defaults to advanced/experimental and logs
   a dev warning (forces coverage — brief §1). */
var _warned = {};
function entry(registry, id){
  var r = (registry && registry[id]) || null;
  if(!r){
    if(!_warned[id]){ _warned[id] = true;
      try { console.warn('[MetricRegistry] no registry entry for "'+id+'" — defaulting depth:advanced / evidence:experimental'); } catch(e){} }
    return { id:id, label:id, unit:'', goodDirection:'up', depth:'advanced', evidence:'experimental', cite:'', _missing:true };
  }
  return {
    id:id,
    label: r.label != null ? r.label : id,
    unit:  r.unit  != null ? r.unit  : '',
    goodDirection: r.goodDirection || r.good || 'up',
    depth:    DEPTHS.indexOf(r.depth) >= 0 ? r.depth : 'advanced',
    evidence: EVIDENCE[r.evidence] ? r.evidence : 'experimental',
    cite: r.cite || ''
  };
}

/* ── evClass(evidence) → the badge CSS class (defensive) ── */
function evClass(evidence){ return EVIDENCE[evidence] ? ('ev-'+evidence) : 'ev-experimental'; }

/* ── badge(evidence, cite) → '<span class="ev ev-…" title="…"></span>' ────
   Shared so a Validated dot is byte-identical in every node + the Integrator. */
function _escAttr(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function badge(evidence, cite){
  var e = EVIDENCE[evidence] ? evidence : 'experimental';
  var name = EVIDENCE[e].label;
  var title = name + (cite ? ' \u2014 ' + cite : '');
  return '<span class="ev ev-'+e+'" title="'+_escAttr(title)+'" aria-label="'+_escAttr(name+' evidence')+'"></span>';
}

/* ── legend(opts) → one strip per view ────────────────────────────────────
   opts.only = ['validated','emerging',...] to show a subset; default all. */
function legend(opts){
  opts = opts || {};
  var keys = opts.only && opts.only.length ? opts.only : EVIDENCE_ORDER;
  var parts = ['<span class="lg-title">Evidence</span>'];
  keys.forEach(function(k, i){
    if(!EVIDENCE[k]) return;
    if(i) parts.push('<span class="ev-sep"></span>');
    parts.push('<span class="lg-item"><span class="ev ev-'+k+'"></span><b>'+EVIDENCE[k].label+'</b></span>');
  });
  parts.push('<span class="lg-note">one strip per view \u00b7 cite on hover</span>');
  return '<div class="ev-legend" role="group" aria-label="Evidence legend">'+parts.join('')+'</div>';
}

/* ── Depth-tier persistence (shared key, with legacy migration) ──────────── */
function getTier(){
  var v = null;
  try {
    v = global.localStorage.getItem(STORAGE_KEY);
    if(v == null){
      for(var i=0;i<LEGACY_KEYS.length;i++){
        var lv = global.localStorage.getItem(LEGACY_KEYS[i]);
        if(lv){ v = lv; global.localStorage.setItem(STORAGE_KEY, lv); break; }  // migrate forward
      }
    }
  } catch(e){}
  return TIERS.indexOf(v) >= 0 ? v : 'core';   // default Core (brief §locked-4)
}
function setTier(tier){
  if(TIERS.indexOf(tier) < 0) tier = 'core';
  try { global.localStorage.setItem(STORAGE_KEY, tier); } catch(e){}
  applyTier(tier);
  return tier;
}

/* applyTier — set body[data-mode] + sync every mode control on the page.
   Mirrors each node's local setMode() so the shared key drives the existing CSS. */
function applyTier(tier){
  if(TIERS.indexOf(tier) < 0) tier = 'core';
  var b = global.document && global.document.body;
  if(b){
    b.dataset.mode = tier;
    var sel = '.mode-btn, .nav-mode-btn, .mnav-mode-btn';
    var btns = global.document.querySelectorAll(sel);
    for(var i=0;i<btns.length;i++){ btns[i].classList.toggle('active', btns[i].dataset.mode === tier); }
  }
  return tier;
}

/* mountDepthSelector(el) — optional convenience: wire an existing .mode-bar
   (or build one) so every node persists identically under the shared key. */
function mountDepthSelector(el){
  if(!el) return;
  if(!el.querySelector('.mode-btn')){
    el.classList.add('mode-bar');
    el.innerHTML = TIERS.map(function(t){
      return '<button class="mode-btn" data-mode="'+t+'">'+t.charAt(0).toUpperCase()+t.slice(1)+'</button>';
    }).join('');
  }
  el.addEventListener('click', function(e){
    var btn = e.target.closest('.mode-btn'); if(!btn) return;
    setTier(btn.dataset.mode);
  });
  applyTier(getTier());
}

/* ── One-time injected stylesheet — the evidence visual language (verbatim
   from Visual-Language-Spec.html), so every node that loads this file gets
   identical badges + legend without editing ans-design.css. ──────────────── */
var BADGE_CSS = '';   // canonical evidence-badge stylesheet (the single source
                      // of truth other surfaces mirror — see dex-badges.css).
                      // Populated by _injectCSS on first run; exported below.
function _injectCSS(){
  if(!global.document) return;
  if(global.document.getElementById('metric-registry-css')) return;
  var css = BADGE_CSS =
  ':root{ --ev-ink:#aab8cc; }' +
  '.ev{display:inline-block;width:11px;height:11px;border-radius:50%;flex:none;position:relative;vertical-align:baseline;}' +
  /* measured = bullseye (solid core + gap ring): the strongest mark, a direct
     sensor reading — reads as "locked to ground truth", above validated. */
  '.ev-measured{background:var(--ev-ink);border:2px solid var(--bg);box-shadow:0 0 0 1px var(--ev-ink);}' +
  '.ev-validated{background:var(--ev-ink);box-shadow:0 0 0 1px var(--ev-ink) inset;}' +
  '.ev-emerging{background:linear-gradient(90deg,var(--ev-ink) 0 50%,transparent 50% 100%);box-shadow:0 0 0 1.5px var(--ev-ink) inset;}' +
  '.ev-experimental{background:transparent;box-shadow:0 0 0 1.5px var(--ev-ink) inset;}' +
  '.ev-heuristic{background:transparent;border:1.5px dashed var(--ev-ink);width:12px;height:12px;}' +
  /* ── PLACEMENT (cohesion v1.1) — evidence badge lives in the CARD's
     bottom-right corner, a quiet meta-marker that never competes with the
     metric value or its status hue. In dense tables / section labels /
     legends (no card to anchor to) it stays inline by the label. ───────── */
  /* default: inline (tables, section + chart labels, legend) */
  '.ev{opacity:.85;}' +
  '.t-metric .ev,.sec-label .ev,.lg-item .ev,.chart-legend .ev,.legend-item .ev{position:static;margin-left:5px;}' +
  '.ev[title]{cursor:help;}' +
  /* card tiles become the positioning context for their corner badge */
  '.metric,.ss-kpi,.nr-kpi,.kpi,.readiness-subscore{position:relative;}' +
  /* the badge breaks out of the label and anchors to the tile corner */
  '.metric>.m-label .ev,.metric>.m-val .ev,.ss-kpi>.ss-kpi-label .ev,.nr-kpi>.nr-kpi-label .ev,.kpi>.kpi-label .ev,.readiness-subscore>.rs-label .ev{position:absolute;right:9px;bottom:8px;margin:0;opacity:.55;transition:opacity .15s;}' +
  '.metric:hover>.m-label .ev,.metric:hover>.m-val .ev,.ss-kpi:hover>.ss-kpi-label .ev,.nr-kpi:hover>.nr-kpi-label .ev,.kpi:hover>.kpi-label .ev,.readiness-subscore:hover>.rs-label .ev{opacity:.95;}' +
  /* hero tiles are tall + centered — nudge the corner badge inward to taste */
  '.metric-hero>.m-label .ev{right:14px;bottom:14px;}' +
  /* ── WRAPPER: card corner (.ev-corner) — DEEP-AUDIT §21 ────────────────────
     The mandate's placement (1) for cards / KPIs / HERO numbers. It was defined
     in dex-badges.css but NEVER in the engine, so no app could use it: the apps
     load metric-registry.js, not the CSS mirror. A hero (.readiness-hero) is not
     a .metric/.kpi tile, so the tile rules above never reached it and every hero
     number in the fleet shipped unbadged. Values are byte-faithful to
     dex-badges.css. NOTE: no disc property here (background/border/box-shadow/
     width/height/border-radius) — the cohesion-badges gate deep-compares exactly
     those between engine and mirror; layout props are free to live in one. */
  '.ev-corner{position:absolute;bottom:12px;right:14px;z-index:2;cursor:help;opacity:.55;transition:opacity .15s;}' +
  '.ev-corner:hover{opacity:.7;}' +
  '.readiness-hero{position:relative;}' +
  /* reserve bottom clearance so the corner badge never lands on the value
     (only on tiles that actually carry a badge — others keep their size) */
  '.metric:has(.ev),.ss-kpi:has(.ev),.nr-kpi:has(.ev),.kpi:has(.ev),.readiness-subscore:has(.ev){padding-bottom:22px;}' +
  '.metric-hero:has(.ev){padding-bottom:30px;}' +
  /* full-metrics-table: badge LEADS the metric name (fixed left gutter) so
     rows align in a clean column and long labels keep full width (no wrap). */
  '.fmt-m{white-space:normal;}' +
  '.fmt-m .ev{position:static;margin:0 7px 0 0;opacity:.7;vertical-align:baseline;}' +
  /* chips: small inline meta-dot after the value */
  '.nr-chip .ev{position:static;margin-left:5px;opacity:.6;vertical-align:baseline;width:9px;height:9px;}' +
  /* legend strip */
  '.ev-legend{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:11.5px;color:var(--text3);background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:9px 14px;margin:0 0 16px;}' +
  '.ev-legend .lg-item{display:inline-flex;align-items:center;gap:6px;}' +
  '.ev-legend .lg-item b{color:var(--text2);font-weight:600;}' +
  '.ev-legend .ev-sep{width:1px;height:13px;background:var(--border2);margin:0 4px;}' +
  '.ev-legend .lg-title{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--text4);margin-right:4px;}' +
  '.ev-legend .lg-note{margin-left:auto;color:var(--text4);font-size:10.5px;}';
  var s = global.document.createElement('style');
  s.id = 'metric-registry-css';
  s.textContent = css;
  (global.document.head || global.document.documentElement).appendChild(s);
}

// init: inject CSS + apply persisted tier as early as possible
function _init(){
  _injectCSS();
  // apply tier once the body exists; applyTier no-ops safely if it doesn't yet
  if(global.document && global.document.body) applyTier(getTier());
  else if(global.document) global.document.addEventListener('DOMContentLoaded', function(){ applyTier(getTier()); });
}
_init();

global.MetricRegistry = {
  VERSION:VERSION, STORAGE_KEY:STORAGE_KEY, BADGE_CSS:BADGE_CSS,
  EVIDENCE:EVIDENCE, EVIDENCE_ORDER:EVIDENCE_ORDER, DEPTHS:DEPTHS, TIERS:TIERS,
  depthToTier:depthToTier, tierToShows:tierToShows, visibleAtTier:visibleAtTier,
  entry:entry, badge:badge, legend:legend, evClass:evClass,
  getTier:getTier, setTier:setTier, applyTier:applyTier, mountDepthSelector:mountDepthSelector
};

})(window);
