<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [ECGDex]
brief: WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02-BRIEF.md
---
ECGDex reads `hostAxis.deviceDrawn`: a drawn device column is placed on the host timeline, relabelled `timingSource:'host'` with `stability:null`, and exports `deviceDrawn`/`drawnShare` (present only when drawn) — never spent as a second clock; and the fs-correction refusal reason now names the gate that fired (host column not a second clock · no finite rate · span), instead of always "span too short".
