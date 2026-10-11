// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/* ════════════════════════════════════════════════════════════════════════
   tools/brief-gaps.mjs — a text-network gap detector over the briefs

       node tools/brief-gaps.mjs                 # ranked reading list + verdict
       node tools/brief-gaps.mjs --json          # the verdict alone
       node tools/brief-gaps.mjs --selftest      # planted vectors + planted graph
       node tools/brief-gaps.mjs --verdict-sample

   WHAT IT LOOKS FOR. Two briefs that decide one question in different words and
   do not reference each other. A GAP is a pair that is (a) close in embedding
   space, (b) unconnected by any citation path of length <= 2, and (c) not
   already joined by a Supersedes/Superseded-by line.

   🔴 WHAT IT IS NOT, AND THE NEGATIVE RESULT IT IS BUILT ON TOP OF.
   `DONE-WHEN-CROSS-BRIEF-2026-09-23-BRIEF.md` is DONE as a NEGATIVE RESULT —
   three lexical shapes refuted, sensitivity 1 of 2 and precision 0 of 4 on the
   live tree — and its §7 states what a fourth attempt owes:

     1 · do not key on a shared literal (in this corpus a shared number means
         citation);                          → honoured: the signal is a 1024-d
         bge-m3 mean vector, no literal at all.
     2 · plant BOTH directions — "same change, different words" is the case a
         lexical shape cannot see;           → honoured: `--selftest` plants a
         same-decision/disjoint-vocabulary pair and asserts it is FOUND.
     3 · verify each plant was SEEN;         → honoured: every planted case
         asserts a non-vacuous observation, not merely a pass.
     4 · the remaining honest shape is SOCIAL, not analytic — bind the session
         that EXECUTES an item. That is a CLAUDE.md change, not a detector.

   Point 4 still stands and this tool does not contest it. **Adjacency is not
   equivalence.** The output is a ranked list a person reads; it never writes a
   supersession, never closes anything, and its verdict decides only whether the
   ranking is good enough to be worth reading.

   MEMORY. The chunk index is ~768 MB. It is STREAMED line by line and only one
   mean vector per brief is retained (544 x 1024 floats, about 4.5 MB), per the
   owner's lazy-load rule.
   ════════════════════════════════════════════════════════════════════════ */
import { createInterface } from 'node:readline';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const Verdict = createRequire(import.meta.url)('../verdict.js');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/* A WORKTREE'S `.git` IS A FILE, not a directory, so `join(ROOT, '.git/...')` resolves to nothing
   there and the tool refused with "no brief vectors" — which reads as an empty index rather than as a
   path that was never looked at. Ask git for the common dir, as verify-fixtures does. */
function indexPath(root = ROOT) {
  let gitDir = join(root, '.git');
  try {
    gitDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || gitDir;
  } catch {
    /* not a checkout: keep the literal, and the refusal below will say the index is absent */
  }
  if (!gitDir.startsWith('/')) gitDir = join(root, gitDir);
  return join(gitDir, 'tepna-mutation/doc-search-index.jsonl');
}
const INDEX = indexPath();

/** A brief filename, which is also the only citation form in this corpus (0 markdown links). */
export const BRIEF_RE = /[A-Z0-9][A-Z0-9-]*-\d{4}-\d{2}-\d{2}(?:-\d{4})?-BRIEF\.md/g;

/** Pre-stated, and chosen on a HELD-OUT half — never on the pairs it is judged against. */
export const DEFAULT_THRESHOLD = 0.62;
export const RECALL_AT = [50, 100];
export const RECALL_FLOOR = 0.5; // recall@50 >= this is a PASS

export function meanVector(vecs) {
  if (!vecs || !vecs.length) return null;
  const d = vecs[0].length;
  const out = new Float64Array(d);
  for (const v of vecs) for (let i = 0; i < d; i++) out[i] += v[i];
  let n = 0;
  for (let i = 0; i < d; i++) {
    out[i] /= vecs.length;
    n += out[i] * out[i];
  }
  n = Math.sqrt(n);
  if (!n) return null;
  for (let i = 0; i < d; i++) out[i] /= n; // unit length ⇒ cosine is a dot product
  return out;
}

