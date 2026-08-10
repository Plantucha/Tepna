<!--
  PAT-COMPENDIUM-2026-08-10-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** REFERENCE (living — the single entry point for PAT; last-verified 2026-08-10) · **Created:** 2026-08-10 · **Supersedes:** `PAT-VERDICT-CONSOLIDATED-2026-08-04-BRIEF.md` · **Consolidates:** `PAT-UNEXPLAINED-130MS-DISCOVERY-2026-08-09-BRIEF.md`, `PAT-SAWTOOTH-ANSWERS-THE-130MS-2026-08-10-BRIEF.md`, `PAT-SENSOR-PLACEMENT-CORRECTION-2026-08-04-BRIEF.md`

# Pulse Arrival Time in Tepna — everything established, and the three rate errors that hid it

> **On the two header fields.** `docs-ledger` check5 models `Supersedes`/`Superseded-by` as a strict
> **1:1** pair, so a many-to-one consolidation cannot be expressed in it. The one brief this
> genuinely *replaces* — the standing verdict — carries the gated pair; the other three carry
> `Consolidated-into:`, which is deliberately outside that vocabulary. Do not widen check5 to make
> a list fit: the 1:1 ratchet is what makes an unpaired link detectable at all.

> **Read this first, and read it instead of the four briefs it replaces.** Each of those stays on
> disk as the primary record of its own measurement — nothing is deleted and no filename moves — but
> their *conclusions* are restated here, several of them reversed. Where this brief and an older one
> disagree, **this one wins**; where it cites a number, the citation names the brief that measured it.

---

## 1 · The verdict, and it is the opposite of the one that stood for six days

`PAT-VERDICT-CONSOLIDATED` (2026-08-04) concluded: *"PAT is blocked by ~90 ms of beat-to-beat scatter
that is downstream of the heart… It is not a clock problem, not an alignment problem, and not a method
problem. It is the signal."*

**That is wrong, and all three of the things it ruled out were the cause.** The ~90 ms was never
physiology. It was three independent rate errors and one windowing artifact, stacked:

| # | error | size | found |
|---|---|---|---|
| 1 | **ECGDex derived `fs` from the lossy `[ms]` column and ROUNDED it to the nominal 130** | 46–126 ppm ⇒ **1.25–4.16 s of drift per night** | 2026-08-10, fixed in #1121 |
| 2 | **The O2Ring's *row* rate was read as its *sample* rate** — the ring inserts one `156` marker row per beat, so rows run at `125.000 × (1 + HR/7500)` | ~6900 ppm | already solved in-tree (`O2_ADC_HZ`), re-derived 2026-08-10 |
| 3 | **`pat-align.js`'s `PHYS = {200, 650}` is a 450 ms acceptance window**, and `450/√12 = 129.90 ms` | *is* the reported "131–136 ms" | 2026-08-09 |
| 4 | Every historical verdict was computed on the **phone corpus**, where `hostAxis.independent` is false | no second clock at all | `PAT-UNEXPLAINED-130MS` §2 |

With (1) fixed and (2) avoided, on box captures, the R-peak → finger-foot interval measures:

| night | Rayleigh R | lag median | **within-5-min-bin σ** |
|---|---|---|---|
| 2026-08-01 | 0.542 | 399 ms | **10 ms** (111 bins) |
| 2026-07-27 | **0.897** | 437 ms | **22 ms** (74 bins) |
| 2026-08-04 | 0.183 | 692 ms | 23 ms (93 bins) |
| 2026-08-03 | 0.308 | 421 ms | 54 ms |
| 2026-08-07 | 0.054 | 503 ms | 39 ms |
| 2026-08-05 | 0.306 | 679 ms | 113 ms |

**10–23 ms on three of six nights**, against a published 8.22–15.4 ms and a `pat-gate.js` bar of 60 ms.

⚠️ **Status of these six rows: ONE session, not gate-backed.** They are the reason the old verdict is
withdrawn, not yet the reason to publish a new one. What is solidly established is the *negative*: the
~90 ms figure was measured through a broken axis, a mis-read rate and a fixed window, so it does not
support the claim built on it. §9.1 is the work that would make the positive claim safe.

## 2 · Hardware and placement — wearer-confirmed, and a prior analysis died on getting it wrong

