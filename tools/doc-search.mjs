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
 * ── ⚠️ A FLAT FIELD IS NOT EVIDENCE OF ABSENCE ─────────────────────────────────────────────────
 * Measured on live use: a query returned 0.593 / 0.586 / 0.581 / 0.573 / 0.567 — no standout — and
 * the reader opened the top two, found nothing, and concluded the work was unbuilt. The conclusion
 * happened to hold, but it held because they later opened the other three, not because the scores
 * were flat.
 *
 * Flatness means the corpus has many documents of similar distance from the query, which is the
 * NORMAL shape when the vocabulary is shared — `session`, `night`, `window` and `duration` all rank
 * together. It is not a signal that nothing matched. Read five, or read none; reading two and
 * inferring absence is the one use of this tool that produces a confident wrong answer.
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
 *
 * ── EXTERNAL ROOTS — reference trees OUTSIDE the repo (owner-ordered 2026-09-06)
 * The repo's own answer is not the only one worth ranking: a device's wire behaviour is often
 * documented best by a vendor SDK, a sibling open-source project, or a protocol reference that lives
 * outside this tree by design (third-party material is never vendored here). A local, per-machine
 * config lists such trees and they join the SAME index, keyed `ext:<name>/<path>`:
 *
 *   <state dir>/doc-search-external.json
 *   { "roots": [ { "name": "some-sdk", "path": "/abs/path", "exts": [".java", ".kt"] }, … ] }
 *
 * Walked RECURSIVELY (the repo dirs are flat by convention; a Gradle tree is not), `.git` /
 * `node_modules` / `build` skipped, files over 256 KB skipped (generated giants, not documents).
 * ⚠️ External CODE is indexed as FULL TEXT, not comments-only like the repo's `.js`: SDK code is
 * often comment-free — its identifiers ARE the document — and the comments-only rule exists to keep
 * repo code from burying repo decisions, which does not apply to a tree that has no prose to bury.
 * `--no-ext` searches the repo alone; `--ext-only` searches the external roots alone. The config is
 * per-machine like the model and the index: absent config ⇒ no external roots, silently — the repo
 * corpus guard is unchanged.
 *
 * FRESHNESS IS THE SAME TIMER AS THE REPO'S (owner: "reindex on a regular basis like tepna is").
 * `bge-reindex-driver.sh` runs one query hourly on the root checkout; the index is content-hashed,
 * so an unchanged external tree costs one hash pass and "0 newly embedded". What a timer cannot do
 * is move the trees: a clone stays at the commit it was cloned at. A root may therefore opt in
 * with `"pull": true`, and the driver's `--pull-ext` fast-forwards exactly those (`git pull
 * --ff-only`, quiet, best-effort, 60 s each) BEFORE the query. Opt-in, not default, because a root
 * can be a WORKING tree (a peer's PR checkout, or a tree that is not a git repo at all) —
 * pulling someone's checkout out from under them is §👥's whole failure class one directory over.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { resolveStatePath, stateDirs } from './mutation-map.mjs';
import { fileURLToPath } from 'node:url';
import { stripCode } from './strip-markup.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/* §1: shared-first through the git common dir — one index serves every worktree. */
const CACHE = resolveStatePath(ROOT, 'doc-search-index.json');
const OLLAMA = process.env.DEX_OLLAMA || 'http://localhost:11434';
const EMBED_MODEL = process.env.DEX_EMBED || 'bge-m3';
const DIRS = ['briefs', 'audits', 'docs', 'papers', '.'];
/* External roots (header §EXTERNAL ROOTS). Same state dir as the index, so one config serves every
   worktree; absent ⇒ `[]`, never an error — the file is per-machine like the model. */
const EXTERNAL_CONFIG = resolveStatePath(ROOT, 'doc-search-external.json');
export const EXT_PREFIX = 'ext:';
export const EXT_DEFAULT_EXTS = ['.md', '.java', '.kt', '.swift', '.py', '.c', '.cc', '.cpp', '.h', '.hpp', '.proto', '.js', '.ts', '.txt'];
export const EXT_SKIP_DIRS = new Set(['.git', 'node_modules', 'build', '.gradle', '.idea', 'dist', 'target']);
export const EXT_MAX_BYTES = 256 * 1024;

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

/**
 * Every comment body in a JS source file, as plain prose.
 *
 * Deliberately a lexer-free scan: this feeds a semantic index, not a compiler, so the cost of
 * mistaking a `//` inside a string literal for a comment is one slightly noisy chunk — while the
 * cost of a heavyweight parse is a dependency and a failure mode on any file that does not parse.
 * The repo has `tools/js-lex.mjs` for the cases where precision matters (mutation must never land
 * inside a comment); ranking prose is not one of them.
 */
