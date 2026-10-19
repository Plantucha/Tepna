---
bump: patch
type: added
brief: PAT-FORENSICS-WINDOW-ORACLE-2026-08-28-BRIEF.md
---

Name the nights whose admissibility depends on which half the PAT oracle estimated its mode from. The mode decides whether the oracle scores a night at all, and the design estimates it on the first half. So every verdict now carries an `admissibility` class, the run counts the classes, and `result.halvesAdmissibility` carries the counts. The selftest counts its own assertions instead of printing a typed total.
