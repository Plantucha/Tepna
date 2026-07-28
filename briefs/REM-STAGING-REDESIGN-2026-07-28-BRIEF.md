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

- **Planted REM has LF/HF of 0.084–0.154** — implausibly low for any stage, and the opposite of the
  sympathetic dominance real REM shows. The classifier looks for *high* LF/HF; the oracle plants *low*.
- **Planted REM has a motion index of 96 / 100** (median), against N2/N3 at 0. `ecgdex-dsp.js:446` sets
  `act = Wake ? 1.0 : REM ? 0.5 : N1 ? 0.32 : 0.07`, making REM the **second-most-active** stage.
  REM is characterised by skeletal muscle **atonia**; gross body movement is suppressed, not elevated.

So the generator models REM as *looking like Wake in every feature the classifier can see* — which may be
where the REM/Wake confusion came from in the first place, if the rules were ever tuned against it.
**Building a classifier against this oracle would train toward a false target.** The first deliverable is
therefore to correct `genSynthetic`'s REM model — low gross motion with phasic twitches, elevated LF/HF,
irregular respiration — and only then write the assertions.

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

- [ ] §4a correct `genSynthetic`'s REM model — atonia + phasic twitches, elevated LF/HF, irregular
      respiration — so the planted truth is a truth
- [ ] §4b assertions on `stages`/`stageMinutes` in the group that already runs `analyze()` past `longRec`
- [ ] §4c REM/Wake ordering: a still body with elevated HR and suppressed RMSSD is REM, not Wake
- [ ] §3 REM score replaces the conjunction; respiratory-rate variability computed per epoch
- [ ] Bout-structure constraint; the minority-stage exemption from `9f1edbc` retired in favour of it
- [ ] §5 acceptance run over the 11-night corpus — median REM % inside 15–25 %, cycle structure present
- [ ] Finer staging grid (1 min) — sequenced after the score lands, own re-bundle
- [ ] Evidence tier re-checked against what was actually demonstrated
