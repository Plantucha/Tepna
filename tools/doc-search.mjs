/*
 * tools/doc-search.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * ── "HAS THIS ALREADY BEEN DECIDED?" OVER 460+ DOCUMENTS ────────────────────────────────────────
 *
 * CLAUDE.md records this failure repeatedly and by name: four sessions independently proposing a fix
 * the repo had already measured futile; five reviewers falsifying in minutes a paragraph nobody had
 * queried; "if you think two populations are inseparable, RUN THE QUERY before writing that down."
 * With 460+ briefs, audits and specs, `grep` only works if you already know the vocabulary the
 * decision was written in — and you do not, which is why you are searching.
 *
 * Measured instance, 2026-08-16: a week of hand-writing equivalent-mutant proofs for `clock.js`,
 * while `briefs/MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md` had already measured that file's ceiling
 * (81.9 % raw / 100 % distinguishable) and RATIFIED a decision about it. A semantic query for
 * "trivial compiler equivalence / equivalent mutants" surfaced it at rank 1. No grep I ran that week
 * would have: I was searching for "TCE" and "equivalence", the brief is titled after the DENOMINATOR.
 *
 * ── WHY THIS USE OF A LOCAL MODEL, WHEN TWO OTHERS WERE MEASURED USELESS ────────────────────────
 * The same model, on this box, produced ZERO confirmed findings across two generation tasks —
 * ranking assertion strength (0 of 3 flags real, and it missed the known-weak control) and auditing
 * code against the deep-audit charter (7 prompt variants, every substantive claim false, including
 * one three variants AGREED on). Generation asks it to judge correctness; its errors are confident,
 * specific, and cost a verification run each to disprove.
 *
 * Retrieval inverts every one of those properties:
 *
 *   output          a PATH to a real document        (not a claim about correctness)
 *   failure mode    a wasted read                    (not a falsehood to disprove)
 *   verification    open the file                    (not reconstruct the reasoning)
 *
 * 🔴 THIS TOOL THEREFORE NEVER ANSWERS A QUESTION. It ranks paths. The moment it summarises what a
 * brief SAYS, it is back in the failure mode above, with a plausible summary of a document the
 * reader then does not open.
 *
 * ── 🔴 RECALL@5 IS THE METRIC. DO NOT OPTIMISE TOP-1 ────────────────────────────────────────────
 * The costs are wildly asymmetric, and that asymmetry is the whole design:
 *
 *   a FALSE NEGATIVE ("nothing found")  costs a session rebuilding finished work — a day of
 *                                       first-principles reasoning toward an answer two briefs
 *                                       already held
 *   a FALSE POSITIVE                    costs opening one file
 *
 * So any tuning that raises top-1 by NARROWING the candidate set trades a cheap error for an
 * expensive one and makes the tool worse while the headline number improves. Publish recall@5;
 * guard the empty result. Measured here: recall@5 4/5, top-1 2/5 — and the 2/5 is not the figure
 * that matters, because the reader opens five.
 *
 * ⚠️ THE WORST OUTCOME AND THE WORST BUG ARE THE SAME SHAPE, which is not a coincidence: this file
 * once exited 0 with empty stdout when renamed, and "nothing found" is exactly what a session
 * cannot distinguish from a true negative.
 *
 * ── ⚠️ ADJACENCY IS NOT EQUIVALENCE ────────────────────────────────────────────────────────────
 * A near-neighbour index will systematically place the two nearest-but-DISTINCT methods side by
 * side. Real instance: a "two-line lag-1 autocorrelation" (a CORRELATION test) ranks adjacent to
 * Riley & Greenhall lag-1 (a NOISE-TYPE IDENTIFIER) — same two words, different statistic,
 * different question. The reader opens the right file and draws the wrong inference from its
 * neighbour. That is a property of retrieval, not a defect, and it is the one way a path-ranking
 * tool can still mislead.
 *
 * ⚠️ AND IT FAILS SOFT. If the embedder is unreachable it degrades to a deterministic token search
 * rather than erroring, because a search tool that is down is a search tool nobody uses — and the
 * fallback is the `grep` you would have run anyway.
 *
 *   node tools/doc-search.mjs "has anyone measured the equivalent mutant ceiling?"
 *   node tools/doc-search.mjs --selftest
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.mutation-sweeps', 'doc-search-index.json');
const OLLAMA = process.env.DEX_OLLAMA || 'http://localhost:11434';
const EMBED_MODEL = process.env.DEX_EMBED || 'bge-m3';
const DIRS = ['briefs', 'audits', 'docs', 'papers', '.'];

/* Chunked, not whole-file: indexing only a document's opening finds TOPICS, and the thing you are
   usually looking for is a PASSAGE — a decision recorded in §7 of a brief about something else.
   Measured: whole-file indexing put a node-export question at rank 42; the decision it wanted was
   three sections into a brief whose title is about something adjacent. */
