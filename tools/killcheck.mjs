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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';
import { escapeRe } from './regex-escape-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const IS_MAIN = isCliEntry(import.meta.url);

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

/* Exported so it can be pinned: the escaping bug it replaces was silent in both directions. */
export { escapeRe };

/* The enclosing range of `fn`, by brace counting — same method as probe-equivalence and
   mutation-worklist, so all three agree about what a function is. */
export function functionRangeAll(src, name) {
  const _hits = [];
  const lines = String(src || '').split('\n');
  /* ESCAPE EVERY REGEX METACHARACTER, not just `$`. The original escaped `$` alone — the one that
     actually occurs in this repo's identifiers — so it read as deliberate and was merely incomplete:
     a name containing `.` matches any character, and one containing `(` or `[` throws
     `SyntaxError: Invalid regular expression` from a tool whose whole job is to report a verdict.
     Neither failure is loud in the right place. Names come from a generated work list rather than
     from a user, so this is correctness rather than a security boundary, but the fix is the same
     three characters wider. */
  /* §8: arrow consts included — mirrors probe-equivalence so the three copies keep agreeing. */
  const re = new RegExp('(?:^|[^\\w$.])(?:function\\s+' + escapeRe(name) + '\\s*\\(|(?:const|let|var)\\s+' + escapeRe(name) + '\\s*=\\s*(?:async\\s*)?(?:function\\b|\\(|[\\w$]+\\s*=>))');
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue;
    if (/=>\s*[^\s{]/.test(lines[i])) {
      _hits.push({ start: i + 1, end: i + 1 }); // concise arrow: its own line
      continue;
    }
    let d = 0,
      seen = false;
    let done = false;
    for (let j = i; j < lines.length && !done; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') {
          d++;
          seen = true;
        } else if (ch === '}') {
          d--;
          if (seen && d === 0) {
            _hits.push({ start: i + 1, end: j + 1 });
            done = true;
            break;
          }
        }
      }
    }
  }
  return _hits;
}

/* 🔴 AMBIGUITY IS A REFUSAL, NOT A COIN FLIP (MUTATION-PROGRAM-FOLLOWUPS §10.5).
   The previous body returned the FIRST match and said nothing. §10.5 records what that costs: a
   harness "mutated `computeRMSSDarc` and reported the result under the name of a function it had
   never touched", and calls that the THIRD instance of the class — the brief's own remedy is that a
   locating tool must "fail loudly when the pattern is absent or ambiguous", printing a `hits > 1`
   count.

   ⚠️ THIS IS NOT HYPOTHETICAL IN THIS TREE. `oxydex-dsp.js` defines `_median` TWICE — line 1900 and
   line 7168, in different scopes, WITH DIFFERENT BODIES (the second returns null on an empty array,
   the first does not). Every tool that scoped to `_median` silently measured the first and reported
   under the bare name. Whoever meant the other one got a verdict about code they never touched.

   Absent still returns null: "no such function" is an answer a caller can act on. Ambiguous cannot
   be — there is no correct single range to return, so returning one is the bug. */
export function functionRange(src, name) {
  const hits = functionRangeAll(src, name);
  if (hits.length > 1) {
    throw new Error(
      `functionRange: ${JSON.stringify(name)} is AMBIGUOUS — ${hits.length} definitions at lines ` +
        `${hits.map((h) => h.start).join(', ')}. Scoping to one of them requires saying which; ` +
        `returning the first silently reports a verdict about a function the caller may not mean.`
    );
  }
  return hits[0] || null;
}

/* ── A BASELINE THAT NEVER RAN IS NOT A RED BASELINE ─────────────────────────────────────────────
   `run-tests.mjs` exits 1 for a failing suite and 2 for every refusal BEFORE any group runs — a
   filter matching zero groups, a bad `--jobs`, a shard wider than the group count. Keeping only
   `ok: !err` over that child read both as "the baseline is red", so one mistyped `--group` sent the
   operator to fix a test that never ran (residue
   `2026-11-02-killcheck-reads-an-unmatched-filter-as-a-red-baseline`).

   THE EXIT CODE DISCRIMINATES, NOT THE MESSAGE. This repo spends exit 2 on "I could not look"
   everywhere, while the wording of any one refusal moves the day someone rewords it. The phrase is
   read only to name WHICH refusal happened, so its absence narrows the class rather than widening
   it. A killed child reports a signal and no code, and a death is its own reason (§∅) — never a
   verdict about the test. */
