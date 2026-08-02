#!/usr/bin/env node
/*
 * tools/mutate.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * MUTATION HARNESS — break the code on purpose and find out which gates do not notice.
 *
 * This repo's central anxiety is the hollow gate: an assertion that passes, is quoted as evidence,
 * and could never have failed. `TEST-AUDIT-FINDINGS` found **42** of them — by applying 40 mutations
 * BY HAND, one at a time, and re-running the suite for each. That was a heroic one-off and it is not
 * repeatable, which is why the Python side was never audited at all and why nothing has re-checked
 * the JS side since.
 *
 * A SURVIVING MUTANT IS THE FINDING. If a line can be changed and the whole suite stays green, then
 * nothing tests that line — whatever the coverage number says. Coverage asks "was this executed?";
 * mutation asks "would anyone notice if it were wrong?", which is the question this repo actually
 * cares about.
 *
 * WHY IT IS FAST ENOUGH TO USE. Running the full suite per mutant (~2-4 min × hundreds) is a
 * non-starter. But every group in `tests/dex-tests.js` carries a TAG naming its module
 * (`ppgdex-dsp`, `integrator-dsp`, …), and `run-tests.mjs --group=` filters on title OR tag. So a
 * mutant of `ppgdex-dsp.js` only runs the groups tagged `ppgdex-dsp` — seconds, not minutes.
 * `--full` runs the whole suite per mutant when you want certainty over speed.
 *
 * THE TAG SELECTION IS ITSELF A RESULT. If a file has NO matching groups, every mutant survives
 * trivially — and that is worth knowing loudly rather than reporting as "0 killed". The tool says
 * `NO GROUPS` for that file instead of pretending it measured something.
 *
 * WHAT A SURVIVOR IS NOT: proof of a bug. It is proof that the SUITE cannot see a change there.
 * Some survivors are legitimately untestable (a log string, a defensive branch that cannot be
 * reached). Triage is the reader's; this tool only refuses to let them stay invisible.
 *
 * AN AUDIT TOOL, NOT A GATE — deliberately. A survivor needs TRIAGE: some are legitimately
 * untestable (an unreachable defensive branch, a log string, a float boundary that cannot be hit),
 * and a gate that reds on those is a gate someone turns off. That is the same objection
 * `DOCS-LEDGER-CHECK3B-BLIND-ROW` §4a used to refuse a cry-wolf checker, and it applies here with
 * more force because mutation survivors are noisier than status strings. Run it when you touch a
 * module, when a brief claims something is "gated", and periodically over the DSPs.
 *   The ONE bounded form that would belong in CI is DIFF-SCOPED: mutate only the lines a PR
 * changed and require them killed — a handful of mutants, seconds, and it enforces exactly "if you
 * touched it, some test can see it" without ever judging pre-existing code. Not built here; it is
 * the obvious follow-up and the reason it is not the default is that it needs the PR's diff, not
 * the file.
 *
 * SCOPE: JavaScript only. `capture-host/` is Python under pytest and is NOT covered — a different
 * runner and a different mutation grammar. `TEST-AUDIT-FINDINGS` §34 already recorded that the
 * Python side has never been mutation-audited and pointed at `mutmut`/`cosmic-ray`; that remains
 * true and is not fixed by this tool.
 *
 * USAGE
 *   node tools/mutate.mjs --changed                 # files changed vs origin/main (default)
 *   node tools/mutate.mjs --file ppgdex-dsp.js      # one file (repeatable)
 *   node tools/mutate.mjs --file X --limit 40       # cap mutants per file (default 60)
 *   node tools/mutate.mjs --file X --jobs 12        # parallel workers (default: ~⅔ of cores; 1 at ≤2 cores)
 *   node tools/mutate.mjs --budget 120              # skip a file whose estimate exceeds 120 s/file
 *   node tools/mutate.mjs --file X --full           # run the WHOLE suite per mutant
 *   node tools/mutate.mjs --json                    # NDJSON, one line per file, streamed
 *   node tools/mutate.mjs --selftest                # known-answer, no repo mutation
 *
 * SAFETY — and this was got WRONG first, so it is spelled out. With `--jobs > 1` (the default) the
 * caller's tree is NEVER written to: each worker mutates its own `git worktree`. On the `--jobs 1`
 * path the file is edited in place, and signal handlers are NOT a guarantee — the serial run blocks
 * in `execFileSync`, so the event loop cannot service a handler while a suite is running, and
 * SIGKILL is uncatchable anyway. Verified rather than assumed: a `pkill` mid-run left `clock.js`
 * mutated in the working tree with all four handlers registered. The guarantee is therefore an
 * on-disk `<file>.mutate-backup` that exists for the whole window, plus `recoverStale()` at startup
 * which restores any leftover before doing anything else and says so.
 */
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { cpus } from 'node:os';
import { execFileSync, execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const LIMIT = +opt('--limit', 60);
const FULL = has('--full');
/* Per-file wall-clock ceiling in seconds. A sweep across 71 modules is dominated by a handful of
   pathologically expensive tags, and skipping them LOUDLY beats discovering them at minute forty. */
const BUDGET = +opt('--budget', '0');
const AS_JSON = has('--json');
/* Mutants are independent, so this is embarrassingly parallel — but every mutant rewrites the SAME
   file, so they cannot share a tree. Each worker gets its own `git worktree` (shares the object store)
   and mutates its own copy: the isolation CLAUDE.md §👥 already prescribes, applied to the harness
   itself. `--jobs 1` keeps the in-place serial path, for debugging the tool.

   THE DEFAULT IS MEASURED, NOT REASONED. It was `min(8, cores-2)`, and a contention argument talked me
   into going LOWER still. Both were wrong. On a 24-core box, `pulsedex-dsp.js` × 12 mutants:

       jobs  4 → 23 s     jobs  8 → 17 s     jobs 16 → 14 s     jobs 24 → 20 s     jobs 32 → 19 s

   Monotonically faster to ~⅔ of the cores, then it degrades — each worker is a full `node` running a
   real suite, so past that they fight for cores and page cache. One suite run for that module is
   6.58 s, so 16 jobs buys ~5.6× over serial. `cores × 2/3` reproduces the measured optimum here and
   degrades sanely on smaller machines; re-measure before trusting it on very different hardware.

   LOW-CORE MACHINES GET THE SERIAL PATH, deliberately. At 1–2 cores parallelism buys nothing (the
   workers just fight for the same core) and costs real resources: each worktree is a FULL checkout —
   71 MB here — so a 2-worker split on a 2-core laptop spends 142 MB of disk and a chunk of page cache
   to run no faster. `--jobs 1` also skips worktrees entirely and mutates in place, which is the right
   trade when there is nothing to parallelise over. An explicit `--jobs N` always wins, so a small box
   can still opt in. */
export function defaultJobs(cores) {
  if (!(cores > 0)) return 1; // cpus() can report an empty list in constrained containers
  if (cores <= 2) return 1; // serial: no worktrees, no extra disk, no oversubscription
  return Math.max(2, Math.round((cores * 2) / 3));
}
const JOBS = Math.max(1, +opt('--jobs', String(defaultJobs(cpus().length))));

/* ── the operators ───────────────────────────────────────────────────────────────────────────
   Deliberately small and high-signal. Each is a change that a competent test SHOULD catch, and
   each is a real defect shape this repo has actually shipped: an off-by-one in a threshold
   comparison, an && that should have been ||, a boundary constant, an inverted guard. Exotic
   operators (statement deletion, method swaps) produce mostly-invalid mutants and drown the signal. */
const OPS = [
  { name: 'cmp >= → >', re: />=/g, to: '>' },
  { name: 'cmp <= → <', re: /<=/g, to: '<' },
  { name: 'cmp > → >=', re: /([^-=<>!])>(?!=)/g, to: '$1>=' },
  { name: 'cmp < → <=', re: /([^-=<>!])<(?!=)/g, to: '$1<=' },
  { name: 'eq === → !==', re: /===/g, to: '!==' },
  { name: 'eq !== → ===', re: /!==/g, to: '===' },
  { name: 'bool && → ||', re: /&&/g, to: '||' },
  { name: 'bool || → &&', re: /\|\|/g, to: '&&' },
  { name: 'negate: drop !', re: /([(\s])!(?![=!])/g, to: '$1' },
  { name: 'num → 0', re: /\b(\d+\.\d+|\d{2,})\b/g, to: '0' }
];

/* Skip lines that cannot carry behaviour: imports and license headers. */
const SKIP_LINE = /^\s*(import\s|export\s+\{)/;

/* A PER-CHARACTER MASK OF WHAT IS ACTUALLY CODE.
   The first version skipped lines that *began* with a comment marker, which is not the same thing at
   all — and the first real sweep proved it. Roughly a third of the reported "survivors" were mutations
   of prose: a `<` inside a block-comment body whose continuation line starts with a letter, a trailing `// 90 min`
   after a real statement, digits inside an HTML string. Those are guaranteed survivors, they are
   pure noise, and — worse — they DEPRESS THE KILL RATE, so the headline number was wrong in the
   pessimistic direction. Coverage of prose is not a gate hole.

   So walk the file once and mark every character that is inside a line comment, a block comment, or a
   string/template literal. Mutations are only generated at unmasked positions. This is a scanner, not
   a parser: it does not know about regex literals, which are rare in these DSPs and at worst
   reintroduce a little of the noise this removes. */
function codeMask(src) {
  const m = new Uint8Array(src.length); // 1 = real code
  let i = 0;
  const N = src.length;
  let state = 0; // 0 code · 1 line-comment · 2 block-comment · 3 '…' · 4 "…" · 5 `…`
  while (i < N) {
    const c = src[i],
      d = src[i + 1];
    if (state === 0) {
      if (c === '/' && d === '/') (state = 1), (i += 2);
      else if (c === '/' && d === '*') (state = 2), (i += 2);
      else if (c === "'") (state = 3), i++;
      else if (c === '"') (state = 4), i++;
      else if (c === '`') (state = 5), i++;
      else (m[i] = 1), i++;
    } else if (state === 1) {
      if (c === '\n') (state = 0), (m[i] = 1);
      i++;
    } else if (state === 2) {
      if (c === '*' && d === '/') (state = 0), (i += 2);
      else i++;
    } else {
      const q = state === 3 ? "'" : state === 4 ? '"' : '`';
      if (c === '\\') i += 2;
      else if (c === q) (state = 0), i++;
      else i++;
    }
  }
  return m;
}

function mutantsFor(src) {
  const lines = src.split('\n');
  const mask = codeMask(src);
  const lineStart = [];
  let acc = 0;
  for (const L of lines) {
    lineStart.push(acc);
    acc += L.length + 1;
  }
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (!L.trim() || SKIP_LINE.test(L)) continue;
    if (L.includes('eslint') || L.includes('biome-ignore')) continue;
    const base = lineStart[i];
    const isCode = (off, len) => {
      for (let k = 0; k < len; k++) if (!mask[base + off + k]) return false;
      return true;
    };
    for (const op of OPS) {
      const re = new RegExp(op.re.source, op.re.flags);
      let m;
      while ((m = re.exec(L)) !== null) {
        if (!isCode(m.index, m[0].length)) continue; // inside a comment or a string literal
        const mutatedLine = L.slice(0, m.index) + m[0].replace(new RegExp(op.re.source), op.to) + L.slice(m.index + m[0].length);
        if (mutatedLine === L) continue;
        out.push({
          line: i + 1,
          op: op.name,
          before: L.trim().slice(0, 100),
          after: mutatedLine.trim().slice(0, 100),
          apply: () =>
            lines
              .slice(0, i)
              .concat(mutatedLine, lines.slice(i + 1))
              .join('\n')
        });
        if (op.re.flags.indexOf('g') < 0) break;
      }
    }
  }
  return out;
}

/* Deterministic thinning — a seeded stride, never Math.random, so two runs of the same command
   examine the same mutants and a reported survivor can be reproduced. */
function thin(list, limit) {
  if (list.length <= limit) return list;
  const step = list.length / limit;
  const out = [];
  for (let i = 0; i < limit; i++) out.push(list[Math.floor(i * step)]);
  return out;
}

function groupsForFile(file) {
  const stem = basename(file).replace(/\.(js|mjs)$/, '');
  let listed;
  try {
    listed = JSON.parse(execSync('node tests/run-tests.mjs --list --json', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return null;
  }
  const hit = (listed.groups || []).filter((g) => (g.tag || '').split('·').some((t) => t.trim() === stem));
  return { stem, count: hit.length };
}

/* Async twin of runSuite, for the worker pool. Same classification, non-blocking. */
function runSuiteAsync(filter, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const ch = spawn('node', filter ? ['tests/run-tests.mjs', '--group=' + filter] : ['tests/run-tests.mjs'], { cwd, stdio: 'ignore', timeout: timeoutMs || 900000 });
    ch.on('error', () => resolve('INVALID'));
    ch.on('close', (code) => resolve(code === 0 ? 'SURVIVED' : 'KILLED'));
  });
}

/* THE WORKER POOL IS CREATED ONCE PER PROCESS, not once per file.
   The first version built it inside runFile(), which was fine for a single module and catastrophic
   for a sweep: `git worktree add` checks out the WHOLE tree — 71 MB here — so 12 workers × 71 files
   is 852 full checkouts, ~850 MB copied per file. Measured on this external volume: one file took
   ~12 minutes, projecting to ~14 h for the roster, and essentially all of it was checkout I/O rather
   than test execution. Hoisted, the same sweep pays for 12 checkouts total. */
let _pool = null;
function workerPool() {
  if (_pool) return _pool;
  _pool = [];
  for (let w = 0; w < JOBS; w++) {
    const dir = join(ROOT, '..', '.mutate-w' + w + '-' + process.pid);
    try {
      execFileSync('git', ['worktree', 'add', '--detach', '--quiet', dir, 'HEAD'], { cwd: ROOT, stdio: 'ignore' });
      _pool.push(dir);
    } catch (e) {
      /* Out of disk, or git cannot add a worktree here. Do NOT abort the run: carry on with however
         many workers were created, and fall back to the serial in-place path if that is none. Each
         worktree is a full checkout, so a small machine hitting this is expected, not exceptional. */
      if (!AS_JSON) console.error('  ⚠ worker ' + w + ' unavailable (' + ((e && e.message) || e).toString().split('\n')[0].slice(0, 80) + ') — continuing with ' + _pool.length);
      break;
    }
  }
  return _pool;
}
function dropPool() {
  for (const d of _pool || []) {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', d], { cwd: ROOT, stdio: 'ignore' });
    } catch {}
  }
  _pool = null;
}

function runSuite(filter, cwd, timeoutMs) {
  try {
    execFileSync('node', filter ? ['tests/run-tests.mjs', '--group=' + filter] : ['tests/run-tests.mjs'], { cwd: cwd || ROOT, stdio: 'ignore', timeout: timeoutMs || 900000 });
    return 'SURVIVED'; // suite green with broken code → nothing tests this line
  } catch (e) {
    return e.status === undefined ? 'INVALID' : 'KILLED';
  }
}

async function runFile(file) {
  const abs = join(ROOT, file);
  if (!existsSync(abs)) return { file, error: 'not found' };
  const g = groupsForFile(file);
  const filter = FULL ? null : g && g.count ? g.stem : null;
  if (!FULL && (!g || !g.count)) return { file, error: 'NO GROUPS tagged "' + (g ? g.stem : '?') + '" — every mutant would survive trivially. Use --full, or give this file a tagged group.' };

  /* TIME ONE CLEAN RUN FIRST. Two things depend on it and both were guesses before.
     (a) THE TIMEOUT. It was a flat 900 s, which is not a timeout so much as a promise never to
         notice a hang: a mutant that wedges the suite stalled a worker for fifteen minutes, and with
         every worker able to do that a single module could eat an hour. Bound it at 5x the clean run
         (floor 30 s) — anything slower than that is not "slow", it is broken, and a broken mutant is
         INVALID, not a survivor.
     (b) THE ESTIMATE. The dominant cost is simply what this module's tagged groups cost to run, and
         that varies by three orders of magnitude across the roster: `quantity` is 0.21 s, `oxydex-dsp`
         16.3 s, `clock` **3 m 11 s** — because `clock` is loaded by everything and its tag selects 16
         heavy groups. Knowing that BEFORE spending twelve mutants on it is the difference between a
         sweep you can plan and one you watch. */
  const t0 = Date.now();
  runSuite(filter, ROOT, 600000);
  const baseMs = Math.max(1, Date.now() - t0);
  const timeoutMs = Math.max(30000, baseMs * 5);
  const estMs = (baseMs * Math.min(mutantsFor(readFileSync(abs, 'utf8')).length, LIMIT)) / Math.max(1, JOBS);
  if (BUDGET && estMs > BUDGET * 1000)
    return {
      file,
      error:
        'SKIPPED — one clean run of `' +
        filter +
        '` costs ' +
        (baseMs / 1000).toFixed(1) +
        ' s, so ' +
        LIMIT +
        ' mutants ≈ ' +
        (estMs / 1000).toFixed(0) +
        ' s > --budget ' +
        BUDGET +
        ' s. Raise --budget, lower --limit, or give this module cheaper groups.'
    };
  if (!AS_JSON) process.stderr.write('  ' + file + '  baseline ' + (baseMs / 1000).toFixed(1) + ' s/run → est ' + (estMs / 1000).toFixed(0) + ' s\n');

  const original = readFileSync(abs, 'utf8');
  const all = mutantsFor(original);
  const picked = thin(all, LIMIT);
  /* CRASH-SAFE RESTORE. The first version registered SIGINT only, and a `pkill` (SIGTERM) during a run
     left `clock.js` MUTATED IN THE WORKING TREE — the `finally` never ran, and nothing said so. A tool
     that edits your source must survive being killed the way people actually kill things. So: an
     on-disk backup exists for the whole window (recoverable even from SIGKILL, which no handler can
     catch), and every catchable fatal signal restores. */
  /* The on-disk backup is only meaningful on the SERIAL path — with `--jobs > 1` the caller's tree is
     never mutated, so writing one there left a stray `*.mutate-backup` in the working tree after every
     parallel run for no benefit. Observed after a killed sweep: a lone `ppgdex-dsp.js.mutate-backup`
     beside a perfectly clean source. */
  const bak = abs + '.mutate-backup';
  if (JOBS === 1) {
    writeFileSync(bak, original);
    _dirty.set(abs, original);
  }
  const restore = () => {
    if (JOBS !== 1) return; // nothing was written here
    try {
      writeFileSync(abs, original);
    } catch {}
    try {
      rmSync(bak, { force: true });
    } catch {}
    _dirty.delete(abs);
  };
  const survivors = [];
  let killed = 0,
    invalid = 0,
    done = 0;
  const trees = [];
  const tick = () => {
    if (!AS_JSON) process.stderr.write('\r  ' + file + '  ' + ++done + '/' + picked.length + '  killed ' + killed + '  survived ' + survivors.length + '  [' + (trees.length || 1) + ' job(s)]   ');
  };
  const classify = (v, mu) => {
    if (v === 'KILLED') killed++;
    else if (v === 'INVALID') invalid++;
    else survivors.push(mu);
    tick();
  };

  try {
    if (JOBS > 1) {
      /* One disposable worktree per worker, detached at HEAD. Each worker mutates ITS OWN copy of the
         file, so no two mutants ever race on the same bytes — and the caller's tree is never written
         to at all on this path. */
      trees.push(...workerPool());
      if (!trees.length) {
        /* No worker could be created — degrade to the serial in-place path rather than doing nothing.
           The backup/recovery machinery is keyed on JOBS === 1, so mark this file dirty explicitly. */
        writeFileSync(bak, original);
        _dirty.set(abs, original);
        for (const mu of picked) {
          writeFileSync(abs, mu.apply());
          classify(runSuite(filter, ROOT, timeoutMs), mu);
        }
        writeFileSync(abs, original);
        rmSync(bak, { force: true });
        _dirty.delete(abs);
        return {
          file,
          groupsRun: filter || 'FULL SUITE',
          groupCount: g ? g.count : null,
          generated: all.length,
          tested: picked.length,
          killed,
          invalid,
          survivors: survivors.map((s) => ({ line: s.line, op: s.op, before: s.before, after: s.after }))
        };
      }
      let next = 0;
      const worker = async (dir) => {
        const wAbs = join(dir, file);
        for (;;) {
          const i = next++;
          if (i >= picked.length) return;
          writeFileSync(wAbs, picked[i].apply());
          classify(await runSuiteAsync(filter, dir, timeoutMs), picked[i]);
        }
      };
      await Promise.all(trees.map(worker));
    } else {
      for (const mu of picked) {
        writeFileSync(abs, mu.apply());
        classify(runSuite(filter, ROOT, timeoutMs), mu);
      }
    }
  } finally {
    restore(); // the shared pool is torn down once, by dropPool() at the end of the run
  }
  if (!AS_JSON) process.stderr.write('\r' + ' '.repeat(78) + '\r');
  return {
    file,
    groupsRun: filter || 'FULL SUITE',
    groupCount: g ? g.count : null,
    generated: all.length,
    tested: picked.length,
    killed,
    invalid,
    survivors: survivors.map((s) => ({ line: s.line, op: s.op, before: s.before, after: s.after }))
  };
}

/* ── selftest: known answers, and it does NOT touch the repo ────────────────────────────────
   Mutant GENERATION is the part with a right answer; whether a given mutant survives depends on
   the suite and is not a fixed fact. So the selftest pins generation + thinning determinism. */
function selftest() {
  let fail = 0;
  const ok = (n, c, d) => {
    console.log((c ? '  ok   ' : '  FAIL ') + n + (d != null && !c ? '  — ' + d : ''));
    if (!c) fail++;
  };
  const src = [
    '// a line comment with >= in it', // 1
    'const a = x >= 3 && y !== 2;', // 2
    '/* a block comment', // 3
    '   whose body mentions < and 42 on a plain line */', // 4
    'if (!ready) return 0;', // 5
    'const msg = "read >= 10 files";', // 6  string literal
    'const EPOCH = 5400; // 90 min' // 7  trailing comment after real code
  ].join('\n');
  const ms = mutantsFor(src);
  const lines = [...new Set(ms.map((m) => m.line))].sort((a, b) => a - b);
  ok('a whole-line comment is not mutated', !lines.includes(1), 'lines=' + lines.join(','));
  ok('a BLOCK-comment body is not mutated, even on a plain continuation line', !lines.includes(4), 'lines=' + lines.join(','));
  ok('a STRING literal is not mutated', !lines.includes(6), 'lines=' + lines.join(','));
  ok('code lines are mutated', lines.includes(2) && lines.includes(5), 'lines=' + lines.join(','));
  // Line 7 is the sharp one: real code AND a trailing comment. The 5400 must mutate, the 90 must not.
  const l7 = ms.filter((m) => m.line === 7);
  ok(
    'a trailing comment does not shield the statement before it',
    l7.some((m) => m.after.includes('const EPOCH = 0')),
    l7.map((m) => m.after).join(' | ') || 'no mutant on line 7'
  );
  ok('…and the number INSIDE that trailing comment is left alone', !l7.some((m) => /\/\/ 0 min/.test(m.after)), l7.map((m) => m.after).join(' | '));
  const ops = new Set(ms.filter((m) => m.line === 2).map((m) => m.op));
  ok('line 2 yields the >=, && and !== operators', ops.has('cmp >= → >') && ops.has('bool && → ||') && ops.has('eq !== → ==='), [...ops].join(' | '));
  ok(
    'a mutant actually changes the line',
    ms.every((m) => m.after !== m.before),
    'some mutant is a no-op'
  );
  ok(
    'the ! drop fires on `if (!ready)`',
    ms.some((m) => m.line === 5 && m.op === 'negate: drop !'),
    'ops@5=' +
      ms
        .filter((m) => m.line === 5)
        .map((m) => m.op)
        .join(',')
  );
  /* Low-core behaviour is a CORRECTNESS property, not a tuning detail: at 1-2 cores the tool must
     take the serial in-place path, because each parallel worker is a full 71 MB checkout that buys
     nothing when there is one core to share. Pinned so a future tuning pass cannot quietly hand a
     2-core laptop a 2-worktree split. */
  ok('1 core → serial (no worktrees)', defaultJobs(1) === 1, 'got ' + defaultJobs(1));
  ok('2 cores → serial (no worktrees)', defaultJobs(2) === 1, 'got ' + defaultJobs(2));
  ok('an empty cpus() list → serial, not a crash', defaultJobs(0) === 1 && defaultJobs(undefined) === 1);
  ok('3 cores → 2 workers (parallel begins)', defaultJobs(3) === 2, 'got ' + defaultJobs(3));
  ok('24 cores → 16, the measured optimum on this box', defaultJobs(24) === 16, 'got ' + defaultJobs(24));
  ok(
    'scales monotonically and never exceeds core count',
    [4, 6, 8, 12, 16, 32].every((c, i, a) => defaultJobs(c) <= c && (i === 0 || defaultJobs(c) >= defaultJobs(a[i - 1])))
  );

  // Thinning must be deterministic and order-preserving — a survivor has to be reproducible.
  const big = Array.from({ length: 100 }, (_, i) => ({ i }));
  const t1 = thin(big, 10),
    t2 = thin(big, 10);
  ok('thinning is deterministic', JSON.stringify(t1) === JSON.stringify(t2));
  ok('thinning preserves order and count', t1.length === 10 && t1[0].i === 0 && t1[9].i > t1[0].i);
  console.log(fail ? '\nselftest: ' + fail + ' FAILED' : '\nselftest: all green');
  return fail;
}

/* HANDLERS ARE REGISTERED ONCE, FOR THE PROCESS — not per file.
   The per-file version leaked five listeners per file and a 71-file sweep tripped Node's
   MaxListenersExceededWarning at 11 uncaughtException listeners. Same restore semantics, one
   registration, and an explicit registry of what is currently dirty. */
const _dirty = new Map(); // absolute path → original text
function restoreAll() {
  for (const [abs, original] of _dirty) {
    try {
      writeFileSync(abs, original);
    } catch {}
    try {
      rmSync(abs + '.mutate-backup', { force: true });
    } catch {}
  }
  _dirty.clear();
}
for (const sg of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'])
  process.on(sg, () => {
    restoreAll();
    dropPool();
    process.exit(sg === 'SIGINT' ? 130 : 143);
  });
process.on('uncaughtException', (e) => {
  restoreAll();
  dropPool();
  throw e;
});

/* RECOVER FIRST, ALWAYS. A previous run killed mid-mutation leaves `<file>.mutate-backup` beside a
   mutated source. Restore it before doing anything, so the damage window closes on the next
   invocation instead of waiting to be noticed in a diff — or worse, committed. */
function recoverStale() {
  let out = [];
  const scan = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) continue;
      if (!e.name.endsWith('.mutate-backup')) continue;
      const bak = join(dir, e.name),
        target = bak.replace(/\.mutate-backup$/, '');
      try {
        writeFileSync(target, readFileSync(bak, 'utf8'));
        rmSync(bak, { force: true });
        out.push(target.replace(ROOT + '/', ''));
      } catch {}
    }
  };
  scan(ROOT);
  /* Orphaned worker worktrees from a killed sweep. `dropPool()` cannot run when the process is
     SIGKILLed or reaped by `timeout`, and each tree is a FULL checkout — 34 of them survived one
     killed run here, ~2.4 GB. Reap any that no live process owns before starting. */
  try {
    for (const e of readdirSync(join(ROOT, '..'), { withFileTypes: true })) {
      const m = e.name.match(/^\.mutate-w\d+-(\d+)$/);
      if (!m) continue;
      let alive = false;
      try {
        process.kill(+m[1], 0);
        alive = true;
      } catch {}
      if (alive) continue;
      const dir = join(ROOT, '..', e.name);
      try {
        execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: ROOT, stdio: 'ignore' });
      } catch {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {}
      }
      out.push(e.name + ' (orphaned worktree)');
    }
    execFileSync('git', ['worktree', 'prune'], { cwd: ROOT, stdio: 'ignore' });
  } catch {}
  try {
    scan(join(ROOT, 'tools'));
  } catch {}
  if (out.length) console.error('  ⚠ recovered ' + out.length + ' file(s) from a killed run: ' + out.join(', '));
}
recoverStale();

