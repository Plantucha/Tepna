<!--
  PAT-FORENSICS-WINDOW-ORACLE-2026-08-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS · **TRIAGED 2026-09-01 (Osprey): tool BUILT and selftest-clean (`tools/pat-window-oracle.mjs --selftest` = 8/8) but NEVER RUN on a corpus and its results are referenced in no brief, audit or doc. **CORRECTED 2026-09-01: NOT blocked — the raw corpus IS local.** My first stamp said this machine has zero `_ECG.txt`; that was wrong because I searched only the repo's `uploads/` tree, which holds node-export JSON. The canonical root is **`/srv/data/tepna-corpus/` (125 GB, 1131 raw `_ECG.txt`)** with per-night raw dirs under `smoketest-captures/` (box), `uploads/vigil-archive/captures/` (daily mirror) and `uploads/Ecg nightly/` (phone). Pointed at `uploads/trio` the oracle exits 0 with `TALLY: {}` — a WRONG-ROOT failure, not a negative result, which is what made the absence look real. Now running against the real root.** · **Created:** 2026-08-28 · **Parent:** `PAT-ROOT-CAUSE-FORENSICS-2026-08-27-BRIEF.md` (§11/§13 oracle) · **Interlocks:** `PAT-FORENSICS-WINDOW-REGIMES-2026-08-28-BRIEF.md` · **DRAIN 2026-09-02 (Osprey) — RE-RUN under #2082 executed; see the RE-RUN section.** Regression band held exactly (07-24 405->405, 08-17 215->215). Corpus is **48 nights, not 87** — the vigil mirror is a strict subset and one of its nights is an incomplete copy. The unscored-nights Done-when box is **CLOSED**. **Still IN-PROGRESS on one box only:** whether the 20-40 ms residual is slow physiology or an instrumental effect — a research question no run of this tool closes. **Owner: Osprey. Next step:** the phone root's flat-layout defect (50 `_ECG.txt` invisible to the oracle) is the one actionable residue. · **Residue:** R9, R10 · **2026-09-02 (Osprey):** the overlap split #2034 introduced is now RETURNED by `oracleNight` (`lo`/`mid`/`hi`) and consumed by both sibling tools — see PR body. It had been computed but not returned, so `pat-residual-structure.mjs` and `pat-drift-attribution.mjs` each recomputed the pre-fix ECG-extent midpoint and silently diverged from the oracle they read `mode` from. **A fix that lands in one place while its copies survive is this repo's recurring shape** — which is why the repair is the RETURN VALUE, not a third correct copy.

# There IS signal under the window — the acceptance window is mis-specified, not merely wide

> **In one line:** an **out-of-sample** per-night window (mode estimated on the first half, scored on
> the second) beats the shipped `[200, 650]` window by a **median 30.5 ms** of SD, recovers a
> null-beating improvement on **8 of 20 scored nights**, and puts **2 nights under 20 ms**. Four
> nights have their lag mode **outside** `[200, 650]` entirely.

## 1 · The design, and the circularity it exists to avoid

The tempting experiment — find each night's lag mode, wrap a narrow window round it, report the SD —
is **rigged**: fitting a window to the data's own mode guarantees a smaller number whether or not any
signal exists, and would "recover" a lag from pure noise.

So the window is chosen **out of sample**: the mode is estimated on the night's **first half** and
applied untouched to the **second**. No beat that positioned the window contributes to the statistic
scoring it. Two controls, both required:

- **full-window arm** on the *same* second half — the status quo, compared within-night;
- **circular-shift null** — the foot train rotated, receiving the identical procedure including its
  own out-of-sample mode estimate. A night counts only if it beats its own null.

⚠️ **The shift null relies on beat-interval irregularity, and the selftest found this the hard way.**
Against a *perfectly periodic* train a rotation is not a null: with RR = 900 ms and a 37000 ms shift,
37000 mod 900 = 100, so every foot lands a constant 100 ms from its R and the "destroyed"
correspondence is perfectly intact. The first selftest planted a metronome and **the null beat the
real arm**. Real HRV supplies the irregularity; the assumption is load-bearing and is now stated, with
the selftest planting an irregular train on purpose. `--selftest` 8/8, including the control that
matters: **pure noise must not read as recovered**.

## 2 · Result — 20 scored nights

| night | mode | narrow SD | full SD | null SD | margin (null−narrow) | full−narrow |
|---|---|---|---|---|---|---|
| 2026-07-24 | 405 | **15.3** | 39.2 | 59.5 | **44.2** | 23.9 |
| 2026-08-17 | 215 | **17.9** | 77.1 | 57.8 | **39.9** | 59.2 |
| 2026-07-18 | 295 | 27.9 | 31.7 | 57.8 | 29.9 | 3.8 |
| 2026-08-13 | 335 | 37.1 | 42.8 | 58.1 | 21.0 | 5.7 |
| 2026-07-28 | 395 | 37.2 | 47.8 | 56.7 | 19.5 | 10.6 |
| 2026-08-02 | 185 | 38.2 | 36.5 | 56.4 | 18.2 | −1.7 |
| 2026-07-20 | 355 | 42.3 | 51.1 | 57.2 | 14.9 | 8.8 |
| 2026-08-24 | 245 | 44.9 | 83.3 | 57.8 | 12.9 | 38.4 |

