<!--
  PAPERS-ROADMAP-2026-06-24-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** REFERENCE (living — the forward papers agenda; candidates flip to DONE in the tables as they ship) · **last-verified:** 2026-08-25 · **Created:** 2026-06-24 · **Residue:** 2026-09-02-papers-remedy-unavailable, 2026-09-02-papers-cohort-never-recorded

> **Agenda refreshed 2026-08-25** (owner-directed sweep; the papers.html index/page agreement fixes ship
> in the same change). What moved: **§2.3's and §3.1's adapter dependency is SATISFIED** — the adapter
> spine closed 2026-07-04 (`SIGNAL-ADAPTER-*` all DONE), so both now state their real remaining
> constraint (a champion; vendor-diverse co-recordings). **§2.6 gains a concrete unpark path** —
> comparator v1.1 (#1787) ships live `Press.40ms` at 25 Hz, 12× the rate of the `MaskPress.2s` test
> that parked it. **§2.7's CPAP arm hardened** — STR `deviceCsr` is cross-validated against CPAPDex
> periodic-breathing % (#1781). **New candidate §2.9** (vibration fiducial, measured 2026-08-24).
> **§2.8's σ-reproduction gate is UPDATED, not lifted:** sigma v2/v2.1 (2026-08-15) measured the
> window-length sensitivity, withdrew the corner-reorder reading as a small-sample effect, and showed
> the O2Ring corner reproducing window-matched — the **H10/Verity per-corner pipeline reconciliation is
> still owed**, and §2.8 stays gated on it (plus the §2.2 hardware block). The two standing update
> debts on shipped papers are unchanged and live in `PAPERS-AUDIT.md`: the R2 26-night re-run
> (un-DRAFTs §2.4/§2.5) and folding the three 2026-08 walls into `dead-ends` (§2.2).

> **2026-08-08 — a fourth wall for §2.2, and a caution on §2.8.** The `ms;hr;c` export contract made the
> papers' own fused-weight three-cornered hat runnable from a committed artifact for the first time
> (`tools/tch-fused-corpus.mjs`). Two things fell out, both belonging on this agenda: the
> **"artifact-robust" qualifier is doing almost no work** (§2.2 wall 4 below), and **`sigma-no-reference`'s
> published Verity/H10 σ do not reproduce** — which is a caution on §2.8, since that candidate builds on
> the same estimator. Details in `SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md`'s 2026-08-08 banner.

> **Agenda updated 2026-08-04** — three measured negatives added to §2.2's wall list (PAT/PTT,
> the self-referential coupling statistic, the REM stability detector); **new candidate §2.8** (the
> identifiability boundary of reference-free σ — ρ_crit ≈ 0.422 against a measured ρ = 0.42); and **§3.2
> re-sequenced** now that expert PSG stage labels are reachable without EEGDex.

> **Reclassified 2026-08-04 (PROPOSED → REFERENCE).** This was never an executable brief and cannot
> become one: it has **no Done-when list and no checkboxes**, its §6 is titled "Done criteria" but
> describes a *state of the world* rather than acceptance items, and its own text says
> *"Living agenda — flip individual candidates to `DONE` in the table as they ship; do not rename the
> file."* CLAUDE.md's §📌 provides exactly this status for such a doc. Held as PROPOSED it was the
> **oldest outstanding brief in the repo** (41 days) and would have stayed outstanding permanently,
> because an agenda is never finished — it accumulates.
>
> **Verified before reclassifying, in the tree rather than from §6:** all three artifacts §6 claims
> shipped do exist — `papers/timestamp-pathology.html` (21 KB), `papers/dead-ends.html` (29 KB), and
> the real-data `papers/ppg-ecg-hrv-validation.html` (27 KB) that closes §0's real-data-arm gap.
>
> ⚠️ **§6's "the brief is done for now" is STALE and is left in place as a dated record, not a claim.**
> It reconciled criterion (a) on 2026-07-08; `papers/PAPERS-AUDIT.md` then gained **open residuals on
> 2026-07-22** which reopened it. **R2 — the three respiratory papers stay DRAFT until the full 26-night
> corpus is re-run end-to-end through `resp-acc-analysis.html`** (spot-checked on four nights so far:
> clock offsets within 8 s, per-night MAE within 0.06 br/min) **and figures are emitted into
> `papers/figures/`.** Until then their headline numbers trace to the original external harness, which
> does not satisfy the house rule *"no number without a tool that reproduces it"*; each paper carries a
> visible banner saying so — **do not clear it early**. R3 (`effort-typing-null`) is explicitly PARKED,
> which criterion (a) allows.
>
> That open work is **owned by `papers/PAPERS-AUDIT.md`, not by this file** — §Scope-split says this
> brief does not restate per-paper triage. Reclassifying here does not park R2; it puts the agenda in
> the status that matches what it is, and leaves R2 tracked where it belongs.

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
- **⊕ THREE NEW WALLS, measured 2026-08-02 → 08-04**, each with the falsifier that killed it — which is
  the standard this candidate exists to hold:
  - **PAT on single-site optical is blocked by PTT itself, not by instrumentation.** Under per-block
    ACC-anchor alignment the median lag is physiological on every night (405–496 ms) — but beat-to-beat
    IQR is 139–197 ms against a ≤60 ms bar, and the across-night spread 325–535 ms. That is what pulse
    transit time *does* (posture, blood pressure, vasomotor tone). Removing the alignment artifact made
    the alignment good and revealed a **larger** obstacle that is not a software problem
    (`PAT-UNDER-PERBLOCK-ALIGNMENT` §1–§2).
  - **…and the statistic that said otherwise could not fail.** Its `matchRate` compared each lag to a
    median computed from *those same lags* — a 53–69 % chance floor. A held-out-anchor definition scored
    against circular-shift surrogates drops the floor to **6–9 %**, and four of six nights then score
    **below chance** (§3a). Independently, its denominator counted R-peaks the PPG never spanned, so it
    partly measured *recording overlap* rather than coupling (fixed 2026-08-04).
  - **The REM score is a stability detector, pointing the wrong way.** `z(LF/HF) − z(RMSSD) − z(motion)`
    selects the most physiologically *stable* epochs — **zero** desaturations fell in selected epochs
    across 41 nights — and REM is the *least* stable stage (`REM-STAGING-FOLLOWUPS` §3). A future REM
    feature must be arousal- or irregularity-linked; stability proxies are a priori wrong.
  - **The fused-weight hat is barely more robust than the plain one — measured, not argued.** The
    σ-papers attribute their headline numbers to a *"fused-weight artifact-robust hat"* (per-second,
    per-corner confidence `c` driving a weighted-variance TCH). Run against the unweighted hat on the
    same 17 box-captured nights, through the same code path, the two differ by **≤0.12 bpm on every
    corner** (O2Ring 2.99 vs 3.03 · H10 1.78 vs 1.67 · Verity 3.51 vs 3.59). The weighting is not
    wrong; it is *redundant here*, because the artifact rejection already happened upstream — ECGDex
    **drops** beats below c=0.5 rather than down-weighting them, so the surviving series spans only
    [0.5, 1] and is mostly ~1. A qualifier that names the estimator's chief virtue while contributing
    less than the rounding of its own CI is exactly this section's subject matter.
  - **A reference-free σ is not a number — it is a number PER WINDOW LENGTH.** Measured on 17 nights,
    same estimator, same code, varying only how many simultaneous seconds reach the hat: σ rises
    **monotonically** for every corner — Verity 2.36 → 3.51 (**+49 %**), O2Ring 2.34 → 2.99 (+28 %),
    H10 1.41 → 1.78 (+26 %) from a one-hour window to a whole night
    (`tools/tch-window-sensitivity.mjs`). **Neither σ-paper states window length as a parameter**, so
    two honest analysts with the same devices and nights can publish σ differing by half again, and
    neither is wrong. This is `CLAUDE.md` §7's ppm discipline (*"never quote ppm without the span"*)
    arriving one layer up, and it is a **correction owed to published methods**, not merely a wall.
  - **⚠️ §2.8 is HARDWARE-BLOCKED indefinitely, not pending.** Its ρ_crit ≈ 0.422 boundary against a
    measured ρ = 0.42 is exactly the case that needs a fourth, mechanistically-independent corner to
    check — and the owner confirms (2026-08-08) there is **no ResMed oximeter module**, so
    `R5-HR-TRIPLET-REFERENCE`'s "the fix is one cable" is a purchase, not a cable. Write §2.8 as an
    **identifiability-boundary methods paper** (the boundary is analytic and general, and stands on its
    own) — but it may **not** claim the suite's own triplet has been validated against an external
    reference, because that experiment has no route to running.
  - **…and the σ it is a qualifier on does not reproduce.** Two independent re-derivations put **Verity
    noisiest** (3.51 / 3.17 bpm) where `sigma-no-reference` publishes it nearly quietest (**1.42**), and
    H10 at 1.78 / 1.74 against a published **1.28**. The doubling discriminator is clean on every night,
    so this is real beat-to-beat spread, not mis-detection. **⚠ This bears directly on §2.8**, whose
    ρ_crit ≈ 0.422 boundary is computed from these same corner σ: a boundary is only as identifiable as
    the variances feeding it, so §2.8 must not be written until the discrepancy is explained.
    **Update 2026-08-25 — sharpened by sigma v2/v2.1 (2026-08-15), not resolved:** window-matched, the
    O2Ring corner reproduces across both pipelines (2.44 vs 2.41, published inside the CI) and the
    corner-reorder reading is withdrawn as a 24-night small-sample effect — but the H10 and Verity
    corners still fall outside their intervals (published 1.28 / 1.42 vs window-matched 0.93 / 0.72),
    and the paper itself records that *"a per-corner reconciliation of the two pipelines is owed and is
    not yet done."* The gate on §2.8 stands until that reconciliation lands.

- **⚠️ Honesty constraint this candidate must carry.** The PAT wall's harness does **not** reproduce the
  parent brief's `matchRate` (24–42 % vs 90–96 % on the same six nights) and that is unreconciled. The
  *mechanism* (PTT variability) is solid; the *coupling number* is not publishable yet. **Write the wall,
  not the figure.**
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
- **Dependency status (2026-08-25): SATISFIED SINCE JULY.** The adapter spine and its
  property/metamorphic test group shipped and closed 2026-07-04, so "alongside adapter metamorphic
  tests" is no longer a wait. What this candidate lacks is a champion, not a prerequisite.

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
- **Unpark path (2026-08-25):** the mechanism test that parked this ran against `MaskPress.2s` (2 s
  sampling). Comparator v1.1 (#1787) now carries live `Press.40ms` — delivered pressure at 25 Hz, on
  both live and SD sides of paired nights — so the CPAP-pressure hypothesis can be re-tested at 12× the
  rate that failed it. Recorded so the parked reason stays honest; not a commitment to unpark.

### 2.7 AHI and oximetric burden disagree on the same nights — a real-validation candidate <span title="candidate">[CANDIDATE]</span>
- **Claim:** the CPAP's own scored **AHI does not predict oximetric burden** on paired nights.
  Over **37 paired nights**: `r(AHI, ODI3) = 0.06`, `r(AHI, hypoxic burden) = −0.05`,
  `r(AHI, nadir) = −0.02`. Concretely, 2026-06-14 scored AHI **1.11** (excellent) with ODI3 8.4 /
  burden 16.8 / nadir 85 %, while 2026-07-23 scored AHI **8.00** — the corpus worst — with ODI3 2.9 /
  burden 0.9 / nadir 87 %. Two devices, same nights, opposite verdicts.
- **Data class:** REAL (n-of-1; 37 paired nights), and the literature is on its side — hypoxic burden
  and AHI are established as non-interchangeable predictors, so this is a *replication in a home
  setting*, not a novel claim.
- **Routed here rather than surfaced in a node** (`MULTINIGHT-CORPUS-FINDINGS-FOLLOWUPS` §1.2): it is a
  **fusion** question, and one subject cannot support a claim graded above its tier. **No node may
  surface it until n > 1 subject** — the same discipline that retired ECGDex's `estimatedAHI`.
- Natural companion to §2.4 (CPAP flow as a home reference standard), which supplies the AHI leg.
- **Readiness upgraded (2026-08-25):** the AHI leg's provenance hardened for free — CPAPDex matches the
  device's own STR scoring to 0.05/h, and STR `deviceCsr` is now cross-validated against CPAPDex
  periodic-breathing % (#1781). The n > 1-subject gate is unchanged and still the binding constraint.

---

### 2.8 ✦✦ When is reference-free σ identifiable? — the degeneracy boundary of the three-cornered hat <span title="candidate">[CANDIDATE — NEW 2026-08-04]</span>
- **Claim:** the three-cornered hat is the series' own tool for measuring device error without a
  reference (`sigma-no-reference`), and it rests on an assumption — mutually independent corner errors —
  that is **routinely false and fails silently**. A violated assumption does not produce an error; it
  **moves variance between corners**, which is how a chest strap acquires an implausible σ. The paper
  states the identifiability condition and shows a real triplet sitting on the wrong side of it.
- **The measurement that makes it a paper, not a caveat** (`TCH-REFERENCE-VALIDATION` §8a, 2026-08-04):
  generalising the hat to a ρ **per pair** — `Var(x_i − x_j) = σ²_i + σ²_j − 2ρ_ij σ_i σ_j`, nonlinear,
  no closed form — and sweeping the measured ρ(ECG-RSA, PPG-RSA) = 0.42 gives

  | ρ | σ(CPAP) |
  |---|---|
  | 0.00 (classic) | 2.07 |
  | 0.30 | 1.33 |
  | **0.42 (measured)** | **0.19** |
  | 0.50 | *no solution exists* |

  **ρ_crit ≈ 0.422.** The measured correlation sits within **0.5 %** of the value at which σ collapses to
  zero and past which the system has no solution at all. So the estimate is not merely uncertain — it is
  **not identifiable**, and a quantity that is 1.33 at ρ = 0.30, 0.19 at 0.42 and undefined at 0.43
  cannot be reported as a measurement.
- **Why it generalises beyond this suite:** every reference-free metrology programme built on TCH (GNSS
  timing, clock ensembles, multi-instrument climate records) inherits the same boundary, and the
  literature discusses correlated corners far less than it discusses negative variances. The deliverable
  is a **usable admissibility test**: given three difference variances and a ρ structure, does a positive
  solution exist, and how far is this triplet from the edge?
- **Data class:** REAL (own corpus, one triplet) + synthetic for the boundary map. **Needs:** current
  stack only — the kernel ships in `analysis-stats.js` with a known-answer self-test and a first-class
  refusal path. **Bounding limitation:** n = 1 triplet on one subject; the *boundary* is analytic and
  general, the *specific ρ* is not. **Effort:** MED. **Pairs with:** `sigma-no-reference` (this is its
  missing limitations section, promoted to a result) and §2.2's dead-ends framing.
- **⚠️ Do not overclaim the recovery.** σ(CPAP) moving 2.07 → 0.19 is *not* "the CPAP is a near-perfect
  sensor" — it is the model running out of room. The finding is the **boundary**, not the number.

### 2.9 ✦ A vibration fiducial for cross-device time alignment <span title="candidate">[CANDIDATE — NEW 2026-08-25]</span>
- **Claim:** a deliberate vibration event (the O2Ring's own buzzer, opcode-triggered from the capture
  host) is a shared mechanical fiducial every co-worn IMU hears — cross-device time alignment **without
  a shared host clock**, the exact gap `known-clock-recovery` leaves open. Measured 2026-08-24: the buzz
  lands **5/5 in H10 ACC and 5/5 in Verity ACC** on the pairwise night; trigger→imprint latency
  ~0.1–0.4 s, poll-quantized. An aperiodic fiducial also sidesteps the beat-train degeneracy (beat
  matching pins a clock offset only mod one RR interval — align on aperiodic features).
- **Data class:** REAL (own corpus). **Needs:** current stack — the capture-host buzz trigger shipped.
  **Bounding limitation:** latency is quantized by the ring's poll loop, so the fiducial bounds
  alignment at ~0.1–0.4 s — sufficient for stream-level alignment, **not** for beat-level PAT (which
  `wearable-clock-drift` v3 shows fails for independent reasons anyway). Single subject, one trio; the
  ring hears its own buzz worst.
- **Effort:** LOW — the measurement exists; one night's analysis is most of the paper. Pairs with
  `known-clock-recovery` (its missing no-shared-host arm) and §2.2's PAT wall.

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
- **Data class:** REAL. **Needs (updated 2026-08-25):** the adapter spine is **DONE (2026-07-04)** — no
  code dependency remains; the binding constraint is **physical co-recordings across ≥3 vendors** (the
  current corpus is Polar-heavy). **Bounding limitation:** how many devices you can co-wear, and
  motion-regime coverage (the σ paper already shows resting sessions strip shared HRV — needs a dynamic
  session). **Effort:** MED; this is the single most publishable thing the adapter layer produces.

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
- **⊕ RE-SEQUENCED 2026-08-04 — this is no longer the only route to a stage label, and no longer the
  first one.** `nsrr-adapter.js` now emits **per-epoch expert PSG stage labels** (`stages[]`, a 30 s
  `epochs[]` grid indexed from recording start, `remFrac`). They were always in the annotation files —
  the parser was walking every scored stage event and discarding the stage *identity* on the same line
  it read it, keeping only a scalar for total sleep time. So a **clinically-scored** validation arm is
  reachable on the **current** stack, with no new node:
  - it is **expert PSG**, strictly stronger than a consumer-EEG anchor, so it does not carry §3.2's
    "anchor, not gold standard" caveat;
  - it is the missing denominator for two blocked staging efforts — `REM-STAGING-REDESIGN` and
    `DEEP-STAGE-DESAT-CONFOUND` both ended in measured negatives for want of a label, and the standing
    constraint from that work is that **no staging detector may be validated on `genSynthetic`** (the
    oracle plants the exact signature the rule looks for: 92.6 % recall against planted truth while
    under-calling REM ~4× on real nights);
  - it is blocked on **records only** — NSRR requires a signed DUA and the suite is 100 % local, so this
    needs a human to drop EDF + annotation-XML pairs in. That is a materially cheaper unblock than
    building a node. **CANCELLED — owner, 2026-08-28: no DUA will be pursued; revisit only if
    records ever arrive** (see REM-STAGING-FOLLOWUPS-2026-08-02 §2b for the standing stamp).
    ⊕ **THE REVISIT CONDITION HAS FIRED — 2026-09-04 (Osprey).** NSRR access was approved 2026-09-02
    and **99 EDF + 5136 annotation XML are on disk** at `/srv/data/shhs/polysomnography/`, all 99 ids
    paired. The DUA question is settled; the remaining gate is the owner's SEPARATE condition that NSRR
    stays closed until the brief drain completes (**unmet: 73 open vs a ≤20 target**). So this item is no
    longer cancelled-for-want-of-data — it is owner-gated. Inventory, boundaries and pre-stated bands:
    `SHHS-EXTERNAL-VALIDATION-2026-09-04-BRIEF.md`. ⚠ It measures **PPG 0/99**, so the staging arm scoped
    here is reachable while nothing PPG-derived is.
  - **Carry the domain-shift caveat:** NSRR is clinical PSG on a clinical population, not a consumer
    chest strap on a healthy sleeper at home. A detector tuned on NSRR and deployed on H10 data inherits
    a domain shift, and the real-night falsifiers remain the only check that survives the move — a good
    NSRR number must not retire them.

  **Sequencing consequence:** an NSRR-labelled staging-validation paper is a **§2 candidate in
  everything but data access**, and should precede §3.2 rather than wait on it. EEGDex then answers a
  *different* and still-valuable question — can a consumer EEG anchor stand in for lab PSG at home? —
  which is a better framing for it than "the only way to get a label".

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
| 2.3 Cross-signal plausibility QC | synth+real | **none (now)** — adapter deps closed 2026-07-04 | MED | unscheduled — needs a champion |
| 2.4 CPAP flow home reference | REAL | **none (now)** | LOW–MED | ✅ **DRAFTED** — un-DRAFTs when the R2 26-night re-run lands |
| 2.5 H10 ACC respiratory rate | REAL | **none (now)** | LOW | ✅ **DRAFTED** — un-DRAFTs when the R2 26-night re-run lands |
| 2.6 Effort-typing null | REAL | `Press.40ms` mechanism re-test | LOW | ⏸ **PARKED** — unpark path exists (comparator v1.1) |
| 2.7 AHI vs oximetric burden | REAL | **n > 1 subject** | MED | gated on the subject count, not the stack |
| 2.8 σ identifiability boundary | REAL+synth | H10/Verity pipeline reconciliation | MED | ⛔ gated — see §2.2 walls |
| 2.9 Vibration fiducial | REAL | **none (now)** | LOW | ready — data in hand (2026-08-24) |
| 3.1 Multi-vendor HRV agreement (real) | REAL | vendor-diverse co-recordings (code deps done) | MED | when the corpus has ≥3 vendors — flagship |
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
