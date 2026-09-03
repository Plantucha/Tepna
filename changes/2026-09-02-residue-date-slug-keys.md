<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [tooling]
brief: none
---
The residue ledger's row key moves from a sequential `R<n>` counter to `YYYY-MM-DD-short-slug`, matching
what briefs and changesets have always used. The counter produced five collisions in one day — the last
between two sessions who had just argued the rule, each running the prescribed pre-push check and each
getting a correct answer from it, because `origin/main` cannot contain an id claimed in an open branch.
20 rows and 18 back-references renamed in one migration; `docs-ledger` check 8 and `tools/residue-ids.mjs`
drop their high-water, gap and monotonic rules, which a self-describing key does not need.
