#!/usr/bin/env node
/*
 * tools/mutation-summary.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * RENDER THE DIFF GATE'S VERDICT OBJECT FOR THE CI JOB SUMMARY — the first CI CONSUMER of
 * `tepna.verdict/1` (VERDICT-CONTRACT §1: the object is the API; the exit code is for the shell).
 *
 * `mutation.yml` used to render the gate's EXIT CODE: `0 → **PASS**`. Exit 0 is also what the gate
 * returns when no mutable JS changed, and what it returned when the changed lines carried no
 * mutable operator ("✓ all 0 mutant(s) … were killed") — so the summary read PASS on runs that
 * decided nothing. Measured over the last 300 first-parent commits on main (2026-09-14 → 09-22):
 * 264 took the no-mutable-source exit and 9 of the 36 that ran had zero mutants on the changed
 * lines — 273 of 300 green summaries over a gate that examined nothing on them (residue
 * `2026-09-22-mutation-summary-parsed-exit-code`). The nine checkmarks became visible only when
 * `mutate.mjs` began emitting the object and the schema refused PASS over checked = 0.
 *
 * This reads the LAST `tepna.verdict/1` object in the gate's NDJSON (`mutate.mjs --diff --json`
 * writes it as the final line) and prints Markdown from its fields:
 *   status         rendered as written — PASS · FAIL · UNKNOWN · NOT_APPLICABLE · NOT_RUN each with
 *                  its own glyph and its own sentence; NOT_APPLICABLE / NOT_RUN are NEVER a green
 *   population     `checked` of `eligible` mutants on the changed lines, `excluded` beside them
 *   reason         verbatim (null on PASS)
 * Two refusals, both rendered as UNKNOWN and never as PASS:
 *   · no object in the file (the gate crashed before deciding, or an older mutate.mjs ran)
 *   · the object's status and the shell exit code DISAGREE (PASS with exit ≠ 0, or FAIL with exit 0)
 *     — a consumer that trusts one over the other is guessing; it says so and shows both.
 * The object is validated with `verdict.js` first; an invalid object is rendered as UNKNOWN with the
 * validator's errors, because a malformed verdict is not a verdict.
 *
 *   node tools/mutation-summary.mjs <ndjson> <exit-code>     # Markdown on stdout
 *   node tools/mutation-summary.mjs --selftest              # the plants: every status, missing, disagree, invalid
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const V = createRequire(import.meta.url)(join(HERE, '..', 'verdict.js'));

/* The last verdict object in an NDJSON text, or null. Per-file records and the pre-run exits share
   the stream; only an object carrying the schema is a verdict. Pure. */
export function lastVerdict(text) {
  let found = null;
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d && d.schema === 'tepna.verdict/1') found = d;
  }
  return found;
}

const GLYPH = { PASS: '✓', FAIL: '✕', SHORTFALL: '◐', UNDERPOWERED: '◔', UNKNOWN: '?', NOT_APPLICABLE: '○', NOT_RUN: '○' };
const SENTENCE = {
  PASS: 'every mutant on a changed line was killed, or is recorded as having no distinguishing input.',
  FAIL: 'a mutant on a line this change wrote SURVIVED — no test can see the change there.',
  UNKNOWN: 'the run could not prove anything — treat as unmeasured, not as a pass.',
  NOT_APPLICABLE: 'the gate does not bind on this change (no mutable JS source, or no mutable operator on the changed lines). Not a pass — nothing was examined.',
  NOT_RUN: 'the gate did not run. Not a pass.'
};

/* WHERE THE BUDGET WENT. Each per-file record carries its two passes, so the summary can state which
   pass spent the job's time without anyone reading a log tail — the measurement residue
   `2026-10-05-the-js-mutation-job-cannot-finish-on-the-pr-that-makes-its-own-target-fast` left owed.
   A file still running when the job stopped writes no record, so a short table is the honest shape:
   it reports the files that finished and claims nothing about the one that did not. Pure. */
export function phaseSplit(text) {
  const rows = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    /* A record earns a row only by carrying BOTH passes. An older gate, a dry run and the pre-run
       exits all write records without them, and a blank cell in a budget table reads as zero. */
    if (d && d.schema !== 'tepna.verdict/1' && d.file && Number.isFinite(d.calibrationMs) && Number.isFinite(d.mutantPassMs))
      rows.push({ file: d.file, calibrationMs: d.calibrationMs, mutantPassMs: d.mutantPassMs, jobs: d.jobs, tested: d.tested });
  }
  return rows;
}

