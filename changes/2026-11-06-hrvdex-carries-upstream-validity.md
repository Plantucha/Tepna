---
bump: minor
type: added
brief: SEAM-SIDECAR-NODE-COVERAGE-2026-11-06-BRIEF.md
---

Carry the upstream node's `recording.validity` through HRVDex, and publish HRVDex's own. An ECGDex or
PulseDex night that refused a metric under a clock seam now reaches an HRVDex export with that
verdict intact, under the node that wrote it. HRVDex owns no sample axis, so its own seam count reads
`null` beside `summary-node-no-stream`, never zero, and a measurement with no upstream block names
why it has none.
