---
bump: minor
type: added
---

**The delivery delay is not a continuous random variable. It is an integer number of BLE connection
intervals, and `connection_lattice` now recovers that interval from the arrival stamps alone.**

A packet can only be delivered on a connection event. The circular concentration

    R(s) = | mean( exp(2i*pi*x/s) ) |

is 1 for a perfect lattice of spacing `s` and ~1/sqrt(n) for anything continuous. Scanning `s` finds
the period without being told it:

| stream | period | BLE units (1.25 ms) | R | streams with R>0.5 |
|---|---|---|---|---|
| Polar H10 ecg | **44.902 ms** | **35.92** → 36 | 0.937 | 9/9 |
| Polar H10 acc | 44.944 ms | 35.96 → 36 | 0.927 | 8/8 |
| Verity ppg | **30.014 ms** | **24.01** → 24 | 0.843 | 332/343 |
| Verity acc | 10.000 ms | 8.00 → 8 | 0.641 | 16/19 |
| Verity mag | 32.485 ms | 25.99 → 26 | 0.464 | 0/1 |
| O2Ring | — | — | — | **refused, 28/28** |

**H10 negotiates 45 ms, Verity 30 ms.** Neither is recorded anywhere; both were read off the data.
`ble_units` is the check that makes this a LINK parameter rather than a number the scan liked — the
Polar streams land on integers, and the O2Ring's 6.30 says its stack is not doing this.

**The control is what makes R mean anything:** adding U(0, 45 ms) to the H10 series collapses R from
**0.976 to 0.005**. Planted lattices at 7.5 / 12.5 / 30 / 45 ms recover to within 0.07 %; Gaussian,
uniform and exponential delays all score R ≤ 0.13.

## It REFUSES where the device axis is not a clock — which is the whole O2Ring

`delays` is `host - device`, and differencing removes the device's cadence **only if the device
supplied one**. Where the axis is drawn, the subtraction injects the device's own quantum instead: a
frozen stamp reduces the series to raw host inter-arrival times, and a 1 s counter stamps its quantum
on it.

**The O2Ring has no clock at all.** Of 28 streams, **19 have a frozen `last_sensor_ns` (every step
exactly 0) and the other 9 a 1 s quantised counter — not one is a clock.** Before the refusal the scan
reported **6.30 BLE units** for it, a non-integer at R 0.52, which is an artifact of measuring host
arrivals with a device quantum mixed in.

Two further things that number was hiding, both visible once you look:

- **R at 1000 ms reads 0.994–0.997** on those streams — and that is the *trivial* case the span guard
  exists to reject, not a discovery. Nearly all the mass sits in a band far narrower than 1000 ms, so
  every value shares a phase.
- The differenced-delay spread is only ~47 ms, so the guard caps the search at **~12 ms** — right at
  BLE's 7.5 ms minimum. There is barely a period in range to find even in principle.

After the refusal, **every reported row lands on an integer BLE unit count** (36, 24, 8, 26). That is
the tell that the surviving numbers are link parameters rather than whatever the scan liked best.
Same discipline as `hostAxis` refusing when there is no second clock, and it reuses the
`device_stamp_constant` fact the row already carries.

## Measured every session, never assumed — because the interval is NEGOTIATED

**The 45 ms and 30 ms above are observations, not constants.** The connection interval is negotiated
per connection: it belongs to this adapter, this stack and this link, not to the device model. Swap the
dongle — and this box has already been through one hardware replacement, with a different set of
radios — or let the peer renegotiate, and the number changes.

**This box already has two chipsets, and every number above came from one of them.** `hci0` is a
Realtek UB500 (`AC:A7:F1:29:9D:1D`, the adapter `config.yaml` pins) and `hci1` is an Intel part. With
`max_adapter_cycles: 3` and the UB500's known habit of going deaf, a capture landing on the other
radio is a real path — and a different controller can negotiate a different interval. So the 45/30 ms
figures are "what the Realtek negotiated on these nights", which is a narrower claim than it looks.

So nothing in the code carries a default or a candidate list. `connection_lattice` is given only the
delays and derives the period; `arrival_quality` runs it per stream per file, and the result lands in
each night's summary. A changed adapter then shows up as a **changed `period_ms`** rather than as
unexplained jitter that nobody can attribute.

Two tests pin this. One plants **26.25 / 48.75 / 18.75 / 3.75 ms** — intervals the corpus never
contains (21, 39, 15 and 3 BLE units) — so a baked-in 30/45 would still pass the corpus-shaped tests
and fail these. The other asserts two different links do not report the same interval.

## ⚠️ This RETRACTS the dual-Dirac reasoning in `2026-08-16-allan-mtie` and `-jitter-tail-honesty`

The MTIE changeset rejected dual-Dirac RJ/DJ because the tails were violently heavy. The tail-honesty
changeset then partly un-rejected it, on the grounds that several Verity streams are flat-topped
(excess kurtosis −0.9 to −1.1) and *"negative excess kurtosis is the dual-Dirac shape, so the
bounded/unbounded split may in fact apply"*.

**Both were reasoning from the wrong statistic.** Kurtosis cannot see this:

- The **H10 has the strongest lattice in the corpus (R = 0.95)** and excess kurtosis of **+8.6 / +5.5**,
  positive. A bounded deterministic component was there all along, in the streams the kurtosis test
  most confidently excluded.
- The flat-topped Verity streams are **not** two Gaussian-smeared humps. Their histograms are discrete
  spikes with empty bins between — a comb, not a dual-Dirac.

So the bounded component is real and universal on Polar links; "dual" was wrong (it is a multi-Dirac
comb), and **kurtosis sign does not indicate its presence**. Do not use kurtosis to decide whether a
quantisation model applies; use the lattice statistic, which measures the thing directly.

## Two things it is NOT

⚠️ **NOT a bound on the jitter.** The lattice is the GRANULARITY. The width spans many teeth — the
robust sigma is **2.6×** one interval on the H10 and **9.6×** on Verity ppg. A packet is late by an
integer number of connection events and that integer is not small.

⚠️ **NOT usable at sub-interval resolution.** The H10's 45 ms granularity is **4.5× PAT's 10 ms
budget**, so arrival stamps cannot support beat-level timing however many of them there are. That is a
property of the link, not of the sample size, and no amount of averaging removes it.

## The guard, which a planted test found the hard way

The period is capped at `spread / CK_LATTICE_MIN_CYCLES` (4). Without it the scan returns **its own
upper bound**: when one period covers the whole support every value shares a phase and R is trivially
~1. A planted 12.5 ms lattice on ±50 ms support was "recovered" as **300 ms**, the edge of the search
range. The test that caught it is in the suite.

Submultiples score high by construction — every multiple of 45 is a multiple of 22.5 and 15 — so the
scan takes the argmax, which lands on the fundamental because phase error scales as 1/s (H10: 0.982 at
45 ms vs 0.943 at 22.5 and 0.906 at 15). Reporting a submultiple would understate the granularity by
an integer factor.

Reported, gated by nothing. Cost is ~1 s for a 50 000-packet night (the series is strided to 4000
points for the scan).
