#!/usr/bin/env node
/*
 * tools/extreme-mutate.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * PSEUDO-TESTED FUNCTIONS — delete the whole body and see whether anything notices.
 *
 * EXTREME MUTATION (Descartes, Niedermayr et al.; see the STAMP tool and the industrial study in
 * arXiv:2103.08480). Instead of ~12 operator mutants per function, ONE mutant per function: empty its
 * body. A function that survives that is PSEUDO-TESTED — the suite runs it and asserts nothing about
 * what it returns. Not "weakly tested". Not tested at all, in the only sense that matters.
 *
 * ── WHY IT FITS THIS FLEET EXACTLY ───────────────────────────────────────────────────────────
 * The JS suite has 77.3 % branch coverage and kills 38.5 % of mutants. That gap IS pseudo-testing:
 * code executed, results unchecked. Every finding in MUTATION-PROGRAM is an instance —
 * `applySessionCorrections` offsets too small to separate an operand swap, `beatRegularity` never
 * scoring below 1.0, cpapdex `selfTest` asserting `fail === 0` while its own assertion count fell.
 *
 * ── WHAT IT IS FOR, AND WHAT IT IS NOT ───────────────────────────────────────────────────────
 * It is a TRIAGE signal, not a replacement metric. The 99 % target is defined over operator mutants
 * and this does not measure that. What it does is RANK: a function whose body can be deleted outright
 * is strictly worse than one with fifty surviving operator mutants, and the survivor count cannot
 * tell you which is which. The published correlation with traditional scores is moderate — Spearman
 * ~0.6 — so it orders the queue; it does not substitute for the sweep.
 *
 * Cost: ~1 mutant per function against ~12, so a file is triaged in a fraction of a sweep.
 *
 * ⚠️ AN EMPTIED BODY THAT BREAKS THE SUITE IS NOT A PASS. A function whose removal makes the whole
 * group throw counts as KILLED here, exactly as in a normal sweep — the tests noticed. What this
 * hunts is the silent case: everything green, function gone.
 *
 * USAGE
 *   node tools/extreme-mutate.mjs --file oxydex-dsp.js --group oxydex-dsp
 *   node tools/extreme-mutate.mjs --file glucodex-dsp.js --group glucodex-dsp --jobs 16 --json
 *   node tools/extreme-mutate.mjs --selftest
 * ══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripNonCode } from './probe-equivalence.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const IS_MAIN = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/* Every `function NAME(...) { … }` with the exact character offsets of its body braces. Offsets, not
   line numbers, because the body is replaced textually and a line-based splice would corrupt a
   one-line function. Brace counting matches the rest of the toolchain, so all four tools agree on
   what a function is. */
