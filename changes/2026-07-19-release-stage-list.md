<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: CONTROLLED-RELEASES-2026-07-05-BRIEF.md
---
`tools/release.mjs` printed a post-release `git add` line carrying its own hardcoded copy of the deploy paths `tools/build-docs.mjs` rewrites — and that copy had drifted. It named `README.md`, `index.html` and `docs/about.json` but omitted **`docs/sitemap.xml`, `docs/feed.xml`, `docs/llms-full.txt` and `docs/index.html`**, every one of which build-docs rewrites on *every* release: `BUILD_DATE` is the newest `RELEASE-MANIFEST` date (deliberately, so the drift gate cannot red at midnight on an in-sync tree), so cutting a release always moves it.

Following the printed line literally produced the v1.14.0 release commit **missing four regenerated files**, and no local gate could catch it — `build-docs --check` reads the **working tree**, where they were already correct, while CI checks out the **commit**, where they were absent. Four local gates passed and CI caught it a cycle late.

Fixed structurally rather than by patching the list: **build-docs now derives and prints the stage line itself**, from the same `artifacts` map and `stampRules` the run actually uses, so a newly added artifact cannot fall out of it. It lists every *managed* path rather than only the changed ones, because a changed-only list is non-idempotent — run the tool twice and the second, shorter list silently drops the first run's files. `release.mjs` now carries only the paths it writes itself and defers the rest.

4 new assertions pinning "there is exactly one list": release.mjs may name no build-docs-owned artifact, it must point at build-docs, build-docs must emit the line, and it must derive it from the maps rather than a literal. Source-scanned deliberately — *there is exactly one list* is a property of the source, the same reason the sibling §2 leg scans `build.mjs` for `verifiedUnder`. Mutation-verified both directions: re-hardcoding an artifact name reds (it caught the author's own explanatory comment doing exactly that), and swapping the derived list for a hand-list reds. Verified end-to-end against a simulated 1.99.0 release — the printed list covers every file build-docs modified.