**8 STRONG** (margin ≥ 10 ms) · **7 MARGINAL** (0 < margin < 10) · **5 NONE** (margin ≤ 0).
Median `full − narrow` = **30.5 ms**, max **86.8 ms**, negative on only 2 of 20.

**Two nights clear the pre-stated ≤ 20 ms band**: 2026-07-24 at 15.3 ms and 2026-08-17 at 17.9 ms —
both beating their nulls by ~40 ms. On those nights a real, narrow R→foot lag exists and the shipped
window is throwing it away.

## 3 · 🔴 The marginal category is window-fill one level down

The 7 MARGINAL nights cluster at narrow SD **50–58 ms**, and a uniform distribution on a ±100 ms
window has SD **200/√12 = 57.7 ms**. They are not partially recovering signal — **they are filling the
new window exactly as they filled the old one.** The regimes brief's mechanism reproduces at the
smaller width, which is simultaneously a confirmation of that mechanism and the reason these nights
must not be counted as successes. Only the margin column separates them, which is why the band
required beating the null rather than merely landing under a threshold.

## 4 · The window is MIS-SPECIFIED, not merely wide

**Four of 20 scored nights place their lag mode outside `[200, 650]`:** 2026-08-01 at **165**,
2026-08-02 at **185**, 2026-08-06 at **25**, 2026-08-10 at **815**. A window that excludes the true
mode cannot admit the true lag at all; every beat it accepts on such a night is a wrong pairing. This
is direct evidence for the censoring mechanism `PAT-WINDOW-CENSORING` inferred and §8/§16 predicted,
now observed rather than argued.

## 5 · What this changes, and what it does not

- ✅ **Signal exists under the window** on a substantial minority of nights, and the estimator
  discards it. The failure is **recoverable in software** on those nights.
- ✅ **`[200, 650]` is mis-specified**, not merely generous — 20 % of scored nights have their mode
  outside it.
- ❌ **It does not reach the sensor floor.** The best recovered SD is 15.3 ms against a **~11 ms**
  measured floor, and most strong nights sit at 27–45 ms. Something beyond clock and fiducial is
  spending 20–40 ms, and this experiment does not name it.
- ❌ **It is not a recommendation.** §20 forbids optimising pass rate; a per-night adaptive window is
  a *hypothesis this supports*, not a change this brief proposes.

⚠️ **Attrition is severe and conditions everything above: 20 of 42 nights scored** — 15 excluded for
too few beats, 6 UNDEFINED (no beats in the narrow window), 1 unparsed. The excluded nights may
differ systematically, and nothing here establishes they do not.

⚠️ **±100 ms is a pre-stated choice, not an optimised one.** A different half-width would move the
MARGINAL/STRONG boundary — though not the strong nights, which sit well inside it. No sweep was run,
deliberately: sweeping the width against the outcome would re-introduce the circularity §1 exists to
prevent.

## 6 · §14 — the residual is a SLOW TREND, not respiration and not noise (and my own bands were too coarse)

The oracle left 20–40 ms unaccounted for against a ~11 ms sensor floor. §14 asks whether that
residual is **error** (unstructured) or **physiology** (structured). Measured on the out-of-sample
accepted lags of 8 nights, with a shuffle control:

| night | n | SD | ρ₁ | ρ₅ | ρ₂₀ | shuffled | zero-crossing | shape | ρ(RR,lag) |
|---|---|---|---|---|---|---|---|---|---|
| 2026-07-24 | 1476 | 15.3 | 0.943 | 0.816 | 0.545 | −0.001 | **none** | DRIFT-LIKE | +0.028 |
| 2026-07-28 | 3855 | 37.2 | 0.987 | 0.941 | 0.741 | 0.016 | **none** | DRIFT-LIKE | −0.086 |
| 2026-08-02 | 2167 | 38.2 | 0.985 | 0.963 | 0.908 | −0.034 | **none** | DRIFT-LIKE | −0.225 |
| 2026-08-13 | 6864 | 37.0 | 0.963 | 0.939 | 0.898 | 0.009 | **none** | DRIFT-LIKE | +0.459 |
| 2026-08-17 | 1604 | 18.0 | 0.753 | 0.587 | 0.507 | 0.033 | **none** | DRIFT-LIKE | +0.120 |
| 2026-08-24 | 5340 | 44.6 | 0.958 | 0.927 | 0.813 | 0.007 | **none** | DRIFT-LIKE | −0.008 |
| 2026-07-18 | 3884 | 25.8 | 0.977 | 0.924 | 0.735 | −0.028 | **none** | DRIFT-LIKE | +0.049 |
| 2026-07-20 | 8155 | 42.2 | 0.967 | 0.941 | 0.844 | 0.001 | **none** | DRIFT-LIKE | −0.296 |

