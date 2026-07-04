<!--
  SIGNAL-ADAPTER-FOLLOWUPS-IX-2026-06-25-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-25 · **Created:** 2026-06-25 · **Follows:** SIGNAL-ADAPTER-FOLLOWUPS-VIII-2026-06-25-BRIEF.md (§1 the live appExport ≡ compute() spot check) · **Sibling-of:** -II / -III / -IV / -V / -VI / -VII / -VIII · **Followed-by:** SIGNAL-ADAPTER-FOLLOWUPS-X-2026-06-25-BRIEF.md

> **DONE 2026-06-25 (§1; §2/§3/§4 carried → -X).** ⚠ **DIAGNOSIS CORRECTION:** §1 below framed the HRVDex
> divergence as "display-ROUNDED rmssd/sdnn" — that was WRONG. Investigation on execution found NO rounding
> anywhere in the HRVDex export path: `_hrvParseSummaryRows` uses `parseFloat` (full precision), `computeDerived`
> only adds `d_*` fields, the persist round-trip (`_seedFromRow`/`_rowFromSeed`) preserves full precision, and
> `hrvEventsFromRows` reads RAW `r._rmssd`/`r._sdnn` into event meta. The "18 vs 18.2 / 106.4 vs 107" the
> verifier saw were DIFFERENT ROWS at the same event index (106.4 does not round to 107), not a rounded value.
> The real and ONLY divergence was **SCOPE**: `exportGanglior()` built from `getFilteredRows()`, which defaults
> to `windowDays = 7` (+ optional morning-only) → **the app's Ganglior bus export silently truncated a
> multi-day recording to its last 7 days**, while the headless `compute({text})`/Unifier path emits the whole
> recording. **FIX (the faithful realization of "export full"):** `hrvdex-app.js` `exportGanglior()` now builds
> from the FULL `allRows` recording, not the dashboard VIEW (the human CSV/JSONL exports keep `getFilteredRows`).
> HRVDex re-bundled (`manifestHash 12ee06f41b0f`→`94450ff5b53c`; `buildHash de20db283366` unchanged,
> external-JS-only) → `BUILD-MANIFEST.json` GATE A updated + both HRVDex fixtures' `manifestHash` re-recorded in
> `FIXTURE-PROVENANCE.json` (CONTENT unchanged — fixtures are `compute({text})` output, `hrvdex-dsp.js`
> untouched → no re-export). `Dex-Test-Suite.html` §1 HRVDex leg updated to diff `compute({rows: allRows})` and
> is **byte-identical**. Gates: `Dex-Test-Suite.html` **all-green 943/61** (same-origin); `verify-provenance.html`
> GATE A (HRVDex `94450ff5b53c` matches) + GATE B (both fixtures code-gated at the new hash) clean. §2/§3/§4
> were not requested this pass → carried to -X.

# Signal-adapter Phase-9 — follow-ups IX (residue the VIII live-export-diff pass exposed)

> Round IX. The 2026-06-25 -VIII pass added the live `appExport ≡ compute()` spot check (option (b) from
> -VI §2) to `Dex-Test-Suite.html`'s render-coverage rig (`captureAppExport()` + `_eqDiff()`), covering all
> three migrated nodes. OxyDex/PulseDex came back byte-identical on the **text→parse** path; HRVDex surfaced a
> real **scope/precision divergence** between its app export and `compute({text})`, handled per option (a)
> (compare on the same row set). -VIII also derived the verify-provenance fixture-audit fallback from the
> sidecar (§3). Both gates green (`Dex-Test-Suite.html` 943/61 same-origin; `verify-provenance.html` GATE A/B
> unaffected, no re-bundle). This file captures what THAT pass exposed. Read `CLAUDE.md` first; both provenance
> gates + the Clock Contract rule. Do NOT edit -II…-VIII.

---

## 1 · ⚠ HIGHEST — HRVDex's app export is LOSSY vs the headless path (rounded + filtered): decide the fusion contract

**What surfaced (PROVEN by -VIII §1).** With the new live diff, HRVDex's `exportGanglior()` and
`HRVDex.compute({text})` DISAGREE on the same Welltory CSV in two concrete ways the spot check printed:
- **Precision loss.** App-export event meta carried `rmssd: 18` / `sdnn: 106.4` where `compute({text})` (a
  fresh full-precision parse) had `rmssd: 18.2` / `sdnn: 107`. The app's in-memory rows are display-ROUNDED
  (via `computeDerived`), and `exportGanglior` faithfully exports those rounded rows — so the Ganglior bus
  export from the APP carries less numeric precision than the one the Data Unifier / OverDex produce headless
  from the same file.
- **Scope.** App-export uses `getFilteredRows()` (the user's CURRENT date-filtered view + the accumulating
  running log persisted to `localStorage`), so `recording.measurements` / `startEpochMs` / the event set can
  differ from `compute({text})`'s whole-recording parse (e.g. 5 filtered rows vs 13 parsed, two extra events).

This is NOT a `hrvBuildNodeExport` bug (it is unified per VII §1) — it is upstream **row derivation**: the app
feeds it rounded, filtered, accumulated rows; `compute({text})` feeds it full-precision rows from the one file.
-VIII closed the TEST honestly via option (a) (diff `compute({rows})` against the app export on the SAME row
set → byte-identical), but that **side-steps the product question**: when the Integrator fuses HRVDex, an
APP-produced export and a UNIFIER-produced export of the **same recording** are NOT byte-identical (rounded vs
full precision; filtered vs full scope). For OxyDex/PulseDex they ARE identical, so HRVDex is the odd node.

