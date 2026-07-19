<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Changelog

All notable changes to **Tepna — the Dex Suite** are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the suite uses
[Semantic Versioning](https://semver.org/) — one version number for the whole suite (the
"maintenance number"). See `docs/COMPLIANCE/SOFTWARE-LIFECYCLE-PLAN.md` for what MAJOR / MINOR /
PATCH mean against Tepna's published contracts, and `RELEASE-MANIFEST.json` for the machine-readable
ledger this file is the human view of.

> **How this file is maintained.** Do **not** hand-edit released sections. Each work-unit drops a
> collision-free changeset in `changes/` (see `changes/README.md`); `tools/release.mjs` folds all
> pending changesets into a new version section here, stamps `suite.manifest.json`, appends a
> `RELEASE-MANIFEST.json` record, and prunes `changes/`. The `release-ledger` gate keeps this file,
> the ledger, and the canonical version in agreement.

> ⚠️ **Reconstructed history.** Everything **below 1.0.0** (waves `0.1.0`–`0.9.0`) is *reconstructed
> from the DONE brief corpus* for provenance — those waves were **not** formally cut releases, and no
> per-app `manifestHash` snapshot is claimed for them. Formal, ledger-backed releases begin at
> **1.0.0**. Dates are the real brief execution dates.

---

## [Unreleased]

_Nothing pending._ Pending work lives as changeset files in `changes/` until the next release folds
them here. (Concurrent OWN-THE-BUILD Part C and docs-ledger follow-up work will land as post-1.0.0
changesets.)

---

## [1.14.0] — 2026-07-19

### Added
- Add a known-answer gate for the cohort-regression OLS kernel — exposes window.CohortRegression.olsR2 (+ a DOM guard so the page loads headless) and pins R² against closed-form values; the analysis page's stats had zero coverage. (`TEST-COVERAGE-FOLLOWUPS-II-2026-07-17-BRIEF.md`)
- Add a cross-night device-SETTING change-point detector (CPAPCross.pressureChangePoints, robust L1-cost binary segmentation) surfaced as an additive crossNight.pressureChangePoints export field — flags a delivered-pressure step (e.g. an EPAP-min change) that crossNight deliberately does not trend, closing the §P8 KNOWN GAP; validated on the real 180-night corpus (nails the 2026-06-12 epap95 step 10.7→6.8, zero false positives). (`CPAP-REAL-CORPUS-FOLLOWUPS-II-2026-07-13-BRIEF.md`)
- Surface device-SETTING change-points in the CPAPDex Longitudinal card (a badged "Device setting changed — EPAP 10.7→6.5 cmH₂O on <date>" banner, export-inert) and unify the three per-node golden regenerators into one `tools/regen-goldens.mjs --node <Name>` over a shared `regen-goldens-core.mjs` (§3); apnea→motion-arousal coupling (§2) re-deferred — no motion-arousal event stream exists to couple against. (`CPAP-REAL-CORPUS-FOLLOWUPS-III-2026-07-17-BRIEF.md`)
- Add a known-answer gate for HRVDex's profile personalization — pins the ACSM/NHANES VO₂-category classifier (calcVo2Cat) and age-band cut points (getAgeBand), which shipped as bare globals but unasserted; test-only wiring, no re-bundle. (`TEST-COVERAGE-FOLLOWUPS-II-2026-07-17-BRIEF.md`)
- Add a known-answer gate for the NSRR PSG ingest adapter — pins SpO₂/HR channel matching, 1 Hz resample (dropout forward-fill + leading-NaN backfill), the Clock-Contract EDF→OxyDex row conversion, AHI severity bands, and (browser lane) profusion-XML → AHI scoring; the parser had zero coverage. (`TEST-COVERAGE-FOLLOWUPS-2026-07-17-BRIEF.md`)
- Add a known-answer gate for the OverDex folder walker — pins fromInput's junk-filter (dotfiles/__MACOSX/.DS_Store dropped by name and by path segment), relPath tagging, and relOf fallback; the walker shipped in OverDex untested. (`TEST-COVERAGE-FOLLOWUPS-2026-07-17-BRIEF.md`)
- Add a known-answer gate for OxyDex's profile personalization — pins the Karvonen target-HR zone (upKarvonenZone) and WHO BMI category bands (upBMILabel), which shipped as top-level globals but unasserted; test-only wiring, no re-bundle. Completes Item 1b. (`TEST-COVERAGE-FOLLOWUPS-II-2026-07-17-BRIEF.md`)
- Add a per-node profile personalization known-answer gate — pins the previously-unasserted cited physiology (Tanaka HRmax, Uth–Sørensen VO₂max, age-norm rMSSD/RHR, CVHR apnea bands, ADAG eAG bias) in ECGProfile/GLUProfile/PPGProfile; runs in both lanes (no bundle re-touched). (`TEST-COVERAGE-FOLLOWUPS-2026-07-17-BRIEF.md`)
- Add known-answers for the qrs-equiv rMSSD-equivalence stats — exposes window.QrsEquiv (Pearson r, Bland-Altman bias/limits-of-agreement, sample SD) with DOM guards so the page loads headless; the inlined analysis-tool HTML was re-bundled. Completes Item 3's meaningful analysis-kernel coverage. (`TEST-COVERAGE-FOLLOWUPS-II-2026-07-17-BRIEF.md`)
- Add a worker-realm reconstruction rig for qrs-equiv-worker — evals the worker source with deps as params + a no-op importScripts, drives its init/job protocol, and asserts it executes without a closure error and reproduces a deterministic ECG/PPG rMSSD known-answer; the analysis workers had never been executed by any gate. (`TEST-COVERAGE-FOLLOWUPS-II-2026-07-17-BRIEF.md`)
- Add a worker-realm reconstruction rig for qrs-yield-worker (direct transfer of the §4 harness) — asserts it executes its QRS-detection-yield doJob without a closure error and reproduces a deterministic known-answer with the ECG+PPG detectors running in-realm. Brings workers executed by a gate to 2 of 4. (`TEST-COVERAGE-FOLLOWUPS-II-2026-07-17-BRIEF.md`)
- Add audits/TEST-AUDIT-PROMPT.md — a test/CI audit charter (fifth sibling of AUDIT-PROMPT.md) that hunts gates which stay green under a real defect, using a mutation-testing lens.
- Add TEST-COVERAGE-FOLLOWUPS-II brief — carries the parent's re-scoped items 3/4/1b (analysis-kernel coverage, worker known-answer rigs, HRVDex/OxyDex profile seam) with per-item plans, since each needs a source change rather than a test-only add. (`TEST-COVERAGE-FOLLOWUPS-II-2026-07-17-BRIEF.md`)
- Add briefs/DEEP-AUDIT-II-2026-07-18-BRIEF.md — the second full-fleet deep audit: 64 correctness defects, a 43-item prioritized punch-list, and the structural finding that six defects survived behind gates asserting the wrong thing. (`DEEP-AUDIT-II-2026-07-18-BRIEF.md`)
- The Integrator types each desaturation obstructive-vs-central from MotionDex's chest-ACC respiratory-effort series (effort present through the event ⇒ obstructive, flat ⇒ central, no coverage or ambiguous ⇒ untyped — never guessed), exported as an additive experimental `summary.apneaTyping` split that leaves confirmedAHI untouched and is a silent no-op when MotionDex is absent. (`APNEA-TYPING-FUSION-2026-07-18-BRIEF.md`)
- Register MotionDex as a first-class Integrator node and feed its body-position track into positional-OSA labelling — `posture_change` run-length events expand hold-last-value into the shared posture series, and `labelPositionalApnea` gains `motion-acc` as a source ranked below the chest strap (uncalibrated frame) but above limb ACC. (`MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md`)
- Surface respiration rate for the first time by fusing independent estimates — the Integrator now reads ECGDex's RSA/EDR `hrv.frequency.respRate` (computed and exported all along, but never consumed) alongside MotionDex's chest-ACC estimate, publishing every source plus the spread so a between-method disagreement is reported rather than averaged away. (`MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md`)
- Motion-gated HRV: MotionDex exports a tri-state per-epoch movement track (`motion.activitySeries`, rendered standalone as a movement timeline) and the Integrator's `gateHRVByMotion` scores each HRV consensus block's window for stillness — an additive confidence annotation that alters no HRV value, with not-recording epochs excluded from the denominator rather than counted as still. (`MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md`)
- MotionDex exports a coverage-honest per-epoch respiratory-effort series (`motion.effortSeries` at 10 s epochs + `effortCadenceSec`/`effortFloorG`) and surfaces it as a standalone effort-presence read + sparkline — `present:null` where chest ACC was not recording, never a fabricated absent. (`APNEA-TYPING-FUSION-2026-07-18-BRIEF.md`)
- Add MotionDex — the fleet's motion / IMU node: parses Polar Sensor Logger ACC/GYRO/MAGN (Verity + H10) on the Clock Contract and computes body position, actigraphy, respiratory effort, and motion SQI; exports ganglior.node-export (node:"MotionDex"). Owned plain-inline ESM-from-birth bundle with full gate coverage incl. a committed-synthetic equiv leg. (`MOTIONDEX-BUILD-2026-07-17-BRIEF.md`)

### Changed
- Reconcile the two 2026-07-18 audits (zero contradictions, three merges applied) and expand AUDIT-PROMPT.md to 14 bug classes with mandatory refuted-claims reporting and an explicit scope declaration. (`AUDIT-RECONCILIATION-2026-07-18-BRIEF.md`)
- Rebuild MotionDex's UI on the shared fleet design system (app-shell + sidebar nav, theme toggle, .kpi-grid/.kpi tiles, .card sections, sticky .eb-* export bar) so it is visually consistent with the rest of the Dex fleet instead of bespoke one-off styling.
- Render-harness §RN wave 2: hoist three inline render classifiers to pure, exposed, TESTABLE functions used at their original call sites (behavior-identical → compute-inert, verified by the green equiv/GATE-C legs) — PulseDex.tanakaHRmax (208−0.7·age, its duplicated HRmax copy), HRVDex hrvRmssdClass (rMSSD readiness color band), OxyDex oxySpo2NightCV (SD/mean·100 night CV). Each was previously an inline expression inside a non-exported DOM-mutating render function, unreachable by any gate, so a threshold/scale slip shipped green; the render-execution harness now pins the surfaced value both-direction. Re-bundled PulseDex/HRVDex/OxyDex (manifestHash moves, outputs unchanged). (`DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS-2026-07-18-BRIEF.md`)
- Hard-gate the last two ungated crossnight metric sets — ECGCross/PulseCross now hoist their METRICS[] to module scope and export an id-keyed ECG_DEFS/PULSE_DEFS projection, and OxyDex's crossnight pbIndex gains the registry entry it never had, so `registry-defs-parity` covers all five nodes (78→149 assertions) with zero ⊘ skips instead of deferring the array-shaped nodes. (`REGISTRY-PROJECTION-2026-07-04-BRIEF.md`)

