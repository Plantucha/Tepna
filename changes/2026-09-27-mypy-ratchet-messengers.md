---
bump: patch
type: fixed
brief: PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md
---

Five capture-host mypy errors that were reporting real defects, not missing annotations — a retry helper that could raise `None`, a coercer table whose call site was untypable, and two shadowed test helpers; `MYPY_BASELINE` banked 37 → 32.
