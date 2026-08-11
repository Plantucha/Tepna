<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** REFERENCE (living — last-verified 2026-08-10) · **Created:** 2026-08-10

# The overnight PAT wander: nineteen candidates measured out, none surviving

`PAT-DRIFT-STATISTIC` established that the PAT gate was rejecting nights on a statistic that saturates
at the pairing window, and replaced it. It left one question open, and this brief is the answer to it
so far: **the bin-median R-to-foot lag moves 72–129 ms across a night on recordings that are otherwise
pristine, and nothing yet explains it.**

The wander is not a nuisance term to be suppressed. Whether it is physiology or artifact decides
whether PAT measures anything here at all, so it was worth an exhaustive elimination. **Nineteen
candidates were tested; none survived.** One appeared to and is retracted below.

This is a **negative-results record**. Its value is that each item is measured, so nobody re-derives it.

**Corpus.** `boxcaps/` box captures 2026-07-25 → 2026-08-09, H10 chest ECG × {O2Ring finger, Verity
left ankle}, post-#1121 DSPs, 5-minute bins qualified by match rate ≥ 80 % and within-bin IQR ≤ 60 ms
(`PAT-DRIFT-STATISTIC` §4). Phone-tree nights are excluded throughout — they carry no second clock
(CLAUDE.md §7), so no cross-device claim is identifiable on them. One subject, one device set.

## 1 · What the wander is, as a measured object

- **Smooth and driftless.** Theil–Sen slope of the bin medians −6.9…+24.8 ppm, median ≈ −1. Median
  bin-to-bin step 6–35 ms. It is a random walk, not a ramp — which is exactly why its *range* saturates
  at the 450 ms pairing window and had to be replaced as a gate criterion.
- **Present at full quality.** 2026-07-28 finger: the lag walks 428 → 369 → 441 ms over three hours at
  97–100 % match with 7–39 ms within-bin IQR, and the chest does not move. Nothing is broken.
- **COMMON-MODE across two PPG devices with independent clocks** — ρ(finger, ankle) over shared bins =
  0.85 (07-27) · 0.86 (08-02) · 0.79 (08-03) · 0.95 (08-05) · 0.68 (07-28); 0.05 on 08-01, which has
  only 12 shared bins. ⚠️ **This figure is analysis-dependent on some nights — see §1.1.**

**The common-mode result is the load-bearing one.** Two independent devices moving together places the
term upstream of both.

### 1.1 · CORRECTION — part of the apparent common-mode is manufactured by the shared analysis

The claim above was measured under ONE window and ONE qualification rule applied to BOTH legs, and the
analysis layer is itself a shared term (§2.1 cell 14/15). Re-running with the analysis varied:

| night | config | finger | ankle | ρ | edge-censored |
|---|---|---|---|---|---|
| **2026-08-02** | shipped `[200,650]` 5 min | 125 | 129 | **0.86** | **0 % / 0 %** |
| | WIDE `[100,900]` 5 min | 125 | 129 | **0.86** | 0 % / 0 % |
| | narrow `[250,550]` 5 min | 125 | 129 | **0.86** | 0 % / 2 % |
| | 15 min bins | 96 | 110 | 0.88 | — |
| | no qualification | 125 | 129 | 0.86 | — |
| 2026-07-28 | shipped | 63 | 75 | 0.68 | 0 % / **37 %** |
| | WIDE | 72 | **111** | **0.52** | 0 % / 1 % |
| 2026-08-03 | shipped | 186 | 142 | 0.79 | 7 % / 13 % |
| | WIDE | **586** | 238 | **0.51** | 3 % / 4 % |
| 2026-08-05 | shipped | 110 | 119 | 0.95 | 10 % / 13 % |
| | no qualification | 395 | 430 | **−0.13** | 10 % / 13 % |

Two conclusions, opposite in direction:

- **On a night with ZERO edge censoring the wander is completely analysis-invariant.** 2026-08-02 gives
  125/129 ms and ρ = 0.86 under every window, every bin width, qualified or raw. That night is a clean
  positive control: its wander is in the signal, not in the analysis. This is the strongest single
  result in the brief and it did not exist before the correction.
