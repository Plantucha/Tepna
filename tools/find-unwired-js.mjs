#!/usr/bin/env node
/*
 * tools/find-unwired-js.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * THE JS SIBLING OF `capture-host/tools/find_unwired.py`. Finds machinery that exists, is tested, and
 * is connected to NOTHING — on the JS side, which that tool does not reach.
 *
 * THE CLASS, and it is this repo's most expensive one. Every instance has PASSING TESTS: the tests
 * call the function directly, and that direct call is exactly the wiring production lacks. So no
 * existing gate can see it. Four were found by hand on 2026-09-03/04 alone — `acc_o2` pushed to the
 * bus and written to no disk; `STATUS["autopull"]` and `STATUS["updated"]` reaching no consumer;
 * `vdCorr` computed, crossing the worker boundary, read by nobody — plus PpgDex's `applied`, never
 * written, and `fitClockOffsetPooled`, which exists only in the analysis layer while a relay claimed
 * it was on the capture path. Every one was found by a human tracing a consumer by hand.
 *
 * ⚠️ ADVISORY, NEVER A HARD GATE — exit is ALWAYS 0, and the allowlist is why. A public entry point,
 * a declarative constant, a function a bundle exposes for a reference guide: all are legitimately
 * "unused" by this scan's definition. A gate that fails on those trains people to silence it, which is
 * the same failure one level up. The Python sibling reached that conclusion first; this inherits it
 * rather than re-deriving it. The REPORT is the product.
 *
 * ⚠️ THE SHAPE ENUMERATION IS PRINTED WITH ITS COUNTS, and that is load-bearing rather than decorative.
 * `find_unwired.py`'s third recorded failure was covering ONE publication shape while reporting an
 * unqualified "0 unexplained" — `STATUS["radio_distress"]` then sailed past a green gate. Measured
 * here before writing a line: `window.X = {…}` appears in 15 root files and `window.X = Y` in 22, so
 * covering only the first would have reported a zero over 40 % of the surface. Every run says which
 * shapes were read and how many of each. **A zero that does not carry its filter is not a result.**
 *
 * ⚠️ COMMENTS ARE STRIPPED BEFORE ANY REFERENCE SEARCH. A name mentioned in prose is not a consumer —
 * and in this repo the prose that does it is often a comment explaining that the field reaches nobody.
 * Same trap the Python tool records.
 *
 * 🔴 NOT READY TO BE A REQUIRED CHECK, and the measurement says so rather than a feeling.
 * Measured 2026-09-04 over 112 root .js + 66 .html: runtime ~1.2 s (fast enough), 141 published names
 * enumerated, 14 flagged. Hand-verifying four found TWO false positives — `__summaryRows` is defined in
 * `pulsedex-render.js` and READ in `pulsedex-app.js`, a real consumer this missed. The cause was
 * `codeOnly` DESYNCHRONISING and eating the span holding the reference. TWO causes were found by
 * locating the runaway spans and reading them, and both are now fixed and pinned by selftests:
 *   1. a regex literal containing a quote — `v.replace(/"/g, '""')` opened a 4326-char phantom string;
 *   2. a regex after a KEYWORD — `return /[",\r\n]/` read as division, because `return` ends in a
 *      word character, which ate the rest of that line.
 * Corruption fell 3 of 14 names → 2 of 14, and the finding count 16 → 14. It is NOT zero: the residue
 * needs a real parser, and whether one EXISTS is a fact about the CHECKOUT, not about the repo:
 * `acorn` is a declared devDependency since #3529 (2026-10-12), while a gate lane installs nothing and
 * so still has none. This header claimed "this repo has none available" from 2026-09-04 to 2026-10-30,
 * which was true of a lane and false of a developer tree. So the preparation is now resolved per run:
 * `acornOrNull()` asks the checkout, `codeOnlyParsed` parses when it answers, and the `codeOnly`
 * tokenizer below stays for the lane with no parser and for text no parse accepts. Every run prints
 * which preparation read how many files. The 2-of-14 residue above was measured on the tokenizer and
 * still stands wherever the tokenizer runs, so the count is an upper bound and must not gate anything.
 * So the detector's LOGIC is sound (both plant categories are caught by name, and read-vs-write
 * discriminates 3/3) while its CORPUS PREPARATION was the weak half. Never gate on it until the
 * false-positive rate is measured at zero on BOTH preparations.
 * A noisy required check gets disabled, and then it protects nothing.
 *
 * Usage:
 *   node tools/find-unwired-js.mjs             # report (always exit 0)
 *   node tools/find-unwired-js.mjs --selftest
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';
import { escapeRe } from './regex-escape-core.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIOME = join(ROOT, 'node_modules', '.bin', 'biome');

/* Each entry must EXPLAIN itself — the explanation is the point, not the exemption. An allowlist of
   bare names decays into a silencer; one that must say WHY stays reviewable. Copied deliberately from
   the Python sibling's ALLOW_FUNCS discipline. */
