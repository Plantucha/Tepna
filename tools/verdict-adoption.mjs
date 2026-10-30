#!/usr/bin/env node
/*
 * tools/verdict-adoption.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE VERDICT-CONTRACT ADOPTION GATE — every producer of a verdict word, enumerated and binned,
 * as an EQUALITY (VERDICT-CONTRACT §3 / §3b step 2).
 *
 * The brief's first adopter list was a recency sample (eleven tools); enumerated, the population is
 * ~150 files across both lanes. A list written from memory is the one-of-N trap
 * (`PARTIAL-ADOPTION-DETECTION`) — so the population is COMPUTED (the grep below, on the tree), every
 * member is BINNED in a committed manifest (`tools/verdict-adoption.json`), and the gate holds the two
 * equal: a producer the grep finds that the manifest does not name is a red WITH ITS NAME, and so is a
 * manifest row for a file that no longer prints the word.
 *
 * Bins (the manifest's `bin`), each with what the gate demands of it:
 *   decides       the output is a decision someone acts on → must adopt tepna.verdict/1; `status`
 *                 is `pending` or `adopted`; an `adopted` row names how it EMITS the object
 *                 (`emits: { cmd: [...] }` printing JSON, or `emits: { file }`), and the gate RUNS or
 *                 READS it and validates under verdict.js — the object is asserted, never the prose
 *   already-json  has --json / writes a record → converge the record (same rule as decides once adopted)
 *   word-only     the word occurs in a comment, a label, a log line that decides nothing → exempt,
 *                 WITH `reason` — an exemption without a reason is a silent adoption gap
 *   test          a test file asserting on verdict words is a READER, not a producer — exempt by class
 *
 * ADOPTION IS A RATCHET, and the gate holds it against the MERGE BASE. Measured 2026-09-22: this
 * manifest conflicts as ONE whole-file hunk on nearly every adoption PR (two sides rewrite one dict),
 * and the obvious resolution — take main, substitute every key where MY side differs — silently put
 * #2888's `tools/pb-agreement.mjs` back to `word-only`/`exempt`. The merge committed clean and this
 * gate stayed GREEN, because an exempt row is a legal row. So `checkRatchet` reads the manifest at
 * `git merge-base HEAD <base>` and reds on any tool that was `adopted` there and is not `adopted`
 * here — the row absent, or its status moved — unless the tool's FILE is gone from the tree (a
 * retired tool is not a de-adoption). Population is an equality: adoptedAtBase = kept + retired +
 * deAdopted. A branch that is merely BEHIND has de-adopted nothing (its merge base predates the new
 * adoption); a branch that MERGED main and lost the row has, and that is the case this catches.
 *
 * The companion procedure for resolving that conflict, so the gate is the backstop and not the plan:
 * compute BOTH deltas from the merge base (`changed by me` · `changed by main` · `by both`, and a
 * key both changed is resolved by hand), rebuild from main's dict plus your own keys, and write the
 * result with `--format` so the rewrite cannot smuggle a reformat. Then `git diff --stat <base> --
 * tools/verdict-adoption.json` must show only your rows.
 *
 * THE BYTE FORM (residue 2026-10-20-a-json-round-trip-rewrites-a-shared-registry-nobody-touched). A
 * writer that re-encodes this file turns a five-line record into a whole-file diff, and that diff
 * conflicts with every other open record: #3777 landed 173+/161- for a five-line record, because a
 * Python `json.dump` escaped every non-ASCII character. Every gate stayed green, since the parsed
 * object was identical. So the file has ONE byte form, `canonicalText`: the bytes Python's
 * `json.dump(obj, f, indent=1)` writes plus a final newline — a one-space indent, every character
 * outside printable ASCII as a lowercase `\uXXXX` escape. A Python round-trip and `--format` give the
 * same bytes, so neither can rewrite a record it did not touch. `--check` refuses any other form and
 * names the first line that differs. On 2026-10-21 three hand-inserted records stood in two other
 * forms (raw `\u2014`/`\u00b7` in two notes, a two-space indent on one record).
 *
 *   node tools/verdict-adoption.mjs --check          # the gate (npm run check step; exit 1 on any red)
 *   node tools/verdict-adoption.mjs --check --base <ref>   # ratchet base (default origin/main; merge-base with HEAD)
 *   node tools/verdict-adoption.mjs --triage         # first-pass suggestions for UNBINNED files; writes nothing
 *   node tools/verdict-adoption.mjs --format         # rewrite the manifest in its one byte form (THE BYTE FORM)
 *   node tools/verdict-adoption.mjs --selftest
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';
import { CLS_CODE, blankComments, classify } from './js-lex.mjs';
import { declaresSelftest } from './selftest-all.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'tools', 'verdict-adoption.json');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

/* The one byte form of the manifest (see THE BYTE FORM above). JSON.stringify and Python's json.dump
   escape control characters alike (\b \f \n \r \t, else lowercase \u00xx); Python's ensure_ascii also
   escapes U+007F and everything above it, one UTF-16 unit at a time, which this replace reproduces. */
export function canonicalText(obj) {
  return `${JSON.stringify(obj, null, 1).replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)}\n`;
}

/* The bytes against their canonical form. A file that does not parse is a red here too, so the
   caller never reads a form verdict over text it could not examine. */
export function checkByteForm(text, name = 'tools/verdict-adoption.json') {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return { ok: false, line: null, errors: [`byte form: ${name} does not parse (${e.message})`] };
  }
  const want = canonicalText(obj);
  if (want === text) return { ok: true, line: null, errors: [] };
  const a = text.split('\n');
  const b = want.split('\n');
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  return {
    ok: false,
    line: i + 1,
    errors: [
      `byte form: ${name} line ${i + 1} is not in the canonical form (Python json.dump indent=1, non-ASCII as \\uXXXX). ` +
        'Run `node tools/verdict-adoption.mjs --format` and commit the result: a record in another form is rewritten by the next writer, and that diff conflicts with every open record'
    ]
  };
}

export const WORDS = /\b(PASS|FAIL|VERDICT|UNDERPOWERED|SHORTFALL|CONSISTENT|INCONCLUSIVE)\b/;
export const BINS = ['decides', 'already-json', 'word-only', 'test'];
export const STATUSES = ['pending', 'adopted', 'exempt'];

/* ── MEMBERSHIP IS A PUBLICATION, NOT A WORD IN THE PROSE ──────────────────────────────────────
   Until 2026-10-25 the population was one `git grep` for WORDS over whole files, COMMENTS INCLUDED,
   so a file's prose decided whether the gate demanded a bin of it. The defect cut both ways, and
   both halves were measured at `bdc34c97d` (row
   `2026-10-22-the-adoption-population-is-keyed-on-a-literal-word-anywhere-in-the-file`): 50 files
   entered on a word that occurs nowhere but a comment, and 8 tools that build a real
   `tepna.verdict/1` through `populationVerdict` were invisible to it, because a builder's NAME
   carries no decision word. A population that moves when someone edits a comment is not reading
   the code.

   The rule is now a publication, read off COMMENT-BLANKED source (`blankComments` / `blankPyComments`
   — the discriminator `namesOutsideComments` already uses: A MENTION IS NOT A PUBLICATION):

     word      a WORDS token survives blanking — the original rule, minus the prose
     schema    the schema string as a QUOTED literal. Backticked prose does NOT publish, and the
               Python blanker deliberately keeps a docstring as a string, so the discriminator has
               to be the quotes (`capture-host/devfloors.py` says in its docstring that its tokens
               are NOT the seven statuses, and emits no object at all)
     contract  the file imports `verdict.js`, or the Python `verdict` module — the contract's own
               constructor. `capture-host/tools/mutate.py` reaches the object only this way, and it
               is an ADOPTED row: a rule that missed it would have de-adopted a live producer
     builder   the file CALLS, outside its comments, a verdict-named function it IMPORTS from a
               module that publishes by one of the three rules above. One hop, and the import is
               load-bearing: a test fixture's own local `verdict(…)` helper is not a publication
               (measured — dropping the import requirement admitted 11 such files)

   Scope is unchanged: the same three globs, the same non-recursive filters, untracked files
   included. */