- **Where the lag distribution reaches the window edge, the shipped `[200,650]` TRUNCATES real lag and
  the shared cut inflates the apparent agreement.** 07-28's ankle is 37 % censored; widening drops that
  to 1 % and takes ρ from 0.68 to 0.52. Widening triples 08-03's finger wander (186 → 586). Dropping
  qualification takes 08-05 from ρ = 0.95 to **−0.13**.

**So `PHYS = [200, 650]` is not merely a physiological plausibility range — it is a censoring cut that
biases every statistic computed through it,** and nights must be screened on edge-censoring fraction
before their common-mode is quoted. The headline figure should be read as **ρ ≈ 0.86 on the uncensored
night**, with the censored nights' values not yet trustworthy in either direction.

### 1.2 · ⛔ THE OBJECT WAS TWO PHENOMENA — most of §3 was computed on a mixture

§1.1 said nights must be screened on edge censoring. Doing it produced a stronger result than a
caveat. Pairing WITHOUT the window — first foot after R, bounded only by `0.9 × local RR`, which is the
constraint that actually prevents beat slip — measures the censoring instead of assuming it:

| night · site | uncensored median | below 200 | above 650 | **total censored** | uncensored wander |
|---|---|---|---|---|---|
| **2026-08-02 finger** | 366 | 0.1 % | 0.1 % | **0.1 %** | **125** |
| **2026-08-02 ankle** | 336 | 0.0 % | 0.0 % | **0.0 %** | **129** |
| **2026-07-28 finger** | 401 | 0.1 % | 0.1 % | **0.2 %** | **72** |
| 2026-07-28 ankle | 224 | 28.4 % | 0.0 % | 28.4 % | 111 |
| 2026-08-01 ankle | 218 | 46.7 % | 2.3 % | 49.0 % | 378 |
| 2026-08-04 finger | 603 | 14.5 % | 45.2 % | 59.8 % | **1002** |
| 2026-08-05 ankle | 567 | 13.8 % | 41.1 % | 54.9 % | 830 |
| 2026-08-06 ankle | 585 | 9.3 % | 40.0 % | 49.3 % | 848 |
| 2026-08-07 finger | 478 | 26.5 % | 28.8 % | 55.3 % | 770 |
| 2026-07-30 finger | 831 | 1.5 % | **95.9 %** | 97.4 % | 49 |

**The shipped window discarded most of the data on 16 of 19 site-nights**, up to 97 %. And the
uncensored wander on the censored nights — 1002, 848, 834, 830, 770, 759, 717 ms — is **≈ one RR
interval**, which is the signature `PAT-SAWTOOTH-ANSWERS-THE-130MS` measured directly (offset ramping
through 821–1162 ms, then wrapping).

The traces settle it. Uncensored 5-min bin medians, same code, two nights:

```
2026-08-04 (60 % censored)
  239 155 104  61 | 946 913 889 887 877 879 897 | 376 397 412 … 607 | 324 … 687 | 561 … 1063 | 928 951 …
      ramp, WRAP, ramp, WRAP, ramp, WRAP — amplitude ≈ one RR

2026-08-02 (0.1 % censored)
  433 410 398 391 390 373 364 348 336 337 323 318 310 308 321 335 353 368 383 396 405 399
      one smooth U — down 433→308, back to 405, no wrap, 125 ms total
```

**So "the wander" was two phenomena analysed as one:**

1. **On censored nights — the sawtooth.** A drifting inter-device relative phase wrapping mod one RR,
   already documented in `PAT-SAWTOOTH-ANSWERS-THE-130MS`. The window sliced it, and the slice looked
   like slow movement. **This is not PAT and no PAT statistic computed on those nights means anything.**
2. **On uncensored nights — a smooth 72–129 ms excursion** with no wrap. This is the real object.

**Consequences, stated plainly:**

- **§3's eliminations were computed on the mixture and are therefore not valid as stated.** Testing a
  covariate against a signal that is part clock artifact and part physiology is why every one of them
  returned an inconsistent sign. They are not *wrong*, they are **uninformative**, and they must be
  re-run on uncensored nights before any of them counts as an elimination.
- **The common-mode figure survives only where it was measurable.** Recomputed on the uncensored
  pairing: **ρ = 0.86 on 2026-08-02 (0.1 % censored)**; the other nights give −0.58, 0.53, 0.85, 0.87,
  −0.14, −0.18, 0.99, −0.30, 0.96 at 4.9–59.8 % censoring, i.e. no information in either direction.
