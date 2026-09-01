<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-09-01 · **Created:** 2026-08-12

> **TRIAGED 2026-09-01 — the root cause is FIXED; what remains is SEQUENCED behind a dependency, not buildable now.** §0 RESOLVED 2026-08-13: it was a polarity bug in `orient()`, and everything below it is downstream. §1b is RETRACTED — the rate finding *was* the polarity bug, and the refuted claim is retained only for the record. ⚠️ The three unchecked boxes are strictly ordered and the first gates the rest: the **PAT reference must be fixed** (medians inside 150–400 ms, pairing ≥95 % on both modes) *before* CFD can be re-scored against it, and only then can the residual 2.2–13.2 ms spread be explained. Re-scoring against an unfixed reference would produce a number that means nothing — so this is not three parallel items but one blocked chain.
>
>
> ✅ **BAR RE-STATED AND THE REFERENCE MEASUREMENT PASSES — 2026-09-01.** The original bar (*medians inside 150–400 ms, pairing ≥95 %*) is **SUPERSEDED**, for the two reasons recorded above: its lower half was unreachable through the instrument that would judge it, and the only near-ground-truth figures available were modes rather than medians. Cleared against published surfaces before changing (nothing quotes 150–400 or a median-PAT), so it stayed at tooling level.
>
> **The re-stated bar:** statistic = **MODE per night** via `tools/pat-window-oracle.mjs`; acceptance = verdict **SIGNAL RECOVERED** (the night beats its OWN per-night null) with the mode inside a **200–500 ms** sanity rail; PEP-inclusive by construction.
>
> **Measured — all four signal nights pass:**
>
> | night | mode | verdict |
> |---|---|---|
> | 2026-07-24 | 405 ms | SIGNAL RECOVERED |
> | 2026-08-12 | 315 ms | SIGNAL RECOVERED |
> | 2026-08-17 | 215 ms | SIGNAL RECOVERED |
> | 2026-08-18 | 355 ms | SIGNAL RECOVERED |
>
> Corpus tally across 29 scored nights: **4 SIGNAL RECOVERED · 20 PARTIAL · 5 NO RECOVERY**, plus 8 skipped as too-few-beats. ⚠️ **The acceptance is about the four named signal nights, not the corpus rate** — 4-of-29 is not a pass rate to quote, and the PARTIAL majority is the corpus's known character, not a regression.
>
> ⚠️ **Measured against #2034's HEAD (`c45551de`), not against `main`** — the re-stated acceptance is defined *under* that overlap split (the oracle had been splitting on the ECG's extent while scoring against the PPG), and #2034 was still open at measurement time. **These numbers are not reproducible from `main` until it lands.** Re-run after it merges before anything downstream cites them.
>
> **So the first box is MET**, and the chain's next link — re-score CFD against this reference — is unblocked.
>
> ✅ **RE-RUN FROM `main` + CFD RE-SCORED AND REJECTED — 2026-09-01.** The #2034-head caveat above is
> discharged: from post-#2034 `main` (`e0552bc7`) all four reference nights reproduce **exactly** —
> 07-24 405 · 08-12 315 · 08-17 215 · 08-18 355, all SIGNAL RECOVERED. The `main` corpus tally is
> **4 RECOVERED · 19 PARTIAL · 6 NO RECOVERY** (vs 4/20/5 at the #2034 head — one borderline
> null-margin night flipped; the reference is untouched).
>
> **The CFD re-score, against pre-stated bands** (adopt-candidate only if all four signal nights stay
> SIGNAL RECOVERED inside the 200–500 rail under CFD **and** paired per-night out-of-sample narrowSD
> improves on a majority of scored nights **and** corpus RECOVERED count does not drop):
> CFD (f=0.10, sub-sample interpolated, same consensus beats — `cfdTimes` in
> `tools/pat-matchrate-strict.mjs ppgFootTimes`, scored via `pat-window-oracle --fiducial cfd`)
> keeps all four signal nights RECOVERED in-rail (425 / 335 / 245 / 365 — the expected ~+10–30 ms
> later fiducial), but on the paired per-night narrowSD it is **worse on 16 of 29, better on 10,
> median ΔSD +0.1 ms**, and the tally is unchanged 4/19/6 (two offsetting borderline flips, 07-22 and
> 08-31, both at null-margin noise level). **Clause 2 fails ⇒ REJECT.** Against a reference the
> estimator cannot fool, CFD buys nothing over the shipping tangent foot — §3's non-adoption is now
> confirmed with the right reason, not just the polarity retraction. The chain's last open link is the
> residual 2.2–13.2 ms spread.
> 🔴 **SPEC-BLOCKED 2026-09-01 — the first box CANNOT BE EVALUATED AS WRITTEN, and the obstacle is the BAR, not the reference.** Two findings, both measured. **(1) The bar's band and the instrument's band disagree.** The bar asks for medians inside **150–400 ms**; `tools/pat-matchrate-strict.mjs` hard-filters lags to `>= PHYS_LO(200) && <= PHYS_HI(650)` (line 318), so **a median below 200 ms is unreachable by construction** — the bar's lower half cannot be evaluated at all, and the bar can only ever fail HIGH. Judging "is the median inside 150–400" with an instrument that cannot emit anything under 200 lets the window answer instead of the data (`pat-sd-is-the-window`). **(2) ⚠️ `pat-window-oracle`'s 405 / 215 ms are MODES, not medians — do not substitute them.** It takes a histogram mode over binned lags, estimated **out of sample on each night's first half** (`lagMode`); the bar asks for a median, and on a skewed censored distribution these are different statistics. Reading 405 ms as "the median, which fails the 400 bar by 5 ms" would be a wrong verdict reached by mixing two instruments.
>
> **NOT data-blocked:** the corpus is local and usable (`~/tepna-smoketest/captures`, 51 nights; both signal nights present with H10+Verity pairs). The bar needs re-stating against the instrument that will judge it — routed to the PAT layer, escalating to the owner if it touches a published number. Pre-stating a threshold is right; pre-stating one the instrument cannot evaluate is the failure mode underneath it.

