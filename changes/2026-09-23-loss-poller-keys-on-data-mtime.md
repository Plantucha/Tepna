---
bump: patch
type: fixed
brief: CAPTURE-LOSS-PRECEDENCE-AUDIT-2026-09-22-BRIEF.md
---

The loss-audit poller re-runs only when a night's DEVICE-CAPTURE files change, not when any file in the folder does: the archive mirror's per-night `.archived` marker was making twelve settled nights read as changed on every 30-minute poll, re-reading gigabytes and re-running a journal subprocess per device for nights whose data had not moved in days.
