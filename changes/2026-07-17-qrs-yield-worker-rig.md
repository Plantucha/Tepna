<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: TEST-COVERAGE-FOLLOWUPS-II-2026-07-17-BRIEF.md
---
Add a worker-realm reconstruction rig for qrs-yield-worker (direct transfer of the §4 harness) — asserts it executes its QRS-detection-yield doJob without a closure error and reproduces a deterministic known-answer with the ECG+PPG detectors running in-realm. Brings workers executed by a gate to 2 of 4.