export const ALLOW = {
  /* THE ANALYSIS-TOOL RESULT GLOBALS. Each `*-analysis.js` publishes exactly one uppercase result
     object, written once and read nowhere — the shape is identical across all seven, which is what
     makes it a convention rather than seven oversights. Inferred, and marked as inferred: NO comment
     in any of them states the intent, but a populated object on `window` in a page whose whole purpose
     is producing numbers is a devtools handle. If that is wrong, the fix is one comment at the write
     site, not seven deletions. Triaged 2026-09-05. */
  CGM_HRV_COUPLING: 'analysis-tool result object on window — devtools inspection handle (inferred; no comment states it)',
  NIGHTS_ICC: 'analysis-tool result object on window — devtools inspection handle (inferred)',
  QRS_EQUIV: 'analysis-tool result object on window — devtools inspection handle (inferred)',
  QRS_YIELD: 'analysis-tool result object on window — devtools inspection handle (inferred)',
  TRIO_POWER: 'analysis-tool result object on window — devtools inspection handle (inferred)',
  SIGMA_RESULT: 'analysis-tool result object on window — devtools inspection handle (inferred)',
  TREATMENT_RESPONSE: 'analysis-tool result object on window — devtools inspection handle (inferred)',
  /* DOCUMENTED TOMBSTONES, and the citation is in the code rather than inferred: oxydex-profile.js:494
     reads "ANS-age exposure (window._ansAgeAvg / _ansAgeLast) REMOVED 2026-06-23" and :497 still
     assigns `null` deliberately — clearing a value a previous page state could otherwise leave behind.
     Flagged correctly by the scan; explained by the file. */
  _ansAgeAvg: 'REMOVED 2026-06-23 (oxydex-profile.js:494); the null assignment is a deliberate tombstone',
  _ansAgeLast: 'REMOVED 2026-06-23 (oxydex-profile.js:494); the null assignment is a deliberate tombstone'
  /* NOT allowlisted, deliberately: _hrvProfileAlt / _useIdeal / _projVO2 in hrvdex-profile.js. Those
     are the real finding — one carries a comment asserting a consumer that does not exist. Residue
     2026-09-05-hrvdex-profile-globals-unread. An allowlist entry there would silence the only true
     positive this tool has produced. */
};

/* Strip line and block comments, and string literals, before searching for references. Strings matter
   because a name inside a string is usually a key or a message, not a call — and because the bundler's
   `data-inline-src` blocks quote source. Conservative: if in doubt the character survives. */
