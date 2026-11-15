#!/usr/bin/env node
/* Tepna — Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ════════════════════════════════════════════════════════════════════════
 * write-targets.mjs — WHERE EACH PENDING WRITER ACTUALLY BUILDS ITS PATH.
 *
 * WHY. `briefs/WRITE-ROOT-ADOPTION-2026-11-03-BRIEF.md` §3 refuses a blanket conversion: "each of the
 * remaining 55 writers needs one reading, not a blanket conversion". The three questions it asks are
 * all about the PATH — does the write land on a tracked work-unit artifact, on a scratch path outside
 * the repo, or on a generated tree a gate re-checks. `tools/write-root-adoption.mjs` names the
 * candidates and decides nothing about their paths, so every one of the 49 pending readings started
 * from a cold read of the file.
 *
 * WHAT A CLASS HERE IS, AND WHAT IT IS NOT. `own-root` means the path argument is built from a
 * constant this tool resolved out of `import.meta.url`. That is the defect shape of row
 * `2026-11-02-a-tool-run-by-absolute-path-writes-into-its-own-checkout`, stated without running
 * anything. It is NOT a verdict that the tool is wrong: a tool whose only own-root write lands on its
 * own test data is exempt, and the brief wants that said in the tool's header. The other classes are
 * the honest shapes — `caller-cwd` and `caller-argv` take the path from the RUN, and `outside-repo`
 * leaves every checkout alone.
 *
 * THE CONTROL IS HAND-AUTHORED PROSE, NOT A RUN. Each `adopted` row in
 * `tools/write-root-adoption.json` carries a `reading` written by a session that read the file by
 * hand, and most name the artifact in backticks. This scan must agree with every one of them: an
 * adopted tool must hold at least one `own-root` site, and a path this scan resolves must appear in
 * that row's prose. A static class that contradicts the reading is a defect in the class. The limit is
 * plain: the control is a human reading rather than an executable probe, so it catches a scan that
 * reads the wrong path and cannot catch two readers making one mistake.
 *
 * ABSTENTION IS NOT AGREEMENT. `undecidable` carries a named reason and is counted apart. A site
 * whose path is a bare identifier gets ONE hop through its own declaration and then abstains. Read
 * the undecidable column first.
 *
 * WHAT IT EXAMINES NOTHING ABOUT. The population is the write arm's own grep, so the two call names
 * are `writeFileSync` and `appendFileSync`. Every other mutator — a stream, a copy, a rename, an
 * unlink — is counted per tool as `otherMutators` and CLASSIFIED NOWHERE. A tool whose only write
 * goes through `createWriteStream` reads here as `no-site`, which is absence of a measurement rather
 * than absence of a write.
 *
 *   node tools/write-targets.mjs                  # the table and the counts
 *   node tools/write-targets.mjs --json           # the tepna.verdict/1 object + every row
 *   node tools/write-targets.mjs --control        # the cross-check against the adopted readings only
 *   node tools/write-targets.mjs --only foo.mjs   # one tool, with every site it holds
 *   node tools/write-targets.mjs --selftest       # planted truth: one plant per class
 *   node tools/write-targets.mjs --verdict-sample # a sample object, scans nothing
 * ════════════════════════════════════════════════════════════════════════ */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeRe } from './regex-escape-core.mjs';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { bareSource } from './verdict-adoption.mjs';
import { makeVerdict } from './verdict-emit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
export const MANIFEST = 'tools/write-root-adoption.json';
export const GATE = 'write-targets';
export const SELF = 'tools/write-targets.mjs';
export const CALLS = ['writeFileSync', 'appendFileSync'];
export const OTHER_MUTATORS = ['createWriteStream', 'cpSync', 'copyFileSync', 'renameSync', 'unlinkSync', 'rmSync', 'mkdirSync'];
export const SITE_CLASSES = ['own-root', 'own-root-default', 'guarded', 'caller-cwd', 'caller-argv', 'outside-repo', 'undecidable'];
/* A tool is named by the most consequential site it holds, and an abstention outranks a proof of
   safety — the same precedence `tools/argv-reads.mjs` uses. `no-site` is the absence of a measurement
   over the two call names, never a claim that the tool writes nothing. */
export const TOOL_CLASSES = ['own-root', 'own-root-default', 'undecidable', 'caller-argv', 'caller-cwd', 'guarded', 'outside-repo', 'no-site'];
/* The order a HOP picks the strongest answer by. `undecidable` is absent: a hop that decided nothing
   returns no answer at all. */
export const ORDER = ['own-root', 'own-root-default', 'guarded', 'outside-repo', 'caller-cwd', 'caller-argv'];
export const CRITERION = {
  name: 'census_classes_contradicting_the_adopted_reading',
  threshold: 0,
  unit: 'tools',
  direction: 'lte'
};
/* The names a resolvable path expression may hold besides a root and its literals. Anything else
   makes the path a runtime value, so the literal stays null. */
const PATH_HELPERS = new Set(['join', 'resolve', 'path', 'normalize', 'posix', 'sep', 'writeRoot', 'writeRootOrDie', 'judgeRoot', 'judgeRootOrDie', 'import', 'meta', 'url']);
/* A CALL, never a mention — the same predicate `tools/write-root-adoption.mjs` adopts a tool by. */
export const WRAPPERS_RE = /\b(?:writeRoot|writeRootOrDie|judgeRoot|judgeRootOrDie)\s*\(/;
/* A value READ THROUGH a root path is not a path. This set is what separates `const lines =
   readFileSync(join(ROOT, f), 'utf8')` from `const OUT = opt('--out', join(ROOT, '.cache', 'x'))`. */
const READ_CALLEE = /\b(?:readFileSync|readdirSync|readlinkSync|statSync|lstatSync|existsSync|JSON\.parse|require)\s*\(/;
/* TWO temp shapes, and ONE marker read them as one until 2026-11-15. `tools/killcheck.mjs:434` builds
   its sandbox as `mkdtempSync(join(dirname(ROOT), '.killcheck-'))` — a sibling of the CHECKOUT, not a
   path under `/tmp` — and the single marker answered "under a temporary or home directory" about it.
   The class is right either way, because no checkout holds the directory, and the REASON was false. */
const TMP_BASE = /\btmpdir\s*\(|\bos\.tmpdir|['"`]\/tmp\/|\bTMPDIR\b|\bhomedir\s*\(/;
const TMP_MK = /\bmkdtemp/;

/* ── the scanner ─────────────────────────────────────────────────────────────────────────────────── */

/** Every top-level argument of the call whose `(` sits at `openIdx`. `null` when unbalanced. PURE. */
export function splitTopArgs(src, openIdx) {
  let depth = 0;
  let start = openIdx + 1;
  let q = null;
  const out = [];
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '\\') i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      q = c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        out.push(src.slice(start, i));
        return out;
      }
    } else if (c === ',' && depth === 1) {
      out.push(src.slice(start, i));
      start = i + 1;
    }
  }
  return null;
}

