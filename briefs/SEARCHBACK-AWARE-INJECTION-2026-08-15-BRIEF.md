<!--
  SEARCHBACK-AWARE-INJECTION-2026-08-15-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-15 · **Created:** 2026-08-15

# Gap-planted injection UNDERSTATES the miss rate — §7.3's caveat has the right insight and the wrong sign

> Executes the next increment named in `CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14-BRIEF.md` §7.3.
> Declared to that brief's author before starting, and built on their file rather than beside it.

## 1 · The claim being tested

§7.3 measured a completeness curve by planting the subject's averaged beat into **gaps** ≥350 ms from any
real beat, and correctly flagged that this is biased, because an isolated plant cannot benefit from
Pan–Tompkins' **searchback** — the mechanism that reopens a detection window when an RR interval runs long.
It concluded:

> *"the measured completeness understates what the detector achieves on beats in rhythm, so the true miss
> rate is ≤ 1.4 %, plausibly well below it."*

**The insight is right and the sign is wrong.** Measured in rhythm, completeness is *lower*, so the bound
moves **up**.

## 2 · Method — attenuate real beats in place

For a scattered 5 % subset (never two adjacent, so every scored beat keeps unmodified neighbours and every
neighbouring RR is intact): excise the beat's own fitted waveform and re-insert the **leave-one-out average
shape** at that beat's amplitude, scaled by α. Rhythm, RR sequence and searchback context are untouched.

**⚠️ The obvious construction makes the α = 1 control vacuous, for ANY template.** Writing
`residual = window − fitted` and reconstructing `residual + α·fitted` gives, at α = 1,
`window − fitted + fitted` — bit-identical to the original however badly the template fits. The control
could not fail, so it certified nothing: *a check reporting success about something it never examined*, in
the one place put there to prevent exactly that. Caught in review by #1292's author.

**Leave-one-out alone does not fix it** — the identity is structural, not a property of the template
(verified: own-fit `true`, LOO-fit `true`, this scheme `false`). What breaks it is removing one object and
inserting a *different* one. That also makes the re-inserted object the same one `injectAndRecover` plants,
so the two curves measure the same waveform and are legitimately comparable.

`editDelta` is now published and gated: **> 0 at α = 1**, against the retired construction's ~1e-13.

## 3 · Controls, before any curve

102.5 min of H10 ECG, 6068 baseline beats, 304 modified.

| control | result | what it rules out |
|---|---|---|
| α = 1 recovery | **100.0 %** | excise-and-reinsert damaging the beat |
| untouched-beat retention | **100.00 %** at every α | the edit perturbing the rest of the record |
| α = 0 removal | local peak/noise **55.9 → 13.1**, **0 %** of residuals above the knee | the beat not actually being gone |
| α = 0 recovery at every nb | **0.0 / 1.2 / 10.7 %**, landing a median **15.4 ms** from truth | a low-threshold condition inventing what it counts — it is not inventing, it is finding the residual |

## 4 · Two findings, deliberately separated

**A · The α = 0 "fabrications" are NOT inventions — and finding that out exposed a flaw in this
instrument.** α = 0 removes the fitted beat, so any recovery looked like invention:

| neighbours attenuated | recovery at α = 0 |
|---|---|
| nb = 0 | 0.0 % (0 / 243) |
| nb = 1 | 1.2 % |
| nb = 2 | **10.7 %** |

The first draft promoted that to a finding — *"under clustered conditions Pan–Tompkins invents beats"*.
**It is wrong.** Asked where those detections actually land (review question; the data was already on
disk), they sit a median **15.4 ms** from the true position of the removed beat — about **two samples** at
130 Hz — with 92 % inside 25 ms. An inference from intervals would have put them near the **±507 ms** RR
midpoint. They are not inventions; they are the detector finding what is still there.

