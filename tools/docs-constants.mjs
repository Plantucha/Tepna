#!/usr/bin/env node
/*
 * docs-constants.mjs — docs/code numeric consistency gate.
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * CLAUDE.md states numeric claims about the code. When the code changes and the doc doesn't (or vice
 * versa), they drift — the §🔒.7 "99 % vs 67 %" incident (#3367). This gate asserts the documented
 * constants match the code.
 *
 * Each entry: { name, docFile, docRegex, codeFile, codeRegex, compare, why }. Add entries as new
 * numeric claims are documented.
 *
 *   node tools/docs-constants.mjs            # check
 *   node tools/docs-constants.mjs --json     # one tepna.verdict/1
 *   node tools/docs-constants.mjs --selftest # a planted drift and its controls
 *
 * ⚠️ A MISSING PATTERN IS A FAILURE, NOT A SKIP. If the doc sentence is reworded or the constant
 * renamed, this gate can no longer compare anything — and a gate that cannot compare must not report
 * agreement. `doc-pattern-missing` and `code-pattern-missing` are therefore violations in their own
 * right, which is the whole difference between "they match" and "I could not look".
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));

export const CHECKS = [
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

/**
 * PURE CORE — evaluate every check against a supplied reader. No fs, so the selftest can plant a
 * drift, a reworded doc and a renamed constant without touching the repository.
 *
 * @param {Array} checks
 * @param {(file: string) => (string|null)} readFn  returns the file text, or null when unreadable
 * @returns {{rows: Array<{name,status,docVal,codeVal,why}>, violations: number}}
 */
export function evaluate(checks, readFn) {
  const rows = [];
  for (const c of checks) {
    const doc = readFn(c.docFile);
    const code = readFn(c.codeFile);
    const dm = doc == null ? null : doc.match(c.docRegex);
    const cm = code == null ? null : code.match(c.codeRegex);
    const docVal = dm ? dm[1] : null;
    const codeVal = cm ? cm[1] : null;
    let status;
    if (docVal === null) status = 'doc-pattern-missing';
    else if (codeVal === null) status = 'code-pattern-missing';
    else status = c.compare(docVal, codeVal) ? 'match' : 'drift';
    rows.push({ name: c.name, status, docVal, codeVal, why: c.why });
  }
  return { rows, violations: rows.filter((r) => r.status !== 'match').length };
}

export function selftest() {
  const fail = [];
  let ran = 0;
  const ok = (c, w) => {
    ran += 1;
    if (!c) fail.push(w);
  };
  const check = [
    {
      name: 't',
      docFile: 'D',
      docRegex: /share is (\d+) %/,
      codeFile: 'C',
      codeRegex: /SHARE = ([\d.]+)/,
      compare: (d, c) => Math.abs(parseFloat(d) - parseFloat(c) * 100) < 0.5,
      why: 'because'
    }
  ];
  const reader = (map) => (f) => (f in map ? map[f] : null);

  // THE CONTROL — agreement must read as agreement, or the gate is useless when nothing is wrong.
  ok(evaluate(check, reader({ D: 'share is 67 %', C: 'SHARE = 0.67' })).violations === 0, 'CONTROL: doc 67 % and code 0.67 agree');

  // THE PLANTED DRIFT — the #3367 incident in miniature: the doc says 99, the code says 0.67.
  const drift = evaluate(check, reader({ D: 'share is 99 %', C: 'SHARE = 0.67' }));
  ok(drift.violations === 1 && drift.rows[0].status === 'drift', 'a planted drift (99 vs 0.67) is caught');
  ok(drift.rows[0].docVal === '99' && drift.rows[0].codeVal === '0.67', 'both sides of the drift are reported, so the reader knows which to fix');

  /* 🔴 A GATE THAT CANNOT COMPARE MUST NOT REPORT AGREEMENT. These three are the ways this check goes
     blind — and each must be a VIOLATION, not a quiet pass. Without them, renaming the constant or
     rewording the sentence makes the gate green forever while the drift it exists to catch is
     invisible: the examined-nothing shape with a doc-and-code flavour. */
  ok(evaluate(check, reader({ D: 'the share was changed', C: 'SHARE = 0.67' })).rows[0].status === 'doc-pattern-missing', 'a REWORDED doc sentence is a violation, not a pass');
  ok(evaluate(check, reader({ D: 'share is 67 %', C: 'RENAMED = 0.67' })).rows[0].status === 'code-pattern-missing', 'a RENAMED constant is a violation, not a pass');
  ok(evaluate(check, reader({})).rows[0].status === 'doc-pattern-missing', 'an unreadable file is a violation, not a pass');

  // And the tolerance is a tolerance, not an equality: 0.669 still matches "67 %".
  ok(evaluate(check, reader({ D: 'share is 67 %', C: 'SHARE = 0.669' })).violations === 0, 'a value inside the stated tolerance matches');
  ok(evaluate(check, reader({ D: 'share is 67 %', C: 'SHARE = 0.68' })).violations === 1, '…and one outside it does not');

  const line = fail.length ? `docs-constants selftest · ${fail.length} of ${ran} FAILED` : `all ${ran} selftests passed`;
  return { ok: fail.length === 0, ran, fail, line };
}