- **The usable corpus for PAT is 2–3 site-nights, not 8.** That is the single most important number in
  this brief.
- **The `PHYS` window was masking an offset problem**, not filtering an implausible one. On nights where
  the inter-device offset puts the true lag outside `[200,650]`, the window silently retained whatever
  fraction happened to fall inside — which is how a night with a 97 % censored, 831 ms median lag still
  produced a confident-looking PAT number.

## 2.1 · THE METHOD THAT SHOULD HAVE COME FIRST — partition the chain, don't enumerate causes

§2 and §3 list nineteen candidates chosen because each *sounded plausible*: posture, battery, ultradian
rhythm, respiration. That is sampling an unbounded space, and it is why nineteen tests produced nineteen
negatives while leaving a live term untested. Most of them were also **premature** — they ask what makes
a quantity vary before establishing which quantity it is.

The bounded version. `PAT = t_foot − t_R`, so every term that can move it, and whether it is SHARED
between the two PPG sites or per-device:

| | term | shared? |
|---|---|---|
| **Ⅰ signal** | 1 PEP · 2 central transit | **shared** |
| | 3 peripheral transit | per-site |
| **Ⅱ ECG chain** | 4 electrode/analog front end · 5 sampling clock · 6 transport + host stamping · 7 R fiducial | **shared** |
| **Ⅲ PPG chain** | 8 optics · 9 clock · 10 transport · 11 foot fiducial | per-device |
| **Ⅳ time base** | 12 host clock | **shared** |
| | 13 per-device axis correction | per-device |
| **Ⅴ analysis** | 14 pairing rule + `PHYS` window · 15 binning + qualification | **shared** |

The single common-mode measurement then collapses the space in one step: the term must be in the shared
column, `{1, 2, 4, 5, 6, 7, 12, 14, 15}`. Everything per-device is excluded for free, untested. Of the
rest, substitution kills 5·6·12 (clock) and 7 (fiducial), leaving **1, 2 (the signal), 4 (the ECG analog
front end), and 14, 15 (the analysis layer)**.

**Cell 14/15 had never been tested, and testing it found a real contribution (§1.1).** By Occam it should
have been tested *first*: a shared, data-dependent analysis step manufactures correlated movement with no
new physical mechanism at all, whereas physiology requires one. The enumeration approach never surfaced
it, because "my own window might be creating this" is not a hypothesis that sounds plausible — it is one
that a partition produces mechanically.

**The trap, stated generally: when a search returns many negatives, suspect the search space, not the
signal.** Enumerating plausible causes cannot terminate and cannot prove coverage. Partitioning the
measurement chain does both, and it tells you which cells a single observation has already eliminated.

## 2 · Eliminated — instrumentation (each by substitution, not by argument)

| candidate | method | result |
|---|---|---|
| **H10 clock** | recompute lag with RAW device crystal (`t0Ms + i/fs`) vs host-corrected `tMsAt` | **no material difference, 12/12 pairings** (206→240, 72→88, 414→401, 125→110, 222→200, 324→362 …) |
| **ECG R-peak fiducial** | median-beat template + cross-correlation, sharing no code with Pan–Tompkins | median difference **−0.2…+0.1 ms**; substituting it changes the wander by **≤1 ms, 6/6 nights** |
| **PPG foot fiducial** | three fiducials on one waveform — foot, systolic peak, max-2nd-derivative | bin-series ρ = **0.95–1.00 on 10/12** pairings; ranges comparable |
| **PPG beat doubling** | PPI/RR ratio and an alternation index | **PPI/RR = 1.00**, altIdx 0.02, every night — no doubling exists |
| **Foot selection in the window** | a running-median tracker choosing the nearest candidate instead of the first | changes **0 %** of beats — there is at most one foot per window |
| **BLE link quality** | RSSI and dropped frames per bin, per device | ρ inconsistent in sign; `frames_dropped` is empty in these files |
| **Host clock** | `CLOCK.csv` | disciplined to stratum 2, root dispersion 2.3–2.6 ms — too small, and a host slew largely cancels in a difference of two host stamps |
| **Battery / LED drive** | `OXYFRAME battery_pct` vs Δlag | all \|ρ\| ≤ 0.15 |

The fiducial exclusions matter most, because "the R wave is 10 ms wide so 100 ms would be the T wave"
is a *sound argument* — and this project has repeatedly watched sound arguments lose to measurements.
Both were measured. Both hold.

