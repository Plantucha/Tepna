---
bump: patch
type: added
brief: none
---

`commit-shape` refuses a commit that adds a 0-byte file at the repo root — the spaced-path trap that splits `Data Unifier.html` — with the three historical instances declared as a shrink-only baseline, and deletes the 0-byte `Unifier.html` that had been on main since 2026-09-24.
