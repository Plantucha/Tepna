#!/usr/bin/env node
/*
 * docs-constants.mjs — docs/code numeric consistency gate.
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * CLAUDE.md states numeric claims about the code. When the code changes and
 * the doc doesn't (or vice versa), they drift — the §🔒.7 "99% vs 67%" incident
 * (#3367). This gate asserts the documented constants match the code.
 *
 * Each entry: { docPattern, codeFile, codePattern, name }.
 * Add entries as new numeric claims are documented.
 */

import { readFileSync } from 'node:fs';

const CHECKS = [
  {
    name: 'drawn-axis-share',
    docFile: 'CLAUDE.md',
    // Matches "≥67 %" or "≥ 67%" etc.
    docRegex: /inter-sample deltas are ≥\s*(\d+)\s*%/,
    codeFile: 'clock.js',
    // Matches "CK_AXIS_DRAWN_SHARE = 0.67"
    codeRegex: /CK_AXIS_DRAWN_SHARE\s*=\s*([\d.]+)/,
    // doc is percent, code is fraction
    compare: (docPct, codeFrac) => Math.abs(parseFloat(docPct) - parseFloat(codeFrac) * 100) < 0.5,
    why: 'CLAUDE.md §🔒.7 must match clock.js CK_AXIS_DRAWN_SHARE (#3367)'
  }
];

let failed = false;
for (const c of CHECKS) {
  let docVal, codeVal;
  try {
    const doc = readFileSync(c.docFile, 'utf-8');
    const dm = doc.match(c.docRegex);
    docVal = dm ? dm[1] : null;
  } catch {
    docVal = null;
  }
  try {
    const code = readFileSync(c.codeFile, 'utf-8');
    const cm = code.match(c.codeRegex);
    codeVal = cm ? cm[1] : null;
  } catch {
    codeVal = null;
  }

  if (docVal === null) {
    console.error(`✕ ${c.name}: doc pattern not found in ${c.docFile}`);
    failed = true;
  } else if (codeVal === null) {
    console.error(`✕ ${c.name}: code pattern not found in ${c.codeFile}`);
    failed = true;
  } else if (!c.compare(docVal, codeVal)) {
    console.error(`✕ ${c.name}: doc says ${docVal}%, code says ${codeVal} — ${c.why}`);
    failed = true;
  } else {
    console.log(`✓ ${c.name}: doc ${docVal}% ≡ code ${codeVal}`);
  }
}

if (failed) {
  console.error('\ndocs-constants: FAIL — documented constants drifted from code');
  process.exit(1);
}
console.log('docs-constants: ✓ documented constants match code');
