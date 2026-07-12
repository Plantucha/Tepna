<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [adapters, Data Unifier, OverDex]
brief: DEEP-AUDIT-2026-07-11-BRIEF.md
---
Set aside Polar Sensor Logger motion streams instead of analyzing them as heartbeats — a real H10 `*_ACC.txt` was routed to the RR adapter and its gravity axis read as RR intervals.

Every Polar Sensor Logger stream (`_ACC` / `_MAGN` / `_GYRO` / `_PPG` / `_ECG` / `_RR` / `_PPI`) shares the
same `Phone timestamp;sensor timestamp` envelope, so `polar-rr.detect()` scored **all** of them 0.6 on that
envelope alone. `*_ECG.txt` was safe only because `polar-h10-ecg` outranks 0.6; the motion streams have no
adapter, so nothing outranked them and `polar-rr` won by default. A real 272 556-row H10 accelerometer file
then passed the `usable` gate — its Z-axis gravity rail (~973 mg) sits inside PulseDex's 300–2000 ms
interval window — and produced a confident node-export: HR 61.9 bpm, mode "overnight", stress 100, and 36
`stress_peak` events at conf 0.92, all fused downstream.

`detect()` now vetoes a foreign stream by name **and** by declared unit (`[mg]` / `[G]` / `[dps]` / `[uV]` /
`[nT]`), so a renamed file is still refused, and the bare PSL timestamp envelope no longer votes for an RR
stream on its own — an `RR-interval` / `PP-interval` column does. Genuine `*_RR.txt` / `*_PPI.txt` still
route to `polar-rr` at 0.97 and `*_PPG.txt` / `*_ECG.txt` to their own adapters, unchanged. Adapters inline
only into the two orchestrators, so no node re-bundles and no fixture moves.
