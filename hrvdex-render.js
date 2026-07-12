/* ════ HRVDex · RENDER & CHARTS (hrvdex-render.js) ───────────────────────────────────────────────
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   All DOM/chart rendering: status, window/tab/mode controls, readiness
   hero, KPIs, alerts, every chart builder, distributions & patterns, the
   metrics table, and the cardiovascular-research panel. Charts use the
   first-party canvas renderer hrvdex-chart.js (window.Chart) — no third-party
   charting library (see THIRD-PARTY.md). The Chart-compatible API is unchanged.
   Plain global script — shares page scope with the other hrvdex-*.js files,
   exactly as in the original single-script monolith. No behavior change.
   Load order: hrvdex-dsp → hrvdex-render → hrvdex-profile → hrvdex-app.
   ════════════════════════════════════════════════════════════════════════ */

// ── evidence badge hook (System-Cohesion) — resolves a badge from a rendered
// label via HrvRegistry (hrvdex-registry.js). Zero-touch; safe no-op if the
// registry is unloaded. Plain global, shared page scope.
function evBadge(label, fallback) {
  try {
    return (window.HrvRegistry && window.HrvRegistry.badgeForLabel(label, fallback !== false)) || '';
  } catch (e) {
    return '';
  }
}

/* ===== STATUS ===== */
function setStatus(msg) {
  const sb = document.getElementById('statusBar');
  sb.classList.add('show');
  sb.innerHTML = '<div class="status-dot"></div>' + msg;
}

/* ===== WINDOW CONTROL ===== */
function setWindow(d, btn) {
  windowDays = d;
  document.querySelectorAll('.btn-group .btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  rerender();
}

/* ===== TAB SWITCH ===== */
function switchTab(id, el) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.sb-item').forEach((t) => t.classList.remove('active'));
  if (el) el.classList.add('active');
  document.getElementById('tab-' + id).classList.add('active');
  // Scroll the freshly-shown tab into view. The tab content sits BELOW the
  // hero / profile / KPI blocks, so scrolling to page-top would leave the
  // swapped-in graphs off-screen. Instead bring the tab bar (desktop) — or the
  // active content when the bar is hidden on mobile — up to the top of view.
  try {
    var anchor = document.querySelector('.tab-bar');
    if (!anchor || anchor.offsetParent === null) {
      anchor = document.getElementById('tab-' + id);
    }
    if (anchor) {
      var y = anchor.getBoundingClientRect().top + window.pageYOffset - 12;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }
  } catch (e) {}
  setTimeout(() => rerender(), 50);
}

// Detail-level mode (Core / Advanced / Research). Previously absent, which left
// the Research tier unreachable — adding it also exposes that tier.
function setMode(mode, btn) {
  // Depth tier persists under the SHARED suite key (dex_depth_tier) via
  // MetricRegistry (System-Cohesion §locked-4); legacy 'hrvdex_dashMode' is
  // migrated forward by MetricRegistry.getTier(). Fall back to local behaviour.
  if (window.MetricRegistry) {
    window.MetricRegistry.setTier(mode);
  } else {
    document.body.dataset.mode = mode;
    document.querySelectorAll('.mode-btn, .nav-mode-btn, .mnav-mode-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    try {
      localStorage.setItem('hrvdex_dashMode', mode);
    } catch (e) {}
  }
  var hint = document.getElementById('modeHint');
  if (hint) {
    hint.textContent =
      mode === 'research'
        ? 'All graphs per tab — includes exploratory / caveated metrics'
        : mode === 'advanced'
          ? 'Top 6 graphs per tab — adds established secondary metrics'
          : 'Top 3 graphs per tab — the essentials only';
  }
  // Newly-revealed chart cards were display:none when first drawn, so Chart.js
  // measured them at 0×0. Re-render now that they're visible so they size right.
  if (typeof rerender === 'function' && typeof allRows !== 'undefined' && allRows.length) {
    requestAnimationFrame(function () {
      rerender();
    });
  }
  // Bring the active tab's charts into view — newly revealed graphs are often
  // below the current scroll position, so scroll the tab content up to the top.
  try {
    var anchor = document.querySelector('.tab-bar');
    if (!anchor || anchor.offsetParent === null) {
      anchor = document.querySelector('.tab-content.active');
    }
    if (anchor) {
      var y = anchor.getBoundingClientRect().top + window.pageYOffset - 12;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }
  } catch (e) {}
}

// Positionally tier every tab's charts so Core/Advanced/Research filters work
// EVERYWHERE, not just Overview. Charts are authored most-important-first, so:
//   index 0–2  → Core   (always shown)
//   index 3–5  → Advanced (shown in Advanced + Research)
//   index 6+   → Research (shown in Research only)
// Idempotent: safe to call more than once; won't duplicate pills.
function applyChartTiers() {
  document.querySelectorAll('.tab-content .chart-grid').forEach(function (grid) {
    var cards = Array.prototype.filter.call(grid.children, function (c) {
      return c.classList && c.classList.contains('chart-card');
    });
    cards.forEach(function (card, i) {
      var tier = i < 3 ? 'core' : i < 6 ? 'secondary' : 'research';
      if (tier === 'core') {
        card.removeAttribute('data-tier');
      } else {
        card.setAttribute('data-tier', tier);
      }
      if (tier !== 'core' && !card.querySelector('.tier-pill')) {
        var pill = document.createElement('span');
        pill.className = 'tier-pill' + (tier === 'research' ? ' research' : '');
        pill.textContent = tier === 'research' ? 'Research' : 'Advanced';
        card.insertBefore(pill, card.firstChild);
      }
    });
  });
}
if (document.readyState !== 'loading') applyChartTiers();
else document.addEventListener('DOMContentLoaded', applyChartTiers);
(function () {
  var saved = 'core';
  if (window.MetricRegistry) {
    saved = window.MetricRegistry.getTier();
    window.MetricRegistry.applyTier(saved);
  } else {
    try {
      saved = localStorage.getItem('hrvdex_dashMode') || 'core';
    } catch (e) {}
    document.body.dataset.mode = saved;
  }
  function syncBtns() {
    document.querySelectorAll('.mode-btn, .nav-mode-btn, .mnav-mode-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === saved);
    });
  }
  if (document.readyState !== 'loading') syncBtns();
  else document.addEventListener('DOMContentLoaded', syncBtns);
})();

function hrvNavTo(id, btn) {
  switchTab(id, null);
  document.querySelectorAll('.tab, .sb-item').forEach(function (t) {
    var on = t.getAttribute('onclick') || '';
    t.classList.toggle('active', on.indexOf("switchTab('" + id + "'") >= 0);
  });
  document.querySelectorAll('.mobile-nav-item').forEach(function (b) {
    b.classList.remove('active');
  });
  if (btn) btn.classList.add('active');
  // switchTab() already scrolls the active content into view; don't override it.
}

/* ===== MAIN RENDER ===== */
function rerender() {
  const rows = getFilteredRows();
  // X §2: keep the export-bar scope hint in sync with the window / morning-only filter
  if (typeof _hrvUpdateExportHint === 'function') _hrvUpdateExportHint();
  const sm = parseInt(document.getElementById('smoothRange') ? document.getElementById('smoothRange').value : 0, 10);
  if (!rows.length) return;
  // KPI strip always uses morning-only rows (hour < 10) for consistency
  const morningRows = allRows.filter((r) => r._date.getUTCHours() < 10);
  const kpiRows = morningRows.length >= 3 ? morningRows : rows; // fallback if <3 morning rows
  renderKPIs(kpiRows);
  renderAlerts(kpiRows);
  renderAllCharts(rows, sm);
  if (typeof renderCardiovascularResearch === 'function') {
    try {
      renderCardiovascularResearch(rows);
    } catch (e) {
      console.warn('Cardiovascular research render failed:', e);
    }
  }
  renderTable(rows);
}

/* ===== READINESS HERO ===== */
function renderHero(r, prev) {
  const wrap = document.getElementById('heroWrap');
  if (!wrap || !r) return;
  const num = (v) => (v != null && !isNaN(v) ? v : null);

  // Headline = HRV Score (the app's primary "today" readiness indicator)
  const score = num(r._hrv);
  let color, tier;
  if (score == null) {
    color = 'bad';
    tier = 'Upload data to analyze';
  } else if (score >= 55) {
    color = 'good';
    tier = 'Primed · Peak readiness';
  } else if (score >= 45) {
    color = 'good';
    tier = 'Ready · Train as planned';
  } else if (score >= 33) {
    color = 'warn';
    tier = 'Moderate · Keep it easy';
  } else {
    color = 'bad';
    tier = 'Strained · Prioritize rest';
  }
  const cssColor = color === 'good' ? 'var(--status-ok)' : color === 'warn' ? 'var(--status-caution)' : 'var(--status-concern)';

  // Recommendation note
  const ari = num(r.d_ari);
  let note;
  if (score == null) note = 'Upload a Welltory export to see your autonomic readiness.';
  else if (score >= 55 && (ari == null || ari >= 1)) note = 'Strong parasympathetic recovery — a green light for higher-intensity training.';
  else if (score >= 45) note = 'Balanced autonomic state — proceed with your planned training load.';
  else if (score >= 33) note = 'HRV is below your baseline — favour easy aerobic work and recovery today.';
  else note = 'Marked autonomic strain — prioritise rest, sleep and downregulation.';

  // Subscores (mirror KPI thresholds)
  const subs = [
    { v: num(r._rmssd), fmt: (v) => v.toFixed(0), unit: '', label: 'rMSSD', cls: (v) => (v > 35 ? 'ok' : v > 20 ? 'warn' : 'bad') },
    { v: num(r._sdnn), fmt: (v) => v.toFixed(0), unit: '', label: 'SDNN', cls: (v) => (v > 60 ? 'ok' : v > 40 ? 'warn' : 'bad') },
    { v: num(r._stress), fmt: (v) => v.toFixed(0), unit: '', label: 'Stress', cls: (v) => (v < 45 ? 'ok' : v < 65 ? 'warn' : 'bad') },
    { v: ari, fmt: (v) => v.toFixed(2), unit: '', label: 'Recovery', cls: (v) => (v > 1 ? 'ok' : v > 0.85 ? 'warn' : 'bad') }
  ];
  let subsHtml = '';
  subs.forEach((s) => {
    if (s.v == null) return;
    subsHtml += `<div class="readiness-subscore"><div class="rs-val ${s.cls(s.v)}">${evBadge(s.label)}${s.fmt(s.v)}${s.unit}</div><div class="rs-label">${s.label}</div></div>`;
  });

  // Trend chips
  let chips = '';
  const mom = num(r.d_hrv_momentum);
  if (mom != null) {
    const c = mom > 0 ? 'ok' : mom > -0.01 ? 'warn' : 'bad';
    const a = mom > 0 ? '↗' : mom > -0.01 ? '→' : '↘';
    const t = mom > 0 ? 'HRV trending up' : mom > -0.01 ? 'HRV holding steady' : 'HRV trending down';
    chips += `<div class="readiness-zone-chip ${c}">${a} ${t}</div>`;
  }
  const debt = num(r.d_recovery_debt);
  if (debt != null) {
    const c = debt < 3 ? 'ok' : debt < 7 ? 'warn' : 'bad';
    chips += `<div class="readiness-zone-chip ${c}">Recovery debt ${debt}/14d</div>`;
  }

  const dateStr = r._date ? r._date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';

  wrap.classList.add('show');
  wrap.innerHTML =
    `<div class="readiness-hero" style="--readiness-color:${cssColor}">` +
    `<div class="readiness-hero-label">ANS Readiness</div>` +
    (dateStr ? `<div class="readiness-date-badge">${dateStr}</div>` : '') +
    `<div class="readiness-score">${score != null ? score.toFixed(0) : '—'}</div>` +
    `<div class="readiness-tier">${tier}</div>` +
    (subsHtml ? `<div class="readiness-scores-grid">${subsHtml}</div>` : '') +
    `<div class="readiness-note">${note}</div>` +
    (chips ? `<div class="readiness-zones">${chips}</div>` : '') +
    // DEEP-AUDIT §21 — the hero was the ONE unbadged number on this card while every subscore
    // below it was badged. It is Welltory's black-box 'HRV Score' (registry: experimental), so
    // it is exactly the number that most needs its evidence tier shown.
    `<span class="ev-corner">${evBadge('HRV Score')}</span>` +
    `</div>`;

  // Mirror into the sidebar readiness badge
  const srb = document.getElementById('sidebarReadinessBadge');
  if (srb) {
    const srbScore = document.getElementById('srbScore');
    const srbNote = document.getElementById('srbNote');
    if (srbScore) {
      srbScore.textContent = score != null ? score.toFixed(0) : '—';
      srbScore.style.setProperty('--srb-color', cssColor);
    }
    if (srbNote) srbNote.textContent = tier;
    srb.style.display = 'flex';
  }
}

