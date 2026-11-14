---
bump: patch
type: fixed
brief: WRITE-ROOT-ADOPTION-2026-11-03-BRIEF.md
---

Make the Integrator surface gate judge the checkout it was run from. A run from a second checkout printed `PASS` over 148 keys of a tree the caller never named. It now refuses with one `NOT_RUN` object at exit 2.
