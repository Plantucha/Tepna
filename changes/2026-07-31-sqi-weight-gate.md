<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [ECGDex]
brief: DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS-2026-07-18-BRIEF.md
---
Expose `ECGDSP.computeSQI` so the composite per-beat SQI weights can be gated, and pin all four exactly.

`minor`: an additive export, no call site changed, so it is compute-inert — proven by the ECGDex equiv
fixture reproducing byte-for-byte, not asserted. Each weight is now mutation-verified independently.
