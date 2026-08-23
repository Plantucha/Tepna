---
bump: patch
type: changed
brief: OXYII-ACQUISITION-CHARTER-2026-08-23-BRIEF.md
---

The charter's G2 Done-when box now records the measured mutation state instead of leaving "merged"
to imply "verified". G2 merged while the gate CRASHED before reporting (KeyError on a keyless
equivalence entry, fixed #1687), so its red check carried no information about survivors either way.

Re-run under the fixed gate with `--no-reuse` — deliberately, because scratch reuse is the
unisolated mechanism that reports already-killed mutants as surviving: 245 killed, 28 survived,
89.7% kill rate. Survivors concentrate in `make_row` (14), a dict builder, which LOOKS like a
coverage-shaped gap rather than a logic one — recorded as a hypothesis, not a finding.

Triage of the 28 is owed and deliberately not done in the same breath as measuring them: classifying
a survivor as equivalent without running distinguishing inputs is the unevidenced claim
`mutate-equivalence.json` exists to abolish.
