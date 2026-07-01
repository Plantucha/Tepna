/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   kernel-constants.js — Tepna Physiology Kernel (P8 / KERNEL-BUILD-BRIEF)
   ────────────────────────────────────────────────────────────────────────
   ONE frozen source of truth for every cross-fleet physiology threshold, plus
   a synchronous, content-derived hash stamped into every node export. The
   P12 drift-guard catches divergent constants WITHIN one source tree at test
   time; this hash makes divergence ACROSS deployments visible at fusion time
   (an OxyDex bundle built with one rulebook fused with an ECGDex built with a
   different one no longer "agrees with itself" silently).

   Plain global, no build step, no TypeScript, no CDN. Load FIRST in every
   *.src.html (before the dsp/cross/app scripts), first in tests/run-tests.mjs
   and the first <script> in Dex-Test-Suite.html.

   Hash: 32-bit FNV-1a over VERSION + '|' + JSON.stringify(K). Not sha256 —
   we're offline and a content hash detects drift just as well; sha256 isn't
   worth a dependency. Two builds with identical VERSION + constants produce
   the same HASH by construction; any threshold edit changes it.
   ════════════════════════════════════════════════════════════════════════ */
(function (g) {
  var K = Object.freeze({
    SIGNIF_P: 0.10, SIGNIF_TAU: 0.15,        // cross-night Mann-Kendall significance
    Z_HEADLINE: 1.2, Z_WARN: 1, Z_BAD: 2,    // baseline z-score thresholds
    ODI_DROP: 4, ODI_HYST: 2,                // SpO2 desat drop + hysteresis (%)
    MOS_SHORT: 5, MOS_LONG: 15,              // McGill OxiMetry ODI-4 grade thresholds
    QFLOOR: 50                               // HRV consensus quality floor (%)
  });
  function fnv1a(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }
  var KERNEL_VERSION = '1.0.0';
  var KERNEL_HASH = fnv1a(KERNEL_VERSION + '|' + JSON.stringify(K));
  g.DexKernel = { K: K, VERSION: KERNEL_VERSION, HASH: KERNEL_HASH, fnv1a: fnv1a };
})(typeof window !== 'undefined' ? window : globalThis);
