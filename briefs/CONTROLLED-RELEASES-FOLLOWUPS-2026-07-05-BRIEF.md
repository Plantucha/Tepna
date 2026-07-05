<!--
  CONTROLLED-RELEASES-FOLLOWUPS-2026-07-05-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->

**Status:** PROPOSED · **Created:** 2026-07-05

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

- ☐ F1 executed on the next behavioral re-bundle (or explicitly re-deferred with a reason).
- ☐ F2 + F3 landed together (propagation + non-vacuous check 6), coordinated with the build/docs owner.
- ☐ F4 decided + (if yes) wired into `release.mjs` + check 6.
- ☐ F5 decision recorded; tags policy stated once.
- ☐ F6/F7 closed or explicitly carried.
- ☐ F8: check 7 flipped to HARD once adopted; 1.0.0 snapshot reconfirmed post-Part-C settle.

## Cross-references
- `CONTROLLED-RELEASES-2026-07-05-BRIEF.md` — the parent (Phases 1–4 executed 2026-07-05).
- `CLAUDE.md` §📦 (release governance) · §🔏 (provenance/re-bundle economics).
- `briefs/OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md` — the build-owner track F1/F2 must sequence with.
- `docs/COMPLIANCE/SOFTWARE-RELEASE-PROCEDURE.md` — the SOP the stamp/propagation items feed.
