#!/usr/bin/env node
/* Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ════════════════════════════════════════════════════════════════════════
 * xerj-load — write doc-search's EXISTING chunks and cached bge-m3 vectors into a xerj index
 * carrying a `dense_vector` mapping, so one engine can serve BM25 + kNN + hybrid in one request.
 *
 *   node tools/xerj-load.mjs                 # load every eligible file into a FRESH generation, then
 *                                            # move the name to it and delete the one it replaced
 *   node tools/xerj-load.mjs --limit 50      # a slice, for a probe — into `<index>-probe`, deleted
 *                                            # at the end, never promoted
 *   node tools/xerj-load.mjs --dry-run       # count and classify, write nothing
 *   node tools/xerj-load.mjs --selftest      # the properties below
 *   node tools/xerj-load.mjs --json          # one tepna.verdict/1 on stdout
 *
 * ⚠️ NEVER RE-CHUNK AND NEVER RE-EMBED. `doc-search.mjs`'s `chunk()` is the single source of truth:
 * the cache stores ONE 1024-dim vector per chunk, positionally, so the i-th vector describes the
 * i-th chunk of `${file} :: ${body}` and nothing else. Re-chunking with different parameters, or
 * pairing a cached vector with text read from a file that has since changed, silently indexes a
 * vector that describes text nobody will ever see — a search index that is confidently wrong, with
 * no symptom at query time. So this tool reproduces doc-search's own validity rule verbatim
 * (`h` matches AND the chunk count matches) and SKIPS anything else, counting what it skipped.
 *
 * ⚠️ SOURCE ONLY. The corpus is `listDocs()`, which is a non-recursive list of named directories
 * precisely so a glob cannot reach `uploads/` or a recording — doc-search's own header says so. That
 * argument is inherited, so this tool also ASSERTS it per path and refuses on a hit: the project's
 * one hard line (nothing captured leaves the box) is not something to hold by reasoning alone.
 *
 * ⚠️ LOOPBACK ONLY, and no model is ever downloaded. xerj refuses to call bge-m3 itself (its proxy
 * mode will not attest a remote provider's assets, and its own embedder is MiniLM), so vectors come
 * from OUR cache, already computed by doc-search against Ollama. `--embed-mode neural` would fetch a
 * model and is never used here.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chunk, listExternalDocs, readDoc, readLines } from './doc-search.mjs';
import { resolveStatePath } from './mutation-map.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));

export const DEFAULT_INDEX = 'tepna-hybrid';
export const DEFAULT_URL = 'http://127.0.0.1:9200';
export const VECTOR_DIMS = 1024;
export const CACHE_MODEL = 'bge-m3';
/** Paths this tool refuses outright, whatever the corpus says. The hard line, mechanically. */
export const EXT_PREFIX = 'ext:';
/* Built ONCE and only if an `ext:` entry is actually seen — 2,891 paths is cheap, but a tool that
   walks external roots it never needs is a tool that fails on a machine where they are absent. */
let _extAbs = null;
function extAbs() {
  if (_extAbs) return _extAbs;
  _extAbs = new Map();
  try {
    for (const { key, abs } of listExternalDocs()) _extAbs.set(key, abs);
  } catch {
    /* absent config ⇒ an empty map, so every ext: entry reports `missing` rather than throwing */
  }
  return _extAbs;
}

