/*
 * tests/hrstat-class-twins.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * The two nights behind `integrator_hrstat_class_twins` — D3's committed adversarial twins.
 *
 * WHY THEY EXIST. D3 (owner ruling 2026-09-17) switched OxyDex's epoch HR from `median-rate` to
 * `mean-rate` and re-keyed the Integrator's mixed-statistic flag from NAME EQUALITY to measured
 * COMPARABILITY. Both regen tools then reported **0 fixtures moved** — and that was silence by
 * construction, not evidence: neither OxyDex GATE-B fixture carries `tchEpochs` or `hrStat` at all,
 * and the Integrator goldens' inputs are committed exports still labelled `median-rate`, so the flag
 * read mixed before and after. Nothing committed could express the ruling.
 *
 * That is the SAME failure `integrator_apnea_null_twins` was minted to close on 2026-09-02, and its
 * ledger note states it in almost these words. Same remedy, same shape.
 *
 * TWO NIGHTS, BECAUSE ONE DIRECTION CAN ONLY HALF-FAIL — the apnea twins' own reasoning:
 *   comparable   ECGDex + PpgDex `rate-of-mean`, OxyDex `mean-rate`  ⇒ hrStatMixed MUST be false.
 *                This is the twin that catches a REVERT to name-equality keying, which would read
 *                three distinct names and flag a night whose legs agree to 0.3 sigma.
 *   incomparable OxyDex `median-rate` instead                        ⇒ hrStatMixed MUST be true.
 *                Without it, a flag hard-wired to `false` would pass the first twin and the guard
 *                would be gone. A gate that only witnesses one direction is half a gate.
 *
 * INPUTS REBUILT IN-CODE from `tchGoldenInputs()` — the same builder the equivalence gate consumes,
 * so the two cannot drift, and `inputHashes` stays `{}` so CI reproduces them with no corpus. The
 * ONLY thing these add to that night is the `hrStat` label on each epoch; every number is the
 * upstream builder's, so a difference between the twins can only be the label.
 *
 * DUAL-MODE, like its sibling: attaches to the global AND sets module.exports, because dex-tests.js
 * runs in both lanes and an .mjs would serve the tool while breaking the browser gate.
 */
(function (root) {
  'use strict';

  /* The label each node carries in a given twin. ECGDex and PpgDex publish `rate-of-mean` in the
     real fleet (both derive HR from intervals); OxyDex is the leg D3 moved, so it is the only one
     that differs between the two nights. */
  var LABELS = {
    comparable: { ECGDex: 'rate-of-mean', PpgDex: 'rate-of-mean', OxyDex: 'mean-rate' },
    incomparable: { ECGDex: 'rate-of-mean', PpgDex: 'rate-of-mean', OxyDex: 'median-rate' }
  };

  function hrStatClassTwins(which) {
    var labels = LABELS[which];
    if (!labels) return null;
    var base = typeof tchGoldenInputs === 'function' ? tchGoldenInputs() : root.tchGoldenInputs();
    return base.map(function (x) {
      /* Deep-enough copy: the epochs are the only thing touched, and mutating the shared builder's
         output would make the two twins depend on which ran first — a fixture that changes with call
         ORDER is not deterministic, whatever its seed says. */
      var json = JSON.parse(JSON.stringify(x.json));
      var stat = labels[x.node] || null;
      if (json.timeseries && json.timeseries.epochs) {
        json.timeseries.epochs = json.timeseries.epochs.map(function (e) {
          var out = {};
          for (var k in e) out[k] = e[k];
          out.hrStat = stat;
          return out;
        });
      }
      return { node: x.node, json: json };
    });
  }

  root.hrStatClassTwins = hrStatClassTwins;
  root.HRSTAT_TWIN_LABELS = LABELS;
  if (typeof module !== 'undefined' && module.exports) module.exports = { hrStatClassTwins: hrStatClassTwins, HRSTAT_TWIN_LABELS: LABELS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
