<!--
  DEEP-SCOUT-HOLLOW-GATES-2026-07-18-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-07-18 · **Created:** 2026-07-18

# Deep-scout hollow-gate wave — findings ledger (40 NEW hollow gates)

Executes `TEST-AUDIT-FINDINGS-FOLLOWUPS-2026-07-18-BRIEF.md` **§3** (the deep-scout second wave). The
first audit planted a fixed 99 mutations; this wave planted **fresh** mutations in the *under-covered*
clusters the 99 never probed, ran each against the **full suite WITH the real corpus**
(`DEX_UPLOADS=…/uploads` — the equiv/GATE-C legs boot), and recorded a gate as **hollow** only when it
stayed green under a real, behavior-changing defect (semantic no-ops rejected; every finding reverted,
tree left clean). Orchestrated as an 8-cluster `Workflow` of worktree-isolated scout agents.

**Result: 40 confirmed NEW hollow gates** (3 high, 30 medium, 7 low) across 5 clusters. Three clusters
(**render**, **self-ingest**, **gluco-cpap-oxy-deep**) returned nothing — their scout agents died on the
session rate-limit before reporting, so those are **NOT cleared, only un-scanned** (see §Re-scout).

The first-wave total was 40; the **re-scout of the 3 dead clusters (2026-07-18) added 14 more → 54 total**.

| cluster | found | status |
|---|---|---|
| crossnight-deep | 8 | **DONE** — PR #173 (both-direction verified) |
| kernel-registry | 8 | **DONE** — PR #175 |
| integrator-fusion | 8 | **DONE** — PR #180 |
| ecg-ppg-detect-deep | 9 | **2/9 DONE** — PR #177 (LF/HF edge + DFA box); 7 open |
| adapters | 7 | OPEN (needs off-suite adapter harness) |
| §SI self-ingest (re-scout) | 3 | **DONE** — PR #183 |
| §GV gluco-cpap-oxy-deep (re-scout) | 4 | **DONE** — PR #184 (Oxy/CPAP confirmed clean) |
| §RN render (re-scout) | 7 | **6/7 DONE — PR #187 (harness + 3 HIGH) + #191 (3 hoisted classifiers)**; 1 open (ecgdex canvas tick) |

