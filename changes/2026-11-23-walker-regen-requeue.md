---
bump: patch
type: fixed
brief: none
---

The walker requeues a dequeued walker regen PR up to three times per head, because no coder reads the alert for it. A coder's PR keeps one requeue per head.
