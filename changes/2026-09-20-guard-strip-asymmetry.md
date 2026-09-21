---
bump: patch
type: added
brief: none
---

Residue: the guard hook's quote/heredoc stripping is wired into one of its twelve rules, so a
commit message may document some forbidden forms and not others. Measured, with the constraint
that blocks the obvious fix.