export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Streams the index; retains ONE mean vector per brief. */
export async function loadBriefVectors(indexPath = INDEX) {
  const out = new Map();
  if (!existsSync(indexPath)) return out;
  const rl = createInterface({ input: createReadStream(indexPath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line || line[0] !== '{') continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const f = d.file;
    if (!f || !f.startsWith('briefs/') || !f.endsWith('BRIEF.md')) continue;
    const m = meanVector(d.vecs);
    if (m) out.set(f.slice('briefs/'.length), m);
  }
  return out;
}

/** { cites: name -> Set(name), supersede: Set("a\0b") } — both directions stored for supersede. */
export function buildGraph(names, readFile) {
  const cites = new Map(names.map((n) => [n, new Set()]));
  const supersede = new Set();
  const known = new Set(names);
  for (const n of names) {
    const text = readFile(n);
    if (text == null) continue;
    for (const hit of text.match(BRIEF_RE) || []) {
      if (hit !== n && known.has(hit)) cites.get(n).add(hit);
    }
    /* The HAND-MARKED relation, which the benchmark hides from `cites`. */
    for (const line of text.split('\n')) {
      if (!/Supersed(?:es|ed-by)/.test(line)) continue;
      for (const hit of line.match(BRIEF_RE) || []) {
        if (hit !== n && known.has(hit)) supersede.add(pairKey(n, hit));
      }
    }
  }
  return { cites, supersede };
}

export function pairKey(a, b) {
  return a < b ? a + '\0' + b : b + '\0' + a;
}

/** Undirected reachability within 2 hops. */
export function withinTwoHops(cites, a, b) {
  const A = cites.get(a) || new Set();
  const B = cites.get(b) || new Set();
  if (A.has(b) || B.has(a)) return true;
  for (const m of A) if ((cites.get(m) || new Set()).has(b) || B.has(m)) return true;
  for (const m of B) if ((cites.get(m) || new Set()).has(a)) return true;
  return false;
}

/** Ranked gaps, most similar first. `graphCites` is what the detector may SEE. */
export function findGaps(vectors, graphCites, supersede, threshold = DEFAULT_THRESHOLD) {
  const names = [...vectors.keys()].sort();
  const gaps = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i];
      const b = names[j];
      const sim = cosine(vectors.get(a), vectors.get(b));
      if (sim < threshold) continue;
      if (supersede.has(pairKey(a, b))) continue;
      if (withinTwoHops(graphCites, a, b)) continue;
      gaps.push({ a, b, sim });
    }
  }
  gaps.sort((x, y) => y.sim - x.sim);
  return gaps;
}

/** TF-IDF over the briefs, local; the strongest terms the two share. */
export function sharedTerms(textA, textB, idf, k = 6) {
  const tf = (t) => {
    const m = new Map();
    for (const w of t.toLowerCase().match(/[a-z][a-z-]{3,}/g) || []) m.set(w, (m.get(w) || 0) + 1);
    return m;
  };
  const A = tf(textA);
  const B = tf(textB);
  const out = [];
  for (const [w, na] of A) {
    const nb = B.get(w);
    if (!nb) continue;
    const w_idf = idf.get(w);
    if (!w_idf) continue;
    out.push([w, Math.min(na, nb) * w_idf]);
  }
  out.sort((x, y) => y[1] - x[1]);
  return out.slice(0, k).map((x) => x[0]);
}

export function buildIdf(texts) {
  const df = new Map();
  for (const t of texts) {
    for (const w of new Set(t.toLowerCase().match(/[a-z][a-z-]{3,}/g) || [])) df.set(w, (df.get(w) || 0) + 1);
  }
  const N = texts.length || 1;
  const idf = new Map();
  for (const [w, n] of df) {
    if (n < 2 || n > N * 0.5) continue; // drop singletons and boilerplate
    idf.set(w, Math.log(N / n));
  }
  return idf;
}

