<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [ECGDex, PpgDex, OxyDex, Integrator]
brief: INTEGRATOR-GAP-AWARE-OVERLAP-2026-07-27-BRIEF.md
---
ECGDex, PpgDex and OxyDex now declare `recording.coverage` when their recording has holes in it, and the fusion export publishes which denominator it used. Published AHI values will move on fragmented nights — that is the point: the Integrator honoured declared coverage since part 1, and no node declared any, so the index was still divided by the bracket around a recording rather than the recording.
