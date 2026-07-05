<!--
  CONTROLLED-RELEASES-2026-07-05-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->

**Status:** DONE — 2026-07-05 · **Created:** 2026-07-05 · **Followed-by:** `CONTROLLED-RELEASES-FOLLOWUPS-2026-07-05-BRIEF.md`

> **EXECUTED 2026-07-05 (Phases 1–4; NO re-bundle, no provenance churn).** Shipped: suite SemVer
> **1.0.0** in `suite.manifest.json`; root `CHANGELOG.md` (Keep a Changelog, history reconstructed
> 0.1.0→1.0.0 from the DONE brief corpus); `RELEASE-MANIFEST.json` (1.0.0 record + per-app
> `manifestHash` snapshot); the `changes/` changeset flow (`changes/README.md` + `tests/gen-changes-list.mjs`
> + `tests/changes-list.json`); `tools/release.mjs`; the **`release-ledger` gate** (`tests/dex-tests.js`,
> both runners wired — `run-tests.mjs readReleaseLedger` + `Dex-Test-Suite.html` fetch); the
> `docs/COMPLIANCE/` set (lifecycle plan · safety class · config-mgmt · SOUP · release SOP · doc-control);
> `CLAUDE.md` §📦 + `CONTRIBUTING.md` + `DOCS-INDEX.md` updated. **Verified green:** release-ledger 10/10,
> docs-ledger 15/15, headless floor green.
> **Parallel-coder handling (owner-flagged):** executed collision-safe — additive-only edits to the
> shared runners, no `tools/build.mjs`/`*.src.html`/bundle touched. OWN-THE-BUILD **Part C re-bundled
> OxyDex/PpgDex/CPAPDex mid-execution** → the 1.0.0 snapshot was synced best-effort to the settled
> hashes, and **check 7 ships INFORMATIONAL** (`HARD7=false`) so it doesn't red on in-flight re-bundles
> that predate the changeset flow (flip to hard-gate in the follow-up once adopted). The docs-ledger
> coder's F2 `paths[]` inventory was regenerated for the new files, and their illustrative `](briefs/…)`
> on `DOCS-INDEX.md`'s "Maintaining" line (which tripped their own check 4a/4b) was neutralized. **Phase 5
> (version-into-bundle stamp) deferred by design** → `CONTROLLED-RELEASES-FOLLOWUPS-2026-07-05`.

# Controlled releases, versioning & the changelog — IEC 62304 / ISO 13485-aligned

