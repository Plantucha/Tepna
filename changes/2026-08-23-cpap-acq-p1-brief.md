<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [docs]
brief: CPAP-ACQ-P1-RAW-RECORD-2026-08-23-BRIEF.md
---
Design brief (PROPOSED) for CPAP hardening P1 — the durable raw record (INV9: the live bus is not the sole authoritative copy). Defines the canonical CPAP observation (findings spec §11, the one representation P4's committed store and the comparator's live side project from), the complete per-batch field list, the DURABLE-before-bus pipeline order, the crash-safe StreamWriter append idiom, and the tap-point attachment plan for when the controller-race fix lands. Standalone module now; wiring as one announced P1+P3 touch after the fix.
