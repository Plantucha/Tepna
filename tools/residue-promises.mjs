#!/usr/bin/env node
/*
 * tools/residue-promises.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * WHICH DECLARED CLOSURES THE WALKER CAN NO LONGER READ.
 *
 * A merged fix closes its own residue row by declaring it on a `Residue-fixed: <key>` line in the PR
 * body, and the walker writes the state cell afterwards (`CLAUDE.md` §📌). The walker reads the newest
 * `MERGED_WINDOW` merges only, so the declaration must already be in the body when the PR merges. A
 * line a bird adds to a body AFTER the merge is honoured while that PR stays inside the window, and
 * then it is unreachable: nothing re-reads it, and no surface says the promise went unkept.
 *
 * Measured 2026-11-09 over the 200 newest merges: 79 distinct promised keys, 18 of them still OPEN,
 * all 18 inside the window, so 0 dropped. The span of the 30 newest merges was 8.1 h. One real
 * instance exists already — #4724 merged with no closure line, the line arrived afterwards, the
 * walker never read it, and the row was closed by a hand for one whole work unit (board #5038).
 *
 * This tool scans deeper than the walker and classifies every declared key against the ledger on the
 * ref:
 *   closed       the row no longer reads OPEN — the promise was kept
 *   pending      the row reads OPEN and a declaring PR is still inside the window
 *   dropped      the row reads OPEN and every declaring PR has left the window — unreachable
 *   unknown-key  the body names a key that no row on the ref carries — a typo closes nothing
 *
 * FAIL on any `dropped` or `unknown-key`. The window constant and both parsers are IMPORTED from the
 * walker, so this tool cannot disagree with the mechanism it audits.
 *
 *   node tools/residue-promises.mjs                 # scan 200 merges, window from the walker
 *   node tools/residue-promises.mjs --scan 400      # look further back
 *   node tools/residue-promises.mjs --json          # the verdict object alone
 *   node tools/residue-promises.mjs --selftest      # the plants, no network
 *   node tools/residue-promises.mjs --verdict-sample  # the object over the plants, for the
 *                                                  # adoption manifest. No network.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';
import { MERGED_WINDOW, parseResidueFixed, residueStates } from './pr-walker.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)('../verdict.js');
const LEDGER = 'briefs/RESIDUE.md';
const GATE = 'residue-promises';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};

/* ── CLASSIFICATION ────────────────────────────────────────────────────────────────────────────
   One row per KEY, not per PR: two PRs may declare the same key, and the walker closes it from
   whichever one it can still read. So the window test is "is ANY declaring PR inside the window",
   and the most favourable class wins. */
export function judge({ merged, ledgerText, windowLimit = MERGED_WINDOW }) {
  const states = residueStates(ledgerText);
  /* Newest first. `gh` already sorts, but a caller may not, and the window is defined by order. */
  const prs = [...(merged || [])].sort((a, b) => (Date.parse(b.mergedAt) || 0) - (Date.parse(a.mergedAt) || 0) || b.number - a.number);
  const inWindow = new Set(prs.slice(0, windowLimit).map((p) => p.number));

  const byKey = new Map();
  for (const pr of prs) {
    for (const key of parseResidueFixed(pr.body)) {
      if (!byKey.has(key)) byKey.set(key, { key, declaredBy: [], state: states.get(key) ?? null });
      byKey.get(key).declaredBy.push(pr.number);
    }
  }

  const rows = [];
  for (const r of byKey.values()) {
    const reachable = r.declaredBy.some((n) => inWindow.has(n));
    const cls = r.state === null ? 'unknown-key' : r.state !== 'OPEN' ? 'closed' : reachable ? 'pending' : 'dropped';
    rows.push({ ...r, class: cls, reachable });
  }
  rows.sort((a, b) => a.key.localeCompare(b.key));

  const of = (c) => rows.filter((r) => r.class === c);
  return {
    rows,
    counts: {
      promises: rows.length,
      closed: of('closed').length,
      pending: of('pending').length,
      dropped: of('dropped').length,
      unknownKey: of('unknown-key').length
    },
    dropped: of('dropped'),
    unknownKey: of('unknown-key'),
    window: { limit: windowLimit, numbers: [...inWindow], spanHours: spanHours(prs.slice(0, windowLimit)) },
    scanned: prs.length
  };
}

/* The window's own age, so a reader can see how long a late declaration survives. null when the
   stamps are unreadable — never 0, which would read as "no span" (`CLAUDE.md` §∅). */
