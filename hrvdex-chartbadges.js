/* ════ HRVDex · Chart-card evidence badges (hrvdex-chartbadges.js) ──────────
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   Adds the canonical evidence disc (MetricRegistry.badge → .ev.ev-<tier>) to
   every Overview/tab graph card, so each chart carries the same trust marker
   the metrics table already shows. Shape = trust, never hue (CLAUDE.md).

   Grades are sourced from HRV_REGISTRY where a chart maps to a registered
   metric (validated/emerging/experimental/heuristic); derived single-domain
   transforms grade `emerging`, multi-signal HRVDex scores grade `experimental`,
   and population projections (ANS age, VO₂max, BP/MAP, HTN pattern) grade
   `heuristic`. Pure DOM, no deps beyond metric-registry.js. 100% local.
   Load AFTER hrvdex-app.js.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* canvas id → evidence tier. Keep in sync with HRV_REGISTRY tiers; derived /
   composite / projection charts graded by the rules in the header. */
  var CHART_EV = {
    /* ── Overview ── */
    ch_rmssd: 'validated',
    ch_hrv_sdnn: 'experimental',
    ch_sns_psns: 'experimental',
    ch_ov_lfhf: 'validated',
    ch_ov_si: 'validated',
    ch_ov_vei: 'emerging',
    ch_ov_dfa: 'emerging',
    /* ch_ov_age (ANS age) + ch_ov_map (HRV→MAP) REMOVED 2026-06-23 (DEX-METRIC-REMOVAL-AUDIT 🔴) */
    /* ── Time domain ── */
    ch_stressEnergy: 'experimental',
    ch_si: 'validated',
    ch_cv: 'validated',
    ch_rmssd_sdnn: 'emerging',
    ch_mxdmn_meanrr: 'emerging',
    ch_se_div: 'experimental',
    ch_lnrmssd: 'validated',
    /* ── Frequency domain ── */
    ch_lfhf: 'validated',
    ch_lfhf_nu: 'validated',
    ch_vlf_pct: 'emerging',
    ch_svi: 'emerging',
    ch_spectral_ent: 'emerging',
    ch_lfhf_total: 'emerging',
    /* ── Composite scores (HRVDex-derived) ── */
    ch_ans_load: 'experimental',
    ch_coh_energy: 'experimental',
    ch_pti: 'experimental',
    ch_incoherent_stress: 'experimental',
    ch_vei: 'emerging',
    ch_sdi: 'experimental',
    /* ── Rolling ── */
    ch_ari: 'experimental',
    ch_sdnn_z: 'emerging',
    ch_rmssd_rolling: 'validated',
    ch_stress_auc: 'experimental',
    ch_rmssd_cv: 'emerging',
    ch_stress_ac: 'experimental',
    ch_hrv_momentum: 'emerging',
    ch_welfare: 'experimental',
    ch_recovery_debt: 'experimental',
    ch_rmssd_reactivity: 'emerging',
    /* ── Clinical ── */
    ch_bap: 'heuristic',
    ch_ortho: 'experimental',
    ch_pnn50_slope: 'emerging',
    ch_hile: 'experimental',
    ch_camq: 'experimental',
    /* ch_htn_pattern (HRV→HTN-risk) + ch_map_est (HRV→MAP) REMOVED 2026-06-23 (DEX-METRIC-REMOVAL-AUDIT 🔴) */
    /* ── Poincaré & Toichi ── */
    ch_sd1_sd2: 'validated',
    ch_sd1sd2_ratio: 'validated',
    ch_cvi: 'validated',
    ch_csi: 'validated',
    ch_cvi_csi_scatter: 'validated',
    ch_dfa_plaw: 'emerging',
    ch_vlf_hf_sai: 'emerging',
    ch_cai: 'emerging' /* ch_auto_age REMOVED 2026-06-23 (DEX-METRIC-REMOVAL-AUDIT 🔴) */,
    /* ── Cognitive & resilience ── */
    ch_efc: 'experimental',
    ch_crs: 'experimental',
    ch_abs: 'experimental',
    ch_sfd: 'experimental',
    ch_focus_eff: 'experimental',
    ch_pns_eff: 'experimental',
    ch_otr: 'experimental',
    ch_rmssd_circ: 'emerging',
    ch_rsa_nn50: 'emerging',
    /* ── VO₂max (population projection) ── */
    ch_vo2_trend: 'heuristic',
    ch_vo2_delta: 'heuristic',
    ch_vo2_hr_scatter: 'heuristic',
    ch_vo2_rmssd_mod: 'heuristic'
    /* BP charts (ch_sbp_ / ch_bp_ families) REMOVED 2026-06-21 (external-review WP-A).
     ch_hist / ch_corr / ch_weekday / corrHeatmap = user-selected explorers,
     not a single graded metric → intentionally left unbadged. */
  };

  var CITE = {
    validated: 'Established HRV measure',
    emerging: 'Published, less standardized / device-dependent',
    experimental: 'HRVDex-derived score \u2014 not externally validated',
    heuristic: 'Population-norm projection \u2014 directional only'
  };

  function injectCss() {
    if (!global.document || global.document.getElementById('hrv-chartbadge-css')) return;
    var s = global.document.createElement('style');
    s.id = 'hrv-chartbadge-css';
    /* disc base styles come from metric-registry.js; this only places the disc
     inline IMMEDIATELY BEFORE the chart-card title (never over the canvas) —
     CLAUDE.md coverage mandate: inline .ev sits before the label. */
    s.textContent = '.chart-card > h4 > .ev{position:static;margin-right:7px;vertical-align:middle;opacity:.8;}' + '.chart-card:hover > h4 > .ev{opacity:1;}';
    (global.document.head || global.document.documentElement).appendChild(s);
  }

  function decorate() {
    var MR = global.MetricRegistry,
      doc = global.document;
    if (!MR || !doc) return;
    injectCss();
    var cards = doc.querySelectorAll('.chart-card');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var h4 = card.querySelector(':scope > h4');
      if (!h4 || h4.querySelector('.ev')) continue; // none or already badged
      var cv = card.querySelector('canvas');
      var tier = cv && cv.id ? CHART_EV[cv.id] : null;
      if (!tier) continue;
      h4.insertAdjacentHTML('afterbegin', MR.badge(tier, CITE[tier] || '') + ' ');
    }
  }

  function run() {
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', decorate, { once: true });
    else decorate();
    // re-assert once more after first paint in case a late script rebuilds a header
    if (global.requestAnimationFrame) global.requestAnimationFrame(decorate);
  }
  run();

  global.HrvChartBadges = { decorate: decorate, MAP: CHART_EV };
})(typeof window !== 'undefined' ? window : this);
