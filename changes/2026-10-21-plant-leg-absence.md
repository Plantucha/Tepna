---
bump: patch
type: fixed
brief: none
---

Assert in the mutation crawl's selftest that its planted process tree is gone once the bounded call returns. The plant now announces its pids, self-destructs after 300 s, and runs in a scratch directory, so an escapee holds no worktree open.
