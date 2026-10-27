<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: none
---
Four corpus enumerators report the file population they walked, through a named lister and a
`snapshotEntries` pair, so a run that scores nothing still names the files it passed over.
