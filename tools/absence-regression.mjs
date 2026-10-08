#!/usr/bin/env node
/*
 * absence-regression.mjs — regression gate for fixed absence-fabrication patterns.
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * The §∅ drain removed "absent reads as 0/1970" patterns. This gate fails if a
 * PR *adds* new instances of those patterns (diff-based, so main's baseline
 * doesn't need to be zero first).
 *
 * Patterns (each cites its fixing PR):
 *   - `tMs: ... || 0` — stamps 1970 on timeless findings (§2a #3366)
 *
 * NOTE (Item 3): The second pattern class originally documented here
 * (`|| 0` on a metric accumulator, citing #3359) was incorrect. #3359 fixed
 * implicit null coercion in aggregates (`null + x` → x, `null - x` → -x),
 * not `|| 0` defaults. The `|| 0` instances in *-dsp.js are legitimate
 * default values (e.g. `fs || 0.5`), not absence fabrication. This gate
 * intentionally covers only the tMs pattern; the null-arithmetic class is
 * covered by the DSP unit tests, not by diff-scanning.
 *
 * Usage: node tools/absence-regression.mjs --base <sha>
 * In CI, the workflow passes PR_BASE_SHA. Without --base, checks the worktree
 * against HEAD (useful pre-push).
 */

import { execSync } from 'node:child_process';

const PATTERNS = [
  {
    name: 'tms-fabrication',
    // tMs: <expr> || 0  — but not tMs: <expr> ?? null, and not in tests/
    regex: /tMs:\s*[^,;]*\|\|\s*0/,
    why: 'tMs: x || 0 stamps 1970 on timeless findings — use ?? null (§2a #3366)'
  }
];

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    if (e.status === 1) return ''; // no matches
    throw e;
  }
}

function main() {
  const baseIdx = process.argv.indexOf('--base');
  const base = baseIdx >= 0 ? process.argv[baseIdx + 1] : 'HEAD';
  const head = 'HEAD';

  // Get added lines in the diff
  const diff = sh(`git diff ${base}..${head} -U0 -- '*.js' ':!tests/'`);
  const addedLines = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));

  let failed = false;
  for (const p of PATTERNS) {
    const hits = addedLines.filter((l) => p.regex.test(l));
    // Exclude lines that already use ?? null (the fix pattern)
    const realHits = hits.filter((l) => !l.includes('?? null'));
    if (realHits.length) {
      failed = true;
      console.error(`✕ ${p.name}: ${realHits.length} new instance(s) — ${p.why}`);
      for (const h of realHits.slice(0, 5)) console.error('    ' + h.trim());
    } else {
      console.log(`✓ ${p.name}`);
    }
  }

  if (failed) {
    console.error('\nabsence-regression: FAIL — new absence-fabrication patterns introduced');
    process.exit(1);
  }
  console.log('absence-regression: ✓ no new fabrication patterns');
}

main();
