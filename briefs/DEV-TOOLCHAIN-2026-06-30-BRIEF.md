<!--
  DEV-TOOLCHAIN-2026-06-30-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->

**Status:** IN-PROGRESS — 2026-07-11 (**Part A COMPLETE** — A1·A2·A3·A4; **Part B COMPLETE** — Biome formatter adopted check-only/changed-only via `BIOME-FORMATTER-2026-07-11-BRIEF.md` Phases 0–1: `biome.json` tuned + `@biomejs/biome` devDependency + `format.yml`, provenance untouched; Part C carried, blocked on a `node tsc`+de-DOM host) · **Created:** 2026-06-30 · **Follows:** `OWN-THE-BUILD-2026-06-30-BRIEF.md` (shares the *construction-enforcement over drift-suppression* thesis + the Node-host reality) · **Continues:** `SIGNAL-ADAPTER-AND-FRONTIER-2026-06-23-BRIEF.md` Phase 4 (which shipped 4a/4b — this is "Phase 4, the two missing legs")

> **PARTIAL 2026-07-04 — Part A · A3 LANDED (test-only, no re-bundle).** A `House-invariant lint · retired
> vocabulary + frozen names` group in `tests/dex-tests.js` (both runners, headless floor) mechanizes §🎫/§📜:
> no retired evidence tier (proxy/composite/"provisionally validated"), no retired umbrella brand
> (GanglioR / ANS Intelligence), with the FROZEN codenames (`ganglior.*`, `ganglior.node-export`, `fascia`)
> allow-listed verbatim + positive controls so it can't rot into a no-op. Verified green on the wired
> source set.
>
> **⟳ UPDATE 2026-07-05 — Part A · A1 + A2 LANDED (test-only, no re-bundle).** Two new sibling groups in
> `tests/dex-tests.js` (both runners, headless floor): **A1 · Clock-Contract footguns** (`house-lint ·
> dev-toolchain · clock`) bans `Date.parse(`, `new Date('…')` string construction, and non-UTC civil
> getters (`.getHours/Minutes/Seconds/FullYear/Month/Date/Day` — `getUTC*`/`getTimezoneOffset` not matched),
> each with a positive control; **A2 · SPDX header presence** (`house-lint · dev-toolchain · spdx`) asserts
> every wired `*.js/*.mjs` carries `Copyright 2026 Michal Planicka` + `SPDX-License-Identifier: Apache-2.0`
> and no non-Apache id. Clean across the 37-file wired set (11 asserts green, `Dex-Test-Suite.html` pill
> 1929 passed / 123 groups; provenance untouched — no re-bundle). **Documented allow-list / debt:** A1
> exempts `glucodex-dsp.js` (3 local getters in a synthetic-gen date-anchor, `new Date(t0).getFullYear/
> Month/Date → Date.UTC` midnight — latent, non-user-facing) with a reason; convert to `getUTC*` on the
> next GlucoDex on-touch re-bundle (a DSP edit would force a re-bundle Part A avoids). The now()-fallback
> and the `new Date(<var>)` (non-literal) footguns are NOT gated — not precisely detectable by regex
> without false positives (guardrail: a rule that can't be made precise doesn't land); left to `tsc`/review.
> **⟳ UPDATE 2026-07-06 — Part A · A4 LANDED → Part A COMPLETE (test-only, no re-bundle).** The
> `House-invariant lint · DSP reach-in allow-list` group in `tests/dex-tests.js` (both runners, headless
> floor) folds in the orphaned -IV §1 gate: it SCRUBS each `*-dsp.js` with a real char-scanner (blanks
> comments / strings / template literals / **regex literals** char-for-char — a crude string-strip
> corrupts on regex literals that contain quotes like `/^"|"$/g`, silently swallowing function
> definitions → false positives; that corruption is exactly why A4 was deferred as "a precise
> implementation, not a regex"), then asserts each DSP's bare-call set ⊆ {self · kernel (`DexKernel` is a
> property read, never a call) · its own `*-util` bare exports · documented JS builtins}. Over-including a
> definition (any bare, non-call, non-property occurrence) errs toward false-NEGATIVE per the guardrail.
> 6/8 DSPs are clean; **oxydex-dsp** (+4: renderAll/setStatus/showError/setProgress) and **hrvdex-dsp**
> (+5: rerender/setStatus/setProgress/getProfile/calcVo2Cat/inferFromData) carry KNOWN unguarded reach-ins
> into render/app/profile siblings, reached only on the app-orchestration path (NEVER on headless
> `compute()` — proved clean by the `env.equiv` gate) — allow-listed with named reasons as the drift
> ledger to guard `typeof`-style on the next on-touch re-bundle (guarding them now is a DSP edit → a
> re-bundle Part A avoids). Ships 2 positive controls + 3 scanner controls so it can't rot to a no-op.
> Wired **`oxydex-util.js`** into `env.sources` in BOTH runners (its bare exports are OxyDex's legit
> reach-ins). Verified green on `Dex-Test-Suite.html` headless floor (1963 passed / 2 skipped / 127
> groups; provenance untouched — no re-bundle). Changeset `changes/2026-07-06-dev-toolchain-a4-reachin-gate.md`.
>
> **DISCOVERED RESIDUE (carried, no separate follow-up spawned — recorded here per the empty-follow-up
> rule).** (1) The A4 reach-in drift-ledger above + (2) the A1 `glucodex-dsp.js` synthetic-gen local
> getters — both are DSP edits owed on the **next on-touch re-bundle** of their node, not new work. Parts
> B/C remain the substantive open legs (below).
>
> **Part B (formatter) COMPLETE 2026-07-11** — Biome adopted via `BIOME-FORMATTER-2026-07-11-BRIEF.md`
> Phases 0–1 (config + pinned devDependency + lockfile + `format.yml` check-only/changed-only + CONTRIBUTING
> §B2). Its Done-when (`format.yml` green as a fourth sibling; `verify-provenance` GATE A/B untouched, 0
> fixtures re-recorded) is met; the on-touch application of the formatter to shipped files is Phase 2 of
> that brief (ongoing by design — never big-bang). **Part C (widen `tsconfig`) DEFERRED** — needs `node
> tsc` to verify green + a de-DOMed module. **Flip to DONE when Part C meets its Done-when** (Parts A/B are complete).