/* ===== SECONDARY HERO: VALIDATED HRV BENCH ===== */
/* Fills the #heroTop secondary slot (vacated by the removed ANS-age card) with the
   node's validated time-domain HRV bench — RMSSD/SDNN/Poincaré/HF (Task Force 1996).
   Reuses the .proj-card heroTop styling, matching the rest of the suite. */
function renderHrvBench(r) {
  const top = document.getElementById('heroTop');
  if (!top || !r) return;
  let host = document.getElementById('heroBenchHrv');
  if (!host) {
    host = document.createElement('div');
    host.id = 'heroBenchHrv';
    host.className = 'proj-grid';
    top.appendChild(host);
  }
  const num = (v) => (v != null && !isNaN(v) ? v : null);
  const rm = num(r._rmssd),
    sd = num(r._sdnn),
    hf = num(r.d_hfnu),
    cai = num(r.d_cai),
    hr = num(r._hr),
    si = num(r.d_si);
  const exp = 30;
  const sev = rm == null ? 'proj-warn' : rm >= exp ? 'proj-good' : rm >= exp * 0.7 ? 'proj-warn' : 'proj-bad';
  const vc = rm == null ? '' : rm >= exp ? 'proj-val-good' : rm >= exp * 0.7 ? 'proj-val-warn' : 'proj-val-bad';
  const eb = (l) => (typeof evBadge === 'function' ? evBadge(l) : '');
  const f = (lbl, sub, val, unit, cls) =>
    `<div class="proj-factor"><span>${eb(lbl)}${lbl} <span style="opacity:.55">${sub}</span></span><span class="pf-val cv-${cls}">${val != null ? val + ' ' + unit : '—'}</span></div>`;
  const st = (lbl, val, unit, cls) =>
    `<div class="proj-stat ps-${cls}"><span class="ps-label">${eb(lbl)}${lbl}</span><span class="ps-val">${val != null ? val : '—'}<span class="ps-unit">${unit}</span></span></div>`;
  host.innerHTML =
    `<div class="proj-card ${sev}">` +
    // DEEP-AUDIT §21 — this pill hardcoded the ladder word "validated" as literal markup, in a
    // status-HUE pill (proj-good = green), on a card whose own CAI metric is graded `emerging`.
    // The evidence ladder is never a hue and is never hand-typed: each metric on this card already
    // carries its real badge from the registry (eb(...) below). The counterfeit pill is gone.
    `<div class="proj-header"><span class="proj-icon">💓</span><span class="proj-title">HRV Bench · Time-Domain</span></div>` +
    `<div class="proj-main"><div class="proj-value ${vc}">${rm != null ? rm.toFixed(0) : '—'}</div><div class="proj-unit">ms · ${eb('rMSSD')}rMSSD (vagal tone)</div></div>` +
    `<div class="proj-waterfall">` +
    f('SDNN', 'norm 50–100 ms', sd != null ? sd.toFixed(0) : null, 'ms', sd > 50 ? 'good' : sd > 35 ? 'warn' : 'bad') +
    f('CAI', '√(SD1·SD2) geometric', cai != null ? cai.toFixed(0) : null, 'ms', cai >= 45 ? 'good' : cai >= 30 ? 'warn' : 'bad') +
    f('HF n.u.', 'parasympathetic %', hf != null ? hf.toFixed(0) : null, '%', hf >= 35 ? 'good' : hf >= 20 ? 'warn' : 'bad') +
    `</div>` +
    `<div class="proj-extra">` +
    st('Resting HR', hr != null ? hr.toFixed(0) : null, 'bpm', 'good') +
    st('Baevsky SI', si != null ? si.toFixed(0) : null, '', si == null ? 'neutral' : si < 150 ? 'good' : si < 250 ? 'warn' : 'bad') +
    `</div>` +
    `<div class="proj-subline" style="margin-top:auto;opacity:.8">Validated time-domain HRV — RMSSD · SDNN · Poincaré (CAI) · HF (Task Force 1996). The reference-grade autonomic summary for this reading.</div>` +
    `</div>`;
}

