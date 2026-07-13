<!--
  OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->

**Status:** IN-PROGRESS — 2026-07-13 (**§2 docs rewrite DONE** — `CLAUDE.md` §🔏 was the last stale surface [the
retired hand-update prose was still the body text, with a "superseded" note bolted on top]; also corrected "8
bundles"→10 owned, retired the PROVENANCE-NONDETERMINISM "wait for the build to settle" rule whose cause is gone,
and fixed a 4th surface this brief never listed [`CONTRIBUTING.md`'s reconcile helper]. `ARCHITECTURE-PRINCIPLES`
§6 + `AUDIT.md` 2a were already correct. **§5 D.3 SATISFIED BY DESIGN** — Biome replaced Prettier+ESLint,
check-only/changed-only. **§5 D.2 PARTIAL** — `kernel-constants.js` typechecked [0 errors]; every other candidate
measured; the next wins are shared-spine and cost a fleet re-bundle. **Remaining: §5 Part B** [awaits EEGDex/
SpiroDex existing] **and the D.2 spine decision.** The 2026-07-06 "environment-blocked, no Node shell" note was
STALE — there is a Node host and `types.yml` was green all along) · **Created:** 2026-07-03 · **Follows:** `OWN-THE-BUILD-2026-06-30-BRIEF.md`

# Own the build — follow-ups (Part A Phases 0–3 DONE; Parts C / D.2 / D.3 + Part-B new-node remain)

> **▶ NEXT CODER — RESUME HERE (2026-07-03; this thread may have closed mid-brief).** Current state:
> **all 8 bundles are owned deterministic plain-inline**, and BOTH gates are GREEN (`verify-provenance.html`
> GATE A/B + `Dex-Test-Suite.html?full` all-green, `bootSkips: []`). Tooling shipped: `tools/build-core.js` +
> `tools/build.mjs` + `tools/build.html`, `tests/build-core-tests.mjs` (in `tests.yml`), `manifest-gate.js`
> dual-branch. **Do NOT redo Phase 0–3.** **⟳ UPDATE 2026-07-05 — Part A CLOSED (parent brief now DONE).** Items (1)–(3) + §6 are DONE (§5 Part D.1 ESLint ✅ shipped · §2 Phase 4 docs ✅ · §3 A5 ✅ · §6 orchestrators owned ✅). **⏳ What actually remains (updated 2026-07-06):** **§5 Part C** — ✅ **DONE 2026-07-07** (owner-authorized fleet churn): the full remaining bare-tile set (`cpapdex-render`·`glucodex-app`·`ppgdex-app`·`ecgdex-app`·`pulsedex-overview`·`hrvdex-app`·3×`*-profile.js`) now leads every metric-value tile with a badge; all 9 joined `BADGE_ENFORCED` (13 total). 6 bundles re-bundled EXPORT-INERT + fixtures re-stamped (ECGDex `48229de74680→32552465d29d`, PpgDex `d34cbfc49e5d→c233551ff16e`, GlucoDex `9b7feec22831→3437c8f9f479`, CPAPDex `911ce633d101→f6926fed9a73`, PulseDex `4c732d37ea19→c221f72959c0`, HRVDex `11ea1f782360→72c8cbc8e9eb`); OverDex pre-existing drift rebuilt (non-provenance). BOTH gates green (`verify-provenance` GATE A/B; `Dex-Test-Suite.html?full` all-green 2134 passed, `bootSkips: []`). Changeset `changes/2026-07-07-partc-badge-by-construction-fleet.md`. **§5 Part D.2** (widen `checkJs`) — OPEN, blocked on a `node tsc` host. **§5 Part D.3** (Prettier) — OPEN, forbidden standalone (rides §1 fleet churn). **§5 Part B** new-node build — awaits EEGDex/SpiroDex (gate already DONE). Also fixed this pass: an `OverDex.html` `--check` drift (§7). **⚠️ Node-CI must confirm** the 2026-07-05 Part-C re-bundle (`node tools/build.mjs --check` + `node tests/verify-manifest.mjs`) — in-environment I verified via `build-core.js` rebuild + the browser gates (both green) but have no Node shell. Original ordering (superseded, kept for context): **(1) §5 Part D.1 ESLint** (cheapest standalone
> win, no dependency on anything else). **(2) §2 Phase 4** — ans-design single-sourcing, legacy-branch retirement,
> `buildHash` drop + `AUDIT.md` §1c are all **DONE (2026-07-03)**; still TODO: the full `CLAUDE.md` §🔏 /
> `ARCHITECTURE-PRINCIPLES` §6 prose rewrite. **(3) §3 A5** single `clock.js` (needs human
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

- **Single-source `ans-design.css` — DONE 2026-07-03.** Deleted the `ANS-DESIGN-START…END` hand-mirror + sha
  marker from `OxyDex.src.html` and `HRVDex.src.html` and added `<link rel="stylesheet" href="ans-design.css">`
  (matching the other 6). The bundler inlines the ONE file → mirror drift is now unrepresentable. Both re-bundled
  (OxyDex `5f46c7a88b65→d2fcb04a3cd9`, HRVDex `afdc4e75d345→571b5f7d8a0b`), fixtures re-stamped, BOTH gates green
  (render-coverage OxyDex 15/15, HRVDex 17/17). **Reconciled to `ans-design.css` as canonical** (the larger/newer
  file the other 6 dexes already ship) — this brought OxyDex/HRVDex's tokens INTO LINE with the fleet (they had
  been rendering the stale mirror's values, e.g. `--text3` `#6F8096` → `#8C9DB3`).
- **Retire the legacy `__bundler/manifest` branch — DONE 2026-07-03.** Removed from `manifest-gate.js`:
  `manifestHashFromText` hashes plain-inline ONLY; a bundle regressed via the old inliner hashes to null →
  GATE A `missing-current` → red, pointing at the owned rebuild. The `gunzip`/`b64ToBytes`/`extractManifest`
  legacy helpers were deleted; `MANIFEST_RE` kept solely as the regression detector. The `verify-manifest.mjs`
  single-source guard + `verify-provenance.html` needed NO change (they consume the shared fn). Gates re-verified.
- **Drop the inert `buildHash` — DONE 2026-07-03.** All 8 fields removed from `BUILD-MANIFEST.json` (nothing
  read them; the well-formedness gate requires only the 12-hex `manifestHash`). `ganglior-provenance.js`
  still stamps a runtime fallback hash into exports — inert, noted in the ledger's `_note_own_the_build`.
- **Rewrite the docs — ✅ DONE 2026-07-13.** `CLAUDE.md` §🔏's re-bundle checklist was the last stale
  surface: it still carried the full hand-update prose with an "⚙️ OWNED BUILD" note bolted on *top* saying
  "the steps below are superseded" — i.e. the retired procedure was still the body text, and a reader who
  skimmed the note would follow it. Rewritten so `build.mjs` **is** the procedure (it auto-writes the GATE-A
  hash + re-stamps code-gated fixtures; you never hand-edit a hash), and the retired legacy prose is gone
  rather than annotated. Two corrections found while doing it:
  - **"All 8 bundles" was wrong** — `build.mjs` owns **10** (the 8 apps + the two orchestrators, §6).
    `BUILD-MANIFEST.json`/GATE A cover the 8; `--check` covers all 10. Now stated.
  - **A 4th stale surface this brief never listed:** `CONTRIBUTING.md`'s reconcile-helper paragraph told
    contributors to *"apply its edits by hand AFTER the build settles"*, justified by *"an auto-writer would
    race the platform's out-of-band rebuild"* — but `build.mjs` **is** an auto-writer and the platform
    rebuild is gone. Reworded: the helper is a read-only *diagnostic*, hand-applying is not the normal path.
  - The `PROVENANCE-NONDETERMINISM` §2/§4 "wait for the build to settle / re-read before you trust" rule is
    now explicitly **RETIRED** in `CLAUDE.md` — its cause (the legacy inliner's async rebuild) no longer
    exists, so a hash moving under you is a **concurrent session**, not the build. The still-true half (the
    ledgers are single files another session can rewrite) is kept and pointed at §👥.3.
  - `ARCHITECTURE-PRINCIPLES.md` §6 and `audits/AUDIT.md` item 2a were **already correct** — done in an
    earlier pass and never recorded here. Verified, not re-edited.
  **✅ RESOLVED 2026-07-03 (single-sourced — see the ans-design bullet above):** OxyDex/HRVDex reconciled to
  `ans-design.css` (canonical); the drift (mirror `--text3:#6F8096` vs file `#8C9DB3`; ~38.7 K vs ~60.9 K normalized)
  is gone, both gates green. `AUDIT.md` §1c's *"all copies in sync · sha 63d47ad1e085"* note was updated to match.

## §3 — Phase A5: single `clock.js` — **DONE 2026-07-03 (executed same day as ratification)**

**Landed:** `clock.js` (`DexClock` = tzOffset/_ckP2/_ckNumEpoch/_ckZoneMin/_ckDMY/parseTimestamp — the canonical
block extracted VERBATIM from hrvdex's commented copy) · 5 DSPs delegate via local aliases (oxydex/pulsedex/
hrvdex/ecgdex/integrator) · ppgdex/glucodex/cpapdex keep documented node-local variants · loaded before every
delegating dsp in 7 src.htmls + Dex-Test-Suite + run-tests + 4 worker `importScripts` lists (oxy-hang, cohort,
qrs-equiv, qrs-yield) + cohort-harness · `dex-coload.js` gained `shared:['clock.js']` (in `.all`, so the host-
membership gate enforces it) + a `{file:'clock.js', global:'DexClock'}` nodeModules entry (runtime-presence in
BOTH runners) · WP-G structural asserts flipped (delegation for the 5; Date.UTC+miss-path for the 3 variants;
clock.js itself asserted incl. ms-fraction preservation) · fleet rebuilt (5 hashes moved; GlucoDex/CPAPDex/
PpgDex byte-identical — determinism visible) · BOTH gates green (equiv legs byte-identical ⇒ semantics pinned).
CLAUDE.md §🔒 §2 + Known non-issues, ORIENTATION truth-table row, AUDIT 2a/2b updated.
**Execution findings:** (1) a `*/` inside a `_ck*` glob in a block comment terminated it early — syntax error
across 5 dsps, caught by the suite, fixed; (2) worker realms were the hidden load-order surface — any
`importScripts` list pulling a delegating dsp needs `clock.js` first (now all patched + the hang-guard gate
covers the oxy worker); (3) two cold-run rig reds ("14 numeric tokens") were boot/injection timing flakes —
re-runs 15/15; the suite's accumulate-groups behavior can show a STALE red group after in-page re-runs, so
judge the NEWEST group / a fresh `?full` open.

With an owned build, `parseTimestamp` lives in ONE `clock.js` inlined into every bundle — single source
AND bundled-local. The copy-paste + its drift test are retired. Original execution map (kept for reference):

**Execution map (surveyed 2026-07-03 — the copies are NOT one identical mirror; four variants):**
- **Canonical** `tzOffset` + `dmOrder` + `parseTimestamp(raw, opts)` — in `oxydex-dsp.js`, `pulsedex-dsp.js`,
  `hrvdex-dsp.js`, `ecgdex-dsp.js`, `integrator-dsp.js`, AND further copies inside adapter/ingest modules
  (the Data Unifier bundle shows 5+ occurrences — enumerate `adapters/*.js` + `signal-*.js` at execution).
  These extract cleanly → `clock.js` exposing `root.DexClock = { tzOffset, dmOrder, parseTimestamp }`
  (+ `module.exports`), each site rewired to `var parseTimestamp = DexClock.parseTimestamp;` etc.
- **ppgdex-dsp.js** — textually DIFFERENT body (starts `if(raw==null) return null;`): diff against canonical;
  if functionally equivalent, adopt `clock.js` (equiv gate proves byte-identical exports); else keep node-local
  with a documented reason.
- **glucodex-dsp.js** — full parser lives as `_ckParse` + a thin `parseTimestamp(s)` MDY wrapper: `_ckParse`
  is the extraction candidate; the wrapper stays node-local.
- **cpapdex-dsp.js** — a deliberate EDF-subset variant (`YYYYMMDD_HHMMSS_` + 14-digit): likely stays
  node-local; decide at execution.
- **Load order:** `clock.js` BEFORE every `*-dsp.js` in: all 8 `*.src.html`, `Data Unifier.src.html`,
  `OverDex.src.html`, `Dex-Test-Suite.html`, `tests/run-tests.mjs`; add it to the `dex-coload.js` manifest so
  the host-membership gate enforces it everywhere.
- **Test updates (same pass):** the WP-G truth-table group keeps running (against `DexClock` + each node's
  live surface); the STRUCTURAL asserts flip — `tests/dex-tests.js` ~594–605 (fractional-seconds per-mirror)
  and ~4387 (`defines parseTimestamp`) become "delegates to DexClock / no local mirror". Update `CLAUDE.md`
  §🔒 §2 + "Known non-issues" parseTimestamp bullet, `ORIENTATION.md`'s "mirrored, intentionally" row,
  `AUDIT.md` 2b.
- **Gate cycle:** every bundle rebuilds (`build.mjs --all`) + ledgers re-stamp + BOTH gates + the equiv legs
  (byte-identical exports are the semantic net). One coherent pass — do NOT land half the fleet.

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

## §5 — Parts B / C / D (independent; unblocked by Part A)

> **STATUS AT A GLANCE (2026-07-13):** Part B gate ✅ (build awaits a new node) · Part C ✅ **DONE 2026-07-07**
> (all 13 render/app/profile files enforced; 6 bundles re-bundled) · Part D.1 ✅ (ESLint — since **retired**,
> Biome is now the sole linter+formatter) · **D.2 ◐ PARTIAL** (`kernel-constants.js` added 2026-07-13, 0 errors;
> the next wins are shared-spine and cost a fleet re-bundle — see the status block below) · **D.3 ✅ SATISFIED
> BY DESIGN** (Biome check-only/changed-only; Prettier never adopted, do not resurrect it). Per-part detail below.

- **Part B — born-clean the next node** (EEGDex / SpiroDex): headless `compute()` + registry-graded badges
  + `env.equiv` + adapter-only vendor parsing from commit one; a `BORN_CLEAN` gate in `tests/dex-tests.js`.
  **✅ GATE DONE 2026-07-04 (test-only, no re-bundle):** the `born-clean` group (both runners, headless floor)
  enforces checks (1)–(4) — headless DSP · `compute()` present · every registry metric evidence-graded ·
  reproducibility leg (`env.equiv` or code-gated fixture). Seeded + LOCKING the five nodes that meet it today
  (PulseDex/GlucoDex/PpgDex/ECGDex/CPAPDex); OxyDex/HRVDex OUT (grandfathered-impure DSP). Needs ZERO new env
  wiring (consumes existing `env.sources`/namespaces/registries/`equiv`/`manifests`). Verified: 20 node
  assertions + 3 self-tests green; checks (1)/(3) red when broken. **Remaining:** actually building
  EEGDex/SpiroDex born-clean (+ adapter-only) — awaits a new node; the gate enforces it at birth.
- **Part C — badge-by-construction:** make `MetricRegistry.badge()` the sole DOM path for a metric value,
  one render file at a time, guarded by a `BADGE_ENFORCED` source check. **✅ FIRST FILE LANDED 2026-07-05 (test-only, no re-bundle):** the `badge-enforced` gate group + self-tests were already shipped (empty set); seeded it with `pulsedex-render.js`, whose value tiles already lead with the sanctioned `evBadge()` resolver, so the guard now reds if any `kpi-val`/`k-val` tile in it is emitted unbadged (4/4 green, both runners). No fleet re-bundle: `evBadge(` is an accepted badged marker, so evBadge-compliant render files enforce test-only (born-clean model). Remaining: migrate files whose badge TRAILS the value (oxydex/hrvdex `rs-val`) on an on-touch re-bundle, and optionally promote `evBadge` to a shared `MetricRegistry.metricValue()` helper during a fleet pass. **⟳ STATUS 2026-07-06 (so the next coder doesn't re-scan):** ENFORCED in `BADGE_ENFORCED` now = pulsedex-render · **oxydex-render · hrvdex-render** (rs-val migrated 2026-07-05, owner-authorized 2-bundle churn) · **integrator-render** (added 2026-07-06, test-only — already compliant, `kpi()` leads with `evBadge()`, NO re-bundle). **Remaining — ✅ DONE 2026-07-07 (owner-authorized fleet churn):** the full set — `cpapdex-render` (12 bare) · `glucodex-app` (6) · `ppgdex-app` (4) · `ecgdex-app` (3) · `pulsedex-overview` (1) · `hrvdex-app` (1) · the three `*-profile.js` (1 each) — was migrated so a badge LEADS every value tile (inside the value div where the class token is short; leading the tile container where the class expression pushes the badge past the gate's +40 window; cpapdex's `evb(`→`evBadge(` renamed so the guard recognizes it). All 9 joined `BADGE_ENFORCED` + the two runners' source lists; 6 bundles re-bundled (export-inert, fixtures re-stamped — GATE B reproducible confirms outputs unmoved); both gates green.
- **Part D — static gates.** **D.1 ESLint is the cheapest standalone next win** — a new `.github/workflows/lint.yml`
  running ESLint over the source `*.js` (control-flow/dead-code floor: `no-unreachable`, `no-fallthrough`,
  `no-constant-condition`, `no-cond-assign`, `no-unused-vars`, `no-undef`, `eqeqeq`, `no-dupe-keys`,
  `no-self-assign`), version-pinned, **no `--fix` in CI** (autofix moves `manifestHash`). Independent of Part A;
  ship anytime. **D.2** widen `checkJs` to one `*-dsp.js` at a time. **D.3** Prettier ONLY inside the §1 fleet
  churn (a repo-wide reflow moves every hash). See the sibling `DEV-TOOLCHAIN-2026-06-30-BRIEF.md` (Clock/SPDX/
  retired-vocab source-text gates + Biome) — coordinate so ESLint and the house-invariant gates don't overlap.
  > **⟳ STATUS 2026-07-13 — the 2026-07-06 "environment-blocked" note was STALE on both counts. Superseded:**
  >
  > **D.3 is not "pending Prettier" — Prettier was never adopted.** `BIOME-FORMATTER-2026-07-11-BRIEF` (DONE)
  > made **Biome** the sole formatter *and* linter, retired ESLint entirely, and adopted formatting
  > **check-only / changed-only** — which is exactly the no-repo-wide-reflow constraint D.3 was protecting.
  > D.3's concern is therefore **satisfied by design**, not deferred. Nothing to do; do not resurrect Prettier.
  >
  > **D.2 was NOT environment-blocked — there is a Node host, and `types.yml` has been green all along.**
  > It runs `npx -y -p typescript@5.5.4 tsc --noEmit -p tsconfig.json`; run that exact pinned command locally
  > and you can prove a module green before adding it. (Note `tsc` is *not* a devDependency — only Biome is —
  > despite `format.yml`'s comment claiming "Biome is a devDependency, exactly like tsc".)
  >
  > **D.2 PARTIALLY EXECUTED 2026-07-13:** `kernel-constants.js` added to `include` — **0 errors, no source
  > edit, no re-bundle.** Every other candidate measured against the baseline so the next session does not
  > re-derive it (recorded in `tsconfig.json`'s `//d2` key): clock **1** · metric-registry **2** ·
  > event-coupling 7 · dex-forget 8 · pulsedex-dsp 16 · glucodex-dsp 22 · cpapdex-dsp 27 · integrator-dsp 30 ·
  > ecgdex-dsp 31 · ppgdex-dsp 31 · hrvdex-dsp 46 · oxydex-dsp **107**.
  >
  > **⛔ The real blocker on the next step is CHURN, not environment.** `clock.js` (1 error — the
  > `module.exports = root.DexClock` alias at `:136`) and `metric-registry.js` (2) are the obvious next wins,
  > but both are **SHARED SPINE, inlined into every bundle** — so *any* edit that satisfies `tsc`, even a
  > `@ts-ignore` comment, moves all 10 `manifestHash`es and churns every fixture. That is an owner-authorized
  > fleet-churn decision (and per CLAUDE.md §👥.3 a shared-spine change should land BEFORE node-local work),
  > not a free widening. The `*-dsp.js` files are node-local (no fleet churn) but carry real DOM/localStorage
  > debt — `oxydex-dsp` at 107 errors is the grandfathered-impure one; `pulsedex-dsp` at 16 is the cheapest.

## §6 — Orchestrators (Data Unifier + OverDex) — DONE 2026-07-03 (owner directive: own them)

Both are **deliberately UNBUNDLED** loose HTML (source == served `.html`, ~23–26 loose `<script src>`) — the served
front-door, same-origin with the dexes (shared profile/longitudinal store); ORIENTATION notes they *"touch neither
gate"* by design. **Feasibility VERIFIED 2026-07-03:** `build-core.js` plain-inlines both cleanly + deterministically
(Data Unifier 9 KB→717 KB `e0b812300212`; OverDex 14 KB→831 KB `ac092cbb6921`; every `<script>` tagged, parse-OK).
**DONE 2026-07-03 (owner directive):** each got a `.src.html` split (copy of the loose file) → built to an owned
standalone `.html`, and **added to `build.mjs`** as a non-provenance owned set (`ORCHESTRATORS`), so `--all`/`--app`
build them and `--check` guards their drift. Both boot clean; the suite's co-load gate still passes (14/14 modules
present in each — `indexOf(filename)` survives `data-inline-src`). The tradeoffs that made this a decision, for the record:
- They have **no `.src.html` split** — bundling in place overwrites the loose source, so it needs a `.src.html`→`.html`
  split like the dexes.
- They are **ungated** (no provenance fixtures / render-coverage). Loose = always reflects the CURRENT modules.
  Bundled = a frozen snapshot that can go **stale/drift** if a shared module changes without a rebuild, with **no gate
  to catch it** — UNLESS they are added to `build.mjs --check` (committed bundle ≡ build(src)), which closes that gap.

**Drift mitigation applied:** they are in `build.mjs --check` (committed bundle ≡ build(src)), so a shared-module
change without a rebuild reds CI — closing the ungated-staleness gap that had kept them loose. They stay OUT of
provenance (no `BUILD-MANIFEST`/fixtures entry) and out of render-coverage, per ORIENTATION. **Note for ORIENTATION:**
its *"both are unbundled"* line is now stale — ✅ UPDATED 2026-07-05 (they are owned bundles with a `.src.html`
split, still served front-door + same-origin when served).

## §7 — Found during the 2026-07-05 close-out: `OverDex.html` `--check` drift (FIXED)

While verifying gate state before flipping the parent to DONE, an in-session full byte `--check`
(`build(src) ≡ committed`, via run_script over `build-core.js`) found **`OverDex.html` drifted** — the
committed bundle was 428 B shorter than a fresh build of its current source. `Data Unifier.html` and all
8 provenance-gated dexes were CLEAN (GATE A `manifestHash` match + full byte `--check`).

- **Root cause:** the sole stale asset was `integrator-dsp.js` — a +428 B **comment-only** expansion in
  the §2 HR-hat block (lines ~1083–1086, "The HR triplet may include NON-HRV nodes…"). That edit had been
  re-bundled into the provenance-gated `Integrator.html` (GATE A green) but **never propagated to the
  non-provenance `OverDex.html`**, which inlines the same `integrator-dsp.js`. `Data Unifier.html` does not
  inline it, so it stayed clean — consistent with the diagnosis.
- **This is exactly the ungated-orchestrator staleness §6 predicted `--check` would catch** — and it did
  (the orchestrators have no provenance fixtures / render-coverage; `build.mjs --check` is their only drift
  guard). The executed code was unchanged (comment-only), so no user-visible behavior moved — but the bundle
  was genuinely not `build(src)`, i.e. CI `--check` would have RED.
- **Fix:** rebuilt `OverDex.html` from source (run_script over `build-core.js`; `manifestHash a6e85b850309`).
  No ledger touched — orchestrators are non-provenance by design. Verified: `--check` now CLEAN
  (`build(src) ≡ committed`, deterministic), plain-inline, boots with no console errors.
- **Process takeaway:** an on-touch edit to a **shared** module (`integrator-dsp.js`, `signal-*.js`,
  `clock.js`, `ans-design.css`, …) must re-bundle **every** owned consumer — the 8 dexes **and** the 2
  orchestrators. `node tools/build.mjs --all` does this; a per-app `--app Integrator` alone silently leaves
  OverDex stale until `--check`/CI catches it. Prefer `--all` (or include both orchestrators in the on-touch
  rebuild set) after any shared-module change.

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
