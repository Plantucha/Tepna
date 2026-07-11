<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [suite]
brief: BIOME-FORMATTER-2026-07-11-BRIEF.md
---
Delete the `lint.yml` compatibility shim now that the `main` Ruleset no longer requires an `eslint` status check — Biome (`format.yml`) is the sole formatter+linter, no ESLint anywhere.
