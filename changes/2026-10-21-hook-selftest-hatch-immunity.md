---
bump: patch
type: fixed
brief: none
---

Each guard self-test now unsets its own escape hatch, so a hatch a session exports no longer scores the guard's DENY legs as ALLOW.
