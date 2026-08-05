---
bump: patch
type: fixed
brief: MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md
---

The mutation sweep's calibration run — a clean full-suite pass before any mutant is tested — produced no
output. Measured at **480 s under `--full`**: eight minutes indistinguishable from a hang, and the third
and longest silent phase after the per-mutant loop and the pool build were fixed. It now announces the
phase up front and reports how long the clean run took.