> **What this is.** An implementation brief for an AI/human coder. **One thesis:** the suite has
> world-class *code* identity (`manifestHash`) and *document* identity (immutable dated briefs +
> status headers), but **no release identity** — nothing you can point an auditor at and say "this
> is version X, here is what changed since version X−1, here is the record that it was cut." This
> brief adds that missing top layer: **one suite SemVer**, a **root `CHANGELOG.md`**, a
> collision-free **changeset** flow so parallel coders never hand-pick a number, a **`release-ledger`
> gate** (sibling of `docs-ledger`), and a **62304/13485-ALIGNED** (explicitly *not conformant*)
> compliance doc set that mostly *maps existing gates to clauses* rather than inventing process.
>
> **Posture (owner-ratified 2026-07-05):** *aligned good practice, no conformance claim.* Every
> compliance doc MUST carry the `suite.manifest.json` intended-use disclaimer verbatim ("Not a
> medical device; does not diagnose, treat, cure, or prevent any condition"). We adopt the
> *disciplines* of 62304/13485; we do not claim certification, and no document may imply device
> status marketing disclaims. If a future regulated product is pursued, this layer is the
> foundation it builds on — designed so, not retrofitted.
>
> **Scope guard.** Phases 1–4 are **pure static text + Node tooling — NO re-bundle, no `manifestHash`
> movement, no fixture churn** (`verify-provenance.html` untouched by construction). Only the
> *optional* Phase 5 (stamp the version INTO bundles / exports) re-bundles, and it is deliberately
> deferred to ride the next behavioral re-bundle — never re-bundle 8 apps just to carry a version
> string (same economics as the inert license-comment and `BADGE_CSS` rules).

---

## 0 · Ground truth — read before writing a line

- **`CLAUDE.md`** — the constitution. §📌 (brief lifecycle), §🧪 (test gate + never loosen an
  assertion), §🔏 (provenance gate, `manifestHash` as the sole executed-code identity), §📜
  (licensing / Tepna brand / frozen `Ganglior`), the ⚙️ OWNED BUILD note (`tools/build.mjs`).
- **`suite.manifest.json`** — the existing "SINGLE source of truth" roster that `tools/build-docs.mjs`
  already projects into README / `index.html` JSON-LD / `docs/about.json` / `llms.txt`. **This is
  where the canonical version goes** — reuse the propagation that already exists; do not fork a
  second source.
- **`BUILD-MANIFEST.json`** (per-bundle `manifestHash`) + **`FIXTURE-PROVENANCE.json`** (content-
  addressed known-answers) + **`verify-provenance.html`** / **`tests/verify-manifest.mjs`** — the
  existing code-identity + reproducibility layer. The release layer *references* these; it does not
  replace or re-implement them.
- **`briefs/DOCS-LEDGER-GATE-2026-07-03-BRIEF.md`** — **the template for this whole brief.** It
  turned the brief lifecycle from "please remember" into a red/green gate. Copy its shape exactly:
  an env-fed group in `tests/dex-tests.js`, run in both runners, in the headless floor, skipping
  cleanly when its env key is absent. Our `release-ledger` group is its sibling.
- **`tests/dex-tests.js`** + **`tests/run-tests.mjs`** + **`Dex-Test-Suite.html`** — the shared
  assertions and the two runners. Study `docs-ledger` and `cohesion-badges` for the house pattern.
- **`THIRD-PARTY.md`**, **`licensing/`** (`SPDX-HEADERS.txt`, `LICENSING-BRIEF.md`) — feed the SOUP
  list and the doc headers.
- **`CONTRIBUTING.md`**, **`DOCS-INDEX.md`** — the contributor path + the dashboard both get one new
  section each.

---

## 1 · The three identity layers (answers: "same number, or each its own?")

There is not one right answer — there are **three artifact classes, each with its own identity
mechanism**, and two of the three already exist. Write this down; it is the mental model:

| Layer | Artifact class | Identity | Status |
|---|---|---|---|
| **Release** | the shipped suite as a whole | **ONE SemVer** `MAJOR.MINOR.PATCH` — the "maintenance number" | **NEW (this brief)** |
| **Code item** | each bundle's executed code | `manifestHash` (deterministic content hash) | ✅ exists |
| **Document** | each brief / spec / SOP | immutable dated filename + status header + `Supersedes:` chain; specs carry own `vX.Y` | ✅ exists |

**The rule.** The SemVer is a *release* fact, **not a per-file fact.** Do **NOT** stamp a
hand-typed version integer onto every `.js`/`.md` — that is a third, redundant, drift-prone
identifier and re-creates the exact "please remember" disease the gates killed. Code files are
already identified by `manifestHash` (stronger than a version — it is content-addressed and can't
be wrong). Documents are already independently revisioned by the ADR/RFC scheme. The **only** thing
missing is the single number over the top, and there is **exactly one** of it.

- **ISO 13485 mapping:** documents carry independent revisions → §4.2.4 *document control* (already
  satisfied by the brief lifecycle + `docs-ledger` gate). The software product carries one release
  version → §4.2.5 *records* / the release record.
- **IEC 62304 mapping:** the released *software system* is the SemVer (§5.8); each *software item*
  is a bundle identified by `manifestHash` (§8.1 configuration item identification). One version,
  many content-hashed items — 62304 does **not** mandate lockstep vs independent, it mandates
  *unique identification + reproducibility*, which we already exceed.

---

## 2 · Canonical source + auto-ingest (answers: "canonical source all files ingest?")

**One source, everything else is a projection** — the repo's core philosophy (`suite.manifest` →
docs; registry → `*_DEFS`; `FIXTURE-PROVENANCE` ledger → `verify-provenance` view).

