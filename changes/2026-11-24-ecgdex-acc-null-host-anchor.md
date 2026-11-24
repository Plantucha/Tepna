---
bump: patch
type: fixed
brief: none
---

Reject a null host stamp at the four ECGDex ACC anchor guards.

`parseDeviceACC` writes `tsMs: null` for a row whose phone column refuses `parseTimestamp`. The global `isFinite` coerces that `null` to 0 and reads it as finite, so the row passed all four anchor guards. It could become the absolute-time anchor for the whole file. It could also enter the anchor list as a null host member, which `DexClock.hostAxis` spends on the rate. The guards now read `Number.isFinite`, which rejects `null` and keeps a real `0`.

The four committed goldens carry byte-identical output values, and the row measured 0 rows of this shape over 64 corpus ACC files.