### Fixed
- Widen `dex-ingest.js` `deviceKey`/`stampMs` to accept the capture-host's contiguous `…_YYYYMMDDHHMMSS_KIND` stamp alongside Polar Sensor Logger's `…_YYYYMMDD_HHMMSS_KIND`. Only the latter parsed, so `deviceKey` returned null on **every** Vigil-captured file, `hasDev` went false, `anchor` went null, and `planIngest`'s entire device-eligibility block was skipped — a Verity ACC became a legal companion for an H10 ECG. Fixed app-side on purpose: the parsers must keep reading the genuine PSL corpus either way, so widen rather than switch, and the on-disk filename is unchanged (renaming would orphan ~478 recorded nights). Also corrects `writers.py`'s false "matches Polar Sensor Logger" comment and the `test_writers.py` test whose name asserted the same non-existent parity. (`ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF.md`)
- Anchor `signal-orchestrate.js fnameStampMs` so a NUMERIC Polar device id is no longer parsed as the date. The unanchored regex consumed the id and kept only the month digits of the true stamp, collapsing every H10 file in a month onto one value; `pairCompanions`' nearest-stamp tiebreak then degraded to "first candidate of that kind". Measured on the real 250-file corpus: **147 of 153 companion slots paired to the wrong night** (51 ECG primaries), fixed to 153/153. Affects multi-night drops in Data Unifier + OverDex only; single-night drops were always correct, and the app path (`dex-ingest.js`) was already anchored. Adds a numeric-id two-night gate — every prior `pairCompanions` test used a lettered id, which structurally cannot reproduce this. (`ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF.md`)
- Close hollow gate #98 — extract a synchronous, exported OverDexWalk.mergePages(pages) from the async readEntries paging loop and pin it with a known-answer (100 + 3 pages → 103, order preserved). The `all = all.concat(page)` → `all = page` (drop-all-but-last-page) mutation silently lost every directory listing beyond 100 files and no test caught it; re-bundled OverDex. (`TEST-AUDIT-FINDINGS-FOLLOWUPS-2026-07-18-BRIEF.md`)
- Single-source the PAT promotion gate into `pat-gate.js` and stop discarding the ACC-corrected verdict. The gate (drift ≤ 60 ms · coupling ≥ 55 % · beat IQR ≤ 60 ms) lived as bare literals inside a Web Worker plus five more literals in the renderer, with **no test executing the math**. Extracting it surfaced two undocumented divergences, both now named and gated: a fourth `physical` condition (median lag must be 60–700 ms), and the fact that `verdict()` runs on **uncorrected** drift while the ACC-corrected coupling was computed, rendered, and never re-gated — so an ACC-corrected pass still reported `DRIFT-DOMINATED`. The primary verdict is deliberately unchanged (promoting on corrected drift is an owner call); the worker now also publishes `vdCorr` and tags `driftSource`. 17 new assertions incl. inclusive-boundary pins and the real 2026-07-06 night. (`ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF.md`)
- Stop a replicated optical channel from fabricating 3-LED agreement. The capture host fans the O2Ring's single ~125.7 Hz finger pleth across `ppg0/1/2` so it routes through the Polar PSL layout with no new parser branch (`capture.py`) — so `consensusBeats` was voting a lone sensor against two bit-identical copies of itself and scoring a structurally-guaranteed `ledAgreementPct: 100`, surfaced as a **`measured`**-tier KPI. `analyze` now dedupes bit-identical channels before the consensus vote (§4's *distinct-channel count*, not a 3-of-3 test — a pre-2026-07-18 capture's extra `timestamp [ms]` column shifts indices so the same ring reads as `(ms-ramp, v, v)`, which a 3-of-3 test would pass as a legitimate 2-LED sensor); at one distinct channel it takes the existing honest `nCh < 2` path and reports `ledAgreement: null`. Beats are unaffected — the guard drops the false claim, not the data. Closes `ENGINE-VERIFICATION-FINDINGS` §1.3 at the DSP tier, where it defends against any device or capture bug that replicates channels rather than today's O2Ring instance. Genuine Verity captures are untouched (three real photodiodes are never bit-identical) — proven, not asserted: the PpgDex real-corpus equiv fixture reproduced byte-identical under the new compute closure. 7 new assertions, both directions mutation-verified (neutering the guard reproduces the original `100`; a naive always-null fix reds the independent-channel leg). (`PPGDEX-MULTICHANNEL-FUSION-2026-07-18-BRIEF.md`)
- ECGDex no longer reports a QT/QTc that is really the median-beat window edge. The median beat is a fixed window (`pre=0.32·fs`, `post=0.46·fs` → 460 ms after R), so when repolarisation genuinely outruns it the T-end tangent extrapolates past the last sample and was silently clamped to `beat.length-1`. QT stopped being a measurement and became a **ceiling**: at 130 Hz every such beat reported `ms(edge−Qon)` ≈ 500 ms regardless of the true interval, a plausible number sitting on a clinical threshold — and two beats with materially different repolarisation collapsed to the identical value. Unlike QRS there is no `medW`-style cross-check to re-anchor T-end onto, so the honest move is to withhold: `delineate` now returns `qtSaturated` and nulls `qt`/`qtcBazett`/`qtcFrid` when the T-end could not be delineated inside the window (no downslope, tangent past the edge, or a T peak on the truncated search boundary) — the same treatment `pr` already gets when P is absent. (`DEEP-AUDIT-II-2026-07-18-BRIEF.md`)
- GlucoDex's "Largest drift" KPI printed the **raw stored mg/dL/day** number under a sub-label naming the **display** unit, so in mmol/L mode it read **18.018×** the "Drift /day" column of the table directly beneath it — a KPI contradicting its own table. The sibling "Between-session spread" tile and the table rows both already routed through `GluDisp`; this was the lone unconverted site. (`DEEP-AUDIT-II-2026-07-18-BRIEF.md`)
- Co-load manifest-gate.js (+ the pure computeHash probe and the two tools/ sources) into the browser test lane — the FIXTURE-VERIFICATION-GATE legs were silently ⊘-skipping there instead of running.
- Three OxyDex desaturation-family defects, all scored against the wrong set or the wrong denominator. (`DEEP-AUDIT-II-2026-07-18-BRIEF.md`)
- Co-load pat-gate.js into the browser test lane — it was wired into run-tests.mjs only, so the PATGate promotion-gate group hard-failed in Dex-Test-Suite.html and its 17 assertions never ran there.
- ECGDex `parseDeviceACC` now takes per-sample time from the device clock
- MotionDex and PpgDex resolve Polar Sensor Logger columns by HEADER NAME instead

---

## [1.13.0] — 2026-07-17

### Added
- Integrator now consumes EventCoupling.coupling() for desat⟷surge apnea confirmation — a coverage-aware shuffled-null verdict (additive apneaCoupling export field) beside the existing Poisson null model; read real/lift only where usable (neither underpowered nor saturated). (`CPAP-REAL-CORPUS-FOLLOWUPS-II-2026-07-13-BRIEF.md`)

### Fixed
- Align ECGDex _malikCorrect's RR range gate to 300–2000 ms (matching buildNN and ECGDex's documented window) so the self-vs-device HRV comparison is genuinely apples-to-apples — a device beat in the 2000–2200 band no longer survives on the device side alone and biases dRMSSD/dSDNN.
- Apply the Clock-Contract §3 whole-file DMY/MDY lock in GlucoDex parseCSV — a European (DMY) Libre export no longer scatters ambiguous rows onto MDY calendar dates mid-file.
- Integrator now reads a GlucoDex dawn surge from glucose.dawn.medianDelta (the key the light export actually writes) — the summary.dawnSurge read chain previously pointed only at pre-enrichment keys and resolved null for every GlucoDex export (the un-fixed sibling of the glucose.cv read-drift).
- The O2Ring .bin decoder no longer fabricates today's date for an undated recording — with no 14-digit filename stamp and no file.lastModified it emits a time-only HH:MM:SS clock (date unknown) instead of stamping the whole night at Date.now() (Clock Contract §4).
- Sleep Stability Score no longer fabricates a neutral 50 for the HR-floor subscore when HR is unmeasurable — it drops the subscore, renormalizes the remaining component weights, and surfaces hrFloor=null so the absence is visible instead of contributing phantom points.

---

## [1.12.0] — 2026-07-16

