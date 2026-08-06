<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [capture-host]
brief: CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS-II-2026-08-05-BRIEF.md
---

Absorbing a DST relabelling or a backward wall-clock step keeps an open recording monotonic, at the cost
of every stamp afterwards being off by that much until the session ends — and nothing said so.
`absorbed_shift_sec()` now reports it and `host_clock_poller` publishes it as
`host_clock.capture_absorbed_sec`, the surface `/api/state` already serves verbatim. Two of its own
mutants were the same silent trade in miniature: deleting the publication line survived every test of
the accessor, and rounding to whole seconds survived until a sub-second step was pinned.
