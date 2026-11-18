<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: GENERATED-OUT-OF-PRS-2026-10-20-BRIEF.md
---
Run the build-first step before the build-core tests in the `static` job and in `npm run check`. The build-core tests compared committed bundles with a fresh build. CI had not built them yet, so a PR without its bundles failed.