# The PPG foot is measurable to ~1 ms on half the nights and ~13 ms on the rest — and we cannot yet tell which estimator is better

A 2026-08-12 sweep of the box corpus (20 Verity nights, 2026-07-16 → 08-04) measuring where the
systolic foot actually lands, prompted by a simple question: are the good nights the RECENT ones?

They are not. **The good nights are scattered, and the last three nights of the corpus are all bad.**
There is no drift, no learning curve, and nothing about the setup that visibly improved.

## 0 · 🔴 RESOLVED 2026-08-13 — IT IS A POLARITY BUG IN `orient()`, AND EVERYTHING BELOW IS DOWNSTREAM OF IT

**There is no bimodality, no vasoconstriction, and no rate effect. `ppgdex-dsp.js:orient()` picks the
WRONG SIGN on half the box corpus**, and every finding in §1–§3 is a symptom of that single defect.

It was found by *looking at the waveform* — an ensemble average aligned on the PEAK (the trustworthy
landmark; beat counts agree to <0.5 % across channels, so aligning on the foot would beg the question).
The two "modes" are not two qualities of the same shape. They are the same shape upside down:

| | good nights | bad nights |
|---|---|---|
| ensemble minimum | **t = −300 ms** (before the peak) | **t = +290…+320 ms** (AFTER the peak) |
| 10–90 % rise | **160 ms** | undefined — a ~1000 ms near-linear ramp |
| shape | sharp foot · fast upstroke · slow decay | slow ramp · sharp peak · fast fall = **a pulse inverted** |

**The proof is symmetric and complete.** `detectChannel(chan, fs, forceSign)` takes an override:

| night | auto | autoIQR | rise | forced −1 | rise |
|---|---|---|---|---|---|
| 07-27 (good) | −1 | 1.73 | 308 ms | 1.73 | 308 ms |
| 08-01 (bad) | **+1** | 25.67 | 853 ms | **2.27** | **290 ms** |
| 07-29 (bad) | **+1** | 26.22 | 1016 ms | **2.37** | **327 ms** |
| 08-03 (bad) | **+1** | 30.17 | 871 ms | **2.71** | **308 ms** |