**Which means α = 0 is not silence.** Template subtraction is imperfect: what remains is beat-shaped and
beat-positioned, and the local peak/noise falls **55.9 → 13.1**, not to 0. At nb = 0 the threshold sits
above that residual (0 % recovered); at nb = 2 it has dropped below it (10.7 %). Nothing is fabricated
and nothing is hallucinated — **the nominal SNR axis was simply wrong at low α.**

⚠️ **Three review rounds each corrected this section in a different direction**, and the sequence is worth
recording because each version was defensible: *searchback does not rescue* (wrong — α = 0 has nothing to
rescue) → *the detector does not hallucinate* (true only at nb = 0, quoted for nb = 2) → *the detector
fabricates 10.7 %* (wrong — those are real residuals, correctly placed). What survives is a defect in the
measuring instrument, not a property of the detector.

**B · In rhythm is HARDER than in a gap — and on the honest axis, by ~3×.**

The curve must be labelled by the SNR the detector actually faced, not the one α nominally asked for. The
two differ substantially, because the residual never leaves:

| α | nominal SNR | **measured** SNR | completeness |
|---|---|---|---|
| 0.55 | 32.4 | **39.3** | 99.0 % |
| 0.50 | 29.5 | **36.4** | 66.4 % |
| 0.45 | 26.5 | **33.8** | 26.0 % |
| 0.40 | 23.6 | **31.2** | 6.6 % |
| 0.37 | 21.8 | **29.3** | 2.6 % |
| 0.00 | 0.0 | **14.1** | 0.0 % |

A gap plant lands in an empty gap, so for it nominal ≈ measured. Comparing like with like at **measured
SNR ≈ 30**: in-rhythm **2.6 %**, gap-planted **94.7 %**.

Convolved against the real-beat SNR distribution measured **the same way** (local peak / local noise,
n = 6068, median 65.4, p1 32.6, p5 41.5):

    in-rhythm, measured axis  → 1.56 % miss rate
    gap-planted              → 0.53 % miss rate      (~3x)

⚠️ **The first version of this brief reported 0.82 % vs 0.62 % (+32 %) using the nominal axis.** That
understated the gap by a factor of three, in the comfortable direction, and the error was in *this work's*
instrument rather than in §7.3's. Read the ratio, not the absolutes — the segment differs from §7.3's.

### The morphology alternative, excluded by measurement

`residual + α·template` scales an *average* beat while leaving the residual — this beat's departure from
the population shape — at **full** size. At low α the residual is a large share of what remains, and a
difference-of-two-beats has different frequency content from a beat. So a refusal might have been
**morphology** ("that no longer looks like a beat") rather than threshold, and the two were confounded.
Raised in review; separated by a second construction that scales the beat *with* its own morphology and
leaves flat baseline at α = 0:

    edited = baseline + α · (window − baseline)

| construction | miss rate |
|---|---|
| template-scaled | 1.56 % |
| **baseline-scaled** (morphology preserved) | **1.73 %** |
| gap-planted | 0.53 % |

The two in-rhythm constructions agree to ~11 %, and at matched measured SNR template-scaling is if anything
*slightly better* — the retained residual adds a little detectable energy rather than costing morphology
credibility. **Morphology does not explain the in-rhythm penalty**; the threshold mechanism does, and the
~3× stands with the alternative excluded rather than merely unconsidered.

## 5 · The mechanism, measured rather than proposed

The proposed explanation was that full-amplitude neighbours hold the adaptive threshold high while a gap
plant faces no such local competition. #1292's author proposed the falsifiable form: attenuate the middle
beat **and its neighbours**, and recovery should improve toward the gap curve. It does:

| SNR (nominal) | nb=0 | nb=1 | nb=2 |
|---|---|---|---|
| 29.5 | 69.5 % | 89.3 % | 96.7 % |
| 26.6 | 23.9 % | 42.8 % | 84.0 % |
| 23.6 | 4.5 % | 17.3 % | 82.7 % |
| 21.9 | 1.2 % | 13.2 % | 84.4 % |

