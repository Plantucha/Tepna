<!--
  PARITY-AUDIT.md — Tepna · codegen registry-inversion Phase 0
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->

**Status:** REFERENCE (Phase 0 audit — no code committed) · **Created:** 2026-07-04 · **For:** `briefs/REGISTRY-INVERSION-2026-07-03-BRIEF.md` Phase 0

# Registry-inversion parity audit (Phase 0)

> **What this is.** The Phase-0 deliverable of `REGISTRY-INVERSION-2026-07-03-BRIEF.md`: for each shipped
> node, project a registry from its `codegen/manifests/<node>.manifest.json` and diff it **semantically**
> against the committed hand `<node>-registry.js`. No code was changed. This table IS the risk register the
> brief says gates Phases 1–3.
>
> **Headline verdict: DO NOT FLIP ANY NODE ON THE CURRENT MANIFESTS.** The manifests are not latent single
> sources of the registries — they are independently-authored, differently-keyed, and carry **zero** of the
> grade metadata (`evidence` / `goodDirection` / `cite`) the registry projects. `codegen/README.md` itself
> documents this: only `cpapdex.manifest.json` is a "canonical" codegen target; "the rest are reference
> examples of the schema." Phase 1 is therefore not "port a few caveats" — it is authoring the entire
> grade layer for **~319 registry metrics** and reconciling id namespaces + membership, per node, with every
> metric a chance to silently change a user-facing grade (the brief's one real data-fidelity hazard).

## Method (re-runnable)

Load `codegen/dex-registry-gen.js` in a sandbox → `generateRegistry(manifest)`; load each hand
`<node>-registry.js` in isolation and read its `REGISTRY`/`ALIAS` off the resolver; diff per-metric-id.
Because **every** manifest metric is missing `evidence`, the projector was run with a lenient
`evidence:experimental` fill purely to measure structural (id/label/unit/goodDirection/depth) parity —
grade/cite parity is simply **N/A today** (nothing to compare against on the manifest side).

## Fleet summary

| Node | Manifest metrics | Registry entries | Shared ids | Only-registry | Only-manifest | Missing evidence/goodDir/cite | Registry labels still resolving |
|---|---|---|---|---|---|---|---|
| **OxyDex** | 87 | 50 | 20 | 30 | 67 | 87 / 87 / 87 (=100%) | 18/99 |
| **PulseDex** | 10 | 68 | 4 | 64 | 6 | 10 / 10 / 10 (=100%) | 5/90 |
| **HRVDex** | — (NO MANIFEST) | 34 | — | — | — | — | — |
| **ECGDex** | 35 | 78 | 6 | 72 | 29 | 35 / 35 / 35 (=100%) | 15/112 |
| **PpgDex** | 14 | 44 | 0 | 44 | 14 | 14 / 14 / 14 (=100%) | 4/84 |
| **GlucoDex** | 22 | 42 | 7 | 35 | 15 | 22 / 22 / 22 (=100%) | 9/71 |
| **CPAPDex** | 14 | 37 | 14 | 23 | 0 | 14 / 14 / 14 (=100%) | 20/101 |

*"Registry labels still resolving" = of every label the hand registry currently badges (each entry label +
every alias spelling), how many still resolve to **some** metric under the manifest-projected resolver. The
rest would lose their badge or fall to the experimental fallback on a flip — a direct user-facing regression.*

## Structural blockers (fleet-wide, not per-node polish)

1. **Manifests carry no grade layer.** `evidence`, `goodDirection`, and `cite` are absent on **100% of
   metrics in every manifest** — so `generateRegistry()` throws on metric #1 today. Generation is impossible
   until Phase 1 authors all three fields for every metric.
2. **Id namespaces + membership diverge.** The registry and manifest were keyed independently (OxyDex
   `meanSpo2` vs manifest `spo2Mean`, `vo2est` vs `vo2max`, `karvZone` vs `zones`; PpgDex shares **0** ids
   with its manifest). Membership diverges both ways: registries hold curated metrics the manifests lack
   (Only-registry), and OxyDex's manifest holds 67 compute-only metrics the registry deliberately leaves to
   the experimental fallback (Only-manifest). A flip would silently drop/rekey/re-grade dozens of metrics.
3. **HRVDex has no manifest at all.** It cannot be migrated without authoring one from scratch.
4. **The generator has no "exclude from registry" flag.** It emits an entry for *every* manifest metric, so
   OxyDex's 67 compute-only metrics would all become graded registry entries — changing the registry's
   curated membership. Per the brief's risk rule ("do not grow the manifest schema ad hoc mid-pass"), this is
   a STOP-and-record design gap, not an inline fix.

## Per-node notes

### OxyDex
- Manifest 87 metrics · registry 50 · **20 shared ids**, 30 registry-only, 67 manifest-only.
- **Registry metrics absent from the manifest (Phase 1 must ADD these 30, graded):** `meanSpo2`, `minSpo2`, `hypoxicBurden`, `desatProfile`, `meanHr`, `minHr`, `maxHr`, `ahiEst`, `cvhrIndex`, `sleepEff`, `ct89`, `ct88`, `ct85`, `spo2Skew`, `vo2est`, `duration`, `motion`, `spo2Nadir`, `maxSpo2`, `spo2Std`, `rmssd`, `hrVarSd`, `nocDip`, `sd1`, `readiness`, `z2win`, `mafHr`, `karvZone`, `oscWindows`, `periodicBreathing`
- **Structural conflicts on shared ids (14):**
  - `odi4`: unit `/hr`≠`events/hr`
  - `odi3`: unit `/hr`≠`events/hr`
  - `t95`: label `T95% Time`≠`T95`
  - `t88`: label `T88 Time`≠`T88` · unit `min`≠`%`
  - `spo2Drift`: label `SpO₂ drift`≠`Drift` · unit `%/night`≠`%/hr`
  - `hrSpikes`: label `HR Spikes`≠`Spikes` · unit `∅`≠`count`
  - `nsi`: unit `∅`≠`score`
  - `sleepStability`: label `Sleep stability`≠`SS` · unit `∅`≠`%`
  - `sbii`: unit `∅`≠`%²·min/hr`
  - `desSev`: unit `%-min/hr`≠`a.u.`
  - `odri`: unit `∅`≠`ratio`
  - `hd94`: label `HD94/hr`≠`HD94` · unit `∅`≠`%-min/hr`
  - `hrSlope`: unit `/hr`≠`bpm/hr`
  - `sd1sd2`: unit `∅`≠`bpm`
- Label resolution under manifest resolver: **18/99** — a flip today would drop ~81 currently-badged labels.

### PulseDex
- Manifest 10 metrics · registry 68 · **4 shared ids**, 64 registry-only, 6 manifest-only.
- **Registry metrics absent from the manifest (Phase 1 must ADD these 64, graded):** `hr`, `medianRR`, `minRR`, `maxRR`, `q25`, `q75`, `nn50`, `modeRR`, `amo50`, `mxdmn`, `cv`, `nBeats`, `coverage`, `artifacts`, `lnRMSSD`, `sdann`, `sdnnIdx`, `triIdx`, `tp`, `hf`, `lf`, `vlf`, `lfhf`, `hfnu`, `lfnu`, `sd1`, `sd2`, `sd1sd2`, `ellArea`, `si`, `dfaAlpha1`, `sampen`, `decelCap`, `accelCap`, `rsaProxy`, `respRate`, `vagalEff`, `sdnnZ`, `pip`, `ials`, `pss`, `pas`, `hrvScore`, `stress`, `energy`, `focus`, `coherence`, `recovery`, `recovIndex`, `ansSns`, `ansPsns`, `snsBal`, `psnsBal`, `abs`, `efc`, `crs`, `sfg`, `fe`, `pnse`, `otr`, `htn`, `health`, `vo2`, `vo2base`
- **Structural conflicts on shared ids (1):**
  - `meanRR`: label `Mean RR`≠`RRμ`
- Label resolution under manifest resolver: **5/90** — a flip today would drop ~85 currently-badged labels.

### HRVDex
- **No `codegen/manifests/hrvdex.manifest.json`.** 34 hand-registry entries, zero manifest coverage. Blocked until a manifest is authored (registry → manifest back-fill).

### ECGDex
- Manifest 35 metrics · registry 78 · **6 shared ids**, 72 registry-only, 29 manifest-only.
- **Registry metrics absent from the manifest (Phase 1 must ADD these 72, graded):** `rmssd`, `sdnn`, `lnRMSSD`, `qtc`, `hr`, `steps`, `analyzable`, `coverage`, `correction`, `meanSqi`, `ectopy`, `cvhrIndex`, `decelCapacity`, `respRate`, `ellArea`, `crCoupling`, `lfhf`, `rraccRate`, `edrAgreement`, `edrDisagree`, `stageConsensus`, `afScreen`, `hrvStability`, `rsaEfficiency`, `beatsNN`, `meanRR`, `medianRR`, `minRR`, `maxRR`, `cv`, `qrs`, `qt`, `pr`, `stLevel`, `rAmp`, `tAmp`, `pvc`, `pac`, `couplets`, `ventRuns`, `bigeminy`, `cvhrEvents`, `pnn50`, `qtcFrid`, `hf`, `lf`, `vlf`, `hfnu`, `lfnu`, `sdann`, `sdnnIdx`, `triIdx`, `sampen`, `accelCapacity`, `pip`, `rsaAmplitude`, `crcPLV`, `couplingStrength`, `edrResp`, `estAHI`, `apneaRisk`, `sigmaLnRmssd`, `varLnRmssd`, `surgeEsc`, `hrvScore`, `restingHR`, `expRmssd`, `vo2base`, `vo2adj`, `totSleep`, `deepMin`, `remMin`
- **Structural conflicts on shared ids (3):**
  - `dfaAlpha1`: unit `∅`≠`exponent`
  - `sd1sd2`: unit `∅`≠`ratio`
  - `totalPower`: label `Total power`≠`TP`
- Label resolution under manifest resolver: **15/112** — a flip today would drop ~97 currently-badged labels.

### PpgDex
- Manifest 14 metrics · registry 44 · **0 shared ids**, 44 registry-only, 14 manifest-only.
- **Registry metrics absent from the manifest (Phase 1 must ADD these 44, graded):** `hr`, `pi`, `riseTime`, `motion`, `analyzable`, `correction`, `meanSqi`, `cleanPulses`, `motionIdx`, `accHz`, `gyroHz`, `agreement`, `meanAbsDev`, `meanPPI`, `ledAgreement`, `rmssd`, `sdnn`, `lnRMSSD`, `pnn50`, `sd1`, `sd2`, `triIdx`, `dicrotic`, `ai`, `reflectionIdx`, `sdppgBA`, `agingIdx`, `notchTime`, `pulseWidth`, `sd1sd2`, `ellArea`, `cvhrIndex`, `dfaAlpha1`, `vlf`, `lf`, `hf`, `lfhf`, `lfnu`, `hfnu`, `totalPower`, `sampEn`, `hrvScore`, `vo2`, `posture`
- Structural conflicts on shared ids: none (but grade layer still entirely unauthored).
- Label resolution under manifest resolver: **4/84** — a flip today would drop ~80 currently-badged labels.

### GlucoDex
- Manifest 22 metrics · registry 42 · **7 shared ids**, 35 registry-only, 15 manifest-only.
- **Registry metrics absent from the manifest (Phase 1 must ADD these 35, graded):** `mean`, `sd`, `mag`, `pctActive`, `duration`, `compression`, `dataConf`, `nocHypo`, `excursions`, `warmup`, `sessionSpread`, `sessionDrift`, `ea1c`, `cv`, `titr`, `tbr1`, `tbr2`, `tar1`, `tar2`, `timeBelow`, `timeAbove`, `jIndex`, `grade`, `adrr`, `qtc`, `gvp`, `dawn`, `lnrmssdSlope`, `stability`, `irBand`, `autoRisk`, `glyVar`, `hypoQtc`, `gmiVsLab`, `sensorBias`
- **Structural conflicts on shared ids (4):**
  - `tir`: label `Time in Range`≠`TIR`
  - `conga`: label `CONGA`≠`CONGA-1`
  - `lbgi`: unit `∅`≠`risk units`
  - `hbgi`: unit `∅`≠`risk units`
- Label resolution under manifest resolver: **9/71** — a flip today would drop ~62 currently-badged labels.

### CPAPDex
- Manifest 14 metrics · registry 37 · **14 shared ids**, 23 registry-only, 0 manifest-only.
- **Registry metrics absent from the manifest (Phase 1 must ADD these 23, graded):** `eprDelta`, `epap95`, `reraIndex`, `periodicBreathingPct`, `maxLeak`, `respRateMedian`, `respRateRange`, `tidVolMedian`, `minVentMedian`, `minVentStability`, `flowLimMean`, `flowLimitedPct`, `snorePct`, `snorePressureCorr`, `breathCount`, `breathRate`, `ieRatio`, `odi`, `t90Pct`, `spo2Nadir`, `spo2Mean`, `pulseMedian`, `pulseRange`
- **Structural conflicts on shared ids (14):**
  - `usageHours`: label `Usage Hours`≠`UH`
  - `compliancePct`: label `30-Day Compliance`≠`CMP`
  - `maskOnLatency`: label `Mask-On Latency`≠`ML`
  - `medianPressure`: label `Median Pressure`≠`P50`
  - `p95Pressure`: label `95th-%ile Pressure`≠`P95`
  - `pressureRange`: label `Pressure Range`≠`PR`
  - `residualAHI`: label `Residual AHI`≠`AHI` · unit `/hr`≠`events/hr`
  - `centralIndex`: label `Central Apnea Index`≠`CAI` · unit `/hr`≠`events/hr`
  - `obstructiveIndex`: label `Obstructive Index`≠`OAI` · unit `/hr`≠`events/hr`
  - `hypopneaIndex`: label `Hypopnea Index`≠`HI` · unit `/hr`≠`events/hr`
  - `medianLeak`: label `Median Leak`≠`LK50`
  - `p95Leak`: label `95th-%ile Leak`≠`LK95`
  - `largeLeakPct`: label `Large Leak %`≠`LL%`
  - `leakCV`: label `Leak CV`≠`LKCV`
- Label resolution under manifest resolver: **20/101** — a flip today would drop ~81 currently-badged labels.

## Recommendation (go / no-go per node)

| Node | Verdict | Why |
|---|---|---|
| CPAPDex | **Closest, still not ready** | Only node whose manifest ids ⊆ registry (14/14, 0 manifest-only) — but 23 registry metrics are absent from the manifest and the grade layer is 100% unauthored. A flip today drops 23 metrics. Best *first* candidate after Phase-1 enrichment; NOT OxyDex. |
| GlucoDex / ECGDex / PpgDex / PulseDex / OxyDex | **No-go on current manifests** | Large id-namespace + membership divergence, grade layer unauthored, 62–85 badged labels would stop resolving. Each is a full registry→manifest re-authoring, not an enrichment. |
| HRVDex | **Blocked** | No manifest exists. |

## What Phase 1 actually entails (revised scope)

For each node, before a single flip: (a) author `evidence` (5-level ladder) + `goodDirection` + `cite` for
**every** metric — sourced from the hand registry where a metric maps, and as a *new clinical/epistemic
judgement* for registry-only and manifest-only metrics that have no counterpart; (b) reconcile ids so the
projection keys match the registry (or accept + propagate a rename through every render call site and the
`*_DEFS` mirror); (c) author the alias spellings the render layer actually calls (manifests currently carry
**0** aliases, hence the label-resolution collapse); (d) decide the membership question (curated subset vs.
exhaustive) and, if subset, extend the generator with an exclude flag (own gated change). Only then does the
empty-diff bar become reachable and Phases 2–3 (flip + re-bundle) apply.

Grades (a) and the membership decision (d) are **domain judgements that change user-facing honesty** and
should not be invented unilaterally inside a "zero semantic change" pass — they need owner sign-off on
approach before Phase 1 begins.
