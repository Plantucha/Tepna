/*
 * provenance-ledger.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * ARCHITECTURE-DEBT-REDUCTION-2026-07-14-BRIEF §P3 — the shared ASSEMBLER for the split provenance
 * ledgers. `BUILD-MANIFEST.json` and `FIXTURE-PROVENANCE.json` used to be two single files that EVERY
 * bundle-touching PR rewrote (CLAUDE.md §👥.3: "only one session does bundle/ledger work at a time"),
 * so two parallel app PRs collided on the same bytes. P3 splits them into per-app fragments under
 * `provenance/` — one `provenance/<App>.json` per app carrying THAT app's GATE-A manifestHash AND its
 * GATE-B fixtures — so an OxyDex PR and a GlucoDex PR never edit the same file.
 *
 * This module reassembles those fragments back into the EXACT combined shapes the two monoliths had:
 *   assemble(fragments, meta) -> { buildManifest:{ …meta, bundles:{ 'Foo.html':{manifestHash} } },
 *                                  fixtureProvenance:{ …meta, fixtures:{ '<name>':record } } }
 * so that manifest-gate.js (the pure GATE A/B core) and every consumer that expects `.bundles` /
 * `.fixtures` keep receiving the identical assembled object — they do NOT change. Only the WRITERS
 * (build.mjs, verify-fixtures.mjs, regen-*) and the thin per-realm LOADERS below move.
 *
 * Pure + environment-agnostic core, like manifest-gate.js. `assemble` takes already-read objects; the
 * IO helpers (`loadNode` — fs; `loadBrowser` — fetch) are thin single-source wrappers so the Node CI
 * and the browser gate reassemble by the identical code. Loads in the browser (window.ProvenanceLedger),
 * the Node `vm` runner (ctx.ProvenanceLedger), and Node `require` (module.exports).
 */
(function (root) {
  'use strict';

  // Canonical app order — the 8 shipped bundles, same set + order as ManifestGate.MANIFEST_BUNDLES.
  // `provenance/index.json` MUST list exactly these (a Node-lane gate asserts index === the on-disk set).
  var APPS = ['ECGDex', 'OxyDex', 'PulseDex', 'GlucoDex', 'PpgDex', 'HRVDex', 'CPAPDex', 'Integrator'];

  // A fragment file is `provenance/<App>.json` = { bundle:'<App>.html', manifestHash, fixtures:{…} }.
  // `meta` is `provenance/_meta.json` = { buildManifest:{…_keys}, fixtureProvenance:{…_keys} } — the
  // free-floating `_doc`/`_note_*`/`_generated`/`_profileCoupledStripList`/`_retired` metadata that no
  // code reads programmatically but that the ledgers carry for humans + provenance history.
  //
  // Reassemble the two monolith shapes, byte-equivalent at the PARSED level to the pre-split files:
  //   buildManifest.bundles[<App>.html] = { manifestHash }   (GATE A)
  //   fixtureProvenance.fixtures[<name>] = record             (GATE B; record.bundle names the app)
  function assemble(fragments, meta) {
    meta = meta || {};
    var bundles = {},
      fixtures = {};
    (fragments || []).forEach(function (fr) {
      if (!fr || !fr.bundle) return;
      bundles[fr.bundle] = { manifestHash: fr.manifestHash };
      var fx = fr.fixtures || {};
      Object.keys(fx).forEach(function (name) {
        fixtures[name] = fx[name];
      });
    });
    var buildManifest = Object.assign({}, meta.buildManifest || {}, { bundles: bundles });
    var fixtureProvenance = Object.assign({}, meta.fixtureProvenance || {}, { fixtures: fixtures });
    return { buildManifest: buildManifest, fixtureProvenance: fixtureProvenance };
  }

  // The committed fragment file names an assembler needs, in canonical order: index + meta + per-app.
  function fragmentFiles(apps) {
    apps = apps || APPS;
    return ['index.json', '_meta.json'].concat(
      apps.map(function (a) {
        return a + '.json';
      })
    );
  }

  // ── Node loader (fs) — reads provenance/ off disk and assembles. Node-only (uses the caller's fs/path).
  //   loadNode(fs, path, repoRoot) -> { buildManifest, fixtureProvenance, apps }
  // Reads provenance/index.json for the authoritative app list, then each provenance/<App>.json + _meta.json.
  function loadNode(fs, path, repoRoot) {
    var dir = path.join(repoRoot, 'provenance');
    var index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    var apps = index.apps || APPS;
    var meta = JSON.parse(fs.readFileSync(path.join(dir, '_meta.json'), 'utf8'));
    var fragments = apps.map(function (a) {
      return JSON.parse(fs.readFileSync(path.join(dir, a + '.json'), 'utf8'));
    });
    var out = assemble(fragments, meta);
    out.apps = apps;
    return out;
  }

  // ── Browser loader (fetch) — the pure-static gate lane has no filesystem, so it fetches the committed
  // index then each fragment. Mirrors loadNode exactly (single-source reassembly).
  //   loadBrowser(fetchText) -> Promise<{ buildManifest, fixtureProvenance, apps }>
  // fetchText(name) must resolve provenance/<name> to its text (or null); a null index falls back to APPS.
  function loadBrowser(fetchText) {
    return Promise.resolve(fetchText('provenance/index.json')).then(function (idxText) {
      var apps = APPS;
      if (idxText) {
        try {
          var idx = JSON.parse(idxText);
          if (idx && idx.apps) apps = idx.apps;
        } catch (_e) {
          /* fall back to APPS */
        }
      }
      return Promise.resolve(fetchText('provenance/_meta.json')).then(function (metaText) {
        var meta = metaText ? JSON.parse(metaText) : {};
        return Promise.all(
          apps.map(function (a) {
            return Promise.resolve(fetchText('provenance/' + a + '.json')).then(function (t) {
              return t ? JSON.parse(t) : null;
            });
          })
        ).then(function (fragments) {
          var out = assemble(
            fragments.filter(function (f) {
              return !!f;
            }),
            meta
          );
          out.apps = apps;
          return out;
        });
      });
    });
  }

  var ProvenanceLedger = {
    APPS: APPS,
    assemble: assemble,
    fragmentFiles: fragmentFiles,
    loadNode: loadNode,
    loadBrowser: loadBrowser
  };
  root.ProvenanceLedger = ProvenanceLedger;
  if (typeof module !== 'undefined' && module.exports) module.exports = ProvenanceLedger;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