/* ===== KPIs ===== */
function renderKPIs(rows) {
  const r = rows[rows.length - 1];
  const prev = rows.length > 1 ? rows[rows.length - 2] : null;
  renderHero(r, prev);
  renderHrvBench(r);
  const strip = document.getElementById('kpiStrip');
  strip.classList.add('show');

  const kpis = [
    {
      label: 'HRV Score',
      val: r._hrv != null ? r._hrv.toFixed(1) : undefined,
      sub: 'Today',
      color: r._hrv > 45 ? 'good' : r._hrv > 30 ? 'warn' : 'bad',
      delta: prev ? (r._hrv - prev._hrv).toFixed(1) : null,
      unit: ''
    },
    {
      label: 'SDNN',
      val: r._sdnn != null ? r._sdnn.toFixed(1) : undefined,
      sub: 'ms — today',
      color: r._sdnn > 60 ? 'good' : r._sdnn > 40 ? 'warn' : 'bad',
      delta: prev ? (r._sdnn - prev._sdnn).toFixed(1) : null,
      unit: 'ms'
    },
    {
      label: 'rMSSD',
      val: r._rmssd != null ? r._rmssd.toFixed(1) : undefined,
      sub: 'ms — parasympathetic',
      color: r._rmssd > 35 ? 'good' : r._rmssd > 20 ? 'warn' : 'bad',
      delta: prev ? (r._rmssd - prev._rmssd).toFixed(1) : null,
      unit: 'ms'
    },
    {
      label: 'Stress',
      val: r._stress != null ? r._stress.toFixed(0) : undefined,
      sub: 'HRV score',
      color: r._stress < 45 ? 'good' : r._stress < 65 ? 'warn' : 'bad',
      delta: prev ? (r._stress - prev._stress).toFixed(0) : null,
      unit: '',
      inverse: true
    },
    {
      label: 'Energy',
      val: r._energy != null ? r._energy.toFixed(0) : undefined,
      sub: 'HRV score',
      color: r._energy > 55 ? 'good' : r._energy > 35 ? 'warn' : 'bad',
      delta: prev ? (r._energy - prev._energy).toFixed(0) : null,
      unit: ''
    },
    { label: 'Baevsky SI', val: r.d_si != null ? r.d_si.toFixed(0) : undefined, sub: '&lt;150 normal', color: r.d_si < 150 ? 'good' : r.d_si < 250 ? 'warn' : 'bad', delta: null, unit: '' },
    { label: 'LF/HF', val: r.d_lfhf != null ? r.d_lfhf.toFixed(2) : undefined, sub: '0.5–2.0 optimal', color: r.d_lfhf > 0.4 && r.d_lfhf < 2.5 ? 'good' : 'warn', delta: null, unit: '' },
    {
      label: 'ANS Load',
      val: r.d_ans_load != null ? r.d_ans_load.toFixed(2) : undefined,
      sub: 'composite burden',
      color: r.d_ans_load < 1 ? 'good' : r.d_ans_load < 2 ? 'warn' : 'bad',
      delta: null,
      unit: ''
    },
    {
      label: 'Recov Index',
      val: r.d_ari != null ? r.d_ari.toFixed(2) : undefined,
      sub: '>1.05 = above baseline',
      color: r.d_ari > 1.0 ? 'good' : r.d_ari > 0.85 ? 'warn' : 'bad',
      delta: null,
      unit: ''
    },
    {
      label: 'Coherence',
      val: r._coherence != null ? r._coherence.toFixed(0) : undefined,
      sub: 'HRV coherence',
      color: r._coherence > 60 ? 'good' : r._coherence > 30 ? 'warn' : 'bad',
      delta: null,
      unit: ''
    },
    {
      label: 'SDNN Z-score',
      val: r.d_sdnn_z != null ? r.d_sdnn_z.toFixed(2) : undefined,
      sub: 'vs 7d baseline',
      color: r.d_sdnn_z > -0.5 ? 'good' : r.d_sdnn_z > -1.5 ? 'warn' : 'bad',
      delta: null,
      unit: ''
    },
    {
      label: 'SD1/SD2',
      val: r.d_sd1_sd2 != null ? r.d_sd1_sd2.toFixed(3) : undefined,
      sub: '0.25–0.35 typical',
      color: r.d_sd1_sd2 > 0.2 && r.d_sd1_sd2 < 0.5 ? 'good' : 'warn',
      delta: null,
      unit: ''
    },
    { label: 'Toichi CVI', val: r.d_cvi != null ? r.d_cvi.toFixed(2) : undefined, sub: 'cardiac vagal (ms×ms)', color: r.d_cvi > 4.4 ? 'good' : r.d_cvi > 4.1 ? 'warn' : 'bad', delta: null, unit: '' },
    { label: 'Toichi CSI', val: r.d_csi != null ? r.d_csi.toFixed(3) : undefined, sub: 'cardiac sympathetic', color: r.d_csi < 0.25 ? 'good' : r.d_csi < 0.4 ? 'warn' : 'bad', delta: null, unit: '' },
    /* ANS Age row REMOVED 2026-06-21 (external-review WP-A) */
    { label: 'EFC Index', val: r.d_efc != null ? r.d_efc.toFixed(3) : undefined, sub: 'readiness 0–1', color: r.d_efc > 0.55 ? 'good' : r.d_efc > 0.4 ? 'warn' : 'bad', delta: null, unit: '' },
    {
      label: 'VO2max Est',
      val: r.d_vo2_hrv != null ? r.d_vo2_hrv.toFixed(1) : undefined,
      sub: 'ml/kg/min HRV-adj',
      color: r.d_vo2_hrv >= 45 ? 'good' : r.d_vo2_hrv >= 41 ? 'warn' : 'bad',
      delta: null,
      unit: ''
    },
    {
      label: 'VO2 7d Avg',
      val: r.d_vo2_roll7 != null ? r.d_vo2_roll7.toFixed(1) : undefined,
      sub: 'rolling baseline',
      color: r.d_vo2_roll7 >= 43 ? 'good' : r.d_vo2_roll7 >= 40 ? 'warn' : 'bad',
      delta: null,
      unit: ''
    },
    /* SBP Est / DBP Est / BP Risk rows REMOVED 2026-06-21 (external-review WP-A)
       — cuffless BP from HRV is indefensible as a surfaced metric. */
    { label: 'ABS', val: r.d_abs != null ? r.d_abs.toFixed(3) : undefined, sub: '-1=SNS +1=PSNS', color: r.d_abs > 0 ? 'good' : r.d_abs > -0.3 ? 'warn' : 'bad', delta: null, unit: '' },
    { label: 'VEI (rMSSD/HR)', val: r.d_vei != null ? r.d_vei.toFixed(2) : undefined, sub: 'vagal efficiency', color: r.d_vei > 0.45 ? 'good' : r.d_vei > 0.3 ? 'warn' : 'bad', delta: null, unit: '' },
    { label: 'CAI', val: r.d_cai != null ? r.d_cai.toFixed(1) : undefined, sub: '√(SD1×SD2) ms', color: r.d_cai > 45 ? 'good' : r.d_cai > 30 ? 'warn' : 'bad', delta: null, unit: 'ms' },
    {
      label: 'Restoration Index',
      val: r.d_welfare != null ? r.d_welfare.toFixed(1) : undefined,
      sub: 'E×Coh/Stress',
      color: r.d_welfare > 40 ? 'good' : r.d_welfare > 20 ? 'warn' : 'bad',
      delta: null,
      unit: ''
    },
    {
      label: 'HRV Momentum',
      val: r.d_hrv_momentum != null && !isNaN(r.d_hrv_momentum) ? (r.d_hrv_momentum > 0 ? '+' : '') + r.d_hrv_momentum.toFixed(4) : undefined,
      sub: '14d ln(rMSSD) slope',
      color: r.d_hrv_momentum > 0 ? 'good' : r.d_hrv_momentum > -0.01 ? 'warn' : 'bad',
      delta: null,
      unit: ''
    },
    {
      label: 'Recov Debt',
      val: r.d_recovery_debt != null ? r.d_recovery_debt.toString() : undefined,
      sub: 'ARI<0.9 days/14d',
      color: r.d_recovery_debt < 3 ? 'good' : r.d_recovery_debt < 7 ? 'warn' : 'bad',
      delta: null,
      unit: 'd'
    },
    {
      label: 'DFA α1',
      val: r.d_dfa_proxy != null && !isNaN(r.d_dfa_proxy) ? r.d_dfa_proxy.toFixed(2) : undefined,
      sub: 'fractal scaling proxy',
      color: r.d_dfa_proxy > 0.8 ? 'good' : r.d_dfa_proxy > 0.7 ? 'warn' : 'bad',
      delta: null,
      unit: ''
    },
    {
      label: 'Spectral Ent',
      val: r.d_spectral_ent != null && !isNaN(r.d_spectral_ent) ? r.d_spectral_ent.toFixed(2) : undefined,
      sub: 'regulatory complexity',
      color: r.d_spectral_ent > 0.7 ? 'good' : r.d_spectral_ent > 0.5 ? 'warn' : 'bad',
      delta: null,
      unit: ''
    },
    {
      label: 'HF n.u.',
      val: r.d_hfnu != null && !isNaN(r.d_hfnu) ? r.d_hfnu.toFixed(0) : undefined,
      sub: 'parasympathetic %',
      color: r.d_hfnu > 35 ? 'good' : r.d_hfnu > 20 ? 'warn' : 'bad',
      delta: null,
      unit: ''
    },
    {
      label: 'PTI',
      val: r.d_pti != null && !isNaN(r.d_pti) ? r.d_pti.toFixed(1) : undefined,
      sub: 'PSNS × rMSSD tone',
      color: r.d_pti > 18 ? 'good' : r.d_pti > 10 ? 'warn' : 'bad',
      delta: null,
      unit: ''
    },
    {
      label: 'Overtrain Risk',
      val: r.d_otr_sat ? '500+' : r.d_otr != null && !isNaN(r.d_otr) ? r.d_otr.toFixed(0) : undefined,
      sub: 'SNS/PSNS load',
      color: r.d_otr < 50 ? 'good' : r.d_otr < 150 ? 'warn' : 'bad',
      delta: null,
      unit: '',
      inverse: true
    }
  ];

  strip.innerHTML = kpis
    .map((k) => {
      let dHtml = '';
      if (k.delta !== null && k.delta !== undefined) {
        const v = parseFloat(k.delta);
        const isGood = k.inverse ? v < 0 : v > 0;
        const cls = v === 0 ? 'neutral' : isGood ? 'up' : 'down';
        const arrow = v === 0 ? '→' : v > 0 ? '↑' : '↓';
        dHtml = `<div class="kpi-delta ${cls}">${arrow} ${Math.abs(v)}${k.unit} vs prev</div>`;
      }
      return `<div class="kpi ${k.color}"><div class="kpi-label">${evBadge(k.label)}${k.label}</div><div class="kpi-val" style="color:var(--${k.color === 'good' ? 'green' : k.color === 'warn' ? 'yellow' : 'red'})">${k.val === undefined || k.val === null || k.val === '' || k.val === 'NaN' ? '—' : k.val}</div>${dHtml}<div class="kpi-sub">${k.sub}</div></div>`;
    })
    .join('');
}

/* ===== ALERTS ===== */
function renderAlerts(rows) {
  // v2.9: use the chronologically latest measurement for alerts,
  // not the last of the morning-filtered kpiRows (which may be days old).
  const r = allRows.length ? allRows[allRows.length - 1] : rows[rows.length - 1];
  const panel = document.getElementById('alertPanel');
  const alerts = [];

  if (r._stress > 70) alerts.push({ type: 'red', icon: '🚨', msg: `<strong>High Stress ${r._stress}</strong> — Today's stress exceeds 70. Consider breathwork or reduced training load.` });
  if (r._energy < 30) alerts.push({ type: 'red', icon: '⚡', msg: `<strong>Low Energy ${r._energy}</strong> — Energy below 30. Recovery priority day.` });
  if (r.d_si > 250) alerts.push({ type: 'red', icon: '⚠️', msg: `<strong>Baevsky SI ${r.d_si != null ? r.d_si.toFixed(0) : undefined}</strong> — Stress Index exceeds 250. Elevated autonomic load.` });
  // Baevsky unit guard (DexUnits.guardBaevsky) — surface ms-vs-s normalization instead of silently scaling (-III §1)
  if (r.d_si_flagged)
    alerts.push({
      type: 'yellow',
      icon: '📐',
      msg: `<strong>Baevsky SI surfaced, not trusted</strong> — Mode/MxDMn fell outside the plausible RR range after unit normalization. The Stress Index is shown but may be mis-scaled by the source file.`
    });
  else if (r.d_si_ms)
    alerts.push({
      type: 'blue',
      icon: '📐',
      msg: `<strong>Baevsky inputs normalized</strong> — Mode/MxDMn arrived in milliseconds and were converted to seconds before the Stress Index (unit-safe; SI/CSI agree with a seconds-unit file).`
    });
  if (r.d_vlf_pct > 50)
    alerts.push({
      type: 'yellow',
      icon: '🌊',
      msg: `<strong>VLF ${r.d_vlf_pct != null ? r.d_vlf_pct.toFixed(0) : undefined}% of total power</strong> — Dominant VLF may indicate slow regulatory stress or measurement artifact.`
    });
  if (r.d_ari < 0.85)
    alerts.push({
      type: 'yellow',
      icon: '📉',
      msg: `<strong>Recovery Index ${r.d_ari != null ? r.d_ari.toFixed(2) : undefined}</strong> — rMSSD significantly below 7-day baseline. Rest day indicated.`
    });
  if (r.d_sdnn_z < -1.5)
    alerts.push({
      type: 'yellow',
      icon: '📊',
      msg: `<strong>SDNN Z-score ${r.d_sdnn_z != null ? r.d_sdnn_z.toFixed(2) : undefined}</strong> — SDNN more than 1.5 SD below personal rolling baseline.`
    });
  if (r._coherence > 70 && r._energy > 55)
    alerts.push({ type: 'green', icon: '✅', msg: `<strong>Optimal Coherence + Energy</strong> — Coherence ${r._coherence}, Energy ${r._energy}. Excellent HRV regulation today.` });
  if (r.d_ari > 1.1)
    alerts.push({ type: 'green', icon: '🔋', msg: `<strong>Recovery above baseline</strong> — rMSSD ${(r.d_ari * 100 - 100).toFixed(0)}% above 7-day mean. Good day for higher intensity training.` });

  if (alerts.length) {
    panel.classList.add('show');
    panel.innerHTML = alerts.map((a) => `<div class="alert alert-${a.type}"><span class="alert-icon">${a.icon}</span><span>${a.msg}</span></div>`).join('');
  } else {
    panel.classList.remove('show');
    panel.innerHTML = '';
  }
}

/* ===== CHART HELPERS ===== */
const COLORS = {
  blue: 'rgba(61,158,255,',
  green: 'rgba(0,232,122,',
  red: 'rgba(255,79,94,',
  yellow: 'rgba(245,166,35,',
  purple: 'rgba(167,139,250,',
  orange: 'rgba(251,146,60,',
  teal: 'rgba(0,201,177,',
  cyan: 'rgba(34,211,238,'
};
function rgba(name, a) {
  return (COLORS[name] || 'rgba(88,166,255,') + a + ')';
}

/* Charts must paint reliably on first render — the Chart.js entrance animation
   depends on requestAnimationFrame, which is throttled on background/inactive
   tabs and during screenshot/PDF capture, leaving canvases blank. Disabling the
   internal animation guarantees an immediate, deterministic paint. The CSS
   card-entrance fade still gives the grid a lively reveal. */
if (window.Chart) {
  Chart.defaults.animation = false;
}

