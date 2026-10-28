#!/usr/bin/env node
/* Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ════════════════════════════════════════════════════════════════════════
 * xerj-query — ask the hybrid index (BM25 + bge-m3 kNN, one request) and print the enclosing passage.
 *
 *   node tools/doc-search.mjs --hybrid "<question>"   # the intended entry point
 *   node tools/xerj-query.mjs "<question>"            # the same, standalone
 *   node tools/xerj-query.mjs --selftest
 *
 * WHY A SEPARATE MODULE. `doc-search.mjs` is the tool Rule 0 runs before every unit, so its default
 * path must not gain a single line of new cost or risk. This file holds all of the hybrid logic and
 * doc-search imports it DYNAMICALLY, only when `--hybrid` is present — so the default path is
 * unchanged, and a broken or absent xerj server cannot affect it.
 *
 * WHAT IT ADDS over the semantic default: xerj returns the matching PASSAGE, not just the path, so
 * the answer is readable without a second read step. The vectors are the ones doc-search already
 * cached (`xerj-load.mjs` wrote them); nothing is re-embedded except the one-line query.
 */

import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
export const DEFAULT_URL = 'http://127.0.0.1:9200';
export const DEFAULT_INDEX = 'tepna-hybrid';
export const OLLAMA = process.env.DEX_OLLAMA || 'http://127.0.0.1:11434';
export const EMBED_MODEL = process.env.DEX_EMBED || 'bge-m3';

/**
 * THE REFUSAL FLOOR. A ranker always returns a top 5, also for a question the corpus cannot answer, and
 * a confident rank on an unrelated DSP file is how a wrong answer enters a unit. So the hybrid lane
 * says "no prior work" when BOTH halves are weak: the best kNN cosine is below `REFUSE_COS` AND the
 * best BM25 score is below `REFUSE_BM25`. One strong half is enough to answer.
 *
 * MEASURED 2026-10-12 (`node tools/xerj-bench.mjs --refusal`). Population: the 52 real Rule-0 queries
 * of `audits/XERJ-BENCH-QUERIES.json` (answerable) and the 40 off-topic queries of
 * `audits/XERJ-REFUSAL-QUERIES.json`, length-matched (median 14 words each). The floor was FIT on the
 * even-indexed half of each set, under a rule stated before the fit: refuse no answerable query, and
 * refuse the most off-topic ones; ties go to the lower floor. On the odd-indexed half, which the fit
 * never saw, it refused 1 of 26 answerable queries and 18 of 20 off-topic ones. The one answerable
 * query it refused had no ground-truth file in its hybrid top 5 either.
 *
 * Limits. The off-topic set is invented, not harvested, and it holds no near-domain question (a
 * physiology topic that Tepna does not cover). The floor is a property of this index and this
 * embedder: a re-load with another model moves the cosine scale, so re-run the bench after one.
 */
export const REFUSE_COS = 0.8075;
export const REFUSE_BM25 = 27;

/**
 * THE RERANKER FLOOR (`--rerank`, opt-in). bge-reranker-v2-m3 reads the query and each passage
 * together and returns one relevance logit; its sigmoid is an ABSOLUTE score, where the cosine and the
 * BM25 above are relative to this index. The reranker scores the fused top 20; the best score below
 * the floor refuses. It never reorders the hits: on the 52 Rule-0 queries a reranked order put a
 * truth file in the top 5 for 40, the fused order for 42.
 *
 * MEASURED 2026-10-12, same sets and same rule as the floor above (fit on even i, refuse no answerable
 * query, refuse the most off-topic ones, ties to the lower floor). The fit half's highest off-topic
 * score was 0.1047 and its lowest answerable score 0.278. On the hold-out the floor refused 1 of 26
 * answerable queries, which had no truth file in its top 5, and 20 of 20 off-topic ones (the cosine
 * and BM25 floor: 18 of 20). The server is a local llama.cpp `--reranking` process on loopback; when it
 * does not answer, the search falls back to the floor above and says so.
 */
export const RERANK_URL = process.env.DEX_RERANK || 'http://127.0.0.1:8091';
export const REFUSE_RERANK = 0.105;
const RERANK_POOL = 20;
export const belowRerankFloor = (score) => score < REFUSE_RERANK;
const RERANK_TIMEOUT_MS = 5000;

