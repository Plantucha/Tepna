/*
 * dex-gen.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 */
// dex-gen.js — Dex Node Reference Guide Generator
// Reads a manifest JSON and produces a self-contained HTML reference page
// compatible with the Tepna Design System v1.2.0
//
// Usage: node dex-gen.js <manifest.json> [--output <file.html>]
//        node dex-gen.js cpapdex-manifest.json --output cpapdex-reference.html

const fs = require('fs');
const path = require('path');

// ─── CLI ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help')) {
  console.log(`Usage: node dex-gen.js <manifest.json> [--output <file.html>]\n`);
  console.log(`  Generates a reference guide HTML page from a Dex manifest.`);
  console.log(`  Output uses Tepna Design System v1.2.0 classes.`);
  process.exit(0);
}

const manifestPath = args[0];
let outputPath = null;
const outIdx = args.indexOf('--output');
if (outIdx !== -1 && args[outIdx + 1]) {
  outputPath = args[outIdx + 1];
}

if (!outputPath) {
  const base = path.basename(manifestPath, '.json');
  outputPath = `${base}-reference.html`;
}

// ─── Load manifest ──────────────────────────────────────────────────────────
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
} catch (e) {
  console.error(`Error reading manifest: ${e.message}`);
  process.exit(1);
}

// ─── Helpers ────────────────────────────────────────────────────────────────
const esc = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const tierLabel = (tier) => {
  const map = { core: 'Core', secondary: 'Advanced', research: 'Research' };
  return map[tier] || tier;
};

const tierClass = (tier) => {
  const map = { core: 'tc', secondary: 'ta', research: 'tr' };
  return map[tier] || 'tc';
};

const rangeClass = (cls) => {
  const map = { ok: 'ok', warn: 'wn', bad: 'bd', critical: 'cr' };
  return map[cls] || '';
};

// ─── Evidence ladder (System-Cohesion) ──────────────────────────────────────
// The 5-level evidence ladder is the cohesion model's grade axis (disc SHAPE =
// trust). It is SEPARATE from the disclosure `tier` (Core/Advanced/Research,
// the `mt` pill). dex-gen projects each metric's `evidence` into an `ev-corner`
// badge so a generated guide passes the shared `cohesion-badges` gate by
// construction (registry ≡ dex-badges.css ≡ this guide). Mirrors the validation
// in dex-registry-gen.js so a bad manifest fails loudly in BOTH generators.
const EVIDENCE_TIERS = ['measured', 'validated', 'emerging', 'experimental', 'heuristic'];
const RETIRED_EVIDENCE = { proxy: 'heuristic', composite: 'experimental', 'provisionally validated': 'emerging' };
function metricEvidence(m) {
  const ev = m.evidence;
  if (ev == null) return null;  // legacy manifest (pre-Phase-3): no corner badge, warned below
  if (RETIRED_EVIDENCE[ev]) throw new Error(`metric ${m.id} uses RETIRED evidence vocabulary "${ev}" — use "${RETIRED_EVIDENCE[ev]}"`);
  if (!EVIDENCE_TIERS.includes(ev)) throw new Error(`metric ${m.id} has invalid evidence "${ev}" — must be one of ${EVIDENCE_TIERS.join('|')}`);
  return ev;
}
const manifestHasEvidence = () => manifest.sections.some(s => (s.metrics || []).some(m => m.evidence != null));

const allMetrics = () => manifest.sections.flatMap(s =>
  s.metrics.map(m => ({ ...m, sectionId: s.id, sectionTitle: s.title }))
);

const allAbbrs = () => {
  const abbrs = manifest.abbreviations || {};
  return Object.entries(abbrs).sort(([a], [b]) => a.localeCompare(b));
};

// ─── Generate sidebar nav ───────────────────────────────────────────────────
function genSidebarNav() {
  return manifest.sections.map(s => `
    <div class="nav-lbl">${esc(s.title)}</div>
    <div class="nav">
      <a href="#${esc(s.id)}"><span class="nav-dot"></span>${esc(s.title)}</a>
    </div>`).join('\n');
}

