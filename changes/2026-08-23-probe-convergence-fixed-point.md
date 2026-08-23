<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [tools]
brief: ZEPHYR-INSTRUMENT-2026-08-23-BRIEF.md
---
The overnight AI-probe driver's convergence test was unreachable: the per-file "N newly
KILLABLE" tally counts seed-pool re-hits every pass (deterministic seeds re-fire), so
pass_kills never reaches 0 on any file with a seed-killable key, the CONVERGED line never
printed, and every nightly ran to MAX_PASSES — measured 2026-08-23: passes 4 through 8
byte-identical at 53 "new" kills, ~5 redundant GPU passes per night. Convergence is now
measured on the artifact instead of the self-report: a pass that appended no line to any
ai-probe journal learned nothing, whatever it counted, and the driver stops there. Same
epistemics as the repo's "the check ran and examined nothing" class — the tally was a
report about the seeds, not about progress.
