---
bump: patch
type: added
brief: none
nodes: [tools]
---
`tools/xerj-query.mjs` refuses a query when both halves of the hybrid search are weak: the top cosine is below 0.8075 and the top BM25 score is below 27. A refused search prints "no prior work" with the two scores and the weak paths, without passages. A missing half never refuses. `doc-search.mjs` shows the refusal in its hybrid lane.

`tools/xerj-bench.mjs --refusal` judges the committed floor against the 52 answerable queries and the 40 off-topic queries in `audits/XERJ-REFUSAL-QUERIES.json`. The criterion: the floor refuses no query that hybrid answers right at hit@5, and refuses more than half of the off-topic queries. On 2026-10-12 it refused 1 of 52 answerable queries (that query had no hit) and 38 of 40 off-topic queries; the odd-index hold-out gave 1 of 26 and 18 of 20. The off-topic set is invented and holds no near-domain query, and the floor belongs to the bge-m3 embedder.
