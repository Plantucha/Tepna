#!/usr/bin/env node
/* Tepna — Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ════════════════════════════════════════════════════════════════════════
 * argv-reads.mjs — WHICH TOOLS IGNORE AN UNKNOWN ARGV TOKEN BY CONSTRUCTION.
 *
 * WHY. Residue `2026-09-28-one-hundred-sixty-three-argv-reading-tools-are-unprobed`. The executable
 * survey (`tools/argv-survey.mjs`) probes a tool only when its whole transitive local import closure
 * holds no write, exec or network call, because a tool that ignores the token proceeds to DO ITS JOB
 * and that is the hazard — it has already cost one corpus write. That bound cleared 45 tools and left
 * the rest unprobed. The row names a second route for them: enumerate every line that touches argv
 * and prove each one is a literal-name lookup, which needs no run at all.
 *
 * WHAT A PROOF HERE IS, AND WHAT IT IS NOT. `ignores-by-construction` is not a clearance. It is the
 * STATIC form of the survey's IGNORES verdict: every argv read in the tool looks up a name the tool
 * already knows, so a token nobody looks up is indistinguishable from an absent one. That is the
 * defect, stated without running anything. The dangerous class is the other one: a positional read
 * turns an unknown token into DATA — a path, an output, a night — and the survey measured five tools
 * where exactly that happened (`geometry-scan.mjs` scandir'd the token and exited 0).
 *
 * THE CONTROL IS AN INDEPENDENT INSTRUMENT, NOT THIS SCANNER. `audits/ARGV-REFUSAL-SURVEY-2026-09-28.json`
 * holds 45 tools with executable verdicts: 36 IGNORES, 5 SWALLOWS-AS-POSITIONAL, 2 REFUSES, 2
 * UNDECIDED-timeout. A static claim that contradicts a run is a defect in the static claim, so the
 * verdict's criterion is pre-stated over those rows and the threshold is zero. The counts over the
 * whole population are the REPORT; the contradictions are the test.
 *
 * ABSTENTION IS NOT AGREEMENT. `undecidable` carries a named reason and is counted apart from both
 * other classes. A scan that decides little and contradicts nothing is honest and weak; one that
 * decides much by guessing is worse than no scan. Read the undecidable column first.
 *
 *   node tools/argv-reads.mjs                  # scan tools/, print the table and the counts
 *   node tools/argv-reads.mjs --json           # the tepna.verdict/1 object + every row
 *   node tools/argv-reads.mjs --control        # the cross-check against the executable survey only
 *   node tools/argv-reads.mjs --only foo.mjs   # one tool, with every site it holds
 *   node tools/argv-reads.mjs --selftest       # planted truth: one tool per class
 *   node tools/argv-reads.mjs --verdict-sample # a sample object, scans nothing
 * ════════════════════════════════════════════════════════════════════════ */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refuseUnknownArgvOrExit, isCliEntry } from './argv-guard.mjs';
import { KEYWORD_HEADS } from './js-lex.mjs'; // the keywords a value may not follow — one list, two walkers
import { makeVerdict } from './verdict-emit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CONTROL_PATH = 'audits/ARGV-REFUSAL-SURVEY-2026-09-28.json';

/* The flag is read in a CALL position too, because that is the predicate both `selftest-all.mjs` and
   `verdict-adoption.mjs` discover a gated tool by. */
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const IS_MAIN = isCliEntry(import.meta.url);

/* ── masking ───────────────────────────────────────────────────────────────────────────────────── */
/** Comment and string CONTENTS replaced by spaces, length and newlines preserved so offsets still
 *  index the original. Site detection runs on the mask (a comment mentioning argv is not a read);
 *  classification reads the original at the same offsets (a literal must stay legible). */
/** A `/` begins a regex literal, rather than division, when the nearest earlier non-space character
 *  cannot end a value. The standard heuristic, and the alternative — treating every `/` as division —
 *  is what desynchronised the mask. */
function isRegexStart(text, i) {
  let k = i - 1;
  while (k >= 0 && /\s/.test(text[k])) k--;
  if (k < 0) return true;
  if ('([{,;:=!&|?+-*%~^<>'.includes(text[k])) return true;
  const word = /([A-Za-z_$][\w$]*)$/.exec(text.slice(Math.max(0, k - 12), k + 1));
  /* THE KEYWORD LIST IS SINGLE-SOURCED in `js-lex.mjs`, the one regex-aware lexer, because this file
     and that one answered the same question from two lists and only one of them was right: the lexer
     had no list at all until 2026-10-21. The WALK still differs — this one reads backwards from the
     slash and the lexer tracks forwards — and the character rules differ on `}`, which the lexer calls
     expression position and this file calls division. Those are the two scanners' own business; the
     keywords are not. */
  return !!word && KEYWORD_HEADS.includes(word[1]);
}

export function maskNonCode(text) {
  const out = text.split('');
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < text.length) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      const e = text.indexOf('\n', i);
      blank(i, e < 0 ? text.length : e);
      i = e < 0 ? text.length : e;
    } else if (c === '/' && d === '*') {
      const e = text.indexOf('*/', i + 2);
      blank(i, e < 0 ? text.length : e + 2);
      i = e < 0 ? text.length : e + 2;
    } else if (c === '/' && isRegexStart(text, i)) {
      /* A REGEX LITERAL, because a quote inside one desynchronises the whole mask: `/['"]/` opened a
         string that ran to the next quote far below, and `selftest-all.mjs` then showed two argv reads
         that live inside a double-quoted assertion string. A `/` after a value is division; after an
         operator, a comma, an open bracket or a return it begins a regex. */
      let k = i + 1;
      let inClass = false;
      for (; k < text.length; k++) {
        if (text[k] === '\\') k++;
        else if (text[k] === '[') inClass = true;
        else if (text[k] === ']') inClass = false;
        else if (text[k] === '/' && !inClass) break;
        else if (text[k] === '\n') break;
      }
      blank(i + 1, k);
      i = k + 1;
    } else if (c === "'" || c === '"' || c === '`') {
      let k = i + 1;
      while (k < text.length) {
        if (text[k] === '\\') k += 2;
        else if (text[k] === c) break;
        else k++;
      }
      blank(i + 1, k);
      i = k + 1;
    } else i++;
  }
  return out.join('');
}

/* ── aliases ───────────────────────────────────────────────────────────────────────────────────── */
/** Every identifier bound to `process.argv` or a slice of it, plus the parameter name of a local
 *  function called with one. The second form is why `process.exit(main(process.argv.slice(2)))` does
 *  not read as an undecidable pass-through in the 20 tools that use it. */
export function argvAliases(masked) {
  return aliasScan(masked).names;
}

/** The offsets at which an alias identifier is DECLARED — the `argv` in `const argv = …`, the `args`
 *  in `function main(args)`. An occurrence there is not a read of anything, and counting it as one put
 *  a spurious undecidable site in every tool that uses the dominant idiom. */
export function aliasDecls(masked) {
  return aliasScan(masked).decls;
}

/** The LOCAL function names this scan followed argv into. Handing an alias to one of them is not a
 *  pass-through it cannot see: the callee's own reads are in this same file and were scanned. */
export function trackedCallees(masked) {
  return aliasScan(masked).trackedFns;
}