// ─── Generate mobile drawer nav ─────────────────────────────────────────────
function genMobileNav() {
  return manifest.sections.map(s => `
    <a href="#${esc(s.id)}" onclick="closeDrawer()">
      <span class="nav-dot"></span>${esc(s.title)}
    </a>`).join('\n');
}

// ─── Generate Quick Jump index ──────────────────────────────────────────────
function genQuickJump() {
  const metrics = allMetrics();
  const groups = manifest.sections.map(s => {
    const links = `<a href="#${esc(s.id)}" class="qj-sec">${esc(s.title)}</a>`;
    const mLinks = s.metrics.map(m =>
      `<a href="#${esc(s.id)}" class="qm">${esc(m.abbr || m.id)}</a>`
    ).join('');
    return `
      <div class="qj-group">
        <div class="qj-group-header">
          <span class="qj-dot" style="background:${manifest.accentColor || 'var(--teal)'}"></span>
          ${esc(s.title)}
        </div>
        <div class="qj-links">${links}</div>
        <div class="qj-metrics">${mLinks}</div>
      </div>`;
  }).join('\n');

  const totalMetrics = metrics.length;
  const totalSections = manifest.sections.length;

  return `
<div class="qj-wrap" id="quick-jump">
  <button class="qj-toggle" id="qjToggle" aria-expanded="false" aria-controls="qjPanel">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
      <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
      <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
    </svg>
    Quick Jump Index
    <span class="qj-count">${totalMetrics} metrics · ${totalSections} sections</span>
    <svg class="qj-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  </button>
  <div class="qj-panel" id="qjPanel" hidden>
    <div class="qj-search-wrap">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input type="text" class="qj-search" id="qjSearch" placeholder="Filter metrics…"
             autocomplete="off" spellcheck="false" inputmode="search">
      <button class="qj-clear" id="qjClear" aria-label="Clear search" hidden>✕</button>
    </div>
    <div class="qj-grid" id="qjGrid">
      ${groups}
    </div>
    <div class="qj-no-results" id="qjNoResults" hidden>No metrics match your search.</div>
  </div>
</div>`;
}

// ─── Generate metric card ───────────────────────────────────────────────────
function genMetricCard(m, sectionId) {
  const hasRanges = m.ranges && m.ranges.length > 0;

  // Evidence corner badge (cohesion coverage mandate — pinned bottom-right;
  // .mc is position:relative via the linked dex-badges.css). Canonical title
  // string "<Label> — <cite>" (em-dash). Grade comes from the manifest.
  const ev = metricEvidence(m);
  const cite = m.cite || m.fullName || m.name || m.id;
  const cornerBadge = ev
    ? `\n    <span class="ev-corner ev-${ev}" title="${esc((m.abbr || m.id) + ' \u2014 ' + cite)}"></span>`
    : '';

  // Range table
  let rangeTable = '';
  if (hasRanges) {
    const rows = m.ranges.map(r => {
      const cls = rangeClass(r.class);
      const maxStr = r.max !== null ? `≤ ${r.max}` : '—';
      return `
        <tr class="${cls}">
          <td>${esc(maxStr)}</td>
          <td class="nr">${esc(r.label)}</td>
        </tr>`;
    }).join('\n');

    rangeTable = `
      <div class="nt-wrap">
        <table class="nt">
          <tr><th>Range</th><th>Classification</th></tr>
          ${rows}
        </table>
      </div>`;
  }

  // Formula block
  const formulaBlock = `
    <div class="fb">
      <div class="fl">Formula</div>
      <div class="ft">${esc(m.formula)}</div>
      ${m.formulaNote ? `<div class="fn">${esc(m.formulaNote)}</div>` : ''}
    </div>`;

  return `
  <div class="mc">
    <div class="mh">
      <div class="mi">
        <span class="ma">${esc(m.abbr || m.id)}</span>
        <span class="mf">${esc(m.fullName || m.name)}</span>
      </div>
      <span class="mt ${tierClass(m.tier)}">${tierLabel(m.tier)}</span>
    </div>
    ${formulaBlock}
    ${rangeTable}${cornerBadge}
  </div>`;
}

