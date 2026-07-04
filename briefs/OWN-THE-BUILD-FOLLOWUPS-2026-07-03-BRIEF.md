<!--
  OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->

**Status:** PROPOSED · **Created:** 2026-07-03 · **Follows:** `OWN-THE-BUILD-2026-06-30-BRIEF.md`

# Own the build — follow-ups (Part A Phases 0–3 DONE; Phase 4 + A5 + Parts B/C/D remain)

> **▶ NEXT CODER — RESUME HERE (2026-07-03; this thread may have closed mid-brief).** Current state:
> **all 8 bundles are owned deterministic plain-inline**, and BOTH gates are GREEN (`verify-provenance.html`
> GATE A/B + `Dex-Test-Suite.html?full` all-green, `bootSkips: []`). Tooling shipped: `tools/build-core.js` +
> `tools/build.mjs` + `tools/build.html`, `tests/build-core-tests.mjs` (in `tests.yml`), `manifest-gate.js`
> dual-branch. **Do NOT redo Phase 0–3.** Continue in this order: **(1) §5 Part D.1 ESLint** (cheapest standalone
> win, no dependency on anything else). **(2) §2 Phase 4** — single-source `ans-design.css` (delete the
> `ANS-DESIGN-START` mirror from `OxyDex.src.html`+`HRVDex.src.html`, add `<link href="ans-design.css">`; verify
> mirror≡file first), then retire the now-UNUSED legacy `__bundler/manifest` branch (`manifest-gate.js` +
> `verify-manifest.mjs` guard + `verify-provenance.html` extractor), drop inert `buildHash`, rewrite `CLAUDE.md`
> §🔏 / `ARCHITECTURE-PRINCIPLES` §6 / `audits/AUDIT.md` 2a. **(3) §3 A5** single `clock.js` (needs human
> ratification — contradicts `CLAUDE.md` §🔒). **(4) §5 Parts B/C.** **§6 = the orchestrator open question.**
> **Gotchas:** rebuild ONLY via `node tools/build.mjs --app <Name>`/`--all` or run_script over `build-core.js`
> (**never `super_inline_html`** — regresses to legacy; **never browser `fetch`** to read source — this preview
> injects editor artifacts, §4). After ANY rebuild run both gates + `node tests/build-core-tests.mjs` +
> `node tools/build.mjs --check`.

> **What landed 2026-07-03 (parent Part A, Phases 0–3, gate-verified).** The repo now OWNS its build.
> - **`tools/build-core.js`** — dependency-free, pure string→string PLAIN-INLINE bundler + a pure-JS
>   synchronous SHA-256 (runs in the opaque-origin sandbox / node:vm where `crypto.subtle` is absent).
>   Single forward pass over the source (never rescans an inlined body); every executed block ships as
>   `<script|style data-inline-src="…">` text; byte-deterministic (no timestamps / random / build date).
> - **`manifest-gate.js`** — gained a **plain-inline branch** in `manifestHashFromText` (dual-branch: legacy
>   `__bundler/manifest` bundles still hash the old way). `verify-provenance.html` + `tests/verify-manifest.mjs`
>   inherit it unchanged (shared module). New exports `isPlainInline` / `plainInlineAssets`.
> - **`tools/build.mjs`** — Node CLI (`--app` / `--all` / `--check`), a thin fs wrapper over `build-core.js`;
>   writes the bundle AND re-stamps `BUILD-MANIFEST.json` + that bundle's code-gated `FIXTURE-PROVENANCE.json`
>   records (ledgers as build outputs). `--check` is READ-ONLY and scoped to OWNED bundles (skips legacy),
>   so it's green across the mixed fleet and self-expands as bundles migrate.
> - **`tools/build.html`** — browser driver / cross-hasher-parity surface (read-only twin of `--check`).
> - **`tests/build-core-tests.mjs`** — KAT + determinism + **cross-hasher parity** (build-core sync SHA ≡
>   manifest-gate async `crypto.subtle` SHA) + committed≡build; wired into `tests.yml` with `build.mjs --check`.
> - **All 8 bundles migrated** to the owned plain-inline format (OxyDex `91196f73460c→5f46c7a88b65`, ECGDex
>   `→4d7552eb28b8`, PpgDex `→364106660aa9`, GlucoDex `→7e0ceb2281ed`, CPAPDex `→28db940c06c1`, Integrator
>   `→6c9176b212cc`, HRVDex `→afdc4e75d345`, PulseDex `3ab7dde7eb08→e12cbd684137`), all EXPORT-INERT (DSP
>   unchanged; code-gated fixtures re-stamped, outputs byte-identical; Integrator's are `historical:true` →
>   untouched). **PulseDex's stale captured IBM Plex Mono woff2 dropped** (owner decision — source is
>   system-fonts-only). **Both gates green:** `verify-provenance.html` GATE A all 8 `match ✓` + GATE B
>   reproducible; `Dex-Test-Suite.html?full` all-green (1748 passed, render-coverage boots all 8, `env.equiv.*`
>   byte-identical, `bootSkips: []`).
>
> **Phase 0 verdict — the plan-killer question is ANSWERED: ownership STICKS.** The owned `OxyDex.html`
> was NOT clobbered/async-rebuilt by the platform across minutes + two full gate runs (it still opens as
> the plain-inline `OxyDex.src.html` head, not the gzip `__bundler` shell). **No source relocation was
> needed** — building to the committed `Foo.html` path is safe in this environment. Part A is UNBLOCKED.

