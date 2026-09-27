---
bump: patch
type: fixed
brief: PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md
---

Five capture-host mypy errors narrowed at the READ rather than cast at each use — dict[str, Any] where a dict really is a JSON status blob, and a precise type for a table that only looked heterogeneous; MYPY_BASELINE 32 to 27.
