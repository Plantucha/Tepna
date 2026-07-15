<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [tooling]
brief: ARCHITECTURE-DEBT-REDUCTION-2026-07-14-BRIEF.md
---
Split the two shared provenance ledgers into per-app `provenance/<App>.json` fragments (P3). The
monolithic `BUILD-MANIFEST.json` + `FIXTURE-PROVENANCE.json` — single files every bundle-touching PR
rewrote, forcing bundle/ledger work to serialize — are retired. Each app now owns one fragment
carrying its GATE-A `manifestHash` and its GATE-B fixtures, so two app PRs never edit the same bytes.
A new `provenance-ledger.js` assembler (Node fs + browser fetch, single-sourced) reassembles the
identical combined `{ bundles }` / `{ fixtures }` shape, so `manifest-gate.js` and `dex-tests.js` are
unchanged. All writers (`build.mjs`, `verify-fixtures.mjs`, `regen-*`) and readers (`verify-manifest.mjs`,
`run-tests.mjs`, `release.mjs`, `reconcile-provenance.mjs`, `verify-provenance.html`, `no-network.html`,
`Dex-Test-Suite.html`) migrated; `verify-manifest.mjs` gains a fragment-set ≡ index.json consistency
check. No `manifestHash` moved (bundles byte-identical); export-inert; GATE A/B + suite green.
