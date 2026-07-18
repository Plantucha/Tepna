/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   MotionDex · RENDER  (motiondex-render.js)
   ────────────────────────────────────────────────────────────────────────
   Paints the single-signal motion summary from MOTIONDSP.compute():
     · KPI grid  — supine time · immobile time · movement index · resp rate · SQI
     · Position dwell bar (supine/prone/left/right/upright/unknown)
     · Effort + SQI detail cards
   Every surfaced number carries an evidence badge (COVERAGE MANDATE) via
   MotionRegistry.badgeForLabel — inline `.ev` immediately before the label.
   ESM-from-birth dual-mode: attaches window.MOTIONUI + re-exports it.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var POS_LABEL = { supine: 'Supine', prone: 'Prone', left: 'Lateral L', right: 'Lateral R', upright: 'Upright', unknown: 'Unknown' };
  var POS_ORDER = ['supine', 'left', 'right', 'prone', 'upright', 'unknown'];

  function pct(f) {
    return f == null || !isFinite(f) ? '—' : (f * 100).toFixed(0) + '%';
  }
  function num(v, d) {
    return v == null || !isFinite(v) ? '—' : Number(v).toFixed(d == null ? 1 : d);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  // evidence dot immediately BEFORE the label (mandate placement #2, dense grid)
  function badge(label) {
    return global.MotionRegistry ? global.MotionRegistry.badgeForLabel(label, false) : '';
  }
  function kpi(label, value, sub) {
    return (
      '<div class="mx-kpi">' +
      '<div class="mx-kpi-l">' +
      badge(label) +
      ' ' +
      esc(label) +
      '</div>' +
      '<div class="mx-kpi-v">' +
      esc(value) +
      '</div>' +
      (sub ? '<div class="mx-kpi-s">' + esc(sub) + '</div>' : '') +
      '</div>'
    );
  }

  function positionBar(dwellFrac) {
    if (!dwellFrac) return '';
    var seg = '';
    for (var i = 0; i < POS_ORDER.length; i++) {
      var p = POS_ORDER[i],
        f = dwellFrac[p] || 0;
      if (f <= 0) continue;
      seg += '<span class="mx-seg mx-seg-' + p + '" style="flex:' + f.toFixed(4) + '" title="' + esc(POS_LABEL[p]) + ' ' + pct(f) + '"></span>';
    }
    var legend = '';
    for (i = 0; i < POS_ORDER.length; i++) {
      var q = POS_ORDER[i];
      if (!(dwellFrac[q] > 0)) continue;
      legend += '<span class="mx-lg"><i class="mx-dot mx-seg-' + q + '"></i>' + esc(POS_LABEL[q]) + ' ' + pct(dwellFrac[q]) + '</span>';
    }
    return '<div class="mx-bar">' + seg + '</div><div class="mx-legend">' + legend + '</div>';
  }

  // renderSummary(summary, rootEl) → paints the compute() result into rootEl
  function renderSummary(summary, rootEl) {
    var root = typeof rootEl === 'string' ? document.getElementById(rootEl) : rootEl;
    if (!root) return;
    if (!summary || !summary.streams || (!summary.streams.acc && !summary.streams.chestAcc)) {
      root.innerHTML = '<div class="mx-empty">No IMU samples parsed. Drop Polar Sensor Logger ' + '<code>_ACC / _GYRO / _MAGN</code> files (Verity or H10).</div>';
      return;
    }
    var pos = summary.position || {},
      act = summary.activity || {},
      eff = summary.effort || {},
      sqi = summary.sqi || {};
    var mins = summary.durSec ? (summary.durSec / 60).toFixed(0) + ' min' : '—';

    var html = '';
    html +=
      '<div class="mx-head"><b>MotionDex</b> · ' +
      esc(mins) +
      ' · ' +
      'ACC ' +
      (summary.streams.acc || 0) +
      ' · GYRO ' +
      (summary.streams.gyro || 0) +
      ' · MAGN ' +
      (summary.streams.mag || 0) +
      ' · chest ' +
      (summary.streams.chestAcc || 0) +
      '</div>';

    html += '<div class="mx-grid">';
    html += kpi('Supine time', pos.hasData ? pct(pos.supineFrac) : '—', 'positional-OSA target ↓');
    html += kpi('Immobile time', act.hasData ? pct(act.immobileFrac) : '—', 'below movement threshold');
    html += kpi('Movement index', act.hasData ? num(act.movementIndex, 2) : '—', 'per-epoch activity');
    html += kpi('Respiratory rate', eff.hasData ? num(eff.rateBrpm, 1) + ' br/min' : '—', eff.hasData ? eff.nBreaths + ' breaths' : 'no chest ACC');
    html += kpi('Signal quality', sqi.conf != null ? num(sqi.conf, 2) + '×' : '—', sqi.flags && sqi.flags.length ? sqi.flags.join(', ') : 'clean');
    html += '</div>';

    if (pos.hasData) {
      html += '<div class="mx-card"><div class="mx-card-h">' + badge('Supine time') + ' Body position</div>' + positionBar(pos.dwellFrac) + '</div>';
    }
    if (eff.hasData || (act.hasData && act.epochs)) {
      html += '<div class="mx-card"><div class="mx-card-h">' + badge('Effort amplitude') + ' Respiratory effort</div>';
      html += '<div class="mx-row">' + badge('Respiratory rate') + ' Rate <b>' + (eff.hasData ? num(eff.rateBrpm, 1) + ' br/min' : '—') + '</b></div>';
      html += '<div class="mx-row">' + badge('Effort amplitude') + ' Amplitude <b>' + (eff.hasData ? num(eff.amplitudeG, 4) + ' g' : '—') + '</b></div>';
      html += '</div>';
    }

    root.innerHTML = html;
  }

  global.MOTIONUI = { renderSummary: renderSummary, positionBar: positionBar };
})(window);

// ESM-from-birth dual-mode (mirrors glucodex-render): the IIFE attaches window.MOTIONUI for the
// classic co-load consumers; this re-export lets the owned ESM bundle's motiondex-app.js import it.
export const MOTIONUI = window.MOTIONUI;
