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
  const _source = ['path', 'chunk_index', 'chunk_count', 'text'];
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
  const where = s.chunk_count > 1 ? ` [chunk ${s.chunk_index + 1}/${s.chunk_count}]` : '';
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
  return { score: hit?._score ?? 0, path, where, text };
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

export async function hybridSearch({ query, url = DEFAULT_URL, index = DEFAULT_INDEX, topK = 5, fetchFn = fetch, embedFn = embedQuery }) {
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
  const ask = async (vec) => {
    const res = await fetchFn(`${url}/${index}/_search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(searchBody(query, vec, topK * 5))
    });
    if (!res.ok) throw new Error(`xerj HTTP ${res.status} — is the index loaded? (node tools/xerj-load.mjs)`);
    const j = await res.json();
    return collapseByPath(
      (j?.hits?.hits ?? []).map((h) => formatHit(h)),
      topK * 2
    );
  };
  const lex = await ask(null);
  const bm25 = lex[0]?.score ?? null;
  if (!vector) return { hits: lex.slice(0, topK), degraded, hybrid: false, signals: { cos: null, bm25 }, refused: false };
  const sem = await ask(vector);
  const signals = { cos: sem[0]?.score ?? null, bm25 };
  return { hits: fuseRRF([lex, sem], topK), degraded, hybrid: true, lexTop: lex[0]?.path ?? null, semTop: sem[0]?.path ?? null, signals, refused: belowFloor(signals) };
}

export function selftest() {
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

  // 6 · LOOPBACK ONLY.
  ok(isLoopback('http://127.0.0.1:9200'), 'loopback is accepted');
  ok(!isLoopback('http://10.1.2.3:9200'), 'a non-loopback host is refused');

  const line = fail.length ? `xerj-query selftest · ${fail.length} of ${ran} FAILED` : `all ${ran} selftests passed`;
  return { ok: fail.length === 0, ran, fail, line };
}

export function render(out, query) {
  const lines = [`▸ hybrid (BM25 + bge-m3 kNN, one request) · "${query}"`, ''];
  if (out.degraded) lines.push(`  ⚠ ${out.degraded}`, '');
  if (!out.hits.length) lines.push('  (no hit — is the index loaded? `node tools/xerj-load.mjs`)');
  if (out.refused) {
    const { cos, bm25 } = out.signals;
    lines.push(`  no prior work — both halves are below the refusal floor: cosine ${cos.toFixed(3)} < ${REFUSE_COS}, BM25 ${bm25.toFixed(1)} < ${REFUSE_BM25}.`);
    lines.push('  The paths below are the weak best guesses, for reference only, not evidence:', '');
    for (const h of out.hits) lines.push(`    ${h.path}${h.where}`);
    return lines.join('\n');
  }
  for (const h of out.hits) {
    lines.push(`  ${h.score.toFixed(3)}  ${h.path}${h.where}`);
    lines.push(`        ${h.text}`);
    lines.push('');
  }
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    const r = selftest();
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
  hybridSearch({ query })
    .then((out) => {
      process.stdout.write(`${render(out, query)}\n`);
    })
    .catch((e) => {
      process.stderr.write(`xerj-query: ${e.message}\n`);
      process.exit(2);
    });
}
