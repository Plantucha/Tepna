<!--
  EXTERNAL-LANDSCAPE-2026-08-20-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** REFERENCE (living — the external landscape: sibling projects, corroborating measurements, and the literature for the ankle-PAT/nocturnal-BP/oximeter-validation gaps) · **Created:** 2026-08-20

# The external landscape — who else is here, what they measured, what we can use

> Two web sweeps 2026-08-20 (projects · literature). Everything below names its source; DOIs verified
> via PubMed. Read §4 first if deciding what to build next.

## 1 · Sibling projects, and where Tepna stands

| project | what it has | what we reuse |
|---|---|---|
| `nglessner/o2ring-s-protocol` (known) | our OxyII base reference | already byte-verified against |
| `farolone/wellue-o2ring-protocol` | 0xAA-family frames, `.vld` v3 record layout (SpO2/HR/validity/motion/vibration-alert bits, ~4 s) | cross-check our `.vld`/stored decoding; the vibration-ALERT flag bits |
| `ericm301/O2Ring-DataFetcher` | an independent SET_CONFIG implementation (vibration intensity 1–100, brightness, thresholds), `.vld`→CSV for OSCAR | **independent witness for #1544's writer** — diff payloads; second `.vld` decoder |
| OSCAR (`gitlab.com/pholy/OSCAR-code`) | CPAP+oximetry fusion; a Viatom `.vld` loader | a **third** `.vld` decoder to cross-validate |
| `polarofficial/polar-ble-sdk` issue #674 | measured H10↔Verity drift: 622 ms initial, **~1.8 s/day (~21 ppm)**, temperature-dependent; two H10s disagree 100–160 ms; researchers align via shared-ACC cross-correlation | independent corroboration of the hostAxis design AND of the buzz-fiducial approach (shared mechanical event) |
| Lab Streaming Layer (+XDF) | the reference sync architecture; sub-ms host-to-host (BLE bridges' delivery jitter still dominates — their gap is our `hostAxis`'s subject) | XDF as a possible interchange; their offset-exchange protocol design |
| `pulselabteam/PulseDB` | 5.24 M labeled 10-s ECG+PPG+arterial-BP segments, pre-marked characteristic points | **external ground truth for PAT beat-pairing**; benchmark spread 0.94–15.67 mmHg SDE |

**Novelty check (measured against the public record, not assumed):** the RTC readback (GET_INFO
[24:31]), the commanded 0x83 vibration fiducial, and the raw 0x05 dual-wavelength stream have **no
public counterpart found**; no open project publishes overnight BLE-stack sync residuals comparable to
our box-night figures. SET_CONFIG has exactly one public sibling (DataFetcher).

## 2 · Ankle-site PAT — the literature that recalibrates our number

- Nitzan M, Khanokh B, Slovik Y (2002), *Physiological Measurement*, DOI 10.1088/0967-3334/23/1/308 —
  ECG→toe PTT and the **toe–finger PTT difference** both track *systolic* BP (not diastolic). The
  closest analogue of our chest→ankle path — and the toe−finger differential is a **PEP-free** signal
  we can compute tonight as Verity(ankle) − O2Ring(finger).
- Yiming G et al. (2017), *PLoS ONE*, DOI 10.1371/journal.pone.0171737 — baPWV reference 14.3–25.2 m/s
  ⇒ pure large-artery transit over our ~1.3 m path ≈ **90–150 ms**. Our 429 ms median therefore
  carries large PEP + micro-vascular components — never read it as pure transit.
- Martin SL-O et al. (2016), *Scientific Reports*, DOI 10.1038/srep39273 — foot-PPG PTT (BCG-anchored)
  r=−0.80/7.6 mmHg vs ECG-PAT r=−0.60/14.6 — PEP is the stated contaminant.
- Finnegan E et al. (2021), *Scientific Reports*, DOI 10.1038/s41598-021-01358-4 — per-subject PAT→SBP
  slopes spread ~6× (≈ −0.3 to −2 ms/mmHg): **per-user calibration is mandatory**.
- **Gap (ours to fill):** nobody measures chest-ECG→ankle-PPG PAT overnight or gives an ankle
  ms/mmHg.

## 3 · Nocturnal BP from PAT — sobering, and it sets our claims ceiling

- Nyvad J et al. (2020), *J Clin Hypertension*, DOI 10.1111/jch.14135 — night LoA ±42.6 mmHg; dipping
  found by cuff in 33% vs 2–20% by PTT. **Dipping classification is the documented failure mode.**
- Heimark S et al. (2023), *Blood Pressure*, DOI 10.1080/08037051.2023.2274595 — chest ECG+PPG PAT
  (closest hardware analogue): night SBP overestimated ~19 mmHg.
- Derendinger FC et al. (2024), *J Hypertension*, DOI 10.1097/HJH.0000000000003667 — cuffless error
  grows near-linearly with excursion from the calibration point (reported 1.8 vs true 7.4 mmHg 24-h
  change): **calibration drift is excursion-dependent, not time-dependent.**
- Traiwannakij S et al. (2026), *Sleep & Breathing*, DOI 10.1007/s11325-026-03601-6 — nocturnal-HTN
  screening from PSG-PTT: sens 85% / spec 39%.
