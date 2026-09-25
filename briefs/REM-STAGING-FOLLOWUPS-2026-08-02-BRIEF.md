<!--
  REM-STAGING-FOLLOWUPS-2026-08-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (re-verified 2026-09-25, Kestrel triage, docs only: unchanged since 09-21 — §2c is still the sole remainder and it is the owner's DECISION (propose a detector change, or declare REM not recoverable from single-lead ECG + chest ACC); no ruling recorded anywhere in the fleet's decision notes, so this brief is PARKED on the owner, not live; NO CHANGE. Previously re-verified 2026-09-21: §2b is EXECUTED — #2423, 99/99 records, REM recall 32 % median / precision 26 % — and was unstamped for nine days. The ONLY remainder is §2c, which is a DECISION the brief itself calls publishable — propose a detector change, or declare REM not recoverable from single-lead ECG + chest ACC — and is the owner's to make now that the number exists; no code is owed until it is made. Previously: NOT a code unit. ⚠ **The blocker CHANGED on 2026-09-02, it did not lift**: NSRR access was approved, so §2b is no longer blocked on *obtaining* records — it is now gated on the owner's condition that NSRR stays closed until the brief drain completes. Re-read this before assuming data-absence. Earlier verification 2026-08-31: §2a DONE 2026-08-03; §2b path BUILT+proven (`tools/nsrr-stage-validate.mjs`) and blocked on NSRR records under a signed DUA the suite cannot fetch — an owner lever, not code; §4 carries a standing don't-wire on `respCv`. Nothing to build until labeled records exist. ⚠ **SUPERSEDED IN PART 2026-09-04 (Osprey): THE RECORDS HAVE ARRIVED.** `/srv/data/shhs/polysomnography/` holds **99 EDF + 5136 annotation XML, all 99 ids paired** — so "nothing to build until labeled records exist" no longer describes the world, and neither does `PAPERS-ROADMAP` §3.2's *"revisit only if records ever arrive"*, whose trigger has fired. **What is still unmet is the OTHER condition in this same banner** — NSRR closed until the brief drain completes — measured **73 open briefs against a ≤20 target, 2026-09-04**. That is now the live gate and only the owner can lift it. Inventory, boundaries and pre-stated experiment bands: `SHHS-EXTERNAL-VALIDATION-2026-09-04-BRIEF.md`. ⚠ Note **PPG 0/99** there — §2b's staging arm is reachable, but nothing PPG-derived is. ⚠️ **SUPERSEDED AGAIN 2026-09-12 (Magpie): §2b IS EXECUTED, AND THE GATE IT NAMED IS GONE.** The drain condition recorded in this banner — NSRR closed until the brief drain completes — was still NOT met (52 open against ≤20, re-measured 2026-09-12) and was **superseded by the owner assigning the work directly**, which this banner said only the owner could do. §P5 was clarified the same day to gate PUBLICATION and not measurement. **Result: the shipped stager scores REM recall 32 % median, precision 26 %, over 99/99 SHHS1 records (#2423).** That is the number two staging efforts were short of and it now exists. ⚠️ Note the failure mode is NOT the one this brief assumes: the stager calls REM slightly MORE often than the experts do (16.3 % of epochs against 12.5 %), so it is a PLACEMENT failure, not the ~4× under-call recorded from consumer nights — a fix aimed at sensitivity would be aimed at the wrong thing. ⚠️ And `tools/nsrr-stage-validate.mjs`, described here as **BUILT+proven**, was built and NOT proven: it compared a stage object against a stage string, so REM recall was 0 BY CONSTRUCTION on every record it had ever seen. Its `--selftest` refuses to compute recall from synthetic input — correctly, per §1 — and that refusal is precisely why the defect survived unseen. ⊗ **THE DRAIN CONDITION IS CANCELLED — owner, 2026-09-12.** *"im canceling this condition now. proceed with it."* The owner's separate condition that **NSRR stays closed until the brief drain completes** is WITHDRAWN and is no longer a gate on anything. It was never met — 52 open against a ≤20 target at cancellation, down from the 73 recorded above — and the brief count is now irrelevant to NSRR work. **Do not re-derive it, do not re-measure the open-brief count as an NSRR precondition, and do not treat a high brief count as blocking this lane.** The only gate remaining on this work is `STRATEGIC-PRIORITIES` §P5, which covers **publication, not measurement** (owner ruling the same day).) · **Created:** 2026-08-02 · **Follows:** `REM-STAGING-REDESIGN-2026-07-28-BRIEF.md` (DONE — measured negative) · **Related:** `DEEP-STAGE-DESAT-CONFOUND` §9 · **Affects:** `nsrr-adapter.js`, `ecgdex-dsp.js`, `tests/dex-tests.js`

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

**Recorded outside this brief (§5's last box, 2026-08-03):** the constraint now heads
`REM-STAGING-REDESIGN-2026-07-28-BRIEF.md` as a standing ⛔ block, where anyone reading the parent
before proposing a third feature will hit it. It is **deliberately NOT written into `ecgdex-dsp.js`'s
`genSynthetic` itself** — that file is inlined into ECGDex, so a comment there moves `manifestHash`
AND `computeHash`, forcing a re-bundle plus a real-corpus `verify-fixtures` re-stamp to carry a
sentence. CLAUDE.md's inert-addition rule says such a change rides the next behavioral ECGDex
re-bundle rather than causing one; this is that deferral, named rather than skipped.

## 2 · What actually needs building: an NSRR-labelled validation path

`nsrr-adapter.js` already exists. The National Sleep Research Resource ships **PSG-scored** polysomnography
— 30 s epochs with expert stage labels — which is precisely the missing label. The work is:

- **2a** ✅ **EXECUTED 2026-08-03 — the answer is neither of the two this brief anticipated.** The labels
  are not absent, and the annotation files are not the gap: **`parseNsrrXml` was already walking every
  scored stage event and discarding the stage identity on the same line it read it.** The parser tested
  `STAGE_RE.test(concept) && !WAKE_RE.test(concept)` and, on a hit, did exactly two things —
  `sleepEpochs++` and `stageDurSec += durSec`. Every REM/N1/N2/N3 label in a PSG-scored NSRR record
  reached this code and was reduced to one scalar for total sleep time. The missing ground truth that
  has blocked two staging efforts was being parsed and thrown away.

  `parseNsrrXml` now additionally returns `stages[]` (scored blocks, file order), `epochs[]` (the 30 s
  grid indexed from recording start — the join key §2b needs: feature vector ↔ expert label by index),
  `stageCounts`, `nSleepEpochs`, `remFrac`, `hasStageLabels`. Every pre-existing field is byte-identical
  in shape, so `analyzeRecord` and `odi-bias-analysis.html` are unaffected.

  **A latent TST bug fell out of it.** Stage recognition keyed on the WORDS "stage"/"sleep"; NSRR's
  authoritative marker is the numeric code in `"<text>|<code>"` (0 Wake · 1–4 NREM · 5 REM · 6 Movement ·
  9 Unscored). A cohort writing a bare **`REM|5`** matched neither `STAGE_RE` nor `WAKE_RE`, so **REM fell
  out of total sleep time entirely** — shrinking the AHI denominator and inflating every AHI derived from
  it. Recognition is now code-first, text-fallback. `Stage 2 sleep|2` was never affected, which is exactly
  why the existing known-answer test could not see it.

  **Where the gate now runs.** `parseNsrrXml` needs `DOMParser`, so its whole known-answer block is
  **browser-lane only** — so the *Node* lane skips it. ⚠️ **That is not the same as "it does not run
  on a PR", and this sentence used to read that way.** `browser-gates.yml` runs `Dex-Test-Suite.html`
  under Playwright, and its relevance filter is a **denylist**: only `briefs/`, `audits/` and
  `changes/` are ignored, *everything else* triggers, and an empty diff runs rather than skips. So any
  PR touching `nsrr-adapter.js` or `tests/dex-tests.js` **does** run these assertions in CI. (Checked
  2026-08-27 against the workflow, not inferred from this line.) The two pure pieces (`stageOf`, the
  concept vocabulary; `stagesToEpochs`, the grid arithmetic) were therefore split out and are asserted in
  **both** lanes. 44 new assertions; three mutants confirm they bite (`5:'REM'`→`'N3'` kills 2, hole-fill
  kills 1, first-block-wins-on-overlap kills 1). The browser-only legs were run headless rather than
  shipped unrun: 5070 passing, 0 failing.

  **What 2b still needs is the records, and only the records.** ⚠️ **SUPERSEDED 2026-09-13 — the
  records are now on this machine; see the stamp below.** The paragraph is kept because its reasoning
  is still the right reading of the period it describes. No NSRR data was on this machine, and
  none could be fetched — NSRR/PhysioNet require a signed DUA and the suite is 100 % local by construction.
  2b is unblocked on code and blocked on a human dropping EDF+XML pairs in. That is a materially different
  status from "the annotation files are the gap".

  🔴 **NSRR DUA CANCELLED — owner, 2026-08-28.** No DUA will be pursued (a cancellation, not a
  deferral; revisit only if records are ever actually obtained). 2b's scoring path stays built and
  dormant — do not re-surface this as pending work, and do not re-argue the DUA's value; the
  decision was made with that value on the table.

  ✅ **THE REVISIT CONDITION FIRED — records were obtained 2026-09-13, and §2b HAS NOW BEEN RUN.**
  The cancellation above is unchanged and is not being re-argued: it names its own trigger ("revisit
  only if records are ever actually obtained"), and that trigger is met. The full SHHS1 cohort —
  **5136 records, EDF + expert-scored annotations, all paired** — is on local storage, and the
  scoring path this brief left "built and dormant" ran across every one of them.

  **The number §2b says has never existed now exists:**

  | | |
  |---|---|
  | REM recall vs expert PSG | **23.9 %** |
  | Wake · Light · Deep recall | 27.7 % · 56.5 % · 16.3 % |
  | Cohen's kappa (4-class, AASM collapse) | **0.0967 +/- 0.0031** |
  | n | 5134 records · 505 868 epochs |

  Pre-stated bands (`SHHS-EXTERNAL-VALIDATION-2026-09-04-BRIEF.md` §4 E1, published before the run):
  >=0.60 transfers · 0.40-0.60 partial · **<0.40 does not**. So the answer to §2b is **negative**, and
  the conjunction does not transfer to clinical PSG. Misalignment was tested and excluded rather than
  assumed — kappa recomputed over a window of lags scatters its peak instead of concentrating, and a
  planted shift IS caught by the same test, so the negative comes from an instrument shown to react.

  ⚠️ **§2c is therefore unblocked and its premise is inverted.** It reads "only then revisit a
  detector change, with the falsifiers demoted from primary evidence to sanity checks". The labels now
  exist and they say the shipped conjunction is near chance — so a detector change is no longer
  *optional refinement*, it is what the real labels call for. That is a materially different starting
  point from the one §2c anticipated, which assumed the labels would broadly confirm the falsifiers.

  ⚠️ **`DEEP-AUDIT-V` F8 is unblocked too, by the same records, and nobody has said so.** The block
  quote below already established that F8 needs these records and that §2a's parser delivers the
  respiratory events it wants. Both conditions now hold. F8 remains unrun; this is a status
  correction, not a claim that it is done.

  🔴 **What is NOT settled, and is the owner's:** whether §2b/§2c resume as active work. The
  cancellation was an owner decision taken with the value on the table; this stamp records only that
  its stated condition has fired and what the run found. It does not reopen the item.

  *(Aggregate figures only — per-record rows and NSRR record identifiers are excluded under the
  derived-artifact ruling in `SHHS-EXTERNAL-VALIDATION-2026-09-04-BRIEF.md` §5, owner 2026-09-13.)*
- **2b** Derive ECGDex's per-epoch feature vector (LF/HF, RMSSD, motionIndex, resp, respCv) from NSRR ECG
  on records that also carry expert staging, and evaluate the shipped conjunction against *real* labels.
  That single number — real recall/precision for REM — has never existed and is the thing every staging
  decision has been guessing at.
- **2c** Only then revisit a detector change, with the falsifiers demoted from primary evidence to
  sanity checks (they were only ever proxies for the labels).

> ### The DUA unblocks a SECOND brief, and nothing said so until 2026-08-15
>
> `DEEP-AUDIT-V` **F8** — whether the Integrator's event-coupling statistic survives events arriving in
> **bouts of 5–20 min** — is blocked on the same records, for the same reason, and neither brief named
> the other. The permutation p-value itself is measured correct (4.8 % FPR over 500 trials) and the
> hour-scale worry is refuted (6.0 % / 5.3 % vs a 6.0 % control); the **bout scale** carries a measured
> 36–53 % residual FPR that no local night can test. The committed CPAP night has **20 events — 13
> apnea, 7 hypopnea**: effective therapy, and far too few to exhibit or refute clustering.
>
> **§2a's work already covers it.** `nsrr-adapter.js` parses respiratory events as well as stages
> (`:228` — `HYPOP_RE` / `APNEA_RE` → `'hypopnea'` / `'apnea'`), so records fetched for 2b arrive
> carrying exactly what F8 needs. The cost of F8 after a DUA is a diagnostic, not an ingest pipeline.
>
> So the DUA is worth more than this brief alone argues. Weigh it against **two** briefs.

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

- [x] **2a** — **DONE 2026-08-03.** Established, and stronger than "labels or gap": the labels were being
      parsed and discarded. A per-epoch stage series is now emitted (+ a latent TST bug fixed), gated in
      both lanes, mutation-checked.
- [x] **2b** — the shipped conjunction scored against **real** PSG labels; REM recall/precision recorded. **EXECUTED 2026-09-12 (#2423), stamped 2026-09-21:** 99/99 SHHS1 records scored through `tools/nsrr-stage-validate.mjs` — **REM recall 32 % median, precision 26 %** — after #2423 found the instrument had compared a stage OBJECT to a stage STRING and reported 0 % on every record it had ever seen (the join fix carries 11 assertions). §P5: measured, not quotable outside the repo. This box read `[~]` for nine days after the number existed. The remainder of this item's text below is the history of the path and stays as written:
      **The PATH IS BUILT AND PROVEN as of 2026-08-04** — `tools/nsrr-stage-validate.mjs` drives
      EDF bytes → `CpapEdf.readEDF` → ECG channel → `ECGDSP.analyze` (Pan-Tompkins, 5-min epochs) →
      `ECGDSP.stageSleep` → join to the 30 s expert grid → REM recall/precision/confusion, and
      `--selftest` runs that whole chain on a synthesised EDF + profusion XML with no records needed.
      **Still blocked on records only**, and now literally so: the only variable left is the record.
      NSRR requires a signed DUA and the suite cannot fetch, so it needs a human to drop EDF +
      annotation-XML pairs in and run `--dir`.
      *(The tool refuses to print recall/precision from `--selftest` — see §1: a synthetic record scored
      by the detector's own assumptions is the circular oracle this brief bans. It proves the pipeline,
      never the detector.)*
- [ ] **2c** — a detector change proposed only after 2b, or the stage explicitly declared not recoverable
      from single-lead ECG + chest ACC, which is also a publishable answer.
- [x] §1's constraint (no staging validation on `genSynthetic`) recorded where a future contributor will
      hit it — **DONE 2026-08-03** as a standing ⛔ block heading the parent brief. Writing it into
      `ecgdex-dsp.js` itself is a NAMED deferral (see §2a): it would move `manifestHash`+`computeHash` and
      force a corpus re-verification to carry a comment, so it rides the next behavioral ECGDex re-bundle.
