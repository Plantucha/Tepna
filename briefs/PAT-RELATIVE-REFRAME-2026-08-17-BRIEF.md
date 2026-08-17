<!--
  PAT-RELATIVE-REFRAME-2026-08-17-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-17 · **Follows:** `PAT-COMPENDIUM-2026-08-10-BRIEF.md` (the standing record), `PAT-OFFSET-ESTIMATOR-FOLLOWUPS-2026-08-12-BRIEF.md` (the open §3) · **Affects:** `pat-align.js`, `pat-gate.js`, `ppgdex-dsp.js`, `integrator-dsp.js`'s PAT surface, the CPAP validation corpus

# PAT feasibility, end to end — the suite has been building the hard estimand while the validated one sits unbuilt

**Owner ask (2026-08-17):** check the whole signal path for PAT feasibility, capture host through
Integrator, and find improvements — preferably literature-backed.

**The one-paragraph answer.** The path is in the best state it has ever been — the three rate errors
are fixed, the arrival sidecar certifies two of three devices, and within-5-min-bin σ reaches
10–23 ms on locking nights. But every gate, window and open item is aimed at **absolute** PAT — a
number in ms whose own literature says it cannot deliver what it promises even with an intra-arterial
reference. Meanwhile the estimand that sleep medicine actually validated — **relative PAT dips as an
arousal / respiratory-effort marker** — is immune to all three of this corpus's remaining blockers
*by construction*, sits inside the suite's measured noise budget, and has a 189-night CPAP corpus
plus the `event-coupling.js` null machinery already waiting to validate it. The recommendation is a
reframe, not a rescue.

---

## 1 · The path as it stands (verified against code and the sidecar's first real night)

| stage | state | evidence |
|---|---|---|
| capture host → arrival sidecar | **working**; H10 ecg/acc certified (4.1–4.6 ms agree, −20.4/−20.5 ppm, 0.09 ppm mutual); Verity certified after the pairing fix | `PAT-OFFSET-ESTIMATOR-FOLLOWUPS` §1a |
| O2Ring leg | **not certified** — 22.3 s agree, counter at **3851 ppm**; "the finger leg has no PAT-grade clock" | ibid. |
| per-connection BLE offset | ~2.2 s **between** connections, σ 29–36 ms within; constancy *within* a connection untested | `PAT-PACKET-ARRIVAL` §5, FOLLOWUPS §2 |
| node axes | ppgdex ships counter+`hostAxis` (best of five candidates, Rayleigh 0.90 on the best night); ECGDex `fs` fixed in #1121 | `PAT-COMPENDIUM` §4.3 |
| fiducials | sub-sample feet at 1.3–2.0 ms jitter — **not the limit** (~0.5 % of variance) | ibid. §5.1 |
| pairing/gate | `PHYS = [200,650]` never re-derived (a censoring cut, `450/√12` trap); `pat-gate` bars 60 ms | ibid. §9.3, `pat-gate.js` |
| Integrator | publishes the in-window yield, **applies nothing**; beat-resolution consumers correctly gated off | `integrator-dsp.js:5311` |
| best-case precision | within-5-min-bin σ **10–23 ms** on 3 of 6 box nights; 3 nights do not phase-lock, unexplained | `PAT-COMPENDIUM` §1 |
| the open blocker | 7 of 10 nights **anatomically impossible** (ankle before finger); whether the per-connection offset repairs the sign is unanswered | `PAT-OFFSET-ESTIMATOR-FOLLOWUPS` §3 |

## 2 · What the literature says about the two estimands (all retrieved via PubMed, 2026-08-17)

### 2.1 · Absolute PAT as a BP/vascular number: weak even under laboratory conditions

The canonical measurement is Payne et al. — beat-to-beat rPTT (ECG R-wave → finger PPG) against an
**intra-arterial** radial line, under four vasoactive drugs:

