/*
 * manifest-gate.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * EXPORT-IDENTITY-FOLLOWUPS-IV §1 — the ONE source of verify-provenance.html's GATE-A core: the
 * canonical bundle list, the `__bundler/manifest` extraction, the manifestHash fingerprint (the
 * EXECUTED-code identity, external-review #7), and the committed-vs-current compare. Extracted so
 * the verify-provenance PAGE and the headless Node sibling (tests/verify-manifest.mjs) compute
 * manifestHash and decide GATE A by the SAME code — a drift between page and CI is impossible by
 * construction (the pickProvenanceBanner lesson, provenance-banner.js: a private mirror in the
 * runner silently passing while the page moved on).
 *
 * SIGNAL-ADAPTER-AND-FRONTIER Phase 7 added the GATE-B core here too (gateBFiles + gateBEvaluate +
 * sha16): the content-addressed known-answer audit that REPLACED the coarse runtime-buildHash fixture
 * check. Same single-source contract — page + Node CI run the identical content-addressed evaluation.
 * GATE B is now pure-static (input/code/output content hashes), so verify-provenance.html no longer
 * boots bundles in iframes and reads no buildHash at all.
 *
 * manifestHash is a UUID-INDEPENDENT PROJECTION of the manifest, NOT a hash of its raw text
 * (PROVENANCE-NONDETERMINISM-2026-06-29-BRIEF §1, option a): super_inline_html keys every manifest
 * asset by a fresh crypto.randomUUID() per build, so hashing the raw manifest script was
 * non-deterministic (re-bundling identical source moved the hash). Instead: JSON.parse the
 * manifest, DROP the UUID keys, and for each asset emit `mime \0 compressed \0 sha256(DECOMPRESSED
 * bytes)`; SORT (order-independent); SHA-256[0:12] the join. That is a pure function of the bundled
 * CONTENT — stable across re-bundles of identical source, moving ONLY on a real JS/CSS change.
 *
 * Pure + environment-agnostic: no DOM, no fetch, no fs. The CALLER supplies the bundle TEXT
 * (browser: fetch; Node: fs.readFileSync); this module does parse + decompress + hash + compare,
 * using only Web platform globals present in BOTH browsers and Node >= 18 (crypto.subtle,
 * TextEncoder, atob, Blob, Response, DecompressionStream), so the 12-hex digest is byte-identical
 * in both — exactly the algorithm verify-provenance.html ran inline. Loads in the browser
 * (window.ManifestGate), the Node `vm` runner (ctx.ManifestGate), and Node `require`
 * (module.exports).
 */