# Dev toolchain — the formatter + house-invariant linter (the "black + flake8" to the existing "mypy")

> **One thesis.** The suite already has the **type-checker** leg of a Python-grade static toolchain —
> `tsc --noEmit --checkJs` (Phase 4a) + the DSP-purity gate (Phase 4b), both CI-wired, both shipping
> nothing. It is missing the other two legs a `black`/`flake8`/`mypy` stack gives Python: a
> **formatter** and a **general + house-rule linter**. This brief adds them **under the exact
> constraints the existing gate established** — CI-only, ships nothing, offline/portable invariant
> untouched, near-zero dependency surface — and it spends its highest-value effort turning
> **hand-policed `CLAUDE.md` invariants into mechanical checks** (the Clock Contract, SPDX headers,
> retired vocabulary), because that is where a linter earns its place in *this* codebase, not generic
> whitespace hygiene.
>
> **Three parts, in leverage order** (independent; ship any alone):
> **Part A — House-invariant lints (ZERO new dependency; the marquee). ✅ COMPLETE 2026-07-06 (A1·A2·A3·A4).**
> New source-text gate groups in
> `tests/dex-tests.js`, siblings of the Phase-4b purity gate, that mechanize the Clock Contract / SPDX /
> retired-vocabulary rules. Runs in the runners that already exist. Highest value, lowest cost.
> **Part B — Formatter (ONE self-contained binary; on-touch only, NEVER big-bang). ✅ COMPLETE 2026-07-11
> (BIOME-FORMATTER brief Phases 0–1).** Biome (`@biomejs/biome@2.5.3`), a `black`-equivalent,
> check-only in CI (`format.yml` runs `biome ci --changed`), applied only to new files + whatever file you
> are already re-bundling — because a repo-wide reflow is **not** export-inert (§B2).
> **Part C — Widen the type gate opportunistically. ◻ OPEN — blocked on a `node tsc` host to verify green.**
> Grow the `tsconfig` `include` one de-DOMed module
> at a time. No big bang, ever.
>
> **Read first (do not relitigate):** `CLAUDE.md` §🔒 (Clock Contract — the rules Part A enforces) ·
> §📜 (licensing/SPDX) · §🎫 (evidence badges + retired vocabulary) · §🔏 (provenance gates + the
> re-bundle checklist — the §B2 footgun) · §🧪 (test gate). `ARCHITECTURE-PRINCIPLES.md` §6 (build) +
> §7 (forward-adopt). `SIGNAL-ADAPTER-AND-FRONTIER-2026-06-23-BRIEF.md` Phase 4 (the 4a/4b that shipped
> — **extend it, do not redo it**).

