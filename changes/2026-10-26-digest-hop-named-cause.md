---
bump: patch
type: fixed
brief: none
---

Name the cause each unwalked hop actually has. The measurement walk reported an absent input whenever a guard needing two things lost either one. The hop's NOT_RUN state now rides a flag rather than the word `absent` in its own sentence.
