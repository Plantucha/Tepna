// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/*
 * tests/fusion-night-twins.js — Tepna
 *
 * Committed synthetic MULTI-NODE NIGHTS for the Integrator's night-level fusion
 * (`runFusion` → `buildFusionExport`). Residue `2026-09-05-integrator-fusion-no-code-gated-fixture`.
 *
 * WHY THESE EXIST. Every code-gated Integrator fixture pinned a SUB-FUSER (TCH, apnea-null,
 * respiration), and the only night-level fusions in the ledger are `historical: true` — byte-pinned
 * snapshots of code that has since evolved, deliberately not code-gated. So a change that moved the
 * night-level export reddened nothing: GATE B pins bytes, `verify-fixtures` skips historical records,
 * and no equiv leg called `runFusion`. These twins close that, following the `apnea-null-twins.js`
 * pattern (DEEP-AUDIT-VI-FOLLOWUPS §4.3) one level up: in-code inputs, `inputHashes:{}`, so CI can
 * re-run them from committed bytes with no corpus.
 *
 * ⚠️ THE EXPORT IS DETERMINISTIC ONLY AFTER STRIPPING `generated`, WHICH APPEARS AT TWO PATHS —
 * top level AND nested under `schema`. Measured while building this: strip only the top-level one and
 * two computations in the SAME process differ by exactly two leaves, both timestamps, with identical
 * byte LENGTHS. A length check cannot see it and a naive hash reads as nondeterminism. Any consumer
 * must strip by key name recursively; `regen-integrator-goldens.mjs` and the equiv leg both do.
 *
 * ⚠️ WHAT THESE TWINS DO NOT EXPRESS, measured rather than assumed. Over the pair, the export's 24
 * top-level keys resolve as: 19 populated by `apneaNight`/`uncoupledNight` (which carry apnea events
 * plus respiration), and `hrvConsensus` populated by `hrvNight`. FOUR remain empty in both —
 * `apneaTyping`, `hrvMotionGate`, `periodicBreathing`, `deviceScoredAHI` — so a change confined to
 * those paths still reds nothing here. That is a known bound on this fixture, not a claim of
 * night-level coverage; extending it needs inputs that drive those fusers (a CPAP device-scored
 * night for `deviceScoredAHI`, a motion-gated one for `hrvMotionGate`).
 *
 * ⚠️ `hrvNight` IS DELIBERATELY THE TCH INPUTS UNMERGED. Composing them into the apnea night
 * SUPPRESSES `hrvConsensus` — measured: the composed night leaves it empty while the same inputs
 * alone populate it, because the two families anchor their epochs at different times and the merged
 * series no longer overlaps the fusion window. Keeping them as a separate twin is why the pair covers
 * `hrvConsensus` at all; merging them would have quietly lost it.
 *
 * DUAL-MODE (global + module.exports) because dex-tests.js runs in both lanes.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.fusionNightTwins = api.fusionNightTwins;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function req(name) {
    if (typeof require === 'function') return require('./' + name + '.js');
    return null;
  }

  /* Merge every input for one node into a single export: the Integrator adapts ONE record per node,
     so two exports for the same node would otherwise drop one silently. */
  function mergeByNode(groups) {
    const byNode = new Map();
    for (const group of groups) {
      for (const x of group || []) {
        const cur = byNode.get(x.node);
        if (!cur) {
          byNode.set(x.node, JSON.parse(JSON.stringify(x.json)));
          continue;
        }
        for (const k of Object.keys(x.json)) {
          if (k === 'ganglior_events' && Array.isArray(x.json[k])) {
            cur[k] = (cur[k] || []).concat(x.json[k]);
          } else if (!(k in cur) || cur[k] == null) {
            cur[k] = x.json[k];
          } else if (k === 'hrv' || k === 'respiration' || k === 'timeseries') {
            cur[k] = Object.assign({}, cur[k], x.json[k]);
          }
        }
      }
    }
    const out = [];
    for (const [node, json] of byNode) out.push({ node: node, json: json });
    return out;
  }

  /* ⚠ THE THREE SIBLING FILES ONCE EXPOSED THEMSELVES THREE DIFFERENT WAYS, and assuming they did not
     is what broke the browser lane while Node stayed green (#2264): `tch-golden-inputs.js` published
     only a NAMESPACE (`root.TchGoldenInputs = { tchGoldenInputs }`), so the bare name was undefined in
     the browser, while its two siblings were bare globals. Node hid all of it — `require` returns the
     module exports regardless of the global shape.
     ALL FOUR NOW EXPOSE THEIR BARE NAME and nothing but their own identifier (residue
     `2026-09-06-twin-builders-three-export-shapes`); `TchGoldenInputs` is kept as a back-compat alias,
     which is why the namespace rung below is still wired. The shape is now gate-backed in the NODE
     lane — the `tests · twin-builders` group evaluates each file in a bare `vm` context, which is
     classic-script semantics, so the lane that could not see this now can.
     `pick` stays as defence in depth: it tries bare global, then namespace object, then require, and
     THROWS BY NAME. The original one-liner failed as
     "(intermediate value)(intermediate value) is not a function", which names neither the builder nor
     the lane — diagnosis, where the group above is prevention. */
  function pick(bareName, nsName, modName, key) {
    const g = typeof globalThis !== 'undefined' ? globalThis : {};
    if (typeof g[bareName] === 'function') return g[bareName];
    const ns = nsName ? g[nsName] : null;
    if (ns && typeof ns[key] === 'function') return ns[key];
    const m = req(modName);
    if (m && typeof m[key] === 'function') return m[key];
    throw new Error(
      'fusion-night-twins: cannot resolve ' +
        key +
        ' — tried global `' +
        bareName +
        '`, namespace `' +
        (nsName || '-') +
        '.' +
        key +
        '`, and require("./' +
        modName +
        '.js"). In the browser lane the file must be ' +
        'loaded by a <script src> tag in Dex-Test-Suite.html AND expose one of those two shapes.'
    );
  }

  function fusionNightTwins() {
    const apnea = pick('apneaNullTwins', null, 'apnea-null-twins', 'apneaNullTwins')();
    const tch = pick('tchGoldenInputs', 'TchGoldenInputs', 'tch-golden-inputs', 'tchGoldenInputs')();
    const respAll = pick('respirationFusionTwins', null, 'respiration-fusion-twins', 'respirationFusionTwins')();
    const resp = respAll.agree || [];

    return {
      /* Nodes CORROBORATE: desaturations and surges coupled, respiration agreeing. */
      apneaNight: mergeByNode([apnea.coupled, resp]),
      /* The paired opposite — the SAME shape with the coupling removed, so a diff between the two
         twins isolates coupling rather than "some inputs changed". */
      uncoupledNight: mergeByNode([apnea.uncoupled, resp]),
      /* Unmerged on purpose — see the header. This is the only twin that populates hrvConsensus. */
      hrvNight: tch.map(function (x) {
        return { node: x.node, json: x.json };
      })
    };
  }

  return { fusionNightTwins: fusionNightTwins };
});
