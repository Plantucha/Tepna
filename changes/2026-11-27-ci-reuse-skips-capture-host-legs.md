---
bump: patch
type: fixed
brief: none
---

On a push to main that reuses a green merge-queue run, the capture-host test legs and the supply-chain job now read skipped. Before, they ran their relevance steps and read success, so the CI timing tool kept those runs in its sample.
