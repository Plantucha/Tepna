<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [ECGDex]
brief: none
---
Give ECG sample TIME the host-disciplined axis; `fs` stays the rate — Clock Contract §7.

`tMsAt(i)` is additive: it rides `hostAxis.correctionAt()`, which needs no span gate, while `fs` keeps
its span-gated ppm correction for the filters that consume it as a rate. On 160 of 187 real ECG
fragments the span gate REFUSES the ppm, so those recordings carried no time correction at all —
median divergence 48 ms, max 1479 ms. Falls back to device time where no independent clock exists.
