# Dex Suite ("Tepna") — Response & Action Plan to the External Review

**Status:** WP-A EXECUTED ✅ · **Date:** 2026-06-21

> **WP-A done (this turn) — metric removal + hero inversion, all 6 nodes.**
> - **Deleted:** ANS Age (OxyDex, HRVDex, PulseDex, ECGDex, PpgDex) · Metabolic Age (GlucoDex) ·
>   BP proxies SBP/DBP Est + BP Risk + BP projection (OxyDex, HRVDex, PulseDex). Removed from each
>   node's `*-registry.js`, render/profile/app surfaces, and **all 6 reference guides**; node-export
>   keys kept `null` for back-compat.
> - **Demoted to research depth (never hero/KPI):** VO₂max (5 nodes) · HR-sleep-staging trio
>   `totSleep`/`deepMin`/`remMin` (ECGDex).
> - **Hero inversion:** OxyDex's old "Projected ANS Age" hero card → new **validated apnea bench**
>   (hypoxic burden Azarbarzin 2019 + AASM ODI-4/ODI-3). HRVDex/GlucoDex heroes already led with
>   validated metrics (rMSSD/SDNN/Stress; Glycemic Stability) so the heuristic secondary cards were
>   retired without needing a new headline.
> - **Gate — GREEN:** `Dex-Test-Suite.html` **545 passed / 0 fail / 34 groups** (incl. cohesion-badges);
>   all 6 apps re-bundled and load clean; `verify-provenance.html` shows **no mismatches**. The pass is
>   **JS-only** (no `.src.html` touched) → `buildHash` unchanged → **no fixture regeneration needed**
>   (confirmed: OxyDex fixture still `reproducible ✓`).
> - **Item #5 (default-to-basic) — ALREADY SATISFIED, no change needed:** the suite defaults to
>   **Core/basic** by construction — `MetricRegistry.getTier()` returns `'core'` when nothing is
>   persisted (`// default Core, brief §locked-4`), every `<body>` ships with no `data-mode` (so the
>   CSS hides `secondary`/`research` tiers pre-JS), and the Core pill is pre-`active` in markup. A
>   fresh user lands on basic across all 6 nodes; the reviewer most likely observed a *persisted*
>   Research selection (`dex_depth_tier` in localStorage), not the code default. Tuning exactly which
>   ~8–12 metrics sit in Core is a separate refinement, not a default change.

**Original plan header (for reference):** APPROVED PLAN · **Date:** 2026-06-21
**Responds to:** `DEX-SUITE-EXTERNAL-REVIEW.md` · **Executes via:** `DEX-METRIC-REMOVAL-AUDIT-BRIEF.md`
**Author decisions locked (this pass):**
- ANS Age & Metabolic Age → **delete outright** (all 6 instances).
- BP proxies (SBP/DBP Est, BP Risk, BP projection) → **delete entirely** (3 nodes).
- VO₂max (Uth–Sørensen, 5 nodes) + HR-sleep-staging (ECGDex trio) → **demote to research depth, never hero/KPI.**
- All removal edits run the **full gate**: `Dex-Test-Suite.html` → re-bundle affected `Foo.html` → regenerate `uploads/*.json` fixtures where `.src.html` moved → `verify-provenance.html`.

> This doc is a *plan of record*, not a rebuttal. The review is fair; we accept its core thesis —
> *engineering-led, honestly framed, dragged down by gimmick metrics and an unaudited DSP core* —
> and convert it into sequenced, gated work. Each item below carries: **Verdict** (accept / accept-with-nuance / defer),
> **Action**, **Files**, **Gate**, **Owner-decision** where one was needed.

---

## 1. Response to the section grades (A–F)

### A. Scientific Validity (6/10) — **ACCEPT**
The two named weaknesses are exactly the ones we are removing. The reviewer's own caveat —
*"the problem is not missing disclaimers; it's metrics that shouldn't survive their own disclaimer"* —
is the principle we are adopting as a **standing rule**: *if a metric needs a "NOT a cuff / NOT CPET /
NOT EEG" disclaimer to be defensible, it does not earn a surfaced card.* This rule retires BP outright
and caps VO₂/staging at research depth. The validated anchors the review credits (Azarbarzin 2019,
AASM ODI, Task Force 1996, Toichi 1997, Baevsky, Hayano) stay and become the hero/KPI bench.

