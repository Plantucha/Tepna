---
bump: patch
type: changed
nodes: [suite]
brief: DEEP-AUDIT-VI-FOLLOWUPS-2026-09-02-BRIEF.md
---

The dormant-surface scan now asserts the precondition its label exemption depends on.

The matcher admits an ALIAS only if multi-word or >= 8 chars, but admits the LABEL unconditionally. A
bare short label would false-positive on a quoted enum value exactly as `upright` did, with nothing to
stop it. 0 of 23 dormant entries carry one today, so the exemption is currently free — but 116 of the
fleet's 520 labels are bare words under 8 chars, so the day one is marked dormant the gate would start
crying wolf. Asserting the precondition is cheaper than sweeping for a hazard that has no instance.
