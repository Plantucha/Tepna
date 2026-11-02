---
bump: patch
type: fixed
brief: RADIO-CLOCK-SIDECAR-2026-09-07-BRIEF.md
---

Stamp a device clock on a radio-clock sidecar row only when the device declares the vendor whose
measurement protocol the parser reads, and name the reason in a new `device_clock` column when it
does not. A device that speaks another protocol previously turned its payload bytes into dozens of
invented `meas` keys and 584-year stamps, because both fields were read at fixed offsets.
