/*
 * workflow-timeout-guard.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * EVERY WORKFLOW JOB DECLARES `timeout-minutes`.
 *
 * Without one a job inherits GitHub's 360-minute default, so a hung step burns six hours of the
 * concurrency pool before anything notices. That is not a theoretical cost here: the fleet reads a
 * stuck queue as "serialising" (CLAUDE.md §👥.5 says a PR sitting BEHIND while the front is mid-CI is
 * serialising, not stalling), which is the correct reading almost always and therefore the one that
 * hides a genuine hang. A declared cap converts a six-hour silence into a named failure.
 *
 * ⚠️ THE CAP IS NOT A PERFORMANCE TARGET. It is the point past which a run is no longer believed to
 * be running. Each one here is `ceil(p95 × 2)` over a measured sample of recent runs, with the sample
 * date written beside it in the yml, so a cap can be re-derived rather than argued about. For a MATRIX
 * job the aggregate is the MAX p95 across its legs, because one `timeout-minutes` governs every leg and
 * the min would kill the slowest.
 *
 * This gate checks only PRESENCE — that a cap was declared and parses as a positive integer. It does
 * NOT check that the number is well chosen: the measurement that sizes it lives in `tools/ci-timing.mjs`
 * (`pct`, `summarise`), and asserting a committed cap still matches today's p95 would red CI every time
 * the runners got slower, which is a fact about GitHub, not a defect in this repo.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { isCliEntry } from './argv-guard.mjs';
import { escapeRe } from './regex-escape-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
const WF_DIR = join(ROOT, '.github', 'workflows');

/* ── pure core ────────────────────────────────────────────────────────────────────────────────
   Takes workflow TEXT, never a path, so the selftest can plant a workflow that does not exist on
   disk. A regex parse rather than a YAML dependency: the repo ships no runtime SOUP and a gate that
   needs an install is a gate that gets skipped. The shape it reads is narrow and asserted below —
   top-level `jobs:` at column 0, each job key at exactly two spaces. */
export function scanWorkflow(text, name = '<text>') {
  const m = /^jobs:[ \t]*$/m.exec(text || '');
  if (!m) return { name, jobs: [] };
  const body = text.slice(m.index + m[0].length);
  const keys = [...body.matchAll(/^ {2}([A-Za-z0-9_-]+):[ \t]*$/gm)].map((k) => k[1]);
  const jobs = [];
  for (const key of keys) {
    /* ⚠️ THE LOOKAHEAD MUST NOT END AT A LINE BREAK. The first draft closed the block with
       `(?=^ {2}key:$|$)`, and under /m a bare `$` matches at EVERY line end — so the lazy capture
       stopped at the job key's own line and blocks came back EMPTY, making the gate report
       `timeout-minutes` missing on jobs that declare one: a FAIL indistinguishable from the defect
       it exists to find, which is the worst kind to ship. End-of-input is `$(?![\s\S])`. */
    const re = new RegExp(`^ {2}${escapeRe(key)}:[ \\t]*$([\\s\\S]*?)(?=^ {2}[A-Za-z0-9_-]+:[ \\t]*$|$(?![\\s\\S]))`, 'm');
    const blk = re.exec(body);
    const inner = blk ? blk[1] : '';
    /* Capture the whole value, not `\S+`: an unresolved `${{ env.T }}` would otherwise be quoted
       back as `${{` and the reader could not see what was written. */
    const to = /^[ \t]+timeout-minutes:[ \t]*([^\n]*)/m.exec(inner);
    /* A value that is present but not a positive integer is NOT a declaration. `timeout-minutes: 0`
       and an unresolved `${{ ... }}` both leave the job uncapped in practice, and counting either as
       compliant is the "success reported about something never examined" shape (§4b). */
    const raw = to ? to[1].replace(/\s+#.*$/, '').trim() : null;
    const minutes = raw != null && /^\d+$/.test(raw) ? Number(raw) : null;
    jobs.push({ job: key, raw, minutes, ok: minutes != null && minutes > 0 });
  }
  return { name, jobs };
}

/* The verdict over a set of scanned workflows. NOT_RUN when nothing was examined — a workflow with no
   jobs examined nothing, and a PASS over `checked: 0` is invalid under the contract (§🧾). */
export function evaluate(scans, producedBy) {
  const jobs = scans.flatMap((s) => s.jobs.map((j) => ({ ...j, workflow: s.name })));
  const missing = jobs.filter((j) => !j.ok);
  const eligible = jobs.length;
  const status = eligible === 0 ? 'NOT_RUN' : missing.length ? 'FAIL' : 'PASS';
  const reason =
    status === 'NOT_RUN'
      ? `no job declarations were examined across ${scans.length} workflow file(s) — a workflow with no \`jobs:\` block or no job keys yields nothing to check`
      : status === 'FAIL'
        ? `${missing.length} job(s) declare no positive integer \`timeout-minutes\`: ${missing.map((j) => `${j.workflow}:${j.job}${j.raw == null ? '' : ` (= ${j.raw})`}`).join(', ')}`
        : null;
  const v = Verdict.make({
    gate: 'workflow-job-timeout',
    status,
    scope: 'internal',
    population: { checked: eligible - missing.length, eligible, excluded: missing.length },
    criterion: { name: 'jobs_declaring_timeout_minutes', threshold: 0, unit: 'jobs', direction: 'lte' },
    result: { missing: missing.length, workflows: scans.length },
    evidence: ['tools/workflow-timeout-guard.mjs', ...scans.map((s) => `.github/workflows/${s.name}`)],
    reason,
    producedBy
  });
  return { status, missing, jobs, verdict: v };
}

/* ── side-effecting shell ─────────────────────────────────────────────────────────────────── */
function headSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf-8' }).trim().slice(0, 12);
  } catch {
    return null;
  }
}
function producedBy() {
  const commit = headSha();
  const p = { tool: 'tools/workflow-timeout-guard.mjs', commit };
  if (!commit) p.commitReason = 'git rev-parse failed — not a repository checkout, or git is unavailable';
  return p;
}