export function baselineDiagnosis({ code = null, signal = null, out = '' } = {}) {
  if (signal) return { status: 'could-not-run', zeroMatch: false, reason: `the runner died on ${signal}, so the baseline examined nothing`, exit: 2 };
  if (code === 0) return { status: 'green', zeroMatch: false, reason: null, exit: 0 };
  if (code === 1) return { status: 'red', zeroMatch: false, reason: 'the baseline suite failed, so every mutant would read as killed', exit: 3 };
  if (code === 2) {
    const zeroMatch = /matched ZERO groups|selected ZERO groups/.test(String(out));
    return {
      status: 'examined-nothing',
      zeroMatch,
      reason: zeroMatch ? 'the group filter matched no group, so the baseline examined nothing' : 'the runner refused its arguments, so the baseline examined nothing',
      exit: 2
    };
  }
  return { status: 'could-not-run', zeroMatch: false, reason: `the runner exited ${code === null ? 'with no code' : code}, so the baseline examined nothing`, exit: 2 };
}

/* The operator-facing half, kept pure so a selftest reads the words an operator will read. A refusal
   quotes the group it passed: the measured cost of the defect was a hunt through a test that is fine. */
export function baselineMessage(d, { group = '' } = {}) {
  if (!d || d.status === 'green') return '';
  if (d.status === 'red') return '✗ BASELINE IS RED — every mutant would read as killed. Fix the test first.';
  const tail = '\n  Nothing about the test is known yet, so this is NOT a red baseline.';
  if (d.zeroMatch) {
    return (
      `⏱ BASELINE UNEXAMINED — ${d.reason}` +
      `\n  --group ${JSON.stringify(group)} selected no group. Each term compiles as a regex, so a title carrying` +
      '\n  parens, a plus or a dot stops matching itself. `node tests/run-tests.mjs --list` names every group.' +
      tail
    );
  }
  return `⏱ BASELINE UNEXAMINED — ${d.reason}` + tail;
}

/* ── AND A MUTANT RUN THAT NEVER RAN IS NOT A KILL ───────────────────────────────────────────────
   The same `ok: !err` sat over every mutant child, where it reads the other way round: a refusal or
   a timeout counts as a KILL and inflates the conversion. The 300 s cap makes this reachable on any
   loaded box — the child dies on SIGTERM with no code, which says nothing about whether the test
   notices the mutant. An undecided mutant stays undecided; no bound converts one into a kill.

   The capture-host gate reached this rule first and states it as `TRUSTED_KILL_EXIT = 1`
   (`capture-host/mutation_diff.py`, `kill_is_a_detection`): a kill is read from the RAW exit code,
   because a reaped worker or an OOM lands on an exit that is not the suite's own failure. `mutate.mjs`
   spends the same coin from the other side, where a VOID mutant leaves the denominator rather than
   joining a bucket. This is that rule in the inner loop. */
