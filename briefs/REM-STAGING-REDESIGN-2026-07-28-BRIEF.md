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

## 4 · The coverage hole this exposed — fix FIRST

**No committed fixture exercises `stageSleep` at all.** Staging is gated on `longRec` (≥ 90 min) and both
ECGDex fixtures are far shorter: the equiv clip spans **6 min** (`01:06:17 → 01:12:19`), the synthetic
golden **60 s**. Every gate stayed green through all three defects, and would have stayed green through
anything else done here.

So the first deliverable is **a committed synthetic long-recording twin** that reaches the staging path —
adversarial by construction, with a known REM architecture planted in it. This repo already learned that
an adversarial *committed* twin beats a real one (the GlucoDex 14 h-gap case): a real gappy night is
gitignored and CI stays just as blind. `genSynthetic` already builds staged sleep architecture
(`ecgdex-dsp.js:182` — "cycles ~90 min; each cycle dips into deep then up to REM"), so the planted truth
is already expressible.

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

- [ ] §4 synthetic long-recording twin committed, with planted REM architecture, reaching `stageSleep`
- [ ] §3 REM score replaces the conjunction; respiratory-rate variability computed per epoch
- [ ] Bout-structure constraint; the minority-stage exemption from `9f1edbc` retired in favour of it
- [ ] §5 acceptance run over the 11-night corpus — median REM % inside 15–25 %, cycle structure present
- [ ] Finer staging grid (1 min) — sequenced after the score lands, own re-bundle
- [ ] Evidence tier re-checked against what was actually demonstrated