// ─── Evidence legend strip (one per view — System-Cohesion §3) ───────────────
function genEvidenceLegend() {
  if (!manifestHasEvidence()) return '';
  return `
  <div class="ev-legend-strip">
    <span class="lg-title">Evidence</span>
    <span class="lg-item"><span class="ev-measured"></span><b>Measured</b></span><span class="sep"></span>
    <span class="lg-item"><span class="ev-validated"></span><b>Validated</b></span><span class="sep"></span>
    <span class="lg-item"><span class="ev-emerging"></span><b>Emerging</b></span><span class="sep"></span>
    <span class="lg-item"><span class="ev-experimental"></span><b>Experimental</b></span><span class="sep"></span>
    <span class="lg-item"><span class="ev-heuristic"></span><b>Heuristic</b></span>
    <span class="lg-note">fill = trust</span>
  </div>`;
}

// ─── Generate section ───────────────────────────────────────────────────────
function genSection(section) {
  const metricCards = section.metrics.map(m =>
    genMetricCard(m, section.id)
  ).join('\n');

  // Determine if we should use a grid layout (>2 metrics)
  const useGrid = section.metrics.length > 2;
  const wrapperOpen = useGrid ? '<div class="mg">' : '';
  const wrapperClose = useGrid ? '</div>' : '';

  return `
<div class="rs" id="${esc(section.id)}">
  <div class="sh">
    <div class="si" style="background:${manifest.accentColor || 'rgba(61,224,208,.12)'}">
      ${section.icon || '📊'}
    </div>
    <div>
      <div class="st">${esc(section.title)}</div>
      <div class="sd">${esc(section.description || '')}</div>
    </div>
  </div>
  ${wrapperOpen}
  ${metricCards}
  ${wrapperClose}
</div>`;
}

// ─── Generate abbreviation index ────────────────────────────────────────────
function genAbbrIndex() {
  const entries = allAbbrs();
  if (entries.length === 0) return '';

  const rows = entries.map(([abbr, full]) =>
    `<tr><td class="nr" style="color:var(--teal)">${esc(abbr)}</td><td>${esc(full)}</td></tr>`
  ).join('\n');

  return `
<div class="rs" id="abbr">
  <div class="sh">
    <div class="si" style="background:rgba(110,133,168,.12)">📖</div>
    <div>
      <div class="st">Abbreviation Index</div>
      <div class="sd">All abbreviations used in ${esc(manifest.node)} reference</div>
    </div>
  </div>
  <div class="nt-wrap">
    <table class="nt">
      <tr><th>Abbr</th><th>Meaning</th></tr>
      ${rows}
    </table>
  </div>
</div>`;
}

// ─── Generate CSS (page-specific overrides only) ───────────────────────────
function genPageCSS() {
  const hex = manifest.accentHex || '#3DE0D0';
  const hex10 = hex + '1a';  // ~10% opacity
  const hex20 = hex + '33';  // ~20% opacity
  const hex30 = hex + '4d';  // ~30% opacity

  return `
/* ${manifest.node} — page-specific overrides (built by dex-gen.js) */
:root {
  --node-accent: ${manifest.accentColor || 'var(--teal)'};
  --node-accent-hex: ${hex};
}

/* Sidebar logo badge gradient uses node accent */
.logo-badge {
  background: linear-gradient(135deg, var(--node-accent-hex), var(--blue));
}

/* Section icons use node accent */
.si { background: rgba(${hexToRgb(hex)}, .12) !important; }

/* Quick Jump dot uses node accent */
.qj-dot { background: var(--node-accent-hex) !important; }
`;
}

