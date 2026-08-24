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
  /* §8 (MUTATION-PROGRAM-FOLLOWUPS): arrow consts were INVISIBLE — `const rmssd = (a) => {…}`
     resolved to null, so whole families claimed nothing and probe-coverage warned unresolved-fn.
     The declaration is now any of: `function NAME(` · `const/let/var NAME = (…) =>` (async ok,
     single-param-no-parens ok) · `const/let/var NAME = function`. Escaping also widened from `$`
     alone to every metacharacter — same three-character fix killcheck's copy already carries. */
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const decl = new RegExp('(?:^|[^\\w$.])(?:function\\s+' + esc + '\\s*\\(|(?:const|let|var)\\s+' + esc + '\\s*=\\s*(?:async\\s*)?(?:function\\b|\\(|[\\w$]+\\s*=>))');
  /* 🔴 AMBIGUITY IS A REFUSAL, NOT A COIN FLIP (MUTATION-PROGRAM-FOLLOWUPS §10.5).
     Scanning for the FIRST declaration and stopping is what §10.5 records costing a whole run: a
     harness "mutated `computeRMSSDarc` and reported the result under the name of a function it had
     never touched". Its remedy is that a locating tool must fail loudly when the pattern is absent
     or AMBIGUOUS, printing a `hits > 1` count.
     ⚠️ Live in this tree: `oxydex-dsp.js` declares `_median` TWICE (lines 1900 and 7168, different
     scopes, DIFFERENT BODIES — one returns null on empty, the other does not). Every tool scoping to
     `_median` silently took the first.
     Absent still returns null — "no such function" is actionable. Ambiguous is not: there is no
     correct single range, so returning one is the bug. Mirrors killcheck's copy, per the standing
     rule that the copies agree about what a function is. */
  const _decls = [];
  for (let i = 0; i < lines.length; i++) if (decl.test(lines[i])) _decls.push(i + 1);
  if (_decls.length > 1) {
    throw new Error(
      `functionRange: ${JSON.stringify(name)} is AMBIGUOUS — ${_decls.length} declarations at lines ` +
        `${_decls.join(', ')}. Returning the first would report a verdict about a function the caller may not mean.`
    );
  }
  let start = -1;
  for (let i = 0; i < lines.length; i++)
    if (decl.test(lines[i])) {
      start = i;
      break;
    }
  if (start < 0) return null;
  /* A CONCISE arrow (`=> expr`, no braces) has no block to count — its range is its own line. The
     brace counter below would otherwise swallow the rest of the file into a fake range. Multi-line
     concise bodies are an accepted, documented miss: rare here, and a miss returns a 1-line range
     (under-claims) rather than a wrong big one. */
  if (/=>\s*[^\s{]/.test(lines[start])) return { start: start + 1, end: start + 1 };
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

/* ── A SWEEP ARRIVES IN TWO FORMATS, AND THIS TOOL COULD ONLY READ ONE ────────────────────────
   `mutate.mjs --json` emits NDJSON — one dense line per file — so the original reader took the first
   line starting with `{` and parsed that. `tools/mutation-crawl.mjs:365` writes the SAME record
   `JSON.stringify(rec, null, 2)`, pretty-printed, whose first `{`-line is the bare character `{`.

   The two tools were built to feed each other and could not. MUTATION-PROGRAM §2a says the crawl
   sweeps sit on disk "each with its complete survivor list in exactly the shape `probe-equivalence`
   reads"; that was written from the record's field names, never from running it, and it is false.
   Measured 2026-08-09 on `hrvdex-dsp.js.sweep.json`: `SyntaxError: Expected property name or '}' at
   position 1`, under an error message that told the reader the file had no JSON object in it when
   the whole file IS one. 298 survivors were unreachable behind a newline.

   Whole-file first, because it is the unambiguous case: a pretty-printed record cannot be valid
   NDJSON, and a one-line NDJSON record with a single file in it parses identically either way. The
   line scan stays for the genuine multi-file NDJSON stream. */
export function parseSweep(text) {
  const t = text.trim();
  if (!t) throw new Error('empty file — a sweep that wrote nothing is not a sweep of nothing');
  try {
    return JSON.parse(t);
  } catch (_) {
    /* not whole-file JSON — fall through to the NDJSON stream */
  }
  const line = text.split('\n').find((l) => l.trim().startsWith('{'));
  if (!line) throw new Error('neither whole-file JSON nor NDJSON — no parseable JSON object found');
  try {
    return JSON.parse(line);
  } catch (e) {
    throw new Error('found a `{` line but it does not parse: ' + String(e && e.message).slice(0, 80));
  }
}

/* A baseline whose every input produced the same answer proves the subject never ran (rule 2). */
export function batteryIsDegenerate(baseline, minDistinct) {
  return new Set(baseline).size < minDistinct;
}

/* ── RE-APPLYING A MUTANT FROM JSON, WITHOUT REBUILDING IT FROM A DISPLAY FIELD ───────────────
   `mutate.mjs` records `before`/`after` TRUNCATED AT 100 CHARACTERS — they are what a terminal
   prints and what `(line, op, before)` keys on, never a copy of the line. The executable mutation is
   a closure `apply()` that JSON cannot carry. This function used to rebuild the line as
   `indent + after.trim()`, so on any source line longer than 100 chars it wrote back a line cut
   mid-expression, and the realm then failed to parse it.

   That failed CLOSED — an unparseable realm is never emitted as an equivalence — but it failed
   SILENTLY and at scale: measured 2026-08-09 on hrvdex-dsp.js, 42 of 217 probed survivors reported
   `REALM-FAIL … Unexpected token 'const'`, which reads as a fact about the mutant and was a fact
   about this line. 19 % of the file's survivors were dropped from the measurement while the run
   printed a confident count of the rest. CLAUDE.md §👥.4b, in a third tool.

   `mutate.mjs --dry-run --json` now also emits `mutated` — the same line, untruncated. Prefer it.
   Without it, REFUSE: a truncated reconstruction is indistinguishable from a mutant that genuinely
   does not parse, and guessing here is what produced the 42. */
export function applyMutant(lines, m) {
  const L = lines.slice();
  if (typeof m.mutated === 'string') {
    L[m.line - 1] = m.mutated;
    return L.join('\n');
  }
  const after = (m.after || '').trim();
  const src = L[m.line - 1];
  if (after.length >= 100 && src.trim().length > after.length)
    throw new Error(`mutant L${m.line} [${m.op}] has no \`mutated\` field and its \`after\` is truncated at ${after.length} chars — re-enumerate with a current mutate.mjs`);
  L[m.line - 1] = src.match(/^\s*/)[0] + after;
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

  const REC = { file: 'x.js', killed: 2, survivors: [{ line: 9, op: 'cmp', after: 'a >= b' }], invalids: [] };
  ok('parseSweep reads NDJSON — one dense line, the mutate.mjs --json shape', parseSweep(JSON.stringify(REC) + '\n').survivors[0].line === 9);
  ok(
    'parseSweep reads a PRETTY-PRINTED whole file — the mutation-crawl shape the old reader could not',
    parseSweep(JSON.stringify(REC, null, 2) + '\n').survivors[0].line === 9,
    'its first `{`-line is the bare character `{`'
  );
  ok('parseSweep takes the FIRST record of a multi-file NDJSON stream', parseSweep([JSON.stringify(REC), JSON.stringify({ file: 'y.js', survivors: [] })].join('\n')).file === 'x.js');
  ok('parseSweep tolerates a leading progress/banner line before the NDJSON', parseSweep('sweeping x.js …\n' + JSON.stringify(REC) + '\n').survivors[0].line === 9);
  ok(
    'parseSweep REFUSES an empty file rather than reading it as an empty sweep',
    (() => {
      try {
        parseSweep('   \n');
        return false;
      } catch (e) {
        return /empty file/.test(e.message);
      }
    })(),
    'a sweep that wrote nothing must not read as a sweep with no survivors'
  );
  ok(
    'parseSweep REFUSES a truncated record instead of silently probing a prefix',
    (() => {
      try {
        parseSweep(JSON.stringify(REC).slice(0, 40));
        return false;
      } catch (e) {
        return /does not parse|no parseable/.test(e.message);
      }
    })()
  );

  ok('applyMutant preserves indentation', applyMutant(['    if (a > b) x();'], { line: 1, after: 'if (a >= b) x();' })[0] === ' ', 'leading run kept');
  ok(
    'applyMutant uses `mutated` VERBATIM when present — the untruncated line',
    (() => {
      const long = '      const x = ' + 'a'.repeat(120) + ' > 0 ? 1 : 2;';
      const mut = long.replace('> 0', '>= 0');
      return applyMutant([long], { line: 1, op: 'cmp > → >=', after: mut.trim().slice(0, 100), mutated: mut }) === mut;
    })(),
    'a 100-char `after` would have cut it mid-expression'
  );
  ok(
    'applyMutant REFUSES a truncated `after` with no `mutated` rather than writing invalid code',
    (() => {
      const long = '      const x = ' + 'a'.repeat(120) + ' > 0 ? 1 : 2;';
      try {
        applyMutant([long], { line: 1, op: 'cmp > → >=', after: long.replace('> 0', '>= 0').trim().slice(0, 100) });
        return false;
      } catch (e) {
        return /truncated/.test(e.message);
      }
    })(),
    'the 42-of-217 hrvdex failure, caught at the source'
  );
  ok(
    'applyMutant still accepts a SHORT `after` with no `mutated` — an older sweep is not broken',
    applyMutant(['  if (a > b) x();'], { line: 1, op: 'cmp > → >=', after: 'if (a >= b) x();' }).trim() === 'if (a >= b) x();'
  );
  ok('mutantKey ignores surrounding whitespace in `after`', mutantKey({ line: 5, op: 'cmp', after: '  x  ' }) === mutantKey({ line: 5, op: 'cmp', after: 'x' }));
  ok(
    'the LEDGER key is `line op before` UNTRIMMED — a 100-char cut landing on a space must still match',
    (() => {
      /* mutate.mjs: before = L.trim().slice(0, 100). On a long line that can end in a space, and
         classifySurvivors keys on it verbatim. Trimming when emitting orphaned 6 real entries. */
      /* 99 chars then a space at index 99 — the real case was hrvdex-dsp.js L735, a 154-char
         `const hrmax_tanaka = …` whose 100th character is the space before `_hrRestR`. */
      const line = '  const hrmax_tanaka = ' + 'p'.repeat(76) + ' > _hrRestR + 45 ? x : y;';
      const before = line.trim().slice(0, 100);
      const ledgerKey = (e) => e.line + ' ' + e.op + ' ' + e.before;
      return before.endsWith(' ') && ledgerKey({ line: 735, op: 'num → 0', before }) !== ledgerKey({ line: 735, op: 'num → 0', before: before.trim() });
    })(),
    'so the emitter must write `before` verbatim, never re-trim it'
  );

  // §8 — arrow consts are now first-class declarations
  const ARROWSRC = [
    'const rmssd = (a) => {',
    '  return a + 1;',
    '};',
    'let f2 = async (x) => {',
    '  return x;',
    '};',
    'var pi2 = () => 3.14;',
    'const g = x => {',
    '  return x * 2;',
    '};',
    'const h = function (q) {',
    '  return q;',
    '};'
  ].join('\n');
  ok('a block-body arrow const resolves', JSON.stringify(functionRange(ARROWSRC, 'rmssd')) === JSON.stringify({ start: 1, end: 3 }), JSON.stringify(functionRange(ARROWSRC, 'rmssd')));
  ok('an async arrow resolves', functionRange(ARROWSRC, 'f2') !== null && functionRange(ARROWSRC, 'f2').start === 4);
  ok(
    'a CONCISE arrow is its own line — never a fake file-long range',
    JSON.stringify(functionRange(ARROWSRC, 'pi2')) === JSON.stringify({ start: 7, end: 7 }),
    JSON.stringify(functionRange(ARROWSRC, 'pi2'))
  );
  ok('a single-param no-parens arrow resolves', functionRange(ARROWSRC, 'g') !== null && functionRange(ARROWSRC, 'g').start === 8);
  ok('a const function-expression resolves', functionRange(ARROWSRC, 'h') !== null && functionRange(ARROWSRC, 'h').start === 11);
  ok('…and a name that is only a SUFFIX of another does not match it', functionRange(ARROWSRC, 'i2') === null, JSON.stringify(functionRange(ARROWSRC, 'i2')));

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

  console.log('\n' + (fail ? `✗ ${fail} failed, ${pass} passed` : `✓ all ${pass} selftests passed`));
  process.exit(fail ? 1 : 0);
}

/* ── child mode ───────────────────────────────────────────────────────────────────────────────
   One mutant, one realm, one fingerprint, then exit. The parent bounds it with a timeout, so this
   half deliberately has no error handling for non-termination: it is allowed to hang, and being
   killed IS the verdict it reports. Communicates by FILE, never a pipe — a fingerprint is one entry
   per battery input and runs to hundreds of KB. */
async function probeOne(base) {
  const req = JSON.parse(readFileSync(base + '.in.json', 'utf8'));
  const write = (o) => writeFileSync(base + '.out.json', JSON.stringify(o));
  const bPath = join(ROOT, 'tools/probe-batteries', req.file.replace(/\.js$/, '') + '.mjs');
  const battery = await import(bPath);
  const src = readFileSync(join(ROOT, req.file), 'utf8');
  const deps = (battery.deps || []).map((f) => readFileSync(join(ROOT, f), 'utf8'));
  const ctx = battery.realmGlobals ? battery.realmGlobals() : {};
  ctx.globalThis = ctx;
  if (!ctx.console) ctx.console = { log() {}, warn() {}, error() {} };
  try {
    for (const d of deps) vm.runInNewContext(d.replace(/^export\s.*$/gm, ''), ctx, { timeout: 15000 });
    vm.runInNewContext(applyMutant(src.split('\n'), req.mutant).replace(/^export\s.*$/gm, ''), ctx, { timeout: 15000 });
  } catch (e) {
    return write({ err: String(e && e.message).slice(0, 70) });
  }
  let subj;
  try {
    subj = battery.subject(ctx);
  } catch (e) {
    return write({ err: 'subject: ' + String(e && e.message).slice(0, 60) });
  }
  if (!subj) return write({ err: 'battery.subject() returned nothing' });
  try {
    write({ fp: battery.families[req.family].probe(subj) });
  } catch (e) {
    write({ fp: ['THREW:' + String(e && e.message).slice(0, 60)] });
  }
}
if (IS_MAIN && has('--probe-one')) {
  await probeOne(argv[argv.indexOf('--probe-one') + 1]);
  process.exit(0);
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

  let sweep;
  try {
    sweep = parseSweep(readFileSync(SWEEP, 'utf8'));
  } catch (e) {
    console.error(`${SWEEP}: ${e.message}`);
    process.exit(2);
  }
  const survKeys = new Set((sweep.survivors || []).map(mutantKey));
  /* ⚠ INVALID IS A THIRD STATE, AND TREATING IT AS "KILLED" HANGS THE RUN.
     A sweep partitions mutants into killed / survived / INVALID (non-terminating, or producing no
     output). Selecting controls as "everything that is not a survivor" therefore sweeps the invalids
     into the control pool — and an invalid mutant is, by definition, one that does not terminate.
     Measured 2026-08-09: `ppgdex-dsp.js:1889 [num → 0] df = 0` is inside `lombScargle`, is one of the
     sweep's 15 invalids, and was picked as a control on the first real run. The probe span 43 minutes
     of CPU at 99.9 % with its log untouched, which is indistinguishable from a slow battery.
     The sweep already knows which ones these are. Use that. */
  const invalidKeys = new Set((sweep.invalids || []).map(mutantKey));

  /* `deps` are the files the SUITE co-loads before this one (dex-coload.js `shared:`). Loading them is
     not a convenience — omitting one manufactures differences that belong to the probe rather than to
     the code. #1052 discarded a `parsePPG` verdict whose mutant differed only by "DexClock is not
     defined", because that realm had no clock while the suite does. Loaded UNMUTATED, always: a dep is
     context, never a subject. */
  const DEPS = (battery.deps || []).map((f) => readFileSync(join(ROOT, f), 'utf8'));

  /* EVERY MUTANT RUNS IN A CHILD, UNDER A TIMEOUT — a hang is its own verdict, never a kill and never
     an equivalence. `vm`'s own `timeout` bounds only the module LOAD; the battery call afterwards is
     ordinary synchronous JS and cannot be interrupted in-process, so a non-terminating mutant spins
     the whole run forever. Excluding the sweep's `invalids` (above) removes the KNOWN offenders, but
     a mutant that terminates under the test suite can still hang under a battery the suite never ran,
     so the exclusion is necessary and not sufficient. The extra cost is one process spawn per mutant;
     the realm load was being paid either way. */
  const PROBE_MS = +opt('--probe-timeout', 60000);
  function probeInChild(m, famIdx) {
    const base = join(tmpdir(), `probe-one-${process.pid}-${famIdx}-${m.line}`);
    writeFileSync(base + '.in.json', JSON.stringify({ file: FILE, mutant: m, family: famIdx }));
    try {
      execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--probe-one', base], { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'], timeout: PROBE_MS });
    } catch (e) {
      try {
        unlinkSync(base + '.in.json');
      } catch (_) {}
      if (e && (e.killed || e.signal === 'SIGTERM')) return { hang: true };
      return { err: 'child exit ' + (e && e.status) };
    }
    let out = null;
    try {
      out = JSON.parse(readFileSync(base + '.out.json', 'utf8'));
    } catch (_) {
      out = { err: 'child wrote nothing' };
    }
    try {
      unlinkSync(base + '.in.json');
      unlinkSync(base + '.out.json');
    } catch (_) {}
    return out;
  }

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
  const blindFamilies = [];

  for (const [famIdx, fam] of battery.families.entries()) {
    const range = functionRange(SRC, fam.fn);
    if (!range) {
      console.log(`▸ ${fam.name}\n  ✗ SKIPPED — function \`${fam.fn}\` not found in ${FILE}\n`);
      continue;
    }
    const inRange = (m) => m.line >= range.start && m.line <= range.end;
    const survivors = dry.filter((m) => inRange(m) && survKeys.has(mutantKey(m)) && !invalidKeys.has(mutantKey(m)));
    /* KILLED = not a survivor AND not invalid. See the invalidKeys note: "everything that is not a
       survivor" silently includes the non-terminating ones. */
    const controlsAll = dry.filter((m) => inRange(m) && !survKeys.has(mutantKey(m)) && !invalidKeys.has(mutantKey(m)));

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
      blindFamilies.push(fam.name);
      console.log(`  ⚠ DEGENERATE BATTERY — ${new Set(baseFp).size} distinct answer(s) over ${baseFp.length} inputs.`);
      console.log('    The subject almost certainly never ran (cf. #1052: PPGDSP.loadOwnExport is undefined).');
      console.log('    Every verdict in this family is void and nothing is emitted.\n');
      continue;
    }

    /* RULE 1 — controls FROM THIS FUNCTION. No controls means no evidence of reach, which is not the
       same as a clean bill and must not read like one. */
    const controls = sampleEvenly(controlsAll, NCTL);
    if (!controls.length) {
      blindFamilies.push(fam.name);
      console.log(`  ⚠ NO CONTROLS — the sweep killed nothing in ${fam.fn}, so the battery's reach is UNPROVEN.`);
      console.log('    Verdicts withheld: an unreached mutant is indistinguishable from an unkillable one.\n');
      continue;
    }
    const joined = (a) => a.join('');
    const B = joined(baseFp);
    let blind = 0,
      ctlRan = 0;
    let ctlHang = 0;
    for (const m of controls) {
      const r = probeInChild(m, famIdx);
      if (r.hang) {
        /* Not a control failure and not evidence about the battery — it is a mutant that does not
           terminate, which the sweep should have recorded as invalid. Skipped, and SAID. */
        ctlHang++;
        console.log(`  ⊘ control HUNG (>${PROBE_MS} ms, skipped)  L${m.line} [${m.op}]`);
        continue;
      }
      if (r.err) continue;
      ctlRan++;
      if (joined(r.fp) === B) {
        blind++;
        console.log(`  ⚠ BLIND control  L${m.line} [${m.op}]  ${(m.after || '').trim().slice(0, 52)}`);
      }
    }
    if (!ctlRan) {
      blindFamilies.push(fam.name);
      console.log(`  ⚠ NO CONTROL RAN — every sampled control failed to load. Reach UNPROVEN; verdicts withheld.\n`);
      continue;
    }
    console.log(`  controls: ${ctlRan - blind}/${ctlRan} killed mutants separated${ctlHang ? ` (${ctlHang} hung, skipped)` : ''}${blind ? '  ← BATTERY IS PARTIALLY BLIND' : ''}`);
    if (blind) {
      blindFamilies.push(fam.name);
      console.log(`  ⚠ ${blind} control(s) read as equivalent. Every verdict in ${fam.name} is VOID and nothing is emitted.`);
      console.log('    Widen the battery until all controls separate, then re-run.\n');
      continue;
    }

    let dist = 0,
      same = 0,
      dead = 0;
    let hung = 0;
    for (const m of survivors) {
      const r = probeInChild(m, famIdx);
      if (r.hang) {
        /* A HANG IS ITS OWN VERDICT. Never a kill, and above all never an equivalence — a mutant that
           does not terminate produced no output to compare, so "byte-identical" would be vacuously
           true and would emit a classification excusing a mutant nobody measured. */
        hung++;
        console.log(`  ⊘ HUNG            L${String(m.line).padEnd(5)} [${m.op.padEnd(14)}] non-terminating under this battery (>${PROBE_MS} ms)`);
        continue;
      }
      if (r.err) {
        dead++;
        console.log(`  REALM-FAIL        L${String(m.line).padEnd(5)} ${r.err}`);
        continue;
      }
      const f = joined(r.fp);
      if (f !== B) {
        dist++;
        console.log(`  DISTINGUISHABLE   L${String(m.line).padEnd(5)} [${m.op.padEnd(14)}] ${(m.after || '').trim().slice(0, 48)}`);
      } else {
        same++;
        console.log(`  no-distinguishing L${String(m.line).padEnd(5)} [${m.op.padEnd(14)}] ${(m.after || '').trim().slice(0, 48)}`);
        emit.push({
          line: m.line,
          op: m.op,
          /* ⚠ VERBATIM, NOT RE-TRIMMED. `classifySurvivors` and `findCanary` key on
             `line + ' ' + op + ' ' + before` with NO normalisation, and `mutate.mjs` builds `before`
             as `L.trim().slice(0, 100)` — a 100-char cut that can land ON A SPACE. Re-trimming it
             here produced a 99-char key that matched nothing, and the entry then read as ORPHANED:
             "excluded from every count until re-verified", i.e. silently dropped. Measured
             2026-08-09 — 6 of hrvdex's 69 entries, all on one long line (L735). The emitted key must
             be byte-identical to the one the matcher builds. */
          before: m.before,
          after: m.after,
          class: 'no-distinguishing-input',
          why: `In ${fam.fn}. Original and mutant produced byte-identical output on every input.`,
          probe: `${fam.name}: ${baseFp.length} inputs, ${new Set(baseFp).size} distinct baseline answers; ${ctlRan}/${ctlRan} same-function controls separated. tools/probe-equivalence.mjs --file ${FILE}`
        });
      }
    }
    console.log(`  → ${dist} distinguishable (real gaps), ${same} no-distinguishing-input${dead ? `, ${dead} realm-fail` : ''}${hung ? `, ${hung} HUNG` : ''} of ${survivors.length} survivor(s)\n`);
  }

  if (EMIT) {
    /* REFUSAL IS PER-FAMILY, NOT PER-RUN, and that is not a weakening. A blind, degenerate or
       uncontrolled family `continue`s before its survivor loop, so its verdicts never enter `emit` in
       the first place — the guard is structural. Refusing the WHOLE run on top of that would only
       withhold verdicts from families whose controls all separated, which is not a safety property,
       just a slower one. What must never happen is silence: the skipped families are named here, and
       their survivors stay UNCLASSIFIED, which is exactly how the sweep will keep reporting them. */
    if (blindFamilies.length) {
      console.log(`⚠ ${blindFamilies.length} famil${blindFamilies.length === 1 ? 'y' : 'ies'} contributed NOTHING (blind / degenerate / uncontrolled): ${blindFamilies.join(', ')}`);
      console.log('  Their survivors remain UNCLASSIFIED by design. Widen the battery and re-run; do not lower the bar.');
    }
    if (!emit.length) {
      console.error('✗ nothing to emit — no family produced a sound no-distinguishing verdict.');
      process.exit(1);
    }
    const path = join(ROOT, 'tools/mutate-equivalence.json');
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    const existing = doc[FILE] || [];
    /* Both sides of the dedup must build the key the SAME way, and the way `classifySurvivors` does:
       no trim. The two halves disagreed (`(e.before||'').trim()` here against a raw `e.before`
       there), so an entry whose `before` ended in a space could be re-emitted as a duplicate. */
    const ekey = (e) => e.line + '|' + e.op + '|' + e.before;
    const seen = new Set(existing.map(ekey));
    const added = emit.filter((e) => !seen.has(ekey(e)));
    doc[FILE] = existing.concat(added);
    writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
    console.log(`emitted ${added.length} new entr${added.length === 1 ? 'y' : 'ies'} for ${FILE} (${emit.length - added.length} already recorded)`);
    console.log('DISTINGUISHABLE survivors are deliberately NOT emitted — they are debt, and they stay in the denominator.');
  } else if (emit.length) {
    console.log(`${emit.length} classifiable survivor(s). Re-run with --emit to record them.`);
  }
}

if (IS_MAIN) await main();
