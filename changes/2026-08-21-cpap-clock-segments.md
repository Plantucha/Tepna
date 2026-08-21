<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [Integrator]
brief: CPAP-CLOCK-LONGITUDINAL-SEGMENT-2026-08-21-BRIEF.md
---
Integrator gains `fitClockOffsetSegments` — a step-aware longitudinal model over
per-night measured CPAP offsets: segments the timeline at travel-shaped jumps,
fits linear crystal drift within each segment with residual + ppm checks, then
interpolates unanchored nights inside a passed segment. Refuses across step
boundaries, on extrapolation, and in single-anchor/failed segments — never
fabricates an offset. Pure, deterministic. Fills the `#1606` gap the pooled
single-offset apply left. 19-assertion suite group; full chain green.
