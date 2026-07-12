<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Software Release Procedure — Tepna (IEC 62304 §5.8)

**Status:** REFERENCE (living) · **last-verified:** 2026-07-05 · Owner: Michal Planicka

> **Intended use (non-device).** Not a medical device; does not diagnose, treat, cure, or prevent any
> condition. Alignment artifact — no conformance claim.

The controlled-release runbook. A release is a **record**, not a vibe: it is the moment the suite's
version advances and `RELEASE-MANIFEST.json` gains an entry.

## Preconditions — release only from a GREEN tree

1. **Behavioural gate green:** `node tests/run-tests.mjs` all-pass, and `Dex-Test-Suite.html?full`
   render-coverage all-green (`window.__rcState==='done'` + `sameOriginStatus().ok`).
2. **Provenance gate clean where code changed:** `verify-provenance.html` → `window.__provenanceOK`
   true (GATE A manifest identity + GATE B fixture known-answers), or `node tests/verify-manifest.mjs`.
3. **Privacy gate clean:** `no-network.html` → `window.__noNetworkOK`.
4. **Pending changesets exist** in `changes/` describing the work since the last release.

`tools/release.mjs` re-runs (1)+(2) itself and refuses to proceed if either is red.

## Procedure

```
node tools/release.mjs --dry-run     # preview the computed version + changelog section
node tools/release.mjs               # cut it
```

`release.mjs`, in one atomic step:

1. reads every `changes/*.md`, takes the **highest** bump (patch < minor < major), computes the next
   version from `suite.manifest.json.version` — **the version is derived, never hand-typed**;
2. stamps `suite.manifest.json` `version`;
3. prepends a Keep-a-Changelog section to `CHANGELOG.md`;
4. appends a `RELEASE-MANIFEST.json` record (version, date, bump, contributing briefs, per-app
   `manifestHash` snapshot);
5. deletes the consumed changesets and regenerates `tests/changes-list.txt`;
6. prints the `git` commit + `git tag v<version>` commands.

## After the script

7. **Review** the generated `CHANGELOG.md` section and `RELEASE-MANIFEST.json` record for accuracy.
8. **Sign-off (record control, ISO 13485 §4.2.5):** the release owner records approval in the commit
   message (`release: v<version>` — author is the approver of record). For a multi-person release,
   note the reviewer in the commit body.
9. **Commit and tag:** `git add -A && git commit -m "release: v<version>" && git tag v<version>`.
10. **Confirm the gate is green post-cut:** re-open `Dex-Test-Suite.html` — the `release-ledger` group
    must be all-green (no fork, history↔changelog parity, no un-recorded code movement).

## Reproducibility evidence (§5.8 requires the release be re-creatable)

The released bundles are content-addressed: `verify-provenance.html` re-derives each bundle's
`manifestHash` and checks it against the committed `BUILD-MANIFEST.json`, and each fixture against
`FIXTURE-PROVENANCE.json`. The `RELEASE-MANIFEST.json` per-app `manifestHash` snapshot ties the
release version to exactly that code. Together they are the "this release is reproducible" evidence.

## Concurrency (multiple coders)

Coders never edit a shared version number — they drop **changesets** (`changes/README.md`). The
number is computed once, here, at release time, so parallel branches cannot collide on it. In-flight
work that lands after a cut ships in the next release via its own changeset.

## Deferred

Stamping the version **into** the offline bundles (so each app displays it and exports carry
`producer.suiteVersion`) requires a re-bundle and is deferred to ride the next behavioural re-bundle
(coordinated with the build owner) — see `CONTROLLED-RELEASES-2026-07-05-BRIEF.md` Phase 5. Until
then the version is authoritative in `suite.manifest.json` and surfaced on the docs/deploy pages.
