---
bump: patch
type: fixed
brief: none
---

`mutation-crawl.mjs` ran 8 h 1 min under `--max-hours 5` and was ended by its unit's 8 h
`TimeoutStartSec`, then SIGKILLed 90 s later with a live mutant in the shared root. The budget was
checked only before starting work, and `execFileSync`'s timeout signals the direct child while
`mutate.mjs`'s worker pool holds the stdout pipe open — so the ceiling could never act. The sweep now
runs in its own process group and the crawl reaps the GROUP when the budget is spent; at startup it
reads the deadline it actually runs under and refuses when `--max-hours` is not comfortably inside it,
journalling both numbers either way. `mutate.mjs`'s restore now writes a sentinel naming the mutant it
undid.
