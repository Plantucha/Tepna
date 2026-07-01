<!--
  DEX-SUITE-EXTERNAL-REVIEW-v2.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# Dex Suite ("Tepna") — Independent External Review **v2**

*Reviewer stance: skeptical senior biomedical software engineer / sleep researcher /
DSP scientist / OSS maintainer / medical-device SW auditor. No prior contact with the
author. Goal is accuracy, not encouragement.*

> **v2 basis (2026-06-21).** This pass is **code-grounded**, not architecture-inferred. I
> read the new evidence docs that landed since v1 — `DEX-SUITE-REVIEW-RESPONSE.md`,
> `DEX-VALIDATION-STATUS.md`, `DEX-DSP-AUDIT-FREQ-HRV.md`, `DEX-DSP-AUDIT-BEATS-ARTIFACT.md`
> — **and verified the claims against the actual source** (`oxydex-registry.js`,
> `hrvdex-registry.js`, `ecgdex-registry.js`, `pulsedex-registry.js`,
> `pulsedex-render.js`, `pulsedex-app.js`). Where the docs and the code **disagree**, the
> code wins and I say so. Section B is no longer provisional — the estimator internals
> were read.

---

## What changed since v1 (the honest delta)

The team took the v1 review as a plan of record (`DEX-SUITE-REVIEW-RESPONSE.md`) and
executed most of it under gates. Verified against source:

| v1 finding | v2 status (verified in code) |
|---|---|
| Remove ANS Age (×5) | ✅ **Done** — gone from `oxydex`/`hrvdex`/`ecgdex`/`ppgdex`/`pulsedex` registries (explicit "REMOVED 2026-06-21, WP-A" comments). |
| Remove Metabolic Age (GlucoDex) | ✅ **Done** (per response; registry comment confirms). |
| Remove BP-from-HRV (SBP/DBP/BP Risk/projection) | ⚠️ **Partial** — removed from OxyDex & HRVDex registries, **but PulseDex still renders & exports it** (see 🔴 below). |
| Demote VO₂max to research depth | ✅ **Done** — every surviving `vo2*` is `depth:'research', evidence:'heuristic'` (OxyDex `vo2est`, HRVDex `vo2`/`vo2roll`, PulseDex `vo2`/`vo2base`). |
| Demote HR-sleep-staging (ECGDex) | ✅ **Done** (per response). |
| Invert hero cards to validated metrics | ✅ **Done** — OxyDex hero is now the validated apnea bench (ODI-4 `basic`, hypoxic burden Azarbarzin 2019, ODI-3, T90 — all `validated`). |
| Audit frequency-domain HRV | ✅ **Done + regression-guarded** (`DEX-DSP-AUDIT-FREQ-HRV.md`, WP-C, 12 assertions). |
| Audit beat detection / artifact rejection | ✅ **Done + regression-guarded** (`DEX-DSP-AUDIT-BEATS-ARTIFACT.md`, WP-D, 10 assertions). |
| Publish validation numbers | ✅ **Done, honestly** (`DEX-VALIDATION-STATUS.md` — internal numbers + an unhedged statement of the external gap). |
| Close provenance hole (hash executed code) | ✅ **Done** — `manifestHash` column added to `verify-provenance.html`. |
| Single canonical entry doc | ✅ **Done** (`DOCS-INDEX.md`). |
| `parseTimestamp` conformance set | ✅ **Done** (WP-G, one truth table × all copies). |

This is an unusually disciplined response to a review: most of it is real, gated, and
test-backed — not a doc patch. The score movement below reflects that. **But one headline
removal was not actually completed in code**, and a reviewer who only read the response
would miss it. That is exactly the kind of thing this review exists to catch.

---

## 🔴 The one regression the response over-claims — PulseDex still ships BP-from-HRV

`DEX-SUITE-REVIEW-RESPONSE.md` states BP proxies were *"Deleted from each node's
`*-registry.js`, render/profile/app surfaces."* **For PulseDex this is not true in the
shipped code:**