- **Canonical current version →** `suite.manifest.json`, new top-level `"version": "1.0.0"`. Chosen
  because `tools/build-docs.mjs` **already reads this file and propagates it** — the version
  auto-ingests into README, `index.html` JSON-LD, `docs/about.json`, `llms.txt` with *no new
  plumbing*. Extend `build-docs.mjs` to also emit the version into those surfaces.
- **Machine-readable release history →** new **`RELEASE-MANIFEST.json`** (repo root, sibling of
  `BUILD-MANIFEST.json` / `FIXTURE-PROVENANCE.json`). An append-only array of release records:
  ```json
  { "version": "1.0.0", "date": "2026-07-05", "bump": "major",
    "briefs": ["OWN-THE-BUILD-2026-06-30-BRIEF.md", "..."],
    "manifestHashes": { "OxyDex": "…12hex…", "ECGDex": "…", "...": "..." },
    "notes": "Baseline. Reconstructed from the DONE brief corpus — see CHANGELOG.md." }
  ```
  The **newest record's `version` MUST equal `suite.manifest.json.version`** (gate-enforced — the
  history head and the current pointer can never fork). The per-app `manifestHashes` snapshot is
  what makes "checked and stamped completely at the end" enforceable (see §4 check 7).
- **Human-facing →** **`CHANGELOG.md`** (repo root, **Keep a Changelog** format). This is the "plain
  changelog in root" you asked for. It is a *view* over `RELEASE-MANIFEST.json`; the gate asserts
  they agree.
- **Runtime stamp (Phase 5, optional, re-bundle) →** `tools/build.mjs` reads the canonical version
  and stamps it alongside the existing `ganglior-provenance.js` metadata so each app can *display*
  "Tepna v1.0.0" offline and each export can carry `producer.suiteVersion`. **Deferred on purpose:**
  standalone bundles can't `fetch` the manifest, so displaying the version *inside* a bundle needs a
  re-bundle — do NOT re-bundle 8 apps just for a string; let it ride the next behavioral re-bundle.
  Until then the version shows on the deploy/docs surfaces (via `build-docs`), which is honest.

**Root-file allowlist:** `CHANGELOG.md` is a standard OSS file (like `README`/`NOTICE`) →
add it to `CLAUDE.md` §Repo-layout + the `DOCS-INDEX` layout note's root allowlist.
`RELEASE-MANIFEST.json` is a `*.json` runtime/build file → already allowed in root.

---

## 3 · Changesets — the collision-free flow (answers: "multiple coders … checked & stamped at end")

**Root cause of version collisions:** humans hand-picking `1.4.0` in parallel branches. **The fix:
don't let them — derive it, once, at the end.** The pattern that fits Tepna's "every work-unit
spawns a brief" culture is **changesets** (the same additive-file property that makes briefs never
collide).

- **New `changes/` directory** (visible, greppable — matches `briefs/` style, not a hidden
  `.changeset/`). Each work-unit drops ONE entry as its *last* repo action:
  ```
  changes/2026-07-05-oxydex-hr-runaway.md      ← date + slug → unique, never collides
  ```
  ```
  <!-- SPDX-License-Identifier: Apache-2.0 -->
  ---
  bump: patch                 # patch | minor | major   (drives the version math)
  type: fixed                 # Keep-a-Changelog category: added|changed|fixed|removed|deprecated|security
  nodes: [OxyDex]             # affected areas, or [suite] / [docs]
  brief: OXYDEX-HR-ARTIFACT-RUNAWAY-FIX-2026-07-03-BRIEF.md   # or "none"
  ---
  Clamp per-epoch HR to a physiologic range before averaging — fixes runaway on artifact.
  ```
  Because entries are additive files with unique names, **two coders on two branches never touch the
  same bytes** — no merge conflict, no collision. (Contrast: a shared `## [Unreleased]` section in
  `CHANGELOG.md` — Keep-a-Changelog's native pattern — *would* collide; we choose changeset files
  precisely because the whole point here is parallel coders.)

