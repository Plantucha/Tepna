<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-11 · **Corpus:** ~180 real CPAP nights (6 months), 39 paired with O2Ring, 17 quad-modal · **Related:** `CPAPDEX-PHASE9-FOLLOWUPS-*-BRIEF.md`, `INTEGRATOR-BUILD-BRIEF.md`

# CPAP real corpus — what a whole SD card exposed, and what the data still owes us

> **What this is.** The first time an *entire* ResMed SD card was driven through CPAPDex. Every node in
> the fleet has been exercised on real data except CPAPDex, whose equivalence gate is **synthetic-only**
> by explicit admission in `FIXTURE-PROVENANCE.json`. Running ~180 real nights through
> `CPAPDex.compute()` found **six code defects that synthetic fixtures structurally cannot find**, and
> surfaced a data asset (a quad-modal 17-night overlap + two dated device-setting changes) that unblocks
> work the `PAPERS-ROADMAP` currently lists as blocked-on-reference.
>
> ### 🔒 Scope — this brief is CODE ONLY, on purpose
> The corpus is a real person's therapy record and **this repo is public**. So this brief carries only
> *code facts* (what the DSP computes, what the export drops, what the gates miss) and *method facts*
> (estimator design, null models, correlation structure). **No clinical values, no per-night indices, no
> therapy narrative** — those live in a **local, gitignored** log (`uploads/` is ignored by
> `.gitignore:16`) and must stay there. Raw recordings are likewise never committed. If you extend this
> brief, hold that line: a finding earns its place here only if it changes the **software**.

---

## 1 · The assets

| id | asset | why it matters |
|---|---|---|
| **A1** | **~180 CPAP nights** — 1139 EDF files, ~486 MB, 222 sessions, ~6 months (day-foldered SD-card layout) | ~60× the 2-night real-EDF fixture set. The first corpus large enough to expose threshold/heuristic bugs. |
| **A2** | **39 nights CPAP ∩ O2Ring**, ~6.6 h mean overlap | First real cross-node event↔event join in the fleet. |
| **A3** | **17 nights CPAP ∩ ECG (H10) ∩ PPG (Verity) ∩ O2Ring** — `uploads/trio/` ∩ the CPAP tree | **Quad-modal.** Four independent devices, one night, one clock. See §4 P6 — this is the valuable one. |
| **A4** | **Two dated device-setting step-changes**, each landing on a single identifiable night and holding thereafter | A **labelled change-point dataset** — ground truth for testing `CPAPCross` trend/change detection, which today only ever runs on synthetic nights with `sd: 0` and a `'stable'` label. |

A1–A2 are personal recordings and stay out of git. A3's node-exports are already committed under
`!uploads/trio/**`.

---

## 2 · Code defects (none findable with synthetic fixtures)

### F1 — the ventilation lane never reaches the bus ✅ **FIXED 2026-07-12 (P1)**

> **Executed.** The export now carries **30** metrics (was 15). Note the diagnosis below was
> *mis-attributed*: `cpapBuildExport` does **not** filter — it does `metrics: night.metrics`, passing
> straight through. The drop was upstream in **`nightMetrics()`**, which aggregated only 15 of the 32
> session metrics and never pooled the ventilation lanes at all. Fixed by carrying the mask-on slices
> in `_pool` and pooling them exactly as pressure/leak are pooled. Thresholds and rounding mirror
> `buildSessionFromEdf`, so a single-session night reads **identically** at both levels — verified
> 15/15 on a real EDF night. All 15 were **already graded in `CPAP_REGISTRY`** (rendered per session,
> never aggregated), so no registry or badge work was needed. Fixtures regenerated; both `contentId`s
> unchanged. See `changes/2026-07-12-cpapdex-ventilation-lane.md`.

`buildSessionFromEdf` computes 32 metrics. `cpapBuildExport` emits **15**. The 17 dropped, and whether
they carry real data:

| dropped | populated | |
|---|---|---|
| `respRateMedian` `respRateRange` `tidVolMedian` `minVentMedian` `minVentStability` `breathCount` `breathRate` `ieRatio` | **176/180 nights** | the **whole ventilation lane** |
| `flowLimMean` `flowLimitedPct` `snorePct` `snorePressureCorr` | **168–176/180** | the **flow-limitation + snore lane** |
| `eprDelta` `maskOnLatency` `maxLeak` | **176–180/180** | |
| `compliancePct` `mode` | 0/180 (by design — longitudinal / string) | |

