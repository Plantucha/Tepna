<!--
  PAPERS-ROADMAP-2026-06-24-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-06-24

# Papers roadmap — forward agenda + new-deliverable potential

> **Scope split (read this first).** This brief is the **forward agenda**: what to write *next* and the
> **new** papers the current + planned stack unlocks. It does **not** restate per-paper triage — that
> lives in [`papers/PAPERS-AUDIT.md`](papers/PAPERS-AUDIT.md) (the v1.0→v1.7 generator re-run status of
> the 12 existing preprints) and the RESOLVED/FIXED ledger in [`papers/papers.html`](papers/papers.html).
> When a candidate here graduates to a draft, add it to `papers.html` (keep the section structure +
> honest sim/real/perspective labelling the footer mandates) and, if it needs generator re-runs, track
> the numbers in `PAPERS-AUDIT.md`. Living agenda — flip individual candidates to `DONE` in the table as
> they ship; do not rename the file.

---

## 0 · The strategic gap this roadmap closes

The existing series is strong but **lopsided toward simulation**. Of 12 preprints, only **two carry a
real-data arm** — `sigma-no-reference` (real devices, the three-cornered hat) and the 5-night pilot in
`odi4-ahi-bias`; everything else is *synthetic ground truth scored by the real detectors*. That was the
right move (it let the suite assert recovery, reliability, equivalence, and robustness deterministically
without a sleep lab), and the honest sim-vs-real labelling is a credit to the series.

But it means the suite's **single biggest unwritten story is real-world validation** — and the planned
stack is precisely the machinery that produces it:

- the **vendor-adapter layer + multi-vendor unifier** (`SIGNAL-ADAPTER-AND-FRONTIER-2026-06-23-BRIEF.md`)
  turns "one device per signal" into "many co-recorded vendors per signal" → real cross-device agreement
  at scale, reference-free;
- **OverDex** (same brief, Phase 10) auto-detects every co-recording in a personal archive → longitudinal
  reference-free error tracking with no manual pairing;
- **EEGDex** (Muse) introduces the suite's **first near-PSG sleep-stage anchor** → the closest thing to
  ground truth the system can get without a lab;
- **UltrahumanDex / SpiroDex** add real metabolic-autonomic and pulmonary arms.

So the agenda has two halves: **(A)** finish the in-flight re-run/rewrite work on the 12 (owned by
`PAPERS-AUDIT.md`), and **(B)** open the real-validation front the new stack makes possible — the bulk
of this brief.

---

## 1 · In-flight (owned by PAPERS-AUDIT.md — summarized, not duplicated)

Per `PAPERS-AUDIT.md`: every **simulation** paper must be re-run at 20k on the current generator (now
**v1.7**) and rewritten to journal style (effect sizes + 95% CI + exact p in Results; the synthetic
hedge moved into Limitations prose). Real-data papers (`sigma-no-reference`, the `odi4-ahi-bias` real
arm) and the `synthetic-data-frontier` perspective need only an error/style audit. **Do not start new
papers below at the expense of closing these** — a half-re-run series with stale pilot Ns is a bigger
credibility risk than an unwritten new idea. One concrete bug still open there: the
`processNight().odi4.rate` vs `.odi` API inconsistency between `treatment-response` and `nights-icc` —
reconcile against `oxydex-dsp.js` before either is finalized.

---

## 2 · New paper candidates — buildable on the CURRENT stack (no new node needed)

Ordered by value × readiness. Each: **claim · data class · needs · bounding limitation · effort.**

### 2.1 ✦ Timestamp-pathology benchmark — the methods note the series already teed up
- **Claim:** a deterministic, reproducible benchmark of consumer-export *timestamp* failure modes —
  the vendor format zoo (DMY/MDY ambiguity, zoned vs floating, 14-digit, time-only midnight-roll, epoch
  vs civil), and how the Clock Contract resolves each. The contribution is the **floating wall-clock
  `tMs` model** stated as a citable method, plus a pass/fail corpus.
