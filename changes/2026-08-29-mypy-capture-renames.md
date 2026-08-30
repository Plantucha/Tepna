---
bump: patch
type: fixed
brief: PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md
---
mypy session-lane batch 4b: two cross-kind variable reuses in capture.py renamed rather than
certified. `started` is bound nine times in that file with three meanings (a monotonic float, a
_now() datetime, and a bool), and mypy conflates the datetime with the bool because they share a
scope; `names` holds a str where the same name holds a list[str] elsewhere. A rename inside one
scope is behaviour-preserving BY CONSTRUCTION, which is a stronger guarantee than tracing ~600 lines
of nested async to argue the reuse is safe. 122 -> 119, measured on the rebased tree. 1052 tests pass.
