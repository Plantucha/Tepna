<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ECGDex]
brief: none
---
Refuse the device counter in the `_ACC` companion parser when it rebases mid-file — on 2026-08-26 the H10's 2019-origin default adopted real time partway through and the accelerometer stream came out spanning 67,091 hours with its last sample dated 2034-04-22, while the same night's ECG stream handled the seam correctly.
