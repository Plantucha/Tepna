<!--
  EXTERNAL-METHODS-SURVEY-2026-08-20-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-08-20 · **Relates:** `KNOWN-CLOCK-ADVERSARIAL-CAPTURE-FOLLOWUPS-2026-08-14-BRIEF.md`, `PAT-NO-VALID-ANCHOR-2026-08-02-BRIEF.md`, `PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md`, `LITERATURE-USE-POLICY-2026-07-11-BRIEF.md`

# Four published methods that address problems this suite has measured itself stuck on

A literature sweep aimed **only** at open boxes, not at general reading. Each item below names the
brief it would unblock and what it would cost. Nothing here is adopted; this is the survey step the
literature policy asks for **before** a method changes code.

⚠️ **Read this as leads, not as findings.** I have read abstracts and one full record; I have not
reproduced any of these results on our corpus. Every number quoted is theirs, not ours. The policy's
hard line applies: a literature value reaches runtime only as a cited constant inlined at author time,
never a fetch.

---

## 1 · 🔴 The PAT fiducial point is probably our bug — and it is the cheapest thing here

**Unblocks:** `PAT-NO-VALID-ANCHOR` (PAT recovered on **6 of 38** nights, 0 of 13 box nights),
`PPG-FOOT-PLACEMENT`.

Ajtay et al. (2023, *Biomedical Signal Processing and Control*) measure beat-to-beat PAT at **eight
different reference points on the PPG waveform** and report where precision is best:

> PAT showed the minimum RP% [relative imprecision] at the **1/2-amplitude point** whereas RP% reached
> the **maximum at the base point**.

**We use the base point.** PPGDex detects "intersecting-tangent feet" and `buildPPI` works from feet —
i.e. the fiducial the paper identifies as the **worst** of the eight for PAT precision. That is a
plausible mechanical explanation for a PAT that recovers on 16 % of nights, and it is testable without
new capture: re-run the existing PAT estimator against a half-amplitude fiducial on the same nights and
compare recovery rate.

⚠️ **Do not read this as "the fix".** Three things must be checked first, and the third is the one that
would embarrass us:
1. Their cohort is **35 young healthy supine volunteers over 300 s** — not overnight, not free-living.
2. The foot is the correct fiducial for *pulse-wave-velocity* work precisely because it is least
   contaminated by wave reflection; the paper's claim is about **precision**, not correctness. Switching
   fiducials trades one property for another and the brief must say which it wants.
3. Their PPG is a lab device. Our Verity is an arm-worn optical sensor whose foot detection already
   passes a consensus gate — the half-amplitude point may be *less* stable on our hardware, not more.

**Do:** measure recovery rate at both fiducials on the existing 38 nights. It is one estimator change
and a paired comparison, no new data. **Done when:** the recovery rate at each fiducial is recorded with
its n, and the choice is made on that number rather than on this paper.

## 2 · 🔴 Our failed aperiodic alignment used the method the literature calls the weak one

**Unblocks:** `KNOWN-CLOCK-ADVERSARIAL-CAPTURE-FOLLOWUPS`' remaining open box.

`tools/aperiodic-offset.mjs` is correlation/argmax based, and we documented its failure precisely:
peak prominence 0.0017–0.018 against a 0.002 null, with the peak **riding the search boundary**
(3850 ms at ±4 s → 5750 at ±6 s → 9000 at ±9 s) — "what an argmax of noise does".

