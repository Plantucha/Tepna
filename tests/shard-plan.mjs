#!/usr/bin/env node
/*
 * shard-plan.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 */
/* ════════════════════════════════════════════════════════════════════════
   tests/shard-plan.mjs — deterministic, cost-balanced CI shard planner
   ────────────────────────────────────────────────────────────────────────
   Splits the suite's declared groups into N shards that GitHub Actions runs
   in parallel. Two properties, in priority order:

     1 · EXACTLY-ONCE (correctness — non-negotiable). Every declared group
         lands in exactly one shard, so the union of the N shards IS the
         unsharded suite. This is why the plan is INDEX-based: a name/pattern
         shard silently drops any group no pattern happens to claim, and the
         gate would go green having never run it. Proven, not asserted, by
         tests/verify-shard-union.mjs (which CI runs on every push).

     2 · BALANCE (speed — best-effort). Round-robin (i % N) is exactly-once but
         badly unbalanced here: the cost is concentrated in a handful of ECGDex
         groups (the slowest single group is ~19.6 s of a ~101 s suite) and they
         collide on one residue class — measured 42.7 s for the worst shard at
         N=4, a mere 2.4x. So we LPT bin-pack (longest-processing-time-first,
         the classic greedy makespan heuristic) over MEASURED per-group times
         from tests/group-timings.json → ~25 s at N=4, ~4x.

   DRIFT IS SAFE BY CONSTRUCTION. group-timings.json is a *hint*, never a
   contract. A group missing from it (a newly added one) gets the median weight
   and is still placed in exactly one bin; a stale time only degrades BALANCE,
   never correctness. So the file going out of date makes CI slower, never
   wrong — and it is never a reason for a red gate. Refresh it with:
       node tests/run-tests.mjs --json | node tests/gen-group-timings.mjs
   ════════════════════════════════════════════════════════════════════════ */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const TIMINGS_PATH = join(__dirname, 'group-timings.json');

/** Committed per-group wall times (title → ms). Missing/corrupt file → {} (round-robin-ish fallback). */
export function readTimings(path = TIMINGS_PATH) {
  if (!existsSync(path)) return {};
  try {
    const j = JSON.parse(readFileSync(path, 'utf8'));
    return j && typeof j.groups === 'object' && j.groups ? j.groups : {};
  } catch (_) {
    return {};
  }
}

/**
 * Plan N shards over the declared groups.
 *
 * @param {{index:number,title:string}[]} groups  declaration inventory (run-tests --list)
 * @param {Record<string,number>} timings         title → measured ms (a hint; may be stale/empty)
 * @param {number} total                          shard count N
 * @returns {{bins:number[][], weights:number[], unknown:string[]}}
 *          bins[k] = the declaration indices shard k must run (sorted asc)
 */
export function planShards(groups, timings, total) {
  const N = Number(total);
  if (!Number.isInteger(N) || N < 1) throw new Error(`planShards: bad shard total ${total}`);

  // Median of the KNOWN times is the weight for an unknown (newly added) group: a neutral guess
  // that neither starves nor swamps a bin. Balance degrades gracefully; correctness cannot.
  const known = groups.map((g) => timings[g.title]).filter((v) => typeof v === 'number' && isFinite(v) && v >= 0);
  const sorted = [...known].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const unknown = [];
  const weighted = groups.map((g) => {
    const t = timings[g.title];
    const ok = typeof t === 'number' && isFinite(t) && t >= 0;
    if (!ok) unknown.push(g.title);
    return { index: g.index, title: g.title, ms: ok ? t : median };
  });

  // LPT: heaviest first, each into the currently-lightest bin. Ties break on declaration index so
  // the plan is a PURE FUNCTION of (groups, timings, N) — every shard's process computes the
  // identical plan independently, which is what lets shard k trust its own slice with no coordination.
  const order = [...weighted].sort((a, b) => b.ms - a.ms || a.index - b.index);
  const bins = Array.from({ length: N }, () => []);
  const weights = Array.from({ length: N }, () => 0);
  for (const g of order) {
    let best = 0;
    for (let k = 1; k < N; k++) if (weights[k] < weights[best]) best = k;
    bins[best].push(g.index);
    weights[best] += g.ms;
  }
  for (const b of bins) b.sort((a, b2) => a - b2); // run in declaration order within a shard
  return { bins, weights, unknown };
}

