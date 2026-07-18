---
bump: patch
type: fixed
brief: none
---

ECGDex `parseDeviceACC` now takes per-sample time from the device clock
(`sensor timestamp [ns]`, column 1) anchored once on the first phone stamp,
instead of reading the host-arrival phone column per row. The phone column is
an arrival stamp and steps backwards at BLE frame boundaries, which produced
out-of-order `tsMs` and a jitter-inflated `accFs` (a real 25 Hz corpus file
read as 26 Hz). Matches the device-clock-preferred rule MotionDex/PpgDex
already apply via `relSecOf()`. Falls back to the phone stamp when the ns
column is absent.
