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
 * Heuristic (diff-based): an added line containing `innerHTML` must call
 * escapeHTML/esc() on the SAME line. A nearby unrelated escaping call (e.g.
 * escaping a different variable) does NOT satisfy the gate — Item 5 proved
 * the hunk-wide check could be bypassed by an unrelated escapeHTML() call.
 *
 * This is intentionally strict. If the input is statically trusted, document
 * why and add the line to ALLOW with a comment.
 *
 * Usage: node tools/xss-sink-gate.mjs --base <sha>
 */

import { execSync } from 'node:child_process';

const ESCAPE_RE = /\bescapeHTML\s*\(|\besc\s*\(|dex-escape/;
const SINK_RE = /\.innerHTML\s*(\+=|=)/;

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
      // Item 5: the escape must be on the SAME line as the sink.
      // A hunk-wide check allowed an unrelated escapeHTML() call on a nearby
      // line to mask an unsafe `el.innerHTML = userInput`.
      if (!ESCAPE_RE.test(l)) {
        violations.push(`${currentFile}: ${l.trim().slice(0, 100)}`);
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
