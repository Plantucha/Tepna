<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: REPO-DISCOVERABILITY-FOLLOWUPS-2026-07-04-BRIEF.md
---
Make `tools/build-docs.mjs` settle the served tree in ONE pass. `llms-full.txt` (Phase 2) concatenates `README.md`, which Phase 3 stamps with the canonical version — so the artifact was generated from the *previous* run's bytes and came out exactly one release behind, leaving `build-docs && build-docs --check` reporting `STALE (1): llms-full.txt` until the writer was run a second time (which no doc prescribes, and the tool's own header comment contradicted). The version stamp is now a pure text transform (`applyStamp`) that Phase 2 derives its text through, instead of re-reading the stamped file — every artifact is a pure function of (source text, canonical version), independent of phase order. Phase numbers are unchanged.
