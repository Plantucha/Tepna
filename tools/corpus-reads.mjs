#!/usr/bin/env node
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// corpus-reads.mjs — decide, from a tool's SOURCE, whether it enumerates a corpus root it was
// handed at run time, and whether it reports the population it actually covered.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS: Residue `2026-10-21-sixty-eight-corpus-enumerators-still-measure-whatever-set-
// they-caught`. `tools/corpus-scope.mjs` holds the primitive — `snapshotNights` around the run,
// `populationVerdict` at the end — and `tepna-corpus-tier.service` re-tiers the corpus daily at
// 14:30 EDT, so a long run can open over one night set and close over another. ONE tool reports
// the set it covered. Nothing MAKES any other tool do it, so a new corpus consumer inherits the
// defect by default rather than by oversight.
//
// THE PREDICATE IS THE HARD PART, AND TWO OBVIOUS ONES ARE BOTH WRONG:
//
//   "names a corpus root"  over-counts. 65 files in tools/ name `/srv/data/tepna-corpus`,
//                          `$DEX_UPLOADS` or an `uploads/` path. Most name it in a usage line or a
//                          comment and never enumerate anything, so no population can move under
//                          them.
//   "names a corpus root   under-counts, and it fails on the one known-good case: the wired
//    AND enumerates"       consumer `tools/tch-firmware-reference.mjs` takes `--dir <captures
//                          root>` and names no root at all. A scan that misses the control will
//                          miss the cases nobody has looked at.
//
// So the question this asks is neither. It is: DOES THIS TOOL ENUMERATE A DIRECTORY WHOSE PATH
// ARRIVED AT RUN TIME? A directory built from the repo root is a committed tree and cannot be
// re-tiered under the run. A directory off `process.argv`, `process.env` or a function parameter
// is whatever the caller pointed at, and that is the set that moves.
//
// Every class carries a `why`, because an abstention with an empty reason reads as a clearance.
//
// Usage:
//   node tools/corpus-reads.mjs                 # classify every tool under tools/
//   node tools/corpus-reads.mjs --json
//   node tools/corpus-reads.mjs --class enumerates
//   node tools/corpus-reads.mjs --selftest
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { maskNonCode } from './argv-reads.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The six classes, closed. A seventh would be a silent re-definition of the hazard set, and the
 *  sixth is what adding one DELIBERATELY looks like: `repo-corpus` carries row
 *  2026-10-21-a-repo-rooted-path-can-still-be-corpus, whose whole content is that the previous
 *  vocabulary answered `repo-tree` — a clearance — for a walk over captured bytes. */
export const TOOL_CLASSES = ['reports', 'enumerates', 'repo-corpus', 'repo-tree', 'undecidable', 'no-enumeration'];

/* A directory read. `execFileSync('find', …)` counts: it enumerates, whatever walks it. */
/* ⚠️ `snapshotNights` IS AN ENUMERATION, and leaving it out inverted this scan. A tool that moves
   its walk behind `corpus-scope.mjs` stops calling `readdirSync` itself, so the first version of
   this list read the wired tool as "enumerates no directory" — the same bin as a tool that never
   touches a capture. Measured 2026-10-21 on `tch-fused-corpus.mjs`: wiring the population verdict
   moved it from `enumerates` to `no-enumeration`, which is a hazard set that shrinks because the
   hazard became invisible. The helper call is the enumeration, and its first argument is the root. */
