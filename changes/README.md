<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# `changes/` — pending changesets

This directory holds **changesets**: one small, additive file per work-unit describing what changed
and how much to bump the version. It is the collision-free half of Tepna's release flow
(`CONTROLLED-RELEASES-2026-07-05`): because every changeset is a *separate, uniquely-named file*, two
coders on two branches never edit the same bytes — no merge conflict, no fight over the version
number. Nobody hand-picks a version; `tools/release.mjs` computes it from the pending changesets at
release time.

## Drop a changeset as the LAST action of your work-unit

Filename: **`YYYY-MM-DD-short-slug.md`** (the date + a slug → unique). Example:
`2026-07-06-oxydex-hr-clamp.md`.

```
<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch          # patch | minor | major   — drives the version math (see below)
type: fixed          # added | changed | fixed | removed | deprecated | security  (Keep a Changelog)
nodes: [OxyDex]      # affected areas, or [suite] / [docs]
brief: OXYDEX-HR-ARTIFACT-RUNAWAY-FIX-2026-07-03-BRIEF.md   # the brief this executed, or: none
---
Clamp per-epoch HR to a physiologic range before averaging — fixes runaway on artifact.
```

The first line of the body becomes the changelog bullet; keep it one imperative sentence.

## What the bump levels mean (SemVer for Tepna)

- **major** — a breaking change to a *published contract*: the `ganglior.node-export` schema, the
  Clock Contract, the `ganglior.crossnight` envelope, a metric's identity/units/`goodDirection`, or
  removing a node.
- **minor** — backwards-compatible capability: a new node, metric, adapter, gate, or additive export
  field.
- **patch** — a bug/accuracy fix that changes no contract shape. (A numeric-output change that moves
  a fixture's known-answer is still `patch` unless it alters a metric's identity/units — but it MUST
  regenerate fixtures per `CLAUDE.md` §🔏.)

The release takes the **highest** bump among all pending changesets.

## Cutting a release

From an **all-green tree** (`tests/run-tests.mjs` + `verify-manifest.mjs` pass):

```
node tools/release.mjs            # fold changesets → stamp version → changelog → ledger → prune
node tools/release.mjs --dry-run  # preview, write nothing
```

`release.mjs` stamps `suite.manifest.json`, prepends a section to `CHANGELOG.md`, appends a record to
`RELEASE-MANIFEST.json` (with the current per-app `manifestHash` snapshot), deletes the consumed
changesets here, regenerates `tests/changes-list.txt`, and prints the `git tag`.

## Rules the `release-ledger` gate enforces

- Every file here (except this `README.md` and any `_`/`.`-prefixed file) is a well-formed changeset.
- If any bundle's code moved (its `BUILD-MANIFEST.json` `manifestHash` differs from the last release's
  snapshot) there **must** be a pending changeset here — you cannot ship code without recording it.

Files starting with `_` or `.`, and this `README.md`, are ignored by both the generator and the gate.
