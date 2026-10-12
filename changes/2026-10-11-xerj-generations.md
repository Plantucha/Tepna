---
bump: patch
type: fixed
brief: XERJ-HYBRID-SEARCH-2026-10-10-BRIEF.md
---

**The hybrid-search loader builds one fresh index per run and moves the name to it** (`tools/xerj-load.mjs`). Reloading the same deterministic ids into one index every hour was not idempotent on this engine: its vector graph appends on every overwrite and never reclaims, so 4,643 hourly writes grew the index to 9.7 GB on disk (3.3 GB graph for 62k documents, 53 KB per 4 KB vector), the server to 11.3 GB RSS past its own memory breaker, and every search to 13–22 s. A load now writes `tepna-hybrid-<utc stamp>`, swaps the alias `tepna-hybrid` to it in one request, deletes what it replaced and any orphan of an aborted run; a `--limit` probe is never promoted; a load of zero leaves readers on the previous generation. The first run also replaces the legacy real index wearing the alias's name. Seven new selftests; the alias lifecycle was driven against scratch indices. No bundle moves.