**Do (decide, then act).**
- **(a) Precision:** decide whether `exportGanglior` should export FULL-precision rmssd/sdnn (carry the
  unrounded value on the row and round only at DOM render) so the app export matches the headless precision.
  This is a small `hrvdex-app.js`/`hrvdex-dsp.js` change (keep a `_raw` alongside the display value, build the
  node-export from `_raw`) — **a DSP/app change → re-bundle HRVDex + regen its fixtures + update
  BUILD-MANIFEST GATE A + FIXTURE-PROVENANCE**, and re-run BOTH gates. Budget for the equiv fixture to MOVE.
- **(b) Scope:** decide whether the app's Ganglior export should honor the active filter (current behavior —
  "export what I'm looking at") or always export the full ingested recording like the Unifier. If the former
  is intended, **document it** as the HRVDex export contract (app = filtered view, Unifier = full recording)
  so downstream fusion treats the two sources as legitimately different-scope, not drift.
- Either way, add a one-line note to `CLAUDE.md`'s evidence/export section capturing the chosen HRVDex
  contract, since it is the one migrated node where app-export ≢ headless-export by design.
**Gate cost:** (a) = HRVDex re-bundle + fixture regen + both gates; (b) = docs-only. **This is the real open
item** — it is the genuine product decision the -VIII test honestly deferred.

## 2 · ◷ -VIII §1's HRVDex leg tests SEAM parity, not the text→parse path (unlike OxyDex/PulseDex)

**What surfaced.** Because of §1, the HRVDex spot check compares `compute({rows: appRows})` to `exportGanglior()`
— both wrap `hrvBuildNodeExport` on the SAME rows, so it proves the two ENTRY SEAMS agree but does NOT exercise
HRVDex's `{text}`→`_hrvParseSummaryRows` path against the app (that path is the one VII §1's bug lived in). The
OxyDex (`{text}`) and PulseDex (`parseRRInput`+`{intervals}`) legs DO exercise parse→build vs the app end-to-end.

**Do (low priority).** Once §1 above is decided: if HRVDex moves to full-precision unfiltered export, REPLACE
the §1 same-row-set diff with a true `compute({text})` ≡ `exportGanglior()` end-to-end diff (matching the other
two nodes) on a CLEAN single-recording load (no running-log accumulation — e.g. boot a fresh rig and load
exactly one CSV, or reset `allRows` before the export). If the filtered-scope contract is kept (option 1b),
leave the seam-parity diff and note WHY it can't be end-to-end. **Gate cost:** test-only.

## 3 · ◷ The render-coverage suite is sensitive to CONCURRENT runs (watchdog + iframe-boot flakes)

**What surfaced.** During -VIII verification, running TWO full `Dex-Test-Suite.html` instances at once (the main
preview reload + the forked verifier's own run) produced transient reds that VANISHED on an isolated re-run:
`Render coverage — ECGDex … bundle loads in iframe` (8 s iframe-onload timeout missed under contention) and
`OxyDex heavy-dropout hang guard … processNight terminates (watchdog 12s) — WATCHDOG TIMEOUT`. A single
isolated run was clean (943/61 all-green). The shared single hidden `<iframe>` + a fixed 8 s/12 s wall-clock
budget are the fragile spots when the main thread / worker is contended.

**Do (low priority).** Either (a) accept it and add a CONTRIBUTING note "run `Dex-Test-Suite.html` in ONE tab at
a time; a lone ECGDex-bundle-load or OxyDex-watchdog red under contention is a flake — re-run isolated before
treating it as real"; or (b) make the budgets adaptive (poll for the readiness marker with a longer cap, or
detect a busy main thread and extend) so concurrent runs don't false-red. Recommendation: (a) — the readiness
gate already polls; the residual flakes are pure wall-clock contention, not logic. **Gate cost:** docs-only (a).

## 4 · ◷ The `env.equiv` Node-CI path is STILL unverified (standing -IV §7 / -V §4 / -VI §3 / -VII / -VIII §2 debt)

**What surfaced.** -VIII added no new `env.equiv` cases, but the standing constraint holds: `node
tests/run-tests.mjs` was NOT run this pass (no Node host). The five equivalence cases (oxydex / pulsedex /
hrvdex / hrvdex_events / pulsedex_events) + the `HRVDex recording block` group are verified green in the
BROWSER only. The new -VIII §1 spot checks are **browser-render-coverage-only by construction** (they boot app
bundles in an iframe), so they will NEVER run under Node CI — that is expected, not debt.

**Do.** When a Node host is available, run `node tests/run-tests.mjs`, confirm exit 0 and the equivalence group
green for all five cases. **Not new work.** **Gate cost:** none (running CI).

---

### Gate posture for this brief
- **§1** is the real work — the HRVDex app-export precision/scope decision (the product question -VIII's test
  honestly deferred). (a) full-precision = HRVDex re-bundle + fixture regen + both gates; (b) document the
  filtered-scope contract = docs-only.
- **§2** is the test-shape follow-on to §1 (end-to-end vs seam-parity), gated on §1's decision.
- **§3** is render-coverage concurrent-run flakiness (best fixed by a CONTRIBUTING note).
- **§4** is the standing Node-CI verification debt.
- None block anything shipped — both gates are green as of 2026-06-25. Stamp `Status: DONE` here only once §1's
  decision lands AND `Dex-Test-Suite.html` is all-green (same-origin host) + `verify-provenance.html` GATE A/B
  clean (+ HRVDex re-bundle/fixtures regenerated if option (a) is chosen). Index in `DOCS-INDEX.md`; spawn `-X`
  only if new residue surfaces.
