<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Build Brief — GlucoDex × Integrator: window glucose at the FUSION layer (not the emitter)

> **For the AI coder (next thread).** Make 30-day CGM fuse against same-night ECGDex/OxyDex sessions —
> **without** chopping GlucoDex into nightly exports. GlucoDex stays **one continuous node** (honest to
> the signal); the **Integrator** slices the CGM to each session's *actual overlap window* on demand.
> This is the smaller build, it honors the platform rule **"one signal, one codex; fusion is a separate
> layer"**, and it aligns to real co-recordings instead of guessed calendar nights. **Read `CLAUDE.md`
> §"THE CLOCK CONTRACT" first and obey it verbatim.** Edit the `.js` + `.src.html`, never the bundled
> `.html`; re-bundle after.

---

## 0. Why this design (the decision, and the one we rejected)

**Problem:** a 30-day CGM is one giant session. The Integrator sees a single GlucoDex node spanning 30
days that overlaps *every* ECG/Oxy night at once, so `fuseAutonomicGlycemic` can't line *this night's*
glucose variability up against *this night's* autonomic load.

**Rejected approach — pre-segment in GlucoDex** (emit an array of nightly node-exports, OxyDex-style).
It's symmetric and simple for the Integrator, BUT:
- It bakes a fusion-time construct (the "night" window) into a node that shouldn't know sleep sessions exist — violates *"fusion is a separate layer."*
- A fixed evening-anchored window (e.g. 18:00→12:00) is a **guess**. Your real captures rarely line up (O2Ring 03/05 vs ECG 06/01); an ECG night 21:00→05:00 and its OxyDex 23:30→06:40 have *different* bounds — one calendar box can't match both.

**Chosen approach — window at the Integrator.** GlucoDex already computes `overlapInterval()` for the
apnea rule. Reuse it: for each ECG/Oxy session, compute the overlap with the continuous CGM node and
run the glycemic metrics **on exactly that slice**. Exact alignment, no guessed bounds, far less new
code (no `segmentNights`, no second export, no per-night `computeFusion` loop).

---

## 1. Read these first (everything you reuse already exists)

**`glucodex-dsp.js`** (pure, `getUTC*` throughout — clock-contract clean):
- The cleaned series object `c`/`r.series` = `{ gT[] (floating tMs), gV[] (mg/dL), gF[] (flags), FLAG{WARMUP,COMPRESSION,…}, N, cadence }`. **This is the sliceable raw material.**
- Metric fns that take a value array (or `c`): `coreMetrics(vals)` → `{mean,sd,cv,gmi,tir,titr,min,max,…}`, `mage(vals,sd)`, `dawnPhenomenon(c)` → `{present,medianDelta,days:[{delta,...}]}`, `nocturnalHypo(c)` → `[{startMs,min,durMin}]`, `daypartVariability(c,totalCV)` → `.overnight.{cv,mean,n}`, `DSP.hhmm(ms)` (UTC formatter).
- `analyze(parsed,…)` returns `r` (with `r.series`, `r.cadence`, `r.dawn`, `r.nocturnalHypo`, …).

**`glucodex-app.js`**: `exportJSON()` (~line 753) builds the `ganglior.node-export`; `computeFusion(r,json)` (~line 440) is the existing ECGDex handshake; `dl(content,name,type)` downloads.

**`integrator-dsp.js`**: `adaptEnvelopeNode()` (GlucoDex branch ~line 174 reads `summary.glucoseCV`/`dawnSurge`/`reserved.glucoseAutonomicCorrelation`); `overlapInterval(a,b)` (~line, returns `{startMs,endMs,overlapMin,basis}`); `fuseAutonomicGlycemic(recs,dtMs)` (~line 426, loops `ecg×glu`, reads `c.summary.glucoseCV`).

---

## 2. GlucoDex change — make the continuous node SLICEABLE (small, additive)

