<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: TOOL-INVOCABILITY-SWEEP-2026-08-02-BRIEF.md
---
`tools/mutate.mjs` built its worker pool **once per file**, which made a roster-wide sweep unusable.

`git worktree add` checks out the whole tree — **71 MB** in this repo — so 12 workers × 71 files is 852 full checkouts, roughly 850 MB copied *per file*. Measured on this external volume: **one file took ~12 minutes**, projecting to ~14 h for the roster, and essentially all of it was checkout I/O rather than test execution. The tool looked fast on a single module (12 mutants in 3.9 s) precisely because that cost is paid once there and amortises over nothing.

The pool is now created lazily **once per process** and torn down after the last file:

```
before : 1 file  ≈ 12 min          (12 checkouts per file)
after  : 3 files ≈ 17.7 s total    (12 checkouts per RUN)
```

Found by running the thing at scale rather than on one module — the single-module timing in PR #692 was honest and completely unrepresentative, which is its own lesson about benchmarking a tool on the case you built it against.
