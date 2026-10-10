#!/usr/bin/env node
/*
 * xss-sink-gate.mjs — regression gate for XSS sink fixes.
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * #3318/#3343 fixed XSS sinks by routing all untrusted strings through the
 * canonical escaper (dex-escape.js: escapeHTML). This gate fails if a PR adds
 * a new innerHTML sink without an accompanying escape call.
 *
 * Heuristic (diff-based): an added line containing `innerHTML` has its RHS
 * analyzed. All `escapeHTML()`/`esc()` calls are stripped (their arguments
 * are safe), string literals are stripped (static), and any remaining
 * identifiers are flagged as potentially unescaped. A line like
 * `el.innerHTML = userInput + escapeHTML(safeVar)` FAILS because `userInput`
 * survives the stripping.
 *
 * LIMITS: This is still heuristic, not AST-based. It cannot track data flow
 * across lines, through function returns, or via aliased escapers. Template
 * literals with interpolation are conservatively flagged (the `${...}` parts
 * are not parsed). Where safety cannot be established, the gate fails
 * conservatively. Human review is required for complex cases. Do not describe
 * it as comprehensive XSS detection.
 *
 * This is intentionally strict. If the input is statically trusted, document
 * why and add the line to ALLOW with a comment.
 *
 * Usage: node tools/xss-sink-gate.mjs --base <sha>
 */

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));

