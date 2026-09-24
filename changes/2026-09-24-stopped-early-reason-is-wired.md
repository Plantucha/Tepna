<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [capture-host]
brief: none
---
A device that stopped early now carries WHY beside its seconds: `stopped_early_reason` is filled from
`loss_audit.wear_ends`'s `worn_end.reason` (`doff` / `link-loss` / `quiet-end-unclassified`, carried
verbatim), and `worn_end_at` publishes the wear boundary whether or not the device stopped early — so
the H10's off-body tail is readable rather than inferred. Absent wear leaves both null, which means
"not determined" and never "worn to the end".
