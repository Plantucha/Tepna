#!/usr/bin/env node
/*
 * verify-shard-union.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 */
/* ════════════════════════════════════════════════════════════════════════
   tests/verify-shard-union.mjs — the shard gate's OWN gate
   ────────────────────────────────────────────────────────────────────────
   CI runs the assertion suite as N parallel shards (tests.yml). That is only
   sound if the shards PARTITION the suite: every declared group in exactly one
   shard. If a group fell into none, all N shards would go green having never
   run it — a silently shrinking gate, which is strictly worse than a slow one.
   So the partition is not assumed, it is PROVEN, on every push.

   Two modes:

   · DEFAULT (fast, ~0.2 s — the CI gate). Take the free declaration inventory
     (`run-tests --list` executes zero groups) and assert planShards() returns a
     true partition of it for every plausible N. Pure set algebra, no DSP.
     This is the check that catches the failure that matters: a group that no
     shard runs.

   · --deep (slow, ~2.5 min — the empirical proof). Actually run the full suite
     AND all N shards as subprocesses, then assert the UNION of the shard
     results is assertion-for-assertion IDENTICAL to the unsharded run: same
     groups, same assertion names, same pass/skip verdicts. This is what proves
     the groups are order-independent — that no group was quietly relying on
     state a now-absent earlier group left behind. Run it when you change the
     partition scheme or add a group that touches shared state; CI does not
     (it would cost more than sharding saves).

   Exit 0 = sound · 1 = the partition or the union is broken.
   ════════════════════════════════════════════════════════════════════════ */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { planShards, partitionViolations, readTimings } from './shard-plan.mjs';
import { aggregateChildren, makeVerdict, Verdict } from '../tools/verdict-emit.mjs';

/* ── VERDICT-CONTRACT §3d — the partition proof as ONE object ─────────────────────────────────────
   Children = the named checks this run makes (provenance `check`: each is a pre-stated equality —
   every group in exactly one shard, no assertion lost or invented, no verdict flipped); the criterion
   is "the union equals the plan". `--deep` adds the empirical checks, and since #2835 the shards emit
   their own objects, so --deep also CONSUMES them: the union of the shard objects through
   aggregateChildren must reach the full run's status. Not filtered — the non-deep run IS the CI
   gate's plan; --deep is a larger plan, not a wider one. Pure, so --selftest plants every row. */
export function shardUnionVerdict(checks, { deep = false, ciShards = 6, commit, commitReason, at } = {}) {
  const children = checks.map((c) => ({ name: c.name, provenance: 'check', status: c.pass ? 'PASS' : 'FAIL', ...(c.detail ? { why: String(c.detail).slice(0, 160) } : {}) }));
  const agg = aggregateChildren(children, { eligible: children.length });
  let { result } = agg;
  if (result) result = { ...result, deep, ciShards, children: result.children.map((c, i) => ({ ...c, ...(children[i].why ? { why: children[i].why } : {}) })) };
  return makeVerdict({
    gate: 'verify-shard-union',
    status: agg.status,
    population: agg.population,
    criterion: {
      name: 'checks_failing (the union equals the plan: every group in exactly one shard at every N; under --deep no assertion lost, invented or flipped, and the shard OBJECTS aggregate to the full run)',
      threshold: 0,
      unit: 'failing checks',
      direction: 'eq'
    },
    result,
    evidence: ['tests/shard-plan.mjs', 'tests/group-timings.json', ...(deep ? ['tests/run-tests.mjs --json', 'tests/run-tests.mjs --shard=i/N --json'] : [])],
    reason: agg.reason,
    tool: 'tests/verify-shard-union.mjs',
    commit,
    commitReason,
    at
  });
}

/* --deep's consumer check, pure: do the shard objects, aggregated, reach the full run's status? */
export function shardObjectsAgree(fullVerdict, shardVerdicts, ciShards) {
  const valid = shardVerdicts.every((v) => v && Verdict.validate(v).ok) && !!fullVerdict && Verdict.validate(fullVerdict).ok;
  if (!valid) return { pass: false, detail: 'a shard or the full run emitted no valid tepna.verdict/1' };
  const u = aggregateChildren(
    shardVerdicts.map((v, i) => ({ name: `shard ${i + 1}/${ciShards}`, provenance: 'object', status: v.status })),
    { eligible: ciShards }
  );
  return { pass: u.status === fullVerdict.status, detail: `union of ${shardVerdicts.length} shard objects → ${u.status}; full run → ${fullVerdict.status}` };
}

