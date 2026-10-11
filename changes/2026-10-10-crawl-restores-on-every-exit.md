---
bump: patch
type: fixed
brief: none
---

The mutation crawl now recovers a leftover mutant at its own startup and on every catchable exit, and refuses to start against a tree behind origin/main. The recovery was extracted to one shared module rather than copied, because mutate.mjs already had a working one that the crawl never reached.
