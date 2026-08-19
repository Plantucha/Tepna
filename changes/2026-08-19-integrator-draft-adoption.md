<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [Integrator]
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
The fourth bank file, and the cleanest: 22 of 22 integrator drafts batch-verified green with zero
discards, adopted as one DSP-floor group, and every one of the 14 unique target mutants re-applied
and red on first verify — no sharpening pass needed. The pins are the guard floor of the fusion
layer's parsers and clock tools: normalizeFile's unrecognized-format and Unknown-node warnings,
deltaModeSec / _wrappedSlopeFit / refineLagByDeltaMode / reconstructEventTMs / estimateEventLag
refusing absent input null-never-throw, pickHRAuthority returning no authority for junk rows,
fitClockDrift refusing with its honest named reason ("too few beats"), detectClockSkew reporting
an empty findings list rather than crashing, and the summary route recognizing a node name without
a format warning.
