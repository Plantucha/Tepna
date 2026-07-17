<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator]
brief: none
---
Integrator now reads a GlucoDex dawn surge from glucose.dawn.medianDelta (the key the light export actually writes) — the summary.dawnSurge read chain previously pointed only at pre-enrichment keys and resolved null for every GlucoDex export (the un-fixed sibling of the glucose.cv read-drift).
