/*
 * dex-export.js — Tepna shared export-filename helper (CORE/util)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. See the LICENSE and
 * NOTICE files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * ONE source of truth for every node's export download filename
 * (EXPORT-HYGIENE-2026-06-27-BRIEF §2). Replaces the copy-pasted, drifting,
 * Clock-Contract-VIOLATING `_exportTs()` that every *-app.js carried (each built
 * the stamp from `new Date()` read through LOCAL getters — the export-click
 * wall-clock, viewer-timezone-dependent, naming the wrong night for an overnight
 * recording). This helper instead stamps the RECORDING ANCHOR `t0Ms`, read back
 * via getUTC* (Clock Contract §5), so a name:
 *   · identifies the NIGHT the file is about (not when Export was clicked),
 *   · is DETERMINISTIC (re-exporting the same recording yields the same name),
 *   · is VIEWER-TIMEZONE-INDEPENDENT by construction (getUTC*, never getHours()).
 * A missing t0Ms → the literal `undated`, NEVER a fabricated now() (Clock Contract
 * §1/§6; epistemic-honesty invariant).
 *
 *   exportName({ node, t0Ms, kind, ext, spanDays, contentId })
 *     → "<Node>_<YYYY-MM-DD>_<HHMM>_<kind>.<ext>"             (single recording)
 *     → "<Node>_<YYYY-MM-DD>_<N>d_<kind>.<ext>"               (spanDays = N, e.g. HRVDex window)
 *     → "<Node>_<YYYY-MM-DD>_<HHMM>_<kind>_<contentId>.<ext>" (with recording.contentId)
 *     → "<Node>_undated_<kind>.<ext>"                         (t0Ms null / non-finite)
 *
 *   node     : frozen LEXICON node name (capital-D, acronym stems all-caps), e.g. 'PulseDex'
 *   t0Ms     : recording anchor (floating wall-clock ms) or null
 *   kind     : controlled vocabulary — one of EXPORT_KINDS (see below). This is the
 *              FILENAME kind segment ONLY — entirely separate from the FROZEN in-file
 *              schema.name:"ganglior.node-export" (brief §2.3 frozen-name note).
 *   ext      : format extension — json | csv | jsonl | html (the format lives in the
 *              EXTENSION, never duplicated into the kind segment).
 *   spanDays : for a multi-night window export (HRVDex), the span in days; single-
 *              recording nodes pass null/omit. (brief §2.4 span-aware names.)
 *   contentId: OPTIONAL short content digest from EXPORT-IDENTITY's recording.contentId
 *              (identity-free, deterministic). When a non-empty string it is appended AFTER
 *              the kind segment as `_<contentId>` (brief §2.5 / EXPORT-HYGIENE-FOLLOWUPS-II §1).
 *              Omit / empty / non-string → name UNCHANGED, so non-adopting nodes + interop
 *              files are untouched. Sanitized to [a-z0-9] (filename-safe), exactly like ext.
 *
 * Identity-free (brief §2.5 / EXPORT-IDENTITY): the name carries NO patient name and
 * NO device serial. The only sanctioned disambiguator is the short content digest
 * from EXPORT-IDENTITY's recording.contentId, appended optionally as `_<contentId>`
 * (WIRED 2026-06-29, EXPORT-HYGIENE-FOLLOWUPS-II §1, now that PulseDex surfaces
 * recording.contentId — EXPORT-IDENTITY-FOLLOWUPS §1); do not invent a separate id here.
 *
 * DOM-free; sync; loadable in node:vm (no Date-locale, no document, no localStorage).
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  // Controlled `kind` vocabulary (brief §2.3) — collapses the per-node drift
  // (_summary / _multi<N> / _ganglior / .node-export.json double-suffix) into four.
  //   ganglior : the ganglior.node-export JSON — the fusion currency
  //   summary  : human-readable metrics table (CSV/JSON)
  //   series   : per-record rows (multi-recording array / JSONL) — NO count suffix
  //   report   : rendered HTML/PDF
  var EXPORT_KINDS = ['ganglior', 'summary', 'series', 'report'];

  function _p2(n) {
    n = '' + n;
    return n.length < 2 ? '0' + n : n;
  }
  // Clock Contract §5: read the floating t0Ms back via getUTC* ONLY, so the output
  // is identical on any machine regardless of the viewer's timezone.
  function _date(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + _p2(d.getUTCMonth() + 1) + '-' + _p2(d.getUTCDate());
  }
  function _hhmm(ms) {
    var d = new Date(ms);
    return _p2(d.getUTCHours()) + _p2(d.getUTCMinutes());
  } // HHMM, no colon (filename-safe)

  function exportName(opts) {
    opts = opts || {};
    var node = opts.node || 'Dex';
    var kind = opts.kind || 'summary';
    var ext = (opts.ext || 'json').toLowerCase().replace(/[^a-z0-9]/g, '');
    var t0Ms = opts.t0Ms;
    var spanDays = opts.spanDays;
    // OPTIONAL recording.contentId disambiguator (brief §2.5 / EXPORT-HYGIENE-FOLLOWUPS-II §1):
    // sanitize to [a-z0-9] (filename-safe, like ext); empty / non-string → '' → no suffix, name unchanged.
    var cid = typeof opts.contentId === 'string' ? opts.contentId.toLowerCase().replace(/[^a-z0-9]/g, '') : '';

    var dated = typeof t0Ms === 'number' && isFinite(t0Ms);
    var stamp;
    if (!dated) {
      stamp = 'undated'; // honesty: never a fabricated now()
    } else if (typeof spanDays === 'number' && isFinite(spanDays) && spanDays > 0) {
      stamp = _date(t0Ms) + '_' + Math.round(spanDays) + 'd'; // span-aware (brief §2.4)
    } else {
      stamp = _date(t0Ms) + '_' + _hhmm(t0Ms); // single recording
    }
    return node + '_' + stamp + '_' + kind + (cid ? '_' + cid : '') + (ext ? '.' + ext : '');
  }

  // ── SCRUB FOR SHARING (SELF-INGEST §5 · shared helper D1, SELF-INGEST-FOLLOWUPS-2026-07-03) ──
  // De-raw'd ≠ de-identified: a node-export's schema.provenance.inputs[].name can carry a DEVICE
  // SERIAL / source filename + inputs[].sha256. For clinical sharing return a deep CLONE with those
  /* ────────────────────────────────────────────────────────────────────────
     recording.coverage — the WRITER side of the sparse-coverage contract
     (DEEP-AUDIT-III §6.2 built the READER; INTEGRATOR-GAP-AWARE-OVERLAP part 1 wired it to the
     published quantities; this is part 2 — the emitters).

     WHY IT LIVES HERE. `integrator-dsp.js recSegments` is the single reader of this block, and until
     now HRVDex was its single writer — one node, one hand-rolled literal. Three more nodes now owe the
     same block, and three more hand-rolled literals is how a shape drifts. The DERIVATION is
     irreducibly node-local (ECGDex reads dropouts off its `gaps[]`, PpgDex off `relSec` jumps, OxyDex
     off row stamps); the ASSEMBLY is not, so the assembly is single-sourced here — same reasoning that
     put `parseTimestamp` in `clock.js`.

     WHY IT RETURNS null FOR A CONTIGUOUS RECORDING. A node that omits `coverage` makes no coverage
     claim, and the Integrator falls back to the envelope — which, for a recording with no holes, IS
     the coverage. Emitting `kind:"continuous"` on every clean export would therefore add no
     information while moving every committed fixture's bytes. So: a node declares coverage exactly
     when it has something to declare, i.e. when it found a hole. `segments.length <= 1` ⇒ null.

     `spanSec` is the ENVELOPE (first start → last end) and `recordedSec` is the COVERAGE (the sum of
     the segments). They are different fields with different names so neither can be read as the other
     — the same discipline §6.2 established for HRVDex.

     segs: [[startMs, endMs], …] floating wall-clock ms. Unsorted / overlapping / zero-length input is
     tolerated: it is sorted, merged and filtered here, because a caller deriving segments from a noisy
     stream should not also have to own interval algebra. */
  function coverageFromSegments(segs, opts) {
    if (!Array.isArray(segs) || !segs.length) return null;
    opts = opts || {};
    var clean = [];
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (!s) continue;
      var a = Array.isArray(s) ? s[0] : s.startMs,
        b = Array.isArray(s) ? s[1] : s.endMs;
      // A segment with no start is not a segment. A zero/negative-length one is a POINT, and a point
      // cannot create overlap — dropping it is the honest consequence, and matches recSegments' own
      // treatment of `durSec:null`.
      if (a == null || !isFinite(a) || b == null || !isFinite(b) || !(b > a)) continue;
      clean.push([a, b]);
    }
    if (clean.length < 2) return null; // no hole to declare ⇒ no claim to make (see above)
    clean.sort(function (x, y) {
      return x[0] - y[0];
    });
    var merged = [clean[0].slice()];
    for (var j = 1; j < clean.length; j++) {
      var last = merged[merged.length - 1];
      if (clean[j][0] <= last[1]) last[1] = Math.max(last[1], clean[j][1]);
      else merged.push(clean[j].slice());
    }
    if (merged.length < 2) return null; // the holes closed under merge — a contiguous recording
    var recordedMs = 0;
    for (var k = 0; k < merged.length; k++) recordedMs += merged[k][1] - merged[k][0];
    return {
      kind: 'sparse',
      spanSec: Math.round((merged[merged.length - 1][1] - merged[0][0]) / 1000),
      segments: merged.map(function (m) {
        return { startMs: m[0], durSec: +((m[1] - m[0]) / 1000).toFixed(3) };
      }),
      recordedSec: Math.round(recordedMs / 1000),
      // Every segment built from a stream carries its own length, so `nWithDuration === n` here. Both
      // are kept so the block is shape-identical to HRVDex's, where they genuinely differ.
      nWithDuration: merged.length,
      n: merged.length,
      // What OPENED the holes, for a reader deciding whether to trust them. Free-form, node-supplied.
      source: opts.source != null ? opts.source : null
    };
  }

  // stripped while KEEPING: the full clinical summary (nights[]/recordings[]/… + ganglior_events[] +
  // crossNight), a COARSE build stamp (buildHash + generated, so provenance integrity survives), and
  // recording.contentId (the identity-free EXPORT-IDENTITY handle). PURE: never mutates the input.
  // ONE implementation for every node (D1) — OxyDex shipped its own oxyScrubExport in the pilot; it
  // folds into this on OxyDex's next re-bundle (leaving it now avoids an export-inert OxyDex churn).
  // Default OFF at every call site, so a normal export stays byte-identical. DOM-free; node:vm-safe.
  /* THE SCRUB IS ALLOW-LIST DRIVEN (EXPORT-SCRUB-ALLOWLIST §3, owner ruling 2026-10-12). The key
     sets live in `export-schema.js`, which nine bundles carry; this function owns the MECHANISM and
     holds no key knowledge of its own. What the deny-list before it looked like, and why it had to
     go: `_SCRUB_FILE_KEYS` + `_FILE_SHAPE_RE` + three per-block delete passes, every entry of which
     was added AFTER a leak. A filename is an identifier (an O2Ring export embeds the device serial
     and can embed a personal name) and it reached the envelope by four routes — `nights[].file`,
     `sessions[].source`, the per-element `provenance` copy, and that copy's `schema.provenance`
     twin. Each route cost its own measurement: with the 07-xx scrub ON, a real export still named
     `Jane_Smith_O2Ring S 2100_20260612230016.csv`. Under an allow-list a fifth route needs no fifth
     fix, because a key nobody declared never reaches the output.
     SELF-INGEST §5 acceptance: a scrubbed JSON contains no device serial, filename or input sha256. */
  function _uniqSorted(list) {
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (seen[list[i]]) continue;
      seen[list[i]] = true;
      out.push(list[i]);
    }
    return out.sort();
  }
  /* A surviving provenance block carries the mark, at every depth it survives at — the element copy
     and its schema twin included, which is where the old scrub's two passes drifted apart. */
  function _markProv(block) {
    if (block && typeof block === 'object' && block.provenance && typeof block.provenance === 'object') {
      block.provenance.scrubbed = true;
    }
  }
  /* REFUSES when the allow-list is absent, and this is deliberate. The alternatives are both worse:
     a silent pass-through emits the caller's identifiers under a `scrubbed: true` mark, and a
     fallback deny-list is the fail-open code this replaced, kept alive in the one state nobody
     tests. A privacy boundary that cannot read its own declaration has nothing honest to return.
     CLAUDE.md §👥.3 is the precedent — an unguarded delegate throws, and guarding it converts the
     crash into silent disablement. Load `export-schema.js` before this file (every bundle that
     carries `dex-export.js` does; `dex-coload.js shared:` and the vm loaders in tools/ list both). */
  /* Takes the allow-list as an ARGUMENT so the refusal below is reachable from a test without
     deleting a global out from under a live realm. `scrubExport` is the one-line production path. */
  function _scrubWith(S, envelope) {
    if (!envelope || typeof envelope !== 'object') return envelope;
    if (!S || typeof S.project !== 'function') {
      throw new Error('dex-export: scrubExport needs the shared allow-list from export-schema.js — refusing to mark an export scrubbed without it');
    }
    var dropped = [];
    /* Deep clone first: `project` copies a declared metric bag by reference, and the output must not
       alias the caller's data any more than it must not mutate it. */
    var out = S.project('envelope', JSON.parse(JSON.stringify(envelope)), '', dropped);
    if (!out.schema || typeof out.schema !== 'object') out.schema = {};
    var sc = out.schema;
    sc.scrubbed = true;
    /* §∅ — the absence is REPORTED, never silent. Every key the allow-list removed is named here as
       a dotted block path, so a node author who adds a field reads it off the export instead of
       discovering months later that fusion never received it. */
    sc.scrubDropped = _uniqSorted(dropped);
    _markProv(sc);
    for (var a = 0; a < S.ELEMENT_ARRAYS.length; a++) {
      var arr = out[S.ELEMENT_ARRAYS[a]];
      if (!Array.isArray(arr)) continue;
      for (var i = 0; i < arr.length; i++) {
        if (!arr[i] || typeof arr[i] !== 'object') continue;
        _markProv(arr[i]);
        _markProv(arr[i].schema);
      }
    }
    return out;
  }
  function scrubExport(envelope) {
    return _scrubWith(root.ExportSchema, envelope);
  }

  var DexExport = { exportName: exportName, EXPORT_KINDS: EXPORT_KINDS, scrubExport: scrubExport, _scrubWith: _scrubWith, coverageFromSegments: coverageFromSegments };
  root.DexExport = DexExport;
  // app/back-compat bare globals (the apps call exportName(...) directly, like fmtDate/fmtClock)
  root.exportName = exportName;
  root.EXPORT_KINDS = EXPORT_KINDS;
  root.dexScrubExport = scrubExport; // bare global — the shared scrub every node's app reaches (D1)
  if (typeof module !== 'undefined' && module.exports) module.exports = DexExport;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : /** @type {any} */ (this));