/** recall@k over the HELD-OUT pairs, which were hidden from `graphCites`. */
export function recallAt(gaps, truthPairs, k) {
  const top = new Set(gaps.slice(0, k).map((g) => pairKey(g.a, g.b)));
  let hit = 0;
  for (const p of truthPairs) if (top.has(p)) hit++;
  return { hit, of: truthPairs.length, recall: truthPairs.length ? hit / truthPairs.length : null };
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

function statusLine(text) {
  const m = (text || '').split('\n').find((l) => l.startsWith('**Status:**'));
  return m ? m.replace(/\s+/g, ' ').slice(0, 150) : '(no status line)';
}

async function main() {
  const argv = process.argv.slice(2);
  const vectors = await loadBriefVectors();
  if (!vectors.size) {
    console.error('brief-gaps: REFUSING — no brief vectors in the chunk index; it is a local cache and ships with nothing');
    process.exit(2);
  }
  const names = [...vectors.keys()].sort();
  const texts = new Map();
  const readFile = (n) => {
    if (texts.has(n)) return texts.get(n);
    let t = null;
    try {
      t = readFileSync(join(ROOT, 'briefs', n), 'utf8');
    } catch {
      t = null;
    }
    texts.set(n, t);
    return t;
  };
  const { cites, supersede } = buildGraph(names, readFile);

  /* ── THE BENCHMARK, pre-stated: hide the hand-marked pairs and see if the ranking finds them ──
     The hidden pairs are removed from what the detector may SEE, in BOTH the citation graph and the
     supersede set, so nothing but the text can recover them. Threshold is chosen on half and
     reported on both halves, because a threshold fitted to the pairs it judges is UNKNOWN (§🧾). */
  const marked = [...supersede].sort();
  const half = Math.ceil(marked.length / 2);
  const fitHalf = marked.slice(0, half);
  const holdHalf = marked.slice(half);
  const blind = new Map([...cites].map(([k, v]) => [k, new Set(v)]));
  for (const p of marked) {
    const [a, b] = p.split('\0');
    blind.get(a)?.delete(b);
    blind.get(b)?.delete(a);
  }
  const blindSupersede = new Set();

  const pickThreshold = (fitPairs) => {
    let best = DEFAULT_THRESHOLD;
    let bestR = -1;
    for (const t of [0.5, 0.54, 0.58, 0.62, 0.66, 0.7, 0.74]) {
      const g = findGaps(vectors, blind, blindSupersede, t);
      const r = recallAt(g, fitPairs, 50).recall ?? 0;
      if (r > bestR) {
        bestR = r;
        best = t;
      }
    }
    return best;
  };
  const threshold = argv.includes('--threshold') ? Number(argv[argv.indexOf('--threshold') + 1]) : pickThreshold(fitHalf);

  const blindGaps = findGaps(vectors, blind, blindSupersede, threshold);
  const bench = {};
  for (const k of RECALL_AT) {
    bench[`fit@${k}`] = recallAt(blindGaps, fitHalf, k);
    bench[`held@${k}`] = recallAt(blindGaps, holdHalf, k);
    bench[`all@${k}`] = recallAt(blindGaps, marked, k);
  }
  const held50 = bench['held@50'].recall;

  /* The real run: the graph as it IS, so a pair already joined is not reported. */
  const gaps = findGaps(vectors, cites, supersede, threshold);
  const idf = buildIdf(names.map((n) => readFile(n) || ''));

  const status = held50 === null ? 'UNKNOWN' : held50 >= RECALL_FLOOR ? 'PASS' : 'SHORTFALL';
  const v = Verdict.make({
    gate: 'brief-gaps',
    scope: 'internal',
    status,
    population: { checked: (names.length * (names.length - 1)) / 2, eligible: (names.length * (names.length - 1)) / 2, excluded: 0 },
    criterion: { name: 'recall_at_50_on_held_out_supersession_pairs', threshold: RECALL_FLOOR, unit: 'fraction', direction: 'gte' },
    result: {
      briefs: names.length,
      threshold,
      gaps: gaps.length,
      markedPairs: marked.length,
      fitPairs: fitHalf.length,
      heldPairs: holdHalf.length,
      recall: Object.fromEntries(Object.entries(bench).map(([k, b]) => [k, b.recall === null ? null : Number(b.recall.toFixed(3))]))
    },
    evidence: ['tools/brief-gaps.mjs', 'briefs/BRIEF-GAPS-2026-10-11-BRIEF.md'],
    reason:
      status === 'PASS'
        ? null
        : status === 'UNKNOWN'
          ? 'no held-out hand-marked pairs, so recall is undefined — nothing was measured'
          : `recall@50 on the held-out half is ${held50.toFixed(3)}, under the pre-stated ${RECALL_FLOOR}`,
    producedBy: { tool: 'tools/brief-gaps.mjs', commit: gitCommit() }
  });

  if (argv.includes('--json')) {
    console.log(JSON.stringify(v));
    process.exit(0);
  }
  console.log(JSON.stringify(v));
  console.log('');
  console.log(`▸ ${names.length} briefs · threshold ${threshold} (chosen on the fit half) · ${gaps.length} gap pair(s)`);
  for (const k of RECALL_AT) {
    const f = bench[`fit@${k}`];
    const h = bench[`held@${k}`];
    console.log(`   recall@${k}: fit ${f.hit}/${f.of}  ·  HELD-OUT ${h.hit}/${h.of}${h.recall === null ? '' : ` (${h.recall.toFixed(2)})`}`);
  }
  console.log('');
  console.log('▸ reading list — adjacency is NOT equivalence; nothing here is closed automatically');
  for (const g of gaps.slice(0, 40)) {
    const ta = readFile(g.a) || '';
    const tb = readFile(g.b) || '';
    console.log(`\n  ${g.sim.toFixed(3)}  ${g.a}\n          ${g.b}`);
    console.log(`          terms: ${sharedTerms(ta, tb, idf).join(', ') || '(none above the idf floor)'}`);
    console.log(`          A: ${statusLine(ta)}`);
    console.log(`          B: ${statusLine(tb)}`);
  }
  if (gaps.length > 40) console.log(`\n  … and ${gaps.length - 40} more below the first 40`);
  process.exit(0);
}

if (process.argv.includes('--verdict-sample') && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const v = Verdict.make({
    gate: 'brief-gaps',
    scope: 'internal',
    status: 'NOT_RUN',
    population: { checked: 0, eligible: 0, excluded: 0 },
    criterion: { name: 'recall_at_50_on_held_out_supersession_pairs', threshold: RECALL_FLOOR, unit: 'fraction', direction: 'gte' },
    result: null,
    evidence: ['tools/brief-gaps.mjs'],
    reason: 'sample only — this invocation read no index and compared no briefs',
    producedBy: { tool: 'tools/brief-gaps.mjs', commit: gitCommit() }
  });
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
}

if (process.argv.includes('--selftest') && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let bad = 0;
  let ran = 0;
  const ck = (n, got, want) => {
    ran++;
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) {
      bad++;
      console.log(`  ✕ ${n} got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    } else console.log(`  ✓ ${n}`);
  };
  const unit = (arr) => {
    const n = Math.sqrt(arr.reduce((s, x) => s + x * x, 0));
    return arr.map((x) => x / n);
  };
  ck('a mean vector is unit length', Math.abs(Math.sqrt(meanVector([[3, 4]]).reduce((s, x) => s + x * x, 0)) - 1) < 1e-12, true);
  ck('cosine of a vector with itself is 1', Math.abs(cosine(unit([1, 2, 3]), unit([1, 2, 3])) - 1) < 1e-12, true);
  ck('the brief regex matches a filename, not a markdown link', 'see FOO-2026-01-02-BRIEF.md now'.match(BRIEF_RE), ['FOO-2026-01-02-BRIEF.md']);
  ck('…and a same-day twin with -HHMM', 'BAR-2026-01-02-0930-BRIEF.md'.match(BRIEF_RE), ['BAR-2026-01-02-0930-BRIEF.md']);

  /* ── §7.2 · PLANT BOTH DIRECTIONS. P1 shares vocabulary; P2 is the same decision in DISJOINT
     words. A lexical shape sees P1 and is blind to P2, which is why the negative result demands it. */
  const V = new Map([
    ['P1A-2026-01-01-BRIEF.md', unit([1, 0, 0, 0])],
    ['P1B-2026-01-01-BRIEF.md', unit([0.98, 0.2, 0, 0])],
    ['P2A-2026-01-02-BRIEF.md', unit([0, 1, 0, 0])],
    ['P2B-2026-01-02-BRIEF.md', unit([0.05, 0.99, 0, 0])],
    ['FAR-2026-01-03-BRIEF.md', unit([0, 0, 1, 0])],
    ['CITED-2026-01-04-BRIEF.md', unit([0, 0, 0.99, 0.1])]
  ]);
  const empty = new Map([...V.keys()].map((k) => [k, new Set()]));
  const g0 = findGaps(V, empty, new Set(), 0.9);
  const keys0 = g0.map((g) => pairKey(g.a, g.b));
  ck('P1 (shared vocabulary) is found', keys0.includes(pairKey('P1A-2026-01-01-BRIEF.md', 'P1B-2026-01-01-BRIEF.md')), true);
  ck('🔴 P2 (same decision, DISJOINT words) is found — the case a lexical shape cannot see', keys0.includes(pairKey('P2A-2026-01-02-BRIEF.md', 'P2B-2026-01-02-BRIEF.md')), true);
  /* §7.3 · the plants must be SEEN, not merely not-failed. */
  ck('…and the plants are the observation, not a vacuous pass', g0.length >= 3, true);
  ck('a DISTANT pair is not reported', keys0.includes(pairKey('P1A-2026-01-01-BRIEF.md', 'FAR-2026-01-03-BRIEF.md')), false);

  /* A citation suppresses a gap — one hop and two hops. */
  const oneHop = new Map([...empty].map(([k, s]) => [k, new Set(s)]));
  oneHop.get('P1A-2026-01-01-BRIEF.md').add('P1B-2026-01-01-BRIEF.md');
  ck(
    'a DIRECT citation suppresses the pair',
    findGaps(V, oneHop, new Set(), 0.9)
      .map((g) => pairKey(g.a, g.b))
      .includes(pairKey('P1A-2026-01-01-BRIEF.md', 'P1B-2026-01-01-BRIEF.md')),
    false
  );
  const twoHop = new Map([...empty].map(([k, s]) => [k, new Set(s)]));
  twoHop.get('P1A-2026-01-01-BRIEF.md').add('FAR-2026-01-03-BRIEF.md');
  twoHop.get('FAR-2026-01-03-BRIEF.md').add('P1B-2026-01-01-BRIEF.md');
  ck(
    'a TWO-HOP path suppresses it too',
    findGaps(V, twoHop, new Set(), 0.9)
      .map((g) => pairKey(g.a, g.b))
      .includes(pairKey('P1A-2026-01-01-BRIEF.md', 'P1B-2026-01-01-BRIEF.md')),
    false
  );
  ck(
    'a supersession pair is never a gap',
    findGaps(V, empty, new Set([pairKey('P1A-2026-01-01-BRIEF.md', 'P1B-2026-01-01-BRIEF.md')]), 0.9)
      .map((g) => pairKey(g.a, g.b))
      .includes(pairKey('P1A-2026-01-01-BRIEF.md', 'P1B-2026-01-01-BRIEF.md')),
    false
  );

  /* The graph is read from TEXT, and only the hand-marked line makes a supersede. */
  const files = {
    'X-2026-02-01-BRIEF.md': 'body cites Y-2026-02-02-BRIEF.md in prose',
    'Y-2026-02-02-BRIEF.md': '**Superseded-by:** X-2026-02-01-BRIEF.md',
    'Z-2026-02-03-BRIEF.md': 'mentions nothing'
  };
  const G = buildGraph(Object.keys(files), (n) => files[n]);
  ck('a prose mention is a citation edge', [...G.cites.get('X-2026-02-01-BRIEF.md')], ['Y-2026-02-02-BRIEF.md']);
  ck('a Superseded-by line is a supersede pair', G.supersede.has(pairKey('X-2026-02-01-BRIEF.md', 'Y-2026-02-02-BRIEF.md')), true);
  ck('a brief with no mention has no edge', [...G.cites.get('Z-2026-02-03-BRIEF.md')], []);
  ck('a brief never cites itself', [...G.cites.get('Y-2026-02-02-BRIEF.md')].includes('Y-2026-02-02-BRIEF.md'), false);

  /* recall@k, and §∅ over an empty truth set. */
  const fake = [
    { a: 'a', b: 'b', sim: 1 },
    { a: 'c', b: 'd', sim: 0.9 }
  ];
  ck('recall counts a pair in the top k', recallAt(fake, [pairKey('a', 'b')], 1).recall, 1);
  ck('…and misses one outside it', recallAt(fake, [pairKey('c', 'd')], 1).recall, 0);
  ck('§∅ · recall over NO truth pairs is null, never 1.0', recallAt(fake, [], 50).recall, null);
  ck(
    'shared terms need the term in BOTH briefs',
    sharedTerms(
      'alpha beta',
      'beta gamma',
      new Map([
        ['alpha', 1],
        ['beta', 1],
        ['gamma', 1]
      ])
    ),
    ['beta']
  );
  ck('the recall floor is pre-stated', RECALL_FLOOR, 0.5);
  console.log(bad ? `  ✗ ${bad} of ${ran} selftests failed` : `  all ${ran} selftests passed`);
  process.exit(bad ? 1 : 0);
}

/* RUN ONLY WHEN INVOKED, never on import. A module that acts on import cannot be reused by a
   diagnostic or a test — measured here: importing it to rank pairs ran the whole report instead. */
const INVOKED_DIRECTLY = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (INVOKED_DIRECTLY && !process.argv.includes('--selftest') && !process.argv.includes('--verdict-sample')) await main();