export function functionBodies(src) {
  const s = String(src || '');
  /* ⚠️ BRACE-COUNT ON THE MASKED COPY, SPLICE THE ORIGINAL. Counting braces in raw source is wrong
     and produces CORRUPT output: a `}` inside a string, comment or regex ends the body early. Proven
     on `function f(a) { var s = "}"; return a + 1; }` — the first version cut at the quoted brace and
     emitted source that does not parse.

     That failure is quiet in the worst way: a file that will not parse fails the suite, which this
     tool reads as "the tests noticed", so a mis-bounded function is silently recorded as TESTED. It
     under-reports rather than over-reports, which is why the earlier fleet numbers were sound but
     incomplete.

     `stripNonCode` (probe-equivalence) blanks strings/comments/regexes IN PLACE, preserving every
     offset and newline — so positions found in the mask address the original exactly. Reused rather
     than reimplemented; it is already selftested there, and this file had no business owning a third
     copy of that logic. */
  const mask = stripNonCode(s);
  const out = [];
  const re = /(?:^|[^\w$.])function\s+(\w+)\s*\(/g;
  let m;
  while ((m = re.exec(mask))) {
    const open = mask.indexOf('{', re.lastIndex);
    if (open < 0) continue;
    let d = 0;
    for (let j = open; j < mask.length; j++) {
      const ch = mask[j];
      if (ch === '{') d++;
      else if (ch === '}') {
        d--;
        if (d === 0) {
          out.push({ fn: m[1], open, close: j, line: s.slice(0, m.index).split('\n').length });
          break;
        }
      }
    }
  }
  return out;
}

/* Replace ONE function's body with an empty one. Returns null when the body is already empty — an
   empty function cannot be emptied, and reporting it as "survived" would be a free false positive on
   every no-op stub in the file. */
/* ── THE DESCARTES OPERATOR SET ──────────────────────────────────────────────────────────────
   Descartes' DEFAULT_MUTATION_OPERATORS: void, null, empty, true, false, 0, 1, "" plus typed
   variants. JS has no static types, so every operator is APPLICABLE to every function and the tests
   decide — a `return []` on a function whose caller does arithmetic simply gets noticed.

   ⚠️ THE VERDICT RULE IS NOT "the empty body survived". Descartes' MethodClassification: a function is
   PSEUDO-TESTED iff EVERY applicable extreme mutant survives; if some survive and some are killed it
   is PARTIALLY-TESTED. The first version of this tool used the empty body alone and called that
   pseudo-tested, which OVER-REPORTS — a function whose body can be emptied unnoticed but whose
   `return 1` is caught does have some assertion behind it. */
export const EXTREME_OPS = [
  { name: 'empty', body: '' },
  { name: 'return null', body: ' return null; ' },
  { name: 'return 0', body: ' return 0; ' },
  { name: 'return 1', body: ' return 1; ' },
  { name: "return ''", body: " return ''; " },
  { name: 'return true', body: ' return true; ' },
  { name: 'return false', body: ' return false; ' },
  { name: 'return []', body: ' return []; ' }
];

/* Replace a function's body with an arbitrary replacement. */
export function replaceBody(src, b, replacement) {
  const inner = stripNonCode(src).slice(b.open + 1, b.close);
  if (!inner.trim()) return null; // nothing to replace — see emptyBody
  return src.slice(0, b.open + 1) + replacement + src.slice(b.close);
}

/* Descartes' classification from a set of per-operator verdicts.
   PURE, because it is the whole point of the change and must be pinned. */
/* ── THE COVERAGE LEG, which this tool was missing entirely ──────────────────────────────────
   Descartes' rule has TWO conditions: a function is pseudo-tested iff it is COVERED **and** every
   applicable extreme mutant survives. A function no test ever calls has all its mutants survive
   TRIVIALLY — that is NOT-COVERED, a different and much cheaper finding.

   Measured on hrvdex-dsp.js, 2026-08-11: of 18 functions this tool called pseudo-tested, SIXTEEN were
   never executed at all. The honest rate was 2/37 = 5.4 %, not 48.6 %. Every "outlier" the earlier
   runs reported was mostly this.

   It also dissolves an apparent corroboration. c8 reporting hrvdex as the fleet's least-executed file
   looked like a second instrument confirming pseudo-testedness. It was the SAME FACT — "these
   functions are not executed" — read twice, and counting it as independent support was wrong.

   Coverage is per-function from c8's Istanbul-shaped report, and it is scoped to THE GROUP UNDER
   TEST: a function covered only by some other group is not reachable by this run's mutants either, so
   the two must use the same filter or the classification is incoherent. */
export function classifyDescartes(verdicts, executions) {
  if (!(executions > 0)) return 'not-covered';
  return classifyExtreme(verdicts);
}

export function classifyExtreme(verdicts) {
  const v = verdicts.filter((x) => x !== undefined);
  if (!v.length) return 'not-applicable';
  if (v.every((x) => x === 'survived')) return 'pseudo-tested';
  if (v.every((x) => x === 'killed')) return 'tested';
  return 'partially-tested';
}

export function emptyBody(src, b) {
  /* Emptiness is judged on the masked text: a body containing only comments has no behaviour to
     delete, so emptying it is a guaranteed survivor and a free false positive. */
  const inner = stripNonCode(src).slice(b.open + 1, b.close);
  if (!inner.trim()) return null;
  return src.slice(0, b.open + 1) + src.slice(b.close);
}

// ── selftest ────────────────────────────────────────────────────────────────────────────────
if (IS_MAIN && has('--selftest')) {
  let pass = 0,
    fail = 0;
  /* TWO helpers, deliberately. The first version had only a boolean `ok(name, cond, detail)` and I
     called it as `ok(name, actual, expected)` — so `ok('…', 'a,b,noop', 'a,b,noop')` passed for ANY
     non-empty string, and two real assertions ("returns null", "length 0") FAILED because null and 0
     are falsy. Three vacuous passes and two false failures from one overloaded helper. */
  const ok = (n, c, d) => {
    if (c) {
      pass++;
      console.log('  ✓ ' + n + (d ? '  — ' + d : ''));
    } else {
      fail++;
      console.log('  ✗ ' + n + (d ? '  — ' + d : ''));
    }
  };
  const eq = (n, actual, expected) => {
    const a = typeof actual === 'object' ? JSON.stringify(actual) : String(actual);
    const e = typeof expected === 'object' ? JSON.stringify(expected) : String(expected);
    if (a === e) {
      pass++;
      console.log('  ✓ ' + n);
    } else {
      fail++;
      console.log('  ✗ ' + n + '  — got ' + a + ' · want ' + e);
    }
  };
  const SRC = ['function a(x) {', '  if (x) { return 1; }', '  return 2;', '}', 'function b() { return 3; }', 'function noop() {}'].join('\n');
  const B = functionBodies(SRC);
  eq('every declaration is found', B.map((x) => x.fn).join(','), 'a,b,noop');
  eq('…with its line number', B[0].line, 1);
  const ea = emptyBody(SRC, B[0]);
  ok('a multi-line body is emptied', ea.includes('function a(x) {}'), JSON.stringify(ea.split('\n')[0]));
  ok('…and the REST of the file is untouched', ea.includes('function b() { return 3; }'));
  ok('a one-line body is emptied without corrupting the line', emptyBody(SRC, B[1]).includes('function b() {}'));
  /* An already-empty body must be SKIPPED, not reported. Emptying it changes nothing, so it would
     survive every run and read as a pseudo-tested function that is merely a stub. */
  eq('an ALREADY-EMPTY body returns null rather than a free false positive', emptyBody(SRC, B[2]), null);
  ok('a nested brace does not end the body early', functionBodies(SRC)[0].close > SRC.indexOf('return 2;'));
  ok(
    'the emptied source still parses',
    (function () {
      try {
        new Function(ea);
        return true;
      } catch (_) {
        return false;
      }
    })()
  );
  eq('no functions in an empty source', functionBodies('').length, 0);
  eq('…nor in a source with no function declarations', functionBodies('const f = (a) => a + 1;').length, 0);
  /* The arrow-const limitation, stated as a test so it cannot be forgotten: `const f = () => {}` is
     invisible to this tool, exactly as it is to probe-coverage's functionRange. */
  eq('an ARROW CONST is not found — a known, shared limitation', functionBodies('const rmssd = (a) => { return a; };').length, 0);

  console.log('\n' + (fail ? `✗ ${fail} failed, ${pass} passed` : `✓ all ${pass} selftests passed`));
  process.exit(fail ? 1 : 0);
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────
if (IS_MAIN && !has('--selftest')) {
  const file = opt('--file', '');
  const group = opt('--group', '');
  const jobsWanted = Math.max(1, Number(opt('--jobs', String((await import('node:os')).cpus().length))) || 1);
  if (!file || !group) {
    console.error('usage: node tools/extreme-mutate.mjs --file <dsp.js> --group <test group filter> [--jobs N] [--json]');
    process.exit(2);
  }
  const src = readFileSync(join(ROOT, file), 'utf8');
  const bodies = functionBodies(src).filter((b) => emptyBody(src, b) !== null);
  if (!bodies.length) {
    console.error('no non-empty function bodies found in ' + file);
    process.exit(2);
  }

  const run = (dir) =>
    new Promise((res) => {
      execFile(process.execPath, [join(dir, 'tests/run-tests.mjs'), '--group=' + group], { cwd: dir, timeout: 600000, maxBuffer: 1 << 24 }, (err, stdout) =>
        res({ ok: !err, out: String(stdout || '') })
      );
    });

  /* The baseline first: a red suite makes every emptied body look "noticed" and the whole run reads
     as a clean bill of health. Same refusal as killcheck. */
  const base = await run(ROOT);
  if (!base.ok) {
    console.error('✗ BASELINE IS RED — every function would read as tested. Fix the suite first.');
    process.exit(3);
  }

  /* ── THE CANARY ──────────────────────────────────────────────────────────────────────────────
     A green baseline proves the suite PASSES. It does not prove a mutation is DETECTED, and those are
     different claims. The failure this guards is specific and has already happened twice in this
     toolchain: a worker that resolves back to the real repo runs the UNMUTATED file, every mutant
     "survives", and the tool reports EVERY FUNCTION PSEUDO-TESTED — which reads as a dramatic finding
     rather than as a broken instrument.

     So one function known to be NOTICED is emptied first and must still be noticed. It is learned on
     the first run (the first noticed function) and re-verified on every run after, exactly as
     mutate.mjs's canary works. A canary that survives VOIDS the run rather than degrading it: a
     number produced under that doubt is not evidence. */
  const CANARY_FILE = join(ROOT, 'tools/extreme-canaries.json');
  let canaries = {};
  try {
    canaries = JSON.parse(readFileSync(CANARY_FILE, 'utf8'));
  } catch (_) {
    /* absent on the first ever run — it is learned below */
  }
  const canaryName = canaries[file];
  let canaryState = 'NONE';
  if (canaryName) {
    const cb = bodies.find((b) => b.fn === canaryName);
    if (!cb) {
      console.error(`✗ CANARY GONE — ${canaryName} is no longer a function in ${file}. Delete its entry from tools/extreme-canaries.json deliberately, or fix the name.`);
      process.exit(3);
    }
    const d = mkdtempSync(join(dirname(ROOT), '.extreme-canary-'));
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
    } catch (_) {}
    rmSync(join(d, file), { force: true });
    writeFileSync(join(d, file), replaceBody(src, cb, EXTREME_OPS[0].body));
    const cr = await run(d);
    rmSync(d, { recursive: true, force: true });
    canaryState = cr.ok ? 'FAILED' : 'PASSED';
    if (canaryState === 'FAILED') {
      console.error(`✗ CANARY FAILED — emptying ${canaryName} was NOT noticed by the suite.`);
      console.error('  The harness is not detecting mutations, so every "pseudo-tested" verdict this run');
      console.error('  would produce is meaningless. Refusing to report a number. (Check that workers run');
      console.error('  their OWN tests/run-tests.mjs — resolving back to the repo is how this breaks.)');
      process.exit(3);
    }
    process.stderr.write(`  canary PASSED — emptying ${canaryName} is noticed, so the harness detects mutations\n`);
  }

  /* ── PER-FUNCTION COVERAGE, same group filter as the mutants ────────────────────────────────
     Without this the tool cannot tell "nothing asserts on it" from "nothing calls it", and the second
     is both far more common and a different problem. Collected once, from c8's Istanbul-shaped
     report, before any mutant runs. */
  const covDir = join(dirname(ROOT), '.extreme-cov-' + process.pid);
  const executions = new Map();
  let coverageOK = false;
  try {
    execFileSync(
      process.execPath,
      [
        join(ROOT, 'node_modules/.bin/c8'),
        '--reporter=json',
        '--report-dir=' + covDir,
        '--exclude=tests/**',
        '--exclude=tools/**',
        process.execPath,
        join(ROOT, 'tests/run-tests.mjs'),
        '--group=' + group
      ],
      { cwd: ROOT, stdio: 'ignore', timeout: 600000 }
    );
  } catch (_) {
    /* fall through — handled below */
  }
  try {
    const rep = JSON.parse(readFileSync(join(covDir, 'coverage-final.json'), 'utf8'));
    const key = Object.keys(rep).find((k) => k.endsWith('/' + file) || k.endsWith('\\' + file));
    if (key) {
      const e = rep[key];
      for (const [fid, meta] of Object.entries(e.fnMap || {})) executions.set(meta.name, e.f[fid] || 0);
      coverageOK = executions.size > 0;
    }
    rmSync(covDir, { recursive: true, force: true });
  } catch (_) {
    rmSync(covDir, { recursive: true, force: true });
  }
  if (!coverageOK) {
    /* FAIL CLOSED. Without coverage every uncovered function would be reported as pseudo-tested — the
       exact conflation this leg exists to prevent, and it inflated hrvdex from 5.4 % to 48.6 %. */
    console.error('✗ NO PER-FUNCTION COVERAGE for ' + file + ' — refusing to classify.');
    console.error('  Without it, "nothing calls this" is indistinguishable from "nothing asserts on this",');
    console.error('  and the first is far more common. Check that npx c8 runs and that the group filter is right.');
    process.exit(3);
  }
  process.stderr.write('  coverage: ' + [...executions.values()].filter((n) => n > 0).length + '/' + executions.size + ' functions executed by --group=' + group + '\n');

  const jobs = Math.min(jobsWanted, bodies.length);
  const dirs = [];
  for (let w = 0; w < jobs; w++) {
    /* Hard links, beside the repo, invoking the worker's OWN runner — `run-tests.mjs` derives its
       root from import.meta.url, so a symlinked tree or the repo's own runner silently tests the
       UNMUTATED file. That cost two false clean runs while killcheck was being built. */
    const d = mkdtempSync(join(dirname(ROOT), '.extreme-'));
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
    } catch (_) {}
    dirs.push(d);
  }

  const pseudo = [];
  const partial = [];
  const uncovered = [];
  let noticed = 0,
    next = 0,
    mutantsRun = 0;
  const FULL = has('--classify');
  const t0 = Date.now();
  const worker = async (w) => {
    const d = dirs[w];
    for (;;) {
      const i = next++;
      if (i >= bodies.length) return;
      const b = bodies[i];
      /* EVERY operator, per Descartes — but SHORT-CIRCUIT on the first kill unless --classify.
         One killed operator already proves the function is not pseudo-tested, and most functions are
         killed by the first, so the average cost stays near 1 mutant rather than 8. The price: a
         short-circuited function reports as "noticed" without separating PARTIALLY-tested from fully
         tested. --classify runs the whole set and splits them. */
      /* An UNCOVERED function needs no mutants at all: every one of them would survive trivially, so
         running eight is pure cost for a verdict already determined. */
      if (!(executions.get(b.fn) > 0)) {
        uncovered.push(b);
        if (!has('--json')) process.stderr.write('  ∅ not-covered   ' + b.fn.padEnd(28) + ' L' + b.line + '  — no test in this group calls it\n');
        continue;
      }
      const verdicts = [];
      const survivedOps = [];
      for (const op of EXTREME_OPS) {
        const mutated = replaceBody(src, b, op.body);
        if (mutated === null) continue;
        /* ⚠️ A SPLICE THAT CHANGED NOTHING MUST NEVER BE SCORED. A function whose body already IS the
           replacement — `function f() { return null; }` under the `return null` operator — produces
           byte-identical source, the suite passes because nothing was mutated, and that vacuous pass
           counts as "survived" and pushes the function toward PSEUDO-TESTED. A fabricated finding,
           failing silently and in the same direction as the brace bug did. */
        if (mutated === src) continue;
        rmSync(join(d, file), { force: true });
        writeFileSync(join(d, file), mutated);
        mutantsRun++;
        const res = await run(d);
        verdicts.push(res.ok ? 'survived' : 'killed');
        if (res.ok) survivedOps.push(op.name);
        if (!res.ok && !FULL) break;
      }
      const verdict = classifyDescartes(verdicts, executions.get(b.fn) || 0);
      if (verdict === 'pseudo-tested') {
        pseudo.push({ ...b, ops: survivedOps });
        if (!has('--json')) process.stderr.write('  ● PSEUDO-TESTED ' + b.fn.padEnd(28) + ' L' + String(b.line).padEnd(6) + ' all ' + verdicts.length + ' extreme mutants survived\n');
      } else if (verdict === 'partially-tested') {
        partial.push({ ...b, ops: survivedOps });
        if (!has('--json'))
          process.stderr.write('  ◐ partially     ' + b.fn.padEnd(28) + ' L' + String(b.line).padEnd(6) + survivedOps.length + '/' + verdicts.length + ' survived: ' + survivedOps.join(', ') + '\n');
      } else {
        noticed++;
        if (!has('--json')) process.stderr.write('  ○ noticed       ' + b.fn.padEnd(28) + ' L' + b.line + '\n');
      }
    }
  };
  await Promise.all(dirs.map((_, w) => worker(w)));
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  const secs = (Date.now() - t0) / 1000;

  /* LEARN a canary from this run so the next one is guarded. The first NOTICED function is used —
     it is by definition one whose removal the suite detects. */
  if (!canaryName && noticed > 0) {
    const firstNoticed = bodies.find((b) => !pseudo.includes(b));
    if (firstNoticed) {
      canaries[file] = firstNoticed.fn;
      try {
        writeFileSync(CANARY_FILE, JSON.stringify(canaries, null, 2) + '\n');
        process.stderr.write(`  learned canary for ${file}: ${firstNoticed.fn} — the next run is guarded\n`);
      } catch (_) {}
    }
  }
  /* ZERO noticed is the signature of a broken harness, not of a catastrophically untested file. Say
     so rather than printing a spectacular and false result. */
  if (noticed === 0) {
    console.error('\n✗ NOT ONE function was noticed — every body could be deleted with the suite green.');
    console.error('  That is far more likely to be a broken harness than a real finding. Refusing to report.');
    process.exit(3);
  }

  pseudo.sort((a, b) => a.line - b.line);

  /* ── THE RATCHET ─────────────────────────────────────────────────────────────────────────────
     A full fleet run is ~8-10 min, which would roughly DOUBLE the merge critical path CLAUDE.md §👥.5
     already fights — to re-report a number that moves only when someone writes a test. So CI does not
     gate on the COUNT; it gates on GROWTH. `--baseline` compares against the committed list and fails
     only on a function that is NEWLY pseudo-tested.

     A file ABSENT from the baseline is not gated at all, deliberately. Recording an unmeasured file as
     `[]` would assert "nothing here is pseudo-tested" — a claim nobody has checked — and every real
     finding in it would then read as a regression introduced by whoever next touched it. Absent means
     unmeasured, and unmeasured means silent. */
  if (has('--baseline')) {
    const BFILE = join(ROOT, 'tools/pseudo-tested-baseline.json');
    let baseline = {};
    try {
      baseline = JSON.parse(readFileSync(BFILE, 'utf8'));
    } catch (_) {}
    const known = baseline[file];
    if (!known) {
      console.log(`  ${file} is not in the baseline — not gated. Add it deliberately with --write-baseline.`);
      process.exit(0);
    }
    const now = pseudo.map((p) => p.fn);
    const added = now.filter((f) => !known.includes(f));
    const fixed = known.filter((f) => !now.includes(f));
    if (fixed.length) console.log(`  ✓ ${fixed.length} function(s) NO LONGER pseudo-tested: ${fixed.join(', ')}\n    …update the baseline so the ratchet tightens: --write-baseline`);
    if (added.length) {
      console.error(`\n✗ ${added.length} NEWLY pseudo-tested function(s) in ${file}:`);
      for (const f of added) console.error(`    ${f}  — its entire body can be deleted with the suite green`);
      console.error('  Either assert on it, or record it deliberately with --write-baseline.');
      process.exit(1);
    }
    console.log(`  ✓ no new pseudo-tested functions in ${file} (${known.length} known)`);
    process.exit(0);
  }
  if (has('--write-baseline')) {
    const BFILE = join(ROOT, 'tools/pseudo-tested-baseline.json');
    let baseline = {};
    try {
      baseline = JSON.parse(readFileSync(BFILE, 'utf8'));
    } catch (_) {}
    baseline[file] = pseudo.map((p) => p.fn);
    writeFileSync(BFILE, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`  baseline written for ${file}: ${pseudo.length} pseudo-tested function(s)`);
    process.exit(0);
  }

  if (has('--json')) {
    console.log(
      JSON.stringify(
        {
          file,
          group,
          functions: bodies.length,
          pseudoTested: pseudo.map((p) => ({ fn: p.fn, line: p.line, survived: p.ops })),
          partiallyTested: partial.map((p) => ({ fn: p.fn, line: p.line, survived: p.ops })),
          noticed,
          mutantsRun,
          secs
        },
        null,
        2
      )
    );
  } else {
    console.log(`\n▸ ${file} · ${bodies.length} function(s) · ${secs.toFixed(0)}s at ${jobs}-way`);
    console.log(
      `  PSEUDO-TESTED ${pseudo.length}   partially ${partial.length}   not-covered ${uncovered.length}   tested ${noticed}   (${((100 * noticed) / bodies.length).toFixed(0)}% of functions have at least one assertion that depends on them)`
    );
    if (pseudo.length) {
      console.log('\n  Each of these can have its ENTIRE BODY DELETED with the suite still green:');
      for (const p of pseudo) console.log(`    L${String(p.line).padEnd(6)} ${p.fn}`);
      console.log('\n  These outrank raw survivor counts: a function nothing asserts on is worse than');
      console.log('  one with fifty surviving operator mutants.');
    }
  }
  process.exit(0);
}
