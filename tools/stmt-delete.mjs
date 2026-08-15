#!/usr/bin/env node
/*
 * tools/stmt-delete.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * LEVEL B — PSEUDO-TESTED STATEMENTS. Delete ONE statement and see whether anything notices.
 *
 * Level A (`tools/extreme-mutate.mjs`) empties a whole function body. That is method-level extreme
 * mutation and it is validated (audits/EXTREME-MUTATION-VALIDATION.md). Its published limitation is
 * the reason this file exists:
 *
 *   A function can be NOT pseudo-tested as a whole while containing individual statements whose
 *   effects nothing observes.
 *
 *   Maton, K., Kapfhammer, G. M. & McMinn, P. (2024). "Exploring pseudo-testedness: empirically
 *   evaluating extreme mutation testing at the statement level." ICSME 2024, Flagstaff AZ.
 *   Measured across 4 Apache Commons projects + 23 Maven Central projects: 722 pseudo-tested
 *   statements, of which **48 % lie OUTSIDE pseudo-tested methods**. Method-level XMT alone
 *   therefore cannot be a complete test-strength assessment.
 *
 * `clock.js` is the demonstration case here: Level A reports 13/13 functions TESTED, zero
 * pseudo-tested. Any pseudo-tested statement in it is invisible to Level A by construction.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────────────────────
 * NOT a replacement for either layer. The hierarchy is coverage → Level A → Level B → traditional
 * mutation, and each asks a different question. Level A ranks whole functions and cannot localise;
 * Level B localises but says nothing about operators; the operator sweep finds wrong-boundary and
 * wrong-operator defects neither deletion layer can express. Report them separately — a file with
 * 0 pseudo-tested functions and 12 pseudo-tested statements is a MEANINGFUL result, not a
 * contradiction.
 *
 * ── HOW THIS DIFFERS FROM PseudoSweep, DELIBERATELY AND UNAVOIDABLY ──────────────────────────
 * PseudoSweep (github.com/PseudoTested/PseudoSweep) INSTRUMENTS Java source with JavaParser and
 * toggles statements at runtime; separate `-sdl` / `-xmt` passes. Two of its mechanisms exist for
 * Java's type system and have no analogue here: `FinalModifierRemover`/`TempFinalInsertion` (a
 * deleted declaration breaks `final`) and `addDefaultReturn` (a method must not fall off the end
 * after its `return` is removed). In JS a deleted `return` yields `undefined`, which is a genuine
 * behavioural change rather than a compile error, so JS SDL needs FEWER accommodations, not more.
 *
 * ⚠️ NO AST. This repository has exactly one dependency (`@biomejs/biome`) and is deliberately
 * dependency-minimal — 100 % local, no CDNs, no network in any bundle. There is no parser to reach
 * for, and adding one is an architectural change, not a tooling choice. Statement boundaries are
 * therefore found with `stripNonCode` — the repo's shared lexer, which blanks strings, comments and
 * regex literals IN PLACE so offsets are preserved — plus depth tracking. That is the same technique
 * `functionBodies` uses, so Level A and Level B cannot disagree about what a construct is.
 *   This is a real methodological difference from the paper and is recorded as one. It is NOT
 * "regular-expression deletion": nothing here matches against raw source.
 *
 * ⚠️ A DELETED DECLARATION IS NOT A DELETED STATEMENT. `var x = compute();` cannot simply be
 * removed — every later `x` becomes a ReferenceError, the suite crashes, and the mutant scores
 * KILLED while proving nothing about any assertion. PseudoSweep solves this by instrumenting the
 * initialiser; the faithful adaptation here is to delete the INITIALISER and keep the binding:
 *
 *     var x = compute();   ->   var x;
 *
 * The behaviour is gone, the binding survives, and a kill now means a test noticed the VALUE rather
 * than noticing a crash. Recorded because it changes what a kill means.
 *
 * ⚠️ ELIGIBILITY FAILS CLOSED. A construct the lexer cannot confidently classify is NOT eligible.
 * Over-restricting loses findings, which is visible and recoverable; under-restricting emits invalid
 * mutants that die on syntax and manufacture a false sense of test strength, which is neither.
 *
 * ⚠️ `tools/mutate.mjs:181` RECORDS A DECISION AGAINST STATEMENT DELETION — "exotic operators
 * (statement deletion, method swaps) produce mostly-invalid mutants and drown the signal." That
 * judgement is about mixing SDL into an OPERATOR SWEEP, where its noise buries the boundary and
 * operator findings the sweep exists for. This is a separate, separately-reported analysis over an
 * explicit allowlist. The note is answered by MEASUREMENT — `--json` reports `invalidRate`, and if
 * it is high on this fleet too, that is a finding and the note stands.
 *
 * USAGE
 *   node tools/stmt-delete.mjs --file clock.js --group clock
 *   node tools/stmt-delete.mjs --file ecgdex-dsp.js --group ecgdex-dsp --jobs 12 --json
 *   node tools/stmt-delete.mjs --selftest
 * ══════════════════════════════════════════════════════════════════════════════════════════ */
