<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# ECGDex — Build Brief & Project Handoff

> Durable context for a fresh chat. Read this first, then `ans-design.css` and `PulseDex.html`.
> Everything here was decided in a prior planning conversation; this file is the source of truth.

---

## 0. Project identity

- A family of single-signal physiology analyzers, each named `*Dex` (a "codex" for one signal):
  **OxyDex** (SpO₂/oximetry), **HRVDex** (HRV), **PulseDex** (raw RR → HRV), and planned
  **ECGDex** (raw ECG), **CPAPDex** (therapy), **GlucoDex** (glucose).
- **Umbrella platform / shared physiological event bus = "Ganglior"** (a coined name — chosen for an
  empty namespace after Plexus/Ganglion were rejected for collisions). The `-Dex` apps are *nodes*
  that emit events onto the Ganglior bus; a fusion layer correlates them.
- Canonical event shape on the bus:
  ```json
  { "t": "02:14:31", "impulse": "autonomic_surge", "node": "ECGDex", "conf": 0.82 }
  ```
  `conf` comes directly from per-beat signal quality (see §4).

## 1. Design system (already built — REUSE, don't reinvent)

- **`ans-design.css`** is the shared design system (dark teal/blue, `--teal #3DE0D0`, `--blue #58A6FF`,
  bg `#0B0F14`, surfaces `#121821/#18212C`). Tokens, sidebar shell, hero, KPI strip, chart-cards,
  tables, Poincaré, alerts, export bar, light theme, mobile. **ECGDex links this stylesheet and
  inherits the entire look.**
- Fonts: Inter + IBM Plex Mono, self-hosted `.woff2` (files NOT in project → falls back to system;
  fine). No CDNs — privacy/offline is a core principle ("100% local, no data leaves device").
- Match **PulseDex.html** for structure: `.app-shell` grid, `.sidebar` with `.logo` + `.sec-label`
  nav, `.main-content` with `.topbar`, hero, KPI strip, `.chart-card`s, full metrics table, sticky
  `#exportBar`. Copy its skeleton and swap the analysis.

### Graphics reuse rule (IMPORTANT)
- **Derived series** (RR tachogram, HRV trend, CVHR envelope, hypnogram, Poincaré): reuse PulseDex's
  **hand-rolled inline-SVG-via-template-string** pattern (see PulseDex.html ~line 829). Looks native, free.
- **Raw ECG waveform: MUST be `<canvas>`, never SVG.** 4M points will kill SVG/DOM. Use the min/max
  envelope pyramid (§3).

## 2. Data formats (real samples seen)

