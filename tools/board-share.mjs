#!/usr/bin/env node
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// board-share.mjs — measure how much of Rule 0's top five the agent board takes, so the cap the
// owner deferred can be ordered on a reading rather than on a worry.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS: THE DEFERRAL HAD A TRIGGER NOBODY COULD READ.
//
// Residue `2026-10-18-board-hits-have-no-share-cap-in-rule-0`: board posts join the Rule 0 corpus
// with no limit on their share of the top five hits. The owner deferred the cap on 2026-10-17 —
// "the cap waits until the board nears 1,000 posts". That trigger is a STAND-IN for the thing
// anyone actually cares about, which is whether briefs and code still hold the top five.
//
// The proxy has since fired and the harm has not. Measured 2026-10-28 on the live board:
//
//   | reading                         | 2026-10-18 (the row) | 2026-10-28 |
//   |---------------------------------|----------------------|------------|
//   | entries                         | 75                   | 1819       |
//   | of the four indexed kinds       | 49                   | 723        |
//   | snapshot bytes                  | 135 KB               | 2.4 MB     |
//   | board hits in the top five      | not measured         | 3 of 95    |
//   | worst single query              | not measured         | 1 of 5     |
//
// So the post count passed 1,000 while the crowding it stands in for never arrived. A cap written
// today would bind on nothing, and a cap that binds on nothing is the examined-nothing shape this
// repo spends its gates refusing. The buildable half is therefore the INSTRUMENT, not the cap:
// state the threshold up front, read the share on a fixed query set, and let the reading say when
// the cap is owed.
//
// THIS TOOL CHANGES NOTHING. It runs doc-search over a committed query set, counts how many of
// each query's top five hits are board posts, and emits one `tepna.verdict/1`.
//
// 🔴 A QUERY THAT COULD NOT RUN IS NOT A QUERY WITH NO BOARD HITS. The two absences are reported
// apart — `unreadable` (doc-search failed) and `below-floor` (doc-search ran and the reranker
// returned nothing above its floor) — because one slot of the population is missing and the other
// is genuinely empty, and a single `excluded` cell cannot say which (§∅).
//
// PRIMARY DEV MACHINE ONLY, the same scope as doc-search and board-corpus: the index is local and
// ships with nothing. No index, no reading — `NOT_RUN`, never a PASS. No gate and no CI step may
// read this tool's output.
//
//   node tools/board-share.mjs                 # the table and the verdict
//   node tools/board-share.mjs --json          # the verdict object alone
//   node tools/board-share.mjs --arm fleet     # one arm of the query set
//   node tools/board-share.mjs --selftest
//   node tools/board-share.mjs --verdict-sample
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = process.env.TEPNA_BOARD_CORPUS || path.join(homedir(), '.local/share/tepna/board-corpus');

/* The board's own path prefix in a doc-search hit: `ext:agent-board/<thread>/<entry>.md`. */
export const BOARD_PREFIX = 'ext:agent-board/';

/* Rule 0's metric is recall@5, so five is the window the threshold is written against. */
export const TOP_N = 5;

/* 🔴 PRE-STATED, AND NOT FROM THE DATA IT JUDGES — a threshold read off today's reading is
   `UNKNOWN` under the verdict contract. This one comes from the SHAPE of a five-slot list: at
   three of five the board holds the majority and fewer than half the slots are left for briefs and
   code, so the bound is two of five. The aggregate share is reported beside it as a diagnostic,
   never as the criterion, because an average hides the one query that was swamped. */
export const MAX_SHARE = 0.4;

/* 🔴 A QUERY STAYS IN THE SET WHEN IT ANSWERS NOTHING. Dropping the one query the reranker floor
   rejects would curate the population into the queries that happen to produce hits, and a share
   measured over a curated set is a statement about the curation. It is carried as `below-floor`.

   Two arms, because a cap can harm as well as help. The `repo` arm asks the questions Rule 0 exists
   for, where a board hit displaces a brief. The `fleet` arm asks what the board is genuinely the
   best source for, where a cap would cost recall. A remedy must be weighed against both. */
