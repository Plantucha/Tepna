<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [ECGDex, Integrator]
brief: MEASUREMENT-PROVENANCE-ROADMAP-2026-08-26-BRIEF.md
---
ECGDex emits the `measurement` block (hr · rmssd · sdnn, whole-record, `basis: derived`, host-axis spread published on box nights) and the Integrator's generic envelope adapter consumes it into refs — the roadmap's second emitter, schema 2.1.
