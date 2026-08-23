<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: DELIVERY-PROCESS-OVERHAUL-2026-08-18-BRIEF.md
---
Rewrite `DELIVERY-PROCESS-OVERHAUL` §7 (acting on another session's PR) to correct the "+1 s = owner's chain" heuristic — the delta is a property of the owner's tooling, not of whether someone else acted — and to introduce the idempotent-flag-set vs state-dependent-actor split so the read-back-the-number rule is priced correctly for each family.
