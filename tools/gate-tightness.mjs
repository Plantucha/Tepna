/*
 * tools/gate-tightness.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * ── A SOURCE-SCAN ASSERTION THAT A RENAME CAN SATISFY ───────────────────────────────────────────
 *
 * Reported by a peer session, with one confirmed instance. A gate asserted that `allan.py` still
 * takes an SE parameter:
 *
 *     /def classify\([^)]*se/.test(py)
 *
 * `def classify(sl, se_unused=None` still matches, because `se_unused` CONTAINS `se`. The gate went
 * green on a signature that no longer has the parameter the gate exists to require.
 *
 * ⚠️ WHY THE MUTATION PROGRAMME CANNOT SEE THIS, which is why it needs its own tool. `mutmut` and
 * `tools/mutate.mjs` mutate the CODE and ask whether a test notices. This defect lives in the TEST.
 * Mutate the code and the gate correctly reds — the hole only opens under a REFACTOR, and no
 * code-mutation operator generates one. It is invisible to that programme by construction.
 *
 * ── IT IS DECIDABLE STATICALLY, so this is a lint and not a mutation run ────────────────────────
 * Take the regex, find what it matches in a real source file, rename an identifier INSIDE the match
 * to a longer one containing it, and re-test the same regex. Still matches ⇒ a rename satisfies the
 * assertion. No suite run, no mutant, milliseconds per site.
 *
 * 🔴 RENAME ONLY IDENTIFIERS THE ASSERTION ASSERTS ON — those written LITERALLY IN THE REGEX. The
 * first version renamed every identifier in the MATCH, and flagged the peer's FIX
 * (`/def classify\([^)]*\bse\s*=/`) via `sl → sl_unused`: renaming `sl`, which the assertion says
 * nothing about, correctly leaves it green. That is not a defect, and a detector that reports it
 * floods. The control caught it before the tool existed.
 *
 * ⚠️ A ZERO HERE MEANS NOTHING WITHOUT THE CONTROLS. A filter that matches nothing reads exactly
 * like a pass — so --selftest plants both a loose assertion that MUST be found and a tight one that
 * MUST NOT be, including the peer's real instance and their real fix.
 *
 *   node tools/gate-tightness.mjs --selftest
 *   node tools/gate-tightness.mjs                 # scan tests/dex-tests.js against the real sources
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { stripNonCode } from './probe-equivalence.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Identifiers the assertion asserts on: those written literally in the pattern. Escapes and regex
   metacharacters are blanked first so `\b`, `\s` and friends do not read as words. */
export function assertedIdentifiers(patternSource) {
  const stripped = String(patternSource || '')
    .replace(/\\[a-zA-Z]/g, ' ')
    .replace(/[[\](){}|?*+.^$\\/]/g, ' ');
  return [...new Set(stripped.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [])].filter((s) => s.length >= 2);
}

/* Does renaming an asserted identifier to a LONGER one containing it still satisfy the pattern? */
export function looseAgainst(re, text, suffix = '_unused', mask = null) {
  const m = new RegExp(re.source, re.flags.replace('g', '')).exec(text);
  if (!m) return null; /* pattern does not match this text — nothing to say */
  /* 🔴 ONLY CODE COUNTS. A pattern matching PROSE — `/drawn axis/` against a comment, `/correspondence
     does not clear/` against a docstring — is substring-satisfiable in the trivial sense and is not a
     defect: renaming a word in a sentence is not a refactor, and nothing breaks if it happens. Left
     unfiltered these dominated the output (302 raw hits, the majority prose), which would have made
     the tool's number worthless in the usual way — a real signal buried under matches nobody will
     act on. `stripNonCode` blanks comments and strings IN PLACE, so the match's own offsets say
     whether it landed in code. This is the separation the reporting session said their greps could
     not make. */
  if (mask) {
    const region = mask.slice(m.index, m.index + m[0].length);
    if (!region.trim()) return null; /* entirely inside a comment or string literal */
  }
  for (const id of assertedIdentifiers(re.source)) {
    const renamed = m[0].replace(new RegExp('\\b' + id + '\\b'), id + suffix);
    if (renamed === m[0]) continue;
    if (!new RegExp(re.source, re.flags.replace('g', '')).test(renamed)) continue;
    /* 🔴 AND THE IDENTIFIER MUST ACTUALLY BE A DECLARED SYMBOL. Without this the output is dominated
       by assertions about MESSAGE TEXT — `/stable/`, `/implausible/`, `/fewer than two/` — which are
       substring-satisfiable in the trivial sense and are not defects: they pin prose a user reads,
       not a symbol a refactor renames. 155 raw hits were mostly these. The defect class is
       specifically "a gate asserts a SYMBOL exists and a rename satisfies it", so the symbol has to
       exist as one: declared, assigned, or accessed as a property. */
    if (!declaresSymbol(text, id)) continue;
    return { identifier: id, rename: id + ' → ' + id + suffix, matched: m[0].slice(0, 90) };
  }
  return false;
}

