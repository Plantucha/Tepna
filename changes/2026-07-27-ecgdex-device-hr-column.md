<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ECGDex]
brief: DEEP-AUDIT-III-2026-07-26-BRIEF.md
---
`parseDeviceHR` took the LAST column of a `_HR.txt`, and on both real layouts that column is an interval in milliseconds, not a rate. Polar Sensor Logger writes `Phone timestamp;HR [bpm];HRV [ms];…` with 2 fields when HRV is absent and 3 when present, so "last" is HR on some rows and HRV on others within one file — on a real 21 613-row night the truth is n=21613 mean 50.47 bpm while the positional read returned n=6396 mean 39.94, i.e. 70% of rows dropped and the survivors are millisecond values laundered through the 20–260 "plausible bpm" band. capture-host writes `…;HR [bpm];RR-interval [ms]`, whose 857–1062 ms values all exceed that band, so every row was rejected and the card went silent rather than wrong on every capture-host night. The column is now resolved by HEADER (`\bhr\b` deliberately not matching `hrv`), with a per-row shape fallback for headerless files that can never land on an interval — a port of `motiondex-dsp.js xyzColsFromHeader`, which had it right. Both real headers ship as committed twins in the gate, because a gitignored recording would leave CI as blind as the positional read was.
