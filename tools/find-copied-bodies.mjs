#!/usr/bin/env node
/*
 * tools/find-copied-bodies.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * FIND TESTS THAT EXERCISE A PRIVATE COPY INSTEAD OF THE SHIPPED SYMBOL.
 *
 * THE CLASS, and it was proven on a sibling project rather than imagined here: a v2.0 shipped
 * "37 property tests, host-executable" that included only two headers and then DEFINED ITS OWN COPIES
 * of five shipped functions. Byte-identical to the originals, which is exactly why nobody noticed.
 * Mutation, with a control:
 *     revert a real bug into the shipped file   SURVIVED   37/37 green
 *     change a shipped constant                SURVIVED   37/37 green
 *     break a function the tests DO import      KILLED     34/3
 * The third is what makes the first two mean anything. The surviving mutant reintroduced a truncation
 * bug the maintainer had fixed and been credited for.
 *
 * 🔴 WHY NAME-MATCHING CANNOT FIND THIS, and why this hashes instead. A name scan of capture-host
 * returned 2 hits, both false positives. Had that author named the copy `spool_to_edf_local`, every
 * name scan sees nothing and the suite still tests a copy. "A copy under a different name" is not an
 * edge case — it is the MATURE FORM. So the key is the normalised BODY, not the name.
 *
 * THE NORMALISATION, and each step was probed on a plant before this file existed:
 *   1. Function extents come from `biome search` — a real parse, so comments, strings and template
 *      literals cannot be mistaken for code. A hand-rolled scanner desynchronises; measured.
 *   2. Identifiers are renamed POSITIONALLY, by first appearance. Probed against the case designed to
 *      break it — two functions identical but for parameter names AND a local shadowing a parameter:
 *      positional hashes them EQUAL (the copy is detected), by-name hashes them UNEQUAL (missed).
 *   3. The function's own name is dropped, so `shippedFn` and `testLocalCopy` collide by construction.
 *
 * ⚠️ EXACT-MATCH-AFTER-NORMALISATION ONLY, deliberately. A copy that reorders two independent
 * statements defeats this, and chasing that turns a check into a research project. Out of scope until
 * something demands it.
 *
 * ⚠️ NEAR-MISSES ARE THE INTERESTING OUTPUT AND THIS TOOL CANNOT SEE THEM. A body that WAS a copy and
 * has since drifted by one line is STRICTLY WORSE than one still identical — the test is green while
 * asserting different behaviour from the shipped code — and an exact-match detector ranks it as clean.
 * Stated here because a limit a reader has to discover is a trap.
 *
 * 🔴 RUNTIME: ~5 MINUTES, AND ONE FILE IS ALL OF IT. Measured, after two wrong guesses:
 *     biome search over the 112 shipped .js        8.4 s
 *     tests/dex-tests.js alone (53 942 lines)    303   s
 *     everything else                              ~3   s
 * Grit's cost is superlinear in FILE SIZE, not in corpus size, and one outlier dominates entirely.
 * I first blamed process spawning (batching to a single invocation changed nothing) and then my own
 * line-slicing (offset slicing changed nothing) — both guesses, neither measured. Instrumenting the
 * call took one command and settled it.
 * CONSEQUENCE: NOT GATEABLE as-is. And excluding the expensive file is not the fix — `dex-tests.js` is
 * the main suite and therefore the single most likely place for a test-local copy to hide, so dropping
 * it would remove exactly the coverage the tool exists for. Run it on demand; treat 5 minutes as the
 * price of scanning the file that matters.
 *
 * 🔴 MEASURED YIELD ON THIS REPO, 2026-09-05: FIVE collisions, ZERO of them this tool's defect.
 * Recorded here so the next reader does not re-derive an evening — they will run it, see five hits,
 * and need this paragraph rather than the list.
 *
 *   NULL FIRST, on the population that matches the finding (test↔shipped, not shipped↔shipped —
 *   a null drawn from the wrong pair is how a rate gets quoted for a comparison it never measured):
 *       3 unrelated test↔shipped pairs · 356 bodies · 0 cross-file collisions
 *   So at the 12-token floor chance collisions are ~0 and the hits are signal, not volume.
 *
 *   THE FIVE, sized (tokens after normalisation) and read:
 *     136  tests/oxy-hang.worker.js:20   ≡ 3 worker files   `installDomShim`
 *      40  tests/oxy-hang.worker.js:46   ≡ 2 worker files
 *      23  tests/tch-golden-inputs.js:38 ≡ cohort-gen.js:43
 *      21  tests/apnea-null-twins.js:35  ≡ motiondex-dsp.js:1297   `mulberry32`
 *      18  tests/oxy-hang.worker.js:22   ≡ 2 worker files
 *
 *   ALL FIVE ARE REAL DUPLICATES — the hashing is correct — and NONE is "a test exercising a private
 *   copy of the thing under test". `installDomShim` is a DOM stub, and these workers are blob-URL
 *   minted so they cannot share imports; `mulberry32` is the public-domain seeded PRNG, `a` in the
 *   test and `s` in the DSP, which positional renaming caught precisely because only the variable
 *   differs. Duplicating a PRNG is how deterministic fixtures are made.
 *
 * ⚠️ SO: A DUPLICATED BODY IS NECESSARY BUT NOT SUFFICIENT. The missing predicate is whether the local
 * copy is the SUBJECT OF AN ASSERTION — a test that defines a duplicate and merely calls it is
 * scaffolding; one that asserts on its result is testing its own copy. Not implemented, and not
 * speculatively worth implementing at a zero yield. NO residue rows were filed for the five: both
 * duplications are deliberate, and filing them would send a later session to "fix" correct code.
 *
 * Usage:
 *   node tools/find-copied-bodies.mjs             # report (always exit 0)
 *   node tools/find-copied-bodies.mjs --selftest
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIOME = join(ROOT, 'node_modules', '.bin', 'biome');

/** Positional rename by first appearance, then hash. The function's own name is EXCLUDED by the
    caller so that a copy under another name collides. */