> ### 🔒 SCOPE DECISION (v1) — ECGDex = ONE file in: the raw ECG only.
> Compute RR (and everything) FROM the ECG. This keeps each `-Dex` true to "one signal, one codex" and
> stays simple. The device's other exports (RR / HR / Breathing / ACC) are **NOT ingested by ECGDex v1** —
> they're deferred to a future **"Integrator"** tool that uploads all raw streams and compares/fuses them
> (that's really Ganglior). They remain documented below as future input, and the device RR file is kept
> for a one-time OFFLINE validation of our self-computed RR (see §3a note).
>
> **Fallback ladder:** Plan A (expected) self-RR → full HRV. Plan B (if self-RR quality is poor) → ECGDex
> does ECG/rhythm/morphology only (HR, rhythm, ectopy, QT, CVHR) and **exports computed RR for PulseDex**
> to do the precise HRV. Clean division of labor.

### O2Ring export (OxyDex) — 1 Hz, NO raw PPG
```
Time,Oxygen Level,Pulse Rate,Motion
21:10:00 03/05/2026,97,57,0
```
- 1 Hz, integer bpm (already averaged), no waveform. Date `DD/MM/YYYY` or `MM/DD` — **ambiguous, must normalize.**
- Known artifact: first ~8 s often a held floor value (e.g. flat 85%) before optical lock → a non-physiological
  jump (85→97 in 1 s). **Suppress pre-lock segment** (require N consecutive varying, plausible samples).

### ECGDex is a MULTI-STREAM chest sensor (Polar-H10-style) — 4 co-registered streams
> **v1 ingests ONLY Stream 1 (raw ECG).** Streams 2–4 below = DEFERRED to the future Integrator.
The device exports several files from ONE session, all sharing the same `Phone timestamp` wall-clock
(and ECG+ACC also share the `sensor ns` monotonic clock) → natively time-aligned (matters for the Integrator).

**Stream 1 — raw ECG, 130 Hz µV  ← THE ECGDex v1 INPUT**
```
Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]
2026-06-01T21:17:09.154;599626023839800192;0.0;189
```
- 130 Hz (`timestamp [ms]` steps 7.692 ms). Amplitude µV, fits Int16. Dual clock (ns = intervals, phone = alignment).
- Overnight ≈ **4.08 M rows ≈ 150–250 MB**. **This is the single ECGDex input; RR is computed from it (§3a).**

**Stream 2 — RR-interval [ms], per-beat — DEFERRED (Integrator) + offline-validation reference**
```
Phone timestamp;RR-interval [ms]
2026-06-01T21:17:07.832;1111
```
- Beat-to-beat RR, firmware-detected. Each row's ts = prev ts + prev RR. Polar timestamps RR at **1/1024 s
  ≈ 0.977 ms**. **v1 does NOT ingest this** — but use it ONCE, offline, to validate our self-computed RR
  (diff RMSSD/SDNN; expect within a few % on clean signal). Becomes a real input only in the Integrator.

**Stream 3 — HR;HRV;Breathing, ~1 Hz device-derived — DEFERRED (Integrator)**
```
Phone timestamp;HR [bpm];HRV [ms];Breathing interval [rpm]
2026-06-01T21:17:11.839;57;13.5;...
```
- Integer HR + **sparse** HRV [ms] + Breathing [rpm] (device already does ECG-derived respiration;
  columns blank until it has a window). Use for quick display + cross-validation; compute own HRV from RR.

**Stream 4 — accelerometer X;Y;Z [mg], ~200 Hz, 3-axis — DEFERRED (Integrator)**
```
Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]
2026-06-01T21:17:18.549;599626033657400832;276;44;957
```
- ~200 Hz (steps ~5 ms), mg units (fit Int16). Z≈960 = gravity. Overnight ≈ **17 M samples — biggest firehose.**
- **Do NOT keep raw.** On ingest reduce to: (a) per-epoch **activity counts** (~1 Hz) for motion/actigraphy,
  (b) slow **gravity vector** for body position. Retain short raw windows only if doing accel-respiration.
- Unlocks: **motion-based SQI gating** (direct artifact signal, see §4), **actigraphy sleep/wake**,
  **body position** (supine/left/right/prone → positional-apnea context), **3rd respiration source**.

## 3. ECGDex engineering solutions (DECIDED — implement these)

### 3a. Sub-sample R-peak timing (PRIMARY — v1 computes RR from the raw ECG)
> v1 has only the raw ECG, so RR is detected here. Validate ONCE offline against the device RR file (Stream 2).
- 7.69 ms sampling quantizes RR → inflates RMSSD & HF. Fix by refining each coarse (Pan-Tompkins) peak:
  - **Layer A — parabolic vertex** on the **5–15 Hz band-passed** signal:
    `delta = 0.5*(a-c)/(a-2b+c)` over peak's neighbors → `t = (i+delta)/fs`. Recovers ~Tₛ/10 (~0.8 ms).
  - **Layer B (robust) — template cross-correlation:** median QRS template from ~50 high-SQI beats;
    per beat, xcorr over ±60 ms, parabolic-interpolate the *correlation* peak → sub-0.5 ms, also removes
    morphology jitter. (Cheap alt: cubic-spline ×10 upsample of ±8-sample neighborhood, argmax.)
- Then resample RR tachogram at **4 Hz cubic spline** before Welch PSD (clean HF 0.15–0.4 Hz).

### 3b. 4M-row ingest without melting the browser
- **Key reframe:** CSV is bloated by text + redundant timestamps. Store amplitude as **Int16Array
  (4M×2B ≈ 8 MB)** + a sparse **gap list** (where sensor-ns delta ≠ expected). 25–30× shrink; memory
  stops being the constraint.
- **Streaming parse in a Web Worker:** `file.stream()` → `TextDecoderStream` → line splitter → push µV
  into pre-sized Int16Array → transfer ArrayBuffer (zero-copy) → optional IndexedDB cache keyed by file hash.
- **Rendering = min/max envelope decimation, NEVER subsample** (subsampling aliases away R-peaks).
  Per pixel column draw a vertical line min→max. Precompute a **multi-resolution pyramid**
  (factors [1,8,64,512,4096]); pick level where visibleSamples/factor ≈ canvasWidth. Draw to `<canvas>`.
  ```js
  function buildEnvelope(int16, factor){
    const n=Math.ceil(int16.length/factor);
    const mins=new Int16Array(n), maxs=new Int16Array(n);
    for(let b=0;b<n;b++){let lo=32767,hi=-32768;const s=b*factor,e=Math.min(s+factor,int16.length);
      for(let i=s;i<e;i++){const v=int16[i];if(v<lo)lo=v;if(v>hi)hi=v;}mins[b]=lo;maxs[b]=hi;}
    return {mins,maxs,factor};
  }
  ```

### 3c. Adaptive processing by recording length (DECIDED)
**Decimation is RENDER-only. Analysis is ALWAYS full/per-beat at every length** — never subsample the math.
Length does NOT change *how much* we process; it changes *which metrics are scientifically valid*.

**Build ONE engine that windows into 5-min epochs and aggregates** (not two pipelines):
- 5-min file → 1 epoch → full short-term suite.
- Overnight → ~105 epochs → same engine + circadian/CVHR aggregation on top.
- Ultra-short → partial epoch → only ultra-short-valid metrics; rest flagged.

**Metric-validity tiers (gate the CLAIMS, not the processing):**

| Recording | Samples@130Hz | Valid metrics | Withhold/flag |
|---|---|---|---|
| **< 5 min (ultra-short)** | < 39 k | HR, **RMSSD**, pNN50, SD1, HF (≥2 min, caveated) | **SDNN, LF, VLF, LF:HF** → show "needs ≥5 min" |
| **5 min (PRIMARY anchor)** | ~39 k | Full short-term suite (Task Force 1996): LF/HF, SDNN, Poincaré | — |
| **> ~1–2 h (overnight)** | > ~0.5 M | + VLF, DFA α1, circadian, **CVHR/apnea**, sleep staging | — |

**Performance switches are automatic + decoupled from validity:**
- **Ingest:** file < ~5 MB (~few min) → parse inline on main thread (instant); larger → streaming worker. (size-triggered)
- **Render:** always build the (cheap) envelope pyramid; pick level from samples *visible* in viewport. Works
  identically for 5-min and overnight — no file-length special-case. (view-triggered)

**Anchor the whole design on the 5-min case** (it's both the common capture AND the validated standard);
overnight is "5-min engine × N + aggregation"; ultra-short is "graceful degrade with honest flags."

## 4. Per-beat SQI (MANDATORY gate, feeds Ganglior `conf`)
Overnight strap-shift → flatline / rail / noise bursts. Score each beat (or 10 s window) 0–1; gate
before HRV/CVHR. Composite checks:
- **Flatline/saturation** (identical or rail runs > ~200 ms)
- **kSQI** (kurtosis — clean ECG is peaky)
- **bSQI** (two R-detectors must agree within ±50 ms)
- **RR plausibility** (reject RR ∉ [300,2000] ms, or Δ>20% vs neighbors unless ectopic)
- **Baseline/range** (drift, electrode pop)
- **ACC motion gate (DEFERRED — Integrator only):** would be the strongest artifact signal, but v1 has no
  ACC stream, so SQI is ECG-only (above). Motion-gating is a future-integrator upgrade.
Single missed beat → giant spurious RR pair: flag + interpolate NN tachogram (Kubios/Malik style).
Surface **correction rate** and **% analyzable night** as first-class honesty metrics; grey excluded
spans on the canvas. This SQI → the `conf` field of every emitted event.

## 5. What ECGDex can extract (multi-stream chest sensor)
- **Tier 1 (solid):** continuous HR & rhythm, ectopy (PVC/PAC), full HRV suite (SDNN/RMSSD/pNN50,
  LF/HF on 5-min windows, Poincaré SD1/SD2, DFA α1, sample entropy), respiratory rate via EDR.
- **Tier 2 (research-grade, flagship):** **CVHR** (cyclic variation of HR = sleep-apnea autonomic
  signature = the `autonomic_surge` event), cardiorespiratory sleep staging (**HRV + EDR**, v1),
  AF screening (RR irregularity — screen only; P-wave weak at 130 Hz).
- **DEFERRED to Integrator (needs ACC):** body position (positional-apnea context), actigraphy-assisted
  sleep/wake, ACC motion gating, accel-derived respiration.
- **Tier 3 (directional only, single lead ≠ 12-lead):** QTc/PR/T-wave overnight *trends* within-subject.

## 6. Vascular metrics — verdicts (DO NOT over-claim)
- **Arterial stiffness / PWV** = the same dependency. True carotid-femoral PWV: impossible with wearables.
- **ECG alone:** no pulse-wave → no stiffness/PWV (purely electrical).
- **PAT (ECG R-peak → peripheral PPG foot):** the only reachable path, BUT PAT = **PEP + PTT**;
  pre-ejection period confounds it → trend-grade pseudo-PWV only, needs BP calibration. NOT clinical.
- **Blocker right now:** O2Ring exposes NO pulse-wave foot (1 Hz integer bpm only). So even PAT is
  not computable today. **Unlocks only when a raw-PPG peripheral sensor (≥100 Hz) joins the fleet.**
- Ship as "Vascular (provisional)", low-confidence, parked until PPG exists.

## 7. Ganglior fusion payoff (the proof case)
ECGDex emits **CVHR autonomic-surge** events; OxyDex emits **desaturation** events; Ganglior correlates
them on a shared timeline → a sleep-apnea event confirmed by BOTH autonomic surge AND O₂ dip (neither app
alone can claim it). **ACC body-position lets Ganglior label positional apnea** (worse supine). Same
desat↔surge correlation later validates CPAPDex. NOTE: the two sample files seen were different nights
(O2Ring 03/05; ECG 06/01) — architecture supports fusion, those specific captures don't overlap.

## 8. Suggested build order for the new chat
1. Copy PulseDex.html skeleton → ECGDex.html, link `ans-design.css`, relabel sidebar/topbar.
2. **Single-file ECG loader:** Web Worker streaming CSV → Int16Array + gap list (small files inline; big
   files worker). Test on the real overnight ECG file.
3. Canvas ECG waveform with min/max envelope pyramid + pan/zoom.
4. R-peak (Pan-Tompkins) → §3a sub-sample refinement → RR series. **Validate once offline vs device RR file.**
5. SQI gate (ECG-only) + NN interpolation + % analyzable.
6. HRV suite + Poincaré (reuse PulseDex SVG charts) + RR tachogram. 5-min-epoch engine (§3c).
7. CVHR detector → apnea autonomic-surge events; cardiorespiratory sleep staging (HRV+EDR). Emit Ganglior JSON.
8. Export bar (CSV/JSON, incl. **computed RR export for PulseDex** = Plan B handoff), 100%-local privacy card.
9. Add `<template id="__bundler_thumbnail">` then bundle to standalone.

**Future — "Integrator" (separate build):** upload ALL raw streams (ECG+RR+HR+Breathing+ACC, multi-device),
co-register on the shared clock, cross-compare/validate, add ACC motion-gating + body-position + actigraphy,
and run the OxyDex↔ECGDex desat↔surge fusion. This IS Ganglior.
