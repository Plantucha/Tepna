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
import { readdirSync, readFileSync } from 'node:fs';
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
 * THE DRAWN-AXIS SHARE AS PAPERS STATE IT. `CHECKS` above pins CLAUDE.md; the papers sat outside any
 * gate, and `papers/timestamp-pathology.html` stated "the shipped rule asserts drawn only at a modal
 * share ≥ 99 %" — a figure that was never shipped — while `clock.js` has had `CK_AXIS_DRAWN_SHARE =
 * 0.67` and CLAUDE.md was corrected by #3367.
 *
 * ⚠️ 99 % IS A LEGITIMATE NUMBER IN THESE PAPERS, so this cannot be a search for "99". The rejected
 * detector set at ≥ 99 % is part of the argument — `known-clock-recovery.html` says "A pre-existing
 * detector set at ≥ 99 % misses 5 of the 25" and must stay green. What is forbidden is stating that
 * threshold as the SHIPPED rule. So the claim is matched by its CLAIM SHAPE (a shipped/asserted
 * threshold on the modal share) and only that number is compared.
 */
export const SHIPPED_SHARE_CLAIM = /(?:shipped rule|asserts)[\s\S]{0,160}?modal share\s*(?:&ge;|≥|>=)\s*(?:<b>)?\s*([\d.]+)\s*(%?)/gi;

/**
 * PURE CORE #2 — judge one paper's text. Returns the shipped-threshold claims it makes and whether
 * each agrees with the code's fraction.
 *
 * @param {string} text  the paper's HTML
 * @param {number} codeFrac  e.g. 0.67
 * @returns {Array<{stated: string, unit: string, ok: boolean}>}
 */
export function paperShareClaims(text, codeFrac) {
  const out = [];
  for (const m of String(text || '').matchAll(SHIPPED_SHARE_CLAIM)) {
    const stated = m[1];
    const pct = m[2] === '%';
    const asFrac = pct ? parseFloat(stated) / 100 : parseFloat(stated);
    out.push({ stated, unit: pct ? '%' : 'fraction', ok: Math.abs(asFrac - codeFrac) < 0.005 });
  }
  return out;
}

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

  /* ── THE PAPERS CHECK ───────────────────────────────────────────────────────────────────────────
     THE PLANT is the sentence this unit corrected, verbatim; THE CONTROL is the other paper's
     historical phrasing, which names the same 99 % as a REJECTED detector and must stay green. A
     check that cannot tell those apart would either miss the drift or forbid the argument. */
  const planted = 'The shipped rule asserts <code>drawn</code> only at a modal share ≥ 99 % and always publishes';
  const pc = paperShareClaims(planted, 0.67);
  ok(pc.length === 1 && pc[0].ok === false, 'PLANT: "shipped rule … modal share ≥ 99 %" is caught as drift');
  ok(pc.length === 1 && pc[0].stated === '99' && pc[0].unit === '%', 'the plant reports the stated figure and its unit');

  const control = 'A pre-existing detector set at ≥ 99 % misses 5 of the 25, because a fabricated axis is only ~100 % concentrated';
  ok(paperShareClaims(control, 0.67).length === 0, 'CONTROL: 99 % named as a PRE-EXISTING detector is not a shipped-rule claim');

  const corrected = 'The shipped rule asserts <code>drawn</code> at a modal share ≥ <b>0.67</b> (<code>CK_AXIS_DRAWN_SHARE</code>)';
  const cc = paperShareClaims(corrected, 0.67);
  ok(cc.length === 1 && cc[0].ok === true, 'the corrected sentence agrees with the code');
  ok(paperShareClaims('The shipped rule asserts drawn at a modal share ≥ 67 %', 0.67)[0].ok === true, 'a percent statement of the same value also agrees');
  ok(paperShareClaims('a paper that says nothing about the share', 0.67).length === 0, 'a paper making no such claim is not judged');
  ok(paperShareClaims('The shipped rule asserts drawn at a modal share ≥ 0.80', 0.67)[0].ok === false, 'a different fraction is caught');

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
  /* THE PAPERS, which had no gate at all. The share lives in clock.js, so it is read from there rather
     than restated here — a gate that carried its own copy of the number would be the third place to
     drift. A paper making no shipped-threshold claim is simply not judged. */
  const codeText = read('clock.js') || '';
  const cm = /CK_AXIS_DRAWN_SHARE\s*=\s*([\d.]+)/.exec(codeText);
  const codeFrac = cm ? parseFloat(cm[1]) : null;
  const paperRows = [];
  if (codeFrac == null) {
    paperRows.push({
      name: 'papers:drawn-axis-share',
      status: 'code-pattern-missing',
      docVal: null,
      codeVal: null,
      why: 'CK_AXIS_DRAWN_SHARE not found in clock.js — the papers cannot be compared to anything'
    });
  } else {
    let scanned = 0;
    try {
      for (const f of readdirSync(join(ROOT, 'papers')).filter((x) => x.endsWith('.html'))) {
        const t = read(join('papers', f));
        if (t == null) continue;
        scanned += 1;
        for (const c of paperShareClaims(t, codeFrac)) {
          paperRows.push({
            name: `papers/${f}:drawn-axis-share`,
            status: c.ok ? 'match' : 'drift',
            docVal: c.stated + (c.unit === '%' ? ' %' : ''),
            codeVal: String(codeFrac),
            why: 'a paper stating the SHIPPED drawn-axis threshold must state clock.js CK_AXIS_DRAWN_SHARE (99 % was never shipped — #3367, and this paper carried it until 2026-10-10)'
          });
        }
      }
    } catch {
      paperRows.push({
        name: 'papers:drawn-axis-share',
        status: 'doc-pattern-missing',
        docVal: null,
        codeVal: String(codeFrac),
        why: 'papers/ unreadable — a gate that cannot look must not report agreement'
      });
    }
    /* ANTI-VACUITY: 22 papers exist, so a scan of none means the directory walk broke, not that the
       papers are clean — the examined-nothing shape this file already refuses for CLAUDE.md. */
    if (scanned < 10) paperRows.push({ name: 'papers:scan', status: 'doc-pattern-missing', docVal: String(scanned), codeVal: '>= 10', why: 'the papers scan examined too few files to mean anything' });
  }
  rows.push(...paperRows);
  const totalViolations = rows.filter((r) => r.status !== 'match').length;
  /* `CHECKS` is a declared, non-empty set, so a run over zero checks would mean the list was emptied
     — which must not read as a pass. There is no NOT_RUN path here for that reason. */
  const status = rows.length === 0 ? 'FAIL' : totalViolations ? 'FAIL' : 'PASS';

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(verdictOf({ status, rows }), null, 1)}\n`);
  } else {
    for (const r of rows) {
      /* The unit comes from the ROW, not from an assumption: CLAUDE.md states a percent and a paper may
         state either, so a hardcoded `%` printed "0.67%" for a fraction. */
      const u = (v) => (v != null && /%/.test(String(v)) ? String(v) : `${v}${r.name.startsWith('papers/') ? '' : '%'}`);
      if (r.status === 'match') process.stdout.write(`✓ ${r.name}: doc ${u(r.docVal)} ≡ code ${r.codeVal}\n`);
      else if (r.status === 'drift') process.stderr.write(`✕ ${r.name}: doc says ${u(r.docVal)}, code says ${r.codeVal} — ${r.why}\n`);
      else process.stderr.write(`✕ ${r.name}: ${r.status} — the gate could not compare, which is not agreement (${r.why})\n`);
    }
    if (rows.length === 0) process.stderr.write('✕ docs-constants: the CHECKS list is empty — a gate over no claim is not a pass\n');
    else if (status === 'FAIL') process.stderr.write('\ndocs-constants: FAIL — documented constants drifted from code, or could not be compared\n');
    else process.stdout.write(`docs-constants: ✓ PASS — ${rows.length} documented constant(s) match the code\n`);
  }
  process.exit(status === 'PASS' ? 0 : 1);
}

main();
