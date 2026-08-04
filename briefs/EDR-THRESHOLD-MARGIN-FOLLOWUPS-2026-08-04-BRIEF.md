<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-04 · **Spawned-by:** `ECGDEX-EDR-RESP-ACCURACY-2026-07-31-BRIEF.md` (executed; §6.4 is the finding this follows up)

# A gate can pin a fix that is 0.035 from failing — margin is a measurement, not a property of green

## 1 · What happened

`ECGDEX-EDR-RESP-ACCURACY` shipped a harmonic check to stop `crc.respFromEDR` reading exactly half at
24 breaths/min. It was gated on five seeds at 900 s, the isolation was done carefully (§6.2 explicitly
warns that a single-condition isolation of this estimator is not evidence), and every leg was green.

The check was nonetheless failing. Its threshold, `ac[half] > 0.8 * best`, sat **0.035 above** the value
the true answer actually carries (0.745). At 180 s, 300 s and at 1800 s on one seed, 24/min still read
~12. The gate pinned 900 s, which is one of the lengths where the marginal comparison happened to land
the right way.

**Nothing in the process was skipped.** The brief measured, isolated, seeded, and pinned. What it never
did was ask *how close the passing comparison was to failing* — and the answer was 0.035 on a scale
where the correct decision boundary is 1.7 wide.

## 2 · The transferable rule

> When a fix is a **threshold**, the gate must pin the **margin**, not just the outcome. A green
> assertion says the comparison went the right way once; it says nothing about how nearly it didn't.

Two cheap habits follow, and §6.4 used both:

- **Measure the two populations, then put the threshold in the gap.** Not "0.8 feels permissive" but
  "wrong cases measure −1.26…−2.89, right cases +0.745, so 0.5 has 0.245 of margin either side." A
  threshold chosen from a measured separation is auditable; one chosen from reasoning is a guess with a
  comment attached.
- **Ask what the threshold means physically.** `0.8` encoded "close to equal", which is the wrong claim —
  an attenuated fundamental is *not* close to equal. The right claim was a **sign** test (anti-phase vs
  a real peak). Getting the kind right is what moved the margin from −0.035 to +0.245; any numeric tuning
  of 0.8 would have left it fragile.

## 3 · What is owed

- [ ] **Audit the suite's other tuned thresholds for margin.** The candidates are the literal ratio/factor
      constants inside detectors that a gate pins only by outcome. For each: what are the two populations,
      where does the constant sit between them, and is that recorded? Start with the ones a single golden
      pins. This is a *survey* — the deliverable is a table of `constant · separation · margin`, and only
      the ones with thin margins become work.
- [ ] **Where a threshold's margin is thin, prefer re-deriving the KIND of test** (sign, order-of-magnitude,
      physical admissibility) over re-tuning the number, and record the measured separation beside it.
- [ ] **A duration/seed sweep becomes standard for `genSynthetic`-gated estimators.** §6.2 already found
      that this estimator's behaviour moves with record length and seed, because both change where the
      carrier's phase falls on the 4 Hz EDR grid. Any estimator with that property must be pinned at more
      than one length, or the pin is a coincidence. `respAt(bpm, seed, durSec)` now takes the length.

## 4 · Explicitly NOT owed

- **Re-opening §6.3's parabolic-interpolation decision.** It is measured, the trade is stated (synthetic
  aggregate says remove, the one real night says keep), and it is routed to the owner. It is not a margin
  question.
- **Option 3, the 8–12/min low band.** Still deliberately not taken; it needs a steeper `_bandResp` and
  moves every CRC metric fleet-wide. The sign test does not reach the low edge and does not pretend to.

## Cross-references
- Parent: `ECGDEX-EDR-RESP-ACCURACY-2026-07-31-BRIEF.md` §6.4 (the correction) and §6.2 (the pass that
  came one step short — its reasoning is sound and worth reading before doing the §3 audit).
- Related failure class: `ui-export-paths-broken` — machinery that passes without exercising anything.
  This is its quieter sibling: machinery that *does* exercise the thing, and passes by a hair.