- **Data class:** real vendor headers + synthetic edge cases. **Needs:** nothing new — the parsers exist
  today; the adapter layer (when it lands) only *widens* the corpus. **Bounding limitation:** it's a
  methods/reproducibility note, not a physiological result. **Effort:** LOW — `synthetic-data-frontier`
  **explicitly names this as "the narrowest first paper,"** and the corpus is mostly already in the
  `parseTimestamp` test cases. This is the cheapest real win on the board.

### 2.2 ✦ The dead-ends paper — negative results as a first-class deliverable
- **Claim:** a structured account of what **doesn't** survive scrutiny in consumer-sensor analysis, with
  the evidence for each failure: optical PRV is *not* interchangeable with RR/ECG HRV (+32% bias,
  `rmssd-equivalence`); the Welltory wellness composites collapse to driver effects under partialling
  (and emit a fake `0` when their black-box inputs are absent — see the adapter brief §8 item 2); daily
  CGM-CV has ICC≈0 (a state, not a trait, `nights-icc`); SQI stays green while beat-yield fails under
  apnea (`qrs-yield`); the rolling-mean ODI self-suppression (`odi4-ahi-bias`). A public "map of the
  walls in the maze" — exactly the project manifesto, made into a citable artifact.
- **Data class:** mixed (re-uses already-published runs). **Needs:** current stack only. **Bounding
  limitation:** synthesis paper — its novelty is framing + honesty, not new compute. **Effort:** LOW–MED
  (mostly writing). Pairs with the adapter brief's "machine-readable graveyard registry" idea so the
  paper and the registry share a source.

### 2.3 Cross-signal plausibility as automated QC — the forward-model methods paper
- **Claim:** encode the physiological coupling laws the Integrator already hints at (apnea→desat→HR
  surge; exertion→HRV drop; glucose↔HRV shared-driver) as a small **forward model**, then run it
  *backward* as a consistency check: a cross-signal combination the body can't produce flags an
  **artifact or a mis-routed/mis-labeled file**. Demonstrates automated QC that no single-signal SQI or
  filename sniffer can do.
- **Data class:** synthetic (planted artifacts/mislabels) + real spot checks. **Needs:** current stack
  (Integrator already encodes one coupling); generalizes the metamorphic-testing direction in the
  adapter brief. **Bounding limitation:** the coupling model is necessarily coarse — frame as screening,
  not diagnosis. **Effort:** MED. This is also the intelligence layer OverDex wants, so the paper and
  the feature reinforce each other.

### 2.4 ✦✦ CPAP flow as a home reference standard — the one that closes §0 <span title="drafted">[DRAFTED]</span>
- **Claim:** the reference-standard problem the whole series has been working around is *already solved
  in the bedroom*. A ResMed CPAP writes a calibrated **25 Hz flow** channel (`BRP` `Flow.40ms`) plus
  AASM-typed scored events (`EVE`) to its SD card every night. The paper is the recipe for promoting
  that to a working reference: breath detection from flow; **validating the reference before scoring
  anything against it** (two independent flow-derived estimators agree to **MAE 0.70 brpm** — the floor);
  and recovering the wearable↔CPAP clock relationship, which is neither known nor stable (**≈39 min
  offset**, recovered to a **±4 s** correlation peak, **drifting +0.589 s/day**, residual SD 1.03 s over
  37 days). Headline methodological result: **drift-consistency beats correlation magnitude as the
  validity test** — a correlation gate discards good nights, non-randomly, biased toward the hardest ones.
- **Data class:** REAL (n-of-1 methods; 26 nights / 172 h). **Needs:** current stack only.
  **Bounding limitation:** one subject, one machine, one mask — the 0.70 brpm floor must be re-derived
  per setup, not quoted; and therapy alters the physiology, so it is a reference for *algorithm
  agreement*, not for untreated breathing. **Effort:** LOW–MED (analysis exists; §4 port is the work).
  **Why first:** its contribution is device- and algorithm-agnostic, so unlike 2.5 it does not inherit
  the single-posture limitation. Draft: `papers/cpap-flow-reference.html`.