const ENUM_CALL = /\b(readdirSync|opendirSync|globSync|snapshotNights)\s*\(|\breaddir\s*\(|execFileSync\(\s*['"]find['"]/g;

/* An expression that can only name a tree inside this checkout. `process.cwd()` is included on
   purpose: a tool run from the repo reads the repo, and a tool run elsewhere is already outside
   the population this gate describes. */
const REPO_DERIVED = /\b(HERE|ROOT|REPO|__dirname|import\.meta\.dirname)\b|process\.cwd\(\)|fileURLToPath/;

/* A path that arrived from outside the process. */
const RUNTIME_SUPPLIED = /process\.argv|process\.env|\bargv\b|\bopts?\.|\bflags?\./;

/* ── A CORPUS-SHAPED PATH SEGMENT ──────────────────────────────────────────────────────────────
   `repo-tree` says the walk cannot reach a path a RUN supplies. It never said the walk cannot
   reach the corpus, and `docs/CORPUS-LOCATIONS.md` names the checkout's own `uploads/` tree as one
   of the places the corpus lives — so `readdirSync(join(ROOT, 'uploads/trio'))` is a repo-rooted
   enumeration over captured bytes, and the old vocabulary cleared it.

   THE SEGMENT LIST IS QUOTED, NOT INVENTED. It is the hard line `tools/xerj-load.mjs` already
   refuses per path (`FORBIDDEN`: an `uploads/` or `captures/` segment, `.edf`, raw sample
   suffixes). Re-deriving it here would give the repo two spellings of one rule that drift apart
   silently; the raw-sample suffixes are left out only because a DIRECTORY argument never carries
   one, and a file suffix in an enumeration argument is already the `capture-suffix` rule above.

   READ OVER THE RAW ARGUMENT, NEVER THE MASK. A path literal lives inside a string and
   `maskNonCode` blanks every string body, which is why `argv-reads.mjs` tests its dash against raw
   text too. Measured 2026-10-21: a scan of the MASKED argument finds this shape 0 times in
   `tools/`, and the raw argument finds it once. A detector reading the mask here would have
   reported the hazard as absent. */
const CORPUS_SEGMENT = /(?:^|\/)(?:uploads|captures?)(?:\/|$)|tepna-corpus/i;
const STR_LITERAL = /'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g;

/** Does this RAW expression name a corpus-shaped path segment in one of its string literals? PURE.
 *
 * Only the literals are tested, not the whole expression: an identifier called `uploadsDir` names
 * nothing, and a comment is gone from the argument span by construction. */
export function corpusShapedPath(raw) {
  for (const m of String(raw || '').matchAll(STR_LITERAL)) {
    if (CORPUS_SEGMENT.test(m[1] ?? m[2] ?? m[3] ?? '')) return true;
  }
  return false;
}

/** The binding through which an enumeration argument reaches a corpus-shaped path, or `null`. PURE.
 *
 * THE LITERAL AT THE SITE IS NOT THE WHOLE EVIDENCE. `const dir = join(ROOT, 'uploads', 'trio')`
 * followed by `readdirSync(dir)` spells the corpus one line earlier, and the argument at the site
 * is a bare identifier. The origin axis has resolved a name through the declaration in force since
 * the scope rewrite; the corpus axis could not, because the declaration map holds MASKED text and
 * the mask blanks every string body — the same reason the site's own argument has to be taken
 * twice. `declarationSites` now carries each initialiser's span, so the raw initialiser is one
 * slice away and the two axes read the same scope.
 *
 * Two hops, and a name is visited once. A corpus path is SPELLED in a literal rather than
 * accumulated over a chain, and an unbounded walk re-enters a self-referential binding.
 */
export function corpusShapedVia(arg, text, ctx, depth = 2) {
  if (!ctx || !ctx.sites || depth <= 0) return null;
  const seen = ctx.seen || new Set();
  for (const m of String(arg || '').matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    const all = ctx.sites.get(name) || [];
    const before = all.filter((d) => d.at < ctx.at);
    const pick = before.length > 0 ? before[before.length - 1] : all[0];
    if (!pick || typeof pick.from !== 'number') continue;
    const raw = String(text).slice(pick.from, pick.to);
    if (corpusShapedPath(raw)) return { name, raw: raw.trim() };
    const next = corpusShapedVia(pick.expr, text, { ...ctx, at: pick.at, seen }, depth - 1);
    if (next) return next;
  }
  return null;
}

/** The dashed flag an unresolved call reads, or `null`. PURE.
 *
 * THE FLAG LIVES IN THE ONE TEXT THE ORIGIN AXIS NEVER READS. `opt('--dir', join(ROOT, 'docs'))`
 * reads the command line in its first argument and the repo in its second, and the mask blanks
 * every string body — so on the masked text the dashed literal is four spaces and the only word
 * left standing is `ROOT`. The shape question is answered on the MASKED expression, because a
 * call's shape must not be read out of a string body, and the flag question on the RAW slice of
 * that same expression. Two texts, one pair of offsets, for the same reason the corpus axis needs
 * both.
 *
 * It decides nothing on its own: the caller owns the rule that the callee is a helper this file
 * does not declare, which is what makes the dashed literal evidence about a run rather than about
 * a local function the scope already resolves.
 */
export function dashedFlagRead(expr, raw) {
  const e = String(expr || '').trim();
  const call = /^([A-Za-z_$][\w$]*)\s*\(/.exec(e);
  if (!call) return null;
  const flag = /(['"`])(--[A-Za-z0-9][\w-]*)\1/.exec(String(raw || ''));
  return flag ? { callee: call[1], flag: flag[2] } : null;
}

/* THE SCAN'S OWN POPULATION RULE. A tool that enumerates a run-time path is not yet a corpus
   consumer: `wt-done.mjs` walks a worktree, `repo-map.mjs` walks the checkout, and this file walks
   `tools/`. What makes a read a CORPUS read is capture vocabulary — a night-shaped directory name,
   a capture file suffix, or a named corpus root. Without this second axis the hazard set reads 59
   and most of it is repository housekeeping. */
const CAPTURE_VOCAB = [
  /\\d\{4\}-\\d\{2\}-\\d\{2\}/, // a night-shaped name TESTED AS A REGEX. A bare 2026-10-21 is
  //                                  excluded: nearly every file header carries a date, and
  //                                  including it put 248 of 286 tools in the population.
  /_(?:ECG|PPG|PPI|RR|HR|ACC)\\?\.txt|_SPO2|\\?\.edf\b/i, // `\\?` because a tool that writes the
  //   suffix inside a REGEX writes `_PPG\.txt`, and a pattern without the optional backslash matches
  //   only the plain-string form. `pat-dip-index.mjs` carries both suffixes in regex form alone, so
  //   the strict pattern dropped it out of the population the moment its night regex was wired away.
  /\/srv\/data\/tepna-corpus|DEX_UPLOADS|CORPUS-LOCATIONS|corpusSearch/,
  /corpus-scope\.mjs|snapshotNights\s*\(/, // the night primitive itself: a tool that calls it
  //                                  reads nights, and delegating the walk must not delete the
  //                                  evidence that it does.

  /captures? root|night(?:s)? root|per-night/i
];

/** The NAMES of the population rules: the five text rules in the order `CAPTURE_VOCAB` declares
 *  them, then `walked-path`, which is not a text rule at all — it reads the PATH THE TOOL WALKS.
 *  A member admitted by that rule alone has no capture vocabulary anywhere in its text, which is
 *  how `rho-overlap-power.mjs` sat outside this population while reading the committed trio
 *  corpus: it names `uploads/trio` in a path literal and nothing else the five rules look for. */
export const VOCAB_NAMES = ['night-regex', 'capture-suffix', 'corpus-root', 'night-primitive', 'usage-line', 'walked-path'];

/** Which population rule(s) admitted this file, and the text each one matched. PURE.
 *
 * A POPULATION CLAIM OWES ITS EVIDENCE for the same reason an abstention does: `build-docs.mjs`
 * reads no capture, and it sat in the population unexamined while its origin was undecidable. */
export function vocabHits(text) {
  const hits = [];
  CAPTURE_VOCAB.forEach((re, i) => {
    const m = re.exec(String(text));
    if (m) hits.push({ rule: VOCAB_NAMES[i], match: m[0] });
  });
  /* THE SIXTH RULE OWES ITS EVIDENCE TOO, and here the evidence is the argument of the walk. */
  const walked = enumerationSites(text).find((site) => site.corpusPath);
  if (walked) hits.push({ rule: 'walked-path', match: walked.corpusEvidence || walked.raw.slice(0, 60) });
  return hits;
}

/** Is this file a CORPUS consumer at all? The gate's population rule. PURE. */
export function isCorpusConsumer(text) {
  /* READ OVER THE RAW TEXT, NOT THE MASKED CODE. A capture suffix almost always sits inside a
     string literal (`'_ECG.txt'`), and masking blanks every string — reading the mask here cut the
     population from 50-odd tools to 16 and quietly dropped most real corpus consumers. A usage
     line that says `--dir <captures root>` is evidence too. The population rule is deliberately
     generous; the precision lives in the origin axis below, which decides what the tool ENUMERATES. */
  if (CAPTURE_VOCAB.some((re) => re.test(String(text)))) return true;
  /* AND THE PATH THE TOOL WALKS IS EVIDENCE WHEN ITS TEXT CARRIES NONE. A vocabulary rule keyed on
     the file reads every mention — a usage line, a forbidden-path list, a scrub — while this rule
     reads the one string that is unambiguously a corpus read: the argument of an enumeration.
     Deliberately NOT a text rule: measured 2026-10-21, admitting any file whose text holds an
     `uploads/` segment anywhere would have pulled in 20 more tools, 9 of them straight into the
     hazard set, and `build.mjs`, `gemini-review.mjs`, `repo-map.mjs` and `xerj-bench.mjs` among
     them name the segment in a forbidden-path list or a docs walk. Keyed on the walk it is one
     tool, and that tool reads the committed trio corpus. */
  return enumerationSites(text).some((site) => site.corpusPath);
}

/** Every DECLARATION SITE of every identifier, in source order, with its offset. PURE.
 *
 * TWO SPELLINGS THE FIRST VERSION COULD NOT SEE, AND EACH ONE COST AN ABSTENTION:
 *  · A name declared twice had ONE entry, the first in the file, so a one-letter name resolved to
 *    an unrelated variable. `ppg-bridge-hrv-validate.mjs` walks `readdirSync(d)` where `d` is the
 *    parameter of `walk`, and its abstention quoted `ivMs[i] - ivMs[i - 1]` — the `d` declared 177
 *    lines earlier, which is not a path and never reaches that call.
 *  · A `for … of` binding carries no `=`, so `for (const d of dirs)` declared nothing at all. The
 *    ITERATED expression is the origin to read: a loop over paths from `argv` is a run-time read
 *    whichever element the body opens.
 * A destructuring binding (`const { a } = obj`) is still invisible, and deliberately: the origin of
 * one field is not the origin of the object. */
export function declarationSites(masked) {
  const out = new Map();
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?:(=)|\b(of|in)\b)\s*([^;\n]*)/g;
  for (const m of masked.matchAll(re)) {
    /* A `for … of` head ends at its own close paren; an `=` initialiser runs to the line end. */
    const expr = m[2] ? m[4] : m[4].replace(/\).*$/, '');
    /* THE INITIALISER'S SPAN, FOR THE SAME REASON THE SITE'S ARGUMENT CARRIES ONE. The mask is
       length-preserving, so `[from, to)` measured here indexes the raw text exactly, and the
       corpus axis needs the RAW initialiser: a path lives in a string body, which the mask blanks. */
    const from = m.index + (m[0].length - m[4].length);
    if (!out.has(m[1])) out.set(m[1], []);
    out.get(m[1]).push({ at: m.index, expr, from, to: from + expr.length });
  }
  return out;
}

/** Name → the FIRST initialiser in the file, which is what the scope-blind rule read. PURE. */
export function declarations(masked) {
  const out = new Map();
  for (const [k, v] of declarationSites(masked)) out.set(k, v[0].expr);
  return out;
}

/** The end offset of the body a function header at `from` opens. PURE. */
function bodyEnd(masked, from) {
  let i = from;
  while (i < masked.length && /\s/.test(masked[i])) i++;
  if (masked[i] === '{') {
    let depth = 0;
    for (let j = i; j < masked.length; j++) {
      if (masked[j] === '{') depth++;
      else if (masked[j] === '}' && --depth === 0) return j;
    }
    return masked.length;
  }
  /* A concise arrow body: to the first `;`, newline or unmatched closer. */
  let depth = 0;
  for (let j = i; j < masked.length; j++) {
    const c = masked[j];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth === 0) return j;
      depth--;
    } else if ((c === ';' || c === '\n') && depth === 0) return j;
  }
  return masked.length;
}

/** Keywords that wear a method's shape — `if (x) {` is not a function. */
const NOT_A_FUNCTION = new Set(['if', 'for', 'while', 'switch', 'catch', 'do', 'else', 'return', 'function', 'with']);

/** Every function in the file: its name, its parameters, and the span of its body. PURE.
 *
 * A GENERATOR'S PARAMETERS WERE INVISIBLE. The old `parameters()` reads `function` and then a name,
 * and `async function* walk(dir, base = dir)` puts a star between the two, so `corpus-tier.mjs`
 * abstained on a plain parameter. The spans carry SCOPE as well, which is what tells one `d` from
 * another: a parameter of the function the call sits INSIDE is the binding in force. */
export function functionSpans(masked) {
  const spans = [];
  const add = (name, raw, from) => {
    const params = new Set();
    for (const p of String(raw).split(',')) {
      const n = p
        .trim()
        .replace(/[={].*$/, '')
        .trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) params.add(n);
    }
    spans.push({ name, params, at: from, end: bodyEnd(masked, from) });
  };
  for (const m of masked.matchAll(/(?:\basync\s+)?\bfunction\b\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g)) add(m[1] || null, m[2], m.index + m[0].length);
  for (const m of masked.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/g)) add(m[1], m[2] ?? m[3] ?? '', m.index + m[0].length);
  /* THE DECLARATOR FORM OF A FUNCTION EXPRESSION, which the `function` pattern above sees as
     ANONYMOUS because its name is optional there. Without this line `const f = function (…) {}`
     produces a span with a null name, so `localFunctions` drops it and the local-helper rung
     cannot follow argv into the body. The keyword is what makes the name safe to register: `=
     function` binds nothing else. A named expression (`const f = function g(…) {}`) binds BOTH,
     and the pattern above already registers the inner `g`. */
  for (const m of masked.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b\s*\*?\s*(?:[A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g)) add(m[1], m[2], m.index + m[0].length);
  for (const m of masked.matchAll(/\(([^)]*)\)\s*=>/g)) add(null, m[1], m.index + m[0].length);
  for (const m of masked.matchAll(/(?:^|[^\w$)])([A-Za-z_$][\w$]*)\s*=>/gm)) add(null, m[1], m.index + m[0].length);
  /* Method shorthand, which an object of walkers is written as. The keyword guard is what keeps
     `if (dir) {` from declaring a parameter called `dir`. */
  for (const m of masked.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g)) if (!NOT_A_FUNCTION.has(m[1])) add(m[1], m[2], m.index + m[0].length - 1);
  return spans;
}

/** Name → the body text of a function this file declares. PURE. */
export function localFunctions(masked) {
  const out = new Map();
  for (const s of functionSpans(masked)) if (s.name && !out.has(s.name)) out.set(s.name, masked.slice(s.at, s.end + 1));
  return out;
}

/** Does this text read a value from outside the process, directly or through one binding? PURE. */
function readsRuntime(text, sites, depth) {
  if (RUNTIME_SUPPLIED.test(String(text))) return true;
  if (depth <= 0) return false;
  for (const m of String(text).matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
    const d = sites.get(m[1]);
    if (d?.some((x) => readsRuntime(x.expr, sites, depth - 1))) return true;
  }
  return false;
}

/** Every identifier that is a function parameter somewhere in the file. PURE. */
export function parameters(masked) {
  const out = new Set();
  const re = /(?:function\s*\*?\s*[A-Za-z_$\w]*\s*\(([^)]*)\)|\(([^)]*)\)\s*=>|\b([A-Za-z_$][\w$]*)\s*=>)/g;
  for (const m of masked.matchAll(re)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? '';
    for (const p of raw.split(',')) {
      const name = p
        .trim()
        .replace(/[={].*$/, '')
        .trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) out.add(name);
    }
  }
  return out;
}

