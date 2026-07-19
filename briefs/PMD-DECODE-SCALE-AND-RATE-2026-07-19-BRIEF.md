<!--
  PMD-DECODE-SCALE-AND-RATE-2026-07-19-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS · **Created:** 2026-07-19 · **Closes (negatively):** `CAPTURE-HOST-FOLLOWUPS-II-2026-07-16-BRIEF.md` §Unvalidated — "GYRO/MAG/PPI decoders vs a PSL export" · **Related:** `CAPTURE-HOST-FOLLOWUPS-2026-07-16-BRIEF.md` (the `_decode_delta` origin)

> **Execution note (2026-07-19).** §2 and §3 are **landed** in `polar_pmd.py` (`axis_scale` + device-clock
> back-timing), wired through `capture.py` (`stream_scale` / `prev_ns`) and `writers.py` (float formatting
> for the now-scaled dps/gauss columns). capture-host pytest **136 pass**; every new assertion was verified
> to fail against the pre-fix decoder. Replaying tonight's REAL frame timestamps: MAG backwards stamps
> **1042 → 1**, and within-frame spacing now matches the end-to-end rate on both streams
> (GYRO 52.0000 → 51.6850 Hz, MAG 20.0000 → 20.5187 Hz). **Still open, so this is not DONE:** the fresh-capture
> acceptance in §4 (needs a restart of the live overnight run) and the §5 corpus rescale. One residual
> backwards stamp is a **device-level** out-of-order notification (its own `last_ns` regressed 78 ms) and is
> reported faithfully by design — see `test_an_out_of_order_frame_is_reported_faithfully_not_invented`.
>
> Two things the work surfaced that the plan did not anticipate, both now gated:
> - **float64 cannot hold a Polar timestamp.** ns-since-2000 is ~8.4e17, past the 2^53 exact-integer limit,
>   so pulling `last_ns` through the new float step silently rounded frame stamps to ~64 ns. The offset is
>   subtracted as an integer; the existing last-sample identity test caught it.
> - **a frame arriving CLOSER than nominal** fails the plausibility band, and the nominal fallback then
>   over-reaches. A non-overlap clamp was added: a frame may never start before its predecessor ended.
>
> Bonus: rounding the offset per sample instead of truncating the step removes an accumulating error
> (0.69 ns/sample at 130 Hz — 138 ns at back=200).

# PMD decode — two defects in `polar_pmd.py`: a missing scale factor and a nominal-rate assumption

