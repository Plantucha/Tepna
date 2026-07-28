<!--
  REM-STAGING-REDESIGN-2026-07-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-07-28 · **Follows:** `QC-SCOPE-RESOLUTION-2026-07-28-BRIEF.md`

# REM is under-called 4× — and the rule's shape, not its thresholds, is why

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
- [ ] §3 the weighted-score detector — **now the sole remaining blocker.** Ordering is fixed and the
      spectrum works, but on real data the CONJUNCTION still under-selects: 2026-07-27 has 26 epochs
      clearing the LF/HF gate, 10 clearing RMSSD, and 2 clearing both. Corpus median REM% is 6.5 against a
      physiological 15–25%
- [ ] §3 REM score replaces the conjunction; respiratory-rate variability computed per epoch
- [ ] Bout-structure constraint; the minority-stage exemption from `9f1edbc` retired in favour of it
- [ ] §5 acceptance run over the 11-night corpus — median REM % inside 15–25 %, cycle structure present
- [ ] Finer staging grid (1 min) — sequenced after the score lands, own re-bundle
- [ ] Evidence tier re-checked against what was actually demonstrated
