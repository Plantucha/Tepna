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
 *   node tools/doc-search.mjs --no-map "…"      # without the repo-map lines (see below)
 *   node tools/doc-search.mjs --selftest
 *
 * ── THE REPO-MAP LINE (owner: "wire all three", 2026-10-12) ─────────────────────────────────────
 * After the hits, one line per distinct CODE file among them, naming what that file declares and
 * what it exposes — the two sets differ, and the gap is where a session loses time. The line is read
 * from the map `tools/repo-map.mjs --write` wrote, never rebuilt: a full scan costs 0.9 s against a
 * ~1 s answer. A file whose bytes no longer hash to the map's entry gets NO line, and the search
 * says how many it suppressed, so a stale symbol list can never be read as current. `--brief` keeps
 * the line; `--no-map` is the output as it was. A brief, a `docs/` page and an `ext:` path get no
 * line and no note.
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
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, unlinkSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { resolveStatePath, sharedStatePath, stateDirs } from './mutation-map.mjs';
import { fileURLToPath } from 'node:url';
import { stripCode } from './strip-markup.mjs';
import { isCliEntry, isEntryUrl } from './argv-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/* §1: shared-first through the git common dir — one index serves every worktree. */
/* The cache is JSON LINES, one document per line, written through a stream — never one JSON string.
   Measured 2026-09-24: the one-string form died the day the corpus grew. `JSON.stringify(cache)` on
   ~53k chunks needs ~705 MB of string, V8's MAX_STRING_LENGTH is 537 MB, the throw was swallowed by
   a bare `catch {}`, and every query thereafter re-embedded 16,658 chunks (5+ min) and could not
   persist — a search that read green while its cache silently never wrote. The legacy one-string
   file is still READ once (parse survives where stringify does not) so a machine migrates without
   re-embedding; it is never written again. */
const CACHE = resolveStatePath(ROOT, 'doc-search-index.jsonl');
const LEGACY_CACHE = resolveStatePath(ROOT, 'doc-search-index.json');
const OLLAMA = process.env.DEX_OLLAMA || 'http://localhost:11434';
const EMBED_MODEL = process.env.DEX_EMBED || 'bge-m3';
/* The in-repo corpus, directory by directory (non-recursive, on purpose — a glob would pull in
   uploads/ goldens and docs/*.html served copies). Measured 2026-09-24 before this list grew: the
   capture host — 122 .py in capture-host/, 332 tests, 219 tools/*.mjs, 12 hook scripts — was NOT in
   the corpus at all, so a Rule-0 query about the daemon returned repo prose and never the code that
   decides; the same shape as the 2026-08-17 "source comments were never indexed" failure, one lane
   over. `changes/` carries the cheapest true signal that a defect was already fixed (a pending
   changeset), and was not indexed either. */
const DIRS = ['briefs', 'audits', 'docs', 'papers', 'changes', 'capture-host', 'capture-host/tests', 'capture-host/systemd', 'capture-host/deploy', 'tools', 'tests', '.claude/hooks', '.'];
/* Document surfaces INSIDE the repo. `.js` was the 2026-08-17 lesson (comments are the largest
   ratification surface); `.py`/`.mjs`/`.sh` are the 2026-09-24 one — the daemon, the tools and the
   hooks carry their DO-NOT-REVERT rationales in the same way. `.json` is deliberately NOT here: the
   survey ledgers embed as noise, and a reader who needs one goes to its row. */
const REPO_EXTS = ['.md', '.html', '.js', '.mjs', '.py', '.sh', '.toml', '.yaml', '.yml', '.service', '.timer'];
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
const collapse = (text) =>
  String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
/* True when index k falls between the two halves of a surrogate pair. */
const midPair = (t, k) => {
  if (k <= 0 || k >= t.length) return false;
  const lo = t.charCodeAt(k);
  const hi = t.charCodeAt(k - 1);
  return lo >= 0xdc00 && lo <= 0xdfff && hi >= 0xd800 && hi <= 0xdbff;
};
/* The cache marks an entry embedded under this chunker with `c`. An entry without it came from the
   fixed-unit cutter, and it stays valid only where that cutter split no pair (see `cacheHit`). */
export const CHUNKER = 2;
/* A cut that lands inside a surrogate pair moves outward by one unit, so the whole character stays in
   the chunk. Every other cut stays where the fixed-unit cutter put it, so a text with no split pair
   chunks exactly as before and its cached vectors still pair with its chunks.
   Measured 2026-10-10: the fixed-unit cutter split a pair in 6 of 58,071 chunks, and a JSON consumer
   refused the lone half (`2026-10-10-doc-search-chunker-splits-surrogate-pairs`). */
export function chunk(text, size = 1200, stride = 900) {
  const t = collapse(text);
  if (!t) return [];
  const out = [];
  for (let i = 0; i < t.length; i += stride) {
    const a = midPair(t, i) ? i - 1 : i;
    const b = midPair(t, i + size) ? i + size + 1 : i + size;
    out.push(t.slice(a, b));
    if (i + size >= t.length) break;
  }
  return out;
}

/* Would the fixed-unit cutter have split a pair in this text? Only then do its chunks differ. */
export function legacySplitsPair(text, size = 1200, stride = 900) {
  if (!/[\uD800-\uDBFF]/.test(String(text || ''))) return false;
  const t = collapse(text);
  for (let i = 0; i < t.length; i += stride) {
    if (midPair(t, i) || midPair(t, i + size)) return true;
    if (i + size >= t.length) break;
  }
  return false;
}

/* THE ONE VALIDITY RULE for a cached entry, shared with `xerj-load.mjs`. Vector i pairs with chunk i
   only when the body hash matches, the count matches, and the chunk text is what was embedded. The
   count alone cannot see a moved edge: the new cutter keeps the count and shifts one unit. */
