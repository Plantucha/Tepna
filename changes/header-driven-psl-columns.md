---
bump: patch
type: fixed
brief: none
---

MotionDex and PpgDex resolve Polar Sensor Logger columns by HEADER NAME instead
of fixed position, falling back to the numeric tail. Our capture host emitted an
extra `timestamp [ms]` column on ACC/GYRO/MAG/PPG before 2026-07-18 11:43, which
silently shifted every fixed index: ACC `x` received the millisecond value, `y`
received true X, `z` received true Y and true Z was discarded, while the Verity
pleth came back as a linear millisecond ramp with `ambient` holding true ch2.
478 already-recorded files are now read correctly with no migration.