// Helper: hex to rgb components
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r},${g},${b}`;
}

// ─── Assemble full HTML ─────────────────────────────────────────────────────
function genHTML() {
  const sections = manifest.sections.map(genSection).join('\n\n');
  const evidenceLegend = genEvidenceLegend();
  const metrics = allMetrics();
  const abbrIndex = genAbbrIndex();
  const sidebarNav = genSidebarNav();
  const mobileDrawerLinks = genMobileNav();
  const quickJump = genQuickJump();
  const pageCSS = genPageCSS();
  const totalMetrics = metrics.length;
  const coreMetrics = metrics.filter(m => m.tier === 'core').length;
  const advMetrics = metrics.filter(m => m.tier === 'secondary').length;
  const resMetrics = metrics.filter(m => m.tier === 'research').length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${manifest.node} — Reference Guide</title>
<!-- Canonical evidence-badge visuals (single source; mirrors MetricRegistry.BADGE_CSS).
     Linked, not inlined, so the guide's discs equal the engine by construction
     (DEX-EVENT-UNIFY C3 / cohesion-badges gate). -->
<link rel="stylesheet" href="dex-badges.css">
<style>
/*
 * Tepna Design System v1.2.0 — shared base
 * Link or paste your design-system.css here.
 * For single-file deployment, inline the full design system.
 */
/* [PASTE DESIGN SYSTEM CSS HERE — §0 through §27] */

${pageCSS}
</style>
</head>
<body>

<!-- ═══ MOBILE BAR + DRAWER ═══ -->
<div class="mob-bar" id="mobBar">
  <div class="mob-bar-logo">
    <div class="mob-bar-badge" style="background:linear-gradient(135deg,${manifest.accentHex || '#3DE0D0'},#58A6FF)">
      ${manifest.icon || '📊'}
    </div>
    <span class="mob-bar-name">${esc(manifest.node)}</span>
  </div>
  <button class="mob-bar-btn" id="mobMenuBtn" aria-label="Open navigation menu"
          onclick="openDrawer()">&#9776;</button>
</div>

<div class="mob-drawer-bg" id="mobDrawerBg" onclick="handleBgClick(event)">
  <div class="mob-drawer-panel" id="mobDrawerPanel">
    <div class="mob-drawer-top">
      <div style="display:flex;align-items:center;gap:9px">
        <div style="width:28px;height:28px;border-radius:7px;
             background:linear-gradient(135deg,${manifest.accentHex || '#3DE0D0'},#58A6FF);
             display:flex;align-items:center;justify-content:center;font-size:12px">
          ${manifest.icon || '📊'}
        </div>
        <span style="font-weight:700;font-size:13px;color:#F4F7FB">Sections</span>
      </div>
      <button class="mob-drawer-close" aria-label="Close navigation"
              onclick="closeDrawer()">&#x2715;</button>
    </div>
    <div style="margin-bottom:14px;padding:0 4px">
      <a href="#quick-jump" onclick="closeDrawer()" style="display:flex;align-items:center;
         gap:8px;background:rgba(61,224,208,.07);border:1px solid rgba(61,224,208,.18);
         border-radius:8px;padding:9px 12px;text-decoration:none;color:var(--teal);
         font-size:13px;font-weight:500;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2"><circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        Quick Jump &amp; Search
      </a>
    </div>
    ${manifest.sections.map(s => `
    <div class="nav-lbl">${esc(s.title)}</div>
    <div class="nav">
      ${mobileDrawerLinks.split('\n').filter(l => l.includes(s.id)).join('\n')}
    </div>`).join('\n')}
  </div>
</div>

<!-- ═══ APP SHELL ═══ -->
<div class="app">

<!-- ── Sidebar ── -->
<nav class="sidebar">
  <div class="logo">
    <div class="logo-badge" style="background:linear-gradient(135deg,${manifest.accentHex || '#3DE0D0'},#58A6FF)">
      ${manifest.icon || '📊'}
    </div>
    <div>
      <div class="logo-title">${esc(manifest.node)}</div>
      <div class="logo-sub">Reference Guide</div>
    </div>
  </div>
  ${sidebarNav}

  <div class="nav-lbl">Reference</div>
  <div class="nav">
    <a href="#abbr"><span class="nav-dot"></span>Abbreviation Index</a>
  </div>

  <div class="sidebar-bottom">
    <div class="sidebar-data-card">
      <div class="data-pill"><span class="data-dot"></span> Reference Guide</div>
      <div class="sidebar-data-info">
        ${esc(manifest.node)} v${esc(manifest.version)} · ${esc(manifest.status)}<br>
        ${totalMetrics} metrics · ${manifest.sections.length} sections
      </div>
    </div>
  </div>
</nav>

<!-- ── Main content ── -->
<main class="main">
  <div class="ph">
    <div class="ph-eyebrow">${esc(manifest.node)} — Technical Reference</div>
    <h1 class="ph-title">Metrics, Formulas &amp;<br><span>Normal Values</span></h1>
    <p class="ph-desc">${esc(manifest.description)}</p>
    <p class="ph-desc" style="margin-top:8px;font-size:12px;color:var(--text3)">
      ${totalMetrics} metrics total: ${coreMetrics} Core · ${advMetrics} Advanced · ${resMetrics} Research
    </p>
  </div>

  ${manifest.warning ? `
  <div class="co co-w">
    <span class="co-ic">&#x26A0;&#xFE0F;</span>
    <div><strong>Important:</strong> ${esc(manifest.warning)}</div>
  </div>` : ''}

  ${quickJump}

  ${evidenceLegend}

  ${sections}

  ${abbrIndex}

</main>
</div>

<!-- ═══ Script: drawer + quick-jump search ═══ -->
<script>
/* ── Mobile drawer ── */
function openDrawer() {
  document.getElementById('mobDrawerBg').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeDrawer() {
  document.getElementById('mobDrawerBg').classList.remove('open');
  document.body.style.overflow = '';
}
function handleBgClick(e) {
  if (e.target === e.currentTarget) closeDrawer();
}

/* ── Quick Jump toggle + search ── */
(function() {
  const toggle = document.getElementById('qjToggle');
  const panel = document.getElementById('qjPanel');
  const search = document.getElementById('qjSearch');
  const clear = document.getElementById('qjClear');
  const noResults = document.getElementById('qjNoResults');

  if (!toggle) return;

  toggle.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', open);
    if (open && search) search.focus();
  });

  if (!search) return;

  search.addEventListener('input', () => {
    const q = search.value.toLowerCase().trim();
    clear.hidden = !q;
    const items = document.querySelectorAll('.qm');
    let visible = 0;
    items.forEach(el => {
      const match = !q || el.textContent.toLowerCase().includes(q);
      el.classList.toggle('qm-hide', !match);
      el.classList.toggle('qm-match', q && match);
      if (match) visible++;
    });
    noResults.hidden = visible > 0;
  });

  if (clear) {
    clear.addEventListener('click', () => {
      search.value = '';
      search.dispatchEvent(new Event('input'));
      search.focus();
    });
  }
})();
</script>

</body>
</html>`;
}

