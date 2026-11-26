#!/usr/bin/env node
/*
 * tools/ci-tree-reuse.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *
 * A PUSH TO MAIN SKIPS THE HEAVY JOBS WHEN THE MERGE QUEUE ALREADY TESTED THE SAME TREE GREEN.
 *
 * Mergify tests a batch of PRs on a `mergify/merge-queue/*` branch, then squash-merges each PR onto
 * main, and each merge starts a push run on main. Measured 2026-11-26 over 4.1 days (board #9312):
 * 199 of 361 main push runs of `tests`, `capture-host-ci` and `local-steps` tested a tree that a
 * green queue run of the SAME workflow had already tested. Those repeats cost about 1,560
 * run-minutes a day. Of the 199, `capture-host-ci` failed on 2, both on a tree that had passed, so
 * the repeats caught flakes and no defect.
 *
 * THE MATCH (Kestrel #9314, conditions 1-3 and 5). This job runs first, on a push to main only. It
 * reuses a run only when ALL of these hold, and otherwise the full workflow runs:
 *   - the run belongs to the SAME workflow file (the API path is per workflow);
 *   - its head branch starts with `mergify/`;
 *   - its conclusion is `success`;
 *   - its head commit's tree equals the tree of the commit this push tested.
 * On a reuse the heavy jobs read `skipped`, never `success`: a skipped job reports no pass that
 * examined nothing. This job alone reads success, and its summary names the reused run (URL, head
 * commit, tree). CodeQL, biome, no-network and types keep their full run.
 *
 * IT FAILS OPEN. Any error (no token, an API failure, an unreadable tree) writes `reused=false` and
 * exits 0, so the full workflow runs. A broken reuse check costs runner time, never a check.
 *
 * THE READERS OF MAIN'S RESULTS (board #9328). `tools/ci-timing.mjs` drops a reused run from its
 * sample (`isReusedRun`), because its critical path would read as the reuse job's few seconds. The
 * red-main view in `tools/board.mjs` reads the conclusion, and a reused run concludes success.
 *
 * USAGE
 *   node tools/ci-tree-reuse.mjs --workflow tests.yml   # in a workflow job; needs GH_TOKEN, actions: read
 *   node tools/ci-tree-reuse.mjs --selftest             # known-answer; makes no network call
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { isCliEntry } from './argv-guard.mjs';

export const QUEUE_PREFIX = 'mergify/';

/** The decision, a pure function. `runs` are GitHub workflow-run objects of ONE workflow file. */
export function pickReuse({ event, ref, tree, runs }) {
  if (event !== 'push' || ref !== 'refs/heads/main') return { reused: false, run: null, reason: `not a push to main (event=${event}, ref=${ref})` };
  if (!tree) return { reused: false, run: null, reason: 'the tree of this commit is unknown' };
  const run = (runs || []).find((r) => r && r.conclusion === 'success' && typeof r.head_branch === 'string' && r.head_branch.startsWith(QUEUE_PREFIX) && r.head_commit?.tree_id === tree);
  return run ? { reused: true, run, reason: null } : { reused: false, run: null, reason: `no green ${QUEUE_PREFIX} run of this workflow tested tree ${tree}` };
}

/** The job-summary lines (condition 2): the reused run's URL, its head commit and the tree. */
export function summaryLines(d, { sha, tree, workflow }) {
  if (!d.reused) return [`### ${workflow}: full run`, '', `Reason: ${d.reason}.`, ''];
  return [
    `### ${workflow}: heavy jobs skipped — this tree passed in the merge queue`,
    '',
    `- reused run: ${d.run.html_url}`,
    `- reused run head commit: \`${d.run.head_sha}\` on \`${d.run.head_branch}\``,
    `- tree: \`${tree}\``,
    `- this commit: \`${sha}\``,
    ''
  ];
}

