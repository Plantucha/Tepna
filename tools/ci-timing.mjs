#!/usr/bin/env node
/*
 * tools/ci-timing.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * WHICH CHECK IS THE MERGE RACE? — per-job CI timings, measured.
 *
 * CLAUDE.md §👥.5 costs this out: `main` moves a MEDIAN 7.2 min between merges, CI is ~10–12 min
 * across the required checks, and `protect-main` sets `required_status_checks.strict = true`, so a
 * PR must hold every check green AND main must stand still in the same instant. That window is open
 * well under half the time, and every minute of CI makes it narrower.
 *
 * The cadence lever (fewer, larger PRs) is the bigger term and belongs to the author. THIS tool
 * addresses the other one, and it exists because the obvious question — *which* check costs the
 * most — had no answer anyone had measured. "CI is 10-12 minutes" is a sum; a sum does not tell you
 * where to spend an optimisation.
 *
 * WHAT IT REPORTS, and why each column:
 *   · p50 / p90 / max per job. The MAX matters more than the mean here: the merge window is lost by
 *     the slowest run, not the typical one, and a job with a fat tail costs more races than a job
 *     that is uniformly slower.
 *   · The CRITICAL PATH — jobs run in parallel, so total wall is the SLOWEST job, not the sum.
 *     Optimising a job that is not on the critical path buys exactly nothing, which is the mistake
 *     this column exists to prevent.
 *   · WAIT time separately from RUN time — `started_at − run.created_at`. ⚠️ That is NOT purely
 *     runner queueing: for a job with `needs:` it also contains every dependency's runtime, so a
 *     3-second job can show a 10-minute wait and be perfectly healthy. Read it as "how long after
 *     the run was created did this job begin", which is the number that matters for the merge race,
 *     and do not read it as a scheduling complaint.
 *
 * IT MEASURES `main` BY DEFAULT, not pull requests: a PR's timings include its own retries and
 * whatever the author was doing, while main's are the population the race is actually run against.
 *
 * ⚠️ A MAIN SAMPLE REACHES NO `pull_request`-ONLY JOB. `relevance (browser-gates)` and `stale-file`
 * never run on main, so `--branch main` returned no rows for either and both caps were sized by
 * borrowing another job's sample (row `2026-11-03-ci-timing-reaches-no-pull-request-only-job`). A cap
 * nobody can re-derive is a number a later session argues about. `--event pull_request` samples the
 * PR population instead, and DROPS the branch filter unless `--branch` is passed, because every PR run
 * sits on its own head branch. The population travels in the header and in `--json`, so a figure read
 * out of this tool always carries the sample it came from.
 *
 * USAGE (needs `gh` authenticated; on a runner, GH_TOKEN is enough)
 *   node tools/ci-timing.mjs                      # last 40 runs on main, markdown table
 *   node tools/ci-timing.mjs --limit 100
 *   node tools/ci-timing.mjs --branch some-branch
 *   node tools/ci-timing.mjs --event pull_request   # the only sample that reaches a PR-only job
 *   node tools/ci-timing.mjs --workflow stale-file.yml --event pull_request --limit 100
 *   node tools/ci-timing.mjs --json               # machine-readable, for a summary step
 *   node tools/ci-timing.mjs --selftest           # known-answer; makes no network call
 *
 * NO NETWORK IN THE SELFTEST, and the statistics are pure functions, so the arithmetic is gate-able
 * without a live API — the same reason `mutate.mjs`'s classifier is known-answer tested rather than
 * pinned to a 90-minute sweep.
 * ══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};

/* ── pure statistics ──────────────────────────────────────────────────────────────────────── */

/* Nearest-rank percentile on a sorted copy. Deliberately NOT interpolating: an interpolated p90 of
   a 5-run sample invents a duration no run had, and these samples are small. */
export function pct(values, p) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const rank = Math.ceil((p / 100) * v.length);
  return v[Math.min(v.length - 1, Math.max(0, rank - 1))];
}

