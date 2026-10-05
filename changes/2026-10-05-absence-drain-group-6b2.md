---
bump: patch
type: fixed
brief: ABSENCE-SURVEY-2026-09-22-BRIEF.md
---

The ring's opcode-sweep probe now marks an opcode's effect as unverified, and stops, when it cannot read the ring back after sending it, instead of recording "nothing changed". Its tests may no longer start a real process. Open ABSENCE-SURVEY findings: 253 of 290.
