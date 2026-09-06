<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (parked 2026-09-02 — this is the protocol-TRUTH record and it survives alongside its parent, which owns the BUILD questions; do not retire either (they overlap only on the upstream contribution). The shipped signed-read defect is fixed (340166f5) and the stream is captured nightly (`ppg2wr` at `capture.py:3520`, `nightqc.ppg2w_contact`). Open: **§7.2 wavelength identity** needs an optical stimulus the lab cannot supply (§5's catch-22) — the named cheapest route is the ring WORN on a daylight walk with capture running; ✅ **§7.3 MEASURED 2026-09-05 (Heron, box read-only, 7 worn sessions):** on `0x04` the isolated `156` is ONE ROW PER BEAT (ratio 0.986–0.996 on every long night, modal row gap = 125 × 60/PR + 1, PERIODIC refuted) — §2.1's 1.22 was a 403 s fragment; the `0x03` 1.96 half and ~~**§7.4's 112.9-vs-125 Hz**~~ **§7.4 MEASURED 2026-09-06 (Wren): 125.058 Hz over 119.7 s, the 125.000 ADC to 0.05 % — the 112.9 does not reproduce, and marker subtraction makes it WORSE on this stream (124.444), opposite to `0x05`. `0x03` is now captured nightly as the opt-in `pletha` stream (#2282).** The `0x03` marker half is answered with it (0.534/s against 62.0 bpm, ~0.5 per beat, not 1.96). **Owner:** owner (daylight walk) / Heron (§7.4 probe, needs the ring worn outside a capture night) · **Next step:** the daylight walk — it is the only one needing weather) · **Created:** 2026-08-05

> **TRIAGED 2026-09-01 — one open question, and it is a MEASUREMENT question.** §1's defect (signed channels read unsigned) is stated; §2 CONFIRMED `rows − markers = 124.91 Hz`, independently reproducing the 125.000 ADC, and §2.1a's 2026-08-20 update REFUTES the 100 Hz reading — the delivered rate is the **cap**, not the device. §3 is WITHDRAWN (again) — 'AC/DC is ten times too large' does not hold. §4 identifies `0x03` as the real waveform, a different stream from `0x05`. **§2.1 is the sole open item: the marker rate is not the heart rate**, and settling it needs device time rather than code.

# `cmd 0x05` follow-ups — the channels are SIGNED, and `0x03` is the real waveform

Follow-up to `O2RING-RAW-DUAL-WAVELENGTH-2026-08-05-BRIEF.md` (#994), from a further afternoon on
hardware. One code defect, one confirmed rate, one sub-argument of the parent brief withdrawn, and three
failed experiments recorded so nobody repeats them.

## 1 · THE DEFECT: the channels are signed and we shipped an unsigned read

`parse_rt_ppg` read both `i32` fields with `int.from_bytes(..., "little")`. They are **signed**. Across
**61 066 real samples**:

| read as | min | max |
|---|---|---|
| unsigned (shipped) | 2 096 | **4 294 966 954** |
| signed (correct) | **−285 410** | 3 478 709 |

The unsigned maximum sits within ~3 000 of 2³², which is the signature of a small negative wrapping.
Fifteen samples were negative. **Not one sample exceeds the 24-bit signed maximum of 8 388 607**, so the
wire format is 24-bit two's complement sign-extended into 32 bits.

This is not cosmetic. A single wrapped `4.29e9` inside a mean destroys it, and it does so *silently* —
the value is a legal `u32`, so nothing raises. It corrupted this project's own statistics; see §3.

**Why no test caught it:** every fixture used small positive values, so signed and unsigned agreed on all
of them. The new tests use the bytes that actually appear on the wire (`−342`, `−285410`) and both fail
against the old code — verified by re-applying the unsigned read, with `__pycache__` cleared.

**It also corroborates the silicon.** 24-bit two's complement is exactly the output-register format of
the TI **AFE44xx** family (`LED1VAL`, `LED2VAL`, `ALED1VAL`, `ALED2VAL`, and the ambient-corrected
differences), which is the standard front end for this device class. Negative values are physically
meaningful only for a *difference* register — a raw light reading cannot be negative — which is a real
hint about what `0x05` carries, though not proof.

## 2 · CONFIRMED: `rows − markers = 124.91 Hz`, independently reproducing the 125.000 ADC

`DEVICE-RATE-TRUTH-2026-08-05` §2 derived 125.000 Hz from a divider chain plus a fit. Here it falls out
of arithmetic on a **daemon-recorded night file**, using only that file's own timestamps — no probe, no
assumed constant:

```
span            403.1 s      rows           50 816
ROW rate        126.06 Hz    156 markers    466  (1.156/s)
rows − markers  124.91 Hz    <- the ADC rate, within 0.07 %
```

**And the `156` marker appears on a second opcode.** On `0x03` it is 372 occurrences, **100 % isolated
single samples**; on the recorded `0x04` pleth, 466 occurrences, **99 % isolated** (445/450). Same value,
same insertion, same ~100 baseline. One mechanism, two streams — which is why subtracting it recovers a
clean 125.000 from a messy 126.06.

### 2.1a · RATE UPDATE (2026-08-20) — 100 Hz REFUTED; the delivered rate is the CAP, not the device

A whole-corpus sweep (39 `_PPG2W.txt` files, **284,420 buffers**) found **282,402 pinned at exactly the
102-record reply cap** (99.3 %) at the daemon's ~1 Hz drain (median inter-arrival 1.005 s). That is the
saturation signature: the device fills FASTER than the drain and the excess is silently discarded, so
every whole-night "~100 Hz" measurement (`ppg2w-rate.mjs` 100.19/100.99, frame-cadence 101.65) was
**cap × poll rate — a drain artifact, not the fill rate**. The owner's 100 Hz hypothesis is thereby
refuted: sustained delivery of 102 records per 1.005 s bounds the fill **> 102 Hz**, consistent with
the parent brief's 125.000 (ADC) prediction though not yet pinning it. (Short-dt capped pairs suggest
more, but arrival spacing ≠ fill interval under BLE jitter — not quoted.) The decisive instrument
remains the fast-spacing starvation run (`/tmp/probe_rt_ppg_rate.py` ⚠️ **GONE — not recoverable.** Session scratch did not survive the 2026-08-19 ext4 migration; verified absent 2026-08-26 (`LOST-APPARATUS-INVENTORY-2026-08-26`). Re-measuring the rate means rebuilding this probe., deployed on the box, pre-stated
bands [95,105]→100 · [118,132]→125); FIELD-GATED on the ring being worn (it was not, 2026-08-20 19:40).

**Wired (capture-host):** the runner now drains the raw buffer TWICE per live cycle (~0.5 s spacing) —
buffers sit well under the cap, so capture is COMPLETE and every night's unsaturated counts measure the
fill rate for free. Gate-tested (two asks per cycle with the stream, zero without).

### 2.1 · OPEN: the marker rate is not the heart rate

| stream | markers | implied bpm | reported HR | ratio |
|---|---|---|---|---|
| `0x04` recorded night | 1.156 /s | 69.4 | 57.0 | **1.22** |
| `0x03` probe | 1.859 /s | 111.6 | 57 | **1.96** |

"One extra row per detected beat" does not hold in either stream, and the two disagree with each other.
The marker may flag something finer than a beat (a systolic *and* dicrotic feature would give ≈2×), or
include detections the reported HR filters out. **The rate result in §2 does not depend on resolving
this** — it counts markers, it does not interpret them.

#### 2.1-MEASURED (2026-09-05, Heron — read-only probe on the box, 7 worn sessions, 27,000+ markers) — on `0x04` the marker IS one row per beat; the 1.22 was a 403 s fragment

Bands pre-stated before the run: **BEAT-LINKED** = per-minute markers/PR ratio CV < 10 % and r(inter-marker s,
60/PR) > 0.7 · **PERIODIC** = one modal inter-marker ROW gap holding > 60 % of gaps and r < 0.2 · otherwise
unresolved. Marker = an isolated `156` row (99.4–99.8 % of all `156`s are isolated); PR from the same
session's `_OXYFRAME.txt` on contact seconds.

| session | span | PR (median, range) | markers/s | markers ÷ PR | intervals within ±15 % of 60/PR | modal row gap | r(interval, 60/PR) |
|---|---|---|---|---|---|---|---|
| 08-02 night | 9.9 h | 51.7 (48–78) | 0.794 | **0.986** | 84.1 % | 151 | 0.52 |
| 08-26 night | 8.8 h | 51.9 (45–81) | 0.808 | **0.987** | — | 151 | 0.62 |
| 08-12 night | 7.9 h | 56.0 (50–85) | 0.892 | **0.991** | 91.7 % | 136 | 0.85 |
| 08-01 00:13 | 2.3 h | 69.1 (62–106) | 1.125 | **0.996** | 94.9 % | 111 | 0.84 |
| 08-01 02:33 | 1.1 h | 77.1 (70–108) | 1.019 | 0.837 | 72.2 % | 101 | 0.59 |
| 09-03 19:10 | 17 min | 59.3 (54–94) | 0.718 | 0.803 | 36.8 % | 136 | 0.15 |
| 08-05 16:38 | 21 min | 74.3 (62–92) | 0.700 | 0.615 | 28.9 % | 116 | 0.60 |

**PERIODIC is refuted outright**: the top row-gap mode never holds more than 9.8 % of gaps, and the mode
itself moves with the pulse — 151 rows at PR 52, 136 at 56, 111 at 69, 101 at 77, i.e. ≈ 125 × 60/PR + 1.
**BEAT-LINKED holds on every long night**: ratio 0.986–0.996, 84–95 % of individual intervals within ±15 %
of that minute's 60/PR, r 0.84–0.85 on the two nights with any PR variance (the CV leg reads 10.0–10.9 %,
at the band's edge — the count leg is the weaker instrument, see below). So §2.1's row for `0x04` is
superseded: **one marker per detected beat**, and the 1.22 came from a 403 s fragment at a moment the
reported HR did not represent. The three short daytime sessions fall to 0.62–0.84 with interval agreement
29–72 % — the ring's own `motion` flag reads 0 in every one of those minutes, so the deficit is NOT
flagged motion; whatever it is, it is beats the ring's HR counts and the marker does not, and it is
unmeasured. ⚠ The per-minute **count** vs PR correlation is ≈ 0 in every session (−0.16 … 0.28), while the
per-minute **interval** median tracks 60/PR at r 0.84 — the count is what BLE frame loss and this deficit
corrupt, the interval median is robust to both. A future count-based test of this row would read the
wrong answer. **`0x03`'s 1.96 stays open**: `0x03` is not captured nightly (only `0x04` → `_PPG.txt` and
`0x05` → `_PPG2W.txt` are), so it needs a worn-ring probe — same instrument §7.4 needs.

## 3 · WITHDRAWN (again): "AC/DC is ten times too large"

The parent brief's §1.2④ withdrew the RED/IR assignment, and gave two reasons. **One of them was itself
wrong**, and it was wrong *because of §1's defect*:

> "An AC/DC of 12–24 % is roughly TEN TIMES a finger perfusion index"

Recomputed with the signed parse on a lossless chain, **AC/DC is 0.0083 on both channels** — 0.83 %, a
perfectly ordinary perfusion index. The 12–24 % figure was inflated by wrapped values and a coarser
detrend window. That argument is withdrawn.

**The withdrawal of the wavelength assignment still stands**, on the argument that was always the strong
one — the **positive control**:

| stream | peaks | implied HR | ring reported |
|---|---|---|---|
| `0x03` pleth | 182 | **72.9 bpm** | 73 ✅ |
| `0x05 ch0` | 146 | 58.5 bpm | 73 ❌ |
| `0x05 ch1` | 131 | 52.5 bpm | 73 ❌ |

Unchanged under the signed parse. Two plethysmograms of one finger must find the same beats; these
disagree with the device **and with each other**. Note the two channels' AC/DC are now identical to four
decimals (0.0083 vs 0.0083), giving `R = 1.000` — which maps to ~85 % against a reported 97 % and is
another way of saying the ratio-of-ratios is not measuring saturation here.

**Lesson worth keeping:** a withdrawal supported by two arguments is not twice as safe. One of these two
was an artifact of a defect in the same changeset. Check whether your reasons share a cause.

## 4 · `0x03` is the real waveform, and it is a different stream from `0x05`

| | fs | notes |
|---|---|---|
| `0x03` LIVE_SAMPLES_A | **112.9 Hz** (total/elapsed, lossless) · 114.6 Hz (beats × PR) | 8-bit, 6-byte header, `u16` count at `[4:6]`, cap 250 |
| `0x05` | **≥ 153.3 Hz** | 13/373 replies saturated ⇒ slight under-estimate |

Different rates ⇒ different sources. `0x03`'s raw bytes are visibly a pulse downstroke
(`150,149,148,…,60,54,…,28`) and its beat count reproduces the ring's own pulse rate to 0.1 bpm.

~~**Open:** `0x03`'s 112.9 Hz is not 125.000 either, even after removing its markers (114.4 Hz).~~
**MEASURED 2026-09-06 (Wren, worn ring on vigil, daemon stopped): `0x03` IS the 125.000 ADC.**
125.058 Hz over 119.7 s of unsaturated replies — 0.05 % off — reproduced at 125.449 Hz in an earlier
10-minute run. **The 112.9 does not reproduce**, and its likely origin is the one this brief already
distrusts elsewhere: a 403 s fragment, the same length that made §2.1's 1.22 an artefact.

Three things make the new figure load-bearing rather than another candidate:
- **Saturation excluded, and reported**: 1 of 592 replies hit the 250-record cap, and the rate is
  computed over unsaturated intervals only. §2.1a's lesson is that the delivered rate can be the CAP;
  here it demonstrably is not.
- **The device BUFFERS, so the rate is its own and not the poll cadence.** Samples-per-reply tracks the
  inter-poll interval (regression slope ~142/s, counts 6–45 across 148–240 ms intervals) rather than
  sitting flat — a fixed-window device would show slope ~0. Without this check the number would be an
  artefact of asking 5 times a second, which is exactly how `0x05` read ~100 Hz for months.
- **Marker subtraction makes it WORSE here, and that is the surprise.** Markers arrive at 0.534/s
  against a reported 62.0 bpm — about HALF a marker per beat, where §7.3 measured `0x04` at almost
  exactly one — and removing them gives 124.444 Hz, further from the ADC than the raw row rate. So
  §2's "rows − markers" correction, which recovers 124.91 from `0x05`, must NOT be applied to `0x03`.
  The recorded 114.4 "after removing markers" is not reproduced either.

Layout confirmed on the same runs, 1188 replies across two sessions: `payload_len − declared_count` is
6 on EVERY reply and `body_len == declared_count` on every reply, fixing the 6-byte header and the
8-bit sample against bytes rather than against a document. The stream is now captured nightly as the
opt-in `pletha` stream (#2282); markers are FLAGGED in their own column, never stripped, for the
reason above and because 6 % of the observed 156s are non-isolated — a value strip would delete real
samples.

## 5 · Three optical experiments that FAILED, and why — do not repeat these

The plan was to inject a known-frequency light and read fs off it, and to identify wavelengths by which
channel responds to IR (a TV remote, ~940 nm) versus visible (a phone torch, ~660 nm and no IR). It is a
good plan. All three attempts failed **mechanically**, never reaching the question:

1. **Ring off the finger, torch at the window.** The `0x03` control never hit the 8-bit rail (max byte
   200, zero replies ≥ 250) across 210 s. No light arrived. Worse, off-finger the front end appears to
   power down — no `PR` is reported — so the data means nothing anyway.
2. **Ring worn, transillumination through the fingertip.** `PR` present (57–59) so the front end was
   live, but max byte stayed pinned at **156** — the beat marker — for the whole run. A phone torch
   through a fingertip is far too lossy.
3. **Ring worn, bright room vs drawer** (to test the AFE ambient hypothesis). `0x03` swung 3.02× and
   `0x05 ch0` 3.23× — they move *together*, not differentially. But this test is **inconclusive by
   construction**: worn, the sensor is pressed against skin, so ambient light barely reaches it.

**The catch-22 is the finding:** exposed sensor ⇒ front end off; worn sensor ⇒ no light path. Any future
optical stimulus must solve that, not work around it.

### 5.1 · SUNLIGHT is the source that does solve it (owner observation, 2026-08-05)

The owner reports that on the first day of use, **in the sun, the ring produced "crazy values"** —
undated and unlogged, so anecdote rather than data, but it points straight at the flaw in experiment 3.
Direct sunlight is on the order of **100 000 lux against a few hundred indoors**: roughly 300×. My
bright-room-versus-drawer test was not a weak test of ambient sensitivity, it was 300× too dim to be a
test at all, and its null says nothing.

This also makes the ambient hypothesis *more* plausible rather than less: a device whose readings go
wrong in sunlight is a device where ambient light reaches the detector through tissue, which is exactly
the condition an ambient-cancellation register exists to handle.

**⚠️ ATTEMPTED 2026-08-05 AND BLOCKED BY BLE RANGE.** The probe was launched and the ring never
connected (`BleakDeviceNotFoundError`) — the sunlit window is outside the capture box's radio range,
which a scan confirmed by seeing the ring again the moment the owner returned. This is a *geometry*
constraint, not a device one, and it is the fourth distinct mechanical failure in this series. Whoever
runs it next must solve it first: move the box within range of a sunlit spot, or find a sunlit spot
within range of the box. **A practical indoor substitute:** a halogen work lamp or a bright LED
inspection torch at ~5 cm delivers on the order of 10 000+ lux — 30–100× a lit room — which is the same
order the sun observation implies, without leaving BLE range. The phone torch that failed in experiments
1 and 2 is roughly a tenth of that and was additionally being asked to cross tissue.

**The experiment this implies** — the cleanest remaining route to identifying `0x05`: ring **worn**,
capture `0x03` and `0x05` together, and walk from deep shade into direct sun and back, twice. Prediction
if `0x05` is an ambient or uncorrected channel: `0x05` swings hard while `0x03` — being
ambient-corrected — holds, and the ring's reported SpO₂/PR degrade. Prediction if the two move together:
`0x05` is on the corrected path and its lack of pulsatility needs a different explanation. Either way it
discriminates, and unlike experiments 1–3 the stimulus is strong enough to arrive. **A second value:**
it would characterise a real failure mode of this deployment, since nights are dark but daytime spot
checks are not.

## 6 · Literature check — the calibration we assumed does not exist as a constant

Searched the DIY/paper literature and Chinese sources (Viatom is Shenzhen-based; the SDK is Lepu's).

- **The `R` orientation convention is not settled.** One reference gives both
  `R = (AC₆₆₀/DC₆₆₀)/(AC₉₄₀/DC₉₄₀)` and `R = (IR_AC/IR_DC)/(RD_AC/RD_DC)` in the same article.
- **`SpO₂ = A·R + B`, with A and B fitted against a reference standard.** The textbook `110 − 25R` the
  parent brief briefly leaned on is a teaching approximation, not a device constant. This independently
  vindicates refusing to assign wavelengths from a ratio alone.
- **Viatom publishes no silicon details** — "intelligent SOC chip", 透射式光电容积法 (transmissive
  photoplethysmography). The AFE44xx inference in §1 comes from the data format, not from the vendor.

## 7 · What is still open

1. **What `0x05` actually is.** Two 24-bit signed channels, ~153 Hz, r = 0.9991, AC/DC 0.83 %, no
   consistent beats.

   > 🔬 **MEASURED ON FULL NIGHTS 2026-08-18 — the probe's characterisation GENERALISES, except the
   > rate, which is wrong.** `0x05` is captured continuously as `*_PPG2W.txt`
   > (`capture-host/nightqc.py:1208` names the mapping outright), so the corpus now holds **13 files /
   > 2.4 M rows per night**, not a short probe.
   >
   > | property | this brief (probe) | measured, 11 files |
   > |---|---|---|
   > | rate | ~153 Hz | **101.53 Hz** (median; range 101.47–101.65 across sessions of 146 s → 24 393 s) |
   > | r(ch0, ch1) | 0.9991 | **0.9899** (10 s windows, IQR 0.9599–0.9988) |
   > | AC/DC | 0.83 % | **1.22 % / 1.00 %** (ch0/ch1, 10 s windows) |
   > | signed | inferred | **confirmed** — ch1 reaches **−35** on real data |
   >
   > **The rate is the discrepancy, and it is not link loss.** 101.5 Hz holds to ±0.1 % across sessions
   > spanning two orders of magnitude in length; a stream losing packets over BLE would vary with link
   > quality and session length, and this does not. So `~153 Hz` should be treated as unconfirmed
   > rather than as a property of the stream. *(Unverified observation, recorded because it is cheap to
   > check and would explain it: 153 × ⅔ = 102.0, within 0.5 % of the measured rate.)*
   >
   > **The signedness result is directly usable** for §7.5's upstream contribution to
   > `nglessner/o2ring-s-protocol`: a negative sample on real overnight data is stronger evidence for
   > the signed-24-bit field format than a probe inference.
   >
   > ⚠️ **METHOD NOTE, because the first pass got this wrong.** Computed over a whole night, the same
   > data gives r = 0.79 and AC/DC = 21.6 % — which reads as a completely different stream. Those
   > numbers are DC wander (posture, perfusion, doffing) and are not the AC/DC ratio the term denotes.
   > The arithmetic was right and the statistic was wrong. **Any comparison against a short probe must
   > be windowed to the probe's timescale**, or it compares a night's drift against a probe's pulse. The signedness points at a *difference* register. Untested candidates: an
   ambient-corrected pair at a gain that suppresses pulsatility, an AGC/ambient telemetry pair, a
   decimated envelope.
2. **Wavelength identity** — needs an optical stimulus that solves §5's catch-22. §5.1's sunlight walk
   is the cheapest candidate and is worth running before any teardown is contemplated.
3. ~~**The marker-rate anomaly** (§2.1).~~ **MEASURED 2026-09-05 for `0x04` — one marker per beat**
   (§2.1-MEASURED); the `0x03` half rides on item 4's probe.
4. ~~**`0x03` at 112.9 Hz vs the 125.000 ADC** (§4) — UNMEASURED.~~ **MEASURED 2026-09-06 — it is
   125.000** (125.058 Hz over 119.7 s; see §4). The probe was rebuilt as predicted here, run on a worn
   ring with the daemon stopped, and `0x03` is no longer uninstrumented: it is captured nightly as the
   opt-in `pletha` stream (#2282). The `0x03` half of item 3's marker question is answered with it —
   0.534 markers/s against 62.0 bpm, ~half a marker per beat, NOT the 1.96 recorded in §2.1.
5. **Upstream contribution** to `nglessner/o2ring-s-protocol`: the purpose of `0x05` is still unknown, but
   three things are now checkable and worth sending — the **record base offset of 2** (`u16` count where
   the reference reads a `u8`), the **signed 24-bit** field format, and that the argument is irrelevant.