export const QUERIES = {
  repo: [
    'how does the clock contract handle a missing timestamp',
    'what makes a fixture output move and how is it regenerated',
    'why does a bundle lose DexClock and what breaks',
    'how is absence represented in an export',
    'what does the provenance gate A actually hash',
    'how does the mutation gate decide a survivor is equivalent',
    'what is the rule for a verdict with population checked zero',
    'how does the capture host poll the ring in split mode',
    'what governs the rate correction on the host axis',
    'how are evidence badges wired into a new surface',
    'when does a release refuse to cut',
    'what is the policy on literature-sourced constants in a bundle'
  ],
  fleet: [
    'who undrafts a pull request and what is the open PR cap',
    'what did the owner rule about deploys to the capture box',
    'how does a bird relay a branch without push credentials',
    'what is the rule about closing a residue row in a code PR',
    'how should a session report a gate result to the coordinator',
    'what did the owner decide about per-night values in the public repo',
    'how are fleet session names assigned and verified',
    'what is the standing rule about agents and workflows'
  ]
};

/* The scored lines of a `--brief` run: two leading spaces, a 0.000 score, then the path. A line
   that does not match is prose, and prose is not a hit. */
const SCORED = /^ {2}(\d\.\d{3}) {2}(\S+)/;

export function parseHits(stdout, topN = TOP_N) {
  const hits = [];
  for (const line of String(stdout ?? '').split('\n')) {
    const m = SCORED.exec(line);
    if (m) hits.push(m[2]);
    if (hits.length === topN) break;
  }
  return hits;
}

/**
 * One query's reading. `hits === null` means the search did not run; an EMPTY list means it ran and
 * the reranker floor rejected everything. Those are different absences and keep different states.
 */
export function readingFor(q, arm, hits, note = null) {
  if (hits === null || hits === undefined) {
    return { q, arm, state: 'unreadable', slots: 0, board: 0, share: null, note: note || 'doc-search did not complete for this query' };
  }
  if (hits.length === 0) {
    return { q, arm, state: 'below-floor', slots: 0, board: 0, share: null, note: note || 'doc-search ran and returned nothing above the reranker floor' };
  }
  const board = hits.filter((h) => h.startsWith(BOARD_PREFIX)).length;
  return { q, arm, state: 'measured', slots: hits.length, board, share: board / hits.length, note: null };
}

/**
 * THE VERDICT. `rows === null` is NOT_RUN, not a clean sheet. An absent board corpus is
 * NOT_APPLICABLE: the question was examined and the board is not in the index at all, so the rule
 * about its share does not bind.
 */
