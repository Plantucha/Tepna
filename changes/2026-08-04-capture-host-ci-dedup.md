<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: none
---
Stop capture-host-ci firing twice per commit — the duplicate runs registered the same required checks and could deadlock a PR.
