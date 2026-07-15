/* ═════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   Ganglior · EXPORT PROVENANCE  (ganglior-provenance.js)          [R1]
   ─────────────────────────────────────────────────────────────────
   Makes every export attributable to the exact CODE + INPUTS that
   produced it — the root blocker the audit (R1) flagged: "code must
   reproduce outputs."  100% local, no network, self-contained. Load
   this FIRST in every Dex src.html (before the DSP/app scripts) so the
   read-hook is installed before any file is ingested.

   What it stamps (splice GangliorProvenance.stamp() into schema.provenance):
     • buildHash — SHA-256[0:12] of the running bundle's source, INTENDED to be
       the immutable `<script type="__bundler/template">` (the pristine pre-bundle
       HTML). ⚠️ REALITY (verified June 2026): in a bundled app the inliner's
       loader `document.documentElement.replaceWith()`s the whole DOM during
       unpack, so by the time this module (eval'd from the manifest) computes the
       hash, the template script is ALREADY GONE — querySelector returns null and
       buildSource() falls through to the fallback (inline <script>/<style> text,
       then outerHTML). The eval'd app code is NOT inline <script>, so at runtime
       buildHash effectively fingerprints the tiny bundler BOOTSTRAP + whatever
       <style> is in the DOM — a COARSE skeleton hash that does NOT move for
       .src.html markup, app-JS, or shared-module changes. Do not read it as a
       code fingerprint. It is internally consistent (verify-provenance loads each
       bundle in an iframe and reads THIS same runtime value, and fixtures stamp
       it), so the gate self-agrees — but it only proves "an export came from A
       build of this app," nothing finer.
       The real EXECUTED-CODE fingerprint is manifestHash (SHA-256[0:12] of the
       bundle FILE's `__bundler/manifest`), computed STATICALLY at verification
       time by verify-provenance.html (the runtime can't: the loader strips the
       manifest too). It moves whenever any bundled module changes. Behavior is
       gated separately by Dex-Test-Suite.html. See GENERATOR-FOLLOWUPS-BRIEF §1.
     • inputs[] — { name, bytes, lastModifiedMs(floating), sha256[0:16] } for
       every file FileReader touched this session, captured via a passive hook
       that does NOT change read behaviour. Dedupes by name|size|mtime.
       ⚠️ `name` is PHI-SCRUBBED (EXPORT-IDENTITY-FOLLOWUPS-2026-06-29 §2): only
       the diagnostic vendor family + lane tag + ext survive (e.g.
       "Jane_Smith_2026-06-12_RR.txt" → "RR.txt", "Polar_H10_AAAAAAAA_…_RR.txt"
       → "polar_RR.txt"). The raw name never reaches an export; the dedupe KEY
       still uses it (internal only). bytes/mtime/sha256 were already identity-free.
     • generated — export wall-clock ISO (a real instant; fine for provenance).

   Clock Contract note: lastModifiedMs is converted to FLOATING wall-clock ms
   (subtract the local tz offset), consistent with the rest of the suite, so
   provenance is viewer-timezone-independent too.
   ═════════════════════════════════════════════════════════════════ */
