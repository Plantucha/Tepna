---
bump: patch
type: changed
brief: none
---

Derive the monitor page's chip-function list from `renderRemembered`'s own template (closed over callees) for both node-lane tests that consumed a hand-kept copy, so a chip added to the page is stubbed and scope-checked without anyone editing a list — the copies went stale the day `oxyStormChip` landed and only reddened on a machine that had node.