> ⚠️ **This table was RE-MEASURED 2026-09-02** under the returned-split fix, and the numbers above
> are the current ones. Two facts about the previous version, both verified by paired re-runs against
> unmodified `main`: **five of the eight `n` values moved** under the fix (07-18, 07-20, 08-13, 08-17,
> 08-24), because the consumer had been splitting on the ECG's extent instead of the overlap; and
> **07-18's published `n` was 2415 while unmodified `main` produces 2224**, so that one row was already
> unreproducible from committed code before this change, under some earlier state. **The SHAPE column
> and every verdict are unchanged — the §6/§6b conclusions stand.** What was wrong is the sample they
> were computed on, not what they concluded.
> ### Manifest for the table above — recorded so the next reader need not re-derive it
>
> | | |
> |---|---|
> | commit | `40474646` plus this PR's picker single-sourcing |
> | corpus root | `/srv/data/tepna-corpus/smoketest-captures` (48 night directories) |
> | invocation | `node tools/pat-residual-structure.mjs --dir /srv/data/tepna-corpus/smoketest-captures` |
> | night selection | the 8 nights §6 originally scored, carried forward verbatim — NOT re-selected, so the rows stay comparable to the published ones |
> | full run | 43 nights scored under this commit; the 8 below are the §6 subset |
>
> ⚠️ **The OLD table's numbers were never attributable and these are** — that is the whole point of the
> block above. The previous version named no commit, no corpus root, no invocation and no selection
> rule, which is why `2026-07-18` could sit in it unreproducible from committed code for weeks without
> anyone being able to tell whether the cohort or the code had moved (logged as **R10**). Anyone who
> cannot reproduce the rows below can now settle that in one command.
>
> **These eight rows are UNCHANGED by this PR's picker fix**, which is itself evidence rather than a
> non-event: the picker change moved the corpus from 29 scored nights to **43** (14 gained, none lost)
> and altered only 2 beat counts and **zero verdicts** among the nights already scored — none of them
> in §6. So the table is now stable across two independent fixes, having been unreproducible before
> either.


**8 of 8 DRIFT-LIKE.** Shuffles collapse to ≈ 0 on every night, so the statistic is measuring temporal
order and nothing else.

**Two shapes eliminated:**
- **Not white noise** — ρ₁ ranges 0.75 – 0.99.
- **Not respiratory oscillation** — a 12-beat respiratory cycle gives ρ₁ = cos(2π/12) = **0.866** and
  crosses zero near a quarter period (~3 beats), rebounding negative. **No night crosses zero within
  40 beats**, and ρ₂₀ is still 0.50 – 0.91.
- **No coherent HR dependence** — ρ(RR,lag) scatters in sign across nights (+0.462 … −0.343). Real
  PAT–HR coupling would hold one sign.

### 🔴 But this does NOT settle error-vs-physiology, and my pre-stated bands assumed it would

The bands read *structured ⇒ physiological*. **That mapping is wrong**, and the shape result is what
exposed it. A slow monotone trend is produced by **both**:

- an **instrumental** drift — an uncorrected inter-device clock, a warming sensor; **error**; and
- a **slow physiological** trend — blood-pressure drift across the night, posture, sleep-stage
  transitions, vasomotor tone; **signal**.

Both are "structured", both are drift-shaped, and they mean opposite things for the budget. So the
honest verdict is narrower than either of the two the bands offered: **the residual is a slow trend
of unidentified origin.** Recording it as "physiology" would have been the inversion §14 exists to
prevent; recording it as "clock" would be the same error facing the other way.

**What would discriminate, named for the next pass:** a clock drift moves the *cross-device* lag while
leaving each device's *internal* intervals (RR, foot-to-foot) untouched; a physiological trend moves
the true lag and may co-vary with them. The per-LED arm cannot help — LEDs share a clock *and* a
pulse, so the drift is common-mode either way. Linearity is a weaker second cue: an uncorrected
crystal drifts at a fixed ppm, a vasomotor trend does not.

**Status of the 20–40 ms: still unexplained, but its SHAPE is now known** — a slow trend, not noise
and not respiration. That is two of three candidate shapes eliminated on 8 of 8 nights.

## 6b · The trend is NOT the inter-device clock — 8/8

