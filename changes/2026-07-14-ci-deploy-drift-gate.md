<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite, docs]
brief: REPO-DISCOVERABILITY-FOLLOWUPS-2026-07-04-BRIEF.md
---
Wire `build-docs.mjs --check` into CI as the deploy drift guard (`tests.yml` static job, alongside the `build.mjs` / `build-analysis.mjs` drift guards), so the served `docs/` tree can no longer drift from its root twins unnoticed — the hole through which the 8 stale served app bundles and the lagging `llms-full.txt` both reached `main` and the live site. Prerequisite fix in the same change: `build-docs.mjs` stamped `new Date()` into `sitemap.xml` `<lastmod>`, `feed.xml` `<updated>` and the `llms-full.txt` header, which made the tool non-deterministic — it rewrote three committed artifacts every midnight with no content change, so the new gate would have false-red on every PR from the next day onward (verified: under a simulated future clock the old code reports `STALE (3)` on an in-sync tree). The date now comes from the newest `RELEASE-MANIFEST.json` record — honest (`<lastmod>` = when the served tree actually last shipped, not when the build ran), stable between releases, and byte-identical today.