| device | site | stream that matters | rate |
|---|---|---|---|
| Polar H10 `02849638` | **chest** | `_ECG.txt` | 130 Hz nominal, **129.9866–129.9966 real** |
| Wellue O2Ring `S8AW2100` | **RIGHT INDEX FINGER** | `_PPG.txt` (display) · `_PPG2W.txt` (raw, 2-channel) | **125.000 Hz ADC** (row rate ~125.8) |
| Polar Verity Sense `0C301E3F` | **LEFT ANKLE** — *not* the arm | `_PPG.txt`, 3 LEDs + ambient | 55 Hz; **176 Hz from 2026-08-10** (§6.3) |

Chest→ankle is the **longest** path on this hardware (~100–120 cm, the basis of baPWV); chest→finger
is ~60–80 cm. `PAT-SENSOR-PLACEMENT-CORRECTION` records that several briefs assumed an armband and
then used an arm/wrist plausibility band **in both directions** — rejecting 406–498 ms as too long and
accepting 200–250 ms as a check that passed. *"A result was rejected on an anatomy it did not have."*

**Never derive HR from a device's own summary file.** The Verity `_HR.txt` is all-zero and `_PPI.txt`
is often header-only; the H10 `_HR.txt` is smoothed and under-states σ. Both legs come from the raw
waveform. (`CLAUDE.md` §🎙️.)

## 3 · The corpus — and the two trees are not interchangeable

- **BOX** (`boxcaps/` locally, `/srv/tepna/captures` on vigil): 2026-07-25 → present, full waveforms.
  `DexClock.hostAxis` returns `independent: true` on **30/30** stream-nights, residual spread
  318–2968 ms. **A real second clock exists.** Use this.
- **PHONE** (`Ecg nightly/`, and every `uploads/trio/` night before 2026-07-16): residual spread
  **0.98 ms** — one stamp quantum, because the capture app derived the host column from the device
  stamp. `independent: false`; `pat-gate.js` refuses it outright.

⚠️ **Every PAT verdict published before 2026-08-09 was computed on the phone tree.** They are
*unfalsified, not established.* H10↔Verity sits ~3.3 s apart on phone nights against ~0.2 s on box
nights — only the box actually puts two devices on one timebase.

15 box nights carry both an H10 ECG and a Verity PPG; **3 of them (2026-07-26, -29, -30) have ZERO
overlapping bins** — the two files never cover a common wall interval. That is a capture question.

## 4 · The clock, in the detail PAT actually needs

### 4.1 · A device's nominal rate is not its rate, and a row rate is not a sample rate

Both of the big errors are the same mistake wearing different clothes: **a rate was assumed instead of
measured, and the file already carried the answer.**

- **H10** — `parseECGText` averaged the `timestamp [ms]` column and `Math.round`ed it, which forces the
  nominal 130 and throws the crystal away. The `sensor timestamp [ns]` column beside it is an *integer
  counter with no precision loss*. Fixed in #1121: derive `fs` from it, unrounded, and anchor the host
  axis on the same column so `fs` and `correctionAt` share one domain.
- **O2Ring** — the `ns` column advances ~125.8 Hz, but the ADC is **125.000 Hz exactly**
  (32 MHz ÷8 ÷32000, TI AFE4403). The difference is one inserted `156` marker row per heartbeat.
  Verified 2026-08-10: **28219 marker rows = 0.667 % of 4 228 155 rows**, predicting a row rate of
  125.834 against 125.864 measured (238 ppm). The `O2_ADC_HZ` device-crystal path already handles this
  and is now the default — `fs` reports `125.0000`. **Do not "re-fit" the ring's rate; you will fit the
  heart rate.**

### 4.2 · Two guards worth carrying to any new parser

- **A counter legitimately starts at 0.** A `rawNs > 0` guard rejects row 0 and anchors the axis one
  sample late, putting a phantom one-sample spread on every anchor — enough to flip `independent` to
  true on a derived column. Real Polar files hide it (their counter is ~8.4e17).
- **A column present but STUCK is not a counter.** A literal `0` placeholder collapses every anchor to
  `devMs = 0`. The "does it count" test is *did it ever advance*, and it must gate the rate derivation
  and the anchor choice **together** — an `fs` from one axis with anchors from another does not compose.

### 4.3 · The axis a node should hand PAT

Measured five ways on the ring against the ECG (Rayleigh R of the lag phase, higher is better):

