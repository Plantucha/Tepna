<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** DONE — 2026-11-26 · **Created:** 2026-11-26

# Build Brief — the stage formula becomes EEGDex's only stager

The owner ordered this on 2026-11-25 at about 20:30 EST, with a screenshot of the EEGDex page. The
words: "remove old formula in eegdex and fully replace it with finch polynomial. also hypnogram, is
too wide for page". The screenshot shows REM 48.9 %, N1 0 %, wake 0 % and a sleep efficiency of
100 %, all from the band-power stager. The strip runs past the right edge of its card.

@kestrel assigned the unit to @magpie in board #8966, with nine rulings. The claim is
`eegdex-stage-default` in board #8977. `briefs/EEGDEX-STAGE-FORMULA-2026-11-24-BRIEF.md` built the
formula in three pull requests and stays DONE; this brief removes the ceiling that brief's §1 states.

## 1. What this changes

The band-power rule set goes. The polynomial of `tepna.stage-formula/1` scores every night, and the
page carries one built-in model. The reader needs no file, and a model file in the drop replaces the
built-in one for that night.

The four classes are the formula's own: `wake`, `light`, `deep` and `REM`. The node publishes
`lightPct` and `deepPct`, and `n1Pct`, `n2Pct` and `n3Pct` go. That removes a metric identity, so
the changeset bump is `major`.

## 2. Acceptance

- [x] `stageEpoch`, `TUNED`, `smoothHypnogram` and the five-arm `BLOCKS` rig are absent from
      `eegdex-dsp.js`, and the module header states the new ceiling.
- [x] The default model is `eeg-base-p2-lab-2026-11-17`, the one-pass base file. It is the only
      built-in model, and it carries a blind read (#7248).
- [x] The page inlines the model as data, through a JSON script tag that the build keeps.
- [x] `analyze` takes `opts.model` and `opts.stages`. The second seam lets a test feed the
      generator's own plan to the spindle and the slow-wave groups.
- [x] A night with no model and no stage series reports every epoch as absent, with a named reason.
- [x] Every epoch carries the posterior of the stage it names, so `conf` stops reading null.
- [x] The surface names the model id and the 16-character hash of the file that scored the night.
- [x] Each number from the staged series reads `experimental`. The three uncited thresholds stay
      named in words, and residue #5752 stays open.
- [x] The impulses read `stage_wake`, `stage_light`, `stage_deep` and `stage_rem`.
- [x] The spindle and the slow-wave blocks read `light` and `deep` as NREM.
- [x] The hypnogram fits its card at every page width, and the page body never scrolls sideways.
- [x] Every realm that COMPUTES a stage series loads the two stage modules: the page, the test suite
      in both lanes, `tools/regen-eegdex-goldens.mjs` and `tools/eegdex-selftest.mjs`. The sweep
      found two more names and neither is a realm: `tools/mutation-suite.mjs` holds the string
      `eegdex-dsp.js` inside its own self-test, and `tools/detector-change-advisory.mjs` holds a
      census of detector names. `tools/make-synthetic-eeg-edf.mjs` IS a realm and asks the engine
      for `genSynthetic` alone, which reads no model, so it loads no stage module and carries a
      comment naming the trap for the next caller.
- [x] The goldens and `computeHash` move, so `verify-fixtures.mjs` runs on the rig.

## 3. Measured before the cut

- 30 source call sites read `n1Pct`, `n2Pct` or `n3Pct`: 12 in the generated registry, 10 in
  `tests/dex-tests.js`, 10 in `eegdex-dsp.js` and 4 in `eegdex-render.js`. The count excludes the
  bundles, the served copies and OxyDex's own keys. **The 36 this section first stated was wrong.**
  It counted 6 reads in `tools/treatment-response-recut.mjs`, and all six are `within1Pct`, which
  the grep matched on the shared suffix. No consumer outside the node reads any of the three keys,
  so the contract break reaches no other node's code.
- Three realms load a stage module today: the EEGDex page, `Dex-Test-Suite.html` and
  `tests/run-tests.mjs`. Four more realms load the DSP and load no stage module.

## 4. What stays out

- The two-pass model as the default. It refuses an import under 160 epochs, so a short night would
  show no hypnogram at all.
- Both model files inlined, which costs 200 kB for one choice.
- A rename of `light` to `N2`, which claims a split nobody fitted.
- A second smoother. The formula reads 5-epoch and 21-epoch means already.

## 5. Measured during the build, and what it changes

**The agreement floor could not be re-pointed.** The 0.80 floor the suite held was pre-stated for the
band-power rule set, and that rule set took its thresholds from these very spectra, so the generator
held both roles at once: it trained that stager and it judged it. The fitted model was never shown this night and reads **0.795**
against the plan over **356 scored epochs** of the 3 h artefactual night, seed 11. Re-pointing an
0.80 floor at a different scorer, or lowering it to 0.79, is a threshold chosen after the
measurement, which §🧾 grades `UNKNOWN`. The suite now holds the TRIPWIRE instead: the fit must beat
the best constant answer on the same epochs, which is **0.615** here and is a property of the plan
rather than of the fit. A model collapsed onto one class cannot clear it.

**The fit recovers wake 0 of 12 times** on that night: it reads every epoch the plan calls wake as
sleep. The night plants only 12 wake epochs, so the finding is weak, and this brief holds it rather
than an assertion. It is the shape a reader should expect from a forehead-fitted model on authored
arithmetic, and it is one reason the registry grades every number from the series `experimental`.

**This unit retired the pre-stated N2 spindle-density band, and it invented no replacement.** The
clause asked for an N2 density inside [1.5, 6.0] a minute, which is the band the literature reports
for N2 in adults. The series has no N2 class: `light` is the fit's own name and it covers more
epochs than AASM N2 does, so a density over it is not the quantity that band describes. The measured
light density on the pre-stated 8 h night is **1.854 a minute over 630 light epochs**, and deep
reads **0.982 over 110**. What stands in the clause's place is the ORDERING, which the detector owes
whatever the band says: spindles concentrate in light sleep rather than deep. Recall **0.653** and
precision **0.992** over 969 planted spindles are unchanged clauses — they name no stage.

**A new refusal: the signal's own absence overrules a class.** The fit's only absence floor is the
SHARE of its 35 feature inputs it could measure, so a 23 ms dropout leaves an epoch well over that
floor and the fit answers a class over a discontinuity. The band-power engine refused such an epoch
through `epochBands`, and the owner's 2026-09-17 ruling is that a DISCONTINUITY refuses while
reduced coverage annotates. So `compute` asks the signal first, through a new
`epochDiscontinuity` helper. A hole, a whole absent epoch, a frozen line, an absent rate or a stub of
an epoch nulls the stage and names itself. `epochAbsence`'s own last answer `no-spectrum` stays out
of that set, because a healthy epoch answers it.

Measured: the 90 s Muse frame with one 23 ms seam
scores 2 of 3 epochs and names `partial-hole` on the third, where the fit alone scored all three. The band shares, the spindle detector and the slow-wave trend already dropped a holed epoch,
so a stage kept there would have been the one number on the page standing over a hole.

**The two test lanes feed the detectors the generator's own plan.** The spindle and the slow-wave
criteria judge DETECTORS, so the memoised pre-stated night scores through the `opts.stages` seam
rather than through the model. A model-staged series would fold the fit's errors into a density band
and a slope, and a red would no longer say which layer moved.
