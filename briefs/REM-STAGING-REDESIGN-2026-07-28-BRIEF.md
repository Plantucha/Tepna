<!--
  REM-STAGING-REDESIGN-2026-07-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-02 · **Created:** 2026-07-28 · **Follows:** `QC-SCOPE-RESOLUTION-2026-07-28-BRIEF.md` · **Outcome:** a MEASURED NEGATIVE — the redesign was built and stopped by measurement, not shipped; REM remains blocked on ground-truth labels, not on effort (§8, §9)

# REM is under-called 4× — and the rule's shape, not its thresholds, is why

> **⛔ STANDING CONSTRAINT (added 2026-08-03 by `REM-STAGING-FOLLOWUPS-2026-08-02-BRIEF.md` §1 — read
> before proposing a staging change).** **No REM or Deep detector may be validated on `genSynthetic`
> (`ecgdex-dsp.js`).** The oracle is circular: it plants REM carrying the exact signature the rule
> looks for. The shipped conjunction scores **92.6 % recall / 92.6 % precision** against planted truth
> while under-calling REM **~4×** on real nights, and `respCv` reached **AUC 0.990** on the same oracle
> while failing every real-night falsifier. `genSynthetic` is a REGRESSION harness — it proves a
> detector still does what it did — and it is not evidence about staging accuracy. Two separate
> features have now passed it and failed reality; a third will be proposed eventually.
>
> The label that would settle it is now half-built: `nsrr-adapter.js` emits a per-epoch **expert**
> stage series as of FOLLOWUPS §2a (2026-08-03), so the next detector change has a real denominator
> available and does not need this oracle. What is still missing is the records themselves (§2b).

> **Origin.** Folding the 2026-07-27 capture-box night through the Dexes returned **REM = 0 min across
> 5.5 h of sleep**, alongside 99.8 % sleep efficiency and zero WASO. Three defects were found and fixed
> (`9f1edbc`); they removed the structural zero and left the under-detection standing. This brief is the
> part the fixes could not reach.
>
> **§4 was rewritten 2026-07-28** after running the synthetic oracle: it corrects an overstatement in
> this brief's first revision (and in #487) and reports that **every planted REM epoch is classified
> Wake, 9 of 9** — and that the oracle itself models REM wrongly, so it cannot yet serve as ground
> truth.

---

## 1 · What the fixes settled

| | before | after |
|---|---|---|
| motionIndex coverage (11-night corpus) | 296 / 1020 epochs | **648 / 1020** |
| nights reporting REM = 0 | 2 / 11 | **0 / 11** |
| median REM % of sleep | 4.5 % | **4.8 %** |
| physiological adult range | 15–25 % | 15–25 % |

Measured against `origin/main` in a worktree, not asserted. The first two rows are real wins. The third
is the finding: **REM is under-called roughly four-fold, uniformly, across every night in the corpus.**

## 2 · Why it is the rule's SHAPE

`ecgdex-dsp.js` scores REM as a conjunction — LF/HF high **AND** RMSSD low. On 2026-07-27:

- 26 of 77 epochs passed the LF/HF gate
- 10 of 77 passed the RMSSD gate
- **2** passed both — against **~3.4** expected if the two were statistically independent

The two features are not co-varying the way the rule assumes; the conjunction is selecting roughly
P(A)×P(B) of epochs, which is chance. A conjunction of independent gates cannot do better than the
product of its marginals, so no threshold tuning rescues it — **tightening either gate makes it worse and
loosening either admits noise.** That is a structural ceiling, and it is why the night-relative gate
(fix 2) moved the median by 0.3 points.

The corpus-wide uniformity is the corroborating evidence: a threshold problem would be subject-dependent
and show a spread. A shape problem shows up on every night, and it does.

## 3 · Proposed redesign — a score, not a conjunction

Replace the decision tree's REM branch with a **weighted REM score per epoch**, then take a band rather
than an intersection:

- **z(LF/HF)** — sympathetic dominance, night-normalised (already available)
- **−z(RMSSD)** — vagal withdrawal, night-normalised (already available)
- **−motion** — REM is near-atonic; the chest-ACC index now reaches the stager (already available)
- **+respiratory-rate variability** — *the missing discriminator.* REM breathing is irregular, NREM is
  metronomic. ECGDex already derives respiration two independent ways (RSA via the HF peak, EDR via
  R-peak amplitude modulation — 15.3 and 16.0 /min on the origin night) and per-epoch `resp` now reaches
  the bus. Its **variability** has never been computed, and it is the one feature that gives REM a
  *positive* signature instead of an LF/HF proxy.