### B. Signal Processing (6/10, provisional) — **ACCEPT, and we agree it's the #1 risk**
We concur the *framing* is honest but the *core estimators are unproven to an outside reader*. This is
the highest-substance gap. We are NOT touching DSP internals in this pass (per the "doc only, then
gated removal" scope), but we commit to the two audits as the next work packages (items 3 & 4 below),
each landing with a known-answer test against public RR/PSG data. Until those land, **no node's
frequency-domain HRV or beat-derived HRV number should be cited as validated** — the badge engine
already tiers them correctly; we will not raise any tier without the audit.

### C. Software Engineering (8/10) — **ACCEPT; one real hole acknowledged**
We accept the deduction: `buildHash` fingerprints the **template skeleton, not the executed `*.js`**, so
external-JS drift is invisible to provenance. This is item 7 below and is a genuine fix, not a doc patch.

### D. User Experience (6/10) — **ACCEPT**
"~75 metrics for one oximetry night… dashboard-as-flex" is correct. Two fixes: default depth to `basic`
(item 5) and invert hero cards from heuristic → validated (item 6). Both are in scope as follow-on to
the removal.

### E. Open-Source Quality (7/10) — **ACCEPT**
Licensing is done. The two valid criticisms — **doc sprawl** (60+ markdown briefs, no entry path) and
**no published agreement-vs-ground-truth numbers** — become items 8 and 2.

### F. Innovation (7/10) — **ACCEPT, no action**
We agree the novelty is in *governance + honesty layering*, not the estimators. No change; this is the
identity we protect while removing the gimmicks that undercut it.

---

## 2. Point-by-point on the Top-10 improvements

| # | Review item | Verdict | This pass? | Gate |
|---|---|---|---|---|
| 1 | Remove BP-from-HRV and ANS/Metabolic-Age | **Accept — delete outright** | Plan ready, execute next | Tests + re-bundle + provenance |
| 2 | Publish validation numbers (Bland–Altman vs PSG/Kubios/CPET) | **Accept — DONE (option a)** | ✅ `DEX-VALIDATION-STATUS.md` (internal numbers + honest external gap) | Regression 26/26, R² 0.944 |
| 3 | Audit frequency-domain HRV pipeline + known-answer test | **Accept — DONE** | ✅ `DEX-DSP-AUDIT-FREQ-HRV.md` + `WP-C` test group | Tests 576/0 |
| 4 | Audit PPG/RR beat detection + artifact correction; surface reject rate | **Accept — DONE** | ✅ `DEX-DSP-AUDIT-BEATS-ARTIFACT.md` + `WP-D` test group | Tests 567/0 |
| 5 | Default reports to `basic` depth | **Accept — ALREADY SATISFIED** | ✅ getTier() defaults to core | — |
| 6 | Invert hero cards to validated metrics | **Accept — DONE** | ✅ WP-A (OxyDex apnea bench; others already validated) | Tests green |
| 7 | Close provenance hole: hash executed `*.js`, not just template | **Accept — DONE (additive)** | ✅ `manifestHash` column in `verify-provenance.html` | buildHash unchanged, 0 mismatches |
| 8 | Single canonical entry doc / site map over 60+ md files | **Accept — DONE** | ✅ `DOCS-INDEX.md` (WP-B) | — |
| 9 | Cross-validate `parseTimestamp` with one shared conformance fixture set | **Accept — DONE** | ✅ `WP-G` test group (one truth table × all copies) | Tests 609/0 |
| 10 | State no-diagnostic-claim prominently; no surfaced metric reads diagnostic | **Accept** | Falls out of removal + disclaimer pass | cohesion + manual |

### Detail per item

**#1 — Remove BP + ANS/Metabolic Age. DECISION: delete outright.**
Full per-node target list and 1:1 hero replacements are already enumerated in
`DEX-METRIC-REMOVAL-AUDIT-BRIEF.md`. Summary of replacements we are committing to:
- OxyDex: vacated `ansAge`/`bpProj` slots → **Hypoxic burden** (Azarbarzin 2019) and/or **ODI-3**.
- HRVDex: readiness subscores off BP/ANS-age → **rMSSD** (primary) + **Baevsky SI** or **HRV Momentum** (secondary).
- PulseDex (`slANS`/`heroTop`): → **rMSSD / SDNN** + **Baevsky SI**.
- ECGDex: `ansAge` slot → a **validated ECG-derived metric** (RR-accuracy / EDR respiration bench).
- GlucoDex: `metAge` → **TIR / GMI / CV%** (CGM consensus, no disclaimer).
- PpgDex: `ansAge` → **rMSSD / SDNN** from the PPG bench.
Execution follows the brief's 5-step checklist (registry → render → dsp → reference guide → gate).
**Provenance note:** registry/JS-only edits leave `buildHash` unchanged; removing a metric's
**reference-guide card** and any `.src.html` edit **moves the hash** → regenerate that node's
`uploads/*.json` fixtures and re-check `verify-provenance.html`.

**#1 — VO₂ + HR-staging. DECISION: demote, do not delete.**
VO₂max (`vo2*`) and ECGDex staging trio (`totSleep`/`deepMin`/`remMin`) drop to **research depth**,
removed from every hero/KPI/secondary slot, kept behind the expandable research view only. Staging may
remain a coarse hypnogram *sketch*, never a numeric hero. No registry deletion; `depth` field + render
path changes only — these are JS-only, so **no hash move** if the reference guide cards are unaffected.

**#2 — Validation numbers.** The single highest-trust-moving item per the review ("even one cohort moves
trust more than any feature"). Scoped as its own package against the existing cohort/synthetic harnesses
(`COHORT-VALIDATION-BRIEF.md`, `SYNTHETIC-CORPUS-BRIEF.md`): target **ODI & staging vs PSG**, **HRV vs
Kubios**, **VO₂ vs CPET** as Bland–Altman/agreement. BP is **dropped, not validated**. Not in this pass.

**#3 — Frequency-domain HRV audit.** Read and document resampling rate, window, detrend, VLF handling in
each node's `*-dsp.js`; add a known-answer test vs PhysioNet RR data into `tests/dex-tests.js` (runs in
both `run-tests.mjs` and `Dex-Test-Suite.html`). Next work package after removal.