**Tally: 39 of 54 closed** (crossnight 8 + kernel 8 + integrator 8 + ecg-ppg 2 + self-ingest 3 + gluco 4 +
render 6), all both-direction verified and merged. Remaining 15: 7 ecg-ppg call-site/narrow-band, 7
adapters, 1 render (ecgdex canvas minute-tick — pure-canvas, LOW, deferred). The render-execution harness
(PR #187) + the hoisted-classifier extractions (PR #191) closed 6 of 7 §RN. See
`DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS-2026-07-18-BRIEF.md`.

## §CN — crossnight-deep (8) — **DONE 2026-07-18, PR #173**

The `Cross §1 — per-node crossNightBlock` group pinned only `central.sd`/baseline (wave-1) and
labels/evidence. Every **other surfaced cross-night estimator** was hollow, and because each `*-cross.js`
carries its **own copy** of `median`/`quantile`/`ols`/`mannKendall`, a defect in any one node escaped.
Closed with **22 known-answer pins** across all 5 nodes (OxyDex `meanSpo2`, PulseDex/PpgDex/ECGDex
`rmssd`, CPAPDex `usageHours`+`residualAHI` on a non-degenerate falling series): `central.median`,
`central.iqr`, `min`, `max`, `trend.slopePerDay`, `trend.mannKendall.tau`/`.p`. Both-direction verified
(median even-n collapse, IQR interp break, Mann-Kendall S sign-flip each RED their node's pin). Full
corpus suite green **2886 · 2 skipped**.

| sev | file · invariant | mutation caught |
|--|--|--|
| high | `oxydex-cross.js` — `central.median` even-n = avg of two middles | `(b[n/2−1]+b[n/2])/2 → b[n/2−1]` |
| high | `ecgdex-cross.js` — `trend.slopePerDay` = OLS vs days (day = ms/86400000) | `p.t − pts[0].t → p.t` |
| high | `cpapdex-cross.js` — personal baseline = mean/sd of all-but-latest; `zLatest` off it | `vals.slice(0,n−1) → vals.slice(1,n)` |
| medium | `pulsedex-cross.js` — Mann-Kendall `Var(S)=n(n−1)(2n+5)/18` (feeds `.p`) | `2n+5 → 2n+3` |
| medium | `ppgdex-cross.js` — `central.iqr = Q75 − Q25` | `quantile(.75) → quantile(.70)` |
| medium | `pulsedex-cross.js` — `central.min = min(vals)` | `Math.min → Math.max` |
| medium | `ecgdex-cross.js` — `change.ci95` = 2.5/97.5 bootstrap quantiles | `0.025 → 0.05` |
| medium | `ppgdex-cross.js` — `central.cv` = percent CV = 100·sd/mean | `(100*s)/m → s/m` |

## §AD — adapters (7) — OPEN

The raw→SignalFrame→compute boundary. **Off-suite harness owed** (some of these need a small
adapter-level driver, harder than the sync test lane).

| sev | file · invariant | mutation that stays green |
|--|--|--|
| medium | `nsrr-adapter.js` `to1Hz` valid window INCLUSIVE at top (SpO2 100 / HR 240 legit) | `v <= validHi → v < validHi` |
| medium | `nsrr-adapter.js` `to1Hz` valid window INCLUSIVE at bottom (SpO2 40 / HR 20 legit) | `v >= validLo → v > validLo` |
| medium | `nsrr-adapter.js` `analyzeRecord` est-AHI surrogate = ODI-4 × **1.1** | `×1.1 → ×1.3` |
| low | `nsrr-adapter.js` all-invalid HR → seeded fallback baseline = `validLo` | `firstValid = validLo → = v` |
| low | `nsrr-adapter.js` 1 Hz length FLOORs partial trailing second | `Math.floor(n/fs) → Math.ceil` |
| low | `adapters/resmed-edf.js` SD-card session cluster window INCLUSIVE at ±60 s | `<= 60 → < 60` |
| low | `adapters/resmed-edf.js` BRP Flow default fs = 25 Hz when channel carries none | `|| 25 → || 20` |

## §IF — integrator-fusion (8) — **DONE 2026-07-18, PR #180**

Fusion internals beyond the first wave. Two are **high** (verdict-flipping). All 8 closed with
both-direction-verified known-answers reached through already-wired `env` entry points
(`fuseHRVConsensus`/`runFusion`/`normalizeFile`/`labelPositionalApnea`/`fusePeriodicBreathing`/
`IntegratorTCH`) — no `run-tests.mjs` change. #4/#5 use two distinct scenarios so each is caught
independently. Full corpus suite green (2883). Each mutation re-applied + confirmed RED.

| sev | file · invariant | mutation that stays green |
|--|--|--|
| high | `integrator-dsp.js` HRV divergence >30% flips qc `agreement→divergent` | `worst > 30 → worst > 300` |
| high | `integrator-dsp.js` staging REM-frac gap >0.2 must surface `disagreement:true` (branch UNTESTED) | `remGapThresh 0.2 → 0.9` |
| medium | `integrator-dsp.js` `rmssd.weightedMean` = inverse-variance (w∝1/σ² from TCH hat) | `_acc += w*o.v → _acc += o.v` (unweighted) |
| medium | `integrator-dsp.js` positional apnea needs supine frac ≥ 0.7 | `>= 0.7 → >= 0.8` |
| medium | `integrator-dsp.js` positional apnea needs supine ≥ 2× non-supine | `>= 2 → >= 3` |
| medium | `integrator-tch.js` TCH inverse-var weight floor `floorFrac = 0.08` | `0.08 → 0.40` |
| medium | `integrator-dsp.js` PB corroboration tier-weight `emerging = 0.8` | `0.8 → 0.4` |
| low | `integrator-dsp.js` external-ρ = mean of POSITIVE pairwise motion corr | `Math.max(0,r) → r` |

## §KR — kernel-registry (8) — **DONE 2026-07-18, PR #175**

`dex-profile.js` classification thresholds + NHANES/ACSM interpolation — all surface in the PulseDex
**Derived** panel. All 8 closed with boundary-bracketing known-answers in the `Dex-Profile engine`
group (which already co-loads the module). Both-direction verified. Full corpus suite green (2872).

| sev | file · invariant | mutation that stays green |
|--|--|--|
| medium | `dex-profile.js` `bmiLabel` WHO cut = 25 (`bmiCat`) | `b < 25 → b < 27` |
| medium | `dex-profile.js` `vo2Category` ACSM band `r >= 0.8 Fair` (`vo2Cat`) | `0.8 → 0.7` |
| medium | `dex-profile.js` `vo2Percentile` slope = 50 + (v/n−1)·**120** (`vo2Pct`) | `120 → 100` |
| medium | `dex-profile.js` `whtrRisk` Ashwell cut = 0.5 (`whtrRisk`) | `0.5 → 0.4` |
| medium | `dex-profile.js` `_interp2` NHANES **weight** interp = `tbl[i][1] + f·Δ` | `+ f·Δ → − f·Δ` |
| medium | `dex-profile.js` `_interp2` NHANES **height** interp = `tbl[i][2] + f·Δ` | `+ f·Δ → − f·Δ` |
| low | `dex-profile.js` `_interp1` VO2-norm interp = `round(tbl[i][1] + f·Δ)` | `+ f·Δ → − f·Δ` |
| low | `dex-profile.js` `VO2_NORM` male age-45 anchor = 39 mL/kg/min | `[45,39] → [45,44]` |

## §EP — ecg-ppg-detect-deep (9) — **2/9 DONE 2026-07-18, PR #177; 7 OPEN**

Spectral/nonlinear detector internals. Every spectral gate in the suite checked `lombScargle`/`dfaAlpha1`
by **source regex** (structural) — blind to a numeric edge/range change. **CLOSED (PR #177)** with
value-based known-answers reached through the exported `ECGDSP.lombScargle`/`dfaAlpha1`: the **LF/HF band
edge 0.15 Hz** (a 0.13 Hz RR oscillation lands in LF; a 0.12 shift moves it to HF — frac_lf 0.988→0.024)
and the **DFA box range 4..16** (fixed seeded series → α1 0.649; an n≤11 truncation → 0.751). The other 7
are call-site tolerances or narrow-band cases that a pure-function pin can't reach — they need the
`analyze` pipeline or a fuller (non-"light") equiv fixture: SampEn `0.2·SD` and PRSA `/4` are applied
inside `analyze` (not args to the exported fn), the EDR autocorr window likewise; the PPG VLF/LF 0.04 edge
is leakage-limited (VLF band 0.003–0.04 is too narrow for a clean single-tone RR probe). **OPEN:**

| sev | file:line · invariant | mutation that stays green |
|--|--|--|
| ~~high~~ **DONE** | `ecgdex-dsp.js:1022` Lomb-Scargle LF/HF band edge 0.15 Hz (Task Force 1996) | `f < 0.15 → f < 0.12` |
| high | `ecgdex-dsp.js:1127` PRSA DC/AC normalization `(X2+X3−X1−X0)/4` (Bauer 2006) | `/4 → /2` |
| ~~medium~~ **DONE** | `ecgdex-dsp.js:1053` DFA α1 box sizes n=4..16 beats | `<= 16 → <= 11` |
| medium | `ecgdex-dsp.js:1990` SampEn tol r = 0.2·SD (Richman-Moorman) | `0.2 → 0.15` |
| medium | `ppgdex-dsp.js:1019` DFA α1 box sizes s=4..16 | `<= 16 → <= 11` |
| medium | `ppgdex-dsp.js:948` VLF/LF band edge 0.04 Hz | `0.04 → 0.05` |
| medium | `ecgdex-dsp.js:1416` EDR resp autocorr period search [2.5,10] s | window shrunk |
| medium | `ecgdex-dsp.js:776` per-beat composite SQI weights (0.30·kSQI + …) | `0.30 → 0.50` |
| low | `ppgdex-dsp.js:1068` SampEn default tol r = 0.2·SD | `0.2 → 0.15` |

## §Re-scout — the three clusters whose agents died — **RAN 2026-07-18**

**render**, **self-ingest**, **gluco-cpap-oxy-deep** reported **0** in the first wave only because their
scout agents were killed by the rate-limit. Re-run 2026-07-18 (3 parallel worktree-isolated scouts,
corpus baseline 2937): **14 NEW hollow gates**, three distinct classes.

### §SI — self-ingest (3 → **DONE, PR #183**)
Each node's `loadOwnExport` returns **top-level convenience accessors** (`res.hrv`/`summary`/`recording`/
`generated`) that the DOM review renderers consume, but the node-lane self-ingest gates asserted only
`res.elements[0].*` — so dropping a top-level accessor (`hrv: json.hrv||null`→`null`) blanks the review
panel yet stays green (only the browser render-coverage probe drives the renderers). ECGDex+PpgDex already
pinned them; closed the other 5 node gates (PulseDex HIGH `res.hrv`; GlucoDex MED `res.recording`; Oxy/
CPAP/HRV `res.recording`/`res.generated`). Both-direction verified; suite 2944.

### §GV — GlucoDex unexported variability indices (4 → **DONE, PR #184**)
`variability()` computes **jIndex · CONGA-1/2/4 · GRADE · MAG** — surfaced as KPI tiles/table rows — but
`glucoBuildNodeExport`'s `glucose{}` block **omits the whole family**, so the Phase-9 equiv gate (the only
value-pinning gate) is blind and no unit test asserted them. Four slips shipped green (jIndex `mean+SD→
mean−SD`, CONGA lag `·60→·30`, GRADE zone `140→180`, MAG `abs()`-removal). Closed with 6 direct
`analyze()` known-answers on a deterministic sinusoid. **OxyDex + CPAPDex re-scouted and confirmed
well-covered** (both byte-pin their full metric trees via equiv/golden — control probes caught).

### §RN — render layer NOT executed in the node lane (7 → **OPEN, STRUCTURAL — see follow-up**)
The heavy one. `run-tests.mjs` loads every `*-render.js` **only as raw text into `env.sources`** — the
render modules are **never executed** in the node/corpus lane. So NO value assertion can pin any surfaced
render output; the only render defects the node gate catches are those that alter a *literal a source-text
grep happens to check* (mmol edge labels, the `_GLU_MMOL` constant, badge-CSS parity, null-safety regexes).
Seven planted defects all shipped green, including three severe surfaced-value breaks:

| sev | file · invariant | mutation that stayed green |
|--|--|--|
| high | `glucodex-render.js` `GluDisp.val` mg/dL→mmol = ÷18.018 | `÷ → ×` (≈325× wrong glucose in mmol mode) |
| high | `oxydex-render.js` mean-SpO₂ KPI color ok≥95/warn≥92 | `≥95/≥92 → ≥85/≥82` (hypoxic 88% painted green) |
| high | `cpapdex-render.js` residual-AHI band <5/<15/<30 | `<5 → <50` ("well controlled" on AHI 40) |
| medium | `oxydex-render.js` SpO₂ Night CV = (SD/mean)·**100** | `·100 → ·10` (hero number 10× low) |
| medium | `hrvdex-render.js` rMSSD KPI color >35/>20 | `>35/>20 → >65/>50` (healthy 45 ms painted bad) |
| medium | `pulsedex-render.js` DUPLICATED Tanaka HRmax `208−0.7·age` | `0.7 → 0.9` (its own copy drifts from ECGProfile) |
| low | `ecgdex-render.js` waveform minute-tick `t/60` | `t/60 → t/30` (axis labels 2×) |

This is **not** closeable in the node lane — it needs either (a) the **browser render-coverage lane**
(`Dex-Test-Suite.html?full`) wired into the merge/CI gate so it actually asserts rendered values, or (b) a
**node-lane render-execution harness** that instantiates the render builders against a stub DOM and pins
their output. That is test-infrastructure work, not a per-finding assertion → spun into
`DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS-2026-07-18-BRIEF.md`.

## Done when

Each OPEN cluster is either gated (a both-direction-verified assertion per finding, PASS clean + RED
under the exact mutation) or explicitly dispositioned in a further follow-up; the three dead clusters have
been re-scouted; and this brief flips to `DONE`. Land each cluster as its own gated PR (crossnight-deep =
PR #173 already). Prioritize the two **high** integrator verdict-flips (§IF) and the ecg-ppg spectral
band edges (§EP) — those move surfaced clinical numbers.