export const SCHEMA_LITERAL = /['"]tepna\.verdict\/1['"]/;
export const CONTRACT_JS = /['"][^'"]*\bverdict\.js['"]/;
export const CONTRACT_PY = /^[ \t]*(?:import\s+verdict\b|from\s+verdict\s+import\b)/m;
export const BUILDER_NAME = /verdict/i;

/* The source with its comments blanked. PURE. `isPy` picks the comment syntax. */
export function bareSource(text, isPy) {
  if (text == null) return '';
  return isPy ? blankPyComments(text) : blankComments(text);
}

/* Every identifier an import statement brings INTO this file, from blanked source. PURE.
   Python's parenthesised multi-line form is the one `capture-host/tools/mutate.py` uses, so a
   line-at-a-time reader would miss every builder it imports. */
export function importedNames(bare, isPy) {
  const out = new Set();
  const add = (s) => {
    const n = s
      .trim()
      .split(/\s+as\s+/)
      .pop()
      .trim()
      .replace(/[()]/g, '');
    if (n) out.add(n);
  };
  if (isPy) for (const m of bare.matchAll(/^[ \t]*from\s+[\w.]+\s+import\s+(?:\(([^)]*)\)|([^\n#]+))/gm)) for (const n of (m[1] ?? m[2]).split(',')) add(n);
  else for (const m of bare.matchAll(/import\s*\{([^}]*)\}\s*from/g)) for (const n of m[1].split(',')) add(n);
  return out;
}

/* Does this file publish by one of the three rules a BUILDER may be defined in? PURE. */
export function isVerdictSource(bare, isPy) {
  return SCHEMA_LITERAL.test(bare) || (isPy ? CONTRACT_PY.test(bare) : CONTRACT_JS.test(bare));
}

/* name → the file defining it, over every verdict source in `bareByPath`. PURE. A `test_*` function
   is a test's own name, never a builder (`test_the_memory_verdict_names_…` is prose with parens). */
export function verdictBuilders(bareByPath) {
  const out = new Map();
  for (const [p, bare] of bareByPath) {
    const isPy = p.endsWith('.py');
    if (!isVerdictSource(bare, isPy)) continue;
    const defs = isPy ? bare.matchAll(/^def\s+([a-z_][\w]*)/gm) : bare.matchAll(/export\s+function\s+([A-Za-z_$][\w$]*)/g);
    for (const m of defs) if (BUILDER_NAME.test(m[1]) && !m[1].startsWith('test_')) out.set(m[1], p);
  }
  return out;
}

/* Why this file is in the population, or null. PURE — the whole membership rule in one function. */
export function publicationOf(bare, isPy, builders) {
  if (WORDS.test(bare)) return 'word';
  if (SCHEMA_LITERAL.test(bare)) return 'schema';
  if (isPy ? CONTRACT_PY.test(bare) : CONTRACT_JS.test(bare)) return 'contract';
  for (const n of importedNames(bare, isPy)) if (builders && builders.has(n) && new RegExp(`\\b${n}\\s*\\(`).test(bare)) return `builder:${n}`;
  return null;
}

/* The population over an explicit file list, `readSource` injected. PURE given its reader, so the
   selftest can plant a tree. Returns the sorted paths; `publicationsOf` returns the reasons. */
export function enumerateFrom(files, readSource) {
  return [...publicationsOf(files, readSource).keys()].sort();
}

export function publicationsOf(files, readSource) {
  const bareByPath = new Map(files.map((p) => [p, bareSource(readSource(p), p.endsWith('.py'))]));
  const builders = verdictBuilders(bareByPath);
  const out = new Map();
  for (const [p, bare] of bareByPath) {
    const why = publicationOf(bare, p.endsWith('.py'), builders);
    if (why) out.set(p, why);
  }
  return out;
}

/** The verdict-named builder map over an explicit file list. PURE given its reader. */
export function buildersOver(files, readSource) {
  return verdictBuilders(new Map(files.map((p) => [p, bareSource(readSource(p), p.endsWith('.py'))])));
}

/* The population on a real tree. The scope rules and their histories, unchanged by the 2026-10-25
   rewrite above:
   · tests/*.mjs joined 2026-09-22 (Kestrel): a RUNNER that emits the object but sits outside the
     population is the one-of-N shape from the other side — tests/run-tests.mjs adopted §3d (#2835)
     and the gate could not see it. Non-recursive, like tools/.
   · UNTRACKED FILES COUNT. `git grep` alone enumerates TRACKED files, so a brand-new producer sitting
     untracked in the author's worktree was invisible here, the local gate read green, and CI — which
     checks out the commit — reded on the same file (#2954, 2026-09-23). `--others
     --exclude-standard` is `git grep --untracked`'s half of `ls-files`: the enumeration is the
     WORKING TREE, not the index, which is also why the reader is the filesystem. A tracked file
     deleted in the worktree reads as absent and publishes nothing, exactly as the grep had it. */
export function enumerate(root) {
  return [...treePublications(root).keys()].sort();
}

/* The same population as a Map path → the reason it was admitted. The reader is the filesystem. */
export function treePublications(root) {
  let out;
  try {
    out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'tools/*.mjs', 'capture-host/*.py', 'tests/*.mjs'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch (e) {
    if (e.status === 1) return [];
    throw e;
  }
  const files = out
    .split('\n')
    .filter(Boolean)
    .filter((p) => !p.startsWith('tools/') || !p.slice(6).includes('/')) // tools/*.mjs non-recursive, like the two tool gates
    .filter((p) => !p.startsWith('tests/') || !p.slice(6).includes('/')); // tests/*.mjs non-recursive too
  const read = (p) => {
    try {
      return fs.readFileSync(path.join(root, p), 'utf8');
    } catch (_) {
      return null;
    }
  };
  return publicationsOf([...new Set(files)], read);
}

/* Pure: judge a manifest against an enumerated population. Returns { ok, errors[], unexamined[],
   counts }. `unexamined` is the producers the runner could not READ — a cap hit under box load, not
   a judgement about the adoption; the CLI reports them apart from `errors` and `ok` ignores them,
   because a run that examined nothing about a row has found nothing wrong with it either. */
export function check(enumerated, manifest, validator, runner) {
  const errors = [];
  const unexamined = [];
  const rows = (manifest && manifest.producers) || {};
  const named = Object.keys(rows).sort();
  const enumSet = new Set(enumerated);
  const namedSet = new Set(named);
  for (const p of enumerated) if (!namedSet.has(p)) errors.push(`UNBINNED producer: ${p} publishes a verdict and is in no bin — add it to tools/verdict-adoption.json`);
  for (const p of named)
    if (!enumSet.has(p))
      errors.push(`STALE row: ${p} is in the manifest and publishes no verdict (no word, no object, no builder call outside its comments; or the file is gone) — remove or re-bin it`);
  const counts = { enumerated: enumerated.length, named: named.length, decides: 0, 'already-json': 0, 'word-only': 0, test: 0, adopted: 0, pending: 0, validated: 0, unexamined: 0 };
  for (const p of named) {
    const r = rows[p] || {};
    if (!BINS.includes(r.bin)) {
      errors.push(`${p}: bin must be one of ${BINS.join('|')}, got ${JSON.stringify(r.bin)}`);
      continue;
    }
    counts[r.bin]++;
    if (r.bin === 'word-only' || r.bin === 'test') {
      if (r.bin === 'word-only' && !(typeof r.reason === 'string' && r.reason.trim())) errors.push(`${p}: word-only without a reason — an exemption without a reason is a silent adoption gap`);
      if (r.status && r.status !== 'exempt') errors.push(`${p}: ${r.bin} rows are status "exempt", got ${JSON.stringify(r.status)}`);
      continue;
    }
    if (!['pending', 'adopted'].includes(r.status)) {
      errors.push(`${p}: ${r.bin} rows carry status pending|adopted, got ${JSON.stringify(r.status)}`);
      continue;
    }
    counts[r.status]++;
    if (r.status === 'adopted') {
      if (!r.emits || (!Array.isArray(r.emits.cmd) && typeof r.emits.file !== 'string')) {
        errors.push(`${p}: adopted without \`emits\` ({cmd:[…]} printing the object, or {file}) — an adoption the gate cannot read is a claim`);
        continue;
      }
      const te = timeoutMsError(p, r.emits);
      if (te) {
        errors.push(te);
        continue;
      }
      if (!validator || !runner) continue; // the pure core; the CLI passes both
      let obj;
      try {
        obj = runner(r.emits);
      } catch (e) {
        if (e && e.unexamined) {
          unexamined.push({ path: p, ...e, message: String(e.message || e) });
          counts.unexamined++;
          continue;
        }
        errors.push(`${p}: emits could not be read — ${String(e.message || e).slice(0, 120)}`);
        continue;
      }
      const v = validator(obj);
      counts.validated++;
      if (!v.ok) errors.push(`${p}: the emitted object is NOT a valid tepna.verdict/1 — ${v.errors.slice(0, 3).join(' | ')}`);
    }
  }
  return { ok: errors.length === 0, errors, unexamined, counts };
}

/* ── EVERY CHECK IS GATED — a static population equality over the `decides` set ──────────────────
   Residue `2026-09-12-fix-for-ungated-check-lands-ungated`: a CHECK shipped with no test (#2321), its
   fix shipped with no test (#2402), and the test arrived two PRs later (#2404) — the repair's own
   boundary survived only as a comment. The row's candidate rule (a tool change with no test hunk)
   was measured to death by its sibling `2026-09-12-ungated-tool-fix-rule-not-viable`: 41–68 % of
   commits flagged at every narrowing, an invariant convicting working practice. So the gate is NOT a
   diff rule. It is a property of the tree: every producer this manifest bins as `decides` — the
   repo's enumerated set of checks — is GATED, meaning it declares `--selftest` (in a call position,
   the same predicate selftest-all.mjs discovers by) OR a file under tests/ or capture-host/tests/
   names it. A check with no test is caught the day it is binned, not by guessing which PRs fix it.
   `UNGATED_RATCHET` names the decides producers that were ungated when this landed — DEBT, not
   approval, and it may only SHRINK: a new decides producer with no test reds by name; a ratchet
   entry that gains a test reds until it is removed; a producer whose test disappears reds.
   ⚠️ The population is the manifest's decides set, not every tool: the row's own instance
   (`tools/wt-done.mjs`, a queue action, `word-only`) sits outside it by design. Widening to every
   tools/*.mjs that declares a check is the owner's call, with a measured count (see the PR body). */
export const UNGATED_RATCHET = new Set(['tools/pat-ppg-ppg-control.mjs', 'tools/pulse-agreement.mjs', 'tools/tch-estimator-bakeoff.mjs', 'tools/tch-per-epoch-rho.mjs']);

/* ⚠️ A FOURTH SPELLING — and the comment in `selftest-all.mjs` predicted it. That predicate matched
   `has('--selftest')` / `includes('--selftest')` / `indexOf('--selftest')` by CALL POSITION, which is
   right, and keyed on the DASHED literal, which is not: `tools/null-fuzz.mjs` reads
   `const has = (name) => args.includes(`--${name}`)` and asks `has('selftest')`, so the string
   `'--selftest'` appears nowhere in its code. Measured 2026-10-21: it was the only tool in the 280 to
   compose the dashes, its selftest runs green in 2.9 s over four targets with a control and a plant,
   and no runner had ever run it — `selftest-all --list` named 190 tools and not that one. Accepting the
   bare literal recovers it with zero tools lost (190 → 191). The predicate is `declaresSelftest`, IMPORTED
   from `selftest-all.mjs`, so the sweep and this gate read one pattern; the two copies this replaced
   could drift (row `2026-10-21-selftest-all-runs-its-cli-at-module-scope`). */

/* Does `text` name `stem` OUTSIDE its comments? PURE. `isPy` picks the comment syntax.
   A MENTION IS NOT A TEST: this is the discriminator `gatedBy` was asked for and did not have. */
export function namesOutsideComments(stem, text, isPy) {
  if (text == null) return false;
  const bare = isPy ? blankPyComments(text) : blankComments(text);
  return bare.includes(stem);
}

/* Python comments, blanked. A SEPARATE LANGUAGE GETS A SEPARATE SCANNER rather than a second JS lexer
   (`js-lex.mjs`'s standing rule). `#` only opens a comment outside a string, and a triple-quoted block
   stays a STRING here — a docstring that names a tool is prose a reader would call a comment, and the
   honest answer is that nothing in the measured population turns on it: classing docstrings either way
   gives the same verdict for all 123 `decides` producers (measured 2026-10-21). */
export function blankPyComments(src) {
  let out = '';
  let i = 0;
  let q = null; // the open quote: "'", '"', "'''" or '"""'
  while (i < src.length) {
    if (q) {
      if (src.startsWith(q, i)) {
        out += q;
        i += q.length;
        q = null;
      } else if (src[i] === '\\' && q.length === 1) {
        out += src.slice(i, i + 2);
        i += 2;
      } else {
        out += src[i++];
      }
      continue;
    }
    const three = src.slice(i, i + 3);
    if (three === "'''" || three === '"""') {
      q = three;
      out += three;
      i += 3;
    } else if (src[i] === "'" || src[i] === '"') {
      q = src[i];
      out += src[i++];
    } else if (src[i] === '#') {
      while (i < src.length && src[i] !== '\n') (out += ' '), i++;
    } else {
      out += src[i++];
    }
  }
  return out;
}

/* Python string CONTENT, blanked, quotes and offsets kept. The sibling of `blankPyComments`, for the
   one question a docstring must not answer: which functions does this body CALL? A docstring stays a
   string there by design, and prose carries parentheses — "the next loss-poller tick (`poll_sec`)" reads
   as a call to `tick` (measured 2026-10-30 on `capture-host/solid_night.py`, which turned two resolvable
   builders into unresolved ones). Comments are already blanked upstream; this blanks the prose. */
export function blankPyStrings(src) {
  let out = '';
  let i = 0;
  let q = null;
  while (i < src.length) {
    if (q) {
      if (src.startsWith(q, i)) {
        out += q;
        i += q.length;
        q = null;
      } else if (src[i] === '\\' && q.length === 1) {
        out += '  ';
        i += 2;
      } else {
        out += src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }
    const three = src.slice(i, i + 3);
    if (three === "'''" || three === '"""') {
      q = three;
      out += three;
      i += 3;
    } else if (src[i] === "'" || src[i] === '"') {
      q = src[i];
      out += src[i++];
    } else {
      out += src[i++];
    }
  }
  return out;
}

/* What gates a producer, or null. `readSource(p)` returns the file text — for the producer AND for each
   candidate test file; `testRefs(stem)` the list of test files naming it. Both injected, so the
   invariant is testable without a tree. A ref counts only when the test file names the tool outside its
   comments (see `namesOutsideComments`). */
export function gatedBy(p, readSource, testRefs) {
  const src = readSource(p);
  if (src != null && declaresSelftest(src)) return 'selftest';
  const stem = path.basename(p).replace(/\.(mjs|py)$/, '');
  const refs = (testRefs(stem) || []).filter((f) => f !== p && namesOutsideComments(stem, readSource(f), f.endsWith('.py')));
  return refs.length ? 'tests:' + refs.slice(0, 2).join(',') : null;
}

/* ── A WORD-ONLY ROW MAKES A CLAIM, AND THE CLAIM GOES STALE ──────────────────────────────────
   `bin: "word-only"` is an assertion ABOUT THE SOURCE — that the verdict vocabulary in the file is
   prose, not an emitted decision. Nothing checked it after it was written, so it rots two ways:
   copy-paste (47 of 85 rows carry one reason string verbatim) and, worse, DRIFT — a row's reason is
   true when written and false once the tool gains a decision. Measured 2026-09-22 on my own work:
   #2851 gave `tools/buzz-fiducial-correlate.mjs` a daemon-capture refusal that morning; its row
   still said "not a verdict about data" that afternoon, and no gate could see it, because the bin is
   ASSERTED in the manifest rather than DERIVED from the source.

   ⚠️ THE POPULATION IS THE DESIGN, NOT A CAVEAT. This check tests the CLAIM A ROW MAKES, and a row
   that CONCEDES emission is outside its population by construction. Three reason-classes assert that
   nothing is emitted (`CLAIM_REASONS`, 71 of 85 rows); the other 14 concede the words are emitted and
   explain why they are not a decision over a criterion — `land-pr.mjs`'s queue vocabulary,
   `mutation-reach.mjs`'s fail-closed classification. Those are judgement calls the gate must not
   adjudicate, and including them is what took the false-positive rate from 0 to 18 %: measured over
   all 85 rows the discriminator flags 11, two of them wrong, and BOTH are conceding rows.

   Measured before shipping (the bands are pre-stated): 71 checked · 9 flagged · 0 false positives.
   The 9 are handed to the follow-up adoptions through `WO_CLAIM_RATCHET`, which may only SHRINK —
   the same shape as `UNGATED_RATCHET` above, and for the same reason: an entry removed is a
   demonstration the check has teeth on a real file. */
export const CLAIM_REASONS = ['selftest assertion printer', 'verdict words appear only in comments', 'not as an emitted verdict'];

/* A DECISION word. Kept narrower than `WORDS`: these are what a tool prints when it decides, not
   what it prints as a log level. */
const DECISION_WORDS = /\b(REFUSED|VERDICT|TALLY|RECOVERED|UNDERPOWERED|SHORTFALL|NOT_RUN|NOT_APPLICABLE|REALM-FAIL|PASS|FAIL)\b/;

/* The named exclusions — the twelve false positives measured 2026-09-22, every one of them selftest
   INFRASTRUCTURE living at module scope, outside the function body: the `cond ? 'ok' : 'FAIL'`
   assertion printer, the `SELFTEST FAIL:` handler, and calls to the `ok(` helper itself. */
const NOT_A_DECISION = [/\?\s*'ok\s*'?\s*:\s*'?FAIL/, /SELF-?TEST\s+FAIL/, /\bok\s*\(/];

/* ⚠️ AN ESCAPE GLUES TO THE WORD AND KILLS `\b` — `console.log('\nTALLY:', …)` reads as `nTALLY` and
   was MISSED on this check's first run (`tools/pat-residual-structure.mjs`, found only because the
   flag count moved 10 → 11 when it was fixed). The unescaping below is why; the selftest plants it
   permanently, because a detector whose sensitivity was assumed once will be assumed again. */
const unescape = (s) => s.replace(/\\[nrt]/g, ' ');

/** The span of a `selftest` body, or null when no locator matches (then the WHOLE file is scanned,
 *  which biases toward false positives, never toward misses — 33 of the 71 rows, named in the
 *  output so the bias travels with the number). PURE. */
export function selftestSpan(src, isPy) {
  const m = isPy ? /\ndef\s+selftest\w*\s*\(/.exec(src) : /\n(?:export\s+)?(?:async\s+)?function\s+selftest\w*\s*\(/.exec(src);
  if (!m) return null;
  const from = m.index;
  if (isPy) {
    const j = src.indexOf('\ndef ', m.index + m[0].length);
    return [from, j < 0 ? src.length : j];
  }
  const b = src.indexOf('{', m.index + m[0].length - 1);
  let depth = 0;
  for (let k = b; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return [from, k + 1];
  }
  return [from, src.length];
}

/** Lines where the tool PRINTS a decision word outside its selftest body. PURE. */
export function emittedDecisionLines(src, isPy) {
  const span = selftestSpan(src, isPy);
  const scanned = span ? src.slice(0, span[0]) + src.slice(span[1]) : src;
  const out = [];
  for (const raw of scanned.split('\n')) {
    const s = unescape(raw.trim());
    if (!/console\.(log|error)\(|\bprint\(/.test(s)) continue;
    if (!DECISION_WORDS.test(s)) continue;
    if (NOT_A_DECISION.some((r) => r.test(s))) continue;
    out.push(raw.trim().slice(0, 120));
  }
  return { lines: out, hasLocator: span !== null };
}

/* The nine rows whose claim was already false when this check landed (2026-09-22). DEBT, not
   approval: each is owed an adoption with its own criterion, and the ratchet may only SHRINK — a
   row that stops emitting, or that leaves `word-only`, reds until it is removed here. */
export const WO_CLAIM_RATCHET = new Set([
  /* ⚠️ EMPTY, and that is the finished state — residue `2026-09-22-word-only-claims-go-stale`
     closed here. It held the nine `word-only` rows measured to still print a decision about data on
     a reachable path; each was owed an adoption with its OWN criterion, because mutants, claims,
     nights and kappa are four different populations and a shared bar would have got one of them
     wrong. All nine adopted: pat-window-oracle, pb-agreement (#2888), buzz-fiducial-correlate
     (#2894), formula-constant-audit (#2899), pat-residual-structure, pat-fiducial-jitter (#2903),
     probe-clock-equivalence (#2908), probe-equivalence (#2910), beat-leg-closure (this PR).

     KEPT AT ZERO RATHER THAN DELETED: the ratchet may only shrink, so an empty set is a floor —
     `checkWordOnlyClaim` still reds if a NEW word-only row starts emitting, and there is now no
     allowlist to hide it in.

     ⚠️ The check keys on EMISSION, never on the reason text, and `beat-leg-closure` is why: its row
     carried a rewritten "prose inside code" reason rather than the copy-pasted one, so a sweep over
     the 47 duplicated strings would have found the other eight and left exactly that one asserting
     something its source had stopped supporting. */
]);

/** Judge every `word-only` row that CLAIMS nothing is emitted. Returns the population as an
 *  EQUALITY (checked + conceded = word-only rows) so a row moving between reason-classes moves the
 *  numbers rather than sliding out of view. PURE — `readSource(p)` is injected. */
export function checkWordOnlyClaim(manifest, readSource, ratchet = WO_CLAIM_RATCHET) {
  const rows = (manifest && manifest.producers) || {};
  const wordOnly = Object.keys(rows)
    .filter((p) => rows[p] && rows[p].bin === 'word-only')
    .sort();
  const claims = wordOnly.filter((p) => CLAIM_REASONS.some((c) => (rows[p].reason || '').includes(c)));
  const conceded = wordOnly.filter((p) => !claims.includes(p));
  const errors = [];
  const flagged = [];
  let noLocator = 0;
  for (const p of claims) {
    const src = readSource(p);
    if (src == null) {
      errors.push(`${p}: word-only row whose source could not be read — an unreadable claim is not a held claim`);
      continue;
    }
    const e = emittedDecisionLines(src, p.endsWith('.py'));
    if (!e.hasLocator) noLocator++;
    if (e.lines.length === 0) {
      if (ratchet.has(p)) errors.push(`${p}: no longer emits a decision — REMOVE it from WO_CLAIM_RATCHET (the ratchet may only go down)`);
      continue;
    }
    flagged.push({ path: p, lines: e.lines });
    if (!ratchet.has(p)) errors.push(`${p}: its row claims no emitted verdict ("${(rows[p].reason || '').slice(0, 48)}…") but it PRINTS a decision outside its selftest — ${e.lines[0]}`);
  }
  for (const p of ratchet) if (!claims.includes(p)) errors.push(`${p}: in WO_CLAIM_RATCHET but is not a word-only row claiming no emission — remove the stale entry`);
  return { ok: errors.length === 0, errors, checked: claims.length, conceded: conceded.length, wordOnly: wordOnly.length, noLocator, flagged };
}

/* ── A WORD-ONLY ROW ALSO ASSERTS A NEGATIVE THE GATE CAN TEST DIRECTLY: NO VERDICT OBJECT ────────
   `checkWordOnlyClaim` above reads for decision WORDS on a print line. A producer that starts emitting
   a real `tepna.verdict/1` OBJECT does not have to print one: residue
   `2026-10-11-word-only-bin-exempts-a-producer-from-object-validation` measured it on
   `tools/geometry-scan.mjs` — #3402 made it build and write a verdict object, its row still read
   `word-only` / "verdict words appear only in comments", and this gate stayed GREEN, because a
   word-only row is exempt from the object checks and nothing tested the bin's own negative. The row
   was re-binned only because a human read the manifest.

   So the negative is tested on its own terms: outside its selftest body, a `word-only` producer must
   not CONSTRUCT a verdict object — a literal `schema: 'tepna.verdict/1'`, or a call to a builder
   (`makeVerdict(`, `Verdict.make(`, `V.make(`, `verdict.make(`, `verdict_object(`). A DEFINITION of a
   builder is not a call (the shared libraries `verdict-emit.mjs` / `verdict.py` define, they do not
   emit), a comment is not a construction, and a selftest may build objects to feed a validator.
   Applies to EVERY word-only row, claiming or conceding: conceding that words are printed is not
   conceding that a decision OBJECT is. ⚠️ STATIC, so a producer that delegates the build to another
   module is outside what this can see — that blind spot is named here rather than implied away.
   Measured on the tree this landed on: 0 of 83 word-only rows construct one. */
const BUILDS_OBJECT = [/\bschema['"]?\s*[:=]\s*['"]tepna\.verdict\/1['"]/, /(?<!function\s)\bmakeVerdict\s*\(/, /\b(?:Verdict|V|verdict|VERDICT)\.make\s*\(/, /(?<!def\s)\bverdict_object\s*\(/];

/** Lines where the source CONSTRUCTS a tepna.verdict/1 object outside its selftest body. PURE. */
export function verdictObjectLines(src, isPy) {
  const span = selftestSpan(src, isPy);
  const scanned = span ? src.slice(0, span[0]) + src.slice(span[1]) : src;
  const out = [];
  for (const raw of scanned.split('\n')) {
    const s = raw.trim();
    if (/^(\/\/|\/\*|\*|#)/.test(s)) continue;
    if (BUILDS_OBJECT.some((r) => r.test(s))) out.push(s.slice(0, 120));
  }
  return out;
}

/* ── THE HOP A STATIC LINE SCAN CANNOT SEE: A BUILDER IMPORTED FROM ANOTHER MODULE ───────────────
   The comment above names its own blind spot, and row
   `2026-10-28-the-word-only-bin-misses-a-verdict-built-by-an-imported-helper` asks for it closed.
   `publicationOf` has read a one-hop imported builder since the enumeration was written; the OBJECT
   half never did, so a producer that delegated the build sat in the bin exempt from object validation.

   Measured 2026-10-30: 9 of the 50 word-only rows call a verdict-named builder they import, outside
   their selftest. EIGHT publish a real object through `populationVerdict@tools/corpus-scope-core.mjs`.
   The ninth is the control, and it is why a NAME cannot decide this: `tools/rebase-safe.mjs` calls
   `extractVerdicts@tools/pr-compliance.mjs`, which PARSES objects out of a PR body and constructs none.

   So the hop is a publication only when the callee CONSTRUCTS, and `builderConstructs` reads the
   callee's own DEFINITION rather than its file — a file that builds somewhere says nothing about the
   function this producer calls. It answers in THREE states, because a scanner that cannot resolve a
   call has not proven absence (§∅):
     true     the body constructs, directly or through a call it resolved
     false    every call resolved and none constructs — a proven reader
     unknown  nothing constructed, and a bare call stayed unresolved
   The gate reads `unknown` as a publication. A false red names a tool to re-bin; a false green hides
   an unvalidated verdict, which is the defect the row is about.

   ⚠️ ONE LIMIT STAYS NAMED RATHER THAN IMPLIED AWAY: the contract reached under a LOCAL ALIAS
   (`_v.make(`, `VD.make(`) is outside `BUILDS_OBJECT`'s four patterns, so a builder that publishes
   that way reads `unknown` here instead of `true`. Measured 2026-10-30: 22 producers call it under
   such a name and NOT ONE is word-only, so no bin turns on it today; the widening travels on row
   `2026-10-30-the-object-detector-cannot-name-an-aliased-contract-import`. */

/** One function definition's own body, or null when it cannot be located. PURE. `isPy` picks the
 *  syntax. Returns `{ text, code }`: `text` keeps strings, because a constructed object IS a string
 *  literal (`schema: 'tepna.verdict/1'`); `code` blanks them, because prose is not a call. */
export function functionBody(src, name, isPy) {
  if (src == null || !/^[A-Za-z_$][\w$]*$/.test(name)) return null;
  if (isPy) {
    const lines = blankPyComments(src).split('\n');
    const re = new RegExp(`^([ \\t]*)def\\s+${name}\\s*\\(`);
    let start = -1;
    let indent = 0;
    for (const [i, line] of lines.entries()) {
      const m = re.exec(line);
      if (m) {
        start = i;
        indent = m[1].length;
        break;
      }
    }
    if (start < 0) return null;
    const body = [lines[start]];
    for (const line of lines.slice(start + 1)) {
      if (line.trim() && line.search(/\S/) <= indent) break;
      body.push(line);
    }
    const text = body.join('\n');
    return { text, code: blankPyStrings(text) };
  }
  const bare = blankComments(src);
  const cls = classify(src);
  const esc = name.replace(/\$/g, '\\$');
  for (const re of [new RegExp(`function\\s+${esc}\\s*\\(`, 'g'), new RegExp(`(?:const|let|var)\\s+${esc}\\s*=\\s*(?:async\\s+)?(?:function\\s*)?\\(`, 'g')]) {
    for (const m of bare.matchAll(re)) {
      if (cls[m.index] !== CLS_CODE) continue;
      /* WALK THE PARAMETER LIST FIRST. A destructured parameter opens a brace before the body does, so
         matching from the first `{` after the name returns the SIGNATURE — measured on
         `populationVerdict`, whose `{ commit = null, … } = {}` parameter read as its whole body and
         made the one real constructor in the measured set look like a reader. */
      let i = m.index + m[0].length - 1;
      let depth = 0;
      for (; i < bare.length; i += 1) {
        if (cls[i] !== CLS_CODE) continue;
        if (bare[i] === '(') depth += 1;
        else if (bare[i] === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      /* Only whitespace or an arrow may stand between the parameter list and the body. Anything else
         (an expression-bodied arrow, a type annotation) is a body this cannot delimit, so it says so. */
      let open = -1;
      for (let j = i + 1; j < bare.length; j += 1) {
        if (cls[j] !== CLS_CODE) continue;
        if (bare[j] === '{') {
          open = j;
          break;
        }
        if (/[\s=>]/.test(bare[j])) continue;
        break;
      }
      if (open === -1) continue;
      depth = 0;
      for (let j = open; j < bare.length; j += 1) {
        if (cls[j] !== CLS_CODE) continue;
        if (bare[j] === '{') depth += 1;
        else if (bare[j] === '}') {
          depth -= 1;
          if (depth !== 0) continue;
          const text = bare.slice(open, j + 1);
          let code = '';
          for (let k = open; k <= j; k += 1) code += cls[k] === CLS_CODE ? bare[k] : bare[k] === '\n' ? '\n' : ' ';
          return { text, code };
        }
      }
    }
  }
  return null;
}

/** Every BARE identifier called in a body. A method call carries a dot and belongs to its object. PURE. */
export function bareCalls(code) {
  const out = new Set();
  for (const m of code.matchAll(/(^|[^\w.$])([A-Za-z_$][\w$]*)\s*\(/g)) out.add(m[2]);
  return out;
}

/* A call can wear one of these names without naming a definition in this repo: the two languages'
   ambient objects and the keywords that precede a parenthesis. Not an allowlist of safe behaviour —
   none of them can construct a tepna.verdict/1 object, and leaving them out would make every body
   `unknown`, which would make the three states one. */
const AMBIENT_CALLS = new Set(
  (
    'String Number Boolean Object Array JSON Math Date Set Map WeakMap WeakSet RegExp Error TypeError RangeError Promise BigInt Symbol Proxy Reflect Intl isNaN isFinite parseInt parseFloat require fetch structuredClone queueMicrotask setTimeout setInterval clearTimeout encodeURIComponent decodeURIComponent ' +
    'if for while switch catch return typeof function await new delete void throw yield else do ' +
    'len str int float bool dict list tuple set frozenset bytes bytearray sorted reversed min max sum abs round pow divmod enumerate range any all isinstance issubclass getattr hasattr setattr delattr open print repr zip map filter type super iter next id hash vars dir callable chr ord format eval exec ' +
    'elif not and or in is lambda except with class def assert raise del global nonlocal pass import from as try finally break continue match case async'
  ).split(' ')
);

/** Does the builder `name` CONSTRUCT a verdict object? `true` | `false` | `'unknown'`. PURE — the
 *  builder map and `readSource(p)` are injected, so the selftest plants a tree. */
export function builderConstructs(name, builders, readSource, seen = new Set()) {
  const file = builders && builders.get(name);
  if (!file) return 'unknown';
  return constructsIn(file, name, builders, readSource, seen);
}

function constructsIn(file, name, builders, readSource, seen) {
  const key = `${file}::${name}`;
  if (seen.has(key)) return false; // a cycle adds no construction of its own
  seen.add(key);
  const src = readSource(file);
  if (src == null) return 'unknown';
  const isPy = file.endsWith('.py');
  const body = functionBody(src, name, isPy);
  if (body == null) return 'unknown'; // the definition could not be delimited — not a proven absence
  if (BUILDS_OBJECT.some((r) => r.test(body.text))) return true;
  let unknown = false;
  for (const call of bareCalls(body.code)) {
    if (call === name || AMBIENT_CALLS.has(call)) continue;
    const local = functionBody(src, call, isPy) ? file : null;
    const hop = !local && builders.has(call) && importedNames(bareSource(src, isPy), isPy).has(call) ? builders.get(call) : null;
    if (!local && !hop) {
      unknown = true;
      continue;
    }
    const r = constructsIn(local ?? hop, call, builders, readSource, seen);
    if (r === true) return true;
    if (r === 'unknown') unknown = true;
  }
  return unknown ? 'unknown' : false;
}

/* The ONE shared builder: `tools/verdict-emit.mjs` exists to construct the object on behalf of every
   adopter (`makeVerdict`, `aggregateChildren`), and its row says so. It is a library whose callers
   emit, not a producer, so it is named here, by path, rather than excused by a pattern. A listed
   path that is no longer a word-only row, or no longer builds, reds — the list cannot go stale. */
export const OBJECT_BUILDER_LIBRARIES = new Set(['tools/verdict-emit.mjs']);

/** Judge every `word-only` row: it must not construct a verdict object. PURE — `readSource(p)` injected. */
export function checkWordOnlyObject(manifest, readSource, libraries = OBJECT_BUILDER_LIBRARIES, builders = new Map()) {
  const rows = (manifest && manifest.producers) || {};
  const wordOnly = Object.keys(rows)
    .filter((p) => rows[p] && rows[p].bin === 'word-only')
    .sort();
  const errors = [];
  const flagged = [];
  const hops = [];
  for (const p of wordOnly) {
    const src = readSource(p);
    if (src == null) {
      errors.push(`${p}: word-only row whose source could not be read — an unreadable bin is not a held negative`);
      continue;
    }
    const lines = verdictObjectLines(src, p.endsWith('.py'));
    if (libraries.has(p)) {
      if (!lines.length) errors.push(`${p}: in OBJECT_BUILDER_LIBRARIES but no longer constructs an object — remove the stale entry`);
      continue;
    }
    if (lines.length) {
      flagged.push({ path: p, lines });
      errors.push(
        `${p}: binned word-only (exempt from object validation) but it CONSTRUCTS a tepna.verdict/1 object outside its selftest — ${lines[0]} — re-bin it \`decides\` with an \`emits\` the gate can run`
      );
      continue;
    }
    /* THE DELEGATED BUILD, one hop, and only to a builder that constructs (or that this cannot clear). */
    const bare = bareSource(src, p.endsWith('.py'));
    const span = selftestSpan(bare, p.endsWith('.py'));
    const outside = span ? bare.slice(0, span[0]) + bare.slice(span[1]) : bare;
    for (const n of [...importedNames(bare, p.endsWith('.py'))].sort()) {
      if (!builders.has(n) || !new RegExp(`\\b${n}\\s*\\(`).test(outside)) continue;
      const st = builderConstructs(n, builders, readSource);
      if (st === false) continue;
      hops.push({ path: p, builder: n, from: builders.get(n), state: st });
      errors.push(
        `${p}: binned word-only (exempt from object validation) but outside its selftest it calls \`${n}()\` from ${builders.get(n)}, which ${st === true ? 'CONSTRUCTS' : 'may construct (unresolved call — §∅: not a proven absence)'} a tepna.verdict/1 object — re-bin it \`decides\` with an \`emits\` the gate can run`
      );
      break;
    }
  }
  for (const p of libraries) if (!wordOnly.includes(p)) errors.push(`${p}: in OBJECT_BUILDER_LIBRARIES but is not a word-only row — remove the stale entry`);
  return { ok: errors.length === 0, errors, checked: wordOnly.length, flagged, hops };
}

/* Pure: judge the decides set against the ratchet. Returns { ok, errors[], gated, ungated }. */
export function checkGated(manifest, readSource, testRefs, ratchet = UNGATED_RATCHET) {
  const errors = [];
  const rows = (manifest && manifest.producers) || {};
  const decides = Object.keys(rows)
    .filter((p) => rows[p] && rows[p].bin === 'decides')
    .sort();
  const gated = {};
  const ungated = [];
  for (const p of decides) {
    const g = gatedBy(p, readSource, testRefs);
    if (g) {
      gated[p] = g;
      if (ratchet.has(p)) errors.push(`${p}: now GATED (${g}) — REMOVE it from UNGATED_RATCHET (the ratchet may only go down)`);
    } else {
      ungated.push(p);
      if (!ratchet.has(p))
        errors.push(
          `${p}: a \`decides\` producer with NO test — no --selftest and nothing under tests/ or capture-host/tests/ names it. A check with no test is the #2321 shape; add its selftest (or a test) in the same PR that bins it`
        );
    }
  }
  for (const p of ratchet) if (!decides.includes(p)) errors.push(`${p}: in UNGATED_RATCHET but not a \`decides\` producer — remove the stale entry`);
  return { ok: errors.length === 0, errors, gated, ungated, decides: decides.length };
}

/* ── ADOPTION IS A RATCHET — a population equality over the base's `adopted` set ─────────────────
   Pure. `baseManifest` is the manifest at the merge base, `headManifest` the tree's, `fileExists(p)`
   answers for the HEAD tree. Returns { ok, errors[], adoptedAtBase, kept, retired, deAdopted[] } with
   adoptedAtBase === kept + retired.length + deAdopted.length. */
export function checkRatchet(baseManifest, headManifest, fileExists) {
  const base = (baseManifest && baseManifest.producers) || {};
  const head = (headManifest && headManifest.producers) || {};
  const adopted = Object.keys(base)
    .filter((p) => base[p] && base[p].status === 'adopted')
    .sort();
  const errors = [];
  const retired = [];
  const deAdopted = [];
  let kept = 0;
  for (const p of adopted) {
    const h = head[p];
    if (h && h.status === 'adopted') {
      kept++;
      continue;
    }
    if (!h && !fileExists(p)) {
      retired.push(p); // the tool left the tree with its row — not a de-adoption
      continue;
    }
    deAdopted.push(p);
    errors.push(
      `${p}: ADOPTED on the base and ${h ? `${JSON.stringify(h.bin)}/${JSON.stringify(h.status)}` : 'ABSENT'} here while the file still exists — ` +
        'adoption is a ratchet. This is the #2888 shape: a whole-file manifest conflict resolved mine-vs-main reverts the other side; ' +
        'compute both deltas from the merge base (header) and restore the row'
    );
  }
  return { ok: errors.length === 0, errors, adoptedAtBase: adopted.length, kept, retired, deAdopted };
}

/* ── THE CONTRIBUTIONS LEG — the population is a BRIEF TABLE, read at every run ─────────────────
   `tepna.verdict/1` gained an optional `contributions` block (VERDICT-CONTRIBUTIONS-2026-10-04 §1):
   a fused figure names the inputs that moved it, and refuses to invent a denominator. §2 of that
   brief names the five figures that must publish it. That TABLE is the population, not a list in
   this file: a figure added there with no row here reds, and a row here for no figure there reds.
   Neither side can drift quietly, and a hand-kept second copy of a population is how a gate comes
   to examine nothing.

   `verdict.js` owns the method set. The copy here lets the gate judge a manifest before it loads
   anything, and main() reds on a divergence once `verdict.js` exports its own. */
export const CONTRIBUTION_METHODS = ['leave-one-out', 'analytic', 'decomposition'];
const SINCE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* The §2 table, parsed from the brief's own bytes → [{ figure, file, method }] in table order.
   A heading rename or a reflow yields 0 rows, and the caller reds on that rather than passing an
   empty population. The file cell is `<path> <symbol>` and the method cell `<method> over <axis>`,
   so each takes the first backticked token. */
export function parseContributionSet(briefSrc) {
  const lines = String(briefSrc || '').split('\n');
  const start = lines.findIndex((l) => /^##\s+2\s+·\s+Adoption set/.test(l));
  if (start < 0) return [];
  const tick = (c) => {
    const m = /`([^`]+)`/.exec(c);
    return m ? m[1].trim() : '';
  };
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^##\s/.test(l)) break;
    if (!/^\|/.test(l)) continue;
    const cells = l
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 3) continue;
    if (cells[0] === 'figure' || /^-+$/.test(cells[0].replace(/[\s:]/g, ''))) continue;
    rows.push({ figure: cells[0], file: tick(cells[1]).split(/\s+/)[0], method: tick(cells[2]) });
  }
  return rows;
}

/* Pure. `manifest.contributions.figures` against that table, both ways. `validator` and `runner`
   are the CLI's; without them an `adopted` row is checked for shape alone (the pure core).
   An adopted figure must EMIT an object whose validate() EXAMINED a contributions block: a
   validator that never looked at one is a pass over something never read, which is the §4b family
   and the reason `checked` exists. Returns { ok, errors[], counts }. */
export function checkContributions(manifest, briefSrc, validator, runner) {
  const errors = [];
  const unexamined = [];
  const block = (manifest && manifest.contributions) || {};
  const rows = block.figures || {};
  const table = parseContributionSet(briefSrc);
  const counts = { table: table.length, figures: Object.keys(rows).length, adopted: 0, pending: 0, read: 0, examined: 0 };
  if (!table.length) {
    errors.push(`contributions: the named set is ${JSON.stringify(block.enumeratedFrom || '(unset)')} and its §2 table read as 0 figures — a population that reads empty examines nothing`);
    return { ok: false, errors, unexamined, counts };
  }
  const inTable = new Map(table.map((t) => [t.figure, t]));
  const named = Object.keys(rows).sort();
  for (const t of table) if (!rows[t.figure]) errors.push(`contributions: the §2 table names "${t.figure}" and this manifest has no row for it — add one (status "pending" is honest)`);
  for (const f of named) if (!inTable.has(f)) errors.push(`contributions: the row "${f}" matches no figure in the §2 table — the brief is the population, so drop the row or add the figure there`);
  for (const f of named) {
    const r = rows[f] || {};
    const t = inTable.get(f);
    if (!t) continue;
    if (r.file !== t.file) {
      errors.push(`contributions: "${f}" sits at ${JSON.stringify(r.file)} here and at ${JSON.stringify(t.file)} in the §2 table`);
      continue;
    }
    if (!CONTRIBUTION_METHODS.includes(r.method)) {
      errors.push(`contributions: "${f}" method must be one of ${CONTRIBUTION_METHODS.join('|')}, got ${JSON.stringify(r.method)}`);
      continue;
    }
    if (r.method !== t.method) {
      errors.push(`contributions: "${f}" declares method ${JSON.stringify(r.method)} and the §2 table says ${JSON.stringify(t.method)}`);
      continue;
    }
    if (!['pending', 'adopted'].includes(r.status)) {
      errors.push(`contributions: "${f}" carries status pending|adopted, got ${JSON.stringify(r.status)}`);
      continue;
    }
    if (!SINCE_DATE.test(String(r.since))) {
      errors.push(`contributions: "${f}" needs \`since\` as YYYY-MM-DD, got ${JSON.stringify(r.since)} — an undated row cannot be read as debt`);
      continue;
    }
    counts[r.status]++;
    if (r.status !== 'adopted') continue;
    if (!r.emits || (!Array.isArray(r.emits.cmd) && typeof r.emits.file !== 'string')) {
      errors.push(`contributions: "${f}" is adopted without \`emits\` ({cmd:[…]} printing the object, or {file}) — an adoption the gate cannot read is a claim`);
      continue;
    }
    const te = timeoutMsError(`contributions: "${f}"`, r.emits);
    if (te) {
      errors.push(te);
      continue;
    }
    if (!validator || !runner) continue; // the pure core; the CLI passes both
    let obj;
    try {
      obj = runner(r.emits);
    } catch (e) {
      if (e && e.unexamined) {
        unexamined.push({ path: `contributions: "${f}"`, ...e, message: String(e.message || e) });
        continue;
      }
      errors.push(`contributions: "${f}" emits could not be read — ${String(e.message || e).slice(0, 120)}`);
      continue;
    }
    counts.read++;
    const v = validator(obj);
    if (!v.ok) {
      errors.push(`contributions: "${f}" emits an object that is NOT a valid tepna.verdict/1 — ${v.errors.slice(0, 3).join(' | ')}`);
      continue;
    }
    if (!(Array.isArray(v.checked) && v.checked.includes('contributions'))) {
      errors.push(`contributions: "${f}" is adopted and its object is valid, but validate() examined NO contributions block — the figure publishes none, or this verdict.js predates the field`);
      continue;
    }
    counts.examined++;
  }
  return { ok: errors.length === 0, errors, unexamined, counts };
}

/* The base manifest, read from git at `merge-base HEAD <baseRef>`. Mirrors tools/residue-ids.mjs:
   a shallow clone or an unresolvable base REFUSES (exit 2) rather than comparing against nothing —
   a ratchet judged against an empty base reports 0 de-adoptions because it sees 0 adoptions. */
function baseManifestAt(root, baseRef) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const refuse = (msg, detail) => {
    process.stderr.write(`verdict-adoption: REFUSING — ${msg}\n`);
    for (const d of detail) process.stderr.write(`  ${d}\n`);
    process.exit(2);
  };
  if (git(['rev-parse', '--is-shallow-repository']).trim() === 'true') {
    refuse('shallow clone, the base manifest is not present.', ['The ratchet would report 0 de-adoptions because it sees 0 adoptions. Set `fetch-depth: 0` on actions/checkout.']);
  }
  let mergeBase;
  try {
    git(['rev-parse', '--verify', baseRef]);
    mergeBase = git(['merge-base', 'HEAD', baseRef]).trim() || baseRef;
  } catch {
    refuse(`cannot resolve base ref \`${baseRef}\`.`, ['Fetch it (`git fetch origin main`) or pass --base <ref>.']);
  }
  let text;
  try {
    text = git(['show', `${mergeBase}:tools/verdict-adoption.json`]);
  } catch {
    refuse(`tools/verdict-adoption.json does not exist at the merge base ${mergeBase.slice(0, 12)}.`, [
      'The manifest has been committed since the adoption wave began; pass --base <a ref that carries it>.'
    ]);
  }
  return { mergeBase, manifest: JSON.parse(text) };
}

function treeReaders(root) {
  const readSource = (p) => {
    try {
      return fs.readFileSync(path.join(root, p), 'utf8');
    } catch (_) {
      return null;
    }
  };
  const testRefs = (stem) => {
    try {
      return execFileSync('git', ['grep', '-l', '-e', stem, '--', 'tests/', 'capture-host/tests/'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .split('\n')
        .filter(Boolean);
    } catch (e) {
      if (e.status === 1) return [];
      throw e;
    }
  };
  return { readSource, testRefs };
}

/* An emitter whose stdout is a LARGER payload carrying the object under a key (tests/run-tests.mjs
   --json: `{ totalGroups, groups, verdict, … }`) names it as `emits.key`; the gate then validates
   THAT object. Absent key ⇒ the whole payload is the object. A named key that is missing is a read
   failure, never a silent pass over the wrapper. */
export function pickEmitted(payload, emits) {
  if (!emits || !emits.key) return payload;
  if (!payload || typeof payload !== 'object' || !(emits.key in payload)) throw new Error(`emits.key "${emits.key}" is not in the payload`);
  return payload[emits.key];
}

/* ── THE CHILD CAP, AND WHY A TIMEOUT IS NOT A FAILED ADOPTION ─────────────────────────────────
   Residue `2026-10-27-a-fixed-spawn-timeout-makes-a-gate-step-red-under-box-load`: this spawn
   carried a fixed 120 s cap for every producer. `tools/xerj-load.mjs --dry-run --json` walks 6455
   cached items and took 1 m 48.7 s at load average 44 on 24 cores, so the margin was 11 seconds and
   any peer's long job closed it. The run then red at step 38 of 41 and `npm run check` left steps 39
   to 41 unrun — a FAIL about a producer nobody read, which is §4b's family and the same conflation
   the contract names in `find_unwired.py` (exit 1 for a finding AND for a crash).

   ⚠️ A CAP IS NOT A PERFORMANCE TARGET. It is the point past which a run is no longer believed to be
   running — the rule `tools/workflow-timeout-guard.mjs` states for CI jobs, applied to a child here.
   SAMPLE 2026-10-28, rig-x870 at load average 5.9 to 7.4, every adopted producer timed in one pass:
   n = 167, median 22 ms, p90 114 ms, p95 995 ms, and 166 of them at most 6.4 s. ONE outlier,
   `tools/xerj-load.mjs` at 25.5 s idle against 108.7 s at load 44, a 4.3x stretch. So the default
   below stands three orders of magnitude above the population it governs, and the outlier declares
   its own `emits.timeoutMs` rather than dragging every other producer's cap up with it. */
export const DEFAULT_EMITS_TIMEOUT_MS = 120_000;
export const MAX_EMITS_TIMEOUT_MS = 900_000;

/* The cap this entry runs under. Pure, so the shape leg and the runner read one rule. An absent or
   malformed value falls back to the default HERE and reds in the shape leg below — a cap is not the
   place to refuse, because refusing on it would turn a typo into the unexamined state it exists to
   report. */
export function emitsTimeoutMs(emits) {
  const t = emits && emits.timeoutMs;
  return Number.isInteger(t) && t > 0 && t <= MAX_EMITS_TIMEOUT_MS ? t : DEFAULT_EMITS_TIMEOUT_MS;
}

/* The shape rule for a declared cap, read by both check legs so one message exists. */
export function timeoutMsError(where, emits) {
  const t = emits && emits.timeoutMs;
  if (t === undefined) return null;
  if (Number.isInteger(t) && t > 0 && t <= MAX_EMITS_TIMEOUT_MS) return null;
  return `${where}: emits.timeoutMs must be a whole number of milliseconds in 1..${MAX_EMITS_TIMEOUT_MS}, got ${JSON.stringify(t)} — an unreadable cap would silently become the ${DEFAULT_EMITS_TIMEOUT_MS} ms default`;
}

/* A producer that hit its cap was NEVER READ. The flag is the whole point: the caller routes this
   away from `errors` into `unexamined`, so "this adoption is invalid" and "the box was busy" stop
   arriving on the same wire. */
export function unexaminedTimeout(fields) {
  const e = new Error(`no object after ${fields.capMs} ms (the cap) at load ${fields.load1}`);
  e.unexamined = true;
  return Object.assign(e, fields);
}

/* Read what an adopted producer emits: run its cmd (stdout must be the object, or a payload carrying
   it under `emits.key`) or read its file. Exported for the selftest: the cap's DETECTION is the half
   a pure routing test cannot reach, and it is the half the row was written about. */
export function runEmits(emits, root) {
  let text;
  if (Array.isArray(emits.cmd)) {
    const capMs = emitsTimeoutMs(emits);
    const t0 = Date.now();
    const r = spawnSync(emits.cmd[0], emits.cmd.slice(1), { cwd: root, encoding: 'utf8', timeout: capMs, maxBuffer: 64 << 20 });
    const elapsedMs = Date.now() - t0;
    /* spawnSync reports a cap hit as `error.code === 'ETIMEDOUT'` and kills with SIGTERM; a SIGTERM
       from anywhere else (a peer's cleanup, the harness watchdog of §4c) is equally a run nobody
       read, so both land here. */
    if (r.error ? r.error.code === 'ETIMEDOUT' : r.signal === 'SIGTERM')
      throw unexaminedTimeout({ capMs, elapsedMs, load1: Math.round(os.loadavg()[0] * 100) / 100, cmd: emits.cmd.join(' '), signal: r.signal || null });
    if (r.error) throw r.error;
    text = r.stdout;
  } else text = fs.readFileSync(path.join(root, emits.file), 'utf8');
  const first = text.indexOf('{');
  return pickEmitted(JSON.parse(text.slice(first)), emits);
}

/* First-pass triage: for each unbinned file, where the words occur (code vs comment lines) and a sample,
   so the human bins with evidence rather than memory. Writes nothing. */
export function triage(root, files) {
  const out = [];
  for (const p of files) {
    const src = fs.readFileSync(path.join(root, p), 'utf8').split('\n');
    let code = 0;
    let comment = 0;
    const samples = [];
    src.forEach((line, i) => {
      if (!WORDS.test(line)) return;
      const s = line.trim();
      const isComment = p.endsWith('.py') ? s.startsWith('#') : s.startsWith('//') || s.startsWith('*') || s.startsWith('/*');
      if (isComment) comment++;
      else {
        code++;
        if (samples.length < 3) samples.push(`${i + 1}: ${s.slice(0, 110)}`);
      }
    });
    const json = /--json/.test(src.join('\n'));
    const suggest = p.includes('/tests/') || /\/test_[^/]+\.py$/.test(p) ? 'test' : code === 0 ? 'word-only (comments only)' : json ? 'already-json' : 'decides?';
    out.push({ path: p, code, comment, json, suggest, samples });
  }
  return out;
}

function selftest() {
  const fails = [];
  let ran = 0;
  const ok = (c, m) => {
    ran += 1;
    if (!c) fails.push(m);
  };
  const V = createRequire(import.meta.url)(path.join(ROOT, 'verdict.js'));
  const good = V.make({
    gate: 'g',
    status: 'PASS',
    population: { checked: 1, eligible: 1, excluded: 0 },
    criterion: { name: 'x', threshold: 1, unit: '', direction: 'lte' },
    result: { x: 0 },
    evidence: ['a'],
    producedBy: { tool: 't', commit: 'abcdef1' }
  });
  const runner = (e) =>
    e.file === 'good.json'
      ? good
      : e.file === 'bad.json'
        ? { schema: 'tepna.verdict/1', status: 'PASSED' }
        : (() => {
            throw new Error('unreadable');
          })();
  const M = (producers) => ({ schema: 'tepna.verdict-adoption/1', producers });
  // equality both ways
  let r = check(['tools/a.mjs', 'tools/b.mjs'], M({ 'tools/a.mjs': { bin: 'word-only', reason: 'label', status: 'exempt' } }), V.validate, runner);
  ok(!r.ok && r.errors.some((e) => /UNBINNED producer: tools\/b.mjs/.test(e)), 'an enumerated producer missing from the manifest is a red WITH ITS NAME');
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'word-only', reason: 'label', status: 'exempt' }, 'tools/gone.mjs': { bin: 'decides', status: 'pending' } }), V.validate, runner);
  ok(!r.ok && r.errors.some((e) => /STALE row: tools\/gone.mjs/.test(e)), 'a manifest row for a non-producer is a red with its name');
  // exemptions need reasons
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'word-only', status: 'exempt' } }), V.validate, runner);
  ok(!r.ok && /without a reason/.test(r.errors[0]), 'word-only without a reason is a red');
  ok(check(['capture-host/tests/test_x.py'], M({ 'capture-host/tests/test_x.py': { bin: 'test', status: 'exempt' } }), V.validate, runner).ok, 'a test file is exempt by class, no reason needed');
  // adoption is READ, never believed
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'decides', status: 'adopted' } }), V.validate, runner);
  ok(!r.ok && /adopted without `emits`/.test(r.errors[0]), 'adopted without emits is a claim, red');
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'decides', status: 'adopted', emits: { file: 'good.json' } } }), V.validate, runner);
  ok(r.ok && r.counts.validated === 1 && r.counts.adopted === 1, 'adopted + a valid emitted object → green, counted as validated');
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'decides', status: 'adopted', emits: { file: 'bad.json' } } }), V.validate, runner);
  ok(!r.ok && /NOT a valid tepna.verdict\/1/.test(r.errors[0]) && /no eighth value/.test(r.errors[0]), 'adopted but the object is invalid → red naming the validator error');
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'decides', status: 'adopted', emits: { file: 'missing.json' } } }), V.validate, runner);
  ok(!r.ok && /could not be read/.test(r.errors[0]), 'adopted but unreadable → red, not silently green');
  /* ── THE CAP: A PRODUCER NOBODY READ IS NOT A FAILED ADOPTION ───────────────────────────────
     Residue 2026-10-27-a-fixed-spawn-timeout-makes-a-gate-step-red-under-box-load. Both halves are
     here: the DETECTION (a real child outliving a real cap) and the ROUTING (where that lands). */
  {
    const timedOut = () => {
      throw unexaminedTimeout({ capMs: 120000, elapsedMs: 120004, load1: 44.1, cmd: 'node tools/slow.mjs --json' });
    };
    const row = { bin: 'decides', status: 'adopted', emits: { cmd: ['node', 'tools/slow.mjs', '--json'] } };
    r = check(['tools/a.mjs'], M({ 'tools/a.mjs': row }), V.validate, timedOut);
    ok(r.ok && r.errors.length === 0, 'a producer that hit its cap is NOT a red — the run examined nothing about it, so it found nothing wrong');
    ok(r.unexamined.length === 1 && r.unexamined[0]?.path === 'tools/a.mjs' && r.counts.unexamined === 1, '…it lands in `unexamined` by name, and the count says how many');
    ok(
      r.unexamined[0]?.capMs === 120000 && r.unexamined[0]?.load1 === 44.1 && /120000 ms/.test(r.unexamined[0]?.message || ''),
      '…carrying the cap and the box load, so the reader can tell contention from a broken producer'
    );
    ok(r.counts.validated === 0, '…and it is NEVER counted as validated: checked and excluded stay separate (§🧾)');
    r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'decides', status: 'adopted', emits: { file: 'missing.json' } } }), V.validate, runner);
    ok(!r.ok && r.unexamined.length === 0, 'CONTROL — an ordinary read failure still reds and never hides in `unexamined`');
  }
  // the declared cap: read where it is legal, red where it is not, and the producer is not run on a red
  {
    ok(emitsTimeoutMs({}) === DEFAULT_EMITS_TIMEOUT_MS && emitsTimeoutMs({ timeoutMs: 1500 }) === 1500, 'a declared cap is used and an absent one falls back to the default');
    ok(
      [0, -1, 1.5, '120000', null, MAX_EMITS_TIMEOUT_MS + 1].every((t) => emitsTimeoutMs({ timeoutMs: t }) === DEFAULT_EMITS_TIMEOUT_MS),
      'a malformed cap falls back rather than refusing — a typo must not become the state it reports'
    );
    ok(timeoutMsError('x', {}) === null && timeoutMsError('x', { timeoutMs: 1500 }) === null, '…and the shape leg passes an absent or legal cap');
    ok(
      [0, -1, 1.5, '120000', MAX_EMITS_TIMEOUT_MS + 1].every((t) => /emits.timeoutMs must be/.test(timeoutMsError('x', { timeoutMs: t }) || '')),
      '…and reds every malformed one, so the fallback is never silent'
    );
    let calls = 0;
    const counting = (e) => {
      calls += 1;
      return runner(e);
    };
    r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'decides', status: 'adopted', emits: { file: 'good.json', timeoutMs: -3 } } }), V.validate, counting);
    ok(!r.ok && /emits.timeoutMs must be/.test(r.errors[0]) && calls === 0, 'a malformed cap reds the row and the producer is never run — the shape is judged before the box is asked');
  }
  // DETECTION — a real child against a real cap, which is the half no routing test reaches
  {
    const slow = { cmd: [process.execPath, '-e', 'setTimeout(() => {}, 30000)'], timeoutMs: 250 };
    let caught = null;
    try {
      runEmits(slow, ROOT);
    } catch (e) {
      caught = e;
    }
    ok(caught && caught.unexamined === true, 'a child that outlives its cap throws the UNEXAMINED shape, not a bare ETIMEDOUT');
    ok(caught && caught.capMs === 250 && caught.elapsedMs >= 200 && typeof caught.load1 === 'number', '…with the cap, the elapsed time and the load on it');
    const quick = { cmd: [process.execPath, '-e', 'process.stdout.write(JSON.stringify({ schema: "tepna.verdict/1", status: "PASS" }))'], timeoutMs: 30000 };
    ok(runEmits(quick, ROOT).status === 'PASS', 'CONTROL — a child that answers inside its cap is read as it always was');
    const broken = { cmd: [process.execPath, '-e', 'process.stdout.write("not json")'], timeoutMs: 30000 };
    let e2 = null;
    try {
      runEmits(broken, ROOT);
    } catch (e) {
      e2 = e;
    }
    ok(e2 && !e2.unexamined, 'CONTROL — a child that answers with garbage is a read failure, never an unexamined one');
  }
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'decides', status: 'pending' } }), V.validate, runner);
  ok(r.ok && r.counts.pending === 1 && r.counts.validated === 0, 'pending is honest and green — the count says how many are still owed');
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'maybe' } }), V.validate, runner);
  ok(!r.ok && /bin must be one of/.test(r.errors[0]), 'an unknown bin is a red');
  ok(
    check([], M({}), V.validate, runner).ok && check([], M({}), V.validate, runner).counts.enumerated === 0,
    'an empty population against an empty manifest is trivially equal (and says enumerated 0)'
  );
  // every check is gated — a static population equality over the decides set, ratcheted
  {
    const M2 = M({ 'tools/a.mjs': { bin: 'decides', status: 'pending' }, 'tools/b.mjs': { bin: 'decides', status: 'pending' }, 'tools/c.mjs': { bin: 'word-only', status: 'exempt', reason: 'x' } });
    /* The test files are in this map too, because `gatedBy` now READS them: a ref counts only when the
       test names the tool outside its comments. `tests/real.js` exercises `b`, `tests/prose.js` only
       talks about it, and `capture-host/tests/test_p.py` does the same in the other comment syntax. */
    const src = {
      'tools/a.mjs': "if (argv.includes('--selftest')) selftest();",
      'tools/b.mjs': '// a check with no test at all',
      /* THE COMPOSED READ IS ASSEMBLED FROM FRAGMENTS, and the join is the point. The measured set in
         `tests/dex-tests.js` ("a documented flag is read by the tool that documents it") reads STRING
         literals as code, because a flag read IS a string — so a fixture that spelled the composed
         form verbatim made THIS tool look like a tool that reads a dynamic flag name, and that gate's
         excluded set grew from 9 to 10. Same self-match as CLAUDE.md §4's `pgrep -f`, one layer down. */
      'tools/d.mjs': 'const has = (n) => argv.includes(' + '`--${n}`' + ");\nif (has('selftest')) selftest();",
      'tests/real.js': "spawnSync('node', ['tools/b.mjs', '--check']);",
      'tests/prose.js': '/* the prototype in tools/b.mjs did this; see also b.mjs */\nvar unrelated = 1;',
      'capture-host/tests/test_p.py': '# the python counterpart of tools/b.mjs\nassert True\n',
      'capture-host/tests/test_q.py': "run(['tools/b.mjs'])\n"
    };
    const refs = () => [];
    let g = checkGated(M2, (p) => src[p], refs, new Set());
    ok(!g.ok && g.errors.length === 1 && /tools\/b.mjs: a `decides` producer with NO test/.test(g.errors[0]), 'a decides producer with no selftest and no test reference is a red WITH ITS NAME');
    ok(g.gated['tools/a.mjs'] === 'selftest' && g.ungated.length === 1, 'the gated map names what gates each producer; the ungated list names the rest');
    g = checkGated(M2, (p) => src[p], refs, new Set(['tools/b.mjs']));
    ok(g.ok, 'the same producer in the ratchet is debt, not a red');
    g = checkGated(
      M2,
      (p) => src[p],
      (stem) => (stem === 'b' ? ['tests/real.js'] : []),
      new Set(['tools/b.mjs'])
    );
    ok(!g.ok && /now GATED \(tests:tests\/real.js\) — REMOVE it from UNGATED_RATCHET/.test(g.errors[0]), 'a ratchet entry that gains a test reds until removed — the ratchet only goes down');
    /* ── A MENTION IS NOT A TEST (row 2026-10-21-a-tool-named-in-a-test-comment-reads-as-tested) ──
       `git grep -l` gates on the FILE, and a test file that names a tool in a comment is prose about
       it. Measured 2026-10-21 over the 123 decides producers: 4 were gated by a mention alone. One of
       them (`null-fuzz.mjs`) had a real selftest the dashed pattern could not see; the other three had
       nothing. They entered UNGATED_RATCHET as arrived debt, and each left it with a `--selftest`
       (row 2026-10-21-three-decides-producers-rest-on-a-comment). */
    g = checkGated(
      M2,
      (p) => src[p],
      (stem) => (stem === 'b' ? ['tests/prose.js'] : []),
      new Set()
    );
    ok(!g.ok && /tools\/b.mjs: a `decides` producer with NO test/.test(g.errors[0]), 'a test file that names the producer only in a COMMENT does not gate it');
    g = checkGated(
      M2,
      (p) => src[p],
      (stem) => (stem === 'b' ? ['tests/prose.js', 'tests/real.js'] : []),
      new Set()
    );
    ok(g.ok && g.gated['tools/b.mjs'] === 'tests:tests/real.js', 'the prose ref drops out and the real one still gates — the filter is per FILE, not per producer');
    g = checkGated(
      M2,
      (p) => src[p],
      (stem) => (stem === 'b' ? ['capture-host/tests/test_p.py'] : []),
      new Set()
    );
    ok(!g.ok && /tools\/b.mjs: a `decides` producer with NO test/.test(g.errors[0]), 'a `#` comment in a python test does not gate either');
    g = checkGated(
      M2,
      (p) => src[p],
      (stem) => (stem === 'b' ? ['capture-host/tests/test_q.py'] : []),
      new Set()
    );
    ok(g.ok && g.gated['tools/b.mjs'] === 'tests:capture-host/tests/test_q.py', 'a python test that RUNS it gates it — a string is not a comment');
    /* THE FOURTH SPELLING: the dashes composed in a helper. `null-fuzz.mjs` is the measured instance. */
    const M3 = M({ 'tools/d.mjs': { bin: 'decides', status: 'pending' } });
    ok(
      checkGated(
        M3,
        (p) => src[p],
        () => [],
        new Set()
      ).gated['tools/d.mjs'] === 'selftest',
      "a selftest read as has('selftest') gates — the predicate does not key on the dashes"
    );
    ok(
      namesOutsideComments('b.mjs', src['tests/prose.js'], false) === false && namesOutsideComments('b.mjs', src['tests/real.js'], false) === true,
      'namesOutsideComments is the discriminator, and it is pure'
    );
    ok(blankPyComments("a = '# not a comment'  # a comment\n").trim() === "a = '# not a comment'", 'the python blanker keeps a hash inside a string and drops the real comment');
    g = checkGated(
      M2,
      (p) => src[p],
      (stem) => (stem === 'b' ? ['tests/real.js'] : []),
      new Set()
    );
    ok(g.ok && g.gated['tools/b.mjs'] === 'tests:tests/real.js', 'a test file naming the producer gates it');
    g = checkGated(M2, (p) => (p === 'tools/a.mjs' ? '/* usage: node tools/a.mjs --selftest */' : src[p]), refs, new Set(['tools/b.mjs']));
    ok(
      !g.ok && /tools\/a.mjs: a `decides` producer with NO test/.test(g.errors[0]),
      "a --selftest that appears only in a usage COMMENT does not gate (the call-position predicate, like selftest-all's)"
    );
    g = checkGated(M2, (p) => src[p], refs, new Set(['tools/b.mjs', 'tools/c.mjs']));
    ok(!g.ok && /tools\/c.mjs: in UNGATED_RATCHET but not a `decides` producer/.test(g.errors[0]), 'a stale ratchet entry (not decides) is a red');
    ok(checkGated(M({}), () => null, refs, new Set()).ok, 'an empty decides set is trivially gated');
    // the real tree: the ratchet is exact today
    const { readSource, testRefs } = treeReaders(ROOT);
    const real = checkGated(JSON.parse(fs.readFileSync(MANIFEST, 'utf8')), readSource, testRefs);
    ok(real.ok, 'the committed manifest: every decides producer is gated or in the ratchet, and nothing in the ratchet is gated (' + real.errors.join(' | ') + ')');
  }
  /* The committed caps, DERIVED rather than frozen: a count written here would age the day another
     producer outgrows the default, so the leg reads whatever the manifest declares. The floor is
     anti-vacuity — at least one row must declare a cap, or this leg examines nothing. */
  {
    const live = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const declared = Object.entries(live.producers || {}).filter(([, row]) => row.emits && row.emits.timeoutMs !== undefined);
    ok(declared.length >= 1, 'at least one committed row declares `emits.timeoutMs` — a cap leg over zero rows examines nothing');
    ok(
      declared.every(([name, row]) => timeoutMsError(name, row.emits) === null),
      'every committed cap is a whole number of milliseconds inside the bound (' + declared.map(([n, r]) => `${n}=${r.emits.timeoutMs}`).join(', ') + ')'
    );
    ok(
      declared.every(([, row]) => row.emits.timeoutMs > DEFAULT_EMITS_TIMEOUT_MS),
      'and each one is ABOVE the default — a declared cap that is not larger buys nothing and hides why it was written'
    );
  }
  // emits.key — the object under a key of a larger payload
  ok(pickEmitted({ a: 1 }, {}).a === 1 && pickEmitted({ a: 1 }, { cmd: ['x'] }).a === 1, 'no key ⇒ the payload is the object');
  ok(pickEmitted({ verdict: good, groups: [] }, { key: 'verdict' }) === good, 'a key picks the object out of the payload');
  let threw = false;
  try {
    pickEmitted({ groups: [] }, { key: 'verdict' });
  } catch (_) {
    threw = true;
  }
  ok(threw, 'a named key missing from the payload is a read failure, not a pass over the wrapper');
  // triage helper on a synthetic file
  const tmp = fs.mkdtempSync('/tmp/verdict-adoption-');
  fs.mkdirSync(path.join(tmp, 'tools'));
  fs.writeFileSync(path.join(tmp, 'tools', 'x.mjs'), "// prints PASS in a comment\nconsole.log('VERDICT: PASS');\nconst j = argv.includes('--json');\n");
  fs.writeFileSync(path.join(tmp, 'tools', 'y.mjs'), '// only a comment says FAIL\n');
  const t = triage(tmp, ['tools/x.mjs', 'tools/y.mjs']);
  ok(t[0].code === 1 && t[0].comment === 1 && t[0].json && t[0].suggest === 'already-json' && t[1].suggest.startsWith('word-only'), 'triage separates code hits from comment hits and reads --json');
  fs.rmSync(tmp, { recursive: true, force: true });
  /* ── THE PUBLICATION RULE, PLANTED (2026-10-25) ────────────────────────────────────────────
     One synthetic tree, read from memory, with a control for every arm. Two of these files give
     the OPPOSITE answer under the word-anywhere rule this replaced, and those two ARE the row
     (`2026-10-22-the-adoption-population-is-keyed-on-a-literal-word-anywhere-in-the-file`). */
  {
    const TREE = {
      'tools/src.mjs': "export function makeVerdict(x) {\n  return { schema: 'tepna.verdict/1', status: x };\n}\nexport function helper(x) {\n  return x;\n}\n",
      'tools/word-in-code.mjs': "console.log('VERDICT: PASS');\n",
      'tools/word-in-comment.mjs': '// THE VERDICT LEADS WITH THE TRUNCATION, and a PASS here would be a FAIL elsewhere.\nconsole.log(summary);\n',
      'tools/schema-literal.mjs': "out.push({ schema: 'tepna.verdict/1' });\n",
      'tools/contract.mjs': "const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));\nemit(Verdict.make(fields));\n",
      'tools/calls-builder.mjs': "import { makeVerdict } from './src.mjs';\nconsole.log(`population: ${makeVerdict(rows).status}`);\n",
      'tools/names-builder.mjs': '/* makeVerdict(rows) is what tools/calls-builder.mjs does; this tool decides nothing. */\nreport(rows);\n',
      'tools/own-helper.mjs': 'const makeVerdict = (x) => x;\nconsole.log(makeVerdict(rows));\n',
      'capture-host/pysrc.py': 'import verdict\n\n\ndef night_verdict(n):\n    return verdict.make(n)\n',
      'capture-host/pycalls.py': 'from pysrc import (  # noqa: E402\n    night_verdict,\n)\n\nprint(night_verdict(n))\n',
      'capture-host/pydoc.py': '"""THE TOKENS ARE DELIBERATELY NOT THE SEVEN `tepna.verdict/1` STATUSES."""\n\n\ndef run():\n    return 0\n'
    };
    const files = Object.keys(TREE);
    const got = enumerateFrom(files, (p) => TREE[p]);
    const want = ['capture-host/pycalls.py', 'capture-host/pysrc.py', 'tools/calls-builder.mjs', 'tools/contract.mjs', 'tools/schema-literal.mjs', 'tools/src.mjs', 'tools/word-in-code.mjs'];
    ok(got.join(' ') === want.join(' '), 'the publication rule admits code, a quoted schema, a contract import and an imported builder call — and nothing else (' + got.join(' ') + ')');
    /* ANTI-VACUITY in both directions: the plant must be able to fail. The word-anywhere rule the
       gate used until 2026-10-25 answers differently on exactly these two files. */
    ok(WORDS.test(TREE['tools/word-in-comment.mjs']) && !got.includes('tools/word-in-comment.mjs'), 'a decision word that only ever appears in a comment no longer puts a file in the population');
    ok(
      !WORDS.test(TREE['tools/calls-builder.mjs']) && got.includes('tools/calls-builder.mjs'),
      'a tool that builds a verdict through an imported builder is in the population, with no literal word anywhere in it'
    );
    ok(!got.includes('tools/own-helper.mjs') && !got.includes('tools/names-builder.mjs'), 'a local helper of the same name, and a comment naming the builder, are not publications');
    ok(!got.includes('capture-host/pydoc.py'), 'the schema named in docstring prose, unquoted, is not a publication (the blanker keeps a docstring as a string, so the quotes are the discriminator)');
    const reasons = publicationsOf(files, (p) => TREE[p]);
    ok(
      reasons.get('tools/word-in-code.mjs') === 'word' &&
        reasons.get('tools/schema-literal.mjs') === 'schema' &&
        reasons.get('tools/contract.mjs') === 'contract' &&
        reasons.get('capture-host/pycalls.py') === 'builder:night_verdict',
      'each member carries the reason it was admitted by'
    );
    ok(importedNames('from pysrc import (\n    a,\n    b as c,\n)\n', true).has('c'), "python's parenthesised multi-line import is read (capture-host/tools/mutate.py imports its builders that way)");
    ok(enumerateFrom(['tools/gone.mjs'], () => null).length === 0, 'a file the reader cannot open publishes nothing, exactly as the grep had it');
  }
  // the real tree: the enumeration runs and is non-empty
  const en = enumerate(ROOT);
  ok(en.length > 50 && en.every((p) => p.startsWith('tools/') || p.startsWith('capture-host/') || p.startsWith('tests/')), 'enumerate() finds the population on the real tree (' + en.length + ')');
  ok(en.includes('tests/run-tests.mjs') && !en.some((p) => /^tests\/.+\//.test(p)), 'tests/*.mjs is in the population, non-recursive (the runner is no longer outside the gate)');
  /* DERIVED, never a frozen list: the arm the row is about is the one with no literal word, so the
     selftest asks the tree how many members it admitted that way and names them. */
  const byBuilder = [...treePublications(ROOT)].filter(([, w]) => w.startsWith('builder:')).map(([f]) => f);
  ok(byBuilder.length >= 8, 'the population-verdict publishers the word rule could not see are enumerated by their builder call (' + byBuilder.join(' ') + ')');
  ok(!en.includes('tools/release.mjs'), 'a tool whose only decision word sits in a comment is out of the population on the real tree too');
  /* ── word-only rows make a CLAIM, and the claim is checked (2026-09-22) ─────────────────────
     Plants for each arm, including the one that matters most: the detector's own SENSITIVITY. */
  {
    const W = (producers) => ({ schema: 'tepna.verdict-adoption/1', producers });
    const claim = { bin: 'word-only', status: 'exempt', reason: 'selftest assertion printer — not a verdict about data' };
    const concede = { bin: 'word-only', status: 'exempt', reason: 'a QUEUE decision about a PR state, in its own vocabulary — not a gate over data' };
    const SRC = {
      // emits a decision on a reachable path — the claim is FALSE
      'tools/emitter.mjs': "function selftest() { ok('x', true); }\nconsole.log('  ⊘ REFUSED — ' + why);\n",
      // ⚠️ THE SENSITIVITY PLANT: the only decision word is glued to a `\n` escape, which kills \b.
      // This exact shape was MISSED on this check's first run (pat-residual-structure.mjs).
      'tools/escaped.mjs': "function selftest() { ok('x', true); }\nconsole.log('\\nTALLY:', JSON.stringify(tally));\n",
      // selftest INFRASTRUCTURE at module scope — the twelve measured false positives
      'tools/printer.mjs': "const ok = (n, c) => console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${n}`);\nfunction selftest() { ok('a', true); }\n",
      'tools/handler.mjs': "function selftest() { return 0; }\nprocess.on('x', (m) => console.error('SELFTEST FAIL:', m));\n",
      // prose only
      'tools/quiet.mjs': "// this one REFUSED nothing, the word is in a comment\nfunction selftest() { ok('a', true); }\n"
    };
    const read = (q) => SRC[q] ?? null;
    let w = checkWordOnlyClaim(W({ 'tools/emitter.mjs': claim }), read, new Set());
    ok(!w.ok && /tools\/emitter\.mjs: its row claims no emitted verdict/.test(w.errors[0]), `an emitting word-only row reds BY NAME, got ${w.errors[0]}`);
    ok(w.errors[0].includes('REFUSED'), 'the red quotes the line that falsifies the claim, not just the path');
    /* PLANT — permanent, not a fixed bug: an escape adjacent to the word must still be FOUND. */
    w = checkWordOnlyClaim(W({ 'tools/escaped.mjs': claim }), read, new Set());
    ok(!w.ok && /tools\/escaped\.mjs/.test(w.errors[0]), 'PLANT: a decision word glued to a \\n escape is still found (the measured false negative)');
    /* The named exclusions must NOT fire — an invariant that convicts working code is the wrong rule. */
    ok(checkWordOnlyClaim(W({ 'tools/printer.mjs': claim }), read, new Set()).ok, "a module-scope `cond ? 'ok' : 'FAIL'` assertion printer is not a decision");
    ok(checkWordOnlyClaim(W({ 'tools/handler.mjs': claim }), read, new Set()).ok, 'a SELFTEST FAIL: handler is not a decision');
    ok(checkWordOnlyClaim(W({ 'tools/quiet.mjs': claim }), read, new Set()).ok, 'a word in a comment is not an emission');
    /* THE POPULATION IS THE DESIGN: a row that CONCEDES emission is outside it, even though its
       source prints the same line that reds the claiming row above. */
    w = checkWordOnlyClaim(W({ 'tools/emitter.mjs': concede }), read, new Set());
    ok(w.ok && w.checked === 0 && w.conceded === 1 && w.wordOnly === 1, `a conceding row is outside the population by construction, got ${JSON.stringify({ c: w.checked, x: w.conceded })}`);
    /* The population is an EQUALITY, so a row moving between classes moves the numbers. */
    w = checkWordOnlyClaim(W({ 'tools/quiet.mjs': claim, 'tools/emitter.mjs': concede }), read, new Set());
    ok(w.checked + w.conceded === w.wordOnly, 'checked + conceded = word-only rows, an equality');
    /* The ratchet may only SHRINK — a clean row still listed is a red. */
    w = checkWordOnlyClaim(W({ 'tools/quiet.mjs': claim }), read, new Set(['tools/quiet.mjs']));
    ok(!w.ok && /no longer emits a decision — REMOVE it/.test(w.errors[0]), 'a ratchet entry that stopped emitting reds until it is removed');
    w = checkWordOnlyClaim(W({ 'tools/emitter.mjs': claim }), read, new Set(['tools/gone.mjs']));
    ok(
      w.errors.some((e) => /tools\/gone\.mjs: in WO_CLAIM_RATCHET but is not a word-only row/.test(e)),
      'a stale ratchet entry is a red'
    );
    /* An unreadable source is not a held claim. */
    w = checkWordOnlyClaim(W({ 'tools/absent.mjs': claim }), read, new Set());
    ok(!w.ok && /could not be read/.test(w.errors[0]), 'an unreadable word-only source reds rather than passing');
    /* The real tree: the ratchet is exact today, and the population is the measured one. */
    const { readSource } = treeReaders(ROOT);
    const realW = checkWordOnlyClaim(JSON.parse(fs.readFileSync(MANIFEST, 'utf8')), readSource);
    ok(realW.ok, 'the committed manifest: every claiming word-only row holds, or is in WO_CLAIM_RATCHET (' + realW.errors.join(' | ') + ')');
    ok(realW.checked + realW.conceded === realW.wordOnly && realW.checked > 0, `the real population is an equality, got ${realW.checked}+${realW.conceded}=${realW.wordOnly}`);
  }

  /* ── ADOPTION IS A RATCHET — the #2888 revert, planted ───────────────────────────────────── */
  {
    const A = (bin, status, extra) => Object.assign({ bin, status }, extra || {});
    const BASE = {
      producers: {
        'tools/x.mjs': A('decides', 'adopted', { emits: { cmd: ['node', 'tools/x.mjs'] } }),
        'tools/y.mjs': A('decides', 'adopted', { emits: { cmd: ['node', 'tools/y.mjs'] } }),
        'tools/gone.mjs': A('decides', 'adopted', { emits: { cmd: ['node', 'tools/gone.mjs'] } }),
        'tools/w.mjs': A('word-only', 'exempt', { reason: 'label' }),
        'tools/p.mjs': A('decides', 'pending')
      }
    };
    const exists = (p) => p !== 'tools/gone.mjs';
    /* the measured defect: y was adopted on main, the merge put it back to word-only/exempt */
    const reverted = { producers: { ...BASE.producers, 'tools/y.mjs': A('word-only', 'exempt', { reason: 'selftest assertion printer' }) } };
    delete reverted.producers['tools/gone.mjs'];
    const rv = checkRatchet(BASE, reverted, exists);
    ok(!rv.ok && rv.deAdopted.length === 1 && rv.deAdopted[0] === 'tools/y.mjs', 'ratchet FIRES on the planted #2888 revert (adopted on base → word-only/exempt on head), naming the tool');
    ok(
      rv.errors.length === 1 && /ratchet/.test(rv.errors[0]) && /"word-only"\/"exempt"/.test(rv.errors[0]),
      'the red names the head bin/status it found, so the reader sees the revert, not a generic mismatch'
    );
    ok(rv.retired.length === 1 && rv.retired[0] === 'tools/gone.mjs', 'a tool whose FILE left the tree with its row is RETIRED, not de-adopted');
    ok(
      rv.adoptedAtBase === 3 && rv.kept + rv.retired.length + rv.deAdopted.length === rv.adoptedAtBase,
      `the population is an equality: ${rv.kept}+${rv.retired.length}+${rv.deAdopted.length}=${rv.adoptedAtBase}`
    );
    /* a row DELETED while the file remains is a de-adoption, not a retirement */
    const dropped = { producers: { ...BASE.producers } };
    delete dropped.producers['tools/x.mjs'];
    const dv = checkRatchet(BASE, dropped, exists);
    ok(
      !dv.ok && dv.deAdopted.length === 1 && dv.deAdopted[0] === 'tools/x.mjs' && /ABSENT/.test(dv.errors[0]),
      'a row removed while the file still exists is DE-ADOPTED (the file, not the row, decides retirement)'
    );
    /* the clean cases: identical manifests, and a head that ADDS an adoption (the ratchet only goes up) */
    const grown = { producers: { ...BASE.producers, 'tools/p.mjs': A('decides', 'adopted', { emits: { cmd: ['node', 'tools/p.mjs'] } }) } };
    const gv = checkRatchet(BASE, grown, exists);
    ok(gv.ok && gv.kept === 3 && gv.deAdopted.length === 0, 'head that KEEPS every base adoption and adds one passes (pending → adopted is the direction the ratchet allows)');
    ok(
      checkRatchet(BASE, BASE, () => true).ok && checkRatchet({ producers: {} }, BASE, () => true).adoptedAtBase === 0,
      'identical manifests pass; an empty base has nothing to hold and says so with adoptedAtBase 0'
    );
    /* the real leg: the committed manifest against ITSELF is all kept — non-vacuous by count */
    const realM = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const sv = checkRatchet(realM, realM, (p) => fs.existsSync(path.join(ROOT, p)));
    ok(sv.ok && sv.kept === sv.adoptedAtBase && sv.adoptedAtBase > 0, `the committed manifest holds its own ${sv.adoptedAtBase} adoptions (kept ${sv.kept})`);
  }

  /* ── the contributions leg: the population is the BRIEF, and an adoption is READ ──────────────
     Every arm is planted, including the one the leg exists for: an object that validates while
     validate() never examined a contributions block is a pass over something never read. */
  {
    const TABLE = [
      '## 2 · Adoption set (named, gated — PARTIAL-ADOPTION rule)',
      '',
      '| figure | file | method | why first |',
      '|---|---|---|---|',
      '| hat σ | `analysis-stats.js tchSigmasPairwiseFromVars` | `analytic` | first |',
      '| LOSS verdict | `capture-host/loss_audit.py night_verdict` | `decomposition` over devices | cheapest |',
      '',
      '## 3 · Cost'
    ].join('\n');
    const F = (figures) => ({ schema: 'tepna.verdict-adoption/1', contributions: { enumeratedFrom: 'briefs/X-BRIEF.md §2', figures } });
    const HAT = { file: 'analysis-stats.js', method: 'analytic', status: 'pending', since: '2026-10-12' };
    const LOSS = { file: 'capture-host/loss_audit.py', method: 'decomposition', status: 'pending', since: '2026-10-12' };
    const both = () => ({ 'hat σ': { ...HAT }, 'LOSS verdict': { ...LOSS } });
    const vOK = () => ({ ok: true, errors: [], checked: ['schema', 'status', 'contributions'] });
    const vNoBlock = () => ({ ok: true, errors: [], checked: ['schema', 'status'] });
    const vBad = () => ({ ok: false, errors: ['status is not one of the seven'], checked: ['status'] });
    const run = (e) =>
      e.file === 'good.json'
        ? { schema: 'tepna.verdict/1' }
        : (() => {
            throw new Error('unreadable');
          })();
    const parsed = parseContributionSet(TABLE);
    ok(
      parsed.length === 2 && parsed[0].file === 'analysis-stats.js' && parsed[1].method === 'decomposition',
      'the §2 table parses to its figures, taking the first backticked token of the file and method cells'
    );
    let k = checkContributions(F(both()), TABLE, null, null);
    ok(k.ok && k.counts.table === 2 && k.counts.figures === 2 && k.counts.pending === 2, 'a manifest equal to the table, all pending, is green and says how many are owed');
    /* PLANT — the leg's own blindness: a reflowed or renamed §2 heading must NOT read as a pass. */
    k = checkContributions(F(both()), TABLE.replace('## 2 · Adoption set', '## 2 · The set'), null, null);
    ok(!k.ok && /read as 0 figures/.test(k.errors[0]) && /examines nothing/.test(k.errors[0]), 'PLANT: a renamed §2 heading empties the population and REDS — an empty population examines nothing');
    k = checkContributions(F({ 'hat σ': { ...HAT } }), TABLE, null, null);
    ok(!k.ok && k.errors.some((e) => /names "LOSS verdict" and this manifest has no row/.test(e)), 'a table figure with no row is a red WITH ITS NAME');
    k = checkContributions(F({ ...both(), 'ghost figure': { ...HAT } }), TABLE, null, null);
    ok(!k.ok && k.errors.some((e) => /the row "ghost figure" matches no figure/.test(e)), 'a row for no table figure is a red with its name — the brief is the population');
    k = checkContributions(F({ ...both(), 'hat σ': { ...HAT, file: 'tools/trio-batch.mjs' } }), TABLE, null, null);
    ok(!k.ok && /sits at "tools\/trio-batch.mjs" here and at "analysis-stats.js"/.test(k.errors[0]), 'a row whose file disagrees with the table reds naming both sides');
    k = checkContributions(F({ ...both(), 'hat σ': { ...HAT, method: 'shapley' } }), TABLE, null, null);
    ok(!k.ok && /method must be one of leave-one-out\|analytic\|decomposition/.test(k.errors[0]), 'a method outside the closed set is a red');
    k = checkContributions(F({ ...both(), 'hat σ': { ...HAT, method: 'decomposition' } }), TABLE, null, null);
    ok(!k.ok && /declares method "decomposition" and the §2 table says "analytic"/.test(k.errors[0]), 'a method in the set but not the table’s is a red — the brief names the method too');
    k = checkContributions(F({ ...both(), 'hat σ': { ...HAT, status: 'done' } }), TABLE, null, null);
    ok(!k.ok && /carries status pending\|adopted, got "done"/.test(k.errors[0]), 'a status outside pending|adopted is a red');
    k = checkContributions(F({ ...both(), 'hat σ': { ...HAT, since: '2026-10' } }), TABLE, null, null);
    ok(!k.ok && /needs `since` as YYYY-MM-DD/.test(k.errors[0]), 'an undated row cannot be read as debt, so it reds');
    k = checkContributions(F({ ...both(), 'hat σ': { ...HAT, status: 'adopted' } }), TABLE, null, null);
    ok(!k.ok && /adopted without `emits`/.test(k.errors[0]), 'adopted without emits is a claim the gate cannot read, red');
    k = checkContributions(F({ ...both(), 'hat σ': { ...HAT, status: 'adopted', emits: { file: 'good.json' } } }), TABLE, null, null);
    ok(k.ok && k.counts.adopted === 1 && k.counts.read === 0, 'the pure core checks an adopted row for shape alone and reads nothing');
    k = checkContributions(F({ ...both(), 'hat σ': { ...HAT, status: 'adopted', emits: { file: 'gone.json' } } }), TABLE, vOK, run);
    ok(!k.ok && /emits could not be read/.test(k.errors[0]), 'an adopted figure whose object cannot be read reds, never silently greens');
    k = checkContributions(F({ ...both(), 'hat σ': { ...HAT, status: 'adopted', emits: { cmd: ['node', 'x.mjs'] } } }), TABLE, vOK, () => {
      throw unexaminedTimeout({ capMs: 120000, elapsedMs: 120004, load1: 44.1, cmd: 'node x.mjs' });
    });
    ok(k.ok && k.unexamined.length === 1 && k.counts.read === 0, 'a figure whose producer hit the cap is unexamined here too, never a red — the two legs route a timeout the same way');
    k = checkContributions(F({ ...both(), 'hat σ': { ...HAT, status: 'adopted', emits: { file: 'good.json', timeoutMs: 0 } } }), TABLE, vOK, run);
    ok(!k.ok && /emits.timeoutMs must be/.test(k.errors[0]), '…and a malformed cap reds in the contributions leg with the same message');
    k = checkContributions(F({ ...both(), 'hat σ': { ...HAT, status: 'adopted', emits: { file: 'good.json' } } }), TABLE, vBad, run);
    ok(!k.ok && /NOT a valid tepna.verdict\/1 — status is not one of the seven/.test(k.errors[0]), 'an adopted figure emitting an invalid object reds naming the validator error');
    /* PLANT — the whole point: VALID is not ADOPTED. The block must have been EXAMINED. */
    k = checkContributions(F({ ...both(), 'hat σ': { ...HAT, status: 'adopted', emits: { file: 'good.json' } } }), TABLE, vNoBlock, run);
    ok(!k.ok && /examined NO contributions block/.test(k.errors[0]), 'PLANT: a valid object whose validate() examined no block is NOT an adoption — it is a pass over something never read');
    k = checkContributions(F({ ...both(), 'hat σ': { ...HAT, status: 'adopted', emits: { file: 'good.json' } } }), TABLE, vOK, run);
    ok(k.ok && k.counts.adopted === 1 && k.counts.read === 1 && k.counts.examined === 1, 'adopted + a read object whose validate() examined the block is green, and the count says so');
    /* THE REAL VALIDATOR, not a stub: the leg's requirement must be satisfiable by the shipped
       verdict.js, and the same object WITHOUT the block must red through the same path. */
    const withBlock = V.make({
      gate: 'g',
      status: 'PASS',
      population: { checked: 2, eligible: 2, excluded: 0 },
      criterion: { name: 'x', threshold: 1, unit: '', direction: 'lte' },
      result: { x: 0 },
      evidence: ['a'],
      producedBy: { tool: 't', commit: 'abcdef1' },
      contributions: {
        of: 'sigma.ankle',
        unit: 'ms^2',
        method: 'analytic',
        inputs: [
          { key: 'leg.chest-finger', delta: -3, share: 0.75 },
          { key: 'leg.chest-ankle', delta: 1, share: 0.25 }
        ],
        dominant: 'leg.chest-finger'
      }
    });
    const realRun = (e) => (e.file === 'with.json' ? withBlock : good);
    const adoptedHat = (file) => ({ ...both(), 'hat σ': { ...HAT, status: 'adopted', emits: { file } } });
    k = checkContributions(F(adoptedHat('with.json')), TABLE, V.validate, realRun);
    ok(k.ok && k.counts.examined === 1, `the shipped verdict.js EXAMINES a real contributions block, so an honest adoption greens (${k.errors.join(' | ')})`);
    k = checkContributions(F(adoptedHat('without.json')), TABLE, V.validate, realRun);
    ok(!k.ok && /examined NO contributions block/.test(k.errors[0]), 'the same real validator over an object WITHOUT the block reds through the same path — the arm is not a stub artefact');
    /* the real tree: the committed manifest equals the brief’s own table, non-vacuous by count */
    const realM = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const briefPath = String((realM.contributions || {}).enumeratedFrom || '').split(' §')[0];
    const realSrc = briefPath && fs.existsSync(path.join(ROOT, briefPath)) ? fs.readFileSync(path.join(ROOT, briefPath), 'utf8') : '';
    const rk = checkContributions(realM, realSrc, null, null);
    ok(
      rk.ok && rk.counts.table > 0 && rk.counts.table === rk.counts.figures,
      `the committed manifest equals the §2 table of ${briefPath || '(unset)'} (${rk.counts.table} figures) (${rk.errors.join(' | ')})`
    );
  }

  /* ── a word-only row must not construct a verdict object (2026-10-11) ──────────────────────────
     The measured case is `tools/geometry-scan.mjs`: its row read word-only/exempt while the source
     built a real object, and the gate stayed green. Plants for each arm, the sensitivity first. */
  {
    const W = (producers) => ({ schema: 'tepna.verdict-adoption/1', producers });
    const wo = { bin: 'word-only', status: 'exempt', reason: 'verdict words appear only in comments' };
    const SRC = {
      'tools/lit.mjs': "function selftest() { ok('x', true); }\nconst v = {\n  schema: 'tepna.verdict/1',\n  gate: 'x'\n};\n",
      'tools/call.mjs': "import { makeVerdict } from './verdict-emit.mjs';\nconst v = makeVerdict({ gate: 'x' });\n",
      'tools/vmake.mjs': 'const v = V.make({ gate: "x" });\n',
      'tools/py.py': 'def verdict_object(a):\n    pass\n\nx = verdict_object(1)\n',
      // not constructions
      'tools/comment.mjs': "// schema: 'tepna.verdict/1' is mentioned here, and makeVerdict( too\nfunction selftest() { ok('a', true); }\n",
      'tools/selftest-only.mjs': "const run = () => 1;\nfunction selftest() {\n  const o = { schema: 'tepna.verdict/1' };\n  ok('a', !!o);\n}\n",
      'tools/definer.mjs': 'export function makeVerdict(f) { return f; }\n',
      'tools/pydef.py': 'def verdict_object(a):\n    return a\n'
    };
    const read = (q) => SRC[q] ?? null;
    for (const f of ['tools/lit.mjs', 'tools/call.mjs', 'tools/vmake.mjs', 'tools/py.py']) {
      const w = checkWordOnlyObject(W({ [f]: wo }), read, new Set());
      ok(
        !w.ok && w.errors[0].startsWith(`${f}: binned word-only`) && /CONSTRUCTS a tepna\.verdict\/1 object/.test(w.errors[0]),
        `a word-only row whose source constructs an object reds BY NAME (${f}), got ${w.errors[0]}`
      );
    }
    for (const f of ['tools/comment.mjs', 'tools/selftest-only.mjs', 'tools/definer.mjs', 'tools/pydef.py']) {
      ok(checkWordOnlyObject(W({ [f]: wo }), read, new Set()).ok, `${f}: a comment, a selftest-built object or a bare builder DEFINITION is not an emission`);
    }
    // a conceding reason does not buy an exemption from the OBJECT check
    const conceding = { bin: 'word-only', status: 'exempt', reason: 'a QUEUE decision in its own vocabulary — not a gate over data' };
    ok(!checkWordOnlyObject(W({ 'tools/lit.mjs': conceding }), read, new Set()).ok, 'a row that concedes printed words is still refused when it constructs an object');
    let w = checkWordOnlyObject(W({ 'tools/absent.mjs': wo }), read, new Set());
    ok(!w.ok && /could not be read/.test(w.errors[0]), 'an unreadable word-only source reds rather than passing');
    // the named library list cannot go stale
    w = checkWordOnlyObject(W({ 'tools/lit.mjs': wo }), read, new Set(['tools/lit.mjs']));
    ok(w.ok, 'a named builder library is excused by path');
    w = checkWordOnlyObject(W({ 'tools/definer.mjs': wo }), read, new Set(['tools/definer.mjs']));
    ok(!w.ok && /no longer constructs an object/.test(w.errors[0]), 'a library entry that no longer builds reds until removed');
    w = checkWordOnlyObject(W({ 'tools/lit.mjs': wo }), read, new Set(['tools/gone.mjs']));
    ok(
      w.errors.some((e) => /tools\/gone\.mjs: in OBJECT_BUILDER_LIBRARIES but is not a word-only row/.test(e)),
      'a stale library entry is a red'
    );
    /* ── THE DELEGATED BUILD, one hop ────────────────────────────────────────────────────────────
       Row 2026-10-28-the-word-only-bin-misses-a-verdict-built-by-an-imported-helper: eight producers
       called `populationVerdict` from another module, and this LINE scan saw nothing. One plant per
       state, and the control is a builder that only READS objects. */
    {
      const HOP = {
        // constructs, behind a destructured parameter — the brace `functionBody` was fixed for
        'tools/hop-ctor.mjs': "import { Verdict } from './verdict.js';\nexport function buildVerdict({ gate = 'x', at = null } = {}) {\n  return Verdict.make({ gate, at });\n}\n",
        // the measured control: `extractVerdicts@tools/pr-compliance.mjs` parses and constructs nothing
        'tools/hop-read.mjs': "export function readVerdicts(body) {\n  const o = JSON.parse(body);\n  if (o.schema === 'tepna.verdict/1') return [o];\n  return [];\n}\n",
        // every call resolved but one: §∅ — an unresolved call is not a proven absence
        'tools/hop-unknown.mjs': "import { helper } from './absent.mjs';\nimport { Verdict } from './verdict.js';\nexport function sketchVerdict(x) {\n  return helper(x);\n}\n",
        // a cycle must terminate and add no construction of its own
        'tools/hop-cycle.mjs': "import { Verdict } from './verdict.js';\nexport function oneVerdict(x) {\n  return twoVerdict(x);\n}\nexport function twoVerdict(x) {\n  return oneVerdict(x);\n}\n",
        // Python: the construction is one local hop away, and the docstring carries prose parentheses
        'capture-host/hop.py':
          'from verdict import make\n\ndef py_verdict(n):\n    """Judge the next loss-poller tick (poll_sec) over one night."""\n    return _emit(n)\n\ndef _emit(n):\n    return {"schema": "tepna.verdict/1", "gate": n}\n',
        'capture-host/hop-read.py': 'from verdict import make\n\ndef read_verdict(n):\n    """Read the next loss-poller tick (poll_sec) off a line."""\n    return 0\n',
        // the consumers: a word-only row that calls one of the above
        'tools/uses-ctor.mjs': "import { buildVerdict } from './hop-ctor.mjs';\nexport function run() {\n  return buildVerdict({ gate: 'x' });\n}\nfunction selftest() { ok('a', true); }\n",
        'tools/uses-read.mjs': "import { readVerdicts } from './hop-read.mjs';\nexport function run(body) {\n  return readVerdicts(body);\n}\n",
        'tools/uses-unknown.mjs': "import { sketchVerdict } from './hop-unknown.mjs';\nexport function run(x) {\n  return sketchVerdict(x);\n}\n",
        'tools/uses-cycle.mjs': "import { oneVerdict } from './hop-cycle.mjs';\nexport function run(x) {\n  return oneVerdict(x);\n}\n",
        'tools/uses-selftest.mjs': "import { buildVerdict } from './hop-ctor.mjs';\nfunction selftest() {\n  const v = buildVerdict({ gate: 'x' });\n  ok('a', !!v);\n}\n",
        'tools/uses-noimport.mjs': "export function run() {\n  return buildVerdict({ gate: 'x' });\n}\n",
        'capture-host/uses-hop.py': 'from hop import py_verdict\n\ndef run(n):\n    return py_verdict(n)\n'
      };
      const hread = (q) => HOP[q] ?? null;
      const hb = buildersOver(Object.keys(HOP), hread);
      ok(hb.get('buildVerdict') === 'tools/hop-ctor.mjs' && hb.get('py_verdict') === 'capture-host/hop.py', `the planted tree enumerates its builders (${[...hb.keys()].sort().join(',')})`);
      /* the brace bug, pinned: the body must be the BODY, not the destructured parameter list */
      const fb = functionBody(HOP['tools/hop-ctor.mjs'], 'buildVerdict', false);
      ok(fb != null && fb.text.startsWith('{') && /Verdict\.make/.test(fb.text), `the parameter list is walked before the body opens (${fb == null ? 'null' : fb.text.split('\n')[0]})`);
      /* three states, one plant each */
      ok(builderConstructs('buildVerdict', hb, hread) === true, 'a builder that constructs reads true');
      ok(builderConstructs('readVerdicts', hb, hread) === false, 'a builder whose every call resolves and none constructs reads false — the `rebase-safe` control');
      ok(builderConstructs('sketchVerdict', hb, hread) === 'unknown', 'a builder with one unresolved call reads unknown, never false (§∅)');
      ok(builderConstructs('oneVerdict', hb, hread) === false, 'a two-function cycle terminates and adds no construction');
      ok(builderConstructs('absentVerdict', hb, hread) === 'unknown', 'a name no file defines reads unknown');
      ok(builderConstructs('py_verdict', hb, hread) === true, 'Python: the construction one local hop away is found');
      ok(builderConstructs('read_verdict', hb, hread) === false, 'Python: a reader whose docstring carries prose parentheses reads false');
      /* WHY that last leg needs `blankPyStrings`: the prose reads as a call in the text, not in the code */
      const pb = functionBody(HOP['capture-host/hop-read.py'], 'read_verdict', true);
      ok(bareCalls(pb.text).has('tick') && !bareCalls(pb.code).has('tick'), 'docstring prose is a call in the raw body and not in the string-blanked view');
      /* the gate arm itself */
      for (const [f, re] of [
        ['tools/uses-ctor.mjs', /which CONSTRUCTS a tepna\.verdict\/1 object/],
        ['tools/uses-unknown.mjs', /which may construct \(unresolved call/],
        ['capture-host/uses-hop.py', /which CONSTRUCTS a tepna\.verdict\/1 object/]
      ]) {
        const h = checkWordOnlyObject(W({ [f]: wo }), hread, new Set(), hb);
        ok(!h.ok && h.errors[0].startsWith(`${f}: binned word-only`) && re.test(h.errors[0]), `a word-only row that delegates its build reds BY NAME (${f}), got ${h.errors[0]}`);
        ok(h.hops.length === 1 && h.hops[0].path === f && h.hops[0].from === hb.get(h.hops[0].builder), `the hop is reported as data, not only prose (${JSON.stringify(h.hops[0] ?? null)})`);
      }
      for (const f of ['tools/uses-read.mjs', 'tools/uses-cycle.mjs', 'tools/uses-selftest.mjs', 'tools/uses-noimport.mjs']) {
        const h = checkWordOnlyObject(W({ [f]: wo }), hread, new Set(), hb);
        ok(h.ok && h.hops.length === 0, `${f}: a proven reader, a cycle, a selftest-only call and an un-imported name buy no re-bin (${h.errors.join(' | ')})`);
      }
      /* and the one-hop detector is OFF unless a builder map is passed — the default stays the old arm */
      ok(checkWordOnlyObject(W({ 'tools/uses-ctor.mjs': wo }), hread, new Set()).ok, 'without a builder map the delegated build is invisible — exactly the defect the row names');
    }

    /* THE MEASURED CASE, on the real source: geometry-scan's row reverted to what it read before #3402. */
    const { readSource } = treeReaders(ROOT);
    const real = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    ok(checkWordOnlyObject(real, readSource).ok, 'the committed manifest: no word-only row constructs a verdict object');
    /* the real tree with the one-hop detector live, and the measured producer that hid behind it */
    const realB = buildersOver(enumerate(ROOT), readSource);
    const realHop = checkWordOnlyObject(real, readSource, OBJECT_BUILDER_LIBRARIES, realB);
    ok(realHop.ok && realHop.hops.length === 0, `the committed manifest: no word-only row delegates its build either (${realHop.errors.join(' | ')})`);
    const staleHop = { ...real, producers: { ...real.producers, 'tools/ppg-foot-consensus-e1.mjs': wo } };
    const hw = checkWordOnlyObject(staleHop, readSource, OBJECT_BUILDER_LIBRARIES, realB);
    ok(
      !hw.ok && hw.errors.some((e) => e.startsWith('tools/ppg-foot-consensus-e1.mjs: binned word-only') && /populationVerdict/.test(e)),
      `MEASURED CASE: one of the eight re-binned word-only is refused on its real source (${hw.errors.join(' | ')})`
    );
    ok(checkWordOnlyObject(staleHop, readSource).ok, 'the direct-object judge alone stays GREEN on that row — the blind spot this unit closes');
    const stale = { ...real, producers: { ...real.producers, 'tools/geometry-scan.mjs': wo } };
    w = checkWordOnlyObject(stale, readSource);
    ok(!w.ok && w.errors.some((e) => e.startsWith('tools/geometry-scan.mjs: binned word-only')), 'MEASURED CASE: geometry-scan re-binned word-only/exempt is refused on its real source');
    // …and the pre-existing word-only judge is blind to exactly this, which is why a second check exists
    ok(checkWordOnlyClaim(stale, readSource).ok, 'the word-printing judge alone stays GREEN on the stale geometry-scan row (the original defect)');
  }

  /* THE SCRATCH CHECKOUT IS A REAL IMPORT GRAPH: without the modules this tool imports beside it, the
     CLI dies at module evaluation — which a black-box leg would report as a gate verdict. The graph is
     WALKED from the import lines, never listed: a hand list went stale the day this file began to import
     `selftest-all.mjs` (row 2026-10-21-selftest-all-runs-its-cli-at-module-scope). */
  const copyToolImports = (scratch) => {
    const seen = new Set();
    const walk = (name) => {
      for (const m of fs.readFileSync(path.join(ROOT, 'tools', name), 'utf8').matchAll(/^import [^;]*? from '\.\/([\w.-]+\.mjs)';/gm)) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        fs.copyFileSync(path.join(ROOT, 'tools', m[1]), path.join(scratch, 'tools', m[1]));
        walk(m[1]);
      }
    };
    walk('verdict-adoption.mjs');
    return seen;
  };
  ok(
    'CONTROL · the import walk reaches the lexer and the shared predicate',
    (() => {
      const t = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-adoption-graph-'));
      try {
        fs.mkdirSync(path.join(t, 'tools'));
        const g = copyToolImports(t);
        return g.has('js-lex.mjs') && g.has('selftest-all.mjs') && g.has('argv-guard.mjs');
      } finally {
        fs.rmSync(t, { recursive: true, force: true });
      }
    })(),
    'the walk found no import line — a renamed import form, not an empty graph'
  );
  /* BLACK BOX, same measured case: run THIS script, as the CLI, in a scratch checkout holding the real
     geometry-scan source and a manifest that bins it word-only/exempt. The gate must name it. */
  {
    const real = path.join(ROOT, 'tools', 'geometry-scan.mjs');
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-adoption-'));
    try {
      fs.mkdirSync(path.join(scratch, 'tools'));
      fs.copyFileSync(fileURLToPath(import.meta.url), path.join(scratch, 'tools', 'verdict-adoption.mjs'));
      copyToolImports(scratch);
      fs.copyFileSync(real, path.join(scratch, 'tools', 'geometry-scan.mjs'));
      fs.copyFileSync(path.join(ROOT, 'verdict.js'), path.join(scratch, 'verdict.js'));
      fs.writeFileSync(
        path.join(scratch, 'tools', 'verdict-adoption.json'),
        canonicalText({ schema: 'tepna.verdict-adoption/1', producers: { 'tools/geometry-scan.mjs': { bin: 'word-only', status: 'exempt', reason: 'verdict words appear only in comments' } } })
      );
      const git = (...a) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=selftest', ...a], { cwd: scratch, stdio: 'ignore' });
      git('init', '-q');
      git('add', '-A');
      git('commit', '-qm', 'scratch');
      const run = spawnSync(process.execPath, [path.join(scratch, 'tools', 'verdict-adoption.mjs'), '--check', '--base', 'HEAD'], { cwd: scratch, encoding: 'utf8' });
      const out = `${run.stdout}${run.stderr}`;
      ok(run.status === 1 && /✗ tools\/geometry-scan\.mjs: binned word-only/.test(out), `BLACK BOX: the CLI gate names a word-only geometry-scan that builds a verdict object (exit ${run.status})`);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }

  /* THE BYTE FORM. The expected text is what Python 3 `json.dumps(obj, indent=1) + "\\n"` printed for
     this object (2026-10-21), so the oracle is the other writer, not this function. */
  {
    const obj = { a: 'x \u2014 y \u00b7 \u03c3', b: [1, 2.5, true, null, [], {}], c: { d: 'tab\there\u007f', e: '\ud83d\ude00' } };
    const py = '{\n "a": "x \\u2014 y \\u00b7 \\u03c3",\n "b": [\n  1,\n  2.5,\n  true,\n  null,\n  [],\n  {}\n ],\n "c": {\n  "d": "tab\\there\\u007f",\n  "e": "\\ud83d\\ude00"\n }\n}\n';
    ok(canonicalText(obj) === py, 'BYTE FORM: canonicalText writes the bytes Python json.dumps(indent=1) writes, escapes and all');
    ok(checkByteForm(py).ok, 'BYTE FORM: the Python form passes');
    const raw = py.replace('x \\u2014 y', 'x \u2014 y');
    let f = checkByteForm(raw);
    ok(!f.ok && f.line === 2 && /line 2 is not in the canonical form/.test(f.errors[0]), 'BYTE FORM: a raw non-ASCII character in one record is a red that names its line');
    const two = py.replace(' "c": {\n  "d"', ' "c": {\n    "d"');
    f = checkByteForm(two);
    ok(!f.ok && f.line === 12, 'BYTE FORM: a record at another indent is a red that names its line');
    f = checkByteForm(JSON.stringify(obj, null, 2) + '\n');
    ok(!f.ok && f.line === 2, 'BYTE FORM: the JSON.stringify(obj, null, 2) form is a red');
    ok(!checkByteForm(py.slice(0, -1)).ok, 'BYTE FORM: a missing final newline is a red');
    f = checkByteForm('{"a": ');
    ok(!f.ok && f.line === null && /does not parse/.test(f.errors[0]), 'BYTE FORM: unparseable text is a red, never a pass');
    ok(checkByteForm(fs.readFileSync(MANIFEST, 'utf8')).ok, 'BYTE FORM: the committed manifest is in the canonical form');
  }

  /* BLACK BOX, the byte form: --format rewrites a hand-edited manifest to the canonical bytes, and --check
     then names no byte-form red; before the rewrite it names one. */
  {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-adoption-form-'));
    try {
      fs.mkdirSync(path.join(scratch, 'tools'));
      fs.copyFileSync(fileURLToPath(import.meta.url), path.join(scratch, 'tools', 'verdict-adoption.mjs'));
      copyToolImports(scratch);
      fs.copyFileSync(path.join(ROOT, 'verdict.js'), path.join(scratch, 'verdict.js'));
      const m = { schema: 'tepna.verdict-adoption/1', producers: {}, note: 'a \u2014 b' };
      const file = path.join(scratch, 'tools', 'verdict-adoption.json');
      fs.writeFileSync(file, JSON.stringify(m, null, 2));
      const git = (...a) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=selftest', ...a], { cwd: scratch, stdio: 'ignore' });
      git('init', '-q');
      git('add', '-A');
      git('commit', '-qm', 'scratch');
      const cli = (...a) => spawnSync(process.execPath, [path.join(scratch, 'tools', 'verdict-adoption.mjs'), ...a], { cwd: scratch, encoding: 'utf8' });
      let run = cli('--check', '--base', 'HEAD');
      ok(run.status === 1 && /✗ byte form: tools\/verdict-adoption\.json line 2/.test(run.stdout), `BLACK BOX: --check names the hand-edited form (exit ${run.status})`);
      run = cli('--format');
      ok(run.status === 0 && fs.readFileSync(file, 'utf8') === canonicalText(m) && /rewrote/.test(run.stdout), 'BLACK BOX: --format writes the canonical bytes');
      run = cli('--format');
      ok(run.status === 0 && /already canonical/.test(run.stdout), 'BLACK BOX: a second --format changes nothing');
      run = cli('--check', '--base', 'HEAD');
      ok(/byte form — canonical/.test(run.stdout) && !/✗ byte form/.test(run.stdout), 'BLACK BOX: after --format, --check names no byte-form red');
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }

  if (fails.length) {
    console.log(fails.map((f) => '  ✗ ' + f).join('\n'));
    console.log(`${fails.length} failed of ${ran}`);
    process.exit(1);
  }
  console.log(`all ${ran} selftests passed`);
}

function main() {
  if (has('--selftest')) return selftest();
  const text = fs.existsSync(MANIFEST) ? fs.readFileSync(MANIFEST, 'utf8') : null;
  if (has('--format')) {
    if (text === null) {
      console.log('verdict-adoption: --format found no tools/verdict-adoption.json to rewrite');
      process.exit(1);
    }
    const want = canonicalText(JSON.parse(text));
    if (want === text) console.log('verdict-adoption: tools/verdict-adoption.json is already canonical');
    else {
      fs.writeFileSync(MANIFEST, want);
      console.log('verdict-adoption: rewrote tools/verdict-adoption.json in the canonical form; review `git diff` before you commit');
    }
    return;
  }
  const en = enumerate(ROOT);
  const manifest = text !== null ? JSON.parse(text) : { schema: 'tepna.verdict-adoption/1', producers: {} };
  const bf = text !== null ? checkByteForm(text) : { ok: true, errors: [] };
  if (has('--triage')) {
    const unbinned = en.filter((p) => !manifest.producers[p]);
    for (const t of triage(ROOT, unbinned)) console.log(`${t.path}  code:${t.code} comment:${t.comment} json:${t.json}  → ${t.suggest}\n${t.samples.map((s) => '      ' + s).join('\n')}`);
    console.log(`\n${unbinned.length} unbinned of ${en.length} enumerated`);
    return;
  }
  const V = createRequire(import.meta.url)(path.join(ROOT, 'verdict.js'));
  const r = check(en, manifest, V.validate, (e) => runEmits(e, ROOT));
  const c = r.counts;
  console.log(
    `verdict-adoption: ${c.enumerated} producer(s) enumerated · ${c.named} binned — decides ${c.decides} · already-json ${c['already-json']} · word-only ${c['word-only']} · test ${c.test} · adopted ${c.adopted} (validated ${c.validated}, unexamined ${c.unexamined}) · pending ${c.pending}`
  );
  const { readSource, testRefs } = treeReaders(ROOT);
  const g = checkGated(manifest, readSource, testRefs);
  const w = checkWordOnlyClaim(manifest, readSource);
  const wo = checkWordOnlyObject(manifest, readSource, OBJECT_BUILDER_LIBRARIES, buildersOver(en, readSource));
  const bi = argv.indexOf('--base');
  const baseRef = bi >= 0 && argv[bi + 1] ? argv[bi + 1] : 'origin/main';
  const { mergeBase, manifest: baseManifest } = baseManifestAt(ROOT, baseRef);
  const rt = checkRatchet(baseManifest, manifest, (p) => fs.existsSync(path.join(ROOT, p)));
  console.log(
    `verdict-adoption: ${w.checked} word-only row(s) CLAIM nothing is emitted \u00b7 ${w.conceded} concede emission and say why ` +
      `= ${w.wordOnly} word-only \u2014 ${w.flagged.length} still print a decision outside their selftest, all in WO_CLAIM_RATCHET (debt, may only shrink)`
  );
  console.log(
    `verdict-adoption: ${wo.checked} word-only row(s) examined for a constructed tepna.verdict/1 object outside their selftest \u2014 ${wo.flagged.length} construct one directly \u00b7 ${wo.hops.length} through an imported builder (must be 0)`
  );
  console.log(
    `verdict-adoption: ${w.noLocator} of the ${w.checked} have no recognisable selftest locator, so their WHOLE file is scanned \u2014 ` + `that bias runs toward false positives, never toward misses`
  );
  console.log(
    `verdict-adoption: ${g.decides} \`decides\` producer(s) — ${Object.keys(g.gated).length} gated (a selftest or a test names them) · ${g.ungated.length} ungated, all in UNGATED_RATCHET (debt, may only shrink)`
  );
  console.log(
    `verdict-adoption: ${rt.adoptedAtBase} adopted at the merge base ${mergeBase.slice(0, 12)} (${baseRef}) — ${rt.kept} kept · ${rt.retired.length} retired with their file · ${rt.deAdopted.length} DE-ADOPTED (adoption is a ratchet; must be 0)`
  );
  /* The contributions leg (VERDICT-CONTRIBUTIONS §2): the brief table is the population. */
  const setRef = (manifest.contributions && manifest.contributions.enumeratedFrom) || '';
  const setPath = setRef.split(' §')[0];
  const setAbs = setPath ? path.join(ROOT, setPath) : '';
  let cr;
  if (!setPath) cr = { ok: false, errors: ['contributions: tools/verdict-adoption.json carries no `contributions.enumeratedFrom`, so the leg has no population to read'], counts: {} };
  else if (!fs.existsSync(setAbs)) cr = { ok: false, errors: [`contributions: the named set points at ${setPath}, which is not in this tree`], counts: {} };
  else cr = checkContributions(manifest, fs.readFileSync(setAbs, 'utf8'), V.validate, (e) => runEmits(e, ROOT));
  const cc = cr.counts;
  console.log(
    `verdict-adoption: contributions — ${cc.table ?? 0} figure(s) in the named set ${setPath || '(unset)'} · ${cc.figures ?? 0} row(s) here · ` +
      `adopted ${cc.adopted ?? 0} (read ${cc.read ?? 0}, block examined ${cc.examined ?? 0}) · pending ${cc.pending ?? 0}`
  );
  if (Array.isArray(V.CONTRIBUTION_METHODS) && V.CONTRIBUTION_METHODS.slice().sort().join('|') !== CONTRIBUTION_METHODS.slice().sort().join('|'))
    cr.errors.push(`contributions: the method set here (${CONTRIBUTION_METHODS.join('|')}) differs from verdict.js (${V.CONTRIBUTION_METHODS.join('|')}) — verdict.js owns it, so follow it here`);
  console.log(`verdict-adoption: byte form — ${text === null ? 'no manifest file' : bf.ok ? 'canonical' : `NOT canonical from line ${bf.line}`}`);
  const errors = [...bf.errors, ...r.errors, ...g.errors, ...w.errors, ...wo.errors, ...rt.errors, ...cr.errors];
  /* THE UNEXAMINED SET IS PRINTED ON EVERY PATH, red or green: a reviewer who sees only the reds
     cannot tell that a producer went unread, and that is the reading the row was written about. */
  const unexamined = [...(r.unexamined || []), ...(cr.unexamined || [])];
  for (const u of unexamined) console.log(`  ⏱ UNEXAMINED ${u.path}: ${u.message} — \`${u.cmd}\``);
  if (errors.length) {
    console.log(errors.map((e) => '  ✗ ' + e).join('\n'));
    console.log(`\n✗ ${errors.length} red(s) — the population and the manifest are not equal, an adoption does not hold, or a check has no test`);
    process.exit(1);
  }
  if (unexamined.length) {
    /* EXIT 2 IS "I COULD NOT LOOK", NEVER "I LOOKED AND IT FAILED". Exit 1 above says an adoption
       does not hold; this says the box was too busy to read one, which §🧾 calls NOT_RUN and §4b
       calls a verdict about something never examined. The code is the machine-readable half, since
       this gate's result IS its exit code and summary line (its own manifest row says so). */
    console.log(
      `\n⏱ UNKNOWN — ${unexamined.length} adopted producer(s) hit the cap and were never read, so this run says NOTHING about them, pass or fail. ` +
        "This is contention, not a failing adoption: re-run the step alone with `npm run verify:verdict-adoption`, and if it holds at an idle load, raise that row's `emits.timeoutMs`."
    );
    process.exit(2);
  }
  console.log(
    '✓ the manifest partitions the enumerated population; every adoption read and valid; every check is gated or in the ratchet; nothing adopted on the base was de-adopted; ' +
      `the contributions rows equal the ${cc.table ?? 0} figures of the named set`
  );
}
if (isCliEntry(import.meta.url)) main();
