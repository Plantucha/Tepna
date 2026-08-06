<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host, docs]
brief: CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS-2026-07-26-BRIEF.md
---

Executes `CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS-2026-07-26` to DONE. Behaviour change: a BACKWARD wall-clock
step no longer rewinds an open recording — reproduced at −30 s (`_now()` went 22:00:10 → 21:59:50,
rewinding the Phone column of a file being written), and absorbed by the same §A1 rule the DST arm
already used. Forward steps still applied; with no writer open a backward step is still followed. The
live `cpap.state: "error"` is explained and was NEITHER suspected cause — `sudo` itself was panicking
(sudo-rs rc=101) plus a read-only filesystem, a host fault outside capture-host.
