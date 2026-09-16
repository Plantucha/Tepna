---
bump: minor
type: added
brief: BLE-TRANSPORT-REDESIGN-2026-09-10-BRIEF.md
---

capture-host: taking a reserved adapter during failover is now recorded as a decision on the
radio-failover event (`preemption` plus the `reserved_adapters` in force), not only written to a log
line. Behaviour is unchanged — it still preempts, because refusing is a data-loss trade.