/** Both halves weak ⇒ refuse. A missing half (no vector) cannot be judged, so it never refuses. */
export function belowFloor({ cos, bm25 }) {
  if (!Number.isFinite(cos) || !Number.isFinite(bm25)) return false;
  return cos < REFUSE_COS && bm25 < REFUSE_BM25;
}

export function isLoopback(url) {
  try {
    const h = new URL(url).hostname;
    return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
  } catch {
    return false;
  }
}

/**
 * One request, ONE retrieval mode. `vector` present ⇒ kNN; absent ⇒ BM25.
 *
 * 🔴 MEASURED 2026-10-10: xerj rc.93 does NOT fuse a `query` and a `knn` clause sent together.
 * Asked for both at 58k documents it returns a THIRD ranking belonging to neither — over four
 * queries the combined top-5 overlapped BM25 by 0–1 of 5 and kNN by **0 of 5**, with scores (~4.4)
 * matching neither BM25's (~34) nor cosine's (~0.85), and the top hit was a hook test script or
 * `CHANGELOG.md`. Each half ALONE is sensible. The single-request hybrid probed fine on 3 documents,
 * which is why this had to be re-measured at scale rather than inherited.
 *
 * So the fusion is done HERE, client side, by reciprocal rank (`fuseRRF`). Two requests cost ~2 ms
 * more on loopback and the result is one we can state the rule for.
 *
 * `num_candidates` stays well above `k`: kNN is approximate, and a candidate pool barely larger
 * than the result set turns recall into luck.
 */
export function searchBody(query, vector, topK = 5) {
  const _source = ['path', 'chunk_index', 'chunk_count', 'line_start', 'line_end', 'symbols', 'text'];
  /* NEVER BOTH CLAUSES AT ONCE — see the note above: rc.93 answers such a request with a ranking
     belonging to neither half. A caller who wants both calls twice and fuses. */
  if (Array.isArray(vector) && vector.length) {
    return { size: topK, knn: { field: 'vec', query_vector: vector, k: topK, num_candidates: Math.max(200, topK * 20) }, _source };
  }
  return { size: topK, query: { match: { text: { query } } }, _source };
}

/**
 * Reciprocal-rank fusion. A document's score is Σ 1/(k + rank) over the lists that contain it, so a
 * hit both halves agree on outranks one that only a single half found, and the two score SCALES never
 * have to be reconciled — which is the trap in blending BM25 (~34) with cosine (~0.85) directly.
 * k = 60 is the conventional damping: large enough that rank 1 does not dominate outright.
 */
export function fuseRRF(lists, topK = 5, k = 60) {
  const score = new Map();
  const pick = new Map();
  for (const list of lists) {
    list.forEach((h, i) => {
      score.set(h.path, (score.get(h.path) ?? 0) + 1 / (k + i + 1));
      const prev = pick.get(h.path);
      if (!prev || (h.text || '').length > (prev.text || '').length) pick.set(h.path, h);
    });
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([path, s]) => ({ ...pick.get(path), score: s }));
}

