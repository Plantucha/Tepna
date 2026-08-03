<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite]
brief: CLOCK-MUTATION-COST-2026-08-03-BRIEF.md
---
mutate.mjs records WHICH group killed each mutant, reports the selection it actually runs rather than the tagged subset, and no longer goes silent under --json.
