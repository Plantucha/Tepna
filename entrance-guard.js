/*
 * entrance-guard.js — keep entrance-animated content visible on a frozen timeline
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. See the LICENSE and
 * NOTICE files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * WHY. ans-design.css gives .main-content / .chart-card / .kpi / .chart-svg /
 * .tab-content.active / .readiness-* their entrance via from-opacity:0 keyframes
 * (cardEntrance / fadeIn / heroEntrance / scoreCount) with animation-fill-mode:both.
 * When the document timeline is FROZEN — print, PDF export, html-to-image capture,
 * a throttled background tab — the animation never advances past frame 0, so `both`
 * (and even a plain from-opacity:0 sitting at t=0) holds opacity:0 and the page
 * renders BLANK. Per the CSS spec an `!important` declaration overrides a running
 * animation, so pinning the visible end-state as the base guarantees content is
 * always painted; the subtle fade is not worth a blank screen.
 *
 * This mirrors the Integrator's scoped guard (integrator-render.js) as a shared
 * drop-in for the node apps. It deliberately does NOT edit ans-design.css (which is
 * inlined into every bundle's __bundler/template — editing it would shift every
 * app's template buildHash and redden the buildHash-legacy fusion fixtures). It is
 * loaded by the node src.html shells only, NOT by Integrator (already guarded), so
 * Integrator's buildHash — and the fusion fixtures keyed on it — are untouched.
 * As external JS it moves each node's manifestHash (re-bundle + BUILD-MANIFEST),
 * but no node fixture is buildHash-gated. transform is pinned ONLY on .main-content
 * so the cards' hover-lift transition keeps working.
 */
(function () {
  var ID = 'dx-entrance-guard';
  var css =
    '.main-content{animation:none!important;opacity:1!important;transform:none!important;}' +
    '#kpiStrip.show,#kpiStrip .kpi,.chart-card,.chart-svg,.tab-content.active,' +
    '.readiness-hero,.readiness-score,.readiness-subscore,' +
    '.finding-card,.pair-card,.metric{animation:none!important;opacity:1!important;}';
  function inject() {
    try {
      if (document.getElementById(ID)) return;
      var st = document.createElement('style');
      st.id = ID;
      st.textContent = css;
      (document.head || document.documentElement).appendChild(st);
    } catch (e) {}
  }
  inject();
  // re-assert once the parser has built <head>, in case this ran before it existed
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject, { once: true });
  }
})();