**15 of 17 carry real data on ≥168 of 180 nights, and none reach the `ganglior` bus.** The Integrator
cannot see a single CPAP ventilation variable.

This is not cosmetic. **§3 M2 shows the dropped lane holds the strongest predictor of nightly event
burden anywhere in the corpus** — tidal volume, detrended r ≈ 0.5 (t ≈ 8) — while the pressure and leak
fields that *are* exported sit at r ≈ 0.16–0.26. **We export the weak predictors and drop the strong one.**

*Fix:* additive fields on `cpapBuildExport` → **MINOR** bump (backwards-compatible, per §📦). Regenerate
the CPAP fixtures (output moves). Add the new metrics to `CPAP_REGISTRY` with evidence badges (the
ventilation ones are device-*measured*; `snorePressureCorr` is derived → lower tier).

### F2 — the `mode` heuristic is noise on real data

`cpapdex-dsp.js:506` — `mode = pressIqr > 1.0 ? 'APAP' : 'CPAP'`. Across ~180 real nights the label
**flips 57 times**, and **27% of nights sit within ±0.2 cmH₂O of the 1.0 cut** — the threshold lands
*inside* the distribution, not outside it. It reads as a device setting and is not one. Synthetic nights
have a clean IQR, so the suite never sees this.

*Fix:* retire it, add hysteresis, or derive it honestly — with F1 exporting `eprDelta`, a real
CPAP-vs-APAP call is available from `pressureRange` + `eprDelta` together rather than a bare IQR cut.
**Do not surface a per-night mode label without a stability guard.**

### F3 — CPAPDex's synthetic-only equivalence gate: the stated blocker is FALSE

`FIXTURE-PROVENANCE.json` states:

> *"CPAPDex can't join the Phase-9 'compute() ≡ committed export' equivalence gate (its real input is a
> BINARY multi-file EDF set, not a `{text}`/CSV)"*

So CPAPDex is the **only** node whose GATE-C leg is synthetic (`_synthEdfSet` → golden). Its two
real-EDF fixtures are byte-pinned but **never re-run**.

**Disproved.** `fs.readFileSync` → `ArrayBuffer` → `CpapEdf.readEDF` → `CPAPDex.compute({edfSets})` runs
headless in a Node vm realm over binary multi-file EDF — demonstrated on **222 sessions**, and now
shipped as `tools/cpap-corpus.mjs`. A real-data equivalence leg is buildable today.

> ### ⛔ **P2 BLOCKER — the raw EDFs carry a DEVICE IDENTIFIER. Do not commit them as-is.**
>
> The EDF+ header's `recording` field (bytes 88–168) has the shape:
> ```
> Startdate DD-MMM-YYYY X X X SRN=<device serial> MID=<n> VID=<n>
>                             ^^^^^^^^^^^^^^^^^^^ identical across every file
> ```
> The literal value is deliberately **not reproduced here** — this brief is a public artifact. Read it
> off a local file if you need it.
>
> A persistent hardware identifier that links every night in the corpus. Git history is permanent and
> indexable even after deletion. It also contradicts the suite's own posture: `EXPORT-IDENTITY` makes
> `contentId` *"identity-free (source is a generic device family, **no serial**)"*.
>
> **Required before P2 commits any EDF:** scrub the header to `X`s. The identifier sits in bytes 88–168 —
> away from the start date/time (168–184) and the signal records — so `compute()` output is **unchanged**;
> only `inputHashes` move, and a fixture-only re-record needs **no re-bundle** (§🔏). Check the `patient`
> field (bytes 8–88) in the same pass.
>
> **Cheaper alternative:** *synthesize* an EDF set calibrated to the corpus's distributions. Gets a genuine
> **binary-EDF** equivalence leg with no real recording published at all. Probably the right call.

### F4 — no ResMed ingest adapter

`adapters/` holds 8 vendor adapters (Polar ×3, Coospo, Wahoo, Libre, Welltory, OxyDex-SpO₂) and **none
for CPAP**. The SD-card tree → `edfSets` grouping had to be hand-rolled. The non-obvious rule:

