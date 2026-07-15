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

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(__dirname, 'run-tests.mjs');
const DEEP = process.argv.slice(2).some((s) => /^--?deep$/i.test(s));
/* The N the CI matrix actually uses. Keep in sync with .github/workflows/tests.yml — check 3 below
   is what makes a drift here loud instead of silent. */
const CI_SHARDS = 6;

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', cyan: '\x1b[36m', yellow: '\x1b[33m' };
const paint = (s, c) => (process.stdout.isTTY ? c + s + C.reset : s);
const fails = [];
const ok = (name, cond, detail) => {
  if (cond) console.log(paint('  ✓ ', C.green) + name + (detail ? paint('  — ' + detail, C.dim) : ''));
  else {
    console.log(paint('  ✕ ', C.red) + name + (detail ? paint('  — ' + detail, C.yellow) : ''));
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

console.log(paint('\n▸ shard-union — the shards must PARTITION the suite', C.cyan));

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
    console.log(
      paint(
        '  ⚠ ' +
          unknown.length +
          ' group(s) have no committed timing — shard balance is guessed for those (coverage is unaffected). Refresh: node tests/run-tests.mjs --json | node tests/gen-group-timings.mjs',
        C.yellow
      )
    );
  if (total) console.log(paint(`  · planned makespan ${(makespan / 1000).toFixed(1)} s of ${(total / 1000).toFixed(1)} s total → ${speedup.toFixed(2)}x`, C.dim));
}

/* ── 4 · --deep: the union really does equal the unsharded run ─────────────── */
if (DEEP) {
  console.log(paint('\n▸ --deep: running the FULL suite + all ' + CI_SHARDS + ' shards for real (~2.5 min)…', C.cyan));
  // Key on (group index, ORDINAL, name) — not (group, name). A handful of groups assert the same NAME
  // twice, so a name-keyed map silently collapses them and the count under-reports (2097 vs the real
  // 2109). That collapse was identical on both sides, so the verdict compare was still valid — but this
  // proof should be exact, not merely self-consistent. The ordinal gives every assertion its own key.
  const key = (gi, i, t) => `${gi}#${i} ${t.name}`;
  const verdict = (t) => (t.skip ? 'skip' : t.pass ? 'pass' : 'FAIL');

  const full = runJson(['--json']);
  const fullMap = new Map();
  for (const g of full.groups) g.tests.forEach((t, i) => fullMap.set(key(g.index, i, t), verdict(t)));
  console.log(paint(`  · full run: ${full.groups.length} groups, ${fullMap.size} assertions`, C.dim));

  const unionMap = new Map();
  const claimedBy = new Map();
  for (let i = 1; i <= CI_SHARDS; i++) {
    const s = runJson([`--shard=${i}/${CI_SHARDS}`, '--json']);
    for (const g of s.groups) {
      if (claimedBy.has(g.index)) fails.push(`group ${g.index} ran in BOTH shard ${claimedBy.get(g.index)} and ${i}`);
      claimedBy.set(g.index, i);
      g.tests.forEach((t, i) => unionMap.set(key(g.index, i, t), verdict(t)));
    }
    console.log(paint(`  · shard ${i}/${CI_SHARDS}: ${s.groups.length} groups, ${s.groups.reduce((a, g) => a + g.tests.length, 0)} assertions`, C.dim));
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
}

const bad = fails.length;
console.log(
  bad
    ? paint(`\n✕ shard-union UNSOUND — ${bad} check(s) failed. Do NOT ship a sharded gate on this plan.\n`, C.red)
    : paint(`\n✓ shard-union sound — the ${CI_SHARDS} shards partition the suite; their union is the full gate.${DEEP ? ' (proven empirically)' : ''}\n`, C.green)
);
process.exit(bad ? 1 : 0);
