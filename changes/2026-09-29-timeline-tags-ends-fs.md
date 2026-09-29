---
bump: patch
type: fixed
brief: none
---

Three defects one night surfaced in `capture-host/timeline.py`. The tag resolver compared a file's tag
against `s.upper()` alone, so the ring's `_ACCRAW.txt` matched nothing and its whole night was painted
`idle` — the tag set is now `nightqc.stream_file_tags`'s, never a second copy. A file's extent was taken
from `rows / fs` before its own host stamps, and `rows / fs` measures RECEIVED samples, so a dropping
link was shortened by exactly its losses (09-28: a stream running to 04:20:39 drawn as stopping at
03:52); `host_span_sec` now outranks it and the mtime refusal is unchanged. And `bucket_stream` took an
`fs` that appears nowhere in its body — removed rather than wired, because bucketing intervals across a
window needs no sample rate.