function mkChart(id, labels, datasets, opts = {}) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(canvas, {
    type: opts.type || 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      animation: { duration: 300 },
      plugins: { legend: { labels: { color: '#6e85a8', font: { size: 10 }, boxWidth: 12 } } },
      scales: {
        x: { ticks: { color: '#3d5070', maxTicksLimit: 8, font: { size: 9, family: 'JetBrains Mono' } }, grid: { color: 'rgba(30,45,66,0.6)' } },
        y: { ticks: { color: '#6e85a8', font: { size: 9, family: 'JetBrains Mono' } }, grid: { color: 'rgba(30,45,66,0.6)' }, ...(opts.yAxis || {}) },
        ...(opts.y2 ? { y2: { position: 'right', ticks: { color: '#6e85a8', font: { size: 9 } }, grid: { drawOnChartArea: false }, ...opts.y2 } } : {})
      },
      elements: { point: { radius: 2, hoverRadius: 4 }, line: { tension: 0.35 } },
      ...opts.extra
    }
  });
}

function barChart(id, labels, datasets, opts = {}) {
  opts.type = 'bar';
  mkChart(id, labels, datasets, opts);
}

/* ===== RENDER ALL CHARTS ===== */
function renderAllCharts(rows, sm) {
  const labs = rows.map((r) => r._date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }));
  const S = (k) =>
    smooth(
      rows.map((r) => r[k]),
      sm
    );
  const Sf = (fn) => smooth(rows.map(fn), sm);

  // OVERVIEW
  mkChart('ch_stressEnergy', labs, [
    { label: 'Stress', data: S('_stress'), borderColor: rgba('red', 1), backgroundColor: rgba('red', 0.1), fill: false },
    { label: 'Energy', data: S('_energy'), borderColor: rgba('green', 1), backgroundColor: rgba('green', 0.1), fill: false },
    { label: 'Divergence', data: Sf((r) => r.d_se_div), borderColor: rgba('yellow', 0.6), borderDash: [4, 2], fill: false }
  ]);
  mkChart('ch_hrv_sdnn', labs, [
    { label: 'HRV Score', data: S('_hrv'), borderColor: rgba('blue', 1), fill: false },
    { label: 'SDNN (ms)', data: S('_sdnn'), borderColor: rgba('purple', 1), fill: false }
  ]);
  mkChart(
    'ch_rmssd',
    labs,
    [
      { label: 'rMSSD (ms)', data: S('_rmssd'), borderColor: rgba('teal', 1), backgroundColor: rgba('teal', 0.1), fill: true },
      { label: 'ln(rMSSD)', data: Sf((r) => r.d_lnrmssd), borderColor: rgba('cyan', 1), fill: false, yAxisID: 'y2' }
    ],
    { y2: {} }
  );
  mkChart('ch_sns_psns', labs, [
    { label: 'SNS', data: S('_sns'), borderColor: rgba('red', 1), fill: false },
    { label: 'PSNS', data: S('_psns'), borderColor: rgba('green', 1), fill: false },
    { label: 'Coherence', data: S('_coherence'), borderColor: rgba('yellow', 0.8), borderDash: [3, 2], fill: false }
  ]);

  // OVERVIEW — tiered Advanced/Research graphs (Core/Advanced/Research disclosure)
  mkChart('ch_ov_lfhf', labs, [
    { label: 'LF/HF', data: Sf((r) => r.d_lfhf), borderColor: rgba('orange', 1), fill: false },
    { label: 'Lower opt (0.5)', data: rows.map(() => 0.5), borderColor: rgba('green', 0.4), borderDash: [4, 2], pointRadius: 0 },
    { label: 'Upper opt (2.0)', data: rows.map(() => 2.0), borderColor: rgba('green', 0.4), borderDash: [4, 2], pointRadius: 0 }
  ]);
  mkChart('ch_ov_si', labs, [{ label: 'Baevsky SI', data: Sf((r) => r.d_si), borderColor: rgba('orange', 1), backgroundColor: rgba('orange', 0.15), fill: true }]);
  mkChart('ch_ov_vei', labs, [
    { label: 'Vagal Efficiency (rMSSD/HR)', data: Sf((r) => r.d_vei), borderColor: rgba('blue', 1), fill: false },
    { label: 'Optimal 0.45', data: rows.map(() => 0.45), borderColor: rgba('green', 0.4), borderDash: [4, 2], pointRadius: 0 }
  ]);
  mkChart('ch_ov_dfa', labs, [
    { label: 'DFA α1 proxy', data: Sf((r) => r.d_dfa_proxy), borderColor: rgba('blue', 1), fill: false },
    { label: 'Overreaching threshold (0.75)', data: rows.map(() => 0.75), borderColor: rgba('red', 0.4), borderDash: [4, 2], pointRadius: 0 }
  ]);
  // ch_ov_age (Autonomic Age) + ch_ov_map (HRV→MAP) REMOVED 2026-06-23
  // (DEX-METRIC-REMOVAL-AUDIT 🔴 — population age-regression + cuffless BP from HRV).

  // TIME DOMAIN
  mkChart('ch_si', labs, [{ label: 'Baevsky SI', data: Sf((r) => r.d_si), borderColor: rgba('orange', 1), backgroundColor: rgba('orange', 0.15), fill: true }]);
  mkChart('ch_cv', labs, [{ label: 'CV %', data: Sf((r) => r.d_cv_calc), borderColor: rgba('cyan', 1), fill: false }]);
  mkChart('ch_rmssd_sdnn', labs, [
    { label: 'rMSSD/SDNN', data: Sf((r) => r.d_rmssd_sdnn), borderColor: rgba('purple', 1), fill: false },
    { label: 'Threshold 0.5', data: rows.map(() => 0.5), borderColor: rgba('yellow', 0.5), borderDash: [4, 2], pointRadius: 0 },
    { label: 'Threshold 0.9', data: rows.map(() => 0.9), borderColor: rgba('green', 0.5), borderDash: [4, 2], pointRadius: 0 }
  ]);
  mkChart('ch_mxdmn_meanrr', labs, [{ label: 'MxDMn/MeanRR', data: Sf((r) => r.d_mxdmn_meanrr), borderColor: rgba('blue', 1), fill: false }]);
  mkChart('ch_se_div', labs, [{ label: '|Stress−Energy|', data: Sf((r) => r.d_se_div), borderColor: rgba('yellow', 1), backgroundColor: rgba('yellow', 0.1), fill: true }]);
  mkChart('ch_lnrmssd', labs, [{ label: 'ln(rMSSD)', data: Sf((r) => r.d_lnrmssd), borderColor: rgba('teal', 1), backgroundColor: rgba('teal', 0.1), fill: true }]);

  // FREQ DOMAIN
  mkChart('ch_lfhf', labs, [
    { label: 'LF/HF', data: Sf((r) => r.d_lfhf), borderColor: rgba('orange', 1), fill: false },
    { label: 'Lower opt (0.5)', data: rows.map(() => 0.5), borderColor: rgba('green', 0.4), borderDash: [4, 2], pointRadius: 0 },
    { label: 'Upper opt (2.0)', data: rows.map(() => 2.0), borderColor: rgba('red', 0.4), borderDash: [4, 2], pointRadius: 0 }
  ]);
  mkChart('ch_lfhf_nu', labs, [
    { label: 'HFnu', data: Sf((r) => r.d_hfnu), borderColor: rgba('green', 1), fill: false },
    { label: 'LFnu', data: Sf((r) => r.d_lfnu), borderColor: rgba('red', 1), fill: false }
  ]);
  mkChart('ch_vlf_pct', labs, [
    { label: 'VLF%', data: Sf((r) => r.d_vlf_pct), borderColor: rgba('purple', 1), backgroundColor: rows.map((r) => (r.d_vlf_pct > 50 ? rgba('red', 0.3) : rgba('purple', 0.15))), fill: true }
  ]);
  mkChart('ch_svi', labs, [
    { label: 'Sympathovagal Index', data: Sf((r) => r.d_svi), borderColor: rgba('blue', 1), fill: false },
    { label: 'Zero (balanced)', data: rows.map(() => 0), borderColor: rgba('yellow', 0.4), borderDash: [4, 2], pointRadius: 0 }
  ]);
  mkChart('ch_spectral_ent', labs, [{ label: 'Spectral Entropy', data: Sf((r) => r.d_spectral_ent), borderColor: rgba('cyan', 1), fill: false }]);
  mkChart('ch_lfhf_total', labs, [{ label: '(LF+HF)/Total', data: Sf((r) => r.d_lfhf_totpow), borderColor: rgba('teal', 1), fill: false }]);

  // COMPOSITE
  mkChart('ch_ans_load', labs, [
    { label: 'ANS Load Score', data: Sf((r) => r.d_ans_load), borderColor: rgba('red', 1), backgroundColor: rows.map((r) => (r.d_ans_load > 2 ? rgba('red', 0.2) : rgba('orange', 0.1))), fill: true }
  ]);
  mkChart('ch_coh_energy', labs, [{ label: 'Coherence×Energy', data: Sf((r) => r.d_coh_energy), borderColor: rgba('green', 1), fill: false }]);
  mkChart('ch_pti', labs, [{ label: 'Parasympathetic Tone Index', data: Sf((r) => r.d_pti), borderColor: rgba('teal', 1), fill: false }]);
  mkChart('ch_incoherent_stress', labs, [{ label: 'Stress×(1/Coherence)', data: Sf((r) => r.d_incoherent_stress), borderColor: rgba('orange', 1), fill: false }]);
  mkChart('ch_vei', labs, [
    { label: 'Vagal Efficiency (rMSSD/HR)', data: Sf((r) => r.d_vei), borderColor: rgba('blue', 1), fill: false },
    { label: 'Optimal 0.45', data: rows.map(() => 0.45), borderColor: rgba('green', 0.4), borderDash: [4, 2], pointRadius: 0 }
  ]);
  mkChart('ch_sdi', labs, [
    { label: 'Sympathetic Dominance', data: Sf((r) => r.d_sdi), borderColor: rgba('red', 1), fill: false },
    { label: 'Balanced (1.0)', data: rows.map(() => 1.0), borderColor: rgba('yellow', 0.4), borderDash: [4, 2], pointRadius: 0 }
  ]);

  // ROLLING
  mkChart('ch_ari', labs, [
    { label: 'Recovery Index', data: Sf((r) => r.d_ari), borderColor: rgba('green', 1), backgroundColor: rows.map((r) => (r.d_ari > 1 ? rgba('green', 0.15) : rgba('red', 0.15))), fill: true },
    { label: 'Baseline (1.0)', data: rows.map(() => 1.0), borderColor: rgba('yellow', 0.6), borderDash: [4, 2], pointRadius: 0 }
  ]);
  mkChart('ch_sdnn_z', labs, [
    { label: 'SDNN Z-score', data: Sf((r) => r.d_sdnn_z), borderColor: rgba('blue', 1), backgroundColor: rows.map((r) => (r.d_sdnn_z < -1 ? rgba('red', 0.2) : rgba('blue', 0.1))), fill: true },
    { label: '+1 SD', data: rows.map(() => 1), borderColor: rgba('green', 0.4), borderDash: [4, 2], pointRadius: 0 },
    { label: '-1 SD', data: rows.map(() => -1), borderColor: rgba('red', 0.4), borderDash: [4, 2], pointRadius: 0 }
  ]);
  mkChart('ch_rmssd_rolling', labs, [
    { label: 'rMSSD (raw)', data: S('_rmssd'), borderColor: rgba('teal', 0.5), fill: false, borderDash: [2, 2] },
    { label: 'ln(rMSSD) 7d mean', data: Sf((r) => r.d_rmssd_rolling_ln), borderColor: rgba('cyan', 1), fill: false, borderWidth: 2 }
  ]);
  mkChart('ch_stress_auc', labs, [{ label: '7-day Stress AUC', data: Sf((r) => r.d_stress_auc), borderColor: rgba('orange', 1), backgroundColor: rgba('orange', 0.15), fill: true }]);
  mkChart('ch_rmssd_cv', labs, [{ label: '7d rMSSD CV%', data: Sf((r) => r.d_rmssd_cv7), borderColor: rgba('purple', 1), fill: false }]);
  mkChart('ch_stress_ac', labs, [
    { label: 'Stress Autocorrelation lag-1', data: Sf((r) => r.d_stress_ac), borderColor: rgba('yellow', 1), fill: false },
    { label: 'Zero', data: rows.map(() => 0), borderColor: rgba('yellow', 0.3), borderDash: [4, 2], pointRadius: 0 }
  ]);

  // POINCARÉ & TOICHI
  mkChart('ch_sd1_sd2', labs, [
    { label: 'SD1 (ms)', data: Sf((r) => r.d_sd1), borderColor: rgba('teal', 1), fill: false },
    { label: 'SD2 (ms)', data: Sf((r) => r.d_sd2), borderColor: rgba('purple', 1), fill: false }
  ]);
  mkChart('ch_sd1sd2_ratio', labs, [
    { label: 'SD1/SD2', data: Sf((r) => r.d_sd1_sd2), borderColor: rgba('cyan', 1), fill: false },
    { label: 'Lower opt (0.25)', data: rows.map(() => 0.25), borderColor: rgba('yellow', 0.4), borderDash: [4, 2], pointRadius: 0 },
    { label: 'Upper opt (0.35)', data: rows.map(() => 0.35), borderColor: rgba('green', 0.4), borderDash: [4, 2], pointRadius: 0 }
  ]);
  mkChart('ch_cvi', labs, [
    { label: 'CVI (Cardiac Vagal)', data: Sf((r) => r.d_cvi), borderColor: rgba('green', 1), backgroundColor: rgba('green', 0.1), fill: true },
    { label: 'Threshold 4.4', data: rows.map(() => 4.4), borderColor: rgba('green', 0.4), borderDash: [4, 2], pointRadius: 0 }
  ]);
  mkChart('ch_csi', labs, [
    { label: 'CSI (Cardiac Sympathetic)', data: Sf((r) => r.d_csi), borderColor: rgba('red', 1), backgroundColor: rgba('red', 0.1), fill: true },
    { label: 'Threshold 0.25', data: rows.map(() => 0.25), borderColor: rgba('yellow', 0.4), borderDash: [4, 2], pointRadius: 0 }
  ]);
  // CVI vs CSI scatter
  if (charts['ch_cvi_csi_scatter']) charts['ch_cvi_csi_scatter'].destroy();
  charts['ch_cvi_csi_scatter'] = new Chart(document.getElementById('ch_cvi_csi_scatter'), {
    type: 'scatter',
    data: {
      datasets: [{ label: 'CVI vs CSI', data: rows.map((r) => ({ x: r.d_csi, y: r.d_cvi })), backgroundColor: rows.map((r) => (r.d_abs > 0 ? rgba('green', 0.7) : rgba('red', 0.7))), pointRadius: 4 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { labels: { color: '#6e85a8', font: { size: 10 } } } },
      scales: {
        x: { title: { display: true, text: 'CSI (Sympathetic →)', color: '#6e85a8' }, ticks: { color: '#3d5070' }, grid: { color: 'rgba(48,54,61,0.5)' } },
        y: { title: { display: true, text: 'CVI (Vagal ↑)', color: '#6e85a8' }, ticks: { color: '#6e85a8' }, grid: { color: 'rgba(48,54,61,0.5)' } }
      }
    }
  });
  mkChart(
    'ch_dfa_plaw',
    labs,
    [
      { label: 'DFA α1 proxy', data: Sf((r) => r.d_dfa_proxy), borderColor: rgba('blue', 1), fill: false },
      { label: 'Overreaching threshold (0.75)', data: rows.map(() => 0.75), borderColor: rgba('red', 0.4), borderDash: [4, 2], pointRadius: 0 },
      { label: 'Power Law Slope', data: Sf((r) => r.d_plaw), borderColor: rgba('yellow', 0.8), fill: false, yAxisID: 'y2' }
    ],
    { y2: {} }
  );
  // ch_auto_age (Autonomic Age) REMOVED 2026-06-23 (DEX-METRIC-REMOVAL-AUDIT 🔴).
  mkChart(
    'ch_vlf_hf_sai',
    labs,
    [
      { label: 'VLF/HF', data: Sf((r) => r.d_vlf_hf), borderColor: rgba('purple', 1), fill: false },
      { label: 'Threshold >3', data: rows.map(() => 3), borderColor: rgba('red', 0.4), borderDash: [4, 2], pointRadius: 0 },
      { label: 'Spectral Asym.', data: Sf((r) => r.d_sai), borderColor: rgba('cyan', 0.8), fill: false, yAxisID: 'y2' }
    ],
    { y2: {} }
  );
  mkChart('ch_cai', labs, [
    { label: 'CAI √(SD1×SD2)', data: Sf((r) => r.d_cai), borderColor: rgba('green', 1), backgroundColor: rgba('green', 0.1), fill: true },
    { label: 'Good (45)', data: rows.map(() => 45), borderColor: rgba('green', 0.4), borderDash: [4, 2], pointRadius: 0 },
    { label: 'Suppressed (30)', data: rows.map(() => 30), borderColor: rgba('red', 0.4), borderDash: [4, 2], pointRadius: 0 }
  ]);

  // COGNITIVE & RESILIENCE
  mkChart('ch_efc', labs, [
    { label: 'EFC Readiness', data: Sf((r) => r.d_efc), borderColor: rgba('green', 1), backgroundColor: rgba('green', 0.1), fill: true },
    { label: 'Good threshold (0.55)', data: rows.map(() => 0.55), borderColor: rgba('green', 0.4), borderDash: [4, 2], pointRadius: 0 }
  ]);
  mkChart('ch_crs', labs, [{ label: 'Cardiac Resilience Score', data: Sf((r) => r.d_crs), borderColor: rgba('teal', 1), fill: false }]);
  mkChart('ch_abs', labs, [
    { label: 'Autonomic Balance Score', data: Sf((r) => r.d_abs), borderColor: rgba('blue', 1), backgroundColor: rows.map((r) => (r.d_abs > 0 ? rgba('green', 0.15) : rgba('red', 0.15))), fill: true },
    { label: 'Balanced (0)', data: rows.map(() => 0), borderColor: rgba('yellow', 0.4), borderDash: [4, 2], pointRadius: 0 }
  ]);
  mkChart('ch_sfd', labs, [
    {
      label: 'Stress-Focus Dissociation',
      data: Sf((r) => r.d_sfd),
      borderColor: rgba('yellow', 1),
      backgroundColor: rows.map((r) => (r.d_sfd > 15 ? rgba('red', 0.2) : rgba('yellow', 0.1))),
      fill: true
    },
    { label: 'Zero', data: rows.map(() => 0), borderColor: rgba('yellow', 0.3), borderDash: [4, 2], pointRadius: 0 }
  ]);
  mkChart('ch_focus_eff', labs, [{ label: 'Focus Efficiency', data: Sf((r) => r.d_focus_eff), borderColor: rgba('cyan', 1), fill: false }]);
  mkChart('ch_pns_eff', labs, [{ label: 'PNS Efficiency', data: Sf((r) => r.d_pns_eff), borderColor: rgba('purple', 1), fill: false }]);
  mkChart('ch_otr', labs, [
    {
      label: 'OTR Index (capped 500)',
      data: Sf((r) => r.d_otr),
      borderColor: rgba('orange', 1),
      backgroundColor: rows.map((r) => (r.d_otr > 15 ? rgba('red', 0.2) : rgba('orange', 0.1))),
      fill: true,
      pointBackgroundColor: rows.map((r) => (r.d_otr_sat ? rgba('red', 1) : rgba('orange', 1))),
      pointRadius: rows.map((r) => (r.d_otr_sat ? 6 : 2))
    },
    { label: 'Caution (15)', data: rows.map(() => 15), borderColor: rgba('red', 0.4), borderDash: [4, 2], pointRadius: 0 },
    { label: 'Saturated (500)', data: rows.map(() => 500), borderColor: rgba('red', 0.2), borderDash: [2, 4], pointRadius: 0 }
  ]);
  mkChart('ch_rmssd_circ', labs, [
    { label: 'rMSSD Raw', data: S('_rmssd'), borderColor: rgba('teal', 0.5), fill: false, borderDash: [3, 2] },
    { label: 'rMSSD Circadian-Adj.', data: Sf((r) => r.d_rmssd_circ), borderColor: rgba('teal', 1), fill: false, borderWidth: 2 }
  ]);
  mkChart(
    'ch_rsa_nn50',
    labs,
    [
      { label: 'RSA Proxy', data: Sf((r) => r.d_rsa), borderColor: rgba('blue', 1), fill: false },
      { label: 'NN50 estimate', data: Sf((r) => r.d_nn50), borderColor: rgba('green', 0.8), fill: false, yAxisID: 'y2' }
    ],
    { y2: {} }
  );

  // VO2MAX & BP CHARTS
  // VO2max trend
  mkChart('ch_vo2_trend', labs, [
    { label: 'VO2 Base (HR only)', data: S('d_vo2_base'), borderColor: rgba('blue', 0.6), borderDash: [3, 2], fill: false, pointRadius: 2 },
    { label: 'VO2 HRV-adj', data: S('d_vo2_hrv'), borderColor: rgba('green', 1), fill: false, borderWidth: 2 },
    { label: '7d Rolling Avg', data: S('d_vo2_roll7'), borderColor: rgba('cyan', 1), fill: false, borderDash: [5, 2], borderWidth: 2 },
    { label: 'VO₂ Ground Truth', data: rows.map(() => getProfile().vo2gt), borderColor: rgba('yellow', 0.7), borderDash: [6, 3], pointRadius: 0, borderWidth: 1 },
    { label: 'Excellent threshold (45)', data: rows.map(() => 45), borderColor: rgba('teal', 0.4), borderDash: [2, 4], pointRadius: 0, borderWidth: 1 }
  ]);
  // VO2max delta
  mkChart('ch_vo2_delta', labs, [
    {
      label: 'Delta from ground truth',
      data: S('d_vo2_delta'),
      borderColor: rgba('blue', 1),
      backgroundColor: rows.map((r) => (r.d_vo2_delta > 3 ? rgba('green', 0.25) : r.d_vo2_delta < -3 ? rgba('red', 0.25) : rgba('yellow', 0.15))),
      fill: true
    },
    { label: '+3 band', data: rows.map(() => 3), borderColor: rgba('green', 0.4), borderDash: [4, 2], pointRadius: 0 },
    { label: '-3 band', data: rows.map(() => -3), borderColor: rgba('red', 0.4), borderDash: [4, 2], pointRadius: 0 },
    { label: 'Zero', data: rows.map(() => 0), borderColor: rgba('yellow', 0.5), borderDash: [6, 2], pointRadius: 0 }
  ]);
  // VO2 vs HR scatter
  if (charts['ch_vo2_hr_scatter']) charts['ch_vo2_hr_scatter'].destroy();
  charts['ch_vo2_hr_scatter'] = new Chart(document.getElementById('ch_vo2_hr_scatter'), {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'HR vs VO2',
          data: rows.map((r) => ({ x: r._hr, y: r.d_vo2_hrv, label: r._date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) })),
          backgroundColor: rows.map((r) => (r._stress > 65 ? rgba('red', 0.75) : r._stress > 45 ? rgba('yellow', 0.75) : rgba('green', 0.75))),
          pointRadius: 5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { labels: { color: '#6e85a8', font: { size: 10 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const d = ctx.raw;
              return (d.label || '') + ' HR:' + d.x + ' VO2:' + d.y.toFixed(1);
            }
          }
        }
      },
      scales: {
        x: { title: { display: true, text: 'Resting HR (bpm)', color: '#6e85a8' }, ticks: { color: '#3d5070' }, grid: { color: 'rgba(48,54,61,0.5)' } },
        y: { title: { display: true, text: 'VO2max estimate', color: '#6e85a8' }, ticks: { color: '#6e85a8' }, grid: { color: 'rgba(48,54,61,0.5)' } }
      }
    }
  });
  // rMSSD modifier %
  mkChart('ch_vo2_rmssd_mod', labs, [
    {
      label: 'rMSSD modifier (%)',
      data: rows.map((r) => (!isNaN(r.d_vo2_hrv) && !isNaN(r.d_vo2_base) && r.d_vo2_base > 0 ? (r.d_vo2_hrv / r.d_vo2_base - 1) * 100 : NaN)),
      borderColor: rgba('purple', 1),
      backgroundColor: rows.map((r) => {
        const pct = !isNaN(r.d_vo2_hrv) && !isNaN(r.d_vo2_base) && r.d_vo2_base > 0 ? (r.d_vo2_hrv / r.d_vo2_base - 1) * 100 : 0;
        return pct >= 0 ? rgba('green', 0.2) : rgba('red', 0.2);
      }),
      fill: true
    },
    { label: 'Zero', data: rows.map(() => 0), borderColor: rgba('yellow', 0.4), borderDash: [4, 2], pointRadius: 0 }
  ]);

  // BP CHARTS REMOVED 2026-06-21 (external-review WP-A) — cuffless BP from HRV is
  // indefensible; the six ch_sbp_*/ch_bp_* builders + their canvases were deleted.

  // CLINICAL
  mkChart('ch_bap', labs, [
    { label: 'Baevsky Adaptation Potential (partial)', data: Sf((r) => r.d_bap), borderColor: rgba('orange', 1), fill: false },
    { label: 'Good threshold (2.1)', data: rows.map(() => 2.1), borderColor: rgba('green', 0.4), borderDash: [4, 2], pointRadius: 0 }
  ]);
  mkChart('ch_ortho', labs, [{ label: 'Orthostatic Load (HR/SDNN)', data: Sf((r) => r.d_ortho), borderColor: rgba('red', 1), fill: false }]);
  mkChart('ch_pnn50_slope', labs, [
    {
      label: 'pNN50 7d slope',
      data: Sf((r) => r.d_pnn50_slope),
      borderColor: rgba('cyan', 1),
      backgroundColor: rows.map((r) => (r.d_pnn50_slope < 0 ? rgba('red', 0.2) : rgba('green', 0.15))),
      fill: true
    },
    { label: 'Zero', data: rows.map(() => 0), borderColor: rgba('yellow', 0.4), borderDash: [4, 2], pointRadius: 0 }
  ]);
  // New v2.5 rolling charts
  mkChart('ch_hrv_momentum', labs, [
    {
      label: 'HRV Momentum (14d slope)',
      data: Sf((r) => r.d_hrv_momentum),
      borderColor: rgba('teal', 1),
      backgroundColor: rows.map((r) => (!isNaN(r.d_hrv_momentum) && r.d_hrv_momentum > 0 ? rgba('green', 0.15) : rgba('red', 0.15))),
      fill: true
    },
    { label: 'Zero', data: rows.map(() => 0), borderColor: rgba('yellow', 0.4), borderDash: [4, 2], pointRadius: 0 }
  ]);
  mkChart('ch_welfare', labs, [
    { label: 'Welfare Index', data: Sf((r) => r.d_welfare), borderColor: rgba('blue', 1), fill: false },
    { label: 'Good (40)', data: rows.map(() => 40), borderColor: rgba('green', 0.4), borderDash: [4, 2], pointRadius: 0 },
    { label: 'Warn (20)', data: rows.map(() => 20), borderColor: rgba('yellow', 0.4), borderDash: [4, 2], pointRadius: 0 }
  ]);
  barChart(
    'ch_recovery_debt',
    labs,
    [
      {
        label: 'Recovery Debt (days)',
        data: rows.map((r) => r.d_recovery_debt || 0),
        backgroundColor: rows.map((r) => ((r.d_recovery_debt || 0) < 3 ? rgba('green', 0.6) : (r.d_recovery_debt || 0) < 7 ? rgba('yellow', 0.6) : rgba('red', 0.6))),
        borderColor: rows.map((r) => ((r.d_recovery_debt || 0) < 3 ? rgba('green', 1) : (r.d_recovery_debt || 0) < 7 ? rgba('yellow', 1) : rgba('red', 1))),
        borderWidth: 1
      }
    ],
    { type: 'bar' }
  );
  mkChart('ch_rmssd_reactivity', labs, [
    {
      label: 'rMSSD Δ% (daily)',
      data: Sf((r) => r.d_rmssd_delta_pct),
      borderColor: rgba('orange', 1),
      backgroundColor: rows.map((r) => (!isNaN(r.d_rmssd_delta_pct) && r.d_rmssd_delta_pct > 0 ? rgba('green', 0.15) : rgba('red', 0.15))),
      fill: true
    },
    { label: 'Zero', data: rows.map(() => 0), borderColor: rgba('yellow', 0.4), borderDash: [4, 2], pointRadius: 0 }
  ]);
  // High-stress/low-energy bar
  const monthly = {};
  rows.forEach((r) => {
    const mo = r._date.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    monthly[mo] = (monthly[mo] || 0) + r.d_hile;
  });
  barChart('ch_hile', Object.keys(monthly), [{ label: 'High-Stress/Low-Energy Days', data: Object.values(monthly), backgroundColor: rgba('red', 0.6), borderColor: rgba('red', 1), borderWidth: 1 }], {
    type: 'bar'
  });

  // DISTRIBUTIONS & PATTERNS tab (histograms, weekday rhythm, correlation explorer + matrix)
  if (typeof renderPatterns === 'function') {
    try {
      renderPatterns();
    } catch (e) {
      console.warn('Patterns render failed:', e);
    }
  }
}

