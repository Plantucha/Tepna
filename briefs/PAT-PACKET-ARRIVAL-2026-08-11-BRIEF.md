<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-08-11 · **Created:** 2026-08-11

# The PAT blocker is a per-connection BLE offset — record the arrival that makes it measurable

`PAT-WINDOW-CENSORING` left PAT blocked by capture rather than analysis. This brief names the blocker
exactly, records the four mitigations that were tested and eliminated, and ships the one that remains.

## 1 · The blocker

Every wearable pair in this corpus is separated by a **per-connection BLE buffering delay**. Measured
Verity-minus-H10 from the two devices' shared Polar epoch, across nights:

```
-867  -392  -261  -38  -1  +83  +94  +160  +270  +455  +645  +1030  +1044  +1148  +1321   ms
```

**2.2 seconds of spread** between recordings of the same two devices on the same host. PAT needs ~10 ms.

The offset is **constant per connection and arbitrary between connections** — confirmed structurally:
each PPG file spans exactly **one `link_epoch`**, so there is no second connection within a night to
difference against. The consequence is that **7 of 10 nights are anatomically impossible**: the ankle,
which is the longer path, reports arriving *before* the finger. That is what caps the usable corpus at
**2 site-nights of 10**, and why every new night is a coin flip.

## 2 · Four mitigations, tested and eliminated

| approach | verdict | evidence |
|---|---|---|
| **A better BT adapter** | No | Changes the MAGNITUDE, not the uncertainty. An unknown 200 ms is as fatal as an unknown 800 ms, and the dominant term is device-side batching, not host radio quality. |
| **PPS / stratum-1 host clock** | No | **The host clock cancels.** Every lag is `t_foot − t_R` and both stamps come from the same host, so any clock error is common and subtracts out. Measured host root dispersion is **2.3–2.6 ms** against a 400 ms problem — already 100× better than the term that matters. |
| **Respiration as a shared reference** | No | Right idea — a ~4–5 s period exceeds the whole ±1.3 s offset range, so it could resolve unambiguously where beats (mod one RR) cannot. But the hardware does not carry it: the **O2Ring is AC-coupled** (DC level 100, per-minute DC swing **6**, pulse amplitude 39) so RIIV cannot exist in it, and the **Verity's baseline swings 47× its pulse amplitude**, burying a ~1 % respiratory modulation. |
| **Heartbeat on the ankle ACC** | No | Chest ACC carries it strongly (**5.6–23.1×** a phase-scrambled control); the **ankle gives 1.37–1.45×** with no consistent arrival. The ballistocardiogram is a torso phenomenon, and a limb on a mattress is damped. |

A deliberate **sync tap** survives as a physical option but needs wakefulness, so it works only at
lights-out and wake. ⚠️ And a tap on one site is **not** a shared event: transient coincidence between
chest and ankle measures **1.1–1.3× chance**, and ankle–finger is *below* chance — independently
reproducing `ENVELOPE-ANCHOR-EXPORT`'s 3-shared-of-75. The workable form is to bundle all three sensors
and tap them together before donning, so one impulse genuinely reaches all three.

## 3 · Why the offset cannot be recovered from the signal files

The natural estimator is `min(host arrival − device timestamp)`: BLE buffering is **one-sided** — a
packet can only ever be late — so the minimum converges on the offset. This is NTP's minimum filter, it
needs no hardware, and both columns are already in every row.

**It fails, and the reason is in our own writer.** `StreamWriter` records each sample's `phone` stamp
**back-timed across the packet** from a single arrival, so every per-sample host stamp is a *derived*
quantity and the distribution's lower edge is smeared by the packet span rather than being an edge.
Measured across the corpus, the minimum sits **27–115 ms below the 1st percentile** — an outlier, not a
floor. Correcting by it moves 3/16 nights to 4/16, which is noise.

## 4 · The fix

`on_pmd` already computes the true `arrival` and then discards it after decoding. `PmdArrivalLogWriter`
records it, in a per-session `*_PMDARRIVAL.csv`:

```
Phone timestamp;device;meas;first_sensor_ns;last_sensor_ns;n_samples
```

- **The arrival is raw**, not derived and not back-timed, so `min(arrival − first_sensor_ns)` has a real
  floor and the per-connection offset becomes measurable.
- **`n_samples` is kept** because the packet span is exactly the width of the smear this replaces.
- **Written BEFORE the `writers.get(meas)` gate** — a stream with no writer still carries a usable
  arrival↔device pair, and the offset is a property of the **link**, not of whichever streams are on.
- **A sidecar, never a column**, for the reason `LinkLogWriter` states: the vendor `*_ECG.txt` /
  `*_PPG.txt` layouts are a POSITIONAL contract that ECGDex/PPGDex/MotionDex parse by index, and adding
  a field to them silently corrupted consumers once already (2026-07-18).
- **Telemetry, not physiology** — it must never enter a `ganglior.node-export` as a metric.

Volume is one line per packet, order 10–20 MB a night.

## 5 · What this does NOT do

- **It does not recover the existing corpus.** The offset is unmeasurable in nights already captured;
  those 2 usable site-nights stay 2. This makes *future* nights measurable.
- **It does not itself correct anything.** It records a measurement. Applying it — and proving the
  correction repairs the anatomical sign — is the next step and is deliberately not bundled here.
- **It assumes the offset is constant within a connection.** That is consistent with everything
  measured (within-night σ 29–36 ms against 2.2 s between nights) but has not been directly tested,
  and this sidecar is what would finally allow it to be.

## Done when

- [x] `PmdArrivalLogWriter` in `capture-host/writers.py`
- [x] wired into `on_pmd`, before the writer gate, with the callback protected
- [x] closed in the session teardown even when no packet ever lands
- [x] tests pin exact integer ns, distinguishable 8 ms arrivals, blank-never-zero, and an end-to-end
      min-filter that recovers a planted 400 ms offset within 5 ms of the 1st percentile
- [x] mutants killed: blank→0 (1 failure), arrival rounded to the second (2), ns as float (5)
- [x] capture-host suite **3257 passed**

Related: [`PAT-WINDOW-CENSORING-2026-08-11-BRIEF.md`](PAT-WINDOW-CENSORING-2026-08-11-BRIEF.md) ·
[`PAT-WANDER-ELIMINATION-2026-08-10-BRIEF.md`](PAT-WANDER-ELIMINATION-2026-08-10-BRIEF.md) ·
[`ENVELOPE-ANCHOR-EXPORT-2026-08-01-BRIEF.md`](ENVELOPE-ANCHOR-EXPORT-2026-08-01-BRIEF.md)
