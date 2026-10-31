/*
 * tools/witness-baseline.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * ── THE CLASSICAL BASELINE FOR `survivor-witness.mjs` ───────────────────────────────────────────
 *
 * A peer's framing, and it is structurally exact: the model is a HEURISTIC PROPOSER working because
 * searching is expensive and checking is free — the same bargain a quantum annealer makes. D-Wave's
 * speedup claims did not collapse because the hardware failed; they collapsed when Rønnow, Troyer et
 * al. (Science, 2014) compared against WELL-TUNED CLASSICAL SOLVERS and the advantage evaporated.
 *
 * So: can a dumb enumerator find the same witnesses? It tries a fixed ladder of values against every
 * variable in the condition, keeps whatever separates the two expressions, and uses NO model at all.
 *
 * ⚠️ IT MUST RUN ON THE SAME PROBE SET, not a fresh sample. The probe set was selected BY THE
 * TECHNIQUE — survivors that sit in an `if`, lift cleanly by a balanced-paren scan, and evaluate
 * standalone — and that selection runs toward simple self-contained booleans, which is exactly where
 * an enumerator is strongest. Benchmarking on a different sample would repeat D-Wave's other error:
 * measuring on instances native to your own topology.
 *
 *   node tools/witness-baseline.mjs                               # the whole probe set
 *   node tools/witness-baseline.mjs --max-probes 50                 # a declared budget
 *   node tools/witness-baseline.mjs --state-dir <dir>               # read one planted dir
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stateDirs, stateJsonFiles } from './mutation-map.mjs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { checkWitness, probesFrom } from './survivor-witness.mjs';
import { spawnSync } from 'node:child_process';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/* MUTATION-SUITE-FOLLOWUPS §1: union-read both state dirs, shared git-common location first. */
const STATE_DIRS = stateDirs(ROOT);

/* ── THE DECLARED ARGV, AND WHY A BUDGET RATHER THAN A SMALLER DEFAULT ───────────────────────────
   Measured 2026-10-30 over 23 state files: 1939 probes at a mean 73 ms each, so a bare run needs
   about 141 s and prints its first line at the end of it. That cost is the whole reason
   `flag-exit-drive.mjs` listed this tool as UNDRIVEN — its 60 s child cap closes first, and a tool
   nothing drives keeps printing a green line no run in the tree ever evaluates.

   The remedy is an OPT-IN budget, never a smaller default. The default population IS the
   measurement here: the question this tool answers is whether a dumb enumerator matches the model
   over the SAME probe set, and a default that quietly read 50 of 1939 would answer a different
   question in the same words. So the full set stays the default, `--max-probes` bounds it on
   request, and a bounded run prints the population it considered beside every percentage.

   `--state-dir` exists for the drive's sake and for a reproduction's: the shared mutation-sweep
   state belongs to another lane, its contents move between sweeps, and a drive must read state it
   planted itself. Unknown argv now refuses, where a bare `includes` ignored it in silence. */
const ARGV_SPEC = { valued: ['--max-probes', '--state-dir'], boolean: ['--selftest'] };

/** `.json` entries in ONE named directory — the `--state-dir` form of `stateJsonFiles`'s union scan. */
export function jsonEntries(dir, { readdirFn = readdirSync } = {}) {
  let names = [];
  try {
    names = readdirFn(dir);
  } catch {
    return []; /* an unreadable dir contributes nothing, and the caller reports the absence */
  }
  return names
    .filter((n) => n.endsWith('.json'))
    .sort()
    .map((n) => ({ name: n, path: join(dir, n) }));
}

/** A budget wants a positive integer. `--max-probes 0` and `--max-probes x` are refusals, not a full run. */
export function parseBudget(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, n: null };
  return { ok: true, n };
}

/** Applied so the REPORT can name what it left out: a percentage over an undeclared subset is a false green. */
export function applyBudget(probes, max) {
  const n = Number.isInteger(max) && max > 0 ? Math.min(max, probes.length) : probes.length;
  return { considered: probes.slice(0, n), total: probes.length, truncated: n < probes.length };
}

/* The ladder. Chosen to cover the shapes these guards actually test — nullish, numeric boundary,
   non-finite, empty vs non-empty container, wrong type — and NOT tuned per probe, because a ladder
   tuned against the answers would be the enumerator cheating in the way the model cannot. */
export const LADDER = ['null', 'undefined', '0', '1', '-1', 'NaN', 'Infinity', '-Infinity', '""', '"x"', '[]', '[1]', '{}', 'true', 'false', '5', '300', '0.5'];

const RESERVED = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'NaN',
  'Infinity',
  'typeof',
  'instanceof',
  'Math',
  'Number',
  'String',
  'Array',
  'Object',
  'JSON',
  'Date',
  'Boolean',
  'isFinite',
  'parseInt',
  'parseFloat',
  'in',
  'of',
  'new'
]);

