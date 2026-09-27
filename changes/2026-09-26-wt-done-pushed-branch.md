<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [tools]
brief: none
---
`tools/wt-done.mjs --pushed`: a worktree whose branch has no PR may be reclaimed when every local commit is
contained in a freshly fetched `origin/<branch>` and the tree is clean and idle — the state measurement trees
and WIP branches sit in (three refused tonight, ~1.5 GB). An OPEN PR still keeps its tree; nothing else is
weakened. Self-tested (36/36).
