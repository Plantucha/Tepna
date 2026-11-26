---
bump: patch
type: fixed
brief: none
---

Place each EEGDex epoch time on the host axis, and publish which timebase it rides.

`compute` put each epoch at `t0Ms + i * 30 s` on the device index, and `buildNodeExport` copied that
time into `ganglior_events[].t` and `.tMs`. The box measured this device at -49.9 ppm, so an 8 h
night published its last stage transition about 1.4 s off the host timeline. The raw-frame ingest now
forwards the host axis and the first device anchor, and `analyze` places every epoch through the
differential correction. A correction of `fs` recovers none of this: at 256 Hz, `round(30 x fs)` is
the same integer at both rates.

`tMsBasis` and `tMsBasisReason` name the timebase the epoch times ride. One non-finite correction
drops the whole series back to the device index, so no hypnogram carries two timebases. The node
export's timing block also reads the axis, so this road no longer under-claims to `device-only`.
