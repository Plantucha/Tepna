<!--
  OWN-THE-BUILD-2026-06-30-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->

**Status:** PROPOSED · **Created:** 2026-06-30

# Own the build + born-compliant nodes (retire the drift-suppression machinery)

> **What this is.** An implementation brief for an AI coder. **One thesis:** replace *drift-suppression*
> (invariants added after code already violated them, then policed by after-the-fact tests + hand-edited
> ledgers) with *construction-enforcement* (the violation is impossible to express). Three separable
> parts, in leverage order:
> **Part A — Own the build:** a deterministic, dependency-free Node bundler (`tools/build.mjs`) that
> consumes the existing `*.js` / `*.src.html` and emits `bundle + BUILD-MANIFEST + FIXTURE-PROVENANCE`
> as **build artifacts**. **No DSP math changes.** This alone retires the `buildHash`/`manifestHash`
> nondeterminism class, the hand-edited ledgers, the hand-mirrored `ans-design.css`, and (Part A5) the
> drift-tested `parseTimestamp` duplication.
> **Part B — Born-clean the next node:** EEGDex / SpiroDex are scaffolded headless-DSP +
> construction-enforced badges from commit one. Old nodes migrate opportunistically, never in a big bang.
> **Part C — Badge-by-construction:** make the registry badge the *only* path a number reaches the DOM;
> migrate one render file at a time, the next time you're already in it.
>
> **Read first (do not relitigate):** `CLAUDE.md` §🧪 (test gate) · §🔏 (provenance gates + re-bundle
> checklist) · §🎫 (evidence badges) · §🔒 (Clock Contract). `ARCHITECTURE-PRINCIPLES.md` §6 (build) + §7
> (forward-adopt). `GENERATOR-FOLLOWUPS-II-BRIEF.md` §1 (the "own the inliner" path deliberately NOT
> taken — **this brief takes it**). Parts A/B/C are independent; **Part A is the marquee — ship it alone
> if that's all there's appetite for.**

---

## 0. Ground truth — read these files before writing a line

The coder MUST orient on the real code; this brief quotes it but the files are authoritative:

- **`manifest-gate.js`** — the shared GATE-A/B core (`manifestHashFromText`, `gateACompare`,
  `gateBEvaluate`, `sha16`, `MANIFEST_BUNDLES`). Consumed by BOTH `verify-provenance.html` and
  `tests/verify-manifest.mjs`. **This is the file Part A2 extends.**
- **`tests/verify-manifest.mjs`** — the headless GATE-A/B runner. Note its **single-source guard**
  regexes (`/<script src="manifest-gate\.js"><\/script>/` and the re-inline check) — Part A2 must keep
  them valid.
- **`BUILD-MANIFEST.json`** — GATE-A ledger. Read the `_doc` and the ~30 `_note_*` entries: nearly every
  one is *"external-JS-only edit → re-bundled, manifestHash X→Y; buildHash UNCHANGED"* + an EXPORT-INERT
  fixture re-record. **That changelog IS the toil this brief deletes.**
- **`FIXTURE-PROVENANCE.json`** — GATE-B ledger (content-addressed known-answers).
- **One `.src.html` head** (e.g. `OxyDex.src.html` lines 1–70) + **its bundle** (`OxyDex.html` — see the
  `<script type="__bundler/manifest">` and `<script type="__bundler/template">`).
- **`codegen/dex-gen.js` + `codegen/dex-registry-gen.js`** — the scaffold generators. `dex-gen.js`
  **already** projects each metric's `evidence` into an `ev-corner` badge *"so a generated guide passes
  the shared cohesion-badges gate BY CONSTRUCTION"* and rejects `RETIRED_EVIDENCE`. **Parts B & C extend
  this existing pattern; they do not invent one.**
- **`PROVENANCE-NONDETERMINISM-2026-06-29-BRIEF.md`** + `CLAUDE.md` §🔏 — the async-auto-rebuild hazard
  Part A0 must resolve.

---

## PART A — OWN THE BUILD

### A.1 The problem, precisely

The suite is bundled by the **platform inliner** (`super_inline_html` / `bundle_project`), which the repo
does **not** own. Two consequences drive almost all the build ceremony:

1. **Non-determinism by construction.** The inliner keys every `__bundler/manifest` asset by a fresh
   `crypto.randomUUID()` per build, so a re-bundle of *identical source* produced a *different* raw
   manifest. `PROVENANCE-NONDETERMINISM §1` fixed this **downstream** by redefining `manifestHash` as a
   UUID-independent projection (drop keys, gunzip, hash decompressed bytes, sort, SHA-256[0:12]) — a
   clever workaround for a bundler you can't fix. Owning the bundler removes the *cause*: emit no random
   keys, and the output is byte-deterministic.
