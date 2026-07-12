<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-12 · **Executes:** `TCH-REFERENCE-VALIDATION-2026-07-12-BRIEF.md` §7 **R5** · **Companion to:** `TRIO-ARTIFACT-GATE-AND-N15-POWER-2026-07-12-BRIEF.md` · **Feeds:** `SIGMA-PAPER-REWRITE-2026-07-06-BRIEF.md` · `SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md`

# R5 on the HR triplet — the independence test is **not runnable**, and that is the finding

> **One-line:** R5 asked for `TCH-REFERENCE-VALIDATION`'s experiment re-run on the **HR** triplet using the
> chest-ECG as reference. It **cannot be done** — and the reason is structural, not practical. Because the
> chest-ECG **is one of the three corners**, TCH's `σ_ECG²` is *algebraically identical* to the covariance of
> the other two corners' errors, so the measured ρ and the independence-null are **the same number**. The test
> has **exactly zero power**. What R5 *can* measure is **bias**, and it finds one: **OxyDex under-reads by
> −0.36 bpm**, invisible to every σ the fleet reports. **The fix is one cable: connect the ResMed oximeter and
> the CPAP becomes the fourth, independent HR corner the test requires.**

## 1 · Why the HR triplet is not the respiration triplet

`TCH-REFERENCE-VALIDATION` worked because **CPAP is a genuine FOURTH device** — its error is independent of the
two estimates it judges. That is what let it measure `ρ(err_ECG, err_PPG) = 0.42` and expose the violated
independence assumption.

The HR triplet is `{ECGDex, PpgDex, OxyDex}`. The "closest thing to truth" — the chest-ECG Pan–Tompkins leg —
**is one of the three corners.** Two consequences, and the second is fatal.

### (a) σ_ECG is unvalidatable — you cannot measure a corner against itself. (Expected.)

### (b) The independence test collapses to an identity. (Not expected, and fatal.)

Measure the other two corners against the ECG reference:

```
e_P = P − E          e_O = O − E          (both contain −err_ECG)
```

They **share a term**, so even under perfect independence ρ(e_P, e_O) > 0. The obvious correction is to test the
measured ρ against the ρ *expected from the shared reference alone*:

```
ρ₀ = σ_E² / √( (σ_P² + σ_E²)(σ_O² + σ_E²) )
```

**That correction does not work, because the null and the measurement are the same number.** Expand TCH:

```
var(P−O) = var(e_P − e_O) = var(e_P) + var(e_O) − 2·cov(e_P, e_O)

σ_E²(TCH) = [ var(E−P) + var(E−O) − var(P−O) ] / 2
          = [ var(e_P) + var(e_O) − var(e_P) − var(e_O) + 2·cov(e_P,e_O) ] / 2
          = cov(e_P, e_O)                                      ← IDENTITY
```

**TCH's σ_ECG² *is* the covariance of the other two corners' reference-relative errors.** Substituting it into ρ₀
gives back the measured ρ exactly. Verified numerically on the committed corpus:

```
TCH σ_ECG²                      = 6.068154
cov(err_PPG, err_OXY) vs ECG    = 6.068154
difference                      = 6.7e-14        (floating-point zero)
```

⇒ measured ρ − null ρ₀ = **0.000, always, by algebra**. The test cannot detect dependence *even if it is
enormous*. Any "excess correlation" reported this way would be **fabricated**.

**The same collapse hits the σ comparison.** TCH reproduces the pairwise variances by construction, so
`σ_measured(X)² = σ_X² + σ_E²` is also an identity — √(1.22² + 0.80²) = 1.46 = the directly measured SD, exactly.
Comparing σ_TCH to σ_measured on this triplet **validates nothing**.

> **Rule to carry forward:** a three-cornered hat **cannot be validated using one of its own corners as the
> reference.** Validation requires a genuinely external Nth device. This is why
> `TCH-REFERENCE-VALIDATION` is a real result and R5-as-stated is not.

## 2 · What R5 CAN measure — bias — and there is one

TCH estimates **variance**; it has **no bias term at all**. So bias is information the estimator does not encode,
and measuring it against the chest-ECG is *not* circular. Committed 17-night corpus, 5-min epochs:

