<!--
  DEVICE-RATE-TRUTH-2026-08-05-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-08-05 · **Extends:** `H10-ECG-RATE-CORPUS-CHECK-2026-08-04-BRIEF.md`

# Every sample rate in this fleet is a label, and we measured all of them

> **The H10 leg of this is not new.** `H10-ECG-RATE-CORPUS-CHECK-2026-08-04` already established that
> "exactly 130.0000" is wrong, from **50 files of the vendor's own PSL decode** — a better corpus than
> this brief's 23 box captures, and it owns the `PMD-DECODE-SCALE-AND-RATE` §140 and `polar_pmd.py:492`
> corrections. Our independent measurement **agrees in sign and order** (median 129.9876 against its
> 129.9888; spread 129.951–130.072 against its 129.887–130.088) and is a same-direction confirmation
> from a different decoder, nothing more.
> What this brief adds to it is the **mechanism** — §4.1 below — which explains where its §1 table's
> `130.0000` specifically came from. The other figures in that table are different quantities measured
> different ways; this brief does not account for them and does not claim to.

The advertised rate of every stream we capture is wrong, by between 0.01 % and 2.9 %, and the errors are
not a common-mode clock offset — they are **separate oscillators inside each device**, one per sensor
die. This brief records what each rate actually is, identifies the silicon behind it from FCC filings
and vendor SDKs, corrects six prior briefs, and sets the capture configuration.

It also corrects **fifteen claims made during its own investigation**, which is the more useful half:
this brief's method notes are as load-bearing as its numbers.

---

## 1 · Measured rates

Measured against each device's **own** timestamp clock, so the oscillator error cancels and what remains
is the divider ratio. Post-`80e05501` captures only (see §4.1).

| stream | label | measured | vs label | clock |
|---|---|---|---|---|
| H10 ECG | 130 | **129.9876** | −105 ppm | RC-class (Polar spec ±2 %) |
| Verity ACC | 52 | **51.6825** | −6 107 ppm | ST LSM6DS-family internal RC |
| Verity ACC | 416 | **413.4706** | −6 080 ppm | same die |
| Verity GYRO | 52 | **51.6814** | −6 120 ppm | same die |
| Verity PPG | 55 | **55.1293** | +2 351 ppm | TI AFE4410, 4 MHz internal osc |
| Verity PPG | 176 | **176.4180** | +2 375 ppm | same die |
| Verity MAG | 20 | **20.4980** | **+24 898 ppm** | separate magnetometer die |
| Verity MAG | 10 | **10.2876** | **+28 760 ppm** | same |
| O2Ring PPG | — | **125.000** | — | 32 MHz crystal ÷ 8 ÷ 32000 |

**Three independent oscillators inside one Verity**, 31 000 ppm apart end to end, plus a 32.768 kHz
timestamp crystal that is accurate to **+27 ppm vs NTP**. Only the last is quartz.

### 1.1 · The divider hypothesis: architecturally right, empirically defeated

Every PPG front end in this class computes `rate = base / N` with integer `N` — ADI ADPD (`8000/N`),
TI AFE44x0 (`f_TE/(PRPCT+1)`), Maxim MAX86141 (a printed table of `32768/N`, whose datasheet lists
"25 sps" as **24.995** and "100 sps" as **99.902**). So the intuition is correct *and one vendor prints
the non-round truth*.

It fails here because **the numerator is an RC oscillator**: ADI states ~10 % device-to-device and its
trim register cannot resolve better than ±0.94 %; TI specs ±1 % at room temperature; Maxim specs ±2 %
sample-rate error even off a nominal 32768 Hz base. At `N = 634` a 0.6 % base error is four whole
counts, so the divider structure is invisible from outside the chip.

**Normalized properly** — fractional distance from the nearest integer, uniform on [0, 0.5] under the
null — no small base fits: 32768 Hz fails 3/7 streams, 32000 Hz 7/7, 8000 Hz 6/7. Large bases fit
everything and mean nothing (at `N ≈ 300 000` the quantization step is 3 ppm). One cell is tempting —
Verity ACC "52" sits 0.026 from an integer against 32768 Hz — and the data kills it internally: the same
sensor at 416 Hz gives `N = 79.25`, and the two settings are locked at a measured 8.000212 ratio.

