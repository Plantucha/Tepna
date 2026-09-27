---
bump: patch
type: fixed
brief: PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md
---

Seven capture-host mypy errors narrowed at the READ rather than cast at each use — a typed local where one producer exists, dict[str, Any] where a dict really is a JSON blob, and a precise type where a table only looked heterogeneous; MYPY_BASELINE 32 to 25.