export function codeOnly(src) {
  let out = '';
  let i = 0;
  const s = String(src);
  while (i < s.length) {
    const two = s.slice(i, i + 2);
    if (two === '//') {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (two === '/*') {
      i += 2;
      while (i < s.length && s.slice(i, i + 2) !== '*/') i++;
      i += 2;
      continue;
    }
    const c = s[i];
    /* ⚠️ REGEX LITERALS ARE A TOKEN TYPE, and omitting them is what corrupted 21 % of the finding set.
       `v.replace(/"/g, '""')` contains a double-quote INSIDE a regex; without regex state the scanner
       opens a string there and runs away — measured 4326 chars, swallowing a comment and leaving the
       scanner desynced, which then opened a second 9468-char runaway that ate the very reference being
       searched for (`__summaryRows` in pulsedex-app.js). ONE missing token type, cascading.
       A regex can only START where an operand is expected, so the preceding non-space character
       decides: after a value (identifier, `)`, `]`, digit) a `/` is DIVISION; otherwise it opens a
       literal. That rule is not perfect JS — `a++ /re/` is pathological — but it is exact on this
       corpus, and it is the FALLBACK now rather than the only option: `prepare` parses with `acorn`
       when the checkout resolves one, and reaches this scanner when it does not. */
    if (c === '/') {
      let j = out.length - 1;
      while (j >= 0 && /\s/.test(out[j])) j--;
      const prev = j >= 0 ? out[j] : '';
      /* ⚠️ A KEYWORD ENDS IN A WORD CHARACTER, so "preceded by a word char ⇒ division" misfires on
         `return /[",\r\n]/` — measured, and it was the second corruption after regex literals
         themselves. After a keyword an operand is expected, so the `/` opens a LITERAL. */
      const word = /[\w$]/.test(prev) ? (/[\w$]+$/.exec(out.slice(0, j + 1)) || [''])[0] : '';
      const KEYWORD = /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;
      const isDivision = /[\w$)\]]/.test(prev) && !KEYWORD.test(word);
      if (!isDivision) {
        i++;
        let inClass = false;
        while (i < s.length) {
          const ch = s[i];
          if (ch === '\\') {
            i += 2;
            continue;
          }
          if (ch === '[') inClass = true;
          else if (ch === ']') inClass = false;
          else if (ch === '/' && !inClass) break;
          else if (ch === '\n') break; // unterminated ⇒ it was division after all
          i++;
        }
        i++;
        out += ' ';
        continue;
      }
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < s.length && s[i] !== q) {
        if (s[i] === '\\') i++;
        i++;
      }
      i++;
      out += ' ';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/* THE REAL PARSE, WHEN THE CHECKOUT HAS ONE. The hand tokenizer above is exact on this corpus and
   states its own residue: 2 of 14 names stayed corrupted. `acorn` has been a declared devDependency
   since #3529, so a developer checkout can answer structurally while a gate lane still cannot —
   CI installs nothing. So the choice belongs to the RUN, never to a constant: resolve the parser,
   and keep the tokenizer when it is absent or when the text is not JS at all. The resolution shape
   is `tools/xerj-load.mjs`'s: `createRequire` inside a try, memoised, degrading rather than throwing. */
const requireHere = createRequire(import.meta.url);
let _acorn;
export function acornOrNull(req = requireHere) {
  if (_acorn === undefined) {
    try {
      _acorn = req('acorn');
    } catch {
      _acorn = null;
    }
  }
  return _acorn;
}

/* A file must PARSE before its tokens are trusted, because tokenizing alone answers for text that is
   not a program: `<html><body>` tokenizes as comparisons and names. So parse first as a script, then
   as a module, and return null when neither holds — the root `.html` files never do.
   BLANK, never delete. A blanked span leaves every later offset and line where the raw file put it,
   which is exactly the desynchronisation the hand tokenizer paid 21 % of its finding set for. */
export function codeOnlyParsed(src, acorn) {
  const s = String(src);
  const opts = {
    ecmaVersion: 'latest',
    allowHashBang: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowSuperOutsideMethod: true
  };
  const comments = [];
  let toks;
  for (const sourceType of ['script', 'module']) {
    comments.length = 0;
    try {
      acorn.parse(s, { ...opts, sourceType, onComment: comments });
      toks = [...acorn.tokenizer(s, opts)];
      break;
    } catch {
      toks = null;
    }
  }
  if (!toks) return null;
  const out = s.split('');
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i += 1) if (out[i] !== '\n') out[i] = ' ';
  };
  for (const t of toks) {
    const label = t.type && t.type.label;
    if (label === 'string' || label === 'template' || label === 'regexp') blank(t.start, t.end);
  }
  for (const c of comments) blank(c.start, c.end);
  return out.join('');
}

