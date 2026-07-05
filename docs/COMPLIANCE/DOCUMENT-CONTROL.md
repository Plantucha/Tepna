<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Document & Record Control — Tepna (ISO 13485 §4.2.4 / §4.2.5)

**Status:** REFERENCE (living) · **last-verified:** 2026-07-05 · Owner: Michal Planicka

> **Intended use (non-device).** Not a medical device; does not diagnose, treat, cure, or prevent any
> condition. Alignment artifact — no conformance claim.

Tepna's document discipline already implements the substance of ISO 13485 document + record control.
This is the crosswalk showing where each requirement is met — and, importantly, that it is
**gate-enforced**, not merely policy.

## §4.2.4 — Control of documents

| Requirement | How Tepna meets it |
|---|---|
| Documents identified | Every brief/spec has a unique, **immutable dated filename** (`<NAME>-YYYY-MM-DD-BRIEF.md`); the filename is set once at creation and never changes (it is a stable cross-reference target). |
| Reviewed & approved before issue | Briefs are `PROPOSED` → executed → flipped to `DONE — <date>` only on verified completion (all gates green). The owner approves via the DONE stamp + commit. |
| Changes reviewed & re-approved | A change spawns a new dated brief and/or a follow-up brief; supersession is explicit via `Superseded-by:`/`Supersedes:` header links. |
| Current revision status identifiable | The status header (`PROPOSED`/`IN-PROGRESS`/`DONE — date`/`REFERENCE`/`CHECKPOINT`) + `DOCS-INDEX.md` at-a-glance table. |
| Relevant versions available at point of use | `DOCS-INDEX.md` is the single dashboard; every brief is linked from it. |
| Obsolete documents controlled | Truly-dead docs move to `docs-archive/` with a redirect stub; superseded briefs stay in place with a `Superseded-by` link (never deleted — preserves git history + cross-references). |
| **Enforcement** | The **`docs-ledger` gate** (`tests/dex-tests.js`, both runners) reds on a missing/malformed status header, an unindexed brief, a dead dashboard link, a one-sided supersede link, a stray root brief, or a filename↔`Created` date mismatch. Document control is thus **machine-checked**, not remembered. |

## §4.2.5 — Control of records

| Requirement | How Tepna meets it |
|---|---|
| Records establish conformity | `RELEASE-MANIFEST.json` (what shipped in each version + `manifestHash` snapshot); `FIXTURE-PROVENANCE.json` (known-answer reproducibility); `BUILD-MANIFEST.json` (code identity). |
| Legible, identifiable, retrievable | Committed JSON + `CHANGELOG.md` in the repo; git history is the immutable record store. |
| Retention & protection | Version control (git) with tags per release (`v<version>`); records are append-only ledgers. |
| **Enforcement** | The **`release-ledger` gate** asserts the records agree (version ↔ history ↔ changelog, unique/increasing versions, code-movement ↔ changeset). |

## Controlled-document register (this set)

The `docs/COMPLIANCE/` set are themselves controlled documents. Each carries an SPDX header, a
`Status: REFERENCE (living)` header with a `last-verified` date, and the non-device disclaimer. They
are edited in place; substantive changes flow through a changeset + `CHANGELOG.md`.

| Document | Clause focus |
|---|---|
| `SOFTWARE-LIFECYCLE-PLAN.md` | 62304 §5.1 + the clause crosswalk |
| `SAFETY-CLASSIFICATION.md` | 62304 §4.3 |
| `CONFIGURATION-MANAGEMENT-PLAN.md` | 62304 §8 |
| `SOUP-LIST.md` | 62304 §5.3.3 / §8.1.2 |
| `SOFTWARE-RELEASE-PROCEDURE.md` | 62304 §5.8 |
| `DOCUMENT-CONTROL.md` | 13485 §4.2.4 / §4.2.5 (this document) |
