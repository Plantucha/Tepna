---
bump: patch
type: changed
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---

OxyDex `computeVO2maxEstimate` was PSEUDO-TESTED — executed by `compute()` on every run, with
nothing asserted about anything it returned, so every mutant of it survived. It now has a gate
pinning both published formulas against their citations (Tanaka 2001 HRmax, Uth-Sørensen 2004
VO2max), the RMSSD adjustment and its ±3 cap, and each refusal bound at both sides. Verified by
re-applying 17 mutants to the function body: 17/17 killed.