Take the top band of the score as REM candidates, then enforce **bout structure**: REM bouts run 5–25 min
and recur on a ~90-minute cycle that lengthens toward morning. A stage series with no cycle structure is
not describing sleep, which makes this both a constraint and a falsifier.

**Sequenced after that, not bundled with it:** a finer staging grid. 5-minute epochs are ten times PSG's
30 s, and at that resolution a whole REM bout can be one epoch. Staging on a 1-minute grid (RMSSD is
stable at 60 s; carry LF/HF from the enclosing 5-min window, since LF needs ≥2 min) with a proper
minimum-bout rule replaces the minority-stage exemption that fix 3 installed as a stopgap.

## 4 · The oracle is broken — fix THAT first

**Correction to this brief's first revision, and to #487's PR body and commit message.** They said "no
committed fixture exercises `stageSleep` at all". That is too strong and it is wrong. The
`§10/§11 one spectral time scale` group in `tests/dex-tests.js` drives
`E.genSynthetic({ durSec: 100 * 60 })` through `analyze()`, which is past the 90-min `longRec` threshold,
so **`stageSleep` executes on every CI run**. What is true — and is the substance of the point — is that
nothing *asserts* anything about its output: the group checks `specWindow` and the band-split identity
and never looks at `stages`, `stageMinutes` or `totalSleepMin`. The code runs; no assertion can fail.
That is this suite's own "a gate can be blind rather than green" (`DEEP-AUDIT-III §2.3`), and it is why
three defects passed every gate. The remedy is assertions, not bytes — which makes it cheaper than the
first revision claimed, and the committed 6-min clip / 60-s golden are irrelevant to it.

**But the assertions cannot be written yet, because the planted truth is itself wrong about REM.**
Measured on `genSynthetic({ durSec: 6*3600 })`, 72 epochs, planted REM at cycle phase 0.82–1.00:

| planted | classified | n |
|---|---|---|
| REM | **Wake** | **9 / 9** |
| N3 | Deep | 19 |
| N2 | Light | 26 |
| N1 | Light / Wake | 5 / 6 |

**Every planted REM epoch is called Wake**, and the mechanism is exact: their `hrZ` runs 1.31–2.22, all
above the Wake gate's `hrZ > 1.1`, and **Wake is evaluated first**, so it swallows REM before the REM
branch is reached. That is an ordering defect independent of any threshold.

Two further measurements say the generator, not just the classifier, is at fault:

Per-stage medians over the same 6 h run. **This table supersedes a narrower and partly wrong reading in
the previous revision**, which described the LF/HF problem as REM-specific — it is not:

| planted | n | LF/HF | RMSSD | HR | LF | HF | motion |
|---|---|---|---|---|---|---|---|
| Wake | 1 | 0.206 | 15.1 | 69.1 | 21 | 101 | 100 |
| N1 | 11 | 0.079 | 22.0 | 59.8 | 18 | 235 | 56.8 |
| N2 | 31 | 0.055 | 28.7 | 55.3 | 20 | 385 | 0 |
| N3 | 20 | 0.108 | 40.3 | 52.3 | 57 | 632 | 0 |
| **REM** | 9 | **0.119** | 17.5 | 63.6 | 17 | 144 | **96.1** |

- **LF/HF is uninformative across the WHOLE generator, not just in REM.** Every stage lands between
  0.055 and 0.206 — roughly 20× below the physiological ~0.5–4 — because HF dominates LF everywhere
  (N3: HF 632 vs LF 57). REM's 0.119 is in fact *above* N1 and N2, so the parameterisation's intent is
  directionally right (`rsa ∝ vagal`, `lfMs ∝ 1.1 − 0.5·vagal`); the realised spectrum simply never gets
  LF anywhere near HF. The consequence for the classifier is absolute: the REM gate needs LF/HF above a
  floor of 1.0 and the synthetic's night maximum is ~0.2, so **on synthetic data the REM gate cannot fire
  at all, whatever the branch ordering**. Real data is unaffected — 2026-07-27's epoch median was 1.62
  with a maximum of 6.68, squarely physiological.
- **Planted REM has a motion index of 96 / 100**, against N2/N3 at 0. `ecgdex-dsp.js:446` sets
  `act = Wake ? 1.0 : REM ? 0.5 : N1 ? 0.32 : 0.07`, making REM the **second-most-active** stage.
  REM is characterised by skeletal muscle **atonia**; gross body movement is suppressed, not elevated.
  This one *is* REM-specific, and it is the more damaging of the two, because motion is the feature §3
  identifies as the necessary REM/Wake discriminator.