⚠️ **Side observation, not chased:** the template−PanTompkins difference has a bin-to-bin range of
0.9–1.9 ms on clean nights but **47–51 ms on 2026-08-01/03/06** — the template match degrades on exactly
the low-match-rate nights. It does not touch the wander (those bins fail qualification) but it is an
independent data-quality signal that may be worth a detector.

## 3 · Eliminated — physiology and environment

> ⛔ **READ §1.2 FIRST. Every row below was computed on a MIXTURE of the sawtooth and the real
> excursion, so each is uninformative rather than conclusive.** They are retained because the method
> and the instruments are reusable and because the negative on `time-of-night` (which needs many
> nights) is hard to redo, not because the corpus supported them. Re-running these on uncensored
> nights is item 0 of §6.

| candidate | instrument | result |
|---|---|---|
| **Body position** | chest ACC gravity vector | **5–7° span, 0 posture changes**, and **100 %** of the wander inside one stable stretch (07-28: 37 bins = 3 h) |
| **Heart rate** | bin-median RR | ρ −0.63…+0.32, sign flips; removing a lag~RR fit leaves the range unchanged (72 → 78) |
| **HRV / autonomic** | rMSSD per bin | ρ −0.25…+0.46, inconsistent |
| **Peripheral vasomotor tone** | PPG pulse amplitude, then `pi_pct`, then a home-made ankle AC/DC | **retracted — see §4** |
| **SpO₂ and desaturation** | 1 Hz `SPO2.csv`, desat/h at −3 % from the bin's 90th percentile | ρ −0.67…+0.39 and −0.23…+0.40, inconsistent |
| **Respiration rate** | chest ACC 0.1–0.6 Hz band | Δρ −0.25…+0.21 |
| **Respiration depth** | same band, SD | Δρ −0.27…+0.07 |
| **Ankle posture / leg elevation** | Verity ACC gravity vector | Δρ −0.80…+0.45, sign flips |
| **Sensor contact, ring motion** | `OXYFRAME contact`, `motion` | constant over these nights — no information |
| **Ultradian sleep cycles** | Lomb–Scargle 40–120 min, detrended | **not present** — §5 |
| **Time of night (circadian, thermoregulation, BP dipping)** | nights median-centred, bucketed by wall-clock half hour, every pair correlated | median ρ = **−0.43**, only **2/6** pairs positive. A clock-locked cause would drive this strongly positive. |

## 4 · RETRACTED: the perfusion-index lead

`OXYFRAME` carries `pi_pct`, the ring's own AC/DC perfusion measure — a far better vasomotor instrument
than the band-passed amplitude used earlier. On first differences it looked like the one survivor:
Δlag~ΔPI positive at **both** sites (ankle 6/6, finger 6/8), small (0.07–0.37), and in the
physiologically correct direction — vasodilation raises PI *and* lowers pulse-wave velocity, so PI up
⇒ transit slower ⇒ lag up. It was reported as a lead at p ≈ 0.07 by night-level sign test.

**It does not survive a null that preserves autocorrelation.** Pooled across nights, with the covariate
circularly shifted within each night (2000 surrogates — preserves both series' autocorrelation, destroys
only their alignment):

```
finger lag ~ ring PI       rho=0.039   n=305   p=0.43
ankle  lag ~ ring PI       rho=0.093   n=216   p=0.11
ankle  lag ~ ankle AC/DC   rho=0.075   n=224   p=0.23
finger lag ~ finger AC/DC  rho=-0.002  n=305   p=0.98
```

An independent perfusion measure computed at the ankle from the Verity's own waveform does not
reproduce it either (per-night 0.10, 0.10, 0.27, −0.38, 0.08, −0.04, −0.21, 0.38, 0.27). The "6/6"
was small-sample structure. **Vasomotor tone is not established as a driver of the wander.**

## 5 · Five method traps, each of which produced a false result here first

These are the reusable part of this brief.

1. **Correlating two smooth series inflates \|ρ\| with a random sign.** The effective degrees of freedom
   is a fraction of the bin count. Measured here: \|ρ\| up to **0.83** against covariates that
   differencing then drove to ~0. The tell is a large \|ρ\| whose **sign flips between nights**. Every
   raw-level correlation in §3 has this flaw; the surviving numbers are the differenced ones.