export function normaliseTokens(tokens) {
  const m = new Map();
  return tokens
    .map((t) => {
      if (KEYWORD.has(t)) return t;
      if (!m.has(t)) m.set(t, `v${m.size}`);
      return m.get(t);
    })
    .join(' ');
}

export function hashBody(tokens) {
  return createHash('sha256').update(normaliseTokens(tokens)).digest('hex').slice(0, 12);
}

/* 🔴 COUNT `diagnostics`, NEVER THE SUMMARY LINE. biome's human output says "Found 1 match" where the
   JSON reports 2 — measured three times. A summary is a rendering, not a count. */
/* ⚠️ ONE INVOCATION FOR THE WHOLE CORPUS, not one per file. Per-file spawning cost 5 m 31 s over 131
   files — the search itself is microseconds; the process launch is everything. Batching took it to
   seconds. Diagnostics carry their own path, so grouping after the fact loses nothing. */
function functionSpans(files) {
  try {
    const out = execFileSync(BIOME, ['search', '`function $n($a) { $b }`', ...files, '--reporter=json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const i = out.indexOf('{');
    if (i < 0) return [];
    const byFile = new Map();
    for (const d of JSON.parse(out.slice(i)).diagnostics || []) {
      const raw = d.location?.path?.file || d.location?.path || '';
      if (!d.location?.start || !d.location?.end) continue;
      if (!byFile.has(raw)) byFile.set(raw, []);
      byFile.get(raw).push(d.location);
    }
    return byFile;
  } catch {
    return [];
  }
}

/** Slice a span, drop the function's own name, and tokenise the identifiers. Safe because the span
    came from a parse — the risk was always in FINDING the extent, never in reading a known one. */
/* ⚠️ SLICE THE RAW TEXT BY OFFSET — do NOT rebuild the body from a line array. The first version did
   `lines.slice(...).join('\n')` per body, which is O(body length) allocation 4729 times over a 105k-line
   corpus: the whole run took 5 m 6 s. `biome search` alone over the same corpus takes 8.4 s, so I was
   one measurement away from reporting "Grit is too slow to gate" about my own string handling.
   Precomputing line-start offsets once per file makes each body an O(1) slice. */
export function lineOffsets(text) {
  const offs = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') offs.push(i + 1);
  return offs;
}

export function bodyTokens(text, offs, loc) {
  const a = offs[loc.start.line - 1] + (loc.start.column - 1);
  const b = offs[loc.end.line - 1] + (loc.end.column - 1);
  return tokenise(text.slice(a, b));
}

/* JS keywords are NOT renamed. Positional renaming maps by first appearance, so without this a `const`
   and a `let` in the same slot would map to the same symbol and two structurally different bodies would
   collide. Keeping keywords literal preserves the shape the hash is supposed to compare. */
const KEYWORD = new Set([
  'function',
  'return',
  'const',
  'let',
  'var',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'new',
  'delete',
  'typeof',
  'instanceof',
  'in',
  'of',
  'this',
  'null',
  'undefined',
  'true',
  'false',
  'try',
  'catch',
  'finally',
  'throw',
  'await',
  'async',
  'yield',
  'class',
  'extends'
]);

function tokenise(text) {
  /* ⚠️ DROP THE FUNCTION'S OWN NAME — `.slice(2)` past `function` AND the name. An earlier version
     sliced 1, which dropped only the `function` keyword and LEFT the name in the token stream, so a
     copy under a different name could never collide. That is the entire failure this tool detects,
     disabled by an off-by-one; the selftest caught it before the tool ever ran. */
  const raw = (text.match(/[A-Za-z_$][\w$]*/g) || []).slice(2);
  return raw;
}

function selfTest() {
  let fail = 0;
  const ok = (c, n) => {
    console.log((c ? '  ✓ ' : '  ✗ ') + n);
    if (!c) fail++;
  };
  ok(normaliseTokens(['a', 'b', 'a']) === 'v0 v1 v0', 'positional rename by first appearance');
  ok(normaliseTokens(['x', 'y', 'x']) === normaliseTokens(['a', 'b', 'a']), 'two bodies differing only in identifier NAMES normalise identically');
  ok(normaliseTokens(['a', 'b', 'b']) !== normaliseTokens(['a', 'b', 'a']), '…and a different STRUCTURE does not');
  /* The case designed to break a positional scheme: a local shadowing a parameter. */
  ok(
    hashBody(['a', 'b', 't', 'a', 'b', 'a', 't', 'a']) === hashBody(['x', 'y', 't', 'x', 'y', 'x', 't', 'x']),
    'a local SHADOWING a parameter still hashes equal (the case positional renaming exists for)'
  );
  ok(tokenise('function shippedFn(a){return a;}')[0] === 'a', "the function's OWN name is dropped");
  ok(!tokenise('function shippedFn(a){return a;}').includes('shippedFn'), '…so a copy under another NAME still collides');
  ok(normaliseTokens(['const', 'a']) !== normaliseTokens(['let', 'a']), 'keywords are NOT renamed — const and let must not collide in the same slot');
  console.log(fail ? `\nfind-copied-bodies selftest: ${fail} FAILED` : '\nfind-copied-bodies selftest: all passed');
  return fail ? 1 : 0;
}

const IS_MAIN = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
if (IS_MAIN && (argv.includes('--selftest') || argv.includes('--self-test'))) process.exit(selfTest());

if (IS_MAIN) {
  const shipped = readdirSync(ROOT)
    .filter((f) => /\.js$/.test(f))
    .sort();
  let testFiles = [];
  try {
    testFiles = readdirSync(join(ROOT, 'tests'))
      .filter((f) => /\.(js|mjs)$/.test(f))
      .map((f) => join('tests', f));
  } catch {
    /* no tests dir */
  }

  const byHash = new Map();
  let bodies = 0;
  const all = [...shipped, ...testFiles];
  const spansByFile = functionSpans(all.map((f) => join(ROOT, f)));
  for (const rel of all) {
    const text = readFileSync(join(ROOT, rel), 'utf8');
    const offs = lineOffsets(text);
    const abs = join(ROOT, rel);
    for (const loc of spansByFile.get(abs) || spansByFile.get(rel) || []) {
      const toks = bodyTokens(text, offs, loc);
      if (toks.length < 12) continue; // a 3-line accessor collides with everything; not evidence
      bodies++;
      const h = hashBody(toks);
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h).push({ rel, line: loc.start.line });
    }
  }

  const crossings = [];
  for (const [h, hits] of byHash) {
    const inTests = hits.filter((x) => x.rel.startsWith('tests/'));
    const inShipped = hits.filter((x) => !x.rel.startsWith('tests/'));
    if (inTests.length && inShipped.length) crossings.push({ h, inTests, inShipped });
  }

  console.log('\n== test bodies that are COPIES of a shipped body (normalised, name-blind) ==\n');
  console.log(`   SCANNED   ${shipped.length} root .js + ${testFiles.length} tests/*  →  ${bodies} function bodies`);
  console.log('   EXCLUDED  bodies under 12 identifier tokens — a short accessor collides with everything');
  console.log('   METHOD    exact match after positional renaming. A copy that REORDERS statements is');
  console.log('             invisible here, and a copy that has since DRIFTED is worse and also invisible.\n');
  for (const c of crossings) {
    console.log(`   ${c.h}  ${c.inTests.map((x) => `${x.rel}:${x.line}`).join(', ')}`);
    console.log(`             ≡ ${c.inShipped.map((x) => `${x.rel}:${x.line}`).join(', ')}`);
  }
  console.log(`\n   ${crossings.length} test-body ≡ shipped-body collision(s).`);
  console.log('   ADVISORY — a collision is a QUESTION; read both before calling it a copy. Exit is always 0.');
  process.exit(0);
}
