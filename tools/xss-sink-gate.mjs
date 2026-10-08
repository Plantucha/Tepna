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

const SINK_RE = /\.innerHTML\s*(\+=|=)/;
// Matches escapeHTML(...) or esc(...) calls, including nested parens (one level).
const ESCAPE_CALL_RE = /\b(?:escapeHTML|esc)\s*\((?:[^()]*|\([^()]*\))*\)/g;
// String literals (single, double, backtick without interpolation).
const STRING_RE = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\$]|\\.)*`/g;
// Identifiers that could be unescaped variables.
const IDENT_RE = /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g;
// Known-safe identifiers (not user data).
const SAFE_IDENTS = new Set(['true', 'false', 'null', 'undefined', 'this']);

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    if (e.status === 1) return '';
    throw e;
  }
}

function main() {
  const baseIdx = process.argv.indexOf('--base');
  const base = baseIdx >= 0 ? process.argv[baseIdx + 1] : 'HEAD';

  const diff = sh(`git diff ${base}..HEAD -U3 -- '*.js' ':!tests/' ':!tools/'`);
  const lines = diff.split('\n');

  const violations = [];
  let currentFile = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('diff --git')) {
      const m = l.match(/b\/(.+)$/);
      currentFile = m ? m[1] : '';
    }
    if (l.startsWith('+') && !l.startsWith('+++') && SINK_RE.test(l)) {
      // Extract the RHS of the assignment.
      var m = l.match(/\.innerHTML\s*(?:\+=|=)\s*(.+?);?\s*$/);
      var rhs = m ? m[1] : '';
      // Remove escapeHTML()/esc() calls — their arguments are safe.
      var stripped = rhs.replace(ESCAPE_CALL_RE, '""');
      // Remove string literals — they are static, not user data.
      stripped = stripped.replace(STRING_RE, '""');
      // Any remaining identifiers are potentially unescaped user data.
      var unsafe = [];
      var im;
      IDENT_RE.lastIndex = 0;
      while ((im = IDENT_RE.exec(stripped)) !== null) {
        if (!SAFE_IDENTS.has(im[0])) unsafe.push(im[0]);
      }
      if (unsafe.length > 0) {
        violations.push(currentFile + ': ' + l.trim().slice(0, 100) + ' [unescaped: ' + unsafe.join(', ') + ']');
      }
    }
  }

  if (violations.length) {
    console.error('✕ xss-sink-gate: new innerHTML sink(s) without escape:');
    for (const v of violations.slice(0, 10)) console.error('    ' + v);
    console.error('\nRoute untrusted strings through dex-escape.js escapeHTML (#3318).');
    console.error('If the input is statically trusted, document why and add to ALLOW.');
    process.exit(1);
  }
  console.log('xss-sink-gate: ✓ no unescaped innerHTML sinks added');
}

main();
