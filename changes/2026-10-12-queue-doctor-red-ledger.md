---
bump: minor
type: added
brief: none
---

**A red PR is an event once, written to a file, not a journal line every ten minutes.**

`tools/queue-doctor.mjs` now keeps a red ledger under the timer user's state directory. `red-prs.json` holds the current red set with the failing required check, the run link and the first run that saw it. `red-prs.log` gains one line when a PR turns red and one when it clears, so a watcher on the log wakes once per change. The board reads the JSON; a session tails the log.

Owner, 2026-10-12: "some auto system should warn you". #3477 and #3481 sat red for an hour under this timer. The timer printed the red on every run into a journal nobody read.
