<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite, tooling]
brief: REPO-DISCOVERABILITY-FOLLOWUPS-2026-07-04-BRIEF.md
---
Add roster-derived per-page `<head>` discovery meta (description · canonical · OG/Twitter) to the 7 reference guides + 4 content pages, generated + `--check`-guarded by a new `tools/build-docs.mjs` Phase 0 that upserts a marked block from `suite.manifest.json` (executes REPO-DISCOVERABILITY-FOLLOWUPS §5.3/§5.6).