export const FORBIDDEN = [/(^|\/)uploads\//, /\.edf$/i, /(^|\/)captures?\//, /\.(dat|bin|wav)$/i];

/** Loopback only — a non-loopback host is a refusal, never a warning. */
export function isLoopback(url) {
  try {
    const h = new URL(url).hostname;
    return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
  } catch {
    return false;
  }
}

/** The index mapping: BM25 text beside a cosine dense_vector, so one query can ask both. */
export function mapping(dims = VECTOR_DIMS) {
  return {
    mappings: {
      properties: {
        path: { type: 'keyword' },
        chunk_index: { type: 'long' },
        chunk_count: { type: 'long' },
        line_start: { type: 'long' },
        line_end: { type: 'long' },
        symbols: { type: 'keyword' },
        file_hash: { type: 'keyword' },
        text: { type: 'text' },
        vec: { type: 'dense_vector', dims, index: true, similarity: 'cosine' }
      }
    }
  };
}

/**
 * WHICH FUNCTION A CODE CHUNK SITS IN. `file:812-840` says where; `· computeODI` says what, before the
 * reader opens the file. universal-ctags reads the file and returns each scope with its first and last
 * line. Only scopes with an end line count, so a chunk names a function only when it sits inside it.
 * Display only: the search body never reads `symbols`, so no ranking moves.
 */
export const CTAGS_EXT = /\.(c?m?js|py|sh|ts|kt|java|swift|c|h|cc|cpp)$/;
const SCOPE_KINDS = new Set(['function', 'method', 'class', 'member', 'getter', 'setter', 'constructor', 'interface', 'object']);

/** ctags JSON lines → `[{ name, line, end }]` for scope kinds with an end line. */
export function parseCtags(out) {
  const scopes = [];
  for (const ln of String(out ?? '').split('\n')) {
    if (!ln.startsWith('{')) continue;
    let t;
    try {
      t = JSON.parse(ln);
    } catch {
      continue;
    }
    if (t._type !== 'tag' || !SCOPE_KINDS.has(t.kind) || !Number.isInteger(t.line) || !Number.isInteger(t.end) || t.end < t.line) continue;
    scopes.push({ name: t.name, line: t.line, end: t.end });
  }
  return scopes;
}

/** The scopes that overlap lines `[ls, le]`, innermost first, at most `max`, names unique. */
export function enclosingSymbols(scopes, ls, le, max = 3) {
  const hit = (scopes ?? []).filter((t) => t.line <= le && t.end >= ls).sort((a, b) => a.end - a.line - (b.end - b.line) || a.line - b.line);
  return [...new Set(hit.map((t) => t.name))].slice(0, max);
}

/** Run ctags on one file. Absent ctags or a failed run ⇒ null: no symbol field, never a guessed one. */
export function ctagsScopes(file, abs, run = spawnSync) {
  if (!CTAGS_EXT.test(file)) return null;
  const r = run('ctags', ['--output-format=json', '--fields=+nKe', '-f', '-', abs], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r?.error || r?.status !== 0) return null;
  return parseCtags(r.stdout);
}

/**
 * JS SCOPES. ctags 6.2 gives no end line for a JS function, so no JS chunk named its function. The
 * JS parser (a pinned devDependency) reads the file and returns every named function, class and
 * method with its first and last line. A function takes the name of the declaration, variable,
 * property or assignment that holds it, and a module wrapped in an immediately called function
 * takes the name of its variable. Absent parser or a file it cannot parse ⇒ null, as for ctags.
 */
export const JS_EXT = /\.[cm]?js$/;

/** The parser's `parse`, or null when the devDependency is absent. */
export function jsParser(req = createRequire(import.meta.url)) {
  try {
    return req('acorn').parse;
  } catch {
    return null;
  }
}

const FN_VALUE = new Set(['FunctionExpression', 'ArrowFunctionExpression', 'ClassExpression']);
const keyName = (k) => (k?.type === 'Identifier' ? k.name : k?.type === 'PrivateIdentifier' ? `#${k.name}` : k?.type === 'Literal' ? String(k.value) : null);

/** Source text → `[{ name, line, end }]` for every named scope, or null when it does not parse. */
export function jsScopes(raw, parse = jsParser()) {
  if (!parse) return null;
  let ast = null;
  for (const sourceType of ['module', 'script']) {
    try {
      ast = parse(raw, { ecmaVersion: 'latest', sourceType, locations: true, allowHashBang: true, allowReturnOutsideFunction: sourceType === 'script' });
      break;
    } catch {
      ast = null;
    }
  }
  if (!ast) return null;
  const scopes = [];
  const add = (name, n) => {
    if (name && n.loc) scopes.push({ name: String(name), line: n.loc.start.line, end: n.loc.end.line });
  };
  for (const stack = [ast]; stack.length; ) {
    const n = stack.pop();
    if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') add(n.id?.name, n);
    else if (n.type === 'MethodDefinition') add(keyName(n.key), n);
    else if ((n.type === 'Property' || n.type === 'PropertyDefinition') && FN_VALUE.has(n.value?.type)) add(keyName(n.key), n);
    else if (n.type === 'VariableDeclarator' && (FN_VALUE.has(n.init?.type) || FN_VALUE.has(n.init?.callee?.type))) add(n.id?.name, n);
    else if (n.type === 'AssignmentExpression' && FN_VALUE.has(n.right?.type)) add(n.left?.type === 'MemberExpression' ? keyName(n.left.property) : n.left?.name, n);
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) for (const c of v) c && typeof c.type === 'string' && stack.push(c);
      else if (v && typeof v.type === 'string') stack.push(v);
    }
  }
  return scopes;
}

/**
 * WHERE EACH CHUNK SITS IN ITS FILE, as 1-based `[first, last]` lines, or `null` per chunk when it
 * cannot be placed. A hit printed as `[chunk 34/259]` sends the reader scrolling; `file:812-840`
 * opens at the passage. Two paths:
 *   EXACT  — the body IS the file (Markdown, Python, shell, external code). Replay the whitespace
 *            collapse `chunk()` applies, keep each kept character's raw offset, and read the lines
 *            off the raw offsets of the chunk's first and last character.
 *   ANCHOR — the body is DERIVED (JS comments, HTML text). Find the chunk's first and last whole
 *            words in the raw file, allowing comment decoration, tags and entities between words.
 *            A chunk whose words cannot be found is `null`; a guessed line is worse than none.
 * Pure: `chunks` is the list `planFile` already holds, so the pairing with vector i cannot drift.
 */
export function chunkLines(file, body, raw, chunks) {
  const src = String(raw);
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  const lineAt = (off) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const prefix = `${file} :: `;
  if (body === src) {
    const S = `${prefix}${body}`;
    let c = '';
    const orig = [];
    let inWs = false;
    for (let i = 0; i < S.length; i++) {
      if (/\s/.test(S[i])) {
        if (!inWs) {
          c += ' ';
          orig.push(i);
        }
        inWs = true;
      } else {
        c += S[i];
        orig.push(i);
        inWs = false;
      }
    }
    let lead = 0;
    while (c[lead] === ' ') lead++;
    let end = c.length;
    while (end > lead && c[end - 1] === ' ') end--;
    c = c.slice(lead, end);
    const map = orig.slice(lead, end);
    let from = 0;
    return chunks.map((ch) => {
      const at = c.indexOf(ch, from);
      if (at < 0 || !ch.length) return null;
      from = at + 1;
      const a = Math.max(0, map[at] - prefix.length);
      const b = Math.max(0, map[at + ch.length - 1] - prefix.length);
      return [lineAt(a), lineAt(b)];
    });
  }
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const SEP = '(?:[\\s*/#─-╿]|<[^>]*>|&[a-z]+;)+';
  const find = (words, from) => {
    if (!words.length) return null;
    const re = new RegExp(words.map(esc).join(SEP), 'g');
    re.lastIndex = from;
    const m = re.exec(src);
    return m ? { at: m.index, end: m.index + m[0].length - 1 } : null;
  };
  const K = 4;
  let from = 0;
  return chunks.map((ch, i) => {
    let t = String(ch);
    if (t.startsWith(prefix)) t = t.slice(prefix.length);
    const w = t.split(' ').filter(Boolean);
    /* A chunk is cut at a fixed character count, so its first and last words may be halves. */
    if (i > 0) w.shift();
    if (i < chunks.length - 1) w.pop();
    const head = find(w.slice(0, K), from);
    if (!head) return null;
    from = head.at + 1;
    const tail = find(w.slice(-K), head.at);
    return tail ? [lineAt(head.at), lineAt(tail.end)] : null;
  });
}

