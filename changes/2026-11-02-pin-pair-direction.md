---
bump: patch
type: fixed
brief: none
---

The two mutation-gate pin tests compare literals for equality, so a bump that raises the pair into a combination nobody has run passes both. The floor now needs a recorded read of the pinned mutmut against the pytest release it names.