function run() {
  if (!existsSync(WF_DIR)) {
    const { verdict } = evaluate([], producedBy());
    process.stdout.write(`${JSON.stringify(verdict, null, 1)}\n`);
    console.error(`workflow-timeout-guard: no ${WF_DIR} — nothing examined`);
    return 2;
  }
  const files = readdirSync(WF_DIR)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort();
  const scans = files.map((f) => scanWorkflow(readFileSync(join(WF_DIR, f), 'utf-8'), basename(f)));
  const { status, missing, jobs, verdict } = evaluate(scans, producedBy());
  const chk = Verdict.validate(verdict);
  if (!chk.ok) throw new Error(`workflow-timeout-guard produced an invalid verdict: ${chk.errors.join('; ')}`);
  process.stdout.write(`${JSON.stringify(verdict, null, 1)}\n`);
  if (status === 'PASS') {
    console.log(`✓ every workflow job declares timeout-minutes — ${jobs.length} job(s) in ${files.length} workflow(s)`);
    return 0;
  }
  if (status === 'NOT_RUN') {
    console.error(`✗ workflow-timeout-guard examined NOTHING across ${files.length} file(s) — the parse found no job keys, which is a defect in this gate, not a pass`);
    return 2;
  }
  console.error(`✗ ${missing.length} of ${jobs.length} job(s) declare no timeout-minutes:`);
  for (const j of missing) console.error(`   · ${j.workflow}:${j.job}${j.raw == null ? '' : ` — value \`${j.raw}\` is not a positive integer`}`);
  console.error('  Size each from its own measured p95 (tools/ci-timing.mjs: `pct(runs, 95)`) × 2, rounded up,');
  console.error('  and write `# p95 N min on YYYY-MM-DD` beside it so the number can be re-derived.');
  return 1;
}

