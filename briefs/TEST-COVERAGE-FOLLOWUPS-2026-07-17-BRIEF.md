<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-07-17 · **Created:** 2026-07-17

# TEST-COVERAGE-FOLLOWUPS — modules that ship but are never asserted

A two-pass coverage audit of the shipped fleet against `tests/dex-tests.js` (~180 groups, run in
both lanes via `tests/run-tests.mjs` + `Dex-Test-Suite.html`). The DSP kernels, Clock Contract,
node-export/ingest contracts, provenance/ledger gates, evidence badges, and cross-node fusion are
deeply covered — that backbone is **not** where the risk lives. The gaps are concentrated in three
rings *outside* the backbone: personalization engines, analysis/research kernels, and off-main-thread
workers. Each item below names the module, its size, and what is unverified. Sizes are line counts at
audit time.

> **Method note (why these are real, not just "0 grep hits").** "Referenced in a runner" was checked
> against actually-loaded-and-asserted, not against appearing in a static-check `.html` list. A module
> that appears only in the CSP / self-contained lists (e.g. `qrs-equiv-analysis.html`) has its *page*
> statically checked but its *math* never executed. `env` surfacing was confirmed: a module's global
> must be added to the `env = { … }` block in **both** `tests/run-tests.mjs` (~line 922) and
> `Dex-Test-Suite.html` (~line 429) before a group can reach it.

---

## Item 1 — Per-node profile engines (personalization) · **HIGHEST VALUE · IN PROGRESS**

~2,850 lines of node-local **clinical formula** code, shipped in the bundles, with **zero behavioral
assertions**. These are NOT thin wrappers over the tested `dex-profile.js` core — they carry
independent, cited physiology:

| Module | Lines | Exposes | Independent math (examples) |
|---|---|---|---|
| `ecgdex-profile.js` | 603 | `window.ECGProfile` (`personalize`, `getProfile`, …) | Tanaka HRmax `208−0.7·age`; `vo2Base = 15.3·hrmax/rhr` (Uth–Sørensen 2004); `vo2Adj` (HRV-adjusted); `altVO2Factor`; `expectedRmssd`/`expectedRHR` age-norms; `apneaRisk` CVHR bands; `hrvScore = 1.494·rm−13.37` |
| `glucodex-profile.js` | 416 | `window.GLUProfile` | GMI↔lab-A1c agreement; ADAG `eAG = 28.7·A1c − 46.7` sensor-bias; `dataQualityConf` |
| `ppgdex-profile.js` | 519 | `window.PPGProfile` | VO₂/HRV personalization off `dispHr`/`dispRm`/`dispSd` |
| `hrvdex-profile.js` | 655 | **no namespace** — DOM panel + `window._projVO2` | VO₂ projection; age-relative HRV |
| `oxydex-profile.js` | 661 | **no namespace** — DOM panel, delegates more to `DexProfile` | O₂-context personalization |