/* ===== DISTRIBUTIONS & PATTERNS ===== */
// Curated metric registry for the pickers (raw + derived). Each is a column on the row object.
const PATTERN_METRICS = [
  { key: '_rmssd', label: 'rMSSD (ms)' },
  { key: '_sdnn', label: 'SDNN (ms)' },
  { key: '_hr', label: 'Resting HR (bpm)' },
  { key: '_stress', label: 'Stress' },
  { key: '_energy', label: 'Energy' },
  { key: 'd_lnrmssd', label: 'ln(rMSSD)' },
  { key: 'd_lfhf', label: 'LF/HF' },
  { key: 'd_hfnu', label: 'HFnu (%)' },
  { key: 'd_si', label: 'Baevsky SI' },
  { key: 'd_sd1', label: 'SD1 (ms)' },
  { key: 'd_sd2', label: 'SD2 (ms)' },
  { key: 'd_cvi', label: 'CVI' },
  { key: 'd_csi', label: 'CSI' },
  { key: 'd_ans_load', label: 'ANS Load' },
  { key: 'd_vei', label: 'Vagal Efficiency' },
  { key: 'd_ari', label: 'Recovery Index' },
  { key: 'd_spectral_ent', label: 'Spectral Entropy' },
  { key: 'd_cai', label: 'CAI' },
  { key: 'd_vo2_hrv', label: 'VO₂max (HRV-adj)' }
];
// Smaller subset for the heatmap so the matrix stays readable
const HEATMAP_METRICS = ['_rmssd', '_sdnn', '_hr', '_stress', '_energy', 'd_lfhf', 'd_si', 'd_cvi', 'd_csi', 'd_ans_load', 'd_vo2_hrv'];

