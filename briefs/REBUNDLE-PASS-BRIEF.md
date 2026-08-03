**Status:** DONE — 2026-08-03 · **Created:** (undated — pre-2026-07-03, grandfathered) · **Verified:** both fixes are live in source AND in the shipped bundles; `node tools/build.mjs --check` clean (11 owned, 0 legacy).

> **Executed by other briefs, not by this one — confirmed in code 2026-08-03.**
>
> - **Fix A (Integrator demo samples)** — done, and done *better* than specced. `bindSamples()`
>   (`integrator-app.js:409`) no longer fetches the two 404ing paths; it loads
>   `uploads/trio/2026-06-12/{ECGDex,OxyDex}_2026-06-12.node-export.json` — a same-night synthetic
>   ECG+Oxy pair, so the demo produces a real same-night fusion finding rather than merely loading.
>   Landed via `CPAP-REAL-CORPUS-FOLLOWUPS-II` §3 and is now **gate-backed**: the `Demo-inputs` group
>   (`tests/dex-tests.js:11290`) asserts every shipped demo path is git-tracked, so the 404-in-every-
>   clone failure class this brief found cannot return. Present in `Integrator.html`.
> - **Fix B (`cleanArtifactHR` defensive advance)** — landed **verbatim**, including the rationale:
>   `i = j > i ? j : i + 1; // defensive: guarantee progress even if SOFT ≤ RECOV is ever configured`
>   (`oxydex-dsp.js`). Carried in by `OXYDEX-HR-ARTIFACT-RUNAWAY-FIX` (2026-07-03), which also bounded
>   the recovery search with `HR_ARTIFACT_MAX_RUN_SEC` — the real bug behind the same function.
>   Present in `OxyDex.html`.
>
> ⚠️ **This brief's PROCEDURE is stale — do not follow it.** Steps 3–5 describe the retired inliner and
> `buildHash`-based provenance. Per `CLAUDE.md` §🔏, `buildHash` is RETIRED as a provenance signal
> (`manifestHash` is the sole code identity), the build is OWNED (`node tools/build.mjs --app <App>`
> auto-writes the ledger), and its §"Known non-issues" is doubly stale: `parseTimestamp` is now
> **single-sourced in `clock.js`** (A5, 2026-07-03 — the opposite of its "mirror, don't extract"), and
> PulseDex's IBM Plex Mono woff2 was **dropped** in the 2026-07-03 cutover. Kept unedited as the
> historical record of what was true in June 2026.

# Re-bundle Pass — Continuation Brief (the LAST step)

Checkpoint for resuming in a fresh (token-light) thread. **Read `CLAUDE.md` first** (conventions,
Clock Contract, gate contracts). This brief covers the one remaining step from
`PAPERS-AND-FIXES-BRIEF.md`: the **batched expensive re-bundle pass**. Steps 1–4 of that brief are
DONE (all four papers shipped; PPG/ECG renderer fixes landed). The backlog in `papers/papers.html`
is clear of candidates.

> **Why batched & last:** these are the only *expensive* changes left — each touches a shipped
> `*-dsp.js` / `*-app.js` and requires re-bundling its `Foo.html`, which **changes that app's
> `buildHash`** and flips its committed `uploads/*.json` provenance fixture to stale/red. Do BOTH
> fixes, re-bundle BOTH apps, regenerate the fixtures, and clear `verify-provenance.html` in ONE
> pass — never piecemeal.

---

## Scope — exactly two fixes

### A. Integrator "Load bundled samples" → deleted fixtures
- **Where:** `integrator-app.js` → `bindSamples()`. Two hardcoded paths are fetched and both 404:
  `uploads/ecgdex_2026-06-07 (4).json` and `uploads/OxyDex_2026-06-09_0529_summary.json`. The button
  pushes a warning and silently does nothing.
