<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: CPAP-ACQ-P2-LIFECYCLE-2026-08-23-BRIEF.md
---
Add `capture-host/cpap_acq.py` — the CPAP acquisition lifecycle state machine (16 states, explicit legal-transition frozenset, illegal moves raise), a recoverable/permanent failure taxonomy, and an immutable timestamped provenance `Transition` record in the journal-sidecar idiom. Pure/clock-injected, 100% branch; closes hardening-audit gaps G3/G7/G10. Standalone — consumed later by P1's raw sidecar and P5's recovery.
