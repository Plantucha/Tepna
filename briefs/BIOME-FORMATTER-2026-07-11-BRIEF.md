<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-07-11 (**Phases 0–1 LANDED**; **Phase 2 first application DEMONSTRATED** — riding SECURITY-REMEDIATION Phase A's EXPORT-INERT re-bundle, the touched shipped files (`oxydex-app/dsp/util.js`, `pulsedex-app.js`, new `dex-escape.js`) were Biome-formatted on-touch, not standalone; the changed-file format gate forced every touched `*.js` (incl. `tests/*.js`) Biome-clean. **Phase 3** lint-migration still deferred) · **Created:** 2026-07-11 · **Executes:** `DEV-TOOLCHAIN-2026-06-30-BRIEF.md` Part B (Formatter) · **Requires:** a Node host with npm (the Biome binary — not runnable in the current sandbox)

# Biome — code formatter for Tepna (one self-contained binary, check-only, on-touch, never big-bang)

> **What this is.** The execution brief for `DEV-TOOLCHAIN` Part B: adopt **Biome** (`@biomejs/biome`) as
> the suite's code formatter. It **extends, does not relitigate** Part B — the tool choice (Biome over the
> prettier+eslint galaxy), the devDependency posture, and the §B2 provenance footgun are settled there and
> restated below only as the load-bearing constraints. The whole design turns on **one** idea: a formatter
> that reflows shipped `*.js` would move every bundle's `manifestHash` and force a full fixture re-record for
> **identical behavior** (CLAUDE.md §🔏). So Biome is adopted **check-only, on changed files only** — it never
> reformats the untouched tree, and reformatting only ever rides an on-touch re-bundle you were already paying.

**Non-negotiable inheritances (from DEV-TOOLCHAIN §B / CLAUDE.md):**
- **devDependency, never shipped, never fetched at runtime.** Exactly like `tsc` (`types.yml`). The 100%-local
  / no-CDN / single-file invariant is untouched — Biome is a dev tool, not a runtime dep.
- **NO big-bang reformat, EVER (§B2).** A repo-wide `--write` would flip all 8 bundles' fixtures for zero
  functional change. Enforcement is **`--check` only in CI**; `--write` is applied only to (a) net-new files
  and (b) the single file you are already re-bundling on-touch.
- **Edit `*.js`/`*.src.html` + re-bundle via the owned build; never the bundled `.html`.**

---

## 0 · Ground truth (orient before writing a line)
- **Style is already consistent by hand:** 2-space **spaces** (not tabs), **single** quotes (824:28 in a
  sample DSP), semicolons always, dense one-liners, box-drawing comment banners (`════`). Biome's *defaults*
  disagree (tab indent, double quotes) — so the config must be **tuned to the house style** or every file
  reds. Tuning-to-existing is the whole game (§B3): a good config makes `biome check` on the current tree a
  near-noop, so the gate is real, not a 10 000-line diff.
- **CI today:** `lint.yml` (ESLint `npx -y eslint@8.57.0`), `types.yml` (`tsc`), `tests.yml`, `no-network.yml`,
  `browser-gates.yml` (manual). Biome adds **one** sibling (or folds into `lint.yml`) — a decision (§D2).
- **`package.json`** exists as the private dev-tooling spine (no runtime deps, ships nothing) but has **no
  `devDependencies` block and no lockfile** — Part B "promotes the spine to a pinned devDependency + lockfile
  WHEN this lands." That promotion is this brief.
- **The reconciling mechanism = Biome `--changed`.** Biome can check only files changed vs a base branch
  (VCS-integrated). This is what makes "adopt a formatter" compatible with "never touch the legacy tree":
  CI checks only what a PR changed, so untouched unformatted files never red and never re-bundle.

## 1 · Decisions to record first (owner calls — put the answers in this brief before Phase 1 lands)
- **D1 · Biome's role: format-only, or format + lint (retire ESLint)?** Biome does both. The DEV-TOOLCHAIN
  ethos ("one dependency, not the prettier+eslint galaxy") points at Biome eventually owning both. **Recommend:
  Phase 1 = formatter ONLY, keep ESLint** (smaller blast radius; Biome's lint rules differ from the current
  ESLint config and would need their own tuning). **Migrating lint to Biome + retiring `lint.yml` is Phase 3
  (deferred, its own decision)** — don't couple it to landing the formatter.
