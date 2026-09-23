---
bump: patch
type: fixed
brief: none
---

The seam sidecar detects resume from its OWN file instead of inheriting the parent StreamWriter's
flag — the idiom the three other resumable writers in writers.py already use. It was the only one
inheriting, and #2902 made it open LAZILY, so "the parent is resuming a file-set" stopped implying
"my own file exists with a header". On the resume path it opened "a" on a path that did not exist
and skipped the header by design; measured on the box, last night's H10 ECGSEAMS carried no header
while the Verity's did. The mirror failure is fixed too: a sidecar over an existing non-empty file
previously opened "w" and TRUNCATED the earlier session's rows — the #2166 class the other writers'
comments cite.

⚠️ This does NOT explain the 0-byte file that started the investigation. The header is buffered at
64 KB, so nothing reaches disk before close() regardless of the flag — measured, size-before-close is
0 in both cases. Two independent defects; only this one is fixed here.