(function () {
  if (window.GangliorProvenance) return;
  var enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  var _inputs = {}; // key → { name, bytes, lastModifiedMs, sha256 }
  var _buildHash = null,
    _buildPromise = null;

  function hex(buf) {
    var b = new Uint8Array(buf),
      s = '';
    for (var i = 0; i < b.length; i++) {
      s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    }
    return s;
  }

  function sha256(data) {
    try {
      if (!(window.crypto && crypto.subtle && crypto.subtle.digest)) return Promise.resolve(null);
      var bytes;
      if (typeof data === 'string') bytes = enc ? enc.encode(data) : null;
      else if (data instanceof ArrayBuffer) bytes = data;
      else if (data && data.buffer)
        bytes = data.buffer; // typed array
      else if (data != null) bytes = enc ? enc.encode(String(data)) : null;
      if (!bytes) return Promise.resolve(null);
      return crypto.subtle.digest('SHA-256', bytes).then(hex, function () {
        return null;
      });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  // real instant → FLOATING wall-clock ms (Clock Contract)
  function floatMs(inst) {
    try {
      return inst - new Date(inst).getTimezoneOffset() * 60000;
    } catch (e) {
      return null;
    }
  }

  // immutable build source: the bundler template IF present, else the code.
  // ⚠️ At runtime in a bundled app the template script is gone (loader
  // replaceWith's the DOM before this runs) → this returns the FALLBACK, which
  // fingerprints the bootstrap, not the app. See module header. The intended
  // template-hash + the executed-code manifestHash are computed statically by
  // verify-provenance.html from the bundle FILE.
  function buildSource() {
    try {
      var tpl = document.querySelector('script[type="__bundler/template"]');
      if (tpl && tpl.textContent) return tpl.textContent;
      var parts = [];
      document.querySelectorAll('script').forEach(function (s) {
        if (!s.src) parts.push(s.textContent || '');
      });
      document.querySelectorAll('style').forEach(function (s) {
        parts.push(s.textContent || '');
      });
      if (parts.length) return parts.join('\n');
    } catch (e) {}
    try {
      return document.documentElement.outerHTML;
    } catch (e) {
      return '';
    }
  }

  function buildHash() {
    if (_buildHash) return Promise.resolve(_buildHash);
    if (_buildPromise) return _buildPromise;
    _buildPromise = sha256(buildSource()).then(function (h) {
      _buildHash = h ? h.slice(0, 12) : null;
      return _buildHash;
    });
    return _buildPromise;
  }
  // compute once, early, off the pristine DOM
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildHash, { once: true });
  else buildHash();

  /* ──────────────────────────────────────────────────────────────────────
   * EXPORT-IDENTITY-FOLLOWUPS-2026-06-29 §2 — PHI scrub on inputs[].name.
   * The parent EXPORT-IDENTITY scrubbed SignalFrame.provenance.files at the
   * adapter ingest boundary, but the FileReader/Blob read-hook below also
   * captured file.name VERBATIM into schema.provenance.inputs[].name — a SECOND
   * pipe carrying a PHI name ("Jane_Smith_…_RR.txt") or a device serial
   * ("Polar_H10_AAAAAAAA_…") into every REAL app export. Decision: SCRUB (not
   * drop, not hash) so the exported name keeps its DIAGNOSTIC value (vendor
   * family + lane tag + ext) while shedding identity — a byte-FAITHFUL MIRROR of
   * SignalFrame.scrubFilename. signal-frame.js is loose-loaded (Data Unifier /
   * OverDex / test pages), NOT bundled into a node shell, so it can't be called
   * here; mirror it like parseTimestamp (a Dex-Test-Suite source-mirror group
   * pins the two copies byte-identical). The DEDUPE key still uses the RAW name
   * (internal only, never exported), so dedup precision is unchanged.
   * ────────────────────────────────────────────────────────────────────── */
  var _VENDOR_SIG = [
    [/polar/i, 'polar'],
    [/o2ring|wellue|viatom/i, 'o2ring'],
    [/welltory/i, 'welltory'],
    [/lingo|libre|abbott/i, 'lingo'],
    [/coospo/i, 'coospo'],
    [/wahoo/i, 'wahoo'],
    [/oura/i, 'oura'],
    [/garmin/i, 'garmin']
  ];
  var _LANE_SIG = /(?:^|[_\-.\s])(RR|PPI|ECG|PPG|HR|ACC|GYRO|MAGN|TEMP|SA2|BRP|PLD|EVE|CSL|SPO2|SDB|MARKER)(?=$|[_\-.\s])/i;
  function scrubFilename(name) {
    var s = String(name == null ? '' : name).replace(/^.*[\\/]/, ''); // drop any path
    var ext = '',
      dot = s.lastIndexOf('.');
    if (dot > 0 && dot > s.length - 8) {
      ext = s
        .slice(dot + 1)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
      s = s.slice(0, dot);
    }
    var frag = [];
    for (var i = 0; i < _VENDOR_SIG.length; i++) {
      if (_VENDOR_SIG[i][0].test(s)) {
        frag.push(_VENDOR_SIG[i][1]);
        break;
      }
    }
    var lane = s.match(_LANE_SIG);
    if (lane) {
      var L = lane[1].toUpperCase();
      frag.push(L === 'SPO2' ? 'SpO2' : L);
    }
    var stem = frag.join('_') || '*'; // nothing diagnostic recognised → scrubbed marker
    return ext ? stem + '.' + ext : stem;
  }

  function noteInput(file, content) {
    try {
      if (!file) return;
      var key = (file.name || '?') + '|' + (file.size || 0) + '|' + (file.lastModified || 0); // RAW name — internal dedupe only, never exported
      if (_inputs[key]) return;
      var rec = {
        name: scrubFilename(file.name), // §2: PHI-scrubbed before it can reach an export
        bytes: file.size != null ? file.size : null,
        lastModifiedMs: file.lastModified ? floatMs(file.lastModified) : null,
        sha256: null
      };
      _inputs[key] = rec;
      sha256(content).then(function (h) {
        if (h) rec.sha256 = h.slice(0, 16);
      });
    } catch (e) {}
  }

  // Passive FileReader hook — records the File + its decoded result as a side
  // effect of the read the app already performs. Never alters behaviour.
  try {
    ['readAsText', 'readAsArrayBuffer'].forEach(function (m) {
      var orig = FileReader.prototype[m];
      if (!orig || orig._gpWrapped) return;
      var wrapped = function (file) {
        try {
          var self = this;
          self.addEventListener(
            'load',
            function () {
              try {
                noteInput(file, self.result);
              } catch (e) {}
            },
            { once: true }
          );
        } catch (e) {}
        return orig.apply(this, arguments);
      };
      wrapped._gpWrapped = true;
      FileReader.prototype[m] = wrapped;
    });
  } catch (e) {}

  // Passive Blob hook — captures nodes that ingest via Blob.text() / Blob.arrayBuffer()
  // instead of FileReader (PpgDex's f.text(), other large text reads). Only Files with
  // a name are recorded; anonymous app-made blobs (e.g. export downloads) are skipped.
  try {
    ['text', 'arrayBuffer'].forEach(function (m) {
      var orig = Blob.prototype[m];
      if (!orig || orig._gpWrapped) return;
      var wrapped = function () {
        var p = orig.apply(this, arguments);
        try {
          var self = this;
          if (self instanceof File && self.name)
            p.then(
              function (res) {
                try {
                  noteInput(self, res);
                } catch (e) {}
              },
              function () {}
            );
        } catch (e) {}
        return p;
      };
      wrapped._gpWrapped = true;
      Blob.prototype[m] = wrapped;
    });
  } catch (e) {}

  window.GangliorProvenance = {
    // Synchronous snapshot for splicing into an export's schema. buildHash is
    // resolved well before any user-triggered export (it runs at load), and
    // input hashes resolve during analysis — both ready by export time.
    stamp: function () {
      var ins = Object.keys(_inputs).map(function (k) {
        return _inputs[k];
      });
      return { buildHash: _buildHash, generated: new Date().toISOString(), inputs: ins };
    },
    buildHash: buildHash, // async → resolves to the hash (for tests/CI)
    noteInput: noteInput // manual hook if an app ingests outside FileReader
  };
})();