Forcing `+1` on a GOOD night breaks it identically (1.73 → 26.29, rise 308 → 889). Two independent
predictions both land: the IQR collapses **and** rise time returns to the physiological ~300 ms upstroke.
Pairing counts go **UP** after the fix (30315→30389, 22548→22659), so it is not censoring.

### Corpus-wide

| | before | after forcing the physiological polarity |
|---|---|---|
| good (<5 ms) | 6 / 20 | **18 / 20** |
| bad (20–42 ms) | 8 | **0** |
| unmeasurable | 6 | **0** |
| worst night | 204.80 ms (70 beats paired) | **3.48 ms** (22 335 paired) |
| range | 1.59 – 204.80 | **1.59 – 7.65** |

`autoSign` is wrong on **10 of 20** box nights and on **0 of 22** phone nights.

**The six "UNMEASURABLE" nights were MIXED polarity across channels**, not defective recordings. 07-20's
pairs read 3.10 / 303.91 / 307.40 because channel 0 resolved to −1 and channels 1–2 to +1. Forced
uniform, it pairs 22 335 beats at 3.48 ms. Nothing was wrong with that recording.

### Why it fails, and why the existing safety net cannot catch it

`orient()` (ppgdex-dsp.js:824) infers polarity from the **skewness of the first derivative** — sound
reasoning (a fast upstroke and slow decay give positive derivative skew) but a THIRD MOMENT on a noisy
derivative, which flips under low-frequency contamination.

The consensus-polarity pass cannot save it. It acts only when a strict majority agrees **and at least
one channel dissents**, returning 0 for unanimous so it stays export-inert on consistent records. On
every bad night all three channels agree on `+1`. **Unanimously wrong is indistinguishable from
unanimously right to that rule** — the net is structurally blind to precisely this failure. It is also
why the error is COMMON-MODE, and therefore invisible to the inter-LED metric §3 leaned on.

### The fix: a physiological criterion, not a statistical one

> **The correct polarity is the one whose median foot→peak rise is SHORTER**, because the systolic
> upstroke is always faster than the diastolic decay.

No moment, no threshold, no amplitude term. On this corpus it returns −1 on **all 31 nights across both
trees** and produces every "after" number above. Not yet implemented — it is a `ppgdex-dsp.js` change
that re-bundles three build systems and MOVES EXPORTS, so it needs fixture regeneration and the full
gate as its own work-unit.

⚠️ **Residual variation survives the fix** (phone nights still span 2.2–13.2 ms). There is a second,
milder quality effect underneath — but it is not bimodal, and it is not what was wrecking the corpus.


## 1 · The measurement, and the audit that halved it

The metric is **inter-LED pairwise IQR**: three co-located LEDs, one clock, one pulse, so whatever
differs between them is detection error. `tools/pat-per-led.mjs` already argued this.

⚠️ **Six of the twenty nights are NOT MEASURED, and the first version of this sweep reported them as
if they were.** On 07-16, 07-20, 07-21, 07-25, 07-30 and 07-31, two of three channels sit >200 ms
apart, the pairing window rejects everything, and fewer than 70 beats of tens of thousands survive.
Their IQRs describe a handful of beats. The worst artefact was **07-20 reported at 204.80 ms and
"improved 98.7 % to 2.67 ms"** — both numbers came from one surviving pair while the others collapsed
to 27 paired beats. Neither figure means anything. **Always print the pairing count beside the IQR**;
this is the `PHYS`-censoring failure in a new costume.

On the **14 nights that pair ≥95 % of beats**, the shipped intersecting-tangent detector gives:

| good (≤3.3 ms) | | bad (≥20 ms) | |
|---|---|---|---|
| 07-17 | 1.59 | 07-26 | 20.45 |
| 07-27 | 1.73 | 08-01 | 25.67 |
| 07-22 | 1.88 | 07-29 | 26.22 |
| 07-24 | 2.17 | 08-03 | 30.17 |
| 08-02 | 2.47 | 07-28 | 33.61 |
| 07-19 | 3.27 | 07-18 | 35.92 |
| | | 07-23 | 37.63 |
| | | 08-04 | 41.68 |