### 2.5 ✦ Respiratory rate from the H10 accelerometer — the MotionDex real-data arm <span title="drafted">[DRAFTED]</span>
- **Claim:** the H10 accelerometer, already worn for ECG, yields overnight respiratory rate at no extra
  hardware cost. MAE **1.01 brpm** (95% CI 0.91–1.12), **91.6%** within 2 brpm over 19,193 epochs;
  **0.56** at 70% coverage, i.e. at the reference's noise floor. Two gaps in the literature: the H10 ACC
  has apparently never been evaluated for respiration (all H10 work is HR/HRV), and no published
  chest-accelerometer study recorded *treated* nights. Method is spectral ridge tracking by Viterbi with
  a time-domain blend and honest abstention; 0.17 s/night in dependency-free ES5.
- **Data class:** REAL (n-of-1; 26 nights). **Needs:** current stack + the §2 estimator landed in
  `motiondex-dsp.js`. **Bounding limitation:** ⚠ **posture robustness is untested and this is the
  dominant limit** — gravity-roll IQR is 13.1°–17.9°, i.e. one posture, so Doheny's supine-vs-lateral
  1.54× could not be replicated (measured 1.02×) *by absence of exposure*. Also single subject, and the
  bias constant is subject-fitted (applied leave-one-night-out). **Effort:** LOW (drafted).
  Draft: `papers/acc-respiratory-rate.html`.

### 2.6 Effort does not type apneas under CPAP — a negative result <span title="parked">[PARKED]</span>
- **Claim:** accelerometer effort amplitude does not separate central from obstructive apnea on treated
  nights. Central events sit at **0.99×** their own night baseline — not absent, normal; only 16.5% fall
  below half baseline where a single RIP belt achieves 84%. Best AUC **0.691** (p=0.0002). Independent
  methodological finding: including the event **termination** destroys the effect (AUC 0.573), because
  the terminating arousal injects motion where effort should look absent.
- **Data class:** REAL (n-of-1; 22 nights, 401 events), negative result — belongs with §2.2's
  "walls in the maze" framing. **Bounding limitation:** the CPAP-pressure mechanism is **hypothesised,
  not tested**; if confirmed it narrows the claim to "under therapy". Obstructive n=31; labels are the
  manufacturer's algorithm, not PSG; and an adversarial literature review surfaced a prior report whose
  direction may run *opposite*. **Status: PARKED** until the `MaskPress.2s` test resolves the mechanism —
  do not ship as-is. Draft: `papers/effort-typing-null.html`.

---

## 3 · New paper candidates — unlocked by the PLANNED stack

These are the real-validation front. Each names the **stack dependency** so sequencing is explicit.

### 3.1 ✦✦ Real-data multi-vendor HRV agreement — the adapter-layer flagship
- **Claim:** the **real-world sequel to `rmssd-equivalence`**. That paper proved ECG≡RR≠optical *in
  simulation*; the adapter layer + multi-vendor unifier lets you pool **real co-recorded consumer
  devices across vendors** (Polar H10/Verity, Coospo, Wahoo, Garmin…) and ask whether they agree on
  rMSSD/SDNN — reference-free, via the three-cornered hat from `sigma-no-reference`. Most published HRV
  agreement studies compare *two* devices against one "truth"; a **reference-free hat across N consumer
  vendors** is genuinely rare.
- **Data class:** REAL. **Needs:** adapter layer **Phase 1** (the multi-vendor ingest) + physical
  co-recordings. **Bounding limitation:** how many devices you can co-wear, and motion-regime coverage
  (the σ paper already shows resting sessions strip shared HRV — needs a dynamic session). **Effort:**
  MED once Phase 1 lands; this is the single most publishable thing the adapter layer produces.

### 3.2 ✦✦ EEG-anchored validation of cardiorespiratory sleep proxies — the closest thing to ground truth
- **Claim:** once EEGDex (Muse) lands, EEG provides a **near-PSG sleep-stage reference**. Ask: how well
  do the suite's cardiorespiratory proxies (ODI from OxyDex, HRV from PulseDex, movement) recover
  **EEG-defined sleep architecture** (wake/light/deep/REM)? This is the cross-node-coherence family
  (`cgm-hrv-coupling`, `treatment-response`) but with a modality that is *closer to clinical truth* —
  it upgrades the whole suite's epistemic standing from "synthetic ground truth" toward "validated
  against a consumer EEG anchor."