**What survives is the ratio structure**, and only there:

```
Verity ACC   416 : 52  = 8.000212     exact 8      → +26 ppm
Verity PPG   176 : 55  = 3.200077     exact 16/5   → +24 ppm
Verity ACC vs GYRO (both "52")        agree to     → +20 ppm
```

Two integers off one shared clock. **We can see the divider in the ratios and never in the absolute
rates.** ⚠️ MAG is the exception and cannot be tested — see §5.

---

## 2 · The O2Ring runs at exactly 125.000 Hz, and 156 is a beat marker

`O2PPG_FS_DEFAULT = 125.738` is not the ADC rate. The ring inserts an **extra sample, value `156`
(0x9C), once per beat it detects**. Subtracting them across 13 nights:

```
fs − markers :  mean 125.0069   median 124.9966   sd 270 ppm
4 MHz / 32000 = 125.000000 exactly
```

Hardware agrees: FCC internal photos of the S8-AW (`2ADXK-S8-AW`) show **nRF52840 + TI AFE4403 + a
32.000 MHz crystal**. The AFE4403 has **no internal RC** — crystal or external clock only — and derives
its rate as `PRF = 4 MHz/(PRPCOUNT+1)`, with 32 MHz ÷ 8 = 4 MHz exactly. Viatom's own `lepu-blepro` SDK
documents the stream as `wave : sampling rate 125HZ`.

**So the ring is the one device in the fleet that is crystal-clocked with an exact integer divider.**

### 2.1 · Evidence, and its limits

- **Correlation.** `fs = 125.138 + 0.799 × (PR/60)`, r = +0.870 over 13 nights; marker rate tracks pulse
  rate across a 44 → 75 bpm range.
- **Granularity.** Holds per **five-minute bin** (112 bins, median 125.0025), so it is not an averaging
  artifact.
- **Consistency.** Counting *all* 156s — the physically correct choice, since the inserted byte *is* the
  156 — also fits better than isolated-only (125.007 vs 125.021). Right physics, better fit.
- **Vendor corroboration.** `doad/Cthrow.java:44` replaces 156 in place with the mean of its neighbours,
  keeps the array length, and exposes the raw bytes separately. The same packet carries a field the
  vendor *did* name — `flag(标志参数, 0:脉搏音标志)`, "bit 0 = pulse-tone flag" — so per-beat events are
  an established part of this firmware's model.
- **Insert, not replace.** Under replacement, `delivered − markers` would *fall* as heart rate rises. It
  is flat at 125.000 across nights spanning 44–75 bpm. Only insertion produces that.

⚠️ **Precision, stated honestly:** sd 270 ppm against a ±40 ppm crystal spec — **7× looser**. This
confirms 125.000 at the ~300 ppm level, not at crystal precision. The residual is sample loss (always
low; gaps under 40 ms advance the grid without writing rows, worth ~100 ppm) plus marker
misclassification (both signs).

⚠️ **Markers are not 1:1 with heartbeats.** Against the H10's own `_RR.txt` over the same 9.30 h window:
**29 647 beats vs 27 744 markers, ratio 0.936** — and it degrades through the night (0.981 over the
first 3.3 h). They are one per **ring-detected** beat. They are an exact accounting of inserted samples;
they are **not** a usable beat reference — 6 % dropout merges intervals and is disqualifying for HRV.

### 2.2 · The constant is doing two jobs that need different numbers

This is the actual defect, and it is not the value.

The file holds 125 ADC samples per second **plus** one marker per detected beat, so the row rate is
`125 + HR/60` — **not a constant under any value**. `O2PPG_NS_STEP` places rows on a time axis and needs
the *row* rate; `fs` for signal processing needs the *ADC* rate.

| constant | vs the measured row rate | axis drift over a 9.33 h night |
|---|---|---|
| 125.000 | +6 623 ppm | **+222.6 s** |
| 125.738 | +715 ppm | **+24.0 s** |

`capture.py:320` cites "~212 s of divergence over a 10 h night" as the cost of the old 125.0 guess. That
**measurement is correct** — extrapolated, ours is +239 s/10 h. What is wrong is only its
*interpretation*, "the stream is really running at 125.74".