// ─── Write output ───────────────────────────────────────────────────────────
const html = genHTML();
fs.writeFileSync(outputPath, html, 'utf-8');

const stats = {
  sections: manifest.sections.length,
  metrics: allMetrics().length,
  core: allMetrics().filter(m => m.tier === 'core').length,
  secondary: allMetrics().filter(m => m.tier === 'secondary').length,
  research: allMetrics().filter(m => m.tier === 'research').length,
  abbreviations: allAbbrs().length,
  bytes: Buffer.byteLength(html, 'utf-8'),
};

console.log(`\n✓ Generated ${esc(manifest.node)} Reference Guide`);
console.log(`  Output: ${outputPath}`);
console.log(`  Sections:      ${stats.sections}`);
console.log(`  Metrics:       ${stats.metrics} (${stats.core} core / ${stats.secondary} advanced / ${stats.research} research)`);
console.log(`  Abbreviations: ${stats.abbreviations}`);
console.log(`  File size:     ${(stats.bytes / 1024).toFixed(1)} KB`);
console.log(`  Evidence badges: ${manifestHasEvidence() ? 'yes (ev-corner per card; cohesion-badges-ready)' : 'NONE — add `evidence` per metric for cohesion-badges'}`);
console.log(`\n  NOTE: Paste your design-system.css into the <style> block,`);
console.log(`  or link it externally for development.\n`);
