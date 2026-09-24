<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (2026-09-24: §8 adds the vendor [SDK] facts on stuck values and a PRE-REGISTERED capture design, NOT RUN, whose retrospective arm (§8.5) is the next step · parked 2026-09-02 — this is the protocol-TRUTH record and it survives alongside its parent, which owns the BUILD questions; do not retire either (they overlap only on the upstream contribution). The shipped signed-read defect is fixed (340166f5) and the stream is captured nightly (`ppg2wr` at `capture.py:3520`, `nightqc.ppg2w_contact`). Open: **§7.2 wavelength identity** needs an optical stimulus the lab cannot supply (§5's catch-22) — the named cheapest route is the ring WORN on a daylight walk with capture running; ✅ **§7.3 MEASURED 2026-09-05 (Heron, box read-only, 7 worn sessions):** on `0x04` the isolated `156` is ONE ROW PER BEAT (ratio 0.986–0.996 on every long night, modal row gap = 125 × 60/PR + 1, PERIODIC refuted) — §2.1's 1.22 was a 403 s fragment; the `0x03` 1.96 half and ~~**§7.4's 112.9-vs-125 Hz**~~ **§7.4 MEASURED 2026-09-06 (Wren): 125.058 Hz over 119.7 s, the 125.000 ADC to 0.05 % — the 112.9 does not reproduce, and marker subtraction makes it WORSE on this stream (124.444), opposite to `0x05`. `0x03` is now captured nightly as the opt-in `pletha` stream (#2282).** The `0x03` marker half is answered with it (0.534/s against 62.0 bpm, ~0.5 per beat, not 1.96). **Owner:** owner (daylight walk) / Heron (§7.4 probe, needs the ring worn outside a capture night) · **Next step:** the daylight walk — it is the only one needing weather. ⚠ **TRIAGED 2026-09-06 (Finch, offline, no device; verified on main 2026-09-09, Kestrel): §7.1's rate discrepancy is ALREADY RESOLVED IN CODE and this brief never recorded it.** #1596 (`a2ab5a7f`) measured **282,402 of 284,420 buffers pinned at the 102-record reply cap across 39 real files** — the device fills faster than a 1 Hz drain empties it, so the nightly ~100 Hz is `CAP × poll rate` and not a property of the stream, and the excess was being silently lost. The second mid-cycle drain fixed the loss. §7.1's *'153 × ⅔ = 102'* note is therefore a numerical coincidence rather than the mechanism, and `~153 Hz` is the origin-forced estimator's bias against a 7.9-record intercept (`oxyii.parse_rt_ppg` records 125.7 Hz by least squares over 35 unsaturated replies — consistent with the 125.000 ADC). What is left is not a puzzle but a measurement nobody takes → residue `2026-09-06-ppg2w-fill-rate-unmeasured` · ⚠ **RE-VERIFIED 2026-09-19 (Wren, box + tree):** landed in the surface I checked since 09-09 (subjects /ppg2w|dual|wavelength|fill.rate|0x05|pletha/): #2433 (2026-09-12) measured the ppg2w FILL rate for the first time (~200 Hz) and residue `2026-09-06-ppg2w-fill-rate-unmeasured` is closed `fixed #2433`; #2436 (09-13) records that the 200 Hz was already written down and two briefs disagreed. §7.2 (wavelength identity, daylight walk) has no landing and is the only open item. BOX: `ppg2w` still captured nightly (2026-09-17: 4,451,693 rows). Corpus note from the 2026-09-18 census (56 nights): the ppg2w channels produce ZERO constant runs ≥ 5 at any threshold — values in the ~10^6 range never repeat — so the §∅ run-length sidecar is inert on this stream by construction; the ring's 0 / 199 / 100 populations live on `0x03` `channel 0` only) · **Residue:** 2026-09-06-ppg2w-fill-rate-unmeasured · **Created:** 2026-08-05

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
   > rather than as a property of the stream. *(⚠ SUPERSEDED 2026-09-06 — the ⅔ was a coincidence. #1596
   > measured the mechanism: 282,402 of 284,420 buffers pin at the 102-record reply cap, so 101.5 Hz
   > is `cap ÷ poll period` and the stream was losing every sample past the cap. Do not read the
   > nightly figure as a device rate; nights captured since #1596 drain twice a cycle and their
   > UNSATURATED counts carry the real fill rate — which nothing computes.)*
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

## 8 · What a stuck value means TO the ring — vendor facts + a PRE-REGISTERED capture (2026-09-24, Finch)

**Status of this section: DESIGN ONLY. Nothing below has been run.** The predictions in §8.4 were written
before anyone looked at a `PPG2W` or `ACCRAW` sample from the segments they describe, and they are
committed before the retrospective arm (§8.5) or any new capture is scored. Relayed via Kestrel; the
fleet unit was *"what does a stuck value mean to the O2Ring?"*.

### 8.1 · Already answered — read these first, do not re-derive

- `docs/O2RING-FINGER-OFF-2026-09-19.md` (owner + Wren, pre-registered): **settled finger-off ⇒ exactly
  100**, one run per stretch, 2,690–15,023 samples. **0 and 199 are in-wear events**, arriving together
  as short full-scale excursions when the pulsatile signal is disturbed. The stream falls to flat 100
  under disturbance as well, so **100 means "no pulsatile AC", and no-finger is only one cause of it.**
  Of 164 corpus 100-runs ≥ `T_STUCK`, 139 are explained by file position (idle tails, reconnects) and
  **3 are bracketed by pulsatile signal on both sides (worn)**: 221 / 411 / 3,968 samples (2026-08-05 ·
  08-31 · 09-11). The only stimulus that produced a worn run ≥ 200 on demand was the **phone flashlight
  (672 @ 100)**.
- `briefs/PPG-ABSENCE-AS-VALUE-2026-09-06-BRIEF.md` §2 / §4b / §4c: why `T_STUCK` = 200; `stuck` and
  `clip` are different predicates; `ppg2w` has zero constant runs ≥ 5 over 56 nights; the `accraw`
  maximum is 45 (worn).

The open part is therefore narrower than the question as posed: **when the WORN ring emits flat 100 for
≥ 200 samples, is that the optical front end losing the signal, or the ring's pleth pipeline declaring
"no AC" while the front end still sees a pulse?** `_PPG` alone cannot tell those apart. `PPG2W`, the
raw signed 24-bit AFE channels (§1), can.

### 8.2 · Vendor side [SDK] — `lepu-blepro-1.3.9`, the OxyII real-time wave reply (`OxyIIBleInterface`, `RT_WAVE`)

The facts are stated here; no code is reproduced (the upstream has no licence).

1. **The wave is u8 with exactly ONE special value.** The SDK replaces every **156** with the average of
   its neighbours (at an edge it copies the one neighbour it has) before handing the wave to the app.
   **No other value is treated as special.** 0, 100 and 199/200 pass through unmodified. So the vendor's
   own app draws the 0/199 excursions and the flat 100 as signal: **the vendor defines no in-band
   invalid value for the pleth.** This confirms, from the vendor side, that `PPG_INVALID` (156) is a
   marker the app smooths over and not a blanking code.
2. **The app plots the wave inverted** (displayed = 127 − byte). That is a display fact only, and it
   gives 100 no special meaning.
3. **Validity travels out-of-band in the vendor's own design.** The 1 Hz real-time parameter reply
   carries `sensorState` and `runStatus` fields beside SpO₂, PR, PI and motion. That is the §∅ sidecar
   pattern (validity beside the data, never inside it), and Tepna's contact byte is the same kind of
   signal, joined to span rows since #2685. *Not verified here:* whether Tepna's contact byte
   (`oxyii.py:680`) is the same byte as the SDK's `sensorState`. Settling that is a one-frame check if
   anyone needs it.
4. The legacy (non-OxyII) oxy parser in the same AAR also smooths **246**. **246 occurs 0 times** in
   the four 2026-09-19 `S8AW2100` `_PPG.txt` files (156: 912–21,100 per file), so on this ring it is
   inert. It is recorded here so a future ring that emits it is recognised as a marker and not read as a
   rail.
5. **TI AFE44xx** (the front end §1 matched): the output registers are 24-bit two's complement, and
   the datasheet has no "invalid" code. A saturated photodiode shows up as a value **at or near full
   scale**, not as a sentinel. So on `PPG2W`, loss of the optical signal predicts *pinned near a rail*
   and absence of a finger predicts *no pulsatile component*. Neither predicts a zero.

**What a stuck value means to the ring, then:** nothing. Neither the firmware protocol nor the SDK
assigns any meaning to a constant pleth value. A flat 100 is the pipeline's output when it has no AC
component to report, 0 and 199 are the ends of its u8 range, and the ring's own statement about
validity is the 1 Hz state field. Consumers should keep keying on run length plus that out-of-band
field, exactly as §∅ already rules.

### 8.3 · Capture design (not execution)

**One variable at a time; everything else as on 2026-09-19.** Same ring (`S8AW2100`), same finger as a
normal night, hand resting on a table at heart height, room lights on, no direct sun, box settings
identical to a night except **`ppg2w` enabled**. `ACCRAW` and `OXYFRAME` are on by default. `pletha`
(`0x03`) stays **off** because it takes a second poll's airtime and would change the conditions the 09-19
baselines were taken under. Marks are typed in chat and the times are taken from the files' own
transitions (the 09-19 protocol).

**Time anchor:** three sharp taps on the ring about 1 s apart at the START of every segment. They show
as three transients in `ACCRAW` and give each segment a start time that does not depend on the pleth
being scored.

| seg | condition | duration | what it isolates |
|---|---|---|---|
| S0 | worn, still | 120 s | baseline for this session |
| S1 | **flashlight**: phone torch pressed to the finger opposite the sensor | 60 s | the ONE known on-demand worn run ≥ 200 |
| S2 | worn, still (washout) | 60 s | return to baseline |
| S3 | **occlusion**: firm pressure with the other hand at the finger base. Not a tourniquet; stop on any discomfort | 45 s | low perfusion without a light change |
| S4 | worn, still (washout) | 60 s | — |
| S5 | **finger-off in the dark**: ring removed and placed in a closed opaque box, sensor up | until idle-off | no finger AND no light |
| S6 | **finger-off in room light**: the 09-19 condition, repeated with `PPG2W` on | until idle-off | no finger, light present |

**S5/S6 caveat:** the doff-pull pauses capture 25–58 s after removal, and the post-reconnect stream then
runs about 120 s to the ring's idle timer (09-19). The off-finger reading comes from that post-reconnect
window. **LED-off is not realisable:** no known command switches the ring's LEDs, so S5 (no light at
all) is the nearest substitute and is labelled as such.

### 8.4 · Predictions — written before any data, scored per segment

`_PPG` run lengths are counted with the `156` marker excluded, as in 09-19 §B. "Row" means a `stuck`
row in the sidecar at `min_run` = `T_STUCK` = 200.

| seg | `_PPG` (value / longest run / sidecar row?) | `PPG2W` | `ACCRAW` | contact |
|---|---|---|---|---|
| S0 | modal ~100–120, longest run < 60, **no row** | no constant run ≥ 5, pulsatile | held 6/7, max run < 50 | worn |
| S1 | **≥ 1 run @ 100 of ≥ 200 → a row with `bracket=varied/varied`** | **≥ 1 channel pinned near a rail (constant run ≥ 5), the first in the corpus** | held; tap transients only | **worn** |
| S3 | pulsatility collapses toward 100; runs @ 100 up to ~100 samples, **no row**; short 0/199 runs present | AC reduced but present, no constant run ≥ 5 | held | worn |
| S5 | one run @ 100 for the whole post-reconnect window (≈ 15,000), **a row, `closed=0`** | no pulsatile component; low variance near the channels' offset; no run ≥ 200 | **≥ 1 run ≥ 200 (first ever): a ring lying still on a table** | **not worn** |
| S6 | as S5 (reproduces 09-19) | as S5, but variance ABOVE S5's (ambient light reaches the photodiode) | as S5 | not worn |

**The decision the whole capture exists for is S1:**

- **`PPG2W` pinned while `_PPG` sits at 100 ⇒ OPTICAL.** The front end saturated and the pipeline
  reported no AC. A worn run ≥ 200 is then a real loss of measurement, and the 3 bracketed corpus runs
  are candidates for it (checkable by the same `PPG2W` read on those nights, if `ppg2w` was enabled then; not verified here).
- **`PPG2W` still pulsatile and unpinned while `_PPG` sits at 100 ⇒ ALGORITHMIC.** The pipeline lost
  lock while the optics still carried a pulse, so a worn flat 100 is recoverable from `PPG2W` and is
  *not* an absence of signal at the sensor. That would change what a `stuck` row on `ppg1` should be
  allowed to claim.
- Anything else (for example `PPG2W` also flat but not near a rail) is a third outcome. It gets
  reported as observed, with no mechanism attached.

Pre-stated confidence: S1 optical, moderate (a torch is far brighter than the LEDs' ambient-cancellation
headroom); S5 `ACCRAW` ≥ 200, moderate (one LSB of accelerometer noise would break the run, in which
case the prediction fails and the observed maximum is reported); all others high.

### 8.5 · Retrospective arm — run BEFORE a new capture, AFTER this section merges

The 2026-09-19 sessions `…103348` (finger-off morning) and `…184006` (evening disturbances) already
carry `PPG2W` and `ACCRAW` beside `_PPG`. Nobody has read them for these segments; this author has not
either. Scoring §8.4's S1, S3 and S6 rows against those files using the 09-19 marks costs no
hardware time. A new capture is needed only for what they cannot answer: S5 (no light), and the tap
anchors (the 09-19 marks were typed in chat, not tapped). **If the retrospective arm settles the S1
decision, S5 is the only segment left worth a session.**
