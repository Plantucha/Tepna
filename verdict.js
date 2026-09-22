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
    return {
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
  }

  var API = { SCHEMA: SCHEMA, STATUSES: STATUSES.slice(), SCOPES: SCOPES.slice(), DIRECTIONS: DIRECTIONS.slice(), validate: validate, make: make };
  root.Verdict = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
