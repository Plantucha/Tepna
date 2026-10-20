---
bump: patch
type: fixed
brief: none
---

The capture-host judged no 2026-10-18 night on vigil, and the Nights page showed "unknown". The O2Ring lost its link at 03:46 and reconnected at once. Its second session landed in the 2026-10-19 folder. The wear check found that session's SpO2 file in the next folder, but it read the PPG2W contact file from the night's own folder only.

The second session therefore had no contact witness, and its end read `quiet-end-unclassified`. Now `loss_audit.wear_ends` reads each PPG2W file from the folder of its paired SpO2 file. `nightqc.ppg2w_contact_quality` takes an optional `only` set, so a next-day folder costs only the sessions of this night.