export function fmtDur(sec) {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.round(sec);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

/* A job's duration is `completed_at − started_at`; its QUEUE is `started_at − run.created_at`.
   Skipped jobs have no timings and must be dropped rather than counted as instant — a skipped job
   scoring 0 s would drag every percentile toward a duration nothing ever took. */
export function summarise(jobs) {
  const byName = new Map();
  for (const j of jobs) {
    if (!j || !j.name) continue;
    if (j.conclusion === 'skipped' || !j.started_at || !j.completed_at) continue;
    const run = (new Date(j.completed_at) - new Date(j.started_at)) / 1000;
    /* wait = time from RUN CREATION to this job starting. Includes runner queueing AND, for a job
       with `needs:`, its dependencies' runtime. Named `wait`, not `queue`, because the first draft
       called it queue and the very first real run made that label wrong: the `test` job showed a
       10m05s "queue" for a 3-second job — it was waiting on `needs:`, not on a runner. */
    const wait = j.run_created_at ? (new Date(j.started_at) - new Date(j.run_created_at)) / 1000 : null;
    if (!Number.isFinite(run) || run < 0) continue;
    if (!byName.has(j.name)) byName.set(j.name, { name: j.name, runs: [], queues: [], fails: 0, cancels: 0, n: 0 });
    const e = byName.get(j.name);
    e.runs.push(run);
    if (Number.isFinite(wait) && wait >= 0) e.queues.push(wait);
    e.n++;
    if (j.conclusion && j.conclusion !== 'success') e.fails++;
    /* A CANCELLED JOB'S DURATION IS A LOWER BOUND, NOT A DURATION. A job killed at its own
       `timeout-minutes` reports `cancelled` at almost exactly the cap, so its real runtime is
       unknown and at least that long. Counted separately because a max computed over censored
       rows UNDER-states the tail, and a cap derived from that max inherits the error — which is
       how a cap that was already too small kept re-deriving as adequate. */
    if (j.conclusion === 'cancelled') e.cancels++;
  }
  const rows = [...byName.values()].map((e) => ({
    name: e.name,
    n: e.n,
    p50: pct(e.runs, 50),
    p90: pct(e.runs, 90),
    max: pct(e.runs, 100),
    waitP50: pct(e.queues, 50),
    failRate: e.n ? e.fails / e.n : 0,
    cancels: e.cancels,
    /* The max is a lower bound as soon as ONE row was cancelled: that row may have been the tail. */
    maxIsLowerBound: e.cancels > 0
  }));
  rows.sort((a, b) => (b.p90 ?? 0) - (a.p90 ?? 0));
  return rows;
}

/* THE CRITICAL PATH IS A MAX, NOT A SUM — jobs run in parallel, so shaving a job that is not the
   slowest changes nothing. Reported per RUN and then summarised, because the slowest job differs
   between runs and taking the max of the per-job maxima would overstate it. */
export function criticalPath(runsById) {
  const perRun = [];
  for (const jobs of runsById.values()) {
    const durs = jobs.filter((j) => j.started_at && j.completed_at && j.conclusion !== 'skipped').map((j) => ({ name: j.name, sec: (new Date(j.completed_at) - new Date(j.started_at)) / 1000 }));
    if (!durs.length) continue;
    const slowest = durs.reduce((a, b) => (b.sec > a.sec ? b : a));
    perRun.push(slowest);
  }
  const counts = new Map();
  for (const s of perRun) counts.set(s.name, (counts.get(s.name) || 0) + 1);
  return {
    n: perRun.length,
    p50: pct(
      perRun.map((s) => s.sec),
      50
    ),
    p90: pct(
      perRun.map((s) => s.sec),
      90
    ),
    max: pct(
      perRun.map((s) => s.sec),
      100
    ),
    owners: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }))
  };
}

/* THE POPULATION IS A CHOICE, SO THE QUERY IS A PURE FUNCTION OF IT. Built here rather than
   interpolated at the call site so the selftest can assert what gets asked for without a network
   call: the defect this closes was a sample that silently returned NO ROWS for two jobs, and a
   query nobody can read is how that stays invisible. A null branch omits the filter entirely —
   `branch=` with an empty value is not the same request and matches nothing. */