Monotone in k and very large — at nominal SNR 21.9 the middle beat goes from **1.2 % to 84.4 %** purely by
turning its neighbours down. **The adaptive-threshold explanation is confirmed**: full-amplitude neighbours
hold Pan–Tompkins' running threshold high, and that accounts for the discrepancy with no appeal to
searchback.

⚠️ **The nb = 2 column is near-flat across SNR (82.7 / 84.4 / 84.0), which a completeness curve should not
be.** That flatness is real and has the same cause as §4A: once the threshold has adapted far enough down,
the **residual** of the attenuated beat is itself above threshold, so detection stops depending on α. It is
not fabrication — the detections are correctly placed — but it does mean the nb = 2 column measures the
residual floor rather than a completeness curve, and should not be read as one.

It also explains the ordering of all three conditions, which was not predicted: **nb=0 < gap-planted <
nb=2**. A gap plant sits between full-amplitude real beats but has no neighbour inside the integration
window, so it faces an intermediate threshold; several consecutive attenuated beats let the threshold adapt
down and over-correct past the gap condition.

## 6 · The consequence, which is unwelcome

**1.56 %**, against `KNOWN-CLOCK-ADVERSARIAL-CAPTURE`'s measurement that **0.5 %** inflates rMSSD by
**114 %** and 2 % by 387 %. The correction moves the number the wrong way and by ~3×, and a correction that
had moved it the comfortable way would have been the one to distrust.

⚠️ **This is the ISOLATED-faint-beat rate** (nb = 0) — the right model for a beat faint for its own reasons.
Under motion or poor contact several consecutive beats degrade together (nb ≥ 1), where the miss rate is
much lower because the threshold adapts down. **Which regime this corpus is actually in is unmeasured**,
and it is the next unit.

⚠️ **And the clustered regime is milder, not equally bad** — a reader arriving from "misses and inventions
both inflate rMSSD" will assume otherwise. In the clustered regime the detector still *finds* the beat and
its timing is good (median **15.4 ms** scatter). A merged interval (miss) or a split one (invention) is a
~500–1000 ms error in a single RR; 15 ms of timing jitter is a small perturbation beside that. So the two
regimes fail differently **and unequally**: isolated faint beats are missed outright, clustered ones are
detected slightly late. Only the first is a large rMSSD error.

Worth stating alongside it: misses and inventions **offset in mean RR** — one removes a beat and lengthens
it, the other adds one and shortens it — while both inflate rMSSD. The metric that looks healthy is the one
in which they cancel, which is the same asymmetry `KNOWN-CLOCK-ADVERSARIAL-CAPTURE` measured from the other
side (0.1 % misses moved mean RR 0.06 % and rMSSD 20.8 %).

## 7 · Done when

- [x] Beats attenuated in rhythm with RR context and neighbours preserved.
- [x] The α = 1 control is non-vacuous **and gated**, with the retired construction's value computed
      alongside so the contrast cannot be lost.
- [x] Removal verified effective before any α = 0 claim is made.
- [x] The two α = 0 readings separated; neither over-claimed.
- [x] The α = 0 control re-run in **every** threshold condition, not only the one where it passes.
- [x] The morphology alternative separated by a second construction and **excluded** (1.56 % vs 1.73 %),
      rather than left as an unconsidered confound.
- [x] The SNR axis corrected from nominal to **measured** — the residual never leaves, so α = 0 is not
      silence and the nominal axis understated the effect by ~3×.
- [x] The proposed mechanism converted into a measurement that could have refuted it.
- [ ] **Measure the real clustering of faint beats** — whether low-amplitude beats arrive isolated or in
      runs decides which column of §5 applies, and with it whether the dominant error is a miss (isolated)
      or an imprecisely-timed detection (clustered). Not done here.
- [ ] §7.3's sentence corrected in `CROSS-DOMAIN-METHODS-FOLLOWUPS` (carried by this PR, by agreement with
      that brief's author, so two sessions do not edit one brief on one day).
