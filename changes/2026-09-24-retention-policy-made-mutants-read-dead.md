<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
`tmp_path_retention_policy = "failed"` made the mutation gate score surviving mutants as killed:
pytest removes the whole basetemp on a green run under that policy, and mutmut forks one child per
mutant from a single session sharing it. Removed, with a test that refuses the setting by name. The
fixture shrink was the load-bearing half of the /tmp fix all along (2.0 GB → 63 MB per run).
