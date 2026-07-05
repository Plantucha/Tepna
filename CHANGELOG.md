<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Changelog

All notable changes to **Tepna — the Dex Suite** are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the suite uses
[Semantic Versioning](https://semver.org/) — one version number for the whole suite (the
"maintenance number"). See `docs/COMPLIANCE/SOFTWARE-LIFECYCLE-PLAN.md` for what MAJOR / MINOR /
PATCH mean against Tepna's published contracts, and `RELEASE-MANIFEST.json` for the machine-readable
ledger this file is the human view of.

> **How this file is maintained.** Do **not** hand-edit released sections. Each work-unit drops a
> collision-free changeset in `changes/` (see `changes/README.md`); `tools/release.mjs` folds all
> pending changesets into a new version section here, stamps `suite.manifest.json`, appends a
> `RELEASE-MANIFEST.json` record, and prunes `changes/`. The `release-ledger` gate keeps this file,
> the ledger, and the canonical version in agreement.

> ⚠️ **Reconstructed history.** Everything **below 1.0.0** (waves `0.1.0`–`0.9.0`) is *reconstructed
> from the DONE brief corpus* for provenance — those waves were **not** formally cut releases, and no
> per-app `manifestHash` snapshot is claimed for them. Formal, ledger-backed releases begin at
> **1.0.0**. Dates are the real brief execution dates.

---

## [Unreleased]

_Nothing pending._ Pending work lives as changeset files in `changes/` until the next release folds
them here. (Concurrent OWN-THE-BUILD Part C and docs-ledger follow-up work will land as post-1.0.0
changesets.)

---

## [1.0.0] — 2026-07-05 · Baseline

First **controlled release.** Declares the current all-gates-green tree as the stable 1.0.0 baseline
and establishes the release-governance layer over it.

### Added
- **Suite versioning** — one canonical SemVer in `suite.manifest.json` (`version`), the maintenance
  number every release, changelog entry, and ledger record points at (`CONTROLLED-RELEASES-2026-07-05`).
- **This `CHANGELOG.md`** (Keep a Changelog) + machine-readable **`RELEASE-MANIFEST.json`** history.
- **Changeset flow** — additive, collision-free `changes/*.md` drops folded by `tools/release.mjs`
  into one automated version+stamp step, so parallel coders never hand-pick a number.
- **`release-ledger` gate** (`tests/dex-tests.js`, both runners, headless floor) — valid SemVer,
  no fork (newest ledger record ≡ canonical), unique + strictly increasing versions, history↔changelog
  parity, changeset well-formedness, and "unreleased code needs an unreleased changeset."
- **62304/13485-aligned compliance doc set** (`docs/COMPLIANCE/`) — software lifecycle plan, safety
  classification (Class A / non-device), configuration-management plan, SOUP list (runtime-empty by
  design), release SOP, and an ISO-13485 document-control crosswalk. *Alignment, not conformance.*

### Notes
- Posture is **aligned good practice, not certification**; every compliance doc carries the
  `suite.manifest.json` intended-use disclaimer. Tepna remains "Not a medical device."
- No re-bundle: the version is **not** yet stamped into the offline bundles (deferred — it will ride
  the next behavioral re-bundle, coordinated with OWN-THE-BUILD Part C). `manifestHash` provenance
  and all behavioral gates are unchanged by this release.

---

## [0.9.0] — 2026-07-04 · Owned build, gated docs & discoverability

### Changed
- **Fleet cutover to owned plain-inline bundles** — all 8 apps rebuilt as repo-owned deterministic
  bundles via `tools/build.mjs`; the legacy inliner branch retired (`OWN-THE-BUILD-2026-06-30`,
  Part A cutover 2026-07-03).
- **Registries stay the grade truth; mirrors become gated projections** — `registry-defs-parity`
  gate added so the crossnight `*_DEFS` mirror can't drift (`REGISTRY-PROJECTION-2026-07-04`,
  superseding the `REGISTRY-INVERSION` flip).
- **Clock parser single-sourced** in `clock.js` (`DexClock`), inlined into every bundle; delegating
  DSPs alias it (A5, 2026-07-03).

### Added
- **`docs-ledger` gate** — the brief lifecycle (immutable dated filenames, status headers,
  `Supersedes` symmetry, dashboard coverage, link integrity) machine-checked (`DOCS-LEDGER-GATE-2026-07-03`).
- **Repo discoverability** — front-door link blocks, `sitemap.xml`/`robots.txt`, JSON-LD/`about.json`,
  `llms.txt`, one canonical roster in `suite.manifest.json` (`REPO-DISCOVERABILITY-2026-07-03` + followups).
- **Licensing unification** — Apache-2.0 SPDX headers fleet-wide; **Tepna** product brand adopted
  (frozen `Ganglior` event-bus codename untouched).

---

## [0.8.0] — 2026-07-02 · Fusion fidelity & performance