export function cacheHit(entry, h, chunks, text) {
  if (!entry || entry.h !== h || !Array.isArray(entry.vecs) || entry.vecs.length !== chunks.length) return false;
  return entry.c === CHUNKER || !legacySplitsPair(text);
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

/* --read mode: how many hits are printed in full and how much of each. Three, not five: the path list
   already names eight; three chunks at ~1.5k chars is ~1k tokens, which is the whole point — a
   session reads the answer instead of deciding whether to open a path. */
export const READ_TOP = 3;
export const READ_CHARS = 1500;

/* The chunk text as it will be printed: whitespace-collapsed, cut at a sentence when one lands
   inside the last 200 chars of the cap, with an explicit marker when it was cut (an unmarked cut
   reads as the whole). */
export function readChunk(text, cap = READ_CHARS) {
  const t = String(text || '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (t.length <= cap) return '    ' + t.replace(/\n/g, '\n    ');
  const head = t.slice(0, cap);
  const cut = head.lastIndexOf('. ');
  const body = cut >= cap - 200 ? head.slice(0, cut + 1) : head;
  return '    ' + body.replace(/\n/g, '\n    ') + '\n    … [cut at ' + body.length + ' of ' + t.length + ' chars — open the path for the rest]';
}

/* The CLI flags this tool understands, stripped from the query words. Exported so the selftest can
   pin that a flag never leaks into the embedded query (it did once as a token-fallback term). */
export const CLI_FLAGS = new Set(['--quiet', '--no-ext', '--ext-only', '--pull-ext', '--read', '--hybrid', '--code', '--semantic', '--brief', '--rerank', '--no-rerank', '--no-map']);
export function stripFlags(argv) {
  return (argv || []).filter((a) => !CLI_FLAGS.has(a));
}

/* ── WHICH LANE ANSWERS (owner ruling 2026-10-11: hybrid is the Rule-0 default) ──────────────────
   Measured on 52 real Rule-0 queries (XERJ-HYBRID-SEARCH brief §5): hybrid 49/52 against the semantic
   lane's 43/52, in ~18 ms against ~4 s, returning the passage rather than a path. Three lanes:
     'hybrid'         the default — try the local index, FALL BACK to the semantic lane if it does not
                      answer (server down, index unloaded, or cold: measured 27.6 s on the first query
                      after a unit restart, 75 ms warm) — so the old behaviour is the floor, never lost;
     'hybrid-strict'  `--hybrid` / `--code` — hybrid or exit 2, for a caller who wants to KNOW the index
                      answered (the loader's own check, a benchmark);
     'semantic'       `--semantic` — the pre-ruling path, by name, for comparing the two lanes.
   Pure, so the selftest pins the table rather than the flag soup. */
export const HYBRID_TIMEOUT_MS = 10_000;
export function searchLane(argv) {
  const a = argv || [];
  if (a.includes('--hybrid') || a.includes('--code')) return 'hybrid-strict';
  if (a.includes('--semantic')) return 'semantic';
  return 'hybrid';
}
/* THE RERANKER FLOOR IS THE RULE-0 DEFAULT (owner, 2026-10-12: "wire all three"). The hybrid lane asks
   the loopback reranker on every search; a server that does not answer drops the search onto the
   cosine and BM25 floor with a one-line note, so the default costs nothing where the server is absent.
   `--no-rerank` asks for the old floor by name; `--rerank` stays accepted and changes nothing. */
export function wantRerank(argv) {
  return !argv.includes('--no-rerank');
}

/* A bound on how long the default lane may hold the caller before the fallback runs. The timer is
   cleared on settle so a fast answer leaves no dangling handle; the label names what did not answer. */
export function withTimeout(promise, ms, label) {
  let t = null;
  const bound = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} did not answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, bound]).finally(() => clearTimeout(t));
}
/* The warning both lanes print after their hits — one text, so the two lanes cannot drift apart in
   what they tell a reader a result IS. */
export function readWarningLines(brief = false) {
  /* --brief keeps the warning's point in one line: a short list is still paths, not an answer. */
  if (brief) return ['', '  ⚠ PATHS TO READ, not an answer. Open them before you conclude anything.', ''];
  return [
    '',
    '  ⚠ These are PATHS TO READ, not an answer. This tool does not summarise a document,',
    '    and ADJACENCY IS NOT EQUIVALENCE — the two nearest results may answer DIFFERENT',
    '    questions with the same words. Read the one you opened, not the one beside it.',
    '    A FLAT FIELD IS NOT ABSENCE: similar scores mean shared vocabulary, not no match.',
    '    Read all five before concluding a thing was never decided.',
    '    because a plausible summary of a brief nobody opens is the failure it exists to prevent.',
    ''
  ];
}

/* ── THE REPO-MAP LINE (owner: "wire all three", 2026-10-12) ─────────────────────────────────────
   A tool nothing points at goes unused, and every session passes through Rule 0 several times a day
   — so the map that answers "what does this file declare, and what does it expose" prints beside the
   paths it describes. Four properties, each deliberate:
     · THE MAP IS READ, NEVER BUILT. A full scan costs 0.9 s against a ~1 s answer, so a search that
       rebuilt it would double its own cost. `node tools/repo-map.mjs --write` writes it; a search
       with no map says so once and prints no line.
     · DYNAMICALLY IMPORTED AND FAIL-SILENT, the board's rule (see the footer below): a broken or
       absent map must never cost a caller their search result.
     · `--brief` KEEPS THE LINE. The short form drops the passage, which is the long part; the map
       line is the one thing a path list alone cannot tell you, so shortening the output is no reason
       to withhold it. A selftest pins that neither call site is conditioned on the brief flag.
     · NOT ON A REFUSAL. When both halves fall below the floor, `render` says the paths are "weak best
       guesses, for reference only, not evidence" — a symbol list under that banner invites reading
       exactly what the banner disclaims. `--no-map` is the old output for a caller who wants it. */