### Added
- Fused-weight artifact-robust three-cornered hat for the reference-free σ tools. ECGDSP/PPGDSP gain (`TCH-FUSED-ROBUST-HAT-2026-07-14-BRIEF.md`)
- Give the analysis-page statistics a regression net (TEST-COVERAGE-ANALYSIS 2026-07-15). The standalone `*-analysis.html` research tools produced the numbers cited in the σ + validation papers, yet their reliability / agreement / correlation / regression / change-point kernels were covered ONLY by the static "self-contained" gate — nothing executed the math, so a sign error in the three-cornered-hat solve or a between/within swap in the ICC would have shipped a plausible-but-wrong figure with every gate green. Single-sourced those kernels into `analysis-stats.js` (`window.AnalysisStats`: ICC(1,1)+ANOVA, Spearman–Brown, three-cornered-hat, Bland–Altman, Pearson/pearsonCI, partial correlation, simple + matrix OLS with inference, ROC/AUC, change-point) — each lifted VERBATIM (divergent `pearson` variants kept distinct, never merged). The six pages now delegate to it (each aliases the kernel it needs under the same local name, so behavior is preserved by construction) and re-bundle self-contained. Added the Node-lane `Analysis-page statistics kernels — known-answer` group in `tests/dex-tests.js`: hand-computed known answers for every kernel plus a delegation-parity leg asserting each page routes through the tested module (so a divergent private copy can't silently reappear). Kernels are otherwise behavior-preserving (aliased verbatim); the one deliberate fix is `minOccForReliability` (nights-icc "minimum reliable nights"): the inverse Spearman–Brown built its operands via `1−target`, so at an exact integer boundary IEEE-754 rounding gave a ratio of 4.0000000000000009 and bare `Math.ceil` reported 5 where 4 suffices. A `−1e-9` epsilon before `ceil` absorbs the float noise (≫1e-15, ≪ any real fractional occasion) without masking a genuine fractional need — pinned both directions in the known-answer group (boundary 0.5/0.8 → 4; fractional 0.4/0.9 → 14).
- Tepna Vigil capture-host — first real multi-sensor bring-up (out-of-suite `capture-host/`; the 8 shipped bundles are byte-identical). Live **ECG** (Polar H10) + **PPG** (Verity Sense) + **SpO₂/pulse** (Wellue O2Ring-S) streaming concurrently on one BLE dongle, plus the `HEALTH-BOX-VISION §4` hero live-view: a served monitor (aiohttp + SSE) with device bond/remember/forget and a stream-aware live scope + analysis panel (ECG averaged beat, PPG averaged pulse, SpO₂/pulse session summary). Fixes a **~10 % HR bug** — `writers.py` emitted the PSL `timestamp [ms]` column integer+absolute, so ECGDex inferred fs=143 not 130 (real PSL is relative+fractional); verified against a real H10 corpus + a synthetic-frame parity harness. Protocol work verified on hardware: Verity PPG PMD START needs the CHANNELS setting as a **u8** (else err 0x0B/0x05) + a **delta/compressed-frame decoder**; the O2Ring is a **T8520/OxyII device, NOT legacy Viatom** (every existing tool silently fails) → new `oxyii.py` (0xA5-framed, CRC-8, XOR auth → poll `cmd=0x04`, no bond/no AES); the H10 needs a bonded PMD link (auto-bond); a shared `_CONNECT_LOCK` fixes BlueZ `InProgress` on concurrent devices. The `no-network` gate is now usage-aware for the dual-use `aiohttp` (LAN-serve allowed, client usage flagged). (`CAPTURE-HOST-FOLLOWUPS-2026-07-16-BRIEF.md`) (`CAPTURE-HOST-FOLLOWUPS-2026-07-16-BRIEF.md`)

### Changed
- GlucoDex is now built from ES modules — its render/app/profile UI modules AND its DSP (ESM-MIGRATION Phases 1–2). A new `esmBundle` step in `tools/build-core.js` resolves the sibling `import`/`export` graph and inlines each module as its OWN classic block via a shared module registry — names preserved, so `manifest-gate.js`'s computeHash denylist still classifies UI as display and the DSP as compute; no network edge, no `<script type=module>` (which fails under `file://`), and a src.html with no module tags still builds byte-identical (the other 9 owned bundles unchanged). The **co-load bridge** for the DSP (which the orchestrators + both test runners load raw as a classic script): the DSP is DUAL-MODE — it keeps its `window.GLUDSP`/`window.GlucoDex` attaches for every classic consumer while `glucodex-app.js` `import`s its exports — and a shared `DexBuild.classicify` sheds the module syntax for the raw loaders (`tests/run-tests.mjs`'s vm realm via `loadInto`, `tools/regen-glucodex-goldens.mjs`, and `Dex-Test-Suite.html`'s harness), while the orchestrators (`Data Unifier.html`, `OverDex.html`) mark it `type=module` so `esmBundle` wraps it. The `dex-coload` manifest gate stays green (every host still co-loads the DSP). Re-bundled GlucoDex + both orchestrators. The UI conversion is export-inert (display-only, computeHash unchanged); the DSP conversion moves `computeHash` (`a5bda5037069 → 849db418fb72`, and `manifestHash → 1e92a7c23fe7`) but is EXPORT-INERT BY VERIFICATION — the equiv/golden legs reproduce byte-identical and `tools/verify-fixtures.mjs` re-stamped the corpus-backed fixture's `verifiedUnder` to `849db418fb72` after a green real-corpus run (`--check` 0 unverified). Full local gate sequence green incl. the browser lane (`Dex-Test-Suite.html?full` all-green, `bootSkips:[]`; `verify-provenance` GATE A/B; `no-network`), biome + tsc clean. `glucodex-globals.d.ts` stays until every classic consumer is ESM (the DSP still attaches `window` — a Phase 4 sweep). Also fixed a pre-existing browser-lane false-positive in the FIXTURE-VERIFICATION-GATE §3.1 (fail-closed without `git ls-files`, which the browser lane cannot run) — now Node-lane-only like the docs/release-ledger groups. (`ESM-MIGRATION-2026-07-15-BRIEF.md`)
- Split the two shared provenance ledgers into per-app `provenance/<App>.json` fragments (P3). The (`ARCHITECTURE-DEBT-REDUCTION-2026-07-14-BRIEF.md`)
- Reflow the whole source tree with Biome 2.5.3 in one pass and retire the `biome.json` formatter-override list, so every in-scope `*.js` is uniformly formatted and CI's `biome ci` enforces format everywhere (the on-push job flips from `biome lint` to `biome ci`). All 8 apps + the 2 orchestrators re-bundled; every app `manifestHash` moved (whitespace-only churn of the compute closure) but **all 24 fixtures reproduce byte-identical — 0 output/input hashes moved (EXPORT-INERT, verified via a pre/post ledger diff, not asserted)**. Full suite 2497 green, GATE A/B PASS, tsc green, `biome ci` exit 0. ⚠ Because the reflow rewrote DSP text inside the compute closure, `computeHash` moved on all 8 apps, expiring `verifiedUnder` on the 14 corpus-backed fixtures — a full-corpus `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs` re-stamp is OWED before the next release (see ARCHITECTURE-DEBT-REDUCTION-FOLLOWUPS). A family of format-sensitive source-mirror gates in `tests/dex-tests.js` that P4-prep under-measured (cross-Dex significance rule, HRV derived gates, mmol edges, worker-source extractors, badge-by-construction window, and others) were hardened to be whitespace/optional-paren/indent tolerant, each verified to still reject a broken form. (`ARCHITECTURE-DEBT-REDUCTION-2026-07-14-BRIEF.md`)
- CPAPDex is now built from ES modules — the second node (after GlucoDex) migrated in the ESM-MIGRATION fan-out. `cpapdex-app.js` `import`s `{ CpapDsp }` from the DSP and `{ CpapRender }` from render (the primary DSP↔app coupling P5 targets); `cpapdex-render.js` `import`s the DSP so its factory runs before render's load-time `var D = CpapDsp` capture (the classic-load-order hazard that forced a whole-UI conversion). `cpapdex-dsp.js` and `cpapdex-render.js` are DUAL-MODE — they keep their `window.CpapDsp`/`window.CPAPDex`/`window.CpapRender` attaches for every classic co-load consumer while exporting for the ESM bundle; `cpapdex-edf`/`-cross`/`-fusion`/`-coimport`/`-registry` stay classic (read off `window` at call time). The former `node cpapdex-dsp.js --selftest` CJS runner and its dead `module.exports` were dropped (a top-level `export` makes the file an ES module Node's CJS loader cannot parse); the same `selfTest()` still runs in the gated suite. The classic loaders that raw-load the DSP now shed its module syntax via the single `DexBuild.classicify` source: `Dex-Test-Suite.html`'s harness (main() eval, dsp before render), and `tools/regen-cpap-goldens.mjs` / `cpap-corpus.mjs` / `tch-reference-validation.mjs` (vm realms); the two `cpapdex-edf-*.html` self-test pages load the DSP as a native `type=module`. Re-bundled CPAPDex only (the orchestrators don't co-load cpapdex). (`ESM-MIGRATION-FOLLOWUPS-2026-07-16-BRIEF.md`)
- ECGDex → ES modules (fan-out node 3/7). `ecgdex-app.js` `import`s `{ ECGDSP }` from the DSP and `{ ECGUI }` from render (repointing the clean `const DSP = window.ECGDSP, UI = window.ECGUI` capture); `ecgdex-render.js` publishes `window.evBadge = evBadge` before scoping it into the module (the app's bare `evBadge(...)` calls + the classic profile's guarded calls still resolve — mirrors glucodex-render). `ecgdex-dsp.js` and `-render.js` are DUAL-MODE (keep `window.ECGDSP`/`ECGDex`/`ECGUI` attaches + export for the bundle); `ecgdex-morph`/`-profile`/`-cross`/`-registry` stay classic. The inlined `WORKER_SRC` in `ecgdex-app.js` is a hermetic template string (references no module binding), so the export does not touch the worker realm. Marked `ecgdex-dsp.js` `type=module` in both orchestrators (`Data Unifier`, `OverDex`) and re-bundled them + ECGDex. (`ESM-MIGRATION-FOLLOWUPS-2026-07-16-BRIEF.md`)
- ESM-MIGRATION Phase 4 (owner-scoped middle path, 2026-07-16): **the app pages no longer depend on the bare-global spray** — the import boundary is now real and *verifiable* in the product. Per deep-3 node (PulseDex · HRVDex · OxyDex): (`ESM-MIGRATION-FOLLOWUPS-2026-07-16-BRIEF.md`)
- HRVDex → ES modules (fan-out node 6/7, second of the deep 3) — the pulsedex template applied. `hrvdex-dsp.js` is DUAL-MODE (IIFE + `__DEX_NAMESPACED__`-guarded spray untouched; trailing `export const HRVDex = window.HRVDex` + the `/** @type {any} */` IIFE-arg cast for module top-level `this`); `hrvdex-render.js` / `-profile.js` / `-app.js` are ES modules; `-registry.js` / `-chart.js` / `-chartbadges.js` stay classic (chart/chartbadges are self-contained IIFEs — verified no load-time reach-ins; the chart file's 9 "rgba" hits are CSS string literals, not calls). (`ESM-MIGRATION-FOLLOWUPS-2026-07-16-BRIEF.md`)
- OxyDex → ES modules (fan-out node 7/7 — the LAST node; every Dex is now ESM). The follow-ups brief's "hardest node" turned out template-shaped: `oxydex-dsp.js` was already IIFE-wrapped (the namespaced build — its 6 k lines hide the IIFE behind ~45 header-comment lines, which is what mis-read as "bare top-level"), so it takes the standard DUAL-MODE treatment (trailing `export const OxyDex = window.OxyDex` + the IIFE-arg cast; its `allNights` mutable proxy already existed). `oxydex-profile.js` / `-dsp.js` / `-render.js` / `-fusion.js` / `-app.js` are ES modules (shell order preserved: profile → dsp → render → fusion → app, made a real edge by app's four side-effect imports). **`oxydex-util.js` deliberately stays CLASSIC** — it is co-loaded raw by the orchestrators/test runners BEFORE the DSP, and a classic file's globals stay visible to modules, so it needs no publish block and no orchestrator churn; `-registry.js` / `-cross.js` classic too. (`ESM-MIGRATION-FOLLOWUPS-2026-07-16-BRIEF.md`)
- PpgDex → ES modules (fan-out node 4/7) — the hardest worker surface. `ppgdex-app.js` `import`s `{ PPGDSP }` from the DSP and `{ PPGUI }` from render (repointing the clean `const DSP = window.PPGDSP, UI = window.PPGUI` capture); `ppgdex-render.js` publishes `window.evBadge = evBadge` before scoping it into the module (app + classic profile bare-call it). `ppgdex-dsp.js` + `-render.js` are DUAL-MODE; `ppgdex-morph`/`-profile`/`-cross`/`-registry` stay classic. (`ESM-MIGRATION-FOLLOWUPS-2026-07-16-BRIEF.md`)
- PulseDex → ES modules (fan-out node 5/7) — the first of the deep 3 (no clean DSP capture; no-IIFE UI files with shared top-level mutable state). `pulsedex-dsp.js` is DUAL-MODE (IIFE + bare-global back-compat spray untouched; one trailing `export const PulseDex = window.PulseDex`); `pulsedex-render.js` / `-overview.js` / `-app.js` are ES modules with `type=module` tags; `-registry.js` / `-cross.js` stay classic. (`ESM-MIGRATION-FOLLOWUPS-2026-07-16-BRIEF.md`)

