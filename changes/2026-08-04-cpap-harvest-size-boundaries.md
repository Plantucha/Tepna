<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: none
---

capture-host: `cpap_harvest`'s size-window family — `should_fetch`, `short_read`, `size_tolerance_kb`,
`reap_stale_part` — was tested either side of every boundary and never on one. Eleven mutants,
including one that reaps a `.part` differing beyond the first 64 KB chunk, destroying the only copy of
an interrupted download. Three more are proven equivalent and deliberately left. Also records the
stale-bytecode trap in the mutation runbook: it silently corrupted the negative control in both
directions while `git status`, `git diff` and `inspect.getsource` all read clean.
