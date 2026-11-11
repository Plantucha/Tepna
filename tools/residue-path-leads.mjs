#!/usr/bin/env node
/*
 * tools/residue-path-leads.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * WHICH MERGED FIX ALREADY TOUCHED THE LINE AN OPEN ROW CITES.
 *
 * A merged fix closes its row by declaring it (`Residue-fixed: <key>`, `CLAUDE.md` §📌), and
 * `tools/residue-ids.mjs --open` leads a picker to a fix whose MESSAGE names the key. Row
 * `2026-11-11-the-pickup-reader-already-names-an-undeclared-closure` leaves one half unmeasured: a
 * fix that names no key leaves no text for any reader, so no key read can reach it.
 *
 * This reader carries no text. It asks which merged commit touched the LINES the row itself cites,
 * after the row's own logged date.
 *
 * MEASURED 2026-11-11 against origin/main at 1ea2174f1, over its 35 OPEN rows:
 *   - The real case. #4834 shipped the SHORTFALL status for row
 *     `2026-11-10-the-required-secret-gate-never-ran-its-private-literal-rule`, discharging half of
 *     it. Its message names no key, so the key read lists that row with no lead at all. This reader
 *     names #4834 and #4843, and nothing else.
 *   - A FILE-level lead cannot do this job: 346 row-and-PR pairs over 21 rows, one row carrying 114
 *     PRs, even bounded to the row's logged date. A whole file's history is not a lead. The cited
 *     LINE holds it to 5 pairs over 3 rows, every row at 2 PRs or fewer.
 *
 * THREE MEASURED RULES, every one of which my own first attempt got wrong:
 *   1. The hunk's OLD side carries the row's coordinates. A row cites the file as its author saw it,
 *      and the fix lands later, so the new-side range describes a file the row never
 *      saw. Reading the new side missed #4834 and named only #4843.
 *   2. The ledger writes a second citation as a backticked bare `:NNN` that continues the nearest
 *      full citation to its left, 162 times across the ledger. Dropping that form lost the `:322`
 *      citation, which is the one #4834 touched.
 *   3. A cell escapes a literal pipe as `\|`, so the row must be split on UNESCAPED pipes only.
 *      50 ledger rows carry that escape. A bare split read 33 OPEN rows where the scanner reads 35,
 *      and it dropped `2026-09-22-cvhr-cross-node-comparability-unsupported` and
 *      `2026-09-22-buzz-on-a-worn-finger-unmeasured` in silence.
 *
 * A LEAD IS A READING ORDER, NEVER A CLOSURE (memory `a-named-by-code-marker-is-a-lead-not-a-closure`),
 * so a lead never moves this verdict's status. The criterion judges THE READ: a cited path whose
 * history this tool cannot read. `tools/residue-ids.mjs` judges the ledger's own state,
 * `tools/residue-promises.mjs` a declared closure, and `tools/residue-cite-drift.mjs` a rotted
 * citation. This tool duplicates none of them.
 *
 * THE READING (write-root brief §6.4, judge arm). It reads a ref and a git log of the RUN's
 * checkout, so it resolves through `judgeRoot` inside `main` and refuses a cross-checkout run with
 * one NOT_RUN object at exit 2. A library import and `--verdict-sample` read no tree, so neither
 * can refuse.
 *
 *   node tools/residue-path-leads.mjs                  # the report, then the verdict object
 *   node tools/residue-path-leads.mjs --ref <ref>      # read the ledger and the log from another ref
 *   node tools/residue-path-leads.mjs --window <n>     # the slack around a cited line, default 25
 *   node tools/residue-path-leads.mjs --json           # the verdict object alone on stdout
 *   node tools/residue-path-leads.mjs --selftest       # the plants, no git
 *   node tools/residue-path-leads.mjs --verdict-sample # the object over the plants, for the
 *                                                      # adoption manifest. No git.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';
import { splitRowCells } from './residue-ids.mjs';
import { WriteRootRefusal, judgeRoot } from './write-root.mjs';

/* THE DEFAULT ONLY, for a library import and for `--verdict-sample`, which read no tree. A real run
   replaces it in `main` through `judgeRoot`, because every git call below runs with `cwd: REPO`: a
   run from another checkout would read that checkout's ref and report the answer as this one's
   (row 2026-11-04-a-verdict-gate-judges-the-checkout-it-lives-in-not-the-one-it-ran-from). */
let REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)('../verdict.js');
const LEDGER = 'briefs/RESIDUE.md';
const GATE = 'residue-path-leads';

/* THE WINDOW IS PRE-STATED, and it is slack for drift between the logging and the fix, never a
   tuning knob read off the answer. A cited line moves as later edits shift it, so a fix that lands
   days later touches a hunk whose old-side range sits near the cited line rather than on it. */
const WINDOW = 25;

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};

const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 });

/* ── THE LEDGER ──────────────────────────────────────────────────────────────────────────────── */
/* A row is seven pipes, so a split gives eight cells with an empty one at each end. The STATE is
   cell 6; cell 7 is that trailing empty string, and reading it as the state reads every row as
   not-OPEN (measured: 1 of 33 rows survived that slip).

   SPLIT ON UNESCAPED PIPES ONLY, through the one scanner in `tools/residue-ids.mjs`. The row
   contract escapes a literal pipe as `\|`, so a cell quoting an alternation or a regex carries
   one. A bare split counts that escape as a cell boundary, which slides the state out of cell 6
   and reads the row as not-OPEN. The suite reads every ledger reader for the blind shape, and it
   red on this tool at step 23 of the first full gate run. */
export function parseRows(text) {
  const rows = [];
  for (const line of String(text).split('\n')) {
    if (!line.startsWith('| 20')) continue;
    const c = splitRowCells(line).map((s) => s.trim());
    if (c.length < 8) continue;
    rows.push({ key: c[1], logged: c[2], text: `${c[3]} ${c[4]} ${c[5]}`, state: c[6] });
  }
  return rows;
}

const PATH_LINE = /([A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:mjs|js|py|sh|ya?ml|json|md|html|css|toml)):(\d+)/g;
const BARE_LINE = /`:(\d+)`/g;

/* A citation this reader can lead on: a tracked CODE path with a line. It drops `briefs/**` and
   `changes/**` on purpose — a brief edit or a changeset is not a fix, and triage edits the row's own
   source brief, which would lead a picker to every triage pass. */
export function citationsOf(row, isTracked) {
  const keep = (p) => p !== LEDGER && !p.startsWith('briefs/') && !p.startsWith('changes/') && isTracked(p);
  const cites = [];
  const seen = new Set();
  const add = (p, line) => {
    if (!p || !keep(p)) return;
    const k = `${p}:${line}`;
    if (seen.has(k)) return;
    seen.add(k);
    cites.push({ path: p, line });
  };
  /* PASS A — every full `path:line`, with its offset, so pass B can inherit the nearest one. */
  const anchors = [];
  for (const m of row.text.matchAll(PATH_LINE)) {
    anchors.push({ at: m.index, path: m[1] });
    add(m[1], Number(m[2]));
  }
  /* PASS B — a backticked bare `:NNN` continues the nearest full citation to its LEFT. The
     backticks are load-bearing: an unquoted colon-number also matches a clock, as in 17:36Z. */
  for (const m of row.text.matchAll(BARE_LINE)) {
    let p = null;
    for (const a of anchors) if (a.at < m.index) p = a.path;
    add(p, Number(m[1]));
  }
  return cites;
}

