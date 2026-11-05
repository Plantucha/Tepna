---
bump: patch
type: fixed
brief: none
---

Restore the generated paths a rebase rebuilt inside the walker's own checkout.
A dirty path the builders do not own stops the step and names itself in the journal.