export function runsQuery(repo, opts) {
  const o = opts || {};
  const limit = Number.isFinite(+o.limit) ? Math.min(100, Math.max(1, Math.trunc(+o.limit))) : 40;
  const parts = [];
  if (o.branch) parts.push(`branch=${encodeURIComponent(o.branch)}`);
  if (o.event) parts.push(`event=${encodeURIComponent(o.event)}`);
  parts.push(`per_page=${limit}`);
  /* ONE WORKFLOW'S RUNS, when the question is one job's cap. A repo-wide page of 100 runs spreads
     across every workflow, so a single job lands 6 or 7 rows in it and a cap derived from that is
     a sample in name only. Asking the workflow's own endpoint spends the same page on the job that
     is being sized. */
  const base = o.workflow ? `repos/${repo}/actions/workflows/${encodeURIComponent(o.workflow)}/runs` : `repos/${repo}/actions/runs`;
  return `${base}?${parts.join('&')}`;
}

/* The label a reader needs beside every number: WHICH runs these were. A branchless event sample
   says so in as many words, because "every branch" is the part that makes a PR sample different
   from main's. */
export function windowOf(runs) {
  /* HOW FAR BACK THE SAMPLE REACHES. A page holds 100 runs whatever the cadence, so on a busy
     workflow it spans about a day — measured here, 100 `pull_request` runs covered 28 h. A tail
     event older than that is OUT of the sample, so a cap re-derived from a fresh page alone can
     shrink below the worst thing the job has already done. The window travels with the figure so a
     reader can see which events it could not have seen. */
  const at = (runs || []).map((r) => r && r.created_at).filter((s) => typeof s === 'string' && s);
  if (!at.length) return null;
  at.sort();
  return { from: at[0], to: at[at.length - 1] };
}

export function populationLabel(opts) {
  const o = opts || {};
  if (o.branch && o.event) return `\`${o.branch}\`, event \`${o.event}\``;
  if (o.event) return `event \`${o.event}\`, every branch`;
  if (o.branch) return `\`${o.branch}\``;
  return 'every branch, every event';
}

/* The workflow belongs in the label too: a sample of ONE workflow's runs is a different population
   from the repo's, and a reader who cannot see which one was asked for cannot re-derive the cap. */
export function sampleLabel(opts) {
  const o = opts || {};
  return o.workflow ? `\`${o.workflow}\`, ${populationLabel(o)}` : populationLabel(o);
}