export function shareVerdict(rows, { corpusPresent = true, commit = null, commitReason = null, at = null } = {}) {
  const base = {
    schema: 'tepna.verdict/1',
    gate: 'board-share',
    scope: 'internal',
    criterion: { name: 'max_board_share_of_top_five', threshold: MAX_SHARE, unit: 'share', direction: 'lte' },
    evidence: ['tools/board-share.mjs', 'tools/doc-search.mjs', 'briefs/RESIDUE.md#2026-10-18-board-hits-have-no-share-cap-in-rule-0'],
    producedBy: { tool: 'tools/board-share.mjs', commit, ...(commit ? {} : { commitReason: commitReason || 'git rev-parse did not answer in this checkout' }) },
    at: at || new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  };
  const none = (status, reason) => ({
    ...base,
    status,
    population: { checked: 0, eligible: Array.isArray(rows) ? rows.length : 0, excluded: Array.isArray(rows) ? rows.length : 0 },
    result: null,
    reason
  });

  if (rows === null || rows === undefined) return none('NOT_RUN', 'the query set did not run — nothing was examined');
  if (!corpusPresent) return none('NOT_APPLICABLE', `no board corpus at the configured path, so no board post can reach a hit list on this machine`);

  const measured = rows.filter((r) => r.state === 'measured');
  const unreadable = rows.filter((r) => r.state === 'unreadable');
  const belowFloor = rows.filter((r) => r.state === 'below-floor');
  const population = { checked: measured.length, eligible: rows.length, excluded: unreadable.length + belowFloor.length };

  if (measured.length === 0) {
    return { ...base, status: 'NOT_RUN', population, result: null, reason: `no query returned a hit list: ${unreadable.length} did not run, ${belowFloor.length} fell below the reranker floor` };
  }

  const slots = measured.reduce((a, r) => a + r.slots, 0);
  const board = measured.reduce((a, r) => a + r.board, 0);
  const worst = measured.reduce((a, r) => (r.share > a.share ? r : a), measured[0]);
  const byArm = {};
  for (const r of measured) {
    if (!byArm[r.arm]) byArm[r.arm] = { queries: 0, slots: 0, board: 0 };
    const b = byArm[r.arm];
    b.queries++;
    b.slots += r.slots;
    b.board += r.board;
  }
  const result = {
    maxShare: worst.share,
    worstQuery: worst.q,
    worstCounts: `${worst.board} of ${worst.slots}`,
    overallShare: board / slots,
    boardHits: board,
    slots,
    byArm,
    unreadable: unreadable.map((r) => r.q),
    belowFloor: belowFloor.map((r) => r.q)
  };

  if (worst.share > MAX_SHARE) {
    return {
      ...base,
      status: 'FAIL',
      population,
      result,
      reason: `the board takes ${worst.board} of ${worst.slots} top hits for "${worst.q}", over the stated bound of ${MAX_SHARE} — the cap the owner deferred is now owed`
    };
  }
  return { ...base, status: 'PASS', population, result, reason: null };
}

/* ── the impure half ─────────────────────────────────────────────────────────────────────────── */

function runQuery(q) {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'doc-search.mjs'), '--brief', q], {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
      maxBuffer: 32 * 1024 * 1024
    });
    return parseHits(out);
  } catch {
    return null;
  }
}

export function survey(arms, run = runQuery) {
  const rows = [];
  for (const arm of arms) for (const q of QUERIES[arm] ?? []) rows.push(readingFor(q, arm, run(q)));
  return rows;
}

function headCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function pct(x) {
  return x === null || x === undefined ? '  n/a' : `${(x * 100).toFixed(1)}%`;
}

function report(rows, v) {
  console.log(`▸ board share of the Rule 0 top ${TOP_N} · bound ${pct(MAX_SHARE)} per query\n`);
  for (const r of rows) {
    const cell = r.state === 'measured' ? `${r.board}/${r.slots}  ${pct(r.share)}` : `  ${r.state}`;
    console.log(`  ${cell.padEnd(14)} ${r.arm.padEnd(6)} ${r.q}`);
  }
  if (v.result) {
    console.log(`\n  worst: ${v.result.worstCounts} for "${v.result.worstQuery}" (${pct(v.result.maxShare)})`);
    console.log(`  overall: ${v.result.boardHits} of ${v.result.slots} slots (${pct(v.result.overallShare)})`);
    for (const [arm, b] of Object.entries(v.result.byArm)) console.log(`    ${arm.padEnd(6)} ${b.board} of ${b.slots} over ${b.queries} query(ies)`);
  }
  console.log(`\n${JSON.stringify(v)}`);
  console.log(`\n${v.status}${v.reason ? ` — ${v.reason}` : ''}`);
}

