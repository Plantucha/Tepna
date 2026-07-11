<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [suite]
brief: none
---
Run the `biome` gate on push to `main` as well as on PRs — a whole-tree Biome lint floor on push (mirroring `tests`/`types`/`no-network`), restoring the on-push lint coverage the retired eslint shim provided, now under the `biome` check name. PRs keep the changed-files `biome ci --changed` format+lint.