- **Fix:** repoint the two filenames at existing exports. Closest survivors that exist today:
  `uploads/ecgdex-2026-06-12.node-export.json` and `uploads/oxydex-2026-06-12.summary.json`
  (verify they still exist + load through the real `normalizeFile` path before wiring). Prefer
  repointing over committing a new demo pair. Confirm both load and fuse (overlap) after the fix.
- Edit `integrator-app.js` (+ `Integrator.src.html` only if a path/markup ref also lives there),
  **never** the bundled `Integrator.html`.

### B. OxyDex `cleanArtifactHR` defensive hardening
- **Where:** `oxydex-dsp.js` → `cleanArtifactHR`. The hang is currently *unreachable* (parseCSV strips
  `--,--,0` rows; shipped constants HARD 20 · RECOV 10 · SOFT 15 make the inner `j` always advance),
  so this is a **defensive** 1-liner already specced: change the index advance to
  `i = j > i ? j : i + 1` so progress is guaranteed even if `SOFT ≤ RECOV` is ever configured.
- Edit `oxydex-dsp.js`, **never** the bundled `OxyDex.html`.
- Do NOT change `cleanArtifactHR`'s signature or return shape — the shared assertions in
  `tests/dex-tests.js` are the public contract. Pure internal guard only.

---

## Procedure (single pass, in order)
1. Apply fix A (`integrator-app.js`) and fix B (`oxydex-dsp.js`) in source.
2. **Regression gate (behavior):** open `Dex-Test-Suite.html`, wait ~3 s, confirm `#summary` pill is
   **all green** (and/or `node tests/run-tests.mjs` for the shared groups). A DSP change MUST pass the
   suite before bundling — it catches signature/return-shape breaks an ad-hoc check misses.
3. **Re-bundle both apps** with the inliner: `Integrator.src.html → Integrator.html` and
   `OxyDex.src.html → OxyDex.html`. (Each `*.src.html` references the external `*.js`; the inliner
   produces the standalone `Foo.html`. Confirm each bundle still has its `<template
   id="__bundler_thumbnail">` and that fonts stay system-stack — no `@font-face`/CDN reintroduced.)
4. **Regenerate the stale provenance fixtures.** Re-bundling changed each app's `buildHash`, so any
   committed `uploads/*.json` that stamped the OLD Integrator/OxyDex hash now mismatches. Re-export
   (or re-stamp) the affected fixtures from the freshly-bundled apps so each carries the new
   `buildHash`. (Pre-R1 fixtures with no stamped hash are fine — "no provenance" ≠ failure.)
5. **Provenance gate:** open `verify-provenance.html`, confirm **no red verdicts** (every committed
   export traces to a reproducible build).
6. Re-run `Dex-Test-Suite.html` once more after bundling (the suite drives a real app bundle in an
   iframe) → still all green. Only then call done.

## Gate discipline (both gates required this thread)
- After the DSP/app edits: `Dex-Test-Suite.html` all green.
- After re-bundling: `verify-provenance.html` clean **and** `Dex-Test-Suite.html` still green.

## Known non-issues — do NOT "fix" in passing
- No `@font-face`/CDN/woff2 — system stacks fall through by design (PulseDex's local IBM Plex Mono is
  intentional). `parseTimestamp` is duplicated per `*-dsp.js` on purpose (Clock Contract) — mirror,
  don't extract. `Ganglior` event-bus codename + `ganglior.node-export` schema + the `fascia` alias
  are FROZEN — touch suite/brand strings only, never `ganglior.*` identifiers.

## State of the rest (context, not work)
- Papers shipped this cycle: `qrs-yield.html`, `rmssd-equivalence.html`, `robustness-benchmark.html`
  (+ the earlier set). All are cheap (no bundle/provenance impact) and already gate-green.
- The robustness benchmark's committed run is `uploads/cohort-robustness-summary.json`
  (FAST lane, seeds 0–599); it cites `cohort-runner.html` as its live tool. Nothing in it needs
  re-bundling.
