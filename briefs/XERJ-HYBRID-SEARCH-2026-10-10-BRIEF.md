<!--
  XERJ-HYBRID-SEARCH-2026-10-10-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->
**Status:** IN-PROGRESS — 2026-10-10 · **Created:** 2026-10-10

# XERJ hybrid search trial — one engine for BM25 + bge-m3 kNN over the repo source

**What this is.** A measured trial, not an adoption. Rule 0 runs `tools/doc-search.mjs` before every
unit; it is semantic-only, takes ~3 s, and returns a PATH that the reader must then open. This brief
builds the machinery to ask whether one engine serving **BM25 + bge-m3 kNN in a single request** does
better, and measures it against doc-search on **real past Rule-0 queries**. **Adoption is the owner's
call and nothing routes through the new path**: `doc-search.mjs` default behaviour is unchanged.

## 1 · What was already true (verified, not re-derived)

| fact | verified |
|---|---|
| `xerj v1.0.0-rc.93` at `~/.local/bin/xerj` | ✓ |
| the owner's server on **loopback 9200**, `--embed-mode lexical --insecure` | ✓ — and `--insecure` means plain **HTTP**, not self-signed TLS; `https://` gets no answer |
| source-only staging copy, 1,595 files / 44 MB | ✓ 1,596 files / 44 MB, and **0 paths matching `uploads`, `.edf` or `.html`** |
| `tepna-src-docs` indexed, ~34 k records | ✓ 34,025 — and its mapping has **no `dense_vector`**, so it is BM25-only; the hybrid index had to be a new one |
| xerj refuses to embed with bge-m3 itself | ✓ taken as given — its own embedder is MiniLM and proxy mode will not attest remote assets, so **no `neural` mode is ever used and no model is downloaded** |
| bge-m3 served by Ollama on `127.0.0.1:11434` | ✓ `bge-m3:latest` present |

## 2 · The property, and the one thing it must never do

`tools/xerj-load.mjs` writes doc-search's **existing** chunks and **cached** bge-m3 vectors into a
xerj index with a 1024-dim cosine `dense_vector` mapping. It never chunks differently and never
embeds.

🔴 **The cache stores one vector per chunk, POSITIONALLY — and nothing at query time can reveal a
broken pairing.** The cache line is `{file, h, vecs[n][1024]}`: vector *i* describes chunk *i* of
`${file} :: ${body}` and nothing else. Re-chunking with other parameters, or pairing a cached vector
with a file that has since changed, produces an index that is **confidently wrong with no symptom**.
So the loader reproduces doc-search's own validity rule verbatim — the body hash matches **and** the
chunk count matches — and skips everything else, counting what it skipped. On the real corpus that
rule fired once (`stale-hash: 1`), which is the whole reason it is not an assumption.

**Measured load:** 4,837 cache entries → **4,605 files / 58,071 chunk documents** in 77 s, peak RSS
**400 MB** (streamed line by line; the cache is 718 MB and is never loaded whole). 231 skips are files
deleted since the cache was written. doc-search reports 58,113 chunks for the same corpus, so the
loader covers it.

**A defect found by doing this:** `chunk()` cuts at a fixed CHARACTER count, so a cut can land between
the two halves of a surrogate pair — a split emoji. doc-search never notices because it embeds the
string locally and nothing serialises it; `JSON.stringify` then emits a lone `\udXXX`, which is not
valid JSON, and xerj refused an entire 128-document batch. **6 chunks** in the corpus are affected.
The repair is in the loader, not the chunker — re-chunking would invalidate every cached vector — and
the count is reported so altering indexed text is never silent.

## 3 · The query path, and why it is a separate module

`--hybrid` (alias `--code`) on `doc-search.mjs` is an **early branch** that dynamically imports
`tools/xerj-query.mjs`. The default Rule-0 path gains no import, no cost and no new failure mode: a
broken or absent xerj server can only affect a caller who asked for it by name. The diff to
doc-search is 23 added lines.

Two design points, both load-bearing:

* **Degrading is visible.** With no query vector there is **no `knn` clause at all**, and the caller
  is told — rather than a `knn` block the server may ignore while the caller believes it read a
  hybrid ranking.
* **Best chunk per file.** doc-search's ranker already collapses to one hit per file ("a long brief
  must not crowd the list with its own sections"). The hybrid path does the same, by over-fetching
  then collapsing. Without it a 25-chunk lesson index takes four of five slots and a benchmark scores
  the same answer four times.

## 4 · The measurement

`tools/xerj-bench.mjs` scores **bge-alone vs hybrid vs xerj-BM25** over Rule-0 queries harvested from
merged PR bodies (**52 query/truth pairs**, committed as `audits/XERJ-BENCH-QUERIES.json`).

🔴 **The ground truth is NOT the recorded hits.** Every such PR body reads `Rule 0: <query> → <hits>`,
and using those hits would be circular: they are doc-search's own bge output, so bge would score
~100 % by construction and every engine would be measured by how well it imitates bge. The ground
truth is instead **the files that PR went on to change** — the author's revealed answer, recorded
independently of the engine. Generated paths are excluded (a rebuilt bundle, a provenance stamp and a
regenerated golden are consequences of the work, not findable answers).

