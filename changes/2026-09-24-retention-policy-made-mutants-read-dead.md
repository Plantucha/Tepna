<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
`tmp_path_retention_policy = "failed"` is removed, with a test that refuses the setting by name. On a
green run pytest deletes that session's entire basetemp under that policy — so `failed` IS `none` there
— and the setting measurably perturbs a mutation sweep (identical verdict at `all`, decided count off by
one). Which mechanism produces the observed false kills is still under test, and the revert does not
wait on it: the policy bought 63 MB where the fixture shrink had already bought 2.0 GB.
