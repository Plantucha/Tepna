<!--
  OXYDEX-PB-OVERCALL-2026-07-31-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-08-01 · **Created:** 2026-07-31 · **Found while executing:** `CROSS-DEVICE-CLOCK-SKEW-2026-07-29-BRIEF.md` §3.4 · **Relates:** `ECGDEX-CARDIOPULMONARY-COUPLING-2026-07-30-BRIEF.md` §10 (same family)

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

- [x] The emission threshold's derivation and citation are read and recorded — **there is none** (§5.1),
      which settles it as a code problem rather than a base-rate one.
- [x] The operating-point sweep is run and published (`tools/pb-operating-point.mjs`) — and it lands on
      the honest possibility the item allowed: no threshold on this corpus is defensible (§5.2).
- [ ] The user-facing string states an observation rather than prescribing a therapy review.
- [ ] The fusion path is checked for an always-on-channel effect, and either fixed or shown inert.
- [ ] Whatever lands is gated, and mutation-verified against a revert.


---

## 5 · Answered 2026-08-01 — items 1 and 2

### 5.1 · The threshold's derivation: **there is no citation**

The emission gate is `detectOscillations`, and a 5-minute window is flagged when all three hold:

```
lowMotion    motion fraction < 0.08
sustained    >= 40 samples below SPO2_OSC_THRESHOLD
cross >= OSC_FLAG_CROSSINGS      crossings of the ABSOLUTE 95 % level
```

The three constants describe themselves, and what they say is the answer:

| constant | value | its own comment |
|---|---|---|
| `SPO2_OSC_THRESHOLD` | 95 | *"node-local: SpO2 oscillation crossing level"* |
| `OSC_WINDOW_SEC` | 300 | *"node-local: 5-min oscillation-analysis window (**algorithmic**)"* |
| `OSC_FLAG_CROSSINGS` | 6 | *"node-local: min 95%-crossings to flag a periodic-breathing window (**detector tuning**)"* |

No paper, no clinical criterion, no derivation — self-declared tuning. Under the Literature-Use Policy
that is the suite's own tier, never `validated`, which is consistent with how it is graded; the problem is
what the surface *says*, not the tier.

**And the gate contains no periodicity test at all.** AASM scores Cheyne-Stokes on a **40–90 s cycle
length**, **≥ 3 consecutive cycles**, and a **crescendo-decrescendo** envelope, measured against the
patient's **own baseline**. This gate checks none of those. `cycleLen` *is* computed — but only into
`meta`, after the decision; it never gates anything.

### 5.2 · The sweep: it is not measuring periodicity

`tools/pb-operating-point.mjs` (committed here; drives the SHIPPED `processNight`, no reimplementation)
over the 37-night reference corpus:

| | |
|---|---|
| nights flagged | **36 / 37 (97 %)** |
| median time within ±1 % of the 95 % crossing level | **64 %** |
| PB episodes vs **% of night below 95 %** | **r = 0.893** |
| PB episodes vs **mean SpO₂** | **r = −0.821** |

Overnight mean SpO₂ across the corpus is **94.6–96.6 %** — the baseline *straddles the crossing level on
every night*. And 1 Hz oximetry reports **integers**, so a trace dithering 94/95/96 crosses `>= 95`
continually with no breathing periodicity whatever. Six crossings in 300 s is not a discriminating bar
when the signal sits on the line for two thirds of the night.

**So the detector is, to a very good approximation, measuring mild hypoxemia burden.** That is a real
quantity — it is simply not the one the label names.

### 5.3 · The consequence for §3: this cannot be fixed by moving the threshold

Raising `OSC_FLAG_CROSSINGS` does not recover periodicity; it makes the detector a **stricter hypoxemia
threshold**, still labelled "periodic breathing". The brief's §4 allowed "no defensible threshold on this
corpus" as an outcome, and the sweep says that is the outcome: **the shape is wrong, not the number.**

This is the third instance of one pattern in a fortnight, and the resemblance is the useful part:

| | the feature | the wrong shape |
|---|---|---|
| `estimatedAHI` | CVHR index | relabelled with AHI's units and cut-points |
| apnea typing | chest-ACC effort | an **absolute** floor where AASM is baseline-relative |
| **PB** | SpO₂ crossings | an **absolute** 95 % level, no cycle-length criterion |

Twice already the answer was to withdraw the claim rather than retune it.

### 5.4 · What remains, and what it needs

- **§4 item 3** (the user-facing string). *"CS pattern likely — review CPAP pressure"* on 97 % of nights
  is an imperative resting on a hypoxemia proxy. Changing it is a small, defensible edit — but it is a
  **surface** decision (withdraw the instruction? withdraw the label? keep an unlabelled oscillation
  count?) and it belongs with the owner, not with a sweep.
- **§4 item 4** (the fusion always-on channel) — unmeasured here.
- A redesign that would earn the name needs baseline-relative crossings + a 40–90 s cycle-length
  criterion + ≥ 3 consecutive cycles. That is a new detector, and it should be its own brief with its own
  validation, not a patch to this one.

**Guardrail restated, because the sweep makes it tempting:** do not tune any of these three constants to
improve agreement with the CPAP's PB scoring on 39 nights of one subject. The device is not ground truth,
n = 1, and the earlier night-level agreement was κ = −0.039.