> cluster files whose stamps are within ±60 s of the set's anchor, **and a SECOND file of a type opens a
> NEW set.**

Without that second clause, **8 sessions silently lose an `EVE` file** — a brief mask-off/on inside one
minute writes a second CSL/EVE pair, and a naive ±60 s cluster overwrites the first and under-counts
events. The rule now lives in `tools/cpap-corpus.mjs`; *fix* is to promote it to `adapters/resmed-edf.js`
and register it like the others.

### F5 — `buildLongitudinal` silently returns `crossNight: null` in any Node realm ✅ **FIXED 2026-07-12 (rode P1)**

> **Executed — and the root cause was deeper than the diagnosis below.** Mirroring line 34 was *not*
> sufficient: `cpapdex-cross.js` was a **browser-only IIFE** (`})(window)`) that exposed nothing to
> CommonJS, so `require()`ing it **threw** (`window is not defined`) and the caller swallowed that into
> a null. Real fix: make the module **dual-realm** like its siblings (`module.exports` + `globalThis`
> fallback + a side-effect `require` of the already-dual-realm `kernel-constants.js` for its bare
> `DexKernel` reads; `CrossNightEnvelope` stays optional behind its existing guard), *then* resolve it
> browser-global-first / CommonJS-second in `cpapdex-dsp.js`.
>
> It also exposed a **second, pre-existing bug**: the DSP self-test's unguarded `root.CPAPCross` read
> threw outright under CommonJS, so **`node cpapdex-dsp.js --selftest` had never once completed**. It is
> now an unconditional assertion — **49 passed, 0 failed**, headless.

**Root cause: inconsistent dependency resolution.** `cpapdex-dsp.js` resolves its two external deps two
different ways:

```js
:34   var EDF = (typeof require !== 'undefined') ? require('./cpapdex-edf.js') : (root && root.CpapEdf);
:227  var crossNight = (root && root.CPAPCross && root.CPAPCross.crossNightBlock) ? … : null;
```

The EDF dep has a **Node fallback**; `CPAPCross` is resolved **only** through the browser global `root`
(= `window`). So under a plain CommonJS `require()`, `root` is `null` → `crossNight` is `null`. **Proven**
(identical inputs): `require()` realm → `null`; a realm with `CPAPCross` co-loaded →
`{schema, window, metrics, series, headline}`.

The bug is not the null — it is that it is **silent**. A headless Node consumer gets a quietly degraded
longitudinal block with no error and no warning.

*Fix:* mirror line 34 —
`var CROSS = (typeof require !== 'undefined') ? require('./cpapdex-cross.js') : (root && root.CPAPCross);`
(resolve lazily at the call site to dodge load-order/circularity). **Source change → CPAPDex re-bundles →
`manifestHash` moves**, so this rides P1's bundle pass rather than a standalone one. `tools/cpap-corpus.mjs`
documents the co-load requirement meanwhile.

### F6 — the SA2 oximetry lane has zero real coverage

**217/222** sessions report `oximeter-not-connected`; 5 report `no-spo2-channel`. Every SA2 file parses;
none carries SpO₂. The self-gated desat lane (`selfGateDesat` / `detectDesats` / `oximetryLane`) has
therefore **never run on real data**. Either wire a real oximeter to the device, or state plainly that the
lane is synthetic-only.

---

## 3 · Method findings (what changes how we compute, not what any person's numbers are)

### M1 — a shuffled-null baseline is mandatory for cross-node event coupling

Testing whether node A's events precede node B's events **requires a chance baseline**, because two
frequent event streams co-occur by construction. Circular time-shift surrogates (displace every A event by
±5–15 min) preserve both marginal rates and destroy only the alignment, isolating true coupling.

On the real corpus this **inverted the naive conclusion**: the *dominant* event class (n=688) showed a lift
of **×0.6–1.0** — i.e. exactly chance — at every window from 0–30 s through 0–120 s, while a *rare* class
(n=39) showed **×3.3–10**. Without the null model, the dominant class's raw co-occurrence rate looks like a
finding. It is not one.

The decisive refinement: **stratify by event duration.** Long events must couple if they are real; the
longest bucket (n=42) came back at **lift ×0.0**. Duration stratification is what turns "no signal" into
"provably no signal", and belongs in the primitive.

