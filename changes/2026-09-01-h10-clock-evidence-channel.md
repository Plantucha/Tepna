<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [ECGDex, capture-host]
brief: none
---
Persist per-night device clock-sync outcomes (`CLOCKSYNC.csv` sidecar) and annotate 2019-origin H10 recordings in the ECGDex export (`recording.deviceEpoch` + `recording.timingSource`) — annotate, never refuse; also wires the previously dead `recording.hostAxis` export block through analyze().
