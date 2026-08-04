<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: CAPTURE-HOST-SUBPROCESS-SURFACE-2026-08-04-BRIEF.md
---

capture-host: the async recording double for `asyncio.create_subprocess_exec`, and the four
`storage_targets` functions that reach the system through it — `_run`, `push_night`, `test_target`,
`dest_status`. 54 mutants. Closes step 4, and with it all four steps of the subprocess-surface brief.