2. **The ledgers are hand-maintained + can race.** After any re-bundle you must hand-recompute and
   hand-write `manifestHash` into `BUILD-MANIFEST.json` (GATE A **hard-fails** on a stale value), and
   the platform may **async-auto-rebuild** a bundle after you edit its source, moving the hash *under
   you* (`CLAUDE.md` §🔏 "Record AFTER the build settles"). Plus `ans-design.css` is **hand-mirrored**
   inline into OxyDex/HRVDex (`/* ANS-DESIGN-START · sha 63d47ad1 */` + *"No build script ships here —
   hand-mirror or it drifts silently"*) while PpgDex/GlucoDex/CPAPDex `<link>` it — a half-migrated,
   drift-prone split.

**What Part A retires** (delete-list, verified against the repo): the "re-bundle → hand-edit
`BUILD-MANIFEST.json`" step; the EXPORT-INERT fixture re-record churn; the entire
`PROVENANCE-NONDETERMINISM` I/II workaround class; the `ANS-DESIGN-START` hand-mirror + sha marker +
`sync-design.py`-never-existed note (`AUDIT.md` 2a); and (A5) the `parseTimestamp` copy-paste + its
drift test (`AUDIT.md` 2b). It does **not** retire the two gates — it makes their ledgers **build
outputs** so the gates verify instead of being hand-fed.

### A.2 The design — `tools/build.mjs` (dependency-free ESM, like `tests/*.mjs`)

Plain-**inline**, not gzip-pack. For a local-first instrument, readable inlined code is *more* auditable
and trivially deterministic; a 1–3 MB standalone is a non-issue. Per app:

1. Read `Foo.src.html` (or the relocated build-source from A0).
2. Resolve every `<script src="X.js">` → inline as `<script data-inline-src="X.js">…</script>`; every
   `<link rel="stylesheet" href="Y.css">` → `<style data-inline-src="Y.css">…</style>`. Preserve source
   order exactly. Escape nothing inside (JS/CSS can't contain `</script>`/`</style>` here; assert if it
   does). Keep `licensing/dex-license.css` in the set.
3. **Single-source `ans-design.css`:** every `.src.html` `<link>`s the ONE `ans-design.css`; the bundler
   inlines it. **Delete** the hand-mirrored `ANS-DESIGN-START…END` blocks from OxyDex/HRVDex and the sha
   markers everywhere. One file in, N bundles out — mirror drift becomes unrepresentable.
4. **Deterministic output, byte-for-byte:** stable ordering; **no timestamps, no random keys, no build
   date** anywhere in the emitted HTML; LF line endings; fixed doctype/shell. Re-running on identical
   source produces an identical file (assert this in a test — see A.4).
5. Keep a minimal splash/error shell (the one `INLINER-PATCH-LIST.md` already specifies) so a JS-off or
   mid-unpack load isn't a blank page. No `DecompressionStream` bootstrap needed — code ships as text.
6. **Compute + write the ledger entry** (A.3).

CLI: `node tools/build.mjs --app OxyDex` · `--all` · `--check` (build in memory, diff against the
committed `Foo.html`, exit non-zero on drift — the CI drift guard) · `--fixtures` (A.3).

### A.3 Ledgers as build artifacts (the part that kills the toil)

- **`manifest-gate.js` gets ONE new branch.** `manifestHashFromText` today returns `null` when there's
  no `<script type="__bundler/manifest">`. Add: if the bundle is plain-inline (detect the
  `data-inline-src` markers), compute `manifestHash` = SHA-256[0:12] over the **sorted** list of
  `{ logicalName \u0000 sha256(assetText) }` for every inlined asset **plus the inline shell
  script/style** (so it's a true whole-executed-code identity — this also absorbs the retired
  `buildHash`'s job). Same determinism contract as today: pure function of shipped code, moves only on a
  real change. Both `verify-provenance.html` and `verify-manifest.mjs` inherit it unchanged (shared
  module) — **update `verify-manifest.mjs`'s single-source-guard regexes** to match the new page wiring,
  and update `verify-provenance.html`'s extractor to try the plain-inline branch. Keep the old
  `__bundler/manifest` branch until every bundle is migrated (A.5 fleet cutover), then remove it.
- **`build.mjs` writes `BUILD-MANIFEST.json`** — after building each app, set
  `bundles[Foo.html].manifestHash` to the freshly computed value. GATE A can no longer go stale, because
  the thing that computes the hash also commits it. (Drop `buildHash` from new entries — it's retired
  metadata; leave existing values only if you're not touching them, but the plan is to remove the field
  fleet-wide once nothing reads it. Confirm nothing reads it first: `ganglior-provenance.js` still
  *stamps* it into exports as inert — that's fine, it's not a gate input.)
- **`build.mjs --fixtures` regenerates `FIXTURE-PROVENANCE.json`** — for each code-gated fixture, re-run
  the producing app's headless `compute()` on the committed input(s), re-export, and record
  `{ manifestHash, inputHashes, outputHash }` via `ManifestGate.sha16` over the raw bytes. **Never
  hand-edit a hash.** Historical/`historical:true` records are byte-pinned only — do not code-gate them.
  This automates the exact "re-run + re-record" the `CLAUDE.md` re-bundle checklist describes by hand.

**Net workflow after Part A:** edit `*.js` → `node tools/build.mjs --all` → `node tests/verify-manifest.mjs`
(GATE A/B, now auto-green) → `Dex-Test-Suite.html` (behavior + equiv/GATE-C). The hand-update step is
gone; the ledgers are outputs.

### A.4 Tests (this is a build change — gate it like one)

- **Determinism test** (`tests/*.mjs`, wired into `tests.yml`): build an app twice in memory → assert
  byte-identical; build → assert `--check` passes; mutate one `*.js` byte → assert `manifestHash` moves.
- **`--check` in CI:** every committed `Foo.html` must equal a fresh build of its source (catches a
  hand-edited bundle or a forgotten rebuild). This *replaces* the "did you remember to re-bundle + update
  the manifest" human step with a machine one.
- **Behavior unchanged:** `Dex-Test-Suite.html` all-green (incl. render-coverage booting a real bundle
  in the iframe, and `env.equiv.*` GATE-C). A migrated bundle must pass identically — the 600+ shared
  assertions are the net that makes this mechanical, not scary.

### A.5 Phases — de-risk FIRST, then finish, then migrate

- **Phase 0 — the plan-killer spike (½ day, do this before committing anything).** Build **one** app
  (OxyDex) with a minimal `build.mjs`; confirm (a) the plain-inline bundle passes `Dex-Test-Suite.html`
  render-coverage and runs from `file://`, and (b) **the platform leaves the owned `OxyDex.html`
  alone** — i.e. it does not async-auto-rebuild over it (`CLAUDE.md` §🔏). **If (b) fails, relocate the
  build source so the platform doesn't treat it as a bundle input** (e.g. `src/OxyDex.build.html` with
  `build.mjs` writing the committed `OxyDex.html`), and re-confirm. This half-day answers the one
  question that can block the whole effort — spend it before Phase 1.
- **Phase 1 — finish the bundler (1–2 days):** all includes resolved, `ans-design.css` single-sourced,
  deterministic byte-identical output, `--all` / `--check`.
- **Phase 2 — ledgers as outputs (1 day):** the `manifest-gate.js` plain-inline branch (+ `.mjs` guard +
  `verify-provenance.html` extractor), auto-write `BUILD-MANIFEST.json`, `--fixtures`.
- **Phase 3 — migrate + re-validate the fleet (1–2 days):** re-bundle all 8, both gates green, fix
  asset/path edge cases. One-time churn: every bundle + fixture re-records once, gate-driven.
- **Phase 4 — retire the workarounds + docs (½–1 day):** delete the dead machinery; drop the retired
  `__bundler/manifest` branch; rewrite `CLAUDE.md` §🔏 (the re-bundle checklist becomes `build.mjs
  --all`), `ARCHITECTURE-PRINCIPLES §6`, `AUDIT.md` 2a; remove the `ANS-DESIGN-START` mirror machinery.
- **Phase A5 (OPTIONAL, needs human ratification — see §Honesty) — single `clock.js` (½–1 day):** with
  an owned build, `parseTimestamp` can live in ONE `clock.js` inlined into every bundle — single source
  **and** still bundled-local. Retires the copy-paste + the WP-G drift test (`AUDIT.md` 2b). **This
  contradicts a current `CLAUDE.md` rule** ("`parseTimestamp` duplicated … intentional per the Clock
  Contract. Mirror it; do not extract a shared util") — the rule existed *because there was no build to
  inline a shared file*; owning the build removes its premise. Do it as its own gated pass, not folded
  into Phase 1–4, and update `CLAUDE.md` §🔒 to bless the single source. The DSP math and the Clock
  Contract **semantics** do not change — only where the one copy lives.

**Total A (Phases 0–4): ~5–7 focused days; ~1–2 weeks part-time.** A5 adds ~½–1 day.

---

## PART B — BORN-CLEAN THE NEXT NODE (EEGDex / SpiroDex)

`ARCHITECTURE-PRINCIPLES §7` already prescribes **forward-adopt, migrate old nodes opportunistically.**
Codify that so a *new* node cannot be born non-compliant, and never retrofit the old ones in a big bang.

- **Headless DSP from commit one.** `<node>-dsp.js` exposes a pure `compute()` runnable in Node with **no
  DOM / no `localStorage`** (the Phase-9 surface every current node was *retrofitted* to — build the new
  ones already there). Render is **forbidden from recomputing any number** — it reads `compute()`'s
  output only. Wire the node into **both** runners' equiv gate (`env.equiv.<node>`, GATE-C) from the
  first commit, so "current code reproduces the committed export" is enforced before the node ships.
- **Construction-enforced badges from commit one.** Scaffold via `codegen/dex-registry-gen.js` +
  `dex-gen.js` (which already validate `evidence` and reject `RETIRED_EVIDENCE`): every metric in
  `<node>-registry.js` MUST carry an `evidence` grade or the generator fails loudly. Render surfaces
  numbers only through `MetricRegistry.badge()` / `.ev-corner` (Part C's helper).
- **Adapter-only vendor parsing.** Vendor formats (Muse/Mind-Monitor for EEG; the spirometer's CSV for
  SpiroDex) land as `adapters/*.js` producing a `SignalFrame`, per `ADD-AN-ADAPTER.md` — never as parse
  logic inside the node. Honor the Clock Contract parser (or the single `clock.js` if A5 shipped).
- **A "born-clean" gate** in `tests/dex-tests.js`: for any node in a `BORN_CLEAN` set, assert (1) its DSP
  source has no DOM/`localStorage` reference, (2) `compute()` runs headless on synthetic input, (3) every
  registry metric has an `evidence` field, (4) it has an `env.equiv` leg. New nodes join the set at
  birth; old nodes join only as they're migrated.

**Scope discipline:** Part B changes the *scaffold + the checklist for new nodes*. It does **not** rewrite
OxyDex/PulseDex/etc. Those already reached the same end-state by retrofit; leave them.

---

## PART C — BADGE-BY-CONSTRUCTION (incremental, close the reviewer's bug class)

The external review's one real code defect was a number reaching the UI **unbadged** (PulseDex BP-from-HRV
after a half-finished removal). Today that class is policed *after the fact* by `BADGE-COVERAGE-AUDIT` +
`BADGE-PLACEMENT-SWEEP` (+ followups) — sweeps that re-run and re-find. Make it impossible instead, one
file at a time.

- **One sanctioned path.** A render helper — extend `metric-registry.js` — that is the ONLY way a metric
  value reaches the DOM: it emits the value **and** its `evidence` badge together (corner or inline per
  `CLAUDE.md` §🎫), resolving the grade from the node registry. A number cannot be surfaced *without* a
  grade because the function that surfaces it also grades it.
- **Per-file guard as you migrate.** The next time you touch a `<node>-render.js` / `-app.js`, route its
  metric-value writes through the helper, then add that file to a `BADGE_ENFORCED` list checked by a
  source-regex guard in `tests/dex-tests.js` (the same style as the existing source-mirror guards): flag
  a bare metric-value DOM write outside the helper. **Incremental, not a big-bang sweep** — a file is
  enforced once it's migrated; unmigrated files stay covered by the existing sweeps until their turn.
- **Honest limit:** static analysis can't prove *every* `textContent = n` is a metric, so this is
  hardening, not a theorem. The helper + the per-file guard + the existing `cohesion-badges` gate
  (registry ≡ `dex-badges.css` ≡ reference guide) together shrink the bug class toward zero as coverage
  grows — which is the point of *incremental* construction-enforcement.

---

## Honesty / risks (read before starting)

- **The platform auto-rebuild is the one real blocker, and it's an UNKNOWN until Phase 0.** If the
  platform clobbers the owned `Foo.html`, you can't own the output — the mitigation (relocate build
  sources out of the platform's bundle-input path) is cheap but MUST be proven in Phase 0, not assumed.
  If it can't be made to stick, stop and report — don't ship a bundler the platform overwrites.
- **A5 changes a stated `CLAUDE.md` rule.** Don't do it silently. Get a human yes, then update §🔒 in the
  same pass. Everything else in Part A is *additive* and contradicts no rule.
- **This is a standalone pass, not mid-rollout** (`ARCHITECTURE-PRINCIPLES §7`). Don't interleave with an
  in-flight node migration; the fleet re-bundle (Phase 3) wants a quiet tree.
- **Plain-inline trades size for auditability + determinism.** Confirm in Phase 0 the bundles still load
  acceptably from `file://`. If size ever bites, the fallback is deterministic-gzip (own the keys +
  pin the compression) — more finicky, same ledger design; don't reach for it unless you must.
- **No DSP math changes anywhere in this brief.** If a fixture's *output* moves during migration, that's
  a red flag the bundler altered behavior — stop and diff, don't re-record it away.

## Done when
Flip to `DONE — <date>` only when the relevant gates pass (per `CLAUDE.md` brief-lifecycle). Part A, B, C
can flip independently.
- **Part A:**
  - ☐ Phase 0 spike: OxyDex plain-inline bundle passes `Dex-Test-Suite.html` + runs `file://`, and the
    owned output survives (platform doesn't clobber it; relocation applied if needed).
  - ☐ `tools/build.mjs` builds all 8 deterministically; `--check` clean; determinism test in CI.
  - ☐ `BUILD-MANIFEST.json` + `FIXTURE-PROVENANCE.json` are **build outputs** (no hand-edit); `node
    tests/verify-manifest.mjs` green; `verify-provenance.html` GATE A/B green.
  - ☐ `Dex-Test-Suite.html` all-green (behavior unchanged) after the fleet re-bundle.
  - ☐ `ans-design.css` single-sourced (hand-mirror + sha markers deleted); docs updated (`CLAUDE.md` §🔏,
    `ARCHITECTURE-PRINCIPLES §6`, `AUDIT.md` 2a).
  - ☐ *(A5, optional)* single `clock.js` inlined fleet-wide; WP-G drift test removed; `CLAUDE.md` §🔒
    updated; human ratified.
- **Part B:** ☐ the next node built born-clean (headless DSP + registry-graded + `env.equiv` + adapter-only)
  and the `BORN_CLEAN` gate enforces (1)–(4).
- **Part C:** ☐ the badge helper is the sole render path in ≥1 migrated render file, guarded by the
  `BADGE_ENFORCED` source check.
- ☐ `DOCS-INDEX.md` row added; a follow-up brief (`OWN-THE-BUILD-FOLLOWUPS-YYYY-MM-DD-BRIEF.md`) captures
  what surfaced during execution, or the header says nothing did.

## Expected follow-up
Owning the bundler will surface real edge cases (an asset path the inliner resolved implicitly; a bundle
that relied on the gzip bootstrap; a fixture whose "inert" re-record was hiding a real move). Record them
in `OWN-THE-BUILD-FOLLOWUPS-YYYY-MM-DD-BRIEF.md` per the house pattern. If Phase 0 shows the platform
won't yield ownership, that follow-up records the finding and this brief flips to a documented BLOCKED
rather than DONE.

---

## Cross-references
- `GENERATOR-FOLLOWUPS-II-BRIEF.md` §1 — the "own the inliner" path deliberately NOT taken; **this brief
  takes it**, which makes `buildHash`-with-teeth free (the plain bundle's hash *is* the executed code).
- `PROVENANCE-NONDETERMINISM-2026-06-29-BRIEF.md` — the workaround class Part A removes at the cause.
- `manifest-gate.js` · `tests/verify-manifest.mjs` · `verify-provenance.html` — the GATE A/B core Part A2 extends.
- `BUILD-MANIFEST.json` · `FIXTURE-PROVENANCE.json` — the ledgers that become build outputs.
- `codegen/dex-gen.js` · `codegen/dex-registry-gen.js` — the badge-by-construction precedent Parts B & C extend.
- `CLAUDE.md` §🧪 §🔏 §🎫 §🔒 · `ARCHITECTURE-PRINCIPLES.md` §6 §7 · `AUDIT.md` (items 2a/2b) · `INLINER-PATCH-LIST.md`.
- `Dex-Test-Suite.html` — the behavior + equiv/GATE-C gate that makes the migration mechanical.
- `ADD-AN-ADAPTER.md` — the adapter-only vendor path Part B's new nodes follow.
