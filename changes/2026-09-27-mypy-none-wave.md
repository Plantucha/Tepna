---
bump: patch
type: fixed
brief: PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md
---

Fourteen capture-host mypy errors from the None wave — in every case the code already handled absence and only the inferred type disagreed, so the existing handling is made visible rather than a second untested guard added; MYPY_BASELINE 25 to 11.
