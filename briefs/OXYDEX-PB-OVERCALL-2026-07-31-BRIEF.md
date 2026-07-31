<!--
  OXYDEX-PB-OVERCALL-2026-07-31-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-07-31 · **Found while executing:** `CROSS-DEVICE-CLOCK-SKEW-2026-07-29-BRIEF.md` §3.4 · **Relates:** `ECGDEX-CARDIOPULMONARY-COUPLING-2026-07-30-BRIEF.md` §10 (same family)

# OxyDex emits periodic breathing on 92 % of nights; the machine scores it on 13 %

Measured over **39 paired nights**, OxyDex emits a `periodic_breathing` ganglior event on **36**, while
the ResMed's own device-scored PB fires on **5**. Chance-corrected agreement is **κ = −0.039** — not
weak agreement, *none*.

| | OxyDex PB | OxyDex none |
|---|---|---|
| **device PB** | 4 | 1 |
| **device none** | 32 | 2 |

Reproduce: `node tools/pb-agreement.mjs --cpap <cpap-corpus.json>`.

---

## 1 · Why this is worth a brief rather than a shrug

**It is the `estimatedAHI` shape again.** That field was retired (`ECGDEX-CARDIOPULMONARY-COUPLING`
§10) because it published a clinically-labelled number resting on a correlation nobody had measured.
This is the same failure one node over: a **detector that fires on nearly every night** is not
carrying information, whatever its threshold was tuned to. A flag that is almost always on cannot
distinguish the nights it is meant to distinguish.

**It reaches a user with an instruction attached.** The pattern surface reads *"CS pattern likely —
review CPAP pressure"*. Telling someone to review their therapy pressure on 9 nights in 10 is not a
conservative default; it is noise with an imperative mood.

**It reaches the fusion layer as a currency.** `periodic_breathing` is a `ganglior_events` impulse, so
the Integrator's corroboration logic consumes it. An always-on channel degrades every rule that
counts observers.

## 2 · What is NOT established, and must not be assumed

- **The device is not ground truth.** It scores from flow with its own thresholds; OxyDex scores SpO₂
  oscillation. Disagreement means they do not measure the same thing — *not* that OxyDex is wrong.
  A conclusion of "OxyDex over-calls" needs a reference the corpus does not contain.
- **n = 1 subject.** Same bar as everywhere else in this suite: nothing here supports a population
  claim, and no badge moves on it.
- **The threshold's origin has not been read yet.** Before anything is re-tuned, the detector's own
  derivation and cited basis must be checked — it may be correctly implementing a published rule whose
  base rate simply does not fit a treated-CPAP subject.

## 3 · What to do

### 3.1 Read the detector's basis before touching a number
Find where the emission threshold comes from (`oxydex-dsp.js` oscillation / cycle-length path) and
what it cites. **If it implements a published rule faithfully, the finding is about the POPULATION,
not the code** — the honest fix is then a tier/wording change, not a threshold change.

### 3.2 Measure the operating point, do not guess it
The §9.3 discipline from `DEEP-STAGE-DESAT-CONFOUND` applies exactly: sweep the emission threshold and
report what each operating point *does* — how many nights it flags, and what agreement it buys against
the only independent label available. **A threshold chosen to make κ look better on 39 nights of one
subject would be overfitting**, so the deliverable may well be "no threshold is defensible here".

### 3.3 Temper the user-facing imperative regardless
Independent of any threshold work: *"review CPAP pressure"* is an instruction, and it is being issued
on 92 % of nights. Even if the detector is judged correct, the wording should state what was observed
(SpO₂ oscillation consistent with periodic breathing) rather than prescribe an action.

### 3.4 Check the fusion blast radius
Determine whether an always-on `periodic_breathing` channel inflates any Integrator corroboration
count, the same way a second oximeter must not double the apnea index (`integrator-dsp` §3.1).

## 4 · Done when

- [ ] The emission threshold's derivation and citation are read and recorded — including the verdict
      on whether this is a code problem or a base-rate problem.
- [ ] The operating-point sweep is run and published, with the honest possibility that no threshold on
      this corpus is defensible.
- [ ] The user-facing string states an observation rather than prescribing a therapy review.
- [ ] The fusion path is checked for an always-on-channel effect, and either fixed or shown inert.
- [ ] Whatever lands is gated, and mutation-verified against a revert.
