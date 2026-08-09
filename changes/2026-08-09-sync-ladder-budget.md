<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Bound the clock-sync ladder's TOTAL spend, not just each attempt.

Every attempt in `auto_sync_clock`'s 12-deep ladder runs through `polar_offline_op`, which holds the
GLOBAL `_CONNECT_LOCK` — so the ladder's real cost is lock-seconds, and 12 x 45 s is roughly nine
minutes of it per reconnect cycle, blocking every other sensor's reconnect.

This shape has now been fixed three times and the first two both bounded ONE op. 2026-07-19: an
out-of-range device wedged capture for 58 minutes, producing `_OFFLINE_OP_TIMEOUT_S`. The same day, 12
retries x 300 s produced a 97%-duty-cycle wedge, producing `_CLOCK_SYNC_TIMEOUT_S = 45` and the note
"the bound has to be proportionate". It was made proportionate, and the shape returned: measured
2026-08-09 with an H10 on a desk, 51 ops in 59.1 min, mean hold 41.1 s, 2097 s of 3544 s — a 59% duty
cycle.

Proportionality lowers the constant; it cannot remove the loop. `_CLOCK_SYNC_LADDER_BUDGET_S = 120`
bounds the ladder's total elapsed time, which holds regardless of which error is being retried — it does
not require `device_absent_error` to classify anything correctly, and it would have capped all three
incidents. Classification reduces the common case; the budget bounds the worst one.

120 s is about two attempts at the 45 s ceiling, sized for what the ladder is FOR: `InProgress` after a
restart clears in seconds, not minutes (2026-07-18, the failure that motivated retrying at all), so two
attempts spend the contention case without funding the hopeless one. Measured monotonically — `_now()`
is civil-time-anchored and re-anchors on an NTP step, which this daemon did twice in one week.

The test that matters most is the one for the regression the budget could cause: a fast contention
recovery must still be waited out. Four mutants re-applied, each killed by the intended test — budget
removed, budget too large to fire, budget small enough to cut fast contention short, and the boundary
comparison loosened.
