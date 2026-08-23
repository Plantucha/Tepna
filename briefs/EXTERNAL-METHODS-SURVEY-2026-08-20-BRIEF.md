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

### MEASURED 2026-08-23 — the answer is NO. The fiducial is not the mechanism.

`tools/pat-fiducial-compare.mjs`, 38 nights, **30 analysed** (8 skipped — see below), 20
circular-shift surrogates per arm. Same night selection, same ACC-anchor clock alignment, same
leave-one-block-out strict acceptance as `pat-matchrate-strict.mjs`; only the fiducial moves.

**THREE ARMS, because two cannot answer the question.** Acceptance keeps a beat only if its
R→fiducial lag lies in a 200–650 ms physiological window. The half-amplitude point sits **later** on
the pulse by construction — measured here at a median **89.5 ms** later (range 73.8–96.2 over 30
nights) — so a foot-tuned window pushes lags out and manufactures a fiducial *failure* that is
really a window artefact. `pat-sd-is-the-window` already records that this window dominates the
statistics here. So the half fiducial is scored twice: at the fixed window, and at a window
re-centred on that night's own median offset.

| arm | window | fiducial | median matchRate | nights beating their own null |
|---|---|---|---|---|
| `base` | default | foot | **0.0575** | **15 / 30** |
| `halfFixed` | default | half-amplitude | 0.0620 | 15 / 30 |
| `halfCentred` | re-centred | half-amplitude | **0.0579** | **15 / 30** |

**Read the paired per-night differences, not the medians** — an aggregate can hide a systematic
regression, and here it would have hidden the opposite:

| comparison | median Δ | IQR | max abs Δ | better / worse / tie |
|---|---|---|---|---|
| `halfCentred − base` — **the fiducial** | **−0.0000** | 0.0014 | 0.0054 | 13 / 15 / 2 |
| `halfFixed − base` — fiducial **and** window | +0.0022 | 0.0202 | 0.0644 | 17 / 12 / 1 |

Control the window and the effect is a coin flip with an IQR of 0.0014. **The same 15 nights beat
their null under both fiducials — the set difference is empty in both directions.** Leave the window
uncontrolled and you get a nominal +0.0022 with a **14× wider** spread and per-night swings to 0.064:
`halfFixed` calls 2026-07-17 a win (0.101 vs 0.036) and 2026-07-18 a loss (0.054 vs 0.090) on
consecutive nights, and swaps two nights in each direction on the beats-null verdict. **That entire
signal is the acceptance window moving, not the fiducial** — which is exactly the two-arm comparison
this section as written would have produced, and it would have been read as support for the paper.

**Ajtay's own estimand — imprecision, not recovery — also shows nothing.** Residual IQR: base median
**38.0 ms**, half-amplitude **38.1 ms**; paired median **−0.11 ms**, 16 nights better / 14 worse.

**And there is a mechanism, not just a null.** The (half − foot) offset is nearly constant — 89.5 ms
median across 30 nights, spread 22 ms — and the strict statistic's leave-one-block-out centre absorbs
a constant offset exactly. A fiducial change that is almost a pure translation therefore *cannot*
move this statistic, whatever the paper found on 300 s of supine data. Caveat 3 above turned out to
be the operative one in an unexpected way: it is not that the half-amplitude point is less stable on
our hardware, it is that on our hardware the two points differ by a constant this estimator is
designed to ignore.

**The real constraint is upstream of the fiducial.** Of 38 nights, 8 never reach the comparison:
**5 fail clock alignment** (one usable shared ACC movement), 2 have no parseable ECG + Verity-PPG
pair, 1 has zero overlap. Of the 30 that do, **half** beat chance under every fiducial. PAT recovery
on this corpus is gated by clock alignment and coupling quality — `PAT-NO-VALID-ANCHOR`'s own
subject — and this section's confident "probably our bug" was wrong. **Do not switch fiducials.**

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

### MEASURED 2026-08-23 — our pair shares very little, and it is NOT a coverage limit

`tools/acc-shared-movement.mjs`, 38 nights, **36 measured** (2 have no parseable H10 ACC). It runs
only the alignment leg, and reports the two halves `alignByAnchors` already separates:
**candidates** (movements found in the CHEST envelope at all) and **anchors** (those the ARM
corroborated well enough to yield a lag).

| | median | IQR | range |
|---|---|---|---|
| chest candidates | 247 | 110 – 523 | 3 – 3286 |
| arm-corroborated anchors | 10.5 | 5 – 24 | 0 – 57 |
| **corroboration rate** | **0.064** | 0.009 – 0.124 | 0 – 0.333 |

