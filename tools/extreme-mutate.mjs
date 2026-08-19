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
 * ⚠️ A SURVIVING EXTREME MUTANT CANNOT LOCALISE THE DEFECT, and that is not a detail — it is why the
 * papers call this a COMPLEMENT to operator mutation rather than a cheaper version of it. Replacing a
 * whole body hides WHICH PART is unguarded. A concrete case from this repo, 2026-08-11: in a `HH:MM:SS`
 * formatter, `getUTCSeconds -> getSeconds` SURVIVES almost every conceivable test, because every IANA
 * offset since 1972 is a whole number of minutes, so local and UTC seconds agree under Kolkata,
 * Kathmandu, Chatham, Eucla — anything modern. It is NOT equivalent: JS still models pre-1972 local
 * mean time, and Africa/Monrovia ran at -00:44:30 until 1972, so a 1960 instant reads :45 locally
 * against :15 UTC. One input separates them. An extreme mutant on that formatter is killed by any test
 * that checks the hour, so this tool reports it TESTED and the seconds third stays unguarded forever.
 * Rank with this; find with the operator sweep.
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
import { ResumeLedger, etaSeconds, fingerprint, fmtDuration, progressLine } from './run-progress.mjs';
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { resolveStatePath, stateDirs } from './mutation-map.mjs';
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
  /* Assignment lifted out of the condition: biome's lint floor rejects `while ((m = re.exec(...)))`,
     and it is right that the idiom hides a mutation inside a test. Same iteration, stated. */
  let m = re.exec(mask);
  for (; m !== null; m = re.exec(mask)) {
    const open = mask.indexOf('{', re.lastIndex);
    if (open < 0) continue;
    let d = 0;
    for (let j = open; j < mask.length; j++) {
      const ch = mask[j];
      if (ch === '{') d++;
      else if (ch === '}') {
        d--;
        if (d === 0) {
          /* Params come from the mask too, and only the plain identifiers — a destructured or
             defaulted parameter is not something `return_param` can reason about, so it is simply
             absent from the list and the matcher declines rather than guesses. */
          const params = mask
            .slice(re.lastIndex, mask.indexOf(')', re.lastIndex))
            .split(',')
            .map((p) => p.trim())
            .filter((p) => /^\w+$/.test(p));
          out.push({ fn: m[1], open, close: j, params, line: s.slice(0, m.index).split('\n').length });
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

/* ── DESCARTES' STOP-MATCHERS, ported rather than rediscovered one crash at a time ───────────
   Descartes ships 16 matchers naming method shapes it refuses to mutate. This tool met the first of
   them by accident: `function f() { return null; }` under the `return null` operator splices to
   BYTE-IDENTICAL source, the suite passes because nothing was mutated, and that vacuous pass scores
   as "survived". That is Descartes' `constant` matcher, and the reason it exists is exactly the
   reason the byte-identical guard was needed — the mutant of a trivial accessor is equivalent to it.

   ⚠️ THE SCOPE DIFFERS FROM THE BYTE-IDENTICAL GUARD, and the difference is the whole point of
   porting the list. The guard SKIPS one operator; Descartes EXCLUDES THE FUNCTION. Those come apart
   when the skipped operator is the only applicable one: skipping leaves the function with an EMPTY
   outcome set, and an empty outcome set is not a verdict. This file used to score that case as
   `noticed` — crediting a function as TESTED on the strength of an experiment that never ran. A
   function with nothing to mutate must produce NO REPORT ENTRY at all, in either direction.

   A trivial function's pseudo-testedness carries no information: `return this._x;` survives every
   extreme mutant that happens to return the same shape, and no assertion you could add would change
   what the mutation means. Reporting them buries the real findings under accessors.

   Returns the matcher name (for the report) or null. Conservative by construction — anything it
   cannot recognise is NOT trivial, so the failure mode is running mutants that were not needed
   rather than silently dropping a real finding. */
export function trivialMatcher(src, b) {
  /* EMPTINESS is judged on the MASK — a body of nothing but comments has no behaviour to delete.
     Everything else is judged on the RAW text, because the mask blanks string literals outright:
     `return "x";` masks to `return    ;`, which is indistinguishable from a bare `return;` and made
     the string case decline. Reading raw is safe here only because every pattern below is fully
     anchored, so a trailing comment or any extra token declines rather than matching — the
     conservative direction. */
  const masked = stripNonCode(src)
    .slice(b.open + 1, b.close)
    .trim();
  if (!masked) return 'empty';
  const inner = src.slice(b.open + 1, b.close).trim();
  const params = b.params || [];
  const one = inner.replace(/;$/, '').trim();
  if (/^return\s+this$/.test(one)) return 'return_this';
  if (/^return(\s+(null|undefined|true|false|-?\d+(\.\d+)?|'[^']*'|"[^"]*"|`[^`]*`|\[\s*\]|\{\s*\}))?$/.test(one)) return 'constant';
  const mRet = /^return\s+(\w+)$/.exec(one);
  if (mRet && params.includes(mRet[1])) return 'return_param';
  const mSet = /^this\.\w+\s*=\s*(\w+)$/.exec(one);
  if (mSet && params.includes(mSet[1])) return 'setter';
  const mGet = /^return\s+this\.\w+$/.exec(one);
  if (mGet) return 'getter';
  return null;
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

  /* ── DESCARTES' STOP-MATCHERS ─────────────────────────────────────────────────────────────── */
  const TRIV = [
    'function c() { return null; }',
    'function s() { return "x"; }',
    'function z() { return 0; }',
    'function arr() { return []; }',
    'function self() { return this; }',
    'function idp(v) { return v; }',
    'function setx(v) { this.x = v; }',
    'function getx() { return this.x; }',
    'function real(a) { return a * 2 + 1; }'
  ].join('\n');
  const TB = functionBodies(TRIV);
  const mat = (n) =>
    trivialMatcher(
      TRIV,
      TB.find((b) => b.fn === n)
    );
  eq('a constant-returning function is EXCLUDED (Descartes `constant`)', mat('c'), 'constant');
  eq('…string literal too', mat('s'), 'constant');
  eq('…and 0, which a truthiness check would have missed', mat('z'), 'constant');
  eq('…and the empty array', mat('arr'), 'constant');
  eq('`return this` is excluded', mat('self'), 'return_this');
  eq('a function returning its own parameter unchanged is excluded', mat('idp'), 'return_param');
  eq('a setter is excluded', mat('setx'), 'setter');
  eq('a getter is excluded', mat('getx'), 'getter');
  /* The matcher must DECLINE on anything with real behaviour, or the tool silently stops looking at
     the code it exists to examine. Over-running mutants is the acceptable failure; under-reporting a
     pseudo-tested function is not. */
  eq('a function with actual behaviour is NOT excluded', mat('real'), null);
  eq('…nor is one that merely mentions a parameter it does not return', trivialMatcher('function f(v) { return v.length; }', functionBodies('function f(v) { return v.length; }')[0]), null);
  eq('…nor is `return notAParam` — the identifier must be in the signature', trivialMatcher('function f(a) { return glob; }', functionBodies('function f(a) { return glob; }')[0]), null);

  /* ── THE EMPTY OUTCOME SET ────────────────────────────────────────────────────────────────── */
  eq('a covered function with NO applicable operator is not-applicable', classifyDescartes([], 5), 'not-applicable');
  eq('…and not-applicable is NOT one of the three verdicts, so it cannot be filed as tested', ['pseudo-tested', 'partially-tested', 'tested'].includes(classifyDescartes([], 5)), false);
  eq('an uncovered function is not-covered whatever its verdicts say', classifyDescartes(['survived', 'survived'], 0), 'not-covered');
  eq('…even when every mutant was killed — coverage is checked FIRST', classifyDescartes(['killed'], 0), 'not-covered');
  eq('covered + all survived is pseudo-tested', classifyDescartes(['survived', 'survived'], 1), 'pseudo-tested');
  eq('covered + mixed is partially-tested', classifyDescartes(['survived', 'killed'], 1), 'partially-tested');
  eq('covered + all killed is tested', classifyDescartes(['killed', 'killed'], 1), 'tested');

  /* The byte-identical splice, which is the same fact as the `constant` matcher seen from the other
     side: the operator and the body coincide, so the "mutant" is the original. */
  const IDENT = 'function c() { return null; }';
  eq(
    'splicing `return null` into a body that IS `return null` yields identical source',
    replaceBody(IDENT, functionBodies(IDENT)[0], ' return null; ').replace(/\s+/g, ' '),
    IDENT.replace(/\s+/g, ' ')
  );

  ok('§1: the resume default resolves within a declared state candidate', stateDirs(ROOT).some((d) => resolveStatePath(ROOT, 'levela-x.jsonl').startsWith(d)), resolveStatePath(ROOT, 'levela-x.jsonl'));
  console.log('\n' + (fail ? `✗ ${fail} failed, ${pass} passed` : `✓ all ${pass} selftests passed`));
  process.exit(fail ? 1 : 0);
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────
if (IS_MAIN && !has('--selftest')) {
  const file = opt('--file', '');
  const group = opt('--group', '');
  const resumePathA = process.argv.includes('--resume') ? opt('--resume-file', '') || resolveStatePath(ROOT, 'levela-' + String(opt('--file', 'x')).replace(/[^A-Za-z0-9]+/g, '-') + '.jsonl') /* §1 */ : null;
  const jobsWanted = Math.max(1, Number(opt('--jobs', String((await import('node:os')).cpus().length))) || 1);
  if (!file || !group) {
    console.error('usage: node tools/extreme-mutate.mjs --file <dsp.js> --group <test group filter> [--jobs N] [--json]');
    process.exit(2);
  }
  const src = readFileSync(join(ROOT, file), 'utf8');
  let bodies = functionBodies(src).filter((b) => emptyBody(src, b) !== null);
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
    /* ⚠️ `npx -y c8@10.1.2`, NOT node_modules/.bin/c8. c8 is deliberately NOT a devDependency here
       (#1163: adding it desynced package-lock.json and broke `npm ci`), so the repo runs it through npx
       exactly as `typecheck` runs tsc. Hardcoding the .bin path worked only on the machine where an
       earlier `--no-save` install had left it, and silently refused everywhere else. */
    execFileSync(
      'npx',
      /* 🔴 A TOOL BEING MUTATED MUST BE MEASURABLE. This c8 call hard-coded `--exclude=tools/**`,
         so Level A REFUSED on every file in that tree — correctly, since without per-function
         coverage "nothing calls this" is indistinguishable from "nothing asserts on this". The
         effect was that every guard there lived on hand-written cases only and could never be
         mutation-assessed: commit-shape (guards main), rebase-safe (prevents work loss), land-pr
         (merges PRs), and this programme's own stmt-delete.

         The exclusion is lifted ONLY when the subject is itself under tools/, and `--include` is
         set alongside because the repo's .c8rc.json restricts include to root `*.js` and c8 merges
         its config with these flags. Verified: the report goes from 0 tools files to 117, with
         commit-shape.mjs carrying 4 functions.

         ⚠️ `.c8rc.json` IS DELIBERATELY NOT TOUCHED. Its stated job is measuring the Dex SUITE as
         the baseline for a future floor ("NO THRESHOLD YET"), and folding 117 dev tools into that
         number would corrupt the baseline it exists to establish. This report is ephemeral — a
         temp dir, removed a few lines below — so it changes no shared measurement. */
      (/^tools[\\/]/.test(file)
        ? ['-y', 'c8@10.1.2', '--reporter=json', '--report-dir=' + covDir, '--exclude=tests/**', '--include=tools/*.mjs', '--all']
        : ['-y', 'c8@10.1.2', '--reporter=json', '--report-dir=' + covDir, '--exclude=tests/**', '--exclude=tools/**']
      ).concat([process.execPath, join(ROOT, 'tests/run-tests.mjs'), '--group=' + group]),
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
  const reached = [...executions.values()].filter((n) => n > 0).length;
  process.stderr.write('  coverage: ' + reached + '/' + executions.size + ' functions executed by --group=' + group + '\n');
  /* ⚠️ THE SCOPE IS PART OF THE FINDING, and it is easy to read past. "0 executions" means "no test in
     THIS GROUP calls it" — never "dead code", and not even "the suite does not cover it". Measured
     2026-08-11: hrvdex fmtClock/fmtDate/fmtDateTime read 0 under --group=hrvdex-dsp and are in fact
     executed 2/2/1 times, by a group named `Clock Contract §5 …` that the filter does not select. The
     filter scopes by the FILE's name; the tests that reach a file are named after the CONTRACT they
     pin. So a not-reached count is an upper bound on what the suite leaves unguarded, and the sweep's
     kill verdicts inherit the same bound — a mutant is only ever offered to this group's tests.

     Scoping coverage and mutants to the SAME group is still right: classifying against tests that were
     never run would be worse. But the number must be reported with its scope attached.

     ⚠️ AND THE LANE IS THE SECOND HALF OF THE SCOPE. c8 instruments the NODE lane. The browser
     render-coverage rigs boot real bundles in iframes, which c8 cannot see at all, so a function
     exercised only there reads 0 here. MEASURED by the tests/ session, 2026-08-11, by hooking the
     assignment inside the rigs: hrvdex `getFilteredRows` 25 calls, `_hrvUpdateExportHint` 5,
     `restoreHRVRows` 1 — all three reported 0 executions by c8. They are covered; the instrument is
     blind. So NOT-REACHED means "no node-lane test in this group calls it" and NEVER "dead code":
     for those three the action is a browser-lane assertion, not deletion. */
  /* NON-VACUITY, and it FAILS CLOSED. If the selected group reaches NOTHING in this file, every
     function would report 0 executions and the honest answer is NOT MEASURED, not "nothing is
     covered". A filter that matches no relevant test reads exactly like a suite that asserts nothing —
     the same shape as `pytest` without `--cov` printing `N passed` and never evaluating the floor.

     ⚠️ THE CANARY USUALLY FIRES FIRST, and this guard exists for the case where it cannot. A learned
     canary is a function IN THIS FILE, so a group that reaches nothing here also fails to notice the
     canary and the run already refuses — I tried to demonstrate this guard with --group=docs-ledger
     and got the canary refusal instead. But a canary is LEARNED on the first successful run, so the
     first run of any new file has none, and that is exactly when a filter typo is most likely. */
  if (reached === 0) {
    console.error('✗ --group=' + group + ' REACHES NOTHING in ' + file + ' — refusing to classify.');
    console.error('  Zero of ' + executions.size + ' functions were executed, which is indistinguishable from a filter typo.');
    console.error('  "not measured" is the honest answer here; "0 covered" would be a fabricated one.');
    process.exit(3);
  }
  if (reached < executions.size) {
    process.stderr.write('  ⚠ ' + (executions.size - reached) + ' function(s) are NOT REACHED BY THIS NODE-LANE GROUP — an UPPER BOUND on what\n');
    process.stderr.write('    the suite leaves unguarded, twice over: another GROUP may reach them under a name this\n');
    process.stderr.write('    filter does not match, and the browser render LANE is invisible to c8 entirely.\n');
    process.stderr.write('    Measured: hrvdex getFilteredRows/_hrvUpdateExportHint/restoreHRVRows run 25/5/1 times\n');
    process.stderr.write('    in the render rigs and read 0 here. NOT-REACHED never means dead code.\n');
  }

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
  const trivial = [];
  const noticedBodies = [];
  let noticed = 0,
    next = 0,
    mutantsRun = 0;
  const FULL = has('--classify');
  /* ── PROGRESS AND RESUME. Level A runs for minutes to hours over a DSP and, until now, said
     nothing between its coverage header and its verdicts — so "is it working or wedged?" had no
     answer, and an interruption discarded every function it had already classified.

     The fingerprint covers the source and group, so a ledger written against other code is
     refused rather than merged. Unlike Level B this loop was ALREADY genuinely parallel (it
     awaits an async `run`), so the ETA divides by a job count that exists. */
  const keyOf = (b) => b.fn + '|' + b.line;
  const fpA = fingerprint({ tool: 'extreme-mutate@1', file, group, src, bodies: bodies.length });
  const ledgerA = new ResumeLedger(resumePathA || null, fpA).load();
  if (resumePathA && ledgerA.stale) process.stderr.write('  ⚠ resume ledger describes DIFFERENT inputs — starting from zero\n');
  ledgerA.begin();
  const allBodies = bodies;
  bodies = bodies.filter((b) => !ledgerA.has(keyOf(b)));
  if (resumePathA && ledgerA.size) process.stderr.write('  ↻ resuming: ' + ledgerA.size + ' function(s) already classified, ' + bodies.length + ' to go\n');
  const jobsA = Math.max(1, Math.min(dirs.length, Math.max(1, bodies.length)));
  process.stderr.write('  ' + bodies.length + ' function(s) to classify across ' + jobsA + ' job(s)\n');
  let doneA = ledgerA.size;
  let ranA = 0;
  let secA = 0;
  const t0 = Date.now();
  const worker = async (w) => {
    const d = dirs[w];
    for (;;) {
      const i = next++;
      if (i >= bodies.length) return;
      const b = bodies[i];
      const bT0 = Date.now();
      /* EVERY operator, per Descartes — but SHORT-CIRCUIT on the first kill unless --classify.
         One killed operator already proves the function is not pseudo-tested, and most functions are
         killed by the first, so the average cost stays near 1 mutant rather than 8. The price: a
         short-circuited function reports as "noticed" without separating PARTIALLY-tested from fully
         tested. --classify runs the whole set and splits them. */
      /* TRIVIAL first, before coverage: an accessor is uninformative whether or not a test calls it,
         and Descartes excludes it from the population rather than filing it under a bucket. */
      const triv = trivialMatcher(src, b);
      if (triv) {
        trivial.push({ ...b, matcher: triv });
        if (!has('--json')) process.stderr.write('  · excluded      ' + b.fn.padEnd(28) + ' L' + String(b.line).padEnd(6) + ' Descartes stop-matcher: ' + triv + '\n');
        ledgerA.record(keyOf(b), { fn: b.fn, line: b.line, verdict: 'excluded' });
        continue;
      }
      /* An UNCOVERED function needs no mutants at all: every one of them would survive trivially, so
         running eight is pure cost for a verdict already determined. */
      if (!(executions.get(b.fn) > 0)) {
        uncovered.push(b);
        if (!has('--json')) process.stderr.write('  ∅ not-reached   ' + b.fn.padEnd(28) + ' L' + b.line + '  — no test in this group calls it\n');
        ledgerA.record(keyOf(b), { fn: b.fn, line: b.line, verdict: 'not-reached' });
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
      ledgerA.record(keyOf(b), { fn: b.fn, line: b.line, verdict });
      doneA++;
      secA += (Date.now() - bT0) / 1000;
      if (!has('--json')) {
        /* The mean is over the runs THIS process performed — a resumed ledger contributes
           verdicts but no timings, and folding its count into the denominator would report a
           per-run cost far below the real one. */
        ranA++;
        process.stderr.write(progressLine(doneA, allBodies.length, jobsA, secA / Math.max(1, ranA), verdict) + '\n');
      }
      if (verdict === 'pseudo-tested') {
        pseudo.push({ ...b, ops: survivedOps });
        if (!has('--json')) process.stderr.write('  ● PSEUDO-TESTED ' + b.fn.padEnd(28) + ' L' + String(b.line).padEnd(6) + ' all ' + verdicts.length + ' extreme mutants survived\n');
      } else if (verdict === 'partially-tested') {
        partial.push({ ...b, ops: survivedOps });
        if (!has('--json'))
          process.stderr.write('  ◐ partially     ' + b.fn.padEnd(28) + ' L' + String(b.line).padEnd(6) + survivedOps.length + '/' + verdicts.length + ' survived: ' + survivedOps.join(', ') + '\n');
      } else if (verdict === 'not-applicable') {
        /* Every operator was skipped, so nothing was ever run. NOT a pass — the previous code fell
           through to `noticed++` here and credited the function as tested on an experiment that did
           not happen. No report entry, and no denominator entry either. */
        trivial.push({ ...b, matcher: 'no-applicable-operator' });
        if (!has('--json')) process.stderr.write('  · excluded      ' + b.fn.padEnd(28) + ' L' + String(b.line).padEnd(6) + ' no applicable operator — not scored\n');
      } else {
        noticed++;
        noticedBodies.push(b);
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
    /* From a function the suite ACTUALLY noticed. The old `bodies.find(b => !pseudo.includes(b))`
       would happily elect an uncovered or excluded function — one whose mutant was never run — as
       the canary, and a canary that cannot fail guards nothing. */
    const firstNoticed = noticedBodies[0];
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
          scope: '--group=' + group,
          lane: 'node (c8 cannot see the browser render rigs)',
          notReachedByGroup: uncovered.map((p) => ({ fn: p.fn, line: p.line })),
          excluded: trivial.map((p) => ({ fn: p.fn, line: p.line, matcher: p.matcher })),
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
      `  PSEUDO-TESTED ${pseudo.length}   partially ${partial.length}   not-reached ${uncovered.length}   excluded ${trivial.length}   tested ${noticed}` +
        /* DENOMINATOR = THE CLASSIFIED POPULATION, not every function in the file. An uncovered or
           Descartes-excluded function was never put to the question, so counting it below the line
           states a rate over experiments that did not run. */
        (pseudo.length + partial.length + noticed
          ? `\n  ${((100 * noticed) / (pseudo.length + partial.length + noticed)).toFixed(0)}% of the ${pseudo.length + partial.length + noticed} CLASSIFIED function(s) have an assertion that depends on them`
          : '\n  nothing classified — every function was excluded or uncovered')
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