/**
 * PURE CORE. Decide what one cache line contributes, given the live file body.
 *
 * Returns `{ ok: true, docs: [...] }`, or `{ ok: false, reason }` where reason is one of:
 *   'forbidden'      — the path is corpus/recording shaped; refuse regardless of the corpus list
 *   'missing'        — the file is gone since the cache was written
 *   'stale-hash'     — the body changed, so the cached vectors describe text that no longer exists
 *   'chunk-mismatch' — the chunk count moved, so vector i no longer pairs with chunk i
 *   'no-vectors'     — the entry carries none (doc-search keeps text-only entries when the embedder is down)
 *   'bad-dims'       — a vector is not `dims` long, so the mapping would reject it anyway
 *
 * @param {{file: string, h: string, vecs: number[][]}} entry
 * @param {string|null} body  the file body as `readDoc` returns it, or null when absent
 * @param {string|null} [raw]  the file as read from disk; absent ⇒ no line range, never a guessed one
 * @param {{name: string, line: number, end: number}[]|null} [scopes]  ctags scopes; absent ⇒ no symbols
 */
export function planFile(entry, body, dims = VECTOR_DIMS, chunkFn = chunk, raw = null, scopes = null) {
  const file = entry?.file ?? '';
  if (!file) return { ok: false, reason: 'missing' };
  if (FORBIDDEN.some((re) => re.test(file))) return { ok: false, reason: 'forbidden' };
  const vecs = entry?.vecs;
  if (!Array.isArray(vecs) || vecs.length === 0) return { ok: false, reason: 'no-vectors' };
  if (body == null) return { ok: false, reason: 'missing' };
  /* doc-search's OWN validity rule, reproduced rather than reinvented (see buildIndex): the body
     hash and the chunk count must BOTH match, or the positional pairing is broken. */
  const h = createHash('sha256').update(body).digest('hex').slice(0, 16);
  if (entry.h !== h) return { ok: false, reason: 'stale-hash' };
  const chunks = chunkFn(`${file} :: ${body}`);
  if (chunks.length !== vecs.length) return { ok: false, reason: 'chunk-mismatch' };
  if (vecs.some((v) => !Array.isArray(v) || v.length !== dims)) return { ok: false, reason: 'bad-dims' };
  let repaired = 0;
  const lines = raw == null ? null : chunkLines(file, body, raw, chunks);
  return {
    ok: true,
    get repaired() {
      return repaired;
    },
    docs: chunks.map((raw, i) => ({
      /* A DETERMINISTIC id keeps one chunk one document WITHIN a generation. It does NOT make a
         reload into the same index idempotent — the engine's vector graph appends on overwrite and
         never reclaims (measured 2026-10-11, see `main`), which is why every load is a fresh index. */
      _id: `${file}#${i}`,
      path: file,
      chunk_index: i,
      chunk_count: chunks.length,
      /* An unknown range is ABSENT from the document, never 0 (CLAUDE.md §∅). */
      ...(lines?.[i] ? { line_start: lines[i][0], line_end: lines[i][1] } : {}),
      ...(() => {
        const sy = lines?.[i] && scopes ? enclosingSymbols(scopes, lines[i][0], lines[i][1]) : [];
        return sy.length ? { symbols: sy } : {};
      })(),
      file_hash: h,
      text: (() => {
        const r = sanitizeText(raw);
        repaired += r.repaired;
        return r.text;
      })(),
      vec: vecs[i]
    }))
  };
}

/**
 * Replace UNPAIRED surrogates with U+FFFD, and say how many were found.
 *
 * ⚠️ MEASURED 2026-10-10, and it is a property of the chunker rather than of any one file.
 * `chunk()` cuts at a fixed CHARACTER count, so a cut can land between the two halves of a
 * surrogate pair — an emoji split down the middle. doc-search never notices: it embeds the string
 * locally and nothing serialises it. `JSON.stringify` then emits a lone `\udXXX`, which is not valid
 * JSON text, and xerj refuses the whole bulk batch with `lone leading surrogate in hex escape` —
 * one broken chunk aborting 128 good ones.
 *
 * The repair belongs HERE, not in the chunker: re-chunking would invalidate every cached vector's
 * positional pairing, which is the one thing this tool must not do. The vector still describes the
 * original text; the indexed text differs from it by a single replacement character at an edge, and
 * the count is reported so "we altered the text" is never a silent act.
 */
export function sanitizeText(t) {
  let repaired = 0;
  const out = String(t).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, () => {
    repaired += 1;
    return '\uFFFD';
  });
  return { text: out, repaired };
}