// ── selftest ────────────────────────────────────────────────────────────────────────────────
if (has('--selftest')) {
  let pass = 0,
    fail = 0;
  const ok = (name, cond, detail) => {
    if (cond) {
      pass++;
      console.log('  ✓ ' + name + (detail ? '  — ' + detail : ''));
    } else {
      fail++;
      console.log('  ✗ ' + name + (detail ? '  — ' + detail : ''));
    }
  };
  ok('pct returns null on an empty sample', pct([], 50) === null);
  ok('pct is nearest-rank, not interpolated', pct([10, 20, 30, 40], 50) === 20, String(pct([10, 20, 30, 40], 50)));
  ok('pct 100 is the max', pct([5, 1, 9], 100) === 9);
  ok('pct ignores non-finite values', pct([1, NaN, 3, Infinity], 100) === 3);
  ok('fmtDur under a minute', fmtDur(45) === '45s', fmtDur(45));
  ok('fmtDur over a minute zero-pads', fmtDur(65) === '1m05s', fmtDur(65));
  ok('fmtDur handles null', fmtDur(null) === '—');

  const J = (name, startS, endS, extra) =>
    Object.assign({ name, started_at: new Date(1e12 + startS * 1000).toISOString(), completed_at: new Date(1e12 + endS * 1000).toISOString(), conclusion: 'success' }, extra || {});
  const rows = summarise([J('a', 0, 60), J('a', 0, 120), J('b', 0, 10)]);
  ok('summarise groups by job name', rows.length === 2);
  const a = rows.find((r) => r.name === 'a');
  ok('…and computes p50 over that job only', a.p50 === 60, String(a.p50));
  ok('…and sorts slowest-first by p90', rows[0].name === 'a');
  ok('A SKIPPED job is DROPPED, not counted as 0 s', summarise([J('a', 0, 60), Object.assign(J('a', 0, 0), { conclusion: 'skipped' })]).find((r) => r.name === 'a').n === 1);
  ok('a job missing timings is dropped', summarise([Object.assign(J('a', 0, 60), { completed_at: null })]).length === 0);
  ok('failRate counts non-success conclusions', summarise([J('a', 0, 10), Object.assign(J('a', 0, 10), { conclusion: 'failure' })]).find((r) => r.name === 'a').failRate === 0.5);
  ok(
    'A CANCELLED ROW MARKS THE MAX A LOWER BOUND — a job killed at its cap has no known duration',
    summarise([J('a', 0, 10), Object.assign(J('a', 0, 180), { conclusion: 'cancelled' })]).find((r) => r.name === 'a').maxIsLowerBound === true
  );
  ok('…and a clean sample says so, rather than leaving the reader to guess', summarise([J('a', 0, 10)])[0].maxIsLowerBound === false && summarise([J('a', 0, 10)])[0].cancels === 0);
  ok(
    'windowOf spans the oldest and newest run in the sample',
    (() => {
      const w = windowOf([{ created_at: '2026-11-05T12:18:15Z' }, { created_at: '2026-11-04T08:13:39Z' }, { created_at: '2026-11-04T19:00:00Z' }]);
      return w.from === '2026-11-04T08:13:39Z' && w.to === '2026-11-05T12:18:15Z';
    })()
  );
  ok(
    'windowOf drops a run with no stamp rather than reading it as the oldest',
    (() => {
      const w = windowOf([{ created_at: '2026-11-05T12:18:15Z' }, { created_at: null }, {}]);
      return w.from === '2026-11-05T12:18:15Z' && w.to === '2026-11-05T12:18:15Z';
    })()
  );
  ok('windowOf over no stamp at all is null, never a fabricated span', windowOf([]) === null && windowOf([{}]) === null && windowOf(undefined) === null);
  ok('a FAILED row is not censored: it ran to its own end', summarise([Object.assign(J('a', 0, 10), { conclusion: 'failure' })])[0].maxIsLowerBound === false);
  ok(
    'wait is measured from RUN CREATION to job start (includes `needs:`, not just runner queueing)',
    summarise([Object.assign(J('a', 30, 90), { run_created_at: new Date(1e12).toISOString() })])[0].waitP50 === 30
  );

  const cp = criticalPath(
    new Map([
      ['r1', [J('a', 0, 60), J('b', 0, 200)]],
      ['r2', [J('a', 0, 300), J('b', 0, 100)]]
    ])
  );
  ok('criticalPath is a MAX per run, never a sum', cp.p50 === 200, String(cp.p50));
  ok('…and names which job owned it, and how often', cp.owners.length === 2 && cp.owners.every((o) => o.n === 1));
  ok('criticalPath ignores skipped jobs', criticalPath(new Map([['r1', [J('a', 0, 60), Object.assign(J('b', 0, 9999), { conclusion: 'skipped' })]]])).p50 === 60);

  /* THE POPULATION LEGS. The defect was a sample that reached two jobs no rows, so these assert what
     the tool ASKS FOR — the only part of the fetch that is decidable without a network call. */
  const R = 'o/r';
  ok('the default query filters on main', runsQuery(R, { branch: 'main' }) === 'repos/o/r/actions/runs?branch=main&per_page=40', runsQuery(R, { branch: 'main' }));
  ok(
    'A PR-EVENT SAMPLE CARRIES NO BRANCH FILTER — every PR run sits on its own head branch',
    runsQuery(R, { branch: null, event: 'pull_request' }) === 'repos/o/r/actions/runs?event=pull_request&per_page=40',
    runsQuery(R, { branch: null, event: 'pull_request' })
  );
  ok(
    'THE MEASURED INSTANCE: the main query and the PR query are different requests, so one cannot stand in for the other',
    runsQuery(R, { branch: 'main' }) !== runsQuery(R, { branch: null, event: 'pull_request' })
  );
  ok('an explicit branch and an event both apply', runsQuery(R, { branch: 'main', event: 'push' }) === 'repos/o/r/actions/runs?branch=main&event=push&per_page=40');
  ok('a branch with a slash is encoded, never pasted raw', runsQuery(R, { branch: 'claude/x-y' }).includes('branch=claude%2Fx-y'));
  ok('per_page is clamped to the API maximum', runsQuery(R, { branch: 'main', limit: 500 }).endsWith('per_page=100'));
  ok('…and to a floor of 1, so a 0 never asks for an empty page', runsQuery(R, { branch: 'main', limit: 0 }).endsWith('per_page=1'));
  ok('a non-numeric limit falls back to the default rather than NaN', runsQuery(R, { branch: 'main', limit: 'x' }).endsWith('per_page=40'));
  ok('no options at all reads every branch and every event', runsQuery(R) === 'repos/o/r/actions/runs?per_page=40', runsQuery(R));
  ok('populationLabel names a branch sample', populationLabel({ branch: 'main' }) === '`main`');
  ok('…names an event sample AND says every branch', populationLabel({ event: 'pull_request' }) === 'event `pull_request`, every branch');
  ok('…names both when both were asked for', populationLabel({ branch: 'main', event: 'push' }) === '`main`, event `push`');
  ok('…and refuses to imply a filter nobody set', populationLabel({}) === 'every branch, every event');
  ok(
    'A WORKFLOW SAMPLE ASKS THE WORKFLOW’S OWN ENDPOINT, so one job gets the whole page',
    runsQuery(R, { workflow: 'stale-file.yml', event: 'pull_request', limit: 100 }) === 'repos/o/r/actions/workflows/stale-file.yml/runs?event=pull_request&per_page=100',
    runsQuery(R, { workflow: 'stale-file.yml', event: 'pull_request', limit: 100 })
  );
  ok('a workflow name is encoded too', runsQuery(R, { workflow: 'a b.yml' }).includes('/workflows/a%20b.yml/runs'));
  ok('sampleLabel names the workflow beside the population', sampleLabel({ workflow: 'stale-file.yml', event: 'pull_request' }) === '`stale-file.yml`, event `pull_request`, every branch');
  ok('…and falls back to the population alone', sampleLabel({ branch: 'main' }) === '`main`');

  console.log('\n' + (fail ? `✗ ${fail} failed, ${pass} passed` : `✓ all ${pass} selftests passed`));
  process.exit(fail ? 1 : 0);
}