/* The rendered table, or '' when no record carried a split. Pure. */
export function phaseTable(rows) {
  if (!rows || !rows.length) return '';
  const s = (ms) => (Number(ms) / 1000).toFixed(Number(ms) < 10000 ? 1 : 0) + ' s';
  const out = [
    '',
    '**Where the budget went** — one calibration run per file, then the per-mutant pass that spends it',
    '',
    '| file | calibration | per-mutant pass | jobs | mutants |',
    '|---|---|---|---|---|'
  ];
  for (const r of rows) out.push(`| \`${r.file}\` | ${s(r.calibrationMs)} | ${s(r.mutantPassMs)} | ${r.jobs == null ? '?' : r.jobs} | ${r.tested == null ? '?' : r.tested} |`);
  out.push('', 'A file the job stopped inside writes no record, so an absent row is unmeasured rather than free.', '');
  return out.join('\n');
}

/* The split is appended to EVERY status, the early returns included: a run with no verdict object is
   the timed-out one, and that is the reader who most needs to know which pass had the budget. */
export function render(text, exitCode) {
  const out = renderStatus(text, exitCode);
  const tail = phaseTable(phaseSplit(text));
  return tail ? { ...out, md: out.md + tail } : out;
}

/* The decision: which status the summary shows and why. Pure, so the selftest pins every branch. */
function renderStatus(text, exitCode) {
  const code = Number(exitCode);
  const v = lastVerdict(text);
  const head = (st, line) => `## Diff-scoped JS mutation\n\n**${GLYPH[st] || '?'} ${st}** — ${line}\n`;
  if (!v)
    return {
      status: 'UNKNOWN',
      md: head('UNKNOWN', `no \`tepna.verdict/1\` object in the gate's output (exit \`${exitCode}\`) — the gate did not report a decision, so this summary cannot show one. Not a pass.`)
    };
  const val = V.validate(v);
  if (!val.ok)
    return {
      status: 'UNKNOWN',
      md: head('UNKNOWN', `the gate emitted an INVALID verdict (status \`${v.status}\`, exit \`${exitCode}\`): ${val.errors.join(' · ')}. A malformed verdict is not a verdict.`)
    };
  const expectZero = v.status === 'PASS' || v.status === 'NOT_APPLICABLE';
  const expectNonZero = v.status === 'FAIL' || v.status === 'UNKNOWN';
  if ((expectZero && code !== 0) || (expectNonZero && code === 0))
    return {
      status: 'UNKNOWN',
      md: head('UNKNOWN', `the verdict says \`${v.status}\` but the process exited \`${exitCode}\` — the two APIs disagree, and a consumer that picks one is guessing. Not a pass.`)
    };
  const p = v.population || {};
  const lines = [
    head(v.status, SENTENCE[v.status] || 'see the reason below.'),
    `checked **${p.checked}** of ${p.eligible} mutant(s) on the changed lines (${p.excluded} excluded) · criterion \`${v.criterion && v.criterion.name} ≤ ${v.criterion && v.criterion.threshold}\` · exit \`${exitCode}\`` +
      (v.base ? ` · base \`${v.base}\`` : '')
  ];
  if (v.reason) lines.push('', `> ${v.reason}`);
  return { status: v.status, md: lines.join('\n') + '\n' };
}

