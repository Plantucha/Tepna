---
bump: patch
type: changed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

HRVDex: the 7-day VO2 rolling window, the ground-truth delta and the subjective d_hile thresholds
are now gated. The window is date-keyed with day-dedup, a ≥3 minimum and a 7-day depth — none of
which a single-row fixture can reach; the delta is profile-gated, which §9.4's `getHooks` is what
made safely reachable. Also pinned: a nonsense profile age produces a negative estimate and the
window refuses it rather than averaging it into a published trend. Verified by re-applying 16
mutants: 15 killed, 1 proven equivalent.
