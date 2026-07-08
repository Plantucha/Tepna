<!--
  CONTROLLED-RELEASES-FOLLOWUPS-2026-07-05-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->

**Status:** DONE — 2026-07-06 (**F2/F3/F4/F6 + F8 EXECUTED** · F5 decided · F7 verified-closed; **F1 formally re-deferred** — version-into-bundle rides the next behavioral re-bundle, tracked in `CLAUDE.md` §📦 + the OWN-THE-BUILD sequencing) · **Created:** 2026-07-05

> **⟳ EXECUTION NOTE (2026-07-06 · pt 2) — F8 EXECUTED, F1 re-deferred → brief DONE (test-only, NO re-bundle).**
> - **F8 · check-7 flipped to a HARD gate** (`HARD7=true`, one line in `tests/dex-tests.js`). Un-recorded code
>   movement now BLOCKS. **Snapshot reconfirmed:** the 1.0.0 `manifestHashes` snapshot is consistent with the
>   current `BUILD-MANIFEST.json` — 5 bundles (PpgDex/PulseDex/ECGDex/GlucoDex/CPAPDex) byte-match the snapshot,
>   and the only 3 that moved (OxyDex 69a51c03e025→43bd047b12e8 · HRVDex 97dd26f6db4a→6b43574be1ea · Integrator
>   62da4f43db2a→cef329a4fec6) are EXACTLY the changeset-covered post-1.0.0 set (badge-by-construction +
>   integrator-tch). So the hard gate is green with zero false positives (`check7 · moved: OxyDex, HRVDex,
>   Integrator — 8 changeset(s) pending`). The RELEASE-MANIFEST snapshot was NOT hand-edited (append-only
>   history; the gate itself validated its consistency). Changeset `changes/2026-07-06-release-check7-hard-gate-f8.md`.
> - **F1 · version-INTO-bundle — formally RE-DEFERRED (not executed), by its own rule.** Stamping the version
>   into the 8 bundles + adding `producer.suiteVersion` to `ganglior.node-export` REQUIRES re-bundling the fleet
>   (and the export-field addition regenerates every fixture — a MINOR contract change). The brief's own guidance
>   is *"Do NOT re-bundle 8 apps just for this — let it ride the next behavioral re-bundle"*, and adding the stamp
>   to `build-core.js` without re-bundling would drift every bundle's `--check`. So F1 is handed to the build-owner
>   track: it rides the next behavioral re-bundle, tracked in `CLAUDE.md` §📦 ("Version-into-bundle stamping is
>   DEFERRED") + `OWN-THE-BUILD-FOLLOWUPS` F1/F2 sequencing. This satisfies the F1 Done-when's "or explicitly
>   re-deferred with a reason" branch. **NOTE: version-into-bundle did NOT ship — do not read this DONE as F1 built.**
>
> **Gate posture:** `Dex-Test-Suite.html` headless floor all-green (1964 passed / 2 skipped / 127 groups); NO app
> re-bundled this whole brief → `verify-provenance.html` untouched.

> **⟳ EXECUTION NOTE (2026-07-06) — F2 + F3 + F4 landed (test/doc/tooling layer, NO re-bundle).** The
> release-ledger check-6 stamp-parity gate is now **non-vacuous**:
> - **F2 · version projected into the discovery surfaces.** `softwareVersion: "1.0.0"` added to the
>   `index.html` + `docs/index.html` JSON-LD (and a visible footer `· v1.0.0`), to `docs/about.json`
>   (and `tools/build-docs.mjs buildAbout()` so regens keep it), and a visible `**Suite version:** 1.0.0`
>   marker in `README.md`. New **`build-docs.mjs` Phase 3** projects `suite.manifest.json` version into
>   README + both index.html twins — **idempotent, updates a marker's number in place, never inserts one**
>   (a surface that lost its marker stays lost so check-6 reds it). Verified idempotent: each rule hits its
>   marker exactly once, zero drift at 1.0.0 (so `build-docs --check` is clean).
> - **F3 · check-6 made non-vacuous.** Both runners now pass the RAW text of each version-carrying surface
>   in `env.releaseLedger.surfaceTexts` (`run-tests.mjs readReleaseLedger` via fs · `Dex-Test-Suite.html`
>   via fetch); extraction is **single-sourced in `tests/dex-tests.js`** (CITATION YAML · JSON-LD/JSON
>   `softwareVersion` · README marker) so the two lanes can't drift. A listed surface whose marker is
>   missing is `unstamped` → RED; a version ≠ canonical is `mismatch` → RED. All four extract to `1.0.0`
>   == canonical → green.
> - **F4 · `CITATION.cff` stamped by `release.mjs`.** New step 1b updates its `version:` in place on every
>   release (it already carried 1.0.0); it is one of the four gated surfaces.
> - **F6 · CHANGELOG compare-links maintained.** `release.mjs` step 3b rewrites the reference-link foot on
>   each release: `[Unreleased]` advances to `compare/v{to}...HEAD` and a `[{to}]: …/compare/v{from}...v{to}`
>   line is inserted, the oldest `releases/tag` link left intact. Repo base is derived from the existing
>   `[Unreleased]` link (no hard-coded URL) and the insert is idempotent (verified on the real file for two
>   consecutive releases + a same-release re-run).
> - **No app re-bundled; provenance untouched.** Changesets `changes/2026-07-06-release-version-surfaces-f2-f3-f4.md`
>   + `changes/2026-07-06-release-changelog-compare-links-f6.md`.
>   **Still carried:** F1 (version INTO bundles — rides the next behavioral re-bundle) and F8 (flip check-7
>   `HARD7=true` + reconfirm the 1.0.0 snapshot — waits on Part-C settle + fleet changeset adoption).

> **⟳ EXECUTION NOTE (2026-07-05).** Actioned the zero-tooling items + closed the governance loop for this
> session's re-bundles:
> - **Changeset hygiene (the changes/README.md “drop a changeset as your last action” rule).** This session
>   moved provenance `manifestHash`es (OxyDex + HRVDex via OWN-THE-BUILD Part C; Integrator via
>   INTEGRATOR-TCH-FU-II §1/§3/§5). Dropped two well-formed changesets —
>   `changes/2026-07-05-badge-by-construction-oxydex-hrvdex.md` (patch/changed) +
>   `changes/2026-07-05-integrator-tch-wallclock-align.md` (patch/fixed) — and regenerated
>   `tests/changes-list.json` (3 pending). `release-ledger` check5/check7 + staleness all green.
> - **F5 — DECIDED (no retroactive v0.x tags).** Per the recommendation below: pre-1.0.0 history stays a
>   `CHANGELOG.md` reconstruction, **not** git tags (they would imply releases that never happened). Tag only
>   from `v1.0.0` forward. Policy closed.
> - **F7 — VERIFIED-CLOSED.** `CHANGELOG.md`, `RELEASE-MANIFEST.json`, and all 7 `docs/COMPLIANCE/*.md` are
>   present in the docs-ledger path inventory (`tests/docs-ledger-list.json`), so DOCS-INDEX links to them
>   resolve under the whole-tree link gate. No action needed.
> - **Carried (blocked here):** F1 (version-into-bundle) + F6 (`release.mjs` changelog links) need the Node
>   build/release tooling; F2/F3 (docs propagation + non-vacuous check 6) need `node tools/build-docs.mjs`;
>   F4 (`CITATION.cff` sync) is a `release.mjs` edit; F8 (flip check 7 HARD + reconfirm the 1.0.0 snapshot)
>   waits on Part-C settle + fleet changeset adoption — and MUST re-confirm the snapshot before flipping
>   (this session moved OxyDex/HRVDex/Integrator hashes).

# Controlled-releases follow-ups — deferred + surfaced-during-execution

> Residue from executing `CONTROLLED-RELEASES-2026-07-05-BRIEF.md` (the release-governance layer:
> suite SemVer, `CHANGELOG.md`, `RELEASE-MANIFEST.json`, the changeset flow, the `release-ledger`
> gate, and the `docs/COMPLIANCE/` set — all landed, no re-bundle). Everything here was **deliberately
> deferred** to stay collision-safe with the concurrent **OWN-THE-BUILD Part C** and **docs-ledger
> follow-up** coders, or surfaced during execution. Coordinate the re-bundle items with the build
> owner. Priorities as marked.

## Deferred by design (from the parent brief)

- **F1 · Version stamp INTO bundles (MED · re-bundle · Phase 5).** Extend the owned build
  (`tools/build.mjs`, Part C territory) to stamp `suite.manifest.json` `version` into each bundle
  (display "Tepna vX.Y.Z" offline) and add `producer.suiteVersion` to `ganglior.node-export`
  (backwards-compatible additive field → MINOR). Then update `BUILD-MANIFEST.json` + regenerate the
  touched fixtures per `CLAUDE.md` §🔏. **Do NOT re-bundle 8 apps just for this** — let it ride the next
  behavioral re-bundle. Adding `producer.suiteVersion` is a published-contract addition; sequence it
  with a node's next real change.

- **F2 · Version propagation to docs/deploy surfaces (LOW · no re-bundle).** Extend
  `tools/build-docs.mjs` to project `suite.manifest.json` `version` into README, `index.html` JSON-LD,
  `docs/about.json`, and the footer of the served pages (it already reads `suite.manifest.json` for the
  roster). Deferred to avoid colliding with the in-flight discoverability/build tooling. When it lands,
  wire those surfaces into the gate's **check 6** (`versionedSurfaces`) so stamp-parity stops being
  vacuous.

- **F3 · `release-ledger` check 6 strengthening (LOW).** Currently a reserved pass ("no propagated
  surface yet"). Once F2 lands, feed each surface's declared version into `env.releaseLedger.versionedSurfaces`
  from both runners and assert equality with the canonical version.

## Surfaced during execution

- **F4 · `CITATION.cff` version sync (LOW).** `CITATION.cff` carries its own `version:` field. Decide
  whether `tools/release.mjs` should also stamp it (and add it to check 6 stamp-parity). Recommended:
  yes — it is a release-identity surface an academic citation pins.

- **F5 · Reconstructed 0.x waves — retroactive git tags? (LOW · decision).** `CHANGELOG.md` reconstructs
  pre-1.0.0 history from the DONE brief corpus and labels it "not formally cut." **Recommendation: do
  NOT** assign retroactive `v0.x` git tags (they would imply releases that never happened) — tag only
  from `v1.0.0` forward. Record the owner's decision here and close.

- **F6 · `release.mjs` CHANGELOG reference-link maintenance (LOW).** The script prepends the version
  section but does not update the reference-style compare links at the file foot
  (`[Unreleased]`/`[x.y.z]:`). Cosmetic; either teach the script to rewrite them or drop them. Low
  priority — the gate does not read them.

- **F7 · Docs-ledger F2 interaction (COORDINATION).** The docs-ledger coder's whole-tree link-integrity
  work (`fsPaths`/`listedPaths`) now inventories the repo; the new `docs/COMPLIANCE/` files + root
  `CHANGELOG.md`/`RELEASE-MANIFEST.json` must appear in whatever generated path list that gate settles
  on. Confirm with that coder that the inventory regen includes them (Node-lane only; the browser gate
  is unaffected).

- **F8 · Flip `release-ledger` check 7 to a HARD gate (MED · after adoption).** Check 7 ships
  **informational** (`HARD7=false` in `tests/dex-tests.js`) so it does not red on OWN-THE-BUILD Part C's
  in-flight re-bundles (coders who moved a `manifestHash` before the changeset flow existed). Once the
  fleet has adopted the changeset habit AND Part C has settled, flip `HARD7=true` (one line) so
  un-recorded code movement blocks. **Re-confirm the 1.0.0 `manifestHashes` snapshot** against the
  settled `BUILD-MANIFEST.json` at the same time — it was captured mid-Part-C (OxyDex/PpgDex/CPAPDex
  hashes moved during execution and were synced best-effort).

## Done when

- ☑ F5 decision recorded (no retroactive `v0.x` tags — tag from `v1.0.0` forward).
- ☑ F7 verified-closed (COMPLIANCE + CHANGELOG + RELEASE-MANIFEST already in the docs-ledger inventory).
- ☑ **F1 formally re-deferred (2026-07-06)** — version-into-bundle rides the next behavioral re-bundle (its own
  rule: don't churn 8 apps for a version string); handed to the build-owner track (`CLAUDE.md` §📦 + OWN-THE-BUILD
  F1/F2). NOT built — re-deferred with reason, the sanctioned branch of this item.
- ☑ **F2 + F3 landed together (2026-07-06)** — version projected into README/index.html/docs/about.json
  (+ build-docs Phase 3), fed to both runners via `surfaceTexts`, check-6 non-vacuous (single-sourced
  extraction, reds on mismatch OR removed marker). No re-bundle.
- ☑ **F4 decided + wired (2026-07-06)** — `release.mjs` stamps `CITATION.cff` (step 1b); it is a gated check-6 surface.
- ☑ **F6 closed (2026-07-06)** — `release.mjs` step 3b maintains the CHANGELOG reference compare-links (advances `[Unreleased]`, inserts `[x.y.z]: …/compare/v{prev}...v{new}`, repo base derived from the existing link, idempotent).
- ☑ **F8 executed (2026-07-06)** — check-7 flipped to HARD (`HARD7=true`); 1.0.0 snapshot reconfirmed consistent
  against BUILD-MANIFEST (5 unmoved byte-match; 3 moved = OxyDex/HRVDex/Integrator, all changeset-covered). Green.

## Cross-references
- `CONTROLLED-RELEASES-2026-07-05-BRIEF.md` — the parent (Phases 1–4 executed 2026-07-05).
- `CLAUDE.md` §📦 (release governance) · §🔏 (provenance/re-bundle economics).
- `briefs/OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md` — the build-owner track F1/F2 must sequence with.
- `docs/COMPLIANCE/SOFTWARE-RELEASE-PROCEDURE.md` — the SOP the stamp/propagation items feed.