§6 left the trend's origin open between instrumental drift and slow physiology. The discriminator
needs a **third reference**, because the obvious comparison is circular: `lag_n − lag_0 ≡ Σff − Σrr`
is an **algebraic identity**, true whatever the cause, so cross-device lag versus internal intervals
discriminates nothing. (Asserted in the tool's selftest so it is not re-derived.)

On box captures the third reference exists — each device's own `hostAxis`, verified independent here
(`spreadMs` 715 ms ECG / 1225 ms PPG, `timingSource: "device+host"`). If the trend is instrumental it
is the *difference* of the two devices' rates, and therefore **predictable**:

> predicted lag drift = (ppm_PPG − ppm_ECG) × 1e-6

with a device whose correction was **applied** contributing 0 rather than its ppm. ECG is applied on
these nights (span ≫ 2400 s) so contributes 0; **the PPG's correction is computed and then discarded**
by the fractional-subscript bug, so it contributes its raw rate.

| night | predicted | censored slope | **RAW slope** | ratio | raw R² | verdict |
|---|---|---|---|---|---|---|
| 2026-07-18 | −45.8 | −2.0 | **+1.4** | 33.74 | 0.00 | CLOCK DOES NOT EXPLAIN |
| 2026-07-20 | −30.0 | +6.1 | **+11.9** | 3.51 | 0.12 | CLOCK DOES NOT EXPLAIN |
| 2026-07-24 | −15.4 | +2.7 | **+17.7** | 1.87 | 0.12 | CLOCK DOES NOT EXPLAIN |
| 2026-07-28 | −23.7 | +10.2 | **+16.9** | 2.40 | 0.20 | CLOCK DOES NOT EXPLAIN |
| 2026-08-02 | −29.8 | +45.2 | **+51.6** | 1.58 | 0.60 | CLOCK DOES NOT EXPLAIN |
| 2026-08-13 | −33.1 | −14.7 | **−6.4** | 4.20 | 0.01 | CLOCK DOES NOT EXPLAIN |
| 2026-08-17 | −25.5 | +2.1 | **−3.1** | 7.35 | 0.01 | CLOCK DOES NOT EXPLAIN |
| 2026-08-24 | −31.0 | +13.1 | **+24.2** | 2.28 | 0.38 | CLOCK DOES NOT EXPLAIN |

(ppm = ms of lag per 10⁶ ms elapsed.)

**Three independent reasons the clock is eliminated:**

1. **Sign.** The clock predicts a *negative* drift on all 8 nights; the observed drift is **positive on
   6 of 8**. A magnitude mismatch could be a modelling error; a sign reversal is not.
2. **Magnitude.** Ratios 1.58 – 33.74, every one far outside the 0.7 band.
3. **Linearity.** A fixed-ppm crystal offset is straight. Raw R² is **0.00 – 0.60, median ~0.12** — the
   trend is not linear, so it is not a constant-rate instrumental offset.

🔴 **The verdict is robust to its one modelling assumption.** If the PPG's effective rate were **0**
instead of its raw ppm (i.e. if `fs` estimation happens to track the device rate), the ratio becomes
`|obs − 0|/|obs| = 1.0` — **still above the 0.7 band on every night**. The conclusion does not depend
on that choice.

⚠️ **Measured UNCENSORED, deliberately.** The oracle's accepted set keeps only beats inside
mode±100 ms, so a drifting lag is truncated: the slope is biased toward zero and, where the window is
mis-centred, the survivors are selected *against* the drift direction, which can flip the apparent
sign. Comparing an uncensored prediction against a censored observation is not a fair test, and the
first version of this tool did exactly that and reported a confident 8/8 off it. Both arms are shown;
the RAW arm decides.

⚠️ **Remaining caveats:** raw lags use the nearest-forward foot, so they include mispairings — noise,
and a systematic bias only if the mispairing rate itself trends across the night. 8 nights, and they
are the oracle's STRONG set rather than a random sample.

**So the slow trend is not the clock.** What remains for it: slow physiological variation (BP,
vasomotor tone, posture, sleep stage) or an instrumental effect the host axis cannot see (sensor
warming, contact drift, wear shift). This brief does not choose between those.

## 6c · 🔴 THE CAMPAIGN'S PRODUCT — what was eliminated, and what survives

Every row is a measurement with its refutation, not an opinion. This is the table the charter's §18
matrix and §21B ranked causes are built from.

### The error budget — every measured sensor-side term

| term | magnitude | label | how established |
|---|---|---|---|
| ECG axis, ppm refused on 83 % of fragments | **11.15 ms** within-bin | ENGINEERING (gate empirically correct) | σ_y(300) ≥ \|ppm\| on 80.3 % ⇒ the refused rates are noise |
| PPG fractional-subscript bypass | **~10 ms** within-bin (40 worst) | **SOFTWARE BUG** | 0 / 8948 feet took the `relSec` branch |
| fiducial family choice | **≤ 6.22 ms** | NOT DOMINANT | 28 pairs, clock-free by construction |
| fiducial detector noise (per-LED TCH) | **1.88 – 6.33 ms** | NOT DOMINANT | independent second route, agrees |
| **the acceptance window** | **129.9 ms** where it dominates | **STATISTICAL / GATING DESIGN** | SD ≡ 450/√12; a channel broken 150× reports the same SD |
| **residual after an out-of-sample window** | **20 – 40 ms** | **UNATTRIBUTED** | see below |

**No sensor-side term exceeds ~11 ms.** The gating is the limit, not the hardware.

### Candidates ELIMINATED for the 20–40 ms residual

| candidate | verdict | evidence |
|---|---|---|
| white noise | **eliminated** | ρ₁ 0.754 – 0.987 on 8/8 |
| respiratory oscillation | **eliminated** | no zero-crossing within 40 beats on any night; ρ₂₀ still 0.50 – 0.91; a 12-beat cycle would give ρ₁ = 0.866 and cross at ~3 |
| HR / RR coupling | **eliminated** | ρ(RR,lag) scatters in **sign** (+0.462 … −0.343); real coupling holds one sign |
| **inter-device clock** | **eliminated** | sign reversal (predicted −ve on 8/8, observed +ve on 6/8) · ratios 1.58–33.74 · raw R² median ~0.12 · robust to the effective-ppm assumption |

### Candidates ELIMINATED for regime membership

| candidate | verdict | evidence |
|---|---|---|
| channel / signal quality | **eliminated** | foot-to-foot SD median 95–109 ms, flat across all four regimes |
| a per-channel property | **eliminated** | all 3 LEDs agree on the regime on **every** night |
| median-lag position | **eliminated** | 08-01 sits 7 ms off centre → EDGE-LOADED; 08-03 exactly on centre → 125.1 |
| yield | **eliminated** | 12–54 % spans every regime |
| BLE offset drift | **NOT eliminated — test was uninformative** | ρ = +0.109, n = 11, 95 % CI [−0.53, +0.67] |

### What survives

- **Slow physiological variation** — BP, vasomotor tone, posture, sleep stage.
- **An instrumental effect the host axis cannot see** — sensor warming, contact drift, wear shift.

## 6d · The fork, stated explicitly

**(a) One more discriminator.** A non-circular, non-confounded one exists: **two PPG sites against one
ECG reference.** A systemic physiological trend moves both sites together; a contact or wear artifact
is site-local. Unlike per-LED this is *not* common-mode — two sites share neither housing nor skin
contact. **But it is not available at usable n on this corpus:**

- the clean pair (two Verity units, both real axes) exists on **2 nights** — 2026-07-25 and 07-26;
- the plentiful pair (Verity + O2Ring) is **confounded**, because the O2Ring's axis is **drawn**
  (`index × assumed rate`), which manufactures its own linear drift — the exact quantity under test.

Running it at n = 2 would repeat the mistake this campaign already refused at n = 11.

**(b) Declare the boundary.** The charter's question is answered: the estimator discards real signal,
the window is mis-specified rather than merely wide, and the residual is a slow trend with the clock
eliminated and physiology-vs-contact left open. **That is a complete and truthful terminal state.**

**Recommendation: (b)**, with (a) specified as the first experiment for a corpus that supports it —
the vigil nights are the natural n. Residual attribution becomes its own brief rather than being
chased past the charter on two nights.


## ⚠️ SUPERSEDED — computed under an INSTRUMENT DEFECT (kept for provenance)

> 🔴 **Do not quote the table below.** It was computed with `oracleNight` splitting on the **ECG's own
> midpoint** rather than the overlap interval. Where the PPG covers only the early part of a long ECG
> record, the entire scored half lands **after the PPG ended** — so those nights reported
> `UNDEFINED (n=0)`, which reads as a data verdict and was a **TOOL REFUSAL**. See the corrected run.

## ✅ FIRST CORPUS RUN — executed 2026-09-01 (Osprey), under the defective split

`tools/pat-window-oracle.mjs --dir <root>` had never been run against a corpus; its results appeared in
no brief, audit or doc. Run over **43 box nights** (`/srv/data/tepna-corpus/smoketest-captures/`, with
`2026-08-23` excluded — see the landmine note), half-width ±100 ms:

| verdict | nights |
|---|---|
| **SIGNAL RECOVERED** | **2** |
| PARTIAL | 14 |
| NO RECOVERY (null not beaten) | 6 |
| UNDEFINED (`n = 0` matched beats) | 6 |
| ⊘ too few beats | 15 |

**The two recoveries are unambiguous**: `2026-07-24` narrowSD **15.3** vs null 59.5, and `2026-08-17`
**17.9** vs 57.8. Everywhere else the null is at or below the measurement.

### The null IS the window, and the arithmetic says so

`nullSD` sits at **56.2–59.5 ms** on 18 of 22 scored nights. A uniform draw across the ±100 ms search
window has SD `200/√12 = 57.7 ms`. That is not a coincidence to be interpreted — it is the null
reproducing its own window width.

`fullSD` lands on **130.1 · 130.4 · 130.5 · 136.9** on the wide nights. The 450 ms PHYS window gives
`450/√12 = 129.9 ms`.

So this run independently reproduces, at corpus scale and from a tool nobody had executed, the result
the memory `pat-sd-is-the-window` records from a different direction: **a PAT SD reported without its
window is a measurement of the window.** Two instruments, one number, no shared code path.

### What that means for the charter

- **§11–13's oracle question is answered for the window layer**: windowing alone accounts for the
  narrowing on 20 of 22 scored nights. Only 2 nights carry signal that beats their own null.
- **5 nights recover a mode OUTSIDE the physiological window** (`2026-08-01` 165 ms, `2026-08-02` 185,
  `2026-08-06` 25, `2026-08-10` 815, `2026-08-28` 1245). A mode at 25 ms or 1245 ms is not a PAT; those
  are alignment artifacts and should not be read as short/long transit times.
- **6 nights score `UNDEFINED` with `n = 0` matched beats** — distinct from the 15 marked ⊘ *too few
  beats*. Zero matches on a night that has beats is a pairing failure worth its own look, and is the
  most concrete follow-up this run produces.

⚠️ **Not yet done here:** the ±100 ms half-width is the only one swept. The verdict "the null is the
window" predicts the scores should move with the half-width, and that sweep is the natural next
execution — cheap now that the root is known.

### 🔒 PRE-REGISTERED before the half-width sweep (written 2026-09-01, BEFORE the run)

Recorded ahead of the measurement so the result cannot be read post-hoc.

**Prediction 1 — the null tracks the window.** If `nullSD` is the search window and not the data, it
must follow `2w/√12` at every half-width:

| half-width `w` | predicted `nullSD` |
|---|---|
| 50 ms | **28.9 ms** |
| 100 ms | **57.7 ms** (observed: 56.2–59.5 on 18 of 22 nights) |
| 200 ms | **115.5 ms** |
| 300 ms | **173.2 ms** |

A windowing-artifact night tracks that column. **The discriminator is a night whose recovered mode and
score do NOT move with `w`** — that night has something the window is not supplying.

**Prediction 2 — the two signal nights must hold their mode, or they are artifacts too.**
`2026-07-24` recovered mode **405 ms** at SD 15.3, and `2026-08-17` mode **215 ms** at SD 17.9. Each must
hold its mode **within ±(its own SD)** across the sweep — 405 ± 15.3 and 215 ± 17.9. If either drifts
outside its own uncertainty as the window changes, it **reclassifies as an artifact** and the corpus has
zero recovered nights, not two.

**What would make me wrong:** `nullSD` failing to track `2w/√12` would falsify "the null is the window"
outright, and I would have to explain the ±100 ms agreement as coincidence rather than arithmetic.

### The 5 out-of-window modes — a refusal-class candidate, not built

`2026-08-06` **25 ms** · `2026-08-01` 165 · `2026-08-02` 185 · `2026-08-10` 815 · `2026-08-28` **1245 ms**.

A 25 ms or 1245 ms "PAT" is not a transit time. These should surface as **REFUSED-artifact** rather than
as a number a consumer can quote — the same discipline `hostAxis` applies when its bound is exceeded.
Recorded as a candidate only: whether the oracle refuses or merely flags belongs to that tool's
owner-decision layer, and is not built here.

> ✅ **DECIDED AND BUILT — 2026-09-01 (owner's deputy: REFUSE, not flag).** `oracleVerdict()` in
> `pat-window-oracle.mjs`: a recovered mode outside PHYS [200, 650] returns **ARTIFACT REFUSAL** with
> the mode quoted as diagnostic — never a band verdict a consumer can quote. The refusal keys on the
> PHYS band, deliberately NOT the ratified 200–500 acceptance rail: the rail stays the acceptance
> layer's sanity band for signal nights, while this refusal is physical impossibility. The verdict
> line for in-band nights now carries the mode + a per-night halves-invariance diagnostic beside the
> w-dependent band label (§sweep's consumer hazard: labels degrade with `w`, modes don't).
>
> **Measured against a same-corpus baseline run of the pre-change code (58-dir box tree, 29 scored),
> with two deviations from the pre-statement reported rather than absorbed:**
>
> - The refusal invariant holds exactly: the baseline's `[mode OUTSIDE phys window]` nights — **all
>   6 of them, and only them** — become ARTIFACT REFUSAL (07-22 125 · 08-01 165 · 08-02 185 ·
>   08-06 895 · 08-10 815 · 08-31 655 ms); every mode identical between runs; zero verdict changes on
>   any non-refused night; the four signal nights (405/315/215/355) keep mode and SIGNAL RECOVERED.
>   Tally 4/19/6 → 4 RECOVERED · 15 PARTIAL · 4 NO RECOVERY · **6 ARTIFACT REFUSAL**.
> - ⚠️ **The list above (the recorded five) was STALE, in three ways, all pre-dating this change:**
>   `2026-07-22` and `2026-08-31` are out-of-window today and were not recorded; `2026-08-06` reads
>   mode **895**, not the recorded 25; `2026-08-28` (the recorded 1245) is `⊘ too few beats` under
>   the pre-change code too — the overlap-split fix (#2034) moved membership after the candidate was
>   written. The CLASS definition, not the night list, is what got built.
> - ⚠️ **The halves-agreement expectation FAILED on all four signal nights** (405→325 · 315→195 ·
>   215→315 · 355→505; pre-stated ±10 ms). This is the known ~450 ms offset wander surfacing in a
>   new instrument, and it is exactly what the diagnostic exists to show: the night-mode is
>   w-invariant but NOT time-stable within the night. Diagnostic only — it gates nothing — and the
>   ±10 ms expectation does hold on the synthetic plant, so the miss is a property of the nights,
>   not of the arithmetic.
>
> Selftest 15/15, including a both-sides plant — a tight 100 ms lag the band layer alone WOULD have
> quoted as SIGNAL RECOVERED is refused (the fabricated-authority case this class exists for), and a
> slow-train 700 ms plant refuses high (a 1240 ms plant against RR≈900 aliases mod RR to ~285 — beat
> trains align only mod one heartbeat — so the high plant uses RR 1500±300).

### ✅ SWEEP RESULT — measured 2026-09-01, against the bands registered above

**Prediction 1 — `nullSD` tracks `2w/√12`: holds, then breaks, and the break is the informative part.**

| `w` | predicted | median observed | |
|---|---|---|---|
| 50 | 28.9 | **28.9** | exact |
| 100 | 57.7 | 56.2–59.5 | in band |
| 200 | 115.5 | **111.6** | in band (−3.4 %) |
| 300 | 173.2 | **153.8** | **MISS (−11.2 %)** |

Reported as a miss rather than smoothed. Past ~±200 ms the window stops being the binding constraint —
a uniform draw can only fill a window that candidate matches actually span. So **"the null is the window"
is true while the window is the NARROWER constraint**, which the ±100 ms operating point satisfies. That
is a narrower claim than the first corpus run supported, and the sweep is what narrowed it.

**Prediction 2 — the two signal nights must hold their mode: they hold it EXACTLY.**

| night | registered | w=50 | w=200 | w=300 |
|---|---|---|---|---|
| `2026-07-24` | 405 ± 15.3 | **405** | **405** | **405** |
| `2026-08-17` | 215 ± 17.9 | **215** | **215** | **215** |

Not "within tolerance" — **invariant**, across a 6× change in search width. That is exactly the
registered discriminator. **Both nights survive; neither reclassifies.** The corpus has two genuine
signal nights, on a basis stronger than a single operating point.

⚠️ **CONSUMER HAZARD — the verdict LABEL is a function of `w`; the MODE is not.** `2026-08-17` reads
**NO RECOVERY at w=300 while recovering the identical 215 ms**; `2026-07-24` degrades SIGNAL RECOVERED →
PARTIAL → PARTIAL while never moving off 405 ms. Both SDs grow with `w`, so the score ratio erodes though
the recovered location is fixed. **Anyone quoting a verdict at one half-width can draw the opposite
conclusion from the physics.** Quote the mode, or quote the verdict with its `w`.

### 🔎 THE 6 `n = 0` NIGHTS — localised to the matcher, not detection (2026-09-01)

Filter chain with counts at each stage. Selection reproduced exactly as `pick()` does it — **largest
file, not first**.

| night | R-peaks | ECG span | PPG feet | PPG span | ratio |
|---|---|---|---|---|---|
| `2026-08-12` (n=0) | 25 934 | 455.4 min | 9 633 | **166.3 min** | 0.37 |
| `2026-07-21` (n=0) | 17 086 | 344.4 min | 8 054 | **154.2 min** | 0.45 |
| `2026-08-15` (n=0) | 25 026 | 489.1 min | 6 181 | **122.8 min** | 0.25 |
| `2026-08-13` (n=6840) | 15 687 | 285.5 min | 15 295 | 285.9 min | **1.00** |
| `2026-08-09` (n=9032) | 21 352 | 412.5 min | 20 932 | 409.4 min | **0.99** |

**Both streams are rich on every night — 6 000 to 26 000 beats. This is not a detection failure.** The
discriminator is the **span ratio**: nights that pair have near-identical spans; every `n=0` night has a
PPG fragment covering a quarter to a third of the ECG fragment.

But partial coverage should yield *fewer* matches, not *zero* — 9 633 feet inside an overlapping ECG span
should match something. **The defect is in the matching stage under partial overlap.**

⚠️ **Two hypotheses died here, each a proxy standing in for the thing:**
1. *"Fragmentation causes it"* — falsified: `2026-08-13` has 3 ECG / 328 PPG fragments and pairs fine.
2. *"The picked fragments do not overlap"* — falsified twice: first comparing **file-name start times**
   as a proxy for temporal overlap (a fragment starting at 20:20 can run for hours), then comparing the
   **first** files when `pick()` returns the **largest**. With the correct files every `n=0` night
   overlaps substantially (`08-12`: ECG 20:52–04:27 vs PPG 20:54–23:40).

⚠️ **Not excluded:** the H10 sensor-clock rebase (+2792 days mid-file, seen on `08-23`). If the matcher
keys on `sensor timestamp [ns]` rather than the phone column used above, a device-clock discontinuity
would zero pairing while wall-clock spans look healthy. **First thing to test at the matching stage.**
## ✅ RE-RUN under #2082's overlap PAIRING — executed 2026-09-02 (Osprey, drain)

The ✅ CORRECTED RUN above predates **#2082**, which rewrote `pick()` to pair the ECG/PPG fragments by
**temporal overlap** instead of two independent size-sorts. That changes WHICH files a fragmented night
is scored on, so the corpus was re-run across all three raw roots. Bar registered before the run
(`oracle-rerun-prestatement.md`): single-fragment nights cannot move, and the two window-invariant
nights must not move — any movement there means the change touched MEASUREMENT, not selection.

**The regression band HELD exactly: `2026-07-24` 405 -> 405 and `2026-08-17` 215 -> 215**, both still
SIGNAL RECOVERED. #2082 moved selection and left measurement alone, which is what it was built to do.

| root | nights | SIGNAL | PARTIAL | NO RECOVERY | ARTIFACT REFUSAL | REFUSED |
|---|---|---|---|---|---|---|
| `smoketest-captures` (box) | **48** | 5 | 21 | 6 | 11 | 5 |
| `uploads/vigil-archive/captures` (mirror) | 39 | 3 | 15 | 6 | 10 | 5 |
| `uploads/Ecg nightly` (phone) | **0 — see below** | | | | | |

🔴 **DO NOT SUM THESE ROWS, and the reason is the finding.** All **39** of the mirror's nights are also
in the box root — it is a strict SUBSET, not an independent corpus. The scored corpus is **48 nights,
not 87**. On the 39 shared nights the two copies agree **38/39 on verdict AND mode**, which is a real
reproducibility result for the oracle. The single disagreement is a **data** difference, not a tool one:
`2026-07-25` reads SIGNAL/405 from the box and PARTIAL/335 from the mirror because **the mirror is an
incomplete copy of that night** — 6 ECG + 17 PPG fragments against the box's **21 + 136**. Overlap
pairing over a smaller fragment set selects a different pair. The mirror is not a faithful copy and must
not be treated as a second sample.

🔴 **The phone root scored ZERO nights, and that is a LAYOUT defect, not an absence of data.** It holds
**50 `_ECG.txt` files**, but they sit **flat in the root directory** while the oracle expects
`<captures root>/<night>/`. `TALLY: {}` with exit 0 is precisely the wrong-root failure this brief's own
status header already warned about — the same shape, one directory level down. **Residue, owner Osprey:**
either the oracle grows a flat-layout reader or the phone tree is restructured; until then every phone
night is invisible to it and no verdict about the corpus may be quoted as covering them.

**The five refusals all name a defensible, self-evidencing reason** — the #2044/#2052 discipline holding
under a real run: 2 x `missing _ECG.txt`, 2 x `too few beats` with both counts (`r=8522, f=33` and
`r=2458, f=32`), and `2026-08-20`'s `no overlap between the two trains (R 04:28-04:34 vs feet
04:36-05:00; disjoint by 2 min)`. That last one independently confirms the train-level measurement
recorded on 2026-09-01: the night's best pair really is disjoint, and the earlier `0.04 h` figure was a
FILE-span, not a train overlap.


## 7 · Done when

- [x] Out-of-sample design, circular-shift null, gate-asserted with a noise control.
- [x] Full-corpus run; strong/marginal/none separated by null margin.
- [x] Mode-outside-window nights identified and counted.
- [x] The 20–40 ms residual's SHAPE: a slow trend on 8/8 nights — not white, not respiratory, no coherent HR dependence.
- [x] Its SOURCE, partially: the **inter-device clock is ELIMINATED** on 8/8 by sign, magnitude and non-linearity, robust to the effective-ppm assumption.
- [ ] What remains: slow physiology (BP/vasomotor/posture/stage) vs an instrumental effect invisible to the host axis (warming, contact drift).
- [x] Whether the previously-unscored nights differ systematically from the scored — **ANSWERED
      2026-09-02 under #2082's pairing.** They do not form a systematic class: of 48 box nights only 5
      refuse, each for a named data reason (2 missing `_ECG.txt`, 2 below the 200-beat floor with counts,
      1 genuinely disjoint by 2 min), and 11 more are ARTIFACT REFUSALS whose mode falls outside PHYS
      200-650 ms. The earlier unscored bulk was substantially a TOOL artifact — independent size-sorts
      pairing non-overlapping fragments — not a property of those nights.


## ✅ CORRECTED RUN — overlap-scoped split, 2026-09-01

`oracleNight` now derives its split from the **overlap interval** `[max(r0,f0), min(rN,fN)]`, fitting on
its first half and scoring out-of-sample on its second. The out-of-sample discipline is unchanged; what
changed is that both halves now sit inside the region where both streams exist — the only region where a
cross-device relationship exists at all.

| verdict | before | **after** |
|---|---|---|
| SIGNAL RECOVERED | 2 | **4** |
| PARTIAL | 14 | **20** |
| NO RECOVERY | 6 | **5** |
| **UNDEFINED (n=0)** | **6** | **0** |

**All six `UNDEFINED` nights now score, and two carry signal:**

    2026-08-12  mode 315  narrowSD 16.5 vs null 57.8   SIGNAL RECOVERED
    2026-08-18  mode 355  narrowSD 14.6 vs null 58.6   SIGNAL RECOVERED
    2026-07-16 495 · 2026-07-21 455 · 2026-07-23 455 · 2026-08-15 205   (PARTIAL)

**Regression band held**, registered before the run: the two window-invariant nights did not move —
`2026-07-24` **405 -> 405**, `2026-08-17` **215 -> 215**. Sane nights reproduce their modes exactly with
small `n` increases from the wider in-overlap sample (`08-13` 6840->6865, `08-09` 9032->9208,
`07-20` 7715->8156) — re-scoping, not re-measuring.

**The corpus has four signal nights, not two**, and two of the four were previously recorded as having no
data at all. Modes across the four: **215 / 315 / 355 / 405 ms**.

> *Four hypotheses died getting here — every one a proxy standing in for the thing.*
