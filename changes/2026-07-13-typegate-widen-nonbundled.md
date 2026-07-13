<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [tooling]
brief: OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md
---
Widen the checkJs type gate (D.2 / DEV-TOOLCHAIN Part C) by three non-bundled modules — event-coupling.js, dex-coload.js, provenance-banner.js — each proven green with tsc; zero bundle churn.