| corner | bias vs chest-ECG (ungated, n=1232) | bias (artifact-gated, n=1192) |
|---|---|---|
| **PpgDex** | **+0.464 bpm** | **−0.028 bpm** ← the artifact gate removes it |
| **OxyDex** | **−0.436 bpm** | **−0.357 bpm** ← **persists** |

**OxyDex systematically under-reads HR by ≈ 0.36 bpm**, and it survives artifact gating — so it is not
contamination, it is the device (or the pulse-oximetry HR path). **Every σ the fleet publishes is blind to it.**

This **confirms `TCH-REFERENCE-VALIDATION` Finding A on a second, independent triplet**: the estimator's
blindness to bias is not a quirk of the respiration corners, it is a property of the hat.

Valid only if the raw-ECG leg is ≈unbiased — which is the fleet's own stated premise (CLAUDE.md: the raw
Pan–Tompkins ECG is the **honest** H10 leg; the device `_HR.txt` is the smoothed one).

## 3 · A caveat AGAINST the companion brief's gate — raised here, not hidden

R5 also shows the artifact gate cutting `SD(PPG − ECG)` from **4.52 → 1.46 bpm** (−68%) and
`SD(OXY − ECG)` from **2.83 → 1.63** (−43%).

**That is NOT independent validation of the gate, and must not be cited as such.** The gate is *defined* by
cross-corner disagreement, so measuring cross-corner agreement afterwards is close to tautological — removing
the epochs where corners disagree necessarily shrinks the spread of their differences.

The gate's real evidence is the **SQI** channel it does *not* use (`TRIO-ARTIFACT-GATE` §1: burst epochs at SQI
0.37–0.45 against a 0.52 baseline, with the beat count doubling). That is an independent signal. The
agreement-after-gating number is not.

## 4 · The fix is one cable

The independence test needs a **fourth, independent HR corner**. One already exists in the hardware and is
switched off:

`CPAPDex`'s `_SA2.edf` writes **`Pulse.1s` + `SpO2.1s`** — a 1 Hz pulse rate from the ResMed oximeter. On the
current corpus **every sample is −1** (`cpapdex-dsp.js:332`: the device's "no oximeter connected" sentinel),
because the oximeter module was never attached.

**Attach it, and the CPAP becomes a fourth HR corner** whose error is independent of the H10's electrical
detection, the Verity's optical detection, and the O2Ring's optical detection. That makes R5's independence test
**runnable for the first time** — and it is the only way to check the assumption the entire reference-free σ
programme rests on.

⚠️ **One caveat when it arrives:** the ResMed oximeter and the O2Ring are **both photoplethysmographic**. Their
errors may well be correlated with each other (shared perfusion/motion failure modes) — which is precisely the
mechanism-collision `TCH-REFERENCE-VALIDATION` **R3** warns about. The right corner set is therefore
**{H10-ECG, ResMed-pulse, O2Ring}** or **{H10-ECG, Verity-PPG, ResMed-pulse}**, chosen so the truth leg is not
mechanistically twinned with a corner. Do not simply add it as a fourth and hope.

## 5 · Done when

- [ ] **Connect the ResMed oximeter** for ≥ 5 quad-modal nights (CPAP + H10 + Verity + O2Ring). Zero code cost.
- [ ] Re-run the R5 experiment with **ResMed pulse as the external reference** — then, and only then, the HR
      triplet's **independence** and **σ accuracy** become measurable.
- [ ] **Investigate OxyDex's −0.36 bpm bias.** Candidates: the pulse-oximetry HR path (rolling median /
      smoothing), a 1 Hz bucketing bias, or a genuine device offset. It is small but systematic and it is in
      every published OxyDex number.
- [ ] **State the blindness in the papers.** `SIGMA-PAPER-REWRITE` reports reference-free σ with **no bias term
      and no statement that the estimator has never been validated against truth**. Both papers should say so
      plainly — the σ values are not wrong, but they are **variance-only, and bias-blind by construction**.
- [ ] Fold the §1 identity into the `SENSOR-TRIO-NIGHTS` methods section: **a hat cannot be validated by one of
      its own corners.** It is a one-line derivation and it forecloses an experiment people will otherwise
      keep proposing.

## 6 · Reproducing

Read-only against the committed corpus (`uploads/trio/`, 17 nights × 3 node-exports); no bundle, no ledger, no
`manifestHash` move. The identity in §1 is exact and can be re-derived in three lines from any triplet.