**6 good, 8 bad, and NOTHING between 3.27 and 20.45.** A gap that clean is a switch, not a quality
gradient. Per-channel foot error is ≈0.9 ms in one mode and ≈13 ms in the other — a 14× swing.

**What does NOT explain the split**, each measured and refuted:

- **beat-doubling** — refuted on all 20 nights; channels agree on beat COUNT to <0.5 %, HR ratio ≤1.006
- **channel SNR** — refuted, and anti-correlated if anything: the two lowest-SNR nights (08-02, 07-31)
  are both GOOD, two of the highest (07-28, 08-01) are bad
- **one bad LED** — refuted; on bad nights all three pairs fail together and by the same amount
  (08-01: 25.47 / 25.71 / 25.83)
- **bistability / snapping between two candidate feet** — refuted; the difference distribution is
  unimodal and simply WIDE (good nights put 87 % of beats within 3 ms of the mode, bad nights 12.6 %)
- duration and heart rate — neither separates the groups

**The mechanism is still unknown.** That is the honest state.

## 1b · ⛔ RETRACTED 2026-08-13 — THE RATE FINDING WAS THE POLARITY BUG

> **This section is WRONG and is kept only so the error is not repeated.** The phone tree looked good
> because `orient()` never mis-fires on it (**0 of 22** nights), not because it samples at 176 Hz. The
> decisive number is WITHIN the box tree at ONE rate: of 19 nights at 55 Hz, `orient()` gets **10 wrong
> and 9 right**. Rate is constant across them, so rate cannot be the discriminator. The comparison below
> is cross-tree, its confound was flagged in the text, and I reasoned past it anyway.
>
> **`PPG-SAMPLE-RATE-AND-PAT` §3 therefore stands UNAMENDED: rate buys nothing.** The "reconciliation"
> below — that a decimation design cannot see which mode you land in — is also withdrawn; there are no
> modes to land in. §3's design was never the weakness this section claimed.

### (retained for the record) THE MODE IS PREDICTED BY SAMPLING RATE — the refuted claim

Splitting the corpus by capture provenance (asked 2026-08-12) separated it by **sampling rate** instead,
because the two trees differ in both: the phone tree (`Ecg nightly`, June) is natively **176 Hz**
throughout, the box tree (`tepna-smoketest/captures`, July–Aug) natively **55 Hz** except 2026-08-02.

| | n | good (<5 ms) | median IQR | trees |
|---|---|---|---|---|
| **55 Hz** | 13 | **5 (38 %)** | **25.67 ms** | BOX only |
| **176 Hz** | 37 | **32 (86 %)** | **2.66 ms** | BOX *and* PHONE |

**Provenance does NOT track the modes.** Every box night is `device+host`/`independent:true` (spread
434–2556 ms) and every phone night `device`/`independent:false` (spread 1.00 ms, the stamp quantum — the
phone's host column is device time rounded, exactly CLAUDE.md §7's band). Both modes occur inside the
box tree, and spread overlaps them completely: good nights at 517 and 731 ms sit either side of bad
nights at 434 and 793.

**The disambiguator is the one BOX night at 176 Hz** — 2026-08-02, **IQR 2.47 ms, GOOD**. Same tree,
hardware, period and capture stack as the 55 Hz nights around it; it behaves like the *rate* population,
not like its own tree. ⚠️ **n=1.** 36 of 37 high-rate nights are phone-captured and from June, so rate
stays confounded with tree, period and possibly band placement. It is the right control and it agrees,
but it is one night — a native-176 box night beside the existing 55 Hz ones would settle it.

### This RECONCILES `PPG-SAMPLE-RATE-AND-PAT` §3 rather than contradicting it

§3 measured residIQR **flat from 25→176 Hz** and concluded rate buys nothing. It worked by **decimating
one recording**. Decimating a good-mode night leaves it in good mode — the mode is a property of the
night, fixed before resampling — so a decimation study is *structurally incapable* of seeing an effect
that operates on WHICH MODE YOU LAND IN. Both results stand and they measure different things:

