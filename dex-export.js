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

  function _p2(n) { n = '' + n; return n.length < 2 ? '0' + n : n; }
  // Clock Contract §5: read the floating t0Ms back via getUTC* ONLY, so the output
  // is identical on any machine regardless of the viewer's timezone.
  function _date(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + _p2(d.getUTCMonth() + 1) + '-' + _p2(d.getUTCDate()); }
  function _hhmm(ms) { var d = new Date(ms); return _p2(d.getUTCHours()) + _p2(d.getUTCMinutes()); }   // HHMM, no colon (filename-safe)

  function exportName(opts) {
    opts = opts || {};
    var node = opts.node || 'Dex';
    var kind = opts.kind || 'summary';
    var ext = (opts.ext || 'json').toLowerCase().replace(/[^a-z0-9]/g, '');
    var t0Ms = opts.t0Ms;
    var spanDays = opts.spanDays;
    // OPTIONAL recording.contentId disambiguator (brief §2.5 / EXPORT-HYGIENE-FOLLOWUPS-II §1):
    // sanitize to [a-z0-9] (filename-safe, like ext); empty / non-string → '' → no suffix, name unchanged.
    var cid = (typeof opts.contentId === 'string') ? opts.contentId.toLowerCase().replace(/[^a-z0-9]/g, '') : '';

    var dated = (typeof t0Ms === 'number' && isFinite(t0Ms));
    var stamp;
    if (!dated) {
      stamp = 'undated';                                   // honesty: never a fabricated now()
    } else if (typeof spanDays === 'number' && isFinite(spanDays) && spanDays > 0) {
      stamp = _date(t0Ms) + '_' + Math.round(spanDays) + 'd';   // span-aware (brief §2.4)
    } else {
      stamp = _date(t0Ms) + '_' + _hhmm(t0Ms);             // single recording
    }
    return node + '_' + stamp + '_' + kind + (cid ? '_' + cid : '') + (ext ? '.' + ext : '');
  }

  root.DexExport = { exportName: exportName, EXPORT_KINDS: EXPORT_KINDS };
  // app/back-compat bare globals (the apps call exportName(...) directly, like fmtDate/fmtClock)
  root.exportName = exportName;
  root.EXPORT_KINDS = EXPORT_KINDS;
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DexExport;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