// ── fetch + report ──────────────────────────────────────────────────────────────────────────
const LIMIT = +opt('--limit', 40);
const EVENT = opt('--event', '') || null;
/* `--event` DROPS THE BRANCH FILTER unless `--branch` is passed. Every pull_request run sits on its
   own head branch, so `branch=main&event=pull_request` is a request that matches nothing — which is
   exactly how two PR-only jobs went unsampled. An explicit `--branch` still wins. */
const BRANCH = has('--branch') ? opt('--branch', 'main') : EVENT ? null : 'main';
const WORKFLOW = opt('--workflow', '') || null;
const POP = { branch: BRANCH, event: EVENT, limit: LIMIT, workflow: WORKFLOW };
const gh = (args) => {
  try {
    return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  } catch (e) {
    console.error('gh failed: ' + String(e && e.message).slice(0, 200));
    process.exit(2);
  }
};

/* The repo slug is DERIVED, never literal. `tests/dex-tests.js`'s "no tool hardcodes a checkout root"
   group flags any string literal ending in the repo directory name, and it was right to flag this one
   for a reason beyond its own rule: a hardcoded `owner/repo` reports the WRONG repository from a fork
   or after a rename, and would do it silently — the API answers happily, the numbers are just someone
   else's. Order: an explicit --repo, then GITHUB_REPOSITORY (set on every runner), then the origin
   remote. If none resolves, REFUSE rather than guess: a timing table attributed to the wrong repo is
   worse than no table. */
