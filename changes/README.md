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

## Do not hand-type `brief:` — and verify in 4 seconds, not in CI

```sh
node tools/new-changeset.mjs --slug=spool-cursor --bump=patch --type=fixed \
     --brief=CPAP-ACQ-P4 --body="Follow the device's pointer instead of stopping."
```

`--brief` takes a **fragment** and resolves it against the real `briefs/` set: one match is written in
full, several refuse and list them, none refuses and shows the nearest. **There is no spelling for a
brief that does not exist.** Omit `--brief` and you get `brief: none`, which is the default on purpose —
see below.

**Then check it, locally:**

```sh
node tests/run-tests.mjs --group=release-ledger      # ~4 s, and `check5` resolves every brief
```

⚠️ **This is why that line is here.** `check5` has always caught a non-resolving `brief:`, and it has
always been fast — but nothing pointed an author at it, so the first thing that said "wrong" was a
**~6-minute CI lap**. Measured 2026-09-19: three sessions learned it that way in one night. The check
was never missing; the 4 seconds were never on offer.

## `brief: none` is a real answer, not a fallback

Use it whenever the work-unit executed no brief. **Naming a plausible-but-wrong brief passes `check5`**
— it resolves, so the gate is satisfied — **while sending the next reader somewhere the defect never
was.** That is the residue ledger's source-cell trap one artifact over. If you are unsure which brief a
change belongs to, `none` is correct and a guess is not.

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
changesets here, and prints the `git tag`.

## Rules the `release-ledger` gate enforces

- Every file here (except this `README.md` and any `_`/`.`-prefixed file) is a well-formed changeset.
- If any bundle's code moved (its `BUILD-MANIFEST.json` `manifestHash` differs from the last release's
  snapshot) there **must** be a pending changeset here — you cannot ship code without recording it.

Files starting with `_` or `.`, and this `README.md`, are ignored by both the generator and the gate.
