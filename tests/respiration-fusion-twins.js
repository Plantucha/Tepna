/* ═══════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * tests/respiration-fusion-twins.js — committed synthetic twins for `fuseRespirationRate`.
 *
 * WHY. The respiration-fusion path had NO committed fixture, so a value going missing from it was
 * undetectable — not "nothing reflected the defect" but NOTHING COULD. Measured 2026-09-02:
 * `integrator_tch_golden` mentions respRate 0 times (it is the HR-hat consensus),
 * `integrator_apnea_null_twins` neither, and 0 of 6 corpus `integrator_fusion_*.json` carry the field.
 * The positive control is what makes those zeros usable: the same query returns 1 on
 * `uploads/synthetic_motiondex_golden.node-export.json`, where the field does exist.
 *
 * That blindness is why PpgDex's exported respiration reached no fusion for a MONTH with every gate
 * green (fixed 2026-09-02) — a corpus that cannot express a defect returns the same green as one that
 * checked and found nothing, and only the second is evidence.
 *
 * WHAT EACH TWIN ISOLATES. `fuseRespirationRate` carries two guards its own header names, and a
 * fixture that only exercised the happy path would leave both untested:
 *
 *   agree     three DISTINCT nodes, overlapping windows, close rates  → fuses, n = 3
 *   disjoint  two nodes whose recordings do NOT overlap in time       → guard (a): no fusion
 *   sameNode  two observers from the SAME node, overlapping           → guard (b): collapse to 1 ⇒ n < 2
 *   single    one node only                                           → below the n ≥ 2 floor
 *
 * ⚠️ THE SOURCE FIELD IS PER-NODE AND GETTING IT WRONG MAKES THE FIXTURE VACUOUS. The adapter reads
 * `json.hrv.frequency.respRate` for ECGDex and for the PulseDex/HRVDex/PpgDex branch, and
 * `json.motion.respRateBrpm` for MotionDex. A twin that put the rate anywhere else would yield zero
 * candidates and every assertion below would pass on an empty fusion — the exact defect this file
 * exists to make impossible. The regen tool asserts n > 0 on `agree` for that reason.
 * ═══════════════════════════════════════════════════════════════════════════════ */

'use strict';

/* A fixed, arbitrary night. Floating wall-clock ms per the Clock Contract — Date.UTC of local civil
   time, never a real UTC instant. */
var RT0 = Date.UTC(2026, 5, 27, 22, 0, 0);
var RSPAN = 8 * 3600 * 1000;

/* A node export carrying a respiration rate in the place THAT node's adapter branch reads it. */
function respExport(node, brpm, method, opts) {
  var o = opts || {};
  var start = o.startMs != null ? o.startMs : RT0;
  var end = o.endMs != null ? o.endMs : RT0 + RSPAN;
  var json = {
    schema: { name: 'ganglior.node-export', version: '1.0', bus: 'ganglior', node: node },
    node: node,
    recording: { startEpochMs: start, endEpochMs: end, node: node },
    ganglior_events: []
  };
  if (node === 'MotionDex') {
    json.motion = { respRateBrpm: brpm, respRateMethod: method };
  } else {
    json.hrv = { frequency: { respRate: brpm, respRateMethod: method } };
  }
  return json;
}

function respirationFusionTwins() {
  var HOUR = 3600 * 1000;
  return {
    /* Three distinct nodes, one overlapping window, rates within a breath of each other. */
    agree: [
      { node: 'ECGDex', json: respExport('ECGDex', 14.2, 'RSA (HF-peak of RR spectrum)') },
      { node: 'PpgDex', json: respExport('PpgDex', 13.8, 'RSA (PPG)') },
      { node: 'MotionDex', json: respExport('MotionDex', 14.0, 'acc-spectral-viterbi') }
    ],
    /* Guard (a): two nodes that never share a minute. Fusing them would average two different
       nights — a consensus over inputs with no common instant. */
    disjoint: [
      { node: 'ECGDex', json: respExport('ECGDex', 14.2, 'RSA (HF-peak of RR spectrum)', { startMs: RT0, endMs: RT0 + 3 * HOUR }) },
      {
        node: 'MotionDex',
        json: respExport('MotionDex', 19.6, 'acc-spectral-viterbi', { startMs: RT0 + 5 * HOUR, endMs: RT0 + 8 * HOUR })
      }
    ],
    /* Guard (b): two observers, ONE node. `n` must count distinct SOURCES, not records — otherwise a
       node that happens to export twice manufactures its own agreement. */
    sameNode: [
      { node: 'PpgDex', json: respExport('PpgDex', 13.8, 'RSA (PPG)') },
      { node: 'PpgDex', json: respExport('PpgDex', 13.9, 'RSA (PPG)') }
    ],
    /* Below the floor: one source cannot corroborate itself. */
    single: [{ node: 'ECGDex', json: respExport('ECGDex', 14.2, 'RSA (HF-peak of RR spectrum)') }]
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { respirationFusionTwins: respirationFusionTwins, respExport: respExport, RESP_T0: RT0 };
}