function selftest() {
  let fail = 0;
  let ran = 0; // incremented by the assertion helper itself — a count is computed, never typed
  const ok = (n, c, d) => {
    ran++;
    console.log((c ? '  ok   ' : '  FAIL ') + n + (!c && d != null ? '  — ' + d : ''));
    if (!c) fail++;
  };
  const base = {
    schema: 'tepna.verdict/1',
    gate: 'mutate-diff-js',
    scope: 'internal',
    population: { checked: 10, eligible: 10, excluded: 0 },
    criterion: { name: 'survivors_on_changed_lines', threshold: 0, unit: 'mutants', direction: 'lte' },
    evidence: ['tools/mutate.mjs', 'clock.js'],
    producedBy: { tool: 'tools/mutate.mjs', commit: 'c6a8e913' },
    at: '2026-09-22T00:00:00Z',
    base: 'origin/main'
  };
  const nd = (...objs) => objs.map((o) => JSON.stringify(o)).join('\n') + '\n';
  const pass = { ...base, status: 'PASS', result: { tested: 10, killed: 10 }, reason: null };
  const r1 = render(nd({ file: 'clock.js', survivors: [] }, pass), 0);
  ok('PASS + exit 0 → PASS, checked 10 of 10 shown', r1.status === 'PASS' && /checked \*\*10\*\* of 10/.test(r1.md), r1.md);
  ok('per-file records before the verdict are skipped by shape', lastVerdict(nd({ file: 'a.js', survivors: [] }, pass)).status === 'PASS');
  ok('the LAST verdict wins when two are present', lastVerdict(nd({ ...pass, status: 'NOT_RUN', result: null, reason: 'x' }, pass)).status === 'PASS');
  const na = { ...base, status: 'NOT_APPLICABLE', population: { checked: 0, eligible: 0, excluded: 0 }, result: null, reason: '3 changed line(s) in 1 file(s) carry no mutable operator' };
  const r2 = render(nd(na), 0);
  ok('NOT_APPLICABLE + exit 0 → NOT_APPLICABLE, never PASS — the 9-of-36 case', r2.status === 'NOT_APPLICABLE' && /Not a pass/.test(r2.md) && /no mutable operator/.test(r2.md), r2.md);
  const fl = { ...base, status: 'FAIL', population: { checked: 10, eligible: 10, excluded: 0 }, result: { survivors: 1 }, reason: '1 of 10 survived: a.js:7 [num → 0]' };
  const r3 = render(nd(fl), 1);
  ok('FAIL + exit 1 → FAIL with the reason quoted', r3.status === 'FAIL' && /a\.js:7/.test(r3.md), r3.md);
  const un = { ...base, status: 'UNKNOWN', population: { checked: 8, eligible: 10, excluded: 2 }, result: { invalid: 2 }, reason: '2 of 10 never ran' };
  ok('UNKNOWN + exit 3 → UNKNOWN, excluded shown', render(nd(un), 3).status === 'UNKNOWN' && /\(2 excluded\)/.test(render(nd(un), 3).md));
  const nr = { ...base, status: 'NOT_RUN', population: { checked: 0, eligible: 0, excluded: 0 }, result: null, reason: 'cannot diff against origin/main' };
  ok('NOT_RUN + exit 2 → NOT_RUN, not a pass', render(nd(nr), 2).status === 'NOT_RUN' && /Not a pass/.test(render(nd(nr), 2).md));
  const r4 = render('', 0);
  ok('NO object + exit 0 → UNKNOWN, never PASS (the old mapping)', r4.status === 'UNKNOWN' && /did not report/.test(r4.md), r4.md);
  ok('garbage lines only → UNKNOWN', render('not json\n{"file":"a.js"}\n', 0).status === 'UNKNOWN');
  const r5 = render(nd(pass), 1);
  ok('PASS object but exit 1 → UNKNOWN naming the disagreement', r5.status === 'UNKNOWN' && /disagree/.test(r5.md), r5.md);
  const r6 = render(nd(fl), 0);
  ok('FAIL object but exit 0 → UNKNOWN (a consumer does not pick a side)', r6.status === 'UNKNOWN' && /disagree/.test(r6.md), r6.md);
  const bad = { ...pass, population: { checked: 0, eligible: 0, excluded: 0 } };
  const r7 = render(nd(bad), 0);
  ok('an INVALID object (PASS over checked 0) → UNKNOWN with the validator error', r7.status === 'UNKNOWN' && /examined-nothing/.test(r7.md), r7.md);
  ok('an eighth status word → UNKNOWN via the validator, never rendered as itself', render(nd({ ...pass, status: 'GREEN' }), 0).status === 'UNKNOWN');

  /* THE BUDGET SPLIT. These pin the shape of the table and, more importantly, what earns a row:
     a record has to carry both passes, because a blank cell in a budget table reads as zero. */
  const phased = { file: 'oxydex-dsp.js', survivors: [], calibrationMs: 82000, mutantPassMs: 557000, jobs: 4, tested: 27 };
  const rows = phaseSplit(nd(phased, pass));
  ok('phases · a record carrying both passes earns one row, and the verdict object earns none', rows.length === 1 && rows[0].file === 'oxydex-dsp.js', JSON.stringify(rows));
  ok('phases · a record with only the calibration pass earns NO row — a blank budget cell reads as zero', phaseSplit(nd({ file: 'a.js', calibrationMs: 82000 }, pass)).length === 0);
  ok(
    'phases · the table states both passes, the job count and the mutant count',
    /82 s/.test(phaseTable(rows)) && /557 s/.test(phaseTable(rows)) && /\| 4 \| 27 \|/.test(phaseTable(rows)),
    phaseTable(rows)
  );
  ok('phases · no record with a split renders no table at all, never an empty one', phaseTable(phaseSplit(nd(pass))) === '');
  /* The timed-out run is the one that needs the split most, and it has no verdict object at all. */
  ok('phases · the split is appended even when there is no verdict to render', /Where the budget went/.test(render(nd(phased), 1).md) && render(nd(phased), 1).status === 'UNKNOWN');
  ok(
    'phases · a sub-10-second pass keeps its decimal, so a cheap file is not reported as 0 s',
    /5\.0 s/.test(phaseTable([{ file: 'b.js', calibrationMs: 5000, mutantPassMs: 4000, jobs: 2, tested: 1 }]))
  );
  console.log(fail ? `${fail} failed of ${ran}` : `all ${ran} selftests passed`);
  return fail ? 1 : 0;
}

function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  const [file, code] = argv;
  if (!file || code === undefined) {
    console.error('usage: node tools/mutation-summary.mjs <ndjson> <exit-code> | --selftest');
    return 2;
  }
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    /* an absent file is the no-object case: rendered as UNKNOWN below, never as a pass */
  }
  process.stdout.write(render(text, code).md);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
