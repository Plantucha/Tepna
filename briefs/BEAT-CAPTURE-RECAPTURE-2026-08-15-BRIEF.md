<!--
  BEAT-CAPTURE-RECAPTURE-2026-08-15-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-15 · **Created:** 2026-08-15

# The adequacy rule is necessary and not sufficient — what inflates the missed-beat estimate is CONTAMINATION, not sparsity

> **Builds on #1292**, which implemented `CROSS-DOMAIN-METHODS-FOLLOWUPS §7` and found that the estimator
> *refuses on clean data*. That refusal is correct and stays. This brief adds the estimator that explains
> **why**, and closes the case the refusal does not watch.
>
> ⚠️ **This work was started in parallel with #1292 and duplicated it.** Both sessions implemented §7 the
> same day from the same brief. The duplicate driver was dropped on rebase and #1292's kept; what survives
> here is only what #1292 does not have. The avoidable cost was one session's driver, and the check that
> would have prevented it is one `gh pr list` against the brief a work-unit is about — the same rule
> `CLAUDE.md §📌` already states for editing a brief, which applies just as well to executing one.

## 1 · The gap, stated precisely

`beat-capture-recapture.mjs` refuses when any of the six informative cells is < 5 — the textbook
expected-cell adequacy rule for log-linear capture–recapture. It was written against a measured case: an
18.85-min window with cells 24/2/3 and 9/1/12 giving m₀₀₀ = 701 against ~970 real beats.

**A full night clears that rule in every cell and is still absurd.** Measured on 2026-08-12, 166.3 min of
three-way overlap:

`111: 9146 · 110: 262 · 101: 152 · 011: 74 · 100: 93 · 010: 159 · 001: 207` — observed **10 093**.

Every informative cell is ≥ 74. The rule passes. The estimator returns **m₀₀₀ = 9 500**, i.e. **48.5 % of
beats missed by everything**, and before this change it returned that as a bare number.

## 2 · The mechanism is contamination, and it needs a different instrument

The closed form multiplies the three **single-source** cells. A single-source cell is a mixture: a real
beat the other two detectors missed, *or* a spike this one detector invented. Detector false positives
therefore enter the numerator directly, and no count of cell sizes can see it — the cells are large,
they are just not all beats.

**The discriminator is the modified Chao** (Böhning, Rocchetti, Maruotti & Holling 2018, *Metrika*
81:361–375). Chao's lower bound `f₁²/2f₂` reads the same singletons and inflates with them; the modified
form `2f₂³/9f₃²` estimates f₁ from f₂ and f₃ and therefore **cannot**. The ratio between them measures the
contamination.

**Measured against planted truth** (deterministic, in the gate):

| regime | truth n₀ | log-linear | Chao | modified Chao |
|---|---|---|---|---|
| independent, p≈0.7 | 4 539 | 5 899 | 8 330 | 29 524 |
| **dependent** (shared per-beat difficulty) | 23 584 | 28 088 | 14 561 | 6 942 |
| dependent **+ 2 000 false singletons** | 23 584 | **32 411** | 16 010 | **6 932** |
| high capture p≈0.95, dependent | 1 871 | 2 544 | 1 092 | 357 |
| high capture **+ false singletons** | 1 873 | **4 808** | 1 669 | **357** |

False singletons push the log-linear up **89 %** and move the modified Chao by **0**. On the real night the
ratio is **699×**.

**⚠️ It is a diagnostic and a floor, never a competing point estimate.** Under the positive dependence this
corpus actually has, the whole Chao family **under-reads planted truth by ~70 %** and collapses toward zero
at high capture. Its `0` on the real night is *not* evidence that nothing was missed. An earlier draft of
this work claimed the modified Chao would give the right answer; its own gate falsified that, and the gate
now pins the under-reading direction so no reader can take the floor for an estimate.

## 3 · What changed