- **Data class:** REAL co-recorded. **Needs:** **EEGDex** (planned node — note the adapter brief flags
  EEG as a *new signal type* still needing real DSP, not just ingest). **Bounding limitation:** Muse is
  consumer EEG, not lab PSG — anchor, not gold standard; state it. **Effort:** HIGH (new node + study),
  but the highest scientific payoff on the roadmap.

### 3.3 ✦ Longitudinal reference-free σ drift — OverDex-enabled metrology
- **Claim:** `sigma-no-reference` pinned device σ from one ~2-hour hat. OverDex auto-detects **every**
  co-recording in a personal archive → track each device's reference-free σ **over months**. "Does a
  consumer sensor's error drift with use/firmware/wear, and can you catch it with no reference?" The
  metrology twin of a longitudinal reliability study; `sensor-trio-nights` already did the power
  analysis for how many windows it takes.
- **Data class:** REAL longitudinal. **Needs:** **OverDex** (adapter brief Phase 10) for automatic
  pairing; the three-cornered-hat kernel already exists. **Bounding limitation:** needs sustained
  multi-device wear over time (single-subject n-of-1 at first). **Effort:** MED (mostly data
  accumulation once OverDex exists).

### 3.4 Real-data metabolic-autonomic coupling — UltrahumanDex sequel to cgm-hrv-coupling
- **Claim:** `cgm-hrv-coupling` recovered the glucose↔HRV shared-driver effect *synthetically*.
  UltrahumanDex (CGM + HRV in one ecosystem) feeding GlucoDex + PulseDex lets you attempt the **real**
  coupling on co-worn data — the first real-data test of a cross-node finding the simulation predicted.
- **Data class:** REAL (n-limited). **Needs:** **UltrahumanDex** (planned) + the GlucoDex hypo
  disambiguation already shipped (`GLUCODEX-HYPO-DISAMBIG-BRIEF.md`). **Bounding limitation:** small-n
  real cohort; report as confirmatory pilot, not population estimate. **Effort:** MED post-node.

### 3.5 Consumer spirometry repeatability — SpiroDex single-node methods paper
- **Claim:** implement the ATS/ERS spirometry **acceptability + repeatability** criteria locally and
  report test-retest on consumer flow-volume data — the pulmonary analogue of `nights-icc`. A clean,
  self-contained single-node methods contribution.
- **Data class:** REAL. **Needs:** **SpiroDex** (planned — another *new signal type* needing real DSP).
  **Bounding limitation:** consumer spirometer accuracy ceiling; niche audience. **Effort:** MED–HIGH
  (new node).

### 3.6 OverDex: opportunistic multi-signal fusion on a real personal archive — the architecture demo
- **Claim:** an end-to-end demonstration paper — point OverDex at one real, messy, nested folder of
  mixed multi-vendor exports and show the whole pipeline (route → run → fuse) recovers a coherent
  multi-signal picture of a real person's physiology, with provenance traceable to each source file.
  The capstone that proves the architecture, not a single metric.
- **Data class:** REAL (n-of-1 / small). **Needs:** **OverDex** (Phase 10) + several migrated nodes.
  **Bounding limitation:** demonstration, not a powered study — frame as a systems/repro paper.
  **Effort:** MED once OverDex + a few Phase-9 migrations exist.

---

## 4 · Sequencing & dependency map

| Candidate | Data | Stack dependency | Effort | When |
|---|---|---|---|---|
| 2.1 Timestamp-pathology benchmark | real+synth | **none (now)** | LOW | ✅ **DONE 2026-07-08** — `timestamp-pathology.html` (+ live tool) |
| 2.2 Dead-ends / negative results | mixed | **none (now)** | LOW–MED | ✅ **DONE 2026-07-08** — `dead-ends.html` |
| 2.3 Cross-signal plausibility QC | synth+real | current stack | MED | now / alongside adapter metamorphic tests |
| 3.1 Multi-vendor HRV agreement (real) | REAL | adapter **Phase 1** | MED | after adapter spine — flagship |
| 3.3 Longitudinal σ drift | REAL | **OverDex** (Phase 10) | MED | after OverDex |
| 3.2 EEG-anchored sleep validation | REAL | **EEGDex** | HIGH | after EEGDex — highest payoff |
| 3.4 Real metabolic-autonomic coupling | REAL | **UltrahumanDex** | MED | after UltrahumanDex |
| 3.6 OverDex archive-fusion demo | REAL | **OverDex** + migrations | MED | capstone |
| 3.5 Spirometry repeatability | REAL | **SpiroDex** | MED–HIGH | after SpiroDex |

