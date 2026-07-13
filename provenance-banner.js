/*
 * provenance-banner.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * GATE-LIVE-RUNNABILITY-FOLLOWUPS §4 — the ONE source of verify-provenance.html's GATE A / GATE B
 * banner text. Extracted so the page AND tests/dex-tests.js call the SAME pure function: an edit to
 * a banner message now goes RED in the suite (the test gates the real strings the page renders),
 * instead of the test silently passing against a private mirror that has drifted from the page.
 *
 * SIGNAL-ADAPTER-AND-FRONTIER Phase 7 — GATE B is now the CONTENT-ADDRESSED known-answer audit
 * (input + executed-code manifestHash + output content hashes), NOT the coarse runtime-buildHash
 * check. The banner reports its PASS / drift-FAIL / parse-FAIL state; buildHash is retired (no
 * mention).
 *
 * Pure: no DOM, no fetch, no globals read. Loads in the browser (window.pickProvenanceBanner),
 * the Node `vm` runner (ctx.pickProvenanceBanner), and Node `require` (module.exports).
 */
(function (root) {
  'use strict';

  /* state = {
   *   MANIFEST,        // committed BUILD-MANIFEST.json object (or null if it failed to load/parse)
   *   MANIFEST_ERR,    // parse/load error message for BUILD-MANIFEST.json (or null/undefined)
   *   gateAFail,       // # bundles whose manifestHash DRIFTED from committed
   *   gateAMissing,    // # bundles with no committed manifestHash
   *   gateAChecked,    // # bundles compared
   *   gateAComplete,   // gateAChecked === bundlesLength
   *   bundlesLength,   // total bundle count
   *   FIXPROV_ERR,     // parse/load error message for FIXTURE-PROVENANCE.json (or null/undefined)
   *   gateBFail,       // # fixtures that DRIFTED (code/input/output content hash) — Phase 7 GATE B
   *   gateBChecked,    // # fixtures content-addressed reproducible (pass)
   *   gateBAbsent      // # fixtures skipped because their committed files aren't served (gitignored uploads/)
   * } → { gateA: <html>, gateB: <html> } */
  function pickProvenanceBanner(state) {
    state = state || {};
    var MANIFEST = state.MANIFEST;
    var MANIFEST_ERR = state.MANIFEST_ERR;
    var gateAFail = state.gateAFail | 0;
    var gateAMissing = state.gateAMissing | 0;
    var gateAChecked = state.gateAChecked | 0;
    var gateAComplete = !!state.gateAComplete;
    var bundlesLength = state.bundlesLength | 0;
    var FIXPROV_ERR = state.FIXPROV_ERR;
    var gateBFail = state.gateBFail | 0;
    var gateBChecked = state.gateBChecked | 0;
    var gateBAbsent = state.gateBAbsent | 0;

    var gateA;
    // HARD-FAIL on a missing/blocked manifest — a real CI run must FAIL, never skip, when
    // BUILD-MANIFEST.json doesn't load (the "false-clean" gap: a slow fetch left GATE A reading as
    // pass-with-warn instead of comparing).
    if (!MANIFEST) {
      gateA =
        '<span class="pill bad">GATE A FAIL — BUILD-MANIFEST.json ' +
        (MANIFEST_ERR ? 'failed to load/parse (' + MANIFEST_ERR + ')' : 'did not load') +
        '</span> — a missing/blocked/INVALID manifest is a hard failure, not a skip. Commit & serve VALID JSON (see the run_script in REVIEW-FOLLOWUP-FIXES-BRIEF §P0), then reload.';
    } else if (gateAFail > 0) {
      gateA =
        '<span class="pill bad">GATE A FAIL — ' +
        gateAFail +
        ' bundle(s) drifted</span> — a module changed without a re-bundle, OR BUILD-MANIFEST.json is stale. Re-bundle the drifted app(s) and regenerate BUILD-MANIFEST.json.';
    } else if (gateAMissing > 0 || !gateAComplete) {
      gateA =
        '<span class="pill bad">GATE A FAIL — ' +
        (gateAMissing || bundlesLength - gateAChecked) +
        ' bundle(s) have no committed manifestHash</span> — BUILD-MANIFEST.json is incomplete or stale (every shipped bundle must be committed). Regenerate it after the re-bundle, then reload.';
    } else {
      gateA =
        '<span class="pill ok">GATE A PASS — ' +
        gateAChecked +
        " bundle(s) match committed manifestHash</span>. manifestHash is the authoritative executed-code fingerprint (a UUID-independent projection of the bundle's __bundler/manifest).";
    }

    var gateB;
    // Phase 7 (SIGNAL-ADAPTER-AND-FRONTIER): GATE B is the CONTENT-ADDRESSED known-answer audit. A
    // parse/load failure of the ledger is a DISTINCT hard fail (it used to degrade silently); a content
    // drift (code/input/output hash mismatch) is the real teeth; otherwise PASS. No buildHash anywhere.
    if (FIXPROV_ERR) {
      gateB =
        '<span class="pill bad">GATE B FAIL — FIXTURE-PROVENANCE.json failed to load/parse (' +
        FIXPROV_ERR +
        ')</span> — the content-addressed known-answer ledger is unreadable, so no fixture can be audited. Fix the JSON (it must JSON.parse) and reload.';
    } else if (gateBFail > 0) {
      gateB =
        '<span class="pill bad">GATE B FAIL — ' +
        gateBFail +
        ' fixture(s) drifted (code / input / output content hash)</span> — the known-answer no longer holds. Re-run the producing app on its committed inputs and re-export (never hand-edit), then re-record the fixture in FIXTURE-PROVENANCE.json.';
    } else {
      gateB =
        '<span class="pill ok">FIXTURE-PROVENANCE.json parsed — GATE B PASS: ' +
        gateBChecked +
        ' fixture(s) content-addressed reproducible' +
        (gateBAbsent ? ' (' + gateBAbsent + ' skipped — committed files not served)' : '') +
        '</span> — each fixture is a known-answer triple: hash(input) + executed-code manifestHash + hash(output). No buildHash.';
    }

    return { gateA: gateA, gateB: gateB };
  }

  /** @type {any} */ (root).pickProvenanceBanner = pickProvenanceBanner;
  if (typeof module !== 'undefined' && module.exports) module.exports = { pickProvenanceBanner: pickProvenanceBanner };
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
