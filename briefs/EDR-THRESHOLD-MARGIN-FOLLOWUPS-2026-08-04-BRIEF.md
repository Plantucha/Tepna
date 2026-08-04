<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-04 (all items closed; the survey REFUTED this brief's own §2 prescription where regimes do not separate — see §3) · **Created:** 2026-08-04 · **Spawned-by:** `ECGDEX-EDR-RESP-ACCURACY-2026-07-31-BRIEF.md` (executed; §6.4 is the finding this follows up)

# A gate can pin a fix that is 0.035 from failing — margin is a measurement, not a property of green

## 1 · What happened

`ECGDEX-EDR-RESP-ACCURACY` shipped a harmonic check to stop `crc.respFromEDR` reading exactly half at
24 breaths/min. It was gated on five seeds at 900 s, the isolation was done carefully (§6.2 explicitly
warns that a single-condition isolation of this estimator is not evidence), and every leg was green.

The check was nonetheless failing. Its threshold, `ac[half] > 0.8 * best`, sat **0.035 above** the value
the true answer actually carries (0.745). At 180 s, 300 s and at 1800 s on one seed, 24/min still read
~12. The gate pinned 900 s, which is one of the lengths where the marginal comparison happened to land
the right way.

**Nothing in the process was skipped.** The brief measured, isolated, seeded, and pinned. What it never
did was ask *how close the passing comparison was to failing* — and the answer was 0.035 on a scale
where the correct decision boundary is 1.7 wide.

## 2 · The transferable rule

> When a fix is a **threshold**, the gate must pin the **margin**, not just the outcome. A green
> assertion says the comparison went the right way once; it says nothing about how nearly it didn't.

Two cheap habits follow, and §6.4 used both:

- **Measure the two populations, then put the threshold in the gap.** Not "0.8 feels permissive" but
  "wrong cases measure −1.26…−2.89, right cases +0.745, so 0.5 has 0.245 of margin either side." A
  threshold chosen from a measured separation is auditable; one chosen from reasoning is a guess with a
  comment attached.
- **Ask what the threshold means physically.** `0.8` encoded "close to equal", which is the wrong claim —
  an attenuated fundamental is *not* close to equal. The right claim was a **sign** test (anti-phase vs
  a real peak). Getting the kind right is what moved the margin from −0.035 to +0.245; any numeric tuning
  of 0.8 would have left it fragile.

## 3 · What is owed

- [x] **SURVEYED 2026-08-04 — and the survey's first result is that §2's prescription DOES NOT
      GENERALISE. Most thresholds have no two populations to sit between.**

      Scanned every DSP / fusion / morph module for the exact shape of the §1 defect — a comparison
      against a scaled other quantity, `x <op> K * y`. **22 occurrences.** Most are **structural**, not
      decisions: loop and window bounds (`n > 2*WIN`, `k < 2*L`, `W < 4*L`, `N < 2*m`, `s > 2*half`).
      They admit no margin question and are excluded.

      **The one real family: RR-regularity gating, and it carries THREE different constants.**

      | site | bound | purpose | rejects (93 600 real beats) |
      |---|---|---|---|
      | `ecgdex-dsp.js:914` `ectopyThr` | **±20 %** | ectopic **correction** — Malik rule, cited (Task Force 1996 / Kubios) | 3.97 % |
      | `ecgdex-morph.js` :225 :271 :379 | **±15 %** | select regular beats for template / MMA | 6.33 % |
      | `ecgdex-morph.js:92` (`classifyBeats`) | **±12 %** | select beats for the *normal template* | 8.89 % |

      The 20 % is a different job (correction, not selection) and is cited, so it is not an
      inconsistency. **The ±12 % is**: it is a lone value among four sibling "select regular beats"
      filters in one file, with no comment justifying the tighter bound. The two constants disagree about
      **2.56 % of real beats**.

      ⛔ **But there is NO GAP to put a constant in, and that is the finding.** The deviation
      distribution `|RR/medRR − 1|` is **smooth and unimodal-decaying** — p50 0.036, p90 **0.111**, p95
      0.176, p99 0.309. The 12 % bound sits essentially **on the p90 shoulder**; 12 %, 15 % and 20 % are
      three arbitrary points on one continuous curve. §1's EDR case had genuinely non-overlapping
      populations (−1.26…−2.89 vs +0.745, a gap of 2.0); this family has none.

      **So §2's rule needs the qualifier it was missing:** *measure the two populations and put the
      constant in the gap* applies **only when a gap exists**. Where the distribution is continuous, the
      honest record is not a margin but **the exclusion fraction** — "±12 % drops 8.89 % of beats" is a
      statement someone can audit; "±12 % has good margin" would be meaningless. Recording the fraction
      beside such a constant is the transferable action, not re-deriving a boundary that is not there.

      **No code changed.** Nothing here is a defect: the ±12 % is defensible for template construction
      (a tighter beat set makes a cleaner template) and is 2.56 % of beats from its siblings. It is
      *undocumented*, which is a comment-level fix an owner may or may not want, not a behavioural one —
      and changing it would move every morphology golden for no measured benefit.
- [x] **STANDING PRACTICE — applied three times, and each time the KIND of test changed, not the number.**
      Recorded as demonstrated rather than as a rule awaiting adoption:
      - **`ecgdex-dsp` harmonic check** — `> 0.8·best` (near-equality) → `> 0.5·best` (a **sign** test:
        a true fundamental puts the half-lag at anti-phase). Populations −1.26…−2.89 vs +0.745; margin
        went from −0.035 to +0.245.
      - **RR-regularity constants** (§3 survey) — no gap exists, so the recorded quantity became the
        **exclusion fraction** (±12 % drops 8.89 % of beats) rather than a margin.
      - **`analysis-stats` ρ_crit** — no margin exists, so the published quantity became the **local
        sensitivity** (`sigmaPerRho`, `rhoFor0p1`) rather than a refusal threshold.
      The through-line: when the two regimes do not separate, the honest output is a *measured quantity
      the caller can act on*, never a boundary chosen to look principled.

- [x] **CONVENTION RECORDED — and deliberately NOT made a blanket gate.** `respAt(bpm, seed, durSec)`
      takes the length, and the EDR estimator is now pinned at **180 / 300 / 900 / 1800 s**, which is what
      caught the 0.035-margin failure.

      ⚠ **A mechanical "every `genSynthetic` pin needs ≥2 durations" rule would be wrong**, and measuring
      it says why: `tests/dex-tests.js` has **39 `genSynthetic` call sites across 15 distinct durations**,
      but most are **2–6 s** — parser and shape tests with no estimator value to be phase-sensitive about.
      Forcing all 39 to double would be the over-generalisation §3 of the sibling survey warns against.

      **The criterion is the property, not the helper:** an estimator needs a multi-length pin when its
      answer depends on where a carrier's phase falls on a sampling grid — i.e. when it locks onto a
      periodicity. That is why EDR at 4 Hz needed it and a parse-shape assertion does not. Apply it by
      asking whether the estimator can lock onto a harmonic, not by counting `durSec` arguments.

## 4 · Explicitly NOT owed

- **Re-opening §6.3's parabolic-interpolation decision.** It is measured, the trade is stated (synthetic
  aggregate says remove, the one real night says keep), and it is routed to the owner. It is not a margin
  question.
- **Option 3, the 8–12/min low band.** Still deliberately not taken; it needs a steeper `_bandResp` and
  moves every CRC metric fleet-wide. The sign test does not reach the low edge and does not pretend to.

## Cross-references
- Parent: `ECGDEX-EDR-RESP-ACCURACY-2026-07-31-BRIEF.md` §6.4 (the correction) and §6.2 (the pass that
  came one step short — its reasoning is sound and worth reading before doing the §3 audit).
- Related failure class: `ui-export-paths-broken` — machinery that passes without exercising anything.
  This is its quieter sibling: machinery that *does* exercise the thing, and passes by a hair.
