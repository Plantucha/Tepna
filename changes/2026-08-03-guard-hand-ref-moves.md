<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: none
---
Deny hand ref-moves in the shared-tree guard — `git update-ref refs/heads/<b>` desyncs any checkout holding that branch, which turned 47 live files into phantom deletions before a blanket add staged them.