---

## §1 — Phase 3: fleet cutover (DONE 2026-07-03 — all 8 owned)

**DONE 2026-07-03** — ECGDex, PpgDex, GlucoDex, CPAPDex, Integrator, HRVDex migrated to owned plain-inline
(alongside OxyDex in Phases 0–2) via run_script over `build-core.js`, each with a strict DOMParser count check
(every `<script>`/`<style>` tagged, DOM count == emitted) before any ledger touch; ledgers re-stamped
transactionally; both gates green (GATE A all 8 `match ✓`, `Dex-Test-Suite.html?full` all-green). HRVDex kept
its inline `ANS-DESIGN-START` mirror (single-source cleanup is §2, like OxyDex). Method note for CI/future:
`node tools/build.mjs --app <Name>` does the same (build → write → re-stamp GATE-A + code-gated fixtures,
`historical:true` untouched). ⚠️ **Use `readFile`/Node `fs`, NOT browser `fetch`** for any rebuild — see §4.

- **PulseDex — DONE 2026-07-03** (`3ab7dde7eb08 → e12cbd684137`; owner chose to drop the font). Its **`.src.html` is system-fonts-only** (the §0 block
  explicitly states "no @font-face, no CDN"), but its **legacy gzip bundle carries a captured IBM Plex Mono
  woff2** as an inliner ext-resource (`CLAUDE.md` "Known non-issues" says *"leave it"*). Owning the build
  from the current source therefore **DROPS that font** (falls through to `ui-monospace`, exactly as the
  src comment intends). This is a real, if minor, visual change and it **contradicts the "leave it" note**.
  **Decision (owner, 2026-07-03): (a) — dropped.** The source is already system-fonts-only, so the plain-inline
  bundle faithfully reflects it; the captured woff2 lived only in the legacy gzip ext-resources. Verified the new
  bundle has zero `@font-face`/woff/font-data-URI; `CLAUDE.md` "Known non-issues" updated to match. (The
  alternative — restoring IBM Plex Mono via a base64 data-URI `@font-face` in the src — was NOT taken.)