```
                                  08-07   08-01   07-27   08-03   08-04
uniform ladder @ host fs          0.349   0.061   0.390   0.052   0.103
uniform ladder @ counter fs       0.286   0.153   0.056   0.100   0.302
the COUNTER itself                0.169   0.125   0.736   0.158   0.059
counter + hostAxis correction     0.038   0.577   0.902   0.722   0.409   ← what ppgdex ships
raw HOST stamps per sample        0.037   0.573   0.910   0.717   0.406
```

**A uniform `i/fs` ladder is the worst choice on four of five nights**, because it cannot represent a
dropout — every lost sample is spent as rate. 2026-07-27 has **6296 dropouts totalling 439.6 s (1.93 %
of the span)**: the ladder scores 0.056 there and the host-stamped axis 0.910. `ppgdex-dsp.js` already
computes the right thing (`relSec = (devMs + correctionAt(devMs))/1000`); **harnesses that rebuild the
axis by hand are where this goes wrong.**

## 5 · What the sensors are actually capable of

### 5.1 · Fiducial jitter is ~1.3–2.0 ms, not 19.4 ms

Three-cornered hat over the Verity's three LEDs, **sub-sample** fiducials (parabolic peak / tangent-
crossing foot), on nights that pass an anti-vacuity check:

| night | pairwise robust sd | hat: ch0 / ch1 / ch2 |
|---|---|---|
| 2026-08-03 | 2.47–2.73 ms (n=22 677, 1.7 % zero) | 1.86 / 2.00 / 1.63 ms |
| 2026-08-07 | 1.81–2.08 ms (n=30 092, 1.3 % zero) | 1.32 / 1.61 / 1.25 ms |

The 19.4 ms in `PAT-UNEXPLAINED-130MS` §4 was measured on **integer sample indices** — it is the 55 Hz
grid, not the sensor. **The fiducial contributes ~0.5 % of PAT's variance and is not the limit.** This
also exonerates the shipped `refineFeet`, which already does the sub-sample tangent crossing; the
separate criticism of its *search window* (a full cardiac cycle) is unaffected.

### 5.2 · The O2Ring's optics equal the Verity's — in the file nothing reads

| | foot-to-foot sd | distinct levels | longest stuck run | device clock |
|---|---|---|---|---|
| `_PPG.txt` (read by the tree) | 91.8 ms | ~196 | **2875 samples = 23 s** | yes, ~125.8 row |
| `_PPG2W.txt` (unread) | 18.9 ms | >200 of ~1.3 M counts | 2–3 | **none — `ns` all zero** |

Inter-channel fiducial agreement on `_PPG2W`: **0.89–2.37 ms**, matching the Verity's 1.8–2.7 ms. That
comparison shares one axis, so a rate error cancels in it — which is why it survives everything above.
⚠️ `_PPG2W.txt` has **no device clock at all**, so it rides raw host stamps; it has the better optics
and the worse timing. Whether it is a plethysmogram and whether its channels are red/IR is **open** —
see `O2RING-RAW-DUAL-WAVELENGTH-2026-08-05-BRIEF.md` §1.2④, which this brief does not settle.

### 5.3 · The ambient channel is clean, and useful for exactly one thing

Rayleigh phase-lock of ambient to the ch0 beat cycle: **R = 0.033**, against shifted-ambient controls
of 0.024–0.032, a noise floor of 0.022, and a **ch1-vs-ch0 positive control of 0.999**. **No optical
crosstalk.** A detector run on it reports "56.5 bpm" — that is the detector ringing in noise, and rate
alone cannot tell the difference; phase-lock can.

Ambient subtraction is a **no-op** (`ch0 − amb` gives 82.3 ms vs 82.1 ms raw), so PPGDex parsing `amb`
and not using it is correct. Its one real use: ambient spread is 177–187 counts across 89 bins all
night and **650 633 in bin 0** — a don/settle flag needing no heuristic.

### 5.4 · Sample rate above 25 Hz buys nothing

`PPG-SAMPLE-RATE-AND-PAT` §3, by decimating one 176 Hz recording (the only honest way to ask):

```
176 Hz 18.68 ms  ·  59 Hz 18.61  ·  44 Hz 18.96  ·  25 Hz 18.65  ← flat
                                     22 Hz 40.39  ← cliff, 2.2×
```

⚠️ **`PAT-VERDICT-CONSOLIDATED` §4.1 called 176 Hz "the single most promising open item". It is not**,
and the brief that measured it was already in the tree. HRV is likewise flat from 44 Hz up. 176 Hz was
enabled on 2026-08-10 anyway (§6.3) — it costs 3.2× disk, gives a 5.7 ms quantum, and is expected to
move PAT very little.

