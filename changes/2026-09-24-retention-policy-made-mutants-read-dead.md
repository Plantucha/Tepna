<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
`tmp_path_retention_policy = "failed"` is removed, with a test that refuses the setting by name. On a
green run pytest deletes that session's entire basetemp under that policy, so `failed` IS `none` there.
It does NOT mask surviving mutants — a 2x2 over 50 concurrent sessions with a positive control refutes
every directory-reaping route. It goes on cost: the fixture shrink already took a run from 2.0 GB to
63 MB, so the policy adds 189 MB (0.63% of a 30 GB tmpfs) and carries an unexplained one-mutant
perturbation of the mutation gate.
