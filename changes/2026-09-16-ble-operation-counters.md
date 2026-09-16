---
bump: minor
type: added
brief: BLE-TRANSPORT-REDESIGN-2026-09-10-BRIEF.md
---

capture-host: BLE operation counters — attempts, successes, failure classes and retries-by-cause —
published in `status.json` as `ble`. A success rate over zero attempts is `null`, never 1.0 and never
0.0, so a device that was never contacted cannot report a perfect score.
