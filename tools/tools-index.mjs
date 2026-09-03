#!/usr/bin/env node
/*
 * tools/tools-index.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * GENERATE `docs/TOOLS-INDEX.md` — one line per tool, so a capability can be FOUND without already
 * knowing its filename.
 *
 * WHY THIS EXISTS. Seven times in two weeks a session proposed building something this repo already
 * had, under a different name. Measured 2026-09-03: of 170 tools, only 55 are named ANYWHERE in
 * `DOCS-INDEX.md`, and those are incidental mentions inside brief descriptions rather than an index.
 * So the only ways to find an existing tool were: already know its filename, read 170 headers, or run
 * `doc-search.mjs` — which exists ONLY on the primary development machine. For a fresh clone, for CI,
 * and for any other GitHub user, discovery was `git grep` and therefore your own vocabulary.
 *
 * ⚠️ WHAT IT DOES NOT FIX, stated so nobody oversells it. An index only MATCHES if its one-liner uses
 * the searcher's vocabulary — the naming problem recurs one level up. What actually defeats vocabulary
 * mismatch here is SCANNING: 170 lines can be read end to end in a minute; 170 files cannot. That is
 * the mechanism. Grep it if you like, but read it when you are about to build something.
 *
 * 🔴 A TOOL WITH NO PURPOSE LINE IS EMITTED LOUDLY, NEVER OMITTED. If the generator silently skipped
 * the tools it could not parse, those would stay exactly as invisible as they are now — the defect
 * reproduced inside its own fix, on a page that reads complete. Same reasoning as an exclusion list
 * rather than a floor: the excluded members must be visible or the count lies.
 *
 * ⚠️ EXTRACTION IS PARAGRAPH-WISE, NOT LINE-WISE, and that took three tries. A line-wise filter reads
 * the Apache boilerplate's WRAPPED CONTINUATION ("project root, or http://www.apache.org/...") as a
 * purpose, and reported 170-of-170 coverage while producing garbage — three times, each time with a
 * clean-looking count. The count is not the check: read the SAMPLE. Paragraphs are split on blank or
 * rule-only comment lines, and any paragraph carrying licence noise is dropped whole.
 *
 * Usage:
 *   node tools/tools-index.mjs            # write docs/TOOLS-INDEX.md
 *   node tools/tools-index.mjs --check    # drift check (CI/gate); non-zero if stale
 *   node tools/tools-index.mjs --selftest
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'TOOLS-INDEX.md');

/* Any paragraph containing one of these is licence/boilerplate, not a purpose. Matched against the
   JOINED paragraph so a wrapped continuation is caught with its opening line. */
const NOISE = /Licensed under|apache\.org\/licenses|WITHOUT WARRANTIES|Copyright \d{4}|SPDX-License|See LICENSE|You may obtain|except in compliance|limitations under/i;
const RULE = /^[\s─━=*#·\-—_]+$/;

function paragraphsOf(src) {
  const lines = String(src).split('\n').slice(0, 60);
  const i = lines.findIndex((l) => /SPDX-License-Identifier/.test(l));
  if (i < 0) return [];
  const close = lines.slice(i + 1).findIndex((l) => /\*\//.test(l));
  const bodyLines = close >= 0 ? lines.slice(i + 1, i + 1 + close) : lines.slice(i + 1);
  const body = bodyLines.map((l) =>
    l
      .replace(/^\s*\*\s?/, '')
      .replace(/^\s*\/\*+/, '')
      .trimEnd()
  );
  const paras = [];
  let cur = [];
  for (const l of body) {
    const t = l.trim();
    if (!t || RULE.test(t)) {
      if (cur.length) {
        paras.push(cur);
        cur = [];
      }
    } else cur.push(t);
  }
  if (cur.length) paras.push(cur);
  return paras.map((p) => p.join(' '));
}

function cleanParagraph(joined) {
  if (NOISE.test(joined)) return null;
  let t = joined.replace(/^[─━=*·\-—\s]+/, '').trim();
  if (/^[\w./-]+\.(mjs|js)\b\s*[—-]?\s*Tepna\s*$/.test(t)) return null;
  t = t.replace(/^[\w./-]+\.(mjs|js)\s+—\s+/, '');
  t = t.replace(/[─━=]{3,}.*$/, '').trim();
  t = t
    .replace(/\(?\s*(?:doi:\s*)?10\.\d{4,}\/[^\s,;)\]]+\s*\)?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;])/g, '$1')
    .trim();
  return t.length < 12 ? null : t.replace(/\s+/g, ' ');
}

