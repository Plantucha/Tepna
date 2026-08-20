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

**Do 4 is CLOSED (refuted + re-scoped, 2026-08-03). Do 2 is CLOSED (refuted, 2026-08-18 — below).
Do 3 is CLOSED (already implemented, 2026-08-18 — below). Do 1 is RE-SCOPED (measured 2026-08-18 — its
named night is not special, and the leverage is 0.19 % of epochs).** Do 5 stands unmeasured — and the lesson from Do 4 applies to each: these are principle-transfer
*hypotheses*, and the estimator's leverage on REAL data is a one-command measurement that costs far less
than the compute-path change it would justify. Measure the ratio before writing the fix.

### ✅ Do 3 (OxyDex ODI / CPAPDex AHI artifact suppression) — MEASURED 2026-08-18, ALREADY SHIPPED

Unlike Do 2 and Do 4 this is not a refutation: the suppression Do 3 asks for **already exists**, and the
corpus shows it is load-bearing rather than decorative — which is the part worth recording, because
"already implemented" and "implemented and doing nothing" are the two outcomes this repo confuses.

**OxyDex.** `processNight` subtracts artifacts from ODI-4 (`odi4.count -= desat.artifactCount`, surfaced as
`odi4.artifactExcluded`) and the ODI-3 path is artifact-gated via `pulseSeries`. Measured over **55 corpus
nights** (`desatProfile.artifactCount` vs `events` / `eventsAll`):

| | |
|---|---|
| artifacts suppressed per night | median **0**, mean 0.87, max **7** |
| nights where it removed ≥1 event | **23 of 55 (42 %)** |
| artifacts as a share of raw ODI-4 | median 0 %, **max 55.6 %** |

⚠ **The decisive night is 2026-07-21: `artifactCount=7, events=0, eventsAll=7`.** Every detected
desaturation that night was an artifact. Without the gate that night scores **ODI-4 = 7 instead of 0** — a
fully fabricated index, not an inflated one. A median of 0 would, on its own, have read as machinery that
never fires; it fires on 42 % of nights and decides the verdict on at least one.

**CPAPDex.** Same gating on its oximetry path — *"ODI: artifact desats are excluded and never emitted
downstream"*, filtered by `!e.artifact` with its own `artifactCount`.

