---
bump: patch
type: added
brief: none
---

Name a closure declaration the walker can no longer read. The walker honours a `Residue-fixed:` line
a body gains after its merge only while that pull request stays inside its merge window, which spans
about 8.5 h. `tools/residue-promises.mjs` scans deeper than the window and classifies every declared
key against the ledger on the ref as closed, pending, dropped or unknown-key. It imports the window
constant and both parsers from the walker, so the two cannot drift. Over the 200 newest merges at 2026-11-10 00:47Z: 79
declared keys, 62 closed, 17 pending, 0 dropped.
