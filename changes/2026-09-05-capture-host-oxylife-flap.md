<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: OXYII-ACQUISITION-CHARTER-2026-08-23-BRIEF.md
---
capture-host: the OxyII lifecycle journal no longer oscillates `idle_unworn↔live` at the poll rate for an unworn, connected ring — the stall guard's "frames flowing" re-asserted LIVE against every contact=0 vote (vigil 2026-08-28: 17,688 episodes, ~32k rows each way); a frame is now a heartbeat of the link and leaves an IDLE_UNWORN hold alone. Both lifecycle axes (`oxy_lifecycle`, `oxy_recording`) now reach `/api/state` and the monitor — they were written to STATUS from the first G4 night and forwarded by nobody.
