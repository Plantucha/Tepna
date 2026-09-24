<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
`tmp_path_retention_policy` is removed and the key refused by a test, because its `none` value makes a
mutation sweep report 116/116 mutants killed (A/B, one glob, only the setting varied). The `failed` we
had shipped is exonerated by the same A/B — byte-identical to `all` across 350 decided mutants — so this
is hygiene, not a fix: the setting saves 189 MB of a 30 GB tmpfs, the fixture shrink having already done
33x of that work, and a setting worth 0.63 % one word from one that blinds a gate is better absent.
