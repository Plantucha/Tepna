---
bump: patch
type: added
brief: none
nodes: [tools]
---
`tools/xerj-query.mjs` refuses a query when both halves of the hybrid search are weak. The top cosine is below 0.8075 and the top BM25 score is below 27. A refused search prints "no prior work" with the two scores and the weak paths, without passages. An absent half never refuses. `doc-search.mjs` shows the refusal in its hybrid lane.

`tools/xerj-bench.mjs --refusal` judges the committed floor against 52 answerable queries and 40 off-topic queries. The off-topic set is `audits/XERJ-REFUSAL-QUERIES.json`. The floor must refuse no query that hybrid answers right at hit@5. It must refuse more than half of the off-topic queries.

On 2026-10-12 it refused 1 of 52 answerable queries, and that query had no hit. It refused 38 of 40 off-topic queries. The odd-index hold-out gave 1 of 26 and 18 of 20.

I wrote the off-topic set by hand, and it holds no near-domain query. The floor belongs to the bge-m3 embedder.
