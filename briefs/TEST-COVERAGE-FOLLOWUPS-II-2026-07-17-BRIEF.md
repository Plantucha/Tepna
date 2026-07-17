<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED — 2026-07-17 · **Created:** 2026-07-17

# TEST-COVERAGE-FOLLOWUPS-II — the three items that turned out NOT to be test-only

> Follow-up to `TEST-COVERAGE-FOLLOWUPS-2026-07-17-BRIEF.md` (house `-FOLLOWUPS → -II` pattern),
> carrying its re-scoped items **3 / 4 / 1b**. Not a supersede — the parent stays DONE for items 1a/2/5.

Executing `TEST-COVERAGE-FOLLOWUPS` landed items **1a** (per-node profiles, PR #141), **2** (NSRR
adapter, PR #142) and **5** (OverDex walker, PR #143) as clean test-only changes. Items **3**, **4**
and **1b** were re-scoped mid-execution because each needs a **source change**, not a test add. This
brief carries the detailed plans so they can land independently, each as its own gated PR.

---

## Item 3 — Analysis/research statistical kernels (untested math)

**The blocker (found on execution):** `qrs-yield-analysis.js` (725), `qrs-equiv-analysis.js` (674),
`pat-feasibility.js` (819), `cohort-regression.js` (347) are **DOM-driven page controllers** — IIFEs
`(function(){…})()` with **no export surface**. `cohort-regression.js` binds
`document.getElementById('runBtn').onclick = run` at **top level**, so it throws on a headless load.
Each **re-implements its own** `mean`/`sd`/`median`/`pearson`/`ba`(Bland-Altman)/`olsR2` inline — none
delegate to `analysis-stats.js` (the shared, tested kernel), and none of the four pages even load it.

So there is no seam to assert against, and adding a fresh tested copy to `analysis-stats.js` would be
**fake coverage** (`TEST-AUDIT-PROMPT.md` class 3) — it would exercise a copy, not the code the page runs.

**Two honest routes (pick per-page; they compose):**

- **Route A — expose + guard (lower risk, tests the SHIPPED code).** For each page: (1) guard the
  top-level DOM access (`var b=document.getElementById('runBtn'); if(b) b.onclick=run;`) so the module
  loads headlessly — this is also a defensive correctness fix; (2) attach the pure kernel to a namespace
  (`window.QrsEquiv = { pearson, ba, sd, mean }`, etc.) as an **additive** export; (3) wire that namespace
  into both runners' `env` + add a known-answer group. No behavior change to the page's compute; it tests
  the exact functions the page ships. **Does NOT dedup.**
- **Route B — extract + delegate (also dedups, higher risk).** Move the pure primitives (`pearson`,
  `blandAltman`, `olsR2` — `mean`/`sd`/`median`/`variance` already exist in `analysis-stats.js`) into the
  shared kernel, add each page a `<script src="analysis-stats.js">` and rewrite its calls to delegate,
  then pin the kernel. This removes 4 duplicate stat copies but touches page HTML + the pages'
  `self-contained (file://-safe)` + CSP gates, which must stay green.

**Recommendation:** **Route A first** (coverage is the goal; it tests the real code with minimal blast
radius), then Route B as a separate dedup pass if desired. Known-answers are clean, cited formulas:
Pearson r, Bland-Altman bias ± 1.96·SD limits, OLS R². **Done when:** each page's kernel is asserted by
a known-answer group green in both lanes; the pages' own gates stay green; no bundle touched (analysis
pages aren't in the app fleet). Verify each page still runs (open it, click run) — `verify` skill.

## Item 4 — Worker ↔ serial equivalence (no serial twin exists)

**The blocker:** the PpgDex `worker ≡ serial` gate works because that worker is a **blob built from an
inlined source string** whose serial equivalent (`detectChannel`) is a DSP export, and
`detectChannelsAsync` **falls back to serial** — so `new Function(src)` reproduces the realm and there
is a serial operand to diff. `cohort-worker.js` (639), `pat-feasibility-worker.js` (503),
`qrs-equiv-worker.js` (187), `qrs-yield-worker.js` (396) are **separate worker FILES**
(`new Worker('qrs-yield-worker.js')` / `importScripts`-composed) and their pages have **no serial
fallback** — the compute exists *only* in the worker. A `worker ≡ serial` diff has no second operand.

**Two routes:**
- **Route A — known-answer real-Worker rig** (mirrors `WORKER-REALM-GATES §2`): in the browser lane,
  spawn the real worker file, post a tiny fixed input, assert it (a) spawned, (b) none errored, (c)
  reproduces a **hand-derived known-answer**. This proves the worker RUNS and computes correctly without
  needing a serial twin. Browser-lane only (real `Worker`).
- **Route B — extract a serially-callable kernel** (converges with Item 3 Route B): pull each worker's
  compute into a shared function callable both from the worker and serially, then a `worker ≡ serial`
  diff becomes possible. Bigger; do only if Item 3 Route B is taken for the same page.

**Recommendation:** **Route A** — the honest, contained fix; a hollow "≡ serial" gate that passes on a
dead pool is exactly `TEST-AUDIT-PROMPT.md` class 1, so do not build one here. Pair each worker with the
Item 3 known-answer for the same page (same fixed input → same expected number, serial and worker).

## Item 1b — HRVDex / OxyDex profile pure-surface seam

`hrvdex-profile.js` (655) and `oxydex-profile.js` (661) expose **no testable namespace** — they wire a
DOM panel and set `window._projVO2` directly (unlike ECG/GLU/PPG which export `personalize`). Item 1a
covered the three that export; these two owe a seam.

**Plan:** add an **additive** pure surface (e.g. `window.HrvProfile = { projectVO2, … }` /
`window.OxyProfile = { … }`) computing the same VO₂/HRV math without a DOM, then a known-answer group
like 1a's.

> **⚠ Execution finding (2026-07-17) — the premise was HALF wrong; HRVDex needs NO re-bundle.**
> - **HRVDex — DONE, test-only (no re-bundle).** `hrvdex-profile.js` already leaks its pure cited kernels
>   as **bare globals** via `Object.assign(window, {…})` (`calcVo2Cat`, `getAgeBand`, …) **and loads
>   headless** — no DOM at module top level. So there was no seam to add: just load it in both runners and
>   grab the globals. Pinned the ACSM/NHANES VO₂-category classifier + age bands (13 assertions).
>   `build --check` stays clean (no bundled source touched). *This is the win the brief said needed a seam.*
> - **OxyDex — still owes the re-bundle.** `oxydex-profile.js` DOES expose via `Object.assign(window,{…})`
>   too, but a **top-level `initProfile()` IIFE** (line ~628) runs DOM code (`upToDOM()` → sets element
>   `.value`) at load, so the module **throws headless** and nothing is reachable. Making it testable needs
>   a guard on that init path (skip when no panel) **plus** adding the pure kernels (`upKarvonenZone`,
>   `upBMILabel`) to the export → **edits shipped bundle source → re-bundle OxyDex + regenerate provenance**
>   (`node tools/build.mjs --app OxyDex`). So the re-bundle cost is **1 app, not 2** — batch it with any
>   other queued OxyDex behavioral change. Left as its own PR (editing a shipped app's init path is higher
>   risk than the HRVDex test-only wiring; deserves isolated review + a green `verify-provenance`).

---

## Done when (each lands independently)

- [x] (3) analysis-kernel known-answers via Route A (expose + guard) — **DONE for the meaningful kernels.**
      `cohort-regression.olsR2` (8 assertions, PR #146) + `qrs-equiv` `pearson`/`ba`/`sd` (13 assertions —
      Pearson r, Bland-Altman bias/LoA/r, sample SD; `qrs-equiv` is INLINED by `build-analysis`, so the
      `.html` was re-bundled + `--check` verified). Both DOM-guarded → load headless in both lanes.
      **Deliberately NOT exposed:** `qrs-yield`/`pat-feasibility` unique math is orchestration over
      `mean`/`median` (already covered by `analysis-stats`) — low unit-test value; assessed, not skipped
      silently. Route B (extract-to-shared-kernel dedup) remains OPTIONAL, not needed for coverage.
- [ ] (4) real-Worker known-answer rig for the 4 workers (browser lane), paired with (3)'s fixtures.
- [x] (1b) profile seam — **DONE, and NO re-bundle for EITHER app** (the brief's whole re-bundle premise
      was wrong). **HRVDex** (13 assertions, PR #148): `calcVo2Cat`/`getAgeBand` already leak as globals +
      load headless. **OxyDex** (12 assertions): `upKarvonenZone` (Karvonen target-HR zones) + `upBMILabel`
      (WHO BMI bands) are top-level globals too, and `oxydex-profile.js` loads headless once `oxydex-util.js`
      (sv/gv, `getElementById`-guarded) is present — its `initProfile()` DOM writes no-op headless. The
      earlier "OxyDex owes a re-bundle" note was an artifact of a probe that omitted `oxydex-util.js`
      (→ a spurious `sv is not defined`); with util loaded there is no throw, no source edit, no bundle move.

Each: `node tests/run-tests.mjs` green + `Dex-Test-Suite.html?full` all-green + changeset. Route B
(dedup/extraction) for 3+4 is an OPTIONAL later pass; note it in a follow-up if taken. These plans are
the direct output of `TEST-AUDIT-PROMPT.md`'s "test the shipped code, never a copy" discipline.