> **Rate does not improve a night you already have. It predicts whether you get a good one.**

Same shape as §2.1's error one level up: a within-unit measurement generalised to a between-unit claim.


## 2 · RETRACTION — `CROSS-DOMAIN-METHODS` §2's premise was measured on one night, and it was a bad one

§2 states the PPG foot at **12.7 ms σ** is now the dominant error term and is therefore what to attack
next. That figure came from a single night in the BAD mode. On good nights the foot is **≈0.9 ms** —
inside the PAT budget, and better than the 5.69 ms intersecting-tangent RMSE the literature supplied.
**The fiducial is not the bottleneck; it is the bottleneck on half the nights and a non-issue on the
other half.**

This also re-explains §2.1's template result, whose stated cause was wrong. The template was scored on
2026-08-11 at 55 Hz (18.78 ms, **bad mode**) against 2026-08-02 at 176 Hz (1.70 ms, **good mode**), and
the win/loss was attributed to SAMPLING RATE. Rate was confounded with mode. §2.1 already flagged the
11× as confounded without being able to name the confound — this is it.

## 3 · Constant-fraction discrimination: measured, NOT adopted

> ⚠️ **2026-08-13 — read §0 first. CFD's "gains" were measured on MIS-POLARISED nights.** A
> constant-fraction threshold on the inverted signal's long linear ramp is more stable than a tangent
> intersection on it, which is the whole −33 % on bad nights, and the −107 to −177 ms displacement was
> CFD sliding along that ramp. Once polarity is correct the nights it "fixed" are already at 2.3–2.7 ms.
> The decision not to adopt was right; the reason recorded below was not the real one.
>
> ✅ **2026-09-01 — re-scored against the oracle reference and REJECTED on that number** (see the
> header block): paired per-night out-of-sample narrowSD worse on 16 of 29 nights, median ΔSD
> +0.1 ms, corpus tally unchanged. The acceptance metric this time is the independent ECG (R→foot
> concentration), which point 1 below demanded and the inter-LED IQR could not provide. Closed.

From nuclear instrumentation: *time-walk* is the amplitude-dependent deviation of a measured
time-of-arrival that afflicts leading-edge discriminators, and an intersecting-tangent construction is
structurally one. A **CFD** triggers at a fixed fraction of each pulse's OWN peak and is
amplitude-independent by construction; digital CFD reaches sub-sample resolution by interpolating the
crossing, which is what 55 Hz needs.

Measured on the 14 valid nights, CFD at f=0.10 improves inter-LED IQR on **14 of 14**, median **−13 %**
(good nights −5 %, bad nights −33 %, best −65 %).

**It is NOT adopted, because that number does not survive verification:**

1. **The acceptance metric is blind to the failure mode.** Inter-LED agreement is COMMON-MODE across
   co-located channels, so an estimator that moves all three to a DIFFERENT feature improves it while
   being wrong. The metric can refute a self-consistent estimator; it cannot validate one. This was a
   hole in the reasoning, not only in the data.
2. **There is direct evidence of exactly that.** CFD−tangent shift is **+8 ms (IQR 1–2 ms)** on good
   nights but **−107 to −177 ms (IQR 60–137 ms)** on bad ones. A displacement that large is a different
   feature — and the bad nights are precisely where the gains are.
3. **The independent ECG test is inconclusive** (§4).

`AIC onset picking` — the dominant method in seismic phase picking and ultrasonic NDT — is a confirmed
**negative** across all 20 nights (8.46–42.29 ms, never competitive). It detects a step emerging from
noise; a pleth foot is a smooth curvature change with no onset to find. Recorded so it is not
re-derived.

## 4 · 🔴 THE BLOCKER — PAT against the H10 is mis-referenced on the box corpus

Scoring a fiducial needs a reference the estimator cannot fool. PAT = foot − preceding R-peak should
be **150–400 ms** for arm PPG. Measured, on the host-disciplined ECG axis (`tMsAt`):