if (has('--selftest')) process.exit(selftest());

let files = [];
for (let i = 0; i < argv.length; i++) if (argv[i] === '--file' && argv[i + 1]) files.push(argv[i + 1]);
if (!files.length) {
  try {
    files = execSync('git diff --name-only origin/main...HEAD', { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((f) => /\.(js|mjs)$/.test(f) && !f.startsWith('tests/') && !f.startsWith('tools/'));
  } catch {
    files = [];
  }
}
if (!files.length) {
  console.error('nothing to mutate — pass --file <path>, or have changes vs origin/main. --selftest needs neither.');
  process.exit(2);
}

/* REPORT PER FILE, AS IT COMPLETES — never buffer a long run to the end.
   The first version accumulated every result and printed once, so a 71-file sweep showed NOTHING for
   its entire duration and a kill (or a timeout) lost the lot. That is the same shape as a gate whose
   output you cannot see until it is too late to act on. `--json` now emits NDJSON: one compact object
   per line, per file, flushed as it lands — greppable, `jq`-able line by line, and whatever finished
   before an interrupt is still on disk. */
function reportOne(r) {
  if (AS_JSON) {
    process.stdout.write(JSON.stringify(r) + '\n');
    return;
  }
  if (r.error) {
    console.log('  ' + r.file + '\n    ⊘ ' + r.error + '\n');
    return;
  }
  const score = r.tested - r.invalid ? ((r.killed / (r.tested - r.invalid)) * 100).toFixed(0) : '—';
  console.log('  ' + r.file + '   groups: ' + r.groupsRun + ' (' + r.groupCount + ')');
  console.log('    generated ' + r.generated + ', tested ' + r.tested + ' → killed ' + r.killed + ', survived ' + r.survivors.length + ', invalid ' + r.invalid + '   [' + score + ' % killed]');
  for (const s of r.survivors.slice(0, 25)) console.log('      SURVIVED ' + r.file + ':' + s.line + '  [' + s.op + ']\n        ' + s.before + '\n        ' + s.after);
  if (r.survivors.length > 25) console.log('      … and ' + (r.survivors.length - 25) + ' more');
  console.log('');
}

if (!AS_JSON) console.log('MUTATION SWEEP — a surviving mutant means the suite cannot see a change there\n');
const results = [];
try {
  for (const f of files) {
    const r = await runFile(f);
    results.push(r);
    reportOne(r);
  }
} finally {
  dropPool();
}
/* A one-line roll-up at the end, so a sweep does not have to be re-aggregated by hand to answer the
   only question that spans files: how much of this codebase can the suite actually see? */
if (!AS_JSON) {
  const ok = results.filter((r) => !r.error);
  const k = ok.reduce((a, r) => a + r.killed, 0);
  const n = ok.reduce((a, r) => a + (r.tested - r.invalid), 0);
  const gen = ok.reduce((a, r) => a + r.generated, 0);
  console.log(
    '  ── ' +
      ok.length +
      ' file(s) measured, ' +
      (results.length - ok.length) +
      ' skipped ── ' +
      k +
      '/' +
      n +
      ' killed = ' +
      (n ? ((k / n) * 100).toFixed(0) : '—') +
      ' %  (of ' +
      gen +
      ' mutants that exist)'
  );
}