> **125.0 is right about the ADC and wrong about the row axis. 125.738 is the reverse.**
> Changing the number alone makes one of the two worse. The fix is structural: strip the markers into a
> beat-event column at capture, after which the row rate genuinely is 125.000 and one constant serves
> both jobs.

---

## 3 · Corrections to prior briefs

| brief / file | correction |
|---|---|
| `PMD-DECODE-SCALE-AND-RATE` §3 | **Correction already owned by `H10-ECG-RATE-CORPUS-CHECK` §4** — do not file it twice. What this brief adds is the **mechanism** (§4.1): that claim is a **pre-`80e05501` artifact**, not a measurement disagreement. Its Verity numbers are sound (replayed through the new decoder); the table compared a **replayed Verity against a non-replayed ECG**. |
| same, §"leave it" | "125.754 vs configured 125.738 — that constant is well calibrated; leave it" was already overturned by `CAPTURE-HOST-DEEP-AUDIT` §A3; §2 above supplies the mechanism. |
| `O2RING-PROTOCOL` §3b, `oxyii.py:284` | **156 is a beat marker, not a missing-sample sentinel.** The instruction to "treat a sentinel as a gap, never median-fill it" is wrong in the opposite direction from the vendor's interpolation; a third behaviour is correct. §3b's own evidence already pointed here — "156 occurs 61× on a 90 s probe" is 0.68/s = **41 bpm**. |
| `O2RING-FRAME-SAMPLE-LOCK` §1–2 | **126 = 125 + markers**, i.e. a fact about our ~1.0028 s poll interval, not a hardware lock. §7.1's own 124–128 per-frame spread is beat-to-beat heart-rate variation, and its 126.04 per device-second is 125 + 1.04 beats/s = 62 bpm. |
| `oxyii.py:257`, `capture.py:433`, `tools/o2ring-step-imbalance.mjs:37` | **−3446 ppm describes the *duration counter*, not the sample clock**, and it is one night. Across 44 sessions: median **+540 ppm**, range **−314 … +4282**. The sample clock is crystal-accurate; the counter is a separate RC-class timebase. Marker-free `fs × ring_second = 125.419` (+3353 ppm) on the reference night, which is what separates them. |
| `O2RING-SYNTHESISED-AXIS` §4 | its already-retracted absolute-epoch test has a **second** independent failure: 24 of our H10 captures carry a **2019-01-01 reset clock** (`599616000000000000` ns), a documented strap-removal behaviour, so "both Polars start from ≈ 8.385 × 10¹⁷" is false for them. |
| `polar_pmd.py:518` | the float64 loss is **128 ns**, not "~64 ns" — the ULP crossed 64→128 on 2018-04-07. Measured: **98.7 %** of Polar Sensor Logger's per-sample stamps are ≡ 0 mod 128, and the 1.3 % that miss are exactly 1/73 = the frame-last sample, which the SDK passes through unrounded. Our integer arithmetic avoids it. |

---

## 4 · Method notes — fifteen claims this investigation got wrong

Recorded because each is cheap to repeat and none produced an error message.

1. **PSL quantization read as 64 ns.** GCD of differences was the wrong statistic; the SDK's float
   arithmetic leaves interior samples ≡ 0 mod **128** while the frame-last sample breaks the GCD to 1.
   The decisive test is the **residue**, not the GCD.
2. **The vendor's "30.5 µs timestamp" tested on H10 ECG**, which the claim never covered — it is scoped
   to Verity ACC/PPG FIFO paths. Retested on the right streams; the conclusion holds, the framing
   overreached.
3. **An "882 Hz common base" inferred from `176/55 = 3.2`.** A freely programmed 16-bit period register
   produces that ratio with no divider tree.
4. **A "7-bit escape code" argument for 156.** Falsified in one histogram: 29 169 samples above 127,
   continuous to a max of 200.
5. **`0x0D` read as an offline start/stop target.** It is a capability bit; offline is bit 7 on the type
   byte.