export function wantsMap(argv) {
  return !(argv || []).includes('--no-map');
}
async function printMapLines(paths) {
  try {
    const { mapBlock } = await import('./repo-map.mjs');
    for (const line of mapBlock(paths, { root: ROOT })) console.log(line);
  } catch {
    /* intentionally silent — a map is a reference, never a reason a search fails */
  }
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
  /* Delegates to `isEntryUrl`, which compares the entry AS WRITTEN and its realpath. The body here used
     to compare `resolve()`d strings, which normalises but never follows a link, so a tool reached
     through a symlink read as imported and its main never ran (board #685, 2026-10-21). The signature
     and the selftests below stay, because a caller holding an entry should still be able to ask. */
  return isEntryUrl(argv1, moduleUrl);
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
    for (const f of names) if (REPO_EXTS.some((x) => f.endsWith(x))) out.push(d === '.' ? f : `${d}/${f}`);
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
    /* `depth`: how many directory levels below the root to visit (1 = the root's own files only).
       Absent ⇒ unbounded. Exists so a root can sit at a home directory — the fleet's ops scripts live
       at ~/ beside every worktree and repo — without re-indexing everything underneath it. */
    const depth = Number.isInteger(r.depth) && r.depth > 0 ? r.depth : Infinity;
    out.push({ name: r.name, path: resolve(r.path), exts, pull: r.pull === true, depth });
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

/* ── THE SESSION STAMP — what `.claude/hooks/guard-doc-search.sh` reads ─────────────────────────
   CLAUDE.md §📌 has said "search before you size or build" since 2026-08-26 and it stayed a rule
   nobody could be held to: measured 2026-09-12, a firmware TX + bond-layer diagnosis was done
   grep-first, and the search that would have found the prior fix (CHANGELOG, `link_rssi.dbus_hci`)
   ran only after the owner asked "did you use bge". The guard needs a FACT to read, so a successful
   query leaves one: a stamp file named by the Claude Code session, in the SHARED state dir (the git
   common dir — one place for every worktree, like the index itself). Its mtime is the freshness the
   hook measures; the body is an audit line per query.

   No session id ⇒ no stamp ⇒ nothing written: a human at a terminal has no session, and the hook
   fails open for them anyway. Best-effort — a stamp that cannot be written must not fail a search. */
export const SESSION_STAMP_DIR = 'doc-search-sessions';
export function sessionStampPath(root, sessionId, shared = (r, n) => sharedStatePath(r, n)[0]) {
  const id = String(sessionId || '').trim();
  if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) return null; // an id that is not a filename is not a key
  return shared(root, join(SESSION_STAMP_DIR, id));
}
export function stampSession(root, sessionId, query, fs = { mkdirSync, writeFileSync }) {
  const p = sessionStampPath(root, sessionId);
  if (!p) return null;
  try {
    fs.mkdirSync(dirname(p), { recursive: true });
    fs.writeFileSync(p, `${new Date().toISOString()}\t${String(query).replace(/\s+/g, ' ').trim()}\n`, { flag: 'a' });
    return p;
  } catch {
    return null;
  }
}

/* Recursive walk of one external root → `[{ key, abs }]`, key = `ext:<name>/<relative path>` with
   forward slashes so the index key is stable across machines. Injectable fs for the selftest. */
