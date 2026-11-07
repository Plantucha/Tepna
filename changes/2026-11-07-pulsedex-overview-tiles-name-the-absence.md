---
bump: patch
type: fixed
brief: ABSENCE-SURVEY-2026-09-22-BRIEF.md
---

# PulseDex overview tiles name the absence

The PulseDex overview grid graded seven KPI tiles with a bare comparison.
A null compares below every cut, so a refused Baevsky SI painted green.
Two of the tiles also built their displayed value with a string concatenation.
That handed the emitter the text `null`, which its own null test cannot catch.

Each of the seven tiles now takes the null first and grades it neutral.
The two string tiles format through one helper that keeps a null null.
A measured zero keeps its number and its grade.

Measured over the seven unguarded tiles: two painted green, two red and three amber.