(function (root) {
  'use strict';

  // Canonical bundle set — the 9 shipped apps. SINGLE source: verify-provenance.html no longer
  // inlines its own list, and BUILD-MANIFEST.json's `bundles` keys must equal this set.
  var MANIFEST_BUNDLES = ['ECGDex.html', 'OxyDex.html', 'PulseDex.html', 'GlucoDex.html', 'PpgDex.html', 'HRVDex.html', 'CPAPDex.html', 'Integrator.html', 'MotionDex.html'];

  // LEGACY-FORMAT DETECTOR ONLY (OWN-THE-BUILD Phase 4, 2026-07-03). The platform inliner's
  // gzip+UUID format is RETIRED — every shipped bundle is owned plain-inline (tools/build.mjs).
  // This regex remains solely so isPlainInline() can refuse to hash a REGRESSED bundle (one
  // re-bundled via the old inliner): it hashes to null → GATE A 'missing-current' → red.
  var MANIFEST_RE = /<script type="__bundler\/manifest">([\s\S]*?)<\/script>/;

  // ── PLAIN-INLINE branch (OWN-THE-BUILD-2026-06-30 Part A) ──────────────────────────────────
  // tools/build.mjs emits a dependency-free bundle whose executed blocks each carry
  // `data-inline-src` (external files by path; inline shell <script>/<style> by an ordinal name)
  // — NO gzip, NO random UUID keys. These two regexes are the SHARED extraction contract with
  // tools/build-core.js (DexBuild.INLINE_*_RE); the two must stay byte-identical so build-core's
  // sync hash and this async recompute can never disagree (the whole point of a single source).
  var PLAIN_SCRIPT_RE = /<script\b[^>]*\bdata-inline-src="([^"]*)"[^>]*>([\s\S]*?)<\/script>/gi;
  var PLAIN_STYLE_RE = /<style\b[^>]*\bdata-inline-src="([^"]*)"[^>]*>([\s\S]*?)<\/style>/gi;

  function isPlainInline(bundleText) {
    return typeof bundleText === 'string' && /\bdata-inline-src="/.test(bundleText) && !MANIFEST_RE.test(bundleText);
  }

  function plainInlineAssets(bundleText) {
    var assets = [],
      m;
    PLAIN_SCRIPT_RE.lastIndex = 0;
    for (m = PLAIN_SCRIPT_RE.exec(bundleText); m !== null; m = PLAIN_SCRIPT_RE.exec(bundleText)) assets.push({ name: m[1], text: m[2] });
    PLAIN_STYLE_RE.lastIndex = 0;
    for (m = PLAIN_STYLE_RE.exec(bundleText); m !== null; m = PLAIN_STYLE_RE.exec(bundleText)) assets.push({ name: m[1], text: m[2] });
    return assets;
  }

  // Plain-inline manifestHash — SHA-256[0:12] of the SORTED `logicalName \0 sha256(assetText)`
  // over EVERY inlined block. Same projection shape as the legacy branch (sorted, order-independent,
  // [0:12]); the ASYNC twin of build-core.js manifestHashFromInline (identical value by construction).
  async function manifestHashPlainInline(bundleText) {
    var assets = plainInlineAssets(bundleText),
      parts = [];
    for (var i = 0; i < assets.length; i++) parts.push(assets[i].name + '\u0000' + (await sha256hex(assets[i].text)));
    parts.sort();
    return (await sha256hex(parts.join('\n'))).slice(0, 12);
  }

  function hex(buf) {
    var b = new Uint8Array(buf),
      s = '';
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return s;
  }

  // SHA-256 hex of a string OR a Uint8Array (full 64-hex; the manifestHash convention slices to 12).
  function sha256hex(input) {
    var data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
    return root.crypto.subtle.digest('SHA-256', data).then(hex);
  }

  // sha256[0:16] of a string OR Uint8Array — the content-addressed FILE fingerprint convention (matches
  // ganglior-provenance.js inputs[].sha256[0:16]). GATE B's input/output hashes (Phase 7).
  function sha16(input) {
    return sha256hex(input).then(function (h) {
      return h.slice(0, 16);
    });
  }

  // Bundle TEXT -> manifestHash (Promise<string|null>; null when the text carries no manifest —
  // e.g. an un-bundled *.src.html). The UUID-independent content projection described in the header.
  // This IS verify-provenance.html's manifestHashOf minus the fetch (the IO stays in the caller).
  async function manifestHashFromText(bundleText) {
    // OWN-THE-BUILD Phase 4 (2026-07-03): the legacy __bundler/manifest hashing branch is RETIRED —
    // every shipped bundle is owned plain-inline. A bundle still carrying a __bundler/manifest
    // (regressed via the platform inliner) DELIBERATELY hashes to null so GATE A reds
    // ('missing-current') and points at the owned rebuild: `node tools/build.mjs --app <Name>`.
    // Un-bundled *.src.html (no data-inline-src either) also returns null.
    if (isPlainInline(bundleText)) return manifestHashPlainInline(bundleText);
    return null;
  }

  /* ══ computeHash — "EXPORT-INERT" AS A COMPUTED VALUE, NOT A CLAIM ════════════════════════════
     (FIXTURE-VERIFICATION-GATE-2026-07-14 §1.)

     manifestHash identifies ALL executed code, so it moves on a CSS tweak. That is correct for GATE A
     and useless for the question that actually matters when a fixture is at stake:

         "could this change have moved an EXPORT?"

     For months that question was answered in prose. `FIXTURE-PROVENANCE.json` is full of
     `note_*: "EXPORT-INERT … outputHash UNCHANGED"` — the single most-repeated assertion in this repo's
     history. On 2026-07-14 one of them was WRONG: DEEP-AUDIT §1 rerouted every GlucoDex distribution
     metric, checked only the synthetic golden (which trips no long gap), declared itself export-inert,
     and shipped — while the REAL night's export had moved. The served app then ran a pre-fix DSP against
     real users' CGM data. A claim that load-bearing must be COMPUTED.

     computeHash is manifestHash's projection restricted to the export's COMPUTE CLOSURE: every inlined
     asset that can reach compute(). Then:

         render / CSS / app copy  →  manifestHash moves, computeHash STABLE  →  export-inert, PROVEN
         DSP / clock / export / registry edit  →  BOTH move  →  re-verification owed

     THE CLOSURE IS A DENYLIST, ON PURPOSE — and this is the load-bearing design choice. An ALLOWLIST of
     "compute modules" (what the brief first sketched) fails OPEN: forget to list a module and its edits
     silently do not move computeHash, so the gate goes BLIND — the exact failure mode we are here to kill.
     A denylist fails CLOSED: forget to exclude a display file and computeHash merely OVER-flags, costing
     one needless re-verification. Unknown asset ⇒ in the closure. We accept false alarms; we do not accept
     a gate that cannot see.

     So a change to `synth-gen.js` or `ganglior-provenance.js` DOES move computeHash even though it is
     almost certainly export-inert. That is the design working, not a bug. ═══════════════════════════ */
  var DISPLAY_ONLY = [
    /\.css$/i, // stylesheets — cannot reach compute()
    /^inline:style:/, // the bundle's inline <style> shells
    /-render\.js$/, // <node>-render.js — DOM painting
    /-app\.js$/, // <node>-app.js — host/event wiring
    /^(?:oxy|pulse|hrv|gluco|ppg|ecg|cpap|eeg)dex-profile\.js$/, // per-node profile UI (NOT the shared dex-profile.js engine, which feeds metrics)
    /^dex-actions\.js$/, // action-bar UI
    /^entrance-guard\.js$/, // entry gate UI
    /^dex-forget\.js$/ // storage-wipe UI
  ];

  function isComputeAsset(name) {
    for (var i = 0; i < DISPLAY_ONLY.length; i++) if (DISPLAY_ONLY[i].test(name)) return false;
    return true; // fail CLOSED — an asset we do not recognise counts as compute
  }

  // Bundle TEXT -> computeHash (Promise<string|null>). Same projection as manifestHash — sorted
  // `logicalName \0 sha256(assetText)`, SHA-256[0:12] — over the compute closure only. null for a
  // non-plain-inline bundle, exactly like manifestHashFromText.
  async function computeHashFromText(bundleText) {
    if (!isPlainInline(bundleText)) return null;
    var assets = plainInlineAssets(bundleText),
      parts = [];
    for (var i = 0; i < assets.length; i++) {
      if (!isComputeAsset(assets[i].name)) continue;
      parts.push(assets[i].name + ' ' + (await sha256hex(assets[i].text)));
    }
    parts.sort();
    return (await sha256hex(parts.join('\n'))).slice(0, 12);
  }

  // The closure a bundle's computeHash actually covers — for gates + humans to inspect ("what does
  // this hash watch?"), so the denylist can never be a silent, unauditable decision.
  function computeClosure(bundleText) {
    return plainInlineAssets(bundleText)
      .map(function (a) {
        return a.name;
      })
      .filter(isComputeAsset)
      .sort();
  }

  // GATE A compare — current executed-code manifestHash per bundle vs the committed BUILD-MANIFEST.
  //   current   : { 'Foo.html': '<12hex>' | null }    (computed via manifestHashFromText)
  //   committed : { 'Foo.html': { manifestHash } }      (BUILD-MANIFEST.json `bundles`; null/absent
  //                                                       => the manifest itself failed to load)
  // -> { results:[{file,current,committed,status}], checked, fail, missing, complete, ok }
  //   status: 'match' | 'drift' | 'missing-current' | 'missing-committed'
  // Counters mirror verify-provenance.html's historical three-way branch EXACTLY so the shared
  // pickProvenanceBanner() banner reads identically (fail = drift + missing-current; a null current
  // with a committed hash is a FAIL, never a skip — the bundle didn't reproduce its committed hash).
  function gateACompare(current, committed, bundles) {
    bundles = bundles || MANIFEST_BUNDLES;
    current = current || {};
    var hasCommitted = !!(committed && typeof committed === 'object');
    var results = [],
      checked = 0,
      fail = 0,
      missing = 0;
    for (var i = 0; i < bundles.length; i++) {
      var f = bundles[i];
      var cur = current[f] == null ? null : current[f];
      var cm = hasCommitted && committed[f] && committed[f].manifestHash != null ? committed[f].manifestHash : null;
      var status;
      if (cm == null) {
        status = 'missing-committed';
        missing++;
      } else if (cur === cm) {
        status = 'match';
        checked++;
      } else {
        status = cur == null ? 'missing-current' : 'drift';
        checked++;
        fail++;
      }
      results.push({ file: f, current: cur, committed: cm, status: status });
    }
    var complete = checked === bundles.length;
    return { results: results, checked: checked, fail: fail, missing: missing, complete: complete, ok: fail === 0 && missing === 0 && complete };
  }

  // ── GATE B — content-addressed known-answer audit (SIGNAL-ADAPTER-AND-FRONTIER Phase 7) ──────────
  // REPLACES the coarse runtime-buildHash fixture check. Each FIXTURE-PROVENANCE.json record is a
  // self-contained known-answer triple — hash(input) + hash(executedCode=manifestHash) -> hash(output):
  //   code-gated: { bundle, manifestHash, inputHashes:{file:16hex}, outputHash:16hex }
  //   historical: { bundle, historical:true, outputHash:16hex }  (byte-pinned only; NOT code-reproducible)
  // A code-gated fixture is reproducible iff (1) its producing bundle's CURRENT manifestHash == the
  // recorded one (code identity — the same teeth the old per-fixture manifestHash check had), (2) every
  // committed INPUT file still hashes to the recorded inputHash, and (3) the committed OUTPUT file still
  // hashes to the recorded outputHash. NO buildHash anywhere -> no runtime race, no iframe boot: pure-static.

  // The committed files GATE B references: every fixture OUTPUT name + every code-gated INPUT. The caller
  // fetches/reads each (browser: fetch uploads/<f>; Node: fs uploads/<f>) and sha16's it into fileHashes,
  // keeping IO in the caller (the manifestHashFromText pattern). uploads/ is gitignored, so a file may be
  // absent (CI) -> the caller passes null and GATE B SKIPS it (not a fail), mirroring the equiv-gate self-skip.
  function gateBFiles(fixtures) {
    fixtures = fixtures || {};
    var set = {};
    Object.keys(fixtures).forEach(function (name) {
      if (name.charAt(0) === '_') return; // metadata key (_doc / _note_* / _retired / ...)
      set[name] = 1;
      var ih = (fixtures[name] || {}).inputHashes || {};
      Object.keys(ih).forEach(function (f) {
        set[f] = 1;
      });
    });
    return Object.keys(set).sort();
  }

  //   fixtures   : FIXTURE-PROVENANCE.json `fixtures` map (keys starting with '_' are metadata, skipped)
  //   currentMHs : { 'Foo.html': '<12hex>'|null }  live recomputed manifestHash per bundle (manifestHashFromText)
  //   fileHashes : { '<committed file name>': '<16hex>'|null }  caller-computed sha16 of each gateBFiles()
  //                entry; null = not available to the caller (gitignored uploads/ absent in CI = a SKIP).
  // -> { results:[{name,bundle,kind,status,detail}], checked, fail, absent, ok }
  //   status: 'reproducible' | 'historical-ok' | 'code-drift' | 'input-drift' | 'output-drift'
  //         | 'output-absent' | 'input-absent' | 'bundle-unloaded'
  // ok = fail===0 (a real drift). 'absent' rows are skips (uploads/ not served) — the CALLER decides their
  // severity (browser shows a warn row; Node CI treats them as skip since uploads/ is gitignored).
  function gateBEvaluate(fixtures, currentMHs, fileHashes) {
    fixtures = fixtures || {};
    currentMHs = currentMHs || {};
    fileHashes = fileHashes || {};
    var results = [],
      checked = 0,
      fail = 0,
      absent = 0;
    Object.keys(fixtures).forEach(function (name) {
      if (name.charAt(0) === '_') return;
      var rec = fixtures[name] || {};
      var bundle = rec.bundle || null;
      var kind = rec.historical ? 'historical' : 'code-gated';
      var status,
        detail = '';
      var outNow = fileHashes[name]; // sha16 of the committed fixture (output) file
      if (outNow == null) {
        status = 'output-absent';
        detail = 'committed fixture not available (uploads/ gitignored?)';
        absent++;
      } else if (rec.outputHash && outNow !== rec.outputHash) {
        status = 'output-drift';
        detail = 'output ' + outNow + ' \u2260 recorded ' + rec.outputHash;
        fail++;
      } else if (rec.historical) {
        status = 'historical-ok';
        detail = 'byte-pinned (not code-gated)';
        checked++;
      } else {
        var cur = currentMHs[bundle];
        if (cur == null) {
          status = 'bundle-unloaded';
          detail = bundle + ' manifestHash unavailable (see GATE A)';
          absent++;
        } else if (cur !== rec.manifestHash) {
          status = 'code-drift';
          detail = bundle + ' is ' + cur + ', fixture made by ' + rec.manifestHash;
          fail++;
        } else {
          var ih = rec.inputHashes || {},
            inNames = Object.keys(ih),
            bad = null,
            miss = null;
          for (var i = 0; i < inNames.length; i++) {
            var f = inNames[i],
              now = fileHashes[f];
            if (now == null) {
              miss = f;
              break;
            }
            if (now !== ih[f]) {
              bad = f;
              break;
            }
          }
          if (miss) {
            status = 'input-absent';
            detail = 'input ' + miss + ' not available';
            absent++;
          } else if (bad) {
            status = 'input-drift';
            detail = 'input ' + bad + ' changed (' + fileHashes[bad] + ' \u2260 ' + ih[bad] + ')';
            fail++;
          } else {
            status = 'reproducible';
            detail = inNames.length + ' input(s) + output pinned @ ' + rec.manifestHash;
            checked++;
          }
        }
      }
      results.push({ name: name, bundle: bundle, kind: kind, status: status, detail: detail });
    });
    return { results: results, checked: checked, fail: fail, absent: absent, ok: fail === 0 };
  }

  var ManifestGate = {
    MANIFEST_BUNDLES: MANIFEST_BUNDLES,
    MANIFEST_RE: MANIFEST_RE,
    isPlainInline: isPlainInline,
    plainInlineAssets: plainInlineAssets,
    sha256hex: sha256hex,
    sha16: sha16,
    manifestHashFromText: manifestHashFromText,
    computeHashFromText: computeHashFromText,
    computeClosure: computeClosure,
    isComputeAsset: isComputeAsset,
    gateACompare: gateACompare,
    gateBFiles: gateBFiles,
    gateBEvaluate: gateBEvaluate
  };
  root.ManifestGate = ManifestGate;
  if (typeof module !== 'undefined' && module.exports) module.exports = ManifestGate;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : /** @type {any} */ (this));
