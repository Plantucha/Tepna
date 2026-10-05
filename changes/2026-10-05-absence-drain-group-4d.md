---
bump: patch
type: fixed
brief: ABSENCE-SURVEY-2026-09-22-BRIEF.md
---

A night seal the capture box cannot read is now reported as unknown for that night and left exactly as it is, instead of being silently replaced by a new seal under the current card key; re-sealing is an operator's decision. A seal missing its revision or key number is also unknown, never treated as 0. Open ABSENCE-SURVEY findings: 267 of 290.