### Fixed
- Two batched null-honesty fixes from DEEP-AUDIT-2026-07-14. **§6 (Integrator):** `adaptEnvelopeNode` set `summary.mode = json.recording.sessions[0].mode` — the first session's per-session CPAP label, which CPAPDex deliberately retired (it flipped 7× across 182 real nights; the node forces `metrics.mode=null`). Latent today (no consumer reads it) but a contract landmine that resurrects a value the node chose to null. Fix: honor `json.metrics.mode`. **§7 (CPAPDex):** `periodicBreathingPct` used `durSec>0 ? … : 0` on both sites while its sibling apnea indices (`residualAHI` etc.) return `null` on absence — so a zero-duration session exported a measured-looking `0` beside honestly-null indices (fabricated absence). Fix: `: 0` → `: null` on both. Each gated by an assertion verified RED on the old code first (`§6` returned `'APAP'`; `§7` returned `0`), with controls proving the fix doesn't blank real data. Re-bundled Integrator + OverDex + CPAPDex + the 4 CGM analysis tools that inline the two DSPs. EXPORT-INERT — verified, not asserted: both branches are unreachable by the committed goldens (§6 is ingest-only; §7 needs `durSec===0`), so the Integrator TCH golden + all CPAP goldens reproduce byte-identical and `verifiedUnder` was re-stamped after a green corpus run. (`DEEP-AUDIT-2026-07-14-BRIEF.md`)
- Integrator: stop silently dropping a multi-night CPAP export's entire per-night payload (DEEP-AUDIT-2026-07-14 §2). A CPAPDex ≥3-night Export is a wrapper `{ schema.multiNight:true, nights:[ per-night node-export ] }` with no top-level `recording`/`ganglior_events`/`metrics`. `normalizeFile` unwrapped a `nights[]` wrapper ONLY for `node==='OxyDex'`, so a CPAPDex wrapper fell through to the flat envelope adapter, which read an empty envelope → one date-unknown record, no events, null device-scored AHI (the strongest apnea truth on the bus), `ahiSource` still `'device-scored'`, and NO warning. Fix: unwrap any `schema.multiNight` wrapper generically, per night, so every multi-night emitter is handled like OxyDex — placed AFTER the OxyDex branch so OxyDex keeps its own `nights[]`-aware adapter (OxyDex also sets `schema.multiNight`, so a generic-first unwrap would have regressed it). Gated by a contract assertion driven through `normalizeFile` (a 3-night wrapper → 3 dated records, each with events + non-null device-scored `estAHI`, on three distinct dates), verified RED on the old code first. Re-bundled Integrator + OverDex (which inline integrator-dsp.js); EXPORT-INERT — the Integrator TCH golden reproduces byte-identical (ingest-only change, not in the compute path), `verifiedUnder` re-stamped to the new compute closure. (`DEEP-AUDIT-2026-07-14-BRIEF.md`)
- OxyDex: rate ODI-4 on ONE time basis, not two (DEEP-AUDIT-2026-07-14 §5, owner-ratified canonical basis = SAMPLE). The artifact-exclusion ODI-4 recompute (`oxydex-dsp.js:2178`) rated on the elapsed span (`stats.durationMin/60`) while `detectODI`/`computeODI1`/nadir/`crashRate` + the ODI-4 base all rate on the sample count (`rows.length/3600`); on a gappy night the two diverge, so the surfaced ODI-4/hr and `odi41ratio` sat on incompatible clocks. Fix: `:2178` re-rates on `rows.length/3600`, matching `detectODI` exactly. **A corpus measurement decided the basis and the urgency:** across all 37 real O2Ring nights the two bases produce identical ODI-4 (max gap 2.4 %; the `:2178` recompute never fired), so §5 was a latent landmine with zero current user impact — the O2Ring records continuously at 1 Hz and the hypothesised divergence needs a real finger-off or a sparse-cadence oximeter. SAMPLE was chosen as the clinically honest "per hour of analyzable recording" denominator and the one-site change (the majority already use it). Gated by a new committed twin `synthetic_oxydex_o2ring_gap.csv` — the only input that both diverges the bases (30-min `- -` gap ⇒ rows.length < span) AND fires the `:2178` recompute (a 3.2 %/s fast-fall artifact); on it sample-basis 2/h ≠ span-basis 1.5/h, RED on the old code. Re-bundled OxyDex + Data Unifier + OverDex + the 5 analysis tools that inline oxydex-dsp.js. EXPORT-INERT — verified: all OxyDex equiv legs byte-identical (the clean 1 Hz fixtures never trip `:2178`), `verifiedUnder` re-stamped after a green corpus run. (`DEEP-AUDIT-2026-07-14-BRIEF.md`)
- PulseDex: restore the Task-Force identity `vlf+lf+hf == totalPower` on overnight readings (DEEP-AUDIT-2026-07-14 §3). PulseDex was the un-fixed sibling of the DEEP-AUDIT-2026-07-11 §10 fix ECGDex + PpgDex both carry: its overnight `winSpec` took FOUR independent medians (`tp = median(tp_i)`, not `median(vlf_i)+median(lf_i)+median(hf_i)`), so Total Power and the HF/LF fraction bars (`hf/(tp||1)`) surfaced numbers that don't reconcile with the bands beside them (~5–20% on overnight). Fix: `tp` is now the band sum on both spectral paths — the overnight `winSpec` (`tp = vlf+lf+hf`; the per-segment `w.tp`/`stp` accumulator dropped) and the single-window `lombScargle` return (`tp = _v+_l+_h`), mirroring ECGDex:601 / PpgDex. Gated by a PulseDex identity group driven through `computeResult` on a ~1.7 h overnight record (`vlf+lf+hf === tp`; HF fraction matches the true share), verified RED on the old code first (8681 vs 8648). Re-bundled PulseDex + Data Unifier + OverDex. EXPORT-INERT — verified, not asserted: the export omits `tp` (its `hrv.frequency` block is `{lf,hf,vlf,lfhf}`), so all three PulseDex equiv legs reproduce byte-identical and `verifiedUnder` was re-stamped after a green corpus run — no fixture regen, correcting the brief's fix-sketch which wrongly expected a fixture move. (`DEEP-AUDIT-2026-07-14-BRIEF.md`)
- Unify the Poincaré SD1 estimator fleet-wide on SDSD/√2 (÷N−1), closing the last DEEP-AUDIT-2026-07-14 finding (§8, code-health). PpgDex (`√0.5·std(Δ)`) was already the target; ECGDex's `poincareGeo` SDSD changed from ÷N to ÷N−1; PulseDex's SD1/SD2 spread changed from rMSSD (the RMS of the difference series, ÷N, no mean-centering) to SDSD (its sample SD, ÷N−1) via a new `sdsd()` helper — the geometric SD1²=SDSD²/2, SD2=√(2·SDNN²−SD1²) unchanged. rMSSD² = SDSD² + mean(Δ)², so the shift is mean(Δ)² ≈ 0 on a stationary night (negligible: real fixture sd1 18.74→18.75, synthetic 30.61→30.62), but the three nodes can no longer drift definitionally. Gated by a PulseDex assertion on a trending RR series (mean(Δ)≠0 ⇒ SDSD/√2 ≠ rMSSD/√2): exported sd1 must equal SDSD/√2 and sit below rMSSD/√2, RED on the old code. ECGDex is export-inert (its equiv clip has no sd1); PulseDex's sd1 IS exported so its two moving fixtures were regenerated via a new `tools/regen-pulsedex-goldens.mjs` (third sibling of the CPAP/GlucoDex regen pair), `verifiedUnder` re-stamped after a green corpus run. Re-bundled ECGDex + PulseDex + Data Unifier + OverDex + the 8 analysis tools that inline either DSP. With §8 done, all 8 DEEP-AUDIT-2026-07-14 findings are executed. (`DEEP-AUDIT-2026-07-14-BRIEF.md`)

---

## [1.11.1] — 2026-07-14

### Added
- Add the CPAPDex adversarial two-session-night invariant group, closing one of the two residue shapes DEEP-AUDIT-FOLLOWUPS-2026-07-12 named. The two-session POOLING math (ODI/T90 weight by their own denominator, never an unweighted mean of the per-session rates — a 40-min nap must not count as much as a 6-h sleep, DEEP-AUDIT §20) was only tested on hand-built session objects, and the two-session *pipeline* only on the gitignored real `cpapdex-2026-06-12` EDFs — so it skipped in CI and on any machine without the corpus. The new group drives two synthetic `_synthEdfSet` sessions (B truncated to a short nap + shifted by a 3 h off-mask gap) through the full `buildSessionFromEdf → buildNight → cpapBuildExport` pipeline, in CI, with no corpus: it asserts the grouping (two sets collapse into ONE night, nSessions=2, pooled therapyHours, off-mask gap recorded, anchor on the first session) and the pooling (A 10 min/1 desat = 6/h + B 5 min/1 desat = 12/h → POOLED 8/h, arithmetically ≠ the unweighted-mean 9/h), with a single-session control so it cannot pass vacuously. Verified RED on a rate-averaging regression (reports 9) and on a night-splitting regression (reports nSessions 1). Test-only — no DSP change, no re-bundle. The other named shape, the PPG worker realm, was already closed by `d9ffdcd` (the worker blob executes byte-identical to serial in CI + the live browser pool), and a committed input twin cannot reach the serial-by-design `compute()`, so it needs nothing further; both residue lines are struck. (`DEEP-AUDIT-FOLLOWUPS-2026-07-12-BRIEF.md`)

---

## [1.11.0] — 2026-07-14

### Added
- Make "export-inert" a computed value instead of a claim. Adds **`computeHash`** (`manifest-gate.js`) — `manifestHash`'s projection over an export's **compute closure** — so a render/CSS edit provably cannot move an export while a DSP edit provably can, and adds **`verifiedUnder`** to every corpus-backed fixture: the code that *actually re-ran the app and reproduced those bytes*. `build.mjs` re-stamps `manifestHash` on every rebuild, silently upgrading "came from code X" into "is reproducible under code Y" — an assertion no gate ever tested, and the mechanism by which a stale GlucoDex fixture and a pre-fix DSP reached real users. `build.mjs` is now **forbidden** to write `verifiedUnder` (asserted by source scan); the only writer is the new `tools/verify-fixtures.mjs`, which refuses to stamp unless every corpus input is present *and* the full suite is green. **`release.mjs` now refuses to cut a release while any corpus-backed fixture is UNVERIFIED** — the wall sits where harm materialises (shipping) and where the releaser actually holds the corpus; this would have blocked v1.10.1. CI reports the same thing non-blockingly (a corpus-less contributor cannot green it). The compute closure is a **denylist, not an allowlist**: an allowlist that forgets a module fails *open* and the gate goes blind, while a denylist that forgets one merely over-flags. Migration ran against the real corpus: all 14 corpus-backed fixtures re-verified and stamped, so the gate lands green. (`FIXTURE-VERIFICATION-GATE-2026-07-14-BRIEF.md`)