## 6 · Operating the capture for PAT

### 6.1 · The measurement that cannot inherit its own answer

Pair each R-peak to the **nearest** PPG fiducial — no window, no direction — so `PHYS` cannot leak in.
Then bin at 5 minutes and take `IQR/1.349` within bins. Report the **Rayleigh R of the lag phase**
beside it: R≈0 means the lag is uniform over the cardiac cycle, i.e. not time-locked to the heartbeat
at all, and no σ computed from it means anything.

### 6.2 · Never quote a σ without dividing by `w/√12`

A uniform distribution on width `w` has sd `w/√12`. This has produced a false result **three** times
here: `450/√12 = 129.90` (the `PHYS` window, §1), `70/√12 = 20.2` (a narrowed pairing window), and
`RR/√12 ≈ 293–346` (a full-cycle sawtooth). **Always report `measured_σ ÷ (w/√12)`; a ratio near 1.00
means you measured your window.** Widening cannot reduce it either.

### 6.3 · The Verity's extended rate menu is behind SDK mode

The device advertises `ppg: [55]` in normal mode and `[28, 44, 55, 135, 176]` in SDK mode. Both
`sdk_mode: true` **and** `rates: {ppg: 176}` are required, and the API refuses the rate first because
it validates against the menu currently visible — so set the mode, let the device reconnect, then set
the rate. Verify from **`sdk_mode_actual` and bytes on disk**, never from config: the code's own
warning is *"a night captured at 55 Hz under a config that reads 176, with every card green."*
Applied and verified 2026-08-10 at **175.92 Hz measured**.

## 7 · Eliminated by measurement — do not re-derive (but do feel free to falsify)

Carried forward from `PAT-VERDICT-CONSOLIDATED` §2, with its provenance intact:

| candidate | measured | where |
|---|---|---|
| crystal drift | `halfDrift` 47/54, implied **1.46 ppm** | `INTEGRATOR-PAT-VASCULAR` §2-RESULT-II.3 |
| beat-slip in the coupler | *"1147 ms IS one RR"* — real, fixed, 16 gated assertions | `PAT-FEASIBILITY` §CAUSE-CORRECTED |
| ACC-anchor alignment | anchors disagree with **themselves** by 1171–3094 ms | `PAT-UNDER-PERBLOCK-ALIGNMENT` §3e |
| pair selection | `matchRate` spans 0–77 % across pairs of ONE night | ibid. §3c |
| offset identifiability | knowable only to **~450 ms mod one RR** | ibid. §3e.4 |
| the phone host clock | 76/76 files agree with the device to 1 ms; 0/104 independent | `PAT-NO-VALID-ANCHOR` §8 |
| foot vs peak as the timing point | paired **−0.5 ± 5.1** over 45 windows | `PAT-UNDER-PERBLOCK-ALIGNMENT` §3g |
| pre-ejection period | ankle→finger cancels PEP; scatter does not collapse (92 vs 84 ms) | ibid. §3j |

And added 2026-08-09/10: host clock (**chrony 24 µs**), host scheduling (**σ 0.073 ms** during live
capture), BLE jitter (both sites equally), the PPG foot fiducial (§5.1), and beat correspondence — PPG
index step is **1 on every beat** over 60-beat runs, per-10-min counts agree ±1 in 30/44 bins, and the
two HR curves cross-correlate at **r = 0.988 at lag 0**.

## 8 · Traps. Every one cost real time; please do not re-pay them.

- **`w/√12`** — §6.2. The single most expensive one in this family.
- **A statistic whose reference comes from the data it tests cannot fail.** Twice: `matchRate`'s stage
  two, and `strictMatchRate.residIQR`, bounded by its own ±40 ms window so it reads 31–44 ms regardless
  of signal. **It must never be compared to the 60 ms bar.**
- **A closure test `lag(A→C) = lag(A→B) + lag(B→C)` is a TAUTOLOGY** when both paths select the same
  beat — verified 2001/2001 on a synthetic train. `tools/pat-three-corner.mjs` keeps one only as a
  documented warning against itself.
- **Unwrapping a sawtooth beat-by-beat reports a spurious ~1.5 cycles** — beat noise against RR
  variability breaks the half-cycle test. Unwrap the **5-minute medians**.
- **A sweep grid coarser than the feature finds nothing.** Over a 6 h record the lock optimum is
  ~23 ppm wide (0.003 Hz); a 0.05 Hz grid steps clean over it and returns a neighbouring point as
  "best". Size the grid from the record length before trusting a sweep.
