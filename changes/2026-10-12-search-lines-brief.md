---
bump: minor
type: added
brief: XERJ-HYBRID-SEARCH-2026-10-10-BRIEF.md
---

A hybrid search hit names the lines of its passage (`tools/xerj-load.mjs`, `tools/xerj-query.mjs`). The hit reads `file:812-840` and not `[chunk 34/259]`.

The loader places each chunk in two ways. When the indexed text is the file itself, the loader maps the chunk's characters back to the file exactly. JS comments and HTML text are different: the index holds only part of the file. For those, the loader finds the chunk's first and last words in the file.

A chunk that the loader cannot place has no line field. The printer then shows the chunk position. It never shows a line of 0.

On the real corpus, the loader placed 56,110 of 57,447 chunks. I read two printed ranges against their files, and both hold the passage.

`doc-search --brief` prints one line per hit and no passage (`tools/doc-search.mjs`). The read warning becomes one line in this mode. Both search lanes accept the flag.

`--rerank` adds a second refusal floor, opt-in (`tools/xerj-query.mjs`, `tools/doc-search.mjs`). A local bge-reranker-v2-m3 server on loopback scores the fused top 20. A best score under 0.105 refuses. The reranker never changes the order of the hits, because a reranked order lost 2 of 52 benchmark answers.

| floor | answerable refused | off-topic refused | hold-out off-topic refused |
|---|---|---|---|
| cosine and BM25 | 1 of 52 | 38 of 40 | 18 of 20 |
| reranker | 1 of 52 | 40 of 40 | 20 of 20 |

The floor was fit on the even half only. The refused answerable query had no truth file in its top 5 on either floor. `node tools/xerj-bench.mjs --refusal --rerank` repeats the measurement. When the reranker server does not answer, the search uses the old floor and prints a note. The server is not a unit yet, and its adoption is an owner decision.

No bundle moves.