### Fixed
- GlucoDex: make `detectSessions` able to see a sensor change at all (DEEP-AUDIT-2026-07-14 §4, the same root as §1). The boundary scan tested `FLAG.GAP`, which it can never see over a sensor-change hole — the short-gap branch requires *both* neighbour gaps under `gapThresh` (≈12.5 min at 5-min cadence), so every interior cell of a ≥90-min hole is `FLAG.GAP_LONG`, and a run of short-gap cells can never reach 90 min by construction. So the boundary was unreachable: `nSessions` was **always 1**, the per-session drift fit ran **across mixed sensor wears**, and `levelSessions` (which aligns each wear's median) was a silent no-op. The fit also masked only WARMUP/COMPRESSION, so the drawn `GAP_LONG` line fed its slope, mean and median — the residue `9bdb9be` explicitly left to §4; it now routes through the same `_ana` predicate as every other distribution consumer. Gated on the committed 14 h-gap twin: 3 days now split into 2 wears (inter-session gap 840 min) and the fit runs on 697 measured cells, not 864. **Export-inert — verified, not asserted:** all three GlucoDex fixtures (including the real Lingo night, which carries an actual long gap) are byte-identical, because sessions are not in the export and the level/de-drift corrections are off by default. (`DEEP-AUDIT-2026-07-14-BRIEF.md`)

---

## [1.10.3] — 2026-07-14

### Added
- Add the GlucoDex adversarial gap twin — a committed synthetic Lingo CSV with a 14 h sensor-change gap — closing the coverage hole that let `DEEP-AUDIT-2026-07-14 §1` ship a moved export as "export-inert". The clean synthetic Lingo trips no `FLAG.GAP_LONG`, so no committed input exercised the long-gap path at all; the only leg that did was the real-recording equiv leg, which **skips wherever `uploads/` is absent** (CI, and the machine of whoever lands the change) — so a wrong number reached the served app. The twin is gated both ways, because each catches what the other cannot: a **golden** (`_gap` equiv leg, catching an export that moves by accident) and **invariants** (the drawn interpolation may never be counted as measured glucose, catching the bug class even if a future session regenerates the golden blindly). The control is arithmetic, not a mock — clean daypart n = 864, gapped = 697, and pre-§1 code reported 864 for both. Verified: reverting the fix reds five assertions in a corpus-less tree, i.e. `9bdb9be` would have failed CI on its own PR. Also teaches `tools/regen-glucodex-goldens.mjs` to MINT a first-generation fixture + its ledger record, so standing up a new golden never means hand-writing an export or hand-typing a hash. (`DEEP-AUDIT-FOLLOWUPS-2026-07-12-BRIEF.md`)

---

## [1.10.2] — 2026-07-14

### Added
- Wire `build-docs.mjs --check` into CI as the deploy drift guard (`tests.yml` static job, alongside the `build.mjs` / `build-analysis.mjs` drift guards), so the served `docs/` tree can no longer drift from its root twins unnoticed — the hole through which the 8 stale served app bundles and the lagging `llms-full.txt` both reached `main` and the live site. Prerequisite fix in the same change: `build-docs.mjs` stamped `new Date()` into `sitemap.xml` `<lastmod>`, `feed.xml` `<updated>` and the `llms-full.txt` header, which made the tool non-deterministic — it rewrote three committed artifacts every midnight with no content change, so the new gate would have false-red on every PR from the next day onward (verified: under a simulated future clock the old code reports `STALE (3)` on an in-sync tree). The date now comes from the newest `RELEASE-MANIFEST.json` record — honest (`<lastmod>` = when the served tree actually last shipped, not when the build ran), stable between releases, and byte-identical today. (`REPO-DISCOVERABILITY-FOLLOWUPS-2026-07-04-BRIEF.md`)

### Fixed
- Make `tools/build-docs.mjs` settle the served tree in ONE pass. `llms-full.txt` (Phase 2) concatenates `README.md`, which Phase 3 stamps with the canonical version — so the artifact was generated from the *previous* run's bytes and came out exactly one release behind, leaving `build-docs && build-docs --check` reporting `STALE (1): llms-full.txt` until the writer was run a second time (which no doc prescribes, and the tool's own header comment contradicted). The version stamp is now a pure text transform (`applyStamp`) that Phase 2 derives its text through, instead of re-reading the stamped file — every artifact is a pure function of (source text, canonical version), independent of phase order. Phase numbers are unchanged. (`REPO-DISCOVERABILITY-FOLLOWUPS-2026-07-04-BRIEF.md`)
- Gate a lead-faulted H10 corner in the sensor-trio σ solve: a bad ECG lead for a whole night yields a large positive σ_h10 that TCH reports honestly but that is not a device σ (2026-06-12: σ≈9.5 bpm, decorrelated from both partners while O2·Verity still agree), silently inflating the H10 aggregate. A pure `h10FailureClass()` (sibling of the Verity gate) fingerprints it — σ>5 AND rHO,rHV<0.5 AND rVO≥0.5 — and nulls ONLY the H10 corner (its independent error cancels out of the O2/Verity estimates), keeping the night; both real-night lanes (`sensor-trio-worker.js`, `sensor-trio-power-analysis.js` loadReal) and a nulled corner's bootstrap CI are now point↔CI consistent, fixing the neg-night cosmetic where a nulled h10 still reported a CI.

---

## [1.10.1] — 2026-07-14

### Added
- Add a headless gate asserting every shipped demo's `uploads/` inputs are git-tracked, and repoint the Integrator sample-load demo off two gitignored/nonexistent paths onto committed same-night synthetic exports. (`CPAP-REAL-CORPUS-FOLLOWUPS-II-2026-07-13-BRIEF.md`)
- Add roster-derived per-page `<head>` discovery meta (description · canonical · OG/Twitter) to the 7 reference guides + 4 content pages, generated + `--check`-guarded by a new `tools/build-docs.mjs` Phase 0 that upserts a marked block from `suite.manifest.json` (executes REPO-DISCOVERABILITY-FOLLOWUPS §5.3/§5.6). (`REPO-DISCOVERABILITY-FOLLOWUPS-2026-07-04-BRIEF.md`)