| night | tangent med / IQR / paired | CFD med / IQR / paired |
|---|---|---|
| 07-27 (good) | 457.0 / 89.5 / 99.2 % | 465.2 / 90.8 / 99.2 % |
| 07-18 (bad) | 903.9 / 76.7 / 95.6 % | 749.6 / 67.8 / 99.8 % |
| 08-01 (bad) | 766.3 / 184.3 / 79.3 % | 646.9 / 270.6 / 94.7 % |
| 08-03 (bad) | 857.8 / 854.1 / 45.0 % | 845.0 / 139.4 / 89.2 % |

**750–900 ms is impossible physiology**, and even the good night's 457 ms is high. Something —
an unmodelled inter-device offset, or R-peak misdetection — sits underneath every number here. A
bounded-median test cannot work when the baseline is already outside the bound.

The pairing rates then make the IQRs mutually incomparable: tangent pairs 45–99 % of beats, CFD
89–99.8 %, each IQR computed over a different subset. On 08-03 CFD pairs **twice** as many beats and is
**six times** tighter, which no artefact explains; on 08-01 it pairs more and is worse, meaning
tangent's tighter 184.3 was flattered by discarding the 20 % it could not place.

**So there is currently no reference on this corpus capable of telling a better foot from a worse one.**
Fixing that outranks any estimator change — it blocks every PAT measurement, not just this one.

## Done when

- [x] 20-night inter-LED sweep, with pairing counts audited and 6 nights excluded as unmeasurable
- [x] doubling / SNR / single-LED / bistability all refuted with the measurement that refuted them
- [x] CFD and AIC implemented and scored; CFD's gain shown UNVERIFIED, AIC shown negative
- [x] `CROSS-DOMAIN-METHODS` §2's 12.7 ms premise retracted and §2.1's rate attribution corrected
- [x] ~~the PAT reference fixed — medians inside 150–400 ms and pairing ≥95 % on both modes~~
      **BAR SUPERSEDED 2026-09-01** (unevaluable as written — see the header) and **MET under the
      re-stated one**: mode per night via `pat-window-oracle`, verdict SIGNAL RECOVERED inside a
      200–500 ms rail. All four signal nights pass — 405 / 315 / 215 / 355 ms. Measured against
      #2034's head, not `main`; re-run once it lands.
- [x] only THEN: re-score CFD against it, and adopt or reject on that number — **REJECTED
      2026-09-01** against pre-stated bands: all four signal nights stay RECOVERED in-rail under
      CFD, but paired narrowSD is worse on 16/29 (median ΔSD +0.1 ms) and the tally is unchanged —
      no gain over the shipping tangent foot, judged by the independent ECG reference (header block)
- [x] ~~the mode is PREDICTED by sampling rate~~ — **RETRACTED §1b**: it was the polarity bug
- [x] the mode-splitting MECHANISM identified — **`orient()` picks the wrong sign** (§0)
- [x] **ALREADY SHIPPED — verified 2026-08-17, not implemented anew.** `orientByRise` IS the
      rise-time rule and is already `detectChannel`'s default (`ppgdex-dsp.js:1299`); the old
      `orient` survives only as the undecidable fallback (`up == null && dn == null`). The box was
      stale, not open.
      🔴 **But its WIRING half was genuinely open, and is fixed here.** The node's `analyze` applies
      `applyConsensusPolarity` (re-detect dissenting channels with the device-majority sign); the PAT
      **tool chain did not** — `tools/pat-matchrate-strict.mjs ppgFootTimes` called `detectChannel`
      raw, so every PAT measurement ever taken ran on per-channel guesses the shipping node would
      have overruled. On a split session the dissenter's "feet" are peaks, ~half a cardiac cycle out.
      **Measured, box corpus 2026-08-13 → 17: 16 of 32 sessions >5 MB split** — the brief's "half the
      corpus" figure reproduced at session granularity, a year of tooling later.
      ⚠️ **It does NOT move the ΔPAT numbers, and saying so is the point.** The four nights analysed
      in `PAT-RELATIVE-REFRAME` pair on their NOCTURNAL sessions, and those are unanimous; the splits
      fall on daytime sessions (an early probe picked the largest file, hit a daytime split, and
      briefly looked like the ΔPAT result was affected — it is not). The fix is correct, systemic,
      and inert on the current results. `ppgFootTimes` now returns `polarityFlipped` so a future
      run cannot be silently on either side of it.
