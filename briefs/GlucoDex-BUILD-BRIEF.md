<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# GlucoDex — Build Brief & AI-Coder Handoff
> Durable context for a fresh chat. Read this first, then `ans-design.css`, `ECGDex.html`
> (for the family pattern + the JSON it emits), and the data samples in `uploads/`.
> Follows the conventions already established by PulseDex / HRVDex / OxyDex / ECGDex.

---

## 0. Identity & place in the fleet
- **GlucoDex** = the `*Dex` node for **one signal: continuous glucose (CGM)**. "One signal, one codex."
- Umbrella platform / shared event bus = **Ganglior**. GlucoDex is a *node* that emits events onto the bus
  and a *consumer* that ingests other nodes' exports (esp. ECGDex) for the fusion story.
- Canonical bus event shape (same as every node):
  ```json
  { "t": "02:14:31", "impulse": "glucose_excursion", "node": "GlucoDex", "conf": 0.0 }
  ```
- **Core principle (non-negotiable, inherited):** 100% local. CSV parsed & analyzed in-browser, nothing
  leaves the device. No CDNs. Single portable HTML file at ship time.

## 1. Reuse — DO NOT reinvent
- **`ans-design.css`** is the shared design system (dark teal/blue: `--teal #3DE0D0`, `--blue #58A6FF`,
  bg `#0B0F14`, surfaces `#121821/#18212C`; plus readiness-hero, proj-card, KPI strip, chart-cards,
  tables, profile grid, sidebar shell, light theme, mobile). Link it and inherit the entire look.
- **Match `ECGDex.html` structure exactly** — copy its skeleton and swap the analysis:
  - `.app-shell` grid · `.sidebar` (logo + `.sec-label` nav + sidebar readiness badge + privacy/research cards)
  - `.main-content` with `.topbar`, alerts, upload zone + synthetic-generator card, progress bar
  - Readiness **hero** + **Projected metabolic-age** proj-card + collapsible **profile panel**
  - context banner (validity tier) -> KPI strip -> analysis cards -> **full metrics table** -> sticky `#exportBar`
  - `<template id="__bundler_thumbnail">` then bundle to standalone at the end.
