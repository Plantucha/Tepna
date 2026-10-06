---
bump: patch
type: fixed
brief: ABSENCE-SURVEY-2026-09-22-BRIEF.md
---

The device-probe opcode-sweep tests no longer wait out real Bluetooth timeouts: a test setting that never reached the code it was meant to shorten is fixed, cutting that test file from about 7 minutes to under 2 seconds.