### Added
- **Integrator three-cornered-hat** — cross-node variance separation for HR/HRV consensus
  (`INTEGRATOR-THREE-CORNERED-HAT-2026-07-02` + followups).

### Changed
- **PpgDex beat detection** rewritten from O(N·lag) autocorrelation to a linear detector; HRV fidelity
  pass (`PPGDEX-BEAT-DETECTION-PERF-AND-HRV-FIDELITY-2026-07-02`).
- Efficiency pass across DSP hot paths (`EFFICIENCY-AUDIT-FIXES-2026-07-01`).

---

## [0.7.0] — 2026-06-30 · Own the build & content-addressed provenance

### Added
- **Owned Node bundler** `tools/build.mjs` + `--check` drift guard; the build stops depending on the
  opaque inliner (`OWN-THE-BUILD-2026-06-30`).
- **Content-addressed provenance** — `manifestHash` becomes the sole executed-code identity; GATE A/B
  in `verify-provenance.html` go pure-static (`SIGNAL-ADAPTER-AND-FRONTIER` Phase 7,
  `PROVENANCE-NONDETERMINISM-2026-06-29`).

### Fixed
- Deep-audit fixes across DSP nullability and render layers (`DEEP-AUDIT-FIXES-2026-06-30`).

---

## [0.6.0] — 2026-06-29 · Provenance determinism & capture host

### Fixed
- **Provenance non-determinism** — `manifestHash` made a deterministic projection of the decompressed
  inlined code, stable across re-bundles of identical source (`PROVENANCE-NONDETERMINISM-2026-06-29`).

### Added
- **Capture-host vision** — the bedside Raspberry Pi that auto-captures, serves, and stores all
  signals overnight (`CAPTURE-HOST-2026-06-29`, vision).

---

## [0.5.0] — 2026-06-28 · Runtime coverage & live-runnability gates

### Added
- **Cross-module runtime coverage** — a render-coverage rig drives real app bundles in an iframe
  (`CROSS-MODULE-RUNTIME-COVERAGE-2026-06-28`).
- **Live-runnability + generic-emit gates** (`GATE-LIVE-RUNNABILITY-2026-06-28`, `GENERIC-EMIT-GATE`).
- **CPAPDex Phase-9** headless DSP + synthetic goldens (`CPAPDEX-PHASE9-FOLLOWUPS`).

---

## [0.4.0] — 2026-06-27 · Export identity & self-ingest

### Added
- **`ganglior.node-export` envelope** unified across nodes with a stamped export identity
  (`EXPORT-IDENTITY-2026-06-27`, `OXYDEX-NODE-EXPORT-ENVELOPE-2026-06-27`).
- **Self-ingest** — nodes re-read their own exports for cross-night accumulation (`SELF-INGEST-2026-06-27`).

### Changed
- Export hygiene: host-emit allowlist, volatile-field stripping (`EXPORT-HYGIENE-2026-06-27`,
  `HOST-EMIT-ALLOWLIST-2026-06-27`).

---

## [0.3.0] — 2026-06-25 · Headless DSP (Signal-Adapter Phase-9)

### Changed
- **Reading split from computing** across the fleet — each `*-dsp.js` exposes a DOM-free `compute()`
  so the DSP runs headless in Node CI, not just the browser (`SIGNAL-ADAPTER-PHASE9-REMAINING-NODES-2026-06-25`
  and the `SIGNAL-ADAPTER-FOLLOWUPS` series).

---

## [0.2.0] — 2026-06-24 · Evidence badges & signal-adapter architecture

### Added
- **5-level evidence ladder** (measured · validated · emerging · experimental · heuristic) with a
  single-source badge engine and the `cohesion-badges` gate (`BADGE-COVERAGE-AUDIT`,
  `BADGE-PLACEMENT-SWEEP-2026-06-24`).
- **Signal-adapter frontier** — vendor files routed to nodes through pluggable adapters
  (`SIGNAL-ADAPTER-AND-FRONTIER-2026-06-23`).
- **Synthetic corpus texture** — broadband-1/f RR generation for realistic test nights (`SYNTH-TEXTURE-2026-06-24`).

### Changed
- Metric vocabulary cleanup; unified desaturation-event + SDNN primitives (`DEX-EVENT-UNIFY-AND-CSV`,
  `DEX-METRIC-REMOVAL-AUDIT`).

---

## [0.1.0] — 2026-06-23 · Foundations

### Added
- **The shared spine** — `kernel-constants.js`, the **Ganglior** event bus, the Clock Contract, and
  the per-node analyzers: OxyDex, PulseDex, HRVDex, GlucoDex, ECGDex, PpgDex, CPAPDex, and the
  **Integrator** fusion layer (`KERNEL-BUILD`, per-node `*-BUILD` briefs, `INTEGRATOR-BUILD`).
- **The shared test suite** (`Dex-Test-Suite.html` + `tests/dex-tests.js`) and the build/provenance
  manifests.

[Unreleased]: https://github.com/Plantucha/Tepna/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Plantucha/Tepna/releases/tag/v1.0.0
