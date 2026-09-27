---
bump: patch
type: fixed
brief: PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md
---

Three capture-host mypy errors narrowed at the READ rather than cast at each use — a precise type for a table that only looked heterogeneous, and dict[str, Any] for a plan dict outside the mutation gate's reach; MYPY_BASELINE 32 to 29.
