<!--
  DEX-TEST-SUITE-LAZY-FOLLOWUPS-2026-06-30-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->

**Status:** DONE — 2026-07-04 (all four sections closed — owner-sanctioned close. **§1** (the CI-parity regression the lazy change introduced) is RESOLVED, not merely fix-applied: the 2026-07-03 `browser-gates.mjs` hardening (`BROWSER-GATES-CI-TIMEOUT 2026-07-03`) has the CI gate navigate `?full`, wait on the programmatic `window.__rcState==='done'` [not a prose scrape], with a 15-min CI ceiling + crash-vs-stall diagnostics; **predicate-equivalence was verified in-browser 2026-07-04** (both DOM verdicts the script polls go true on a real `?full` run). The lone remaining "owed" item — a literal `BASE_URL=… node tests/browser-gates.mjs` run against a served checkout — is **superseded as a blocker**: Node/playwright is unavailable in this environment, and the gate's code path is confirmed by inspection + the in-browser predicate check, so it is closed on inspection rather than held open indefinitely (run it as a no-op confirmation if a served checkout ever exists). **§2 doc-sweep DONE — 2026-07-01** · **§3 Tepna brand-rename sweep DONE — 2026-07-01** · **§4 = notes-only.** No new residue surfaced on close → no `-II` follow-up spawned.) · **Created:** 2026-06-30 · **Follows:** the executed session changes below · **Relates:** `DEV-TOOLCHAIN-2026-06-30-BRIEF.md` §A3 (the legacy-umbrella lint that would prevent §3 recurring)

# Dex-Test-Suite lazy render-coverage — follow-ups (CI parity · brand · hardening)

> Residue captured while executing two changes this session. **Read `CLAUDE.md` §🧪 first** (the gate
> ritual, now updated to the `?full` / ▶ path). Nothing here is speculative — §1 is a regression the
> lazy change introduced (fix applied, CI re-run owed); §2–§4 are the concrete sweeps/notes that fell
> out of it.

## 0 · What shipped this session (the changes this brief is residue of)

- **`Dex-Test-Suite.html` — render-coverage is now ON-DEMAND (lazy).** The rig tail (`renderCoverageECGDex`
  / `CPAPDex` / `IntegratorPB` + the `APP_COVERAGE` loop + `oxyHangGate`) was extracted into
  `runRenderCoverage()`. A bare open paints only the headless CI floor instantly; the rigs run on a **▶ Run
  render-coverage** button or when the page is opened with `?full` / `?rc` / `?all` (`shouldAutoRunRC()`).
  The `#summary` pill now reads amber **"✓ headless green — render-coverage not run"** on a bare open (NOT a
  pass) and only says **"✓ all green"** after the rigs run (`window.__rcState==='done'`). Waits tightened:
  `waitForRender` `poll` 150→80, `settle` 450→200; the profile-edit probe's blind `setTimeout(…,700)`
  replaced by marker-based `waitForRecompute(win,doc,800,150)` (MutationObserver + 800 ms cap).
  **Verified in-browser:** bare load = 93 groups / 1481 passed (amber); `?full` = **103 groups / 1594 passed
  / all green**, `sameOriginStatus().ok===true`, 0 fails.
- **`CLAUDE.md` §🧪** rewritten to the `?full` / ▶ ritual (a bare open is the floor, NOT a pass).
- **`verify-provenance.html`** `<title>` + `<h1>` brand "Ganglior" → **"Tepna"** (frozen `ganglior-provenance.js`
  reference left intact).

---

## 1 · 🔴 MUST-FIX (regression introduced this session) — CI opened the suite without `?full` · DONE — 2026-07-04

**What surfaced.** `tests/browser-gates.mjs` (the headless-browser CI gate, run by
`.github/workflows/browser-gates.yml`) navigates to `/Dex-Test-Suite.html` (no `?full`) and then
`page.waitForFunction(… /hang guard/i.test(results.innerText) && a settled #summary pill …, {timeout: 300000})`.
The "hang guard" group is produced by `oxyHangGate`, which now runs **only** inside `runRenderCoverage()`
(on-demand). So on a bare CI load it never appears → the wait **times out after 5 min** → CI hard-fails
(`"Dex-Test-Suite: did not finish within 5 min"`). Even without the timeout, a bare load would skip
render-coverage entirely = **silent gate-coverage loss**. This is a real break the lazy change caused.

**Fix applied (2026-06-30).** `browser-gates.mjs` now navigates to **`/Dex-Test-Suite.html?full`** so
`shouldAutoRunRC()` auto-boots the rigs in CI (with an inline comment explaining why). The in-browser
`?full` path was confirmed all-green this session (103 groups / 1594 passed). **OWED:** a real
`node tests/browser-gates.mjs` run against a served checkout to confirm end-to-end — could not run
Node/playwright in this environment.

**Done-when:** `BASE_URL=… node tests/browser-gates.mjs` prints `✓ browser gates passed` with the suite
green; then flip this §1 to DONE.

**Closed — 2026-07-04 (owner-sanctioned, on inspection).** The gate itself was hardened on 2026-07-03
(`BROWSER-GATES-CI-TIMEOUT` — `browser-gates.mjs` navigates `?full`, waits on `window.__rcState==='done'`,
15-min ceiling, crash-vs-stall diagnostics), and the predicate the script polls was verified equivalent
in-browser on a real `?full` run 2026-07-04. The literal served-checkout playwright run stays un-runnable
in this environment (no Node/playwright), so §1 is closed on inspection + the in-browser predicate check
rather than held open indefinitely — the owed run is superseded as a blocker, not a pending code change.
If a served checkout ever exists, run it as a confirmation; no code change is expected.

---

## 2 · Doc / consumer sweep — other on-load-full-run assumptions

> **✅ DONE — 2026-07-01.** Live instructional surfaces swept to the `?full` / ▶ ritual:
> `ORIENTATION.md` (two-gates §1), `AUDIT-PROMPT.md` (green-baseline step), `CONTRIBUTING.md` (gate #1
> opener + the `window.__sameOriginOK` blockquote now notes the SUITE's signal only goes true post-RC),
> the `browser-gates.yml` comment header (now `?full`), and `Dex-Test-Suite.html`'s own eyebrow
> ("runs on load" → "headless on load · render-coverage on demand"). No live reader of the SUITE's
> `__sameOriginOK` / `renderCoverageGroups` / `__rcState` beyond `CONTRIBUTING.md` remained — the other
> grep hits are the source page itself, the unaffected `verify-provenance.html` (different page), and
> DONE briefs (`GATE-LIVE-RUNNABILITY*`, `DEEP-AUDIT-FIXES`), which are historical records left as-is.

`CLAUDE.md` §🧪 is updated. Grep for **other** places that assume Dex-Test-Suite runs everything on load
and update them to the `?full` / ▶ ritual:

- Prose: `CONTRIBUTING.md`, `AUDIT-PROMPT.md`, `ORIENTATION.md`, any `*-AUDIT*.md`, and the
  `browser-gates.yml` comment header — search `Dex-Test-Suite`, `group count to stop climbing`,
  `runs on load`, `all green`.
- **Programmatic readers:** `sameOriginStatus()` for the SUITE now returns `ok:false` /
  `renderCoverageGroups:0` on a bare load (RC hasn't run). Anything reading the SUITE's `__sameOriginOK`
  / `__renderCoverageGroups` as a "the suite ran" signal must open with `?full` (or read the new
  `window.__rcState==='done'`). Grep `__sameOriginOK`, `renderCoverageGroups`, `__rcState`. (The
  provenance page's identically-named signals are unaffected — different page.)

**Done-when:** no stale "open it, wait ~50 s, must say all green" instruction remains for the suite; each
points at `?full` or ▶.

---

## 3 · Tepna brand-rename residue (a `LICENSING-BRIEF` Phase-4 miss)

> **✅ DONE — 2026-07-01** (nothing left to rename). A fleet-wide sweep for product-brand prose
> (`Ganglior suite` / `<title>…Ganglior` / `>Ganglior<` / `Ganglior ·`) and `ANS Intelligence` found
> NONE: `verify-provenance.html`'s `<title>`+`<h1>` were already flipped to **Tepna** this session (§0),
> and every remaining `ganglior` hit is a FROZEN identifier (`ganglior.node-export`, `ganglior_events`,
> `ganglior_integrator`, `exportGanglior`, `GangliorProvenance`, `ganglior-provenance.js`), the
> **event-bus codename** ("Ganglior bus"), or docs *about* the frozen name (`AUDIT.md` §1b) — all left
> intact. The `DEV-TOOLCHAIN §A3` legacy-umbrella lint remains the durable guard against recurrence.

`verify-provenance.html`'s `<title>`+`<h1>` still carried the legacy umbrella brand **"Ganglior"** (fixed
this session) — evidence the Phase-4 Tepna rename missed surfaces. **Sweep for legacy product-brand prose**
`Ganglior` / `GanglioR` / `ANS Intelligence` used as a NAME (page `<title>`/`<h1>`/headings/about copy) and
rename to **Tepna**.

- **⚠ CRITICAL — do NOT touch the FROZEN identifiers** (`CLAUDE.md`): the `ganglior.node-export` schema
  string, `ganglior_events`, the `ganglior-provenance.js` filename, the `fascia` input alias, and
  `Ganglior` as the **event-bus codename**. Rename **brand strings only.**
- Separation heuristic: brand usages read like a product name (`Ganglior ·`, `<title>Ganglior`,
  `>Ganglior<`, "the Ganglior suite"); identifiers read as `ganglior.` / `ganglior-` / `ganglior_`.
- This is exactly what **`DEV-TOOLCHAIN-2026-06-30-BRIEF.md` §A3** (legacy-umbrella lint, allow-listing the
  frozen `ganglior.*`/`fascia` verbatim) would mechanize — landing that lint prevents recurrence.

**Done-when:** `grep -i ganglior` shows only frozen `ganglior.*` / `fascia` / event-bus-codename usages;
no product-brand "Ganglior" prose remains; `Dex-Test-Suite.html?full` stays all-green (brand strings are
non-code — no re-bundle, no provenance move).

---

## 4 · Lazy-change hardening (LOW — residue of my own change)

- **(a) Re-run baseline.** Re-run dedup truncates `ALL_GROUPS.length = window.__headlessCount|0`, captured
  once in `main()` before the lazy dispatch. Correct today (no headless group is pushed after that point).
  If the headless phase ever grows a late group, move the capture or the baseline goes stale.
- **(b) `waitForRecompute` cap.** cap=800 ms ≥ the old flat 700 ms and early-exits on a real DOM mutation;
  watch for any app whose profile recompute paints >800 ms with **no** intermediate mutation (would assert
  early). None observed (all-green), but note it before adding heavier profile-driven renders.
- **(c) `sameOriginStatus()` count.** `renderCoverageGroups` reflects the CURRENT `ALL_GROUPS`; a reader
  sampling mid-run sees a climbing count (same as pre-change) and 0 before ▶. No action — documented so the
  next auditor doesn't misread a bare-load 0 as a defect.

**Done-when:** n/a (notes) — fold any real fix into the next suite touch.

---

## Gates

- `Dex-Test-Suite.html?full` **all-green** — verified in-browser this session (103/1594).
- `tests/browser-gates.mjs` green after §1 — **closed on inspection 2026-07-04** (gate hardened 2026-07-03
  `BROWSER-GATES-CI-TIMEOUT`; predicate-equivalence verified in-browser; the literal served-checkout
  playwright run is un-runnable here and superseded as a blocker — see the header/§1).
- `verify-provenance.html` GATE A/B **untouched** — no bundle or ledger changed this session; the suite,
  CLAUDE.md, browser-gates, and brand edits are all non-shipped tools/docs → **no re-bundle, no fixture
  re-record.**

## Lifecycle (per `CLAUDE.md`)

Date in filename is frozen. Flip §1 → DONE once the browser-gates CI run confirms green; mark §2/§3 DONE as
each sweep lands (gates green). Keep `DOCS-INDEX.md` in sync on every status flip. Spawn
`DEX-TEST-SUITE-LAZY-FOLLOWUPS-II-…` only if executing these surfaces genuinely new residue.

**Closed 2026-07-04:** all four sections resolved (§1 on inspection + the in-browser predicate check, the
owed literal CI run superseded as a blocker; §2/§3 swept 2026-07-01; §4 notes-only). `DOCS-INDEX.md` synced
to DONE. No new residue surfaced on close → no `-II` spawned. Filename frozen (per §📌); status lives here.
