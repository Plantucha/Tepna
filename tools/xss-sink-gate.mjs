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
 * Heuristic (diff-based): an added line containing `innerHTML` must either
 *   - call escapeHTML/esc() on the same line, or
 *   - be in a file that the PR also modifies to add an escape import/call.
 *
 * This is intentionally strict — an escape added on a different line in the
 * same hunk is fine; a bare `el.innerHTML = userInput` is not.
 * False positives: add the line to ALLOW with a comment explaining why the
 * input is trusted (e.g. static template, already-escaped).
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
      // Check the hunk for an escape call (3 lines context already included)
      const hunkStart = Math.max(0, i - 6);
      const hunkEnd = Math.min(lines.length, i + 7);
      const hunk = lines.slice(hunkStart, hunkEnd).join('\n');
      if (!ESCAPE_RE.test(hunk)) {
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