⚠️ **And that proxy is biased against all three engines in the same direction**: a Rule-0 query often
asks "has this already been decided?", whose right answer is a brief the PR never edits. Absolute
hit@5 therefore understates every engine; what this measures is the COMPARISON, since all three are
scored against the same proxy.

**Bytes-to-answer** is reported as two measured numbers rather than one contestable composite:
`printed` (bytes the tool actually prints for its top 5) and `open` (bytes of the first ground-truth
file a reader must then open — 0 when the printed passage already came from that file and is long
enough to read).

**Pre-stated acceptance:** hybrid `hit@5` ≥ bge **and** bytes/query lower. A lower score is a
measurement, not a failure, and is reported as `SHORTFALL` rather than hidden.

### 4.1 · The result — `PASS`, 52 queries

| engine | hit@5 | % | median rank | bytes/query (printed + open) | ms/query |
|---|---|---|---|---|---|
| bge (doc-search today) | 43/52 | 82.7 | 1 | 384,494 (1,975 + 382,519) | 3,982 |
| xerj BM25 | 47/52 | 90.4 | 1 | 43,113 (4,922 + 38,191) | **3** |
| xerj kNN (bge-m3 vectors) | 43/52 | 82.7 | 1 | 104,505 (4,924 + 99,581) | 385 |
| **hybrid (RRF of the two)** | **49/52** | **94.2** | 1 | **24,219** (4,907 + 19,312) | 18 |

**The fusion earns its place:** 49 beats BM25's 47 and kNN's 43, so it is not simply the better half
winning. Against doc-search today it is **+6 queries of recall, 16× fewer bytes to an answer and
~220× faster**. kNN alone exactly matches bge's 43/52 — the same vectors, as expected, since both
rank the same embedding space; what xerj adds there is the passage and the latency, not the recall.

🔴 **Two of the four runs this table replaces were WRONG, and each was wrong in a way that read as a
finding.** The first scored hybrid at 9.6 % — that was rc.93's broken single-request fusion, and it
looked like "hybrid retrieval does not work here". The next scored all three xerj engines
byte-identically, because a half-applied patch left every mode mapped to the same branch and a
`catch {}` had swallowed the embedder error, so `hybrid` was silently BM25 fused with itself. Both
were caught by MAGNITUDE and by impossible detail — 33 ms cannot contain an embed call, and three
engines cannot agree to the byte. The benchmark now **throws** on an embed failure rather than
degrading, because a measurement that quietly scores a different engine than its label is worse than
no measurement.

## 5 · Constraints honoured

* **Loopback only** — both tools refuse a non-loopback URL outright; asserted in both selftests.
* **Source only, asserted not inherited** — doc-search's corpus is a non-recursive list of named
  directories precisely so a glob cannot reach `uploads/`; measured 0 such paths. The loader
  additionally **refuses per path** (`uploads/`, `.edf`, `captures/`, `.dat|.bin|.wav`), because the
  project's one hard line should not rest on an inherited argument.
* **External roots are in scope and are source** — vendor SDK source and the memory dir, each
  declaring its own extensions. They are included because doc-search ranks over them, and an index
  holding only the repo would lose those hits and read as worse recall when the real difference is a
  smaller corpus.
* **No model download, no `init`, no `share`** — the vectors come from our cache; `neural`/proxy mode
  is never invoked.
* **Lazy-load** — the 718 MB cache is streamed; measured peak RSS 400 MB, far under the 8 GB rule.
* **No bundle is touched**, so nothing re-bundles and no hash moves. This is a dev tool.

## 6 · Acceptance

- [x] loader writes existing chunks + cached vectors, idempotent (deterministic `_id`), resumable by
      re-running, refuses a non-loopback host and a non-`bge-m3` cache
- [x] `--hybrid` queries knn + BM25 in one request and prints the enclosing passage
- [x] Rule 0's default behaviour unchanged
- [x] three selftests (18 + 15 + 9 properties) and a `tepna.verdict/1` from loader and benchmark
- [x] benchmark table + verdict — **adoption is the owner's call**, and nothing routes through the
      new path yet
- [x] `TOOLS-INDEX` rows (3) and `verdict-adoption` bins: `xerj-load` and `xerj-bench` adopted as
      `decides`; **`xerj-query` carries no row at all**, because it prints no verdict word and so is
      not in that gate's population — a row for a non-producer is a stale row, which the gate says
      plainly

## 7 · What the owner is being asked

Adopt **hybrid** (`doc-search.mjs --hybrid`) as the default for code-shaped questions, or leave it
opt-in. The measured case for adopting: +6 recall, 16× fewer bytes, ~220× faster, and the passage is
returned so the answer is readable without a second read. The measured case against: the index is a
second artefact that must be reloaded when the cache moves (77 s, idempotent), and `hit@5` here is
scored against a proxy that favours file-level answers. Nothing is routed through it until the owner
says so.