**~94 % of chest movements have no arm counterpart**, and only **3 of 36** nights corroborate above
0.20. The anchors that do survive are not marginal — median correlation **r = 0.664** (min 0.624), so
this is not a weak-corroboration regime but a binary one: a movement either appears at both sites or
it does not.

**It is not that the subject failed to move.** The five refusing nights carry a *higher* median
candidate count than the aligning ones — **302 vs 246** — and 3 of the 5 exceed the aligning median.
2026-07-29 turns 302 chest movements into **0** anchors; 2026-08-18 turns 1459 into **1**. Meanwhile
2026-07-23 aligns from 34 candidates. Candidate count carries almost no information about anchor
yield (Spearman **ρ = +0.109**) and is *negatively* related to the corroboration rate
(**ρ = −0.663**) — more chest movement makes the ratio worse, not better.

**What separates the failing nights is the candidate RATE**, and the split is 22×:

| chest candidate rate | n | median corroboration | refusals |
|---|---|---|---|
| ≤ 200 / h | 24 | **0.110** | 1 |
| > 200 / h | 12 | **0.005** | 4 |

Aligning nights fire at a median 62.7 candidates/h; refusing nights at **559/h**. A candidate every
four seconds is not gross body movement, so on those nights the chest detector is firing on something
local to the strap that the arm cannot see. *(That mechanism is an inference from the rate; what is
measured is rate ⇒ corroboration ⇒ refusal.)*

**Answer to §3: their pairs share more signal, and the method does not transfer.** Brønd's method
consumes exactly this input, and on a chest/arm pair there is little of it to consume — a
shared-movement floor is a property of the wear sites, not of an algorithm. This is the same verdict
§2 reached from the other direction: Nearest Advocate, a published method built for short noisy
series with missing events, did not rescue the alignment either. **Two independent method swaps have
now failed to move it. Stop swapping methods.**

⚠️ **Two limits, stated because they bound the claim.** (1) "Candidate" means *at the threshold
`findAnchors` uses* — a different detector would enumerate a different set, and the rate finding
above is precisely a statement about that threshold. (2) We have not measured Brønd's data; "their
pairs share more" is an inference from their reported wear locations (hip/thigh/wrist — all pairs
sharing gross posture) and not a measurement. What IS measured is our own floor, and it bounds any
method including theirs.

**The lever this exposes is not a published method — it is our own candidate threshold.** A rate of
559/h predicting failure says the detector admits non-postural chest activity on exactly the nights
that fail. That is a cheaper and more local thing to fix than importing an alignment algorithm, and
it belongs to `PAT-NO-VALID-ANCHOR` rather than to this survey. §3 is answered: **do not implement
Brønd.**

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

- [x] §1 measured — **DONE 2026-08-23, and the answer is NO. The fiducial is not the mechanism, and
      the fiducial is NOT being switched.**

      `tools/pat-fiducial-compare.mjs` over 38 nights, **30 analysed**, 20 surrogates per arm, three
      arms so the acceptance window can be separated from the fiducial. With the window controlled,
      `halfCentred − base` has a median paired Δ of **−0.0000** (IQR 0.0014, max abs 0.0054, 13
      better / 15 worse / 2 tie) and **the identical 15 of 30 nights beat their own circular-shift
      null under both fiducials, with an empty set difference in both directions.** Ajtay's own
      estimand agrees: residual IQR 38.0 ms vs 38.1 ms, paired median −0.11 ms.

      The two-arm comparison this section asked for would have reported **+0.0022** and a 14× wider
      spread — all of it the window moving, since the half-amplitude point lands a near-constant
      **89.5 ms** later (range 73.8–96.2 over 30 nights) and a foot-tuned 200–650 ms window shifts
      relative to it. Full tables in §1.

      Two things this bought that the survey did not anticipate. First a **mechanism**: a near-pure
      translation of ~89.5 ms is exactly what the strict statistic's leave-one-block-out centre
      absorbs, so this estimator *cannot* respond to this fiducial change whatever the paper found on
      300 s of supine data. Second the **real constraint**: 8 of 38 nights never reach the comparison
      and **5 of those fail clock alignment** on a single usable shared ACC movement, while half of
      the 30 that do reach it never beat chance under any fiducial. Recovery here is gated by
      alignment and coupling, not by where on the pulse the fiducial sits.

      🔴 It also surfaced a real defect in the tool the survey commissioned: `halfAmplitudeIndex`
      indexed `bp[footI]` directly while the shipped producer emits **fractional** foot positions, so
      it refused **15295 of 15295** beats on the first real night while its own `--selftest` stayed
      green on planted integer indices. Fixed and gated in the merge suite
      (`pat · fiducial · half-amplitude`, 3 assertions confirmed failing under the pre-fix indexing).
      Had that shipped unnoticed, §1 would have read as "the half-amplitude fiducial is unusable on
      our hardware" — a wrong conclusion in the paper's favour.
