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

A reranker floor is now the Rule 0 default (`tools/xerj-query.mjs`, `tools/doc-search.mjs`), on the owner's order of 2026-10-12. `--no-rerank` asks for the old floor by name. A local bge-reranker-v2-m3 server on loopback scores the fused top 20. A best score under 0.105 refuses. The reranker never changes the order of the hits, because a reranked order lost 2 of 52 benchmark answers.

| floor | answerable refused | off-topic refused | hold-out off-topic refused |
|---|---|---|---|
| cosine and BM25 | 1 of 52 | 38 of 40 | 18 of 20 |
| reranker | 1 of 52 | 40 of 40 | 20 of 20 |

The floor was fit on the even half only. The refused answerable query had no truth file in its top 5 on either floor. `node tools/xerj-bench.mjs --refusal --rerank` repeats the measurement. When the reranker server does not answer, the search uses the old floor and prints a note. `tools/systemd/tepna-rerank.service` starts the server at boot. The owner enables it, as `docs/HYBRID-SEARCH-SETUP.md` shows.

A new skill, `search-before-building`, gives the Rule 0 command, its flags, how to read a hit and what a refusal means.

A code hit also names the function that holds it (`tools/xerj-load.mjs`). An example is `allan.py:197-215 · gcov`. The loader runs universal-ctags on each code file and keeps the scopes with an end line. The search never reads the field, so no ranking moves. Without ctags, a hit has no symbol field.

Version 6.2.1 of ctags gives end lines for Python and the external SDK sources, not for JS or shell. So the loader reads JS with a JS parser, a pinned devDependency (`acorn` 8.18.0, MIT, no dependencies). It ships in no bundle. A function takes the name of the declaration, variable, property or assignment that holds it. Without the parser, a JS hit has no symbol field.

The parser reads all 427 tracked JS files and finds 9,863 scopes. A dry load gives symbols to 1,955 files and 21,449 of 59,347 chunks. I read 5 sampled ranges against their files, and all 5 are right. An example is `oxydex-dsp.js:4605-4620 · computeDesaturationProfile`.

No bundle moves.
