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

/** The five classes, closed. A sixth would be a silent re-definition of the hazard set. */
export const TOOL_CLASSES = ['reports', 'enumerates', 'repo-tree', 'undecidable', 'no-enumeration'];

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

/** The NAMES of the population rules, in the order `CAPTURE_VOCAB` declares them. */
export const VOCAB_NAMES = ['night-regex', 'capture-suffix', 'corpus-root', 'night-primitive', 'usage-line'];

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
  return hits;
}

/** Is this file a CORPUS consumer at all? The gate's population rule. PURE. */
export function isCorpusConsumer(text) {
  /* READ OVER THE RAW TEXT, NOT THE MASKED CODE. A capture suffix almost always sits inside a
     string literal (`'_ECG.txt'`), and masking blanks every string — reading the mask here cut the
     population from 50-odd tools to 16 and quietly dropped most real corpus consumers. A usage
     line that says `--dir <captures root>` is evidence too. The population rule is deliberately
     generous; the precision lives in the origin axis below, which decides what the tool ENUMERATES. */
  return CAPTURE_VOCAB.some((re) => re.test(String(text)));
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
    if (!out.has(m[1])) out.set(m[1], []);
    out.get(m[1]).push({ at: m.index, expr });
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
      if (pick) return originOf(pick.expr, decls, params, seen, { ...ctx, at: pick.at });
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
  /* A TERNARY HAS TWO ARMS AND A RUN IS FREE TO TAKE EITHER. `nsrr-stage-validate.mjs` guards an
     absolute path with `DIR.startsWith('/') ? DIR : join(ROOT, DIR)`, where `DIR` is `arg('--dir',
     null)`: the repo arm is the fallback, the flag arm is the path a run supplies. Decide on the
     arms, hazard first — the same ladder, applied to a shape that spells both origins at once. */
  const arms = splitTopTernary(e);
  if (arms.length > 1) {
    const got = arms.map((a) => originOf(a, decls, params, new Set(seen), ctx).origin);
    if (got.includes('runtime')) return { origin: 'runtime', why: null };
    if (got.includes('undecidable')) {
      return { origin: 'undecidable', why: `one arm of \`${e.slice(0, 40)}\` traces to no declaration` };
    }
    if (got.includes('repo')) return { origin: 'repo', why: null };
  }
  /* AND ONLY NOW the name heuristic. `arg('--dir', join(ROOT, 'uploads', 'trio'))` names `ROOT`
     and reads the command line; the repo rule is the last thing tried, not the first, so every
     resolution path gets its turn before a convention decides. */
  if (REPO_DERIVED.test(e)) return { origin: 'repo', why: null };
  /* A call or a join of several parts: decide on the parts. */
  const inner = e.replace(/^[A-Za-z_$][\w$]*\s*\(/, '').replace(/\)\s*$/, '');
  if (inner !== e) {
    const parts = inner
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const seenOrigins = parts.map((p) => originOf(p, decls, params, new Set(seen), ctx).origin);
    if (seenOrigins.includes('runtime')) return { origin: 'runtime', why: null };
    if (seenOrigins.includes('repo')) return { origin: 'repo', why: null };
  }
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
  const ctx = { at: 0, sites: declarationSites(masked), spans: functionSpans(masked), fns: localFunctions(masked) };
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
    const first = splitTop(args)[0] || '';
    const call = m[0].replace(/\s*\($/, '').replace(/\($/, '');
    const arg = /find/.test(call) ? splitTop(args)[1] || '' : first;
    sites.push({ call: call.trim(), arg: arg.trim(), ...originOf(arg, decls, params, new Set(), { ...ctx, at: open }) });
  }
  return sites;
}

/** Split an argument list on top-level commas. PURE. */
export function splitTop(args) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of String(args)) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
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
  return { cls: 'repo-tree', why: null, sites };
}

/* THE SCANNER IS NOT ITS OWN SUBJECT. This file carries every corpus root and capture suffix the
   population rule looks for, and it enumerates `tools/` off a parameter, so it classifies itself as
   a corpus consumer that enumerates a run-time path. That is the §4 self-match: a scan whose own
   text is its pattern reports about itself. Named here rather than filtered silently. */
export const SELF = 'tools/corpus-reads.mjs';

