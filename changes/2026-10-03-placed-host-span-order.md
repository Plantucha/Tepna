---
bump: patch
type: fixed
brief: none
---

A night's coverage bar is measured by the host stamps the file itself carries rather than by the samples that arrived: `timeline._placed` now prefers `host_span_sec` over `rows / fs`, which measures RECEIVED samples and shortened every dropping stream by exactly its losses — 28 minutes of real Verity ACC recording read as nothing on 2026-09-28. The file's own device clock (`span_sec`) still outranks both, `rows / fs` is still there for a file carrying neither, and no basis at all is still `None` rather than a zero. Three tests now observe `offset_sec` — its default, an explicit `None` and the sign of the addition — which nothing in the suite looked at before.
