#!/usr/bin/env node
/* Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ════════════════════════════════════════════════════════════════════════
 * xerj-bench — score bge-alone vs hybrid vs xerj-BM25 on REAL past Rule-0 queries.
 *
 *   node tools/xerj-bench.mjs --harvest        # rebuild the query set from merged PR bodies
 *   node tools/xerj-bench.mjs                  # score (uses the committed query set)
 *   node tools/xerj-bench.mjs --json           # one tepna.verdict/1
 *   node tools/xerj-bench.mjs --selftest
 *   node tools/xerj-bench.mjs --refusal [--rerank] [--json]  # the refusal floor against answerable + off-topic sets
 *
 * 🔴 THE GROUND TRUTH IS NOT THE RECORDED HITS, AND THAT IS THE WHOLE METHOD.
 * Every merged PR since Rule 0 opens with `Rule 0: <query> → <hits>`, so the obvious ground truth is
 * those recorded hits. It is CIRCULAR: they are doc-search's own bge output, so bge scores ~100 % by
 * construction and any engine is measured by how well it imitates bge. Instead the ground truth is
 * **the files that PR went on to change** — the author's revealed answer, recorded independently of
 * which engine produced it. A search is credited when its top-5 names a file the author then touched.
 *
 * ⚠️ WHAT THAT GROUND TRUTH IS NOT. It is a proxy, and it is biased AGAINST every engine in one
 * specific way: a Rule-0 query often asks "has this already been decided?", whose right answer is a
 * brief or a lesson the PR never edits. So absolute hit@5 understates all three engines; the
 * COMPARISON between them is what this measures, because all three are scored against the same
 * proxy. Generated paths are excluded from the truth set (a rebuilt bundle, a provenance stamp and a
 * regenerated golden are consequences of the work, not findable answers).
 *
 * BYTES-TO-ANSWER is reported as two measured numbers rather than one contestable composite:
 * `printed` (bytes the tool actually prints for its top 5) and `open` (bytes of the first
 * ground-truth file a reader must then open, which is 0 when the printed passage already came from
 * that file and is long enough to read). Their sum is the headline. A higher number for hybrid would
 * be a measurement, not a failure.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
export const QUERY_SET = join(ROOT, 'audits', 'XERJ-BENCH-QUERIES.json');
export const REFUSAL_SET = join(ROOT, 'audits', 'XERJ-REFUSAL-QUERIES.json');

/**
 * THE REFUSAL FLOOR, judged. Each row is `{ kind: 'pos'|'neg', i, refused, hit }`: `pos` is a real
 * Rule-0 query (answerable), `neg` an off-topic one; `hit` is hybrid hit@5 for a `pos` row. The
 * criterion is stated without the data: the floor must refuse NO answerable query that hybrid answers
 * correctly (a refusal there loses a right answer), and must refuse MORE THAN HALF of the off-topic
 * queries (else it is not a floor). A refused `pos` row with no hit loses nothing, and is counted
 * apart. The hold-out (odd `i`) is reported separately, because the floor was fit on even `i`.
 */
export function scoreRefusal(rows) {
  const part = (set) => {
    const pos = set.filter((r) => r.kind === 'pos');
    const neg = set.filter((r) => r.kind === 'neg');
    return {
      pos: pos.length,
      posRefused: pos.filter((r) => r.refused).length,
      posRefusedWithHit: pos.filter((r) => r.refused && r.hit).length,
      neg: neg.length,
      negRefused: neg.filter((r) => r.refused).length
    };
  };
  const all = part(rows);
  const holdOut = part(rows.filter((r) => r.i % 2 === 1));
  const pass = all.pos > 0 && all.neg > 0 && all.posRefusedWithHit === 0 && all.negRefused * 2 > all.neg;
  return { all, holdOut, pass };
}

