# Dex Suite — Metric Removal Audit Brief

**Status:** DONE — 2026-06-23 (FULL-REMOVAL pass complete: ANS Age + HRV/oximetry→BP + Metabolic Age purged from ALL surfaces across every node; 🟡 HRVDex welfare→"Restoration Index" done. Both gates green — Dex-Test-Suite all-green 55 groups, verify-provenance GATE A PASS 8/8. Follow-up spawned: DEX-METRIC-REMOVAL-FOLLOWUPS-2026-06-23-BRIEF.md) · **Created:** 2026-06-20 · **Scope:** all six shipping nodes
(OxyDex, HRVDex, PulseDex, ECGDex, GlucoDex, PpgDex)

<!-- ════ FULL-REMOVAL EXECUTION TRACKER (2026-06-23) ════
  User directive (2026-06-23): FULL removal — purge ANS Age + HRV→BP proxies entirely from
  compute, charts, src.html cards, chartbadges, profile flows, AND reference guides across every
  node (WP-A only stripped the hero/KPI surfaces; the charts + DSP compute + docs were left live).
  Export-schema keys (personalization.ansAge / newMetrics.bpProj / metabolicAge) STAY as explicit
  null for Integrator back-compat — a test pins this ("Null personalization tolerated, P3"). 🟡 also:
  rename HRVDex welfare → "Restoration Index" (energy/coherence kept = Welltory input mirrors; abs
  already neutral). Doing it ONE fully-gated node at a time (per-node re-bundle + BUILD-MANIFEST +
  gates) to avoid a half-broken six-node state.

  ✅ HRVDex — DONE 2026-06-23, both gates green (Dex-Test-Suite 842 pass/55 groups; verify-provenance
     GATE A PASS 8/8). Removed: d_auto_age (dsp) + ch_ov_age/ch_auto_age charts + 2 src cards + 2
     chartbadge entries + the d_auto_age correlation/heatmap/table rows + the dsp ANS-age auto-pill;
     full ANS-age composite in hrvdex-profile.js (compute, window._ansAge* exposure, prof_age
     autofill, age sublabel, infer-banner text) — VO₂ now uses chronological age w/ neutral default
     40 (never written to identity); estimateMAP + computeHtnPatternScore (HRV→MAP / HRV→HTN-risk) +
     ch_ov_map/ch_map_est/ch_htn_pattern charts + their src cards + chartbadge entries; reference-guide
     ANS Age + SBP Est + DBP Est + BP Risk cards, the validation-matrix row, the SBP/DBP abbreviations.
     KEPT (correctly): d_bap/ch_bap Baevsky Adaptation Potential (autonomic index using USER-ENTERED
     cuff BP, not an estimate) + CAMQ (autonomic balance). welfare→"Restoration Index" (registry label
     + alias + render KPI + ch_welfare card title + reference card). HRVDex.html re-bundled
     (manifestHash ffe97c97ff38→126c984b75a5); BUILD-MANIFEST updated. NOTE: uploads/HRVDex_2026-06-17
     _2055_summary.json is stale (still has d_auto_age + pre-WP-A d_sbp_est/d_bp_risk) but is NOT in
     FIXTURE-PROVENANCE (buildHash-legacy gated, passes); regenerate for currency in a follow-up.
  ⏳ OxyDex — DONE 2026-06-23, both gates green (Dex-Test-Suite 842 pass/55 groups; verify-provenance
     GATE A PASS 8/8, fixture reproducible ✓). dsp/bpProj already null (WP-A); purged from
     oxydex-profile.js: the per-night ANS-age 3-metric composite, window._ansAgeAvg/_ansAgeLast/
     _ansBreakdown exposure, the "Projected ANS Age" hero footer (.readiness-ansage), the age-sublabel
     ANS text + projection-age threading (_projAge now = chronological age, pop default 49), the
     ANS-age auto-detect pill, and the HRV/oximetry→SBP/DBP autofill (bpProj reads). Reference guide:
     removed the ANS Age card, the entire BP PROJECTION section (#bp-proj) + its 3 nav links + the
     validation-matrix row + abbrev section-map remap. OxyDex.src.html: ECGDex-cross-check copy no
     longer promises "real RR-based ANS age". OxyDex.html re-bundled (manifestHash 67bf44dbf1ad→
     b1541b7d4e88); BUILD-MANIFEST + FIXTURE-PROVENANCE updated (export content unchanged → fixture not
     regenerated). NOTE: orphan .readiness-ansage CSS left in src.html shell (dead, harmless).
  ✅ PulseDex — DONE 2026-06-23 (reference-guide only; NO re-bundle). Live ANS-age + BP-from-HRV
     CODE was already removed (pulsedex-dsp.js: "bpEst/htnScore REMOVED 2026-06-22"; ANS-age KPI tile
     deleted in BADGE-COVERAGE-AUDIT-FOLLOWUPS R1). Removed from PulseDex Reference.html: the ANS Age
     card, the SBP Est + DBP Est cards, the validation-matrix row, the algorithmic-limitations note
     mention, the SBP/DBP "(estimate)" abbreviations + section-map. VO₂ kept (research/heuristic).
  ✅ ECGDex — DONE 2026-06-23 (verified clean; nothing to do). No live ansAge in ecgdex-* source
     (WP-A removed it); ECGDex Reference.html has NO ANS Age card. VO₂ + HR-staging already demoted.
  ✅ PpgDex — DONE 2026-06-23 (verified clean). No live ansAge in ppgdex-* source; PpgDex Reference.html
     ANS Age card already removed 2026-06-21 (WP-A comment in place). NOTE: stale committed export
     uploads/ppgdex_20260616.json still carries ansAge:36 (pre-WP-A data artifact, not surfaced) —
     regenerate for currency in the follow-up.
  ✅ GlucoDex — DONE 2026-06-23 (reference-guide only; NO re-bundle). metAge CODE already gone (WP-A;
     glucodex-* source has no metAge). Removed from GlucoDex Reference.html: the Metabolic Age card,
     the quick-jump nav metric + projections section link, the validation-matrix row, the tier-examples
     mention, the citation/formula-provenance row mentions, the caveat <li>.
  CODEGEN MANIFESTS (build-time scaffold quarries, NOT live generators — codegen/README.md: "nothing
     here is referenced by a *.src.html"): codegen/manifests/oxydex.manifest.json still defines an
     `ansAge` metric + `bp-proj` section; the other manifests may carry ansAge/metAge too. These do NOT
     regenerate the shipped guides automatically, so they're non-urgent, but scrub them in the follow-up
     so a future `node dex-gen.js` can't reintroduce the cards.
  After all 6: regenerate any stale uploads fixtures for currency, final full gate run, flip Status
  DONE, spawn FOLLOWUPS brief. ════ -->


**Goal:** identify metrics that are *controversial, undocumented, scientifically
indefensible, or "weird-vibe"* — flag them for removal or demotion, and (where a
flagged metric currently occupies a **hero** or **secondary-hero** card) name a
defensible replacement so we don't leave an empty slot.

> Method: read every `<node>-registry.js` and group by the `evidence` field
> (the node-level source of truth per CLAUDE.md). The **heuristic** tier is, by the
> registries' own definition, "convenience estimate / population proxy" — that is
> exactly the class the user flagged (ANS age, BP-from-HRV). This brief treats the
> heuristic tier as the primary removal pool, plus a short list of experimental
> composites with pseudo-scientific framing.

---

## TL;DR — the removal shortlist

| Severity | Metric | Nodes | Why it's a problem |
|---|---|---|---|
| 🔴 **Remove** | **BP projection / SBP Est / DBP Est / BP Risk** | OxyDex, HRVDex, PulseDex | "Blood pressure from HRV/oximetry" has no validity; medical-claim risk. Already carries a ±10–12 mmHg "NOT a measurement" disclaimer — if it needs that disclaimer it shouldn't be a surfaced metric. |
| 🔴 **Remove** | **ANS Age / Autonomic Age** | OxyDex, HRVDex, ECGDex, PulseDex, PpgDex | Single-number "your nervous system is 43" — a population regression dressed as a personal age. Undocumented coefficients, directional-only, high "weird-vibe." Appears in **5 of 6 nodes**. |
| 🔴 **Remove** | **Metabolic Age** | GlucoDex | Same anti-pattern as ANS Age, for CGM. "mean+CV+TIR → age" is an invented composite. |
| 🟠 **Demote** | **VO₂max Est / VO₂ base / VO₂ adj / VO₂ 7d Avg** | OxyDex, HRVDex, ECGDex, PulseDex, PpgDex | Uth–Sørensen HR-ratio estimate is real but population-proxy, not CPET; defensible only buried in a research drawer, never as a hero or KPI. |
| 🟠 **Demote** | **HR-derived sleep staging — Total sleep / Deep / REM** | ECGDex | "Deep/REM minutes from heart rate" is explicitly *not EEG-validated*. Keep as a coarse hypnogram sketch, never a numeric hero. |
| 🟡 **Reframe** | **Coherence · Welfare Idx · Energy · ABS** | HRVDex | Pseudo-scientific / wellness-coded composite names ("coherence", "welfare"). Internal composites are fine; the *naming* is the weird-vibe. Rename to neutral autonomic terms or drop. |
| 🟡 **Watch** | **Stage Consensus · expected rMSSD** | ECGDex | Directional cross-checks mislabeled as standalone metrics. Keep as annotations on the real metric, not their own cards. |

Everything in the **validated / measured** tiers stays. The **emerging** tier
(DFA α1, HRV Momentum, VEI, CVHR/AHI est, SpO₂ drift, spectral entropy) is fine where
it is — published but device-dependent; keep it in advanced/research depth, not hero.

---

## Per-node detail + hero-slot replacements

### OxyDex — `oxydex-registry.js`
- **Heuristic tier (remove/demote):** `ansAge` (ANS age) 🔴, `bpProj` (BP projection) 🔴, `vo2est` (VO₂max est) 🟠.
- **Experimental composites — keep but verify framing:** `nsi`, `sleepStability`, `sbii`, `odri`, `spo2Skew`, `hd94`. These are honestly tier-labeled internal composites; no action beyond confirming none is promoted above advanced depth.
- **Hero/secondary replacement:** OxyDex has a deep validated bench — promote **Hypoxic burden** (Azarbarzin 2019) or **ODI-3** into any slot vacated by `ansAge`/`bpProj`. Both are validated and clinically meaningful.

### HRVDex — `hrvdex-registry.js`
- **Heuristic tier (remove):** `ansAge` 🔴, `sbp` (SBP Est) 🔴, `dbp` (DBP Est) 🔴, `bpRisk` (BP Risk) 🔴. **Demote:** `vo2`, `vo2roll` 🟠.
- **Experimental composites — reframe naming:** `coherence`, `welfare`, `energy`, `abs` 🟡 (wellness-coded). Neutral keepers: `hrvScore`, `stress`, `ansLoad`, `recovIndex`, `recovDebt`, `efc`, plus header-noted PTI / overtraining risk — confirm those last two are actually registered or drop the header line.
- **Hero/secondary replacement:** the readiness hero subscores reportedly lean on BP/ANS-age proxies. Replace with validated HRV: **rMSSD** (parasympathetic, Task Force 1996) as the primary, **Baevsky SI** or **HRV Momentum** (14-day ln-rMSSD slope) as the secondary-hero trend. All defensible.

### PulseDex — `pulsedex-registry.js`
- **Heuristic tier (remove):** `ansAge` 🔴, `sbp` 🔴, `dbp` 🔴. **Demote:** `vo2`, `vo2base` 🟠.
- **Hero/secondary replacement:** `pulsedex-app.js` wires a dedicated **`slANS`** section + **`heroTop`** — confirm whether `ansAge`/SBP/DBP render there. Replace with **rMSSD / SDNN** (validated) and **Baevsky SI** for the autonomic-load story. PulseDex computes true RR-interval HRV, so it has the cleanest replacements of any node.

### ECGDex — `ecgdex-registry.js`
- **Heuristic tier (remove):** `ansAge` 🔴. **Demote:** `vo2base`, `vo2adj` 🟠, and the HR-derived staging trio `totSleep` / `deepMin` / `remMin` 🟠 (explicitly *not EEG-validated*).
- **Watch:** `stageConsensus`, `expRmssd`, `restingHR`, `hrvScore` 🟡 — keep as supporting annotations, not standalone heroes.
- **Hero/secondary replacement:** ECGDex's validated/emerging set (true ECG morphology, RR-accuracy, EDR respiration, RRacc–EDR agreement) is rich — promote a **validated ECG-derived metric** into any slot freed by `ansAge` or the staging trio.

### GlucoDex — `glucodex-registry.js`
- **Heuristic tier (remove):** `metAge` (Metabolic Age) 🔴 — the node's *only* heuristic metric, and it's the metabolic clone of ANS Age.
- **Hero/secondary replacement:** swap in a validated CGM standard — **Time-in-Range (TIR)**, **GMI**, or **CV%**. These are the established CGM consensus metrics and need no disclaimer.

### PpgDex — `ppgdex-registry.js`
- **Heuristic tier (remove):** `ansAge` 🔴. **Demote:** `vo2` 🟠.
- **Hero/secondary replacement:** promote validated **rMSSD / SDNN** from the PPG HRV bench.

---

## The two systemic patterns worth killing suite-wide

1. **"Body-part Age" metrics** — ANS Age (×5 nodes) + Metabolic Age (GlucoDex). One
   invented single number per node, all heuristic, all "directional only." High
   wellness-gimmick vibe, low defensibility. **Recommend: remove all six.**
2. **"Vital sign from the wrong signal"** — BP from HRV/oximetry (×3 nodes), VO₂max
   from HR ratio (×5), sleep stages from HR (ECGDex). Each ships with a "NOT a
   measurement / NOT a cuff / NOT CPET / NOT EEG" disclaimer. **Recommend: remove BP
   entirely; demote VO₂ and HR-staging to a research drawer, never hero/KPI.**

---

## Execution checklist (when approved)

For each metric approved for removal:
1. Delete its entry from the node's `<node>-registry.js`.
2. Remove its render path in `<node>-render.js` (hero card, KPI strip, table row);
   wire the named replacement into any vacated hero/secondary-hero slot.
3. Drop the matching DSP computation in `<node>-dsp.js` if nothing else consumes it.
4. Remove/replace the metric's card in the node's **Reference guide** — per CLAUDE.md
   the guide is the consumer that must conform to the registry, not vice versa.
5. **Gate:** run `Dex-Test-Suite.html` (esp. `cohesion-badges`) — assert no orphaned
   grades and no retired vocabulary. Re-bundle the affected `Foo.html` from its
   `.src.html`. **A `.src.html` change moves `buildHash`** → regenerate that node's
   `uploads/*.json` fixtures and re-check `verify-provenance.html` (registry/JS-only
   edits that don't touch `.src.html` leave the hash unchanged → no fixture churn).

---

## Open questions for the user
> **Resolved by WP-A (2026-06-21) — kept here for history:** ANS Age & Metabolic Age were
> **deleted** outright (not buried); BP proxies were **deleted**; VO₂max was **kept at research
> depth** (heuristic, not removed). The only live decision is the 🟡 HRVDex reframe below.

**THE ONE LIVE DECISION — 🟡 HRVDex wellness-coded composite names** (`coherence`, `welfare`,
`energy`, `abs`). All four are honestly tiered experimental composites at research/advanced depth
with "internal composite" cites — only the *naming* is flagged. Options:
- **(a) Leave as-is** — the badge/tier system already discloses them as experimental composites;
  "weird-vibe" naming is cosmetic and the tiering is honest.
- **(b) Rename display labels to neutral autonomic terms**, keeping ids + input aliases intact
  (zero compute change). ⚠️ `energy`/`coherence` mirror the user's Welltory input columns
  (`Energy(HRV)`, `Coherence index`) — renaming their display diverges from the source app's own
  vocabulary. `welfare`/`abs` are HRVDex-invented and rename cleanly.
- **(c) Drop `welfare` + `abs`** (the two invented composites) and **keep** `energy`/`coherence`
  under their Welltory-matching names (since those mirror real input fields).
- **(d) Drop all four.**

Recommendation: **(c)** — removes the two purely-invented wellness composites while preserving the
Welltory-input-mirroring fields under names the user's source data already uses.
