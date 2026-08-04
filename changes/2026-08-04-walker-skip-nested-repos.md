<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: none
---
Stop the repo walker descending into a nested git worktree — its `.git` marker was skipped as a dot-entry, so another session's checkout was walked as this repo's source: A2 reported 10 missing SPDX headers CI could never reproduce, and the docs-ledger link inventory could resolve a link against a file that exists only in someone else's worktree.
