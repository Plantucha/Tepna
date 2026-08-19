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
 *   node tools/witness-baseline.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stateDirs, stateJsonFiles } from './mutation-map.mjs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { checkWitness, probesFrom } from './survivor-witness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/* MUTATION-SUITE-FOLLOWUPS §1: union-read both state dirs, shared git-common location first. */
const STATE_DIRS = stateDirs(ROOT);

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
    return process.argv[1] && join(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

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
  console.log(fail ? '\n✗ ' + fail + ' failed, ' + pass + ' passed' : '\n✓ all ' + pass + ' selftests passed');
  process.exit(fail ? 1 : 0);
}

if (IS_MAIN && !process.argv.includes('--selftest')) {
  const entries = stateJsonFiles(ROOT);
  if (!entries.length && !STATE_DIRS.some((d) => existsSync(d))) {
    console.error('✗ no state dir at either candidate — a missing INPUT, not a finding of zero.');
    console.error('  tried: ' + STATE_DIRS.join('  then  '));
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
  const t0 = Date.now();
  let hit = 0,
    miss = 0,
    declined = 0;
  for (const p of probes) {
    const w = enumerate(p.a, p.b);
    if (w) hit++;
    else if (freeVars(p.a).length > 4 || !freeVars(p.a).length) declined++;
    else miss++;
  }
  const sec = (Date.now() - t0) / 1000;
  console.log(`\n▸ CLASSICAL BASELINE — no model, ladder of ${LADDER.length} values`);
  console.log(`  probes            : ${probes.length}`);
  console.log(`  witness found     : ${hit}  (${((100 * hit) / probes.length).toFixed(1)}%)`);
  console.log(`  no witness found  : ${miss}`);
  console.log(`  declined (>4 vars): ${declined}`);
  console.log(`  wall clock        : ${sec.toFixed(1)}s   — no GPU, no model`);
}
