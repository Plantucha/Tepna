---
bump: patch
type: fixed
brief: ABSENCE-SURVEY-2026-09-22-BRIEF.md
---

When `bluetoothctl` does not answer, the capture box now treats a sensor's bond as unknown rather than lost, so it no longer forces a re-pair or spends a re-bond attempt on no evidence, and the adapter watchdog says BlueZ did not answer. A Bluetooth scan also ranks a 0 dBm reading as the strongest signal instead of treating it as absent. Open ABSENCE-SURVEY findings: 269 of 290.
