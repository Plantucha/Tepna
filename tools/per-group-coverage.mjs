#!/usr/bin/env node
/*
 * tools/per-group-coverage.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * WHICH GROUP EXECUTES WHICH LINE — the map two separate optimisations have been blocked on.
 *
 * Aggregate coverage (`npm run coverage:json`, read by tools/mutation-reach.mjs) answers "does ANY
 * test execute this line". That is enough to skip the unreachable — measured at only ~4.8 % of lines
 * on this fleet, so worth ~5 % of a sweep, not the quarter an optimistic reading of the 77.3 %
 * statement-coverage figure suggests. It is NOT enough for either of the two things that matter:
 *
 *   1. TEST SELECTION. A mutant on line N can only be killed by a test that EXECUTES line N, so with
 *      this map a sweep runs 3 groups instead of 300. MUTATION-PROGRAM-FOLLOWUPS §6 estimates 10–100×
 *      and calls it "the ONE optimisation worth building before more tests".
 *   2. SOUND REUSE OF A SURVIVED VERDICT. tools/mutate.mjs §INCREMENTAL SWEEPS is explicit that only
 *      KILLED verdicts are safely reusable today — 3702 of 9996 — because "a newly added group can
 *      kill any survivor anywhere, and without per-test coverage there is no way to know which".
 *      With this map you know which: a survivor is invalidated only by a group that executes its line.
 *
 * PRIOR ART, and the reason this is worth building rather than adopting. Coverage-directed mutant
 * execution is standard; the Python lane here gets it for free because mutmut "tests each mutant
 * against only the tests covering the mutated function" (capture-host/tools/mutate.py). The JS lane
 * has a bespoke runner and therefore has to build it.
 *   Petrović, G. & Ivanković, M. (2018). "State of Mutation Testing at Google."
 *   ICSE-SEIP '18, pp. 163–171. doi:10.1145/3183519.3183521
 *
 * METHOD — one c8 run per GROUP, in parallel. Not an in-process V8 inspector hook, deliberately:
 * that would need `group()` in tests/dex-tests.js to grow start/end callbacks, and that file is the
 * one every parallel PR already conflicts in (CLAUDE.md §👥.2c). Running each group as its own
 * process needs NO change to the shared suite — only `--group-index`, which addresses a group by the
 * index `--list` already emits rather than by a title containing regex metacharacters and commas.
 * Cost is ~(full suite) + (N × 0.21 s startup) under instrumentation, and it is embarrassingly
 * parallel, so it is minutes on this box rather than the hours an in-process rewrite would take to
 * get right.
 *
 * ⚠️ FAILS CLOSED, for the same reason tools/mutation-reach.mjs does. A group whose coverage cannot
 * be read is recorded as `unknown: true` and every consumer must treat it as EXECUTING EVERY LINE —
 * i.e. always select it. A selection map that silently drops a group stops running tests that would
 * have killed mutants, and reports the resulting survivors as findings. That is manufactured
 * blindness, and it is worse than running everything.
 *
 * USAGE
 *   node tools/per-group-coverage.mjs                       # all groups → .mutation-sweeps/per-group.json
 *   node tools/per-group-coverage.mjs --limit 20            # first N groups (a smoke run)
 *   node tools/per-group-coverage.mjs --jobs 12
 *   node tools/per-group-coverage.mjs --out PATH
 *   node tools/per-group-coverage.mjs --selftest
 * ══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executedLines, findRecord } from './mutation-reach.mjs';
import { buildIdentity } from './mutation-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const IS_MAIN = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export const DSP_FILES = ['oxydex-dsp.js', 'ecgdex-dsp.js', 'integrator-dsp.js', 'ppgdex-dsp.js', 'glucodex-dsp.js', 'cpapdex-dsp.js', 'hrvdex-dsp.js', 'motiondex-dsp.js', 'pulsedex-dsp.js'];

/* ── THE CONSUMER SIDE, pure and gateable without a coverage run ─────────────────────────────
   Given the map, which group indices must run to have a chance of killing a mutant at file:line?
   A group is selected if it executes the line, OR if its coverage is unknown (fail-closed). */