→ **P5.**

### M2 — the strongest predictor in the corpus is in the dropped lane

Detrended (residuals after removing the shared night-index trend, so this is not drift):

| predictor | detrended r | |
|---|---|---|
| `tidVolMedian` *(dropped)* | **≈ 0.51** (t≈8.0) | strongest in the corpus |
| `minVentStability` *(dropped)* | ≈ 0.50 (t≈7.7) | ⚠ **probably circular** |
| `minVentMedian` *(dropped)* | ≈ 0.28 (t≈3.8) | |
| `medianPressure` *(exported)* | ≈ 0.16 | |
| `largeLeakPct` *(exported)* | ≈ 0.16 | |

**Two honest caveats, both load-bearing:**
- **Not class-specific.** Tidal volume predicts both event classes about equally, so it is an *event-burden*
  correlate — **not** the clean mechanism it first resembled. Do not oversell it.
- **`minVentStability` is probably circular** — an event *is* a gap in ventilation, so events inflate the
  very instability metric that appears to predict them. `tidVolMedian` is a median over thousands of breaths
  and is not obviously circular; it is the one to trust.

Either way, the best predictor in six months of data is a field the bus never sees → **F1**.

### M3 — a plausible mechanism failed its corroborating channel (discipline note)

An association can be statistically bulletproof and still have the wrong mechanism attached. In this corpus
a strong, permutation-verified association (**p ≈ 0.005**, and a competing detection-artifact explanation was
tested and **refuted** separately) came with an obvious causal story — which the machine's *own* corroborating
channel then **contradicted**, moving the opposite way and correlating at **r ≈ 0.00**.

Lesson for the suite: when we ship a causal claim, check whether the node already measures the *precursor* of
the proposed mechanism, and require it to agree. We had the channel and were not using it (**F1** again).

### M4 — the Clock Contract, validated across device families

An EDF-header clock and an O2Ring CSV clock — two unrelated parsers — joined across 39 nights on floating
`tMs` with **zero timezone code**. That is the contract's entire *raison d'être*, demonstrated end-to-end, and
nothing in the suite currently pins it. Deserves a fixture.

---

## 4 · Proposals

| id | proposal | value | effort |
|---|---|---|---|
| ~~**P1**~~ | ✅ **DONE 2026-07-12** — the lane is on the bus (15 → 30 metrics); F5 rode the same bundle. `manifestHash b7cc3f0256da → 1017cee5952a`; 4 fixtures regenerated; changeset dropped. No registry/badge work needed (all 15 were already graded). | **high** | med |
| **P2** | **Real-EDF equivalence leg** (F3) — closes the fleet's last synthetic-only GATE-C. Harness exists. **Gated on the identifier scrub / synthesize-instead decision.** | **high** | low |
| **P3** | `adapters/resmed-edf.js` (F4) — promote the session-grouping rule out of `tools/`. | med | low |
| **P4** | Fix/retire the `mode` heuristic (F2); decide F6. | med | low |
| **P5** | **`event-coupling.js`** — the shuffled-null primitive (M1). | **high** | med |
| **P6** | **CPAP as a respiration REFERENCE for the reference-free σ programme** — below. | **highest** | med |
| **P7** | Apnea → HR (CVHR) and apnea → motion-arousal coupling on A3, via P5. Independently tests M3's re-labelling alternative. | high | med |
| **P8** | Use A4's dated change-points as ground truth for `CPAPCross` change detection. | med | low |

### P5 — the coupling primitive

`cgm-hrv-coupling-analysis.js` is precedent (GlucoDex × PulseDex) but it validates a mechanism **deliberately
planted in the synthetic cohort generator** — it answers *"did our detectors recover what we injected?"*. The
harder, real-data question needs a surrogate null:

```
coupling(eventsA, eventsB, {window:[lo,hi], nullShifts:[…], stratifyBy:'durSec'}) →
  { n, hits, observedPct, chancePct, lift, windowSweep[], strata[] }
```

Generalizes to CPAP apnea × desat, ECG arrhythmia × desat, GlucoDex excursion × anything. **The missing
"is it real or coincidence" primitive for the Integrator** — and M1 shows it *changes conclusions*.
Prototype: `tools/cpap-oxy-couple.mjs` (`coupling()`), ready to absorb.