/** Paths that are consequences of work rather than findable answers. */
export const GENERATED = [/^provenance\//, /^uploads\//, /^docs\//, /^changes\//, /\.html$/, /^suite\.manifest\.json$/, /^CHANGELOG\.md$/, /^RELEASE-MANIFEST\.json$/];

export function truthSet(files) {
  return (files || []).filter((f) => !GENERATED.some((re) => re.test(f)));
}

/** hit@k — did the ranking name any ground-truth file in its first k? */
export function hitAt(ranked, truth, k = 5) {
  const t = new Set(truth);
  return ranked.slice(0, k).some((p) => t.has(p));
}

/** The 1-based rank of the first ground-truth hit, or null. */
export function firstHitRank(ranked, truth) {
  const t = new Set(truth);
  for (let i = 0; i < ranked.length; i++) if (t.has(ranked[i])) return i + 1;
  return null;
}

/**
 * Bytes a reader must consume. `printed` is measured from the tool's own output. `open` is the first
 * ground-truth file's size, charged only when the printed passage did NOT already show it — a path
 * without its text is an answer you still have to go and read.
 */
export function bytesToAnswer({ printed, passages, truth, sizeOf }) {
  const t = new Set(truth);
  const shown = (passages || []).find((p) => t.has(p.path) && (p.text || '').length >= 400);
  const open = shown
    ? 0
    : (() => {
        for (const f of truth) {
          const n = sizeOf(f);
          if (n != null) return n;
        }
        return 0;
      })();
  return { printed, open, total: printed + open };
}

export function selftest() {
  const fail = [];
  let ran = 0;
  const ok = (c, w) => {
    ran += 1;
    if (!c) fail.push(w);
  };

  // 1 · hit@k is about the FIRST k only, and k is honoured.
  ok(hitAt(['a', 'b', 'c'], ['c'], 5), 'a truth file inside the top k counts');
  ok(!hitAt(['a', 'b', 'c', 'd', 'e', 'z'], ['z'], 5), 'a truth file at rank 6 does NOT count at k=5');
  ok(!hitAt([], ['a'], 5), 'an empty ranking never counts as a hit');
  ok(!hitAt(['a'], [], 5), 'an empty truth set never counts as a hit — a query with no truth is excluded, not credited');
  ok(firstHitRank(['a', 'b', 'c'], ['c']) === 3 && firstHitRank(['a'], ['z']) === null, 'firstHitRank is 1-based and null on a miss');

  /* 2 · GENERATED PATHS ARE NOT ANSWERS. Without this a PR that rebuilt a bundle would credit any
         engine that returned the bundle, which is the consequence of the work, not its answer. */
  const t = truthSet(['oxydex-dsp.js', 'OxyDex.html', 'provenance/OxyDex.json', 'docs/OxyDex.html', 'uploads/x.json', 'changes/a.md', 'tests/dex-tests.js']);
  ok(t.length === 2 && t.includes('oxydex-dsp.js') && t.includes('tests/dex-tests.js'), 'only authored source survives the truth filter');

  // 3 · BYTES: a shown passage from a truth file costs no extra read; a bare path costs the file.
  const sizeOf = (f) => ({ 'a.js': 9000 })[f] ?? null;
  const withPassage = bytesToAnswer({ printed: 1200, passages: [{ path: 'a.js', text: 'x'.repeat(500) }], truth: ['a.js'], sizeOf });
  ok(withPassage.open === 0 && withPassage.total === 1200, 'a long passage from the truth file charges no open');
  const pathOnly = bytesToAnswer({ printed: 300, passages: [{ path: 'a.js', text: 'short' }], truth: ['a.js'], sizeOf });
  ok(pathOnly.open === 9000 && pathOnly.total === 9300, 'a snippet too short to answer still charges the file read');
  const missing = bytesToAnswer({ printed: 300, passages: [], truth: ['gone.js'], sizeOf });
  ok(missing.open === 0, 'an unmeasurable file charges 0 rather than a guess');

  /* 4 · THE REFUSAL CRITERION. A refused answerable query that hybrid answered right is the one loss
         that fails it; a refused answerable query with no hit loses nothing. */
  const rr = (kind, i, refused, hit = null) => ({ kind, i, refused, hit });
  const good = scoreRefusal([rr('pos', 0, false, true), rr('pos', 1, true, false), rr('neg', 0, true), rr('neg', 1, true), rr('neg', 2, false)]);
  ok(good.pass && good.all.posRefused === 1 && good.all.posRefusedWithHit === 0, 'a refused query with no hit loses nothing, and the floor passes');
  ok(!scoreRefusal([rr('pos', 0, true, true), rr('neg', 0, true)]).pass, 'refusing a query hybrid answered right fails the floor');
  ok(!scoreRefusal([rr('pos', 0, false, true), rr('neg', 0, true), rr('neg', 1, false)]).pass, 'refusing exactly half the off-topic set is not a floor');
  ok(good.holdOut.pos === 1 && good.holdOut.neg === 1, 'the hold-out is the odd-indexed rows only');
  ok(!scoreRefusal([]).pass && !scoreRefusal([rr('pos', 0, false, true)]).pass, 'CONTROL: an empty or one-sided population never passes');

  const line = fail.length ? `xerj-bench selftest · ${fail.length} of ${ran} FAILED` : `all ${ran} selftests passed`;
  return { ok: fail.length === 0, ran, fail, line };
}

/* ── I/O ── */

function sizeOf(f) {
  try {
    const p = join(ROOT, f);
    return existsSync(p) ? statSync(p).size : null;
  } catch {
    return null;
  }
}

function harvest() {
  const raw = execFileSync('gh', ['pr', 'list', '--state', 'merged', '--limit', '150', '--json', 'number,body,files'], { encoding: 'utf8', maxBuffer: 1 << 28, cwd: ROOT });
  const prs = JSON.parse(raw);
  const out = [];
  for (const pr of prs) {
    const m = /doc-search(?:\.mjs)?[^"\n]{0,40}"([^"\n]{12,300})"/.exec(pr.body || '');
    if (!m) continue;
    const q = m[1].trim();
    if (q.startsWith('--') || q.includes('node ')) continue;
    const truth = truthSet((pr.files || []).map((f) => f.path));
    if (!truth.length) continue;
    out.push({ pr: pr.number, query: q, truth });
  }
  return out;
}

async function bgeRank(query) {
  const out = execFileSync(process.execPath, [join(ROOT, 'tools', 'doc-search.mjs'), '--quiet', query], { encoding: 'utf8', maxBuffer: 1 << 26, cwd: ROOT });
  const paths = [];
  const passages = [];
  for (const line of out.split('\n')) {
    const m = /^\s{2}\d\.\d{3}\s+(\S.*)$/.exec(line);
    if (m) {
      paths.push(m[1].trim());
      passages.push({ path: m[1].trim(), text: '' });
    } else if (passages.length && /^\s{8}/.test(line)) {
      passages[passages.length - 1].text += line.trim();
    }
  }
  return { paths, passages, printed: Buffer.byteLength(out, 'utf8') };
}

async function xerjRank(query, mode) {
  const xq = await import('./xerj-query.mjs');
  const ask = async (vec) => {
    const res = await fetch(`${xq.DEFAULT_URL}/${xq.DEFAULT_INDEX}/_search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(xq.searchBody(query, vec, 25))
    });
    if (!res.ok) throw new Error(`xerj HTTP ${res.status}`);
    const j = await res.json();
    return xq.collapseByPath(
      (j?.hits?.hits ?? []).map((h) => xq.formatHit(h)),
      10
    );
  };
  let vector = null;
  if (mode !== 'xerj-bm25') {
    /* NO SILENT DEGRADE IN A BENCHMARK. A swallowed embed failure turns `hybrid` into BM25 fused with
       itself — which is exactly what happened on the second run: hybrid came out byte-identical to
       xerj-bm25 at 33 ms/query, and the `catch {}` had hidden the reason. A measurement that quietly
       scores a different engine than its label is worse than no measurement. */
    vector = await xq.embedQuery(query);
    if (!Array.isArray(vector) || !vector.length) throw new Error('embedder returned no vector');
  }
  /* ONE MODE PER REQUEST, and the fusion is ours — rc.93 does not fuse two clauses (see
     xerj-query.mjs searchBody). `hybrid` therefore asks twice and fuses by reciprocal rank. */
  let hits;
  if (mode === 'xerj-bm25') hits = (await ask(null)).slice(0, 5);
  else if (mode === 'xerj-knn') hits = (await ask(vector)).slice(0, 5);
  else hits = xq.fuseRRF([await ask(null), await ask(vector)], 5);
  const printed = Buffer.byteLength(xq.render({ hits, degraded: null, hybrid: mode === 'hybrid' }, query), 'utf8');
  return { paths: hits.map((h) => h.path), passages: hits.map((h) => ({ path: h.path, text: h.text })), printed };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    const r = selftest();
    process.stdout.write(`${r.line}\n`);
    for (const f of r.fail) process.stdout.write(`  ✕ ${f}\n`);
    process.exit(r.ok ? 0 : 1);
  }
  /* A FAST, HONEST SAMPLE for the adoption checker, which runs this command and has a timeout. Scoring
     52 queries takes minutes (bge alone is ~3 s each), so a sample that actually ran the benchmark
     would make `verdict-adoption` flaky. NOT_RUN is the truthful status for it: the contract says
     NOT_RUN examined nothing, and this examined nothing. It is never the status of a real run. */
  if (argv.includes('--verdict-sample')) {
    const v = Verdict.make({
      gate: 'xerj-bench',
      status: 'NOT_RUN',
      population: { checked: 0, eligible: 0, excluded: 0 },
      criterion: { name: 'hybrid-hit-at-5-at-least-bge-and-fewer-bytes-to-answer', threshold: 0, unit: 'queries', direction: 'gte' },
      result: null,
      evidence: ['tools/xerj-bench.mjs'],
      reason: '--verdict-sample: the shape only, no query was scored (a real run takes minutes)',
      producedBy: { tool: 'tools/xerj-bench.mjs', commit: null, commitReason: 'sample' },
      at: new Date().toISOString()
    });
    process.stdout.write(`${JSON.stringify(v, null, 1)}\n`);
    process.exit(0);
  }
  if (argv.includes('--refusal')) {
    const xq = await import('./xerj-query.mjs');
    const pos = JSON.parse(readFileSync(QUERY_SET, 'utf8'));
    const neg = JSON.parse(readFileSync(REFUSAL_SET, 'utf8')).queries;
    /* --rerank judges the reranker floor instead. A query the reranker did not score is an error,
       never a silent fall back to the other floor: that would score one floor under the other's name. */
    const rerank = argv.includes('--rerank');
    const floor = rerank ? { rerank: xq.REFUSE_RERANK } : { cos: xq.REFUSE_COS, bm25: xq.REFUSE_BM25 };
    const rows = [];
    let errors = 0;
    for (const [kind, set] of [
      ['pos', pos],
      ['neg', neg]
    ]) {
      for (let i = 0; i < set.length; i += 1) {
        const q = kind === 'pos' ? set[i].query : set[i];
        try {
          const out = await xq.hybridSearch({ query: q, rerank });
          if (rerank && !Number.isFinite(out.signals.rerank)) throw new Error(out.degraded);
          const hit =
            kind === 'pos'
              ? hitAt(
                  out.hits.map((h) => h.path),
                  set[i].truth,
                  5
                )
              : null;
          rows.push({ kind, i, refused: out.refused, hit, ...out.signals });
        } catch {
          errors += 1;
        }
      }
    }
    const r = scoreRefusal(rows);
    const n = rows.length;
    const status = errors ? 'UNKNOWN' : n === 0 ? 'NOT_RUN' : r.pass ? 'PASS' : 'FAIL';
    if (argv.includes('--json')) {
      const v = Verdict.make({
        gate: rerank ? 'xerj-refusal-rerank' : 'xerj-refusal',
        status,
        population: { checked: n, eligible: n + errors, excluded: errors },
        criterion: { name: 'refuses-no-correctly-answered-query-and-most-off-topic-queries', threshold: 0, unit: 'correct answers refused', direction: 'eq' },
        result: { floor, all: r.all, holdOut: r.holdOut },
        evidence: ['tools/xerj-bench.mjs', 'tools/xerj-query.mjs', 'audits/XERJ-BENCH-QUERIES.json', 'audits/XERJ-REFUSAL-QUERIES.json'],
        reason: status === 'PASS' ? null : errors ? `${errors} quer(ies) did not reach the index` : `floor failed: ${JSON.stringify(r.all)}`,
        producedBy: { tool: 'tools/xerj-bench.mjs', commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim() },
        at: new Date().toISOString()
      });
      process.stdout.write(`${JSON.stringify(v, null, 1)}\n`);
    } else {
      const f = (p) => `answerable refused ${p.posRefused}/${p.pos} (with a correct hit: ${p.posRefusedWithHit}) · off-topic refused ${p.negRefused}/${p.neg}`;
      process.stdout.write(
        `xerj refusal floor · ${rerank ? `reranker < ${xq.REFUSE_RERANK}` : `cosine < ${xq.REFUSE_COS} AND BM25 < ${xq.REFUSE_BM25}`}\n  all       ${f(r.all)}\n  hold-out  ${f(r.holdOut)}\n  ${status}${errors ? ` · ${errors} error(s)` : ''}\n`
      );
    }
    process.exit(status === 'PASS' ? 0 : 1);
  }
  if (argv.includes('--harvest')) {
    const set = harvest();
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(dirname(QUERY_SET), { recursive: true });
    writeFileSync(QUERY_SET, `${JSON.stringify(set, null, 1)}\n`);
    process.stdout.write(`xerj-bench: harvested ${set.length} query/truth pairs → ${QUERY_SET}\n`);
    process.exit(set.length ? 0 : 1);
  }
  const asJson = argv.includes('--json');
  if (!existsSync(QUERY_SET)) {
    process.stderr.write(`xerj-bench: no query set at ${QUERY_SET} — run --harvest first.\n`);
    process.exit(2);
  }
  const set = JSON.parse(readFileSync(QUERY_SET, 'utf8'));
  /* FOUR engines, because the two halves must be visible SEPARATELY. The first run scored `hybrid`
     at 9.6 % and the cause was xerj rc.93 failing to fuse two clauses in one request — diagnosable
     only because bm25 and knn could be compared alone. A table that reports the blend without its
     components cannot tell a bad blend from a bad half. */
  const engines = ['bge', 'xerj-bm25', 'xerj-knn', 'hybrid'];
  const tally = Object.fromEntries(engines.map((e) => [e, { hit: 0, ranks: [], printed: 0, open: 0, total: 0, ms: 0, errors: 0 }]));

  for (const row of set) {
    for (const e of engines) {
      const t0 = Date.now();
      let r = null;
      try {
        r = e === 'bge' ? await bgeRank(row.query) : await xerjRank(row.query, e);
      } catch {
        tally[e].errors += 1;
        continue;
      }
      tally[e].ms += Date.now() - t0;
      if (hitAt(r.paths, row.truth, 5)) tally[e].hit += 1;
      const rank = firstHitRank(r.paths.slice(0, 5), row.truth);
      if (rank) tally[e].ranks.push(rank);
      const b = bytesToAnswer({ printed: r.printed, passages: r.passages, truth: row.truth, sizeOf });
      tally[e].printed += b.printed;
      tally[e].open += b.open;
      tally[e].total += b.total;
    }
  }

  const n = set.length;
  const rows = engines.map((e) => {
    const t = tally[e];
    return {
      engine: e,
      hitAt5: t.hit,
      of: n,
      pct: n ? +((100 * t.hit) / n).toFixed(1) : 0,
      medianRank: t.ranks.length ? t.ranks.slice().sort((a, b) => a - b)[Math.floor(t.ranks.length / 2)] : null,
      bytesPerQuery: n ? Math.round(t.total / n) : 0,
      printedPerQuery: n ? Math.round(t.printed / n) : 0,
      openPerQuery: n ? Math.round(t.open / n) : 0,
      msPerQuery: n ? Math.round(t.ms / n) : 0,
      errors: t.errors
    };
  });
  const bge = rows.find((r) => r.engine === 'bge');
  const hyb = rows.find((r) => r.engine === 'hybrid');
  /* PRE-STATED, before the numbers existed: hybrid must not lose recall AND must cost fewer bytes. */
  const pass = n > 0 && hyb.hitAt5 >= bge.hitAt5 && hyb.bytesPerQuery < bge.bytesPerQuery;
  const status = n === 0 ? 'NOT_RUN' : pass ? 'PASS' : 'SHORTFALL';

  if (asJson) {
    const v = Verdict.make({
      gate: 'xerj-bench',
      status,
      population: { checked: n, eligible: n, excluded: 0 },
      criterion: { name: 'hybrid-hit-at-5-at-least-bge-and-fewer-bytes-to-answer', threshold: 0, unit: 'queries', direction: 'gte' },
      result: status === 'NOT_RUN' ? null : { rows, groundTruth: 'files the PR changed, generated paths excluded' },
      evidence: ['tools/xerj-bench.mjs', 'audits/XERJ-BENCH-QUERIES.json'],
      reason:
        status === 'PASS'
          ? null
          : n === 0
            ? 'no query/truth pairs — nothing was measured'
            : `hybrid hit@5 ${hyb.hitAt5}/${n} vs bge ${bge.hitAt5}/${n}; bytes ${hyb.bytesPerQuery} vs ${bge.bytesPerQuery}`,
      producedBy: {
        tool: 'tools/xerj-bench.mjs',
        commit: (() => {
          try {
            return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', cwd: ROOT }).trim();
          } catch {
            return null;
          }
        })()
      },
      at: new Date().toISOString()
    });
    const chk = Verdict.validate(v);
    if (!chk.ok) throw new Error(`invalid verdict: ${chk.errors.join('; ')}`);
    process.stdout.write(`${JSON.stringify(v, null, 1)}\n`);
  } else {
    process.stdout.write(`xerj-bench · ${n} real Rule-0 queries · ground truth = the files each PR changed\n\n`);
    process.stdout.write('  engine      hit@5      %     medRank   bytes/q  (printed + open)    ms/q  err\n');
    for (const r of rows) {
      process.stdout.write(
        `  ${r.engine.padEnd(11)} ${String(r.hitAt5).padStart(2)}/${r.of}  ${String(r.pct).padStart(5)}  ${String(r.medianRank ?? '—').padStart(7)}   ${String(r.bytesPerQuery).padStart(7)}  (${String(r.printedPerQuery).padStart(5)} + ${String(r.openPerQuery).padStart(6)})  ${String(r.msPerQuery).padStart(6)}  ${r.errors}\n`
      );
    }
    process.stdout.write(`\n  acceptance (pre-stated): hybrid hit@5 >= bge AND bytes/q lower → ${status}\n`);
  }
  process.exit(status === 'PASS' ? 0 : 1);
}

if (isCliEntry(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`xerj-bench: ${e.message}\n`);
    process.exit(2);
  });
}