- **D2 · CI wiring: new `format.yml`, or extend `lint.yml`?** **Recommend a new `format.yml`** sibling
  (single-responsibility, mirrors `types.yml`) running `biome ci --changed`. Folding into `lint.yml` is fine
  if you prefer fewer jobs — but keep format check-only and changed-only regardless.
- **D3 · Enforcement surface: `--changed` (recommended) vs whole-tree.** `--changed` (changed-vs-`main`) is
  the §B2-safe default — it never demands the legacy tree be reformatted. A whole-tree `biome check` is only
  viable if the tuned config already makes the ENTIRE current tree pass (verify empirically in Phase 0; if it
  does, whole-tree is a stronger gate — but expect it won't, given the dense hand-style, so plan on `--changed`).

## 2 · Phase 0 — tune the config to the house style (measure, don't guess) [no commit yet]
On a Node host, in a throwaway worktree/copy:
1. `npx -y @biomejs/biome@<pin> init` → a `biome.json`.
2. Set the formatter to match the de-facto style (starting point — then MEASURE):
   ```jsonc
   {
     "$schema": "https://biomejs.dev/schemas/<pin>/schema.json",
     "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true, "defaultBranch": "main" },
     "files": { "includes": ["**/*.js", "**/*.mjs", "tests/**", "tools/**", "adapters/**",
                 "!**/*.html", "!uploads/**", "!docs-archive/**", "!papers/**", "!codegen/generated/**",
                 "!node_modules/**", "!**/*fixture*", "!**/*.min.js"] },
     "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 120,
                    "lineEnding": "lf" },
     "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "always",
                     "trailingCommas": "none", "arrowParentheses": "always" } },
     "linter": { "enabled": false }   // Phase 1 = formatter only (D1)
   }
   ```
3. **Measure the churn:** `biome format --write` on the copy, then `git diff --stat`. Tune `lineWidth`
   (dense one-liners want a HIGH width — 120 or more — so Biome doesn't rewrap them), `trailingCommas`,
   `arrowParentheses`, quote/semicolon until the diff is **minimal and mechanical** (whitespace only; no
   comment-content changes — verify the `════` banners survive). Record the final config's churn magnitude in
   this brief. If a setting can't get churn near-zero on the legacy tree, that just confirms `--changed` is the
   right surface (D3) — the legacy tree is never reformatted anyway.
4. **Pin the version** (`@biomejs/biome@x.y.z`) so formatting is deterministic across machines.

### Phase 0 — EXECUTED 2026-07-11 (measured on a Node 22 host, Biome pinned `@biomejs/biome@2.5.3`)
- **Version pinned:** `2.5.3` (latest stable; its `files.includes` glob-negation syntax matches the config
  sketch above — this is a Biome **2.x** config, not 1.x).
- **House line-length distribution** over authored `*.js`/`*.mjs` (60 520 lines): p50 = 58, **p90 = 124**,
  p95 = 165, **p99 = 238**, max = 1687 — a real dense-one-liner tail well past 120.
- **Churn vs. `lineWidth`** (`biome format --write` on a clean tree → `git diff --shortstat -- '*.js' '*.mjs'`,
  reverted after each). ~38 k deletions are width-*independent* (object-literal expansion + paren
  normalization); only the insertions move with width:

  | lineWidth | files | insertions | deletions |
  |---|---|---|---|
  | 100 | 127 | 96 305 | 38 580 |
  | 120 | 127 | 88 579 | 38 391 |
  | 160 | 127 | 78 329 | 38 255 |
  | **200** ✅ | 127 | **72 447** | 38 242 |
  | 240 | 127 | 69 657 | 38 249 |
  | 320 | 128 | 67 237 | 38 286 |

- **Decision — `lineWidth: 200`.** The churn curve knees around 160–200; 200 covers ~p99 of the existing
  tail, so nearly all dense one-liners survive unwrapped (minimal on-touch churn) without letting
  pathological 300-char lines through. Indent = 2 spaces, single quotes, semicolons always, no trailing
  commas, always-parens arrows — matches the hand-style. `linter` **and** `assist` (import-sort) are OFF
  (D1 = formatter-only; assist is separate from `linter` and on by default — it must be disabled or it
  fires "Sort these imports" in CI).
- **Whole-tree is NOT near-zero at any width (127 files, ~70 k lines).** This empirically **confirms D3**:
  the legacy tree is never whole-tree formatted; CI enforces `--changed` only.
- **Banners + SPDX survive:** box-drawing separators (`════`/`━━━`) and SPDX header lines are byte-identical
  after formatting — only whitespace/indentation moves; no comment *content* is ever rewritten (verified).
- **JSON ledgers are safe:** scope is `*.js`/`*.mjs` only, so `package.json`, `BUILD-MANIFEST.json`,
  `FIXTURE-PROVENANCE.json`, `suite.manifest.json` and all fixtures report "Checked 0 files" — Biome
  processes only its own `biome.json` among JSON. Scope also excludes `docs/`, `scraps/`, `uploads/`,
  `docs-archive/`, `papers/`, `codegen/generated/`, `node_modules/`, `*.min.js`, `*fixture*` (aligned with
  the ESLint ignore set). Total in-scope: **128** files.
- **CI empty-set guard:** `biome ci --changed` exits 1 with "No files were processed" on a docs/config-only
  PR; `--no-errors-on-unmatched` keeps that green. Verified: a committed misformatted `*.mjs` → red; empty
  in-scope set → green.

## 3 · Phase 1 — introduce Biome (config + deps + CI), ZERO reformatting [no re-bundle]
- Commit the tuned **`biome.json`** (from Phase 0) at repo root.
- **Promote `package.json`:** add `"devDependencies": { "@biomejs/biome": "x.y.z" }` (pinned) + commit the
  generated **lockfile**; add scripts: `"format": "biome format --write"`, `"format:check": "biome ci"`,
  `"format:changed": "biome ci --changed"`. Keep it `"private": true`, no runtime deps (invariant intact).
- **CI `format.yml`** (D2) — a sibling of `types.yml`: `npm ci` (or `npx -y @biomejs/biome@x.y.z`) then
  `biome ci --changed` (D3). Check-only — **never `--write` in CI**. On a PR it validates only the changed
  files, so it's green from day one on the untouched tree and enforces format on everything new/touched.
- **`CONTRIBUTING.md`:** document `npm run format` (net-new/on-touch), the check-only-in-CI rule, and the §B2
  "never reformat a shipped file except during its own on-touch re-bundle" rule.
- **CRITICAL — prove zero provenance impact:** Phase 1 touches only `biome.json` / `package.json` / lockfile /
  `format.yml` / `CONTRIBUTING.md` — **no `*.js` reformatted, no bundle re-built.** Confirm
  `verify-provenance.html` GATE A/B **untouched** and **no fixture re-recorded** — that is the proof the
  formatter was adopted big-bang-free. Drop a `bump: minor` changeset (a new dev gate/tool — additive).

## 4 · Phase 2 — on-touch application (the only way a shipped file ever gets reformatted)
- **Net-new files:** run `npm run format` (biome `--write`) on them before commit — they're Biome-clean by
  construction, no re-bundle question (new files aren't yet bundled, or their first bundle is their baseline).
- **Existing shipped `*.js`:** reformat **only** when you are ALREADY re-bundling that app for a behavioral
  change — fold `biome format --write <thatfile>` into that re-bundle. The whitespace churn rides a
  `manifestHash` move + fixture re-record you were paying anyway (EXPORT-INERT if behavior is unchanged; per
  its own change's §🔏 checklist). **Never** reformat a shipped file standalone.
- This is `OWN-THE-BUILD` Part C's "one file at a time, next time you're in it," applied to whitespace — and it
  pairs naturally with the **Phase-3 fleet re-bundle** (SECURITY-REMEDIATION B/C, version-stamping, §5.9): any
  app re-bundled in that batch can be Biome-formatted in the same pass, converting the legacy tree gradually
  with zero *extra* churn.

## 5 · Phase 3 — (DEFERRED, decision D1) migrate lint to Biome, retire ESLint
Only if the owner wants Biome to own linting too: port the needed rules to `biome.json` `linter.rules`, run
`biome ci --changed` for lint as well, retire `lint.yml` + the `npx eslint` script. Its own brief — it changes
what CI enforces and needs rule-by-rule review against the current ESLint config. **Not in this brief's scope.**

## 6 · Scope (B4) — what Biome touches
**Include:** authored `*.js`/`*.mjs`, `tests/`, `tools/`, `adapters/`. **Exclude:** bundled `*.html`
(generated), `*.src.html` (HTML is out of Biome's JS lane — a dedicated HTML formatter is an optional Tier-3
follow-up, not here), `uploads/`, `docs-archive/`, `papers/*.html`, `codegen/generated/`, all fixtures, vendor
sample files, `node_modules/`. Encoded in `biome.json` `files.includes` (§2) — keep it beside the `tsconfig`
scope so the two dev-tool scopes are legible together.

## 7 · Gates & provenance
- **Phase 1:** `verify-provenance.html` GATE A/B **unchanged**, **zero fixtures re-recorded** (the definitive
  proof of no big-bang). `Dex-Test-Suite.html?full` + all existing CI green. New `format.yml` green.
- **Phase 2:** each on-touch reformat rides an existing re-bundle — honor that change's §🔏 (GATE-A
  `manifestHash` update + fixture re-record, EXPORT-INERT if behavior unchanged). No *separate* provenance
  event for formatting.
- **Determinism:** pinned Biome version + lockfile → identical output on every host (same requirement as
  `manifestHash` determinism).

## 8 · Host requirement (why this can't run in the current sandbox)
Biome is a native binary installed via npm (`@biomejs/biome`). The current agent sandbox has **no Biome binary
and no npm install path** (same class of block as `node tsc` for DEV-TOOLCHAIN Part C). Execute on a Node dev
host (or a CI runner) with npm. The config + CI YAML can be *authored* anywhere, but Phase 0's measure-the-churn
step and Phase 1's `npm ci` need the binary. Record the Phase-0 churn numbers here once measured.

## 9 · Done-when
- **Phase 1:** `biome.json` (tuned, version-pinned) + `package.json` `devDependencies`+lockfile + `format.yml`
  (`biome ci --changed`, check-only) committed; `CONTRIBUTING.md` documents the workflow + the §B2 rule;
  `verify-provenance` GATE A/B untouched with **0 fixtures re-recorded**; all CI + `?full` green; changeset dropped.
- **Phase 2:** the on-touch rule is documented and demonstrably followed on the next re-bundle (a formatted file
  lands via an EXPORT-INERT re-bundle, not standalone).
- **Overall:** DEV-TOOLCHAIN Part B flips from "◻ OPEN" to done in that brief's header; a
  `BIOME-FORMATTER-FOLLOWUPS-…` brief is spawned only for deferred items (Phase 3 lint-migration, or a Tier-3
  HTML formatter) — else say so here.

## 10 · Scope guard
devDependency only — never shipped, never fetched at runtime (100%-local untouched). **Never** big-bang
reformat; **never** `--write` in CI; reformat a shipped file **only** during its own on-touch re-bundle. Do not
change any `compute()`/export/`ganglior.*`/Clock-Contract/metric identity — formatting is whitespace, and a
whitespace change to a shipped file that ISN'T riding a behavioral re-bundle is exactly the §B2 footgun to avoid.

## Cross-references
- `DEV-TOOLCHAIN-2026-06-30-BRIEF.md` Part B (the plan this executes) + Part A (the shipped house-lint pattern) + Part C (the same "one file at a time" discipline, applied to types).
- `CLAUDE.md` §🔏 (provenance / re-bundle / EXPORT-INERT — the §B2 footgun) · §📦 (changeset per work-unit) · §🧪 (test gate) · §📜 (SPDX — Biome must preserve headers).
- `OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md` §5 Part C + `SECURITY-REMEDIATION-2026-07-11-BRIEF.md` Phase B/C — the on-touch fleet re-bundle Phase 2 rides.
- `tsconfig.json` / `types.yml` — the precedent: one pinned dev tool, CI-only, no runtime dep, scoped `include`.
- `CONTRIBUTING.md` — where the dev commands + the on-touch rule are documented.