/** One hit → the printable line plus its passage, trimmed to `chars` without cutting mid-word. */
export function formatHit(hit, chars = 900) {
  const s = hit?._source ?? {};
  const path = s.path ?? '(unknown)';
  /* `file:first-last` opens at the passage. An index built before the loader wrote line fields, or a
     chunk the loader could not place, keeps the chunk position — absent lines are never printed as 0. */
  const ls = Number.isInteger(s.line_start) ? s.line_start : null;
  const le = Number.isInteger(s.line_end) ? s.line_end : null;
  const where = ls !== null ? `:${ls}${le !== null && le !== ls ? `-${le}` : ''}` : s.chunk_count > 1 ? ` [chunk ${s.chunk_index + 1}/${s.chunk_count}]` : '';
  /* The function the passage sits in, from the loader's ctags pass; an untagged chunk prints nothing. */
  const sym = Array.isArray(s.symbols) && s.symbols.length ? ` · ${s.symbols.join(', ')}` : '';
  let text = String(s.text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  /* The chunk text carries doc-search's `${file} :: ` prefix — it is part of what was embedded, so
     it is not stripped from the index, only from the display, where it would repeat the path. */
  const pfx = `${path} :: `;
  if (text.startsWith(pfx)) text = text.slice(pfx.length);
  if (text.length > chars) {
    const cut = text.lastIndexOf(' ', chars);
    text = `${text.slice(0, cut > chars * 0.6 ? cut : chars)}…`;
  }
  return { score: hit?._score ?? 0, path, where: where + sym, text };
}

/**
 * BEST CHUNK PER FILE. doc-search's ranker already does this — "a long brief must not crowd the list
 * with its own sections" — and the hybrid path must match it or the two are not comparable: a 25-chunk
 * lesson index would take four of five slots and the benchmark would read that as worse recall when
 * it is the same answer four times. Over-fetching then collapsing is why `searchBody` is asked for
 * more than `topK`.
 */
export function collapseByPath(hits, topK = 5) {
  const best = new Map();
  for (const h of hits) {
    const prev = best.get(h.path);
    if (!prev || h.score > prev.score) best.set(h.path, h);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, topK);
}

/* ── ONE SOURCE MAY NOT OWN THE ANSWER (row `2026-10-18-board-hits-have-no-share-cap-in-rule-0`) ──
 * The agent board joined the Rule 0 corpus on 2026-10-17 as one file per post, and a post ranks on
 * the same scale as a brief, a source file or a lesson. The board grows by the hour and the repo
 * does not, so the board's share of the five hits a reader actually reads grows with it.
 *
 * MEASURED 2026-10-28 over the 84 distinct Rule 0 queries the fleet itself ran, harvested from the
 * board's own posts and replayed against this lane: board posts held 185 of the 420 top-five slots,
 * 44 %. 36 of the 84 queries returned more than two posts in five, and ELEVEN returned five posts
 * and no repo document at all. The owner deferred the cap on 2026-10-17 until the board neared
 * 1,000 posts; the snapshot that morning held 1,933 entries, 781 of the indexed kinds.
 *
 * The rule is a SHARE, not a count, because the two lanes show different list lengths and a count
 * pinned to one of them would read as a different rule in the other (`tests/verify-shard-timings.mjs`
 * makes the same argument for its ratchet). `Math.max(1, …)` is deliberate: a single post is never
 * capped out, so a ruling that exists only on the board still reaches the reader.
 *
 * §∅: the cap REORDERS, it never invents and it never hides the only answer there is. A post the cap
 * defers comes back when no other source can fill the slot, and `held` reports exactly how many posts
 * lost a slot, so a reader who wants them knows they exist (`doc-search --board-all`). */
export const CAPPED_PREFIX = 'ext:agent-board/';
export const CAPPED_SHARE = 0.4;
export function capMax(topK, share = CAPPED_SHARE) {
  return Math.max(1, Math.floor(topK * share));
}
export function capSourceShare(hits, topK = 5, { prefix = CAPPED_PREFIX, share = CAPPED_SHARE, pathOf = (h) => h?.path ?? h?.file } = {}) {
  const max = capMax(topK, share);
  const kept = [];
  const deferred = [];
  let taken = 0;
  for (const h of hits || []) {
    if (kept.length >= topK) break;
    if (String(pathOf(h) ?? '').startsWith(prefix)) {
      if (taken >= max) {
        deferred.push(h);
        continue;
      }
      taken++;
    }
    kept.push(h);
  }
  while (kept.length < topK && deferred.length) kept.push(deferred.shift());
  return { hits: kept, held: deferred.length, max };
}

export async function embedQuery(query, fetchFn = fetch) {
  const res = await fetchFn(`${OLLAMA}/v1/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: query })
  });
  if (!res.ok) throw new Error(`embedder HTTP ${res.status}`);
  const j = await res.json();
  const v = j?.data?.[0]?.embedding;
  if (!Array.isArray(v) || !v.length) throw new Error('embedder returned no vector');
  return v;
}

/** Best sigmoid relevance over `hits`, or throw. Loopback only: the passages are repo text. */
export async function rerankTop(query, hits, { url = RERANK_URL, fetchFn = fetch, timeoutMs = RERANK_TIMEOUT_MS } = {}) {
  if (!isLoopback(url)) throw new Error(`${url} is not loopback`);
  const res = await fetchFn(`${url}/v1/rerank`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, documents: hits.map((h) => h.text), top_n: hits.length }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`reranker HTTP ${res.status}`);
  const logits = ((await res.json())?.results ?? []).map((r) => r.relevance_score).filter(Number.isFinite);
  if (!logits.length) throw new Error('reranker returned no score');
  return 1 / (1 + Math.exp(-Math.max(...logits)));
}

export async function hybridSearch({ query, url = DEFAULT_URL, index = DEFAULT_INDEX, topK = 5, fetchFn = fetch, embedFn = embedQuery, rerank = false, cap = true }) {
  if (!isLoopback(url)) throw new Error(`${url} is not loopback — this tool is dev-only`);
  let vector = null;
  let degraded = null;
  try {
    vector = await embedFn(query, fetchFn);
  } catch (e) {
    degraded = `no query vector (${e.message}) — BM25 only, so a paraphrase will rank poorly`;
  }
  /* Over-fetch so the collapse has something to choose from: one file can legitimately own several
     of the top chunks, and taking topK before collapsing would return fewer than topK FILES. */
  const pool = rerank ? Math.max(topK * 2, RERANK_POOL) : topK * 2;
  const size = rerank ? pool * 5 : topK * 5;
  const ask = async (vec) => {
    const res = await fetchFn(`${url}/${index}/_search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(searchBody(query, vec, size))
    });
    if (!res.ok) throw new Error(`xerj HTTP ${res.status} — is the index loaded? (node tools/xerj-load.mjs)`);
    const j = await res.json();
    return collapseByPath(
      (j?.hits?.hits ?? []).map((h) => formatHit(h)),
      pool
    );
  };
  /* The capped list and the uncapped one are taken from the same ranked pool, so `--board-all` is
     the SAME search with the cap off, never a second ranking. */
  const take = (list) => (cap ? capSourceShare(list, topK) : { hits: (list || []).slice(0, topK), held: 0, max: null });
  const lex = await ask(null);
  const bm25 = lex[0]?.score ?? null;
  if (!vector) return { ...take(lex), degraded, hybrid: false, signals: { cos: null, bm25 }, refused: false };
  const sem = await ask(vector);
  const signals = { cos: sem[0]?.score ?? null, bm25 };
  const base = { degraded, hybrid: true, lexTop: lex[0]?.path ?? null, semTop: sem[0]?.path ?? null, signals };
  if (!rerank) return { ...base, ...take(fuseRRF([lex, sem], Math.max(topK, RERANK_POOL))), refused: belowFloor(signals) };
  const fused = fuseRRF([lex, sem], RERANK_POOL);
  try {
    signals.rerank = await rerankTop(query, fused, { fetchFn });
    return { ...base, ...take(fused), refused: belowRerankFloor(signals.rerank) };
  } catch (e) {
    const note = `no reranker (${e.message}) — the cosine and BM25 floor decides`;
    return { ...base, degraded: degraded ? `${degraded}; ${note}` : note, ...take(fused), refused: belowFloor(signals) };
  }
}