export function groupsForLine(map, file, line) {
  const out = [];
  if (!map || !Array.isArray(map.groups)) return out;

  /* ── BASELINE LINES SELECT EVERY GROUP, and getting this backwards would be the whole bug ────
     `tests/run-tests.mjs` loads EVERY DSP through `vm.runInContext` before any group runs, so a
     module's top-level code executes even when zero groups are selected. Measured 2026-08-14:
     853 of ppgdex-dsp.js's lines execute with `--group-index=999999` (no group matches), and the
     first version of this tool therefore reported all 12 smoke-test groups touching all 9 DSPs —
     identical output for every group, which is §8's "check the battery produced varied output
     before believing a verdict". Group 4's honest attributable count is 487, not 1340.

     So each group's `files` holds only what it added OVER that baseline. But a line IN the baseline
     is executed by every group's process, so ANY group could kill a mutant there — it must select
     ALL of them. Returning none (the naive reading of "not attributable to any group") would skip
     those mutants entirely, which is the unrecoverable direction this file exists to avoid. */
  const base = map.baseline && map.baseline[file];
  if (Array.isArray(base) && base.includes(line)) return map.groups.map((g) => g.index);

  for (const g of map.groups) {
    if (g.unknown) {
      out.push(g.index);
      continue;
    }
    const lines = g.files && g.files[file];
    if (Array.isArray(lines) && lines.includes(line)) out.push(g.index);
  }
  return out;
}

/* The saving this map buys, as a plain ratio — reported rather than assumed, because an estimate
   nobody measured is how §1's 60-mutant sample went wrong. */
export function selectionRatio(map, file, line) {
  const total = map && Array.isArray(map.groups) ? map.groups.length : 0;
  if (!total) return 1;
  return groupsForLine(map, file, line).length / total;
}

