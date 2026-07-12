<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-12 · **Executes:** `CPAP-REAL-CORPUS-2026-07-11-BRIEF.md` §P6 · **Complements:** `TRIO-ARTIFACT-GATE-AND-N15-POWER-2026-07-12-BRIEF.md` · **Feeds:** `SIGMA-PAPER-REWRITE-2026-07-06-BRIEF.md` · `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III-2026-07-06-BRIEF.md`

# The three-cornered hat, finally measured against a TRUE reference — it is blind to bias, and its independence assumption does not hold

> **One-line.** The σ programme exists *because there is no reference*: you cannot measure a device's error
> without truth, so you triangulate three devices and trust the estimator. **Nobody has ever been able to
> check whether that trust is warranted.** CPAP's PLD channel writes **measured respiration from a calibrated
> flow sensor**, so on the quad-modal nights we finally have one. Driven against it, the TCH **fails in two
> ways that are invisible without a reference**: it is **blind to bias by construction** (ECG under-reads
> respiration by **1.35 br/min** — a systematic error no reference-free method can detect), and its
> **independence assumption is violated** (ρ = **0.42** between the ECG and PPG error terms), which makes it
> rate a *calibrated flow sensor* as noisy as an RSA-derived estimate.

## How this relates to the sibling brief (read both)

`TRIO-ARTIFACT-GATE-AND-N15-POWER` found that TCH has **no robustness to contamination** — 3 bad epochs in 86
inflated a corner's σ from 2.5 → 9.6 bpm — and proposes a cross-corner consensus gate. **That finding stands
and this one does not replace it.** They are different failure modes of the same estimator, and they stack:

| | sibling brief | this brief |
|---|---|---|
| failure mode | no robustness to **artifact** | **model** is wrong for this triplet + **blind to bias** |
| triplet | HR (ECG · PPG · O2Ring) | **respiration** (CPAP · ECG · PPG) |
| how the error is known | **implausibility** — "σ 9.6 bpm can't be right for a chest strap" | **an actual reference** — a calibrated flow sensor |

That last row is the point. The sibling brief must diagnose by *judgement*, because it has no truth signal.
This one measures. **Clean the epochs and both defects below remain.**

---

## 1 · The experiment

For each 5-min epoch on the quad-modal nights, three respiratory-rate estimates on ONE floating clock
(the Clock Contract makes the join exact — three unrelated parsers, no timezone negotiation):

| corner | source | role |
|---|---|---|
| **CPAP** | `PLD.RespRate` — **measured** by a calibrated flow sensor in the therapy path | **TRUTH** |
| **ECG** | Lomb–Scargle HF peak of the NN series (Polar H10) | estimate |
| **PPG** | Lomb–Scargle HF peak of the PPI series (Polar Verity) | estimate — **same estimator, independent device** |

Same estimator on both interbeat series **deliberately**, so any ECG↔PPG difference is *device* error, not
*method* error — which is the assumption TCH is built on.

**n = 67 epochs across 11 nights** (30-min clips; the raw ECG/PPG are 180–330 MB per night, so the analysis
clips rather than parses whole nights). Tool: `tools/tch-reference-validation.mjs`.

---

## 2 · Finding A — TCH is **blind to bias**, and there is a large one

|  | error vs the measured reference |
|---|---|
| **ECG** respiration | bias **−1.35 br/min** — systematically **under-reads** |
| **PPG** respiration | bias **−0.88 br/min** |

TCH estimates **variance**. Bias is invisible to it **by construction** — it can only ever tell you how much
two corners *disagree*, never how far all of them sit from the truth. **No reference-free method, and no
artifact gate, could ever have surfaced this.** A fleet-wide 1.35 br/min systematic under-read in
ECG-derived respiration would have propagated silently into every downstream consumer.

This is the single strongest argument for keeping a measured reference in the corpus.

## 3 · Finding B — the independence assumption does **not** hold

