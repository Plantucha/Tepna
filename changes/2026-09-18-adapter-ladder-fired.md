---
bump: patch
type: changed
brief: CAPTURE-HOST-RESOURCE-ORCHESTRATION-AUDIT-2026-09-05-BRIEF.md
---

Resource-orchestration §7 — the adapter ladder DID fire on 2026-09-11, so residue row
`2026-09-11-dead-adapter-goes-unnoticed` is wrong on its headline. The journal shows wedge sign 1/2 at
19:42:06, escalation, `power-cycling adapter … (attempt 1/3)` at 19:43:06 and `hciconfig hci0 reset
exited 1` at 19:43:15. The row's "0 reset attempts" came from a window that closed at ~19:38, before the
event, AND a grep for vocabulary the daemon never emits. Its "no btreset systemd unit" is true and
irrelevant — the ladder is `adapter_watchdog`'s rungs in capture.py, not a unit. What is genuinely open is
different from what the row names: ~19 min detection latency, and rungs that cannot fix this wedge class
(reset exited 1 from the daemon, timed out by hand). One hypothesis measured and refuted: `_POLAR_PAUSED`
starvation is only 20.7 % of the span (77 pause/resume pairs), enough to skip ~6 of ~29 polls, not all.
