/*
 * analysis/xmt-fixture.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * GROUND TRUTH FOR EXTREME MUTATION TESTING — a file whose answer is known before the tool runs.
 *
 * `tools/extreme-mutate.mjs` has 30 selftests, and every one of them tests a PURE FUNCTION of that
 * tool — `classifyDescartes`, `trivialMatcher`, `replaceBody`. None runs the tool end to end against
 * a file whose correct classification is known independently. So the selftests can all pass while
 * the pipeline — splice, run suite, read coverage, classify — reports anything at all.
 *
 * That is the gap this file exists to close, and it is the same gap the whole mutation programme is
 * about: a check that ran and reported success about something it never examined.
 *
 * ⚠️ THIS FILE IS A MEASURING INSTRUMENT, NOT A LIBRARY. Nothing ships against it. Its four functions
 * are deliberately trivial, and their VALUE is that their correct verdict is decided by how
 * `tests/dex-tests.js` observes them, not by what they compute. Editing either half without the
 * other invalidates the experiment — the expected verdicts are asserted in the gate group itself.
 *
 * Each function is annotated with the verdict the LITERATURE requires, so a disagreement between
 * this file and the tool is a finding about the tool.
 */
(function (root) {
  'use strict';

  /* ── FIXTURE A · STRONGLY TESTED ────────────────────────────────────────────────────────────
     The test asserts the returned VALUE. Every Descartes operator changes it:
       empty -> undefined · null · 0 · 1 · '' · true · false · []
     none of which equals 5 for add(2,3).
     EXPECTED: tested (every applicable extreme mutant KILLED). */
  function add(a, b) {
    return a + b;
  }

  /* ── FIXTURE B · PSEUDO-TESTED ──────────────────────────────────────────────────────────────
     The test CALLS it — so it is covered, which is the precondition Betka & Wagner state
     explicitly ("despite having coverage") — but never observes the result. Every extreme mutant
     therefore survives.
     EXPECTED: pseudo-tested. This is the finding the whole method exists to produce.

     ⚠️ THE BODY MUST NOT BE A BARE CONSTANT, and finding that out is why this fixture exists. The
     first version was the canonical textbook example, `return 42;` — and the tool EXCLUDED it under
     Descartes' `constant` stop-matcher rather than reporting it. That is faithful to Descartes (a
     constant-returning method is trivial by its rules) and it is also a real blind spot: a function
     that is genuinely unobserved is unreportable if its body happens to be a single literal. A
     validation fixture that cannot be classified proves nothing about the classifier, so this body
     carries a loop, a guard, an arithmetic operator and a threshold — all unobserved. */
  function calculateSomething(readings) {
    var total = 0;
    for (var i = 0; i < readings.length; i++) {
      if (readings[i] > 0) total += readings[i] * 2;
    }
    return total > 100 ? 'high' : 'low';
  }

  /* ── FIXTURE C · SIDE-EFFECT, AND THE TOOL MUST NOT CONFUSE IT WITH B ───────────────────────
     Its observable behaviour is a mutation of the argument, not a return value. The test asserts
     the SIDE EFFECT. A tool that only watched return values would call this pseudo-tested; a
     correct one kills it, because emptying the body leaves the sink untouched.
     EXPECTED: tested. This separates "return value unused" from "untested". */
  function recordInto(sink, value) {
    sink.push(value);
  }

  /* ── FIXTURE D · NOT APPLICABLE ─────────────────────────────────────────────────────────────
     A bare accessor. Descartes ships stop-matchers precisely so functions like this are EXCLUDED
     rather than scored: `return this._x` survives every operator that happens to return the same
     shape, and no assertion anyone could add would change what that means.
     EXPECTED: excluded by a stop-matcher — NOT counted tested, NOT counted pseudo-tested.
     Reporting it either way is a false precision the literature does not license. */
  function getConstant() {
    return 7;
  }

  /* ══ LEVEL B GROUND TRUTH ═══════════════════════════════════════════════════════════════════
     Fixtures A–D above decide whether FUNCTION-level XMT is measuring anything. These three decide
     whether STATEMENT-level deletion is, and they exist because Level B's first live finding on
     clock.js turned out to be an EQUIVALENT mutant rather than a pseudo-tested statement — a
     survivor is not a finding until something distinguishes those two.

     All three live in ONE function that is strongly tested as a whole: emptying `summarise` breaks
     the asserted return, so Level A correctly calls it TESTED. That is the entire point — Maton et
     al.'s result is that pseudo-tested STATEMENTS hide inside NOT-pseudo-tested METHODS, and a
     fixture that cannot exhibit that cannot validate the tool. */
  function summarise(readings, stats) {
    var total = 0;
    var n = readings.length;
    n = n || 0; /* ← G (see below) */
    for (var i = 0; i < n; i++) {
      /* ── E · OBSERVED — the control. Delete it and the asserted return changes.
         EXPECTED: KILLED. Without this, a tool that reported everything as pseudo-tested would
         still "pass" the fixture below. */
      total += readings[i];

      /* ── F · EXECUTED, NEVER OBSERVED — the planted pseudo-tested statement.
         `stats.seen` is written on every iteration and NOTHING asserts it. Deleting it is a real
         behavioural change (the counter stops advancing) that no test can see.
         EXPECTED: PSEUDO_TESTED_STATEMENT — and, critically, inside a function Level A calls
         TESTED. This is the Level-A/Level-B gap in one case. */
      stats.seen = stats.seen + 1;
    }

    /* ── G · TRULY EQUIVALENT — the honest negative.
       `readings.length` is a non-negative integer on every input that reaches here, so `|| 0` maps
       0→0 and n→n. NO input distinguishes deleting it — not merely no input THIS SUITE supplies.
       That distinction is the whole fixture: an earlier draft used `total = total || 0`, which
       `summarise(['x'])` separates (NaN vs 0), making it unobserved like F rather than equivalent.
       It mirrors `clock.js`'s `se = se || 0`, whose call sites likewise guarantee a number.
       EXPECTED: Level B reports PSEUDO_TESTED_STATEMENT here TOO, and is WRONG to.
       ⚠️ This fixture exists to make that limitation a TESTED PROPERTY rather than a caveat in
       prose. SDL cannot separate "nothing observes this" from "nothing can distinguish it"; the
       standard remedy is TCE, which does not port to JS (audits/EXTREME-MUTATION-VALIDATION §3c).
       Until it does, every Level-B survivor needs manual triage — and this fixture is the proof. */
    return total;
  }

  root.XmtFixture = { summarise: summarise, add: add, calculateSomething: calculateSomething, recordInto: recordInto, getConstant: getConstant };
})(typeof globalThis !== 'undefined' ? globalThis : this);