function remainingParagraphs(src) {
  return paragraphsOf(src).map(cleanParagraph).filter(Boolean);
}

export function purposeFromSource(src) {
  const lines = String(src).split('\n').slice(0, 60);
  const i = lines.findIndex((l) => /SPDX-License-Identifier/.test(l));
  if (i < 0) return null;
  /* Stop at the comment terminator. Without this the closing delimiter strips to a bare `/` and JOINS
     the last paragraph — "…long enough. /" — which real files usually hide because another paragraph
     follows, and which would silently corrupt any header whose purpose IS its final paragraph.
     (Writing that delimiter literally here would have closed THIS comment — which is exactly how the
     first version of this note broke the file.) */
  const close = lines.slice(i + 1).findIndex((l) => /\*\//.test(l));
  const bodyLines = close >= 0 ? lines.slice(i + 1, i + 1 + close) : lines.slice(i + 1);
  const body = bodyLines.map((l) =>
    l
      .replace(/^\s*\*\s?/, '')
      .replace(/^\s*\/\*+/, '')
      .trimEnd()
  );
  const paras = [];
  let cur = [];
  for (const l of body) {
    const t = l.trim();
    if (!t || RULE.test(t)) {
      if (cur.length) {
        paras.push(cur);
        cur = [];
      }
    } else cur.push(t);
  }
  if (cur.length) paras.push(cur);
  for (const p of paras) {
    const joined = p.join(' ');
    if (NOISE.test(joined)) continue;
    let t = joined.replace(/^[─━=*·\-—\s]+/, '').trim();
    if (/^[\w./-]+\.(mjs|js)\b\s*[—-]?\s*Tepna\s*$/.test(t)) continue;
    t = t.replace(/^[\w./-]+\.(mjs|js)\s+—\s+/, '');
    t = t.replace(/[─━=]{3,}.*$/, '').trim(); // a trailing box-drawing rule on the same line
    /* 🔴 STRIP DOIs. A tool header may cite a paper properly — author, year, journal, DOI — but this
       index reproduces only ONE LINE of it, and a DOI severed from its attribution is exactly the
       "fabricated authority" CLAUDE.md §📚 forbids: the link still resolves and still lands on the
       right paper, which is what makes a wrong or context-free citation undetectable to a reader.
       `citation-ledger` gates every DOI on a `docs/**.md` surface and caught this on the first full
       run — the generated index inherited Victor & Purpura's DOI from `beat-correspondence.mjs`.
       Strip rather than exempt the file: the citation belongs in the tool, not in a pointer to it. */
    t = t
      .replace(/\(?\s*(?:doi:\s*)?10\.\d{4,}\/[^\s,;)\]]+\s*\)?/gi, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.,;])/g, '$1')
      .trim();
    if (t.length < 12) continue;
    return t.replace(/\s+/g, ' ');
  }
  return null;
}

/* A first paragraph is often just a POINTER — "EXTERNAL-METHODS-SURVEY §2's measurement." — which
   carries no capability information and defeats the index's whole purpose. Measured on the first full
   generation: 46 of 171 rows were that thin. So when the opening is short, keep reading: append
   following paragraphs until there is enough to tell a reader what the tool DOES.
   Appending rather than stripping the reference is deliberate — stripping "EXTERNAL-METHODS-SURVEY §3's"
   leaves "question, in our own units.", which is worse than the pointer it replaced. */
