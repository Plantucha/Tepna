<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-08-03 (**Do 4 MEASURED and REFUTED** — on the real 28-day CGM corpus `SD/MADn` is 1.07, so a robust scale moves CV by 0.85 pp; the committed synthetic reads 2.48 and would have "confirmed" it. The nocturnal artifact is a LEVEL shift, not variance. Do 1/2/3/5 unmeasured) · **Created:** 2026-07-14 · **Follows:** `TCH-FUSED-ROBUST-HAT-2026-07-14-BRIEF.md`

# Fused-hat follow-ups — where `beatConfidence` + robust-variance generalize across the Dex fleet

Discovered while building the fused hat: the artifact fragility we fixed for the three-cornered hat is
**not** trio-specific. `RMSSD`/`SDNN`/`CV`/`MAGE` are all **variance-family estimators with breakdown point
0**, so the SAME transient that inflated σ_H10 → 9.6 bpm inflates every one of them the same way; and
`beatConfidence` (window-relative density × SQI, AF-safe via `min`) is a signal-agnostic per-second trust
that any beat/event series can consume. This is the transfer map, not yet executed.

## Transfer map (surveyed: the node DSPs compute these)
| # | finding | target | directness |
|---|---|---|---|
| 1 | `beatConfidence` → ECGDex's **own** HRV (`buildNN`/`epochEngine`), not just the trio | ECGDex | **drop-in** — closes the 06-12 loop for ECGDex's own `RMSSD`/`SDNN`/epoch exports. *(Promoted into the parent brief as an explicit step.)* |
| 2 | `beatConfidence` on the RR series | PulseDex, HRVDex | drop-in structure; each needs an RR-plausibility "quality" channel to stand in for SQI |
| 3 | **robust / confidence-weighted variance** for `RMSSD`/`SDNN` | all HRV nodes (PulseDex · HRVDex · ECGDex · OxyDex) | principle-direct — same estimator, same fix (weighted or Qₙ-based scale) |
| 4 | density × quality window gate → **event counts** (a sustained motion segment fabricates false events) | OxyDex **ODI**, CPAPDex **AHI** | principle-transfer; "density" = event rate. Aligns with `DEEP-AUDIT-2026-07-14`'s OxyDex-ODI findings |
| 5 | robust scale for CGM variability | GlucoDex `CV`/`SD`/`MAGE` (compression lows inflate them) | principle-transfer; no beats → adapt to level-jump / change-point detection |
| 6 | **dead-cue audit** — a quality input silently ≈ 0 corpus-wide (ECGDex `bSQI`: `detectPeaksB`'s global-`mx` floor → 0–55 beats/night, so the 0.28-weight `matchB` term is dead) | any node with a quality cue | audit lesson — verify each quality axis actually varies |
| 7 | "local per-sample gate misses **sustained collective** artifact" (Chandola collective anomaly) | any Malik/local-median RR/ECG/PPG cleaner | design lesson — pair local gates with a window-relative, self-calibrating one |

## Notes
- **Detector B is worth a real fix regardless** (finding 6): an adaptive/windowed threshold revives it (prototyped: 25k–43k beats vs 0–55), which un-deads `bSQI` and re-enables two-detector agreement as a genuine quality axis. It was NOT usable as a hard consensus gate (false-flagged a clean 70-min block on 06-10), but as a *soft SQI term* it's currently contributing nothing.
- **AF-safety is the invariant to preserve everywhere:** any gate keys on signal quality / cross-sensor inconsistency, never on rhythm irregularity — real arrhythmia is high-variability but clean, and must survive.

### ⛔ Do 4 (GlucoDex robust variability) — MEASURED 2026-08-03, and REFUTED as stated

Finding 5 reads *"robust scale for CGM variability — GlucoDex `CV`/`SD`/`MAGE` (compression lows inflate
them)"*, marked **principle-transfer**. It had never been measured. `tools/cgm-variability-check.mjs`
ships with this entry and measures it on the real 28-day Lingo corpus (8094 readings, 0 unparsed).

**A breakdown-point-0 estimator is only wrong when there is a tail to break it.** The discriminator is
`SD / MADn` (MADn = 1.4826·median|x−med|, Gaussian-consistent): 1.00 on clean data, rising with tail mass.

| | SD / MADn | CV classical → robust |
|---|---|---|
| **real corpus** (28 d) | **1.074** | 14.2 % → 13.3 % (**0.85 pp**) |
| committed synthetic | 2.484 | 14.4 % → 6.1 % (8.32 pp) |

**On real data there is no tail to fix.** Swapping in a robust scale moves CV by 0.85 percentage points,
against a consensus CV threshold of 36 % that this subject (14 %) is nowhere near. Do 4 does not apply
to this signal.

**And the synthetic would have "confirmed" it.** Its baseline is flat — p5 89, p50 98 — with planted meal
excursions to 147, so MADn is tiny (5.93) and the ratio is 2.5×. That is precisely the configuration in
which a robust swap looks dramatic. The real trace has a broad body (p5 63 · p50 78 · p95 95) and no such
separation. A principle-transfer argument tested on that synthetic would have shipped a compute-path
change to `validated`-tier KPIs on 8 percentage points of illusory improvement.

### ↳ Where the artifact actually lands: LEVEL, not VARIANCE

The nocturnal enrichment finding 5 was reaching for is real — it just does not touch the variance family.
Split by GlucoDex's own daypart windows:

| window | n | mean | CV % | < 70 mg/dL |
|---|---|---|---|---|
| overnight 00–06 | 2015 | **71.6** | **10** | **40.1 %** |
| morning 06–12 | 2006 | 84.0 | 9 | 1.1 % |
| afternoon 12–18 | 2041 | 83.7 | 15 | 8.7 % |
| evening 18–24 | 2032 | 75.6 | 13 | 22.7 % |

Overnight is **3.70× enriched** in sub-70 readings and simultaneously the **flattest** daypart. A shift in
level with no added variance is the signature of something the variance family is structurally blind to —
which is why the transfer looked plausible and measured out at nothing. The exposed metrics are the
**distributional** ones the shipped export already publishes: `mean 79 · GMI 5.2 · TBR1 18.2 % ·
LBGI 5.2`, all `validated`-tier headline numbers.

**NOT CLAIMED: that these are compression lows.** From the trace alone that is unfalsifiable — it needs
concurrent reference glucose or a second sensor on the contralateral arm. The tool says so in its own
verdict rather than naming the mechanism confidently. What *is* established: the right instrument is a
per-daypart distributional flag, not a robust scale, and finding 5 should be re-scoped accordingly before
anyone spends a compute-path change on it.

## Do (when picked up — each its own executable brief + gates)
1. ECGDex-own-HRV — see the parent brief's step.
2. PulseDex/HRVDex robust HRV (`beatConfidence` on RR + weighted `RMSSD`/`SDNN`).
3. OxyDex ODI / CPAPDex AHI artifact-event suppression (coordinate with `DEEP-AUDIT-2026-07-14`).
4. GlucoDex robust variability.
5. Fix `detectPeaksB` (adaptive threshold) → revive `bSQI`.

**Do 4 is CLOSED (refuted + re-scoped, 2026-08-03).** Do 1/2/3/5 stand unmeasured — and the lesson from
Do 4 applies to each: these are principle-transfer *hypotheses*, and the estimator's leverage on REAL
data is a one-command measurement that costs far less than the compute-path change it would justify.
Measure the ratio before writing the fix.
