#!/usr/bin/env node
/*
 * tools/killcheck.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * DID THE TEST I JUST WROTE ACTUALLY KILL ANYTHING? — measured, per function, in parallel.
 *
 * The loop this programme runs is: write a test → re-apply that function's recorded survivors → count
 * how many now fail. Doing it by hand costs ~4 s per mutant SERIALLY, so a 144-survivor function is
 * ten minutes per iteration and a function takes two or three iterations. Across the 499 functions in
 * `mutation-worklist` that is ~83 h of pure waiting.
 *
 * The mutants are INDEPENDENT — each is a separate file state and a separate test run — so this is the
 * one part of the loop that is embarrassingly parallel. At 16-way it is ~6 h instead of 83.
 *
 * ── WHY NOT JUST RE-SWEEP ────────────────────────────────────────────────────────────────────
 * A sweep re-runs the whole file (oxydex 88 min, integrator 13.8 h). This asks a much smaller
 * question — "of THESE n survivors, how many does my new test kill" — and answers it in seconds. The
 * sweep is still the source of truth and still has to run before a number is recorded; this is the
 * inner loop that makes iterating on a test bearable.
 *
 * ── TWO FAILURE MODES IT REFUSES TO HAVE ─────────────────────────────────────────────────────
 * 1. A RED BASELINE MAKES EVERY MUTANT LOOK KILLED. Measured, in this repo, on 2026-08-11: a single
 *    failing assertion in the group under test reported `killed=144, survived=0` — a perfect score
 *    from a broken test. So the baseline is run FIRST and a red one aborts.
 * 2. A WORKER THAT RESOLVES BACK TO THE REAL REPO MEASURES NOTHING, and looks perfect doing it.
 *    `run-tests.mjs` derives its ROOT from `import.meta.url`, so BOTH a symlinked `tests/` and an
 *    absolute path to the repo's own runner make a worker load the real, unmutated DSP. This tool hit
 *    that twice while being written, each time reporting `KILLED 0 of 144` in 3 s for a function
 *    already hand-measured at 80 — a clean-looking run that examined nothing. It is validated against
 *    that known answer, and anyone changing the worker setup should re-validate the same way.
 *
 * USAGE
 *   node tools/killcheck.mjs --file oxydex-dsp.js --fn parseJSONL --group "OxyDex parseJSONL"
 *   node tools/killcheck.mjs --file … --fn … --group … --jobs 16 --list
 *   node tools/killcheck.mjs --selftest
 * ══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFile, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const IS_MAIN = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/* Apply a recorded mutant to one line. `before`/`after` are TRUNCATED display fields (100 chars), so
   an exact match is tried first and a longest-prefix match is the fallback. Returns null when neither
   lands — a mutant that cannot be applied must be reported, never silently counted as survived. */
export function applyMutant(lines, m) {
  const i = m.line - 1;
  if (i < 0 || i >= lines.length) return null;
  const cur = lines[i];
  const b = String(m.before || '').trim();
  const a = String(m.after || '').trim();
  if (!b) return null;
  if (cur.includes(b)) {
    const out = lines.slice();
    out[i] = cur.replace(b, a);
    return out;
  }
  for (let L = b.length; L > 8; L--) {
    if (cur.includes(b.slice(0, L))) {
      const out = lines.slice();
      out[i] = cur.replace(b.slice(0, L), a.slice(0, L));
      return out;
    }
  }
  return null;
}

/* The enclosing range of `fn`, by brace counting — same method as probe-equivalence and
   mutation-worklist, so all three agree about what a function is. */
