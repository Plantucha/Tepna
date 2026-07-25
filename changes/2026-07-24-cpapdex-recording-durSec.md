<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [CPAPDex]
brief: NODE-EXPORT-RECORDING-DURATION-2026-07-24-BRIEF.md
---
CPAPDex's ganglior.node-export now stamps `recording.durSec` (the wall-clock span from the night anchor to the last session end). Without a duration key the Integrator's adaptEnvelopeNode derives endMs from the last event only, so an EVENT-SPARSE CPAP night (e.g. a 2-min mask-on session with 0 scored apnea/leak events) collapsed to a zero-length window and was EXCLUDED from the fold — the machine's own therapy/AHI data silently dropped out. Found by the 32-night full-fleet fuzz fold; second instance of the "node must declare a duration key" class after ECGDex. `durSec` is the key the adapter already honors (as for ECGDex/MotionDex/OxyDex); computed from the session span (NOT therapyHours, which is mask-on usage and understates it). Behavioral: CPAPDex re-bundled + all 5 CPAP goldens regenerated. build --check clean, run-tests green, verify-manifest GATE A+B, CPAP equiv/golden legs byte-identical.
