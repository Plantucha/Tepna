---
bump: patch
type: fixed
brief: PAPER-ODI4-REPRODUCIBILITY-2026-07-31-BRIEF.md
---

`papers/odi4-ahi-bias.html` described its real-PSG path as using "dropout forward-fill". The adapter
stopped doing that in #2423 — a dropout is emitted as `null` and never carried forward, per §∅ — so
the methods section documented apparatus that no longer exists.

A wrong methods statement is the failure a reader cannot detect: the text describes the instrument
that produced the results, and nothing in the output contradicts it.

The paper's published tables are synthetic-cohort, so no number moves; only the description was
wrong. Served copy rebuilt.
