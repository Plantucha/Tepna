<!--
  EXTERNAL-METHODS-SURVEY-FOLLOWUPS-2026-08-23-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-08-23 · **Follows:** `EXTERNAL-METHODS-SURVEY-2026-08-20-BRIEF.md` · **Relates:** `PAT-NO-VALID-ANCHOR-2026-08-02-BRIEF.md`, `KNOWN-CLOCK-ADVERSARIAL-CAPTURE-FOLLOWUPS-2026-08-14-BRIEF.md`

# What executing the external-methods survey turned up

The survey is DONE and **adopted nothing** — three method items measured, three negatives. That is a
result, not a failure, but the measuring produced findings the survey had no place to put. They are
here.

---

## 1 · 🔴 The candidate THRESHOLD is the lever the survey was looking for, and it is ours

**Owner:** `PAT-NO-VALID-ANCHOR`. **Cost:** one threshold sweep, no new capture.

§3 measured chest-movement candidates against arm-corroborated anchors on 36 nights and found the
failing nights are not movement-poor — they are movement-*noisy*:

| chest candidate rate | n | median corroboration | alignment refusals |
|---|---|---|---|
| ≤ 200 / h | 24 | **0.110** | 1 |
| > 200 / h | 12 | **0.005** | 4 |

Refusing nights fire at a median **559/h**, one candidate every four seconds. That is not gross body
movement, so `findAnchors` is admitting something local to the chest strap — respiration, cardiac
impulse, strap shift — which the arm cannot see by construction. Every one of those candidates is a
correlation lottery ticket against a 121-bin window, which is the same failure mode
`acc-acc-control.mjs` already documented for the coarse search: enough candidates and chance supplies
a peak.

**Do:** sweep `findAnchors`' threshold upward and re-measure corroboration and refusals per night.
The hypothesis is explicit and falsifiable — **raising the threshold should raise the corroboration
rate and leave the anchor COUNT roughly intact on the aligning nights**, because it is discarding
candidates that never corroborated anyway. **Done when:** the corroboration-vs-threshold curve is
recorded for the 36 nights with both quantities at each step, and the refusal count at the chosen
threshold is stated against the current 5.

⚠️ **Pre-state the decision band before running it** — a sweep that picks the threshold maximising
alignments is fitting the threshold to this corpus. The band should be set from what the detector is
*supposed* to catch (gross postural change, order tens per hour), not from the outcome.

### MEASURED 2026-08-23 — the band was NOT met. σ4 stays. This is not a lever.

`tools/acc-shared-movement.mjs --sigmas 3,4,5,6,8,10,12`, 37 of 39 nights (the corpus gained a night
mid-run; 2026-08-23 has no parseable H10 ACC yet). One parse per night, envelopes reused across every
step, so each night's seven rows differ **only** in `anchorSigma`.

| σ | median cand/h | median anchors | median corroboration | refusals | pooled cand | pooled anchors |
|---|---|---|---|---|---|---|
| 3 | 420.8 | 14 | 0.028 | **5** | 58409 | 664 |
| **4 (default)** | 103.2 | **10** | 0.063 | **5** | 20905 | 531 |
| 5 | 44.7 | 8 | 0.076 | 6 | 7524 | 412 |
| 6 | 25.3 | 7 | 0.101 | 6 | 3414 | 343 |
| 8 | 11.5 | 4 | 0.119 | 9 | 1813 | 249 |
| 10 | 8.8 | 3 | 0.137 | 11 | 1336 | 203 |
| 12 | 6.75 | 3 | 0.152 | 13 | 1037 | 167 |

**Against the band as written:** TARGET (≤ 60 cand/h) is met from σ5. **CONFIRMS (corroboration ≥ 0.20)
is never met** — the maximum is 0.152 at σ12. GUARD (refusals ≤ 5) holds only at σ3 and σ4. **The
TARGET and the GUARD are mutually unsatisfiable on this corpus**, and that is the result: there is no
threshold that buys the corroboration rate without buying refusals with it.

**σ4 is already the answer.** It is the largest σ at the refusal minimum, and σ3 buys nothing for 3×
the candidates. Going up: **zero** nights convert refusal → alignment at any σ above 4, while **8
nights that align at σ4 are LOST** (2026-07-16 goes 16 anchors → 1 at σ8; 07-19 goes 18 → 1 at σ10).

⚠️ **THE HYPOTHESIS ABOVE WAS HALF WRONG, AND THE WRONG HALF WAS THE OPERATIONAL ONE.** Its mechanism
holds: pooled candidates fall **20×** (20905 → 1037) while pooled anchors fall only **3.2×**
(531 → 167), so the efficiency ratio climbs 0.025 → 0.161 and the threshold genuinely does discard
uncorroborated candidates preferentially. But the conclusion drawn from it — that this could reduce
refusals — is impossible **by construction**, and the draft should have said so before any sweep ran:
anchors are a SUBSET of candidates, a refusal is `anchors < minAnchors`, so raising a threshold can
only hold the anchor count or lower it. Measured across all 37 nights, the anchor count is
non-increasing in σ with **zero exceptions** — the gap-rule unblocking that could in principle have
made it non-monotone never occurs.

So the sweep answers a **different and smaller** question than §1 posed: whether an anchor found among
1459 candidates is a chance correlation hit. It is largely not — the surviving anchors are the same
ones. That is reassuring about anchor QUALITY and says nothing about anchor QUANTITY, which is what
alignment is short of.