/* `stripNonCode` is a JS lexer, so Python needed its own — and the ONE confirmed instance of this
   defect class was in `allan.py`, which makes "no mask for .py" the gap that matters most rather
   than a corner. Blanks triple-quoted strings, then single-line strings, then `#` comments, in that
   order and in place so offsets survive. Deliberately simple: it over-blanks a `#` inside an already
   blanked string, which can only DROP a candidate, never invent one. */
export function stripPython(text) {
  let out = String(text || '');
  const blank = (m) => ' '.repeat(m.length);
  out = out.replace(/("""|''')[\s\S]*?\1/g, blank);
  out = out.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, blank);
  out = out.replace(/#[^\n]*/g, blank);
  return out;
}

/* Is `id` a real symbol in this text — declared, assigned, or read as a property — rather than a
   word that happens to appear? Deliberately broad: over-matching here only keeps a candidate, while
   under-matching drops a real finding. */
/* Every character with meaning in a RegExp, escaped. Exported so it can be tested on inputs the
   extractor does not currently produce — the point is to stop depending on that. */
export function escapeRegex(t) {
  return String(t).replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c);
}

export function declaresSymbol(text, id) {
  /* ⚠️ A PREFIX OF A SYMBOL COUNTS, and demanding an exact symbol was wrong. A control caught it:
     `/CK_AXIS_MAX/` asserted against `var CK_AXIS_MAX_PPM = 50000;` is not a symbol by exact match —
     and that IS the defect, an assertion already satisfied by a longer name. So the question is
     whether some declared symbol STARTS with the asserted identifier. */
  /* ⚠️ ESCAPE EVERY METACHARACTER, not only `$`. Today `assertedIdentifiers` yields only
     `[A-Za-z_$]`-shaped tokens, so `$` was the sole reachable one and escaping it alone was CORRECT
     — correct by a coupling to another function rather than by anything local, which is the fragile
     kind, and CodeQL `js/incomplete-sanitization` named it. */
  const e = escapeRegex(id) + '[A-Za-z0-9_$]*';
  return new RegExp('(?:\\b(?:function|def|class|var|let|const|async)\\s+' + e + '\\b)' + '|(?:\\b' + e + '\\s*[:=][^=])' + '|(?:\\.' + e + '\\b)' + '|(?:\\b' + e + '\\s*\\()').test(text);
}

/* Regex literals passed to `.test(` in a test file. Deliberately conservative: only literals it can
   read unambiguously, because a pattern this tool cannot parse must not be reported as clean. */
export function extractTestPatterns(src) {
  const out = [];
  const re = /\/((?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+)\/([gimsuy]*)\s*\.test\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    try {
      out.push({ re: new RegExp(m[1], m[2]), line: src.slice(0, m.index).split('\n').length });
    } catch {
      /* unparseable — skipped, and counted by the caller so a zero is never mistaken for clean */
    }
  }
  return out;
}

export function codeSources(root) {
  const files = [];
  for (const f of readdirSync(root)) if (/\.(js|mjs)$/.test(f)) files.push(join(root, f));
  const ch = join(root, 'capture-host');
  if (existsSync(ch)) for (const f of readdirSync(ch)) if (/\.py$/.test(f)) files.push(join(ch, f));
  return files;
}

// ── selftest ────────────────────────────────────────────────────────────────────────────────────
const IS_MAIN = !!process.argv[1] && process.argv[1].endsWith('gate-tightness.mjs');
if (IS_MAIN && process.argv.includes('--selftest')) {
  let pass = 0;
  let fail = 0;
  const ok = (n, c, d) => {
    if (c) {
      pass++;
      console.log('  ✓ ' + n);
    } else {
      fail++;
      console.log('  ✗ ' + n + (d ? '  — ' + d : ''));
    }
  };

  /* 🔴 THE PLANTED CONTROLS. A detector that finds nothing is indistinguishable from one that
     cannot look, so the loose cases MUST be found and the tight ones MUST NOT be. The first two are
     the peer's real instance and their real fix, verbatim. */
  const PY = 'def classify(sl, se=None, tau=None):';
  const JS = 'function hostAxis(anchors) {';
  const loose = (re, t) => !!looseAgainst(re, t);
  ok("the peer's instance is FOUND — se_unused satisfies it", loose(/def classify\([^)]*se/, PY));
  ok("the peer's FIX is not flagged — \\bse\\s*= survives the rename", !loose(/def classify\([^)]*\bse\s*=/, PY));
  ok('every regex metacharacter is escaped, not only $', escapeRegex('a.b*c+d?e^f$g') === 'a\\.b\\*c\\+d\\?e\\^f\\$g', escapeRegex('a.b*c+d?e^f$g'));
  ok('brackets and braces too', escapeRegex('x{1}y[2]z(3)|w') === 'x\\{1\\}y\\[2\\]z\\(3\\)\\|w', escapeRegex('x{1}y[2]z(3)|w'));
  ok('an ordinary identifier is unchanged', escapeRegex('CK_AXIS_MAX') === 'CK_AXIS_MAX');
  ok('a dotted token cannot build a wildcard pattern', declaresSymbol('var ab = 1;', 'a.b') === false);
  ok('a bare identifier is found', loose(/hostAxis/, JS));
  ok('a bounded call is tight', !loose(/\bhostAxis\s*\(/, JS));
  ok('an anchored declaration is tight', !loose(/function\s+hostAxis\b/, JS));
  ok('a constant prefix is found', loose(/CK_AXIS_MAX/, 'var CK_AXIS_MAX_PPM = 50000;'));
  ok('a pattern that does not match reports null, not clean', looseAgainst(/nothingHere/, JS) === null);

  /* Renaming an identifier the assertion does NOT assert on must not flag — the bug the first
     version of this operator had, caught by a control before the tool existed. */
  ok('renaming an unasserted identifier does not flag', !loose(/def classify\([^)]*\bse\s*=/, 'def classify(sl, se=None):'));
  ok(
    'asserted identifiers come from the PATTERN, not the match',
    JSON.stringify(assertedIdentifiers('def classify\\([^)]*\\bse\\s*=')) === JSON.stringify(['def', 'classify', 'se']),
    JSON.stringify(assertedIdentifiers('def classify\\([^)]*\\bse\\s*='))
  );
  ok('escapes are not read as words', !assertedIdentifiers('\\bfoo\\s*\\(').includes('s') && !assertedIdentifiers('\\bfoo\\s*\\(').includes('b'));
  ok('single characters are ignored — too noisy to be an assertion', !assertedIdentifiers('\\bx\\b').includes('x'));
  ok('a declared function is a symbol', declaresSymbol('function hostAxis(a) {}', 'hostAxis'));
  ok('a python def is a symbol', declaresSymbol('def classify(sl, se=None):', 'classify'));
  ok('a property access is a symbol', declaresSymbol('return v.filePresent;', 'filePresent'));
  ok('a word in a message is NOT a symbol', !declaresSymbol('throw new Error("the axis is stable here");', 'stable'));
  ok('…so a message assertion is not reported', !loose(/stable/, 'msg = "the axis is stable";'));

  ok('a python string is blanked', stripPython('x = "PpgDex"').indexOf('PpgDex') === -1);
  ok('a python comment is blanked', stripPython('y = 1  # see PpgDex').indexOf('PpgDex') === -1);
  ok('a python docstring is blanked', stripPython('def f():\n    """uses PpgDex"""').indexOf('PpgDex') === -1);
  ok('python CODE survives the mask', /def classify/.test(stripPython('def classify(sl, se=None):  # noqa')));
  ok('the mask preserves offsets', stripPython('x = "abc"  # z').length === 14);

  ok('extractTestPatterns reads a literal', extractTestPatterns('if (/\\bfoo\\b/.test(src)) {}').length === 1);
  ok('…including flags', extractTestPatterns('/foo/i.test(x)').length === 1);
  ok('…and a character class containing a slash', extractTestPatterns('/a[/]b/.test(x)').length === 1);

  console.log(fail ? '\n✗ ' + fail + ' failed, ' + pass + ' passed' : '\n✓ all ' + pass + ' selftests passed');
  process.exit(fail ? 1 : 0);
}

if (IS_MAIN && !process.argv.includes('--selftest')) {
  const testFile = join(ROOT, 'tests', 'dex-tests.js');
  const src = readFileSync(testFile, 'utf8');
  const pats = extractTestPatterns(src);
  const sources = codeSources(ROOT).map((f) => {
    const text = readFileSync(f, 'utf8');
    return { f, text, mask: /\.py$/.test(f) ? stripPython(text) : stripNonCode(text) };
  });
  const findings = [];
  let matchedSomewhere = 0;
  for (const p of pats) {
    for (const s of sources) {
      const r = looseAgainst(p.re, s.text, '_unused', s.mask);
      if (r === null) continue;
      matchedSomewhere++;
      if (r) findings.push({ line: p.line, file: s.f.replace(ROOT + '/', ''), pattern: String(p.re).slice(0, 72), ...r });
      break; /* first code file it matches is enough to judge the pattern */
    }
  }
  console.log('▸ gate tightness — ' + pats.length + ' literal .test() patterns, ' + matchedSomewhere + ' match a real code file');
  for (const f of findings.slice(0, 40)) {
    console.log('  ⚠ dex-tests.js:' + f.line + '  ' + f.pattern);
    console.log('      ' + f.file + '  ' + f.rename + '  still satisfies it');
  }
  console.log('\n  SUBSTRING-SATISFIABLE: ' + findings.length + ' of ' + matchedSomewhere + ' patterns that reach code');
  console.log('  A zero here is only meaningful because --selftest plants a loose control and finds it.');
}