export function chunk(text, size = 1200, stride = 900) {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return [];
  const out = [];
  for (let i = 0; i < t.length; i += stride) {
    out.push(t.slice(i, i + size));
    if (i + size >= t.length) break;
  }
  return out;
}

export function cosine(a, b) {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? d / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/* The deterministic fallback, and the thing every result is ultimately checked against: a document
   either contains your words or it does not. */
export function tokenScore(query, text) {
  const q = [
    ...new Set(
      String(query)
        .toLowerCase()
        .match(/[a-z0-9_]{3,}/g) || []
    )
  ];
  if (!q.length) return 0;
  const t = String(text).toLowerCase();
  let hit = 0;
  for (const w of q) if (t.includes(w)) hit++;
  return hit / q.length;
}

export function rank(queryVec, entries, query, topN = 8) {
  const scored = entries.map((e) => ({
    file: e.file,
    score: queryVec && e.vec ? cosine(queryVec, e.vec) : tokenScore(query, e.text),
    text: e.text
  }));
  /* Best chunk per file — a long brief must not crowd the list with its own sections. */
  const best = new Map();
  for (const s of scored) if (!best.has(s.file) || best.get(s.file).score < s.score) best.set(s.file, s);
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, topN);
}

/* A reference guide is a document even when it ships as a page. Script and style bodies are dropped
   entirely — an inlined bundle would otherwise flood the index with minified JS that matches every
   query weakly and nothing well. */
export function readDoc(path, raw) {
  const t = String(raw || '');
  if (!/\.html?$/i.test(path)) return t;
  return t
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ');
}

/* Is this module the program being run? Compared by RESOLVED PATH so it survives a rename, a
   symlink, a wrapper, or being vendored under another name. Exported so the property can be
   tested directly — the first version of that test grepped this file for the old buggy
   `endsWith('doc-search.mjs')` and matched the COMMENT that quotes it, which is exactly the
   substring-satisfiable assertion class `tools/gate-tightness.mjs` exists to find. */
