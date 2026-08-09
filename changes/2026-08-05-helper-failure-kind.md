<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [capture-host]
brief: CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS-II-2026-08-05-BRIEF.md
---

A crashing privilege layer logged identically to a refused one, which is why `cpap.state: "error"` sat
unexplained for ten days while sudo-rs panicked (rc=101) on every helper. `helper_failure_kind(rc, out)`
now tags crashed/refused/missing/timeout/failed by EVIDENCE — 101 is a crash only when the output
carries a panic — and a crash logs at ERROR. No behaviour change: acting on the verdict is the owner's
call. The first pattern matched no real output; the journal's line carries a pid the regex did not span.