Schranz et al. (2024, *EURASIP Journal on Advances in Signal Processing*,
[10.1186/s13634-024-01143-1](https://doi.org/10.1186/s13634-024-01143-1)) attack exactly this:

> Current state-of-the-art methods such as **Pearson Cross-Correlation are sensitive to typical data
> quality issues, e.g. misdetected events**, and Dynamic Time Warping is computationally expensive.

Their **Nearest Advocate** is event-based, evaluated on three wearable datasets, reported as superior
"particularly for **short, noisy time-series with missing events**", and they demonstrate it against
**non-linear** clock drift — which is our `hostAxis` regime (§7 of the Clock Contract records the
O2Ring divergence as non-linear and dropout-driven).

Open-source implementation: `github.com/iot-salzburg/nearest-advocate`.

⚠️ **This does not rescue the 08-15 negative result and must not be presented as doing so.** That test
concluded *no shared transient exists* between chest and arm ACC — a statement about the **signal**, not
the estimator. A better estimator cannot recover a marker that is not there. What it plausibly improves
is the **deliberate**-marker case (the buzz fiducial), where events are real but sparse and
occasionally missed — the exact regime the paper claims.

⚠️ **Licence and provenance must be checked before any code is taken.** The suite is Apache-2.0 and
vendors nothing at runtime; the cheap path is to reimplement the algorithm from the paper with the
citation in a source comment, not to import a package.

**Do:** evaluate Nearest Advocate against the buzz-fiducial night, reported at **two or three search
widths** — the invariance test our own instrument already carries, and the one that distinguishes a
lock from an argmax.

## 3 · 🟡 Dual-accelerometer alignment is a solved, published problem at our exact scale

**Relates:** the same open box, and any future two-device ACC work.

Brønd et al. (2021, *Sensors*) describe a method requiring **no human interaction** for temporally
aligning triaxial acceleration from two independent monitors, validated on wrist/hip (n = 9) and
thigh/hip (n = 30), then applied to **n = 2513** free-living 7-day recordings. Their framing matches
ours almost word for word — real-time-clock inaccuracy producing "substantial temporal misalignment
with long duration recordings which is commonly not considered".

⚠️ **Their wear locations are hip/thigh/wrist — all trunk-or-limb pairs that share gross posture.** Ours
is chest vs upper arm, and our own measurement found posture-only correlation is what drives the
surface. This may be why they succeed where we did not, in which case the method transfers and our
*negative* result is the anomaly worth re-examining — or their pairs simply share more signal, in which
case it does not transfer at all. **That is the question to answer first**, before implementing anything.

## 4 · 🟢 The buzz fiducial has a published analogue — useful as corroboration, not as a method

Nasrullah et al. (2024, *IEEE RTAS*) — **HAEST** — synchronise heterogeneous IoT devices by
timestamping **ambient events** across accelerometer/microphone/optical sensors, reporting sub-millisecond
clock accuracy on a body-area network.

This is the same idea as the O2Ring buzz: a deliberate physical event heard by several devices. Its
value here is **corroborative** — it says the approach is sound and gives a target resolution — not
methodological, since our marker is generated rather than harvested. Worth one sentence in the buzz
brief's related work; not worth building against.

## 5 · What the sweep did NOT find, stated so nobody repeats it

- **No comparable open project.** Searched for an open-source local-first analyser combining
  oximetry + chest ECG + arm PPG + CPAP. Nothing surfaced. The closest neighbours are single-purpose:
  OSCAR-style CPAP viewers, and vendor SDK tooling. **The multi-signal fusion this suite does appears to
  be unusual**, which is a reason to publish and not a reason to doubt the design.
- **No PSG-labelled dataset that avoids the NSRR DUA.** `REM-STAGING-FOLLOWUPS` 2b stays blocked on a
  human signing for records; nothing in this sweep changes that.

## 6 · Done when

- [ ] §1 measured — PAT recovery rate at base vs half-amplitude fiducial on the same 38 nights, each
      with its n, and the fiducial chosen on that number.
- [ ] §2 measured — Nearest Advocate against the buzz-fiducial night at ≥2 search widths, compared to
      the existing correlation estimator on the same data.
- [ ] §3 answered — whether Brønd's chest/arm case is comparable to their trunk-pair validation, BEFORE
      any implementation.
- [x] §4 recorded — **DONE 2026-08-22.** HAEST (Nasrullah et al. 2024, *IEEE RTAS*) added as `O2RING-BUZZ-FIDUCIAL` §6 Related work, with the distinction the survey drew: it *harvests* ambient events, the buzz is *generated on demand*, so a commanded fiducial has a known emission time and §5's detection could be scored 5/5 rather than estimated. Corroborative, not adopted.
- [ ] Any adopted method carries author·year·journal·DOI in the doc and a source comment at the call
      site, per the literature policy; any constant it contributes is inlined at author time.

## 7 · References

- Ajtay, B. et al. (2023). *The oscillating pulse arrival time as a physiological explanation regarding
  the difference between ECG- and Photoplethysmogram-derived heart rate variability parameters.*
  Biomedical Signal Processing and Control.
- Schranz, C. et al. (2024). *Nearest advocate: a novel event-based time delay estimation algorithm for
  multi-sensor time-series data synchronization.* EURASIP Journal on Advances in Signal Processing.
  DOI [10.1186/s13634-024-01143-1](https://doi.org/10.1186/s13634-024-01143-1).
- Brønd, J. et al. (2021). *Temporal Alignment of Dual Monitor Accelerometry Recordings.* Sensors.
- Nasrullah, A. et al. (2024). *HAEST: Harvesting Ambient Events to Synchronize Time across
  Heterogeneous IoT Devices.* IEEE RTAS.
