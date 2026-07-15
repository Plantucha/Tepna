/*
 * dex-registry-gen.js — Tepna codegen: manifest → <node>-registry.js
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * SIGNAL-ADAPTER-AND-FRONTIER brief Phase 3 (manifest-as-single-source). A
 * metric's GRADE is the registry's job today (each `*-registry.js` is the
 * evidence-tier source of truth). This generator PROJECTS a faithful
 * `<node>-registry.js` from one manifest so a NEW node declares each metric's
 * { label, unit, goodDirection, depth, evidence, cite } ONCE — collapsing the
 * "grade restated in registry + cross-block + reference guide" duplication
 * (brief §1) into one source + a generated projection.
 *
 * FORWARD-FIRST: this is for NEW nodes (EEGDex/SpiroDex/UltrahumanDex). It does
 * NOT regenerate the 7 existing hand-written registries (brief Phase 3). The
 * output is byte-faithful to the live registry contract (ecgdex-registry.js):
 * `<NODE>_REGISTRY` map + a `<Node>Registry` resolver (idForLabel/badgeForLabel/
 * depthForLabel) + auto-built label-alias map. Dependency-free; runs in Node
 * (CLI) or any JS sandbox via generateRegistry(manifest) → source string.
 *
 * Manifest additions Phase 3 introduces (per metric, alongside the existing
 * id/abbr/name/fullName/tier/unit/formula): REQUIRED `evidence` (one of the
 * 5-level ladder) and `goodDirection` ('up'|'down'|'neutral'); optional `cite`
 * (defaults to fullName), `aliases` (extra label spellings → id), and `metaDeny`
 * section-level non-metric labels.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  // canonical 5-level evidence ladder (mirrors MetricRegistry.EVIDENCE_ORDER).
  var EVIDENCE = ['measured', 'validated', 'emerging', 'experimental', 'heuristic'];
  // tier (disclosure depth) → registry `depth`.
  var TIER_DEPTH = { core: 'basic', secondary: 'advanced', research: 'research' };
  // retired vocabulary the cohesion gate forbids — fail loudly if a manifest uses it.
  var RETIRED = { proxy: 'heuristic', composite: 'experimental', 'provisionally validated': 'emerging' };

  function pascal(node) {
    // "EEGDex" → "Eeg" stem for the resolver object name (matches EcgRegistry)
    var stem = String(node).replace(/Dex$/, '');
    return stem.charAt(0).toUpperCase() + stem.slice(1).toLowerCase() + 'Registry';
  }
  function upperStem(node) {
    // "EEGDex" → "EEG" for EEG_REGISTRY (acronym stems stay all-caps per LEXICON §4)
    return String(node).replace(/Dex$/, '').toUpperCase();
  }
  function norm(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function jsStr(s) {
    return (
      "'" +
      String(s == null ? '' : s)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'") +
      "'"
    );
  }

  // Validate + normalize the manifest's metric set; throws on a contract breach
  // (missing/invalid evidence, retired vocabulary) so a bad manifest never ships.
  function collectMetrics(manifest) {
    var out = [],
      deny = {},
      seen = {};
    (manifest.sections || []).forEach(function (sec) {
      (sec.metaDeny || []).forEach(function (d) {
        deny[norm(d)] = 1;
      });
      (sec.metrics || []).forEach(function (m) {
        if (!m.id) throw new Error('metric missing id in section ' + sec.id);
        if (seen[m.id]) throw new Error('duplicate metric id: ' + m.id);
        seen[m.id] = 1;
        var ev = m.evidence;
        if (RETIRED[ev]) throw new Error('metric ' + m.id + ' uses RETIRED evidence vocabulary "' + ev + '" — use "' + RETIRED[ev] + '"');
        if (EVIDENCE.indexOf(ev) < 0) throw new Error('metric ' + m.id + ' has invalid/missing evidence "' + ev + '" — must be one of ' + EVIDENCE.join('|'));
        var gd = m.goodDirection || 'neutral';
        if (['up', 'down', 'neutral'].indexOf(gd) < 0) throw new Error('metric ' + m.id + ' bad goodDirection "' + gd + '"');
        out.push({
          id: m.id,
          label: m.abbr || m.name || m.id,
          unit: m.unit || '',
          goodDirection: gd,
          depth: TIER_DEPTH[m.tier] || 'advanced',
          evidence: ev,
          cite: m.cite || m.fullName || m.name || m.id,
          aliasLabels: [m.name, m.abbr, m.fullName].concat(m.aliases || [])
        });
      });
    });
    if (!out.length) throw new Error('manifest has no metrics');
    return { metrics: out, deny: deny };
  }

  // Build the normalized-label → id alias map (so reference-guide card titles + dense
  // labels resolve to a grade). Skips aliases that collide with a different id's
  // direct key, mirroring how idForLabel checks REGISTRY[k] first.
  function buildAlias(metrics) {
    var directKeys = {};
    metrics.forEach(function (m) {
      directKeys[norm(m.id)] = m.id;
    });
    var alias = {},
      conflicts = [];
    metrics.forEach(function (m) {
      m.aliasLabels.forEach(function (lbl) {
        var k = norm(lbl);
        if (!k) return;
        if (directKeys[k] && directKeys[k] !== m.id) {
          conflicts.push(k + '→' + m.id + ' (vs id ' + directKeys[k] + ')');
          return;
        }
        if (directKeys[k] === m.id) return; // resolves directly, no alias needed
        if (alias[k] && alias[k] !== m.id) {
          conflicts.push(k + '→' + m.id + ' (vs alias ' + alias[k] + ')');
          return;
        }
        alias[k] = m.id;
      });
    });
    return { alias: alias, conflicts: conflicts };
  }

  function generateRegistry(manifest) {
    var node = manifest.node;
    if (!node) throw new Error('manifest.node required');
    var REG = upperStem(node) + '_REGISTRY';
    var ALIASV = upperStem(node) + '_LABEL_ALIAS';
    var Resolver = pascal(node);
    var col = collectMetrics(manifest);
    var ab = buildAlias(col.metrics);

    var L = [];
    L.push('/*');
    L.push(' * ' + node.toLowerCase() + '-registry.js — Tepna · METRIC REGISTRY DATA (GENERATED)');
    L.push(' * Copyright 2026 Michal Planicka');
    L.push(' * SPDX-License-Identifier: Apache-2.0');
    L.push(' *');
    L.push(' * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the');
    L.push(' * project root, or http://www.apache.org/licenses/LICENSE-2.0');
    L.push(' *');
    L.push(' * ⚙ GENERATED by codegen/dex-registry-gen.js from codegen/manifests/' + node.toLowerCase() + '.manifest.json');
    L.push(' *   (SIGNAL-ADAPTER brief Phase 3, manifest-as-single-source). Edit the MANIFEST,');
    L.push(' *   not this file. Per-node DATA map for the System-Cohesion layer; the SHARED');
    L.push(' *   badge/legend/tier/persistence logic lives in metric-registry.js. Load AFTER');
    L.push(' *   metric-registry.js, BEFORE ' + node.toLowerCase() + '-render.js.');
    L.push(' */');
    L.push('(function (global) {');
    L.push("'use strict';");
    L.push('');
    L.push('var ' + REG + ' = {');
    col.metrics.forEach(function (m) {
      L.push(
        '  ' + m.id + ': { label:' + jsStr(m.label) + ', unit:' + jsStr(m.unit) + ', goodDirection:' + jsStr(m.goodDirection) + ', depth:' + jsStr(m.depth) + ', evidence:' + jsStr(m.evidence) + ','
      );
      L.push('    cite:' + jsStr(m.cite) + ' },');
    });
    L.push('};');
    L.push('');
    L.push('var ' + ALIASV + ' = {');
    Object.keys(ab.alias).forEach(function (k) {
      L.push('  ' + jsStr(k) + ':' + jsStr(ab.alias[k]) + ',');
    });
    L.push('};');
    L.push('');
    L.push("function _norm(s){ return String(s==null?'':s).toLowerCase().replace(/<[^>]*>/g,'').replace(/\\s+/g,' ').trim(); }");
    L.push('');
    L.push('/* idForLabel(label) → registry id | null */');
    L.push('function idForLabel(label){');
    L.push('  var k = _norm(label);');
    L.push('  if(' + REG + '[k]) return k;');
    L.push('  return ' + ALIASV + '[k] || null;');
    L.push('}');
    L.push('');
    // META_DENY from section-level metaDeny + a small structural default set.
    var denyKeys = Object.keys(col.deny);
    L.push(
      "var _META_DENY = { 'date':1, 'start':1, 'end':1, 'source':1, 'sample rate':1, 'recording':1, 'duration':1, 'scenario':1, 'metric':1, 'tier':1" +
        (denyKeys.length
          ? ', ' +
            denyKeys
              .map(function (k) {
                return jsStr(k) + ':1';
              })
              .join(', ')
          : '') +
        ' };'
    );
    L.push('');
    L.push("/* badgeForLabel(label, fallback) → evidence-dot span | '' (coverage mandate). */");
    L.push('function badgeForLabel(label, fallback){');
    L.push("  if(!global.MetricRegistry) return '';");
    L.push('  var n = _norm(label);');
    L.push("  if(n === '' || n.charAt(0) === '\\u2014' || n.charAt(0) === '\\u2192') return '';");
    L.push('  var id = idForLabel(label);');
    L.push('  if(!id){');
    L.push("    if(fallback && !_META_DENY[n]) return global.MetricRegistry.badge('experimental','');");
    L.push("    return '';");
    L.push('  }');
    L.push('  var d = global.MetricRegistry.entry(' + REG + ', id);');
    L.push('  return global.MetricRegistry.badge(d.evidence, d.cite);');
    L.push('}');
    L.push('');
    L.push("/* depthForLabel(label) → 'basic'|'advanced'|'research'|null */");
    L.push('function depthForLabel(label){');
    L.push('  var id = idForLabel(label); if(!id) return null;');
    L.push('  return global.MetricRegistry ? global.MetricRegistry.entry(' + REG + ', id).depth : null;');
    L.push('}');
    L.push('');
    L.push('global.' + REG + ' = ' + REG + ';');
    L.push('global.' + Resolver + ' = {');
    L.push('  REGISTRY: ' + REG + ', ALIAS: ' + ALIASV + ',');
    L.push('  idForLabel: idForLabel, badgeForLabel: badgeForLabel, depthForLabel: depthForLabel');
    L.push('};');
    L.push('');
    L.push("})(typeof window !== 'undefined' ? window : globalThis);");
    return { source: L.join('\n') + '\n', conflicts: ab.conflicts, metricCount: col.metrics.length, regName: REG, resolverName: Resolver };
  }

  var api = { generateRegistry: generateRegistry, EVIDENCE: EVIDENCE, TIER_DEPTH: TIER_DEPTH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DexRegistryGen = api;

  // Node CLI: node dex-registry-gen.js manifests/eegdex.manifest.json --output eegdex-registry.js
  if (typeof require !== 'undefined' && typeof process !== 'undefined' && require.main === module) {
    var fs = require('fs');
    var args = process.argv.slice(2);
    var input = args[0];
    var oi = args.indexOf('--output');
    var output = oi >= 0 ? args[oi + 1] : null;
    if (!input) {
      console.error('usage: node dex-registry-gen.js <manifest.json> [--output <file>]');
      process.exit(1);
    }
    var manifest = JSON.parse(fs.readFileSync(input, 'utf8'));
    var res = generateRegistry(manifest);
    if (res.conflicts.length) console.error('⚠ alias conflicts skipped: ' + res.conflicts.join('; '));
    if (output) {
      fs.writeFileSync(output, res.source);
      console.log('wrote ' + output + ' (' + res.metricCount + ' metrics)');
    } else process.stdout.write(res.source);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