/* Free variables: identifiers that are not property accesses, not calls, not reserved. */
/* ⚠️ THE LADDER MUST BE TUNED PER EXPRESSION, or the comparison measures the ladder rather than the
   model. Every model-only witness in the first run was a value DERIVED from the condition — the
   constant appearing in it, that constant plus one, a string of exactly the length being tested. No
   fixed ladder of any length contains those, so an untuned baseline concedes the whole class by
   construction. That is the asymmetry that made the original D-Wave comparisons unfalsifiable:
   a heuristic beats a classical method that was never tuned for the instance.

   So: lift the numeric literals out of the expression, offer each with ±1, and lift string lengths.
   Ten lines, and the model-only figure becomes a measurement of the model instead of of my ladder. */
export function tunedLadder(expr) {
  const extra = new Set();
  /* ⚠️ SCIENTIFIC NOTATION IS HOUSE STYLE HERE, not a tail. `1e-9`, `1e-12`, `1e-6` are everywhere in
     a DSP suite, and the first version of this regex matched neither the `e` nor its exponent — so
     `Math.abs(den) < 1e-12` was conceded to the model by a CHARACTER CLASS rather than by any
     capability difference. Every such concession is my bug counted as the model's win. */
  for (const m of String(expr).matchAll(/(?<![\w.])(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)(?![\w.])/g)) {
    const n = Number(m[1]);
    if (!Number.isFinite(n)) continue;
    extra.add(String(n));
    extra.add(String(n + 1));
    extra.add(String(n - 1));
    /* ±1 is meaningless beside 1e-12; a proportional neighbour is what an epsilon threshold needs. */
    if (n !== 0 && Math.abs(n) < 1) {
      extra.add(String(n * 2));
      extra.add(String(n / 2));
    }
    /* a string of exactly that length answers `f.length < N` shapes */
    if (Number.isInteger(n) && n >= 0 && n <= 40) {
      extra.add(JSON.stringify('x'.repeat(n)));
      extra.add(JSON.stringify('x'.repeat(n + 1)));
      extra.add(`new Array(${n})`);
    }
  }
  return [...LADDER, ...extra];
}
export function freeVars(expr) {
  const out = new Set();
  const s = String(expr);
  for (const m of s.matchAll(/(\.)?\b([A-Za-z_$][A-Za-z0-9_$]*)\b(\s*\()?/g)) {
    if (m[1] || m[3]) continue;
    if (RESERVED.has(m[2])) continue;
    out.add(m[2]);
  }
  return [...out];
}

/* Try the ladder. For one variable that is |LADDER| attempts; for several, a bounded sweep — every
   variable at the same ladder index, then one variable varied against a fixed rest. Deliberately NOT
   a full cartesian product: an enumerator allowed unbounded search would beat anything, and the
   question is whether a CHEAP one suffices. */
export function enumerate(a, b, cap = 3000) {
  const vars = freeVars(a);
  if (!vars.length || vars.length > 4) return null;
  let tried = 0;
  const attempt = (decl) => {
    if (tried++ > cap) return null;
    const r = checkWitness(a, b, decl);
    return r.ok ? decl : null;
  };
  const L = tunedLadder(a);
  for (const v of L) {
    const hit = attempt('var ' + vars.map((x) => `${x} = ${v}`).join(', ') + ';');
    if (hit) return hit;
  }
  for (let i = 0; i < vars.length; i++) {
    for (const v of L) {
      for (const base of L) {
        const decl = 'var ' + vars.map((x, k) => `${x} = ${k === i ? v : base}`).join(', ') + ';';
        const hit = attempt(decl);
        if (hit) return hit;
      }
    }
  }
  return null;
}

const IS_MAIN = (() => {
  try {
    return isCliEntry(import.meta.url);
  } catch {
    return false;
  }
})();

/* ABOVE both entry branches: a refusal that ran after the state read would have read state the
   caller never asked for, and the argv it refused might have been the `--state-dir` naming it. */
if (IS_MAIN) refuseUnknownArgvOrExit(process.argv.slice(2), ARGV_SPEC, { tool: 'witness-baseline' });

if (IS_MAIN && process.argv.includes('--selftest')) {
  let pass = 0,
    fail = 0;
  const ok = (n, c, d) => {
    if (c) {
      pass++;
      console.log('  ✓ ' + n);
    } else {
      fail++;
      console.log('  ✗ ' + n + (d ? '  — ' + d : ''));
    }
  };
  /* `b` IS a free variable — it needs a binding; only the callee `f` and the property `.length` are
     excluded. My first expectation here said ["a"] and the assertion caught it, which is what it is
     for: a wrong expectation before a wrong implementation. */
  ok('properties and callees are excluded, arguments are not', JSON.stringify(freeVars('!a || !a.length || f(b)')) === '["a","b"]', JSON.stringify(freeVars('!a || !a.length || f(b)')));
  ok('reserved words are not variables', !freeVars('typeof v !== "number"').includes('typeof'));
  ok('a boundary case is found by the ladder', !!enumerate('h < 0', 'h <= 0'));
  ok('an || → && guard is found', !!enumerate('!x || !x.length', '!x && !x.length'));
  ok('a genuinely equivalent pair returns null', enumerate('a > 1', 'a > 1.0') === null);
  ok('too many variables declines rather than exploding', enumerate('a||b||c||d||e', 'a&&b&&c&&d&&e') === null);
  ok('§1: state dirs try the shared tepna-mutation location first', /tepna-mutation$/.test(STATE_DIRS[0]) && /\.mutation-sweeps$/.test(STATE_DIRS[1]));
  ok('a named state dir keeps only json, sorted', JSON.stringify(jsonEntries('/d', { readdirFn: () => ['b.json', 'a.json', 'c.txt'] }).map((e) => e.name)) === '["a.json","b.json"]');
  ok(
    'an unreadable state dir yields no entries rather than throwing',
    jsonEntries('/d', {
      readdirFn: () => {
        throw new Error('EACCES');
      }
    }).length === 0
  );
  ok(
    'no budget considers the whole set',
    (() => {
      const b = applyBudget([1, 2, 3], null);
      return b.considered.length === 3 && b.total === 3 && b.truncated === false;
    })()
  );
  ok(
    'a budget names the population it left out',
    (() => {
      const b = applyBudget([1, 2, 3], 2);
      return b.considered.length === 2 && b.total === 3 && b.truncated === true;
    })()
  );
  ok('a budget over the set is not a truncation', applyBudget([1, 2], 9).truncated === false);
  ok('a non-integer budget refuses', !parseBudget('x').ok && !parseBudget('0').ok && !parseBudget('2.5').ok && parseBudget('5').n === 5);
  /* The exit CODE is the contract `flag-exit-drive.mjs` drives, so the leg spawns rather than asserts. */
  const bogus = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--nope'], { encoding: 'utf8', timeout: 20000 });
  ok('an unknown flag refuses with exit 2', bogus.status === 2 && /unknown flag/.test(String(bogus.stderr)), `status ${bogus.status}`);
  console.log(fail ? '\n✗ ' + fail + ' failed, ' + pass + ' passed' : '\n✓ all ' + pass + ' selftests passed');
  process.exit(fail ? 1 : 0);
}

if (IS_MAIN && !process.argv.includes('--selftest')) {
  const argv = process.argv.slice(2);
  const sdIdx = argv.indexOf('--state-dir');
  const STATE_DIR = sdIdx < 0 ? null : argv[sdIdx + 1];
  const mpIdx = argv.indexOf('--max-probes');
  let MAX = null;
  if (mpIdx >= 0) {
    const b = parseBudget(argv[mpIdx + 1]);
    if (!b.ok) {
      console.error(`✗ witness-baseline: --max-probes wants a positive integer, and read ${JSON.stringify(argv[mpIdx + 1])}.`);
      console.error('  nothing was read and nothing was written.');
      process.exit(2);
    }
    MAX = b.n;
  }
  const read = STATE_DIR ? [STATE_DIR] : STATE_DIRS;
  const entries = STATE_DIR ? jsonEntries(STATE_DIR) : stateJsonFiles(ROOT);
  /* §∅: an empty read is a missing INPUT. The earlier form refused only when no DIRECTORY existed, so
     an existing-but-empty state dir fell through to `0 probes` and a `NaN%` witness rate — a number
     printed about a population nothing examined. Both cases exit 2 now. */
  if (!entries.length) {
    console.error('✗ no state json to read — a missing INPUT, not a finding of zero.');
    console.error('  tried: ' + read.join('  then  '));
    process.exit(2);
  }
  const files = [];
  for (const e of entries) {
    try {
      const j = JSON.parse(readFileSync(e.path, 'utf8'));
      const s = j.survivors || j.results || j.mutants;
      if (Array.isArray(s)) files.push({ file: j.file || e.name, survivors: s });
    } catch {}
  }
  const probes = probesFrom(files);
  const budget = applyBudget(probes, MAX);
  const t0 = Date.now();
  let hit = 0,
    miss = 0,
    declined = 0;
  for (const [i, p] of budget.considered.entries()) {
    const w = enumerate(p.a, p.b);
    if (w) hit++;
    else if (freeVars(p.a).length > 4 || !freeVars(p.a).length) declined++;
    else miss++;
    /* A run this long that prints nothing reads as a hang, which is what kept it undriven. Progress
       goes to stderr so it can never be mistaken for the verdict on stdout. */
    if ((i + 1) % 200 === 0) process.stderr.write(`  … ${i + 1} of ${budget.considered.length} probes\n`);
  }
  const sec = (Date.now() - t0) / 1000;
  const n = budget.considered.length;
  const pct = (k) => (n ? `${((100 * k) / n).toFixed(1)}%` : 'no population');
  console.log(`\n▸ CLASSICAL BASELINE — no model, ladder of ${LADDER.length} values`);
  console.log(`  probes considered : ${n} of ${budget.total}${budget.truncated ? `   — BUDGETED by --max-probes ${MAX}; this is NOT the whole set` : ''}`);
  console.log(`  witness found     : ${hit}  (${pct(hit)} of considered)`);
  console.log(`  no witness found  : ${miss}`);
  console.log(`  declined (>4 vars): ${declined}`);
  console.log(`  wall clock        : ${sec.toFixed(1)}s   — no GPU, no model`);
  if (budget.truncated) console.log('  ⚠ a budgeted run answers about its own subset, never about the probe set as a whole.');
}