- **The single release step →** new **`tools/release.mjs`** (Node sibling of `build.mjs` /
  `verify-manifest.mjs`). Run once, at the end, by whoever cuts the release:
  1. **Refuse unless green** — `run-tests.mjs` all-pass **and** `verify-manifest.mjs` (GATE A/B)
     clean. A release is only ever cut from a green tree (62304 §5.8 — you release known-good code).
  2. Read every pending `changes/*.md`; the aggregate **bump = max(patch < minor < major)**; derive
     the next version from `suite.manifest.json.version`.
  3. Write the new version into `suite.manifest.json`.
  4. Prepend a new dated section to `CHANGELOG.md`, folding the changesets under their
     Keep-a-Changelog `type:` headings, each line citing its `brief:` + `nodes:` and noting any
     `manifestHash` movement read from `BUILD-MANIFEST.json`.
  5. Append the release record to `RELEASE-MANIFEST.json` (version, date, bump, brief list, per-app
     `manifestHashes` snapshot).
  6. **Delete the consumed `changes/*.md`** (they are now folded into the changelog).
  7. Re-run `build-docs.mjs` so the new version propagates to every surface.
  8. Print `git tag v<version>` for the operator (the tag is the external release marker; the
     `RELEASE-MANIFEST.json` record is the in-repo evidence that survives history rewrites).

  The number is **computed at this one step**, never authored in parallel → collisions are
  structurally impossible. "Checked and stamped completely at the end of their work" = this script
  + the gate below.

---

## 4 · The `release-ledger` gate (enforce_gate: owner deferred → YES, per repo culture)

New `release-ledger` group in `tests/dex-tests.js`, fed `env.releaseLedger`
`{ manifestText, releaseManifest, changelogText, changeFiles:{name:text}, buildManifest }`. Skips
cleanly when the env key is absent (older/partial runners stay green — same tolerance as
`docs-ledger`). Runs in the **headless floor** (cheap text). Checks:

1. **Valid SemVer.** `suite.manifest.json.version` matches `^\d+\.\d+\.\d+$`.
2. **No fork.** newest `RELEASE-MANIFEST.json` entry `.version` === `suite.manifest.json.version`.
3. **Unique + increasing.** `RELEASE-MANIFEST.json` versions are all distinct and strictly SemVer-
   increasing. *This is the check that catches two coders shipping the same number* — the literal
   "new release numbers must be checked" ask.
4. **History ↔ changelog parity.** every `RELEASE-MANIFEST.json` version has a matching
   `CHANGELOG.md` section heading, and the newest `CHANGELOG.md` release heading === canonical.
5. **Changeset well-formedness.** every pending `changes/*.md` has a valid `bump` ∈
   {patch,minor,major}, a valid `type`, and a `brief:` that either is `none` or names an existing
   `briefs/` file.