function resolveRepo() {
  const explicit = opt('--repo', '');
  if (explicit) return explicit;
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
    if (m) return m[1];
  } catch (_) {}
  console.error('cannot resolve the repository — pass --repo <owner/name>, or set GITHUB_REPOSITORY');
  process.exit(2);
}
const repo = resolveRepo();
const runs = gh(['api', runsQuery(repo, POP), '--jq', '{runs: [.workflow_runs[] | {id, name, created_at, conclusion}]}']).runs || [];
if (!runs.length) {
  console.error(`no workflow runs found for ${sampleLabel(POP)}`);
  process.exit(1);
}

const allJobs = [];
const byRun = new Map();
for (const r of runs.slice(0, LIMIT)) {
  const jobs = gh(['api', `repos/${repo}/actions/runs/${r.id}/jobs?per_page=100`, '--jq', '{jobs: [.jobs[] | {name, started_at, completed_at, conclusion}]}']).jobs || [];
  const tagged = jobs.map((j) => Object.assign(j, { run_created_at: r.created_at }));
  byRun.set(r.id, tagged);
  allJobs.push(...tagged);
}

const rows = summarise(allJobs);
const cp = criticalPath(byRun);
const win = windowOf(runs.slice(0, LIMIT));

if (has('--json')) {
  console.log(JSON.stringify({ branch: BRANCH, event: EVENT, workflow: WORKFLOW, population: sampleLabel(POP), runsSampled: byRun.size, window: win, jobs: rows, criticalPath: cp }, null, 2));
  process.exit(0);
}

const out = [];
out.push(`## CI timing — ${sampleLabel(POP)}, last ${byRun.size} run(s)`);
if (win) out.push(`Sample window ${win.from} → ${win.to}. An event older than that is outside it.`);
out.push('');
out.push(`**Critical path** (the slowest job in each run — this, not the sum, is what a PR waits for):`);
out.push(`p50 **${fmtDur(cp.p50)}** · p90 **${fmtDur(cp.p90)}** · max **${fmtDur(cp.max)}**`);
out.push('');
out.push(
  `Owned by: ${
    cp.owners
      .slice(0, 4)
      .map((o) => `\`${o.name}\` ×${o.n}`)
      .join(' · ') || '—'
  }`
);
out.push('');
/* CLAUDE.md §5 measured main's merge cadence at a median 7.2 min. Printing the comparison rather
   than the duration alone is the point: a p90 above that number means the branch is stale before it
   is green more often than not, which is the race in one line. */
const CADENCE_S = 7.2 * 60;
if (cp.p90 != null)
  out.push(
    cp.p90 > CADENCE_S
      ? `> ⚠️ p90 (${fmtDur(cp.p90)}) exceeds main's measured **7.2 min** median merge cadence — a PR is more likely than not to go stale before it is green.`
      : `> p90 (${fmtDur(cp.p90)}) is inside main's measured 7.2 min median merge cadence.`
  );
out.push('');
out.push('| job | n | p50 | p90 | max | wait p50 | fail rate | cancelled |');
out.push('|---|---:|---:|---:|---:|---:|---:|---:|');
for (const r of rows)
  out.push(
    `| \`${r.name}\` | ${r.n} | ${fmtDur(r.p50)} | ${fmtDur(r.p90)} | ${r.maxIsLowerBound ? '≥ ' : ''}${fmtDur(r.max)} | ${fmtDur(r.waitP50)} | ${(r.failRate * 100).toFixed(0)}% | ${r.cancels} |`
  );
out.push('');
out.push('_A `≥` on the max means at least one sampled run was CANCELLED, so the true tail is unknown and at least that long. Size a cap from a sample with none._');
out.push(
  '_`wait p50` is run-creation → job start: runner queueing PLUS any `needs:` dependency, so a fast job can show a long wait and be healthy. Sorted by p90, because the merge window is lost by the slow runs, not the typical ones._'
);

const text = out.join('\n');
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
}
