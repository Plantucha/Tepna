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
| 2.1 Timestamp-pathology benchmark | real+synth | **none (now)** | LOW | now — cheapest win, already teed up |
| 2.2 Dead-ends / negative results | mixed | **none (now)** | LOW–MED | now — mostly writing |
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
deliberately deferred. Each new candidate that ships flips its own row to DONE in §4 and gets a full
entry in `papers.html`. Node-gated candidates (3.1–3.6) stay PROPOSED until their stack dependency
lands — do **not** mark them blocked-and-forgotten; revisit when the relevant node/Phase ships. After a
batch of candidates ships, spawn `PAPERS-ROADMAP-FOLLOWUPS-<YYYY-MM-DD>-BRIEF.md` if new findings
surfaced (house pattern), else note "no follow-up" here.
