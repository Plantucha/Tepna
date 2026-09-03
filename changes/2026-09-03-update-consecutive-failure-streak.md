<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [capture-host]
brief: VIGIL-AUTO-UPDATE-FOLLOWUPS-2026-08-14-BRIEF.md
---
capture-host: `tepna-update.sh` now counts consecutive failed runs, so a 9.3-hour outage stops looking exactly like a blip — `systemctl status` reported the same thing for both, and the measured 30-run streak of 2026-08-04 went unnoticed for most of a night. The counter is keyed on the exit status rather than on `die`, because the script's own `exit "$drifted"` can fail the unit without calling `die` and that path is the one that runs longest; the streak is silent on the first failure and named from the second, and the run that clears it reports the count and span.