/* ONE call site decides per text, and SAYS which preparation answered. A count whose preparation is
   unnamed cannot be compared with the next run's. */
export function prepare(src, acorn = acornOrNull()) {
  if (acorn) {
    const parsed = codeOnlyParsed(src, acorn);
    if (parsed !== null) return { code: parsed, by: 'acorn' };
  }
  return { code: codeOnly(src), by: 'tokenizer' };
}

/** Balanced-brace slice starting at the first `{` after `at`. Regex-to-a-fixed-indent gets this wrong
    when nesting changes the closing indent — a trap this repo has paid for more than once. */
function blockAt(s, at) {
  const i = s.indexOf('{', at);
  if (i < 0) return '';
  let d = 0;
  for (let k = i; k < s.length; k++) {
    if (s[k] === '{') d++;
    else if (s[k] === '}') {
      d--;
      if (!d) return s.slice(i, k + 1);
    }
  }
  return '';
}

/** SHAPE A — `window.NS = { a, b, c }`. Every key is a PUBLISHED name. */
export function objectExports(code) {
  const out = [];
  for (const m of code.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=\s*\{/g)) {
    const body = blockAt(code, m.index);
    if (!body) continue;
    /* Keys only: `name,` `name:` and `name` before the close. Nested object values are skipped by
       requiring the key to sit at the literal's own depth. */
    let depth = 0;
    for (let k = 0; k < body.length; k++) {
      const ch = body[k];
      if (ch === '{' || ch === '[' || ch === '(') depth++;
      else if (ch === '}' || ch === ']' || ch === ')') depth--;
      if (depth !== 1) continue;
      const rest = body.slice(k);
      const km = /^[\s,]*([A-Za-z_$][\w$]*)\s*[,:}]/.exec(rest);
      if (km) {
        out.push({ ns: m[1], name: km[1] });
        k += km[0].length - 2;
      }
    }
  }
  return out;
}

/** SHAPE B — `window.NAME = value;` (a direct assignment, not an object literal). */
export function directExports(code) {
  const out = [];
  for (const m of code.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=\s*(?!\{)([A-Za-z_$][\w$]*)\s*;/g)) {
    out.push({ ns: m[1], name: m[1], via: m[2] });
  }
  return out;
}

/* ── GRIT BACKEND (biome search) ────────────────────────────────────────────────────────────────
   Replaces the hand-rolled tokenizer for BOTH risky steps. `biome` is already a devDependency, so
   this adds nothing to install. Verified on plants before adoption: an odd-spaced call `foo   (  3  )`
   MATCHES, while the same text in a comment, a string AND a template literal does NOT — which is
   exactly the corruption class that cost the tokenizer 2 of 14 names.

   🔴 COUNT `diagnostics` FROM --reporter=json, NEVER THE SUMMARY LINE. Measured three times: the human
   summary says "Found 1 match" where JSON reports 2. A `grep -c` over rendered output is wrong the
   same way. The summary is a rendering, not a count. */
