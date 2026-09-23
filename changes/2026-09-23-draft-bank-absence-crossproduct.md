---
bump: patch
type: changed
brief: none
---

The mutation draft bank crossed against the §∅ survey's 290 confirmed rows (#2916): **16 of 384 drafts mutate a line the survey confirmed as fabricated absence, and none is adopted** — so this sizes what a future adoption pass would walk into rather than live false assertions. Two are a distinct defect: their model-written property sentence states the violation as the intended contract (*"defaults to zero rather than null"*). One goes the right way (`@undef`, same file and class), which is why a blanket rule would be wrong. Remedy is a procedure — cross-check candidates against the audit JSON's `file`/`line`/`kind` at adoption time — not a build. Recorded in `briefs/RESIDUE.md` as `2026-09-23-draft-bank-crossed-against-the-absence-survey`.