/** Bulk body for one batch — NDJSON, action line then source line. */
export function bulkBody(index, docs) {
  const out = [];
  for (const d of docs) {
    const { _id, ...src } = d;
    out.push(JSON.stringify({ index: { _index: index, _id } }));
    out.push(JSON.stringify(src));
  }
  return `${out.join('\n')}\n`;
}

/** One index per load: `<alias>-<UTC second stamp>`. `alias` is the name readers keep using. */
export function generationName(alias, at = new Date()) {
  return `${alias}-${at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
    .toLowerCase()}`;
}

/** Is `name` a generation of `alias` — and so ours to retire once it no longer serves the alias? */
export function isGeneration(name, alias) {
  const lit = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${lit}-\\d{8}t\\d{6}z$`).test(String(name));
}

/** The ONE request that moves readers: every old holder removed, the new one added, atomically. */
export function swapActions(alias, olds, next) {
  return {
    actions: [...olds.filter((o) => o !== next).map((index) => ({ remove: { index, alias } })), { add: { index: next, alias } }]
  };
}

export function selftest() {
  const fail = [];
  let ran = 0;
  const ok = (cond, what) => {
    ran += 1;
    if (!cond) fail.push(what);
  };
  const vec = (n) => Array.from({ length: n }, (_, i) => i / n);
  const chunk2 = (t) => [`${t}-a`, `${t}-b`];
  const body = 'hello world';
  const h = createHash('sha256').update(body).digest('hex').slice(0, 16);

  // 1 · THE HAPPY PATH pairs vector i with chunk i and nothing else.
  const good = planFile({ file: 'docs/a.md', h, vecs: [vec(4), vec(4)] }, body, 4, chunk2);
  ok(good.ok && good.docs.length === 2, 'a valid entry yields one doc per chunk');
  ok(good.ok && (good.docs[0].vec === undefined) === false && good.docs[1].chunk_index === 1, 'chunk_index is positional');
  ok(good.ok && good.docs[0]._id === 'docs/a.md#0', 'the id is deterministic, so a reload overwrites');

  /* 2 · THE DEFECT THIS TOOL EXISTS TO AVOID. A changed body must not be paired with cached
         vectors — it would index a vector describing text that no longer exists, and nothing at
         query time would reveal it. */
  ok(planFile({ file: 'docs/a.md', h: 'deadbeefdeadbeef', vecs: [vec(4), vec(4)] }, body, 4, chunk2).reason === 'stale-hash', 'a changed body is skipped as stale-hash');
  ok(planFile({ file: 'docs/a.md', h, vecs: [vec(4)] }, body, 4, chunk2).reason === 'chunk-mismatch', 'a moved chunk count is skipped');
  ok(planFile({ file: 'docs/a.md', h, vecs: [vec(3), vec(3)] }, body, 4, chunk2).reason === 'bad-dims', 'a wrong-dimension vector is skipped');
  ok(planFile({ file: 'docs/a.md', h, vecs: [] }, body, 4, chunk2).reason === 'no-vectors', 'a text-only entry is skipped');
  ok(planFile({ file: 'docs/a.md', h, vecs: [vec(4), vec(4)] }, null, 4, chunk2).reason === 'missing', 'a vanished file is skipped');

  // 3 · THE HARD LINE, asserted rather than inherited from the corpus list.
  for (const p of ['uploads/OxyDex_2026.json', 'a/uploads/x.md', 'night.edf', 'captures/run1.dat']) {
    ok(planFile({ file: p, h, vecs: [vec(4), vec(4)] }, body, 4, chunk2).reason === 'forbidden', `${p} is refused as forbidden`);
  }

  // 4 · LOOPBACK ONLY.
  ok(isLoopback('http://127.0.0.1:9200') && isLoopback('http://localhost:9200'), 'loopback hosts are accepted');
  ok(!isLoopback('http://10.0.0.5:9200') && !isLoopback('https://example.com'), 'a non-loopback host is refused');

  // 5 · THE MAPPING asks for a cosine dense_vector beside BM25 text, which is what makes one
  //     request able to serve both halves.
  const m = mapping(1024).mappings.properties;
  ok(m.vec.type === 'dense_vector' && m.vec.dims === 1024 && m.vec.similarity === 'cosine', 'the mapping is a cosine dense_vector of 1024 dims');
  ok(m.text.type === 'text' && m.path.type === 'keyword', 'text is BM25-searchable and path is a keyword');

  // 6 · BULK BODY is NDJSON with an action line per doc and a trailing newline.
  const b = bulkBody('idx', good.ok ? good.docs : []);
  ok(b.endsWith('\n') && b.trim().split('\n').length === 4, 'the bulk body is two lines per doc and ends with a newline');
  ok(JSON.parse(b.split('\n')[0]).index._id === 'docs/a.md#0', 'the action line carries the deterministic id');

  /* 7 · THE SURROGATE REPAIR. A split emoji is not a hypothetical: it aborted a 128-document bulk
         batch on the first real load, and the count must be reported rather than silently applied. */
  const lone = sanitizeText(`a${String.fromCharCode(0xd83d)}b`);
  ok(lone.repaired === 1 && lone.text === 'a\uFFFDb', 'a lone high surrogate is replaced and counted');
  const lowOnly = sanitizeText(`a${String.fromCharCode(0xdc00)}b`);
  ok(lowOnly.repaired === 1, 'a lone LOW surrogate is replaced too');
  const pair = sanitizeText('a\u{1F600}b');
  ok(pair.repaired === 0 && pair.text === 'a\u{1F600}b', 'a WELL-FORMED pair is left byte-identical');
  ok(JSON.parse(JSON.stringify({ t: lone.text })).t === 'a\uFFFDb', 'the repaired text survives a JSON round-trip');

  /* 8 · ONE GENERATION PER LOAD. The 2026-10-11 defect: a reload into one index grew the HNSW graph
         without bound. A load now names a fresh index, the alias moves in one request, and only a
         name of exactly that shape is ever retired — never the alias, never a probe, never a sibling. */
  const at = new Date('2026-10-11T22:05:09.123Z');
  ok(generationName('tepna-hybrid', at) === 'tepna-hybrid-20261011t220509z', 'a generation is the alias plus a UTC second stamp');
  ok(isGeneration(generationName('tepna-hybrid', at), 'tepna-hybrid'), 'a generation name is recognised as one');
  ok(!isGeneration('tepna-hybrid', 'tepna-hybrid'), 'the alias itself is not a generation');
  ok(!isGeneration('tepna-hybrid-probe', 'tepna-hybrid'), 'a probe index is not a generation');
  ok(
    !isGeneration('tepna-hybrid-x-20261011t220509z', 'tepna-hybrid') && !isGeneration('tepna-hybrid2-20261011t220509z', 'tepna-hybrid'),
    'a sibling index with a stamp is not a generation of this alias'
  );
  const sw = swapActions('tepna-hybrid', ['tepna-hybrid-20261011t210000z', 'tepna-hybrid-20261011t220509z'], 'tepna-hybrid-20261011t220509z');
  ok(
    sw.actions.length === 2 && sw.actions[0].remove.index === 'tepna-hybrid-20261011t210000z' && sw.actions[1].add.index === 'tepna-hybrid-20261011t220509z',
    'the swap removes every other holder and adds the new one, in one request'
  );
  ok(swapActions('a', [], 'a-20261011t220509z').actions.length === 1 && swapActions('a', [], 'a-20261011t220509z').actions[0].add.alias === 'a', 'with nothing to remove the swap is a single add');

  /* 9 · LINE RANGES. A hit names `file:first-last`; an unplaceable chunk carries no range at all. */
  const md = Array.from({ length: 120 }, (_, i) => `line${i + 1} has  some\twords here`).join('\n');
  const mdChunks = chunk(`docs/m.md :: ${md}`);
  const mdLines = chunkLines('docs/m.md', md, md, mdChunks);
  const rawLines = md.split('\n');
  ok(mdChunks.length > 2 && mdLines.every(Boolean), 'EXACT: every chunk of a Markdown body is placed');
  ok(mdLines[0][0] === 1 && mdLines[mdLines.length - 1][1] === 120, 'EXACT: the first chunk opens at line 1 and the last closes at the last line');
  ok(
    mdChunks.every((c, i) => {
      const words = c.replace(/^docs\/m\.md :: /, '').split(' ');
      return rawLines[mdLines[i][0] - 1].includes(words[0]) && rawLines[mdLines[i][1] - 1].includes(words[words.length - 1]);
    }),
    "EXACT: each chunk's first and last fragments sit on its first and last line"
  );
  ok(
    mdLines.every((r, i) => i === 0 || r[0] >= mdLines[i - 1][0]),
    'EXACT: the ranges advance with the chunk index'
  );
  const js = '/* alpha beta gamma delta\n * epsilon zeta eta theta */\nrun();\n\n// iota kappa lambda mu\n';
  const jsBody = readDoc('t.js', js);
  const jsLines = chunkLines('t.js', jsBody, js, chunk(`t.js :: ${jsBody}`));
  ok(jsLines.length === 1 && jsLines[0]?.[0] === 1 && jsLines[0]?.[1] === 5, 'ANCHOR: JS comment text is placed across decoration and code');
  ok(chunkLines('t.js', 'derived', 'nothing here', ['t.js :: zzz qqq'])[0] === null, 'ANCHOR: words absent from the file give null, not a guess');
  const noRaw = planFile({ file: 'docs/a.md', h, vecs: [vec(4)] }, body, 4, (t) => [t]);
  ok(noRaw.ok && !('line_start' in noRaw.docs[0]), 'without the raw file the document carries no line field, not 0');
  const withRaw = planFile({ file: 'docs/a.md', h, vecs: [vec(4)] }, body, 4, (t) => [t], body);
  ok(withRaw.ok && withRaw.docs[0].line_start === 1 && withRaw.docs[0].line_end === 1, 'CONTROL: with the raw file the same document is placed at line 1');
  ok(mapping(4).mappings.properties.line_start.type === 'long', 'the mapping carries the line fields');

  /* CTAGS SYMBOLS: a chunk names the scopes it overlaps, innermost first; no ctags ⇒ no field. */
  const tags = [
    '{"_type": "tag", "name": "outer", "line": 1, "end": 100, "kind": "function"}',
    '{"_type": "tag", "name": "inner", "line": 10, "end": 20, "kind": "method"}',
    '{"_type": "tag", "name": "CONST", "line": 12, "kind": "variable"}',
    '{"_type": "tag", "name": "noEnd", "line": 12, "kind": "function"}',
    '{"_type": "tag", "name": "later", "line": 30, "end": 40, "kind": "function"}',
    'not json'
  ].join('\n');
  const sc = parseCtags(tags);
  ok(sc.length === 3 && !sc.some((t) => t.name === 'CONST' || t.name === 'noEnd'), 'ctags: only scope kinds WITH an end line count');
  ok(enclosingSymbols(sc, 12, 15).join() === 'inner,outer', 'a chunk inside a method names it before the enclosing function');
  ok(enclosingSymbols(sc, 18, 35).join() === 'inner,later,outer', 'a chunk across two functions names both');
  ok(enclosingSymbols(sc, 200, 210).length === 0, 'a chunk outside every scope names none');
  ok(enclosingSymbols(sc, 12, 15, 1).join() === 'inner', 'the cap keeps the innermost');
  ok(ctagsScopes('a.md', '/x') === null, 'a non-code file is not tagged');
  ok(ctagsScopes('a.js', '/x', () => ({ error: new Error('ENOENT') })) === null, 'absent ctags gives null, not an empty list');
  ok(ctagsScopes('a.js', '/x', () => ({ status: 1, stdout: '' })) === null, 'a failed ctags run gives null');
  ok(ctagsScopes('a.py', '/x', () => ({ status: 0, stdout: tags })).length === 3, 'CONTROL: a good run parses');
  const tEntry = { file: 't.js', h: createHash('sha256').update('alpha beta').digest('hex').slice(0, 16), vecs: [[0, 0, 0, 0]] };
  const tagged = planFile(tEntry, 'alpha beta', 4, (t) => [t], 'alpha beta', [{ name: 'fn', line: 1, end: 3 }]);
  ok(tagged.ok && tagged.docs[0].symbols?.join() === 'fn', 'planFile writes the symbols of a placed chunk');
  const untagged = planFile(tEntry, 'alpha beta', 4, (t) => [t], 'alpha beta', null);
  ok(untagged.ok && !('symbols' in untagged.docs[0]), 'no scopes ⇒ no symbols field, never an empty one');
  ok(mapping(4).mappings.properties.symbols.type === 'keyword', 'the mapping carries the symbols field');

  /* JS SCOPES: the parser names functions ctags leaves without an end line. */
  const jsSrc = [
    'export function top(a) {',
    '  const inner = (x) => {',
    '    return x + 1;',
    '  };',
    '  return inner(a);',
    '}',
    'class Box {',
    '  open() {',
    '    return 1;',
    '  }',
    '}',
    'const api = { load: function () { return 2; } };',
    'api.save = () => 3;',
    'const n = 4;'
  ].join('\n');
  const jsc = jsScopes(jsSrc);
  const sAt = (nm) => jsc?.find((t) => t.name === nm);
  const iife = jsScopes('var Mod = (function () {\n  return { a: 1 };\n})();');
  ok(iife?.[0]?.name === 'Mod' && iife[0].end === 3, 'a module in an immediately called function takes its variable name');
  ok(sAt('top')?.line === 1 && sAt('top')?.end === 6, 'a function declaration spans its lines');
  ok(sAt('inner')?.line === 2 && sAt('inner')?.end === 4, 'an arrow takes the name of its variable');
  ok(sAt('Box')?.end === 11 && sAt('open')?.line === 8 && sAt('open')?.end === 10, 'a class and its method are scopes');
  ok(sAt('load')?.line === 12 && sAt('save')?.line === 13, 'a property and an assignment name their function');
  ok(!sAt('n') && !sAt('api'), 'a variable that holds no function is not a scope');
  ok(enclosingSymbols(jsc, 3, 3).join() === 'inner,top', 'a chunk in the arrow names it before the function');
  ok(jsScopes('return 1;')?.length === 0, 'a script with a top-level return parses');
  ok(jsScopes('function (', jsParser()) === null, 'a file that does not parse gives null, not an empty list');
  ok(jsScopes(jsSrc, null) === null, 'absent parser gives null');
  ok(
    jsParser(() => {
      throw new Error('absent');
    }) === null,
    'jsParser returns null when the package is absent'
  );
  ok(JS_EXT.test('a.mjs') && JS_EXT.test('a.cjs') && JS_EXT.test('a.js') && !JS_EXT.test('a.json'), 'JS_EXT takes js, mjs and cjs only');

  const line = fail.length ? `xerj-load selftest · ${fail.length} of ${ran} FAILED` : `all ${ran} selftests passed`;
  return { ok: fail.length === 0, ran, fail, line };
}

/* ── everything below is I/O; the core above is pure and is what the suite drives ── */

async function req(url, path, method, body, ndjson = false) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: body ? { 'content-type': ndjson ? 'application/x-ndjson' : 'application/json' } : {},
    body
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

export function verdictOf({ status, counts, reason, generation = null }) {
  let commit = null;
  try {
    commit = createRequire(import.meta.url)('node:child_process')
      .execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', cwd: ROOT })
      .trim();
  } catch {
    commit = null;
  }
  const eligible = counts.files;
  const v = Verdict.make({
    gate: 'xerj-load',
    status,
    population: { checked: status === 'NOT_RUN' ? 0 : counts.loaded + counts.skipped, eligible, excluded: status === 'NOT_RUN' ? eligible : eligible - (counts.loaded + counts.skipped) },
    criterion: { name: 'every-eligible-cached-file-is-loaded-with-its-own-vectors', threshold: 0, unit: 'unexplained files', direction: 'eq' },
    result: status === 'NOT_RUN' ? null : { ...counts, generation },
    evidence: ['tools/xerj-load.mjs', 'tools/doc-search.mjs'],
    reason: reason === undefined ? null : reason,
    producedBy: commit ? { tool: 'tools/xerj-load.mjs', commit } : { tool: 'tools/xerj-load.mjs', commit: null, commitReason: 'git rev-parse unavailable' },
    at: new Date().toISOString()
  });
  const check = Verdict.validate(v);
  if (!check.ok) throw new Error(`xerj-load produced an invalid verdict: ${check.errors.join('; ')}`);
  return v;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    const r = selftest();
    process.stdout.write(`${r.line}\n`);
    for (const f of r.fail) process.stdout.write(`  ✕ ${f}\n`);
    process.exit(r.ok ? 0 : 1);
  }
  const flag = (n, d) => {
    const i = argv.indexOf(n);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  const asJson = argv.includes('--json');
  const dry = argv.includes('--dry-run');
  const url = flag('--url', DEFAULT_URL);
  const index = flag('--index', DEFAULT_INDEX);
  const limit = Number(flag('--limit', '0')) || 0;
  const batch = Number(flag('--batch', '64')) || 64;

  if (!isLoopback(url)) {
    process.stderr.write(`xerj-load: REFUSING — ${url} is not loopback. This tool is dev-only and never leaves the box.\n`);
    process.exit(2);
  }

  const cachePath = resolveStatePath(ROOT, 'doc-search-index.jsonl');
  if (!existsSync(cachePath)) {
    process.stderr.write(`xerj-load: REFUSING — no doc-search cache at ${cachePath}.\n  Run \`node tools/doc-search.mjs "<anything>"\` once to build it; this tool never embeds.\n`);
    if (asJson)
      process.stdout.write(
        `${JSON.stringify(verdictOf({ status: 'NOT_RUN', counts: { files: 0, loaded: 0, skipped: 0, docs: 0, skips: {} }, reason: 'no doc-search cache — nothing to load' }), null, 1)}\n`
      );
    process.exit(2);
  }

  /* ONE GENERATION PER LOAD — `index` is the NAME readers use, and after this run it is an alias.
     ⚠️ MEASURED 2026-10-11. Writing the same deterministic ids into ONE index every hour looked
     idempotent and was not: the engine's HNSW graph appends a vector on every overwrite and never
     reclaims the old one, then rewrites the whole graph file on every flush. After 4,643 bulk writes
     the index measured 9.7 GB on disk (3.3 GB graph for 62k documents — 53 KB per 4 KB vector), the
     server 11.3 GB RSS, searches 13–22 s, and the engine's memory breaker refused every further write.
     So a load builds a FRESH index named `<index>-<UTC stamp>`, fills it, and only then moves the
     alias to it in one request; the generation it replaced is deleted, which the engine honours on
     disk. A `--limit` probe loads into `<index>-probe`, which is deleted at the end and never
     promoted — a slice must not become what every reader sees. */
  const probe = limit > 0;
  const target = dry ? index : probe ? `${index}-probe` : generationName(index);
  if (!dry) {
    if (probe) await req(url, `/${target}`, 'DELETE');
    const made = await req(url, `/${target}`, 'PUT', JSON.stringify(mapping()));
    if (made.status >= 300) {
      process.stderr.write(`xerj-load: could not create ${target}: ${made.text.slice(0, 200)}\n`);
      process.exit(2);
    }
    process.stderr.write(`xerj-load: created ${target} with a ${VECTOR_DIMS}-dim cosine dense_vector mapping\n`);
  }

  const counts = { files: 0, loaded: 0, skipped: 0, docs: 0, repairedChunks: 0, tagged: 0, symbolDocs: 0, skips: {} };
  let pending = [];
  let header = null;
  const flush = async () => {
    if (!pending.length || dry) {
      pending = [];
      return;
    }
    const r = await req(url, '/_bulk', 'POST', bulkBody(target, pending), true);
    if (r.status >= 300 || (r.json && r.json.errors)) {
      const first = r.json?.items?.find((i) => i.index?.error)?.index?.error;
      throw new Error(`bulk failed (${r.status}): ${JSON.stringify(first || r.text.slice(0, 200))}`);
    }
    pending = [];
  };

  try {
    await fill();
  } catch (e) {
    /* A half-built generation is never promoted, so readers still have the previous one; delete it
       so it does not sit on disk, and let the error surface. If even that fails, the next successful
       promotion retires it by name (`isGeneration`). */
    if (!dry) await req(url, `/${target}`, 'DELETE').catch(() => {});
    throw e;
  }

  async function fill() {
    for await (const line of readLines(cachePath)) {
      const t = line.trim();
      if (!t) continue;
      let entry;
      try {
        entry = JSON.parse(t);
      } catch {
        continue;
      }
      if (header === null && entry.model) {
        header = entry.model;
        /* THE MODEL IS PART OF THE CONTRACT. A cache written by a different embedder carries vectors
         from a different space; loading them under a 1024-dim bge-m3 mapping would produce a kNN
         ranking that means nothing and looks fine. */
        if (header !== CACHE_MODEL) {
          process.stderr.write(`xerj-load: REFUSING — cache model is ${header}, expected ${CACHE_MODEL}.\n`);
          process.exit(2);
        }
        continue;
      }
      if (!entry.file) continue;
      counts.files += 1;
      /* EXTERNAL DOCS ARE IN SCOPE, and that is a fairness requirement rather than a convenience.
       doc-search ranks over repo AND external roots (today's own Rule 0 answer came from
       `ext:memory/...`), so an index holding only the repo would lose those hits and the benchmark
       would read as "hybrid is worse" when the real difference is a smaller corpus. The roots are
       vendor SDK source and the memory dir, each declaring its own source extensions — no
       recording, no capture — and every path still passes the FORBIDDEN assertion below. */
      let body = null;
      let rawText = null;
      const abs = entry.file.startsWith(EXT_PREFIX) ? extAbs().get(entry.file) : join(ROOT, entry.file);
      if (abs && existsSync(abs)) {
        try {
          rawText = readFileSync(abs, 'utf8');
          body = readDoc(entry.file, rawText);
        } catch {
          body = null;
          rawText = null;
        }
      }
      const scopes = rawText == null ? null : JS_EXT.test(entry.file) ? jsScopes(rawText) : ctagsScopes(entry.file, abs);
      if (scopes?.length) counts.tagged += 1;
      const plan = planFile(entry, body, VECTOR_DIMS, chunk, rawText, scopes);
      if (!plan.ok) {
        counts.skipped += 1;
        counts.skips[plan.reason] = (counts.skips[plan.reason] || 0) + 1;
        continue;
      }
      counts.loaded += 1;
      counts.docs += plan.docs.length;
      counts.symbolDocs += plan.docs.filter((d) => d.symbols).length;
      counts.repairedChunks += plan.repaired;
      for (const d of plan.docs) {
        pending.push(d);
        if (pending.length >= batch) await flush();
      }
      if (limit && counts.loaded >= limit) break;
    }
    await flush();
  }

  /* EXAMINED-NOTHING REFUSAL. A run that loaded no document is not a clean load; it means the cache,
     the corpus or the staleness rule stopped matching. Reporting PASS over 0 is the failure shape
     this repo refuses, so it is a FAIL with the skip histogram as the evidence. */
  const nothing = counts.docs === 0;
  const status = nothing ? 'FAIL' : 'PASS';
  const reason = nothing ? `loaded 0 documents from ${counts.files} cache entries — skips: ${JSON.stringify(counts.skips)}` : null;

  /* PROMOTE OR DISCARD. Readers move only to a generation that loaded something; a load of zero or a
     probe is deleted and the alias stays where it was. */
  let generation = null;
  if (!dry) {
    if (nothing || probe) {
      await req(url, `/${target}`, 'DELETE');
      generation = { index: target, promoted: false, deleted: true };
    } else {
      generation = { index: target, promoted: true, ...(await promote(url, index, target)) };
    }
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify(verdictOf({ status, counts, reason, generation }), null, 1)}\n`);
  } else {
    process.stdout.write(`xerj-load · ${dry ? 'DRY RUN · ' : ''}index ${index}\n`);
    process.stdout.write(`  cache entries (files)      : ${counts.files}\n`);
    process.stdout.write(`  loaded (file / chunk docs) : ${counts.loaded} / ${counts.docs}\n`);
    process.stdout.write(`  skipped                    : ${counts.skipped}\n`);
    process.stdout.write(`  chunks with a split pair repaired : ${counts.repairedChunks}\n`);
    process.stdout.write(`  files / chunks naming a symbol : ${counts.tagged} / ${counts.symbolDocs}\n`);
    for (const [k, n] of Object.entries(counts.skips).sort((a, b) => b[1] - a[1])) process.stdout.write(`    ${k.padEnd(16)} ${n}\n`);
    if (generation?.promoted)
      process.stdout.write(`  generation ${generation.index} now serves ${index} · replaced ${generation.replaced.join(', ') || 'nothing'} · retired ${generation.retired.length}\n`);
    else if (generation) process.stdout.write(`  ${probe ? 'probe' : 'empty generation'} ${generation.index} deleted · ${index} untouched\n`);
    if (nothing) process.stdout.write('  ✕ loaded NOTHING — see the skip histogram above\n');
  }
  process.exit(nothing ? 1 : 0);
}

/**
 * Move `alias` to `next` in one request and retire what it pointed at.
 *
 * Three states are possible on entry, and the first run after this change meets the second:
 *   - `alias` is an alias over one or more generations → swap, then delete those generations;
 *   - `alias` is a REAL index wearing that name (every load before 2026-10-11) → an alias cannot
 *     share a name with an index, so the real one is deleted first; readers see no index for the
 *     moment between that delete and the swap, once, and the one-shot unit retries on failure;
 *   - nothing holds the name → add the alias.
 * Afterwards every other `<alias>-<stamp>` index is deleted too: an orphan of an aborted run.
 */
export async function promote(url, alias, next) {
  const held = await req(url, `/_alias/${alias}`, 'GET');
  const olds = held.json && typeof held.json === 'object' && !Array.isArray(held.json) ? Object.keys(held.json).filter((k) => k !== next) : [];
  const replaced = [...olds];
  if (olds.length === 0) {
    const real = await req(url, `/${alias}`, 'GET');
    if (real.status === 200) {
      const gone = await req(url, `/${alias}`, 'DELETE');
      if (gone.status >= 300) throw new Error(`could not delete the legacy index ${alias} (${gone.status}): ${gone.text.slice(0, 200)}`);
      replaced.push(alias);
    }
  }
  const sw = await req(url, '/_aliases', 'POST', JSON.stringify(swapActions(alias, olds, next)));
  if (sw.status >= 300) throw new Error(`alias swap failed (${sw.status}): ${sw.text.slice(0, 200)}`);
  const cat = await req(url, '/_cat/indices?h=index&format=json', 'GET');
  const names = Array.isArray(cat.json) ? cat.json.map((r) => r.index).filter((n) => typeof n === 'string') : [];
  const retired = [];
  for (const n of names) {
    if (n === next || !(olds.includes(n) || isGeneration(n, alias))) continue;
    const d = await req(url, `/${n}`, 'DELETE');
    if (d.status < 300) retired.push(n);
  }
  return { replaced, retired };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    process.stderr.write(`xerj-load: ${e.message}\n`);
    process.exit(2);
  });
}
