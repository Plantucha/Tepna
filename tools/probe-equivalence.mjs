#!/usr/bin/env node
/*
 * tools/probe-equivalence.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * IS A SURVIVING MUTANT A TEST GAP, OR IS IT UNKILLABLE? — the general form.
 *
 * A survivor is not automatically a gap: `if (lo < 0) lo = 0` mutated to `<=` still assigns 0 when
 * lo IS 0, and no input will ever separate them. This loads the original and each mutant in separate
 * vm realms, runs a battery through both, and diffs the output — so the question is answered by
 * execution rather than by reading.
 *
 * WHY THIS EXISTS WHEN `probe-clock-equivalence.mjs` ALREADY DID IT. That tool hardcodes `clock.js`,
 * its battery and its callable surface, and it is the ONLY prober in the repo. Meanwhile ~83
 * classifications had been measured with a battery and written down in BRIEF PROSE — 15 for
 * `lombScargle`, 28 for `parsePPG`, 15 for `capture.run_polar` — while `tools/mutate-equivalence.json`
 * carried `clock.js` and nothing else. The batteries that produced them were never committed, so
 * those verdicts cannot be re-checked, widened, or re-run against moved code.
 *
 * That is the failure this file addresses, and transcription was NOT an option:
 * MUTATION-EQUIVALENCE §8.4 — "writing twelve entries from a prose summary would be inventing data
 * of exactly the kind this mechanism exists to replace". So the entries are re-derived by running.
 *
 * ── THE TWO RULES THAT MAKE A VERDICT WORTH ANYTHING ──────────────────────────────────────────
 *
 * 1 · A POSITIVE CONTROL MUST LIVE IN THE SAME FUNCTION AS THE MUTANT IT CLEARS.
 *     A battery that never reaches the code reports "equivalent" — about ITSELF, not about the code —
 *     and that reading is indistinguishable from a real equivalence. So every family first replays
 *     mutants the sweep actually KILLED: a test caught them, therefore a sound battery must separate
 *     them too. If any control comes back equivalent the family prints BLIND and every verdict in it
 *     is void and never emitted.
 *       Not hypothetical. `probe-clock-equivalence`'s first run (2026-08-09) came back 3-of-14 BLIND,
 *     and the sweep before it had cleared those survivors on a battery whose only control sat in a
 *     DIFFERENT function. Hence: the control must be in the family, not merely in the file.
 *
 * 2 · A BATTERY THAT PRODUCES ONE ANSWER FOR EVERY INPUT HAS MEASURED NOTHING.
 *     #1052's first `loadOwnExport` probe reported 0 of 22 distinguishable — a complete artefact. It
 *     read `PPGDSP.loadOwnExport`, which is undefined (the function hangs off `PpgDex`), so every
 *     case threw the identical "not a function" and original matched mutant BY CONSTRUCTION. A probe
 *     that never runs its subject is indistinguishable from one that finds everything equivalent.
 *       So a battery returns an ARRAY — one entry per input, not a pre-joined digest — and the engine
 *     refuses a family whose baseline has fewer than `minDistinct` distinct entries. Variety in the
 *     BASELINE is the evidence that the subject actually ran.
 *
 * A third rule is the caller's, and it cannot be automated: kill with an input that MAGNIFIES the
 * mutant, not merely one that reaches it. `f >= 0.003` → `>` costs one unit in 3910 at 0.0401 Hz and
 * 27 % at exactly 0.003 Hz (#1052). Reaching is necessary; separating is the point.
 *
 * ── WHAT A VERDICT MEANS ──────────────────────────────────────────────────────────────────────
 * DISTINGUISHABLE   an input separates original from mutant ⇒ a test CAN kill it. Real gap, debt.
 * no-distinguishing every input produced byte-identical output. STRONG EVIDENCE, NOT PROOF — a proof
 *                   needs an argument over the whole input domain. `--emit` therefore records the
 *                   battery size in each entry's `probe`, so a claim can be widened rather than
 *                   re-litigated. A wider battery can only ever find MORE, never fewer.
 * REALM-FAIL        the mutant does not parse or the subject vanished. Not a verdict; never emitted.
 *
 * A difference caused by the PROBE REALM is not evidence about the code — #1052 discarded one where
 * the mutant differed only by "DexClock is not defined", because the probe realm has no co-loaded
 * clock while the suite does. Give the realm what the suite gives it (`deps` in the battery), or
 * exclude the function.
 *
 * USAGE
 *   node tools/mutate.mjs --file ppgdex-dsp.js --limit 2000 --bail --json > /tmp/sweep.json
 *   node tools/probe-equivalence.mjs --file ppgdex-dsp.js --sweep /tmp/sweep.json
 *   node tools/probe-equivalence.mjs --file ppgdex-dsp.js --sweep /tmp/sweep.json --emit
 *   node tools/probe-equivalence.mjs --selftest        # known-answer; runs no sweep, writes nothing
 *
 * --emit writes `no-distinguishing-input` entries into tools/mutate-equivalence.json, keyed
 * `(line, op, before)` exactly as `classifySurvivors` reads them. It NEVER writes a DISTINGUISHABLE
 * one: those are real gaps and stay in the denominator, because a classification file is not a place
 * to launder debt into a better number.
 *
 * The battery for a file lives in `tools/probe-batteries/<file>.mjs`. Adding a file is a battery, not
 * a fork of this engine.
 * ══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
/* Importable: the pure helpers below are known-answer tested, and a module that runs its CLI on
   import cannot be tested by anything but a subprocess. */
