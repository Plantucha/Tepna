#!/usr/bin/env node
/*
 * tools/probe-coverage.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * A BATTERY CAN ONLY CLASSIFY SURVIVORS INSIDE ITS FAMILIES' FUNCTIONS — AND NOTHING SAID SO.
 *
 * `probe-equivalence` scores each family against the mutants in its `fn`'s LINE RANGE. A survivor in
 * a function no family names is not "unclassified"; it is INVISIBLE. It is not counted, not reported,
 * and not missed. The run ends "✓ all controls separated" and looks complete.
 *
 * MEASURED 2026-08-10, and the spread is not subtle:
 *
 *   ppgdex-dsp.js     736 survivors    57 claimable    679 INVISIBLE  (92 %)
 *   cpapdex-dsp.js    488             133             355            (73 %)
 *   motiondex-dsp.js  287              92             195            (68 %)
 *   hrvdex-dsp.js     298             217              81            (27 %)
 *
 * ppgdex had three families for a 46-function module. Its probe reported clean runs throughout.
 *
 * This is the same failure this repo keeps meeting — a gate that passes without examining the thing
 * it names (`ui-export-paths-broken`, CLAUDE.md §👥.4b). The fix is not a better battery; it is a
 * number that makes the omission visible, so a battery's REACH is reported next to its verdicts.
 *
 * WHAT IT DOES NOT CLAIM. Claimable ≠ classified: a family still has to separate its controls, and a
 * distinguishable survivor is debt rather than a win. This measures only whether the prober could
 * form an opinion at all — the difference between "we looked and found a real gap" and "we never
 * looked". Those two were previously indistinguishable in the output.
 *
 * USAGE
 *   node tools/probe-coverage.mjs --sweep <file.json> [--file <dsp.js>]
 *   node tools/probe-coverage.mjs --all          # every battery with a sweep named on the CLI
 *   node tools/probe-coverage.mjs --selftest
 * ══════════════════════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { functionRange } from './probe-equivalence.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const IS_MAIN = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/* The whole decision, pure so it can be known-answer tested without a sweep or a battery on disk.
   `ranges` is [{fn, start, end}]; `survivors` is [{line}]. A survivor is CLAIMABLE when some family's
   range contains its line. Ranges may overlap (a nested function inside a claimed one) — a survivor
   is claimed once, not once per containing range. */
export function coverage(survivors, ranges) {
  const claimed = [];
  const invisible = [];
  for (const m of survivors || []) {
    const hit = (ranges || []).some((r) => r && m.line >= r.start && m.line <= r.end);
    (hit ? claimed : invisible).push(m);
  }
  const total = claimed.length + invisible.length;
  return {
    total,
    claimed: claimed.length,
    invisible: invisible.length,
    pct: total ? Math.round((1000 * claimed.length) / total) / 10 : 0,
    invisibleMutants: invisible
  };
}

/* Attribute the invisible survivors to their INNERMOST enclosing function, so the report names what
   to write a family for rather than just counting the hole. */
export function attribute(src, mutants, fnNames) {
  const ranges = [];
  for (const n of fnNames) {
    const r = functionRange(src, n);
    if (r) ranges.push({ fn: n, start: r.start, end: r.end });
  }
  const out = new Map();
  for (const m of mutants) {
    const inside = ranges.filter((r) => m.line >= r.start && m.line <= r.end).sort((a, b) => a.end - a.start - (b.end - b.start));
    const k = inside.length ? inside[0].fn : '(top level)';
    out.set(k, (out.get(k) || 0) + 1);
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]);
}

/* Every `function NAME(` in the file — the candidate set to attribute against. Deliberately naive and
   deliberately OVER-inclusive: a name that is not a real function simply never matches a range. */
