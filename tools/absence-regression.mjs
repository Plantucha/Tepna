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
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));

function verdictOf({ status, scanned, hits, base }) {
  const v = Verdict.make({
    gate: 'absence-regression',
    status,
    population: { checked: scanned, eligible: scanned, excluded: 0 },
    criterion: { name: 'no-added-line-fabricates-an-absent-value', threshold: 0, unit: 'added lines matching a fixed pattern', direction: 'eq' },
    result: status === 'NOT_RUN' ? null : { scanned, violations: hits.map((h) => ({ pattern: h.name, line: h.line })) },
    evidence: ['tools/absence-regression.mjs'],
    reason: status === 'PASS' ? null : status === 'NOT_RUN' ? `0 added lines in ${base}..HEAD — nothing was examined` : `${hits.length} added line(s) fabricate an absent value`,
    producedBy: {
      tool: 'tools/absence-regression.mjs',
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
  if (!chk.ok) throw new Error(`absence-regression produced an invalid verdict: ${chk.errors.join('; ')}`);
  return v;
}

const PATTERNS = [
  {
    name: 'tms-fabrication',
    // tMs: <expr> || 0  — but not tMs: <expr> ?? null, and not in tests/
    regex: /tMs:\s*[^,;]*\|\|\s*0/,
    why: 'tMs: x || 0 stamps 1970 on timeless findings — use ?? null (§2a #3366)'
  }
];

/**
 * PURE CORE — classify the ADDED lines of a diff. No git, no clock, no fs, so the selftest can plant
 * a violation and a control without a repository.
 *
 * @param {string[]} addedLines  lines beginning with `+` (the `+++` header already removed)
 * @returns {{hits: Array<{name: string, line: string, why: string}>, scanned: number}}
 */
export function classifyAdded(addedLines, patterns = PATTERNS) {
  const lines = (addedLines || []).filter((l) => typeof l === 'string' && l.startsWith('+') && !l.startsWith('+++'));
  const hits = [];
  for (const p of patterns) {
    for (const l of lines) {
      /* `?? null` IS the fix, so a line carrying it is not a regression even though it matches the
         shape. Checked per LINE, not per file: one corrected site must not excuse another. */
      if (p.regex.test(l) && !l.includes('?? null')) hits.push({ name: p.name, line: l.trim(), why: p.why });
    }
  }
  return { hits, scanned: lines.length };
}

export function selftest() {
  const fail = [];
  let ran = 0;
  const ok = (c, w) => {
    ran += 1;
    if (!c) fail.push(w);
  };

  // THE PLANTED VIOLATION — the exact shape #3366 fixed: a timeless finding stamped 1970.
  const planted = classifyAdded(['+      tMs: f.stamp || 0,']);
  ok(planted.hits.length === 1 && planted.hits[0].name === 'tms-fabrication', 'a planted `tMs: x || 0` is caught');
  ok(/1970/.test(planted.hits[0].why), 'the hit carries the reason, not just the line');

  /* THE CONTROL — without it this gate could flag EVERY added line and still look right on the
     plant. Three controls, because three different things could make it fire wrongly. */
  ok(classifyAdded(['+      tMs: f.stamp ?? null,']).hits.length === 0, 'CONTROL: the FIX pattern `?? null` is not a violation');
  ok(classifyAdded(['+      const fs = rec.fs || 0.5;']).hits.length === 0, 'CONTROL: an ordinary `|| 0.5` default is not a tMs fabrication');
  ok(classifyAdded(['-      tMs: f.stamp || 0,']).hits.length === 0, 'CONTROL: a REMOVED line is not an addition — the gate is diff-directional');
  ok(classifyAdded([]).hits.length === 0 && classifyAdded([]).scanned === 0, 'CONTROL: an empty diff yields no hit and reports scanning nothing');
  /* A `+++` header can itself contain a path that matches; it is not code. */
  ok(classifyAdded(['+++ b/tMs: x || 0']).scanned === 0, 'CONTROL: the +++ file header is not scanned as code');

  const line = fail.length ? `absence-regression selftest · ${fail.length} of ${ran} FAILED` : `all ${ran} selftests passed`;
  return { ok: fail.length === 0, ran, fail, line };
}

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    if (e.status === 1) return ''; // no matches
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
  const head = 'HEAD';

  const diff = sh(`git diff ${base}..${head} -U0 -- '*.js' ':!tests/'`);
  const { hits, scanned } = classifyAdded(diff.split('\n'));

  /* NOT_RUN vs PASS. `--base HEAD` (the pre-push default) diffs nothing, so a green there is a pass
     over an EMPTY population — the examined-nothing shape. It is reported as NOT_RUN rather than
     PASS, because "no added line broke the rule" and "there were no added lines" are different
     claims and only one of them is evidence. */
  const status = scanned === 0 ? 'NOT_RUN' : hits.length ? 'FAIL' : 'PASS';
  if (asJson) {
    process.stdout.write(`${JSON.stringify(verdictOf({ status, scanned, hits, base }), null, 1)}\n`);
  } else {
    for (const p of PATTERNS) {
      const n = hits.filter((h) => h.name === p.name).length;
      if (n) {
        process.stderr.write(`✕ ${p.name}: ${n} new instance(s) — ${p.why}\n`);
        for (const h of hits.filter((x) => x.name === p.name).slice(0, 5)) process.stderr.write(`    ${h.line}\n`);
      } else {
        process.stdout.write(`✓ ${p.name}\n`);
      }
    }
    if (status === 'NOT_RUN') process.stdout.write(`absence-regression: NOT_RUN — 0 added lines in ${base}..${head}, so nothing was examined\n`);
    else if (status === 'FAIL') process.stderr.write('\nabsence-regression: FAIL — new absence-fabrication patterns introduced\n');
    else process.stdout.write(`absence-regression: ✓ PASS — ${scanned} added line(s) examined, no new fabrication pattern\n`);
  }
  process.exit(status === 'FAIL' ? 1 : 0);
}

main();
