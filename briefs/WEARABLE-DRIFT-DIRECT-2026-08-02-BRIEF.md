<!--
  WEARABLE-DRIFT-DIRECT-2026-08-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-02 · **Corrects:** `papers/wearable-clock-drift.html` scope note (90–216 ppm), `JOINT-UNWRAP-ATTEMPT-2026-08-02-BRIEF.md`, `WEARABLE-DRIFT-FIT-2026-08-01-BRIEF.md` · **Affects:** `tools/dual-clock-rate.mjs`

# The inter-device rate is ~7 ppm, and it was in the raw files the whole time.

Every beat-derived drift estimate in this brief family — mine at 39–96 ppm, the paper's scope note at
90–216 ppm — is built on the same stack: match beats, block them, unwrap a comb, regress a slope. Four
retractions have come out of that stack in two days.

**None of it was necessary.** Every Polar Sensor Logger / capture-host raw file carries **two clocks**:

```
Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]
2026-07-26T21:56:26.765;838432586543515816;0.0;-166
```

`Phone timestamp` is the **host** clock — chrony, local stratum-1, 0.008 ppm. `sensor timestamp [ns]`
is the **device crystal**. Regressing one against the other inside a single fragment gives that
device's rate offset in ppm, directly. No beat matching, no blocks, no comb, no unwrap.

## 1 · What it measures

Four nights, every fragment over 3 MB:

| device | ppm vs host | spread |
|---|---|---|
| **Polar H10** | −18.7, −19.1, −19.2, −20.0, −20.3, −20.5, −20.5, −21.6, −23.5 | **≈ −20 ppm**, ±2 |
| **Polar Verity** | −23.9, −26.0, −26.7, −27.1, −27.6, −30.2 | **≈ −27 ppm**, ±3 |
| Wellue O2Ring | −1441, −796, −645, −188, −3.4, **+141** | **not a clock** |

Each Polar device's rate is stable to ±2–3 ppm **across fragments within a night and across four
nights** — the signature of a real crystal offset, and the kind of repeatability no beat-derived
estimate in this family has shown.

**Inter-device rate = −20 − (−27) ≈ 7 ppm.**

## 2 · What that overturns

**7 ppm over a 7 h night is 176 ms** — comfortably under one RR (1190 ms at this subject's ~50 bpm).

- **The 90–216 ppm scope note is 13–30× too high.** A ramp that large would be 2.3–5.4 s per night, five
  times the tooth spacing.
- **My own 39–96 ppm figures are 6–14× too high** and are already retracted for a different reason
  (`JOINT-UNWRAP-ATTEMPT` §3.4).
- **Drift cannot produce a one-RR slip.** At 7 ppm you need ~47 h to accumulate 1190 ms. So every
  one-RR slip observed in beat matching is a **pairing failure, not clock drift** — which means an
  unwrap that removes slips and then reports the remaining slope as drift is removing the signal and
  fitting the noise. That is the mechanism behind the 89–216 ppm numbers.
- **It is close to the paper's v2 figure** (1.46 ppm median by `halfDrift`), same order and same
  conclusion: the clocks are, for this purpose, stable. v2's headline survives; the scope note added
  on top of it does not.

## 3 · Why the O2Ring's legs were always weak — a mechanism, at last

The O2Ring's `sensor timestamp` swings from **−1441 to +141 ppm between fragments of one night**. It is
not a disciplined counter and cannot be used as a clock. Every O2Ring pairing in
`CLOCK-CLOSURE-THREE-SOURCE` sat at 2–54 % correspondence against 13–22 % chance, and this is why —
not sensor quality, not physiology, not the night. **Any three-source closure that includes an O2Ring
leg is checking one good measurement against two derived from an unusable timebase.**

That also re-reads the closure results: the two nights that "closed" did so with O2Ring legs in them,
so their agreement is weaker evidence than it appeared.

## 4 · The re-anchoring question, answered

The paper's §(iii) argues the host path caps accumulated drift at 8.6 ms by re-anchoring every
fragment (median 3.0 min). That cap **does not apply on these nights**: the H10 ECG on 2026-07-26 is a
**single 208 MB fragment spanning 433 min**, not 3-minute pieces. So the H10 free-runs all night while
the Verity re-anchors across 47 fragments — the two paths are not symmetric, and §(iii)'s cap describes
a different capture regime than the one these ramps were measured in.

With the direct measurement in hand this matters less than it looked: at 7 ppm neither regime
accumulates enough to matter.

## 5 · Ships

`tools/dual-clock-rate.mjs <night-dir>` — subsamples every fragment > 3 MB, regresses host ms against
device ms, prints ppm per fragment. Reads the Clock Contract way (explicit regex → `Date.UTC`, never
`Date.parse`). Runs in seconds on a full night.

## 6 · Done when

- [x] Inter-device rate measured without beat matching, blocks, combs or unwrapping.
- [x] Repeatability shown across fragments **and** across nights (±2–3 ppm), which no beat-derived
      estimate here achieved.
- [x] The O2Ring's unusable timebase identified, with the mechanism for its weak legs.
- [x] The instrument shipped as a tool rather than left in a scratch script.
- [ ] *(owner)* Correct `papers/wearable-clock-drift.html`'s scope note; it is another session's paper
      and the correction is flagged there rather than applied.
- [ ] *(open)* Re-run closure using only the two Polar legs plus a third source that has a real clock.
      The O2Ring cannot be that third source.
