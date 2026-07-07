<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: CONTROLLED-RELEASES-FOLLOWUPS-2026-07-05-BRIEF.md
---
Project the canonical suite version into the discovery surfaces and make the release-ledger check-6 stamp-parity gate non-vacuous (F2/F3/F4): stamp `softwareVersion` into index.html + docs/index.html JSON-LD (and a visible footer `v`), `docs/about.json` (+ build-docs `buildAbout`), and a `**Suite version:**` marker in README; add a build-docs Phase 3 that projects `suite.manifest.json` version into those surfaces (idempotent, updates markers in place); teach `release.mjs` to stamp `CITATION.cff`; and feed each surface's raw text into `env.releaseLedger.surfaceTexts` from both runners so check-6 extracts (single-sourced) and reds on a version mismatch OR a removed marker.
