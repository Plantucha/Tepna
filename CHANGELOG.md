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

## [1.5.0] — 2026-07-12

### Changed
- Run the `biome` gate on push to `main` as well as on PRs — a whole-tree Biome lint floor on push (mirroring `tests`/`types`/`no-network`), restoring the on-push lint coverage the retired eslint shim provided, now under the `biome` check name. PRs keep the changed-files `biome ci --changed` format+lint.
- Delete the `lint.yml` compatibility shim now that the `main` Ruleset no longer requires an `eslint` status check — Biome (`format.yml`) is the sole formatter+linter, no ESLint anywhere. (`BIOME-FORMATTER-2026-07-11-BRIEF.md`)

### Fixed
- Arbitrate the PPI spine by Malik correction rate — foot-to-foot vs the 3-LED-voted peak spine — fixing optical HR that read 2–3× true when `pickChannel` selects a harmonic-counting LED as the reference.

---

## [1.4.0] — 2026-07-11

### Security
- Drop `'unsafe-inline'` from every bundle's CSP `script-src` in favour of per-block `sha256` hashes computed by the owned bundler, so an injected `<script>` no longer executes (CSP is now an injection backstop, not just the `connect-src 'none'` egress control); all ~167 inline `on*=` handlers are converted to a shared event-delegation dispatcher (`dex-actions.js`, `data-act`) — `style-src` deliberately keeps `'unsafe-inline'` (non-goal). (`SECURITY-CSP-STRICT-SCRIPT-SRC-2026-07-11-BRIEF.md`)

---

## [1.3.0] — 2026-07-11

### Added
- Port the ESLint control-flow/dead-code floor into Biome (`biome.json` `linter.rules`) so `format.yml`'s `biome ci --changed` now enforces format + lint on changed files (0 errors on the current tree, parity-verified); ESLint stays running in parallel this cycle until it's retired (Phase 3 step 2). (`BIOME-FORMATTER-2026-07-11-BRIEF.md`)

### Changed
- Retire ESLint (`lint.yml` + `.eslintrc.json` + the `npx eslint` script) now that Biome carries the same control-flow/dead-code floor with proven parity — `npm run lint` and `format.yml` are the sole lint gate; one pinned tool does format + lint (BIOME-FORMATTER Phase 3 step 2). (`BIOME-FORMATTER-2026-07-11-BRIEF.md`)

### Security
- Add a browser-enforced Content-Security-Policy to every bundle (connect-src 'none'/'self' — F7) and suite-wide storage hygiene on top of v1.2.0's Phase A: drop the raw-recording localStorage cache (F4), a shared "erase all data on this device" control clearing every key + the Integrator IndexedDB (F5), and migrate() now deletes the legacy profile keys it folds (F6). (`SECURITY-REMEDIATION-2026-07-11-BRIEF.md`)
- Extend the erase-all control (dex-forget.js): also wipe the standalone analysis pages' checkpoint keys + IndexedDB (§2), and mount the control in CPAPDex + the Integrator, which own longitudinal data but don't render the shared profile panel (§3). Strict nonce/hash script-src (§1) assessed and deferred — infeasible without a fleet-wide inline-event-handler refactor. (`SECURITY-REMEDIATION-FOLLOWUPS-2026-07-11-BRIEF.md`)

---

## [1.2.0] — 2026-07-11

### Added
- Add Biome as a check-only, changed-files-only code formatter (`biome.json` tuned to the house style, pinned `@biomejs/biome` devDependency + lockfile, `format.yml` CI sibling) — no shipped file reformatted, provenance untouched. (`BIOME-FORMATTER-2026-07-11-BRIEF.md`)

### Security
- Escape untrusted filenames/errors at the OxyDex + PulseDex innerHTML sinks (F1/F2/F3) via one shared dex-escape.js — a crafted `<img onerror>` capture name renders as inert text; display-only, EXPORT-INERT re-bundle (also folds on-touch Biome formatting of the touched files, BIOME-FORMATTER Phase 2). (`SECURITY-REMEDIATION-2026-07-11-BRIEF.md`)

---

## [1.1.1] — 2026-07-11

### Added
- Add the ML-TCH / Groslambert-covariance estimator bake-off harness (tools/tch-estimator-bakeoff.mjs); result is a recorded negative — no HR-only candidate beats the min-ρ clamp at N=3, so integrator-tch.js is left unchanged. (`INTEGRATOR-TCH-ML-ESTIMATOR-2026-07-11-BRIEF.md`)

---

## [1.1.0] — 2026-07-11

