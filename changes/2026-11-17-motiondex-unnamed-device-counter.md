---
bump: patch
type: fixed
brief: none
---

Read the MotionDex device counter only from a column the header names.

A header that named `X;Y;Z` beside a bare `timestamp` named no counter column.
The parser then read column 1, the X axis, as a nanosecond counter.
One hour of data published `durSec: 0` and one epoch.
A header that names no counter now leaves the device axis absent, and the host stamp sets the duration.