### P6 — CPAP as a reference. The one that unblocks the σ programme.

The `sigma-no-reference-analysis` / three-cornered-hat programme exists **because there is no reference** —
you cannot measure a device's σ without a truth signal, so you triangulate three devices and hope the
estimator is sound. **We have never been able to check whether it is.**

CPAP's PLD channel writes **measured respiration** — `RespRate` (0.5 Hz), `TidVol`, `MinVent` — from a
calibrated flow sensor in the therapy path. That is a **genuine ventilation reference**, and on the 17
quad-modal nights (A3) it sits beside ECG and PPG on the same clock.

1. Build a **respiration triplet** — CPAP `RespRate` (measured) + ECG-derived respiration (EDR/RSA) +
   PPG-derived respiration.
2. Run the **existing reference-free TCH σ machinery** on it, exactly as it runs on the HR triplet.
3. **Compare its σ estimates against the CPAP reference.** For the first time: *does the reference-free
   estimator actually recover the true σ?*

A **validation of the method itself**, not another application of it — the one experiment a reference-free
technique can normally never run, and exactly what a `PAPERS-ROADMAP` real-validation item needs. Cheap: the
data exists and is already parsed.

---

## 5 · Analysis claims made and then RETRACTED (discipline record)

Recorded so nobody rebuilds them. All four were *plausible* and *wrong*, and each was killed by a specific check.

| claim | killed by |
|---|---|
| Two interventions were "separable in time" | **Nightly** data put both on one night. Weekly aggregates hid it. *Never infer separability from a smoothed view.* |
| One regime "beat" another | **Permutation test** — p ≈ 0.22. It was a 9-night block. *Eyeballed block means are not effects.* |
| A DSP field "reads null — DSP gap" | It is **computed correctly** and then **dropped from the export** (F1). *Check the export before blaming the DSP.* |
| A mechanism explained a real association | The association survived every test; the **mechanism's own precursor channel contradicted it** (M3). *Statistical strength ≠ mechanistic truth.* |

---

## 6 · Done when

- [ ] **P1** — the 15 populated dropped metrics ride the `ganglior` bus; `CPAP_REGISTRY` + badges updated; F5's one-line fix rides the same bundle; CPAP fixtures regenerated (output moves → changeset per §📦); `registry-defs-parity` green.
- [ ] **P2** — the identifier question settled (**scrub** or **synthesize**); a real-binary-EDF `env.equiv` leg runs `compute({edfSets}) ≡ committed export` in **both** runners; `FIXTURE-PROVENANCE.json`'s "can't join" note **deleted**.
- [ ] **P3** — `adapters/resmed-edf.js` registered; the second-file-of-type rule has a unit test.
- [ ] **P4** — `mode` fixed or retired (no bare-IQR label ships); F6 decided and documented.
- [ ] **P5** — `event-coupling.js` in the shared spine with a self-test (window sweep + duration strata + null).
- [ ] **P6** — respiration triplet built on A3; TCH σ compared against the CPAP reference; written up (a `PAPERS-ROADMAP` item, not just a gate).
- [ ] `Dex-Test-Suite.html?full` all-green · `verify-provenance.html` GATE A/B clean · `node tools/build.mjs --check` clean.
- [ ] Follow-up brief spawned per §📌 with whatever P6 turns up.

## 7 · Reproducing

```sh
# SD-card tree → per-night ganglior.node-exports (+ corpus stats)
node tools/cpap-corpus.mjs --root <sd-card-dir> --out exports.json --stats

# fold O2Ring in → event↔desat coupling against a shuffled null
node tools/cpap-oxy-couple.mjs --exports exports.json --oxy <dir-of-O2Ring-csv>
```

Both drive the **real** modules (`cpapdex-edf/dsp/cross/fusion.js`, `oxydex-dsp.js`) in a vm realm co-loaded
exactly as `CPAPDex.src.html` does — no re-implemented parser, no hand-typed numbers. Paths are arguments; no
personal paths or data are baked in. `cpap-corpus.mjs` carries the session-grouping rule (**F4**);
`cpap-oxy-couple.mjs` carries the `coupling()` primitive (**P5**).