function gritSearch(pattern, files) {
  if (!files.length) return [];
  try {
    const out = execFileSync(BIOME, ['search', `\`${pattern}\``, ...files, '--reporter=json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const i = out.indexOf('{');
    if (i < 0) return [];
    return (JSON.parse(out.slice(i)).diagnostics || []).map((d) => ({
      file: d.location?.path?.file || d.location?.path || '',
      line: d.location?.span ? null : d.location?.start?.line,
      start: d.location?.start,
      end: d.location?.end
    }));
  } catch {
    return [];
  }
}

/** Consumption, Grit-backed: a READ of the name in a file other than its definer. */
export function isConsumedGrit(name, definer, files) {
  for (const d of gritSearch(name, files)) {
    const f = String(d.file || '')
      .split('/')
      .pop();
    if (f && f !== definer) return f;
  }
  return null;
}

/** A name is CONSUMED when it appears in code (comments and strings stripped) in a file OTHER than the
    one that publishes it. Same-file use does not count: a function called only by its own module's
    internals is exactly the shape that reaches no consumer across the boundary. */
export function isConsumed(name, definer, corpus) {
  /* ⚠️ CONSUMPTION IS A READ, NOT AN OCCURRENCE — and the difference is the whole tool.
     A bundle inlines its modules, so `window._projVO2 = vo2Est;` appears verbatim in HRVDex.html.
     That is the SAME publication re-emitted, not a consumer, and counting it would mark every
     bundled export "wired" and report a permanent zero.
     An earlier draft got these right by ACCIDENT: it excluded any dot-prefixed match, which skipped
     `window.X = …` writes but also skipped legitimate `NS.X()` READS — right answer, wrong reason,
     and blind in the direction that hides real consumers. So: match the name with or without a
     namespace, then reject the occurrence if it is an ASSIGNMENT TARGET. */
  /* ⚠️ ESCAPE EVERY REGEX METACHARACTER, not just `$`. CodeQL flagged the partial form
     (js/incomplete-sanitization, high): escaping one metacharacter leaves the rest live, so a symbol
     containing `.` `(` `[` or a backslash would be INTERPOLATED AS PATTERN rather than matched
     literally — a correctness bug as much as a sanitisation one, since `.` would then match any
     character and silently mark unrelated symbols consumed. Same class as the tools-index escape fixed
     in #2154: there the order was wrong, here the character class was too narrow. */
  const n = escapeRe(name);
  const re = new RegExp(`(?:[\\w$]+\\.)?(?<![\\w$])${n}(?![\\w$])\\s*(=(?!=)|.?)`, 'g');
  for (const [file, code] of corpus) {
    if (file === definer) continue;
    for (const m of code.matchAll(re)) {
      const isWrite = m[1] === '=';
      if (!isWrite) return file;
    }
  }
  return null;
}

function jsFiles() {
  return readdirSync(ROOT)
    .filter((f) => /\.js$/.test(f))
    .sort();
}

function htmlFiles() {
  return readdirSync(ROOT)
    .filter((f) => /\.html$/.test(f))
    .sort();
}

function selfTest() {
  let fail = 0;
  const ok = (c, n) => {
    console.log((c ? '  ✓ ' : '  ✗ ') + n);
    if (!c) fail++;
  };
  ok(!codeOnly('a // b\nc').includes('b') && /a[\s\S]*c/.test(codeOnly('a // b\nc')), 'line comments are stripped, surrounding code survives');
  ok(!codeOnly('/* dead */ x').includes('dead'), 'block comments are stripped');
  ok(!codeOnly('var s = "notAName";').includes('notAName'), 'string literals are stripped');
  const A = objectExports('window.NS = { alpha, beta: 1, gamma };');
  ok(A.length === 3 && A[0].name === 'alpha' && A[2].name === 'gamma', 'object-literal keys are extracted');
  const nested = objectExports('window.NS = { outer: { inner: 1 }, tail };');
  ok(nested.some((e) => e.name === 'outer') && nested.some((e) => e.name === 'tail') && !nested.some((e) => e.name === 'inner'), 'a NESTED key is not mistaken for a published name');
  const B = directExports('window.Solo = helper;');
  ok(B.length === 1 && B[0].ns === 'Solo', 'direct assignments are extracted');
  ok(
    isConsumed('zed', 'a.js', [
      ['a.js', 'zed'],
      ['b.js', 'zed()']
    ]) === 'b.js',
    'a reference in ANOTHER file counts'
  );
  ok(isConsumed('zed', 'a.js', [['a.js', 'zed(); zed();']]) === null, 'same-file use alone is NOT consumption');
  /* The two corruption causes, both measured on real files rather than imagined. */
  ok(!codeOnly('var x = a.replace(/"/g, "");').includes('"g'), 'a regex literal containing a quote does not open a string');
  ok(codeOnly('function f(v){ return /[",\\r\\n]/.test(v) ? 1 : 2; }\nvar keepMe = 1;').includes('keepMe'), 'a regex after `return` is a LITERAL, not division — code after it survives');
  /* The CodeQL case: a metacharacter in the NAME must be matched literally, never interpolated. */
  ok(isConsumed('a.b', 'x.js', [['y.js', 'axb']]) === null, 'a dot in a symbol name is literal, not "any character"');
  ok(isConsumed('a.b', 'x.js', [['y.js', 'q = a.b;']]) === 'y.js', '…and the literal form still matches');
  ok(isConsumed('zed', 'a.js', [['b.js', 'unzed zedly']]) === null, 'a substring is not a reference');
  /* THE PREPARATION IS A PER-RUN FACT, so both paths are pinned here and the run says which answered. */
  ok(prepare('var s = "notAName";', null).by === 'tokenizer', 'with NO parser the hand tokenizer still prepares the corpus');
  /* ⚠️ NOT AN ASSERTION. `selftest-all.mjs` runs this file in a CI lane, and a lane installs nothing,
     so a leg demanding acorn would red there for a reason that is not a defect. The run SAYS which
     preparation it could exercise, and a skip is printed as a skip rather than counted as a pass. */
  const ac = acornOrNull();
  console.log(ac ? '  · acorn resolved: the parse legs below RUN' : '  ⊘ no acorn in this checkout: the parse legs below are SKIPPED, not passed');
  if (ac) {
    ok(prepare('var s = "notAName";', ac).by === 'acorn', 'a parseable file is prepared BY the parser');
    ok(!prepare('var s = "notAName";', ac).code.includes('notAName'), 'the parse path strips a string literal');
    ok(!prepare('var x = a.replace(/"/g, "");', ac).code.includes('"g'), 'the quote inside a regex costs the parse path nothing — cause 1');
    ok(prepare('function f(v){ return /[",\\r\\n]/.test(v) ? 1 : 2; }\nvar keepMe = 1;', ac).code.includes('keepMe'), 'a regex after `return` costs the parse path nothing — cause 2');
    ok(codeOnlyParsed('<html><body>', ac) === null, 'text that is not a program returns null rather than a wrong answer');
    ok(prepare('<html><body>', ac).by === 'tokenizer', 'and such a file FALLS BACK, counted, never dropped');
    ok(
      prepare('import x from "y";\nvar keepMe = 1;', ac).by === 'acorn' && prepare('import x from "y";\nvar keepMe = 1;', ac).code.includes('keepMe'),
      'a module parses as a module after the script attempt fails'
    );
    const tpl = prepare('var a = `xx${keepMe}yy`;', ac).code;
    ok(tpl.includes('keepMe') && !tpl.includes('xx'), 'a name inside a template EXPRESSION survives while the text around it does not');
    const multi = prepare('var keepMe = 1;\n/* one\ntwo */\nvar alsoKeep = 2;\n', ac).code;
    ok(
      multi.split('\n').length === 5 && multi.includes('keepMe') && multi.includes('alsoKeep') && !multi.includes('one'),
      'a comment spanning LINES is blanked without eating its newlines, so every later line number holds'
    );
    const blanked = prepare('a // b\nc', ac).code;
    ok(blanked === 'a     \nc' && blanked.length === 'a // b\nc'.length, 'blanking preserves every offset and every newline — the tokenizer SHORTENS, and that is the desynchronisation itself');
  }
  ok(
    acornOrNull(() => {
      throw new Error('absent');
    }) === ac,
    'the resolution is memoised, so no file can flip the preparation mid-corpus'
  );
  console.log(fail ? `\nfind-unwired-js selftest: ${fail} FAILED` : '\nfind-unwired-js selftest: all passed');
  return fail ? 1 : 0;
}

/* Guarded so the module can be IMPORTED without running — its own selftest needs that, and the
   tools index shipped this exact bug hours earlier: the first `import` wrote a file and exited. */
const IS_MAIN = isCliEntry(import.meta.url);
const argv = process.argv.slice(2);
if (IS_MAIN && (argv.includes('--selftest') || argv.includes('--self-test'))) process.exit(selfTest());
if (!IS_MAIN) {
  /* imported: expose the pure helpers only */
}

if (IS_MAIN) {
  const files = jsFiles();
  const countDir = (d, re) => {
    try {
      return readdirSync(join(ROOT, d)).filter((f) => re.test(f)).length;
    } catch {
      return 0;
    }
  };
  const SKIP = {
    tools: countDir('tools', /\.mjs$/),
    tests: countDir('tests', /\.(js|mjs)$/),
    captureHost: countDir('capture-host', /\.py$/),
    docs: countDir('docs', /\.html$/)
  };
  const prep = { acorn: 0, tokenizer: 0 };
  const prepOne = (text) => {
    const r = prepare(text);
    prep[r.by] += 1;
    return r.code;
  };
  const corpus = files.map((f) => [f, prepOne(readFileSync(join(ROOT, f), 'utf8'))]);
  for (const h of htmlFiles()) corpus.push([h, prepOne(readFileSync(join(ROOT, h), 'utf8'))]);

  let shapeA = 0;
  let shapeB = 0;
  const published = [];
  for (const [file, code] of corpus.slice(0, files.length)) {
    const a = objectExports(code);
    const b = directExports(code);
    shapeA += a.length;
    shapeB += b.length;
    for (const e of [...a, ...b]) published.push({ ...e, file });
  }

  /* DEDUPE on (file, ns, name). A name published twice — a re-assignment, or a key the extractor
     reaches by two paths — is ONE finding, not two. The first run reported 24 with `_projVO2` and
     `_cpapReview` each counted twice, which inflates the very number the report exists to state. */
  const unwired = [];
  const allowed = [];
  const seen = new Set();
  const rescues = [];
  const allFiles = [...files, ...htmlFiles()].map((f) => join(ROOT, f));
  for (const p of published) {
    const key = `${p.file}\u0000${p.ns}\u0000${p.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    /* TOKENIZER FIRST as a cheap filter, then GRIT as the authority on everything it flags.
       The tokenizer's failure mode is false-UNCONSUMED (it eats the span holding a reference), so a
       name it calls consumed is consumed; a name it flags needs the structural check. That ordering
       keeps the run at seconds instead of ~30 s while making every REPORTED finding Grit-backed. */
    if (isConsumed(p.name, p.file, corpus)) continue;
    const gritFile = isConsumedGrit(p.name, p.file, allFiles);
    if (gritFile) {
      rescues.push({ name: p.name, file: p.file, where: gritFile });
      continue;
    }
    (ALLOW[p.name] ? allowed : unwired).push(p);
  }

  /* 🔴 REFLECTION IS A KNOWN-UNRESOLVABLE CLASS, COUNTED AND NAMED — never silently suppressed.
     `obj[name]`, a registry lookup, string-keyed dispatch: a consumer can reach a symbol without the
     symbol's text ever appearing next to it. This scanner CANNOT see those, so every finding is
     "unreferenced by name", not "unreachable". Publishing the count is what keeps that distinction
     visible instead of letting a reader upgrade it. */
  let reflect = 0;
  for (const [, code] of corpus) reflect += (code.match(/\[\s*[A-Za-z_$][\w$]*\s*\]/g) || []).length;
  /* ⚠️ THIS IS AN UPPER BOUND AND MOSTLY ARRAY INDEXING. `arr[i]` and `registry[name]` are the SAME
     SYNTAX; separating them needs types this scanner does not have. Reported as a bound rather than
     dressed up as a reflection count — the first draft printed it as "reflection sites", which
     over-stated a real caveat by counting every loop body in the repo. */

  console.log('\n== published JS names that reach NO other file ==\n');
  console.log(`   SHAPES ENUMERATED: window.NS = {…} → ${shapeA} name(s) · window.X = Y → ${shapeB} name(s)`);
  console.log(`   SCANNED:  ${files.length} root .js  +  ${corpus.length - files.length} root .html`);
  console.log(`   PREPARED BY: acorn on ${prep.acorn} file(s), the hand tokenizer on ${prep.tokenizer}`);
  console.log(
    acornOrNull()
      ? '     the tokenizer files are the ones no parse accepted, which is every root .html.'
      : '     NO acorn in this checkout, so every file took the tokenizer and its 2-of-14 residue stands.'
  );
  /* THE EXCLUSION LIST IS A FINDING, not bookkeeping. What the parser cannot see is the interesting
     output — a reader who knows the blind spots can judge the set; one who does not will over-trust it. */
  console.log('   SKIPPED, and why:');
  console.log(`     tools/*.mjs (${SKIP.tools})   ESM modules — a different publication shape this scanner does not read`);
  console.log(`     tests/* (${SKIP.tests})        test-only; a symbol used solely by tests is the defect, not the consumer`);
  console.log(`     capture-host/ (${SKIP.captureHost})     Python lane — covered by capture-host/tools/find_unwired.py`);
  console.log(`     docs/ (${SKIP.docs})            generated copies of the root bundles; counting them double-counts`);
  console.log(`   UNRESOLVABLE BY THIS METHOD: <= ${reflect} bracket-access site(s) could hide a consumer.`);
  console.log('     UPPER BOUND — `arr[i]` and `registry[name]` are the same syntax, so this counts ordinary');
  console.log('     indexing too. A symbol reached only by string dispatch reads as unwired here, so every');
  console.log('     finding means "unreferenced BY NAME", never "unreachable".\n');
  for (const u of unwired.slice(0, 40)) console.log(`   ${u.file.padEnd(26)} ${(u.ns === u.name ? u.name : u.ns + '.' + u.name).slice(0, 44)}`);
  if (unwired.length > 40) console.log(`   … and ${unwired.length - 40} more`);
  for (const a of allowed) console.log(`   (allowed) ${a.file.padEnd(20)} ${a.name.padEnd(28)} ${ALLOW[a.name].slice(0, 60)}`);
  console.log(`\n   ${unwired.length} unexplained, ${allowed.length} allowed`);
  /* A COUNT WITH NO NAMES CANNOT BE CHECKED — the same rule this tool applies to a zero. Each line
     says where the structural check found the consumer the cheap pass missed, so the next reader can
     read that file instead of re-deriving the set. The CAUSE is not asserted here: a `.html` consumer
     is prepared by the tokenizer whatever the checkout holds, and `isConsumed` also declines a
     verbatim re-publication, so a rescue is not evidence of corruption by itself. */
  console.log(`   ${rescues.length} finding(s) RESCUED by the structural check — the cheap pass missed the consumer:`);
  for (const r of rescues) console.log(`     ${r.name.padEnd(28)} published in ${r.file}, read in ${r.where}`);
  console.log('   ADVISORY — read each before believing it; exit is always 0.');
  process.exit(0);
}