- [x] §3 answered — **DONE 2026-08-23, and the answer is NO: do not implement Brønd. Their pairs
      share more signal; ours has a shared-movement floor that bounds any method.**

      `tools/acc-shared-movement.mjs` over 38 nights, **36 measured**. Median **247** chest movement
      candidates per night against **10.5** arm-corroborated anchors — a corroboration rate of
      **0.064**, above 0.20 on only 3 of 36 nights, while the anchors that do survive are strong
      (median r **0.664**). ~94 % of chest movements have no arm counterpart.

      **Not a coverage limit.** The five refusing nights carry MORE chest movement than the aligning
      ones (median 302 vs 246); 2026-07-29 yields 0 anchors from 302 candidates while 2026-07-23
      aligns from 34. Candidate count barely predicts anchor yield (Spearman ρ = +0.109) and is
      negatively related to corroboration (ρ = −0.663). What separates failure is the candidate
      RATE: ≤ 200/h corroborates at 0.110 with 1 refusal in 24 nights; > 200/h at **0.005** with 4
      in 12. Full tables in §3.

      This is §2's verdict from the other direction — two independent method swaps have now failed
      to move this alignment. **Stop swapping methods.** The lever the measurement exposes is our own
      candidate threshold, not a published algorithm, and it belongs to `PAT-NO-VALID-ANCHOR`.

- [x] §2 measured — **DONE 2026-08-23, and the answer is NO. Nearest Advocate does not rescue the
      alignment; it replaces a VISIBLY broken estimator with a QUIETLY broken one.**

      `tools/aperiodic-method-compare.mjs` runs both on identical envelope-derived events from the
      paired night (H10 chest × Verity arm, 2026-08-13 23:18 → 04:03, **4.75 h** — the overlap this
      brief records, which is how a first run on the wrong file pair at 3.58 h was caught).

      **The harness is faithful, and that is established before anything else is claimed:**
      correlation reproduces the recorded failure **to the millisecond** — 3850 / 5750 / 9000 ms at
      ±4 / ±6 / ±9 s against the documented 3850 / 5750 / 9000 — from an independent implementation.

      **Nearest Advocate passes the width test perfectly and fails a second one:**

      | grid | NA shift | z | correlation |
      |---|---|---|---|
      | 50 ms | **−450 ms** | 7.13 | 5750 |
      | 100 ms | **0 ms** | 10.78 | 6000 |
      | 250 ms | **+250 ms** | 17.26 | 6000 |
      | 500 ms | **−1000 ms** | 9.48 | 6000 |

      Width-spread is **0 ms at every grid**. Grid-spread is **1250 ms with no convergence**, and every
      row reports `ok: true`. It is stable in the axis the recorded failure moved along and wanders in
      the one nobody had tested.

      🔴 **The methodological finding is bigger than the result.** The width-stability control was built
      from the *previous* failure, and a control built from the last failure is not a control against
      the next. Worse, the **shuffled-interval null passed NA every time at z 7–17**: shuffling
      intervals destroys interval STRUCTURE but preserves event COUNT and RATE, so an estimator that is
      really matching event *density* beats that null comfortably while recovering no alignment. A null
      is only as strong as the property it actually randomises.

      **Consequence for §3:** this is evidence *for* the "the pair, not the method" reading. Two
      unrelated estimators both fail on chest-vs-arm — one legibly, one not — which is what an absent
      signal looks like, not a weak algorithm. Brønd's trunk-pair validation likely does not transfer,
      and the negative result stands rather than being an artefact of the estimator choice.

      ⚠️ **The 250 ms row is a coincidence, recorded so it is not re-found and over-read.** It sits
      inside the buzz fiducial's independently measured H10↔Verity offset (+193.5 ± 64 ms, §5 of
      `O2RING-BUZZ-FIDUCIAL`) and looked like corroboration for exactly as long as it took to run a
      second grid.
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
