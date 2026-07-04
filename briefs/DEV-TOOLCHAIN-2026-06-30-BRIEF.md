<!--
  DEV-TOOLCHAIN-2026-06-30-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->

**Status:** PROPOSED · **Created:** 2026-06-30 · **Follows:** `OWN-THE-BUILD-2026-06-30-BRIEF.md` (shares the *construction-enforcement over drift-suppression* thesis + the Node-host reality) · **Continues:** `SIGNAL-ADAPTER-AND-FRONTIER-2026-06-23-BRIEF.md` Phase 4 (which shipped 4a/4b — this is "Phase 4, the two missing legs")

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
> **Part A — House-invariant lints (ZERO new dependency; the marquee).** New source-text gate groups in
> `tests/dex-tests.js`, siblings of the Phase-4b purity gate, that mechanize the Clock Contract / SPDX /
> retired-vocabulary rules. Runs in the runners that already exist. Highest value, lowest cost.
> **Part B — Formatter (ONE self-contained binary; on-touch only, NEVER big-bang).** A `black`-equivalent,
> check-only in CI, applied only to new files + whatever file you are already re-bundling — because a
> repo-wide reflow is **not** export-inert (§B2).
> **Part C — Widen the type gate opportunistically.** Grow the `tsconfig` `include` one de-DOMed module
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
  A4** rather than leaving it orphaned.

---

## Part A — House-invariant lints (zero new dependency; the marquee)

**Form.** Each rule is a new `group(...)` in `tests/dex-tests.js`, structurally a twin of group 23:
read `env.sources`, regex the authored source, fail with a precise message, **allow-list the sanctioned
exceptions by exact identifier/path with a reason string**. It runs in `node tests/run-tests.mjs` AND
`Dex-Test-Suite.html` with **no new dependency and no re-bundle** (test-layer only, zero gate cost — the
same "unbundled tools" free-change class the -II/-III briefs used). This is the house-native way to get
"lint rules": the project already proved the pattern; we are widening it from purity to the other
invariants `CLAUDE.md` currently polices by prose.

- **A1 · Clock-Contract enforcement (§🔒 — the single most-repeated "non-negotiable").** Fail the build
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
- **A2 · SPDX-header presence (§📜).** Every authored `*.js` / `*.mjs` / `*.src.html` and every
  `*-BRIEF.md` carries the header from `licensing/SPDX-HEADERS.txt` (`Copyright 2026 Michal Planicka` +
  `SPDX-License-Identifier: Apache-2.0`). Fail on missing, or on any surviving non-Apache identifier.
  Exclude generated/bundled `*.html`, `uploads/`, `docs-archive/`, fixtures.
- **A3 · Retired-vocabulary ban (§🎫 + §📜).** No evidence tier named `proxy` / `composite` /
  `"provisionally validated"` (retired → heuristic/emerging); no legacy umbrella strings `GanglioR` /
  `ANS Intelligence`. **Precisely allow-list the FROZEN identifiers** so the rule can never be weaponised
  against them: `ganglior.*` (event bus), the `ganglior.node-export` schema string, and the `fascia`
  input alias are permitted **verbatim** — the ban targets brand/tier prose, never the frozen codenames.
- **A4 · (fold-in) the -IV §1 reach-in allow-list.** For each migrated `*-dsp.js`, the set of
  called-but-not-locally-defined identifiers ⊆ {`kernel-constants` exports, that node's `*-util`
  exports, documented builtins}. Lands as a sibling group; closes an orphaned proposal.

**Done-when (A):** all new groups green in BOTH runners; each carries a positive control + a documented
allow-list; `Dex-Test-Suite.html` all-green; **no app re-bundled** (test-layer only).

---

## Part B — Formatter (one self-contained binary; on-touch only, never big-bang)

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

**Done-when (B):** `biome check` (or chosen tool) passes on the format-scoped set; a `format.yml` CI job
is green as a fourth sibling; **`verify-provenance.html` GATE A/B is untouched and no fixture was
re-recorded** (proof the formatter ran on zero shipped files big-bang).

---

## Part C — Widen the type gate opportunistically

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