---

## 0. Ground truth — what already exists (orient before writing a line)

The type-checker leg is **DONE and CI-wired**. Do not re-implement it; build beside it.

- **`tsconfig.json`** — CI-only `tsc --noEmit --checkJs`, `allowJs`+`checkJs`, `strict:false` floor,
  scope = the clean CORE adapter layer only (`dex-contracts.js`, `signal-frame.js`, `dex-export.js`,
  `signal-spec.js`, `signal-adapters.js`, `dex-ingest.js`, `manifest-gate.js`, `adapters/*.js`). Its
  own header comment states the invariant: no emit, no shipped build, no runtime dep. **Part C extends
  the `include` list; it changes nothing else.**
- **`dex-contracts.js` / `signal-frame.js`** — the Phase-4a JSDoc `@typedef` contracts (`SignalFrame`,
  `SignalFrameProvenance`, …), declared ONCE, enforced by `tsc`. **Part A/B never touch these; Part C
  adds new `@typedef`s here as shared vocabulary grows.**
- **`tests/dex-tests.js` group 23 — "DSP-purity gate (Phase 4b)"** — the pattern Part A copies: a pure
  **source-text** assertion (no `document`/`window.`/`localStorage` in any `*-dsp.js`, legacy violators
  allow-listed with explicit reason strings). Zero dependency. Runs in both runners.
- **`tests/run-tests.mjs`** — the "pytest-for-JS" headless runner (`node tests/run-tests.mjs`, exit
  0/1/2, **zero npm dependencies**, `vm` sandbox). Part A rides this for free.
- **`.github/workflows/{types,tests,browser-gates}.yml`** — the three existing CI jobs (`types.yml`
  already installs the *one* dev tool, `tsc`). Part B adds a fourth sibling; Part A needs no new job
  (it rides `tests.yml`).
- **`CONTRIBUTING.md`** — where the local dev commands + the self-contained-compute rule live; Part B
  documents the formatter command here.
- **The still-open `SIGNAL-ADAPTER-FOLLOWUPS-IV-2026-06-25-BRIEF.md` §1** — a proposed
  "called-but-not-defined ⊆ allow-list" source-text gate. It is a Part-A-shaped rule; **fold it in as
  A4** rather than leaving it orphaned. **✅ DONE 2026-07-06 — folded in as A4 (below).**

---

## Part A — House-invariant lints (zero new dependency; the marquee)

> **✅ PART A COMPLETE 2026-07-06 — all four groups live in `tests/dex-tests.js` (both runners, headless
> floor), each with a documented allow-list + positive controls; no app re-bundled. Group tags:
> A1 `house-lint · dev-toolchain · clock` · A2 `· spdx` · A3 `house-lint · dev-toolchain` · A4 `· reachin`.
> DO NOT re-implement — extend if a new rule is wanted. Landing dates: A3 2026-07-04, A1+A2 2026-07-05,
> A4 2026-07-06.**