const SINK_RE = /\.innerHTML\s*(\+=|=)/;
// Matches escapeHTML(...) or esc(...) calls, including nested parens (one level).
// ReDoS-safe: the inner alternation uses single-char [^()] (not [^()]*), so the
// two branches are disjoint at every position — no ambiguous backtracking.
const ESCAPE_CALL_RE = /\b(?:escapeHTML|esc)\s*\((?:[^()]|\([^()]*\))*\)/g;
// String literals (single, double, backtick without interpolation).
const STRING_RE = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\$]|\\.)*`/g;
// Identifiers that could be unescaped variables.
const IDENT_RE = /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g;
// Known-safe identifiers (not user data).
const SAFE_IDENTS = new Set(['true', 'false', 'null', 'undefined', 'this']);

/**
 * PURE CORE #1 — the heuristic for ONE added line. Unchanged from the original; only extracted, so a
 * selftest can plant a sink and a control without a diff.
 *
 * @returns {{sink: boolean, unsafe: string[]}}
 */
export function classifySinkLine(line) {
  if (!SINK_RE.test(line)) return { sink: false, unsafe: [] };
  const m = line.match(/\.innerHTML\s*(?:\+=|=)\s*(.+?);?\s*$/);
  const rhs = m ? m[1] : '';
  /* escapeHTML()/esc() calls first — their ARGUMENTS are safe, so the whole call collapses. Then
     string literals, which are static. Whatever identifier survives both is untracked data. */
  let stripped = rhs.replace(ESCAPE_CALL_RE, '""');
  stripped = stripped.replace(STRING_RE, '""');
  const unsafe = [];
  for (const im of stripped.matchAll(IDENT_RE)) if (!SAFE_IDENTS.has(im[0])) unsafe.push(im[0]);
  return { sink: true, unsafe };
}

/**
 * PURE CORE #2 — walk a unified diff, tracking the current file, and collect violations.
 * @returns {{violations: Array<{file,line,unsafe}>, sinksAdded: number}}
 */
export function scanDiff(lines) {
  const violations = [];
  let file = '';
  let sinksAdded = 0;
  for (const l of lines || []) {
    if (l.startsWith('diff --git')) {
      const m = l.match(/b\/(.+)$/);
      file = m ? m[1] : '';
      continue;
    }
    if (!l.startsWith('+') || l.startsWith('+++')) continue;
    const r = classifySinkLine(l);
    if (!r.sink) continue;
    sinksAdded += 1;
    if (r.unsafe.length) violations.push({ file, line: l.trim().slice(0, 100), unsafe: r.unsafe });
  }
  return { violations, sinksAdded };
}

export function selftest() {
  const fail = [];
  let ran = 0;
  const ok = (c, w) => {
    ran += 1;
    if (!c) fail.push(w);
  };

  // THE PLANTED VIOLATION — an added sink with an unescaped variable, the #3318 shape.
  const bad = classifySinkLine('+  el.innerHTML = userInput;');
  ok(bad.sink && bad.unsafe.includes('userInput'), 'a planted unescaped sink is caught and the identifier named');
  /* The mixed case the header calls out: one escaped argument does NOT launder the line. */
  const mixed = classifySinkLine('+  el.innerHTML = userInput + escapeHTML(safeVar);');
  ok(mixed.unsafe.includes('userInput') && !mixed.unsafe.includes('safeVar'), 'an escaped call does not launder an unescaped sibling');

  /* THE CONTROLS — without these the gate could flag EVERY added line and still pass the plant. */
  ok(classifySinkLine('+  el.innerHTML = escapeHTML(x);').unsafe.length === 0, 'CONTROL: a fully escaped sink is clean');
  ok(classifySinkLine("+  el.innerHTML = '<b>static</b>';").unsafe.length === 0, 'CONTROL: a string literal is static, not user data');
  ok(classifySinkLine('+  const x = userInput;').sink === false, 'CONTROL: a line with no innerHTML is not a sink at all');
  ok(
    classifySinkLine('-  el.innerHTML = userInput;').sink === true && scanDiff(['-  el.innerHTML = userInput;']).violations.length === 0,
    'CONTROL: a REMOVED sink is not an addition — the scan is diff-directional'
  );

  // The walk attributes a violation to the right FILE, which is what makes the failure routable.
  const walked = scanDiff(['diff --git a/oxydex-render.js b/oxydex-render.js', '+  el.innerHTML = n.date;']);
  ok(walked.violations.length === 1 && walked.violations[0].file === 'oxydex-render.js', 'the violation names the file it is in');
  ok(walked.sinksAdded === 1, 'the population counts sinks ADDED, so a pass over zero sinks is distinguishable');
  ok(scanDiff(['+++ b/x.js', '+  el.innerHTML = userInput;']).violations.length === 1, 'the +++ header is skipped but the following line is not');

  const line = fail.length ? `xss-sink-gate selftest · ${fail.length} of ${ran} FAILED` : `all ${ran} selftests passed`;
  return { ok: fail.length === 0, ran, fail, line };
}

function verdictOf({ status, sinksAdded, violations, base }) {
  const v = Verdict.make({
    gate: 'xss-sink-gate',
    status,
    population: { checked: sinksAdded, eligible: sinksAdded, excluded: 0 },
    criterion: { name: 'no-added-innerhtml-sink-carries-an-unescaped-identifier', threshold: 0, unit: 'added sinks with an unescaped identifier', direction: 'eq' },
    result: status === 'NOT_RUN' ? null : { sinksAdded, violations: violations.map((v2) => ({ file: v2.file, unsafe: v2.unsafe })) },
    evidence: ['tools/xss-sink-gate.mjs', 'dex-escape.js'],
    reason:
      status === 'PASS' ? null : status === 'NOT_RUN' ? `no innerHTML sink was added in ${base}..HEAD — nothing was examined` : `${violations.length} added sink(s) carry an unescaped identifier`,
    producedBy: {
      tool: 'tools/xss-sink-gate.mjs',
      commit: (() => {
        try {
          return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
        } catch {
          return null;
        }
      })()
    },
    at: new Date().toISOString()
  });
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`xss-sink-gate produced an invalid verdict: ${chk.errors.join('; ')}`);
  return v;
}

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    if (e.status === 1) return '';
    throw e;
  }
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    const r = selftest();
    process.stdout.write(`${r.line}\n`);
    for (const f of r.fail) process.stdout.write(`  ✕ ${f}\n`);
    process.exit(r.ok ? 0 : 1);
  }
  const asJson = argv.includes('--json');
  const baseIdx = process.argv.indexOf('--base');
  const base = baseIdx >= 0 ? process.argv[baseIdx + 1] : 'HEAD';

  const diff = sh(`git diff ${base}..HEAD -U3 -- '*.js' ':!tests/' ':!tools/'`);
  const { violations, sinksAdded } = scanDiff(diff.split('\n'));

  /* NOT_RUN WHEN NO SINK WAS ADDED. A diff that adds no innerHTML sink gives this gate nothing to
     judge, and "every added sink is escaped" over zero sinks is not evidence of anything — it is the
     examined-nothing shape, which this repo reports rather than dresses up as a pass. */
  const status = sinksAdded === 0 ? 'NOT_RUN' : violations.length ? 'FAIL' : 'PASS';

  if (asJson) {
    process.stdout.write(`${JSON.stringify(verdictOf({ status, sinksAdded, violations, base }), null, 1)}\n`);
  } else if (status === 'FAIL') {
    process.stderr.write('✕ xss-sink-gate: new innerHTML sink(s) without escape:\n');
    for (const v of violations.slice(0, 10)) process.stderr.write(`    ${v.file}: ${v.line} [unescaped: ${v.unsafe.join(', ')}]\n`);
    process.stderr.write('\nRoute untrusted strings through dex-escape.js escapeHTML (#3318).\n');
    process.stderr.write('If the input is statically trusted, document why and add to ALLOW.\n');
  } else if (status === 'NOT_RUN') {
    process.stdout.write(`xss-sink-gate: NOT_RUN — no innerHTML sink added in ${base}..HEAD, so nothing was examined\n`);
  } else {
    process.stdout.write(`xss-sink-gate: ✓ PASS — ${sinksAdded} added sink(s) examined, all escaped\n`);
  }
  process.exit(status === 'FAIL' ? 1 : 0);
}

main();
