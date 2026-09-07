<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The monitor's timeline cache held exactly one entry and expired exactly as the page re-polled it, so most polls paid a full rebuild — 1.35 s for the night in progress and 2.05 s for a complete 1330 MB one, growing as the night grows. `_tl_cache.clear()` ran before every insert, defeating the "cached per (night, buckets)" the comment above it promised: a second viewer, or the same viewer on a different bucket count, evicted the other outright. The TTL was also 60 s against `monitor.html`'s 60 000 ms `loadTimeline` interval, so even the surviving entry expired as the next poll arrived. The cost is not server latency — the build is already off the event loop in a thread and `/api/state` holds at 3 ms throughout — it is that the page keeps up to 4 permanent SSE connections of a browser's ~6 per-host HTTP/1.1 budget, so a two-second request occupies one of the two remaining slots and the 1 s state poll queues behind it, which is what makes the page visibly stop. The cache now evicts the oldest entry past a bound of 8 rather than clearing, and the TTL is 300 s — chosen against the display (at the 600-bucket maximum over a ~10 h night one bucket is ~60 s wide, so sub-minute freshness cannot be rendered), not against the poll. Both bounds moved to module scope so a test can assert the TTL against the interval read out of the page itself.