**Recommended order:** **2.1 → 2.2** (cheap, now, both pure writing/repro on the existing harness) →
**2.3** in step with the adapter brief's metamorphic-testing phase → **3.1** the moment adapter Phase 1
lands (the flagship real-data result) → then the node-gated papers as each planned node ships, with
**3.2 (EEG)** the scientific priority among them.

---

## 5 · Conventions every new paper must honor (from `papers.html` footer + house rules)

1. **Honest data labelling is mandatory** — tag every paper `simulation` / `real-detector` / `real-data`
   / `perspective`, and state the limitation that bounds the claim (in Limitations prose, not bolded
   inline, per the journal-style audit).
2. **Deterministic regeneration** — each paper regenerates its tables + figures from a **named, local**
   analysis tool (`*-analysis.html` / a worker pool), cited in the paper. No number without a tool that
   reproduces it. Analysis tools are **unbundled** → they touch **neither gate** (build freely).
3. **Section structure** — Abstract · Introduction · Methods · Results · Discussion+Limitations ·
   Reproducibility · References; standardized via `paper.css`.
4. **Report N, estimate, 95% CI, exact p, effect size** consistently; report against a control/null
   distribution where detection is claimed (the `treatment-response` step-R²-under-null lesson).
5. **SPDX header + Apache-2.0 + Michal Planicka**; "not a medical device" disclaimer on every surface.
6. **Generator version is part of provenance** — state it (currently **v1.7**); a generator change
   re-stales every derived number (the whole reason `PAPERS-AUDIT.md` exists).

---

## 6 · Done criteria (this brief)

This is a **living agenda**, not a one-shot execution. It is "done for now" when: (a) the in-flight
re-run/rewrite work in `PAPERS-AUDIT.md` is closed or explicitly parked, and (b) the two **now**
candidates (2.1 timestamp-pathology, 2.2 dead-ends) are either drafted into `papers.html` or logged as
deliberately deferred. **Progress (2026-07-08): BOTH "now" candidates SHIPPED** — 2.1
`timestamp-pathology.html` (+ live tool, 24/24 corpus + 6/6 invariants) and 2.2 `dead-ends.html`
(six-wall negative-results synthesis); plus the real-data `ppg-ecg-hrv-validation.html`, which fulfills
the §0 real-data-arm gap ahead of schedule. **Criterion (b) is met.** **Criterion (a) is also met
(reconciled 2026-07-08):** the `PAPERS-AUDIT.md` re-run/rewrite backlog is closed — every STALE-v1.0
simulation paper was re-run to synth-gen 2.1 / cohort-gen 1.9 (robustness-benchmark at 20k on gen v1.7),
the flagged `processNight().odi4.rate` API bug is fixed, and the one residual (odi4-ahi-bias's v1.6 synth
power table, superseded by robustness-benchmark's 20k v1.7 severity table) is explicitly parked. **So the
brief is "done for now."** The only now-buildable candidate left is 2.3 (cross-signal plausibility QC,
MED effort); the node-gated 3.1–3.6 stay PROPOSED until their stack
dependency lands. Each new candidate that ships flips its own row to DONE in §4 and gets a full
entry in `papers.html`. Node-gated candidates (3.1–3.6) stay PROPOSED until their stack dependency
lands — do **not** mark them blocked-and-forgotten; revisit when the relevant node/Phase ships. After a
batch of candidates ships, spawn `PAPERS-ROADMAP-FOLLOWUPS-<YYYY-MM-DD>-BRIEF.md` if new findings
surfaced (house pattern), else note "no follow-up" here.