So the generator models REM as *looking like Wake in every feature the classifier can see* — which may be
where the REM/Wake confusion came from in the first place, if the rules were ever tuned against it.
**Building a classifier against this oracle would train toward a false target.** The first deliverable is
therefore to correct the generator — REM motion down to atonia with phasic twitches (REM-specific), and
the **LF/HF scale globally**, since no stage currently reaches a physiological ratio — and only then
write the assertions.

⚠️ **The LF/HF correction moves the RR series for every stage**, so it will move the seed-20260601 /
seed-42 known-answer pins in the `PRSA + SampEn tolerance` group. Re-pinning them is legitimate *because
the fixture is being deliberately corrected* — but it must be done knowingly and said out loud, never
quietly adjusted to whatever the new run prints. The REM-motion correction alone does **not** move them:
REM first occurs at t ≈ 4674 s and those pins are 900 s runs. **Do the motion fix first** — it is the more
important half and it lands at zero blast radius.

> **EXECUTED 2026-07-28.** Both halves landed; the pins moved exactly as warned and were re-pinned with
> their reasons in the test source:
>
> | pin | was | now |
> |---|---|---|
> | PRSA DC | 7.35 | **9.62** |
> | PRSA AC | −7.16 | **−10.26** |
> | SampEn | 0.562 | **1.03** |
> | ACC/HRV consensus | ≥ 70 | **≥ 75** (via 65; see below) |
>
> Discrimination verified by mutation, not assumed: a `/4 → /2` PRSA slip still fails 2 of them, and
> reverting the Mayer wave to 0.014 Hz fails all 3 — so the re-pinned values now *also* guard the fix.
> `DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS §EP-rest` records the original values and is updated to match.
>
> The consensus pin has an arc worth keeping: **77 → 67 → 80**. It fell when the corrected LF band
> exposed the stager's REM→Wake defect, and rose past its own baseline once §4c fixed the ordering —
> they now agree for the right reason instead of by sharing an error. It was lowered to 65 *with the
> prediction written down* that it would recover, then tightened to 75 when it did.

**The conclusion that survives all of this:** REM and Wake are near-identical in HR and RMSSD, so
**HRV alone cannot separate them**. Motion is not an enhancement to the stager, it is the *necessary*
discriminator, and a recording with no accelerometer should abstain or mark REM low-confidence rather
than guess. That is the strongest single design constraint this investigation produced.

## 5 · How to validate without PSG

There is no ground truth in this corpus, so acceptance has to rest on falsifiers rather than accuracy:

- **Planted truth** — the synthetic twin of §4 has a known REM fraction; recovery of it is a direct test.
- **Population plausibility** — REM is 15–25 % of adult total sleep. 4.8 % is falsified; so is 40 %.
- **Cycle structure** — autocorrelation of the stage series should show ~90-minute periodicity with REM
  lengthening toward morning.
- **Cross-signal consistency** — Wake should coincide with motion; REM should carry more and longer
  desaturations, and OxyDex publishes those events per night.
- **Cross-night stability** over the 11-night corpus.

**Evidence tier stays honest.** `remMin` is `heuristic`, cited *"HR-pattern heuristic, not EEG"*, and none
of §3 earns better than `experimental`. Only a cardiopulmonary-coupling formulation (Thomas 2005),
benchmarked against published PSG cohorts with a real citation, could justify `emerging` — and per the
literature policy the citation has to be checkable, not gestured at.

## 6 · Done when

- [x] §4a `genSynthetic` REM motion → atonia + phasic twitches (motion index 96 → 26 over 6 h) · **and**
      the Mayer wave corrected from a per-beat AR(1) at ~0.014 Hz (VLF) to a real 0.1 Hz oscillation, which
      is what made LF/HF physiological AND discriminative (N3 0.63 · REM 2.43). Redistribution, not
      inflation: whole-record SDNN 100.7 → 100.6
- [x] §4b the generator publishes `stageTruth`; assertions read it rather than re-deriving the cycle maths
- [x] §4c REM/Wake ordering — spectrum-led, motion as veto. **Planted REM recall 0/9 → 9/9**; corpus median
      REM% 4.8 → 6.5, no night regressed. The bout guard (b) was built, measured, and **not shipped**: inert
      on the synthetic, and it took the real night from 10 min of REM to zero because there the only two
      candidates are isolated singletons