> PEP accounted for **12–35 %** of rPTT and varied; rPTT↔SBP R² = **0.39** with 95 % limits of
> agreement **±17 mmHg**; DBP and MAP correlated at R² = **0.02 / 0.08** uncorrected, improving to
> 0.41 / 0.45 only after PEP subtraction. *"rPTT should not be used as a marker of purely vascular
> function."*
> — Payne RA, Symeonides CN, Webb DJ, Maxwell SRJ, *J Appl Physiol* 100(1):136–41, 2006,
> [10.1152/japplphysiol.00657.2005](https://doi.org/10.1152/japplphysiol.00657.2005)

The definitive engineering review reaches the same posture — PTT-based BP is *promising with
per-subject calibration and PEP handling*, not a free measurement (Mukkamala R, Hahn JO, Inan OT et
al., *IEEE Trans Biomed Eng* 62(8):1879–901, 2015,
[10.1109/TBME.2015.2441951](https://doi.org/10.1109/TBME.2015.2441951)); and the exchange in
*Physiol Meas* concedes the physiological confounds outright while arguing only that ML + more
features might compensate (Lin WH, Samuel OW, Li G, 39(9):098002, 2018,
[10.1088/1361-6579/aadf17](https://doi.org/10.1088/1361-6579/aadf17)).

**Read against §1:** the suite's absolute-PAT programme is chasing a number that, *with a perfect
clock and an arterial line*, explains 39 % of SBP variance at ±17 mmHg. On this hardware it
additionally requires solving the per-connection offset, the anatomical sign, and a finger clock
that certifies at 3851 ppm. The effort/return ratio is poor and the literature says it stays poor
after the engineering is done.

### 2.2 · Relative PAT dips in sleep: validated, sensitive, and exactly this suite's domain

- **Arousal dips are ~15 ms and PTT out-senses the EEG.** Provoked arousals in normal sleepers
  produce PTT falls of **15.1 ± 1.4 ms**, and **9.9 ± 2.6 ms even with no visible EEG change**;
  PTT was more sensitive than heart rate. (Pitson D, Chhina N, Knijn S, van Herwaaden M,
  Stradling J, *Clin Sci* 87(2):269–73, 1994,
  [10.1042/cs0870269](https://doi.org/10.1042/cs0870269).)
- **PTT arousals catch respiratory events EEG misses.** In children with sleep-disordered breathing,
  apnea/hypopnea/RERA events terminated in a PTT arousal **91 % / 83 % / 80 %** of the time, against
  **55 % / 51 % / 43 %** for EEG arousal — and the PTT arousal index separated UARS (6.8/h) from
  primary snoring (2.2/h). (Katz ES, Lutz J, Black C, Marcus CL, *Pediatr Res* 53(4):580–8, 2003,
  [10.1203/01.PDR.0000057206.14698.47](https://doi.org/10.1203/01.PDR.0000057206.14698.47).)
- **The index tracks OSA severity and CPAP response.** PTT arousal index correlates with RDI
  (r = 0.43) and its fall under CPAP tracks the RDI fall (r = 0.54), n = 144 split nights.
  (Schwartz DJ, *Sleep Med* 6(3):199–203, 2005,
  [10.1016/j.sleep.2004.12.009](https://doi.org/10.1016/j.sleep.2004.12.009).)

### 2.3 · Why the relative estimand dissolves this corpus's blockers rather than solving them

| blocker (absolute PAT) | under a within-connection **dip** estimand |
|---|---|
| per-connection BLE offset, 2.2 s | a constant **subtracts out** of any within-connection difference |
| anatomical sign impossible on 7/10 nights | sign of the *level* is irrelevant; only the excursion is read |
| PEP unknown per beat (12–35 % of PAT) | arousal raises sympathetic tone, which shortens **both** PEP and vascular transit — the confound becomes an **amplifier** of the dip. (Direction matters: PEP and PTT move *oppositely* under hypovolemia vs pain — Djupedal H et al., *Physiol Rep* 10(12):e15355, 2022, [10.14814/phy2.15355](https://doi.org/10.14814/phy2.15355) — so this argument is specific to arousal, and the estimand must be labelled autonomic, not vascular.) |
| `PHYS=[200,650]` censoring | a dip detector needs **no absolute window at all** — pair nearest-fiducial, detrend, threshold the excursion |
| offset knowable only mod one RR | irrelevant — the dip never leaves the connection it started in |

**Noise budget, from this corpus's own numbers:** within-bin σ is 10–23 ms per beat on locking
nights; a Pitson-scale dip is ~15 ms sustained over ~8–20 beats at sleep HR, so the event statistic
(median over the dip window) sees σ/√8 ≈ **3.5–8 ms against a 15 ms excursion — a 2–4 σ event**.
The −20 ppm certified drifts contribute ~0.6 ms over a 30 s window: negligible. This is feasible *on
the nights that phase-lock*, and the three that do not (§9.2 of the compendium) remain a
precondition to check per night, not a refutation.

## 3 · The proposal

1. **Ship ΔPAT, not PAT.** New estimand: per-beat lag from nearest-fiducial pairing (no window),
   detrended by a rolling median (~60 s), **segmented by BLE connection** (the sidecar records the
   boundaries); an *event* is a fall ≥ Θ ms sustained ≥ N beats. Publish a **PTT-arousal index**
   (events/h) per night, `experimental` tier, labelled **autonomic** — never as BP and never as
   "vascular" (Payne's closing sentence is the citation for that restraint).
2. **Validate against the CPAP corpus, which is already on disk.** 189+ nights of device-scored
   events (extendable to 2026-08-16 from vigil) overlap the O2Ring nights; `event-coupling.js`'s
   circular-shift null is the right instrument, and the κ/pb-agreement machinery (with its
   degenerate-margin refusal) transfers as-is. Success is Katz/Schwartz-shaped: event-level lift
   above the shifted null, night-level index correlating with the device's AHI.
3. **Requirements that shrink:** the only clock property the dip path needs is **within-connection
   stability** — exactly `PAT-OFFSET-ESTIMATOR-FOLLOWUPS` §2's untested question, which becomes the
   *first* gate rather than one of many. The absolute-offset programme (§3 there) stays open for the
   vascular ambition but stops blocking shipment.
4. **Fiducial fixes that serve both estimands** (known defects, `PAT-COMPENDIUM` §8): stop picking
   the PPG reference channel by **peak count** (rewards over-detection — pick by phase-lock against
   the beat cycle); stop degrading feet through `consensusBeats` (per-LED feet at 118–121 ms beat
   consensus at 133 ms — take the median of per-LED lags instead). Use the ambient channel's
   spread as the don/settle gate (§5.3) so dips are only scored on worn, settled segments.
5. **PEP leg, second phase:** the H10 chest ACC seismocardiogram already yields AO at 92–124 ms
   (compendium §7); sternal-accelerometer PEP tracking in a wearable is established practice
   (Zhang G, Cottrell AC, Henry IC, McCombie DB, *Annu Int Conf IEEE EMBC* 2016:3386–9,
   [10.1109/EMBC.2016.7591454](https://doi.org/10.1109/EMBC.2016.7591454)). That gives pPTT
   (PAT − PEP) for the vascular ambition later *and* makes the N-corner hat identifiable
   (compendium §9.4) — but it is deliberately **not** on the critical path of the dip index.

## 4 · What this does NOT claim

- Not a BP monitor, not a vascular-stiffness metric, and the index must never be badged above
  `experimental` without a reference-grade validation this hardware cannot currently perform.
- The 2.2 s per-connection offset and the anatomical sign remain **unexplained** — the reframe
  removes them from the critical path; it does not answer them. `PAT-OFFSET-ESTIMATOR-FOLLOWUPS` §3
  keeps its priority for anyone pursuing the absolute estimand.
- Pitson/Katz/Schwartz used finger PPG with lab oximeters; the O2Ring's 3851 ppm counter rides the
  host axis here. The within-connection stability test (§3.3) is what decides whether that transfer
  holds, and it has not run yet.

## 5 · Done when

- [ ] Within-connection offset stability is measured on ≥ 5 sidecar nights (first/second half fit
      comparison per connection) — the dip path's one clock gate.
- [x] **BUILT same day** — `PATAlign.patDipEvents` (+ `tools/pat-dip-index.mjs`), gated by TEN twins
      in `pat-align · dip-detector`: planted Pitson-scale dips found 20/20; white-noise and ±40 ms
      red-wander nulls quiet; the 1-RR slip twin caught a real fabrication mode (a slipped foot pairs
      the next R at ≈RR−1000 ms, a perfect fake dip) now closed by foot-gap shadowing; a sign twin
      (rises ignored); a segment twin (a dip straddling a connection boundary dies at the cut);
      refusal twins for too-few-pairs, unreadable noise floors, and QUANTIZED fiducials. Hysteresis
      (enter −Θ, extend −Θ/2, event = ≥N core beats) fixed a real fragility where one −0.9 Θ noise
      draw split a genuine dip.

### 📊 FIRST FIVE REAL NIGHTS (2026-08-13 → 17, pulled from vigil same day) — measured, and the answer is refusals with names

| night | ring (finger) leg | ankle (Verity) leg |
|---|---|---|
| 08-13 | ⊘ noise floor **122.5 ms** > 2Θ | — |
| 08-14 | ⊘ noise floor 86.5 ms > 2Θ | — |
| 08-15 | ⊘ noise floor 80.8 ms > 2Θ | ⊘ quantized (floor 0.0 ms — integer-sample feet) |
| 08-16 | ⊘ noise floor 79.7 ms > 2Θ | ⊘ quantized + 100 % artifact share |
| 08-17 | ⊘ no ECG+ring pair | — |

**Both legs refuse, for opposite degeneracies, and both reasons are already in the compendium.** The
finger floor of 80–122 ms matches §5.2's measured 91.8 ms foot-to-foot sd of the `_PPG.txt` DISPLAY
waveform — the good optics (18.9 ms) are in the unread `_PPG2W.txt`. The ankle leg's 0.0 ms floor is
the §8 integer-grid trap: `pat-matchrate-strict`'s `ppgFootTimes` emits integer-sample feet at 55 Hz
(18 ms quantum), where a Θ=10 dip is sub-quantum. **So the dip path's blocker is not clocks and not
the estimand — it is fiducial quality, and the two fixes are already named:** route the ankle leg
through the SUB-SAMPLE `refineFeet` (shipped in ppgdex-dsp, unused by the tool chain here), and give
the finger leg `_PPG2W`'s optics (compendium §9.5, needs its timing story). Before the first run it
was plausible the detector would index noise as arousals; it refuses instead, which is the twins
doing their job on night one.

**The fold itself (same five nights, all three Dexes + Integrator):** 4/5 nights are full trios
(7.5–8.1 h three-way overlap; 08-17 has no O2Ring anchor). The new PB detector emits on **0/4**
nights (36 % base rate corpus-wide), the three-observer fusion corroborates 0/4, and κ vs the CPAP
**correctly REFUSES** — "the device scored PB on NO night (n=4) — one rater never varied" — the
degenerate-margin guard's first firing on live data.
- [ ] The PTT-arousal index is computed on every locking box night and coupled to the CPAP's
      device-scored events through the circular-shift null; the lift and the night-level correlation
      are stated, whatever they are.
- [ ] The two fiducial defects of §3.4 are fixed and shown export-inert or regenerated per §🔏.
- [ ] `patArousalIdx` gets a registry row (`experimental`, autonomic wording) before any surface
      shows it.
