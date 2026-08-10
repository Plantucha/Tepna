<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [PulseDex, GlucoDex, CPAPDex, HRVDex]
brief: NODE-EXPORT-DURATION-SEMANTICS-FOLLOWUPS-2026-08-06-BRIEF.md
---
Gate the four ungated nodes' published duration against a synthetic gapped twin — and pin the two that fabricate coverage.

Tests-only; no DSP, bundle or ledger is touched, so no re-bundle or provenance cycle is owed. 17
assertions under the `duration-semantics` tag, in both lanes.

Executing the assertion falsified the parent brief's §7 table for two of the four nodes. CPAPDex
(`durSec` 8400 s against 1200 s of data) and HRVDex (`recordedSec` null, never 0) satisfy the contract
and are now ratcheted. PulseDex's untimed branch publishes DATA seconds as `durMin` and asserts
`coverage: 100` on a stream it cannot place in time; GlucoDex's `recordedSec` is the same expression as
`spanSec`, so a 6 h CGM dropout reports full coverage. Both are pinned as characterization and routed to
NODE-EXPORT-DURATION-SEMANTICS-FOLLOWUPS-II, since each fix is compute-path and owes its own re-bundle.

Every assertion is mutation-verified, including the two defect pins against their own fix.