- [x] explain the RESIDUAL 2.2–13.2 ms spread that survives the polarity fix — **CLOSED under §5's
      pre-registered rule 3 (2026-09-01): bounded (1.84–13.71 ms, canonical n=31), UNEXPLAINED,
      C1–C4 all refuted with measurements** (C1 +0.683 / C2 −0.694 / C3 −0.698 all under the 0.7
      bar; C4 absent outright; within-night conjunct 8/18 with both extremes 0/3). Rule 3 names
      this a legitimate closure; reopening requires a NEW pre-registration (the slow-wander
      observation is the seed — see the FOLLOWUPS brief)

## 5 · Pre-registration — the residual-spread decomposition (committed BEFORE the predictor run)

**This section is committed before any predictor was measured on the corpus; the commit ordering is
the evidence that the decomposition is not read post-hoc** (same discipline as the window-sweep's
pre-registered bands). Instrument: `tools/ppg-foot-residual-sweep.mjs` (selftest-calibrated on
planted signals only at commit time).

**Estimand.** Per-night inter-LED same-beat foot-difference dispersion (SD and IQR both reported;
the 2.2–13.2 ms figure above is IQR), physiology cancelled by construction. Primary population: the
phone tree (`Ecg nightly` mirror, ~22–32 nights, 176 Hz — rate is constant there, so the spread
needs a non-rate term). Secondary: the box tree, polarity consensus-forced.

**Candidates and their expected signatures:**

- **C1 — noise over upstroke slope** (the physical model: σ_foot ≈ RMS(noise)/slope; pairwise
  σ²ᵢⱼ = σ²ᵢ + σ²ⱼ). Predictor: robust noise RMS (MAD of second differences /0.6745/√6) over median
  foot→peak slope, per channel, pair-combined in quadrature. Signature: Spearman ρ ≥ +0.7 across
  nights, and beat-level |Δfoot| rising with instantaneous 1/slope on the 3 worst nights.
- **C2 — pulse-band SNR** (`channelSNR`, the coarse form of C1). Predictor: worst channel of the
  pair. Signature: ρ ≤ −0.7. (§1 refuted SNR for the BIMODAL split; that was the polarity artifact —
  the residual question is fresh.)
- **C3 — motion burden.** Predictor: same-beat match yield per pair. Signature: ρ ≤ −0.7;
  within-night, disagreement concentrates in low-yield epochs.
- **C4 — beat alternation** (known in this corpus: 6 nights inflate rMSSD 3–6×). Predictor: lag-1
  autocorrelation r1 of the pairwise difference series. Signature: nights at r1 ≤ −0.3 fall in the
  top half of the dispersion ranking, and a 2-beat average collapses their dispersion ≥ 30 % more
  than it collapses a plain-noise night (√2).
- **C5 — sampling rate.** Constant within the phone tree ⇒ structurally cannot explain within-tree
  spread; recorded to keep it from being re-proposed. Box-vs-phone offset only.

**Decision rules (closed here, before the first predictor number):**

1. A candidate EXPLAINS only if cross-night Spearman |ρ| ≥ 0.7 in the predicted direction
   (n ≥ 15 phone nights) AND its within-night signature holds on the 3 highest and 3 lowest
   dispersion nights.
2. The spread is EXPLAINED if C1's physical model predicts per-night dispersion at rank ρ ≥ 0.8
   with magnitude inside a factor of 2 on ≥ 80 % of nights.
3. No candidate at |ρ| ≥ 0.7 ⇒ the box closes "bounded (2.2–13.2 ms), unexplained; C1–C4 refuted
   with the measurements that refuted them" — a legitimate closure, not a failure to close.
4. C1 subsumes C2 if both pass (they overlap by construction); C2 passing alone means the slope
   term added nothing.

### §5 results — measured 2026-09-01, same day, after the pre-registration commit

