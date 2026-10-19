---
bump: minor
type: added
brief: O2RING-FREEZE-SURVIVAL-2026-10-13-BRIEF.md
---

Name the job that held the event loop: a watchdog thread samples every thread's stack while the stall is
still in progress and files one row per stall to `<night>/STALLS.jsonl`.