- **Binary/ext-resource assets generally.** `build-core.js` inlines TEXT only (`*.js`/`*.css`). Confirmed
  none of the 8 sources reference a binary font/image FILE (icons are data-URIs, `ext_resources` were `[]`).
  If a future source adds one, either data-URI it in source or extend `build-core.js` to base64 it (the
  brief's fallback). The build asserts loudly on an un-inlinable ref rather than silently dropping it.

**Done when:** all 8 `Foo.html` are plain-inline; `node tools/build.mjs --check` clean (8 owned, 0 legacy);
`verify-provenance.html` GATE A/B green; `Dex-Test-Suite.html?full` all-green; `build.html` shows 8 owned.

## §2 — Phase 4: retire the workarounds + rewrite the docs (only after 8/8 migrated)

- **Single-source `ans-design.css`.** Delete the `ANS-DESIGN-START…END` hand-mirror + sha marker from
  `OxyDex.src.html` and `HRVDex.src.html`; add `<link rel="stylesheet" href="ans-design.css">` (the other 6
  already have it). The bundler inlines the ONE file → mirror drift becomes unrepresentable. Re-bundle those
  two; re-run gates. (Verify the mirror ≡ `ans-design.css` first so it stays EXPORT-INERT for behavior.)
- **Retire the legacy `__bundler/manifest` branch** in `manifest-gate.js` (+ the `verify-manifest.mjs`
  single-source guard regex, `verify-provenance.html` extractor) ONLY once every bundle is plain-inline.
- **Drop the inert `buildHash`** field fleet-wide from `BUILD-MANIFEST.json` (nothing reads it; owned bundles
  no longer carry a `__bundler/template` so the value is stale-by-construction). `ganglior-provenance.js`
  still stamps a fallback hash into exports — inert, leave it, or note it.
- **Rewrite the docs:** `CLAUDE.md` §🔏 (the re-bundle checklist becomes `node tools/build.mjs --all`
  + `--check`; the hand-update/EXPORT-INERT-re-record dance is gone for owned bundles), `ARCHITECTURE-PRINCIPLES.md`
  §6 (build), `audits/AUDIT.md` item 2a (the `ANS-DESIGN-START` hand-mirror is retired). Remove the
  `PROVENANCE-NONDETERMINISM` workaround references where they describe the now-removed cause.

## §3 — Phase A5 (OPTIONAL, needs human ratification): single `clock.js`

With an owned build, `parseTimestamp` can live in ONE `clock.js` inlined into every bundle — single source
AND still bundled-local. Retires the copy-paste + its drift test (`AUDIT.md` 2b). **This contradicts a
current `CLAUDE.md` §🔒 rule** ("duplicated … intentional; mirror it, don't extract"). Do NOT do it silently:
get a human yes, then update §🔒 in the same pass. DSP + Clock-Contract semantics do not change — only where
the one copy lives. Its own gated pass, not folded into §1/§2.

## §4 — Findings recorded during execution

- **Preview host injects editor artifacts into FETCHED HTML.** `fetch()` in this preview returns HTML with
  an injected `<style data-omelette…>` (direct-edit override block) and `data-cc-id` attrs that are NOT in
  the on-disk file. So `build.html`'s fetch-based reproduction can't byte-match the true build HERE; it
  detects the injection and marks the committed≡build leg `n/a`. **Node `build.mjs --check` (fs, raw bytes)
  and run_script `readFile` are authoritative** (both agree with `verify-provenance`). On a plain static host
  / CI this is a non-issue. Not a determinism bug in the core (proven: run_script build ≡ committed ≡
  verify-provenance recompute, all `5f46c7a88b65`).
- **`assertSafe` must use the spec RAWTEXT terminator** `</script[\s/>]` (whitespace / `/` / `>`), not
  `</script\s*>` — a body with `</script foo` closes the tag early. Fixed in `build-core.js`. The ESCAPED
  `<\/script>` (backslash) is correctly NOT a terminator (that is why app JS uses it in HTML strings).
- **The bundler MUST be single-pass over the source** and never rescan an inlined body — a naive multi-pass
  regex bundler double-tags `<script>`/`</script>` STRING LITERALS inside already-inlined app JS (found +
  fixed in Phase 0: 3 phantom tags the browser then treated as text). The per-build DOMParser count check
  (`script[data-inline-src]` DOM count == emitted count) catches this class; keep it in any migration harness.

## §5 — Parts B / C / D (independent; unblocked by Part A but not started)

- **Part B — born-clean the next node** (EEGDex / SpiroDex): headless `compute()` + registry-graded badges
  + `env.equiv` + adapter-only vendor parsing from commit one; a `BORN_CLEAN` gate in `tests/dex-tests.js`.
- **Part C — badge-by-construction:** make `MetricRegistry.badge()` the sole DOM path for a metric value,
  one render file at a time, guarded by a `BADGE_ENFORCED` source check.
- **Part D — static gates.** **D.1 ESLint is the cheapest standalone next win** — a new `.github/workflows/lint.yml`
  running ESLint over the source `*.js` (control-flow/dead-code floor: `no-unreachable`, `no-fallthrough`,
  `no-constant-condition`, `no-cond-assign`, `no-unused-vars`, `no-undef`, `eqeqeq`, `no-dupe-keys`,
  `no-self-assign`), version-pinned, **no `--fix` in CI** (autofix moves `manifestHash`). Independent of Part A;
  ship anytime. **D.2** widen `checkJs` to one `*-dsp.js` at a time. **D.3** Prettier ONLY inside the §1 fleet
  churn (a repo-wide reflow moves every hash). See the sibling `DEV-TOOLCHAIN-2026-06-30-BRIEF.md` (Clock/SPDX/
  retired-vocab source-text gates + Biome) — coordinate so ESLint and the house-invariant gates don't overlap.

## §6 — Orchestrators (Data Unifier + OverDex) — OPEN QUESTION (raised by owner 2026-07-03)

Both are **deliberately UNBUNDLED** loose HTML (source == served `.html`, ~23–26 loose `<script src>`) — the served
front-door, same-origin with the dexes (shared profile/longitudinal store); ORIENTATION notes they *"touch neither
gate"* by design. **Feasibility VERIFIED 2026-07-03:** `build-core.js` plain-inlines both cleanly + deterministically
(Data Unifier 9 KB→717 KB `e0b812300212`; OverDex 14 KB→831 KB `ac092cbb6921`; every `<script>` tagged, parse-OK).
So owning them is trivial — but it is a **deploy-model change, deliberately NOT done in this session**, because:
- They have **no `.src.html` split** — bundling in place overwrites the loose source, so it needs a `.src.html`→`.html`
  split like the dexes.
- They are **ungated** (no provenance fixtures / render-coverage). Loose = always reflects the CURRENT modules.
  Bundled = a frozen snapshot that can go **stale/drift** if a shared module changes without a rebuild, with **no gate
  to catch it** — UNLESS they are added to `build.mjs --check` (committed bundle ≡ build(src)), which closes that gap.

**Recommendation:** if downloadable single-file / offline orchestrators are wanted, split `<name>.src.html`, build the
owned `<name>.html`, and **add both to `build.mjs --check`** (a new non-provenance owned set) so drift IS caught.
Otherwise keep them loose (the current always-current design). **Needs owner direction before executing** — it reverses
a stated ORIENTATION design choice, so it was surfaced, not silently applied.

## Done when
Flip THIS brief per §📌 as each section lands. The parent `OWN-THE-BUILD-2026-06-30-BRIEF.md` flips to `DONE`
only when its Part A "Done when" checklist is fully met (8/8 migrated, ans-design single-sourced, docs
rewritten) with both gates green — Parts B/C/D flip independently.

## Cross-references
- `OWN-THE-BUILD-2026-06-30-BRIEF.md` (parent) · `tools/build-core.js` · `tools/build.mjs` · `tools/build.html`
  · `tests/build-core-tests.mjs` · `manifest-gate.js` (plain-inline branch) · `.github/workflows/tests.yml`.
- `DEV-TOOLCHAIN-2026-06-30-BRIEF.md` — the linter/formatter siblings (Part D overlap).
- `REGISTRY-INVERSION-2026-07-03-BRIEF.md` — its Phase 3 re-bundle "prefers sequencing after OWN-THE-BUILD Part A".
- `CLAUDE.md` §🔏 (re-bundle / provenance) · `ARCHITECTURE-PRINCIPLES.md` §6/§7 · `audits/AUDIT.md` 2a/2b.