/**
 * The statement body after `=`, up to the first `;` or newline at depth 0.
 *
 * A newline terminates only AFTER the initializer has begun. Biome wraps a long declaration right
 * after the `=`, and a reader that stopped at the first newline read such a declaration as EMPTY. It
 * then abstained with the wrong reason — "no declaration decides it" about a declaration it had
 * truncated to nothing. `tools/*.mjs` holds 85 declarations of that shape across 64 files (measured
 * 2026-11-15). This correction moved NO class and NO count in the census, so it fixes a reason rather
 * than an answer, and the dominant abstention had the other cause `rootDefaulted` below names. PURE.
 */
function initializerAt(src, eqIdx) {
  let depth = 0;
  let q = null;
  let begun = false;
  for (let i = eqIdx + 1; i < src.length; i++) {
    const c = src[i];
    if (!begun) {
      if (/\s/.test(c)) continue;
      begun = true;
    }
    if (q) {
      if (c === '\\') i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      q = c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && (c === ';' || c === '\n')) return src.slice(eqIdx + 1, i);
  }
  return src.slice(eqIdx + 1);
}

/**
 * Every `const|let|var NAME = <init>` in blanked source, as name → EVERY initializer it has.
 *
 * One name is declared twice in a file more often than a scan expects — `tools/unit-health.mjs`
 * declares `p` as a `Set` in one function and as the state path in another. Keeping only the first
 * made the scan answer about the wrong one, so the reader keeps them all and abstains by name when
 * they disagree. PURE.
 */
export function declarations(bare) {
  const out = new Map();
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
  let m;
  while ((m = re.exec(bare))) {
    const init = initializerAt(bare, m.index + m[0].length - 1);
    if (!out.has(m[1])) out.set(m[1], []);
    out.get(m[1]).push(init);
  }
  return out;
}

const word = (name) => new RegExp(`\\b${escapeRe(name)}\\b`);

/**
 * Does this declaration make `r` into a PATH, rather than merely read through one?
 *
 * The loose test — "the init names the root" — pulled every value read out of a root file into the
 * root set, so `const lines = readFileSync(join(ROOT, f)).split('\n')` made `lines` a root. A path
 * expression has four shapes here and nothing else inherits. PURE.
 */
export function pathDerived(init, r) {
  const n = escapeRe(r);
  /* The shapes are ANCHORED at the head of the initializer, after an optional arrow head. A loose
     search matched `readFileSync(join(ROOT, f), 'utf8').split()`, so every line of every root file
     became a root. */
  const body = init.replace(/^\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*/, '').trimStart();
  return (
    new RegExp(`^(?:path\\.)?(?:join|resolve)\\s*\\(\\s*(?:\\.\\.\\.[\\w$]+\\s*,\\s*)?${n}\\b`).test(body) ||
    new RegExp(`^${n}\\s*$`).test(body) ||
    new RegExp(`^\`[^\`]*\\$\\{\\s*${n}\\s*\\}`).test(body) ||
    new RegExp(`^${n}\\s*\\+`).test(body)
  );
}

/**
 * Is this initializer a wrapper CALL, rather than a string that names one? The two adopted shapes are
 * `writeRootOrDie(import.meta.url)` alone and `join(writeRootOrDie(...), 'X')`. PURE.
 */