**#4 — Beat-detection / artifact audit.** Read PPG/RR peak detection + ectopy/artifact rejection; surface
**rejected-beat rate** in the UI as a quality stamp. Next work package.

**#5 — Default to `basic`. ALREADY SATISFIED (verified WP-A).** `MetricRegistry.getTier()` returns
`'core'` when nothing is persisted, every `<body>` ships with no `data-mode` (CSS hides secondary/
research tiers pre-JS), and the Core pill is pre-`active`. A fresh user lands on basic across all 6
nodes — no change needed. (Tuning exactly which ~8–12 metrics sit in Core is a separate refinement.)

**#6 — Invert hero cards.** Heroes become validated metrics (per #1 replacements). This is the
highest-leverage UX change and is inseparable from the removal — execute together.

**#7 — Provenance hole.** Extend `ganglior-provenance.js` so `buildHash` covers the **executed `*.js`
+ CSS manifest**, not only the `__bundler/template`. This intentionally invalidates current fixtures
(by design — it's a stronger hash) and is a deliberate, announced break with a one-time fixture regen.
Separate package; do NOT fold into the removal pass (don't conflate two hash-moving changes).

**#8 — Canonical entry doc.** Add a single `README` / site-map indexing the 60+ briefs by topic
(governance, per-node build, audits, licensing, archived). Pure doc, no gate; can land immediately and
independently. *(Candidate to do right after this response if you want.)*

**#9 — `parseTimestamp` conformance set.** Keep the intentional per-node duplication (Clock Contract),
but add ONE shared truth-table fixture all copies are tested against, in both runners. Catches drift
without violating "mirror, don't extract." Separate small package.

**#10 — No-diagnostic-claim. LARGELY DONE.** The WP-A removals deleted the most diagnostic-reading
surfaces (BP, ANS/Metabolic Age). Disclaimer audit (2026-06-21): **every app shell carries the
consistent `dxl-disclaimer` ribbon + `dxl-spdx` Apache-2.0 stamp + an "Intended use — not a medical
device, does not diagnose" disclosure** (verified OxyDex…GlucoDex). **Stale-text follow-up RESOLVED
2026-06-21:** OxyDex's disclosure body no longer lists the removed *"blood pressure projections"* (now
"VO₂max estimate, HRV proxies, AHI/CVHR estimates"). Re-bundled; buildHash unchanged (body-text edit
doesn't move the runtime hash) → fixture still reproducible, 0 mismatches — and `manifestHash` moved,
demonstrating WP-F catching the change buildHash structurally misses.

---

## 3. Sequencing — status

1. **WP-A — Metric removal + hero inversion** (items 1, 6, much of 10) — ✅ **DONE.** Default-to-basic
   (#5) verified **already satisfied**, no change needed. Gate green (tests 545/0, 6 bundles clean,
   provenance no-mismatch, no fixture regen).
2. **WP-B — Canonical entry doc / site map** (item 8) — ✅ **DONE** (`DOCS-INDEX.md`, linked from README).
3. **WP-C — Frequency-domain HRV audit + known-answer test** (item 3) — ✅ **DONE.**
   `DEX-DSP-AUDIT-FREQ-HRV.md` documents all three Lomb–Scargle estimators (method is sound: raw
   intervals, Task-Force bands, linear detrend + Parseval in the RR nodes); `tests/dex-tests.js`
   gains a 12-assertion `WP-C` known-answer group (suite green). **PpgDex parity fix APPLIED**
   (linear detrend + Parseval calibration → on par with ECGDex/PulseDex); re-bundled, suite 580/0,
   provenance buildHash unchanged + 0 mismatches.
4. **WP-D — Beat-detection / artifact audit + reject-rate UI** (item 4) — ✅ **DONE.**
   `DEX-DSP-AUDIT-BEATS-ARTIFACT.md`: all three nodes apply the Malik 20% ectopy rule (ECGDex counts
   ectopy separately + gap-aware coverage); reject rates already computed/partly surfaced. 10-assertion
   `WP-D` known-answer test (suite 567/0). Open items are consistency (ectopy threshold annotation,
   range-bound unification) + confirming a prominent UI data-quality stamp — small gated follow-ups.
5. **WP-E(a) — Validation status** (item 2) — ✅ **DONE.** `DEX-VALIDATION-STATUS.md` consolidates the
   internal numbers (real-corpus regression **26/26, ODI-vs-AHI R² 0.944** live; ECG beat-recovery 1.0;
   ECG−PPG rMSSD Δ≈−29 ms; CPAP residual-AHI ±1.5/h; 0 throws) + the WP-C/D/G known-answer tests +
   WP-F provenance, and states the **external-validation gap** (no PSG/Kubios/CPET data in repo) without
   hedging, with the smallest-first path to close it. Honest scope per the harness's own badge: synthetic
   ground truth certifies pipeline behavior + coherence, not clinical accuracy.
6. **WP-F — Provenance: fingerprint executed code** (item 7) — ✅ **DONE (additive, no disruptive break).**
   The runtime can't hash the executed modules (the loader strips `__bundler/manifest` from the DOM
   after unpacking), so the fingerprint lives at the VERIFICATION layer: `verify-provenance.html` now
   shows a **`manifestHash`** column — SHA-256[0:12] of each bundle FILE's `__bundler/manifest` (the
   inlined JS/CSS that executes) — alongside the template `buildHash`. It MOVES on any bundled-module
   change, closing the "template-only" gap, while `buildHash` stays template-stable so committed
   fixtures remain reproducible (verified: all 8 buildHashes unchanged, 0 mismatches). No fixture
   break, no re-bundle needed (tool-only edit).
