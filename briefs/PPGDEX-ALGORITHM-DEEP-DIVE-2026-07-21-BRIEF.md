<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-07-21 (**§4 #4 row-atomic column validation and #12 the hardware comment are EXECUTED**; **#3 WITHDRAWN** — verified already fixed by DEEP-AUDIT-II §8.1 before implementing. Remaining items unexecuted.) · **Created:** 2026-07-21

# PpgDex optical algorithm — deep dive, ECG-validated baseline, and the ranked change list

> **What this brief is.** A full-stack review of how PpgDex processes the Polar Verity Sense raw optical
> stream (3 green LED pairs + ambient, ~176 Hz), settled against (a) the manufacturer's own documentation
> and hardware, (b) the peer literature, and (c) **20 nights of paired chest-ECG ground truth measured on
> this corpus**. It supplies the numbers the earlier PPG briefs asserted without measurement, and it
> **refutes two of them**. Every claim below is tagged `[POLAR]` (manufacturer doc / staff / datasheet),
> `[LIT]` (peer literature, author·year·venue·DOI), `[CORPUS]` (measured here), `[CODE]` (read from
> source), or `[OPEN]` (not established).
>
> **Reading order:** §1 settles the hardware (kills several proposals outright), §2 gives the measured
> baseline, §3 is the refuted list — read it before proposing anything — §4 is the ranked change list,
> §5 the acceptance gates.

---

## 0 · Relationship to the existing PPG briefs

- **`PPGDEX-MULTICHANNEL-FUSION-2026-07-18-BRIEF.md`** — its executed **§4 (degenerate-channel guard)
  stands and is correct**. Its **unexecuted Phases 1–2 (ambient subtraction, linear channel combining)
  are REFUTED by measurement** — see §3.1 and §3.2. That brief's premises were partly mismeasured: it
  reports cross-channel *r* 0.62–0.68, this corpus measures **0.95–1.00 in the pulse band at zero lag**
  (§1.2), and the Lee'18 SVD-fusion result it leans on was obtained on a different sensor geometry. Do
  not execute Phases 1–2 as written.
- **`PPGDEX-OPTICAL-DETECTOR-AND-SIGMA-REDERIVE-2026-07-11-BRIEF.md`** — the cadence-adaptive refractory
  it introduced is **vindicated** and is the single most valuable thing in the DSP (§2.3).
- **`PPGDEX-BEAT-DETECTION-PERF-AND-HRV-FIDELITY-2026-07-02-BRIEF.md`** — the TERMA cutover stands; the
  detector is at the top of the field and is **not** the bottleneck (§3.4).
- Papers produced from this work: `papers/ppg-ecg-hrv-validation.html` (Draft v2) and
  `papers/ppg-quality-gate-pooling.html` (Draft v1).

---

## 1 · What the hardware actually is (settled)

### 1.1 Three green LED *pairs*, one photodiode — not three wavelengths, not three photodiodes

Four independent Polar staff statements in the official SDK tracker, plus the regulatory photographs:

- erkki-silvola, `polarofficial/polar-ble-sdk` issue **#52** (2019-12-30), answering "OH1 has six LEDs and
  only one photodiode, why three values?": *"The three separate values are LED pairs."* `[POLAR]`
- JOikarinen, issue **#188** (2021-10-11): *"OH1 and Verity Sense have both three PPG channels and one
  ambient channel"* and *"Opposite leds form a pair"*. `[POLAR]`
- jimmyzumthurm, issue **#445** (2024-03-04): *"Verity Sense has 3 pairs of green LEDs used for PPG signal
  sampling, so 3 channels in total and the fourth one is ambient."* `[POLAR]`
- andYgnite, issue **#671** (2025-08-06): *"All 3 PPG channels are using green light. There are no other
  wavelengths in Verity Sense."* `[POLAR]`
- **FCC ID `INW4J`** (Polar Electro Oy, model 4J = Verity Sense) internal photographs show six LED packages
  in a hexagon around a single central photodiode die, with a moulded light-blocking frame. FCC `INW2L`
  (OH1) is the identical topology. `[POLAR]`
- Wavelength ≈ **520 nm green** — Polar patents US9179849, US9314174, US9629562 specify green LEDs
  *"preferably 520 nm"*. `[POLAR]`

**Consequence — permanently rejected, do not propose:** SpO₂ / ratio-of-ratios, CHROM, POS, PBV,
multi-wavelength ICA, and any dual-wavelength motion-cancellation scheme. They require ≥2 wavelengths,
which this device does not have.

**Also rejected on structure:** a three-cornered hat over ch0/ch1/ch2. Motion is common-mode across
co-located same-wavelength paths, so TCH cancels it *by construction* and returns false confidence.
(This is the same trap `PPGDEX-MULTICHANNEL-FUSION` §6 correctly identified for ECG-agreement selection.)

### 1.2 The three channels are near-identical — measured

On this corpus: pairwise pulse-band correlation **0.95–1.00** at **exactly zero lag** (every lag estimator
within ±1 sample of zero), near-identical perfusion index (0.24 / 0.24 / 0.22 %), near-identical
cardiac/noise band-power ratio (211 / 210 / 213), DC agreeing within ~13 %. A green/red/IR triple would
show DC differing by multiples and AC/DC differing 3–5×. `[CORPUS]`

### 1.3 Ambient is a raw LEDs-off sample and is NOT pre-subtracted

TI AFE44xx-class 3-LED mode runs four phases per pulse-repetition period (LED2 → LED3 → LED1 → ambient);
in that mode the ALED2 slot is consumed by LED3, so there is **no on-chip difference register for LED3 at
all** — a host wanting ambient correction on all three LEDs must read four raw phases and subtract in
firmware, which is exactly the 4-tuple Polar streams. `[POLAR]` Confirmed empirically three ways: the
HF-band channel↔ambient correlation is **positive** (+0.24…+0.34, where on-chip subtraction would force
it strongly negative); ambient sits **152k–169k counts below** every LED channel rather than near them;
and on a real lights-on flicker episode the ambient→LED transfer gain is **1.008–1.011 at coherence
0.96**, i.e. ambient enters the LED slots at **unity gain**. `[CORPUS]`

### 1.4 Sample rate, wire format, and the empty vendor files

- **fs = 176.35–176.42 Hz, genuine.** Median Δ 5.6690–5.6706 ms, spread ±370 ns over 4.5 M samples, **zero
  gaps/duplicates/reordering**. A Welch PSD across 22–35 Hz shows no cliff at 27.5 Hz, refuting the "SDK
  reports 55 Hz" claim (andYgnite #844) — that governs *normal* mode. `[CORPUS][POLAR]`
- **Wire format:** PMD PPG frame type 0 = 12 bytes/sample, 4 channels × 3 bytes, signed 24-bit
  two's-complement little-endian; `RESOLUTION=0x16` = 22 ADC bits, full scale ±2,097,152. Largest observed
  |sample| is 650,983 = 31 % of that bound, so a saturation guard is a firmware-change alarm, not a routine
  event. Note `0x01` is the PMD *measurement type* (PPG), **not** the frame type. `[POLAR][CORPUS]`
- **The all-zero `_HR.txt` and header-only `_PPI.txt` are documented, not a bug.**
  `documentation/products/PolarVeritySense.md`: *"PPI online stream or offline recording is not supported
  in SDK MODE"*, and the same row for HR. Streaming raw PPG forces SDK mode. Deriving HR from the waveform
  is the only option, not a workaround. This confirms the `CLAUDE.md` §🎙️ honest-HR rule. `[POLAR]`
- **ACC is 25.84 Hz on all 53 files** in this corpus (the 26 Hz setting), never the 52 Hz assumed. `[CORPUS]`

### 1.5 Autogain is real

Polar confirms an automatic LED-intensity control producing abrupt DC level shifts: JOikarinen, issue
**#152** (2021-04-27), after consulting the PPG engineers — *"the reason seems to be a level change by
autogain algorithm that keeps the signal at a desired level… one can implement a high pass or a step
filter or just ignore the first seconds"*. Polar describes it as principally a start-of-measurement
effect. `[POLAR]` Measured here: **39 steps in one night on ch0**, magnitudes 6k–33k counts against a
pulse AC of ~1.2k, i.e. 5–25× the signal. `[CORPUS]`

### 1.6 Open

**Whether the per-phase OFFDAC currents are equal.** TI §8.3.3 allows them to differ per phase; if they do,
`ch_k − amb` retains a per-channel additive offset. Measured zero-light intercepts spread ±55k on a ~150k
signal. **Consequence:** an ambient-referenced perfusion index is a valid *within-channel, within-night*
trend and a 2–3× correction to a currently-wrong absolute number, but is **not absolutely calibrated**.
Resolvable by a deliberate occlusion ramp to zero perfusion. `[OPEN]`

---

## 2 · The measured baseline (20 paired ECG nights)

Corpus: 26 nights with simultaneous full-night raw Verity PPG and Polar H10 raw ECG started within seconds
of each other (`Ecg nightly/`); 20 yield a paired analysis — **1,477 five-minute epochs, 121.5 h**. ECG
reference is Pan–Tompkins with sub-sample parabolic refinement, validated at **0.244 ms** residual jitter
against template cross-correlation and **0.47 ms** median interval agreement against the H10's own RR
file. `[CORPUS]`

| Quantity | Median | IQR | Range across nights |
|---|---|---|---|
| Beat sensitivity | **1.0000** | 0.928–1.000 | 0.609–1.000 |
| Beat PPV | **1.0000** | 0.937–1.000 | 0.610–1.000 |
| PPI jitter (sd) | **5.92 ms** | 3.98–10.61 | 3.02–48.80 |
| PPI MAE | 3.94 ms | 3.00–6.00 | 2.25–39.95 |
| PPI bias | +0.01 ms | — | −0.62–+0.37 |
| rMSSD bias | **+4.24 %** | +1.83–+6.85 | −1.1–+118.9 |
| SDNN bias | +2.46 % | +1.15–+3.76 | +0.14–+63.0 |

### 2.1 rMSSD error is fiducial jitter and essentially nothing else

`rMSSD²_ppg = rMSSD²_ecg + k·σ²` fits at per-night **R² = 0.964** (IQR 0.937–0.989) with **k = 2.39**
(IQR 1.79–2.85), against a theoretical `k ∈ [2,6]` — near the lower end, as a foot-to-foot construction
predicts since each foot enters two intervals. Catastrophic epochs (|ΔrMSSD| > 25 %; **10.6 %** of the
corpus) are simply high-jitter epochs: median jitter 35.0 ms vs 5.5 ms, with 91 % exceeding 15 ms against
7 % of the rest. `[CORPUS]`

**The design budget therefore inverts in closed form:** σ ≤ **3.51 ms** → 1 % bias; ≤ **4.98 ms** → 2 %;
≤ **6.11 ms** → 3 %; ≤ **7.93 ms** → 5 %. Current operating point **5.92 ms**. *Every* accuracy proposal
must be scored as "how many ms of jitter does it remove", or it is not addressing the error.

### 2.2 Alignment methodology (required for any future ECG-referenced work)

A **single global affine time map fails** and fails deceptively: it yields a physiologically impossible
−1 ms pulse-transit time and an apparent beat F1 of **0.26**, while the same data restricted to 20 minutes
matches at **1,244/1,245 beats with residual sd 8 ms**. Two independent BLE crystals do not drift at a
constant rate and PTT itself wanders. **Align per epoch**: coarse lag by instantaneous-HR cross-correlation
(no periodicity at the beat interval ⇒ cannot alias by a whole beat), local refinement, ±75 ms one-to-one
matching. Measured drift ~5.75 ppm, PTT ~165 ms. `[CORPUS]` Consistent with
`papers/wearable-clock-drift.html` and `PAT-FEASIBILITY-2026-07-08-BRIEF.md`.

### 2.3 What the current implementation gets right — do not "fix" these

- **The cadence-adaptive refractory** (`SUBH_FRAC`, `REFR_CADENCE_FRAC`) is the best thing in the file. It
  took four nights from a 1.90–2.19× doubled HR to within 1.2 bpm of chest ECG. `[CORPUS]`
- **The 3-LED event-level consensus** (≥2 of 3 within ±50 ms, 1-of-3 dropped as a gap, never median-filled).
- **The intersecting-tangent foot** — measured best-in-class on this device (§3.3).
- **Dropping rather than interpolating** 1-of-3 beats.

---

## 3 · REFUTED — measured negative results, do not re-propose without new evidence

### 3.1 Waveform-level fusion of the three channels — REFUTED

Out-of-sample (weights fit on one window, scored on the next), relative to selecting the best single
channel: **mean-of-3 0.95×, PCA-1 0.95×, max-SNR GEV beamformer 0.97×**. In-sample the beamformer appears
to win (1.03×) — that is overfitting. On the endpoint that matters, foot-to-foot PPI sd: **158.9 ms (ch0
alone) vs 163.7 (mean-of-3) and 164.3 (GEVD)**. The GEV weight vector collapses to `[0.0006, 0.0397,
−0.9992]` — it rediscovers channel selection, minus 5 %. `[CORPUS]`

**Why the √3 argument fails:** it assumes independent noise. The *noise-band* inter-channel correlation is
ρ = 0.942–0.987, giving `10·log10(3/(1+2ρ)) = 0.16 dB`, not 4.77 dB. `[CORPUS]` Polar's own guidance is
single-channel (jimmyzumthurm, #445). `[POLAR]`

*Residual open question:* fusion has been scored on SNR and on PPI sd, both losing. One dossier
measurement scoring *timing* on a much weaker detector favoured fusion; it may only show that fusion
rescues a weak detector. If ever revisited, score on **PPI jitter with the shipped detector**, nothing else.

### 3.2 Ambient subtraction and ambient-as-SQI, overnight — REFUTED

Ambient's within-minute std is a **hardware constant**: 34.66–35.16 counts across **all 53 non-daylight
sessions** (a 0.6 % spread). It has no overnight dynamic range, so it cannot function as a signal-quality
index at night, and subtracting it costs ~0.5 % SNR (hurts >2 % in 34 % of windows). Apparent gains
(1.21× median) come **only** from daytime/exercise files — chiefly `…20260620_181256`, which is not the
overnight use case. `[CORPUS]`

Retained as *insurance only*: a gated 1:1 subtraction (β = 1.0 per §1.3) that fires only above a hard
absolute ambient-AC threshold. Verify it fires on **zero** epochs across all paired nights before merge.

### 3.3 Changing the fiducial point — REFUTED on this device

Peralta et al. 2019 rank the middle-amplitude point (nM) above the tangent-intersection point (nT) in
supine — *Optimal fiducial points for pulse rate variability analysis from forehead and finger
photoplethysmographic signals*, Physiol Meas 40(2):025007, PMID 30669123,
[DOI 10.1088/1361-6579/ab009b](https://doi.org/10.1088/1361-6579/ab009b) — with supine P_HF relative error
nM 6.56 % vs nT 23.91 % (forehead). `[LIT]` **The ranking inverts here**, measured against ECG on 1,943
beats: `[CORPUS]`

| fiducial | jitter sd | MAE | ΔrMSSD |
|---|---|---|---|
| **intersecting tangent (shipped)** | **4.44 ms** | **3.56** | **−1.20 %** |
| middle-amplitude nM | 5.02 | 3.75 | −3.58 % |
| foot + parabolic | 5.32 | 3.98 | −0.89 % |
| max 1st derivative (n′A) | 6.44 | 6.32 | +2.33 % |
| max 2nd derivative | 7.42 | 7.53 | +7.45 % |
| systolic peak | 38.04 | 32.64 | +124 % |
| matched-filter xcorr | 40.85 | 34.18 | +142 % |

Both source papers close by stating the ranking is morphology- and site-dependent and must be re-derived
per site; neither tested the upper arm, green light, or 176 Hz. Peláez-Coca et al., IEEE JBHI
26(2):539–549 (2022), PMID 34310329, [DOI 10.1109/JBHI.2021.3099208](https://doi.org/10.1109/JBHI.2021.3099208)
does not evaluate nT at all and explicitly does not recommend plain nM below 250 Hz. `[LIT]`
**Any fiducial proposal must beat 4.44 ms measured, or it is refuted.** Note also that the tangent is
already **continuous** (fractional crossing), so quantisation contributes **0 ms** and raising fs buys
nothing — detector localisation noise is 2.7× the grid floor. `[CORPUS][CODE]`

### 3.4 Swapping the beat detector — not justified

Charlton et al., *Detecting beats in the photoplethysmogram: benchmarking open-source algorithms*,
Physiol Meas 43 (2022), [DOI 10.1088/1361-6579/ac826d](https://doi.org/10.1088/1361-6579/ac826d), ranks
MSPTD and qppg at the top. `[LIT]` But MSPTDfast v.2's published F1 is **statistically indistinguishable**
from the shipped TERMA on wearable-at-rest data, and our measured baseline is already sensitivity 1.0000 /
PPV 1.0000. There is no headroom to buy. `[LIT][CORPUS]`

### 3.5 Per-epoch adaptive channel selection — weak, deprioritised

A fixed whole-night reference loses >10 % SNR vs the per-window oracle in 18 % of windows; per-window
re-picking cuts that to 8.5 %. But the best-vs-second channel SNR margin on a good night is **0.03 %**
(3.025 vs 3.024), and switching the reference mid-record risks a step discontinuity in the PPI series at
each switch. Keep a **fixed** reference; improve only *how* it is chosen (§4 #6). `[CORPUS]`

### 3.6 Deep learning — not viable at the runtime boundary

The runtime is plain browser JS, deterministic, no network, weights inlined as source constants. No
published pretrained PPG model meets that under a permissive licence at a size that is inlineable. If a
data-driven component is ever wanted, the defensible form is a small logistic / gradient-boosted per-beat
SQI trained offline against this ECG corpus and shipped as a dozen coefficients — not a network. `[LIT]`

---

## 4 · Ranked change list

Ordered by gain ÷ cost. **★ = do first.** Sites are `ppgdex-dsp.js` unless stated.

| # | Change | Site | Expected gain | Risk | Confidence |
|---|---|---|---|---|---|
| **1 ★** | **Odd-reflected padding in `filtfilt`** (PAD = 3·fs/f_hp) + subtract record median. Currently there is **no padding at all** (`return reverse(applyBiquad(reverse(applyBiquad(x,c)),c))`). | `:142-144` | Repairs five surfaced numbers at once: terminal spurious beat 2→0; `orient` skew 65×→1×; `std(bp)` 6.18×→1×; `channelSNR` 2.92→10.9–21.0; first-window cadence 33.6→52 bpm | **Moves every fixture**; `env.equiv` PPG leg reds by design. Interior samples change <1e−6 | Very high |
| **2 ★** | **`buildPPI` gap flag; `correctRR` EXCLUDES, never fills.** Today rejected intervals are replaced by a running median of the last 7 accepted — a fabricated value that then flows into `nn`, SDNN, LF/HF, DFA-α1, SampEn, CVHR, epochs and `contentId`. | `:1116`, `:1149-1153`, `:1917`, `:2116` | At the file's own 28.8 % correction rate, ~29 % of the exported series stops being a constant. DFA-α1 falls and SampEn rises on degraded nights — that is the bias being removed | Low on clean data; large and *correct* on degraded | Very high |
| ~~3~~ | ~~Multi-session export shape fix~~ — **WITHDRAWN 2026-07-21, the claim was stale.** `integrator-dsp.js` already carries a `MULTI_CARRIERS` table matching all three fleet spellings (`nights`/`multiNight`, `recordings`/`multiRecording`, `sessions`/`multiSession`); DEEP-AUDIT-II §8.1 fixed exactly this bug. Verified in source before implementing. **No action.** | — | none | — | — |
| 4 | **`isFinite` on ch1/ch2/amb, row-atomic drop** | `:269-278` | Closes a silent 3-LED→2-LED degradation that reports `ledAgreementPct: 67`, zero peaks, and no error | None; byte-inert on clean captures | Very high |
| 5 | **ACC: per-file fs, sensor-ns join, overlap assert** | `:1811` | Removes a 2× rate error (25.84 vs assumed 52 Hz) and a 3.5–4.2 s (~600-sample) motion-gate misregistration | Low; motion gates shift where they were wrong | Very high |
| 6 | **Whole-night channel scoring (p25 aggregate), still one fixed reference** — replaces the single ~90 s mid-record window that currently decides for the whole night | `:380-435` | Removes a 1-in-85 single-point-of-failure; changes the pick on 2 of 8 nights | Reference identity changes ⇒ downstream moves on those nights. **Land separately from #1** | High |
| 7 | **Ambient-referenced perfusion index**, genuinely per-epoch | `:2121-2123`, `morph:263,289-303` | 2.0–3.4× correction to an exported number; PI becomes able to show posture/occlusion | Surfaced number changes 2–3.4×; docs must move with it | High on direction, medium on absolute calibration (§1.6) |
| 8 | **`morph.pre` 0.15 → 0.50 s** (or feed it `det.feet`) | `ppgdex-morph.js:39` | `riseTimeMs`/`crestTimeMs` stop being pinned to the window (147.4 ms ceiling vs 296 ms true); fixes `augmentationIndexPct`, `reflectionIndex`, SDPPG a-wave | Isolated to one node — cheapest gate in the list | Very high |
| 9 | **Autogain step detect + repair before filtering** — 39 steps/night at 5–25× pulse AC, and `filtfilt` is zero-phase so ringing propagates **both** directions in time | `:730` pre-filter | Removes bidirectional ringing artefacts around each step | One verifier measured net benefit ≈ 0; **measure before merging** | Medium — gated on E-3 |
| 10 | **Centred TERMA moving averages** + symmetric search window | `:827-836`, `:656` | `movavg` is trailing, so W1/W2 impose 57 ms / 335 ms group delay; Elgendi specifies centred | Peak times shift by a near-constant; foot spine largely insulated | High |
| 11 | **Epoch validity by time + per-band minimum durations** | new | Converts "we computed rMSSD" into a bounded claim; stops silently reporting boundary-limited HF | Some nights emit `null` where they emitted a number — correct, but consumer-visible | Very high |
| 12 | **Fix the `:161` comment** — it says *"three co-located photodiodes"*; it is **one** photodiode and three LED pairs, and the site is the upper arm, not the wrist | `:161` | Documentation correctness (§1.1) | None | Very high |

**Landing order** (one gated change at a time per `CLAUDE.md` §👥.3):
`4 ✅ → 12 ✅ → 8 → 1 → 6 → 7 → 2 → 10 → 5 → 11 → [9 experiment]` *(#3 withdrawn; #4 and #12 SHIPPED 2026-07-21, mutation-verified both directions, real-corpus equiv leg reproduces byte-identical)*

---

## 5 · Acceptance / Done-when

- **Primary endpoint: PPI jitter sd**, measured against paired H10 ECG using the §2.2 per-epoch alignment,
  reported as the median across ≥10 nights with its IQR. A change that does not move jitter, coverage, or a
  *correctness* defect is not worth its fixture churn.
- **No change may raise** median jitter above 5.92 ms or lower median beat sensitivity below 1.0000.
- **Gate cost per `ppgdex-dsp.js` edit** (`CLAUDE.md` §🧪, §🔏, memory `tepna-three-stage-build`):
  `node tools/build.mjs --app PpgDex`, then `build-analysis.mjs` **and** `build-docs.mjs` (orchestrators,
  analysis and docs all inline the DSP — skipping these reds the CI drift guards), `npm run typecheck`,
  `biome format --write` on the whole changed file, `Dex-Test-Suite.html?full` all-green, fixture
  regeneration, `verify-provenance.html`. The `env.equiv` PPG leg **will** red for #1, #2, #6, #7, #10 —
  regenerate **all** PpgDex fixtures, not just the named one.
- **Export-inertness is computed, never asserted** (`CLAUDE.md` §🔒): either `computeHash` did not move
  (give the hash) or re-verify with `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs`.
- **Drop a changeset** as the last action (`changes/README.md`).

## 6 · Open experiments

- **E-1** — does foot-domain consensus (feet on all three channels, de-offset, ±40 ms) recover the 1-of-3
  drop rate without admitting false beats? PPV@75 ms must not fall. Blocking for any consensus rework.
- **E-2** — does autogain step repair (#9) move jitter at all? One measurement says no.
- **E-3** — re-score waveform fusion on **PPI jitter with the shipped detector** (§3.1 residual).
- **E-4** — occlusion ramp to zero perfusion, to resolve the OFFDAC question (§1.6).

## 7 · References

1. Polar Electro. `polarofficial/polar-ble-sdk` issues #52, #152, #188, #445, #648, #671, #844;
   `documentation/products/PolarVeritySense.md`; Polar Measurement Data specification. `[POLAR]`
2. FCC IDs `INW4J` (Verity Sense) and `INW2L` (OH1) — internal photographs and test reports. `[POLAR]`
3. Polar Electro patents US9179849, US9314174, US9629562 — green optical heart-rate measurement. `[POLAR]`
4. Texas Instruments AFE4404 (SBAS689D) / AFE4900 datasheets — 3-LED mode phase structure, OFFDAC. `[POLAR]`
5. Peralta E, Lázaro J, Bailón R, Marozas V, Gil E. Optimal fiducial points for pulse rate variability
   analysis from forehead and finger photoplethysmographic signals. *Physiol Meas.* 2019;40(2):025007.
   PMID 30669123. [DOI 10.1088/1361-6579/ab009b](https://doi.org/10.1088/1361-6579/ab009b) `[LIT]`
6. Peláez-Coca MD, Hernando A, Lázaro J, Gil E. *IEEE J Biomed Health Inform.* 2022;26(2):539–549.
   PMID 34310329. [DOI 10.1109/JBHI.2021.3099208](https://doi.org/10.1109/JBHI.2021.3099208) `[LIT]`
7. Charlton PH, et al. Detecting beats in the photoplethysmogram: benchmarking open-source algorithms.
   *Physiol Meas.* 2022;43. [DOI 10.1088/1361-6579/ac826d](https://doi.org/10.1088/1361-6579/ac826d) `[LIT]`
8. Elgendi M. On the analysis of fingertip photoplethysmogram signals. *Curr Cardiol Rev.* 2012;8(1):14–25
   (TERMA). `[LIT]`
9. Task Force of the ESC/NASPE. Heart rate variability: standards of measurement, physiological
   interpretation and clinical use. *Circulation.* 1996;93(5):1043–1065. `[LIT]`
10. This work: `papers/ppg-ecg-hrv-validation.html` (Draft v2), `papers/ppg-quality-gate-pooling.html`.
