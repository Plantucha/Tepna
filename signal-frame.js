/*
 * signal-frame.js — Tepna canonical intermediate (CORE, the fourth layer)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. See the LICENSE and
 * NOTICE files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * The ONLY thing DSP should consume: a Clock-Contract-normalized, signal-typed,
 * provenance-stamped frame (see SIGNAL-ADAPTER-AND-FRONTIER brief §2.2).
 *   · toSignalFrame(type, raw, ctx) — thin normalizer mapping a node's ad-hoc
 *     parser output (e.g. parseRRInput's {vals,t0Ms,offsetMin,tsMs,usable,reason})
 *     onto the SignalFrame shape + stamps provenance incl. DexKernel.HASH.
 *   · validateFrame(frame) → {ok, errors[]} — the schema authority for §2.2.
 *
 * INVARIANTS (CLAUDE.md + brief §5/§6): a missing value is `null`, NEVER
 * fabricated. t0Ms obeys the floating wall-clock law (read back only via getUTC*).
 * `sqi` and any downstream `conf` stay SEPARATE axes — never folded together. A
 * frame with no usable signal is usable:false + a human `reason`, never an
 * empty/fabricated frame. DOM-free; loadable in node:vm.
 *
 * IRREGULAR-tsMs CONTRACT (SIGNAL-ADAPTER-FOLLOWUPS-II §6 — CGM/HRV spot-reads).
 * A `kind:'samples'` frame may be sampled either regularly (carries `fs > 0`) OR
 * irregularly (carries per-sample `tsMs[]`, no `fs` — the CGM / Welltory-HRV case).
 * For the irregular case validateFrame guarantees EXACTLY: (a) `tsMs[]` is present
 * and non-empty; (b) its finite stamps are MONOTONIC NON-DECREASING — gaps are
 * allowed (uneven cadence, dropped samples), equal stamps are allowed (a repeated
 * sample), but a backwards step is REJECTED (floating `tMs` only ever advances —
 * Clock Contract §1); (c) non-finite entries are skipped (a missing stamp is its
 * own gap, not a fabrication); (d) `t0Ms` is the recording anchor = the first
 * finite stamp, never fabricated. OxyDex (1 Hz nominal, drops/repeats) and GlucoDex
 * (CGM, ~5 min cadence) both rely on this; the rule is enforced below + tested.
 * ──────────────────────────────────────────────────────────────────────── */
/**
 * @typedef {Object} SignalFrameProvenance
 * @property {string|null}  adapter     registered adapter id that produced the frame
 * @property {string|null}  vendor      human vendor/app name
 * @property {string|null}  device      device model, when known
 * @property {string[]|null} files      PHI-scrubbed source filename token(s) (EXPORT-IDENTITY §2.2)
 * @property {string|null}  sourceFormat parser's detected sub-format (e.g. 'rr'|'ppi')
 * @property {string|null}  kernelHash  DexKernel.HASH at parse time
 * @property {string[]}     warnings    non-fatal notes
 *
 * @typedef {Object} SignalFrame   The ONLY thing DSP should consume (brief §2.2).
 * @property {('rr'|'ecg'|'spo2'|'cgm'|'eeg'|'flow'|'hr'|'acc'|'hrv')} signalType  a SignalSpec key
 * @property {('intervals'|'samples')} kind
 * @property {number[]|null} intervals  ms — present when kind='intervals'
 * @property {Float32Array|number[]|null} samples  present when kind='samples'
 * @property {number|null}  fs          Hz — required for kind='samples', else null
 * @property {number|null}  t0Ms        floating wall-clock ms of first valid sample (null = unknown, NEVER fabricated)
 * @property {number|null}  offsetMin   minutes east of UTC, or null (no zone in source)
 * @property {number[]|null} tsMs       per-sample/interval absolute floating ms, when stamped
 * @property {number|null}  sqi         0..1 signal-quality, or null — SEPARATE axis from conf
 * @property {boolean}      usable
 * @property {string|null}  reason      human string when usable=false
 * @property {string|null}  contentId   EXPORT-IDENTITY §2.1: optional content-addressed recording digest
 *                                      (12 hex chars), identity-free, deterministic; null = no usable payload
 * @property {SignalFrameProvenance} provenance
 */