TCH's model is `Var(x_i − x_j) = σ²_i + σ²_j`: it **requires the three corners' errors to be mutually
independent**. On this triplet they are not:

```
ρ(ECG error, PPG error) = 0.42        (measured against the reference)
```

Physically obvious in hindsight: **ECG and PPG both estimate respiration from the same phenomenon** —
respiratory sinus arrhythmia in the interbeat interval — with the same spectral estimator. They are not two
independent looks at respiration; they are two looks at *the same proxy for* respiration.

**Consequence.** With the classic solve (ρ = 0 — what the fleet ships):

```
σ_TCH:   CPAP 2.07      ECG 2.15      PPG 2.70   br/min
```

It rates **a calibrated flow sensor counting actual breaths** as noisy as an RSA-derived estimate. That is
physically implausible, and it is the signature failure of correlated legs: the **shared** ECG/PPG error looks
like *signal*, so the discrepancy is misattributed to the odd corner out — the one that is actually right.

## 4 · Finding C — the repo's correlated solve **cannot** fix it

`integrator-tch.js` does have a correlated path. Fed the measured ρ = 0.42:

```
σ_TCH (correlated-external, ρ=0.42):   CPAP 2.71   ECG 2.84   PPG 3.50
```

Everything scaled **up**; nothing was **reallocated**. The reason is structural — the model is

```js
Cov(n_i, n_j) = rho · s_i · s_j        // integrator-tch.js §_residual
```

a single **common-mode** ρ applied to **all three pairs equally**. It cannot express *"ECG and PPG are
correlated with each other, but CPAP is independent of both"* — which is exactly the situation. **This is a
model limitation, not a tuning problem.**

---

## 5 · Two code defects found on the way (both F1-class: computed, then dropped)

### ~~D1 — `PPGDSP.lombScargle` never tracks the HF peak frequency~~ ❌ **RETRACTED — NOT a defect**

> **I was wrong, and the suite caught it.** `respRate: null` in PpgDex is a **deliberate, audited safety
> property**, not an oversight — `SYNTH-TEXTURE-FOLLOWUPS-II §2`, locked by a guard in
> `tests/dex-tests.js`: *"ppgdex lombScargle exposes NO respRate/peak path (band-power only → defect absent)"*.
>
> **Why it is a safety property.** An HF-peak `respRate` reads the **0.15–0.40 Hz** band.
> **Cheyne–Stokes / periodic breathing modulates at ~0.022–0.05 Hz — far BELOW it.** An HF-peak estimate
> would therefore report a *normal-looking* respiratory rate straight through a CSR episode and silently
> erase it. ECGDex can track its HF peak safely **only because** it carries a dedicated apnea-band detector
> (`detectCVHR`) covering exactly that sub-HF range. **PpgDex has no such channel.** Wiring the peak in
> would have re-introduced precisely the sub-HF-blindness defect the audit deliberately declined to port
> from PulseDex.
>
> The one-line "fix" was implemented, the guard failed, and it was **reverted**. PpgDex is untouched; its
> `manifestHash` did not move.
>
> **What is actually true:** PpgDex has **no respiration estimate at all**, and giving it one *safely* needs
> a **sub-HF-aware** estimator (a global peak plus a `peakBelowHF` flag) or its own apnea-band channel —
> **not** a naive HF peak. That is real work: **R6** below, not a one-liner.
>
> **⚠ Consequence for §2/§3 — read this.** The PPG respiration used in the validation was produced by
> running *ECGDSP's* HF-peak estimator over the PPI series, so **it is itself sub-HF-blind**. In this corpus
> that is a small effect (CPAP reports periodic breathing on ~0–2% of epochs), but it is a genuine caveat on
> the **PPG corner's σ**. It does **not** touch Finding A (bias) or Finding C (the common-mode ρ limitation).

