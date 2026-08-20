<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-08-11 · **Created:** 2026-08-11 · **Followed-by:** `PAT-OFFSET-ESTIMATOR-FOLLOWUPS-2026-08-12-BRIEF.md`

# Spend the arrivals with a published estimator, not a third hand-rolled one

`PAT-PACKET-ARRIVAL` records the true per-packet arrival so the per-connection BLE offset becomes
measurable. It deliberately stopped short of measuring it. This is the estimator, and it is taken from
the networking literature rather than invented here — the invented ones have now failed twice.

## 1 · Why not another quantile

The two attempts so far were both single-estimator and both produced a number with nothing to check it
against: the per-sample min-filter (defeated by back-timed stamps) and `floor_ms`'s low quantile. The
literature on this exact problem — recovering a clock offset from ONE-SIDED delay measurements — is
forty years old and settled, so two published estimators are implemented instead:

- **`lower_envelope`** — Moon et al., *Estimation and Removal of Clock Skew from Network Delay
  Measurements* (UMass CS-1998-043): the line lying below all points, as close as possible, stated as
  an LP. **It needs no solver.** The objective's gradient is non-negative once `t` starts at 0, so the
  optimum is at a vertex — two active constraints — i.e. a line through two points below all the rest.
  Those are exactly the edges of the points' **lower convex hull**, so the LP collapses to a hull walk:
  exact, O(n) on sorted input, no dependency, nothing to tune.
- **`paxson`** — partition into subsets, take each subset's minimum, Theil-Sen slope through those.

## 2 · The structure both exploit — and why one estimator covers both devices

Every error term between the two columns is **one-sided positive**: a packet can be late and never
early; a whole-second counter reports at or below the true device time, so the measured delay lands at
or above the true one. Two unrelated physical causes, one sign — so the truth is the lower envelope of
the delay cloud in both cases, and the Polar leg and the ring leg need no separate code path.

## 3 · Two estimators, because each breaks where the other does not

| | fails when | measured |
|---|---|---|
| `lower_envelope` | ONE early packet — it constrains the line below *every* point | a single point 500 ms early moved it **818 ms**; Paxson moved 1.0 ms |
| `paxson` | few points with heavy jitter AND quantisation together | worst error **614 ms** over 9600 planted configurations |

Neither is trustworthy alone, and the sweep shows no threshold that picks the winner. So **both run and
a single `offset_ms` is published only where they agree** (`AGREE_MAX_MS = 10`, PAT's requirement).
Over 19200 configurations, half carrying a planted early outlier:

- certified LP error **p99 6.08 ms, worst 15.93 ms**;
- **not one** outlier-carrying configuration was ever certified — the failure mode that catastrophically
  breaks the envelope is caught every time;
- certification rate **48 %** across the whole sweep including brutal corners, **77 %** in the regime a
  real night occupies (n ≥ 2000 over 8 h, jitter ≤ 30 ms).

⚠️ Agreement within 10 ms is a **correlate** of accuracy, not a bound on it — the worst certified error
is 15.93 ms. Quote it that way.

## 4 · Validated on real box captures, against a known-identical truth

No `*_PMDARRIVAL.csv` exists yet (the sidecar deployed today; tonight is the first). So the estimator
was run on the existing box-captured Polar files, which carry the same two columns, and checked against
`DexClock.hostAxis` — the suite's shipped estimator of the same rate.

**Every H10 `_ECG` and `_ACC` pair comes off the SAME crystal, so their true rates are identical by
construction** — the difference between the two streams is each estimator's error, with no ground truth
needed and nothing to calibrate. Four such pairs exist in the box corpus:

| pair | `lower_envelope` ECG / ACC | \|diff\| | `hostAxis` ECG / ACC | \|diff\| |
|---|---|---|---|---|
| 08-01 `023848` | −20.93 / −20.81 | **0.12** | −19.16 / −13.38 | 5.78 |
| 08-01 `224539` | −20.89 / −20.93 | **0.04** | −20.85 / −20.70 | 0.15 |
| 08-02 `221425` | −22.07 / −22.24 | **0.17** | −23.22 / −25.35 | 2.13 |
| 08-03 `212154` | −20.31 / −20.37 | **0.06** | −22.26 / −21.52 | 0.74 |
| | | **worst 0.17 · mean 0.10** | | worst 5.78 · mean 2.20 |

**34× better worst-case, 22× better mean**, and the mechanism is plain: `hostAxis` runs a median, so it
tracks the delay distribution's **centre**, and buffering width changes across a night. The envelope
tracks the **edge**, which those changes do not move. This also closes `PAT-PACKET-ARRIVAL` §6's
within-device control, left there as "measurable rather than needing code".

⚠️ This measures **self-consistency, not accuracy** — two streams could agree and both be wrong, though
they cannot do so by anything that differs between streams. And it is not a criticism of `hostAxis`,
which exists to interpolate a correction rather than to quote a rate (Clock Contract §7 says so
explicitly, and documents its own end-bias).

The Verity segment on 08-04 — 196 points over 0.49 h — was correctly **refused** (`certified: false`,
`agree_ms` 25.2, `skew_quotable: false`).

## 5 · ⚠️ A correction to `PAT-PACKET-ARRIVAL` §6

That brief justified fitting the ring on the grounds that *"a minimum over a quantised counter returns
the quantum"*. **It does not.** The quantisation residual depends on where each frame falls between
ticks, and across a recording it comes near enough to 0 that a minimum still finds the edge — worst
error **31.5 ms over 270 zero-skew configurations, 3.2 % of the 1000 ms quantum**.

The real reason to fit — **on every device, not just the ring** — is that a minimum has **no time
model**. It returns one number for a quantity that moves across the recording, so it is wrong by
roughly half the span's drift: measured at **242 ms** on the real 8 h H10 capture above, and **705 ms**
on a ring at the 55 ppm §6 itself reports. PAT's budget is 10 ms.

Written by the same session that wrote the claim, one day later, because the test that was supposed to
demonstrate it failed. Both the module and a named test now pin the correction.

## 6 · What this does NOT do

- **It does not correct anything yet.** `nightqc` reports the estimate; no export consumes it, and
  whether correcting both legs repairs the anatomical ankle−finger sign is the next step, untested.
- **It does not rescue the existing corpus.** The offset is still unmeasurable in nights captured
  before the sidecar.
- **It does not certify most short segments,** by design. A refusal is the correct output where the
  estimators disagree, and 23 % of even good-regime nights will refuse.
- **`floor_ms` stays** as the smear diagnostic — "did this stream have an edge at all" — which is a
  different question from "what is the offset", and the two will not agree on any skewed night.

## Done when

- [x] `capture-host/clock_offset.py` — `lower_envelope` (hull-walk LP), `paxson`, `estimate`
- [x] refusals return `{ok, reason, n}` and no readable offset — the `hostAxis` contract
- [x] `offset_ms` is None wherever the two estimators disagree
- [x] `t_ref_sec` published, so a centroid value cannot be misread as the offset at t=0
- [x] wired into `nightqc.arrival_quality`, running on the ring as well as the Polar legs
- [x] the §5 correction pinned by `test_the_quantum_alone_does_not_contaminate_a_minimum`
- [x] capture-host suite green at 100.00 % statement AND branch under CI's exact command

Related: [`PAT-PACKET-ARRIVAL-2026-08-11-BRIEF.md`](PAT-PACKET-ARRIVAL-2026-08-11-BRIEF.md) ·
[`PAT-WINDOW-CENSORING-2026-08-11-BRIEF.md`](PAT-WINDOW-CENSORING-2026-08-11-BRIEF.md)