**Form.** Each rule is a new `group(...)` in `tests/dex-tests.js`, structurally a twin of group 23:
read `env.sources`, regex the authored source, fail with a precise message, **allow-list the sanctioned
exceptions by exact identifier/path with a reason string**. It runs in `node tests/run-tests.mjs` AND
`Dex-Test-Suite.html` with **no new dependency and no re-bundle** (test-layer only, zero gate cost — the
same "unbundled tools" free-change class the -II/-III briefs used). This is the house-native way to get
"lint rules": the project already proved the pattern; we are widening it from purity to the other
invariants `CLAUDE.md` currently polices by prose.

- **A1 · Clock-Contract enforcement (§🔒 — the single most-repeated "non-negotiable"). ✅ DONE 2026-07-05
  (group `house-lint · dev-toolchain · clock`).** Fail the build
  on the exact footguns the contract forbids:
  - `new Date(<string>)` / `Date.parse(...)` applied to a **vendor** timestamp (the contract mandates
    regex parsing; `new Date(str)` is locale-dependent). Allow-list the numeric-epoch path and the
    `tzOffset(instantMs) = new Date(instantMs).getTimezoneOffset()` helper (numeric arg only).
  - Local civil getters (`getHours` / `getMinutes` / `getSeconds` / `getFullYear` / `getMonth` /
    `getDate` **without** the `UTC` infix) anywhere a `tMs` is rendered — display MUST use the `getUTC*`
    family (contract §5). Allow-list `getTimezoneOffset` (the one legitimate local read).
  - `new Date()` / `Date.now()` used as a **parser fallback** (contract §2.6: a missing stamp must be
    `null`, never fabricated to "now").
  Ship each rule with **≥1 positive control** — a deliberately-bad source string the group is proven to
  catch — so the gate can't silently rot into a no-op. This is `mypy`-for-time: it moves the contract's
  "verification any time you touch time" checklist from human discipline into CI.
- **A2 · SPDX-header presence (§📜). ✅ DONE 2026-07-05 (group `house-lint · dev-toolchain · spdx`).**
  Every authored `*.js` / `*.mjs` / `*.src.html` and every
  `*-BRIEF.md` carries the header from `licensing/SPDX-HEADERS.txt` (`Copyright 2026 Michal Planicka` +
  `SPDX-License-Identifier: Apache-2.0`). Fail on missing, or on any surviving non-Apache identifier.
  Exclude generated/bundled `*.html`, `uploads/`, `docs-archive/`, fixtures.
- **A3 · Retired-vocabulary ban (§🎫 + §📜). ✅ DONE 2026-07-04 (group `house-lint · dev-toolchain`).**
  No evidence tier named `proxy` / `composite` /
  `"provisionally validated"` (retired → heuristic/emerging); no legacy umbrella strings `GanglioR` /
  `ANS Intelligence`. **Precisely allow-list the FROZEN identifiers** so the rule can never be weaponised
  against them: `ganglior.*` (event bus), the `ganglior.node-export` schema string, and the `fascia`
  input alias are permitted **verbatim** — the ban targets brand/tier prose, never the frozen codenames.