- [⛔] ~~§3 the weighted-score detector — the sole remaining blocker.~~ **RETIRED IN PLACE 2026-08-02, see §9** — built offline and measured on 41 nights: no threshold satisfies §5's falsifiers, and at every threshold that lands REM % in band the desat ratio is **0.00**. It is a stability detector, and REM is the least stable thing on the night. Original text kept below for the record:
- [⛔] §3 (superseded) Ordering is fixed and the
      spectrum works, but on real data the CONJUNCTION still under-selects: 2026-07-27 has 26 epochs
      clearing the LF/HF gate, 10 clearing RMSSD, and 2 clearing both. Corpus median REM% is 6.5 against a
      physiological 15–25%
- [x] **§3a respiratory-rate variability computed per epoch — LANDED 2026-07-29, and the oracle had to
      be corrected first, for the third time in this brief's life.** `respPhase` was ONE
      stage-independent phase function: the generator breathed identically in REM and NREM, so the
      feature §3 calls "the missing discriminator" measured ~0 in every stage and could be neither
      built nor validated against it. That is §4's motion finding one signal over, and the same rule
      applied — **fix the oracle first, or train toward a false target.** `respIrreg` now scales the
      wander per stage (REM 0.055 · Wake 0.045 · N1 0.022 · NREM 0.008 Hz); mean rate unchanged,
      variability only. `epochs[].respCv` measures it: five 60 s sub-windows per epoch, each one's HF
      peak, CV across them — **null, never 0**, below three usable sub-windows, because 0 reads as
      perfectly metronomic and that is the strongest NREM evidence there is, fabricated from absence.
      **Measured against planted truth: REM 0.099 · Wake 0.056 · N1 0.036 · N2 0.039 · N3 0.038** — a
      2.6× REM/NREM separation, Wake sitting between them exactly as the physiology predicts, and
      N2 ≈ N3 confirming it measures irregularity rather than depth. All four facts are gated;
      flattening `respIrreg` to a constant reds them. The three §EP-rest pins moved again for the same
      reason as in §4 (the RSA term moves the RR series) and were re-pinned knowingly: DC 9.62 → 10.1,
      AC −10.26 → −9.87, SampEn 1.03 → 0.962, with the /2-slip discrimination re-verified by mutation.
      Export-inert by measurement: both committed ECGDex goldens are byte-unchanged (`respCv` is an
      internal epoch field), so no fixture moved.