/* ── THE POPULATION RULE'S OTHER DIRECTION ─────────────────────────────────────────────────────
   `isCorpusConsumer` is deliberately generous and reads capture vocabulary out of the RAW text,
   so it admits four tools that enumerate no capture at all. Each is named here with the text that
   admitted it, because a generous rule plus a silent filter is a population nobody can audit:

     argv-survey.mjs        `DEX_UPLOADS`, inside `delete env.DEX_UPLOADS;` — the mention is the
                            SCRUB that keeps a probe away from the corpus. Presence is
                            ANTI-evidence here, and no rule keyed on presence can tell.
     build-docs.mjs         the night regex `\d{4}-\d{2}-\d{2}`, which validates a release date
                            in the docs builder. It enumerates `docs/`.
     nsrr-effort-typing.mjs `.edf`, under `/srv/data/shhs/` — the public NSRR mount, a different
     nsrr-score-pool.mjs    filesystem from the capture corpus, which the daily re-tier never
                            touches (`corpus-tier.mjs` is scoped to `/srv/data/tepna-corpus/`).

   A row excluded here keeps its CLASS — the scan still reports what it enumerates — and only
   leaves the corpus population, so nothing is hidden. */
export const POPULATION_EXCLUSIONS = {
  'argv-survey.mjs': 'names DEX_UPLOADS only to delete it from a probe environment',
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
   DEBT, NOT APPROVAL. Each value is the number of run-time enumerations the scan found in that
   tool. A ratchet on the COUNT would pass a new consumer arriving as another one left, so the
   suite group pins the NAMES and reds in both directions: an unlisted enumerator, and a listed
   tool the scan has stopped reading as one.

   It lives here rather than in the suite because `verdict-adoption.mjs` reads a tool stem named
   under `tests/` as evidence that a test covers it. A hazard list is not that, and the mention
   alone reded its ratchet. */
export const UNWIRED_BACKLOG = {
  'acc-acc-control.mjs': 1,
  'acc-select-compare.mjs': 2,
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
  'eqc-run.mjs': 3,
  'geometry-scan.mjs': 1,
  'h10-session-rate.mjs': 1,
  'hostaxis-estimator-bakeoff.mjs': 1,
  'nsrr-criterion-sweep.mjs': 1,
  'nsrr-oxydex-odi.mjs': 2,
  'nsrr-stage-validate.mjs': 1,
  'o2ring-finger-validate-batch.mjs': 1,
  'oracle-ecg-firmware-rr.mjs': 4,
  'oracle-ppg-device-beats.mjs': 2,
  'oxy-hr-bias.mjs': 2,
  'pat-connection-stability.mjs': 2,
  'pat-dip-validate.mjs': 1,
  'pat-drift-attribution.mjs': 2,
  'pat-ecg-axis-residual.mjs': 1,
  'pat-fiducial-compare.mjs': 1,
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
  'resp-cardiac-suppression-e8.mjs': 1,
  'seqnet-eval.mjs': 1,
  'stage-lab.mjs': 12,
  'stitch-31d-run.mjs': 3,
  'stuck-run-lengths.mjs': 1,
  'tch-bootstrap-ci.mjs': 1,
  'tch-degeneracy-d7.mjs': 1,
  'tch-fused-corpus.mjs': 1,
  'tch-multinight.mjs': 2,
  'tch-pooled-hat.mjs': 1,
  'tch-reference-validation.mjs': 2,
  'tch-window-sensitivity.mjs': 1,
  'trio-batch.mjs': 6,
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
    /* KNOWN GAP, PINNED SO IT CANNOT BE FORGOTTEN: the same flag idiom with an IMPORTED helper
       still clears, because the mask blanks the dashed literal that would give it away. Six corpus
       rows read `repo-tree` for this reason; the row that records it is dated 2026-10-21. */
    ['KNOWN GAP: an imported flag helper beside a repo join still clears', "const DIR = opt('--dir', join(ROOT, 'uploads', 'trio'));\nreaddirSync(DIR);", 'repo-tree']
  ];
  let bad = 0;
  for (const [name, src, want] of cases) {
    const got = classifyTool(src).cls;
    const ok = got === want;
    if (!ok) bad++;
    console.log(`  ${ok ? '✓' : '✗'} ${name} → ${got}${ok ? '' : ` (wanted ${want})`}`);
  }
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
  /* The count is the point: `tools/selftest-all.mjs` reads PASS either way, and a suite quietly
     shrinking from nine legs to three is visible only in this number. */
  const total = cases.length + 4;
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