const IS_MAIN = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/* ── The enclosing-function range, read from the source ───────────────────────────────────────
   A family is a FUNCTION, not a line window a human guessed, because rule 1 is about the function —
   a control only proves reach if it lives in the code the battery claims to exercise.

   Blank out everything that is not code — strings, template literals, both comment forms, and REGEX
   LITERALS — replacing each character with a space so every offset and line number is preserved.

   Counting braces without this does not merely mis-measure, it fails in the direction that destroys
   the method: on `ppgdex-dsp.js` a naive counter ran `lombScargle` from L1865 to L2582 (588 lines
   past its end, swallowing six unrelated functions), so 9 of its 11 "same-function controls" were
   mutants of code the battery has no business reaching — and the family duly reported BLIND. An
   over-wide family manufactures blindness; an over-narrow one manufactures a clean bill. Neither is
   survivable, and the brace inside `/* … { … *\/` or `/[{]/` is enough to cause it. */
export function stripNonCode(src) {
  const out = src.split('');
  const blank = (i) => {
    if (out[i] !== '\n') out[i] = ' ';
  };
  let i = 0;
  const n = src.length;
  /* Whether a `/` here opens a regex or is division: after a value (identifier, number, `)`, `]`)
     it is division; after an operator, `(`, `,`, `{`, `;`, `return` etc. it opens a regex. */
  let prevSignificant = '';
  while (i < n) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') blank(i++);
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      blank(i++);
      blank(i++);
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) blank(i++);
      blank(i++);
      blank(i++);
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      blank(i++);
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') blank(i++);
        if (i < n) blank(i++);
      }
      blank(i++);
      prevSignificant = 'x';
      continue;
    }
    if (ch === '/' && !/[\w$)\]]/.test(prevSignificant)) {
      // regex literal — consume to the unescaped closing slash, honouring a character class
      blank(i++);
      let cls = false;
      while (i < n && src[i] !== '\n') {
        const c = src[i];
        if (c === '\\') {
          blank(i++);
          blank(i++);
          continue;
        }
        if (c === '[') cls = true;
        else if (c === ']') cls = false;
        else if (c === '/' && !cls) {
          blank(i++);
          break;
        }
        blank(i++);
      }
      prevSignificant = 'x';
      continue;
    }
    if (!/\s/.test(ch)) prevSignificant = ch;
    i++;
  }
  return out.join('');
}

export function functionRange(src, name) {
  const code = stripNonCode(src);
  const lines = code.split('\n');
  const decl = new RegExp('(?:^|[^\\w$.])function\\s+' + name.replace(/[$]/g, '\\$') + '\\s*\\(');
  let start = -1;
  for (let i = 0; i < lines.length; i++)
    if (decl.test(lines[i])) {
      start = i;
      break;
    }
  if (start < 0) return null;
  let depth = 0,
    seen = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') {
        depth++;
        seen = true;
      } else if (ch === '}') {
        depth--;
        if (seen && depth === 0) return { start: start + 1, end: i + 1 };
      }
    }
  }
  return null;
}