export function verdictSample() {
  const checks = ['declaration inventory is non-empty', 'every group has a unique declaration index', 'N=6: every group in exactly one shard (union = the full suite)'].map((name) => ({
    name,
    pass: true
  }));
  return shardUnionVerdict(checks, {
    deep: false,
    ciShards: 6,
    commit: null,
    commitReason: '--verdict-sample: three scratch checks, no suite run, no code identity claimed',
    at: '2026-09-22T00:00:00Z'
  });
}

function selftest() {
  let n = 0;
  const eq = (a, b, msg) => {
    n++;
    if (a !== b) {
      console.log(`✗ ${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
      process.exit(1);
    }
    console.log(`✓ ${msg}`);
  };
  const AT = { commit: null, commitReason: 'selftest', at: '2026-09-22T00:00:00Z' };
  const P = (name) => ({ name, pass: true });
  const green = shardUnionVerdict([P('a'), P('b'), P('c')], AT);
  eq(green.status === 'PASS' && green.population.checked === 3 && green.result.filtered === false, true, '§3d · every check holds ⇒ PASS over the checks, never filtered');
  const red = shardUnionVerdict([P('a'), { name: 'N=6: every group in exactly one shard', pass: false, detail: 'group 12 ran in BOTH shard 1 and 2' }], AT);
  eq(red.status === 'FAIL' && /N=6: every group in exactly one shard/.test(red.reason), true, '§3d plant · a partition violation ⇒ FAIL, named');
  eq(shardUnionVerdict([], AT).status, 'NOT_RUN', '§3d plant · no checks ⇒ NOT_RUN');
  const V = (status) =>
    makeVerdict({
      gate: 'run-tests',
      status,
      population: { checked: 1, eligible: 1, excluded: 0 },
      criterion: { name: 'x', threshold: 0, unit: '', direction: 'eq' },
      result: status === 'NOT_RUN' ? null : { x: 0 },
      evidence: ['e'],
      reason: status === 'PASS' ? null : 'planted',
      tool: 't',
      ...AT
    });
  eq(shardObjectsAgree(V('PASS'), [V('PASS'), V('PASS')], 2).pass, true, '§3d consumer · two PASS shard objects aggregate to the full run PASS');
  eq(shardObjectsAgree(V('PASS'), [V('PASS'), V('FAIL')], 2).pass, false, '§3d consumer plant · a FAIL shard object cannot agree with a PASS full run');
  eq(shardObjectsAgree(V('FAIL'), [V('PASS'), V('FAIL')], 2).pass, true, '§3d consumer · …and does agree with a FAIL full run');
  eq(shardObjectsAgree(V('PASS'), [V('PASS'), null], 2).pass, false, '§3d consumer plant · a shard with no object ⇒ the check fails (never a pass over what it could not read)');
  eq(shardObjectsAgree(V('PASS'), [V('PASS'), { schema: 'tepna.verdict/1', status: 'PASSED' }], 2).pass, false, '§3d consumer plant · an invalid shard object ⇒ the check fails');
  eq(verdictSample().status === 'PASS' && verdictSample().producedBy.commit === null, true, '§3d · --verdict-sample: three scratch checks ⇒ PASS, no commit');
  console.log(`all ${n} selftests passed`);
}

const ARGV = process.argv.slice(2);
if (ARGV.includes('--selftest')) {
  selftest();
  process.exit(0);
}
if (ARGV.includes('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample()));
  process.exit(0);
}
const JSON_OUT = ARGV.includes('--json');

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(__dirname, 'run-tests.mjs');
const DEEP = process.argv.slice(2).some((s) => /^--?deep$/i.test(s));
/* The N the CI matrix actually uses. Keep in sync with .github/workflows/tests.yml — check 3 below
   is what makes a drift here loud instead of silent. */
const CI_SHARDS = 6;

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', cyan: '\x1b[36m', yellow: '\x1b[33m' };
const paint = (s, c) => (process.stdout.isTTY ? c + s + C.reset : s);
const out = (...a) => (JSON_OUT ? console.error(...a) : console.log(...a)); // --json: stdout carries ONE object
const fails = [];
const checks = []; // §3d: every check, pass or fail, is a child of the object
const ok = (name, cond, detail) => {
  checks.push({ name, pass: !!cond, detail });
  if (cond) out(paint('  ✓ ', C.green) + name + (detail ? paint('  — ' + detail, C.dim) : ''));
  else {
    out(paint('  ✕ ', C.red) + name + (detail ? paint('  — ' + detail, C.yellow) : ''));
    fails.push(name);
  }
};

/* A run whose assertions FAIL exits 1 — that is data here, not an error: this tool compares
   verdicts (incl. failing ones) between the full run and the shard-union, so it must read the
   JSON either way. Only a run that produced no parseable JSON (exit 2 = load/setup error) is a
   real crash. Hence spawnSync, not execFileSync (which throws away stdout on a non-zero exit). */
function runJson(args) {
  const r = spawnSync(process.execPath, [RUNNER, ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (r.error) throw r.error;
  try {
    return JSON.parse(r.stdout);
  } catch (_) {
    console.error(paint(`\n✗ run-tests.mjs ${args.join(' ')} produced no JSON (exit ${r.status}) — setup/load error:`, C.red));
    console.error((r.stderr || r.stdout || '').split('\n').slice(0, 12).join('\n'));
    process.exit(2);
  }
}

out(paint('\n▸ shard-union — the shards must PARTITION the suite', C.cyan));

/* ── 1 · the inventory is free, and complete ───────────────────────────────── */
const inv = runJson(['--list']).groups.map((g) => ({ index: g.index, title: g.title }));
ok('declaration inventory is non-empty', inv.length > 0, inv.length + ' groups');
ok('every group has a unique declaration index', new Set(inv.map((g) => g.index)).size === inv.length);
ok(
  'indices are dense 0..n-1 (a gap would mean a conditional group() — the plan assumes stable indices)',
  inv.every((g, i) => g.index === i)
);

/* ── 2 · planShards is a true partition, at every plausible N ──────────────── */
const timings = readTimings();
for (const N of [1, 2, 3, 4, 5, 6, 8, 12]) {
  const { bins } = planShards(inv, timings, N);
  const errs = partitionViolations(inv, bins);
  const covered = bins.flat().length;
  ok(`N=${N}: every group in exactly one shard (union = the full suite)`, errs.length === 0 && covered === inv.length, errs.length ? errs[0] : `${covered}/${inv.length} groups, no dupes, no orphans`);
}

/* ── 3 · the N CI actually runs is balanced enough to be worth it ──────────── */
{
  const { bins, weights, unknown } = planShards(inv, timings, CI_SHARDS);
  const total = weights.reduce((a, b) => a + b, 0);
  const makespan = Math.max(...weights);
  const speedup = makespan ? total / makespan : 0;
  ok(
    `N=${CI_SHARDS} (the CI matrix): no empty shard`,
    bins.every((b) => b.length > 0),
    bins.map((b) => b.length + 'g').join(' · ')
  );
  // A HINT going stale must never red the gate — it costs speed, not coverage. So this is a warn.
  if (unknown.length)
    out(
      paint(
        '  ⚠ ' +
          unknown.length +
          ' group(s) have no committed timing — shard balance is guessed for those (coverage is unaffected). Refresh: node tests/run-tests.mjs --json | node tests/gen-group-timings.mjs',
        C.yellow
      )
    );
  if (total) out(paint(`  · planned makespan ${(makespan / 1000).toFixed(1)} s of ${(total / 1000).toFixed(1)} s total → ${speedup.toFixed(2)}x`, C.dim));
}

/* ── 4 · --deep: the union really does equal the unsharded run ─────────────── */
if (DEEP) {
  out(paint('\n▸ --deep: running the FULL suite + all ' + CI_SHARDS + ' shards for real (~2.5 min)…', C.cyan));
  // Key on (group index, ORDINAL, name) — not (group, name). A handful of groups assert the same NAME
  // twice, so a name-keyed map silently collapses them and the count under-reports (2097 vs the real
  // 2109). That collapse was identical on both sides, so the verdict compare was still valid — but this
  // proof should be exact, not merely self-consistent. The ordinal gives every assertion its own key.
  const key = (gi, i, t) => `${gi}#${i} ${t.name}`;
  const verdict = (t) => (t.skip ? 'skip' : t.pass ? 'pass' : 'FAIL');

  const full = runJson(['--json']);
  const shardVerdicts = [];
  const fullMap = new Map();
  for (const g of full.groups) g.tests.forEach((t, i) => fullMap.set(key(g.index, i, t), verdict(t)));
  out(paint(`  · full run: ${full.groups.length} groups, ${fullMap.size} assertions`, C.dim));

  const unionMap = new Map();
  const claimedBy = new Map();
  for (let i = 1; i <= CI_SHARDS; i++) {
    const s = runJson([`--shard=${i}/${CI_SHARDS}`, '--json']);
    shardVerdicts.push(s.verdict || null);
    for (const g of s.groups) {
      if (claimedBy.has(g.index)) fails.push(`group ${g.index} ran in BOTH shard ${claimedBy.get(g.index)} and ${i}`);
      claimedBy.set(g.index, i);
      g.tests.forEach((t, i) => unionMap.set(key(g.index, i, t), verdict(t)));
    }
    out(paint(`  · shard ${i}/${CI_SHARDS}: ${s.groups.length} groups, ${s.groups.reduce((a, g) => a + g.tests.length, 0)} assertions`, C.dim));
  }

  ok('shard-union assertion COUNT == full-run assertion count', unionMap.size === fullMap.size, `union ${unionMap.size} · full ${fullMap.size}`);

  const missing = [...fullMap.keys()].filter((k) => !unionMap.has(k));
  const extra = [...unionMap.keys()].filter((k) => !fullMap.has(k));
  ok('no assertion is LOST by sharding', missing.length === 0, missing.length ? `${missing.length} missing, e.g. ${missing[0].replace(' ', ' :: ')}` : 'none');
  ok('no assertion is INVENTED by sharding', extra.length === 0, extra.length ? `${extra.length} extra, e.g. ${extra[0].replace(' ', ' :: ')}` : 'none');

  // The real prize: same assertions AND same verdicts. A group that silently depended on an
  // earlier group's side effects would pass full and fail (or flip) sharded — this catches it.
  const flipped = [...fullMap.entries()].filter(([k, v]) => unionMap.has(k) && unionMap.get(k) !== v);
  ok(
    'every assertion has the SAME verdict sharded as unsharded (no cross-group state dependence)',
    flipped.length === 0,
    flipped.length ? `${flipped.length} flipped, e.g. ${flipped[0][0].replace(' ', ' :: ')}: full=${flipped[0][1]} union=${unionMap.get(flipped[0][0])}` : `${fullMap.size} verdicts identical`
  );
  ok('the full run itself is green (no pre-existing red)', ![...fullMap.values()].includes('FAIL'), [...fullMap.values()].filter((v) => v === 'FAIL').length + ' failing');
  /* §3d — the CONSUMER check: the shards' own objects, aggregated, reach the full run's object. */
  const agree = shardObjectsAgree(full.verdict || null, shardVerdicts, CI_SHARDS);
  ok("the shard OBJECTS aggregate to the full run's object (tepna.verdict/1, §3d)", agree.pass, agree.detail);
}

const bad = fails.length;
const verdict = shardUnionVerdict(checks, { deep: DEEP, ciShards: CI_SHARDS });
if (JSON_OUT) console.log(JSON.stringify(verdict));
else
  out(
    paint(
      `  tepna.verdict/1: ${verdict.status}  ·  ${verdict.population.checked} checked / ${verdict.population.eligible} eligible / ${verdict.population.excluded} excluded`,
      verdict.status === 'PASS' ? C.green : C.red
    )
  );
out(
  bad
    ? paint(`\n✕ shard-union UNSOUND — ${bad} check(s) failed. Do NOT ship a sharded gate on this plan.\n`, C.red)
    : paint(`\n✓ shard-union sound — the ${CI_SHARDS} shards partition the suite; their union is the full gate.${DEEP ? ' (proven empirically)' : ''}\n`, C.green)
);
process.exit(bad ? 1 : 0);