### Added
- Add the DSP reach-in allow-list gate (DEV-TOOLCHAIN Part A · A4, folding in SIGNAL-ADAPTER-FOLLOWUPS-IV §1) — a source-text house-lint in `tests/dex-tests.js` that scrubs comments/strings/regex with a real char-scanner, then asserts each `*-dsp.js` calls only {self · kernel · own `*-util` · builtins · documented reach-ins}; oxydex/hrvdex render-path reach-ins are allow-listed as a named drift-ledger for the next on-touch re-bundle. Test-layer only, no re-bundle, provenance untouched. (`DEV-TOOLCHAIN-2026-06-30-BRIEF.md`)
- Add the root `package.json` dev-tooling spine — a private, unpublished manifest (no runtime deps, ships nothing) that unifies `tools/build.mjs`, the pinned `tsc`/ESLint tools, and the gate runners under one `npm run` surface (`check`/`test`/`typecheck`/`lint`/`build*`/`verify:manifest`/`gen:lists`/`release`); the four CI workflows now route through those scripts so each command has a single source, and browser-gates no longer `npm init -y` over the committed manifest. (`DEV-TOOLCHAIN-2026-06-30-BRIEF.md`)
- Teach `tools/release.mjs` to maintain the CHANGELOG's reference-style compare links (F6): on each release it advances `[Unreleased]` to compare from the new tag and inserts a `[x.y.z]: …/compare/v{prev}...v{new}` line, leaving the oldest `releases/tag` link intact — repo base derived from the existing `[Unreleased]` link (no hard-coded URL), idempotent on re-run. (`CONTROLLED-RELEASES-FOLLOWUPS-2026-07-05-BRIEF.md`)
- Project the canonical suite version into the discovery surfaces and make the release-ledger check-6 stamp-parity gate non-vacuous (F2/F3/F4): stamp `softwareVersion` into index.html + docs/index.html JSON-LD (and a visible footer `v`), `docs/about.json` (+ build-docs `buildAbout`), and a `**Suite version:**` marker in README; add a build-docs Phase 3 that projects `suite.manifest.json` version into those surfaces (idempotent, updates markers in place); teach `release.mjs` to stamp `CITATION.cff`; and feed each surface's raw text into `env.releaseLedger.surfaceTexts` from both runners so check-6 extracts (single-sourced) and reds on a version mismatch OR a removed marker. (`CONTROLLED-RELEASES-FOLLOWUPS-2026-07-05-BRIEF.md`)
- ECG Splitter gains a folder-batch mode — drop a capture folder, group files into recording nights, bulk-split oversized ECG/PPG waveforms, and run an off-thread signal check (production Pan–Tompkins / 3-LED detectors in a Web Worker) reusing the trio-experiment folder-ingest + worker-DSP patterns. (`TRIO-METHODS-REUSE-2026-07-06-BRIEF.md`)
- Add a decorrelation quality gate to the Integrator three-cornered hat — drop a node that decorrelates from both peers before the solve, so a failed extraction can't contaminate every per-sensor σ. (`TRIO-METHODS-REUSE-2026-07-06-BRIEF.md`)
- Add a reproducible multi-night three-cornered-hat A/B harness (tools/tch-multinight.mjs) with a known-answer synthetic corpus, plus literature- and sensor-anchored σ validation (docs §7–§9). (`INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III-2026-07-06-BRIEF.md`)

### Changed
- Route OxyDex and HRVDex readiness sub-score value tiles through the evidence-badge path (badge-by-construction, OWN-THE-BUILD Part C) — the badge now leads the value, and both render files join the enforced `badge-enforced` set so a number can't reach the DOM ungraded. (`OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md`)
- Enforce badge-by-construction on `integrator-render.js` (OWN-THE-BUILD Part C) — it is already compliant (its `kpi()` tile leads with `evBadge()`), so it joins `BADGE_ENFORCED` test-only with no re-bundle, and is wired into `env.sources` in both runners; the badge gate now reds if any fusion-layer value tile is emitted unbadged. Remaining Part C render/app/profile files await their next on-touch re-bundle. (`OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md`)
- Flip release-ledger check-7 to a HARD gate (F8, `HARD7=true`) — un-recorded code movement now BLOCKS instead of shipping informational. Adoption is real: the 1.0.0 snapshot was reconfirmed consistent against BUILD-MANIFEST (5 unmoved bundles byte-match; the 3 moved — OxyDex/HRVDex/Integrator — are exactly the changeset-covered set), so the gate is green with zero false positives. (`CONTROLLED-RELEASES-FOLLOWUPS-2026-07-05-BRIEF.md`)

### Fixed
- Align cross-node three-cornered-hat epochs on absolute wall-clock instead of node-relative tMin (fixes σ² inflation and culprit mis-ranking on staggered-start co-recordings; same-start nights stay byte-identical); surface the HR-hat per-sensor error card + reconciled HR, and flag quiet-sensor order uncertainty. (`INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-II-2026-07-04-BRIEF.md`)
- Correct stale crossnight `*_DEFS` metadata to the registry truth — OxyDex mean-SpO₂/mean-HR and CPAPDex residual-AHI/central-index/usage-hours graded `measured` (not `validated`), CPAPDex usage-hours label "Usage Hours" and PpgDex Perfusion-Idx/Motion-rejected labels — regenerating the CPAPDex multi-night golden; every shared-id field is now hard-gated by the registry↔_DEFS parity check (REGISTRY-PROJECTION Phase 2). (`REGISTRY-PROJECTION-2026-07-04-BRIEF.md`)
- Badge-by-construction Part C — every remaining bare metric-value tile now leads with an evidence badge (ecgdex/ppgdex/glucodex-app, cpapdex-render, pulsedex-overview, hrvdex-app, ecgdex/glucodex/ppgdex-profile); all nine join BADGE_ENFORCED and the six affected bundles were re-bundled (export-inert, fixtures re-stamped). (`OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md`)
- Re-texture the synthetic RR generator (synth-gen 2.1 / cohort-gen 1.9), rerun all six sim papers, and re-bundle the six apps that inline synth-gen.js. (`SYNTH-TEXTURE-PAPERS-RERUN-FOLLOWUPS-2026-07-07-BRIEF.md`)

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

[Unreleased]: https://github.com/Plantucha/Tepna/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/Plantucha/Tepna/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/Plantucha/Tepna/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/Plantucha/Tepna/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Plantucha/Tepna/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/Plantucha/Tepna/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Plantucha/Tepna/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Plantucha/Tepna/releases/tag/v1.0.0