function aliasScan(masked) {
  const names = new Set();
  const decls = new Set();
  const trackedFns = new Set();
  const bind = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*process\.argv(?:\.slice\(\s*\d*\s*\))?\s*[;,)]/g;
  for (const m of masked.matchAll(bind)) {
    names.add(m[1]);
    decls.add(m.index + m[0].indexOf(m[1]));
  }
  /* A local function invoked on argv — OR on a name this scan already tracks: its first parameter
     carries the tokens either way, so the parameter is an alias too. The sweep REPEATS, because the
     chain can be longer than one hop: `nsrr-oxydex-odi.mjs` calls `main(process.argv.slice(2))` and
     `main` then calls `discover(argv)`, so a single pass saw the first hop and read the second as an
     undecidable pass-through — one site, and the whole tool abstained with every real read in it a
     literal flag. Bound, stated: ONE argument only, and a keyword is never a callee.
     Row 2026-10-20-sixty-nine-argv-tools-stay-undecided-after-the-seven-are-wired. */
  const NOT_A_CALLEE = new Set(['require', 'exit', 'if', 'while', 'for', 'switch', 'return', 'typeof', 'catch', 'await', 'function', 'new', 'delete', 'void', 'in', 'of']);
  for (let pass = 0; pass < 8; pass++) {
    const before = names.size;
    const args = ['process\\.argv(?:\\.slice\\(\\s*\\d*\\s*\\))?', ...[...names].map((n) => `\\b${n}\\b`)];
    const call = new RegExp(`\\b([A-Za-z_$][\\w$]*)\\s*\\(\\s*(?:${args.join('|')})\\s*\\)`, 'g');
    for (const m of masked.matchAll(call)) {
      const fn = m[1];
      if (NOT_A_CALLEE.has(fn)) continue;
      const decl = new RegExp(`(?:function\\s+${fn}\\s*\\(\\s*([A-Za-z_$][\\w$]*)|\\b(?:const|let|var)\\s+${fn}\\s*=\\s*(?:async\\s*)?\\(?\\s*([A-Za-z_$][\\w$]*))`).exec(masked);
      const param = decl && (decl[1] || decl[2]);
      if (!param) continue;
      trackedFns.add(fn);
      names.add(param);
      decls.add(decl.index + decl[0].lastIndexOf(param));
    }
    if (names.size === before) break;
  }
  return { names, decls, trackedFns };
}

/** Identifiers bound from a LITERAL lookup in argv — `const i = argv.indexOf('--only')`. The valued-flag
 *  idiom then reads `argv[i + 1]`, which is an index arithmetic away from a literal name, not a
 *  positional read: a token nobody named still lands nowhere. */
