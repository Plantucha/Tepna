---
bump: patch
type: fixed
brief: none
---

Boot every kind of the cohort worker's realm in the suite, not only the lean `pulse` one, and assert statically that a kind whose modules call `escapeHTML` also loads the file that defines it — the gap that let #3462's oxy-realm break reach main while the suite stayed green.