export function isWrapperCall(init) {
  const body = init
    .replace(/^\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*/, '')
    .replace(/^\s*await\s+/, '')
    .trimStart();
  return /^(?:writeRoot|writeRootOrDie|judgeRoot|judgeRootOrDie)\s*\(/.test(body) || /^(?:path\.)?(?:join|resolve)\s*\(\s*(?:writeRoot|writeRootOrDie|judgeRoot|judgeRootOrDie)\s*\(/.test(body);
}

/**
 * Does this declaration DEFAULT to a root-relative path that a caller may override?
 *
 * The commonest real idiom in `tools/` is neither of the clean shapes: `const OUT = opt('--out',
 * join(ROOT, '.cache', 'x.json'))` and `const journalPath = JOURNAL || join(ROOT, '.mutate-journal',
 * f)` both put the tool's OWN checkout one absent flag away. The path shape is there but not at the
 * head, so `pathDerived` refused it and the anchored hop abstained on the 70 sites the first census
 * run reported undecided. A read through a root
 * path is excluded, which is what keeps a line of text out of the path set. PURE.
 */
export function rootDefaulted(init, r) {
  if (READ_CALLEE.test(init)) return false;
  const n = escapeRe(r);
  return new RegExp(`(?:path\\.)?(?:join|resolve)\\s*\\(\\s*(?:\\.\\.\\.[\\w$]+\\s*,\\s*)?${n}\\b|\\$\\{\\s*${n}\\s*\\}`).test(init);
}

/**
 * Every identifier whose value this tool resolved out of its OWN location, to a fixpoint.
 *
 * The seed is any declaration naming `import.meta.url`. A declaration that builds a PATH from a seed
 * inherits it, which is what carries `const SELF_ROOT = …import.meta.url` into `let ROOT = SELF_ROOT`
 * and then into `const p = (...a) => join(ROOT, ...a)`. PURE.
 */
export function rootNames(bare) {
  const decls = declarations(bare);
  const roots = new Set();
  for (const [name, inits] of decls) if (inits.some((i) => /import\.meta\.url/.test(i) && !WRAPPERS_RE.test(i))) roots.add(name);
  for (let pass = 0; pass < 10; pass++) {
    let grew = false;
    for (const [name, inits] of decls) {
      if (roots.has(name)) continue;
      for (const r of roots)
        if (inits.some((i) => pathDerived(i, r))) {
          roots.add(name);
          grew = true;
          break;
        }
    }
    if (!grew) break;
  }
  return roots;
}

/**
 * Which of those roots a wrapper REASSIGNS, so every later write through them lands in the caller's
 * checkout. `tools/release.mjs` adopts that way: `ROOT = writeRootOrDie(import.meta.url)` runs in the
 * dispatch and `p()` closes over it.
 *
 * THE LIMIT IS THE BRANCH. This reader is file-scoped, so a root reassigned on ONE branch reads as
 * guarded at every site in the file. The branch that does not reassign is invisible here, and the
 * tool's own header is what states it. PURE.
 */
export function guardedRoots(bare, roots) {
  const decls = declarations(bare);
  const out = new Set();
  for (const r of roots) if (new RegExp(`\\b${escapeRe(r)}\\s*=\\s*(?:await\\s+)?(?:writeRoot|writeRootOrDie|judgeRoot|judgeRootOrDie)\\s*\\(`).test(bare)) out.add(r);
  /* A DECLARATION THAT *IS* A WRAPPER CALL is the commonest adopted shape: `const ROOT =
     writeRootOrDie(import.meta.url)` inside `main`. It never entered the root set, because its
     value comes from the CALLER's tree, so it has to enter the guarded set here.
     ANCHORED, for the reason `pathDerived` is anchored. A declaration that merely MENTIONS the
     wrapper is a string, and an unanchored test put `STATUS_MARK`, `CODE`, `SCHEMA_LITERAL`,
     `VM_EVAL` and the single letter `m` into this set off the gates' own pattern constants
     (measured 2026-11-15 over the 7 adopted tools). None of those decided a site here, and a
     one-letter name in this set would have decided the next one wrongly. */
  for (const [name, inits] of decls) if (inits.some(isWrapperCall)) out.add(name);
  /* A HELPER OVER A GUARDED ROOT IS GUARDED TOO. `tools/release.mjs` writes through `p()`, which
     closes over the `let ROOT` the dispatch reassigns, so the guard has to travel the same chain the
     root travelled. */
  for (let pass = 0; pass < 10; pass++) {
    let grew = false;
    for (const [name, inits] of decls) {
      if (out.has(name)) continue;
      for (const g of out)
        if (inits.some((i) => pathDerived(i, g))) {
          out.add(name);
          grew = true;
          break;
        }
    }
    if (!grew) break;
  }
  return out;
}

/**
 * Which identifiers DEFAULT to this tool's own checkout, to a fixpoint. A name already in `roots` or
 * in `guarded` is not here: this set is the milder shape, where an absent flag decides the tree. PURE.
 */
export function defaultedRoots(bare, roots, guarded) {
  const decls = declarations(bare);
  const out = new Set();
  for (const [name, inits] of decls) {
    if (roots.has(name) || guarded.has(name)) continue;
    for (const r of roots) if (inits.some((i) => rootDefaulted(i, r))) out.add(name);
  }
  for (let pass = 0; pass < 10; pass++) {
    let grew = false;
    for (const [name, inits] of decls) {
      if (out.has(name) || roots.has(name) || guarded.has(name)) continue;
      for (const d of out)
        if (inits.some((i) => pathDerived(i, d) || rootDefaulted(i, d))) {
          out.add(name);
          grew = true;
          break;
        }
    }
    if (!grew) break;
  }
  return out;
}

/**
 * Names this file calls to write, beyond the two in `CALLS`.
 *
 * THE REPO INJECTS ITS WRITER FOR TESTABILITY: `function writeMap(compact, { root = ROOT, writeFn =
 * writeFileSync } = {})` then calls `writeFn(...)`. A call-NAME scan reads the default in the
 * parameter list and examines nothing about the call, so `tools/repo-map.mjs` presented as a tool
 * whose only write is a selftest fixture — and it writes the shared map into the git common dir.
 * The idiom holds 3 parameters over 2 files (`repo-map`, `verify-drafts`; measured 2026-11-15). PURE.
 */
export function injectedWriters(bare) {
  const out = new Set();
  for (const m of bare.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*(?:writeFileSync|appendFileSync)\b/g)) out.add(m[1]);
  return out;
}

/** Every `writeFileSync`/`appendFileSync` site in blanked source, with its first argument. PURE. */
export function writeSites(bare) {
  const out = [];
  /* THE MEMBER FORM IS THE SAME CALL FOR `CALLS` AND A DIFFERENT CALL FOR AN INJECTED NAME.
     `fs.writeFileSync(` is how `tools/new-changeset.mjs` and `tools/verdict-adoption.mjs` write, and
     a lookbehind over both sets took every site off those two rows — the adopted-reading control
     caught it, no test did (measured 2026-11-15). `stream.write(` is NOT the injected `write`. */
  const injected = injectedWriters(bare);
  for (const call of [...CALLS, ...injected]) {
    const re = new RegExp(`${injected.has(call) ? '(?<![.\\w$])' : '\\b'}${escapeRe(call)}\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(bare))) {
      const open = m.index + m[0].length - 1;
      const args = splitTopArgs(bare, open);
      out.push({
        call,
        line: bare.slice(0, m.index).split('\n').length,
        arg: args === null ? null : (args[0] || '').trim()
      });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

/** An expression split into its string literals and the code around them. PURE. */
export function strings(expr) {
  const lits = [];
  let rest = '';
  let q = null;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (q) {
      if (c === '\\') i++;
      else if (c === q) {
        lits.push(expr.slice(start, i));
        q = null;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      q = c;
      start = i + 1;
      continue;
    }
    rest += c;
  }
  return q === null ? { lits, rest } : null;
}

/** The literal relative path an expression resolves to, or `null` when a runtime value reaches it. PURE. */
export function pathLiteral(expr, roots) {
  const sp = strings(expr);
  if (sp === null) return null;
  if (/\$\{/.test(sp.lits.join(''))) return null;
  for (const id of sp.rest.match(/[A-Za-z_$][\w$]*/g) || []) if (!roots.has(id) && !PATH_HELPERS.has(id)) return null;
  const parts = sp.lits
    .join('/')
    .split('/')
    .filter((s) => s && s !== '.');
  return parts.length ? parts.join('/') : null;
}

/**
 * The classes an expression states OUTRIGHT, most consequential first.
 *
 * `guarded` runs first because it is a statement about THIS path: a wrapper decided the checkout, so
 * the root constant beside it decides nothing. A root then wins over a temporary directory, because a
 * path joined under the tool's own checkout is inside it whatever the segment is called. `null` means
 * the expression states none of them, which is the only route to a hop. PURE.
 */
export function direct(expr, roots, guarded = new Set(), anchored = false, defaulted = new Set()) {
  /* ANCHORED is what a HOP reads with. At a write site the root may sit anywhere in the path
     expression, but a declaration reached by a hop must be path-SHAPED, or `const lines =
     readFileSync(join(ROOT, f), 'utf8').split()` hands the scan a line of text as a path. */
  const holds = (n) => (anchored ? pathDerived(expr, n) : word(n).test(expr));
  if (WRAPPERS_RE.test(expr)) return { cls: 'guarded', why: 'a write-root wrapper resolves the checkout at this site', literal: pathLiteral(expr, roots) };
  for (const g of guarded) if (holds(g)) return { cls: 'guarded', why: `the path is built from \`${g}\`, which a wrapper decides in this file`, literal: pathLiteral(expr, roots) };
  for (const r of roots) if (holds(r)) return { cls: 'own-root', why: `the path is built from \`${r}\`, which this tool resolved from its own location`, literal: pathLiteral(expr, roots) };
  for (const d of defaulted) if (word(d).test(expr)) return { cls: 'own-root-default', why: `the path is built from \`${d}\`, which DEFAULTS to this tool's own checkout and a caller may override` };
  for (const r of roots) if (rootDefaulted(expr, r)) return { cls: 'own-root-default', why: `the path defaults to a value under \`${r}\`, this tool's own checkout, and a caller may override it` };
  if (TMP_BASE.test(expr)) return { cls: 'outside-repo', why: 'the path is built under a temporary or home directory' };
  if (TMP_MK.test(expr)) {
    const near = [...roots].find((n) => word(n).test(expr));
    return {
      cls: 'outside-repo',
      why: near ? `the path is a temporary directory this tool creates beside \`${near}\`, so no checkout holds it` : 'the path is a temporary directory this tool creates, so no checkout holds it'
    };
  }
  if (/process\.cwd\s*\(/.test(expr)) return { cls: 'caller-cwd', why: 'the path is built from the run’s own working directory' };
  if (/process\.argv|\bargv\b/.test(expr)) return { cls: 'caller-argv', why: 'the path comes from the command line' };
  return null;
}

/** Every function this file declares, as name → parameter names. PURE. */
export function functions(bare) {
  const out = new Map();
  const params = (raw) =>
    raw
      .split(',')
      .map((t) => t.trim().split('=')[0].trim())
      .filter((t) => /^[A-Za-z_$][\w$]*$/.test(t));
  for (const re of [/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g, /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\s*)?\(([^)]*)\)\s*(?:=>|\{)/g]) {
    let m;
    while ((m = re.exec(bare))) if (!out.has(m[1])) out.set(m[1], params(m[2]));
  }
  const re3 = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/g;
  let m3;
  while ((m3 = re3.exec(bare))) if (!out.has(m3[1])) out.set(m3[1], [m3[2]]);
  return out;
}

/** Which declared functions take `id` as a parameter. PURE. */
export function paramOwners(fns, id) {
  return [...fns].filter(([, ps]) => ps.includes(id)).map(([n]) => n);
}

/** The first argument of every call to `name` that is not its own declaration. PURE. */
export function callArgs(bare, name) {
  const out = [];
  const re = new RegExp(`\\b${escapeRe(name)}\\s*\\(`, 'g');
  let m;
  while ((m = re.exec(bare))) {
    const before = bare.slice(Math.max(0, m.index - 30), m.index);
    if (/\b(?:function|const|let|var)\s+$/.test(before)) continue;
    const args = splitTopArgs(bare, m.index + m[0].length - 1);
    if (args && args[0] !== undefined) out.push(args[0].trim());
  }
  return out;
}

/**
 * One site's class. Every fall-through is a NAMED abstention.
 *
 * An expression that states nothing itself gets ONE hop: each identifier in it is looked up in this
 * file's own declarations and read once. The dominant idiom declares the output path above the write,
 * and a second hop is where a scan starts guessing. PURE.
 */
export function classifySite(arg, ctx) {
  const { roots, decls, guarded, defaulted, fns, bare } = ctx;
  if (arg == null) return { cls: 'undecidable', why: 'the call parentheses do not balance in blanked source' };
  if (!arg) return { cls: 'undecidable', why: 'the call has no first argument' };
  const d = direct(arg, roots, guarded, false, defaulted);
  if (d) return d;
  const sp = strings(arg);
  const ids = [...new Set((sp?.rest.match(/[A-Za-z_$][\w$]*/g) || []).filter((id) => !PATH_HELPERS.has(id)))];
  const hops = [];
  const shadowed = [];
  for (const id of ids) {
    if (!decls.has(id)) continue;
    const inits = decls.get(id);
    const read = inits.map((i) => direct(i.trim(), roots, guarded, true, defaulted)).filter(Boolean);
    const kinds = [...new Set(read.map((h) => h.cls))];
    /* UNANIMOUS OVER EVERY DECLARATION, OR NOTHING. A SILENT declaration is not agreement either:
       `tools/repo-map.mjs` declares `tmp` twice — once as the real write's `${p}.${pid}.tmp` sibling
       and once as the selftest's `mkdtempSync(tmpdir())` — and dropping the silent one let the
       SELFTEST's declaration classify the real write of the shared map as outside-repo (measured
       2026-11-15). This scan reads no scope, so two declarations of one name abstain BY NAME. */
    if (kinds.length > 1 || (inits.length > 1 && read.length !== inits.length)) {
      shadowed.push(
        kinds.length > 1
          ? `\`${id}\` is declared ${inits.length} times here, in ${kinds.length} classes: ${kinds.join(', ')}`
          : `\`${id}\` is declared ${inits.length} times here and ${read.length} of those decide a checkout, and this scan reads no scope`
      );
      continue;
    }
    if (read.length) hops.push({ ...read[0], id, one: inits.length === 1 });
  }
  if (hops.length) {
    const best = ORDER.map((c) => hops.find((h) => h.cls === c)).find(Boolean);
    return { cls: best.cls, literal: best.one ? (best.literal ?? null) : null, why: `${best.why} (through the declaration of \`${best.id}\`)` };
  }
  if (shadowed.length) return { cls: 'undecidable', why: shadowed.join('; ') };
  if (!ids.length && sp !== null) {
    const abs = /^\s*['"`]\//.test(arg);
    const lit = pathLiteral(arg, roots);
    if (abs) return { cls: 'outside-repo', why: 'the path is an absolute literal, so no checkout resolves it' };
    if (lit) return { cls: 'caller-cwd', why: 'the path is a relative literal, so it resolves against the run’s working directory', literal: lit };
  }
  /* THE PARAMETER HOP. The dominant idiom in this repo is a one-line local writer whose path is a
     PARAMETER, so the site is decided by its callers and not by the file's declarations. One owner
     and one decisive call site is readable; two owners of one name, or callers that disagree, are
     where a scan starts guessing, so both abstain BY NAME. */
  const notes = [];
  for (const id of ids) {
    const owners = paramOwners(fns || new Map(), id);
    if (!owners.length) continue;
    if (owners.length > 1) {
      notes.push(`\`${id}\` is a parameter of ${owners.length} functions in this file`);
      continue;
    }
    const seen = callArgs(bare || '', owners[0])
      .map((a) => ({ a, d: direct(a, roots, guarded, false, defaulted) }))
      .filter((x) => x.d);
    if (!seen.length) {
      notes.push(`\`${id}\` is a parameter of \`${owners[0]}\`, whose call sites decide no checkout`);
      continue;
    }
    const kinds = [...new Set(seen.map((x) => x.d.cls))];
    const best = ORDER.map((c) => seen.find((x) => x.d.cls === c)).find(Boolean);
    return {
      cls: best.d.cls,
      literal: kinds.length === 1 && seen.length === 1 ? (best.d.literal ?? null) : null,
      why: `${best.d.why} (through the \`${id}\` parameter of \`${owners[0]}\`, called at ${seen.length} site(s)${kinds.length > 1 ? ` in ${kinds.length} classes: ${kinds.join(', ')}` : ''})`
    };
  }
  /* AN ABSTENTION NAMES WHICH ABSENCE IT IS. A name with NO declaration here and a name whose
     declaration DECIDED NOTHING are different leads for the hand read, and one reason stood for both
     until 2026-11-15: 56 of the 86 undecided sites read "no declaration in this file decides `out`"
     over `const out = arg('--out')`, which is a declaration this scan simply does not follow. The
     initializer head travels with the second form, because that string is the lead. */
  const undeclared = ids.filter((i) => !decls.has(i));
  const silent = ids.filter((i) => decls.has(i)).map((i) => `the declaration of \`${i}\` reaches no checkout (\`${(decls.get(i)[0] || '').replace(/\s+/g, ' ').trim().slice(0, 40)}\`)`);
  const parts = [...notes, ...silent];
  if (undeclared.length) parts.push(`no declaration in this file decides \`${undeclared.join('`, `')}\``);
  return {
    cls: 'undecidable',
    why: parts.length ? parts.join('; ') : `no rule matched the expression \`${arg.replace(/\s+/g, ' ').slice(0, 40)}\``
  };
}

/** Which other mutators the tool calls, classified nowhere. PURE. */
export function otherMutators(bare) {
  return OTHER_MUTATORS.filter((n) => new RegExp(`\\b${n}\\s*\\(`).test(bare));
}

/** One tool's class, every site under it, and the mutators this scan never looked at. PURE. */
export function classifyTool(text) {
  const bare = bareSource(text, false);
  const roots = rootNames(bare);
  const decls = declarations(bare);
  const guarded = guardedRoots(bare, roots);
  const defaulted = defaultedRoots(bare, roots, guarded);
  const ctx = { roots, decls, guarded, defaulted, fns: functions(bare), bare };
  const sites = writeSites(bare).map((s) => ({ ...s, ...classifySite(s.arg, ctx) }));
  const present = new Set(sites.map((s) => s.cls));
  const cls = TOOL_CLASSES.find((c) => present.has(c)) || 'no-site';
  return { cls, sites, roots: [...roots], guarded: [...guarded], defaulted: [...defaulted], otherMutators: otherMutators(bare) };
}

/* ── population and control ──────────────────────────────────────────────────────────────────────── */

/** The write arm's own named set, from the manifest. Never a glob. */
export function population(root) {
  const m = JSON.parse(readFileSync(join(root, MANIFEST), 'utf8'));
  const arm = m.arms.write;
  return {
    pending: [...arm.pending],
    adopted: Object.keys(arm.adopted),
    exempt: Object.keys(arm.exempt || {}),
    readings: arm.adopted
  };
}

/** The backticked paths a hand-written reading names. PURE. */
export function readingPaths(reading) {
  return (reading.match(/`[^`]+`/g) || []).map((s) => s.slice(1, -1)).filter((s) => /[./]/.test(s) && !/\s/.test(s));
}

/**
 * Does this scan contradict the hand-written reading of an adopted tool? `null` when it agrees or
 * abstains.
 *
 * An adopted tool holds a GUARDED write, so three things must hold: at least one site reads guarded,
 * no site still reads own-root, and a path this scan resolved appears in the row's prose. A scan that
 * reads an adopted file otherwise read the wrong thing, which is a defect in the scan rather than in
 * the row. A row whose prose names no path in backticks excludes itself. PURE.
 */
export function contradiction(res, reading) {
  const unguarded = res.sites.filter((x) => x.cls === 'own-root');
  if (unguarded.length) return `the row declares an adoption and line ${unguarded[0].line} still builds its path from the tool's own root`;
  const guarded = res.sites.filter((x) => x.cls === 'guarded');
  if (!guarded.length) return `the row declares an adoption and this scan found no guarded site (class \`${res.cls}\`)`;
  const paths = readingPaths(reading);
  const lits = guarded.filter((x) => x.literal).map((x) => x.literal);
  if (!paths.length || !lits.length) return null;
  const agree = lits.some((l) => paths.some((q) => q === l || q.endsWith(l) || l.endsWith(q)));
  return agree ? null : `the reading names ${paths.map((q) => `\`${q}\``).join(', ')} and this scan resolved ${lits.map((l) => `\`${l}\``).join(', ')}`;
}

function isTracked(root, rel) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', rel], { cwd: root, stdio: 'ignore', timeout: 20000 });
    return 'yes';
  } catch {
    return 'no';
  }
}

/** Every named tool in the write arm, scanned. */
export function scan(root) {
  const pop = population(root);
  const rows = [];
  for (const [set, names] of [
    ['pending', pop.pending],
    ['adopted', pop.adopted],
    ['exempt', pop.exempt]
  ])
    for (const name of names) {
      const file = join(root, name);
      if (!existsSync(file)) {
        rows.push({ name, set, cls: 'undecidable', sites: [], roots: [], otherMutators: [], why: 'the file named in the manifest is absent' });
        continue;
      }
      const res = classifyTool(readFileSync(file, 'utf8'));
      for (const s of res.sites) s.tracked = s.literal ? isTracked(root, s.literal) : 'unknown';
      rows.push({ name, set, ...res });
    }
  return { pop, rows };
}

export function verdict(rows, pop, { commit } = {}) {
  const controls = pop.adopted;
  const bad = [];
  let checked = 0;
  const excluded = [];
  for (const name of controls) {
    const res = rows.find((r) => r.name === name);
    const reading = pop.readings[name].reading || '';
    /* AN EXCLUSION CARRIES ITS OWN REASON. A bare count of excluded rows reads as a smaller
       population, and says nothing about WHICH adopted reading this scan could not cross-check. */
    if (!res) {
      excluded.push(`${name}: the manifest names it and this scan holds no row for it`);
      continue;
    }
    if (!readingPaths(reading).length) {
      excluded.push(`${name}: its reading names no path in backticks, so the scan has nothing to disagree with`);
      continue;
    }
    checked++;
    const c = contradiction(res, reading);
    if (c) bad.push(`${name}: ${c}`);
  }
  const status = checked === 0 ? 'NOT_RUN' : bad.length ? 'FAIL' : 'PASS';
  return makeVerdict({
    gate: GATE,
    status,
    population: { checked, eligible: controls.length, excluded: excluded.length },
    criterion: CRITERION,
    /* NOTHING EXAMINED CARRIES NO NUMBER (§∅, and `verdict.js` refuses it). */
    result: status === 'NOT_RUN' ? null : { contradictions: bad.length, contradicting: bad, unexaminable: excluded },
    evidence: [SELF, MANIFEST],
    reason:
      status === 'PASS'
        ? null
        : status === 'NOT_RUN'
          ? `no adopted row names a path in backticks, so this scan was cross-checked against nothing: ${excluded.join('; ')}`
          : `${bad.length} adopted row(s) disagree with this scan`,
    tool: SELF,
    commit
  });
}

/* ── the printed report ──────────────────────────────────────────────────────────────────────────── */

function table(rows) {
  const w = Math.max(...rows.map((r) => r.name.length));
  const counts = Object.fromEntries(TOOL_CLASSES.map((c) => [c, 0]));
  for (const r of rows) {
    counts[r.cls]++;
    const extra = r.otherMutators.length ? `  · ${r.otherMutators.length} unclassified mutator(s): ${r.otherMutators.join(' ')}` : '';
    console.log(`  ${r.name.padEnd(w)}  ${r.set.padEnd(7)}  ${r.cls.padEnd(12)}  ${r.sites.length} site(s)${extra}`);
  }
  console.log('');
  for (const c of TOOL_CLASSES) console.log(`  ▸ ${c.padEnd(12)} ${counts[c]} tool(s)`);
  return counts;
}

function sites(rows) {
  for (const r of rows) {
    console.log(`\n▸ ${r.name}  [${r.set} · ${r.cls}]  roots: ${r.roots.join(' ') || 'none'}`);
    if (r.otherMutators.length) console.log(`  ⚠ ${r.otherMutators.join(' ')} — called here and classified nowhere`);
    for (const s of r.sites) console.log(`  ${String(s.line).padStart(5)}  ${s.cls.padEnd(12)} tracked:${s.tracked || 'unknown'}  ${s.literal ? `\`${s.literal}\`  ` : ''}${s.why}`);
    if (!r.sites.length) console.log('  no writeFileSync or appendFileSync site — this scan measured nothing here');
  }
}

/* ── planted truth ───────────────────────────────────────────────────────────────────────────────── */

export const PLANT = {
  'own-root.mjs': "const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');\nwriteFileSync(join(ROOT, 'audits', 'X.json'), body);\n",
  'own-root-helper.mjs': "const SELF_ROOT = dirname(fileURLToPath(import.meta.url));\nlet ROOT = SELF_ROOT;\nconst p = (...a) => join(ROOT, ...a);\nappendFileSync(p('CHANGELOG.md'), body);\n",
  'own-root-hop.mjs': "const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');\nconst out = join(ROOT, 'docs', 'X.md');\nwriteFileSync(out, body);\n",
  'outside-repo.mjs': "const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');\nconst dir = mkdtempSync(join(tmpdir(), 'x-'));\nwriteFileSync(join(dir, 'a.json'), body);\n",
  'caller-cwd.mjs': "const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');\nwriteFileSync(join(process.cwd(), 'a.json'), body);\n",
  'caller-argv.mjs': "const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');\nconst out = argv[argv.indexOf('--out') + 1];\nwriteFileSync(out, body);\n",
  'undecidable.mjs': "const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');\nwriteFileSync(target(), body);\n",
  'no-site.mjs': "const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');\ncreateWriteStream(join(ROOT, 'x.log')).end(body);\n",
  'commented.mjs': "const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');\n// writeFileSync(join(ROOT, 'x.json'), body);\n",
  'guarded-inline.mjs': "const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');\nwriteFileSync(join(writeRootOrDie(import.meta.url), 'DOCS-INDEX.md'), text);\n",
  'guarded-reassigned.mjs':
    "const SELF_ROOT = dirname(fileURLToPath(import.meta.url));\nlet ROOT = SELF_ROOT;\nconst p = (...a) => join(ROOT, ...a);\nROOT = writeRootOrDie(import.meta.url);\nwriteFileSync(p('CHANGELOG.md'), body);\n",
  'content-root.mjs': "const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');\nconst lines = readFileSync(join(ROOT, 'a.md'), 'utf8').split('\\n');\nwriteFileSync(lines[0], body);\n",
  /* THE TWO OVERRIDABLE SHAPES, which are the commonest real ones in `tools/`. */
  'own-root-default-fallback.mjs':
    "const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');\nconst JOURNAL = argv[argv.indexOf('--journal') + 1];\nconst journalPath = JOURNAL || join(ROOT, '.mutate-journal', f);\nwriteFileSync(journalPath, body);\n",
  'own-root-default-opt.mjs':
    "const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');\nconst OUT = opt('--out', join(ROOT, '.cache', 'x.json'));\nwriteFileSync(join(OUT, 'y.json'), body);\n"
};

function selftest() {
  let pass = 0;
  const fails = [];
  const ok = (cond, msg) => {
    if (cond) pass++;
    else fails.push(msg);
  };
  const cls = (k) => classifyTool(PLANT[k]).cls;

  ok(cls('own-root.mjs') === 'own-root', 'a literal join on the tool’s own root is own-root');
  ok(cls('own-root-helper.mjs') === 'own-root', 'a helper closing over a reassigned root carries the root');
  ok(cls('own-root-hop.mjs') === 'own-root', 'one hop through the output declaration reaches the root');
  ok(cls('outside-repo.mjs') === 'outside-repo', 'a temp directory is outside every checkout, even beside a root constant');
  ok(cls('caller-cwd.mjs') === 'caller-cwd', 'the run’s working directory is the caller’s, not the tool’s');
  ok(cls('caller-argv.mjs') === 'caller-argv', 'an argv path is the caller’s, read through one hop');
  ok(cls('undecidable.mjs') === 'undecidable', 'a path returned by a call is not decided by this scan');
  ok(cls('no-site.mjs') === 'no-site', 'a stream write is a mutator this scan classifies nowhere');
  ok(classifyTool(PLANT['no-site.mjs']).otherMutators.includes('createWriteStream'), 'and the stream is counted so the absence is visible');
  ok(cls('commented.mjs') === 'no-site', 'a commented-out write is not a site');

  /* THE ADOPTED SHAPES, both of them. A wrapper at the site, and a wrapper reassigning the root. */
  ok(cls('guarded-inline.mjs') === 'guarded', 'a wrapper call inside the path expression guards the site');
  ok(cls('guarded-reassigned.mjs') === 'guarded', 'a root a wrapper reassigns carries the guard into every helper');
  const gr = classifyTool(PLANT['guarded-reassigned.mjs']).guarded;
  ok(gr.includes('ROOT') && gr.includes('p'), `the reassigned root and its helper are both named (got ${gr.join(' ')})`);
  ok(classifyTool(PLANT['guarded-inline.mjs']).sites[0].literal === 'DOCS-INDEX.md', 'a guarded site still resolves its literal');

  /* THE TIGHTENED INHERITANCE. A value READ through a root is not a root. */
  ok(cls('content-root.mjs') !== 'own-root', `a line read out of a root file is not a path (got ${cls('content-root.mjs')})`);
  ok(!rootNames(bareSource(PLANT['content-root.mjs'], false)).has('lines'), 'and it never enters the root set');
  ok(pathDerived("join(ROOT, 'a')", 'ROOT') && pathDerived('SELF_ROOT', 'SELF_ROOT') && pathDerived('`${ROOT}/a`', 'ROOT'), 'the four path shapes inherit');
  ok(!pathDerived("readFileSync(join(ROOT, 'a'), 'utf8').split('x')", 'ROOT'), 'a read through a root does not inherit');

  /* THE OVERRIDABLE DEFAULT. A flag the caller may pass, defaulting to the tool's own checkout. Each
     of these runs in the wrong tree when the flag is absent, so the class is a reading, not a pass. */
  ok(cls('own-root-default-fallback.mjs') === 'own-root-default', `a root-relative fallback behind \`||\` is an overridable default (got ${cls('own-root-default-fallback.mjs')})`);
  ok(cls('own-root-default-opt.mjs') === 'own-root-default', `a root-relative default argument is one too (got ${cls('own-root-default-opt.mjs')})`);
  ok(rootDefaulted("JOURNAL || join(ROOT, '.x', f)", 'ROOT') && rootDefaulted("opt('--out', join(ROOT, '.cache', 'x'))", 'ROOT'), 'both shapes read as defaulted');
  ok(!rootDefaulted("readFileSync(join(ROOT, 'a.md'), 'utf8').split('x')", 'ROOT'), 'and a read THROUGH a root path is not a defaulted path');
  ok(!rootNames(bareSource(PLANT['own-root-default-opt.mjs'], false)).has('OUT'), 'an overridable default is never a root, because a caller may move it');
  ok(cls('own-root-default-opt.mjs') !== cls('own-root.mjs'), 'the two own-root shapes stay apart, because their remedies differ');

  /* TWO DECLARATIONS OF ONE NAME, one of them silent. The real write must not inherit the fixture. */
  const two = classifyTool(
    "const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');\nfunction real(p) {\n  const tmp = `${p}.tmp`;\n  writeFileSync(tmp, body);\n}\nfunction selftest() {\n  const tmp = mkdtempSync(join(tmpdir(), 'x-'));\n  writeFileSync(join(tmp, 'a'), body);\n}\n"
  ).sites[0];
  ok(two.cls === 'undecidable', `a name declared twice, once silently, decides nothing (got ${two.cls})`);
  ok(/declared 2 times here and 1 of those decide a checkout/.test(two.why), `and the abstention counts both declarations (got ${two.why})`);

  /* THE NAMESPACE FORM. Two of the seven adopted tools write only through `fs.`. */
  ok(
    classifyTool('const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");\nfs.writeFileSync(join(ROOT, "changes", "x.md"), text);\n').sites.length === 1,
    'a namespaced fs call is the same write site'
  );

  /* THE INJECTED WRITER. The repo passes its writer in for testability. */
  const inj = classifyTool(
    "const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');\nexport function save(x, { writeFn = writeFileSync } = {}) {\n  writeFn(join(ROOT, 'docs', 'X.md'), x);\n}\n"
  );
  ok(inj.cls === 'own-root' && inj.sites.length === 1 && inj.sites[0].call === 'writeFn', `a call through an injected writer is a write site (got ${inj.cls}/${inj.sites.length})`);
  ok(injectedWriters('const f = (a, { write = appendFileSync } = {}) => write(a);\n').has('write'), 'an injected appender is found too');
  ok(classifyTool('stream.write(join(ROOT, "x"));\n').sites.length === 0, 'and a member call named write is not one');

  /* THE TWO TEMP SHAPES. Both are outside every checkout, and they are not the same absence. */
  const tb = classifyTool("const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');\nconst d = mkdtempSync(join(tmpdir(), 'x-'));\nwriteFileSync(join(d, 'a'), body);\n").sites[0];
  const tr = classifyTool("const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');\nconst d = mkdtempSync(join(dirname(ROOT), '.x-'));\nwriteFileSync(join(d, 'a'), body);\n").sites[0];
  ok(tb.cls === 'outside-repo' && tr.cls === 'outside-repo', 'a sandbox is outside every checkout, wherever its base sits');
  ok(/under a temporary or home directory/.test(tb.why), `a \`tmpdir()\` base says so (got ${tb.why})`);
  ok(/beside `ROOT`/.test(tr.why), `and a sandbox beside the checkout names the root instead (got ${tr.why})`);

  /* THE GUARD IS A CALL, NOT A MENTION. The gates' own pattern constants name the wrapper. */
  ok(!guardedRoots('const STATUS_MARK = "run writeRootOrDie(import.meta.url) first";\n', new Set()).has('STATUS_MARK'), 'a string naming the wrapper does not guard anything');
  ok(guardedRoots('const ROOT = writeRootOrDie(import.meta.url);\n', new Set()).has('ROOT'), 'and the call itself still does');
  ok(isWrapperCall("join(writeRootOrDie(import.meta.url), 'docs')") && !isWrapperCall("'writeRootOrDie('"), 'the wrapper reads at the head of a path, never inside a literal');

  /* THE ABSTENTION NAMES WHICH ABSENCE IT IS, and carries the lead for the hand read. */
  const silent = classifyTool("const out = arg('--out');\nwriteFileSync(out, body);\n").sites[0];
  ok(silent.cls === 'undecidable' && /declaration of `out` reaches no checkout/.test(silent.why), `a declaration this scan does not follow says so (got ${silent.why})`);
  ok(/arg\('--out'\)/.test(silent.why), `and quotes the initializer as the lead (got ${silent.why})`);
  ok(/no declaration in this file decides `gone`/.test(classifyTool('writeFileSync(gone, body);\n').sites[0].why), 'an identifier declared nowhere reads the other reason');

  /* THE ORDER IS THE CLAIM: an abstention outranks a proof of safety, and own-root outranks both. */
  ok(classifyTool(PLANT['outside-repo.mjs'] + PLANT['undecidable.mjs']).cls === 'undecidable', 'one undecided site outranks a safe one');
  ok(classifyTool(PLANT['undecidable.mjs'] + PLANT['own-root.mjs']).cls === 'own-root', 'one own-root site outranks an abstention');
  ok(classifyTool(PLANT['undecidable.mjs'] + PLANT['own-root-default-fallback.mjs']).cls === 'own-root-default', 'a proven overridable default outranks an abstention too');
  ok(classifyTool(PLANT['own-root-default-fallback.mjs'] + PLANT['own-root.mjs']).cls === 'own-root', 'and an unconditional own-root write outranks a default');

  /* THE PATH LITERAL, which is what a reading quotes. */
  const r1 = classifyTool(PLANT['own-root.mjs']).sites[0];
  ok(r1.literal === 'audits/X.json', `a fully literal join resolves (got ${r1.literal})`);
  ok(
    classifyTool("const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');\nwriteFileSync(join(ROOT, 'audits', name), body);\n").sites[0].literal === null,
    'a variable segment leaves the literal null'
  );
  ok(
    classifyTool('const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");\nwriteFileSync(`${ROOT}/audits/${k}.json`, body);\n').sites[0].literal === null,
    'an interpolated template leaves the literal null'
  );

  /* ROOT DISCOVERY to a fixpoint, and the over-reach named in the header. */
  const roots = rootNames(bareSource(PLANT['own-root-helper.mjs'], false));
  ok(roots.has('SELF_ROOT') && roots.has('ROOT') && roots.has('p'), `the chain reaches the helper (got ${[...roots].join(' ')})`);
  ok(!rootNames('const SELF = "tools/x.mjs";\n').has('SELF'), 'a literal name is not a root');

  /* THE UNBALANCED CALL ABSTAINS BY NAME rather than reading a truncated path. */
  ok(/do not balance/.test(classifyTool('const ROOT = fileURLToPath(import.meta.url);\nwriteFileSync(join(ROOT, "a"\n').sites[0].why), 'an unbalanced call names its own reason');

  /* THE CONTROL, both directions. */
  ok(contradiction(classifyTool(PLANT['guarded-inline.mjs']), 'it rewrites `DOCS-INDEX.md`') === null, 'a resolved path the reading names agrees');
  ok(contradiction(classifyTool(PLANT['guarded-inline.mjs']), 'it rewrites `OTHER.md`') !== null, 'a resolved path no reading names is a contradiction');
  ok(contradiction(classifyTool(PLANT['own-root.mjs']), 'it writes `audits/X.json`') !== null, 'an adopted row whose site still reads own-root is a contradiction');
  ok(contradiction(classifyTool(PLANT['caller-argv.mjs']), 'it writes `audits/X.json`') !== null, 'an adopted row with no guarded site is a contradiction');
  ok(contradiction(classifyTool(PLANT['guarded-inline.mjs']), 'it rewrites the served index') === null, 'a reading naming no path excludes itself rather than agreeing');
  ok(readingPaths('it writes `audits/X.json` and `DOCS-INDEX.md`, with `--pin`').join(' ') === 'audits/X.json DOCS-INDEX.md', 'a flag in backticks is not a path');

  /* THE VERDICT ARITHMETIC. */
  const rows = [
    { name: 'a.mjs', set: 'adopted', ...classifyTool(PLANT['guarded-inline.mjs']) },
    { name: 'b.mjs', set: 'adopted', ...classifyTool(PLANT['caller-argv.mjs']) }
  ];
  const popOk = { adopted: ['a.mjs'], readings: { 'a.mjs': { reading: 'it rewrites `DOCS-INDEX.md`' } } };
  const v1 = verdict(rows, popOk, { commit: 'deadbeef' });
  ok(v1.status === 'PASS' && v1.population.checked === 1 && v1.population.excluded === 0, 'one agreeing control passes');
  const popBad = { adopted: ['a.mjs', 'b.mjs'], readings: { 'a.mjs': { reading: 'it rewrites `DOCS-INDEX.md`' }, 'b.mjs': { reading: 'it writes `audits/Y.json`' } } };
  const v2 = verdict(rows, popBad, { commit: 'deadbeef' });
  ok(v2.status === 'FAIL' && v2.result.contradictions === 1 && v2.reason !== null, 'one contradicting control fails and says so');
  ok(v2.population.checked + v2.population.excluded === v2.population.eligible, 'the population balances');
  const popEx = { adopted: ['a.mjs', 'b.mjs'], readings: { 'a.mjs': { reading: 'it rewrites `DOCS-INDEX.md`' }, 'b.mjs': { reading: 'it writes where the caller says' } } };
  const vEx = verdict(rows, popEx, { commit: 'deadbeef' });
  ok(vEx.status === 'PASS' && vEx.population.excluded === 1, 'a reading naming no path is excluded, not counted as agreement');
  ok(/^b\.mjs: its reading names no path/.test(vEx.result.unexaminable[0]), 'and the excluded row is named with its reason');
  const vMiss = verdict([], { adopted: ['a.mjs'], readings: { 'a.mjs': { reading: 'it rewrites `DOCS-INDEX.md`' } } }, { commit: 'deadbeef' });
  ok(vMiss.status === 'NOT_RUN' && /a\.mjs: the manifest names it/.test(vMiss.reason), 'an adopted row this scan never read is named in the reason');
  const v3 = verdict(rows, { adopted: ['a.mjs'], readings: { 'a.mjs': { reading: 'it rewrites the served index' } } }, { commit: 'deadbeef' });
  ok(v3.status === 'NOT_RUN' && v3.population.checked === 0 && v3.reason !== null && v3.result === null, 'a control set that names no path examined nothing, and carries no number');

  console.log(fails.length ? `✗ write-targets selftest: ${fails.length} of ${pass + fails.length} failed` : `✓ write-targets selftest — all ${pass} assertions passed`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  return fails.length ? 1 : 0;
}

/* ── CLI ─────────────────────────────────────────────────────────────────────────────────────────── */

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { boolean: ['--json', '--control', '--selftest', '--verdict-sample'], valued: ['--only'] }, { tool: SELF });
  if (argv.includes('--selftest')) process.exit(selftest());
  if (argv.includes('--verdict-sample')) {
    console.log(
      JSON.stringify(
        verdict([{ name: 'x.mjs', set: 'adopted', ...classifyTool(PLANT['guarded-inline.mjs']) }], { adopted: ['x.mjs'], readings: { 'x.mjs': { reading: 'it rewrites `DOCS-INDEX.md`' } } }),
        null,
        2
      )
    );
    process.exit(0);
  }
  const { pop, rows } = scan(ROOT);
  const v = verdict(rows, pop);
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
  const picked = only ? rows.filter((r) => r.name === only || r.name.endsWith(`/${only}`)) : rows;
  if (argv.includes('--json')) console.log(JSON.stringify({ verdict: v, rows: picked }, null, 2));
  else if (argv.includes('--control')) console.log(JSON.stringify(v, null, 2));
  else if (only) sites(picked);
  else {
    console.log(`▸ write arm: ${rows.length} named tool(s) — ${pop.pending.length} pending, ${pop.adopted.length} adopted, ${pop.exempt.length} exempt\n`);
    table(rows);
    console.log(
      `\n  tepna.verdict/1: ${v.status}  ·  ${v.population.checked} checked / ${v.population.eligible} eligible / ${v.population.excluded} excluded  ·  ${v.result ? `${v.result.contradictions} contradiction(s)` : 'nothing examined'}`
    );
    for (const c of v.result?.contradicting || []) console.log(`    ✗ ${c}`);
    for (const u of v.result?.unexaminable || []) console.log(`    ⊘ ${u}`);
  }
  process.exit(v.status === 'FAIL' ? 1 : 0);
}