- [⛔] **§3b the REM score itself — RETIRED IN PLACE 2026-08-02 (§9): built, measured, FAILED at every threshold.** Original text: Executed, measured against all three of §5's
      falsifiers, and NOT SHIPPED: it passes two and fails the third, and the third shows the passes
      are partly an artifact.** (2026-07-29 run; supersedes the p=0.845 reading below.)

      **First, a correction.** The earlier note claimed the score's recall losses were **motion-veto**
      losses. That was asserted, not measured, and it is **false**. Planted REM's motion index runs
      0–28.9 against vetoes at 35 and 60 — *no REM epoch reaches either veto*, under either detector.
      The conjunction's two misses (tMin 270/275, the last bout) fail the **LF/HF gate**: 1.567 and
      1.454 against a night gate of 1.775, with RMSSD and motion unambiguously REM on both. A
      night-relative veto would therefore have changed **nothing**. The right lesson is the one this
      brief keeps re-learning: *measure the mechanism before prescribing the fix.*

      **What the score actually does.** Those same two epochs carry respCv 0.159 and 0.071 against an
      NREM median of ~0.038, so the feature §3a added is exactly what rescues them — the score reaches
      **9/9 planted recall** where the conjunction gets 7/9. It works, and for the stated reason.

      **The three falsifiers, measured.** (bout ≥ 2 epochs applied; corpus = 14 nights)

      | gate | planted recall | precision | corpus median REM% |
      |---|---|---|---|
      | conjunction (shipped) | 7/9 | 78 % | **6.5 %** ✗ |
      | score, absolute floor 2.0 | **9/9** | 47 % | **0 %** ✗ |
      | score, band p=0.78 | 8/9 | 57 % | 25.0 % |
      | score, band **p=0.80** | **8/9** | 57 % | **22.5 %** ✓ |
      | score, band p=0.82 | 7/9 | 64 % | 20.7 % ✓ |
      | score, band p=0.86 | 6/9 | 55 % | 18.9 % ✓ |

      §5's **population** falsifier passes at p=0.80 with recall *better* than shipped — so the
      either/or reported earlier was an artefact of a single badly-chosen percentile, not a real wall.
      An absolute floor is not the answer either: the synthetic's REM separates far more strongly than
      real REM (planted REM scores 2.10–8.22; **nothing on the real corpus reaches 2.0**), so a floor
      tuned on planted truth fires essentially never on real data. **The oracle cannot calibrate a gate
      for real data** — recall and corpus share are measuring different worlds. That is new, and it
      constrains every future attempt.

      > ✅ **RE-MEASURED 2026-07-29 on the project's own night definition — see §7 below. Two of the
      > three conclusions in this entry were artefacts of the confounded harness and are WITHDRAWN;
      > the premise survived and a new, better-powered defect surfaced.**

      > ⚠️ **CONFOUND — the corpus figures in this entry are NOT VALID as sleep measurements
      > (found 2026-07-29, same day).** The harness that produced them merged **every** `*_ECG.txt` in
      > a calendar-date folder, with **no nocturnal gate and no night-key pooling**. The resulting
      > "nights" span ~23 h of wear (07-23 runs 02:37 → 01:39; 07-21 19:47 → 02:41), so the
      > denominator — "sleep minutes" — contains daytime wear, and several REM bouts start at 19:47,
      > 20:36 and 20:51. `tools/trio-batch.mjs` has defaulted to `--night-band 21-9` plus night-key
      > pooling all along; the ad-hoc harness had neither, and reproducing the project's own tool was
      > the step that got skipped. **Every corpus median and every bout statistic below must be
      > re-measured before it is used**, and §5.4 of `CPAP-AUTOHARVEST-FOLLOWUPS` (fold by night key)
      > is a precondition for any corpus-based REM claim, not a nicety. The PLANTED-TRUTH numbers
      > (recall, precision) are unaffected — they come from the synthetic, which is one clean night.

      **§5's CYCLE-STRUCTURE falsifier FAILS, and that is why this is not shipped.** A REM period runs
      5–25 min. Fraction of each night's REM sitting in runs **longer than 25 min**:

      | night | 07-16 | 07-17 | 07-19 | 07-20 | 07-21 | 07-22 | 07-23 | 07-25 | 07-27 | 07-28 |
      |---|---|---|---|---|---|---|---|---|---|---|
      | % of REM in >25 min bouts | 62 | **100** | 46 | 0 | 76 | 54 | **88** | 0 | 35 | **100** |

      Median ≈ 58 %. Single "bouts" of **75 min** (07-23) and **65 min** (07-21) are not REM periods,
      and bout length does not lengthen toward morning (07-23 runs 75 → 10, the wrong way). **So the
      22.5 % that passes the population falsifier is more than half composed of runs that cannot be
      REM.** A number can be in the right range for the wrong reason, and this one is — which makes
      shipping it worse than the visible 6.5 % under-call, not better.

      **THE OPTION SPACE IS WIDER THAN "a finer grid" — recorded because that claim was too narrow.**
      1. **Re-measure under the project's own night definition** (nocturnal gate + night key). Cheapest,
         and a precondition for everything else here.
      2. **REM vs QUIET WAKE is structurally unseparated.** The score is tested BEFORE the Wake
         heuristic and motion is the only Wake defence — and quiet wakefulness has no motion. §4c
         already concluded HRV alone cannot separate the two; the score makes REM's claim *stronger*
         without adding any Wake discriminator, so over-long "REM" runs in the evening are exactly what
         one would predict. This may be the whole of the §3 bout failure.
      3. **Real PSG ground truth — `nsrr-adapter.js` already exists and already parses scored staging**
         (`parseNsrrXml`, 30 s epochs), today only to count non-Wake epochs for a TST denominator.
         NSRR cohorts (SHHS/MESA/MrOS) ship full expert hypnograms WITH ECG, so extending that parser
         to emit the per-epoch hypnogram replaces falsifiers with measured sensitivity/specificity —
         and is the only route to the `emerging` tier §5 describes. Requires the owner's signed DUA;
         the files are user-supplied, exactly as the existing ODI-bias analysis already assumes.
      4. **The cross-signal falsifier §5 lists and nobody has run:** REM should carry more and longer
         desaturations, and OxyDex publishes those per night. Available immediately, no new code — and
         it would directly separate "long REM bout" from "long quiet-wake stretch".
      5. **Structure inside the decision, not patched after it.** The current design thresholds each
         epoch and then repairs the series (smoother, bout rule). A hidden semi-Markov model with
         stage-duration and transition priors produces bout lengths and cycle structure *by
         construction*, which is the standard approach and would make §5's cycle falsifier a modelled
         quantity rather than an after-the-fact test.
      6. **Cardiopulmonary coupling (Thomas 2005)** — named in §5 as the only formulation that could
         justify `emerging` with a real citation. Never attempted.
      7. The finer (1-min) staging grid — worth doing, but it is one option among these, not the
         conclusion it was first written up as.

      **On the maximum-bout constraint:** a MAXIMUM bout constraint is the obvious move but
      not a mechanical one — truncating a 75-min run to its best 25 min chooses where REM "really" was,
      which is fabrication, and demoting the whole run discards real signal. What the over-long runs
      actually say is that the score stays elevated for a stretch the detector cannot resolve; the
      finer (1-min) staging grid, already sequenced below, is the honest instrument for that and should
      come **before** any further gate tuning.