(function (root) {
  'use strict';

  function _kernelHash() { try { return (root.DexKernel && root.DexKernel.HASH) || null; } catch (e) { return null; } }
  function _spec(type) { return root.SignalSpec ? root.SignalSpec[type] : null; }

  /* ──────────────────────────────────────────────────────────────────────
   * EXPORT-IDENTITY (EXPORT-IDENTITY-2026-06-27-BRIEF §2) — two ingest-boundary
   * privacy primitives, both ADDITIVE on the FROZEN ganglior schema, both 100%
   * local, both identity-free, neither fabricating over an absent recording:
   *   · computeContentId(frame) — a deterministic content-addressed digest of the
   *     SIGNAL (signalType|t0Ms|kind|payload), NOT of any name/serial. Same
   *     recording → same id; viewer-TZ-independent (folds the numeric floating
   *     t0Ms, never a Date); filename-independent (provenance is NOT folded). It
   *     is a privacy-neutral dedup/citation handle — the RIGHT tool vs a serial
   *     counter or a patient/device id (brief §0). 48-bit (12 hex) is ample for
   *     a local dedup key; this is a collision-RESISTANT handle, not a crypto MAC.
   *   · scrubFilename(name) — strips the PHI/identity from a source filename
   *     (patient name, device serial, dates, hex/MAC ids), keeping ONLY the
   *     diagnostic fragments a consumer needs: vendor family + lane tag
   *     (_RR/_ECG/_PPG…) + extension. Closes the live leak that raw filenames
   *     ("Jane_Smith_2026-06-12_RR.txt") ride inside every export (brief §1).
   * crypto.subtle is async + absent from the node:vm sandbox, so this uses a
   * sync, dependency-free cyrb53 fold — stable on Node and the browser alike.
   * ────────────────────────────────────────────────────────────────────── */
  function _h53Init(seed) { return { h1: 0xdeadbeef ^ seed, h2: 0x41c6ce57 ^ seed }; }
  function _h53Str(st, str) {
    for (var i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      st.h1 = Math.imul(st.h1 ^ ch, 2654435761);
      st.h2 = Math.imul(st.h2 ^ ch, 1597334677);
    }
  }
  function _h53Hex(st) {
    var h1 = Math.imul(st.h1 ^ (st.h1 >>> 16), 2246822507) ^ Math.imul(st.h2 ^ (st.h2 >>> 13), 3266489909);
    var h2 = Math.imul(st.h2 ^ (st.h2 >>> 16), 2246822507) ^ Math.imul(st.h1 ^ (st.h1 >>> 13), 3266489909);
    var a = (h2 >>> 0).toString(16), b = (h1 >>> 0).toString(16);
    while (a.length < 8) a = '0' + a;
    while (b.length < 8) b = '0' + b;
    return (a + b).slice(0, 12);
  }
  // Fold a numeric payload into the running hash. Handles number[], typed arrays
  // (Int16/Float32…), arrays of {tMs,v}/{_tMs…} objects, and the packed PPG
  // {ch:[F32×3],…} object — every shape toSignalFrame may carry. Large arrays walk
  // with a deterministic stride (cap CAP) so cost stays bounded; the exact length
  // and the tail element are always folded, so length/last-element changes never
  // hide behind the stride. Object keys are folded in SORTED order (deterministic).
  function _fold(st, v, depth) {
    if (v == null || depth > 4) return;
    var t = typeof v;
    if (t === 'number') { _h53Str(st, isFinite(v) ? (',' + v) : ',~'); return; }
    if (t === 'boolean' || t === 'string') { _h53Str(st, '|' + v); return; }
    if (Array.isArray(v) || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(v))) {
      var n = /** @type {any} */ (v).length; _h53Str(st, '#' + n + ':');
      var CAP = 4096, stride = n > CAP ? Math.floor(n / CAP) : 1;
      for (var i = 0; i < n; i += stride) _fold(st, v[i], depth + 1);
      if (stride > 1) _fold(st, v[n - 1], depth + 1);
      return;
    }
    if (t === 'object') {
      var keys = []; for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) keys.push(k);
      keys.sort();
      for (var j = 0; j < keys.length; j++) { _h53Str(st, '.' + keys[j]); _fold(st, v[keys[j]], depth + 1); }
    }
  }
  // Deterministic, identity-free recording digest — null when there is no usable
  // payload (honest absence, never a fabricated id for an empty/absent recording).
  function computeContentId(frame) {
    if (!frame || frame.usable !== true) return null;
    var payload = (frame.kind === 'intervals') ? frame.intervals : frame.samples;
    if (payload == null) return null;
    var len = (typeof payload.length === 'number') ? payload.length : (payload.n != null ? payload.n : null);
    if (!len) return null;
    var st = _h53Init(0x5d1f);
    _h53Str(st, (frame.signalType || '?') + '|' +
      ((typeof frame.t0Ms === 'number' && isFinite(frame.t0Ms)) ? frame.t0Ms : '-') + '|' + frame.kind + '|');
    _fold(st, payload, 0);
    return _h53Hex(st);
  }

  // Diagnostic-only, identity-free filename token (brief §2.2). Built from a
  // WHITELIST of fragments (vendor family + lane tag + extension); everything else
  // — name, date, device serial, MAC/hex id, digit runs — is dropped, not hashed.
  /** @type {[RegExp, string][]} */
  var _VENDOR_SIG = [
    [/polar/i, 'polar'], [/o2ring|wellue|viatom/i, 'o2ring'], [/welltory/i, 'welltory'],
    [/lingo|libre|abbott/i, 'lingo'], [/coospo/i, 'coospo'], [/wahoo/i, 'wahoo'],
    [/oura/i, 'oura'], [/garmin/i, 'garmin']
  ];
  var _LANE_SIG = /(?:^|[_\-.\s])(RR|PPI|ECG|PPG|HR|ACC|GYRO|MAGN|TEMP|SA2|BRP|PLD|EVE|CSL|SPO2|SDB|MARKER)(?=$|[_\-.\s])/i;
  function scrubFilename(name) {
    var s = String(name == null ? '' : name).replace(/^.*[\\/]/, '');   // drop any path
    var ext = '', dot = s.lastIndexOf('.');
    if (dot > 0 && dot > s.length - 8) { ext = s.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, ''); s = s.slice(0, dot); }
    var frag = [];
    for (var i = 0; i < _VENDOR_SIG.length; i++) { if (_VENDOR_SIG[i][0].test(s)) { frag.push(_VENDOR_SIG[i][1]); break; } }
    var lane = s.match(_LANE_SIG);
    if (lane) { var L = lane[1].toUpperCase(); frag.push(L === 'SPO2' ? 'SpO2' : L); }
    var stem = frag.join('_') || '*';   // nothing diagnostic recognised → scrubbed marker
    return ext ? (stem + '.' + ext) : stem;
  }
  function _scrubFiles(files) {
    if (files == null) return null;
    if (typeof files === 'string') return [scrubFilename(files)];
    if (typeof files.length === 'number') { var out = []; for (var i = 0; i < files.length; i++) out.push(scrubFilename(files[i])); return out; }
    return null;
  }

  // Map a node parser's ad-hoc output onto the canonical SignalFrame shape.
  //   signalType : a SignalSpec key ('rr' | 'ecg' | 'spo2' | 'cgm' | 'eeg' | ...)
  //   raw        : the parser return. RR: {vals|intervals, t0Ms, offsetMin, tsMs,
  //                usable, reason, ...}. Samples: {samples, fs, t0Ms, tsMs, ...}.
  //   ctx        : { adapter, vendor, device, files, warnings } provenance the
  //                adapter knows about itself; merged into frame.provenance.
  function toSignalFrame(signalType, raw, ctx) {
    ctx = ctx || {};
    raw = raw || {};
    var spec = _spec(signalType);
    var kind = spec && typeof spec === 'object' ? spec.kind : (raw.kind || 'intervals');
    var usable = (raw.usable !== undefined) ? !!raw.usable : false;

    var frame = {
      signalType: signalType,
      kind: kind,
      intervals: null,
      samples: null,
      fs: null,
      t0Ms: (raw.t0Ms === undefined ? null : raw.t0Ms),       // null = unknown, never now()
      offsetMin: (raw.offsetMin === undefined ? null : raw.offsetMin),
      tsMs: (raw.tsMs === undefined ? null : raw.tsMs),
      sqi: (raw.sqi === undefined ? null : raw.sqi),          // quality-neutral by default; separate axis from conf
      usable: usable,
      reason: (raw.reason === undefined ? null : raw.reason), // honesty: human string when usable=false
      provenance: {
        adapter: ctx.adapter || raw.adapter || null,
        vendor: ctx.vendor || null,
        device: ctx.device || null,
        files: _scrubFiles(ctx.files),                       // EXPORT-IDENTITY §2.2: PHI/identity stripped at the boundary

        sourceFormat: (raw.sourceFormat !== undefined ? raw.sourceFormat : null),
        kernelHash: _kernelHash(),                            // DexKernel.HASH at parse time
        warnings: ctx.warnings || []
      }
    };

    if (kind === 'intervals') {
      var iv = (raw.intervals != null) ? raw.intervals : raw.vals;
      frame.intervals = (iv && iv.length != null) ? Array.prototype.slice.call(iv) : null;
    } else if (kind === 'samples') {
      frame.samples = (raw.samples != null) ? raw.samples : null;
      frame.fs = (raw.fs === undefined ? null : raw.fs);
    }
    frame.contentId = computeContentId(frame);             // EXPORT-IDENTITY §2.1: additive, optional, identity-free
    return frame;
  }

  // Schema authority for §2.2. Returns { ok, errors[] }. Rejects fabrication
  // (undefined/NaN t0Ms), kind/type mismatches, sqi/conf conflation, and a
  // usable frame whose declared payload is absent.
  /** @param {SignalFrame} frame */
  function validateFrame(frame) {
    var errors = [];
    var push = function (m) { errors.push(m); };
    if (!frame || typeof frame !== 'object') return { ok: false, errors: ['frame is not an object'] };

    var spec = _spec(frame.signalType);
    if (!frame.signalType || !spec || typeof spec !== 'object') push('unknown signalType: ' + frame.signalType);
    if (frame.kind !== 'intervals' && frame.kind !== 'samples') push('kind must be intervals|samples, got ' + frame.kind);
    if (spec && typeof spec === 'object' && frame.kind && spec.kind !== frame.kind)
      push('kind ' + frame.kind + ' != SignalSpec.' + frame.signalType + '.kind ' + spec.kind);
    if (typeof frame.usable !== 'boolean') push('usable must be boolean');

    // t0Ms: explicit null OR a finite number — never undefined/NaN (no fabrication, no silent gap).
    if (!('t0Ms' in frame)) push('t0Ms field missing (must be explicit null or a finite number)');
    else if (frame.t0Ms !== null && !(typeof frame.t0Ms === 'number' && isFinite(frame.t0Ms)))
      push('t0Ms must be null or a finite number, got ' + frame.t0Ms);
    if (frame.offsetMin !== null && frame.offsetMin !== undefined && !(typeof frame.offsetMin === 'number' && isFinite(frame.offsetMin)))
      push('offsetMin must be null or finite');

    // sqi stays a separate 0..1 axis (or null); never a confidence.
    if (frame.sqi !== null && frame.sqi !== undefined && !(typeof frame.sqi === 'number' && frame.sqi >= 0 && frame.sqi <= 1))
      push('sqi must be null or 0..1');

    // contentId (EXPORT-IDENTITY §2.1) is OPTIONAL + additive — accept-but-not-require.
    // When present it must be null or a 12-hex digest; it NEVER blocks an otherwise-valid frame.
    if ('contentId' in frame && frame.contentId !== null && frame.contentId !== undefined &&
        !(typeof frame.contentId === 'string' && /^[0-9a-f]{12}$/.test(frame.contentId)))
      push('contentId must be null or a 12-hex-char string');

    // provenance: audit-first.
    if (!frame.provenance || typeof frame.provenance !== 'object') push('provenance missing');
    else {
      if (!frame.provenance.adapter) push('provenance.adapter missing');
      if (!('kernelHash' in frame.provenance)) push('provenance.kernelHash missing');
    }

    if (frame.usable === false) {
      if (!frame.reason || typeof frame.reason !== 'string') push('usable:false frame must carry a reason string');
    } else if (frame.usable === true) {
      // the declared payload must actually be present + finite.
      if (frame.kind === 'intervals') {
        if (!Array.isArray(frame.intervals) || frame.intervals.length === 0) push('usable intervals frame needs a non-empty intervals[]');
        else if (!frame.intervals.every(function (v) { return typeof v === 'number' && isFinite(v); })) push('intervals[] has non-finite values');
      } else if (frame.kind === 'samples') {
        if (!frame.samples || frame.samples.length == null || frame.samples.length === 0) push('usable samples frame needs samples');
        // A regularly-sampled signal carries fs>0; an irregularly-sampled one (CGM,
        // HRV summary spot-reads) carries per-sample tsMs instead. One is required.
        var hasFs = (typeof frame.fs === 'number' && isFinite(frame.fs) && frame.fs > 0);
        var hasTs = Array.isArray(frame.tsMs) && frame.tsMs.length > 0;
        if (!hasFs && !hasTs) push('usable samples frame needs fs > 0 or per-sample tsMs');
        // Irregular-tsMs contract (§6): gaps OK, but the finite stamps must be monotonic
        // non-decreasing — a backwards step violates the floating-tMs law. Non-finite
        // entries are skipped (their own gap). Equal stamps (repeats) pass.
        if (hasTs) {
          var _prev = null, _mono = true;
          for (var _i = 0; _i < frame.tsMs.length; _i++) {
            var _t = frame.tsMs[_i];
            if (typeof _t !== 'number' || !isFinite(_t)) continue;
            if (_prev !== null && _t < _prev) { _mono = false; break; }
            _prev = _t;
          }
          if (!_mono) push('tsMs must be monotonic non-decreasing (gaps allowed, no backwards step)');
        }
      }
    }
    return { ok: errors.length === 0, errors: errors };
  }

  // A one-line human summary the unifier/OverDex print under each routed file.
  function describeFrame(frame) {
    if (!frame) return 'no frame';
    var v = validateFrame(frame);
    var n = frame.kind === 'intervals' ? (frame.intervals ? frame.intervals.length : 0)
                                       : (frame.samples ? frame.samples.length : 0);
    var unit = root.SignalSpec ? root.SignalSpec.unitOf(frame.signalType) : null;
    var head = frame.signalType + '/' + frame.kind + ' · ' + n + (unit ? ' ' + unit : '') +
               ' · ' + (frame.usable ? 'usable' : 'UNUSABLE');
    if (!frame.usable && frame.reason) head += ' — ' + frame.reason;
    if (!v.ok) head += '  [INVALID: ' + v.errors.join('; ') + ']';
    return head;
  }

  root.SignalFrame = { toSignalFrame: toSignalFrame, validateFrame: validateFrame, describeFrame: describeFrame,
                       computeContentId: computeContentId, scrubFilename: scrubFilename };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SignalFrame;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : /** @type {any} */ (this)));