- **Claims ceiling for Tepna:** within-night TREND, heuristic tier, after per-user calibration — never
  absolute BP, never dipping-classification, until we can beat these published failure modes.

## 4 · O2Ring validation status + the publishable gap

- Tisyakorn J et al. (2024), *Sleep & Breathing*, DOI 10.1007/s11325-024-03232-9 — the **Wellue O2
  ring vs PSG, n=190: AUC 0.91** (moderate-severe OSA), sens 87.3% / spec 78.7%. Our exact vendor's
  device, ODI-level validation exists.
- Gell LK et al. (2025), *Frontiers in Sleep*, DOI 10.3389/frsle.2025.1549272 — ring ODI4 vs PSG
  r=0.87; Gu W et al. (2020), *JCSM*, DOI 10.5664/jcsm.8592 — Belun ring REI-AHI r=0.894.
- Schäfer et al. (2013), *Int J Cardiology*, DOI 10.1016/j.ijcard.2012.03.119 — PRV≈HRV at rest/sleep
  but a distinct biomarker.
- **The publishable claim, NARROWED after peer review falsified the broad form** (Brief-runner
  session, 2026-08-20 — the broad claim "no ring pleth has been assessed for beat timing" dies to one
  citation): ring-PPG beat timing IS covered in print — Haddad et al. 2021 (IEEE EMBC; Senbiosys ring
  vs Shimmer3 ECG, 72.2 h incl. 37.1 h sleep, best fusion 99.22 % detection, IBI MAE 7.42 ms) plus the
  Oura nocturnal HRV-vs-ECG literature (Cao 2021 JMIR; Kinnunen 2020 Physiol Meas). **What survives:
  the Wellue O2Ring SPECIFICALLY has no published beat-timing assessment** — its literature is
  ODI-level — and the likely reason is ACCESS: its raw pleth (our 0x05 stream) appears publicly
  unreachable, which reframes the paper from "a gap in validation" to "a capability nobody else has,
  and the first assessment". One check owed before that framing ships: confirm no published work
  exposes the O2Ring waveform by any route.
- **Two load-bearing methods papers for the fiducial number** (same source): Zaunseder et al. 2022 —
  in beat-to-beat interval estimation, SNR and PULSE-SHAPE stability dominate sampling rate (tripling
  14→50 Hz buys ~14 %; shape variation raises error **up to 800 %**). Consequence: argue the ±19 ms
  fiducial from SNR/shape stability, never from the ~100 Hz rate — and measure the pleth's shape
  stability across a night before publishing the number. Charlton et al. 2022 (Physiol Meas) — 15
  open-source PPG beat detectors benchmarked vs ECG across 8 datasets, framework freely available
  (`MSPTD` + `qppg` best): the cheap external answer if our detector is ever questioned.

## 4b · Receiver-side clock sync — the one paper in our problem class, and three that are NOT

(Contributed by the Brief-runner session's sweep, 2026-08-20; triage preserved verbatim in spirit.)

- **Lai et al. (2025), IEEE BIBE, *Synchronization of Wearable Sensor Data for Vital Sign Monitoring***
  — the only found paper in OUR constraint class: *"consumer wearables, where there is zero access to
  both firmware and hardware … all synchronization can only be done on the receiving end."* Two-part
  method (one-time calibration of the fixed processing offset, then sampling-rate fine-tuning for the
  wireless offset), reporting **1 ms with interpolation** under packet loss and drift. ⚠ Two checks
  gate any transfer, both from our own measurements: (1) rate-tuning presumes a stable nominal rate —
  `DEVICE-RATE-TRUTH` measured every advertised rate wrong by 0.01–2.9 %, and the O2Ring's divergence
  is **dropout-driven and non-linear** (flat for hours, then ~12.5 s/h from the first BLE stall), which
  a rate model would mis-read as rate error; (2) it presumes two independent clocks — our
  phone-captured tree has ONE (`spreadMs` 0.13–1.00 ms = the stamp quantum), so only box nights
  (spread 102–5124 ms) can even test it.
- **⚠ CATEGORY-ERROR GUARD — do not cite these beside our numbers:** Wang 2023 (384 µs), Li 2023
  (69–477 µs), Biagetti 2025 (47 µs RMS) all OWN the peripheral (application code on TI/Nordic parts
  or custom sensors). We own neither end of an H10 or a Verity; their microseconds and our ~0.1 s
  arrival spread measure different quantities in different problem classes. The 100–1000× gap is a
  difference of access, not of competence — recorded so it is never quoted as a deficit.
- HAEST (Nasrullah 2024, IEEE RTAS — already in the sync-fiducial bibliography) harvests AMBIENT
  events at sub-ms on a body-area network; corroborates the buzz approach (ours is the commanded form)
  and gives the resolution target.

## 5 · Actions this feeds (each already has a home)

1. Diff `O2Ring-DataFetcher`'s settings payloads vs `oxyii.set_config_frame` (independent witness).
2. Cross-validate our `.dat`/`.vld` decoding against OSCAR's + farolone's decoders.
3. The **toe/ankle−finger differential PTT** (Nitzan): a PEP-free within-night metric from hardware we
   already wear — candidate next metric, heuristic tier.
4. PulseDB as beat-pairing ground truth for `pat-*` tools.
5. The PRV-beat-timing validation paper (§4) → `PAPERS-ROADMAP` when the clean fiducial night exists.