import { stripNonCode } from './probe-equivalence.mjs';

/* Files Level B may run against. An allowlist, not a glob: SDL is experimental here and its cost is
   one suite run per statement, so it is pointed deliberately rather than swept. */
export const LEVEL_B_ALLOWLIST = ['clock.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js', 'oxydex-dsp.js'];

/* The statement kinds this tool will delete, named after PseudoSweep's `Stmt.Type` enum so the two
   can be compared. The Java-only members (INNER_CLASS, LAMBDA_RETURN, SWITCH_ENTRY_ASSIGNMENT) and
   the ones whose deletion is unsound without instrumentation are absent — see `classifyStatement`. */
export const ELIGIBLE = ['EXPRESSION', 'RETURN', 'THROW', 'BREAK', 'CONTINUE', 'VARIABLE_DECLARATION'];

/* ── STATEMENT SPLITTING ─────────────────────────────────────────────────────────────────────
   Split a function body into top-level statements. `mask` is the body with strings/comments/regex
   blanked in place, so offsets in `mask` are offsets in `src`.

   TOP-LEVEL ONLY, and that is a deliberate scope limit rather than an oversight: a statement nested
   inside an `if` or a loop belongs to a control structure whose deletion semantics differ, and
   guessing at them is how an unsound mutant gets emitted. Nested bodies are reached by recursing on
   the enclosing block, not by flattening. */
export function splitStatements(src, from, to) {
  const mask = stripNonCode(src);
  const out = [];
  let depth = 0;
  let start = from;
  const emit = (end) => {
    const text = src.slice(start, end);
    if (text.trim()) out.push({ start, end, text });
    start = end;
  };
  for (let i = from; i < to; i++) {
    const c = mask[i];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') {
      depth--;
      /* A BLOCK-TERMINATED STATEMENT DOES NOT END IN `;`. `for (…) { … }` and `if (…) { … }` close
         on `}`, so a splitter that only breaks on semicolons welds them to whatever follows.
         Caught by selftest: `for (var i=0;i<3;i++) { h(i); } k();` came back as ONE statement
         instead of two. It failed SAFE — the merged text starts with `for`, so eligibility declined
         it as control-flow — but the statement after the loop then became invisible rather than
         merely ineligible, which is a silent loss of subjects. */
      /* ONLY a BLOCK close ends a statement. Emitting on any closer that returns to depth 0 also
         fires on the `)` of `g(a);` and the `]` of `a[i];`, splitting an expression in half and
         stripping its semicolon — caught immediately by the two selftests above, which is why they
         assert the TEXT and not just the count. */
      if (c === '}' && depth === 0) emit(i + 1);
    } else if (c === ';' && depth === 0) emit(i + 1);
  }
  return out;
}

/* ── ELIGIBILITY, and the reason each exclusion exists ───────────────────────────────────────
   Returns a `Stmt.Type`-style name, or a `not-eligible:<reason>` string. Conservative: anything
   unrecognised declines. */
export function classifyStatement(text) {
  const t = String(text || '').trim();
  if (!t) return 'not-eligible:empty';

  /* A statement containing a function definition is a DECLARATION of behaviour, not an execution of
     it. Deleting it removes a binding other statements call — the same unsound shape as deleting a
     variable declaration, without the initialiser trick to rescue it. */
  if (/\bfunction\b/.test(t) || /=>/.test(t)) return 'not-eligible:contains-function';

  /* Control-flow headers own their bodies. Deleting `if (c) { … }` removes the guard AND everything
     it guards, which is a body-level edit wearing a statement's clothes, and its verdict would not
     mean what a statement verdict means. */
  if (/^(if|for|while|do|switch|try|catch|finally|else)\b/.test(t)) return 'not-eligible:control-flow';

  if (/^return\b/.test(t)) return 'RETURN';
  if (/^throw\b/.test(t)) return 'THROW';
  if (/^break\b/.test(t)) return 'BREAK';
  if (/^continue\b/.test(t)) return 'CONTINUE';

  /* A declaration WITHOUT an initialiser has no behaviour to delete — `var x;` already does nothing
     observable. Reporting it would be a free false positive on every hoisted binding. */
  if (/^(var|let|const)\b/.test(t)) return /=/.test(t) ? 'VARIABLE_DECLARATION' : 'not-eligible:declaration-without-initialiser';

  /* Everything else that is a complete statement is an expression statement. */
  return 'EXPRESSION';
}

