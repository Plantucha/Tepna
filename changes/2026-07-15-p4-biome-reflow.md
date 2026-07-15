<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [suite]
brief: ARCHITECTURE-DEBT-REDUCTION-2026-07-14-BRIEF.md
---
Reflow the whole source tree with Biome 2.5.3 in one pass and retire the `biome.json` formatter-override list, so every in-scope `*.js` is uniformly formatted and CI's `biome ci` enforces format everywhere (the on-push job flips from `biome lint` to `biome ci`). All 8 apps + the 2 orchestrators re-bundled; every app `manifestHash` moved (whitespace-only churn of the compute closure) but **all 24 fixtures reproduce byte-identical — 0 output/input hashes moved (EXPORT-INERT, verified via a pre/post ledger diff, not asserted)**. Full suite 2497 green, GATE A/B PASS, tsc green, `biome ci` exit 0. ⚠ Because the reflow rewrote DSP text inside the compute closure, `computeHash` moved on all 8 apps, expiring `verifiedUnder` on the 14 corpus-backed fixtures — a full-corpus `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs` re-stamp is OWED before the next release (see ARCHITECTURE-DEBT-REDUCTION-FOLLOWUPS). A family of format-sensitive source-mirror gates in `tests/dex-tests.js` that P4-prep under-measured (cross-Dex significance rule, HRV derived gates, mmol edges, worker-source extractors, badge-by-construction window, and others) were hardened to be whitespace/optional-paren/indent tolerant, each verified to still reject a broken form.