- **`pulsedex-render.js` lines 192–194** still render three table rows:
  `SBP est` (`r.sbp`, tooltip *"HRV→BP proxy (±12mmHg)"*), `DBP est` (`r.dbp`,
  *"HRV→BP proxy"*), and `HTN Pattern` (`r.htnScore`).
- **`pulsedex-app.js` line 423** still computes `const bp = bpEst(...)`, `htnScore(bp.sbp)`,
  and line 461 still emits `sbp`, `dbp`, `dSBP`, `htnScore` into the result object.
- **`pulsedex-render.js` line 270** still writes `'SBP est': r.sbp, 'DBP est': r.dbp` into
  the CSV export.

Two distinct problems, both worse than leaving it alone would have been:
1. **The exact metric the team agreed to delete is still on a user's screen** — the
   "if it needs a NOT-a-cuff disclaimer it doesn't earn a card" rule the response adopted
   is violated in the very node that computes the cleanest HRV.
2. **It now renders *unbadged*.** The `sbp`/`dbp` **registry entries were removed**, so
   these rows no longer resolve a `MetricRegistry.badge()` — a direct violation of the
   project's own 🔴 COVERAGE MANDATE (every surfaced number carries an evidence badge).
   The partial removal turned a badged-but-questionable metric into an
   unbadged-and-questionable one.

**Fix:** delete the `SBP est` / `DBP est` rows (and the CSV columns) from
`pulsedex-render.js`, drop `bpEst`/`htnScore` from `pulsedex-app.js`, and decide on
`htn` (HTN Pattern) — it survives in the registry as `experimental`/`research`, but it is
the same "hypertensive-like ANS score" family and should either be cut or kept honestly at
research depth only. Then re-run the gate. This is small and entirely mechanical; it just
wasn't finished. *(Also re-check PpgDex/ECGDex render for any orphaned `vo2adj`/staging
rows now that those are research-depth — `pulsedex-render.js` still lists `VO₂ base`/`VO₂
adj` rows at 195–196.)*

---

## A. Scientific Validity — **7 / 10** *(was 6)*

**Up one point**, capped below 8 only by the PulseDex BP leak above.
- The two worst metrics in v1 (ANS Age ×5, Metabolic Age) are **gone from the registries**,
  verified. BP is gone from OxyDex/HRVDex. VO₂max and HR-staging are demoted to
  `research` depth with honest `heuristic` tiers and "population proxy, not CPET" cites.
- The adopted **standing rule** — *a metric that needs a "NOT a cuff/CPET/EEG" disclaimer
  does not earn a surfaced card* — is exactly right and is the single most credibility-
  positive decision in the repo's history.
- The validated bench is now the hero (OxyDex: ODI-4/ODI-3/T90/hypoxic burden, all
  correctly cited to AASM / Azarbarzin 2019). This is defensible sleep medicine.
- **Why not 8:** the rule is not yet uniformly enforced (PulseDex still surfaces BP), and
  the experimental wellness composites (Coherence, Welfare, Energy, ABS, EFC, CRS, HTN
  Pattern) still exist — honestly tiered `experimental` at `research` depth, which is
  acceptable, but the *naming* ("Coherence", "Welfare") still reads wellness-gimmick. Not a
  blocker; a polish item.

## B. Signal Processing — **8 / 10** *(was 6, provisional → confirmed)*

I read the estimators this time. The method is genuinely sound:
- **Frequency-domain HRV uses Lomb–Scargle on the raw, unevenly-sampled RR/PPI series —
  no interpolation, no resampling.** This eliminates the single most common freq-HRV error
  (results depending on an arbitrary interpolation rate), which is precisely the v1 worry.
  Bands match Task Force 1996 exactly (VLF 0.003–0.04 / LF 0.04–0.15 / HF 0.15–0.40 Hz).
- ECGDex and PulseDex apply **linear detrend + Parseval calibration** (∫PSD = variance →
  physical ms²); PulseDex additionally takes a **per-window median spectrum** for long
  recordings (a real robustness feature). A known-answer test (WP-C) confirms a pure ramp
  is suppressed to ~19% of a tone's power. This is correct, careful DSP.