6. **Stamp parity (static).** any version string emitted onto a build/docs surface === canonical
   (mirror of the badge gate's "no fork" assertion; read statically, no boot).
7. **Unreleased work is visible (Phase 2 of the gate — the crown jewel).** for each app, if its
   `BUILD-MANIFEST.json` `manifestHash` ≠ the hash recorded in the newest `RELEASE-MANIFEST.json`
   entry, there MUST be ≥1 pending `changes/*.md`. I.e. **you cannot move executed code without an
   unreleased changelog entry.** Because `manifestHash` is deterministic and only moves on a *real*
   code change, an inert re-bundle does **not** trip this — **zero false positives** (call this
   property out; it is why the check is safe). This is the exact "stamped completely at the end of
   their work in repo" enforcement.

**Authority rule** (mirror of the badge/docs gates): when `CHANGELOG.md` and `RELEASE-MANIFEST.json`
disagree, **fix the changelog** — the manifest is the ledger, the changelog is the view.

Wire `env.releaseLedger` from **both** runners: Node via `fs`; browser via same-origin `fetch` of
the JSON files + a small generated `changes/` name list (same generated-list-with-Node-reality-check
device `docs-ledger` uses — regenerate on add/remove; Node lane asserts the list matches `fs`).

---

## 5 · SemVer semantics defined for Tepna (kills the "minor or patch?" bikeshed)

Write these into the lifecycle plan so bump levels are objective, anchored to the suite's *real*
published contracts:

- **MAJOR** — breaking change to a **published contract**: the `ganglior.node-export` schema, the
  Clock Contract, the `ganglior.crossnight` envelope, a metric's identity/units/`goodDirection`, or
  removal of a node. (Anything a downstream consumer or the Integrator depends on.)
- **MINOR** — backwards-compatible capability: a new node, a new metric, a new adapter/vendor
  format, a new gate, additive export fields, a new evidence-graded finding.
- **PATCH** — bug/accuracy fix that changes **no** contract shape (e.g. the OxyDex HR-artifact-
  runaway fix). A numeric-output change that moves a fixture's known-answer is still **PATCH** unless
  it alters a metric's identity/units — **but it MUST regenerate fixtures** and re-record
  `FIXTURE-PROVENANCE.json` per `CLAUDE.md` §🔏 (the release step should refuse if provenance is red,
  which check-1 of `release.mjs` already guarantees).

---

## 6 · The 62304 / 13485-aligned compliance doc set (brief_scope: full)

New **`docs/COMPLIANCE/`** folder. These are *alignment* docs — mostly a **crosswalk that points at
existing gates**, not new process. Every file carries the SPDX header + the non-device disclaimer.

1. **`SOFTWARE-LIFECYCLE-PLAN.md`** — the umbrella (62304 §5.1 analogue). States the aligned-not-
   conformant posture + disclaimer, the safety class, the SemVer semantics (§5 above), and a
   **clause-crosswalk table**: each relevant IEC 62304 clause (§5 development, §6 maintenance, §7
   risk, §8 configuration management, §9 problem resolution) and ISO 13485 clause (§4.2.3–4.2.5)
   → the in-repo artifact/gate that satisfies it (mostly existing: briefs = change requests,
   `Dex-Test-Suite` = V&V, `verify-provenance` = release reproducibility, `docs-ledger` = document
   control, this brief's layer = configuration status accounting). **Honesty column required** — mark
   genuine gaps (e.g. no formal ISO 14971 risk file) as *gap*, not green.
2. **`SAFETY-CLASSIFICATION.md`** — IEC 62304 software safety class. Argue **Class A** (no injury
   possible; a wrong number can only mislead a self-quantifier, mitigated by evidence badges +
   disclaimers), or explicitly "out of 62304 scope; Class-A-equivalent rigor adopted voluntarily."
   Short rationale, not a risk file — and say so.
3. **`CONFIGURATION-MANAGEMENT-PLAN.md`** — 62304 §8. Names the configuration items (8 bundles +
   sources + the manifests + the docs), the identification scheme (§1's three layers), change
   control (briefs + gates), and states **configuration status accounting = `CHANGELOG.md` +
   `RELEASE-MANIFEST.json`**. Points at the gates as the enforcement.
4. **`SOUP-LIST.md`** — 62304 §5.3.3 / §8.1.2 Software Of Unknown Provenance. **Runtime SOUP list is
   EMPTY by design** (zero CDNs, zero runtime deps, system fonts only — a genuine strength, state it
   plainly and cross-ref `THIRD-PARTY.md` + the `no-network.html` gate). List *build-time* tooling
   (Node + any dev deps, with versions) as the only SOUP, clearly scoped as non-shipping.
5. **`SOFTWARE-RELEASE-PROCEDURE.md`** (the Release SOP) — 62304 §5.8. The operator runbook: gates
   green → `tools/release.mjs` → verify stamp parity → `git tag` → the `RELEASE-MANIFEST.json` record
   IS the release. Include the **approver/sign-off** line (13485 record control — who authorized the
   release) and the reproducibility evidence pointer (`verify-provenance.html`).
6. **`DOCUMENT-CONTROL.md`** — ISO 13485 §4.2.4/4.2.5 crosswalk. Shows the existing brief lifecycle
   (immutable dated filenames, status headers, `Supersedes:` chains, `DOCS-INDEX` dashboard, the
   `docs-ledger` gate) already *is* document + record control. Mostly "we do this — here's the map."

Add a `DOCS-INDEX.md` row per file (§7 dashboard sync). Keep the whole set honest: these demonstrate
*alignment*, they do not certify a QMS.

---

## 7 · Backfill → the 1.0.0 baseline (backfill: yes, reconstructed)

Seed the first controlled release from the DONE brief corpus — **honestly** (we never actually cut
pre-1.0 releases, so do not fabricate release *events*; reconstruct a *history* and label it as
reconstructed):

- **Proposed seed = `1.0.0`** (owner confirms). Defensible: contracts are frozen/mature (Ganglior
  frozen, export schema versioned, all gates green), so a stable 1.0 baseline is honest.
- `tools/release.mjs --backfill` (or a one-shot script): grep `briefs/` for `Status:.*DONE — <date>`,
  sort by date, cluster into the natural development waves (the brief *families*: per-node builds,
  SIGNAL-ADAPTER, OWN-THE-BUILD, PROVENANCE, DOCS-LEDGER, …). Emit reconstructed **0.x milestone**
  entries into `CHANGELOG.md` anchored to real DONE dates, culminating in **`1.0.0` — Baseline**
  (today's green tree), Keep-a-Changelog-grouped, each line citing its brief.
- A prominent `CHANGELOG.md` note: *"Entries below 1.0.0 are reconstructed from the brief ledger for
  provenance; they were not formally cut releases."* → texture without dishonesty.
- `RELEASE-MANIFEST.json` gets the single real `1.0.0` record (with the current per-app
  `manifestHashes`); the reconstructed 0.x waves live in the changelog prose only (they have no
  trustworthy per-app hash snapshot, so do not fabricate one).

---

## 8 · Phases

- **Phase 1 — canonical version + changelog + backfill (½–1 day, no re-bundle).** Add
  `suite.manifest.json.version` = 1.0.0; write root `CHANGELOG.md` (Keep a Changelog) with the
  reconstructed history + 1.0.0 baseline; create `RELEASE-MANIFEST.json` with the 1.0.0 record;
  update `CLAUDE.md`/`DOCS-INDEX` root allowlist + rows; extend `build-docs.mjs` to propagate the
  version.
- **Phase 2 — changeset flow + release tooling (1 day, no re-bundle).** `changes/` dir + format;
  `tools/release.mjs` (compute-bump, stamp, fold, snapshot, prune, retag); document in
  `CONTRIBUTING.md` ("drop a changeset as your last action").
- **Phase 3 — the `release-ledger` gate (1 day, no re-bundle).** Checks 1–6 in `tests/dex-tests.js`,
  both runners, headless floor; the generated `changes/` list + Node reality-check; deliberately
  break each check → red with an actionable message. Add check 7 (unreleased-work-visible) once the
  per-app hash snapshot is in `RELEASE-MANIFEST.json`.
- **Phase 4 — compliance doc set (1–1½ days, no re-bundle).** `docs/COMPLIANCE/` §6 files + the
  clause crosswalk + `DOCS-INDEX` rows.
- **Phase 5 — runtime version stamp (OPTIONAL, DEFERRED, re-bundle).** `build.mjs` stamps the
  version into bundles + `producer.suiteVersion` in exports. **Do not execute standalone** — let it
  ride the next behavioral re-bundle; then update `BUILD-MANIFEST.json` + regenerate affected
  fixtures per §🔏.

**Total Phases 1–4: ~4 days, zero provenance churn.**

## Honesty / risks

- **Overclaim is the top risk.** These docs must *align*, never *certify*. The disclaimer is
  mandatory on every compliance file; a reviewer should be unable to read them as a device claim.
  A DONE stamp here means "the process layer exists and is gated," not "we passed an audit."
- **The changeset list can go stale** (browser can't list `changes/`). The Node-lane reality check
  is mandatory, not optional — else this brief re-creates the hand-fed-ledger disease `docs-ledger`
  exists to kill.
- **Backfill honesty.** Do not invent per-app hashes or release dates for the reconstructed 0.x
  waves. Reconstructed history is prose; only 1.0.0 is a real record.
- **Don't double-version.** Resist any reviewer request to stamp a version into every source file —
  §1 is the answer: `manifestHash` + doc headers already identify items; one SemVer sits on top.
- **Check 7 staging.** It needs the per-app hash snapshot in `RELEASE-MANIFEST.json` first; ship
  checks 1–6, then 7. It has zero false positives (deterministic `manifestHash`) — verify that
  claim by re-bundling an app with no source change and confirming the gate stays green.

## Done when

- ☐ `suite.manifest.json.version` = 1.0.0; `build-docs.mjs` propagates it; surfaces show it.
- ☐ Root `CHANGELOG.md` (Keep a Changelog) with reconstructed history + 1.0.0 baseline + the
  "reconstructed, not cut" note.
- ☐ `RELEASE-MANIFEST.json` with the real 1.0.0 record (per-app `manifestHashes`).
- ☐ `changes/` dir + documented changeset format; `tools/release.mjs` cuts a release end-to-end from
  a green tree and prunes consumed changesets.
- ☐ `release-ledger` group (checks 1–6; 7 when snapshot lands) in `tests/dex-tests.js`, both runners,
  headless floor, skips cleanly without its env; each check verified RED when deliberately broken.
- ☐ `docs/COMPLIANCE/` set (§6) with the clause crosswalk + honest gap column + disclaimers.
- ☐ `CLAUDE.md` (root allowlist + a §ledger note), `CONTRIBUTING.md` (changeset step), `DOCS-INDEX.md`
  (new section + rows) updated; `tests/docs-ledger-list.json` regenerated.
- ☐ `verify-provenance.html` untouched + green (nothing re-bundled in Phases 1–4).
- ☐ Follow-up brief spawned with what surfaced (or this header says nothing did).

## Expected follow-up

Likely `CONTROLLED-RELEASES-FOLLOWUPS-YYYY-MM-DD-BRIEF.md`: Phase 5 (runtime stamp on the next
re-bundle), check 7 rollout, and any owner decision on whether to assign retroactive git tags to the
reconstructed 0.x waves (recommended: do not — tag only from 1.0.0 forward).

---

## Cross-references
- `CLAUDE.md` §📌 (lifecycle) · §🧪 (gate) · §🔏 (provenance, `manifestHash`) · §📜 (licensing/brand).
- `briefs/DOCS-LEDGER-GATE-2026-07-03-BRIEF.md` — the sibling gate this brief copies wholesale.
- `briefs/OWN-THE-BUILD-2026-06-30-BRIEF.md` — the owned Node build (`tools/build.mjs`) `release.mjs`
  sits beside; the "construction-enforcement over drift-suppression" philosophy applied to releases.
- `suite.manifest.json` + `tools/build-docs.mjs` — the canonical-source + propagation pattern reused.
- `BUILD-MANIFEST.json` · `FIXTURE-PROVENANCE.json` · `verify-provenance.html` — the code-identity +
  reproducibility layer the release layer references.
- `THIRD-PARTY.md` · `no-network.html` — inputs to the SOUP list (runtime-empty by design).
- IEC 62304 §5.8 (release) · §8 (configuration management + status accounting) · §5.3.3 (SOUP);
  ISO 13485 §4.2.4 (document control) · §4.2.5 (records); Semantic Versioning; Keep a Changelog.