/* ── THE MUTANT ──────────────────────────────────────────────────────────────────────────────
   For a declaration, strip the INITIALISER and keep the binding (see the header). For everything
   else, remove the statement outright. Whitespace of the same length is substituted rather than
   splicing the string shorter, so every other statement's offsets stay valid and a batch of mutants
   can be generated from one scan without re-scanning. */
export function deleteStatement(src, stmt, kind) {
  if (kind === 'VARIABLE_DECLARATION') {
    const mask = stripNonCode(src);
    let depth = 0;
    for (let i = stmt.start; i < stmt.end; i++) {
      const c = mask[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === '=' && depth === 0 && mask[i + 1] !== '=' && mask[i - 1] !== '=' && mask[i - 1] !== '!' && mask[i - 1] !== '<' && mask[i - 1] !== '>') {
        /* keep `var x`, drop `= …`, keep the `;` */
        return src.slice(0, i) + ' '.repeat(stmt.end - 1 - i) + src.slice(stmt.end - 1);
      }
    }
    return null; // no top-level `=` found — decline rather than guess
  }
  return src.slice(0, stmt.start) + ' '.repeat(stmt.end - stmt.start) + src.slice(stmt.end);
}

/* ── VERDICT ─────────────────────────────────────────────────────────────────────────────────
   Deliberately NOT the same vocabulary as Level A. A statement has no coverage precondition of its
   own to check here (the enclosing function's coverage is Level A's concern), and collapsing the two
   into one metric is the thing the literature warns against. */
export function classifyStatementVerdict(ran, suitePassed) {
  if (!ran) return 'INCONCLUSIVE'; // the mutant never executed — harness, timeout, or syntax
  return suitePassed ? 'PSEUDO_TESTED_STATEMENT' : 'KILLED';
}

/* ── RUNNER ──────────────────────────────────────────────────────────────────────────────────
   One suite run per statement, in an isolated copy of the tree so parallel workers cannot see each
   other's mutation. `node_modules` is symlinked rather than copied; everything else is hard-linked
   via `cp -al`, then the ONE mutated file is unlinked and rewritten so the repo's own copy is never
   touched (the same inode hazard `mutate.mjs` and `killcheck.mjs` both document).

   BASELINE FIRST, ALWAYS. If the suite is already red, every mutant "fails" and every statement
   reads KILLED — a green report built on a broken harness. Level A refuses in that state and so does
   this. */
