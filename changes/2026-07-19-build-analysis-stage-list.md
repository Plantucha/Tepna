<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
`tools/build-analysis.mjs` now prints the exact `git add` line for the tools it rewrote, and its `--check` says out loud that it inspected the **working tree**.

`build-docs` adopted that contract in #236 after a half-staged release commit; the analysis surface never got it, and the same gap has since shipped a half-staged commit **twice** — once on the v1.14.0 release PR, and again while landing `DEEP-AUDIT-II` §6.2. Both times `--check` reported "analysis tools current", which was *true about the tree* and useless about the commit: the files had been regenerated on disk and simply not staged. CI caught the first; I caught the second by eye. Neither is a control.

The stage line is derived from `wrote` — the list the run actually rewrote — so a newly bundled tool cannot fall out of it, and it prints explicit paths rather than suggesting `git add -A` (§👥.2). The `--check` caveat is printed next to the misleading "current", which is where a reader needs it.

3 new assertions extending the §2b release-hygiene leg to this surface, mutation-verified: removing the stage line reds two of them. Source-scanned deliberately — "the writer announces what it wrote" is a property of the source, the same reason the sibling legs scan `build.mjs` and `release.mjs`.
