---
bump: patch
type: fixed
brief: none
---

The PAT pinned-span tool's headless realm now loads `consensus-dissent.js`. Since #4433 the worker calls `ConsensusDissent` with no guard, so every recording threw a ReferenceError and was refused. A realm file that is not on disk now throws instead of being skipped. A new selftest leg runs both legs over a synthetic pulse in the real realm.