2. **A shuffle is not a null for an autocorrelated series.** Shuffling destroys ordering, so *any*
   smooth series beats it. The ultradian test read p ≤ 0.005 on six nights against a shuffle and
   **p = 0.227–0.850 against an AR(1) surrogate with the same lag-1 autocorrelation** — five of six
   vanish, the survivor (p = 0.037 of six tests) is what chance predicts. Use AR(1), or circular shift.
3. **A periodogram peak AT THE SCAN BOUNDARY is a trend, not a cycle.** Before detrending, peaks sat at
   140–180 min against a 180 min ceiling on five of six nights. Widening the scan moves the "period".
4. **A correlation against a covariate with no range is spurious however large.** Chest posture scored
   ρ = **+0.82** on 08-02 over an angle span of **5°**, i.e. noise. Always report the covariate's range
   beside its ρ.
5. **An ensemble average of noise produces a plausible peak.** The 50 Hz seismocardiography attempt
   returned a clean-looking AO complex and ρ = 0.46 — while the **shuffled-trigger control scored
   HIGHER than the real trigger** on 2026-08-01 (2.7 vs 2.0), and the AO estimate ranged 170–220 ms,
   impossible for a PEP that varies by tens of ms. Without the control it would have been reported.

## 6 · What is left, and what would settle it

By elimination — with the clock and **both** fiducials excluded by substitution rather than argument —
the common-mode term lies in the genuine interval between electrical activation and pulse arrival:
**pre-ejection period plus central arterial transit.** That is physiology, and it is by definition what
PAT is made of.

⚠️ **This is an inference, not a measurement.** PEP has not been measured here; the direct attempt
failed its own control (§5.5). Nothing in this brief should be cited as "the wander is PEP".

**The blocker is sample rate, and it is now removed.** The chest ACC ran at 50 Hz — one sample per
20 ms, below the SCG band. On 2026-08-10 the capture host was set to **`acc: 100`** for the H10
(`/opt/tepna/capture-host/config.yaml`, backup `config.yaml.bak-2026-08-10-1806`, daemon restarted
18:07:10). The device menu offers 25/50/100/200; 100 was chosen over 200 to limit BLE bandwidth
alongside the 130 Hz ECG. **Verify the rate from a written file before using it** — the config read
`acc: 25` while the captured files measured 50 Hz, so config and runtime already disagreed once.

Open, in order of expected value:

0. **Re-run §3's eliminations on uncensored nights only** (§1.2). The screening itself is done — the
   verdicts computed on top of it are not. Until then §3 is a record of instruments, not of exclusions.
0b. **Resolve the sawtooth, or the corpus stays at 2–3 site-nights.** Every heavily censored night is
   a night where the inter-device offset drifts through a whole RR; recovering those recordings is
   worth more than any further covariate hunting, because it is the difference between n=2 and n=15.
   Owned by `PAT-SAWTOOTH-ANSWERS-THE-130MS`, which leaves the cause unestablished.
1. **Ensemble SCG at 100 Hz** → PEP per 5-min bin, with the shifted-trigger control mandatory. This
   converts §6's inference into a measurement, or refutes it.
2. **Pulse-wave analysis features** (stiffness/reflection index from the pulse shape) — untested here,
   and the mechanism the commercial cuffless devices actually use.
3. **More nights, and a second subject.** Every number here is one subject and one device set.
4. **A detector for the template-match degradation in §2** — 47–51 ms on three nights, currently
   unexplained and independent of the wander.

## 7 · What this brief does NOT claim

- **Not** that the wander is artifact. Nineteen artifacts were tested and excluded; the evidence points
  the other way.
- **Not** that it is PEP. That is where elimination leaves it, and elimination is not measurement.
- **Not** that the site-specific component is vasomotor tone — §4 retracts exactly that.
- **Not** that any covariate is *absent*; only that none is detectable at this corpus size with a
  correct null. Absence of evidence at n = 6–8 nights is weak evidence of absence.

Related: [`PAT-DRIFT-STATISTIC-2026-08-10-BRIEF.md`](PAT-DRIFT-STATISTIC-2026-08-10-BRIEF.md) ·
[`PAT-COMPENDIUM-2026-08-10-BRIEF.md`](PAT-COMPENDIUM-2026-08-10-BRIEF.md)
