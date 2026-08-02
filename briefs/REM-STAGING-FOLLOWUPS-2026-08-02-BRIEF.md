<!--
  REM-STAGING-FOLLOWUPS-2026-08-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-02 · **Follows:** `REM-STAGING-REDESIGN-2026-07-28-BRIEF.md` (DONE — measured negative) · **Related:** `DEEP-STAGE-DESAT-CONFOUND` §9 · **Affects:** `nsrr-adapter.js`, `ecgdex-dsp.js`, `tests/dex-tests.js`

# Two stages are now blocked on the same missing thing: a label. The adapter for it already exists.

`REM-STAGING-REDESIGN` executed to a measured negative — the `respCv` branch (§8) and the weighted score
(§9) were both built and both failed §5's falsifiers on real nights. `DEEP-STAGE-DESAT-CONFOUND` §9 reached
the same conclusion for Deep, independently. **Neither stage is short of cleverness; both are short of
ground truth.** This brief captures what executing the parent surfaced.

## 1 · The oracle is circular, and that is now a standing constraint — not a one-off

`genSynthetic` plants REM carrying the exact signature the rule looks for, so the shipped conjunction
scores **92.6 % recall / 92.6 % precision** against planted truth while under-calling REM **~4×** on real
nights, and `respCv` reaches **AUC 0.990** on the same oracle while failing every real-night falsifier.

**The constraint this implies:** no REM or Deep detector change may be validated on `genSynthetic`. It is a
regression harness — it proves a detector still does what it did — and it is not evidence about staging
accuracy. This is worth stating as a rule because two separate features have now passed it and failed
reality, and a third will be proposed eventually.

## 2 · What actually needs building: an NSRR-labelled validation path

`nsrr-adapter.js` already exists. The National Sleep Research Resource ships **PSG-scored** polysomnography
— 30 s epochs with expert stage labels — which is precisely the missing label. The work is:

- **2a** Establish what the adapter currently ingests and whether stage annotations come with it, or only
  signals. If only signals, the annotation files are the gap.
- **2b** Derive ECGDex's per-epoch feature vector (LF/HF, RMSSD, motionIndex, resp, respCv) from NSRR ECG
  on records that also carry expert staging, and evaluate the shipped conjunction against *real* labels.
  That single number — real recall/precision for REM — has never existed and is the thing every staging
  decision has been guessing at.
- **2c** Only then revisit a detector change, with the falsifiers demoted from primary evidence to
  sanity checks (they were only ever proxies for the labels).

**Caveat to carry:** NSRR is clinical PSG, not a consumer chest strap on a healthy sleeper at home. A
detector tuned on NSRR and deployed on H10 data inherits a domain shift, and §5's falsifiers remain the
only check that survives the move. Do not let a good NSRR number retire them.

## 3 · A positive finding worth not losing: the score is a STABILITY detector

§9's failure has a mechanism, and it constrains what a future REM feature may look like.
`z(LF/HF) − z(RMSSD) − z(motion)` selects the most physiologically **stable** epochs of the night — at
every threshold landing REM % in the physiological band, **zero** desaturations fell in selected epochs
across 41 nights. REM is the *least* stable stage. So a REM feature must be **arousal-linked or
irregularity-linked**, and any candidate built from stability proxies is a priori pointing the wrong way.

`respCv` was the right *kind* of feature by this argument (irregularity) and still failed — which is why
§2's label, not a fourth feature, is the next move.

## 4 · Smaller things surfaced

- **The desat ratio degenerates outside plausible prevalence.** Parent §8.3: a cross-signal falsifier only
  tests the label while the label is near its plausible rate; at 68 % REM it becomes a statement about
  which epochs were left over. Any future use of it must report prevalence alongside the ratio.
- **`respCv` stays computed and unconsumed.** Measured, not assumed, with the table in parent §8.2 as the
  standing reason not to wire it. It costs nothing to keep.
- **A checklist can outlive its own refutation.** Parent §6 listed the score as "the sole remaining
  blocker" for three days after §8 had undercut it; the boxes are now retired in place. When a later
  section kills an earlier plan, reconcile the Done-when in the same edit.

## 5 · Done when

- [ ] **2a** — NSRR adapter's stage-annotation capability established (ingests labels, or the gap named).
- [ ] **2b** — the shipped conjunction scored against **real** PSG labels; REM recall/precision recorded.
- [ ] **2c** — a detector change proposed only after 2b, or the stage explicitly declared not recoverable
      from single-lead ECG + chest ACC, which is also a publishable answer.
- [ ] §1's constraint (no staging validation on `genSynthetic`) recorded where a future contributor will
      hit it — the parent brief and the generator's own docs, not only here.
