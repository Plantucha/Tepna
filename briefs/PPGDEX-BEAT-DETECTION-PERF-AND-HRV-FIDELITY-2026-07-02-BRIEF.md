<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-02 · **Created:** 2026-07-02 · **Follow-up:** `PPGDEX-BEAT-DETECTION-PERF-AND-HRV-FIDELITY-FOLLOWUPS-2026-07-02-BRIEF.md` · **Charter:** ad-hoc (real-night PpgDex vs ECGDex diff — `PpgDex_2026-07-01_2143` / `ECGDex_2026-07-01_2143`) · **Touches:** `ppgdex-dsp.js` (behavior) → re-bundle `PpgDex.html` + both provenance gates

> **Two independent defects, same file, same night.** (1) PpgDex `analyze()` is ~10–30× slower than
> ECGDex for reasons that are *algorithmic*, not data-size — a whole-record O(N·lag) autocorrelation in
> `detectBeats` and a 3× whole-record `filtfilt` in channel selection. (2) The published whole-record HRV
> is implausibly high (RMSSD 136.8 ms vs the SAME night's ECGDex 37.4 ms; age-expected 34) — the formulas
> are correct but the interval series feeding them is jitter-inflated and under-gated. **§1 replaces the
> detector with an O(N) streaming detector run as a 3-LED consensus (fixing BOTH perf and the missed-beat
> root cause at once); §2 parallelises the per-channel work across Web Workers; §3–§4 gate the HRV; §5 adds
> the 3-LED agreement graph.** **Re-bundle + re-record PpgDex fixtures after any `ppgdex-dsp.js` edit.**

# PpgDex — beat-detection performance + whole-record HRV fidelity (2026-07-02)

## Evidence (the diff that triggered this)
Same subject, same 431.8-min night, wrist-PPG vs chest-ECG:

| | ECGDex | PpgDex | note |
|---|---|---|---|
| beats detected | 21,087 | **16,480** | at HR 47 you expect ~20,300 → PpgDex **misses ~19 %** |
| whole-record RMSSD | 37.4 ms | **136.8 ms** | ~3.7× the ECG truth; age-expected 34 |
| whole-record SDNN | 90.1 ms | **126.5 ms** | inflated |
| SD1 | 25.65 ms | **96.7 ms** | ~4× inflated |
| HF power | 371 ms² | **10,244 ms²** | ~27× — inflated variance leaking into PSD |
| `correctionRatePct` | 0.11 % | **36.4 %** | a THIRD of intervals median-replaced |
| `analyzablePct` | 100 % | 56 % | |

The HRV *math* is correct (verified `rmssd`, `sdnn`, `poincare` SD1=SDSD/√2 & SD2=√(2·SDNN²−SD1²),
`triIdx` 7.8125 ms bins, `dfaAlpha1`, Parseval-calibrated `lombScargle`). The inputs are the problem.

---

## §1 (PERF + FIDELITY, the big one) — replace the autocorrelation detector with an O(N) streaming detector, run as a 3-LED consensus
**Finding.** `detectBeats` estimates the pulse period by brute-force autocorrelation across the ENTIRE
record:
```js
for(let lag=loLag; lag<=hiLag && lag<n; lag++){ let s=0; for(let i=0;i<n-lag;i++) s+=(bp[i]-m)*(bp[i+lag]-m); }
```
At 176 Hz × 25,910 s ≈ 4.57 M samples with a ~235-lag sweep (0.33–1.66 s) that is **~1.07 billion
multiply-adds in a nested JS loop**, single-threaded, on the main thread. ECGDex never pays this —
`detectPeaks` is Pan-Tompkins: one O(N) forward pass with an adaptive threshold. That global-period step is
also *why* beats are missed: one scalar `T` sets the refractory/segment length for a whole night whose HR
drifts, so the soft-upslope-energy + fixed-0.30-threshold scan drops beats where amplitude/shape wander.

**Change — swap the algorithm, don't just window it.** Pan-Tompkins doesn't port verbatim (its
derivative→square→integrate front-end is tuned to the sharp QRS; a PPG upstroke is soft), but its
*streaming, adaptive-threshold, single-pass* spirit does. Replace autocorrelation + the segment-scan peak
logic with an established O(N) PPG detector:
- **Preferred: MSPTD** (Bishop & Ercole 2018, multi-scale peak-&-trough) — benchmarks best on
  wrist/ambulatory PPG, adapts to changing pulse shape/amplitude with no tuned global period. ~O(N log N),
  still far below the current ~1 B-op autocorrelation.
- **Lighter alt: TERMA** (Elgendi 2013, two event-related moving averages) — strictly O(N), best
  quality-per-compute; the "Pan-Tompkins of PPG."

Either one emits *systolic peaks* with a **local** adaptive threshold → **no whole-record period pass at
all**. Keep the existing intersecting-tangent foot refinement (PPI is foot-to-foot) fed from the new peaks.

**Run it on all three LEDs and take consensus (this is the accuracy lever, see §5).** Detect independently
on ch0/ch1/ch2 (in parallel — §2b), then keep a beat when ≥ 2 of 3 channels agree within ±50 ms — an
optical **bSQI**, mirroring ECGDex's two-detector agreement. Low-SQI / no-consensus beats are **dropped and
marked as a gap**, NOT median-filled (median-fill fabricates regularity and is a prime reason the numbers
look "suspiciously good").

**Done when:** `detectBeats` has no O(N·lag) loop; on the reference night `recording.beats` rises toward
the ECG-implied ~20,300 (missed-beat rate falls), `correctionRatePct` drops well below 36 %, and
`analyze()` wall-time falls sharply. The equiv/device-PPI lane confirms self-PPI RMSSD tracks the paired
ECG/device RMSSD far better than 137 ms.

## §2 (PERF) — demote channel selection from whole-record `filtfilt` ×3 to a windowed ranking
**Finding.** `pickChannel`→`channelSNR` runs TWO whole-record `filtfilt` bandpasses (4 biquad passes each)
on EVERY optical channel to pick best-SNR — ~6 whole-record filter passes before detection even starts.
**Change.** Under §1 all three channels are now detected on (consensus), so channel *selection* is no
longer a discard — `pickChannel` becomes a *ranking* used only to pick the reference channel for the scope
waveform + morphology. Score that ranking on a **decimated or windowed slice** (SNR is a ratio of band
powers — a representative 60–120 s window ranks the 3 LEDs identically to the whole night). **Done when:**
channel ranking touches ≤ a couple ×`window`·`fs` samples per channel; the reference channel on the
reference night is unchanged vs the whole-record scorer.

## §2b (PERF) — parallelise the per-channel pipeline across Web Workers
**Finding.** The three LEDs are fully independent until the consensus merge — bandpass, orient, and
streaming-detect on ch0/ch1/ch2 have zero cross-dependency. Run serially they trebled the filter/detect
cost; run in parallel they cost ~one channel's worth of wall-time. The motion gate (ACC/GYRO/MAGN parse +
grid) is likewise independent of the optical path.
**Change.** Move the per-channel `bandpass`→detector work into a small **Web Worker pool** (one worker per
optical channel, ≤3, transferring the channel `Float32Array` via transferable `ArrayBuffer` so there's no
copy). `analyze()` `await`s the three results, then does the ±50 ms consensus merge + foot refinement +
HRV on the main thread (cheap). Optionally run the motion gate in a 4th worker concurrently. **Must degrade
gracefully:** if `Worker` is unavailable (the headless `compute()`/test/equiv path, or a bundling
constraint) fall back to the serial in-thread path — the numeric result MUST be byte-identical either way
(workers are a scheduling optimisation, not a numeric change). Keep worker code inlined/blob-URL'd so the
standalone bundle stays single-file + offline (no external worker script, honoring the no-CDN rule).
**Done when:** on a `Worker`-capable browser the 3 channels detect concurrently and main-thread jank during
`analyze()` drops; `Dex-Test-Suite.html` (which runs headless) hits the serial fallback and stays green
with identical numbers; the bundle remains one offline file.