The node-export already carries `recording.startEpochMs` (floating `t0Ms`) and events. **Add a compact
`timeseries.cells` block** so a consumer can recompute metrics on any sub-window:

```json
"timeseries": {
  "cadenceMin": 5,
  "t0Ms": 1780870896000,                 // == recording.startEpochMs (floating)
  "unit": "mg/dL",
  "cells": [                              // ONE entry per cell, in order; skip WARMUP cells
    { "tMs": 1780870896000, "v": 96, "f": 0 },
    { "tMs": 1780871196000, "v": 98, "f": 0 }
  ]
}
```

- Emit absolute floating `tMs` per cell straight from `r.series.gT[i]` (do **not** reconstruct from `t`); `v = r.series.gV[i]`; `f = r.series.gF[i]`. **Use `getUTC*` only** (mirror `renderDaily`'s day-key code).
- For a 30-day, 5-min CGM that's ~8,600 cells — fine as JSON. If size matters, allow `opts.downsampleMin` (e.g. 5) but **default to native cadence**; the Integrator needs ≥ a handful of cells per overnight window.
- Keep everything else in `exportJSON()` unchanged. This is purely **additive** — whole-wear metrics, AGP, `ganglior_events`, `reserved` all stay.
- **Do NOT add a nightly array or a second export.** One continuous node, now sliceable.

---

## 3. Integrator change — slice CGM per overlap window (the core)

### 3.1 Ingest the cells onto the floating axis
In `adaptEnvelopeNode()`'s GlucoDex branch, read `json.timeseries.cells` into the `NodeRec` as a real
series (it's currently `series:{}`):

```js
rec.series.cells = (json.timeseries && json.timeseries.cells || [])
  .map(function(cl){ return { tMs: cl.tMs!=null ? cl.tMs
        : (json.timeseries.t0Ms + /* idx*cadence*60000 if only index given */0),
        v: cl.v, f: cl.f }; })
  .filter(function(cl){ return cl.tMs!=null && cl.v!=null; })
  .sort(function(a,b){ return a.tMs-b.tMs; });
```

Cells already carry absolute floating `tMs`, so **no reconstruction** — just trust + sort. (Keep the
existing whole-wear `summary.glucoseCV`/`dawnSurge` as a *fallback* for legacy exports without cells.)

### 3.2 New helper: `glucoseMetricsInWindow(cgmRec, startMs, endMs)`
Add to `integrator-dsp.js`. Pure. Slices the cells to `[startMs,endMs]` and computes the per-window
glycemic metrics the fusion rule needs. **Port the math from GlucoDex's `coreMetrics`/`mage`/dawn/hypo
or duplicate the tiny formulas locally** (mean, SD, CV = SD/mean·100, TIR 70–140, nadir+`fmtClockS`,
dawn rise = min(03:00–06:00) → max(06:00–08:00) by `getUTC*`, time-below-70 minutes). Return:

```js
{ nMin, coverage,                         // window minutes & fraction of expected cells present
  nocturnalMean, nocturnalCV, nadirValue, nadirTimeMs,
  dawnRise, dawnRiseTimeMs, tir70_140, mage, timeBelow70Min }
// or null if coverage < opts.minCoverage (default 0.5) — NEVER fabricate a thin window
```

All times as floating `tMs`; format only at display via `fmtClockS`. Gate on coverage and return
`null` (honest) when the overlap has too few cells — the rule must skip it, not invent a CV.

### 3.3 Rewire `fuseAutonomicGlycemic` to use the slice
Currently it reads the whole-wear `c.summary.glucoseCV`. Change the inner loop so that for each
`overlapInterval(ecgRec, cgmRec)` it calls `glucoseMetricsInWindow(cgmRec, win.startMs, win.endMs)` and
uses **that window's** `nocturnalCV`/`dawnRise` against the ECG night's `autonomicInstabilitySlope`:

```js
ecg.forEach(function(g){ glu.forEach(function(c){
  var win = overlapInterval(g,c); if(!win) return;
  var gm = glucoseMetricsInWindow(c, win.startMs, win.endMs);
  if(!gm) return;                                   // thin window → skip, honest
  pairs.push({ ecg:g.label, glu:c.label, overlapMin:win.overlapMin,
               slope: g.summary && g.summary.autonomicInstabilitySlope,
               glucoseCV: gm.nocturnalCV, dawnSurge: gm.dawnRise, coverage: gm.coverage });
}); });
```

The downstream r/directional math is unchanged — it just now operates on **window-accurate** CV/dawn,
so a 30-day CGM yields one `(slope, CV)` pair **per overlapping ECG/Oxy night** → with ≥3 nights you
get a real Pearson r (the existing `xs.length>=3` branch), exactly the granularity the rule wanted.
Also feed `gm` into `fuseApneaEvents`/findings if you want per-night glucose context on apnea bands
(optional). Write each window's correlation back into the export's `handshakes` as today.

---

## 4. Verification (clock-contract gates)

1. **Slice correctness:** a window equal to the whole wear yields metrics identical to GlucoDex's whole-wear `exportJSON` values (no math drift between the ported formulas and the source).
2. **Window accuracy:** load a 30-day CGM + ECG night 22:50→05:30 + OxyDex 23:10→06:40 ⇒ `glucoseMetricsInWindow` is computed on each session's *exact* overlap, and the two windows differ (proving it's not whole-wear).
3. **Midnight integrity:** an overnight slice 22:50→05:30 includes the 02:00 cells (windowing is by absolute `tMs`, not calendar day) — no cells dropped at midnight.
4. **Viewer-timezone independence:** re-render under a changed `TZ` ⇒ identical CV/dawn/clocks (audit the new helper for any `getHours`/`getDate`; must be `getUTC*`).
5. **Honesty:** a session that overlaps the CGM by only ~20 min (coverage below gate) ⇒ helper returns `null`, the pair is skipped, no fabricated CV; banner/per-pair view still shows the overlap exists.
6. **Fusion granularity:** ≥3 overlapping nights ⇒ `fuseAutonomicGlycemic` reports a real Pearson r over per-night `(slope, CV)` pairs; non-overlapping nights don't contribute.
7. **Legacy tolerance:** an old GlucoDex export *without* `timeseries.cells` still loads — the rule falls back to whole-wear `summary.glucoseCV` (no crash).
8. **Bundle:** re-bundle `GlucoDex.src.html → GlucoDex.html` and `Integrator.src.html → Integrator.html`; no console errors; standalones match.

---

## 5. Build order
1. **GlucoDex:** add `timeseries.cells` to `exportJSON()` from `r.series` (§2); verify §4.1 parity on a single-night CGM.
2. **Integrator ingest:** read `cells` into `rec.series.cells` in `adaptEnvelopeNode` (§3.1); keep whole-wear fallback.
3. **Integrator helper:** `glucoseMetricsInWindow()` with coverage gate (§3.2); unit-check §4.1–4.3.
4. **Rewire** `fuseAutonomicGlycemic` to slice per overlap (§3.3); verify §4.6.
5. Re-bundle both; full §4 sweep.

## 6. Done criteria
- GlucoDex stays **one continuous node**, now shipping a sliceable `timeseries.cells` (floating `tMs`, `getUTC*`); whole-wear export otherwise unchanged.
- The Integrator computes glycemic metrics on **each session's exact overlap window** via `glucoseMetricsInWindow`, gated on coverage (no fabricated thin-window stats).
- `fuseAutonomicGlycemic` runs **night-vs-same-night** off window-accurate CV/dawn, yielding a real r over ≥3 overlapping nights; closes the `glucose_autonomic_correlation` ↔ `glucoseCorrelation` handshake per window.
- "Fusion is a separate layer" upheld — windowing lives in the Integrator, not the emitter. Clock contract intact. Both standalones bundled, 100% local.