7. **WP-G — `parseTimestamp` shared conformance fixtures** (item 9) — ✅ **DONE.** New `WP-G` group:
   ONE shared truth table run against every reachable live copy (`env.parseTimestamp`,
   `PPGDSP.parseTimestamp`) + a static mirror-drift guard over all 7 per-node sources
   (`function parseTimestamp` + `Date.UTC` + explicit null/NaN miss path). Per-node copies kept;
   42/42 green. Test-only, no re-bundle.

WP-A and WP-B are complete. WP-C is the next substantive package (the #1 thing the review says a
reader must check before trusting HRV output).

---

## 4. What we explicitly are NOT doing

- **Not** validating BP against a cuff — it is deleted, not defended.
- **Not** extracting a shared `parseTimestamp` util — Clock Contract mandates per-node mirroring; we add
  a shared *test*, not shared *code*.
- **Not** raising any evidence tier — tiers only move with audit/validation evidence (WP-C/D/E), never to
  flatter a metric.
- **Not** renaming `Ganglior` / touching `ganglior.node-export` / the `fascia` alias — frozen.
- **Not** folding the provenance-hash change (WP-F) into the removal pass — two hash-moving changes must
  not share a gate.

---

### Bottom line
We accept the review in full. The fix is not a rebuttal — it is **delete the gimmick metrics, invert the
heroes to the validated bench, default to a calm report, then audit and publish the DSP that the
governance was always promising.** WP-A is approved and ready; everything downstream is sequenced behind it.
