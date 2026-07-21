<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [Integrator, PpgDex]
brief: OXYDEX-PULSE-RESOURCING-2026-07-18-BRIEF.md
---
The Integrator cross-checks the O2Ring's own finger pulse against its smoothed 1 Hz field (§Phase 2,
read-only). When a night carries BOTH a `site:'finger'` PpgDex export (the ring's single-channel
pleth — the honest, WAVEFORM-derived HR) and an OxyDex export (the ring's 1 Hz `stats.meanHr`),
`fusePulseCrossCheck` reports the disagreement: `biasBpm = deviceHr − waveformHr`, its magnitude as a
percentage of the waveform, and an `agree` flag against a ±3 bpm band. Per the brief's §5 thesis the
waveform is the reference and the 1 Hz field is never treated as ground truth — the two are never
averaged, only compared. PpgDex now exports `recording.site` ('finger' | 'wrist'); the Integrator's
generic node-export normalizer surfaces the OxyDex `pulseHr1Hz` (the legacy `_summary.json` adapter
sets the same field). The cross-check is attached to the fusion export ONLY when both legs are
present, so every night without a paired finger capture stays byte-identical. The synthetic PpgDex
golden gained `recording.site: "wrist"` (additive) and was re-recorded. No fusion metric is derived
from the comparison — it is an audit surface, not an input.