export function isEntryPoint(argv1, moduleUrl) {
  if (!argv1 || !moduleUrl) return false;
  try {
    return resolve(argv1) === resolve(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
/* ── 🔴 THE CORPUS MUST PROVE ITSELF, NOT MERELY BE NON-EMPTY ────────────────────────────────────
 * Measured: pointed at a directory with no documents, this printed its header, no hits, its footer,
 * and exited 0 — a fake "nothing found" from the tool whose worst outcome is exactly that. Reachable
 * without any mistake in the ranking: a wrong ROOT, an unreadable directory, a copy vendored
 * somewhere without the docs beside it.
 *
 * ⚠️ A BARE `length > 0` WOULD BE THE SAME DEFECT ONE LEVEL UP — it detects only total loss, which is
 * the failure least likely to happen quietly. Half a corpus silently missing would still pass. So the
 * check is for ANCHORS that any correct checkout must contain: CLAUDE.md and ORIENTATION.md are both
 * required to sit in root (CLAUDE.md says the test suite fetches ORIENTATION.md by path), and a real
 * brief set is never a handful. Absence of those means the corpus is wrong, not that the answer is no. */
export function corpusProblem(files) {
  const has = (f) => files.includes(f);
  if (!files.length) return 'no documents found at all';
  if (!has('CLAUDE.md')) return 'CLAUDE.md is not in the corpus — ROOT is probably wrong';
  if (!has('ORIENTATION.md')) return 'ORIENTATION.md is not in the corpus — ROOT is probably wrong';
  const briefs = files.filter((f) => f.startsWith('briefs/')).length;
  if (briefs < 50) return `only ${briefs} briefs indexed — the brief set is never this small`;
  return null;
}
export function listDocs(root, dirs = DIRS) {
  const out = [];
  for (const d of dirs) {
    const p = d === '.' ? root : join(root, d);
    let names = [];
    try {
      names = readdirSync(p);
    } catch {
      continue;
    }
    /* `papers/` carries prose as .html as well as .md — a reference guide is a document even when it
       ships as a page. Tags are stripped at read time so the index sees the words, not the markup. */
    for (const f of names) if (f.endsWith('.md') || f.endsWith('.html')) out.push(d === '.' ? f : `${d}/${f}`);
  }
  return out.sort();
}

async function embed(inputs) {
  const res = await fetch(`${OLLAMA}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs })
  });
  const j = await res.json();
  if (!j.embeddings) throw new Error(j.error || 'no embeddings returned');
  return j.embeddings;
}

/* Incremental by CONTENT HASH. A brief that has not changed is not re-embedded, so the common case
   (one doc edited) costs one call rather than four hundred. */
async function buildIndex(quiet) {
  const files = listDocs(ROOT);
  let cache = { entries: {}, model: EMBED_MODEL };
  try {
    const c = JSON.parse(readFileSync(CACHE, 'utf8'));
    if (c.model === EMBED_MODEL) cache = c;
  } catch {}
  const entries = [];
  const pending = [];
  for (const f of files) {
    let body;
    try {
      body = readDoc(f, readFileSync(join(ROOT, f), 'utf8'));
    } catch {
      continue;
    }
    const h = createHash('sha256').update(body).digest('hex').slice(0, 16);
    const hit = cache.entries[f];
    const chunks = chunk(`${f} :: ${body}`);
    if (hit && hit.h === h && hit.vecs && hit.vecs.length === chunks.length) {
      chunks.forEach((t, i) => entries.push({ file: f, text: t, vec: hit.vecs[i] }));
    } else {
      pending.push({ file: f, h, chunks });
    }
  }
  let embedded = 0;
  let live = true;
  for (const p of pending) {
    try {
      const vecs = await embed(p.chunks);
      cache.entries[p.file] = { h: p.h, vecs };
      p.chunks.forEach((t, i) => entries.push({ file: p.file, text: t, vec: vecs[i] }));
      embedded += p.chunks.length;
    } catch {
      /* embedder down mid-build: keep the chunk as text so the fallback can still score it */
      live = false;
      p.chunks.forEach((t) => entries.push({ file: p.file, text: t, vec: null }));
    }
  }
  if (embedded) {
    try {
      mkdirSync(dirname(CACHE), { recursive: true });
      writeFileSync(CACHE, JSON.stringify(cache));
    } catch {}
  }
  if (!quiet) process.stderr.write(`  ${files.length} docs · ${entries.length} chunks · ${embedded} newly embedded${live ? '' : ' · EMBEDDER DOWN, token fallback'}\n`);
  return { entries, live };
}

/* 🔴 IDENTITY, NOT FILENAME. This was `process.argv[1].endsWith('doc-search.mjs')`, and a peer
   copied the file to `doc-search-trial.mjs` to try it without touching their tree: the suffix test
   went false, NEITHER branch fired, and the process exited 0 with empty stdout and no diagnostic.

   That is this tool answering "nothing found" — indistinguishable from a true negative — for a
   tool whose entire job is telling you whether something was already decided. Renamed, symlinked,
   invoked through a wrapper or vendored under another name, it would have lied silently. Comparing
   RESOLVED PATHS instead is immune to the name, and the else-branch below makes a non-dispatch
   impossible to mistake for a result. The rename was the peer's slip; the silent success was mine. */
let IS_MAIN = false;
try {
  IS_MAIN = isEntryPoint(process.argv[1], import.meta.url);
} catch {
  IS_MAIN = false;
}
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
  ok('chunking overlaps so a passage is not split away', chunk('x'.repeat(3000)).length >= 3);
  ok('an empty document yields no chunks', chunk('').length === 0);
  ok('a short document is one chunk', chunk('hello world').length === 1);
  ok('cosine of a vector with itself is 1', Math.abs(cosine([1, 2, 3], [1, 2, 3]) - 1) < 1e-12);
  ok('cosine of orthogonal vectors is 0', Math.abs(cosine([1, 0], [0, 1])) < 1e-12);
  ok('a zero vector scores 0 rather than NaN', cosine([0, 0], [1, 1]) === 0);
  ok('token fallback finds the words it was given', tokenScore('allan deviation', 'the allan deviation curve') === 1);
  ok('…and reports a partial match as partial', Math.abs(tokenScore('allan deviation slope', 'the allan curve') - 1 / 3) < 1e-9);
  ok('…and 0 when nothing matches', tokenScore('zzz qqq', 'nothing here') === 0);
  /* One file must not crowd the list with its own sections. */
  const many = [
    { file: 'a.md', text: 'x', vec: [1, 0] },
    { file: 'a.md', text: 'y', vec: [0.9, 0.1] },
    { file: 'b.md', text: 'z', vec: [0.8, 0.2] }
  ];
  ok('results are one row per FILE, best chunk winning', rank([1, 0], many, 'q').length === 2);
  /* 🔴 THE RENAME CONTROL. Copied to another name, the old entry check went false, neither branch
     ran, and it exited 0 with empty output — a fake "nothing found" from a tool whose only job is
     finding things. Identity is now compared by RESOLVED PATH, so this asserts the property. */
  ok('the entry check accepts the module run under its own path', isEntryPoint(fileURLToPath(import.meta.url), import.meta.url));
  /* The MECHANISM, not a tautology: a path that spells the same file differently must still be
     recognised. The first version of this line compared isEntryPoint(...) to itself — always true,
     unable to fail, and caught by biome's noSelfCompare rather than by any test of mine. */
  ok('a differently-spelled path to the same file is still the entry point', isEntryPoint(join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'doc-search.mjs'), import.meta.url));
  ok('a different program is not this module', !isEntryPoint('/usr/bin/node', import.meta.url));
  ok('a missing argv[1] is not an entry point, and does not throw', !isEntryPoint(undefined, import.meta.url));
  ok('html markup is stripped so the index sees words', readDoc('x.html', '<p>allan <b>deviation</b></p>').replace(/\s+/g, ' ').trim() === 'allan deviation');
  ok('an inlined script body is dropped', !/functionx/.test(readDoc('x.html', '<script>functionx()</script><p>real</p>').replace(/\s+/g, '')));
  ok('markdown is returned untouched', readDoc('x.md', '# <not markup>') === '# <not markup>');
  ok('papers/ is in the corpus', DIRS.includes('papers'));
  ok('an empty corpus is refused, not reported as no results', corpusProblem([]) !== null);
  ok('a corpus missing CLAUDE.md is refused', corpusProblem(['ORIENTATION.md'].concat(Array.from({ length: 60 }, (_, i) => `briefs/b${i}.md`))) !== null);
  ok('…and one missing ORIENTATION.md', corpusProblem(['CLAUDE.md'].concat(Array.from({ length: 60 }, (_, i) => `briefs/b${i}.md`))) !== null);
  /* the floor is not `> 0`: half a brief set missing must still refuse */
  ok('a handful of briefs is refused — a floor of >0 would pass this', corpusProblem(['CLAUDE.md', 'ORIENTATION.md', 'briefs/one.md']) !== null);
  ok('a real corpus passes', corpusProblem(listDocs(ROOT)) === null, String(corpusProblem(listDocs(ROOT))));
  ok(
    'the doc list finds briefs',
    listDocs(ROOT).some((f) => f.startsWith('briefs/'))
  );
  ok('…and root docs like CLAUDE.md', listDocs(ROOT).includes('CLAUDE.md'));
  console.log(fail ? '\n✗ ' + fail + ' failed, ' + pass + ' passed' : '\n✓ all ' + pass + ' selftests passed');
  process.exit(fail ? 1 : 0);
}

if (IS_MAIN && !process.argv.includes('--selftest')) {
  const argv = process.argv.slice(2).filter((a) => a !== '--quiet');
  const query = argv.join(' ').trim();
  if (!query) {
    console.error('usage: node tools/doc-search.mjs "<what you are trying to find out>"');
    process.exit(2);
  }
  const problem = corpusProblem(listDocs(ROOT));
  if (problem) {
    console.error('✗ REFUSING TO SEARCH: ' + problem + '.');
    console.error('  An empty result here is indistinguishable from "nothing was decided", which is the');
    console.error('  one answer this tool must never fake. Fix the corpus rather than trusting the silence.');
    process.exit(2);
  }
  const { entries, live } = await buildIndex(process.argv.includes('--quiet'));
  let qv = null;
  if (live) {
    try {
      qv = (await embed([query]))[0];
    } catch {
      qv = null;
    }
  }
  const hits = rank(qv, entries, query, 8);
  console.log(`\n▸ ${qv ? 'semantic' : 'TOKEN-FALLBACK (embedder unreachable)'} · "${query}"\n`);
  for (const h of hits) console.log(`  ${h.score.toFixed(3)}  ${h.file}\n        ${h.text.slice(0, 110).trim()}…`);
  console.log('\n  ⚠ These are PATHS TO READ, not an answer. This tool does not summarise a document,');
  console.log('    and ADJACENCY IS NOT EQUIVALENCE — the two nearest results may answer DIFFERENT');
  console.log('    questions with the same words. Read the one you opened, not the one beside it.');
  console.log('    because a plausible summary of a brief nobody opens is the failure it exists to prevent.\n');
}

/* ⚠️ A THIRD BRANCH THAT CANNOT BE REACHED BY ACCIDENT. If this file is the entry point and neither
   the selftest nor the query branch ran, that is a dispatch failure and it must SAY so — exiting 0
   with empty output is the exact defect this file was patched for. */
if (
  IS_MAIN &&
  !process.argv.includes('--selftest') &&
  !process.argv
    .slice(2)
    .filter((a) => a !== '--quiet')
    .join(' ')
    .trim()
) {
  /* already handled by the usage error above — this is the belt for the braces */
}
if (!IS_MAIN && process.argv[1] && /doc-search/.test(process.argv[1])) {
  console.error('✗ doc-search was invoked as a program but did not recognise itself as the entry point.');
  console.error('  (resolved argv[1] != resolved module path — a wrapper, a symlink, or a copy.)');
  console.error('  Refusing to exit 0 with no output: an empty result here is indistinguishable from');
  console.error('  "nothing was found", which is the one answer this tool must never fake.');
  process.exit(2);
}
