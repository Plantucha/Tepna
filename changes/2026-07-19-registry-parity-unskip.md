<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [ECGDex, PulseDex, OxyDex, suite]
brief: REGISTRY-PROJECTION-2026-07-04-BRIEF.md
---
Hard-gate the last two ungated crossnight metric sets — ECGCross/PulseCross now hoist their METRICS[] to module scope and export an id-keyed ECG_DEFS/PULSE_DEFS projection, and OxyDex's crossnight pbIndex gains the registry entry it never had, so `registry-defs-parity` covers all five nodes (78→149 assertions) with zero ⊘ skips instead of deferring the array-shaped nodes.