**And this is §3's floor again, one layer down.** The refusing nights hold ~1 corroborated movement
whatever the threshold: 2026-08-18 keeps exactly 1 anchor from σ3 through σ12 while its candidates
fall 1459 → 8. There is no detector setting that manufactures a second shared movement, because the
arm never saw one. **The candidate threshold is not the lever. Do not tune it.**

*(Fourth consecutive negative on this alignment surface, after §1's fiducial, §2's Nearest Advocate
and §3's Brønd. The pattern in §3 of this brief now has a fourth instance, and this one is the
cleanest: the quantity to check first was not empirical at all — it was that anchors ⊆ candidates.)*

## 2 · 🟡 The two PAT tools disagree about which ACC a night has

**Cost:** a reconciliation run; possibly a shared helper.

`pat-matchrate-strict.mjs` picks ACC fragments by **time proximity** to the chosen ECG/PPG pair
(`nearInTime`); `acc-shared-movement.mjs` picks the **pair maximising mutual overlap**. On the same
corpus they disagree: §1's run recorded 5 alignment refusals, §3's also 5 — but the two tools skipped
different nights for different reasons, so the sets are not the same 5.

Neither rule is obviously wrong. Time-proximity is right when the beat pipeline has already fixed the
span; overlap-maximising is right when nothing else has. But **a night's alignability should not be a
property of which tool asked**, and today it is.

⚠️ This is the surface that already produced one defect during execution: selecting each device's
LARGEST fragment independently reported *"the two ACC recordings do not overlap"* on 13 of 38 nights,
and `pat-matchrate-strict.mjs` carries a verbatim warning against exactly that
(*"Prefilter ACC candidates by TIME, not size"*) which was read during the work and did not prevent
it. A third selection rule is a third chance to get it wrong.

**Do:** run both rules over all 38 nights, tabulate where they differ and why. **Done when:** either
one rule is adopted by both tools with the difference table as the evidence, or the divergence is
recorded as intentional with the condition that selects each.

## 3 · 🟢 Three method swaps, three negatives, one shape — record it before the next survey

Not a task. A pattern that cost three measurements to establish and should cost the next survey none:

- **§1** — swap the PAT fiducial (Ajtay 2023). Median paired Δ **−0.0000**; the same 15 of 30 nights
  beat their null under both. The offset between fiducials is a near-constant 89.5 ms, and the
  estimator's leave-one-block-out centre absorbs a constant *by design*.
- **§2** — swap the aperiodic aligner (Schranz 2024). Nearest Advocate replaces a visibly broken
  estimator with a quietly broken one; the marker is not in the data.
- **§3** — swap the dual-ACC alignment method (Brønd 2021). ~94 % of chest movements have no arm
  counterpart. The method would consume an input that is not there.

**Each negative was predictable from a property of OUR data that we could have measured first**, and
in each case measuring it was cheaper than implementing the method. The order that would have saved
the work: *what does this method consume, do we have it, and is our estimator even able to respond to
what it would change?* — before *is the method better?*

That question is also what separates §1 from the others and is the subtlest of the three: our data
was fine, the *estimator* was structurally incapable of responding. A method comparison run through
an estimator that cannot express the difference returns a null for a reason that has nothing to do
with the method.

**Do:** nothing here. Cite this section from the next survey's framing.

## 4 · 🟡 §1's real finding was not about fiducials

PAT recovery on this corpus is gated **upstream of the estimator**: of 38 nights, 8 never reach the
comparison (5 fail clock alignment, 2 have no parseable pair, 1 has zero overlap), and of the 30 that
do, **only 15 beat their own circular-shift null — under every fiducial tested.**

So "PAT recovers on 6 of 38 nights" and "PAT recovers on 15 of 30" are both true and measure
different things, and neither is a fiducial fact. `PAT-NO-VALID-ANCHOR` owns this; recorded here so
the number is not re-derived a third time.

**Do:** state in `PAT-NO-VALID-ANCHOR` which denominator its headline uses. **Done when:** the
recovery figure there carries its denominator and its acceptance rule.

---

## 5 · Done when

- [x] §1 — **DONE 2026-08-23. The band was pre-stated in source before the run, and NOT met. σ4
      stays; the candidate threshold is not a lever.** Seven σ values over 37 nights. TARGET
      (≤ 60 cand/h) is met from σ5, CONFIRMS (corroboration ≥ 0.20) is never met at all (max 0.152),
      and GUARD (refusals ≤ 5) holds only at σ3–σ4 — the target and the guard are mutually
      unsatisfiable here. Zero refusal→alignment conversions above σ4; 8 nights that align at σ4 are
      lost above it. The hypothesis' mechanism held (pooled candidates fall 20× against anchors 3.2×)
      but its operational claim was impossible by construction, since anchors ⊆ candidates makes the
      anchor count non-increasing in σ — measured with zero exceptions across 37 nights.
- [ ] §2 — the two ACC-selection rules tabulated against each other; one adopted, or the divergence
      recorded with its condition.
- [x] §3 — recorded 2026-08-23. Nothing to execute.
- [ ] §4 — `PAT-NO-VALID-ANCHOR`'s recovery figure carries its denominator and acceptance rule.