export function spanHours(prs) {
  const ms = (prs || []).map((p) => Date.parse(p.mergedAt)).filter((n) => Number.isFinite(n));
  if (ms.length < 2) return null;
  return Math.round(((Math.max(...ms) - Math.min(...ms)) / 3600000) * 10) / 10;
}

export function verdictFor(report, evidence) {
  const c = report.counts;
  const unhonoured = c.dropped + c.unknownKey;
  const status = c.promises === 0 ? 'NOT_APPLICABLE' : unhonoured > 0 ? 'FAIL' : 'PASS';
  const reason =
    status === 'NOT_APPLICABLE'
      ? `no \`Residue-fixed:\` declaration in the ${report.scanned} merges scanned`
      : status === 'FAIL'
        ? `${c.dropped} declaration(s) past the ${report.window.limit}-merge window with the row still OPEN, ` + `${c.unknownKey} naming no row`
        : null;
  return Verdict.make({
    gate: GATE,
    status,
    population: { checked: c.promises, eligible: c.promises, excluded: 0 },
    criterion: { name: 'unhonoured_declarations', threshold: 0, unit: 'declarations', direction: 'lte' },
    /* NOT_APPLICABLE carries `result: null` — the criterion does not bind, so no result exists
       (`verdict.js` refuses anything else). The scan count then lives in the reason. */
    result:
      status === 'NOT_APPLICABLE'
        ? null
        : {
            ...c,
            windowLimit: report.window.limit,
            windowSpanHours: report.window.spanHours,
            mergesScanned: report.scanned,
            droppedKeys: report.dropped.map((r) => r.key),
            unknownKeys: report.unknownKey.map((r) => r.key)
          },
    evidence,
    reason,
    producedBy: { tool: 'tools/residue-promises.mjs', commit: commitOf() }
  });
}