function verdictOf({ status, rows }) {
  const v = Verdict.make({
    gate: 'docs-constants',
    status,
    population: { checked: rows.length, eligible: rows.length, excluded: 0 },
    criterion: { name: 'every-documented-constant-matches-the-code-it-describes', threshold: 0, unit: 'drifted or uncomparable claims', direction: 'eq' },
    result: { checks: rows.map((r) => ({ name: r.name, status: r.status, doc: r.docVal, code: r.codeVal })) },
    evidence: ['tools/docs-constants.mjs', 'CLAUDE.md', 'clock.js'],
    reason:
      status === 'PASS'
        ? null
        : rows
            .filter((r) => r.status !== 'match')
            .map((r) => `${r.name}: ${r.status}`)
            .join('; '),
    producedBy: {
      tool: 'tools/docs-constants.mjs',
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
  if (!chk.ok) throw new Error(`docs-constants produced an invalid verdict: ${chk.errors.join('; ')}`);
  return v;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    const r = selftest();
    process.stdout.write(`${r.line}\n`);
    for (const f of r.fail) process.stdout.write(`  ✕ ${f}\n`);
    process.exit(r.ok ? 0 : 1);
  }
  const read = (f) => {
    try {
      return readFileSync(join(ROOT, f), 'utf-8');
    } catch {
      return null;
    }
  };
  const { rows, violations } = evaluate(CHECKS, read);
  /* `CHECKS` is a declared, non-empty set, so a run over zero checks would mean the list was emptied
     — which must not read as a pass. There is no NOT_RUN path here for that reason. */
  const status = rows.length === 0 ? 'FAIL' : violations ? 'FAIL' : 'PASS';

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(verdictOf({ status, rows }), null, 1)}\n`);
  } else {
    for (const r of rows) {
      if (r.status === 'match') process.stdout.write(`✓ ${r.name}: doc ${r.docVal}% ≡ code ${r.codeVal}\n`);
      else if (r.status === 'drift') process.stderr.write(`✕ ${r.name}: doc says ${r.docVal}%, code says ${r.codeVal} — ${r.why}\n`);
      else process.stderr.write(`✕ ${r.name}: ${r.status} — the gate could not compare, which is not agreement (${r.why})\n`);
    }
    if (rows.length === 0) process.stderr.write('✕ docs-constants: the CHECKS list is empty — a gate over no claim is not a pass\n');
    else if (status === 'FAIL') process.stderr.write('\ndocs-constants: FAIL — documented constants drifted from code, or could not be compared\n');
    else process.stdout.write(`docs-constants: ✓ PASS — ${rows.length} documented constant(s) match the code\n`);
  }
  process.exit(status === 'PASS' ? 0 : 1);
}

main();