- **A4 · (fold-in) the -IV §1 reach-in allow-list. ✅ DONE 2026-07-06 (group `house-lint · dev-toolchain ·
  reachin`).** For each migrated `*-dsp.js`, the set of
  called-but-not-locally-defined identifiers ⊆ {`kernel-constants` exports, that node's `*-util`
  exports, documented builtins}. Lands as a sibling group; closes an orphaned proposal.
  > **How it landed (so you don't re-derive it):** a real char-SCANNER `scrub()` blanks comments /
  > strings / template literals / **regex literals** char-for-char before analysis — the crude
  > string-strip A4 was deferred over corrupts on regex literals holding quotes (e.g. `/^"|"$/g`) and
  > swallows function defs → false positives. `oxydex-util.js` was wired into `env.sources` (both
  > runners) as OxyDex's own `*-util` exports. `kernel-constants` needs no wiring — `DexKernel` is a
  > property read, never a bare call. Two nodes carry an ALLOW-LISTED drift ledger of known render/app/
  > profile reach-ins to guard on their next on-touch re-bundle: **oxydex-dsp** (renderAll · setStatus ·
  > showError · setProgress), **hrvdex-dsp** (rerender · setStatus · setProgress · getProfile ·
  > calcVo2Cat · inferFromData). All reached only on the app-orchestration path, never headless
  > `compute()` (proved clean by `env.equiv`).

**Done-when (A):** all new groups green in BOTH runners; each carries a positive control + a documented
allow-list; `Dex-Test-Suite.html` all-green; **no app re-bundled** (test-layer only). **✅ MET 2026-07-06
— headless floor 1963 passed / 2 skipped / 127 groups; provenance untouched.**

---

## Part B — Formatter (one self-contained binary; on-touch only, never big-bang)

> **✅ COMPLETE 2026-07-11 — executed by `BIOME-FORMATTER-2026-07-11-BRIEF.md` Phases 0–1.** Biome
> `@biomejs/biome@2.5.3` is a pinned `devDependencies` entry + committed lockfile; `biome.json` is tuned to
> the house style (2-space, single-quote, semicolons, `lineWidth: 200`, `linter`+`assist` off — formatter
> only, D1); `.github/workflows/format.yml` runs `biome ci --changed` (check-only, changed-files-only, D2/D3).
> Provenance untouched, 0 fixtures re-recorded (no shipped `*.js` reformatted — the §B2 proof). The §B2
> on-touch application of the formatter to shipped files is that brief's Phase 2 (ongoing by design).**

- **B1 · Tool.** Prefer **Biome** (`@biomejs/biome`) — a single self-contained binary that formats
  **and** lints, so it adds **one** dependency instead of the `prettier` + `eslint` + `typescript-eslint`
  + N-plugins galaxy. This is the choice that respects the suite's zero-dependency ethos; `types.yml`
  already sets the precedent of one pinned dev tool (`tsc`). **Prettier + ESLint** is the mainstream
  fallback if a reviewer wants the larger ecosystem — but justify the extra surface. (Whichever: it is a
  **devDependency**, never shipped, never fetched at runtime — the 100 %-local invariant is untouched,
  exactly as `tsc` is.)
- **B2 · ⚠ THE PROVENANCE FOOTGUN — read before running the formatter on anything.** Reformatting a
  **shipped** `*.js` changes its source bytes; re-bundling then moves that app's **`manifestHash`**,
  which per `CLAUDE.md` §🔏 forces a full **fixture re-record** for that node — for **identical
  behavior**. A repo-wide "format everything" commit would therefore flip **every** provenance fixture
  across all 8 bundles for zero functional change. **So: NO big-bang reformat, ever.** Enforce format
  **check-only in CI** (`biome ci` / `--check` — never `--write`), and *apply* the formatter only to
  **(a) net-new files** and **(b) the one file you are already re-bundling on-touch** — the formatting
  folds into a re-bundle you were already paying for. This is precisely `OWN-THE-BUILD` Part C's
  "one file at a time, the next time you're already in it," applied to whitespace.
- **B3 · Config = minimize churn vs. the existing hand-style.** Tune indent width, quote style, and line
  width to match what the files already do, so an on-touch diff is a handful of lines, not a rewrite.
  Formatters reindent but never rewrite **comment contents** — the box-drawing separators (`════`) and
  aligned block headers survive. **Pin the tool version** (lockfile / pinned CI install) so formatting is
  deterministic across machines.
- **B4 · Scope.** Authored source + `tests/` + `tools/` (if `OWN-THE-BUILD` Part A has landed) +
  `adapters/`. **Exclude** bundled `*.html` (generated), `uploads/`, `docs-archive/`, `papers/*.html`,
  all fixtures, and vendor-shaped sample files. HTML is out of Biome's lane — the `*.src.html` shells are
  thin JS-reference wrappers with little to format; a dedicated HTML formatter/validator is an optional
  **Tier-3** follow-up, `.src.html`-only, on-touch, not in this brief.

**Done-when (B): ✅ MET 2026-07-11.** `biome ci --changed` is wired as a fourth CI sibling (`format.yml`,
check-only); `verify-provenance.html` GATE A/B is untouched and **no fixture was re-recorded** (proof the
formatter ran on zero shipped files big-bang). See `BIOME-FORMATTER-2026-07-11-BRIEF.md` for the tuned
config, the Phase-0 churn measurements, and the on-touch (Phase 2) discipline.

---

## Part C — Widen the type gate opportunistically

> **⟳ STARTED 2026-07-13 — the `node tsc` host materialised, so the blocker is gone.** Three NON-bundled
> modules added to `tsconfig.include` (zero manifestHash churn), each proven green with the exact `types.yml`
> pin BEFORE landing: **`event-coupling.js` · `dex-coload.js` · `provenance-banner.js`**. Idiom recorded in
> `tsconfig.json` `//d2`: cast the `root.X = …` export via `/** @type {any} */ (root).X` (the IIFE-arg type
> wins over a `@param`, and `module.exports = X` poisons the `this` fallback), and reach Node's `process`
> through `/** @type {any} */(globalThis).process`. `nsrr-adapter.js` deferred (bare `processNight` global —
> a runtime dependency, not a type-only fix).
>
> **⟳ 2nd pass 2026-07-13 — first DSP gated, and it cost NO re-bundle.** `pulsedex-dsp.js` added: its 16
> errors were ALL `TS2304` for co-loaded globals (`DexClock`/`DexExport`/`SignalFrame`/`dexScrubExport`), so
> a new ambient **`dex-globals.d.ts`** (declares them `any` — dev-time only, no runtime/emit) cleared the DSP
> with **zero source edit → no manifestHash churn**. The lesson reshapes the plan: **a bundled `*-dsp.js`
> whose only errors are co-loaded-global `TS2304` is a FREE add** (declare the name in `dex-globals.d.ts`);
> only real `TS2339`/property or DSP-reaches-render-sibling errors force a source edit + re-bundle. **Still
> OPEN:** glucodex/ecgdex/cpapdex/ppgdex/hrvdex/integrator/oxydex-dsp — each carries such real errors
> (render-sibling reach-ins like `setStatus`/`UP`, arithmetic, property access), so each is a genuine fix.
>
> Prior note (blocker now cleared): *needs a `node tsc --noEmit --checkJs` host to prove each newly-included
> module is green BEFORE it lands. Do not expand `tsconfig.include` blind — an unverifiable add risks
> reddening `types.yml` in CI.*

The `tsconfig` scope is deliberately forward-first (core adapters only). Grow it **one module at a time**
as each legacy `*-dsp.js` / `*-render.js` / `*-app.js` is de-DOMed and JSDoc-annotated — the
`pulsedex-dsp.js` "Phase 4b positive control" purity block is the shape of a module ready to be added.
Add new `@typedef`s to `dex-contracts.js` as the shared vocabulary grows; keep the `strict:false` floor
and tighten per-file only where the file is already clean. **Never a big-bang `include` expansion** — each
addition must pass `tsc --noEmit --checkJs` before it lands, so `types.yml` stays green at every step.

**Done-when (C):** any module newly added to `tsconfig.include` passes `tsc`; `types.yml` green.

---

## Wiring, CI & the package.json question

- **Part A** needs **no new workflow** — it lives in `tests/dex-tests.js`, so `tests.yml` +
  `node tests/run-tests.mjs` + `Dex-Test-Suite.html` already run it.
- **Part B** adds **`.github/workflows/format.yml`**, a check-only sibling of `types.yml`.
- **`package.json`.** The repo has none today (the Node tooling is raw `.mjs` run with `node`). Two
  pinned dev tools (`tsc`, Biome) now justify a **minimal root `package.json`** — `"private": true`,
  `devDependencies` pinned, `scripts` for `format` / `lint` / `typecheck` / `test` — with a lockfile for
  determinism. It declares **only devDependencies**: nothing ships, no `dependencies`, no runtime import,
  no CDN. Document the four commands in `CONTRIBUTING.md`. (If a reviewer prefers zero manifest, keep the
  `types.yml` pinned-install pattern instead — Part A needs nothing either way.)

  > **✅ SPINE LANDED 2026-07-06 (owner directive "build spine", scripts-only variant — the reviewer
  > preference above).** Shipped the minimal root **`package.json`** as a **dev-tooling manifest ONLY**:
  > `private:true`, **NO `devDependencies` / `dependencies` and NO lockfile** — the two pinned tools
  > (`tsc@5.5.4`, `eslint@8.57.0`) self-install via `npx -y` inside the scripts, so the `types.yml`
  > pinned-install pattern is preserved and nothing ships or is fetched at runtime (100%-local invariant
  > untouched). **Biome was added 2026-07-11** (Part B) as the FIRST real `@biomejs/biome@2.5.3`
  > `devDependencies` entry + committed `package-lock.json`, with `format`/`format:check`/`format:changed`
  > scripts — installs via `npm ci`, still ships nothing at runtime. `scripts` unify the whole surface —
  > `check` (typecheck→lint→test→build-core→build:check→
  > verify:manifest, the Node-lane floor), `test`, `typecheck`, `lint`, `build`/`build:app`/`build:check`,
  > `verify:manifest`, `gates:browser`, `gen:lists`, `release`/`release:dry`. All four CI workflows
  > (`types`/`lint`/`tests`/`browser-gates`) now route through these scripts (single source of the
  > command surface), and `browser-gates.yml` no longer `npm init -y`s over the committed manifest.
  > `CONTRIBUTING.md` §4.5 documents the commands; changeset `changes/2026-07-06-dev-toolchain-npm-spine.md`.
  > The `version` field is a `0.0.0` placeholder with a `_version_note` — the canonical suite SemVer stays
  > **only** in `suite.manifest.json` (no version fork). No app re-bundled; provenance untouched.
  > **Part B landed 2026-07-11** — the spine now carries the pinned `@biomejs/biome` devDependency + lockfile.

---

## Guardrails (do-not)

- **Ships nothing.** No emit, no runtime dependency, no CDN, offline/portable invariant untouched — the
  same contract `tsconfig.json` and `types.yml` already state. If any of this reaches a bundle, it's wrong.
- **Never big-bang the formatter** (§B2). A standalone repo-wide reflow commit is forbidden; it churns
  every provenance fixture for zero behavior change.
- **Never touch the FROZEN identifiers.** `ganglior.*`, the `ganglior.node-export` schema, and the
  `fascia` alias are allow-listed verbatim by A2/A3 — the rules police brand/tier prose, not codenames.
- **False-positive discipline.** A lint that cries wolf gets disabled and the invariant is lost. Every
  Part-A rule ships with a documented allow-list AND a positive control; if a rule can't be made precise,
  it doesn't land.

## Gates (both still rule)

- **`Dex-Test-Suite.html` all-green** after Part A (new groups included) — the canonical behavior gate.
- **`verify-provenance.html` GATE A/B clean** and **no fixture re-recorded** — the proof Part B did not
  big-bang any shipped file. No bundle is re-bundled *for this brief*; formatter changes only ever ride an
  independently-motivated on-touch re-bundle.

## Lifecycle (per `CLAUDE.md`)

Date is in this filename — set once, **never rename**. Parts A/B/C are independently shippable; flip the
header to `Status: IN-PROGRESS` on partial landing and `DONE — <today>` once **all** "Done-when" items are
met and the gates above are green. Keep `DOCS-INDEX.md` in sync when the status flips. After execution,
spawn `DEV-TOOLCHAIN-FOLLOWUPS-YYYY-MM-DD-BRIEF.md` for what surfaced (e.g. the Tier-3 HTML formatter, or
Part-A rules that proved too noisy) — or say in this header that nothing surfaced.