export async function selftest() {
  const fail = [];
  let ran = 0;
  const ok = (c, w) => {
    ran += 1;
    if (!c) fail.push(w);
  };

  /* 1 · ONE MODE PER REQUEST. rc.93 does not fuse the two clauses — measured, see searchBody — so a
         body must never carry both, or the server answers with a ranking belonging to neither. */
  const b = searchBody('q', [0.1, 0.2], 5);
  ok(!!b.knn && !b.query, 'with a vector the body is kNN ONLY — never both clauses');
  ok(b.knn.num_candidates >= 200 && b.knn.num_candidates > b.knn.k, 'the candidate pool is well above k, so recall is not luck');
  const b2 = searchBody('q', null, 5);
  ok(!b2.knn && !!b2.query.match, 'without a vector the body is BM25 only');
  ok(!searchBody('q', [], 5).knn, 'an empty vector is treated as no vector');

  /* 2 · RRF: agreement beats a single strong hit, and the two score SCALES never meet — which is the
         trap in blending BM25 (~34) with cosine (~0.85) arithmetically. */
  const lex = [
    { path: 'a', text: 'aa' },
    { path: 'b', text: 'bb' },
    { path: 'c', text: 'cc' }
  ];
  const sem = [
    { path: 'c', text: 'ccc' },
    { path: 'd', text: 'dd' },
    { path: 'a', text: 'a' }
  ];
  const fused = fuseRRF([lex, sem], 4);
  ok(fused[0].path === 'a' || fused[0].path === 'c', 'a document both halves found outranks one only a single half found');
  ok(fused.map((h) => h.path).includes('d'), 'a semantic-only hit still appears');
  ok(
    fuseRRF([lex, []], 3)
      .map((h) => h.path)
      .join(',') === 'a,b,c',
    'fusing with an empty list preserves the other ranking'
  );
  ok(fuseRRF([[], []], 3).length === 0, 'fusing two empty lists yields nothing, not an error');
  ok(fuseRRF([lex, sem], 4).find((h) => h.path === 'c').text === 'ccc', 'the LONGER passage is kept when both halves carry one');

  // 3 · THE PASSAGE IS PRINTABLE and does not repeat the path it already shows.
  const h = formatHit({ _score: 1.5, _source: { path: 'docs/a.md', chunk_index: 2, chunk_count: 7, text: 'docs/a.md :: the body text' } });
  ok(h.text === 'the body text', "the chunk's `file :: ` prefix is stripped from the DISPLAY only");
  ok(h.where === ' [chunk 3/7]', 'the chunk position is 1-based for a reader');
  ok(formatHit({ _source: { path: 'x', chunk_index: 0, chunk_count: 1, text: 'x :: solo' } }).where === '', 'a single-chunk file shows no position');
  const long = formatHit({ _source: { path: 'p', text: `p :: ${'word '.repeat(400)}` } }, 100);
  ok(long.text.length <= 101 && long.text.endsWith('…'), 'a long passage is cut and marked');
  ok(!/\s$/.test(long.text.replace(/…$/, '')), 'the cut lands on a word boundary');

  /* 4 · ONE FILE CANNOT TAKE EVERY SLOT, which is doc-search's own rule. Without this a 25-chunk
         lesson index returns the same answer five times and a benchmark scores it as five hits. */
  const many = [
    { path: 'a.md', score: 9, text: 'x' },
    { path: 'a.md', score: 8, text: 'y' },
    { path: 'a.md', score: 7, text: 'z' },
    { path: 'b.md', score: 6, text: 'w' },
    { path: 'c.md', score: 5, text: 'v' }
  ];
  const col = collapseByPath(many, 5);
  ok(col.length === 3, 'three distinct files collapse to three hits, not five');
  ok(col[0].path === 'a.md' && col[0].score === 9, 'the BEST chunk of a file is the one kept');
  ok(collapseByPath(many, 2).length === 2, 'topK still caps the collapsed list');
  ok(collapseByPath([], 5).length === 0, 'an empty result collapses to empty, not an error');

  /* 5 · THE REFUSAL FLOOR needs BOTH halves weak, and a half that was not measured never refuses. */
  ok(belowFloor({ cos: REFUSE_COS - 0.01, bm25: REFUSE_BM25 - 1 }), 'both halves below the floor ⇒ refuse');
  ok(!belowFloor({ cos: REFUSE_COS + 0.01, bm25: REFUSE_BM25 - 1 }), 'a strong cosine alone answers');
  ok(!belowFloor({ cos: REFUSE_COS - 0.01, bm25: REFUSE_BM25 + 1 }), 'a strong BM25 alone answers');
  ok(!belowFloor({ cos: REFUSE_COS, bm25: REFUSE_BM25 }), 'a score AT the floor answers — the floor is strict');
  ok(!belowFloor({ cos: null, bm25: 1 }) && !belowFloor({ cos: 0.1, bm25: null }), 'a missing half is not evidence of a weak half');
  const refusedOut = render({ hits: [{ score: 0.016, path: 'a.js', where: '', text: 'long passage' }], refused: true, signals: { cos: 0.75, bm25: 12 } }, 'q');
  ok(refusedOut.includes('no prior work'), 'a refusal prints "no prior work"');
  ok(refusedOut.includes('a.js') && !refusedOut.includes('long passage'), '…lists the weak paths for reference, without their passages');
  ok(refusedOut.includes('0.750') && refusedOut.includes('12.0'), '…and prints both scores against the floor');
  ok(!render({ hits: [{ score: 0.016, path: 'a.js', where: '', text: 'long passage' }], refused: false }, 'q').includes('no prior work'), 'CONTROL: an answer is not a refusal');

  // 5b · LINE RANGES AND --brief.
  const placed = formatHit({ _source: { path: 'docs/a.md', chunk_index: 2, chunk_count: 7, line_start: 40, line_end: 52, text: 'docs/a.md :: t' } });
  ok(placed.where === ':40-52', 'a placed chunk prints file:first-last');
  ok(formatHit({ _source: { path: 'a', chunk_index: 0, chunk_count: 2, line_start: 9, line_end: 9, text: 'a :: t' } }).where === ':9', 'a one-line range prints one number');
  ok(formatHit({ _source: { path: 'a', chunk_index: 0, chunk_count: 2, line_start: null, text: 'a :: t' } }).where === ' [chunk 1/2]', 'a null line keeps the chunk position, never :0');
  ok(searchBody('q', null)._source.includes('line_start'), 'the search asks for the line fields');
  const one = [{ score: 0.03, path: 'a.js', where: ':3-9', text: 'long passage' }];
  const briefOut = render({ hits: one, refused: false }, 'q', { brief: true });
  ok(briefOut.includes('a.js:3-9') && !briefOut.includes('long passage'), '--brief prints the hit line without its passage');
  ok(render({ hits: one, refused: false }, 'q').includes('long passage'), 'CONTROL: without --brief the passage prints');

  // 6 · LOOPBACK ONLY.
  ok(isLoopback('http://127.0.0.1:9200'), 'loopback is accepted');
  ok(!isLoopback('http://10.1.2.3:9200'), 'a non-loopback host is refused');

  /* 7 · THE RERANKER FLOOR refuses on the best score, keeps the fused order, and a dead server falls
         back to the cosine and BM25 floor with a note. Fakes only: no index, no reranker. */
  const doc = (p, sc) => ({ _score: sc, _source: { path: p, chunk_index: 0, chunk_count: 1, text: `text of ${p}` } });
  const fake = (logits) => async (u, o) => {
    if (u.endsWith('/v1/rerank')) {
      if (!logits) throw new Error('connection refused');
      return { ok: true, json: async () => ({ results: logits.map((l, index) => ({ index, relevance_score: l })) }) };
    }
    const knn = JSON.parse(o.body).knn;
    return { ok: true, json: async () => ({ hits: { hits: knn ? [doc('b.md', 0.9), doc('a.md', 0.8)] : [doc('a.md', 40), doc('b.md', 30)] } }) };
  };
  const emb = async () => [1, 0];
  const hi = await hybridSearch({ query: 'q', fetchFn: fake([-3, 2]), embedFn: emb, rerank: true });
  ok(!hi.refused && Math.abs(hi.signals.rerank - 1 / (1 + Math.exp(-2))) < 1e-9, 'the reranker floor reads the BEST score of the pool');
  const plain = await hybridSearch({ query: 'q', fetchFn: fake(null), embedFn: emb });
  ok(hi.hits.map((h) => h.path).join() === plain.hits.map((h) => h.path).join(), '…and never reorders the fused hits');
  const lo = await hybridSearch({ query: 'q', fetchFn: fake([-3, -2.3]), embedFn: emb, rerank: true });
  ok(lo.refused && render(lo, 'q').includes('below the floor 0.105'), 'a best score under the floor refuses and names the reranker');
  ok(!belowRerankFloor(REFUSE_RERANK) && belowRerankFloor(REFUSE_RERANK - 1e-6), 'a score AT the reranker floor answers — the floor is strict');
  const dead = await hybridSearch({ query: 'q', fetchFn: fake(null), embedFn: emb, rerank: true });
  ok(!Number.isFinite(dead.signals.rerank) && /no reranker/.test(dead.degraded) && dead.refused === belowFloor(dead.signals), 'a dead reranker falls back to the old floor and says so');
  ok(!plain.degraded && plain.signals.rerank === undefined, 'CONTROL: without --rerank no reranker is asked');
  ok(render(hi, 'q').includes('reranker best score 0.881') && !render(plain, 'q').includes('reranker'), 'an answer prints the absolute score; a plain search does not');
  let threw = false;
  try {
    await rerankTop('q', [{ text: 't' }], { url: 'http://10.1.2.3:8091', fetchFn: fake([1]) });
  } catch {
    threw = true;
  }
  ok(threw, 'a non-loopback reranker is refused — the passages are repo text');

  /* 8 · SYMBOLS print after the line range; an untagged hit prints none. */
  const symHit = formatHit({ _source: { path: 'a.js', line_start: 5, line_end: 9, symbols: ['inner', 'outer'], text: 'x' } });
  ok(symHit.where === ':5-9 · inner, outer', 'a tagged hit prints its function after the lines');
  ok(formatHit({ _source: { path: 'a.js', line_start: 5, line_end: 9, text: 'x' } }).where === ':5-9', 'CONTROL: an untagged hit prints the lines alone');
  ok(searchBody('q', null).query.match.text && !JSON.stringify(searchBody('q', null).query).includes('symbols'), 'the search body never reads symbols — no ranking moves');

  /* 9 · ONE SOURCE MAY NOT OWN THE ANSWER. The planted list is the shape measured on 2026-10-28:
         five board posts ahead of every repo document. Every leg here is a list the cap re-orders,
         never a search — the ranking it is given is the ranking it must keep inside each source. */
  const bp = (n, sc) => ({ path: `ext:agent-board/7/${n}.md`, score: sc });
  const rp = (n, sc) => ({ path: `briefs/${n}.md`, score: sc });
  const crowded = [bp(1, 0.9), bp(2, 0.8), bp(3, 0.7), bp(4, 0.6), bp(5, 0.5), rp('a', 0.4), rp('b', 0.3), rp('c', 0.2)];
  const capped = capSourceShare(crowded, 5);
  ok(capped.hits.map((h) => h.path.split('/')[0]).join() === 'ext:agent-board,ext:agent-board,briefs,briefs,briefs', 'two posts keep their slots and three repo documents take the rest');
  ok(capped.hits[0].path === 'ext:agent-board/7/1.md' && capped.hits[1].path === 'ext:agent-board/7/2.md', '…and the posts kept are the HIGHEST ranked two, not an arbitrary two');
  ok(capped.held === 3, 'held counts exactly the posts that lost a slot');
  ok(capMax(5) === 2 && capMax(8) === 3, 'the rule is a share of the list, so it reads the same in a lane that prints eight');
  ok(capMax(1) === 1 && capMax(2) === 1, 'a single post is never capped out — a ruling that lives only on the board still answers');
  /* §∅: withheld is not absent, and the cap never shortens an answer it cannot replace. */
  const onlyBoard = capSourceShare([bp(1, 0.9), bp(2, 0.8), bp(3, 0.7), bp(4, 0.6), bp(5, 0.5)], 5);
  ok(onlyBoard.hits.length === 5 && onlyBoard.held === 0, 'with nothing else to show, the deferred posts come back rather than leaving a short list');
  const thin = capSourceShare([bp(1, 0.9), bp(2, 0.8), bp(3, 0.7), bp(4, 0.6), rp('a', 0.5)], 5);
  ok(
    thin.hits
      .map((h) => h.path)
      .join()
      .includes('briefs/a.md') &&
      thin.hits.length === 5 &&
      thin.held === 0,
    '…and one repo document is kept ahead of the posts that fill the rest'
  );
  const clean = [rp('a', 0.9), rp('b', 0.8), rp('c', 0.7)];
  ok(JSON.stringify(capSourceShare(clean, 5).hits) === JSON.stringify(clean), 'CONTROL: a list with no board hit is returned untouched');
  ok(
    capSourceShare([{ file: 'ext:agent-board/7/1.md' }, { file: 'ext:agent-board/7/2.md' }, { file: 'ext:agent-board/7/3.md' }, { file: 'briefs/a.md' }], 4).hits[3].file === 'ext:agent-board/7/3.md',
    'the semantic lane shape is read too: a hit keyed `file` is capped like one keyed `path`'
  );

  /* …and the cap reaches the search, with the switch that turns it off. */
  const boardFake = (knnOrder) => async (u) => {
    if (u.endsWith('/v1/rerank')) throw new Error('connection refused');
    const list = knnOrder.map((n, i) => doc(n, 1 - i / 100));
    return { ok: true, json: async () => ({ hits: { hits: list } }) };
  };
  const order = ['ext:agent-board/7/1.md', 'ext:agent-board/7/2.md', 'ext:agent-board/7/3.md', 'ext:agent-board/7/4.md', 'briefs/a.md', 'briefs/b.md', 'briefs/c.md'];
  const on = await hybridSearch({ query: 'q', fetchFn: boardFake(order), embedFn: emb });
  const off = await hybridSearch({ query: 'q', fetchFn: boardFake(order), embedFn: emb, cap: false });
  ok(on.hits.filter((h) => h.path.startsWith('ext:agent-board/')).length === 2 && on.held === 2, 'the hybrid lane caps the board at two of five and reports two held');
  ok(off.hits.filter((h) => h.path.startsWith('ext:agent-board/')).length === 4 && off.held === 0, 'CONTROL: `--board-all` passes cap:false and the ranking is the unbounded one');
  ok(
    off.hits
      .map((h) => h.path)
      .slice(0, 4)
      .join() === order.slice(0, 4).join(),
    '…and the uncapped list is the same ranking, not a second search'
  );
  ok(render(on, 'q').includes('2 board post(s) held below the share cap'), 'the reader is told the posts exist and how to see them');
  ok(!render(off, 'q').includes('held below the share cap'), 'CONTROL: nothing is said when the cap held nothing back');

  const line = fail.length ? `xerj-query selftest · ${fail.length} of ${ran} FAILED` : `all ${ran} selftests passed`;
  return { ok: fail.length === 0, ran, fail, line };
}

