<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Configuration Management Plan — Tepna (IEC 62304 §8)

**Status:** REFERENCE (living) · **last-verified:** 2026-07-05 · Owner: Michal Planicka

> **Intended use (non-device).** Not a medical device; does not diagnose, treat, cure, or prevent any
> condition. Alignment artifact — no conformance claim.

## 1 · Configuration items (§8.1)

The controlled items and their unique identification:

| Item class | Items | Identity |
|---|---|---|
| Executed code | the 8 bundles (`OxyDex.html` … `Integrator.html`) | **`manifestHash`** — a deterministic content hash of the decompressed inlined JS/CSS (`BUILD-MANIFEST.json`) |
| Source | `*-dsp/render/app.js`, `*.src.html`, shared `*.js`, `*.css` | git object identity + SPDX header |
| Contracts / data | `ganglior.node-export`, `ganglior.crossnight`, fixtures | schema `name`+version; `FIXTURE-PROVENANCE.json` content-addressed triples |
| Documents | briefs, specs, these plans, references | immutable dated filename + status header + `Supersedes` chain |
| Release | the suite as a whole | **one SemVer** (`suite.manifest.json` `version`) |

The three identity layers (release SemVer · code `manifestHash` · document revision) are **distinct
and never conflated**. A hand-typed version integer is deliberately **not** stamped onto individual
source files — `manifestHash` already identifies code items more strongly than a number could.

## 2 · Change control (§8.2)

Changes flow through the brief lifecycle (`CLAUDE.md` §📌): a dated brief proposes the work; execution
is gated (`Dex-Test-Suite.html` all-green + `verify-provenance.html` clean where code changed); the
brief header is flipped to DONE only on verified completion; a follow-up brief captures residue. Each
work-unit drops a **changeset** (`changes/`) recording its bump level and summary. No change reaches a
release without a changeset — enforced by the `release-ledger` gate (check 7).

## 3 · Configuration status accounting (§8.3)

The record of *what is in each version and what changed between versions*:

- **`CHANGELOG.md`** — the human-readable history (Keep a Changelog), one section per release.
- **`RELEASE-MANIFEST.json`** — the machine-readable ledger: per release, the version, date, bump,
  the contributing briefs, and a **per-app `manifestHash` snapshot**.
- The `release-ledger` gate asserts these agree with the canonical version and with each other (no
  fork, unique + increasing versions, history ↔ changelog parity).

## 4 · Reproducibility (release integrity)

Because `manifestHash` is a deterministic function of the inlined code, any shipped bundle can be
re-derived and checked against `BUILD-MANIFEST.json` (GATE A) and its known-answer fixtures against
`FIXTURE-PROVENANCE.json` (GATE B) by `verify-provenance.html` — a pure-static, content-addressed
integrity proof. This is the evidence that a given release is exactly the code that was tested.

## 5 · Concurrency

Multiple coders work in parallel. Collisions are prevented by construction, not coordination:
changesets are additive uniquely-named files (never a shared version integer), and the version is
computed **once**, at release time, by `tools/release.mjs`. See `SOFTWARE-RELEASE-PROCEDURE.md`.