export function declaredFunctions(src) {
  const names = [];
  for (const line of String(src || '').split('\n')) {
    const m = line.match(/(?:^|[^\w$.])function\s+(\w+)\s*\(/);
    if (m && !names.includes(m[1])) names.push(m[1]);
  }
  return names;
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
  const S = (...ls) => ls.map((l) => ({ line: l }));

  let c = coverage(S(5, 15, 25), [{ fn: 'a', start: 1, end: 10 }]);
  ok('a survivor inside a family range is claimed', c.claimed === 1, JSON.stringify({ claimed: c.claimed, invisible: c.invisible }));
  ok('…and the ones outside every range are INVISIBLE, not "unclassified"', c.invisible === 2);
  ok('the percentage is of the whole survivor set', c.pct === 33.3, String(c.pct));

  ok('NO ranges ⇒ nothing is claimable, and that is the headline case', coverage(S(1, 2, 3), []).invisible === 3);
  ok('a range covering everything claims everything', coverage(S(1, 2, 3), [{ fn: 'a', start: 1, end: 99 }]).invisible === 0);
  /* Overlapping ranges are normal — `analyze` contains helpers that are themselves named families.
     A survivor in both must be counted ONCE, or coverage exceeds 100 %. */
  const ov = coverage(S(5), [
    { fn: 'outer', start: 1, end: 50 },
    { fn: 'inner', start: 3, end: 8 }
  ]);
  ok('overlapping ranges do not double-count a survivor', ov.claimed === 1 && ov.total === 1, JSON.stringify({ claimed: ov.claimed, total: ov.total }));
  ok('boundaries are INCLUSIVE at both ends', coverage(S(1, 10), [{ fn: 'a', start: 1, end: 10 }]).invisible === 0);
  ok('one past the end is outside', coverage(S(11), [{ fn: 'a', start: 1, end: 10 }]).invisible === 1);
  ok('an empty survivor list is 0 %, not NaN', coverage([], [{ fn: 'a', start: 1, end: 3 }]).pct === 0);
  ok('null inputs do not throw', coverage(null, null).total === 0);
  /* A range that could not be resolved (functionRange returned null) must not silently claim
     everything — it is dropped by the caller, and a null entry here is inert. */
  ok('a null range entry claims nothing', coverage(S(5), [null]).invisible === 1);

  const SRC = ['function outer(a) {', '  var x = 1;', '  function inner(b) {', '    return b;', '  }', '  return x;', '}', 'function other() { return 2; }'].join('\n');
  ok('declaredFunctions finds every declaration', JSON.stringify(declaredFunctions(SRC)) === '["outer","inner","other"]', JSON.stringify(declaredFunctions(SRC)));
  const att = attribute(SRC, S(4), declaredFunctions(SRC));
  ok('attribution picks the INNERMOST enclosing function', att.length === 1 && att[0][0] === 'inner', JSON.stringify(att));
  const att2 = attribute(SRC, S(2, 4), declaredFunctions(SRC));
  ok(
    '…and separates a sibling line in the outer one',
    JSON.stringify(att2.sort()) ===
      JSON.stringify(
        [
          ['inner', 1],
          ['outer', 1]
        ].sort()
      ),
    JSON.stringify(att2)
  );
  ok('a line in no function is attributed to (top level)', attribute(SRC, S(99), declaredFunctions(SRC))[0][0] === '(top level)');

  console.log('\n' + (fail ? `✗ ${fail} failed, ${pass} passed` : `✓ all ${pass} selftests passed`));
  process.exit(fail ? 1 : 0);
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────
if (IS_MAIN && !has('--selftest')) {
  const sweepPath = opt('--sweep', '');
  if (!sweepPath) {
    console.error('usage: node tools/probe-coverage.mjs --sweep <file.json> [--file <dsp.js>]');
    process.exit(2);
  }
  const sweep = JSON.parse(readFileSync(sweepPath, 'utf8'));
  const file = opt('--file', sweep.file || '');
  if (!file) {
    console.error('could not determine the DSP file — pass --file');
    process.exit(2);
  }
  const survivors = sweep.survivors || ((sweep.files && sweep.files[0] && sweep.files[0].mutants) || []).filter((m) => m.status === 'survived');
  const src = readFileSync(join(ROOT, file), 'utf8');
  const battery = await import(join(ROOT, 'tools/probe-batteries', file.replace(/\.js$/, '') + '.mjs'));

  const ranges = [];
  const unresolved = [];
  for (const f of battery.families) {
    const r = functionRange(src, f.fn);
    if (r) ranges.push({ fn: f.fn, start: r.start, end: r.end });
    else unresolved.push(f.fn);
  }

  const c = coverage(survivors, ranges);
  console.log(`▸ ${file}  ${c.total} survivor(s) · ${battery.families.length} famil(ies), ${ranges.length} resolved`);
  console.log(`  CLAIMABLE ${c.claimed} (${c.pct} %)   INVISIBLE ${c.invisible}`);
  if (unresolved.length) console.log(`  ⚠ ${unresolved.length} family fn(s) do not resolve to a function in this file: ${unresolved.join(', ')}`);
  if (c.invisible) {
    console.log('  the invisible survivors, by enclosing function — each one is a family nobody wrote:');
    for (const [fn, n] of attribute(src, c.invisibleMutants, declaredFunctions(src)).slice(0, 20)) console.log(`    ${String(n).padStart(4)}  ${fn}`);
  } else {
    console.log('  every survivor is inside some family — coverage is complete for this sweep.');
  }
  /* Non-zero exit when a MAJORITY is invisible: that is not a report, it is a defect in the battery,
     and it should be able to fail something. */
  process.exit(c.total && c.invisible > c.claimed ? 1 : 0);
}
