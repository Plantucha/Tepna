<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PulseDex]
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
pulsedex-dsp.js joins SWEEP_FILES — it was the missing ninth for the whole first programme, so
mutation-worklist's aggregation (worklists, witness baselines, the sweep-state view) silently
excluded the one DSP with the lowest kill rate. The suite driver itself always swept it (fleet
discovery reads the tree, not this list), which is why sweep state existed while every
worklist-derived report under-counted. The self-test's hardcoded 8 becomes SWEEP_FILES.length in
the distinct-paths check and an explicit 9 where the count IS the assertion.