- [ ] ~~**§3b the REM score itself — still open, and now the sole blocker.**~~ *(superseded by the entry above)* A weighted score
      (`z(LF/HF) − z(RMSSD) + z(respCv)`, MAD-based, motion kept as veto rather than term, band gate)
      was **built, measured, and deliberately NOT shipped** — it passes one of §5's falsifiers by
      failing another:

      | detector | corpus median REM% (target 15–25) | planted-truth REM recall |
      |---|---|---|
      | conjunction (shipped) | **6.5 %** ✗ | 7/9 |
      | weighted score, band p=0.78 | 28.2 % ✗ | 8/9 |
      | weighted score, band p=0.845 | **21.3 %** ✓ | **6/9** ✗ |

      Population plausibility and planted-truth recall move in **opposite** directions across the band,
      so no single setting satisfies both — and §5 lists both as acceptance. Two things are worth
      knowing before the next attempt. (1) The band percentile had to be **calibrated to the corpus**
      to land in the physiological range at all. That is legitimate — §5 names population plausibility
      as a falsifier — but it is a *calibration*, not a validation, and must never be reported as
      accuracy. (2) The planted-truth losses are **motion-veto** losses: REM epochs whose phasic
      twitches exceed the veto's fixed threshold of 60. A night-relative veto is the obvious next thing
      to measure, and it is cheap.
- [⛔] ~~Bout-structure constraint; the minority-stage exemption retired in favour of it~~ — **MOOT (§9)**: it was to constrain the score's output, and the score is not shipping. The exemption stands.
- [x] §5 acceptance run — **RUN 2026-08-02 on 41 nights, not 11 (§9), and it FAILS.** REM % can be put in band (top 18 % → 17.4 %) but bout max reaches 35 min with 10 over-long bouts and the desat ratio is 0.00. The acceptance run is the thing that killed the redesign.
- [⛔] ~~Finer staging grid (1 min) — sequenced after the score lands~~ — **MOOT (§9)**: sequenced after a score that is not landing. A finer grid on a detector that is anti-correlated with the falsifier would refine the wrong thing.
- [x] Evidence tier re-checked — **nothing to re-tier**: no detector change shipped, so no metric's evidence grade moved. The staging metrics keep the tier they had.

---

## 7 · Re-measured on the project's own night definition (2026-07-29)

The confounded harness was replaced by the thing that should have been used from the start: the
**24 nights `tools/trio-batch.mjs` has already computed**, under its own rules — night key =
date of *(start − 12 h)*, **majority-nocturnal** (`--night-band 21-9`), and **concurrent sessions
only**. My harness had none of the three; on 2026-07-16 the tool merges 9 concurrent sessions / 6.3 h
where I merged 20 / 7.28 h, and on 07-18 it takes 40 where I took 64.

### 7.1 The premise SURVIVES, and is slightly worse than stated

| | median REM % of sleep | range | nights at exactly 0 |
|---|---|---|---|
| 24 proper nights, shipped detector | **4.8 %** | 0 – 14.1 % | **5 of 24** |

Physiological is 15–25 %. So the ~4× under-call is confirmed independently, on nights defined by the
project's own tool — and it matches §1's original 4.8 % exactly. The 6.5 % figure quoted through §3b
came from the confounded harness; **4.8 % is the number to beat.**

### 7.2 WITHDRAWN: "the cycle-structure falsifier fails"

It does not — not for the shipped detector. On the 24 proper nights:

**39 bouts · median 10 min · maximum 25 min · 0 % of REM minutes in runs over 25 min.**

Every bout falls inside the physiological 5–25 min window. The 75-min and 65-min "bouts" reported in
§3b were **entirely** an artefact of merging daytime wear. What the proper nights show is the opposite
failure — too FEW bouts (1–4 per night, and five nights with none) against the 4–6 REM periods a real
night has. **Under-detection, not malformation.** The §3b claim that "the 22.5 % is more than half
composed of runs that cannot be REM" is unsupported and withdrawn; the score's bout structure on proper
nights has never been measured.

### 7.3 §5's cross-signal falsifier, run for the first time — and it does not look good

