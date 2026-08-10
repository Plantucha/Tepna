#!/usr/bin/env node
/*
 * tools/probe-reach.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * WHICH FUNCTIONS DOES A BATTERY ACTUALLY EXECUTE? — the other half of `probe-coverage`.
 *
 * `probe-coverage` answers "could the prober form an opinion about this survivor" — a question about
 * which `fn` names the families NAME. This answers the different question underneath it: which
 * functions the battery's inputs actually REACH. The two come apart constantly, and each gap has a
 * completely different fix:
 *
 *   REACHED but not named   →  register the existing probe under that `fn`. One line. Free.
 *   NAMED but not reached   →  the battery does not exercise it; a family there would report BLIND
 *                              controls and void. Needs a new input SHAPE, not a new registration.
 *   neither                 →  write a family.
 *
 * Told apart, that turns a coverage hole into a sorted work list. Measured on `motiondex-dsp.js`,
 * whose battery claimed 92 of 287 survivors:
 *
 *   inferAccUnit  xyzPlausible  sampleHz  streamKindFromHeader  xyzColsFromHeader   ← already reached
 *   respWindowSpectrum  respResample  respViterbi  movavg                           ← already reached
 *   bodyPosition  classifyGravity  buildNodeExport                                  ← NOT reached
 *
 * Nine of twelve were one registration away from being classifiable, and nothing in the tooling said
 * so. `respViterbi` was being called 168 times per probe run while its 9 survivors sat unclaimed.
 *
 * HOW IT MEASURES. It injects a counter as the first statement of every function body and runs each
 * family's probe ONCE. That is exact — a function that never increments was never executed — and it
 * costs one module load per family rather than one per mutant. The first version of this used
 * mutation (perturb a line, see whether the fingerprint moves) and did not finish in ten minutes;
 * this returns in seconds and answers the question directly rather than by proxy.
 *
 * ⚠️ REACHED IS NOT KILLABLE, AND NEITHER IS CLAIMED. A function can be executed by a probe whose
 * OUTPUT never varies with it — that is what the engine's control check is for, and it is the check
 * that must still pass. This tool only rules out the cheapest explanation for a blind family:
 * "the battery never ran it at all."
 *
 * USAGE
 *   node tools/probe-reach.mjs --file motiondex-dsp.js
 *   node tools/probe-reach.mjs --file ppgdex-dsp.js --min 5
 *   node tools/probe-reach.mjs --selftest
 * ══════════════════════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { functionRange } from './probe-equivalence.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const IS_MAIN = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/* Every `function NAME(` declaration. Over-inclusive on purpose: a name whose range cannot be
   resolved is simply skipped, which costs nothing, whereas a missed name is a silent blind spot. */
