---
bump: patch
type: fixed
brief: none
---

Bind `mutate_diff.py`'s retry counter beside the other names `emit` reads, so the three early returns emit their verdict instead of raising `NameError`.