**Findings.** `ECGProfile`/`GLUProfile`/`PPGProfile` *are* loaded in the Node env but were never in the
`env` block, so no group could reach them; they're co-load-exempt as "DOM node profile card". The pure
formulas aren't individually exported, but `personalize(r)` is — and it is fully headless-safe
(`getProfile()` falls back to population defaults when `getElementById` returns null; no DOM writes in
the derive path). `hrvdex-profile`/`oxydex-profile` expose **no testable namespace** at all
(`hrvdex-profile` wasn't even in the Node load list).

**Plan.**
- **(a) DONE-in-this-brief:** surface `ECGProfile`/`GLUProfile`/`PPGProfile` into the `env` block of both
  runners; add a `Per-node profile personalization — known-answer` group in `tests/dex-tests.js` that
  drives `personalize(r)` under a controlled `DexProfile` record and pins the cited formulas to
  hand-computed reference values (Tanaka, Uth–Sørensen VO₂, age-norm RMSSD/RHR, apneaRisk bands, GMI/eAG
  bias). No source change to the profile modules → **no re-bundle** (test-wiring only).
- **(b) Remaining:** `hrvdex-profile`/`oxydex-profile` need a small testability seam — export a pure
  `{ project… }` surface (additive, back-compat) so their VO₂/HRV math can be pinned without a DOM.
  This *does* touch source → re-bundle HRVDex + OxyDex + regenerate provenance. Spun into
  Item 1(b), left for a follow-up so (a) can land as a pure test-only green-gate change.

## Item 2 — `nsrr-adapter.js` PSG ingest parser · 204 lines · **untested**

`window.NSRR` (`parseNsrrXml`, `processNight`) bridges real NSRR PSG cohorts (SHHS/MESA/MrOS/CHAT):
matches the SpO₂ channel across EDF label variants and parses profusion-style annotation XML
(apnea/hypopnea `EventConcept`) → `{ scoredAHI, tstHours, nApnea, nHypop, events }`. It is a
*dependency* of the (tested) `odi-bias-analysis.html`, but the odi-bias known-answer group loads the
downstream stats kernel `odi-bias-analysis.js`, never the parser. A clinical-annotation ingest parser
with zero coverage — same bug-class the O2Ring `.dat` and ResMed-EDF adapter tests already guard.
**Plan:** parse→canonical round-trip on a tiny synthetic profusion XML + committed EDF stub, following
the `resmed-edf adapter` group pattern; assert channel-label matching, AHI scoring, and Clock-Contract
`tMs` reconstruction.

## Item 3 — Analysis/research statistical kernels · **untested math**

Loaded into the known-answer group today: `analysis-stats`, `nights-icc`, `sigma-no-reference`,
`odi-bias`, `treatment-response`, `hrv-confound`, `cgm-hrv-coupling`. **Not** loaded (only their
`.html` appears in the CSP/self-contained static lists):

| Module | Lines | Unverified |
|---|---|---|
| `qrs-yield-analysis.js` | 725 | QRS detection-yield statistics |
| `qrs-equiv-analysis.js` | 674 | ECG↔PPG equivalence stats |
| `pat-feasibility.js` | 819 | PAT feasibility computation (referenced by no runner at all) |
| `cohort-regression.js` | 347 | cohort regression model |

**Plan (original):** add each to the `analysis-stats` env load + known-answer group with a small fixture.

> **⚠ Execution finding (2026-07-17) — NOT test-only; needs a refactor.** Unlike `analysis-stats.js`
> (a shared, export-bearing kernel), these four are **DOM-driven page controllers** — IIFEs `(function(){…})()`
> with **no export surface** (`cohort-regression.js` even binds `document.getElementById('runBtn').onclick`
> at top level, so it throws on headless load). Worse, each **re-implements its own** `mean`/`sd`/`median`/
> `pearson`/`ba`(Bland-Altman)/`olsR2` inline — none delegate to `AnalysisStats`. So there is no seam to
> assert against, and adding a fresh tested copy to `analysis-stats.js` would be **fake coverage** (it
> wouldn't exercise the page's own duplicate). The honest fix is to **extract the duplicated primitives
> (`pearson`, `blandAltman`, `olsR2`, …) into `analysis-stats.js` and make the four pages delegate** — a
> source refactor of the analysis pages (each carries a `self-contained (file://-safe)` + CSP gate that
> must stay green), then pin the extracted kernels. That is a scoped refactor, not a test add → own PR.

## Item 4 — Worker ↔ serial equivalence · proven for only 2 of 6

The repo treats "a worker changes *when* the work runs, never *what* it computes" as a named bug-class
(dedicated `PpgDex worker blob EXECUTES and ≡ the serial path` + `Trio planted σ … page ≡ CPU worker ≡
GPU` groups). No such leg exists for:

- `cohort-worker.js` (639 — feeds the *tested* cgm-hrv-coupling + hrv-confound pages)
- `pat-feasibility-worker.js` (503) · `qrs-equiv-worker.js` (187) · `qrs-yield-worker.js` (396)

**Plan (original):** clone the PpgDex worker-blob harness (execute the blob, assert output ≡ serial path).

> **⚠ Execution finding (2026-07-17) — no serial twin to compare against.** The PpgDex harness works
> because that worker is a **blob built from an inlined source string** whose serial equivalent
> (`detectChannel`) is a first-class DSP export, and `detectChannelsAsync` **falls back to serial** — so
> `new Function(src)` reproduces the realm and there is a serial path to diff. These four are **separate
> worker FILES** (`new Worker('qrs-yield-worker.js')`, or `importScripts`-composed analysis blobs), and
> their analysis pages have **no serial fallback** — the compute exists *only* in the worker. So a
> `worker ≡ serial` diff has no second operand. Making it testable means either (a) extracting each
> worker's compute into a shared, serially-callable kernel (the same extraction Item 3 needs — do them
> together), or (b) a real-Worker rig like `WORKER-REALM-GATES §2` that asserts the worker *runs* and
> reproduces a **known-answer** (not a serial diff). Either way: not a clone-the-harness add → own PR.