**One instrument amendment, made before any predictor table was seen:** C2's named instrument
`channelSNR` is LOCAL to `ppgdex-dsp.js` and not on the `PPGDSP` namespace — `pat-per-led.mjs`'s
guarded read has printed n/a since it was written (the half-wired-mechanism shape again). Exporting
it would move every bundle's `manifestHash` for a probe, so C2 was instrumented in-tool as median
foot→peak amplitude / robust noise RMS (same quantity; thresholds untouched; recorded in the tool
header and here).

**A provenance correction sits in this section's history, kept because the shape recurs.** The
first measurement ran against `/run/media/…/Ecg-nightly-archive` — a **stale, incomplete mirror**
holding only the June 10–27 half of the phone corpus (n=15) — and that USB volume then threw Buffer
I/O errors with lost async page writes mid-campaign and dropped (kernel log 2026-09-01 10:21;
unmounted, left for the owner). On the mirror subset C1 read ρ=+0.789 and C2 −0.861 — **both above
bar**; on the canonical corpus below, neither is. An incomplete snapshot flattered two candidates.
The canonical root is `/srv/data/tepna-corpus/uploads/Ecg nightly` (owner consolidation 2026-08-28,
`docs/CORPUS-LOCATIONS.md`), and every number below comes from it.

**Primary population (canonical phone tree, n=31 scored of 32 candidate dates, 06-10 → 07-13;
1 skipped <2 pairable channels).** Estimand: worst-pair IQR spans **1.84–13.71 ms**, median 3.20 —
brackets the 2.2–13.2 headline. Against the pre-stated rules:

| candidate | cross-night result | verdict |
|---|---|---|
| C1 noise/slope | ρ = **+0.683** (bar +0.7); magnitude ~140× short regardless (sd/c1 = 62–282, median 137) | **REFUTED** — under bar, and the white-noise-through-slope model is two orders too small: the dispersion is in-band noise |
| C2 amplitude/noise | ρ = **−0.694** (bar −0.7) | **REFUTED** — under bar by the pre-stated rule |
| C3 yield | ρ = **−0.698** (bar −0.7), and yield sits at 98–100 % throughout | **REFUTED** — under bar, and near-degenerate dynamic range |
| C4 alternation | no pair-night anywhere reaches r1 ≤ −0.3 (range −0.05…+0.78) | **REFUTED** — alternation is absent from the phone corpus |

**Rule 1's within-night conjunct, measured on the six pre-named nights:** the slope-tertile fall
holds on only **8 of 18** pair-nights, and both extreme nights read 0/3 (06-10, the widest, and
06-15, among the tightest). The mechanism signature is not consistently present — concordant with
the cross-night failure.

**So rule 3 applies, and it was written for exactly this outcome: the box CLOSES as bounded
(1.84–13.71 ms per-night worst-pair IQR), UNEXPLAINED, with C1–C4 refuted by these measurements.**
Three candidates land just under the bar (0.68–0.70), mutually correlated — a real quality-flavoured
latent signal is plainly present, but the pre-stated bar exists precisely so a near-miss is not
argued over the line after the fact. Anyone reopening this starts from a new pre-registration with
a sharper candidate, not from softening this one.

**Post-hoc observations (not registered candidates, labeled as such):** (1) r1 skews strongly
POSITIVE (to +0.78 on the widest night) — the inter-LED difference **wanders slowly**, it does not
alternate; whatever drives the dispersion is coherent over many beats, which is inconsistent with
any per-beat noise mechanism and is the most promising seed for a future candidate. (2) The
secondary population (box tree, n=45) shows the same directions, none at bar — C1 +0.550 ·
C2 −0.574 · C3 −0.563 · C4 +0.048.

Related: [`CROSS-DOMAIN-METHODS-2026-08-12-BRIEF.md`](CROSS-DOMAIN-METHODS-2026-08-12-BRIEF.md) ·
[`PPG-SAMPLE-RATE-AND-PAT-2026-08-03-BRIEF.md`](PPG-SAMPLE-RATE-AND-PAT-2026-08-03-BRIEF.md)
