<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: none
---
Make `npm run check` run every drift guard CI runs, and gate the two lists against each other — the missing build-analysis and build-docs checks had reddened CI five times.