export function mutantOutcome({ code = null, signal = null, out = '' } = {}) {
  if (signal) return { outcome: 'undecided', reason: `the run died on ${signal}` };
  if (code === 0) return { outcome: 'survived', reason: null };
  if (code === 1) return { outcome: 'killed', reason: null };
  if (code === 2)
    return { outcome: 'undecided', reason: /matched ZERO groups|selected ZERO groups/.test(String(out)) ? 'the group filter matched no group in the worker tree' : 'the runner refused its arguments' };
  return { outcome: 'undecided', reason: `the runner exited ${code === null ? 'with no code' : code}` };
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

  /* ── REGEX ESCAPING, pinned. CodeQL flagged the old `$`-only escape as incomplete and as a regex
     injection; both failures were silent in the place a reader would look. */
  ok(
    'a metacharacter name does not THROW — the old escape raised SyntaxError',
    (() => {
      try {
        functionRange(SRC, 'a(b');
        return true;
      } catch (_) {
        return false;
      }
    })()
  );
  ok(
    '…nor does a bracket',
    (() => {
      try {
        functionRange(SRC, 'a[b');
        return true;
      } catch (_) {
        return false;
      }
    })()
  );
  /* The quiet half: `.` matched ANY character, so a wrong function could be measured and reported
     with full confidence. `outer` must not be found by a pattern spelled `oute.`. */
  ok('a `.` in the name is LITERAL — it must not match `outer`', functionRange(SRC, 'oute.') === null);
  ok('…and `o*ter` matches nothing rather than everything', functionRange(SRC, 'o*ter') === null);
  ok('escapeRe leaves a plain identifier alone', escapeRe('parseJSONL') === 'parseJSONL');
  ok('escapeRe still escapes `$`, the one that occurs here', escapeRe('_$scope') === '_\\$scope', escapeRe('_$scope'));
  ok(
    '§8: an arrow const resolves',
    JSON.stringify(functionRange('const q = (a) => {\n  return a;\n};', 'q')) === JSON.stringify({ start: 1, end: 3 }),
    JSON.stringify(functionRange('const q = (a) => {\n  return a;\n};', 'q'))
  );
  ok('§8: a concise arrow is its own line', JSON.stringify(functionRange('const c = () => 5;', 'c')) === JSON.stringify({ start: 1, end: 1 }));

  // §10.5 AMBIGUITY IS A REFUSAL — and it shipped with no control. Disabling the `_decls.length > 1`
  // throw left every other selftest passing, which is precisely how a loud-failure guard rots back into
  // a silent first-match. The whole point of §10.5 is that a locating tool must not GUESS which
  // definition you meant; a guard nothing exercises is a comment.
  const DUPSRC = ['function dup(a) {', '  return a;', '}', 'function other() {}', 'function dup(a, b) {', '  return a + b;', '}'].join('\n');
  let threw = null;
  try {
    functionRange(DUPSRC, 'dup');
  } catch (e) {
    threw = e.message;
  }
  ok('a DUPLICATED function name REFUSES rather than silently taking the first', threw !== null && /AMBIGUOUS/.test(threw), String(threw));
  ok('…and the refusal names how many it found, so the caller can see the collision', threw !== null && /2 declarations|2 definitions/.test(threw), String(threw));
  ok('an UNambiguous name is unaffected by the duplicate guard', functionRange(DUPSRC, 'other') !== null, JSON.stringify(functionRange(DUPSRC, 'other')));

  /* ── A BASELINE THAT NEVER RAN, AND A MUTANT RUN THAT NEVER RAN ───────────────────────────────
     Both were `ok: !err`, and the one predicate pointed the wrong way at each site: a refusal read
     as a red baseline at the first and as a KILL at the second. The legs below pin the exit code as
     the discriminator, and the anti-vacuity legs pin what must NOT happen — a reword of either
     refusal message leaves them standing. */
  const BG = baselineDiagnosis({ code: 0, out: 'all 120 assertions passed' });
  ok('a green baseline reads green', BG.status === 'green' && BG.exit === 0, JSON.stringify(BG));
  ok('…and prints nothing', baselineMessage(BG, { group: 'g' }) === '');
  const BR = baselineDiagnosis({ code: 1, out: '  ✕ one assertion' });
  ok('a FAILING suite still reads red and still exits 3', BR.status === 'red' && BR.exit === 3, JSON.stringify(BR));
  const BZ = baselineDiagnosis({ code: 2, out: '  ✗ filter matched ZERO groups — check the pattern' });
  ok('an unmatched --group filter does NOT read as a red baseline', BZ.status !== 'red', JSON.stringify(BZ));
  ok('…it reports that nothing was examined, and exits 2 like every refusal here', BZ.status === 'examined-nothing' && BZ.exit === 2, JSON.stringify(BZ));
  ok('…and its message quotes the group that matched nothing', /"OxyDex nope"/.test(baselineMessage(BZ, { group: 'OxyDex nope' })), baselineMessage(BZ, { group: 'OxyDex nope' }).split('\n')[1] || '');
  ok('…and says in words that this is not a red baseline', /NOT a red baseline/.test(baselineMessage(BZ, { group: 'g' })));
  const BA = baselineDiagnosis({ code: 2, out: '✗ bad --jobs "x" — want a positive integer' });
  ok('a code-2 refusal with no ZERO-groups line still examined nothing', BA.status === 'examined-nothing' && BA.exit === 2, JSON.stringify(BA));
  ok('…and its message does NOT blame the filter it cannot know about', !/selected no group/.test(baselineMessage(BA, { group: 'g' })), baselineMessage(BA, { group: 'g' }));
  const BK = baselineDiagnosis({ code: null, signal: 'SIGTERM', out: '' });
  ok('a baseline child killed by a signal examined nothing', BK.status === 'could-not-run' && BK.exit === 2, JSON.stringify(BK));
  ok('…and the reason names the signal rather than the test', /SIGTERM/.test(String(BK.reason)) && !/failed/.test(String(BK.reason)), String(BK.reason));
  ok('an unknown exit code examines nothing rather than deciding', baselineDiagnosis({ code: 7, out: '' }).exit === 2, JSON.stringify(baselineDiagnosis({ code: 7, out: '' })));
  ok('ONLY exit 1 reaches exit 3 — the three outcomes keep three exits', [0, 1, 2, 7].map((c) => baselineDiagnosis({ code: c, out: '' }).exit).join() === '0,3,2,2');
  ok('an absent child object examines nothing, never green', baselineDiagnosis({}).exit === 2 && baselineDiagnosis({}).status === 'could-not-run');

  ok('a mutant whose suite passes SURVIVED', mutantOutcome({ code: 0, out: '' }).outcome === 'survived');
  ok('a mutant whose suite fails is KILLED', mutantOutcome({ code: 1, out: '' }).outcome === 'killed');
  ok(
    'a mutant run killed by the 300 s cap is UNDECIDED, never a kill',
    mutantOutcome({ code: null, signal: 'SIGTERM', out: '' }).outcome === 'undecided',
    JSON.stringify(mutantOutcome({ code: null, signal: 'SIGTERM', out: '' }))
  );
  ok('…and it carries the reason the run gave', /SIGTERM/.test(String(mutantOutcome({ code: null, signal: 'SIGTERM', out: '' }).reason)));
  ok('a runner refusal under a mutant is UNDECIDED', mutantOutcome({ code: 2, out: '✗ filter matched ZERO groups' }).outcome === 'undecided');
  ok('…naming the filter when the runner named it', /filter matched no group/.test(String(mutantOutcome({ code: 2, out: '✗ filter matched ZERO groups' }).reason)));
  ok('an unknown exit is UNDECIDED, so no unexamined run joins the conversion', mutantOutcome({ code: 9, out: '' }).outcome === 'undecided');
  ok(
    'NOTHING but exit 1 is a kill',
    [0, 2, 7, 9, null].every((c) => mutantOutcome({ code: c, out: '' }).outcome !== 'killed')
  );

  console.log('\n' + (fail ? `✗ ${fail} failed, ${pass} passed` : `✓ all ${pass} selftests passed`));
  process.exit(fail ? 1 : 0);
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────
if (IS_MAIN && !has('--selftest')) {
  const file = opt('--file', '');
  const fn = opt('--fn', '');
  const group = opt('--group', '');
  const jobsWanted = Math.max(1, Number(opt('--jobs', String(Math.max(1, (await import('node:os')).cpus().length)))) || 1);
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
  /* An ambiguous name is a REFUSAL with a message, not a stack trace. The distinction matters at a
     CLI boundary: a traceback reads as "the tool is broken" and gets retried, while a named refusal
     reads as "say which one" and gets acted on. Same exit code as not-found — both mean this run
     produced no verdict, which is the thing a caller must not mistake for a passing one. */
  let r;
  try {
    r = functionRange(src, fn);
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(2);
  }
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
        res({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : null) : 0, signal: (err && err.signal) || null, out: String(stdout || '') })
      );
    });

  /* 1 · THE BASELINE FIRST. A red baseline reports a perfect score from a broken test, so it aborts
     rather than producing a number that reads like success. */
  const base = await run(ROOT);
  const diag = baselineDiagnosis(base);
  if (diag.status !== 'green') {
    console.error(baselineMessage(diag, { group }) + '\n');
    if (diag.status === 'red')
      console.error(
        base.out
          .split('\n')
          .filter((l) => l.includes('✕'))
          .slice(0, 5)
          .join('\n')
      );
    process.exit(diag.exit);
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
    undecided = 0,
    next = 0;
  const survivorList = [];
  const undecidedList = [];
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
      const o = mutantOutcome(res);
      if (o.outcome === 'survived') {
        survived++;
        survivorList.push(m);
      } else if (o.outcome === 'killed') killed++;
      else {
        undecided++;
        undecidedList.push({ line: m.line, reason: o.reason });
      }
    }
  };
  const t0 = Date.now();
  await Promise.all(dirs.map((_, w) => worker(w)));
  const secs = (Date.now() - t0) / 1000;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });

  console.log(`\n▸ ${file} · ${fn}  L${r.start}-${r.end}   baseline green (${baseAsserts} assertions)`);
  console.log(
    `  KILLED ${killed}   survived ${survived}${unapplied ? `   ⚠ ${unapplied} could not be applied` : ''}${undecided ? `   ⏱ ${undecided} UNDECIDED (the run examined nothing — not a kill)` : ''}   of ${mine.length}`
  );
  /* THE DENOMINATOR IS WHAT WAS DECIDED. An unapplied mutant and an undecided run both leave the
     conversion unmeasured for that mutant, so neither sits in it, and the line says which count it
     divided by rather than leaving the reader to assume `mine.length`. */
  const decided = killed + survived;
  console.log(
    `  ${((100 * killed) / (decided || 1)).toFixed(0)}% conversion of the ${decided} decided · ${secs.toFixed(1)}s at ${jobs}-way + ${setupSecs.toFixed(1)}s setup (serial would be ~${((mine.length * 4) / 60).toFixed(0)} min)`
  );
  if (undecidedList.length) {
    console.log('\n  undecided, with the reason each run gave:');
    for (const u of undecidedList.slice(0, 10)) console.log(`    L${u.line} — ${u.reason}`);
  }
  if (has('--list') && survivorList.length) {
    console.log('\n  still surviving:');
    for (const m of survivorList.slice(0, 40)) console.log(`    L${m.line} [${m.op}] ${String(m.before).trim().slice(0, 62)}`);
  }
}
