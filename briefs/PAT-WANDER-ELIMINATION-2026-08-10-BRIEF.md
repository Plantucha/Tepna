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
- **68–95 % COMMON-MODE across two PPG devices with independent clocks.** ρ(finger, ankle) over shared
  bins = 0.85 (07-27) · 0.86 (08-02) · 0.79 (08-03) · 0.95 (08-05) · 0.68 (07-28); 0.05 on 08-01, which
  has only 12 shared bins. The ankle−finger difference ranges 64–107 % of the smaller leg, consistent
  with ρ≈0.85 and confirming a real site-specific component alongside the shared one.

**The common-mode result is the load-bearing one.** Two independent devices moving together places the
term upstream of both.

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
