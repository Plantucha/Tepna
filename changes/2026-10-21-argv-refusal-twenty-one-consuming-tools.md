---
bump: patch
type: fixed
brief: none
---

Refuse an unknown flag in the 21 tools that silently ignored one. A mistyped flag now exits 2 with the nearest accepted name, and a positional argument still passes.
