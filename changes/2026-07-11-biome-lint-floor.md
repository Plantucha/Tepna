<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite]
brief: BIOME-FORMATTER-2026-07-11-BRIEF.md
---
Port the ESLint control-flow/dead-code floor into Biome (`biome.json` `linter.rules`) so `format.yml`'s `biome ci --changed` now enforces format + lint on changed files (0 errors on the current tree, parity-verified); ESLint stays running in parallel this cycle until it's retired (Phase 3 step 2).
