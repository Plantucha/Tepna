/*
 * measurement-block.js — the MEASUREMENT INSTANCE contract (CORE)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. See the LICENSE and
 * NOTICE files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * Executes `MEASUREMENT-INSTANCE-CONTRACT-2026-09-17-BRIEF.md`, which executes
 * `MEASUREMENT-PROVENANCE-ROADMAP-2026-08-26` §1+§2. The block SHAPE is specified there and is
 * deliberately NOT restated here — the roadmap's §0 anti-duplication rule is hard: a competing
 * vocabulary is a defect, not a design.
 *
 * THE GAP THIS OPENS, in one line: Tepna can prove that A BUNDLE produced AN EXPORT from AN INPUT,
 * byte for byte, years later — and cannot answer the same question about one number inside it.
 * Provenance is airtight at ARTIFACT granularity (`manifestHash`, `computeHash`, GATE A/B) and absent
 * at INSTANCE granularity.
 *
 * ⚠️ NO NODE EMITS THIS YET, AND THAT IS THE POINT OF THIS LANDING. The roadmap's §1 done-when ends
 * "no node emits it yet (that's §3)". Wiring one node here would re-record that node's fixtures and
 * destroy this unit's zero blast radius — it changes no bundle, moves no fixture, and touches no
 * `computeHash`. Resist the pull; emission is a separate, staged unit, OxyDex first.
 *
 * ⚠️ A NEW MODULE, NOT AN EDIT TO `dex-export.js`. That file is inlined into 8 of 8 bundles, so
 * putting the validator there would move eight `manifestHash` values for a field nobody emits. This
 * mirrors `signal-frame.js` instead — the standing precedent for "a CORE module that IS the schema
 * authority for a shape", right down to `validateX(x) → {ok, errors[]}`.
 *
 * ⚠️ `basis` IS NOT THE EVIDENCE LADDER, and conflating them is a red (roadmap §1). The ladder
 * (`measured ◉ validated ● emerging ◐ experimental ○ heuristic ◌`) is PER-METRIC epistemics and lives
 * in the node registry. `basis` is PER-INSTANCE derivation kind — how THIS number came to exist. They
 * share the word "measured" and nothing else, which is exactly why a reader conflates them, and why
 * the validator rejects a `basis` carrying a ladder value BY NAME rather than trusting the enum.
 *
 * ∅ ABSENCE IS NULL applies at every field: `spreadMs`, `uncertainty` and `evidence.inputHash` are
 * `null`-with-a-reason when unmeasured. `unknown` is a VALID STATE here, not a failure — a block that
 * says "nobody measured the spread" is honest; one that says `0` is the fabrication §∅ exists to stop.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  /* The two small closed vocabularies. Named sets rather than counts, and stated once. */
  var BASIS = ['measured', 'derived', 'estimated'];
  var CLOCK_DOMAINS = ['device', 'host', 'host-corrected'];
  /* The ladder values that must NEVER appear in `basis`. `measured` is deliberately ABSENT from this
     list — it is legal in both vocabularies, which is precisely what makes the confusion invisible. */
  var LADDER_ONLY = ['validated', 'emerging', 'experimental', 'heuristic'];
  var HEX12 = /^[0-9a-f]{12}$/;

  function _finite(v) {
    return typeof v === 'number' && isFinite(v);
  }

  /* A field that is allowed to be absent, but NOT allowed to be absent SILENTLY: null carries a
     reason beside it, so "unmeasured" and "measured as nothing" never collapse. */
  function _nullWithReason(block, path, v, reasonKey, push) {
    if (v === null || v === undefined) {
      if (!block[reasonKey] || typeof block[reasonKey] !== 'string') push(path + ' is null without ' + reasonKey + ' — an unmeasured value must say why (∅)');
      return;
    }
    if (!_finite(v)) push(path + ' must be a finite number or null-with-reason, got ' + v);
  }

  /**
   * validateMeasurement(block, opts) → { ok, errors[], checked[] }
   *
   * `checked` names the legs that actually RAN. A validator that silently skips a leg reports success
   * about something it never examined — this repo's dominant defect class — so the skip is published
   * rather than hidden. `opts.resolveMetric(metricId)` is optional; without it the identity leg cannot
   * run and says so instead of passing vacuously.
   */
  function validateMeasurement(block, opts) {
    var errors = [];
    var checked = [];
    var push = function (m) {
      errors.push(m);
    };
    if (!block || typeof block !== 'object') return { ok: false, errors: ['measurement is not an object'], checked: [] };
    opts = opts || {};

    // ── identity ────────────────────────────────────────────────────────────────────────────────
    if (typeof block.metricId !== 'string' || !block.metricId) push('metricId must be a non-empty string');
    /* THE BLOCK NEVER CARRIES unit/label/tier INLINE — they resolve from the node registry, which is
       the single source (§3 metric contract). An unresolvable id is the fabricated-identity failure
       one layer below `no-fabricated-tier`: a measurement claiming to be a metric nobody defined. */
    if (typeof opts.resolveMetric === 'function') {
      checked.push('metricId resolves');
      if (block.metricId && !opts.resolveMetric(block.metricId)) push('metricId resolves to nothing in the registry: ' + block.metricId);
    }
    ['unit', 'label', 'evidence_tier', 'evidenceTier'].forEach(function (k) {
      if (k in block) push(k + ' must NOT be inline on a measurement — it resolves from the registry');
    });

    // ── value ───────────────────────────────────────────────────────────────────────────────────
    /* NaN/Infinity are REFUSALS upstream, never values here. A block exists because something was
       measured; "we could not measure it" is expressed by not emitting a block, or by a null metric. */
    if (!_finite(block.value)) push('value must be a finite number (NaN/Infinity are refusals upstream, never values), got ' + block.value);

    // ── window ──────────────────────────────────────────────────────────────────────────────────
    var w = block.window;
    if (!w || typeof w !== 'object') {
      push('window missing — a measurement with no time range cannot be walked back to its input');
    } else {
      checked.push('window');
      if (!_finite(w.startTMs)) push('window.startTMs must be a finite floating tMs');
      if (!_finite(w.endTMs)) push('window.endTMs must be a finite floating tMs');
      if (_finite(w.startTMs) && _finite(w.endTMs)) {
        if (w.endTMs < w.startTMs) push('window has NEGATIVE duration (endTMs < startTMs)');
        else if (w.endTMs === w.startTMs) push('window is ZERO-LENGTH — no signal was observed, so no value can be over it');
      }
      if (CLOCK_DOMAINS.indexOf(w.clockDomain) < 0) push('window.clockDomain must be named, one of ' + CLOCK_DOMAINS.join('|') + ', got ' + w.clockDomain);
      /* `spreadMs` is a MEASUREMENT of the two clocks' disagreement; absent it is null + a reason,
         never 0 — a 0 here asserts the clocks agreed exactly, which is a claim nobody made. */
      _nullWithReason(w, 'window.spreadMs', w.spreadMs, 'spreadReason', push);
    }

    // ── provenance: the three joins that make the number walkable ────────────────────────────────
    var code = block.code;
    if (!code || typeof code !== 'object') {
      push('code missing — without it the number cannot name the algorithm that produced it');
    } else {
      checked.push('code identity');
      /* A HASH IS THE VERSION. §📦 forbids a hand-typed version string, and content-addressing is
         already how every other layer identifies executed code — so this accepts nothing else. */
      if (!HEX12.test(String(code.manifestHash || ''))) push('code.manifestHash must be a 12-hex content hash, got ' + code.manifestHash);
      if (!HEX12.test(String(code.computeHash || ''))) push('code.computeHash must be a 12-hex content hash, got ' + code.computeHash);
    }

    var ev = block.evidence;
    if (!ev || typeof ev !== 'object') {
      push('evidence missing — the join to the acquisition envelope is the point of the block');
    } else {
      checked.push('evidence join');
      /* LEGACY INPUTS HAVE NO ENVELOPE, and that is a state, not an error — but it must be SAID.
         A silently absent envelopeRef is indistinguishable from one nobody looked for. */
      if (ev.envelopeRef === null || ev.envelopeRef === undefined) {
        if (typeof ev.envelopeReason !== 'string' || !ev.envelopeReason) push('evidence.envelopeRef is null without evidence.envelopeReason — say why (legacy input, no envelope, …)');
      } else if (typeof ev.envelopeRef !== 'string' || !ev.envelopeRef) {
        push('evidence.envelopeRef must be a non-empty string or null-with-reason');
      }
      if (ev.inputHash !== null && ev.inputHash !== undefined && !HEX12.test(String(ev.inputHash))) push('evidence.inputHash must be a 12-hex content hash or null, got ' + ev.inputHash);
    }

    // ── basis: per-instance derivation kind, NOT the ladder ──────────────────────────────────────
    checked.push('basis');
    if (LADDER_ONLY.indexOf(block.basis) >= 0)
      push('basis carries an EVIDENCE-LADDER value (' + block.basis + ') — basis is per-INSTANCE derivation kind; the ladder is per-METRIC epistemics and lives in the registry');
    else if (BASIS.indexOf(block.basis) < 0) push('basis must be one of ' + BASIS.join('|') + ', got ' + block.basis);

    // ── sourceChannel + quality + uncertainty ────────────────────────────────────────────────────
    /* device:stream, matching the capture-side names so a reader can find the file. */
    if (typeof block.sourceChannel !== 'string' || block.sourceChannel.indexOf(':') < 0) push('sourceChannel must be "device:stream" (matching capture names), got ' + block.sourceChannel);
    if ('quality' in block && block.quality !== null && typeof block.quality !== 'object') push('quality must be an object or null');
    /* A value with a NAMED METHOD, or null + reason. An uncertainty with no method is a number whose
       meaning cannot be checked — worse than none, because it looks like rigour. */
    if (block.uncertainty === null || block.uncertainty === undefined) {
      if (typeof block.uncertaintyReason !== 'string' || !block.uncertaintyReason) push('uncertainty is null without uncertaintyReason — "unknown" is a valid state but must be stated (∅)');
    } else if (typeof block.uncertainty !== 'object' || !_finite(block.uncertainty.value) || typeof block.uncertainty.method !== 'string' || !block.uncertainty.method) {
      push('uncertainty must be {value, method} with a NAMED method, or null-with-reason');
    }

    return { ok: errors.length === 0, errors: errors, checked: checked };
  }

  var API = {
    validateMeasurement: validateMeasurement,
    BASIS: BASIS.slice(),
    CLOCK_DOMAINS: CLOCK_DOMAINS.slice(),
    LADDER_ONLY: LADDER_ONLY.slice()
  };
  root.MeasurementBlock = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
