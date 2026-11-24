<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: none
---

The board hook reads a finish command only where the shell runs one. A search or an echo that names
`gh pr create` owes no board post. A `tools/pr-open.mjs` call counts as the post.