/* `brief`: one line per hit, without the passage (`doc-search --brief`). The path is the answer's
   address; the reader opens it. A refusal prints the same in both modes. */
export function render(out, query, { brief = false } = {}) {
  const lines = [`▸ hybrid (BM25 + bge-m3 kNN, one request) · "${query}"`, ''];
  if (out.degraded) lines.push(`  ⚠ ${out.degraded}`, '');
  if (!out.hits.length) lines.push('  (no hit — is the index loaded? `node tools/xerj-load.mjs`)');
  if (out.refused) {
    const { cos, bm25, rerank } = out.signals;
    if (Number.isFinite(rerank)) lines.push(`  no prior work — the reranker's best score ${rerank.toFixed(3)} is below the floor ${REFUSE_RERANK}.`);
    else lines.push(`  no prior work — both halves are below the refusal floor: cosine ${cos.toFixed(3)} < ${REFUSE_COS}, BM25 ${bm25.toFixed(1)} < ${REFUSE_BM25}.`);
    lines.push('  The paths below are the weak best guesses, for reference only, not evidence:', '');
    for (const h of out.hits) lines.push(`    ${h.path}${h.where}`);
    return lines.join('\n');
  }
  if (Number.isFinite(out.signals?.rerank)) lines.push(`  reranker best score ${out.signals.rerank.toFixed(3)} (floor ${REFUSE_RERANK}; the order below is the fused one)`, '');
  /* Withheld is not absent: the reader is told the posts exist and how to see them. */
  if (out.held > 0)
    lines.push(`  ⚠ ${out.held} board post(s) held below the share cap (at most ${capMax(out.hits.length || 5)} of ${out.hits.length || 5}) — \`--board-all\` ranks them with everything else`, '');
  for (const h of out.hits) {
    lines.push(`  ${h.score.toFixed(3)}  ${h.path}${h.where}`);
    if (brief) continue;
    lines.push(`        ${h.text}`);
    lines.push('');
  }
  return lines.join('\n');
}

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { boolean: ['--selftest', '--rerank', '--brief'], positional: true }, { tool: 'xerj-query' });
  if (argv.includes('--selftest')) {
    const r = await selftest();
    process.stdout.write(`${r.line}\n`);
    for (const f of r.fail) process.stdout.write(`  ✕ ${f}\n`);
    process.exit(r.ok ? 0 : 1);
  }
  const query = argv
    .filter((a) => !a.startsWith('--'))
    .join(' ')
    .trim();
  if (!query) {
    process.stderr.write('usage: node tools/xerj-query.mjs "<question>"\n');
    process.exit(2);
  }
  hybridSearch({ query, rerank: argv.includes('--rerank') })
    .then((out) => {
      process.stdout.write(`${render(out, query, { brief: argv.includes('--brief') })}\n`);
    })
    .catch((e) => {
      process.stderr.write(`xerj-query: ${e.message}\n`);
      process.exit(2);
    });
}