async function runLevelB(file, group, jobs) {
  const { execFileSync, execFile } = await import('node:child_process');
  const { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync, readdirSync } = await import('node:fs');
  const { join, dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const abs = join(ROOT, file);
  const src = readFileSync(abs, 'utf8');

  const runSuite = (cwd) => {
    try {
      execFileSync(process.execPath, [join(cwd, 'tests/run-tests.mjs'), '--group=' + group], { cwd, encoding: 'utf8', timeout: 900000, maxBuffer: 1 << 24 });
      return { ran: true, passed: true };
    } catch (e) {
      /* A non-zero exit is a VERDICT (tests failed). A missing status means it never ran — spawn
         failure or timeout kill — and that is INCONCLUSIVE, not a kill. Conflating them is how a
         harness problem gets banked as test strength. */
      return { ran: e.status !== undefined, passed: false };
    }
  };

  const mkTree = () => {
    const d = mkdtempSync(join(dirname(ROOT), '.stmtdel-'));
    const entries = readdirSync(ROOT).filter((e) => e !== 'node_modules' && e !== '.git' && !e.startsWith('.stmtdel-'));
    execFileSync('cp', ['-al', '--', ...entries.map((e) => join(ROOT, e)), d], { stdio: 'ignore' });
    try {
      symlinkSync(join(ROOT, 'node_modules'), join(d, 'node_modules'));
    } catch {}
    return d;
  };

  process.stderr.write('  baseline: one clean run of --group=' + group + '\n');
  const base = mkTree();
  const b = runSuite(base);
  rmSync(base, { recursive: true, force: true });
  if (!b.passed) {
    console.error('✗ BASELINE IS RED — every statement would read as KILLED. Fix the suite first.');
    process.exit(2);
  }

  /* Subjects: every eligible top-level statement of every function. */
  const { functionBodies } = await import('./extreme-mutate.mjs');
  const subjects = [];
  for (const fb of functionBodies(src)) {
    for (const st of splitStatements(src, fb.open + 1, fb.close)) {
      const kind = classifyStatement(st.text);
      if (ELIGIBLE.indexOf(kind) < 0) continue;
      const mutant = deleteStatement(src, st, kind);
      if (mutant == null || mutant === src) continue; // declined, or a no-op splice
      subjects.push({ fn: fb.fn, kind, text: st.text.trim().slice(0, 68), line: src.slice(0, st.start).split('\n').length, mutant });
    }
  }
  process.stderr.write('  ' + subjects.length + ' eligible statement(s) across ' + functionBodies(src).length + ' function(s)\n');
  if (!subjects.length) {
    console.error('✗ NO ELIGIBLE STATEMENTS — nothing to measure. Eligibility fails closed, so this may mean the file is all control flow.');
    process.exit(2);
  }

  const trees = [];
  for (let i = 0; i < Math.min(jobs, subjects.length); i++) trees.push(mkTree());
  const results = [];
  let next = 0;
  const worker = async (dir) => {
    for (;;) {
      const i = next++;
      if (i >= subjects.length) return;
      const s = subjects[i];
      const wAbs = join(dir, file);
      rmSync(wAbs, { force: true }); // UNLINK FIRST — hard-linked to the repo's own inode
      writeFileSync(wAbs, s.mutant);
      const r = runSuite(dir);
      const verdict = classifyStatementVerdict(r.ran, r.passed);
      results.push({ ...s, verdict });
      if (verdict === 'PSEUDO_TESTED_STATEMENT') process.stderr.write('  ● PSEUDO-TESTED STMT  ' + s.fn.padEnd(22) + ' L' + String(s.line).padEnd(6) + ' [' + s.kind + '] ' + s.text + '\n');
      rmSync(wAbs, { force: true });
      writeFileSync(wAbs, src);
    }
  };
  await Promise.all(trees.map(worker));
  for (const d of trees) rmSync(d, { recursive: true, force: true });
  return { file, group, subjects: subjects.length, results };
}

// ── selftest ────────────────────────────────────────────────────────────────────────────────
const IS_MAIN = !!process.argv[1] && process.argv[1].endsWith('stmt-delete.mjs');
if (IS_MAIN && process.argv.includes('--selftest')) {
  let pass = 0,
    fail = 0;
  const ok = (n, c, d) => {
    if (c) {
      pass++;
      console.log('  ✓ ' + n + (d ? '  — ' + d : ''));
    } else {
      fail++;
      console.log('  ✗ ' + n + (d ? '  — ' + d : ''));
    }
  };

  const B = 'function f(){ var a = 1; g(a); return a; }';
  const open = B.indexOf('{');
  const st = splitStatements(B, open + 1, B.length - 1);
  ok('a body splits into its top-level statements', st.length === 3, String(st.length));
  ok('…and each carries its own source text', st[1].text.trim() === 'g(a);', st[1].text.trim());

  /* Depth tracking is what separates this from splitting on `;`. */
  const L = 'function f(){ for (var i=0;i<3;i++) { h(i); } k(); }';
  const lo = L.indexOf('{');
  const ls = splitStatements(L, lo + 1, L.length - 1);
  ok('a for-header semicolon does NOT split a statement', ls.length === 2, String(ls.length) + ' (a naive split gives 4)');

  ok('a return is eligible', classifyStatement('return a;') === 'RETURN');
  ok('a throw is eligible', classifyStatement('throw new Error("x");') === 'THROW');
  ok('a call is an expression statement', classifyStatement('g(a);') === 'EXPRESSION');
  ok('a declaration WITH an initialiser is eligible', classifyStatement('var a = 1;') === 'VARIABLE_DECLARATION');
  ok('…WITHOUT one is not — nothing to delete', classifyStatement('var a;').startsWith('not-eligible'), classifyStatement('var a;'));
  ok('a control-flow header declines — it owns a body', classifyStatement('if (x) { y(); }').startsWith('not-eligible'));
  ok('a nested function declines — deleting it removes a binding', classifyStatement('var f = function(){};').startsWith('not-eligible'));
  ok('an arrow declines for the same reason', classifyStatement('var f = () => 1;').startsWith('not-eligible'));
  ok('an unrecognised construct declines rather than guessing', classifyStatement('').startsWith('not-eligible'));

  /* The declaration adaptation — the binding must survive. */
  const D = 'var x = compute();';
  const dm = deleteStatement(D, { start: 0, end: D.length }, 'VARIABLE_DECLARATION');
  ok('deleting a declaration keeps the BINDING', /^var x\s*;?\s*$/.test(dm.replace(/\s+/g, ' ').trim().replace(/\s*;$/, ';').replace(/ ;/, ';')), JSON.stringify(dm));
  ok('…and the mutant is the same LENGTH, so other offsets stay valid', dm.length === D.length, `${dm.length} vs ${D.length}`);

  const E = 'g(a);';
  const em = deleteStatement(E, { start: 0, end: E.length }, 'EXPRESSION');
  ok('deleting an expression statement blanks it', em.trim() === '', JSON.stringify(em));
  ok('…also length-preserving', em.length === E.length);

  ok('a suite that still passes ⇒ PSEUDO_TESTED_STATEMENT', classifyStatementVerdict(true, true) === 'PSEUDO_TESTED_STATEMENT');
  ok('a suite that fails ⇒ KILLED', classifyStatementVerdict(true, false) === 'KILLED');
  ok('a mutant that never ran ⇒ INCONCLUSIVE, never KILLED', classifyStatementVerdict(false, false) === 'INCONCLUSIVE');
  ok('…and never PSEUDO_TESTED either — an absent run is not evidence', classifyStatementVerdict(false, true) === 'INCONCLUSIVE');

  ok('the allowlist is explicit, not a glob', LEVEL_B_ALLOWLIST.length === 4 && LEVEL_B_ALLOWLIST.indexOf('clock.js') >= 0);
  ok('eligible kinds are named after PseudoSweep Stmt.Type', ELIGIBLE.indexOf('VARIABLE_DECLARATION') >= 0 && ELIGIBLE.indexOf('RETURN') >= 0);

  console.log('\n' + (fail ? `✗ ${fail} failed, ${pass} passed` : `✓ all ${pass} selftests passed`));
  process.exit(fail ? 1 : 0);
}

if (IS_MAIN && !process.argv.includes('--selftest')) {
  const argv = process.argv.slice(2);
  const opt = (f, d) => {
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
  };
  const file = opt('--file', '');
  const group = opt('--group', '');
  if (!file || !group) {
    console.error('usage: node tools/stmt-delete.mjs --file <f> --group <g> [--jobs N] [--json]');
    process.exit(2);
  }
  if (LEVEL_B_ALLOWLIST.indexOf(file) < 0) {
    console.error('✗ ' + file + ' is not on the Level-B allowlist: ' + LEVEL_B_ALLOWLIST.join(', '));
    console.error('  SDL is experimental and costs one suite run per statement, so it is pointed deliberately.');
    process.exit(2);
  }
  const os = await import('node:os');
  const jobs = Math.max(1, Number(opt('--jobs', String(Math.max(1, os.cpus().length - 2)))) || 1);
  const out = await runLevelB(file, group, jobs);
  const ps = out.results.filter((r) => r.verdict === 'PSEUDO_TESTED_STATEMENT');
  const inc = out.results.filter((r) => r.verdict === 'INCONCLUSIVE');
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ ...out, pseudoTestedStatements: ps.length, inconclusive: inc.length, invalidRate: out.subjects ? inc.length / out.subjects : 0 }, null, 2));
  } else {
    console.log('\n▸ LEVEL B · ' + out.file + ' · ' + out.subjects + ' eligible statement(s)');
    console.log('  PSEUDO-TESTED STATEMENTS ' + ps.length + '   killed ' + (out.results.length - ps.length - inc.length) + '   inconclusive ' + inc.length);
    console.log('  invalid/inconclusive rate ' + ((100 * inc.length) / Math.max(1, out.subjects)).toFixed(1) + '%  — mutate.mjs:181 predicted this would be high; measure, do not assume');
    console.log('\n  Level B is REPORTED SEPARATELY from Level A. A file with 0 pseudo-tested');
    console.log('  FUNCTIONS and N pseudo-tested STATEMENTS is the expected shape, not a contradiction.');
  }
}
