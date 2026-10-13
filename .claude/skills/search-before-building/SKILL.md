---
name: search-before-building
description: Use before any analysis, diagnosis, sizing, design or build — Rule 0, the search that finds prior work first. The command, the flags that shorten or sharpen it, how to read a hit, and what a refusal means. Use again when the first query returns nothing useful.
---

# Search before you build (Rule 0)

The owner's standing rule since 2026-09-12: search first, then analyse, size or build.
The first line of a report, and of a PR body, names the query and the top hits.

## Run the search

```sh
node tools/doc-search.mjs "<what you are trying to find>"          # the default: hybrid lane
node tools/doc-search.mjs --brief "<question>"                     # one line per hit, no passage
node tools/doc-search.mjs --read "<question>"                      # print the top passages in full
node tools/doc-search.mjs --no-rerank "<question>"                 # the old refusal floor, by name
node tools/doc-search.mjs --no-map "<question>"                    # without the repo-map lines
node tools/repo-map.mjs --write                                    # write the map the search reads
```

1. Ask the question in the words of the defect, not the words of a fix.
2. Read the top hits before you write code.
3. Ask again with other words when the hits miss.
4. Write the `Rule 0: <query> → <top hits>` line first in the PR body.

## Read a hit

A hit names its file and its lines, as `oxydex-dsp.js:4605-4620`.
A code hit also names the function that holds it, as `· computeDesaturationProfile`.
A hit without lines comes from an index that the hourly reload has not refilled yet.

Under the hits, one repo-map line per code file names what that file declares and exposes.
The two sets differ, and the gap is where a session loses time.
A file gets no line when the map omits it, or when its bytes changed after the map.
The search counts every line it holds back and names the reason.
`node tools/repo-map.mjs --write` writes the map. `--brief` keeps the line, `--no-map` drops it.

The fused order ranks the hits. The reranker scores the top 20 and never changes that order.

## Read a refusal

`no prior work` means the best score is under the floor. Report it as "no prior work", with the query.
`⚠ no reranker` means the reranker server is down. The search still answers, on the cosine and BM25 floor.
`hybrid lane did not answer` means the index server is down. The semantic lane then answers.

## Measured

- Hybrid lane: a right file in the top 5 for 49 of 52 real Rule-0 queries. Semantic lane: 43.
- The reranker floor refused 40 of 40 off-topic queries and 20 of 20 hold-out ones. The cosine and BM25 floor refused 38 and 18.
- A reranked order lost 2 of 52 answers, so the fused order stays.

Setup and outages: `docs/HYBRID-SEARCH-SETUP.md`. Memory: `semantic-search-before-building`.