/* ── THE LOG ─────────────────────────────────────────────────────────────────────────────────── */
/* Per commit that touched the path: the PR number, the date, and the OLD-side hunk ranges. */
export function parseLog(raw) {
  const out = [];
  for (const chunk of String(raw).split('\x01').slice(1)) {
    const nl = chunk.indexOf('\n');
    const head = nl < 0 ? chunk : chunk.slice(0, nl);
    const body = nl < 0 ? '' : chunk.slice(nl + 1);
    const [sha, date, subject] = head.split('\x02');
    const ranges = [];
    for (const h of body.matchAll(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/gm)) {
      const start = Number(h[1]);
      const len = h[2] === undefined ? 1 : Number(h[2]);
      ranges.push([start, start + Math.max(len, 1) - 1]);
    }
    const pr = (String(subject).match(/\(#(\d+)\)\s*$/) || [])[1] || null;
    out.push({ ref: pr ? `#${pr}` : String(sha).slice(0, 8), date: String(date).slice(0, 10), subject: String(subject), ranges });
  }
  return out;
}

function readLog(ref, p) {
  return parseLog(git(['log', ref, '--no-merges', '-U0', '--no-prefix', '--format=%x01%H%x02%cI%x02%s', '--', p]));
}

/* ── THE LEAD ────────────────────────────────────────────────────────────────────────────────── */
/* A lead is a commit that landed on or after the row's logged date, whose old-side hunk range meets
   a cited line within the window, and whose message does NOT name the key — a commit that names it
   is the key lead that `tools/residue-ids.mjs --open` already prints. */
export function leadsFor(rows, logFor, window = WINDOW) {
  const led = new Map();
  const unreadable = [];
  let citations = 0;
  let checked = 0;
  for (const r of rows) {
    if (!r.cites.length) continue;
    checked++;
    const hit = new Map();
    for (const c of r.cites) {
      citations++;
      let log;
      try {
        log = logFor(c.path);
      } catch (e) {
        unreadable.push({ key: r.key, path: c.path, reason: e.message });
        continue;
      }
      if (log === null) {
        unreadable.push({ key: r.key, path: c.path, reason: 'no history on the ref' });
        continue;
      }
      for (const commit of log) {
        if (commit.date < r.logged) continue;
        if (commit.subject.includes(r.key)) continue;
        if (!commit.ranges.some(([a, b]) => b >= c.line - window && a <= c.line + window)) continue;
        if (!hit.has(commit.ref)) hit.set(commit.ref, { ref: commit.ref, at: `${c.path}:${c.line}` });
      }
    }
    if (hit.size) led.set(r.key, [...hit.values()]);
  }
  return { led, unreadable, citations, checked };
}

export function verdictFor(report, evidence) {
  const unreadable = report.unreadable.length;
  const status = report.checked === 0 ? 'NOT_APPLICABLE' : unreadable > 0 ? 'FAIL' : 'PASS';
  const leadPairs = [...report.led.values()].reduce((n, v) => n + v.length, 0);
  return Verdict.make({
    gate: GATE,
    status,
    scope: 'internal',
    population: { checked: report.checked, eligible: report.eligible, excluded: report.eligible - report.checked },
    criterion: { name: 'unreadable_cited_paths', threshold: 0, unit: 'paths', direction: 'lte' },
    /* NOT_APPLICABLE carries a null result — the criterion does not bind, so no result exists. A
       LEAD NEVER MOVES THE STATUS, so these counts are a reading order and nothing more. */
    result:
      report.checked === 0
        ? null
        : {
            window: report.window,
            citedLines: report.citations,
            rowsLed: report.led.size,
            leadPairs,
            unreadableCitedPaths: unreadable,
            leads: Object.fromEntries([...report.led].map(([k, v]) => [k, v.map((x) => x.ref)]))
          },
    reason:
      status === 'PASS'
        ? null
        : status === 'NOT_APPLICABLE'
          ? `no OPEN row cites a tracked code path with a line, over ${report.eligible} OPEN row(s)`
          : `${unreadable} cited path(s) could not be read: ${report.unreadable.map((u) => u.path).join(', ')}`,
    evidence,
    producedBy: { tool: 'tools/residue-path-leads.mjs', commit: report.commit }
  });
}

/* ── THE PLANTS ──────────────────────────────────────────────────────────────────────────────── */
/* ONE FIXTURE, read by the selftest and by `--verdict-sample`, so a sample can never describe
   something the legs never drove. It plants the three shapes that decide: a lead by the old side, a
   row whose only citation sits in `briefs/`, and a path whose history cannot be read. */
export function plants() {
  const ledger = [
    '| key | logged | source | defect | evidence | state |',
    '|---|---|---|---|---|---|',
    '| 2026-01-01-a-plant-with-a-cited-line | 2026-01-02 | `tools/plant.mjs` | the gate reads a plant | `tools/plant.mjs:100` names it and `:300` prints it | OPEN |',
    '| 2026-01-01-a-plant-citing-only-a-brief | 2026-01-02 | `briefs/PLANT-BRIEF.md` | a brief cites itself | `briefs/PLANT-BRIEF.md:10` | OPEN |',
    '| 2026-01-01-a-plant-whose-path-is-unreadable | 2026-01-02 | `tools/gone.mjs` | the history is unreadable | `tools/gone.mjs:5` | OPEN |',
    '| 2026-01-01-a-plant-already-closed | 2026-01-02 | `tools/plant.mjs` | a closed row is not a pickup | `tools/plant.mjs:100` | fixed #1 |'
  ].join('\n');
  const tracked = new Set(['tools/plant.mjs', 'tools/gone.mjs', 'briefs/PLANT-BRIEF.md']);
  const log = {
    /* #11 meets the `:300` citation on the OLD side only — the new side sits at 900, far outside the
       window, which is the slip that missed the real #4834. #12 names the key, so the key read owns
       it. #13 predates the row. #14 misses every cited line. */
    'tools/plant.mjs': parseLog(
      `\x01aaaaaaaaaaaa\x022026-02-01T00:00:00Z\x02Move the plant print (#11)\n@@ -298,4 +900,2 @@ plant\n` +
        `\x01bbbbbbbbbbbb\x022026-02-02T00:00:00Z\x02Fix 2026-01-01-a-plant-with-a-cited-line (#12)\n@@ -100,1 +100,1 @@ plant\n` +
        `\x01cccccccccccc\x022026-01-01T00:00:00Z\x02An earlier pass (#13)\n@@ -100,1 +100,1 @@ plant\n` +
        `\x01dddddddddddd\x022026-02-03T00:00:00Z\x02An unrelated region (#14)\n@@ -700,2 +700,2 @@ plant\n`
    )
  };
  return { ledger, tracked, log };
}

function judgePlants(window = WINDOW) {
  const p = plants();
  const rows = parseRows(p.ledger)
    .filter((r) => r.state === 'OPEN')
    .map((r) => ({ ...r, cites: citationsOf(r, (x) => p.tracked.has(x)) }));
  const eligible = parseRows(p.ledger).filter((r) => r.state === 'OPEN').length;
  const out = leadsFor(
    rows,
    (x) => {
      if (!(x in p.log)) throw new Error('no such path in the plant log');
      return p.log[x];
    },
    window
  );
  return { ...out, eligible, window, commit: 'c0ffee00' };
}

/* ── SELFTEST ────────────────────────────────────────────────────────────────────────────────── */
function selftest() {
  let pass = 0;
  let fail = 0;
  const check = (name, ok) => {
    if (ok) {
      pass++;
      console.log(`  ✓ ${name}`);
    } else {
      fail++;
      console.log(`  ✕ ${name}`);
    }
  };

  const rows = parseRows(plants().ledger);
  check('the state cell is cell 6, so 3 of 4 plant rows read OPEN', rows.filter((r) => r.state === 'OPEN').length === 3);
  check('a closed plant row carries its state', rows.find((r) => r.key.endsWith('already-closed')).state === 'fixed #1');

  const tracked = new Set(['tools/plant.mjs', 'tools/gone.mjs', 'briefs/PLANT-BRIEF.md']);
  const isT = (x) => tracked.has(x);
  const withLine = citationsOf(rows[0], isT);
  check(
    'pass A reads the full path:line citation',
    withLine.some((c) => c.path === 'tools/plant.mjs' && c.line === 100)
  );
  check(
    'pass B inherits the path across a backticked bare :NNN',
    withLine.some((c) => c.path === 'tools/plant.mjs' && c.line === 300)
  );
  check('a brief-only citation never leads, because a brief edit is not a fix', citationsOf(rows[1], isT).length === 0);
  check('an untracked path never leads', citationsOf({ text: '`tools/never.mjs:4`' }, isT).length === 0);
  check('a clock is not a citation', citationsOf({ text: 'run at 2026-11-10T17:36Z' }, isT).length === 0);
  check('the ledger itself is never a cited path', citationsOf({ text: `\`${LEDGER}:1440\`` }, isT).length === 0);

  /* THE ESCAPE. A cell may quote an alternation, and the row contract writes that pipe as `\|`. */
  const esc = parseRows('| 2026-01-01-a-plant-quoting-an-alternation | 2026-01-02 | `tools/plant.mjs` | a cell quotes an alternation | it reads `a\\|b` there | OPEN |');
  check('an escaped pipe does not slide the state out of cell 6', esc.length === 1 && esc[0].state === 'OPEN');
  check('…and the escape stays inside its own cell', esc.length === 1 && esc[0].text.includes('a\\|b'));

  const r = judgePlants();
  const led = r.led.get('2026-01-01-a-plant-with-a-cited-line') || [];
  check(
    'a hunk meeting the cited line on the OLD side leads',
    led.some((x) => x.ref === '#11')
  );
  check(
    'the lead names the citation it met',
    led.some((x) => x.at === 'tools/plant.mjs:300')
  );
  check('a commit naming the key is left to the key read', !led.some((x) => x.ref === '#12'));
  check('a commit older than the row never leads', !led.some((x) => x.ref === '#13'));
  check('a hunk outside the window never leads', !led.some((x) => x.ref === '#14'));
  check('the plant yields exactly one lead', led.length === 1);
  check('a closed row is never led', !r.led.has('2026-01-01-a-plant-already-closed'));
  check(
    'a path with no readable history is named, not skipped',
    r.unreadable.some((u) => u.path === 'tools/gone.mjs')
  );

  /* THE WINDOW IS LIVE: at 0 the `:300` citation no longer meets the hunk at 298 to 301 — it does,
     so drive it with a window that cannot reach, and read the lead away. */
  const narrow = judgePlants(0);
  const nled = narrow.led.get('2026-01-01-a-plant-with-a-cited-line') || [];
  check('the window is live: 300 still sits inside the 298-301 hunk at window 0', nled.length === 1);
  const tight = judgePlants(-10);
  check('a window that cannot reach the hunk drops the lead', (tight.led.get('2026-01-01-a-plant-with-a-cited-line') || []).length === 0);

  const v = verdictFor(r, ['tools/residue-path-leads.mjs', LEDGER]);
  check('the plant verdict FAILs on the unreadable path', v.status === 'FAIL');
  check('the FAIL verdict validates', Verdict.validate(v).ok);
  check('the population adds up', v.population.checked + v.population.excluded === v.population.eligible);
  check('a lead never moves the status', v.result.rowsLed === 1 && v.status === 'FAIL' && v.result.unreadableCitedPaths === 1);

  const none = verdictFor({ led: new Map(), unreadable: [], citations: 0, checked: 0, eligible: 7, window: WINDOW, commit: 'c0ffee00' }, ['tools/residue-path-leads.mjs', LEDGER]);
  check('no cited line is NOT_APPLICABLE with a null result', none.status === 'NOT_APPLICABLE' && none.result === null);
  check('the NOT_APPLICABLE verdict validates', Verdict.validate(none).ok);
  const clean = verdictFor({ led: new Map([['k', [{ ref: '#9', at: 'a.mjs:1' }]]]), unreadable: [], citations: 2, checked: 1, eligible: 3, window: WINDOW, commit: 'c0ffee00' }, [
    'tools/residue-path-leads.mjs',
    LEDGER
  ]);
  check('a readable run PASSes while it still carries a lead', clean.status === 'PASS' && clean.result.leadPairs === 1);
  check('the PASS verdict validates', Verdict.validate(clean).ok);

  /* THE SWEEP READS THIS LINE. `tools/selftest-all.mjs` needs the `all <N> selftests passed`
     spelling with a COMPUTED count — a typed digit defeats it in both directions. */
  console.log(fail === 0 ? `\n  all ${pass} selftests passed` : `\n  ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

/* ── MAIN ────────────────────────────────────────────────────────────────────────────────────── */
function notRun(reason) {
  const v = Verdict.make({
    gate: GATE,
    status: 'NOT_RUN',
    scope: 'internal',
    population: { checked: 0, eligible: 0, excluded: 0 },
    criterion: { name: 'unreadable_cited_paths', threshold: 0, unit: 'paths', direction: 'lte' },
    result: null,
    reason,
    evidence: ['tools/residue-path-leads.mjs'],
    producedBy: { tool: 'tools/residue-path-leads.mjs', commit: null, commitReason: 'the ref could not be read, so this run resolved no commit' }
  });
  console.log(JSON.stringify(v));
  console.error(`REFUSING: ${reason}`);
  return 2;
}

function main() {
  if (has('--selftest')) return selftest();
  if (has('--verdict-sample')) {
    console.log(JSON.stringify(verdictFor(judgePlants(), ['tools/residue-path-leads.mjs', LEDGER])));
    return 0;
  }

  /* A READER JUDGES THE CHECKOUT IT WAS RUN FROM, never the one it lives in. The refusal goes
     through `notRun`, so a cross-checkout run still emits one verdict rather than dying mute. */
  try {
    REPO = judgeRoot(import.meta.url);
  } catch (e) {
    if (!(e instanceof WriteRootRefusal)) throw e;
    console.error(e.message);
    return notRun(`this run and tools/residue-path-leads.mjs sit in different checkouts (${e.reason}), so which tree to read is undecided`);
  }

  const ref = arg('--ref', 'origin/main');
  const window = Number(arg('--window', WINDOW));
  if (!Number.isFinite(window)) return notRun(`--window must be a number, not ${arg('--window', '')}`);

  let ledgerText;
  let tracked;
  let commit;
  try {
    ledgerText = git(['show', `${ref}:${LEDGER}`]);
    tracked = new Set(git(['ls-tree', '-r', '--name-only', ref]).split('\n'));
    commit = git(['rev-parse', '--short', ref]).trim();
  } catch (e) {
    return notRun(`${ref} could not be read: ${e.message}`);
  }

  const all = parseRows(ledgerText);
  const open = all.filter((r) => r.state === 'OPEN');
  const rows = open.map((r) => ({ ...r, cites: citationsOf(r, (p) => tracked.has(p)) }));

  const cache = new Map();
  const logFor = (p) => {
    if (!cache.has(p)) cache.set(p, readLog(ref, p));
    const log = cache.get(p);
    return log.length ? log : null;
  };

  const out = leadsFor(rows, logFor, window);
  const report = { ...out, eligible: open.length, window, commit };
  const v = verdictFor(report, ['tools/residue-path-leads.mjs', LEDGER]);

  if (has('--json')) {
    console.log(JSON.stringify(v));
    return v.status === 'FAIL' ? 1 : 0;
  }

  console.log(`▸ ${GATE} · ${open.length} OPEN row(s) on ${ref} · ${report.checked} citing a code line · ${report.citations} citation(s) · window ±${window}`);
  for (const [key, hits] of report.led) {
    console.log(`  ${key}`);
    console.log(`      ← touched the cited line: ${hits.map((h) => `${h.ref} (${h.at})`).join(', ')}`);
  }
  for (const u of report.unreadable) console.log(`  ⚠ ${u.key} — ${u.path} could not be read: ${u.reason}`);
  if (report.led.size === 0 && report.checked > 0) console.log('  no OPEN row has a merged fix on a cited line');
  console.log(`  ${GATE}: a lead is a READING ORDER. Read the pull request before you size the row, and never read a lead as a closure.`);
  console.log(JSON.stringify(v));

  return v.status === 'FAIL' ? 1 : 0;
}

if (isCliEntry(import.meta.url)) process.exit(main());
