---
bump: patch
type: fixed
brief: none
---

Record the stored-spool pull's run day on disk, so a daemon restart inside the pull window no
longer repeats a pull that already succeeded. The record lands only after a pull returns, which
leaves a failed day retryable.