function listGroups() {
  const out = execFileSync(process.execPath, [join(ROOT, 'tests/run-tests.mjs'), '--list'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out).groups;
}

function coverOne(index, tmpDir) {
  return new Promise((res) => {
    const dir = join(tmpDir, 'g' + index);
    const ch = spawn('npx', ['-y', 'c8@10.1.2', '--reporter=json', '--report-dir=' + dir, process.execPath, join(ROOT, 'tests/run-tests.mjs'), '--group-index=' + index], {
      cwd: ROOT,
      stdio: 'ignore'
    });
    const kill = setTimeout(() => ch.kill('SIGKILL'), 900000);
    ch.on('close', () => {
      clearTimeout(kill);
      const f = join(dir, 'coverage-final.json');
      if (!existsSync(f)) return res({ index, unknown: true, reason: 'no coverage report' });
      let cov;
      try {
        cov = JSON.parse(readFileSync(f, 'utf8'));
      } catch (e) {
        return res({ index, unknown: true, reason: 'unparseable: ' + e.message });
      }
      const files = {};
      for (const df of DSP_FILES) {
        const ex = executedLines(findRecord(cov, df));
        if (ex.size) files[df] = [...ex].sort((a, b) => a - b);
      }
      rmSync(dir, { recursive: true, force: true });
      res({ index, files });
    });
    ch.on('error', (e) => {
      clearTimeout(kill);
      res({ index, unknown: true, reason: 'spawn: ' + e.message });
    });
  });
}

// ── selftest ────────────────────────────────────────────────────────────────────────────────
if (IS_MAIN && has('--selftest')) {
  let pass = 0,
    fail = 0;
  const ok = (n, c, d) => {
    if (c) {
      pass++;
      console.log('  ✓ ' + n + (d ? '  — ' + d : ''));
    } else {
      fail++;
      console.log('  ✗ ' + n + (d ? '  — ' + d : ''));
    }
  };
  const MAP = {
    groups: [
      { index: 0, files: { 'ppgdex-dsp.js': [10, 11, 12] } },
      { index: 1, files: { 'ppgdex-dsp.js': [50] } },
      { index: 2, files: { 'oxydex-dsp.js': [10] } },
      { index: 3, unknown: true, reason: 'timeout' }
    ]
  };
  ok('a line selects only the groups that execute it', JSON.stringify(groupsForLine(MAP, 'ppgdex-dsp.js', 10)) === '[0,3]', JSON.stringify(groupsForLine(MAP, 'ppgdex-dsp.js', 10)));
  ok('…and the SAME line in another file does not select it', !groupsForLine(MAP, 'oxydex-dsp.js', 10).includes(0));
  ok('an UNKNOWN group is ALWAYS selected (fail-closed)', groupsForLine(MAP, 'ppgdex-dsp.js', 999).includes(3), JSON.stringify(groupsForLine(MAP, 'ppgdex-dsp.js', 999)));
  ok('a line nothing executes still selects the unknown group, never nothing-at-all', groupsForLine(MAP, 'ppgdex-dsp.js', 999).length === 1);
  ok('a null map selects nothing but does not throw', groupsForLine(null, 'x.js', 1).length === 0);
  ok('a malformed map does not throw', groupsForLine({ groups: 'nope' }, 'x.js', 1).length === 0);
  ok('the ratio is groups-selected over total', selectionRatio(MAP, 'ppgdex-dsp.js', 50) === 2 / 4, String(selectionRatio(MAP, 'ppgdex-dsp.js', 50)));
  ok('an empty map cannot claim a saving', selectionRatio({ groups: [] }, 'x.js', 1) === 1);

  /* The baseline rule. A line executed at MODULE LOAD is executed by every group's process, so it
     must select all of them — returning none would skip those mutants entirely. */
  const BMAP = { baseline: { 'ppgdex-dsp.js': [7] }, groups: MAP.groups };
  ok('a BASELINE line selects EVERY group', groupsForLine(BMAP, 'ppgdex-dsp.js', 7).length === 4, JSON.stringify(groupsForLine(BMAP, 'ppgdex-dsp.js', 7)));
  ok('…including groups that touch no DSP at all', groupsForLine(BMAP, 'ppgdex-dsp.js', 7).includes(2));
  ok('a NON-baseline line still selects narrowly', JSON.stringify(groupsForLine(BMAP, 'ppgdex-dsp.js', 10)) === '[0,3]');
  ok('a baseline for ANOTHER file does not widen this one', groupsForLine({ baseline: { 'oxydex-dsp.js': [10] }, groups: MAP.groups }, 'ppgdex-dsp.js', 10).length === 2);
  ok('a map with NO baseline behaves as before (un-subtracted, over-selects)', JSON.stringify(groupsForLine(MAP, 'ppgdex-dsp.js', 10)) === '[0,3]');
  console.log('\n' + (fail ? `✗ ${fail} failed, ${pass} passed` : `✓ all ${pass} selftests passed`));
  process.exit(fail ? 1 : 0);
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────
if (IS_MAIN && !has('--selftest')) {
  const jobs = Math.max(1, Number(opt('--jobs', String(Math.max(1, Math.min(16, cpus().length - 2))))) || 1);
  const limit = Number(opt('--limit', '0')) || 0;
  const out = opt('--out', join(ROOT, '.mutation-sweeps/per-group.json'));
  mkdirSync(dirname(out), { recursive: true });
  const tmpDir = join(ROOT, '.mutation-sweeps/.pgc-tmp');
  mkdirSync(tmpDir, { recursive: true });

  let groups = listGroups();
  if (limit) groups = groups.slice(0, limit);
  console.log(`▸ per-group coverage — ${groups.length} group(s), ${jobs} worker(s)\n`);

  /* BASELINE FIRST — the load-time coverage every group pays. `--group-index=999999` matches no
     group, so zero group bodies run while every DSP is still loaded. If it fails we do NOT subtract:
     an un-subtracted map over-selects, which costs time; a wrongly-subtracted one under-selects,
     which skips tests that would have killed mutants. */
  console.log('  measuring load-time baseline (no group executes)…');
  const baseRes = await coverOne(999999, tmpDir);
  const baseline = baseRes.unknown ? null : baseRes.files;
  if (!baseline) console.log(`  ⚠ baseline FAILED (${baseRes.reason}) — not subtracting; the map will over-select (safe, slower).`);
  else
    console.log(
      `  baseline: ${Object.entries(baseline)
        .map(([f, l]) => f.replace('-dsp.js', '') + ' ' + l.length)
        .join(' · ')}\n`
    );
  const baseSets = {};
  for (const f of Object.keys(baseline || {})) baseSets[f] = new Set(baseline[f]);

  const results = [];
  let done = 0;
  const queue = groups.slice();
  const t0 = Date.now();
  const worker = async () => {
    for (;;) {
      const g = queue.shift();
      if (!g) return;
      const r = await coverOne(g.index, tmpDir);
      if (!r.unknown && r.files) {
        // Attributable = what this group added OVER the load-time baseline. See groupsForLine.
        for (const f of Object.keys(r.files)) {
          const b = baseSets[f];
          if (b) r.files[f] = r.files[f].filter((l) => !b.has(l));
          if (!r.files[f].length) delete r.files[f];
        }
      }
      results.push({ ...r, title: g.title, tag: g.tag });
      done++;
      if (done % 10 === 0 || done === groups.length) {
        const el = Math.round((Date.now() - t0) / 1000);
        console.log(`  ${done}/${groups.length}  (${el}s elapsed)`);
      }
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  results.sort((a, b) => a.index - b.index);

  const unknown = results.filter((r) => r.unknown);
  /* ── STAMP IT, OR A LATER SWEEP CANNOT TELL WHETHER IT STILL APPLIES ───────────────────────────
     This record used to be written with `generated: null` and no hashes at all, which made a stale
     map indistinguishable from a fresh one. That asymmetry matters: an ABSENT map costs time (the
     consumer falls back to the tag filter), while a PRESENT, STALE map selects groups that do not
     execute the mutant's line — and a mutant no test executes SURVIVES. Staleness therefore
     manufactures findings, arriving disguised as a speedup.
     A map is a function of LINE NUMBERS, and lines move for reasons as trivial as a comment: #1422
     inserted 16 comment lines into oxydex-dsp.js and shifted everything below line 1023. The suite
     hash is in there too because the map's values are group INDICES — insert a group and every
     later index shifts, which no per-file source hash would catch. */
  const mapped = new Set();
  for (const r of results) for (const f of Object.keys((r && r.files) || {})) mapped.add(f);
  const identity = buildIdentity(ROOT, [...mapped]);
  const map = {
    generated: new Date().toISOString(),
    identity,
    totalGroups: results.length,
    unknownGroups: unknown.length,
    baselineSubtracted: !!baseline,
    baseline: baseline || null,
    groups: results
  };
  writeFileSync(out, JSON.stringify(map));
  rmSync(tmpDir, { recursive: true, force: true });

  console.log(`\n✓ wrote ${out}`);
  if (unknown.length) {
    console.log(`  ⚠ ${unknown.length} group(s) produced NO usable coverage. They are marked unknown and`);
    console.log('    every consumer must select them for EVERY line — fail-closed, so they cost time, not blindness.');
    for (const u of unknown.slice(0, 8)) console.log(`      · [${u.index}] ${String(u.title).slice(0, 60)} — ${u.reason}`);
  }
  const covered = results.filter((r) => !r.unknown && r.files && Object.keys(r.files).length);
  console.log(`  ${covered.length}/${results.length} group(s) execute at least one DSP line.`);
}