REM-related OSA is well established: REM should carry MORE and longer desaturations than NREM. Mapping
every OxyDex `desat_event` onto the ECGDex stage epoch covering it, across the same 24 nights (exact
Poisson 95 % CIs):

| called stage | min | desats | rate /h | 95 % CI |
|---|---|---|---|---|
| **REM** | 375 | 4 | **0.64** | [0.17, 1.64] |
| Light | 6855 | 179 | 1.57 | [1.35, 1.81] |
| **Deep** | 935 | 84 | **5.39** | [4.30, 6.67] |
| Wake | 1215 | 49 | 2.42 | [1.79, 3.20] |

- **Called-REM has the LOWEST desaturation rate of any stage** — backwards. But with 4 events its CI
  reaches 1.64 and overlaps Light's, so this is **suggestive and underpowered, not established**. It is
  recorded as a hypothesis with its power stated, not as a finding.
- **Called-DEEP carries 3.4× Light's rate, CIs non-overlapping** — decisive, and physiologically
  backwards: N3 normally has the FEWEST respiratory events. The likely mechanism is mechanical and
  testable: apnea drives **cyclical variation of heart rate**, CVHR produces large beat-to-beat swings,
  large swings raise RMSSD, and the Deep rule is `rmssd > 1.12 × median && hr < median`. **The stager
  may be reading sleep-apnea CVHR as deep sleep.** That is a bigger claim than anything in this brief
  and it is not REM-specific — it deserves its own investigation.

### 7.4 What this changes

- The REM detector must beat **4.8 %**, not 6.5 %.
- Bout structure is NOT currently a failing falsifier; **bout COUNT** is (1–4 against 4–6).
- The cross-signal falsifier is now runnable at zero cost from existing trio output, and should be a
  standing acceptance check for any candidate detector — it is the only one of §5's five that uses an
  independent SIGNAL rather than a population prior.
- §7.3's Deep result is the most statistically solid thing this investigation has produced, and it is
  about a stage nobody was looking at.


---

## 8 · §3's "missing discriminator" measured — and REFUTED (2026-07-30)

§3 nominated **respiratory-rate variability** as *"the one feature that gives REM a positive signature
instead of an LF/HF proxy."* `respCv` has been computed per epoch since 2026-07-28 and deliberately not
consumed by the stager, pending exactly this measurement. It has now been made, on **38 real nights /
2721 epochs**, and the feature does not do the job.

### 8.1 The oracle says the detector is fine, which is how you know the oracle is useless here

Against planted `stageTruth`, the SHIPPED conjunction scores **92.6 % recall / 92.6 % precision**, and
`respCv` separates REM from NREM at **AUC 0.990 [0.971, 1.000]**. Both look like green lights. Neither is.

The same detector under-calls REM **~4×** on real nights. An oracle that reports 92.6 % where reality
reports 4.8 % is **circular**: `genSynthetic` plants REM carrying the exact signature the rule looks for
(high LF/HF, suppressed RMSSD, atonic) *and* generates ragged REM breathing by construction, so `respCv`
recovers what the generator put there. **No REM detector change can be validated on this oracle** —
it scores agreement with its own assumptions. Recorded because the temptation to accept AUC 0.990 as
evidence is exactly the failure mode this brief exists to avoid.

### 8.2 On real nights, no threshold satisfies the falsifiers at once

The cheapest form of §3's "score, not conjunction": keep the shipped rule and ADD a `respCv` branch, so
the change can only ADD REM and the question stays isolated to *does `respCv` recover the missing REM?*

| rule | REM % | bout med | bout max | bouts > 25 min | desat ratio |
|---|---|---|---|---|---|
| SHIPPED | 7.5 | 5 | 45 | 4 | 0.46 |
| `respCv > 0.10` | **68.0** | 15 | **195** | **106** | **1.35** |
| `respCv > 0.15` | 54.5 | 10 | 160 | 66 | 0.93 |
| `respCv > 0.20` | 34.3 | 5 | 55 | 26 | 0.77 |
| `respCv > 0.25` | **18.7** ✓ | 5 | 45 | 6 | 0.58 |
| `respCv > 0.30` | 11.4 | 5 | 45 | 4 | 0.42 |
| `respCv > 0.40` | 7.8 | 5 | 45 | 4 | 0.45 |

Passing requires ALL of: REM % in 15–25 · bout max ≤ 25 min · zero over-long bouts · desat ratio > 1.
**No row passes.** The two criteria that matter move in *opposite* directions: the only thresholds that
push the desat ratio above 1 are the ones that call **54–68 %** of the night REM, and the only threshold
that lands REM % in the physiological band (0.25 → 18.7 %) drives the desat ratio *down* to 0.58, worse
than the shipped 0.46.

