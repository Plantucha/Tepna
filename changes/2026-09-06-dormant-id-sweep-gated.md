---
bump: patch
type: changed
nodes: [suite]
brief: DEEP-AUDIT-VI-FOLLOWUPS-2026-09-02-BRIEF.md
---

The dormant-flag sweep is now a gate, keyed on the metric ID rather than its rendered label.

#1455 flagged two metrics dormant while both had compute and surface sites all along, reachable by the
id (`accExtras`/`_accCardRR`) and by a non-label name (`disagreementRatePct`) — which a label-keyed
scan cannot see. 0 of 23 dormant entries are suspect today; the assertion keeps it that way.

Carries a positive control because the first draft was vacuous: two registries resolved to zero source
files and reported a confident clean result having examined nothing.
