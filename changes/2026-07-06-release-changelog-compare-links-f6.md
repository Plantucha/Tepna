<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: CONTROLLED-RELEASES-FOLLOWUPS-2026-07-05-BRIEF.md
---
Teach `tools/release.mjs` to maintain the CHANGELOG's reference-style compare links (F6): on each release it advances `[Unreleased]` to compare from the new tag and inserts a `[x.y.z]: …/compare/v{prev}...v{new}` line, leaving the oldest `releases/tag` link intact — repo base derived from the existing `[Unreleased]` link (no hard-coded URL), idempotent on re-run.
