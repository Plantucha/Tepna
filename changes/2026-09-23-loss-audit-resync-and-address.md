---
bump: patch
type: fixed
brief: CAPTURE-LOSS-PRECEDENCE-AUDIT-2026-09-22-BRIEF.md
---

The nightly loss audit now attributes two daemon causes it could not see: a clock-watchdog re-sync (which pauses live capture) was matched by no cause bin, and the offline-op pause line names the device only by its address, which a name-only journal filter never read. Over 28 box nights (2026-08-25 → 09-21) 147 min of H10 loss previously booked as `unattributed` was the re-sync; re-auditing an old night re-labels those minutes as `daemon:clock re-sync` / `daemon:pull paused live`.
