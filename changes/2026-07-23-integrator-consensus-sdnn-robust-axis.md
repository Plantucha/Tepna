<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator]
brief: none
---
fuseHRVConsensus now compares PpgDex on its cross-node-comparable sdnnRobust axis instead of the baseline-wander-inflated whole-record sdnn — on a real overnight this stops a ~3% true SDNN agreement being surfaced as a ~23% "divergence" (and, past 30%, a false qc:'divergent' data-quality flag).
