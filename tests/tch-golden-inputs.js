/*
 * tests/tch-golden-inputs.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * The deterministic three-node co-recorded night behind `integrator_tch_golden`.
 *
 * WHY THIS FILE EXISTS (DEEP-AUDIT-III-FOLLOWUPS §1.5). The Integrator was the ONE code-gated
 * fixture in the ledger with no `tools/regen-*-goldens.mjs` path, so a TCH-fusion change that
 * legitimately MOVED its output had no sanctioned way to be re-recorded — and CLAUDE.md §🔏 forbids
 * hand-editing an export. Writing that tool meant getting these inputs, which lived in a CLOSURE
 * inside a `tests/dex-tests.js` group. Copying them into the tool would have created a second
 * source that can drift from the gate's — the sibling-divergence class the parent audit exists to
 * fix — so the builder is extracted HERE and both the gate and the tool consume it.
 *
 * DUAL-MODE ON PURPOSE. `dex-tests.js` runs in BOTH lanes: the Node runner loads it, and
 * `Dex-Test-Suite.html` loads it as a classic script. An `.mjs` module would have served the tool
 * and broken the browser gate, so this attaches to the global AND sets module.exports, exactly as
 * `clock.js` does.
 *
 * PURE + DETERMINISTIC: seeded mulberry32, no clock read, no RNG, no I/O. Identical inputs ⇒
 * identical bytes, which is what lets the equivalence gate itself prove this extraction was
 * faithful — if a single byte moved, `Integrator TCH-HR consensus ≡ committed golden` reds.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  function tchGoldenInputs() {
    function mb32(a) {
      return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function gauss(rng) {
      var u = 0,
        v = 0;
      while (u === 0) u = rng();
      while (v === 0) v = rng();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
    var baseT0 = Date.UTC(2026, 5, 15, 23, 0, 0); // ECG anchor 2026-06-15 23:00 (floating wall-clock)
    var NE = 24; // 24 epochs = 120 min per node
    function latentHR(a) {
      return 58 + 4 * Math.sin(a / 5) - 0.05 * a;
    } // shared latent HR on the ABSOLUTE 5-min grid
    function latentMot(a) {
      return 30 + 20 * Math.sin(a / 3 + 1);
    } // shared motion driver (→ cross-node ρ)
    var CFG = [
      { node: 'ECGDex', offMin: 0, sHR: 1.0, rmssd: 42, sdnn: 60, seed: 11 },
      { node: 'PpgDex', offMin: 5, sHR: 2.2, rmssd: 38, sdnn: 57, seed: 22 },
      { node: 'OxyDex', offMin: 10, sHR: 4.5, rmssd: null, sdnn: null, seed: 33 }
    ];
    return CFG.map(function (c) {
      var rng = mb32(c.seed),
        rngM = mb32(c.seed + 7);
      var t0 = baseT0 + c.offMin * 60000;
      var eps = [];
      for (var i = 0; i < NE; i++) {
        var absA = c.offMin / 5 + i; // shared absolute-grid index (5-min units from baseT0)
        var e = { tMin: i * 5, hr: +(latentHR(absA) + c.sHR * gauss(rng)).toFixed(1), motionIndex: +(latentMot(absA) + 18 * gauss(rngM)).toFixed(2) };
        if (c.rmssd != null) e.rmssd = +(c.rmssd + 3 * gauss(rng)).toFixed(1);
        eps.push(e);
      }
      var json = {
        schema: { name: 'ganglior.node-export', node: c.node, version: '2.0' },
        recording: { startEpochMs: t0, durationMin: NE * 5 },
        quality: { analyzablePct: 95 },
        timeseries: { epochs: eps },
        ganglior_events: []
      };
      if (c.rmssd != null) json.hrv = { time: { rmssd: c.rmssd, sdnn: c.sdnn } };
      return { node: c.node, json: json };
    });
  }

  root.TchGoldenInputs = { tchGoldenInputs: tchGoldenInputs };
  if (typeof module !== 'undefined' && module.exports) module.exports = { tchGoldenInputs: tchGoldenInputs };
})(typeof globalThis !== 'undefined' ? globalThis : this);