// ── selftest ────────────────────────────────────────────────────────────────────────────────
const CLI = isCliEntry(import.meta.url);
if (CLI && process.argv.includes('--selftest')) {
  let pass = 0;
  let fail = 0;
  const ok = (name, cond) => {
    if (cond) pass++;
    else {
      fail++;
      console.log(`✗ ${name}`);
    }
  };
  const T = 'a'.repeat(40);
  const R = (o) =>
    Object.assign({ conclusion: 'success', head_branch: 'mergify/merge-queue/abc', head_sha: 'b'.repeat(40), html_url: 'https://example.invalid/run/1', head_commit: { tree_id: T } }, o);
  const base = { event: 'push', ref: 'refs/heads/main', tree: T };
  ok('a green queue run on the same tree is reused', pickReuse({ ...base, runs: [R({})] }).reused === true);
  ok('a pull_request event never reuses', pickReuse({ ...base, event: 'pull_request', runs: [R({})] }).reused === false);
  ok('a push to another branch never reuses', pickReuse({ ...base, ref: 'refs/heads/claude/x', runs: [R({})] }).reused === false);
  ok('a different tree is not reused', pickReuse({ ...base, runs: [R({ head_commit: { tree_id: 'c'.repeat(40) } })] }).reused === false);
  ok('a failed queue run is not reused', pickReuse({ ...base, runs: [R({ conclusion: 'failure' })] }).reused === false);
  ok('a cancelled queue run is not reused', pickReuse({ ...base, runs: [R({ conclusion: 'cancelled' })] }).reused === false);
  ok('a green run on a non-queue branch is not reused', pickReuse({ ...base, runs: [R({ head_branch: 'claude/foo' })] }).reused === false);
  ok('a green run on main itself is not reused', pickReuse({ ...base, runs: [R({ head_branch: 'main' })] }).reused === false);
  ok('an unknown tree never reuses', pickReuse({ ...base, tree: null, runs: [R({})] }).reused === false);
  ok('a run with no head_commit is not reused', pickReuse({ ...base, runs: [R({ head_commit: null })] }).reused === false);
  ok('no runs gives a named reason', /no green mergify\/ run/.test(pickReuse({ ...base, runs: [] }).reason));
  ok('the match picks the green twin among others', pickReuse({ ...base, runs: [R({ conclusion: 'failure' }), R({ html_url: 'https://example.invalid/run/2' })] }).run.html_url.endsWith('/2'));
  const s = summaryLines(pickReuse({ ...base, runs: [R({})] }), { sha: 'd'.repeat(40), tree: T, workflow: 'tests.yml' }).join('\n');
  ok('the summary names the run URL, head commit and tree', s.includes('example.invalid/run/1') && s.includes('b'.repeat(40)) && s.includes(T));
  ok(
    'a full run names its reason in the summary',
    summaryLines(pickReuse({ ...base, runs: [] }), { sha: 'd', tree: T, workflow: 'w' })
      .join('\n')
      .includes('Reason: no green')
  );
  console.log('\n' + (fail ? `✗ ${fail} failed, ${pass} passed` : `✓ all ${pass} selftests passed`));
  process.exit(fail ? 1 : 0);
}

// ── the job ─────────────────────────────────────────────────────────────────────────────────
async function main() {
  function emit(lines, reused) {
    const out = process.env.GITHUB_OUTPUT;
    const sum = process.env.GITHUB_STEP_SUMMARY;
    if (out) appendFileSync(out, `reused=${reused}\n`);
    if (sum) appendFileSync(sum, lines.join('\n') + '\n');
    console.log(lines.join('\n'));
    console.log(`reused=${reused}`);
  }

  const i = process.argv.indexOf('--workflow');
  const workflow = i > 0 ? process.argv[i + 1] : null;
  const { GITHUB_EVENT_NAME: event, GITHUB_REF: ref, GITHUB_SHA: sha, GITHUB_REPOSITORY: repo, GH_TOKEN: token } = process.env;
  const apiBase = process.env.GITHUB_API_URL || 'https://api.github.com';
  try {
    if (!workflow) throw new Error('--workflow <file.yml> is required');
    if (event !== 'push' || ref !== 'refs/heads/main') {
      emit(summaryLines(pickReuse({ event, ref, tree: null, runs: [] }), { sha, tree: null, workflow }), false);
      process.exit(0);
    }
    if (!token || !repo) throw new Error('GH_TOKEN and GITHUB_REPOSITORY are required');
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
    const res = await fetch(`${apiBase}/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?status=success&per_page=100`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
    });
    if (!res.ok) throw new Error(`the runs API answered ${res.status}`);
    const runs = (await res.json()).workflow_runs || [];
    const d = pickReuse({ event, ref, tree, runs });
    emit(summaryLines(d, { sha, tree, workflow }), d.reused);
  } catch (e) {
    emit([`### ${workflow || 'workflow'}: full run`, '', `Reason: the reuse check could not decide (${e.message}), so the full workflow runs.`, ''], false);
  }
  process.exit(0);
}
if (CLI) await main();