/* ── selftest ─────────────────────────────────────────────────────────────────────────────── */
function selftest() {
  let pass = 0;
  let fail = 0;
  const ok = (what, cond, detail) => {
    if (cond) pass++;
    else {
      fail++;
      console.error(`  ✕ ${what}${detail ? ` — ${detail}` : ''}`);
    }
  };
  const PB = { tool: 'tools/workflow-timeout-guard.mjs', commit: 'deadbeefcafe' };

  // PLANT 1 · a job without timeout-minutes reds.
  const bare = 'name: x\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n';
  const r1 = evaluate([scanWorkflow(bare, 'bare.yml')], PB);
  ok('a job with NO timeout-minutes is FAIL', r1.status === 'FAIL', r1.status);
  ok('…and the verdict names the job', /bare\.yml:build/.test(r1.verdict.reason || ''), r1.verdict.reason);
  ok('…and counts it as excluded, not checked', r1.verdict.population.checked === 0 && r1.verdict.population.excluded === 1, JSON.stringify(r1.verdict.population));

  // PLANT 2 · a job with one passes.
  const capped = 'name: x\njobs:\n  build:\n    timeout-minutes: 7\n    runs-on: ubuntu-latest\n';
  const r2 = evaluate([scanWorkflow(capped, 'capped.yml')], PB);
  ok('a job WITH timeout-minutes is PASS', r2.status === 'PASS', r2.status);
  ok('…with a null reason, as the contract requires of a PASS', r2.verdict.reason === null, JSON.stringify(r2.verdict.reason));

  // PLANT 3 · a workflow with no jobs is NOT_RUN, never PASS.
  const nojobs = 'name: x\non:\n  push:\n    branches: [main]\n';
  const r3 = evaluate([scanWorkflow(nojobs, 'nojobs.yml')], PB);
  ok('a workflow with no jobs is NOT_RUN', r3.status === 'NOT_RUN', r3.status);
  ok('…and NOT_RUN carries a reason', !!r3.verdict.reason, JSON.stringify(r3.verdict.reason));
  ok('…and PASS over checked:0 is never emitted', r3.verdict.population.eligible === 0 && r3.status !== 'PASS', JSON.stringify(r3.verdict.population));

  /* PLANT 4 · a PRESENT but useless value is not a declaration. Both of these leave the job on
     GitHub's 360-minute default in practice, and the first draft of the parse accepted them. */
  const zero = 'name: x\njobs:\n  a:\n    timeout-minutes: 0\n';
  ok('`timeout-minutes: 0` is NOT a declaration', evaluate([scanWorkflow(zero, 'z.yml')], PB).status === 'FAIL', 'zero accepted');
  const expr = 'name: x\njobs:\n  a:\n    timeout-minutes: ${{ env.T }}\n';
  const r5 = evaluate([scanWorkflow(expr, 'e.yml')], PB);
  ok('an unresolved expression is NOT a declaration', r5.status === 'FAIL', 'expression accepted');
  ok('…and the reason quotes the offending value', /= \$\{\{/.test(r5.verdict.reason || ''), r5.verdict.reason);

  // The parse must see a MATRIX job and a job whose own name differs from its key.
  const matrix = 'name: x\njobs:\n  test:\n    name: test (py${{ matrix.v }})\n    timeout-minutes: 14\n    strategy:\n      matrix:\n        v: ["3.12", "3.13"]\n';
  ok('a matrix job with a cap passes, and its name is not its key', evaluate([scanWorkflow(matrix, 'm.yml')], PB).status === 'PASS');

  // Multiple jobs in one file: the second must not be swallowed by the first block.
  const two = 'name: x\njobs:\n  a:\n    timeout-minutes: 3\n    steps:\n      - run: echo a\n  b:\n    runs-on: x\n';
  const r7 = scanWorkflow(two, 't.yml');
  ok('both jobs in a two-job file are found', r7.jobs.length === 2, JSON.stringify(r7.jobs.map((j) => j.job)));
  ok(
    '…and only the uncapped one is flagged',
    evaluate([r7], PB)
      .missing.map((j) => j.job)
      .join() === 'b',
    JSON.stringify(evaluate([r7], PB).missing.map((j) => j.job))
  );

  /* THE REAL TREE IS THE POPULATION CHECK. A parse that silently matches nothing would make every
     assertion above pass while the gate examined no real workflow — the §4b shape. */
  if (existsSync(WF_DIR)) {
    const files = readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f));
    const scans = files.map((f) => scanWorkflow(readFileSync(join(WF_DIR, f), 'utf-8'), basename(f)));
    const n = scans.reduce((a, s) => a + s.jobs.length, 0);
    ok('the parse finds jobs in the REAL workflow tree (non-vacuous)', n >= 10, `found ${n} job(s) in ${files.length} file(s)`);
    ok(
      '…and every real workflow file yields at least one job',
      scans.every((s) => s.jobs.length > 0),
      JSON.stringify(scans.filter((s) => !s.jobs.length).map((s) => s.name))
    );
  }

  /* The summary is one of `tools/selftest-all.mjs` SUMMARY_FORMATS so the count is PARSEABLE: that
     aggregator's entire value over the CI loop is noticing a suite that silently shrinks, and a tool
     whose summary it cannot read is a tool it cannot watch. The count comes from the RUN (never a
     literal) — see the residue row `2026-10-11-ten-tools-hardcode-a-selftest-count`. */
  console.log(fail ? `✗ ${fail} of ${pass + fail} assertions FAILED` : `✓ all ${pass} assertions passed`);
  return fail ? 1 : 0;
}

/* `--verdict-sample` prints the verdict object and NOTHING else, so `tools/verdict-adoption.mjs` can
   parse stdout as JSON. The ordinary run prints the object followed by a human line, which is right for
   a reader and unparseable for the adoption check — the two audiences need two modes, not one mode and
   a parser that tolerates prose. The sample is a REAL scan of the real tree, never a canned object:
   a sample that could not go stale would prove nothing about the producer. */
if (isCliEntry(import.meta.url)) {
  if (process.argv.includes('--selftest')) process.exit(selftest());
  if (process.argv.includes('--verdict-sample')) {
    const files = existsSync(WF_DIR)
      ? readdirSync(WF_DIR)
          .filter((f) => /\.ya?ml$/.test(f))
          .sort()
      : [];
    const scans = files.map((f) => scanWorkflow(readFileSync(join(WF_DIR, f), 'utf-8'), basename(f)));
    process.stdout.write(`${JSON.stringify(evaluate(scans, producedBy()).verdict, null, 1)}\n`);
    process.exit(0);
  }
  process.exit(run());
}
