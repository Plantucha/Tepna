---
bump: patch
type: fixed
brief: none
---

Read the brief guard's verdict off the write target, not off the write verb. A program that names a guarded doc inside the data it writes elsewhere no longer denies. The scan resolves one level of literal assignment, so a target behind a variable still denies. An unresolved target, a shell-out and an unreadable literal all fail closed.
