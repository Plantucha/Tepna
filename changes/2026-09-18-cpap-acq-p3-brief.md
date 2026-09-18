---
bump: patch
type: added
brief: CPAP-ACQ-P3-GAP-ACCOUNTING-2026-09-18-BRIEF.md
---

CPAP-ACQ P3 executable brief — the phase the charter has named as its next step since 2026-09-02, and a
re-measurement that found the charter's own §8 stale. INV7 was recorded as *module built, held*; the
gap-accounting module is in fact partly wired, and the remainder splits four ways: `classify_frame` is a
dead twin of logic that runs live in `as11_pull.py`; `overflow`, `post_drop_tail` and `stalls` have no
writer, which makes `total_lost` ≡ `malformed` and the published `transport_gaps` structurally always 0
(§∅ at the evidence layer — an absence wearing the shape of a measurement); INV8's `continuity_status`
and INV11's acquisition-owner lock have no artifact at all. Charter §8 rows for INV7/INV8/INV11 and its
status header re-stamped in the same session as the triage.
