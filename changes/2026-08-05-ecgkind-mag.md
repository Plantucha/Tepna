<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ECGDex, PpgDex, suite]
brief: DEEP-AUDIT-V-2026-08-04-BRIEF.md
---
ecgKind's set-aside rule still required the `_MAGN` spelling, so the capture host's `_MAG.txt` fell through to its fail-open default and became an ECG PRIMARY — 813 of 813 real magnetometer files, while ppgKind on the same name correctly said `magn`. DEEP-AUDIT-III §6.4a widened every other classifier and missed this one.
