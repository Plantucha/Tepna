<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [suite]
brief: BIOME-FORMATTER-2026-07-11-BRIEF.md
---
Retire ESLint (`lint.yml` + `.eslintrc.json` + the `npx eslint` script) now that Biome carries the same control-flow/dead-code floor with proven parity — `npm run lint` and `format.yml` are the sole lint gate; one pinned tool does format + lint (BIOME-FORMATTER Phase 3 step 2).