- **A detector finds a plausible heart rate in noise.** Rate is not evidence of a pulse; **phase-lock
  against a positive control** is (§5.3).
- **A three-cornered hat on integer sample indices returns 0.00 ms.** At 55 Hz nearly every
  inter-channel difference is exactly 0 or one sample, so the MAD is 0 and the hat has no dynamic
  range. Print the exactly-zero share as an anti-vacuity check; sub-sample the fiducial.
- **An N-corner hat needs TWO legs per site.** With one chest sensor, `σ[H10]` and every chest site-pair
  term are perfectly confounded — the solve slides down that degenerate direction and dumps all the
  cross-site variance onto the ECG leg (measured: `σ[H10] = 343.05 ms`, three negative variances, one
  NaN). Cross-site pairs also carry real transit time, which a classic hat books as sensor noise.
- **`pat-matchrate-strict.mjs` silently falls back to the Verity** when it cannot align the ring — it
  answers the *ankle* question while appearing to answer the finger one.
- **`tch-reference-validation.mjs` has `CLIP_MIN = 30`** — it analyses the first 30 minutes only.
- **`ppgFootTimes` picks its reference channel by PEAK COUNT**, which rewards over-detection.
- **`consensusBeats` degrades same-wavelength feet** (per-LED 118.0–120.9 ms → consensus 133.2 ms).
- **The positive control had never executed.** `tools/pat-ppg-ppg-control.mjs` referenced `RE_WRIST`,
  defined in no revision. Fixed 2026-08-09 — meaning no PAT verdict before then was backed by its own
  control.

## 9 · Open — in priority order

1. **Re-establish §1's numbers as a gate.** Six nights from one session is not a verdict. Enumerate all
   box nights, both peripheral sites, with the anti-vacuity checks of §6.1–§6.2 wired in, and land it
   as a test group so it cannot silently rot.
2. **Three of six nights do not lock** (R = 0.054–0.306) and it is not yet known why. This is now a
   per-night question, not a systematic one.
3. **`PHYS = {200, 650}` has never been re-derived.** A fixed window over a drifting offset can only
   report `w/√12`; with the drift removed it may be defensible, but nobody has checked, and every
   historical verdict passed through it.
4. **The H10 accelerometer as a second chest leg** — a ballistocardiogram from the same strap would give
   the chest site two legs and make the N-corner hat of §8 identifiable.
5. **`_PPG2W.txt` is unread by the tree** and has the better optics (§5.2). Reading it needs a timing
   story first, since it carries no device clock.
6. **The residual drift after the #1121 fix** is ≤3 ppm on five of eight nights but not zero.

## Cross-references

**Superseded by this brief** (conclusions restated here; each remains the primary record of its own
measurement): `PAT-VERDICT-CONSOLIDATED-2026-08-04` · `PAT-UNEXPLAINED-130MS-DISCOVERY-2026-08-09` ·
`PAT-SAWTOOTH-ANSWERS-THE-130MS-2026-08-10` · `PAT-SENSOR-PLACEMENT-CORRECTION-2026-08-04`.

**Still live, not superseded** — each owns work this brief only summarises:
`PAT-FEASIBILITY-2026-07-08` (the coupler beat-slip fix) · `PAT-NO-VALID-ANCHOR-2026-08-02` ·
`PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02` (the elimination measurements of §7) ·
`PAT-PROXIMAL-DISTAL-PAIR-2026-08-04` · `PPG-SAMPLE-RATE-AND-PAT-2026-08-03` (§5.4's decimation) ·
`INTEGRATOR-PAT-VASCULAR-2026-07-18` · `O2RING-RAW-DUAL-WAVELENGTH-2026-08-05` (§5.2's open question) ·
`TCH-PAT-DRAWN-AXIS-GUARD-2026-08-08` · `JOINT-UNWRAP-ATTEMPT-2026-08-02` + its FOLLOWUPS.

**Code:** `pat-align.js` (`coupleRtoFoot`, `PHYS`) · `pat-gate.js` · `pat-feasibility-worker.js` ·
`ppgdex-dsp.js` (`detectChannel`, `refineFeet`, `consensusBeats`, `O2_ADC_HZ`) · `ecgdex-dsp.js`
(`detectPeaks`, the `fs` derivation) · `clock.js` (`DexClock.hostAxis`, Clock Contract §7).