/* ── CLI ─────────────────────────────────────────────────────────────────────────────────────── */

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { boolean: ['--json', '--selftest', '--verdict-sample'], valued: ['--arm'] }, { tool: 'board-share.mjs' });

  if (argv.includes('--verdict-sample')) {
    const planted = [
      readingFor('a repo question', 'repo', ['briefs/A-BRIEF.md', 'tools/b.mjs', `${BOARD_PREFIX}1/7.md`, 'docs/C.md', 'd.js']),
      readingFor('a fleet question', 'fleet', [`${BOARD_PREFIX}8/9.md`, 'CLAUDE.md', 'docs/E.md', 'f.mjs', 'g.md']),
      readingFor('a query that did not run', 'repo', null),
      readingFor('a query below the floor', 'repo', [])
    ];
    console.log(JSON.stringify(shareVerdict(planted, { commit: headCommit(), at: '2026-10-28T00:00:00Z' })));
    process.exit(0);
  }

  if (argv.includes('--selftest')) {
    let ran = 0;
    const fails = [];
    const ok = (name, cond, detail = '') => {
      ran++;
      if (!cond) fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
    };
    const { createRequire } = await import('node:module');
    const V = createRequire(import.meta.url)(path.join(ROOT, 'verdict.js'));

    /* parseHits reads the scored lines and stops at the window. */
    const out = [
      '▸ hybrid · "q"',
      '',
      '  0.904  briefs/X-BRIEF.md:1-9',
      `  0.800  ${BOARD_PREFIX}1/7.md`,
      '  0.700  tools/y.mjs',
      '  0.600  docs/z.md',
      '  0.500  a.js',
      '  0.400  b.js',
      '  ⚠ these are PATHS TO READ'
    ].join('\n');
    ok('parseHits takes the scored lines only', parseHits(out).length === 5, String(parseHits(out).length));
    ok('…and keeps the order', parseHits(out)[0] === 'briefs/X-BRIEF.md:1-9');
    ok('…and stops at the window', !parseHits(out).includes('b.js'));
    ok('prose alone is no hit at all', parseHits('▸ hybrid\n  no prior work — best 0.08\n').length === 0);

    /* 🔴 THE TWO ABSENCES KEEP THEIR OWN STATES. */
    ok('a query that did not run is unreadable', readingFor('q', 'repo', null).state === 'unreadable');
    ok('…and reports NO share, never a zero', readingFor('q', 'repo', null).share === null);
    ok('a query the floor rejected is below-floor', readingFor('q', 'repo', []).state === 'below-floor');
    ok('…and is a different state from unreadable', readingFor('q', 'repo', []).state !== readingFor('q', 'repo', null).state);
    ok('a measured query counts only board paths', readingFor('q', 'repo', [`${BOARD_PREFIX}1/2.md`, 'briefs/A.md', 'ext:memory/b.md']).board === 1);
    ok('…and a memory hit is not a board hit', readingFor('q', 'repo', ['ext:memory/b.md']).board === 0);

    const clean = [readingFor('a', 'repo', ['briefs/A.md', 'b.mjs', 'c.md', 'd.md', 'e.md']), readingFor('b', 'fleet', [`${BOARD_PREFIX}1/1.md`, 'b.mjs', 'c.md', 'd.md', 'e.md'])];
    const vClean = shareVerdict(clean, { commit: 'abc12345', at: '2026-10-28T00:00:00Z' });
    ok('a list the board does not dominate PASSes', vClean.status === 'PASS', vClean.reason || '');
    ok('…with a null reason', vClean.reason === null);
    ok('…and the PASS verdict validates', V.validate(vClean).ok, V.validate(vClean).errors.join(' | '));
    ok('…counting every slot it examined', vClean.result.slots === 10 && vClean.result.boardHits === 1, JSON.stringify(vClean.result.slots));

    /* PLANT — the defect this tool exists for: one query swamped by board posts. */
    const swamped = [...clean, readingFor('c', 'repo', [`${BOARD_PREFIX}1/1.md`, `${BOARD_PREFIX}1/2.md`, `${BOARD_PREFIX}1/3.md`, 'briefs/A.md', 'b.mjs'])];
    const vBad = shareVerdict(swamped, { commit: 'abc12345', at: '2026-10-28T00:00:00Z' });
    ok('three of five trips the stated bound', vBad.status === 'FAIL', vBad.status);
    ok('…and names the query that was swamped', vBad.reason.includes('"c"'), vBad.reason);
    ok('…and the FAIL verdict validates', V.validate(vBad).ok, V.validate(vBad).errors.join(' | '));
    ok('🔴 THE WORST QUERY IS NOT THE AVERAGE — the overall share stays under the bound here', vBad.result.overallShare <= MAX_SHARE, String(vBad.result.overallShare));
    ok('exactly two of five does NOT trip it', shareVerdict([readingFor('c', 'repo', [`${BOARD_PREFIX}1/1.md`, `${BOARD_PREFIX}1/2.md`, 'a.md', 'b.md', 'c.md'])], {}).status === 'PASS');

    /* The absence shapes, each its own verdict. */
    const vNull = shareVerdict(null, {});
    ok('no survey at all is NOT_RUN', vNull.status === 'NOT_RUN');
    ok('…examining nothing', vNull.population.checked === 0 && vNull.result === null);
    ok('…and validates', V.validate(vNull).ok, V.validate(vNull).errors.join(' | '));
    const vNoCorpus = shareVerdict(clean, { corpusPresent: false });
    ok('an absent board corpus is NOT_APPLICABLE, never a PASS', vNoCorpus.status === 'NOT_APPLICABLE', vNoCorpus.status);
    ok('…and validates', V.validate(vNoCorpus).ok, V.validate(vNoCorpus).errors.join(' | '));
    const vAllOut = shareVerdict([readingFor('a', 'repo', null), readingFor('b', 'repo', [])], {});
    ok('🔴 A SURVEY THAT MEASURED NOTHING IS NOT_RUN, NOT A CLEAN SHEET', vAllOut.status === 'NOT_RUN', vAllOut.status);
    ok('…and its reason separates the two absences', vAllOut.reason.includes('did not run') && vAllOut.reason.includes('floor'), vAllOut.reason);
    ok('…and both leave the checked count', vAllOut.population.checked === 0 && vAllOut.population.excluded === 2);
    ok('the population adds up', vClean.population.checked + vClean.population.excluded === vClean.population.eligible);

    /* The query set is the population, and it must not quietly empty. */
    ok('both arms carry queries', QUERIES.repo.length > 5 && QUERIES.fleet.length > 5, `${QUERIES.repo.length}/${QUERIES.fleet.length}`);
    ok('no query is duplicated across the arms', new Set([...QUERIES.repo, ...QUERIES.fleet]).size === QUERIES.repo.length + QUERIES.fleet.length);
    const surveyed = survey(['repo'], () => ['a.md']);
    ok('survey reads every query of the arm it was given', surveyed.length === QUERIES.repo.length, String(surveyed.length));
    ok(
      '…and tags each row with its arm',
      surveyed.every((r) => r.arm === 'repo')
    );
    ok('an unknown arm contributes nothing rather than throwing', survey(['nope'], () => ['a.md']).length === 0);

    console.log(fails.length ? `board-share selftest: ${fails.length} FAILED of ${ran}\n  ${fails.join('\n  ')}` : `all ${ran} selftests passed`);
    process.exit(fails.length ? 1 : 0);
  }

  const armArg = argv.includes('--arm') ? argv[argv.indexOf('--arm') + 1] : null;
  const arms = armArg ? [armArg] : Object.keys(QUERIES);
  const corpusPresent = existsSync(CORPUS);
  const rows = corpusPresent ? survey(arms) : [];
  const v = shareVerdict(corpusPresent ? rows : [], { corpusPresent, commit: headCommit() });
  if (argv.includes('--json')) console.log(JSON.stringify(v));
  else report(rows, v);
  process.exit(v.status === 'FAIL' ? 1 : 0);
}