export function functionRange(src, name) {
  const lines = String(src || '').split('\n');
  const re = new RegExp('(?:^|[^\\w$.])function\\s+' + name.replace(/[$]/g, '\\$') + '\\s*\\(');
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue;
    let d = 0,
      seen = false;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') {
          d++;
          seen = true;
        } else if (ch === '}') {
          d--;
          if (seen && d === 0) return { start: i + 1, end: j + 1 };
        }
      }
    }
  }
  return null;
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
  const L = ['var a = 1;', 'if (x >= 3) go();', 'done();'];
  ok('an exact before/after is applied', applyMutant(L, { line: 2, before: 'if (x >= 3) go();', after: 'if (x > 3) go();' })[1] === 'if (x > 3) go();');
  ok('a TRUNCATED before still applies by prefix', applyMutant(L, { line: 2, before: 'if (x >= 3) go', after: 'if (x > 3) go' })[1] === 'if (x > 3) go();');
  ok('a non-matching mutant returns null, never a silent no-op', applyMutant(L, { line: 2, before: 'nothing like this at all', after: 'x' }) === null);
  ok('an out-of-range line returns null', applyMutant(L, { line: 99, before: 'a', after: 'b' }) === null);
  ok('an empty before returns null', applyMutant(L, { line: 1, before: '', after: 'x' }) === null);
  ok(
    'the original array is not mutated',
    (function () {
      const c = L.slice();
      applyMutant(L, { line: 1, before: 'var a = 1;', after: 'var a = 2;' });
      return L.join() === c.join();
    })()
  );

  const SRC = 'function outer() {\n  return 1;\n}\nfunction other() { return 2; }';
  ok('functionRange finds a multi-line function', JSON.stringify(functionRange(SRC, 'outer')) === '{"start":1,"end":3}', JSON.stringify(functionRange(SRC, 'outer')));
  ok('…and a one-liner', JSON.stringify(functionRange(SRC, 'other')) === '{"start":4,"end":4}', JSON.stringify(functionRange(SRC, 'other')));
  ok('an absent function is null', functionRange(SRC, 'nope') === null);

  console.log('\n' + (fail ? `✗ ${fail} failed, ${pass} passed` : `✓ all ${pass} selftests passed`));
  process.exit(fail ? 1 : 0);
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────
if (IS_MAIN && !has('--selftest')) {
  const file = opt('--file', '');
  const fn = opt('--fn', '');
  const group = opt('--group', '');
  const jobsWanted = Math.max(1, Number(opt('--jobs', String(Math.max(1, (await import('node:os')).cpus().length))) ) || 1);
  const sweep = opt('--sweep', '');
  if (!file || !fn || !group) {
    console.error('usage: node tools/killcheck.mjs --file <dsp.js> --fn <name> --group "<test group>" [--jobs N] [--sweep path]');
    process.exit(2);
  }
  const SWEEPS = (await import('./mutation-worklist.mjs')).SWEEPS;
  const sweepPath = sweep || SWEEPS[file];
  if (!sweepPath || !existsSync(sweepPath)) {
    console.error(`no sweep for ${file} (${sweepPath || 'unmapped'}) — a kill check needs the recorded survivor set`);
    process.exit(2);
  }
  const src = readFileSync(join(ROOT, file), 'utf8');
  const lines = src.split('\n');
  const r = functionRange(src, fn);
  if (!r) {
    console.error(`function ${fn} not found in ${file}`);
    process.exit(2);
  }
  const all = JSON.parse(readFileSync(sweepPath, 'utf8')).survivors || [];
  const mine = all.filter((m) => m.line >= r.start && m.line <= r.end);
  if (!mine.length) {
    console.log(`  ${fn}: no recorded survivors in L${r.start}-${r.end} — nothing to check`);
    process.exit(0);
  }

  /* Run the WORKER'S OWN runner, not the repo's. `run-tests.mjs` derives ROOT from
     `import.meta.url`, so invoking the real repo's copy loads the real, unmutated DSP no matter what
     `cwd` says — measured twice while building this: KILLED 0 of 144 on a function already known to
     convert 80, in 3 seconds. Both times the run looked perfect and examined nothing. */
  const run = (dir) =>
    new Promise((res) => {
      execFile(process.execPath, [join(dir, 'tests/run-tests.mjs'), '--group=' + group], { cwd: dir, timeout: 300000, maxBuffer: 1 << 24 }, (err, stdout) =>
        res({ ok: !err, out: String(stdout || '') })
      );
    });

  /* 1 · THE BASELINE FIRST. A red baseline reports a perfect score from a broken test, so it aborts
     rather than producing a number that reads like success. */
  const base = await run(ROOT);
  if (!base.ok) {
    console.error('✗ BASELINE IS RED — every mutant would read as killed. Fix the test first.\n');
    console.error(
      base.out
        .split('\n')
        .filter((l) => l.includes('✕'))
        .slice(0, 5)
        .join('\n')
    );
    process.exit(3);
  }
  const baseAsserts = (base.out.match(/all (\d+) assertions passed/) || [])[1] || '?';

  /* 2 · ONE PRIVATE CHECKOUT PER WORKER, VIA HARD LINKS — and the reason it cannot be symlinks.
     `run-tests.mjs` computes its own ROOT as `dirname(import.meta.url)/..`. If `tests/` is a SYMLINK
     back to the real repo, that resolves to the REAL root and the worker loads the REAL, unmutated
     DSP. Measured: the first version of this tool reported `KILLED 0, survived 144` on a function
     already hand-measured at 80 kills, and did it in 3 s — a perfect-looking run that examined
     nothing. Hard links give real files at near-zero cost, so ROOT lands inside the worker's tree;
     only `node_modules` is symlinked, since nothing resolves a module path through it. */
  /* CAP THE WORKERS AT THE MUTANT COUNT. Each worker costs a `cp -al` of the whole checkout, and
     measured on this machine the wall time PLATEAUS at ~16 because that setup — not the test runs —
     becomes the floor. Spinning up 24 trees to check 5 mutants is pure loss. */
  const jobs = Math.min(jobsWanted, mine.length);
  const tSetup = Date.now();
  const dirs = [];
  for (let w = 0; w < jobs; w++) {
    /* SAME FILESYSTEM AS THE REPO, or `cp -al` fails with "Invalid cross-device link": /tmp is
       tmpfs and the checkout is on another device. Sits OUTSIDE the repo so it can never be staged. */
    const d = mkdtempSync(join(dirname(ROOT), '.killcheck-'));
    execFileSync('cp', [
      '-al',
      '--',
      ...readdirSync(ROOT)
        .filter((e) => !['.git', 'node_modules', 'coverage', '.nyc_output'].includes(e))
        .map((e) => join(ROOT, e)),
      d
    ]);
    try {
      symlinkSync(join(ROOT, 'node_modules'), join(d, 'node_modules'));
    } catch (_) {
      /* absent node_modules is fine — the suite itself has no runtime deps */
    }
    dirs.push(d);
  }

  const setupSecs = (Date.now() - tSetup) / 1000;
  let killed = 0,
    survived = 0,
    unapplied = 0,
    next = 0;
  const survivorList = [];
  const worker = async (w) => {
    const d = dirs[w];
    for (;;) {
      const i = next++;
      if (i >= mine.length) return;
      const m = mine[i];
      const mutated = applyMutant(lines, m);
      if (!mutated) {
        unapplied++;
        continue;
      }
      /* UNLINK FIRST. The hard link shares an inode with the real repo, so writing through it would
         edit the repo itself — 16 workers corrupting the source they are testing. */
      try {
        rmSync(join(d, file), { force: true });
      } catch (_) {}
      writeFileSync(join(d, file), mutated.join('\n'));
      const res = await run(d);
      if (res.ok) {
        survived++;
        survivorList.push(m);
      } else killed++;
    }
  };
  const t0 = Date.now();
  await Promise.all(dirs.map((_, w) => worker(w)));
  const secs = (Date.now() - t0) / 1000;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });

  console.log(`\n▸ ${file} · ${fn}  L${r.start}-${r.end}   baseline green (${baseAsserts} assertions)`);
  console.log(`  KILLED ${killed}   survived ${survived}${unapplied ? `   ⚠ ${unapplied} could not be applied` : ''}   of ${mine.length}`);
  console.log(`  ${((100 * killed) / (mine.length - unapplied || 1)).toFixed(0)}% conversion · ${secs.toFixed(1)}s at ${jobs}-way + ${setupSecs.toFixed(1)}s setup (serial would be ~${((mine.length * 4) / 60).toFixed(0)} min)`);
  if (has('--list') && survivorList.length) {
    console.log('\n  still surviving:');
    for (const m of survivorList.slice(0, 40)) console.log(`    L${m.line} [${m.op}] ${String(m.before).trim().slice(0, 62)}`);
  }
}