export function flagIndexVars(masked, aliases) {
  const names = new Set();
  /* ONE BINDING, TWO SPELLINGS. The index may be bound off an ALIAS (`const i = argv.indexOf('--base')`)
     or off `process.argv` itself, and only the first was read here — so `absence-regression.mjs`, which
     writes `const baseIdx = process.argv.indexOf('--base')` and then `process.argv[baseIdx + 1]`, kept
     an `indexed-by-variable` abstention for a read that names its flag. Row
     2026-10-20-sixty-nine-argv-tools-stay-undecided-after-the-seven-are-wired. */
  for (const a of ['process\\.argv', ...aliases]) {
    const re = new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${a}\\.(?:indexOf|lastIndexOf|findIndex)\\(\\s*['"\`]`, 'g');
    for (const m of masked.matchAll(re)) names.add(m[1]);
  }
  return names;
}

/* ── sites ─────────────────────────────────────────────────────────────────────────────────────── */
const GUARD = /refuseUnknownArgvOrExit|refuseUnknownArgv\b/;
/* ONE READ, TWO SPELLINGS. `argv[0]` is decided here as `positional` — an unknown token becomes data —
   and `argv.filter((a) => !a.startsWith('--'))` is the SAME read written as a shape test, which this
   scan abstained on as a bare `traversal`. The predicate names no flag: it rejects the dash-prefixed
   tokens and keeps the rest, so whatever bare token arrives lands in the variable and flows to the
   work. `wt-done.mjs` removes those paths. Measured 2026-10-21 over the 21 single-site traversals:
   15 carry this exact shape, 3 are a prefix match against a flag name, 2 are a braced or multi-line
   body, and 1 forwards the rest to a child process.
   Bounded on purpose: `!x.startsWith('-…')` directly after the arrow, in `filter`/`find`/`findLast`.
   The chained form `process.argv.slice(2).filter(…)` is the same read a third time, so an inline slice
   may sit in front of the call.
   A negated regex test, a helper predicate and a braced body are NOT read here and stay abstentions,
   because a rule that guesses at a loop body is worse than one that declines. The dash is tested
   against the RAW text: the mask blanks a string body, so `'--'` reads as `'  '` on the mask. */
const SHAPE_POSITIONAL =
  /^\s*(?:\.slice\(\s*\d*\s*\)\s*)?\.(?:filter|find|findLast)\s*\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*(?:,\s*[A-Za-z_$][\w$]*\s*)?\)?\s*=>\s*\(?\s*!\s*\1\s*\.\s*startsWith\s*\(\s*['"`]-/;
const NESTED_LOOKUP = /^\s*\[\s*[A-Za-z_$][\w$.]*\s*\.\s*(?:indexOf|lastIndexOf|findIndex)\s*\(\s*(['"`]|[A-Za-z_$][\w$]*)/;
const DESTRUCTURE = /\b(?:const|let|var)\s*\[[^\]]*\]\s*=\s*$/;
const ALIAS_RHS = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/;
const UNKNOWN_WORD = /\b(unknown|unrecognis|unrecogniz|unexpected|not a (?:known )?(?:flag|option)|refus|invalid (?:flag|option|argument))/i;

/** The statement a site sits in: back to the previous `;`, `{`, `}` or blank line, forward to the
 *  next. A heuristic, which is why every rule below falls through to a NAMED undecidable rather than
 *  to a decision. */
function statementAt(masked, idx) {
  let a = idx;
  while (a > 0 && !';{}'.includes(masked[a - 1])) a--;
  let b = idx;
  while (b < masked.length && !';{}'.includes(masked[b])) b++;
  return { from: a, to: Math.min(b + 1, masked.length) };
}

const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

/** The dominant subcommand idiom, and the one shape a destructure does NOT turn into data:
 *  `const [cmd, ...rest] = process.argv.slice(2)` followed by `cmd === 'add'` … and a usage line on
 *  everything else. An unknown token fails every comparison and lands nowhere, which is the same
 *  argument the `argv[0] === '--classify'` rule above rests on — `findings-ledger.mjs` read as a
 *  consumer on exactly this line once the destructure was decided, and that is a false positive in
 *  the expensive direction. The bound is stated and asserted: EVERY use of the bound name outside
 *  the pattern must be a comparison against a string literal (or the head of a `switch` whose file
 *  has literal `case` labels), and one data use anywhere puts the tool back in `consumes`. */
export function dispatchOnly(masked, pattern) {
  const first = /\[\s*([A-Za-z_$][\w$]*)/.exec(pattern);
  if (!first) return false;
  const name = first[1];
  const uses = [...masked.matchAll(new RegExp(`\\b${name}\\b`, 'g'))];
  const patternAt = masked.indexOf(pattern);
  let compared = 0;
  for (const u of uses) {
    if (patternAt >= 0 && u.index >= patternAt && u.index < patternAt + pattern.length) continue;
    const after = masked.slice(u.index + name.length, u.index + name.length + 12);
    const before = masked.slice(Math.max(0, u.index - 12), u.index);
    if (/^\s*(?:===|!==|==|!=)\s*['"`]/.test(after) || /(?:===|!==|==|!=)\s*$/.test(before)) {
      compared++;
      continue;
    }
    if (/switch\s*\(\s*$/.test(before) && /\bcase\s+['"`]/.test(masked)) {
      compared++;
      continue;
    }
    return false;
  }
  return compared > 0;
}

/** Every read of argv in one file, each with its class and the reason behind it. */
export function argvSites(text) {
  const masked = maskNonCode(text);
  const aliases = argvAliases(masked);
  const flagIdx = flagIndexVars(masked, aliases);
  const decls = aliasDecls(masked);
  const helpers = literalHelperRegions(masked, aliases);
  const tracked = trackedCallees(masked);
  const inHelper = (i) => helpers.some((h) => i >= h.from && i < h.to);
  const tokens = ['process\\.argv', ...[...aliases].map((a) => `\\b${a}\\b`)];
  const re = new RegExp(`(${tokens.join('|')})`, 'g');
  const sites = [];
  for (const m of masked.matchAll(re)) {
    const idx = m.index;
    if (decls.has(idx)) continue;
    const isProcess = m[1] === 'process.argv';
    const after = masked.slice(idx + m[1].length, idx + m[1].length + 24);
    const { from, to } = statementAt(masked, idx);
    const stmtMask = masked.slice(from, to);
    /* the statement is what classifies; the snippet is the site's own LINE, because a statement slice
       runs back through the blanked comment above it and showed that comment instead of the code */
    const ls = text.lastIndexOf('\n', idx) + 1;
    const le = text.indexOf('\n', idx);
    const site = {
      line: lineOf(text, idx),
      snippet: text
        .slice(ls, le < 0 ? text.length : le)
        .trim()
        .slice(0, 120)
    };

    /* precedence, declared: the binding itself, the main guard, the guard call, a literal lookup,
       a positional read, an iteration, a pass-through, then undecidable with a reason. */
    /* `process.argv.slice(n)` as a whole expression reads no particular token: the reads happen on the
       array it yields, which this scan follows through the alias or the parameter it is handed to. The
       slice is only a binding when it ENDS there — `…slice(2)[0]` is a positional read, and
       `…slice(2).filter(f)` is a traversal, both caught by the branches below. */
    /* The guard FIRST: `refuseUnknownArgvOrExit(process.argv.slice(2), …)` passes the slice inline, and
       the binding rule below claimed that site, so a tool that refuses read as one that cannot. Found
       on `verify-fixtures.mjs`, whose refusal an independent measurement had already recorded. */
    if (GUARD.test(stmtMask)) sites.push({ ...site, cls: 'guarded' });
    /* THE DESTRUCTURED POSITIONAL, read before the binding branch below. `const [file, code] = argv;`
       IS `argv[0]` and `argv[1]` one spelling over, and it read as a pass-through — so
       `mutation-summary.mjs` and `residue-merge.mjs` each took a positional with nothing refusing an
       unknown token, and this scan reported an abstention over both. It sits ABOVE the slice branch
       because `const [a, b] = process.argv.slice(2)` ends in a slice too, and that branch would have
       called the same read a binding. The class is the expensive one on purpose: the token is data.
       Row 2026-10-20-sixty-nine-argv-tools-stay-undecided-after-the-seven-are-wired. */ else if (DESTRUCTURE.test(masked.slice(from, idx))) {
      const pat = /(\[[^\]]*\])\s*=\s*$/.exec(masked.slice(from, idx));
      sites.push({ ...site, cls: pat && dispatchOnly(masked, pat[1]) ? 'literal-flag' : 'positional' });
    } else if (isProcess && /^\s*\.slice\(\s*\d*\s*\)\s*[,;)\]}]?\s*$|^\s*\.slice\(\s*\d*\s*\)\s*[,;)]/.test(after)) sites.push({ ...site, cls: 'alias-binding' });
    /* `process.argv.slice(n)` as a whole expression reads no particular token: the reads happen on the
       array it yields, which this scan follows through the alias or the parameter it is handed to. The
       slice is only a binding when it ENDS there — `…slice(2)[0]` is a positional read, and
       `…slice(2).filter(f)` is a traversal, both caught by the branches below. */
    /* THE BARE ALIAS BINDING, one spelling over. `const argv = process.argv;` with no slice is the same
       binding, and `aliasDecls` records the offset of the NAME rather than of the `process.argv` on the
       right of it — so the right-hand side fell through to `passed-on`, and that single site held
       `tch-third-corner.mjs` undecidable while every read in the file names a flag. The alias set is
       what makes it safe to skip: the name must already be tracked, or this is some other expression.
       Row 2026-10-20-sixty-nine-argv-tools-stay-undecided-after-the-seven-are-wired. */ else if (
      isProcess &&
      /^\s*[;,)]/.test(after) &&
      aliases.has((ALIAS_RHS.exec(masked.slice(from, idx)) || [])[1])
    )
      sites.push({ ...site, cls: 'alias-binding' });
    else if (/^\s*\[\s*1\s*\]/.test(after) && /import\.meta\.url|fileURLToPath|pathToFileURL|realpathSync/.test(stmtMask)) sites.push({ ...site, cls: 'main-guard' });
    else if (/^\s*\.(?:includes|indexOf|lastIndexOf)\(\s*['"]/.test(text.slice(idx + m[1].length, idx + m[1].length + 24))) sites.push({ ...site, cls: 'literal-flag' });
    /* THE FLAG NAME WRITTEN AS A TEMPLATE. `process.argv.indexOf(\`--${name}\`)` is the same read as
       `indexOf('--' + name)`, which this scan has always called a literal lookup — the quote class
       simply never listed the backtick, so `box-sample.mjs` and three others abstained on a read that
       names its flag the way the tool's own helper is called. A template with NO interpolation is a
       plain literal; one WITH `${}` composes the name, so it takes the same route as `indexOf(k)` —
       decided only inside a helper every caller passes a literal to.
       Row 2026-10-20-sixty-nine-argv-tools-stay-undecided-after-the-seven-are-wired. */ else if (
      /^\s*\.(?:includes|indexOf|lastIndexOf)\(\s*`/.test(text.slice(idx + m[1].length, idx + m[1].length + 24))
    ) {
      const tpl = /`([^`]*)`/.exec(text.slice(idx + m[1].length, Math.min(text.length, idx + m[1].length + 120)));
      const composed = !tpl || tpl[1].includes('${');
      if (!composed) sites.push({ ...site, cls: 'literal-flag' });
      else sites.push({ ...site, cls: inHelper(idx) ? 'literal-flag' : 'name-variable', name: 'a name composed in a template' });
    } else if (/^\s*\.(?:includes|indexOf|lastIndexOf)\(\s*([A-Za-z_$][\w$]*)\s*\)/.test(after))
      sites.push({ ...site, cls: inHelper(idx) ? 'literal-flag' : 'name-variable', name: /\(\s*([A-Za-z_$][\w$]*)\s*\)/.exec(after)[1] });
    else if (/^\s*\[\s*(\d+|[A-Za-z_$][\w$]*\s*(?:\+|-)\s*\d+)\s*\]/.test(after)) {
      const num = /^\s*\[\s*(\d+)\s*\]/.exec(after);
      /* `argv[i + 1]` beside a literal indexOf is the valued-flag idiom, not a positional read */
      const v = /^\s*\[\s*([A-Za-z_$][\w$]*)/.exec(after);
      if (!num && /\.indexOf\(\s*['"]/.test(stmtMask)) sites.push({ ...site, cls: 'literal-flag' });
      else if (!num && v && flagIdx.has(v[1])) sites.push({ ...site, cls: 'literal-flag' });
      else if (!num && inHelper(idx)) sites.push({ ...site, cls: 'literal-flag' });
      else if (!num) sites.push({ ...site, cls: 'indexed-by-variable', name: v ? v[1] : null });
      else if (num[1] === '1' && isProcess) sites.push({ ...site, cls: 'main-guard' });
      /* `if (argv[0] === '--classify')` indexes positionally and then compares to a name the tool
         knows: an unknown token fails the comparison and lands nowhere. `rebase-safe.mjs` read as a
         consumer on exactly this line, which is a false positive in the expensive direction. */ else if (
        new RegExp(`\\[\\s*${num[1]}\\s*\\]\\s*(?:===|!==|==|!=)\\s*['"\`]`).test(masked.slice(idx, to))
      )
        sites.push({ ...site, cls: 'literal-flag' });
      else sites.push({ ...site, cls: 'positional' });
    } else if (/^\s*\.(?:slice|filter|find|findIndex|findLast|map|some|every|forEach|join|at|shift|pop|reduce|flatMap|concat|entries|keys)\b/.test(after)) {
      /* the predicate is read from the RAW text at the same offsets, and only as far as the statement
         this site sits in — a 24-character window cuts `!a.startsWith('-` in half. */
      const rawWin = text.slice(idx + m[1].length, Math.min(to, idx + m[1].length + 200));
      sites.push({ ...site, cls: SHAPE_POSITIONAL.test(rawWin) ? 'positional-by-shape' : 'traversal' });
    } else if (/^\s*[),;\]}]/.test(after) || /^\s*\.\.\./.test(masked.slice(Math.max(0, idx - 3), idx))) {
      /* A pass INTO a local function whose parameter this scan tracked is not a pass it cannot see:
         the callee is in this file and its reads were classified. An unknown callee still abstains. */
      const callee = /([A-Za-z_$][\w$]*)\s*\(\s*$/.exec(masked.slice(from, idx));
      sites.push({ ...site, cls: callee && tracked.has(callee[1]) ? 'passed-to-helper' : 'passed-on' });
    } else if (NESTED_LOOKUP.test(masked.slice(idx + m[1].length, to))) {
      /* THE LOOKUP NESTED IN THE INDEX. `argv[argv.indexOf('--threshold') + 1]` is the valued-flag idiom
       written as one expression instead of two, and the indexed branch above reads only an identifier
       ± a number, so this fell through to `no rule matched` — four tools abstained on a read whose
       flag name is spelled inside the brackets. The inner lookup is what decides: a literal names the
       flag, and a variable takes the helper route, exactly as the two-statement spelling does.
       Row 2026-10-20-sixty-nine-argv-tools-stay-undecided-after-the-seven-are-wired. */
      const inner = NESTED_LOOKUP.exec(text.slice(idx + m[1].length, Math.min(text.length, idx + m[1].length + 200)));
      const literal = inner && /['"`]/.test(inner[1] || '');
      if (literal) sites.push({ ...site, cls: 'literal-flag' });
      else sites.push({ ...site, cls: inHelper(idx) ? 'literal-flag' : 'name-variable', name: inner && inner[1] ? inner[1].trim() : 'a nested lookup' });
    } else if (/^\s*\.length\b/.test(after)) sites.push({ ...site, cls: 'length-only' });
    else sites.push({ ...site, cls: 'undecidable', why: `no rule matched the context \`${after.trim().slice(0, 20)}\`` });
  }
  return sites;
}

/** A loop over EVERY token, whose loop variable flows into a call. `for (const d of dirs) scan(d, dsp)`
 *  hands an unknown token straight to the work — `geometry-scan.mjs` scandir'd it and exited 0, which
 *  is the survey's own worked example. The rule needs both halves: a loop variable compared only
 *  against string literals is the flag-matching idiom and decides nothing, so it abstains.
 *
 *  Scope, stated because it bounds the claim: `for…of` and a BRACED `.forEach`/`.map` callback. A
 *  concise arrow body (`args.map((a) => join(d, a))`) is not read here and stays an abstention. */
export function iterationConsumes(masked, aliases, raw = masked) {
  const hits = [];
  for (const a of aliases) {
    const re = new RegExp(`for\\s*\\(\\s*(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s+of\\s+${a}\\b|\\b${a}\\s*\\.\\s*(?:forEach|map)\\s*\\(\\s*\\(?\\s*([A-Za-z_$][\\w$]*)`, 'g');
    for (const m of masked.matchAll(re)) {
      const v = m[1] || m[2];
      /* the body: from the first `{` after the header, balanced */
      const open = masked.indexOf('{', m.index + m[0].length);
      if (open < 0) continue;
      let depth = 0;
      let end = open;
      for (; end < masked.length; end++) {
        if (masked[end] === '{') depth++;
        else if (masked[end] === '}' && --depth === 0) break;
      }
      const body = masked.slice(open, Math.min(end + 1, masked.length));
      /* a template interpolation is invisible on the mask — a backtick body is blanked whole — so the
         `${…}` form is tested against the RAW text at the same offsets. */
      const bodyRaw = raw.slice(open, Math.min(end + 1, raw.length));
      const inCall = new RegExp(`[(,]\\s*${v}\\s*[,)]`).test(body) || new RegExp(`\\$\\{\\s*${v}\\s*\\}`).test(bodyRaw);
      if (inCall) hits.push({ line: masked.slice(0, m.index).split('\n').length, name: v });
    }
  }
  return hits;
}

/** The regions of a file where an argv index read is driven by a LITERAL after all.
 *
 *  The dominant idiom in this repo is a lookup helper:
 *
 *      const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
 *
 *  Inside it the lookup key is a parameter, so the site reads `name-variable` and the value read reads
 *  `indexed-by-variable`, and both abstain — 102 tools abstained on nothing but this shape. The helper
 *  is a literal lookup exactly when every call of it in the file passes a string literal in that
 *  position: then the set of names the tool can match is still closed, and a token nobody named lands
 *  nowhere. One call with a computed key, or no call at all, and the region stays undecided.
 *
 *  ⚠️ The CONTROL CANNOT REFUTE THIS RULE on a tool the probe watched ignore: agreement is the only
 *  outcome available there. Its refuting power is the five SWALLOWS rows alone — a swallower flipping
 *  to `ignores-by-construction` is a contradiction the verdict reports. State that bound beside any
 *  count this rule produces. */
export function literalHelperRegions(masked, aliases) {
  const regions = [];
  const DECL = /(?:\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>|\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\))/g;
  for (const m of masked.matchAll(DECL)) {
    const name = m[1] || m[3];
    const params = (m[2] || m[4] || '').split(',').map((x) =>
      x
        .trim()
        .replace(/[=:].*$/, '')
        .trim()
    );
    const first = params[0];
    if (!name || !first || !/^[A-Za-z_$][\w$]*$/.test(first)) continue;

    /* the region: a braced body balanced, else to the end of the statement */
    const after = m.index + m[0].length;
    const brace = masked.slice(after, after + 40).indexOf('{');
    let to;
    if (brace >= 0 && !masked.slice(after, after + brace).includes(';')) {
      let depth = 0;
      let k = after + brace;
      for (; k < masked.length; k++) {
        if (masked[k] === '{') depth++;
        else if (masked[k] === '}' && --depth === 0) break;
      }
      to = Math.min(k + 1, masked.length);
    } else {
      const semi = masked.indexOf(';', after);
      to = semi < 0 ? masked.length : semi + 1;
    }
    const body = masked.slice(m.index, to);

    /* the body must look up the alias BY that parameter — otherwise this is an unrelated function */
    if (![...aliases].some((a) => new RegExp(`\\b${a}\\s*\\.\\s*(?:includes|indexOf|lastIndexOf|findIndex)\\(\\s*${first}\\s*[,)]`).test(body))) continue;

    /* every call of the helper, anywhere in the file, must pass a string literal first */
    const calls = [...masked.matchAll(new RegExp(`[^.\\w$]${name}\\s*\\(\\s*([^,)]*)`, 'g'))].filter((c) => c.index !== m.index && !(c.index >= m.index && c.index < to));
    const sites = calls.filter((c) => c[1].trim() !== '');
    if (!sites.length) continue;
    /* the mask leaves the quotes and blanks the body, so a literal argument reads as `'    '` */
    if (!sites.every((c) => /^\s*(['"`])\s*\1?/.test(c[1]) && /^\s*['"`]/.test(c[1]))) continue;
    regions.push({ from: m.index, to, helper: name, param: first, calls: sites.length });
  }
  return regions;
}

/* ── the tool-level class ──────────────────────────────────────────────────────────────────────── */
export const TOOL_CLASSES = ['refuses', 'consumes', 'undecidable', 'ignores-by-construction', 'no-read'];

/** One class per tool, from its sites, in a declared precedence. A guard outranks everything, because
 *  it rejects the token before any other read sees it. A positional read outranks a proof of ignoring,
 *  because the token becoming data is the expensive outcome. Abstention outranks a proof, never a
 *  hazard. */
export function classifyTool(text) {
  const sites = argvSites(text);
  const inputs = sites.filter((s) => s.cls !== 'alias-binding' && s.cls !== 'main-guard');
  const by = (c) => inputs.filter((s) => s.cls === c);
  const masked = maskNonCode(text);

  if (by('guarded').length) return { cls: 'refuses', sites, why: 'a call to the argv guard refuses an unread token' };
  const iter = iterationConsumes(masked, argvAliases(masked), text);
  if (!inputs.length && !iter.length) return { cls: 'no-read', sites, why: 'argv is bound or tested for the main guard and never read as input' };
  if (by('positional').length) return { cls: 'consumes', sites, why: `${by('positional').length} positional read(s) can turn an unknown token into data` };
  /* Same precedence as the indexed spelling, and for the same reason: the token becoming data is the
     expensive outcome, so it outranks both a proof of ignoring and an abstention beside it. */
  if (by('positional-by-shape').length)
    return {
      cls: 'consumes',
      sites,
      why: `${by('positional-by-shape').length} shape-selected positional read(s) keep every non-flag token at line(s) ${by('positional-by-shape')
        .map((s) => s.line)
        .join(', ')}`
    };
  if (iter.length) return { cls: 'consumes', sites, why: `every token is iterated and reaches a call at line(s) ${iter.map((h) => h.line).join(', ')}` };

  const abst = [...by('undecidable'), ...by('traversal'), ...by('passed-on'), ...by('indexed-by-variable')];
  if (abst.length) {
    /* a traversal that carries refusal language is still only an abstention here: whether the branch
       is reached is a question about the loop, and this scanner does not evaluate loops. */
    const lang = UNKNOWN_WORD.test(masked) ? ' (the file does carry refusal language — a probe decides it, not this scan)' : '';
    return { cls: 'undecidable', sites, why: `${abst.length} site(s) this scan does not decide${lang}: ${[...new Set(abst.map((s) => s.cls))].join(', ')}` };
  }
  const nv = by('name-variable');
  if (nv.length) {
    /* `argv.indexOf(k)` inside a helper: the lookup is literal only if every caller passes a literal. */
    for (const s of nv) {
      const calls = [...masked.matchAll(new RegExp(`[^.\\w$]([A-Za-z_$][\\w$]*)\\s*\\(\\s*(['"])`, 'g'))];
      if (!calls.length) return { cls: 'undecidable', sites, why: `a lookup by the variable \`${s.name}\` with no literal call site in the file` };
    }
  }
  return { cls: 'ignores-by-construction', sites, why: `${inputs.length} read(s), every one a name the tool already knows` };
}

/* ── population ────────────────────────────────────────────────────────────────────────────────── */
/** Every tool under `dir` whose text mentions `process.argv`. The denominator is deliberately the
 *  whole set, not the inert subset: this scan runs nothing, so the survey's safety bound does not
 *  bind it. */
export function population(dir) {
  const out = [];
  for (const name of readdirSync(dir)
    .filter((f) => /\.(mjs|js)$/.test(f))
    .sort()) {
    let text;
    try {
      text = readFileSync(join(dir, name), 'utf8');
    } catch {
      continue;
    }
    if (!/process\.argv/.test(text)) continue;
    out.push(name);
  }
  return out;
}

/* ── the cross-check ───────────────────────────────────────────────────────────────────────────── */
/** A static claim contradicts a run when it decides the OPPOSITE, never when it abstains. The three
 *  forms are pre-stated here and nowhere else. */
export function contradiction(probeVerdict, scanClass) {
  if (probeVerdict === 'IGNORES' && scanClass === 'refuses') return 'the probe watched it ignore the token; the scan calls it a refuser';
  if (probeVerdict === 'REFUSES' && scanClass === 'ignores-by-construction') return 'the probe watched it refuse; the scan proves it cannot';
  if (probeVerdict === 'SWALLOWS-AS-POSITIONAL' && scanClass === 'ignores-by-construction') return 'the probe watched the token become data; the scan proves it changes nothing';
  if (probeVerdict === 'REFUSES' && scanClass === 'consumes') return 'the probe watched it refuse; the scan calls it a consumer';
  if (scanClass === 'no-read' && probeVerdict !== 'IGNORES') return `the probe watched it ${probeVerdict === 'REFUSES' ? 'refuse' : 'consume the token'}; the scan finds no read of argv at all`;
  return null;
}

export function readsVerdict({ rows, controls, commit }) {
  const bad = controls.filter((c) => c.contradicts);
  const excluded = controls.filter((c) => c.excluded);
  const checked = controls.length - excluded.length;
  const tally = rows.reduce((m, r) => ({ ...m, [r.cls]: (m[r.cls] || 0) + 1 }), {});
  const status = checked === 0 ? 'NOT_RUN' : bad.length ? 'FAIL' : 'PASS';
  return makeVerdict({
    gate: 'argv-reads',
    status,
    population: { checked, eligible: controls.length, excluded: excluded.length },
    criterion: { name: 'static_classes_contradicting_the_executable_probe', threshold: 0, unit: 'tools', direction: 'lte' },
    result:
      checked === 0
        ? null
        : {
            contradictions: bad.map((c) => ({ tool: c.tool, probe: c.probe, scan: c.cls, why: c.contradicts })),
            scanned: rows.length,
            tally,
            excludedReasons: [...new Set(excluded.map((c) => c.excluded))]
          },
    evidence: ['tools/argv-reads.mjs', CONTROL_PATH],
    reason: checked === 0 ? 'no control row was comparable, so nothing was tested' : bad.length ? `${bad.length} static class(es) contradict a recorded run` : null,
    tool: 'tools/argv-reads.mjs',
    commit
  });
}

/* ── io ────────────────────────────────────────────────────────────────────────────────────────── */
function gitShow(ref, path) {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/** The control rows, each joined to this scan's class and to whether the tool's bytes still match the
 *  artifact's recorded tree. A tool that CHANGED since the probe is excluded by name: the run described
 *  other bytes, so a disagreement would be about history, not about either instrument. */
export function crossCheck(controlJson, scanRows, { verifyBytes = true } = {}) {
  const treeCommit = controlJson.treeCommit || null;
  /* The survey keys a row by its repo-relative path, this scan by the basename within `tools/`. */
  const base = (t) => String(t).replace(/^.*\//, '');
  const out = [];
  for (const r of controlJson.rows || []) {
    const name = base(r.tool);
    const rec = { tool: name, probe: r.verdict, cls: null };
    const live = scanRows.find((s) => base(s.tool) === name);
    if (/^UNDECIDED/.test(r.verdict)) {
      rec.excluded = 'the probe itself reached no verdict (timeout)';
      out.push(rec);
      continue;
    }
    /* A tool REPAIRED since the probe must be judged on the bytes the probe RAN, not on today's. All
       five SWALLOWS rows changed, because the survey's own PR adopted the guard in five tools — so
       excluding a changed tool threw away the entire positive class and left 29 IGNORES rows to agree
       with. The historical text is in git; read it and classify that. */
    /* THE PROBED BYTES ARE THE JOIN, SO A CLONE THAT CANNOT READ THEM EXCLUDES THE ROW. `gitShow`
       returns null for every failure alike — an absent commit, an absent path, no git at all — and
       the fallback below then classified TODAY's bytes while the row still counted as comparable.
       MEASURED 2026-10-21: run over a copy of `tools/` with no git objects beside it, this cross-check
       reported `FAIL — 8 static class(es) contradict a recorded run`, naming the eight tools repaired
       since the probe. Nothing had contradicted anything; the join had silently changed subject. The
       honest verdict over unreadable bytes is an exclusion, and 45 of 45 excluded is already NOT_RUN. */
    const probedBytes = verifyBytes && treeCommit ? gitShow(treeCommit, `tools/${name}`) : null;
    if (verifyBytes && treeCommit && probedBytes === null) {
      rec.excluded =
        gitShow(treeCommit, 'package.json') === null
          ? `the probe tree ${treeCommit} is unreadable here, so the probed bytes cannot be classified`
          : 'the probe tree does not carry this tool, so there are no probed bytes to classify';
      out.push(rec);
      continue;
    }
    const then = probedBytes;
    const text = then !== null ? then : live ? readFileSync(join(ROOT, 'tools', name), 'utf8') : null;
    if (text === null) {
      rec.excluded = treeCommit ? 'neither the probe tree nor the working tree carries this tool' : 'the control names no tree to read the probed bytes from';
      out.push(rec);
      continue;
    }
    rec.cls = classifyTool(text).cls;
    rec.atProbeBytes = then !== null;
    rec.changedSince = then !== null && live ? then !== readFileSync(join(ROOT, 'tools', name), 'utf8') : null;
    rec.contradicts = contradiction(r.verdict, rec.cls);
    out.push(rec);
  }
  return out;
}

export function scanDir(dir) {
  return population(dir).map((name) => {
    const { cls, sites, why } = classifyTool(readFileSync(join(dir, name), 'utf8'));
    return { tool: name, cls, why, sites: sites.length, inputSites: sites.filter((s) => s.cls !== 'alias-binding' && s.cls !== 'main-guard').length };
  });
}

/* ── selftest: one planted tool per class, and the decoys that separate them ───────────────────── */
const PLANT = {
  'ignores.mjs': `const argv = process.argv.slice(2);\nif (argv.includes('--json')) go();\nconst i = argv.indexOf('--only');\nconst only = i >= 0 ? argv[i + 1] : null;\n`,
  'consumes.mjs': `const argv = process.argv.slice(2);\nif (argv.includes('--json')) go();\nconst target = argv[0];\nreaddirSync(target);\n`,
  'refuses.mjs': `import { refuseUnknownArgvOrExit } from './argv-guard.mjs';\nconst argv = process.argv.slice(2);\nrefuseUnknownArgvOrExit(argv, ['--json']);\nif (argv.includes('--json')) go();\n`,
  /* This plant used to be the `undecidable` one, under the assertion that a predicate traversal is not
     decided by this scan. The abstention was honest while no rule read the predicate; with one it is
     under-reporting, so the plant moved to `consumes` and the class below got a predicate that is
     genuinely undecided — a membership test against a set the tool loads at runtime. */
  'shape-positional.mjs': `const argv = process.argv.slice(2);\nconst rest = argv.filter((a) => !a.startsWith('--'));\nwork(rest);\n`,
  'undecidable.mjs': `const argv = process.argv.slice(2);\nconst known = new Set(load());\nconst rest = argv.filter((a) => known.has(a));\nwork(rest);\n`,
  'noread.mjs': `import { pathToFileURL } from 'node:url';\nconst IS_MAIN = import.meta.url === pathToFileURL(process.argv[1]).href;\nconst argv = process.argv.slice(2);\n`,
  'commented.mjs': `// const argv = process.argv.slice(2); argv[0] would be a path\nconst s = 'process.argv[2]';\nconsole.log(s);\n`,
  /* THE SAME IDIOM WITH NO ALIAS. `absence-regression.mjs` binds its index off `process.argv`
     itself, and this is the shape that abstained until `flagIndexVars` read both spellings. */
  /* THE DESTRUCTURED POSITIONAL and the dispatch it must be separated from: `mutation-summary.mjs`
     reads its two tokens as data, `findings-ledger.mjs` compares its one against a closed set. */
  'destructured.mjs': `function main(argv) {\n  if (argv.includes('--selftest')) return selftest();\n  const [file, code] = argv;\n  readFileSync(file);\n}\nmain(process.argv.slice(2));\n`,
  'dispatch.mjs': `const [cmd, ...rest] = process.argv.slice(2);\nif (process.argv.includes('--selftest')) selftest();\nif (cmd === 'add') add(rest);\nif (cmd === 'stats') stats();\n`,
  'dispatch-and-data.mjs': `const [cmd, ...rest] = process.argv.slice(2);\nif (cmd === 'add') add(rest);\nreadFileSync(cmd);\n`,
  /* THE TWO SPELLINGS THAT NAME THE FLAG SOMEWHERE THIS SCAN WAS NOT READING: inside the brackets,
     and inside a template. `brief-gaps.mjs` is the first, `box-sample.mjs` the second. */
  'nested-lookup.mjs': `const argv = process.argv.slice(2);\nconst t = argv.includes('--threshold') ? Number(argv[argv.indexOf('--threshold') + 1]) : 0;\n`,
  'template-flag.mjs': `const argv = process.argv.slice(2);\nconst i = argv.indexOf(\`--out\`);\nconst out = i >= 0 ? argv[i + 1] : null;\n`,
  /* TWO HOPS. `nsrr-oxydex-odi.mjs` hands argv to `main`, which hands it to `discover`; one pass of
     the alias sweep saw the first hop only, and the second read as a pass this scan cannot follow. */
  'two-hop.mjs': `function discover(argv) {\n  const i = argv.indexOf('--rec');\n  return i >= 0 ? argv[i + 1] : null;\n}\nfunction main(argv) {\n  if (argv.includes('--json')) go();\n  return discover(argv);\n}\nmain(process.argv.slice(2));\n`,
  /* THE BARE BINDING, no slice: `tch-third-corner.mjs`'s own shape. */
  'bare-alias.mjs': `const argv = process.argv;\nconst arg = (k) => {\n  const i = argv.indexOf(k);\n  return i > 0 ? argv[i + 1] : null;\n};\nconst mode = arg('--mode');\n`,
  'valued-flag-raw.mjs': `const k = process.argv.indexOf('--mode');\nconst mode = k >= 0 ? process.argv[k + 1] : 'd';\nif (process.argv.includes('--json')) go();\n`,
  'valued-flag.mjs': `const argv = process.argv.slice(2);\nconst k = argv.indexOf('--out');\nconst out = k >= 0 ? argv[k + 1] : 'default';\n`,
  'main-via-helper.mjs': `function main(args) {\n  if (args.includes('--json')) go();\n}\nmain(process.argv.slice(2));\n`
};

function selftest() {
  let ran = 0;
  const ok = (cond, msg) => {
    ran++;
    if (!cond) {
      console.error(`selftest FAILED: ${msg}`);
      process.exit(1);
    }
  };
  const cls = (name) => classifyTool(PLANT[name]).cls;

  ok(cls('ignores.mjs') === 'ignores-by-construction', 'a tool whose every read is a literal name ignores by construction');
  ok(cls('consumes.mjs') === 'consumes', 'a positional read makes the token data');
  ok(cls('refuses.mjs') === 'refuses', 'a guard call outranks the literal lookups beside it');
  ok(
    classifyTool("refuseUnknownArgvOrExit(process.argv.slice(2), { boolean: ['--json'] }, { tool: 't' });\nconst J = process.argv.includes('--json');\n").cls === 'refuses',
    'a guard called on an INLINE slice is a guard, not a binding — the order of these two rules decided it wrongly once'
  );
  ok(cls('undecidable.mjs') === 'undecidable', 'a predicate computed at runtime is not decided by this scan');
  /* THE SHAPE-SELECTED POSITIONAL, both directions. The positive plant is the dominant idiom in this
     tree; the three decoys are the shapes the rule deliberately declines, and each must still abstain,
     or the rule is a clearance wearing a decision's name. */
  ok(cls('shape-positional.mjs') === 'consumes', 'a predicate that keeps every non-flag token is a positional read by another spelling');
  ok(
    classifyTool("const argv = process.argv.slice(2);\nconst hit = argv.find((a) => a.startsWith('--dir='));\n").cls === 'undecidable',
    'a prefix match against a flag NAME is not a positional read, and stays an abstention'
  );
  ok(
    classifyTool('const argv = process.argv.slice(2);\nconst rest = argv.filter((a) => !isFlag(a));\nwork(rest);\n').cls === 'undecidable',
    'a helper predicate is not read, so the shape rule declines it'
  );
  ok(
    classifyTool("const argv = process.argv.slice(2);\nconst rest = argv.filter((a) => {\n  if (a.startsWith('--')) return false;\n  return true;\n});\nwork(rest);\n").cls === 'undecidable',
    'a braced predicate body is not read either — the bound is stated in the rule and asserted here'
  );
  ok(
    argvSites("const argv = process.argv.slice(2);\nconst files = argv.filter((a) => !a.startsWith('--') && existsSync(a));\n").some((s) => s.cls === 'positional-by-shape'),
    'a conjoined existence test does not hide the shape test in front of it'
  );
  ok(
    classifyTool("const DIRS = process.argv.slice(2).filter((a) => !a.startsWith('--'));\nwork(DIRS);\n").cls === 'consumes',
    'the chained spelling, with the slice inline in front of the call, is the same read'
  );
  ok(cls('noread.mjs') === 'no-read', 'a main guard and a bare binding are not input reads');
  ok(cls('valued-flag.mjs') === 'ignores-by-construction', 'the valued-flag idiom indexes by a variable the literal lookup set');
  ok(cls('nested-lookup.mjs') === 'ignores-by-construction', 'the lookup nested in the index names its flag inside the brackets, which is where this scan was not reading');
  ok(
    classifyTool('const argv = process.argv.slice(2);\nconst v = argv[argv.indexOf(k) + 1];\n').cls === 'undecidable',
    'the same nesting around a VARIABLE name, with no literal call site in the file, stays an abstention'
  );
  ok(cls('template-flag.mjs') === 'ignores-by-construction', 'a template with no interpolation is a string literal, and the quote class simply never listed the backtick');
  ok(
    classifyTool('const argv = process.argv.slice(2);\nconst i = argv.indexOf(`--${name}`);\nconst v = argv[i + 1];\n').cls === 'undecidable',
    'a template that COMPOSES the name takes the helper route, so outside one with no literal caller it abstains'
  );
  ok(cls('destructured.mjs') === 'consumes', 'a destructure off argv is `argv[0]` and `argv[1]` one spelling over, so the token is data');
  ok(cls('dispatch.mjs') === 'ignores-by-construction', 'a destructured name compared only against a closed set of literals lands an unknown token nowhere');
  ok(cls('dispatch-and-data.mjs') === 'consumes', 'one data use of the same name puts the tool back in the expensive class — the comparison does not clear it');
  ok(
    classifyTool('const [a, b] = process.argv.slice(2);\nreadFileSync(a, b);\n').cls === 'consumes',
    'the destructure is read BEFORE the slice-binding branch, which had called this same read a binding'
  );
  ok(cls('two-hop.mjs') === 'ignores-by-construction', 'the alias sweep follows argv through a second local hop, because one hop left the second as an abstention');
  ok(
    classifyTool("import { runIt } from './other.mjs';\nfunction main(argv) {\n  runIt(argv);\n}\nmain(process.argv.slice(2));\n").cls === 'undecidable',
    'a pass into an IMPORTED function is a pass this scan cannot follow, and it still abstains'
  );
  ok(dispatchOnly("const [cmd] = argv;\nswitch (cmd) {\n  case 'add':\n    add();\n}\n", '[cmd]'), 'a switch over the name with literal case labels is the same comparison in another spelling');
  ok(cls('bare-alias.mjs') === 'ignores-by-construction', "a bare `= process.argv` binding is a binding, and the reads that follow it are the file's real reads");
  ok(
    classifyTool('const cfg = {};\ncfg.raw = process.argv;\nwork(cfg);\n').cls === 'undecidable',
    'the same right-hand side assigned to a PROPERTY binds no tracked name, so it stays a pass-through this scan declines'
  );
  ok(cls('valued-flag-raw.mjs') === 'ignores-by-construction', 'the same idiom with the index bound off `process.argv` itself is the same decision');
  ok(
    classifyTool('const k = process.argv.indexOf(name);\nconst v = process.argv[k + 1];\n').cls === 'undecidable',
    'an index bound off a flag name computed at runtime names no flag, so the abstention is the honest answer'
  );
  ok(cls('main-via-helper.mjs') === 'ignores-by-construction', 'the reads inside a helper called on argv are tracked through its parameter');

  /* the decoys: text that LOOKS like a read and is not one */
  ok(cls('commented.mjs') === 'no-read', 'a commented-out read and a quoted one are not reads');
  ok(argvSites(PLANT['commented.mjs']).length === 0, 'the mask removes comment and string occurrences entirely');
  ok(maskNonCode("const s = 'argv';").indexOf('argv') === -1, 'a string body is blanked');
  ok(maskNonCode('a\n// x\nb').split('\n').length === 3, 'the mask preserves newlines so line numbers survive');
  ok(maskNonCode("x = '\\'' + process.argv").includes('process.argv'), 'an escaped quote does not swallow the rest of the file');
  ok(maskNonCode(`const re = /['\"]/;\nconst argv = process.argv.slice(2);`).includes('process.argv'), 'a quote inside a regex literal does not desynchronise the mask');
  ok(!maskNonCode(`const re = /['\"]/;\nconst s = "process.argv[2]";`).includes('process.argv'), 'and the string after such a regex is still blanked');
  ok(maskNonCode('const r = a / b;\nconst argv = process.argv;').includes('process.argv'), 'division is not a regex');
  ok(
    classifyTool("const argv = process.argv.slice(2);\nif (argv[0] === '--classify') go();\n").cls === 'ignores-by-construction',
    'a positional index compared to a literal is a name the tool knows, not a token it consumes'
  );
  ok(classifyTool("const argv = process.argv.slice(2);\nconst dir = argv[0] || 'x';\n").cls === 'consumes', 'and a positional index taken as a value still consumes');

  /* the alias tracker */
  ok(argvAliases(maskNonCode(PLANT['ignores.mjs'])).has('argv'), 'a slice binding is an alias');
  ok(argvAliases(maskNonCode(PLANT['main-via-helper.mjs'])).has('args'), "a called helper's parameter is an alias");
  ok(!argvAliases(maskNonCode('const argv = [1, 2];')).has('argv'), 'an unrelated array named argv is not an alias');

  /* the lookup helper, and the two ways it stays undecided */
  const HELPER = "const argv = process.argv.slice(2);\nconst arg = (k, d) => {\n  const i = argv.indexOf(k);\n  return i >= 0 ? argv[i + 1] : d;\n};\nconst out = arg('--out', 'x');\n";
  ok(classifyTool(HELPER).cls === 'ignores-by-construction', 'a lookup helper whose every call passes a literal keeps the name set closed');
  ok(literalHelperRegions(maskNonCode(HELPER), new Set(['argv']))[0].helper === 'arg', 'the region names the helper it decided');
  ok(classifyTool(HELPER.replace("arg('--out', 'x')", 'arg(userKey, 1)')).cls === 'undecidable', 'one computed key and the helper decides nothing');
  ok(classifyTool(HELPER.replace("const out = arg('--out', 'x');\n", '')).cls === 'undecidable', 'a helper nobody calls proves nothing about the names the tool matches');
  ok(
    literalHelperRegions(maskNonCode("const argv = process.argv.slice(2);\nconst f = (k) => other.indexOf(k);\nf('x');\n"), new Set(['argv'])).length === 0,
    'a lookup on some other array is not an argv helper'
  );

  /* the iteration rule, and the flag-matching loop it must NOT decide */
  ok(classifyTool('const argv = process.argv.slice(2);\nfor (const d of argv) {\n  scan(d, 1);\n}\n').cls === 'consumes', 'a loop whose variable reaches a call consumes every token');
  ok(
    classifyTool("const argv = process.argv.slice(2);\nfor (const a of argv) {\n  if (a === '--json') go();\n}\n").cls === 'undecidable',
    'a loop variable compared only against literals decides nothing and abstains'
  );
  const tmpl = 'const argv = process.argv.slice(2);\nfor (const a of argv) {\n  p(`${a}`);\n}';
  ok(iterationConsumes(maskNonCode(tmpl), new Set(['argv']), tmpl).length === 1, 'a template interpolation is a call-side use, read off the raw text because the mask blanks it');
  ok(iterationConsumes(maskNonCode(tmpl), new Set(['argv'])).length === 0, 'and it is invisible without the raw text, which is why the parameter exists');

  /* the precedence, stated as the cases that would reverse it */
  ok(classifyTool(`${PLANT['ignores.mjs']}${PLANT['consumes.mjs']}`).cls === 'consumes', 'one positional read outranks any number of literal lookups');
  ok(classifyTool(`${PLANT['ignores.mjs']}${PLANT['undecidable.mjs']}`).cls === 'undecidable', 'an undecided site outranks a proof of ignoring');
  ok(classifyTool(`${PLANT['refuses.mjs']}${PLANT['consumes.mjs']}`).cls === 'refuses', 'a guard outranks a consumer, because it reads the token first');

  /* the three pre-stated contradictions, and the abstention that is not one */
  ok(contradiction('IGNORES', 'refuses') !== null, 'a run that ignored against a static refusal is a contradiction');
  ok(contradiction('SWALLOWS-AS-POSITIONAL', 'ignores-by-construction') !== null, 'a run that consumed against a static proof of ignoring is a contradiction');
  ok(contradiction('REFUSES', 'ignores-by-construction') !== null, 'a run that refused against a static proof it cannot is a contradiction');
  ok(contradiction('REFUSES', 'no-read') !== null, 'a tool with no read of argv cannot have refused a token');
  ok(contradiction('SWALLOWS-AS-POSITIONAL', 'no-read') !== null, 'a tool with no read of argv cannot have consumed one');
  ok(contradiction('IGNORES', 'no-read') === null, 'no read at all is the trivial form of ignoring, not a contradiction');
  ok(contradiction('IGNORES', 'undecidable') === null, 'an abstention contradicts nothing');
  ok(contradiction('IGNORES', 'consumes') === null, 'ignoring and consuming are the same observable run: the token changed no output');
  ok(contradiction('SWALLOWS-AS-POSITIONAL', 'consumes') === null, 'the scan agreeing with the probe is not a contradiction');

  /* the verdict arithmetic */
  const rows = [{ tool: 'a.mjs', cls: 'ignores-by-construction' }];
  let v = readsVerdict({ rows, controls: [{ tool: 'a.mjs', probe: 'IGNORES', cls: 'ignores-by-construction', contradicts: null }], commit: 'abc1234' });
  ok(v.status === 'PASS' && v.population.checked === 1 && v.population.excluded === 0, 'one agreeing control passes');
  ok(v.population.checked + v.population.excluded === v.population.eligible, 'the population balances');
  v = readsVerdict({ rows, controls: [{ tool: 'a.mjs', probe: 'IGNORES', cls: 'refuses', contradicts: 'x' }], commit: 'abc1234' });
  ok(v.status === 'FAIL' && v.reason && v.result.contradictions.length === 1, 'a contradiction fails and names the tool');
  v = readsVerdict({ rows, controls: [{ tool: 'a.mjs', probe: 'IGNORES', excluded: 'changed' }], commit: 'abc1234' });
  ok(v.status === 'NOT_RUN' && v.result === null && v.population.checked === 0, 'every control excluded examines nothing, so NOT_RUN with a null result');
  ok(v.population.excluded === 1 && v.population.eligible === 1, 'an excluded control stays in the denominator');

  /* a control row for a tool the scan no longer sees is an exclusion, never a silent pass */
  const cc = crossCheck({ treeCommit: null, rows: [{ tool: 'gone.mjs', verdict: 'IGNORES' }] }, [], { verifyBytes: false });
  ok(cc[0].excluded && !cc[0].contradicts, 'a control naming a tool outside the population is excluded by name');
  const cc2 = crossCheck({ treeCommit: null, rows: [{ tool: 'a.mjs', verdict: 'UNDECIDED-timeout' }] }, [{ tool: 'a.mjs', cls: 'ignores-by-construction' }], { verifyBytes: false });
  ok(cc2[0].excluded === 'the probe itself reached no verdict (timeout)', 'a timed-out probe row decides nothing and is excluded');

  /* AN UNREADABLE PROBE TREE EXCLUDES, IT DOES NOT RECLASSIFY TODAY'S BYTES. The probe row below says
     IGNORES and this tool's live class is `refuses`, which is a pre-stated contradiction — so a fallback
     to today's bytes shows up as a contradiction and the exclusion shows up as silence. */
  const live = [{ tool: 'argv-reads.mjs', cls: 'refuses' }];
  const ccGone = crossCheck({ treeCommit: '0000000000000000000000000000000000000000', rows: [{ tool: 'tools/argv-reads.mjs', verdict: 'IGNORES' }] }, live);
  ok(!!ccGone[0].excluded && !ccGone[0].contradicts, 'a probe tree this clone cannot read excludes the row instead of contradicting on other bytes');
  ok(/unreadable here/.test(ccGone[0].excluded || ''), 'and the exclusion names the tree it could not read');
  const ccNoPath = crossCheck({ treeCommit: 'HEAD', rows: [{ tool: 'tools/no-such-tool-9f3.mjs', verdict: 'IGNORES' }] }, live);
  ok(!!ccNoPath[0].excluded && !ccNoPath[0].contradicts, 'a tool the probe tree never carried is excluded, not classified from the working tree');
  /* CONTROL · the join still reaches a verdict where the bytes ARE readable, so the two legs above are
     not an instrument that excludes everything. */
  const ccLive = crossCheck({ treeCommit: 'HEAD', rows: [{ tool: 'tools/argv-reads.mjs', verdict: 'REFUSES' }] }, live);
  ok(!ccLive[0].excluded && ccLive[0].cls === 'refuses' && !ccLive[0].contradicts, 'CONTROL · readable probed bytes still classify and agree');

  console.log(`selftest: all ${ran} selftests passed`);
}

/* ── cli ───────────────────────────────────────────────────────────────────────────────────────── */
const MARK = { 'ignores-by-construction': '○', consumes: '✗', refuses: '✓', undecidable: '?', 'no-read': '·' };

if (IS_MAIN) {
  /* This tool's own subject matter, applied to itself: a token it cannot interpret must not read as an
     absent one. Without this it classifies as `ignores-by-construction`, which is the defect it reports. */
  refuseUnknownArgvOrExit(argv, { valued: ['--only'], boolean: ['--json', '--control', '--selftest', '--verdict-sample'] }, { tool: 'argv-reads' });
  if (flag('--selftest')) {
    selftest();
    process.exit(0);
  }
  if (flag('--verdict-sample')) {
    console.log(JSON.stringify(readsVerdict({ rows: [], controls: [], commit: null }), null, 2));
    process.exit(0);
  }
  const only = opt('--only', null);
  const dir = join(ROOT, 'tools');
  if (only) {
    const path = join(dir, only.replace(/^tools\//, ''));
    if (!existsSync(path)) {
      console.error(`argv-reads: no such tool \`${only}\``);
      process.exit(2);
    }
    const text = readFileSync(path, 'utf8');
    const { cls, why, sites } = classifyTool(text);
    console.log(`${only}: ${cls} — ${why}`);
    for (const s of sites) console.log(`  ${String(s.line).padStart(5)}  ${s.cls.padEnd(20)} ${s.snippet}`);
    process.exit(0);
  }

  const rows = scanDir(dir);
  const controlJson = existsSync(join(ROOT, CONTROL_PATH)) ? JSON.parse(readFileSync(join(ROOT, CONTROL_PATH), 'utf8')) : null;
  if (!controlJson) {
    console.error(`argv-reads: the control artifact ${CONTROL_PATH} is absent — the cross-check cannot be made`);
    process.exit(2);
  }
  const controls = crossCheck(controlJson, rows);
  const verdict = readsVerdict({ rows, controls });

  if (flag('--json')) {
    console.log(JSON.stringify({ verdict, rows, controls }, null, 2));
    process.exit(verdict.status === 'FAIL' ? 1 : 0);
  }

  if (!flag('--control')) {
    for (const r of rows.filter((x) => x.cls !== 'no-read').sort((a, b) => a.cls.localeCompare(b.cls) || a.tool.localeCompare(b.tool)))
      console.log(`${MARK[r.cls]} ${r.cls.padEnd(24)} ${r.tool.padEnd(38)} ${String(r.inputSites).padStart(3)} read(s)`);
    console.log('');
    const tally = rows.reduce((m, r) => ({ ...m, [r.cls]: (m[r.cls] || 0) + 1 }), {});
    console.log(`argv-reads: ${rows.length} tool(s) read process.argv — ${TOOL_CLASSES.map((c) => `${c} ${tally[c] || 0}`).join(' · ')}`);
    console.log('argv-reads: `undecidable` is an abstention with a named reason, never a clearance — read it first');
  }
  const bad = controls.filter((c) => c.contradicts);
  const exc = controls.filter((c) => c.excluded);
  console.log(
    `argv-reads: cross-check against ${CONTROL_PATH} — ${controls.length - exc.length} of ${controls.length} probe row(s) comparable, ${exc.length} excluded, ${bad.length} contradiction(s)`
  );
  for (const c of bad) console.log(`  ✗ ${c.tool}: probe ${c.probe} · scan ${c.cls} — ${c.contradicts}`);
  if (flag('--control')) for (const c of controls.filter((x) => !x.excluded)) console.log(`  ${c.contradicts ? '✗' : '✓'} ${c.tool.padEnd(38)} probe ${String(c.probe).padEnd(24)} scan ${c.cls}`);
  console.log(`--- ${verdict.status}${verdict.reason ? ` — ${verdict.reason}` : ''}`);
  process.exit(verdict.status === 'FAIL' ? 1 : 0);
}