function commitOf() {
  try {
    return execFileSync('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/* ── READING THE WORLD ─────────────────────────────────────────────────────────────────────────
   Both readers REFUSE rather than return an empty: an unreadable `gh` that answered `[]` would
   report every row as honoured. */
function readMerged(scan) {
  const out = execFileSync('gh', ['pr', 'list', '--state', 'merged', '--limit', String(scan), '--json', 'number,body,mergedAt'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const list = JSON.parse(out);
  if (!Array.isArray(list) || list.length === 0) throw new Error('no merged pull requests read');
  return list.map((x) => ({ number: x.number, body: x.body || '', mergedAt: x.mergedAt }));
}

/* The ledger is read from the REF, never from the working copy: every landing PR appends to it, so a
   checkout is behind it most of the time and a stale copy reports a closed row as still OPEN. */
function readLedger(ref) {
  const text = execFileSync('git', ['-C', REPO, 'show', `${ref}:${LEDGER}`], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  if (residueStates(text).size === 0) throw new Error(`no residue rows parsed from ${ref}:${LEDGER}`);
  return text;
}

function notRun(reason) {
  const v = Verdict.make({
    gate: GATE,
    status: 'NOT_RUN',
    population: { checked: 0, eligible: 0, excluded: 0 },
    criterion: { name: 'unhonoured_declarations', threshold: 0, unit: 'declarations', direction: 'lte' },
    result: {},
    evidence: ['tools/residue-promises.mjs'],
    reason,
    producedBy: { tool: 'tools/residue-promises.mjs', commit: commitOf() }
  });
  console.log(JSON.stringify(v));
  console.error(`⏱ UNEXAMINED ${reason}`);
  return 2;
}

/* THE ONE FIXTURE. The selftest legs and `--verdict-sample` read it, so a sample can never describe
   a shape no leg holds. Window 2: #104 and #103 stay reachable, #102 and #101 have left it. The keys
   carry pre-floor dates on purpose — see the selftest. */
export const SAMPLE_WINDOW = 2;
export function plants() {
  const ledger = [
    '| key | logged | source | defect | evidence | state |',
    '|---|---|---|---|---|---|',
    '| 2026-01-02-kept-row | 2026-11-01 | #1 | d | e | fixed #10 |',
    '| 2026-01-03-open-reachable | 2026-11-02 | #2 | d | e | OPEN |',
    '| 2026-01-04-open-unreachable | 2026-11-03 | #3 | d | e | OPEN |',
    '| 2026-01-05-two-declarers | 2026-11-04 | #4 | d | e | OPEN |',
    '| 2026-01-06-withdrawn-row | 2026-11-05 | #5 | d | e | withdrawn 2026-01-07-other |'
  ].join('\n');

  /* Four merges, window 2: #104 and #103 are reachable, #102 and #101 have left it. */
  const merged = [
    { number: 104, mergedAt: '2026-11-09T20:00:00Z', body: 'Residue-fixed: 2026-01-03-open-reachable' },
    { number: 103, mergedAt: '2026-11-09T19:00:00Z', body: 'Residue-fixed: `2026-01-05-two-declarers`' },
    {
      number: 102,
      mergedAt: '2026-11-09T18:00:00Z',
      body: 'Residue-fixed: 2026-01-04-open-unreachable, 2026-01-08-no-such-row'
    },
    {
      number: 101,
      mergedAt: '2026-11-09T17:00:00Z',
      body: 'Residue-fixed: 2026-01-02-kept-row 2026-01-05-two-declarers\nResidue-fixed: 2026-01-06-withdrawn-row'
    }
  ];
  return { merged, ledgerText: ledger };
}

/* ── SELFTEST ──────────────────────────────────────────────────────────────────────────────────── */
function selftest() {
  let fail = 0;
  let pass = 0;
  /* THE PLANT KEYS ARE DATED BEFORE THE LEDGER'S EARLIEST ROW ON PURPOSE. `tools/residue-citations.mjs`
     reads every file for key-shaped citations and reds one that names no row, and it reads the floor
     from the ledger itself: a key dated before that floor names no row and never could, which is what
     the residue tooling's fixtures rely on. Dating a plant today reds that gate — measured here, six
     citations at step 6 of 54. The last leg below holds the premise, so the floor moving says so. */
  const check = (name, ok) => {
    if (ok) pass++;
    else fail++;
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}`);
  };

  const { merged, ledgerText: ledger } = plants();

  const r = judge({ merged, ledgerText: ledger, windowLimit: 2 });
  const cls = (k) => r.rows.find((x) => x.key === k)?.class;

  check('ANTI-VACUITY · the plants produce all four classes', new Set(r.rows.map((x) => x.class)).size === 4);
  check('a row that no longer reads OPEN is closed', cls('2026-01-02-kept-row') === 'closed');
  check('a `withdrawn` state counts as closed, not as a drop', cls('2026-01-06-withdrawn-row') === 'closed');
  check('an OPEN row declared inside the window is pending', cls('2026-01-03-open-reachable') === 'pending');
  check('an OPEN row whose only declarer left the window is dropped', cls('2026-01-04-open-unreachable') === 'dropped');
  check('a key no row carries is unknown-key', cls('2026-01-08-no-such-row') === 'unknown-key');
  check(
    'one in-window declarer rescues a key an out-of-window PR also declared',
    cls('2026-01-05-two-declarers') === 'pending' && r.rows.find((x) => x.key === '2026-01-05-two-declarers').declaredBy.length === 2
  );
  check(
    'a second `Residue-fixed:` line in one body is read too',
    r.rows.some((x) => x.key === '2026-01-06-withdrawn-row')
  );
  check('every key is counted once', r.counts.promises === 6 && r.rows.length === 6);
  check('the counts add up to the promises', r.counts.closed + r.counts.pending + r.counts.dropped + r.counts.unknownKey === r.counts.promises);
  check('the window span is reported in hours', r.window.spanHours === 1);
  check('a single-merge window reports a null span, never 0', spanHours([merged[0]]) === null);

  /* The shared regex carries the global flag, so its `lastIndex` is mutable state on a module-level
     object. A second judge over the same bodies must give the same answer. */
  const again = judge({ merged, ledgerText: ledger, windowLimit: 2 });
  check('judging the same bodies twice gives the same classes', JSON.stringify(again.rows) === JSON.stringify(r.rows));

  const vFail = verdictFor(r, ['tools/residue-promises.mjs', LEDGER]);
  check('a dropped declaration FAILs', vFail.status === 'FAIL');
  check('the FAIL names the dropped key', (vFail.result.droppedKeys || []).includes('2026-01-04-open-unreachable'));
  check('the FAIL carries a reason', typeof vFail.reason === 'string' && vFail.reason.length > 0);
  check('the FAIL verdict validates', Verdict.validate(vFail).ok);

  const clean = judge({
    merged: [merged[0]],
    ledgerText: ledger,
    windowLimit: 2
  });
  const vPass = verdictFor(clean, ['tools/residue-promises.mjs', LEDGER]);
  check('a window with every promise reachable PASSes', vPass.status === 'PASS');
  check('the PASS verdict validates', Verdict.validate(vPass).ok);

  const none = judge({ merged: [{ number: 9, mergedAt: '2026-11-09T20:00:00Z', body: 'no line here' }], ledgerText: ledger });
  const vNone = verdictFor(none, ['tools/residue-promises.mjs', LEDGER]);
  check('no declaration at all is NOT_APPLICABLE, never a PASS over nothing', vNone.status === 'NOT_APPLICABLE');
  check('the NOT_APPLICABLE verdict validates', Verdict.validate(vNone).ok);

  /* The drift guard: the window this tool judges by IS the number the walker queries with. */
  const walkerSrc = readFileSync(path.join(REPO, 'tools', 'pr-walker.mjs'), 'utf8');
  check('the walker queries its merges with the constant, not a literal', /'--limit', String\(MERGED_WINDOW\)/.test(walkerSrc));
  check('the imported window is a positive integer', Number.isInteger(MERGED_WINDOW) && MERGED_WINDOW > 0);

  /* The premise above, held rather than trusted: every plant key must sort before the ledger's
     earliest row key. Fail-closed — an unreadable ledger examined nothing and never passes. */
  let floor = null;
  try {
    const real = readFileSync(path.join(REPO, LEDGER), 'utf8');
    const keys = [...residueStates(real).keys()].sort();
    floor = keys[0] ?? null;
  } catch {
    floor = null;
  }
  const plantKeys = [...new Set(r.rows.map((x) => x.key))];
  check(`every plant key sorts before the ledger's earliest row (${floor ?? 'the ledger could not be read'})`, floor !== null && plantKeys.length > 0 && plantKeys.every((k) => k < floor));

  /* THE SWEEP READS THIS LINE. `tools/selftest-all.mjs` needs the `all <N> selftests passed` spelling
     with a COMPUTED count — a typed digit defeats it in both directions, so the count comes from the
     legs themselves (`tools/selftest-all.mjs:138-179`). */
  console.log(fail === 0 ? `\n  all ${pass} selftests passed` : `\n  ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

/* ── MAIN ──────────────────────────────────────────────────────────────────────────────────────── */
function main() {
  if (has('--selftest')) return selftest();
  /* The adoption manifest runs this: the object alone, from the plant fixture, with no network. It
     FAILs by construction, because the fixture plants one dropped declaration and one unknown key. */
  if (has('--verdict-sample')) {
    const v = verdictFor(judge({ ...plants(), windowLimit: SAMPLE_WINDOW }), ['tools/residue-promises.mjs', LEDGER]);
    console.log(JSON.stringify(v));
    return 0;
  }

  const scan = Math.max(Number(arg('--scan', 200)) || 200, MERGED_WINDOW);
  const ref = arg('--ref', 'origin/main');

  let merged;
  let ledgerText;
  try {
    merged = readMerged(scan);
  } catch (e) {
    return notRun(`the merged pull requests could not be read: ${e.message}`);
  }
  try {
    ledgerText = readLedger(ref);
  } catch (e) {
    return notRun(`${ref}:${LEDGER} could not be read: ${e.message}`);
  }

  const report = judge({ merged, ledgerText });
  const v = verdictFor(report, ['tools/residue-promises.mjs', LEDGER, 'tools/pr-walker.mjs']);

  if (has('--json')) {
    console.log(JSON.stringify(v));
    return v.status === 'FAIL' ? 1 : 0;
  }

  const c = report.counts;
  console.log(`▸ ${GATE} · ${report.scanned} merge(s) scanned · window ${report.window.limit} merge(s)` + `${report.window.spanHours === null ? '' : `, ${report.window.spanHours} h`}`);
  console.log(`  promises ${c.promises} · closed ${c.closed} · pending ${c.pending} · dropped ${c.dropped} · unknown-key ${c.unknownKey}`);
  for (const r of report.dropped) console.log(`  ✗ dropped · ${r.key} — declared by ${r.declaredBy.map((n) => `#${n}`).join(' ')}, row still OPEN, past the window`);
  for (const r of report.unknownKey) console.log(`  ✗ unknown-key · ${r.key} — declared by ${r.declaredBy.map((n) => `#${n}`).join(' ')}, no such row on ${ref}`);
  if (c.pending > 0) console.log(`  … ${c.pending} declaration(s) still inside the window — the walker can close these`);
  console.log(JSON.stringify(v));

  return v.status === 'FAIL' ? 1 : 0;
}

if (isCliEntry(import.meta.url)) process.exit(main());