export function declaredFunctions(src) {
  const out = [];
  for (const line of String(src || '').split('\n')) {
    const m = line.match(/(?:^|[^\w$.])function\s+(\w+)\s*\(/);
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/* Insert `__hit("name");` as the first statement of each named function's body.
   PURE and known-answer testable: takes source, returns source. */
export function instrument(src, names, ranges) {
  const lines = String(src || '').split('\n');
  for (const n of names) {
    const r = ranges[n];
    if (!r) continue;
    const i = r.start - 1;
    if (i < 0 || i >= lines.length) continue;
    const at = lines[i].indexOf('{');
    if (at < 0) continue; // a brace on a later line — skip rather than guess and corrupt the source
    lines[i] = lines[i].slice(0, at + 1) + ` __hit(${JSON.stringify(n)});` + lines[i].slice(at + 1);
  }
  return lines.join('\n');
}

/* Classify each function against the battery, given hit counts per family and the set of named fns.
   PURE, so the whole decision is pinned without loading a DSP. */
export function classifyReach(fnNames, namedFns, hitsByFamily) {
  const named = new Set(namedFns);
  const out = { reachedNamed: [], reachedUnnamed: [], namedUnreached: [], neither: [] };
  for (const fn of fnNames) {
    const by = Object.entries(hitsByFamily)
      .filter(([, h]) => h && h[fn])
      .map(([fam, h]) => ({ family: fam, calls: h[fn] }));
    const rec = { fn, by };
    if (by.length && named.has(fn)) out.reachedNamed.push(rec);
    else if (by.length) out.reachedUnnamed.push(rec);
    else if (named.has(fn)) out.namedUnreached.push(rec);
    else out.neither.push(rec);
  }
  return out;
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

  const SRC = ['function a(x) {', '  return x;', '}', 'function b() { return 1; }'].join('\n');
  ok('declaredFunctions finds both forms', JSON.stringify(declaredFunctions(SRC)) === '["a","b"]', JSON.stringify(declaredFunctions(SRC)));

  const R = { a: functionRange(SRC, 'a'), b: functionRange(SRC, 'b') };
  const inst = instrument(SRC, ['a', 'b'], R);
  ok('the counter lands INSIDE the body, right after the brace', inst.split('\n')[0] === 'function a(x) { __hit("a");', JSON.stringify(inst.split('\n')[0]));
  ok('…and a one-line function is instrumented too', inst.split('\n')[3].startsWith('function b() { __hit("b");'), JSON.stringify(inst.split('\n')[3]));
  /* The instrumented source must still PARSE — an injection that corrupts the file would report
     "nothing reached" for every function, which reads exactly like a useless battery. */
  let parsed = true;
  try {
    new vm.Script(inst);
  } catch (_) {
    parsed = false;
  }
  ok('the instrumented source still parses', parsed);
  ok('an unresolvable range is skipped, not guessed', instrument(SRC, ['nope'], {}) === SRC);
  /* A declaration whose brace is on the NEXT line must be left alone rather than half-injected. */
  const SPLIT = 'function c(\n  x\n) {\n  return x;\n}';
  ok('a declaration with its brace on a later line is skipped', instrument(SPLIT, ['c'], { c: { start: 1, end: 5 } }) === SPLIT);

  const cls = classifyReach(['a', 'b', 'c', 'd'], ['a', 'c'], { fam1: { a: 3, b: 7 } });
  ok('reached AND named is already covered', cls.reachedNamed.length === 1 && cls.reachedNamed[0].fn === 'a');
  ok('reached but NOT named is the free win', cls.reachedUnnamed.length === 1 && cls.reachedUnnamed[0].fn === 'b', JSON.stringify(cls.reachedUnnamed));
  ok('…and it reports WHICH family reaches it, with the call count', cls.reachedUnnamed[0].by[0].family === 'fam1' && cls.reachedUnnamed[0].by[0].calls === 7);
  ok('named but NOT reached is a battery that does not exercise it', cls.namedUnreached.length === 1 && cls.namedUnreached[0].fn === 'c');
  ok('neither is an unwritten family', cls.neither.length === 1 && cls.neither[0].fn === 'd');
  ok('no families at all ⇒ nothing is reached', classifyReach(['a'], [], {}).neither.length === 1);
  ok('a family with a zero count does NOT count as reached', classifyReach(['a'], [], { f: { a: 0 } }).neither.length === 1);

  console.log('\n' + (fail ? `✗ ${fail} failed, ${pass} passed` : `✓ all ${pass} selftests passed`));
  process.exit(fail ? 1 : 0);
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────
if (IS_MAIN && !has('--selftest')) {
  const file = opt('--file', '');
  if (!file) {
    console.error('usage: node tools/probe-reach.mjs --file <dsp.js> [--min N]');
    process.exit(2);
  }
  const min = Number(opt('--min', '1')) || 1;
  const src = readFileSync(join(ROOT, file), 'utf8');
  const battery = await import(join(ROOT, 'tools/probe-batteries', file.replace(/\.js$/, '') + '.mjs'));

  const names = declaredFunctions(src);
  const ranges = {};
  for (const n of names) {
    const r = functionRange(src, n);
    if (r) ranges[n] = r;
  }
  const inst = instrument(src, names, ranges);

  const hitsByFamily = {};
  const hits = Object.create(null);
  const ctx = battery.realmGlobals ? battery.realmGlobals() : {};
  ctx.globalThis = ctx;
  ctx.__hit = (n) => {
    hits[n] = (hits[n] || 0) + 1;
  };
  for (const d of battery.deps || []) vm.runInNewContext(readFileSync(join(ROOT, d), 'utf8').replace(/^export\s.*$/gm, ''), ctx, { timeout: 30000 });
  vm.runInNewContext(inst.replace(/^export\s.*$/gm, ''), ctx, { timeout: 30000 });
  const subj = battery.subject(ctx);
  if (!subj) {
    console.error('battery.subject() returned nothing — the instrumented module did not publish its namespace');
    process.exit(2);
  }
  for (const fam of battery.families) {
    for (const k in hits) delete hits[k];
    try {
      fam.probe(subj);
    } catch (_) {
      /* a throwing probe still tells us what it reached before it threw */
    }
    hitsByFamily[fam.name || fam.fn] = { ...hits };
  }

  const cls = classifyReach(
    names,
    battery.families.map((f) => f.fn),
    hitsByFamily
  );
  const show = (rows) => rows.filter((r) => !r.by.length || r.by.reduce((a, b) => a + b.calls, 0) >= min);

  console.log(`▸ ${file} — ${names.length} function(s), ${battery.families.length} famil(ies)`);
  console.log(`  ✓ reached AND named   ${cls.reachedNamed.length}   (already covered)`);
  const free = show(cls.reachedUnnamed);
  console.log(`  ★ REACHED, NOT NAMED  ${cls.reachedUnnamed.length}   ← register the existing probe under these; one line each`);
  for (const r of free.slice(0, 30)) console.log(`      ${r.fn.padEnd(26)} ${r.by.map((b) => `${b.family.split(' ')[0]}(${b.calls})`).join(' ')}`);
  console.log(`  ⚠ NAMED, NOT REACHED  ${cls.namedUnreached.length}   ← the battery never runs these; needs an input SHAPE, not a registration`);
  for (const r of cls.namedUnreached.slice(0, 20)) console.log(`      ${r.fn}`);
  console.log(`  ∘ neither             ${cls.neither.length}   (no family, never executed)`);
  process.exit(0);
}