⚠ **The "AHI" half of Do 3 is a category error and should not be built.** CPAPDex's `residualAHI` is not a
desaturation index — it comes from CPAPDex's own **flow** classification (`'OA' // obstructive component
scored toward AHI`), and the code already records a *deliberate* divergence from the device's count. The
desat-artifact machinery does not touch it and should not: suppressing device-corroborated apneas because
an optical artifact gate fired is not the same operation as excluding a fake desaturation.

**So: nothing to build. The ODI half is done and measurably matters; the AHI half names a quantity the
proposed mechanism does not apply to.**

### 🔒 Do 5 / finding 6 (revive `bSQI`) — the dead-cue audit CANNOT BE RUN, and that is why it has sat

Finding 6 asserts `bSQI` is *"silently ≈ 0 corpus-wide"*. Attempting to verify it 2026-08-18 established
three things, the third of which blocks the other two:

1. **`bSQI` is absent from every export.** All 55 ECGDex trio nights carry `quality:
   {analyzablePct, cleanBeatPct, coveragePct}` and no `bSQI` at any depth. No consumer can see it, which is
   the simplest explanation for why a suspected dead cue went unnoticed for so long.
2. **It carries 0.28 of the composite per-beat SQI** — `0.30·kSQI + 0.28·bSQI + 0.24·rrPlaus + 0.18·ampOK`,
   the second-largest term. If the assertion is true, that composite has been running on 72 % of its
   intended inputs.
3. **It is unreachable from outside the module.** `detectPeaksB` is module-internal (not on `ECGDSP`), and
   the exported `computeSQI(int16, fs, peaks, times, peaksB)` *requires `peaksB` as an argument* — which
   only `detectPeaksB` can produce. `hrConfidence` computes both internally but returns beat confidence,
   not the SQI terms. So there is no path to a `bSQI` number without changing code.

**Therefore the first step of Do 5 is NOT "fix `detectPeaksB`" — it is "make `bSQI` observable".** Export
the detector (or surface the per-term SQI breakdown), measure the corpus, and only then decide whether the
adaptive threshold is worth building. Fixing a detector whose output nobody has measured is how the
0-leverage changes in Do 2 and Do 4 nearly got built.

### ✅ Do 5 step 1 EXECUTED 2026-08-20 — observable, measured, and finding 6 is REFUTED as written

Both routes were taken, because they close different halves: `detectPeaksB` is now **exported** (finding
3's blocker — the exported `computeSQI` requires `peaksB`, which only that detector produces, so the
scorer was reachable and the term was not), and `computeSQI` now returns a **`terms` breakdown** —
`{ n, kSQI, bSQI, rrPlaus, ampOK, flatBadPct }`, means over the record — surfaced by `analyze` as
`sqiTerms`. Both additive; export projection untouched, so no fixture output moves. Gated by
`ecgdex-dsp · sqi · terms-observable` (19 assertions), which deliberately does **not** assert that bSQI is
healthy: a gate demanding a high bSQI would fail on exactly the corrupted input the term exists to flag.
It gates that the number is reachable, in range, and **responsive** — a dead term and a live one must
produce different values. With no beats every term is `null`, never 0, per the `lombScargle` precedent in
the same file.

**Finding 6 said `bSQI` is *"silently ≈ 0 corpus-wide"*. Measured over 16 real H10 segments, 30,306
beats, it is not:**

| term | min | p25 | median | p75 | max |
|---|---|---|---|---|---|
| **bSQI** | 0.0019 | 0.8102 | **0.9951** | 0.9991 | 1.0000 |
| kSQI | 0.3262 | 0.3694 | 0.4572 | 0.4785 | 0.5199 |
| rrPlaus | 0.9930 | 0.9994 | 1.0000 | 1.0000 | 1.0000 |
| ampOK | 0.9991 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |

bSQI is the **second-healthiest** term on real data. The one running structurally low is **kSQI**, median
0.457 — i.e. the composite is losing ~0.16 of its 0.30 kurtosis share on every clean beat, which is a
different question from the one Do 5 asks and is recorded here rather than acted on.

### ⚠️ But the finding survives in a sharper form, on 1 segment in 16 — and `cleanBeatPct` cannot see it

`…_20260625_215300_ECG_part01of10` reads **bSQI = 0.0019** — detector B confirms **4 of 2074** beats —
while `cleanBeatPct` reads **99.8** and every other term is ~1. The composite still clears `sqiThr` 0.3
(0.30·0.47 + 0 + 0.24 + 0.18 ≈ 0.56), so the whole HRV chain proceeds on 72 % of its intended inputs and
**nothing downstream shows it**. That is finding 6's real content: not a corpus-wide zero, but a silent,
segment-scoped collapse invisible to the only quality number that was published.

**The mechanism is measured, not inferred:**

| segment | A-peaks | B-peaks | max \|bp\| | median R amp | ratio | B's floor `0.18·max` |
|---|---|---|---|---|---|---|
| part01of10 | 2074 | **7** | 2423 | 247 | **9.8** | **436 — above nearly every real R peak** |
| part08of10 | 2089 | 2486 | 277 | 229 | 1.2 | 50 |

`detectPeaksB` anchors its threshold to the **global** maximum (`thr = 0.35·mx`) and floors its running
envelope at `Math.max(0.3·env, 0.18·mx)`. **The floor defeats the adaptation**: one artifact 10× the
median R amplitude lifts `0.18·mx` above the entire rest of the record, and the detector goes silent for
the whole segment. The adaptive envelope is present and cannot act.

**So Do 5's prescription is now justified and precisely scoped** — the fix is to make B's floor local
(a running amplitude quantile) rather than a fraction of the global max, not to rewrite the detector.
Leverage: 1 segment in 16 (~6 %), on which 0.28 of the composite is silently zero. **Deliberately NOT
built here**, per this brief's own sequencing and because it moves the composite for real recordings —
that is a behavioural change owing its own before/after corpus measurement, its own gates and a
`regen-ecgdex-goldens` pass.

⚠️ **Scope of the measurement, stated so it is not over-read:** 16 segments from **one device** (H10
`02849638`), top-level `uploads/` only, ≥1 MB. It is enough to refute a *"corpus-wide ≈ 0"* claim — one
healthy segment does that — and enough to establish the mechanism, which reproduces exactly. It is **not**
a prevalence estimate; 1-in-16 is a count, not a rate.


⚠ **Do not "verify" this by re-implementing `detectPeaksB` outside the module.** That measures the
reimplementation, not the shipped detector — the same trap as a fake written by reading the implementation
(`POLAR-ONBOARD-BACKUP-FOLLOWUPS` §5). It was considered and rejected here.

### ⚠ Do 1 (ECGDex-own-HRV) — MEASURED 2026-08-18: the target is wrong, and the leverage is 0.19 %

Parent step 7 asks to feed `beatConfidence` into ECGDex's own pipeline **"so the 06-12 burst no longer
inflates ECGDex's `RMSSD`/`SDNN`/epoch exports"**, and notes the cost: *"Moves ECGDex outputs ⇒ re-bundle +
fixture regen"*. Both halves of that were measured over **55 trio nights / 4845 epochs** before paying it.

**1 · At whole-night level the named burst does not stand out.** ECGDex `hrv.rmssd` on 2026-06-12 is
**39.8** against a corpus median of 35.8 — **rank 9 of 55, 1.11× median**, well inside a 21.5–47.2 range.
The night aggregate is not inflated in any way a reader could detect.

**2 · At epoch level the spike is real but NOT unique — 06-12 is rank 4 of 55.**

| night | epoch peak ÷ that night's median | peak |
|---|---|---|
| 2026-07-26 | **2.7×** | 96.0 |
| 2026-08-14 | 2.6× | 89.0 |
| 2026-08-11 | 2.6× | 87.7 |
| **2026-06-12** | 2.4× | **96.4** |

06-12 has the highest *absolute* peak and the 4th highest *relative* one. Three nights exceed it and none
has ever been named a "burst". **Fixing "the 06-12 burst" fixes one member of a class nobody has scoped.**

**3 · The class is small.** Epochs above 2× their own night's median: **9 of 4845 = 0.19 %**, on **7 of 55
nights (13 %)**; within an affected night they are a median 1.1 % of its epochs. At ≥1.5× it is 40 of 55
nights, i.e. mild spikes are simply normal HRV.

**So the trade as written is a fleet re-bundle + fixture regen to move 0.19 % of epochs.** That is not an
argument against doing it — it is the number the decision needs, and it was not available before.

**Re-scoped, not refuted.** If it proceeds, two deliverables that step 7 bundles together should be split,
because they cost differently: **(a) exporting per-epoch `c`** adds a field and gives the visibility the
artifact-gate brief asked for without changing any existing metric's value; **(b) down-weighting low-`c`
seconds in `buildNN`/`epochEngine`** changes computed outputs and is what forces the regen. (a) is
defensible on 0.19 %; (b) needs a reason those 9 epochs reach a decision, which nobody has yet shown.

### ⛔ Do 2 (PulseDex/HRVDex robust HRV) — MEASURED 2026-08-18, and REFUTED as stated

Same discriminator as Do 4 (`SD / MADn`, MADn = 1.4826·median|x−med|), on **38 real H10 RR nights** from
the capture corpus. The proposal is `beatConfidence`-weighted robust `RMSSD`/`SDNN` **on top of** the
existing pipeline, so the leverage must be measured **after** `correctRR`, not on raw intervals.

| measured on | SD/MADn |
|---|---|
| RR **levels**, whole night, post-`correctRR` | 1.349 |
| **successive differences** (what `RMSSD` estimates) | 1.144 |
| **per 5-min epoch** — the grain HRV is reported at | **1.077** |
| *Do 4's refuting value, for reference* | *1.074* |

**1.077 against Do 4's 1.074.** At the grain the metric is actually computed, RR carries no more tail than
the CGM series that refuted Do 4 — because `correctRR` already does the robust job: it gates each interval
against the median of the last 7 **accepted** values (0.20 Malik for ECG-derived RR) and substitutes the
reference on rejection. Median rejection rate **12.7 %**, and `RMSSD` already falls 51.2 → 33.5 ms across
the corpus from that correction alone. A second robust layer has almost nothing left to remove.

⚠ **The first measurement said the opposite, and the error is the instructive part.** Raw whole-night RR
**levels** give SD/MADn **1.438** (max 3.049) and `RMSSD` inflated 67 % — which reads as strong support for
Do 2. It is an artifact of measuring the wrong quantity: whole-night RR levels legitimately span the range
as HR tracks sleep stage, so a heavy-tailed *level* distribution is physiology, not artifact. `RMSSD` is a
**successive-difference** statistic evaluated **per epoch**; measured there, the support evaporates. Measure
the quantity the estimator actually consumes, at the grain it is reported at.

**Not a blanket "no".** Per-epoch **p90 is 1.332**, so ~10 % of epochs do carry real excess. That is a
targeted opportunity — flagging or down-weighting *those* epochs — and not a case for changing the fleet's
variance estimators, which is what Do 2 as written proposes.