### D2 — ECGDex computes respiration and exports **neither** estimate
`cardiorespCoupling()` derives `respFromEDR` (R-amplitude modulation) and the spectral path derives
`respRate` (HF peak). The export's `hrv.frequency` carries only `{lf, hf, lfhf, method}` — **no respiration at
all**. Same bug class as `CPAP-REAL-CORPUS` §F1 (ventilation lane computed, then dropped), in a second node.

**Both require a DSP change → re-bundle → ledger.** Per CLAUDE.md §👥.3 they are **queued behind the open
audit PRs** (#29 holds `clock.js`, which is inlined into every bundle). Do not start them until that lands.

---

## 6 · Honest limits

- **n = 67 epochs, 11 nights, 30-min clips.** Modest. The direction of both findings is robust to that; the
  precise σ values are not.
- **CPAP is treated as truth.** Its measurement error is small (a calibrated flow sensor counting breaths)
  but not zero. If it were large, Finding B would weaken — but that cuts the *wrong way* for TCH: TCH's own
  estimate of σ(CPAP) = 2.07 is far above its epoch-to-epoch spread, which is what makes it implausible.
- **The Lomb–Scargle HF peak is a crude respiration estimator.** A proper EDR would likely track better.
  **The finding is about the TCH estimator, not about whether respiration can be derived well** — a better
  ECG/PPG estimator would reduce σ but would *not* fix the ρ ≈ 0.42 structural correlation (both still read
  the same RSA proxy) and would *not* make TCH able to see bias.

## 7 · Proposals

| id | proposal | value |
|---|---|---|
| **R1** | **Keep a measured reference in the corpus, permanently.** CPAP respiration is the only ground truth the fleet has. Bias is undetectable without it — see §2. | **highest** |
| **R2** | **Generalize `threeCorneredHat` to a pairwise correlation structure** (`rho_ab`, `rho_ac`, `rho_bc`), not one common-mode ρ (§4). Then a triplet with two mechanistically-coupled corners can be solved honestly. | high |
| **R3** | **Refuse, or loudly flag, a triplet whose corners share a mechanism.** ECG-RSA and PPG-RSA are not independent looks at respiration. The Integrator should not silently TCH them. | high |
| **R4** | Fix **D2** (ECGDex export its respiration). **D1 is retracted** — not a defect. | med |
| **R6** | **Give PpgDex a SUB-HF-AWARE respiration estimate** — a global peak with a `peakBelowHF` flag, or its own apnea-band channel like ECGDex's `detectCVHR`. A naive HF peak is *unsafe*: it erases Cheyne–Stokes. This is the real gap D1 mistook for a one-liner. | **high** |
| **R5** | Re-run this validation on the **HR** triplet once a reference exists for HR (chest-ECG Pan–Tompkins is the closest), and compare against the sibling brief's artifact-gated σ. | med |

## 8 · Done when

- [ ] **R2** — pairwise-ρ solve lands with a self-test; this triplet re-solved and σ(CPAP) recovers to a value consistent with a calibrated sensor.
- [ ] **R3** — a mechanism-collision guard exists (or the Integrator documents why it is safe to ignore).
- [ ] **R4** — D1 + D2 fixed, re-bundled, fixtures regenerated (AFTER the audit PRs land).
- [ ] Findings folded into `SIGMA-PAPER-REWRITE` — the paper currently reports reference-free σ with no statement that the estimator has never been validated against truth, and no bias term at all.
- [ ] Follow-up brief spawned per §📌 with whatever R2 turns up.

## 9 · Reproducing

```sh
node tools/tch-reference-validation.mjs           # → per-epoch triplet + the TCH solves
```

Drives the **real** modules (`cpapdex-edf/dsp`, `ecgdex-dsp`, `ppgdex-dsp`, `integrator-tch`) in a vm realm.
No personal data is reproduced in this brief: only estimator properties (bias, σ, ρ) — per the scope rule in
`CPAP-REAL-CORPUS-2026-07-11-BRIEF` §🔒.
