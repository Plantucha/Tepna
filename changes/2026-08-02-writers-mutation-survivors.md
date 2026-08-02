<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: none
---
The five capture writers now have their durability default and their column layouts pinned — 90 % of mutations killed, up from 76 %.

`writers.py` produces the corpus every other analysis rests on, and it was the weakest untouched
module in `capture-host/`. 83 survivors closed, no shipped source changed.

Two shapes dominated. **`fsync: bool = True` was unpinned in all five writers** — every test passes
`fsync=False` explicitly, correctly, to stay fast — so a flipped default would write a whole night into
page cache and call it recorded; this is the same fail-safe-default finding the audit already made once
on `alerts.Notifier(enabled=False)`. And **24 survivors sat in one `";".join(...)`** in
`HostClockLogWriter.write`, where the assertions read cells 1-3 and the last, leaving the six between
free to be renamed or nulled — in the sidecar that exists to tell a future reader "stratum-1 PPS all
night" from "the box free-ran on its RTC".

Also pinned: the `_RR` sibling's path derivation and its flush/close (the per-beat intervals were
reachable only through the parent's handle), the open-writer counter's `max(0, …)` floor that
`capture`'s empty-writers health check reads, the PPI flag bits, and `file_stamp`/`file_device_id` over
the filename shapes their docstrings name. Details in
`audits/MUTATION-AUDIT-FINDINGS-2026-08-02.md` § Fourth pass.