export function purposeWithContext(src, min = 60) {
  const first = purposeFromSource(src);
  if (!first || first.length >= min) return first;
  const rest = remainingParagraphs(src);
  let out = first;
  for (const p of rest) {
    if (out.length >= min) break;
    if (p === first) continue;
    out = `${out} ${p}`;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/* ⚠️ TAKE SENTENCES UNTIL THERE IS SUBSTANCE, not just the first one. A single-sentence cut UNDID
   `purposeWithContext` for precisely the rows it exists to fix: "EXTERNAL-METHODS-SURVEY §2." is a
   complete sentence, so the continuation was appended and then immediately truncated away. The tell
   was the table carrying 6 rows under 45 chars while the raw purposes carried only 2 — two functions
   fighting, visible only by measuring the same property at both ends. */
function leadIn(t, min = 60, max = 190) {
  const parts = String(t).split(/(?<=[.!?])\s+/);
  let out = '';
  for (const p of parts) {
    out = out ? `${out} ${p}` : p;
    if (out.length >= min) break;
  }
  if (!out) out = String(t);
  if (out.length > max) out = `${out.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
  return out;
}

export function buildIndex(entries) {
  const missing = entries.filter((e) => !e.purpose);
  const out = [
    '<!-- SPDX-License-Identifier: Apache-2.0 -->',
    '<!-- GENERATED by tools/tools-index.mjs — do not edit by hand; run `node tools/tools-index.mjs`. -->',
    '',
    '# Tools index',
    '',
    "One line per tool in `tools/`, generated from each file's header. **Read this before building",
    'anything** — seven times in two weeks a session proposed building what already existed under',
    'another name.',
    '',
    '⚠️ This index helps by being SCANNABLE, not by matching your vocabulary. Read it end to end when',
    'you are about to build; a grep of it only finds the words its author happened to use.',
    '',
    `**${entries.length} tools** · ${entries.length - missing.length} with a purpose line · **${missing.length} without**`,
    '',
    '| tool | purpose |',
    '|---|---|'
  ];
  for (const e of entries) {
    const p = e.purpose ? leadIn(e.purpose).replace(/\|/g, '\\|') : '**⚠ NO PURPOSE LINE — add one to the header**';
    out.push(`| [\`${e.name}\`](../tools/${e.name}) | ${p} |`);
  }
  out.push('');
  return out.join('\n');
}

function collect() {
  return readdirSync(join(ROOT, 'tools'))
    .filter((f) => /\.mjs$/.test(f))
    .sort()
    .map((name) => ({ name, purpose: purposeWithContext(readFileSync(join(ROOT, 'tools', name), 'utf8')) }));
}

function selfTest() {
  let fail = 0;
  const eq = (cond, name) => {
    if (cond) console.log(`  ✓ ${name}`);
    else {
      fail++;
      console.log(`  ✗ ${name}`);
    }
  };
  const hdr = (body) => `/*\n * x.mjs — Tepna\n * SPDX-License-Identifier: Apache-2.0\n *\n${body}\n */`;
  /* ⚠️ THE BUG THAT TOOK THREE TRIES. A line-wise filter drops "Licensed under…" and then accepts its
     WRAPPED CONTINUATION as the purpose. Paragraph-wise is the fix; this pins it. */
  eq(
    purposeFromSource(
      hdr(
        ' * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the\n * project root, or http://www.apache.org/licenses/LICENSE-2.0\n *\n * REAL PURPOSE goes here and is long enough.'
      )
    ) === 'REAL PURPOSE goes here and is long enough.',
    'a wrapped licence paragraph is dropped WHOLE, not line by line'
  );
  eq(purposeFromSource(hdr(' * ─────────────\n * A real purpose after a rule line.')) === 'A real purpose after a rule line.', 'a box-drawing rule is not a purpose');
  eq(
    !/10\.\d{4}/.test(purposeFromSource(hdr(' * Uses the VICTOR-PURPURA edit distance (Victor & Purpura 1996, doi:10.1152/jn.1996.76.2.1310) on point processes.')) || ''),
    'a DOI is STRIPPED — a bare DOI on a generated surface is unattributed authority, and citation-ledger reds it'
  );
  /* A first paragraph that is only a POINTER carries no capability information — 46 of 171 rows were
     that thin on the first generation. Keep reading rather than stripping the reference: stripping
     "SURVEY §3's" leaves "question, in our own units.", which is worse than the pointer. */
  {
    const thin = hdr(' * EXTERNAL-METHODS-SURVEY §2.\n *\n * Two tools pick a night by different rules and disagree.');
    eq(purposeFromSource(thin) === 'EXTERNAL-METHODS-SURVEY §2.', 'the bare first paragraph is what purposeFromSource returns');
    eq(/disagree/.test(purposeWithContext(thin) || ''), 'purposeWithContext CONTINUES into the next paragraph when the opening is only a pointer');
    eq(
      purposeWithContext(hdr(' * A full sentence that already says what the tool does and is plenty long.')) === 'A full sentence that already says what the tool does and is plenty long.',
      'a sufficient opening is left alone — no needless concatenation'
    );
  }
  eq(purposeFromSource('/*\n * no spdx here\n */') === null, 'no SPDX ⇒ no purpose (refuse, do not guess)');
  eq(purposeFromSource(hdr(' * short')) === null, 'a too-short fragment is not a purpose');
  /* 🔴 THE LOUD-FAILURE CONTRACT. A tool with no purpose must be EMITTED, never skipped — otherwise
     the generator hides exactly the tools this index exists to surface. */
  /* The two functions FOUGHT: purposeWithContext appended substance, then a first-sentence cut threw
     it away, because a bare pointer IS a complete sentence. This pins the end-to-end result — the row
     as rendered — rather than either function alone, which is the only level at which the bug existed. */
  eq(/disagree/.test(buildIndex([{ name: 'x.mjs', purpose: 'SURVEY §2. Two tools disagree about the night.' }])), 'the RENDERED row keeps the continuation — a pointer sentence alone is not enough');
  const md = buildIndex([
    { name: 'a.mjs', purpose: 'Does a thing properly.' },
    { name: 'b.mjs', purpose: null }
  ]);
  eq(md.includes('b.mjs') && /NO PURPOSE LINE/.test(md), 'a tool with NO purpose is emitted loudly, never omitted');
  eq(/\*\*1 without\*\*/.test(md), 'the header counts the ones without a purpose');
  eq(buildIndex([{ name: 'p.mjs', purpose: 'A | pipe breaks the table.' }]).includes('\\|'), 'a pipe in a purpose is escaped so the table survives');
  console.log(fail ? `\ntools-index selftest: ${fail} FAILED` : '\ntools-index selftest: all passed');
  return fail ? 1 : 0;
}

/* Guarded so the module can be IMPORTED (by its own selftest, or any future caller) without running.
   Without this the first `import` writes the file and exits — measured while debugging this file. */
const IS_MAIN = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
if ((IS_MAIN && argv.includes('--selftest')) || argv.includes('--self-test')) process.exit(selfTest());

const entries = IS_MAIN ? collect() : [];
const text = buildIndex(entries);
const missing = entries.filter((e) => !e.purpose);

if (IS_MAIN && argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {
    console.log('✗ docs/TOOLS-INDEX.md is MISSING — run `node tools/tools-index.mjs`');
    process.exit(1);
  }
  if (current !== text) {
    console.log('✗ docs/TOOLS-INDEX.md is STALE — run `node tools/tools-index.mjs`');
    process.exit(1);
  }
  console.log(`✓ docs/TOOLS-INDEX.md current — ${entries.length} tools, ${missing.length} without a purpose line`);
  process.exit(0);
}

if (IS_MAIN) {
  writeFileSync(OUT, text);
  console.log(`✓ wrote docs/TOOLS-INDEX.md — ${entries.length} tools, ${missing.length} without a purpose line`);
  if (missing.length) console.log(`  ⚠ no purpose line: ${missing.map((m) => m.name).join(', ')}`);
  process.exit(0);
}
