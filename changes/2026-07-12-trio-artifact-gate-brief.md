<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: TRIO-ARTIFACT-GATE-AND-N15-POWER-2026-07-12-BRIEF.md
---
Record that the three-cornered hat has no robustness to artifact — 3 bad epochs of 86 inflated a corner's σ from 2.5 to 9.6 bpm — and specify the validated cross-corner consensus gate that fixes it.

Re-running the `SENSOR-TRIO-NIGHTS` power analysis at **N = 15** (the PpgDex detector fix recovered 5 nights
at zero capture cost) did NOT tighten the answer. It exposed that **both** surviving σ estimates were
artefacts of epoch hygiene, in **opposite** directions:

- **H10 was pessimistic.** `2026-06-12` reports σ_H10 = 9.60 bpm — the only night in the corpus with a
  multi-epoch ECG burst. Three consecutive epochs (3.5% of the night) where the beat count more than doubles
  (253 → 593) and SQI drops (0.52 → 0.37): spurious QRS on a noisy 15-minute window. SD(ECG−OxyDex) is 8.77
  bpm across the night, **2.51 with those 3 epochs removed**. Excluding that one night collapses H10's CI
  from **±1.278 → ±0.296** (a 4.3× inflation), and H10's true σ is ~1.5 bpm — the *tightest* corner, the
  opposite of what the raw numbers say.
- **Verity was optimistic.** The 5 nights `sensor-trio-worker.js`'s gate had discarded as "poor PPG contact"
  carry σ 1.40 / 2.43 / 5.00 / 5.48 / 6.19 — three of them above EVERY one of the ten survivors. The gate was
  censoring the hard nights, so the surviving ten were the easy ones. Uncensored, Verity's CI goes
  **±0.396 → ±0.847** (worse, against a 1/√N prediction of ±0.32): the 1/√N law assumes exchangeable windows,
  and a quality gate makes them non-exchangeable by construction. The MEDIAN is robust (1.94 → 1.85), so the
  papers' headline σ stands; the mean and CI were optimistic.

Root defect: TCH recovers σ from the variances of pairwise differences, and variance is dominated by outliers,
so a few bad epochs do not perturb σ̂ — they REPLACE it. No number of extra nights fixes that.

Validated solution (numbers in the brief): a **cross-corner consensus gate** — drop an epoch where one corner
disagrees with BOTH others by >10 bpm. On the committed corpus it takes 06-12's σ_ECG from **8.70 → 0.43** and
leaves the 8 clean nights bit-for-bit unchanged. It is **AF-safe by construction** (real arrhythmia appears in
all three corners, so no corner can disagree with the other two) — unlike a naive "RMSSD implausible ⇒ reject"
rule, which would silently suppress atrial fibrillation.

Also identified: **ECGDex's 5-min epochs carry no quality field at all** — the node computes per-beat SQI and
then discards it, so no consumer can tell a 118 bpm artifact epoch from a real one. That is the actual gap, and
the brief specifies the additive fix.

Docs only. No code, no gate, no published figure changes.