- **Beat cleaning is literature-anchored:** the **Malik / Task-Force 20% local-median
  ectopy rule** is present in all RR/PPI nodes. **ECGDex is the standout** — SQI gate +
  physiological range + Malik, **ectopy counted separately** (`nEctopyCorrected`),
  **gap-aware coverage**, and an honest `analyzablePct = cleanBeat% × coverage%`. This is
  the exact failure mode (a clean-QRS PVC inflating rMSSD) the v1 review said had to be
  audited, and it's handled.
- The earlier **PpgDex parity gap** (mean-only detrend, uncalibrated power) was **found and
  fixed** (linear detrend + variance calibration applied, re-bundled, suite green).
- **Why not 9–10:** (a) the estimators are proven *correct against analytic answers*, not
  *in agreement with a reference tool on real recordings* (Kubios/NeuroKit2) — that's the
  validation gap, below; (b) optical PPG peak-placement accuracy on real data is only
  partially exercised; (c) correction **replaces** bad beats with the local median, so a
  heavily-corrected night is partly synthetic — guarded by `correctionRate` but the trust-
  gating on that number should be made louder in the UI (WP-D's own open item).

## C. Software Engineering — **9 / 10** *(was 8)*

- The v1 deduction — `buildHash` fingerprints the **template skeleton, not executed code** —
  is **closed**: `verify-provenance.html` now carries a file-level **`manifestHash`** over
  each bundle's executed JS/CSS manifest, alongside the template `buildHash`. The additive
  approach (don't break committed fixtures, add a stronger fingerprint) is the right call.
- `parseTimestamp` now has a **shared conformance truth table** tested against every per-node
  copy + a static mirror-drift guard (WP-G) — keeps the Clock Contract's intentional
  duplication while catching drift. Exactly the right resolution.
- The test suite grew to **600+ assertions across ~37 groups**, still shared verbatim between
  `node tests/run-tests.mjs` and `Dex-Test-Suite.html`, now including known-answer DSP groups.
- **Why not 10:** single-author bus factor; the no-build inlining still means the runtime
  cannot self-verify executed code (the fingerprint lives at the verification layer, not in
  the running app) — acknowledged and reasonable, but it is a residual.

## D. User Experience — **7 / 10** *(was 6)*

- Hero inversion is done; default depth is confirmed `core`/basic by construction
  (`MetricRegistry.getTier()` returns `'core'` unpersisted, CSS hides secondary/research
  pre-JS). A fresh user lands on a calm, validated-first report.
- **Why not higher:** the ~75-metric structural overload still exists behind the research
  tier (now correctly hidden by default, but "tune which ~8–12 sit in Core" is still open),
  and the **PulseDex BP rows are still visible and now unbadged** — a UX *and* compliance
  regression until the §🔴 fix lands.

## E. Open-Source Quality — **8 / 10** *(was 7)*

- `DEX-VALIDATION-STATUS.md` is the right document done the right way: it states the internal
  numbers **with figures** (real-corpus regression 26/26, ODI-vs-AHI R² 0.944 live;
  byte-reproducible cohorts; ECG beat-recovery median 1.0) **and** says plainly that
  no external PSG/Kubios/CPET agreement numbers exist — *"a data problem, not a code
  problem."* Unhedged honesty about a gap builds more trust than a fabricated number.
- `DOCS-INDEX.md` addresses the doc-sprawl criticism.
- **Why not higher:** the external clinical-agreement numbers still don't exist. That is the
  remaining hard ceiling on researcher trust, and the team agrees.

## F. Innovation — **8 / 10** *(was 7)*

The self-grading **evidence ladder enforced by tests** is now demonstrably load-bearing —
it's what makes the removal/demotion auditable, and the cohesion test asserts engine ≡ CSS ≡
reference guides. Runtime build-provenance for a no-build HTML suite (now two-layer) and the
floating-wall-clock time model remain genuinely uncommon. Novelty is still in
governance/honesty layering, not the estimators — but that layer is real and now battle-tested.

---

## Category scorecard (v1 → v2)

| Category | v1 | v2 |
|---|---|---|
| A. Scientific validity | 6 | **7** |
| B. Signal processing | 6 *(prov.)* | **8** |
| C. Software engineering | 8 | **9** |
| D. User experience | 6 | **7** |
| E. Open-source quality | 7 | **8** |
| F. Innovation | 7 | **8** |

---

## Final rankings (v2)

1. **GitHub hobby-project ranking:** top ~2%. The response-to-review discipline (gated,
   tested, code-verified) is something most *funded* projects don't manage.
2. **Open-source health-analytics ranking:** now **clearly above mid-pack** —
   still behind Kubios/NeuroKit2 on *reference-validated* DSP correctness, but the method is
   confirmed sound and regression-guarded, and the transparency/governance/local-first story
   is best-in-class.
3. **Scientific-credibility ranking:** **moderate-to-good and rising.** The two v1 ceilings
   were the gimmick metrics (mostly removed) and the absent validation numbers (now honestly
   scoped with a clear path). The remaining cap is purely the missing external-agreement data.
4. **Probability I'd personally use it:** **~70%** (was 55%) — I'd trust the HRV/oximetry
   numbers as an honest exploratory dashboard now that the DSP is read and guarded.
5. **Probability I'd recommend it:** **~70%** (was 40%) — would be ~80% the moment the
   PulseDex BP leak is removed and one paired-PSG agreement number exists.
6. **Top improvements before publication (v2 — the list is much shorter now):**
   1. **Finish the PulseDex BP removal** (render rows + CSV cols + `bpEst`/`htnScore` in
      app) — it's the only thing currently contradicting the project's own stated rules,
      and it's a 20-minute mechanical fix + gate.
   2. **Publish one external agreement number** — a single paired-PSG cohort →
      Bland–Altman ODI-4-vs-PSG-ODI (the harness is already built to ingest it). Highest
      trust-per-effort remaining.
   3. **Kubios/NeuroKit2 cross-check** on the same RR the harness already re-detects — a
      drop-in compare that converts B from "method correct" to "agrees with the reference."
   4. **Sweep for orphaned research-depth render rows** (PulseDex `VO₂ base/adj`) and any
      other metric surfaced without a registry entry → badge or remove, to keep the
      coverage mandate clean after the demotions.
   5. **Rename the wellness-coded composites** (Coherence/Welfare/Energy) to neutral
      autonomic terms, or keep them strictly research-depth — last cosmetic gimmick smell.
   6. **Surface the data-quality stamp prominently** (correctionRate / analyzablePct /
      motionRejectedPct) so a high-artifact night is visibly caveated (WP-D open item).
   7. Tune the **Core set to ~8–12 validated metrics** per node (depth defaults are right;
      the curation isn't finished).

---

### Bottom line (v2)
The v1 review's core thesis — *engineering-led, honestly framed, dragged down by gimmick
metrics and an unaudited DSP core* — has been **substantially answered**. The gimmick "age"
metrics are gone, BP is gone from two of three nodes, VO₂/staging are demoted, the
frequency-HRV and beat-detection cores are now **read, found sound, and regression-guarded**,
the provenance hole is closed, and the validation gap is stated honestly instead of hidden.
The scores moved up across every category. **Two things still stand between this and
"researchers would cite it":** (1) finish the PulseDex BP removal — it's the lone place the
shipped code contradicts the team's own rules, and it currently renders *unbadged*; and
(2) produce a single external agreement number against a clinical reference. Neither is large.
This went from "impressive hobby suite with credibility problems" to "a credible, honestly-
scoped tool one dataset and one cleanup away from real scientific standing."

*Section B is confirmed (estimators read), not provisional. The only material defect found
by reading code rather than docs is the PulseDex BP leak in §🔴.*