export function jsComments(src) {
  const out = [];
  const s = String(src || '');
  /* Block comments first, then line comments, then collapse the decoration authors use for headers
     (`* ─────`, leading `*`) so the indexed text reads as sentences rather than box-drawing. */
  for (const m of s.matchAll(/\/\*[\s\S]*?\*\//g)) out.push(m[0].slice(2, -2));
  for (const m of s.matchAll(/(^|[^:"'`\\])\/\/(.*)$/gm)) out.push(m[2]);
  return out
    .join('\n')
    .replace(/^[ \t]*\*[ \t]?/gm, '')
    .replace(/[─━═─-╿]{3,}/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/* A reference guide is a document even when it ships as a page. Script and style bodies are dropped
   entirely — an inlined bundle would otherwise flood the index with minified JS that matches every
   query weakly and nothing well. */
export function readDoc(path, raw) {
  const t = String(raw || '');
  /* For SOURCE, index the COMMENTS and not the code — the same argument that strips script bodies
     out of a bundle, applied one layer down. Code matches every query weakly and nothing well: it is
     mostly identifiers and punctuation, and embedding it would bury the 278 decision-bearing lines
     under 100 000 lines of `for (var i = 0; ...)`. The comments ARE the document; the code beside
     them is what the comments are about. Provenance is the other half of the reason: a rationale
     found this way is attributed to `oxydex-registry.js`, where someone can act on it, rather than
     to a bundle that merely contains a copy of it. */
  /* External code is the document in full (header §EXTERNAL ROOTS): SDK code often has no
     comments to prefer, and its identifiers are what a query about the wire format is made of. */
  if (/\.mjs$|\.js$/i.test(path) && !path.startsWith(EXT_PREFIX)) return jsComments(t);
  if (!/\.html?$/i.test(path)) return t;
  /* `stripCode` INDEX-SCANS rather than pattern-matching. The regex that stood here missed `</script >`
     and `</script foo>` — both legal — and a leak is not cosmetic for THIS tool: the escaped body
     becomes searchable text, so hits land in minified `for (var i = 0; ...)` instead of the
     decision-bearing prose the comment above says is the document. */
  return stripCode(t)
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
  /* The SOURCE surface needs an anchor of its own, for exactly the reason the others have one: it
     was absent for months and the only symptom was answers that said "nothing found". `clock.js` is
     the safest anchor in the repo — CLAUDE.md's Clock Contract is single-sourced there, so a corpus
     without it is a corpus that cannot answer the most-cited decision in the project. */
  if (!has('clock.js')) return 'clock.js is not in the corpus — source comments are the largest ratification surface here and are not being indexed';
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
       ships as a page. Tags are stripped at read time so the index sees the words, not the markup.

       ⚠️ `.js` IS A DOCUMENT SURFACE HERE, AND OMITTING IT DEFEATED THIS TOOL'S PURPOSE.
       This tool answers "was this already decided?", and in this repo the largest ratification
       surface is not prose — it is SOURCE COMMENTS. `oxydex-registry.js` carries owner-ratified
       tier decisions with dates; `clock.js` carries the Clock Contract; every DSP carries measured
       findings and DO-NOT-REVERT rationales beside the code they govern.
       Measured 2026-08-17: 278 decision-bearing comment lines among 11 669 comment lines across 112
       root `.js` files, none of it indexed. A question about any of them returned a clean EMPTY
       result — which reads as "not decided" in the one tool built to prove the opposite. Two
       sessions re-derived five already-ratified decisions in a single evening this way, and the
       lesson they drew — "I should have run doc-search" — was itself wrong, because running it
       would have returned nothing. An out-of-scope corpus is worse than a cold cache: a cold cache
       costs ~200 s and announces itself, an absent corpus is indistinguishable from a real negative. */
    for (const f of names) if (f.endsWith('.md') || f.endsWith('.html') || f.endsWith('.js')) out.push(d === '.' ? f : `${d}/${f}`);
  }
  return out.sort();
}

/* The external-roots config, validated to the shape the header documents. A malformed file is
   reported (stderr) and treated as empty rather than thrown: a broken local config must not take
   the repo search down with it — that is the "search tool that is down" the fallback exists for. */
export function readExternalConfig(path = EXTERNAL_CONFIG, readFn = readFileSync) {
  let raw;
  try {
    raw = readFn(path, 'utf8');
  } catch {
    return [];
  }
  let roots;
  try {
    roots = JSON.parse(raw).roots;
  } catch (e) {
    process.stderr.write(`  ⚠ ${path}: unreadable (${e.message}) — external roots ignored\n`);
    return [];
  }
  if (!Array.isArray(roots)) return [];
  const out = [];
  for (const r of roots) {
    if (!r || typeof r.name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(r.name) || typeof r.path !== 'string') {
      process.stderr.write(`  ⚠ ${path}: root entry needs {name: [A-Za-z0-9._-]+, path} — skipped: ${JSON.stringify(r)}\n`);
      continue;
    }
    const exts = Array.isArray(r.exts) && r.exts.length ? r.exts.map((x) => String(x).toLowerCase()) : EXT_DEFAULT_EXTS;
    out.push({ name: r.name, path: resolve(r.path), exts, pull: r.pull === true });
  }
  return out;
}

/* `--pull-ext`: fast-forward the roots that opted in (header §EXTERNAL ROOTS). Best-effort by
   design — a root that is offline, dirty, or not a git repo logs one line and the query still runs
   on whatever is on disk; a stale index is cheap, a failed refresh must never be a failed search.
   Injectable runner for the selftest, which must not touch git. Returns `[{ name, ok, note }]`. */
export function pullExternalRoots(roots, run = (args) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 })) {
  const out = [];
  for (const r of roots) {
    if (!r.pull) continue;
    try {
      run(['-C', r.path, 'pull', '--ff-only', '--quiet']);
      out.push({ name: r.name, ok: true, note: 'fast-forwarded' });
    } catch (e) {
      const note = String((e && e.stderr) || (e && e.message) || e)
        .trim()
        .split('\n')[0];
      out.push({ name: r.name, ok: false, note });
    }
  }
  return out;
}

/* Recursive walk of one external root → `[{ key, abs }]`, key = `ext:<name>/<relative path>` with
   forward slashes so the index key is stable across machines. Injectable fs for the selftest. */
export function walkExternal(root, fs = { readdirSync, statSync }) {
  const out = [];
  const exts = new Set(root.exts);
  const visit = (dir, rel) => {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names.sort()) {
      if (EXT_SKIP_DIRS.has(n)) continue;
      const abs = join(dir, n);
      const r = rel ? `${rel}/${n}` : n;
      let st;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        visit(abs, r);
        continue;
      }
      const dot = n.lastIndexOf('.');
      if (dot < 0 || !exts.has(n.slice(dot).toLowerCase())) continue;
      if (st.size > EXT_MAX_BYTES) continue;
      out.push({ key: `${EXT_PREFIX}${root.name}/${r}`, abs });
    }
  };
  visit(root.path, '');
  return out;
}

export function listExternalDocs(roots = readExternalConfig()) {
  const out = [];
  for (const r of roots) {
    const docs = walkExternal(r);
    if (!docs.length) process.stderr.write(`  ⚠ external root ${r.name} (${r.path}): no indexable files — path wrong or exts too narrow?\n`);
    out.push(...docs);
  }
  return out;
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
/* `scope`: 'all' (default) · 'repo' (`--no-ext`) · 'ext' (`--ext-only`). The cache is shared across
   scopes — an external chunk embedded once is not re-embedded when the next query is repo-only. */
async function buildIndex(quiet, scope = 'all') {
  const repo = scope === 'ext' ? [] : listDocs(ROOT).map((f) => ({ key: f, abs: join(ROOT, f) }));
  const ext = scope === 'repo' ? [] : listExternalDocs();
  const files = repo.concat(ext);
  let cache = { entries: {}, model: EMBED_MODEL };
  try {
    const c = JSON.parse(readFileSync(CACHE, 'utf8'));
    if (c.model === EMBED_MODEL) cache = c;
  } catch {}
  const entries = [];
  const pending = [];
  for (const { key: f, abs } of files) {
    let body;
    try {
      body = readDoc(f, readFileSync(abs, 'utf8'));
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
  if (!quiet)
    process.stderr.write(
      `  ${files.length} docs (${repo.length} repo · ${ext.length} external) · ${entries.length} chunks · ${embedded} newly embedded${live ? '' : ' · EMBEDDER DOWN, token fallback'}\n`
    );
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
  /* The SOURCE anchor. `clock.js` was absent from the corpus for months and the only symptom was
     answers that said "nothing found" — which is what this whole function exists to prevent. */
  ok('a corpus with no source files is refused', corpusProblem(['CLAUDE.md', 'ORIENTATION.md'].concat(Array.from({ length: 60 }, (_, i) => `briefs/b${i}.md`))) !== null);
  ok(
    '…and it names the source surface, not a generic failure',
    /source comments/.test(String(corpusProblem(['CLAUDE.md', 'ORIENTATION.md'].concat(Array.from({ length: 60 }, (_, i) => `briefs/b${i}.md`)))))
  );
  ok('a real corpus passes', corpusProblem(listDocs(ROOT)) === null, String(corpusProblem(listDocs(ROOT))));
  /* End-to-end against the real tree: the fix is that these are in the corpus at all. */
  ok('the doc list now includes source', listDocs(ROOT).includes('clock.js'));
  ok(
    '…including the registries that carry ratified decisions',
    listDocs(ROOT).some((f) => /-registry\.js$/.test(f))
  );

  /* Comments are the document; code is what they are about. Indexing code would bury 278
     decision-bearing lines under 100 000 lines of loop syntax. */
  ok('jsComments keeps a block comment', jsComments('/* owner-ratified 2026-08-16 */\nvar x = 1;').includes('owner-ratified'));
  ok('…and a line comment', jsComments('var x = 1; // DO NOT revert, measured\n').includes('DO NOT revert'));
  ok('…and drops the code', !/var x = 1/.test(jsComments('/* keep */\nvar x = 1;\n')));
  ok('…and strips the leading asterisks authors decorate with', !/^\s*\*/.test(jsComments('/*\n * a decision\n */')));
  /* A `//` inside a URL is not a comment start; getting this wrong would swallow the rest of a line
     of real prose in the very files being indexed. */
  /* Asserting the result is EMPTY is stronger than asserting one host is absent, and it avoids a
     CodeQL false positive: `.includes('<host>')` pattern-matches as URL-substring sanitization, which
     this is not — it is a lexer assertion. The `//` here is preceded by `:` and must not open a
     comment; if it did, the rest of a real line of prose would be swallowed. */
  ok('a URL is not mistaken for a comment', jsComments("var u = 'https://host/x';") === '');
  ok('an empty source yields empty, not a crash', jsComments('') === '');
  ok(
    'the doc list finds briefs',
    listDocs(ROOT).some((f) => f.startsWith('briefs/'))
  );
  ok('…and root docs like CLAUDE.md', listDocs(ROOT).includes('CLAUDE.md'));
  ok(
    '§1: the index cache resolves within a declared state candidate',
    stateDirs(ROOT).some((d) => CACHE.startsWith(d)),
    CACHE
  );
  /* External roots: the config is optional, validated, and the walk is recursive with the repo's
     skip-list — a fake fs so the test needs no vendor tree on the machine running it. */
  ok('no external config ⇒ no roots, no error', readExternalConfig('/nonexistent/x.json').length === 0);
  ok('a malformed config is ignored, not thrown', readExternalConfig('x', () => '{not json').length === 0);
  ok(
    'a root without a legal name is skipped',
    readExternalConfig('x', () =>
      JSON.stringify({
        roots: [
          { name: 'bad name', path: '/p' },
          { name: 'ok', path: '/p' }
        ]
      })
    ).length === 1
  );
  ok('a root with no exts gets the default set', readExternalConfig('x', () => JSON.stringify({ roots: [{ name: 'ok', path: '/p' }] }))[0].exts === EXT_DEFAULT_EXTS);
  const fakeTree = {
    '/v': ['.git', 'src', 'README.md', 'big.java'],
    '/v/.git': ['HEAD'],
    '/v/src': ['A.java', 'b.png', 'sub'],
    '/v/src/sub': ['C.kt']
  };
  const fakeFs = {
    readdirSync: (d) => fakeTree[d] || [],
    statSync: (p) => ({ isDirectory: () => p in fakeTree, size: p.endsWith('big.java') ? EXT_MAX_BYTES + 1 : 10 })
  };
  const walked = walkExternal({ name: 'v', path: '/v', exts: ['.java', '.kt', '.md'] }, fakeFs).map((d) => d.key);
  ok('walk is recursive and keyed ext:<name>/<path>', walked.includes('ext:v/src/sub/C.kt'), walked.join(','));
  ok('…skips .git', !walked.some((k) => k.includes('.git/')));
  ok('…skips extensions outside the set', !walked.some((k) => k.endsWith('.png')));
  ok('…skips oversized files', !walked.includes('ext:v/big.java'), walked.join(','));
  ok('…and keeps root-level docs', walked.includes('ext:v/README.md'));
  ok('external code is indexed as full text, not comments-only', readDoc('ext:v/x.js', '/* c */ var sensorState = 1;').includes('sensorState'));
  ok('…while repo code stays comments-only', !readDoc('x.js', '/* c */ var sensorState = 1;').includes('sensorState'));
  /* --pull-ext: opt-in per root, best-effort, never touches git in the selftest. */
  const cfgPull = readExternalConfig('x', () =>
    JSON.stringify({
      roots: [
        { name: 'a', path: '/a', pull: true },
        { name: 'b', path: '/b' },
        { name: 'c', path: '/c', pull: 'yes' }
      ]
    })
  );
  ok('pull is opt-in and must be boolean true', cfgPull.map((r) => r.pull).join(',') === 'true,false,false', cfgPull.map((r) => r.pull).join(','));
  const pulled = [];
  const res = pullExternalRoots(cfgPull, (args) => {
    pulled.push(args.join(' '));
    if (args[1] === '/a') throw Object.assign(new Error('boom'), { stderr: 'fatal: not a git repository\nmore' });
  });
  ok('only opted-in roots are pulled, with --ff-only', pulled.length === 1 && pulled[0] === '-C /a pull --ff-only --quiet', pulled.join(' | '));
  ok('a failed pull is reported, not thrown, first stderr line kept', res.length === 1 && res[0].ok === false && res[0].note === 'fatal: not a git repository', JSON.stringify(res));
  console.log(fail ? '\n✗ ' + fail + ' failed, ' + pass + ' passed' : '\n✓ all ' + pass + ' selftests passed');
  process.exit(fail ? 1 : 0);
}

if (IS_MAIN && !process.argv.includes('--selftest')) {
  const scope = process.argv.includes('--ext-only') ? 'ext' : process.argv.includes('--no-ext') ? 'repo' : 'all';
  const pullExt = process.argv.includes('--pull-ext');
  const argv = process.argv.slice(2).filter((a) => a !== '--quiet' && a !== '--no-ext' && a !== '--ext-only' && a !== '--pull-ext');
  const query = argv.join(' ').trim();
  if (!query) {
    console.error('usage: node tools/doc-search.mjs [--no-ext|--ext-only] [--pull-ext] "<what you are trying to find out>"');
    process.exit(2);
  }
  if (pullExt && scope !== 'repo') {
    for (const r of pullExternalRoots(readExternalConfig())) console.error(`  ${r.ok ? '↻' : '⚠'} ext:${r.name} — ${r.note}`);
  }
  const problem = corpusProblem(listDocs(ROOT));
  if (problem) {
    console.error('✗ REFUSING TO SEARCH: ' + problem + '.');
    console.error('  An empty result here is indistinguishable from "nothing was decided", which is the');
    console.error('  one answer this tool must never fake. Fix the corpus rather than trusting the silence.');
    process.exit(2);
  }
  const { entries, live } = await buildIndex(process.argv.includes('--quiet'), scope);
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
  console.log('    A FLAT FIELD IS NOT ABSENCE: similar scores mean shared vocabulary, not no match.');
  console.log('    Read all five before concluding a thing was never decided.');
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