## §3 (FIDELITY) — gate whole-record HRV on coverage/SQI so a 56 %-analyzable night can't publish 137 ms RMSSD
**Finding.** `hrv.time.{rmssd,sdnn,pnn50}` and `poincare` are emitted as absolute whole-record scalars
regardless of how sparse/corrected the series is. With 19 % missed beats + 36.4 % median-fill the numbers
are artifacts, but they ship at face value and (via the RICH export) feed the Integrator's consensus axis
against ECGDex's TRUE 37.4 ms — a silent 100 ms disagreement the fusion layer can't see is spurious.
**Change.** When coverage is low (propose: `analyzablePct < 60` OR `correctionRatePct > 20`), either (a)
withhold the whole-record short-term HRV (emit `null` with a `windowNote` reason, mirroring the tier-gating
already in `analyze()`), or (b) keep the value but stamp a `lowConfidence:true` + reason field the
Integrator down-weights — matching how ECGDex already caveats a borderline `meanSQI`. Pick one and apply it
consistently to `hrv.time`, `hrv.poincare`, and `hrv.frequency`. **Done when:** the reference night no
longer publishes an unqualified 136.8 ms RMSSD; a clean short PPG session (high `analyzablePct`) is
BYTE-IDENTICAL to today (the gate is inert on good data).