function _patMean(a) {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;
}
function _patMedian(a) {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function _patStd(a) {
  if (a.length < 2) return NaN;
  const m = _patMean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
}
function _patVals(rows, key) {
  return rows.map((r) => r[key]).filter((v) => typeof v === 'number' && isFinite(v));
}
function _patLabel(key) {
  const m = PATTERN_METRICS.find((x) => x.key === key);
  return m ? m.label : key;
}
function _patShort(key) {
  return _patLabel(key).replace(/\s*\(.*\)/, '');
}
function _patPearson(xs, ys) {
  const px = [],
    py = [];
  // FOLLOWUPS-II §1: Number.isFinite (not global isFinite) so a null pair-member is dropped, not coerced to 0.
  // renderHeatmap feeds RAW nullable series here (rows.map(r=>r[k]) over HEATMAP_METRICS incl. _rmssd/_sdnn/_hr),
  // so isFinite(null)===true would let a blank cell enter as 0 and bias r. Scatter pre-filters → no-op there.
  for (let i = 0; i < xs.length; i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
      px.push(xs[i]);
      py.push(ys[i]);
    }
  }
  const n = px.length;
  if (n < 3) return { r: NaN, n };
  const mx = _patMean(px),
    my = _patMean(py);
  let num = 0,
    dx = 0,
    dy = 0;
  for (let i = 0; i < n; i++) {
    const a = px[i] - mx,
      b = py[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return { r: den ? num / den : NaN, n };
}
function _patFillSelect(sel, defKey) {
  if (!sel) return;
  if (!sel.dataset.filled) {
    sel.innerHTML = PATTERN_METRICS.map((m) => '<option value="' + m.key + '">' + m.label + '</option>').join('');
    sel.value = defKey;
    sel.dataset.filled = '1';
  }
}

function renderHistogram() {
  const rows = getFilteredRows();
  if (!rows.length) return;
  const sel = document.getElementById('histMetric');
  _patFillSelect(sel, '_rmssd');
  const key = sel ? sel.value : '_rmssd';
  const sub = document.getElementById('histStats');
  const vals = _patVals(rows, key);
  if (vals.length < 2) {
    if (sub) sub.textContent = 'not enough data';
    if (charts['ch_hist']) charts['ch_hist'].destroy();
    return;
  }
  const min = Math.min(...vals),
    max = Math.max(...vals);
  const nb = Math.min(14, Math.max(6, Math.round(Math.sqrt(vals.length))));
  const w = (max - min) / nb || 1;
  const bins = new Array(nb).fill(0);
  vals.forEach((v) => {
    let i = Math.floor((v - min) / w);
    if (i >= nb) i = nb - 1;
    if (i < 0) i = 0;
    bins[i]++;
  });
  const dec = max - min < 10 ? 1 : 0;
  const labels = bins.map((_, i) => (min + i * w).toFixed(dec));
  const mean = _patMean(vals),
    med = _patMedian(vals),
    sd = _patStd(vals);
  if (sub) sub.innerHTML = 'μ ' + mean.toFixed(1) + ' · median ' + med.toFixed(1) + ' · σ ' + sd.toFixed(1) + ' · n ' + vals.length;
  barChart(
    'ch_hist',
    labels,
    [{ label: _patLabel(key) + ' frequency', data: bins, backgroundColor: rgba('teal', 0.5), borderColor: rgba('teal', 1), borderWidth: 1, barPercentage: 1.0, categoryPercentage: 0.97 }],
    { yAxis: { title: { display: true, text: 'days', color: '#6e85a8', font: { size: 9 } } } }
  );
}

function renderScatterExplorer() {
  const rows = getFilteredRows();
  if (!rows.length) return;
  const selX = document.getElementById('corrX'),
    selY = document.getElementById('corrY');
  _patFillSelect(selX, '_rmssd');
  _patFillSelect(selY, '_sdnn');
  const kx = selX ? selX.value : '_rmssd',
    ky = selY ? selY.value : '_sdnn';
  // FOLLOWUPS-II §1: Number.isFinite drops a null (blank transparent cell) instead of plotting it as a
  // (0,y) point; global isFinite(null)===true would drag the cloud + Pearson r toward the axes. A real 0 is kept.
  const pts = rows.map((r) => ({ x: r[kx], y: r[ky] })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const { r, n } = _patPearson(
    pts.map((p) => p.x),
    pts.map((p) => p.y)
  );
  const sub = document.getElementById('corrStats');
  if (sub) {
    if (isFinite(r)) {
      const strength = Math.abs(r) > 0.7 ? 'strong' : Math.abs(r) > 0.4 ? 'moderate' : Math.abs(r) > 0.2 ? 'weak' : 'negligible';
      const col = Math.abs(r) > 0.4 ? (r > 0 ? 'var(--status-ok)' : 'var(--status-concern)') : 'var(--text2)';
      sub.innerHTML = 'Pearson r = <strong style="color:' + col + '">' + r.toFixed(2) + '</strong> · ' + strength + (r < 0 ? ' (inverse)' : '') + ' · n ' + n;
    } else sub.textContent = 'not enough paired data';
  }
  if (charts['ch_corr']) charts['ch_corr'].destroy();
  const cv = document.getElementById('ch_corr');
  if (!cv) return;
  charts['ch_corr'] = new Chart(cv, {
    type: 'scatter',
    data: { datasets: [{ label: _patShort(kx) + ' vs ' + _patShort(ky), data: pts, backgroundColor: rgba('cyan', 0.6), borderColor: rgba('cyan', 1), pointRadius: 4, pointHoverRadius: 6 }] },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      animation: { duration: 300 },
      plugins: { legend: { labels: { color: '#6e85a8', font: { size: 10 } } } },
      scales: {
        x: { title: { display: true, text: _patLabel(kx), color: '#6e85a8', font: { size: 10 } }, ticks: { color: '#3d5070', font: { size: 9 } }, grid: { color: 'rgba(30,45,66,0.6)' } },
        y: { title: { display: true, text: _patLabel(ky), color: '#6e85a8', font: { size: 10 } }, ticks: { color: '#6e85a8', font: { size: 9 } }, grid: { color: 'rgba(30,45,66,0.6)' } }
      }
    }
  });
}

const PATTERN_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function renderWeekday() {
  const rows = getFilteredRows();
  if (!rows.length) return;
  const sel = document.getElementById('wdMetric');
  _patFillSelect(sel, '_rmssd');
  const key = sel ? sel.value : '_rmssd';
  const buckets = PATTERN_WEEKDAYS.map(() => []);
  // FOLLOWUPS-II §1: a blank transparent cell is null; isFinite(null)===true would push it as a 0 and
  // deflate that weekday's average. typeof-number drops null/NaN but keeps a genuine 0 (e.g. pNN50).
  rows.forEach((r) => {
    const v = r[key];
    if (!(typeof v === 'number' && isFinite(v))) return;
    let d = r._date.getUTCDay();
    d = (d + 6) % 7;
    buckets[d].push(v);
  });
  const avgs = buckets.map((b) => (b.length ? _patMean(b) : NaN));
  const sub = document.getElementById('wdStats');
  const finite = avgs.filter(isFinite);
  if (sub) {
    if (finite.length >= 2) {
      let hi = -Infinity,
        lo = Infinity,
        hiD = '',
        loD = '';
      avgs.forEach((v, i) => {
        if (isFinite(v)) {
          if (v > hi) {
            hi = v;
            hiD = PATTERN_WEEKDAYS[i];
          }
          if (v < lo) {
            lo = v;
            loD = PATTERN_WEEKDAYS[i];
          }
        }
      });
      sub.innerHTML =
        'highest <strong style="color:var(--status-ok)">' + hiD + '</strong> (' + hi.toFixed(1) + ') · lowest <strong style="color:var(--status-concern)">' + loD + '</strong> (' + lo.toFixed(1) + ')';
    } else sub.textContent = 'not enough data';
  }
  barChart(
    'ch_weekday',
    PATTERN_WEEKDAYS,
    [
      {
        label: 'Avg ' + _patLabel(key),
        data: avgs.map((v) => (isFinite(v) ? +v.toFixed(2) : null)),
        backgroundColor: PATTERN_WEEKDAYS.map((_, i) => (i >= 5 ? rgba('purple', 0.55) : rgba('blue', 0.55))),
        borderColor: PATTERN_WEEKDAYS.map((_, i) => (i >= 5 ? rgba('purple', 1) : rgba('blue', 1))),
        borderWidth: 1
      }
    ],
    { yAxis: {} }
  );
}

function _patHeatColor(r) {
  if (!isFinite(r)) return 'rgba(120,140,170,0.05)';
  const a = Math.min(1, Math.abs(r));
  return r >= 0 ? 'rgba(0,201,177,' + (0.1 + 0.8 * a).toFixed(3) + ')' : 'rgba(255,79,94,' + (0.1 + 0.8 * a).toFixed(3) + ')';
}
function renderHeatmap() {
  const el = document.getElementById('corrHeatmap');
  if (!el) return;
  const rows = getFilteredRows();
  if (!rows.length) {
    el.innerHTML = '';
    return;
  }
  const keys = HEATMAP_METRICS;
  const series = keys.map((k) => rows.map((r) => r[k]));
  const n = keys.length;
  let html = '<table class="heatmap"><thead><tr><th></th>';
  keys.forEach((k) => (html += '<th><span>' + _patShort(k) + '</span></th>'));
  html += '</tr></thead><tbody>';
  for (let i = 0; i < n; i++) {
    html += '<tr><th>' + _patShort(keys[i]) + '</th>';
    for (let j = 0; j < n; j++) {
      const res = i === j ? { r: 1 } : _patPearson(series[i], series[j]);
      const r = res.r;
      let txt = '';
      if (isFinite(r)) txt = i === j ? '1' : r.toFixed(2).replace(/^0\./, '.').replace(/^-0\./, '-.');
      const tc = isFinite(r) && Math.abs(r) > 0.55 ? '#fff' : 'var(--text2)';
      html +=
        '<td title="' +
        _patShort(keys[i]) +
        ' ↔ ' +
        _patShort(keys[j]) +
        ': r=' +
        (isFinite(r) ? r.toFixed(2) : 'n/a') +
        '" style="background:' +
        _patHeatColor(r) +
        ';color:' +
        tc +
        '">' +
        txt +
        '</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  el.innerHTML = html;
}

function renderPatterns() {
  renderHistogram();
  renderScatterExplorer();
  renderWeekday();
  renderHeatmap();
}

/* ===== TABLE ===== */
const TABLE_COLS = [
  { key: '_date', label: 'Date', fmt: (v) => (v instanceof Date ? v.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' }) : '') },
  { key: 'd_cv_calc', label: 'CV%', fmt: (v) => fmt1(v) + '%', color: (v) => (v > 7 ? 'green' : v > 4 ? 'yellow' : 'red') },
  { key: '_stress', label: 'Stress', fmt: (v) => fmt1(v), color: (v) => (v > 65 ? 'red' : v > 45 ? 'yellow' : 'green') },
  { key: '_energy', label: 'Energy', fmt: (v) => fmt1(v), color: (v) => (v < 35 ? 'red' : v < 55 ? 'yellow' : 'green') },
  { key: '_sdnn', label: 'SDNN', fmt: (v) => fmt1(v) + 'ms' },
  { key: '_rmssd', label: 'rMSSD', fmt: (v) => fmt1(v) + 'ms' },
  { key: 'd_lnrmssd', label: 'ln(rMSSD)', fmt: (v) => fmt2(v) },
  { key: 'd_si', label: 'Baevsky SI', fmt: (v) => fmt0(v), color: (v) => (v < 150 ? 'green' : v < 250 ? 'yellow' : 'red') },
  { key: 'd_rmssd_sdnn', label: 'rMSSD/SDNN', fmt: (v) => fmt2(v) },
  { key: 'd_lfhf', label: 'LF/HF', fmt: (v) => fmt2(v), color: (v) => (v > 0.4 && v < 2.5 ? 'green' : 'yellow') },
  { key: 'd_hfnu', label: 'HFnu', fmt: (v) => fmt1(v) + '%' },
  { key: 'd_lfnu', label: 'LFnu', fmt: (v) => fmt1(v) + '%' },
  { key: 'd_vlf_pct', label: 'VLF%', fmt: (v) => fmt1(v) + '%', color: (v) => (v > 50 ? 'red' : v > 35 ? 'yellow' : 'green') },
  { key: 'd_svi', label: 'SVI', fmt: (v) => fmt2(v) },
  { key: 'd_spectral_ent', label: 'SpectralEnt', fmt: (v) => fmt3(v) },
  { key: 'd_ans_load', label: 'ANS Load', fmt: (v) => fmt2(v), color: (v) => (v < 1 ? 'green' : v < 2 ? 'yellow' : 'red') },
  { key: 'd_vei', label: 'VEI', fmt: (v) => fmt2(v), color: (v) => (v > 0.45 ? 'green' : v > 0.3 ? 'yellow' : 'red') },
  { key: 'd_pti', label: 'PTI', fmt: (v) => fmt2(v) },
  { key: 'd_ari', label: 'Recov Index', fmt: (v) => fmt2(v), color: (v) => (v > 1.0 ? 'green' : v > 0.85 ? 'yellow' : 'red') },
  { key: 'd_sdnn_z', label: 'SDNN Z', fmt: (v) => fmt2(v), color: (v) => (v > -0.5 ? 'green' : v > -1.5 ? 'yellow' : 'red') },
  { key: 'd_stress_auc', label: 'Stress AUC 7d', fmt: (v) => fmt0(v) },
  { key: 'd_rmssd_cv7', label: 'rMSSD CV%', fmt: (v) => fmt1(v) + '%' },
  { key: 'd_bap', label: 'BAP (full)', fmt: (v) => fmt2(v), color: (v) => (v < 2.1 ? 'green' : v < 2.6 ? 'yellow' : 'red') },
  { key: 'd_hile', label: '⚑ Hi-Stress', fmt: (v) => (v ? '<span class="pill pill-red">YES</span>' : '<span class="pill pill-gray">—</span>'), noColor: true },
  { key: 'd_sd1', label: 'SD1 (ms)', fmt: (v) => fmt1(v) },
  { key: 'd_sd2', label: 'SD2 (ms)', fmt: (v) => fmt1(v) },
  { key: 'd_sd1_sd2', label: 'SD1/SD2', fmt: (v) => fmt3(v), color: (v) => (v > 0.2 && v < 0.5 ? 'green' : v > 0.15 ? 'yellow' : 'red') },
  { key: 'd_cvi', label: 'CVI', fmt: (v) => fmt2(v), color: (v) => (v > 4.4 ? 'green' : v > 4.1 ? 'yellow' : 'red') },
  { key: 'd_csi', label: 'CSI', fmt: (v) => fmt3(v), color: (v) => (v < 0.25 ? 'green' : v < 0.4 ? 'yellow' : 'red') },
  { key: 'd_abs', label: 'ABS', fmt: (v) => fmt3(v) },
  { key: 'd_efc', label: 'EFC', fmt: (v) => fmt3(v), color: (v) => (v > 0.55 ? 'green' : v > 0.4 ? 'yellow' : 'red') },
  { key: 'd_crs', label: 'Resilience', fmt: (v) => fmt4(v) },
  { key: 'd_sfd', label: 'Stress-Focus Δ', fmt: (v) => fmt1(v) },
  { key: 'd_focus_eff', label: 'Focus Eff', fmt: (v) => fmt3(v) },
  { key: 'd_otr', label: 'OTR Index', fmt: (v) => fmt1(v), color: (v) => (v < 5 ? 'green' : v < 15 ? 'yellow' : 'red') },
  { key: 'd_rmssd_circ', label: 'rMSSD Circ.Adj', fmt: (v) => fmt1(v) + 'ms' },
  { key: 'd_nn50', label: 'NN50 est.', fmt: (v) => fmt0(v) },
  /* d_auto_age (Auto Age) row REMOVED 2026-06-23 (DEX-METRIC-REMOVAL-AUDIT 🔴) */
  { key: 'd_dfa_proxy', label: 'DFA α1~', fmt: (v) => fmt3(v), color: (v) => (v > 0.85 ? 'green' : v > 0.75 ? 'yellow' : 'red') },
  { key: 'd_plaw', label: 'Power Slope', fmt: (v) => fmt3(v) },
  { key: 'd_vlf_hf', label: 'VLF/HF', fmt: (v) => fmt2(v), color: (v) => (v < 2 ? 'green' : v < 3 ? 'yellow' : 'red') },
  { key: 'd_sai', label: 'Spec.Asym', fmt: (v) => fmt3(v) },
  { key: 'd_pns_eff', label: 'PNS Eff', fmt: (v) => (isNaN(v) ? '—' : fmt2(v)), color: (v) => (v < 4 ? 'green' : v < 7 ? 'yellow' : 'red') },
  { key: 'd_rsa', label: 'RSA Proxy', fmt: (v) => fmt1(v) },
  { key: 'd_vo2_base', label: 'VO2 Base', fmt: (v) => fmt1(v) },
  { key: 'd_vo2_hrv', label: 'VO2 HRV-adj', fmt: (v) => fmt1(v), color: (v) => (v >= 45 ? 'green' : v >= 41 ? 'yellow' : 'red') },
  { key: 'd_vo2_roll7', label: 'VO2 7d Avg', fmt: (v) => fmt1(v) },
  { key: 'd_vo2_delta', label: 'VO2 Delta GT', fmt: (v) => (isNaN(v) ? '—' : (v > 0 ? '+' : '') + fmt1(v)) },
  { key: 'd_vo2_cat', label: 'VO2 Category', fmt: (v) => v || '—' },
  { key: 'd_sbp_est', label: 'SBP Est', fmt: (v) => fmt0(v) + 'mmHg', color: (v) => (v < 122 ? 'green' : v < 130 ? 'yellow' : 'red') },
  { key: 'd_dbp_est', label: 'DBP Est', fmt: (v) => fmt0(v) + 'mmHg', color: (v) => (v < 80 ? 'green' : v < 85 ? 'yellow' : 'red') },
  { key: 'd_sbp_lo', label: 'SBP Lo', fmt: (v) => fmt0(v) },
  { key: 'd_sbp_hi', label: 'SBP Hi', fmt: (v) => fmt0(v) },
  {
    key: 'd_bp_risk',
    label: 'BP Risk',
    fmt: (v) => {
      if (!v || v === '—') return '—';
      const c = v === 'Normal' ? 'green' : v === 'Borderline' ? 'yellow' : 'red';
      return '<span class="pill pill-' + c + '">' + v + '</span>';
    }
  },
  { key: 'd_delta_sbp', label: 'dSBP', fmt: (v) => (isNaN(v) ? '—' : (v > 0 ? '+' : '') + fmt1(v)) },
  { key: 'd_cai', label: 'CAI (ms)', fmt: (v) => fmt1(v), color: (v) => (v > 45 ? 'green' : v > 30 ? 'yellow' : 'red') },
  { key: 'd_welfare', label: 'Welfare Idx', fmt: (v) => fmt1(v), color: (v) => (v > 40 ? 'green' : v > 20 ? 'yellow' : 'red') },
  { key: 'd_rmssd_delta_pct', label: 'rMSSD Δ% ¹', fmt: (v) => (isNaN(v) ? '—' : (v > 0 ? '+' : '') + fmt1(v) + '%'), color: (v) => (v > 5 ? 'green' : v < -10 ? 'red' : '') },
  { key: 'd_hrv_momentum', label: 'HRV Momentum', fmt: (v) => (isNaN(v) ? '—' : fmt4(v)), color: (v) => (v > 0 ? 'green' : v > -0.01 ? 'yellow' : 'red') },
  { key: 'd_recovery_debt', label: 'Recov Debt 14d', fmt: (v) => (isNaN(v) ? '—' : fmt0(v)), color: (v) => (v < 3 ? 'green' : v < 7 ? 'yellow' : 'red') }
];
// FOLLOWUPS-II §1: guard null explicitly. A nullable transparent field (_sdnn/_rmssd, numOrNull) reaches
// these via renderTable's fmt; isNaN(null)===false would fall through to null.toFixed() and THROW (a crash
// regression from Finding 1, when blanks became null instead of 0). A real 0 still formats (0 != null).
const fmt0 = (v) => (v == null || isNaN(v) ? '—' : Math.round(v).toString());
const fmt4 = (v) => (v == null || isNaN(v) ? '—' : v.toFixed(4));
const fmt1 = (v) => (v == null || isNaN(v) ? '—' : v.toFixed(1));
const fmt2 = (v) => (v == null || isNaN(v) ? '—' : v.toFixed(2));
const fmt3 = (v) => (v == null || isNaN(v) ? '—' : v.toFixed(3));

function pillClass(colorFn, val) {
  const c = colorFn ? colorFn(val) : '';
  return c ? `pill pill-${c}` : '';
}

function renderTable(rows) {
  const thead = document.getElementById('tableHead');
  const tbody = document.getElementById('tableBody');
  if (!thead || !tbody) return;
  thead.innerHTML = TABLE_COLS.map((c) => `<th>${evBadge(c.label, false)}${c.label}</th>`).join('');
  const displayRows = [...rows].reverse().slice(0, 60);
  tbody.innerHTML = displayRows
    .map(
      (r) =>
        '<tr>' +
        TABLE_COLS.map((c) => {
          const raw = r[c.key];
          const displayed = c.fmt ? c.fmt(raw) : raw != null ? raw : '—';
          const cls = c.color && !c.noColor && typeof raw === 'number' ? pillClass(c.color, raw) : '';
          return `<td>${cls ? `<span class="${cls}">${displayed}</span>` : displayed}</td>`;
        }).join('') +
        '</tr>'
    )
    .join('');
}

function renderCardiovascularResearch(rows) {
  if (!rows || !rows.length) return;
  // Render each chart if its canvas exists
  var dates = rows.map(function (r) {
    return r._date;
  });

  // ch_htn_pattern (HRV→hypertension-risk) REMOVED 2026-06-23 (DEX-METRIC-REMOVAL-AUDIT 🔴).

  var camqScores = rows.map(computeCAMQ).filter(function (v) {
    return v != null;
  });
  var camqDates = rows
    .filter(function (r) {
      return computeCAMQ(r) != null;
    })
    .map(function (r) {
      return r._date;
    });
  drawSimpleLine('ch_camq', camqDates, camqScores, {
    label: 'CAMQ',
    yMin: 0,
    yMax: 100,
    bands: [
      { from: 60, to: 100, color: 'rgba(57,217,138,.06)' },
      { from: 30, to: 60, color: 'rgba(255,184,77,.06)' },
      { from: 0, to: 30, color: 'rgba(255,107,122,.06)' }
    ]
  });

  // ch_map_est (HRV→MAP regression) REMOVED 2026-06-23 (DEX-METRIC-REMOVAL-AUDIT 🔴).
}

// Minimal Chart.js-compatible line renderer (uses existing Chart.js if loaded)
function drawSimpleLine(canvasId, dates, values, opts) {
  var canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  opts = opts || {};
  // Destroy existing chart on this canvas if any
  if (canvas._chart) {
    try {
      canvas._chart.destroy();
    } catch (e) {}
  }
  var ctx = canvas.getContext('2d');
  var labels = dates.map(function (d) {
    if (d instanceof Date) return d.toLocaleDateString(undefined, { timeZone: 'UTC' });
    return String(d);
  });
  canvas._chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: opts.label || 'value',
          data: values,
          borderColor: '#3DE0D0',
          backgroundColor: 'rgba(61,224,208,.08)',
          tension: 0.3,
          pointRadius: 2,
          borderWidth: 2,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false }
      },
      scales: {
        y: {
          min: opts.yMin,
          max: opts.yMax,
          ticks: { color: '#9FB0C3' },
          grid: { color: 'rgba(255,255,255,.05)' }
        },
        x: {
          ticks: { color: '#9FB0C3', maxTicksLimit: 8 },
          grid: { color: 'rgba(255,255,255,.03)' }
        }
      }
    }
  });
}
// ═══ end Cardiovascular Research Pattern ═══
