/* ════ Tepna · shared HTML escaper (dex-escape.js) ─────────────────────────
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ────────────────────────────────────────────────────────────────────────
 * THE one canonical escaper for every untrusted-string → innerHTML sink in the
 * suite (SECURITY-REMEDIATION F1/F2/F3). Escapes & < > " ' → entities; null/
 * number-safe. Loaded FIRST in each app shell so any later module can call it
 * (OxyDex's oxydex-util `escHTML` delegates here — one implementation, no per-app
 * copies). A crafted capture filename (e.g. `<img src=x onerror=…>.csv`) must
 * render as inert TEXT, never execute, in the origin that holds the user's
 * profile + cached recording.
 * ════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  root.escapeHTML = escapeHTML;
  root.DexEsc = { escapeHTML: escapeHTML };
  if (typeof module !== 'undefined' && module.exports) module.exports = { escapeHTML: escapeHTML };
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
