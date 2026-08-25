---
bump: patch
type: changed
brief: OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md
---

Map §22's 8-case restart matrix against what already exists (§10). Five cases are covered by #1702's
crash_1..crash_10 series; the three that are not (host restart during recording, immediately after
recording ends, BLE disconnect during recording) are exactly the recording-axis cases and belong with
unit 2. Names which function owns each of the four reconciliation legs, and states what the unit
tests do not establish: they pin reconciliation, not durability.
