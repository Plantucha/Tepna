---
bump: patch
type: added
brief: none
---

- A new tool, `tools/board-note.mjs`, lints a board note and posts it. Chained onto a finishing command, it clears the finish hook.
- `new-changeset.mjs` lints the bullet before it writes the file.
- `wt-done.mjs` proves a relay tree landed by its tip.
- The board hook names the queue thread.
