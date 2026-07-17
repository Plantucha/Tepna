<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: TEST-COVERAGE-FOLLOWUPS-II-2026-07-17-BRIEF.md
---
Add a worker-realm reconstruction rig for qrs-equiv-worker — evals the worker source with deps as params + a no-op importScripts, drives its init/job protocol, and asserts it executes without a closure error and reproduces a deterministic ECG/PPG rMSSD known-answer; the analysis workers had never been executed by any gate.