/** Trace one argument expression to an origin. PURE, and it abstains rather than guessing.
 *
 * `ctx` is optional and carries SCOPE: `{ at, sites, spans, fns }`. Without it the function keeps
 * its first, scope-blind behaviour, which resolved a name to the first declaration anywhere in the
 * file. With it a name resolves in the scope of the call. */
/** The arms of a top-level ternary, or a single-element list when there is no ternary. */
export function splitTopTernary(expr) {
  const s = String(expr);
  let depth = 0;
  const cuts = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    /* `?.` and `??` are not conditionals, and an arrow's `=>` never reaches here as a cut. */ else if (depth === 0 && ch === '?' && s[i + 1] !== '.' && s[i + 1] !== '?' && s[i - 1] !== '?')
      cuts.push(i);
    else if (depth === 0 && ch === ':' && cuts.length > 0) cuts.push(i);
  }
  if (cuts.length < 2) return [s.trim()];
  return [s.slice(cuts[0] + 1, cuts[1]).trim(), s.slice(cuts[1] + 1).trim()].filter(Boolean);
}

export function originOf(expr, decls, params, seen = new Set(), ctx = null) {
  const e = String(expr || '').trim();
  if (!e) return { origin: 'undecidable', why: 'the enumeration call has no readable argument' };
  /* THE ORDER IS THE WHOLE RULE, AND BOTH REWRITES BELOW CAME OUT OF ONE MEASUREMENT.
     (a) A RUN-TIME READ BEATS A REPO JOIN in the same expression. The repo's flag idiom is
     `opt('--dir', join(ROOT, 'uploads', 'trio'))`: under the old order `REPO_DERIVED` matched
     `ROOT` and cleared the site, while every real run passes `--dir`. A default is the fallback;
     the flag is what a run supplies.
     (b) A BARE IDENTIFIER IS RESOLVED BEFORE EITHER REGEX SEES IT. `REPO_DERIVED` matches the bare
     words `ROOT`, `REPO` and `HERE`, so `readdirSync(ROOT)` was cleared by the NAME of its
     variable and never by what the variable holds — and in `pat-dip-validate.mjs` that name holds
     a positional command-line argument (`positionalArgs(argv, ARGV_SPEC).find(…)`). A naming
     convention is not a value. The name heuristic survives only as the LAST resort, for an
     identifier this file neither declares nor takes as a parameter. */
  const id = /^([A-Za-z_$][\w$]*)$/.exec(e);
  if (!id && RUNTIME_SUPPLIED.test(e)) return { origin: 'runtime', why: null };
  if (id) {
    const name = id[1];
    if (seen.has(name)) return { origin: 'undecidable', why: `\`${name}\` resolves to itself` };
    seen.add(name);
    if (ctx) {
      /* SCOPE FIRST, INNERMOST FIRST. A parameter of an enclosing function is the binding in
         force, whatever else the file declares under that name. */
      const enclosing = ctx.spans.filter((s) => s.at <= ctx.at && ctx.at <= s.end).sort((a, b) => b.at - a.at);
      if (enclosing.some((s) => s.params.has(name))) return { origin: 'runtime', why: null };
      /* Then the NEAREST PRECEDING declaration, not the first in the file. */
      const before = (ctx.sites.get(name) || []).filter((d) => d.at < ctx.at);
      const pick = before.length > 0 ? before[before.length - 1] : (ctx.sites.get(name) || [])[0];
      if (pick) {
        /* THE RAW INITIALISER TRAVELS WITH THE MASKED ONE. `pick.expr` is masked, so a flag read
           inside it is blank; the span the declaration carries indexes the raw text exactly. */
        const raw = typeof pick.from === 'number' && ctx.text ? String(ctx.text).slice(pick.from, pick.to) : '';
        return originOf(pick.expr, decls, params, seen, { ...ctx, at: pick.at, raw });
      }
    }
    if (params.has(name) && !decls.has(name)) return { origin: 'runtime', why: null };
    if (decls.has(name)) return originOf(decls.get(name), decls, params, seen, ctx);
    /* Last resort, and only here: an identifier with no binding in this file. `HERE` imported from
       a shared module is still the repo root; `argv` is still the command line. */
    if (RUNTIME_SUPPLIED.test(name)) return { origin: 'runtime', why: null };
    if (REPO_DERIVED.test(name)) return { origin: 'repo', why: null };
    return { origin: 'undecidable', why: `\`${name}\` is neither declared nor a parameter in this file` };
  }
  /* A CALL TO A FUNCTION THIS FILE DECLARES. The repo's own argv helper wears this shape —
     `arg('--dir', null)` reads a module-level `argv` bound to `process.argv.slice(2)` — so the
     path arrived from outside the process although the call site names neither. Twelve of the 28
     abstentions were this one spelling. */
  const call = /^([A-Za-z_$][\w$]*)\s*\(/.exec(e);
  if (ctx && call && ctx.fns.has(call[1]) && readsRuntime(ctx.fns.get(call[1]), ctx.sites, 2)) return { origin: 'runtime', why: null };
  /* A HELPER THIS FILE DOES NOT DECLARE, WITH A DASHED FLAG IN ITS ARGUMENTS. The branch above
     resolves a LOCAL helper, and the tree is moving the other way: 58 files import
     `refuseUnknownArgvOrExit` and 13 `positionalArgs`, so an argv read that used to be declared
     beside its call site now arrives from a shared module and the branch above cannot see it. Under
     the old ladder such a call fell through to the name heuristic and `opt('--dir', join(ROOT,
     'docs'))` cleared as a repo walk on the word `ROOT`. A flag read beats a repo default here for
     the same reason it does for a local helper: the default is the fallback, the flag is what a run
     supplies. The evidence is `ctx.raw`, because the dashed literal exists in no other text. */
  if (ctx && call && !ctx.fns.has(call[1]) && dashedFlagRead(e, ctx.raw)) return { origin: 'runtime', why: null };
  /* A TERNARY HAS TWO ARMS AND A RUN IS FREE TO TAKE EITHER. `nsrr-stage-validate.mjs` guards an
     absolute path with `DIR.startsWith('/') ? DIR : join(ROOT, DIR)`, where `DIR` is `arg('--dir',
     null)`: the repo arm is the fallback, the flag arm is the path a run supplies. Decide on the
     arms, hazard first — the same ladder, applied to a shape that spells both origins at once. */
  const arms = splitTopTernary(e);
  if (arms.length > 1) {
    /* THE ARMS DROP THE RAW SLICE, DELIBERATELY. `ctx.raw` spans the WHOLE expression, so keeping
       it would let a flag in one arm decide the other — the one thing an arm-by-arm ladder exists
       to prevent. An arm that reads a flag of its own still says so on the masked text. */
    const got = arms.map((a) => originOf(a, decls, params, new Set(seen), ctx ? { ...ctx, raw: '' } : ctx).origin);
    if (got.includes('runtime')) return { origin: 'runtime', why: null };
    if (got.includes('undecidable')) {
      return { origin: 'undecidable', why: `one arm of \`${e.slice(0, 40)}\` traces to no declaration` };
    }
    if (got.includes('repo')) return { origin: 'repo', why: null };
  }
  /* A call or a join of several parts: decide on the parts. */
  const inner = e.replace(/^[A-Za-z_$][\w$]*\s*\(/, '').replace(/\)\s*$/, '');
  if (inner !== e) {
    const parts = inner
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const seenOrigins = parts.map((p) => originOf(p, decls, params, new Set(seen), ctx ? { ...ctx, raw: '' } : ctx).origin);
    if (seenOrigins.includes('runtime')) return { origin: 'runtime', why: null };
    if (seenOrigins.includes('repo')) return { origin: 'repo', why: null };
  }
  /* AND ONLY NOW the name heuristic. `arg('--dir', join(ROOT, 'uploads', 'trio'))` names `ROOT`
     and reads the command line; the repo rule is the last thing tried, not the first, so every
     resolution path gets its turn before a convention decides. */
  if (REPO_DERIVED.test(e)) return { origin: 'repo', why: null };
  return { origin: 'undecidable', why: `the argument \`${e.slice(0, 48)}\` traces to no declaration` };
}

/** The argument text of every enumeration call in the file, with its origin. PURE. */
export function enumerationSites(text) {
  const masked = maskNonCode(text);
  const decls = declarations(masked);
  const params = parameters(masked);
  /* SCOPE, built once per file: where every name is declared, where every function body runs, and
     the body of every function this file declares. The offset of the call is what selects among
     them, so it is the only member that moves per site. */
  const ctx = { at: 0, text, sites: declarationSites(masked), spans: functionSpans(masked), fns: localFunctions(masked) };
  const sites = [];
  for (const m of masked.matchAll(ENUM_CALL)) {
    const open = masked.indexOf('(', m.index + (m[0].endsWith('(') ? m[0].length - 1 : 0));
    if (open < 0) continue;
    let depth = 0;
    let end = -1;
    for (let i = open; i < masked.length; i++) {
      if (masked[i] === '(') depth++;
      else if (masked[i] === ')') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) continue;
    const args = masked.slice(open + 1, end);
    const call = m[0].replace(/\s*\($/, '').replace(/\($/, '');
    const ranges = splitTopRanges(args);
    /* `find` takes its path in the SECOND argument (`execFileSync('find', [dir], …)`). */
    const span = /find/.test(call) ? ranges[1] : ranges[0];
    const arg = span ? args.slice(span[0], span[1]).trim() : '';
    /* THE SAME SPAN, TAKEN FROM THE RAW TEXT. The mask is length-preserving, so one pair of offsets
       indexes both: the masked slice decides the ORIGIN (a string body must not look like code) and
       the raw slice decides whether the path is CORPUS-SHAPED (a path literal is nothing but a
       string body). Reading one of those two questions off the wrong text is how the hazard was
       invisible: the masked argument carries the shape 0 times across `tools/`. */
    const raw = span ? text.slice(open + 1 + span[0], open + 1 + span[1]).trim() : '';
    const atSite = corpusShapedPath(raw);
    const via = atSite ? null : corpusShapedVia(arg, text, { ...ctx, at: open });
    sites.push({
      call: call.trim(),
      arg,
      raw,
      corpusPath: atSite || via !== null,
      /* THE EVIDENCE NAMES WHICH TEXT DECIDED. A site resolved through a binding quotes that
         binding, because `raw` there is a bare identifier and an identifier names no path. */
      corpusEvidence: atSite ? raw.slice(0, 60) : via ? `${via.name} = ${via.raw.slice(0, 48)}` : null,
      ...originOf(arg, decls, params, new Set(), { ...ctx, at: open, raw })
    });
  }
  return sites;
}

/** The `[start, end)` span of every top-level argument in an argument list. PURE.
 *
 * `splitTop` returns the TEXT, which is all the origin axis needs. The corpus axis needs the same
 * argument's RAW characters, and the only way to take those from the raw text is by offset: the
 * mask preserves length, so a span measured on the mask indexes the raw text exactly. Splitting
 * the RAW list instead would desync on a comma inside a string literal — the one thing the mask
 * exists to hide — so the split stays on the mask and only the slice moves. */
export function splitTopRanges(args) {
  const str = String(args);
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) {
      out.push([start, i]);
      start = i + 1;
    }
  }
  out.push([start, str.length]);
  return out;
}

/** Split an argument list on top-level commas. PURE.
 *
 * One splitter, two readers: this is `splitTopRanges` sliced and trimmed. The equality is pinned by
 * a selftest leg over every argument list in `tools/`, because `mutate.mjs` is not the only thing
 * that would break quietly if a re-expression of a shared splitter moved one character. */
export function splitTop(args) {
  const str = String(args);
  return splitTopRanges(str).map(([a, b]) => str.slice(a, b).trim());
}

/** Decide one tool from its source. PURE. */
export function classifyTool(text) {
  const sites = enumerationSites(text);
  if (sites.length === 0) return { cls: 'no-enumeration', why: 'the file enumerates no directory', sites };
  const masked = maskNonCode(text);
  if (/\bpopulationVerdict\s*\(/.test(masked)) {
    return { cls: 'reports', why: null, sites };
  }
  const runtime = sites.filter((s) => s.origin === 'runtime');
  if (runtime.length > 0) {
    return { cls: 'enumerates', why: `${runtime.length} enumeration(s) over a path supplied at run time, with no population verdict`, sites };
  }
  /* THE LADDER IS runtime > undecidable > repo, AND THE MIDDLE RUNG WAS MISSING. The first
     version abstained only when EVERY site abstained, so a file holding one repo-derived walk and
     one unresolved walk read as a clean `repo-tree` — a clearance stated over a site nobody had
     examined, which is the §4b family one layer down. Seven corpus consumers sat in that bin, and
     each one of them turns out to enumerate a run-time path. An abstention anywhere now blocks the
     clearance, because a tree built from the repo root cannot be claimed for a path nothing read. */
  const undec = sites.filter((s) => s.origin === 'undecidable');
  if (undec.length > 0) {
    return { cls: 'undecidable', why: `${undec.length} of ${sites.length} enumeration(s) unresolved — ${undec[0].why}`, sites };
  }
  /* THE RUNG THE ROW ADDED, AND IT SITS BELOW THE ABSTENTION ON PURPOSE. A walk whose path cannot
     be resolved is the stronger finding: `undecidable` says nobody has read this path, while
     `repo-corpus` says the path HAS been read and it reaches captured bytes inside the checkout.
     Above a clearance, though — `repo-tree` is the only verdict in this vocabulary that says a run
     cannot steer the walk, and it was being handed to a tool walking the committed trio corpus
     (row 2026-10-21-a-repo-rooted-path-can-still-be-corpus). The class is a HAZARD class: the
     suite group requires a population verdict or a named backlog row from it, exactly as it does
     from `enumerates`. */
  const inCorpus = sites.filter((site) => site.corpusPath);
  if (inCorpus.length > 0) {
    return {
      cls: 'repo-corpus',
      why: `${inCorpus.length} repo-rooted enumeration(s) under a corpus-shaped path — \`${inCorpus[0].corpusEvidence || inCorpus[0].raw.slice(0, 48)}\``,
      sites
    };
  }
  return { cls: 'repo-tree', why: null, sites };
}

/* THE SCANNER IS NOT ITS OWN SUBJECT. This file carries every corpus root and capture suffix the
   population rule looks for, and it enumerates `tools/` off a parameter, so it classifies itself as
   a corpus consumer that enumerates a run-time path. That is the §4 self-match: a scan whose own
   text is its pattern reports about itself. Named here rather than filtered silently. */
export const SELF = 'tools/corpus-reads.mjs';

/* ── THE POPULATION RULE'S OTHER DIRECTION ─────────────────────────────────────────────────────
   `isCorpusConsumer` is deliberately generous and reads capture vocabulary out of the RAW text,
   so it admits five tools that enumerate no capture at all. Each is named here with the text that
   admitted it, because a generous rule plus a silent filter is a population nobody can audit:

     argv-survey.mjs        `DEX_UPLOADS`, inside `delete env.DEX_UPLOADS;` — the mention is the
                            SCRUB that keeps a probe away from the corpus. Presence is
                            ANTI-evidence here, and no rule keyed on presence can tell.
     importer-flag-probe.mjs  the same scrub, one word of prose away from it: the probe strips
                            `DEX_UPLOADS` from every child it imports a tool into, and the only
                            directory it enumerates is the `tools/` tree its `--tools-dir` names.
     build-docs.mjs         the night regex `\d{4}-\d{2}-\d{2}`, which validates a release date
                            in the docs builder. It enumerates `docs/`.
     nsrr-effort-typing.mjs `.edf`, under `/srv/data/shhs/` — the public NSRR mount, a different
     nsrr-score-pool.mjs    filesystem from the capture corpus, which the daily re-tier never
                            touches (`corpus-tier.mjs` is scoped to `/srv/data/tepna-corpus/`).

   A row excluded here keeps its CLASS — the scan still reports what it enumerates — and only
   leaves the corpus population, so nothing is hidden. */
export const POPULATION_EXCLUSIONS = {
  'argv-survey.mjs': 'names DEX_UPLOADS only to delete it from a probe environment',
  'importer-flag-probe.mjs': 'names DEX_UPLOADS only to scrub it from each probe child; it enumerates the tools/ tree',
  'build-docs.mjs': 'the night-shaped regex validates a release date; it enumerates docs/',
  'nsrr-effort-typing.mjs': 'reads .edf under /srv/data/shhs, the public NSRR mount, not the capture corpus',
  'nsrr-score-pool.mjs': 'reads .edf under /srv/data/shhs, the public NSRR mount, not the capture corpus'
};

/* ── THE FIVE THE TRACER STILL WILL NOT DECIDE ─────────────────────────────────────────────────
   Named, with the shape that defeats the tracer, so a SIXTH is a red rather than a shrug. The
   abstention is the honest answer in each: none of the three shapes can be decided from the
   masked expression alone, and a guess in either direction would be a verdict over an unexamined
   path. They group into three kinds, not five special cases:

     board.mjs            a HOME-DIRECTORY store (`path.join(homedir(), '.npm', '_npx')`,
     fleet-turns.mjs      `join(homedir(), …)` for the transcripts) — neither the repo tree nor a
                          path any flag supplies, and the ladder has no rung for it.
     release.mjs          a LOCAL HELPER the tracer follows only far enough to look for a run-time
                          read: `p('changes')` is `join(ROOT, …)`, so abstaining costs a true
                          repo clearance and claims nothing.
     sigma-corpus-headless.mjs  a WORKLIST walk — `readdirSync(stack.pop())`, whose origin is
     r5-hr-reference.mjs        whatever was pushed; and a TEMPLATE literal root, whose body the
                                mask blanks (`${REPO}/uploads/trio` reads as an empty backtick
                                pair). Both are real corpus reads that the scan cannot prove. */
export const UNDECIDED_CORPUS = {
  'board.mjs': 'a home-directory store under homedir(), neither repo tree nor a flag-supplied path',
  'fleet-turns.mjs': 'a home-directory transcript store under homedir()',
  'release.mjs': 'the local helper p() joins the repo ROOT; the tracer follows a helper only to find a run-time read',
  'sigma-corpus-headless.mjs': 'a worklist walk over stack.pop(), whose origin is whatever was pushed',
  'r5-hr-reference.mjs': 'a template-literal root; the mask blanks the body, so the expression reads empty'
};

/* ── THE NAMED SET: corpus enumerators that report no population ───────────────────────────────
   DEBT, NOT APPROVAL. Each value is the number of enumerations that put the tool in the HAZARD
   set — run-time reads for an `enumerates` row, and repo-rooted reads under a corpus-shaped path
   for a `repo-corpus` row. The two classes carry the same obligation, so they share one list; the
   class is on the scan's row, where it is measured rather than transcribed. A ratchet on the COUNT would pass a new consumer arriving as another one left, so the
   suite group pins the NAMES and reds in both directions: an unlisted enumerator, and a listed
   tool the scan has stopped reading as one.

   It lives here rather than in the suite because `verdict-adoption.mjs` reads a tool stem named
   under `tests/` as evidence that a test covers it. A hazard list is not that, and the mention
   alone reded its ratchet. */
export const UNWIRED_BACKLOG = {
  'acc-acc-control.mjs': 1,
  /* THE SEVEN THE BINDING HOP ADMITTED, 2026-10-21, row
     2026-10-21-the-corpus-axis-reads-the-site-only. Each one binds the trio root to a variable and
     walks the variable, so the population rule read no corpus path at the site and the tool sat
     outside this list. The debt is not new — only visible.
     `closure-tol-hac.mjs` was the seventh and abstained, so it was named in `UNDECIDED_CORPUS`
     instead. Its walk is `path.resolve(ROOT, arg('--trio', 'uploads/trio'))`, which the name
     heuristic used to clear on the word `ROOT` before the parts were decided, and the ladder
     below it now resolves to the flag. Row
     2026-10-21-the-repo-name-heuristic-decides-before-the-parts-recursion.
     THE COUNTS WERE RE-MEASURED in that row, because four of them moved with the ladder and two
     had drifted under the rung that landed in #3862. Nothing reads the number; a wrong one is
     still a wrong statement.
     THREE OF THOSE SEVEN HAVE LEFT THIS LIST — `ecg-apnea-correlate.mjs`, `deep-vlf-probe.mjs` and
     `pb-agreement.mjs` now snapshot the trio root before the walk and publish the comparison, so
     the scan reads them as `reports` and this list must not name them (row
     2026-10-21-forty-one-corpus-enumerators-report-no-population). */
  'closure-tol-hac.mjs': 1,
  'motion-rho-vs-minrho.mjs': 2,
  'pb-fusion-blast.mjs': 1,
  'tch-minrho-corpus.mjs': 2,
  'acc-shared-movement.mjs': 2,
  'beat-comb-analysis.mjs': 1,
  'beat-correspondence.mjs': 1,
  'beat-error-recovery.mjs': 2,
  'codex-export.mjs': 1,
  'corpus-census.mjs': 2,
  'corpus-tier.mjs': 1,
  'cpap-corpus.mjs': 2,
  'cpap-oxy-couple.mjs': 1,
  'cpap-sa2-agreement.mjs': 1,
  'cvhr-edge-widen.mjs': 3,
  'cvhr-fold-rescore.mjs': 1,
  'deep-desat-falsifier.mjs': 1,
  'deep-flow-join.mjs': 2,
  'device-stability.mjs': 1,
  'dual-clock-rate.mjs': 1,
  'ecg-rate-transfer.mjs': 1,
  'edge-settle.mjs': 1,
  'geometry-scan.mjs': 1,
  'h10-session-rate.mjs': 1,
  'hostaxis-estimator-bakeoff.mjs': 1,
  'nsrr-criterion-sweep.mjs': 1,
  'nsrr-oxydex-odi.mjs': 2,
  'nsrr-stage-validate.mjs': 1,
  'o2ring-finger-validate-batch.mjs': 1,
  'oxy-hr-bias.mjs': 2,
  'pat-connection-stability.mjs': 3,
  'pat-dip-validate.mjs': 2,
  'pat-drift-attribution.mjs': 2,
  'pat-ecg-axis-residual.mjs': 1,
  'pat-finger-coupler.mjs': 2,
  'pat-host-offset.mjs': 2,
  'pat-hrv-windows.mjs': 1,
  'pat-literature-spec.mjs': 1,
  'pat-matchrate-strict.mjs': 3,
  'pat-mode-posture.mjs': 2,
  'pat-per-led.mjs': 1,
  'pat-ppg-ppg-control.mjs': 2,
  'pat-residual-structure.mjs': 2,
  'pat-three-corner.mjs': 1,
  'pat-window-oracle.mjs': 1,
  'pat-window-scaling.mjs': 1,
  'pin-coverage.mjs': 2,
  'pletha-marker-oracle.mjs': 1,
  'ppg-autogain-e2.mjs': 1,
  'ppg-bridge-hrv-validate.mjs': 1,
  'ppg-foot-consensus-e1.mjs': 1,
  'ppg-foot-residual-sweep.mjs': 1,
  'ppg-fusion-e3.mjs': 1,
  'ppg-gap-bridge-scan.mjs': 1,
  'ppg2w-spo2-fit.mjs': 1,
  'ppi-jitter-vs-ecg.mjs': 1,
  'resp-acc-headless.mjs': 2,
  /* THE ONE `repo-corpus` MEMBER (row 2026-10-21-a-repo-rooted-path-can-still-be-corpus). It walks
     `uploads/trio` inside the checkout, which no flag can re-point, and its own usage line says
     "reads the committed uploads/trio corpus" — so the walk was never in doubt, only invisible.
     Wiring it means deleting this line, and the reverse leg reds if the line outlives the debt. */
  'rho-overlap-power.mjs': 2,
  'resp-cardiac-suppression-e8.mjs': 1,
  'seqnet-eval.mjs': 1,
  'stage-lab.mjs': 12,
  'stitch-31d-run.mjs': 3,
  'stuck-run-lengths.mjs': 1,
  'tch-pooled-hat.mjs': 1,
  'trio-batch.mjs': 7,
  'wearable-sync.mjs': 1
};

/** Classify every tool under one directory. Returns rows sorted by name. */
export function scanDir(dir) {
  const rows = [];
  for (const f of readdirSync(dir)
    .filter((n) => /\.(mjs|js)$/.test(n))
    .sort()) {
    const text = readFileSync(join(dir, f), 'utf8');
    const r = classifyTool(text);
    const runtime = r.sites.filter((x) => x.origin === 'runtime').length;
    const excluded = POPULATION_EXCLUSIONS[f] || null;
    rows.push({
      tool: `tools/${f}`,
      cls: r.cls,
      why: r.why,
      sites: r.sites.length,
      runtime,
      /* The EXCLUSION carries its reason on the row, so a narrowed population can be read back
         from the scan itself rather than taken on trust. */
      corpus: isCorpusConsumer(text) && `tools/${f}` !== SELF && !excluded,
      excluded
    });
  }
  return rows;
}

const ARGV_SPEC = { valued: ['--class'], boolean: ['--json', '--selftest'] };

function selftest() {
  const cases = [
    ['a run-time directory with no verdict', 'const dir = process.argv[2];\nreaddirSync(dir);', 'enumerates'],
    ['a parameter is run-time too', 'function walk(root) { return readdirSync(root); }', 'enumerates'],
    ['the repo tree is not a corpus', "const ROOT = join(HERE, '..');\nreaddirSync(join(ROOT, 'tools'));", 'repo-tree'],
    ['a wired consumer reports', 'const dir = process.argv[2];\nconst b = snapshotNights(dir);\nreaddirSync(dir);\npopulationVerdict(b, a);', 'reports'],
    ['no enumeration at all', "const p = '/srv/data/tepna-corpus';\nconsole.log(p);", 'no-enumeration'],
    ['a root named in a COMMENT does not enumerate', '// walks /srv/data/tepna-corpus nightly\nconst x = 1;', 'no-enumeration'],
    ['an unresolvable argument abstains, it does not clear', 'readdirSync(someGlobal);', 'undecidable'],
    /* THE FOUR RULES THIS UNIT ADDED, each with the shape that defeated the old one. */
    [
      'a flag whose DEFAULT is a repo path is still a flag read',
      "const argv = process.argv.slice(2);\nconst arg = (k, d) => {\n  const i = argv.indexOf(k);\n  return i >= 0 ? argv[i + 1] : d;\n};\nconst DIR = arg('--dir', join(ROOT, 'uploads', 'trio'));\nreaddirSync(DIR);",
      'enumerates'
    ],
    ['a variable NAMED ROOT is resolved, never assumed', 'const ROOT = positionalArgs(argv, SPEC).find(existsSync);\nreaddirSync(ROOT);', 'enumerates'],
    ['ONE abstention blocks a repo clearance for the whole file', "const ROOT = join(HERE, '..');\nreaddirSync(join(ROOT, 'tools'));\nreaddirSync(mystery);", 'undecidable'],
    ['the helper hop is followed through one binding', "const argv = process.argv.slice(2);\nconst flag = (k) => argv.indexOf(k);\nconst d = flag('--dir');\nreaddirSync(d);", 'enumerates'],
    [
      'a ternary is decided on its arms, hazard first',
      "const argv = process.argv.slice(2);\nconst arg = (k, d) => {\n  const i = argv.indexOf(k);\n  return i >= 0 ? argv[i + 1] : d;\n};\nconst DIR = arg('--dir', null);\nconst base = DIR.startsWith('/') ? DIR : join(ROOT, DIR);\nreaddirSync(base);",
      'enumerates'
    ],
    /* THE RUNG THIS UNIT ADDED, in the two spellings the corpus wears in a join. */
    ['a repo-rooted path under a corpus directory is not a clearance', "const ROOT = join(HERE, '..');\nreaddirSync(path.join(ROOT, 'uploads/trio'));", 'repo-corpus'],
    ['one segment per literal reads the same', "const ROOT = join(HERE, '..');\nreaddirSync(join(ROOT, 'uploads', 'trio'));", 'repo-corpus'],
    ['a run-time read still outranks the corpus rung', "const DIR = process.argv[2];\nreaddirSync(join(DIR, 'uploads'));", 'enumerates'],
    ['and so does an abstention', "readdirSync(join(ROOT, 'uploads/trio'));\nreaddirSync(mystery);", 'undecidable'],
    /* THE GAP PINNED HERE IS CLOSED, AND THIS LEG NOW ASSERTS THE RIGHT ANSWER. It read `repo-tree`
       until 2026-10-21: the callee is declared in a shared module, so the local-helper branch could
       not see it, and the dashed literal that gives the run away is blank on the masked text. The
       leg keeps the path it was moved to — a directory no corpus vocabulary matches — so a flag read
       is still the only thing it can be measuring. Row
       2026-10-21-an-imported-flag-helper-beside-a-repo-join-still-clears. */
    ['an imported flag helper beside a repo join is a run-time read', "const DIR = opt('--dir', join(ROOT, 'docs'));\nreaddirSync(DIR);", 'enumerates'],
    /* THE SECOND SPELLING, AND IT REACHES THE RUNG BY A DIFFERENT ROUTE. Here the call IS the
       enumeration argument, so the raw slice comes from the site; above it comes from the
       declaration in force. Both had to be measured, because the two routes carry the raw text
       through different code. */
    ['the same helper called inside the walk reads the same', "readdirSync(opt('--dir', join(ROOT, 'docs')));", 'enumerates'],
    /* THE NEGATIVE HALF, in the two shapes that would make the rung clear everything. A call with
       no dashed literal anywhere is not a flag read, and a dashed STRING is not a flag: a date
       literal wears the dash and reads the repo. */
    ['a helper with no dashed literal stays a repo walk', "const DIR = opt(cfg, join(ROOT, 'docs'));\nreaddirSync(DIR);", 'repo-tree'],
    ['a dash inside a date literal is not a flag', "const DIR = opt('2026-10-21', join(ROOT, 'docs'));\nreaddirSync(DIR);", 'repo-tree'],
    /* THE LADDER THIS UNIT FIXED: the name heuristic used to run BEFORE the parts recursion, so an
       expression whose CALLEE carries a dot never reached its own arguments. `path.resolve(ROOT,
       arg('--trio', 'uploads/trio'))` is the trio family's spelling — four tools write that exact
       line — and `REPO_DERIVED` matched the word `ROOT` and cleared it, although `arg` is the
       file's own argv helper and every run is free to pass `--trio`. The flag rung above cannot
       reach it: its call regex needs a bare `name(`, which `path.resolve(` is not. Measured
       2026-10-21, both engines over the 287 files in `tools/`: NINE tools move, two across classes.
       Row 2026-10-21-the-repo-name-heuristic-decides-before-the-parts-recursion. */
    [
      'a dotted callee is decided on its parts, not on a word in them',
      "const argv = process.argv.slice(2);\nconst arg = (k, d) => {\n  const i = argv.indexOf(k);\n  return i >= 0 ? argv[i + 1] : d;\n};\nconst TRIO = path.resolve(ROOT, arg('--trio', 'uploads/trio'));\nreaddirSync(TRIO);",
      'enumerates'
    ],
    /* THE SAME DEFECT ONE LEVEL DEEPER, and it is the other half of the nine. A PARAMETER inside
       the join is supplied by whoever calls, and `mutate-recover.mjs` exports `recoverStale(ROOT)`
       and walks `join(ROOT, '..')` — the parameter wearing the repo's own conventional name. The
       bare form (`readdirSync(param)`) already read run-time; only the wrapped form was cleared. */
    ['a parameter inside a join is supplied by the caller', "const ROOT = join(HERE, '..');\nfunction scan(sub) {\n  return readdirSync(join(ROOT, sub));\n}", 'enumerates'],
    /* THE NEGATIVE HALF, in the two shapes that would make the move clear or condemn everything. A
       dotted call whose parts decide nothing run-time stays a repo walk, and the heuristic still
       fires from its new position at the bottom of the ladder — `process.cwd()` has no parts to
       decide, and it is the whole reason the rule exists. */
    ['a dotted callee with no run-time part stays a repo walk', "const DIR = path.resolve(ROOT, 'docs');\nreaddirSync(DIR);", 'repo-tree'],
    ['the name heuristic still decides what nothing else can', 'readdirSync(process.cwd());', 'repo-tree'],
    /* THE GAP THIS LEG PINNED IS CLOSED, AND THE THREE SPELLINGS OF ONE HELPER NOW AGREE. The
       `function` pattern in `functionSpans` takes its name as OPTIONAL, so a declarator form
       produced a span with a null name and `localFunctions` dropped it — the name was lost there
       and not in the rung that reads the map. A fourth pattern registers the declarator, and these
       three legs are the same helper written as a declaration, an arrow and an expression: all
       three must read `enumerates`, because the flag-supplied path is what the call resolves to.
       Row 2026-10-21-a-helper-declared-as-a-function-expression-is-invisible-to-the-local-rung. */
    [
      'a helper declared as a function expression is seen as local',
      "const argv = process.argv.slice(2);\nconst arg = function (k, d) {\n  const i = argv.indexOf(k);\n  return i >= 0 ? argv[i + 1] : d;\n};\nconst TRIO = path.resolve(ROOT, arg('--trio', 'uploads/trio'));\nreaddirSync(TRIO);",
      'enumerates'
    ],
    [
      '…a NAMED function expression too, whose inner name binds as well',
      "const argv = process.argv.slice(2);\nconst arg = function pick(k, d) {\n  const i = argv.indexOf(k);\n  return i >= 0 ? argv[i + 1] : d;\n};\nconst TRIO = path.resolve(ROOT, arg('--trio', 'uploads/trio'));\nreaddirSync(TRIO);",
      'enumerates'
    ],
    [
      '…and an async one, where the keyword sits between the `=` and the `function`',
      "const argv = process.argv.slice(2);\nconst arg = async function (k, d) {\n  const i = argv.indexOf(k);\n  return i >= 0 ? argv[i + 1] : d;\n};\nconst TRIO = path.resolve(ROOT, arg('--trio', 'uploads/trio'));\nreaddirSync(TRIO);",
      'enumerates'
    ],
    /* THE GAP THAT WAS PINNED HERE IS CLOSED, AND THE LEG NOW ASSERTS THE RIGHT ANSWER. The corpus
       axis resolves the argument through the declaration in force and reads that initialiser's RAW
       text, so the path one line earlier is evidence. Measured 2026-10-21 over the 291 files in
       `tools/`, base engine against patched: SEVEN tools enter the corpus population and NOT ONE
       class changes — the earlier probe read zero because it tested the MASKED initialiser, where
       every path literal is blank. Row 2026-10-21-the-corpus-axis-reads-the-site-only. */
    ['a corpus path bound to a variable is a corpus read', "const ROOT = join(HERE, '..');\nconst dir = join(ROOT, 'uploads', 'trio');\nreaddirSync(dir);", 'repo-corpus'],
    /* THE NEGATIVE HALF, because a hop that answers `repo-corpus` for every binding would pass the
       leg above while destroying the distinction. A repo path bound the same way stays a clearance. */
    ['a repo path bound to a variable is still a repo walk', "const ROOT = join(HERE, '..');\nconst dir = join(ROOT, 'tools');\nreaddirSync(dir);", 'repo-tree'],
    /* AND THE SCOPE HALF: the binding in force at the call decides, not the first in the file. */
    [
      'the nearest preceding binding decides, not the first in the file',
      "const ROOT = join(HERE, '..');\nconst dir = join(ROOT, 'uploads', 'trio');\nfunction later() {\n  const dir = join(ROOT, 'tools');\n  return readdirSync(dir);\n}",
      'repo-tree'
    ]
  ];
  let bad = 0;
  for (const [name, src, want] of cases) {
    const got = classifyTool(src).cls;
    const ok = got === want;
    if (!ok) bad++;
    console.log(`  ${ok ? '✓' : '✗'} ${name} → ${got}${ok ? '' : ` (wanted ${want})`}`);
  }
  /* THE REGISTRY, ASSERTED DIRECTLY, because the classification legs above cannot discriminate
     here: an unknown callee already reads run-time-supplied, so `const a = helper(1)` reads
     `enumerates` on either side of this change and says nothing about what was registered. The
     risk the row named is exactly that — a declarator the file assigns a NON-function must stay
     out of the map, or the rung follows argv into a body that does not exist. */
  const reg = localFunctions(
    'const a = helper(1);\nconst b = function (x) {\n  return x;\n};\nconst c = function inner(x) {\n  return x;\n};\nconst d = async function (x) {\n  return x;\n};\nconst e = (x) => x;\nfunction f(x) {\n  return x;\n}\n'
  );
  const wanted = ['b', 'c', 'd', 'e', 'f'];
  const regOk = wanted.every((n) => reg.has(n)) && !reg.has('a') && reg.has('inner');
  if (!regOk) bad++;
  console.log(`  ${regOk ? '✓' : '✗'} the local registry holds every function form and no plain call (${wanted.filter((n) => reg.has(n)).join(' ')}${reg.has('a') ? ' + a' : ''})`);

  /* THE CONTROL THE NAIVE PREDICATE FAILS. It names no corpus root and it is the one wired
     consumer, so a scan that does not read it as `reports` is measuring the wrong thing. */
  const ctl = classifyTool(readFileSync(join(HERE, 'tch-firmware-reference.mjs'), 'utf8'));
  const ctlOk = ctl.cls === 'reports';
  if (!ctlOk) bad++;
  console.log(`  ${ctlOk ? '✓' : '✗'} CONTROL tools/tch-firmware-reference.mjs → ${ctl.cls} (names no corpus root)`);
  const every = TOOL_CLASSES.every((c) => typeof c === 'string');
  if (!every) bad++;
  console.log(`  ${every ? '✓' : '✗'} the class vocabulary is ${TOOL_CLASSES.length} closed names`);
  /* THE TWO NARROWING SETS CARRY A REASON EACH, or the narrowing is unauditable. */
  const reasoned = [POPULATION_EXCLUSIONS, UNDECIDED_CORPUS].every((set) => Object.values(set).every((r) => typeof r === 'string' && r.length > 20));
  if (!reasoned) bad++;
  console.log(`  ${reasoned ? '✓' : '✗'} every exclusion (${Object.keys(POPULATION_EXCLUSIONS).length}) and abstention (${Object.keys(UNDECIDED_CORPUS).length}) names a reason`);
  /* AND THE ABSTENTION SET IS MEASURED, not declared: a sixth abstaining corpus consumer reds
     here, and a listed one the tracer has learned to decide reds too. */
  const scanned = scanDir(HERE).filter((r) => r.corpus && r.cls === 'undecidable');
  const listed = Object.keys(UNDECIDED_CORPUS).sort().join(' ');
  const measured = scanned
    .map((r) => r.tool.replace('tools/', ''))
    .sort()
    .join(' ');
  const same = listed === measured;
  if (!same) bad++;
  console.log(`  ${same ? '✓' : '✗'} the abstaining corpus consumers are the ${scanned.length} named${same ? '' : ` (measured: ${measured})`}`);
  /* THE CORPUS RULE, TESTED BOTH WAYS AND INDEPENDENTLY OF ANY TOOL'S STATE. The leg above goes
     quiet the day `rho-overlap-power.mjs` is wired; this one asks whether the instrument can still
     tell the two apart, which is the question a repair must not erase. The third case is the one a
     text rule gets wrong: an identifier is not a path. */
  const shapes = corpusShapedPath("join(ROOT, 'uploads/trio')") && !corpusShapedPath("join(ROOT, 'tools')") && !corpusShapedPath('uploadsDir') && corpusShapedPath('"captures/box"');
  if (!shapes) bad++;
  console.log(`  ${shapes ? '✓' : '✗'} the corpus-segment rule separates uploads/ and captures/ from tools/ and from an identifier`);
  /* THE SPANS PARTITION THE LIST, which is what lets one pair of offsets index both texts. Stated
     as a reconstruction rather than a second splitter: a reference implementation beside the real
     one is two things to keep in step. */
  const sample = "a, join(b, 'c, d'), { e: 1 }";
  const parts = splitTopRanges(sample).map(([x, y]) => sample.slice(x, y));
  const partition = parts.join(',') === sample && parts.length === 3;
  if (!partition) bad++;
  console.log(`  ${partition ? '✓' : '✗'} the argument spans partition the list exactly (${parts.length} span(s), reconstructed)`);
  /* The count is the point: `tools/selftest-all.mjs` reads PASS either way, and a suite quietly
     shrinking from nine legs to three is visible only in this number. */
  const total = cases.length + 6;
  console.log(bad === 0 ? `all ${total} selftests passed` : `corpus-reads selftest: FAIL (${bad} of ${total})`);
  return bad === 0 ? 0 : 1;
}

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, ARGV_SPEC, { tool: 'tools/corpus-reads.mjs' });
  if (argv.includes('--selftest')) process.exit(selftest());
  const only = argv.includes('--class') ? argv[argv.indexOf('--class') + 1] : null;
  const rows = scanDir(HERE).filter((r) => (only ? r.cls === only : true));
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ rows }, null, 2));
  } else {
    const by = {};
    for (const r of scanDir(HERE)) by[r.cls] = (by[r.cls] || 0) + 1;
    for (const r of rows) console.log(`${r.cls.padEnd(15)} ${r.tool}${r.why ? `  — ${r.why}` : ''}`);
    console.log(`\n${TOOL_CLASSES.map((c) => `${c} ${by[c] || 0}`).join(' · ')}`);
  }
}