/* Even stride INCLUDING BOTH ENDS — late lines in a long function must be represented among the
   controls, or the battery is only proven to reach the top of it. A plain `i * len/n` stride does
   not reach the tail (over 10 items picking 3 it stops at index 6 of 9), which is the half a control
   sample most needs to cover: the deepest, least-exercised code sits at the end of a long function. */
export function sampleEvenly(arr, n) {
  if (n <= 0) return [];
  if (arr.length <= n) return arr.slice();
  if (n === 1) return [arr[0]];
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (n - 1))]);
  return out;
}

export const mutantKey = (m) => m.line + '|' + m.op + '|' + (m.after || '').trim();

/* A baseline whose every input produced the same answer proves the subject never ran (rule 2). */
export function batteryIsDegenerate(baseline, minDistinct) {
  return new Set(baseline).size < minDistinct;
}

export function applyMutant(lines, m) {
  const L = lines.slice();
  L[m.line - 1] = L[m.line - 1].match(/^\s*/)[0] + (m.after || '').trim();
  return L.join('\n');
}

// ── selftest ────────────────────────────────────────────────────────────────────────────────
if (IS_MAIN && has('--selftest')) {
  let pass = 0,
    fail = 0;
  const ok = (name, cond, detail) => {
    if (cond) {
      pass++;
      console.log('  ✓ ' + name + (detail ? '  — ' + detail : ''));
    } else {
      fail++;
      console.log('  ✗ ' + name + (detail ? '  — ' + detail : ''));
    }
  };
  const SRC = ['function a() {', '  return 1;', '}', 'function b(x) {', '  function inner() {', '    return 2;', '  }', '  return inner() + x;', '}', 'const z = 3;'].join('\n');
  const ra = functionRange(SRC, 'a');
  ok('functionRange finds a simple function', ra && ra.start === 1 && ra.end === 3, JSON.stringify(ra));
  const rb = functionRange(SRC, 'b');
  ok('functionRange spans a NESTED function rather than stopping at it', rb && rb.start === 4 && rb.end === 9, JSON.stringify(rb));
  ok('functionRange returns null for an absent name', functionRange(SRC, 'nope') === null);
  const rbr = functionRange('function c() {\n  var s = "}";\n  return s;\n}', 'c');
  ok('functionRange ignores a brace inside a STRING', rbr && rbr.end === 4, JSON.stringify(rbr));
  const rcm = functionRange('function d() {\n  // }\n  return 1;\n}', 'd');
  ok('functionRange ignores a brace inside a LINE COMMENT', rcm && rcm.end === 4, JSON.stringify(rcm));
  const rbc = functionRange('function e() {\n  /* } } } */\n  return 1;\n}', 'e');
  ok('functionRange ignores braces inside a BLOCK COMMENT', rbc && rbc.end === 4, JSON.stringify(rbc));
  const rrx = functionRange('function f() {\n  var r = /[{]/;\n  return r;\n}', 'f');
  ok('functionRange ignores a brace inside a REGEX LITERAL', rrx && rrx.end === 4, JSON.stringify(rrx));
  const rdiv = functionRange('function g(a, b) {\n  var q = a / b;\n  var w = b / a;\n  return q + w;\n}', 'g');
  ok('functionRange does not mistake DIVISION for a regex (which would eat the rest of the file)', rdiv && rdiv.end === 5, JSON.stringify(rdiv));
  ok(
    'stripNonCode preserves line count and offsets',
    (() => {
      const src = 'a\n/* x */\n"y"\n/z/\n';
      const s = stripNonCode(src);
      return s.length === src.length && s.split('\n').length === src.split('\n').length;
    })()
  );
  ok('stripNonCode blanks a regex but keeps real code', stripNonCode('var r = /[{]/; var n = 1;').includes('var n = 1;') && !stripNonCode('var r = /[{]/; var n = 1;').includes('{'));
  ok('stripNonCode keeps a brace that IS code', stripNonCode('if (a) { b(); }').includes('{'));
  const wide = functionRange('function h() {\n  /* } */\n  return 1;\n}\nfunction i() {\n  return 2;\n}', 'h');
  ok('a block comment does not let one function SWALLOW the next (the ppgdex L1865–2582 failure)', wide && wide.end === 4, JSON.stringify(wide));

  ok('sampleEvenly returns everything when it fits', sampleEvenly([1, 2, 3], 5).length === 3);
  ok(
    'sampleEvenly REACHES THE LAST element — the deepest code in a long function',
    JSON.stringify(sampleEvenly([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3)) === '[1,6,10]',
    JSON.stringify(sampleEvenly([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3))
  );
  ok(
    'sampleEvenly is strictly ordered and unique on a large draw',
    (() => {
      const s = sampleEvenly(
        Array.from({ length: 200 }, (_, i) => i),
        12
      );
      return s.length === 12 && s[0] === 0 && s[11] === 199 && new Set(s).size === 12;
    })()
  );

  ok('batteryIsDegenerate CATCHES a one-answer baseline (the #1052 artefact)', batteryIsDegenerate(['x', 'x', 'x', 'x'], 2) === true);
  ok('batteryIsDegenerate accepts a varied baseline', batteryIsDegenerate(['x', 'y', 'z'], 2) === false);
  ok('batteryIsDegenerate counts DISTINCT, not length', batteryIsDegenerate(new Array(500).fill('same'), 2) === true, '500 identical inputs is still one answer');

  ok('applyMutant preserves indentation', applyMutant(['    if (a > b) x();'], { line: 1, after: 'if (a >= b) x();' })[0] === ' ', 'leading run kept');
  ok('mutantKey ignores surrounding whitespace in `after`', mutantKey({ line: 5, op: 'cmp', after: '  x  ' }) === mutantKey({ line: 5, op: 'cmp', after: 'x' }));

  console.log('\n' + (fail ? `✗ ${fail} failed, ${pass} passed` : `✓ all ${pass} selftests passed`));
  process.exit(fail ? 1 : 0);
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const FILE = opt('--file', '');
  const SWEEP = opt('--sweep', '');
  const EMIT = has('--emit');
  const NCTL = +opt('--controls', 12);
  if (!FILE || !SWEEP) {
    console.error('usage: node tools/probe-equivalence.mjs --file <src.js> --sweep <mutate --json output> [--emit]');
    console.error('       node tools/probe-equivalence.mjs --selftest');
    process.exit(2);
  }

  const batteryPath = join(ROOT, 'tools/probe-batteries', FILE.replace(/\.js$/, '') + '.mjs');
  if (!existsSync(batteryPath)) {
    console.error(`no battery for ${FILE} — expected ${batteryPath}`);
    console.error('A battery declares the realm and, per family, the inputs. See tools/probe-batteries/README.md');
    process.exit(2);
  }
  const battery = await import(batteryPath);

  const SRC = readFileSync(join(ROOT, FILE), 'utf8');
  const LINES = SRC.split('\n');

  /* Enumerate fresh rather than trusting the sweep's list — a stale enumeration would silently probe
     mutants that no longer exist on this file.

     VIA A FILE, NEVER A PIPE. `ppgdex-dsp.js`'s enumeration is ~1.5 MB of JSON and a child's stdout
     truncates through a pipe at ~146 KB — silently, mid-token, and the truncation lands in the MIDDLE
     of the mutant list, so a naive reader would probe a prefix of the file and report the rest as
     nothing to do. Here it happened to throw on unterminated JSON; that was luck, not a guard. */
  const dryPath = join(tmpdir(), `probe-enum-${process.pid}.json`);
  const fd = openSync(dryPath, 'w');
  try {
    execFileSync(process.execPath, [join(ROOT, 'tools/mutate.mjs'), '--file', FILE, '--dry-run', '--limit', '100000', '--json'], { cwd: ROOT, stdio: ['ignore', fd, 'ignore'] });
  } finally {
    closeSync(fd);
  }
  const dry = JSON.parse(readFileSync(dryPath, 'utf8')).files[0].mutants;
  unlinkSync(dryPath);

  const sweepLine = readFileSync(SWEEP, 'utf8')
    .split('\n')
    .find((l) => l.trim().startsWith('{'));
  if (!sweepLine) {
    console.error(`${SWEEP} has no JSON object — mutate.mjs --json emits NDJSON, one line per file`);
    process.exit(2);
  }
  const sweep = JSON.parse(sweepLine);
  const survKeys = new Set((sweep.survivors || []).map(mutantKey));

  /* `deps` are the files the SUITE co-loads before this one (dex-coload.js `shared:`). Loading them is
     not a convenience — omitting one manufactures differences that belong to the probe rather than to
     the code. #1052 discarded a `parsePPG` verdict whose mutant differed only by "DexClock is not
     defined", because that realm had no clock while the suite does. Loaded UNMUTATED, always: a dep is
     context, never a subject. */
  const DEPS = (battery.deps || []).map((f) => readFileSync(join(ROOT, f), 'utf8'));

  function makeRealm(src) {
    const ctx = battery.realmGlobals ? battery.realmGlobals() : {};
    ctx.globalThis = ctx;
    if (!ctx.console) ctx.console = { log() {}, warn() {}, error() {} };
    try {
      for (const d of DEPS) vm.runInNewContext(d.replace(/^export\s.*$/gm, ''), ctx, { timeout: 15000 });
    } catch (e) {
      return { err: 'dep: ' + String(e && e.message).slice(0, 60) };
    }
    try {
      vm.runInNewContext(src.replace(/^export\s.*$/gm, ''), ctx, { timeout: 15000 });
    } catch (e) {
      return { err: String(e && e.message).slice(0, 70) };
    }
    try {
      const s = battery.subject(ctx);
      return s ? { s } : { err: 'battery.subject() returned nothing' };
    } catch (e) {
      return { err: 'subject: ' + String(e && e.message).slice(0, 60) };
    }
  }

  const base = makeRealm(SRC);
  if (base.err) {
    console.error('BASELINE REALM FAILED — every verdict would be an artefact. ' + base.err);
    process.exit(1);
  }

  console.log(`probe-equivalence · ${FILE}`);
  console.log(`  sweep: ${sweep.killed ?? '?'} killed, ${(sweep.survivors || []).length} survivors, ${(sweep.invalids || []).length} invalid`);
  console.log(`  ${dry.length} mutants enumerated · ${battery.families.length} famil${battery.families.length === 1 ? 'y' : 'ies'} declared\n`);

  const emit = [];
  let anyBlind = false;

  for (const fam of battery.families) {
    const range = functionRange(SRC, fam.fn);
    if (!range) {
      console.log(`▸ ${fam.name}\n  ✗ SKIPPED — function \`${fam.fn}\` not found in ${FILE}\n`);
      continue;
    }
    const inRange = (m) => m.line >= range.start && m.line <= range.end;
    const survivors = dry.filter((m) => inRange(m) && survKeys.has(mutantKey(m)));
    const controlsAll = dry.filter((m) => inRange(m) && !survKeys.has(mutantKey(m)));

    let baseFp;
    try {
      baseFp = fam.probe(base.s);
    } catch (e) {
      console.log(`▸ ${fam.name}\n  ✗ SKIPPED — baseline battery threw: ${String(e && e.message).slice(0, 70)}\n`);
      continue;
    }
    if (!Array.isArray(baseFp)) {
      console.log(`▸ ${fam.name}\n  ✗ SKIPPED — probe() must return an ARRAY (one entry per input) so variety can be checked\n`);
      continue;
    }
    const minDistinct = fam.minDistinct || 2;
    console.log(`▸ ${fam.name}  (L${range.start}–${range.end}) · battery ${baseFp.length} inputs, ${new Set(baseFp).size} distinct answers`);

    /* RULE 2 — variety in the BASELINE is the evidence the subject ran at all. */
    if (batteryIsDegenerate(baseFp, minDistinct)) {
      anyBlind = true;
      console.log(`  ⚠ DEGENERATE BATTERY — ${new Set(baseFp).size} distinct answer(s) over ${baseFp.length} inputs.`);
      console.log('    The subject almost certainly never ran (cf. #1052: PPGDSP.loadOwnExport is undefined).');
      console.log('    Every verdict in this family is void and nothing is emitted.\n');
      continue;
    }

    /* RULE 1 — controls FROM THIS FUNCTION. No controls means no evidence of reach, which is not the
       same as a clean bill and must not read like one. */
    const controls = sampleEvenly(controlsAll, NCTL);
    if (!controls.length) {
      anyBlind = true;
      console.log(`  ⚠ NO CONTROLS — the sweep killed nothing in ${fam.fn}, so the battery's reach is UNPROVEN.`);
      console.log('    Verdicts withheld: an unreached mutant is indistinguishable from an unkillable one.\n');
      continue;
    }
    const joined = (a) => a.join('');
    const B = joined(baseFp);
    let blind = 0,
      ctlRan = 0;
    for (const m of controls) {
      const r = makeRealm(applyMutant(LINES, m));
      if (r.err) continue;
      ctlRan++;
      let f;
      try {
        f = joined(fam.probe(r.s));
      } catch (_) {
        f = 'THREW';
      }
      if (f === B) {
        blind++;
        console.log(`  ⚠ BLIND control  L${m.line} [${m.op}]  ${(m.after || '').trim().slice(0, 52)}`);
      }
    }
    if (!ctlRan) {
      anyBlind = true;
      console.log(`  ⚠ NO CONTROL RAN — every sampled control failed to load. Reach UNPROVEN; verdicts withheld.\n`);
      continue;
    }
    console.log(`  controls: ${ctlRan - blind}/${ctlRan} killed mutants separated${blind ? '  ← BATTERY IS PARTIALLY BLIND' : ''}`);
    if (blind) {
      anyBlind = true;
      console.log(`  ⚠ ${blind} control(s) read as equivalent. Every verdict in ${fam.name} is VOID and nothing is emitted.`);
      console.log('    Widen the battery until all controls separate, then re-run.\n');
      continue;
    }

    let dist = 0,
      same = 0,
      dead = 0;
    for (const m of survivors) {
      const r = makeRealm(applyMutant(LINES, m));
      if (r.err) {
        dead++;
        console.log(`  REALM-FAIL        L${String(m.line).padEnd(5)} ${r.err}`);
        continue;
      }
      let f;
      try {
        f = joined(fam.probe(r.s));
      } catch (_) {
        f = 'THREW';
      }
      if (f !== B) {
        dist++;
        console.log(`  DISTINGUISHABLE   L${String(m.line).padEnd(5)} [${m.op.padEnd(14)}] ${(m.after || '').trim().slice(0, 48)}`);
      } else {
        same++;
        console.log(`  no-distinguishing L${String(m.line).padEnd(5)} [${m.op.padEnd(14)}] ${(m.after || '').trim().slice(0, 48)}`);
        emit.push({
          line: m.line,
          op: m.op,
          before: (m.before || '').trim(),
          after: (m.after || '').trim(),
          class: 'no-distinguishing-input',
          why: `In ${fam.fn}. Original and mutant produced byte-identical output on every input.`,
          probe: `${fam.name}: ${baseFp.length} inputs, ${new Set(baseFp).size} distinct baseline answers; ${ctlRan}/${ctlRan} same-function controls separated. tools/probe-equivalence.mjs --file ${FILE}`
        });
      }
    }
    console.log(`  → ${dist} distinguishable (real gaps), ${same} no-distinguishing-input${dead ? `, ${dead} realm-fail` : ''} of ${survivors.length} survivor(s)\n`);
  }

  if (EMIT) {
    if (anyBlind) {
      console.error('✗ --emit REFUSED: at least one family was blind, degenerate or uncontrolled.');
      console.error('  A classification written from a battery that cannot see is the thing this mechanism replaces.');
      process.exit(1);
    }
    const path = join(ROOT, 'tools/mutate-equivalence.json');
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    const existing = doc[FILE] || [];
    const seen = new Set(existing.map((e) => e.line + '|' + e.op + '|' + (e.before || '').trim()));
    const added = emit.filter((e) => !seen.has(e.line + '|' + e.op + '|' + e.before));
    doc[FILE] = existing.concat(added);
    writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
    console.log(`emitted ${added.length} new entr${added.length === 1 ? 'y' : 'ies'} for ${FILE} (${emit.length - added.length} already recorded)`);
    console.log('DISTINGUISHABLE survivors are deliberately NOT emitted — they are debt, and they stay in the denominator.');
  } else if (emit.length) {
    console.log(`${emit.length} classifiable survivor(s). Re-run with --emit to record them.`);
  }
}

if (IS_MAIN) await main();
