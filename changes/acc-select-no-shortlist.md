---
bump: patch
type: fixed
brief: EXTERNAL-METHODS-SURVEY-FOLLOWUPS-2026-08-23-BRIEF.md
---

`tools/acc-shared-movement.mjs` no longer shortlists ACC fragments to the 3 largest per device
before measuring overlap. It bounds every fragment from its first and last line — no parsing — picks
the best-overlapping pair over the complete set, and parses only that pair.

The shortlist existed because parsing a fragment is expensive. Bounding every fragment across the
whole 39-night corpus takes 0.77 s against ~20 minutes to parse them, so it was buying nothing and
costing correctness: on 2026-07-30 the size-ranked top-3 picked a 0.08 h overlap against a true
0.39 h, and that night flips REFUSES (0 anchors) to ALIGNS (2 anchors) once corrected. Some nights
carry 162 Verity fragments.

Adds `tools/acc-select-compare.mjs`, which measures what each rule's shortlist costs and supplies
the reusable cheap-bounds helper. Analysis tools only; no shipped bundle changes.
