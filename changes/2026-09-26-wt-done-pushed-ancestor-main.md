<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [tools]
brief: none
---
`tools/wt-done.mjs --pushed` also accepts a tree whose HEAD is contained in a freshly fetched `origin/main` —
a branch with no commits of its own (a measurement bench) has nothing to land and nothing to prove. Checked
before the branch fetch, so it holds for a never-pushed branch or a detached HEAD on main; every other
refusal unchanged.
