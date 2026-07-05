<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Software Lifecycle Plan — Tepna (IEC 62304 / ISO 13485 aligned)

**Status:** REFERENCE (living) · **last-verified:** 2026-07-05 · Owner: Michal Planicka

> **Intended use (non-device).** Tepna is for personal self-quantification. It is **not a medical
> device; it does not diagnose, treat, cure, or prevent any condition** (`suite.manifest.json`
> `intendedUse`). This document adopts the *disciplines* of IEC 62304 and ISO 13485 as good
> engineering practice. It is an **alignment** artifact and makes **no claim of certification or
> regulatory conformance.** If a regulated product is ever pursued, this plan is the foundation it
> would extend — it is deliberately not a substitute for a certified QMS.

This is the umbrella of the `docs/COMPLIANCE/` set. It states the posture, the versioning semantics,
and a clause-by-clause crosswalk from the standards to where each activity actually lives in the
repo. Companion documents: `SAFETY-CLASSIFICATION.md`, `CONFIGURATION-MANAGEMENT-PLAN.md`,
`SOUP-LIST.md`, `SOFTWARE-RELEASE-PROCEDURE.md`, `DOCUMENT-CONTROL.md`.

## 1 · Lifecycle model

Tepna is developed **brief-by-brief** (`CLAUDE.md` §📌): each unit of work is a dated, immutable
brief with a status header and a `Supersedes`/`Superseded-by` chain, indexed in `DOCS-INDEX.md` and
gated by the `docs-ledger` group. Every contract that matters is **construction-enforced** by a
red/green gate rather than remembered (`ARCHITECTURE-PRINCIPLES.md §7`): the evidence ladder, the
export schema, code identity (`manifestHash`), the doc lifecycle, and — as of
`CONTROLLED-RELEASES-2026-07-05` — the release layer. Verification and release are only ever done
from an all-green tree.

## 2 · Versioning semantics (the SemVer contract)

One suite SemVer (`suite.manifest.json` `version`) is the release identity. Bump levels are defined
against Tepna's **published contracts** so the level is objective, not a judgement call:

- **MAJOR** — a breaking change to a published contract: the `ganglior.node-export` schema, the Clock
  Contract, the `ganglior.crossnight` envelope, a metric's identity/units/`goodDirection`, or the
  removal of a node.
- **MINOR** — a backwards-compatible capability: a new node, metric, adapter, gate, or additive
  export field.
- **PATCH** — a bug/accuracy fix that changes no contract shape. A numeric-output change that moves a
  fixture's known-answer is still PATCH unless it alters a metric's identity/units — but it MUST
  regenerate fixtures per `CLAUDE.md` §🔏.

Three identity layers coexist and must not be conflated: the **release** (one SemVer), each **code
item** (a bundle's `manifestHash`, content-addressed), and each **document** (an independently
revisioned brief/spec). See `CONFIGURATION-MANAGEMENT-PLAN.md`.

## 3 · IEC 62304 clause crosswalk

| Clause | Activity | Where it lives in Tepna | Status |
|---|---|---|---|
| 5.1 | Development planning | This plan; `CLAUDE.md`; `ARCHITECTURE-PRINCIPLES.md` | ✅ aligned |
| 5.2 | Software requirements | Per-node Reference guides + `*-registry.js` (metric defs, evidence grades) | ◐ partial — no standalone SRS |
| 5.3 | Architecture | `ARCHITECTURE-PRINCIPLES.md`, `Architecture.html` (three layers, downhill deps) | ✅ aligned |
| 5.4 | Detailed design | The brief corpus + inline source design notes | ✅ aligned |
| 5.5 | Implementation | External `*-dsp/render/app.js` + SPDX headers | ✅ aligned |
| 5.6 | Integration & integration testing | `Dex-Test-Suite.html` render-coverage (drives real bundles) | ✅ aligned |
| 5.7 | System testing | `Dex-Test-Suite.html` + `verify-provenance.html` + `no-network.html` | ✅ aligned |
| 5.8 | **Software release** | `SOFTWARE-RELEASE-PROCEDURE.md`; `RELEASE-MANIFEST.json`; reproducibility via `verify-provenance.html` | ✅ aligned |
| 6 | Maintenance process | Brief lifecycle + changesets + `CHANGELOG.md` | ✅ aligned |
| 7 | Risk management | `SAFETY-CLASSIFICATION.md` (Class A rationale + hazard reasoning) | ◐ partial — no full ISO 14971 risk file |
| 8 | Configuration management | `CONFIGURATION-MANAGEMENT-PLAN.md`; `BUILD-MANIFEST.json`; `FIXTURE-PROVENANCE.json`; `release-ledger` + `docs-ledger` gates | ✅ aligned |
| 8.3 | Configuration status accounting | `CHANGELOG.md` + `RELEASE-MANIFEST.json` | ✅ aligned |
| 9 | Problem resolution | Audits + follow-up briefs (`AUDIT-PROMPT.md`, `*-FOLLOWUPS` briefs) | ◐ partial — no formal CAPA log |
| 5.3.3 / 8.1.2 | SOUP identification | `SOUP-LIST.md` (runtime SOUP empty by design) | ✅ aligned |

## 4 · ISO 13485 clause crosswalk (documentation subset)

| Clause | Activity | Where it lives | Status |
|---|---|---|---|
| 4.2.3 | Medical device file | The repo + `DOCS-INDEX.md` as the map (analogue) | ◐ partial — not a formal DMR/DHF |
| 4.2.4 | Control of documents | `DOCUMENT-CONTROL.md`; brief lifecycle; `docs-ledger` gate | ✅ aligned |
| 4.2.5 | Control of records | `RELEASE-MANIFEST.json`; provenance ledgers; git history | ✅ aligned |
| 7.3 | Design & development | `ARCHITECTURE-PRINCIPLES.md` + brief corpus | ◐ partial |

**Honesty rule:** the ◐ rows are genuine gaps, recorded as gaps — not painted green. Alignment means
adopting the practice, not claiming the certificate.

## 5 · Change control for this document set

These are controlled documents (`DOCUMENT-CONTROL.md`): edit in place, keep the `last-verified` date
current, and record substantive changes through a changeset + `CHANGELOG.md` like any other work-unit.
