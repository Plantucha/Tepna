#!/usr/bin/env node
/* Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ════════════════════════════════════════════════════════════════════════
 * xerj-load — write doc-search's EXISTING chunks and cached bge-m3 vectors into a xerj index
 * carrying a `dense_vector` mapping, so one engine can serve BM25 + kNN + hybrid in one request.
 *
 *   node tools/xerj-load.mjs                 # load every eligible file (idempotent)
 *   node tools/xerj-load.mjs --limit 50      # a slice, for a probe
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
        file_hash: { type: 'keyword' },
        text: { type: 'text' },
        vec: { type: 'dense_vector', dims, index: true, similarity: 'cosine' }
      }
    }
  };
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
 */
export function planFile(entry, body, dims = VECTOR_DIMS, chunkFn = chunk) {
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
  return {
    ok: true,
    get repaired() {
      return repaired;
    },
    docs: chunks.map((raw, i) => ({
      /* A DETERMINISTIC id is what makes a reload idempotent: the same chunk overwrites itself
         instead of accumulating a duplicate, so this tool is safe to re-run and resumable by
         simply running again. */
      _id: `${file}#${i}`,
      path: file,
      chunk_index: i,
      chunk_count: chunks.length,
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

export function verdictOf({ status, counts, reason }) {
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
    result: status === 'NOT_RUN' ? null : { ...counts },
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

  if (!dry) {
    const head = await req(url, `/${index}`, 'GET');
    if (head.status === 404) {
      const made = await req(url, `/${index}`, 'PUT', JSON.stringify(mapping()));
      if (made.status >= 300) {
        process.stderr.write(`xerj-load: could not create ${index}: ${made.text.slice(0, 200)}\n`);
        process.exit(2);
      }
      process.stderr.write(`xerj-load: created index ${index} with a ${VECTOR_DIMS}-dim cosine dense_vector mapping\n`);
    }
  }

  const counts = { files: 0, loaded: 0, skipped: 0, docs: 0, repairedChunks: 0, skips: {} };
  let pending = [];
  let header = null;
  const flush = async () => {
    if (!pending.length || dry) {
      pending = [];
      return;
    }
    const r = await req(url, '/_bulk', 'POST', bulkBody(index, pending), true);
    if (r.status >= 300 || (r.json && r.json.errors)) {
      const first = r.json?.items?.find((i) => i.index?.error)?.index?.error;
      throw new Error(`bulk failed (${r.status}): ${JSON.stringify(first || r.text.slice(0, 200))}`);
    }
    pending = [];
  };

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
    const abs = entry.file.startsWith(EXT_PREFIX) ? extAbs().get(entry.file) : join(ROOT, entry.file);
    if (abs && existsSync(abs)) {
      try {
        body = readDoc(entry.file, readFileSync(abs, 'utf8'));
      } catch {
        body = null;
      }
    }
    const plan = planFile(entry, body);
    if (!plan.ok) {
      counts.skipped += 1;
      counts.skips[plan.reason] = (counts.skips[plan.reason] || 0) + 1;
      continue;
    }
    counts.loaded += 1;
    counts.docs += plan.docs.length;
    counts.repairedChunks += plan.repaired;
    for (const d of plan.docs) {
      pending.push(d);
      if (pending.length >= batch) await flush();
    }
    if (limit && counts.loaded >= limit) break;
  }
  await flush();

  /* EXAMINED-NOTHING REFUSAL. A run that loaded no document is not a clean load; it means the cache,
     the corpus or the staleness rule stopped matching. Reporting PASS over 0 is the failure shape
     this repo refuses, so it is a FAIL with the skip histogram as the evidence. */
  const nothing = counts.docs === 0;
  const status = nothing ? 'FAIL' : 'PASS';
  const reason = nothing ? `loaded 0 documents from ${counts.files} cache entries — skips: ${JSON.stringify(counts.skips)}` : null;

  if (asJson) {
    process.stdout.write(`${JSON.stringify(verdictOf({ status, counts, reason }), null, 1)}\n`);
  } else {
    process.stdout.write(`xerj-load · ${dry ? 'DRY RUN · ' : ''}index ${index}\n`);
    process.stdout.write(`  cache entries (files)      : ${counts.files}\n`);
    process.stdout.write(`  loaded (file / chunk docs) : ${counts.loaded} / ${counts.docs}\n`);
    process.stdout.write(`  skipped                    : ${counts.skipped}\n`);
    process.stdout.write(`  chunks with a split pair repaired : ${counts.repairedChunks}\n`);
    for (const [k, n] of Object.entries(counts.skips).sort((a, b) => b[1] - a[1])) process.stdout.write(`    ${k.padEnd(16)} ${n}\n`);
    if (nothing) process.stdout.write('  ✕ loaded NOTHING — see the skip histogram above\n');
  }
  process.exit(nothing ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    process.stderr.write(`xerj-load: ${e.message}\n`);
    process.exit(2);
  });
}
