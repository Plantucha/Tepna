<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-04 · **Created:** 2026-07-04 · **Parent:** `SELF-INGEST-FOLLOWUPS-II-2026-07-04-BRIEF.md` (DONE 2026-07-04) · **Supersedes:** — · **Followed-by:** `SELF-INGEST-FOLLOWUPS-IV-2026-07-04-BRIEF.md` · **House pattern:** `SELF-INGEST-FOLLOWUPS` → `-II` → `-III`

> **EXECUTED 2026-07-04.** **F1 ✅** — OxyDex live review-render leg added to its `APP_COVERAGE` `extraProbe` in `Dex-Test-Suite.html`: reloads a real `compute()` export and drives `OxyDex.reviewView(review, review.nights)` on the two REAL branches (single-night + multi-night), asserting banner + clinical summary + disclaimer render without throwing (+ the multiNight flag). OxyDex has no light/rich split (always a `nights[]` summary) and no standalone `renderReview`/card (review is `renderAll`-integrated), so single-vs-multi is the faithful analogue of the other five nodes' rich/light. Logic validated headlessly (single 26203 / multi 26181 chars, all chrome markers, `multiNight` true) before the rig. Test-only → NO re-bundle. **F2 DEFERRED** (see §F2 — carried to `-IV`; trigger: any `buildV2` change). **Residue discovered:** the F5 `OxyDex.reviewView` wrapper defaults its `nights` arg to `review.elements`, but OxyDex's `loadOwnExport` returns `review.nights` — harmless (always called with explicit nights, as the probe does) but inconsistent → `-IV` F1 (fold on the next OxyDex re-bundle).

# Self-ingest roll-out — follow-ups III (residue surfaced executing -II)

> **What this is.** The follow-up the brief lifecycle mandates after executing `SELF-INGEST-FOLLOWUPS-II`
> (F1 privacy fix + F2 live review probe + F5 namespace convention, all gate-green 2026-07-04). Two items,
> both **LOW** and explicitly carried forward from -II: one test-coverage gap the -II live probe did NOT
> reach (F1 below) and the -II F4 deferral (F2 below). Read `CLAUDE.md` first — both are test-only /
> node-local; neither is a fleet re-bundle on its own, but F1 touches a per-node app and F2 a DSP.

---

## F1 — ✅ DONE 2026-07-04 · 🟡 LOW (test coverage): OxyDex's live review render is NOT driven by the -II browser probe

**-II F2 shipped a live review-render probe** (`reviewProbe` in `Dex-Test-Suite.html`: `loadOwnExport →
reviewView` rich+light → `renderReview` card mount) and wired it for **five** nodes —
PulseDex/HRVDex/GlucoDex/PpgDex (via the `review:` cfg key in `APP_COVERAGE`) and ECGDex (inline in
`renderCoverageECGDex`). **OxyDex is the gap.** Unlike the other five, OxyDex has **no standalone
`renderReview` + review-card**: its review render is *integrated into `renderAll`* (gated on
`window._oxyReview` + every night `_fromExport`), and -II only exposed `OxyDex.reviewView` (banner +
`oxyClinicalSummary`) on the namespace — it did **not** add a live rig leg that drives it. So OxyDex's
review-mode render is covered only by the F5 **source-mirror** assertion, not a **live** render (the exact
latent-crash class F2 exists to close, now closed for the other five).

**Do (pick one).** (a) Add an OxyDex leg to `reviewProbe` that calls `OxyDex.reviewView(review, nights)`
on a rich + light reloaded export in a detached container and asserts banner + disclaimer + no throw
(cheap, matches the pure side of the other five). (b) Better/real: drive OxyDex's ACTUAL review path —
inject an OxyDex node-export via the app's file input so `renderAll` enters review mode
(`window._oxyReview` set), then assert the `.oxy-clinical` summary + `.oxy-review-banner` mount with
populated values. (b) exercises the integrated path a user hits; (a) only the extracted `reviewView`.
**Done when:** OxyDex's review render is asserted LIVE (rich + light) like the other five;
`Dex-Test-Suite.html?full` green. Node-local test-only + (for (b)) no source change → no re-bundle.

---

## F2 — ⏸ DEFERRED → `-IV` (trigger: any `buildV2` change) · 🟡 LOW (test fidelity): ECGDex + PpgDex §7 groups drive HAND-BUILT exports, not `compute()` (carried from -II F4)

**Verbatim from `SELF-INGEST-FOLLOWUPS-II` F4 (deferred there).** Unlike Pulse/Gluco/HRVDex (whose §7
groups drive `compute()` → `loadOwnExport` on a real synthetic input), the ECGDex + PpgDex §7 groups
reload a **hand-authored** buildV2-shaped export (raw ECG/PPG synthesis is heavy and `buildV2` is
DOM-adjacent app code, not the headless `compute()` light builder). Each has a **guarded**
`genSynthetic→compute(rich)` authenticity leg, but it exercises the LIGHT `ppg/ecgBuildNodeExport` rich
branch, not the app's `buildV2` the user actually reloads. Residual risk: if `buildV2`'s field shape
drifts from what `ecg/ppgLoadOwnExport` reads, the hand-built test won't catch it.

**Do (LOW).** Extract the `buildV2` field assembly to a DOM-free helper (or add a headless golden of one
real `buildV2` output) so a §7 leg can assert the reader against the ACTUAL rich shape. **Defer unless
`buildV2` changes.** **Done when:** at least one §7 leg per node reloads a real `buildV2`-produced export.

---

## Sequencing & gate expectations
1. **F1** first (cheap, closes the last live-review gap) — test-only (option a) or app-input-only (option b); `?full` green.
2. **F2** only if `buildV2` is touched (defer otherwise) — test-only; `?full` green.
- Neither is a fleet re-bundle. Option (b) of F1 and F2 touch no source → no re-bundle; if a source edit
  is made, honor the §🔏 re-bundle + `verify-provenance` gate per `CLAUDE.md`.