## Item 5 — Minor

- `overdex-walk.js` (131, shipped in `OverDex.src.html`) — **DONE (2026-07-17).** Clean `globalThis.OverDexWalk`
  export, DOM-free; `OverDex folder walker` known-answer group pins the sync surface (`fromInput`
  junk-filter: dotfiles/`__MACOSX`/`.DS_Store` dropped by name AND by any junk path segment; `relPath`
  tagging/de-dupe key; `relOf` fallback). Wired into both runners' `env`. The async webkit-entry
  drag-drop recursion isn't sync-assertable here (no async group support) → left to render-coverage.
- `support.js` (1,390) is an **orphan**: its stated source `dc-runtime/` does not exist in the checkout,
  and it is inlined into **no** bundle and referenced by **no** `.src.html`. This is dead code, not a
  coverage gap — flag for deletion/relocation under a separate cleanup, not a test. **Left in place**
  (deletion is destructive + owner's call; recorded here, not actioned).

---

## Done when

- [x] **(1a)** `ECGProfile`/`GLUProfile`/`PPGProfile` in both `env` blocks; profile known-answer group
      green in both lanes; no bundle re-touched. **DONE (PR #141)** — 40 assertions.
- [ ] (1b) HRVDex/OxyDex profile pure-surface seam + tests (re-bundle + provenance) — follow-up
- [x] (2) NSRR parser round-trip — **DONE** — `NSRR PSG ingest adapter` group: channel matching · 1 Hz
      resample (forward-fill/backfill) · Clock-Contract EDF→OxyDex rows · severity bands (both lanes) +
      profusion-XML → AHI scoring (browser lane, `parseNsrrXml` needs `DOMParser`). 27 Node / 36 browser.
- [ ] (3) analysis kernels — **BLOCKED as test-only**; needs the extract-to-`analysis-stats`-and-delegate
      refactor (see Item 3 finding). Re-scoped to its own PR.
- [ ] (4) worker≡serial legs — **BLOCKED as test-only**; no serial twin exists (see Item 4 finding).
      Do with Item 3's extraction, or as a known-answer real-Worker rig. Own PR.
- [x] (5) overdex-walk test **DONE** (8 assertions, both lanes); `support.js` orphan flagged (left in place).

Landing each item needs `Dex-Test-Suite.html?full` all-green + `node tests/run-tests.mjs` green + a
changeset. **Items 3 & 4 turned out NOT to be test-only** (execution findings above) — they need a
shared-kernel extraction refactor of the analysis pages, so they are re-scoped to a follow-up
(`TEST-COVERAGE-FOLLOWUPS-II`, to be spawned when that refactor is picked up). Items 1a/2/5 are landed.
