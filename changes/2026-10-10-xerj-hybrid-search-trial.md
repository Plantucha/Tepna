---
bump: minor
type: added
brief: none
---

Add a measured hybrid-search trial: `tools/xerj-load.mjs` writes doc-search's existing chunks and cached bge-m3 vectors into a xerj index, `doc-search.mjs --hybrid` queries it and prints the enclosing passage (Rule 0's default path unchanged), and `tools/xerj-bench.mjs` scores it against doc-search on 52 real past Rule-0 queries — 94.2 % vs 82.7 % hit@5 with 16x fewer bytes to an answer.