- **Split JS into modules** like ECGDex, then inline-bundle into the single HTML at ship:
  `glucodex-dsp.js` (math), `glucodex-render.js` (canvas + SVG charts), `glucodex-profile.js`
  (hero/age/profile), `glucodex-app.js` (ingest/orchestration/exports). Keep editable `*.src.html` + modules
  and a `run_script` that inlines them (ECGDex's bundler script is the template).
- **Charts:** hand-rolled inline-SVG-via-template-string (the `lineChart` / scatter pattern in
  `ecgdex-render.js`). A 24 h glucose trace can be SVG (~288 pts at 5-min CGM, ~1440 at 1-min Lingo).
  For multi-week ingest, use the ECGDex min/max envelope-pyramid + `<canvas>` approach.

## 2. Data formats (real samples in `uploads/`)
### Abbott Lingo / Libre-style CGM -- `lingo-glucose-data-2026-MAY-23.csv` (8095 rows)
```
Time of Glucose Reading [T=(local time) +/- (time zone offset)], Measurement(mg/dL), ...
```
- Header row 1; data from row 2. **Comma-separated.** First col = local timestamp **with trailing tz offset**
  -> must normalize (parse the `+/-HH:MM`). Second col = glucose mg/dL.
- Lingo ~every 1 min (~1440/day); Libre ~every 15 min; Dexcom ~every 5 min. **Detect cadence** from median dt;
  don't hard-code. ~8000 rows ~ several days.
- Artifacts: sensor warm-up (first ~1 h of a new sensor reads low/garbage -> suppress), compression lows
  (sleeping on sensor -> brief non-physiologic dip), gaps (sensor off / out of range). Flag & interpolate gaps;
  **grey them on the trace** (ECGDex SQI pattern).
- **Unit normalization:** accept mg/dL or mmol/L (x18). Auto-detect: values < 30 => mmol/L.

### Optional second input -- ECGDex JSON (the FUSION input)
- GlucoDex ingests an `ecgdex_*.json` export (schema 2.0+). The autonomic-risk inputs, in priority order:
  - `hrvStability.sigma_lnRMSSD_slope` -- the headline Li/Kiyono glycemic-risk signal (rising = instability).
    **May be `null`** when the ECG recording was < 90 min -> fall back to regressing `timeseries.epochs[].rmssd`
    against time yourself (the slope is the signal; recompute it if the scalar is absent).
  - `timeseries.epochs[]` -- per-5-min rMSSD/HR for your own regression / overlay.
  - `apnea.surgeEscalationPct` -- late-night CVHR escalation (an instability co-marker, added in ECGDex 1.1+).
  - `cardiorespiratory.{couplingStrength, crcPLV, plvDuringSurges, plvBaseline}` -- blunted cardiorespiratory
    coupling is an autonomic-dysfunction marker that co-travels with dysglycemia (added in ECGDex 1.1+).
  These three families together form a stronger autonomic-risk vector than the lone slope. **Proof case (§5).**

## 3. What GlucoDex computes (DECIDED -- implement these)
**Build ONE engine that windows the CGM series and aggregates.** Decimation is render-only; math is always
on the full series. Adaptive validity tiers gate the *claims*, not the processing:

| Recording | Valid metrics | Withhold/flag |
|---|---|---|
| **< 24 h** | mean glucose, GMI, SD, CV, basic TIR | MODD, reliable AGP %TIR (needs >=14 d) |
| **1-13 days** | + full TIR/TAR/TBR, MAGE, CONGA, GVP, dawn phenomenon | AGP percentile bands need >=14 d (caveat) |
| **>= 14 days (AGP standard)** | + AGP median/IQR/10-90 envelope, MODD, robust GMI | -- |

### 3a. Core glycemic metrics
- **Mean glucose**, **SD**, **CV%** (=SD/mean*100; <36% = stable, consensus threshold).
- **GMI** = `3.31 + 0.02392 * meanGlucose(mg/dL)` -> %. Label "GMI (lab-A1c proxy)", NOT "A1c".
- **Time-in-ranges** (consensus 2019, mg/dL): TBR2 <54 | TBR1 54-69 | **TIR 70-180** | TAR1 181-250 | TAR2 >250.
  Stacked horizontal bar.
- **Estimated HbA1c** (ADAG): `(meanMgDl + 46.7) / 28.7` -> %. Show alongside GMI; note they differ.

### 3b. Variability suite
- **MAGE** (Mean Amplitude of Glycemic Excursions): mean of excursions > 1 SD, direction-counted.
- **CONGA(n)** (n=1,2,4 h): SD of (G(t) - G(t-n)).
- **MODD** (Mean Of Daily Differences): mean |G(t) - G(t-24h)| -- needs >=2 days.
- **GVP** (Glucose Variability Percentage): trace path-length vs flat line, %.
- **J-index** = `0.001 * (mean + SD)^2`.
- **LBGI / HBGI** (Kovatchev low/high risk indices). Standard, well-defined.

### 3c. Pattern detection (event-level -> Ganglior)
- **Dawn phenomenon:** rise from nadir (03:00-06:00) to pre-breakfast (06:00-08:00); flag if >= ~20 mg/dL.
- **Nocturnal hypo:** TBR episodes 00:00-06:00 (>=15 min < 70). High-priority.
- **Postprandial excursions:** no meal markers -> detect rapid rises (slope) as excursion events.
- Emit `glucose_excursion` (rise) / `nocturnal_hypo` / `dawn_surge` on the bus, conf ∝ local data quality.

### 3d. Personalization (profile panel -- the family signature; mirror ECGDex `personalize()`)
Fields that genuinely change interpretation:
- **Age, Sex** (norms/communication), **Diabetes status** (none / pre-DM / T1 / T2 -- shifts targets &
  which thresholds matter), **Therapy** (none / orals / basal / MDI / pump) -- reframes hypo risk like
  ECGDex's CPAP toggle reframes apnea, **Target range override** (clinician-set), **Lab A1c ground truth**
  (validate GMI against it -- the ECGDex self-RR-vs-device-RR validation analog).
- **Projected "Metabolic Age"** proj-card: composite of mean glucose + CV + TIR mapped to age norms
  (mirror `ansAge()` -- 3-marker weighted composite vs chronological age).
- **Hero** = "Glycemic Stability" score (0-100) from TIR + CV + hypo burden, with an age/therapy-relative note.

## 4. Quality gate (MANDATORY, mirrors ECGDex SQI)
- **% time CGM active** (= analyzable %) -- first-class honesty metric; AGP needs >=70% over the period.
- Suppress warm-up, flag compression lows, interpolate gaps, grey excluded spans on the trace.
- `conf` on every emitted event ∝ local completeness/quality. Surface "% sensor active" prominently.

## 5. THE FUSION PAYOFF (§7 proof case -- why GlucoDex matters to Ganglior)
**Li & Kiyono 2026 (Sensors 26(4):1118, CC BY 4.0)** showed the *nocturnal trend* of HRV instability
`bσ(ln RMSSD)` tracks glucose metabolism (Cohen's |d| > 1.1). **ECGDex already computes & exports this**
(`hrvStability.sigma_lnRMSSD_slope`, plus `timeseries.epochs[].rmssd`). So:
- GlucoDex ingests an ECGDex JSON -> correlates **last night's autonomic-risk vector** against **GlucoDex's
  own measured overnight glucose / dawn phenomenon**. The vector is no longer a single number: combine
  `sigma_lnRMSSD_slope` (rising = instability) with `apnea.surgeEscalationPct` and the inverse of
  `cardiorespiratory.couplingStrength` (lower coupling = more autonomic dysfunction). Weight the slope highest;
  the other two are corroborating, not primary. If `sigma_lnRMSSD_slope` is null (short ECG), recompute it from
  `timeseries.epochs[].rmssd` so the fusion still runs.
- Show an **"Autonomic <-> Glycemic" fusion card**: ECGDex-predicted instability vs GlucoDex-measured glucose
  variability, same night. The cross-node validation neither app can do alone -- the Ganglior thesis.
- Build a software-only **IR-risk readout** (no new hardware): combine GlucoDex CV%/MAGE/dawn +
  (if present) the ECGDex autonomic vector -> a directional insulin-resistance-risk band.
- **Close the handshake (bidirectional).** ECGDex's export reserves `reserved.glucoseCorrelation: null` with
  `glucoseSource: "GlucoDex"` -- it is *waiting for GlucoDex to fill it*. So GlucoDex must EMIT the result back
  onto the bus: a `glucose_autonomic_correlation` (or `nocturnal_glucose_risk`) value + Ganglior event that a
  future Integrator can hand to ECGDex's reserved slot. GlucoDex is both consumer AND producer in this pair.
- Honesty: sample files may be different nights; align by shared wall-clock when nights overlap.
  **Directional, not diagnostic** -- same bar as ECGDex's est-AHI.

## 6. Verdicts -- DO NOT over-claim (inherited honesty rules)
- GMI/eA1c are **proxies**, never "your A1c". Always show the formula + that lab A1c differs.
- IR-risk / Metabolic-age are **directional, informational**, not diagnoses. Flag clearly.
- **No insulin-dosing advice, ever.** Hypo alerts use "review with clinician" framing.
- If diabetes status/therapy unknown, use general-population ranges and say so.
- **Recalibrate paper-derived "optimal" targets to real ranges.** A reference value from a study (the way
  ECGDex's RSA-efficiency optimum is ~1.5 while real overnight wearable values sit ~1.05) must NOT become a
  pass/fail threshold, or every normal reading flags red. Same trap for the Metabolic-age composite and the
  IR-risk band -- set severity bands from observed wearable distributions, keep the literature optimum as a
  labelled reference only.

## 7. Suggested build order
1. Copy `ECGDex.html` skeleton -> `GlucoDex.html`; link `ans-design.css`; relabel sidebar/topbar/logo.
2. **CGM loader:** robust CSV parse (comma; tz-offset normalize; mg/dL vs mmol/L auto; cadence detect;
   warm-up suppress; gap flag/interp). Small files inline; multi-week -> ECGDex worker+envelope pattern.
3. **24 h / multi-day glucose trace** (SVG line; AGP percentile envelope when >=14 d; greyed gaps; TIR shading).
4. Core metrics (§3a) -> KPI strip + table. Then variability suite (§3b), pattern detection (§3c) -> event list.
5. **Profile + hero + metabolic-age** (§3d), persisted to localStorage; re-render on edit (ECGDex pattern).
6. **Quality card** (% active, gaps, warm-up) (§4).
7. **Fusion card** (§5): "Load ECGDex JSON" button -> parse -> correlate the autonomic-risk vector (slope +
   surge-escalation + coupling, §5) vs glucose variability -> IR-risk band + autonomic<->glycemic plot. Emit
   Ganglior events, and write the producer-side correlation back into the `fusion` export (§8 handshake).
8. **Exports:** comprehensive AI-friendly JSON (copy ECGDex's `exportJSON` schema below). Plus CSV re-export of
   cleaned series. Add a **synthetic CGM generator** (realistic days: dawn phenomenon, meal spikes, nocturnal
   dips, sensor gaps; optional healthy vs pre-DM profiles) so it's demoable with no file.
9. `<template id="__bundler_thumbnail">` -> inline-bundle to one portable `GlucoDex.html`.

## 8. AI-friendly export contract (match ECGDex exactly)
Top-level keys: `schema` (name/version/node/units/doc) | `recording` | `quality` | `glycemic`
(mean/GMI/eA1c/SD/CV/TIR...) | `variability` (MAGE/CONGA/MODD/GVP/Jindex/LBGI/HBGI) | `patterns`
(dawn/nocturnal-hypo/excursions) | `personalization` (profile + metabolic age + stability score) |
`fusion` (ECGDex-correlation results, null if no ECG JSON loaded) | `timeseries` (per-hour & per-day
aggregates -- the cross-node currency) | `ganglior_events` | `reserved` (e.g. `autonomicInstabilitySlope`
from ECGDex, `desatCorrelation` from OxyDex).
Rules: every metric a named key; `null` = not computed at this length/quality; include a `units` dictionary and
short `doc` strings; numbers rounded sensibly; ISO-8601 timestamps. See `exportJSON()` in `ecgdex-app.js` as
the reference implementation (schema 2.0).
- **Self-auditing convention (new in ECGDex 1.1+ -- adopt it).** Embed the interpretation metadata *inline,
  next to the value*, so a downstream node never needs the source code to reproduce a score: ship the GMI/eA1c
  **formulas** as strings, the TIR/CV **threshold cutoffs** as a `thresholds` object, and the Metabolic-age
  **component weights** as a `weights` object (mirror ECGDex's `nonlinear.thresholds`,
  `personalization.ansAge.weights`, `altitudeFactorFormula`, `vo2maxFormula`). Exports should be auditable
  stand-alone.
- **`fusion` block carries the producer side too.** Beyond the ECGDex-correlation *results*, write the value
  GlucoDex feeds back to the bus (e.g. `glucoseAutonomicCorrelation`, `nocturnalGlucoseRisk`) so a future
  Integrator can drop it into ECGDex's reserved `glucoseCorrelation` slot (§5 handshake).

## 9. Honesty / scope decisions locked
- v1 ingests ONLY the CGM file (+ optional ECGDex JSON for fusion). No food-log/insulin-pump ingest in v1
  (defer to a future Integrator, same as ECGDex deferred ACC/RR/HR streams).
- Pattern detection without meal markers is slope-based and labelled "unannotated excursion".
- This file is the source of truth. When in doubt, do what ECGDex did.
