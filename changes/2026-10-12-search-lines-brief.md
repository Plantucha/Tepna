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

No bundle moves.
