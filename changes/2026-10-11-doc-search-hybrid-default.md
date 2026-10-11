---
bump: minor
type: changed
brief: XERJ-HYBRID-SEARCH-2026-10-10-BRIEF.md
---

**`doc-search.mjs` answers from the hybrid lane by default, falling back to the semantic lane when the index does not answer.**

Owner ruling 2026-10-11. Measured on 52 real Rule-0 queries (brief §5): hybrid 49/52 against the
semantic lane's 43/52, ~18 ms warm against ~4 s, and the passage comes back rather than a path. The
fallback keeps the old behaviour as the floor: a server that is down, an index that is not loaded, or a
cold start past 10 s (measured 27.6 s on the first query after a unit restart, 75 ms warm) drops the
caller onto the semantic lane with one line saying so. `--hybrid` / `--code` keep the strict form
(answer or exit 2); `--semantic` names the pre-ruling lane. Both lanes leave the session stamp the edit
guard reads. The index server and its hourly refill now run as the user units from #3390
(`tools/systemd/tepna-hybrid-index*`), enabled on the primary development computer.