/**
 * The exactly-once proof, as a reusable predicate: the bins must PARTITION the group set.
 * Returns [] when the plan is sound, else a list of human-readable violations.
 */
export function partitionViolations(groups, bins) {
  const errs = [];
  const seen = new Map(); // index → shard that claimed it
  for (let k = 0; k < bins.length; k++) {
    for (const i of bins[k]) {
      if (seen.has(i)) errs.push(`group ${i} claimed by BOTH shard ${seen.get(i)} and shard ${k} (duplicate work, and a lie about coverage)`);
      seen.set(i, k);
    }
  }
  for (const g of groups) {
    if (!seen.has(g.index)) errs.push(`group ${g.index} "${g.title}" is in NO shard — it would never run, and the gate would go green anyway`);
  }
  for (const i of seen.keys()) {
    if (!groups.some((g) => g.index === i)) errs.push(`shard ${seen.get(i)} claims group ${i}, which is not declared`);
  }
  return errs;
}

/* ── A GROUP DECLARED AT EXECUTION TIME IS IN NO SHARD ────────────────────────────────────────────
   `partitionViolations` above proves the plan partitions THE INVENTORY IT WAS GIVEN. It cannot see a
   group the inventory never held, and the inventory can be short: `group()` in tests/dex-tests.js runs
   only where control flow reaches it, and the `--list` pass skips every group BODY. So a `group()` call
   nested inside another group's body is invisible to `--list`. planShards then packs a suite that drops
   it, this partition proof passes, every shard drops it too, and the shard-union gate stays green
   (residue 2026-11-08-a-group-declared-only-at-execution-is-dropped-by-every-shard: a planted group at
   bf715e4e5 let `--jobs=6` reproduce the baseline exactly and never run it, and only `--deep` caught
   it, which CI does not run).

   The EXECUTION pass does reach the nested call, so it declares one group more than the inventory
   holds. That disagreement is the detector, and it is free: both numbers already exist in every run.

   Pure, and ONE-SIDED by construction. A run whose bodies never reach the nested call cannot see it,
   so a filtered or sharded run under-reports rather than accusing an unselected group. An inventory
   LARGER than the declaration count is not this defect, so this stays silent on it: a shard claiming a
   group no run declares is `partitionViolations`'s third rule. */
export function lateDeclarations(inventory, totalDeclared, ran = []) {
  const inv = Array.isArray(inventory) ? inventory : [];
  if (!inv.length) return ['the declaration inventory is EMPTY — this check examined nothing, so it cannot pass'];
  if (!Number.isInteger(totalDeclared)) return ['the execution pass reported no declaration count (totalGroups) — this check cannot compare what it cannot read'];
  const errs = [];
  const byIndex = new Map(inv.map((g) => [g.index, g.title]));
  const extra = totalDeclared - inv.length;
  if (extra > 0)
    errs.push(
      `${extra} group(s) were declared DURING the execution pass: the --list inventory holds ${inv.length}, this run declared ${totalDeclared}. ` +
        'A group --list cannot see is in no shard, so every shard drops it and the shard-union gate stays green. Declare every group at the top level of runDexTests.'
    );
  /* CAPPED, because an index drift is a CASCADE: a nested group() at position k shifts every later
     group by one, so a 900-group suite would otherwise print 900 lines about one defect. The first
     drifted index is the address and the count is the size. */
  const absent = [];
  let drift = 0;
  let firstDrift = null;
  for (const g of Array.isArray(ran) ? ran : []) {
    if (!byIndex.has(g.index)) absent.push(`group ${g.index} "${g.title}" RAN and is absent from the declaration inventory — no shard would ever claim it`);
    else if (byIndex.get(g.index) !== g.title) {
      drift++;
      if (firstDrift === null) firstDrift = `group ${g.index} is "${g.title}" in this run and "${byIndex.get(g.index)}" in the inventory`;
    }
  }
  errs.push(...absent.slice(0, 3));
  if (absent.length > 3) errs.push(`…and ${absent.length - 3} more group(s) that ran outside the inventory`);
  if (drift)
    errs.push(
      `${drift} group(s) carry a different title in this run than in the inventory, first: ${firstDrift}. ` +
        'A late declaration shifts every later index, so the shards pack one suite and run another.'
    );
  return errs;
}