6. **156-as-gap proposed as the cause of the rMSSD alternation.** Refuted three ways — all 25 PpgDex legs
   carry `site=wrist`, three of six nights predate any O2Ring pleth, and 0 of 1155 beats are dropped.
   ⚠️ `wrist` here is the **DSP's device-class default, not the real site**: `PAT-SENSOR-PLACEMENT-
   CORRECTION-2026-08-04` establishes wearer-confirmed that the Verity has been on the **LEFT ANKLE** for
   the entire corpus. That does not affect this refutation — the field still separates Verity legs from
   O2Ring `finger` legs, which is all it is used for here — but no plausibility argument anywhere should
   rest on it meaning wrist.
7. **Markers claimed 1:1 with heartbeats** on a night-level r = 0.87, far too weak a test (§2.1).
8. **Marker placed at the systolic foot** by reading the raw minimum as the foot — the stream is
   inverted, so the raw minimum is the systolic **peak**. The marker sits 32 ms after it, ~352 ms from
   the foot, which is why `gapBeats` drops nothing.
9. **`fs × ring_second ≠ 126` offered as proof of no shared clock.** The test was confounded — `fs`
   included markers, so the product had to vary with heart rate. The conclusion survives; the reasoning
   did not.
10. **"PpgDex over-detects by +10.5 %"** — the marker baseline is itself ~2 % below ECG there; ~8 %.
11. **"The ring gives a free beat reference"** — 6 % dropout is disqualifying for HRV.
12. **"Exactly 125.000"** — confirmed at ~300 ppm, 7× looser than crystal precision.
13. **`125.738 = 125 + 44 bpm`** — 0.738/s sits below every observed night (min 0.768). Consistent with
    markers-plus-loss, not proven to be exactly that.
14. **`capture.py:320` called "exactly inverted"** — its *measurement* is right; only its interpretation
    is wrong (§2.2).
15. **A battery↔counter-error correlation printed as r = +0.525** without screening an obviously broken
    session (ring second 3.25 s). Excluding it, **r = −0.344** — the sign flips. The test is
    inconclusive and the `r` should not have been printed.

### 4.1 · The dated artifact — where `130.0000` came from

Commit **`80e05501`** (2026-07-19, *"back-time off its own clock"*) switched `sensor_ns` from being built
off the **nominal** rate to being derived from the device's **own frame stamps**. Sliced by capture date,
the break is total:

| stream | before `80e05501` | after |
|---|---|---|
| H10 ECG | step **exactly 7 692 307 ns** = 130.00001 Hz, on **98.63 %** of samples | 129.951–130.072, nominal share **0.02 %** |
| Verity GYRO | **exactly 19 230 769 ns** = 52.0000 Hz, **99.4 %** | 51.680–51.693, share 0.02–0.18 % |
| Verity PPG | **exactly 18 181 818 ns** = 55.0000 Hz, **97.0 %** | 55.090–55.148, share 0.01 % |

`PMD-DECODE-SCALE-AND-RATE` measured ECG segment **`20260719023533`** — the last session before the
break, in which **98.63 % of deltas are exactly `1e9/130`**. Its "device clock" leg was reading our own
nominal back, so the comparison was circular; only its host-arrival leg (130.001) was a measurement. Its
Verity figures are non-nominal and therefore came through the new decoder, which is why the same table
holds sound Verity numbers beside a circular ECG one.

**The general lesson, and it caught this investigation twice more:** a rate that lands *exactly* on its
nominal is the signature of a fallback, not of a good clock. H10 ACC at 200 Hz reads exactly 5 000 000 ns
— our own fallback firing on **97.2 %** of samples (`polar_pmd.py:502` keeps the nominal when the device
estimate is outside ±10 %). Always report the nominal-share alongside a rate; a share above a few percent
means the number is ours, not the device's.

**Two adversarial attacks that failed, and are worth recording as such:** row-count circularity
(`O2PpgGrid` advances the grid index without writing filler rows, `capture.py:575`, so `n` is genuine),
and a negotiated-vs-assumed rate mismatch on MAG (negotiation follows config correctly — 2026-08-02
reads nominal 20, 2026-08-03 reads nominal 10).

---

## 4.2 · What §2 owes `PAT-PROXIMAL-DISTAL-PAIR` — a mechanism for its confound

`PAT-PROXIMAL-DISTAL-PAIR` §2 withdraws its own 8/14 finger↔ankle coupling result because grouping by
the ring's **axis provenance** separates it perfectly: the nights that couple are the ones whose O2Ring
axis is a **drawn** uniform grid, the nights that fail are the properly host-measured ones. Its stated
worry is that *"`index × constant` produces evenly spaced feet by construction."*

§2 of this brief sharpens that into a testable mechanism. **The drawn axis is not a uniform grid over a
uniform row stream** — it is a uniform grid laid over a row stream whose density is **modulated by heart
rate**, because one extra row (the `156` marker) is inserted per detected beat. A drawn axis therefore
maps row index to time linearly across a stream that gains a row at every beat, which imprints
**HR-locked structure into the reconstructed sample times by construction**. That is a stronger and more
specific version of "evenly spaced by construction", and it is directly checkable: recompute those
nights with markers removed before the axis is laid, and the confound should move.

This also predicts the direction — the effect is largest where markers are densest, i.e. at higher heart
rate. Recorded here rather than acted on; the PAT family owns that result.

### 4.3 · Three clock candidates for PAT's scatter, measured and eliminated

`PAT-VERDICT-CONSOLIDATED` states PAT's ~84–99 ms beat-to-beat scatter is *"not a clock problem"*. That
was challenged from this brief's findings, and the challenge **fails on measurement**. Recording it
because a negative here is worth as much as the positive:

| candidate | magnitude | verdict |
|---|---|---|
| marker sawtooth (§2) | **8.0 ms p-p, sd 2.3 ms** — one real sample period, HR-locked | 10× too small |
| BLE delivery jitter | raw ~100 ms, but the Verity back-times off `last_ns` (device clock, excluded by construction) and the ring **re-anchors every frame** → **IQR 8.0 ms** residual | 5–10× too small |
| inter-device drift (H10↔Verity ~7 ppm) | would need long blocks to matter — **`BIN_MIN = 5` minutes**, giving ~1.1 ms; and `PATAlign.alignByAnchors` already corrects drift piecewise-linearly on shared ACC events, applied once before surrogation | ~80× too small, **and already corrected** |

The drift hypothesis was the strongest of the three on arithmetic — 7 ppm across a 376 min overlap is
79 ms, numerically the size of the reported scatter — and it dies on the premise: the statistic is
centred per **5-minute** block, not per overlap. **The arithmetic coincidence was not evidence**, which
is the standing warning at `WEARABLE-DRIFT-DIRECT` §7.4 and the fifth retraction it exists to prevent.

**So `PAT-VERDICT`'s headline stands, and is now better supported than when it was written** — three
further clock mechanisms quantified and eliminated rather than argued away.

## 5 · Capture configuration — decided 2026-08-05

| stream | decision | rationale |
|---|---|---|
| **Verity MAG** | **DISABLE** | Nothing documented consumes it — its own brief says body position comes from the ACC gravity vector. It is the **worst clock in the fleet**: +2.5–2.9 % off label with **7 750 ppm session-to-session drift at fixed nominal**, so large that its 10:20 ratio cannot even be tested (a 4 000 ppm deviation is swamped by drift). `PMD-DECODE-SCALE` §7.3 already concluded a calibration constant is useless for it, and it is the stream generating false stall alarms. |
| **Verity GYRO** | **OFF** | 52 Hz against the 0.1–0.6 Hz effort band it feeds. |
| **Verity PPG** | **176 Hz — keep** | **Owner's operational call, and it should be recorded as having no remaining technical rationale.** `PPG-SAMPLE-RATE-AND-PAT` measures no gain above 55 Hz for 1.81× battery. The "it keeps a PAT item reachable" argument is **dead**: `PAT-VERDICT-CONSOLIDATED` (REFERENCE, 2026-08-04) finds PAT blocked by **~84–99 ms of beat-to-beat scatter downstream of the heart** — *"not a clock problem, not an alignment problem, and not a method problem"* — against which the sampling term is 1.7 ms at 176 Hz. 11.6 h runtime is ample for a ~6 h night, §5.1 gives part of the cost back, and that is the whole case. Requires SDK mode; see §6.4. |
| **Verity ACC** | 52 (non-SDK) / **26 in SDK mode** | The 26 Hz cut existed to pay for 176 Hz PPG bytes; with 176 restored the rationale returns, and MAG+GYRO going away frees more. |
| **H10 ECG** | 130 | forced; actual 129.988. |
| **H10 ACC** | **25 → 50** | `polar_pmd.py`'s own comment specifies 50 ("actigraphy convention… headroom for gait/step harmonics ~10 Hz"); the config contradicts it. At 25 Hz a 10 Hz harmonic sits at 0.4× Nyquist. 50 Hz ≈ 90 MB/night against 369 at 200. |
| **O2Ring PPG** | 125.000 + marker column | hardware-fixed; the setting needs the structural fix of §2.2, not a new number. |
| **O2Ring `RtPpg`** | **ENABLE — 200 Hz** | `cmd=0x05`, payload `{0x07,0x01}`; `[u16 count]` then 9-byte records `{u32 LE IR, u32 LE RED, u8 motion×2}`. 32-bit dual-wavelength against the 8-bit single channel we use today, where 8 bits on a ~57 LSB beat is ~1.8 % amplitude resolution. ⚠️ 1800 B/s vs 125 B/s, never enabled by the vendor's own app, and battery cost unmeasured — ship it behind a config flag and measure the first night. |

**Also record the rate, not just the label.** Every session should carry the negotiated nominal **and**
the measured device rate. `est` is already computed per frame; it is simply not persisted, and no
nominal recovers it afterwards.

### 5.1 · Dropping MAG and GYRO pays back part of what 176 Hz costs

`PPG-SAMPLE-RATE-AND-PAT` §4.1 measured the Verity at **4.74 %/h at 55 Hz (21.1 h runtime)** against
**8.60 %/h at 176 Hz (11.6 h)** — an added **3.86 %/h**. Uncompressed on-wire payload, for scale:

| stream | rate × channels × width | B/s |
|---|---|---|
| PPG 55 Hz | 55 × 4 ch × 24 bit | 660 |
| PPG 176 Hz | 176 × 4 ch × 24 bit | **2 112** |
| — the 55 → 176 upgrade | | **+1 452** |
| GYRO 52 Hz | 52 × 3 ch × 16 bit | 312 |
| MAG 20 Hz | 20 × 3 ch × 16 bit | 120 |
| — dropping both | | **−432** |

So the two disabled streams give back **≈ 30 % of the airtime the upgrade cost**. If battery scaled
linearly with payload that is ~1.15 %/h recovered — **7.45 %/h, ~13.4 h runtime** instead of 11.6.

⚠️ **Treat that as a lower bound, and do not quote it as a measurement.** Three reasons it is only an
estimate: these streams are **delta-compressed** on the wire, so the byte figures are upper bounds;
radio power is dominated by connection events rather than payload, so bytes do not map linearly to
current; and the **gyroscope die is the disproportionate consumer** — a MEMS gyro typically draws
~0.5–1 mA against ~0.1 mA for an accelerometer or magnetometer, which is not represented in its byte
share at all. That last effect pushes the true saving **above** 30 %.

**It is directly measurable and costs nothing to measure.** `Tepna_*_LINK.csv` `battery_pct` is exactly
what §4.1 used. The first night after this configuration lands gives the real number, on the same night
that measures the `RtPpg` cost — record both here rather than carrying the estimate forward.

---

## 6 · Plan

Phase 0 gates the largest unit and costs almost nothing; Phases 1–2 run in parallel with its night.

### 6.1 · Phase 0 — unblock (do first)
Log `RtWave.offset` (u32 LE at payload `[20:24]`, named by the vendor SDK and identified but never read
at `oxyii.py:296`) and the full `[10]` byte into the `OXYFRAME` sidecar. Then `Σ size` vs `Δ offset`
settles insert-vs-replace **from the ring's own counter, with no host clock**, and `Δ offset / Δ duration`
gives a device-internal rate. Additive columns; `oxydex-dsp.parseCSV` byte-identity is already
gate-asserted.

### 6.2 · Phase 1 — `capture-host` correctness (no bundles, no fixtures)
- `_ctrl` must filter on `value[0] == 0xF0` **and** the echoed opcode, and route `0x01`
  (`ONLINE_MEASUREMENT_STOPPED`) to a handler. Today it drains the queue and takes the next item
  unchecked, so an unsolicited stop notification is returned as a command response and desyncs the
  pairing — while the device's own "this stream died" signal is discarded.
- `polar_pmd.py:518` comment 64 → **128 ns**; mask `data[0] & 0x3F`.
- GYRO compressed T1 is 3 ch × **32-bit float** and MAG T1 is **4** ch × 16 — decode or raise, never
  silently mis-decode as 3×16.
- PPI per-beat back-timing by `Σ ppInMs`; we currently collapse every beat in a frame onto one instant.

### 6.3 · Phase 2 — effFs / stall (depends on §6.2's `_ctrl`)
`_stream_rate` measures on the **device clock**: `eff = Σ n₁..ₖ / ((ns_k − ns₀)/1e9)`, which fixes the
off-by-one (`span` starts at the oldest frame while `total` counts its samples, a `(k+1)/k` bias that is
always positive — predicted 146.25 Hz for ECG, observed 146.6) and BLE-batching immunity together.
Return **`None`**, not `0.0`, below a frame-count minimum. Scale the stall bar to observed delivery
cadence, and prefer the explicit stop signal over inferring from silence.
**Known-answer test that fails today:** frames at exact device spacing delivered in arbitrary bursts must
give `eff == nominal` to ~1 ppm regardless of burst pattern.

### 6.4 · Phase 3 — config (4.1 first, or the next save undoes it)
The rate overrides are silently deleted by any settings save: `monitor.html:1157` renders a plain
`<span>` for a single-option menu so the value is never submitted, and `webmon.py:712` does
`dev["rates"] = clean` — a full replace. This is what reverted 176 Hz on 2026-08-03. Fix both, then
apply §5. Re-entering SDK mode uses `02 09` (`03 09` exits) and requires all streams stopped, else
`ERROR_INVALID_STATE` (12). Note `0x04` enumerates the SDK-mode menu **without** entering SDK mode.

### 6.5 · Phase 4 — the O2Ring structural fix ⚠ blocked on §6.1
Strip markers to a beat-event column; `O2PPG_FS_DEFAULT` → 125.000 **only together with that**;
`ppgdex-dsp.js` 156 semantics; regenerate O2Ring fixtures, re-bundle, GATE A/B, equiv legs,
`npm run check`. **Do not start until §6.1's night lands** — if `Δ offset` shows the ring counts markers
in its own stream position, the marker is a replacement and 125.000 is wrong.

### 6.6 · Phase 5 — documentation
Land §3's corrections in the briefs named, plus a reference note carrying the vendor tolerances beside
our measurements and the AFE4410 / AFE4403 identifications.

---

## 7 · Done when

- [ ] §6.1 columns land and one night is captured with the ring connected.
- [ ] `Σ size` vs `Δ offset` reported; insert-vs-replace settled from the device counter.
- [ ] §6.2's five fixes land with capture-host at 100 % statement+branch.
- [ ] §6.3's known-answer test exists and fails before the fix.
- [ ] §6.4's clobber bug fixed **before** any rate is set; §5's configuration applied and verified in the
      daemon log, not the config file.
- [ ] O2Ring `RtPpg` enabled behind a flag; first night's battery cost measured and recorded here.
- [ ] §6.5 blocked until §6.1 reports.
- [ ] §3's corrections landed.

---

## 8 · Open

- **Value `199`** is ~30× over-represented (831 occurrences against neighbours' 27 and 111, at 0.070/s —
  far too rare to be a beat). Unexplained.
- **One unit, one night.** Every O2Ring number is device `S8AW2100`; the ECG cross-check is a single
  night. The Verity `416 : 52` ratio compares **different sessions** — only the ACC-vs-GYRO agreement is
  within-session.
- **Whether the ring exposes an accelerometer.** `AUTO_RT_ACC` (`cmd 0x14`) is decoded by the vendor SDK
  and then discarded. `O2RING-RAW-STREAMS-ABSENT` and `O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS` §5.3 both
  conclude the ring has no ACC and that absolute PAT is hardware-blocked. That conclusion may be wrong.
- **Verity offline pull.** File transfer is *prohibited* in recording/swimming mode (`SYSTEM_BUSY`), the
  PS-FTP MTU characteristic requires a bonded link and the Verity permits exactly one authenticated
  connection, and an offline file may not exist for **up to five minutes** (error 103). MTU 517 is not a
  protocol requirement — iOS never negotiates and PS-FTP works at ATT MTU 23.
