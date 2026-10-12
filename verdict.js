/*
 * verdict.js — the VERDICT contract (CORE): `tepna.verdict/1`
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. See the LICENSE and
 * NOTICE files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * Executes `VERDICT-CONTRACT-2026-09-21-BRIEF.md` §2 (owner standing requirement, CLAUDE.md §🧾):
 * every gate, oracle, audit, harness or study that DECIDES something emits ONE JSON object of a fixed
 * shape beside its prose. Prose is explanation; the object is the API. This module is the ONLY
 * definition of that shape — the enum, the field rules, the invariants — the way `measurement-block.js`
 * is the only definition of a measurement instance. A tool that hand-writes `"status": "PASSED"` reds
 * HERE, not in a reader's regex.
 *
 * THE FAILURE CLASS: three of the seven states a gate can be in — NOT_RUN, NOT_APPLICABLE, UNDERPOWERED —
 * read as green to a regex looking for "FAIL". A reader that must parse a paragraph to learn whether
 * evidence is trustworthy is §4b's "reported success about something it never examined" one layer up.
 *
 * `validate(obj) → { ok, errors[], checked[] }` — `checked` publishes which legs RAN (the denominator),
 * so a leg that could not run says so instead of passing silently. No dependencies; classic script;
 * loads in Node (vm co-load, `require`) and the browser suite alike.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  var SCHEMA = 'tepna.verdict/1';
  /* THE closed enum — exactly seven, stated once. Asserted as an equality by the gate group. */
  var STATUSES = ['PASS', 'FAIL', 'SHORTFALL', 'UNDERPOWERED', 'NOT_RUN', 'NOT_APPLICABLE', 'UNKNOWN'];
  var DIRECTIONS = ['lte', 'gte', 'eq', 'within'];
  /* P5 rides in the object: only a `publishable` verdict may be quoted outside the repo. Two values, closed. */
  var SCOPES = ['internal', 'publishable'];
  /* The closed method set for `contributions` (VERDICT-CONTRIBUTIONS-2026-10-04 §1), pre-stated per
     figure: recompute without the input · a closed-form partial derivative · the figure is a sum or a
     count and each input's term IS its contribution. */
  var CONTRIBUTION_METHODS = ['leave-one-out', 'analytic', 'decomposition'];
  /* Shares are a ratio of floats; the brief states the tolerance, so it lives here and not in a caller. */
  var SHARE_TOL = 1e-9;
  var SHA_RE = /^[0-9a-f]{7,40}$/;
  var ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

  function _isObj(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }
  function _isInt(v) {
    return typeof v === 'number' && Number.isFinite(v) && Math.floor(v) === v && v >= 0;
  }
  function _nonEmpty(s) {
    return typeof s === 'string' && s.trim().length > 0;
  }

  /**
   * _contributions(c, push) — the OPTIONAL attribution block (VERDICT-CONTRIBUTIONS-2026-10-04 §1).
   *
   * A fused figure — one computed from more than one node's export, or from more than one device's leg —
   * publishes what it is made of: `{ of, unit, method, inputs: [{ key, share, delta }], dominant }`.
   *
   * THE ∅ RULE IS THE WHOLE POINT. An input that was absent or refused is LISTED with `delta: null`
   * and the refusal's reason — never omitted and never 0, because a leg that could not run is a
   * contribution of *unknown*, not a contribution of nothing. And a share is a fraction of a total:
   * one unknown term makes the denominator `Σ|delta|` unknown, so EVERY share and `dominant` go null
   * with it. Normalising over the legs that did run would manufacture a denominator, which is the
   * §∅ shape this contract exists to refuse. The same holds when every delta is 0: `0/0` is not 0.
   */
  function _contributions(c, push) {
    if (!_isObj(c)) {
      push('contributions must be an object { of, unit, method, inputs[], dominant }, or absent — never a bare array or a number');
      return;
    }
    if (!_nonEmpty(c.of)) push('contributions.of must name the figure being attributed (non-empty string)');
    if (typeof c.unit !== 'string') push('contributions.unit must be a string (use "" for a dimensionless count, never omit it)');
    if (CONTRIBUTION_METHODS.indexOf(c.method) < 0)
      push('contributions.method must be one of ' + CONTRIBUTION_METHODS.join('|') + ', got ' + JSON.stringify(c.method) + ' — a closed set, pre-stated per figure');
    if (!Array.isArray(c.inputs)) {
      push('contributions.inputs must be an array of { key, share, delta }');
      return;
    }
    if (c.inputs.length < 2) push('contributions.inputs lists ' + c.inputs.length + ' input(s) — a figure with one input has nothing to attribute and carries NO block, so a block needs at least 2');
    var seen = {};
    var unknown = 0;
    var sumAbs = 0;
    var sumShare = 0;
    var maxAbs = -1;
    var shareOk = true;
    c.inputs.forEach(function (it, i) {
      var at = 'contributions.inputs[' + i + ']';
      if (!_isObj(it)) {
        push(at + ' must be an object { key, share, delta }');
        shareOk = false;
        return;
      }
      if (!_nonEmpty(it.key)) push(at + '.key must name the input (non-empty string)');
      else if (seen[it.key]) push(at + '.key "' + it.key + '" is listed twice — one share per input');
      else seen[it.key] = 1;
      if (it.delta === null) {
        unknown++;
        if (!_nonEmpty(it.reason)) push(at + ' carries delta: null with no reason — ∅: an absent or refused input says WHY it is unknown, and is never 0 and never omitted');
        if (it.share !== null) push(at + ' carries delta: null, so its own share is UNKNOWN and must be null, got ' + JSON.stringify(it.share));
      } else if (typeof it.delta !== 'number' || !Number.isFinite(it.delta)) {
        push(at + ".delta must be a finite number in the figure's own unit, or null with a reason, got " + JSON.stringify(it.delta));
        shareOk = false;
      } else {
        sumAbs += Math.abs(it.delta);
        if (Math.abs(it.delta) > maxAbs) maxAbs = Math.abs(it.delta);
      }
    });
    /* The denominator is unknown — one unknown term, or every delta 0. Refuse a number for any share. */
    if (unknown > 0 || (shareOk && maxAbs >= 0 && sumAbs === 0)) {
      var why = unknown > 0 ? unknown + ' input(s) carry delta: null, so Σ|delta| is UNKNOWN' : 'every delta is 0, so Σ|delta| is 0 and a share would be 0/0';
      c.inputs.forEach(function (it, i) {
        if (it && it.delta !== null && it.share !== null)
          push('contributions.inputs[' + i + '].share must be null (present, not omitted) — ' + why + '; normalising over the legs that DID run manufactures a denominator (∅)');
      });
      if (c.dominant !== null) push('contributions.dominant must be null (present, not omitted) — ' + why + ', so no input is known to be the largest');
      return;
    }
    if (!shareOk) return;
    c.inputs.forEach(function (it, i) {
      if (!_isObj(it) || it.delta === null) return;
      var want = Math.abs(it.delta) / sumAbs;
      if (typeof it.share !== 'number' || !Number.isFinite(it.share)) {
        push('contributions.inputs[' + i + '].share must be a finite number, got ' + JSON.stringify(it.share));
        return;
      }
      sumShare += it.share;
      if (Math.abs(it.share - want) > SHARE_TOL)
        push('contributions.inputs[' + i + '].share is ' + it.share + ' but |delta| / Σ|delta| is ' + want + ' — a share is computed from the deltas, never asserted beside them');
    });
    if (c.inputs.length && Math.abs(sumShare - 1) > SHARE_TOL)
      push('contributions shares sum to ' + sumShare + ', not 1 ± ' + SHARE_TOL + ' — the listed inputs ARE the decomposition, so a sum below 1 hides an input and above 1 double-counts one');
    var dom = null;
    for (var k = 0; k < c.inputs.length; k++) {
      var e = c.inputs[k];
      if (_isObj(e) && e.delta !== null && Math.abs(e.delta) === maxAbs) {
        dom = e.key;
        if (c.dominant === e.key) return;
      }
    }
    if (c.dominant !== dom)
      push(
        'contributions.dominant must be the key with the largest |delta| (' +
          JSON.stringify(dom) +
          '), got ' +
          JSON.stringify(c.dominant) +
          ' — it is what a render names first and what a reader quotes'
      );
  }

  /**
   * validate(obj) → { ok, errors[], checked[] }
   *
   * Each leg pushes its name onto `checked` when it RAN; a leg that cannot run (the object is not
   * even an object, a sub-field is absent) records the absence as an error rather than skipping
   * silently. The invariants, in order: shape · status enum · population equality · criterion
   * pre-stated · result/reason rules per status · evidence · provenance.
   */
  function validate(obj) {
    var errors = [];
    var checked = [];
    var push = function (m) {
      errors.push(m);
    };
    if (!_isObj(obj)) {
      return {
        ok: false,
        errors: [typeof obj === 'string' ? 'a verdict is an OBJECT, not prose — a status word in a string is exactly what this contract forbids' : 'verdict is not an object'],
        checked: []
      };
    }

    // ── schema + gate ────────────────────────────────────────────────────────────────────────
    checked.push('schema');
    if (obj.schema !== SCHEMA) push('schema must be exactly "' + SCHEMA + '", got ' + JSON.stringify(obj.schema));
    if (!_nonEmpty(obj.gate)) push('gate must name the gate (non-empty string)');

    // ── status: the closed enum, case-exact ──────────────────────────────────────────────────
    checked.push('status enum');
    var st = obj.status;
    if (STATUSES.indexOf(st) < 0) {
      if (typeof st === 'string' && STATUSES.indexOf(st.toUpperCase()) >= 0) push('status "' + st + '" is a capitalisation variant — the enum is case-exact: ' + STATUSES.join('|'));
      else push('status must be one of ' + STATUSES.join('|') + ', got ' + JSON.stringify(st) + ' (no eighth value, no synonyms)');
    }

    // ── scope: internal | publishable — required; absence does not default (a verdict that has not
    //    said whether it may be quoted has not decided) ─────────────────────────────────────────
    checked.push('scope');
    if (SCOPES.indexOf(obj.scope) < 0) push('scope must be one of ' + SCOPES.join('|') + ' (P5: only publishable may be quoted outside the repo), got ' + JSON.stringify(obj.scope));

    // ── population: three integers, checked + excluded = eligible, an EQUALITY ──────────────
    var pop = obj.population;
    if (!_isObj(pop)) push('population missing — a verdict states what it examined: {checked, eligible, excluded}');
    else {
      checked.push('population equality');
      ['checked', 'eligible', 'excluded'].forEach(function (k) {
        if (!_isInt(pop[k])) push('population.' + k + ' must be a non-negative integer, got ' + JSON.stringify(pop[k]));
      });
      if (_isInt(pop.checked) && _isInt(pop.eligible) && _isInt(pop.excluded) && pop.checked + pop.excluded !== pop.eligible)
        push('population must satisfy checked + excluded = eligible (an equality, not a floor): ' + pop.checked + ' + ' + pop.excluded + ' ≠ ' + pop.eligible);
      if (st === 'PASS' && pop.checked === 0) push('PASS over population.checked = 0 is the examined-nothing shape — refused at the type level');
    }

    // ── criterion: named, pre-stated, with unit + direction ──────────────────────────────────
    var cr = obj.criterion;
    if (!_isObj(cr)) push('criterion missing — the rule the verdict applied, written BEFORE the measurement');
    else {
      checked.push('criterion');
      if (!_nonEmpty(cr.name)) push('criterion.name must be a non-empty string');
      if (DIRECTIONS.indexOf(cr.direction) < 0) push('criterion.direction must be one of ' + DIRECTIONS.join('|') + ', got ' + JSON.stringify(cr.direction));
      if (cr.direction === 'within') {
        if (!Array.isArray(cr.threshold) || cr.threshold.length !== 2 || !cr.threshold.every(Number.isFinite)) push('criterion.threshold for direction "within" must be a finite [lo, hi] pair');
      } else if (typeof cr.threshold !== 'number' || !Number.isFinite(cr.threshold)) push('criterion.threshold must be a finite number, got ' + JSON.stringify(cr.threshold));
      if (typeof cr.unit !== 'string') push('criterion.unit must be a string (use "" for a dimensionless count, never omit it)');
    }

    // ── result / reason, per status ──────────────────────────────────────────────────────────
    checked.push('result/reason per status');
    var hasResult = obj.result !== null && obj.result !== undefined;
    if (hasResult && !_isObj(obj.result)) push('result must be an object of measured quantities, or null');
    var reasonOk = _nonEmpty(obj.reason);
    if (st === 'PASS') {
      if (!hasResult) push('PASS requires result — the measured quantities the criterion was applied to');
      if (obj.reason !== null && obj.reason !== undefined) push('PASS must carry reason: null — a PASS that needs explaining is not a PASS');
    } else if (st === 'FAIL' || st === 'SHORTFALL') {
      if (!hasResult) push(st + ' requires result — what was measured');
      if (!reasonOk) push(st + ' requires reason — ' + (st === 'FAIL' ? 'what missed, by how much' : 'which sub-population or tail missed'));
    } else if (st === 'UNDERPOWERED') {
      if (!reasonOk) push('UNDERPOWERED requires reason naming the pre-stated minimum and the count');
      else if (!/\d/.test(obj.reason)) push('UNDERPOWERED reason must name the minimum and the count as NUMBERS, got "' + obj.reason + '"');
    } else if (st === 'NOT_RUN' || st === 'NOT_APPLICABLE') {
      if (hasResult) push(st + ' must carry result: null — ' + (st === 'NOT_RUN' ? 'nothing was examined, so nothing was measured' : 'the criterion does not bind, so no result exists'));
      if (!reasonOk) push(st + ' requires reason — ' + (st === 'NOT_RUN' ? 'why it did not run' : 'the property that makes the criterion inapplicable'));
    } else if (st === 'UNKNOWN') {
      if (!reasonOk) push('UNKNOWN requires reason — what could not be decided, and why');
    }

    // ── contributions: OPTIONAL. A fused figure says which input moved it ───────────────────
    //    Absent from a verdict that attributes nothing, so no existing producer gains a leg: the
    //    `checked[]` denominator grows only for an object that carries the block.
    if (obj.contributions !== undefined && obj.contributions !== null) {
      checked.push('contributions');
      _contributions(obj.contributions, push);
    }

    // ── evidence: what a reader opens to re-derive the verdict ───────────────────────────────
    checked.push('evidence');
    if (!Array.isArray(obj.evidence)) push('evidence must be an array of paths/globs/records a reader would open');
    else {
      if (!obj.evidence.every(_nonEmpty)) push('evidence entries must be non-empty strings');
      if ((st === 'PASS' || st === 'FAIL' || st === 'SHORTFALL') && obj.evidence.length === 0) push(st + ' with empty evidence is a claim with nothing to open');
    }

    // ── provenance of the RUN (a real UTC instant — not a floating recording time) ───────────
    checked.push('provenance');
    var pb = obj.producedBy;
    if (!_isObj(pb)) push('producedBy missing — {tool, commit}');
    else {
      if (!_nonEmpty(pb.tool)) push('producedBy.tool must name the tool');
      if (pb.commit !== null && !SHA_RE.test(String(pb.commit || ''))) push('producedBy.commit must be a 7–40 hex sha, or null with the reason in `commitReason` when the tree is not a checkout');
      if (pb.commit === null && !_nonEmpty(pb.commitReason)) push('producedBy.commit is null without producedBy.commitReason (∅: say why)');
    }
    if (!ISO_UTC_RE.test(String(obj.at || ''))) push('at must be a real UTC instant, ISO-8601 with Z — this is provenance of the RUN, not a floating recording time');

    return { ok: errors.length === 0, errors: errors, checked: checked };
  }

  /**
   * make(fields) → a verdict object with the schema, `at`, and null defaults filled — a convenience for
   * producers so the shape is written once, here. Does NOT validate; call validate() on the result.
   */
  function make(f) {
    f = f || {};
    var v = {
      schema: SCHEMA,
      gate: f.gate,
      status: f.status,
      scope: f.scope === undefined ? 'internal' : f.scope, // the restrictive default; a producer WRITES publishable to lift it
      population: f.population,
      criterion: f.criterion,
      result: f.result === undefined ? null : f.result,
      evidence: f.evidence || [],
      reason: f.reason === undefined ? null : f.reason,
      producedBy: f.producedBy,
      at: f.at || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    };
    /* OPTIONAL and additive: a producer that attributes nothing emits exactly the bytes it did before. */
    if (f.contributions !== undefined) v.contributions = f.contributions;
    return v;
  }

  var API = {
    SCHEMA: SCHEMA,
    STATUSES: STATUSES.slice(),
    SCOPES: SCOPES.slice(),
    DIRECTIONS: DIRECTIONS.slice(),
    CONTRIBUTION_METHODS: CONTRIBUTION_METHODS.slice(),
    SHARE_TOL: SHARE_TOL,
    validate: validate,
    make: make
  };
  root.Verdict = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