export function walkExternal(root, fs = { readdirSync, statSync }) {
  const out = [];
  const exts = new Set(root.exts);
  const maxDepth = Number.isInteger(root.depth) && root.depth > 0 ? root.depth : Infinity;
  const visit = (dir, rel, level = 1) => {
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
        if (level < maxDepth) visit(abs, r, level + 1);
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
/* JSONL cache: line 1 is the header `{"model"}`, every further line is one document
   `{"file","h","vecs"}`. Reading is line-by-line; writing streams one line at a time, so neither
   side ever holds the whole index as one string. `loadCache` falls back to the legacy one-string
   file (read-only) when no JSONL exists yet. Returns the same in-memory shape as before. */
/* Reads the JSONL cache LINE BY LINE through a fixed buffer — never `readFileSync(path, 'utf8')`.
   Measured 2026-09-24, one hour after the JSONL writer landed: the reader still did the whole-file
   read, Node refused it at 690 MB (`ERR_STRING_TOO_LONG`, the same 537 MB limit that had killed the
   writer), the `catch` returned an EMPTY cache, and every query re-embedded all 54k chunks and then
   wrote them out again. The writer was fixed and the reader was not; a limit met on one side of a
   file is met on the other. `readLines` yields decoded lines from 32 MB chunks, carrying the partial
   tail between reads; it is injectable so the selftest can feed it pieces. */
export function* readLines(path, openFn = openSync, readFn = readSync, closeFn = closeSync) {
  const fd = openFn(path, 'r');
  try {
    const buf = Buffer.allocUnsafe(32 * 1024 * 1024);
    let carry = '';
    for (;;) {
      const n = readFn(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      const text = carry + buf.toString('utf8', 0, n);
      const parts = text.split('\n');
      carry = parts.pop();
      for (const line of parts) if (line) yield line;
    }
    if (carry) yield carry;
  } finally {
    closeFn(fd);
  }
}
export function loadCache(path = CACHE, legacy = LEGACY_CACHE, linesFn = readLines, existsFn = existsSync, legacyReadFn = readFileSync) {
  const empty = { entries: {}, model: EMBED_MODEL };
  if (existsFn(path)) {
    try {
      let head = null;
      const entries = {};
      for (const line of linesFn(path)) {
        if (head === null) {
          head = JSON.parse(line);
          if (head.model !== EMBED_MODEL) return empty;
          continue;
        }
        const e = JSON.parse(line);
        entries[e.file] = e.c === undefined ? { h: e.h, vecs: e.vecs } : { h: e.h, vecs: e.vecs, c: e.c };
      }
      return head ? { entries, model: head.model } : empty;
    } catch (e) {
      process.stderr.write(`  ⚠ index cache unreadable (${String((e && e.message) || e)}) — rebuilding from scratch\n`);
      return empty;
    }
  }
  if (existsFn(legacy)) {
    try {
      const c = JSON.parse(legacyReadFn(legacy, 'utf8'));
      if (c.model === EMBED_MODEL && c.entries) return c;
    } catch {}
  }
  return empty;
}
/* Returns null on success, else the reason as a string — the caller reports it, never swallows it. */
export function saveCache(cache, path = CACHE, openFn = openSync, writeFn = writeSync, closeFn = closeSync, mkdirFn = mkdirSync, unlinkFn = unlinkSync) {
  let fd = null;
  let tmpPath = null;
  try {
    mkdirFn(dirname(path), { recursive: true });
    /* 🔴 A UNIQUE TEMP NAME PER WRITER. This was `path + '.tmp'` — ONE name shared by every process —
       so two sessions searching at the same time both wrote `doc-search-index.jsonl.tmp`, the first
       renamed it away, and the second's rename failed `ENOENT`. The loser then DISCARDED everything it
       had embedded: measured 2026-10-11, 6,062 chunks re-embedded in a single search because the
       previous run's cache never landed, and the fleet runs Rule 0 before every unit.
       ⚠️ The failure was LOUD and still cost tokens — `saveCache` already reported the reason and
       doc-search printed it ("index cache NOT written … every query will re-embed until this is
       fixed"). Nobody acted on it because the message named a symptom nobody could tie to a cause, and
       the next search worked fine unless it raced again. An intermittent loud failure is not safer
       than a silent one; it is the same cost with a receipt.
       pid AND a per-process counter: two sessions differ by pid, and two writes inside one process
       (a `--hybrid` run loads then saves twice) differ by the counter. */
    const tmp = `${path}.tmp.${process.pid}.${(saveCache._seq = (saveCache._seq || 0) + 1)}`;
    tmpPath = tmp;
    fd = openFn(tmp, 'w');
    writeFn(fd, JSON.stringify({ model: cache.model }) + '\n');
    for (const [file, e] of Object.entries(cache.entries)) writeFn(fd, JSON.stringify(e.c === undefined ? { file, h: e.h, vecs: e.vecs } : { file, h: e.h, vecs: e.vecs, c: e.c }) + '\n');
    closeFn(fd);
    fd = null;
    renameSync(tmp, path);
    return null;
  } catch (e) {
    if (fd !== null) {
      try {
        closeFn(fd);
      } catch {}
    }
    /* A UNIQUE NAME MUST BE CLEANED UP, or the fix trades one defect for a slow leak: the old shared
       name was at least overwritten by the next writer, while `…tmp.<pid>.<n>` from a killed run would
       sit beside the 718 MB cache forever. Best-effort and silent — the write already failed and its
       reason is what the caller reports. */
    try {
      if (typeof unlinkFn === 'function') unlinkFn(tmpPath);
    } catch {}
    return String((e && e.message) || e);
  }
}

async function buildIndex(quiet, scope = 'all') {
  const repo = scope === 'ext' ? [] : listDocs(ROOT).map((f) => ({ key: f, abs: join(ROOT, f) }));
  const ext = scope === 'repo' ? [] : listExternalDocs();
  const files = repo.concat(ext);
  let cache = loadCache();
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
    const text = `${f} :: ${body}`;
    const chunks = chunk(text);
    if (cacheHit(hit, h, chunks, text)) {
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
      cache.entries[p.file] = { h: p.h, vecs, c: CHUNKER };
      p.chunks.forEach((t, i) => entries.push({ file: p.file, text: t, vec: vecs[i] }));
      embedded += p.chunks.length;
    } catch {
      /* embedder down mid-build: keep the chunk as text so the fallback can still score it */
      live = false;
      p.chunks.forEach((t) => entries.push({ file: p.file, text: t, vec: null }));
    }
  }
  if (embedded) {
    const err = saveCache(cache);
    /* NOT silent: an unwritten cache means the next query pays the whole embed again, and the one
       thing worse than that cost is not knowing it is being paid. */
    if (err) process.stderr.write(`  ⚠ index cache NOT written (${err}) — every query will re-embed until this is fixed\n`);
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
  IS_MAIN = isCliEntry(import.meta.url);
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
  {
    /* row 2026-10-10-doc-search-chunker-splits-surrogate-pairs: a cut inside a pair keeps the pair. */
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    const endCut = `${'a'.repeat(1199)}\u{1F600}${'b'.repeat(2000)}`;
    const startCut = `${'a'.repeat(899)}\u{1F600}${'b'.repeat(2000)}`;
    ok('an end cut inside a pair keeps the whole character', chunk(endCut).every((c) => !lone.test(c)) && chunk(endCut)[0].endsWith('\u{1F600}'));
    ok('a start cut inside a pair keeps the whole character', chunk(startCut).every((c) => !lone.test(c)) && chunk(startCut)[1].startsWith('\u{1F600}'));
    ok('…and the chunk count does not move', chunk(endCut).length === 4 && chunk(startCut).length === 3);
    const plain = `${'word '.repeat(700)}\u{1F600} ${'more '.repeat(300)}`;
    const t = plain.replace(/\s+/g, ' ').trim();
    const fixed = [];
    for (let i = 0; i < t.length; i += 900) {
      fixed.push(t.slice(i, i + 1200));
      if (i + 1200 >= t.length) break;
    }
    ok('a text with no split pair chunks exactly as the fixed-unit cutter did', JSON.stringify(chunk(plain)) === JSON.stringify(fixed));
    ok('legacySplitsPair names the texts the old cutter split', legacySplitsPair(endCut) && legacySplitsPair(startCut) && !legacySplitsPair(plain) && !legacySplitsPair('x'.repeat(3000)));
    const two = { h: 'h', vecs: [[1], [2], [3], [4]] };
    ok('a legacy entry over a split text is stale', !cacheHit(two, 'h', chunk(endCut), endCut));
    ok('…and valid once embedded under this chunker', cacheHit({ ...two, c: CHUNKER }, 'h', chunk(endCut), endCut));
    ok('a legacy entry over an unsplit text stays valid', cacheHit({ h: 'h', vecs: chunk(plain).map(() => [1]) }, 'h', chunk(plain), plain));
    ok(
      'a changed hash or count is stale whatever the mark',
      !cacheHit({ ...two, c: CHUNKER }, 'x', chunk(endCut), endCut) && !cacheHit({ h: 'h', vecs: [[1]], c: CHUNKER }, 'h', chunk(endCut), endCut)
    );
  }
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
  /* 2026-09-24: the capture host, the tools and the hooks are DOCUMENT surfaces too. Each leg names one
     file that a Rule-0 query about that lane must be able to find; before this the whole lane was absent. */
  ok('capture-host/capture.py is in the corpus (the daemon carries its rationales in comments)', listDocs(ROOT).includes('capture-host/capture.py'));
  ok(
    'capture-host/tests/*.py are in the corpus (a test pins a decision as much as a brief does)',
    listDocs(ROOT).some((f) => /^capture-host\/tests\/test_.*\.py$/.test(f))
  );
  ok('tools/*.mjs are in the corpus', listDocs(ROOT).includes('tools/doc-search.mjs'));
  ok(
    '.claude/hooks/*.sh are in the corpus',
    listDocs(ROOT).some((f) => /^\.claude\/hooks\/.*\.sh$/.test(f))
  );
  ok('changes/ is in the corpus (a pending changeset is the cheapest true signal of a fix)', DIRS.includes('changes'));
  ok('.json is NOT a repo surface (survey ledgers embed as noise)', !REPO_EXTS.includes('.json'));
  /* external roots: `depth` bounds the walk — a root at ~/ must not re-index every worktree under it */
  {
    const tree = {
      '/r': ['a.md', 'sub'],
      '/r/sub': ['b.md', 'deep'],
      '/r/sub/deep': ['c.md']
    };
    const fsx = {
      readdirSync: (d) => tree[d] || [],
      statSync: (p) => ({ isDirectory: () => p in tree, size: 10 })
    };
    const all = walkExternal({ name: 'x', path: '/r', exts: ['.md'] }, fsx).map((e) => e.key);
    const one = walkExternal({ name: 'x', path: '/r', exts: ['.md'], depth: 1 }, fsx).map((e) => e.key);
    const two = walkExternal({ name: 'x', path: '/r', exts: ['.md'], depth: 2 }, fsx).map((e) => e.key);
    ok('no depth ⇒ the whole tree (3 files)', all.length === 3);
    ok("depth 1 ⇒ the root's own files only", one.length === 1 && one[0] === 'ext:x/a.md');
    ok('depth 2 ⇒ one level down, not two', two.length === 2 && !two.includes('ext:x/sub/deep/c.md'));
    const cfg = readExternalConfig('/nope', () =>
      JSON.stringify({
        roots: [
          { name: 'h', path: '/r', exts: ['.sh'], depth: 1 },
          { name: 'k', path: '/r' }
        ]
      })
    );
    ok('depth is read from the config, and absent ⇒ unbounded', cfg[0].depth === 1 && cfg[1].depth === Infinity);
  }
  /* JSONL cache: round-trips, never one string, and a write failure is REPORTED (2026-09-24: the
     one-string form threw past V8's 537 MB limit into a bare catch and every query re-embedded). */
  {
    const store = {};
    const fakeFs = {
      open: (p) => {
        store[p] = '';
        return p;
      },
      write: (fd, s) => {
        store[fd] += s;
      },
      close: () => {},
      mkdir: () => {}
    };
    const orig = renameSync;
    const cacheIn = { model: EMBED_MODEL, entries: { 'a.md': { h: 'h1', vecs: [[0.1, 0.2]] }, 'b.md': { h: 'h2', vecs: [[0.3]], c: CHUNKER } } };
    let renamed = null;
    const err = saveCache(cacheIn, '/x/idx.jsonl', fakeFs.open, fakeFs.write, fakeFs.close, fakeFs.mkdir);
    void orig;
    ok('saveCache reports a rename it cannot perform rather than swallowing it', typeof err === 'string' && /ENOENT|no such/i.test(err));
    /* THE TEMP KEY IS NO LONGER A CONSTANT — it carries the pid and a per-process counter, which is the
       whole point of the fix — so the leg finds it by prefix instead of by a literal it would have to
       keep in step. A test that hardcoded the name would red on the fix and tell you nothing. */
    const tmpKeys = Object.keys(store).filter((k) => k.startsWith('/x/idx.jsonl.tmp.'));
    ok('the temp file is written under a UNIQUE name, not a shared one', tmpKeys.length === 1 && /\.tmp\.\d+\.\d+$/.test(tmpKeys[0]), JSON.stringify(Object.keys(store)));
    const text = store[tmpKeys[0]];
    ok('the cache is written one document per line, header first', text.split('\n')[0] === JSON.stringify({ model: EMBED_MODEL }) && text.split('\n').length === 4);
    /* 🔴 THE CONCURRENT WRITE, PLANTED. Two writers against the same cache path must not share a temp
       name: under the old `path + '.tmp'` the second writer's rename hit ENOENT after the first had
       renamed the file away, and its embeddings were discarded — measured as 6,062 chunks re-embedded
       in one search. Here both writes run against one store and the assertion is that they chose
       DIFFERENT temp paths, which is the property that makes the race impossible rather than unlikely. */
    const store2 = {};
    const fdNames2 = {};
    const opened2 = [];
    let fdSeq2 = 0;
    const fs2 = {
      open: (f) => {
        const fd = ++fdSeq2;
        fdNames2[fd] = f;
        opened2.push(f);
        store2[f] = '';
        return fd;
      },
      write: (fd, t) => {
        store2[fdNames2[fd]] += t;
      },
      close: () => {},
      mkdir: () => {},
      unlink: (f) => {
        delete store2[f];
      }
    };
    const tiny = { model: EMBED_MODEL, entries: { 'a.md': { h: 'h', vecs: [[1]] } } };
    saveCache(tiny, '/y/idx.jsonl', fs2.open, fs2.write, fs2.close, fs2.mkdir, fs2.unlink);
    saveCache(tiny, '/y/idx.jsonl', fs2.open, fs2.write, fs2.close, fs2.mkdir, fs2.unlink);
    /* The names are collected AT OPEN, not from the store afterwards: the rename fails in a fake fs and
       the new cleanup then unlinks the temp file, so reading the store would show an empty object and
       the assertion would pass by examining nothing. My first version did exactly that and reported
       `[]` — the plant caught my own plant. */
    const tmps2 = opened2.filter((f) => f.startsWith('/y/idx.jsonl.tmp.'));
    ok('two concurrent writers choose DIFFERENT temp paths', new Set(tmps2).size === 2, JSON.stringify(tmps2));
    ok('…and neither temp path is the bare shared name the race came from', !tmps2.includes('/y/idx.jsonl.tmp'), JSON.stringify(tmps2));
    /* CONTROL · the failure path cleans up after itself. A unique name that is never removed trades the
       race for a slow leak beside a 718 MB cache; the old shared name was at least overwritten. */
    const store3 = {};
    const fdN3 = {};
    let seq3 = 0;
    let unlinked3 = null;
    const err3 = saveCache(
      tiny,
      '/z/idx.jsonl',
      (f) => {
        const fd = ++seq3;
        fdN3[fd] = f;
        store3[f] = '';
        return fd;
      },
      (fd, t) => {
        store3[fdN3[fd]] += t;
      },
      () => {
        throw new Error('close failed');
      },
      () => {},
      (f) => {
        unlinked3 = f;
      }
    );
    ok('a failed write reports its reason', typeof err3 === 'string' && /close failed/.test(err3), String(err3));
    ok('…and unlinks the temp file it created', unlinked3 !== null && unlinked3.startsWith('/z/idx.jsonl.tmp.'), String(unlinked3));
    const back = loadCache(
      '/x/idx.jsonl',
      '/nope',
      function* () {
        yield* text.split('\n').filter(Boolean);
      },
      (p) => p === '/x/idx.jsonl'
    );
    ok('loadCache round-trips the JSONL form', back.entries['a.md'].h === 'h1' && back.entries['b.md'].vecs[0][0] === 0.3);
    ok('…with the chunker mark, and no mark where none was written', back.entries['b.md'].c === CHUNKER && !('c' in back.entries['a.md']));
    const legacy = loadCache(
      '/none.jsonl',
      '/legacy.json',
      function* () {},
      (p) => p === '/legacy.json',
      () => JSON.stringify(cacheIn)
    );
    ok('the legacy one-string cache is still READ (migration without re-embedding)', legacy.entries['b.md'].h === 'h2');
    const wrongModel = loadCache(
      '/x/idx.jsonl',
      '/nope',
      function* () {
        yield JSON.stringify({ model: 'other' });
      },
      (p) => p === '/x/idx.jsonl'
    );
    ok('a cache from another model is discarded', Object.keys(wrongModel.entries).length === 0);
    /* the chunked reader itself: lines split across a chunk boundary are reassembled, and no whole-file
       string is ever built — fed through a fake fd that returns the file in 7-byte pieces */
    {
      const data = Buffer.from('{"model":"m"}\n{"file":"a","h":"1","vecs":[[1]]}\n{"file":"b","h":"2","vecs":[[2]]}\n');
      let pos = 0;
      const fakeRead = (fd, buf, off) => {
        const n = Math.min(7, data.length - pos);
        data.copy(buf, off, pos, pos + n);
        pos += n;
        return n;
      };
      const got = [
        ...readLines(
          '/fake',
          () => 1,
          fakeRead,
          () => {}
        )
      ];
      ok('readLines reassembles lines across 7-byte chunks', got.length === 3 && JSON.parse(got[2]).file === 'b');
    }
    void renamed;
  }
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
  /* The session stamp: keyed by the session, in the SHARED state dir, absent without a session. */
  const sp = sessionStampPath('/repo', 'abc-123', (r, n) => `${r}/SHARED/${n}`);
  ok('the stamp lives under the shared state dir, named by the session', sp === '/repo/SHARED/doc-search-sessions/abc-123', String(sp));
  ok('no session id ⇒ no stamp path', sessionStampPath('/repo', '') === null && sessionStampPath('/repo', undefined) === null);
  ok('a session id that is not a filename ⇒ no stamp path', sessionStampPath('/repo', '../x') === null && sessionStampPath('/repo', 'a b') === null);
  const wrote = [];
  const fakeStampFs = { mkdirSync: (d) => wrote.push('mkdir ' + d), writeFileSync: (f, body, o) => wrote.push(`${o && o.flag} ${f} ${body.trim()}`) };
  const sres = stampSession('/repo', 'abc-123', '  what   moved\n', fakeStampFs);
  ok(
    'a stamp is appended, mkdir -p first, with the query on one line',
    sres !== null && wrote.length === 2 && wrote[0].startsWith('mkdir ') && /^a .*doc-search-sessions\/abc-123 \d{4}-.*\twhat moved$/.test(wrote[1]),
    wrote.join(' | ')
  );
  ok('no session ⇒ nothing written', stampSession('/repo', '', 'q', fakeStampFs) === null && wrote.length === 2);
  ok(
    'an unwritable stamp is null, not a failed search',
    stampSession('/repo', 'abc-123', 'q', {
      mkdirSync: () => {
        throw new Error('ro');
      },
      writeFileSync: () => {}
    }) === null
  );
  ok('--read is a flag, never a query word', stripFlags(['--read', 'seam', '--quiet', 'split']).join(' ') === 'seam split');
  ok('readChunk returns the whole chunk under the cap, unmarked', readChunk('short text', 100) === '    short text');
  ok(
    'readChunk marks a cut and prefers a sentence boundary inside the last 200 chars',
    (() => {
      const t = 'a'.repeat(1300) + '. ' + 'b'.repeat(400);
      const out = readChunk(t, 1500);
      return out.includes('[cut at 1301 of 1702 chars') && !out.includes('bbb');
    })()
  );
  ok('readChunk cuts hard when no sentence boundary is near the cap', readChunk('c'.repeat(2000), 1500).includes('[cut at 1500 of 2000 chars'));
  /* The lane table (owner ruling 2026-10-11): hybrid by default, strict by name, semantic by name. */
  ok('no lane flag ⇒ the hybrid lane (the default)', searchLane(['node', 'x', 'what', 'moved']) === 'hybrid');
  ok('--hybrid and --code ⇒ the strict form', searchLane(['--hybrid', 'q']) === 'hybrid-strict' && searchLane(['--code', 'q']) === 'hybrid-strict');
  ok('--semantic ⇒ the pre-ruling lane by name', searchLane(['--semantic', 'q']) === 'semantic');
  ok('strict wins over --semantic when both are given (a caller who asked for the index gets an answer about the index)', searchLane(['--semantic', '--hybrid']) === 'hybrid-strict');
  ok('--semantic is a flag, never a query word', !stripFlags(['--semantic', 'q']).includes('--semantic'));
  ok('--brief is a flag, never a query word', stripFlags(['--brief', 'q']).join(' ') === 'q');
  ok('--rerank is a flag, never a query word', stripFlags(['--rerank', 'q']).join(' ') === 'q');
  ok('the reranker floor is the default', wantRerank(['node', 'x', 'q']) === true && wantRerank(['--rerank', 'q']) === true);
  ok('--no-rerank asks for the old floor', wantRerank(['--no-rerank', 'q']) === false);
  ok('--no-rerank is a flag, never a query word', stripFlags(['--no-rerank', 'q']).join(' ') === 'q');
  /* ── THE REPO-MAP LINE: the flag, and that nothing was forgotten ─────────────────────────────────
     The four states of the line itself are pinned where the renderer lives (`repo-map.mjs --selftest`,
     with a literal map and an injected read, so they need no map on this box). What belongs HERE is
     the wiring: a flag that never reaches the query, both lanes printing it, and the short form
     keeping it. A map printed on the fallback lane only would be invisible to every default search. */
  ok('the map prints by default', wantsMap(['node', 'x', 'q']) === true);
  ok('--no-map asks for the old output', wantsMap(['--no-map', 'q']) === false);
  ok('--no-map is a flag, never a query word', stripFlags(['--no-map', 'seam']).join(' ') === 'seam');
  ok('--no-map does not change which lane answers', searchLane(['--no-map', 'q']) === 'hybrid');
  {
    const src = readFileSync(new URL(import.meta.url), 'utf-8');
    const calls = (src.match(/await printMapLines\(/g) || []).length;
    ok('BOTH lanes print the map block, not just one', calls === 2, `found ${calls} call(s) to printMapLines`);
    ok('…and the hybrid lane does not print it over a refusal (the paths there are disclaimed)', /!out\.refused\) await printMapLines/.test(src));
    const guarded = (src.match(/^.*printMapLines\(.*$/gm) || []).filter((l) => /\bbrief\b/.test(l));
    ok('--brief KEEPS the map line (neither call site is conditioned on the brief flag)', guarded.length === 0, guarded.join(' | '));
  }
  ok(
    '--brief keeps the paths-not-an-answer warning in one line',
    readWarningLines(true).filter((l) => l.includes('PATHS TO READ')).length === 1 && readWarningLines(true).filter(Boolean).length === 1
  );
  await (async () => {
    const fast = await withTimeout(Promise.resolve('hit'), 1000, 'x');
    ok('withTimeout passes a prompt answer through', fast === 'hit');
    let msg = null;
    try {
      await withTimeout(new Promise(() => {}), 5, 'hybrid index');
    } catch (e) {
      msg = e.message;
    }
    ok('withTimeout rejects a silent answer and names what did not answer', msg === 'hybrid index did not answer within 5 ms');
  })();
  ok(
    'both lanes print ONE read-warning text (it cannot drift between them)',
    readWarningLines().some((l) => l.includes('PATHS TO READ')) && readWarningLines().some((l) => l.includes('ADJACENCY IS NOT EQUIVALENCE'))
  );
  console.log(fail ? '\n✗ ' + fail + ' failed, ' + pass + ' passed' : '\n✓ all ' + pass + ' selftests passed');
  process.exit(fail ? 1 : 0);
}

if (IS_MAIN && !process.argv.includes('--selftest')) {
  /* ── THE HYBRID LANE FIRST (owner ruling 2026-10-11; see searchLane) ─────────────────────────────
     An EARLY branch, before the semantic index is touched, and the implementation is imported
     DYNAMICALLY — so the semantic lane below keeps its cost, its imports and its failure modes exactly
     as they were. The default lane is hybrid WITH A FALLBACK: a server that is down, an index that is
     not loaded, or a cold start past HYBRID_TIMEOUT_MS all drop the caller onto the semantic lane with
     one line saying so — the old behaviour is the floor. `--hybrid` / `--code` keep the strict form
     (answer or exit 2) for callers who need to know the index itself answered. Both lanes leave the
     session stamp the edit guard reads, because the rule is "a search ran", not "which lane ran". */
  const lane = searchLane(process.argv);
  const brief = process.argv.includes('--brief');
  if (lane !== 'semantic') {
    const q = stripFlags(process.argv.slice(2)).join(' ').trim();
    if (!q) {
      console.error('usage: node tools/doc-search.mjs [--hybrid|--semantic] [--read] [--brief] [--no-rerank] [--no-map] "<what you are trying to find>"');
      process.exit(2);
    }
    const xq = await import('./xerj-query.mjs');
    try {
      const out = await withTimeout(xq.hybridSearch({ query: q, rerank: wantRerank(process.argv) }), HYBRID_TIMEOUT_MS, 'hybrid index');
      process.stdout.write(`${xq.render(out, q, { brief })}\n`);
      if (wantsMap(process.argv) && !out.refused) await printMapLines(out.hits.map((h) => h.path));
      for (const line of readWarningLines(brief)) console.log(line);
      stampSession(ROOT, process.env.CLAUDE_CODE_SESSION_ID, q);
      process.exit(0);
    } catch (e) {
      if (lane === 'hybrid-strict') {
        console.error(`doc-search --hybrid: ${e.message}`);
        console.error('  The semantic lane is unaffected: re-run without --hybrid.');
        process.exit(2);
      }
      console.error(`▸ hybrid lane did not answer (${e.message}) — falling back to the semantic lane\n`);
    }
  }
  const scope = process.argv.includes('--ext-only') ? 'ext' : process.argv.includes('--no-ext') ? 'repo' : 'all';
  const pullExt = process.argv.includes('--pull-ext');
  const readMode = process.argv.includes('--read');
  const argv = stripFlags(process.argv.slice(2));
  const query = argv.join(' ').trim();
  if (!query) {
    console.error('usage: node tools/doc-search.mjs [--read] [--brief] [--no-ext|--ext-only] [--pull-ext] [--no-map] "<what you are trying to find out>"');
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
  for (const h of hits) console.log(brief ? `  ${h.score.toFixed(3)}  ${h.file}` : `  ${h.score.toFixed(3)}  ${h.file}\n        ${h.text.slice(0, 110).trim()}…`);
  if (readMode) {
    /* --read: the matching CHUNK of the top three hits, inline, so the reader reads them instead of
       the path list. Measured 2026-09-26: twice in one day the top hit was never opened. Capped per
       chunk so three hits cost ~1k tokens, not a section each; the path is still there to open. */
    console.log('\n▸ --read · the matching chunk of the top ' + Math.min(READ_TOP, hits.length) + ' hits (capped at ' + READ_CHARS + ' chars each):');
    for (const h of hits.slice(0, READ_TOP)) {
      console.log('\n  ── ' + h.file + '  (' + h.score.toFixed(3) + ')');
      console.log(readChunk(h.text, READ_CHARS));
    }
  }
  if (wantsMap(process.argv)) await printMapLines(hits.map((h) => h.file));
  for (const line of readWarningLines(brief)) console.log(line);
  /* The stamp the edit guard reads (see SESSION STAMP above). After the hits, so a refused or
     crashed search leaves nothing — a stamp is evidence a search RAN, never that one was attempted. */
  stampSession(ROOT, process.env.CLAUDE_CODE_SESSION_ID, query);
  /* THE BOARD'S THREE LINES, after the hits and after the stamp. Rule 0 runs before every unit, so
     this is the one place every session passes through several times a day — which is exactly why the
     board's red banner belongs here rather than on a page somebody has to remember to open. The owner's
     case for the board was a seven-hour silence; a banner nobody loads is the same silence.
     ⚠️ READ-ONLY AND FAIL-SILENT. It reads `board.json` that the timer wrote; it never generates the
     board (a search must not spawn `gh` calls) and never fails a search. No file, stale file, bad JSON
     or missing summariser ⇒ nothing printed, because a Rule 0 search that dies on its own footer would
     be a far worse defect than a missing footer. */
  try {
    const bj = join(homedir(), '.local', 'share', 'tepna', 'board', 'board.json');
    if (existsSync(bj)) {
      const b = JSON.parse(readFileSync(bj, 'utf-8'));
      const { summarize } = await import('./board.mjs');
      const ageMin = (Date.now() - Date.parse(b.generatedAt)) / 6e4;
      console.log('');
      for (const line of summarize(b)) console.log(`  ${line}`);
      /* An old board is said to be old. The timer runs every 10 min, so past 30 the page is not
         describing now and the reader must know that before trusting the banner. */
      if (isFinite(ageMin) && ageMin > 30) console.log(`  ⚠ board is ${Math.round(ageMin)} min old — tepna-board.timer may not be running`);
    }
  } catch {
    /* intentionally silent — see above */
  }
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