- `tools/capture-recapture.mjs` — the pure core (log-linear · Chao · modified Chao), gate-backed.
- `estimate()` in `beat-capture-recapture.mjs` now also publishes `chaoFloor`, `modifiedChaoFloor`,
  `oneInflation`, and a `warnings` array. **It warns rather than refuses**: the sparse rule already owns
  refusal, and adding a second one would silently change the contract for the existing caller.
- Its `estimate()` was **entirely ungated** before this. The group now pins the sparse refusal too.

## 4 · Two things the driver got right, confirmed independently

Re-derived while building this, from the same night and different code:

- **PAT +340 ms (arm), +402 ms (finger)** — positive, distal site lagging. This is the pipeline's only
  real validation and it is *physiological, not numerical*: a draft that hand-assembled `bandpass` +
  `detectBeats` instead of calling `detectChannel` skipped `orientByRise`, so on an inverted channel the
  "feet" were peaks and PAT came out **negative** — the pulse arriving before the heartbeat that caused
  it. Every count in that table was still perfectly plausible. (Separately: `bandpass` takes **four**
  arguments; called with two it returns a signal in which the detector finds **zero** beats, silently.)
- **`DexClock.hostAxis` reports `independent = true`** on all three streams, which §7's mod-one-heartbeat
  argument requires. The H10's **−19.3 ppm** independently reproduces `CLAUDE.md`'s −20.3 ppm from another
  night and another tool. The O2Ring's 987 ppm is its **drawn** timestamp, exactly as documented.

## 4b · THE COUNT TABLE CANNOT DETECT A SIGN ERROR — only the physiology can

Both sessions that built this hit the identical failure independently, and **neither was caught by any
number in the contingency table.** Without `orientByRise` an inverted optical channel yields "feet" that
are really peaks, and PAT comes out negative — the pulse arriving before the heartbeat that caused it.
Beat counts stayed plausible, cell counts stayed plausible, the estimator ran happily. The only signal was
that a physical ordering was impossible.

Cross-validated on the same night by two independent implementations: **+340 / +402 ms** here against
**+337.9 / +410.2 ms** in #1292. Any future work on this pipeline should treat the PAT sign and the
arm-before-finger ordering as a **precondition to be asserted**, not an output to be admired.

## 5 · What would make the count answerable

- [ ] **Split the singleton cells** — admit a single-source beat only if the waveform supports one at that
      instant on another channel (a sub-threshold check, not a detection). That turns an unidentified
      mixture into two counted populations and every estimator above becomes usable unchanged.
- [ ] **A fourth source would NOT fix this** and should not be reached for first: contamination enters
      every model identically, so it buys precision on a biased quantity.
- [ ] Re-run across the 37-night corpus once the split lands.

## 6 · Done when

- [x] The case the adequacy rule misses is identified, measured, and reproduced in the gate.
- [x] A discriminator that is blind to singleton contamination is implemented and validated against
      planted truth, including the direction and size of its own bias.
- [x] `estimate()` publishes the floors and warns, without changing its refusal contract.
- [x] `--scan` surfaces the diagnostic. Found in review by #1292's author: the survey mode — the one place
      per-window contamination shows up — printed `missed=9500 (48.5 %)` with no flag, because the REFUSED
      branch is loud and the estimated branch said nothing but the number. The formatter is now extracted
      as `estSummary` **so it can be gated**; inline in a `console.log` the only possible check is a source
      scan, and a source scan is satisfiable by a comment.
- [x] The one-inflation null is pinned as EXACT, not described. Under a homogeneous Poisson capture
      model both Chao variants reduce to the same f₀, so their ratio is **1 by construction** — verified
      algebraically and numerically over λ = 0.3 … 5.0 (1.0000 at every point, independently by two
      sessions). That makes the `> 5` bound structural rather than tuned, and the assertion fails if it
      ever stops being true.
- [x] Gate: `capture-recapture` — 38 assertions, fourteen mutants verified dead.