`CAPTURE-HOST-FOLLOWUPS-II` listed the GYRO/MAG decoders as **unvalidated** ("only delta path /
motion-response seen"). They have now been validated against a real overnight capture. **Both are
wrong**, in two independent ways. Neither produces a decode error, an exception, or a gate red — both
produce plausible-looking numbers that are physically impossible on inspection.

Everything below is measured from the night of **2026-07-19**: Verity segment `20260719045736`
(~56 min, 4 streams) and H10 segment `20260719023533` (~198 min), at
`~/tepna-smoketest/captures/2026-07-19/`. `capture-host/` is out-of-suite, so no `manifestHash` moves
and no bundle/provenance gate applies; the regression surface is `capture-host/tests` (pytest).

---

## §1 · What is provably CORRECT (don't re-investigate)

Recorded so the next audit doesn't re-tread these. Each is a physical cross-check that can only pass
if the decode, byte order, and axis packing are all right:

- **ACC is native mg and decodes exactly.** Per-sample gravity magnitude: **H10 median 1000.9 mg**,
  Verity 987.6 mg. A stationary accelerometer must read 1 g. This also proves ACC is delivered in mg
  by the device and must **not** be scaled by `range/2^15` — see the §2 trap.
- **H10 HR vs RR agree to 0.1 bpm** — device HR median 54, RR median 1114 ms → 53.9 bpm. Two
  independently decoded columns. (This clears the *capture* side only. The open
  `ECGDex parseDeviceHR reads the wrong column` defect is on the Dex read side and is untouched.)
- **ECG is perfect**: 130.0000 Hz true rate, sensor steps exactly 7.6923 ms, zero non-monotonic,
  zero gaps over 198 minutes, amplitude −821…978 µV.
- **O2Ring PPG**: 125.754 Hz measured vs `ppg_fs: 125.738` configured — 0.013%. That constant is well
  calibrated; leave it.
- The **2026-07-18 byte-alignment fix** (`d9b8b51`) is in the running process and holding. Sample
  *counts* per frame are correct on every stream (proven in §3).

---

## §2 · Defect A — GYRO and MAG are written as raw int16 LSB, labelled `[dps]` and `[G]`

**Locus.** `polar_pmd.py:271–275` returns `_decode_delta(...)` output straight through with no scale
(the comment says "raw"). `capture.py:395–396` passes it to `writers.py:75–76`, which labels the
columns `X [dps]` / `X [G]`. The device reports `range=[2000]` (gyro) and `range=[50]` (mag) during
negotiation and **`parse_settings_response` already parses them** — the factor is available and unused.

**Proof it's wrong.** The written values exceed the device's own declared range. Gyro X min −2925,
Y max 6000, Z min −3342 — all outside ±2000 dps. Impossible for a sensor configured to ±2000.

**Fix.** Apply `range / 2^15` at decode:

| stream | factor | as written | corrected |
|---|---|---|---|
| GYRO | 2000/32768 = 0.061035 dps/LSB | X/Y/Z bias −47.2 / +34.2 / −20.7 | **−2.88 / +2.09 / −1.26 dps** |
| MAG | 50/32768 = 0.0015259 G/LSB | \|B\| ~1280 LSB | **see below** |

A ~3 dps zero-bias is textbook uncalibrated MEMS. As written, the file claims a sleeping arm rotating
continuously at 47°/s.

### §2.1 · MAG: the "field is 2× too strong" reading is a TRAP — it is hard-iron offset

A first pass suggested MAG needed empirical calibration rather than `range/2^15`, because the scaled
magnitude came to 1.95 G against Earth's 0.25–0.65 G. **That conclusion was wrong.** A least-squares
sphere fit over 81,693 samples:

- hard-iron centre = **(−493.9, −187.5, +1129.2) LSB**
- true field radius = **270.3 LSB**, fit residual 3.9% (the data lies cleanly on a sphere)

The raw magnitude of ~1280 LSB is almost entirely **hard-iron offset**. Scaled properly:
270.3 × 0.0015259 = **0.41 G ≈ 41 µT**, squarely inside Earth's 25–65 µT.

So **MAG takes the same one-line fix as GYRO.** The hard-iron offset is a normal uncalibrated-
magnetometer property (bed frame, capture box) and is a *separate, later* concern — do not conflate
them, and do not "fix" the scale to compensate for the offset.

**The trap to avoid:** ACC is native mg and must NOT be scaled; GYRO/MAG are raw LSB and MUST be.
Applying `range/2^15` uniformly to all three would break the one stream that currently works.

---

## §3 · Defect B — back-timing uses the NOMINAL rate; the Verity's real rates differ by up to 2.6%

**Locus.** `polar_pmd.py:251` — `step_ns = int(1e9 / fs)`, where `fs` is the *negotiated nominal*
rate. Each sample is then stamped `last_ns - back * step_ns` (`:292`). The Verity's actual sample
clocks do not match their nominal labels:

| stream | nominal | **true rate** | independent check (host arrival clock) | error |
|---|---|---|---|---|
| MAG | 20 | **20.5160 Hz** | 20.514 | **+2.58%** |
| GYRO | 52 | **51.6842** | 51.685 | −0.61% |
| ACC | 52 | **51.6724** | 51.688 | −0.63% |
| PPG | 55 | **55.1318** | 55.133 | +0.24% |
| ECG (H10) | 130 | **130.0000** | 130.001 | 0.00% |

Two fully independent clocks — the device's own `last_ns` and the host's arrival time — agree to four
significant figures. These rates are real.

**The sign of the error decides the symptom, which is why this hid for so long:**

- MAG's true rate is **faster** than nominal, so the real interval (48.74 ms) is *shorter* than the
  assumed 50 ms → back-timing over-reaches into the previous frame → **678 backwards timestamps**,
  min dt **−112.6 ms**, up to **145.9 ms** of overlap at a frame start.
- GYRO/ACC are **slower** than nominal → back-timing under-reaches → **silent gaps**, up to 22.1 ms
  per frame. No backwards stamps, so these streams *look* clean. **They are not.** Same defect,
  benign-looking sign. Every sample in a frame is mis-stamped, worst at the frame start.

**Why the H10 is exempt:** ECG comes off the H10's primary clock. The Verity's streams sit on separate
sensor dies — accel/gyro share one oscillator (51.672 vs 51.684, within noise of each other), the
magnetometer has its own (+2.6%), the optical front-end its own (+0.24%). Each free-runs uncalibrated.
Polar's "20 Hz" is a label, not a guarantee.

### §3.1 · Two hypotheses that were tested and KILLED — do not re-open

1. **"The delta decoder over-reads padding and fabricates samples."** Killed. If a spurious block were
   being read, the excess count would be **constant** per frame. It is strictly **proportional** to
   frame length: MAG frames of 95→116 samples all give error/size = 0.0250; GYRO frames of 71→188 all
   give −0.00611. A constant ratio across a 2.6× spread in frame size is the signature of a wrong time
   step. **Sample counts are correct on every stream.**
2. **"`int()` truncation in `step_ns` accumulates."** Killed. Worst case 0.69 ns/sample →
   0.00014 ms over a 200-sample frame. Six orders of magnitude too small.

### §3.2 · Fix

Stop trusting nominal — derive the step from the device's own timestamps:

```
step = (last_ns[N] - last_ns[N-1]) / count[N]
sensor_ns[i] = last_ns[N] - (count[N] - 1 - i) * step
```

This is exactly continuous across frame boundaries and self-calibrating to the real hardware rate.
Guards required:

- **First frame after connect** has no predecessor → fall back to nominal.
- **Reject an estimate more than ~10% off nominal** — a dropped frame inflates `last_ns[N] - last_ns[N-1]`
  and would otherwise stretch the step. Fall back to the last good estimate.
- The **phone-timestamp** back-timing (`arrival - back/fs`, `:291`) must use the same corrected rate,
  or the two timestamp columns will disagree.

`decode_frame` is currently stateless per call; this needs a per-`(device, meas)` running estimate.
Either thread it through the existing `fs` argument from `capture.py` (which already computes and
passes `fs`) or give the decoder a small per-stream state object. Prefer the former — it keeps
`decode_frame` pure and puts the state where the stream lifecycle already lives.

---

## §4 · Done when

- [ ] GYRO/MAG scaled by the device-reported `range / 2^15` at decode; ACC left native-mg and
      explicitly commented as such so a later sweep doesn't "unify" it.
- [ ] Gyro at rest reads a bias of order ±3 dps; MAG sphere-fit radius scales to 0.25–0.65 G.
- [ ] Back-timing derives its step from consecutive `last_ns`, with the first-frame and
      dropped-frame guards above.
- [ ] A fresh Verity capture shows **zero** non-monotonic sensor timestamps on MAG, and measured
      phone-clock fs matches sensor-clock fs on all four streams.
- [ ] `capture-host` pytest covers: a two-frame sequence at an off-nominal rate (asserting continuity
      across the boundary, both signs), the first-frame fallback, the dropped-frame guard, and the
      gyro/mag scale (including an ACC case asserting it is NOT scaled).
- [ ] Spawn `PMD-DECODE-SCALE-AND-RATE-FOLLOWUPS-…` per `CLAUDE.md` §📌 or state in this header that
      nothing surfaced.

## §5 · Corpus impact — what this invalidates

The scale defect is **structural in the decoder**, so it affects **every Verity capture ever taken**,
including the tri-device nights behind the reference-free σ work. Any analysis that consumed Verity
GYRO or MAG in physical units is wrong by 16.4× (gyro) / 655× (mag). Re-derivation is cheap — the raw
LSB values are correct and the fix is a pure multiply, so **committed captures can be corrected in
place by rescaling; they do not need re-recording.** The timing defect likewise needs no re-capture:
each frame's `last_ns` is preserved in the written files, so timestamps can be recomputed offline.

Per `CLAUDE.md` §🎫, any metric that consumed these in physical units should have its evidence tier
re-checked before it is trusted again.

## §6 · Adjacent, NOT in scope (recorded so it isn't lost)

The same night showed the **O2Ring reconnecting 359×** (median 16 s between segments, 74% capture
yield, 84 zero-row files). Root cause is **link margin, not code**: all three devices lost ~30 dB at
21:00→22:00 and the ring sits at −83 dBm median, and it is the only device requiring a **1 Hz uplink
write** (`capture.py:777`) where the Polars are notify-only after setup (`capture.py:438`). Two
software aggravators worth their own brief: a reconnect opens a **new file set** (`capture.py:782`
closes the writers), shredding the night; and the **RTC re-syncs on every connect**
(`capture.py:771–774`) — 359 clock writes on an already-marginal link.