### Changed
- P2 (strictNullChecks) chunk 1: harden the five adapter/orchestrate modules against the null-class errors strictNullChecks surfaces — annotate `never[]` warning arrays, guard `.pop()`-returns-`string|undefined`, cast the `.filter(Boolean)` EDF-stamp array (which tsc does not narrow), and give the `_await` Promise a resolve arg. Comment/guard-level only; export-inert re-bundle of the two orchestrators that inline them. The flag stays OFF until every gated module is clean (final P2 PR). (`ARCHITECTURE-DEBT-REDUCTION-2026-07-14-BRIEF.md`)
- P2 complete: turn `strictNullChecks` ON in the checkJs gate. The remaining 80 null-class errors across the 8 DSPs + dex-ingest + signal-frame are fixed at the source (annotate `never[]`/inferred-null object literals, cast `.filter(Boolean)` arrays tsc won't narrow, cast possibly-null result vars at declaration) and the flag is flipped in tsconfig.json. All comment/guard-level → export-inert re-bundle of the 7 GATE-A apps + both orchestrators; every manifestHash moved but GATE B confirms no fixture output changed. oxydex-dsp/signal-frame/dex-ingest joined biome's formatter-override list (§B2) so their inline JSDoc casts are not mangled by the formatter. (`ARCHITECTURE-DEBT-REDUCTION-2026-07-14-BRIEF.md`)
- Make the `docs-ledger` + `release-ledger` gates Node-lane only and delete the committed `tests/{docs-ledger,changes}-list.txt` snapshots, their generators, and `list-format.js` — killing the regenerate-on-every-PR merge tax (both gates now read `briefs/` + `changes/` straight from the filesystem; the browser lane SKIPs them). (`CPAP-REAL-CORPUS-FOLLOWUPS-II-2026-07-13-BRIEF.md`)

### Fixed
- Make the 9 science/analysis tools self-contained single-file HTML so they run from a local download over `file://` (they only worked when served): new `tools/build-analysis.mjs` inlines every external script and rewrites `new Worker('x.js')` → a blob-URL worker with its deps inlined; gated by `build-analysis.mjs --check` in CI plus a Node-suite invariant group (no external `<script src>`, no file-path workers). Verified under file:// and http:// with headless Chromium. (`LOCAL-DOWNLOAD-FILE-URL-FIX-2026-07-14-BRIEF.md`)
- Regenerate the real-recording GlucoDex export fixture, which the §1 long-gap fix moved but left stale — its `daypart` block still reported interpolated sensor-gap samples as measured glucose, reddening the `compute() ≡ committed export` equivalence gate. Adds `tools/regen-glucodex-goldens.mjs` (sibling of the CPAP regen tool: re-runs the real modules on the committed input, preserves volatile keys, re-records `outputHash` from the bytes it wrote — closing the gap where `build.mjs` re-stamps a fixture only when the *bundle* hash moves), and writes the underlying lesson into CLAUDE.md §🔏: a byte-identical synthetic golden is not evidence of export-inertness, because the real-recording equiv legs skip wherever `uploads/` is absent. (`DEEP-AUDIT-2026-07-14-BRIEF.md`)
- GlucoDex: exclude long-gap interpolation (`FLAG.GAP_LONG`) from EVERY distribution metric, not just the headline TIR family. CONGA/MODD/GVP/MAG/ADRR/postprandial/dawn/nocturnalHypo/daypart/excursions/AGP/per-day all now route through one `_ana()` predicate — so a multi-hour sensor-change gap can no longer inflate surfaced variability or fabricate `nocturnal_hypo` events off an interpolated line (DEEP-AUDIT-2026-07-14 §1). A metamorphic gate (gapped ≠ explicitly-filled gvp) locks it. The real-recording GlucoDex fixture's `daypart` block moved as a result — every `n` drops, because interpolation is no longer counted as measured glucose — and was regenerated; the synthetic golden, which carries no long gap, stays byte-identical. (`DEEP-AUDIT-2026-07-14-BRIEF.md`)

---

## [1.10.0] — 2026-07-14

### Changed
- Execute DEEP-AUDIT-FOLLOWUPS §D1/§D2 (EVENT-LEXICON §7 records the CPAPDex-annotation + HRVDex-window decisions) and §E1 (sweep fixture content-claims against the committed bytes + a new regression gate locking them). (`DEEP-AUDIT-FOLLOWUPS-2026-07-12-BRIEF.md`)
- Gate DOCS-INDEX row status against brief headers (X2), extend the relative-link check to all 7 root docs (X3), and trim CONTRIBUTING.md's duplicated deep-dives + drift (X4).
- Fix the stale manifestHash description in CLAUDE.md/CONTRIBUTING.md (X1) and add a FAILURES recap + --quiet mode to the test runner (D3).
- Land LITERATURE-USE-POLICY's executable residue: a "Literature use" section in CLAUDE.md (hard line + routing rule + pointer to the policy). (`LITERATURE-USE-POLICY-2026-07-11-BRIEF.md`)
- Close INTEGRATOR-TCH-FU-III §1 — the real 17-night trio distribution + reference-anchored magnitude check (17/17 solve; median σ 0.95/1.19/1.85 bpm, Verity corner on the literature anchor), confirming the `_tchRhoFromMotion` ρ-dilution that leaves 3 of 7 quiet-order nights unrescued (docs §11; residue → FU-IV). (`INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III-2026-07-06-BRIEF.md`)
- Gate cpapdex-dsp.js in checkJs (D.2): 5 cpap realm globals + the Node builtins require/process declared in a new node-scoped cpapdex-globals.d.ts, plus 3 comment-only source casts — the two require() call sites (so tsc does not resolve the sibling modules and cascade TS2306) and one boolean-subtraction in a sort comparator. Export-inert re-bundle of CPAPDex (orchestrators don't co-load it); GATE A/B green, no fixture output moved. (`OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md`)
- Gate ecgdex-dsp.js in checkJs (D.2): 13 namespace/sibling globals declared in a new node-scoped ecgdex-globals.d.ts (ECGDSP/ECGDex own attaches kept byte-stable for the ecgLoadOwnExport marker gate, plus the consumed ECGMorph sibling), and 2 genuine internal casts (a tuple annotation on the walk-cadence zoneDef literal, and `_relBase` on an accel array) — comment-only. Export-inert re-bundle of ECGDex (+ the two orchestrators that co-load it); GATE A/B green, no fixture output moved. (`OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md`)
- Gate glucodex-dsp.js in checkJs (D.2): its 13 TS2339 property errors split into the node's own `global.GLUDSP`/`global.GlucoDex` namespace attaches (declared in a new node-scoped glucodex-globals.d.ts so the attach lines stay byte-stable for the source-text safety gates) and two internal inference casts (`.e`, `.events`) — comment-only. Export-inert re-bundle of GlucoDex (+ the two orchestrators that co-load it); GATE A/B green, no fixture output moved. (`OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md`)
- Gate hrvdex-dsp.js in checkJs (D.2) — the first non-free DSP: cast two `.checked` DOM reads to HTMLInputElement (export-inert), add shared spine DexKernel/DexUnits to dex-globals.d.ts, and declare the hrvdex UI-sibling reach-ins in a new node-scoped hrvdex-globals.d.ts. Export-inert re-bundle of HRVDex (+ the two orchestrators that co-load it); GATE A/B green, no fixture output moved. (`OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md`)
- Gate integrator-dsp.js in checkJs (D.2): IntegratorDSP attach + the IntegratorTCH and GangliorProvenance optional siblings declared in a new node-scoped integrator-globals.d.ts, and 6 comment-only source casts (audit-breadcrumb props on fixed-shape events, a null-index accumulator, a never-narrowed posture lookup, and possibly-null window-span arithmetic). Export-inert re-bundle of Integrator (+ OverDex, which co-loads it); GATE A/B green, no fixture output moved. (`OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md`)
- Gate oxydex-dsp.js in checkJs (D.2) — the last DSP, completing the type gate over all 8 nodes. 9 realm siblings + 2 window state globals declared in a new node-scoped oxydex-globals.d.ts (cleared 62 of 68 errors with no source edit), plus 4 comment-only casts (FileReader-result buffer, and added-property writes/reads on desat events) run through biome format since oxydex-dsp.js is not formatter-overridden. Export-inert re-bundle of OxyDex (+ the two orchestrators that co-load it); GATE A/B green, no fixture output moved. Also fixed an invalid-JSON escape in the tsconfig //d2 note. (`OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md`)
- Gate ppgdex-dsp.js in checkJs (D.2): PPGDSP/PpgDex attaches + the PPGMorph sibling + the ES2020 BigInt global declared in a new node-scoped ppgdex-globals.d.ts, and a single comment-only source cast on the `timeDomain(...)||{}` result (whose `{}` fallback poisoned 11 HRV-field accesses). Export-inert re-bundle of PpgDex (+ the two orchestrators that co-load it); GATE A/B green, no fixture output moved. (`OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md`)
- Gate the first DSP (pulsedex-dsp.js) in checkJs via a new ambient dex-globals.d.ts for the co-loaded globals — zero source edit, zero re-bundle churn. (`OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md`)
- Widen the checkJs type gate (D.2 / DEV-TOOLCHAIN Part C) by signal-orchestrate.js — the shared UI-free node-orchestration module (0 tsc errors); zero source edit, zero bundle churn. Records that the free-DSP path is now exhausted (every remaining *-dsp.js needs a real source edit + re-bundle). (`OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md`)
- Widen the checkJs type gate (D.2 / DEV-TOOLCHAIN Part C) by three non-bundled modules — event-coupling.js, dex-coload.js, provenance-banner.js — each proven green with tsc; zero bundle churn. (`OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md`)

### Fixed
- CLAUDE.md still documented the RETIRED hand-update re-bundle dance as its body text, with a "this is superseded" note bolted on top — a reader who followed the steps would fight a tool that already writes the ledgers. Rewritten so `build.mjs` is the procedure. Also: `checkJs` widened to `kernel-constants.js`. (`OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md`)
- `release.mjs` pruned `changes/` but regenerated only one of the two lists it invalidates — every release shipped a red `docs-ledger` gate until someone noticed by hand. (`CPAP-REAL-CORPUS-FOLLOWUPS-II-2026-07-13-BRIEF.md`)
- trio-batch can anchor a night on the O2Ring's native `.dat`, not only the vendor CSV — six analyzable nights (2026-07-07 … 07-12) were invisible because the CSV export had stopped while the `.dat` kept landing. OxyDex has decoded this format all along on the browser drop path; the fix exposes `isO2RingBin` / `decodeO2RingBinToCSV` on the namespace (export-inert) so the headless corner reuses the SAME decoder instead of a second copy that would drift. Prefers the vendor CSV when both files exist, and ranks the oxy anchor by duration rather than bytes (a `.dat` is ~10× denser, so bytes stopped being comparable). Equivalence proved on 2026-07-06, the night that has both files: same-code CSV-path ≡ `.dat`-path, zero diffs. (`TRIO-BATCH-O2RING-DAT-2026-07-13-BRIEF.md`)

### Security
- Stop OxyDex logging the raw filename + raw CSV bytes to the console, and render PpgDex's error toast via textContent (kills an F3-class innerHTML sink). (`SECURITY-LEAK-HYGIENE-2026-07-13-BRIEF.md`)
- Add a meta-CSP (connect-src locked) to the unbundled analysis pages + index.html and cover them in the no-network gate + a CSP-presence test. (`SECURITY-NONBUNDLE-CSP-COVERAGE-2026-07-13-BRIEF.md`)

---

## [1.9.0] — 2026-07-13

### Added
- Add adversarial equivalence inputs — an MM/DD date order, a dropped-row night, a full-length overnight — so the bug class the deep audit had to find BY HAND is now caught by CI automatically. (`DEEP-AUDIT-2026-07-11-BRIEF.md`)
- Add `event-coupling.js` — the shuffled-null cross-node event-coupling primitive, the suite's missing "is it real or coincidence?" test. (`CPAP-REAL-CORPUS-2026-07-11-BRIEF.md`)

### Changed
- Retire the per-night CPAP/APAP label — a device *setting* is not a per-night fact. And retract §M1's coupling magnitude: the null model was broken. (`CPAP-REAL-CORPUS-FOLLOWUPS-2026-07-12-BRIEF.md`)
- Register `adapters/resmed-edf.js` (CPAP was the fleet's only adapter-less signal type), and retire the `mode` heuristic — it was measuring EPR, not auto-titration. (`CPAP-REAL-CORPUS-2026-07-11-BRIEF.md`)
- Close the deep audit's blind spot in the ledger too — and record that the brief's own prescription for closing it was wrong. (`DEEP-AUDIT-FOLLOWUPS-2026-07-12-BRIEF.md`)

### Fixed
- The CPAPDex demo had never worked for anyone but the maintainer — it fetched ten **gitignored** real recordings. (`CPAP-REAL-CORPUS-2026-07-11-BRIEF.md`)
- An absent reading is not a miss, and a ×0.0 on 16 events is not a proof — `event-coupling.js` gets a coverage model and a power floor, and §M1's last surviving claim is retracted. (`CPAP-REAL-CORPUS-FOLLOWUPS-2026-07-12-BRIEF.md`)
- Three fixtures claimed "reproducible under this code" while nothing reproduced them — and one absent recording was silently deleting nine equivalence legs. (`CPAP-REAL-CORPUS-FOLLOWUPS-2026-07-12-BRIEF.md`)
- An interval must conserve time, and an absent reading is not a score of zero — the deep audit's four fail-open layers (§B1–§B4). (`DEEP-AUDIT-FOLLOWUPS-2026-07-12-BRIEF.md`)
- README told people to buy the wrong device for PulseDex.
- Fix the evidence badge where the public site actually shows it — and put PpgDex on the front door.
- Pin the trio's planted σ across its three copies — a silent desync had the tool REPORTING one truth while SIMULATING another. (`TRIO-POWER-N15-FINDINGS-2026-07-12-BRIEF.md`)
- The Verity gate now says WHOSE fault it is — it used to blame the strap for our own detector bug, and that cost 41% of the corpus. (`PPGDEX-OPTICAL-DETECTOR-AND-SIGMA-REDERIVE-2026-07-11-BRIEF.md`)

---

## [1.8.0] — 2026-07-12

### Added
- Put ECGDex's respiration on the ganglior bus — it derived respiratory rate two independent ways and exported neither. (`TCH-REFERENCE-VALIDATION-2026-07-12-BRIEF.md`)
- Run the efficiency-audit charter — and retract `PROFILED-HOTSPOTS §3`, which was measured in a lying realm.
- Record CPU-profiled ground truth for the CI gate and the DSP hot paths — and the microbenchmark that lied by 18×. (`PROFILED-HOTSPOTS-CI-AND-DSP-2026-07-12-BRIEF.md`)
- Validate the three-cornered-hat σ estimator against a TRUE reference for the first time — it is blind to bias, and its independence assumption does not hold. (`TCH-REFERENCE-VALIDATION-2026-07-12-BRIEF.md`)
- Gate the worker realms — and pin the ECGDex >5 MB path's private clock, which nothing was checking. (`WORKER-REALM-GATES-2026-07-12-BRIEF.md`)

### Changed
- Shard the CI `test` gate 4 ways — **4m05s → 1m20s** — and prove the shards still add up to the full gate. (`CI-SHARDING-2026-07-12-BRIEF.md`)
- Stop the gate shrinking in silence, parallelize the local suite, and make the two ledger files union-mergeable. (`GATE-INTEGRITY-AND-DEVLOOP-2026-07-12-BRIEF.md`)

### Fixed
- Stop presenting a population default as your own data, pool an index instead of averaging rates, and badge the numbers a user actually reads first — the deep audit's final five findings (§17–§21). (`DEEP-AUDIT-2026-07-11-BRIEF.md`)
- Fix the PpgDex perfusion-index trend, which was silently `null` in most windows — and stop parsing 190k timestamps that were never read. (`PPGDEX-PI-AND-PARSE-2026-07-12-BRIEF.md`)
- Fix `Uncaught ReferenceError: cadenceSamples is not defined` — the PPG worker pool has been dead, and no gate could see it. (`PPGDEX-WORKER-CLOSURE-2026-07-12-BRIEF.md`)
- Record that a three-cornered hat cannot be validated using one of its own corners as the reference — the test is algebraically vacuous — and that the one thing it CAN measure, bias, shows OxyDex under-reading by 0.36 bpm. (`R5-HR-TRIPLET-REFERENCE-2026-07-12-BRIEF.md`)
- Report the frequency spectrum on ONE time scale and stop hanging the band split on an arbitrary bin count — the Task-Force identity was broken by 11% and LF/HF swung 44% on a constant nobody was meant to notice. (`DEEP-AUDIT-2026-07-11-BRIEF.md`)

---

## [1.7.0] — 2026-07-12

### Added
- Give CPAPDex a binary multi-file EDF equivalence leg — and, with it, the suite's first `compute() ≡ committed export` gate that actually runs in CI. (`CPAP-REAL-CORPUS-2026-07-11-BRIEF.md`)
- Add `sensor-trio-gpu.js` — a WebGPU fast lane for the sensor-trio Monte-Carlo power sweep, with the existing Web-Worker CPU pool as the automatic fallback.
- Make the `compute() ≡ committed export` equivalence gate actually run in CI — it never has. Every node now has a committed, synthetic, vendor-format input. (`CPAP-REAL-CORPUS-2026-07-11-BRIEF.md`)

### Fixed
- Lock a file's DMY/MDY date order once, up front, instead of deciding it per row — an MM/DD-configured O2Ring night no longer flips order mid-file, run its clock backward, and report a negative duration with ODI-4 = 0. (`DEEP-AUDIT-2026-07-11-BRIEF.md`)
- Stop counting long-gap interpolation as measured glucose, and detect the vendor clip floor the real Abbott Lingo export actually rails at — TIR read 11 % where the truth was 0 %, and 37 clip artifacts shipped as real nocturnal hypoglycemia. (`DEEP-AUDIT-2026-07-11-BRIEF.md`)
- Return NaN when a frequency band is absent instead of fabricating one from an epsilon denominator, and unit-guard MxDMn/MeanRR — HF n.u. surfaced as 125,000,000 % and the MxDMn ratio read 1000× low. (`DEEP-AUDIT-2026-07-11-BRIEF.md`)
- Stop the Integrator fabricating agreement it never measured and silently dropping nodes whose data it simply could not read — a glucose⟷autonomic coupling with no glucose in it, an HRV consensus that excluded the HRV node, and a kernel-drift audit blind to 3 of 7 nodes. (`DEEP-AUDIT-2026-07-11-BRIEF.md`)
- Replace odi-bias's O(n²) leave-one-out refit with the O(n) PRESS closed form — same numbers, and the 2,500-night `SYNTH_CAP` is gone.
- Place desat events on their own row's wall clock, analyse the whole night instead of its first hour, and refuse to report a physiologically impossible REM estimate as a healthy finding. (`DEEP-AUDIT-2026-07-11-BRIEF.md`)
- Set aside Polar Sensor Logger motion streams instead of analyzing them as heartbeats — a real H10 `*_ACC.txt` was routed to the RR adapter and its gravity axis read as RR intervals. (`DEEP-AUDIT-2026-07-11-BRIEF.md`)
- Retire the dead 1.7 / 2.2 / 6.2 σ caption — the tool's prose contradicted the code beneath it, which has planted the raw-ECG 10-night hat (O2Ring 2.72 / H10 1.86 / Verity 1.94) all along. (`PPGDEX-OPTICAL-DETECTOR-AND-SIGMA-REDERIVE-2026-07-11-BRIEF.md`)
- Record that the three-cornered hat has no robustness to artifact — 3 bad epochs of 86 inflated a corner's σ from 2.5 to 9.6 bpm — and specify the validated cross-corner consensus gate that fixes it. (`TRIO-ARTIFACT-GATE-AND-N15-POWER-2026-07-12-BRIEF.md`)

---

## [1.6.0] — 2026-07-12

### Added
- Put CPAPDex's ventilation, flow-limitation and snore metrics on the ganglior bus — the DSP had been computing them per session and then dropping them, so no CPAP ventilation variable had ever reached the Integrator. (`CPAP-REAL-CORPUS-2026-07-11-BRIEF.md`)

### Fixed
- Size the beat-detector refractory from a windowed-autocorrelation cadence — fixes the optical HR reading exactly 2× true when a prominent diastolic wave is counted as a second beat. (`PPGDEX-OPTICAL-DETECTOR-AND-SIGMA-REDERIVE-2026-07-11-BRIEF.md`)

---

## [1.5.0] — 2026-07-12

### Changed
- Run the `biome` gate on push to `main` as well as on PRs — a whole-tree Biome lint floor on push (mirroring `tests`/`types`/`no-network`), restoring the on-push lint coverage the retired eslint shim provided, now under the `biome` check name. PRs keep the changed-files `biome ci --changed` format+lint.
- Delete the `lint.yml` compatibility shim now that the `main` Ruleset no longer requires an `eslint` status check — Biome (`format.yml`) is the sole formatter+linter, no ESLint anywhere. (`BIOME-FORMATTER-2026-07-11-BRIEF.md`)

### Fixed
- Arbitrate the PPI spine by Malik correction rate — foot-to-foot vs the 3-LED-voted peak spine — fixing optical HR that read 2–3× true when `pickChannel` selects a harmonic-counting LED as the reference.

---

## [1.4.0] — 2026-07-11

### Security
- Drop `'unsafe-inline'` from every bundle's CSP `script-src` in favour of per-block `sha256` hashes computed by the owned bundler, so an injected `<script>` no longer executes (CSP is now an injection backstop, not just the `connect-src 'none'` egress control); all ~167 inline `on*=` handlers are converted to a shared event-delegation dispatcher (`dex-actions.js`, `data-act`) — `style-src` deliberately keeps `'unsafe-inline'` (non-goal). (`SECURITY-CSP-STRICT-SCRIPT-SRC-2026-07-11-BRIEF.md`)

---

## [1.3.0] — 2026-07-11

### Added
- Port the ESLint control-flow/dead-code floor into Biome (`biome.json` `linter.rules`) so `format.yml`'s `biome ci --changed` now enforces format + lint on changed files (0 errors on the current tree, parity-verified); ESLint stays running in parallel this cycle until it's retired (Phase 3 step 2). (`BIOME-FORMATTER-2026-07-11-BRIEF.md`)

### Changed
- Retire ESLint (`lint.yml` + `.eslintrc.json` + the `npx eslint` script) now that Biome carries the same control-flow/dead-code floor with proven parity — `npm run lint` and `format.yml` are the sole lint gate; one pinned tool does format + lint (BIOME-FORMATTER Phase 3 step 2). (`BIOME-FORMATTER-2026-07-11-BRIEF.md`)

### Security
- Add a browser-enforced Content-Security-Policy to every bundle (connect-src 'none'/'self' — F7) and suite-wide storage hygiene on top of v1.2.0's Phase A: drop the raw-recording localStorage cache (F4), a shared "erase all data on this device" control clearing every key + the Integrator IndexedDB (F5), and migrate() now deletes the legacy profile keys it folds (F6). (`SECURITY-REMEDIATION-2026-07-11-BRIEF.md`)
- Extend the erase-all control (dex-forget.js): also wipe the standalone analysis pages' checkpoint keys + IndexedDB (§2), and mount the control in CPAPDex + the Integrator, which own longitudinal data but don't render the shared profile panel (§3). Strict nonce/hash script-src (§1) assessed and deferred — infeasible without a fleet-wide inline-event-handler refactor. (`SECURITY-REMEDIATION-FOLLOWUPS-2026-07-11-BRIEF.md`)

---

## [1.2.0] — 2026-07-11

### Added
- Add Biome as a check-only, changed-files-only code formatter (`biome.json` tuned to the house style, pinned `@biomejs/biome` devDependency + lockfile, `format.yml` CI sibling) — no shipped file reformatted, provenance untouched. (`BIOME-FORMATTER-2026-07-11-BRIEF.md`)

### Security
- Escape untrusted filenames/errors at the OxyDex + PulseDex innerHTML sinks (F1/F2/F3) via one shared dex-escape.js — a crafted `<img onerror>` capture name renders as inert text; display-only, EXPORT-INERT re-bundle (also folds on-touch Biome formatting of the touched files, BIOME-FORMATTER Phase 2). (`SECURITY-REMEDIATION-2026-07-11-BRIEF.md`)

---

## [1.1.1] — 2026-07-11

### Added
- Add the ML-TCH / Groslambert-covariance estimator bake-off harness (tools/tch-estimator-bakeoff.mjs); result is a recorded negative — no HR-only candidate beats the min-ρ clamp at N=3, so integrator-tch.js is left unchanged. (`INTEGRATOR-TCH-ML-ESTIMATOR-2026-07-11-BRIEF.md`)

---

## [1.1.0] — 2026-07-11

### Added
- Add the DSP reach-in allow-list gate (DEV-TOOLCHAIN Part A · A4, folding in SIGNAL-ADAPTER-FOLLOWUPS-IV §1) — a source-text house-lint in `tests/dex-tests.js` that scrubs comments/strings/regex with a real char-scanner, then asserts each `*-dsp.js` calls only {self · kernel · own `*-util` · builtins · documented reach-ins}; oxydex/hrvdex render-path reach-ins are allow-listed as a named drift-ledger for the next on-touch re-bundle. Test-layer only, no re-bundle, provenance untouched. (`DEV-TOOLCHAIN-2026-06-30-BRIEF.md`)
- Add the root `package.json` dev-tooling spine — a private, unpublished manifest (no runtime deps, ships nothing) that unifies `tools/build.mjs`, the pinned `tsc`/ESLint tools, and the gate runners under one `npm run` surface (`check`/`test`/`typecheck`/`lint`/`build*`/`verify:manifest`/`gen:lists`/`release`); the four CI workflows now route through those scripts so each command has a single source, and browser-gates no longer `npm init -y` over the committed manifest. (`DEV-TOOLCHAIN-2026-06-30-BRIEF.md`)
- Teach `tools/release.mjs` to maintain the CHANGELOG's reference-style compare links (F6): on each release it advances `[Unreleased]` to compare from the new tag and inserts a `[x.y.z]: …/compare/v{prev}...v{new}` line, leaving the oldest `releases/tag` link intact — repo base derived from the existing `[Unreleased]` link (no hard-coded URL), idempotent on re-run. (`CONTROLLED-RELEASES-FOLLOWUPS-2026-07-05-BRIEF.md`)
- Project the canonical suite version into the discovery surfaces and make the release-ledger check-6 stamp-parity gate non-vacuous (F2/F3/F4): stamp `softwareVersion` into index.html + docs/index.html JSON-LD (and a visible footer `v`), `docs/about.json` (+ build-docs `buildAbout`), and a `**Suite version:**` marker in README; add a build-docs Phase 3 that projects `suite.manifest.json` version into those surfaces (idempotent, updates markers in place); teach `release.mjs` to stamp `CITATION.cff`; and feed each surface's raw text into `env.releaseLedger.surfaceTexts` from both runners so check-6 extracts (single-sourced) and reds on a version mismatch OR a removed marker. (`CONTROLLED-RELEASES-FOLLOWUPS-2026-07-05-BRIEF.md`)
- ECG Splitter gains a folder-batch mode — drop a capture folder, group files into recording nights, bulk-split oversized ECG/PPG waveforms, and run an off-thread signal check (production Pan–Tompkins / 3-LED detectors in a Web Worker) reusing the trio-experiment folder-ingest + worker-DSP patterns. (`TRIO-METHODS-REUSE-2026-07-06-BRIEF.md`)
- Add a decorrelation quality gate to the Integrator three-cornered hat — drop a node that decorrelates from both peers before the solve, so a failed extraction can't contaminate every per-sensor σ. (`TRIO-METHODS-REUSE-2026-07-06-BRIEF.md`)
- Add a reproducible multi-night three-cornered-hat A/B harness (tools/tch-multinight.mjs) with a known-answer synthetic corpus, plus literature- and sensor-anchored σ validation (docs §7–§9). (`INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III-2026-07-06-BRIEF.md`)

### Changed
- Route OxyDex and HRVDex readiness sub-score value tiles through the evidence-badge path (badge-by-construction, OWN-THE-BUILD Part C) — the badge now leads the value, and both render files join the enforced `badge-enforced` set so a number can't reach the DOM ungraded. (`OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md`)
- Enforce badge-by-construction on `integrator-render.js` (OWN-THE-BUILD Part C) — it is already compliant (its `kpi()` tile leads with `evBadge()`), so it joins `BADGE_ENFORCED` test-only with no re-bundle, and is wired into `env.sources` in both runners; the badge gate now reds if any fusion-layer value tile is emitted unbadged. Remaining Part C render/app/profile files await their next on-touch re-bundle. (`OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md`)
- Flip release-ledger check-7 to a HARD gate (F8, `HARD7=true`) — un-recorded code movement now BLOCKS instead of shipping informational. Adoption is real: the 1.0.0 snapshot was reconfirmed consistent against BUILD-MANIFEST (5 unmoved bundles byte-match; the 3 moved — OxyDex/HRVDex/Integrator — are exactly the changeset-covered set), so the gate is green with zero false positives. (`CONTROLLED-RELEASES-FOLLOWUPS-2026-07-05-BRIEF.md`)

### Fixed
- Align cross-node three-cornered-hat epochs on absolute wall-clock instead of node-relative tMin (fixes σ² inflation and culprit mis-ranking on staggered-start co-recordings; same-start nights stay byte-identical); surface the HR-hat per-sensor error card + reconciled HR, and flag quiet-sensor order uncertainty. (`INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-II-2026-07-04-BRIEF.md`)
- Correct stale crossnight `*_DEFS` metadata to the registry truth — OxyDex mean-SpO₂/mean-HR and CPAPDex residual-AHI/central-index/usage-hours graded `measured` (not `validated`), CPAPDex usage-hours label "Usage Hours" and PpgDex Perfusion-Idx/Motion-rejected labels — regenerating the CPAPDex multi-night golden; every shared-id field is now hard-gated by the registry↔_DEFS parity check (REGISTRY-PROJECTION Phase 2). (`REGISTRY-PROJECTION-2026-07-04-BRIEF.md`)
- Badge-by-construction Part C — every remaining bare metric-value tile now leads with an evidence badge (ecgdex/ppgdex/glucodex-app, cpapdex-render, pulsedex-overview, hrvdex-app, ecgdex/glucodex/ppgdex-profile); all nine join BADGE_ENFORCED and the six affected bundles were re-bundled (export-inert, fixtures re-stamped). (`OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md`)
- Re-texture the synthetic RR generator (synth-gen 2.1 / cohort-gen 1.9), rerun all six sim papers, and re-bundle the six apps that inline synth-gen.js. (`SYNTH-TEXTURE-PAPERS-RERUN-FOLLOWUPS-2026-07-07-BRIEF.md`)

---

## [1.0.0] — 2026-07-05 · Baseline

First **controlled release.** Declares the current all-gates-green tree as the stable 1.0.0 baseline
and establishes the release-governance layer over it.

### Added
- **Suite versioning** — one canonical SemVer in `suite.manifest.json` (`version`), the maintenance
  number every release, changelog entry, and ledger record points at (`CONTROLLED-RELEASES-2026-07-05`).
- **This `CHANGELOG.md`** (Keep a Changelog) + machine-readable **`RELEASE-MANIFEST.json`** history.
- **Changeset flow** — additive, collision-free `changes/*.md` drops folded by `tools/release.mjs`
  into one automated version+stamp step, so parallel coders never hand-pick a number.
- **`release-ledger` gate** (`tests/dex-tests.js`, both runners, headless floor) — valid SemVer,
  no fork (newest ledger record ≡ canonical), unique + strictly increasing versions, history↔changelog
  parity, changeset well-formedness, and "unreleased code needs an unreleased changeset."
- **62304/13485-aligned compliance doc set** (`docs/COMPLIANCE/`) — software lifecycle plan, safety
  classification (Class A / non-device), configuration-management plan, SOUP list (runtime-empty by
  design), release SOP, and an ISO-13485 document-control crosswalk. *Alignment, not conformance.*

### Notes
- Posture is **aligned good practice, not certification**; every compliance doc carries the
  `suite.manifest.json` intended-use disclaimer. Tepna remains "Not a medical device."
- No re-bundle: the version is **not** yet stamped into the offline bundles (deferred — it will ride
  the next behavioral re-bundle, coordinated with OWN-THE-BUILD Part C). `manifestHash` provenance
  and all behavioral gates are unchanged by this release.

---

## [0.9.0] — 2026-07-04 · Owned build, gated docs & discoverability

### Changed
- **Fleet cutover to owned plain-inline bundles** — all 8 apps rebuilt as repo-owned deterministic
  bundles via `tools/build.mjs`; the legacy inliner branch retired (`OWN-THE-BUILD-2026-06-30`,
  Part A cutover 2026-07-03).
- **Registries stay the grade truth; mirrors become gated projections** — `registry-defs-parity`
  gate added so the crossnight `*_DEFS` mirror can't drift (`REGISTRY-PROJECTION-2026-07-04`,
  superseding the `REGISTRY-INVERSION` flip).
- **Clock parser single-sourced** in `clock.js` (`DexClock`), inlined into every bundle; delegating
  DSPs alias it (A5, 2026-07-03).

### Added
- **`docs-ledger` gate** — the brief lifecycle (immutable dated filenames, status headers,
  `Supersedes` symmetry, dashboard coverage, link integrity) machine-checked (`DOCS-LEDGER-GATE-2026-07-03`).
- **Repo discoverability** — front-door link blocks, `sitemap.xml`/`robots.txt`, JSON-LD/`about.json`,
  `llms.txt`, one canonical roster in `suite.manifest.json` (`REPO-DISCOVERABILITY-2026-07-03` + followups).
- **Licensing unification** — Apache-2.0 SPDX headers fleet-wide; **Tepna** product brand adopted
  (frozen `Ganglior` event-bus codename untouched).

---

## [0.8.0] — 2026-07-02 · Fusion fidelity & performance

### Added
- **Integrator three-cornered-hat** — cross-node variance separation for HR/HRV consensus
  (`INTEGRATOR-THREE-CORNERED-HAT-2026-07-02` + followups).

### Changed
- **PpgDex beat detection** rewritten from O(N·lag) autocorrelation to a linear detector; HRV fidelity
  pass (`PPGDEX-BEAT-DETECTION-PERF-AND-HRV-FIDELITY-2026-07-02`).
- Efficiency pass across DSP hot paths (`EFFICIENCY-AUDIT-FIXES-2026-07-01`).

---

## [0.7.0] — 2026-06-30 · Own the build & content-addressed provenance

### Added
- **Owned Node bundler** `tools/build.mjs` + `--check` drift guard; the build stops depending on the
  opaque inliner (`OWN-THE-BUILD-2026-06-30`).
- **Content-addressed provenance** — `manifestHash` becomes the sole executed-code identity; GATE A/B
  in `verify-provenance.html` go pure-static (`SIGNAL-ADAPTER-AND-FRONTIER` Phase 7,
  `PROVENANCE-NONDETERMINISM-2026-06-29`).

### Fixed
- Deep-audit fixes across DSP nullability and render layers (`DEEP-AUDIT-FIXES-2026-06-30`).

---

## [0.6.0] — 2026-06-29 · Provenance determinism & capture host

### Fixed
- **Provenance non-determinism** — `manifestHash` made a deterministic projection of the decompressed
  inlined code, stable across re-bundles of identical source (`PROVENANCE-NONDETERMINISM-2026-06-29`).

### Added
- **Capture-host vision** — the bedside Raspberry Pi that auto-captures, serves, and stores all
  signals overnight (`CAPTURE-HOST-2026-06-29`, vision).

---

## [0.5.0] — 2026-06-28 · Runtime coverage & live-runnability gates

### Added
- **Cross-module runtime coverage** — a render-coverage rig drives real app bundles in an iframe
  (`CROSS-MODULE-RUNTIME-COVERAGE-2026-06-28`).
- **Live-runnability + generic-emit gates** (`GATE-LIVE-RUNNABILITY-2026-06-28`, `GENERIC-EMIT-GATE`).
- **CPAPDex Phase-9** headless DSP + synthetic goldens (`CPAPDEX-PHASE9-FOLLOWUPS`).

---

## [0.4.0] — 2026-06-27 · Export identity & self-ingest

### Added
- **`ganglior.node-export` envelope** unified across nodes with a stamped export identity
  (`EXPORT-IDENTITY-2026-06-27`, `OXYDEX-NODE-EXPORT-ENVELOPE-2026-06-27`).
- **Self-ingest** — nodes re-read their own exports for cross-night accumulation (`SELF-INGEST-2026-06-27`).

### Changed
- Export hygiene: host-emit allowlist, volatile-field stripping (`EXPORT-HYGIENE-2026-06-27`,
  `HOST-EMIT-ALLOWLIST-2026-06-27`).

---

## [0.3.0] — 2026-06-25 · Headless DSP (Signal-Adapter Phase-9)

### Changed
- **Reading split from computing** across the fleet — each `*-dsp.js` exposes a DOM-free `compute()`
  so the DSP runs headless in Node CI, not just the browser (`SIGNAL-ADAPTER-PHASE9-REMAINING-NODES-2026-06-25`
  and the `SIGNAL-ADAPTER-FOLLOWUPS` series).

---

## [0.2.0] — 2026-06-24 · Evidence badges & signal-adapter architecture

### Added
- **5-level evidence ladder** (measured · validated · emerging · experimental · heuristic) with a
  single-source badge engine and the `cohesion-badges` gate (`BADGE-COVERAGE-AUDIT`,
  `BADGE-PLACEMENT-SWEEP-2026-06-24`).
- **Signal-adapter frontier** — vendor files routed to nodes through pluggable adapters
  (`SIGNAL-ADAPTER-AND-FRONTIER-2026-06-23`).
- **Synthetic corpus texture** — broadband-1/f RR generation for realistic test nights (`SYNTH-TEXTURE-2026-06-24`).

### Changed
- Metric vocabulary cleanup; unified desaturation-event + SDNN primitives (`DEX-EVENT-UNIFY-AND-CSV`,
  `DEX-METRIC-REMOVAL-AUDIT`).

---

## [0.1.0] — 2026-06-23 · Foundations

### Added
- **The shared spine** — `kernel-constants.js`, the **Ganglior** event bus, the Clock Contract, and
  the per-node analyzers: OxyDex, PulseDex, HRVDex, GlucoDex, ECGDex, PpgDex, CPAPDex, and the
  **Integrator** fusion layer (`KERNEL-BUILD`, per-node `*-BUILD` briefs, `INTEGRATOR-BUILD`).
- **The shared test suite** (`Dex-Test-Suite.html` + `tests/dex-tests.js`) and the build/provenance
  manifests.

[Unreleased]: https://github.com/Plantucha/Tepna/compare/v1.14.0...HEAD
[1.14.0]: https://github.com/Plantucha/Tepna/compare/v1.13.0...v1.14.0
[1.13.0]: https://github.com/Plantucha/Tepna/compare/v1.12.0...v1.13.0
[1.12.0]: https://github.com/Plantucha/Tepna/compare/v1.11.1...v1.12.0
[1.11.1]: https://github.com/Plantucha/Tepna/compare/v1.11.0...v1.11.1
[1.11.0]: https://github.com/Plantucha/Tepna/compare/v1.10.3...v1.11.0
[1.10.3]: https://github.com/Plantucha/Tepna/compare/v1.10.2...v1.10.3
[1.10.2]: https://github.com/Plantucha/Tepna/compare/v1.10.1...v1.10.2
[1.10.1]: https://github.com/Plantucha/Tepna/compare/v1.10.0...v1.10.1
[1.10.0]: https://github.com/Plantucha/Tepna/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/Plantucha/Tepna/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/Plantucha/Tepna/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/Plantucha/Tepna/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/Plantucha/Tepna/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/Plantucha/Tepna/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/Plantucha/Tepna/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/Plantucha/Tepna/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Plantucha/Tepna/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/Plantucha/Tepna/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Plantucha/Tepna/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Plantucha/Tepna/releases/tag/v1.0.0
