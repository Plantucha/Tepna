<!--
  MOTIONDEX-RESPIRATORY-RATE-2026-07-21-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS · **Created:** 2026-07-21

# MotionDex respiratory rate — rebuild the estimator, and the three papers it unlocks

> **Scope.** Two things, deliberately coupled. **(A)** Replace
> `motiondex-dsp.js:respiratoryEffort()` — measured at MAE 3.59 brpm against a real CPAP-flow
> reference, i.e. *worse than predicting a constant*. **(B)** Land the three preprints the
> validation corpus produces, which close the `PAPERS-ROADMAP` §0 gap ("the single biggest
> unwritten story is real-world validation"). The paper drafts exist
> (`papers/cpap-flow-reference.html`, `papers/acc-respiratory-rate.html`,
> `papers/effort-typing-null.html`) and are **NOT submittable** until §4 below is done.

---

## 0 · What was measured, and against what

A validation corpus was assembled from `Ecg nightly/`: **26 nights, 172 h** of Polar H10 chest
accelerometer, each with a time-aligned ResMed CPAP recording. **19,193 scored 30 s epochs.**

**Reference standard:** `*_BRP.edf` `Flow.40ms` @ 25 Hz → breath-by-breath inspiratory onsets.
Its own noise floor was established first, before any algorithm was scored: two independent
flow-derived estimators (median-breath-period vs breath-count) agree to **MAE ≈ 0.70 brpm**.
Nothing below can be better than that, and any claim that appears to be is an artifact.

Secondary references: `*_PLD.edf` `RespRate.2s` (ResMed's own RR — heavily smoothed, r = 0.05–0.43
against raw flow at 60 s, so **not** used as primary) and `*_EVE.edf` (AASM-scored events).

| Estimator | MAE (brpm) | ≤2 brpm | r |
|---|---|---|---|
| **Shipped `respiratoryEffort()`** | **3.59** | 47.6% | +0.06 |
| Constant = corpus median (null) | 1.50 | 80.7% | — |
| **Proposed** | **1.01** [0.91, 1.12] | **91.6%** [90.2, 92.7] | +0.37 |
| Proposed @ 85% coverage | 0.73 [0.67, 0.81] | 95.5% | +0.49 |
| Proposed @ 70% coverage | 0.56 [0.52, 0.61] | 97.8% | +0.61 |
| *Reference channel self-noise* | *≈0.70* | — | — |

95% CIs are night-level bootstrap (4,000 resamples, n = 26 nights).

---

## 1 · Why the shipped estimator fails

Full diagnosis in the findings write-up; the three that dominate:

1. **The band-pass is not a band-pass.** `x − MA(10 s)` then `MA(1.5 s)` is a difference of
   boxcars — a sinc in frequency, with poor stopband and sign-inverting sidelobes. Independently
   derived by three verification agents: **peak gain at 0.137 Hz (8.2 brpm), −3 dB band
   ≈ 0.077–0.235 Hz, 11.9 dB in-band tilt, −10.8 dB at 0.5 Hz.** The subject's true RR is
   ~16 brpm = 0.267 Hz — *outside the passband*. Measured consequence: band peaks land at
   6.0–9.5 brpm while truth is 16.
2. **Whole-night max-variance axis selection picks drift, not respiration** (waveform r 0.13 vs
   0.36 for the best axis). ⚠️ The usual *posture-rotation* rationale is **not** demonstrable on
   this corpus — see §3.
3. **No quality gate** (`q = 1.0` always), so it cannot abstain. Abstention is the single largest
   accuracy lever available (see the coverage rows above).

---

## 2 · The replacement

Reference implementation validated at MAE 1.01; **0.17 s per night** in plain ES5 (~139,000×
realtime), no dependencies.

```
1. Resample to a uniform grid; anti-alias (6th-order Butterworth LP at 0.8·Nyquist) → 5 Hz.
   MEASURE the native rate per file (median inter-sample interval) — H10 ACC is ~25.3-25.4 Hz on
   49/50 nights but 202.9 Hz on 2026-06-06, and Verity runs ~25.8-25.9 Hz.
2. Three channels: band-passed acc X, Y, Z, 0.13-0.50 Hz, 4th-order Butterworth, zero-phase.
   Do NOT add a tilt-angle channel — provably redundant, §3.
3. Per 60 s window / 30 s hop, per channel: Hann-windowed periodogram zero-padded to 2048,
   resampled to a 0.10-0.60 Hz grid at 0.004 Hz, normalised to unit in-band power. SUM.
4. Soft spectral high-pass taper 1/(1+exp(-(f-0.16)/0.01)); renormalise.
5. Blend in a TIME-DOMAIN zero-crossing estimate as a Gaussian bump, weight 0.30, width 1.0 brpm.
6. VITERBI ridge track: maximise Σ log S[t,f] - (Δbrpm)²/(2σ²), σ = 1.2 brpm.
7. Confidence = spectral mass within ±1.4 brpm of the ridge. Emit null below the gate.
8. Bias constant +0.58 brpm — SUBJECT-FITTED, see §5.
```

Every parameter was chosen by measurement, not taste:

| Decision | Alternative | Result |
|---|---|---|
| Viterbi tracking | per-epoch peak-pick | MAE **1.18 vs 1.54** |
| σ = 1.2 brpm | 0.6 / 2.5 / 5.0 | 1.19 vs 1.20 / 1.23 / 1.35 |
| Spectral taper | none / whitening | **1.15** vs 1.20 / 1.26 |
| 3 acc channels | +tilt / +g-par / +\|acc\| | all within 0.01 MAE |
| Time-domain blend w=0.30 | spectral only | **1.08 → 1.02**; nested CV picks 0.30 every night |
| Sum across channels | amp/concentration/peak-weighted | all within 0.01 |

---

## 3 · Two findings that constrain what may be claimed

**(a) A tilt-angle channel is redundant.** For a DC-coupled chest accelerometer the band-passed raw
axis *already is* the gravity-reprojection signal scaled by g (a 1–3° respiratory tilt reprojects
17–52 mg; chest-wall translational acceleration at 0.2 Hz is sub-mg). Measured:
`corr(spectrum(acc-X), spectrum(tilt-1)) = +1.000`, and adding the tilt pair moved MAE by 0.01.
Three independent verification lenses reached the same conclusion analytically
(<1.2% deviation, −79 dB THD at 3°). **Do not implement an arcsin tilt channel.**

**(b) Posture barely varies in this corpus — so posture robustness is UNTESTED.** Gravity-vector
roll: **median 15.1°, IQR [13.1°, 17.9°], p5–p95 = 7.8°–23.2°**; 84.9% of windows in one band.
Doheny et al. 2020 (EMBC, n=11 PSG) report supine MAE 2.43 vs lateral 1.58 (1.54×, p<0.01);
measured here, worst-vs-best orientation is **1.02×**. That is a failure to replicate *by absence
of exposure*. **No posture-robustness claim may be made from this corpus, in code comments or in
the papers.**

---

## 4 · ⛔ Prerequisites before ANY paper ships

Per `PAPERS-ROADMAP` §5.2 — *"No number without a tool that reproduces it"*:

- [x] **Port the analysis harness to `resp-acc-analysis.html`** — **SATISFIED; this item was stale and
      it is NOT the blocker (verified 2026-08-03, §4a).** `resp-acc-analysis.js` (654 lines) landed in
      **this brief's own PR #347**, exports `RespAccAnalysis`, is wired into **both** test lanes with a
      known-answer group, and the page drives it (`folderInput` → `change` → `run()`). This brief's own
      §6 further records a regeneration *"driven headlessly against the tool's engine"* — i.e. the
      harness was not merely ported but used. **The real blocker is the FIGURES (§4a).**
- [ ] Figures regenerated by that tool into `papers/figures/` — **THE ACTUAL BLOCKING ITEM.** Measured
      2026-08-03: `papers/figures/` holds 27 figures and **none** belong to these three papers, and all
      three carry **zero `<img>` tags**. Nothing has ever been emitted or referenced.
- [ ] Honest data-label tag on each paper (`real-data`, n-of-1) — §5.1.
- [ ] Generator version stated — §5.6.
- [ ] Rows added to `papers/papers.html` and `papers/PAPERS-AUDIT.md`.

---

## 5 · Open questions

1. **The +0.58 brpm bias is subject-fitted.** Consistent on every night (−0.20 to −1.27), applied
   leave-one-night-out so the reported MAE is honest — but it is one subject. Re-derive before any
   second subject's data is scored. Ship it as a named, commented constant, never a bare literal.
2. **Why does the estimator read low at all?** Most likely the reference uses `60/median(period)`
   while the spectral peak is pulled down by residual low-frequency energy. Untested.
3. **Does the pipeline survive a mobile sleeper?** Unknown — see §3(b).
4. **Apnea typing** — see the separate finding; needs its own brief, not a rider here.

---

## 6 · Done when

**Part (A) — the estimator — LANDED 2026-07-21 in `7002778`.**

- [x] `motiondex-dsp.js` emits a per-epoch `rateSeries` with confidence, keeping the existing
      return shape back-compatible (added `rateSeries`/`rateEpochSec`/`rateCoverage`/
      `respRateMethod`/`rateBrpmLegacy`; every legacy field gate-asserted present).
- [x] `respRateMethod: 'acc-spectral-viterbi'` set so `integrator-dsp.js:2441` can attribute it.
- [x] Evidence tier **`emerging`** in `motiondex-registry.js`.
- [x] `tests/dex-tests.js`: synthetic known-answers at 10/15/20 brpm (±0.5); bias-is-opt-in;
      confidence-gate monotonicity; additive-export-shape back-compat.
- [x] **The adversarial twin** — DONE. `genSyntheticACC` gained additive `flipAtSec` /
      `pauseAtSec` / `pauseDurSec` options; the twin drives 11 min at 15 br/min with a 90 s
      breathing pause and a posture flip rotating gravity +Z → +Y. It gates the one property the
      corpus **cannot** supply (§3(b)): rate is recovered at 15.1 br/min on BOTH sides of the
      flip, where a fixed-axis estimator would lose the breath entirely. It also pins a **KNOWN
      LIMITATION** measured while building it — a pause *shorter* than the 60 s window does NOT
      trigger abstention (30 s-pause epochs carried mean confidence 0.488 vs 0.390 for clean
      ones), so a downstream apnea consumer must not treat the confidence gate as an apnea
      filter. Reproducible from committed CODE (deterministic seed), not a 900 KB blob.
- [x] Gates green on merged `main` **with the real corpus present**: 3,677 assertions, **0
      skipped** (the GATE-C equivalence legs actually ran); `build --check` clean (11 owned);
      GATE A 9/9; GATE B **25** fixtures reproducible; `tools/verify-fixtures.mjs` green
      (14 current, 0 stamped).
- [x] Changeset `changes/2026-07-21-motiondex-spectral-resp-rate.md` (`bump: minor`).

**Part (B) — the papers — NOT done. This is why the brief is IN-PROGRESS.**

- [x] **Port the harness to `resp-acc-analysis.html`** — DONE. Runs the *shipped*
      `MOTIONDSP.respiratoryRate`, so it measures production code, not a twin. Verified against
      the original harness on four nights: clock offsets within **8 s**, per-night MAE within
      **0.06 br/min**. The port surfaced three defects that would each have silently corrupted
      the clock lock, all now documented in-code: integer-decimation grid skew, double
      band-pass filtering, and — the subtle one — deriving the sample rate from the
      millisecond-quantised phone stamp instead of the Polar nanosecond counter (a 1.2% rate
      error → ~18 s of skew over a 25 min chunk → locks off by tens of minutes).
- [x] **Re-run the full 26-night corpus through the tool** — DONE. `resp-acc-analysis.js` driving
      the shipped estimator independently reproduces the external harness across all 26 nights:
      **MAE 1.005 vs 1.006** (95% CI 0.917–1.101 vs 0.912–1.115) and **within-2-brpm 91.7% vs
      91.6%**, on separately recovered clock alignments — agreement to 0.001 br/min and 0.1 pp.
      Reference self-noise regenerates at median **0.74** br/min over 26 nights (range 0.56–1.19).
      Per-night MAE median 0.88 (0.76–1.67). Papers now cite the tool's numbers.
      **Two corrections this surfaced**, both now in the papers: (a) the drift residual SD of
      1.03 s is **implementation-specific** — it came from a pre-cached exactly-25 Hz grid; the
      tool correlating from the raw stream reaches 6.87 s for the same slope, so a validity
      tolerance must be derived from the fitted residual (3σ), never hardcoded (a fixed 5 s gate
      rejected 15 of 26 good nights); (b) the tight-gate coverage figures were slightly optimistic
      — 0.61 rather than 0.56 at 70% coverage — because noisier locks blur epoch pairing.
- [x] **DONE 2026-08-04 — the page runs end to end, and there is now a tool that repeats it.**
      `tools/resp-acc-headless.mjs` drives `resp-acc-analysis.html` through its OWN UI under
      Playwright/chromium. Against 4 hardlink-staged real nights:

      ```
      ▸ STATUS  done — 2 night(s), 1,464 epochs
          ✓ …_20260610_211538_ACC.txt  7.12 h  lock=-4652s r=0.19
          ✓ …_20260611_173042_ACC.txt  0.85 h  lock=none
          ✓ …_20260615_215323_ACC.txt  7.43 h  lock=-2361s r=0.69
      ▸ refSummary  Median self-noise across nights: 0.74 br/min …
      ▸ 18 table row(s) rendered · 0 console error(s)
      ```

      So the ingest, the grouping, the FileReader and the table render all work on real data — the path
      that had never been run. Two behaviours worth recording because they look like bugs and are not:
      4 pairs staged but **3** grouped (the 20260614 ACC starts 08:31, so the pre-noon rule assigns it to
      the previous night's folder), and 3 grouped but **2** reported (the 0.85 h night takes no lock).

      ⚠ **A box-captured night contributes NOTHING, silently.** `groupFiles()` needs
      `_YYYYMMDD_HHMMSS_ACC.txt`; the capture host writes `_YYYYMMDDHHMMSS_ACC.txt` with no separator,
      so it never matches and the night is not skipped-with-a-reason, it is simply invisible. Only
      Polar-Sensor-Logger (phone) nights are analysable by this page today. Not fixed here — it is a
      capture-format question, not a paper-figure one — but the tool now prints how many ACC files
      name-match, so a zero is visible instead of silent.

      `Dex-Test-Suite.html?full` remains unrun in this work-unit.
- [~] Figures emitted into `papers/figures/` — **RE-SCOPED 2026-08-04: the blocker is not "run the
      tool", it is that THE TOOL HAS NO FIGURE LAYER.** `resp-acc-analysis.html` renders **tables only**
      — there is no `<canvas>` anywhere in the page and no export path, so no run of it, headless or
      manual, can emit a PNG. §4a's framing ("figures regenerated by that tool") presumes a capability
      that was never built. Emitting figures therefore needs a chart + PNG-export layer added to the
      page first, matching the `tool → papers/figures/*.png` pipeline the wiring doc describes; that is
      a feature, not a regeneration, and is deliberately not slipped into this work-unit.

      **→ THE FIGURE LAYER IS BUILT (2026-08-06) — see §10. The capability gap this item names is
      closed; what remains is a corpus run, which is the original §1 item and needs the files.**
- [ ] `papers/PAPERS-AUDIT.md` rows.
- [x] **`MaskPress.2s` test of the CPAP-pressure hypothesis** — DONE, and it **fails**. Effort
      during central apnea is *negatively* associated with concurrent mask pressure (Spearman
      ρ = −0.174, p = 0.0008, n = 367 events / 22 nights; low-pressure median ratio 1.12 vs 0.83
      at high pressure), the opposite of the prediction. The convenient narrowing of the typing
      claim to "under therapy" is therefore **not available**. Caveat that bounds it: pressure
      varied only across the delivered therapeutic range (4.14–11.08 cmH₂O), so this is a
      within-therapy dose–response test, not therapy-vs-no-therapy — a null here is much weaker
      evidence against the hypothesis than a positive would have been for it.
- [ ] Follow-up brief spawned per the house pattern, carrying the
      Integrator apnea-typing rule at `integrator-dsp.js:1205` — which this work-unit deliberately
      did **not** touch.


---

## §4a · PREMISE CHECK 2026-08-03 — the blocking item was stale, and it named the wrong blocker

§4 declared all three papers **"DRAFT, not submittable"** behind one item: *"port the analysis harness…
currently the numbers regenerate only from a Python harness outside the repo."* Verified against the tree:

| §4's claim | measured |
|---|---|
| harness not ported; numbers regenerate only from an external Python harness | **stale.** `resp-acc-analysis.js`, 654 lines, landed in **this brief's own PR #347** — `feat(motiondex): … + the analysis tool and three preprint drafts` |
| — | it exports `RespAccAnalysis` and is wired into **both** test lanes (`resp-acc clock/resample layer` known-answer group) |
| — | the page drives it end-to-end in code: `folderInput` → `change` → `run()` |
| — | **this brief's own §6** records a regeneration *"driven headlessly against the tool's engine"*, with corrections (a) and (b) that came out of it |

So the brief contradicted itself: §4 held three papers blocked on a port that a later section describes
as already built **and used**.

**What is actually blocking, measured:**

- `papers/figures/` holds **27** figures — `cgm-hrv-coupling`, `hrv-*`, `nights-icc-*` — and **none** from
  `cpap-flow-reference`, `acc-respiratory-rate` or `effort-typing-null`.
- All three papers carry **zero `<img>` tags**. No figure has ever been emitted *or referenced*.
- `papers/PAPERS-AUDIT.md` rows are still owed.

**What this check did NOT establish, stated plainly.** That the harness *exists, exports, is gated and is
wired to a UI path* is verified. That it **produces correct figures end to end** is not — that needs a
browser and the CPAP corpus, and it is the separate §6 item (*"exercise the browser page itself… the
folder-ingest / FileReader / render path is still unexercised"*), which remains open and unticked. The
port box is ticked because the port happened; the end-to-end box is not, because it has not.

**Why this matters beyond bookkeeping.** "DRAFT, not submittable" is a real hold, and it was resting on a
premise that its own brief had already superseded. The papers are still not submittable — but for the
figures, which is a different and much smaller job than a port.

---

## §10 · EXECUTED 2026-08-06 — the figure layer exists, and a whole capture route was invisible

Two items, both of which §4a had correctly diagnosed and neither of which it fixed. Together they are
the difference between "the papers are blocked on running a tool" and "the papers were blocked on a
capability that was never built, over a corpus that silently excluded half the fleet."

### 10.1 · The tool now has figures — and the defect that mattered was found by LOOKING at them

`resp-acc-analysis.html` rendered tables only: **zero `<canvas>` in the page**, no export path. Three
canvases now render on every run, with the data the tables already compute:

| figure | what it shows | export |
|---|---|---|
| **Bland–Altman** | agreement vs the CPAP-flow reference; bias and ±1.96 SD each direct-labelled | `acc-resp-bland-altman.png` |
| **Abstention curve** | MAE against coverage — what declining an epoch buys | `acc-resp-coverage.png` |
| **Per-night MAE** | sorted dots + a labelled median; the n-of-1 spread made visible | `acc-resp-per-night.png` |

plus **⤓ all three**, which stacks them into the single `acc-resp-figures.png` the papers embed — the
same shape `nights-icc-analysis.js` already uses, so `papers/figures/` stays one convention rather than
gaining a second.

**The arithmetic under the plot is gated, because it is published.** `RespAccAnalysis.blandAltman` is
pure and lives in the module both runners load (the app layer is loaded by neither), so the figure and
the agreement table cannot drift apart. Known answer, hand-checkable rather than recorded from the
implementation: diffs of {+2, 0, −2, +4, −4} give bias 0 and **sample** SD √10, so the limits are
±1.96·√10. Mutation-verified — switching to the population SD reds three assertions by value
(2.828 against 3.162). It also **refuses**: one pair has no SD, and returning ±0 would draw limits of
agreement that read as perfect agreement, which is §2.6's rule applied to a picture.

**What the screenshot caught that no validator could.** The first render clipped the right-hand
annotations — `−1.96 SD −3.32` came out as `−1.96 SD -3.3` against a fixed 96 px gutter — and the
coverage axis divided its range into fifths, so it read **45 % · 56 % · 68 % · 79 % · 91 % · 102 %**:
arithmetically correct and unreadable. Both are now fixed (the gutter is measured from the widest
label; the axis takes explicit deciles), and the reason they were found is that the figures were
*rendered and looked at* rather than reasoned about. A colour validator checks colour; only an eye
catches a clipped label.

### 10.2 · Every box-captured night was invisible, and the corpus never said so

§4a recorded this and left it: *"A box-captured night contributes NOTHING, silently … it is not
skipped-with-a-reason, it is simply invisible. Only Polar-Sensor-Logger (phone) nights are analysable
by this page today."* It is fixed.

`groupFiles` matched `_YYYYMMDD_HHMMSS_ACC.txt` only. The capture host writes the **same bytes** as
`_YYYYMMDDHHMMSS_ACC.txt` — one 14-digit run, no separator (CAPTURE-HOST-INTEGRATOR-FOLD §1) — and
`tools/trio-batch.mjs` has carried both as `RE_POLAR` / `RE_POLAR_CH` all along, so the fleet already
knew. The file passed the `Polar_H10 … _ACC.txt` filter and then fell out of the loop on a bare
`continue`: not counted, not logged, not skipped-with-a-reason.

**Why this is a scientific problem and not a cosmetic one.** Three papers rest on which nights this
apparatus can see. A name-shaped blind spot excludes an entire capture route from the corpus, and the
exclusion appears in no count, no log line, and no reported *n* — a drop of nothing but box nights
reported "no ACC+BRP night pairs found" and said nothing about why. That is the same shape as the
suite's standing warning: a check that runs and reports a clean result about something it never
examined.

The parser moved into `resp-acc-analysis.js` (both runners load it; the app layer neither) and is gated
both ways — the capture-host layout parses, the phone layout still parses, both resolve to the SAME
instant, and refusal still refuses (no stamp, a 13-digit run, a non-ACC stream, a null name).
Mutation-verified against the exact pre-fix regex: 2 assertions red, and the refusal assertions stay
green, so the gate is pointed at the widening and not at the parser generally. The caller now reports
`nAcc` / `unstamped` / `noFlow` with examples instead of a bare zero.

### 10.3 · What is still open, and what it needs

- **§1's corpus run is still the blocking item for the three preprints**, and it is unchanged by this
  work: it needs the ACC + CPAP files, which a checkout does not carry. What HAS changed is that a run
  can now emit the figures, and that it will see the box-captured nights it used to drop.
- **The figures are rendered from the run's own numbers, never from a stored copy** — there is no
  regeneration step to go stale, and none was added.
- **`papers/PAPERS-AUDIT.md` rows, the honest data-label tag, and the generator version** are untouched;
  they are paper-editorial items, not tool items.

---

## §11 · §1 IS RUN — 2026-08-06. The corpus was here all along, and the tool could not see any of it

§1 has been the stated blocker for three preprints since 2026-07-21, recorded as "run the 26-night
corpus end-to-end". It has now been run. What it took was not a run: it was §10's two fixes, plus three
more defects that only appeared once real bytes went through, plus a negative result about the
alignment instrument.

**Correcting this brief's own framing first:** §1 was repeatedly described as blocked on files. The
files were on the capture machine the whole time — **419 `Polar_H10_*_ACC.txt` and 254 `_BRP.edf`
across 204 CPAP nights** under `/home/michal/tepna-smoketest/captures`, and under this tool's own
pairing rule **every one of the 419 ACC files pairs with a CPAP night**. Nothing was missing. Nobody
had looked.

### 11.1 · The scale of §10.2's invisible-nights defect: it was the entire corpus

**All 419 ACC files are capture-host layout. Zero are phone layout.** So before the `sessionStamp`
fix, this apparatus could see **none** of the corpus it exists to analyse — 2.4 GB of paired data
reporting "no ACC+BRP night pairs found" with no explanation. §4a described this as a limitation
("only Polar-Sensor-Logger nights are analysable today"); measured, it was total.

### 11.2 · The run

21 real overnight ACC files (>30 MB) across 14 CPAP nights, 1.4 GB, driven through the shipped page
headlessly. 16 night-groups formed, ~54 s wall-clock.

| | value |
|---|---|
| nights scored | **7 of 16** — nine excluded, see §11.3 |
| epochs | 3,665 |
| **MAE** | **0.95 br/min** (95 % CI 0.79–1.18) |
| null baseline (constant = corpus median) | 1.42 |
| **reference self-noise floor** | **0.72** |
| within 2 br/min | 92.0 % · bias −0.42 · LoA ±4.59 |
| at 80 % coverage | MAE 0.73 · 95.3 % within 2 |

**State it as 0.95 against a 0.72 floor on 7 nights, never as 0.95.** The brief's Part (A) opened with
the estimator at MAE 3.59 — *worse than predicting a constant* — so the rebuild is clearly better than
the null, and it is also close to the noise of the reference it is measured against. n = 7 nights, one
wearer.

### 11.3 · Nine nights were being scored against noise, and the tool published the result

The CPAP clock is stable: on the seven nights that lock, the recovered offsets span **−2337 … −2333 s**
— a **9-second** spread — fitting a 0.773 s/day drift model with 4.63 s residual. The device runs a
steady ~38.9 min behind, exactly as `CPAP-CLOCK-42MIN` found.

What is not stable is `recoverOffset`. On the other nine nights it returned offsets from **−5163 s to
+4804 s** at peak |r| **0.16–0.20** — the argmax of a noise field over its ±90-minute search. And
`offsetUsed` fell through to that value, so those nine nights entered the pooled MAE **aligned against
unrelated breaths**. The tool's own drift check had already flagged every one of them "off-model"; the
code then ignored its own verdict. Removing them moves the headline 1.05 → 0.95, i.e. the contamination
was *hiding* the result, not creating it.

Fixed: no credible alignment ⇒ the night does not score, and says so.

### 11.4 · `fitClockOffsetPooled` — wired, reported, and deliberately NOT in charge

`integrator-dsp.js` marks the single-channel fit **DEPRECATED, superseded by `fitClockOffsetPooled`**
(POOLED-CLOCK-FIT-2026-07-31), and this page was still using the deprecated shape. It is now wired:
`_EVE.edf` ingest, anchors from the device's **own** apnea scoring, two responder channels off the
H10 (movement onsets, posture change), `integrator-dsp.js` + `kernel-constants.js` inlined (485 KB —
this was the *smallest* of the ten tools at 157 KB; peers run 620 KB–1.5 MB).

**And on this corpus it is underpowered, which is a result worth recording rather than a reason to
hide the wiring:**

- **2 of 16 nights** reach confidence (6 ambiguous, 8 not confident). The fit's premise is
  "individually weak, jointly decisive" — this page has ONE device and two thin channels, so there is
  nothing to pool.
- Both confident fits report **p = 0.032 = 1/(nullIters+1)** — exactly `pFloor`, the best p the run
  could return. `integrator-dsp.js` publishes `pFloor` precisely so this is not read as strength.
- On the one head-to-head night (`20260727221616`) the two disagree by **81 s**: pooled −2255 s against
  correlation −2336 s, where the drift model fitted on six *other* nights predicts −2332.4 s. The
  correlation is 3.6 s from that model; the pooled fit is 77 s away — outside its own ~15 s support at
  `matchSec 30`.
- Letting it decide moved the headline the wrong way: **0.95 → 1.01**.

**Policy landed:** the pooled fit never overrides a drift-consistent correlation lock. It is used only
where the correlation has no credible lock at all, and then only if not underpowered and not
floor-pinned. Both numbers print on every night, so a disagreement is visible rather than resolved
silently. The wiring stays: the better instrument is now present, exercised on real data, and its
limits here are measured instead of assumed.

### 11.5 · Three defects only real data could surface, all in the figures

§10 shipped the figure layer against synthetic data. Real bytes broke it three ways, each caught by
rendering and *looking*, none reachable by reading the code:

1. **Out-of-range points were CLAMPED onto the axis**, drawing a solid row of dots along the bottom
   edge — a cluster of extreme disagreements that does not exist. Now dropped and **counted**
   ("59 point(s) beyond ±6.8 br/min not shown"): a value we cannot show is declared, not invented.
2. **That count then collided with the y-axis tick** ("59 po**6.8**int(s)"). Moved clear.
3. (§10 already records the clipped annotations and the 45 %/56 %/68 % axis.)

**One feature in the figure is real and should stay:** the diagonal striping in the point cloud is the
spectral ridge emitting quantized br/min, so `pred − ref` against the pair mean falls on diagonal
bands. A reviewer will ask; better that the figure shows it.

### 11.6 · Still open

- **`papers/figures/*.png` are not committed by this pass.** The tool now emits them and they have been
  rendered from the real corpus, but which figures each preprint embeds — and the DRAFT-banner clearing
  §4a asks for — is paper-editorial work, not tool work.
- **The corpus can be much larger.** This run used 21 files >30 MB; **419 pair in total.** The limit was
  browser memory in one pass, not availability.
- **`papers/PAPERS-AUDIT.md` rows, the honest data-label tag, and the generator version** remain open.

### 11.7 · ⚠ OPEN AND UNEXPLAINED — the estimator cannot report ~40 % of the rate axis

Spotted by the owner in the Bland–Altman figure: the point cloud is striped, and the **empty** diagonals
are the signal. In this plot a line of constant `pred` has slope −2, so a blank diagonal is a rate the
estimator never emits. Counted by eye: ~10 of them.

**Measured over the 3,738 pooled pairs (138 unique predicted values, 10.99–21.27 br/min):**

```
gap anchors, ascending:  … 0.7, 0.5, 0.7, 0.5, 0.7, 0.5, 0.7, 0.5, 0.7, 0.5 …   (unbroken 11.9 → 17.9)
adjacent-pair sums:      1.200 on 13 of 15 pairs
```

**The exclusion is periodic at exactly 1.2 br/min**, alternating forbidden bands of 0.5 and 0.7 br/min.
Across the observed range that is ~10 bands — the owner's count.

**A first explanation was offered and is WITHDRAWN.** This was called "quantized FFT bins". It is not:
a grid test over the unique predicted values (mean distance to the nearest grid line; 0.25 = no
structure) rejects every candidate step —

| step | 1.0 | 0.5 | 0.4 | 0.3 | 0.25 | 0.2 | 0.1 | 0.05 | 1/3 | 1/60 Hz |
|---|---|---|---|---|---|---|---|---|---|---|
| score | **0.2500** | 0.2494 | 0.2890 | 0.2394 | 0.2648 | 0.2178 | 0.1713 | 0.2460 | 0.2459 | 0.2486 |

— with step 1.0 scoring exactly 0.2500, i.e. perfectly uniform. **There is no quantization lattice.**
So this is not a resolution limit; it is a *structured bias* in which rates the ridge tracker settles
on, which is a stranger finding than quantization and a worse one to leave undocumented.

**Mechanism unknown, and deliberately not guessed at a second time.** Two candidates worth testing, in
order: (1) whether the 1.2 br/min period survives WITHIN a single night, or only appears when seven
nights whose ACC rates differ (25.3–202.7 Hz across this corpus) are pooled and their grids interleave;
(2) whether it tracks the Viterbi transition-cost lattice rather than the spectrogram's frequency axis.

**This outranks the MAE for the papers.** A reviewer sees the stripes in the first second and will ask
what sets them; "the estimator cannot report ~40 % of the rate axis in a repeating pattern" has to be
answered before an agreement number carries meaning. It belongs above the headline, not in a
limitations paragraph.