### 8.3 A correction: the desat-ratio "improvement" at 0.10 is arithmetic, not detection

First reading of the 0.10 row was that crossing the >1 line meant `respCv` had found something genuinely
REM-like. **That was wrong and is withdrawn.** At 68 % REM the two pools are no longer a stage against
its complement — "NREM" has been reduced to the 32 % of epochs with the *quietest* breathing, which is a
selected-calm subset and will carry fewer desaturations whatever the labels mean. The ratio rises because
the denominator was filtered, not because the numerator became REM. A falsifier evaluated at a label
prevalence of 68 % is not testing the label.

**The general form, worth keeping:** a cross-signal falsifier is only informative while the labelling is
near its plausible prevalence. Outside that range it degenerates into a statement about which epochs were
left over.

### 8.4 Where this leaves the redesign

- **Do not add a `respCv` branch.** No threshold satisfies the falsifiers, and the one that fixes
  prevalence makes the independent-signal check worse.
- `respCv` **stays computed and unconsumed**, as it has been. It costs nothing, it is now measured rather
  than assumed, and this table is the reason not to wire it.
- §3's full weighted score is **not** thereby refuted — only its nominated missing discriminator is. But
  the three remaining terms (z(LF/HF), −z(RMSSD), −motion) are all features the conjunction ALREADY uses;
  a score over the same inputs redistributes the same information and has no new signal to add. That is
  the honest prior, and it is why the score is not worth building until a genuinely new input exists.
- **What would actually move REM is a label, not a feature** — the same conclusion `DEEP-STAGE-DESAT-CONFOUND`
  §9 reached for Deep, arrived at independently. Both stages are now blocked on ground truth rather than
  on cleverness.

**Both halves of the staging investigation now terminate in measured negatives.** That is a result: two
plausible, well-motivated redesigns were stopped by measurement before they shipped metrics that would
have been worse.

## 9 · §3's weighted score itself — MEASURED, and it fails (2026-08-02)

§8.4 disposed of the score with an argument, not a measurement: the three remaining terms *"are all
features the conjunction ALREADY uses; a score over the same inputs redistributes the same information
and has no new signal to add. **That is the honest prior.**"* A prior is not a result, and §6 still listed
the score as "the sole remaining blocker" — so a reader working the checklist top-to-bottom would have
built it. It has now been built (offline, nothing shipped) and measured.

**Construction.** Per night, over sleep epochs only (Wake excluded), night-normalised:
`score = z(LF/HF) − z(RMSSD) − z(motionIndex)` — exactly §3's three surviving terms, `respCv` excluded per
§8. Swept both as a top-N% band and as an absolute z threshold. Scored on **41 nights** across both capture
trees against §5's falsifiers, with the desat ratio computed from OxyDex `desat_event` timestamps mapped
onto the ECG epoch grid.

| rule | REM % | bout med | bout max | bouts > 25 min | desat ratio |
|---|---|---|---|---|---|
| SHIPPED (reference) | 7.4 | — | — | 0 | — |
| score top 40 % | 39.5 | 10 | 70 | 49 | 0.12 |
| score top 25 % | 24.5 | 5 | 45 | 23 | 0.00 |
| score top 18 % | **17.4** ✓ | 5 | 35 | 10 | **0.00** |
| score top 15 % | 14.3 | 5 | 35 | 4 | **0.00** |
| score > 1.5z | 15.4 ✓ | 5 | 35 | 6 | **0.00** |
| score > 2.0z | 9.9 | 5 | 35 | 4 | **0.00** |

**No row passes**, and the failure is worse than §8.4 predicted. The prior said the score would merely
*redistribute* existing information — neutral. Measured, it is **anti-correlated with the independent
falsifier**: at every threshold that lands REM % in the physiological band, **zero** desaturations fall in
the score-selected epochs, across 41 nights. With ~12 desat events a night and ~20 % of epochs selected,
a median of exactly 0 is not chance (P(0 | one night) ≈ 0.07).

**Why, and it is obvious in hindsight:** `high LF/HF + low RMSSD + low motion` selects the *most
physiologically stable* epochs of the night. Desaturations arrive with arousal and movement. The score is
therefore a **stability detector**, and REM is being asked to be the least stable thing it can find. The
conjunction's three inputs do not merely lack new signal for REM — two of them point the wrong way once
combined into a band.

This closes §3 by measurement rather than by prior, and it strengthens §8.4's conclusion: **what would
move REM is a label, not a feature or a combining rule.**
