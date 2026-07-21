<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
The Integrator now honors MotionDex's `recording.durSec` as a declared recording length.
`adaptEnvelopeNode`'s declared-end chain tolerated `endEpochMs`/`durationMin`/`durationMs`/
`durationSec` but never `durSec` — the only duration key MotionDex's node-export emits — so a
MotionDex envelope with sparse, early-clustered `posture_change` events collapsed to a near-zero
fusion window (the all-node overlap read ~40 min for an 8 h night) and was wrongly excluded, the
exact failure the surrounding fallback was written to prevent for PulseDex. Additive and back-compat:
`durSec` is consulted only when `durationSec` is absent. Export-inert for the tch golden (GATE B
reproducible); gated.
