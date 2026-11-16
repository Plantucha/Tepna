---
bump: patch
type: fixed
brief: none
---
`tools/rebase-safe.mjs` now resolves the generated conflicts of every stopped commit, not only the first one. It skips a commit that the resolution leaves empty. Before, a second conflicting commit threw out of `rebase --continue` and left the tree mid-rebase. The walker's own generated-only rebuild commit caused that second stop on #5132. `tools/pr-walker.mjs` `stepResult` no longer records git fetch progress as the reason a step stopped.
