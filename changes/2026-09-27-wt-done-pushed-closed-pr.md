<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [tools]
brief: none
---
`tools/wt-done.mjs --pushed` also accepts a tree whose PR was CLOSED unmerged when every local commit is
contained in a freshly fetched `origin/<branch>` — the branch on origin is the copy, so the tree loses nothing;
the branch itself is never deleted (abandoning a branch stays the owner's call). OPEN PRs still keep their tree.