## §4 (FIDELITY) — tighten / justify the PPI acceptance band feeding RMSSD
**Finding.** `correctRR` uses `PPI_ECTOPY_THR = 0.30` (vs 0.20 for ECG/RR). ±30 % of a 1264 ms mean is
**±380 ms of beat-to-beat jitter that passes uncorrected** and pumps RMSSD/SD1/pNN50/HF directly. The
0.30 is a documented, deliberate ectopy-rejection choice (soft optical PAT jitter > R-peak jitter) — the
issue is that the SAME loose band that (correctly) avoids over-rejecting also lets sub-30 % optical jitter
straight into the short-term metrics.
**Change.** Decouple the two jobs: keep a loose band for *ectopy/gap rejection* (don't over-reject), but
apply an additional *robust jitter measure* (e.g. compute RMSSD on the SQI-clean subset only, or a
Kubios-style additional pass) so the published short-term HRV reflects only high-SQI adjacent beats. Do
NOT silently change `PPI_ECTOPY_THR` alone — that would churn every downstream metric with no principled
target. This §pairs with §3: §3 gates when coverage is poor, §4 improves the number when coverage is OK.
**Done when:** on a clean PPG segment RMSSD lands within a sane multiple of the paired ECG/PPI RMSSD (the
`env.equiv`/device-PPI validation lane is the check); document the final rule inline like the existing
`PPI_ECTOPY_THR` comment.

---

## Gates & re-bundle (mandatory — §1–§4 all touch `ppgdex-dsp.js` behavior)
1. Edit `ppgdex-dsp.js` (+ `PpgDex.src.html` if wiring changes); **re-bundle `PpgDex.html`**.
2. Let the build settle, RE-READ the new `manifestHash`, hand-update PpgDex's entry in
   `BUILD-MANIFEST.json` (GATE A hard-fails on stale).
3. Because §1/§3/§4 MOVE the PpgDex export content, **regenerate PpgDex fixtures** by re-running the app on
   its committed inputs and re-exporting (NEVER hand-edit), then re-record `{manifestHash, inputHashes,
   outputHash}` in `FIXTURE-PROVENANCE.json`.
4. `Dex-Test-Suite.html?full` all-green — wait for the group count to settle; the PpgDex `env.equiv` leg
   MUST reproduce the new export. `verify-provenance.html` GATE A + GATE B green (`__provenanceOK===true`).
5. Stamp `Status: DONE — <date>` in this header only once both gates are re-confirmed. Spawn
   `PPGDEX-BEAT-DETECTION-PERF-AND-HRV-FIDELITY-FOLLOWUPS-2026-…-BRIEF.md` for anything discovered during
   execution (period-stationarity edge cases, the §4 jitter-measure choice), or note "nothing surfaced".

## §5 (FIDELITY + FEATURE) — 3-LED consensus SQI and its agreement graph
**Finding.** The Polar Sense streams three optical channels (ch0/ch1/ch2 — three photodiode/LED paths).
Today `pickChannel` keeps the single best-SNR channel and **discards the other two**, throwing away a free,
independent confirmation of every beat. A beat all three LEDs agree on is high-confidence; a beat only one
LED sees is almost always motion or poor perfusion. This is the optical analog of ECGDex's two-detector
**bSQI**.
**Change.** With §1 already detecting on all three LEDs (in parallel, §2b), add a **3-LED consensus**: a beat
is *confirmed* when ≥ 2 of 3 channels place a systolic peak within ±50 ms; count agreement per beat (1/3,
2/3, 3/3). Fold this into per-beat SQI (`beatSQI`) as a new multiplicative axis — a 1/3 beat is heavily
down-weighted, a 3/3 beat is boosted — which directly feeds the §3/§4 gating (fewer false beats survive into
the HRV series). Expose a per-5-min **`ledAgreementPct`** (mean fraction of channels agreeing) on
`timeseries.epochs[]` and a whole-record scalar in `quality`.
**Graph (render).** Add a **3-LED agreement ribbon** to `ppgdex-render.js` (hand-rolled inline-SVG, the
existing chart idiom): x = clock/tMin, a stacked band per epoch showing the 3/3 (green) · 2/3 (amber) · 1/3
(red) beat fractions, with the winning-channel index annotated. It sits beside the motion ribbon so a user
sees at a glance where the optical signal was trustworthy vs where only one LED carried it. **Done when:**
`quality.ledAgreementPct` + per-epoch `ledAgreementPct` are in the export; the ribbon renders from real
per-channel beat sets; on the reference night the low-agreement spans line up with the high
`correctionRatePct` / low-`analyzablePct` windows (the graph should visibly explain the bad HRV). Old
single-channel exports (no per-channel data) degrade to a hidden ribbon, not an error.
*(Note: three-cornered-hat error attribution across the three LEDs was considered and REJECTED — motion is
common-mode across co-located LEDs, which TCH cancels by construction. The well-posed TCH is cross-node
at the fusion layer: `INTEGRATOR-THREE-CORNERED-HAT-2026-07-02-BRIEF.md`. Intra-module accuracy comes from
ACC-referenced cancellation, not a hat over the LEDs.)*

## Scope guard
§2 must not change the reference channel. §2b workers must be a pure scheduling optimisation — numbers
byte-identical to the serial fallback, bundle stays one offline file. §3 must be inert on clean data. §4
must not change `PPI_ECTOPY_THR` in isolation. §5's consensus feeds SQI but must not touch the Ganglior
event schema. All PpgDex-only — do NOT touch ECGDex, the shared `parseTimestamp` (Clock Contract mirror),
or the Ganglior event schema.
