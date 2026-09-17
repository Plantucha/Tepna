---
bump: patch
type: changed
brief: BLE-TRANSPORT-REDESIGN-2026-09-10-BRIEF.md
---

capture-host: the offline-op timeout is now counted and logged by CONDITION rather than by
occurrence. Measured over a 72 h unattended window: 240 ERROR events, 239 of them this one line and
1 a distinct condition. The first occurrence still logs at ERROR; the rest carry a count and repeat
on decades, and the total rides in `status.json` `ble`.
